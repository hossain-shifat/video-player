import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tv, Search, ChevronLeft, ChevronRight } from "lucide-react";
import LiveCard from "../../../Components/LiveCard";
import { getLiveChannels, getLiveCategories } from "../../../api/live";
import { useAuth } from "../../../auth/useAuth";

const SEARCH_DEBOUNCE_MS = 350;
const ROW_LIMIT = 24;

function CardSkeleton() {
    return (
        <div className="shrink-0 w-40 sm:w-44">
            <div className="aspect-video rounded-xl bg-base-300 animate-pulse" />
            <div className="h-3.5 w-3/4 rounded bg-base-300 animate-pulse mt-2" />
            <div className="h-3 w-1/3 rounded bg-base-300 animate-pulse mt-1.5" />
        </div>
    );
}

// One horizontal scroll row per category
function CategoryRow({ category, q, enabled }) {
    const rowRef = useRef(null);
    const { data, isLoading } = useQuery({
        queryKey: ["live", "channels", { category: category.name, q, page: 1 }],
        queryFn: () => getLiveChannels({ category: category.name, q: q || undefined, page: 1, limit: ROW_LIMIT }),
        enabled,
        staleTime: 60 * 1000,
    });
    const channels = data?.channels ?? [];
    const total = data?.total ?? 0;
    if (!isLoading && channels.length === 0) return null;
    const scroll = (dir) => rowRef.current?.scrollBy({ left: dir * 480, behavior: "smooth" });

    return (
        <section>
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <h2 className="text-base sm:text-lg font-semibold text-base-content">{category.name}</h2>
                    {total > 0 && <span className="text-xs text-base-content/35 font-medium bg-base-300 px-2 py-0.5 rounded-full">{total}</span>}
                </div>
                <div className="hidden sm:flex items-center gap-1">
                    <button
                        onClick={() => scroll(-1)}
                        className="w-7 h-7 rounded-full bg-base-300 hover:bg-base-200 flex items-center justify-center transition-colors text-base-content/60 hover:text-base-content border-none cursor-pointer"
                        aria-label="Scroll left">
                        <ChevronLeft size={15} />
                    </button>
                    <button
                        onClick={() => scroll(1)}
                        className="w-7 h-7 rounded-full bg-base-300 hover:bg-base-200 flex items-center justify-center transition-colors text-base-content/60 hover:text-base-content border-none cursor-pointer"
                        aria-label="Scroll right">
                        <ChevronRight size={15} />
                    </button>
                </div>
            </div>
            <div ref={rowRef} className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                {isLoading
                    ? Array.from({ length: 8 }).map((_, i) => <CardSkeleton key={i} />)
                    : channels.map((ch, i) => (
                          <div key={ch.id ?? ch.url ?? i} className="shrink-0 w-40 sm:w-44">
                              <LiveCard item={ch} />
                          </div>
                      ))}
            </div>
        </section>
    );
}

// Search results — flat grid
function SearchGrid({ q, enabled }) {
    const [page, setPage] = useState(1);
    const PAGE_LIMIT = 25;
    useEffect(() => {
        setPage(1);
    }, [q]);

    const { data, isLoading, isFetching, error } = useQuery({
        queryKey: ["live", "channels", { q, page }],
        queryFn: () => getLiveChannels({ q, page, limit: PAGE_LIMIT }),
        enabled: enabled && !!q,
        staleTime: 60 * 1000,
    });
    const channels = data?.channels ?? [];
    const total = data?.total ?? 0;
    const totalPages = Math.max(1, data?.totalPages ?? Math.ceil(total / PAGE_LIMIT));

    if (error) return <p className="text-sm text-error">Search failed: {error.message}</p>;
    if (isLoading)
        return (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {Array.from({ length: PAGE_LIMIT }).map((_, i) => (
                    <CardSkeleton key={i} />
                ))}
            </div>
        );
    if (!channels.length) return <p className="text-base-content/40 text-sm py-10 text-center">No channels found for &ldquo;{q}&rdquo;.</p>;

    return (
        <>
            <p className="text-xs text-base-content/40 mb-3">
                {total} result{total !== 1 ? "s" : ""} for &ldquo;{q}&rdquo;
            </p>
            <div className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 transition-opacity ${isFetching ? "opacity-60" : ""}`}>
                {channels.map((ch, i) => (
                    <LiveCard key={ch.id ?? ch.url ?? i} item={ch} />
                ))}
            </div>
            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 pt-4">
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
    );
}

export default function Live() {
    const { isAuthenticated, isApproved, loading: authLoading } = useAuth();
    const enabled = !authLoading && isAuthenticated && isApproved;

    const [searchInput, setSearchInput] = useState("");
    const [q, setQ] = useState("");
    const debounceRef = useRef(null);

    function handleSearchChange(value) {
        setSearchInput(value);
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => setQ(value), SEARCH_DEBOUNCE_MS);
    }
    useEffect(() => () => clearTimeout(debounceRef.current), []);

    const { data: categoriesData, isLoading: catLoading } = useQuery({
        queryKey: ["live", "categories"],
        queryFn: getLiveCategories,
        enabled,
        staleTime: 5 * 60 * 1000,
    });
    const categories = categoriesData?.categories ?? [];

    if (!authLoading && !enabled) {
        return (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
                <Tv size={36} className="text-base-content/25" />
                <p className="text-base-content/50 text-sm">Sign in to watch Live TV.</p>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            {/* Header */}
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

            {/* Search mode → flat grid */}
            {q ? (
                <SearchGrid q={q} enabled={enabled} />
            ) : (
                /* Browse mode → one row per category */
                <div className="space-y-10">
                    {catLoading ? (
                        Array.from({ length: 3 }).map((_, ri) => (
                            <section key={ri}>
                                <div className="h-5 w-32 rounded bg-base-300 animate-pulse mb-3" />
                                <div className="flex gap-3 overflow-hidden">
                                    {Array.from({ length: 6 }).map((_, i) => (
                                        <CardSkeleton key={i} />
                                    ))}
                                </div>
                            </section>
                        ))
                    ) : categories.length === 0 ? (
                        <p className="text-base-content/40 text-sm py-10 text-center">No live channels yet. Add a source from the admin dashboard (IPTV tab).</p>
                    ) : (
                        categories.map((cat) => <CategoryRow key={cat.name} category={cat} q="" enabled={enabled} />)
                    )}
                </div>
            )}
        </div>
    );
}
