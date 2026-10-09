"use strict";

/**
 * utils/watchTimeStore.js — Watch Time data (data/watchtime.json)
 *
 * Fully separate from history.json: Continue Watching / history deletes never
 * touch it, and every second you actually watch is counted — finished or not.
 * (history.json is read ONCE per account, only to import what you watched
 *  before this feature existed.)
 *
 *   { "<userId>": {
 *       email, backfillV, totalSeconds,
 *       byType: { movie, series, anime }          // seconds per content type
 *       hours:  [24 numbers]                      // seconds per hour of day
 *       daily:  { "YYYY-MM-DD": { seconds, completed } },
 *       titles: [ { id, mediaType, title, poster, seasonNumber, episodeNumber,
 *                   seriesTitle, duration, watchedSeconds, watchCount,
 *                   firstWatchedAt, lastWatchedAt, runCounted } ]
 *   } }
 *
 * Rules
 *   - seconds watched = forward playback between two progress beats (seeks ignored)
 *   - a title is FINISHED when playback passes 90% of its duration
 *   - the next run re-arms once position drops below 10% → a replay adds +1 watchCount
 */

const fs = require("fs");
const path = require("path");
const { readJson, writeJson, getHistory } = require("./userStore");

const WATCHTIME_FILE = path.join(__dirname, "../data/watchtime.json");
const COMPLETE_RATIO = 0.9;
const REARM_RATIO = 0.1;
const SERIES_DAYS = 180;
const BACKFILL_VERSION = 2;

// ── cached file with debounced writes ───────────────────────────────────────
let _wt = null;
let _wtStat = null;
let _dirty = false;
let _timer = null;
const _lastBeat = new Map(); // "uid|mediaId" → { pos, t }

function statFile() {
    try {
        const st = fs.statSync(WATCHTIME_FILE);
        return { mtimeMs: st.mtimeMs, size: st.size };
    } catch {
        return null;
    }
}

function load() {
    if (_wt && _dirty) return _wt; // unsaved changes win
    const st = statFile();
    if (_wt && ((!st && !_wtStat) || (st && _wtStat && st.mtimeMs === _wtStat.mtimeMs && st.size === _wtStat.size))) return _wt;
    _wt = readJson(WATCHTIME_FILE); // {} when missing — deleting the file resets cleanly
    _wtStat = st;
    return _wt;
}

function flush() {
    if (_timer) {
        clearTimeout(_timer);
        _timer = null;
    }
    if (!_dirty || !_wt) return;
    writeJson(WATCHTIME_FILE, _wt);
    _dirty = false;
    _wtStat = statFile();
}

// beats arrive every ~4s — debounce disk writes; finishes flush at once
function markDirty(immediate) {
    _dirty = true;
    if (immediate) return flush();
    if (!_timer) {
        _timer = setTimeout(flush, 3000);
        if (_timer.unref) _timer.unref();
    }
}

process.once("exit", () => {
    try {
        flush();
    } catch {
        /* nothing more to do on exit */
    }
});

// ── helpers ─────────────────────────────────────────────────────────────────
function typeKey(mediaType) {
    return mediaType === "anime" ? "anime" : mediaType === "series" ? "series" : "movie";
}

function dayKey(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayOf(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d, 12, 0, 0); // noon — immune to DST shifts
}

function block(wt, uid, email) {
    if (!Object.prototype.hasOwnProperty.call(wt, uid) || !wt[uid] || typeof wt[uid] !== "object") {
        wt[uid] = { email: null, backfillV: 0, totalSeconds: 0, byType: {}, hours: [], daily: {}, titles: [] };
    }
    const b = wt[uid];
    if (!b.daily || typeof b.daily !== "object") b.daily = {};
    if (!Array.isArray(b.titles)) b.titles = [];
    if (typeof b.totalSeconds !== "number") b.totalSeconds = 0;
    b.byType = { movie: 0, series: 0, anime: 0, ...(b.byType || {}) };
    if (!Array.isArray(b.hours) || b.hours.length !== 24) b.hours = Array(24).fill(0);
    if (typeof b.backfillV !== "number") b.backfillV = b.backfilled ? 1 : 0; // v1 files used a boolean
    if (email) b.email = email;
    return b;
}

function bumpDay(b, key, seconds, completed) {
    const d = b.daily[key] || (b.daily[key] = { seconds: 0, completed: 0 });
    d.seconds += seconds;
    d.completed += completed;
}

function applyMeta(t, meta) {
    for (const k of ["mediaType", "title", "poster", "seasonNumber", "episodeNumber", "seriesTitle"]) {
        if (meta[k] !== undefined && meta[k] !== null && meta[k] !== "") t[k] = meta[k];
    }
}

function ensureTitle(b, id, meta, duration, iso) {
    let t = b.titles.find((x) => x.id === id);
    if (!t) {
        t = { id, duration: duration > 60 ? duration : 0, watchedSeconds: 0, watchCount: 0, firstWatchedAt: iso, lastWatchedAt: iso, runCounted: false };
        b.titles.push(t);
    }
    applyMeta(t, meta);
    if (duration > 60) t.duration = Math.max(t.duration || 0, duration);
    return t;
}

// ── tracking ────────────────────────────────────────────────────────────────
/**
 * trackWatch — called for every progress beat from the player.
 * @returns {{counted:boolean, rearmed:boolean}}
 */
function trackWatch(userId, email, id, meta, position, duration) {
    const out = { counted: false, rearmed: false };
    if (typeof position !== "number" || !Number.isFinite(position) || position < 0) return out;
    duration = Number.isFinite(duration) ? duration : 0;

    const uid = String(userId);
    const b = block(load(), uid, email);
    const nowMs = Date.now();
    const now = new Date(nowMs);
    const iso = now.toISOString();
    let dirty = false;

    // ── seconds actually watched since the previous beat ──────────────────
    const key = `${uid}|${id}`;
    const last = _lastBeat.get(key);
    _lastBeat.set(key, { pos: position, t: nowMs });
    if (_lastBeat.size > 2000) _lastBeat.delete(_lastBeat.keys().next().value);

    if (last) {
        const wall = (nowMs - last.t) / 1000;
        const delta = position - last.pos;
        // forward playback only; a seek is a delta far larger than wall time allows at ≤2x speed
        if (wall <= 30 && delta > 0 && delta <= Math.max(10, wall * 2.5 + 1)) {
            const t = ensureTitle(b, id, meta, duration, iso);
            t.watchedSeconds = (t.watchedSeconds || 0) + delta;
            t.lastWatchedAt = iso;
            bumpDay(b, dayKey(now), delta, 0);
            b.totalSeconds += delta;
            b.byType[typeKey(t.mediaType)] += delta;
            b.hours[now.getHours()] += delta;
            dirty = true;
        }
    }

    // ── finish / re-arm ───────────────────────────────────────────────────
    const ratio = duration > 0 ? position / duration : 0;
    let t = b.titles.find((x) => x.id === id);

    if (t && t.runCounted && ratio < REARM_RATIO) {
        t.runCounted = false;
        out.rearmed = true;
        dirty = true;
    } else if (duration > 60 && ratio >= COMPLETE_RATIO && (!t || !t.runCounted)) {
        t = ensureTitle(b, id, meta, duration, iso);
        t.watchCount = (t.watchCount || 0) + 1;
        t.runCounted = true;
        t.lastWatchedAt = iso;
        bumpDay(b, dayKey(now), 0, 1);
        out.counted = true;
        dirty = true;
    }

    if (dirty) markDirty(out.counted);
    return out;
}

// ── one-time import of what you watched before Watch Time existed ───────────
function backfill(b, userId) {
    let entries = [];
    try {
        entries = Object.values(getHistory(userId));
    } catch {
        /* no history yet */
    }
    for (const e of entries) {
        if (!e || !e.id || b.titles.some((x) => x.id === e.id)) continue;
        const done = !!e.completed && e.duration > 60;
        const partial = Math.min(e.maxPositionReached || 0, e.duration || Infinity);
        if (!done && partial < 10) continue;
        const seconds = done ? e.duration : partial;
        const iso = e.watchedAt || new Date().toISOString();
        const t = { id: e.id, duration: e.duration > 60 ? e.duration : 0, watchedSeconds: seconds, watchCount: done ? 1 : 0, firstWatchedAt: iso, lastWatchedAt: iso, runCounted: done };
        applyMeta(t, {
            mediaType: e.mediaType || e.type || "movie",
            title: e.title || e.name || "",
            poster: e.poster || null,
            seasonNumber: e.seasonNumber ?? null,
            episodeNumber: e.episodeNumber ?? null,
            seriesTitle: e.seriesTitle ?? e.episodeTitle ?? null,
        });
        b.titles.push(t);
        b.totalSeconds += seconds;
        b.byType[typeKey(t.mediaType)] += seconds;
        bumpDay(b, dayKey(new Date(iso)), seconds, done ? 1 : 0);
    }
    b.backfillV = BACKFILL_VERSION;
    markDirty(true);
}

// ── read model for the page ─────────────────────────────────────────────────
function getWatchTime(userId, email) {
    const uid = String(userId);
    const b = block(load(), uid, email);
    if (b.backfillV < BACKFILL_VERSION) backfill(b, uid);

    const today = new Date();
    const todayKey = dayKey(today);

    const series = [];
    for (let i = SERIES_DAYS - 1; i >= 0; i--) {
        const k = dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - i, 12, 0, 0));
        const v = b.daily[k];
        series.push({ date: k, seconds: Math.round(v?.seconds || 0), completed: v?.completed || 0 });
    }

    // active day = ≥1 min watched or ≥1 finish
    const activeKeys = Object.keys(b.daily)
        .filter((k) => (b.daily[k].seconds || 0) >= 60 || (b.daily[k].completed || 0) > 0)
        .sort();
    const activeSet = new Set(activeKeys);

    let longest = 0;
    let run = 0;
    let prev = null;
    for (const k of activeKeys) {
        run = prev && Math.round((dayOf(k) - dayOf(prev)) / 86400000) === 1 ? run + 1 : 1;
        if (run > longest) longest = run;
        prev = k;
    }

    // current streak — an empty today doesn't break yesterday's streak
    let current = 0;
    const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 0, 0);
    if (!activeSet.has(todayKey)) cursor.setDate(cursor.getDate() - 1);
    while (activeSet.has(dayKey(cursor))) {
        current++;
        cursor.setDate(cursor.getDate() - 1);
    }

    const best = series.reduce((a, d) => (d.seconds > a.seconds ? d : a), { date: null, seconds: 0 });

    const titles = b.titles
        .map((t) => {
            const watchCount = t.watchCount || 0;
            const duration = t.duration || 0;
            return {
                id: t.id,
                mediaType: t.mediaType || "movie",
                title: t.title || "",
                poster: t.poster || null,
                seasonNumber: t.seasonNumber ?? null,
                episodeNumber: t.episodeNumber ?? null,
                seriesTitle: t.seriesTitle ?? null,
                duration,
                // v1 records predate per-title seconds — a finished title implies at least one full run
                watchedSeconds: Math.round(t.watchedSeconds ?? watchCount * duration),
                watchCount,
                firstWatchedAt: t.firstWatchedAt,
                lastWatchedAt: t.lastWatchedAt,
            };
        })
        .sort((a, b2) => new Date(b2.lastWatchedAt) - new Date(a.lastWatchedAt));

    return {
        stats: {
            totalSeconds: Math.round(b.totalSeconds),
            totalTitles: titles.length,
            finishedTitles: titles.filter((t) => t.watchCount > 0).length,
            totalWatches: titles.reduce((a, t) => a + t.watchCount, 0),
            currentStreak: current,
            longestStreak: longest,
            activeDays: activeKeys.length,
            bestDay: best.seconds > 0 ? best : null,
        },
        byType: Object.fromEntries(Object.entries(b.byType).map(([k, v]) => [k, Math.round(v)])),
        hours: b.hours.map((v) => Math.round(v)),
        series,
        titles,
        today: todayKey,
    };
}

module.exports = { trackWatch, getWatchTime };
