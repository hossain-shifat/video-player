"use strict";

const express = require("express");
const router = express.Router();
const { getAllMedia, getMediaById, searchMedia, getMediaSubtitles } = require("../controllers/mediaController");

const { optionalJWT } = require("../auth/middleware/authenticateJWT");

// Public browsing — optionalJWT attaches req.user if token present, passes through if absent.
// No auth required to browse/search media.
router.use(optionalJWT);

router.get("/", getAllMedia);                    // GET /api/media  (public)
router.get("/search", searchMedia);              // GET /api/media/search?q=  (public)
router.get("/:id/subtitles", getMediaSubtitles); // GET /api/media/:id/subtitles (public)
router.get("/:id", getMediaById);               // GET /api/media/:id  (public)

module.exports = router;
