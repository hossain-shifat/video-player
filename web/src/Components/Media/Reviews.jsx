import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Star, StarHalf, ThumbsUp, X, Calendar, User, Quote, Heart, MessageSquare } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getPopularReviews, getPopularDiscussions } from "../../Api/reviews";

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
function StarRating({ rating, max = 10, size = 13, light = false }) {
    if (rating == null) return null;
    const exact = (rating / max) * 5;
    const full = Math.floor(exact);
    const hasHalf = exact - full >= 0.25 && exact - full < 0.75;
    const roundedFull = exact - full >= 0.75 ? full + 1 : full;
    return (
        <div className="flex items-center gap-0.5">
            {Array.from({ length: 5 }).map((_, i) => {
                const on = light ? "text-white fill-white" : "text-warning fill-warning";
                const off = light ? "text-white/35 fill-white/10" : "text-base-content/20 fill-base-content/10";
                if (i < roundedFull) return <Star key={i} size={size} className={on} />;
                if (i === roundedFull && hasHalf) return <StarHalf key={i} size={size} className={on} />;
                return <Star key={i} size={size} className={off} />;
            })}
        </div>
    );
}

// ─── Review Modal ─────────────────────────────────────────────────────────────
export function ReviewModal({ data, onClose }) {
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
                    <div className="flex items-center gap-3">
                        <button className="flex items-center gap-1.5 text-[11px] font-semibold text-base-content/60 hover:text-primary transition-colors cursor-pointer">
                            <ThumbsUp size={12} />
                            <span>Helpful</span>
                        </button>
                        {rating != null && (
                            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-base-100 border border-white/8">
                                <StarRating rating={rating} size={10} />
                                <span className="text-[11px] font-bold text-white/90 leading-none">{((rating / 10) * 5).toFixed(1)}</span>
                            </div>
                        )}
                    </div>
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
                            <span className="text-[11px] font-bold text-white/90">{((rating / 10) * 5).toFixed(1)}</span>
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
const REVIEW_BATCH = 12; // reviews fetched per batch — the backend stores every id, so never fetch them all at once

export default function Reviews({ reviews, tmdbId, mediaType }) {
    const scrollRef = useRef(null);
    const cacheRef = useRef(new Map()); // review id → full review (never fetched twice)
    const [sorted, setSorted] = useState(null); // null = still loading
    const [limit, setLimit] = useState(REVIEW_BATCH);
    const [loadingMore, setLoadingMore] = useState(false);
    const reviewsKey = reviews?.join(",") ?? "";

    // new title → start over from the first batch
    useEffect(() => {
        cacheRef.current = new Map();
        setLimit(REVIEW_BATCH);
    }, [reviewsKey]);

    useEffect(() => {
        if (!reviews?.length) {
            setSorted([]);
            return;
        }
        let cancelled = false;
        const wanted = reviews.slice(0, limit);
        const missing = wanted.filter((rid) => !cacheRef.current.has(rid));
        if (!missing.length && sorted !== null) return undefined;
        if (sorted === null || limit === REVIEW_BATCH) setSorted(null);
        Promise.allSettled(missing.map((rid) => fetchReview(rid)))
            .then((results) => {
                if (cancelled) return;
                results.forEach((r, i) => cacheRef.current.set(missing[i], r.status === "fulfilled" ? r.value : null));
                const valid = wanted.map((rid) => cacheRef.current.get(rid)).filter(Boolean);
                // Longest review (by word count) surfaces first
                valid.sort((a, b) => (b.content || "").trim().split(/\s+/).length - (a.content || "").trim().split(/\s+/).length);
                setSorted(valid);
                setLoadingMore(false);
            })
            .catch(() => {
                if (!cancelled) {
                    setSorted((prev) => prev ?? []);
                    setLoadingMore(false);
                }
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reviewsKey, limit]);

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
                {sorted !== null && reviews.length > limit && (
                    <button
                        type="button"
                        onClick={() => {
                            setLoadingMore(true);
                            setLimit((l) => l + REVIEW_BATCH);
                        }}
                        disabled={loadingMore}
                        className="shrink-0 w-40 bg-base-200 hover:bg-base-300 rounded-2xl border border-white/6 flex flex-col items-center justify-center gap-1 text-xs font-bold text-primary transition-colors cursor-pointer disabled:opacity-60">
                        {loadingMore ? "Loading…" : `Load more`}
                        {!loadingMore && <span className="text-[11px] font-medium text-base-content/60">{reviews.length - limit} left</span>}
                    </button>
                )}
            </div>
        </section>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// POPULAR REVIEWS / POPULAR DISCUSSIONS — Plex-style tall cards
// ═════════════════════════════════════════════════════════════════════════════
// <PopularReviews items={[...]} loading />   (this file)
// <PopularDiscussions items={[...]} loading /> (PopularDiscussions.jsx — re-uses PopularCardShell/PopularRow below)
//
// media shape (both):  { id, title, backdrop?, poster?, logo? }
// review item:         { id, author, avatar?, rating? (0–10), content, createdAt, likes?, comments?, media }
// ═════════════════════════════════════════════════════════════════════════════

const dominantCache = new Map(); // art url → [r, g, b] | null

// Average colour of the artwork (16×16 sample, near-black / near-white ignored) → card tint, like Plex.
// Falls back to the neutral theme tint if the image host blocks canvas reads (no CORS).
function useDominantColor(src) {
    const [rgb, setRgb] = useState(() => (src ? (dominantCache.get(src) ?? null) : null));
    useEffect(() => {
        if (!src) {
            setRgb(null);
            return undefined;
        }
        if (dominantCache.has(src)) {
            setRgb(dominantCache.get(src));
            return undefined;
        }
        let alive = true;
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            let out = null;
            try {
                const c = document.createElement("canvas");
                c.width = c.height = 16;
                const ctx = c.getContext("2d", { willReadFrequently: true });
                ctx.drawImage(img, 0, 0, 16, 16);
                const d = ctx.getImageData(0, 0, 16, 16).data;
                let r = 0;
                let g = 0;
                let b = 0;
                let n = 0;
                for (let i = 0; i < d.length; i += 4) {
                    const lum = (d[i] + d[i + 1] + d[i + 2]) / 3;
                    if (lum < 24 || lum > 230) continue;
                    r += d[i];
                    g += d[i + 1];
                    b += d[i + 2];
                    n++;
                }
                if (n) out = [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
            } catch {
                /* canvas tainted — keep the neutral tint */
            }
            dominantCache.set(src, out);
            if (alive) setRgb(out);
        };
        img.onerror = () => dominantCache.set(src, null);
        img.src = src;
        return () => {
            alive = false;
        };
    }, [src]);
    return rgb;
}

const fmtCount = (n) => (n == null ? null : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
const fmtLongDate = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : null);

/**
 * PopularCardShell — the one card layout used by BOTH Popular Reviews and Popular Discussions.
 *   media     { title, backdrop, poster, logo }  → art + title logo on top
 *   headline  string   → bold thread title (discussions); omit for reviews
 *   rating    0–10     → big centred stars (reviews); omit for discussions
 *   body      string   → quote / excerpt
 *   author, avatar, date, likes, comments, onMore
 */
export function PopularCardShell({ media, headline, rating, body, author, avatar, date, likes, comments, onMore, bodyLines = 3 }) {
    const art = media?.backdrop || media?.poster || null;
    const rgb = useDominantColor(art);
    const tint = rgb ? `rgb(${Math.round(rgb[0] * 0.3)}, ${Math.round(rgb[1] * 0.3)}, ${Math.round(rgb[2] * 0.3)})` : "var(--color-base-300)";
    const [artError, setArtError] = useState(false);
    const [avatarError, setAvatarError] = useState(false);
    const [liked, setLiked] = useState(false);
    const mask = "linear-gradient(to bottom, #000 30%, transparent 100%)";
    const clamp = bodyLines === 2 ? "line-clamp-2" : "line-clamp-3";

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onMore}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onMore?.()}
            className="group relative h-90 w-72 shrink-0 cursor-pointer select-none overflow-hidden rounded-2xl ring-1 ring-white/5 transition-all duration-200 hover:-translate-y-0.5 hover:ring-2 hover:ring-white/80 sm:w-80"
            style={{ background: tint }}>
            {/* artwork, fading into the tint */}
            {art && !artError && (
                <img
                    src={art}
                    alt=""
                    loading="lazy"
                    draggable={false}
                    onError={() => setArtError(true)}
                    className="absolute inset-x-0 top-0 h-[62%] w-full object-cover"
                    style={{ WebkitMaskImage: mask, maskImage: mask }}
                />
            )}

            {/* title art */}
            <div className="absolute inset-x-0 top-[14%] flex justify-center px-6">
                {media?.logo ? (
                    <img src={media.logo} alt={media.title || ""} className="max-h-16 max-w-[78%] object-contain drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]" draggable={false} />
                ) : (
                    <p className="line-clamp-2 text-center text-2xl font-extrabold leading-tight tracking-tight text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]">{media?.title}</p>
                )}
            </div>

            {/* content */}
            <div className="absolute inset-x-0 bottom-0 flex flex-col">
                <div className="flex flex-col gap-2 px-4 pb-3">
                    {rating != null && (
                        <div className="flex justify-center">
                            <StarRating rating={rating} size={22} light />
                        </div>
                    )}
                    {headline && <p className="line-clamp-2 text-lg font-bold leading-snug text-white">{headline}</p>}
                    <p className={`${clamp} text-[13px] leading-snug ${headline ? "text-white/65" : "text-white/85"}`}>{body}</p>

                    <div className="mt-1 flex min-w-0 items-center gap-2.5">
                        {avatar && !avatarError ? (
                            <img src={avatar} alt={author} onError={() => setAvatarError(true)} className="h-10 w-10 shrink-0 rounded-full object-cover ring-1 ring-white/15" draggable={false} />
                        ) : (
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15 text-sm font-bold text-white">{(author || "?")[0].toUpperCase()}</div>
                        )}
                        <div className="min-w-0 leading-tight">
                            <p className="truncate text-[11px] text-white/80">{author}</p>
                            <p className="truncate text-[11px] font-semibold text-white">{media?.title}</p>
                            {date && <p className="truncate text-[11px] text-white/55">{fmtLongDate(date)}</p>}
                        </div>
                    </div>
                </div>

                {/* footer bar */}
                <div className="flex h-10 items-stretch border-t border-white/10 bg-black/25 text-[12px] text-white/80">
                    <button
                        type="button"
                        aria-label="Like"
                        onClick={(e) => {
                            e.stopPropagation();
                            setLiked((v) => !v);
                        }}
                        className="flex w-10 cursor-pointer items-center justify-center border-r border-white/10 hover:text-white">
                        <ThumbsUp size={14} className={liked ? "fill-white text-white" : ""} />
                    </button>
                    {likes != null && (
                        <div className="flex items-center gap-1.5 border-r border-white/10 px-3">
                            <span className="flex -space-x-1">
                                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-pink-500 ring-1 ring-black/30">
                                    <Heart size={9} className="fill-white text-white" />
                                </span>
                                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-sky-500 ring-1 ring-black/30">
                                    <ThumbsUp size={9} className="fill-white text-white" />
                                </span>
                            </span>
                            <span className="font-medium tabular-nums">{fmtCount(likes + (liked ? 1 : 0))}</span>
                        </div>
                    )}
                    {comments != null && (
                        <div className="flex items-center gap-1.5 border-r border-white/10 px-3">
                            <MessageSquare size={13} />
                            <span className="font-semibold tabular-nums text-white">{fmtCount(comments)}</span>
                        </div>
                    )}
                    <span className="flex flex-1 items-center justify-end gap-0.5 pr-4 font-semibold text-white">
                        More <ChevronRight size={14} />
                    </span>
                </div>
            </div>
        </div>
    );
}

function PopularCardSkeleton() {
    return <div className="h-90 w-72 shrink-0 animate-pulse rounded-2xl bg-base-300 sm:w-80" />;
}

/** PopularRow — header + scroll arrows + skeleton row. `renderCard(item)` returns the card. Hidden when empty. */
export function PopularRow({ title, items = [], loading = false, renderCard, skeletonCount = 4 }) {
    const rowRef = useRef(null);
    if (!loading && !items.length) return null;
    const scroll = (dir) => rowRef.current?.scrollBy({ left: dir * 520, behavior: "smooth" });

    return (
        <section className="relative">
            <div className="mb-3 flex items-center justify-between">
                {loading ? <div className="h-5 w-36 animate-pulse rounded bg-base-300" /> : <h2 className="text-base font-semibold text-base-content sm:text-lg">{title}</h2>}
                {!loading && (
                    <div className="hidden items-center gap-1 sm:flex">
                        <button
                            onClick={() => scroll(-1)}
                            className="flex h-7 w-7 items-center justify-center rounded-full bg-base-300 text-base-content/60 transition-colors duration-150 hover:bg-base-200 hover:text-base-content"
                            aria-label="Scroll left">
                            <ChevronLeft size={15} />
                        </button>
                        <button
                            onClick={() => scroll(1)}
                            className="flex h-7 w-7 items-center justify-center rounded-full bg-base-300 text-base-content/60 transition-colors duration-150 hover:bg-base-200 hover:text-base-content"
                            aria-label="Scroll right">
                            <ChevronRight size={15} />
                        </button>
                    </div>
                )}
            </div>
            <div ref={rowRef} className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                {loading ? Array.from({ length: skeletonCount }).map((_, i) => <PopularCardSkeleton key={i} />) : items.map((item) => renderCard(item))}
            </div>
        </section>
    );
}

// ReviewModal expects the TMDB review shape — adapt a popular item to it.
// (a full avatar URL gets a leading "/" because ReviewModal strips "/https…" and prefixes everything else)
export function popularToModalShape(it, headline) {
    const av = it.avatar ? (String(it.avatar).startsWith("http") ? `/${it.avatar}` : it.avatar) : null;
    return {
        author: it.author,
        author_details: { avatar_path: av, rating: it.rating ?? null },
        content: headline ? `${headline}\n\n${it.content ?? it.body ?? ""}` : (it.content ?? it.body ?? ""),
        created_at: it.createdAt,
    };
}

/**
 * usePopularFeed("reviews" | "discussions") — reads the server's cached Home feed.
 * While the server is still doing its very first build (`building: true`, no items) it re-checks every 15 s.
 */
export function usePopularFeed(kind, enabled = true) {
    return useQuery({
        queryKey: ["popular", kind],
        queryFn: kind === "reviews" ? getPopularReviews : getPopularDiscussions,
        enabled,
        select: (d) => d?.items ?? [],
        staleTime: 30 * 60 * 1000,
        refetchInterval: (q) => (q.state.data?.building && !q.state.data?.items?.length ? 15000 : false),
    });
}

/**
 * PopularReviews — Plex "Popular Reviews" row for the HOME page.
 * Drop it in with no props (<PopularReviews />) and it fetches its own data and hides itself when there is none.
 * Props (optional): items / loading to render your own list instead, title.
 */
export function PopularReviews({ items, loading, title = "Popular Reviews" }) {
    const feed = usePopularFeed("reviews", items === undefined);
    const rows = items ?? feed.data ?? [];
    const busy = loading ?? (items === undefined && feed.isLoading);
    const [open, setOpen] = useState(null);
    return (
        <>
            <PopularRow
                title={title}
                items={rows}
                loading={busy}
                renderCard={(it) => (
                    <PopularCardShell
                        key={it.id}
                        media={it.media}
                        rating={it.rating}
                        body={it.content}
                        author={it.author}
                        avatar={it.avatar}
                        date={it.createdAt}
                        likes={it.likes}
                        comments={it.comments}
                        onMore={() => setOpen(it)}
                    />
                )}
            />
            {open && <ReviewModal data={popularToModalShape(open)} onClose={() => setOpen(null)} />}
        </>
    );
}
