"use strict";

/**
 * auth/middleware/authenticateJWT.js
 * Verify Bearer token, attach req.user (full DB user).
 * Attaches req.permissions as parsed permission object.
 */

const { verifyAccessToken } = require("../services/tokenService");
const { parsePermissions } = require("../services/permissionService");
const prisma = require("../prismaClient");

const sessionUpdateCache = new Map();

/**
 * authenticateJWT — hard require (returns 401 if missing/invalid token)
 */
async function authenticateJWT(req, res, next) {
    const authHeader = req.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Authentication required" });
    }

    const token = authHeader.slice(7);

    let payload;
    try {
        payload = verifyAccessToken(token);
    } catch (err) {
        if (err.name === "TokenExpiredError") {
            return res.status(401).json({ error: "Token expired", code: "TOKEN_EXPIRED" });
        }
        return res.status(401).json({ error: "Invalid token" });
    }

    try {
        const user = await prisma.user.findUnique({ where: { id: payload.sub } });
        if (!user) {
            return res.status(401).json({ error: "User not found" });
        }

        // Check if session exists (if sid is present)
        if (payload.sid) {
            const session = await prisma.session.findUnique({ where: { id: payload.sid } });
            if (!session || !session.isActive) {
                return res.status(401).json({ error: "Session revoked", code: "SESSION_REVOKED" });
            }
            req.sessionId = payload.sid;

            // Debounce lastSeenAt updates (max once per minute per session)
            const now = Date.now();
            const lastUpdate = sessionUpdateCache.get(payload.sid) || 0;
            if (now - lastUpdate > 60000) {
                sessionUpdateCache.set(payload.sid, now);
                prisma.session.update({
                    where: { id: payload.sid },
                    data: { lastSeenAt: new Date() }
                }).catch(err => console.error("[Auth] Background session update failed:", err));
            }
        }

        // Attach user + parsed permissions to request
        req.user = user;
        req.permissions = parsePermissions(user.permissionsJson);
        next();
    } catch (err) {
        console.error("[Auth] authenticateJWT DB error:", err);
        return res.status(500).json({ error: "Authentication error" });
    }
}

/**
 * optionalJWT — attaches req.user if token present, passes through if absent.
 * Use for routes that work with or without auth.
 */
async function optionalJWT(req, res, next) {
    const authHeader = req.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return next();
    }

    const token = authHeader.slice(7);
    try {
        const payload = verifyAccessToken(token);
        const user = await prisma.user.findUnique({ where: { id: payload.sub } });
        if (user) {
            req.user = user;
            req.permissions = parsePermissions(user.permissionsJson);
        }
    } catch {
        // Ignore invalid tokens in optional mode
    }

    next();
}

module.exports = { authenticateJWT, optionalJWT };
