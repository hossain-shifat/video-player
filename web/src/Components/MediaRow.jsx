import { useRef } from "react";
import { ChevronRight, ChevronLeft } from "lucide-react";
import MediaCard from "./MediaCard";

// ─── MediaCard skeleton — mirrors exact card dimensions ──────────────────────
function MediaCardSkeleton() {
    return (
        <div className="shrink-0 w-40 sm:w-44 my-2">
            {/* Poster */}
            <div className="w-full aspect-2/3 rounded-xl bg-base-300 animate-pulse" />
            {/* Info */}
            <div className="mt-2 px-0.5 space-y-2">
                <div className="h-3 w-3/4 rounded bg-base-300 animate-pulse" />
                <div className="h-2.5 w-1/2 rounded bg-base-300 animate-pulse" />
            </div>
        </div>
    );
}

/**
 * MediaRow
 * --------
 * Props:
 *   title          — section heading
 *   items          — array from API (movies | series)
 *   loading        — bool; shows skeletons when true
 *   skeletonCount  — how many skeleton cards to show (default 7)
 *   onPlay         — (rawItem) => void
 *   onWatchTrailer — (normalisedItem) => void
 *   viewAllTo      — optional route string for "See all" link
 */
export default function MediaRow({ title, items = [], loading = false, skeletonCount = 7, onPlay, onWatchTrailer, viewAllTo }) {
    const rowRef = useRef(null);

    const scroll = (dir) => {
        const el = rowRef.current;
        if (!el) return;
        el.scrollBy({ left: dir * 480, behavior: "smooth" });
    };

    // Hide entirely when not loading and no items
    if (!loading && !items.length) return null;

    return (
        <section className="relative">
            {/* ── Section header ── */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    {loading ? (
                        <div className="h-5 w-24 rounded bg-base-300 animate-pulse" />
                    ) : (
                        <>
                            <h2 className="text-base sm:text-lg font-semibold text-base-content">{title}</h2>
                            <span className="text-xs text-primary bg-primary/10 badge badge-primary font-medium px-2 py-0.5 rounded-full">{items.length}</span>
                        </>
                    )}
                </div>

                {!loading && (
                    <div className="flex items-center gap-2">
                        {viewAllTo && (
                            <a href={viewAllTo} className="text-xs text-primary hover:text-primary/80 font-medium transition-colors flex items-center gap-0.5">
                                See all <ChevronRight size={13} />
                            </a>
                        )}
                        <div className="hidden sm:flex items-center gap-1">
                            <button
                                onClick={() => scroll(-1)}
                                className="w-7 h-7 rounded-full bg-base-300 hover:bg-base-200
                                           flex items-center justify-center transition-colors duration-150
                                           text-base-content/60 hover:text-base-content"
                                aria-label="Scroll left">
                                <ChevronLeft size={15} />
                            </button>
                            <button
                                onClick={() => scroll(1)}
                                className="w-7 h-7 rounded-full bg-base-300 hover:bg-base-200
                                           flex items-center justify-center transition-colors duration-150
                                           text-base-content/60 hover:text-base-content"
                                aria-label="Scroll right">
                                <ChevronRight size={15} />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* ── Scroll container ── */}
            <div ref={rowRef} className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                {loading
                    ? Array.from({ length: skeletonCount }).map((_, i) => <MediaCardSkeleton key={i} />)
                    : items.map((item) => {
                          const key = item.id ?? item.seriesKey ?? item.title;
                          return <MediaCard key={key} item={item} onPlay={onPlay} onWatchTrailer={onWatchTrailer} />;
                      })}
            </div>
        </section>
    );
}
