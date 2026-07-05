"use strict";

/**
 * channelStateStore.js — per-channel admin curation state
 *
 * Channels themselves are never stored here (they're derived from parsed
 * playlist files, per the "folders/files act as the database" pattern).
 * This store only holds the SMALL admin overlay on top of that:
 *
 *   active:    { [channelId]: channelSnapshot }  — pinned to the Active tab
 *   overrides: { [channelId]: { name?, category?, country? } } — local edits,
 *              re-applied on top of freshly parsed channels every read
 *   hidden:    { [channelId]: true }              — "deleted" channels
 *
 * channelId = the same base64url(url) id every /api/live/channels* endpoint
 * already uses, so this survives source re-ingestion (same url → same id).
 *
 * Same atomic-write + corrupt-file-recovery pattern as userStore.js.
 */

const fs = require("fs");
const path = require("path");

const STATE_FILE = path.join(__dirname, "..", "data", "channel-state.json");

const VALID_ID_RE = /^[A-Za-z0-9_=-]+$/;
function isValidId(id) {
    return typeof id === "string" && id.length > 0 && id.length < 512 && VALID_ID_RE.test(id);
}

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
        console.error(`[ChannelState] Corrupt JSON in ${file} — backing up and resetting. Error: ${err.message}`);
        try {
            fs.copyFileSync(file, `${file}.corrupt.${Date.now()}.bak`);
        } catch (backupErr) {
            console.error(`[ChannelState] Could not back up corrupt file: ${backupErr.message}`);
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

function getState() {
    const raw = readJson(STATE_FILE);
    return {
        active: raw.active && typeof raw.active === "object" ? raw.active : {},
        overrides: raw.overrides && typeof raw.overrides === "object" ? raw.overrides : {},
        hidden: raw.hidden && typeof raw.hidden === "object" ? raw.hidden : {},
    };
}

function setActive(id, channelSnapshot) {
    if (!isValidId(id)) throw new Error("Invalid channel id");
    const state = getState();
    state.active[id] = { ...channelSnapshot, id };
    writeJson(STATE_FILE, state);
    return state.active[id];
}

function unsetActive(id) {
    if (!isValidId(id)) throw new Error("Invalid channel id");
    const state = getState();
    if (!Object.prototype.hasOwnProperty.call(state.active, id)) return false;
    delete state.active[id];
    writeJson(STATE_FILE, state);
    return true;
}

function setOverride(id, patch) {
    if (!isValidId(id)) throw new Error("Invalid channel id");
    const state = getState();
    state.overrides[id] = { ...(state.overrides[id] || {}), ...patch };
    // Keep the Active-tab snapshot in sync if this channel is pinned
    if (state.active[id]) state.active[id] = { ...state.active[id], ...patch };
    writeJson(STATE_FILE, state);
    return state.overrides[id];
}

function setHidden(id) {
    if (!isValidId(id)) throw new Error("Invalid channel id");
    const state = getState();
    state.hidden[id] = true;
    delete state.active[id]; // hiding also unpins it from Active
    writeJson(STATE_FILE, state);
    return true;
}

function unsetHidden(id) {
    if (!isValidId(id)) throw new Error("Invalid channel id");
    const state = getState();
    if (!Object.prototype.hasOwnProperty.call(state.hidden, id)) return false;
    delete state.hidden[id];
    writeJson(STATE_FILE, state);
    return true;
}

// Applies overrides + hidden filter to a flat channel row list.
// Called by liveController after buildFlatRows() so every read (player-
// facing /channels AND admin /channels/flat) reflects the same state.
function applyChannelState(rows) {
    const { overrides, hidden } = getState();
    const out = [];
    for (const row of rows) {
        if (hidden[row.id]) continue;
        out.push(overrides[row.id] ? { ...row, ...overrides[row.id] } : row);
    }
    return out;
}

module.exports = {
    getState,
    setActive,
    unsetActive,
    setOverride,
    setHidden,
    unsetHidden,
    applyChannelState,
    isValidId,
};
