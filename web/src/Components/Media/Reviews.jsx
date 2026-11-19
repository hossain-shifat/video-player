import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ChevronLeft, ChevronRight, MessageSquare, Heart, ThumbsUp, ThumbsDown, Star, PenLine, X } from "lucide-react";
import { useAuth } from "../../Auth/AuthContext";
import { useAuthModal } from "../../Auth/AuthModalContext";
import { useTitleReviews, useCreateReview, useUpdateReview, useReact, usePopularFeed } from "../../Hooks/Query/useReviews";
import { StarRating, Avatar, useDominantColor, seedReactions, seedCount, fmtCount, fmtLongDate, smartDate } from "./ReviewThread";

export { usePopularFeed };

// ─── write / edit a review ────────────────────────────────────────────────────

function StarInput({ value, onChange }) {
    const [hover, setHover] = useState(0);
    const shown = hover || value;
    return (
        <div className="flex items-center gap-1" onMouseLeave={() => setHover(0)}>
            {[1, 2, 3, 4, 5].map((n) => (
                <button
                    key={n}
                    type="button"
                    aria-label={`${n} star${n > 1 ? "s" : ""}`}
                    onMouseEnter={() => setHover(n)}
                    onClick={() => onChange(n)}
                    className="cursor-pointer p-0.5 transition-transform hover:scale-110">
                    <Star size={30} className={n <= shown ? "fill-warning text-warning" : "fill-base-content/10 text-base-content/25"} />
                </button>
            ))}
        </div>
    );
}

export function WriteReviewModal({ kind, tmdbId, meta, existing, onClose }) {
    const create = useCreateReview(kind, tmdbId);
    const update = useUpdateReview();
    const [stars, setStars] = useState(existing?.rating ? Math.ceil(existing.rating / 2) : 0);
    const [text, setText] = useState(existing?.content || "");
    const [error, setError] = useState("");
    const pending = create.isPending || update.isPending;

    useEffect(() => {
        const onKey = (e) => e.key === "Escape" && onClose();
        document.addEventListener("keydown", onKey);
        document.body.style.overflow = "hidden";
        return () => {
            document.removeEventListener("keydown", onKey);
            document.body.style.overflow = "";
        };
    }, [onClose]);

    const submit = () => {
        setError("");
        if (!stars) return setError("Pick a star rating first.");
        if (text.trim().length < 10) return setError("Write at least 10 characters.");
        const done = { onSuccess: onClose, onError: (e) => setError(e?.message || "Could not save your review.") };
        if (existing) update.mutate({ id: existing.id, rating: stars * 2, content: text }, done);
        else create.mutate({ rating: stars * 2, content: text, title: meta.title, poster: meta.poster, backdrop: meta.backdrop }, done);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose} style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)" }}>
            <div
                role="dialog"
                aria-modal="true"
                aria-label="Write a review"
                className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-base-200 shadow-2xl"
                onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between border-b border-white/8 bg-base-300/30 px-6 py-4">
                    <div className="min-w-0">
                        <p className="truncate text-base font-bold text-white">{existing ? "Edit your review" : "Write a review"}</p>
                        {meta.title && <p className="truncate text-[11px] text-base-content/60">{meta.title}</p>}
                    </div>
                    <button onClick={onClose} aria-label="Close" className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-white/8 bg-base-100 hover:bg-white/10">
                        <X size={14} className="text-base-content/70" />
                    </button>
                </div>

                <div className="space-y-4 px-6 py-5">
                    <div>
                        <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-base-content/55">Your rating</p>
                        <StarInput value={stars} onChange={setStars} />
                    </div>
                    <div>
                        <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-base-content/55">Your review</p>
                        <textarea
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            maxLength={5000}
                            rows={6}
                            placeholder="What did you think? Others can react and reply, so it becomes a discussion."
                            className="block w-full resize-none rounded-xl border border-white/10 bg-base-100 px-3.5 py-3 text-[13.5px] text-base-content placeholder:text-base-content/40 focus:border-primary focus:outline-none"
                        />
                        <p className="mt-1 text-right text-[11px] text-base-content/45">{text.length}/5000</p>
                    </div>
                    {error && <p className="text-xs text-error">{error}</p>}
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-white/8 bg-base-300/25 px-6 py-3.5">
                    <button type="button" onClick={onClose} className="cursor-pointer rounded-full px-4 py-1.5 text-xs font-semibold text-base-content/70 hover:text-white">
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={submit}
                        disabled={pending}
                        className="cursor-pointer rounded-full bg-primary px-5 py-1.5 text-xs font-bold text-primary-content transition-colors hover:bg-primary/85 disabled:opacity-50">
                        {pending ? "Saving…" : existing ? "Save changes" : "Post review"}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── one review card (details page + "more reviews" on the review page) ───────
// Compact Plex-style card: avatar · name · date on top, the first lines of the review, then 👍 · comments on the left and the
// reaction badges + count on the right. Fixed size (so every card in a row lines up), text is clamped and long words wrap —
// nothing can overflow. No star rating on the card (it is on the review page).

const BADGE = {
    like: { bg: "bg-sky-500", icon: <ThumbsUp size={9} className="fill-white text-white" /> },
    love: { bg: "bg-pink-500", icon: <Heart size={9} className="fill-white text-white" /> },
    funny: { bg: "bg-amber-400", icon: <span className="text-[10px] leading-none">😂</span> },
    wow: { bg: "bg-amber-400", icon: <span className="text-[10px] leading-none">😮</span> },
    sad: { bg: "bg-amber-400", icon: <span className="text-[10px] leading-none">😢</span> },
    dislike: { bg: "bg-violet-500", icon: <ThumbsDown size={9} className="fill-white text-white" /> },
};

export function ReactionCluster({ summary }) {
    const top = Object.entries(summary.counts || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
    if (!summary.total || !top.length) return null;
    return (
        <span className="flex items-center gap-1.5">
            <span className="flex -space-x-1.5">
                {top.map(([t]) => (
                    <span key={t} className={`flex h-[18px] w-[18px] items-center justify-center rounded-full ring-2 ring-base-200 ${BADGE[t]?.bg || "bg-base-300"}`}>
                        {BADGE[t]?.icon}
                    </span>
                ))}
            </span>
            <span className="text-[12px] font-bold tabular-nums text-white">{fmtCount(summary.total)}</span>
        </span>
    );
}

/**
 * ReviewCard
 *   default → compact 258×176 card for the horizontal row on the details page
 *   wide    → full-width card for the review / discussion pages ("More reviews of …"): one per row, grows with the text,
 *             real avatar + rating + a longer excerpt — not the short row card
 */
export function ReviewCard({ review, onOpen, onLike, wide = false }) {
    const shown = seedReactions(review.reactions, review.id); // placeholder numbers until real reactions take over (see ReviewThread.jsx)
    const liked = review.reactions?.mine === "like";
    const pad = wide ? "px-4" : "px-3.5";

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onOpen}
            onKeyDown={(e) => e.target === e.currentTarget && (e.key === "Enter" || e.key === " ") && onOpen?.()}
            className={`flex cursor-pointer select-text flex-col overflow-hidden rounded-xl bg-base-200 outline-none transition-colors duration-150 hover:bg-base-300 focus:outline-none focus-visible:outline-none ${wide ? "w-full" : "h-44 w-[258px] shrink-0"}`}>
            <div className={`flex items-center gap-2.5 ${pad} ${wide ? "pt-4" : "pt-3.5"}`}>
                <Avatar src={review.author?.avatar} name={review.author?.name} size={wide ? 40 : 36} />
                <div className="min-w-0 flex-1 leading-tight">
                    <p className={`truncate font-semibold text-white ${wide ? "text-sm" : "text-[13px]"}`}>{review.author?.name}</p>
                    <p className="mt-0.5 truncate text-[11px] text-base-content/55">{smartDate(review.createdAt)}</p>
                </div>
                {wide && review.rating != null && <StarRating rating={review.rating} size={15} />}
                {review.isMine && <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary">You</span>}
            </div>

            <p
                className={`${pad} break-words text-base-content/90 [overflow-wrap:anywhere] ${wide ? "line-clamp-6 whitespace-pre-line pt-3 text-[14px] leading-relaxed" : "min-h-0 flex-1 overflow-hidden pt-3 text-[13px] leading-snug line-clamp-4"}`}>
                {review.content}
            </p>

            <div className={`flex items-center justify-between gap-2 ${pad} text-base-content/65 ${wide ? "pb-4 pt-3" : "pb-3 pt-1.5"}`}>
                <div className="flex min-w-0 items-center gap-3.5">
                    <button
                        type="button"
                        aria-label="Like"
                        disabled={!onLike}
                        onClick={(e) => {
                            e.stopPropagation();
                            onLike?.(review);
                        }}
                        className={`cursor-pointer border-none bg-transparent outline-none transition-colors hover:text-white disabled:cursor-default ${liked ? "text-primary" : ""}`}>
                        <ThumbsUp size={18} className={liked ? "fill-current" : ""} />
                    </button>
                    <span className="flex items-center gap-1.5">
                        <MessageSquare size={18} />
                        {review.replyCount > 0 && <span className="text-[12px] font-bold tabular-nums text-white">{fmtCount(review.replyCount)}</span>}
                    </span>
                </div>
                <ReactionCluster summary={shown} />
            </div>
        </div>
    );
}

const SORTS = [
    { value: "top", label: "Top" },
    { value: "new", label: "Newest" },
    { value: "rating", label: "Highest rated" },
];

// ─── Reviews (details page) ───────────────────────────────────────────────────
/**
 * Props:
 *   tmdbId     {number}  TMDB id of the title (movie or show)
 *   mediaType  {string}  "movie" | "series" | "anime"  (series + anime → tv)
 *   title, poster, backdrop — only used to label a review written for a title that is not in the library
 */
export default function Reviews({ tmdbId, mediaType, title, poster, backdrop }) {
    const kind = mediaType === "movie" ? "movie" : "tv";
    const { isAuthenticated } = useAuth();
    const { openAuthModal } = useAuthModal();
    const navigate = useNavigate();
    const scrollRef = useRef(null);

    const [sort, setSort] = useState("top");
    const [limit, setLimit] = useState(24);
    const [writing, setWriting] = useState(null); // { existing } | null
    const openReview = (rid) => navigate(`/review/${rid}`);
    const react = useReact();
    const like = (r) => {
        if (!isAuthenticated) return openAuthModal({ view: "login" });
        react.mutate({ kind: "review", id: r.id, type: r.reactions?.mine === "like" ? null : "like" });
    };

    useEffect(() => {
        setSort("top");
        setLimit(24);
    }, [kind, tmdbId]);

    const q = useTitleReviews(kind, tmdbId, { sort, limit });
    // keep the previous list on screen while a new sort / "load more" is loading (only for the SAME title)
    const keep = useRef(null);
    const wantKey = `${kind}:${tmdbId}`;
    if (q.data) keep.current = q.data;
    const data = q.data ?? (keep.current?.key === wantKey ? keep.current : null);

    if (!tmdbId) return null;

    const items = data?.items ?? [];
    const myReview = data?.mine ? items.find((r) => r.id === data.mine) : null;
    const scroll = (dir) => scrollRef.current?.scrollBy({ left: dir * 350, behavior: "smooth" });

    const onWrite = () => {
        if (!isAuthenticated) return openAuthModal({ view: "login" });
        if (data?.mine && !myReview) return openReview(data.mine); // yours is outside this page — open it, it has an Edit button
        setWriting({ existing: myReview || null });
    };

    return (
        <section className="w-full">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h2 className="flex items-center gap-2.5 text-base font-bold tracking-tight text-white sm:text-lg">
                        <span className="h-5 w-1 shrink-0 rounded-full bg-primary" />
                        <Star size={18} className="shrink-0 text-primary" />
                        Ratings &amp; Reviews
                        {data && <span className="text-sm font-medium text-white/60">({data.total})</span>}
                    </h2>
                    {data?.average != null && (
                        <span className="flex items-center gap-1.5 rounded-full border border-white/8 bg-base-200 py-1 pl-2.5 pr-3 text-xs">
                            <Star size={12} className="fill-warning text-warning" />
                            <span className="font-bold text-white">{(data.average / 2).toFixed(1)}</span>
                            <span className="text-base-content/55">/ 5</span>
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    {items.length > 1 && (
                        <select
                            value={sort}
                            onChange={(e) => setSort(e.target.value)}
                            aria-label="Sort reviews"
                            className="cursor-pointer rounded-full border border-white/8 bg-base-200 px-3 py-1.5 text-xs font-semibold text-base-content/80 focus:outline-none">
                            {SORTS.map((s) => (
                                <option key={s.value} value={s.value}>
                                    {s.label}
                                </option>
                            ))}
                        </select>
                    )}
                    <button
                        type="button"
                        onClick={onWrite}
                        className="flex cursor-pointer items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-primary-content transition-colors hover:bg-primary/85">
                        <PenLine size={12} />
                        {data?.mine ? "Edit your review" : "Write a review"}
                    </button>
                    <div className="hidden gap-1.5 sm:flex">
                        <button
                            onClick={() => scroll(-1)}
                            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-white/5 bg-base-200 transition-colors hover:bg-base-300"
                            aria-label="Scroll left">
                            <ChevronLeft size={14} className="text-base-content/70" />
                        </button>
                        <button
                            onClick={() => scroll(1)}
                            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-white/5 bg-base-200 transition-colors hover:bg-base-300"
                            aria-label="Scroll right">
                            <ChevronRight size={14} className="text-base-content/70" />
                        </button>
                    </div>
                </div>
            </div>

            <div ref={scrollRef} className="-mx-1 flex gap-3 overflow-x-auto px-1 py-2.5" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                {!data && q.isLoading && [0, 1, 2].map((i) => <div key={i} className="h-44 w-[258px] shrink-0 animate-pulse rounded-xl bg-base-200" />)}

                {data && !items.length && data.importing && [0, 1, 2].map((i) => <div key={i} className="h-44 w-[258px] shrink-0 animate-pulse rounded-xl bg-base-200" />)}

                {data && !items.length && !data.importing && (
                    <div className="flex h-44 w-[258px] shrink-0 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 bg-base-200/50 p-5 text-center">
                        <p className="text-sm font-bold text-white">No reviews yet</p>
                        <p className="text-xs text-base-content/60">Be the first to share what you thought.</p>
                        <button type="button" onClick={onWrite} className="mt-1 cursor-pointer rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-primary-content hover:bg-primary/85">
                            Write a review
                        </button>
                    </div>
                )}

                {items.map((r) => (
                    <ReviewCard key={r.id} review={r} onOpen={() => openReview(r.id)} onLike={like} />
                ))}

                {data && data.total > limit && (
                    <button
                        type="button"
                        onClick={() => setLimit((l) => l + 36)}
                        disabled={q.isFetching}
                        className="flex h-44 w-36 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl bg-base-200 text-xs font-bold text-primary transition-colors hover:bg-base-300 disabled:opacity-60">
                        {q.isFetching ? "Loading…" : "Load more"}
                        {!q.isFetching && <span className="text-[11px] font-medium text-base-content/60">{data.total - limit} left</span>}
                    </button>
                )}
            </div>

            {writing && <WriteReviewModal kind={kind} tmdbId={tmdbId} meta={{ title, poster, backdrop }} existing={writing.existing} onClose={() => setWriting(null)} />}
        </section>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// POPULAR REVIEWS / POPULAR DISCUSSIONS — Plex-style tall cards (HOME page)
// ═════════════════════════════════════════════════════════════════════════════
// <PopularReviews />                      (this file)
// <PopularDiscussions />                  (PopularDiscussions.jsx — re-uses PopularCardShell / PopularRow below)
// Both fetch their own feed (/api/reviews/popular · /api/reviews/discussions), hide themselves when empty and open the
// review page (/review/:id) on click.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * PopularCardShell — the one card layout used by BOTH Popular Reviews and Popular Discussions.
 *   media     { title, backdrop, poster, logo }  → art + title logo on top
 *   headline  string   → bold thread title (discussions); omit for reviews
 *   rating    0–10     → big centred stars (reviews); omit for discussions
 *   body      string   → quote / excerpt
 *   id        review id → the footer LIKE button reacts to it in place (login page if signed out)
 *   mine      the viewer\'s own reaction from the feed ("like" | null) → thumb starts filled
 *   author, avatar, date, likes (reactions), comments (replies), onMore (reactions / comments / More buttons + card click)
 */
export function PopularCardShell({ id, mine, media, headline, rating, body, author, avatar, date, likes, comments, onMore, bodyLines = 3 }) {
    const art = media?.backdrop || media?.poster || null;
    const rgb = useDominantColor(art);
    const tint = rgb ? `rgb(${Math.round(rgb[0] * 0.3)}, ${Math.round(rgb[1] * 0.3)}, ${Math.round(rgb[2] * 0.3)})` : "var(--color-base-300)";
    const [artError, setArtError] = useState(false);
    const mask = "linear-gradient(to bottom, #000 30%, transparent 100%)";
    const clamp = bodyLines === 2 ? "line-clamp-2" : "line-clamp-3";

    // ── like button: works IN the card (no redirect) and is saved on the server.
    //    `mine` = the viewer's own reaction from the feed ("like" | … | null) → the thumb is filled after a reload too.
    //    The count moves instantly (delta); useReact({ keepFeedOrder }) then patches the cached feed card in place.
    const { isAuthenticated } = useAuth();
    const { openAuthModal } = useAuthModal();
    const react = useReact({ keepFeedOrder: true }); // feed stays put: no refetch → no re-rank, no skeleton, no scroll jump
    const [liked, setLiked] = useState(mine === "like");
    const [delta, setDelta] = useState(0);
    useEffect(() => setLiked(mine === "like"), [mine]);
    useEffect(() => setDelta(0), [likes]);
    const shownLikes = Math.max(0, (likes ?? 0) + delta);

    const toggleLike = () => {
        if (!id || react.isPending) return;
        if (!isAuthenticated) return openAuthModal({ view: "login" });
        const next = !liked;
        const prevLiked = liked;
        const prevDelta = delta;
        setLiked(next);
        setDelta(prevDelta + (next ? 1 : -1));
        react.mutate(
            { kind: "review", id, type: next ? "like" : null },
            {
                onSuccess: (res) => res?.reactions && setLiked(res.reactions.mine === "like"),
                onError: () => {
                    setLiked(prevLiked);
                    setDelta(prevDelta);
                },
            },
        );
    };

    // every footer control stops the click so the card's own onClick never double-fires; "go" = open the page
    const stop = (fn) => (e) => {
        e.stopPropagation();
        fn?.();
    };
    const footBtn =
        "flex cursor-pointer items-center gap-1.5 border-none bg-transparent outline-none transition-colors duration-150 hover:bg-black/20 hover:text-white focus:outline-none focus-visible:outline-none";

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onMore}
            onKeyDown={(e) => e.target === e.currentTarget && (e.key === "Enter" || e.key === " ") && onMore?.()}
            className="group relative h-90 w-72 shrink-0 cursor-pointer select-none overflow-hidden rounded-2xl outline-none transition-transform duration-200 [-webkit-tap-highlight-color:transparent] hover:-translate-y-0.5 focus:outline-none focus-visible:outline-none sm:w-80"
            style={{ background: tint }}>
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

            <div className="absolute inset-x-0 top-[14%] flex justify-center px-6">
                {media?.logo ? (
                    <img src={media.logo} alt={media.title || ""} className="max-h-16 max-w-[78%] object-contain drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]" draggable={false} />
                ) : (
                    <p className="line-clamp-2 text-center text-2xl font-extrabold leading-tight tracking-tight text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]">{media?.title}</p>
                )}
            </div>

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
                        <Avatar src={avatar} name={author} size={40} />
                        <div className="min-w-0 leading-tight">
                            <p className="truncate text-[11px] text-white/80">{author}</p>
                            <p className="truncate text-[11px] font-semibold text-white">{media?.title}</p>
                            {date && <p className="truncate text-[11px] text-white/55">{fmtLongDate(date)}</p>}
                        </div>
                    </div>
                </div>

                <div className="flex h-10 items-stretch border-t border-white/10 bg-black/25 text-[12px] text-white/80">
                    {/* LIKE — toggles in place, never navigates */}
                    <button
                        type="button"
                        aria-label={liked ? "Remove like" : "Like"}
                        aria-pressed={liked}
                        disabled={react.isPending}
                        onClick={stop(toggleLike)}
                        className={`${footBtn} w-10 justify-center border-r border-white/10 disabled:cursor-default ${liked ? "text-primary hover:text-primary" : ""}`}>
                        <ThumbsUp size={14} className={liked ? "fill-current" : ""} />
                    </button>
                    {/* REACTIONS count — opens the page */}
                    <button type="button" aria-label="Reactions" onClick={stop(onMore)} className={`${footBtn} border-r border-white/10 px-3`}>
                        <span className="flex -space-x-1">
                            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-pink-500 ring-1 ring-black/30">
                                <Heart size={9} className="fill-white text-white" />
                            </span>
                            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-sky-500 ring-1 ring-black/30">
                                <ThumbsUp size={9} className="fill-white text-white" />
                            </span>
                        </span>
                        <span className="font-medium tabular-nums">{fmtCount(shownLikes)}</span>
                    </button>
                    {/* COMMENTS — opens the page */}
                    <button type="button" aria-label="Comments" onClick={stop(onMore)} className={`${footBtn} border-r border-white/10 px-3`}>
                        <MessageSquare size={13} />
                        <span className="font-semibold tabular-nums text-white">{fmtCount(comments ?? 0)}</span>
                    </button>
                    {/* MORE — opens the page */}
                    <button type="button" aria-label="More" onClick={stop(onMore)} className={`${footBtn} flex-1 justify-end gap-0.5 pr-4 font-semibold text-white`}>
                        More <ChevronRight size={14} />
                    </button>
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
            {/* py-3 / px-2: room for the hover ring + lift + shadow — an overflow-x scroller clips anything outside its box, so without this the cards looked cut off */}
            <div ref={rowRef} className="-mx-2 flex gap-3 overflow-x-auto px-2 py-3" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                {loading ? Array.from({ length: skeletonCount }).map((_, i) => <PopularCardSkeleton key={i} />) : items.map((item) => renderCard(item))}
            </div>
        </section>
    );
}

/**
 * PopularReviews — Plex "Popular Reviews" row for the HOME page.
 * <PopularReviews /> fetches its own data and hides itself when there is none.
 * Props (optional): items / loading to render your own list, title.
 */
export function PopularReviews({ items, loading, title = "Popular Reviews" }) {
    const feed = usePopularFeed("reviews", items === undefined);
    const rows = items ?? feed.data ?? [];
    const busy = loading ?? (items === undefined && feed.isLoading);
    const navigate = useNavigate();
    return (
        <PopularRow
            title={title}
            items={rows}
            loading={busy}
            renderCard={(it) => (
                <PopularCardShell
                    key={it.id}
                    id={it.id}
                    mine={it.mine}
                    media={it.media}
                    rating={it.rating}
                    body={it.content}
                    author={it.author}
                    avatar={it.avatar}
                    date={it.createdAt}
                    likes={seedCount(it.likes, it.id)}
                    comments={it.comments}
                    onMore={() => navigate(`/review/${it.id}`)}
                />
            )}
        />
    );
}
