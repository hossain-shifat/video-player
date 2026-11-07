"use strict";

/**
 * routes/notifications.js — mounted at /api/notifications
 *
 * EVERY query is scoped to req.user (loaded from the DB by authenticateJWT —
 * never from client-supplied ids/roles) AND to what that user's CURRENT role is
 * allowed to see (notificationService.visibleWhere). A notification that
 * belongs to someone else, or is admin-only for a non-admin, is a 404.
 *
 *   GET    /                    list (cursor paginated) + unreadCount
 *   GET    /:id                 one notification with details + verified destination
 *   POST   /read-all            mark everything (visible) read
 *   DELETE /                    clear all (visible)
 *   PATCH  /:id/read            mark one read
 *   DELETE /:id                 delete one
 *
 *   GET    /status              server push state (admins get the reason/message)
 *   GET    /preferences         PATCH /preferences   (PATCH, not PUT — CORS allow-list has no PUT)
 *
 *   GET    /devices             this user's registered devices
 *   POST   /devices             register / refresh an FCM token
 *   DELETE /devices?token=…     unregister by token (used on opt-out)
 *   DELETE /devices/:id         remove a device by id
 *
 *   POST   /test                send a test notification to yourself
 *   POST   /announce            admin only: broadcast (audience: "all" | "admins")
 *   GET    /announcements       admin only: recent broadcasts with delivered/read counts
 *   GET    /announcement-routes admin only: pages an announcement may link to
 *   POST   /diagnostics         admin only: re-check connectivity to Google FCM
 */

const crypto = require("crypto");
const express = require("express");
const UAParser = require("ua-parser-js");
const router = express.Router();

const prisma = require("../../auth/prismaClient");
const { authenticateJWT } = require("../../auth/middleware/authenticateJWT");
const { requireRole } = require("../../auth/middleware/requireRole");
const notificationService = require("../../services/notificationService");
const pushService = require("../../services/pushService");

const { TYPES, visibleWhere, toListDto, toListDtos } = notificationService;

// Approved users AND pending users (so a pending user's browser can register
// and be told "you're approved"). Blocked / rejected are shut out.
function requireDeliverable(req, res, next) {
    if (!["approved", "pending"].includes(req.user?.status)) {
        return res.status(403).json({ error: "Account not active" });
    }
    next();
}

// Clear error (instead of a cryptic "undefined.findMany") when the DB hasn't been updated.
function requireSchema(req, res, next) {
    if (!notificationService.schemaReady()) {
        return res.status(503).json({ error: notificationService.SCHEMA_HELP, code: "NOTIFICATIONS_SCHEMA_MISSING" });
    }
    next();
}

router.use(authenticateJWT, requireDeliverable, requireSchema);

// ─── Status ───────────────────────────────────────────────────────────────────
router.get("/status", (req, res) => {
    const s = pushService.getStatus();
    const ready = s.state === "ready";
    // Operational detail (which credential file, Google errors…) is for admins only.
    if (req.user.role !== "admin") return res.json({ pushConfigured: ready, state: s.state });
    res.json({ pushConfigured: ready, state: s.state, reason: s.reason, message: s.message });
});

router.post("/diagnostics", requireRole("admin"), async (req, res) => {
    const connectivity = await pushService.checkConnectivity();
    res.json({ ...pushService.getStatus(), connectivity });
});

// ─── Preferences ──────────────────────────────────────────────────────────────
router.get("/preferences", async (req, res) => {
    try {
        res.json({ preferences: await notificationService.getPreferences(req.user.id) });
    } catch (err) {
        console.error("[Notify] get prefs:", err);
        res.status(500).json({ error: "Failed to load preferences" });
    }
});

router.patch("/preferences", async (req, res) => {
    try {
        const preferences = await notificationService.updatePreferences(req.user.id, req.body || {});
        res.json({ preferences });
    } catch (err) {
        console.error("[Notify] update prefs:", err);
        res.status(500).json({ error: "Failed to update preferences" });
    }
});

// ─── Release reminders ("Remind me" on an upcoming title) ─────────────────────
// Declared BEFORE the "/:id" routes below so "/reminders/..." is never read as a notification id.
const reminderStore = notificationService.reminders;
const MAX_REMINDERS_PER_USER = 300;

const mediaTypeOf = (mediaId) => (mediaId.startsWith("tmdb-tv-") ? "series" : "movie");
const reminderDto = (r) => ({ mediaId: r.mediaId, releaseDate: r.releaseDate, createdAt: r.createdAt });

function requireApproved(req, res, next) {
    if (req.user?.status !== "approved") return res.status(403).json({ error: "Your account must be approved to set reminders" });
    next();
}

router.get("/reminders/:mediaId", requireApproved, (req, res) => {
    const mediaId = String(req.params.mediaId || "");
    if (!notificationService.TMDB_MEDIA_ID.test(mediaId)) return res.status(400).json({ error: "Invalid title" });
    const r = reminderStore.find(req.user.id, mediaId);
    res.json({ reminded: !!r, reminder: r ? reminderDto(r) : null });
});

router.post("/reminders", requireApproved, (req, res) => {
    try {
        const { mediaId, title, poster, releaseDate } = req.body || {};
        if (typeof mediaId !== "string" || !notificationService.TMDB_MEDIA_ID.test(mediaId)) return res.status(400).json({ error: "Invalid title" });
        const name = typeof title === "string" ? title.trim().slice(0, 200) : "";
        if (!name) return res.status(400).json({ error: "Title is required" });
        if (typeof releaseDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(releaseDate) || Number.isNaN(Date.parse(`${releaseDate}T00:00:00Z`))) {
            return res.status(400).json({ error: "A valid release date is required" });
        }
        const todayUtc = new Date().toISOString().slice(0, 10);
        if (releaseDate < todayUtc) return res.status(400).json({ error: "This title is already released" });

        if (!reminderStore.find(req.user.id, mediaId) && reminderStore.countForUser(req.user.id) >= MAX_REMINDERS_PER_USER) {
            return res.status(400).json({ error: "You have reached the reminder limit" });
        }
        const safePoster = typeof poster === "string" && poster.startsWith(notificationService.TMDB_IMAGE_PREFIX) ? poster.slice(0, 300) : null;
        const { item, created } = reminderStore.upsert({ userId: req.user.id, mediaId, mediaType: mediaTypeOf(mediaId), title: name, poster: safePoster, releaseDate });
        res.status(created ? 201 : 200).json({ reminded: true, created, reminder: reminderDto(item) });
    } catch (err) {
        console.error("[Reminders] create:", err);
        res.status(500).json({ error: "Failed to set the reminder" });
    }
});

router.delete("/reminders/:mediaId", requireApproved, (req, res) => {
    const mediaId = String(req.params.mediaId || "");
    if (!notificationService.TMDB_MEDIA_ID.test(mediaId)) return res.status(400).json({ error: "Invalid title" });
    reminderStore.remove(req.user.id, mediaId);
    res.json({ reminded: false });
});

// ─── Devices ──────────────────────────────────────────────────────────────────
function describeDevice(req, fallback) {
    if (fallback && String(fallback).trim()) return String(fallback).trim().slice(0, 80);
    const ua = new UAParser(req.headers["user-agent"] || "").getResult();
    const browser = ua.browser.name || "Browser";
    const os = ua.os.name || "Unknown OS";
    return `${browser} on ${os}`;
}

router.get("/devices", async (req, res) => {
    try {
        const devices = await prisma.pushDevice.findMany({
            where: { userId: req.user.id, isActive: true },
            orderBy: { lastSeenAt: "desc" },
            select: { id: true, deviceName: true, platform: true, createdAt: true, lastSeenAt: true, sessionId: true },
        });
        // Never hand raw tokens back — expose only whether this row is the caller's current session.
        res.json({
            devices: devices.map((d) => ({
                id: d.id,
                deviceName: d.deviceName,
                platform: d.platform,
                createdAt: d.createdAt,
                lastSeenAt: d.lastSeenAt,
                isCurrentSession: !!req.sessionId && d.sessionId === req.sessionId,
            })),
        });
    } catch (err) {
        console.error("[Notify] list devices:", err);
        res.status(500).json({ error: "Failed to list devices" });
    }
});

router.post("/devices", async (req, res) => {
    try {
        const { token, deviceName } = req.body || {};
        if (typeof token !== "string" || token.length < 20 || token.length > 4096) {
            return res.status(400).json({ error: "A valid FCM token is required" });
        }

        const name = describeDevice(req, deviceName);
        const userAgent = String(req.headers["user-agent"] || "").slice(0, 400);

        // token is globally unique: if another account used this browser,
        // the registration moves to the account that is signed in now.
        const device = await prisma.pushDevice.upsert({
            where: { token },
            create: { userId: req.user.id, token, platform: "web", deviceName: name, userAgent, sessionId: req.sessionId || null, isActive: true },
            update: { userId: req.user.id, deviceName: name, userAgent, sessionId: req.sessionId || null, isActive: true, failureCount: 0, lastSeenAt: new Date() },
            select: { id: true },
        });

        res.status(201).json({ id: device.id });
    } catch (err) {
        console.error("[Notify] register device:", err);
        res.status(500).json({ error: "Failed to register device" });
    }
});

router.delete("/devices", async (req, res) => {
    try {
        const token = String(req.query.token || "");
        if (!token) return res.status(400).json({ error: "token is required" });
        await prisma.pushDevice.deleteMany({ where: { token, userId: req.user.id } });
        res.json({ message: "Device removed" });
    } catch (err) {
        console.error("[Notify] unregister device:", err);
        res.status(500).json({ error: "Failed to remove device" });
    }
});

router.delete("/devices/:id", async (req, res) => {
    try {
        const r = await prisma.pushDevice.deleteMany({ where: { id: req.params.id, userId: req.user.id } });
        if (!r.count) return res.status(404).json({ error: "Device not found" });
        res.json({ message: "Device removed" });
    } catch (err) {
        console.error("[Notify] remove device:", err);
        res.status(500).json({ error: "Failed to remove device" });
    }
});

// ─── Test / announce ──────────────────────────────────────────────────────────
router.post("/test", async (req, res) => {
    const rows = await notificationService.notify({
        userIds: [req.user.id],
        type: TYPES.SYSTEM,
        title: "Test notification",
        body: "If you can read this outside the browser, push is working.",
    });
    if (!rows.length) return res.status(500).json({ error: "Failed to create notification" });
    res.status(201).json({ notification: toListDto(rows[0]), pushConfigured: pushService.isEnabled() });
});

router.get("/announcement-routes", requireRole("admin"), (req, res) => {
    res.json({ routes: notificationService.ANNOUNCE_ROUTES });
});

router.post("/announce", requireRole("admin"), async (req, res) => {
    try {
        const { title, body, url, audience = "all" } = req.body || {};
        if (!title || !String(title).trim()) return res.status(400).json({ error: "title is required" });
        if (!["all", "admins"].includes(audience)) return res.status(400).json({ error: 'audience must be "all" or "admins"' });

        // A link may only point at a page that actually exists (see ANNOUNCE_ROUTES).
        if (url && !notificationService.ANNOUNCE_ROUTES.some((r) => r.path === url)) {
            return res.status(400).json({ error: "link must be one of the listed pages" });
        }

        const adminOnly = audience === "admins";
        const base = {
            // Admin-only announcements use their own type so a non-admin can never see them, even later.
            type: adminOnly ? TYPES.ANNOUNCEMENT_ADMIN : TYPES.ANNOUNCEMENT,
            title: String(title).trim().slice(0, 120),
            body: String(body || "").trim().slice(0, 300),
            url: url || null,
            dedupeKey: `announce:${crypto.randomUUID()}`, // one batch id per broadcast
        };
        const rows = adminOnly ? await notificationService.notifyAdmins(base) : await notificationService.notifyAllApproved(base);

        // notify() never throws; zero rows means nothing was stored. Say so instead of pretending it worked.
        if (!rows.length) {
            return res.status(500).json({ error: "Nothing was delivered. Check the server console for '[Notify]' errors — if you just updated, run: npx prisma db push && npx prisma generate, then restart the server." });
        }

        res.status(201).json({ delivered: rows.length, pushConfigured: pushService.isEnabled() });
    } catch (err) {
        console.error("[Notify] announce:", err);
        res.status(500).json({ error: "Failed to send announcement" });
    }
});

router.get("/announcements", requireRole("admin"), async (req, res) => {
    try {
        const heads = await prisma.notification.findMany({
            where: { type: { in: [TYPES.ANNOUNCEMENT, TYPES.ANNOUNCEMENT_ADMIN] }, dedupeKey: { startsWith: "announce:" } },
            distinct: ["dedupeKey"],
            orderBy: { createdAt: "desc" },
            take: 20,
            select: { dedupeKey: true, title: true, body: true, type: true, createdAt: true },
        });
        const keys = heads.map((h) => h.dedupeKey);

        const [totals, reads] = keys.length
            ? await Promise.all([
                  prisma.notification.groupBy({ by: ["dedupeKey"], where: { dedupeKey: { in: keys } }, _count: { _all: true } }),
                  prisma.notification.groupBy({ by: ["dedupeKey"], where: { dedupeKey: { in: keys }, readAt: { not: null } }, _count: { _all: true } }),
              ])
            : [[], []];

        const totalBy = new Map(totals.map((r) => [r.dedupeKey, r._count._all]));
        const readBy = new Map(reads.map((r) => [r.dedupeKey, r._count._all]));

        res.json({
            announcements: heads.map((h) => ({
                id: h.dedupeKey,
                title: h.title,
                body: h.body,
                audience: h.type === TYPES.ANNOUNCEMENT_ADMIN ? "admins" : "all",
                createdAt: h.createdAt,
                delivered: totalBy.get(h.dedupeKey) || 0,
                read: readBy.get(h.dedupeKey) || 0,
            })),
        });
    } catch (err) {
        console.error("[Notify] announcements:", err);
        res.status(500).json({ error: "Failed to load announcements" });
    }
});

// ─── History (own + visible-to-my-role only) ──────────────────────────────────
router.get("/", async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
        const unreadOnly = req.query.unreadOnly === "true";
        const cursor = req.query.cursor ? String(req.query.cursor) : null;

        const scope = visibleWhere(req.user);
        const where = { ...scope, ...(unreadOnly ? { readAt: null } : {}) };

        const [rows, unreadCount] = await Promise.all([
            prisma.notification.findMany({
                where,
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                take: limit + 1,
                ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            }),
            prisma.notification.count({ where: { ...scope, readAt: null } }),
        ]);

        const hasMore = rows.length > limit;
        const items = await toListDtos(hasMore ? rows.slice(0, limit) : rows, req.user);
        res.json({ items, unreadCount, nextCursor: hasMore ? items[items.length - 1].id : null });
    } catch (err) {
        console.error("[Notify] list:", err);
        res.status(500).json({ error: "Failed to load notifications" });
    }
});

router.post("/read-all", async (req, res) => {
    try {
        const r = await prisma.notification.updateMany({ where: { ...visibleWhere(req.user), readAt: null }, data: { readAt: new Date() } });
        res.json({ updated: r.count });
    } catch (err) {
        console.error("[Notify] read-all:", err);
        res.status(500).json({ error: "Failed to mark all read" });
    }
});

router.delete("/", async (req, res) => {
    try {
        const r = await prisma.notification.deleteMany({ where: visibleWhere(req.user) });
        res.json({ deleted: r.count });
    } catch (err) {
        console.error("[Notify] clear:", err);
        res.status(500).json({ error: "Failed to clear notifications" });
    }
});

router.get("/:id", async (req, res) => {
    try {
        const detail = await notificationService.getNotificationDetail(req.params.id, req.user.id, { sessionId: req.sessionId });
        if (!detail) return res.status(404).json({ error: "Notification not found" });
        res.json({ notification: detail });
    } catch (err) {
        console.error("[Notify] detail:", err);
        res.status(500).json({ error: "Failed to load notification" });
    }
});

router.patch("/:id/read", async (req, res) => {
    try {
        const r = await prisma.notification.updateMany({ where: { id: req.params.id, ...visibleWhere(req.user), readAt: null }, data: { readAt: new Date() } });
        // count 0 = already read, not yours, or not visible to your role; all fine for an idempotent call
        res.json({ updated: r.count });
    } catch (err) {
        console.error("[Notify] read:", err);
        res.status(500).json({ error: "Failed to mark read" });
    }
});

router.delete("/:id", async (req, res) => {
    try {
        const r = await prisma.notification.deleteMany({ where: { id: req.params.id, ...visibleWhere(req.user) } });
        if (!r.count) return res.status(404).json({ error: "Notification not found" });
        res.json({ message: "Deleted" });
    } catch (err) {
        console.error("[Notify] delete:", err);
        res.status(500).json({ error: "Failed to delete notification" });
    }
});

module.exports = router;
