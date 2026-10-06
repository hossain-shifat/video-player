"use strict";

const { readFolders } = require("./libraryController");
const { getAllCached } = require("../utils/mediaCache");
const { getMetadata } = require("../utils/metadataStore");
const { discoverByCompany, getVideosFor } = require("../utils/tmdb");
const trailerStore = require("../utils/trailerStore");

// ── Tunables ─────────────────────────────────────────────────────────────────
const DISCOVER_TTL_MS = parseInt(process.env.TRAILER_DISCOVER_TTL_MS || String(24 * 60 * 60 * 1000), 10); // 24h — also the scheduler's own interval (trailerScheduler.js)
const MAX_PER_COMPANY = parseInt(process.env.TRAILER_MAX_PER_COMPANY || "10", 10); // per company, per media type
const MAX_RESULTS = parseInt(process.env.TRAILER_MAX_RESULTS || "40", 10); // total discover row size — also prunes "older" entries off the tail

// Real view-count sort needs a (free) YouTube Data API v3 key — TMDB's
// /videos endpoint doesn't expose view counts at all. Without this set,
// sorting silently falls back to TMDB's own `popularity` score for the
// title (see _sortByViews). Get one at https://console.cloud.google.com/
// (enable "YouTube Data API v3"), then set YOUTUBE_API_KEY in .env.
const YT_API_KEY = process.env.YOUTUBE_API_KEY || null;

// ─────────────────────────────────────────────────────────────────────────────
// Shared index — walks the already-cached library metadata (cache-hit on a
// warm cache, same pattern categoryController/mediaController already use)
// and derives everything the trailer feature needs in one pass:
//   companyMap   — tmdbCompanyId -> name, every studio you own something from
//   ownedKeys    — "movie:123" / "tv:456" — what NOT to suggest in discover
//   libraryItems — files that already have a videos[] from TMDB
//
// KNOWN EDGE CASE: an anime title TMDB resolved as a MOVIE (searchAnime's
// movie branch) has metadata.type === "anime" but a MOVIE tmdbId, not a TV
// id — nameParser/lookupMetadata don't persist which endpoint answered, so
// it's bucketed as "tv" below. Worst case: a discover result is wrongly
// treated as owned only if an unrelated TV show shares that numeric id —
// movie/TV id spaces are independent, so this is rare and low-consequence.
async function buildLibraryIndex() {
    const folders = await readFolders();
    const { allMedia } = await getAllCached(folders);

    const companyMap = new Map();
    const animeCompanyIds = new Set(); // companies you own ANIME from — discover results from these get typed "anime", not "series"
    const ownedKeys = new Set();
    const libraryItems = [];

    for (const file of allMedia) {
        const metadata = await getMetadata(file);
        if (!metadata || !metadata.tmdbId) continue;

        const mediaType = metadata.type === "movie" ? "movie" : "tv"; // series + anime → tv (see note above)
        ownedKeys.add(`${mediaType}:${metadata.tmdbId}`);

        for (const c of metadata.production_companies || []) {
            if (c.tmdbCompanyId) {
                companyMap.set(c.tmdbCompanyId, c.name);
                if (metadata.type === "anime") animeCompanyIds.add(c.tmdbCompanyId);
            }
        }

        if (Array.isArray(metadata.videos) && metadata.videos.length) {
            libraryItems.push({
                fileId: file.id,
                tmdbId: metadata.tmdbId,
                type: metadata.type,
                title: metadata.title,
                thumbnail: metadata.backdrop || metadata.poster, // same rule as discover items
                poster: metadata.poster,
                backdrop: metadata.backdrop,
                videos: metadata.videos,
            });
        }
    }

    return { companyMap, animeCompanyIds, ownedKeys, libraryItems };
}

// Only titles that HAVEN'T released yet count as a "new trailer" — once a
// title is out, it drops off the discover row (per user request). No date
// at all (TBA) is treated as still upcoming.
function _isUpcoming(dateStr) {
    if (!dateStr) return true;
    const releaseDate = new Date(dateStr);
    if (Number.isNaN(releaseDate.getTime())) return true;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return releaseDate >= today;
}

// Narrows the TMDB /discover query itself (fewer pages to walk) — the real
// "still upcoming" enforcement is _isUpcoming() above, applied per-result.
function _discoverCutoffDate() {
    const days = parseInt(process.env.TMDB_DISCOVER_WINDOW_DAYS || "180", 10);
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
}

// Batches up to 50 ids per call (YouTube Data API v3 limit). No-ops
// (returns an empty map) when YOUTUBE_API_KEY isn't configured.
async function _fetchViewCounts(keys) {
    const uniqueKeys = [...new Set(keys.filter(Boolean))];
    const views = new Map();
    if (!YT_API_KEY || !uniqueKeys.length) return views;

    for (let i = 0; i < uniqueKeys.length; i += 50) {
        const chunk = uniqueKeys.slice(i, i + 50);
        try {
            const url = `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${chunk.join(",")}&key=${YT_API_KEY}`;
            const res = await fetch(url);
            if (!res.ok) {
                console.warn(`[Trailers] YouTube views fetch failed: HTTP ${res.status}`);
                continue;
            }
            const data = await res.json();
            for (const v of data.items || []) {
                views.set(v.id, parseInt(v.statistics?.viewCount || "0", 10));
            }
        } catch (err) {
            console.warn("[Trailers] YouTube views fetch error:", err.message);
        }
    }
    return views;
}

// Most-viewed first (real YouTube view count when YOUTUBE_API_KEY is set),
// falling back to TMDB `popularity`, then release date, so the row is
// always sorted even with zero extra config.
function _sortByViews(items, viewsMap, trailerKeyOf) {
    return items
        .map((it) => ({ ...it, views: viewsMap.get(trailerKeyOf(it)) ?? null }))
        .sort((a, b) => {
            if (a.views != null || b.views != null) return (b.views ?? -1) - (a.views ?? -1);
            if (a.popularity != null || b.popularity != null) return (b.popularity ?? -1) - (a.popularity ?? -1);
            return new Date(b.releaseDate || 0) - new Date(a.releaseDate || 0);
        });
}

// ─────────────────────────────────────────────────────────────────────────────
// Rebuild functions — the actual work, reused by BOTH the route handlers
// (lazy, on cache miss/expiry) AND trailerScheduler.js (proactive, daily).
// Always a full rebuild, never incremental — that's what makes "remove the
// trailer once its movie released" and "drop the oldest ones" work for free:
// anything that no longer qualifies just isn't in the new list.

async function rebuildDiscoverTrailers() {
    const { companyMap, animeCompanyIds, ownedKeys } = await buildLibraryIndex();
    const companyIds = [...companyMap.keys()];

    if (!companyIds.length) {
        await trailerStore.setDiscoverCache([], companyIds);
        return [];
    }

    const seen = new Map(); // "type:tmdbId" -> item (dedupe: same title can surface under 2+ owned companies)

    for (const companyId of companyIds) {
        for (const mediaType of ["movie", "tv"]) {
            let results = [];
            try {
                results = await discoverByCompany(companyId, mediaType);
            } catch (err) {
                console.warn(`[Trailers] discover failed company=${companyId} type=${mediaType}: ${err.message}`);
                continue;
            }

            for (const r of results.slice(0, MAX_PER_COMPANY)) {
                const dateStr = r.release_date || r.first_air_date || null;
                if (!_isUpcoming(dateStr)) continue; // already out — not a "new trailer" anymore

                const key = `${mediaType}:${r.id}`;
                if (ownedKeys.has(key) || seen.has(key)) continue;

                const { trailer, trailerPublishedAt, videos } = await getVideosFor(r.id, mediaType);
                if (!videos.length) continue; // only show items that actually have a trailer/teaser

                // A "tv" result from a company you only know as an anime studio is
                // almost certainly anime too — TMDB itself has no "anime" type, so
                // this is the same company-ownership signal buildLibraryIndex()
                // already uses, just applied to the discover side.
                const resultType = mediaType === "movie" ? "movie" : animeCompanyIds.has(companyId) ? "anime" : "series";

                const posterUrl = r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : null;
                const backdropUrl = r.backdrop_path ? `https://image.tmdb.org/t/p/w1280${r.backdrop_path}` : null;

                seen.set(key, {
                    tmdbId: r.id,
                    type: resultType,
                    title: r.title || r.name || null,
                    releaseDate: dateStr,
                    // Landscape art for the horizontal card — poster is only used
                    // when TMDB has no backdrop at all (rare, usually very new/obscure
                    // titles). Computed here so the frontend doesn't have to pick.
                    thumbnail: backdropUrl || posterUrl,
                    poster: posterUrl,
                    backdrop: backdropUrl,
                    overview: r.overview || null,
                    company: { tmdbCompanyId: companyId, name: companyMap.get(companyId) },
                    popularity: typeof r.popularity === "number" ? r.popularity : null,
                    trailer,
                    trailerPublishedAt,
                    videos,
                });
            }
        }
    }

    const all = [...seen.values()];
    const viewsMap = await _fetchViewCounts(all.map((it) => it.trailer));
    // Most-viewed/popular first, then cap — this IS the "remove the oldest
    // trailer from the list" behavior: whatever falls past MAX_RESULTS is
    // simply not written to the cache on this rebuild.
    const items = _sortByViews(all, viewsMap, (it) => it.trailer).slice(0, MAX_RESULTS);

    await trailerStore.setDiscoverCache(items, companyIds);
    return items;
}

async function rebuildLibraryTrailers() {
    const { libraryItems } = await buildLibraryIndex();

    const trailerKeyOf = (it) => it.videos?.find((v) => v.type === "Trailer")?.key || it.videos?.[0]?.key || null;
    const viewsMap = await _fetchViewCounts(libraryItems.map(trailerKeyOf));
    const items = _sortByViews(libraryItems, viewsMap, trailerKeyOf);

    await trailerStore.setLibraryCache(items);
    return items;
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes

// GET /api/trailers/library — trailers for stuff you already own.
// Pure read-through of metadata.json's already-cached `videos[]` — zero
// extra TMDB calls (YouTube view-count calls only, if configured).
async function getLibraryTrailers(req, res) {
    try {
        const force = req.query.refresh === "true";
        if (!force) {
            const cached = await trailerStore.getLibraryCache();
            if (cached) return res.json({ total: cached.items.length, generatedAt: cached.generatedAt, items: cached.items });
        }
        const items = await rebuildLibraryTrailers();
        return res.json({ total: items.length, generatedAt: new Date().toISOString(), items });
    } catch (err) {
        console.error("[Trailers] getLibraryTrailers error:", err);
        return res.status(500).json({ error: "Failed to get library trailers" });
    }
}

// GET /api/trailers/discover — new movies/series/anime from studios you
// already own something from, not yet in your library, not yet released,
// with a trailer or teaser available. Mirrors Plex's "New Trailers" row.
// Rebuilt automatically once a day by trailerScheduler.js — this handler's
// own TTL check is just a safety net for the first request after boot.
async function getDiscoverTrailers(req, res) {
    try {
        const force = req.query.refresh === "true";
        if (!force) {
            const cached = await trailerStore.getDiscoverCache(DISCOVER_TTL_MS);
            if (cached) return res.json({ total: cached.items.length, generatedAt: cached.generatedAt, items: cached.items });
        }
        const items = await rebuildDiscoverTrailers();
        return res.json({ total: items.length, generatedAt: new Date().toISOString(), items });
    } catch (err) {
        console.error("[Trailers] getDiscoverTrailers error:", err);
        return res.status(500).json({ error: "Failed to get discover trailers" });
    }
}

// POST /api/trailers/refresh — force-rebuild both lists right now (same work
// the daily scheduler does), instead of just clearing the cache and waiting
// for the next GET.
async function refreshTrailers(req, res) {
    try {
        const [discover, library] = await Promise.all([rebuildDiscoverTrailers(), rebuildLibraryTrailers()]);
        return res.json({ message: "Trailers rebuilt.", discover: discover.length, library: library.length });
    } catch (err) {
        console.error("[Trailers] refreshTrailers error:", err);
        return res.status(500).json({ error: "Failed to refresh trailers" });
    }
}

module.exports = { getLibraryTrailers, getDiscoverTrailers, refreshTrailers, rebuildDiscoverTrailers, rebuildLibraryTrailers };
