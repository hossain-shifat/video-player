"use strict";

/**
 * ffprobe.js
 * Lightweight wrapper around ffprobe for extracting media stream info.
 * Results are cached in-memory per file path (LRU-style, max 200 entries).
 */

const { execFile } = require("child_process");
const { extractMediaInfo } = require("./streamingEngine");

const CACHE_MAX = 200;
const cache = new Map(); // path → { data, ts }
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

function probe(filePath) {
    const now = Date.now();
    const hit = cache.get(filePath);
    if (hit && now - hit.ts < CACHE_TTL_MS) return Promise.resolve(hit.data);

    return new Promise((resolve, reject) => {
        // Derive ffprobe path from FFPROBE_PATH, FFMPEG_PATH (s/ffmpeg/ffprobe/), or bare "ffprobe"
        let ffprobeBin = process.env.FFPROBE_PATH || process.env.FFMPEG_PATH?.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1") || "ffprobe";
        // On Windows, ensure .exe extension for spawn() to resolve the binary
        if (process.platform === "win32" && !ffprobeBin.toLowerCase().endsWith(".exe")) {
            ffprobeBin = ffprobeBin + ".exe";
        }
        execFile(ffprobeBin, ["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", filePath], { timeout: 20_000, windowsHide: true }, (err, stdout) => {
            if (err) return reject(new Error(`ffprobe failed: ${err.message}`));
            let raw;
            try {
                raw = JSON.parse(stdout);
            } catch {
                return reject(new Error("ffprobe JSON parse error"));
            }
            const info = extractMediaInfo(raw);

            // LRU eviction
            if (cache.size >= CACHE_MAX) {
                const firstKey = cache.keys().next().value;
                cache.delete(firstKey);
            }
            cache.set(filePath, { data: info, ts: now });
            resolve(info);
        });
    });
}

function invalidate(filePath) {
    cache.delete(filePath);
}

module.exports = { probe, invalidate };
