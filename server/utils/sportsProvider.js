"use strict";

/**
 * sportsProvider.js — Provider Interface + TheSportsDB Implementation
 *
 * Every sports provider implements:
 *   fetchTodayEvents()    → NormalizedEvent[]
 *   fetchLiveEvents()     → NormalizedEvent[]
 *   fetchUpcomingEvents() → NormalizedEvent[]
 *   normalize(raw)        → NormalizedEvent
 *
 * NormalizedEvent schema:
 * {
 *   id, sport, league, season, round,
 *   homeTeam, awayTeam, kickoff (ISO string), status,
 *   venue, country, thumbnail, poster, banner,
 *   score: { home, away }, importance, provider, lastUpdated
 * }
 *
 * Add future providers (ESPN, Sofascore, etc.) by creating a new class
 * that extends SportsProvider — nothing else changes.
 */

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36";
const FETCH_TIMEOUT = 12_000;

// ─── Status normalisation ─────────────────────────────────────────────────────
// TheSportsDB strStatus values → our canonical set
const STATUS_MAP = {
    "Match Finished": "finished",
    FT: "finished",
    AET: "finished",
    PEN: "finished",
    "Not Started": "upcoming",
    NS: "upcoming",
    "1H": "live",
    "2H": "live",
    HT: "live",
    ET: "live",
    P: "live",
    BT: "live",
    LIVE: "live",
    Postponed: "postponed",
    Cancelled: "cancelled",
    Abandoned: "cancelled",
    TBD: "upcoming",
};

function normaliseStatus(raw) {
    return STATUS_MAP[raw] || (raw ? raw.toLowerCase() : "unknown");
}

// ─── Importance scoring ───────────────────────────────────────────────────────
const HIGH_IMPORTANCE_LEAGUES = new Set([
    "english premier league",
    "la liga",
    "serie a",
    "bundesliga",
    "ligue 1",
    "uefa champions league",
    "uefa europa league",
    "fifa world cup",
    "copa america",
    "uefa european championship",
    "ipl",
    "bpl",
    "cpl",
    "nba",
    "nfl",
    "nhl",
    "mlb",
    "formula 1",
    "wimbledon",
    "us open",
    "australian open",
    "roland garros",
    "super bowl",
    "olympic games",
    "asian games",
    "commonwealth games",
]);

function scoreImportance(event) {
    let score = 30;
    const leagueLower = (event.league || "").toLowerCase();
    if (HIGH_IMPORTANCE_LEAGUES.has(leagueLower)) score += 40;
    else if (leagueLower.includes("world") || leagueLower.includes("olympic")) score += 35;
    else if (leagueLower.includes("champion") || leagueLower.includes("cup")) score += 20;
    if (event.status === "live") score += 25;
    if (event.status === "upcoming") score += 5;
    return Math.min(100, score);
}

// ─── Base class ───────────────────────────────────────────────────────────────

class SportsProvider {
    constructor(name) {
        this.name = name;
    }

    async fetchTodayEvents() {
        throw new Error("fetchTodayEvents() not implemented");
    }
    async fetchLiveEvents() {
        throw new Error("fetchLiveEvents() not implemented");
    }
    async fetchUpcomingEvents() {
        throw new Error("fetchUpcomingEvents() not implemented");
    }
    normalize(_raw) {
        throw new Error("normalize() not implemented");
    }

    /** Shared fetch helper with timeout + UA */
    async _fetch(url) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
        try {
            const res = await fetch(url, {
                headers: { "User-Agent": BROWSER_UA, Accept: "application/json" },
                signal: ctrl.signal,
            });
            if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
            return res.json();
        } finally {
            clearTimeout(timer);
        }
    }
}

// ─── TheSportsDB Provider ─────────────────────────────────────────────────────

class TheSportsDBProvider extends SportsProvider {
    /**
     * @param {object} config
     * @param {string} config.apiKey   — from THESPORTSDB_API_KEY env var
     * @param {string} [config.sport]  — default sport filter (e.g. "Soccer")
     */
    constructor(config = {}) {
        super("TheSportsDB");
        this._key = config.apiKey || process.env.THESPORTSDB_API_KEY || "";
        this._sport = config.sport || null; // null = all sports
        this._v2 = config.v2 ?? false; // true for Patreon v2 key

        // "123" is TheSportsDB's public free test key — it never has v2 access,
        // no matter what THESPORTSDB_V2 is set to in .env. Forcing v2 on with
        // this key is exactly why eventsday.php/livescore.php were 404ing.
        if (this._key === "123" && this._v2) {
            console.warn('[Sports] THESPORTSDB_V2=true but using the free test key "123" — forcing v1 (v2 needs a real Patreon key)');
            this._v2 = false;
        }

        if (!this._key) console.warn("[Sports] THESPORTSDB_API_KEY not set — sports events disabled");
    }

    _base() {
        const ver = this._v2 ? "v2" : "v1";
        return `https://www.thesportsdb.com/api/${ver}/json/${this._key}`;
    }

    /** Today's events, optionally filtered by sport */
    async fetchTodayEvents() {
        if (!this._key) return [];
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const url = `${this._base()}/eventsday.php?d=${today}${this._sport ? `&s=${encodeURIComponent(this._sport)}` : ""}`;
        const data = await this._fetch(url);
        return (data.events || []).map((e) => this.normalize(e));
    }

    /** Live events (v2 / Patreon key only) */
    async fetchLiveEvents() {
        if (!this._key) return [];
        // Free v1 key ("123" default) has no livescore access — TheSportsDB
        // returns 404/403 for it. Skip the network call entirely instead of
        // hitting it every interval and spamming the console.
        if (!this._v2) {
            if (!TheSportsDBProvider._loggedNoV2) {
                console.warn("[Sports] Free v1 key detected — livescore disabled (needs THESPORTSDB_V2=true + Patreon key). This is expected, not an error.");
                TheSportsDBProvider._loggedNoV2 = true;
            }
            return [];
        }
        try {
            const sport = this._sport || "Soccer";
            const url = `${this._base()}/livescore.php?s=${encodeURIComponent(sport)}`;
            const data = await this._fetch(url);
            return (data.livescore || data.events || []).map((e) => this.normalize(e));
        } catch (err) {
            // v1 free key (or a bad/expired v2 key) returns 403/404 for livescore
            if (err.message.includes("403") || err.message.includes("401") || err.message.includes("404")) {
                if (!TheSportsDBProvider._loggedNoV2) {
                    console.warn("[Sports] livescore unavailable for this API key — skipping live fetch (won't repeat this log)");
                    TheSportsDBProvider._loggedNoV2 = true;
                }
                return [];
            }
            throw err;
        }
    }

    /** Upcoming events for configured leagues */
    async fetchUpcomingEvents() {
        if (!this._key) return [];
        // TheSportsDB: next 15 events for a league.
        // We fetch for the top leagues and dedupe.
        const LEAGUES = [
            "4328", // Premier League
            "4335", // La Liga
            "4332", // Bundesliga
            "4480", // Ligue 1
            "4334", // Serie A
            "4399", // Champions League
            "4343", // NBA
            "4391", // NFL
        ];

        const results = await Promise.allSettled(LEAGUES.map((id) => this._fetch(`${this._base()}/eventsnextleague.php?id=${id}`)));

        const seen = new Set();
        const events = [];
        for (const r of results) {
            if (r.status !== "fulfilled") continue;
            for (const e of r.value.events || []) {
                if (!seen.has(e.idEvent)) {
                    seen.add(e.idEvent);
                    events.push(this.normalize(e));
                }
            }
        }
        return events;
    }

    /**
     * Normalize a raw TheSportsDB event → our standard schema.
     * Field reference: https://www.thesportsdb.com/api.php
     */
    normalize(raw) {
        // Parse kickoff: combine dateEvent + strTime or use strTimestamp
        let kickoff = null;
        if (raw.strTimestamp) {
            kickoff = new Date(raw.strTimestamp).toISOString();
        } else if (raw.dateEvent && raw.strTime) {
            kickoff = new Date(`${raw.dateEvent}T${raw.strTime}Z`).toISOString();
        } else if (raw.dateEvent) {
            kickoff = new Date(`${raw.dateEvent}T00:00:00Z`).toISOString();
        }

        // Estimated end time: kickoff + 2h for most sports
        const endTime = kickoff ? new Date(new Date(kickoff).getTime() + 2 * 60 * 60 * 1000).toISOString() : null;

        const status = normaliseStatus(raw.strStatus || raw.strPostponed);

        const event = {
            id: String(raw.idEvent || ""),
            sport: raw.strSport || "Unknown",
            league: raw.strLeague || "Unknown",
            season: raw.strSeason || null,
            round: raw.intRound != null ? String(raw.intRound) : null,
            homeTeam: raw.strHomeTeam || "TBD",
            awayTeam: raw.strAwayTeam || "TBD",
            kickoff,
            endTime,
            status,
            venue: raw.strVenue || null,
            country: raw.strCountry || null,
            thumbnail: raw.strThumb || null,
            poster: raw.strPoster || null,
            banner: raw.strBanner || null,
            score: {
                home: raw.intHomeScore != null ? Number(raw.intHomeScore) : null,
                away: raw.intAwayScore != null ? Number(raw.intAwayScore) : null,
            },
            importance: 0, // filled below
            provider: "thesportsdb",
            lastUpdated: new Date().toISOString(),
        };

        event.importance = scoreImportance(event);
        return event;
    }
}

// Module-level flag — the "no v2 access" warning should only ever print once
// per process lifetime, not every 60s refresh cycle.
TheSportsDBProvider._loggedNoV2 = false;

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * createSportsProvider(config)
 *
 * config.provider: "thesportsdb" (default)
 *
 * Returns a SportsProvider instance. Add more cases here for future providers.
 */
function createSportsProvider(config = {}) {
    const name = (config.provider || "thesportsdb").toLowerCase();
    switch (name) {
        case "thesportsdb":
            return new TheSportsDBProvider(config);
        default:
            throw new Error(`Unknown sports provider: ${name}`);
    }
}

module.exports = {
    SportsProvider,
    TheSportsDBProvider,
    createSportsProvider,
    normaliseStatus,
    scoreImportance,
};
