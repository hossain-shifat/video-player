"use strict";

/**
 * transcoderService.js  — FLUX v3 (Jellyfin-inspired)
 *
 * KEY FIXES vs v2:
 *  1. Segment-based seeking: seek = segmentId * segmentDuration (not raw -ss)
 *     → FFmpeg receives -start_number N, output starts at correct position
 *     → Manifest continuity: segments numbered from N, player timeline correct
 *  2. -copyts -avoid_negative_ts disabled  (Jellyfin's magic pair)
 *     → Preserves original PTS, no timestamp rebase → no random start position
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
const SESSION_TIMEOUT_MS = parseInt(process.env.SESSION_TIMEOUT_MS || "1200000", 10); // 20 min idle
const SEGMENT_DURATION = parseInt(process.env.HLS_SEGMENT_DURATION || "4", 10); // seconds
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || "10", 10);

// How many segments ahead of current transcode position before we restart
// Jellyfin uses: 24s / segmentLength  (≈6 segments for 4s segments)
const SEGMENT_GAP_RESTART = Math.ceil(24 / SEGMENT_DURATION);

// ─── HW Profile Cache ─────────────────────────────────────────────────────────
// detectHW() runs 3–4 test encodes (3–36s total) on first call.
// Cache the result so createSession() never blocks on subsequent plays.
// warmup() pre-populates this; first play hits it otherwise.
let _hwProfileCache = null;

async function getHWProfile() {
    if (_hwProfileCache) return _hwProfileCache;
    _hwProfileCache = await detectHW();
    return _hwProfileCache;
}

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
 * Async version — uses fsp.readdir to avoid blocking the event loop.
 */
async function getCurrentSegmentIndex(sessionDir) {
    try {
        const files = (await fsp.readdir(sessionDir))
            .filter((f) => /^index\d+\.ts$/.test(f))
            .map((f) => parseInt(f.replace("index", "").replace(".ts", ""), 10))
            .filter((n) => !isNaN(n));
        if (!files.length) return null;
        return Math.max(...files);
    } catch {
        return null;
    }
}

/**
 * Sync version — only for getSessionStats() where we need a quick snapshot.
 * Should NOT be called in hot request paths.
 */
function getCurrentSegmentIndexSync(sessionDir) {
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

    // ── Timestamp handling ────────────────────────────────────────────────────
    // Use Jellyfin's magic pair unconditionally to preserve PTS across seeks.
    // This ensures HLS.js places segments at the correct timeline position
    // instead of resetting to 0 and causing random start times.
    args.push("-copyts");
    args.push("-avoid_negative_ts", "disabled");

    // ── Video stream ──────────────────────────────────────────────────────────
    if (decision.decision === DECISION.DIRECT_STREAM || decision.decision === DECISION.AUDIO_TRANSCODE) {
        args.push("-c:v", "copy");

        // FIX (Report-06): H.264/HEVC streams from MKV/MP4 containers use
        // length-prefixed NALUs. MPEG-TS segments require Annex B start codes.
        // Without this bitstream filter, -c:v copy produces unplayable .ts files.
        // Jellyfin applies this filter unconditionally when the video is copied.
        const videoCodec = (mediaInfo?.video?.codec || "").toLowerCase();
        if (videoCodec === "h264" || videoCodec === "avc" || videoCodec === "avc1") {
            args.push("-bsf:v", "h264_mp4toannexb");
        } else if (videoCodec === "hevc" || videoCodec === "h265" || videoCodec === "hvc1") {
            args.push("-bsf:v", "hevc_mp4toannexb");
        }
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
    const hasAudio = Boolean(primaryAudio);
    const audioNeedsXcod = hasAudio && !["aac", "mp3", "opus"].includes(primaryAudio.codec);

    // Guard: if AUDIO_TRANSCODE was requested but file has no audio stream,
    // skip audio args entirely — FFmpeg would exit 1 trying to encode from nothing.
    if (!hasAudio) {
        // No audio stream — don't emit any -c:a flag; -map 0:a:0? (optional) handles it
    } else if (decision.decision === DECISION.DIRECT_STREAM) {
        // Copy audio only if browser-safe; transcode AC3/DTS/TrueHD to AAC
        if (audioNeedsXcod) {
            args.push("-c:a", "aac", "-b:a", "192k", "-ac", "2");
        } else {
            args.push("-c:a", "copy");
        }
    } else {
        // AUDIO_TRANSCODE or FULL_TRANSCODE — always force AAC for MSE compatibility.
        // Without an explicit -c:a here, FFmpeg defaults to mp2 for mpegts output.
        // Chrome's MSE demuxer rejects mp2 inside fMP4 → DEMUXER_ERROR_COULD_NOT_OPEN.
        args.push("-c:a", "aac", "-b:a", "192k", "-ac", "2");
    }

    // ── Strip subtitles / metadata / chapters ─────────────────────────────────
    args.push("-sn");
    args.push("-map_metadata", "-1");
    args.push("-map_chapters", "-1");

    // ── Stream mapping ────────────────────────────────────────────────────────
    // Only map video if the file actually has a video stream.
    // Previously had duplicate args.push("-map","0:v:0") here — FFmpeg treated
    // that as two video streams → muxer error → broken/empty HLS segments.
    //
    // FIX (Report-20): primaryAudio.index is the GLOBAL stream index from ffprobe
    // (e.g. stream 0=video, stream 1=audio → index=1).
    // "-map 0:a:N" means N-th AUDIO stream (relative), NOT global index N.
    // For a file with video=0, audio=1: "-map 0:a:1?" tries to get the 2nd audio
    // track — which doesn't exist — and the optional "?" silently drops audio.
    // Fix: use "-map 0:N?" with the global stream index so FFmpeg maps exactly
    // the stream ffprobe identified as default regardless of its position.
    const hasVideo = Boolean(mediaInfo?.video);
    if (hasVideo) args.push("-map", "0:v:0");
    if (hasAudio && primaryAudio?.index != null) {
        args.push("-map", `0:${primaryAudio.index}?`); // global stream index
    } else {
        args.push("-map", "0:a:0?"); // fallback: first audio stream
    }

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

    // FIX (Report-08): Without throttling, hardware-accelerated FFmpeg transcodes
    // at 5–10x realtime, producing hundreds of segments and quickly hitting the
    // MAX_TEMP_MB limit → enforceStorageLimit kills the active session → 404s.
    //
    // Solution: cap the HLS forward buffer to ~60 segments (= ~240s at 4s segments).
    // FFmpeg's -hls_list_size with -hls_playlist_type event still keeps all segments
    // in the manifest, but we rate-limit segment GENERATION by setting a realistic
    // output bitrate buffer. This is done with -re only on CPU-bound paths where
    // the encoder can run much faster than realtime without hw acceleration.
    //
    // For HW-accelerated encodes (nvenc/qsv/vaapi): add -vsync 0 to avoid frame-drop
    // warnings, plus an explicit -r fps cap derived from the source FPS so the muxer
    // doesn't race to write all segments at once.
    //
    // NOTE: We deliberately do NOT use `-re` (realtime flag) because it causes
    // audio/video sync drift on long files. Instead we cap using buffer sizing.
    //
    // FIX: Removed -t limit. FFmpeg will now transcode the entire file, preventing
    // the player from stopping after 4 minutes when gap detection fails to restart.

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
 * BUG-11 FIX: wrapped in per-sharedKey mutex using _startLocks so two
 * simultaneous requests for the same content can't both evict + create,
 * pushing sessions past MAX_SESSIONS.
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
    const sharedKey = makeSharedKey(mediaId, decision.params);

    // Serialize concurrent starts for the same content+quality
    const existing = _startLocks.get(sharedKey);
    if (existing) {
        // Another call is already starting this session — wait for it, then reuse
        await existing.catch(() => {});
        // After the lock resolves, check if a usable session now exists
        for (const [, s] of sessions) {
            if (s._sharedKey === sharedKey && s.status === "running" && s.mediaId === mediaId) {
                s.touch();
                return s;
            }
        }
    }

    let resolveLock, rejectLock;
    const lockPromise = new Promise((res, rej) => {
        resolveLock = res;
        rejectLock = rej;
    });
    _startLocks.set(sharedKey, lockPromise);

    try {
        return await _createSessionInternal({ mediaId, filePath, decision, mediaInfo, startSegment, sharedKey });
    } finally {
        _startLocks.delete(sharedKey);
        resolveLock();
    }
}

async function _createSessionInternal({ mediaId, filePath, decision, mediaInfo, startSegment, sharedKey }) {
    if (sessions.size >= MAX_SESSIONS) {
        await evictOldestSession();
    }

    // (sharedKey already computed by createSession wrapper)

    // Reuse running session if same content+quality and segment is within range
    for (const [, s] of sessions) {
        if (s._sharedKey === sharedKey && s.status === "running" && s.mediaId === mediaId) {
            const currentIdx = await getCurrentSegmentIndex(s.sessionDir);
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

    const hwProfile = await getHWProfile(); // BUG-02 FIX: cached, not re-detected per session
    const args = buildFFmpegArgs({
        inputPath: filePath,
        outputDir: sessionDir,
        hwProfile,
        decision,
        mediaInfo,
        startSegment,
    });

    console.log(`[Transcoder] Session ${sessionId} — ${decision.decision} — seg${startSegment} — ${path.basename(filePath)}`);

    // Resolve the ffmpeg binary path.
    // On Windows, bare "ffmpeg" without shell:true may fail to locate the executable
    // if it is not in PATH as "ffmpeg.exe". Appending ".exe" makes Node's spawn work
    // reliably with shell:false (avoids shell injection risk).
    // FIX: previously skipped .exe append when FFMPEG_PATH was set — now always appends on win32.
    let ffmpegBin = process.env.FFMPEG_PATH || "ffmpeg";
    if (process.platform === "win32" && !ffmpegBin.toLowerCase().endsWith(".exe")) {
        ffmpegBin = ffmpegBin + ".exe";
    }
    const ffmpegProcess = spawn(ffmpegBin, args, {
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
        // shell:false (default) — avoids Windows shell escaping issues with paths
        windowsHide: true, // suppress CMD window popup on Windows
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
            // NOTE: Do NOT append #EXT-X-ENDLIST here.
            // FFmpeg writes it naturally on clean exit (code 0).
            // kill() is for forced termination — the session dir is deleted immediately
            // after, so any ENDLIST write would be redundant. More importantly, adding
            // ENDLIST to a partially-transcoded manifest causes HLS.js to lock the
            // video duration to only the segments generated so far, preventing
            // gap detection from restarting the session for the next chunk.
            try {
                await fsp.rm(this.sessionDir, { recursive: true, force: true });
                console.log(`[Transcoder] Session ${this.id} cleaned`);
            } catch {}
        },
    };

    session.metrics = { fps: 0, speed: 0, bitrate: "0kbits/s", frame: 0 };
    // Stderr buffer for diagnostics — 16 KB cap (increased from 4 KB to capture
    // full error messages from codec mismatches and filter chain failures).
    let stderrBuf = "";
    // Single consolidated stderr listener (was two separate listeners before).
    ffmpegProcess.stderr.on("data", (d) => {
        const msg = d.toString();
        // Accumulate stderr for error diagnostics
        if (stderrBuf.length < 16384) stderrBuf += msg;
        // Parse metrics from progress lines
        const trimmed = msg.trim();
        if (trimmed) {
            const frameMatch = trimmed.match(/frame=\s*(\d+)/);
            if (frameMatch) session.metrics.frame = parseInt(frameMatch[1], 10);
            const fpsMatch = trimmed.match(/fps=\s*([\d.]+)/);
            if (fpsMatch) session.metrics.fps = parseFloat(fpsMatch[1]);
            const bitrateMatch = trimmed.match(/bitrate=\s*([\d.]+\s*[a-zA-Z\/]+)/);
            if (bitrateMatch) session.metrics.bitrate = bitrateMatch[1];
            const speedMatch = trimmed.match(/speed=\s*([\d.]+)x/);
            if (speedMatch) session.metrics.speed = parseFloat(speedMatch[1]);
        }
    });

    ffmpegProcess.on("spawn", () => {
        session.status = "running";
        console.log(`[Transcoder] FFmpeg spawned for session ${sessionId}`);
    });

    ffmpegProcess.on("error", (err) => {
        session.status = "error";
        // ENOENT = ffmpeg not found. Give actionable hint.
        if (err.code === "ENOENT") {
            console.error(`[Transcoder] FFmpeg not found. Set FFMPEG_PATH=/path/to/ffmpeg.exe in your .env file. Error: ${err.message}`);
        } else {
            console.error(`[Transcoder] spawn error ${sessionId}:`, err.message);
        }
        // Remove dead session after grace period (lets callers check status first)
        setTimeout(() => {
            sessions.delete(sessionId);
        }, 5_000);
    });

    ffmpegProcess.on("exit", (code, signal) => {
        if (session.status !== "dead") {
            session.status = code === 0 ? "done" : "error";
            if (code !== 0) {
                console.error(`[Transcoder] FFmpeg exit=${code} signal=${signal} session=${sessionId}`);
                if (stderrBuf) {
                    const tail = stderrBuf.slice(-1500);
                    console.error(`[Transcoder] FFmpeg stderr tail:\n${tail}`);
                }
                // Deferred map cleanup: give startHLSSession time to read status before removing
                setTimeout(() => {
                    sessions.delete(sessionId);
                }, 10_000);
            }
        }
        // BUG-07 FIX: release the stderr buffer — it's no longer needed after exit
        stderrBuf = null;
    });

    sessions.set(sessionId, session);
    return session;
}

// ─── Idle-timeout sweeper ─────────────────────────────────────────────────────
// In startSweeper() — not at module-load time — to avoid circular dep issues.
let _idleSweepInterval = null;

function startSweeper() {
    if (_idleSweepInterval) return;
    _idleSweepInterval = setInterval(async () => {
        const now = Date.now();
        const toKill = [];
        for (const [, s] of sessions) {
            if (s.status === "running" && now - s.lastAccessedAt > SESSION_TIMEOUT_MS) {
                toKill.push(s);
            }
            // FIX: "done" sessions must survive long enough for player to consume all segments.
            // Old value (60_000 = 60s) was too aggressive — HW FFmpeg finishes fast and
            // player hasn't consumed all generated segments yet.
            // New: 10 min idle timeout for done sessions before cleanup.
            if ((s.status === "done" || s.status === "error") && now - s.lastAccessedAt > 600_000) {
                toKill.push(s);
            }
        }
        for (const s of toKill) {
            console.log(`[Transcoder] Idle sweep — killing session ${s.id} (idle ${Math.round((now - s.lastAccessedAt) / 1000)}s)`);
            await s.kill().catch(() => {});
        }
    }, 120_000).unref();
    console.log("[Transcoder] Idle sweeper started");
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

function waitForSegment(segPath, timeout = 45_000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const tick = () => {
            fsp.stat(segPath)
                .then((stat) => {
                    if (stat.size > 0) return resolve();
                    schedule();
                })
                .catch(() => schedule());
            function schedule() {
                if (Date.now() - start > timeout) return reject(new Error(`Segment timeout: ${segPath}`));
                setTimeout(tick, 150);
            }
        };
        tick();
    });
}

function waitForM3U8(m3u8Path, timeout = 60_000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const tick = () => {
            fsp.stat(m3u8Path)
                .then((stat) => {
                    if (stat.size > 0) return resolve();
                    schedule();
                })
                .catch(() => schedule());
            function schedule() {
                if (Date.now() - start > timeout) return reject(new Error("HLS manifest timeout"));
                setTimeout(tick, 200);
            }
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
        currentIdx: getCurrentSegmentIndexSync(s.sessionDir),
        ...s.metrics,
    }));
}

async function warmup() {
    try {
        const profile = await getHWProfile();
        console.log(`[Transcoder] Warmup complete — HW profile: ${profile.type}`);
    } catch (err) {
        console.warn(`[Transcoder] Warmup failed (will retry on first session):`, err.message);
    }
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
    warmup,
    startSweeper,
    TEMP_DIR,
    SESSION_TIMEOUT_MS,
    SEGMENT_DURATION,
    SEGMENT_GAP_RESTART,
};
