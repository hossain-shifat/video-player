"use strict";

const TMDB_BASE = "https://api.themoviedb.org/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p";
const POSTER_SIZE = "w500";
const BACKDROP_SIZE = "w1280";
const STILL_SIZE = "w300";

// ─── TMDB Authentication ──────────────────────────────────────────────────────
//
// TMDB supports two auth methods:
//   v3 API key  → ?api_key=<32-char-hex>        (old, still valid)
//   v4 Bearer   → Authorization: Bearer <JWT>   (new preferred method)
//
// Auto-detect which one is configured:
//   TMDB_READ_ACCESS_TOKEN in .env → Bearer (preferred, takes priority)
//   TMDB_API_KEY in .env           → v3 api_key param (fallback)
//
// COMMON BUG: pasting a v4 JWT into TMDB_API_KEY → every request returns 401
// because v4 tokens cannot be passed as a URL param. Use TMDB_READ_ACCESS_TOKEN.

function getAuth() {
    const bearerToken = process.env.TMDB_READ_ACCESS_TOKEN;
    const apiKey = process.env.TMDB_API_KEY;

    if (!bearerToken && !apiKey) {
        throw new Error("No TMDB credentials found.\n" + "  Set TMDB_READ_ACCESS_TOKEN (long JWT, preferred) OR\n" + "  Set TMDB_API_KEY (32-char hex, legacy) in your .env file.");
    }
    return bearerToken ? { type: "bearer", token: bearerToken } : { type: "apikey", token: apiKey };
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────
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

// ─── Core fetch ───────────────────────────────────────────────────────────────

async function tmdbFetch(endpoint, params = {}, retries = 3) {
    const auth = getAuth();
    await rateLimit();

    const url = new URL(`${TMDB_BASE}${endpoint}`);
    url.searchParams.set("language", process.env.TMDB_LANGUAGE || "en-US");

    if (auth.type === "apikey") {
        url.searchParams.set("api_key", auth.token);
    }

    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }

    const headers = { "Content-Type": "application/json" };
    if (auth.type === "bearer") {
        headers["Authorization"] = `Bearer ${auth.token}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    let res;

    try {
        res = await fetch(url.toString(), { signal: controller.signal, headers });
    } catch (err) {
        if (retries > 0) {
            console.warn(`[TMDB] fetch error ${endpoint}: ${err.message} — retrying (${retries} left)`);
            await new Promise((r) => setTimeout(r, 1500));
            return tmdbFetch(endpoint, params, retries - 1);
        }
        throw err.name === "AbortError" ? new Error(`TMDB request timed out: ${endpoint}`) : err;
    } finally {
        clearTimeout(timer);
    }

    if (!res.ok) {
        if (res.status === 401) {
            const body = await res.text().catch(() => "");
            // Give a clear actionable error message
            const isLikelyJWT = auth.type === "apikey" && auth.token && auth.token.length > 50;
            throw new Error(
                `TMDB 401 Unauthorized (${endpoint}).\n` +
                    (isLikelyJWT ? "  Your TMDB_API_KEY looks like a v4 JWT. Move it to TMDB_READ_ACCESS_TOKEN instead.\n" : `  Auth type in use: ${auth.type}\n`) +
                    `  Response: ${body.slice(0, 150)}`,
            );
        }
        if (res.status === 429 && retries > 0) {
            console.warn(`[TMDB] 429 rate limit ${endpoint} — retrying (${retries} left)`);
            await new Promise((r) => setTimeout(r, 3000));
            return tmdbFetch(endpoint, params, retries - 1);
        }
        if (res.status >= 500 && retries > 0) {
            console.warn(`[TMDB] ${res.status} server error ${endpoint} — retrying (${retries} left)`);
            await new Promise((r) => setTimeout(r, 2000));
            return tmdbFetch(endpoint, params, retries - 1);
        }
        if (res.status === 404) {
            return { results: [], total_results: 0 };
        }
        const body = await res.text().catch(() => "");
        throw new Error(`TMDB ${res.status} ${endpoint}: ${body.slice(0, 120)}`);
    }

    return res.json();
}

// ─── Image URL helper ─────────────────────────────────────────────────────────

function imgUrl(size, filePath) {
    if (!filePath) return null;
    return `${IMAGE_BASE}/${size}${filePath}`;
}

// ─── Title similarity scoring ─────────────────────────────────────────────────

function normalizeForScore(str) {
    return (str || "")
        .toLowerCase()
        .replace(/[._\-:]/g, " ")
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\b(the|a|an)\b/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function titleScore(queryTitle, resultTitle) {
    const q = normalizeForScore(queryTitle);
    const r = normalizeForScore(resultTitle);
    if (!q || !r) return 0;
    if (q === r) return 1;
    const qWords = new Set(q.split(" ").filter(Boolean));
    const rWords = new Set(r.split(" ").filter(Boolean));
    let matches = 0;
    for (const w of qWords) if (rWords.has(w)) matches++;
    return matches / Math.max(qWords.size, rWords.size);
}

function pickBestResult(results, queryTitle, year, dateField) {
    if (!results || !results.length) return null;

    function bestByScore(pool) {
        let best = pool[0];
        let bestScore = titleScore(queryTitle, pool[0].title || pool[0].name || "");
        for (const r of pool.slice(1)) {
            const s = titleScore(queryTitle, r.title || r.name || "");
            if (s > bestScore) {
                bestScore = s;
                best = r;
            }
        }
        return best;
    }

    if (!year) return bestByScore(results);

    const exact = results.filter((r) => (r[dateField] || "").startsWith(String(year)));
    if (exact.length) return bestByScore(exact);

    const fuzzy = results.filter((r) => {
        const y = parseInt((r[dateField] || "").slice(0, 4), 10);
        return !isNaN(y) && Math.abs(y - year) <= 1;
    });
    if (fuzzy.length) return bestByScore(fuzzy);

    return bestByScore(results);
}

const LOGO_SIZE = "w185";

// ─── New helper functions (reviews, OMDB, content rating, etc.) ───────────────

// Silent fetch — returns null on error (for optional enrichment calls)
async function tmdbFetchSafe(endpoint, params = {}) {
    try {
        return await tmdbFetch(endpoint, params);
    } catch {
        return null;
    }
}

// Collect review IDs only — frontend queries /api/review/:id for full data
async function fetchReviews(endpoint) {
    const [p1, p2] = await Promise.all([tmdbFetchSafe(`${endpoint}/reviews`, { page: 1 }), tmdbFetchSafe(`${endpoint}/reviews`, { page: 2 })]);
    const all = [...(p1?.results ?? []), ...(p2?.results ?? [])];
    return all.slice(0, 10).map((r) => r.id);
}

// IMDb/RT/Metascore via OMDB (optional — needs OMDB_API_KEY in .env)
async function fetchOmdbRatings(imdbId) {
    if (!imdbId) return {};
    const omdbKey = process.env.OMDB_API_KEY;
    if (!omdbKey) return {};
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5_000);
        let res;
        try {
            res = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${omdbKey}`, { signal: controller.signal });
        } finally {
            clearTimeout(timer);
        }
        if (!res.ok) return {};
        const d = await res.json();
        if (d.Response === "False") return {};
        const rt = (d.Ratings || []).find((r) => r.Source === "Rotten Tomatoes");
        return {
            imdbRating: d.imdbRating !== "N/A" ? parseFloat(d.imdbRating) : null,
            imdbVotes: d.imdbVotes !== "N/A" ? d.imdbVotes.replace(/,/g, "") : null,
            rottenTomatoes: rt?.Value ?? null,
            metascore: d.Metascore !== "N/A" ? parseInt(d.Metascore, 10) : null,
        };
    } catch {
        return {};
    }
}

// Content rating (US): "PG-13", "TV-MA", etc.
async function fetchContentRating(mediaId, type) {
    if (type === "movie") {
        const data = await tmdbFetchSafe(`/movie/${mediaId}/release_dates`);
        const us = (data?.results || []).find((r) => r.iso_3166_1 === "US");
        return us?.release_dates?.[0]?.certification || null;
    }
    const data = await tmdbFetchSafe(`/tv/${mediaId}/content_ratings`);
    const us = (data?.results || []).find((r) => r.iso_3166_1 === "US");
    return us?.rating || null;
}

// Top 20 TMDB keywords
async function fetchKeywords(mediaId, type) {
    const endpoint = type === "movie" ? `/movie/${mediaId}/keywords` : `/tv/${mediaId}/keywords`;
    const data = await tmdbFetchSafe(endpoint);
    const arr = data?.keywords ?? data?.results ?? [];
    return arr.slice(0, 20).map((k) => ({ id: k.id, name: k.name }));
}

// Cast with tmdbPersonId (for future /person/:id lookups)
function shapeCast(castArr, limit = 15) {
    return (castArr || []).slice(0, limit).map((c) => ({
        tmdbPersonId: c.id,
        name: c.name,
        character: c.character,
        order: c.order ?? null,
        photo: imgUrl("w185", c.profile_path),
    }));
}

// Key crew: director, writers, DP, composer
function shapeCrew(crewArr) {
    const KEEP = new Set(["Director", "Screenplay", "Writer", "Story", "Original Music Composer", "Director of Photography"]);
    return (crewArr || [])
        .filter((c) => KEEP.has(c.job))
        .slice(0, 10)
        .map((c) => ({
            tmdbPersonId: c.id,
            name: c.name,
            job: c.job,
            department: c.department,
            photo: imgUrl("w185", c.profile_path),
        }));
}

// ─── Movie endpoints ──────────────────────────────────────────────────────────

async function searchMovie(title, year = null) {
    console.log(`[TMDB] searchMovie: "${title}" year=${year ?? "any"}`);
    const data = await tmdbFetch("/search/movie", { query: title, year: year || undefined, page: 1 });
    const results = (data.results || []).slice(0, 10);
    if (!results.length) {
        console.log(`[TMDB] searchMovie: no results for "${title}"`);
        return null;
    }
    const hit = pickBestResult(results, title, year, "release_date");
    console.log(`[TMDB] searchMovie: → "${hit.title}" (${hit.release_date?.slice(0, 4) ?? "?"}) id=${hit.id}`);
    return hit;
}

async function getMovieDetails(tmdbId) {
    const data = await tmdbFetch(`/movie/${tmdbId}`, { append_to_response: "credits,videos,external_ids" });

    // Parallel optional enrichment (all safe — won't throw)
    const [reviews, contentRating, keywords] = await Promise.all([fetchReviews(`/movie/${tmdbId}`), fetchContentRating(tmdbId, "movie"), fetchKeywords(tmdbId, "movie")]);

    const imdbId = data.external_ids?.imdb_id ?? null;
    const omdbRatings = await fetchOmdbRatings(imdbId);

    const allVideos = (data.videos?.results || []).filter((v) => v.site === "YouTube");
    const trailer = allVideos.find((v) => v.type === "Trailer")?.key || null;
    const videos = allVideos
        .filter((v) => ["Trailer", "Teaser", "Clip", "Featurette"].includes(v.type))
        .slice(0, 5)
        .map((v) => ({ type: v.type, key: v.key, name: v.name }));

    return {
        // ── Existing fields (unchanged) ──
        tmdbId: data.id,
        type: "movie",
        title: data.title,
        originalTitle: data.original_title || null,
        releaseDate: data.release_date || null,
        year: data.release_date ? parseInt(data.release_date.slice(0, 4), 10) : null,
        overview: data.overview || null,
        rating: data.vote_average ? Math.round(data.vote_average * 10) / 10 : null,
        votes: data.vote_count || 0,
        runtime: data.runtime || null,
        genres: (data.genres || []).map((g) => g.name),
        poster: imgUrl(POSTER_SIZE, data.poster_path),
        backdrop: imgUrl(BACKDROP_SIZE, data.backdrop_path),
        trailer, // back-compat: still single key string
        tagline: data.tagline || null,
        status: data.status || null,
        language: data.original_language || null,
        // ── Upgraded cast (added tmdbPersonId + order) ──
        cast: shapeCast(data.credits?.cast, 15),
        // ── New fields ──
        imdbId,
        contentRating,
        popularity: data.popularity ? Math.round(data.popularity * 10) / 10 : null,
        budget: data.budget || null,
        revenue: data.revenue || null,
        ratings: {
            tmdb: data.vote_average ? Math.round(data.vote_average * 10) / 10 : null,
            tmdbVotes: data.vote_count || 0,
            imdb: omdbRatings.imdbRating ?? null,
            imdbVotes: omdbRatings.imdbVotes ?? null,
            rottenTomatoes: omdbRatings.rottenTomatoes ?? null,
            metascore: omdbRatings.metascore ?? null,
        },
        crew: shapeCrew(data.credits?.crew),
        videos,
        keywords,
        reviews,
        collection: data.belongs_to_collection
            ? {
                  id: data.belongs_to_collection.id,
                  name: data.belongs_to_collection.name,
                  poster: imgUrl(POSTER_SIZE, data.belongs_to_collection.poster_path),
                  backdrop: imgUrl(BACKDROP_SIZE, data.belongs_to_collection.backdrop_path),
              }
            : null,
        spokenLanguages: (data.spoken_languages || []).map((l) => ({
            code: l.iso_639_1,
            name: l.english_name || l.name,
        })),
    };
}

// ─── TV / Series endpoints ────────────────────────────────────────────────────

async function searchTV(title, year = null) {
    console.log(`[TMDB] searchTV: "${title}" year=${year ?? "any"}`);
    const data = await tmdbFetch("/search/tv", { query: title, first_air_date_year: year || undefined });
    const results = (data.results || []).slice(0, 10);
    if (!results.length) {
        console.log(`[TMDB] searchTV: no results for "${title}"`);
        return null;
    }
    const hit = pickBestResult(results, title, year, "first_air_date");
    console.log(`[TMDB] searchTV: → "${hit.name}" (${hit.first_air_date?.slice(0, 4) ?? "?"}) id=${hit.id}`);
    return hit;
}

async function getTVDetails(tmdbId) {
    const data = await tmdbFetch(`/tv/${tmdbId}`, { append_to_response: "credits,videos,external_ids" });

    const [reviews, contentRating, keywords] = await Promise.all([fetchReviews(`/tv/${tmdbId}`), fetchContentRating(tmdbId, "tv"), fetchKeywords(tmdbId, "tv")]);

    const imdbId = data.external_ids?.imdb_id ?? null;
    const omdbRatings = await fetchOmdbRatings(imdbId);

    const allVideos = (data.videos?.results || []).filter((v) => v.site === "YouTube");
    const trailer = allVideos.find((v) => v.type === "Trailer")?.key || null;
    const videos = allVideos
        .filter((v) => ["Trailer", "Teaser", "Clip"].includes(v.type))
        .slice(0, 5)
        .map((v) => ({ type: v.type, key: v.key, name: v.name }));

    return {
        // ── Existing fields (unchanged) ──
        tmdbId: data.id,
        type: "series",
        title: data.name,
        originalTitle: data.original_name || null,
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
        trailer, // back-compat: single key string
        language: data.original_language || null,
        // ── Upgraded cast (added tmdbPersonId + order) ──
        cast: shapeCast(data.credits?.cast, 15),
        // ── New fields ──
        imdbId,
        contentRating,
        popularity: data.popularity ? Math.round(data.popularity * 10) / 10 : null,
        episodeRuntime: data.episode_run_time?.[0] ?? null,
        inProduction: data.in_production ?? null,
        lastAirDate: data.last_air_date || null,
        nextEpisodeAirDate: data.next_episode_to_air?.air_date ?? null,
        ratings: {
            tmdb: data.vote_average ? Math.round(data.vote_average * 10) / 10 : null,
            tmdbVotes: data.vote_count || 0,
            imdb: omdbRatings.imdbRating ?? null,
            imdbVotes: omdbRatings.imdbVotes ?? null,
            rottenTomatoes: omdbRatings.rottenTomatoes ?? null,
            metascore: omdbRatings.metascore ?? null,
        },
        crew: shapeCrew(data.credits?.crew),
        videos,
        keywords,
        reviews,
        networks: (data.networks || []).slice(0, 3).map((n) => ({
            id: n.id,
            name: n.name,
            logo: imgUrl(LOGO_SIZE, n.logo_path),
            country: n.origin_country,
        })),
    };
}

async function getSeasonDetails(tmdbId, seasonNumber) {
    const data = await tmdbFetch(`/tv/${tmdbId}/season/${seasonNumber}`);
    return {
        seasonNumber: data.season_number,
        name: data.name,
        overview: data.overview || null,
        poster: imgUrl(POSTER_SIZE, data.poster_path),
        airDate: data.air_date || null,
        episodeCount: (data.episodes || []).length,
        episodes: (data.episodes || []).map((ep) => ({
            // ── Existing fields ──
            episode: ep.episode_number,
            title: ep.name,
            overview: ep.overview || null,
            airDate: ep.air_date || null,
            runtime: ep.runtime || null,
            still: imgUrl(STILL_SIZE, ep.still_path),
            rating: ep.vote_average ? Math.round(ep.vote_average * 10) / 10 : null,
            // ── New fields ──
            tmdbEpisodeId: ep.id,
            voteCount: ep.vote_count || 0,
            guestStars: (ep.guest_stars || []).slice(0, 5).map((g) => ({
                tmdbPersonId: g.id,
                name: g.name,
                character: g.character,
                photo: imgUrl("w185", g.profile_path),
            })),
        })),
    };
}

// ─── Anime endpoints ──────────────────────────────────────────────────────────

async function searchAnime(title, year = null) {
    console.log(`[TMDB] searchAnime: "${title}" year=${year ?? "any"}`);
    const tv = await tmdbFetch("/search/tv", { query: title, first_air_date_year: year || undefined });
    const tvResults = (tv.results || []).slice(0, 10);
    const tvAnimated = tvResults.filter((r) => r.genre_ids?.includes(16));
    const tvHit = pickBestResult(tvAnimated.length ? tvAnimated : tvResults, title, year, "first_air_date");
    if (tvHit) {
        console.log(`[TMDB] searchAnime: → TV "${tvHit.name}" id=${tvHit.id}`);
        return { ...tvHit, _searchType: "tv" };
    }

    const mv = await tmdbFetch("/search/movie", { query: title, year: year || undefined });
    const mvResults = (mv.results || []).slice(0, 10);
    if (!mvResults.length) return null;
    const mvAnimated = mvResults.filter((r) => r.genre_ids?.includes(16));
    const mvHit = pickBestResult(mvAnimated.length ? mvAnimated : mvResults, title, year, "release_date");
    if (mvHit) {
        console.log(`[TMDB] searchAnime: → Movie "${mvHit.title}" id=${mvHit.id}`);
        return { ...mvHit, _searchType: "movie" };
    }
    return null;
}

// ─── Multi-part title candidates ──────────────────────────────────────────────

function buildMovieTitleCandidates(title, part) {
    if (part == null) return [title];
    return [`${title} Chapter ${part}`, `${title} Part ${part}`, title];
}

// ─── Main lookup ──────────────────────────────────────────────────────────────

async function lookupMetadata(parsed) {
    const { title, type, year, season, part } = parsed;

    if (!title || !title.trim()) {
        console.warn("[TMDB] lookupMetadata: empty title, skipping");
        return null;
    }

    const cleanT = title.replace(/\s+\d{4}$/, "").trim();
    const movieCandidates = buildMovieTitleCandidates(title, part);
    if (cleanT !== title) movieCandidates.push(cleanT);

    // ── Anime ─────────────────────────────────────────────────────────────────
    if (type === "anime") {
        let hit = await searchAnime(title, year);
        if (!hit && year) hit = await searchAnime(title, null);
        if (!hit && cleanT !== title) hit = await searchAnime(cleanT, null);
        if (!hit) return null;

        if (hit._searchType === "movie") {
            return { ...(await getMovieDetails(hit.id)), type: "anime" };
        }
        const details = await getTVDetails(hit.id);
        details.type = "anime";
        if (Number.isInteger(season) && season > 0) {
            details.seasonDetails = await getSeasonDetails(hit.id, season);
        }
        return details;
    }

    // ── Series ────────────────────────────────────────────────────────────────
    if (type === "series") {
        const tryTV = async (q, y) => {
            const hit = await searchTV(q, y);
            if (!hit) return null;
            const details = await getTVDetails(hit.id);
            if (Number.isInteger(season) && season > 0) {
                details.seasonDetails = await getSeasonDetails(hit.id, season);
            }
            return details;
        };

        let result = await tryTV(title, year);
        if (!result && year) result = await tryTV(title, null);
        if (!result && cleanT !== title) result = await tryTV(cleanT, null);
        if (result) return result;

        // Cross-type fallback
        for (const c of movieCandidates) {
            const hit = await searchMovie(c, year);
            if (hit) {
                console.log(`[TMDB] cross-type: series → movie for "${title}"`);
                return await getMovieDetails(hit.id);
            }
        }
        return null;
    }

    // ── Movie ─────────────────────────────────────────────────────────────────
    for (const candidate of movieCandidates) {
        if (year) {
            const hit = await searchMovie(candidate, year);
            if (hit) return await getMovieDetails(hit.id);
        }
        const hit = await searchMovie(candidate, null);
        if (hit) return await getMovieDetails(hit.id);
    }

    // Cross-type fallback
    const tvHit = await searchTV(title, year);
    if (tvHit) {
        console.log(`[TMDB] cross-type: movie → series for "${title}"`);
        const details = await getTVDetails(tvHit.id);
        if (Number.isInteger(season) && season > 0) {
            details.seasonDetails = await getSeasonDetails(tvHit.id, season);
        }
        return details;
    }

    console.log(`[TMDB] no match: "${title}" (${type})`);
    return null;
}

// ============================================================================
// ─── NEW: Release-date backfill patch layer ─────────────────────────────────
// Problem: some TMDB records have no release_date / first_air_date on the
// main endpoint (common for newer/regional/streaming-only titles). When that
// happens `releaseDate`/`firstAirDate`/`year` all come back null, which makes
// it look like metadata "didn't load" even though everything else (poster,
// overview, cast, etc.) fetched fine. This wraps the existing functions —
// none of their internal logic is touched — and fills the gap from
// alternate TMDB endpoints, falling back to the parsed filename year as a
// last resort.
// ============================================================================

// Earliest dated release across all countries from /movie/:id/release_dates
async function _fetchFallbackMovieReleaseDate(tmdbId) {
    const data = await tmdbFetchSafe(`/movie/${tmdbId}/release_dates`);
    const allDates = (data?.results || [])
        .flatMap((r) => r.release_dates || [])
        .map((d) => d.release_date)
        .filter(Boolean)
        .sort();
    return allDates[0] ? allDates[0].slice(0, 10) : null;
}

// Earliest season air_date, falling back to last_air_date, from /tv/:id
async function _fetchFallbackTVReleaseDate(tmdbId) {
    const data = await tmdbFetchSafe(`/tv/${tmdbId}`);
    if (!data) return null;
    const seasonDates = (data.seasons || [])
        .map((s) => s.air_date)
        .filter(Boolean)
        .sort();
    return seasonDates[0] || data.last_air_date || null;
}

const _origGetMovieDetails = getMovieDetails;
getMovieDetails = async function (tmdbId) {
    const result = await _origGetMovieDetails(tmdbId);
    if (result && !result.releaseDate) {
        const fallbackDate = await _fetchFallbackMovieReleaseDate(tmdbId);
        if (fallbackDate) {
            result.releaseDate = fallbackDate;
            result.year = parseInt(fallbackDate.slice(0, 4), 10);
        }
    }
    return result;
};

const _origGetTVDetails = getTVDetails;
getTVDetails = async function (tmdbId) {
    const result = await _origGetTVDetails(tmdbId);
    if (result && !result.firstAirDate) {
        const fallbackDate = await _fetchFallbackTVReleaseDate(tmdbId);
        if (fallbackDate) {
            result.firstAirDate = fallbackDate;
            result.year = parseInt(fallbackDate.slice(0, 4), 10);
        }
    }
    return result;
};

// Last resort: if TMDB has no date anywhere but the filename itself had a
// parsed year, use that so the UI never shows a completely empty year.
const _origLookupMetadata = lookupMetadata;
lookupMetadata = async function (parsed) {
    const result = await _origLookupMetadata(parsed);
    if (result && !result.year && parsed && parsed.year) {
        result.year = parsed.year;
        if (result.type === "movie" && !result.releaseDate) {
            result.releaseDate = `${parsed.year}-01-01`;
        }
        if ((result.type === "series" || result.type === "anime") && !result.firstAirDate) {
            result.firstAirDate = `${parsed.year}-01-01`;
        }
    }
    return result;
};

module.exports = {
    lookupMetadata,
    searchMovie,
    searchTV,
    searchAnime,
    getMovieDetails,
    getTVDetails,
    getSeasonDetails,
};
