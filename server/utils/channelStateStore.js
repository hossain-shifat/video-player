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
const { getActiveLive, writeActiveLive } = require("./iptvStore");

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

// "YYYY-MM-DD HH:MM:SS" — matches live.json's date field format
function nowStamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Rebuilds ActiveLive.json from the CURRENT active map — full channel
// details, grouped by .group same as live.json. This is the only thing
// that ever writes ActiveLive.json: source ingest/refresh/delete only ever
// touch live.json (mergeChannelsForSource/removeChannelsForSource in
// iptvStore.js), so deleting a source — even one that empties live.json
// entirely — can never wipe or shrink ActiveLive.json. It only changes when
// the admin explicitly activates/deactivates/edits/hides a channel here.
async function syncActiveLiveFile(state) {
    const grouped = {};
    for (const [id, snapshot] of Object.entries(state.active)) {
        if (state.hidden[id]) continue; // a hidden channel shouldn't linger as "active" either
        const ch = state.overrides[id] ? { ...snapshot, ...state.overrides[id] } : snapshot;
        const groupName = ch.group || "Other";
        if (!grouped[groupName]) grouped[groupName] = [];
        grouped[groupName].push(ch);
    }
    try {
        await writeActiveLive({ date: nowStamp(), channels: grouped });
    } catch (err) {
        console.error("[ChannelState] Failed to write ActiveLive.json:", err.message);
    }
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
    // Keep the original activatedAt if this channel was active before and
    // is being re-pinned — sort order shouldn't jump around on a toggle-off/on.
    const activatedAt = state.active[id]?.activatedAt || new Date().toISOString();
    state.active[id] = { ...channelSnapshot, id, activatedAt };
    writeJson(STATE_FILE, state);
    syncActiveLiveFile(state).catch(() => {});
    return state.active[id];
}

// Full CRUD update for an Active-tab entry — logo/category/name/country/
// group/url/anything. Deliberately separate from setOverride(): overrides
// are layered onto the MAIN channel list (applyChannelState) too, so reusing
// it here would leak Active-tab edits into the Channels tab / live.json-
// derived data. This only ever touches state.active[id] + active_live.json.
function updateActiveChannel(id, patch) {
    if (!isValidId(id)) throw new Error("Invalid channel id");
    const state = getState();
    if (!state.active[id]) return null; // not currently an Active channel
    const { id: _drop, activatedAt: _drop2, ...safePatch } = patch || {};
    state.active[id] = { ...state.active[id], ...safePatch };
    writeJson(STATE_FILE, state);
    syncActiveLiveFile(state).catch(() => {});
    return state.active[id];
}

function unsetActive(id) {
    if (!isValidId(id)) throw new Error("Invalid channel id");
    const state = getState();
    if (!Object.prototype.hasOwnProperty.call(state.active, id)) return null;
    const removed = state.active[id];
    delete state.active[id];
    writeJson(STATE_FILE, state);
    syncActiveLiveFile(state).catch(() => {});
    return removed;
}

function setOverride(id, patch) {
    if (!isValidId(id)) throw new Error("Invalid channel id");
    const state = getState();
    state.overrides[id] = { ...(state.overrides[id] || {}), ...patch };
    // Keep the Active-tab snapshot in sync if this channel is pinned
    if (state.active[id]) state.active[id] = { ...state.active[id], ...patch };
    writeJson(STATE_FILE, state);
    if (state.active[id]) syncActiveLiveFile(state).catch(() => {});
    return state.overrides[id];
}

function setHidden(id) {
    if (!isValidId(id)) throw new Error("Invalid channel id");
    const state = getState();
    state.hidden[id] = true;
    delete state.active[id]; // hiding also unpins it from Active
    writeJson(STATE_FILE, state);
    syncActiveLiveFile(state).catch(() => {});
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
    updateActiveChannel,
    setOverride,
    setHidden,
    unsetHidden,
    applyChannelState,
    isValidId,
};
