"use strict";

const fs = require("fs");
const path = require("path");

const HISTORY_FILE = path.join(__dirname, "../data/history.json");
const USERDATA_FILE = path.join(__dirname, "../data/userdata.json");

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
// Schema (multi-client namespaced) — MERGED old + new:
// {
//   "<clientId>": {
//     "<mediaId>": {
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
//       watchCount, lastSessionStart, subtitlePref,
//       // NOTE: no thumbnail field — frames generated on demand by
//       // GET /api/media/:id/thumbnail (ffmpeg), never stored here.
//     }
//   }
// }

function getHistory(clientId) {
    const store = readJson(HISTORY_FILE);
    const cid = resolveClientId(clientId);
    if (clientId) return safeGet(store, cid) || {};
    const merged = {};
    for (const cStore of Object.values(store)) {
        if (cStore && typeof cStore === "object") Object.assign(merged, cStore);
    }
    return merged;
}

function getHistoryEntry(id, clientId) {
    if (!isValidId(id)) return null;
    const store = readJson(HISTORY_FILE);
    const cid = resolveClientId(clientId);
    const clientStore = safeGet(store, cid);
    if (!clientStore) return null;
    return safeGet(clientStore, id);
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
function saveProgress(id, data, clientId) {
    if (!isValidId(id)) throw new Error("Invalid media ID");

    const cid = resolveClientId(clientId);
    const store = readJson(HISTORY_FILE);

    if (!Object.prototype.hasOwnProperty.call(store, cid) || typeof store[cid] !== "object") {
        store[cid] = {};
    }

    const clientStore = store[cid];
    const existing = safeGet(clientStore, id) || {
        watchCount: 0,
        position: 0,
        maxPositionReached: 0,
        lastSessionStart: 0,
    };

    const isReset = !!data.isResetAction;
    const incomingPosition = typeof data.position === "number" ? data.position : existing.position;
    const duration = typeof data.duration === "number" ? data.duration : (existing.duration ?? 0);
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

    clientStore[id] = { ...base, ...movieExtra, ...seriesExtra };

    writeJson(HISTORY_FILE, store);
    return clientStore[id];
}

function deleteHistoryEntry(id, clientId) {
    if (!isValidId(id)) return false;
    const cid = resolveClientId(clientId);
    const store = readJson(HISTORY_FILE);
    const clientStore = safeGet(store, cid);
    if (!clientStore) return false;
    if (!safeDelete(clientStore, id)) return false;
    writeJson(HISTORY_FILE, store);
    return true;
}

function clearHistory(clientId) {
    if (clientId !== null && clientId !== undefined) {
        if (!isValidClientId(clientId)) throw new Error("Invalid clientId");
        const store = readJson(HISTORY_FILE);
        store[resolveClientId(clientId)] = {};
        writeJson(HISTORY_FILE, store);
    } else {
        writeJson(HISTORY_FILE, {});
    }
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

module.exports = {
    getHistory,
    getHistoryEntry,
    saveProgress,
    deleteHistoryEntry,
    clearHistory,
    getUserdata,
    addToWatchlist,
    removeFromWatchlist,
    addToFavourites,
    removeFromFavourites,
};
