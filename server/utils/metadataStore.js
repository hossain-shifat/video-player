"use strict";

const fs = require("fs");
const path = require("path");
const { parseFilename } = require("./nameParser");
const { lookupMetadata } = require("./tmdb");

const STORE_FILE = path.join(__dirname, "..", "data", "metadata.json");

// Bump this version whenever the parser logic changes significantly.
// Any cached entry without this version (or with a lower one) will be
// re-fetched automatically, clearing out stale parsed data.
const PARSER_VERSION = 2;

// In-memory mirror of the store file — Map<fileId, metadataObject>
let store = new Map();
let dirty = false;
let saveTimer = null;

// ─── Disk I/O ─────────────────────────────────────────────────────────────────

// Loads the store from disk on first use
function loadStore() {
    try {
        const raw = fs.readFileSync(STORE_FILE, "utf-8");
        const obj = JSON.parse(raw);
        store = new Map(Object.entries(obj));
        console.log(`[Metadata] Loaded ${store.size} cached entries`);
    } catch {
        store = new Map();
    }
}

// Debounced save — writes to disk at most once per 2 s during bulk enrichment
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

/**
 * Returns true if a cached entry is still valid for the current parser version.
 * Entries created before PARSER_VERSION was introduced (_parserVersion is
 * absent or lower) are considered stale and will be re-fetched.
 */
function isCacheValid(entry) {
    if (!entry) return false;
    // _notFound entries are also versioned so they get re-tried after a parser
    // upgrade (the new title extraction might succeed where the old one failed).
    return (entry._parserVersion ?? 0) >= PARSER_VERSION;
}

// Returns cached metadata for a file ID, or null if not yet fetched / stale
function getCached(fileId) {
    if (store.size === 0) loadStore();
    const entry = store.get(fileId);
    if (!entry || !isCacheValid(entry)) return null;
    return entry;
}

// Stores metadata for a file ID and schedules a disk save
function setCache(fileId, metadata) {
    store.set(fileId, {
        ...metadata,
        _parserVersion: PARSER_VERSION,
        _cachedAt: new Date().toISOString(),
    });
    scheduleSave();
}

// Marks a file ID as "not found on TMDB" so we don't retry on every request
function setNotFound(fileId, title) {
    store.set(fileId, {
        _notFound: true,
        _title: title,
        _parserVersion: PARSER_VERSION,
        _cachedAt: new Date().toISOString(),
    });
    scheduleSave();
}

// Deletes a cache entry so it will be re-fetched on next request
function invalidate(fileId) {
    store.delete(fileId);
    scheduleSave();
}

// Clears all metadata cache
function invalidateAll() {
    store.clear();
    scheduleSave();
}

/**
 * Removes every entry whose _parserVersion is below the current PARSER_VERSION.
 * Called once at startup so stale data is purged before any requests arrive.
 */
function purgeStaleEntries() {
    if (store.size === 0) return;
    let purged = 0;
    for (const [key, value] of store) {
        if (!isCacheValid(value)) {
            store.delete(key);
            purged++;
        }
    }
    if (purged > 0) {
        console.log(`[Metadata] Purged ${purged} stale cache entries (parser version bump)`);
        scheduleSave();
    }
}

// ─── Main entry ───────────────────────────────────────────────────────────────

/**
 * Given a file object { id, name } from the scanner, returns enriched metadata.
 * Hits TMDB only on a cache miss (or after a parser version bump).
 *
 * Returns null if TMDB has no match (and caches that result too).
 */
async function getMetadata(file) {
    if (store.size === 0) {
        loadStore();
        // Purge any entries built with an older parser so they get re-fetched
        // with the corrected title/type before being served to the client.
        purgeStaleEntries();
    }

    const cached = store.get(file.id);
    if (cached && isCacheValid(cached)) {
        if (cached._notFound) return null;
        return cached;
    }

    // Cache miss (or stale) — parse filename with the current parser
    const parsed = parseFilename(file.name);
    console.log(`[Metadata] Fetching TMDB for: "${parsed.title}" (${parsed.type}${parsed.year ? ` ${parsed.year}` : ""})`);

    const metadata = await lookupMetadata(parsed);

    if (!metadata) {
        setNotFound(file.id, parsed.title);
        return null;
    }

    // Store the parsed info alongside TMDB data so the client knows
    // season / episode / part without having to re-parse the filename.
    const enriched = { ...metadata, parsed };
    setCache(file.id, enriched);
    return enriched;
}

module.exports = { getMetadata, getCached, setCache, invalidate, invalidateAll, purgeStaleEntries };
