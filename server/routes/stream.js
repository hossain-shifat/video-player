"use strict";

/**
 * stream.js — FLUX streaming routes (v2)
 *
 * GET  /stream/video/:id              → smart stream (direct/remux/HLS)
 * HEAD /stream/video/:id              → headers only
 * GET  /stream/hls/:sessionId/*file   → serve HLS m3u8 + segments
 * POST /stream/transcode/:id          → start explicit transcode session
 * DELETE /stream/session/:sessionId   → kill session
 * GET  /stream/sessions               → list active sessions (admin)
 * GET  /stream/subtitle/:encodedPath  → serve subtitle (srt→vtt on-the-fly)
 */

const express = require("express");
const router = express.Router();
const { streamVideo, serveHLSFile, startTranscode, stopSession, listSessions, streamSubtitle, pingSessionHandler } = require("../controllers/streamController");

// Direct play / smart stream
router.get("/video/:id", streamVideo);
router.head("/video/:id", streamVideo);

// HLS manifest + segments
// *file named wildcard required by path-to-regexp v8 (Express 5)
// req.params.file will be "index.m3u8" or "seg00003.ts" etc.
router.get("/hls/:sessionId/*file", serveHLSFile);

// Transcode management
router.post("/transcode/:id", startTranscode);
router.delete("/session/:sessionId", stopSession); // legacy singular
router.delete("/sessions/:sessionId", stopSession); // frontend uses plural
router.post("/sessions/:sessionId/ping", pingSessionHandler); // heartbeat
router.get("/sessions", listSessions);

// Subtitles
router.get("/subtitle/:encodedPath", streamSubtitle);

module.exports = router;
