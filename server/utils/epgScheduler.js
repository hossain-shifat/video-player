"use strict";

/**
 * epgScheduler.js — Background EPG Jobs
 *
 * Jobs (all intervals configurable via env vars):
 *   ingestAll        — fetch + parse all enabled EPG sources (default: every 6h)
 *   refreshNowCache  — rebuild current-programme cache (default: every 1 min)
 *   detectEvents     — scan for live events / sports / breaking news (default: every 1 min)
 *   refreshRecoCache — rebuild recommendation cache (default: every 1 min)
 *
 * EPG_REFRESH_INTERVAL_MS   — programme ingest (default 6h)
 * EPG_NOWCACHE_INTERVAL_MS  — now/next cache (default 60s)
 * EPG_EVENTS_INTERVAL_MS    — event detection (default 60s)
 */

const epgStore    = require("./epgStore");
const { createProvider } = require("./epgProvider");
const { ChannelMatcher } = require("./epgMatcher");
const eventDetector      = require("./epgEventDetector");

// Lazy-import to avoid circular deps (liveController → scheduler → liveController)
function getLiveRows() {
    try {
        const { getPublicLiveRich } = require("../utils/iptvStore");
        const rich = getPublicLiveRich();
        const rows = [];
        for (const [group, list] of Object.entries(rich.channels || {})) {
            for (const ch of list) {
                rows.push({
                    id:          Buffer.from(ch.url).toString("base64url"),
                    name:        ch.name,
                    cleanName:   ch.cleanName || ch.name,
                    tvgId:       ch.tvgId   || null,
                    tvgName:     ch.tvgName || null,
                    streamStatus: ch.streamStatus || "unknown",
                    url:         ch.url,
                });
            }
        }
        return rows;
    } catch { return []; }
}

const INGEST_INTERVAL  = parseInt(process.env.EPG_REFRESH_INTERVAL_MS  || String(6 * 60 * 60 * 1000), 10);
const NOW_INTERVAL     = parseInt(process.env.EPG_NOWCACHE_INTERVAL_MS || "60000", 10);
const EVENTS_INTERVAL  = parseInt(process.env.EPG_EVENTS_INTERVAL_MS   || "60000", 10);

// ─── In-memory caches ─────────────────────────────────────────────────────────

let _nowCache    = new Map();  // channelId → { now, next, upcoming, updatedAt }
let _eventsCache = null;       // { featuredEvents, sports, news, updatedAt }
let _recoCache   = null;       // { sports, news, kids, movies, updatedAt }

// ─── Ingest job ──────────────────────────────────────────────────────────────

let _ingestRunning = false;

async function ingestAll(force = false) {
    if (_ingestRunning && !force) { console.log("[EPG] Ingest already running"); return; }
    _ingestRunning = true;
    console.log("[EPG] Starting EPG ingest...");
    const startMs = Date.now();

    try {
        const sources = epgStore.getSources().filter((s) => s.enabled !== false);
        if (!sources.length) { console.log("[EPG] No enabled EPG sources"); return; }

        // Sort by priority ascending (lower = higher priority = ingested first)
        sources.sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50));

        const liveRows = getLiveRows();
        const matcher  = new ChannelMatcher(liveRows);

        let totalProgrammes = 0, matchedChannels = 0;
        const sourceStats = {};

        for (const src of sources) {
            const t0 = Date.now();
            console.log(`[EPG] Ingesting source: ${src.name} (${src.type})`);
            try {
                const provider = createProvider(src);
                const { channels, programmes } = await provider.run();

                // Merge EPG channel metadata into store
                const epgChans = epgStore.getEpgChannels();
                for (const [id, meta] of channels.entries()) {
                    if (!epgChans[id]) epgChans[id] = meta;
                }
                epgStore.setEpgChannels(epgChans);

                // Match XMLTV channels to live channels + write programmes
                const matchMap = matcher.matchAll(channels);
                let srcProgs = 0, srcMatched = 0;

                for (const [xmltvId, progList] of programmes.entries()) {
                    const hit = matchMap.get(xmltvId);
                    if (!hit) continue;
                    srcMatched++;

                    const normalized = progList.map((p) =>
                        provider.normalizeProgram(p, hit.row.id, src.id)
                    );
                    const written = await epgStore.mergeChannelProgrammes(hit.row.id, normalized, src.priority ?? 50);
                    srcProgs += written;
                }

                totalProgrammes += srcProgs;
                matchedChannels  = Math.max(matchedChannels, srcMatched);
                sourceStats[src.id] = {
                    name: src.name, ok: true,
                    matched: srcMatched, programmes: srcProgs,
                    durationMs: Date.now() - t0,
                };
                epgStore.updateSource(src.id, { lastIngest: new Date().toISOString(), lastError: null });
            } catch (err) {
                console.error(`[EPG] Source ${src.name} failed:`, err.message);
                sourceStats[src.id] = { name: src.name, ok: false, error: err.message };
                epgStore.updateSource(src.id, { lastError: err.message });
            }
        }

        epgStore.setMeta({
            lastFullRefresh: new Date().toISOString(),
            totalProgrammes,
            matchedChannels,
            sources: sourceStats,
            durationMs: Date.now() - startMs,
        });
        console.log(`[EPG] Ingest done in ${Date.now() - startMs}ms — ${totalProgrammes} programmes, ${matchedChannels} channels matched`);

        // Immediately refresh caches after ingest
        refreshNowCache();
        refreshEventCache();
    } finally {
        _ingestRunning = false;
    }
}

// ─── Now/Next cache job ───────────────────────────────────────────────────────

function refreshNowCache() {
    const now    = Date.now();
    const ids    = epgStore.getIndexedChannelIds();
    const newMap = new Map();
    for (const id of ids) {
        const resolved = epgStore.resolveNow(id, now);
        if (resolved.now || resolved.next) {
            newMap.set(id, { ...resolved, updatedAt: new Date().toISOString() });
        }
    }
    _nowCache = newMap;
}

function getNowCache() { return _nowCache; }

function getNowForChannel(channelId) {
    return _nowCache.get(channelId) || epgStore.resolveNow(channelId, Date.now());
}

// ─── Event detection job ──────────────────────────────────────────────────────

function refreshEventCache() {
    const liveRows = getLiveRows();
    const workingIds = new Set(
        liveRows.filter((r) => r.streamStatus === "working").map((r) => r.id)
    );

    const allNow = [];
    for (const [channelId, data] of _nowCache.entries()) {
        if (!workingIds.has(channelId)) continue; // only promote working channels
        if (data.now) allNow.push({ channelId, programme: data.now });
    }

    _eventsCache  = eventDetector.detectEvents(allNow, liveRows);
    _recoCache    = eventDetector.buildRecommendations(_eventsCache, liveRows);
}

function getEventsCache()  { return _eventsCache  || { featuredEvents: [], sports: [], news: [], entertainment: [], updatedAt: null }; }
function getRecoCache()    { return _recoCache     || { sports: [], news: [], kids: [], movies: [], featuredEvents: [], updatedAt: null }; }

// ─── Scheduler control ────────────────────────────────────────────────────────

let _timers = [];

function start() {
    if (_timers.length) return; // already running

    // Run immediately on start
    ingestAll().catch((e) => console.error("[EPG] Initial ingest failed:", e.message));

    _timers.push(setInterval(() => ingestAll().catch(console.error), INGEST_INTERVAL));
    _timers.push(setInterval(() => { refreshNowCache(); refreshEventCache(); }, NOW_INTERVAL));

    // Boot sports scheduler alongside EPG — isolated, never breaks EPG on failure
    try {
        const sportsScheduler = require("./sportsScheduler");
        sportsScheduler.start();
    } catch (err) {
        console.warn("[EPG] sportsScheduler not available:", err.message);
    }

    console.log(`[EPG] Scheduler started — ingest every ${INGEST_INTERVAL / 60000}m, cache every ${NOW_INTERVAL / 1000}s`);
}

function stop() {
    for (const t of _timers) clearInterval(t);
    _timers = [];
    console.log("[EPG] Scheduler stopped");
}

function getStatus() {
    return {
        running:       _timers.length > 0,
        ingestRunning: _ingestRunning,
        intervals: {
            ingestMs:       INGEST_INTERVAL,
            nowCacheMs:     NOW_INTERVAL,
            eventsMs:       EVENTS_INTERVAL,
        },
        ...epgStore.getMeta(),
    };
}

module.exports = {
    start, stop, getStatus,
    ingestAll,
    refreshNowCache, getNowCache, getNowForChannel,
    refreshEventCache, getEventsCache, getRecoCache,
};
