"use strict";

const express = require("express");
const router = express.Router();
const { getAllHistory, getOne, logProgress, deleteOne, clearAll, sseHandler } = require("../controllers/historyController");
const { verifyAccessToken } = require("../auth/services/tokenService");
const prisma = require("../auth/prismaClient");

// userId → email, looked up once per user then cached (label only; never a key).
const emailCache = new Map();
async function getEmail(userId) {
    if (emailCache.has(userId)) return emailCache.get(userId);
    try {
        const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
        const email = u?.email ?? null;
        if (email) emailCache.set(userId, email);
        return email;
    } catch {
        return null;
    }
}

// History is stored per ACCOUNT (JWT `sub` = user id), not per device.
// Same login on phone + PC → same history.
//
// Token source:
//   - Normal requests: Authorization: Bearer <token>
//   - sendBeacon (page close/refresh): can't set headers → ?token=<token>
//
// JWT signature check only (no DB hit) — this runs every ~4s during playback.
async function resolveHistoryUser(req, res, next) {
    const h = req.headers["authorization"];
    const token = h && h.startsWith("Bearer ") ? h.slice(7) : req.query.token || null;
    if (!token) {
        console.warn(`[History] 401 no token — ${req.method} ${req.originalUrl.split("?")[0]}`);
        return res.status(401).json({ error: "Authentication required" });
    }
    try {
        const payload = verifyAccessToken(token);
        req.historyUserId = String(payload.sub);
        req.historyEmail = await getEmail(req.historyUserId);
        return next();
    } catch (err) {
        console.warn(`[History] 401 ${err.name}: ${err.message} — ${req.method} ${req.originalUrl.split("?")[0]}`);
        if (err.name === "TokenExpiredError") {
            return res.status(401).json({ error: "Token expired", code: "TOKEN_EXPIRED" });
        }
        return res.status(401).json({ error: "Invalid token" });
    }
}

// navigator.sendBeacon sends body as text/plain (to avoid CORS preflight).
// Express json() won't parse it → read raw, JSON.parse into req.body.
function beaconBodyParser(req, res, next) {
    const ct = req.headers["content-type"] || "";
    if (ct.startsWith("text/plain")) {
        let raw = "";
        req.setEncoding("utf8");
        req.on("data", (chunk) => {
            raw += chunk;
        });
        req.on("end", () => {
            try {
                req.body = JSON.parse(raw);
            } catch {
                req.body = {};
            }
            next();
        });
        return;
    }
    next();
}

router.use(resolveHistoryUser);

router.get("/events", sseHandler); // GET    /api/history/events  (SSE push — must stay ABOVE /:id)
router.get("/", getAllHistory); // GET    /api/history
router.get("/:id", getOne); // GET    /api/history/:id
router.post("/:id", beaconBodyParser, logProgress); // POST   /api/history/:id
router.delete("/", clearAll); // DELETE /api/history
router.delete("/:id", deleteOne); // DELETE /api/history/:id

module.exports = router;
