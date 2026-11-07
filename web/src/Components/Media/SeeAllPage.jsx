import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, ChevronDown, Film, SlidersHorizontal, Check } from "lucide-react";
import MediaCard from "./MediaCard";

// Common "See all" view. Pure UI — the parent page owns the data.
//   title        — section heading
//   items        — MediaCard items (library items or tmdb-* upcoming items)
//   loading      — first load in progress
//   hasMore      — parent can fetch more (TMDB paging)
//   moreLoading  — parent is fetching the next page
//   onLoadMore   — () => void, called when everything already loaded is shown
//   onBack       — () => void; renders a Close button (top-right) when provided
//   fullscreen   — bool; page owns its own padding (use inside a fixed overlay)
//   emptyText    — text when there is nothing at all
//
// Extras: grid size (S/M/L, remembered), A–Z jump bar when sorted by title,
// auto-load on scroll for the list already in memory (button only for remote paging),
// genre search when the list has many genres.
//
// Layout
//   Header ........ title · counts · search · sort · close
//   Desktop (lg+) . filter sidebar (Type / Rating / Decade / Genre) + results
//   Mobile ........ "Filters" button → bottom sheet with the same sections
//   Results bar ... result count · removable filter pills · clear all
const PAGE = 60;
const GENRE_COLLAPSED = 8;

const SORTS = [
    { id: "relevance", label: "Relevance" },
    { id: "title", label: "Title A–Z" },
    { id: "newest", label: "Newest first" },
    { id: "oldest", label: "Oldest first" },
    { id: "rating", label: "Top rated" },
];
const RATINGS = [
    { v: 0, label: "Any" },
    { v: 6, label: "6+" },
    { v: 7, label: "7+" },
    { v: 8, label: "8+" },
];

const DENSITY = {
    s: {
        label: "S",
        name: "Small posters",
        side: "grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8",
        full: "grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-9",
    },
    m: {
        label: "M",
        name: "Medium posters",
        side: "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6",
        full: "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7",
    },
    l: {
        label: "L",
        name: "Large posters",
        side: "grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5",
        full: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6",
    },
};
const DENSITY_KEY = "flux.seeall.density";
const readDensity = () => {
    try {
        const v = localStorage.getItem(DENSITY_KEY);
        return DENSITY[v] ? v : "m";
    } catch {
        return "m";
    }
};
const letterOf = (it) => {
    const c = titleOf(it).trim().charAt(0).toUpperCase();
    return /[A-Z]/.test(c) ? c : "#";
};

const titleOf = (it) => it.metadata?.title || it.parsed?.title || it.title || it.name || "";
const yearOf = (it) => it.metadata?.year ?? it.parsed?.year ?? it.year ?? 0;
const ratingOf = (it) => it.metadata?.rating ?? it.rating ?? 0;
const typeOf = (it) => (it.parsed?.type === "movie" || it.type === "movie" ? "movie" : "series");
const genresOf = (it) => (it.metadata?.genres?.length ? it.metadata.genres : it.category || []);

// ─── Building blocks ──────────────────────────────────────────────────────────
function FilterSection({ title, children, defaultOpen = true }) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <section className="border-b border-white/6 py-4 first:pt-0 last:border-b-0 last:pb-0">
            <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full cursor-pointer items-center justify-between text-left">
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-base-content/55">{title}</span>
                <ChevronDown size={14} className={`text-base-content/40 transition-transform duration-200 ${open ? "" : "-rotate-90"}`} />
            </button>
            {open && <div className="mt-3">{children}</div>}
        </section>
    );
}

// Radio-style row (single choice)
function OptionRow({ active, onClick, label, count }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={`flex w-full cursor-pointer items-center justify-between rounded-lg px-2.5 py-2.5 text-sm lg:py-1.5 transition-colors ${
                active ? "bg-primary/12 font-semibold text-primary" : "text-base-content/75 hover:bg-base-300/60 hover:text-base-content"
            }`}>
            <span>{label}</span>
            {count != null && <span className={`text-xs tabular-nums ${active ? "text-primary/70" : "text-base-content/40"}`}>{count}</span>}
        </button>
    );
}

// Checkbox row (multi choice)
function CheckRow({ checked, onClick, label, count }) {
    return (
        <button
            type="button"
            onClick={onClick}
            role="checkbox"
            aria-checked={checked}
            className="group flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-sm lg:py-1.5 transition-colors hover:bg-base-300/60">
            <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${checked ? "border-primary bg-primary" : "border-white/20 group-hover:border-white/40"}`}>
                {checked && <Check size={11} strokeWidth={3} className="text-primary-content" />}
            </span>
            <span className={`flex-1 truncate text-left ${checked ? "font-semibold text-base-content" : "text-base-content/75"}`}>{label}</span>
            <span className="text-xs tabular-nums text-base-content/40">{count}</span>
        </button>
    );
}

function Chip({ active, onClick, children }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={`cursor-pointer rounded-lg border px-3.5 py-2 text-xs font-semibold lg:px-3 lg:py-1.5 transition-colors ${
                active ? "border-primary bg-primary text-primary-content" : "border-white/10 bg-base-100/40 text-base-content/75 hover:border-white/25 hover:text-base-content"
            }`}>
            {children}
        </button>
    );
}

function Pill({ children, onRemove }) {
    return (
        <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-white/10 bg-base-200 py-1 pl-2.5 pr-1 text-xs font-medium text-base-content/85">
            {children}
            <button
                type="button"
                onClick={onRemove}
                aria-label="Remove filter"
                className="flex h-4.5 w-4.5 cursor-pointer items-center justify-center rounded text-base-content/50 hover:bg-base-300 hover:text-base-content">
                <X size={11} />
            </button>
        </span>
    );
}

function SkeletonGrid({ n = 12, cls }) {
    return (
        <div className={cls}>
            {Array.from({ length: n }).map((_, i) => (
                <div key={i}>
                    <div className="aspect-[2/3] animate-pulse rounded-xl bg-base-300" />
                    <div className="mt-2 h-3 w-3/4 animate-pulse rounded bg-base-300" />
                    <div className="mt-1.5 h-2.5 w-1/2 animate-pulse rounded bg-base-300" />
                </div>
            ))}
        </div>
    );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function SeeAllPage({ title, items = [], loading = false, hasMore = false, moreLoading = false, onLoadMore, onBack, fullscreen = false, emptyText = "Nothing here yet." }) {
    const [q, setQ] = useState("");
    const [sort, setSort] = useState("relevance");
    const [type, setType] = useState("all");
    const [genres, setGenres] = useState([]);
    const [minRating, setMinRating] = useState(0);
    const [decade, setDecade] = useState(null);
    const [visible, setVisible] = useState(PAGE);
    const [allGenres, setAllGenres] = useState(false);
    const [sheet, setSheet] = useState(false);
    const [genreQ, setGenreQ] = useState("");
    const [density, setDensity] = useState(readDensity);
    const searchRef = useRef(null);
    const sentinelRef = useRef(null);
    const pendingLetter = useRef(null);

    const changeDensity = (d) => {
        setDensity(d);
        try {
            localStorage.setItem(DENSITY_KEY, d);
        } catch {
            /* storage unavailable — keep in memory only */
        }
    };

    useEffect(() => {
        window.scrollTo(0, 0);
    }, [title]);

    useEffect(() => {
        setVisible(PAGE);
    }, [q, sort, type, genres, minRating, decade]);

    // "/" jumps to search
    useEffect(() => {
        const onKey = (e) => {
            if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
            const tag = e.target?.tagName;
            if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable) return;
            e.preventDefault();
            searchRef.current?.focus();
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, []);

    // ── Facets (computed once from the full list) ──
    const facets = useMemo(() => {
        const typeC = { movie: 0, series: 0 };
        const gMap = new Map();
        const dMap = new Map();
        let anyRating = false;
        for (const it of items) {
            typeC[typeOf(it)]++;
            for (const g of new Set(genresOf(it))) gMap.set(g, (gMap.get(g) || 0) + 1);
            const y = yearOf(it);
            if (y > 0) {
                const d = Math.floor(y / 10) * 10;
                dMap.set(d, (dMap.get(d) || 0) + 1);
            }
            if (ratingOf(it) > 0) anyRating = true;
        }
        return {
            typeC,
            genreList: [...gMap.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
            decadeList: [...dMap.entries()].sort((a, b) => b[0] - a[0]).map(([d, count]) => ({ d, count })),
            anyRating,
        };
    }, [items]);

    const showTypes = facets.typeC.movie > 0 && facets.typeC.series > 0;
    const showGenres = facets.genreList.length > 1;
    const showDecades = facets.decadeList.length > 1;
    const showRating = facets.anyRating;
    const hasFacets = showTypes || showGenres || showDecades || showRating;
    const genreSearchable = facets.genreList.length > 12;
    const genreNeedle = genreQ.trim().toLowerCase();
    const genresShown = genreNeedle ? facets.genreList.filter((g) => g.name.toLowerCase().includes(genreNeedle)) : allGenres ? facets.genreList : facets.genreList.slice(0, GENRE_COLLAPSED);

    const needle = q.trim().toLowerCase();
    const facetCount = (type !== "all" ? 1 : 0) + genres.length + (minRating ? 1 : 0) + (decade != null ? 1 : 0);
    const filtersActive = Boolean(needle) || facetCount > 0;

    const filtered = useMemo(() => {
        let list = items;
        if (needle) list = list.filter((it) => titleOf(it).toLowerCase().includes(needle));
        if (type !== "all") list = list.filter((it) => typeOf(it) === type);
        if (genres.length) list = list.filter((it) => genres.every((g) => genresOf(it).includes(g)));
        if (minRating) list = list.filter((it) => ratingOf(it) >= minRating);
        if (decade != null) list = list.filter((it) => yearOf(it) >= decade && yearOf(it) < decade + 10);
        if (sort === "relevance") return list;
        const out = [...list];
        if (sort === "title") out.sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
        if (sort === "newest") out.sort((a, b) => yearOf(b) - yearOf(a));
        if (sort === "oldest") out.sort((a, b) => (yearOf(a) || 9999) - (yearOf(b) || 9999));
        if (sort === "rating") out.sort((a, b) => ratingOf(b) - ratingOf(a));
        return out;
    }, [items, needle, type, genres, minRating, decade, sort]);

    const shown = filtered.slice(0, visible);
    const localMore = filtered.length > visible;
    const remoteMore = !localMore && hasMore && !filtersActive;

    // A–Z jump bar (only while sorted by title)
    const letterIndex = useMemo(() => {
        if (sort !== "title") return null;
        const m = new Map();
        filtered.forEach((it, i) => {
            const l = letterOf(it);
            if (!m.has(l)) m.set(l, i);
        });
        return m;
    }, [filtered, sort]);
    const showLetters = letterIndex && filtered.length > 24;

    const jumpTo = (letter) => {
        const idx = letterIndex.get(letter);
        if (idx == null) return;
        pendingLetter.current = letter;
        if (idx >= visible) setVisible(idx + PAGE);
        // wait a tick so newly revealed cards are in the DOM
        setTimeout(() => {
            document.getElementById(`seeall-${letter}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
            pendingLetter.current = null;
        }, 60);
    };

    // Auto-load the next local batch when the bottom of the grid nears the viewport
    useEffect(() => {
        const el = sentinelRef.current;
        if (!el || !localMore) return;
        const io = new IntersectionObserver((entries) => entries[0].isIntersecting && setVisible((v) => v + PAGE), { rootMargin: "700px 0px" });
        io.observe(el);
        return () => io.disconnect();
    }, [localMore, visible]);
    const pct = filtered.length ? Math.min(100, Math.round((shown.length / filtered.length) * 100)) : 0;

    const more = () => {
        if (filtered.length > visible) setVisible((v) => v + PAGE);
        else onLoadMore?.();
    };
    const clearAll = () => {
        setQ("");
        setType("all");
        setGenres([]);
        setMinRating(0);
        setDecade(null);
    };
    const toggleGenre = (g) => setGenres((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]));

    // ── Filter sections (same JSX in the desktop sidebar and the mobile sheet) ──
    const filterBody = (
        <>
            {showTypes && (
                <FilterSection title="Type">
                    <div className="space-y-0.5">
                        <OptionRow active={type === "all"} onClick={() => setType("all")} label="All" count={items.length} />
                        <OptionRow active={type === "movie"} onClick={() => setType("movie")} label="Movies" count={facets.typeC.movie} />
                        <OptionRow active={type === "series"} onClick={() => setType("series")} label="Series" count={facets.typeC.series} />
                    </div>
                </FilterSection>
            )}

            {showRating && (
                <FilterSection title="Minimum rating">
                    <div className="flex flex-wrap gap-2">
                        {RATINGS.map((r) => (
                            <Chip key={r.v} active={minRating === r.v} onClick={() => setMinRating(r.v)}>
                                {r.v ? `★ ${r.label}` : r.label}
                            </Chip>
                        ))}
                    </div>
                </FilterSection>
            )}

            {showDecades && (
                <FilterSection title="Release decade">
                    <div className="flex flex-wrap gap-2">
                        <Chip active={decade == null} onClick={() => setDecade(null)}>
                            Any
                        </Chip>
                        {facets.decadeList.map((d) => (
                            <Chip key={d.d} active={decade === d.d} onClick={() => setDecade(decade === d.d ? null : d.d)}>
                                {d.d}s
                            </Chip>
                        ))}
                    </div>
                </FilterSection>
            )}

            {showGenres && (
                <FilterSection title="Genre">
                    {genreSearchable && (
                        <label className="mb-2 flex h-8 items-center gap-2 rounded-lg border border-white/10 bg-base-100/50 px-2.5 focus-within:border-primary/60">
                            <Search size={13} className="shrink-0 text-base-content/45" />
                            <input
                                value={genreQ}
                                onChange={(e) => setGenreQ(e.target.value)}
                                placeholder="Find a genre…"
                                aria-label="Find a genre"
                                className="w-full min-w-0 bg-transparent text-xs outline-none placeholder:text-base-content/35"
                            />
                        </label>
                    )}
                    <div className="space-y-0.5">
                        {genresShown.map((g) => (
                            <CheckRow key={g.name} checked={genres.includes(g.name)} onClick={() => toggleGenre(g.name)} label={g.name} count={g.count} />
                        ))}
                    </div>
                    {genreNeedle && genresShown.length === 0 && <p className="px-2.5 py-2 text-xs text-base-content/45">No genre matches.</p>}
                    {!genreNeedle && facets.genreList.length > GENRE_COLLAPSED && (
                        <button type="button" onClick={() => setAllGenres((v) => !v)} className="mt-2 cursor-pointer px-2.5 text-xs font-semibold text-primary hover:text-primary/80">
                            {allGenres ? "Show fewer" : `Show all ${facets.genreList.length}`}
                        </button>
                    )}
                </FilterSection>
            )}
        </>
    );

    const gridCls = `grid gap-2.5 sm:gap-3 ${hasFacets ? DENSITY[density].side : DENSITY[density].full}`;
    const hasItems = !loading && items.length > 0;
    // fullscreen: phones/tablets → everything scrolls together; lg+ → header + sidebar stay put, only the results area scrolls
    const rootCls = fullscreen ? "mx-auto flex h-full max-w-[110rem] flex-col gap-4 overflow-y-auto overscroll-contain px-3 pt-4 sm:gap-6 sm:px-6 sm:pt-6 lg:overflow-hidden lg:px-8" : "space-y-6";
    const bodyCls = fullscreen ? "flex shrink-0 gap-8 lg:min-h-0 lg:flex-1 lg:shrink" : hasItems && hasFacets ? "lg:grid lg:grid-cols-[16.5rem_minmax(0,1fr)] lg:gap-8" : "";
    const mainCls = fullscreen ? "flex min-w-0 flex-1 flex-col gap-4 lg:min-h-0" : "min-w-0 space-y-5";
    const scrollCls = fullscreen ? "space-y-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:space-y-5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain lg:pr-1" : "space-y-5";

    return (
        <div className={rootCls}>
            {/* ── Header ───────────────────────────────────────────────────── */}
            <header className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 border-b border-white/8 pb-4 lg:flex lg:items-end lg:justify-between lg:pb-5">
                <div className="min-w-0">
                    <h1 className="truncate text-xl font-bold leading-tight tracking-tight text-base-content sm:text-2xl lg:text-3xl">{title}</h1>
                    {!loading && (
                        <p className="mt-1 text-xs text-base-content/55 sm:mt-1.5 sm:text-sm" aria-live="polite">
                            {items.length}
                            {hasMore ? "+" : ""} {items.length === 1 ? "title" : "titles"}
                            {showTypes && (
                                <span className="hidden sm:inline">
                                    <span className="mx-2 text-base-content/25">·</span>
                                    {facets.typeC.movie} movies
                                    <span className="mx-2 text-base-content/25">·</span>
                                    {facets.typeC.series} series
                                </span>
                            )}
                        </p>
                    )}
                </div>

                {/* Close — phones/tablets: top-right of the title row */}
                {onBack && (
                    <button
                        type="button"
                        onClick={onBack}
                        aria-label="Close"
                        className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-white/10 bg-base-200/70 text-base-content/85 transition-colors hover:border-white/25 hover:bg-base-300 lg:hidden">
                        <X size={18} />
                    </button>
                )}

                {/* Search + sort (+ Close on desktop) */}
                <div className="col-span-2 flex items-center gap-2 lg:col-span-1">
                    {hasItems && (
                        <>
                            <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border border-white/10 bg-base-200/70 px-3 transition-colors focus-within:border-primary/60 sm:h-10 lg:w-72 lg:flex-none">
                                <Search size={15} className="shrink-0 text-base-content/50" />
                                <input
                                    ref={searchRef}
                                    value={q}
                                    onChange={(e) => setQ(e.target.value)}
                                    placeholder="Search in this list…"
                                    aria-label="Search in this list"
                                    enterKeyHint="search"
                                    className="w-full min-w-0 bg-transparent text-base outline-none placeholder:text-base-content/35 sm:text-sm"
                                />
                                {q ? (
                                    <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="cursor-pointer p-1 text-base-content/50 hover:text-base-content">
                                        <X size={15} />
                                    </button>
                                ) : (
                                    <kbd className="hidden rounded border border-white/10 px-1.5 text-[10px] text-base-content/40 lg:inline">/</kbd>
                                )}
                            </label>

                            <label className="relative hidden h-10 items-center sm:flex">
                                <span className="sr-only">Sort by</span>
                                <select
                                    value={sort}
                                    onChange={(e) => setSort(e.target.value)}
                                    className="h-10 w-40 cursor-pointer appearance-none rounded-lg border border-white/10 bg-base-200/70 pl-3 pr-9 text-sm text-base-content outline-none transition-colors hover:border-white/25 focus:border-primary/60 lg:w-44">
                                    {SORTS.map((s) => (
                                        <option key={s.id} value={s.id}>
                                            Sort: {s.label}
                                        </option>
                                    ))}
                                </select>
                                <ChevronDown size={15} className="pointer-events-none absolute right-3 text-base-content/50" />
                            </label>
                        </>
                    )}

                    {onBack && (
                        <button
                            type="button"
                            onClick={onBack}
                            aria-label="Close"
                            className="hidden h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 bg-base-200/70 px-3 text-sm font-medium text-base-content/85 transition-colors hover:border-white/25 hover:bg-base-300 lg:flex">
                            <X size={16} />
                            Close
                        </button>
                    )}
                </div>
            </header>

            {/* ── Body: sidebar + results ──────────────────────────────────── */}
            <div className={bodyCls}>
                {hasItems && hasFacets && (
                    <aside aria-label="Filters" className={fullscreen ? "hidden w-[16.5rem] shrink-0 overflow-y-auto pb-6 lg:block" : "hidden lg:block"}>
                        <div className="rounded-2xl border border-white/8 bg-base-200/40 p-4">
                            <div className="mb-4 flex items-center justify-between">
                                <h2 className="flex items-center gap-2 text-sm font-semibold text-base-content">
                                    <SlidersHorizontal size={15} className="text-primary" />
                                    Filters
                                </h2>
                                {facetCount > 0 && (
                                    <button type="button" onClick={clearAll} className="cursor-pointer text-xs font-semibold text-primary hover:text-primary/80">
                                        Reset
                                    </button>
                                )}
                            </div>
                            {filterBody}
                        </div>
                    </aside>
                )}

                <main className={mainCls}>
                    {/* Results bar */}
                    {hasItems && (
                        <div className="shrink-0 space-y-2.5">
                            <div className="flex items-center gap-2">
                                {hasFacets && (
                                    <button
                                        type="button"
                                        onClick={() => setSheet(true)}
                                        className="flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-base-200/70 px-3 text-sm font-medium text-base-content/85 lg:hidden">
                                        <SlidersHorizontal size={15} />
                                        Filters
                                        {facetCount > 0 && (
                                            <span className="flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-content">
                                                {facetCount}
                                            </span>
                                        )}
                                    </button>
                                )}

                                <label className="relative flex h-10 min-w-0 items-center sm:hidden">
                                    <span className="sr-only">Sort by</span>
                                    <select
                                        value={sort}
                                        onChange={(e) => setSort(e.target.value)}
                                        className="h-10 w-full min-w-0 cursor-pointer appearance-none rounded-lg border border-white/10 bg-base-200/70 pl-3 pr-8 text-sm text-base-content outline-none">
                                        {SORTS.map((s) => (
                                            <option key={s.id} value={s.id}>
                                                {s.label}
                                            </option>
                                        ))}
                                    </select>
                                    <ChevronDown size={14} className="pointer-events-none absolute right-2.5 text-base-content/50" />
                                </label>

                                <span className="hidden min-w-0 truncate text-sm tabular-nums text-base-content/60 sm:inline">
                                    {filtered.length} {filtered.length === 1 ? "result" : "results"}
                                </span>

                                {/* Poster size — 2 / 3 / 4+ columns on phones, bigger steps on larger screens */}
                                <div role="group" aria-label="Poster size" className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-white/10 bg-base-200/70 p-0.5">
                                    {Object.entries(DENSITY).map(([k, d]) => (
                                        <button
                                            key={k}
                                            type="button"
                                            onClick={() => changeDensity(k)}
                                            aria-pressed={density === k}
                                            title={d.name}
                                            className={`h-9 w-9 cursor-pointer rounded-md text-xs font-bold transition-colors sm:h-7 sm:w-8 ${density === k ? "bg-base-300 text-base-content" : "text-base-content/50 hover:text-base-content"}`}>
                                            {d.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <p className="text-xs tabular-nums text-base-content/55 sm:hidden">
                                {filtered.length} {filtered.length === 1 ? "result" : "results"}
                            </p>

                            {filtersActive && (
                                <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                                    {needle && <Pill onRemove={() => setQ("")}>{`“${q.trim()}”`}</Pill>}
                                    {type !== "all" && <Pill onRemove={() => setType("all")}>{type === "movie" ? "Movies" : "Series"}</Pill>}
                                    {minRating > 0 && <Pill onRemove={() => setMinRating(0)}>{`★ ${minRating}+`}</Pill>}
                                    {decade != null && <Pill onRemove={() => setDecade(null)}>{`${decade}s`}</Pill>}
                                    {genres.map((g) => (
                                        <Pill key={g} onRemove={() => toggleGenre(g)}>
                                            {g}
                                        </Pill>
                                    ))}
                                    <button
                                        type="button"
                                        onClick={clearAll}
                                        className="shrink-0 cursor-pointer whitespace-nowrap px-1 text-xs font-semibold text-base-content/60 hover:text-base-content">
                                        Clear all
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    <div className={scrollCls}>
                        {/* A–Z jump bar */}
                        {showLetters && (
                            <nav
                                aria-label="Jump to letter"
                                className="flex gap-1 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0"
                                style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                                {[...letterIndex.keys()].map((l) => (
                                    <button
                                        key={l}
                                        type="button"
                                        onClick={() => jumpTo(l)}
                                        className="h-8 min-w-8 shrink-0 cursor-pointer rounded-md border border-white/8 bg-base-200/60 px-1.5 text-xs font-semibold text-base-content/70 transition-colors hover:border-primary/50 hover:text-primary">
                                        {l}
                                    </button>
                                ))}
                            </nav>
                        )}

                        {loading && <SkeletonGrid cls={gridCls} />}

                        {!loading && shown.length === 0 && (
                            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 py-14 text-center sm:py-20">
                                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-base-200">
                                    <Film size={24} className="text-base-content/40" />
                                </div>
                                <p className="text-sm font-medium text-base-content/80">{filtersActive ? "No titles match your filters" : emptyText}</p>
                                {filtersActive && (
                                    <button
                                        type="button"
                                        onClick={clearAll}
                                        className="cursor-pointer rounded-lg bg-base-300 px-4 py-1.5 text-xs font-semibold text-base-content transition-colors hover:bg-base-200">
                                        Clear filters
                                    </button>
                                )}
                            </div>
                        )}

                        {shown.length > 0 && (
                            <div className={gridCls}>
                                {shown.map((item, i) => {
                                    const l = letterIndex ? letterOf(item) : null;
                                    return (
                                        <div key={item.id ?? item.seriesKey ?? item.title} id={l && letterIndex.get(l) === i ? `seeall-${l}` : undefined} className="scroll-mt-4 [&>div]:w-full!">
                                            <MediaCard item={item} />
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {shown.length > 0 && (
                            <footer className="flex flex-col items-center gap-3 border-t border-white/6 pt-6">
                                <p className="text-xs tabular-nums text-base-content/55">
                                    Showing {shown.length} of {filtered.length}
                                    {hasMore && !filtersActive ? "+" : ""}
                                </p>
                                <div className="h-1 w-40 overflow-hidden rounded-full bg-base-300" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                                    <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
                                </div>
                                {localMore && <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />}
                                {remoteMore && (
                                    <button
                                        type="button"
                                        onClick={more}
                                        disabled={moreLoading}
                                        className="cursor-pointer rounded-lg border border-white/10 bg-base-300 px-6 py-2 text-xs font-semibold text-base-content transition-colors hover:bg-base-200 disabled:cursor-wait disabled:opacity-50">
                                        {moreLoading ? "Loading…" : "Load more"}
                                    </button>
                                )}
                            </footer>
                        )}
                    </div>
                </main>
            </div>

            {/* ── Mobile filter sheet ──────────────────────────────────────── */}
            {sheet && (
                <div className="fixed inset-0 z-[60] lg:hidden" role="dialog" aria-modal="true" aria-label="Filters">
                    <div className="absolute inset-0 bg-black/60" onClick={() => setSheet(false)} />
                    <div className="absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col rounded-t-3xl border-t border-white/10 bg-base-100 shadow-2xl md:mx-auto md:max-w-xl">
                        <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-white/15" aria-hidden="true" />
                        <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
                            <h2 className="flex items-center gap-2 text-base font-semibold text-base-content">
                                <SlidersHorizontal size={16} className="text-primary" />
                                Filters
                            </h2>
                            <div className="flex items-center gap-3">
                                {facetCount > 0 && (
                                    <button type="button" onClick={clearAll} className="cursor-pointer text-sm font-semibold text-primary">
                                        Reset
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => setSheet(false)}
                                    aria-label="Close filters"
                                    className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-base-300">
                                    <X size={16} />
                                </button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">{filterBody}</div>
                        <div className="border-t border-white/8 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                            <button type="button" onClick={() => setSheet(false)} className="btn btn-primary w-full rounded-lg border-none">
                                Show {filtered.length} {filtered.length === 1 ? "result" : "results"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
