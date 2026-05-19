"use strict";

/**
 * hlsCleanup.js — FLUX v3
 *
 * KEY CHANGE: Segment deletion is now position-aware (Jellyfin pattern).
 *
 * Jellyfin's TranscodingSegmentCleaner:
 *   - Tracks downloadPositionTicks (= how far player has consumed)
 *   - Only deletes segments with index < (downloadPos/segLen) - keepBuffer
 *   - Keeps a configurable "keep buffer" of past segments (default: 20s worth)
 *
 * This prevents:
 *   - Deleting segments the player might still need (buffered content)
 *   - Deleting segments the user might seek back to (recent history)
 *
 * Storage explosion prevention:
 *   - Segments older than MAX_SEGMENT_AGE_SEC AND behind the keep buffer
 *     are deleted
 *   - Overall temp dir size limit still enforced (LRU session eviction)
 */

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const { getSession, killSession, getSessionStats, getCurrentSegmentIndex, TEMP_DIR, SESSION_TIMEOUT_MS, SEGMENT_DURATION } = require("./transcoderService");

// ─── Config ───────────────────────────────────────────────────────────────────

const CLEANUP_INTERVAL_MS = parseInt(process.env.CLEANUP_INTERVAL_MS || "30000", 10); // 30s
const MAX_TEMP_MB = parseInt(process.env.MAX_TEMP_MB || "4096", 10); // 4 GB
const ORPHAN_AGE_MS = parseInt(process.env.ORPHAN_AGE_MS || "600000", 10); // 10 min
// How many seconds of past segments to keep (player can seek back this far without restart)
const SEGMENT_KEEP_SECONDS = parseInt(process.env.SEGMENT_KEEP_SECONDS || "30", 10);

let _timer = null;
let _running = false;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getDirSizeMB(dirPath) {
    let total = 0;
    try {
        const entries = await fsp.readdir(dirPath, { withFileTypes: true });
        for (const e of entries) {
            const full = path.join(dirPath, e.name);
            if (e.isFile()) total += (await fsp.stat(full)).size;
            else if (e.isDirectory()) total += await getDirSizeBytes(full);
        }
    } catch {}
    return total / (1024 * 1024);
}

async function getDirSizeBytes(dirPath) {
    let total = 0;
    try {
        const entries = await fsp.readdir(dirPath, { withFileTypes: true });
        for (const e of entries) {
            const full = path.join(dirPath, e.name);
            if (e.isFile()) total += (await fsp.stat(full)).size;
            else if (e.isDirectory()) total += await getDirSizeBytes(full);
        }
    } catch {}
    return total;
}

// ─── Step 1: Expire idle sessions ────────────────────────────────────────────

async function expireInactiveSessions() {
    const stats = getSessionStats();
    for (const s of stats) {
        if (s.idleMs > SESSION_TIMEOUT_MS) {
            console.log(`[Cleanup] Expiring idle session ${s.id} (idle ${Math.round(s.idleMs / 1000)}s)`);
            await killSession(s.id);
        }
    }
}

// ─── Step 2: Remove orphan folders ────────────────────────────────────────────

async function removeOrphanFolders() {
    try {
        await fsp.mkdir(TEMP_DIR, { recursive: true });
        const entries = await fsp.readdir(TEMP_DIR, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const sessionDir = path.join(TEMP_DIR, entry.name);
            if (getSession(entry.name)) continue; // active session
            let stat;
            try {
                stat = await fsp.stat(sessionDir);
            } catch {
                continue;
            }
            if (Date.now() - stat.mtimeMs < ORPHAN_AGE_MS) continue;
            console.log(`[Cleanup] Removing orphan folder ${entry.name}`);
            try {
                await fsp.rm(sessionDir, { recursive: true, force: true });
            } catch (e) {
                console.error("[Cleanup] rm orphan failed:", e.message);
            }
        }
    } catch (e) {
        console.error("[Cleanup] orphan scan error:", e.message);
    }
}

// ─── Step 3: Position-aware segment deletion (Jellyfin pattern) ──────────────

/**
 * For each active session, delete segments that are:
 *   - Behind the player's current position by more than SEGMENT_KEEP_SECONDS
 *   - i.e. segIndex < (downloadPositionSec - SEGMENT_KEEP_SECONDS) / SEGMENT_DURATION
 *
 * This is exactly what Jellyfin's TranscodingSegmentCleaner does:
 *   idxMaxToDelete = (downloadPositionSec - segmentKeepSeconds) / segmentLength
 */
async function deleteConsumedSegments() {
    const stats = getSessionStats();

    for (const s of stats) {
        const session = getSession(s.id);
        if (!session) continue;
        if (!session.downloadPositionSec || session.downloadPositionSec <= SEGMENT_KEEP_SECONDS) continue;

        const idxMaxToDelete = Math.floor((session.downloadPositionSec - SEGMENT_KEEP_SECONDS) / SEGMENT_DURATION);

        if (idxMaxToDelete <= 0) continue;

        // List all segment files in session dir
        let files;
        try {
            files = await fsp.readdir(session.sessionDir);
        } catch {
            continue;
        }

        for (const file of files) {
            const m = file.match(/^index(\d+)\.ts$/);
            if (!m) continue;
            const idx = parseInt(m[1], 10);
            if (idx >= idxMaxToDelete) continue; // keep it

            const filePath = path.join(session.sessionDir, file);
            try {
                await fsp.unlink(filePath);
                // Optionally log at debug level:
                // console.log(`[Cleanup] Deleted consumed seg ${file} from ${s.id}`);
            } catch {}
        }
    }
}

// ─── Step 4: Enforce max temp storage ────────────────────────────────────────

async function enforceStorageLimit() {
    let totalMB;
    try {
        totalMB = await getDirSizeMB(TEMP_DIR);
    } catch {
        return;
    }

    if (totalMB <= MAX_TEMP_MB) return;

    console.warn(`[Cleanup] Temp ${Math.round(totalMB)} MB > limit ${MAX_TEMP_MB} MB — evicting oldest sessions`);

    const dirs = [];
    try {
        const entries = await fsp.readdir(TEMP_DIR, { withFileTypes: true });
        for (const e of entries) {
            if (!e.isDirectory()) continue;
            const full = path.join(TEMP_DIR, e.name);
            try {
                const stat = await fsp.stat(full);
                dirs.push({ id: e.name, full, mtime: stat.mtimeMs });
            } catch {}
        }
    } catch {
        return;
    }

    dirs.sort((a, b) => a.mtime - b.mtime); // oldest first

    for (const dir of dirs) {
        if (totalMB <= MAX_TEMP_MB * 0.85) break;
        const sizeMB = await getDirSizeMB(dir.full);
        console.log(`[Cleanup] Evicting ${dir.id} (${Math.round(sizeMB)} MB)`);
        await killSession(dir.id);
        try {
            await fsp.rm(dir.full, { recursive: true, force: true });
        } catch {}
        totalMB -= sizeMB;
    }
}

// ─── Cleanup cycle ────────────────────────────────────────────────────────────

async function runCycle() {
    if (_running) return;
    _running = true;
    try {
        await expireInactiveSessions();
        await deleteConsumedSegments(); // position-aware (Jellyfin pattern)
        await removeOrphanFolders();
        await enforceStorageLimit();
    } catch (e) {
        console.error("[Cleanup] cycle error:", e.message);
    } finally {
        _running = false;
    }
}

function startDaemon() {
    console.log(`[Cleanup] Daemon started — ${CLEANUP_INTERVAL_MS / 1000}s interval, keep ${SEGMENT_KEEP_SECONDS}s of segments`);
    fs.mkdirSync(TEMP_DIR, { recursive: true });
    runCycle();
    _timer = setInterval(runCycle, CLEANUP_INTERVAL_MS);
}

function stopDaemon() {
    clearInterval(_timer);
    console.log("[Cleanup] Daemon stopped");
}

async function forceCleanupNow() {
    await runCycle();
}

module.exports = { startDaemon, stopDaemon, forceCleanupNow };
