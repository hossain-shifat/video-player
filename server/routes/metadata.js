"use strict";

const express = require("express");
const router = express.Router();
const { getOne, refreshOne, refreshAll, parseDebug, getAllEnriched, getSeasonLazy } = require("../controllers/metadataController");

const { optionalJWT, authenticateJWT } = require("../auth/middleware/authenticateJWT");
const { requireApprovedUser } = require("../auth/middleware/requireApprovedUser");

// Public GET routes — optionalJWT only
router.get("/parse", optionalJWT, parseDebug); // GET  /api/metadata/parse?filename=xxx
router.get("/enriched", optionalJWT, getAllEnriched); // GET  /api/metadata/enriched
router.get("/tv/:tmdbId/season/:seasonNumber", optionalJWT, getSeasonLazy); // GET  /api/metadata/tv/:tmdbId/season/:seasonNumber (lazy season load)
router.get("/:id", optionalJWT, getOne); // GET  /api/metadata/:id

// Mutating operations — require authenticated + approved (admin-like operations)
router.post("/refresh-all", authenticateJWT, requireApprovedUser, refreshAll); // POST /api/metadata/refresh-all
router.post("/refresh/:id", authenticateJWT, requireApprovedUser, refreshOne); // POST /api/metadata/refresh/:id

module.exports = router;
