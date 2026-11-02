"use strict";

/**
 * auth/middleware/validateStreamToken.js
 * Validates short-lived stream tokens for /stream/start/:id endpoint.
 * Stream tokens are issued by POST /stream/start/:id and allow playback
 * without requiring Authorization headers on every HLS segment.
 *
 * The token is validated at session START only.
 * Existing HLS sessions (/stream/hls/:sessionId/*) pass through untouched.
 */

const prisma = require("../prismaClient");
const { authenticateJWT } = require("./authenticateJWT");
const { requireApprovedUser } = require("./requireApprovedUser");
const { requireActiveAccess } = require("./requireActiveAccess");

/**
 * Validate stream token from query param ?st=<token>
 * Used on HLS manifests if you want lightweight per-URL validation.
 * Currently: pass-through (HLS sessions are inherently scoped to sessionId).
 */
async function validateStreamToken(req, res, next) {
    const token = req.query.st;

    if (!token) {
        // No stream token — check JWT instead
        return authenticateJWT(req, res, async () => {
            requireApprovedUser(req, res, () => {
                requireActiveAccess(req, res, next);
            });
        });
    }

    try {
        const streamToken = await prisma.streamToken.findUnique({
            where: { token },
            include: { user: true },
        });

        if (!streamToken) {
            return res.status(401).json({ error: "Invalid stream token" });
        }

        if (new Date() > streamToken.expiresAt) {
            // Clean up expired token
            await prisma.streamToken.delete({ where: { id: streamToken.id } }).catch(() => {});
            return res.status(401).json({ error: "Stream token expired" });
        }

        // Stream tokens die with their session, and never outlive account approval / deletion.
        const u = streamToken.user;
        if (!u || u.status !== "approved") {
            return res.status(403).json({ error: "Account not approved", code: u?.status === "deleted" ? "ACCOUNT_DELETED" : "NOT_APPROVED" });
        }
        if (u.accessType === "temporary" && u.accessExpiresAt && Date.now() > new Date(u.accessExpiresAt).getTime()) {
            return res.status(403).json({ error: "Access expired", code: "ACCESS_EXPIRED" });
        }
        if (streamToken.sessionId) {
            const s = await prisma.session.findUnique({ where: { id: streamToken.sessionId }, select: { isActive: true, expiresAt: true, lastSeenAt: true } });
            if (!s || !require("../services/tokenService").isSessionLive(s)) {
                await prisma.streamToken.delete({ where: { id: streamToken.id } }).catch(() => {});
                return res.status(401).json({ error: "Session revoked", code: "SESSION_REVOKED" });
            }
        }

        // Attach user to request
        const { parsePermissions } = require("../services/permissionService");
        req.user = streamToken.user;
        req.permissions = parsePermissions(streamToken.user.permissionsJson);
        req.streamTokenMediaId = streamToken.mediaId;
        next();
    } catch (err) {
        console.error("[Auth] Stream token validation error:", err);
        return res.status(500).json({ error: "Stream token validation failed" });
    }
}

module.exports = { validateStreamToken };
