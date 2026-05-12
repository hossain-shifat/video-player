import { useRef } from "react";
import { ChevronRight, ChevronLeft } from "lucide-react";
import MediaCard from "./MediaCard";

/**
 * MediaRow
 * --------
 * A labelled horizontal-scroll row of MediaCards.
 *
 * Props:
 *   title       — section heading e.g. "Movies"
 *   items       — raw array from the API (movies OR series items)
 *   onPlay      — (rawItem) => void
 *   onWatchTrailer — (normalisedItem) => void
 *   viewAllTo   — optional route string rendered as a "See all →" link
 */
export default function MediaRow({ title, items = [], onPlay, onWatchTrailer, viewAllTo }) {
    const rowRef = useRef(null);

    const scroll = (dir) => {
        const el = rowRef.current;
        if (!el) return;
        el.scrollBy({ left: dir * 480, behavior: "smooth" });
    };

    if (!items.length) return null;

    return (
        <section className="relative">
            {/* ── Section header ── */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <h2 className="text-base sm:text-lg font-semibold text-base-content">{title}</h2>
                    <span className="text-xs text-base-content/35 font-medium bg-base-300 px-2 py-0.5 rounded-full">{items.length}</span>
                </div>

                <div className="flex items-center gap-2">
                    {viewAllTo && (
                        <a href={viewAllTo} className="text-xs text-primary hover:text-primary/80 font-medium transition-colors flex items-center gap-0.5">
                            See all <ChevronRight size={13} />
                        </a>
                    )}

                    {/* Scroll arrows — hidden on mobile */}
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
            </div>

            {/* ── Scroll container ── */}
            <div ref={rowRef} className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                {items.map((item) => {
                    // Use a stable key that works for both movies and series
                    const key = item.id ?? item.seriesKey ?? item.title;
                    return <MediaCard key={key} item={item} onPlay={onPlay} onWatchTrailer={onWatchTrailer} />;
                })}
            </div>
        </section>
    );
}
