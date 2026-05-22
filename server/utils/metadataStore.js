"use strict";

const fs = require("fs");
const path = require("path");
const { parseFilename } = require("./nameParser");
const { lookupMetadata } = require("./tmdb");

const STORE_FILE = path.join(__dirname, "..", "data", "metadata.json");

// ── Bump this whenever the parser logic changes significantly. ─────────────────
// Any cached entry without this version (or with a lower one) is automatically
// re-fetched, clearing out stale parsed data and wrong TMDB matches.
//
// History:
//   1 — initial
//   2 — expanded noise tags, basic acronym support
//   3 — year-after-chapter fix (KGF years were being dropped, causing wrong
//        TMDB matches); improved acronym collapse; part-aware TMDB search
const PARSER_VERSION = 3;

// In-memory mirror of the store file — Map<fileId, metadataObject>
let store = new Map();
let dirty = false;
let saveTimer = null;

// ─── Disk I/O ─────────────────────────────────────────────────────────────────

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
 * Returns true if a cached entry was built with the current parser version.
 * Entries from older versions are considered stale and will be re-fetched.
 */
function isCacheValid(entry) {
    if (!entry) return false;
    return (entry._parserVersion ?? 0) >= PARSER_VERSION;
}

function getCached(fileId) {
    if (store.size === 0) loadStore();
    const entry = store.get(fileId);
    if (!entry || !isCacheValid(entry)) return null;
    return entry;
}

function setCache(fileId, metadata) {
    store.set(fileId, {
        ...metadata,
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
    scheduleSave();
}

/**
 * Purge every entry whose _parserVersion is below the current version.
 * Called once at startup so stale data is gone before any requests arrive.
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
        console.log(`[Metadata] Purged ${purged} stale cache entries (parser v${PARSER_VERSION})`);
        scheduleSave();
    }
}

// ─── Main entry ───────────────────────────────────────────────────────────────

/**
 * Given a file object { id, name } from the scanner, returns enriched metadata.
 * Hits TMDB only on a cache miss or after a parser version bump.
 *
 * Returns null if TMDB has no match (and caches that result too).
 */
async function getMetadata(file) {
    if (store.size === 0) {
        loadStore();
        purgeStaleEntries();
    }

    const cached = store.get(file.id);
    if (cached && isCacheValid(cached)) {
        if (cached._notFound) return null;
        return cached;
    }

    const parsed = parseFilename(file.name);
    console.log(`[Metadata] Fetching TMDB for: "${parsed.title}"` + ` (${parsed.type}${parsed.year ? ` ${parsed.year}` : ""}${parsed.part ? ` Part ${parsed.part}` : ""})`);

    const metadata = await lookupMetadata(parsed);

    if (!metadata) {
        setNotFound(file.id, parsed.title);
        return null;
    }

    const enriched = { ...metadata, parsed };
    setCache(file.id, enriched);
    return enriched;
}

module.exports = { getMetadata, getCached, setCache, invalidate, invalidateAll, purgeStaleEntries };
