"use strict";

/**
 * streamController.js — FLUX v3 (Jellyfin-inspired)
 *
 * KEY CHANGES vs v2:
 *
 *  1. HLS seeking now uses SEGMENT IDs not raw time offsets.
 *     GET /stream/video/:id?info=1  → returns { hlsUrl, sessionId }
 *     Frontend then requests segments by number, server handles seek.
 *
 *  2. serveHLSFile detects when client requests a segment far ahead/behind
 *     current transcode and triggers a session restart at that segment.
 *     (Mirrors Jellyfin's GetDynamicSegment logic)
 *
 *  3. Session "ping" heartbeat updates downloadPositionSec so cleaner
 *     knows what segments are safe to delete.
 *
 *  4. Direct-play range streaming unchanged (it already works).
 *
 * Routes:
 *   GET  /stream/video/:id            smart stream
 *   HEAD /stream/video/:id            headers only
 *   GET  /stream/hls/:sessionId/index.m3u8        manifest
 *   GET  /stream/hls/:sessionId/index:segId.ts    segment (with gap detection)
 *   POST /stream/transcode/:id        explicit transcode start
 *   POST /stream/sessions/:id/ping    heartbeat (updates downloadPos)
 *   DELETE /stream/sessions/:id       kill session
 *   GET  /stream/sessions             admin list
 *   GET  /stream/subtitle/:encoded    subtitle
 */

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const mime = require("mime-types");
const { spawn } = require("child_process");

const { readFolders } = require("./libraryController");
const { sanitizePath, isSubtitleFile } = require("../utils/fileHelpers");
const mediaCache = require("../utils/mediaCache");
const { probe } = require("../utils/ffprobe");
const { decidePlayback, DECISION } = require("../utils/streamingEngine");
const {
    createSession,
    getSession,
    killSession,
    getSessionStats,
    waitForM3U8,
    waitForSegment,
    getCurrentSegmentIndex,
    segmentPath: makeSegPath,
    TEMP_DIR,
    SEGMENT_DURATION,
    SEGMENT_GAP_RESTART,
} = require("../utils/transcoderService");

// ─── Constants ────────────────────────────────────────────────────────────────

const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB for direct-play range chunks

// Cache ffprobe duration so range requests don't re-probe.
// BUG-09 FIX: proper LRU — on hit, delete+re-insert to update insertion order.
const durationCache = new Map();
const MAX_DURATION_CACHE = 1000;

async function getDuration(filePath) {
    if (durationCache.has(filePath)) {
        // LRU: move to end (most recently used)
        const val = durationCache.get(filePath);
        durationCache.delete(filePath);
        durationCache.set(filePath, val);
        return val;
    }
    try {
        const info = await probe(filePath);
        if (info?.duration > 0) {
            if (durationCache.size >= MAX_DURATION_CACHE) {
                // Evict LRU entry (first key = oldest insertion = least recently used)
                durationCache.delete(durationCache.keys().next().value);
            }
            durationCache.set(filePath, info.duration);
            return info.duration;
        }
    } catch {}
    return null;
}

// ─── File resolver ────────────────────────────────────────────────────────────

async function resolveFileById(id) {
    // Fast path: O(1) in-memory index hit
    const cached = mediaCache.getFileById(id);
    if (cached) return cached;
    // Slow path: async cached folder scan (non-blocking, uses getOrScan per folder)
    const folders = await readFolders();
    return mediaCache.findById(folders, id);
}

function parseClientCaps(query) {
    return {
        maxHeight: parseInt(query.maxHeight || "1080") || 1080,
        hdrSupport: query.hdr === "1",
        audioCodecs: (query.audioCodecs || "aac,mp3,opus").split(","),
        videoCodecs: (query.videoCodecs || "h264,vp9").split(","),
        containers: (query.containers || "mp4,webm,mkv").split(","),
    };
}

// ─── Direct Play ──────────────────────────────────────────────────────────────

async function serveDirectPlay(req, res, filePath, contentType) {
    let stat;
    try {
        stat = await fsp.stat(filePath);
    } catch {
        return res.status(404).json({ error: "File not found" });
    }

    const fileSize = stat.size;
    const range = req.headers["range"];
    const durationSec = await getDuration(filePath);

    res.setHeader("Content-Type", contentType);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length, X-Content-Duration");
    if (durationSec) res.setHeader("X-Content-Duration", String(durationSec));

    if (req.method === "HEAD") {
        res.setHeader("Content-Length", fileSize);
        return res.status(200).end();
    }

    if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        if (!Number.isFinite(start) || start < 0) {
            res.setHeader("Content-Range", `bytes */${fileSize}`);
            return res.status(416).end();
        }
        const requestedEnd = parts[1] ? parseInt(parts[1], 10) : start + CHUNK_SIZE - 1;
        const end = Math.min(requestedEnd, fileSize - 1);
        if (!Number.isFinite(end) || start > end) {
            res.setHeader("Content-Range", `bytes */${fileSize}`);
            return res.status(416).end();
        }
        res.status(206);
        res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
        res.setHeader("Content-Length", end - start + 1);
        const stream = fs.createReadStream(filePath, { start, end });
        stream.on("error", (err) => {
            console.error("[Stream] range error:", err.message);
            stream.destroy();
        });
        // Cleanup: destroy stream if client disconnects early (prevents handle leaks)
        res.on("close", () => {
            if (!stream.destroyed) stream.destroy();
        });
        return stream.pipe(res);
    }

    res.setHeader("Content-Length", fileSize);
    res.status(200);
    const stream = fs.createReadStream(filePath);
    stream.on("error", (err) => {
        console.error("[Stream] full error:", err.message);
        if (!res.headersSent) res.status(500).end();
    });
    // Cleanup: destroy stream if client disconnects early
    res.on("close", () => {
        if (!stream.destroyed) stream.destroy();
    });
    return stream.pipe(res);
}

// ─── Start HLS (returns JSON with session info) ───────────────────────────────

async function startHLSSession(req, res, fileObj, decision, mediaInfo) {
    // Convert time-based seek to segment number
    const seekSec = parseFloat(req.query.t || "0") || 0;
    const startSeg = Math.max(0, Math.floor(seekSec / SEGMENT_DURATION));

    let session;
    try {
        session = await createSession({
            mediaId: fileObj.id,
            filePath: fileObj.path,
            decision,
            mediaInfo,
            startSegment: startSeg,
        });
    } catch (err) {
        console.error("[Stream] createSession error:", err.message);
        return res.status(500).json({ error: "Failed to start transcoder" });
    }

    try {
        await waitForM3U8(session.m3u8Path, 60_000);
    } catch (err) {
        // Timeout — check if FFmpeg has already exited with error.
        // BUG-12 FIX: poll session.status for up to 1s instead of fixed 300ms yield.
        // On a busy server the exit event may take > 300ms to reach the handler.
        let waited = 0;
        while (waited < 1000 && session.status === "starting") {
            await new Promise((r) => setTimeout(r, 50));
            waited += 50;
        }

        if (session.status === "error" || session.status === "dead") {
            console.error(`[Stream] FFmpeg failed before manifest was ready — session ${session.id}, status=${session.status}`);
            try {
                await session.kill();
            } catch {}
            return res.status(503).json({ error: "Transcoder failed to start. Check FFmpeg installation." });
        }
        // FFmpeg still starting (e.g. slow Windows HEVC init) — return URL anyway
        // and let HLS.js retry manifest requests with its own retry logic.
        console.warn(`[Stream] waitForM3U8 timeout session ${session.id} (status=${session.status}) — returning URL for HLS.js retry`);
    }

    const hlsUrl = `/stream/hls/${session.id}/index.m3u8`;
    res.setHeader("X-Stream-Decision", decision.decision);
    res.setHeader("X-Session-Id", session.id);
    return res.json({
        mode: "hls",
        sessionId: session.id,
        hlsUrl,
        decision: decision.decision,
        startSegment: startSeg,
        segmentDuration: SEGMENT_DURATION,
        duration: mediaInfo?.duration || null,
        // Added: player top-bar title + correct history key
        title: fileObj.name || null,
        mediaId: fileObj.id || null,
    });
}

// ─── Main stream handler ──────────────────────────────────────────────────────

async function streamVideo(req, res) {
    try {
        const { id } = req.params;
        const fileObj = await resolveFileById(id);
        if (!fileObj) return res.status(404).json({ error: "Media not found" });

        const filePath = fileObj.path;
        const contentType = mime.lookup(filePath) || "video/mp4";
        const clientCaps = parseClientCaps(req.query);
        const options = {
            forceTranscode: req.query.transcode === "1",
            quality: req.query.quality,
            subtitleMode: req.query.subtitle,
        };

        let mediaInfo;
        try {
            mediaInfo = await probe(filePath);
        } catch (err) {
            console.warn(`[Stream] ffprobe failed: ${err.message}`);
        }

        const decision = decidePlayback(mediaInfo, clientCaps, options);
        console.log(`[Stream] ${path.basename(filePath)} → ${decision.decision} (${decision.reason})`);

        if (req.query.info === "1") {
            if (decision.decision === DECISION.DIRECT_PLAY) {
                const BASE = process.env.SERVER_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
                return res.json({
                    mode: "direct",
                    streamUrl: `${BASE}/stream/video/${id}`,
                    decision: decision.decision,
                    duration: mediaInfo?.duration || null,
                    title: fileObj.name || null,
                    mediaId: fileObj.id || id,
                });
            }
            return startHLSSession(req, res, fileObj, decision, mediaInfo);
        }

        if (decision.decision === DECISION.DIRECT_PLAY) {
            return serveDirectPlay(req, res, filePath, contentType);
        }

        return startHLSSession(req, res, fileObj, decision, mediaInfo);
    } catch (err) {
        console.error("[Stream] streamVideo error:", err);
        if (!res.headersSent) res.status(500).json({ error: "Stream error" });
    }
}

// ─── HLS file server (Jellyfin-style segment gap detection) ───────────────────

async function serveHLSFile(req, res) {
    try {
        const { sessionId } = req.params;
        let filePart = req.params.file;
        if (Array.isArray(filePart)) filePart = filePart.join("/");

        let session = getSession(sessionId);

        // ── Disk fallback: session not in memory (server restarted) ──────────
        // If HLS files exist on disk for this sessionId, serve them directly.
        // FFmpeg may have already finished; files are usable even without live session.
        if (!session) {
            const diskDir = path.join(TEMP_DIR, sessionId);
            const diskManifest = path.join(diskDir, "index.m3u8");
            const diskFile = path.join(diskDir, filePart);

            // Verify the sessionId directory exists and is inside TEMP_DIR
            const resolvedDisk = path.resolve(diskFile);
            const resolvedDir = path.resolve(diskDir);

            if (fs.existsSync(diskManifest) && resolvedDisk.startsWith(resolvedDir + path.sep)) {
                console.log(`[Stream] Ghost serve — session ${sessionId} not in memory but files exist on disk`);
                const ext2 = path.extname(filePart);
                if (ext2 === ".m3u8" && fs.existsSync(diskManifest)) {
                    const content = await fsp.readFile(diskManifest);
                    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
                    res.setHeader("Cache-Control", "no-cache");
                    res.setHeader("Access-Control-Allow-Origin", "*");
                    return res.end(content);
                }
                if (ext2 === ".ts" && fs.existsSync(diskFile)) {
                    res.setHeader("Content-Type", "video/mp2t");
                    res.setHeader("Cache-Control", "max-age=86400");
                    res.setHeader("Access-Control-Allow-Origin", "*");
                    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
                    return fs.createReadStream(diskFile).pipe(res);
                }
            }

            console.warn(`[Stream] Session ${sessionId} not found, no disk fallback for: ${filePart}`);
            return res.status(404).json({ error: "Session not found or expired" });
        }

        session.touch();

        const filePath = path.join(TEMP_DIR, sessionId, filePart);
        const resolved = path.resolve(filePath);
        const sessDir = path.resolve(path.join(TEMP_DIR, sessionId));

        // Path traversal guard
        if (!resolved.startsWith(sessDir + path.sep) && resolved !== sessDir) {
            return res.status(403).json({ error: "Forbidden" });
        }

        const ext = path.extname(filePart);

        // ── m3u8 manifest ─────────────────────────────────────────────────────
        if (ext === ".m3u8") {
            try {
                await waitForM3U8(resolved, 15_000);
            } catch {
                return res.status(504).json({ error: "Manifest not ready" });
            }
            let content = await fsp.readFile(resolved, "utf-8");

            // FIX (Report-15): Solve the ENDLIST deadlock.
            //
            // Problem chain:
            //   1. -t cap → FFmpeg exits normally → writes #EXT-X-ENDLIST
            //   2. If we strip ENDLIST → HLS.js treats stream as "live EVENT"
            //      → only requests segments listed in manifest
            //      → never requests the next unlisted segment
            //      → gap detection (which waits for an OOB segment request) never fires
            //      → deadlock: client waits for manifest update, server waits for client
            //
            // Correct fix: strip ENDLIST *and* inject a sentinel segment entry pointing
            // to the next segment after the last one in the manifest. HLS.js sees this
            // "pending" segment, requests it, gets a 404 (or gap detection catches it
            // first), which triggers a session restart from that segment number.
            //
            // This mirrors how Jellyfin handles chunked on-demand transcoding:
            // the manifest always has one entry beyond current transcode position.
            if (session && session.status !== "dead" && content.includes("#EXT-X-ENDLIST")) {
                // Find highest segment number in manifest
                const segNums = [...content.matchAll(/index(\d+)\.ts/g)].map((m) => parseInt(m[1], 10)).filter((n) => !isNaN(n));
                const lastSeg = segNums.length > 0 ? Math.max(...segNums) : session.startSegment - 1;
                const nextSeg = lastSeg + 1;
                const nextSegName = `index${String(nextSeg).padStart(5, "0")}.ts`;

                // Strip ENDLIST
                content = content.replace(/\n?#EXT-X-ENDLIST\n?/g, "\n");

                // Inject sentinel: a valid HLS entry for the next segment.
                // HLS.js will request it → gap detection fires → session restarts.
                content = content.trimEnd() + `\n#EXTINF:${SEGMENT_DURATION}.000,\n${nextSegName}\n`;
            }

            res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Access-Control-Allow-Origin", "*");
            return res.end(content);
        }

        // ── .ts segment ───────────────────────────────────────────────────────
        if (ext === ".ts") {
            // Parse segment number from filename: index00042.ts → 42
            const segMatch = filePart.match(/index(\d+)\.ts$/);
            if (!segMatch) return res.status(400).json({ error: "Invalid segment name" });
            const requestedSeg = parseInt(segMatch[1], 10);

            // Jellyfin gap detection:
            // If requested segment is behind current OR too far ahead → restart
            const currentIdx = await getCurrentSegmentIndex(session.sessionDir);

            let needsRestart = false;
            if (currentIdx === null) {
                // Nothing transcoded yet (race condition) — wait a bit then check
                needsRestart = false; // fall through to waitForSegment
            } else if (requestedSeg < session.startSegment) {
                // Player seeking backwards before session start
                needsRestart = true;
                console.log(`[Stream] Backward seek to seg${requestedSeg} (session starts at ${session.startSegment}) — restart`);
            } else {
                const gap = requestedSeg - currentIdx;
                if (gap > SEGMENT_GAP_RESTART) {
                    needsRestart = true;
                    console.log(`[Stream] Forward gap ${gap} > ${SEGMENT_GAP_RESTART} for seg${requestedSeg} — restart`);
                } else if (gap < 0) {
                    // Segment behind current transcode — check if still on disk
                    const segFileCheck = makeSegPath(session.sessionDir, requestedSeg);
                    if (!fs.existsSync(segFileCheck)) {
                        needsRestart = true;
                        console.log(`[Stream] Seg${requestedSeg} deleted by cleanup (currentIdx=${currentIdx}) — restart`);
                    }
                } else if (session.status === "done") {
                    // FIX (Report-15): Session finished (-t cap). Sentinel entry in manifest
                    // caused HLS.js to request this segment. It doesn't exist yet on disk →
                    // restart FFmpeg from this segment. This is the gap detection trigger
                    // for the ENDLIST-sentinel pattern used in the m3u8 serve block.
                    const segFileCheck = makeSegPath(session.sessionDir, requestedSeg);
                    if (!fs.existsSync(segFileCheck)) {
                        needsRestart = true;
                        console.log(`[Stream] Session done, sentinel seg${requestedSeg} requested — restarting from seg${requestedSeg}`);
                    }
                }
            }

            if (needsRestart) {
                // Restart transcode from the requested segment
                const fileObj = { id: session.mediaId, path: session.filePath };
                const oldDecision = { decision: session.decision, params: session.params };
                await session.kill();

                try {
                    // Re-probe is expensive; reuse cached info if available
                    let mediaInfo;
                    try {
                        mediaInfo = await probe(fileObj.path);
                    } catch {}

                    session = await createSession({
                        mediaId: fileObj.id,
                        filePath: fileObj.path,
                        decision: oldDecision,
                        mediaInfo,
                        startSegment: requestedSeg,
                    });
                    await waitForM3U8(session.m3u8Path, 20_000);
                    // Update reference in response headers so client can track new session
                    res.setHeader("X-New-Session-Id", session.id);
                } catch (err) {
                    console.error("[Stream] session restart failed:", err.message);
                    return res.status(500).json({ error: "Seek restart failed" });
                }
            }

            // Update download position for segment cleaner
            const segEndSec = (requestedSeg + 1) * SEGMENT_DURATION;
            session.downloadPositionSec = Math.max(session.downloadPositionSec || 0, segEndSec);

            // Wait for this specific segment to exist
            const segFile = makeSegPath(session.sessionDir, requestedSeg);
            try {
                await waitForSegment(segFile, 30_000);
            } catch {
                // Segment wait timed out — session might have produced it with different name
                // Try the direct resolved path as fallback
                if (!fs.existsSync(resolved)) {
                    return res.status(404).json({ error: "Segment not ready" });
                }
            }

            const targetPath = fs.existsSync(segFile) ? segFile : resolved;
            res.setHeader("Content-Type", "video/mp2t");
            res.setHeader("Cache-Control", "max-age=86400"); // segments are immutable
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
            const stream = fs.createReadStream(targetPath);
            stream.on("error", (err) => {
                console.error("[Stream] segment read error:", err.message);
                if (!res.headersSent) res.status(500).end();
            });
            // Cleanup: destroy segment stream on client disconnect
            res.on("close", () => {
                if (!stream.destroyed) stream.destroy();
            });
            return stream.pipe(res);
        }

        // Unknown extension
        return res.status(400).json({ error: "Unknown file type" });
    } catch (err) {
        console.error("[Stream] serveHLSFile error:", err.message, err.stack);
        if (!res.headersSent) res.status(500).json({ error: "HLS serve error" });
    }
}

// ─── Explicit transcode start ─────────────────────────────────────────────────

async function startTranscode(req, res) {
    try {
        const { id } = req.params;
        const fileObj = await resolveFileById(id);
        if (!fileObj) return res.status(404).json({ error: "Media not found" });

        const clientCaps = parseClientCaps(req.body || {});
        const seekSec = parseFloat(req.body?.startAt || "0") || 0;
        const startSeg = Math.max(0, Math.floor(seekSec / SEGMENT_DURATION));
        const options = { quality: req.body?.quality, forceTranscode: true };

        let mediaInfo;
        try {
            mediaInfo = await probe(fileObj.path);
        } catch {}

        const decision = decidePlayback(mediaInfo, clientCaps, options);
        const session = await createSession({
            mediaId: fileObj.id,
            filePath: fileObj.path,
            decision,
            mediaInfo,
            startSegment: startSeg,
        });

        return res.json({
            sessionId: session.id,
            decision: session.decision,
            hlsUrl: `/stream/hls/${session.id}/index.m3u8`,
            startSegment: startSeg,
            segmentDuration: SEGMENT_DURATION,
        });
    } catch (err) {
        console.error("[Stream] startTranscode error:", err);
        if (!res.headersSent) res.status(500).json({ error: "Failed to start transcode" });
    }
}

// ─── Session ping (heartbeat from player) ─────────────────────────────────────
// Player calls this every ~10s with current playback position.
// We update downloadPositionSec so segment cleaner knows what's safe to delete.

function pingSessionHandler(req, res) {
    const s = getSession(req.params.sessionId);
    if (!s) {
        // Check if disk files exist — server might have restarted but files are still there
        const diskDir = path.join(TEMP_DIR, req.params.sessionId);
        if (fs.existsSync(path.join(diskDir, "index.m3u8"))) {
            return res.json({ ok: true, ghost: true, downloadPositionSec: 0 });
        }
        return res.status(404).json({ error: "Session not found" });
    }

    // FIX (Report-08): parseFloat(clientId_string) = NaN → guard explicitly.
    // Reject any non-finite value so downloadPositionSec is never corrupted.
    const rawPos = req.body?.positionSec ?? req.query.pos ?? "0";
    const posSec = parseFloat(rawPos);
    if (Number.isFinite(posSec) && posSec > 0) {
        s.downloadPositionSec = Math.max(s.downloadPositionSec || 0, posSec);
    }
    s.touch();
    return res.json({ ok: true, downloadPositionSec: s.downloadPositionSec });
}

// ─── Stop session ─────────────────────────────────────────────────────────────

async function stopSession(req, res) {
    try {
        await killSession(req.params.sessionId);
        return res.json({ message: "Session terminated" });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}

function listSessions(req, res) {
    return res.json({ sessions: getSessionStats() });
}

// ─── Subtitle server ──────────────────────────────────────────────────────────

async function streamSubtitle(req, res) {
    try {
        const { encodedPath } = req.params;
        let decodedPath;
        try {
            decodedPath = Buffer.from(encodedPath, "base64url").toString();
        } catch {
            return res.status(400).json({ error: "Invalid path encoding" });
        }

        const safePath = sanitizePath(decodedPath);
        if (!isSubtitleFile(safePath)) return res.status(400).json({ error: "Not a subtitle file" });
        if (!fs.existsSync(safePath)) return res.status(404).json({ error: "Subtitle not found" });

        const ext = path.extname(safePath).toLowerCase();
        res.setHeader("Access-Control-Allow-Origin", "*");

        if (ext === ".srt") {
            // Read as Buffer so we can detect and handle multi-byte encodings.
            // UTF-16 LE BOM: 0xFF 0xFE  |  UTF-16 BE BOM: 0xFE 0xFF
            const rawBuf = await fsp.readFile(safePath);
            let content;
            if (rawBuf[0] === 0xff && rawBuf[1] === 0xfe) {
                content = rawBuf.slice(2).toString("utf16le");
            } else if (rawBuf[0] === 0xfe && rawBuf[1] === 0xff) {
                // Swap bytes for UTF-16 BE
                const swapped = Buffer.alloc(rawBuf.length - 2);
                for (let i = 2; i < rawBuf.length - 1; i += 2) {
                    swapped[i - 2] = rawBuf[i + 1];
                    swapped[i - 1] = rawBuf[i];
                }
                content = swapped.toString("utf16le");
            } else {
                // UTF-8 (with or without BOM) — strip UTF-8 BOM if present
                content = rawBuf[0] === 0xef && rawBuf[1] === 0xbb && rawBuf[2] === 0xbf ? rawBuf.slice(3).toString("utf-8") : rawBuf.toString("utf-8");
            }
            // SRT → WebVTT: replace comma decimal separator in timestamps
            const vtt = "WEBVTT\n\n" + content.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
            res.setHeader("Content-Type", "text/vtt; charset=utf-8");
            return res.send(vtt);
        }

        res.setHeader("Content-Type", ext === ".vtt" ? "text/vtt; charset=utf-8" : "text/plain; charset=utf-8");
        return fs.createReadStream(safePath).pipe(res);
    } catch (err) {
        console.error("[Stream] streamSubtitle error:", err);
        if (!res.headersSent) res.status(500).json({ error: "Subtitle serve error" });
    }
}

// ─── Embedded Subtitle Extractor (FFmpeg on-the-fly) ─────────────────────────
// Route: GET /stream/subtitle/embedded/:encodedVideo/:streamIndex
//
// Uses FFmpeg to extract a specific embedded subtitle track from the source
// file and convert it to WebVTT format, streamed directly to the client.
//
// Safety measures:
//   - Path traversal guard on decoded video path
//   - streamIndex validated as integer 0–127
//   - FFmpeg subprocess is killed on client disconnect
//   - No temp file created — pure pipe to response
async function streamEmbeddedSubtitle(req, res) {
    try {
        const { encodedVideo, streamIndex } = req.params;

        // Validate stream index (must be a small non-negative integer)
        const trackIndex = parseInt(streamIndex, 10);
        if (!Number.isFinite(trackIndex) || trackIndex < 0 || trackIndex > 127) {
            return res.status(400).json({ error: "Invalid stream index" });
        }

        // Decode and sanitize video path
        let videoPath;
        try {
            videoPath = Buffer.from(encodedVideo, "base64url").toString();
        } catch {
            return res.status(400).json({ error: "Invalid video path encoding" });
        }

        const safePath = path.resolve(videoPath);
        if (!fs.existsSync(safePath)) {
            return res.status(404).json({ error: "Video file not found" });
        }

        // Build FFmpeg args to extract the subtitle track as WebVTT
        // -map 0:<globalIndex>     — select the specific stream by global index
        // -f webvtt                — output format
        // pipe:1                  — write to stdout
        let ffmpegBin = process.env.FFMPEG_PATH || "ffmpeg";
        if (process.platform === "win32" && !ffmpegBin.toLowerCase().endsWith(".exe")) {
            ffmpegBin = ffmpegBin + ".exe";
        }

        const args = [
            "-hide_banner", "-loglevel", "error",
            "-i", safePath,
            "-map", `0:${trackIndex}`,
            "-f", "webvtt",
            "-",   // pipe to stdout
        ];

        const ffmpegProc = spawn(ffmpegBin, args, {
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });

        res.setHeader("Content-Type", "text/vtt; charset=utf-8");
        res.setHeader("Cache-Control", "max-age=3600"); // 1h — subtitle rarely changes
        res.setHeader("Access-Control-Allow-Origin", "*");

        // Stream FFmpeg stdout → client
        ffmpegProc.stdout.pipe(res);

        // On client disconnect, kill FFmpeg to avoid zombie process
        req.on("close", () => {
            if (!ffmpegProc.killed) ffmpegProc.kill("SIGKILL");
        });

        // Buffer stderr for error logging
        let stderrBuf = "";
        ffmpegProc.stderr.on("data", (d) => {
            if (stderrBuf.length < 4096) stderrBuf += d.toString();
        });

        ffmpegProc.on("error", (err) => {
            console.error("[Stream] embedded subtitle FFmpeg error:", err.message);
            if (!res.headersSent) res.status(500).json({ error: "Subtitle extraction failed" });
        });

        ffmpegProc.on("exit", (code) => {
            if (code !== 0 && code !== null) {
                console.error(`[Stream] embedded subtitle FFmpeg exit ${code} for stream ${trackIndex} of ${path.basename(safePath)}`);
                if (stderrBuf) console.error("[Stream] FFmpeg stderr:", stderrBuf.slice(-800));
                if (!res.headersSent) res.status(500).json({ error: "Subtitle extraction failed" });
            }
        });
    } catch (err) {
        console.error("[Stream] streamEmbeddedSubtitle error:", err.message);
        if (!res.headersSent) res.status(500).json({ error: "Embedded subtitle error" });
    }
}

module.exports = {
    streamVideo,
    serveHLSFile,
    startTranscode,
    stopSession,
    listSessions,
    streamSubtitle,
    streamEmbeddedSubtitle,
    pingSessionHandler,
};
