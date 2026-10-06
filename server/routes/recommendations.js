"use strict";

const express = require("express");
const router = express.Router();
const { getRecommendations, refreshRecommendations } = require("../controllers/recommendationController");

const { authenticateJWT } = require("../auth/middleware/authenticateJWT");
const { requireApprovedUser } = require("../auth/middleware/requireApprovedUser");

// Auth guard — same pattern as routes/user.js (favourites/watchlist).
// Recommendations are personal state, never anonymous — unlike history.js,
// which intentionally allows unauthenticated per-device saves, this hard-
// requires a real logged-in + approved account for every request.
router.use(authenticateJWT, requireApprovedUser);

router.get("/", getRecommendations); // GET  /api/recommendations
router.post("/refresh", refreshRecommendations); // POST /api/recommendations/refresh

module.exports = router;
