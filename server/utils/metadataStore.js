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
//   10  — "date" field added: ISO timestamp of when the file was FIRST added
//          to the server (first ever cache write). Preserved across refreshes.
//   11  — _sourceTitle self-heal: every entry (found + _notFound) now stores
//          the parsed title that was used to produce it. getMetadata() compares
//          the LIVE parsed title against _sourceTitle on every read — if they
//          differ (i.e. nameParser output changed for this file, e.g. a site-
//          prefix stripping fix), the cache entry is treated as stale and
//          re-fetched regardless of _parserVersion or _notFound TTL. This is
//          what actually fixes "parser improved but old _notFound sticks
//          forever" — before v11 that class of bug required a manual
//          PARSER_VERSION bump to force a global purge. Old entries (no
//          _sourceTitle) are untouched by this check and fall back to the
//          normal version/TTL validity path — they self-heal the next time
//          they're written (setCache/setNotFound always stamp _sourceTitle now).
const PARSER_VERSION = 11;

// _notFound entries expire after 7 days — prevents permanently cached misses
// from a bad API key or transient network failure blocking real lookups.
const NOT_FOUND_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Season details TTL — 7 days. Season episode lists rarely change.
// Key format: "_season:<tmdbId>:<seasonNumber>" — the underscore + word prefix
// guarantees no collision with file IDs (which are base64url encoded paths).
const SEASON_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let store = new Map();
let dirty = false;
let saveTimer = null;
let storeLoaded = false;
// Single shared promise so concurrent calls to loadStore() all await the same
// in-flight read instead of spawning multiple parallel fs.readFile calls.
let _loadPromise = null;

// ─── Disk I/O ─────────────────────────────────────────────────────────────────

// PERF FIX: loadStore is now async — uses non-blocking fs.promises.readFile
// instead of fs.readFileSync. On large metadata.json files (100 MB+) this
// prevents the Node event loop from freezing during the disk read phase.
async function loadStore() {
    if (storeLoaded) return;
    if (_loadPromise) return _loadPromise;

    _loadPromise = (async () => {
        try {
            const raw = await fs.promises.readFile(STORE_FILE, "utf-8");
            const obj = JSON.parse(raw);
            store = new Map(Object.entries(obj));
            console.log(`[Metadata] Loaded ${store.size} cached entries`);
            storeLoaded = true;
        } catch (err) {
            if (err.code === "ENOENT") {
                // File doesn't exist yet — normal on first run
                store = new Map();
                console.log("[Metadata] No cache file found, starting fresh");
                storeLoaded = true;
            } else {
                // Parse error, permission issue, etc. — log and rethrow so caller knows
                console.error("[Metadata] Failed to load cache:", err.message);
                _loadPromise = null;
                throw err;
            }
        } finally {
            _loadPromise = null;
        }
    })();

    return _loadPromise;
}

// PERF FIX: Wrap the CPU-bound JSON.stringify inside a setImmediate so the
// event loop gets exactly one tick to service pending I/O (streams, API
// requests) before we freeze it with serialization. This prevents the
// ~500 ms stutter that large libraries caused on every periodic save.
function yieldThenStringify(obj) {
    return new Promise((resolve) => {
        setImmediate(() => resolve(JSON.stringify(obj)));
    });
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
                // PERF FIX: Compact JSON + yield event loop via setImmediate
                // before the CPU-heavy stringify runs.
                const serialized = await yieldThenStringify(obj);
                await fd.writeFile(serialized, "utf-8");
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

// Self-heal check: does the LIVE parsed title (from current nameParser output)
// differ from the title that was actually used to produce this cache entry?
// If yes, the parser changed behavior for this file since it was cached —
// treat the entry as stale regardless of _parserVersion/TTL. This is what
// lets a nameParser fix (e.g. site-prefix stripping) self-correct old
// _notFound entries without a manual global PARSER_VERSION bump.
// Entries written before v11 have no _sourceTitle and are simply skipped here
// (they fall back to the normal isCacheValid() path) — they gain a
// _sourceTitle the next time they're written and self-heal from then on.
function hasTitleDrifted(entry, liveTitle) {
    if (!entry || !entry._sourceTitle) return false;
    return entry._sourceTitle !== liveTitle;
}

// Returns the "added" date to persist — reuses an existing entry's date if
// one is already on record (even a stale/invalid one), otherwise stamps now.
// This guarantees "date" always reflects the FIRST time the file was ever
// seen by the server, not the last refresh/version-bump time.
function resolveAddedDate(fileId) {
    const existing = store.get(fileId);
    return existing?.date || new Date().toISOString();
}

async function getCached(fileId) {
    await loadStore();
    const entry = store.get(fileId);
    if (!entry || !isCacheValid(entry)) return null;
    return entry;
}

// setCache(fileId, metadata, sourceTitle)
// sourceTitle = the parsed.title that produced this TMDB hit — stamped as
// _sourceTitle so future reads can detect parser-output drift (self-heal).
function setCache(fileId, metadata, sourceTitle) {
    // ── FIX: Do NOT persist the 'parsed' object into the cache ────────────────
    // parsed is internal parser data (episodes array, confidence score, codec,
    // resolution, languages, etc.) that is useful during enrichment but bloats
    // metadata.json and is re-generated on each request anyway.
    //
    // The stored entry contains only clean TMDB data:
    //   title, year, overview, poster, backdrop, genres, cast, trailer, ...
    const { parsed: _drop, ...cleanMetadata } = metadata;

    const date = resolveAddedDate(fileId);

    store.set(fileId, {
        ...cleanMetadata,
        date,
        _sourceTitle: sourceTitle,
        _parserVersion: PARSER_VERSION,
        _cachedAt: new Date().toISOString(),
    });
    scheduleSave();
}

function setNotFound(fileId, title) {
    const date = resolveAddedDate(fileId);

    store.set(fileId, {
        _notFound: true,
        _title: title,
        _sourceTitle: title, // same value — uniform drift-check field
        date,
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

async function purgeStaleEntries() {
    await loadStore();
    if (store.size === 0) return;
    let purged = 0;
    for (const [key, value] of store) {
        // Season entries have their own TTL — skip here, getCachedSeason handles expiry
        if (key.startsWith("_season:")) continue;
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
 *   HIT  (valid version, not _notFound, title NOT drifted) → return immediately
 *   HIT  (_notFound, within TTL, title NOT drifted)        → return null immediately
 *   HIT  (_notFound, expired)                              → purge + re-fetch
 *   HIT  but title DRIFTED (parser output changed)         → purge + re-fetch (self-heal)
 *   MISS or stale version                                  → fetch from TMDB, cache result
 *
 * Network/auth errors are NOT cached — next request will retry TMDB.
 * Genuine "no result" responses ARE cached (for NOT_FOUND_TTL_MS).
 *
 * "date" field: always the ISO timestamp of the FIRST time this file was
 * ever cached — i.e. the "added to server" date. Survives version bumps
 * and refreshes because resolveAddedDate() carries it forward.
 *
 * "_sourceTitle" field: the parsed.title used to produce the cache entry.
 * Compared against the live parse on every call — a mismatch (parser fix
 * changed the output title for this file) invalidates the entry even if
 * _parserVersion/TTL still say it's valid. This is what makes a nameParser
 * fix self-heal old bad cache entries (e.g. stale _notFound from garbage
 * titles) without requiring a manual PARSER_VERSION bump.
 */
async function getMetadata(file) {
    await loadStore();

    // Parse up-front — needed both for the TMDB lookup AND the drift check.
    const parsed = parseFilename(file.name);

    const cached = store.get(file.id);
    const driftedStale = hasTitleDrifted(cached, parsed.title);

    if (cached && isCacheValid(cached) && !driftedStale) {
        if (cached._notFound) return null;
        return cached;
    }

    if (driftedStale) {
        console.log(`[Metadata] Self-heal: source title changed "${cached._sourceTitle}" → "${parsed.title}" for ${file.id} — re-fetching`);
    }

    // Stale, missing, or drifted — re-fetch
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

    // Store clean TMDB data (no 'parsed' internals) + date + sourceTitle
    setCache(file.id, metadata, parsed.title);
    return store.get(file.id); // return the stored version (without parsed)
}

// ─── Orphaned entry cleanup ───────────────────────────────────────────────────

/**
 * reconcile(activeFileIds)
 *
 * Removes metadata entries whose fileId is no longer present in the active
 * fileIndex. Call this after a library folder is deleted.
 *
 * @param {Set<string>|Map<string,*>} activeFileIds - Set or Map of active IDs
 */
async function reconcile(activeFileIds) {
    await loadStore();
    if (store.size === 0) return;

    let removed = 0;
    for (const key of store.keys()) {
        // Skip internal season cache entries — they are NOT indexed by fileId
        if (key.startsWith("_season:")) continue;

        // hasOwnProperty-safe check — supports both Set and Map
        const isActive = activeFileIds instanceof Set ? activeFileIds.has(key) : activeFileIds.has(key);

        if (!isActive) {
            store.delete(key);
            removed++;
        }
    }

    if (removed > 0) {
        console.log(`[Metadata] Reconcile: removed ${removed} orphaned entries`);
        scheduleSave();
    } else {
        console.log(`[Metadata] Reconcile: no orphaned entries found`);
    }
}

// ─── Season-level cache ───────────────────────────────────────────────────────

/**
 * getCachedSeason(tmdbId, seasonNumber)
 *
 * Returns cached season detail object, or null if missing / expired.
 * Season data is stored in the same metadata.json under key
 * "_season:<tmdbId>:<seasonNumber>".
 */
async function getCachedSeason(tmdbId, seasonNumber) {
    await loadStore();
    const key = `_season:${tmdbId}:${seasonNumber}`;
    const entry = store.get(key);
    if (!entry) return null;
    const age = Date.now() - new Date(entry._cachedAt).getTime();
    if (age > SEASON_TTL_MS) {
        store.delete(key);
        scheduleSave(); // persist deletion so expired entry not reloaded on restart
        return null;
    }
    const { _cachedAt: _, ...data } = entry;
    return data;
}

/**
 * setCachedSeason(tmdbId, seasonNumber, data)
 *
 * Persists season detail into the store. Called after a successful
 * getSeasonDetails() TMDB fetch.
 */
async function setCachedSeason(tmdbId, seasonNumber, data) {
    await loadStore();
    const key = `_season:${tmdbId}:${seasonNumber}`;
    store.set(key, { ...data, _cachedAt: new Date().toISOString() });
    scheduleSave();
}

module.exports = {
    getMetadata,
    getCached,
    setCache,
    invalidate,
    invalidateAll,
    purgeStaleEntries,
    reconcile,
    getCachedSeason,
    setCachedSeason,
};
