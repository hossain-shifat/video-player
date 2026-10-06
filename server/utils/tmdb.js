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
// SPEED FIX: this was capped at 38 requests per 10 SECONDS (~3.8 req/sec) —
// a leftover from TMDB's old v3-era "40 requests / 10 seconds" policy. With
// ~3-4 TMDB calls per title (base + release_dates/content_ratings + up to 2
// review pages), 1000 titles = ~3500-4000 calls. At 3.8/sec that's
// 900-1050 SECONDS (15-17 minutes) just waiting in the rate-limit queue —
// this alone was the entire "too slow" problem, and it's also why
// production_companies looked permanently null for later titles: their
// /company/{id} calls were sitting in that same backed-up queue and simply
// hadn't gotten a turn yet, not actually failing.
//
// TMDB's modern real-world ceiling is far higher than the old 40/10s policy
// — effectively no hard cap with a valid key, ~50 req/sec is a commonly
// used safe target. Defaulting to that; override via env if you're hitting
// 429s on your specific key/plan, or want to push it higher.
//   TMDB_RATE_LIMIT      — max requests per window (default 45)
//   TMDB_RATE_WINDOW_MS  — window length in ms (default 1000 = 1 second)
// 45 req/sec ≈ 2700 req/min — at ~3-4 calls/title that's roughly 700-900
// titles/min on a cold cache, and much faster once production companies
// start hitting their cross-title cache.
const RATE_LIMIT = parseInt(process.env.TMDB_RATE_LIMIT || "45", 10);
const RATE_WINDOW = parseInt(process.env.TMDB_RATE_WINDOW_MS || "1000", 10);
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

// ─── New helper functions (reviews, OMDB, etc.) ───────────────────────────────
//
// CLEANUP: fetchContentRating() and fetchKeywords() were removed here.
// They each cost one extra TMDB request PER TITLE (2 extra calls x every
// movie/show in your library) and fed `contentRating` / `keywords` fields
// that are never read by MediaDetails.jsx, CastAndCrew.jsx, Reviews.jsx,
// SimilarMedia.jsx, or DashMedia.jsx — confirmed by grep across all of them.
// Removing them cuts TMDB traffic and speeds up first-time scans/refreshes.
//
// v18 NOTE: keywords is reintroduced below via the metadata-upgrade patch
// layer near the bottom of this file — the frontend now has a planned use
// for it, so it's no longer dead weight. This block/comment is left as-is
// for history; the new fetch path is separate and additive.

// Silent fetch — returns null on error (for optional enrichment calls)
async function tmdbFetchSafe(endpoint, params = {}) {
    try {
        return await tmdbFetch(endpoint, params);
    } catch {
        return null;
    }
}

// Collect review IDs only — frontend queries /api/review/:id for full data.
// SPEED FIX: was always fetching page 1 AND page 2 unconditionally — most
// titles have 20 or fewer reviews total (fits on page 1), so that second
// call was wasted on the common case. Only fetch page 2 when page 1 itself
// says there's more (total_pages > 1). At 1000-title scale that's roughly
// 1000 fewer TMDB calls for titles with a single page of reviews.
async function fetchReviews(endpoint) {
    const p1 = await tmdbFetchSafe(`${endpoint}/reviews`, { page: 1 });
    let all = p1?.results ?? [];
    if ((p1?.total_pages ?? 1) > 1) {
        const p2 = await tmdbFetchSafe(`${endpoint}/reviews`, { page: 2 });
        all = all.concat(p2?.results ?? []);
    }
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

// NULL FIX: TMDB sometimes sends null/empty for name, character, job,
// department on individual credit entries (guest/uncredited/combined-credit
// rows). Previously these passed straight through as `null`, which the
// frontend then rendered literally as the text "null" in the cast/crew UI.
// Every string field below now falls back to a safe display value instead.
function safeStr(val, fallback) {
    return typeof val === "string" && val.trim() ? val.trim() : fallback;
}

// Cast with tmdbPersonId (for future /person/:id lookups)
function shapeCast(castArr, limit = 15) {
    return (castArr || [])
        .filter((c) => c && safeStr(c.name, null)) // drop entries with no usable name at all
        .slice(0, limit)
        .map((c) => ({
            tmdbPersonId: c.id,
            name: safeStr(c.name, "Unknown"),
            character: safeStr(c.character, "Unknown Role"),
            order: c.order ?? null,
            photo: imgUrl("w185", c.profile_path),
        }));
}

// Key crew — expanded (v18) from the original director/writer/DP/composer-only
// set to also cover producing, editing, and design roles (metadata upgrade
// plan, "expanded crew" feature). Purely additive: existing job names kept,
// new ones appended. Limit raised 10 → 15 to give the wider role set room
// without starving out directors/writers.
function shapeCrew(crewArr) {
    const KEEP = new Set([
        "Director",
        "Screenplay",
        "Writer",
        "Story",
        "Producer",
        "Executive Producer",
        "Editor",
        "Director of Photography",
        "Original Music Composer",
        "Production Designer",
        "Costume Designer",
        "Casting",
    ]);
    return (crewArr || [])
        .filter((c) => c && KEEP.has(c.job) && safeStr(c.name, null))
        .slice(0, 15)
        .map((c) => ({
            tmdbPersonId: c.id,
            name: safeStr(c.name, "Unknown"),
            job: safeStr(c.job, "Unknown Role"),
            department: safeStr(c.department, "Unknown"),
            photo: imgUrl("w185", c.profile_path),
        }));
}

// ─── Production companies ──────────────────────────────────────────────────────
// ADDED. `data.production_companies` on the base /movie or /tv response only
// gives {id, name, logo_path, origin_country} — no description, no
// headquarters, no homepage, no parent company. Those live on a SEPARATE
// per-company endpoint: GET /company/{id}.
//
// Cached per company id, not per title — the same studio (Marvel Studios,
// Warner Bros, Toei Animation, etc.) shows up across many titles in your
// library, and a company's own details barely ever change. First movie that
// references "Marvel Studios" pays for the call; every other title that also
// has Marvel Studios attached reuses the cached result for free.
//
// FIX: only a SUCCESSFUL fetch gets cached permanently now. Previously the
// in-flight promise itself was cached immediately — if that first fetch
// failed (timeout/rate-limit/etc, easy to hit during a big first scan with
// lots of companies), the cached result was a resolved `null` FOREVER, with
// no retry ever happening again for that company. That's exactly why
// description/parentCompany were stuck null — those two fields have no
// fallback to the base list data (unlike name/logo/originCountry, which do),
// so a permanently-poisoned cache entry showed up as "always null" for them
// specifically. A separate in-flight map still dedupes concurrent requests
// for the same company without permanently caching a failure.
const _companyDetailsCache = new Map(); // companyId -> resolved data, ONLY on success
const _companyDetailsInFlight = new Map(); // companyId -> pending promise, cleared once settled

function _fetchCompanyDetails(companyId) {
    if (_companyDetailsCache.has(companyId)) return Promise.resolve(_companyDetailsCache.get(companyId));
    if (_companyDetailsInFlight.has(companyId)) return _companyDetailsInFlight.get(companyId);

    const promise = tmdbFetchSafe(`/company/${companyId}`).then((data) => {
        _companyDetailsInFlight.delete(companyId);
        if (data) _companyDetailsCache.set(companyId, data); // only cache real success
        return data;
    });
    _companyDetailsInFlight.set(companyId, promise);
    return promise;
}

// De-dupes overlapping fields between the base list entry and the detail
// fetch (both can carry `name`/`origin_country`) — each ends up as exactly
// ONE key in the output, detail-fetch value preferred when present, base
// list value as fallback. No duplicate/near-duplicate keys shipped.
async function shapeProductionCompanies(companiesArr) {
    if (!companiesArr || !companiesArr.length) return [];
    return Promise.all(
        companiesArr.map(async (c) => {
            const details = await _fetchCompanyDetails(c.id);
            const parent = details?.parent_company;
            return {
                tmdbCompanyId: c.id,
                name: details?.name || c.name,
                logo: imgUrl(LOGO_SIZE, details?.logo_path || c.logo_path),
                originCountry: details?.origin_country || c.origin_country || null,
                description: details?.description || null,
                headquarters: details?.headquarters || null,
                homepage: details?.homepage || null,
                parentCompany: parent
                    ? {
                          tmdbCompanyId: parent.id,
                          name: parent.name,
                          logo: imgUrl(LOGO_SIZE, parent.logo_path),
                      }
                    : null,
            };
        }),
    );
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

    const imdbId = data.external_ids?.imdb_id ?? null;

    // SPEED FIX: these three don't depend on each other at all — reviews and
    // production companies only need `data` (already have it), OMDB only
    // needs imdbId (already have it). They were being awaited one at a time
    // before, which just stacks up latency for no reason. Fire all three at
    // once instead.
    const [reviews, omdbRatings, production_companies] = await Promise.all([fetchReviews(`/movie/${tmdbId}`), fetchOmdbRatings(imdbId), shapeProductionCompanies(data.production_companies)]);

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
        // ── Confirmed-used enrichment ──
        imdbId,
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
        reviews,
        // ── UPDATED: was `studios` (name-only strings), now `production_companies`
        // (full objects: name, logo, description, headquarters, homepage,
        // parentCompany) — see shapeProductionCompanies() above.
        production_companies,
        // NOTE: popularity, budget, revenue, collection, spokenLanguages,
        // contentRating, keywords were removed here — confirmed unused by
        // every frontend file that reads this object.
        // v18: budget, collection, spokenLanguages, keywords are back — see
        // the metadata-upgrade patch layer near the bottom of this file.
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

    const imdbId = data.external_ids?.imdb_id ?? null;

    // SPEED FIX: same as getMovieDetails — these three are independent,
    // fire them together instead of one at a time.
    const [reviews, omdbRatings, production_companies] = await Promise.all([fetchReviews(`/tv/${tmdbId}`), fetchOmdbRatings(imdbId), shapeProductionCompanies(data.production_companies)]);

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
        // ── Confirmed-used enrichment ──
        imdbId,
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
        reviews,
        // ── UPDATED: was `studios` (name-only strings), now `production_companies`
        // (full objects: name, logo, description, headquarters, homepage,
        // parentCompany) — see shapeProductionCompanies() above. Anime goes
        // through this same function (see lookupMetadata), so covered too.
        production_companies,
        // NOTE: popularity, episodeRuntime, inProduction, lastAirDate,
        // nextEpisodeAirDate, networks, contentRating, keywords were removed
        // here — confirmed unused by every frontend file that reads this object.
        // v18: networks, lastAirDate/nextEpisode (as episodeSchedule),
        // spokenLanguages, keywords are back — see the metadata-upgrade patch
        // layer near the bottom of this file. Aggregate (all-season) credits
        // are also applied there, replacing cast/crew above when available.
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
            episode: ep.episode_number,
            title: ep.name,
            overview: ep.overview || null,
            airDate: ep.air_date || null,
            runtime: ep.runtime || null,
            still: imgUrl(STILL_SIZE, ep.still_path),
            rating: ep.vote_average ? Math.round(ep.vote_average * 10) / 10 : null,
            // NOTE: tmdbEpisodeId, voteCount, guestStars were removed here —
            // confirmed unused (EpisodeRow in MediaDetails.jsx only reads
            // episode/title/overview/airDate/runtime/still/rating).
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

// ADDED: getSeasonDetails() itself still returns `seasonNumber` — that's the
// right, generic behavior for a "get details of season N" function, and
// anything else calling it directly (e.g. grouper.js building the
// per-season `seasons: {"1": {...}, "2": {...}}` map) is untouched and still
// gets the full object exactly as before.
//
// The ONLY duplicate was here: lookupMetadata attaches a SINGLE season's
// details directly onto the metadata object as `metadata.seasonDetails`
// (used when a filename parses to one specific season), sitting right next
// to the already-keyed `seasons` object elsewhere in the same response —
// `seasonNumber` inside `seasonDetails` was just repeating what's already
// the outer `seasons` object's own key. Stripped only at this one attach
// point, in all 3 places lookupMetadata does this (anime, series, cross-type
// movie→series fallback).
function _seasonDetailsWithoutNumber(seasonDetails) {
    const { seasonNumber: _drop, ...rest } = seasonDetails;
    return rest;
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
            details.seasonDetails = _seasonDetailsWithoutNumber(await getSeasonDetails(hit.id, season));
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
                details.seasonDetails = _seasonDetailsWithoutNumber(await getSeasonDetails(hit.id, season));
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
            details.seasonDetails = _seasonDetailsWithoutNumber(await getSeasonDetails(tvHit.id, season));
        }
        return details;
    }

    console.log(`[TMDB] no match: "${title}" (${type})`);
    return null;
}

// ============================================================================
// ─── Merged enrichment patch layer (release-date backfill + certifications) ──
// SPEED FIX: this used to be TWO separate wrap layers stacked on top of each
// other (release-date-backfill wrap, then certification wrap on top of
// THAT). Because each wrap fully awaits the one underneath before doing its
// own extra work, that stacked 2-3 sequential round trips end-to-end for
// every single title. On top of that, the two layers were EACH independently
// calling GET /movie/{id}/release_dates — the exact same endpoint, fetched
// twice, thrown away once. Both problems fixed by merging into one wrap that
// fires everything it needs in parallel via Promise.all and shares the one
// release_dates fetch between both features.
//
// None of getMovieDetails/getTVDetails' own internal logic (still further
// up in this file) is touched — this wraps the fully-built function exactly
// like before, just as a single combined layer instead of two nested ones.
//
// Problem 1 (release-date backfill): some TMDB records have no release_date
// / first_air_date on the main endpoint (common for newer/regional/
// streaming-only titles). Falls back to alternate TMDB endpoints.
//
// Problem 2 (certifications): per-title certification (e.g. "PG-13") comes
// from a different endpoint per type:
//   Movie → GET /movie/{id}/release_dates   → results[].release_dates[].certification
//   TV    → GET /tv/{id}/content_ratings    → results[].rating
// enriched with human-readable meaning/order from TMDB's MASTER reference
// tables (GET /certification/movie/list, GET /certification/tv/list) —
// those are static, fetched once per server process, cached forever after.
//
// Anime routes through getMovieDetails/getTVDetails just like everything
// else (see lookupMetadata's anime branch), so it's covered automatically.
// ============================================================================

// Master reference tables — fetched once, reused for every title afterward.
let _movieCertListCache = null;
let _tvCertListCache = null;

async function _getMovieCertList() {
    if (_movieCertListCache) return _movieCertListCache;
    const data = await tmdbFetchSafe("/certification/movie/list");
    _movieCertListCache = data?.certifications || {};
    return _movieCertListCache;
}

async function _getTVCertList() {
    if (_tvCertListCache) return _tvCertListCache;
    const data = await tmdbFetchSafe("/certification/tv/list");
    _tvCertListCache = data?.certifications || {};
    return _tvCertListCache;
}

// Cross-references one certification code against the master list for that
// country, returning the full {certification, meaning, order} entry. Falls
// back to a bare object (meaning/order null) if TMDB's master list doesn't
// have a matching entry for some reason.
function _lookupCertEntry(certList, country, certValue) {
    const entries = certList[country] || [];
    const found = entries.find((e) => e.certification === certValue);
    return found ? { certification: found.certification, meaning: found.meaning, order: found.order } : { certification: certValue, meaning: null, order: null };
}

// Pulls both the fallback release date AND the certification map out of the
// SAME already-fetched /movie/{id}/release_dates payload — one call serving
// two features instead of one call each.
function _extractFallbackReleaseDate(releaseDatesRaw) {
    const allDates = (releaseDatesRaw?.results || [])
        .flatMap((r) => r.release_dates || [])
        .map((d) => d.release_date)
        .filter(Boolean)
        .sort();
    return allDates[0] ? allDates[0].slice(0, 10) : null;
}

// LIMIT FIX: TMDB returns certifications for every country it has data for
// (often 15-20+) — nobody scrolls through that many badges. Keep only the
// top N, env-configurable via TMDB_CERT_COUNTRY_LIMIT (default 3).
// US (and GB as a secondary anchor) are prioritized if present, then the
// rest fill in whatever order TMDB returned them in.
const CERT_COUNTRY_LIMIT = parseInt(process.env.TMDB_CERT_COUNTRY_LIMIT || "3", 10);
const CERT_COUNTRY_PRIORITY = ["US", "GB"];

function _limitCertCountries(out) {
    const keys = Object.keys(out);
    if (keys.length <= CERT_COUNTRY_LIMIT) return out;

    const picked = CERT_COUNTRY_PRIORITY.filter((cc) => keys.includes(cc));
    for (const cc of keys) {
        if (picked.length >= CERT_COUNTRY_LIMIT) break;
        if (!picked.includes(cc)) picked.push(cc);
    }

    const limited = {};
    for (const cc of picked.slice(0, CERT_COUNTRY_LIMIT)) limited[cc] = out[cc];
    return limited;
}

function _extractMovieCertifications(releaseDatesRaw, certList) {
    const countries = releaseDatesRaw?.results || [];
    const out = {};
    for (const c of countries) {
        const codes = [...new Set((c.release_dates || []).map((d) => d.certification).filter((v) => v && v.trim()))];
        if (!codes.length) continue;
        // Sorted ascending by `order` (mildest → strictest), matching the
        // reference structure you gave. Capped to top 2 codes per country —
        // a country re-releasing with a second rating is rare and the extra
        // entries were just noise.
        out[c.iso_3166_1] = codes
            .map((code) => _lookupCertEntry(certList, c.iso_3166_1, code))
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
            .slice(0, 2);
    }
    return _limitCertCountries(out);
}

// Earliest season air_date, falling back to last_air_date, from /tv/:id —
// only fetched when firstAirDate is actually missing (rare), kept as a
// separate conditional step so the common case (date already present)
// doesn't pay for an extra call it doesn't need.
async function _fetchFallbackTVReleaseDate(tmdbId) {
    const data = await tmdbFetchSafe(`/tv/${tmdbId}`);
    if (!data) return null;
    const seasonDates = (data.seasons || [])
        .map((s) => s.air_date)
        .filter(Boolean)
        .sort();
    return seasonDates[0] || data.last_air_date || null;
}

function _extractTVCertifications(contentRatingsRaw, certList) {
    const countries = contentRatingsRaw?.results || [];
    const out = {};
    for (const c of countries) {
        if (!c.rating || !c.rating.trim()) continue;
        out[c.iso_3166_1] = [_lookupCertEntry(certList, c.iso_3166_1, c.rating)];
    }
    return _limitCertCountries(out);
}

// ── Movie: base call + release_dates (shared by date-fallback AND
// certifications) + cert master list, ALL in parallel. release_dates ends up
// fetched exactly once per movie no matter what, instead of 0-2 times.
const _origGetMovieDetails = getMovieDetails;
getMovieDetails = async function (tmdbId) {
    const [result, releaseDatesRaw, certList] = await Promise.all([_origGetMovieDetails(tmdbId), tmdbFetchSafe(`/movie/${tmdbId}/release_dates`), _getMovieCertList()]);
    if (!result) return result;

    if (!result.releaseDate) {
        const fallbackDate = _extractFallbackReleaseDate(releaseDatesRaw);
        if (fallbackDate) {
            result.releaseDate = fallbackDate;
            result.year = parseInt(fallbackDate.slice(0, 4), 10);
        }
    }
    result.certifications = _extractMovieCertifications(releaseDatesRaw, certList);
    return result;
};

// ── TV/anime: base call + content_ratings (always needed) + cert master
// list, in parallel. The release-date fallback fetch is a DIFFERENT
// endpoint (/tv/{id}, not /content_ratings) and only actually needed when
// firstAirDate is missing (rare) — kept as a conditional follow-up so the
// common case doesn't pay for a call it doesn't need.
const _origGetTVDetails = getTVDetails;
getTVDetails = async function (tmdbId) {
    const [result, contentRatingsRaw, certList] = await Promise.all([_origGetTVDetails(tmdbId), tmdbFetchSafe(`/tv/${tmdbId}/content_ratings`), _getTVCertList()]);
    if (!result) return result;

    if (!result.firstAirDate) {
        const fallbackDate = await _fetchFallbackTVReleaseDate(tmdbId);
        if (fallbackDate) {
            result.firstAirDate = fallbackDate;
            result.year = parseInt(fallbackDate.slice(0, 4), 10);
        }
    }
    result.certifications = _extractTVCertifications(contentRatingsRaw, certList);
    return result;
};

// ============================================================================
// ─── Metadata upgrade patch layer (v18) ──────────────────────────────────────
// ADDITIVE ONLY — wraps the already-certified getMovieDetails/getTVDetails
// (the layer directly above) with ONE more parallel TMDB call each, same
// pattern as the certifications layer: everything fired together via
// Promise.all, nothing above this line touched.
//
// Re-adds fields that a previous cleanup pass removed as "confirmed unused"
// (collection, spokenLanguages, keywords, budget/revenue, networks,
// nextEpisodeAirDate) — the frontend now has planned uses for them (collection
// row, language/country badges, keyword search foundation, next-episode
// card). Nothing existing is removed, renamed, or restructured.
//
// Also applies TV aggregate_credits (whole-show cast/crew across every
// season, not just whichever episode happened to be the TMDB match) with a
// safe fallback to the existing per-episode credits if TMDB doesn't return
// usable aggregate data for a given show.
//
// PARSER_VERSION note: this changes both getMovieDetails' and getTVDetails'
// returned shape, so metadataStore.js's PARSER_VERSION was bumped to 18 in
// the same delivery — old cache entries auto-invalidate, no manual
// metadata.json deletion needed. See metadataStore.js version history.
// ============================================================================

// belongs_to_collection → safe object or null. Never fabricated.
function _mapCollection(bc) {
    if (!bc) return null;
    return {
        tmdbId: bc.id,
        name: bc.name,
        poster: imgUrl(POSTER_SIZE, bc.poster_path),
        backdrop: imgUrl(BACKDROP_SIZE, bc.backdrop_path),
    };
}

// spoken_languages[] → safe array
function _mapSpokenLanguages(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map((l) => ({
        code: l.iso_639_1 || null,
        name: l.name || null,
        englishName: l.english_name || null,
    }));
}

// origin_country[] → safe array (movie or TV) — NOT production-company origin
function _mapOriginCountries(arr) {
    return Array.isArray(arr) ? arr.filter(Boolean) : [];
}

// keywords response shape differs by endpoint: movie → {keywords:[...]},
// tv → {results:[...]}. This is a backend/search foundation — not meant to
// be dumped prominently into the UI.
function _mapKeywords(raw) {
    const list = Array.isArray(raw?.keywords) ? raw.keywords : Array.isArray(raw?.results) ? raw.results : [];
    return list.map((k) => ({ tmdbId: k.id, name: k.name }));
}

// external_ids → structured object. The existing top-level `imdbId` string
// field is left completely untouched — this is an additional representation.
function _mapExternalIds(ext, tmdbId) {
    return {
        imdb: ext?.imdb_id || null,
        tmdb: tmdbId != null ? String(tmdbId) : null,
        wikidata: ext?.wikidata_id || null,
    };
}

// TV aggregate_credits crew items carry a jobs[] array instead of a single
// job — flatten to one entry per job so shapeCrew()'s KEEP-set filter/dedupe
// applies exactly the same way it does for regular movie/TV credits.
function _flattenAggregateCrew(arr) {
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const c of arr) {
        const jobs = Array.isArray(c.jobs) && c.jobs.length ? c.jobs.map((j) => j.job) : [];
        for (const job of jobs) {
            out.push({ id: c.id, name: c.name, job, department: c.department, profile_path: c.profile_path });
        }
    }
    return out;
}

// Deterministic trailer scoring: YouTube > official > Trailer > Teaser >
// Featurette/Clip, tie-broken by newest publish date. Replaces the base
// function's naive "first Trailer-type video" pick with an intelligent one,
// using the full (untrimmed) videos.results TMDB gave us — the existing
// trimmed `videos` array on the result object is left exactly as-is.
function _scoreVideoForTrailer(v) {
    let score = 0;
    if (v.site === "YouTube") score += 100;
    if (v.official) score += 50;
    if (v.type === "Trailer") score += 40;
    else if (v.type === "Teaser") score += 30;
    else if (v.type === "Featurette") score += 10;
    else if (v.type === "Clip") score += 5;
    if (typeof v.size === "number" && v.size >= 1080) score += 5;
    return score;
}

function _pickBestTrailerKey(videosResults) {
    const list = Array.isArray(videosResults) ? videosResults : [];
    if (!list.length) return null;
    const sorted = [...list].sort((a, b) => {
        const diff = _scoreVideoForTrailer(b) - _scoreVideoForTrailer(a);
        if (diff !== 0) return diff;
        return new Date(b.published_at || 0) - new Date(a.published_at || 0);
    });
    return sorted[0]?.key || null;
}

const _origGetMovieDetailsV2 = getMovieDetails;
getMovieDetails = async function (tmdbId) {
    const [result, extra] = await Promise.all([_origGetMovieDetailsV2(tmdbId), tmdbFetchSafe(`/movie/${tmdbId}`, { append_to_response: "keywords,external_ids,videos" })]);
    if (!result) return result;

    result.collection = _mapCollection(extra?.belongs_to_collection);
    result.spokenLanguages = _mapSpokenLanguages(extra?.spoken_languages);
    result.originCountries = _mapOriginCountries(extra?.origin_country);
    result.keywords = _mapKeywords(extra?.keywords);
    result.externalIds = _mapExternalIds(extra?.external_ids, tmdbId);
    result.financials = {
        budget: extra?.budget || null,
        revenue: extra?.revenue || null,
    };
    result.trailer = _pickBestTrailerKey(extra?.videos?.results) || result.trailer;
    return result;
};

const _origGetTVDetailsV2 = getTVDetails;
getTVDetails = async function (tmdbId) {
    const [result, extra] = await Promise.all([_origGetTVDetailsV2(tmdbId), tmdbFetchSafe(`/tv/${tmdbId}`, { append_to_response: "aggregate_credits,keywords,external_ids,videos" })]);
    if (!result) return result;

    result.spokenLanguages = _mapSpokenLanguages(extra?.spoken_languages);
    result.originCountries = _mapOriginCountries(extra?.origin_country);
    result.keywords = _mapKeywords(extra?.keywords);
    result.externalIds = _mapExternalIds(extra?.external_ids, tmdbId);
    result.networks = (extra?.networks || []).map((n) => ({
        id: n.id,
        name: n.name,
        logo: imgUrl(LOGO_SIZE, n.logo_path),
    }));
    result.episodeSchedule = {
        lastAirDate: extra?.last_air_date || null,
        nextAirDate: extra?.next_episode_to_air?.air_date || null,
        nextEpisode: extra?.next_episode_to_air
            ? {
                  season: extra.next_episode_to_air.season_number,
                  episode: extra.next_episode_to_air.episode_number,
                  name: extra.next_episode_to_air.name,
                  airDate: extra.next_episode_to_air.air_date,
              }
            : null,
    };
    // TMDB's /tv endpoint has no budget/revenue data at all — it's a movie-only
    // concept on TMDB's side, not something we're failing to fetch. Kept null
    // (never fabricated) purely so the frontend can read `financials` off
    // movie AND series/anime without a type check.
    result.financials = {
        budget: null,
        revenue: null,
    };
    result.trailer = _pickBestTrailerKey(extra?.videos?.results) || result.trailer;

    // Aggregate credits represent the show across ALL seasons — prefer them
    // for cast/crew when TMDB actually returned usable data. If not (some
    // shows genuinely have no aggregate_credits), the existing per-episode
    // cast/crew from the base layer is left untouched — safe degrade.
    const aggCast = extra?.aggregate_credits?.cast;
    if (Array.isArray(aggCast) && aggCast.length) {
        result.cast = shapeCast(
            aggCast.map((c) => ({ ...c, character: c.roles?.[0]?.character || null })),
            15,
        );
    }
    const aggCrew = extra?.aggregate_credits?.crew;
    if (Array.isArray(aggCrew) && aggCrew.length) {
        result.crew = shapeCrew(_flattenAggregateCrew(aggCrew));
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

// ============================================================================
// ─── Trailer discovery (v20) ─────────────────────────────
// ADDITIVE ONLY. Powers trailerController.js's discover feed: NEW
// movies/series from production companies already in your library, that
// you don't own yet. Does NOT touch metadata.json / PARSER_VERSION — results
// are cached separately in trailers.json via trailerStore.js.
//
// Not the full getMovieDetails/getTVDetails pipeline on purpose: no
// credits/reviews/OMDB/company-detail fetches needed just to know a trailer
// exists — keeps discovery cheap even across many studios/pages.
// ============================================================================

// Only titles releasing within this window count as "new" — otherwise every
// studio dumps its entire back catalog into the discover row. No upper bound,
// so upcoming/unreleased titles are included too (Plex shows those as well).
function _discoverCutoffDate() {
    const days = parseInt(process.env.TMDB_DISCOVER_WINDOW_DAYS || "180", 10);
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
}

// mediaType: "movie" | "tv" (series + anime both live under /tv on TMDB —
// caller maps its own type before calling this).
async function discoverByCompany(companyId, mediaType, page = 1) {
    const endpoint = mediaType === "tv" ? "/discover/tv" : "/discover/movie";
    const sortField = mediaType === "tv" ? "first_air_date.desc" : "primary_release_date.desc";
    const dateParam = mediaType === "tv" ? "first_air_date.gte" : "primary_release_date.gte";

    const data = await tmdbFetchSafe(endpoint, {
        with_companies: companyId,
        sort_by: sortField,
        [dateParam]: _discoverCutoffDate(),
        include_adult: false,
        page,
    });
    return data?.results || [];
}

// Lightweight videos-only fetch for one discovered result — reuses the same
// deterministic trailer scoring (_pickBestTrailerKey / _scoreVideoForTrailer)
// the main pipeline uses, so "best trailer" logic never drifts between the
// two features.
async function getVideosFor(tmdbId, mediaType) {
    const endpoint = mediaType === "tv" ? `/tv/${tmdbId}/videos` : `/movie/${tmdbId}/videos`;
    const data = await tmdbFetchSafe(endpoint);
    const yt = (data?.results || []).filter((v) => v.site === "YouTube");
    const trailer = _pickBestTrailerKey(yt);
    const videos = yt
        .filter((v) => ["Trailer", "Teaser"].includes(v.type))
        .slice(0, 3)
        // published_at is what powers the "New Trailers" freshness sort in
        // trailerController.js — when the TRAILER was published on YouTube,
        // not the movie/show's own release date.
        .map((v) => ({ type: v.type, key: v.key, name: v.name, publishedAt: v.published_at || null }));
    const trailerVideo = videos.find((v) => v.key === trailer);
    return { trailer, trailerPublishedAt: trailerVideo?.publishedAt || videos[0]?.publishedAt || null, videos };
}

module.exports = {
    lookupMetadata,
    searchMovie,
    searchTV,
    searchAnime,
    getMovieDetails,
    getTVDetails,
    getSeasonDetails,
    discoverByCompany,
    getVideosFor,
};
