"use strict";

/**
 * auth/routes/sessionRoutes.js   (mounted at /api/sessions)
 *
 * OWNER-ONLY device & session management. Every query is scoped by req.user.id taken from the
 * verified token — client-supplied ids are only ever used together with that userId, and a
 * foreign/unknown id answers 404 exactly like a missing one (no existence leak).
 * Admins get NO special power here; there is deliberately no admin route that revokes sessions.
 */

const express = require("express");
const router = express.Router();

const prisma = require("../prismaClient");
const { authenticateJWT } = require("../middleware/authenticateJWT");
const { requireApprovedUser } = require("../middleware/requireApprovedUser");
const { listDevices, renameDevice, revokeSessions, displayDeviceName } = require("../services/tokenService");
const notificationService = require("../../services/notificationService");

router.use(authenticateJWT, requireApprovedUser);

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const validId = (v) => typeof v === "string" && ID_RE.test(v);
const notFound = (res, what = "Not found") => res.status(404).json({ error: what });

function notifyRevoked(userId, title, body) {
    notificationService
        .notify({ userIds: [userId], type: notificationService.TYPES.SECURITY, title, body, meta: { event: "session_revoked" } })
        .catch(() => {});
}

// ─── GET /api/sessions ────────────────────────────────────────────────────────
// { devices[], legacySessions[], counts:{ registeredDevices, activeSessions } }
router.get("/", async (req, res) => {
    try {
        const data = await listDevices(req.user.id, req.sessionId, { includeInactive: req.query.all === "1" });
        res.json(data);
    } catch (err) {
        console.error("[Session] List error:", err);
        res.status(500).json({ error: "Failed to list devices" });
    }
});

// ─── PATCH /api/sessions/devices/:id  { name } ────────────────────────────────
router.patch("/devices/:id", async (req, res) => {
    try {
        if (!validId(req.params.id)) return notFound(res, "Device not found");
        const name = req.body?.name;
        if (name !== null && name !== undefined && typeof name !== "string") {
            return res.status(400).json({ error: "name must be text" });
        }
        if (typeof name === "string" && name.trim().length > 60) {
            return res.status(400).json({ error: "Device name must be 60 characters or fewer" });
        }
        const device = await renameDevice(req.user.id, req.params.id, name);
        if (!device) return notFound(res, "Device not found");
        res.json({ device });
    } catch (err) {
        console.error("[Session] Rename error:", err);
        res.status(500).json({ error: "Failed to rename device" });
    }
});

// ─── POST /api/sessions/devices/revoke  { deviceIds[], sessionIds[] } ───────────
// One list row can stand for several records of the same browser + IP; this logs the whole row out.
// Everything is intersected with req.user.id, so foreign ids simply match nothing (404).
router.post("/devices/revoke", async (req, res) => {
    try {
        const clean = (v) => (Array.isArray(v) ? [...new Set(v.filter(validId))].slice(0, 100) : []);
        const deviceIds = clean(req.body?.deviceIds);
        const sessionIds = clean(req.body?.sessionIds);
        if (!deviceIds.length && !sessionIds.length) return res.status(400).json({ error: "deviceIds or sessionIds required" });

        const or = [];
        if (deviceIds.length) or.push({ deviceId: { in: deviceIds } });
        if (sessionIds.length) or.push({ id: { in: sessionIds } });
        const ids = await revokeSessions({ userId: req.user.id, OR: or }, "revoked_by_owner");
        if (!ids.length) return notFound(res, "Device not found");

        const currentSessionRevoked = ids.includes(req.sessionId);
        if (!currentSessionRevoked) notifyRevoked(req.user.id, "A device was logged out", "A device was signed out of your account.");
        res.json({ message: "Device logged out", revoked: ids.length, currentSessionRevoked });
    } catch (err) {
        console.error("[Session] Revoke devices error:", err);
        res.status(500).json({ error: "Failed to log out device" });
    }
});

// ─── DELETE /api/sessions/devices/:id — log out EVERY session of one owned device ──
router.delete("/devices/:id", async (req, res) => {
    try {
        if (!validId(req.params.id)) return notFound(res, "Device not found");
        const device = await prisma.device.findFirst({ where: { id: req.params.id, userId: req.user.id } });
        if (!device) return notFound(res, "Device not found");

        const ids = await revokeSessions({ userId: req.user.id, deviceId: device.id }, "revoked_by_owner");
        const currentSessionRevoked = ids.includes(req.sessionId);
        if (!currentSessionRevoked && ids.length) {
            notifyRevoked(req.user.id, "A device was logged out", `${displayDeviceName(device)} was signed out of your account.`);
        }
        res.json({ message: "Device logged out", revoked: ids.length, currentSessionRevoked });
    } catch (err) {
        console.error("[Session] Revoke device error:", err);
        res.status(500).json({ error: "Failed to log out device" });
    }
});

// ─── DELETE /api/sessions/others — keep this session, revoke all the rest ─────
router.delete("/others", async (req, res) => {
    try {
        const ids = await revokeSessions({ userId: req.user.id, id: { not: req.sessionId } }, "revoked_by_owner");
        if (ids.length) notifyRevoked(req.user.id, "Other devices were logged out", `${ids.length} session(s) on your other devices were signed out.`);
        res.json({ message: "Other devices logged out", revoked: ids.length, currentSessionRevoked: false });
    } catch (err) {
        console.error("[Session] Revoke others error:", err);
        res.status(500).json({ error: "Failed to log out other devices" });
    }
});

// ─── DELETE /api/sessions/current — log out this session ──────────────────────
router.delete("/current", async (req, res) => {
    try {
        const ids = await revokeSessions({ userId: req.user.id, id: req.sessionId }, "logout");
        res.json({ message: "Logged out", revoked: ids.length, currentSessionRevoked: true });
    } catch (err) {
        console.error("[Session] Revoke current error:", err);
        res.status(500).json({ error: "Failed to log out" });
    }
});

// ─── DELETE /api/sessions/:id — revoke ONE owned session ──────────────────────
// (keep AFTER the fixed-path routes above so "others"/"current" are not read as ids)
router.delete("/:id", async (req, res) => {
    try {
        if (!validId(req.params.id)) return notFound(res, "Session not found");
        const session = await prisma.session.findFirst({ where: { id: req.params.id, userId: req.user.id, isActive: true }, select: { id: true } });
        if (!session) return notFound(res, "Session not found");

        const ids = await revokeSessions({ id: session.id, userId: req.user.id }, "revoked_by_owner");
        const currentSessionRevoked = ids.includes(req.sessionId);
        if (!currentSessionRevoked && ids.length) notifyRevoked(req.user.id, "A session was logged out", "One of your sessions was signed out.");
        res.json({ message: "Session revoked", revoked: ids.length, currentSessionRevoked });
    } catch (err) {
        console.error("[Session] Revoke error:", err);
        res.status(500).json({ error: "Failed to revoke session" });
    }
});

module.exports = router;
