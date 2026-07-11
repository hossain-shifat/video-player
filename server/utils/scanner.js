"use strict";

const fs = require("fs");
const path = require("path");
const { isVideoFile, generateFileId, formatFileSize } = require("./fileHelpers");
const { getMediaInfo } = require("./mediaInfoStore");

const MAX_DEPTH = 5;

// ─── Background mediaInfo (ffprobe) auto-probe queue ───────────────────────────
// Runs automatically as files are discovered by the scanner below — no
// separate scanner file needed. Fire-and-forget: never blocks or slows down
// the actual folder scan. Bounded concurrency so a big library scan doesn't
// spawn ffprobe for hundreds of files at once.
//
// getMediaInfo() itself is the cache check (backed by data/mediainfo.json),
// so files already probed on a previous scan are skipped near-instantly —
// this is cheap to call on every scan, not just the first one.
const MEDIAINFO_CONCURRENCY = parseInt(process.env.MEDIAINFO_SCAN_CONCURRENCY || "3", 10);
let _activeProbes = 0;
const _probeQueue = [];

function _drainProbeQueue() {
    while (_activeProbes < MEDIAINFO_CONCURRENCY && _probeQueue.length > 0) {
        const file = _probeQueue.shift();
        _activeProbes++;
        getMediaInfo(file)
            .catch((err) => {
                console.error(`[Scanner] mediaInfo probe failed for "${file.name}": ${err.message}`);
            })
            .finally(() => {
                _activeProbes--;
                _drainProbeQueue();
            });
    }
}

// Enqueues a discovered file for background ffprobe — fire-and-forget,
// never awaited by the scanner, never slows down scanFolder().
function enqueueMediaInfoProbe(file) {
    _probeQueue.push(file);
    _drainProbeQueue();
}

// Scans a single folder recursively (up to MAX_DEPTH) and returns video file objects
async function scanFolder(folderPath, currentDepth = 0) {
    if (currentDepth > MAX_DEPTH) return [];

    let entries;
    try {
        entries = await fs.promises.readdir(folderPath, { withFileTypes: true });
    } catch (err) {
        console.warn(`[Scanner] Cannot read folder: ${folderPath} — ${err.message}`);
        return [];
    }

    const results = [];

    for (const entry of entries) {
        // Skip hidden files and folders
        if (entry.name.startsWith(".")) continue;

        const fullPath = path.join(folderPath, entry.name);

        if (entry.isDirectory()) {
            // Recurse into subdirectory
            const subFiles = await scanFolder(fullPath, currentDepth + 1);
            results.push(...subFiles);
        } else if (entry.isFile() && isVideoFile(entry.name)) {
            // Build file object for this video
            let stat;
            try {
                stat = await fs.promises.stat(fullPath);
            } catch (err) {
                console.warn(`[Scanner] Cannot stat file: ${fullPath} — ${err.message}`);
                continue;
            }

            const ext = path.extname(entry.name).toLowerCase();
            const nameWithoutExt = path.basename(entry.name, ext);
            const id = generateFileId(fullPath);

            // Real filesystem date — same thing Windows Explorer's "Date"
            // column shows. birthtime = file creation date (what NTFS tracks
            // and what your screenshot is showing); falls back to mtime
            // (last modified) on filesystems/OSes where birthtime isn't
            // reliably populated (some Linux/network filesystems report it
            // as epoch 0). This is the file's REAL add date, not "whenever
            // TMDB metadata happened to be fetched."
            const addedAt = (stat.birthtime && stat.birthtime.getTime() > 0 ? stat.birthtime : stat.mtime).toISOString();

            const fileObj = {
                id,
                path: fullPath,
                name: nameWithoutExt,
                size: formatFileSize(stat.size),
                sizeBytes: stat.size,
                addedAt,
                streamUrl: `/stream/video/${id}`,
            };

            results.push(fileObj);

            // Auto-generate mediaInfo (ffprobe) in the background for this
            // file. Fire-and-forget — does not slow down this scan. Cached
            // ONLY in server/data/mediainfo.json (see ffprobeService.js —
            // no more sidecar files written into your media folders).
            enqueueMediaInfoProbe(fileObj);
        }
    }

    return results;
}

module.exports = { scanFolder };
