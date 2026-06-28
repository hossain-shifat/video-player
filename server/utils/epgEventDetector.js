"use strict";

/**
 * epgEventDetector.js — Live Event Detection + Recommendation Engine
 *
 * Scans current programme titles/categories for sports, news, entertainment events.
 * Keyword config is loaded from data/epg/event-keywords.json (user-configurable).
 * Falls back to built-in defaults if file is missing.
 *
 * Returns structured data — never makes UI decisions.
 */

const fs   = require("fs");
const path = require("path");

const KEYWORDS_FILE = path.join(__dirname, "..", "data", "epg", "event-keywords.json");

// ─── Default keyword config ───────────────────────────────────────────────────

const DEFAULT_KEYWORDS = {
    sports: {
        keywords: [
            "fifa","world cup","uefa","champions league","premier league","la liga",
            "serie a","bundesliga","cricket","ipl","bpl","cpl","t20","odi","test match",
            "nba","nfl","nhl","mlb","formula 1","f1","grand prix","tennis","wimbledon",
            "olympics","olympic","athletics","rugby","boxing","ufc","mma","basketball",
            "baseball","volleyball","golf","cycling","tour de france","super bowl",
            "euro","copa america","asian cup","afcon",
        ],
        categories: ["sports","sport","football","cricket","basketball","tennis","golf"],
        importanceBase: 70,
    },
    news: {
        keywords: [
            "breaking","breaking news","special report","live coverage","election",
            "emergency","earthquake","hurricane","tornado","flood","war","conflict",
            "attack","crisis","summit","vote","referendum","assassination","disaster",
        ],
        categories: ["news","current affairs","documentary"],
        importanceBase: 60,
    },
    entertainment: {
        keywords: [
            "premiere","series finale","finale","live concert","award","awards",
            "oscars","grammys","emmys","bafta","live show","talent show",
        ],
        categories: ["entertainment","music","comedy"],
        importanceBase: 40,
    },
    kids: {
        keywords: ["cartoon","animation","kids","children","family","nursery"],
        categories: ["kids","children","animation","cartoon","family"],
        importanceBase: 30,
    },
    movies: {
        keywords: ["movie","film","cinema","blockbuster","thriller","drama","comedy film"],
        categories: ["movies","films","cinema","movie"],
        importanceBase: 30,
    },
};

// ─── High-importance sports keywords (importance multiplier) ──────────────────
const HIGH_IMPORTANCE = ["world cup","olympics","champions league","super bowl","grand prix","wimbledon","ipl","bpl"];

// ─── Keyword loader ───────────────────────────────────────────────────────────

function loadKeywords() {
    try { return JSON.parse(fs.readFileSync(KEYWORDS_FILE, "utf-8")); }
    catch { return DEFAULT_KEYWORDS; }
}

function saveKeywords(kw) {
    const tmp = `${KEYWORDS_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(kw, null, 2), "utf-8");
    fs.renameSync(tmp, KEYWORDS_FILE);
}

// ─── Event scoring ────────────────────────────────────────────────────────────

function scoreEvent(prog, type, config) {
    const text = `${prog.title || ""} ${prog.subtitle || ""} ${prog.category || ""}`.toLowerCase();
    let score = 0;

    for (const kw of config.keywords) {
        if (text.includes(kw)) {
            score += HIGH_IMPORTANCE.some((h) => text.includes(h)) ? 30 : 10;
        }
    }
    for (const cat of config.categories) {
        if ((prog.category || "").toLowerCase().includes(cat)) score += 15;
    }

    return score > 0 ? Math.min(100, config.importanceBase + score) : 0;
}

// ─── Event detection ─────────────────────────────────────────────────────────

/**
 * Scans currently-airing programmes and classifies events.
 *
 * @param {Array<{ channelId, programme }>} nowPlaying — from nowCache, working channels only
 * @param {Array} liveRows — for channel metadata (name, logo)
 * @returns {{ featuredEvents, sports, news, entertainment, kids, movies, updatedAt }}
 */
function detectEvents(nowPlaying, liveRows) {
    const kw = loadKeywords();
    const rowById = new Map(liveRows.map((r) => [r.id, r]));

    const events = {
        featuredEvents: [],
        sports:         [],
        news:           [],
        entertainment:  [],
        kids:           [],
        movies:         [],
        updatedAt:      new Date().toISOString(),
    };

    for (const { channelId, programme: prog } of nowPlaying) {
        const channel = rowById.get(channelId);
        const base = {
            channelId,
            channelName: channel?.cleanName || channel?.name || channelId,
            channelLogo: channel?.logo || null,
            programme:   prog,
            startTime:   prog.start,
            endTime:     prog.end,
        };

        // Score against each event type
        const scores = {};
        for (const [type, config] of Object.entries(kw)) {
            scores[type] = scoreEvent(prog, type, config);
        }

        const bestType  = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
        const topScore  = bestType?.[1] || 0;
        const topType   = bestType?.[0];

        if (topScore >= 40) {
            events.featuredEvents.push({
                ...base,
                eventType:  topType,
                eventName:  prog.title,
                importance: topScore,
            });
        }

        // Add to type-specific buckets (even if not "featured")
        for (const [type, score] of Object.entries(scores)) {
            if (score > 0 && type in events) {
                events[type].push({ ...base, importance: score });
            }
        }
    }

    // Sort each bucket by importance desc
    for (const key of Object.keys(events)) {
        if (Array.isArray(events[key])) {
            events[key].sort((a, b) => (b.importance || 0) - (a.importance || 0));
        }
    }

    // Cap to reasonable sizes
    events.featuredEvents = events.featuredEvents.slice(0, 20);
    events.sports         = events.sports.slice(0, 50);
    events.news           = events.news.slice(0, 30);

    return events;
}

// ─── Recommendation builder ───────────────────────────────────────────────────

/**
 * Builds the recommendation payload from event cache.
 * Only includes working-stream channels (enforced upstream via nowPlaying filter).
 *
 * @returns {{ sports, news, kids, movies, featuredEvents, updatedAt }}
 */
function buildRecommendations(eventsCache, liveRows) {
    const rowById = new Map(liveRows.map((r) => [r.id, r]));

    function toReco(event) {
        const row = rowById.get(event.channelId) || {};
        return {
            channelId:    event.channelId,
            channelName:  event.channelName || row.cleanName || row.name,
            channelLogo:  event.channelLogo || row.logo || null,
            streamUrl:    row.url || null,
            resolution:   row.resolution || null,
            isHD:         row.isHD || false,
            programme:    event.programme,
            importance:   event.importance || 0,
        };
    }

    return {
        featuredEvents: (eventsCache.featuredEvents || []).slice(0, 10).map(toReco),
        sports:         (eventsCache.sports         || []).slice(0, 20).map(toReco),
        news:           (eventsCache.news           || []).slice(0, 10).map(toReco),
        entertainment:  (eventsCache.entertainment  || []).slice(0, 10).map(toReco),
        kids:           (eventsCache.kids           || []).slice(0, 10).map(toReco),
        movies:         (eventsCache.movies         || []).slice(0, 10).map(toReco),
        updatedAt:      new Date().toISOString(),
    };
}

module.exports = {
    detectEvents,
    buildRecommendations,
    loadKeywords,
    saveKeywords,
    DEFAULT_KEYWORDS,
};
