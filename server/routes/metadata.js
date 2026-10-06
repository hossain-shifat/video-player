"use strict";

const express = require("express");
const router = express.Router();
const { getOne, refreshOne, refreshAll, parseDebug, getAllEnriched, getSeasonLazy, getTmdbItem } = require("../controllers/metadataController");

const { optionalJWT, authenticateJWT } = require("../auth/middleware/authenticateJWT");
const { requireApprovedUser } = require("../auth/middleware/requireApprovedUser");

// Public GET routes — optionalJWT only
router.get("/parse", optionalJWT, parseDebug); // GET  /api/metadata/parse?filename=xxx
router.get("/enriched", optionalJWT, getAllEnriched); // GET  /api/metadata/enriched

// TMDB + cache side effects — require authenticated + approved
router.get("/tv/:tmdbId/season/:seasonNumber", authenticateJWT, requireApprovedUser, getSeasonLazy); // GET  /api/metadata/tv/:tmdbId/season/:seasonNumber (lazy season load)
router.get("/tmdb/:kind/:tmdbId", authenticateJWT, requireApprovedUser, getTmdbItem); // GET  /api/metadata/tmdb/:kind/:tmdbId (server-side TMDB proxy, keeps the key off the frontend)

router.get("/:id", optionalJWT, getOne); // GET  /api/metadata/:id

// Mutating operations — require authenticated + approved (admin-like operations)
router.post("/refresh-all", authenticateJWT, requireApprovedUser, refreshAll); // POST /api/metadata/refresh-all
router.post("/refresh/:id", authenticateJWT, requireApprovedUser, refreshOne); // POST /api/metadata/refresh/:id

module.exports = router;
