"use strict";

/**
 * auth/routes/streamStartRoutes.js
 * POST /stream/start/:id — issues a short-lived stream token for ONE media item.
 *
 * Playback authorization (same gate as every /stream/* route):
 *   verified e-mail + approved + active access + live session  → requirePlaybackAccess
 *   library / restricted-content rules for this media                 → requireMediaAccess
 * Verified-but-pending users get 403 PENDING_APPROVAL here — no token, no cookie, no stream.
 *
 * The token is returned in the body (for ?st= on <video>/<track> URLs) AND set as an HttpOnly
 * cookie scoped to /stream (so HLS segment requests and native-HLS players carry it automatically).
 * Tokens die with their login session (revokeSessions) and are re-validated against the live
 * account on every use (requirePlaybackAccess), so revoking approval stops them within seconds.
 */

const express = require("express");
const router = express.Router();
const crypto = require("crypto");

const prisma = require("../prismaClient");
const { requirePlaybackAccess, requireMediaAccess, STREAM_COOKIE } = require("../middleware/requirePlaybackAccess");

const BASE_URL = process.env.SERVER_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const STREAM_TOKEN_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const MAX_TOKENS_PER_SESSION = 20;

// Streaming tokens are only issued to a credential that is itself allowed to watch.
router.use(requirePlaybackAccess);

// ─── POST /stream/start/:id ───────────────────────────────────────────────────
router.post("/:id", requireMediaAccess, async (req, res) => {
    try {
        const mediaId = req.params.id;
        const user = req.user;

        const token = crypto.randomBytes(32).toString("base64url");
        const expiresAt = new Date(Date.now() + STREAM_TOKEN_TTL_MS);

        // Housekeeping: drop this user's expired tokens, and cap live tokens per login session.
        await prisma.streamToken.deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } });
        if (req.sessionId) {
            const live = await prisma.streamToken.findMany({ where: { sessionId: req.sessionId }, orderBy: { createdAt: "asc" }, select: { id: true } });
            if (live.length >= MAX_TOKENS_PER_SESSION) {
                await prisma.streamToken.deleteMany({ where: { id: { in: live.slice(0, live.length - MAX_TOKENS_PER_SESSION + 1).map((t) => t.id) } } });
            }
        }

        await prisma.streamToken.create({
            data: { userId: user.id, mediaId, token, expiresAt, sessionId: req.sessionId || null },
        });

        const secure = !!(req.secure || String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https");
        res.cookie(STREAM_COOKIE, token, { httpOnly: true, sameSite: "lax", secure, path: "/stream", maxAge: STREAM_TOKEN_TTL_MS });

        res.json({
            streamUrl: `${BASE_URL}/stream/video/${encodeURIComponent(mediaId)}?st=${token}`,
            hlsUrl: `${BASE_URL}/stream/transcode/${encodeURIComponent(mediaId)}?st=${token}`,
            streamToken: token,
            mediaId,
            expiresAt: expiresAt.toISOString(),
        });
    } catch (err) {
        console.error("[Stream] Start error:", err);
        res.status(500).json({ error: "Failed to start stream" });
    }
});

module.exports = router;
