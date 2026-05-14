"use strict";

const express = require("express");
const router = express.Router();
const { getAllMedia, getMediaById, searchMedia, getMediaSubtitles } = require("../controllers/mediaController");

router.get("/", getAllMedia); // GET /api/media  (all, grouped, filterable)
router.get("/search", searchMedia); // GET /api/media/search?q=
router.get("/:id/subtitles", getMediaSubtitles); // GET /api/media/:id/subtitles
router.get("/:id", getMediaById); // GET /api/media/:id

module.exports = router;
