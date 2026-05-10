"use strict";

const fs = require("fs");
const path = require("path");
const { parseFilename } = require("./nameParser");
const { lookupMetadata } = require("./tmdb");

const STORE_FILE = path.join(__dirname, "..", "data", "metadata.json");

// In-memory mirror of the store file — Map<fileId, metadataObject>
let store = new Map();
let dirty = false;
let saveTimer = null;

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

// Returns cached metadata for a file ID, or null if not yet fetched
function getCached(fileId) {
    if (store.size === 0) loadStore();
    return store.get(fileId) || null;
}

// Stores metadata for a file ID and schedules a disk save
function setCache(fileId, metadata) {
    store.set(fileId, { ...metadata, _cachedAt: new Date().toISOString() });
    scheduleSave();
}

// Marks a file ID as "not found on TMDB" so we don't retry on every request
function setNotFound(fileId, title) {
    store.set(fileId, { _notFound: true, _title: title, _cachedAt: new Date().toISOString() });
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
 * Main entry — given a file object { id, name } from the scanner,
 * returns enriched metadata. Hits TMDB only on cache miss.
 *
 * Returns null if TMDB has no match (and caches that result too).
 */
async function getMetadata(file) {
    if (store.size === 0) loadStore();

    const cached = store.get(file.id);
    if (cached) {
        if (cached._notFound) return null;
        return cached;
    }

    // Cache miss — parse filename and call TMDB
    const parsed = parseFilename(file.name);
    console.log(`[Metadata] Fetching TMDB for: "${parsed.title}" (${parsed.type})`);

    const metadata = await lookupMetadata(parsed);

    if (!metadata) {
        setNotFound(file.id, parsed.title);
        return null;
    }

    // Store the parsed info alongside TMDB data so client knows season/episode
    const enriched = { ...metadata, parsed };
    setCache(file.id, enriched);
    return enriched;
}

module.exports = { getMetadata, getCached, setCache, invalidate, invalidateAll };
