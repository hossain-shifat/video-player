"use strict";

const fs = require("fs");
const { readFolders } = require("./libraryController");
const { findById } = require("../utils/mediaCache");
const { extractFrame } = require("../utils/ffmpegThumbnail");

const VALID_CLIENT_RE = /^[A-Za-z0-9_-]+$/;

// <img> tags can't set custom headers, so clientId comes from query param
// here (header still checked first for parity with the history routes).
function getClientId(req) {
    const raw = req.headers["x-flux-client"] || req.query.clientId || "default";
    return VALID_CLIENT_RE.test(raw) ? raw : "default";
}

/**
 * GET /api/media/:id/thumbnail?time=123&clientId=xyz
 *
 * Per spec #3: only `position` ever gets written to history.json during
 * playback — no images saved on every ping. This route is hit lazily by
 * the history card's <img src>, and only THEN does ffmpeg pull a single
 * frame from the real source file on disk and cache it (overwriting the
 * previous frame for this clientId+mediaId).
 */
async function getThumbnail(req, res) {
    try {
        const { id } = req.params;
        const clientId = getClientId(req);
        const time = parseFloat(req.query.time);

        const folders = await readFolders();
        const file = await findById(folders, id);
        if (!file) return res.status(404).json({ error: "Media not found" });

        const cachePath = await extractFrame({
            sourcePath: file.path,
            mediaId: id,
            clientId,
            time: Number.isFinite(time) ? time : 0,
        });

        res.setHeader("Content-Type", "image/jpeg");
        res.setHeader("Cache-Control", "private, max-age=300");
        const stream = fs.createReadStream(cachePath);
        stream.on("error", () => {
            if (!res.headersSent) res.status(500).json({ error: "Failed to stream thumbnail" });
        });
        stream.pipe(res);
    } catch (err) {
        console.error("[Thumbnail] getThumbnail error:", err.message);
        if (!res.headersSent) res.status(500).json({ error: "Failed to generate thumbnail" });
    }
}

module.exports = { getThumbnail };
