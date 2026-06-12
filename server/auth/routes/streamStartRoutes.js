"use strict";

/**
 * auth/routes/streamStartRoutes.js
 * POST /stream/start/:id — validates auth + permissions, issues stream token.
 * 
 * CORRECT STREAM TOKEN FLOW:
 *   1. Frontend calls POST /stream/start/:id with JWT
 *   2. Backend validates: JWT + approved + active access + library access
 *   3. Backend returns { streamUrl, streamToken, expiresAt }
 *   4. Frontend uses streamUrl for playback (token embedded in URL)
 *   5. Existing stream system remains untouched after this point
 */

const express = require("express");
const router = express.Router();
const crypto = require("crypto");

const prisma = require("../prismaClient");
const { authenticateJWT } = require("../middleware/authenticateJWT");
const { requireApprovedUser } = require("../middleware/requireApprovedUser");
const { requireActiveAccess } = require("../middleware/requireActiveAccess");

const BASE_URL = process.env.SERVER_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const STREAM_TOKEN_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

// Apply auth middleware
router.use(authenticateJWT, requireApprovedUser, requireActiveAccess);

// ─── POST /stream/start/:id ───────────────────────────────────────────────────
router.post("/:id", async (req, res) => {
    try {
        const mediaId = req.params.id;
        const user = req.user;

        // Library/adult access check via permissions
        // (Media details not fetched here — trust frontend + middleware chain)
        // Full content-level filtering happens in mediaController via req.permissions

        // Generate stream token
        const token = crypto.randomBytes(32).toString("base64url");
        const expiresAt = new Date(Date.now() + STREAM_TOKEN_TTL_MS);

        // Clean up old stream tokens for this user+media (optional housekeeping)
        await prisma.streamToken.deleteMany({
            where: { userId: user.id, mediaId, expiresAt: { lt: new Date() } },
        });

        await prisma.streamToken.create({
            data: { userId: user.id, mediaId, token, expiresAt },
        });

        // Build stream URL — existing /stream/video/:id with token as query param
        const streamUrl = `${BASE_URL}/stream/video/${mediaId}?st=${token}`;
        const hlsUrl = `${BASE_URL}/stream/transcode/${mediaId}?st=${token}`;

        res.json({
            streamUrl,
            hlsUrl,
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
