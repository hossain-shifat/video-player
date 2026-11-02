// ============================================================================
// Banner.jsx — every banner in the app, as self-contained sections.
// File: web/src/Components/Banner.jsx   (list of ids: web/src/Components/BANNERS.md)
//
// HOW TO USE: drop a banner anywhere, NO props, NO data drilling:
//     <DiscoverMainBanner />
//     <DiscoverSpotlightBanner />
//     <DiscoverHorizonBanner />
//     <RecommendationsHeroBanner />
//     <RecommendationsTonightsPicksBanner />
//     <HomeHeroBanner />
//   or by id (default export):  <Banner id={BANNER_IDS.DISCOVER_MAIN} />
// Each section reads its own data (useApi / TMDB / localStorage) internally.
// Each root element carries its id as the DOM `id` → inspect element / CSS /
// document.getElementById(BANNER_IDS.X) to identify it. Placement list: web/src/Components/BANNERS.md
//
// ── BANNER 1 ── id: banner-discover-main (BANNER_IDS.DISCOVER_MAIN)
//   Name      : Discover "Main" hero banner
//   Component : <DiscoverMainBanner />
//   Page      : web/src/Pages/Discover/DiscoverPage.jsx — right AFTER the "Top Rated in Your Library" row,
//               BEFORE the "Trending Trailers" row. Renders null if the library has
//               no released titles.
//   Look      : full-width hero carousel, dots, release countdown + "Remind me" on upcoming slides
//   Data      : 15 slides, max 11 upcoming (TMDB /discover) + library picks, Marvel/MCU first
//   Storage   : localStorage "flux.discoverBanner.v8" (resets every 3 days), certs "flux.certs.v1"
//
// ── BANNER 2 ── id: banner-discover-spotlight (BANNER_IDS.DISCOVER_SPOTLIGHT)
//   Name      : Discover "In the Spotlight" banner
//   Component : <DiscoverSpotlightBanner />
//   Page      : web/src/Pages/Discover/DiscoverPage.jsx — right AFTER the "Powerful Dramas" (Drama) genre row.
//               No Drama row → after the 2nd genre row (or the only genre row).
//               No genre rows at all → after "Critically Acclaimed". (Placement
//               logic = `spotAfter` in DiscoverPage; the page decides WHERE, this decides WHAT.)
//   Look      : header + All/Movies/Series tabs, poster card, rating ring, credits, thumbnail rail
//   Data      : library only, 15 slides, never repeats the main banner's titles
//   Storage   : localStorage "flux.discoverSpotlight.v7"
//   Loading   : lazy — mounts when scrolled near (LazyMount, skeleton placeholder)
//
// ── BANNER 3 ── id: banner-discover-horizon (BANNER_IDS.DISCOVER_HORIZON)
//   Name      : Discover "On the Horizon" banner
//   Component : <DiscoverHorizonBanner />
//   Page      : web/src/Pages/Discover/DiscoverPage.jsx — right AFTER the "Coming Soon" row, BEFORE "Browse by Genre".
//   Look      : tall backdrop (mobile: compact 240px rectangle, countdown hidden, date+rating on one line; sm+: min 480px), "On the Horizon" pill, release-date timeline rail, trailer/Details/Remind me
//   Data      : up to 10 upcoming TMDB movies (not in library), sorted by release date
//   Storage   : none (TMDB responses cached in memory)
//   Loading   : lazy — LazyMount, rootMargin 300px
//
// ── BANNER 4 ── id: banner-recommendations-hero (BANNER_IDS.RECO_HERO)
//   Name      : Recommendations "Latest releases" hero banner
//   Component : <RecommendationsHeroBanner />
//   Page      : web/src/Pages/Recommendations/RecommendationsPage.jsx — very TOP of the page (below the
//               "Not enough activity yet" notice), above the "For You" section.
//   Look      : full-width hero carousel with dots (no variant, no countdown)
//   Data      : latest popular movies/series/anime from the library, 15 slides
//   Storage   : localStorage "flux.heroBanner.v5" + hidden list "flux.heroBanner.hidden.v1"
//
// ── BANNER 5 ── id: banner-recommendations-tonights-picks (BANNER_IDS.RECO_TONIGHTS_PICKS)
//   Name      : Recommendations "Tonight's Picks" banner
//   Component : <RecommendationsTonightsPicksBanner />
//   Page      : web/src/Pages/Recommendations/RecommendationsPage.jsx — between the "Popular" section and "Top Genres".
//               Renders null with fewer than 3 candidates.
//   Look      : tall cinematic carousel, numbered poster rail, Play + More Info
//   Data      : top-rated + popular titles from the library, 15 shown
//   Storage   : none
//
// ── BANNER 6 ── id: banner-home-hero (BANNER_IDS.HOME_HERO)
//   Name      : Home hero banner ("Latest → Popular → Top Rated")
//   Component : <HomeHeroBanner />
//   Page      : Home page (web/src/Pages/Home/Home.jsx) — TOP of the page, above the first row.
//   Look      : same design as banner 4 (RecoHeroSlide / RecoHeroCarousel) — dots, swipe, autoplay.
//               Arrow-key nav is switched OFF here (arrowKeys={false}); there are no arrow buttons.
//               Logic is its own (useHomeHeroBanner / generateHomeBanner), NOT banner 4's.
//   Data      : library only, 15 slides, filled by PRIORITY (no equal split):
//               1) recently RELEASED (movie: releaseDate · series: newest aired episode; within the last
//                  365 days, never future; NOT when it was added to the library) — ALL of
//                  them, newest first, up to 15. Released-but-not-in-library never shows.
//               2) then popular (rating ≥ 6.5 and ≥ 300 votes, by rating × log10(votes))
//               3) then top rated (highest rating first)
//               Mature (R / TV-MA …) and art-less titles are skipped.
//   Badge     : "Latest Released" (tier 1, shown first) · "Popular" · "Top Rated"
//   Storage   : localStorage "flux.homeBanner.v2" (resets every 3 days, rebuilt when the top set changes)
//
// REMIND ME / TRAILER: only banners 1 and 3 (Discover main + On the Horizon) have a "Remind me" button, and banner 3 has
// "Watch trailer". Both open their dialog RIGHT HERE on the same page (<RemindMe> / <TrailerModal> from Modal.jsx),
// no redirect. Banner 3 pauses its autoplay while a dialog is open.
//
// SHARED: the TMDB/library data layer (buildLibrary, STUDIOS, TMDB_SECTIONS, fetchPage …)
// lives here and is exported so DiscoverPage rows use the SAME cache as the banners.
// Naming: Recommendations-only internals carry a `Reco` prefix (RecoHeroSlide,
// useRecoHeroBanner …) because the Discover ones already own the plain names.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useApi } from "../Context/apiContext";
import { useRecommendations } from "../Hooks/useRecommendations";
import { useCountdown } from "./MediaCard";
import { RemindMe, TrailerModal } from "./Modal";

// ═════════════════════════════════════════════════════════════════════════════
// BANNER IDS — the DOM `id` of each banner's root element (also see BANNERS.md)
// ═════════════════════════════════════════════════════════════════════════════
export const BANNER_IDS = {
    DISCOVER_MAIN: "banner-discover-main",
    DISCOVER_SPOTLIGHT: "banner-discover-spotlight",
    DISCOVER_HORIZON: "banner-discover-horizon",
    RECO_HERO: "banner-recommendations-hero",
    RECO_TONIGHTS_PICKS: "banner-recommendations-tonights-picks",
    HOME_HERO: "banner-home-hero",
};

// ═════════════════════════════════════════════════════════════════════════════
// SHARED DATA LAYER (moved here unchanged from DiscoverPage.jsx)
// Used by the banners AND re-exported for DiscoverPage's rows, so the TMDB page
// cache (`pageCache`) stays ONE cache — banners and rows never double-fetch.
// ═════════════════════════════════════════════════════════════════════════════
export const TMDB_KEY = import.meta.env.VITE_TMDB_API_KEY;
const TMDB_BASE = "https://api.themoviedb.org/3";
export const IMG_BASE = "https://image.tmdb.org/t/p";

const UNRELEASED_STATUS = new Set(["Rumored", "Planned", "In Production", "Post Production"]);
const NO_SCROLLBAR = { scrollbarWidth: "none", msOverflowStyle: "none", WebkitOverflowScrolling: "touch" };

// ═════════════════════════════════════════════════════════════════════════════
// DATA — library
// ═════════════════════════════════════════════════════════════════════════════
const GENRE_ROW_TITLES = {
    Horror: "Fearmongers",
    Comedy: "Laugh Riot",
    "Science Fiction": "Out of This World",
    "Sci-Fi": "Out of This World",
    Crime: "Crime Scene",
    Action: "Adrenaline Rush",
    Drama: "Powerful Dramas",
    Romance: "Hopeless Romantics",
    Thriller: "Edge of Your Seat",
    Fantasy: "Fantasy Realms",
    Adventure: "Grand Adventures",
    Mystery: "Whodunits",
    Documentary: "True Stories",
    War: "Wartime Stories",
    History: "Told Through Time",
};
const GENRE_ROW_SKIP = new Set(["Family", "Animation", "Anime"]); // covered by "New for the Family"

const todayISO = () => new Date().toISOString().slice(0, 10);
const parseDay = (iso) => new Date(`${iso}T00:00:00Z`);
const addDays = (iso, n) => {
    const d = parseDay(iso);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
};
const keyOf = (item) => item.id ?? item.seriesKey ?? item.title;
const isMovieItem = (item) => item.parsed?.type === "movie" || item.type === "movie";
const titleOf = (item) => item.metadata?.title || item.parsed?.title || item.title || item.name || "Untitled";
const hasGenre = (item, names) => (item.metadata?.genres || []).some((g) => names.includes(g));
const releaseOf = (item) => (item.metadata?.releaseDate || item.metadata?.firstAirDate || "").slice(0, 10) || null;

function isUnreleased(item, today) {
    const m = item.metadata;
    if (!m) return false;
    const date = releaseOf(item);
    if (date && date > today) return true;
    return UNRELEASED_STATUS.has(m.status) && !(date && date <= today);
}

let _dn;
export function langName(code) {
    try {
        _dn ||= new Intl.DisplayNames(["en"], { type: "language" });
        return _dn.of(code) || code.toUpperCase();
    } catch {
        return String(code).toUpperCase();
    }
}

// Everything UNSLICED — rows slice, See all shows it all.
export function buildLibrary({ movies = [], series = [], anime = [], categories = [] }) {
    const today = todayISO();
    const all = [...movies, ...series, ...anime];
    const released = all.filter((item) => !isUnreleased(item, today));

    const byRating = released.filter((m) => m.metadata?.rating).sort((a, b) => b.metadata.rating - a.metadata.rating);
    // newest metadata fetch ≈ most recently added
    const byNewest = released.filter((m) => m.metadata?._cachedAt).sort((a, b) => new Date(b.metadata._cachedAt) - new Date(a.metadata._cachedAt));

    // release anniversary within ±3 days of today
    const now = new Date();
    const year = now.getFullYear();
    const inHistory = [];
    for (const item of byRating) {
        const date = releaseOf(item);
        if (!date) continue;
        const d = parseDay(date);
        if (Number.isNaN(d.getTime()) || d.getUTCFullYear() >= year) continue;
        const anniversary = new Date(year, d.getUTCMonth(), d.getUTCDate());
        if (Math.abs(anniversary - now) / 86400000 <= 3) inHistory.push(item);
    }

    const sections = {
        "top-rated": { title: "Top Rated in Your Library", items: byRating },
        "best-series": { title: "Best Series in Your Library", items: byRating.filter((m) => !isMovieItem(m)) },
        "recently-added": { title: "Recently Added", items: byNewest },
        acclaimed: { title: "Critically Acclaimed", items: byRating.filter((m) => m.metadata.rating >= 8 && (m.metadata.votes ?? 0) >= 500) },
        family: { title: "New for the Family", items: byNewest.filter((m) => hasGenre(m, ["Family", "Animation"])) },
        "this-week-in-history": { title: "Released This Week in History", items: inHistory },
    };

    // two biggest genres → themed rows (See all goes to the /category page)
    const genreRows = [];
    for (const cat of categories || []) {
        if (genreRows.length >= 2) break;
        if (GENRE_ROW_SKIP.has(cat.name)) continue;
        const items = byRating.filter((m) => hasGenre(m, [cat.name]));
        if (items.length < 4) continue;
        genreRows.push({ name: cat.name, title: GENRE_ROW_TITLES[cat.name] || cat.name, items });
    }

    const languageMap = new Map();
    const decadeMap = new Map();
    for (const item of byRating) {
        const code = item.metadata?.language;
        if (code) {
            if (!languageMap.has(code)) languageMap.set(code, []);
            languageMap.get(code).push(item);
        }
        const y = item.metadata?.year;
        if (y) {
            const d = Math.floor(y / 10) * 10;
            if (!decadeMap.has(d)) decadeMap.set(d, []);
            decadeMap.get(d).push(item);
        }
    }
    const languages = [...languageMap.keys()].sort((a, b) => languageMap.get(b).length - languageMap.get(a).length);
    const decades = [...decadeMap.keys()].sort((a, b) => b - a);

    return { today, all, released, sections, genreRows, languageMap, languages, decadeMap, decades };
}

// "movie:<tmdbId>" / "tv:<tmdbId>" → { id, raw } for everything the user owns (same as PersonPage)
export function buildLibraryIndex(movies = [], series = [], anime = []) {
    const map = new Map();
    for (const m of movies) {
        const t = m.metadata?.tmdbId;
        if (t) map.set(`movie:${t}`, { id: m.id, raw: m });
    }
    for (const s of series) {
        const t = s.metadata?.tmdbId;
        if (t) map.set(`tv:${t}`, { id: s.seriesKey || s.id, raw: s });
    }
    for (const a of anime) {
        const t = a.metadata?.tmdbId;
        if (!t) continue;
        const entry = { id: a.seriesKey || a.id, raw: a };
        const type = String(a.metadata?.type || a.parsed?.type || a.type || "").toLowerCase();
        const keys = type === "movie" ? [`movie:${t}`] : type === "tv" || type === "series" ? [`tv:${t}`] : [`tv:${t}`, `movie:${t}`];
        for (const key of keys) if (!map.has(key)) map.set(key, entry);
    }
    return map;
}

// ═════════════════════════════════════════════════════════════════════════════
// DATA — TMDB upcoming (studio + popularity)
// ═════════════════════════════════════════════════════════════════════════════
// Studios = TMDB company ids — edit freely.
export const STUDIOS = [
    { slug: "marvel", name: "Marvel Studios", company: 420 },
    { slug: "disney", name: "Walt Disney Pictures", company: 2 },
    { slug: "warner", name: "Warner Bros.", company: 174 },
    { slug: "universal", name: "Universal Pictures", company: 33 },
    { slug: "sony", name: "Columbia Pictures", company: 5 },
    { slug: "a24", name: "A24", company: 41077 },
];
// Marvel · Disney · Pixar · Lucasfilm · Warner · Universal · Columbia · Paramount · Legendary
const MAJORS = "420|2|3|1|174|33|5|4|923";

// from/to = days from today; sorted by popularity
export const TMDB_SECTIONS = {
    "coming-soon": { title: "Coming Soon", kind: "movie", from: 0, to: 60 },
    "upcoming-blockbusters": { title: "Upcoming Blockbusters", kind: "movie", from: 0, companies: MAJORS },
    "highly-anticipated": { title: "Highly Anticipated Movies", kind: "movie", from: 0 },
    "upcoming-shows": { title: "Upcoming Shows", kind: "tv", from: 0 },
    ...Object.fromEntries(STUDIOS.map((s) => [`studio-${s.slug}`, { title: `Upcoming from ${s.name}`, kind: "movie", from: 0, companies: String(s.company) }])),
};

const pageCache = new Map();
export function fetchPage(id, page) {
    const today = todayISO();
    const key = `${id}:${page}:${today}`;
    if (pageCache.has(key)) return pageCache.get(key);

    const def = TMDB_SECTIONS[id];
    const dateKey = def.kind === "tv" ? "first_air_date" : "primary_release_date";
    const p = new URLSearchParams({ api_key: TMDB_KEY, language: "en-US", include_adult: "false", sort_by: "popularity.desc", page: String(page) });
    p.set(`${dateKey}.gte`, addDays(today, def.from ?? 0));
    if (def.to) p.set(`${dateKey}.lte`, addDays(today, def.to));
    if (def.companies) p.set("with_companies", def.companies);

    const req = fetch(`${TMDB_BASE}/discover/${def.kind}?${p}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d) => ({ results: d.results || [], total_pages: d.total_pages || 0 }))
        .catch(() => {
            pageCache.delete(key); // retry next time
            return { results: [], total_pages: 0 };
        });
    pageCache.set(key, req);
    return req;
}

// Several TMDB sections in one hook (page 1 each, shared cache with the rows).
function useTmdbMany(ids) {
    const active = Boolean(TMDB_KEY);
    const key = ids.join(",");
    const [state, setState] = useState({ data: {}, loading: active });
    useEffect(() => {
        if (!active) {
            setState({ data: {}, loading: false });
            return;
        }
        let alive = true;
        setState((s) => ({ ...s, loading: true }));
        Promise.all(ids.map((id) => fetchPage(id, 1))).then((list) => {
            if (!alive) return;
            const data = {};
            ids.forEach((id, i) => (data[id] = list[i].results));
            setState({ data, loading: false });
        });
        return () => {
            alive = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, active]);
    return state;
}

// ═════════════════════════════════════════════════════════════════════════════
// DISCOVER BANNERS — engine + UI (moved unchanged from DiscoverPage.jsx)
// ═════════════════════════════════════════════════════════════════════════════
const DISCOVER_BANNER_KEY = "flux.discoverBanner.v8";
const DISCOVER_BANNER_SLIDES = 15; // main banner: lots of upcoming + a few library picks
const DISCOVER_MAX_UPCOMING = 11; // …of which at most this many are upcoming
const SPOTLIGHT_BANNER_KEY = "flux.discoverSpotlight.v7";
const SPOTLIGHT_BANNER_SLIDES = 15;
const DISCOVER_MIN_SLIDES = 10; // every banner on this page shows at least this many (when the data allows)
// ── Discover banner picking ─────────────────────────────────────────────────
// TWO different banners live on this page, each with its own data + look:
//
//  1) MAIN banner (top, after "Top Rated") — 15 slides, upcoming-heavy, with live
//     release countdowns and a "Remind me" calendar button. Up to 11 upcoming
//     slides. MARVEL / MCU ALWAYS COMES FIRST: upcoming Marvel Studios titles
//     (soonest first), then Marvel/MCU titles from your library, then the rest
//     alternate: Coming Soon ×3, Upcoming Blockbuster ×2, Upcoming Show ×2,
//     Highly Anticipated, one other studio, and library lanes (Critically
//     Acclaimed, Recently Added, This Week in History, Top in <genre>, New for the
//     Family, Best Series, Top Rated).
//
//  2) SPOTLIGHT banner (after "Powerful Dramas") — 15 slides, library only,
//     poster-card look with credits, a rating ring, All/Movies/Series tabs and a
//     thumbnail rail. Marvel / MCU first, then Best in
//     <genre>, Best of the <decade>s, <Language> Pick, Hidden Gem, Series
//     Spotlight, Movie Night. Never repeats titles the main banner shows.
//
// Both: each lane gives random titles (titles from the previous set go to the back
// of the queue), gaps are filled by cycling lanes, then by top-rated titles.
// Mature-rated titles and anything without art are skipped.
const bannerArt = (i) => i.metadata?.backdrop || i.metadata?.poster;
const releaseTime = (d) => (d ? new Date(`${d}T00:00:00`).getTime() : NaN);
const fmtDate = (d) => {
    const t = releaseTime(d);
    return Number.isFinite(t) ? new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
};
const MARVEL_TITLES =
    /\b(avengers|iron man|captain america|black panther|guardians of the galaxy|ant-man|doctor strange|shang-chi|the marvels|black widow|wandavision|hawkeye|moon knight|ms\. marvel|she-hulk|winter soldier|fantastic four|spider-man|deadpool|thor)\b/i;
function isMarvel(item) {
    const m = item.metadata || {};
    const names = (v) => (Array.isArray(v) ? v : []).map((x) => (typeof x === "string" ? x : x?.name || "")).join(" ");
    const hay = [names(m.productionCompanies), names(m.companies), names(m.studios), names(m.keywords), m.collection?.name || "", typeof m.studio === "string" ? m.studio : ""].join(" ");
    if (/marvel|\bmcu\b/i.test(hay)) return true;
    return MARVEL_TITLES.test(m.title || item.title || item.name || "");
}
const byRatingDesc = (a, b) => (b.metadata?.rating || 0) - (a.metadata?.rating || 0);

const CAPPED_LANGS = new Set(["ko"]);
const langOf = (i) => String(i._lang || i.metadata?.language || "").toLowerCase();

const UPCOMING_IDS = ["coming-soon", "upcoming-blockbusters", "highly-anticipated", "upcoming-shows", ...STUDIOS.map((s) => `studio-${s.slug}`)];

function randomOrder(list) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
// random order, but titles NOT in the previous set come first (sort is stable)
const unseenFirst = (list, prevIds) => randomOrder(list).sort((x, y) => Number(prevIds.has(keyOf(x))) - Number(prevIds.has(keyOf(y))));

function upcomingSnapshot(r, kind) {
    const date = r.release_date || r.first_air_date || "";
    const title = r.title || r.name || "Untitled";
    const id = `tmdb-${kind}-${r.id}`;
    return {
        id,
        ...(kind === "tv" ? { seriesKey: id } : {}),
        title,
        type: kind === "tv" ? "series" : "movie",
        _release: date,
        _lang: r.original_language || "",
        metadata: {
            title,
            year: date ? parseInt(date.slice(0, 4), 10) : null,
            rating: r.vote_average ? Math.round(r.vote_average * 10) / 10 : null,
            overview: r.overview || "",
            backdrop: `${IMG_BASE}/w1280${r.backdrop_path}`,
            poster: r.poster_path ? `${IMG_BASE}/w500${r.poster_path}` : null,
        },
    };
}

// Generic lane picker: pass 1 = each lane's quota, then keep cycling the lanes (1 each)
// until `total` is reached or nothing is left, then top up from `fallback`.
function pickFromLanes(lanes, { total, maxUpcoming = Infinity, prevIds, exclude = new Set(), fallback = [], fallbackReason = "Top Rated", capMax = Infinity }) {
    const picked = [];
    const used = new Set(exclude);
    let upCount = 0;
    let capped = 0;
    const take = (lane, n) => {
        let added = 0;
        for (const item of unseenFirst(lane.items, prevIds)) {
            if (n <= 0 || picked.length >= total) break;
            if (lane.kind === "up" && upCount >= maxUpcoming) break;
            const k = keyOf(item);
            if (used.has(k)) continue;
            const isCapped = CAPPED_LANGS.has(langOf(item));
            if (isCapped && capped >= capMax) continue;
            used.add(k);
            if (isCapped) capped++;
            if (lane.kind === "up") upCount++;
            picked.push({ lane, item });
            n--;
            added++;
        }
        return added;
    };
    for (const lane of lanes) take(lane, lane.quota);
    let progress = true;
    while (picked.length < total && progress) {
        progress = false;
        for (const lane of lanes) if (take(lane, 1)) progress = true;
    }
    if (picked.length < total && fallback.length) take({ kind: "lib", reason: fallbackReason, items: fallback }, total - picked.length);
    return picked;
}

const toSlide = ({ lane, item }) => (lane.kind === "up" ? { kind: "up", reason: lane.reason, data: item } : { kind: "lib", id: keyOf(item), reason: lane.reason });

// ── 1) main banner ──
function pickDiscoverBanner({ built, libIndex, upcoming, prevIds }) {
    const { today, sections } = built;

    const upLane = (reason, id, quota, priority = false, studio = null) => {
        const kind = TMDB_SECTIONS[id].kind;
        return {
            kind: "up",
            reason,
            quota,
            priority,
            studio,
            items: (upcoming[id] || [])
                .filter((r) => r.backdrop_path && !r.adult && (r.release_date || r.first_air_date || "") > today && !libIndex.has(`${kind}:${r.id}`))
                .slice(0, 12)
                .map((r) => upcomingSnapshot(r, kind)),
        };
    };
    const libLane = (reason, items, quota = 1, priority = false, studio = null) => ({
        kind: "lib",
        reason,
        quota,
        priority,
        studio,
        items: (items || []).filter((i) => bannerArt(i) && !isMature(i)).slice(0, 15),
    });

    const art = (items) => (items || []).filter((i) => bannerArt(i) && !isMature(i));
    const marvel = STUDIOS.find((x) => x.slug === "marvel");
    const otherStudios = STUDIOS.filter((x) => x.slug !== "marvel");

    const lanes = [
        // Marvel gets first pick of the upcoming slots (and the front of the banner, see below)
        ...(marvel ? [upLane("Upcoming", `studio-${marvel.slug}`, 4, true, marvel.slug)] : []),
        libLane("", built.released.filter(isMarvel).sort(byRatingDesc), 3, true, "marvel"),
        upLane("Coming Soon", "coming-soon", 3),
        upLane("Upcoming Blockbuster", "upcoming-blockbusters", 2),
        upLane("Upcoming Show", "upcoming-shows", 2),
        upLane("Highly Anticipated", "highly-anticipated", 1),
        ...randomOrder(otherStudios).map((x) => upLane("Upcoming", `studio-${x.slug}`, 1, false, x.slug)),
        ...randomOrder([
            libLane("Critically Acclaimed", sections.acclaimed.items),
            libLane("Recently Added", sections["recently-added"].items),
            libLane("This Week in History", sections["this-week-in-history"].items),
            ...built.genreRows.map((g) => libLane(`Top in ${g.name}`, g.items)),
            libLane("New for the Family", sections.family.items),
            libLane("Best Series", sections["best-series"].items),
            libLane("Top Rated", sections["top-rated"].items),
        ]),
    ];

    const picked = pickFromLanes(lanes, {
        total: DISCOVER_BANNER_SLIDES,
        maxUpcoming: DISCOVER_MAX_UPCOMING,
        prevIds,
        capMax: 2,
        fallback: art(sections["top-rated"].items).slice(0, 40),
    });

    // upcoming soonest-first, library random; interleave, upcoming first
    const bySoonest = (a, b) => a.item._release.localeCompare(b.item._release);
    const isPrio = (p) => p.lane.priority || isMarvel(p.item); // Marvel/MCU from ANY lane goes first
    const prioUp = picked.filter((p) => isPrio(p) && p.lane.kind === "up").sort(bySoonest);
    const prioLib = picked.filter((p) => isPrio(p) && p.lane.kind === "lib").sort((a, b) => byRatingDesc(a.item, b.item));
    const ups = picked.filter((p) => p.lane.kind === "up" && !isPrio(p)).sort(bySoonest);
    const libs = randomOrder(picked.filter((p) => p.lane.kind === "lib" && !isPrio(p)));
    const out = [...prioUp, ...prioLib];
    for (let i = 0; i < Math.max(ups.length, libs.length); i++) {
        if (ups[i]) out.push(ups[i]);
        if (libs[i]) out.push(libs[i]);
    }
    return { slides: out.map(toSlide), items: out.map((p) => p.item) };
}

// ── 2) spotlight banner (library only, different lanes) ──
function pickSpotlightBanner({ built, prevIds, excludeIds }) {
    const lane = (reason, items, quota = 1, priority = false, studio = null) => ({
        kind: "lib",
        reason,
        quota,
        priority,
        studio,
        items: (items || []).filter((i) => bannerArt(i) && !isMature(i) && !excludeIds.has(keyOf(i))).slice(0, 15),
    });
    const { sections, decadeMap, decades, languageMap, languages, genreRows, released } = built;

    const gems = released.filter((m) => (m.metadata?.rating ?? 0) >= 7 && (m.metadata?.votes ?? 0) > 0 && (m.metadata?.votes ?? 0) < 2000).sort((a, b) => b.metadata.rating - a.metadata.rating);
    const lanes = [
        lane("", released.filter(isMarvel).sort(byRatingDesc), 3, true, "marvel"),
        ...genreRows.map((g) => lane(`Best in ${g.name}`, g.items, 2)),
        ...randomOrder(decades.filter((d) => (decadeMap.get(d)?.length ?? 0) >= 3))
            .slice(0, 3)
            .map((d) => lane(`Best of the ${d}s`, decadeMap.get(d))),
        ...randomOrder(languages.filter((c) => c !== "en" && !CAPPED_LANGS.has(c)))
            .slice(0, 2)
            .map((c) => lane(`${langName(c)} Pick`, languageMap.get(c))),
        lane("Hidden Gem", gems, 2),
        lane("Series Spotlight", sections["best-series"].items),
        lane("Movie Night", sections["top-rated"].items.filter(isMovieItem)),
    ];
    const fallback = sections["top-rated"].items.filter((i) => bannerArt(i) && !isMature(i)).slice(0, 40);
    const picked = randomOrder(pickFromLanes(lanes, { total: SPOTLIGHT_BANNER_SLIDES, prevIds, exclude: excludeIds, fallback, fallbackReason: "Top Rated", capMax: 1 }));
    const isPrio = (p) => p.lane.priority || isMarvel(p.item);
    const ordered = [...picked.filter(isPrio), ...picked.filter((p) => !isPrio(p))]; // Marvel/MCU first
    return { slides: ordered.map(toSlide), items: ordered.map((p) => p.item) };
}

// ═════════════════════════════════════════════════════════════════════════════
// BANNER LIFECYCLE + UI — shared by the Discover main + spotlight banners
// ═════════════════════════════════════════════════════════════════════════════
// Self-managing hero banner: saves the picked set in localStorage with a random
// 3-day lifetime, shows it until it expires, then calls pickDiscoverBanner()
// again (avoiding last set's titles). If media leaves the library the set is
// repaired without resetting the clock. Click a slide → /media/:id ; Play →
// player (movie) or details with the first season selected (series).

const DAY_MS = 24 * 60 * 60 * 1000;
const BANNER_MIN_MS = 3 * DAY_MS; // every stored banner resets every 3 days (min = max = exactly 3 days)
const BANNER_MAX_MS = 3 * DAY_MS;
const HERO_MIN_SLIDES = DISCOVER_MIN_SLIDES; // below this (released upcoming titles, removed media) the set is repaired
const HERO_AUTOPLAY_MS = 3000;
const HERO_SLIDE_MS = 800; // slide AND fade share this one duration
const HERO_EASE = "cubic-bezier(0.4, 0, 0.2, 1)"; // smooth ease-in-out, used by slide + fade
const HERO_ZOOM_MS = 1800; // slow image zoom-out while a slide settles
const HERO_TEXT_DELAY_MS = 300; // text starts a beat after the slide begins to move
const HERO_STAGGER_MS = 90; // gap between consecutive text elements
const HERO_TEXT_MS = 1000; // duration of each text element's entrance
const HERO_TEXT_EASE = "cubic-bezier(0.16, 1, 0.3, 1)"; // expo-out: fast start, long silky settle
const HERO_SPRING = "cubic-bezier(0.34, 1.4, 0.64, 1)"; // tiny overshoot, used by buttons
const HERO_SHIFT = 35; // % a slide drifts while it fades (small drift = no gaps)
// Landscape rectangle on every device; height capped so it never fills the screen.
const HERO_SIZE = "w-full aspect-[16/9] sm:aspect-[2/1] lg:aspect-[2.3/1] max-h-[230px] sm:max-h-[340px] lg:max-h-[400px] 2xl:max-h-[450px]";

// ── Certification lookup (TMDB) ─────────────────────────────────────────────
// Banners must never show R / NC-17 / TV-MA titles. Metadata often has no
// certification, so picked titles are verified against TMDB (US rating) and the
// answer is cached in localStorage — isMature() below consults that cache, so
// once a title is known to be restricted every banner filter drops it instantly.
const CERT_CACHE_KEY = "flux.certs.v1";
let _certs = null;
function certStore() {
    if (!_certs) {
        try {
            _certs = JSON.parse(localStorage.getItem(CERT_CACHE_KEY)) || {};
        } catch {
            _certs = {};
        }
    }
    return _certs;
}
function saveCerts() {
    try {
        localStorage.setItem(CERT_CACHE_KEY, JSON.stringify(certStore()));
    } catch {
        /* ignore quota / private mode */
    }
}

// banner item → { kind: "movie" | "tv", id } for the TMDB lookup (null = can't look up)
function certTarget(item) {
    if (item._release) {
        const m = /^tmdb-(movie|tv)-(\d+)$/.exec(String(item.id));
        return m ? { kind: m[1], id: m[2] } : null;
    }
    const t = item.metadata?.tmdbId;
    return t ? { kind: item.seasons ? "tv" : "movie", id: String(t) } : null;
}

const isBlockedCert = (c) =>
    BLOCKED_CERTS.has(
        String(c || "")
            .trim()
            .toUpperCase(),
    );

async function fetchCert(kind, tmdbId) {
    if (!TMDB_KEY || !tmdbId) return "";
    const key = `${kind}:${tmdbId}`;
    const store = certStore();
    const hit = store[key];
    if (hit && Date.now() - hit.t < (hit.c ? 30 : 3) * 24 * 60 * 60 * 1000) return hit.c;
    try {
        let c = "";
        if (kind === "movie") {
            const j = await (await fetch(`${TMDB_BASE}/movie/${tmdbId}/release_dates?api_key=${TMDB_KEY}`)).json();
            const us = (j.results || []).find((x) => x.iso_3166_1 === "US");
            const certs = (us?.release_dates || []).map((d) => d.certification).filter(Boolean);
            c = certs.find(isBlockedCert) || certs[0] || "";
        } else {
            const j = await (await fetch(`${TMDB_BASE}/tv/${tmdbId}/content_ratings?api_key=${TMDB_KEY}`)).json();
            c = (j.results || []).find((x) => x.iso_3166_1 === "US")?.rating || "";
        }
        store[key] = { c, t: Date.now() };
        saveCerts();
        return c;
    } catch {
        return ""; // network problem → unknown, don't cache
    }
}

// Pick → verify the picked titles → if any turned out restricted (now cached, so the
// next pick skips them) pick again. Up to 4 rounds.
async function pickVerified(pickFn) {
    let result = pickFn();
    for (let round = 0; round < 4; round++) {
        const certs = await Promise.all(
            result.items.map((it) => {
                const t = certTarget(it);
                return t ? fetchCert(t.kind, t.id) : "";
            }),
        );
        if (!certs.some(isBlockedCert)) break;
        result = pickFn();
    }
    return result.slides;
}

// Mature-rating filter. Checks every field a TMDB-derived metadata object
// might carry its certification in; also honours an `adult` flag.
const BLOCKED_CERTS = new Set(["R", "NC-17", "NC17", "X", "XXX", "TV-MA", "18", "18+", "18A", "R18", "R18+", "R-18", "AO"]);

function isMature(item) {
    const m = item.metadata || {};
    if (m.adult === true) return true;
    // metadata.certifications = { US: [{ certification: "R" }], GB: [...] } — US rating decides;
    // no real US rating (empty / NR) → fall back to every country's rating.
    if (m.certifications && typeof m.certifications === "object" && !Array.isArray(m.certifications)) {
        const norm = (x) =>
            String(x?.certification ?? x ?? "")
                .trim()
                .toUpperCase()
                .replace(/^RATED\s+/, "");
        const us = (m.certifications.US || []).map(norm).filter((c) => c && c !== "NR" && c !== "UR" && c !== "NOT RATED");
        const pool = us.length ? us : Object.values(m.certifications).flat().map(norm).filter(Boolean);
        if (pool.some((c) => BLOCKED_CERTS.has(c))) return true;
    }
    const raw = [m.certification, m.contentRating, m.mpaa, m.mpaaRating, m.rated, m.ageRating, m.maturityRating, ...(Array.isArray(m.certifications) ? m.certifications : [])];
    for (const v of raw) {
        if (v == null) continue;
        const c = String(typeof v === "object" ? v.certification || v.rating || "" : v)
            .trim()
            .toUpperCase()
            .replace(/^RATED\s+/, "");
        if (c && BLOCKED_CERTS.has(c)) return true;
    }
    const t = certTarget(item);
    const cached = t ? certStore()[`${t.kind}:${t.id}`] : null;
    return Boolean(cached && isBlockedCert(cached.c));
}

// ============================================================================
// Banner lifecycle (load → show → expire → rebuild)
// ============================================================================
function loadBanner(key) {
    try {
        const raw = JSON.parse(localStorage.getItem(key));
        if (raw && Array.isArray(raw.slides) && typeof raw.expiresAt === "number") return raw;
    } catch {
        /* ignore corrupt / unavailable storage */
    }
    return null;
}

function saveBanner(key, banner) {
    try {
        localStorage.setItem(key, JSON.stringify(banner));
    } catch {
        /* ignore quota / private mode */
    }
}

function useHeroBanner({ pool, ready, pick, storageKey }) {
    const [stored, setStored] = useState(() => loadBanner(storageKey));
    const [now, setNow] = useState(() => Date.now());

    // Re-check expiry while the page stays open.
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 60 * 1000);
        return () => clearInterval(t);
    }, []);

    const poolById = useMemo(() => new Map((pool || []).map((i) => [keyOf(i), i])), [pool]);

    // Saved ids → live items (fresh metadata). Deleted media silently drops out.
    const slides = useMemo(() => {
        if (!stored) return [];
        return stored.slides
            .map((s) => {
                // Upcoming slides carry their own snapshot and vanish once released.
                if (s.kind === "up") {
                    const t = releaseTime(s.data?._release);
                    return t > now ? { ...s.data, _heroReason: s.reason } : null;
                }
                const item = poolById.get(s.id);
                return item ? { ...item, _heroReason: s.reason } : null;
            })
            .filter(Boolean);
    }, [stored, poolById, now]);

    const expired = !stored || now >= stored.expiresAt;
    const broken = !!stored && stored.slides.length >= HERO_MIN_SLIDES && slides.length < HERO_MIN_SLIDES;
    const needsNew = ready && (pool || []).length > 0 && (expired || broken);

    useEffect(() => {
        if (!needsNew) return;
        let alive = true;
        const prevIds = new Set((stored?.slides || []).map((s) => (s.kind === "up" ? s.data?.id : s.id)));
        Promise.resolve(pick({ pool, prevIds })).then((next) => {
            if (!alive || !next?.length) return; // nothing qualifies yet — try again when the library changes
            const createdAt = Date.now();
            // Expired → brand-new 3-day cycle. Broken (media removed) → repair the set, keep the clock.
            const expiresAt = stored && !expired ? stored.expiresAt : createdAt + BANNER_MIN_MS + Math.random() * (BANNER_MAX_MS - BANNER_MIN_MS);
            const banner = { createdAt, expiresAt, slides: next };
            saveBanner(storageKey, banner);
            setStored(banner);
        });
        return () => {
            alive = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [needsNew, pool]);

    return slides;
}

// ============================================================================
// UI
// ============================================================================
function HeroSkeleton({ id }) {
    return <div id={id} className={`${HERO_SIZE} rounded-xl sm:rounded-2xl bg-base-300 animate-pulse`} />;
}

// Release countdown — same tile design as the details page (ReleaseCountdown),
// shrunk (narrower + shorter) so it never crowds the title. Solid backgrounds, no
// blur filters (blur over moving slides is expensive).
function CountdownTiles({ d, h, m, s }) {
    const cells = [
        [d, "Days"],
        [h, "Hours"],
        [m, "Minutes"],
        [s, "Seconds"],
    ];
    return (
        <div className="w-full max-w-[11.5rem] sm:max-w-[15rem]" role="timer" aria-label={`Releases in ${d} days ${h} hours ${m} minutes`}>
            <p className="mb-1 hidden text-[9px] font-bold uppercase tracking-[0.18em] text-white/70 sm:block">Releases in</p>
            <div className="grid grid-cols-4 gap-1 sm:gap-1.5">
                {cells.map(([v, label]) => (
                    <div key={label} className="rounded-md border border-primary/40 bg-black/55 py-1 text-center sm:rounded-lg sm:py-1.5">
                        <div className={`text-sm font-bold leading-none tabular-nums sm:text-xl ${label === "Seconds" ? "text-primary" : "text-white"}`}>{String(v).padStart(2, "0")}</div>
                        <div className="mt-0.5 text-[6px] font-semibold uppercase tracking-[0.1em] text-white/50 sm:text-[8px]">{label}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// Ticking version (uses the details page's useCountdown). Mounted ONLY for the slide on screen,
// so one interval runs instead of one per upcoming slide.
function LiveCountdown({ iso }) {
    const t = useCountdown(iso);
    if (!t || t.done) return null;
    return <CountdownTiles d={t.d} h={t.h} m={t.m} s={t.s} />;
}

// Frozen version for slides that are off-screen (only visible during their ~0.3s fade-out).
function StaticCountdown({ iso }) {
    const left = Math.max(0, releaseTime(iso) - Date.now());
    if (!left) return null;
    return <CountdownTiles d={Math.floor(left / 86400000)} h={Math.floor(left / 3600000) % 24} m={Math.floor(left / 60000) % 60} s={Math.floor(left / 1000) % 60} />;
}

function RatingRing({ value, active }) {
    const r = 11;
    const c = 2 * Math.PI * r;
    const pct = Math.max(0, Math.min(10, value)) / 10;
    return (
        <span className="relative inline-flex h-8 w-8 items-center justify-center sm:h-9 sm:w-9" title={`Rated ${value.toFixed(1)} / 10`}>
            <svg viewBox="0 0 28 28" className="absolute inset-0 -rotate-90">
                <circle cx="14" cy="14" r={r} fill="rgba(0,0,0,0.5)" stroke="rgba(255,255,255,0.22)" strokeWidth="2.5" />
                <circle
                    cx="14"
                    cy="14"
                    r={r}
                    fill="none"
                    stroke="currentColor"
                    className="text-primary"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeDasharray={c}
                    strokeDashoffset={active ? c * (1 - pct) : c}
                    style={{ transition: `stroke-dashoffset 1400ms cubic-bezier(0.16, 1, 0.3, 1) ${active ? 700 : 0}ms` }}
                />
            </svg>
            <span className="relative text-[10px] font-bold leading-none text-white sm:text-[11px]">{value.toFixed(1)}</span>
        </span>
    );
}

function HeroSlide({ item, active, variant = "default" }) {
    const meta = item.metadata || {};
    const genres = meta.genres || item.category || [];
    const isMovie = !item.seasons;
    const upcoming = Boolean(item._release);
    const spotlight = variant === "spotlight";
    const navigate = useNavigate();
    const detailsPath = `/media/${encodeURIComponent(keyOf(item))}`;
    // Series: Play opens the details page with a season pre-selected
    // (lowest real season; Season 0 / specials only if nothing else exists).
    const seasonKeys = Object.keys(item.seasons || {}).sort((a, b) => Number(a) - Number(b));
    const firstSeason = seasonKeys.find((k) => Number(k) !== 0) ?? seasonKeys[0];
    const seasonPath = firstSeason != null ? `${detailsPath}?season=${encodeURIComponent(firstSeason)}` : detailsPath;
    const seasonCount = item.seasons ? Object.keys(item.seasons).length : 0;
    const runtime = isMovie && meta.runtime ? (meta.runtime >= 60 ? `${Math.floor(meta.runtime / 60)}h ${meta.runtime % 60}m` : `${meta.runtime}m`) : null;
    // ── Entrance choreography ───────────────────────────────────────────
    // badge  : pill wipes open left→right
    // title  : words rise out of a clipped mask, one by one
    // meta   : items slide in from the left, one by one
    // overview: fades up out of a soft blur
    // buttons: rise with a slight spring
    // Leaving a slide fades text out fast (280ms) and only THEN resets it
    // (0ms, delayed), so nothing visibly rewinds while the slide fades away.
    const delayOf = (n) => HERO_TEXT_DELAY_MS + n * HERO_STAGGER_MS;
    const trans = (props, n, ms = HERO_TEXT_MS, ease = HERO_TEXT_EASE) =>
        active ? props.map((p) => `${p} ${ms}ms ${ease} ${delayOf(n)}ms`).join(", ") : ["opacity 280ms ease-out", ...props.filter((p) => p !== "opacity").map((p) => `${p} 0ms 280ms`)].join(", ");

    const badgeStyle = {
        opacity: active ? 1 : 0,
        clipPath: active ? "inset(0 0 0 0 round 9999px)" : "inset(0 100% 0 0 round 9999px)",
        transition: trans(["opacity", "clip-path"], 0, 900),
    };
    const wordStyle = (i) => ({
        transform: active ? "translate3d(0,0,0)" : "translate3d(0,110%,0)",
        transition: trans(["transform"], 2 + i * 0.6, 1100),
    });
    let metaIndex = 0;
    const metaStyle = () => ({
        opacity: active ? 1 : 0,
        transform: active ? "translate3d(0,0,0)" : "translate3d(-12px,0,0)",
        transition: trans(["opacity", "transform"], 3 + metaIndex++ * 0.35, 800),
    });
    const overviewStyle = {
        opacity: active ? 1 : 0,
        transform: active ? "translate3d(0,0,0)" : "translate3d(0,12px,0)",
        filter: active ? "blur(0px)" : "blur(6px)",
        transition: trans(["opacity", "transform", "filter"], 4.5, 1100),
    };
    const buttonStyle = (n) => ({
        opacity: active ? 1 : 0,
        transform: active ? "translate3d(0,0,0) scale(1)" : "translate3d(0,22px,0) scale(0.92)",
        transition: trans(["opacity", "transform"], n, 1000, HERO_SPRING),
    });
    const countdownStyle = buttonStyle(4.2);
    const creditsStyle = { ...overviewStyle, transition: trans(["opacity", "transform", "filter"], 5.2, 1100) };
    const directors = (meta.crew || [])
        .filter((c) => c?.job === "Director")
        .map((c) => c.name)
        .filter(Boolean)
        .slice(0, 2);
    const stars = (meta.cast || [])
        .map((c) => c?.name)
        .filter(Boolean)
        .slice(0, 3);
    const titleWords = String(meta.title || item.title || item.name || "").split(" ");

    const btn =
        "group bg-primary text-primary-content font-semibold inline-flex items-center text-[11px] sm:text-sm px-3.5 sm:px-5 py-1.5 sm:py-2 rounded-md shadow-md transition-all duration-300 hover:-translate-y-0.5 hover:scale-105 hover:shadow-lg hover:bg-primary/90 active:scale-95";
    const playIcon = <span className="mr-1.5 transition-transform duration-300 group-hover:translate-x-0.5">▶</span>;
    return (
        <div
            role="link"
            tabIndex={-1}
            onClick={() => navigate(detailsPath)}
            onKeyDown={(e) => e.key === "Enter" && navigate(detailsPath)}
            className="relative w-full h-full rounded-xl sm:rounded-2xl overflow-hidden cursor-pointer">
            {(meta.backdrop || meta.poster) && (
                <img
                    src={meta.backdrop || meta.poster}
                    alt=""
                    draggable={false}
                    decoding="async"
                    className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                    style={{ transform: active ? "scale(1)" : "scale(1.1)", transition: `transform ${HERO_ZOOM_MS}ms ${HERO_EASE}`, willChange: "transform" }}
                />
            )}
            {/* Light backdrop: soft dark fade from the bottom only, just enough for text. Raise/lower the /60 and /20 to tune. */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent pointer-events-none" />
            {spotlight && (
                <>
                    <div className="absolute inset-0 bg-gradient-to-r from-black/65 via-black/25 to-transparent pointer-events-none" />
                    {meta.poster && (
                        <div className="pointer-events-none absolute right-6 top-1/2 z-10 hidden aspect-[2/3] h-[72%] -translate-y-1/2 sm:block lg:right-12">
                            <div
                                className="relative h-full w-full"
                                style={{
                                    opacity: active ? 1 : 0,
                                    transform: active ? "translate3d(0,0,0) rotate(2deg)" : "translate3d(48px,0,0) rotate(7deg)",
                                    transition: trans(["opacity", "transform"], 1, 1200),
                                }}>
                                <img src={meta.poster} alt="" draggable={false} decoding="async" className="h-full w-full rounded-xl object-cover shadow-2xl ring-1 ring-white/25" />
                                <div className="absolute inset-0 rounded-xl bg-gradient-to-tr from-white/10 via-transparent to-transparent" />
                                {meta.year && <span className="absolute bottom-2 left-2 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white">{meta.year}</span>}
                            </div>
                        </div>
                    )}
                </>
            )}
            <div
                className={`relative z-10 flex flex-col justify-end h-full px-3.5 pt-3.5 pb-6 sm:p-8 sm:pb-10 lg:p-10 lg:pb-12 gap-1.5 sm:gap-3 [&>*]:shrink-0 ${spotlight ? "sm:pr-[30%]" : ""}`}
                // Soft shadow keeps text legible over any poster.
                style={{ textShadow: "0 1px 3px rgba(0,0,0,0.85), 0 2px 14px rgba(0,0,0,0.55)" }}>
                {item._heroReason && (
                    <span
                        style={badgeStyle}
                        className={`inline-flex items-center w-fit max-w-full truncate px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full ${spotlight ? "bg-black/45 text-white border border-white/40" : "bg-primary/90 text-primary-content"} text-[9px] sm:text-[10px] font-bold uppercase tracking-wider`}>
                        {item._heroReason}
                    </span>
                )}
                <h2 aria-label={titleWords.join(" ")} className="text-base sm:text-3xl lg:text-4xl font-bold text-white max-w-xl leading-tight drop-shadow line-clamp-2">
                    {titleWords.map((w, i) => (
                        <span key={i} aria-hidden="true">
                            <span className="inline-block overflow-hidden align-bottom pb-[0.12em] -mb-[0.12em]">
                                <span className="inline-block" style={wordStyle(i)}>
                                    {w}
                                </span>
                            </span>{" "}
                        </span>
                    ))}
                </h2>
                <div className={`${upcoming ? "hidden sm:flex" : "flex"} items-center flex-wrap gap-x-2.5 gap-y-1 sm:gap-3 text-[11px] sm:text-sm text-white font-medium`}>
                    {upcoming && <span style={metaStyle()}>Releases {fmtDate(item._release)}</span>}
                    {meta.rating != null &&
                        (spotlight ? (
                            <span style={metaStyle()}>
                                <RatingRing value={meta.rating} active={active} />
                            </span>
                        ) : (
                            <span style={metaStyle()}>★ {meta.rating.toFixed(1)}</span>
                        ))}
                    {meta.year && <span style={metaStyle()}>{meta.year}</span>}
                    {runtime && <span style={metaStyle()}>{runtime}</span>}
                    {seasonCount > 0 && (
                        <span style={metaStyle()}>
                            {seasonCount} season{seasonCount > 1 ? "s" : ""}
                        </span>
                    )}
                    {genres.slice(0, 3).map((g) => (
                        <span key={g} style={metaStyle()} className="hidden sm:inline-block px-2 py-0.5 rounded-full bg-white/20 text-xs">
                            {g}
                        </span>
                    ))}
                </div>
                {spotlight && (directors.length > 0 || stars.length > 0) && (
                    <p style={creditsStyle} className="hidden max-w-xl truncate text-xs text-white/85 sm:block">
                        {directors.length > 0 && (
                            <>
                                <span className="text-white/55">Directed by</span> {directors.join(", ")}
                            </>
                        )}
                        {directors.length > 0 && stars.length > 0 && <span className="mx-2 text-white/30">•</span>}
                        {stars.length > 0 && (
                            <>
                                <span className="text-white/55">Starring</span> {stars.join(", ")}
                            </>
                        )}
                    </p>
                )}
                {upcoming && <div style={countdownStyle}>{active ? <LiveCountdown iso={item._release} /> : <StaticCountdown iso={item._release} />}</div>}
                {meta.overview && !upcoming && (
                    <p style={overviewStyle} className="hidden sm:block text-sm text-white/95 max-w-xl line-clamp-2 lg:line-clamp-3">
                        {meta.overview}
                    </p>
                )}
                <div className="flex gap-2 sm:gap-3 mt-0.5 sm:mt-2">
                    {isMovie && item.streamUrl && (
                        <div style={buttonStyle(5.5)}>
                            <Link to={`/player/${encodeURIComponent(keyOf(item))}`} onClick={(e) => e.stopPropagation()} className={btn}>
                                {playIcon}Play
                            </Link>
                        </div>
                    )}
                    {!isMovie && (
                        <div style={buttonStyle(5.5)}>
                            <Link to={seasonPath} state={{ season: firstSeason }} onClick={(e) => e.stopPropagation()} className={btn}>
                                {playIcon}Play
                            </Link>
                        </div>
                    )}
                    <div style={buttonStyle(6.3)}>
                        <Link
                            to={detailsPath}
                            onClick={(e) => e.stopPropagation()}
                            className="group bg-white/20 text-white font-semibold inline-flex items-center text-[11px] sm:text-sm px-3.5 sm:px-5 py-1.5 sm:py-2 rounded-md transition-all duration-300 hover:-translate-y-0.5 hover:scale-105 hover:bg-white/30 active:scale-95">
                            More Info
                            <span className="ml-0 w-0 overflow-hidden opacity-0 transition-all duration-300 group-hover:ml-1.5 group-hover:w-2 group-hover:opacity-100">›</span>
                        </Link>
                    </div>
                    {upcoming && (
                        <div style={buttonStyle(7)}>
                            {/* Opens the Remind me dialog right here (no redirect). */}
                            <RemindMe mediaId={String(item.id)} title={meta.title || item.title} poster={meta.poster || null} releaseDate={item._release} isSeries={item.type === "series"} enabled={active}>
                                {({ reminded, open }) => (
                                    <button
                                        type="button"
                                        onClick={open}
                                        title={reminded ? "Reminder is on. Click to change it" : "Get a notification on release day"}
                                        className="inline-flex cursor-pointer items-center rounded-md bg-black/30 ring-1 ring-inset ring-white/30 px-3 py-1.5 text-[11px] font-semibold text-white transition-all duration-300 hover:-translate-y-0.5 hover:bg-black/50 active:scale-95 sm:px-4 sm:py-2 sm:text-sm">
                                        <span className="mr-1.5">{reminded ? "✓" : "＋"}</span>
                                        {reminded ? "Reminder on" : "Remind me"}
                                    </button>
                                )}
                            </RemindMe>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// One-at-a-time hero carousel: autoplays, pauses on hover/drag, has dots,
// prev/next arrows (desktop hover), arrow-key support, and mouse/touch swipe.
// Always a landscape rectangle (aspect-ratio based, never a fixed height).
function HeroCarousel({ items, variant = "default", id }) {
    const [active, setActive] = useState(0);
    const containerRef = useRef(null);
    const dragState = useRef({ down: false, startX: 0, moved: false });
    const pausedRef = useRef(false);
    const hoverRef = useRef(false);
    const inViewRef = useRef(true);
    const railRef = useRef(null);
    const count = items?.length || 0;
    const itemsKey = (items || []).map(keyOf).join("|");

    // New slide set (refresh / expiry / hide) — start from the first slide.
    // Keyed on ids, not array identity, so unrelated data updates (history
    // etc.) don't yank the carousel back to slide 1.
    useEffect(() => {
        setActive(0);
    }, [itemsKey]);

    const go = useCallback(
        (dir) => {
            if (count > 1) setActive((i) => (i + dir + count) % count);
        },
        [count],
    );

    // Thumbnail rail (spotlight): keep the active thumbnail centred.
    useEffect(() => {
        if (variant !== "spotlight") return;
        const rail = railRef.current;
        const el = rail?.children[active];
        if (rail && el) rail.scrollTo({ left: el.offsetLeft - rail.clientWidth / 2 + el.clientWidth / 2, behavior: "smooth" });
    }, [active, variant]);

    // Remember whether the banner is on screen (autoplay pauses when it isn't).
    useEffect(() => {
        const el = containerRef.current;
        if (!el || typeof IntersectionObserver === "undefined") return;
        const io = new IntersectionObserver(
            ([e]) => {
                inViewRef.current = e.isIntersecting;
            },
            { threshold: 0.15 },
        );
        io.observe(el);
        return () => io.disconnect();
    }, [count]);

    // Autoplay — timer restarts on every slide change (manual or auto), and
    // ticks are skipped while hovering or interacting.
    useEffect(() => {
        if (count <= 1) return;
        const timer = setInterval(() => {
            if (document.hidden || !inViewRef.current) return; // off-screen / background tab → don't animate
            if (!pausedRef.current && !hoverRef.current) setActive((i) => (i + 1) % count);
        }, HERO_AUTOPLAY_MS);
        return () => clearInterval(timer);
    }, [count, active]);

    // Manual grab/swipe — dragging left/right moves one slide; a real drag
    // also suppresses the click that follows it so Play/More Info don't fire
    // mid-swipe.
    useEffect(() => {
        const el = containerRef.current;
        if (!el || count <= 1) return;
        const s = dragState.current;
        let resumeTimer = null;

        const down = (clientX) => {
            s.down = true;
            s.moved = false;
            s.startX = clientX;
            pausedRef.current = true;
            if (resumeTimer) clearTimeout(resumeTimer);
        };
        const move = (clientX) => {
            if (!s.down) return;
            if (Math.abs(clientX - s.startX) > 5) s.moved = true;
        };
        const up = (clientX) => {
            if (s.down) {
                const delta = clientX - s.startX;
                if (Math.abs(delta) > 40) {
                    const dir = delta < 0 ? 1 : -1;
                    setActive((i) => (i + dir + count) % count);
                }
            }
            s.down = false;
            resumeTimer = setTimeout(() => {
                pausedRef.current = false;
            }, 3000);
        };
        const onClickCapture = (e) => {
            if (s.moved) {
                e.preventDefault();
                e.stopPropagation();
            }
        };

        const onMouseDown = (e) => down(e.pageX);
        const onMouseMove = (e) => move(e.pageX);
        const onMouseUp = (e) => up(e.pageX);
        const onTouchStart = (e) => down(e.touches[0].pageX);
        const onTouchMove = (e) => move(e.touches[0].pageX);
        const onTouchEnd = (e) => up(e.changedTouches[0].pageX);

        el.addEventListener("mousedown", onMouseDown);
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
        el.addEventListener("touchstart", onTouchStart, { passive: true });
        el.addEventListener("touchmove", onTouchMove, { passive: true });
        el.addEventListener("touchend", onTouchEnd);
        el.addEventListener("click", onClickCapture, true);

        return () => {
            if (resumeTimer) clearTimeout(resumeTimer);
            el.removeEventListener("mousedown", onMouseDown);
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
            el.removeEventListener("touchstart", onTouchStart);
            el.removeEventListener("touchmove", onTouchMove);
            el.removeEventListener("touchend", onTouchEnd);
            el.removeEventListener("click", onClickCapture, true);
        };
    }, [count]);

    if (!count) return null;

    const safeActive = Math.min(active, count - 1);

    return (
        <div id={id}>
            <div
                ref={containerRef}
                tabIndex={0}
                onMouseEnter={() => (hoverRef.current = true)}
                onMouseLeave={() => (hoverRef.current = false)}
                onKeyDown={(e) => {
                    if (e.key === "ArrowLeft") go(-1);
                    else if (e.key === "ArrowRight") go(1);
                }}
                className={`group relative ${HERO_SIZE} rounded-xl sm:rounded-2xl overflow-hidden cursor-pointer active:cursor-grabbing select-none outline-none focus-visible:ring-2 focus-visible:ring-primary`}>
                {items.map((item, i) => {
                    // Circular offset from the active slide. The active slide is
                    // fully visible; every other slide is transparent and parked
                    // slightly to one side. When the active slide changes, the
                    // outgoing slide drifts away while FADING OUT and the
                    // incoming one drifts in while FADING IN — same duration and
                    // easing for movement and fade, so they finish together.
                    let d = i - safeActive;
                    if (d > count / 2) d -= count;
                    else if (d < -count / 2) d += count;
                    const side = Math.max(-1, Math.min(1, d));
                    return (
                        <div
                            key={keyOf(item)}
                            className="absolute inset-0"
                            style={{
                                transform: `translate3d(${side * HERO_SHIFT}%, 0, 0)`,
                                opacity: d === 0 ? 1 : 0,
                                // Slides more than 1 step away are fully hidden (not painted) once their fade ends.
                                visibility: Math.abs(d) <= 1 ? "visible" : "hidden",
                                transition: `transform ${HERO_SLIDE_MS}ms ${HERO_EASE}, opacity ${HERO_SLIDE_MS}ms ${HERO_EASE}, visibility 0s linear ${Math.abs(d) <= 1 ? 0 : HERO_SLIDE_MS}ms`,
                                willChange: Math.abs(d) <= 1 ? "transform, opacity" : "auto",
                                backfaceVisibility: "hidden",
                                pointerEvents: d === 0 ? "auto" : "none",
                            }}>
                            <HeroSlide item={item} active={d === 0} variant={variant} />
                        </div>
                    );
                })}

                {count > 1 && variant !== "spotlight" && (
                    <div className="absolute z-20 bottom-2 sm:bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 sm:gap-1.5 px-2 py-1 rounded-full">
                        {items.map((_, i) => (
                            <button
                                key={i}
                                onClick={() => setActive(i)}
                                aria-label={`Go to slide ${i + 1}`}
                                className={`h-1 sm:h-1.5 rounded-full cursor-pointer transition-all duration-500 ease-in-out ${i === safeActive ? "w-4 sm:w-6 bg-primary" : "w-1 sm:w-1.5 bg-white/50 hover:bg-white/80"}`}
                            />
                        ))}
                    </div>
                )}
            </div>

            {variant === "spotlight" && count > 1 && (
                <div
                    ref={railRef}
                    className="relative mt-3 flex gap-2.5 overflow-x-auto px-1 py-1.5"
                    style={{
                        ...NO_SCROLLBAR,
                        WebkitMaskImage: "linear-gradient(to right, transparent, #000 20px, #000 calc(100% - 20px), transparent)",
                        maskImage: "linear-gradient(to right, transparent, #000 20px, #000 calc(100% - 20px), transparent)",
                    }}
                    role="tablist"
                    aria-label="Spotlight titles">
                    {items.map((it, i) => (
                        <button
                            key={keyOf(it)}
                            type="button"
                            role="tab"
                            aria-selected={i === safeActive}
                            onClick={() => setActive(i)}
                            title={titleOf(it)}
                            className={`relative h-16 w-11 shrink-0 cursor-pointer overflow-hidden rounded-lg transition-all duration-500 sm:h-20 sm:w-14 ${i === safeActive ? "-translate-y-0.5 scale-105 opacity-100 shadow-lg shadow-primary/30 ring-2 ring-primary" : "scale-95 opacity-45 hover:opacity-90"}`}>
                            {it.metadata?.poster ? (
                                <img src={it.metadata.poster} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" />
                            ) : (
                                <div className="h-full w-full bg-base-300" />
                            )}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// MAIN banner — upcoming-heavy with countdowns (see pickDiscoverBanner).
function DiscoverBanner({ built, libIndex }) {
    // Same cached TMDB pages the upcoming rows use — no extra requests.
    const { data: upcoming, loading } = useTmdbMany(UPCOMING_IDS);
    const ready = !loading;
    const pick = ({ prevIds }) => pickVerified(() => pickDiscoverBanner({ built, libIndex, prevIds, upcoming }));
    const slides = useHeroBanner({ pool: built.released, ready, pick, storageKey: DISCOVER_BANNER_KEY });
    if (!slides.length) return ready ? null : <HeroSkeleton id={BANNER_IDS.DISCOVER_MAIN} />;
    return <HeroCarousel items={slides} id={BANNER_IDS.DISCOVER_MAIN} />;
}

// SPOTLIGHT banner — library only, poster-card look (see pickSpotlightBanner).
// Skips every title the main banner currently shows.
function SpotlightBanner({ built }) {
    const [filter, setFilter] = useState("all");
    const pick = ({ prevIds }) => {
        const main = loadBanner(DISCOVER_BANNER_KEY);
        const excludeIds = new Set((main?.slides || []).map((s) => (s.kind === "up" ? s.data?.id : s.id)));
        return pickVerified(() => pickSpotlightBanner({ built, prevIds, excludeIds }));
    };
    const slides = useHeroBanner({ pool: built.released, ready: true, pick, storageKey: SPOTLIGHT_BANNER_KEY });
    if (!slides.length) return null;

    const movies = slides.filter((i) => !i.seasons);
    const shows = slides.filter((i) => i.seasons);
    const tabs = [
        { id: "all", label: "All", list: slides },
        { id: "movie", label: "Movies", list: movies },
        { id: "series", label: "Series", list: shows },
    ];
    const showTabs = movies.length > 0 && shows.length > 0;
    const current = showTabs ? tabs.find((t) => t.id === filter)?.list : null;
    const shown = current?.length ? current : slides;

    return (
        <section id={BANNER_IDS.DISCOVER_SPOTLIGHT}>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 sm:mb-4">
                <div>
                    <div className="flex items-center gap-2">
                        <span className="h-3.5 w-1 rounded-full bg-primary" />
                        <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-primary sm:text-xs">Curated for you</span>
                    </div>
                    <h2 className="mt-1 text-lg font-bold leading-tight text-base-content sm:text-2xl">In the Spotlight</h2>
                    <p className="mt-0.5 text-xs text-base-content/60 sm:text-sm">Standout picks from your library, refreshed every few days</p>
                </div>
                {showTabs && (
                    <div className="flex gap-1 rounded-full bg-base-200 p-1 text-xs" role="tablist" aria-label="Filter spotlight">
                        {tabs.map((t) => (
                            <button
                                key={t.id}
                                type="button"
                                role="tab"
                                aria-selected={shown === t.list}
                                disabled={!t.list.length}
                                onClick={() => setFilter(t.id)}
                                className={`cursor-pointer rounded-full px-3 py-1 font-medium transition-all duration-300 disabled:cursor-default disabled:opacity-40 ${shown === t.list ? "bg-primary text-primary-content shadow" : "text-base-content/70 hover:text-base-content"}`}>
                                {t.label} <span className="opacity-70">{t.list.length}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>
            <HeroCarousel items={shown} variant="spotlight" />
        </section>
    );
}

// Mounts its children only once it scrolls near the viewport. Keeps the first render
// light on this very long page (fewer rows, images and timers alive at once).
// Wrapper is :empty-hidden, so a row that renders nothing leaves no gap.
function LazyMount({ children, placeholder = <div className="h-[260px]" />, rootMargin = "700px 0px" }) {
    const ref = useRef(null);
    const [show, setShow] = useState(false);
    useEffect(() => {
        const el = ref.current;
        if (!el || show) return;
        if (typeof IntersectionObserver === "undefined") {
            setShow(true);
            return;
        }
        const io = new IntersectionObserver(
            ([e]) => {
                if (e.isIntersecting) {
                    setShow(true);
                    io.disconnect();
                }
            },
            { rootMargin },
        );
        io.observe(el);
        return () => io.disconnect();
    }, [show, rootMargin]);
    return (
        <div ref={ref} className="empty:hidden">
            {show ? children : placeholder}
        </div>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// ═════════════════════════════════════════════════════════════════════════════
// ON THE HORIZON
// ═════════════════════════════════════════════════════════════════════════════
const HORIZON_SOURCES = [{ id: "upcoming-blockbusters", weight: 1.2 }, { id: "highly-anticipated", weight: 1.2 }, ...STUDIOS.map((x) => ({ id: `studio-${x.slug}`, weight: 1.4, slug: x.slug }))];
const HORIZON_IDS = HORIZON_SOURCES.map((x) => x.id);
const HORIZON_SIZE = 10;
const HORIZON_AUTOPLAY_MS = 3000;
const HORIZON_SLIDE_MS = 1600;
const HORIZON_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const SLIDE_EASE = "cubic-bezier(0.45, 0, 0.15, 1)";

const daysUntil = (iso) => Math.ceil((releaseTime(iso) - Date.now()) / DAY_MS);
function relativeIn(iso) {
    const d = daysUntil(iso);
    if (d < 0) return "Already out";
    if (d === 0) return "Today";
    if (d === 1) return "Tomorrow";
    if (d < 60) return `in ${d} days`;
    return `in ${Math.round(d / 30)} months`;
}

const tmdbMemo = new Map();
const memoFetch = (key, path) => {
    if (!tmdbMemo.has(key))
        tmdbMemo.set(
            key,
            fetch(`${TMDB_BASE}${path}?api_key=${TMDB_KEY}&language=en-US`)
                .then((r) => r.json())
                .catch(() => null),
        );
    return tmdbMemo.get(key);
};

function useEntered(first) {
    const [entered, setEntered] = useState(first);
    useEffect(() => {
        if (first) return;
        let r2;
        const r1 = requestAnimationFrame(() => {
            r2 = requestAnimationFrame(() => setEntered(true));
        });
        return () => {
            cancelAnimationFrame(r1);
            cancelAnimationFrame(r2);
        };
    }, [first]);
    return entered;
}

function ImageLayer({ src, dir, out, first }) {
    const entered = useEntered(first);
    const state = out ? "out" : entered ? "in" : "pre";
    const shift = state === "in" ? 0 : state === "out" ? -dir * 30 : dir * 30;
    return (
        <div
            className="absolute inset-0"
            style={{
                opacity: state === "in" ? 1 : 0,
                transform: `translate3d(${shift}%,0,0)`,
                transition: `opacity ${HORIZON_SLIDE_MS}ms ${SLIDE_EASE}, transform ${HORIZON_SLIDE_MS}ms ${SLIDE_EASE}`,
            }}>
            <img
                src={src}
                alt=""
                draggable={false}
                decoding="async"
                className="h-full w-full object-cover"
                style={{ transform: state === "pre" ? "scale(1.12)" : "scale(1)", transition: `transform 4000ms ${HORIZON_EASE}` }}
            />
        </div>
    );
}

function Rise({ n = 0, children, className = "" }) {
    const [on, setOn] = useState(false);
    useEffect(() => {
        const r = requestAnimationFrame(() => setOn(true));
        return () => cancelAnimationFrame(r);
    }, []);
    const delay = 100 + n * 70;
    return (
        <div
            className={className}
            style={{
                opacity: on ? 1 : 0,
                transform: on ? "translate3d(0,0,0)" : "translate3d(0,30px,0)",
                filter: on ? "blur(0px)" : "blur(8px)",
                transition: `opacity 900ms ease ${delay}ms, transform 1000ms ${HORIZON_EASE} ${delay}ms, filter 900ms ease ${delay}ms`,
            }}>
            {children}
        </div>
    );
}

function TitleReveal({ text }) {
    const [on, setOn] = useState(false);
    useEffect(() => {
        const r = requestAnimationFrame(() => setOn(true));
        return () => cancelAnimationFrame(r);
    }, []);
    return (
        <h2 aria-label={text} className="flex flex-wrap gap-x-[0.28em] max-h-[2.5em] overflow-hidden text-lg font-bold leading-tight text-white sm:max-h-none sm:overflow-visible sm:text-4xl">
            {text.split(" ").map((w, i) => (
                <span key={i} aria-hidden="true" className="-mb-[0.12em] inline-block overflow-hidden pb-[0.12em]">
                    <span
                        className="inline-block"
                        style={{
                            transform: on ? "translate3d(0,0,0) rotate(0deg)" : "translate3d(0,115%,0) rotate(5deg)",
                            transition: `transform 1000ms ${HORIZON_EASE} ${150 + i * 60}ms`,
                        }}>
                        {w}
                    </span>
                </span>
            ))}
        </h2>
    );
}

function HorizonText({ item, out, trailerKey, onWatchTrailer, onDialog }) {
    return (
        <div
            className={`flex flex-col gap-1.5 sm:gap-3 ${out ? "pointer-events-none absolute inset-x-0 bottom-0" : ""}`}
            style={{
                opacity: out ? 0 : 1,
                transform: out ? "translate3d(0,-14px,0)" : "translate3d(0,0,0)",
                filter: out ? "blur(6px)" : "blur(0px)",
                transition: out ? `opacity ${HORIZON_SLIDE_MS * 0.6}ms ${SLIDE_EASE}, transform ${HORIZON_SLIDE_MS * 0.6}ms ${SLIDE_EASE}, filter ${HORIZON_SLIDE_MS * 0.6}ms ${SLIDE_EASE}` : "none",
            }}>
            <Rise n={0}>
                <p className="text-[11px] font-semibold text-primary sm:text-sm">
                    {fmtDate(item._release)} · {relativeIn(item._release)}
                    {item.metadata.rating != null && <span className="font-medium text-white sm:hidden"> · ★ {item.metadata.rating.toFixed(1)}</span>}
                </p>
            </Rise>
            <TitleReveal text={item.title} />
            {item.metadata.rating != null && (
                <Rise n={2} className="hidden sm:block">
                    <p className="text-xs font-medium text-white sm:text-sm">★ {item.metadata.rating.toFixed(1)}</p>
                </Rise>
            )}
            <Rise n={3} className="hidden sm:block">
                <p className="line-clamp-2 max-w-lg text-sm text-white/90">{item.metadata.overview}</p>
            </Rise>
            <Rise n={4} className="hidden sm:block">
                <LiveCountdown iso={item._release} />
            </Rise>
            <Rise n={5}>
                <div className="flex flex-nowrap gap-2 sm:mt-1 sm:flex-wrap">
                    {trailerKey && (
                        <button
                            type="button"
                            onClick={() => onWatchTrailer?.(trailerKey)}
                            className="inline-flex cursor-pointer items-center whitespace-nowrap rounded-md bg-white px-3 py-1.5 text-[11px] font-semibold text-black transition-all duration-300 hover:-translate-y-0.5 active:scale-95 sm:px-3.5 sm:py-2 sm:text-sm">
                            <span className="mr-1.5">▶</span>Watch trailer
                        </button>
                    )}
                    <Link
                        to={`/media/${encodeURIComponent(item.id)}`}
                        className="inline-flex items-center whitespace-nowrap rounded-md bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-content transition-all duration-300 hover:-translate-y-0.5 active:scale-95 sm:px-3.5 sm:py-2 sm:text-sm">
                        Details
                    </Link>
                    {/* Opens the Remind me dialog right here (no redirect); the banner pauses while it is open. */}
                    <RemindMe mediaId={item.id} title={item.title} poster={item.metadata.poster || null} releaseDate={item._release} enabled={!out} onOpenChange={onDialog}>
                        {({ reminded, open }) => (
                            <button
                                type="button"
                                onClick={open}
                                title={reminded ? "Reminder is on. Click to change it" : "Get a notification on release day"}
                                className="inline-flex cursor-pointer items-center whitespace-nowrap rounded-md bg-black/30 px-3 py-1.5 text-[11px] font-semibold text-white ring-1 ring-inset ring-white/30 transition-all duration-300 hover:-translate-y-0.5 hover:bg-black/50 active:scale-95 sm:px-3.5 sm:py-2 sm:text-sm">
                                <span className="mr-1.5">{reminded ? "✓" : "＋"}</span>
                                {reminded ? "Reminder on" : "Remind me"}
                            </button>
                        )}
                    </RemindMe>
                </div>
            </Rise>
        </div>
    );
}

const toHorizonItem = (r) => ({
    id: `tmdb-movie-${r.id}`,
    tmdbId: r.id,
    title: r.title || "Untitled",
    _release: r.release_date,
    metadata: {
        title: r.title || "Untitled",
        rating: r.vote_average ? Math.round(r.vote_average * 10) / 10 : null,
        overview: r.overview || "",
        backdrop: `${IMG_BASE}/w1280${r.backdrop_path}`,
        poster: r.poster_path ? `${IMG_BASE}/w342${r.poster_path}` : null,
    },
});

function HorizonBanner({ libIndex }) {
    const { data, loading } = useTmdbMany(HORIZON_IDS);
    const [idx, setIdx] = useState(0);
    const [hovered, setHovered] = useState(false);
    const [held, setHeld] = useState(false);
    const [trailers, setTrailers] = useState({});
    const [stack, setStack] = useState([]);
    const [certTick, setCertTick] = useState(0); // bumps when a verified rating turns out restricted
    const [trailerOpen, setTrailerOpen] = useState(null); // YouTube key of the trailer dialog that is open
    const [dialogOpen, setDialogOpen] = useState(false); // Remind me dialog open
    const paused = Boolean(trailerOpen) || dialogOpen; // autoplay stands still while a dialog is open
    const railRef = useRef(null);
    const sectionRef = useRef(null);
    const inViewRef = useRef(true);
    const resumeRef = useRef(null);
    const prevIdxRef = useRef(0);
    const dirRef = useRef(1);
    const layerId = useRef(0);
    const drag = useRef({ moved: false });

    const items = useMemo(() => {
        const best = new Map();
        for (const src of HORIZON_SOURCES) {
            for (const r of data[src.id] || []) {
                if (r.adult || !r.release_date || !r.backdrop_path || !r.overview) continue;
                if (!(releaseTime(r.release_date) > Date.now()) || libIndex.has(`movie:${r.id}`)) continue;
                const item = toHorizonItem(r);
                if (isMature(item)) continue; // never show R / TV-MA
                const weight = src.slug === "marvel" || isMarvel(item) ? 1.8 : src.weight;
                const score = (r.popularity || 0) * weight;
                if (!best.has(r.id) || score > best.get(r.id).score) best.set(r.id, { item, score });
            }
        }
        return [...best.values()]
            .sort((a, b) => b.score - a.score)
            .slice(0, HORIZON_SIZE)
            .map((x) => x.item)
            .sort((a, b) => a._release.localeCompare(b._release));
    }, [data, libIndex, certTick]);

    // Verify the shown titles' US rating (cached); if one is R/TV-MA, rebuild so the next title replaces it.
    useEffect(() => {
        let alive = true;
        const unknown = items.map(certTarget).filter((tg) => tg && !certStore()[`${tg.kind}:${tg.id}`]);
        if (!unknown.length) return;
        Promise.all(unknown.map((tg) => fetchCert(tg.kind, tg.id))).then((cs) => {
            if (alive && cs.some(isBlockedCert)) setCertTick((n) => n + 1);
        });
        return () => {
            alive = false;
        };
    }, [items]);

    const count = items.length;
    const cur = items[Math.min(idx, Math.max(count - 1, 0))];

    if (prevIdxRef.current !== idx && count) {
        const diff = idx - prevIdxRef.current;
        dirRef.current = (diff > 0 && diff <= count / 2) || diff < -count / 2 ? 1 : -1;
        prevIdxRef.current = idx;
    }

    useEffect(() => {
        if (!cur) return;
        setStack((prev) => {
            if (prev.length && prev[prev.length - 1].item.id === cur.id) return prev;
            const next = prev.map((l) => ({ ...l, out: true }));
            next.push({ id: ++layerId.current, item: cur, dir: dirRef.current, out: false, first: prev.length === 0 });
            return next;
        });
    }, [cur?.id]);

    useEffect(() => {
        if (!stack.some((l) => l.out)) return;
        const t = setTimeout(() => setStack((p) => p.filter((l) => !l.out)), HORIZON_SLIDE_MS + 250);
        return () => clearTimeout(t);
    }, [stack]);

    useEffect(() => {
        if (!cur || cur.tmdbId in trailers) return;
        let alive = true;
        memoFetch(`v:${cur.tmdbId}`, `/movie/${cur.tmdbId}/videos`).then((j) => {
            if (!alive) return;
            const vids = (j?.results || []).filter((v) => v.site === "YouTube");
            const t = vids.find((v) => v.type === "Trailer" && v.official) || vids.find((v) => v.type === "Trailer") || vids.find((v) => v.type === "Teaser");
            setTrailers((m) => ({ ...m, [cur.tmdbId]: t?.key || null }));
        });
        return () => {
            alive = false;
        };
    }, [cur, trailers]);

    useEffect(() => {
        const rail = railRef.current;
        const el = rail?.children[0]?.children[idx + 2];
        if (rail && el) rail.scrollTo({ left: el.offsetLeft - rail.clientWidth / 2 + el.clientWidth / 2, behavior: "smooth" });
    }, [idx]);

    useEffect(() => {
        if (count <= 1 || hovered || held || paused) return;
        const timer = setInterval(() => {
            if (document.hidden || !inViewRef.current) return;
            setIdx((i) => (i + 1) % count);
        }, HORIZON_AUTOPLAY_MS);
        return () => clearInterval(timer);
    }, [count, idx, hovered, held, paused]);

    useEffect(() => {
        const el = sectionRef.current;
        if (!el || typeof IntersectionObserver === "undefined") return;
        const io = new IntersectionObserver(
            ([e]) => {
                inViewRef.current = e.isIntersecting;
            },
            { threshold: 0.2 },
        );
        io.observe(el);
        return () => io.disconnect();
    }, [count]);

    useEffect(() => () => clearTimeout(resumeRef.current), []);

    if (loading || !count) return null;

    const onPointerDown = (e) => {
        if (e.target.closest("[data-rail]") || (e.pointerType === "mouse" && e.button !== 0)) return;
        const sx = e.clientX;
        const sy = e.clientY;
        drag.current.moved = false;
        clearTimeout(resumeRef.current);
        setHeld(true);
        const finish = (ev) => {
            window.removeEventListener("pointerup", finish);
            window.removeEventListener("pointercancel", finish);
            const dx = ev.clientX - sx;
            const dy = ev.clientY - sy;
            drag.current.moved = Math.abs(dx) > 6 || Math.abs(dy) > 6;
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.2) setIdx((i) => Math.max(0, Math.min(count - 1, i + (dx < 0 ? 1 : -1))));
            resumeRef.current = setTimeout(() => setHeld(false), 4000);
        };
        window.addEventListener("pointerup", finish);
        window.addEventListener("pointercancel", finish);
    };

    const fill = ((Math.min(idx, count - 1) + 0.5) / count) * 100;

    return (
        <section
            id={BANNER_IDS.DISCOVER_HORIZON}
            ref={sectionRef}
            tabIndex={0}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onKeyDown={(e) => {
                if (e.key === "ArrowRight") setIdx((i) => Math.min(i + 1, count - 1));
                if (e.key === "ArrowLeft") setIdx((i) => Math.max(i - 1, 0));
            }}
            onPointerDown={onPointerDown}
            onClickCapture={(e) => {
                if (drag.current.moved) {
                    e.preventDefault();
                    e.stopPropagation();
                    drag.current.moved = false;
                }
            }}
            aria-label="Upcoming movies timeline"
            className="relative flex h-[240px] cursor-grab touch-pan-y select-none flex-col overflow-hidden rounded-xl bg-base-300 outline-none focus-visible:ring-2 focus-visible:ring-primary active:cursor-grabbing sm:h-auto sm:min-h-[480px] sm:rounded-2xl">
            {stack.map((l) => (
                <ImageLayer key={l.id} src={l.item.metadata.backdrop} dir={l.dir} out={l.out} first={l.first} />
            ))}
            <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/30 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/85 to-transparent" />

            <div className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-full bg-black/50 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-white sm:left-8 sm:top-6 sm:text-xs">
                <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                </span>
                On the Horizon
            </div>

            <div className="relative z-10 flex flex-1 flex-col justify-end px-4 pb-2 pt-10 sm:px-8 sm:pb-6 sm:pt-20" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.85), 0 2px 14px rgba(0,0,0,0.55)" }}>
                <div className="relative max-w-xl">
                    {stack.map((l) => (
                        <HorizonText key={l.id} item={l.item} out={l.out} trailerKey={trailers[l.item.tmdbId]} onWatchTrailer={setTrailerOpen} onDialog={setDialogOpen} />
                    ))}
                </div>
            </div>

            {count > 1 && (
                <div
                    ref={railRef}
                    data-rail
                    className="relative z-20 cursor-default overflow-x-auto px-3 pb-2 pt-1 sm:px-6 sm:pb-5 sm:pt-2"
                    style={NO_SCROLLBAR}
                    role="tablist"
                    aria-label="Release timeline">
                    <div className="relative flex min-w-max items-end sm:min-w-0">
                        <span className="pointer-events-none absolute bottom-[6px] left-0 right-0 h-px bg-white/25" />
                        <span className="pointer-events-none absolute bottom-[6px] left-0 h-px bg-primary" style={{ width: `${fill}%`, transition: `width ${HORIZON_SLIDE_MS}ms ${SLIDE_EASE}` }} />
                        {items.map((it, i) => {
                            const d = new Date(releaseTime(it._release));
                            const prev = i > 0 ? new Date(releaseTime(items[i - 1]._release)) : null;
                            const newMonth = !prev || prev.getMonth() !== d.getMonth() || prev.getFullYear() !== d.getFullYear();
                            const on = i === idx;
                            return (
                                <button
                                    key={it.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={on}
                                    onClick={() => setIdx(i)}
                                    title={`${it.title} — ${fmtDate(it._release)}`}
                                    className="relative flex min-w-[3.6rem] flex-1 cursor-pointer flex-col items-center gap-1 pt-1">
                                    <span className="h-3 text-[9px] font-bold uppercase tracking-wider text-white/55">{newMonth ? d.toLocaleDateString(undefined, { month: "short" }) : ""}</span>
                                    <span className={`text-xs font-semibold tabular-nums transition-all duration-500 ${on ? "-translate-y-0.5 scale-110 text-white" : "text-white/60"}`}>
                                        {d.getDate()}
                                    </span>
                                    <span className="relative flex items-center justify-center">
                                        {on && <span className="absolute h-3.5 w-3.5 animate-ping rounded-full bg-primary/60" />}
                                        <span
                                            className={`relative z-10 rounded-full transition-all duration-500 ${on ? "h-3.5 w-3.5 bg-primary ring-4 ring-primary/30" : "h-2.5 w-2.5 bg-white/60 hover:bg-white"}`}
                                        />
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
            {trailerOpen && <TrailerModal trailerKey={trailerOpen} onClose={() => setTrailerOpen(null)} />}
        </section>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// RECOMMENDATIONS BANNERS — engine + UI (moved unchanged from RecommendationsPage.jsx;
// every name that clashed with a Discover name got a `Reco` prefix, nothing else changed)
// ═════════════════════════════════════════════════════════════════════════════
// ── Recommendations hero banner config (only the values that differ from / aren't in the Discover set above) ──
const HERO_NEW_DAYS = 45; // "Latest ..." tag only for titles released within this many days
const RECO_HERO_SLIDES = 15; // slides per banner set
const RECO_HERO_MIN_SLIDES = 5; // below this (after removals / deletions) repair the set
const HERO_MIN_VOTES = 300; // "popular" = enough TMDB votes...
const HERO_MIN_RATING = 6.5; // ...and a decent rating
const RECO_BANNER_STORAGE_KEY = "flux.heroBanner.v5";
const RECO_BANNER_HIDDEN_KEY = "flux.heroBanner.hidden.v1";

// ============================================================================
// Hero banner engine
// ============================================================================

function loadRecoBanner() {
    try {
        const raw = JSON.parse(localStorage.getItem(RECO_BANNER_STORAGE_KEY));
        if (raw && Array.isArray(raw.slides) && typeof raw.expiresAt === "number") return raw;
    } catch {
        /* ignore corrupt / unavailable storage */
    }
    return null;
}

function saveRecoBanner(banner) {
    try {
        localStorage.setItem(RECO_BANNER_STORAGE_KEY, JSON.stringify(banner));
    } catch {
        /* ignore quota / private mode */
    }
}

function loadRecoHidden() {
    try {
        const raw = JSON.parse(localStorage.getItem(RECO_BANNER_HIDDEN_KEY));
        if (Array.isArray(raw)) return new Set(raw);
    } catch {
        /* ignore */
    }
    return new Set();
}

function saveRecoHidden(set) {
    try {
        localStorage.setItem(RECO_BANNER_HIDDEN_KEY, JSON.stringify([...set].slice(-300)));
    } catch {
        /* ignore */
    }
}

// Banner = the LATEST media: real release date first (TMDB releaseDate /
// firstAirDate), then library-added date (metadata.date) as tie-breaker /
// fallback for items without a release date. Only popular titles (votes +
// rating) qualify first; mature-rated (R / NC-17 / TV-MA ...) never appear.
// Global ranking across movies, series and anime, no per-type quota.
const typeLabel = { movie: "Latest Movie", series: "Latest Series", anime: "Latest Anime" };

// Badge text, computed at render time from the release date so it flips on
// its own the day a title passes HERO_NEW_DAYS:
//   released ≤ 45 days ago  → "Latest Movie" / "Latest Series" / "Latest Anime"
//   older                   → Top Rated / Fan Favorite / Recent Hit / Featured
//   no release info at all  → "Just Added"
function heroTag(item, type) {
    const { rel } = latestRank(item);
    if (rel === -Infinity) return "Just Added";
    const ageDays = (Date.now() - rel) / DAY_MS;
    if (ageDays <= HERO_NEW_DAYS) return typeLabel[type] || "Latest Release";
    const m = item.metadata || {};
    if ((m.rating || 0) >= 8) return "Top Rated";
    if ((m.votes || 0) >= 1500) return "Fan Favorite";
    if (ageDays <= 365) return "Recent Hit";
    return "Featured";
}

function latestRank(item) {
    const m = item.metadata || {};
    // Release date → else just the year (Jan 1) → else unknown.
    let relMs = NaN;
    const rel = m.releaseDate || m.firstAirDate;
    if (rel) relMs = new Date(rel).getTime();
    if (!Number.isFinite(relMs) && m.year && Number.isFinite(Number(m.year))) relMs = Date.UTC(Number(m.year), 0, 1);
    const addMs = m.date ? new Date(m.date).getTime() : NaN;
    return { rel: Number.isFinite(relMs) ? relMs : -Infinity, add: Number.isFinite(addMs) ? addMs : -Infinity };
}

function byLatest(a, b) {
    const ra = latestRank(a);
    const rb = latestRank(b);
    if (rb.rel !== ra.rel) return rb.rel > ra.rel ? 1 : -1; // release date first
    if (rb.add !== ra.add) return rb.add > ra.add ? 1 : -1; // then added date
    return 0;
}

// Build → verify the picked titles → if any is restricted (now cached, so the next
// build skips it) build again. Up to 4 rounds.
async function generateRecoBannerVerified(build, poolById) {
    let banner = build();
    for (let round = 0; round < 4; round++) {
        const certs = await Promise.all(
            banner.slides.map((sl) => {
                const t = certTarget(poolById.get(sl.id) || {});
                return t ? fetchCert(t.kind, t.id) : "";
            }),
        );
        if (!certs.some(isBlockedCert)) break;
        banner = build();
    }
    return banner;
}

function isPopular(item) {
    const m = item.metadata || {};
    return (m.votes || 0) >= HERO_MIN_VOTES && (m.rating || 0) >= HERO_MIN_RATING;
}

function generateRecoBanner(ctx, prev, hiddenIds, keepExpiresAt) {
    const hasArt = (i) => i.metadata?.backdrop || i.metadata?.poster;
    const all = ctx.pool.filter((i) => !hiddenIds.has(i.id) && !isMature(i));
    const withArt = all.filter(hasArt);
    const ranked = [...(withArt.length ? withArt : all)].sort(byLatest);

    // Popular titles first (newest → oldest); only if there aren't enough
    // popular ones do less-popular newest titles fill the remaining slots.
    const picked = [...ranked.filter(isPopular), ...ranked.filter((i) => !isPopular(i))].slice(0, RECO_HERO_SLIDES).sort(byLatest);

    const slides = picked.map((i) => ({
        id: i.id,
        reason: latestRank(i).rel === -Infinity ? "Just Added" : typeLabel[ctx.typeById.get(i.id)] || "New Release",
    }));

    const createdAt = Date.now();
    return {
        createdAt,
        expiresAt: keepExpiresAt ?? createdAt + BANNER_MIN_MS + Math.random() * (BANNER_MAX_MS - BANNER_MIN_MS),
        slides,
    };
}

// Owns the banner lifecycle: load → show → expire → regenerate.
//   ctx   = { pool, typeById } | null
//   ready = recommendations finished loading (so "Picked for You" can be used)
function useRecoHeroBanner(ctx, ready) {
    const [stored, setStored] = useState(loadRecoBanner);
    const [now, setNow] = useState(() => Date.now());

    // Re-check expiry while the page stays open.
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 60 * 1000);
        return () => clearInterval(t);
    }, []);

    const poolById = useMemo(() => new Map((ctx?.pool || []).map((i) => [i.id, i])), [ctx]);

    // Saved ids → live items (fresh metadata). Deleted media silently drops out.
    const slides = useMemo(() => {
        if (!stored) return [];
        return stored.slides
            .map((s) => {
                const item = poolById.get(s.id);
                return item ? { ...item, _heroReason: heroTag(item, ctx?.typeById?.get(item.id)) } : null;
            })
            .filter(Boolean);
    }, [stored, poolById, ctx]);

    // Selection is deterministic ("latest"), so the saved set is stale the
    // moment the library's real top-N changes (new media added, metadata
    // fetched) — rebuild then instead of waiting out the 3-day timer.
    const freshIds = useMemo(
        () =>
            ctx
                ? generateRecoBanner(ctx, null, loadRecoHidden(), 0)
                      .slides.map((s) => s.id)
                      .join("|")
                : null,
        [ctx],
    );
    const stale = !!stored && freshIds != null && stored.slides.map((s) => s.id).join("|") !== freshIds;

    const expired = !stored || now >= stored.expiresAt;
    const broken = !!stored && stored.slides.length >= RECO_HERO_MIN_SLIDES && slides.length < RECO_HERO_MIN_SLIDES;
    const needsNew = ready && !!ctx && (expired || broken || stale);

    useEffect(() => {
        if (!needsNew) return;
        // Expired → brand-new 3-day cycle. Broken (media removed) → repair
        // the set but keep the existing clock.
        const keep = stored && !expired ? stored.expiresAt : null;
        let alive = true;
        generateRecoBannerVerified(() => generateRecoBanner(ctx, stored, loadRecoHidden(), keep), poolById).then((next) => {
            if (!alive) return;
            saveRecoBanner(next);
            setStored(next);
        });
        return () => {
            alive = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [needsNew]);

    // Manual "new picks" — fresh set + fresh 3-day clock.
    const refresh = useCallback(() => {
        if (!ctx) return;
        const next = generateRecoBanner(ctx, stored, loadRecoHidden(), null);
        saveRecoBanner(next);
        setStored(next);
    }, [ctx, stored]);

    // "Not interested" — never shown in a banner again; set is repaired if it
    // gets too small.
    const hide = useCallback(
        (id) => {
            const hidden = loadRecoHidden();
            hidden.add(id);
            saveRecoHidden(hidden);
            if (!stored || !ctx) return;
            const remaining = stored.slides.filter((s) => s.id !== id);
            const next = remaining.length >= RECO_HERO_MIN_SLIDES ? { ...stored, slides: remaining } : generateRecoBanner(ctx, stored, hidden, stored.expiresAt);
            saveRecoBanner(next);
            setStored(next);
        },
        [ctx, stored],
    );

    return { slides, expiresAt: stored?.expiresAt ?? null, now, refresh, hide };
}

// ============================================================================
// Recommendations hero UI
// ============================================================================

function RecoHeroSlide({ item, active }) {
    const meta = item.metadata || {};
    const genres = meta.genres || item.category || [];
    const isMovie = !item.seasons;
    const navigate = useNavigate();
    const detailsPath = `/media/${encodeURIComponent(item.id)}`;
    // Series: Play opens the details page with a season pre-selected
    // (lowest real season; Season 0 / specials only if nothing else exists).
    const seasonKeys = Object.keys(item.seasons || {}).sort((a, b) => Number(a) - Number(b));
    const firstSeason = seasonKeys.find((k) => Number(k) !== 0) ?? seasonKeys[0];
    const seasonPath = firstSeason != null ? `${detailsPath}?season=${encodeURIComponent(firstSeason)}` : detailsPath;
    const seasonCount = item.seasons ? Object.keys(item.seasons).length : 0;
    const runtime = isMovie && meta.runtime ? (meta.runtime >= 60 ? `${Math.floor(meta.runtime / 60)}h ${meta.runtime % 60}m` : `${meta.runtime}m`) : null;
    // ── Entrance choreography ───────────────────────────────────────────
    // badge  : pill wipes open left→right
    // title  : words rise out of a clipped mask, one by one
    // meta   : items slide in from the left, one by one
    // overview: fades up out of a soft blur
    // buttons: rise with a slight spring
    // Leaving a slide fades text out fast (280ms) and only THEN resets it
    // (0ms, delayed), so nothing visibly rewinds while the slide fades away.
    const delayOf = (n) => HERO_TEXT_DELAY_MS + n * HERO_STAGGER_MS;
    const trans = (props, n, ms = HERO_TEXT_MS, ease = HERO_TEXT_EASE) =>
        active ? props.map((p) => `${p} ${ms}ms ${ease} ${delayOf(n)}ms`).join(", ") : ["opacity 280ms ease-out", ...props.filter((p) => p !== "opacity").map((p) => `${p} 0ms 280ms`)].join(", ");

    const badgeStyle = {
        opacity: active ? 1 : 0,
        clipPath: active ? "inset(0 0 0 0 round 9999px)" : "inset(0 100% 0 0 round 9999px)",
        transition: trans(["opacity", "clip-path"], 0, 900),
    };
    const wordStyle = (i) => ({
        transform: active ? "translate3d(0,0,0)" : "translate3d(0,110%,0)",
        transition: trans(["transform"], 2 + i * 0.6, 1100),
    });
    let metaIndex = 0;
    const metaStyle = () => ({
        opacity: active ? 1 : 0,
        transform: active ? "translate3d(0,0,0)" : "translate3d(-12px,0,0)",
        transition: trans(["opacity", "transform"], 3 + metaIndex++ * 0.35, 800),
    });
    const overviewStyle = {
        opacity: active ? 1 : 0,
        transform: active ? "translate3d(0,0,0)" : "translate3d(0,12px,0)",
        filter: active ? "blur(0px)" : "blur(6px)",
        transition: trans(["opacity", "transform", "filter"], 4.5, 1100),
    };
    const buttonStyle = (n) => ({
        opacity: active ? 1 : 0,
        transform: active ? "translate3d(0,0,0) scale(1)" : "translate3d(0,22px,0) scale(0.92)",
        transition: trans(["opacity", "transform"], n, 1000, HERO_SPRING),
    });
    const titleWords = String(meta.title || item.title || item.name || "").split(" ");

    const btn =
        "group bg-primary text-primary-content font-semibold inline-flex items-center text-[11px] sm:text-sm px-3.5 sm:px-5 py-1.5 sm:py-2 rounded-md shadow-md transition-all duration-300 hover:-translate-y-0.5 hover:scale-105 hover:shadow-lg hover:bg-primary/90 active:scale-95";
    const playIcon = <span className="mr-1.5 transition-transform duration-300 group-hover:translate-x-0.5">▶</span>;
    return (
        <div
            role="link"
            tabIndex={-1}
            onClick={() => navigate(detailsPath)}
            onKeyDown={(e) => e.key === "Enter" && navigate(detailsPath)}
            className="relative w-full h-full rounded-xl sm:rounded-2xl overflow-hidden cursor-pointer">
            {(meta.backdrop || meta.poster) && (
                <img
                    src={meta.backdrop || meta.poster}
                    alt=""
                    draggable={false}
                    className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                    style={{ transform: active ? "scale(1)" : "scale(1.1)", transition: `transform ${HERO_ZOOM_MS}ms ${HERO_EASE}`, willChange: "transform" }}
                />
            )}
            {/* Light backdrop: soft dark fade from the bottom only, just enough for text. Raise/lower the /60 and /20 to tune. */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent pointer-events-none" />
            <div
                className="relative z-10 flex flex-col justify-end h-full px-3.5 pt-3.5 pb-6 sm:p-8 sm:pb-10 lg:p-10 lg:pb-12 gap-1.5 sm:gap-3"
                // Soft shadow keeps text legible over any poster.
                style={{ textShadow: "0 1px 3px rgba(0,0,0,0.85), 0 2px 14px rgba(0,0,0,0.55)" }}>
                {item._heroReason && (
                    <span
                        style={badgeStyle}
                        className="inline-flex items-center w-fit max-w-full truncate px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full bg-primary/90 text-primary-content text-[9px] sm:text-[10px] font-bold uppercase tracking-wider">
                        {item._heroReason}
                    </span>
                )}
                <h2 aria-label={titleWords.join(" ")} className="text-base sm:text-3xl lg:text-4xl font-bold text-white max-w-xl leading-tight drop-shadow line-clamp-2">
                    {titleWords.map((w, i) => (
                        <span key={i} aria-hidden="true">
                            <span className="inline-block overflow-hidden align-bottom pb-[0.12em] -mb-[0.12em]">
                                <span className="inline-block" style={wordStyle(i)}>
                                    {w}
                                </span>
                            </span>{" "}
                        </span>
                    ))}
                </h2>
                <div className="flex items-center flex-wrap gap-x-2.5 gap-y-1 sm:gap-3 text-[11px] sm:text-sm text-white font-medium">
                    {meta.rating != null && <span style={metaStyle()}>★ {meta.rating.toFixed(1)}</span>}
                    {meta.year && <span style={metaStyle()}>{meta.year}</span>}
                    {runtime && <span style={metaStyle()}>{runtime}</span>}
                    {seasonCount > 0 && (
                        <span style={metaStyle()}>
                            {seasonCount} season{seasonCount > 1 ? "s" : ""}
                        </span>
                    )}
                    {genres.slice(0, 3).map((g) => (
                        <span key={g} style={metaStyle()} className="hidden sm:inline-block px-2 py-0.5 rounded-full bg-white/20 text-xs">
                            {g}
                        </span>
                    ))}
                </div>
                {meta.overview && (
                    <p style={overviewStyle} className="hidden sm:block text-sm text-white/95 max-w-xl line-clamp-2 lg:line-clamp-3">
                        {meta.overview}
                    </p>
                )}
                <div className="flex gap-2 sm:gap-3 mt-0.5 sm:mt-2">
                    {isMovie && item.streamUrl && (
                        <div style={buttonStyle(5.5)}>
                            <Link to={`/player/${encodeURIComponent(item.id)}`} onClick={(e) => e.stopPropagation()} className={btn}>
                                {playIcon}Play
                            </Link>
                        </div>
                    )}
                    {!isMovie && (
                        <div style={buttonStyle(5.5)}>
                            <Link to={seasonPath} state={{ season: firstSeason }} onClick={(e) => e.stopPropagation()} className={btn}>
                                {playIcon}Play
                            </Link>
                        </div>
                    )}
                    <div style={buttonStyle(6.3)}>
                        <Link
                            to={detailsPath}
                            onClick={(e) => e.stopPropagation()}
                            className="group bg-white/20 text-white font-semibold inline-flex items-center text-[11px] sm:text-sm px-3.5 sm:px-5 py-1.5 sm:py-2 rounded-md backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:scale-105 hover:bg-white/30 active:scale-95">
                            More Info
                            <span className="ml-0 w-0 overflow-hidden opacity-0 transition-all duration-300 group-hover:ml-1.5 group-hover:w-2 group-hover:opacity-100">›</span>
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}

// One-at-a-time hero carousel: autoplays, pauses on hover/drag, has dots,
// prev/next arrows (desktop hover), arrow-key support, and mouse/touch swipe.
// Always a landscape rectangle (aspect-ratio based, never a fixed height).
function RecoHeroCarousel({ items, id, arrowKeys = true }) {
    const [active, setActive] = useState(0);
    const containerRef = useRef(null);
    const dragState = useRef({ down: false, startX: 0, moved: false });
    const pausedRef = useRef(false);
    const hoverRef = useRef(false);
    const count = items?.length || 0;
    const itemsKey = (items || []).map((i) => i.id).join("|");

    // New slide set (refresh / expiry / hide) — start from the first slide.
    // Keyed on ids, not array identity, so unrelated data updates (history
    // etc.) don't yank the carousel back to slide 1.
    useEffect(() => {
        setActive(0);
    }, [itemsKey]);

    const go = useCallback(
        (dir) => {
            if (count > 1) setActive((i) => (i + dir + count) % count);
        },
        [count],
    );

    // Autoplay — timer restarts on every slide change (manual or auto), and
    // ticks are skipped while hovering or interacting.
    useEffect(() => {
        if (count <= 1) return;
        const timer = setInterval(() => {
            if (!pausedRef.current && !hoverRef.current) setActive((i) => (i + 1) % count);
        }, HERO_AUTOPLAY_MS);
        return () => clearInterval(timer);
    }, [count, active]);

    // Manual grab/swipe — dragging left/right moves one slide; a real drag
    // also suppresses the click that follows it so Play/More Info don't fire
    // mid-swipe.
    useEffect(() => {
        const el = containerRef.current;
        if (!el || count <= 1) return;
        const s = dragState.current;
        let resumeTimer = null;

        const down = (clientX) => {
            s.down = true;
            s.moved = false;
            s.startX = clientX;
            pausedRef.current = true;
            if (resumeTimer) clearTimeout(resumeTimer);
        };
        const move = (clientX) => {
            if (!s.down) return;
            if (Math.abs(clientX - s.startX) > 5) s.moved = true;
        };
        const up = (clientX) => {
            if (s.down) {
                const delta = clientX - s.startX;
                if (Math.abs(delta) > 40) {
                    const dir = delta < 0 ? 1 : -1;
                    setActive((i) => (i + dir + count) % count);
                }
            }
            s.down = false;
            resumeTimer = setTimeout(() => {
                pausedRef.current = false;
            }, 3000);
        };
        const onClickCapture = (e) => {
            if (s.moved) {
                e.preventDefault();
                e.stopPropagation();
            }
        };

        const onMouseDown = (e) => down(e.pageX);
        const onMouseMove = (e) => move(e.pageX);
        const onMouseUp = (e) => up(e.pageX);
        const onTouchStart = (e) => down(e.touches[0].pageX);
        const onTouchMove = (e) => move(e.touches[0].pageX);
        const onTouchEnd = (e) => up(e.changedTouches[0].pageX);

        el.addEventListener("mousedown", onMouseDown);
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
        el.addEventListener("touchstart", onTouchStart, { passive: true });
        el.addEventListener("touchmove", onTouchMove, { passive: true });
        el.addEventListener("touchend", onTouchEnd);
        el.addEventListener("click", onClickCapture, true);

        return () => {
            if (resumeTimer) clearTimeout(resumeTimer);
            el.removeEventListener("mousedown", onMouseDown);
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
            el.removeEventListener("touchstart", onTouchStart);
            el.removeEventListener("touchmove", onTouchMove);
            el.removeEventListener("touchend", onTouchEnd);
            el.removeEventListener("click", onClickCapture, true);
        };
    }, [count]);

    if (!count) return null;

    const safeActive = Math.min(active, count - 1);

    return (
        <div id={id}>
            <div
                ref={containerRef}
                tabIndex={0}
                onMouseEnter={() => (hoverRef.current = true)}
                onMouseLeave={() => (hoverRef.current = false)}
                onKeyDown={(e) => {
                    if (!arrowKeys) return;
                    if (e.key === "ArrowLeft") go(-1);
                    else if (e.key === "ArrowRight") go(1);
                }}
                className={`group relative ${HERO_SIZE} rounded-xl sm:rounded-2xl overflow-hidden cursor-pointer active:cursor-grabbing select-none outline-none focus-visible:ring-2 focus-visible:ring-primary`}>
                {items.map((item, i) => {
                    // Circular offset from the active slide. The active slide is
                    // fully visible; every other slide is transparent and parked
                    // slightly to one side. When the active slide changes, the
                    // outgoing slide drifts away while FADING OUT and the
                    // incoming one drifts in while FADING IN — same duration and
                    // easing for movement and fade, so they finish together.
                    let d = i - safeActive;
                    if (d > count / 2) d -= count;
                    else if (d < -count / 2) d += count;
                    const side = Math.max(-1, Math.min(1, d));
                    return (
                        <div
                            key={item.id ?? item.seriesKey}
                            className="absolute inset-0"
                            style={{
                                transform: `translate3d(${side * HERO_SHIFT}%, 0, 0)`,
                                opacity: d === 0 ? 1 : 0,
                                transition: `transform ${HERO_SLIDE_MS}ms ${HERO_EASE}, opacity ${HERO_SLIDE_MS}ms ${HERO_EASE}`,
                                willChange: "transform, opacity",
                                backfaceVisibility: "hidden",
                                pointerEvents: d === 0 ? "auto" : "none",
                            }}>
                            <RecoHeroSlide item={item} active={d === 0} />
                        </div>
                    );
                })}

                {count > 1 && (
                    <div className="absolute z-20 bottom-2 sm:bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 sm:gap-1.5 px-2 py-1 rounded-full">
                        {items.map((_, i) => (
                            <button
                                key={i}
                                onClick={() => setActive(i)}
                                aria-label={`Go to slide ${i + 1}`}
                                className={`h-1 sm:h-1.5 rounded-full cursor-pointer transition-all duration-500 ease-in-out ${i === safeActive ? "w-4 sm:w-6 bg-primary" : "w-1 sm:w-1.5 bg-white/50 hover:bg-white/80"}`}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// ============================================================================
// Recommendations "Tonight's Picks" banner
// ============================================================================
// Mobile (<sm): 16/9 landscape rectangle, min-h keeps text from clipping on tiny phones.
// sm+ unchanged: fixed heights.
const PICKS_SIZE = "w-full aspect-[16/9] min-h-[200px] sm:aspect-auto sm:min-h-0 sm:h-[380px] lg:h-[440px] 2xl:h-[490px]";
const PICKS_CANDIDATES = 45;
const PICKS_SHOWN = 15;
const PICKS_AUTOPLAY_MS = 5000;
const PICKS_SLIDE_MS = 1400;
const PICKS_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const PICKS_INOUT = "cubic-bezier(0.45, 0, 0.15, 1)";

const PlayGlyph = () => (
    <svg viewBox="0 0 24 24" className="mr-1.5 h-3.5 w-3.5 sm:h-4 sm:w-4" fill="currentColor" aria-hidden="true">
        <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
    </svg>
);

const compactVotes = (n) => (n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(n || 0));

function useOn(initial = false) {
    const [on, setOn] = useState(initial);
    useEffect(() => {
        if (initial) return;
        let r2;
        const r1 = requestAnimationFrame(() => {
            r2 = requestAnimationFrame(() => setOn(true));
        });
        return () => {
            cancelAnimationFrame(r1);
            cancelAnimationFrame(r2);
        };
    }, [initial]);
    return on;
}

function ScoreRing({ value, show }) {
    const r = 15;
    const c = 2 * Math.PI * r;
    const pct = Math.max(0, Math.min(10, value)) / 10;
    return (
        <span className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center sm:h-12 sm:w-12">
            <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
                <circle cx="18" cy="18" r={r} fill="rgba(0,0,0,0.45)" stroke="rgba(255,255,255,0.2)" strokeWidth="3" />
                <circle
                    cx="18"
                    cy="18"
                    r={r}
                    fill="none"
                    stroke="currentColor"
                    className="text-primary"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray={c}
                    strokeDashoffset={show ? c * (1 - pct) : c}
                    style={{ transition: `stroke-dashoffset 1400ms ${PICKS_EASE} ${show ? 700 : 0}ms` }}
                />
            </svg>
            <span className="relative text-xs font-bold text-white sm:text-sm">{value.toFixed(1)}</span>
        </span>
    );
}

function PickRise({ show, n = 0, children, className = "" }) {
    const delay = 250 + n * 80;
    return (
        <div
            className={className}
            style={{
                opacity: show ? 1 : 0,
                transform: show ? "translate3d(0,0,0)" : "translate3d(0,24px,0)",
                filter: show ? "blur(0px)" : "blur(6px)",
                transition: show ? `opacity 800ms ease ${delay}ms, transform 1000ms ${PICKS_EASE} ${delay}ms, filter 800ms ease ${delay}ms` : "none",
            }}>
            {children}
        </div>
    );
}

function PickTitle({ show, text }) {
    return (
        <h3 aria-label={text} className="flex max-h-[2.5em] flex-wrap gap-x-[0.26em] overflow-hidden text-xl font-bold leading-tight text-white sm:text-3xl lg:text-4xl 2xl:text-5xl">
            {text.split(" ").map((w, i) => (
                <span key={i} aria-hidden="true" className="-mb-[0.12em] inline-block overflow-hidden pb-[0.12em]">
                    <span
                        className="inline-block"
                        style={{
                            transform: show ? "translate3d(0,0,0) rotate(0deg)" : "translate3d(0,115%,0) rotate(4deg)",
                            transition: show ? `transform 1000ms ${PICKS_EASE} ${300 + i * 70}ms` : "none",
                        }}>
                        {w}
                    </span>
                </span>
            ))}
        </h3>
    );
}

function PickImage({ src, dir, out, first }) {
    const entered = useOn(first);
    const state = out ? "out" : entered ? "in" : "pre";
    const shift = state === "in" ? 0 : state === "out" ? -dir * 12 : dir * 12;
    return (
        <div
            className="absolute inset-0"
            style={{
                opacity: state === "in" ? 1 : 0,
                transform: `translate3d(${shift}%,0,0)`,
                transition: `opacity ${PICKS_SLIDE_MS}ms ${PICKS_INOUT}, transform ${PICKS_SLIDE_MS}ms ${PICKS_INOUT}`,
            }}>
            <img
                src={src}
                alt=""
                draggable={false}
                decoding="async"
                className="h-full w-full object-cover"
                style={{ transform: state === "pre" ? "scale(1.12)" : "scale(1)", transition: `transform 4000ms ${PICKS_EASE}` }}
            />
        </div>
    );
}

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-black";

function PickText({ item, rank, total, out }) {
    const show = useOn(false);
    const meta = item.metadata || {};
    const title = meta.title || item.title || item.name;
    const isMovie = !item.seasons;
    const detailsPath = `/media/${encodeURIComponent(item.id)}`;
    const seasonKeys = Object.keys(item.seasons || {}).sort((a, b) => Number(a) - Number(b));
    const firstSeason = seasonKeys.find((k) => Number(k) !== 0) ?? seasonKeys[0];
    const playPath = isMovie ? `/player/${encodeURIComponent(item.id)}` : firstSeason != null ? `${detailsPath}?season=${encodeURIComponent(firstSeason)}` : detailsPath;
    const label = item._pickTag || item._recReasons?.[0] || "Tonight's pick";
    const runtime = isMovie && meta.runtime ? (meta.runtime >= 60 ? `${Math.floor(meta.runtime / 60)}h ${meta.runtime % 60}m` : `${meta.runtime}m`) : null;
    const details = [meta.year, runtime, !isMovie ? `${seasonKeys.length} season${seasonKeys.length > 1 ? "s" : ""}` : null, meta.votes ? `${compactVotes(meta.votes)} votes` : null].filter(Boolean);
    const lockRef = (el) => {
        if (!el) return;
        if (out) el.setAttribute("inert", "");
        else el.removeAttribute("inert");
    };
    return (
        <div
            ref={lockRef}
            role="group"
            aria-roledescription="slide"
            aria-label={`${rank} of ${total}: ${title}`}
            aria-hidden={out || undefined}
            className="col-start-1 row-start-1 flex w-full flex-col gap-3 sm:gap-4 lg:gap-5"
            style={{
                opacity: out ? 0 : 1,
                transform: out ? "translate3d(0,-8px,0)" : "translate3d(0,0,0)",
                filter: out ? "blur(4px)" : "blur(0px)",
                transition: out ? `opacity ${PICKS_SLIDE_MS * 0.55}ms ease, transform ${PICKS_SLIDE_MS * 0.55}ms ease, filter ${PICKS_SLIDE_MS * 0.55}ms ease` : "none",
            }}>
            <PickRise show={show} n={0} className="flex max-w-full items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/85">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                <span className="truncate">{label}</span>
                <span className="text-white/35" aria-hidden="true">
                    /
                </span>
                <span className="shrink-0 font-medium tabular-nums text-white/60">
                    {String(rank).padStart(2, "0")} of {total}
                </span>
            </PickRise>
            <PickTitle show={show} text={title} />
            <PickRise show={show} n={2} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/85 sm:text-base">
                {meta.rating != null && <span className="font-bold text-amber-300">★ {meta.rating.toFixed(1)}</span>}
                {details.map((d) => (
                    <span key={d} className="flex items-center gap-3">
                        <span className="h-1 w-1 rounded-full bg-white/40" aria-hidden="true" />
                        {d}
                    </span>
                ))}
            </PickRise>
            {meta.overview && (
                <PickRise show={show} n={3} className="hidden 2xl:block">
                    <p className="line-clamp-2 max-w-xl text-base leading-relaxed text-white/80">{meta.overview}</p>
                </PickRise>
            )}
            <PickRise show={show} n={4} className="flex items-center gap-2 pt-1 sm:gap-3">
                <Link
                    to={playPath}
                    className={`inline-flex min-h-10 items-center rounded-lg bg-primary px-4 sm:min-h-11 text-sm font-semibold text-primary-content shadow-lg shadow-primary/30 transition-all duration-300 hover:-translate-y-0.5 active:scale-95 sm:px-6 ${focusRing}`}>
                    <PlayGlyph />
                    Play
                </Link>
                <Link
                    to={detailsPath}
                    className={`inline-flex min-h-10 items-center rounded-lg border border-white/30 px-4 sm:min-h-11 text-sm font-semibold text-white transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/10 active:scale-95 sm:px-6 ${focusRing}`}>
                    More Info
                </Link>
            </PickRise>
        </div>
    );
}

function TonightsPicks({ candidates }) {
    const [idx, setIdx] = useState(0);
    const [reduced] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const [held, setHeld] = useState(false);
    const [stack, setStack] = useState([]);
    const latest = useRef(candidates);
    const resumeRef = useRef(null);
    const inViewRef = useRef(true);
    const stageRef = useRef(null);
    const railRef = useRef(null);
    const prevIdxRef = useRef(0);
    const dirRef = useRef(1);
    const layerId = useRef(0);
    const drag = useRef({ moved: false });
    latest.current = candidates;
    const key = candidates.map((i) => i.id).join("|");

    const picks = useMemo(() => {
        return latest.current.slice(0, PICKS_SHOWN);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);

    const count = picks.length;
    const cur = picks[Math.min(idx, Math.max(count - 1, 0))];
    const running = !reduced && !hovered && !focused && !held;

    if (prevIdxRef.current !== idx && count) {
        const diff = idx - prevIdxRef.current;
        dirRef.current = (diff > 0 && diff <= count / 2) || diff < -count / 2 ? 1 : -1;
        prevIdxRef.current = idx;
    }

    useEffect(() => {
        setIdx(0);
    }, [key]);

    useEffect(() => {
        if (!cur) return;
        setStack((prev) => {
            if (prev.length && prev[prev.length - 1].item.id === cur.id) return prev;
            const next = prev.map((l) => ({ ...l, out: true }));
            next.push({ id: ++layerId.current, item: cur, rank: picks.indexOf(cur) + 1, dir: dirRef.current, out: false, first: prev.length === 0 });
            return next;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cur?.id]);

    useEffect(() => {
        if (!stack.some((l) => l.out)) return;
        const t = setTimeout(() => setStack((p) => p.filter((l) => !l.out)), PICKS_SLIDE_MS + 300);
        return () => clearTimeout(t);
    }, [stack]);

    useEffect(() => {
        if (count <= 1 || !running) return;
        const t = setInterval(() => {
            if (document.hidden || !inViewRef.current) return;
            setIdx((i) => (i + 1) % count);
        }, PICKS_AUTOPLAY_MS);
        return () => clearInterval(t);
    }, [count, idx, running]);

    useEffect(() => {
        const el = stageRef.current;
        if (!el || typeof IntersectionObserver === "undefined") return;
        const io = new IntersectionObserver(
            ([e]) => {
                inViewRef.current = e.isIntersecting;
            },
            { threshold: 0.2 },
        );
        io.observe(el);
        return () => io.disconnect();
    }, [count]);

    useEffect(() => {
        const rail = railRef.current;
        const el = rail?.children[idx];
        if (rail && el) rail.scrollTo({ left: el.offsetLeft - rail.clientWidth / 2 + el.clientWidth / 2, behavior: "smooth" });
    }, [idx, count]);

    useEffect(() => () => clearTimeout(resumeRef.current), []);

    if (count < 3) return null;

    const onPointerDown = (e) => {
        if (e.target.closest("[data-nav]") || (e.pointerType === "mouse" && e.button !== 0)) return;
        const sx = e.clientX;
        const sy = e.clientY;
        drag.current.moved = false;
        clearTimeout(resumeRef.current);
        setHeld(true);
        const finish = (ev) => {
            window.removeEventListener("pointerup", finish);
            window.removeEventListener("pointercancel", finish);
            const dx = ev.clientX - sx;
            const dy = ev.clientY - sy;
            drag.current.moved = Math.abs(dx) > 6 || Math.abs(dy) > 6;
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.2) setIdx((i) => (i + (dx < 0 ? 1 : -1) + count) % count);
            resumeRef.current = setTimeout(() => setHeld(false), 3000);
        };
        window.addEventListener("pointerup", finish);
        window.addEventListener("pointercancel", finish);
    };

    return (
        <section id={BANNER_IDS.RECO_TONIGHTS_PICKS} className="picks-root" aria-labelledby="tonights-picks-title">
            <style>{`@media (prefers-reduced-motion: reduce){.picks-root *{transition-duration:0.01ms !important;animation-duration:0.01ms !important;animation-iteration-count:1 !important}}`}</style>
            <div className="mb-3 flex items-center gap-3 sm:mb-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-content shadow-lg shadow-primary/30">
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
                        <path d="M12 2.5l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.5 6.1 20.7l1.2-6.6L2.5 9.5l6.6-.9L12 2.5z" />
                    </svg>
                </span>
                <div>
                    <h2 id="tonights-picks-title" className="text-lg font-bold leading-tight text-base-content sm:text-2xl">
                        Tonight's Picks
                    </h2>
                    <p className="text-sm text-base-content/70">The {count} highest-rated and most popular titles in your library</p>
                </div>
            </div>

            <div
                ref={stageRef}
                role="region"
                aria-roledescription="carousel"
                aria-label="Tonight's picks"
                tabIndex={0}
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
                onFocus={() => setFocused(true)}
                onBlur={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
                }}
                onKeyDown={(e) => {
                    if (e.key === "ArrowRight") setIdx((i) => (i + 1) % count);
                    if (e.key === "ArrowLeft") setIdx((i) => (i - 1 + count) % count);
                }}
                onPointerDown={onPointerDown}
                onClickCapture={(e) => {
                    if (drag.current.moved) {
                        e.preventDefault();
                        e.stopPropagation();
                        drag.current.moved = false;
                    }
                }}
                className={`relative touch-pan-y select-none overflow-hidden rounded-xl bg-black outline-none ring-1 ring-white/10 focus-visible:ring-2 focus-visible:ring-primary sm:rounded-2xl ${PICKS_SIZE}`}>
                {stack.map((l) => (
                    <PickImage key={l.id} src={l.item.metadata.backdrop || l.item.metadata.poster} dir={l.dir} out={l.out} first={l.first} />
                ))}
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-transparent" />
                <div className="absolute inset-y-0 left-0 w-full bg-gradient-to-r from-black/85 via-black/45 to-transparent sm:w-[72%]" />

                <div className="absolute inset-0 z-10 flex flex-col justify-end px-5 pb-5 sm:px-10 sm:pb-7 lg:px-14 lg:pb-9">
                    <div className="grid w-full max-w-[36rem]" aria-live={running ? "off" : "polite"}>
                        {stack.map((l) => (
                            <PickText key={l.id} item={l.item} rank={l.rank} total={count} out={l.out} />
                        ))}
                    </div>

                    <div data-nav className="mt-5 hidden w-full justify-center sm:flex lg:mt-8">
                        <div
                            ref={railRef}
                            className="flex w-fit max-w-full gap-2 overflow-x-auto px-4 py-1.5"
                            style={{
                                ...NO_SCROLLBAR,
                                WebkitMaskImage: "linear-gradient(to right, transparent, #000 16px, #000 calc(100% - 16px), transparent)",
                                maskImage: "linear-gradient(to right, transparent, #000 16px, #000 calc(100% - 16px), transparent)",
                            }}
                            role="tablist"
                            aria-label="Choose a pick">
                            {picks.map((it, i) => {
                                const on = i === idx;
                                const m = it.metadata || {};
                                const name = m.title || it.title || it.name;
                                return (
                                    <button
                                        key={it.id}
                                        type="button"
                                        role="tab"
                                        aria-selected={on}
                                        aria-label={`${i + 1}. ${name}`}
                                        title={`${i + 1}. ${name}`}
                                        onClick={() => setIdx(i)}
                                        className={`relative h-14 w-11 shrink-0 cursor-pointer overflow-hidden rounded-md transition-all duration-500 lg:h-16 lg:w-12 ${focusRing} ${
                                            on ? "-translate-y-0.5 opacity-100 ring-2 ring-primary" : "opacity-50 hover:opacity-100"
                                        }`}>
                                        {m.poster ? (
                                            <img src={m.poster} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" />
                                        ) : (
                                            <span className="block h-full w-full bg-white/10" />
                                        )}
                                        <span
                                            className={`absolute inset-x-0 bottom-0 py-px text-center text-[10px] font-bold tabular-nums ${on ? "bg-primary text-primary-content" : "bg-black/75 text-white"}`}>
                                            {i + 1}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}

// ============================================================================
// Home hero banner — own engine (priority fill); UI = RecoHeroSlide / RecoHeroCarousel
// ============================================================================
const HOME_BANNER_STORAGE_KEY = "flux.homeBanner.v2";
const HOME_HERO_SLIDES = 15;

function loadHomeBanner() {
    try {
        const raw = JSON.parse(localStorage.getItem(HOME_BANNER_STORAGE_KEY));
        if (raw && Array.isArray(raw.slides) && typeof raw.expiresAt === "number") return raw;
    } catch {
        /* ignore corrupt / unavailable storage */
    }
    return null;
}

function saveHomeBanner(banner) {
    try {
        localStorage.setItem(HOME_BANNER_STORAGE_KEY, JSON.stringify(banner));
    } catch {
        /* ignore quota / private mode */
    }
}

// "Released" date → ms, or NaN. Never the library-added date, never a future date.
//   movie  : metadata.releaseDate
//   series : newest aired episode (episodeSchedule.lastAirDate) so a new season counts; else firstAirDate
const HOME_NEW_DAYS = 365; // "recently released" = released within the last 12 months
function releasedMs(item) {
    const m = item.metadata || {};
    const now = Date.now();
    const times = [m.releaseDate, m.episodeSchedule?.lastAirDate, m.firstAirDate].map((v) => (v ? new Date(v).getTime() : NaN)).filter((x) => Number.isFinite(x) && x <= now);
    return times.length ? Math.max(...times) : NaN;
}

// Priority fill: tier 1 (new) takes as many slots as it has, then tier 2 (popular), then tier 3 (top rated).
function generateHomeBanner(ctx, keepExpiresAt) {
    const hasArt = (i) => i.metadata?.backdrop || i.metadata?.poster;
    const usable = ctx.pool.filter((i) => !isMature(i) && hasArt(i));
    const now = Date.now();
    const votes = (i) => i.metadata?.votes || 0;
    const rating = (i) => i.metadata?.rating || 0;

    const fresh = usable
        .filter((i) => {
            const t = releasedMs(i);
            return Number.isFinite(t) && (now - t) / DAY_MS <= HOME_NEW_DAYS;
        })
        .sort((a, b) => releasedMs(b) - releasedMs(a));
    const popular = usable.filter(isPopular).sort((a, b) => rating(b) * Math.log10(votes(b) + 1) - rating(a) * Math.log10(votes(a) + 1));
    const topRated = usable.filter((i) => rating(i) > 0).sort((a, b) => rating(b) - rating(a) || votes(b) - votes(a));

    const slides = [];
    const used = new Set();
    const take = (list, tier) => {
        for (const i of list) {
            if (slides.length >= HOME_HERO_SLIDES) break;
            if (used.has(i.id)) continue;
            used.add(i.id);
            slides.push({ id: i.id, tier });
        }
    };
    take(fresh, "new");
    take(popular, "popular");
    take(topRated, "top");

    const createdAt = Date.now();
    return {
        createdAt,
        expiresAt: keepExpiresAt ?? createdAt + BANNER_MIN_MS + Math.random() * (BANNER_MAX_MS - BANNER_MIN_MS),
        slides,
    };
}

const homeTag = (tier) => (tier === "new" ? "Latest Released" : tier === "popular" ? "Popular" : "Top Rated");

// Same lifecycle as useRecoHeroBanner: load → show → expire → regenerate (set repaired without resetting the clock).
function useHomeHeroBanner(ctx, ready) {
    const [stored, setStored] = useState(loadHomeBanner);
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 60 * 1000);
        return () => clearInterval(t);
    }, []);

    const poolById = useMemo(() => new Map((ctx?.pool || []).map((i) => [i.id, i])), [ctx]);

    const slides = useMemo(() => {
        if (!stored) return [];
        return stored.slides
            .map((s) => {
                const item = poolById.get(s.id);
                return item ? { ...item, _heroReason: homeTag(s.tier) } : null;
            })
            .filter(Boolean);
    }, [stored, poolById, ctx]);

    // Selection is deterministic → saved set is stale the moment the library's real top-N changes.
    const freshIds = useMemo(
        () =>
            ctx
                ? generateHomeBanner(ctx, 0)
                      .slides.map((s) => s.id)
                      .join("|")
                : null,
        [ctx],
    );
    const stale = !!stored && freshIds != null && stored.slides.map((s) => s.id).join("|") !== freshIds;
    const expired = !stored || now >= stored.expiresAt;
    const broken = !!stored && stored.slides.length >= RECO_HERO_MIN_SLIDES && slides.length < RECO_HERO_MIN_SLIDES;
    const needsNew = ready && !!ctx && (expired || broken || stale);

    useEffect(() => {
        if (!needsNew) return;
        const keep = stored && !expired ? stored.expiresAt : null;
        let alive = true;
        generateRecoBannerVerified(() => generateHomeBanner(ctx, keep), poolById).then((next) => {
            if (!alive) return;
            saveHomeBanner(next);
            setStored(next);
        });
        return () => {
            alive = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [needsNew]);

    return slides;
}

// ═════════════════════════════════════════════════════════════════════════════
// PUBLIC SECTIONS — no props. Use these anywhere.
// ═════════════════════════════════════════════════════════════════════════════

// BANNER 1 · id banner-discover-main · DiscoverPage: after "Top Rated" row
export function DiscoverMainBanner() {
    const { movies, series, anime, categories } = useApi();
    const built = useMemo(() => buildLibrary({ movies, series, anime, categories }), [movies, series, anime, categories]);
    const libIndex = useMemo(() => buildLibraryIndex(movies, series, anime), [movies, series, anime]);
    if (!built.released.length) return null;
    return <DiscoverBanner built={built} libIndex={libIndex} />;
}

function SpotlightWithData() {
    const { movies, series, anime, categories } = useApi();
    const built = useMemo(() => buildLibrary({ movies, series, anime, categories }), [movies, series, anime, categories]);
    return <SpotlightBanner built={built} />;
}

// BANNER 2 · id banner-discover-spotlight · DiscoverPage: after "Powerful Dramas" row (see header)
export function DiscoverSpotlightBanner() {
    return (
        <LazyMount placeholder={<HeroSkeleton id={BANNER_IDS.DISCOVER_SPOTLIGHT} />}>
            <SpotlightWithData />
        </LazyMount>
    );
}

function HorizonWithData() {
    const { movies, series, anime } = useApi();
    const libIndex = useMemo(() => buildLibraryIndex(movies, series, anime), [movies, series, anime]);
    return <HorizonBanner libIndex={libIndex} />;
}

// BANNER 3 · id banner-discover-horizon · DiscoverPage: after "Coming Soon" row
export function DiscoverHorizonBanner() {
    return (
        <LazyMount placeholder={<div id={BANNER_IDS.DISCOVER_HORIZON} className="h-[240px] sm:h-[480px]" />} rootMargin="300px 0px">
            <HorizonWithData />
        </LazyMount>
    );
}

// BANNER 4 · id banner-recommendations-hero · RecommendationsPage: top of page
export function RecommendationsHeroBanner() {
    const { movies, series, anime } = useApi();
    const { isLoading } = useRecommendations();
    const ctx = useMemo(() => {
        const pool = [...(movies || []), ...(series || []), ...(anime || [])];
        if (!pool.length) return null;
        return {
            pool,
            typeById: new Map([...(movies || []).map((i) => [i.id, "movie"]), ...(series || []).map((i) => [i.id, "series"]), ...(anime || []).map((i) => [i.id, "anime"])]),
        };
    }, [movies, series, anime]);
    // Banner builds/refreshes itself (latest releases, 3-day cycle).
    const hero = useRecoHeroBanner(ctx, !isLoading);
    return isLoading && !hero.slides.length ? <HeroSkeleton id={BANNER_IDS.RECO_HERO} /> : <RecoHeroCarousel items={hero.slides} id={BANNER_IDS.RECO_HERO} />;
}

// BANNER 5 · id banner-recommendations-tonights-picks · RecommendationsPage: between "Popular" and "Top Genres"
export function RecommendationsTonightsPicksBanner() {
    const { movies, series, anime } = useApi();
    const [certTick, setCertTick] = useState(0); // bumps when a verified rating turns out restricted
    const candidates = useMemo(() => {
        const pool = [...(movies || []), ...(series || []), ...(anime || [])];
        if (!pool.length) return [];
        const usable = pool.filter((i) => !isMature(i) && i.metadata?.rating && (i.metadata?.backdrop || i.metadata?.poster));
        const votes = (i) => i.metadata.votes || 0;
        const score = (i) => i.metadata.rating * Math.log10(votes(i) + 1);
        const cut = (values, p) => {
            const a = [...values].sort((x, y) => x - y);
            return a.length ? a[Math.floor((a.length - 1) * p)] : 0;
        };
        const ratings = usable.map((i) => i.metadata.rating);
        const allVotes = usable.map(votes);
        const tiers = [
            { tag: "Top Rated · Popular", p: 0.6, floor: 7.5 },
            { tag: "Top Rated · Popular", p: 0.4, floor: 7 },
            { tag: "Top Rated", p: 0.2, floor: 6.5 },
            { tag: null, p: 0, floor: 0 },
        ];
        const seen = new Set();
        const out = [];
        for (const t of tiers) {
            const ratingCut = Math.max(t.floor, cut(ratings, t.p));
            const votesCut = cut(allVotes, t.p);
            const tierPool = usable.filter((i) => i.metadata.rating >= ratingCut && votes(i) >= votesCut).sort((x, y) => score(y) - score(x));
            for (const i of tierPool) {
                if (seen.has(i.id)) continue;
                seen.add(i.id);
                out.push({ ...i, _pickTag: t.tag });
                if (out.length >= PICKS_SHOWN) return out;
            }
        }
        return out;
    }, [movies, series, anime, certTick]);

    // Verify the shown titles' US rating (cached); if one is R/TV-MA, rebuild so the next title replaces it.
    useEffect(() => {
        let alive = true;
        const unknown = candidates.map(certTarget).filter((tg) => tg && !certStore()[`${tg.kind}:${tg.id}`]);
        if (!unknown.length) return;
        Promise.all(unknown.map((tg) => fetchCert(tg.kind, tg.id))).then((cs) => {
            if (alive && cs.some(isBlockedCert)) setCertTick((n) => n + 1);
        });
        return () => {
            alive = false;
        };
    }, [candidates]);

    return <TonightsPicks candidates={candidates} />;
}

// BANNER 6 · id banner-home-hero · Home page: top of page. Priority: latest → popular → top rated (15 slides)
export function HomeHeroBanner() {
    const { movies, series, anime, loading } = useApi();
    const ready = !loading?.media;
    const ctx = useMemo(() => {
        const pool = [...(movies || []), ...(series || []), ...(anime || [])];
        if (!pool.length) return null;
        return {
            pool,
            typeById: new Map([...(movies || []).map((i) => [i.id, "movie"]), ...(series || []).map((i) => [i.id, "series"]), ...(anime || []).map((i) => [i.id, "anime"])]),
        };
    }, [movies, series, anime]);
    const slides = useHomeHeroBanner(ctx, ready);
    if (!slides.length) return ready ? null : <HeroSkeleton id={BANNER_IDS.HOME_HERO} />;
    return <RecoHeroCarousel items={slides} id={BANNER_IDS.HOME_HERO} arrowKeys={false} />;
}

// Generic entry: <Banner id={BANNER_IDS.DISCOVER_MAIN} /> — id only, no data props.
const BANNER_REGISTRY = {
    [BANNER_IDS.DISCOVER_MAIN]: DiscoverMainBanner,
    [BANNER_IDS.DISCOVER_SPOTLIGHT]: DiscoverSpotlightBanner,
    [BANNER_IDS.DISCOVER_HORIZON]: DiscoverHorizonBanner,
    [BANNER_IDS.RECO_HERO]: RecommendationsHeroBanner,
    [BANNER_IDS.RECO_TONIGHTS_PICKS]: RecommendationsTonightsPicksBanner,
    [BANNER_IDS.HOME_HERO]: HomeHeroBanner,
};

export default function Banner({ id }) {
    const Section = BANNER_REGISTRY[id];
    return Section ? <Section /> : null;
}
