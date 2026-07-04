import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "react-router";
import { useQuery, useQueries } from "@tanstack/react-query";
import { ArrowLeft, Search as SearchIcon, X, SlidersHorizontal, LayoutGrid, List as ListIcon, Tv, Loader2, ChevronDown } from "lucide-react";
import LiveCard from "../../Components/LiveCard";
import { getLiveChannels, getLiveCategories, getFeaturedEvents } from "../../api/live";
import { useAuth } from "../../auth/useAuth";

const SEARCH_DEBOUNCE_MS = 350;
const PAGE_LIMIT = 30;

// Backend-defined sort keys — frontend just sends the key, never sorts locally
const SORT_OPTIONS = [
    { value: "alphabetical", label: "A → Z" },
    { value: "popularity", label: "Popularity" },
    { value: "recommended", label: "Recommended" },
    { value: "recent", label: "Recently Added" },
    { value: "live", label: "Currently Live" },
    { value: "working", label: "Working Status" },
];

// Reverse of Live.jsx's slugify — category names with spaces become hyphenated
// lowercase slugs; we un-hyphenate for display but the backend call uses the
// raw decoded slug as the category filter value (backend owns the matching).
function deslugify(slug) {
    return decodeURIComponent(slug).replace(/-/g, " ");
}

// ── Skeletons ─────────────────────────────────────────────────────────────────
function HeaderSkeleton() {
    return (
        <div className="space-y-3">
            <div className="h-8 w-48 rounded bg-base-300 animate-pulse" />
            <div className="h-4 w-32 rounded bg-base-300 animate-pulse" />
        </div>
    );
}
function GridCardSkeleton() {
    return (
        <div className="w-full">
            <div className="aspect-video rounded-xl bg-base-300 animate-pulse" />
            <div className="h-3.5 w-3/4 rounded bg-base-300 animate-pulse mt-2" />
            <div className="h-3 w-1/3 rounded bg-base-300 animate-pulse mt-1.5" />
        </div>
    );
}
function ListRowSkeleton() {
    return (
        <div className="flex items-center gap-3 p-2">
            <div className="w-24 aspect-video rounded-lg bg-base-300 animate-pulse shrink-0" />
            <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-1/3 rounded bg-base-300 animate-pulse" />
                <div className="h-3 w-1/4 rounded bg-base-300 animate-pulse" />
            </div>
        </div>
    );
}

// ── List-view row (alternative to LiveCard grid layout) ────────────────────────
function ChannelListRow({ item }) {
    const [imgErr, setImgErr] = useState(false);
    const name = item.cleanName || item.name || "Channel";
    const working = item.streamStatus === "working";

    function toBase64Url(str) {
        const b64 = btoa(unescape(encodeURIComponent(str)));
        return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }

    return (
        <Link
            to={`/live/watch/${toBase64Url(item.url)}`}
            state={{ streamUrl: item.url, channelName: name, channelLogo: item.logo }}
            className="group flex items-center gap-3 p-2 rounded-xl hover:bg-base-200 transition-colors no-underline">
            <div className="relative w-28 aspect-video rounded-lg overflow-hidden bg-base-300 shrink-0">
                {item.logo && !imgErr ? (
                    <img src={item.logo} alt={name} className="w-full h-full object-contain p-1.5 bg-black/20" loading="lazy" onError={() => setImgErr(true)} />
                ) : (
                    <div className="w-full h-full flex items-center justify-center">
                        <Tv size={16} className="text-base-content/20" />
                    </div>
                )}
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-base-content truncate">{name}</p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {item.current?.title && <span className="text-xs text-base-content/50 truncate">▶ {item.current.title}</span>}
                    {item.country && item.country !== "Unknown" && <span className="text-xs text-base-content/35">· {item.country}</span>}
                    {item.language && item.language !== "Unknown" && <span className="text-xs text-base-content/35">· {item.language}</span>}
                </div>
            </div>
            <span className={`text-[10px] font-medium shrink-0 ${working ? "text-success" : "text-base-content/30"}`}>{working ? "● Working" : "○ Unknown"}</span>
        </Link>
    );
}

// ── Filter panel ───────────────────────────────────────────────────────────────
function FilterPanel({ filters, onChange, onClose }) {
    return (
        <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-72 bg-base-200 border border-base-300 rounded-2xl shadow-2xl p-4 space-y-4" style={{ animation: "fpIn .12s ease-out both" }}>
            <style>{`@keyframes fpIn{from{opacity:0;transform:translateY(-4px) scale(.97)}to{opacity:1;transform:none}}`}</style>

            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-base-content">Filters</h3>
                <button onClick={onClose} aria-label="Close filters" className="text-base-content/40 hover:text-base-content border-none bg-transparent cursor-pointer">
                    <X size={15} />
                </button>
            </div>

            <label className="flex items-center justify-between cursor-pointer">
                <span className="text-sm text-base-content/80">Working channels only</span>
                <input type="checkbox" checked={!!filters.workingOnly} onChange={(e) => onChange({ ...filters, workingOnly: e.target.checked })} className="toggle toggle-sm toggle-primary" />
            </label>

            <label className="flex items-center justify-between cursor-pointer">
                <span className="text-sm text-base-content/80">Live now only</span>
                <input type="checkbox" checked={!!filters.liveOnly} onChange={(e) => onChange({ ...filters, liveOnly: e.target.checked })} className="toggle toggle-sm toggle-primary" />
            </label>

            <div>
                <label className="text-xs text-base-content/50 mb-1 block">Country</label>
                <input
                    type="text"
                    value={filters.country || ""}
                    onChange={(e) => onChange({ ...filters, country: e.target.value })}
                    placeholder="e.g. United Kingdom"
                    className="w-full bg-base-300 rounded-md px-3 py-1.5 text-sm text-base-content outline-none placeholder:text-base-content/30"
                />
            </div>

            <div>
                <label className="text-xs text-base-content/50 mb-1 block">Language</label>
                <input
                    type="text"
                    value={filters.language || ""}
                    onChange={(e) => onChange({ ...filters, language: e.target.value })}
                    placeholder="e.g. English"
                    className="w-full bg-base-300 rounded-md px-3 py-1.5 text-sm text-base-content outline-none placeholder:text-base-content/30"
                />
            </div>

            <div>
                <label className="text-xs text-base-content/50 mb-1 block">Quality</label>
                <select
                    value={filters.quality || ""}
                    onChange={(e) => onChange({ ...filters, quality: e.target.value })}
                    className="w-full bg-base-300 rounded-md px-3 py-1.5 text-sm text-base-content outline-none">
                    <option value="">Any</option>
                    <option value="4K">4K</option>
                    <option value="1080p">1080p / FHD</option>
                    <option value="720p">720p / HD</option>
                    <option value="SD">SD</option>
                </select>
            </div>

            <button onClick={() => onChange({})} className="w-full text-center text-xs text-base-content/50 hover:text-base-content py-1.5 border-none bg-transparent cursor-pointer">
                Clear all filters
            </button>
        </div>
    );
}

// ── Sports match strip — only rendered when this category is Sports ───────────
// "current playing team, next playing team" — pulled straight from the Sports
// Event Service (getFeaturedEvents → todayMatches). Purely informational here;
// the channel grid below already lists every channel that might carry it.
function MatchCard({ ev }) {
    const isLive = ev.status === "live";
    return (
        <div className="shrink-0 w-44 sm:w-52 rounded-xl bg-base-200 ring-1 ring-white/5 p-2.5">
            <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] text-base-content/40 font-semibold uppercase tracking-wide truncate">{ev.league || ev.sport}</span>
                {isLive ? (
                    <span className="inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-error/90 text-white shrink-0">● LIVE</span>
                ) : (
                    <span className="text-[9px] text-base-content/35 shrink-0">{ev.kickoff ? new Date(ev.kickoff).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ev.status}</span>
                )}
            </div>
            <div className="flex flex-col gap-0.5 mt-1.5">
                <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-base-content truncate">{ev.homeTeam}</p>
                    {ev.score?.home != null && <p className="text-xs font-bold text-base-content">{ev.score.home}</p>}
                </div>
                <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-base-content truncate">{ev.awayTeam}</p>
                    {ev.score?.away != null && <p className="text-xs font-bold text-base-content">{ev.score.away}</p>}
                </div>
            </div>
        </div>
    );
}

function SportsMatchStrip({ enabled }) {
    const { data } = useQuery({
        queryKey: ["live", "sports", "featured"],
        queryFn: getFeaturedEvents,
        enabled,
        staleTime: 60 * 1000,
        refetchInterval: 60 * 1000,
    });
    const matches = data?.todayMatches ?? [];
    if (!matches.length) return null;

    // Currently playing (live) first, then whichever is up next by kickoff
    const current = matches.find((m) => m.status === "live");
    const next = matches.find((m) => m.status === "upcoming" && m.id !== current?.id);

    return (
        <div className="space-y-2">
            {(current || next) && (
                <p className="text-sm text-base-content/60">
                    {current && (
                        <>
                            Now: <span className="text-base-content font-medium">{current.homeTeam}</span> vs <span className="text-base-content font-medium">{current.awayTeam}</span>
                        </>
                    )}
                    {current && next && " · "}
                    {next && (
                        <>
                            Next: <span className="text-base-content font-medium">{next.homeTeam}</span> vs <span className="text-base-content font-medium">{next.awayTeam}</span>
                            {next.kickoff && ` (${new Date(next.kickoff).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})`}
                        </>
                    )}
                </p>
            )}
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                {matches.map((ev) => (
                    <MatchCard key={ev.id} ev={ev} />
                ))}
            </div>
        </div>
    );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function LiveCategory() {
    const { slug } = useParams();
    const categoryValue = deslugify(slug || "");

    const { isAuthenticated, isApproved, loading: authLoading } = useAuth();
    const enabled = !authLoading && isAuthenticated && isApproved;

    // ── Search (debounced, backend-executed) ───────────────────────────────────
    const [searchInput, setSearchInput] = useState("");
    const [q, setQ] = useState("");
    const debounceRef = useRef(null);
    function handleSearchChange(value) {
        setSearchInput(value);
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => setQ(value), SEARCH_DEBOUNCE_MS);
    }
    useEffect(() => () => clearTimeout(debounceRef.current), []);

    // ── Sort / filter / view-mode state — all forwarded to backend as params ───
    const [sort, setSort] = useState("recommended");
    const [filters, setFilters] = useState({});
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [viewMode, setViewMode] = useState("grid"); // grid | list
    const filterPanelRef = useRef(null);

    useEffect(() => {
        function onOutside(e) {
            if (filterPanelRef.current && !filterPanelRef.current.contains(e.target)) setFiltersOpen(false);
        }
        if (filtersOpen) document.addEventListener("mousedown", onOutside);
        return () => document.removeEventListener("mousedown", onOutside);
    }, [filtersOpen]);

    // ── Pagination — infinite scroll via backend page param ────────────────────
    const [pages, setPages] = useState([1]); // accumulated page numbers fetched
    const sentinelRef = useRef(null);

    // Reset pagination whenever query/sort/filters change
    useEffect(() => {
        setPages([1]);
    }, [q, sort, filters, categoryValue]);

    const queryKeyBase = ["live", "category-channels", categoryValue, { q, sort, filters }];

    // Fetch all accumulated pages — react-query caches each page key individually,
    // we just read them all and concatenate for render. Backend still does the
    // actual pagination; we never slice client-side.
    // useQueries (not .map(useQuery)) — required because `pages` grows over
    // time (infinite scroll), and calling useQuery inside .map() would change
    // the hook count between renders, violating React's Rules of Hooks.
    const pageQueries = useQueries({
        queries: pages.map((p) => ({
            queryKey: [...queryKeyBase, p],
            queryFn: () =>
                getLiveChannels({
                    category: categoryValue,
                    q: q || undefined,
                    page: p,
                    limit: PAGE_LIMIT,
                    sort,
                    workingOnly: filters.workingOnly || undefined,
                    country: filters.country || undefined,
                    language: filters.language || undefined,
                    quality: filters.quality || undefined,
                }),
            enabled,
            staleTime: 30 * 1000,
            keepPreviousData: true,
        })),
    });

    const isLoadingFirst = pageQueries[0]?.isLoading;
    const isFetchingMore = pageQueries.some((q) => q.isFetching) && pages.length > 1;
    const lastQuery = pageQueries[pageQueries.length - 1];
    const firstError = pageQueries.find((q) => q.error)?.error;

    const allChannels = pageQueries.flatMap((pq) => pq.data?.channels ?? []);
    const total = pageQueries[0]?.data?.total ?? 0;
    const totalPages = pageQueries[0]?.data?.totalPages ?? Math.max(1, Math.ceil(total / PAGE_LIMIT));
    const hasMore = pages.length < totalPages;

    // Infinite scroll observer
    useEffect(() => {
        if (!sentinelRef.current || !hasMore || isFetchingMore || isLoadingFirst) return;
        const el = sentinelRef.current;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    setPages((prev) => (prev.length < totalPages ? [...prev, prev.length + 1] : prev));
                }
            },
            { rootMargin: "400px" },
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [hasMore, isFetchingMore, isLoadingFirst, totalPages]);

    // ── Category header metadata (count, subcategories) — from the categories list ─
    const { data: categoriesData } = useQuery({
        queryKey: ["live", "categories"],
        queryFn: getLiveCategories,
        enabled,
        staleTime: 5 * 60 * 1000,
    });
    const categoryMeta = (categoriesData?.categories ?? []).find((c) => c.name.toLowerCase() === categoryValue.toLowerCase());
    const displayName = categoryMeta?.name || categoryValue;
    const categoryDescription = categoryMeta?.description || null;
    const subcategories = categoryMeta?.subcategories || [];
    const isSports = /sport/i.test(categoryValue);

    if (!authLoading && !enabled) {
        return (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
                <Tv size={36} className="text-base-content/25" />
                <p className="text-base-content/50 text-sm">Sign in to watch Live TV.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* ── Back link ──────────────────────────────────────────────────── */}
            <Link to="/live" className="inline-flex items-center gap-1.5 text-sm text-base-content/50 hover:text-base-content transition-colors no-underline">
                <ArrowLeft size={15} /> Back to Live TV
            </Link>

            {/* ── Category header ────────────────────────────────────────────── */}
            {!categoriesData ? (
                <HeaderSkeleton />
            ) : (
                <div className="space-y-2">
                    <h1 className="text-2xl sm:text-3xl font-bold text-base-content capitalize">{displayName}</h1>
                    <p className="text-sm text-base-content/45">{total > 0 ? `${total} channel${total !== 1 ? "s" : ""}` : isLoadingFirst ? "Loading…" : "No channels"}</p>
                    {categoryDescription && <p className="text-sm text-base-content/60 max-w-2xl">{categoryDescription}</p>}
                    {subcategories.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-1">
                            {subcategories.map((sc) => (
                                <span key={sc} className="text-xs px-2.5 py-1 rounded-full bg-base-300 text-base-content/60">
                                    {sc}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* ── Live game stats — current/next match, Sports category only ────── */}
            {isSports && <SportsMatchStrip enabled={enabled} />}

            {/* ── Toolbar: search, sort, filters, view toggle ───────────────────── */}
            <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-2 bg-base-300 rounded-md px-3 h-9 flex-1 min-w-48 max-w-sm">
                    <SearchIcon size={15} className="text-base-content/50 shrink-0" />
                    <input
                        type="text"
                        value={searchInput}
                        onChange={(e) => handleSearchChange(e.target.value)}
                        placeholder={`Search in ${displayName || "category"}...`}
                        className="bg-transparent outline-none text-sm text-base-content placeholder:text-base-content/40 w-full"
                    />
                    {searchInput && (
                        <button
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => handleSearchChange("")}
                            className="shrink-0 text-base-content/35 hover:text-base-content border-none bg-transparent cursor-pointer">
                            <X size={13} />
                        </button>
                    )}
                </div>

                {/* Sort */}
                <div className="relative">
                    <select
                        value={sort}
                        onChange={(e) => setSort(e.target.value)}
                        aria-label="Sort channels"
                        className="appearance-none bg-base-300 text-sm text-base-content rounded-md pl-3 pr-8 h-9 outline-none cursor-pointer">
                        {SORT_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                                {o.label}
                            </option>
                        ))}
                    </select>
                    <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-base-content/40 pointer-events-none" />
                </div>

                {/* Filters */}
                <div className="relative" ref={filterPanelRef}>
                    <button
                        onClick={() => setFiltersOpen((v) => !v)}
                        aria-expanded={filtersOpen}
                        className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-sm border-none cursor-pointer transition-colors
                                    ${Object.keys(filters).length > 0 ? "bg-primary/15 text-primary" : "bg-base-300 text-base-content/70 hover:text-base-content"}`}>
                        <SlidersHorizontal size={14} /> Filters
                        {Object.keys(filters).length > 0 && (
                            <span className="text-[10px] bg-primary text-primary-content rounded-full w-4 h-4 flex items-center justify-center">{Object.keys(filters).length}</span>
                        )}
                    </button>
                    {filtersOpen && <FilterPanel filters={filters} onChange={setFilters} onClose={() => setFiltersOpen(false)} />}
                </div>

                {/* Grid / List toggle */}
                <div className="flex items-center bg-base-300 rounded-md p-0.5">
                    <button
                        onClick={() => setViewMode("grid")}
                        aria-label="Grid view"
                        aria-pressed={viewMode === "grid"}
                        className={`p-1.5 rounded border-none cursor-pointer transition-colors ${viewMode === "grid" ? "bg-base-100 text-primary" : "text-base-content/40 hover:text-base-content bg-transparent"}`}>
                        <LayoutGrid size={15} />
                    </button>
                    <button
                        onClick={() => setViewMode("list")}
                        aria-label="List view"
                        aria-pressed={viewMode === "list"}
                        className={`p-1.5 rounded border-none cursor-pointer transition-colors ${viewMode === "list" ? "bg-base-100 text-primary" : "text-base-content/40 hover:text-base-content bg-transparent"}`}>
                        <ListIcon size={15} />
                    </button>
                </div>
            </div>

            {/* ── Content ───────────────────────────────────────────────────────── */}
            {firstError ? (
                <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
                    <Tv size={28} className="text-error/40" />
                    <p className="text-sm text-error">Failed to load channels: {firstError.message}</p>
                </div>
            ) : isLoadingFirst ? (
                viewMode === "grid" ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                        {Array.from({ length: PAGE_LIMIT }).map((_, i) => (
                            <GridCardSkeleton key={i} />
                        ))}
                    </div>
                ) : (
                    <div className="space-y-1">
                        {Array.from({ length: 10 }).map((_, i) => (
                            <ListRowSkeleton key={i} />
                        ))}
                    </div>
                )
            ) : allChannels.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
                    <Tv size={28} className="text-base-content/15" />
                    <p className="text-sm text-base-content/40">
                        {q ? (
                            <>
                                No channels matched &ldquo;{q}&rdquo; in {displayName}.
                            </>
                        ) : (
                            <>No channels found in this category yet.</>
                        )}
                    </p>
                </div>
            ) : (
                <>
                    {viewMode === "grid" ? (
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                            {allChannels.map((ch, i) => (
                                <LiveCard key={ch.id ?? ch.url ?? i} item={ch} />
                            ))}
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {allChannels.map((ch, i) => (
                                <ChannelListRow key={ch.id ?? ch.url ?? i} item={ch} />
                            ))}
                        </div>
                    )}

                    {/* Infinite scroll sentinel + loading indicator */}
                    {hasMore && (
                        <div ref={sentinelRef} className="flex items-center justify-center py-6">
                            {isFetchingMore && <Loader2 size={18} className="animate-spin text-base-content/30" />}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
