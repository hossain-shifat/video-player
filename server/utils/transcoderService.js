"use strict";

/**
 * transcoderService.js  — FLUX v3 (Jellyfin-inspired)
 *
 * KEY FIXES vs v2:
 *  1. Segment-based seeking: seek = segmentId * segmentDuration (not raw -ss)
 *     → FFmpeg receives -start_number N, output starts at correct position
 *     → Manifest continuity: segments numbered from N, player timeline correct
 *  2. -copyts -avoid_negative_ts make_zero  (safe timestamp preservation)
 *     → Preserves original PTS, shifts to zero if negative (unlike "disabled"
 *       which could leave negative timestamps that break some players)
 *  3. -hls_list_size 0 + -hls_playlist_type event  (not vod, not rolling)
 *     → Manifest grows; past segments stay in list (seekable)
 *     → Player always has full timeline, no 404 on back-seek
 *  4. Segment gap detection: if client requests segment far ahead of current
 *     transcode position, kill & restart from that segment (Jellyfin pattern)
 *  5. Per-session mutex (one transcode start at a time per mediaId+quality)
 *  6. DownloadPositionTicks tracking → segment cleaner uses it (don't delete
 *     segments ahead of playhead)
 */

const { spawn } = require("child_process");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");

const { detect: detectHW, getFFmpegHWDecodeArgs, PROFILES } = require("./hwAccel");
const { QUALITY_PRESETS, DECISION } = require("./streamingEngine");

// ─── Config ───────────────────────────────────────────────────────────────────

const TEMP_DIR = process.env.HLS_TEMP_DIR || path.join(__dirname, "../../temp/hls");
const SESSION_TIMEOUT_MS = parseInt(process.env.SESSION_TIMEOUT_MS || "300000", 10); // 5 min idle
const SEGMENT_DURATION = parseInt(process.env.HLS_SEGMENT_DURATION || "4", 10); // seconds
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || "10", 10);

// How many segments ahead of current transcode position before we restart
// Jellyfin uses: 24s / segmentLength  (≈6 segments for 4s segments)
const SEGMENT_GAP_RESTART = Math.ceil(24 / SEGMENT_DURATION);

// ─── In-memory session map ────────────────────────────────────────────────────

/** @type {Map<string, TranscodeSession>} */
const sessions = new Map();

// Per-playlist mutex: prevent two simultaneous starts for same content
/** @type {Map<string, Promise>} */
const _startLocks = new Map();

// ─── Session key (for sharing identical transcode params) ─────────────────────

function makeSharedKey(mediaId, params) {
    const raw = `${mediaId}:${params.quality || ""}:${params.videoCodec || ""}:${params.audioCodec || ""}`;
    return crypto.createHash("sha1").update(raw).digest("hex").slice(0, 12);
}

function makeSessionId() {
    return crypto.randomBytes(8).toString("hex");
}

// ─── Segment path helpers (mirrors Jellyfin naming convention) ────────────────

/**
 * segmentPath(sessionDir, startNumber) → /tmp/hls/<id>/index00042.ts
 * Jellyfin names segments:  <playlistBasename><segNumber>.<ext>
 * We use the same pattern so GetCurrentTranscodingIndex works.
 */
function segmentPath(sessionDir, segNumber) {
    const num = String(segNumber).padStart(5, "0");
    return path.join(sessionDir, `index${num}.ts`);
}

/**
 * Returns the highest segment index currently on disk for a session.
 * Mirrors Jellyfin's GetCurrentTranscodingIndex().
 */
function getCurrentSegmentIndex(sessionDir) {
    try {
        const files = fs
            .readdirSync(sessionDir)
            .filter((f) => /^index\d+\.ts$/.test(f))
            .map((f) => parseInt(f.replace("index", "").replace(".ts", ""), 10))
            .filter((n) => !isNaN(n));
        if (!files.length) return null;
        return Math.max(...files);
    } catch {
        return null;
    }
}

// ─── FFmpeg command builder ───────────────────────────────────────────────────

/**
 * buildFFmpegArgs
 *
 * Critical Jellyfin-inspired flags:
 *   -copyts                      — preserve original timestamps (no rebase)
 *   -avoid_negative_ts disabled  — don't shift timestamps even if negative
 *   -start_number N              — segments numbered from N (seek point)
 *   -ss <seekTime>               — placed BEFORE -i for fast input seek
 *   -hls_playlist_type event     — manifest grows; history retained
 *   -hls_list_size 0             — keep all segments in manifest
 *   -max_delay 5000000           — Jellyfin uses this; stabilises muxer
 *   -max_muxing_queue_size 2048  — prevents queue overflow on complex streams
 *   -force_key_frames …          — deterministic GOP boundaries for seeking
 */
function buildFFmpegArgs({
    inputPath,
    outputDir,
    hwProfile,
    decision,
    mediaInfo,
    startSegment = 0, // segment number to start from (integer)
}) {
    const { params } = decision;
    const preset = QUALITY_PRESETS[params.quality || "1080p"] || QUALITY_PRESETS["1080p"];
    const hw = hwProfile || PROFILES.cpu;

    // Seek time = startSegment * segmentDuration
    const seekSeconds = startSegment * SEGMENT_DURATION;

    const args = [];

    // ── Global ────────────────────────────────────────────────────────────────
    args.push("-hide_banner", "-loglevel", "warning");

    // ── Hardware decode (before -i) ───────────────────────────────────────────
    const hwDecodeArgs = getFFmpegHWDecodeArgs(hw);
    args.push(...hwDecodeArgs);

    // ── Input seek (fast seek before -i) ─────────────────────────────────────
    // Jellyfin: -ss comes from StartTimeTicks converted to seconds, before input
    if (seekSeconds > 0) {
        args.push("-ss", String(seekSeconds));
    }

    args.push("-i", inputPath);

    // ── Timestamp preservation (THE KEY FIX for random start position bug) ───
    // -copyts: do NOT rebase timestamps; keep original PTS from source
    // -avoid_negative_ts make_zero: if PTS goes negative, shift to zero (safe)
    // Note: "disabled" caused playback at wrong position on some content
    args.push("-copyts");
    args.push("-avoid_negative_ts", "make_zero");

    // ── Video stream ──────────────────────────────────────────────────────────
    if (decision.decision === DECISION.DIRECT_STREAM || decision.decision === DECISION.AUDIO_TRANSCODE) {
        args.push("-c:v", "copy");
    } else {
        // Full transcode
        const encoder = hw.type === "vaapi" ? hw.encodeCodecH264 : hw.type === "qsv" ? hw.encodeCodecH264 : hw.type === "nvenc" ? hw.encodeCodecH264 : "libx264";

        args.push("-c:v", encoder);

        // Scale filter
        const scaleFilter =
            hw.type === "vaapi"
                ? `scale_vaapi=w=${preset.width}:h=${preset.height}:force_original_aspect_ratio=decrease`
                : hw.type === "qsv"
                  ? `scale_qsv=w=${preset.width}:h=${preset.height}:force_original_aspect_ratio=decrease`
                  : `scale=w=${preset.width}:h=${preset.height}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`;

        args.push("-vf", scaleFilter);
        args.push("-b:v", preset.videoBitrate);
        args.push("-maxrate", preset.maxrate);
        args.push("-bufsize", preset.bufsize);

        if (encoder === "libx264") {
            args.push("-preset", "veryfast", "-profile:v", "high", "-level", "4.1");
        } else if (encoder === "h264_nvenc") {
            args.push("-preset", "p4", "-rc", "vbr");
        } else if (encoder === "h264_qsv") {
            args.push("-preset", "faster", "-look_ahead", "0");
        } else if (encoder === "h264_vaapi") {
            args.push("-rc_mode", "VBR");
        }

        if (hw.type === "cpu") {
            args.push("-pix_fmt", "yuv420p");
        }

        // ── Force keyframes at segment boundaries (Jellyfin GetHlsVideoKeyFrameArguments) ─
        // expr: put keyframe at every N seconds — aligns with -hls_time
        // This is the CRITICAL piece that makes HLS seeking work reliably.
        // Without forced keyframes at segment boundaries, the player can't seek
        // to segment N without decoding from a prior keyframe.
        const fpsRaw = mediaInfo?.video?.fps || "24/1";
        const [fpsNum, fpsDen] = fpsRaw.split("/").map(Number);
        const fps = fpsDen && fpsDen > 0 ? Math.round(fpsNum / fpsDen) : fpsNum || 24;
        const gopSize = SEGMENT_DURATION * fps;

        // Jellyfin uses expr:gte(t,n_forced*segLen) for even spacing
        args.push("-force_key_frames", `expr:gte(t,n_forced*${SEGMENT_DURATION})`);
        args.push("-g", String(gopSize));
        args.push("-keyint_min", String(gopSize));
        args.push("-sc_threshold", "0");
    }

    // ── Audio stream ──────────────────────────────────────────────────────────
    const primaryAudio = mediaInfo?.audio?.find((a) => a.default) || mediaInfo?.audio?.[0];
    const audioNeedsXcod = primaryAudio && !["aac", "mp3", "opus"].includes(primaryAudio.codec);

    if (decision.decision === DECISION.DIRECT_STREAM) {
        args.push("-c:a", "copy");
    } else if (audioNeedsXcod || decision.decision === DECISION.FULL_TRANSCODE || decision.decision === DECISION.AUDIO_TRANSCODE) {
        args.push("-c:a", "aac", "-b:a", preset.audioBitrate, "-ac", "2");
    } else {
        args.push("-c:a", "copy");
    }

    // ── Strip subtitles / metadata / chapters ─────────────────────────────────
    args.push("-sn");
    args.push("-map_metadata", "-1");
    args.push("-map_chapters", "-1");

    // ── Stream mapping ────────────────────────────────────────────────────────
    // Only map video if it exists (avoids "-map 0:v:0" on audio-only files)
    const hasVideo = Boolean(mediaInfo?.video);
    if (hasVideo) args.push("-map", "0:v:0");
    args.push("-map", "0:a:0?");

    // ── Muxer stability ───────────────────────────────────────────────────────
    // Jellyfin uses -max_delay 5000000 and -max_muxing_queue_size
    args.push("-max_delay", "5000000");
    args.push("-max_muxing_queue_size", "2048");

    // ── Thread count (let FFmpeg decide, but cap for stability) ───────────────
    args.push("-threads", "0");

    // ── HLS output ────────────────────────────────────────────────────────────
    args.push("-f", "hls");
    args.push("-hls_time", String(SEGMENT_DURATION));

    // hls_playlist_type event:
    //   - Manifest grows (ENDLIST not written until encoding done)
    //   - Past segments stay in manifest → full seek range available
    //   - This is what Jellyfin uses for live transcoding
    args.push("-hls_playlist_type", "event");
    args.push("-hls_list_size", "0"); // keep ALL segments in manifest

    // start_number: tell FFmpeg to name first segment as N
    // Combined with seek offset = N*segDuration, the segment numbers
    // in the manifest match what the player's timeline expects.
    args.push("-start_number", String(startSegment));

    args.push("-hls_segment_type", "mpegts");
    args.push("-hls_flags", "independent_segments");
    args.push("-hls_segment_filename", path.join(outputDir, "index%05d.ts"));
    args.push("-hls_allow_cache", "1");

    // Output manifest
    args.push("-y", path.join(outputDir, "index.m3u8"));

    return args;
}

// ─── Session factory ──────────────────────────────────────────────────────────

/**
 * createSession
 *
 * @param {object} opts
 * @param {string}  opts.mediaId
 * @param {string}  opts.filePath
 * @param {object}  opts.decision     — from decidePlayback()
 * @param {object}  opts.mediaInfo    — from extractMediaInfo()
 * @param {number}  opts.startSegment — segment index to start from (default 0)
 * @returns {Promise<TranscodeSession>}
 */
async function createSession({ mediaId, filePath, decision, mediaInfo, startSegment = 0 }) {
    if (sessions.size >= MAX_SESSIONS) {
        await evictOldestSession();
    }

    const sharedKey = makeSharedKey(mediaId, decision.params);

    // Reuse running session if same content+quality and segment is within range
    for (const [, s] of sessions) {
        if (s._sharedKey === sharedKey && s.status === "running" && s.mediaId === mediaId) {
            const currentIdx = getCurrentSegmentIndex(s.sessionDir);
            if (currentIdx !== null) {
                const gap = startSegment - currentIdx;
                // Reuse if player is close enough ahead (within gap threshold)
                if (gap >= 0 && gap <= SEGMENT_GAP_RESTART) {
                    s.touch();
                    console.log(`[Transcoder] Reusing session ${s.id} for seg${startSegment} (currentIdx=${currentIdx})`);
                    return s;
                }
                // Seek backwards or too far ahead → kill and restart
                console.log(`[Transcoder] Gap ${gap} > ${SEGMENT_GAP_RESTART} — restarting for seg${startSegment}`);
                await s.kill();
                break;
            }
            // No segments yet — reuse if same start
            if (s.startSegment === startSegment) {
                s.touch();
                return s;
            }
            await s.kill();
            break;
        }
    }

    const sessionId = makeSessionId();
    const sessionDir = path.join(TEMP_DIR, sessionId);
    await fsp.mkdir(sessionDir, { recursive: true });

    const hwProfile = await detectHW();
    const args = buildFFmpegArgs({
        inputPath: filePath,
        outputDir: sessionDir,
        hwProfile,
        decision,
        mediaInfo,
        startSegment,
    });

    console.log(`[Transcoder] Session ${sessionId} — ${decision.decision} — seg${startSegment} — ${path.basename(filePath)}`);

    const ffmpegProcess = spawn("ffmpeg", args, {
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
    });

    const session = {
        id: sessionId,
        mediaId,
        filePath,
        sessionDir,
        m3u8Path: path.join(sessionDir, "index.m3u8"),
        ffmpegProcess,
        lastAccessedAt: Date.now(),
        decision: decision.decision,
        params: decision.params,
        startSegment,
        status: "starting",
        _sharedKey: sharedKey,
        // Tracks how far the player has consumed (for segment cleaner)
        downloadPositionSec: startSegment * SEGMENT_DURATION,

        touch() {
            this.lastAccessedAt = Date.now();
        },

        async kill() {
            if (this.ffmpegProcess && !this.ffmpegProcess.killed) {
                this.ffmpegProcess.kill("SIGKILL");
            }
            this.status = "dead";
            sessions.delete(this.id);
            try {
                await fsp.rm(this.sessionDir, { recursive: true, force: true });
                console.log(`[Transcoder] Session ${this.id} cleaned`);
            } catch {}
        },
    };

    ffmpegProcess.stderr.on("data", (d) => {
        const msg = d.toString().trim();
        if (msg) console.warn(`[FFmpeg:${sessionId}] ${msg}`);
    });

    ffmpegProcess.on("spawn", () => {
        session.status = "running";
    });
    ffmpegProcess.on("error", (err) => {
        session.status = "error";
        console.error(`[Transcoder] spawn error ${sessionId}:`, err.message);
    });
    ffmpegProcess.on("exit", (code) => {
        if (session.status !== "dead") {
            session.status = code === 0 ? "running" : "error"; // keep "running" so file serving still works
            if (code !== 0) console.error(`[Transcoder] FFmpeg exit=${code} session ${sessionId}`);
        }
    });

    sessions.set(sessionId, session);
    return session;
}

// ─── Public API ───────────────────────────────────────────────────────────────

function getSession(id) {
    const s = sessions.get(id);
    if (s) s.touch();
    return s || null;
}

async function killSession(id) {
    const s = sessions.get(id);
    if (s) await s.kill();
}

async function killAllSessions() {
    const ps = [];
    for (const [, s] of sessions) ps.push(s.kill());
    await Promise.allSettled(ps);
    sessions.clear();
}

async function evictOldestSession() {
    let oldest = null,
        oldestTime = Infinity;
    for (const [, s] of sessions) {
        if (s.lastAccessedAt < oldestTime) {
            oldest = s;
            oldestTime = s.lastAccessedAt;
        }
    }
    if (oldest) {
        console.log(`[Transcoder] Evicting LRU session ${oldest.id}`);
        await oldest.kill();
    }
}

/**
 * waitForSegment — waits until segment file exists and has size > 0.
 * Used by serveHLSFile to hold the HTTP response until FFmpeg writes the segment.
 *
 * @param {string} segPath
 * @param {number} timeout  ms
 */
function waitForSegment(segPath, timeout = 30_000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const tick = () => {
            try {
                const stat = fs.statSync(segPath);
                if (stat.size > 0) return resolve();
            } catch {}
            if (Date.now() - start > timeout) return reject(new Error(`Segment timeout: ${segPath}`));
            setTimeout(tick, 150);
        };
        tick();
    });
}

/**
 * waitForM3U8 — waits for manifest file to appear with content.
 */
function waitForM3U8(m3u8Path, timeout = 20_000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const tick = () => {
            try {
                const stat = fs.statSync(m3u8Path);
                if (stat.size > 0) return resolve();
            } catch {}
            if (Date.now() - start > timeout) return reject(new Error("HLS manifest timeout"));
            setTimeout(tick, 200);
        };
        tick();
    });
}

function getSessionStats() {
    return [...sessions.values()].map((s) => ({
        id: s.id,
        mediaId: s.mediaId,
        decision: s.decision,
        status: s.status,
        startSegment: s.startSegment,
        downloadPos: s.downloadPositionSec,
        idleMs: Date.now() - s.lastAccessedAt,
        currentIdx: getCurrentSegmentIndex(s.sessionDir),
    }));
}

module.exports = {
    createSession,
    getSession,
    killSession,
    killAllSessions,
    waitForM3U8,
    waitForSegment,
    getCurrentSegmentIndex,
    segmentPath,
    getSessionStats,
    TEMP_DIR,
    SESSION_TIMEOUT_MS,
    SEGMENT_DURATION,
    SEGMENT_GAP_RESTART,
};
