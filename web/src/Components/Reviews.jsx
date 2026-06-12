import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Star, ThumbsUp, X, Calendar, User } from "lucide-react";

const Profile_IMG = "https://image.tmdb.org/t/p/w45";

// ─── Star Rating ──────────────────────────────────────────────────────────────
function StarRating({ rating, max = 10, size = 13 }) {
    const stars = rating != null ? Math.round((rating / max) * 5) : null;
    if (stars == null) return null;
    return (
        <div className="flex items-center gap-0.5">
            {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} size={size} className={i < stars ? "text-warning fill-warning" : "text-base-content/20 fill-base-content/10"} />
            ))}
        </div>
    );
}

// ─── Review Modal ─────────────────────────────────────────────────────────────
function ReviewModal({ data, onClose }) {
    useEffect(() => {
        const onKey = (e) => e.key === "Escape" && onClose();
        document.addEventListener("keydown", onKey);
        // lock body scroll
        document.body.style.overflow = "hidden";
        return () => {
            document.removeEventListener("keydown", onKey);
            document.body.style.overflow = "";
        };
    }, [onClose]);

    if (!data) return null;

    const avatarPath = data.author_details?.avatar_path;
    const avatarUrl = avatarPath ? (avatarPath.startsWith("/https") ? avatarPath.slice(1) : `${Profile_IMG}${avatarPath}`) : null;
    const rating = data.author_details?.rating ?? null;
    const date = data.created_at
        ? new Date(data.created_at).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
          })
        : null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose} style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}>
            <div className="relative w-full max-w-lg bg-base-200 rounded-2xl border border-white/8 shadow-2xl flex flex-col" style={{ maxHeight: "55vh" }} onClick={(e) => e.stopPropagation()}>
                {/* ── Header ── */}
                <div className="flex items-center gap-2.5 px-4 py-3 border-b border-white/6 shrink-0">
                    {avatarUrl ? (
                        <img src={avatarUrl} alt={data.author} className="w-8 h-8 rounded-full object-cover ring-1 ring-white/10 shrink-0" />
                    ) : (
                        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center ring-1 ring-white/10 shrink-0">
                            <User size={14} className="text-primary" />
                        </div>
                    )}
                    <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-white truncate">{data.author}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                            {date && (
                                <span className="flex items-center gap-1 text-[10px] text-base-content/40">
                                    <Calendar size={9} /> {date}
                                </span>
                            )}
                            {rating != null && <StarRating rating={rating} size={10} />}
                        </div>
                    </div>
                    <button onClick={onClose} className="w-6 h-6 rounded-full bg-base-300 hover:bg-base-100 flex items-center justify-center transition-colors shrink-0" aria-label="Close">
                        <X size={12} className="text-base-content/60" />
                    </button>
                </div>

                {/* ── Scrollable body — no scrollbar ── */}
                <div className="flex-1 overflow-y-auto px-4 py-3" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                    <style>{`div::-webkit-scrollbar { display: none; }`}</style>
                    <p className="text-xs text-base-content/70 leading-relaxed whitespace-pre-line">{data.content}</p>
                </div>

                {/* ── Footer ── */}
                <div className="flex items-center justify-between px-4 py-2 border-t border-white/6 shrink-0">
                    <div className="flex items-center gap-1 text-[11px] text-base-content/35">
                        <ThumbsUp size={11} />
                        <span>Helpful</span>
                    </div>
                    <button onClick={onClose} className="text-[11px] text-base-content/45 hover:text-base-content transition-colors">
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Review Card ──────────────────────────────────────────────────────────────
function ReviewCard({ reviewId }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);

    useEffect(() => {
        if (!reviewId) {
            setLoading(false);
            return;
        }
        const key = import.meta.env.VITE_TMDB_API_KEY;
        if (!key) {
            setLoading(false);
            return;
        }
        let cancelled = false;
        fetch(`https://api.themoviedb.org/3/review/${reviewId}?api_key=${key}&language=en-US`)
            .then((r) => {
                if (!r.ok) throw new Error("not ok");
                return r.json();
            })
            .then((d) => {
                if (!cancelled) {
                    setData(d);
                    setLoading(false);
                }
            })
            .catch(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [reviewId]);

    if (loading) {
        return <div className="shrink-0 w-72 sm:w-80 h-48 bg-base-200 rounded-2xl border border-white/5 animate-pulse" />;
    }
    if (!data) return null;

    const avatarPath = data.author_details?.avatar_path;
    const avatarUrl = avatarPath ? (avatarPath.startsWith("/https") ? avatarPath.slice(1) : `${Profile_IMG}${avatarPath}`) : null;
    const rating = data.author_details?.rating ?? null;
    const date = data.created_at
        ? new Date(data.created_at).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
          })
        : null;
    const reviewText = data.content || "";
    const isLong = reviewText.length > 220;
    const preview = isLong ? reviewText.slice(0, 220).trimEnd() + "…" : reviewText;

    return (
        <>
            <div
                className={`shrink-0 w-72 sm:w-80 bg-base-200 rounded-2xl border border-white/6 flex flex-col p-4 gap-3 select-text transition-colors ${
                    isLong ? "cursor-pointer hover:border-white/15 hover:bg-base-300/60" : ""
                }`}
                onClick={() => isLong && setModalOpen(true)}>
                {/* Header */}
                <div className="flex items-center gap-2.5 min-w-0">
                    {avatarUrl ? (
                        <img src={avatarUrl} alt={data.author} className="w-9 h-9 rounded-full object-cover shrink-0 ring-1 ring-white/10" />
                    ) : (
                        <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center shrink-0 ring-1 ring-white/10">
                            <span className="text-sm font-bold text-primary">{(data.author || "?")[0].toUpperCase()}</span>
                        </div>
                    )}
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-white truncate leading-tight">{data.author}</p>
                        {date && <p className="text-[11px] text-base-content/40 leading-tight">{date}</p>}
                    </div>
                </div>

                {/* Stars */}
                {rating != null && <StarRating rating={rating} />}

                {/* Preview text */}
                <div className="flex-1">
                    <p className="text-xs text-base-content/65 leading-relaxed">{preview}</p>
                    {isLong && <span className="text-[11px] text-primary mt-1.5 inline-flex items-center gap-0.5 font-medium">Read more</span>}
                </div>

                {/* Footer */}
                <div className="pt-1 border-t border-white/5 flex items-center gap-1.5">
                    <ThumbsUp size={12} className="text-base-content/25" />
                </div>
            </div>

            {modalOpen && <ReviewModal data={data} onClose={() => setModalOpen(false)} />}
        </>
    );
}

// ─── Reviews (exported) ───────────────────────────────────────────────────────
/**
 * Props:
 *   reviews   {string[]}  — array of TMDB review IDs
 *   tmdbId    {number}    — TMDB item ID (unused here, kept for future)
 *   mediaType {string}    — "movie" | "tv"
 */
export default function Reviews({ reviews, tmdbId, mediaType }) {
    const scrollRef = useRef(null);
    if (!reviews?.length) return null;

    const scroll = (dir) => scrollRef.current?.scrollBy({ left: dir * 350, behavior: "smooth" });

    return (
        <section className="w-full">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-base sm:text-lg font-semibold text-white flex items-center gap-2">
                    <Star size={18} className="text-primary" />
                    Ratings &amp; Reviews
                </h2>
                <div className="flex gap-1">
                    <button onClick={() => scroll(-1)} className="w-7 h-7 rounded-full bg-base-300 hover:bg-base-200 flex items-center justify-center transition-colors" aria-label="Scroll left">
                        <ChevronLeft size={14} className="text-base-content/60 hover:text-primary" />
                    </button>
                    <button onClick={() => scroll(1)} className="w-7 h-7 rounded-full bg-base-300 hover:bg-base-200 flex items-center justify-center transition-colors" aria-label="Scroll right">
                        <ChevronRight size={14} className="text-base-content/60 hover:text-primary" />
                    </button>
                </div>
            </div>

            <div ref={scrollRef} className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                {reviews.map((rid) => (
                    <ReviewCard key={rid} reviewId={rid} />
                ))}
            </div>
        </section>
    );
}
