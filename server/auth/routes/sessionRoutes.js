"use strict";

/**
 * auth/routes/sessionRoutes.js
 * User-facing session management — list and revoke own sessions.
 */

const express = require("express");
const router = express.Router();

const prisma = require("../prismaClient");
const { authenticateJWT } = require("../middleware/authenticateJWT");
const { requireApprovedUser } = require("../middleware/requireApprovedUser");

router.use(authenticateJWT, requireApprovedUser);

function maskIp(ip) {
    if (!ip) return "";
    if (ip.includes(":")) {
        // IPv6 e.g., 2405:abcd:1234:abcd::1234 -> 2405:abcd:xxxx:xxxx::xxxx
        const parts = ip.split(":");
        return parts.map((p, i) => i < 2 || !p ? p : "xxxx").join(":");
    } else {
        // IPv4 e.g., 103.95.123.45 -> 103.95.xxx.xxx
        const parts = ip.split(".");
        if (parts.length === 4) {
            return `${parts[0]}.${parts[1]}.xxx.xxx`;
        }
        return ip;
    }
}

// ─── GET /api/sessions ────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
    try {
        const sessions = await prisma.session.findMany({
            where: { userId: req.user.id },
            orderBy: { lastSeenAt: "desc" },
            select: {
                id: true,
                deviceFingerprint: true,
                deviceName: true,
                deviceType: true,
                deviceModel: true,
                deviceVendor: true,
                browser: true,
                browserVersion: true,
                os: true,
                osVersion: true,
                userAgent: true,
                ip: true,
                isActive: true,
                createdAt: true,
                lastSeenAt: true,
            },
        });
        
        const seenDevices = new Set();
        const uniqueSessions = [];
        for (const s of sessions) {
            if (!seenDevices.has(s.deviceFingerprint)) {
                seenDevices.add(s.deviceFingerprint);
                uniqueSessions.push(s);
            }
        }

        const currentSessionId = req.sessionId;
        const isAdmin = req.user.role === "admin";

        const mappedSessions = uniqueSessions.map(s => {
            const copy = { ...s };
            delete copy.deviceFingerprint; // Private
            if (!isAdmin) {
                copy.ip = maskIp(copy.ip);
            }
            return {
                ...copy,
                isCurrentDevice: s.id === currentSessionId
            };
        });

        res.json({ sessions: mappedSessions, total: mappedSessions.length });
    } catch (err) {
        console.error("[Session] List error:", err);
        res.status(500).json({ error: "Failed to list sessions" });
    }
});

// ─── DELETE /api/sessions/:id ─────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
    try {
        // Verify ownership
        const session = await prisma.session.findFirst({
            where: { id: req.params.id, userId: req.user.id },
        });

        if (!session) return res.status(404).json({ error: "Session not found" });

        await prisma.session.update({
            where: { id: req.params.id },
            data: { isActive: false, revokedAt: new Date() },
        });

        res.json({ message: "Session revoked" });
    } catch (err) {
        console.error("[Session] Revoke error:", err);
        res.status(500).json({ error: "Failed to revoke session" });
    }
});

module.exports = router;
