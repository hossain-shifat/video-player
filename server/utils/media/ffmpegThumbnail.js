"use strict";

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const ffmpeg = require("fluent-ffmpeg");
const { parseFilename } = require("../../metadata/nameParser");

// data/media/thumbnails/<Title (Year)>/<Title (Year)>__<id8>__<clientId>.jpg  (+ .json with title/file/time)
// One folder per movie / episode, readable names. <id8> keeps two different files with the same title apart.
const CACHE_DIR = path.join(__dirname, "..", "..", "data", "media", "thumbnails");
fs.mkdirSync(CACHE_DIR, { recursive: true });

// In-flight dedup — two near-simultaneous requests for the same clientId+mediaId
// (e.g. two <img> retries) shouldn't spawn two ffmpeg processes writing the
// same output file at once.
const inFlight = new Map();

// Windows-safe folder/file segment. "%" is stripped too: fluent-ffmpeg treats it as a filename token.
function safeSegment(s) {
    const cleaned = String(s)
        .replace(/[<>:"/\\|?*%\x00-\x1f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 60)
        .replace(/[. ]+$/, "");
    return cleaned || "Unknown";
}

// "Interstellar (2014)", "Breaking Bad S01E02" — falls back to the raw file name if the parser finds nothing.
function movieLabel(sourcePath) {
    const file = path.basename(sourcePath || "");
    let label = "";
    try {
        const p = parseFilename(file);
        if (p && p.title) {
            label = p.title;
            if (p.year) label += ` (${p.year})`;
            if (p.season != null && p.episode != null) label += ` S${String(p.season).padStart(2, "0")}E${String(p.episode).padStart(2, "0")}`;
        }
    } catch {
        /* fall through to file name */
    }
    if (!label) label = path.basename(file, path.extname(file));
    return safeSegment(label);
}

function cachePaths(clientId, mediaId, sourcePath) {
    const label = movieLabel(sourcePath);
    const id8 = crypto.createHash("sha1").update(String(mediaId)).digest("hex").slice(0, 8);
    const dir = path.join(CACHE_DIR, label);
    const base = `${label}__${id8}__${clientId}`;
    return {
        label,
        dir,
        jpg: path.join(dir, `${base}.jpg`),
        meta: path.join(dir, `${base}.json`), // tracks which timestamp is currently cached
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
    const { jpg, meta, dir, label } = cachePaths(clientId, mediaId, sourcePath);
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

    fs.mkdirSync(dir, { recursive: true });

    const job = new Promise((resolve, reject) => {
        ffmpeg(sourcePath)
            .on("end", () => {
                writeMeta(meta, { time: roundedTime, title: label, file: path.basename(sourcePath || ""), mediaId });
                resolve();
            })
            .on("error", (err) => reject(err))
            .screenshots({
                timestamps: [roundedTime],
                filename: path.basename(jpg),
                folder: dir,
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

module.exports = { extractFrame, _cachePaths: cachePaths };
