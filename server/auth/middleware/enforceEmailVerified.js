"use strict";

/**
 * auth/middleware/enforceEmailVerified.js
 *
 * App-wide SOFT gate, mounted once in server.js before the routers:
 *   - no / invalid / expired token  → pass through (each router still applies its own rules)
 *   - valid token, e-mail VERIFIED  → pass through
 *   - valid token, e-mail NOT verified → 403 EMAIL_NOT_VERIFIED on everything except /auth/*
 *     and /health (the verification flow itself)
 *
 * Why global: unverified accounts hold a (restricted) session so the verification flow survives a
 * refresh. Without one central gate, every router that only uses authenticateJWT / optionalJWT
 * would have to remember to check emailVerified. This does NOT look at approval status:
 * verified-but-pending users keep full browsing access.
 */

const prisma = require("../prismaClient");
const { verifyAccessToken, isSessionValid } = require("../services/tokenService");

const TTL_MS = 5_000;
const cache = new Map(); // userId → { verified, deleted, at }

const EXEMPT = [/^\/auth(\/|$)/, /^\/health(\/|$)/];

function clearVerifiedCache(userId) {
    if (userId) cache.delete(userId);
    else cache.clear();
}

function tokenFrom(req) {
    const h = req.headers["authorization"];
    if (h && h.startsWith("Bearer ")) return h.slice(7);
    // /api/history + /api/watchtime accept ?token= for navigator.sendBeacon
    if (typeof req.query?.token === "string") return req.query.token;
    return null;
}

async function loadFlags(userId) {
    const hit = cache.get(userId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit;
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { emailVerified: true, status: true, deletedAt: true } });
    const flags = { verified: !!u?.emailVerified, deleted: !u || u.status === "deleted" || !!u.deletedAt, at: Date.now() };
    cache.set(userId, flags);
    return flags;
}

async function enforceEmailVerified(req, res, next) {
    try {
        const path = req.originalUrl.split("?")[0];
        if (EXEMPT.some((re) => re.test(path))) return next();

        const token = tokenFrom(req);
        if (!token) return next();

        let payload;
        try {
            payload = verifyAccessToken(token);
        } catch {
            return next(); // bad/expired token: downstream auth answers 401 as before
        }
        if (!payload?.sub || !payload.sid || !(await isSessionValid(payload.sid, String(payload.sub)))) return next();

        const flags = await loadFlags(String(payload.sub));
        if (!flags.deleted && !flags.verified) {
            return res.status(403).json({ error: "Email not verified", code: "EMAIL_NOT_VERIFIED" });
        }
        return next();
    } catch (err) {
        console.error("[Auth] enforceEmailVerified error:", err);
        return res.status(500).json({ error: "Authentication error" });
    }
}

module.exports = { enforceEmailVerified, clearVerifiedCache };
