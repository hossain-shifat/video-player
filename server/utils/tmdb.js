"use strict";

const TMDB_BASE = "https://api.themoviedb.org/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p";
const POSTER_SIZE = "w500";
const BACKDROP_SIZE = "w1280";
const STILL_SIZE = "w300"; // episode stills

// Simple token-bucket rate limiter — TMDB allows 40 req / 10 s
const RATE_LIMIT = 38; // stay just under
const RATE_WINDOW = 10_000; // ms
let requestsInWindow = 0;
let windowStart = Date.now();

// Mutex: a promise chain that serializes all callers so the check/sleep/increment
// is atomic — no two concurrent awaiters can both pass the quota check.
let _rateMutex = Promise.resolve();

function rateLimit() {
    // Each caller appends to the chain; the previous work completes before
    // the next one enters, making check+sleep+increment non-concurrent.
    _rateMutex = _rateMutex.then(async () => {
        const now = Date.now();
        if (now - windowStart > RATE_WINDOW) {
            requestsInWindow = 0;
            windowStart = now;
        }
        if (requestsInWindow >= RATE_LIMIT) {
            const wait = RATE_WINDOW - (Date.now() - windowStart) + 50;
            await new Promise((r) => setTimeout(r, wait));
            requestsInWindow = 0;
            windowStart = Date.now();
        }
        requestsInWindow++;
    });
    return _rateMutex;
}

// Core fetch wrapper — uses TMDB_API_KEY from env
async function tmdbFetch(endpoint, params = {}) {
    const apiKey = process.env.TMDB_API_KEY;
    if (!apiKey) throw new Error("TMDB_API_KEY is not set in .env");

    await rateLimit();

    const url = new URL(`${TMDB_BASE}${endpoint}`);
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("language", process.env.TMDB_LANGUAGE || "en-US");
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    let res;
    try {
        res = await fetch(url.toString(), { signal: controller.signal });
    } catch (err) {
        if (err.name === "AbortError") throw new Error("TMDB request timed out");
        throw err;
    } finally {
        clearTimeout(timer);
    }
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`TMDB ${res.status}: ${body.slice(0, 120)}`);
    }
    return res.json();
}

// Returns a full image URL or null
function imgUrl(size, filePath) {
    if (!filePath) return null;
    return `${IMAGE_BASE}/${size}${filePath}`;
}

// ─── MOVIE ────────────────────────────────────────────────────────────────────

// Searches for a movie and returns the best match
async function searchMovie(title, year = null) {
    const data = await tmdbFetch("/search/movie", { query: title, year: year || undefined });
    if (!data.results?.length) return null;

    // Prefer result whose year matches if provided
    const results = data.results;
    const match = year ? results.find((r) => r.release_date?.startsWith(String(year))) || results[0] : results[0];

    return match;
}

// Fetches full movie details by TMDB ID
async function getMovieDetails(tmdbId) {
    const data = await tmdbFetch(`/movie/${tmdbId}`, { append_to_response: "credits,videos" });
    return {
        tmdbId: data.id,
        type: "movie",
        title: data.title,
        originalTitle: data.original_title,
        year: data.release_date ? parseInt(data.release_date.slice(0, 4), 10) : null,
        overview: data.overview || null,
        rating: data.vote_average ? Math.round(data.vote_average * 10) / 10 : null,
        votes: data.vote_count || 0,
        runtime: data.runtime || null,
        genres: (data.genres || []).map((g) => g.name),
        poster: imgUrl(POSTER_SIZE, data.poster_path),
        backdrop: imgUrl(BACKDROP_SIZE, data.backdrop_path),
        cast: (data.credits?.cast || []).slice(0, 10).map((c) => ({
            name: c.name,
            character: c.character,
            photo: imgUrl("w185", c.profile_path),
        })),
        trailer: (data.videos?.results || []).find((v) => v.type === "Trailer" && v.site === "YouTube")?.key || null,
        tagline: data.tagline || null,
        status: data.status || null,
        language: data.original_language || null,
    };
}

// ─── TV / SERIES ──────────────────────────────────────────────────────────────

// Searches for a TV series and returns the best match
async function searchTV(title, year = null) {
    const data = await tmdbFetch("/search/tv", {
        query: title,
        first_air_date_year: year || undefined,
    });
    if (!data.results?.length) return null;
    const results = data.results;
    const match = year ? results.find((r) => r.first_air_date?.startsWith(String(year))) || results[0] : results[0];
    return match;
}

// Fetches full series details by TMDB ID
async function getTVDetails(tmdbId) {
    const data = await tmdbFetch(`/tv/${tmdbId}`, { append_to_response: "credits,videos" });
    return {
        tmdbId: data.id,
        type: "series",
        title: data.name,
        originalTitle: data.original_name,
        year: data.first_air_date ? parseInt(data.first_air_date.slice(0, 4), 10) : null,
        overview: data.overview || null,
        rating: data.vote_average ? Math.round(data.vote_average * 10) / 10 : null,
        votes: data.vote_count || 0,
        genres: (data.genres || []).map((g) => g.name),
        poster: imgUrl(POSTER_SIZE, data.poster_path),
        backdrop: imgUrl(BACKDROP_SIZE, data.backdrop_path),
        totalSeasons: data.number_of_seasons || null,
        totalEpisodes: data.number_of_episodes || null,
        status: data.status || null,
        cast: (data.credits?.cast || []).slice(0, 10).map((c) => ({
            name: c.name,
            character: c.character,
            photo: imgUrl("w185", c.profile_path),
        })),
        trailer: (data.videos?.results || []).find((v) => v.type === "Trailer" && v.site === "YouTube")?.key || null,
        language: data.original_language || null,
    };
}

// Fetches episode details for a specific season
async function getSeasonDetails(tmdbId, seasonNumber) {
    const data = await tmdbFetch(`/tv/${tmdbId}/season/${seasonNumber}`);
    return {
        seasonNumber: data.season_number,
        name: data.name,
        overview: data.overview || null,
        poster: imgUrl(POSTER_SIZE, data.poster_path),
        episodes: (data.episodes || []).map((ep) => ({
            episode: ep.episode_number,
            title: ep.name,
            overview: ep.overview || null,
            airDate: ep.air_date || null,
            runtime: ep.runtime || null,
            still: imgUrl(STILL_SIZE, ep.still_path),
            rating: ep.vote_average ? Math.round(ep.vote_average * 10) / 10 : null,
        })),
    };
}

// ─── ANIME ────────────────────────────────────────────────────────────────────

// Anime lives in TMDB as TV shows — search TV with animation genre filter
async function searchAnime(title, year = null) {
    // Try TV first (most anime are series)
    const tv = await tmdbFetch("/search/tv", {
        query: title,
        first_air_date_year: year || undefined,
    });
    const tvHit =
        (tv.results || []).find((r) => r.genre_ids?.includes(16)) || // 16 = Animation
        tv.results?.[0];
    if (tvHit) return { ...tvHit, _searchType: "tv" };

    // Fall back to movie search (anime films)
    const mv = await tmdbFetch("/search/movie", { query: title, year: year || undefined });
    const mvHit = (mv.results || []).find((r) => r.genre_ids?.includes(16)) || mv.results?.[0];
    if (mvHit) return { ...mvHit, _searchType: "movie" };

    return null;
}

// ─── UNIFIED LOOKUP ───────────────────────────────────────────────────────────

/**
 * Main entry point — given a parsed name object from nameParser,
 * finds the best TMDB match and returns full details.
 *
 * Returns null if nothing found.
 */
async function lookupMetadata(parsed) {
    const { title, type, year, season } = parsed;

    try {
        if (type === "anime") {
            const hit = (await searchAnime(title, year)) || (year ? await searchAnime(title) : null);
            if (!hit) return null;
            if (hit._searchType === "movie") {
                const details = await getMovieDetails(hit.id);
                return { ...details, type: "anime" };
            }
            const details = await getTVDetails(hit.id);
            const result = { ...details, type: "anime" };
            if (Number.isInteger(season) && season > 0) result.seasonDetails = await getSeasonDetails(hit.id, season);
            return result;
        }

        if (type === "series") {
            const hit = (await searchTV(title, year)) || (year ? await searchTV(title) : null);
            if (!hit) return null;
            const details = await getTVDetails(hit.id);
            if (Number.isInteger(season) && season > 0) details.seasonDetails = await getSeasonDetails(hit.id, season);
            return details;
        }

        // movie — try with year first, fall back to no year if nothing found
        const hit = (await searchMovie(title, year)) || (year ? await searchMovie(title) : null);
        if (!hit) return null;
        return await getMovieDetails(hit.id);
    } catch (err) {
        console.error(`[TMDB] lookupMetadata failed`, {
            title,
            type,
            year,
            error: err.message,
        });
        return null;
    }
}

module.exports = { lookupMetadata, searchMovie, searchTV, searchAnime, getMovieDetails, getTVDetails, getSeasonDetails };
