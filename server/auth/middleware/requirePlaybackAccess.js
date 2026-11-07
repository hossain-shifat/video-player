"use strict";

/**
 * auth/middleware/requirePlaybackAccess.js
 *
 * THE playback gate. Applied to every /stream/* route (video, HLS manifest + segments, transcode,
 * sessions, subtitles, media info). Browsing never goes through this — approval is required to
 * WATCH, not to look around.
 *
 * Accepted credentials (first match wins):
 *   1. stream token  — ?st=<token>  |  X-Flux-Stream-Token header  |  flux_st cookie
 *                      (issued by POST /stream/start/:id; needed because <video>, <track> and
 *                      native-HLS segment requests cannot send an Authorization header)
 *   2. access JWT    — Authorization: Bearer <jwt>   (fetch/XHR callers)
 *
 * Eligibility is re-read from the database (≤5 s cache) on every request, so approval revoked,
 * account blocked/deleted, access expired or session revoked stop playback within seconds,
 * regardless of what an old JWT / stream token says.
 */

const prisma = require("../prismaClient");
const { verifyAccessToken, isSessionLive } = require("../services/tokenService");
const { parsePermissions, filterMedia } = require("../services/permissionService");

const TTL_MS = 5_000;
const cache = new Map(); // credentialKey → { user, tokenMediaId, at }

const STREAM_COOKIE = "flux_st";

function invalidatePlaybackCache() {
    cache.clear();
    userCache.clear();
}

function readCookie(req, name) {
    const raw = req.headers?.cookie;
    if (!raw) return null;
    for (const part of raw.split(";")) {
        const i = part.indexOf("=");
        if (i !== -1 && part.slice(0, i).trim() === name) {
            try {
                return decodeURIComponent(part.slice(i + 1).trim());
            } catch {
                return null;
            }
        }
    }
    return null;
}

/** Returns null when playback is allowed, otherwise { status, body } describing why not. */
function playbackDenial(user) {
    if (!user) return { status: 401, body: { error: "Authentication required" } };
    if (user.status === "deleted" || user.deletedAt) return { status: 401, body: { error: "Account deleted", code: "ACCOUNT_DELETED" } };
    if (!user.emailVerified) return { status: 403, body: { error: "Email not verified", code: "EMAIL_NOT_VERIFIED" } };
    if (user.status === "pending") return { status: 403, body: { error: "Your account is waiting for administrator approval.", code: "PENDING_APPROVAL" } };
    // blocked is deliberately indistinguishable from pending (the owner is never told)
    if (user.status === "blocked") return { status: 403, body: { error: "Your account is waiting for administrator approval.", code: "PENDING_APPROVAL" } };
    if (user.status === "rejected") return { status: 403, body: { error: "Account rejected", code: "ACCOUNT_REJECTED" } };
    if (user.status !== "approved") return { status: 403, body: { error: "Account not approved", code: "NOT_APPROVED" } };
    if (user.accessType === "temporary" && user.accessExpiresAt && Date.now() > new Date(user.accessExpiresAt).getTime()) {
        return { status: 403, body: { error: "Access expired", code: "ACCESS_EXPIRED" } };
    }
    return null;
}

async function resolveStreamToken(token) {
    const row = await prisma.streamToken.findUnique({ where: { token }, include: { user: true } });
    if (!row) return { fail: { status: 401, body: { error: "Invalid stream token", code: "INVALID_STREAM_TOKEN" } } };
    if (new Date() > row.expiresAt) {
        await prisma.streamToken.delete({ where: { id: row.id } }).catch(() => {});
        return { fail: { status: 401, body: { error: "Stream token expired", code: "STREAM_TOKEN_EXPIRED" } } };
    }
    if (row.sessionId) {
        const s = await prisma.session.findUnique({ where: { id: row.sessionId }, select: { isActive: true, expiresAt: true, lastSeenAt: true } });
        if (!s || !isSessionLive(s)) {
            await prisma.streamToken.delete({ where: { id: row.id } }).catch(() => {});
            return { fail: { status: 401, body: { error: "Session revoked", code: "SESSION_REVOKED" } } };
        }
    }
    return { user: row.user, tokenMediaId: row.mediaId, sessionId: row.sessionId || null };
}

async function resolveJwt(bearer) {
    let payload;
    try {
        payload = verifyAccessToken(bearer);
    } catch (err) {
        if (err.name === "TokenExpiredError") return { fail: { status: 401, body: { error: "Token expired", code: "TOKEN_EXPIRED" } } };
        return { fail: { status: 401, body: { error: "Invalid token" } } };
    }
    if (!payload.sid) return { fail: { status: 401, body: { error: "Session revoked", code: "SESSION_REVOKED" } } };
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    const session = await prisma.session.findUnique({ where: { id: payload.sid } });
    if (!user || !session || session.userId !== user.id || !isSessionLive(session)) {
        return { fail: { status: 401, body: { error: "Session revoked", code: "SESSION_REVOKED" } } };
    }
    return { user, sessionId: payload.sid };
}

async function requirePlaybackAccess(req, res, next) {
    try {
        const queryToken = typeof req.query?.st === "string" ? req.query.st : null;
        const headerToken = typeof req.headers["x-flux-stream-token"] === "string" ? req.headers["x-flux-stream-token"] : null;
        const cookieToken = readCookie(req, STREAM_COOKIE);
        const explicitToken = queryToken || headerToken; // media-bound
        const token = explicitToken || cookieToken;
        const authHeader = req.headers["authorization"];
        const bearer = authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

        let credKey;
        if (token) credKey = `st:${token}`;
        else if (bearer) credKey = `jwt:${bearer}`;
        else return res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });

        let entry = cache.get(credKey);
        if (!entry || Date.now() - entry.at >= TTL_MS) {
            const r = token ? await resolveStreamToken(token) : await resolveJwt(bearer);
            if (r.fail) {
                // a stale cookie token must not block a valid Bearer caller
                if (token && !explicitToken && bearer) {
                    const j = await resolveJwt(bearer);
                    if (j.fail) return res.status(j.fail.status).json(j.fail.body);
                    entry = { user: j.user, tokenMediaId: null, sessionId: j.sessionId, at: Date.now() };
                } else {
                    return res.status(r.fail.status).json(r.fail.body);
                }
            } else {
                entry = { user: r.user, tokenMediaId: r.tokenMediaId ?? null, sessionId: r.sessionId ?? null, at: Date.now() };
            }
            const denial = playbackDenial(entry.user);
            if (denial) return res.status(denial.status).json(denial.body);
            cache.set(credKey, entry);
        }

        // Media binding is enforced in requireMediaAccess (router-level middleware runs before :id is parsed,
        // so req.params.id is not available here). Only an EXPLICIT token (?st= / header) is media-bound;
        // the shared cookie token is user-bound so several tabs can play different titles.
        req.explicitStreamTokenMediaId = token && explicitToken && entry.tokenMediaId ? entry.tokenMediaId : null;

        req.user = entry.user;
        req.sessionId = entry.sessionId || undefined;
        req.permissions = parsePermissions(entry.user.permissionsJson);
        next();
    } catch (err) {
        console.error("[Auth] requirePlaybackAccess error:", err);
        return res.status(500).json({ error: "Playback authorization failed" });
    }
}


// ─── HLS sessions: capability bound to the account that started them ─────────────────────────────
// hls.js / native-HLS players fetch the manifest and every segment WITHOUT our headers or cookies
// (and the player code is not ours to rewrite). So the session id (64-bit random, only ever handed
// to a caller that passed requirePlaybackAccess) acts as the capability, and we remember which
// account started it. Each segment request re-checks that account's CURRENT eligibility, so
// revoking approval / blocking / expiry stops an already-running stream within seconds too.
const hlsOwners = new Map(); // sessionId → Map<userId, startedAtMs>
const HLS_OWNER_TTL_MS = 12 * 60 * 60 * 1000;
const userCache = new Map(); // userId → { user, at }

function rememberHlsOwner(sessionId, userId) {
    if (!sessionId || !userId) return;
    const key = String(sessionId);
    if (!hlsOwners.has(key)) hlsOwners.set(key, new Map());
    hlsOwners.get(key).set(userId, Date.now());
    if (hlsOwners.size > 5000) for (const k of hlsOwners.keys()) { hlsOwners.delete(k); if (hlsOwners.size <= 4000) break; }
}

/** Wraps res.json so a JSON reply carrying a sessionId records the caller as that session's owner. */
function trackHlsSessionOwner(req, res, next) {
    const json = res.json.bind(res);
    res.json = (body) => {
        if (res.statusCode < 400 && body && typeof body === "object" && body.sessionId && req.user) rememberHlsOwner(body.sessionId, req.user.id);
        return json(body);
    };
    next();
}

async function loadUser(userId) {
    const hit = userCache.get(userId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.user;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    userCache.set(userId, { user, at: Date.now() });
    return user;
}

/** Gate for /stream/hls/:sessionId/* and the session ping/stop routes. */
async function requireHlsAccess(req, res, next) {
    try {
        const owners = hlsOwners.get(String(req.params.sessionId));
        const hasCreds = req.headers["authorization"] || req.query?.st || req.headers["x-flux-stream-token"];
        if (owners && owners.size && !hasCreds) {
            let denial = null;
            for (const [userId, at] of owners) {
                if (Date.now() - at > HLS_OWNER_TTL_MS) { owners.delete(userId); continue; }
                denial = playbackDenial(await loadUser(userId));
                if (!denial) return next(); // at least one owning account may still watch
            }
            if (denial) return res.status(denial.status).json(denial.body);
        }
        return requirePlaybackAccess(req, res, next);
    } catch (err) {
        console.error("[Auth] requireHlsAccess error:", err);
        return res.status(500).json({ error: "Playback authorization failed" });
    }
}

const hlsSweeper = setInterval(() => {
    const now = Date.now();
    for (const [sid, owners] of hlsOwners) {
        for (const [uid, at] of owners) if (now - at > HLS_OWNER_TTL_MS) owners.delete(uid);
        if (!owners.size) hlsOwners.delete(sid);
    }
}, 30 * 60 * 1000);
hlsSweeper.unref?.();

// ─── Per-media permission (library + restricted content), same rules the listing endpoints use ─────────────────

let _resolveFile = null;
function setFileResolver(fn) {
    _resolveFile = fn;
}
async function defaultResolveFile(id) {
    const mediaCache = require("../../utils/media/mediaCache");
    const { readFolders } = require("../../controllers/media/libraryController");
    const cached = mediaCache.getFileById?.(id);
    const folders = await readFolders();
    const file = cached || (await mediaCache.findById(folders, id));
    return { file, folders };
}

const norm = (p) => String(p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const inside = (child, parent) => norm(child) === norm(parent) || norm(child).startsWith(`${norm(parent)}/`);

/** Restricts /stream/<x>/:id to media the user may see (library list + restricted-content flag). Admin passes. */
async function requireMediaAccess(req, res, next) {
    try {
        if (!req.user) return res.status(401).json({ error: "Authentication required" });
        const id = req.params.id;
        if (req.explicitStreamTokenMediaId && id && req.explicitStreamTokenMediaId !== id) {
            return res.status(403).json({ error: "Stream token is not valid for this media", code: "TOKEN_MEDIA_MISMATCH" });
        }
        if (req.user.role === "admin") return next();
        if (!id) return next();

        const { file, folders } = await (_resolveFile || defaultResolveFile)(id);
        if (!file) return next(); // unknown id → controller answers 404

        const perms = req.permissions || parsePermissions(req.user.permissionsJson);
        let item = file;
        if (!item.folderId && perms.libraries?.length) {
            const owner = (folders || []).find((f) => inside(file.path, f.path));
            item = { ...file, folderId: owner?.id };
        }
        // Library restriction is set but the file's library can't be determined → deny (fail closed).
        if (perms.libraries?.length && !item.folderId && !item.library) {
            return res.status(403).json({ error: "Library access denied", code: "LIBRARY_DENIED" });
        }
        if (filterMedia(req.user, [item]).length === 0) {
            return res.status(403).json({ error: "You do not have access to this content", code: "LIBRARY_DENIED" });
        }
        next();
    } catch (err) {
        console.error("[Auth] requireMediaAccess error:", err);
        return res.status(500).json({ error: "Playback authorization failed" });
    }
}

/**
 * Subtitle routes take a base64url-encoded absolute path from the URL. Refuse anything outside a
 * configured library folder so the endpoint cannot be used to read arbitrary subtitle-extension files.
 */
function restrictToLibraryPath(paramName) {
    return async function restrictPath(req, res, next) {
        try {
            const enc = req.params[paramName];
            let decoded;
            try {
                decoded = Buffer.from(String(enc), "base64url").toString();
            } catch {
                return res.status(400).json({ error: "Invalid encoded path" });
            }
            if (!decoded || decoded.includes("\0")) return res.status(400).json({ error: "Invalid encoded path" });
            const path = require("path");
            const resolved = path.resolve(decoded);
            const { readFolders } = _resolveFile ? { readFolders: async () => (await _resolveFile("__folders__")).folders } : require("../../controllers/media/libraryController");
            const folders = await readFolders();
            if (!(folders || []).some((f) => inside(resolved, path.resolve(f.path)))) {
                return res.status(403).json({ error: "Path is outside the media library", code: "PATH_DENIED" });
            }
            next();
        } catch (err) {
            console.error("[Auth] restrictToLibraryPath error:", err);
            return res.status(500).json({ error: "Playback authorization failed" });
        }
    };
}

module.exports = { requirePlaybackAccess, requireHlsAccess, trackHlsSessionOwner, requireMediaAccess, restrictToLibraryPath, playbackDenial, invalidatePlaybackCache, setFileResolver, STREAM_COOKIE, readCookie };
