"use strict";

const fs = require("fs");
const path = require("path");
const mime = require("mime-types");
const { readFolders } = require("./libraryController");
const { scanFolder } = require("../utils/scanner");
const { sanitizePath, isSubtitleFile } = require("../utils/fileHelpers");
const mediaCache = require("../utils/mediaCache");

/**
 * Resolve a file object for the given id.
 *
 * Strategy (cache-first):
 *  1. Return immediately if the id is already in the in-memory cache.
 *  2. On a cache miss, scan each library folder one at a time, update the
 *     cache after every scan, and stop as soon as the id is found.
 *     This avoids scanning every folder on every request while still
 *     handling files that were added after the process started.
 *
 * @param {string} id
 * @returns {Promise<object|null>}
 */
async function resolveFileById(id) {
    // 1. Fast path — cache hit
    const cached = mediaCache.getFileById(id);
    if (cached) return cached;

    // 2. Slow path — targeted scan, folder by folder, stop early
    const folders = await readFolders();
    for (const folder of folders) {
        let files;
        try {
            files = await scanFolder(folder.path);
        } catch (err) {
            console.error(`[resolveFileById] Failed to scan folder "${folder.path}":`, err.message);
            continue;
        }

        // Populate cache with everything found in this folder
        mediaCache.updateFromFiles(files);

        const found = files.find((f) => f.id === id);
        if (found) return found;
    }

    return null;
}

// ---------------------------------------------------------------------------
// Streams a video file by its ID, supporting HTTP range requests (206 Partial Content)
// ---------------------------------------------------------------------------
async function streamVideo(req, res) {
    try {
        const { id } = req.params;

        const targetFile = await resolveFileById(id);

        if (!targetFile) {
            return res.status(404).json({ error: "Media not found" });
        }

        const filePath = targetFile.path;
        let stat;
        try {
            stat = await fs.promises.stat(filePath);
        } catch {
            return res.status(404).json({ error: "File not found on disk" });
        }

        const fileSize = stat.size;
        const contentType = mime.lookup(filePath) || "video/mp4";
        const rangeHeader = req.headers["range"];

        // HEAD request — return headers only, no body
        if (req.method === "HEAD") {
            res.setHeader("Content-Type", contentType);
            res.setHeader("Accept-Ranges", "bytes");
            res.setHeader("Content-Length", fileSize);
            return res.status(200).end();
        }

        if (rangeHeader) {
            // Partial content (Range request)
            const parts = rangeHeader.replace(/bytes=/, "").split("-");

            const send416 = () => {
                res.setHeader("Content-Range", `bytes */${fileSize}`);
                return res.status(416).json({ error: "Range Not Satisfiable" });
            };

            // parts[0] must be a non-empty string that parses to a finite integer
            const start = parseInt(parts[0], 10);
            if (!Number.isFinite(start) || start < 0) return send416();

            // parts[1]: absent/empty → last byte of file; otherwise must be a finite integer
            const endRaw = parts.length > 1 ? parts[1] : "";
            const end = endRaw !== "" ? parseInt(endRaw, 10) : fileSize - 1;
            if (!Number.isFinite(end)) return send416();

            // Logical ordering and file-bounds checks
            if (start > end || start >= fileSize || end >= fileSize) return send416();

            const chunkSize = end - start + 1;

            res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
            res.setHeader("Accept-Ranges", "bytes");
            res.setHeader("Content-Length", chunkSize);
            res.setHeader("Content-Type", contentType);
            res.status(206);

            const stream = fs.createReadStream(filePath, { start, end });
            stream.on("error", (err) => {
                console.error("[Stream] Stream error:", err);
                if (!res.headersSent) {
                    res.status(500).json({ error: "Stream error" });
                } else {
                    stream.destroy();
                }
            });
            stream.pipe(res);
        } else {
            // Full file response
            res.setHeader("Content-Type", contentType);
            res.setHeader("Accept-Ranges", "bytes");
            res.setHeader("Content-Length", fileSize);
            res.status(200);

            const stream = fs.createReadStream(filePath);
            stream.on("error", (err) => {
                console.error("[Stream] Stream error:", err);
                if (!res.headersSent) {
                    res.status(500).json({ error: "Stream error" });
                } else {
                    stream.destroy();
                }
            });
            stream.pipe(res);
        }
    } catch (err) {
        console.error("[Stream] streamVideo error:", err);
        if (!res.headersSent) {
            res.status(500).json({ error: "Failed to stream video" });
        }
    }
}

// ---------------------------------------------------------------------------
// Serves a subtitle file by its base64url-encoded path,
// converting .srt to WebVTT on the fly
// ---------------------------------------------------------------------------
async function streamSubtitle(req, res) {
    try {
        const { encodedPath } = req.params;

        let decodedPath;
        try {
            decodedPath = Buffer.from(encodedPath, "base64url").toString();
        } catch {
            return res.status(400).json({ error: "Invalid encoded path" });
        }

        const safePath = sanitizePath(decodedPath);

        if (!isSubtitleFile(safePath)) {
            return res.status(400).json({ error: "Not a subtitle file" });
        }

        if (!fs.existsSync(safePath)) {
            return res.status(404).json({ error: "Subtitle file not found" });
        }

        const ext = path.extname(safePath).toLowerCase();

        if (ext === ".srt") {
            // Convert SRT to WebVTT on the fly
            const content = await fs.promises.readFile(safePath, "utf-8");
            const vttContent = "WEBVTT\n\n" + content.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
            res.setHeader("Content-Type", "text/vtt; charset=utf-8");
            return res.send(vttContent);
        }

        if (ext === ".vtt") {
            res.setHeader("Content-Type", "text/vtt; charset=utf-8");
        } else {
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
        }

        const stream = fs.createReadStream(safePath);
        stream.on("error", (err) => {
            console.error("[Stream] Subtitle stream error:", err);
            if (!res.headersSent) res.status(500).json({ error: "Subtitle stream error" });
        });
        stream.pipe(res);
    } catch (err) {
        console.error("[Stream] streamSubtitle error:", err);
        if (!res.headersSent) {
            res.status(500).json({ error: "Failed to serve subtitle" });
        }
    }
}

module.exports = { streamVideo, streamSubtitle };
