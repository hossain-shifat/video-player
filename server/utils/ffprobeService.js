"use strict";

const { execFile } = require("child_process");
const { promisify } = require("util");
const path = require("path");
const fs = require("fs");

const execFileAsync = promisify(execFile);

// Override with FFPROBE_PATH env var if ffprobe isn't on PATH.
const FFPROBE_PATH = process.env.FFPROBE_PATH || "ffprobe";

// Finite timeout for a single ffprobe run. Without this, a corrupt/truncated
// file or a network-mounted path that stalls mid-read can hang the probe
// indefinitely — since scanner.js runs probes through a bounded concurrency
// queue (MEDIAINFO_SCAN_CONCURRENCY, default 3), one stuck probe permanently
// occupies one of those slots and slows every file behind it. Overridable via
// FFPROBE_TIMEOUT_MS env var.
const FFPROBE_TIMEOUT_MS = parseInt(process.env.FFPROBE_TIMEOUT_MS || "30000", 10);

// Run once at module load — tells you IMMEDIATELY on server start whether
// ffprobe is even reachable, instead of finding out on the first request.
let _checked = false;
async function checkFfprobe() {
    if (_checked) return;
    _checked = true;
    try {
        const { stdout } = await execFileAsync(FFPROBE_PATH, ["-version"]);
        console.log(`[FFprobe] OK — using "${FFPROBE_PATH}" → ${stdout.split("\n")[0]}`);
    } catch (err) {
        console.error(`[FFprobe] ⚠ NOT WORKING — "${FFPROBE_PATH}" failed: ${err.message}`);
        console.error(`[FFprobe] ⚠ Fix: install ffmpeg (includes ffprobe) or set FFPROBE_PATH in .env to the full exe path.`);
    }
}
checkFfprobe();

/**
 * createMediaInfoCache(videoPath)
 * Runs ffprobe -v error -show_format -show_streams -print_format json "videoPath"
 * and returns the parsed JSON directly.
 *
 * NOTE: this does NOT write anything to disk next to the video anymore.
 * The ONLY place ffprobe data is persisted is the central
 * server/data/mediainfo.json store (see mediaInfoStore.js) — no more
 * mediainfo.json sidecar files scattered across your media folders.
 *
 * Never throws — logs loudly and resolves null on any failure, including
 * a timeout (which frees the scanner's probe slot instead of holding it open).
 */
async function createMediaInfoCache(videoPath) {
    if (!videoPath || typeof videoPath !== "string") {
        console.error("[FFprobe] createMediaInfoCache: videoPath is required");
        return null;
    }

    const absPath = path.resolve(videoPath);

    // Verify the video file actually exists before spending time on ffprobe
    try {
        await fs.promises.access(absPath, fs.constants.R_OK);
    } catch {
        console.error(`[FFprobe] Video file not readable / does not exist: "${absPath}"`);
        return null;
    }

    console.log(`[FFprobe] Probing: "${absPath}"`);

    let stdout, stderr;
    try {
        const result = await execFileAsync(FFPROBE_PATH, ["-v", "error", "-show_format", "-show_streams", "-print_format", "json", absPath], {
            maxBuffer: 1024 * 1024 * 20,
            timeout: FFPROBE_TIMEOUT_MS,
        });
        stdout = result.stdout;
        stderr = result.stderr;
        if (stderr) console.warn(`[FFprobe] stderr for "${absPath}": ${stderr}`);
    } catch (err) {
        // err.killed + err.signal set when Node's own `timeout` option fired —
        // distinct from ffprobe itself failing, so log it clearly rather than
        // lumping it in with a generic probe failure.
        if (err.killed) {
            console.error(`[FFprobe] ⏱ Probe TIMED OUT after ${FFPROBE_TIMEOUT_MS}ms for "${absPath}" — file may be corrupt, truncated, or on a stalled network mount.`);
            return null;
        }
        console.error(`[FFprobe] ❌ Probe FAILED for "${absPath}"`);
        console.error(`[FFprobe]    command: ${FFPROBE_PATH} -v error -show_format -show_streams -print_format json "${absPath}"`);
        console.error(`[FFprobe]    error: ${err.message}`);
        if (err.code === "ENOENT") {
            console.error(`[FFprobe]    → "${FFPROBE_PATH}" was not found. Set FFPROBE_PATH in .env or install ffmpeg.`);
        }
        return null;
    }

    let parsed;
    try {
        parsed = JSON.parse(stdout);
    } catch (err) {
        console.error(`[FFprobe] Failed to parse ffprobe JSON output for "${absPath}": ${err.message}`);
        console.error(`[FFprobe] raw stdout was: ${stdout?.slice(0, 300)}`);
        return null;
    }

    if (!parsed.format && !parsed.streams) {
        console.error(`[FFprobe] ⚠ ffprobe returned empty result for "${absPath}" — file may be corrupt`);
        return null;
    }

    return parsed;
}

module.exports = { createMediaInfoCache, checkFfprobe };
