"use strict";

/**
 * stream.js — FLUX streaming routes (v2)
 *
 * Every route below sits behind requirePlaybackAccess: verified e-mail + admin approval +
 * active access + live session, re-checked server-side on each request. Pending users can
 * browse the library but cannot obtain any stream.
 *
 * GET  /stream/video/:id              → smart stream (direct/remux/HLS)
 * HEAD /stream/video/:id              → headers only
 * GET  /stream/hls/:sessionId/*file   → serve HLS m3u8 + segments
 * POST /stream/transcode/:id          → start explicit transcode session
 * DELETE /stream/session/:sessionId   → kill session
 * GET  /stream/sessions               → list active sessions
 * GET  /stream/subtitle/:encodedPath  → serve subtitle (srt→vtt on-the-fly)
 * GET  /stream/subtitle/embedded/:encodedVideo/:streamIndex → extract embedded subtitle via FFmpeg
 */

const express = require("express");
const router = express.Router();
const {
    streamVideo,
    serveHLSFile,
    startTranscode,
    stopSession,
    listSessions,
    streamSubtitle,
    streamEmbeddedSubtitle,
    pingSessionHandler,
    getMediaInfoById,
} = require("../controllers/streamController");
const { requireRole } = require("../auth/middleware/requireRole");
const { requirePlaybackAccess, requireHlsAccess, trackHlsSessionOwner, requireMediaAccess, restrictToLibraryPath } = require("../auth/middleware/requirePlaybackAccess");

// ── HLS manifest + segments + session control ────────────────────────────────
// Declared BEFORE the blanket gate: players fetch these with no headers/cookies, so access is
// the session capability bound to the account that started it (requireHlsAccess), re-checked on
// every request against that account's current status. *file named wildcard = path-to-regexp v8.
router.get("/hls/:sessionId/*file", requireHlsAccess, serveHLSFile);
router.delete("/session/:sessionId", requireHlsAccess, stopSession); // legacy
router.delete("/sessions/:sessionId", requireHlsAccess, stopSession); // frontend uses plural
router.post("/sessions/:sessionId/ping", requireHlsAccess, pingSessionHandler);

// Playback authorization for every other /stream/* route (see requirePlaybackAccess).
router.use(requirePlaybackAccess);

router.get("/video/:id", requireMediaAccess, trackHlsSessionOwner, streamVideo);
router.head("/video/:id", requireMediaAccess, streamVideo);

// Transcode management
router.post("/transcode/:id", requireMediaAccess, trackHlsSessionOwner, startTranscode);
router.get("/sessions", requireRole("admin"), listSessions); // lists every viewer's sessions → admin only

// Subtitles — NOTE: embedded route MUST be registered before the wildcard :encodedPath route
router.get("/subtitle/embedded/:encodedVideo/:streamIndex", restrictToLibraryPath("encodedVideo"), streamEmbeddedSubtitle);
router.get("/subtitle/:encodedPath", restrictToLibraryPath("encodedPath"), streamSubtitle);

// NEW: mediaInfoStore lookup by id — the same cached data persisted to
// data/mediainfo.json. Used as a fallback language source wherever a live
// probe/response is missing a real audio/subtitle language name.
router.get("/mediainfo/:id", requireMediaAccess, getMediaInfoById);

module.exports = router;
