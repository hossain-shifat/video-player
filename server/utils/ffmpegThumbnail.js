"use strict";

const path = require("path");
const fs = require("fs");
const ffmpeg = require("fluent-ffmpeg");

const CACHE_DIR = path.join(__dirname, "..", "data", "thumbnails");
fs.mkdirSync(CACHE_DIR, { recursive: true });

// In-flight dedup — two near-simultaneous requests for the same clientId+mediaId
// (e.g. two <img> retries) shouldn't spawn two ffmpeg processes writing the
// same output file at once.
const inFlight = new Map();

function cachePaths(clientId, mediaId) {
    const base = `thumb_${clientId}_${mediaId}`;
    return {
        jpg: path.join(CACHE_DIR, `${base}.jpg`),
        meta: path.join(CACHE_DIR, `${base}.json`), // tracks which timestamp is currently cached
    };
}

function readMeta(metaPath) {
    try {
        return JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    } catch {
        return null;
    }
}

function writeMeta(metaPath, data) {
    try {
        fs.writeFileSync(metaPath, JSON.stringify(data), "utf-8");
    } catch {
        // non-fatal — worst case we just re-extract next request
    }
}

/**
 * Returns the path to a cached (or freshly-extracted) JPEG frame for
 * clientId+mediaId at `time` seconds.
 *
 * - Time is rounded to the nearest second so normal multi-second resume
 *   pings don't force a re-extract every single request — only an actual
 *   moved position does.
 * - Same on-disk file is overwritten in place each time the timestamp
 *   changes → exactly ONE frame cached per clientId+mediaId, ever. No
 *   sprite sheets, no growing disk usage, no orphan cleanup needed.
 */
async function extractFrame({ sourcePath, mediaId, clientId, time }) {
    const { jpg, meta } = cachePaths(clientId, mediaId);
    const roundedTime = Math.max(0, Math.round(time || 0));

    const cached = readMeta(meta);
    if (cached && cached.time === roundedTime && fs.existsSync(jpg)) {
        return jpg;
    }

    const key = `${clientId}:${mediaId}`;
    if (inFlight.has(key)) {
        await inFlight.get(key).catch(() => {});
        if (fs.existsSync(jpg)) return jpg;
    }

    const job = new Promise((resolve, reject) => {
        ffmpeg(sourcePath)
            .on("end", () => {
                writeMeta(meta, { time: roundedTime });
                resolve();
            })
            .on("error", (err) => reject(err))
            .screenshots({
                timestamps: [roundedTime],
                filename: path.basename(jpg),
                folder: CACHE_DIR,
                size: "480x270",
            });
    });

    inFlight.set(key, job);
    try {
        await job;
    } finally {
        inFlight.delete(key);
    }
    return jpg;
}

module.exports = { extractFrame };
