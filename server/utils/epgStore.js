"use strict";

/**
 * epgStore.js — Programme Database
 *
 * Stores EPG data as a set of JSON files in server/data/epg/:
 *   epg-sources.json   — registered EPG provider configs
 *   epg-programmes/    — one file per channelId: <channelId>.json
 *   epg-channels.json  — channel metadata from EPG (logos, names, ids)
 *   epg-meta.json      — last refresh time, source stats, match stats
 *
 * Design: programmes are stored per-channel so reads for a single channel
 * are O(1) file reads rather than scanning a massive single file.
 * For 10 000+ channels this scales much better than a single blob.
 */

const fs   = require("fs");
const path = require("path");

const DATA_DIR   = path.join(__dirname, "..", "data");
const EPG_DIR    = path.join(DATA_DIR, "epg");
const PROG_DIR   = path.join(EPG_DIR, "programmes");
const SOURCES_F  = path.join(EPG_DIR, "epg-sources.json");
const CHANNELS_F = path.join(EPG_DIR, "epg-channels.json");
const META_F     = path.join(EPG_DIR, "epg-meta.json");

// Ensure directories exist on first require
for (const d of [EPG_DIR, PROG_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, "utf-8")); }
    catch (e) { if (e.code === "ENOENT") return fallback; throw e; }
}

function writeJsonSync(file, data) {
    const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmp, file);
}

async function writeJsonAsync(file, data) {
    const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
    const fd  = await fs.promises.open(tmp, "w");
    try {
        await fd.writeFile(JSON.stringify(data, null, 2), "utf-8");
        await fd.sync();
    } finally { await fd.close(); }
    await fs.promises.rename(tmp, file);
}

// Safe filename from channelId (strip path chars)
function channelFile(channelId) {
    const safe = String(channelId).replace(/[^a-zA-Z0-9_\-\.]/g, "_").slice(0, 200);
    return path.join(PROG_DIR, `${safe}.json`);
}

// ─── EPG Source registry ──────────────────────────────────────────────────────

function getSources() { return readJson(SOURCES_F, []); }

function saveSource(src) {
    const sources = getSources();
    const idx = sources.findIndex((s) => s.id === src.id);
    if (idx === -1) sources.push(src);
    else sources[idx] = src;
    writeJsonSync(SOURCES_F, sources);
    return src;
}

function deleteSource(id) {
    const sources = getSources().filter((s) => s.id !== id);
    writeJsonSync(SOURCES_F, sources);
}

function updateSource(id, patch) {
    const sources = getSources();
    const idx = sources.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    sources[idx] = { ...sources[idx], ...patch };
    writeJsonSync(SOURCES_F, sources);
    return sources[idx];
}

// ─── EPG Channel registry (from parsed XMLTV) ─────────────────────────────────
// { [xmltvChannelId]: { id, name, logo, language, ... } }

let _chCache = null;

function getEpgChannels() {
    if (!_chCache) _chCache = readJson(CHANNELS_F, {});
    return _chCache;
}

function setEpgChannels(channelsMap) {
    _chCache = channelsMap;
    writeJsonSync(CHANNELS_F, channelsMap);
}

// ─── Programme storage ────────────────────────────────────────────────────────

/**
 * Write all programmes for a channel.
 * programmes: Array<{ title, subtitle, desc, category, start, end, icon, episode, rating, provider }>
 */
async function setChannelProgrammes(channelId, programmes) {
    await writeJsonAsync(channelFile(channelId), {
        channelId,
        updatedAt: new Date().toISOString(),
        programmes,
    });
}

/**
 * Read all programmes for a channel (sorted by start time).
 */
function getChannelProgrammes(channelId) {
    const data = readJson(channelFile(channelId), null);
    if (!data) return [];
    return (data.programmes || []).sort((a, b) => a.start - b.start);
}

/**
 * Merge new programmes into existing ones for a channel.
 * Deduplicates on start+title, lets higher-priority provider overwrite.
 * priority: lower number = higher priority (wins on conflict).
 */
async function mergeChannelProgrammes(channelId, newProgs, priority = 99) {
    const existing = getChannelProgrammes(channelId);
    const map = new Map();

    // Load existing into map keyed by start time
    for (const p of existing) map.set(p.start, p);

    // Merge new: overwrite if new has higher or equal priority
    for (const p of newProgs) {
        const old = map.get(p.start);
        if (!old || (p.priority ?? 99) <= (old.priority ?? 99)) {
            map.set(p.start, { ...p, priority });
        }
    }

    const merged = [...map.values()].sort((a, b) => a.start - b.start);
    await setChannelProgrammes(channelId, merged);
    return merged.length;
}

/**
 * Delete all programme files (full reset).
 */
function clearAllProgrammes() {
    for (const f of fs.readdirSync(PROG_DIR)) {
        if (f.endsWith(".json")) fs.unlinkSync(path.join(PROG_DIR, f));
    }
    _chCache = null;
}

/**
 * Delete programme files for channels from one provider.
 */
async function clearProgrammesForSource(sourceId) {
    // No way to know per-file which source wrote it without scanning —
    // scan and filter by provider field.
    for (const f of fs.readdirSync(PROG_DIR)) {
        if (!f.endsWith(".json")) continue;
        const fp = path.join(PROG_DIR, f);
        try {
            const data = JSON.parse(fs.readFileSync(fp, "utf-8"));
            const filtered = (data.programmes || []).filter((p) => p.provider !== sourceId);
            if (filtered.length !== (data.programmes || []).length) {
                await writeJsonAsync(fp, { ...data, programmes: filtered });
            }
        } catch { /* skip corrupt */ }
    }
}

// ─── Meta / stats ─────────────────────────────────────────────────────────────

function getMeta() { return readJson(META_F, { sources: {}, lastFullRefresh: null, totalProgrammes: 0, matchedChannels: 0 }); }

function setMeta(patch) {
    const meta = { ...getMeta(), ...patch, updatedAt: new Date().toISOString() };
    writeJsonSync(META_F, meta);
    return meta;
}

// ─── Current programme resolver ───────────────────────────────────────────────

/**
 * Returns { now, next, upcoming[] } for a channel at a given Unix ms timestamp.
 */
function resolveNow(channelId, atMs = Date.now()) {
    const progs = getChannelProgrammes(channelId);
    if (!progs.length) return { now: null, next: null, upcoming: [] };

    let nowIdx = -1;
    for (let i = 0; i < progs.length; i++) {
        const p = progs[i];
        if (p.start <= atMs && atMs < p.end) { nowIdx = i; break; }
    }

    const nowProg    = nowIdx !== -1 ? progs[nowIdx]     : null;
    const nextProg   = nowIdx !== -1 ? progs[nowIdx + 1] ?? null : progs.find((p) => p.start > atMs) ?? null;
    const upcoming   = progs.filter((p) => p.start > atMs).slice(0, 10);

    return { now: nowProg, next: nextProg, upcoming };
}

/**
 * Returns programmes for a channel within a time window [fromMs, toMs].
 */
function getSchedule(channelId, fromMs, toMs) {
    return getChannelProgrammes(channelId).filter((p) => p.end > fromMs && p.start < toMs);
}

/**
 * Returns list of channelIds that have programme data.
 */
function getIndexedChannelIds() {
    return fs.readdirSync(PROG_DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.slice(0, -5).replace(/_/g, (m, offset, str) => {
            // Best-effort reverse of the safe-filename transform — not perfect
            // but good enough for listing; real lookups use the channelId directly.
            return m;
        }));
}

module.exports = {
    // Sources
    getSources, saveSource, deleteSource, updateSource,
    // Channels
    getEpgChannels, setEpgChannels,
    // Programmes
    setChannelProgrammes, getChannelProgrammes,
    mergeChannelProgrammes, clearAllProgrammes, clearProgrammesForSource,
    // Resolver
    resolveNow, getSchedule, getIndexedChannelIds,
    // Meta
    getMeta, setMeta,
    // Paths (for scheduler)
    EPG_DIR, PROG_DIR,
};
