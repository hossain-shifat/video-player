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

// ─── History ─────────────────────────────────────────────────────────────────
// Schema (multi-client namespaced — clientId is the "unique user" key, so
// req #1's compound-unique-constraint is just "object key per clientId+mediaId",
// already structurally enforced — every save is an upsert onto that one slot,
// never a new record):
// {
//   "<clientId>": {
//     "<mediaId>": {
//       id, mediaType,           // "movie" | "series" | "anime"
//       title,                   // parent/show title (movie: same as the title)
//       episodeTitle,            // e.g. "S1E3 · To You, in 2000 Years" — null for movies
//       name,                    // legacy display field, kept for old clients
//       poster, streamUrl,
//       watchedAt,
//       position,                // resume point — never moves backward except on reset
//       maxPositionReached,      // milestone-lock high-water mark
//       duration, completed,
//       watchCount, lastSessionStart,
//       subtitlePref,
//       // NOTE: no thumbnail/image fields here at all — per spec #3, history
//       // only ever stores the numeric resume_time. Preview frames are
//       // generated on demand by GET /api/media/:id/thumbnail (ffmpeg),
//       // never written into history.json.
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
 * the existing entry is returned unchanged — this is what stops transcoding
 * jitter / rewatching an already-completed segment from stomping the resume
 * point backward. Pass `data.isResetAction: true` ("Start Over" button) to
 * bypass the lock and force position back to 0.
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

    // ── Milestone lock ────────────────────────────────────────────────────
    // Not a reset, entry already exists, and incoming position hasn't
    // strictly surpassed the high-water mark → no-op, return as-is.
    if (!isReset && existing.id && incomingPosition <= maxReached) {
        return existing;
    }

    const position = isReset ? 0 : incomingPosition;
    const maxPositionReached = isReset ? 0 : Math.max(maxReached, incomingPosition);
    const completed = !isReset && duration > 0 ? position / duration >= 0.9 : false;

    const prevPosition = existing.position ?? 0;
    const isNewSession = !existing.id || (prevPosition === 0 && position > 3);
    const watchCount = (existing.watchCount || 0) + (isNewSession ? 1 : 0);

    clientStore[id] = {
        id,
        mediaType: data.mediaType || data.type || existing.mediaType || existing.type || "movie",
        // Back-compat: some callers still send `type` instead of `mediaType`
        type: data.mediaType || data.type || existing.mediaType || existing.type || "movie",
        title: data.title ?? existing.title ?? data.name ?? existing.name ?? "",
        episodeTitle: Object.prototype.hasOwnProperty.call(data, "episodeTitle") ? data.episodeTitle : (existing.episodeTitle ?? null),
        name: data.name || existing.name || data.title || existing.title || "",
        poster: data.poster || existing.poster || null,
        streamUrl: data.streamUrl || existing.streamUrl || null,
        watchedAt: new Date().toISOString(),
        position: completed ? 0 : position,
        maxPositionReached: completed ? 0 : maxPositionReached,
        duration,
        completed,
        watchCount,
        lastSessionStart: isNewSession ? position : existing.lastSessionStart,
        subtitlePref: Object.prototype.hasOwnProperty.call(data, "subtitlePref") ? data.subtitlePref : (existing.subtitlePref ?? null),
    };

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
