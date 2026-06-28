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
