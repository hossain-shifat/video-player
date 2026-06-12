"use strict";

const fs = require("fs");
const path = require("path");
const { parseFilename } = require("./nameParser");
const { lookupMetadata } = require("./tmdb");

const STORE_FILE = path.join(__dirname, "..", "data", "metadata.json");

// ── Version history ────────────────────────────────────────────────────────────
// Bump whenever parser logic or TMDB matching changes significantly.
// All cache entries below this version are purged at startup and re-fetched.
//
//   1-3 — original parser iterations
//   4   — fuzzy year (±1), title similarity scoring
//   5-6 — intermediate fixes
//   7   — error swallowing fix (network errors no longer cached as _notFound)
//   8   — TMDB dual auth (Bearer + api_key), Friends 1x01 title fix,
//          parsed object no longer stored in cache (cleaner media.json)
//   9   — expanded schema: ratings{tmdb,imdb,rt,metascore}, reviews, keywords,
//          watchProviders, crew, cast.tmdbPersonId, videos[], tmdbEpisodeId,
//          guestStars, networks, collection, contentRating, imdbId
const PARSER_VERSION = 10;

// _notFound entries expire after 7 days — prevents permanently cached misses
// from a bad API key or transient network failure blocking real lookups.
const NOT_FOUND_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let store = new Map();
let dirty = false;
let saveTimer = null;
let storeLoaded = false;

// ─── Disk I/O ─────────────────────────────────────────────────────────────────

function loadStore() {
    if (storeLoaded) return;
    storeLoaded = true;
    try {
        const raw = fs.readFileSync(STORE_FILE, "utf-8");
        const obj = JSON.parse(raw);
        store = new Map(Object.entries(obj));
        console.log(`[Metadata] Loaded ${store.size} cached entries`);
    } catch {
        store = new Map();
        console.log("[Metadata] No cache file found, starting fresh");
    }
}

function scheduleSave() {
    dirty = true;
    if (saveTimer) return;
    saveTimer = setTimeout(async () => {
        saveTimer = null;
        if (!dirty) return;
        dirty = false;
        try {
            const obj = Object.fromEntries(store);
            const tmp = `${STORE_FILE}.tmp.${process.pid}.${Date.now()}`;
            const fd = await fs.promises.open(tmp, "w");
            try {
                await fd.writeFile(JSON.stringify(obj, null, 2), "utf-8");
                await fd.sync();
            } finally {
                await fd.close();
            }
            await fs.promises.rename(tmp, STORE_FILE);
        } catch (err) {
            console.error("[Metadata] Save failed:", err.message);
        }
    }, 2000);
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

function isCacheValid(entry) {
    if (!entry) return false;
    if ((entry._parserVersion ?? 0) < PARSER_VERSION) return false;
    if (entry._notFound) {
        const age = Date.now() - new Date(entry._cachedAt).getTime();
        return age < NOT_FOUND_TTL_MS;
    }
    return true;
}

function getCached(fileId) {
    loadStore();
    const entry = store.get(fileId);
    if (!entry || !isCacheValid(entry)) return null;
    return entry;
}

function setCache(fileId, metadata) {
    // ── FIX: Do NOT persist the 'parsed' object into the cache ────────────────
    // parsed is internal parser data (episodes array, confidence score, codec,
    // resolution, languages, etc.) that is useful during enrichment but bloats
    // metadata.json and is re-generated on each request anyway.
    //
    // The stored entry contains only clean TMDB data:
    //   title, year, overview, poster, backdrop, genres, cast, trailer, ...
    const { parsed: _drop, ...cleanMetadata } = metadata;

    store.set(fileId, {
        ...cleanMetadata,
        _parserVersion: PARSER_VERSION,
        _cachedAt: new Date().toISOString(),
    });
    scheduleSave();
}

function setNotFound(fileId, title) {
    store.set(fileId, {
        _notFound: true,
        _title: title,
        _parserVersion: PARSER_VERSION,
        _cachedAt: new Date().toISOString(),
    });
    scheduleSave();
}

function invalidate(fileId) {
    store.delete(fileId);
    scheduleSave();
}

function invalidateAll() {
    store.clear();
    storeLoaded = false;
    scheduleSave();
}

function purgeStaleEntries() {
    loadStore();
    if (store.size === 0) return;
    let purged = 0;
    for (const [key, value] of store) {
        if (!isCacheValid(value)) {
            store.delete(key);
            purged++;
        }
    }
    if (purged > 0) {
        console.log(`[Metadata] Purged ${purged} stale entries (→ v${PARSER_VERSION})`);
        scheduleSave();
    }
}

// ─── Main entry ───────────────────────────────────────────────────────────────

/**
 * Given { id, name } returns enriched TMDB metadata (or null if no match).
 *
 * Cache behaviour:
 *   HIT  (valid version, not _notFound) → return immediately, no network call
 *   HIT  (_notFound, within TTL)        → return null immediately
 *   HIT  (_notFound, expired)           → purge + re-fetch
 *   MISS or stale version               → fetch from TMDB, cache result
 *
 * Network/auth errors are NOT cached — next request will retry TMDB.
 * Genuine "no result" responses ARE cached (for NOT_FOUND_TTL_MS).
 */
async function getMetadata(file) {
    loadStore();

    const cached = store.get(file.id);
    if (cached && isCacheValid(cached)) {
        if (cached._notFound) return null;
        return cached;
    }

    // Stale or missing — re-fetch
    const parsed = parseFilename(file.name);

    console.log(
        `[Metadata] Fetching: "${parsed.title}"` +
            ` type=${parsed.type}` +
            (parsed.year ? ` year=${parsed.year}` : "") +
            (parsed.season != null ? ` S${String(parsed.season).padStart(2, "0")}` : "") +
            (parsed.part != null ? ` Part ${parsed.part}` : ""),
    );

    let metadata;
    try {
        metadata = await lookupMetadata(parsed);
    } catch (err) {
        // Network / auth errors: log but DO NOT cache as _notFound.
        // The next request will try again.
        console.error(`[Metadata] TMDB error for "${parsed.title}": ${err.message}`);
        return null;
    }

    if (!metadata) {
        // Genuine "no result from TMDB" — cache it so we don't hammer the API
        setNotFound(file.id, parsed.title);
        return null;
    }

    // Store clean TMDB data (no 'parsed' internals)
    setCache(file.id, metadata);
    return store.get(file.id); // return the stored version (without parsed)
}

module.exports = {
    getMetadata,
    getCached,
    setCache,
    invalidate,
    invalidateAll,
    purgeStaleEntries,
};
