# Multi-Device Concurrent Streaming Investigation Report

## Files Investigated

**File Path:** `server/utils/transcoderService.js`
**Purpose:** Manages FFmpeg lifecycle, sessions, and HLS manifest/segment tracking.
**Relevant Functions:**
- `makeSharedKey()`: Generates the unique key used for session reuse.
- `createSession()` and `_createSessionInternal()`: Creates and deduplicates transcode sessions.
- `killSession()`: Terminates FFmpeg and deletes the HLS directory.

**File Path:** `server/controllers/streamController.js`
**Purpose:** Handles HTTP endpoints for HLS streaming, transcode start, session heartbeat, and stopping sessions.
**Relevant Functions:**
- `stopSession()`: Kills a transcode session.
- `pingSessionHandler()`: Receives heartbeats from players to update `downloadPositionSec`.
- `serveHLSFile()`: Serves HLS segments and handles gap detection.

**File Path:** `server/utils/hlsCleanup.js`
**Purpose:** Background daemon to enforce storage limits and delete old/consumed HLS segments.
**Relevant Functions:**
- `deleteConsumedSegments()`: Deletes old segments based on `downloadPositionSec`.
- `enforceStorageLimit()`: Deletes sessions to keep `TEMP_DIR` under `MAX_TEMP_MB` (4GB).

**File Path:** `web/src/Pages/Player/PlayerPage.jsx`
**Purpose:** Frontend player container that starts and stops streaming sessions.
**Relevant Functions:**
- `useEffect()` cleanup function: Calls `stopSession()` when the player unmounts.

---

## Root Cause Analysis

There are two distinct root causes that result in the `Stream Not Found` error during concurrent playback. They depend on whether users are watching the same media or different media.

### Issue 1: Shared Session Collisions (Same Media)
When User A and User B stream the **same media** with the same quality settings, they are improperly assigned the exact same `TranscodeSession` instance and `sessionId`. This happens because `makeSharedKey()` in `transcoderService.js` keys sessions by `mediaId` + `params` without incorporating any user or client identifier (`clientId` or `userId`).

This shared state causes three catastrophic failures:
1. **Unmount Termination:** When User B closes their player, their frontend sends a `DELETE` request to `stopSession(sessionId)`. Because the session is shared, User A's active session is killed and its `/tmp/hls/<sessionId>` directory is wiped. The next segment User A requests returns `404 Stream Not Found`.
2. **Backward Seek Restart:** If User A is 10 minutes into the video, and User B starts the video from the beginning (segment 0), the gap detection in `_createSessionInternal` evaluates the gap as negative (`0 - <User A's currentIdx>`). This triggers the logic to kill the session and restart FFmpeg from segment 0, instantly breaking User A's stream.
3. **Aggressive Segment Cleanup:** `pingSessionHandler()` uses `Math.max()` to track `downloadPositionSec`. User A's high playback position permanently shifts the session's clean-up window forward. As a result, `deleteConsumedSegments()` in `hlsCleanup.js` deletes the early segments that User B is trying to watch, causing `404` errors for User B.

### Issue 2: Storage Eviction of "Done" Sessions (Different Media)
When User A and User B stream **different media**, they are correctly assigned different sessions. However, the system's aggressive storage cleanup causes failures.
If User A is watching a short video, or hardware-accelerated FFmpeg encodes it extremely fast, FFmpeg finishes transcoding before the player finishes playback. At this point, User A's session `status` changes from `"running"` to `"done"`.

If User B then starts a stream that generates a large number of segments, the total HLS storage may exceed `MAX_TEMP_MB` (4 GB). The `enforceStorageLimit()` function in `hlsCleanup.js` runs to free space. It explicitly skips `"running"` sessions, but it considers `"done"` sessions as inactive and evicts them:
```javascript
const session = getSession(dir.id);
if (session && session.status === "running") {
    console.log(`[Cleanup] Skipping active session ${dir.id} during storage eviction`);
    continue;
}
// Evicts the dir if it's "done"
```
User A's session directory is deleted to make room for User B, even though User A is only halfway through watching the buffered segments. The next segment User A requests returns `404 Stream Not Found`.

---

## Suspected Files Requiring Changes

**File:** `server/utils/transcoderService.js`
**Reason:** Session generation must be isolated per client. The session key generation needs to include a unique client/device identifier to prevent streams from merging.
**Functions:** `makeSharedKey()`, `createSession()`
**Approximate Lines:** 65-68, 362-390

**File:** `server/controllers/streamController.js`
**Reason:** The stream controller needs to pass the `clientId` (which is already provided in frontend queries/bodies) down to `createSession()` so it can be incorporated into the shared key.
**Functions:** `startHLSSession()`, `startTranscode()`
**Approximate Lines:** 180-194, 514-537

**File:** `server/utils/hlsCleanup.js`
**Reason:** Storage limit enforcement must protect `"done"` sessions if they have been recently accessed by a player (e.g., via checking `session.lastAccessedAt` or `idleMs`).
**Functions:** `enforceStorageLimit()`
**Approximate Lines:** 179-224

---

## Risk Assessment

**Impact Level:** High. This is a critical issue that completely breaks the core functionality of a multi-user media server. It guarantees stream failures during simultaneous usage.

**Confidence Level:** High. The code explicitly shows the lack of user segregation in `makeSharedKey` and the aggressive eviction of `"done"` sessions in `hlsCleanup.js`.

**Why the issue occurs:** The system was built with a single-user mindset where session reuse is a performance optimization (preventing duplicate transcodes if the same user refreshes the page). When scaled to multiple users, this optimization becomes a critical bug.

**Does it affect same-media playback?** Yes. Shared sessions cause unmount kills, backward-seek restarts, and aggressive segment cleanup.

**Does it affect different-media playback?** Yes. High disk usage triggers the storage cleaner, which deletes sessions that have finished transcoding but are still actively being watched.
