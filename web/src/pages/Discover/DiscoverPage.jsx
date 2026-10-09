import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { useApi } from "../../Context/apiContext";
import MediaRow from "../../Components/MediaRow";
import TrailerRow from "../../Components/TrailerRow";
import { useTrailers } from "../../Hooks/useTrailers";
import SeeAllPage from "../../Components/SeeAllPage";

// Plex-style Discover, no sidebar. All data work lives in this file.
//   • Library rows  → your own media via useApi(); trailers via your TrailerRow + useTrailers()
//   • Upcoming rows → TMDB /discover (studio + popularity), same "Upcoming" card as PersonPage "Coming Up"
//   • "See all"     → /discover?section=<id> → same page swaps to the common SeeAllPage

const TMDB_KEY = import.meta.env.VITE_TMDB_API_KEY;
const TMDB_BASE = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p";

const ROW_LIMIT = 20;
const BANNER_KEY = "flux-discover-banner-hidden";
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

// Plex's "Find What To Watch, Anywhere!" card, pointed at your own library
function FindBanner({ onSurprise, onDismiss }) {
    return (
        <section className="rounded-xl bg-base-200 px-5 py-8 text-center ring-1 ring-white/5">
            <h2 className="text-xl font-bold text-base-content sm:text-2xl">Find What To Watch, In Your Library!</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-base-content/60">Can&apos;t decide? One click picks something from your library, or keep scrolling to browse.</p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <button type="button" onClick={onSurprise} className="cursor-pointer rounded-full bg-white px-5 py-2 text-xs font-semibold text-black transition-colors hover:bg-white/90">
                    Surprise Me
                </button>
                <button type="button" onClick={onDismiss} className="cursor-pointer rounded-full bg-white/10 px-5 py-2 text-xs font-semibold text-base-content transition-colors hover:bg-white/20">
                    Don&apos;t show this again
                </button>
            </div>
        </section>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// PAGE
// ═════════════════════════════════════════════════════════════════════════════
const DiscoverPage = () => {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const [params, setParams] = useSearchParams();
    const { movies, series, anime, categories, loading } = useApi();
    const { discoverTrailers, loading: trailersLoading } = useTrailers();

    const [decade, setDecade] = useState(null);
    const [language, setLanguage] = useState(null);
    const [bannerHidden, setBannerHidden] = useState(() => {
        try {
            return localStorage.getItem(BANNER_KEY) === "1";
        } catch {
            return false;
        }
    });

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

    const dismissBanner = () => {
        setBannerHidden(true);
        try {
            localStorage.setItem(BANNER_KEY, "1");
        } catch {
            /* storage blocked — hides for this visit only */
        }
    };
    const surprise = () => {
        if (!released.length) return;
        const pick = released[Math.floor(Math.random() * released.length)];
        navigate(`/media/${encodeURIComponent(keyOf(pick))}`);
    };

    const isLoading = Boolean(loading?.media) && all.length === 0;

    // ── See all view ─────────────────────────────────────────────────────────
    if (section) {
        if (TMDB_SECTIONS[section]) return <UpcomingSeeAll id={section} libIndex={libIndex} onBack={closeSeeAll} />;
        const lib = resolveLibrarySection(section, built);
        return <SeeAllPage title={lib?.title || "Not found"} items={lib?.items || []} loading={isLoading} onBack={closeSeeAll} emptyText={lib ? "Nothing here yet." : "This section doesn't exist."} />;
    }

    // ── Discover ─────────────────────────────────────────────────────────────
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

                    {!bannerHidden && released.length > 0 && <FindBanner onSurprise={surprise} onDismiss={dismissBanner} />}

                    <TrailerRow title="Trending Trailers" items={discoverTrailers} loading={trailersLoading} />
                    <TrailerRow title="New Trailers" items={newTrailers} loading={trailersLoading} />

                    {libRow("best-series")}

                    {genreRows[0] && <MediaRow title={genreRows[0].title} items={genreRows[0].items.slice(0, ROW_LIMIT)} viewAllTo={`/category/${encodeURIComponent(genreRows[0].name)}`} />}

                    {libRow("recently-added")}
                    {libRow("acclaimed")}

                    {genreRows[1] && <MediaRow title={genreRows[1].title} items={genreRows[1].items.slice(0, ROW_LIMIT)} viewAllTo={`/category/${encodeURIComponent(genreRows[1].name)}`} />}

                    <UpcomingRow id="coming-soon" libIndex={libIndex} viewAllTo={seeAll("coming-soon")} />

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

                    <UpcomingRow id="highly-anticipated" libIndex={libIndex} viewAllTo={seeAll("highly-anticipated")} />
                    {STUDIOS.map((s) => (
                        <UpcomingRow key={s.slug} id={`studio-${s.slug}`} libIndex={libIndex} viewAllTo={seeAll(`studio-${s.slug}`)} />
                    ))}
                    <UpcomingRow id="upcoming-shows" libIndex={libIndex} viewAllTo={seeAll("upcoming-shows")} />
                </>
            )}
        </div>
    );
};

export default DiscoverPage;
