import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { useApi } from "../../Context/apiContext";
import MediaRow from "../../Components/MediaRow";
import TrailerRow from "../../Components/TrailerRow";
import { useTrailers } from "../../Hooks/useTrailers";
import SeeAllPage from "../../Components/SeeAllPage";
import { useCountdown } from "../../Components/MediaCard";

// Plex-style Discover, no sidebar. All data work lives in this file.
//   • Library rows  → your own media via useApi(); trailers via your TrailerRow + useTrailers()
//   • Upcoming rows → TMDB /discover (studio + popularity), same "Upcoming" card as PersonPage "Coming Up"
//   • "See all"     → /discover?section=<id> → same page swaps to the common SeeAllPage

const TMDB_KEY = import.meta.env.VITE_TMDB_API_KEY;
const TMDB_BASE = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p";

const ROW_LIMIT = 20;
const DISCOVER_BANNER_KEY = "flux.discoverBanner.v7";
const DISCOVER_BANNER_SLIDES = 15; // main banner: lots of upcoming + a few library picks
const DISCOVER_MAX_UPCOMING = 11; // …of which at most this many are upcoming
const SPOTLIGHT_BANNER_KEY = "flux.discoverSpotlight.v6";
const SPOTLIGHT_BANNER_SLIDES = 15;
const DISCOVER_MIN_SLIDES = 10; // every banner on this page shows at least this many (when the data allows)
const UNRELEASED_STATUS = new Set(["Rumored", "Planned", "In Production", "Post Production"]);
const NO_SCROLLBAR = { scrollbarWidth: "none", msOverflowStyle: "none", WebkitOverflowScrolling: "touch" };

const PILL = "shrink-0 whitespace-nowrap rounded-full px-5 py-2 text-xs sm:text-[13px] font-semibold transition-colors duration-150 select-none no-underline";
const PILL_IDLE = "bg-white/10 text-white/90 hover:bg-white/20 hover:text-white";
const PILL_ACTIVE = "bg-white text-black";

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
function langName(code) {
    try {
        _dn ||= new Intl.DisplayNames(["en"], { type: "language" });
        return _dn.of(code) || code.toUpperCase();
    } catch {
        return String(code).toUpperCase();
    }
}

// Everything UNSLICED — rows slice, See all shows it all.
function buildLibrary({ movies = [], series = [], anime = [], categories = [] }) {
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

// See-all id → { title, items } for library-backed sections
function resolveLibrarySection(id, built) {
    if (built.sections[id]) return built.sections[id];
    let m = /^decade-(\d+)$/.exec(id);
    if (m && built.decadeMap.has(Number(m[1]))) return { title: `Your ${m[1]}s`, items: built.decadeMap.get(Number(m[1])) };
    m = /^language-(.+)$/.exec(id);
    if (m && built.languageMap.has(m[1])) return { title: langName(m[1]), items: built.languageMap.get(m[1]) };
    return null;
}

// "movie:<tmdbId>" / "tv:<tmdbId>" → { id, raw } for everything the user owns (same as PersonPage)
function buildLibraryIndex(movies = [], series = [], anime = []) {
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
const STUDIOS = [
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
const TMDB_SECTIONS = {
    "coming-soon": { title: "Coming Soon", kind: "movie", from: 0, to: 60 },
    "upcoming-blockbusters": { title: "Upcoming Blockbusters", kind: "movie", from: 0, companies: MAJORS },
    "highly-anticipated": { title: "Highly Anticipated Movies", kind: "movie", from: 0 },
    "upcoming-shows": { title: "Upcoming Shows", kind: "tv", from: 0 },
    ...Object.fromEntries(STUDIOS.map((s) => [`studio-${s.slug}`, { title: `Upcoming from ${s.name}`, kind: "movie", from: 0, companies: String(s.company) }])),
};

const pageCache = new Map();
function fetchPage(id, page) {
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

function useTmdbSection(id, pages = 1) {
    const active = Boolean(id && TMDB_SECTIONS[id] && TMDB_KEY);
    const [state, setState] = useState({ results: [], loading: active, hasMore: false });

    useEffect(() => {
        if (!active) {
            setState({ results: [], loading: false, hasMore: false });
            return;
        }
        let alive = true;
        setState((s) => ({ ...s, loading: true }));
        Promise.all(Array.from({ length: pages }, (_, i) => fetchPage(id, i + 1))).then((list) => {
            if (!alive) return;
            const seen = new Set();
            const results = [];
            for (const l of list) for (const r of l.results) if (!seen.has(r.id)) (seen.add(r.id), results.push(r));
            setState({ results, loading: false, hasMore: (list[list.length - 1]?.total_pages || 0) > pages });
        });
        return () => {
            alive = false;
        };
    }, [id, pages, active]);

    return state;
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

// TMDB results → MediaCard items (PersonPage "Coming Up" shape). Owned → real library item.
// Not owned → fake "tmdb-<movie|tv>-<id>" item with the Upcoming badge + countdown (_release).
function toCards(results, kind, libIndex) {
    const out = [];
    for (const c of results) {
        if (!c.poster_path) continue;
        const lib = libIndex.get(`${kind}:${c.id}`);
        if (lib) {
            out.push(lib.raw);
            continue;
        }
        const date = c.release_date || c.first_air_date || "";
        const title = c.title || c.name || "Untitled";
        const year = date ? parseInt(date.slice(0, 4), 10) : null;
        const rating = c.vote_average ? Math.round(c.vote_average * 10) / 10 : null;
        const metadata = { title, year, poster: `${IMG_BASE}/w342${c.poster_path}`, rating };
        const base = { _badge: "Upcoming", _badgeTone: "glass", _badgeDot: true, _release: date };
        out.push(
            kind === "tv"
                ? { id: `tmdb-tv-${c.id}`, seriesKey: `tmdb-tv-${c.id}`, title, type: "series", metadata, ...base }
                : { id: `tmdb-movie-${c.id}`, name: title, type: "movie", parsed: { type: "movie", title, year }, metadata, streamUrl: null, ...base },
        );
    }
    return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// UI
// ═════════════════════════════════════════════════════════════════════════════
// TMDB-backed row. MediaRow hides itself when empty; < 3 titles counts as empty.
function UpcomingRow({ id, libIndex, viewAllTo }) {
    const def = TMDB_SECTIONS[id];
    const { results, loading } = useTmdbSection(id);
    const items = useMemo(() => toCards(results, def.kind, libIndex), [results, def.kind, libIndex]);
    return <MediaRow title={def.title} items={items.length >= 3 ? items.slice(0, ROW_LIMIT) : []} loading={loading} viewAllTo={viewAllTo} />;
}

// TMDB See all — first 2 pages, "Load more" adds one page at a time
function UpcomingSeeAll({ id, libIndex, onBack }) {
    const def = TMDB_SECTIONS[id];
    const [pages, setPages] = useState(2);
    const { results, loading, hasMore } = useTmdbSection(id, pages);
    const items = useMemo(() => toCards(results, def.kind, libIndex), [results, def.kind, libIndex]);
    return (
        <SeeAllPage
            title={def.title}
            items={items}
            loading={loading && items.length === 0}
            moreLoading={loading && items.length > 0}
            hasMore={hasMore}
            onLoadMore={() => setPages((p) => p + 1)}
            onBack={onBack}
            emptyText={TMDB_KEY ? "Nothing announced right now." : "Set VITE_TMDB_API_KEY in web/.env to load upcoming titles."}
        />
    );
}

function PillSection({ title, children }) {
    return (
        <section>
            <h2 className="mb-3 text-base font-semibold leading-tight text-base-content sm:text-lg">{title}</h2>
            <div className="flex flex-nowrap gap-2 overflow-x-auto overflow-y-hidden pb-2" style={NO_SCROLLBAR}>
                {children}
            </div>
        </section>
    );
}

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

// Adds the release day to the user's calendar (downloads an .ics all-day event).
function addToCalendar(item) {
    const day = (item._release || "").replace(/-/g, "");
    if (day.length !== 8) return;
    const next = new Date(releaseTime(item._release));
    next.setDate(next.getDate() + 1);
    const end = `${next.getFullYear()}${String(next.getMonth() + 1).padStart(2, "0")}${String(next.getDate()).padStart(2, "0")}`;
    const title = (item.metadata?.title || item.title || "Release").replace(/[\\,;]/g, (c) => `\\${c}`);
    const ics = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//FLUX//Discover//EN",
        "BEGIN:VEVENT",
        `UID:${item.id}@flux`,
        `DTSTAMP:${new Date().toISOString().replace(/[-:]|\.\d{3}/g, "")}`,
        `DTSTART;VALUE=DATE:${day}`,
        `DTEND;VALUE=DATE:${end}`,
        `SUMMARY:${title} releases`,
        "END:VEVENT",
        "END:VCALENDAR",
    ].join("\r\n");
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${item.id}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

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
// BANNER — built into this page (no separate component file)
// ═════════════════════════════════════════════════════════════════════════════
// Self-managing hero banner: saves the picked set in localStorage with a random
// 3–7 day lifetime, shows it until it expires, then calls pickDiscoverBanner()
// again (avoiding last set's titles). If media leaves the library the set is
// repaired without resetting the clock. Click a slide → /media/:id ; Play →
// player (movie) or details with the first season selected (series).

const DAY_MS = 24 * 60 * 60 * 1000;
const BANNER_MIN_MS = 3 * DAY_MS; // banner lives at least 3 days...
const BANNER_MAX_MS = 7 * DAY_MS; // ...and at most 7 (random in between)
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
            // Expired → brand-new 3–7 day cycle. Broken (media removed) → repair the set, keep the clock.
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
function HeroSkeleton() {
    return <div className={`${HERO_SIZE} rounded-xl sm:rounded-2xl bg-base-300 animate-pulse`} />;
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
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    addToCalendar(item);
                                }}
                                title="Add the release day to your calendar"
                                className="inline-flex cursor-pointer items-center rounded-md border border-white/30 bg-black/30 px-3 py-1.5 text-[11px] font-semibold text-white transition-all duration-300 hover:-translate-y-0.5 hover:bg-black/50 active:scale-95 sm:px-4 sm:py-2 sm:text-sm">
                                <span className="mr-1.5">＋</span>Remind me
                            </button>
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
function HeroCarousel({ items, variant = "default" }) {
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
        <div>
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
    if (!slides.length) return ready ? null : <HeroSkeleton />;
    return <HeroCarousel items={slides} />;
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
        <section>
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
        <h2 aria-label={text} className="flex flex-wrap gap-x-[0.28em] text-2xl font-bold leading-tight text-white sm:text-4xl">
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

function HorizonText({ item, out, trailerKey }) {
    return (
        <div
            className={`flex flex-col gap-2 sm:gap-3 ${out ? "pointer-events-none absolute inset-x-0 bottom-0" : ""}`}
            style={{
                opacity: out ? 0 : 1,
                transform: out ? "translate3d(0,-14px,0)" : "translate3d(0,0,0)",
                filter: out ? "blur(6px)" : "blur(0px)",
                transition: out ? `opacity ${HORIZON_SLIDE_MS * 0.6}ms ${SLIDE_EASE}, transform ${HORIZON_SLIDE_MS * 0.6}ms ${SLIDE_EASE}, filter ${HORIZON_SLIDE_MS * 0.6}ms ${SLIDE_EASE}` : "none",
            }}>
            <Rise n={0}>
                <p className="text-xs font-semibold text-primary sm:text-sm">
                    {fmtDate(item._release)} · {relativeIn(item._release)}
                </p>
            </Rise>
            <TitleReveal text={item.title} />
            {item.metadata.rating != null && (
                <Rise n={2}>
                    <p className="text-xs font-medium text-white sm:text-sm">★ {item.metadata.rating.toFixed(1)}</p>
                </Rise>
            )}
            <Rise n={3} className="hidden sm:block">
                <p className="line-clamp-2 max-w-lg text-sm text-white/90">{item.metadata.overview}</p>
            </Rise>
            <Rise n={4}>
                <LiveCountdown iso={item._release} />
            </Rise>
            <Rise n={5}>
                <div className="mt-1 flex flex-wrap gap-2">
                    {trailerKey && (
                        <a
                            href={`https://www.youtube.com/watch?v=${trailerKey}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center rounded-md bg-white px-3.5 py-1.5 text-xs font-semibold text-black transition-all duration-300 hover:-translate-y-0.5 active:scale-95 sm:py-2 sm:text-sm">
                            <span className="mr-1.5">▶</span>Watch trailer
                        </a>
                    )}
                    <Link
                        to={`/media/${encodeURIComponent(item.id)}`}
                        className="inline-flex items-center rounded-md bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-content transition-all duration-300 hover:-translate-y-0.5 active:scale-95 sm:py-2 sm:text-sm">
                        Details
                    </Link>
                    <button
                        type="button"
                        onClick={() => addToCalendar(item)}
                        className="inline-flex cursor-pointer items-center rounded-md border border-white/30 bg-black/30 px-3.5 py-1.5 text-xs font-semibold text-white transition-all duration-300 hover:-translate-y-0.5 hover:bg-black/50 active:scale-95 sm:py-2 sm:text-sm">
                        <span className="mr-1.5">＋</span>Remind me
                    </button>
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
    },
});

function HorizonBanner({ libIndex }) {
    const { data, loading } = useTmdbMany(HORIZON_IDS);
    const [idx, setIdx] = useState(0);
    const [hovered, setHovered] = useState(false);
    const [held, setHeld] = useState(false);
    const [trailers, setTrailers] = useState({});
    const [stack, setStack] = useState([]);
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
    }, [data, libIndex]);

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
        if (count <= 1 || hovered || held) return;
        const timer = setInterval(() => {
            if (document.hidden || !inViewRef.current) return;
            setIdx((i) => (i + 1) % count);
        }, HORIZON_AUTOPLAY_MS);
        return () => clearInterval(timer);
    }, [count, idx, hovered, held]);

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
            className="relative flex min-h-[420px] cursor-grab touch-pan-y select-none flex-col overflow-hidden rounded-xl bg-base-300 outline-none focus-visible:ring-2 focus-visible:ring-primary active:cursor-grabbing sm:min-h-[480px] sm:rounded-2xl">
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

            <div className="relative z-10 flex flex-1 flex-col justify-end px-4 pb-4 pt-16 sm:px-8 sm:pb-6 sm:pt-20" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.85), 0 2px 14px rgba(0,0,0,0.55)" }}>
                <div className="relative max-w-xl">
                    {stack.map((l) => (
                        <HorizonText key={l.id} item={l.item} out={l.out} trailerKey={trailers[l.item.tmdbId]} />
                    ))}
                </div>
            </div>

            {count > 1 && (
                <div ref={railRef} data-rail className="relative z-20 cursor-default overflow-x-auto px-3 pb-3 pt-2 sm:px-6 sm:pb-5" style={NO_SCROLLBAR} role="tablist" aria-label="Release timeline">
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
        </section>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// PAGE
// ═════════════════════════════════════════════════════════════════════════════
const DiscoverPage = () => {
    const { pathname } = useLocation();
    const [params, setParams] = useSearchParams();
    const { movies, series, anime, categories, loading } = useApi();
    const { discoverTrailers, loading: trailersLoading } = useTrailers();

    const [decade, setDecade] = useState(null);
    const [language, setLanguage] = useState(null);

    const section = params.get("section");

    useEffect(() => {
        document.title = "Discover · FLUX";
    }, []);
    useEffect(() => {
        window.scrollTo(0, 0);
    }, [section]);

    // Same as Home: one discover feed, two orderings. Backend order = Trending; "New" = newest trailer first.
    const newTrailers = useMemo(
        () => [...discoverTrailers].sort((a, b) => new Date(b.trailerPublishedAt || b.releaseDate || 0) - new Date(a.trailerPublishedAt || a.releaseDate || 0)),
        [discoverTrailers],
    );

    const built = useMemo(() => buildLibrary({ movies, series, anime, categories }), [movies, series, anime, categories]);
    const libIndex = useMemo(() => buildLibraryIndex(movies, series, anime), [movies, series, anime]);
    const { all, released, sections, genreRows, languageMap, languages, decadeMap, decades } = built;

    const seeAll = (id) => `${pathname}?section=${id}`;
    const closeSeeAll = () => setParams({}, { replace: false });

    const isLoading = Boolean(loading?.media) && all.length === 0;

    // ── See all view ─────────────────────────────────────────────────────────
    if (section) {
        if (TMDB_SECTIONS[section]) return <UpcomingSeeAll id={section} libIndex={libIndex} onBack={closeSeeAll} />;
        const lib = resolveLibrarySection(section, built);
        return <SeeAllPage title={lib?.title || "Not found"} items={lib?.items || []} loading={isLoading} onBack={closeSeeAll} emptyText={lib ? "Nothing here yet." : "This section doesn't exist."} />;
    }

    // ── Discover ─────────────────────────────────────────────────────────────
    // Spotlight banner goes right after the "Powerful Dramas" (Drama) row. No Drama row → after the
    // 2nd genre row; no genre rows at all → after "Critically Acclaimed".
    const dramaIdx = genreRows.findIndex((g) => g.name === "Drama");
    const spotAfter = genreRows.length ? (dramaIdx >= 0 ? dramaIdx : Math.min(1, genreRows.length - 1)) : -1;
    const spotlight = (
        <LazyMount placeholder={<HeroSkeleton />}>
            <SpotlightBanner built={built} />
        </LazyMount>
    );

    const libRow = (id, extra) => <MediaRow title={sections[id].title} items={sections[id].items.slice(0, ROW_LIMIT)} viewAllTo={seeAll(id)} {...extra} />;

    return (
        <div className="space-y-8 sm:space-y-10">
            {isLoading && (
                <>
                    <MediaRow loading />
                    <MediaRow loading />
                    <MediaRow loading />
                </>
            )}

            {!isLoading && all.length === 0 && <p className="text-sm text-base-content/50">Your library is empty. Add a folder in Settings to start.</p>}

            {!isLoading && all.length > 0 && (
                <>
                    {libRow("top-rated")}

                    {released.length > 0 && <DiscoverBanner built={built} libIndex={libIndex} />}

                    <TrailerRow title="Trending Trailers" items={discoverTrailers} loading={trailersLoading} />
                    <TrailerRow title="New Trailers" items={newTrailers} loading={trailersLoading} />

                    {libRow("best-series")}

                    {genreRows[0] && <MediaRow title={genreRows[0].title} items={genreRows[0].items.slice(0, ROW_LIMIT)} viewAllTo={`/category/${encodeURIComponent(genreRows[0].name)}`} />}
                    {spotAfter === 0 && spotlight}

                    {libRow("recently-added")}
                    {libRow("acclaimed")}
                    {spotAfter === -1 && spotlight}

                    {genreRows[1] && <MediaRow title={genreRows[1].title} items={genreRows[1].items.slice(0, ROW_LIMIT)} viewAllTo={`/category/${encodeURIComponent(genreRows[1].name)}`} />}
                    {spotAfter === 1 && spotlight}

                    <UpcomingRow id="coming-soon" libIndex={libIndex} viewAllTo={seeAll("coming-soon")} />
                    <LazyMount placeholder={<div className="h-[420px] sm:h-[480px]" />} rootMargin="300px 0px">
                        <HorizonBanner libIndex={libIndex} />
                    </LazyMount>

                    {categories?.length > 0 && (
                        <PillSection title="Browse by Genre">
                            {categories.map((cat) => (
                                <Link key={cat.name} to={`/category/${encodeURIComponent(cat.name)}`} className={`${PILL} ${PILL_IDLE}`}>
                                    {cat.name}
                                </Link>
                            ))}
                        </PillSection>
                    )}

                    {libRow("this-week-in-history")}

                    <UpcomingRow id="upcoming-blockbusters" libIndex={libIndex} viewAllTo={seeAll("upcoming-blockbusters")} />

                    {languages.length > 1 && (
                        <div className="space-y-4">
                            <PillSection title="Browse by Language">
                                {languages.map((code) => (
                                    <button
                                        key={code}
                                        type="button"
                                        onClick={() => setLanguage(language === code ? null : code)}
                                        aria-pressed={language === code}
                                        className={`${PILL} cursor-pointer ${language === code ? PILL_ACTIVE : PILL_IDLE}`}>
                                        {langName(code)}
                                    </button>
                                ))}
                            </PillSection>
                            {language && languageMap.has(language) && (
                                <MediaRow title={langName(language)} items={languageMap.get(language).slice(0, ROW_LIMIT)} viewAllTo={seeAll(`language-${language}`)} />
                            )}
                        </div>
                    )}

                    {libRow("family")}

                    {decades.length > 0 && (
                        <div className="space-y-4">
                            <PillSection title="Browse by Decade">
                                {decades.map((d) => (
                                    <button
                                        key={d}
                                        type="button"
                                        onClick={() => setDecade(decade === d ? null : d)}
                                        aria-pressed={decade === d}
                                        className={`${PILL} cursor-pointer ${decade === d ? PILL_ACTIVE : PILL_IDLE}`}>
                                        {d}s
                                    </button>
                                ))}
                            </PillSection>
                            {decade && decadeMap.has(decade) && <MediaRow title={`Your ${decade}s`} items={decadeMap.get(decade).slice(0, ROW_LIMIT)} viewAllTo={seeAll(`decade-${decade}`)} />}
                        </div>
                    )}

                    <LazyMount>
                        <UpcomingRow id="highly-anticipated" libIndex={libIndex} viewAllTo={seeAll("highly-anticipated")} />
                    </LazyMount>
                    {STUDIOS.map((s) => (
                        <LazyMount key={s.slug}>
                            <UpcomingRow id={`studio-${s.slug}`} libIndex={libIndex} viewAllTo={seeAll(`studio-${s.slug}`)} />
                        </LazyMount>
                    ))}
                    <LazyMount>
                        <UpcomingRow id="upcoming-shows" libIndex={libIndex} viewAllTo={seeAll("upcoming-shows")} />
                    </LazyMount>
                </>
            )}
        </div>
    );
};

export default DiscoverPage;
