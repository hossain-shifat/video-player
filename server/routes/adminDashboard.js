"use strict";

/**
 * routes/adminDashboard.js
 * Admin dashboard API — stats, health, streams, jobs, logs.
 * All routes require: JWT + approved + admin role.
 */

const express = require("express");
const router = express.Router();
const os = require("os");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const prisma = require("../auth/prismaClient");
const { authenticateJWT } = require("../auth/middleware/authenticateJWT");
const { requireApprovedUser } = require("../auth/middleware/requireApprovedUser");
const { requireRole } = require("../auth/middleware/requireRole");
const { getSessionStats } = require("../utils/transcoderService");
const { setPermission } = require("../utils/permissionsStore");
const { syncPlaybackAccess } = require("../auth/services/playbackRevocation");
const { invalidateAll, invalidateFolder } = require("../utils/mediaCache");
const { getSysInfoRoute, getLiveMetrics } = require("../utils/hwAccel");
const { readFolders } = require("../controllers/libraryController");
const notificationService = require("../services/notificationService");
const { notifyApproved } = require("../auth/services/emailService");
const { summarizeDevicesForAdmin, groupClients, sessionCutoff } = require("../auth/services/tokenService");
const { softDeleteUser, otherActiveAdminCount, getHistory, DELETION_GRACE_DAYS } = require("../utils/userStore");

// All dashboard routes require: authenticated + approved + admin
router.use(authenticateJWT, requireApprovedUser, requireRole("admin"));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtBytes(bytes) {
    if (!bytes || bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

function getCpuUsage() {
    return new Promise((resolve) => {
        const start = os.cpus().map((c) => ({ ...c.times }));
        setTimeout(() => {
            const end = os.cpus();
            let idle = 0,
                total = 0;
            for (let i = 0; i < start.length; i++) {
                const s = start[i],
                    e = end[i].times;
                const t = Object.keys(e).reduce((a, k) => a + e[k] - (s[k] || 0), 0);
                idle += e.idle - s.idle;
                total += t;
            }
            resolve(total === 0 ? 0 : Math.round((1 - idle / total) * 1000) / 10);
        }, 200);
    });
}

function countMediaFiles(dir, exts) {
    let count = 0;
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
            if (e.isDirectory()) {
                count += countMediaFiles(path.join(dir, e.name), exts);
            } else if (exts.some((x) => e.name.toLowerCase().endsWith(x))) {
                count++;
            }
        }
    } catch {}
    return count;
}

function getDirSizeBytes(dir) {
    let size = 0;
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
            if (e.isDirectory()) size += getDirSizeBytes(path.join(dir, e.name));
            else {
                try {
                    size += fs.statSync(path.join(dir, e.name)).size;
                } catch {}
            }
        }
    } catch {}
    return size;
}

// In-memory log buffer (circular, 500 entries max)
const LOG_BUFFER = [];
const LOG_MAX = 500;

function pushLog(level, category, message, meta = {}) {
    LOG_BUFFER.push({ ts: new Date().toISOString(), level, category, message, ...meta });
    if (LOG_BUFFER.length > LOG_MAX) LOG_BUFFER.shift();
}

// Intercept console methods to feed log buffer
const _origLog = console.log.bind(console);
const _origWarn = console.warn.bind(console);
const _origErr = console.error.bind(console);

console.log = (...args) => {
    _origLog(...args);
    const msg = args.join(" ");
    const cat = /\[Auth\]/i.test(msg) ? "auth" : /\[Stream\]/i.test(msg) ? "stream" : /\[Upload\]/i.test(msg) ? "upload" : "system";
    pushLog("info", cat, msg);
};
console.warn = (...args) => {
    _origWarn(...args);
    pushLog("warn", "system", args.join(" "));
};
console.error = (...args) => {
    _origErr(...args);
    pushLog("error", "system", args.join(" "));
};

// ─── GET /api/admin-dashboard/stats ───────────────────────────────────────────
router.get("/stats", async (req, res) => {
    try {
        const now = new Date();
        const [totalUsers, approvedUsers, pendingUsers, adminUsers, suspendedUsers, pendingDeletion] = await Promise.all([
            prisma.user.count({ where: { deletedAt: null } }),
            prisma.user.count({ where: { status: "approved", deletedAt: null } }),
            prisma.user.count({ where: { status: "pending", deletedAt: null } }),
            prisma.user.count({ where: { role: "admin", deletedAt: null } }),
            prisma.user.count({ where: { status: { in: ["blocked", "rejected"] }, deletedAt: null } }),
            prisma.user.count({ where: { deletedAt: { not: null } } }),
        ]);

        // Definitions: active session = isActive AND not past expiresAt (legacy rows without expiresAt count until
        // their first refresh); registered device = a Device with at least one active session.
        const liveSessionWhere = { isActive: true, lastSeenAt: { gt: sessionCutoff() }, user: { deletedAt: null }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
        const liveRows = await prisma.session.findMany({ where: liveSessionWhere, orderBy: { lastSeenAt: "desc" }, select: { userId: true, os: true, deviceType: true, browser: true, ip: true } });
        let activeSessions = 0; // distinct browser clients (same browser + IP = one)
        // registered devices = actual machines per account (same OS + type + IP collapse), summed across accounts
        const perUser = new Map();
        for (const r of liveRows) (perUser.get(r.userId) || perUser.set(r.userId, []).get(r.userId)).push(r);
        let registeredDevices = 0;
        for (const rows of perUser.values()) {
            registeredDevices += groupClients(rows).length;
            activeSessions += groupClients(rows, { byBrowser: true }).length;
        }

        // Active streams
        const streams = getSessionStats ? getSessionStats() : [];
        const activeStreams = Array.isArray(streams) ? streams.length : 0;

        // Memory and CPU (use live metrics if available)
        const live = getLiveMetrics ? getLiveMetrics() : null;

        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;

        let cpuPct, memPct;
        if (live && live.memPercent !== undefined) {
            cpuPct = live.cpuPercent || 0;
            memPct = live.memPercent || 0;
        } else {
            memPct = Math.round((usedMem / totalMem) * 1000) / 10;
            cpuPct = await getCpuUsage();
        }

        // Library folders from config
        const FOLDERS_FILE = path.join(__dirname, "../data/folders.json");
        let folders = [];
        try {
            folders = JSON.parse(fs.readFileSync(FOLDERS_FILE, "utf-8"));
        } catch {}

        const VIDEO_EXTS = (process.env.VIDEO_EXTENSIONS || ".mp4,.mkv,.avi,.mov,.wmv").split(",");

        let totalMedia = 0;
        let storageBytes = 0;
        for (const f of folders) {
            totalMedia += countMediaFiles(f.path, VIDEO_EXTS);
            storageBytes += getDirSizeBytes(f.path);
        }

        res.json({
            users: { total: totalUsers, approved: approvedUsers, pending: pendingUsers, admins: adminUsers, suspended: suspendedUsers, pendingDeletion },
            sessions: { active: activeSessions },
            devices: { registered: registeredDevices },
            streams: { active: activeStreams },
            media: { total: totalMedia },
            storage: { usedBytes: storageBytes, used: fmtBytes(storageBytes) },
            system: {
                cpuPercent: cpuPct,
                memPercent: memPct,
                memTotal: fmtBytes(totalMem),
                memUsed: fmtBytes(usedMem),
                memFree: fmtBytes(freeMem),
                uptime: Math.floor(process.uptime()),
                nodeVersion: process.version,
            },
        });
    } catch (err) {
        console.error("[AdminDash] stats error:", err);
        res.status(500).json({ error: "Failed to load stats" });
    }
});

// ─── GET /api/admin-dashboard/health ──────────────────────────────────────────
// Delegates to existing hwAccel.getSysInfoRoute
router.get("/health", getSysInfoRoute);

// ─── GET /api/admin-dashboard/streams ─────────────────────────────────────────
router.get("/streams", (req, res) => {
    try {
        const sessions = getSessionStats ? getSessionStats() : [];
        res.json({ streams: sessions, total: sessions.length });
    } catch (err) {
        res.status(500).json({ error: "Failed to get streams", streams: [] });
    }
});

// ─── Account helpers ──────────────────────────────────────────────────────────
const USER_STATUSES = ["pending", "approved", "blocked", "rejected"]; // "deleted" is reachable ONLY through DELETE
const USER_ROLES = ["user", "admin"];
const ACCESS_TYPES = ["permanent", "temporary"];
const SORTABLE = { createdAt: "createdAt", name: "name", email: "email", lastLoginAt: "lastLoginAt", status: "status", role: "role" };

function safePerms(json) {
    try {
        return JSON.parse(json || "{}");
    } catch {
        return {};
    }
}

// ─── GET /api/admin-dashboard/users ───────────────────────────────────────────
// ?search=&status=pending|approved|blocked|rejected|deleted&role=&sort=&dir=asc|desc&page=&limit=
// status=deleted lists accounts inside their 30-day recovery window. Deleted accounts are
// excluded from every other view.
router.get("/users", async (req, res) => {
    try {
        const { search, status, role, sort = "createdAt", dir = "desc" } = req.query;
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

        const where = {};
        if (status === "deleted") where.deletedAt = { not: null };
        else {
            where.deletedAt = null;
            if (status) {
                if (!USER_STATUSES.includes(status)) return res.status(400).json({ error: "Invalid status filter" });
                where.status = status;
            }
        }
        if (role) {
            if (!USER_ROLES.includes(role)) return res.status(400).json({ error: "Invalid role filter" });
            where.role = role;
        }
        if (search) {
            const q = String(search).slice(0, 100);
            where.OR = [{ email: { contains: q } }, { name: { contains: q } }];
        }

        const sortField = SORTABLE[sort] || "createdAt";
        const sortDir = dir === "asc" ? "asc" : "desc";

        const [users, total] = await Promise.all([
            prisma.user.findMany({
                where,
                skip: (page - 1) * limit,
                take: limit,
                orderBy: [{ [sortField]: sortDir }, { createdAt: "desc" }],
                select: {
                    id: true,
                    email: true,
                    name: true,
                    username: true,
                    avarter: true,
                    role: true,
                    status: true,
                    emailVerified: true,
                    accessType: true,
                    accessExpiresAt: true,
                    permissionsJson: true,
                    createdAt: true,
                    updatedAt: true,
                    lastLoginAt: true,
                    deletedAt: true,
                    purgeAt: true,
                    purgeError: true,
                },
            }),
            prisma.user.count({ where }),
        ]);

        // Live session / device counts + last-login IP for just this page of users (support view)
        const ids = users.map((u) => u.id);
        const nowD = new Date();
        const liveWhere = { userId: { in: ids }, isActive: true, lastSeenAt: { gt: sessionCutoff() }, OR: [{ expiresAt: null }, { expiresAt: { gt: nowD } }] };
        const [liveSessions, recentIps] = ids.length
            ? await Promise.all([
                  prisma.session.findMany({ where: liveWhere, orderBy: { lastSeenAt: "desc" }, select: { userId: true, os: true, deviceType: true, browser: true, ip: true } }),
                  prisma.session.findMany({ where: { userId: { in: ids }, ip: { not: "" } }, orderBy: { lastSeenAt: "desc" }, select: { userId: true, ip: true } }),
              ])
            : [[], []];
        // sessions per user, then collapse to actual devices (same OS + type + IP = one machine)
        const byUser = new Map();
        for (const x of liveSessions) {
            if (!byUser.has(x.userId)) byUser.set(x.userId, []);
            byUser.get(x.userId).push(x);
        }
        const counts = new Map();
        for (const [uid, rows] of byUser) counts.set(uid, { sessions: groupClients(rows, { byBrowser: true }).length, devices: groupClients(rows).length });
        const ipByUser = new Map();
        for (const r of recentIps) if (!ipByUser.has(r.userId)) ipByUser.set(r.userId, r.ip);

        const result = users.map((u) => ({
            ...u,
            _count: { sessions: counts.get(u.id)?.sessions ?? 0, devices: counts.get(u.id)?.devices ?? 0 },
            lastIp: ipByUser.get(u.id) || "",
            avatar: u.avarter,
            avarter: undefined,
            permissions: safePerms(u.permissionsJson),
            permissionsJson: undefined,
            recoveryStatus: u.deletedAt ? (u.purgeAt && u.purgeAt > new Date() ? "recoverable" : "awaiting_purge") : null,
        }));

        res.json({ users: result, total, page, pages: Math.ceil(total / limit) });
    } catch (err) {
        console.error("[AdminDash] users error:", err);
        res.status(500).json({ error: "Failed to list users" });
    }
});

// ─── GET /api/admin-dashboard/users/:id ───────────────────────────────────────
// Permitted detail view: account, profile, role/permissions, status, activity, device SUMMARY, deletion status.
// No password hash, tokens, IPs, user agents, session/device ids.
router.get("/users/:id", async (req, res) => {
    try {
        const u = await prisma.user.findUnique({ where: { id: req.params.id } });
        if (!u) return res.status(404).json({ error: "User not found" });

        const devices = await summarizeDevicesForAdmin(u.id);
        let history = { count: 0, lastWatchedAt: null };
        try {
            const entries = Object.values(getHistory(u.id));
            history = { count: entries.length, lastWatchedAt: entries.reduce((m, e) => (e.watchedAt && (!m || e.watchedAt > m) ? e.watchedAt : m), null) };
        } catch {
            /* history store unreadable — leave zeros */
        }

        res.json({
            user: {
                id: u.id,
                email: u.email,
                name: u.name,
                username: u.username,
                avatar: u.avarter,
                role: u.role,
                status: u.status,
                emailVerified: u.emailVerified,
                hasPassword: !!u.passwordHash,
                hasGoogle: !!u.googleId,
                accessType: u.accessType,
                accessExpiresAt: u.accessExpiresAt,
                permissions: safePerms(u.permissionsJson),
                createdAt: u.createdAt,
                updatedAt: u.updatedAt,
                lastLoginAt: u.lastLoginAt,
                lastIp: devices.lastIp || "",
            },
            activity: { lastLoginAt: u.lastLoginAt, history },
            devices,
            deletion: u.deletedAt
                ? {
                      deletedAt: u.deletedAt,
                      purgeAt: u.purgeAt,
                      graceDays: DELETION_GRACE_DAYS,
                      previousStatus: u.statusBeforeDeletion,
                      recoveryStatus: u.purgeAt && u.purgeAt > new Date() ? "recoverable" : "awaiting_purge",
                      purgeError: u.purgeError,
                  }
                : null,
        });
    } catch (err) {
        console.error("[AdminDash] user detail error:", err);
        res.status(500).json({ error: "Failed to load user" });
    }
});

// ─── PATCH /api/admin-dashboard/users/:id ─────────────────────────────────────
router.patch("/users/:id", async (req, res) => {
    try {
        const { status, role, accessType, accessExpiresAt, permissions, permissionsJson, allowAdult } = req.body || {};
        const data = {};

        const target = await prisma.user.findUnique({ where: { id: req.params.id } });
        if (!target) return res.status(404).json({ error: "User not found" });
        if (target.deletedAt) return res.status(409).json({ error: "Account is scheduled for deletion and cannot be edited", code: "ACCOUNT_DELETED" });

        if (status !== undefined) {
            if (!USER_STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of: ${USER_STATUSES.join(", ")}` });
            // "pending" is only a signup state. An admin can never move an account back to pending
            // (approved / blocked / rejected → pending). Re-sending "pending" for an account that is already pending is a no-op.
            if (status === "pending" && target.status !== "pending") {
                return res.status(400).json({ error: "An account cannot be set back to pending", code: "STATUS_PENDING_NOT_ALLOWED" });
            }
            if (status !== target.status) data.status = status;
        }
        if (role !== undefined) {
            if (!USER_ROLES.includes(role)) return res.status(400).json({ error: `role must be one of: ${USER_ROLES.join(", ")}` });
            data.role = role;
        }
        if (accessType !== undefined) {
            if (!ACCESS_TYPES.includes(accessType)) return res.status(400).json({ error: `accessType must be one of: ${ACCESS_TYPES.join(", ")}` });
            data.accessType = accessType;
        }
        if (accessExpiresAt !== undefined) {
            if (!accessExpiresAt) {
                data.accessExpiresAt = null;
            } else {
                const date = new Date(accessExpiresAt);
                if (isNaN(date.getTime())) return res.status(400).json({ error: "Invalid accessExpiresAt date" });
                data.accessExpiresAt = date;
            }
        }

        // Never leave the server without an approved admin, and never let an admin lock themselves out.
        const losingAdmin = target.role === "admin" && ((data.role && data.role !== "admin") || (data.status && data.status !== "approved"));
        if (losingAdmin) {
            if (target.id === req.user.id) return res.status(400).json({ error: "You cannot demote or block your own account" });
            if ((await otherActiveAdminCount(target.id)) === 0) return res.status(400).json({ error: "This is the last active administrator", code: "LAST_ADMIN" });
        }

        // permissions — store as JSON string in permissionsJson column
        if (permissionsJson !== undefined) {
            if (typeof permissionsJson !== "string") return res.status(400).json({ error: "permissionsJson must be a JSON string" });
            try {
                JSON.parse(permissionsJson);
            } catch {
                return res.status(400).json({ error: "permissionsJson is not valid JSON" });
            }
            data.permissionsJson = permissionsJson;
        } else if (permissions !== undefined) {
            if (permissions === null || typeof permissions !== "object" || Array.isArray(permissions)) return res.status(400).json({ error: "permissions must be an object" });
            data.permissionsJson = JSON.stringify(permissions);
        }

        // allowAdult — merge into existing permissionsJson if only this field changed
        if (allowAdult !== undefined && permissionsJson === undefined && permissions === undefined) {
            const parsed = safePerms(target.permissionsJson);
            parsed.allowAdult = !!allowAdult;
            data.permissionsJson = JSON.stringify(parsed);
        }

        if (!Object.keys(data).length) return res.status(400).json({ error: "Nothing to update" });

        // deletedAt: null guards against a deletion landing between the read above and this write
        const user = await prisma.user.update({ where: { id: req.params.id, deletedAt: null }, data });

        // Apply status / role / access-window changes to playback immediately (tokens + caches).
        await syncPlaybackAccess(user);

        // Admin just approved this account → send the "You're in" e-mail (fire-and-forget, never blocks the response).
        if (data.status === "approved" && target.status !== "approved") {
            notifyApproved(user).catch(() => {});
        }

        // Tell that user what changed (status and/or access duration) — one notification, even if both changed.
        if (data.status !== undefined || data.accessType !== undefined || data.accessExpiresAt !== undefined) {
            notificationService.notifyAccountChange({ userId: user.id, before: target, after: user }).catch(() => {});
        }
        if (data.role !== undefined && data.role !== target.role) {
            require("../utils/userStore").recordAudit({ action: "role_changed", actorId: req.user.id, targetUserId: user.id, targetEmail: user.email, detail: { from: target.role, to: user.role } });
        }
        if (data.status !== undefined && data.status !== target.status) {
            require("../utils/userStore").recordAudit({
                action: "status_changed",
                actorId: req.user.id,
                targetUserId: user.id,
                targetEmail: user.email,
                detail: { from: target.status, to: user.status },
            });
        }

        res.json({
            user: {
                id: user.id,
                status: user.status,
                role: user.role,
                accessType: user.accessType,
                accessExpiresAt: user.accessExpiresAt,
                permissions: safePerms(user.permissionsJson),
                permissionsJson: user.permissionsJson,
            },
        });
    } catch (err) {
        if (err.code === "P2025") return res.status(404).json({ error: "User not found" });
        console.error("[AdminDash] update user error:", err);
        res.status(500).json({ error: "Failed to update user" });
    }
});

// ─── DELETE /api/admin-dashboard/users/:id ────────────────────────────────────
// Recoverable deletion: access revoked NOW, data kept DELETION_GRACE_DAYS (30) days, then purged by the
// scheduler (utils/userStore.js). This is account deletion — NOT a general "log this user out" tool.
router.delete("/users/:id", async (req, res) => {
    try {
        // Pending (never-approved) accounts hold no library/watch data worth protecting → remove them from the
        // database right now, NO 30-day recovery window. Every other status keeps the recoverable 30-day deletion below.
        const pendingTarget = await prisma.user.findUnique({ where: { id: req.params.id } });
        if (pendingTarget && pendingTarget.status === "pending") {
            const uid = pendingTarget.id;

            // 1) Child rows first. Discovered from the Prisma schema itself (every model that has a foreign key to User),
            //    so nothing blocks the user delete even if you add tables later. Falls back to the known list.
            let children = [];
            try {
                const { Prisma } = require("@prisma/client");
                const models = Prisma?.dmmf?.datamodel?.models || [];
                for (const m of models) {
                    for (const f of m.fields) {
                        if (f.kind === "object" && f.type === "User" && Array.isArray(f.relationFromFields) && f.relationFromFields.length) {
                            children.push({ model: m.name, field: f.relationFromFields[0] });
                        }
                    }
                }
            } catch {}
            if (!children.length) {
                children = ["streamToken", "session", "device", "pushDevice", "oTP"].map((model) => ({ model, field: "userId" }));
            }
            for (const { model, field } of children) {
                const delegate = prisma[model.charAt(0).toLowerCase() + model.slice(1)] || prisma[model] || prisma[model.replace(/^OTP/, "oTP")];
                if (!delegate?.deleteMany) continue;
                try {
                    await delegate.deleteMany({ where: { [field]: uid } });
                } catch (e) {
                    console.warn(`[AdminDash] pending delete: could not clear ${model}.${field}:`, e?.message);
                }
            }

            // 2) The user row itself — then CONFIRM it is really gone from the database.
            try {
                await prisma.user.delete({ where: { id: uid } });
            } catch (e) {
                if (e.code !== "P2025") {
                    console.error("[AdminDash] pending delete: prisma.user.delete failed:", e);
                    return res.status(500).json({ error: "Could not remove the user from the database", code: "DB_DELETE_FAILED", detail: e?.message });
                }
            }
            const still = await prisma.user.findUnique({ where: { id: uid } });
            if (still) return res.status(500).json({ error: "User row is still in the database", code: "DB_DELETE_FAILED" });

            try {
                await syncPlaybackAccess({ ...pendingTarget, status: "deleted" });
            } catch {}
            try {
                require("../utils/userStore").recordAudit({ action: "pending_user_deleted", actorId: req.user.id, targetUserId: uid, targetEmail: pendingTarget.email, detail: { immediate: true } });
            } catch {}
            console.log(`[AdminDash] Pending user ${pendingTarget.email} permanently removed from the database`);
            return res.json({ message: "Pending user deleted", id: uid, immediate: true, removedFromDatabase: true, graceDays: 0 });
        }

        const r = await softDeleteUser(req.params.id, req.user.id);
        if (!r.ok) {
            const map = {
                NOT_FOUND: [404, "User not found"],
                SELF: [400, "Cannot delete your own account"],
                LAST_ADMIN: [400, "Cannot delete the last active administrator"],
                ALREADY_DELETED: [409, "Account is already scheduled for deletion"],
            };
            const [code, error] = map[r.code] || [500, "Failed to delete user"];
            return res.status(code).json({ error, code: r.code });
        }
        res.json({ message: "User scheduled for deletion", id: req.params.id, deletedAt: r.user.deletedAt, purgeAt: r.user.purgeAt, graceDays: DELETION_GRACE_DAYS });
    } catch (err) {
        console.error("[AdminDash] delete user error:", err);
        res.status(500).json({ error: "Failed to delete user" });
    }
});

// ─── GET /api/admin-dashboard/users/:id/sessions ──────────────────────────────
// Kept for compatibility; now a privacy-safe DEVICE SUMMARY (see summarizeDevicesForAdmin).
router.get("/users/:id/sessions", async (req, res) => {
    try {
        const exists = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true } });
        if (!exists) return res.status(404).json({ error: "User not found" });
        res.json(await summarizeDevicesForAdmin(req.params.id));
    } catch (err) {
        console.error("[AdminDash] devices error:", err);
        res.status(500).json({ error: "Failed to get devices" });
    }
});

// NOTE: there is intentionally NO DELETE /sessions/:id here. Administrators cannot revoke another
// user's sessions or log their devices out; owners do that themselves via /api/sessions.

// ─── GET /api/admin-dashboard/libraries ───────────────────────────────────────
router.get("/libraries", (req, res) => {
    try {
        const FOLDERS_FILE = path.join(__dirname, "../data/folders.json");
        let folders = [];
        try {
            folders = JSON.parse(fs.readFileSync(FOLDERS_FILE, "utf-8"));
        } catch {}

        const VIDEO_EXTS = (process.env.VIDEO_EXTENSIONS || ".mp4,.mkv,.avi,.mov,.wmv").split(",");
        const result = folders.map((f) => ({
            ...f,
            fileCount: countMediaFiles(f.path, VIDEO_EXTS),
            sizeBytes: getDirSizeBytes(f.path),
            size: fmtBytes(getDirSizeBytes(f.path)),
            status: fs.existsSync(f.path) ? "online" : "offline",
        }));

        res.json({ libraries: result, total: result.length });
    } catch (err) {
        res.status(500).json({ error: "Failed to list libraries" });
    }
});

// ─── POST /api/admin-dashboard/upload ─────────────────────────────────────────
// This route did not exist before — DashUploads.jsx's local-upload path was
// calling it, but nothing here ever handled it, hence the 404. Added fresh,
// nothing else in this file touched.
//
// Streams to a temp file first (multer diskStorage, never buffers the whole
// file in memory — same pattern as the cloud Storage Provider System), then
// moves it into the real library folder once multer has finished and
// req.body.folderId is available. folderId is resolved against folders.json
// via the existing readFolders() — the client's folderPath field is NOT
// trusted for the actual write destination (that would allow writing
// anywhere on disk); it's only ever used as a display/logging hint.
const uploadTemp = multer({
    storage: multer.diskStorage({
        destination: os.tmpdir(),
        filename: (req, file, cb) => cb(null, `flux-local-upload-${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`),
    }),
    limits: { fileSize: 100 * 1024 * 1024 * 1024 }, // disk-backed, not memory-backed — this is just a sanity ceiling
});

router.post("/upload", uploadTemp.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "file is required" });

    // DEBUG — check this against the client-side log in DashUploads.jsx's
    // addFiles(). If originalname ALREADY looks like a random number here,
    // the mobile browser sent it that way in the multipart request — nothing
    // server-side to fix. If it looks correct here, the bug (if any) is in
    // the destPath/rename logic below, not in what was received.
    console.log(`[AdminDash] upload received: originalname="${req.file.originalname}" mimetype="${req.file.mimetype}" size=${req.file.size}`);

    try {
        const { folderId } = req.body;
        if (!folderId) {
            fs.unlink(req.file.path, () => {});
            return res.status(400).json({ error: "folderId is required" });
        }

        const folders = await readFolders();
        const folder = folders.find((f) => f.id === folderId);
        if (!folder) {
            fs.unlink(req.file.path, () => {});
            return res.status(404).json({ error: "Library folder not found" });
        }

        // Never trust the client-supplied name as a path: keep only the basename
        // (handles both / and \\ separators), reject empty/dot names, and make sure
        // the resolved destination is directly inside the library folder.
        const safeName = path.basename(String(req.file.originalname || "").replace(/\\/g, "/")).trim();
        const folderRoot = path.resolve(folder.path);
        const destPath = path.resolve(folderRoot, safeName);
        if (!safeName || safeName === "." || safeName === ".." || safeName.includes("\0") || path.dirname(destPath) !== folderRoot) {
            fs.unlink(req.file.path, () => {});
            return res.status(400).json({ error: "Invalid file name" });
        }

        // Never overwrite an existing file (lstat so a symlink at destPath counts too).
        const exists = await fs.promises
            .lstat(destPath)
            .then(() => true)
            .catch((e) => {
                if (e.code === "ENOENT") return false;
                throw e;
            });
        if (exists) {
            fs.unlink(req.file.path, () => {});
            return res.status(409).json({ error: `A file named "${safeName}" already exists in this library folder` });
        }

        console.log(`[AdminDash] moving to destPath="${destPath}"`); // DEBUG — same purpose as the log above

        try {
            await fs.promises.rename(req.file.path, destPath);
        } catch (err) {
            // EXDEV = temp dir and library folder are on different drives/filesystems —
            // rename can't cross that, fall back to copy + delete.
            if (err.code === "EXDEV") {
                await fs.promises.copyFile(req.file.path, destPath, fs.constants.COPYFILE_EXCL);
                await fs.promises.unlink(req.file.path);
            } else {
                throw err;
            }
        }

        if (invalidateFolder) invalidateFolder(folder.id); // so the library reflects the new file without a manual rescan

        pushLog("info", "upload", `Uploaded "${safeName}" to library "${folder.label}"`);

        notificationService
            .notify({
                userIds: [req.user.id],
                type: notificationService.TYPES.UPLOAD,
                title: "Upload complete",
                body: `${safeName} was added to ${folder.label}.`,
                meta: { fileName: safeName, libraryId: folder.id, libraryLabel: folder.label },
            })
            .catch(() => {});

        return res.status(201).json({ uploaded: { path: destPath, size: req.file.size, name: safeName, folderId: folder.id } });
    } catch (err) {
        console.error("[AdminDash] upload error:", err);
        fs.unlink(req.file.path, () => {});
        return res.status(500).json({ error: err.message || "Upload failed" });
    }
});

// ─── GET /api/admin-dashboard/logs ────────────────────────────────────────────
router.get("/logs", (req, res) => {
    const { category, level, search, limit = 100 } = req.query;
    let logs = [...LOG_BUFFER].reverse(); // newest first

    if (category) logs = logs.filter((l) => l.category === category);
    if (level) logs = logs.filter((l) => l.level === level);
    if (search) logs = logs.filter((l) => l.message?.toLowerCase().includes(search.toLowerCase()));

    res.json({ logs: logs.slice(0, parseInt(limit)), total: LOG_BUFFER.length });
});

// ─── GET /api/admin-dashboard/jobs ────────────────────────────────────────────
router.get("/jobs", (req, res) => {
    // Stream sessions double as transcoding jobs
    const sessions = getSessionStats ? getSessionStats() : [];
    const jobs = sessions.map((s) => ({
        id: s.sessionId || s.id,
        type: "transcode",
        status: "processing",
        mediaId: s.mediaPath || s.filePath,
        startedAt: s.startedAt,
        progress: s.downloadPositionSec || 0,
    }));

    res.json({ jobs, total: jobs.length });
});

// ─── POST /api/admin-dashboard/streams/:id/stop ───────────────────────────────
router.delete("/streams/:id", async (req, res) => {
    try {
        const { killSession } = require("../utils/transcoderService");
        await killSession(req.params.id);
        res.json({ message: "Stream stopped" });
    } catch (err) {
        res.status(500).json({ error: "Failed to stop stream" });
    }
});

// ─── GET /api/admin-dashboard/recent-activity ─────────────────────────────────
router.get("/activity", async (req, res) => {
    try {
        const recentUsers = await prisma.user.findMany({
            take: 5,
            where: { deletedAt: null },
            orderBy: { createdAt: "desc" },
            select: { id: true, name: true, email: true, status: true, role: true, createdAt: true },
        });

        const recentSessions = await prisma.session.findMany({
            take: 5,
            where: { isActive: true, user: { deletedAt: null }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
            orderBy: { lastSeenAt: "desc" },
            select: {
                id: true,
                deviceName: true,
                browser: true,
                os: true,
                isActive: true,
                createdAt: true,
                lastSeenAt: true,
                user: { select: { id: true, name: true, email: true } },
            },
        });

        const streams = getSessionStats ? getSessionStats() : [];

        res.json({
            recentUsers,
            // IP / user-agent intentionally omitted (not needed for support; privacy)
            recentSessions: recentSessions.map((s) => ({
                id: s.id,
                user: s.user,
                device: s.deviceName,
                browser: s.browser,
                os: s.os,
                ip: null,
                userAgent: null,
                lastSeen: s.lastSeenAt,
            })),
            activeStreams: streams.slice(0, 5),
        });
    } catch (err) {
        res.status(500).json({ error: "Failed to get activity" });
    }
});

// ─── PATCH /api/admin-dashboard/media/:id ─────────────────────────────────────
router.patch("/media/:id", (req, res) => {
    try {
        const { id } = req.params;
        const { permission } = req.body;

        if (typeof permission !== "boolean") {
            return res.status(400).json({ error: "permission must be a boolean" });
        }

        setPermission(id, permission);
        invalidateAll();

        return res.json({ id, permission });
    } catch (err) {
        console.error("[AdminDash] media permission error:", err);
        return res.status(500).json({ error: "Failed to update permission" });
    }
});

module.exports = router;
