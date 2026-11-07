// web/src/Components/Auth/tmdbShowcase.js
// Browser-side fallback for the sign-in poster wall: recent movies / series / anime straight from TMDB, using the
// same VITE_TMDB_API_KEY the app's Banner already uses. Only used when the server's /auth/showcase has nothing
// (e.g. the server cannot reach TMDB). Pure functions — no import.meta, no React — so they are unit-testable.
//
// RESTRICTED CONTENT is never used (same rules as the server): include_adult=false on every query, TMDB's `adult`
// flag, restricted words in titles (whole words) and explicit words in overviews.

const TMDB_BASE = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p/w500";
export const RESTRICTED_WORDS = ["adult", "18+", "xxx", "nsfw", "porn"];
export const TYPES = ["movie", "series", "anime"];

const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** true when the TMDB record must NOT be shown. */
export function isRestricted(r, words = RESTRICTED_WORDS) {
    if (r.adult === true) return true;
    const title = `${r.title || ""} ${r.name || ""} ${r.original_title || ""} ${r.original_name || ""}`.toLowerCase();
    const overview = String(r.overview || "").toLowerCase();
    return words.some((w) => {
        const re = new RegExp(`(^|[^a-z0-9])${esc(w)}($|[^a-z0-9])`, "i");
        if (re.test(title)) return true;
        return w !== "adult" && re.test(overview); // "adult life" in prose is innocent
    });
}

const ymd = (d) => d.toISOString().slice(0, 10);

/** One pool of recent posters: [{ poster, type }] (restricted content already removed). */
export async function fetchRecentPosters({ key, fetchImpl = fetch, now = new Date(), language = "en-US", timeoutMs = 8000 }) {
    if (!key) return [];
    const today = ymd(now);
    const since = ymd(new Date(now.getTime() - 400 * 864e5));
    const sinceAnime = ymd(new Date(now.getTime() - 800 * 864e5));
    const jobs = [
        ["movie", "/movie/now_playing", { page: 1 }],
        ["movie", "/discover/movie", { sort_by: "popularity.desc", "primary_release_date.gte": since, "primary_release_date.lte": today, "vote_count.gte": 30 }],
        ["series", "/tv/on_the_air", { page: 1 }],
        ["series", "/discover/tv", { sort_by: "popularity.desc", "first_air_date.gte": since, "first_air_date.lte": today, "vote_count.gte": 10 }],
        ["anime", "/discover/tv", { with_genres: 16, with_original_language: "ja", sort_by: "popularity.desc", "first_air_date.gte": sinceAnime, "first_air_date.lte": today }],
        ["anime", "/discover/movie", { with_genres: 16, with_original_language: "ja", sort_by: "popularity.desc", "primary_release_date.gte": sinceAnime, "primary_release_date.lte": today }],
    ];
    const call = async (endpoint, params) => {
        const q = new URLSearchParams({ api_key: key, language, include_adult: "false", ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            const res = await fetchImpl(`${TMDB_BASE}${endpoint}?${q}`, { signal: ctrl.signal });
            if (!res.ok) throw new Error(`TMDB ${res.status}`);
            return await res.json();
        } finally {
            clearTimeout(timer);
        }
    };
    const settled = await Promise.allSettled(jobs.map(([, ep, params]) => call(ep, params)));
    const seen = new Set();
    const out = [];
    settled.forEach((res, i) => {
        if (res.status !== "fulfilled") return;
        for (const r of res.value?.results || []) {
            if (!r?.poster_path || isRestricted(r)) continue;
            const id = `${jobs[i][0]}:${r.id}`;
            if (seen.has(id)) continue;
            seen.add(id);
            out.push({ poster: `${IMG_BASE}${r.poster_path}`, type: jobs[i][0] });
        }
    });
    return out;
}

function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/** `n` random posters, interleaving movie / series / anime. */
export function samplePosters(pool, n = 32) {
    const buckets = TYPES.map((t) => shuffle(pool.filter((p) => p.type === t))).filter((b) => b.length);
    const out = [];
    while (out.length < n && buckets.some((b) => b.length)) for (const b of buckets) if (b.length && out.length < n) out.push(b.pop());
    return shuffle(out);
}
