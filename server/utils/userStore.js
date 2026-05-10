"use strict";

const fs   = require("fs");
const path = require("path");

const HISTORY_FILE   = path.join(__dirname, "../data/history.json");
const USERDATA_FILE  = path.join(__dirname, "../data/userdata.json");

// ─── Generic atomic JSON store ───────────────────────────────────────────────

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch {
        return {};
    }
}

function writeJson(file, data) {
    const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmp, file);
}

// ─── History ─────────────────────────────────────────────────────────────────
// Schema per entry:
// history[id] = {
//   id, name, type, poster,
//   watchedAt,        ← ISO string of last watch
//   position,         ← seconds from start (resume point)
//   duration,         ← total duration in seconds (sent by client)
//   completed,        ← true if watched >90%
//   watchCount,       ← how many times played
// }

function getHistory() {
    return readJson(HISTORY_FILE);
}

function getHistoryEntry(id) {
    return readJson(HISTORY_FILE)[id] || null;
}

function saveProgress(id, data) {
    const history = readJson(HISTORY_FILE);
    const existing = history[id] || { watchCount: 0 };
    const position = data.position ?? existing.position ?? 0;
    const duration = data.duration ?? existing.duration ?? 0;
    const completed = duration > 0 ? position / duration >= 0.9 : false;

    history[id] = {
        id,
        name:       data.name      || existing.name      || "",
        type:       data.type      || existing.type      || "movie",
        poster:     data.poster    || existing.poster    || null,
        streamUrl:  data.streamUrl || existing.streamUrl || null,
        watchedAt:  new Date().toISOString(),
        position:   completed ? 0 : position,   // reset if completed
        duration,
        completed,
        watchCount: (existing.watchCount || 0) + (data.countView !== false ? 1 : 0),
    };

    writeJson(HISTORY_FILE, history);
    return history[id];
}

function deleteHistoryEntry(id) {
    const history = readJson(HISTORY_FILE);
    if (!history[id]) return false;
    delete history[id];
    writeJson(HISTORY_FILE, history);
    return true;
}

function clearHistory() {
    writeJson(HISTORY_FILE, {});
}

// ─── Userdata (watchlist + favourites) ───────────────────────────────────────
// Schema:
// userdata = {
//   watchlist:  { [id]: { id, name, poster, type, addedAt } },
//   favourites: { [id]: { id, name, poster, type, addedAt } },
// }

function getUserdata() {
    const d = readJson(USERDATA_FILE);
    if (!d.watchlist)  d.watchlist  = {};
    if (!d.favourites) d.favourites = {};
    return d;
}

// Watchlist
function addToWatchlist(id, data) {
    const ud = getUserdata();
    ud.watchlist[id] = { id, name: data.name, poster: data.poster || null,
                         type: data.type || "movie", addedAt: new Date().toISOString() };
    writeJson(USERDATA_FILE, ud);
    return ud.watchlist[id];
}

function removeFromWatchlist(id) {
    const ud = getUserdata();
    if (!ud.watchlist[id]) return false;
    delete ud.watchlist[id];
    writeJson(USERDATA_FILE, ud);
    return true;
}

// Favourites
function addToFavourites(id, data) {
    const ud = getUserdata();
    ud.favourites[id] = { id, name: data.name, poster: data.poster || null,
                          type: data.type || "movie", addedAt: new Date().toISOString() };
    writeJson(USERDATA_FILE, ud);
    return ud.favourites[id];
}

function removeFromFavourites(id) {
    const ud = getUserdata();
    if (!ud.favourites[id]) return false;
    delete ud.favourites[id];
    writeJson(USERDATA_FILE, ud);
    return true;
}

module.exports = {
    getHistory, getHistoryEntry, saveProgress, deleteHistoryEntry, clearHistory,
    getUserdata, addToWatchlist, removeFromWatchlist, addToFavourites, removeFromFavourites,
};
