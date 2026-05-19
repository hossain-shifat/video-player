"use strict";

/**
 * hwAccel.js
 * Detects available FFmpeg hardware acceleration on the host.
 * Priority: Intel QSV > VAAPI > NVIDIA NVENC > CPU
 *
 * Results are cached after first detection to avoid repeated subprocess calls.
 */

const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

// ─── Constants ────────────────────────────────────────────────────────────────

const CACHE_FILE = path.join(__dirname, "../data/hwaccel_cache.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

let _cached = null;

/**
 * Hardware acceleration profile
 * @typedef {object} HWAccelProfile
 * @property {"qsv"|"vaapi"|"nvenc"|"cpu"} type
 * @property {string} decodeFlag     - FFmpeg decode hw_accel option
 * @property {string} encodeCodecH264 - FFmpeg encoder for H264
 * @property {string} encodeCodecH265 - FFmpeg encoder for H265
 * @property {string|null} hwDevice   - FFmpeg -hwaccel_device path
 * @property {boolean} supported
 */

const PROFILES = {
    qsv: {
        type: "qsv",
        decodeFlag: "qsv",
        encodeCodecH264: "h264_qsv",
        encodeCodecH265: "hevc_qsv",
        hwDevice: null,
        supported: false,
    },
    vaapi: {
        type: "vaapi",
        decodeFlag: "vaapi",
        encodeCodecH264: "h264_vaapi",
        encodeCodecH265: "hevc_vaapi",
        hwDevice: "/dev/dri/renderD128",
        supported: false,
    },
    nvenc: {
        type: "nvenc",
        decodeFlag: "cuda",
        encodeCodecH264: "h264_nvenc",
        encodeCodecH265: "hevc_nvenc",
        hwDevice: null,
        supported: false,
    },
    cpu: {
        type: "cpu",
        decodeFlag: null,
        encodeCodecH264: "libx264",
        encodeCodecH265: "libx265",
        hwDevice: null,
        supported: true,
    },
};

// ─── Detection Helpers ────────────────────────────────────────────────────────

function runFFmpeg(args) {
    return new Promise((resolve, reject) => {
        execFile("ffmpeg", args, { timeout: 10_000 }, (err, stdout, stderr) => {
            if (err) reject(err);
            else resolve(stdout + stderr);
        });
    });
}

async function checkQSV() {
    try {
        // Check if /dev/dri exists (Linux) or try Windows
        if (process.platform === "win32") {
            // On Windows, QSV usually available if Intel GPU present
            await runFFmpeg(["-hwaccel", "qsv", "-f", "lavfi", "-i", "nullsrc=s=64x64:d=0.1", "-vframes", "1", "-f", "null", "-"]);
            return true;
        }
        const hasDri = fs.existsSync("/dev/dri/renderD128");
        if (!hasDri) return false;
        await runFFmpeg(["-hwaccel", "qsv", "-f", "lavfi", "-i", "nullsrc=s=64x64:d=0.1", "-vframes", "1", "-f", "null", "-"]);
        return true;
    } catch {
        return false;
    }
}

async function checkVAAPI() {
    try {
        if (process.platform !== "linux") return false;
        if (!fs.existsSync("/dev/dri/renderD128")) return false;
        await runFFmpeg(["-hwaccel", "vaapi", "-hwaccel_device", "/dev/dri/renderD128", "-f", "lavfi", "-i", "nullsrc=s=64x64:d=0.1", "-vframes", "1", "-f", "null", "-"]);
        return true;
    } catch {
        return false;
    }
}

async function checkNVENC() {
    try {
        await runFFmpeg(["-f", "lavfi", "-i", "nullsrc=s=64x64:d=0.1", "-vframes", "1", "-c:v", "h264_nvenc", "-f", "null", "-"]);
        return true;
    } catch {
        return false;
    }
}

// ─── Load / Save Cache ────────────────────────────────────────────────────────

function loadCache() {
    try {
        const raw = fs.readFileSync(CACHE_FILE, "utf-8");
        const obj = JSON.parse(raw);
        if (Date.now() - obj.detectedAt < CACHE_TTL_MS) return obj.profile;
    } catch {}
    return null;
}

function saveCache(profile) {
    try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify({ detectedAt: Date.now(), profile }, null, 2));
    } catch {}
}

// ─── Main Detection ───────────────────────────────────────────────────────────

/**
 * detect() — returns the best available HWAccelProfile.
 * Result is cached in memory and on disk.
 */
async function detect() {
    if (_cached) return _cached;

    const fromDisk = loadCache();
    if (fromDisk) {
        _cached = fromDisk;
        console.log(`[HWAccel] Using cached profile: ${_cached.type}`);
        return _cached;
    }

    console.log("[HWAccel] Detecting hardware acceleration...");

    // Override via env
    const envOverride = process.env.HWACCEL;
    if (envOverride && PROFILES[envOverride]) {
        _cached = { ...PROFILES[envOverride], supported: true };
        console.log(`[HWAccel] Env override: ${envOverride}`);
        saveCache(_cached);
        return _cached;
    }

    if (await checkQSV()) {
        _cached = { ...PROFILES.qsv, supported: true };
        console.log("[HWAccel] Intel QuickSync detected");
    } else if (await checkVAAPI()) {
        _cached = { ...PROFILES.vaapi, supported: true };
        console.log("[HWAccel] VAAPI detected");
    } else if (await checkNVENC()) {
        _cached = { ...PROFILES.nvenc, supported: true };
        console.log("[HWAccel] NVIDIA NVENC detected");
    } else {
        _cached = { ...PROFILES.cpu, supported: true };
        console.log("[HWAccel] CPU encoding (no hardware acceleration)");
    }

    saveCache(_cached);
    return _cached;
}

/**
 * invalidate() — force re-detection on next call.
 */
function invalidate() {
    _cached = null;
    try {
        fs.unlinkSync(CACHE_FILE);
    } catch {}
}

/**
 * getFFmpegHWArgs(profile, inputPath) — returns FFmpeg args for hw decode
 * @returns {string[]}
 */
function getFFmpegHWDecodeArgs(profile) {
    if (!profile || profile.type === "cpu") return [];
    if (profile.type === "vaapi") {
        return ["-hwaccel", "vaapi", "-hwaccel_device", profile.hwDevice, "-hwaccel_output_format", "vaapi"];
    }
    if (profile.type === "qsv") {
        return ["-hwaccel", "qsv", "-hwaccel_output_format", "qsv"];
    }
    if (profile.type === "nvenc") {
        return ["-hwaccel", "cuda", "-hwaccel_output_format", "cuda"];
    }
    return [];
}

module.exports = { detect, invalidate, getFFmpegHWDecodeArgs, PROFILES };
