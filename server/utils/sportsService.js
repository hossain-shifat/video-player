"use strict";

/**
 * sportsService.js — Sports Event Service (Hybrid EPG Integration)
 *
 * This is the single integration point between:
 *   Sports API (sportsProvider / sportsStore)
 *   Hybrid EPG Engine (epgScheduler / epgStore)
 *   Channel Matcher (epgMatcher.SportsEventMatcher)
 *
 * All methods return plain objects — no I/O, no scheduling.
 * Controllers call this; schedulers populate the stores it reads from.
 *
 * Key principle: The Sports Event Service never knows which channels broadcast
 * a match — it always asks the EPG engine via SportsEventMatcher.
 */

const sportsStore       = require("./sportsStore");
const epgScheduler      = require("./epgScheduler");
const { SportsEventMatcher } = require("./epgMatcher");

// ─── Live rows helper (same lazy pattern as epgController / epgScheduler) ─────
function getLiveRows() {
    try {
        const { getPublicLiveRich } = require("./iptvStore");
        const rich = getPublicLiveRich();
        const rows = [];
        for (const [, list] of Object.entries(rich.channels || {})) {
            for (const ch of list) {
                rows.push({
                    id:           Buffer.from(ch.url).toString("base64url"),
                    name:         ch.name,
                    cleanName:    ch.cleanName || ch.name,
                    tvgId:        ch.tvgId    || null,
                    tvgName:      ch.tvgName  || null,
                    category:     ch.category || null,
                    streamStatus: ch.streamStatus || "unknown",
                    logo:         ch.logo    || null,
                    url:          ch.url,
                    resolution:   ch.resolution || null,
                    isHD:         ch.isHD    || false,
                    group:        ch.group   || null,
                });
            }
        }
        return rows;
    } catch { return []; }
}

// ─── Singleton matcher — rebuilt only when channel list changes ────────────────
let _matcher     = null;
let _matcherRows = 0;

function getMatcher() {
    const rows = getLiveRows();
    // Rebuild if channel count changed (simple invalidation heuristic)
    if (!_matcher || rows.length !== _matcherRows) {
        _matcher     = new SportsEventMatcher(rows);
        _matcherRows = rows.length;
    }
    return _matcher;
}

// ─── Core: enrich one event with channels + EPG ───────────────────────────────

/**
 * Enriches a NormalizedEvent with:
 *   channels        — working channels likely broadcasting this event
 *   nowPlaying      — EPG current programme on those channels
 *   workingOnly     — true (always — offline channels never included)
 *
 * @param {object}  event
 * @param {boolean} workingOnly — ignored, always true (enforced here)
 */
function enrichEvent(event) {
    const matcher  = getMatcher();
    const nowCache = epgScheduler.getNowCache();
    const channels = matcher.matchWorking(event, nowCache);

    return {
        ...event,
        channels,
        workingOnly:   true,
        enrichedAt:    new Date().toISOString(),
    };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * GET /api/live/events/live
 * Returns all currently live sports events with matching working channels.
 */
function getLiveEvents() {
    const events = sportsStore.getLiveEvents();
    return events.map(enrichEvent).sort((a, b) => b.importance - a.importance);
}

/**
 * GET /api/live/events/today
 * Returns all of today's events with channels.
 */
function getTodayEvents() {
    const events = sportsStore.getTodayEvents();
    return events
        .map(enrichEvent)
        .sort((a, b) => {
            // Live first, then by kickoff, then by importance
            const statusOrder = { live: 0, upcoming: 1, finished: 2, postponed: 3, cancelled: 4, unknown: 5 };
            const sa = statusOrder[a.status] ?? 5;
            const sb = statusOrder[b.status] ?? 5;
            if (sa !== sb) return sa - sb;
            return (a.kickoff || "").localeCompare(b.kickoff || "");
        });
}

/**
 * GET /api/live/events/upcoming
 * Returns upcoming events with channels, sorted by kickoff.
 */
function getUpcomingEvents() {
    const events = sportsStore.getUpcomingEvents();
    return events
        .map(enrichEvent)
        .sort((a, b) => (a.kickoff || "").localeCompare(b.kickoff || ""));
}

/**
 * GET /api/live/events/:id
 * Single event with full channel list.
 */
function getEventById(id) {
    const event = sportsStore.getEventById(id);
    if (!event) return null;
    return enrichEvent(event);
}

/**
 * GET /api/live/events/:id/channels
 * Just the channel list for one event.
 */
function getEventChannels(id) {
    const event = sportsStore.getEventById(id);
    if (!event) return null;
    const matcher  = getMatcher();
    const nowCache = epgScheduler.getNowCache();
    return matcher.matchWorking(event, nowCache);
}

/**
 * GET /api/live/featured-events
 *
 * The homepage-ready payload:
 *   featuredEvents    — top 10 live/upcoming high-importance events with channels
 *   liveNow           — events currently live
 *   todayMatches      — all today's matches (lightweight, no channel list)
 *   upcomingHighlights — top 5 upcoming events by importance
 *   recommendedChannels — top working sports channels from EPG event detector
 *   recentlyFinished  — last 5 completed events today
 */
function getFeaturedEvents() {
    const allToday    = sportsStore.getTodayEvents();
    const allLive     = sportsStore.getLiveEvents();
    const allUpcoming = sportsStore.getUpcomingEvents();

    // Pull EPG-based recommendations for sports channels (from existing engine)
    const epgReco = epgScheduler.getRecoCache();

    // Featured = live events + high-importance upcoming, enriched with channels
    const featuredRaw = [
        ...allLive,
        ...allUpcoming.filter((e) => e.importance >= 60),
    ]
        .sort((a, b) => b.importance - a.importance)
        .slice(0, 10);

    const featuredEvents = featuredRaw.map(enrichEvent);

    // Today's matches — lightweight (no channel enrichment, just event data)
    const todayMatches = allToday
        .sort((a, b) => (a.kickoff || "").localeCompare(b.kickoff || ""))
        .map(({ id, sport, league, homeTeam, awayTeam, kickoff, status, score, importance, thumbnail }) => ({
            id, sport, league, homeTeam, awayTeam, kickoff, status, score, importance, thumbnail,
        }));

    // Upcoming highlights — top 5 by importance
    const upcomingHighlights = allUpcoming
        .sort((a, b) => b.importance - a.importance)
        .slice(0, 5)
        .map(enrichEvent);

    // Recently finished (last 5)
    const recentlyFinished = allToday
        .filter((e) => e.status === "finished")
        .sort((a, b) => (b.kickoff || "").localeCompare(a.kickoff || ""))
        .slice(0, 5)
        .map(({ id, sport, league, homeTeam, awayTeam, kickoff, score, thumbnail }) => ({
            id, sport, league, homeTeam, awayTeam, kickoff, score, thumbnail,
        }));

    return {
        featuredEvents,
        liveNow:              allLive.length,
        todayMatches,
        upcomingHighlights,
        recommendedChannels:  (epgReco.sports || []).slice(0, 15),
        recentlyFinished,
        updatedAt:            new Date().toISOString(),
    };
}

// Expose matcher invalidation so controllers can force rebuild after channel changes
function invalidateMatcher() {
    if (_matcher) _matcher.invalidate();
    _matcher = null;
}

module.exports = {
    getLiveEvents,
    getTodayEvents,
    getUpcomingEvents,
    getEventById,
    getEventChannels,
    getFeaturedEvents,
    enrichEvent,
    invalidateMatcher,
};
