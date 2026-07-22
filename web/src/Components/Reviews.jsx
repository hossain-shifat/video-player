import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Star, ThumbsUp, X, Calendar, User, Quote } from "lucide-react";

const Profile_IMG = "https://image.tmdb.org/t/p/w45";

// ─── Shared TMDB review fetch ─────────────────────────────────────────────────
async function fetchReview(reviewId) {
    const key = import.meta.env.VITE_TMDB_API_KEY;
    if (!key) return null;
    const r = await fetch(`https://api.themoviedb.org/3/review/${reviewId}?api_key=${key}&language=en-US`);
    if (!r.ok) return null;
    return r.json();
}

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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose} style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)" }}>
            <div
                role="dialog"
                aria-modal="true"
                aria-label={`Review by ${data.author}`}
                className="relative w-full max-w-xl bg-base-200 rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden"
                style={{ maxHeight: "70vh", boxShadow: "0 24px 60px rgba(0,0,0,0.5)" }}
                onClick={(e) => e.stopPropagation()}>
                {/* ── Header ── */}
                <div className="flex items-start gap-3.5 px-6 pt-6 pb-4 border-b border-white/8 shrink-0 bg-base-300/30">
                    {avatarUrl ? (
                        <img src={avatarUrl} alt={data.author} className="w-12 h-12 rounded-full object-cover ring-2 ring-primary/25 shrink-0" />
                    ) : (
                        <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center ring-2 ring-primary/25 shrink-0">
                            <User size={18} className="text-primary" />
                        </div>
                    )}
                    <div className="flex-1 min-w-0 pt-0.5">
                        <p className="text-base font-bold text-white leading-tight truncate">{data.author}</p>
                        {date && (
                            <span className="flex items-center gap-1 text-[11px] text-base-content/60 mt-1">
                                <Calendar size={10} /> {date}
                            </span>
                        )}
                    </div>
                    {rating != null && (
                        <div className="flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl bg-base-100 border border-white/8 shrink-0">
                            <StarRating rating={rating} size={11} />
                            <span className="text-[11px] font-bold text-white/90 leading-none">{rating}/10</span>
                        </div>
                    )}
                </div>

                {/* Close */}
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-base-100 hover:bg-white/10 border border-white/8 flex items-center justify-center transition-colors shrink-0 cursor-pointer"
                    aria-label="Close">
                    <X size={14} className="text-base-content/70" />
                </button>

                {/* ── Scrollable body — no scrollbar ── */}
                <div className="relative flex-1 overflow-y-auto px-6 py-5" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                    <style>{`div::-webkit-scrollbar { display: none; }`}</style>
                    <Quote size={40} className="text-primary/10 absolute top-3 right-4 pointer-events-none" fill="currentColor" />
                    <p className="relative text-[13.5px] text-base-content/92 leading-relaxed whitespace-pre-line">{data.content}</p>
                </div>

                {/* ── Footer ── */}
                <div className="flex items-center justify-between px-6 py-3.5 border-t border-white/8 shrink-0 bg-base-300/25">
                    <button className="flex items-center gap-1.5 text-[11px] font-semibold text-base-content/60 hover:text-primary transition-colors cursor-pointer">
                        <ThumbsUp size={12} />
                        <span>Helpful</span>
                    </button>
                    <button onClick={onClose} className="text-[11px] font-bold text-primary-content bg-primary hover:bg-primary/85 transition-colors cursor-pointer px-4 py-1.5 rounded-full">
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Review Card ──────────────────────────────────────────────────────────────
function ReviewCard({ data, featured }) {
    const [modalOpen, setModalOpen] = useState(false);
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
                className={`relative shrink-0 w-72 sm:w-80 bg-base-200 rounded-2xl border flex flex-col p-4 gap-3 select-text transition-all duration-200 ${
                    featured ? "border-primary/25" : "border-white/6"
                } ${isLong ? "cursor-pointer hover:border-primary/25 hover:bg-base-300/50 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/20" : ""}`}
                onClick={() => isLong && setModalOpen(true)}>
                {featured && (
                    <span className="absolute -top-2.5 left-4 text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-primary text-primary-content shadow-md">Most detailed</span>
                )}
                {/* Header */}
                <div className="flex items-center gap-2.5 min-w-0">
                    {avatarUrl ? (
                        <img src={avatarUrl} alt={data.author} className="w-9 h-9 rounded-full object-cover shrink-0 ring-1 ring-white/10" />
                    ) : (
                        <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center shrink-0 ring-1 ring-white/10">
                            <span className="text-sm font-bold text-primary">{(data.author || "?")[0].toUpperCase()}</span>
                        </div>
                    )}
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-white truncate leading-tight">{data.author}</p>
                        {date && <p className="text-[11px] text-base-content/65 leading-tight mt-0.5">{date}</p>}
                    </div>
                </div>

                {/* Preview text */}
                <div className="flex-1">
                    <p className="text-xs text-base-content/85 leading-relaxed">{preview}</p>
                    {isLong && (
                        <span className="text-[11px] text-primary mt-1.5 inline-flex items-center gap-0.5 font-bold">
                            Read full review <ChevronRight size={11} />
                        </span>
                    )}
                </div>

                {/* Footer — rating stars + helpful, bottom-aligned */}
                <div className="pt-2.5 border-t border-white/6 flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-base-content/60">
                        <ThumbsUp size={11} />
                        <span className="text-[11px] font-medium">Helpful</span>
                    </div>
                    {rating != null && (
                        <div className="flex items-center gap-1.5 pl-2 pr-2.5 py-1.5 rounded-full bg-base-300/70 border border-white/8 shrink-0">
                            <StarRating rating={rating} size={10} />
                            <span className="text-[11px] font-bold text-white/90">{rating}</span>
                        </div>
                    )}
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
    const [sorted, setSorted] = useState(null); // null = still loading
    const reviewsKey = reviews?.join(",") ?? "";

    useEffect(() => {
        if (!reviews?.length) {
            setSorted([]);
            return;
        }
        let cancelled = false;
        setSorted(null);
        Promise.all(reviews.map((rid) => fetchReview(rid))).then((results) => {
            if (cancelled) return;
            const valid = results.filter(Boolean);
            // Longest review (by word count) surfaces first
            valid.sort((a, b) => (b.content || "").trim().split(/\s+/).length - (a.content || "").trim().split(/\s+/).length);
            setSorted(valid);
        });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reviewsKey]);

    if (!reviews?.length) return null;

    const scroll = (dir) => scrollRef.current?.scrollBy({ left: dir * 350, behavior: "smooth" });

    return (
        <section className="w-full">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2.5 tracking-tight">
                    <span className="w-1 h-5 rounded-full bg-primary shrink-0" />
                    <Star size={18} className="text-primary shrink-0" />
                    Ratings &amp; Reviews
                    <span className="text-sm font-medium text-white/60">({reviews.length})</span>
                </h2>
                <div className="flex gap-1.5">
                    <button
                        onClick={() => scroll(-1)}
                        className="w-8 h-8 rounded-full bg-base-200 hover:bg-base-300 border border-white/5 flex items-center justify-center transition-colors cursor-pointer"
                        aria-label="Scroll left">
                        <ChevronLeft size={14} className="text-base-content/70" />
                    </button>
                    <button
                        onClick={() => scroll(1)}
                        className="w-8 h-8 rounded-full bg-base-200 hover:bg-base-300 border border-white/5 flex items-center justify-center transition-colors cursor-pointer"
                        aria-label="Scroll right">
                        <ChevronRight size={14} className="text-base-content/70" />
                    </button>
                </div>
            </div>

            <div ref={scrollRef} className="flex gap-3 overflow-x-auto pt-2.5 pb-2" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                {sorted === null
                    ? reviews.map((rid) => <div key={rid} className="shrink-0 w-72 sm:w-80 h-48 bg-base-200 rounded-2xl border border-white/6 animate-pulse" />)
                    : sorted.map((data, i) => <ReviewCard key={data.id ?? i} data={data} featured={i === 0} />)}
            </div>
        </section>
    );
}
