"use strict";

const fs   = require("fs");
const path = require("path");

const HISTORY_FILE  = path.join(__dirname, "../data/history.json");
const USERDATA_FILE = path.join(__dirname, "../data/userdata.json");

// ─── Safe ID validation ───────────────────────────────────────────────────────
// IDs are base64url strings — only allow those characters to block __proto__ etc.
const VALID_ID_RE = /^[A-Za-z0-9_=-]+$/;
function isValidId(id) {
    return typeof id === "string" && id.length > 0 && id.length < 512 && VALID_ID_RE.test(id);
}

// Safe own-property read — never returns inherited keys
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
        // File does not exist yet — return empty object
        if (err.code === "ENOENT") return {};
        throw err; // any other fs error (permissions etc.) should surface
    }
    // JSON parse errors are not swallowed — they propagate to the caller
    return JSON.parse(raw);
}

function writeJson(file, data) {
    const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmp, file);
}

// ─── History ─────────────────────────────────────────────────────────────────
// Schema per entry:
// history[id] = {
//   id, name, type, poster, streamUrl,
//   watchedAt,       — ISO string of last watch
//   position,        — seconds from start (resume point)
//   duration,        — total duration in seconds
//   completed,       — true if watched ≥90%
//   watchCount,      — number of distinct sessions started
//   lastSessionStart — position recorded at session-start ping; used to gate watchCount
// }

function getHistory() {
    return readJson(HISTORY_FILE);
}

function getHistoryEntry(id) {
    if (!isValidId(id)) return null;
    const history = readJson(HISTORY_FILE);
    return safeGet(history, id);
}

/**
 * saveProgress — called periodically by the client while playing.
 *
 * watchCount increments only when a NEW session starts, detected by:
 *   previous stored position was 0 (fresh or completed) AND incoming position > 0
 *   OR no existing entry at all (first ever play)
 *
 * This means rapid progress-pings during a single playback session never
 * re-increment watchCount.
 */
function saveProgress(id, data) {
    if (!isValidId(id)) throw new Error("Invalid media ID");

    const history = readJson(HISTORY_FILE);
    const existing = safeGet(history, id) || { watchCount: 0, position: 0, lastSessionStart: 0 };

    const position = typeof data.position === "number" ? data.position : (existing.position ?? 0);
    const duration = typeof data.duration === "number" ? data.duration : (existing.duration ?? 0);
    const completed = duration > 0 ? position / duration >= 0.9 : false;

    // New session = previously at 0 (start/reset) and now past the first 3 seconds
    const prevPosition = existing.position ?? 0;
    const isNewSession = !existing.id || (prevPosition === 0 && position > 3);
    const watchCount   = (existing.watchCount || 0) + (isNewSession ? 1 : 0);

    history[id] = {
        id,
        name:             data.name      || existing.name      || "",
        type:             data.type      || existing.type      || "movie",
        poster:           data.poster    || existing.poster    || null,
        streamUrl:        data.streamUrl || existing.streamUrl || null,
        watchedAt:        new Date().toISOString(),
        position:         completed ? 0 : position,
        duration,
        completed,
        watchCount,
        lastSessionStart: isNewSession ? position : existing.lastSessionStart,
    };

    writeJson(HISTORY_FILE, history);
    return history[id];
}

function deleteHistoryEntry(id) {
    if (!isValidId(id)) return false;
    const history = readJson(HISTORY_FILE);
    if (!safeDelete(history, id)) return false;
    writeJson(HISTORY_FILE, history);
    return true;
}

function clearHistory() {
    writeJson(HISTORY_FILE, {});
}

// ─── Userdata (watchlist + favourites) ───────────────────────────────────────

function getUserdata() {
    const d = readJson(USERDATA_FILE);
    if (!d.watchlist)  d.watchlist  = {};
    if (!d.favourites) d.favourites = {};
    return d;
}

function addToWatchlist(id, data) {
    if (!isValidId(id)) throw new Error("Invalid media ID");
    const ud = getUserdata();
    ud.watchlist[id] = { id, name: data.name, poster: data.poster || null,
                         type: data.type || "movie", addedAt: new Date().toISOString() };
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
    ud.favourites[id] = { id, name: data.name, poster: data.poster || null,
                          type: data.type || "movie", addedAt: new Date().toISOString() };
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
    getHistory, getHistoryEntry, saveProgress, deleteHistoryEntry, clearHistory,
    getUserdata, addToWatchlist, removeFromWatchlist, addToFavourites, removeFromFavourites,
};
