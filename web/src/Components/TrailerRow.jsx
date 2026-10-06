import { useRef } from "react";
import { ChevronRight, ChevronLeft } from "lucide-react";
import TrailerCard from "./TrailerCard";

function TrailerCardSkeleton() {
    return (
        <div className="shrink-0 w-56 sm:w-64 my-2 ml-0.5">
            <div className="w-full aspect-video rounded-xl bg-base-300 animate-pulse" />
            <div className="mt-2 px-0.5 space-y-2">
                <div className="h-3 w-3/4 rounded bg-base-300 animate-pulse" />
            </div>
        </div>
    );
}

/**
 * TrailerRow — presentational only, no data fetching in here.
 *
 * Plex shows two rows over the SAME discover feed (Trending Trailers, New
 * Trailers) — just different sort orders. Fetching per-row would hit
 * /api/trailers/discover twice and double the cold-cache TMDB/YouTube work
 * for zero benefit, so Home.jsx fetches once via useTrailers() and hands
 * each row whichever ordering it needs.
 *
 * Props: title, items, loading, skeletonCount (default 6)
 */
export default function TrailerRow({ title, items = [], loading = false, skeletonCount = 6 }) {
    const rowRef = useRef(null);

    const scroll = (dir) => {
        const el = rowRef.current;
        if (!el) return;
        el.scrollBy({ left: dir * 480, behavior: "smooth" });
    };

    // Hide entirely when not loading and nothing to show — same as MediaRow
    if (!loading && !items.length) return null;

    return (
        <section className="relative">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    {loading ? (
                        <div className="h-5 w-32 rounded bg-base-300 animate-pulse" />
                    ) : (
                        <>
                            <h2 className="text-base sm:text-lg font-semibold text-base-content">{title}</h2>
                            <span className="text-xs text-primary bg-primary/10 badge badge-primary font-medium px-2 py-0.5 rounded-full">{items.length}</span>
                        </>
                    )}
                </div>

                {!loading && (
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
                )}
            </div>

            <div ref={rowRef} className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                {loading ? Array.from({ length: skeletonCount }).map((_, i) => <TrailerCardSkeleton key={i} />) : items.map((item) => <TrailerCard key={`${item.type}:${item.tmdbId}`} item={item} />)}
            </div>
        </section>
    );
}
