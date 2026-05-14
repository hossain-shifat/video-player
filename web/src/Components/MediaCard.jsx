import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { MoreVertical, Bookmark, List, Tv, CheckCircle, Star, Eye, Heart, Film, Play } from "lucide-react";
import { useApi } from "../Context/apiContext";
import { useNavigate } from "react-router";

// ─── Data normaliser ──────────────────────────────────────────────────────────
function normalise(item) {
    const isMovie = item.parsed?.type === "movie" || item.type === "movie";
    if (isMovie) {
        return {
            id: item.id,
            type: "movie",
            // Prefer TMDB title/year; fall back to parsed (pre-enrichment or KGF)
            title: item.metadata?.title || item.parsed?.title || item.name || "Unknown",
            year: item.metadata?.year ?? item.parsed?.year ?? null,
            poster: item.metadata?.poster ?? null,
            rating: item.metadata?.rating ?? null,
            streamUrl: item.streamUrl,
            raw: item,
        };
    }
    return {
        id: item.id,
        type: "series",
        title: item.metadata?.title ?? item.title ?? "Unknown",
        year: item.metadata?.year ?? null,
        poster: item.metadata?.poster ?? null,
        rating: item.metadata?.rating ?? null,
        streamUrl: null,
        raw: item,
    };
}

// ─── Menu items ───────────────────────────────────────────────────────────────
const MENU_ITEMS = [
    { icon: Play, label: "Watch Now", key: "play" },
    { icon: Bookmark, label: "Add to Watchlist", key: "watchlist" },
    { icon: List, label: "Add to List", key: "list" },
    { icon: Tv, label: "Watch Trailer", key: "trailer" },
    { icon: CheckCircle, label: "Mark as Watched", key: "watched" },
];

const MENU_WIDTH = 208; // w-52
const MENU_HEIGHT = MENU_ITEMS.length * 44 + 12;

// ─── Portal context menu ──────────────────────────────────────────────────────
// Renders into <body> via createPortal → completely immune to any ancestor's
// overflow:hidden, scroll container, or z-index stacking context.
function ContextMenu({ open, anchor, onAction, onClose }) {
    const menuRef = useRef(null);
    const [pos, setPos] = useState({ top: 0, left: 0 });

    // Recalculate position whenever the menu opens
    useEffect(() => {
        if (!open || !anchor) return;
        const rect = anchor.getBoundingClientRect();

        // Vertical: open below button; flip above if not enough space
        const spaceBelow = window.innerHeight - rect.bottom;
        const top = spaceBelow >= MENU_HEIGHT ? rect.bottom + 6 : rect.top - MENU_HEIGHT - 6;

        // Horizontal: align left edge to button; flip if it would overflow right
        const spaceRight = window.innerWidth - rect.left;
        const left = spaceRight >= MENU_WIDTH ? rect.left : rect.right - MENU_WIDTH;

        setPos({ top, left });
    }, [open, anchor]);

    // Close on outside click or any scroll
    useEffect(() => {
        if (!open) return;
        const onOutside = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
        };
        const onScroll = () => onClose();
        document.addEventListener("mousedown", onOutside);
        window.addEventListener("scroll", onScroll, true);
        return () => {
            document.removeEventListener("mousedown", onOutside);
            window.removeEventListener("scroll", onScroll, true);
        };
    }, [open, onClose]);

    if (!open) return null;

    return createPortal(
        <>
            <style>{`
                @keyframes menuIn {
                    from { opacity: 0; transform: translateY(-4px) scale(0.96); }
                    to   { opacity: 1; transform: translateY(0) scale(1); }
                }
            `}</style>
            <div
                ref={menuRef}
                style={{
                    position: "fixed",
                    top: pos.top,
                    left: pos.left,
                    zIndex: 99999,
                    animation: "menuIn 0.12s ease-out both",
                }}
                className="w-52 rounded-2xl overflow-hidden shadow-2xl
                           bg-[oklch(15%_0.01_260/0.97)] backdrop-blur-md
                           border border-white/10 py-1.5">
                {MENU_ITEMS.map(({ icon: Icon, label, key }) => (
                    <button
                        key={key}
                        onClick={(e) => {
                            e.stopPropagation();
                            onAction(key);
                        }}
                        className="flex items-center gap-3 w-full px-4 py-2.5 text-sm
                                   text-white/85 hover:bg-white/10 active:bg-white/15
                                   transition-colors duration-100">
                        <Icon size={15} strokeWidth={1.8} className="text-white/55 shrink-0" />
                        {label}
                    </button>
                ))}
            </div>
        </>,
        document.body,
    );
}

// ─── Poster fallback ──────────────────────────────────────────────────────────
function PosterFallback({ title, type }) {
    return (
        <div
            className="w-full h-full flex flex-col items-center justify-center gap-3
                        bg-linear-to-br from-base-300 to-base-200">
            {type === "series" ? <Tv size={30} className="text-base-content/25" /> : <Film size={30} className="text-base-content/25" />}
            <span
                className="text-base-content/40 text-xs font-semibold text-center
                             px-3 leading-tight line-clamp-3">
                {title}
            </span>
        </div>
    );
}

// ─── MediaCard ────────────────────────────────────────────────────────────────
export default function MediaCard({ item, onPlay, onWatchTrailer }) {
    const { isInWatchlist, toggleWatchlist, isFavourite, toggleFavourite } = useApi();
    const navigate = useNavigate();
    const media = normalise(item);

    const [menuOpen, setMenuOpen] = useState(false);
    const [imgError, setImgError] = useState(false);
    const btnRef = useRef(null);

    const handleMenuOpen = (e) => {
        e.stopPropagation();
        setMenuOpen((v) => !v);
    };

    const closeMenu = () => setMenuOpen(false);

    const watchlisted = isInWatchlist(media.id);
    const favourited = isFavourite(media.id);

    const handleAction = (key) => {
        closeMenu();
        const payload = { name: media.title, poster: media.poster, type: media.type };
        switch (key) {
            case "play":
                onPlay?.(media.raw);
                break;
            case "watchlist":
                toggleWatchlist(media.id, payload);
                break;
            case "trailer":
                onWatchTrailer?.(media);
                break;
            default:
                break;
        }
    };

    return (
        <div onClick={() => navigate(`/media/${encodeURIComponent(media.id)}`)} className="group relative shrink-0 w-40 sm:w-44 cursor-pointer select-none my-2">
            {/* ── Poster — overflow:hidden is safe because menu is NOT inside ── */}
            <div
                className="relative w-full aspect-2/3 rounded-xl overflow-hidden bg-base-300
                            shadow-lg ring-1 ring-white/5 transition-transform duration-200
                            group-hover:scale-[1.03] group-hover:shadow-2xl group-hover:ring-white/20">
                {media.poster && !imgError ? (
                    <img src={media.poster} alt={media.title} className="w-full h-full object-cover" onError={() => setImgError(true)} loading="lazy" draggable={false} />
                ) : (
                    <PosterFallback title={media.title} type={media.type} />
                )}

                {/* Bottom gradient */}
                <div className="absolute inset-0 bg-linear-to-t from-black/60 via-transparent to-transparent" />

                {/* Type badge */}
                <div className="absolute top-2 left-2">
                    <span
                        className={`text-[9px] font-bold uppercase tracking-wider
                                     px-1.5 py-0.5 rounded-md
                                     ${media.type === "series" ? "bg-accent/90 text-accent-content" : "bg-primary/90 text-primary-content"}`}>
                        {media.type === "series" ? "Series" : "Movie"}
                    </span>
                </div>
            </div>

            {/* ── ⋮ button — outside overflow:hidden so it never gets clipped ── */}
            <div className="absolute inset-x-0 top-0 pointer-events-none" style={{ aspectRatio: "2 / 3" }}>
                <div className="absolute bottom-2 right-2 pointer-events-auto" onClick={(e) => e.stopPropagation()}>
                    <button
                        ref={btnRef}
                        onClick={handleMenuOpen}
                        className="w-7 h-7 rounded-full md:bg-white/90 hover:bg-white
                                   flex items-center justify-center shadow-md
                                   opacity-100 lg:opacity-0 lg:group-hover:opacity-100
                                   transition-all duration-150 active:scale-95 cursor-pointer"
                        aria-label="More options">
                        <MoreVertical size={14} className="text-white font-bold md:text-black" />
                    </button>
                </div>
            </div>

            {/* Portal menu — lives in <body>, no overflow issues ever */}
            <ContextMenu open={menuOpen} anchor={btnRef.current} onAction={handleAction} onClose={closeMenu} />

            {/* ── Info ── */}
            <div className="mt-2 px-0.5">
                <p className="text-[13px] font-medium text-base-content truncate leading-tight">{media.title}</p>

                <div className="flex items-center justify-between mt-1.5 gap-1">
                    <span className="text-[11px] text-base-content/45 font-medium shrink-0">{media.year ?? "—"}</span>

                    <div className="flex items-center gap-2.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button
                            onClick={() =>
                                toggleFavourite(media.id, {
                                    name: media.title,
                                    poster: media.poster,
                                    type: media.type,
                                })
                            }
                            className="transition-colors duration-150"
                            aria-label="Favourite">
                            <Heart size={13} fill={favourited ? "currentColor" : "none"} className={favourited ? "text-error fill-error" : "text-base-content/40 hover:text-error/70"} />
                        </button>

                        <button
                            onClick={() =>
                                toggleWatchlist(media.id, {
                                    name: media.title,
                                    poster: media.poster,
                                    type: media.type,
                                })
                            }
                            className="transition-colors duration-150"
                            aria-label="Watchlist">
                            <Eye size={13} className={watchlisted ? "text-accent" : "text-base-content/40 hover:text-accent/70"} />
                        </button>

                        {media.rating != null && (
                            <span className="flex items-center gap-0.5">
                                <Star size={10} className="text-warning fill-warning" />
                                <span className="text-[11px] text-base-content/55 font-medium">{media.rating.toFixed(1)}</span>
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
