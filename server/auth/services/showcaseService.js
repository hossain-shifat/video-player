"use strict";

/**
 * auth/services/showcaseService.js
 * Poster wall for the sign-in screens: RANDOM, RECENT movies, series and anime fetched straight from TMDB
 * (not from your library — so nothing about what you own is exposed to visitors).
 *
 *   movies   now playing + newest popular releases
 *   series   currently on the air + newest popular first-airs
 *   anime    recent Japanese animation (TV and film)
 *
 * The pool (~100 posters) is built with a handful of TMDB calls and cached in memory for 6 hours; every
 * request just samples it (so the login page never waits on TMDB and visitors cause no TMDB traffic).
 * Stale data is served while a refresh runs; if TMDB is unreachable the answer is simply an empty list and the
 * screens fall back to abstract tiles.
 *
 * What leaves the server: ONLY { poster, type } — a public TMDB image URL and a type label.
 *
 * RESTRICTED CONTENT is never used. A title is dropped when
 *   - TMDB flags it `adult` (and every query sends include_adult=false), or
 *   - its title contains a restricted word, or its overview contains one of the explicit ones (18+, xxx, nsfw, porn…).
 * Env: TMDB_API_KEY (already used by FLUX), TMDB_LANGUAGE, AUTH_SHOWCASE=off to disable,
 *      AUTH_SHOWCASE_RESTRICTED_WORDS (comma list, default "adult,18+,xxx,nsfw,porn").
 */

const TMDB_BASE = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p/w500";
const TTL_MS = 6 * 60 * 60 * 1000;
const RETRY_MS = 60 * 1000; // after a failed refresh with nothing cached
const TYPES = ["movie", "series", "anime"];

let cache = { at: 0, items: [], loading: null, error: null };
let warnedKey = false;

function enabled() {
    return String(process.env.AUTH_SHOWCASE || "on").toLowerCase() !== "off";
}

function restrictedWords() {
    return String(process.env.AUTH_SHOWCASE_RESTRICTED_WORDS ?? "adult,18+,xxx,nsfw,porn")
        .split(",")
        .map((w) => w.trim().toLowerCase())
        .filter(Boolean);
}

const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** true when the TMDB record must NOT be shown (restricted content). */
function isRestricted(r, words = restrictedWords()) {
    if (r.adult === true) return true;
    const title = `${r.title || ""} ${r.name || ""} ${r.original_title || ""} ${r.original_name || ""}`.toLowerCase();
    const overview = String(r.overview || "").toLowerCase();
    return words.some((w) => {
        const re = new RegExp(`(^|[^a-z0-9])${esc(w)}($|[^a-z0-9])`, "i"); // whole word, so "18+" matches but "adulthood" does not
        if (re.test(title)) return true;
        // overviews are prose ("adult life" is innocent) — only the unambiguous words count there
        return w !== "adult" && re.test(overview);
    });
}

async function tmdb(endpoint, params = {}) {
    const url = new URL(`${TMDB_BASE}${endpoint}`);
    url.searchParams.set("api_key", process.env.TMDB_API_KEY);
    url.searchParams.set("language", process.env.TMDB_LANGUAGE || "en-US");
    url.searchParams.set("include_adult", "false");
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
        const res = await fetch(url.toString(), { signal: ctrl.signal });
        if (!res.ok) throw new Error(`TMDB ${res.status}`);
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

const ymd = (d) => d.toISOString().slice(0, 10);

async function buildPool() {
    const now = new Date();
    const today = ymd(now);
    const since = ymd(new Date(now.getTime() - 400 * 864e5)); // ~13 months back = "latest"
    const sinceAnime = ymd(new Date(now.getTime() - 800 * 864e5));

    const jobs = [
        ["movie", "/movie/now_playing", { page: 1 }],
        ["movie", "/movie/now_playing", { page: 2 }],
        ["movie", "/discover/movie", { sort_by: "popularity.desc", "primary_release_date.gte": since, "primary_release_date.lte": today, "vote_count.gte": 30 }],
        ["series", "/tv/on_the_air", { page: 1 }],
        ["series", "/tv/on_the_air", { page: 2 }],
        ["series", "/discover/tv", { sort_by: "popularity.desc", "first_air_date.gte": since, "first_air_date.lte": today, "vote_count.gte": 10 }],
        ["anime", "/discover/tv", { with_genres: 16, with_original_language: "ja", sort_by: "popularity.desc", "first_air_date.gte": sinceAnime, "first_air_date.lte": today }],
        ["anime", "/discover/tv", { with_genres: 16, with_original_language: "ja", sort_by: "popularity.desc", "first_air_date.gte": sinceAnime, "first_air_date.lte": today, page: 2 }],
        ["anime", "/discover/movie", { with_genres: 16, with_original_language: "ja", sort_by: "popularity.desc", "primary_release_date.gte": sinceAnime, "primary_release_date.lte": today }],
    ];

    const settled = await Promise.allSettled(jobs.map(([, ep, params]) => tmdb(ep, params)));
    const words = restrictedWords();
    const seen = new Set();
    const items = [];
    settled.forEach((res, i) => {
        if (res.status !== "fulfilled") return;
        const type = jobs[i][0];
        for (const r of res.value?.results || []) {
            if (!r?.poster_path || isRestricted(r, words)) continue;
            const key = `${type}:${r.id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            items.push({ poster: `${IMG_BASE}${r.poster_path}`, type });
        }
    });
    if (settled.every((s) => s.status === "rejected")) throw settled[0].reason;
    return items;
}

function refresh() {
    if (cache.loading) return cache.loading;
    cache.loading = buildPool()
        .then((items) => {
            cache = { at: Date.now(), items, loading: null, error: null };
            console.log(`[Showcase] ${items.length} recent TMDB poster(s) cached (restricted content excluded).`);
        })
        .catch((err) => {
            const msg = String(err?.message || err);
            console.warn("[Showcase] TMDB refresh failed:", msg, "— check TMDB_API_KEY and that this server can reach api.themoviedb.org.");
            // keep serving what we have; try again soon if there is nothing yet
            cache = { at: cache.items.length ? Date.now() - TTL_MS + 10 * RETRY_MS : Date.now() - TTL_MS + RETRY_MS, items: cache.items, loading: null, error: /401|403/.test(msg) ? "tmdb_key_rejected" : "tmdb_unreachable" };
        });
    return cache.loading;
}

function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/** Starts building the pool in the background (called at server start so the first visitor never waits). */
function warm() {
    if (enabled() && process.env.TMDB_API_KEY && !cache.loading && Date.now() - cache.at > TTL_MS) refresh();
}

/**
 * Up to `n` random recent posters, interleaving movie / series / anime so every type shows up.
 * Returns { posters, reason } — `reason` is a short code when the list is empty (disabled | no_api_key |
 * tmdb_key_rejected | tmdb_unreachable | empty_pool) so the browser (and you) can tell why.
 */
async function getShowcase(n = 30) {
    if (!enabled()) return { posters: [], reason: "disabled" };
    if (!process.env.TMDB_API_KEY) {
        if (!warnedKey) {
            warnedKey = true;
            console.warn("[Showcase] TMDB_API_KEY is not set on the server — the browser will try TMDB directly, else abstract tiles.");
        }
        return { posters: [], reason: "no_api_key" };
    }
    const stale = Date.now() - cache.at > TTL_MS;
    if (stale) {
        const p = refresh();
        if (!cache.items.length) await p; // first ever request waits (≤ ~8 s); later refreshes run in the background
    }
    const limit = Math.max(1, Math.min(Number(n) || 30, 48));
    const buckets = TYPES.map((t) => shuffle(cache.items.filter((i) => i.type === t))).filter((b) => b.length);
    const out = [];
    while (out.length < limit && buckets.some((b) => b.length)) {
        for (const b of buckets) if (b.length && out.length < limit) out.push(b.pop());
    }
    const posters = shuffle(out);
    return { posters, reason: posters.length ? null : cache.error || "empty_pool" };
}

function _resetForTests() {
    cache = { at: 0, items: [], loading: null, error: null };
    warnedKey = false;
}

module.exports = { getShowcase, warm, isRestricted, _resetForTests };
