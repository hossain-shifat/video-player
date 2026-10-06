"use strict";

const express = require("express");
const router = express.Router();
const { getLibraryTrailers, getDiscoverTrailers, refreshTrailers } = require("../controllers/trailerController");

const { optionalJWT, authenticateJWT } = require("../auth/middleware/authenticateJWT");
const { requireApprovedUser } = require("../auth/middleware/requireApprovedUser");

// ?refresh=true forces a full TMDB-backed rebuild — anonymous callers must not be able
// to trigger that. Plain reads stay public; a forced refresh needs authenticated + approved,
// consistent with POST /refresh.
function guardForcedRefresh(req, res, next) {
    if (req.query.refresh !== "true") return next();
    return authenticateJWT(req, res, (err) => (err ? next(err) : requireApprovedUser(req, res, next)));
}

// Public GET routes — same pattern as routes/metadata.js
router.get("/library", optionalJWT, guardForcedRefresh, getLibraryTrailers); // GET  /api/trailers/library?refresh=true (refresh needs auth)
router.get("/discover", optionalJWT, guardForcedRefresh, getDiscoverTrailers); // GET  /api/trailers/discover?refresh=true (refresh needs auth)

// Mutating — require authenticated + approved
router.post("/refresh", authenticateJWT, requireApprovedUser, refreshTrailers); // POST /api/trailers/refresh

module.exports = router;
