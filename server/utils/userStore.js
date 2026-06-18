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

// clientId validation — allow alphanumeric + hyphen/underscore (UUID-like)
const VALID_CLIENT_RE = /^[A-Za-z0-9_-]+$/;
function isValidClientId(id) {
    return typeof id === "string" && id.length > 0 && id.length < 128 && VALID_CLIENT_RE.test(id);
}

// Fallback clientId when none supplied (e.g. direct API calls / old clients)
const DEFAULT_CLIENT = "default";

function resolveClientId(clientId) {
    if (clientId && isValidClientId(clientId)) return clientId;
    return DEFAULT_CLIENT;
}

// Safe own-property read
function safeGet(obj, id) {
    return Object.prototype.hasOwnProperty.call(obj, id) ? obj[id] : null;
}

// Safe own-property delete
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
    return JSON.parse(raw);
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
// Schema (multi-client namespaced):
// {
//   "<clientId>": {
//     "<mediaId>": {
//       id, name, type, poster, streamUrl,
//       watchedAt, position, duration, completed, watchCount, lastSessionStart
//     }
//   }
// }
//
// Each browser/device has its own clientId (generated in localStorage by the
// frontend). History is isolated per clientId — no user collisions.
// Single file: history.json. No per-user files.

/**
 * Read the full history store. Returns { clientId: { mediaId: entry } }.
 */
function getHistory(clientId) {
    const store = readJson(HISTORY_FILE);
    const cid = resolveClientId(clientId);
    // If clientId supplied → return only that namespace
    if (clientId) return safeGet(store, cid) || {};
    // No clientId → return flat merged view across all clients (for admin/dashboard)
    const merged = {};
    for (const cStore of Object.values(store)) {
        if (cStore && typeof cStore === "object") {
            Object.assign(merged, cStore);
        }
    }
    return merged;
}

/**
 * Read single history entry for a clientId+mediaId pair.
 */
function getHistoryEntry(id, clientId) {
    if (!isValidId(id)) return null;
    const store = readJson(HISTORY_FILE);
    const cid = resolveClientId(clientId);
    const clientStore = safeGet(store, cid);
    if (!clientStore) return null;
    return safeGet(clientStore, id);
}

/**
 * saveProgress — called periodically by the client while playing.
 * Namespaced by clientId so multiple clients never collide.
 */
function saveProgress(id, data, clientId) {
    if (!isValidId(id)) throw new Error("Invalid media ID");

    const cid = resolveClientId(clientId);
    const store = readJson(HISTORY_FILE);

    // Ensure namespace exists
    if (!Object.prototype.hasOwnProperty.call(store, cid) || typeof store[cid] !== "object") {
        store[cid] = {};
    }

    const clientStore = store[cid];
    const existing = safeGet(clientStore, id) || { watchCount: 0, position: 0, lastSessionStart: 0 };

    const position = typeof data.position === "number" ? data.position : (existing.position ?? 0);
    const duration = typeof data.duration === "number" ? data.duration : (existing.duration ?? 0);
    const completed = duration > 0 ? position / duration >= 0.9 : false;

    const prevPosition = existing.position ?? 0;
    const isNewSession = !existing.id || (prevPosition === 0 && position > 3);
    const watchCount = (existing.watchCount || 0) + (isNewSession ? 1 : 0);

    clientStore[id] = {
        id,
        name: data.name || existing.name || "",
        type: data.type || existing.type || "movie",
        poster: data.poster || existing.poster || null,
        streamUrl: data.streamUrl || existing.streamUrl || null,
        watchedAt: new Date().toISOString(),
        position: completed ? 0 : position,
        duration,
        completed,
        watchCount,
        lastSessionStart: isNewSession ? position : existing.lastSessionStart,
        // Subtitle preference: null means "off", object means the chosen track
        subtitlePref: Object.prototype.hasOwnProperty.call(data, "subtitlePref") ? data.subtitlePref : (existing.subtitlePref ?? null),
    };

    writeJson(HISTORY_FILE, store);
    return clientStore[id];
}

/**
 * Delete single history entry for a clientId+mediaId pair.
 */
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

/**
 * Clear all history for a clientId (or entire store if no clientId).
 */
function clearHistory(clientId) {
    if (clientId !== null && clientId !== undefined) {
        // Explicit clientId supplied — must be valid
        if (!isValidClientId(clientId)) throw new Error("Invalid clientId");
        const store = readJson(HISTORY_FILE);
        store[resolveClientId(clientId)] = {};
        writeJson(HISTORY_FILE, store);
    } else {
        // null/undefined = intentional full-store clear
        writeJson(HISTORY_FILE, {});
    }
}

// ─── Userdata (watchlist + favourites) ───────────────────────────────────────

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
