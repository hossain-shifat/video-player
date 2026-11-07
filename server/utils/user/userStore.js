"use strict";

const fs = require("fs");
const path = require("path");

const HISTORY_FILE = path.join(__dirname, "../../data/users/history.json");
const USERDATA_FILE = path.join(__dirname, "../../data/users/userdata.json");

// ─── Safe ID validation ───────────────────────────────────────────────────────
const VALID_ID_RE = /^[A-Za-z0-9_=-]+$/;
function isValidId(id) {
    return typeof id === "string" && id.length > 0 && id.length < 512 && VALID_ID_RE.test(id);
}

const VALID_CLIENT_RE = /^[A-Za-z0-9_-]+$/;
function isValidClientId(id) {
    return typeof id === "string" && id.length > 0 && id.length < 128 && VALID_CLIENT_RE.test(id);
}

const DEFAULT_CLIENT = "default";

function resolveClientId(clientId) {
    if (clientId && isValidClientId(clientId)) return clientId;
    return DEFAULT_CLIENT;
}

function safeGet(obj, id) {
    return Object.prototype.hasOwnProperty.call(obj, id) ? obj[id] : null;
}

function safeDelete(obj, id) {
    if (!Object.prototype.hasOwnProperty.call(obj, id)) return false;
    delete obj[id];
    return true;
}

// ─── Generic atomic JSON store ───────────────────────────────────────────────

function readJson(file) {
    let raw;
    try {
        raw = fs.readFileSync(file, "utf-8");
    } catch (err) {
        if (err.code === "ENOENT") return {};
        throw err;
    }
    if (!raw || !raw.trim()) return {};
    try {
        return JSON.parse(raw);
    } catch (err) {
        // File exists but isn't valid JSON — likely a partial/corrupted write
        // (e.g. interrupted rename on Windows, file locked by another
        // process mid-write). Don't crash every single request forever:
        // back up the bad file once so nothing is silently lost, then
        // start fresh from {} so the route works again immediately.
        console.error(`[Store] Corrupt JSON in ${file} — backing up and resetting. Error: ${err.message}`);
        try {
            fs.copyFileSync(file, `${file}.corrupt.${Date.now()}.bak`);
        } catch (backupErr) {
            console.error(`[Store] Could not back up corrupt file: ${backupErr.message}`);
        }
        return {};
    }
}

function writeJson(file, data) {
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
    } catch {}
    const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmp, file);
}

// ─── Part number detection ───────────────────────────────────────────────────
// Matches: "Part 2", "CD2", "Disc 2", "Disk2", "Pt.2", "pt 2"
const PART_RE = /(?:part|cd|disc|disk|pt)[\s._-]*(\d+)/i;

function detectPartNumber(...fields) {
    const haystack = fields.filter(Boolean).join(" ");
    const match = haystack.match(PART_RE);
    return match ? parseInt(match[1], 10) : null;
}

// ─── History ─────────────────────────────────────────────────────────────────
// Storage layout (per ACCOUNT, media is an ARRAY of entry objects):
// {
//   "<userId>": {
//     "email": "mail@gmail.com",   // readable label only — never used for lookup
//     "media": [
//       {
//       id, mediaType, type,
//       title,          // movie title -OR- series/anime show name
//       name,           // ← OLD legacy field, kept — some older client builds
//                       //   (HistoryCard, etc.) read `name` instead of `title`.
//                       //   Always kept in sync with title so neither breaks.
//       seriesTitle,    // NEW — episode display title (series/anime only)
//       episodeTitle,   // legacy alias of seriesTitle — ALWAYS present (even
//                       //   null on movies) to match the old shape exactly.
//       seasonNumber,   // NEW — integer | null
//       episodeNumber,  // NEW — integer | null
//       partNumber,     // NEW — integer | null (multi-part movies: Part 2, CD2, etc.)
//       poster, streamUrl,
//       watchedAt,      // refreshed on every progress save → drives chronological sort
//       position, maxPositionReached, duration, completed,
//       subtitlePosition, // NEW — mirrors `position`; explicit resume seed
//                         //   for the subtitle renderer's clock
//       watchCount, lastSessionStart, subtitlePref,
//       // NOTE: no thumbnail field — frames generated on demand by
//       // GET /api/media/:id/thumbnail (ffmpeg), never stored here.
//       }
//     ]
//   }
// }
// Legacy layouts ({ "<clientId>": { "<mediaId>": entry } }) are converted
// in memory on read and rewritten in the new layout on the next save.

// ── Store helpers (account → { email, media[] }) ───────────────────────────
function normalizeBlock(block) {
    if (!block || typeof block !== "object") return { email: null, media: [] };
    if (Array.isArray(block.media)) {
        return { email: block.email ?? null, media: block.media.filter((e) => e && typeof e === "object" && e.id) };
    }
    // Legacy: { "<mediaId>": entry, ... }
    return { email: null, media: Object.values(block).filter((e) => e && typeof e === "object" && e.id) };
}

// In-memory cache keyed on the file's mtime+size: GET /api/history and the
// 4s progress saves no longer re-read + re-parse history.json every request.
// Deleting / hand-editing the file changes mtime/size → cache reloads itself.
let _cache = null; // { mtimeMs, size, store }

function statHistory() {
    try {
        const st = fs.statSync(HISTORY_FILE);
        return { mtimeMs: st.mtimeMs, size: st.size };
    } catch {
        return null;
    }
}

function loadStore() {
    const st = statHistory();
    if (!st) {
        _cache = null;
        return {};
    }
    if (_cache && _cache.mtimeMs === st.mtimeMs && _cache.size === st.size) return _cache.store;
    const raw = readJson(HISTORY_FILE);
    const store = {};
    for (const [uid, block] of Object.entries(raw)) store[uid] = normalizeBlock(block);
    _cache = { ...st, store };
    return store;
}

function saveStore(store) {
    const out = {};
    for (const [uid, block] of Object.entries(store)) out[uid] = { email: block.email ?? null, media: block.media };
    writeJson(HISTORY_FILE, out);
    const st = statHistory();
    _cache = st ? { ...st, store } : null;
}

// Returns { "<mediaId>": entry } for ONE account — same shape the controller
// always received, so nothing upstream changes.
function getHistory(userId) {
    if (!userId) return {};
    const block = safeGet(loadStore(), resolveClientId(userId));
    const out = {};
    if (block) for (const e of block.media) out[e.id] = e;
    return out;
}

function getHistoryEntry(id, userId) {
    if (!isValidId(id)) return null;
    const block = safeGet(loadStore(), resolveClientId(userId));
    if (!block) return null;
    return block.media.find((e) => e.id === id) || null;
}

/**
 * saveProgress — upsert for this clientId+mediaId pair.
 *
 * Milestone lock: if `data.position` is at or behind the previously saved
 * high-water mark (`maxPositionReached`), the write is SKIPPED entirely and
 * the existing entry is returned unchanged — stops transcoding jitter /
 * rewatching an already-completed segment from stomping the resume point
 * backward. Pass `data.isResetAction: true` to bypass and force position → 0.
 *
 * `watchedAt` is always refreshed on every real write (non-skipped) so the
 * frontend chronological sort always reflects the latest activity.
 *
 * Accepted fields from callers (new + legacy, both honored):
 *   data.title / data.name     — either works, kept in sync both ways
 *   data.seriesTitle / data.episodeTitle — either works (seriesTitle wins if both sent)
 *   data.seasonNumber, data.episodeNumber
 *   data.partNumber            — explicit multi-part movie part number (optional;
 *                                 auto-detected from title/name/streamUrl if omitted)
 */
function saveProgress(id, data, clientId, email) {
    if (!isValidId(id)) throw new Error("Invalid media ID");

    const cid = resolveClientId(clientId);
    const store = loadStore();

    if (!Object.prototype.hasOwnProperty.call(store, cid)) {
        store[cid] = { email: null, media: [] };
    }

    const block = store[cid];
    if (email) block.email = email;
    const existingIdx = block.media.findIndex((e) => e.id === id);
    const existing = (existingIdx >= 0 ? block.media[existingIdx] : null) || {
        watchCount: 0,
        position: 0,
        maxPositionReached: 0,
        lastSessionStart: 0,
    };

    const isReset = !!data.isResetAction;
    const incomingPosition = typeof data.position === "number" ? data.position : existing.position;
    const incomingDuration = typeof data.duration === "number" ? data.duration : null;
    const existingDuration = existing.duration || 0;
    // FIX (entry silently marked completed → resume never fires, even though
    // position was saved correctly): duration used to be
    // `typeof data.duration === "number" ? data.duration : existing.duration`
    // — accepting whatever the caller sent, no floor. But the caller's
    // duration comes from video.duration (native <video> element), which for
    // HLS EVENT playlists starts small and grows as segments append, and
    // resets small again on every fresh session (quality switch, resume-load,
    // etc) — the exact same session-relative problem as currentTime, just for
    // the total-length side instead of the position side. A save landing
    // while that's still small — e.g. right after a quality switch, before
    // the frontend's real (ffprobe) duration has propagated — could shrink
    // the STORED duration. `completed = position/duration >= 0.9` then
    // false-triggers on a perfectly normal mid-watch position, and `completed`
    // never resets itself back to false afterward even once duration recovers
    // (nothing here decrements it) — permanently blocking resume from this
    // point on, both the resume-dialog path and the dialog-less auto-resume
    // path in the frontend, since both gate strictly on `!completed`. Once a
    // real duration (>60s — long enough to rule out an early/tiny manifest
    // read) has been recorded, never accept anything smaller than it again.
    const duration = incomingDuration == null ? existingDuration : existingDuration > 60 ? Math.max(existingDuration, incomingDuration) : incomingDuration;
    const maxReached = existing.maxPositionReached || 0;

    // ── Milestone lock ─────────────────────────────────────────────────────
    if (!isReset && existing.id && incomingPosition <= maxReached) {
        return existing;
    }

    const position = isReset ? 0 : incomingPosition;

    // maxPositionReached is NEVER zeroed on completion — only on explicit isResetAction.
    // Why: if completion zeroed maxPositionReached, replaying a movie from 0:00 would
    // let incomingPosition (5s) > maxReached (0) pass the milestone lock → stored
    // position overwrites to ~0:00. Keeping maxPositionReached intact means the lock
    // holds until the user genuinely surpasses their previous furthest point.
    const maxPositionReached = isReset ? 0 : Math.max(maxReached, incomingPosition);

    const completed = !isReset && duration > 0 ? position / duration >= 0.9 : false;

    const prevPosition = existing.position ?? 0;
    const isNewSession = !existing.id || (prevPosition === 0 && position > 3);
    const watchCount = (existing.watchCount || 0) + (isNewSession ? 1 : 0);

    const mediaType = data.mediaType || data.type || existing.mediaType || existing.type || "movie";
    const isSeries = mediaType === "series" || mediaType === "anime";

    // ── title / name — dual-field back-compat ───────────────────────────────
    // Old clients send/read `name`; newer ones send/read `title`. Resolve
    // from whichever is present and keep BOTH fields populated with the
    // same value so neither an old nor a new frontend build breaks.
    const title = data.title ?? existing.title ?? data.name ?? existing.name ?? "";
    const nameField = data.name || existing.name || title;

    // ── seriesTitle: episode name (series/anime only) ──────────────────────
    // Accept new `seriesTitle` key; fall back to legacy `episodeTitle` so old
    // clients that haven't been updated yet don't lose their episode names.
    const seriesTitle = isSeries ? (Object.prototype.hasOwnProperty.call(data, "seriesTitle") ? data.seriesTitle : (data.episodeTitle ?? existing.seriesTitle ?? existing.episodeTitle ?? null)) : null;

    // ── Season / episode numbers ───────────────────────────────────────────
    const seasonNumber = isSeries ? (data.seasonNumber ?? existing.seasonNumber ?? null) : null;
    const episodeNumber = isSeries ? (data.episodeNumber ?? existing.episodeNumber ?? null) : null;

    // ── partNumber: multi-part movie detection ─────────────────────────────
    // Caller may supply it explicitly; otherwise auto-detect from title/name/URL.
    const streamUrl = data.streamUrl || existing.streamUrl || "";

    const partNumber = !isSeries
        ? Object.prototype.hasOwnProperty.call(data, "partNumber")
            ? (data.partNumber ?? null)
            : (existing.partNumber ?? detectPartNumber(title, nameField, streamUrl))
        : null;

    // Shared base fields — common to both movies and series
    const base = {
        id,
        mediaType,
        type: mediaType, // back-compat alias

        title,
        name: nameField, // legacy field — kept in sync with title, never dropped

        poster: data.poster || existing.poster || null,
        streamUrl: data.streamUrl || existing.streamUrl || null,
        watchedAt: new Date().toISOString(),
        position: completed ? 0 : position,
        // NEW: explicit subtitle-resume position. Same value as `position`
        // (derived from the same incoming video currentTime, guarded by the
        // same milestone lock / completed-reset logic above) — kept as its
        // own key so the frontend can seed the subtitle clock directly from
        // history without any ambiguity about which field it's reading for
        // which purpose. Always in sync with position; never diverges.
        subtitlePosition: completed ? 0 : position,
        maxPositionReached, // never zeroed on completion — milestone lock integrity
        duration,
        completed,
        watchCount,
        lastSessionStart: isNewSession ? position : existing.lastSessionStart,
        subtitlePref: Object.prototype.hasOwnProperty.call(data, "subtitlePref") ? data.subtitlePref : (existing.subtitlePref ?? null),
    };

    // Movie-specific: only include partNumber when the movie actually has parts
    const movieExtra = partNumber != null ? { partNumber } : {};

    // Series/anime-specific: episode metadata. episodeTitle is ALWAYS present
    // (even as null on movies) to match the old shape exactly — some older
    // client code may read `entry.episodeTitle` unconditionally.
    const seriesExtra = isSeries
        ? {
              seriesTitle,
              seasonNumber,
              episodeNumber,
              episodeTitle: seriesTitle, // legacy alias — remove once all clients updated
          }
        : { episodeTitle: null };

    const entry = { ...base, ...movieExtra, ...seriesExtra };
    if (existingIdx >= 0) block.media[existingIdx] = entry;
    else block.media.unshift(entry);

    saveStore(store);
    return entry;
}

function deleteHistoryEntry(id, userId) {
    if (!isValidId(id)) return false;
    const store = loadStore();
    const block = safeGet(store, resolveClientId(userId));
    if (!block) return false;
    const before = block.media.length;
    block.media = block.media.filter((e) => e.id !== id);
    if (block.media.length === before) return false;
    saveStore(store);
    return true;
}

function clearHistory(userId) {
    if (userId !== null && userId !== undefined) {
        if (!isValidClientId(userId)) throw new Error("Invalid userId");
        const store = loadStore();
        const cid = resolveClientId(userId);
        store[cid] = { email: store[cid]?.email ?? null, media: [] };
        saveStore(store);
    } else {
        writeJson(HISTORY_FILE, {});
        _cache = null;
    }
}

/**
 * markHistoryCompleted — flip ONE entry's `completed` flag (Continue Watching hides
 * completed titles). Called by the Watch Time controller when a replay starts/finishes;
 * Watch Time itself never reads or writes history.json.
 */
function markHistoryCompleted(userId, id, completed) {
    if (!isValidId(id)) return false;
    const store = loadStore();
    const block = safeGet(store, resolveClientId(userId));
    const entry = block ? block.media.find((e) => e.id === id) : null;
    if (!entry || !!entry.completed === !!completed) return false;
    entry.completed = !!completed;
    entry.watchedAt = new Date().toISOString();
    saveStore(store);
    return true;
}

// ─── Userdata (watchlist + favourites) — unchanged ───────────────────────────

function getUserdata() {
    const d = readJson(USERDATA_FILE);
    if (!d.watchlist) d.watchlist = {};
    if (!d.favourites) d.favourites = {};
    return d;
}

function addToWatchlist(id, data) {
    if (!isValidId(id)) throw new Error("Invalid media ID");
    const ud = getUserdata();
    ud.watchlist[id] = { id, name: data.name, poster: data.poster || null, type: data.type || "movie", addedAt: new Date().toISOString() };
    writeJson(USERDATA_FILE, ud);
    return ud.watchlist[id];
}

function removeFromWatchlist(id) {
    if (!isValidId(id)) return false;
    const ud = getUserdata();
    if (!safeDelete(ud.watchlist, id)) return false;
    writeJson(USERDATA_FILE, ud);
    return true;
}

function addToFavourites(id, data) {
    if (!isValidId(id)) throw new Error("Invalid media ID");
    const ud = getUserdata();
    ud.favourites[id] = { id, name: data.name, poster: data.poster || null, type: data.type || "movie", addedAt: new Date().toISOString() };
    writeJson(USERDATA_FILE, ud);
    return ud.favourites[id];
}

function removeFromFavourites(id) {
    if (!isValidId(id)) return false;
    const ud = getUserdata();
    if (!safeDelete(ud.favourites, id)) return false;
    writeJson(USERDATA_FILE, ud);
    return true;
}


// ─── Account lifecycle: recoverable deletion (30 days) + permanent purge ──────
//
// Retention policy (what survives the 30-day window, what does not):
//   KEPT  (recoverable) : User row (profile, name, username, avatar, email), history.json block
//                         (resume progress / watch history), notification preferences, notifications,
//                         push preference rows (deactivated), anything registered via registerUserPurgeHook.
//   DROPPED immediately : sessions (revoked), stream tokens, OTP codes, push registrations (deactivated).
//   RESET on recovery   : role → "user" (or admin if ADMIN_EMAIL), status → "pending" (or approved for
//                         ADMIN_EMAIL), permissions → defaults. Authorization is NOT personal data, so
//                         stale permissions never come back; an admin re-approves the returning user.
//   PURGED at deadline  : the User row (cascades devices, sessions, otps, stream tokens, notifications,
//                         push devices, preferences) + history.json block + registered hooks.
//   NEVER deleted       : shared media files / libraries, other users, AuditEvent rows (no secrets, masked email).
//   KNOWN GAP           : watchlist/favourites live in data/userdata.json which is GLOBAL (not per user) in the
//                         current code, so they cannot be retained or purged per account.

const DELETION_GRACE_DAYS = parseInt(process.env.ACCOUNT_DELETION_GRACE_DAYS || "30", 10);
const DAY_MS = 86_400_000;

function maskEmail(email = "") {
    const [local = "", domain = ""] = String(email).split("@");
    if (!domain) return "";
    const head = local.slice(0, 1);
    const tail = local.length > 2 ? local.slice(-1) : "";
    return `${head}***${tail}@${domain}`;
}

/** Append-only audit trail. Never pass tokens, OTPs, passwords. Failures are logged, never thrown. */
async function recordAudit({ action, actorId = null, targetUserId = null, targetEmail = "", detail = {} }) {
    try {
        const prisma = require("../../auth/prismaClient");
        await prisma.auditEvent.create({
            data: { action, actorId, targetUserId, targetLabel: maskEmail(targetEmail), detailJson: JSON.stringify(detail || {}) },
        });
    } catch (err) {
        console.error(`[Audit] could not record "${action}":`, err.message);
    }
}

// Extra per-user data owners (e.g. watch-time store) register an idempotent purge function here.
const purgeHooks = [];
function registerUserPurgeHook(fn) {
    if (typeof fn === "function") purgeHooks.push(fn);
}

/** Removes this account's block from history.json. Idempotent. */
function deleteUserHistory(userId) {
    if (!isValidClientId(userId)) return false;
    const store = loadStore();
    if (!Object.prototype.hasOwnProperty.call(store, userId)) return false;
    delete store[userId];
    saveStore(store);
    return true;
}

async function otherActiveAdminCount(excludeId) {
    const prisma = require("../../auth/prismaClient");
    return prisma.user.count({ where: { role: "admin", status: "approved", deletedAt: null, id: { not: excludeId } } });
}

/**
 * Admin-initiated deletion. Immediately: status "deleted", every session revoked, stream tokens /
 * OTPs removed, push deactivated. Data is retained until purgeAt. Safe against double-click / races
 * (conditional update on deletedAt: null).
 * Returns { ok:true, user } or { ok:false, code } with code ∈ NOT_FOUND | SELF | LAST_ADMIN | ALREADY_DELETED.
 */
async function softDeleteUser(targetId, actorId) {
    const prisma = require("../../auth/prismaClient");
    const { revokeSessions } = require("../../auth/services/tokenService");

    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) return { ok: false, code: "NOT_FOUND" };
    if (target.deletedAt) return { ok: false, code: "ALREADY_DELETED" };
    if (target.id === actorId) return { ok: false, code: "SELF" };
    if (target.role === "admin" && (await otherActiveAdminCount(target.id)) === 0) return { ok: false, code: "LAST_ADMIN" };

    const now = new Date();
    const purgeAt = new Date(now.getTime() + DELETION_GRACE_DAYS * DAY_MS);

    const res = await prisma.user.updateMany({
        where: { id: targetId, deletedAt: null },
        data: { status: "deleted", statusBeforeDeletion: target.status, deletedAt: now, purgeAt, deletedById: actorId, purgeError: null },
    });
    if (res.count === 0) return { ok: false, code: "ALREADY_DELETED" };

    await revokeSessions({ userId: targetId }, "account_deleted");
    await prisma.streamToken.deleteMany({ where: { userId: targetId } }).catch(() => {});
    await prisma.oTP.deleteMany({ where: { userId: targetId } }).catch(() => {});
    await prisma.pushDevice.updateMany({ where: { userId: targetId }, data: { isActive: false } }).catch(() => {});

    await recordAudit({
        action: "account_deleted",
        actorId,
        targetUserId: targetId,
        targetEmail: target.email,
        detail: { purgeAt: purgeAt.toISOString(), previousStatus: target.status, role: target.role },
    });

    return { ok: true, user: { id: targetId, deletedAt: now, purgeAt } };
}

/**
 * Restore a pending-deletion account. CALLER MUST HAVE VERIFIED OWNERSHIP (emailed OTP or
 * Google-verified email). Conditional on deletedAt set AND purgeAt still in the future, so a
 * second concurrent recovery, or one after the deadline, changes nothing (returns null).
 */
async function recoverAccount(userId, { isAdminEmail = false } = {}) {
    const prisma = require("../../auth/prismaClient");
    const { DEFAULT_PERMISSIONS, serializePermissions } = require("../../auth/services/permissionService");
    const { revokeSessions } = require("../../auth/services/tokenService");

    const res = await prisma.user.updateMany({
        where: { id: userId, deletedAt: { not: null }, purgeAt: { gt: new Date() } },
        data: {
            status: isAdminEmail ? "approved" : "pending",
            role: isAdminEmail ? "admin" : "user",
            accessType: "permanent",
            accessExpiresAt: null,
            permissionsJson: serializePermissions(DEFAULT_PERMISSIONS),
            emailVerified: true,
            deletedAt: null,
            purgeAt: null,
            deletedById: null,
            statusBeforeDeletion: null,
            purgeError: null,
        },
    });
    if (res.count === 0) return null;

    // belt and braces: nothing from before deletion may survive
    await revokeSessions({ userId }, "account_deleted");
    const user = await prisma.user.findUnique({ where: { id: userId } });
    await recordAudit({ action: "account_recovered", actorId: userId, targetUserId: userId, targetEmail: user?.email, detail: { newStatus: user?.status } });
    return user;
}

let purgeRunning = false;

/**
 * Permanently remove accounts whose recovery window has passed. Idempotent, bounded per run,
 * failures are recorded on the user row (purgeError) + audit log and retried next cycle.
 * Order: per-user JSON data first, DB row last — a crash in between just means a harmless retry.
 */
async function purgeExpiredAccounts({ limit = 25 } = {}) {
    if (purgeRunning) return { purged: 0, failed: 0, skipped: true };
    purgeRunning = true;
    const prisma = require("../../auth/prismaClient");
    let purged = 0;
    let failed = 0;
    try {
        const due = await prisma.user.findMany({
            where: { deletedAt: { not: null }, purgeAt: { lte: new Date() } },
            take: limit,
            select: { id: true, email: true },
        });

        for (const u of due) {
            try {
                // re-check right before destroying: a recovery before the deadline clears deletedAt
                const still = await prisma.user.findFirst({ where: { id: u.id, deletedAt: { not: null }, purgeAt: { lte: new Date() } }, select: { id: true } });
                if (!still) continue;

                for (const hook of purgeHooks) await hook(u.id);
                deleteUserHistory(u.id);

                const del = await prisma.user.deleteMany({ where: { id: u.id, deletedAt: { not: null }, purgeAt: { lte: new Date() } } });
                if (del.count) {
                    purged++;
                    await recordAudit({ action: "account_purged", targetUserId: u.id, targetEmail: u.email, detail: {} });
                }
            } catch (err) {
                failed++;
                console.error(`[Purge] failed for user ${u.id}:`, err.message);
                await prisma.user.updateMany({ where: { id: u.id }, data: { purgeError: String(err.message).slice(0, 300) } }).catch(() => {});
                await recordAudit({ action: "account_purge_failed", targetUserId: u.id, targetEmail: u.email, detail: { error: String(err.message).slice(0, 200) } });
            }
        }
        if (purged || failed) console.log(`[Purge] permanently removed ${purged} account(s), ${failed} failure(s)`);
    } finally {
        purgeRunning = false;
    }
    return { purged, failed };
}

let _purgeBoot = null;
let _purgeTimer = null;
/** DB-backed (purgeAt column), so it survives restarts; the timer is only the trigger. unref'd like the other daemons. */
function startAccountPurgeScheduler() {
    const every = parseInt(process.env.ACCOUNT_PURGE_INTERVAL_MS || String(60 * 60 * 1000), 10);
    const tick = () => {
        purgeExpiredAccounts().catch((e) => console.error("[Purge]", e.message));
        // sign out sessions unused for 30 days (accounts untouched)
        require("../../auth/services/tokenService").expireInactiveSessions().catch((e) => console.error("[Sessions]", e.message));
    };
    _purgeBoot = setTimeout(tick, 60 * 1000);
    _purgeBoot.unref();
    _purgeTimer = setInterval(tick, every);
    _purgeTimer.unref();
}
function stopAccountPurgeScheduler() {
    if (_purgeBoot) clearTimeout(_purgeBoot);
    if (_purgeTimer) clearInterval(_purgeTimer);
    _purgeBoot = _purgeTimer = null;
}

module.exports = {
    getHistory,
    getHistoryEntry,
    saveProgress,
    deleteHistoryEntry,
    clearHistory,
    markHistoryCompleted,
    readJson,
    writeJson,
    getUserdata,
    addToWatchlist,
    removeFromWatchlist,
    addToFavourites,
    removeFromFavourites,
    // account lifecycle
    recordAudit,
    maskEmail,
    softDeleteUser,
    recoverAccount,
    purgeExpiredAccounts,
    startAccountPurgeScheduler,
    stopAccountPurgeScheduler,
    registerUserPurgeHook,
    otherActiveAdminCount,
    DELETION_GRACE_DAYS,
};
