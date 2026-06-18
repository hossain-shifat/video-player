"use strict";

/**
 * stream.js — FLUX streaming routes (v2)
 *
 * Single-user self-hosted install — no auth middleware on stream routes.
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
const { streamVideo, serveHLSFile, startTranscode, stopSession, listSessions, streamSubtitle, streamEmbeddedSubtitle, pingSessionHandler } = require("../controllers/streamController");

// No auth — single-user LAN install
router.get("/video/:id", streamVideo);
router.head("/video/:id", streamVideo);

// HLS manifest + segments
// *file named wildcard required by path-to-regexp v8 (Express 5)
router.get("/hls/:sessionId/*file", serveHLSFile);

// Transcode management
router.post("/transcode/:id", startTranscode);
router.delete("/session/:sessionId", stopSession); // legacy
router.delete("/sessions/:sessionId", stopSession); // frontend uses plural
router.post("/sessions/:sessionId/ping", pingSessionHandler);
router.get("/sessions", listSessions);

// Subtitles — NOTE: embedded route MUST be registered before the wildcard :encodedPath route
router.get("/subtitle/embedded/:encodedVideo/:streamIndex", streamEmbeddedSubtitle);
router.get("/subtitle/:encodedPath", streamSubtitle);

module.exports = router;
