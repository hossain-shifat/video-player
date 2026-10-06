"use strict";

const { readFolders } = require("./libraryController");
const { getAllCached, findById } = require("../utils/mediaCache");
const { getMetadata, invalidate, invalidateAll, getCachedSeason, setCachedSeason } = require("../utils/metadataStore");
const { parseFilename } = require("../utils/nameParser");
const { getSeasonDetails, tmdbFetch } = require("../utils/tmdb");
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

// ── NEW (metadata upgrade plan, feature 10 — lazy season details) ──────────
// GET /api/metadata/tv/:tmdbId/season/:seasonNumber
//
// grouper.js already eagerly fetches + persistently caches EVERY season for
// every series/anime group at scan time (getCachedSeason/setCachedSeason) —
// that is a standing constraint (grouper.js is never modified) and is left
// exactly as-is. This endpoint exists ALONGSIDE that, for the frontend to
// explicitly (re)request one season's detail on demand — e.g. a season TMDB
// didn't have data for yet, or to refresh a single season without a full
// library refresh-all. It reuses the exact same 7-day persistent season
// cache grouper.js already writes to, so the two never fight or duplicate
// TMDB calls for the same tmdbId+season.
// A season is only usable when TMDB gave it a real number AND at least one episode.
function _isValidSeason(season) {
    return Boolean(season) && Number.isInteger(season.seasonNumber) && Array.isArray(season.episodes) && season.episodes.length > 0;
}

async function getSeasonLazy(req, res) {
    try {
        const tmdbId = parseInt(req.params.tmdbId, 10);
        const seasonNumber = parseInt(req.params.seasonNumber, 10);

        if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
            return res.status(400).json({ error: "Invalid tmdbId" });
        }
        if (!Number.isInteger(seasonNumber) || seasonNumber < 0) {
            return res.status(400).json({ error: "Invalid season number" });
        }

        // ?refresh=true bypasses the persistent season cache (manual Refresh button).
        const forceRefresh = req.query.refresh === "true";

        let season = forceRefresh ? null : await getCachedSeason(tmdbId, seasonNumber);
        // A cached entry that is empty/invalid is not trusted — refetch it.
        if (!_isValidSeason(season)) {
            season = await getSeasonDetails(tmdbId, seasonNumber);
            // Only persist real seasons — never cache an empty/placeholder one.
            if (_isValidSeason(season)) await setCachedSeason(tmdbId, seasonNumber, season);
        }

        if (!_isValidSeason(season)) return res.status(404).json({ error: "Season not found" });
        return res.json({ season });
    } catch (err) {
        console.error("[Metadata] getSeasonLazy error:", err);
        return res.status(500).json({ error: "Failed to get season details" });
    }
}

// GET /api/metadata/tmdb/:kind/:tmdbId — server-side TMDB proxy for titles NOT in the
// library (MediaDetails "tmdb-movie-123" / "tmdb-tv-456" ids). Uses the server's
// tmdbFetch so the TMDB credential never reaches the browser bundle or network tab.
async function getTmdbItem(req, res) {
    try {
        const { kind } = req.params;
        const tmdbId = parseInt(req.params.tmdbId, 10);

        if (kind !== "movie" && kind !== "tv") return res.status(400).json({ error: "Invalid kind" });
        if (!Number.isInteger(tmdbId) || tmdbId <= 0) return res.status(400).json({ error: "Invalid tmdbId" });

        const data = await tmdbFetch(`/${kind}/${tmdbId}`, { append_to_response: "credits,videos,external_ids" });
        if (!data) return res.status(404).json({ error: "Media not found" });
        return res.json(data);
    } catch (err) {
        console.error("[Metadata] getTmdbItem error:", err.message);
        return res.status(404).json({ error: "Media not found" });
    }
}

module.exports = { getOne, refreshOne, refreshAll, parseDebug, getAllEnriched, getSeasonLazy, getTmdbItem };
