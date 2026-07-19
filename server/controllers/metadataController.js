"use strict";

const { readFolders } = require("./libraryController");
const { getAllCached, findById } = require("../utils/mediaCache");
const { getMetadata, getCached, invalidate, invalidateAll } = require("../utils/metadataStore");
const { parseFilename } = require("../utils/nameParser");
const { getMediaInfo: _getMediaInfoRaw, invalidate: invalidateMediaInfo } = require("../utils/mediaInfoStore");

// ── NEW: mediaInfo (ffprobe) failure must never take down metadata ─────────
// getOne()/refreshOne() below await getMetadata() and getMediaInfo() together
// in Promise.all. If ffprobe is missing/misconfigured, or a file is
// unreadable, _getMediaInfoRaw() can reject — and Promise.all fails the
// WHOLE request on that one rejection, even though TMDB metadata had
// already succeeded. That's the "metadata not loaded" symptom. This wraps
// the raw import so a probe failure degrades to mediaInfo: null instead of
// failing the endpoint. mediaInfoStore.js itself is untouched.
async function getMediaInfo(file) {
    try {
        return await _getMediaInfoRaw(file);
    } catch (err) {
        console.error(`[MediaInfo] probe failed for "${file.name}", continuing without it:`, err.message);
        return null;
    }
}

// GET /api/metadata/:id — returns metadata + mediaInfo for one file, fetching TMDB/ffprobe if needed
async function getOne(req, res) {
    try {
        const folders = await readFolders();
        const file = await findById(folders, req.params.id);
        if (!file) return res.status(404).json({ error: "Media not found" });

        const [metadata, mediaInfo] = await Promise.all([getMetadata(file), getMediaInfo(file)]);

        return res.json({ id: file.id, name: file.name, metadata, mediaInfo });
    } catch (err) {
        console.error("[Metadata] getOne error:", err);
        return res.status(500).json({ error: "Failed to get metadata" });
    }
}

// POST /api/metadata/refresh/:id — clears cache for one file and re-fetches TMDB + ffprobe
async function refreshOne(req, res) {
    try {
        const folders = await readFolders();
        const file = await findById(folders, req.params.id);
        if (!file) return res.status(404).json({ error: "Media not found" });

        invalidate(file.id);
        invalidateMediaInfo(file.id);

        const [metadata, mediaInfo] = await Promise.all([getMetadata(file), getMediaInfo(file)]);

        return res.json({ id: file.id, name: file.name, metadata, mediaInfo });
    } catch (err) {
        console.error("[Metadata] refreshOne error:", err);
        return res.status(500).json({ error: "Failed to refresh metadata" });
    }
}

// POST /api/metadata/refresh-all — clears entire cache and re-fetches all (slow, use sparingly)
async function refreshAll(req, res) {
    try {
        invalidateAll();
        return res.json({ message: "Metadata cache cleared. Entries will be re-fetched on next request." });
    } catch (err) {
        console.error("[Metadata] refreshAll error:", err);
        return res.status(500).json({ error: "Failed to clear metadata cache" });
    }
}

// GET /api/metadata/parse?filename=xxx — debug helper: shows how a filename would be parsed
async function parseDebug(req, res) {
    const { filename } = req.query;
    if (!filename) return res.status(400).json({ error: "filename query param required" });
    return res.json(parseFilename(filename));
}

// GET /api/media/enriched — returns full media list with metadata attached (may be slow first time)
// NOTE: mediaInfo intentionally NOT attached here — running ffprobe over an
// entire library on one request would be extremely slow. mediaInfo is fetched
// lazily per-file via getOne() above (same lazy pattern as TMDB metadata).
async function getAllEnriched(req, res) {
    try {
        const folders = await readFolders();
        const { allMedia } = await getAllCached(folders);

        // Enrich each file — cache hits are instant, misses call TMDB
        const enriched = await Promise.all(
            allMedia.map(async (file) => {
                const metadata = await getMetadata(file);
                return { ...file, metadata };
            }),
        );

        return res.json({ total: enriched.length, media: enriched });
    } catch (err) {
        console.error("[Metadata] getAllEnriched error:", err);
        return res.status(500).json({ error: "Failed to get enriched media" });
    }
}

module.exports = { getOne, refreshOne, refreshAll, parseDebug, getAllEnriched };
