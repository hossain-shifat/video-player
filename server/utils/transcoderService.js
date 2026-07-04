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

// How many segments ahead of current transcode position before we restart.
// Was 24s (Jellyfin's conservative default) — widened to 60s. HLS.js often
// buffers well past 24s ahead during steady playback, which was triggering
// restarts on completely normal playback (not real seeks), and each restart
// briefly exposed the session-not-found race this file's other fixes address.
// 60s still restarts promptly for genuine forward seeks.
const SEGMENT_GAP_RESTART_SECONDS = parseInt(process.env.HLS_GAP_RESTART_SECONDS || "60", 10);
const SEGMENT_GAP_RESTART = Math.ceil(SEGMENT_GAP_RESTART_SECONDS / SEGMENT_DURATION);

// ─── HW Profile Cache ─────────────────────────────────────────────────────────
// detectHW() runs 3–4 test encodes (3–36s total) on first call.
// Cache the result so createSession() never blocks on subsequent plays.
// warmup() pre-populates this; first play hits it otherwise.
let _hwProfileCache = null;
// Set true the first time a hardware-encoded session fails to produce even
// one segment (see the ffmpeg "exit" handler below). Once tripped, every
// subsequent session falls back to CPU automatically — we don't keep
// retrying a hardware path that's already demonstrated it doesn't work on
// this machine (wrong driver, unsupported codec on this GPU generation,
// device permissions, etc).
let _hwBroken = false;

async function getHWProfile() {
    if (_hwBroken) return PROFILES.cpu;
    if (_hwProfileCache) return _hwProfileCache;
    _hwProfileCache = await detectHW();
    return _hwProfileCache;
}

// Called when a hardware-encoded session dies with zero segments produced.
// Exposed on the exports so a future admin endpoint could reset it (e.g.
// after the user fixes their GPU driver and wants to retry hw encoding
// without restarting the whole server process).
function markHWBroken(reason) {
    if (_hwBroken) return;
    _hwBroken = true;
    console.error(`[Transcoder] Hardware encoding disabled for this server session: ${reason}. All future transcodes will use CPU (libx264) until the server restarts.`);
}

function resetHWBroken() {
    _hwBroken = false;
    _hwProfileCache = null;
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
 * segmentPath(videoDir, startNumber) → /tmp/hls/<id>/<videoVariantIndex>/index00042.ts
 * Jellyfin names segments:  <playlistBasename><segNumber>.<ext>
 * We use the same pattern so GetCurrentTranscodingIndex works.
 * videoDir is the VIDEO variant's own subdirectory (sessionDir/<N> where N
 * is the video's position in -var_stream_map — see buildFFmpegArgs, video
 * is always placed last so N === audioTrackCount).
 */
function segmentPath(videoDir, segNumber) {
    const num = String(segNumber).padStart(5, "0");
    return path.join(videoDir, `index${num}.ts`);
}

/**
 * Returns the highest segment index currently on disk for a session's VIDEO
 * variant specifically (not any audio track's segments — those advance on
 * their own and aren't what gap-restart/seek logic cares about).
 * Mirrors Jellyfin's GetCurrentTranscodingIndex().
 * Async version — uses fsp.readdir to avoid blocking the event loop.
 */
async function getCurrentSegmentIndex(videoDir) {
    try {
        const files = (await fsp.readdir(videoDir))
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
function getCurrentSegmentIndexSync(videoDir) {
    try {
        const files = fs
            .readdirSync(videoDir)
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
// ISO 639-2 → human display name, common cases. Shared by both the
// container-level -metadata title tag (read by native players like MX
// Player/VLC) and the HLS var_stream_map name: attribute (read by hls.js/
// browsers) — same function, same output, so every player shows the same
// name regardless of which layer it reads from. Unmapped/missing language
// falls back to "TrackN" (still human-readable, no raw ffmpeg-generated id).
const LANGUAGE_NAMES = {
    eng: "English",
    hin: "Hindi",
    spa: "Spanish",
    fre: "French",
    fra: "French",
    ger: "German",
    deu: "German",
    ita: "Italian",
    jpn: "Japanese",
    kor: "Korean",
    chi: "Chinese",
    zho: "Chinese",
    rus: "Russian",
    por: "Portuguese",
    ara: "Arabic",
    ben: "Bengali",
    tam: "Tamil",
    tel: "Telugu",
    urd: "Urdu",
    tur: "Turkish",
    vie: "Vietnamese",
    tha: "Thai",
    pol: "Polish",
    nld: "Dutch",
    dut: "Dutch",
};

// ISO 639-1 (2-letter) → display name. This maps the codes the library's OWN
// filename parser already produces (fileObj.parsed.languages, e.g. ["hi","en"])
// — that parser is more capable than a simple word-scan (handles abbreviations,
// ordering conventions, more release-naming patterns) and its output is
// already trusted elsewhere in the app (library browser, etc), so it's used
// as the PRIMARY hint source for untagged audio tracks, ahead of the raw
// filename word-scan below. Broad list covering the languages that actually
// show up in real-world release naming.
const ISO_639_1_NAMES = {
    en: "English",
    hi: "Hindi",
    es: "Spanish",
    fr: "French",
    de: "German",
    it: "Italian",
    ja: "Japanese",
    ko: "Korean",
    zh: "Chinese",
    ru: "Russian",
    pt: "Portuguese",
    ar: "Arabic",
    bn: "Bengali",
    ta: "Tamil",
    te: "Telugu",
    ur: "Urdu",
    tr: "Turkish",
    vi: "Vietnamese",
    th: "Thai",
    pl: "Polish",
    nl: "Dutch",
    pa: "Punjabi",
    ml: "Malayalam",
    kn: "Kannada",
    mr: "Marathi",
    gu: "Gujarati",
    or: "Odia",
    as: "Assamese",
    ne: "Nepali",
    si: "Sinhala",
    my: "Burmese",
    km: "Khmer",
    lo: "Lao",
    id: "Indonesian",
    ms: "Malay",
    tl: "Filipino",
    he: "Hebrew",
    fa: "Persian",
    ps: "Pashto",
    sw: "Swahili",
    am: "Amharic",
    ha: "Hausa",
    yo: "Yoruba",
    ig: "Igbo",
    zu: "Zulu",
    af: "Afrikaans",
    el: "Greek",
    sv: "Swedish",
    no: "Norwegian",
    da: "Danish",
    fi: "Finnish",
    is: "Icelandic",
    cs: "Czech",
    sk: "Slovak",
    hu: "Hungarian",
    ro: "Romanian",
    bg: "Bulgarian",
    sr: "Serbian",
    hr: "Croatian",
    bs: "Bosnian",
    sl: "Slovenian",
    mk: "Macedonian",
    sq: "Albanian",
    uk: "Ukrainian",
    be: "Belarusian",
    lt: "Lithuanian",
    lv: "Latvian",
    et: "Estonian",
    ka: "Georgian",
    hy: "Armenian",
    az: "Azerbaijani",
    kk: "Kazakh",
    uz: "Uzbek",
    mn: "Mongolian",
    ku: "Kurdish",
    ca: "Catalan",
    eu: "Basque",
    gl: "Galician",
    cy: "Welsh",
    ga: "Irish",
    mt: "Maltese",
    lb: "Luxembourgish",
    la: "Latin",
    eo: "Esperanto",
};
// Same language words, but as lowercase strings to match against a
// filename rather than a 3-letter ISO code from ffprobe. Dual-audio release
// filenames (the "HDHub4u"-style naming this library has a lot of) almost
// always spell the language out — e.g.
// "...Hindi.5.1-English.ESub.x264..." — even when the actual muxed audio
// streams carry no language tag at all ("und"). Order of appearance in the
// filename reliably matches audio track order in both real examples seen
// in this project so far (Interstellar "[Hindi+English]" → track0=Hindi,
// track1=English; this Fatal Seduction file → track0(6ch)=Hindi,
// track1(2ch)=English), so positional assignment is a safe default.
const LANGUAGE_WORDS = [
    ["hindi", "Hindi"],
    ["english", "English"],
    ["tamil", "Tamil"],
    ["telugu", "Telugu"],
    ["bengali", "Bengali"],
    ["punjabi", "Punjabi"],
    ["malayalam", "Malayalam"],
    ["kannada", "Kannada"],
    ["marathi", "Marathi"],
    ["gujarati", "Gujarati"],
    ["urdu", "Urdu"],
    ["spanish", "Spanish"],
    ["french", "French"],
    ["german", "German"],
    ["japanese", "Japanese"],
    ["korean", "Korean"],
    ["chinese", "Chinese"],
    ["russian", "Russian"],
    ["arabic", "Arabic"],
    ["italian", "Italian"],
    ["portuguese", "Portuguese"],
    ["turkish", "Turkish"],
    ["vietnamese", "Vietnamese"],
    ["thai", "Thai"],
];

/**
 * Scans a filename for language words and returns them in the order they
 * appear, deduplicated. "Dual Audio", "Multi Audio" etc are not language
 * names so they're intentionally absent from LANGUAGE_WORDS above.
 */
function detectLanguagesFromFilename(filename) {
    const lower = filename.toLowerCase();
    const found = [];
    for (const [word, displayName] of LANGUAGE_WORDS) {
        const idx = lower.indexOf(word);
        if (idx === -1) continue;
        found.push({ displayName, pos: idx });
    }
    found.sort((a, b) => a.pos - b.pos);
    // Dedup while preserving first-seen order/position
    const seen = new Set();
    return found.filter((f) => (seen.has(f.displayName) ? false : (seen.add(f.displayName), true))).map((f) => f.displayName);
}

function resolveAudioDisplayName(language, index, filenameHints = [], parsedLanguages = []) {
    // Tier 1: real language tag embedded in the source file itself (most
    // trustworthy — comes straight from the media, not a guess).
    const rawLang = language && language !== "und" ? language.toLowerCase() : null;
    if (rawLang && LANGUAGE_NAMES[rawLang.slice(0, 3)]) return LANGUAGE_NAMES[rawLang.slice(0, 3)];
    // Tier 2: the library scanner's own filename parser (fileObj.parsed.languages,
    // ISO 639-1 codes like "hi"/"en") — more capable than our own word-scan
    // below (handles more naming conventions/abbreviations), and its output
    // is already trusted and shown elsewhere in the app, so prefer it.
    if (parsedLanguages[index] && ISO_639_1_NAMES[parsedLanguages[index].toLowerCase()]) {
        return ISO_639_1_NAMES[parsedLanguages[index].toLowerCase()];
    }
    // Tier 3: our own raw filename word-scan (catches cases the library
    // parser didn't run on yet, or returned nothing for).
    if (filenameHints[index]) return filenameHints[index];
    // Tier 4: no signal anywhere — honest generic fallback, not a guess.
    return `Track${index + 1}`;
}

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
    // Computed once per session, reused by both audio-track-naming call
    // sites below (container -metadata title= AND var_stream_map name:) so
    // untagged ("und") tracks get a real language name pulled from the
    // filename instead of a generic "TrackN" fallback, wherever the
    // filename actually spells it out.
    const filenameLangHints = detectLanguagesFromFilename(path.basename(inputPath));

    // Seek time = source's own true start offset + (startSegment * segmentDuration).
    // mediaInfo.startTimeOffset comes from ffprobe's format.start_time — some
    // source files (particularly MKV remuxes) report a non-zero start_time in
    // their own container metadata. Without accounting for it, a "fresh play"
    // (startSegment=0, seekSeconds=0 below) skipped -ss entirely and let
    // FFmpeg's default demux position — and -copyts's passive PTS
    // preservation — surface that raw container offset as the apparent
    // playback start, which is exactly why some titles opened already
    // seeked to 8min/13min/etc with no resume involved. Always seeking
    // relative to the real start_time fixes this for every case uniformly.
    const sourceStartOffset = Math.max(0, mediaInfo?.startTimeOffset || 0);
    const seekSeconds = sourceStartOffset + startSegment * SEGMENT_DURATION;
    if (sourceStartOffset > 1) {
        // Diagnostic only — helps confirm/deny whether a "random start
        // position" report is this container start_time offset (expected,
        // deliberate) vs. something else (e.g. a resume-position bug)
        // without needing another guess-and-patch round.
        console.log(`[Transcoder] Non-zero source start_time detected: ${sourceStartOffset.toFixed(2)}s for ${path.basename(inputPath)}`);
    }

    const args = [];

    // ── Global ────────────────────────────────────────────────────────────────
    args.push("-hide_banner", "-loglevel", "warning");

    // ── Hardware decode (before -i) ───────────────────────────────────────────
    const hwDecodeArgs = getFFmpegHWDecodeArgs(hw);
    args.push(...hwDecodeArgs);

    // ── Input seek (fast seek before -i) ─────────────────────────────────────
    // Jellyfin: -ss comes from StartTimeTicks converted to seconds, before input.
    // Always issued now (even when seekSeconds would otherwise be 0) so a
    // fresh play explicitly lands on the source's real start_time instead of
    // relying on FFmpeg's default demux behavior, which is what let a non-zero
    // container start_time leak through as the apparent playback position.
    args.push("-ss", String(seekSeconds));

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
        const encoder =
            hw.type === "vaapi"
                ? hw.encodeCodecH264
                : hw.type === "qsv"
                  ? hw.encodeCodecH264
                  : hw.type === "nvenc"
                    ? hw.encodeCodecH264
                    : hw.type === "amf"
                      ? hw.encodeCodecH264
                      : hw.type === "videotoolbox"
                        ? hw.encodeCodecH264
                        : hw.type === "v4l2m2m"
                          ? hw.encodeCodecH264
                          : "libx264";

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
            // CPU_ENCODE_PRESET lets a deployer trade quality for speed on
            // weak hardware (e.g. "superfast"/"ultrafast") without touching
            // code — only relevant when no GPU encoder is available/working.
            // FIX: default bumped veryfast → superfast. This is a personal
            // LAN box with hardware accel currently unavailable (CPU
            // fallback), so every transcode — and especially every resume/
            // seek, which has to cold-start an encode from a brand new
            // position — pays x264's full CPU cost. superfast is still a
            // perfectly reasonable quality/size tradeoff, just noticeably
            // faster than veryfast. Still overridable via env var.
            const cpuPreset = process.env.CPU_ENCODE_PRESET || "superfast";
            args.push("-preset", cpuPreset, "-profile:v", "high", "-level", "4.1");
            // rc-lookahead is a SEPARATE latency source from -preset: x264
            // buffers this many frames internally before it can emit the
            // FIRST encoded frame, adding pure startup delay regardless of
            // encode speed — this is exactly the "resume takes a while"
            // symptom, since a resume/seek always cold-starts a new encode
            // pipeline that has to fill this buffer before anything can be
            // muxed into segment 0. Default x264 lookahead is ~40 frames
            // (~1.6s @ 24fps) on top of actual encode time; cutting it to 10
            // frames removes most of that fixed startup tax. ref=1 (single
            // reference frame instead of the preset's default 2-4) trims a
            // little more per-frame encode cost — a fine tradeoff for a
            // personal server prioritizing playback start speed over
            // squeezing out maximum compression efficiency.
            args.push("-x264-params", "rc-lookahead=10:ref=1");
        } else if (encoder === "h264_nvenc") {
            args.push("-preset", "p4", "-rc", "vbr");
        } else if (encoder === "h264_qsv") {
            args.push("-preset", "faster", "-look_ahead", "0");
        } else if (encoder === "h264_vaapi") {
            args.push("-rc_mode", "VBR");
        } else if (encoder === "h264_amf") {
            // quality=speed prioritizes encode speed over compression
            // efficiency — the right tradeoff here since the whole point of
            // using AMF is cutting transcode/resume latency on the Vega
            // iGPU rather than squeezing out maximum quality-per-bitrate.
            args.push("-quality", "speed", "-rc", "vbr_latency");
        } else if (encoder === "h264_videotoolbox") {
            // VideoToolbox has no x264-style preset knob — realtime:1 tells
            // it to prioritize encode speed, which is what matters for
            // fast time-to-first-segment on a resume/seek.
            args.push("-realtime", "1");
        } else if (encoder === "h264_v4l2m2m") {
            // ARM SBC hardware encoders (Raspberry Pi etc) are fixed-function
            // and don't expose a quality/speed preset — nothing extra needed.
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

    // ── Audio streams (ALL tracks, multi-audio support) ───────────────────────
    // Per-track decision: copy when the codec is already safe to mux directly
    // into an MPEG-TS segment (aac/mp3 only — narrower than the general
    // BROWSER_AUDIO_CODECS set used elsewhere for direct-play container
    // eligibility, since TS specifically only tolerates a small codec set
    // regardless of what a browser could decode in an MP4/WebM context).
    // Anything else (ac3, dts, truehd, flac, opus, pcm, vorbis, eac3, etc)
    // gets transcoded to AAC — but ONLY that track, not all of them, keeping
    // CPU usage proportional to how many tracks actually need conversion.
    const TS_SAFE_AUDIO_CODECS = new Set(["aac", "mp3"]);
    const allAudioTracks = mediaInfo?.audio || [];
    const hasAudio = allAudioTracks.length > 0;
    const hasVideo = Boolean(mediaInfo?.video);

    if (decision.decision === DECISION.DIRECT_STREAM && hasAudio && allAudioTracks.length <= 1) {
        // Single-audio-track DIRECT_STREAM stays on the simple path (no
        // -var_stream_map needed — there's nothing to switch between).
        // FIX: previously this branch caught EVERY DIRECT_STREAM file
        // regardless of track count, which is why dual-audio files whose
        // video+primary-audio were already browser-compatible (common for
        // h264+aac remuxes) never got an audio track LIST at all — the
        // player had nothing to switch to even though the file genuinely
        // had multiple dubs. Multi-track files now fall through to the
        // same -var_stream_map multi-audio block used by AUDIO_TRANSCODE/
        // FULL_TRANSCODE below (video keeps its DIRECT_STREAM "-c:v copy"
        // from above — this only changes how AUDIO is mapped, video re-encode
        // cost is unaffected).
        const primaryAudio = allAudioTracks.find((a) => a.default) || allAudioTracks[0];
        const audioNeedsXcod = !TS_SAFE_AUDIO_CODECS.has(primaryAudio.codec);
        if (audioNeedsXcod) {
            args.push("-c:a", "aac", "-b:a", "192k", "-ac", "2");
        } else {
            args.push("-c:a", "copy");
        }
    }
    // Full/audio transcode multi-audio mapping happens further down, after
    // the video args are finalized — see the "Multi-audio stream mapping"
    // block below, since -var_stream_map needs to know about both video AND
    // every audio stream's index together. DIRECT_STREAM with >1 audio track
    // now also takes this path (see isMultiAudioPath below).

    // ── Strip subtitles / metadata / chapters ─────────────────────────────────
    args.push("-sn");
    args.push("-map_metadata", "-1");
    args.push("-map_chapters", "-1");

    const isMultiAudioPath = (mediaInfo?.audio || []).length > 1 || (decision.decision !== DECISION.DIRECT_STREAM && (mediaInfo?.audio || []).length > 0);

    if (!isMultiAudioPath) {
        // Single audio track (any decision type): original simple behavior
        // unchanged (see the audio block above for the -c:a decision).
        if (hasVideo) args.push("-map", "0:v:0");
        const primaryAudio = allAudioTracks.find((a) => a.default) || allAudioTracks[0];
        if (hasAudio && primaryAudio?.index != null) {
            args.push("-map", `0:${primaryAudio.index}?`);
        } else if (hasAudio) {
            args.push("-map", "0:a:0?");
        }

        args.push("-max_delay", "5000000");
        args.push("-max_muxing_queue_size", "2048");
        args.push("-threads", "0");

        args.push("-f", "hls");
        args.push("-hls_time", String(SEGMENT_DURATION));
        args.push("-hls_playlist_type", "event");
        args.push("-hls_list_size", "0");
        args.push("-start_number", String(startSegment));
        args.push("-hls_segment_type", "mpegts");
        args.push("-hls_flags", "independent_segments");
        args.push("-hls_segment_filename", path.join(outputDir, "index%05d.ts"));
        args.push("-hls_allow_cache", "1");
        args.push("-y", path.join(outputDir, "index.m3u8"));

        return args;
    }

    // ── Multi-audio stream mapping (FULL_TRANSCODE / AUDIO_TRANSCODE) ─────────
    // One -map per audio track (global stream index, same fix as before —
    // ffprobe's index is the GLOBAL stream position, not the Nth-audio-
    // relative position "0:a:N" would mean), each with ITS OWN -c:a:K codec
    // decision so only tracks that actually need conversion get transcoded.
    // All audio tracks join the same agroup so the player sees one set of
    // alternate audio renditions for the single video variant.
    if (hasVideo) args.push("-map", "0:v:0");

    const AGROUP = "audio";
    allAudioTracks.forEach((track, i) => {
        args.push("-map", `0:${track.index}?`);
        // FIX: previously this used "-c:a:K copy" whenever a track's source
        // codec was already TS-safe (aac/mp3), to save CPU. That optimization
        // is what was causing "switching audio resets to 0:00 / freezes /
        // won't resume" on real multi-track files: a copied track keeps its
        // ORIGINAL container timestamps/sample-rate/frame-size, which don't
        // necessarily cut into HLS segments on the exact same boundaries as
        // the re-encoded video (or a differently-parameterized copied audio
        // track) — e.g. a track observed generating ~3x as many segments as
        // the video for the same span. Once the two renditions' segment
        // indices no longer correspond to the same media time 1:1, HLS.js's
        // program_date_time correlation (added earlier for exactly this
        // problem) has nothing consistent to correlate, and it falls back to
        // its internal re-seek behavior — which is what actually froze/reset
        // playback. Forcing every track through the SAME encoder with the
        // SAME output sample rate/channel layout guarantees every rendition
        // (video's audio-less segments aside) cuts on identical boundaries.
        // This trades a little CPU for correctness — the right call for a
        // personal LAN server where reliability matters more than shaving
        // encode time off an already-compatible audio track.
        // FIX (real bug, pre-existing): "-ac:${i}" is missing the "a:" type
        // specifier, so ffmpeg reads it as "output stream index i" (any
        // type), not "the i-th AUDIO stream". Since video is mapped BEFORE
        // the audio tracks above, absolute output order is
        // 0=video, 1=track0(hin), 2=track1(eng) — so "-ac:0" silently no-ops
        // on the video stream, "-ac:1" hits track0 (harmless if it's already
        // stereo), and the LAST audio track never gets a channel-count flag
        // at all (loop only reaches i=0..N-1, never N). A 5.1/multichannel
        // source track (like this file's English AC3 5.1) then gets encoded
        // as multichannel AAC instead of being downmixed — which Chrome's
        // MSE/HLS.js can't reliably decode, so that track silently produces
        // no playable frames. "-ac:a:${i}" (matching -c:a:${i}/-b:a:${i}
        // above) correctly targets the i-th AUDIO stream regardless of
        // where video sits in the map order.
        args.push(`-c:a:${i}`, "aac", `-b:a:${i}`, "192k", `-ac:a:${i}`, "2", `-ar:a:${i}`, "48000");
        // Dual-audio releases routinely have each dub authored at a
        // different loudness (Hindi dub mixed hotter than the English 5.1
        // mix is common), and a straight 5.1→stereo downmix can end up a
        // few dB quieter than a native stereo track even when done
        // correctly. Neither is a bug in our pipeline — it's baked into the
        // source file — so the fix is normalizing OUR output, not chasing
        // per-file mix levels. Single-pass loudnorm (EBU R128, -16 LUFS
        // target — the standard streaming loudness target) applied to every
        // audio track uniformly means switching between ANY two tracks on
        // ANY file lands at the same perceived volume, regardless of how
        // the original dub was mixed or how many channels it started with.
        args.push(`-filter:a:${i}`, "loudnorm=I=-16:TP=-1.5:LRA=11");
        // Tag each output audio stream with its language so the HLS muxer
        // writes LANGUAGE= into the EXT-X-MEDIA rendition tag — this is what
        // lets browsers/hls.js show "English"/"Hindi"/etc instead of a
        // generic label.
        if (track.language && track.language !== "und") {
            args.push(`-metadata:s:a:${i}`, `language=${track.language}`);
        }
        // FIX: native players (MX Player, VLC, etc.) commonly read the
        // display name from the CONTAINER's own embedded stream metadata
        // (title/language tags baked into the .ts stream) rather than the
        // HLS manifest's NAME= attribute the way hls.js/browsers do. A file
        // with no source language tag ("und") was getting no metadata at
        // all here, so those players fell back to their own generic
        // "audio_0"/"audio_1" labels even though the manifest-level name:
        // (below) was already correct. Always stamp a title — real language
        // name when known, "TrackN" fallback otherwise — so every player,
        // manifest-reading or container-metadata-reading, shows the same
        // sensible name.
        args.push(`-metadata:s:a:${i}`, `title=${resolveAudioDisplayName(track.language, i, filenameLangHints, mediaInfo?.parsedLanguages || [])}`);
    });

    // ── Muxer stability ───────────────────────────────────────────────────────
    args.push("-max_delay", "5000000");
    args.push("-max_muxing_queue_size", "2048");
    args.push("-threads", "0");

    // ── HLS output (multi-audio master playlist) ──────────────────────────────
    args.push("-f", "hls");
    args.push("-hls_time", String(SEGMENT_DURATION));
    args.push("-hls_playlist_type", "event");
    args.push("-hls_list_size", "0");
    args.push("-start_number", String(startSegment));
    args.push("-hls_segment_type", "mpegts");
    // program_date_time gives HLS.js an absolute-time anchor to correlate
    // segment positions ACROSS the separate audio/video rendition playlists
    // in this multi-audio layout — without it, HLS.js infers alignment
    // purely from segment index/duration math, and any drift between the
    // video rendition (slower, real encode) and audio renditions (fast
    // copy/encode) makes it fall back to re-seeking the whole player to
    // find a position where both tracks have buffered data — surfacing as
    // "switching audio resets playback to 0:00".
    args.push("-hls_flags", "independent_segments+program_date_time");

    // %v resolves to each variant's NUMERIC position in -var_stream_map
    // (0, 1, 2... in declaration order — NOT a name like "v0"/"a0"). Since
    // audio entries are listed first below, audio tracks land at %v=0..N-1
    // and video lands at %v=N (== allAudioTracks.length). FFmpeg creates
    // these numbered subdirectories automatically from the %v pattern, and
    // the caller also pre-creates them explicitly as extra insurance.
    args.push("-hls_segment_filename", path.join(outputDir, "%v", "index%05d.ts"));
    args.push("-hls_allow_cache", "1");
    args.push("-master_pl_name", "master.m3u8");

    // -var_stream_map ties the video variant + every audio track together.
    // Audio entries listed FIRST so the video variant's %v index is always
    // allAudioTracks.length — predictable for getCurrentSegmentIndex and
    // serveHLSFile to calculate without needing to parse the map string.
    // Syntax confirmed from FFmpeg hlsenc.c source + production examples:
    //   "a:0,agroup:audio,default:1,language:ENG,name:English a:1,agroup:audio,default:0,language:HIN,name:Hindi v:0,agroup:audio"
    const varStreamParts = [];
    allAudioTracks.forEach((track, i) => {
        const isDefault = track.default || i === 0;
        const lang = track.language && track.language !== "und" ? track.language.slice(0, 3).toUpperCase() : "UND";
        const displayName = resolveAudioDisplayName(track.language, i, filenameLangHints, mediaInfo?.parsedLanguages || []);
        varStreamParts.push(`a:${i},agroup:${AGROUP},default:${isDefault ? 1 : 0},language:${lang},name:${displayName}`);
    });
    varStreamParts.push(`v:0,agroup:${AGROUP}`);
    args.push("-var_stream_map", varStreamParts.join(" "));

    // Output: video lands at index allAudioTracks.length, audio tracks at 0..N-1.
    // Example with 2 audio tracks:
    //   outputDir/0/index.m3u8  (Hindi audio segments)
    //   outputDir/1/index.m3u8  (English audio segments)
    //   outputDir/2/index.m3u8  (video segments)
    //   outputDir/master.m3u8   (master playlist)
    args.push("-y", path.join(outputDir, "%v", "index.m3u8"));

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
async function createSession({ mediaId, filePath, decision, mediaInfo, startSegment = 0, reuseSessionId = null }) {
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
        return await _createSessionInternal({ mediaId, filePath, decision, mediaInfo, startSegment, sharedKey, reuseSessionId });
    } finally {
        _startLocks.delete(sharedKey);
        resolveLock();
    }
}

async function _createSessionInternal({ mediaId, filePath, decision, mediaInfo, startSegment, sharedKey, reuseSessionId = null }) {
    if (sessions.size >= MAX_SESSIONS) {
        await evictOldestSession();
    }

    // (sharedKey already computed by createSession wrapper)

    // Reuse running session if same content+quality and segment is within range
    for (const [, s] of sessions) {
        if (s._sharedKey === sharedKey && s.status === "running" && s.mediaId === mediaId) {
            const currentIdx = await getCurrentSegmentIndex(s.videoDir);
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

    const sessionId = reuseSessionId || makeSessionId();
    const sessionDir = path.join(TEMP_DIR, sessionId);
    // If reusing an ID, the old directory was already removed by kill() —
    // recreate() is safe either way since mkdir is recursive.
    await fsp.mkdir(sessionDir, { recursive: true });

    // Pre-create one subdirectory per variant (audio tracks 0..N-1, video
    // at index N) for the multi-audio HLS layout. FFmpeg's %v pattern is
    // documented to auto-create these, but doing it explicitly here avoids
    // relying on that across FFmpeg versions/platforms.
    {
        const audioCount = (mediaInfo?.audio || []).length;
        const isMultiAudio = audioCount > 1 || (decision.decision !== DECISION.DIRECT_STREAM && audioCount > 0);
        const variantCount = !isMultiAudio || audioCount === 0 ? 0 : audioCount + 1; // +1 for video
        for (let v = 0; v < variantCount; v++) {
            await fsp.mkdir(path.join(sessionDir, String(v)), { recursive: true });
        }
    }

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

    const isMultiAudioPath = (mediaInfo?.audio || []).length > 1 || (decision.decision !== DECISION.DIRECT_STREAM && (mediaInfo?.audio || []).length > 0);
    const audioTrackCount = (mediaInfo?.audio || []).length;
    // buildFFmpegArgs), so its %v index is predictably audioTrackCount.
    const videoVariantIndex = audioTrackCount;
    const videoDir = isMultiAudioPath ? path.join(sessionDir, String(videoVariantIndex)) : sessionDir;
    const masterPlaylistPath = isMultiAudioPath ? path.join(sessionDir, "master.m3u8") : path.join(sessionDir, "index.m3u8");

    const session = {
        id: sessionId,
        mediaId,
        filePath,
        sessionDir,
        isMultiAudioPath,
        audioTrackCount,
        videoVariantIndex,
        videoDir,
        m3u8Path: masterPlaylistPath,
        ffmpegProcess,
        lastAccessedAt: Date.now(),
        decision: decision.decision,
        params: decision.params,
        startSegment,
        status: "starting",
        _sharedKey: sharedKey,
        // Tracks how far the player has consumed (for segment cleaner)
        downloadPositionSec: startSegment * SEGMENT_DURATION,
        // Timestamp of the most recent audio-rendition segment request (multi-
        // audio sessions only). Used by streamController's video gap-restart
        // check to recognize "HLS.js is mid-resync from an audio track switch"
        // and avoid mistaking that resync's own video segment request for a
        // genuine user seek.
        lastAudioActivityAt: 0,

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

                // ── Hardware-encoder failure auto-fallback ──────────────────
                // If this session used a hardware encoder and produced ZERO
                // segments before dying, that's a strong signal the hardware
                // path itself is broken (bad driver, unsupported codec on
                // this GPU, device permissions) rather than a one-off glitch
                // mid-stream. Disable hw encoding process-wide and silently
                // retry THIS session on CPU, reusing the same session id so
                // the client's existing manifest URL keeps working — from
                // the player's point of view this just looks like a slightly
                // slow start, not an error.
                const usedHW = hwProfile.type !== "cpu";
                getCurrentSegmentIndex(videoDir).then((idx) => {
                    const producedNothing = idx === null;
                    if (usedHW && producedNothing && !_hwBroken) {
                        markHWBroken(`${hwProfile.type} encoder failed for session ${sessionId} (exit ${code})`);
                        console.warn(`[Transcoder] Retrying session ${sessionId} on CPU after hardware failure`);
                        fsp.rm(sessionDir, { recursive: true, force: true })
                            .catch(() => {})
                            .then(() =>
                                _createSessionInternal({
                                    mediaId,
                                    filePath,
                                    decision,
                                    mediaInfo,
                                    startSegment,
                                    sharedKey,
                                    reuseSessionId: sessionId,
                                }),
                            )
                            .catch((retryErr) => console.error(`[Transcoder] CPU fallback retry failed for ${sessionId}:`, retryErr.message));
                    } else {
                        // Normal failure path (or hw already known broken, or
                        // some segments did get produced) — just clean up.
                        setTimeout(() => sessions.delete(sessionId), 10_000);
                    }
                });
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
        currentIdx: getCurrentSegmentIndexSync(s.videoDir),
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
    markHWBroken,
    resetHWBroken,
    TEMP_DIR,
    SESSION_TIMEOUT_MS,
    SEGMENT_DURATION,
    SEGMENT_GAP_RESTART,
};
