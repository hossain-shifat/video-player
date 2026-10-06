"use strict";

const fs = require("fs");
const path = require("path");

// Standalone JSON store, deliberately separate from metadata.json — the
// user asked for trailer data to live in its own file, and it has its own
// TTL/shape (two cache blobs, not per-fileId entries), so it doesn't belong
// bolted onto metadataStore.js's schema/PARSER_VERSION machinery.
const STORE_FILE = path.join(__dirname, "..", "data", "trailers.json");

// { discover: { generatedAt, companyIds, items } | null,
//   library:  { generatedAt, items } | null }
let store = { discover: null, library: null };
let loaded = false;
let loadPromise = null;

async function loadStore() {
    if (loaded) return;
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
        try {
            const raw = await fs.promises.readFile(STORE_FILE, "utf-8");
            store = JSON.parse(raw);
            if (!store || typeof store !== "object") store = { discover: null, library: null };
            console.log(`[Trailers] Loaded cache (discover=${store.discover ? store.discover.items.length : 0}, library=${store.library ? store.library.items.length : 0})`);
        } catch (err) {
            if (err.code !== "ENOENT") console.error("[Trailers] Failed to load cache:", err.message);
            store = { discover: null, library: null };
        } finally {
            loaded = true;
            loadPromise = null;
        }
    })();

    return loadPromise;
}

// Same atomic write pattern as metadataStore.js / libraryController.js
// (temp file → fsync → rename) — no torn writes if the process dies mid-save.
async function persist() {
    try {
        const tmp = `${STORE_FILE}.tmp.${process.pid}.${Date.now()}`;
        const fd = await fs.promises.open(tmp, "w");
        try {
            await fd.writeFile(JSON.stringify(store, null, 2), "utf-8");
            await fd.sync();
        } finally {
            await fd.close();
        }
        await fs.promises.rename(tmp, STORE_FILE);
        console.log(`[Trailers] Saved cache to ${STORE_FILE}`);
    } catch (err) {
        console.error("[Trailers] Save failed:", err.message);
    }
}

// ─── Discover cache (new titles from your studios, not yet in library) ────────

async function getDiscoverCache(ttlMs) {
    await loadStore();
    const entry = store.discover;
    if (!entry) return null;
    const age = Date.now() - new Date(entry.generatedAt).getTime();
    if (age > ttlMs) return null;
    return entry;
}

async function setDiscoverCache(items, companyIds) {
    await loadStore();
    store.discover = { generatedAt: new Date().toISOString(), companyIds, items };
    await persist();
}

// ─── Library cache (trailers for stuff you already own) ───────────────────────
// No TTL check here — buildLibraryIndex() only re-derives it on an explicit
// refresh (see trailerController.refreshTrailers) or when nothing is cached
// yet, since it's a read-through of metadata.json's own already-TTL'd data.

async function getLibraryCache() {
    await loadStore();
    return store.library;
}

async function setLibraryCache(items) {
    await loadStore();
    store.library = { generatedAt: new Date().toISOString(), items };
    await persist();
}

async function invalidateAll() {
    await loadStore();
    store = { discover: null, library: null };
    await persist();
}

module.exports = { getDiscoverCache, setDiscoverCache, getLibraryCache, setLibraryCache, invalidateAll };
