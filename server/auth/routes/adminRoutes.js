"use strict";

/**
 * auth/routes/adminRoutes.js
 * Admin-only APIs for user management.
 * All routes require: JWT + approved + admin role.
 * NOTE: admins manage ACCOUNTS here (approve / reject / block / permissions). There is intentionally
 * NO route that revokes another user's sessions or logs their devices out. Blocking works through
 * status checks (requireApprovedUser etc.), and deletion is the separate recoverable lifecycle in
 * /api/admin-dashboard (DELETE /users/:id).
 */

const express = require("express");
const router = express.Router();

const prisma = require("../prismaClient");
const { authenticateJWT } = require("../middleware/authenticateJWT");
const { requireApprovedUser } = require("../middleware/requireApprovedUser");
const { requireRole } = require("../middleware/requireRole");
const { parsePermissions, serializePermissions } = require("../services/permissionService");
const { notifyApproved } = require("../services/emailService");
const notificationService = require("../../services/notificationService");
const { syncPlaybackAccess } = require("../services/playbackRevocation");

// Snapshot of what a user could be told about (status + access duration) before an admin changes it.
const accountSnapshot = (id) => prisma.user.findUnique({ where: { id }, select: { status: true, accessType: true, accessExpiresAt: true } });
const { summarizeDevicesForAdmin } = require("../services/tokenService");

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
            include: { _count: { select: { sessions: true, devices: true } } },
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
        const before = await accountSnapshot(req.params.id);
        const user = await prisma.user.update({
            where: { id: req.params.id, deletedAt: null },
            data: { status: "approved" },
        });

        await syncPlaybackAccess(user);

        // Notify user via email (only on a real pending/rejected/blocked → approved change)
        if (before?.status !== "approved") notifyApproved(user).catch(() => {});

        notificationService.notifyAccountChange({ userId: user.id, before, after: user }).catch(() => {});

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
        const before = await accountSnapshot(req.params.id);
        const user = await prisma.user.update({
            where: { id: req.params.id, deletedAt: null },
            data: { status: "rejected" },
        });
        await syncPlaybackAccess(user);
        notificationService.notifyAccountChange({ userId: user.id, before, after: user }).catch(() => {});
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
        // Block = status change only. Access stops immediately because every protected route checks
        // status; sessions are NOT revoked here (admins have no session-revocation power).
        const before = await accountSnapshot(req.params.id);
        const user = await prisma.user.update({
            where: { id: req.params.id, deletedAt: null },
            data: { status: "blocked" },
        });
        await syncPlaybackAccess(user);
        notificationService.notifyAccountChange({ userId: user.id, before, after: user }).catch(() => {});
        res.json({ message: "User blocked", userId: user.id });
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
        if (!existing || existing.deletedAt) return res.status(404).json({ error: "User not found" });

        const currentPerms = parsePermissions(existing.permissionsJson);
        const { permissions, accessType, accessExpiresAt } = req.body;

        const newPerms = { ...currentPerms, ...(permissions || {}) };

        const updateData = { permissionsJson: serializePermissions(newPerms) };
        if (accessType !== undefined) updateData.accessType = accessType;
        if (accessExpiresAt !== undefined) {
            updateData.accessExpiresAt = accessExpiresAt ? new Date(accessExpiresAt) : null;
        }

        const user = await prisma.user.update({
            where: { id: req.params.id, deletedAt: null },
            data: updateData,
        });
        // Access-duration changes (accessType / accessExpiresAt) are reported to that user.
        notificationService.notifyAccountChange({ userId: user.id, before: existing, after: user }).catch(() => {});

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
// Permitted summary only (counts, browser/OS, timestamps). No IPs, user agents, session ids,
// fingerprints, or the owner's custom device names.
router.get("/users/:id/sessions", async (req, res) => {
    try {
        const exists = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true } });
        if (!exists) return res.status(404).json({ error: "User not found" });
        res.json(await summarizeDevicesForAdmin(req.params.id));
    } catch (err) {
        console.error("[Admin] Get user devices error:", err);
        res.status(500).json({ error: "Failed to get devices" });
    }
});

module.exports = router;
