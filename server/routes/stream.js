"use strict";

const express = require("express");
const router = express.Router();
const { streamVideo, streamSubtitle } = require("../controllers/streamController");

router.get("/video/:id", streamVideo);
router.head("/video/:id", streamVideo);
router.get("/subtitle/:encodedPath", streamSubtitle);

module.exports = router;
