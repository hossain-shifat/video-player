"use strict";

/**
 * auth/services/tokenService.js
 *
 * JWT access tokens + refresh tokens, AND the single home for device/session lifecycle
 * (kept in this existing file on purpose — no parallel session system):
 *
 *   Account  ─┬─ Device  (recognized browser/client; random secret in cookie/header, hashed)
 *             └─ Session (one authenticated login; independently revocable)
 *
 *   - resolveDevice / createSession   : used by every successful login path
 *   - verifyRefreshToken              : sha256 fast path + legacy argon2 upgrade
 *   - revokeSessions                  : the ONLY function that revokes (kills stream tokens,
 *                                       push registrations, and the in-process validity cache)
 *   - isSessionValid                  : cached check for routes that don't hit the DB per request
 *   - listDevices / renameDevice      : owner-facing views (always scoped by userId)
 */

const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const argon2 = require("argon2");
const UAParser = require("ua-parser-js");

const prisma = require("../prismaClient");

const DEV_FALLBACK_SECRET = "flux-dev-secret-CHANGE-IN-PRODUCTION";
const JWT_SECRET = process.env.JWT_SECRET || DEV_FALLBACK_SECRET;
// A guessable signing secret lets anyone forge admin tokens. Refuse to boot with it in production.
if (process.env.NODE_ENV === "production" && (JWT_SECRET === DEV_FALLBACK_SECRET || JWT_SECRET.length < 32)) {
    throw new Error("JWT_SECRET must be set to a random string of at least 32 characters when NODE_ENV=production");
}
if (JWT_SECRET === DEV_FALLBACK_SECRET) {
    console.warn("[Auth] ⚠ JWT_SECRET is not set — using the insecure development secret. Set JWT_SECRET in server/.env (e.g. `node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"`).");
}
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "15m";
const REFRESH_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || "30d";

// ─── Access / refresh tokens ──────────────────────────────────────────────────

/**
 * Sign an access JWT.
 * Payload: { sub: userId, email, role, status, sid }
 */
function signAccessToken(user, sessionId = null) {
    return jwt.sign(
        {
            sub: user.id,
            email: user.email,
            role: user.role,
            status: user.status,
            sid: sessionId,
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN, algorithm: "HS256" },
    );
}

function verifyAccessToken(token) {
    return jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
}

/** Cryptographically secure refresh token. Caller stores ONLY hashRefreshToken(token). */
function generateRefreshToken() {
    return crypto.randomBytes(48).toString("base64url");
}

function parseExpiry(str) {
    const units = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    const match = /^(\d+)([smhd])$/.exec(str);
    if (!match) return 86400000 * 30;
    return parseInt(match[1], 10) * (units[match[2]] || 86400000);
}

function refreshTokenExpiresAt() {
    return new Date(Date.now() + parseExpiry(REFRESH_EXPIRES_IN));
}

const sha256Hex = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");

/** 48 random bytes = 384 bits of entropy, so a fast hash is appropriate (and cheap per refresh). */
function hashRefreshToken(token) {
    return `sha256:${sha256Hex(token)}`;
}

/**
 * Verify a presented refresh token against a stored hash.
 * Returns { ok, upgradedHash } — upgradedHash is set when a legacy argon2 hash matched,
 * so the caller can persist the cheap sha256 form (existing sessions keep working).
 */
async function verifyRefreshToken(stored, presented) {
    if (!stored || !presented || typeof presented !== "string") return { ok: false };
    if (stored.startsWith("sha256:")) {
        const a = Buffer.from(stored);
        const b = Buffer.from(hashRefreshToken(presented));
        return { ok: a.length === b.length && crypto.timingSafeEqual(a, b) };
    }
    try {
        const ok = await argon2.verify(stored, presented);
        return ok ? { ok: true, upgradedHash: hashRefreshToken(presented) } : { ok: false };
    } catch {
        return { ok: false };
    }
}

// ─── Device identity ──────────────────────────────────────────────────────────

const DEVICE_COOKIE = "flux_did";
const DEVICE_HEADER = "x-flux-device";
const DEVICE_COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000; // browsers cap cookies at ~400 days
const SECRET_RE = /^[A-Za-z0-9_-]{32,64}$/;

function readCookie(req, name) {
    const raw = req.headers?.cookie;
    if (!raw) return null;
    for (const part of raw.split(";")) {
        const i = part.indexOf("=");
        if (i === -1) continue;
        if (part.slice(0, i).trim() === name) {
            try {
                return decodeURIComponent(part.slice(i + 1).trim());
            } catch {
                return null;
            }
        }
    }
    return null;
}

/** Cookie first (works for the Google OAuth redirect), then header (clients without cookies). */
function readDeviceSecret(req) {
    const fromCookie = readCookie(req, DEVICE_COOKIE);
    if (fromCookie && SECRET_RE.test(fromCookie)) return fromCookie;
    const fromHeader = req.headers?.[DEVICE_HEADER];
    const h = Array.isArray(fromHeader) ? fromHeader[0] : fromHeader;
    if (h && SECRET_RE.test(h)) return h;
    return null;
}

function setDeviceCookie(res, secret, req) {
    if (!res || typeof res.cookie !== "function") return;
    const secure = !!(
        req.secure ||
        String(req.headers?.["x-forwarded-proto"] || "")
            .split(",")[0]
            .trim() === "https"
    );
    res.cookie(DEVICE_COOKIE, secret, {
        httpOnly: true,
        sameSite: "lax",
        secure,
        path: "/",
        maxAge: DEVICE_COOKIE_MAX_AGE_MS,
    });
}

/** Browser / OS / category from the User-Agent + Client Hints. Descriptive only — never identity. */
function describeClient(req) {
    const ua = req.headers?.["user-agent"] || "";
    const chUa = req.headers?.["sec-ch-ua"] || "";
    const chPlatform = req.headers?.["sec-ch-ua-platform"] || "";
    const chMobile = req.headers?.["sec-ch-ua-mobile"] || "";

    const r = new UAParser(ua).getResult();

    let browser = r.browser.name || "";
    let browserVersion = r.browser.version || "";
    if (chUa) {
        const m = chUa.match(/"([^"]+)";v="([^"]+)"/);
        // Only trust Client Hints when they name a real brand (skip the GREASE entry)
        if (m && !/not.?a.?brand/i.test(m[1]) && !/chromium/i.test(m[1])) {
            browser = m[1];
            browserVersion = m[2];
        }
    }

    let os = r.os.name || "";
    const osVersion = r.os.version || "";
    if (chPlatform) os = chPlatform.replace(/"/g, "");
    if (/Android/i.test(ua) && os === "Linux") os = "Android";

    let deviceType = r.device.type || (chMobile === "?1" ? "mobile" : "desktop");
    if (!["desktop", "mobile", "tablet"].includes(deviceType)) deviceType = "desktop";

    return {
        browser: browser.slice(0, 60),
        browserVersion: String(browserVersion).slice(0, 30),
        os: os.slice(0, 60),
        osVersion: String(osVersion).slice(0, 30),
        deviceType,
    };
}

/** Client IP for admin support view only. Never identity, never shown to other users. */
function clientIp(req) {
    const raw = String(req.ip || req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
    return raw.slice(0, 64);
}

/**
 * Admin-facing "actual device" grouping. A browser that lost its device secret (cleared storage, earlier
 * builds that did not send one) re-registers on every login, which inflates raw counts. Sessions from the
 * same OS + device type + IP are one physical client; several browsers on it are listed under it.
 * Sessions with no recorded IP fold into a group with the same OS/type, else stand alone.
 * Approximate on purpose and used ONLY for admin counts — the owner's own list shows every real device.
 */
function groupClients(rows, { byBrowser = false } = {}) {
    const key = (r) => `${String(r.os || "").toLowerCase()}|${r.deviceType || "desktop"}${byBrowser ? `|${String(r.browser || "").toLowerCase()}` : ""}`;
    const groups = new Map();
    const noIp = [];
    for (const r of rows) {
        if (!r.ip) {
            noIp.push(r);
            continue;
        }
        const k = `${key(r)}|${r.ip}`;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(r);
    }
    for (const r of noIp) {
        const match = [...groups.keys()].find((k) => k.startsWith(`${key(r)}|`));
        const k = match || `${key(r)}|`;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(r);
    }
    return [...groups.values()];
}

const derivedDeviceName = (d) => {
    const b = d.browser || "Browser";
    return d.os ? `${b} on ${d.os}` : b;
};
const displayDeviceName = (d) => d.customName || derivedDeviceName(d);

/**
 * Find-or-create the Device for (userId, deviceSecret). Reuses the record on repeat logins.
 * Mints a secret + sets the cookie when the client doesn't have one yet.
 * Returns { device, isNew }.
 */
async function resolveDevice(userId, req, res) {
    let secret = readDeviceSecret(req);
    if (!secret) secret = crypto.randomBytes(32).toString("base64url");
    // (re)assert the cookie so header-only clients also get one where cookies work
    setDeviceCookie(res, secret, req);

    const secretHash = sha256Hex(secret);
    const info = describeClient(req);
    const now = new Date();

    const existing = await prisma.device.findUnique({ where: { userId_secretHash: { userId, secretHash } } });
    if (existing) {
        const device = await prisma.device.update({ where: { id: existing.id }, data: { ...info, lastSeenAt: now } });
        return { device, isNew: false };
    }

    try {
        const device = await prisma.device.create({ data: { userId, secretHash, ...info, firstSeenAt: now, lastSeenAt: now } });
        return { device, isNew: true };
    } catch (err) {
        if (err.code === "P2002") {
            // concurrent request created it first (OAuth redirect + XHR, double submit) — reuse
            const device = await prisma.device.findUnique({ where: { userId_secretHash: { userId, secretHash } } });
            if (device) return { device, isNew: false };
        }
        throw err;
    }
}

// ─── Session lifecycle ────────────────────────────────────────────────────────

// A session that has not been used for this long is signed out (the ACCOUNT is untouched).
const SESSION_INACTIVITY_DAYS = parseInt(process.env.SESSION_INACTIVITY_DAYS || "30", 10);
const SESSION_INACTIVITY_MS = SESSION_INACTIVITY_DAYS * 86_400_000;
const sessionCutoff = (now = Date.now()) => new Date(now - SESSION_INACTIVITY_MS);

// sid → { valid, userId, at }  (single-process server, so in-process invalidation is exact)
const SESSION_CACHE_TTL_MS = 10_000;
const sessionCache = new Map();

function clearSessionCache(ids) {
    for (const id of ids) sessionCache.delete(id);
}

/**
 * Create a session for an already-authenticated user.
 * Reuses the device record; supersedes older ACTIVE sessions of the same device
 * (a browser holds exactly one stored login, so the older refresh token is unreachable).
 * Returns { session, refreshToken, device, isNewDevice }.
 */
async function createSession(userId, req, res, { authMethod = "password" } = {}) {
    const { device, isNew } = await resolveDevice(userId, req, res);
    const hadOtherDevices = isNew ? (await prisma.device.count({ where: { userId, id: { not: device.id } } })) > 0 : false;

    const refreshToken = generateRefreshToken();
    const now = new Date();

    const session = await prisma.session.create({
        data: {
            userId,
            deviceId: device.id,
            refreshTokenHash: hashRefreshToken(refreshToken),
            authMethod,
            expiresAt: refreshTokenExpiresAt(),
            isActive: true,
            lastSeenAt: now,
            ip: clientIp(req), // last-login IP, visible to the account owner's admins only (support/security)
            deviceName: derivedDeviceName(device),
            deviceType: device.deviceType,
            browser: device.browser,
            browserVersion: device.browserVersion,
            os: device.os,
            osVersion: device.osVersion,
        },
    });

    await revokeSessions({ userId, deviceId: device.id, id: { not: session.id } }, "superseded");
    await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: now } }).catch(() => {});

    if (isNew) {
        // New device. The service decides who hears about it: the account owner (only if they already had another
        // device) and every other approved admin ("new sign-in" / "multiple devices"). It reads the device details
        // itself, and the text it sends out stays generic.
        require("../../services/notificationService")
            .notifyNewSignIn({ userId, sessionId: session.id, deviceId: device.id, hadOtherDevices })
            .catch(() => {});
    }

    return { session, refreshToken, device, isNewDevice: isNew };
}

/**
 * THE revocation path. `where` is a Prisma Session filter (callers always include userId or id).
 * Marks sessions inactive + records reason, deletes their stream tokens, deactivates their push
 * registrations, and drops them from the validity cache. Returns the revoked session ids.
 */
async function revokeSessions(where, reason = "revoked_by_owner") {
    const rows = await prisma.session.findMany({ where: { ...where, isActive: true }, select: { id: true } });
    const ids = rows.map((r) => r.id);
    if (!ids.length) return [];

    await prisma.session.updateMany({
        where: { id: { in: ids }, isActive: true },
        data: { isActive: false, revokedAt: new Date(), revokedReason: reason },
    });
    await prisma.streamToken.deleteMany({ where: { sessionId: { in: ids } } }).catch(() => {});
    await prisma.pushDevice.updateMany({ where: { sessionId: { in: ids } }, data: { isActive: false } }).catch(() => {});
    clearSessionCache(ids);
    return ids;
}

/**
 * Cheap session validity check for routes that must not hit the DB on every call
 * (history / watch-time progress pings). Result cached ≤10s; revokeSessions() clears it
 * immediately, so revocation is effectively instant.
 */
async function isSessionValid(sid, userId) {
    if (!sid) return false;
    const hit = sessionCache.get(sid);
    if (hit && Date.now() - hit.at < SESSION_CACHE_TTL_MS) return hit.valid && hit.userId === userId;

    const s = await prisma.session.findUnique({
        where: { id: sid },
        select: { isActive: true, expiresAt: true, lastSeenAt: true, userId: true, user: { select: { status: true } } },
    });
    const valid = !!s && isSessionLive(s) && s.user?.status !== "deleted";
    sessionCache.set(sid, { valid, userId: s?.userId ?? null, at: Date.now() });
    return valid && s.userId === userId;
}

/**
 * Live = active, not past expiresAt, and used within the inactivity window (30 days).
 * Legacy rows (expiresAt null) are covered by the inactivity rule, so they cannot linger forever.
 */
const isSessionLive = (s, now = new Date()) => !!s && s.isActive && (!s.expiresAt || s.expiresAt > now) && (!s.lastSeenAt || new Date(s.lastSeenAt).getTime() > now.getTime() - SESSION_INACTIVITY_MS);

/**
 * Housekeeping: sign out sessions that expired or went unused for 30 days. Only SESSIONS are revoked.
 * Idempotent; called from the hourly scheduler. Returns how many were signed out.
 */
async function expireInactiveSessions() {
    const now = new Date();
    const stale = await prisma.session.findMany({
        where: { isActive: true, OR: [{ lastSeenAt: { lt: sessionCutoff() } }, { expiresAt: { lt: now } }] },
        select: { id: true, lastSeenAt: true, expiresAt: true },
    });
    if (!stale.length) return 0;
    const expired = stale.filter((x) => x.expiresAt && x.expiresAt < now).map((x) => x.id);
    const idle = stale.filter((x) => !(x.expiresAt && x.expiresAt < now)).map((x) => x.id);
    const a = expired.length ? await revokeSessions({ id: { in: expired } }, "expired") : [];
    const b = idle.length ? await revokeSessions({ id: { in: idle } }, "inactive") : [];
    const n = a.length + b.length;
    if (n) console.log(`[Sessions] signed out ${n} inactive/expired session(s)`);
    return n;
}

// ─── Owner-facing device views ────────────────────────────────────────────────

const RENAME_MAX = 60;
/** Trim, drop control chars / angle brackets, collapse whitespace. Empty → null (reset to derived name). */
function cleanDeviceName(raw) {
    if (raw === null || raw === undefined) return null;
    const s = String(raw)
        .replace(/[\u0000-\u001f\u007f<>]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    if (!s) return null;
    return s.slice(0, RENAME_MAX);
}

/**
 * Devices (with ≥1 live session unless includeInactive) + legacy sessions that predate
 * device tracking. Everything is scoped by userId — callers pass req.user.id, never client input.
 */
async function listDevices(userId, currentSessionId, { includeInactive = false } = {}) {
    const now = new Date();
    const devices = await prisma.device.findMany({
        where: { userId },
        orderBy: { lastSeenAt: "desc" },
        include: { sessions: { where: { isActive: true }, orderBy: { lastSeenAt: "desc" } } },
    });
    const legacy = await prisma.session.findMany({
        where: { userId, deviceId: null, isActive: true },
        orderBy: { lastSeenAt: "desc" },
        select: { id: true, deviceName: true, deviceType: true, browser: true, os: true, ip: true, createdAt: true, lastSeenAt: true, expiresAt: true, isActive: true },
    });

    // One item per recognised device / pre-tracking session
    const items = [];
    for (const d of devices) {
        const live = d.sessions.filter((x) => isSessionLive(x, now));
        if (!live.length && !includeInactive) continue;
        items.push({
            deviceId: d.id,
            d,
            live,
            browser: d.browser,
            os: d.os,
            deviceType: d.deviceType,
            ip: live.find((x) => x.ip)?.ip || "",
            lastActiveAt: live[0]?.lastSeenAt || d.lastSeenAt,
            firstSeenAt: d.firstSeenAt,
            isCurrent: live.some((x) => x.id === currentSessionId),
            sessions: live.length,
        });
    }
    for (const x of legacy.filter((y) => isSessionLive(y, now))) {
        items.push({
            sessionId: x.id,
            browser: x.browser,
            os: x.os,
            deviceType: x.deviceType || "desktop",
            ip: x.ip || "",
            lastActiveAt: x.lastSeenAt,
            firstSeenAt: x.createdAt,
            isCurrent: x.id === currentSessionId,
            sessions: 1,
        });
    }

    // The same browser + OS + type + IP is ONE client however many times it signed in.
    const entries = groupClients(items, { byBrowser: true }).map((group) => {
        group.sort((a, b) => new Date(b.lastActiveAt) - new Date(a.lastActiveAt));
        const head = group.find((g) => g.d) || group[0];
        const deviceIds = group.filter((g) => g.deviceId).map((g) => g.deviceId);
        const sessionIds = group.filter((g) => g.sessionId).map((g) => g.sessionId);
        return {
            id: deviceIds[0] || sessionIds[0],
            deviceIds,
            sessionIds,
            renamable: !!head.d,
            name: head.d ? displayDeviceName(head.d) : [head.browser, head.os].filter(Boolean).join(" on ") || "Earlier sign-in",
            customName: head.d?.customName || null,
            browser: head.browser,
            os: head.os,
            deviceType: head.deviceType,
            ip: group.find((g) => g.ip)?.ip || "",
            firstSeenAt: group.reduce((m, g) => (g.firstSeenAt < m ? g.firstSeenAt : m), group[0].firstSeenAt),
            lastActiveAt: group[0].lastActiveAt,
            isCurrent: group.some((g) => g.isCurrent),
            legacy: !head.d,
            status: group.some((g) => g.sessions > 0) ? "active" : "signed_out",
        };
    });
    entries.sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || new Date(b.lastActiveAt) - new Date(a.lastActiveAt));

    return {
        devices: entries,
        legacySessions: [], // merged into `devices` (flagged legacy) — kept for older clients
        counts: { registeredDevices: entries.length, activeSessions: items.reduce((n, i) => n + i.sessions, 0) },
    };
}

async function renameDevice(userId, deviceId, rawName) {
    const name = cleanDeviceName(rawName);
    const res = await prisma.device.updateMany({ where: { id: deviceId, userId }, data: { customName: name } });
    if (!res.count) return null;
    const d = await prisma.device.findUnique({ where: { id: deviceId } });
    return { id: d.id, name: displayDeviceName(d), customName: d.customName };
}

/**
 * Admin-safe summary: no ids, no user agents, never the owner's custom device names. Includes the last-login IP
 * (support/security). Devices are grouped by client (see groupClients) so the count is the actual number of
 * machines signed in, not the number of logins.
 */
async function summarizeDevicesForAdmin(userId) {
    const now = new Date();
    const sessions = (
        await prisma.session.findMany({
            where: { userId, isActive: true },
            orderBy: { lastSeenAt: "desc" },
            select: { id: true, browser: true, os: true, deviceType: true, ip: true, createdAt: true, lastSeenAt: true, expiresAt: true, isActive: true },
        })
    ).filter((x) => isSessionLive(x, now));

    const rows = groupClients(sessions).map((items) => {
        const newest = items[0]; // already newest-first
        const browsers = [...new Set(items.map((i) => i.browser).filter(Boolean))];
        const os = items.find((i) => i.os)?.os || "";
        return {
            label: (browsers.join(" · ") || "Browser") + (os ? ` on ${os}` : ""),
            deviceType: newest.deviceType || "desktop",
            browser: browsers.join(", "),
            browsers,
            os,
            ip: items.find((i) => i.ip)?.ip || "",
            firstSeenAt: items.reduce((m, i) => (i.createdAt < m ? i.createdAt : m), items[0].createdAt),
            lastActiveAt: newest.lastSeenAt,
            activeSessionCount: items.length,
            status: "active",
        };
    });
    rows.sort((x, y) => new Date(y.lastActiveAt) - new Date(x.lastActiveAt));

    return {
        devices: rows,
        registeredDevices: rows.length,
        // a "session" for reporting = a distinct browser client; repeat logins of the same browser + IP are not counted
        activeSessions: groupClients(sessions, { byBrowser: true }).length,
        lastIp: rows.find((r) => r.ip)?.ip || "",
    };
}

module.exports = {
    // tokens
    signAccessToken,
    verifyAccessToken,
    generateRefreshToken,
    hashRefreshToken,
    verifyRefreshToken,
    refreshTokenExpiresAt,
    // device + session
    resolveDevice,
    createSession,
    revokeSessions,
    isSessionValid,
    isSessionLive,
    expireInactiveSessions,
    sessionCutoff,
    SESSION_INACTIVITY_DAYS,
    listDevices,
    renameDevice,
    summarizeDevicesForAdmin,
    groupClients,
    cleanDeviceName,
    displayDeviceName,
    describeClient,
    readDeviceSecret,
    setDeviceCookie,
    DEVICE_COOKIE,
    DEVICE_HEADER,
};
