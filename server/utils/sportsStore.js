"use strict";

/**
 * sportsStore.js — Sports Event Storage
 *
 * Keeps sports events entirely separate from EPG programme data.
 * Storage: server/data/sports/ (JSON files, no DB dependency).
 *
 * Files:
 *   sports-events.json     — all normalized events (live + today + upcoming)
 *   sports-meta.json       — last refresh timestamps per bucket
 *
 * In-memory caches are the primary read path; files are persistence across
 * server restarts only.
 */

const fs   = require("fs");
const path = require("path");

const DATA_DIR    = path.join(__dirname, "..", "data");
const SPORTS_DIR  = path.join(DATA_DIR, "sports");
const EVENTS_FILE = path.join(SPORTS_DIR, "sports-events.json");
const META_FILE   = path.join(SPORTS_DIR, "sports-meta.json");

// Ensure dir exists
if (!fs.existsSync(SPORTS_DIR)) fs.mkdirSync(SPORTS_DIR, { recursive: true });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, "utf-8")); }
    catch (e) { if (e.code === "ENOENT") return fallback; throw e; }
}

function writeJsonSync(file, data) {
    const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmp, file);
}

// ─── In-memory state ──────────────────────────────────────────────────────────

let _live     = [];   // NormalizedEvent[] — status === "live"
let _today    = [];   // NormalizedEvent[] — today (all statuses)
let _upcoming = [];   // NormalizedEvent[] — status === "upcoming"
let _loaded   = false;

function _loadFromDisk() {
    if (_loaded) return;
    _loaded = true;
    const data = readJson(EVENTS_FILE, { live: [], today: [], upcoming: [] });
    _live     = data.live     || [];
    _today    = data.today    || [];
    _upcoming = data.upcoming || [];
}

function _persist() {
    writeJsonSync(EVENTS_FILE, {
        live: _live, today: _today, upcoming: _upcoming,
        updatedAt: new Date().toISOString(),
    });
}

// ─── Writers ──────────────────────────────────────────────────────────────────

function setLiveEvents(events) {
    _loadFromDisk();
    _live = Array.isArray(events) ? events : [];
    _persist();
}

function setTodayEvents(events) {
    _loadFromDisk();
    _today = Array.isArray(events) ? events : [];
    _persist();
}

function setUpcomingEvents(events) {
    _loadFromDisk();
    _upcoming = Array.isArray(events) ? events : [];
    _persist();
}

// Merge live into today bucket (live events also appear in today)
function mergeLiveIntoToday() {
    const liveIds = new Set(_live.map((e) => e.id));
    const todayWithoutLive = _today.filter((e) => !liveIds.has(e.id));
    _today = [..._live, ...todayWithoutLive].sort((a, b) =>
        (a.kickoff || "").localeCompare(b.kickoff || "")
    );
}

// ─── Readers ──────────────────────────────────────────────────────────────────

function getLiveEvents()     { _loadFromDisk(); return [..._live];     }
function getTodayEvents()    { _loadFromDisk(); return [..._today];    }
function getUpcomingEvents() { _loadFromDisk(); return [..._upcoming]; }

function getEventById(id) {
    _loadFromDisk();
    return [..._live, ..._today, ..._upcoming].find((e) => e.id === id) || null;
}

/** All events across all buckets, deduped by id */
function getAllEvents() {
    _loadFromDisk();
    const seen = new Set();
    return [..._live, ..._today, ..._upcoming].filter((e) => {
        if (seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
    });
}

// ─── Meta ─────────────────────────────────────────────────────────────────────

function getMeta() {
    return readJson(META_FILE, {
        lastLiveRefresh: null,
        lastTodayRefresh: null,
        lastUpcomingRefresh: null,
    });
}

function setMeta(patch) {
    const meta = { ...getMeta(), ...patch, updatedAt: new Date().toISOString() };
    writeJsonSync(META_FILE, meta);
}

// ─── Invalidate in-memory cache (call after bulk writes) ─────────────────────

function invalidate() {
    _live = []; _today = []; _upcoming = [];
    _loaded = false;
}

module.exports = {
    // Writers
    setLiveEvents, setTodayEvents, setUpcomingEvents, mergeLiveIntoToday,
    // Readers
    getLiveEvents, getTodayEvents, getUpcomingEvents, getEventById, getAllEvents,
    // Meta
    getMeta, setMeta,
    // Cache control
    invalidate,
};
