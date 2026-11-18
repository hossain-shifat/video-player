"use strict";

/**
 * routes/admin/adminAnalytics.js
 * Read-only analytics for the admin Overview page.
 *
 *   GET /api/admin-dashboard/analytics        heavy aggregates   (cached 60 s)
 *   GET /api/admin-dashboard/analytics/live   "right now" data   (cached 5 s)
 *
 * Mounted from adminDashboard.js, so it inherits the JWT + approved + admin guard.
 *
 * Safety rules for this file:
 *   - Never writes to any existing store. Reads data/users/watchtime.json directly (read-only).
 *   - Every section is guarded: a failure in one section returns null for that section only.
 *   - Optional modules are loaded lazily with try/catch, so a missing module can never stop the server booting.
 *   - Only side effect: data/admin/storage-history.json (one small write per day, atomic, errors ignored).
 */

const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();
const prisma = require("../../auth/prismaClient");

const DATA_DIR = path.join(__dirname, "../../data");
const WATCH_FILE = path.join(DATA_DIR, "users", "watchtime.json");
const HISTORY_FILE = path.join(DATA_DIR, "admin", "storage-history.json");
const DAY_MS = 86400000;
const WATCHING_NOW_SEC = 90; // a title counts as "playing now" if its last beat is newer than this

// ─── tiny helpers ─────────────────────────────────────────────────────────────

const _warned = new Set();
function tryRequire(p) {
    try {
        return require(p);
    } catch (err) {
        if (!_warned.has(p)) {
            _warned.add(p); // log once per module, not on every poll
            console.warn(`[Analytics] optional module ${p} unavailable: ${err.message}`);
        }
        return null;
    }
}

const pad = (n) => String(n).padStart(2, "0");
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const round1 = (v) => Math.round(v * 10) / 10;
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgo = (n, from = new Date()) => new Date(from.getFullYear(), from.getMonth(), from.getDate() - n, 12, 0, 0);

function dayOf(key) {
    const [y, m, d] = String(key).split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0);
}

async function guard(name, fn) {
    try {
        return await fn();
    } catch (err) {
        console.warn(`[Analytics] section "${name}" failed: ${err && err.message}`);
        return null;
    }
}

async function soft(promise, fallback) {
    try {
        return await promise;
    } catch {
        return fallback;
    }
}

function cached(ttl, build) {
    let at = 0;
    let value = null;
    let inflight = null;
    return async () => {
        if (value && Date.now() - at < ttl) return value;
        if (inflight) return inflight;
        inflight = Promise.resolve()
            .then(build)
            .then((v) => {
                value = v;
                at = Date.now();
                return v;
            })
            .finally(() => {
                inflight = null;
            });
        return inflight;
    };
}

// ─── watch-time file (read-only, signature-cached) ────────────────────────────

let _wtCache = { sig: "", data: {} };
function readWatch() {
    try {
        const st = fs.statSync(WATCH_FILE);
        const sig = `${st.mtimeMs}:${st.size}`;
        if (sig === _wtCache.sig) return _wtCache.data;
        const raw = fs.readFileSync(WATCH_FILE, "utf-8");
        const parsed = raw && raw.trim() ? JSON.parse(raw) : {};
        _wtCache = { sig, data: parsed && typeof parsed === "object" ? parsed : {} };
        return _wtCache.data;
    } catch {
        return {}; // missing or half-written file → no data, never throws
    }
}

// ─── watch aggregation ────────────────────────────────────────────────────────

function aggregateWatch(wt, now) {
    const perDay = new Map(); // key → { seconds, completed }
    const activeByDay = new Map(); // key → Set(uid)
    const hours = Array(24).fill(0);
    const byType = { movie: 0, series: 0, anime: 0 };
    const users = [];
    let totalSeconds = 0;

    for (const uid of Object.keys(wt)) {
        const b = wt[uid];
        if (!b || typeof b !== "object") continue;
        const daily = b.daily && typeof b.daily === "object" ? b.daily : {};
        for (const key of Object.keys(daily)) {
            const v = daily[key] || {};
            const s = num(v.seconds);
            const c = num(v.completed);
            const d = perDay.get(key) || { seconds: 0, completed: 0 };
            d.seconds += s;
            d.completed += c;
            perDay.set(key, d);
            if (s >= 60 || c > 0) {
                if (!activeByDay.has(key)) activeByDay.set(key, new Set());
                activeByDay.get(key).add(uid);
            }
        }
        if (Array.isArray(b.hours)) b.hours.slice(0, 24).forEach((v, i) => (hours[i] += num(v)));
        if (b.byType && typeof b.byType === "object") for (const k of ["movie", "series", "anime"]) byType[k] += num(b.byType[k]);
        totalSeconds += num(b.totalSeconds);
        users.push({ uid, daily, titles: Array.isArray(b.titles) ? b.titles.filter((t) => t && typeof t === "object") : [] });
    }
    return { now, todayKey: dayKey(now), perDay, activeByDay, hours, byType, users, totalSeconds };
}

function rangeSeries(agg, n) {
    const dates = [];
    const values = [];
    const prev = [];
    for (let i = n - 1; i >= 0; i--) {
        const k = dayKey(daysAgo(i, agg.now));
        const kp = dayKey(daysAgo(i + n, agg.now));
        dates.push(k);
        values.push(round1(num(agg.perDay.get(k) && agg.perDay.get(k).seconds) / 3600));
        prev.push(round1(num(agg.perDay.get(kp) && agg.perDay.get(kp).seconds) / 3600));
    }
    return { dates, values, prev };
}

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function weekdayStats(agg) {
    const from = dayKey(daysAgo(179, agg.now));
    const seconds = Array(7).fill(0);
    const finishes = Array(7).fill(0);
    for (const [key, v] of agg.perDay) {
        if (key < from || key > agg.todayKey) continue;
        const idx = (dayOf(key).getDay() + 6) % 7;
        seconds[idx] += v.seconds;
        finishes[idx] += v.completed;
    }
    return { labels: WEEK, hours: seconds.map((s) => round1(s / 3600)), finishes };
}

function calendarStats(agg) {
    const out = [];
    for (let i = 181; i >= 0; i--) {
        const k = dayKey(daysAgo(i, agg.now));
        const d = agg.perDay.get(k);
        out.push({ date: k, hours: round1(num(d && d.seconds) / 3600), users: agg.activeByDay.has(k) ? agg.activeByDay.get(k).size : 0 });
    }
    return out;
}

function unionActive(agg, from, to) {
    const s = new Set();
    for (let i = from; i <= to; i++) {
        const a = agg.activeByDay.get(dayKey(daysAgo(i, agg.now)));
        if (a) a.forEach((u) => s.add(u));
    }
    return s;
}

function watchedSecondsOf(t) {
    return num(t.watchedSeconds) || num(t.watchCount) * num(t.duration);
}

function engagementStats(agg) {
    const today = unionActive(agg, 0, 0);
    const week = unionActive(agg, 0, 6);
    const prevWeek = unionActive(agg, 7, 13);
    const month = unionActive(agg, 0, 29);
    let retained = 0;
    prevWeek.forEach((u) => week.has(u) && retained++);

    let weekSeconds = 0;
    for (let i = 0; i <= 6; i++) weekSeconds += num(agg.perDay.get(dayKey(daysAgo(i, agg.now))) && agg.perDay.get(dayKey(daysAgo(i, agg.now))).seconds);

    let started = 0;
    let finished = 0;
    let rewatched = 0;
    let plays = 0;
    for (const u of agg.users) {
        for (const t of u.titles) {
            const wc = num(t.watchCount);
            if (watchedSecondsOf(t) >= 60 || wc > 0) started++;
            if (wc > 0) finished++;
            if (wc >= 2) rewatched++;
            plays += wc;
        }
    }
    const totalHours = agg.hours.reduce((a, b) => a + b, 0);
    const night = agg.hours.slice(0, 6).reduce((a, b) => a + b, 0);

    return {
        trackedUsers: agg.users.length,
        activeToday: today.size,
        activeWeek: week.size,
        activeMonth: month.size,
        retentionPct: prevWeek.size ? Math.round((retained / prevWeek.size) * 100) : null,
        avgHoursPerActiveUser: week.size ? round1(weekSeconds / 3600 / week.size) : null,
        completionPct: started ? Math.round((finished / started) * 100) : null,
        rewatchPct: finished ? Math.round((rewatched / finished) * 100) : null,
        nightSharePct: totalHours ? Math.round((night / totalHours) * 100) : null,
        totalPlays: plays,
        titlesStarted: started,
    };
}

function groupOf(t) {
    const isSeries = t.mediaType === "series" || t.mediaType === "anime";
    const label = (isSeries ? t.seriesTitle || t.title : t.title) || "Untitled";
    return { key: `${isSeries ? "s" : "m"}:${String(label).toLowerCase()}`, label: String(label), type: t.mediaType || "movie" };
}

function mediaStats(agg) {
    const groups = new Map();
    const quit = new Map();
    const watchedIds = new Set();
    const nowMs = agg.now.getTime();

    for (const u of agg.users) {
        for (const t of u.titles) {
            const secs = watchedSecondsOf(t);
            const wc = num(t.watchCount);
            if (t.id && (secs > 0 || wc > 0)) watchedIds.add(String(t.id));

            const g = groupOf(t);
            const cur = groups.get(g.key) || { title: g.label, type: g.type, seconds: 0, plays: 0, users: new Set(), eps: new Set() };
            cur.seconds += secs;
            cur.plays += wc;
            cur.users.add(u.uid);
            if (t.id) cur.eps.add(String(t.id));
            groups.set(g.key, cur);

            const dur = num(t.duration);
            const last = t.lastWatchedAt ? new Date(t.lastWatchedAt).getTime() : 0;
            if (dur > 60 && wc === 0 && secs >= 120 && secs / dur < 0.6 && last && nowMs - last > DAY_MS) {
                const q = quit.get(g.key) || { title: g.label, type: g.type, users: new Set(), pctSum: 0, n: 0 };
                q.users.add(u.uid);
                q.pctSum += secs / dur;
                q.n += 1;
                quit.set(g.key, q);
            }
        }
    }

    const mostWatched = [...groups.values()]
        .filter((g) => g.seconds > 0)
        .sort((a, b) => b.seconds - a.seconds)
        .slice(0, 5)
        .map((g) => ({ title: g.title, type: g.type, plays: g.plays, hours: round1(g.seconds / 3600), viewers: g.users.size, episodes: g.eps.size }));

    const stoppedEarly = [...quit.values()]
        .sort((a, b) => b.users.size - a.users.size || a.pctSum / a.n - b.pctSum / b.n)
        .slice(0, 5)
        .map((q) => ({ title: q.title, type: q.type, users: q.users.size, avgPct: Math.round((q.pctSum / q.n) * 100) }));

    return { mostWatched, stoppedEarly, watchedIds };
}

function titleIndex(agg) {
    const m = new Map();
    for (const u of agg.users) for (const t of u.titles) if (t.id && !m.has(String(t.id))) m.set(String(t.id), groupOf(t).label);
    return m;
}

// ─── media-info based stats (resolution, content health, never watched) ───────

function videoOf(info) {
    if (!info) return null;
    if (info.video) return info.video;
    if (Array.isArray(info.streams)) return info.streams.find((s) => s && s.codec_type === "video") || null; // legacy entry shape
    return null;
}

// Resolution label comes from the pixel size, never from a fixed list.
//   4K and above: "<N>K" computed from the width (3840 → 4K, 7680 → 8K, 15360 → 16K, anything future too).
//   Below 4K: the first rung of this ladder the file reaches. To support a new rung, add one number.
const P_LADDER = [1440, 1080, 720, 576, 480, 360, 240];

function resOf(info) {
    const v = videoOf(info);
    if (!v) return null;
    const a = num(v.width);
    const b = num(v.height);
    if (!a && !b) return null;
    const w = Math.max(a, b); // portrait video (phone clips) is classed by its long edge
    const h = Math.min(a, b);
    if (w >= 3400 || h >= 1900) {
        const k = Math.max(4, Math.round((w >= 3400 ? w : (h * 16) / 9) / 960));
        return { label: `${k}K`, rank: k * 540 };
    }
    for (const p of P_LADDER) {
        // width or height can be cropped (scope films), so either one qualifies a rung
        if (w >= p * 1.63 || h >= p * 0.92) return { label: `${p}p`, rank: p };
    }
    return { label: "<240p", rank: 100 };
}

const bucketOf = (info) => {
    const r = resOf(info);
    return r ? r.label : null;
};


function libraryContext() {
    const mediaInfo = tryRequire("../../utils/media/mediaInfoStore");
    const mediaCache = tryRequire("../../utils/media/mediaCache");
    const infoAll = mediaInfo && typeof mediaInfo.getAll === "function" ? mediaInfo.getAll() || {} : {};
    const fileIndex = mediaCache && mediaCache.fileIndex instanceof Map ? mediaCache.fileIndex : new Map();
    return { infoAll, fileIndex };
}

function resolutionStats(agg, ctx) {
    const watched = new Map();
    const library = new Map();
    const rank = new Map();
    let matched = 0;
    let totalTitles = 0;

    for (const u of agg.users) {
        for (const t of u.titles) {
            const secs = watchedSecondsOf(t);
            if (secs <= 0) continue;
            totalTitles++;
            const r = resOf(ctx.infoAll[t.id]);
            if (r) {
                matched++;
                watched.set(r.label, (watched.get(r.label) || 0) + secs);
                rank.set(r.label, r.rank);
            }
        }
    }
    const ids = ctx.fileIndex.size ? [...ctx.fileIndex.keys()] : Object.keys(ctx.infoAll);
    for (const id of new Set(ids)) {
        const r = resOf(ctx.infoAll[id]);
        if (!r) continue;
        library.set(r.label, (library.get(r.label) || 0) + 1);
        rank.set(r.label, r.rank);
    }
    const labels = [...rank.keys()].sort((a, b) => rank.get(b) - rank.get(a)); // highest resolution first
    return {
        buckets: labels,
        watchedHours: labels.map((l) => round1((watched.get(l) || 0) / 3600)),
        libraryFiles: labels.map((l) => library.get(l) || 0),
        matchedTitles: matched,
        totalTitles,
    };
}

function contentHealth(ctx, nowMs) {
    const { infoAll, fileIndex } = ctx;
    const ids = fileIndex.size ? [...fileIndex.keys()] : Object.keys(infoAll);
    let notProbed = 0;
    let noSubtitles = 0;
    let videoTranscode = 0;
    let audioTranscode = 0;
    let lowRes = 0;
    let newThisWeek = 0;
    let probed = 0;

    for (const id of ids) {
        const info = infoAll[id];
        if (!info) {
            notProbed++;
            continue;
        }
        probed++;
        const v = videoOf(info);
        if (info.container !== undefined) {
            if (!Array.isArray(info.subtitleTracks) || info.subtitleTracks.length === 0) noSubtitles++;
            const a = Array.isArray(info.audioTracks) && info.audioTracks.length ? info.audioTracks.find((x) => x && x.default) || info.audioTracks[0] : null;
            if (a && /dts|truehd|ac-?3|pcm_s24le|pcm_dvd/i.test(String(a.codec || ""))) audioTranscode++;
        }
        if (v && v.codec && !/264|avc|vp8|vp9|av1/i.test(String(v.codec))) videoTranscode++;
        const rs = resOf(info);
        if (rs && rs.rank < 480) lowRes++;
        const at = info.probedAt ? new Date(info.probedAt).getTime() : 0;
        if (at && nowMs - at < 7 * DAY_MS) newThisWeek++;
    }
    return { totalFiles: ids.length, probed, notProbed: fileIndex.size ? notProbed : null, noSubtitles, videoTranscode, audioTranscode, lowRes, newThisWeek };
}

function neverWatched(ctx, watchedIds) {
    const { infoAll, fileIndex } = ctx;
    if (!fileIndex.size) return { available: false };
    let count = 0;
    let bytes = 0;
    const rows = [];
    for (const [id, f] of fileIndex) {
        if (watchedIds.has(String(id))) continue;
        count++;
        const info = infoAll[id];
        const size = num(info && info.container && info.container.sizeBytes) || num(f && (f.size || f.sizeBytes));
        bytes += size;
        rows.push({ id, name: (f && (f.name || f.title)) || (info && info.name) || String(id), sizeBytes: size, library: (f && f.folderLabel) || "", resolution: bucketOf(info) });
    }
    rows.sort((a, b) => b.sizeBytes - a.sizeBytes);
    return { available: true, count, totalFiles: fileIndex.size, bytes, top: rows.slice(0, 5) };
}

const FORMAT_ALIASES = { matroska: "MKV", mov: "MP4", mp4: "MP4", webm: "WEBM", avi: "AVI", mpegts: "TS", mpeg: "MPEG", mpegvideo: "MPEG", flv: "FLV", asf: "WMV", ogg: "OGG", matroska_webm: "MKV" };
const CODEC_LABELS = { h264: "H.264", avc: "H.264", avc1: "H.264", hevc: "HEVC", h265: "HEVC", av1: "AV1", vp9: "VP9", vp8: "VP8", mpeg4: "MPEG-4", mpeg2video: "MPEG-2", vc1: "VC-1", wmv3: "WMV", theora: "Theora", vvc: "H.266", h266: "H.266", mpeg1video: "MPEG-1", prores: "ProRes" };
// Only real video extensions count. A name like "Show.S01E01.ESUB" must not become format "ESUB".
const VIDEO_EXTS = new Set(["mkv", "mp4", "avi", "mov", "wmv", "flv", "webm", "ts", "m2ts", "mts", "mpg", "mpeg", "m4v", "3gp", "ogv", "vob", "divx", "asf", "rmvb"]);

// An extension counts as a format only if it is a known video extension OR ffprobe itself lists it for this file
// (so a brand-new container is recognised automatically). "Show.S01E01.ESUB" is never read as format "ESUB".
function extOf(name, info) {
    const e = path.extname(String(name || "")).replace(".", "").toLowerCase();
    if (!e || e.length > 5) return "";
    if (VIDEO_EXTS.has(e)) return e.toUpperCase();
    const tokens = String((info && info.container && info.container.format) || "").toLowerCase().split(",").map((x) => x.trim());
    return tokens.includes(e) ? e.toUpperCase() : "";
}

function formatOf(info, file) {
    const fromFile = extOf(file && file.path, info) || extOf(file && (file.name || file.title), info) || extOf(info && info.name, info);
    if (fromFile) return fromFile;
    const raw = String((info && info.container && info.container.format) || "").split(",")[0].trim().toLowerCase();
    return FORMAT_ALIASES[raw] || (raw ? raw.toUpperCase() : "Unknown");
}

function codecOf(info) {
    const v = videoOf(info);
    const raw = String((v && (v.codec || v.codec_name)) || "").toLowerCase();
    return raw ? CODEC_LABELS[raw] || raw.toUpperCase() : "Unknown";
}

function bump(map, name, secs, bytes) {
    const cur = map.get(name) || { name, count: 0, seconds: 0, bytes: 0, parts: new Map() };
    cur.count += 1;
    cur.seconds += secs;
    cur.bytes += bytes;
    map.set(name, cur);
    return cur;
}

function toParts(map, limit, rankOf) {
    const all = [...map.entries()].sort((a, b) => (rankOf ? rankOf(b[0]) - rankOf(a[0]) : b[1] - a[1]));
    const head = all.slice(0, limit).map(([name, count]) => ({ name, count }));
    const rest = all.slice(limit).reduce((n, [, c]) => n + c, 0);
    return rest ? head.concat([{ name: "Other", count: rest }]) : head;
}

// Groups beyond `limit` are folded into one "Other" row so totals always add up.
function toGroups(map, limit, partsLimit, rankOf) {
    const all = [...map.values()].sort((a, b) => b.count - a.count);
    const out = all.slice(0, limit);
    const rest = all.slice(limit);
    const rows = out.map((g) => ({ name: g.name, count: g.count, seconds: Math.round(g.seconds), bytes: g.bytes, parts: toParts(g.parts, partsLimit, rankOf) }));
    if (rest.length) {
        const merged = new Map();
        rest.forEach((g) => g.parts.forEach((c, n) => merged.set(n, (merged.get(n) || 0) + c)));
        rows.push({ name: "Other", count: rest.reduce((n, g) => n + g.count, 0), seconds: Math.round(rest.reduce((n, g) => n + g.seconds, 0)), bytes: rest.reduce((n, g) => n + g.bytes, 0), parts: toParts(merged, partsLimit, rankOf) });
    }
    return rows;
}

function mediaInventory(ctx) {
    const { infoAll, fileIndex } = ctx;
    const ids = fileIndex.size ? [...fileIndex.keys()] : Object.keys(infoAll);
    const byRes = new Map();
    const byFormat = new Map();
    const byCodec = new Map();
    const rankMap = new Map([["Unknown", 0]]);
    const totals = { files: 0, seconds: 0, bytes: 0 };

    for (const id of ids) {
        const info = infoAll[id];
        if (!info) continue;
        const r = resOf(info);
        const resLabel = r ? r.label : "Unknown";
        rankMap.set(resLabel, r ? r.rank : 0);
        const format = formatOf(info, fileIndex.get(id));
        const codec = codecOf(info);
        const secs = num(info.container && info.container.durationSeconds);
        const bytes = num(info.container && info.container.sizeBytes);

        const a = bump(byRes, resLabel, secs, bytes);
        a.parts.set(codec, (a.parts.get(codec) || 0) + 1); // resolution row → codec split
        const b = bump(byFormat, format, secs, bytes);
        b.parts.set(resLabel, (b.parts.get(resLabel) || 0) + 1); // format row → resolution split
        const c = bump(byCodec, codec, secs, bytes);
        c.parts.set(resLabel, (c.parts.get(resLabel) || 0) + 1);

        totals.files += 1;
        totals.seconds += secs;
        totals.bytes += bytes;
    }

    const rankOf = (label) => rankMap.get(label) ?? 0;
    const resRows = [...byRes.values()]
        .sort((x, y) => rankOf(y.name) - rankOf(x.name)) // highest resolution first, Unknown last
        .map((g) => ({ name: g.name, count: g.count, seconds: Math.round(g.seconds), bytes: g.bytes, parts: toParts(g.parts, 4) }));
    return {
        rows: resRows,
        formats: toGroups(byFormat, 10, 4, rankOf),
        codecs: toGroups(byCodec, 8, 3, rankOf),
        totals: { files: totals.files, seconds: Math.round(totals.seconds), bytes: totals.bytes },
    };
}

// ─── storage (disk capacity + daily history for forecast) ─────────────────────

const norm = (p) => path.resolve(p).replace(/\\/g, "/").toLowerCase();

function mountFor(folderPath, disks) {
    const target = norm(folderPath);
    let best = null;
    for (const d of disks) {
        const m = String(d.mount || "").replace(/\\/g, "/").toLowerCase().replace(/\/+$/, "");
        if ((target === m || target.startsWith(m + "/")) && (!best || m.length > best.m.length)) best = { disk: d, m };
    }
    return best ? best.disk : null;
}

function readHistory() {
    try {
        const raw = fs.readFileSync(HISTORY_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

function writeHistory(data) {
    try {
        fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
        const tmp = `${HISTORY_FILE}.tmp.${process.pid}.${Date.now()}`;
        fs.writeFileSync(tmp, JSON.stringify(data), "utf-8");
        fs.renameSync(tmp, HISTORY_FILE);
    } catch {
        /* history is best-effort — never let it break the page */
    }
}

async function storageStats(now) {
    const si = tryRequire("systeminformation");
    const lib = tryRequire("../../controllers/media/libraryController");
    if (!si || typeof si.fsSize !== "function" || !lib || typeof lib.readFolders !== "function") return null;

    const [folders, disks] = await Promise.all([lib.readFolders(), si.fsSize()]);
    if (!Array.isArray(folders) || !Array.isArray(disks) || !folders.length || !disks.length) return { disks: [] };

    const byMount = new Map();
    for (const f of folders) {
        if (!f || !f.path) continue;
        const disk = mountFor(f.path, disks);
        if (!disk) continue;
        if (!byMount.has(disk.mount)) byMount.set(disk.mount, { disk, labels: [] });
        byMount.get(disk.mount).labels.push(f.label || path.basename(f.path));
    }

    const history = readHistory();
    const today = dayKey(now);
    let historyChanged = false;
    const result = [];

    for (const [mount, { disk, labels }] of byMount) {
        const size = num(disk.size);
        const used = num(disk.used);
        const free = num(disk.available) || Math.max(0, size - used);
        const list = Array.isArray(history[mount]) ? history[mount] : [];
        if (!list.length || list[list.length - 1].d !== today) {
            list.push({ d: today, used });
            history[mount] = list.slice(-120);
            historyChanged = true;
        }
        const pts = (history[mount] || list).slice(-30);
        let growthPerDay = null;
        let daysToFull = null;
        let fullDate = null;
        if (pts.length >= 3) {
            const first = pts[0];
            const last = pts[pts.length - 1];
            const days = (dayOf(last.d) - dayOf(first.d)) / DAY_MS;
            if (days >= 2) {
                const slope = (last.used - first.used) / days;
                growthPerDay = Math.round(slope);
                if (slope > 0 && free > 0) {
                    daysToFull = Math.floor(free / slope);
                    fullDate = dayKey(new Date(now.getTime() + daysToFull * DAY_MS));
                }
            }
        }
        result.push({
            mount,
            sizeBytes: size,
            usedBytes: used,
            freeBytes: free,
            usedPct: size > 0 ? Math.round((used / size) * 1000) / 10 : 0,
            libraries: labels.slice(0, 10),
            history: (history[mount] || []).slice(-60),
            growthPerDay,
            daysToFull,
            fullDate,
        });
    }
    if (historyChanged) writeHistory(history);
    result.sort((a, b) => b.usedPct - a.usedPct);
    return { disks: result };
}

// ─── accounts + audit (database) ──────────────────────────────────────────────

async function accountStats(now) {
    const d7 = new Date(now.getTime() - 7 * DAY_MS);
    const h24 = new Date(now.getTime() - DAY_MS);
    const in7 = new Date(now.getTime() + 7 * DAY_MS);
    const temp = { deletedAt: null, status: "approved", accessType: "temporary" };

    const [unverified, expiredAccess, expiring, pending, newUsers7d, logins24h] = await Promise.all([
        soft(prisma.user.count({ where: { deletedAt: null, emailVerified: false } }), null),
        soft(prisma.user.count({ where: { ...temp, accessExpiresAt: { lt: now } } }), null),
        soft(prisma.user.findMany({ where: { ...temp, accessExpiresAt: { gt: now, lt: in7 } }, orderBy: { accessExpiresAt: "asc" }, take: 5, select: { id: true, name: true, email: true, accessExpiresAt: true } }), []),
        soft(prisma.user.findMany({ where: { deletedAt: null, status: "pending" }, orderBy: { createdAt: "asc" }, take: 5, select: { id: true, name: true, email: true, createdAt: true } }), []),
        soft(prisma.user.count({ where: { deletedAt: null, createdAt: { gt: d7 } } }), null),
        soft(prisma.user.count({ where: { deletedAt: null, lastLoginAt: { gt: h24 } } }), null),
    ]);
    return { unverified, expiredAccess, expiring, pending, newUsers7d, logins24h };
}

function safeJson(s) {
    try {
        const v = JSON.parse(s || "{}");
        return v && typeof v === "object" ? v : {};
    } catch {
        return {};
    }
}

async function auditStats(now) {
    if (!prisma.auditEvent) return null;
    const since = new Date(now.getTime() - DAY_MS);
    const [count, rows] = await Promise.all([
        soft(prisma.auditEvent.count({ where: { createdAt: { gt: since } } }), null),
        soft(prisma.auditEvent.findMany({ orderBy: { createdAt: "desc" }, take: 8, select: { id: true, action: true, targetLabel: true, detailJson: true, createdAt: true } }), []),
    ]);
    return { count24h: count, events: rows.map((r) => ({ id: r.id, action: r.action, target: r.targetLabel || "", detail: safeJson(r.detailJson), at: r.createdAt })) };
}

const ACTIVE_NOW_MS = 5 * 60 * 1000; // "active now" = session seen in the last 5 minutes

async function sessionStats(now) {
    const tokenService = tryRequire("../../auth/services/tokenService");
    const where = { isActive: true, user: { deletedAt: null }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
    if (tokenService && typeof tokenService.sessionCutoff === "function") where.lastSeenAt = { gt: tokenService.sessionCutoff() };

    const rows = await prisma.session.findMany({ where, orderBy: { lastSeenAt: "desc" }, take: 2000, select: { userId: true, os: true, deviceType: true, browser: true, ip: true, lastSeenAt: true } });
    // Same definitions as the existing /stats route: session = distinct browser client, device = distinct machine
    const group = tokenService && typeof tokenService.groupClients === "function" ? tokenService.groupClients : null;
    const countOf = (list, opts) => {
        try {
            return group ? group(list, opts).length : list.length;
        } catch {
            return list.length;
        }
    };

    const byUser = new Map();
    for (const r of rows) {
        if (!byUser.has(r.userId)) byUser.set(r.userId, []);
        byUser.get(r.userId).push(r);
    }

    const perUser = [];
    let sessions = 0;
    let devices = 0;
    let activeNow = 0;
    const cutoffNow = now.getTime() - ACTIVE_NOW_MS;
    for (const [uid, list] of byUser) {
        const s = countOf(list, { byBrowser: true });
        const d = countOf(list);
        const an = countOf(list.filter((r) => r.lastSeenAt && new Date(r.lastSeenAt).getTime() > cutoffNow), { byBrowser: true });
        sessions += s;
        devices += d;
        activeNow += an;
        const labels = [...new Set(list.map((r) => `${r.browser || "Browser"} on ${r.os || "Unknown OS"}`))];
        perUser.push({ id: uid, sessions: s, devices: d, activeNow: an, labels: labels.slice(0, 3), moreLabels: Math.max(0, labels.length - 3), lastSeenAt: list[0] && list[0].lastSeenAt });
    }
    perUser.sort((a, b) => b.sessions - a.sessions || b.devices - a.devices);
    const top = perUser.slice(0, 6);
    const names = await userMap(top.map((u) => u.id));

    const types = { desktop: 0, mobile: 0, tablet: 0, other: 0 };
    const seen = new Set();
    for (const r of rows) {
        const key = `${r.userId}|${r.deviceType}|${r.os}|${r.browser}`;
        if (seen.has(key)) continue;
        seen.add(key);
        types[types[r.deviceType] !== undefined ? r.deviceType : "other"] += 1;
    }

    const totalOnRecord = await soft(Promise.resolve().then(() => prisma.session.count({ where: { user: { deletedAt: null } } })), null);

    return {
        activeSessions: sessions,
        activeNow,
        activeNowMinutes: ACTIVE_NOW_MS / 60000,
        devices,
        usersSignedIn: byUser.size,
        maxPerUser: perUser.length ? perUser[0].sessions : 0,
        avgPerUser: byUser.size ? round1(sessions / byUser.size) : 0,
        totalOnRecord,
        byType: types,
        users: top.map((u) => {
            const nm = names.get(u.id);
            return { ...u, name: nameOf(nm), email: nm && !nm.deletedAt ? nm.email || "" : "" };
        }),
    };
}

// ─── people lookups ───────────────────────────────────────────────────────────

async function userMap(ids) {
    const out = new Map();
    if (!ids.length) return out;
    const rows = await soft(prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true, deletedAt: true } }), []);
    rows.forEach((r) => out.set(r.id, r));
    return out;
}

const nameOf = (u) => (u && !u.deletedAt ? u.name || u.email || "User" : "Deleted user");

async function onlineUserIds() {
    const tokenService = tryRequire("../../auth/services/tokenService");
    const where = { isActive: true, user: { deletedAt: null }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] };
    if (tokenService && typeof tokenService.sessionCutoff === "function") where.lastSeenAt = { gt: tokenService.sessionCutoff() };
    const rows = await soft(prisma.session.findMany({ where, select: { userId: true }, distinct: ["userId"] }), []);
    return rows.map((r) => r.userId);
}

// ─── builders ─────────────────────────────────────────────────────────────────

async function buildHeavy() {
    const now = new Date();
    const wt = readWatch();
    const agg = aggregateWatch(wt, now);
    const ctx = libraryContext();

    const media = await guard("media", () => mediaStats(agg));
    const week = await guard("topViewers", async () => {
        const rows = agg.users
            .map((u) => {
                let secs = 0;
                for (let i = 0; i <= 6; i++) secs += num(u.daily[dayKey(daysAgo(i, now))] && u.daily[dayKey(daysAgo(i, now))].seconds);
                const last = u.titles.reduce((m, t) => (t.lastWatchedAt && (!m || t.lastWatchedAt > m) ? t.lastWatchedAt : m), null);
                return { id: u.uid, seconds: secs, lastWatchedAt: last };
            })
            .filter((r) => r.seconds > 0)
            .sort((a, b) => b.seconds - a.seconds)
            .slice(0, 5);
        const names = await userMap(rows.map((r) => r.id));
        return rows.map((r) => {
            const u = names.get(r.id);
            return { id: r.id, name: nameOf(u), email: u && !u.deletedAt ? u.email || "" : "", hours: round1(r.seconds / 3600), lastWatchedAt: r.lastWatchedAt };
        });
    });

    const [storage, accounts, audit] = await Promise.all([guard("storage", () => storageStats(now)), guard("accounts", () => accountStats(now)), guard("audit", () => auditStats(now))]);

    return {
        generatedAt: now.toISOString(),
        hasWatchData: agg.users.length > 0,
        watch: await guard("watch", async () => ({
            totalHours: round1(agg.totalSeconds / 3600),
            trend: { "7d": rangeSeries(agg, 7), "30d": rangeSeries(agg, 30), "90d": rangeSeries(agg, 90) },
            hoursOfDay: agg.hours.map((s) => round1(s / 3600)),
            weekdays: weekdayStats(agg),
            calendar: calendarStats(agg),
            mix: { movie: round1(agg.byType.movie / 3600), series: round1(agg.byType.series / 3600), anime: round1(agg.byType.anime / 3600) },
            engagement: engagementStats(agg),
        })),
        topViewers: week,
        mostWatched: media ? media.mostWatched : null,
        stoppedEarly: media ? media.stoppedEarly : null,
        neverWatched: media ? await guard("neverWatched", () => neverWatched(ctx, media.watchedIds)) : null,
        resolution: await guard("resolution", () => resolutionStats(agg, ctx)),
        inventory: await guard("inventory", () => mediaInventory(ctx)),
        sessions: await guard("sessions", () => sessionStats(now)),
        contentHealth: await guard("contentHealth", () => contentHealth(ctx, now.getTime())),
        storage,
        accounts,
        audit,
    };
}

async function buildLive() {
    const now = Date.now();
    const wt = readWatch();
    const agg = aggregateWatch(wt, new Date());

    const watching = [];
    for (const u of agg.users) {
        for (const t of u.titles) {
            const last = t.lastWatchedAt ? new Date(t.lastWatchedAt).getTime() : 0;
            const ago = (now - last) / 1000;
            if (last && ago >= 0 && ago < WATCHING_NOW_SEC) {
                watching.push({ userId: u.uid, id: t.id, title: groupOf(t).label, episodeTitle: t.title || "", type: t.mediaType || "movie", season: t.seasonNumber ?? null, episode: t.episodeNumber ?? null, agoSec: Math.round(ago) });
            }
        }
    }

    const online = await onlineUserIds();
    const names = await userMap([...new Set(watching.map((w) => w.userId))]);

    let transcodes = [];
    await guard("transcodes", async () => {
        const ts = tryRequire("../../utils/streaming/transcoderService");
        if (!ts || typeof ts.getSessionStats !== "function") return;
        const sessions = ts.getSessionStats() || [];
        if (!sessions.length) return; // nothing running — skip all lookups
        const mediaCache = tryRequire("../../utils/media/mediaCache");
        const fileIndex = mediaCache && mediaCache.fileIndex instanceof Map ? mediaCache.fileIndex : new Map();
        const idx = titleIndex(agg);
        transcodes = sessions.slice(0, 20).map((s) => {
            const f = fileIndex.get(s.mediaId);
            return {
                id: s.id,
                mediaId: s.mediaId,
                title: (f && (f.name || f.title)) || idx.get(String(s.mediaId)) || String(s.mediaId || "").slice(0, 12),
                decision: s.decision || "",
                status: s.status || "",
                fps: num(s.fps),
                speed: num(s.speed),
                bitrate: s.bitrate || "",
                idleSec: Math.round(num(s.idleMs) / 1000),
                positionSec: Math.round(num(s.downloadPos)),
            };
        });
    });

    return {
        generatedAt: new Date().toISOString(),
        onlineUserIds: online,
        nowWatching: watching.sort((a, b) => a.agoSec - b.agoSec).map((w) => ({ ...w, name: nameOf(names.get(w.userId)) })),
        transcodes,
    };
}

const getHeavy = cached(60_000, buildHeavy);
const getLive = cached(5_000, buildLive);

router.get("/", async (req, res) => {
    try {
        res.set("Cache-Control", "no-store");
        res.json(await getHeavy());
    } catch (err) {
        console.error("[Analytics] heavy build failed:", err && err.message);
        res.status(500).json({ error: "Failed to build analytics" });
    }
});

router.get("/live", async (req, res) => {
    try {
        res.set("Cache-Control", "no-store");
        res.json(await getLive());
    } catch (err) {
        console.error("[Analytics] live build failed:", err && err.message);
        res.status(500).json({ error: "Failed to build live data" });
    }
});

router._internals = { buildHeavy, buildLive };
module.exports = router;
