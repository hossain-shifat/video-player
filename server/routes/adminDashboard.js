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

const prisma = require("../auth/prismaClient");
const { authenticateJWT } = require("../auth/middleware/authenticateJWT");
const { requireApprovedUser } = require("../auth/middleware/requireApprovedUser");
const { requireRole } = require("../auth/middleware/requireRole");
const { getSessionStats } = require("../utils/transcoderService");
const { setPermission } = require("../utils/permissionsStore");
const { invalidateAll } = require("../utils/mediaCache");
const { getSysInfoRoute, getLiveMetrics } = require("../utils/hwAccel");

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
        const [totalUsers, approvedUsers, pendingUsers, adminUsers] = await Promise.all([
            prisma.user.count(),
            prisma.user.count({ where: { status: "approved" } }),
            prisma.user.count({ where: { status: "pending" } }),
            prisma.user.count({ where: { role: "admin" } }),
        ]);

        const uniqueSessions = await prisma.session.groupBy({
            by: ["deviceFingerprint"],
            where: { isActive: true },
        });
        const activeSessions = uniqueSessions.length;

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
            users: { total: totalUsers, approved: approvedUsers, pending: pendingUsers, admins: adminUsers },
            sessions: { active: activeSessions },
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

// ─── GET /api/admin-dashboard/users ───────────────────────────────────────────
router.get("/users", async (req, res) => {
    try {
        const { search, status, role, page = 1, limit = 20 } = req.query;
        const where = {};
        if (status) where.status = status;
        if (role) where.role = role;
        if (search) where.OR = [{ email: { contains: search } }, { name: { contains: search } }];

        const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
        const [users, total] = await Promise.all([
            prisma.user.findMany({
                where,
                skip,
                take: parseInt(limit, 10),
                orderBy: { createdAt: "desc" },
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
                    _count: { select: { sessions: true } },
                    sessions: {
                        orderBy: { lastSeenAt: "desc" },
                        take: 1,
                        select: { ip: true },
                    },
                },
            }),
            prisma.user.count({ where }),
        ]);

        const result = users.map((u) => ({
            ...u,
            avatar: u.avarter,
            avarter: undefined,
            permissions: (() => {
                try {
                    return JSON.parse(u.permissionsJson);
                } catch {
                    return {};
                }
            })(),
            permissionsJson: undefined,
            lastIp: u.sessions?.[0]?.ip || "—",
            sessions: undefined,
        }));

        res.json({ users: result, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
    } catch (err) {
        console.error("[AdminDash] users error:", err);
        res.status(500).json({ error: "Failed to list users" });
    }
});

// ─── PATCH /api/admin-dashboard/users/:id ─────────────────────────────────────
router.patch("/users/:id", async (req, res) => {
    try {
        const { status, role, accessType, accessExpiresAt, permissions, permissionsJson, allowAdult } = req.body;
        const data = {};

        if (status !== undefined) data.status = status;
        if (role !== undefined) data.role = role;
        if (accessType !== undefined) data.accessType = accessType;
        if (accessExpiresAt !== undefined) data.accessExpiresAt = accessExpiresAt ? new Date(accessExpiresAt) : null;

        // permissions — store as JSON string in permissionsJson column
        if (permissionsJson !== undefined) {
            data.permissionsJson = permissionsJson;
        } else if (permissions !== undefined) {
            data.permissionsJson = JSON.stringify(permissions);
        }

        // allowAdult — merge into existing permissionsJson if only this field changed
        if (allowAdult !== undefined && permissionsJson === undefined && permissions === undefined) {
            const existing = await prisma.user.findUnique({ where: { id: req.params.id }, select: { permissionsJson: true } });
            let parsed = {};
            try {
                parsed = JSON.parse(existing?.permissionsJson || "{}");
            } catch {}
            parsed.allowAdult = allowAdult;
            data.permissionsJson = JSON.stringify(parsed);
        }

        const user = await prisma.user.update({ where: { id: req.params.id }, data });

        // Parse permissionsJson back to object for response
        let parsedPerms = {};
        try {
            parsedPerms = JSON.parse(user.permissionsJson || "{}");
        } catch {}

        res.json({
            user: {
                id: user.id,
                status: user.status,
                role: user.role,
                accessType: user.accessType,
                accessExpiresAt: user.accessExpiresAt,
                permissions: parsedPerms,
                permissionsJson: user.permissionsJson,
            },
        });
    } catch (err) {
        if (err.code === "P2025") return res.status(404).json({ error: "User not found" });
        res.status(500).json({ error: "Failed to update user" });
    }
});

// ─── DELETE /api/admin-dashboard/users/:id ────────────────────────────────────
router.delete("/users/:id", async (req, res) => {
    try {
        if (req.params.id === req.user.id) {
            return res.status(400).json({ error: "Cannot delete your own account" });
        }
        await prisma.user.delete({ where: { id: req.params.id } });
        res.json({ message: "User deleted" });
    } catch (err) {
        if (err.code === "P2025") return res.status(404).json({ error: "User not found" });
        res.status(500).json({ error: "Failed to delete user" });
    }
});

// ─── GET /api/admin-dashboard/users/:id/sessions ──────────────────────────────
router.get("/users/:id/sessions", async (req, res) => {
    try {
        const sessions = await prisma.session.findMany({
            where: { userId: req.params.id },
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
        const mappedSessions = uniqueSessions.map((s) => {
            const copy = { ...s };
            delete copy.deviceFingerprint;
            return copy;
        });

        res.json({ sessions: mappedSessions, total: mappedSessions.length });
    } catch (err) {
        res.status(500).json({ error: "Failed to get sessions" });
    }
});

// ─── DELETE /api/admin-dashboard/sessions/:id ─────────────────────────────────
router.delete("/sessions/:id", async (req, res) => {
    try {
        await prisma.session.update({ where: { id: req.params.id }, data: { isActive: false } });
        res.json({ message: "Session revoked" });
    } catch (err) {
        if (err.code === "P2025") return res.status(404).json({ error: "Session not found" });
        res.status(500).json({ error: "Failed to revoke session" });
    }
});

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
            orderBy: { createdAt: "desc" },
            select: { id: true, name: true, email: true, status: true, role: true, createdAt: true },
        });

        const recentSessions = await prisma.session.findMany({
            take: 5,
            where: { isActive: true },
            orderBy: { lastSeenAt: "desc" },
            select: {
                id: true,
                deviceName: true,
                browser: true,
                os: true,
                ip: true,
                userAgent: true,
                isActive: true,
                createdAt: true,
                lastSeenAt: true,
                user: { select: { id: true, name: true, email: true } },
            },
        });

        const streams = getSessionStats ? getSessionStats() : [];

        res.json({
            recentUsers,
            recentSessions: recentSessions.map((s) => ({
                id: s.id,
                user: s.user,
                device: s.deviceName,
                browser: s.browser,
                os: s.os,
                ip: s.ip,
                userAgent: s.userAgent,
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
