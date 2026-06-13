"use strict";

/**
 * auth/routes/adminRoutes.js
 * Admin-only APIs for user management.
 * All routes require: JWT + approved + admin role.
 */

const express = require("express");
const router = express.Router();

const prisma = require("../prismaClient");
const { authenticateJWT } = require("../middleware/authenticateJWT");
const { requireApprovedUser } = require("../middleware/requireApprovedUser");
const { requireRole } = require("../middleware/requireRole");
const { parsePermissions, serializePermissions } = require("../services/permissionService");
const { sendApprovalEmail } = require("../services/emailService");

// All admin routes require: authenticated + approved + admin
router.use(authenticateJWT, requireApprovedUser, requireRole("admin"));

// ─── GET /admin/users ─────────────────────────────────────────────────────────
router.get("/users", async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                email: true,
                name: true,
                avarter: true,
                role: true,
                status: true,
                emailVerified: true,
                accessType: true,
                accessExpiresAt: true,
                permissionsJson: true,
                createdAt: true,
                updatedAt: true,
                _count: { select: { sessions: true } },
            },
        });

        const result = users.map((u) => ({
            ...u,
            avatar: u.avarter,
            avarter: undefined,
            permissions: parsePermissions(u.permissionsJson),
            permissionsJson: undefined,
        }));

        res.json({ users: result, total: result.length });
    } catch (err) {
        console.error("[Admin] List users error:", err);
        res.status(500).json({ error: "Failed to list users" });
    }
});

// ─── GET /admin/users/:id ─────────────────────────────────────────────────────
router.get("/users/:id", async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.params.id },
            include: { _count: { select: { sessions: true, profiles: true } } },
        });

        if (!user) return res.status(404).json({ error: "User not found" });

        res.json({
            user: {
                ...user,
                permissions: parsePermissions(user.permissionsJson),
                permissionsJson: undefined,
                passwordHash: undefined,
            },
        });
    } catch (err) {
        console.error("[Admin] Get user error:", err);
        res.status(500).json({ error: "Failed to get user" });
    }
});

// ─── PATCH /admin/users/:id/approve ───────────────────────────────────────────
router.patch("/users/:id/approve", async (req, res) => {
    try {
        const user = await prisma.user.update({
            where: { id: req.params.id },
            data: { status: "approved" },
        });

        // Notify user via email
        sendApprovalEmail(user.email, user.name).catch(() => {});

        res.json({ message: "User approved", userId: user.id, status: user.status });
    } catch (err) {
        if (err.code === "P2025") return res.status(404).json({ error: "User not found" });
        console.error("[Admin] Approve user error:", err);
        res.status(500).json({ error: "Failed to approve user" });
    }
});

// ─── PATCH /admin/users/:id/reject ────────────────────────────────────────────
router.patch("/users/:id/reject", async (req, res) => {
    try {
        const user = await prisma.user.update({
            where: { id: req.params.id },
            data: { status: "rejected" },
        });
        res.json({ message: "User rejected", userId: user.id, status: user.status });
    } catch (err) {
        if (err.code === "P2025") return res.status(404).json({ error: "User not found" });
        console.error("[Admin] Reject user error:", err);
        res.status(500).json({ error: "Failed to reject user" });
    }
});

// ─── PATCH /admin/users/:id/block ─────────────────────────────────────────────
router.patch("/users/:id/block", async (req, res) => {
    try {
        // Also revoke all sessions
        await prisma.session.updateMany({
            where: { userId: req.params.id },
            data: { isActive: false },
        });

        const user = await prisma.user.update({
            where: { id: req.params.id },
            data: { status: "blocked" },
        });
        res.json({ message: "User blocked and all sessions revoked", userId: user.id });
    } catch (err) {
        if (err.code === "P2025") return res.status(404).json({ error: "User not found" });
        console.error("[Admin] Block user error:", err);
        res.status(500).json({ error: "Failed to block user" });
    }
});

// ─── PATCH /admin/users/:id/permissions ───────────────────────────────────────
router.patch("/users/:id/permissions", async (req, res) => {
    try {
        const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
        if (!existing) return res.status(404).json({ error: "User not found" });

        const currentPerms = parsePermissions(existing.permissionsJson);
        const { permissions, accessType, accessExpiresAt } = req.body;

        const newPerms = { ...currentPerms, ...(permissions || {}) };

        const updateData = { permissionsJson: serializePermissions(newPerms) };
        if (accessType !== undefined) updateData.accessType = accessType;
        if (accessExpiresAt !== undefined) {
            updateData.accessExpiresAt = accessExpiresAt ? new Date(accessExpiresAt) : null;
        }

        const user = await prisma.user.update({
            where: { id: req.params.id },
            data: updateData,
        });

        res.json({
            message: "Permissions updated",
            userId: user.id,
            permissions: parsePermissions(user.permissionsJson),
            accessType: user.accessType,
            accessExpiresAt: user.accessExpiresAt,
        });
    } catch (err) {
        console.error("[Admin] Update permissions error:", err);
        res.status(500).json({ error: "Failed to update permissions" });
    }
});

// ─── GET /admin/users/:id/sessions ────────────────────────────────────────────
router.get("/users/:id/sessions", async (req, res) => {
    try {
        const sessions = await prisma.session.findMany({
            where: { userId: req.params.id },
            orderBy: { lastSeenAt: "desc" },
            select: {
                id: true,
                deviceFingerprint: true,
                deviceName: true,
                browser: true,
                os: true,
                isActive: true,
                createdAt: true,
                lastSeenAt: true,
            },
        });

        // Deduplicate by deviceFingerprint
        const seenDevices = new Set();
        const uniqueSessions = [];
        for (const s of sessions) {
            if (!seenDevices.has(s.deviceFingerprint)) {
                seenDevices.add(s.deviceFingerprint);
                uniqueSessions.push(s);
            }
        }

        // Strip deviceFingerprint before sending
        const mappedSessions = uniqueSessions.map(s => {
            const copy = { ...s };
            delete copy.deviceFingerprint;
            return copy;
        });

        res.json({ sessions: mappedSessions, total: mappedSessions.length });
    } catch (err) {
        console.error("[Admin] Get user sessions error:", err);
        res.status(500).json({ error: "Failed to get sessions" });
    }
});

// ─── DELETE /admin/sessions/:id ───────────────────────────────────────────────
router.delete("/sessions/:id", async (req, res) => {
    try {
        await prisma.session.update({
            where: { id: req.params.id },
            data: { isActive: false },
        });
        res.json({ message: "Session revoked" });
    } catch (err) {
        if (err.code === "P2025") return res.status(404).json({ error: "Session not found" });
        console.error("[Admin] Revoke session error:", err);
        res.status(500).json({ error: "Failed to revoke session" });
    }
});

module.exports = router;
