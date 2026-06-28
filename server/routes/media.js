"use strict";

const express = require("express");
const router = express.Router();
const { getAllMedia, getMediaById, searchMedia, getMediaSubtitles, uploadSubtitle, searchOnlineSubtitles, downloadOnlineSubtitle } = require("../controllers/mediaController");

const { optionalJWT } = require("../auth/middleware/authenticateJWT");
const { getThumbnail } = require("../controllers/thumbnailController");

// Public browsing — optionalJWT attaches req.user if token present, passes through if absent.
// No auth required to browse/search media.
router.use(optionalJWT);

router.get("/", getAllMedia); // GET  /api/media
router.get("/search", searchMedia); // GET  /api/media/search?q=
router.get("/:id/subtitles", getMediaSubtitles); // GET  /api/media/:id/subtitles  (unified: embedded + external)
router.get("/:id/subtitle/search", searchOnlineSubtitles); // GET  /api/media/:id/subtitle/search?q=&lang=
router.post("/:id/subtitle/upload", uploadSubtitle); // POST /api/media/:id/subtitle/upload  (multipart: field=subtitle)
router.get("/:id/thumbnail", getThumbnail); // GET /api/media/:id/thumbnail?time=123&clientId=xyz
router.post("/:id/subtitle/download", downloadOnlineSubtitle); // POST /api/media/:id/subtitle/download  (body: {fileId, lang})
router.get("/:id", getMediaById); // GET  /api/media/:id  (must be LAST — catch-all)

module.exports = router;
