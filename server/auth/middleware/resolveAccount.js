"use strict";

/**
 * auth/middleware/resolveAccount.js
 * Shared by /api/history and /api/watchtime.
 *
 *  - resolveAccount   : JWT (Bearer header, or ?token= for sendBeacon) → req.historyUserId (+ req.historyEmail)
 *                       Signature check only — no DB hit per request; email is looked up once per user and cached.
 *  - beaconBodyParser : navigator.sendBeacon sends text/plain (CORS-exempt) — express.json() skips it,
 *                       so read the raw body and JSON.parse it.
 */

const { verifyAccessToken } = require("../services/tokenService");
const prisma = require("../prismaClient");

// userId → email (label only; never used as a key)
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

async function resolveAccount(req, res, next) {
    const h = req.headers["authorization"];
    const token = h && h.startsWith("Bearer ") ? h.slice(7) : req.query.token || null;
    if (!token) {
        console.warn(`[Account] 401 no token — ${req.method} ${req.originalUrl.split("?")[0]}`);
        return res.status(401).json({ error: "Authentication required" });
    }
    try {
        const payload = verifyAccessToken(token);
        if (payload?.sub == null || payload.sub === "") {
            console.warn(`[Account] 401 token missing sub — ${req.method} ${req.originalUrl.split("?")[0]}`);
            return res.status(401).json({ error: "Invalid token" });
        }
        req.historyUserId = String(payload.sub);
        req.historyEmail = await getEmail(req.historyUserId);
        return next();
    } catch (err) {
        console.warn(`[Account] 401 ${err.name}: ${err.message} — ${req.method} ${req.originalUrl.split("?")[0]}`);
        if (err.name === "TokenExpiredError") {
            return res.status(401).json({ error: "Token expired", code: "TOKEN_EXPIRED" });
        }
        return res.status(401).json({ error: "Invalid token" });
    }
}

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

module.exports = { resolveAccount, beaconBodyParser };
