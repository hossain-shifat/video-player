import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tv, Search } from "lucide-react";
import LiveCard from "../../../Components/LiveCard";
import { getLiveChannels, getLiveCategories } from "../../../api/live";
import { useAuth } from "../../../auth/useAuth";

const PAGE_LIMIT = 24;
const SEARCH_DEBOUNCE_MS = 350;

function TabSkeleton() {
    return <div className="h-8 w-24 rounded-full bg-base-300 animate-pulse shrink-0" />;
}

function CardSkeleton() {
    return (
        <div className="w-full">
            <div className="aspect-video rounded-xl bg-base-300 animate-pulse" />
            <div className="h-3.5 w-3/4 rounded bg-base-300 animate-pulse mt-2" />
            <div className="h-3 w-1/3 rounded bg-base-300 animate-pulse mt-1.5" />
        </div>
    );
}

export default function Live() {
    const { isAuthenticated, isApproved, loading: authLoading } = useAuth();
    const enabled = !authLoading && isAuthenticated && isApproved;

    const [activeCategory, setActiveCategory] = useState(null);
    const [searchInput, setSearchInput] = useState(""); // what the input shows, updates instantly
    const [q, setQ] = useState(""); // what actually gets sent to the API, debounced
    const [page, setPage] = useState(1);

    // Debounce search — previously every keystroke re-fetched the channel
    // list (which used to be ALL 2700+ channels), freezing the page. Now it
    // just waits 350ms after typing stops before firing one request.
    const debounceRef = useRef(null);
    function handleSearchChange(value) {
        setSearchInput(value);
        setPage(1);
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => setQ(value), SEARCH_DEBOUNCE_MS);
    }
    useEffect(() => () => clearTimeout(debounceRef.current), []);

    // Categories — small, stable list, cached for 5 minutes so re-visiting
    // /live doesn't redownload it every time.
    const { data: categoriesData, isLoading: catLoading } = useQuery({
        queryKey: ["live", "categories"],
        queryFn: getLiveCategories,
        enabled,
        staleTime: 5 * 60 * 1000,
    });
    const categories = categoriesData?.categories ?? [];

    // Channels — backend now actually paginates (see liveController.getChannels),
    // so this only ever transfers/renders one page (<=24 items) at a time
    // instead of the full 2700+ channel dataset. react-query caches each
    // (category, q, page) combo for a minute, so paging back-and-forth or
    // re-opening the tab is instant instead of re-fetching everything.
    const {
        data,
        isLoading: loading,
        isFetching,
        error,
    } = useQuery({
        queryKey: ["live", "channels", { category: activeCategory, q, page }],
        queryFn: () => getLiveChannels({ category: activeCategory || undefined, q: q || undefined, page, limit: PAGE_LIMIT }),
        enabled,
        staleTime: 60 * 1000,
    });

    const channels = data?.channels ?? [];
    const total = data?.total ?? 0;
    const totalPages = Math.max(1, data?.totalPages ?? Math.ceil(total / PAGE_LIMIT));

    // Not approved — show message instead of crashing
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
            {/* ── Header ── */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                    <Tv size={22} className="text-primary" />
                    <h1 className="text-2xl sm:text-3xl font-bold text-base-content">Live TV</h1>
                </div>

                <div className="flex items-center gap-2 bg-base-300 rounded-md px-3 h-9 w-full sm:w-64">
                    <Search size={16} className="text-base-content/50 shrink-0" />
                    <input
                        type="text"
                        value={searchInput}
                        onChange={(e) => handleSearchChange(e.target.value)}
                        placeholder="Search channels..."
                        className="bg-transparent outline-none text-sm text-base-content placeholder:text-base-content/40 w-full"
                    />
                </div>
            </div>

            {/* ── Category tabs ── */}
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                {catLoading ? (
                    Array.from({ length: 6 }).map((_, i) => <TabSkeleton key={i} />)
                ) : (
                    <>
                        <button
                            onClick={() => {
                                setPage(1);
                                setActiveCategory(null);
                            }}
                            className={`shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-colors duration-150 border-none cursor-pointer ${
                                !activeCategory ? "bg-primary text-primary-content" : "bg-base-300 text-base-content/70 hover:text-base-content"
                            }`}>
                            All
                        </button>
                        {categories.map((c) => (
                            <button
                                key={c.name}
                                onClick={() => {
                                    setPage(1);
                                    setActiveCategory(c.name);
                                }}
                                className={`shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-colors duration-150 border-none cursor-pointer ${
                                    activeCategory === c.name ? "bg-primary text-primary-content" : "bg-base-300 text-base-content/70 hover:text-base-content"
                                }`}>
                                {c.name}
                                {c.total != null ? ` (${c.total})` : ""}
                            </button>
                        ))}
                    </>
                )}
            </div>

            {/* ── Channel grid ── */}
            {error ? (
                <p className="text-sm text-error">Failed to load live channels: {error.message}</p>
            ) : loading ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    {Array.from({ length: PAGE_LIMIT }).map((_, i) => (
                        <CardSkeleton key={i} />
                    ))}
                </div>
            ) : channels.length === 0 ? (
                <p className="text-base-content/40 text-sm py-10 text-center">No live channels found{q ? ` for "${q}"` : ""}. Add a source from the admin dashboard (IPTV tab) to start streaming.</p>
            ) : (
                <>
                    <div className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 transition-opacity ${isFetching ? "opacity-60" : "opacity-100"}`}>
                        {channels.map((ch, i) => (
                            <div key={ch.id ?? ch.url ?? i} className="w-full [&>a]:w-full">
                                <LiveCard item={ch} />
                            </div>
                        ))}
                    </div>

                    {totalPages > 1 && (
                        <div className="flex items-center justify-center gap-3 pt-2">
                            <button
                                disabled={page <= 1}
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                                className="px-3 py-1.5 rounded-md text-sm bg-base-300 text-base-content/70 disabled:opacity-30 hover:text-base-content transition-colors border-none cursor-pointer">
                                Prev
                            </button>
                            <span className="text-xs text-base-content/45">
                                Page {page} of {totalPages}
                            </span>
                            <button
                                disabled={page >= totalPages}
                                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                className="px-3 py-1.5 rounded-md text-sm bg-base-300 text-base-content/70 disabled:opacity-30 hover:text-base-content transition-colors border-none cursor-pointer">
                                Next
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
