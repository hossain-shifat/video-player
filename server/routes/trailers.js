"use strict";

const express = require("express");
const router = express.Router();
const { getLibraryTrailers, getDiscoverTrailers, refreshTrailers } = require("../controllers/trailerController");

const { optionalJWT, authenticateJWT } = require("../auth/middleware/authenticateJWT");
const { requireApprovedUser } = require("../auth/middleware/requireApprovedUser");

// Public GET routes — same pattern as routes/metadata.js
router.get("/library", optionalJWT, getLibraryTrailers); // GET  /api/trailers/library
router.get("/discover", optionalJWT, getDiscoverTrailers); // GET  /api/trailers/discover?refresh=true

// Mutating — require authenticated + approved
router.post("/refresh", authenticateJWT, requireApprovedUser, refreshTrailers); // POST /api/trailers/refresh

module.exports = router;
