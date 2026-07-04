"use strict";

/**
 * epgMatcher.js — Channel Matching Engine
 *
 * Matches XMLTV channel IDs/names to live.json channel records.
 *
 * Match priority (highest → lowest):
 *   1. tvg-id exact match
 *   2. xmltv channel id exact match
 *   3. tvg-name normalized match
 *   4. channel name normalized match
 *   5. fuzzy match (Jaro-Winkler similarity ≥ 0.88)
 *   6. alias map lookup (user-defined overrides)
 *
 * Normalization: lowercase, strip non-alphanumeric, strip common suffixes
 * (hd, fhd, uhd, sd, tv, channel, plus, the).
 */

const fs   = require("fs");
const path = require("path");

const ALIAS_FILE = path.join(__dirname, "..", "data", "epg", "channel-aliases.json");

// Load alias map: { "xmltvChannelId": "liveChannelId", ... }
function loadAliases() {
    try { return JSON.parse(fs.readFileSync(ALIAS_FILE, "utf-8")); }
    catch { return {}; }
}

function saveAliases(aliases) {
    const tmp = `${ALIAS_FILE}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(aliases, null, 2), "utf-8");
    fs.renameSync(tmp, ALIAS_FILE);
}

// ─── Normalization ────────────────────────────────────────────────────────────

const STRIP_SUFFIXES = /(hd|fhd|uhd|4k|sd|tv|channel|plus|the|bangla|network|news|entertainment|sports|media)$/g;

function normalize(s) {
    return (s || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")   // strip non-alnum
        .replace(STRIP_SUFFIXES, "")  // strip noise suffixes
        .replace(/\s+/g, "")
        .trim();
}

// Slightly looser: also strip digits at end (e.g. "bbcnews1" → "bbcnews")
function normalizeLoose(s) {
    return normalize(s).replace(/\d+$/, "");
}

// ─── Jaro-Winkler similarity ──────────────────────────────────────────────────
// Fast pure-JS implementation — no external dep needed.

function jaroWinkler(s1, s2) {
    if (s1 === s2) return 1;
    const l1 = s1.length, l2 = s2.length;
    if (!l1 || !l2) return 0;

    const matchDist = Math.floor(Math.max(l1, l2) / 2) - 1;
    const s1m = new Array(l1).fill(false);
    const s2m = new Array(l2).fill(false);
    let matches = 0, transpositions = 0;

    for (let i = 0; i < l1; i++) {
        const lo = Math.max(0, i - matchDist);
        const hi = Math.min(i + matchDist + 1, l2);
        for (let j = lo; j < hi; j++) {
            if (s2m[j] || s1[i] !== s2[j]) continue;
            s1m[i] = s2m[j] = true;
            matches++;
            break;
        }
    }
    if (!matches) return 0;

    let k = 0;
    for (let i = 0; i < l1; i++) {
        if (!s1m[i]) continue;
        while (!s2m[k]) k++;
        if (s1[i] !== s2[k]) transpositions++;
        k++;
    }

    const jaro = (matches / l1 + matches / l2 + (matches - transpositions / 2) / matches) / 3;
    const prefix = Math.min(4, [...Array(Math.min(l1, l2))].findIndex((_, i) => s1[i] !== s2[i]));
    return jaro + prefix * 0.1 * (1 - jaro);
}

const FUZZY_THRESHOLD = 0.88;

// ─── Index builder ────────────────────────────────────────────────────────────

/**
 * Build lookup indices from live.json flat channel rows.
 *
 * Returns:
 *  byTvgId    — Map<tvgId_lower, channelRow>
 *  byNormName — Map<normalized_name, channelRow>
 *  byLoose    — Map<loose_name, channelRow>
 *  allRows    — Array<channelRow>  (for fuzzy scan)
 */
function buildLiveIndex(liveRows) {
    const byTvgId    = new Map();
    const byNormName = new Map();
    const byLoose    = new Map();

    for (const row of liveRows) {
        // tvg-id
        if (row.tvgId) {
            const k = row.tvgId.toLowerCase();
            if (!byTvgId.has(k)) byTvgId.set(k, row);
        }
        // tvg-name normalized
        if (row.tvgName) {
            const k = normalize(row.tvgName);
            if (k && !byNormName.has(k)) byNormName.set(k, row);
        }
        // display name normalized
        const n = normalize(row.cleanName || row.name);
        if (n && !byNormName.has(n)) byNormName.set(n, row);

        // loose
        const l = normalizeLoose(row.cleanName || row.name);
        if (l && !byLoose.has(l)) byLoose.set(l, row);
    }

    return { byTvgId, byNormName, byLoose, allRows: liveRows };
}

// ─── Matcher ──────────────────────────────────────────────────────────────────

class ChannelMatcher {
    /**
     * @param {Array} liveRows — flat channel rows from buildFlatRows()
     */
    constructor(liveRows) {
        this._index   = buildLiveIndex(liveRows);
        this._aliases = loadAliases();
        this._cache   = new Map(); // xmltvId → liveRow | null
    }

    /**
     * Find the best live channel row for an XMLTV channel.
     *
     * @param {{ id, name, tvgId? }} xmltvChannel
     * @returns {{ row, method }} | null
     */
    match(xmltvChannel) {
        const { id, name } = xmltvChannel;
        const cacheKey = id;
        if (this._cache.has(cacheKey)) return this._cache.get(cacheKey);

        let result = null;

        // 0. Alias override
        const aliasTarget = this._aliases[id];
        if (aliasTarget) {
            const row = this._index.allRows.find((r) => r.id === aliasTarget || r.tvgId === aliasTarget);
            if (row) { result = { row, method: "alias" }; }
        }

        // 1. tvg-id exact
        if (!result && id) {
            const row = this._index.byTvgId.get(id.toLowerCase());
            if (row) result = { row, method: "tvgid_exact" };
        }

        // 2. xmltv id as tvg-name
        if (!result && id) {
            const row = this._index.byTvgId.get(normalize(id));
            if (row) result = { row, method: "tvgid_norm" };
        }

        // 3. name normalized exact
        if (!result && name) {
            const k   = normalize(name);
            const row = this._index.byNormName.get(k);
            if (row) result = { row, method: "name_norm" };
        }

        // 4. loose name match
        if (!result && name) {
            const k   = normalizeLoose(name);
            const row = this._index.byLoose.get(k);
            if (row) result = { row, method: "name_loose" };
        }

        // 5. Fuzzy (Jaro-Winkler) — scan all rows, expensive but only runs on misses
        if (!result && name) {
            const normName = normalize(name);
            let bestScore  = FUZZY_THRESHOLD;
            let bestRow    = null;
            for (const row of this._index.allRows) {
                const candNorm = normalize(row.cleanName || row.name);
                const score    = jaroWinkler(normName, candNorm);
                if (score > bestScore) { bestScore = score; bestRow = row; }
            }
            if (bestRow) result = { row: bestRow, method: `fuzzy(${bestScore.toFixed(2)})` };
        }

        this._cache.set(cacheKey, result);
        return result;
    }

    /**
     * Batch-match all XMLTV channels. Returns Map<xmltvId, { row, method }>.
     */
    matchAll(xmltvChannels) {
        const results = new Map();
        for (const ch of xmltvChannels.values()) {
            const m = this.match(ch);
            if (m) results.set(ch.id, m);
        }
        return results;
    }

    /** Set a manual alias: xmltvChannelId → liveChannelId */
    setAlias(xmltvId, liveId) {
        this._aliases[xmltvId] = liveId;
        saveAliases(this._aliases);
        this._cache.delete(xmltvId);
    }

    /** Remove an alias */
    removeAlias(xmltvId) {
        delete this._aliases[xmltvId];
        saveAliases(this._aliases);
        this._cache.delete(xmltvId);
    }

    getAliases() { return { ...this._aliases }; }
}

module.exports = { ChannelMatcher, normalize, normalizeLoose, jaroWinkler };

// ─── Sports Event → Channel Matcher ──────────────────────────────────────────
// Extends the existing ChannelMatcher infrastructure without modifying it.
// Sports events don't have tvg-ids — matching is purely name/keyword based.
//
// Matching strategy (applied in order, all that score above threshold kept):
//   1. Exact broadcast keyword  — channel name contains league/team literal
//   2. Normalised keyword       — after stripping noise suffixes
//   3. Fuzzy keyword            — Jaro-Winkler ≥ 0.85 against channel name
//   4. Sport-category match     — channel category tag matches sport type
//
// TEAM_ALIASES and LEAGUE_ALIASES let admins add known broadcast mappings
// without modifying code (future: load from data/epg/sports-aliases.json).

const fs2   = require("fs");
const path2 = require("path");

const SPORT_ALIASES_FILE = path2.join(__dirname, "..", "data", "epg", "sports-aliases.json");

// Default built-in league → channel keyword aliases
const DEFAULT_LEAGUE_ALIASES = {
    "english premier league": ["bein sports", "sky sports", "espn", "star sports", "now tv"],
    "uefa champions league":  ["bein sports", "cbs sports", "bt sport", "sony sports"],
    "nba":                    ["espn", "tnt", "nba tv", "abc"],
    "ipl":                    ["star sports", "hotstar", "willow"],
    "bpl":                    ["sony sports", "t sports", "gazi tv", "channel 9 bd"],
    "formula 1":              ["sky sports f1", "f1 tv", "espn"],
};

// Sport type → channel category keywords
const SPORT_CATEGORY_MAP = {
    "soccer":     ["sport", "football", "soccer", "bein", "espn", "sky sports"],
    "football":   ["sport", "football", "nfl", "espn", "fox sports"],
    "basketball": ["sport", "basketball", "nba", "espn", "tnt"],
    "cricket":    ["sport", "cricket", "star sports", "sony sports", "t sports"],
    "tennis":     ["sport", "tennis", "eurosport"],
    "formula 1":  ["sport", "formula", "f1", "sky sports"],
    "baseball":   ["sport", "baseball", "mlb", "espn"],
    "ice hockey": ["sport", "hockey", "nhl", "espn"],
};

function loadSportsAliases() {
    try { return JSON.parse(fs2.readFileSync(SPORT_ALIASES_FILE, "utf-8")); }
    catch { return { leagues: DEFAULT_LEAGUE_ALIASES, teams: {} }; }
}

const FUZZY_SPORTS_THRESHOLD = 0.85;

class SportsEventMatcher {
    /**
     * @param {Array} liveRows — flat channel rows (same as ChannelMatcher input)
     */
    constructor(liveRows) {
        this._rows    = liveRows;
        this._aliases = loadSportsAliases();
        // Only include working channels in sports recommendations
        this._working = liveRows.filter((r) => r.streamStatus === "working");
        this._cache   = new Map(); // eventId → matchedRow[]
    }

    /**
     * Find all live channels that likely broadcast a sports event.
     * Consults the Hybrid EPG Engine (via nowCache) to further validate.
     *
     * @param {object} event — NormalizedEvent from sportsStore
     * @param {Map}    nowCache — from epgScheduler.getNowCache()
     * @returns {Array<{ row, method, epgMatch }>}
     */
    matchEvent(event, nowCache = new Map()) {
        const cacheKey = `${event.id}:${event.status}`;
        if (this._cache.has(cacheKey)) return this._cache.get(cacheKey);

        const results = [];
        const seen    = new Set();

        const leagueLower  = (event.league   || "").toLowerCase();
        const homeTeamLow  = (event.homeTeam || "").toLowerCase();
        const awayTeamLow  = (event.awayTeam || "").toLowerCase();
        const sportLower   = (event.sport    || "").toLowerCase();
        const normLeague   = normalize(event.league   || "");
        const normHome     = normalize(event.homeTeam || "");
        const normAway     = normalize(event.awayTeam || "");

        // League alias hints — known broadcast rights mappings
        const leagueHints = new Set();
        for (const [alias, keywords] of Object.entries(this._aliases.leagues || {})) {
            if (leagueLower.includes(alias) || normalize(alias) === normLeague) {
                for (const kw of keywords) leagueHints.add(normalize(kw));
            }
        }

        // Team alias hints
        const teamHints = new Set();
        for (const [team, keywords] of Object.entries(this._aliases.teams || {})) {
            const tn = normalize(team);
            if (tn === normHome || tn === normAway) {
                for (const kw of keywords) teamHints.add(normalize(kw));
            }
        }

        // Sport category keywords
        const categoryHints = new Set(
            (SPORT_CATEGORY_MAP[sportLower] || SPORT_CATEGORY_MAP["soccer"] || [])
                .map((k) => normalize(k))
        );

        for (const row of this._working) {
            if (seen.has(row.id)) continue;

            const rowName     = normalize(row.cleanName || row.name);
            const rowNameFull = (row.cleanName || row.name || "").toLowerCase();
            const rowCat      = normalize(row.category || "");
            let   method      = null;

            // 1. League alias hit (strongest signal — known broadcast rights)
            if (leagueHints.size > 0) {
                for (const hint of leagueHints) {
                    if (rowName.includes(hint) || hint.includes(rowName)) {
                        method = "league_alias"; break;
                    }
                }
            }

            // 2. Team alias hit
            if (!method && teamHints.size > 0) {
                for (const hint of teamHints) {
                    if (rowName.includes(hint)) { method = "team_alias"; break; }
                }
            }

            // 3. Direct team name in channel name (e.g. "Argentina TV")
            if (!method) {
                if ((homeTeamLow && rowNameFull.includes(homeTeamLow)) ||
                    (awayTeamLow && rowNameFull.includes(awayTeamLow))) {
                    method = "team_name_exact";
                }
            }

            // 4. Normalised league name in channel name
            if (!method && normLeague && rowName.includes(normLeague)) {
                method = "league_name_norm";
            }

            // 5. Sport category keyword hit
            if (!method) {
                for (const hint of categoryHints) {
                    if (rowName.includes(hint) || rowCat.includes(hint)) {
                        method = "category_hint"; break;
                    }
                }
            }

            // 6. Fuzzy match against home/away team
            if (!method) {
                const scoreHome = jaroWinkler(rowName, normHome);
                const scoreAway = jaroWinkler(rowName, normAway);
                const best = Math.max(scoreHome, scoreAway);
                if (best >= FUZZY_SPORTS_THRESHOLD) {
                    method = `fuzzy(${best.toFixed(2)})`;
                }
            }

            if (!method) continue;
            seen.add(row.id);

            // Cross-reference EPG now-cache: does this channel's current programme
            // mention the event teams or league? Boosts confidence.
            let epgMatch = null;
            const nowData = nowCache.get(row.id);
            if (nowData?.now) {
                const progText = `${nowData.now.title || ""} ${nowData.now.subtitle || ""} ${nowData.now.category || ""}`.toLowerCase();
                if (progText.includes(homeTeamLow) || progText.includes(awayTeamLow) ||
                    progText.includes(leagueLower)) {
                    epgMatch = nowData.now;
                }
            }

            results.push({ row, method, epgMatch });
        }

        // Sort: EPG-confirmed first, then by method quality
        const METHOD_RANK = { league_alias: 0, team_alias: 1, team_name_exact: 2, league_name_norm: 3, category_hint: 4 };
        results.sort((a, b) => {
            // EPG-confirmed always wins
            if (a.epgMatch && !b.epgMatch) return -1;
            if (!a.epgMatch && b.epgMatch)  return 1;
            const ra = METHOD_RANK[a.method] ?? 9;
            const rb = METHOD_RANK[b.method] ?? 9;
            return ra - rb;
        });

        this._cache.set(cacheKey, results);
        return results;
    }

    /** Convenience: returns only working channel rows for an event */
    matchWorking(event, nowCache) {
        return this.matchEvent(event, nowCache).map((m) => ({
            ...m.row,
            matchMethod: m.method,
            epgConfirmed: !!m.epgMatch,
            currentProgramme: m.epgMatch || null,
        }));
    }

    /** Invalidate cache (call when channel list or event status changes) */
    invalidate() { this._cache.clear(); }
}

// Re-export with SportsEventMatcher added
Object.assign(module.exports, { SportsEventMatcher });
