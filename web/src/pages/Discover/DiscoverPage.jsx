import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { useApi } from "../../Context/apiContext";
import MediaRow from "../../Components/MediaRow";
import TrailerRow from "../../Components/TrailerRow";
import { useTrailers } from "../../Hooks/useTrailers";
import SeeAllPage from "../../Components/SeeAllPage";
// Banners + the shared TMDB/library data layer live in Banner.jsx (see Components/BANNERS.md).
import {
    DiscoverMainBanner,
    DiscoverSpotlightBanner,
    DiscoverHorizonBanner,
    TMDB_KEY,
    IMG_BASE,
    STUDIOS,
    TMDB_SECTIONS,
    fetchPage,
    buildLibrary,
    buildLibraryIndex,
    langName,
} from "../../Components/Banner";

// Plex-style Discover, no sidebar. All data work lives in this file.
//   • Library rows  → your own media via useApi(); trailers via your TrailerRow + useTrailers()
//   • Upcoming rows → TMDB /discover (studio + popularity), same "Upcoming" card as PersonPage "Coming Up"
//   • "See all"     → /discover?section=<id> → same page swaps to the common SeeAllPage

const ROW_LIMIT = 20;
const NO_SCROLLBAR = { scrollbarWidth: "none", msOverflowStyle: "none", WebkitOverflowScrolling: "touch" };

const PILL = "shrink-0 whitespace-nowrap rounded-full px-5 py-2 text-xs sm:text-[13px] font-semibold transition-colors duration-150 select-none no-underline";
const PILL_IDLE = "bg-white/10 text-white/90 hover:bg-white/20 hover:text-white";
const PILL_ACTIVE = "bg-white text-black";

// ═════════════════════════════════════════════════════════════════════════════
// DATA — library
// ═════════════════════════════════════════════════════════════════════════════
// See-all id → { title, items } for library-backed sections
function resolveLibrarySection(id, built) {
    if (built.sections[id]) return built.sections[id];
    let m = /^decade-(\d+)$/.exec(id);
    if (m && built.decadeMap.has(Number(m[1]))) return { title: `Your ${m[1]}s`, items: built.decadeMap.get(Number(m[1])) };
    m = /^language-(.+)$/.exec(id);
    if (m && built.languageMap.has(m[1])) return { title: langName(m[1]), items: built.languageMap.get(m[1]) };
    return null;
}

// ═════════════════════════════════════════════════════════════════════════════
// DATA — TMDB upcoming (studio + popularity)
// ═════════════════════════════════════════════════════════════════════════════
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
    const { all, sections, genreRows, languageMap, languages, decadeMap, decades } = built;

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
    // BANNER 2 · id banner-discover-spotlight (self-contained, lazy-mounted inside Banner.jsx)
    const spotlight = <DiscoverSpotlightBanner />;

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

                    {/* BANNER 1 · id banner-discover-main */}
                    <DiscoverMainBanner />

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
                    {/* BANNER 3 · id banner-discover-horizon */}
                    <DiscoverHorizonBanner />

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
