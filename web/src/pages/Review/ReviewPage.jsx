import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, Check, ChevronDown, ChevronUp, MoreVertical, Pencil, Play, Plus, Smile, Star, ThumbsUp, Trash2 } from "lucide-react";
import { useAuth } from "../../Auth/AuthContext";
import { useAuthModal } from "../../Auth/AuthModalContext";
import { useApi } from "../../Context/apiContext";
import { routeId } from "../../Utils/shortId.js";
import { useReviewThread, useReact, useAddReply, useUpdateReply, useDeleteReply, useDeleteReview, useTitleReviews } from "../../Hooks/Query/useReviews";
import { Avatar, StarRating, Composer, REACTIONS, fmtLongDate, seedReactions } from "../../Components/Media/ReviewThread";
import { ReviewCard, ReactionCluster, WriteReviewModal } from "../../Components/Media/Reviews";

export const runtimeLabel = (min) => (min ? `${Math.floor(min / 60) ? `${Math.floor(min / 60)}h ` : ""}${min % 60 ? `${min % 60}m` : ""}`.trim() : null);

// where "Open title" goes: library titles use the short link, other titles use the TMDB page id (movie:603 → tmdb-movie-603)
export function titleHref(media, key) {
    if (media?.inLibrary && media?.id) return `/media/${routeId(media.id)}`;
    const [kind, tmdbId] = String(key || "").split(":");
    return tmdbId ? `/media/tmdb-${kind}-${tmdbId}` : null;
}

// 👍 (tap = like / unlike) + the reaction badges with their count (tap = pick any reaction). Used under the review and every comment.
// spread = push the 👍 to the left and the badges to the far right (the review card's footer).
export function LikeBar({ summary, onReact, ring = "ring-base-200", size = 20, spread = false }) {
    const [open, setOpen] = useState(false);
    const box = useRef(null);
    const s = summary || { counts: {}, total: 0, mine: null };
    const liked = s.mine === "like";

    useEffect(() => {
        if (!open) return undefined;
        const close = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
    }, [open]);

    const pick = (type) => {
        setOpen(false);
        onReact?.(s.mine === type ? null : type);
    };

    return (
        <div ref={box} className={`relative flex items-center ${spread ? "w-full justify-between" : "gap-3"}`}>
            <button type="button" aria-label="Like" onClick={() => pick("like")} className={`cursor-pointer transition-colors hover:text-white ${liked ? "text-primary" : "text-base-content/70"}`}>
                <ThumbsUp size={size} className={liked ? "fill-current" : ""} />
            </button>
            <button type="button" aria-label="React" onClick={() => setOpen((v) => !v)} className="flex cursor-pointer items-center rounded-full px-1 py-0.5 text-base-content/60 transition-colors hover:bg-white/10 hover:text-white">
                {s.total ? <ReactionCluster summary={s} ring={ring} /> : <Smile size={size - 3} />}
            </button>

            {open && (
                <div className="absolute bottom-full left-0 z-30 mb-1.5 flex gap-0.5 rounded-full border border-white/10 bg-base-100 px-2 py-1.5 shadow-2xl">
                    {REACTIONS.map((r) => (
                        <button key={r.type} type="button" title={r.label} onClick={() => pick(r.type)} className={`cursor-pointer rounded-full px-1.5 text-xl leading-none transition-transform hover:scale-125 ${s.mine === r.type ? "bg-primary/20" : ""}`}>
                            {r.emoji}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// ⋮ menu on a comment (Edit / Delete) — only shown to people who may use it
export function RowMenu({ c, onEdit, onDelete }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
    }, [open]);

    if (!c.canEdit && !c.canDelete) return null;
    return (
        <div ref={ref} className="relative ml-auto shrink-0">
            <button type="button" onClick={() => setOpen((v) => !v)} aria-label="More" className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-base-content/60 transition-colors hover:bg-white/10 hover:text-white">
                <MoreVertical size={16} />
            </button>
            {open && (
                <div className="absolute right-0 top-9 z-20 w-32 overflow-hidden rounded-xl border border-white/10 bg-base-100 py-1 shadow-2xl">
                    {c.canEdit && (
                        <button
                            type="button"
                            onClick={() => {
                                setOpen(false);
                                onEdit(c);
                            }}
                            className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm hover:bg-white/8">
                            <Pencil size={13} /> Edit
                        </button>
                    )}
                    {c.canDelete && (
                        <button
                            type="button"
                            onClick={() => {
                                setOpen(false);
                                onDelete(c);
                            }}
                            className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-error hover:bg-white/8">
                            <Trash2 size={13} /> Delete
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

// one comment, Plex style: avatar · name + date · text, then 👍 reactions · Reply · ⋮
export function PlexComment({ c, small = false, editing, onReact, onReply, onEdit, onDelete, onSaveEdit, onCancelEdit, pending, user }) {
    return (
        <div className="flex items-start gap-3">
            <Avatar src={c.author.avatar} name={c.author.name} size={small ? 30 : 40} />
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 leading-tight">
                    <span className="text-[14px] font-semibold text-white">{c.author.name}</span>
                    <span className="text-[12px] font-semibold text-base-content/50">{fmtLongDate(c.createdAt)}</span>
                    {c.edited && <span className="text-[12px] text-base-content/40">(edited)</span>}
                </div>

                {editing ? (
                    <div className="mt-2">
                        <Composer user={user} initial={c.content} submitLabel="Save" onSubmit={(v) => onSaveEdit(c, v)} onCancel={onCancelEdit} autoFocus pending={pending} compact />
                    </div>
                ) : (
                    <p className="mt-1.5 whitespace-pre-line break-words text-[15px] leading-snug text-base-content/92 [overflow-wrap:anywhere]">
                        {c.replyToName && <span className="font-semibold text-primary">@{c.replyToName} </span>}
                        {c.content}
                    </p>
                )}

                {!editing && (
                    <div className="mt-2 flex items-center gap-4">
                        <LikeBar summary={c.reactions} onReact={(type) => onReact("reply", c.id, type)} ring="ring-base-100" size={18} />
                        <button type="button" onClick={() => onReply(c)} className="cursor-pointer text-[12px] font-semibold text-base-content/65 transition-colors hover:text-white">
                            Reply
                        </button>
                        <RowMenu c={c} onEdit={onEdit} onDelete={onDelete} />
                    </div>
                )}
            </div>
        </div>
    );
}

export function PageSkeleton() {
    return (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,9fr)_minmax(0,11fr)] lg:gap-16 xl:gap-24">
            <div className="space-y-4">
                <div className="aspect-video animate-pulse rounded-2xl bg-base-300" />
                <div className="h-5 w-2/3 animate-pulse rounded bg-base-300" />
                <div className="h-3 w-full animate-pulse rounded bg-base-300" />
                <div className="h-3 w-5/6 animate-pulse rounded bg-base-300" />
            </div>
            <div className="space-y-4">
                <div className="h-64 animate-pulse rounded-2xl bg-base-300" />
                <div className="h-10 animate-pulse rounded-2xl bg-base-300" />
            </div>
        </div>
    );
}

export default function ReviewPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { user, isAuthenticated } = useAuth();
    const { openAuthModal } = useAuthModal();
    const { isInWatchlist, toggleWatchlist } = useApi();

    const thread = useReviewThread(id);
    const react = useReact();
    const addMut = useAddReply(id);
    const updMut = useUpdateReply(id);
    const delMut = useDeleteReply(id);
    const delReview = useDeleteReview();

    const review = thread.data?.review;
    const replies = thread.data?.replies ?? [];
    const media = thread.data?.media;

    const [kind, tmdbId] = String(review?.key || "").split(":");
    const more = useTitleReviews(kind || undefined, tmdbId || undefined, { sort: "top", limit: 12 });
    const others = (more.data?.items || []).filter((r) => r.id !== id).slice(0, 10);

    const [replyTo, setReplyTo] = useState(null); // comment being answered
    const [editing, setEditing] = useState(null); // comment id being edited
    const [open, setOpen] = useState(() => new Set()); // top-level comments whose replies are expanded
    const [menu, setMenu] = useState(false);
    const [writing, setWriting] = useState(false);
    const [err, setErr] = useState("");
    const commentsRef = useRef(null);
    const menuRef = useRef(null);

    useEffect(() => {
        window.scrollTo(0, 0);
    }, [id]);

    useEffect(() => {
        if (!menu) return undefined;
        const close = (e) => menuRef.current && !menuRef.current.contains(e.target) && setMenu(false);
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
    }, [menu]);

    const tops = useMemo(() => replies.filter((r) => !r.parentId), [replies]);
    const kidsOf = useMemo(() => {
        const m = new Map();
        for (const r of replies) if (r.parentId) m.set(r.parentId, [...(m.get(r.parentId) || []), r]);
        return m;
    }, [replies]);

    const login = () => openAuthModal({ view: "login" });
    const guard =
        (fn) =>
        (...a) => {
            if (!isAuthenticated) return login();
            setErr("");
            fn(...a);
        };
    const fail = (e) => setErr(e?.message || "Something went wrong");

    const doReact = guard((kindOf, targetId, type) => react.mutate({ kind: kindOf, id: targetId, type }, { onError: fail }));
    const postTop = guard((text, clear) => addMut.mutate({ content: text }, { onSuccess: clear, onError: fail }));
    const postReply = guard((text, clear) =>
        addMut.mutate(
            { content: text, parentId: replyTo.id },
            {
                onSuccess: () => {
                    clear();
                    setOpen((s) => new Set(s).add(replyTo.parentId || replyTo.id));
                    setReplyTo(null);
                },
                onError: fail,
            },
        ),
    );
    const saveEdit = guard((c, text) => updMut.mutate({ id: c.id, content: text }, { onSuccess: () => setEditing(null), onError: fail }));
    const removeComment = guard((c) => window.confirm("Delete this comment?") && delMut.mutate(c.id, { onError: fail }));
    const removeReview = guard(() => window.confirm("Delete this review and its whole discussion?") && delReview.mutate(review.id, { onSuccess: () => navigate(-1), onError: fail }));
    const likeCard = guard((r) => react.mutate({ kind: "review", id: r.id, type: r.reactions?.mine === "like" ? null : "like" }, { onError: fail }));
    const back = () => (window.history.length > 1 ? navigate(-1) : navigate("/"));

    const rowProps = { onReact: doReact, onReply: guard((c) => setReplyTo(c)), onEdit: (c) => setEditing(c.id), onDelete: removeComment, onSaveEdit: saveEdit, onCancelEdit: () => setEditing(null), pending: updMut.isPending, user };

    // ── states ──
    if (thread.isError && !review) {
        return (
            <div className="mx-auto max-w-lg py-24 text-center">
                <p className="text-lg font-bold text-white">{thread.error?.status === 404 ? "This review is no longer available." : "Could not load this review."}</p>
                <button onClick={back} className="btn mt-5 rounded-lg border border-white/10 bg-base-300/80 hover:bg-base-200">
                    <ArrowLeft size={15} /> Go back
                </button>
            </div>
        );
    }

    const href = titleHref(media, review?.key);
    const art = media?.backdrop || media?.poster;
    const canWatchlist = Boolean(media?.inLibrary && media?.id);
    const watchlisted = canWatchlist && isInWatchlist(media.id);
    const shownReactions = review ? seedReactions(review.reactions, review.id) : null; // placeholder numbers until real reactions take over (ReviewThread.jsx)
    const meta = [media?.year, runtimeLabel(media?.runtime), media?.genres?.length ? media.genres.join(" · ") : null].filter(Boolean);

    return (
        // full-bleed: breaks out of the layout's side padding so the page uses the whole screen width
        <main className="relative left-1/2 right-1/2 -mx-[50vw] w-screen">
            <div className="w-full px-4 pb-10 sm:px-6 lg:px-8">
                {!review ? (
                    <PageSkeleton />
                ) : (
                    <div className="grid gap-6 lg:grid-cols-[minmax(0,9fr)_minmax(0,11fr)] lg:gap-16 xl:gap-24">
                        {/* ── left: the title ── */}
                        <aside className="flex min-w-0 flex-col lg:sticky lg:top-20 lg:h-[calc(100dvh-5rem)] lg:self-start lg:overflow-hidden">
                            <div className="relative shrink-0 overflow-hidden rounded-2xl bg-base-300 ring-1 ring-white/10 lg:h-[36dvh]">
                                {art ? <img src={art} alt="" className="aspect-video w-full object-cover lg:aspect-auto lg:h-full" draggable={false} /> : <div className="aspect-video lg:aspect-auto lg:h-full" />}
                                <div className="absolute inset-0 bg-linear-to-t from-black/75 via-black/10 to-transparent" />
                                <div className="absolute inset-x-0 bottom-0 flex justify-center p-4">
                                    {media?.logo ? (
                                        <img src={media.logo} alt={media.title || ""} className="max-h-14 max-w-[80%] object-contain drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]" draggable={false} />
                                    ) : (
                                        <p className="line-clamp-2 text-center text-xl font-extrabold leading-tight text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]">{media?.title}</p>
                                    )}
                                </div>
                            </div>

                            <div className="mt-4 min-h-0 flex-1 space-y-3 lg:overflow-y-auto lg:pr-1 lg:[scrollbar-width:none]">
                                <h1 className="text-lg font-bold leading-tight text-white">{href ? <Link to={href} className="transition-colors hover:text-primary">{media?.title}</Link> : media?.title}</h1>

                                {meta.length > 0 && <p className="text-[13px] text-base-content/70">{meta.join("  ·  ")}</p>}

                                {media?.rating != null && (
                                    <div className="flex items-center gap-2 text-[13px]">
                                        <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-base-300/60 py-1 pl-2.5 pr-3">
                                            <Star size={12} className="fill-warning text-warning" />
                                            <span className="font-bold text-white">{media.rating.toFixed(1)}</span>
                                            <span className="text-base-content/55">TMDB</span>
                                        </span>
                                    </div>
                                )}

                                {(href || canWatchlist) && (
                                    <div className="flex flex-wrap gap-2 pt-1">
                                        {href && (
                                            <Link to={href} className="btn btn-primary btn-sm gap-1.5 rounded-lg border-0 shadow-none outline-none">
                                                <Play size={13} className="fill-current" /> Open title
                                            </Link>
                                        )}
                                        {canWatchlist && (
                                            <button
                                                onClick={() => toggleWatchlist(media.id, { name: media.title, poster: media.poster, type: media.type === "movie" ? "movie" : "series", year: media.year, rating: media.rating })}
                                                className={`btn btn-sm gap-1.5 rounded-lg border border-white/10 bg-base-300/80 hover:bg-base-200 ${watchlisted ? "text-accent" : ""}`}>
                                                {watchlisted ? <Check size={14} /> : <Plus size={14} />} Watchlist
                                            </button>
                                        )}
                                    </div>
                                )}

                                {media?.overview && <p className="text-[13.5px] leading-relaxed text-base-content/80">{media.overview}</p>}
                            </div>
                        </aside>

                        {/* ── right: the review, then the comments, then more reviews ── */}
                        <div className="flex min-w-0 flex-col lg:min-h-[calc(100dvh-5rem)]">
                            <article className="rounded-2xl bg-black/30 p-5 sm:p-6">
                                <header className="flex items-start gap-3">
                                    <Avatar src={review.author?.avatar} name={review.author?.name} size={44} />
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-[15px] leading-tight">
                                            <span className="font-bold text-white">{review.author?.name}</span> <span className="text-base-content/60">reviewed</span>
                                        </p>
                                        <p className="mt-0.5 truncate text-sm font-semibold text-base-content/90">{media?.title}</p>
                                        <p className="mt-0.5 text-xs font-semibold text-base-content/50">
                                            {fmtLongDate(review.createdAt)}
                                            {review.edited && " · edited"}
                                            {review.source && review.source !== "local" && " · imported from TMDB"}
                                        </p>
                                    </div>
                                    {(review.canEdit || review.canDelete) && (
                                        <div ref={menuRef} className="relative shrink-0">
                                            <button onClick={() => setMenu((v) => !v)} aria-label="More" className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-base-content/60 transition-colors hover:bg-white/10 hover:text-white">
                                                <MoreVertical size={17} />
                                            </button>
                                            {menu && (
                                                <div className="absolute right-0 top-9 z-20 w-36 overflow-hidden rounded-xl border border-white/10 bg-base-100 py-1 shadow-2xl">
                                                    {review.canEdit && (
                                                        <button
                                                            onClick={() => {
                                                                setMenu(false);
                                                                setWriting(true);
                                                            }}
                                                            className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm hover:bg-white/8">
                                                            <Pencil size={13} /> Edit
                                                        </button>
                                                    )}
                                                    {review.canDelete && (
                                                        <button
                                                            onClick={() => {
                                                                setMenu(false);
                                                                removeReview();
                                                            }}
                                                            className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-error hover:bg-white/8">
                                                            <Trash2 size={13} /> Delete
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </header>


                                <p className="mt-4 whitespace-pre-line break-words text-[15px] leading-relaxed text-base-content/92 [overflow-wrap:anywhere]">{review.content}</p>

                                <footer className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
                                    <LikeBar summary={shownReactions} onReact={(type) => doReact("review", review.id, type)} ring="ring-neutral-900" />
                                    {review.rating != null && (
                                        <div className="flex items-center gap-2">
                                            <StarRating rating={review.rating} size={18} />
                                            <span className="text-sm font-bold text-white">{(review.rating / 2).toFixed(1)}</span>
                                        </div>
                                    )}
                                </footer>
                            </article>

                            <section ref={commentsRef} className="mt-8 scroll-mt-24">
                                <h2 className="mb-2 text-lg font-bold text-white">
                                    Comments <span className="font-medium text-base-content/55">({replies.length})</span>
                                </h2>

                                {!thread.isLoading && !tops.length && <p className="py-4 text-sm text-base-content/55">No comments yet — start the discussion.</p>}

                                {/* comments — one per row, thin line between */}
                                <div className="divide-y divide-white/10">
                                    {tops.map((c) => {
                                        const kids = kidsOf.get(c.id) || [];
                                        const isOpen = open.has(c.id);
                                        return (
                                            <div key={c.id} className="py-4">
                                                <PlexComment c={c} editing={editing === c.id} {...rowProps} />

                                                {replyTo?.id === c.id && (
                                                    <div className="ml-[52px] mt-3">
                                                        <Composer user={user} placeholder={`Reply to ${c.author.name}…`} submitLabel="Reply" onSubmit={postReply} onCancel={() => setReplyTo(null)} autoFocus pending={addMut.isPending} compact />
                                                    </div>
                                                )}

                                                {kids.length > 0 && (
                                                    <div className="ml-[52px] mt-1">
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                setOpen((s) => {
                                                                    const n = new Set(s);
                                                                    n.has(c.id) ? n.delete(c.id) : n.add(c.id);
                                                                    return n;
                                                                })
                                                            }
                                                            className="-ml-2.5 flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-semibold text-primary transition-colors hover:bg-primary/10">
                                                            {isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                                                            {isOpen ? "Hide replies" : `${kids.length} ${kids.length === 1 ? "reply" : "replies"}`}
                                                        </button>
                                                        {isOpen && (
                                                            <div className="mt-3 space-y-4">
                                                                {kids.map((k) => (
                                                                    <div key={k.id}>
                                                                        <PlexComment c={k} small editing={editing === k.id} {...rowProps} />
                                                                        {replyTo?.id === k.id && (
                                                                            <div className="ml-10 mt-3">
                                                                                <Composer user={user} placeholder={`Reply to ${k.author.name}…`} submitLabel="Reply" onSubmit={postReply} onCancel={() => setReplyTo(null)} autoFocus pending={addMut.isPending} compact />
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>

                            </section>

                            {/* other reviews of this title — one card per row */}
                            {others.length > 0 && (
                                <section className="mt-10">
                                    <h3 className="mb-3 text-lg font-bold text-white">More reviews of {media?.title}</h3>
                                    <div className="flex flex-col gap-3">
                                        {others.map((r) => (
                                            <ReviewCard wide key={r.id} review={r} onOpen={() => navigate(`/review/${r.id}`)} onLike={likeCard} />
                                        ))}
                                    </div>
                                </section>
                            )}

                            {/* comment bar — floating, always at the bottom end of the right side, sticks 16px above the bottom of the screen */}
                            <div className="sticky bottom-4 z-20 mt-auto pt-6">
                                <div className="rounded-2xl border border-white/10 bg-base-200 p-2 shadow-[0_8px_30px_rgba(0,0,0,0.55)]">
                                    {isAuthenticated ? (
                                        <Composer key={id} variant="pill" user={user} placeholder="Leave a comment…" submitLabel="Send" onSubmit={postTop} pending={addMut.isPending} />
                                    ) : (
                                        <button onClick={login} className="w-full cursor-pointer rounded-xl px-4 py-2.5 text-left text-sm text-base-content/60 transition-colors hover:text-white">
                                            Log in to leave a comment
                                        </button>
                                    )}
                                </div>
                                {err && <p className="mt-2 text-xs text-error">{err}</p>}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {writing && review && <WriteReviewModal key={id} kind={kind} tmdbId={Number(tmdbId)} meta={{ title: media?.title, poster: media?.poster, backdrop: media?.backdrop }} existing={review} onClose={() => setWriting(false)} />}
        </main>
    );
}
