import { useState, useMemo, useEffect, useRef } from "react";
import { Tv, SlidersHorizontal } from "lucide-react";
import { useApi } from "../../../Context/apiContext";
import MediaCard from "../../../Components/MediaCard";
import Search from "../../../Components/Search";

export default function Series() {
    const { series, loading, errors } = useApi();
    const [activeGenre, setActiveGenre] = useState("All");
    const [sortBy, setSortBy] = useState("title"); // title | year | recent
    const [visibleCount, setVisibleCount] = useState(50);
    const sentinelRef = useRef(null);

    const genres = useMemo(() => {
        const set = new Set();
        series.forEach((s) => (s.metadata?.genres ?? []).forEach((g) => set.add(g)));
        return ["All", ...Array.from(set).sort()];
    }, [series]);

    const filtered = useMemo(() => {
        let list = activeGenre === "All" ? series : series.filter((s) => s.metadata?.genres?.includes(activeGenre));

        const sorted = [...list];
        if (sortBy === "title") {
            sorted.sort((a, b) => (a.metadata?.title ?? a.title ?? "").localeCompare(b.metadata?.title ?? b.title ?? ""));
        } else if (sortBy === "year") {
            sorted.sort((a, b) => (b.metadata?.year ?? 0) - (a.metadata?.year ?? 0));
        } else if (sortBy === "recent") {
            sorted.sort((a, b) => (b.dateAdded ? new Date(b.dateAdded) : 0) - (a.dateAdded ? new Date(a.dateAdded) : 0));
        }

        return sorted;
    }, [series, activeGenre, sortBy]);

    // Reset visible count when filters change
    useEffect(() => {
        setVisibleCount(50);
    }, [activeGenre, sortBy]);

    // IntersectionObserver: load more on scroll
    useEffect(() => {
        const el = sentinelRef.current;
        if (!el) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    setVisibleCount((prev) => prev + 50);
                }
            },
            { rootMargin: "300px" },
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [filtered.length]);

    const visible = filtered.slice(0, visibleCount);

    if (loading.media) {
        return (
            <div className="space-y-6">
                <div className="h-8 w-48 bg-base-300 rounded-lg animate-pulse" />
                <div className="flex gap-2 flex-wrap">
                    {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="h-8 w-20 bg-base-300 rounded-full animate-pulse" />
                    ))}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-3">
                    {Array.from({ length: 14 }).map((_, i) => (
                        <div key={i} className="aspect-[2/3] rounded-xl bg-base-300 animate-pulse" />
                    ))}
                </div>
            </div>
        );
    }

    if (errors.media) {
        return <p className="text-error py-8 text-sm">Failed to load series: {errors.media}</p>;
    }

    return (
        <div className="space-y-6">
            {/* ── Header ── */}
            <div className="flex items-end justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                    <Tv size={22} className="text-accent" />
                    <h1 className="text-2xl sm:text-3xl font-bold text-base-content font-circular">Series</h1>
                    <span className="text-xs text-base-content/90 bg-base-300 px-2 py-0.5 rounded-full font-medium">{filtered.length}</span>
                </div>

                <Search className="w-full sm:w-72" hideMobileBtn />
            </div>

            {/* ── Category bar + sort ── */}
            <div className="flex items-center gap-3">
                {genres.length > 1 && (
                    <div className="flex-1 min-w-0 bg-base-200 border border-base-300 rounded-lg p-1 flex gap-1 overflow-x-auto [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: "none" }}>
                        {genres.map((g) => (
                            <button
                                key={g}
                                onClick={() => setActiveGenre(g)}
                                className={[
                                    "shrink-0 px-4 py-1.5 rounded-md text-xs font-semibold transition-all duration-150 cursor-pointer whitespace-nowrap",
                                    activeGenre === g ? "bg-accent text-accent-content shadow-sm" : "text-base-content/80 hover:text-base-content hover:bg-base-300",
                                ].join(" ")}>
                                {g}
                            </button>
                        ))}
                    </div>
                )}

                <div className="dropdown dropdown-end shrink-0">
                    <label tabIndex={0} className="btn btn-sm h-11 min-h-0 rounded-lg bg-base-200 border border-base-300 hover:bg-base-300 text-base-content/90 gap-2 px-4">
                        <SlidersHorizontal size={14} />
                        <span className="text-xs font-medium capitalize hidden sm:inline">{sortBy}</span>
                    </label>
                    <ul tabIndex={0} className="dropdown-content menu z-20 mt-2 p-1.5 shadow-lg bg-base-200 border border-base-300 rounded-lg w-40">
                        {[
                            { key: "title", label: "Title (A–Z)" },
                            { key: "year", label: "Year (Newest)" },
                            { key: "recent", label: "Recently Added" },
                        ].map((opt) => (
                            <li key={opt.key}>
                                <button
                                    onClick={() => document.activeElement.blur() || setSortBy(opt.key)}
                                    className={["text-xs rounded-md", sortBy === opt.key ? "text-accent font-semibold" : "text-base-content/90"].join(" ")}>
                                    {opt.label}
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>

            {/* ── Grid ── */}
            {filtered.length === 0 ? (
                <div className="py-20 text-center text-base-content/60 text-sm">No series in &ldquo;{activeGenre}&rdquo;</div>
            ) : (
                <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-3">
                        {visible.map((item) => (
                            <MediaCard key={item.seriesKey ?? item.id ?? item.title} item={item} />
                        ))}
                    </div>
                    {/* Sentinel for IntersectionObserver — triggers load-more */}
                    {visibleCount < filtered.length && (
                        <div ref={sentinelRef} className="h-10 flex items-center justify-center">
                            <div className="loading loading-spinner loading-xs text-base-content/20" />
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
