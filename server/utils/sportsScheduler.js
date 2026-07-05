"use strict";

/**
 * sportsScheduler.js — Background Sports Data Refresh
 *
 * Intervals (configurable via env vars):
 *   SPORTS_LIVE_INTERVAL_MS      — live events     (default: 60s)
 *   SPORTS_TODAY_INTERVAL_MS     — today's events  (default: 10 min)
 *   SPORTS_UPCOMING_INTERVAL_MS  — upcoming events (default: 30 min)
 *
 * If TheSportsDB is unavailable:
 *   → stale data is served from sportsStore
 *   → EPG + live TV continue unaffected
 *   → error is logged but never throws
 */

const sportsStore    = require("./sportsStore");
const { createSportsProvider } = require("./sportsProvider");

const LIVE_INTERVAL     = parseInt(process.env.SPORTS_LIVE_INTERVAL_MS     || "60000",        10);
const TODAY_INTERVAL    = parseInt(process.env.SPORTS_TODAY_INTERVAL_MS    || "600000",       10); // 10 min
const UPCOMING_INTERVAL = parseInt(process.env.SPORTS_UPCOMING_INTERVAL_MS || "1800000",      10); // 30 min

// Singleton provider — created once with env key
let _provider = null;

function getProvider() {
    if (!_provider) {
        _provider = createSportsProvider({
            provider: process.env.SPORTS_PROVIDER || "thesportsdb",
            apiKey:   process.env.THESPORTSDB_API_KEY || "",
            v2:       process.env.THESPORTSDB_V2 === "true",
        });
    }
    return _provider;
}

// ─── Individual refresh jobs ──────────────────────────────────────────────────

let _liveRunning     = false;
let _todayRunning    = false;
let _upcomingRunning = false;

async function refreshLive() {
    if (_liveRunning) return;
    _liveRunning = true;
    try {
        const events = await getProvider().fetchLiveEvents();
        sportsStore.setLiveEvents(events);
        sportsStore.mergeLiveIntoToday();
        sportsStore.setMeta({ lastLiveRefresh: new Date().toISOString() });
        if (events.length > 0) console.log(`[Sports] ${events.length} live events refreshed`);
    } catch (err) {
        console.warn("[Sports] refreshLive failed:", err.message);
        // Do not rethrow — caller continues with stale data
    } finally {
        _liveRunning = false;
    }
}

async function refreshToday() {
    if (_todayRunning) return;
    _todayRunning = true;
    try {
        const events = await getProvider().fetchTodayEvents();
        sportsStore.setTodayEvents(events);
        sportsStore.setMeta({ lastTodayRefresh: new Date().toISOString() });
        console.log(`[Sports] ${events.length} today events refreshed`);
    } catch (err) {
        console.warn("[Sports] refreshToday failed:", err.message);
    } finally {
        _todayRunning = false;
    }
}

async function refreshUpcoming() {
    if (_upcomingRunning) return;
    _upcomingRunning = true;
    try {
        const events = await getProvider().fetchUpcomingEvents();
        sportsStore.setUpcomingEvents(events);
        sportsStore.setMeta({ lastUpcomingRefresh: new Date().toISOString() });
        console.log(`[Sports] ${events.length} upcoming events refreshed`);
    } catch (err) {
        console.warn("[Sports] refreshUpcoming failed:", err.message);
    } finally {
        _upcomingRunning = false;
    }
}

// Full refresh — all three buckets in parallel (safe: independent writes)
async function refreshAll() {
    await Promise.allSettled([refreshLive(), refreshToday(), refreshUpcoming()]);
}

// ─── Scheduler control ────────────────────────────────────────────────────────

let _timers   = [];
let _started  = false;

function start() {
    if (_started) return;
    _started = true;

    // Initial fetch — non-blocking, errors are swallowed internally
    refreshAll().catch(() => {});

    _timers.push(setInterval(() => refreshLive().catch(()     => {}), LIVE_INTERVAL));
    _timers.push(setInterval(() => refreshToday().catch(()    => {}), TODAY_INTERVAL));
    _timers.push(setInterval(() => refreshUpcoming().catch(() => {}), UPCOMING_INTERVAL));

    console.log(`[Sports] Scheduler started — live:${LIVE_INTERVAL/1000}s today:${TODAY_INTERVAL/60000}m upcoming:${UPCOMING_INTERVAL/60000}m`);
}

function stop() {
    for (const t of _timers) clearInterval(t);
    _timers  = [];
    _started = false;
    console.log("[Sports] Scheduler stopped");
}

function getStatus() {
    return {
        running:         _started,
        liveRunning:     _liveRunning,
        todayRunning:    _todayRunning,
        upcomingRunning: _upcomingRunning,
        intervals: { liveMs: LIVE_INTERVAL, todayMs: TODAY_INTERVAL, upcomingMs: UPCOMING_INTERVAL },
        ...sportsStore.getMeta(),
    };
}

module.exports = {
    start, stop, getStatus,
    refreshAll, refreshLive, refreshToday, refreshUpcoming,
};
