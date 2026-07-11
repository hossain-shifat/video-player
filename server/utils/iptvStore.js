"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "data");
const SOURCES_FILE = path.join(DATA_DIR, "iptv-sources.json");
const LIVE_FILE = path.join(DATA_DIR, "live.json");
const UPLOADS_DIR = path.join(DATA_DIR, "iptv-uploads");

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// "YYYY-MM-DD HH:MM:SS" — matches the live.json sample format
function nowStamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function readJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch (err) {
        if (err.code === "ENOENT") return fallback;
        throw err;
    }
}

async function atomicWrite(file, data) {
    const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
    const fd = await fs.promises.open(tmp, "w");
    try {
        await fd.writeFile(JSON.stringify(data, null, 2), "utf-8");
        await fd.sync();
    } finally {
        await fd.close();
    }
    await fs.promises.rename(tmp, file);
}

// Serialize writes per-file so concurrent saves never race
let sourcesQueue = Promise.resolve();
let liveQueue = Promise.resolve();

function writeSources(sources) {
    sourcesQueue = sourcesQueue.catch(() => {}).then(() => atomicWrite(SOURCES_FILE, sources));
    return sourcesQueue;
}

function writeLive(live) {
    liveQueue = liveQueue.catch(() => {}).then(() => atomicWrite(LIVE_FILE, live));
    return liveQueue;
}

// ─── Sources ─────────────────────────────────────────────────────────────────

function getSources() {
    return readJson(SOURCES_FILE, []);
}

async function saveSource(source) {
    const sources = getSources();
    sources.unshift(source);
    await writeSources(sources);
    return source;
}

async function updateSource(id, patch) {
    const sources = getSources();
    const idx = sources.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    sources[idx] = { ...sources[idx], ...patch };
    await writeSources(sources);
    return sources[idx];
}

async function deleteSource(id) {
    const sources = getSources();
    const target = sources.find((s) => s.id === id);
    if (!target) return null;
    await writeSources(sources.filter((s) => s.id !== id));

    // Clean up uploaded file on disk, if any. Deliberately never lets a
    // filesystem error here (locked file on Windows, already-deleted file,
    // permissions) propagate — the source record is already removed above,
    // so a cleanup failure should just be logged, never crash the request.
    if (target.type === "file" && target.filePath) {
        try {
            await fs.promises.unlink(target.filePath);
        } catch (err) {
            if (err.code !== "ENOENT") {
                console.warn(`[IPTV] Could not delete uploaded file ${target.filePath}: ${err.message}`);
            }
        }
    }
    return target;
}

function newSourceId() {
    return crypto.randomUUID();
}

// ─── live.json ───────────────────────────────────────────────────────────────

function getLive() {
    return readJson(LIVE_FILE, { date: nowStamp(), channels: {} });
}

// Replaces all channels belonging to one sourceId with a fresh batch,
// then rewrites live.json grouped by channel.group.
async function mergeChannelsForSource(sourceId, sourceLabel, channels) {
    const live = getLive();
    const grouped = live.channels || {};

    // Strip out this source's previous channels from every group
    for (const groupName of Object.keys(grouped)) {
        grouped[groupName] = grouped[groupName].filter((c) => c._sourceId !== sourceId);
        if (grouped[groupName].length === 0) delete grouped[groupName];
    }

    // Re-insert fresh channels, tagged with _sourceId for future refresh/delete
    for (const ch of channels) {
        const groupName = ch.group !== undefined && ch.group !== null ? ch.group : "Other";
        if (!grouped[groupName]) grouped[groupName] = [];
        grouped[groupName].push({ ...ch, _sourceId: sourceId, _sourceLabel: sourceLabel });
    }

    const next = { date: nowStamp(), channels: grouped };
    await writeLive(next);
    return next;
}

async function removeChannelsForSource(sourceId) {
    const live = getLive();
    const grouped = live.channels || {};
    for (const groupName of Object.keys(grouped)) {
        grouped[groupName] = grouped[groupName].filter((c) => c._sourceId !== sourceId);
        if (grouped[groupName].length === 0) delete grouped[groupName];
    }
    const next = { date: nowStamp(), channels: grouped };
    await writeLive(next);
    return next;
}

// Public-facing live.json — strips internal _sourceId/_sourceLabel bookkeeping
// Public-facing live.json — strict 5-field shape, matching the original
// reference structure exactly: { name, logo, group, source, url }. Anything
// consuming /api/live/channels (the player, external tooling) should never
// see internal bookkeeping OR the dashboard-only enrichment fields.
function getPublicLive() {
    const live = getLive();
    const channels = {};
    for (const [group, list] of Object.entries(live.channels || {})) {
        channels[group] = list.map((c) => ({
            name: c.name,
            logo: c.logo,
            group: c.group,
            source: c.source,
            url: c.url,
        }));
    }
    return { date: live.date, channels };
}

// Same as getPublicLive but keeps the dashboard-enrichment fields
// (country, category, tvgId, etc). Used only by the admin "Channel" tab —
// never exposed on the player-facing route.
function getPublicLiveRich() {
    const live = getLive();
    const channels = {};
    for (const [group, list] of Object.entries(live.channels || {})) {
        channels[group] = list.map(({ _sourceId, _sourceLabel, ...rest }) => rest);
    }
    return { date: live.date, channels };
}

module.exports = {
    UPLOADS_DIR,
    newSourceId,
    getSources,
    saveSource,
    updateSource,
    deleteSource,
    getLive,
    writeLive,
    getPublicLive,
    getPublicLiveRich,
    mergeChannelsForSource,
    removeChannelsForSource,
};
