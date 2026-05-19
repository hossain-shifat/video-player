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

const { readFolders } = require("./libraryController");
const { scanFolder } = require("../utils/scanner");
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

// Cache ffprobe duration so range requests don't re-probe
const durationCache = new Map();

async function getDuration(filePath) {
    if (durationCache.has(filePath)) return durationCache.get(filePath);
    try {
        const info = await probe(filePath);
        if (info?.duration > 0) {
            durationCache.set(filePath, info.duration);
            return info.duration;
        }
    } catch {}
    return null;
}

// ─── File resolver ────────────────────────────────────────────────────────────

async function resolveFileById(id) {
    const cached = mediaCache.getFileById(id);
    if (cached) return cached;
    const folders = await readFolders();
    for (const folder of folders) {
        let files;
        try {
            files = await scanFolder(folder.path);
        } catch {
            continue;
        }
        mediaCache.updateFromFiles(files);
        const found = files.find((f) => f.id === id);
        if (found) return found;
    }
    return null;
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
        return stream.pipe(res);
    }

    res.setHeader("Content-Length", fileSize);
    res.status(200);
    const stream = fs.createReadStream(filePath);
    stream.on("error", (err) => {
        console.error("[Stream] full error:", err.message);
        if (!res.headersSent) res.status(500).end();
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
        await waitForM3U8(session.m3u8Path, 20_000);
    } catch {
        await session.kill();
        return res.status(504).json({ error: "Transcoder startup timeout" });
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
        if (!session) return res.status(404).json({ error: "Session not found or expired" });

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
            const content = await fsp.readFile(resolved);
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
            const currentIdx = getCurrentSegmentIndex(session.sessionDir);

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
    if (!s) return res.status(404).json({ error: "Session not found" });

    const posSec = parseFloat(req.body?.positionSec || req.query.pos || "0");
    if (posSec > 0) {
        s.downloadPositionSec = Math.max(s.downloadPositionSec || 0, posSec);
    }
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
            const content = await fsp.readFile(safePath, "utf-8");
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

module.exports = {
    streamVideo,
    serveHLSFile,
    startTranscode,
    stopSession,
    listSessions,
    streamSubtitle,
    pingSessionHandler,
};
