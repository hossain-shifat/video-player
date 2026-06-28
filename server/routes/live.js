"use strict";

const path = require("path");
const express = require("express");
const multer = require("multer");
const router = express.Router();
const { UPLOADS_DIR, newSourceId } = require("../utils/iptvStore");
const {
    listSources,
    addUrlSource,
    addUploadSource,
    editSource,
    refreshSource,
    removeSource,
    getChannels,
    getCategoriesList,
    getChannelsFlat,
    checkStreamStatus,
    startBulkCheck,
    getBulkCheckStatus,
    refreshIptvOrgDb,
} = require("../controllers/liveController");

const { authenticateJWT } = require("../auth/middleware/authenticateJWT");
const { requireApprovedUser } = require("../auth/middleware/requireApprovedUser");
const { requireRole } = require("../auth/middleware/requireRole");

const ACCEPTED_MIMETYPES = new Set([
    "application/json",
    "text/plain",
    "application/x-yaml",
    "text/yaml",
    "audio/x-mpegurl",
    "application/vnd.apple.mpegurl",
    "application/xml",
    "text/xml",
    "application/octet-stream",
]);
const ACCEPTED_EXTS = new Set([".m3u", ".m3u8", ".yml", ".yaml", ".json", ".xml", ".txt"]);

function fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ACCEPTED_EXTS.has(ext)) return cb(null, true);
    cb(new Error(`Unsupported file type "${ext}". Allowed: .m3u .m3u8 .yml .yaml .json .xml .txt`));
}

// Save uploads under server/data/iptv-uploads/<sourceId>-<originalname>
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => cb(null, `${newSourceId()}-${file.originalname}`),
});
const upload = multer({ storage, fileFilter, limits: { fileSize: 50 * 1024 * 1024 } });

// Source management — admin only (matches /api/admin-dashboard + /api/sysinfo pattern)
const adminOnly = [authenticateJWT, requireApprovedUser, requireRole("admin")];

router.get("/sources", ...adminOnly, listSources); // GET    /api/live/sources
router.post("/sources/url", ...adminOnly, addUrlSource); // POST   /api/live/sources/url        { name, url }
router.post("/sources/upload", ...adminOnly, upload.single("file"), addUploadSource); // POST /api/live/sources/upload  multipart "file"
router.patch("/sources/:id", ...adminOnly, editSource); // PATCH  /api/live/sources/:id        { name?, url? }
router.post("/sources/:id/refresh", ...adminOnly, refreshSource); // POST   /api/live/sources/:id/refresh
router.delete("/sources/:id", ...adminOnly, removeSource); // DELETE /api/live/sources/:id

// Channel list — any approved (logged-in) user, for the live TV player.
// Now backend-paginated/filtered (q, category, page, limit) — see liveController.getChannels.
router.get("/channels", authenticateJWT, requireApprovedUser, getChannels); // GET /api/live/channels

// Category list with counts — powers the category tabs on the Live page.
router.get("/categories", authenticateJWT, requireApprovedUser, getCategoriesList); // GET /api/live/categories

// Flat channel list — admin dashboard only (DashIPTV.jsx "Channel" tab)
router.get("/channels/flat", ...adminOnly, getChannelsFlat); // GET /api/live/channels/flat

// Single stream health check — admin dashboard "Working Status" column
router.get("/check", ...adminOnly, checkStreamStatus); // GET /api/live/check?url=...

// Bulk stream health check — fires background probe of all channels in live.json
router.post("/check/bulk", ...adminOnly, startBulkCheck); // POST /api/live/check/bulk
router.get("/check/bulk/status", ...adminOnly, getBulkCheckStatus); // GET /api/live/check/bulk/status

// Force-refresh the iptv-org channels/logos/categories database
router.post("/iptvorg/refresh", ...adminOnly, refreshIptvOrgDb); // POST /api/live/iptvorg/refresh

// Multer (and other upload) errors must return JSON, never the default HTML page.
// Without this, a fileFilter rejection or oversized file returns Express's
// default HTML error handler, which the frontend can't parse as JSON.
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
    const message = err?.message || "Upload error";
    console.error("[IPTV route error]", message);
    res.status(err.status || 400).json({ success: false, message });
});

module.exports = router;
