"use strict";

/**
 * services/notificationService.js
 *
 * Single entry point for creating AND reading notifications.
 *   1. Persist a Notification row per recipient (history is ALWAYS stored).
 *   2. Fan out an FCM push (fire-and-forget) to the recipient's active devices,
 *      respecting their push preferences. The push carries the MINIMUM
 *      (generic title/body + notification id); details are fetched from the
 *      authenticated backend when the user opens the notification.
 *   3. Role-based visibility, verified destinations and type-specific detail
 *      context are all decided HERE, on the server.
 *
 * Nothing in the create path throws — a notification failure must never break
 * the request/job that triggered it.
 */

const prisma = require("../auth/prismaClient");
const push = require("./pushService");
const { parsePermissions } = require("../auth/services/permissionService");

// ─── Types ────────────────────────────────────────────────────────────────────
const TYPES = Object.freeze({
    NEW_MEDIA: "new_media",
    UPLOAD: "upload",
    STORAGE: "storage", // admin only
    SECURITY: "security", // new sign-in, about the recipient's OWN account
    ACCOUNT: "account", // e.g. "your account was approved" (recipient's own account)
    SIGNUP_PENDING: "signup_pending", // admin only: someone is waiting for approval
    ANNOUNCEMENT: "announcement",
    ANNOUNCEMENT_ADMIN: "announcement_admin", // admin only
    ADMIN_SIGNIN: "admin_signin", // admin only: a user signed in on a new device / is using several devices
    RELEASE_REMINDER: "release_reminder", // the recipient asked to be reminded when an upcoming title is released
    SYSTEM: "system",
});

// notification type → NotificationPreference column. null = always pushed
// (as long as the master switch is on).
const TYPE_TO_PREF = {
    new_media: "newMedia",
    upload: "uploads",
    storage: "storage",
    security: "security",
    account: "account",
    signup_pending: "account",
    announcement: "announcements",
    announcement_admin: "announcements",
    admin_signin: "security",
    release_reminder: null, // the user asked for it explicitly → always delivered (master switch still applies)
    system: null,
};

const TYPE_LABELS = {
    new_media: "New media",
    upload: "Upload",
    storage: "Storage",
    security: "Security",
    account: "Account",
    signup_pending: "New user",
    announcement: "Announcement",
    announcement_admin: "Admin announcement",
    admin_signin: "Sign-in",
    release_reminder: "Reminder",
    system: "System",
};

// Never shown to (or retrievable by) non-admins, even if an old row exists
// (e.g. a user who used to be an admin).
const ADMIN_ONLY_TYPES = [TYPES.SIGNUP_PENDING, TYPES.STORAGE, TYPES.ANNOUNCEMENT_ADMIN, TYPES.ADMIN_SIGNIN];
// Rows written before signup_pending existed used type "account" with these titles.
const LEGACY_ADMIN_TITLES = ["New signup awaiting approval", "Recovered account awaiting approval"];

const PREF_FIELDS = ["pushEnabled", "newMedia", "uploads", "storage", "security", "account", "announcements"];
const DEFAULT_PREFS = Object.freeze({ pushEnabled: true, newMedia: true, uploads: true, storage: true, security: true, account: true, announcements: true });

const RETENTION_DAYS = parseInt(process.env.NOTIFICATION_RETENTION_DAYS || "90", 10);
const STALE_DEVICE_DAYS = parseInt(process.env.PUSH_STALE_DEVICE_DAYS || "60", 10);

// Statuses that may still receive notifications (pending users can be told they were approved).
const DELIVERABLE_STATUSES = ["approved", "pending"];

// ─── Destinations (VERIFIED against web/src/Routes/Routes.jsx) ────────────────
// Announcement links may only point at these existing top-level pages.
const ANNOUNCE_ROUTES = Object.freeze([
    { path: "/", label: "Home" },
    { path: "/movies", label: "Movies" },
    { path: "/series", label: "Series" },
    { path: "/discover", label: "Discover" },
    { path: "/live", label: "Live TV" },
    { path: "/recommendations", label: "Recommendations" },
    { path: "/watchlist", label: "Watchlist" },
    { path: "/my-media", label: "My Media" },
]);

// Existing page where users review/rename/log out their devices: Settings → Profile (DevicesSection is rendered
// inside the Profile tab; admins use Dashboard → Users for other people's devices).
// Profile picture URL (User.avarter): only plain http(s) URLs reach the client, nothing else.
const safeAvatarUrl = (v) => (typeof v === "string" && /^https?:\/\/\S{3,480}$/.test(v) ? v : null);
const TMDB_MEDIA_ID = /^tmdb-(movie|tv)-\d{1,10}$/;
const TMDB_IMAGE_PREFIX = "https://image.tmdb.org/t/p/";
const DEVICES_DESTINATION = { path: "/settings?tab=profile", label: "Manage devices" };

/**
 * Where the action button of a notification leads. Computed at READ time from
 * the viewer's current role, never trusted from the client.
 *
 * Returns null when no suitable EXISTING page exists (shown in the modal with
 * no action button):
 *   storage  → no verified page shows disk usage (GAP)
 */
function resolveDestination(row, user) {
    const admin = user?.role === "admin";
    switch (row.type) {
        case TYPES.NEW_MEDIA:
            return { path: "/", label: "Browse library" };
        case TYPES.UPLOAD:
            return admin ? { path: "/dashboard/uploads", label: "Open uploads" } : null;
        case TYPES.SIGNUP_PENDING:
            return admin ? { path: "/dashboard/users", label: "Review users" } : null;
        case TYPES.ADMIN_SIGNIN:
            return admin ? { path: "/dashboard/users", label: "Review users" } : null;
        case TYPES.ACCOUNT:
            if (LEGACY_ADMIN_TITLES.includes(row.title)) return admin ? { path: "/dashboard/users", label: "Review users" } : null;
            return { path: "/", label: "Start watching" };
        case TYPES.ANNOUNCEMENT:
        case TYPES.ANNOUNCEMENT_ADMIN: {
            const hit = ANNOUNCE_ROUTES.find((r) => r.path === row.url);
            return hit ? { path: hit.path, label: `Open ${hit.label}` } : null;
        }
        case TYPES.SECURITY:
            return DEVICES_DESTINATION;
        case TYPES.RELEASE_REMINDER: {
            // Existing page: the details route also renders TMDB-only titles ("tmdb-movie-123").
            const mediaId = parseMeta(row).mediaId;
            return TMDB_MEDIA_ID.test(String(mediaId || "")) ? { path: `/media/${encodeURIComponent(mediaId)}`, label: "View details" } : { path: "/", label: "Browse library" };
        }
        case TYPES.SYSTEM:
            return { path: "/settings?tab=notifications", label: "Notification settings" };
        default:
            return null; // storage
    }
}

// ─── Role-based visibility ────────────────────────────────────────────────────

/** Prisma `where` for "notifications this user is allowed to see/modify". Always scoped to the user. */
function visibleWhere(user) {
    if (user.role === "admin") return { userId: user.id };
    return {
        userId: user.id,
        type: { notIn: ADMIN_ONLY_TYPES },
        NOT: { type: TYPES.ACCOUNT, title: { in: LEGACY_ADMIN_TITLES } },
    };
}

// ─── Recipient helpers ────────────────────────────────────────────────────────

async function adminIds() {
    const rows = await prisma.user.findMany({ where: { role: "admin", status: "approved" }, select: { id: true } });
    return rows.map((r) => r.id);
}

async function approvedUserIds() {
    const rows = await prisma.user.findMany({ where: { status: "approved" }, select: { id: true } });
    return rows.map((r) => r.id);
}

/**
 * Can this user see this library folder? FAILS CLOSED: anything we can't
 * positively confirm returns false, so nobody is told about a library they
 * might not be allowed to see.
 *
 * TODO(verify): align with server/auth/middleware/requireLibraryAccess.js and
 * the adult-library rule (requireAdultPermission.js) once those files are
 * reviewed.
 */
function userCanAccessLibrary(user, folderId) {
    try {
        if (!user || !folderId) return false;
        if (user.status !== "approved") return false;
        if (user.accessType === "temporary" && user.accessExpiresAt && new Date(user.accessExpiresAt) <= new Date()) return false;
        if (user.role === "admin") return true;

        const perms = parsePermissions(user.permissionsJson);
        if (!perms || !Array.isArray(perms.libraries)) return false;
        return perms.libraries.includes(folderId);
    } catch {
        return false;
    }
}

async function libraryUserIds(folderId) {
    if (!folderId) return [];
    const rows = await prisma.user.findMany({
        where: { status: "approved" },
        select: { id: true, role: true, status: true, accessType: true, accessExpiresAt: true, permissionsJson: true },
    });
    return rows.filter((u) => userCanAccessLibrary(u, folderId)).map((u) => u.id);
}

// ─── Core: create + push ──────────────────────────────────────────────────────

/**
 * @param {object}   opts
 * @param {string[]} opts.userIds
 * @param {string}   opts.type             one of TYPES
 * @param {string}   opts.title
 * @param {string}  [opts.body]            keep generic — it can appear on a lock screen
 * @param {object}  [opts.meta]            structured identifiers for the details modal (no secrets / fs paths)
 * @param {string}  [opts.url]             announcements only: one of ANNOUNCE_ROUTES paths
 * @param {string}  [opts.dedupeKey]
 * @param {number}  [opts.dedupeWindowMs]
 * @returns {Promise<Array>} created Notification rows ([] on failure)
 */
async function notify({ userIds, type = TYPES.SYSTEM, title, body = "", meta = null, url = null, dedupeKey = null, dedupeWindowMs = 0 }) {
    try {
        if (!schemaReady()) {
            console.error(`[Notify] ✖ Dropping "${title}" — ${SCHEMA_HELP}`);
            return [];
        }
        let ids = [...new Set((userIds || []).filter(Boolean))];
        if (!ids.length || !title) return [];

        if (dedupeKey && dedupeWindowMs > 0) {
            const since = new Date(Date.now() - dedupeWindowMs);
            const recent = await prisma.notification.findMany({
                where: { userId: { in: ids }, dedupeKey, createdAt: { gte: since } },
                select: { userId: true },
            });
            const seen = new Set(recent.map((r) => r.userId));
            ids = ids.filter((id) => !seen.has(id));
            if (!ids.length) return [];
        }

        const metaJson = meta ? JSON.stringify(meta).slice(0, 4000) : null;
        const base = (userId) => ({ userId, type, title: String(title).slice(0, 200), body: String(body).slice(0, 1000), url, dedupeKey });

        let rows;
        try {
            rows = await prisma.$transaction(ids.map((userId) => prisma.notification.create({ data: { ...base(userId), metaJson } })));
        } catch (err) {
            // The DB / Prisma client doesn't have the metaJson column yet (db push + generate not run).
            // Don't lose the notification: store it without details and say what to do.
            if (!/metaJson/i.test(String(err.message))) throw err;
            console.error("[Notify] ✖ Column notifications.metaJson is missing — saving WITHOUT details. In server/ run: npx prisma db push  &&  npx prisma generate  (then restart).");
            rows = await prisma.$transaction(ids.map((userId) => prisma.notification.create({ data: base(userId) })));
        }

        console.log(`[Notify] stored "${title}" (${type}) for ${rows.length} user(s)`);

        // Push is best-effort and must not delay the caller.
        setImmediate(() => {
            _deliverPush(rows).catch((err) => console.error("[Notify] push fan-out failed:", err.message));
        });

        return rows;
    } catch (err) {
        console.error("[Notify] notify() failed:", err.message);
        return [];
    }
}

/**
 * Called once when a login creates a Device the account has not used before.
 *   • the account's OWN user is told (only if they already had another device) — "new session"
 *   • every OTHER approved admin is told about the sign-in; if the user now has 2+ devices it is flagged as
 *     "multiple devices". Pending/unapproved users are covered by the signup/approval alerts instead.
 * Device details are read here, so the caller only passes ids:
 *
 *     notificationService.notifyNewSignIn({ userId, sessionId: session.id, deviceId: device.id, hadOtherDevices }).catch(() => {});
 */
async function notifyNewSignIn({ userId, sessionId = null, deviceId = null, hadOtherDevices = true }) {
    try {
        if (!schemaReady() || !userId) return [];
        const [device, session, user, deviceCount] = await Promise.all([
            deviceId && prisma.device ? prisma.device.findUnique({ where: { id: deviceId }, select: { customName: true, browser: true, os: true, deviceType: true } }) : null,
            sessionId ? prisma.session.findUnique({ where: { id: sessionId }, select: { deviceName: true, browser: true, os: true, deviceType: true } }) : null,
            prisma.user.findUnique({ where: { id: userId }, select: { id: true, status: true } }),
            prisma.device ? prisma.device.count({ where: { userId } }) : 1,
        ]);
        const browser = device?.browser || session?.browser || null;
        const os = device?.os || session?.os || null;
        const legacyName = session?.deviceName && session.deviceName !== "Unknown Device" ? session.deviceName : null;
        const deviceName = device?.customName || (browser && os ? `${browser} on ${os}` : browser || os || legacyName);
        const deviceType = device?.deviceType || session?.deviceType || null;
        const out = [];

        if (hadOtherDevices) {
            out.push(
                ...(await notify({
                    userIds: [userId],
                    type: TYPES.SECURITY,
                    title: "New sign-in to your account",
                    body: "Your account was signed in on a new device.",
                    meta: { event: "new_device", sessionId, deviceId, deviceName, browser, os, deviceType },
                })),
            );
        }

        if (user?.status === "approved") {
            const admins = (await adminIds()).filter((id) => id !== userId); // an admin already gets their own alert above
            if (admins.length) {
                const multi = hadOtherDevices && deviceCount >= 2;
                out.push(
                    ...(await notify({
                        userIds: admins,
                        type: TYPES.ADMIN_SIGNIN,
                        title: multi ? "User on multiple devices" : "New sign-in",
                        body: multi ? `A user is now signed in on ${deviceCount} devices.` : "A user signed in on a new device.", // no name/email: push can reach a lock screen
                        meta: { event: multi ? "multi_device" : "new_device", userId, sessionId, deviceId, deviceCount, deviceName, browser, os, deviceType },
                        dedupeKey: `adminsignin:${deviceId || sessionId}`,
                        dedupeWindowMs: 6 * 60 * 60 * 1000,
                    })),
                );
            }
        }
        return out;
    } catch (err) {
        console.error("[Notify] notifyNewSignIn failed:", err.message);
        return [];
    }
}

// ─── Account status / access-duration changes (admin → that user) ─────────────
const fmtDay = (d) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const sameInstant = (a, b) => (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);

function statusCopy(from, to) {
    switch (to) {
        case "approved":
            return from === "pending" || !from
                ? { title: "Your account was approved", body: "You can now browse and watch on FLUX." }
                : { title: "Your access was restored", body: "An administrator re-enabled your account." };
        case "rejected":
            return { title: "Your registration wasn't approved", body: "An administrator declined your account request." };
        case "blocked":
            return { title: "Your account was blocked", body: "An administrator blocked your account." };
        case "pending":
            return { title: "Your account is awaiting approval", body: "An administrator will review your account." };
        default:
            return null; // e.g. "deleted" is handled by the account-deletion flow itself
    }
}

function accessCopy(after) {
    if (after.accessType === "permanent") return { title: "Your access is now permanent", body: "Your account no longer has an expiry date." };
    if (after.accessExpiresAt) return { title: "Your access duration changed", body: `Your access now ends on ${fmtDay(after.accessExpiresAt)}.` };
    return { title: "Your access is now limited", body: "An administrator set a limited access period." };
}

/**
 * Tell a user what an admin just changed on their account (status and/or access duration). One notification,
 * even if both changed. Stored for every status; push only reaches approved/pending users.
 *   before/after: { status, accessType, accessExpiresAt }
 */
async function notifyAccountChange({ userId, before, after }) {
    try {
        if (!userId || !before || !after) return [];
        const events = [];
        const statusChanged = before.status !== after.status;
        if (statusChanged) {
            const c = statusCopy(before.status, after.status);
            if (c) events.push(c);
        }
        const accessChanged = before.accessType !== after.accessType || !sameInstant(before.accessExpiresAt, after.accessExpiresAt);
        if (accessChanged) events.push(accessCopy(after));
        if (!events.length) return [];

        return await notify({
            userIds: [userId],
            type: TYPES.ACCOUNT,
            title: events[0].title,
            body: events.map((e) => e.body).join(" "),
            meta: {
                event: "account_updated",
                statusChanged,
                accessChanged,
                status: after.status,
                accessType: after.accessType,
                accessExpiresAt: after.accessExpiresAt ? new Date(after.accessExpiresAt).toISOString() : null,
            },
        });
    } catch (err) {
        console.error("[Notify] notifyAccountChange failed:", err.message);
        return [];
    }
}

const notifyAdmins = async (opts) => notify({ ...opts, userIds: await adminIds() });
const notifyAllApproved = async (opts) => notify({ ...opts, userIds: await approvedUserIds() });
const notifyLibraryUsers = async (folderId, opts) => notify({ ...opts, userIds: await libraryUserIds(folderId) });

async function _deliverPush(rows) {
    if (!rows.length || !push.isEnabled()) return;

    const userIds = [...new Set(rows.map((r) => r.userId))];

    const [prefRows, users, devices] = await Promise.all([
        prisma.notificationPreference.findMany({ where: { userId: { in: userIds } } }),
        prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, status: true, role: true, permissionsJson: true } }),
        prisma.pushDevice.findMany({ where: { userId: { in: userIds }, isActive: true }, select: { id: true, userId: true, token: true, sessionId: true } }),
    ]);
    if (!devices.length) return;

    // Drop devices whose login session was revoked/logged out.
    const sessionIds = [...new Set(devices.map((d) => d.sessionId).filter(Boolean))];
    const liveSessions = sessionIds.length ? new Set((await prisma.session.findMany({ where: { id: { in: sessionIds }, isActive: true, revokedAt: null }, select: { id: true } })).map((s) => s.id)) : new Set();
    const revoked = devices.filter((d) => d.sessionId && !liveSessions.has(d.sessionId));
    if (revoked.length) {
        await prisma.pushDevice.updateMany({ where: { id: { in: revoked.map((d) => d.id) } }, data: { isActive: false } }).catch(() => {});
    }
    const revokedIds = new Set(revoked.map((d) => d.id));

    const prefByUser = new Map(prefRows.map((p) => [p.userId, p]));
    const statusByUser = new Map(users.map((u) => [u.id, u.status]));
    const userById = new Map(users.map((u) => [u.id, u]));
    const devicesByUser = new Map();
    for (const d of devices) {
        if (revokedIds.has(d.id)) continue;
        if (!devicesByUser.has(d.userId)) devicesByUser.set(d.userId, []);
        devicesByUser.get(d.userId).push(d);
    }

    for (const row of rows) {
        if (!DELIVERABLE_STATUSES.includes(statusByUser.get(row.userId))) continue;

        const prefs = { ...DEFAULT_PREFS, ...(prefByUser.get(row.userId) || {}) };
        if (!prefs.pushEnabled) continue;
        const col = TYPE_TO_PREF[row.type];
        if (col && !prefs[col]) continue;

        const userDevices = devicesByUser.get(row.userId);
        if (!userDevices?.length) continue;

        // Minimum payload: the click opens the details modal for this id; the
        // app then loads everything else from the authenticated API.
        const copy = _pushCopy(row, userById.get(row.userId));
        await push.sendToDevices(userDevices, { title: copy.title, body: copy.body, type: row.type, notificationId: row.id });
    }
}

/**
 * Text shown OUTSIDE the app (lock screen, shared devices). Generic by default. A new-media push may name
 * the title only for recipients who can see ALL content anyway (admin, or allowAdult) — mirrors the
 * app's own "canSeeRestricted" rule — so a restricted title can never leak to someone who couldn't browse it.
 */
function _pushCopy(row, user) {
    const out = { title: row.title, body: row.body };
    if (row.type !== TYPES.NEW_MEDIA || !user) return out;

    const meta = parseMeta(row);
    const titles = (Array.isArray(meta.labels) && meta.labels.length ? meta.labels : Array.isArray(meta.titles) ? meta.titles : []).filter(Boolean);
    const canSeeAll = user.role === "admin" || parsePermissions(user.permissionsJson)?.allowAdult === true;
    if (!canSeeAll || !titles.length) return out;

    const total = meta.count || titles.length;
    const where = meta.libraryLabel ? ` to ${meta.libraryLabel}` : "";
    out.body = total <= 1 ? `${titles[0]} was added${where}` : `${titles[0]} and ${total - 1} more were added${where}`;
    return out;
}

// ─── Reading: DTOs + detail context ───────────────────────────────────────────

/** Verifies the generated Prisma client really knows `metaJson` (a stale client silently drops every detail). */
async function verifyMetaColumn() {
    try {
        if (!schemaReady()) return;
        await prisma.notification.findFirst({ select: { id: true, metaJson: true } });
    } catch (err) {
        if (/metaJson/i.test(String(err.message))) {
            console.error("[Notify] ✖ The Prisma client/DB doesn't know Notification.metaJson — new notifications will be saved WITHOUT details. In server/ run: npx prisma db push  &&  npx prisma generate  (then restart).");
        }
    }
}

function parseMeta(row) {
    try {
        return row.metaJson ? JSON.parse(row.metaJson) || {} : {};
    } catch {
        return {};
    }
}

function toListDto(row) {
    const dto = {
        id: row.id,
        type: row.type,
        category: TYPE_LABELS[row.type] || "Notification",
        title: row.title,
        body: row.body,
        read: !!row.readAt,
        createdAt: row.createdAt,
    };

    if (row.type === TYPES.NEW_MEDIA) {
        // IDS + counts only. Titles/posters are resolved in the browser against the library list the
        // user is already allowed to see (the app's own permission-filtered /api/media data).
        const m = parseMeta(row);
        dto.media = { ids: Array.isArray(m.ids) ? m.ids.slice(0, 10) : [], count: m.count || null, library: m.libraryLabel || null, items: [] };
    }
    return dto;
}

/**
 * Media ids for a new-media notification. Rows created before ids were stored carry `mediaId` or only
 * (server-side) cleaned `titles` — recover the ids by matching those against the library's current files.
 * Only IDS are returned to the client; the stored titles never leave the server.
 */
async function _mediaIds(meta) {
    if (Array.isArray(meta.ids) && meta.ids.length) return meta.ids.slice(0, 10);
    if (meta.mediaId) return [meta.mediaId];
    const titles = Array.isArray(meta.titles) ? meta.titles.filter(Boolean) : [];
    if (!titles.length || !meta.libraryId) return [];
    try {
        const { readFolders } = require("../controllers/libraryController");
        const { getAllCached } = require("../utils/mediaCache");
        const { parseFilename } = require("../utils/nameParser");
        const folder = (await readFolders()).find((f) => f.id === meta.libraryId);
        if (!folder) return [];
        const { allMedia } = await getAllCached([folder]);
        const want = new Set(titles.map((t) => String(t).toLowerCase()));
        const clean = (f) => String((() => { try { return parseFilename(f.name)?.title; } catch { return null; } })() || f.name).toLowerCase();
        return allMedia.filter((f) => want.has(clean(f))).slice(0, 10).map((f) => f.id);
    } catch {
        return [];
    }
}

const _withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

/**
 * Display data for one library file, from the SAME sources the app uses: the filename parser and the cached
 * metadata store (metadata.json → title/year/type; a poster only if the store provides a URL). Never the raw
 * release name unless nothing better exists. Episode numbers come from the parser.
 */
async function _describeFile(file) {
    let parsed = {};
    try {
        parsed = require("../utils/nameParser").parseFilename(file.name) || {};
    } catch {
        /* keep {} */
    }
    let md = null;
    try {
        md = await _withTimeout(require("../utils/metadataStore").getMetadata(file), 1500); // cached after the library rescan; bounded so the modal never hangs
    } catch {
        /* no metadata yet */
    }

    const text = (s) => (typeof s === "string" && s.trim() ? s.trim() : null);
    const num = (n) => (Number.isFinite(Number(n)) && n !== null && n !== "" ? Number(n) : null);
    const season = num(parsed.season);
    const episode = num(parsed.episode);
    const kindRaw = text(md?.type) || text(parsed.type);
    const kind = ["movie", "series", "anime"].includes(kindRaw) ? kindRaw : season !== null || episode !== null ? "series" : "movie";

    return {
        id: file.id,
        title: text(md?.title) || text(parsed.title) || String(file.name).replace(/\.[^.]+$/, ""),
        year: num(md?.year) || num(parsed.year),
        kind,
        season,
        episode,
        poster: typeof md?.poster === "string" && /^(https?:\/\/|\/api\/)/.test(md.poster) ? md.poster : null,
    };
}

/** Which notified files still exist (+ their display data). available:null = couldn't check (UI won't claim removal). */
async function _mediaInfo(libraryId, ids) {
    try {
        if (!libraryId || !ids.length) return { available: [], items: [], libraryMissing: false };
        // lazy requires: libraryController requires this module, so a top-level require would be circular
        const { readFolders } = require("../controllers/libraryController");
        const { getAllCached } = require("../utils/mediaCache");
        const folder = (await readFolders()).find((f) => f.id === libraryId);
        if (!folder) return { available: [], items: [], libraryMissing: true };
        const { allMedia } = await getAllCached([folder]);
        const byId = new Map(allMedia.map((f) => [f.id, f]));
        const files = ids.map((id) => byId.get(id)).filter(Boolean);
        return { available: files.map((f) => f.id), items: await Promise.all(files.map(_describeFile)), libraryMissing: false };
    } catch {
        return { available: null, items: [], libraryMissing: false };
    }
}

/**
 * List DTOs. Old new-media rows get their ids recovered (see _mediaIds); for viewers who may access the library
 * each new-media row also carries display data (parsed title, year, S/E…) so rows can name the content.
 */
async function toListDtos(rows, user = null) {
    const memo = new Map();
    return Promise.all(
        rows.map(async (row) => {
            const dto = toListDto(row);
            if (row.type !== TYPES.NEW_MEDIA || !dto.media) return dto;

            const meta = parseMeta(row);
            if (!dto.media.ids.length) dto.media.ids = await _mediaIds(meta);
            if (user && dto.media.ids.length && userCanAccessLibrary(user, meta.libraryId)) {
                const key = `${meta.libraryId}|${dto.media.ids.join(",")}`;
                if (!memo.has(key)) memo.set(key, _mediaInfo(meta.libraryId, dto.media.ids));
                dto.media.items = (await memo.get(key)).items;
            }
            return dto;
        }),
    );
}

/** Type-specific details, always fetched/authorised server-side at open time. */
async function _buildContext(row, meta, user, { sessionId } = {}) {
    switch (row.type) {
        case TYPES.SIGNUP_PENDING: {
            if (user.role !== "admin") return null;
            const target = meta.userId
                ? await prisma.user.findUnique({
                      where: { id: meta.userId },
                      select: { name: true, username: true, email: true, avarter: true, status: true, emailVerified: true, createdAt: true },
                  })
                : null;
            if (!target) return { kind: "signup", userDeleted: true };
            return {
                kind: "signup",
                user: {
                    name: target.name,
                    username: target.username || null,
                    email: target.email,
                    avatar: safeAvatarUrl(target.avarter),
                    registeredAt: target.createdAt,
                    status: target.status,
                    emailVerified: !!target.emailVerified,
                },
            };
        }

        case TYPES.SECURITY: {
            // Other security events (password changed, recovery, device logged out) carry no device details.
            if (meta.event !== "new_device") return { kind: "security", event: meta.event || null };
            const session = meta.sessionId ? await prisma.session.findFirst({ where: { id: meta.sessionId, userId: user.id }, select: { isActive: true, lastSeenAt: true } }) : null;
            return {
                kind: "signin",
                deviceName: meta.deviceName || null,
                browser: meta.browser || null,
                os: meta.os || null,
                deviceType: meta.deviceType || null,
                sessionActive: session ? !!session.isActive : null,
                lastSeenAt: session?.lastSeenAt || null,
                isThisDevice: !!sessionId && meta.sessionId === sessionId,
            };
        }

        case TYPES.NEW_MEDIA: {
            // Old rows saved without any details: nothing to authorise or show (and nothing to leak).
            if (!meta.libraryId) return { kind: "media", library: null, count: null, ids: [], available: [], libraryMissing: false };
            // Re-check access NOW: permissions may have changed since delivery.
            if (!userCanAccessLibrary(user, meta.libraryId)) return { kind: "media", restricted: true };
            const ids = await _mediaIds(meta);
            const { available, libraryMissing, items } = await _mediaInfo(meta.libraryId, ids);
            return { kind: "media", library: meta.libraryLabel || null, count: meta.count || ids.length || null, ids, available, items, libraryMissing };
        }

        case TYPES.UPLOAD:
            return { kind: "upload", fileName: meta.fileName || null, library: meta.libraryLabel || null };

        case TYPES.STORAGE: {
            if (user.role !== "admin") return null;
            return {
                kind: "storage",
                disk: meta.mount || null,
                usedPercent: meta.usedPercent ?? null,
                freeBytes: meta.freeBytes ?? null,
                libraries: Array.isArray(meta.libraries) ? meta.libraries.slice(0, 10) : [],
            };
        }

        case TYPES.ADMIN_SIGNIN: {
            if (user.role !== "admin") return null;
            const target = meta.userId ? await prisma.user.findUnique({ where: { id: meta.userId }, select: { name: true, username: true, email: true, avarter: true } }) : null;
            if (!target) return { kind: "adminsignin", userDeleted: true };
            const deviceCount = prisma.device ? await prisma.device.count({ where: { userId: meta.userId } }) : (meta.deviceCount ?? null);
            return {
                kind: "adminsignin",
                multi: meta.event === "multi_device",
                user: { name: target.name, username: target.username || null, email: target.email, avatar: safeAvatarUrl(target.avarter) },
                deviceCount,
                deviceName: meta.deviceName || null,
                browser: meta.browser || null,
                os: meta.os || null,
                deviceType: meta.deviceType || null,
            };
        }

        case TYPES.ACCOUNT:
            return { kind: "account", event: meta.event || null, status: meta.status || null, accessType: meta.accessType || null, accessExpiresAt: meta.accessExpiresAt || null, statusChanged: !!meta.statusChanged, accessChanged: !!meta.accessChanged };

        case TYPES.RELEASE_REMINDER:
            return {
                kind: "reminder",
                mediaId: TMDB_MEDIA_ID.test(String(meta.mediaId || "")) ? meta.mediaId : null,
                mediaType: meta.mediaType === "series" ? "series" : "movie",
                title: meta.title || null,
                poster: typeof meta.poster === "string" && meta.poster.startsWith(TMDB_IMAGE_PREFIX) ? meta.poster : null,
                releaseDate: meta.releaseDate || null,
                remindedAt: meta.remindedAt || null,
            };

        case TYPES.ANNOUNCEMENT:
        case TYPES.ANNOUNCEMENT_ADMIN:
            return { kind: "announcement", adminOnly: row.type === TYPES.ANNOUNCEMENT_ADMIN };

        default:
            return { kind: row.type };
    }
}

/**
 * One notification the viewer is allowed to see, with context + destination.
 * Returns null when it doesn't exist OR isn't visible to this user (callers
 * answer 404 either way, so existence isn't leaked).
 */
async function getNotificationDetail(id, authUserId, { sessionId } = {}) {
    // Always re-read the viewer: role/status/permissions may have changed since login.
    const user = await prisma.user.findUnique({
        where: { id: authUserId },
        select: { id: true, role: true, status: true, accessType: true, accessExpiresAt: true, permissionsJson: true },
    });
    if (!user || !DELIVERABLE_STATUSES.includes(user.status)) return null;

    const row = await prisma.notification.findFirst({ where: { id, ...visibleWhere(user) } });
    if (!row) return null;

    const meta = parseMeta(row);
    const context = await _buildContext(row, meta, user, { sessionId });

    // A media notification the user can no longer access (or whose files are all gone) offers no destination.
    const mediaGone = context?.kind === "media" && (context.restricted || context.libraryMissing || (context.ids.length > 0 && Array.isArray(context.available) && context.available.length === 0));

    return { ...toListDto(row), readAt: row.readAt, context, destination: mediaGone ? null : resolveDestination(row, user) };
}

// ─── Preferences ──────────────────────────────────────────────────────────────

async function getPreferences(userId) {
    const row = await prisma.notificationPreference.findUnique({ where: { userId } });
    const out = { ...DEFAULT_PREFS };
    if (row) for (const f of PREF_FIELDS) out[f] = row[f];
    return out;
}

async function updatePreferences(userId, patch = {}) {
    const data = {};
    for (const f of PREF_FIELDS) {
        if (typeof patch[f] === "boolean") data[f] = patch[f];
    }
    await prisma.notificationPreference.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    return getPreferences(userId);
}

// ─── Release reminders ("Remind me" on upcoming titles) ───────────────────────

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Folder/JSON-first like the other stores: no Prisma migration. One file, atomic writes, cached in memory.
// item = { id, userId, mediaId: "tmdb-movie-123" | "tmdb-tv-456", mediaType: "movie" | "series",
//          title, poster, releaseDate: "YYYY-MM-DD", createdAt, sentAt }
const REMINDERS_FILE = process.env.REMINDERS_FILE || path.join(__dirname, "..", "data", "reminders.json");
const SENT_KEEP_DAYS = 30;

let reminderCache = null;

function loadReminders() {
    if (reminderCache) return reminderCache;
    try {
        const parsed = JSON.parse(fs.readFileSync(REMINDERS_FILE, "utf8"));
        reminderCache = { items: Array.isArray(parsed?.items) ? parsed.items : [] };
    } catch {
        reminderCache = { items: [] };
    }
    return reminderCache;
}

function saveReminders() {
    try {
        fs.mkdirSync(path.dirname(REMINDERS_FILE), { recursive: true });
        const tmp = `${REMINDERS_FILE}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(reminderCache));
        fs.renameSync(tmp, REMINDERS_FILE);
    } catch (err) {
        console.error("[Reminders] could not save:", err.message);
    }
}

const find = (userId, mediaId) => loadReminders().items.find((r) => r.userId === userId && r.mediaId === mediaId && !r.sentAt) || null;
const countForUser = (userId) => loadReminders().items.filter((r) => r.userId === userId && !r.sentAt).length;

/** Create, or refresh title/poster/date of an existing unsent reminder. Returns { item, created }. */
function upsert({ userId, mediaId, mediaType, title, poster, releaseDate }) {
    const db = loadReminders();
    const existing = find(userId, mediaId);
    if (existing) {
        Object.assign(existing, { title, poster, releaseDate, mediaType });
        saveReminders();
        return { item: existing, created: false };
    }
    const item = { id: crypto.randomUUID(), userId, mediaId, mediaType, title, poster, releaseDate, createdAt: new Date().toISOString(), sentAt: null };
    db.items.push(item);
    saveReminders();
    return { item, created: true };
}

function remove(userId, mediaId) {
    const db = loadReminders();
    const before = db.items.length;
    db.items = db.items.filter((r) => !(r.userId === userId && r.mediaId === mediaId && !r.sentAt));
    if (db.items.length !== before) saveReminders();
    return before - db.items.length;
}

/** Unsent reminders whose release date has arrived (date compared as YYYY-MM-DD, UTC). */
function due(todayUtc) {
    return loadReminders().items.filter((r) => !r.sentAt && r.releaseDate <= todayUtc);
}

function markSent(id) {
    const r = loadReminders().items.find((x) => x.id === id);
    if (!r) return;
    r.sentAt = new Date().toISOString();
    saveReminders();
}

function dropUser(userId) {
    const db = loadReminders();
    const before = db.items.length;
    db.items = db.items.filter((r) => r.userId !== userId);
    if (db.items.length !== before) saveReminders();
}

function pruneSent() {
    const db = loadReminders();
    const cutoff = Date.now() - SENT_KEEP_DAYS * 86_400_000;
    const before = db.items.length;
    db.items = db.items.filter((r) => !r.sentAt || new Date(r.sentAt).getTime() > cutoff);
    if (db.items.length !== before) saveReminders();
}


const reminderStore = { find, countForUser, upsert, remove, due, markSent, dropUser, pruneSent };

/** Notifies every user whose reminder has reached its release date, once. Safe to call repeatedly. */
async function checkReleaseReminders() {
    try {
        if (!schemaReady()) return 0;
        const todayUtc = new Date().toISOString().slice(0, 10);
        const due = reminderStore.due(todayUtc);
        if (!due.length) return 0;

        const users = await prisma.user.findMany({ where: { id: { in: [...new Set(due.map((r) => r.userId))] } }, select: { id: true, status: true } });
        const status = new Map(users.map((u) => [u.id, u.status]));

        let sent = 0;
        for (const r of due) {
            const st = status.get(r.userId);
            if (!st) {
                reminderStore.markSent(r.id); // user no longer exists
                continue;
            }
            if (st !== "approved") continue; // wait until the account is approved again
            const kind = r.mediaType === "series" ? "series" : "movie";
            const rows = await notify({
                userIds: [r.userId],
                type: TYPES.RELEASE_REMINDER,
                title: r.title,
                body: kind === "series" ? "The series you asked to be reminded about has premiered." : "The movie you asked to be reminded about is out now.",
                meta: { mediaId: r.mediaId, mediaType: kind, title: r.title, poster: r.poster, releaseDate: r.releaseDate, remindedAt: r.createdAt },
            });
            if (rows.length) {
                reminderStore.markSent(r.id);
                sent++;
            }
        }
        if (sent) console.log(`[Reminders] sent ${sent} release reminder(s)`);
        return sent;
    } catch (err) {
        console.error("[Reminders] check failed:", err.message);
        return 0;
    }
}

// ─── Maintenance ──────────────────────────────────────────────────────────────

async function pruneOldData() {
    try {
        const notifCutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000);
        const deviceCutoff = new Date(Date.now() - STALE_DEVICE_DAYS * 86_400_000);

        // Only READ notifications age out; unread ones are kept.
        const n = await prisma.notification.deleteMany({ where: { createdAt: { lt: notifCutoff }, readAt: { not: null } } });
        const d = await prisma.pushDevice.deleteMany({ where: { OR: [{ isActive: false, updatedAt: { lt: deviceCutoff } }, { lastSeenAt: { lt: new Date(Date.now() - 270 * 86_400_000) } }] } });
        if (n.count || d.count) console.log(`[Notify] pruned ${n.count} old notification(s), ${d.count} stale device(s)`);
    } catch (err) {
        console.error("[Notify] prune failed:", err.message);
    }
}

/** True when the notification tables/models exist in the generated Prisma client. */
function schemaReady() {
    return !!(prisma.notification && prisma.pushDevice && prisma.notificationPreference);
}

const SCHEMA_HELP = "Notification tables are missing. In server/ run: npx prisma db push  (then npx prisma generate and restart the server).";

function checkSchema() {
    if (!schemaReady()) {
        console.error(`[Notify] ✖ ${SCHEMA_HELP}`);
        return false;
    }
    return true;
}

let _maintTimer = null;
let _maintBoot = null;
let _remTimer = null;
let _remBoot = null;
function startMaintenance() {
    if (!checkSchema()) return;
    verifyMetaColumn();
    _maintBoot = setTimeout(pruneOldData, 2 * 60 * 1000);
    _maintBoot.unref();
    _maintTimer = setInterval(() => {
        pruneOldData();
        reminderStore.pruneSent();
    }, 24 * 60 * 60 * 1000);
    _maintTimer.unref();
    // Release reminders: shortly after boot, then every hour.
    _remBoot = setTimeout(checkReleaseReminders, 30 * 1000);
    _remBoot.unref();
    _remTimer = setInterval(checkReleaseReminders, 60 * 60 * 1000);
    _remTimer.unref();
}
function stopMaintenance() {
    if (_maintBoot) clearTimeout(_maintBoot);
    if (_maintTimer) clearInterval(_maintTimer);
    if (_remBoot) clearTimeout(_remBoot);
    if (_remTimer) clearInterval(_remTimer);
    _maintBoot = _maintTimer = _remBoot = _remTimer = null;
}

// DEPRECATED compatibility shim — older call sites referenced notificationService.URLS.*.
// Destinations are now computed server-side (resolveDestination); `url` is only honoured for announcements.
const URLS = Object.freeze({ home: "/", settings: "/settings", dashUsers: "/dashboard/users", dashUploads: "/dashboard/uploads", dashStorage: "/dashboard/storage" });

module.exports = {
    URLS,
    TYPES,
    TYPE_LABELS,
    ADMIN_ONLY_TYPES,
    ANNOUNCE_ROUTES,
    PREF_FIELDS,
    DEFAULT_PREFS,
    SCHEMA_HELP,
    schemaReady,
    checkSchema,
    userCanAccessLibrary,
    visibleWhere,
    resolveDestination,
    toListDto,
    toListDtos,
    verifyMetaColumn,
    getNotificationDetail,
    notify,
    notifyAdmins,
    notifyAllApproved,
    notifyLibraryUsers,
    notifyNewSignIn,
    notifyAccountChange,
    adminIds,
    getPreferences,
    updatePreferences,
    pruneOldData,
    checkReleaseReminders,
    reminders: reminderStore,
    TMDB_MEDIA_ID,
    TMDB_IMAGE_PREFIX,
    startMaintenance,
    stopMaintenance,
};
