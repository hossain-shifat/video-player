"use strict";

/**
 * streamingEngine.js
 * Playback Decision Engine for FLUX.
 *
 * Decision priority:
 *   1. Direct Play        — serve original file via range request
 *   2. Direct Stream      — remux container only, no re-encoding
 *   3. Audio Transcode    — remux video, transcode audio only
 *   4. Full Transcode     — HLS with FFmpeg re-encoding
 *
 * Decision is based on client capabilities passed in the request.
 */

const path = require("path");
const mime = require("mime-types");

// ─── Supported Codec / Container Sets ────────────────────────────────────────

// ─── Container Name Normalization ────────────────────────────────────────────
const FORMAT_NAME_MAP = {
    matroska: "mkv",
    webm: "webm",
    mov: "mp4",
    mp4: "mp4",
    m4a: "mp4",
    "3gp": "mp4",
    ogg: "ogg",
    avi: "avi",
    flv: "flv",
    mpeg: "mpeg",
    mpg: "mpeg",
    m2ts: "m2ts",
    ts: "ts",
    wmv: "wmv",
};

function normalizeContainer(ffprobeFormatName) {
    const first = (ffprobeFormatName || "").split(",")[0].toLowerCase().trim();
    return FORMAT_NAME_MAP[first] || first;
}

// Codecs natively supported by modern browsers
const BROWSER_VIDEO_CODECS = new Set(["h264", "avc", "vp8", "vp9", "av1"]);
const BROWSER_AUDIO_CODECS = new Set(["aac", "mp3", "opus", "vorbis", "flac", "pcm_s16le"]);

// FIX 1: MKV removed from DIRECT_PLAY containers.
// Chrome cannot reliably range-stream MKV — it fails on seeking and often
// throws DEMUXER_ERROR_COULD_NOT_OPEN. MKV files must go through HLS remux.
// Only mp4 and webm are safe for direct byte-range streaming in Chrome.
const DIRECT_PLAY_CONTAINERS = new Set(["mp4", "webm"]);

// Containers that can be remuxed losslessly into HLS MPEG-TS
const BROWSER_CONTAINERS = new Set(["mp4", "webm", "mkv", "ogg"]);

// Codecs that require re-encoding
const UNSUPPORTED_VIDEO_CODECS = new Set(["hevc", "h265", "vc1", "wmv", "mpeg2video", "mpeg4", "divx", "xvid", "theora"]);
const UNSUPPORTED_AUDIO_CODECS = new Set(["dts", "truehd", "ac3", "eac3", "pcm_s24le", "pcm_dvd"]);

// Containers that can be remuxed (container fix, no codec re-encode needed)
const REMUXABLE_TO_MP4 = new Set(["avi", "mov", "ts", "m2ts", "wmv", "flv", "mpeg", "mpg"]);

// ─── Decision Types ───────────────────────────────────────────────────────────

const DECISION = {
    DIRECT_PLAY: "direct_play",
    DIRECT_STREAM: "direct_stream",
    AUDIO_TRANSCODE: "audio_transcode",
    FULL_TRANSCODE: "full_transcode",
};

// ─── Codec Name Normalization ─────────────────────────────────────────────────

const CODEC_ALIASES = {
    h264: ["h.264", "avc"],
    h265: ["h.265", "hevc", "hvc1"],
    vp9: ["vp90"],
    mp3: ["libmp3lame"],
};

function normalizeCodec(rawName) {
    const name = (rawName || "").toLowerCase().trim();
    for (const [canonical, aliases] of Object.entries(CODEC_ALIASES)) {
        if (name === canonical || aliases.includes(name)) return canonical;
    }
    return name;
}

// ─── Media Info Parser ────────────────────────────────────────────────────────

function extractMediaInfo(probeData) {
    const streams = probeData.streams || [];
    const format = probeData.format || {};

    const videoStream = streams.find((s) => s.codec_type === "video");
    const audioStreams = streams.filter((s) => s.codec_type === "audio");
    const subtitleStreams = streams.filter((s) => s.codec_type === "subtitle");

    const container = normalizeContainer(format.format_name);
    const durationSec = parseFloat(format.duration) || 0;
    const sizeMB = (parseInt(format.size) || 0) / (1024 * 1024);
    // Some containers (notably certain MKV remuxes) report a non-zero
    // start_time — without accounting for this, the transcoder can end up
    // opening playback at this offset instead of true 0:00. See its usage
    // in transcoderService.js's buildFFmpegArgs (sourceStartOffset).
    const startTimeOffset = parseFloat(format.start_time) || 0;

    return {
        container,
        duration: durationSec,
        sizeMB,
        startTimeOffset,
        video: videoStream
            ? {
                  codec: normalizeCodec(videoStream.codec_name),
                  profile: videoStream.profile || "",
                  width: videoStream.width || 0,
                  height: videoStream.height || 0,
                  fps: videoStream.r_frame_rate || "25/1",
                  bitrate: parseInt(videoStream.bit_rate) || 0,
                  pixFmt: videoStream.pix_fmt || "yuv420p",
                  isHDR: (videoStream.color_transfer || "").includes("smpte2084") || (videoStream.color_space || "").includes("bt2020"),
              }
            : null,
        audio: audioStreams.map((s) => ({
            index: s.index,
            codec: normalizeCodec(s.codec_name),
            channels: s.channels || 2,
            language: s.tags?.language || "und",
            bitrate: parseInt(s.bit_rate) || 0,
            default: !!s.disposition?.default,
        })),
        subtitles: subtitleStreams.map((s) => ({
            index: s.index,
            codec: normalizeCodec(s.codec_name),
            language: s.tags?.language || "und",
            forced: !!s.disposition?.forced,
        })),
    };
}

// ─── Decision Engine ──────────────────────────────────────────────────────────

function decidePlayback(mediaInfo, clientCaps = {}, options = {}) {
    if (!mediaInfo) {
        return { decision: DECISION.FULL_TRANSCODE, reason: "no_media_info", params: {} };
    }

    const { video, audio, container } = mediaInfo;
    const { forceTranscode, quality, subtitleMode } = options;

    if (forceTranscode) {
        return {
            decision: DECISION.FULL_TRANSCODE,
            reason: "forced",
            params: { quality: quality || "1080p" },
        };
    }

    // Audio-only file
    if (!video) {
        const hasAudio = audio.length > 0;
        const audioOk = hasAudio && BROWSER_AUDIO_CODECS.has(audio[0].codec);
        if (audioOk && DIRECT_PLAY_CONTAINERS.has(container)) {
            return { decision: DECISION.DIRECT_PLAY, reason: "audio_direct", params: {} };
        }
        return { decision: DECISION.AUDIO_TRANSCODE, reason: "audio_codec_unsupported", params: {} };
    }

    // ── Capability checks ─────────────────────────────────────────────────────
    const videoCodecOk = BROWSER_VIDEO_CODECS.has(video.codec);
    const videoCodecBad = UNSUPPORTED_VIDEO_CODECS.has(video.codec);

    const clientMaxHeight = clientCaps.maxHeight || 2160;
    const resolutionOk = video.height <= clientMaxHeight;

    // HDR requires tone-mapping if client can't handle it
    const hdrOk = !video.isHDR || clientCaps.hdrSupport;

    const primaryAudio = audio.find((a) => a.default) || audio[0];
    const audioCodecOk = !primaryAudio || BROWSER_AUDIO_CODECS.has(primaryAudio?.codec);
    const audioCodecBad = primaryAudio && UNSUPPORTED_AUDIO_CODECS.has(primaryAudio?.codec);

    // FIX 1: Use DIRECT_PLAY_CONTAINERS (mp4, webm only) not BROWSER_CONTAINERS.
    // MKV causes DEMUXER_ERROR_COULD_NOT_OPEN in Chrome range streaming.
    const containerDirectOk = DIRECT_PLAY_CONTAINERS.has(container);
    const containerRemuxable = REMUXABLE_TO_MP4.has(container) || BROWSER_CONTAINERS.has(container);

    const needsBurnIn = subtitleMode === "burn";

    // ── Decision logic ────────────────────────────────────────────────────────

    // DIRECT PLAY: mp4/webm only, all codecs browser-safe
    if (videoCodecOk && audioCodecOk && containerDirectOk && resolutionOk && hdrOk && !needsBurnIn) {
        return { decision: DECISION.DIRECT_PLAY, reason: "all_compatible", params: {} };
    }

    // DIRECT STREAM: video+audio codecs ok, container needs remux to HLS
    // FIX 2: guard audioCodecOk — don't copy AC3/DTS into TS segments.
    // If audio is bad, fall through to AUDIO_TRANSCODE or FULL_TRANSCODE.
    if (videoCodecOk && audioCodecOk && !containerDirectOk && containerRemuxable && resolutionOk && hdrOk && !needsBurnIn) {
        return {
            decision: DECISION.DIRECT_STREAM,
            reason: "container_remux",
            params: { outputContainer: "mp4" },
        };
    }

    // AUDIO TRANSCODE: video codec ok, audio needs transcoding, container remuxable
    // FIX 3: added containerRemuxable guard — can't AUDIO_TRANSCODE if container
    // itself can't be muxed into MPEG-TS (e.g. raw MPEG, obscure formats).
    if (videoCodecOk && audioCodecBad && containerRemuxable && resolutionOk && hdrOk && !needsBurnIn) {
        return {
            decision: DECISION.AUDIO_TRANSCODE,
            reason: "audio_codec_unsupported",
            params: {
                audioCodec: "aac",
                audioBitrate: Math.min((primaryAudio?.bitrate || 192000) / 1000, 320),
                outputContainer: "mp4",
            },
        };
    }

    // FULL TRANSCODE: video codec unsupported, HDR, resolution cap, or burn-in
    const reasons = [];
    if (videoCodecBad || !videoCodecOk) reasons.push("video_codec");
    if (audioCodecBad && !containerRemuxable) reasons.push("audio_codec");
    if (!resolutionOk) reasons.push("resolution");
    if (!hdrOk) reasons.push("hdr");
    if (needsBurnIn) reasons.push("subtitle_burn");

    const targetHeight = Math.min(video.height, clientMaxHeight);
    const targetQuality = quality || heightToQualityLabel(targetHeight);

    return {
        decision: DECISION.FULL_TRANSCODE,
        reason: reasons.join("+") || "full_transcode",
        params: {
            quality: targetQuality,
            videoCodec: "h264",
            audioCodec: "aac",
            audioBitrate: 192,
            subtitleMode: subtitleMode || "none",
        },
    };
}

function heightToQualityLabel(h) {
    if (h >= 2160) return "4k";
    if (h >= 1080) return "1080p";
    if (h >= 720) return "720p";
    if (h >= 480) return "480p";
    return "360p";
}

// ─── Quality Presets ──────────────────────────────────────────────────────────

const QUALITY_PRESETS = {
    "4k": { width: 3840, height: 2160, videoBitrate: "20000k", maxrate: "25000k", bufsize: "40000k", audioBitrate: "320k" },
    "1080p": { width: 1920, height: 1080, videoBitrate: "8000k", maxrate: "10000k", bufsize: "16000k", audioBitrate: "192k" },
    "720p": { width: 1280, height: 720, videoBitrate: "4000k", maxrate: "5000k", bufsize: "8000k", audioBitrate: "192k" },
    "480p": { width: 854, height: 480, videoBitrate: "1500k", maxrate: "2000k", bufsize: "3000k", audioBitrate: "128k" },
    "360p": { width: 640, height: 360, videoBitrate: "800k", maxrate: "1200k", bufsize: "2000k", audioBitrate: "96k" },
};

module.exports = {
    DECISION,
    QUALITY_PRESETS,
    extractMediaInfo,
    decidePlayback,
    BROWSER_VIDEO_CODECS,
    BROWSER_AUDIO_CODECS,
    BROWSER_CONTAINERS,
};
