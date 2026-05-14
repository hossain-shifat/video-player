"use strict";

const TMDB_BASE = "https://api.themoviedb.org/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p";
const POSTER_SIZE = "w500";
const BACKDROP_SIZE = "w1280";
const STILL_SIZE = "w300";

// Simple token-bucket rate limiter — TMDB allows 40 req / 10 s
const RATE_LIMIT = 38;
const RATE_WINDOW = 10_000;
let requestsInWindow = 0;
let windowStart = Date.now();

let _rateMutex = Promise.resolve();

function rateLimit() {
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

function imgUrl(size, filePath) {
    if (!filePath) return null;
    return `${IMAGE_BASE}/${size}${filePath}`;
}

// ─── MOVIE ────────────────────────────────────────────────────────────────────

async function searchMovie(title, year = null) {
    const data = await tmdbFetch("/search/movie", { query: title, year: year || undefined });
    if (!data.results?.length) return null;
    const results = data.results;
    return year ? results.find((r) => r.release_date?.startsWith(String(year))) || results[0] : results[0];
}

async function getMovieDetails(tmdbId) {
    const data = await tmdbFetch(`/movie/${tmdbId}`, { append_to_response: "credits,videos" });
    return {
        tmdbId: data.id,
        type: "movie",
        title: data.title,
        originalTitle: data.original_title,
        releaseDate: data.release_date || null,
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

async function searchTV(title, year = null) {
    const data = await tmdbFetch("/search/tv", {
        query: title,
        first_air_date_year: year || undefined,
    });
    if (!data.results?.length) return null;
    const results = data.results;
    return year ? results.find((r) => r.first_air_date?.startsWith(String(year))) || results[0] : results[0];
}

async function getTVDetails(tmdbId) {
    const data = await tmdbFetch(`/tv/${tmdbId}`, { append_to_response: "credits,videos" });
    return {
        tmdbId: data.id,
        type: "series",
        title: data.name,
        originalTitle: data.original_name,
        firstAirDate: data.first_air_date || null,
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

async function searchAnime(title, year = null) {
    const tv = await tmdbFetch("/search/tv", {
        query: title,
        first_air_date_year: year || undefined,
    });
    const tvHit = (tv.results || []).find((r) => r.genre_ids?.includes(16)) || tv.results?.[0];
    if (tvHit) return { ...tvHit, _searchType: "tv" };

    const mv = await tmdbFetch("/search/movie", { query: title, year: year || undefined });
    const mvHit = (mv.results || []).find((r) => r.genre_ids?.includes(16)) || mv.results?.[0];
    if (mvHit) return { ...mvHit, _searchType: "movie" };

    return null;
}

// ─── UNIFIED LOOKUP ───────────────────────────────────────────────────────────

/**
 * Build a list of search title candidates to try in order.
 *
 * For movies with a part number we try both the full-chapter title
 * ("KGF Chapter 1") and the bare title ("KGF") with the year as a
 * discriminator so TMDB returns the right film even when the release
 * uses "Chapter N" in its official title.
 *
 * Without this, searching "KGF" (no year, because the year was lost
 * after truncating titleRaw at the chapter token) returned "K.G.F:
 * Chapter 3" as the top hit instead of Chapter 1 or 2.
 */
function buildMovieTitleCandidates(title, part) {
    const candidates = [];
    if (part != null) {
        // "Chapter N" convention (e.g. "KGF Chapter 1")
        candidates.push(`${title} Chapter ${part}`);
        // "Part N" convention — some TMDB titles use this wording
        candidates.push(`${title} Part ${part}`);
        // Bare title as final fallback — year will discriminate on TMDB
        candidates.push(title);
    } else {
        candidates.push(title);
    }
    return candidates;
}

/**
 * Main entry point — given a parsed name object from nameParser,
 * finds the best TMDB match and returns full details.
 *
 * Returns null if nothing found.
 */
async function lookupMetadata(parsed) {
    const { title, type, year, season, part } = parsed;

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

        // ── Movie (including multi-part films like KGF) ───────────────────────
        //
        // Try title candidates in order, with year first (most specific),
        // then without year as a fallback.  Stop at the first hit.
        const candidates = buildMovieTitleCandidates(title, part);

        for (const candidate of candidates) {
            // With year
            if (year) {
                const hit = await searchMovie(candidate, year);
                if (hit) return await getMovieDetails(hit.id);
            }
            // Without year
            const hit = await searchMovie(candidate);
            if (hit) return await getMovieDetails(hit.id);
        }

        return null;
    } catch (err) {
        console.error("[TMDB] lookupMetadata failed", { title, type, year, part, error: err.message });
        return null;
    }
}

module.exports = {
    lookupMetadata,
    searchMovie,
    searchTV,
    searchAnime,
    getMovieDetails,
    getTVDetails,
    getSeasonDetails,
};
