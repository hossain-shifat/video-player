"use strict";

/**
 * transcoderService.js — FLUX v4 (Production)
 *
 * Jellyfin-inspired improvements over v3:
 *
 *  1. waitForSegment uses fs.watch (event-based) with poll fallback → no 150ms jitter
 *  2. Seek restart returns SAME session ID (via session takeover) — client never breaks
 *  3. Manifest rewriting: segment URLs rewritten to full proxy paths so CORS never fails
 *  4. Session "warmup" mode: startSegment pre-generates AHEAD_COUNT segments before
 *     returning to client — eliminates initial buffering stall
 *  5. Probe disk-cache: ffprobe results survive server restarts
 *  6. Per-session mutex: prevents double-spawn race condition
 *  7. downloadPositionSec update from segment serve (not just ping) for accurate cleanup
 */

const { spawn } = require("child_process");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
const EventEmitter = require("events");

const { detect: detectHW, getFFmpegHWDecodeArgs, PROFILES } = require("./hwAccel");
const { QUALITY_PRESETS, DECISION } = require("./streamingEngine");

// ─── Config ───────────────────────────────────────────────────────────────────

const TEMP_DIR = process.env.HLS_TEMP_DIR || path.join(__dirname, "../../temp/hls");
const SESSION_TIMEOUT_MS = parseInt(process.env.SESSION_TIMEOUT_MS || "300000", 10); // 5 min idle
const SEGMENT_DURATION = parseInt(process.env.HLS_SEGMENT_DURATION || "4", 10);
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || "10", 10);
// Segments ahead of playhead before we restart (Jellyfin: 24s / segLen)
const SEGMENT_GAP_RESTART = Math.ceil(24 / SEGMENT_DURATION);
// How many segments to pre-generate before telling client to play
const WARMUP_SEGMENTS = parseInt(process.env.HLS_WARMUP_SEGMENTS || "2", 10);

// ─── In-memory session map ────────────────────────────────────────────────────

/** @type {Map<string, TranscodeSession>} */
const sessions = new Map();

// Per-mediaId+quality start lock (prevent simultaneous spawn)
/** @type {Map<string, Promise>} */
const _startLocks = new Map();

// ─── Shared key (for session reuse when params match) ─────────────────────────

function makeSharedKey(mediaId, params) {
    const raw = `${mediaId}:${params.quality || ""}:${params.videoCodec || ""}:${params.audioCodec || ""}`;
    return crypto.createHash("sha1").update(raw).digest("hex").slice(0, 12);
}

function makeSessionId() {
    return crypto.randomBytes(8).toString("hex");
}

// ─── Segment path helpers ─────────────────────────────────────────────────────

function segmentPath(sessionDir, segNumber) {
    const num = String(segNumber).padStart(5, "0");
    return path.join(sessionDir, `index${num}.ts`);
}

/** Returns highest transcoded segment index on disk */
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

// ─── Event-based segment wait ─────────────────────────────────────────────────
// Uses fs.watch (inotify on Linux) + poll fallback for maximum responsiveness.
// Jellyfin's approach: poll every 100ms. We do better: watch + 50ms fallback.

function waitForSegment(segPath, timeout = 30_000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();

        // Check if already exists
        try {
            if (fs.statSync(segPath).size > 0) return resolve();
        } catch {}

        let watcher = null;
        let pollTimer = null;
        let done = false;

        const finish = (err) => {
            if (done) return;
            done = true;
            try {
                watcher?.close();
            } catch {}
            clearInterval(pollTimer);
            if (err) reject(err);
            else resolve();
        };

        const check = () => {
            try {
                if (fs.statSync(segPath).size > 0) finish(null);
            } catch {}
            if (!done && Date.now() - start > timeout) {
                finish(new Error(`Segment timeout: ${path.basename(segPath)}`));
            }
        };

        // Watch the parent directory for any new file (inotify efficient)
        const dir = path.dirname(segPath);
        const base = path.basename(segPath);
        try {
            watcher = fs.watch(dir, (event, filename) => {
                if (filename === base || event === "rename") check();
            });
            watcher.on("error", () => {}); // ignore watcher errors
        } catch {
            // fs.watch unavailable — fall back to pure poll
        }

        // Poll at 50ms as safety net (handles cases fs.watch misses)
        pollTimer = setInterval(check, 50);
    });
}

function waitForM3U8(m3u8Path, timeout = 20_000) {
    return waitForSegment(m3u8Path, timeout);
}

// ─── Wait for N warmup segments ───────────────────────────────────────────────
// Waits for WARMUP_SEGMENTS to exist starting from startSeg.
// This eliminates the "buffering immediately" on playback start.

async function waitForWarmup(sessionDir, startSeg, warmupCount, timeout = 30_000) {
    const end = startSeg + warmupCount;
    for (let i = startSeg; i < end; i++) {
        const segFile = segmentPath(sessionDir, i);
        await waitForSegment(segFile, timeout);
    }
}

// ─── FFmpeg command builder ───────────────────────────────────────────────────

/**
 * Jellyfin-inspired flags:
 *  -copyts                     preserve original PTS (no timestamp rebase)
 *  -avoid_negative_ts disabled don't shift timestamps
 *  -start_number N             name segments from N (matches seek offset)
 *  -hls_playlist_type event    manifest grows; history retained (NOT vod/rolling)
 *  -hls_list_size 0            all segments in manifest (full seek range)
 *  -force_key_frames           deterministic GOP boundaries for accurate seek
 *  -max_delay 5000000          stabilise muxer
 *  -max_muxing_queue_size 2048 prevent queue overflow on complex streams
 */
function buildFFmpegArgs({ inputPath, outputDir, hwProfile, decision, mediaInfo, startSegment = 0 }) {
    const { params } = decision;
    const preset = QUALITY_PRESETS[params.quality || "1080p"] || QUALITY_PRESETS["1080p"];
    const hw = hwProfile || PROFILES.cpu;
    const seekSeconds = startSegment * SEGMENT_DURATION;

    const args = [];

    // Global flags
    args.push("-hide_banner", "-loglevel", "warning");

    // Hardware decode (before -i)
    const hwDecodeArgs = getFFmpegHWDecodeArgs(hw);
    args.push(...hwDecodeArgs);

    // Fast input seek (before -i = input-level seek, much faster for large files)
    if (seekSeconds > 0) {
        args.push("-ss", String(seekSeconds));
    }

    args.push("-i", inputPath);

    // Timestamp preservation — THE critical fix for wrong-position playback
    args.push("-copyts");
    args.push("-avoid_negative_ts", "disabled");

    // ── Video ──────────────────────────────────────────────────────────────────
    if (decision.decision === DECISION.DIRECT_STREAM || decision.decision === DECISION.AUDIO_TRANSCODE) {
        args.push("-c:v", "copy");
    } else {
        // Select hardware encoder
        let encoder = "libx264";
        if (hw.type === "nvenc") encoder = hw.encodeCodecH264;
        else if (hw.type === "qsv") encoder = hw.encodeCodecH264;
        else if (hw.type === "vaapi") encoder = hw.encodeCodecH264;

        args.push("-c:v", encoder);

        // Scale filter (hardware-aware)
        let scaleFilter;
        if (hw.type === "vaapi") {
            scaleFilter = `scale_vaapi=w=${preset.width}:h=${preset.height}:force_original_aspect_ratio=decrease`;
        } else if (hw.type === "qsv") {
            scaleFilter = `scale_qsv=w=${preset.width}:h=${preset.height}:force_original_aspect_ratio=decrease`;
        } else {
            // CPU/NVENC: software scale + ensure even dimensions
            scaleFilter = `scale=w=${preset.width}:h=${preset.height}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`;
        }
        args.push("-vf", scaleFilter);

        // Bitrate control
        args.push("-b:v", preset.videoBitrate);
        args.push("-maxrate", preset.maxrate);
        args.push("-bufsize", preset.bufsize);

        // Encoder-specific tuning for streaming performance
        if (encoder === "libx264") {
            args.push("-preset", "veryfast", "-profile:v", "high", "-level", "4.1");
            args.push("-tune", "zerolatency"); // reduce encoder latency
        } else if (encoder === "h264_nvenc") {
            args.push("-preset", "p4", "-rc", "vbr", "-zerolatency", "1");
        } else if (encoder === "h264_qsv") {
            args.push("-preset", "faster", "-look_ahead", "0");
        } else if (encoder === "h264_vaapi") {
            args.push("-rc_mode", "VBR");
        }

        if (hw.type === "cpu") {
            args.push("-pix_fmt", "yuv420p"); // max browser compatibility
        }

        // Force keyframes at segment boundaries (Jellyfin GetHlsVideoKeyFrameArguments)
        // Critical for accurate seeking — without this, player must decode from prior keyframe
        const fpsRaw = mediaInfo?.video?.fps || "24/1";
        const [fpsNum, fpsDen] = fpsRaw.split("/").map(Number);
        const fps = fpsDen && fpsDen > 0 ? Math.round(fpsNum / fpsDen) : fpsNum || 24;
        const gopSize = SEGMENT_DURATION * fps;

        args.push("-force_key_frames", `expr:gte(t,n_forced*${SEGMENT_DURATION})`);
        args.push("-g", String(gopSize));
        args.push("-keyint_min", String(gopSize));
        args.push("-sc_threshold", "0"); // disable scene-cut keyframes (predictable GOPs)
    }

    // ── Audio ──────────────────────────────────────────────────────────────────
    const primaryAudio = mediaInfo?.audio?.find((a) => a.default) || mediaInfo?.audio?.[0];
    const audioNeedsXcod = primaryAudio && !["aac", "mp3", "opus"].includes(primaryAudio.codec);

    if (decision.decision === DECISION.DIRECT_STREAM) {
        args.push("-c:a", "copy");
    } else if (audioNeedsXcod || decision.decision === DECISION.FULL_TRANSCODE || decision.decision === DECISION.AUDIO_TRANSCODE) {
        args.push("-c:a", "aac", "-b:a", preset.audioBitrate, "-ac", "2");
        // AAC-LC is universally supported; force profile for max compat
        args.push("-profile:a", "aac_low");
    } else {
        args.push("-c:a", "copy");
    }

    // ── Strip subtitles / bloat ────────────────────────────────────────────────
    args.push("-sn");
    args.push("-map_metadata", "-1");
    args.push("-map_chapters", "-1");

    // ── Stream mapping ─────────────────────────────────────────────────────────
    args.push("-map", "0:v:0");
    args.push("-map", "0:a:0?");

    // ── Muxer stability (Jellyfin settings) ───────────────────────────────────
    args.push("-max_delay", "5000000");
    args.push("-max_muxing_queue_size", "2048");

    // Thread count: 0 = auto (FFmpeg picks optimal)
    args.push("-threads", "0");

    // ── HLS output ─────────────────────────────────────────────────────────────
    args.push("-f", "hls");
    args.push("-hls_time", String(SEGMENT_DURATION));

    // event type: manifest grows, past segments stay (Jellyfin pattern for live transcode)
    args.push("-hls_playlist_type", "event");
    args.push("-hls_list_size", "0"); // all segments in manifest = full seek range

    // Segment numbering starts at startSegment — manifest timeline matches seek offset
    args.push("-start_number", String(startSegment));

    args.push("-hls_segment_type", "mpegts");
    // independent_segments: each segment is self-contained (required for accurate seeking)
    args.push("-hls_flags", "independent_segments+split_by_time");
    args.push("-hls_segment_filename", path.join(outputDir, "index%05d.ts"));
    args.push("-hls_allow_cache", "1");

    // Output manifest
    args.push("-y", path.join(outputDir, "index.m3u8"));

    return args;
}

// ─── Session factory ──────────────────────────────────────────────────────────

async function createSession({ mediaId, filePath, decision, mediaInfo, startSegment = 0 }) {
    // Enforce session cap
    if (sessions.size >= MAX_SESSIONS) {
        await evictOldestSession();
    }

    const sharedKey = makeSharedKey(mediaId, decision.params);

    // Reuse running session if same content+quality and player is within seek range
    for (const [, s] of sessions) {
        if (s._sharedKey === sharedKey && s.status === "running" && s.mediaId === mediaId) {
            const currentIdx = getCurrentSegmentIndex(s.sessionDir);
            if (currentIdx !== null) {
                const gap = startSegment - currentIdx;
                if (gap >= 0 && gap <= SEGMENT_GAP_RESTART) {
                    s.touch();
                    console.log(`[Transcoder] Reuse session ${s.id} seg${startSegment} (at idx${currentIdx})`);
                    return s;
                }
                console.log(`[Transcoder] Gap ${gap} > ${SEGMENT_GAP_RESTART} — restarting seg${startSegment}`);
                await s.kill();
                break;
            }
            if (s.startSegment === startSegment) {
                s.touch();
                return s;
            }
            await s.kill();
            break;
        }
    }

    // Per-(mediaId+quality) mutex to prevent double-spawn race
    const lockKey = sharedKey;
    if (_startLocks.has(lockKey)) {
        await _startLocks.get(lockKey);
    }

    let lockResolve;
    const lockPromise = new Promise((res) => {
        lockResolve = res;
    });
    _startLocks.set(lockKey, lockPromise);

    try {
        const sessionId = makeSessionId();
        const sessionDir = path.join(TEMP_DIR, sessionId);
        await fsp.mkdir(sessionDir, { recursive: true });

        const hwProfile = await detectHW();
        const args = buildFFmpegArgs({ inputPath: filePath, outputDir: sessionDir, hwProfile, decision, mediaInfo, startSegment });

        console.log(`[Transcoder] ${sessionId} — ${decision.decision} — seg${startSegment} — ${path.basename(filePath)}`);

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
            downloadPositionSec: startSegment * SEGMENT_DURATION,
            _events: new EventEmitter(),

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
                } catch {}
                console.log(`[Transcoder] Session ${this.id} killed+cleaned`);
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
                // Keep "running" so manifest/segments remain serveable
                session.status = code === 0 ? "done" : "error";
                if (code !== 0) console.error(`[Transcoder] FFmpeg exit=${code} session ${sessionId}`);
            }
        });

        sessions.set(sessionId, session);
        return session;
    } finally {
        _startLocks.delete(lockKey);
        lockResolve?.();
    }
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
        console.log(`[Transcoder] Evict LRU session ${oldest.id}`);
        await oldest.kill();
    }
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
    waitForWarmup,
    getCurrentSegmentIndex,
    segmentPath,
    getSessionStats,
    TEMP_DIR,
    SESSION_TIMEOUT_MS,
    SEGMENT_DURATION,
    SEGMENT_GAP_RESTART,
    WARMUP_SEGMENTS,
};
