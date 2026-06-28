"use strict";

/**
 * epg.js — EPG API Routes
 * Mounted at /api/epg in server.js
 *
 * Public (approved user):
 *   GET  /now
 *   GET  /channel/:id
 *   GET  /schedule/:id
 *   GET  /events
 *   GET  /recommendations
 *
 * Admin only:
 *   GET  /status
 *   GET  /keywords     PUT  /keywords
 *   GET  /sources      POST /sources
 *   DELETE /sources/:id   PATCH /sources/:id
 *   POST /sources/:id/refresh
 *   POST /ingest
 *   GET  /aliases      POST /aliases
 *   DELETE /aliases/:xmltvId
 */

const express = require("express");
const router  = express.Router();

const {
    getNow, getChannelNow, getSchedule,
    getEvents, getRecommendations,
    getStatus, getKeywords, putKeywords,
    listSources, addSource, deleteSource, editSource, refreshSource,
    triggerIngest,
    getAliases, setAlias, removeAlias,
} = require("../controllers/epgController");

const { authenticateJWT }    = require("../auth/middleware/authenticateJWT");
const { requireApprovedUser } = require("../auth/middleware/requireApprovedUser");
const { requireRole }         = require("../auth/middleware/requireRole");

const auth      = [authenticateJWT, requireApprovedUser];
const adminOnly = [...auth, requireRole("admin")];

// ── Public (any approved user) ─────────────────────────────────────────────
router.get("/now",                ...auth, getNow);
router.get("/channel/:id",        ...auth, getChannelNow);
router.get("/schedule/:id",       ...auth, getSchedule);
router.get("/events",             ...auth, getEvents);
router.get("/recommendations",    ...auth, getRecommendations);

// ── Admin only ────────────────────────────────────────────────────────────
router.get("/status",             ...adminOnly, getStatus);

router.get("/keywords",           ...adminOnly, getKeywords);
router.put("/keywords",           ...adminOnly, putKeywords);

router.get("/sources",            ...adminOnly, listSources);
router.post("/sources",           ...adminOnly, addSource);
router.delete("/sources/:id",     ...adminOnly, deleteSource);
router.patch("/sources/:id",      ...adminOnly, editSource);
router.post("/sources/:id/refresh", ...adminOnly, refreshSource);

router.post("/ingest",            ...adminOnly, triggerIngest);

router.get("/aliases",            ...adminOnly, getAliases);
router.post("/aliases",           ...adminOnly, setAlias);
router.delete("/aliases/:xmltvId",...adminOnly, removeAlias);

module.exports = router;
