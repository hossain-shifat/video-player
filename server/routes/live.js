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
    getChannelState,
    getActiveChannels,
    markChannelActive,
    unmarkChannelActive,
    updateActiveChannelDetails,
    uploadActiveLogo,
    updateChannel,
    deleteChannel,
    restoreChannel,
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

// Separate multer instance for Active-tab logo uploads — memory storage
// since we forward the raw buffer straight to imgbb, never touch disk.
const logoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (/^image\//.test(file.mimetype)) return cb(null, true);
        cb(new Error("Only image files are allowed for a channel logo"));
    },
});

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

// Bulk stream health check — controller fns already existed but were never
// routed, so the auto-detect-working-channel status data had no manual
// trigger endpoint either. Also now auto-runs after every ingest + every
// 30 min on a scheduler (see liveController.js), these are just for the
// admin "recheck all" button / progress poll.
router.post("/check/bulk", ...adminOnly, startBulkCheck); // POST /api/live/check/bulk
router.get("/check/status", ...adminOnly, getBulkCheckStatus); // GET  /api/live/check/status

// Force-refresh the iptv-org channels/logos/categories database
router.post("/iptvorg/refresh", ...adminOnly, refreshIptvOrgDb); // POST /api/live/iptvorg/refresh

// ─── Channel state — Active / Edit / Delete (DashIPTV.jsx) ────────────────────
// Admin-only, same as source management. Order matters: /channels/active must
// be registered before any /channels/:id-style route to avoid "active" being
// swallowed as an :id param.
router.get("/channel-state", ...adminOnly, getChannelState); // GET    /api/live/channel-state
router.get("/channels/active", ...adminOnly, getActiveChannels); // GET    /api/live/channels/active
router.post("/channels/:id/active", ...adminOnly, markChannelActive); // POST   /api/live/channels/:id/active   { ...channel }
router.delete("/channels/:id/active", ...adminOnly, unmarkChannelActive); // DELETE /api/live/channels/:id/active

// Active-tab full CRUD — writes ONLY to active_live.json, never live.json
// or the Channels-tab overrides layer.
router.patch("/active/:id", ...adminOnly, updateActiveChannelDetails); // PATCH /api/live/active/:id   { name?, logo?, category?, country?, group?, url?, ... }
router.post("/active/:id/logo", ...adminOnly, logoUpload.single("logo"), uploadActiveLogo); // POST  /api/live/active/:id/logo   multipart "logo" → uploads to imgbb
router.post("/channels/:id/restore", ...adminOnly, restoreChannel); // POST   /api/live/channels/:id/restore
router.patch("/channels/:id", ...adminOnly, updateChannel); // PATCH  /api/live/channels/:id          { name?, category?, country? }
router.delete("/channels/:id", ...adminOnly, deleteChannel); // DELETE /api/live/channels/:id

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
