import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { EllipsisVertical, Film, Tv, Trash2, Heart, Bookmark, BookmarkCheck, Copy, Share2, Check, CheckCircle, Circle } from "lucide-react";
import { api } from "../api/client";
import { getOrCreateClientId } from "../api/stream";
import { useApi } from "../Context/apiContext";

// ─── Icon fallback — only if ffmpeg frame AND poster both fail ─────────────
function IconFallback({ title, type }) {
    return (
        <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-linear-to-br from-base-300 to-base-200">
            {type === "series" || type === "anime" ? <Tv size={24} className="text-base-content/25" /> : <Film size={24} className="text-base-content/25" />}
            <span className="text-base-content/40 text-xs font-semibold text-center px-3 leading-tight line-clamp-1">{title}</span>
        </div>
    );
}

// 65 → "1h 5m", 45 → "45m"
function fmtDuration(secs) {
    if (!secs || secs <= 0) return "0m";
    const mins = Math.round(secs / 60);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

// "Farzi • S1 E1 • Artist"
function buildSeriesLabel(item) {
    const title = item.title || "";
    const se = [item.seasonNumber != null ? `S${item.seasonNumber}` : null, item.episodeNumber != null ? `E${item.episodeNumber}` : null].filter(Boolean).join(" ");
    const epTitle = item.seriesTitle || item.episodeTitle || "";
    return [title, se, epTitle].filter(Boolean).join(" • ");
}

/**
 * HistoryCard — "Continue Watching" card.
 *
 * onRemove(item) — fires after "Remove From History" confirmed in menu.
 */
export default function HistoryCard({ item, onRemove }) {
    const { isFavourite, toggleFavourite, isInWatchlist, toggleWatchlist } = useApi();

    const [thumbError, setThumbError] = useState(false);
    const [posterError, setPosterError] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [menuVisible, setMenuVisible] = useState(false);
    const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
    const [copied, setCopied] = useState(false);
    const btnRef = useRef(null);
    const menuRef = useRef(null);

    const mediaType = item.mediaType || item.type || "movie";
    const isSeries = mediaType === "series" || mediaType === "anime";

    const thumbUrl = api.thumbnailUrl(item.id, item.position, getOrCreateClientId());

    const showThumbnail = !thumbError;
    const showPosterFallback = thumbError && !!item.poster && !posterError;
    const showIconFallback = thumbError && (!item.poster || posterError);

    const pct = item.duration > 0 ? Math.min(100, ((item.position || 0) / item.duration) * 100) : 0;
    const watchedFmt = fmtDuration(item.position);
    const leftFmt = fmtDuration(Math.max(0, (item.duration || 0) - (item.position || 0)));
    const totalFmt = fmtDuration(item.duration);

    const seriesLabel = isSeries ? buildSeriesLabel(item) : null;
    const partLabel = !isSeries && item.partNumber != null ? `Part ${item.partNumber}` : null;

    // ── useApi state — same pattern as MediaCard ────────────────────────────
    const favourited = isFavourite(item.id);
    const watchlisted = isInWatchlist(item.id);
    const payload = { name: item.title, poster: item.poster, type: mediaType };

    function closeMenu() {
        setMenuVisible(false);
        setTimeout(() => setMenuOpen(false), 150);
    }

    useEffect(() => {
        if (!menuOpen) return;
        const raf = requestAnimationFrame(() => setMenuVisible(true));
        function handleClick(e) {
            if (menuRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
            closeMenu();
        }
        function handleScroll() {
            closeMenu();
        }
        document.addEventListener("mousedown", handleClick);
        window.addEventListener("scroll", handleScroll, { capture: true, passive: true });
        window.addEventListener("resize", handleScroll, { passive: true });
        return () => {
            cancelAnimationFrame(raf);
            document.removeEventListener("mousedown", handleClick);
            window.removeEventListener("scroll", handleScroll, { capture: true });
            window.removeEventListener("resize", handleScroll);
        };
    }, [menuOpen]);

    function handleToggleMenu(e) {
        e.preventDefault();
        e.stopPropagation();
        if (menuOpen) {
            closeMenu();
            return;
        }
        if (btnRef.current) {
            const r = btnRef.current.getBoundingClientRect();
            setMenuPos({ top: r.bottom + 4, left: r.right - 192 });
        }
        setMenuVisible(false);
        setMenuOpen(true);
    }

    function handleAction(e, action) {
        e.preventDefault();
        e.stopPropagation();
        switch (action) {
            case "favourite":
                toggleFavourite(item.id, payload);
                break;
            case "watchlist":
                toggleWatchlist(item.id, payload);
                break;
            case "copy": {
                const url = item.streamUrl || `${window.location.origin}/player/${encodeURIComponent(item.id)}`;
                navigator.clipboard
                    ?.writeText(url)
                    .then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                    })
                    .catch(() => {});
                break;
            }
            case "share": {
                const shareUrl = `${window.location.origin}/media/${encodeURIComponent(item.id)}`;
                if (navigator.share) {
                    // Must be called synchronously inside a user-gesture handler.
                    // setTimeout breaks the gesture context on mobile browsers.
                    navigator
                        .share({
                            title: item.title || "Watch on FLUX",
                            text: item.title || "",
                            url: shareUrl,
                        })
                        .then(() => closeMenu())
                        .catch(() => closeMenu());
                } else {
                    navigator.clipboard?.writeText(shareUrl).catch(() => {});
                    closeMenu();
                }
                break;
            }
            case "trailer":
                closeMenu();
                // Not yet functional — trailer URL not stored in history
                break;
            case "remove":
                closeMenu();
                onRemove?.(item);
                break;
        }
    }

    return (
        <Link
            to={`/player/${encodeURIComponent(item.id)}`}
            state={{ knownResumePosition: item.position }}
            className="relative shrink-0 w-56 sm:w-64 cursor-pointer select-none no-underline my-2 ml-0.5">
            {/* ── Thumbnail ── */}
            <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-base-300 shadow-lg ring-1 ring-white/5 transition-transform duration-200 hover:scale-[1.03] hover:shadow-2xl hover:ring-white/20">
                {showThumbnail && (
                    <img
                        src={thumbUrl}
                        alt={item.title}
                        className="absolute inset-0 w-full h-full object-cover object-center block"
                        loading="lazy"
                        draggable={false}
                        onError={() => setThumbError(true)}
                    />
                )}
                {showPosterFallback && (
                    <img
                        src={item.poster}
                        alt={item.title}
                        className="absolute inset-0 w-full h-full object-cover object-center block"
                        loading="lazy"
                        draggable={false}
                        onError={() => setPosterError(true)}
                    />
                )}
                {showIconFallback && (
                    <div className="absolute inset-0">
                        <IconFallback title={item.title} type={mediaType} />
                    </div>
                )}

                <div className="absolute inset-0 bg-linear-to-t from-black/55 via-transparent to-transparent" />

                {/* Type badge */}
                <span
                    className={`absolute top-2 right-2 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md ${isSeries ? "bg-accent/90 text-accent-content" : "bg-primary/90 text-primary-content"}`}>
                    {mediaType === "anime" ? "Anime" : mediaType === "series" ? "Series" : "Movie"}
                </span>

                {/* Seekbar + watched/left */}
                <div className="absolute bottom-2 left-2 right-2 z-10">
                    <p className="text-[11px] text-white/80 font-medium mb-1 truncate">
                        {item.completed ? (
                            "Watched"
                        ) : (
                            <>
                                {watchedFmt} watched / {leftFmt} left <span className="px-1">•</span> {totalFmt}
                            </>
                        )}
                    </p>
                    <div className="relative h-1 rounded-full bg-white/25 overflow-hidden">
                        <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
                    </div>
                </div>
            </div>

            {/* ── Info ── */}
            <div className="flex justify-between items-start mt-2 px-0.5">
                <div className="flex-1 min-w-0">
                    {isSeries ? (
                        <p className="text-[12.5px] font-medium text-base-content/85 truncate leading-tight" title={seriesLabel}>
                            {seriesLabel}
                        </p>
                    ) : (
                        <p className="text-[13px] font-medium text-base-content truncate leading-tight" title={item.title}>
                            {item.title}
                            {partLabel && <span className="ml-1 text-base-content/40 text-[11px] font-normal">{partLabel}</span>}
                        </p>
                    )}
                </div>

                <button
                    ref={btnRef}
                    type="button"
                    onClick={handleToggleMenu}
                    className="shrink-0 mt-0.5 mx-2 border-0 leading-none flex items-center justify-center rounded-md text-white/60 hover:text-white cursor-pointer transition-colors">
                    <EllipsisVertical size={14} />
                </button>

                {menuOpen &&
                    createPortal(
                        <div
                            ref={menuRef}
                            style={{
                                position: "fixed",
                                top: menuPos.top,
                                left: menuPos.left,
                                opacity: menuVisible ? 1 : 0,
                                transform: menuVisible ? "scale(1)" : "scale(0.95)",
                                transformOrigin: "top right",
                                transition: "opacity 150ms ease, transform 150ms ease",
                                zIndex: 9999,
                            }}
                            className="w-52 rounded-xl bg-[oklch(15%_0.01_260/0.97)] backdrop-blur-md shadow-2xl border border-white/10 py-1.5"
                            onClick={(e) => e.stopPropagation()}>
                            {/* Add to Favorites — toggleFavourite (same as MediaCard) */}
                            <MenuItem
                                icon={favourited ? Heart : Heart}
                                label={favourited ? "Remove from Favorites" : "Add to Favorites"}
                                active={favourited}
                                iconClass={favourited ? "text-error" : "text-white/45"}
                                onClick={(e) => handleAction(e, "favourite")}
                            />

                            {/* Add to Watchlist — toggleWatchlist (same as MediaCard) */}
                            <MenuItem
                                icon={watchlisted ? BookmarkCheck : Bookmark}
                                label={watchlisted ? "Remove from Watchlist" : "Add to Watchlist"}
                                active={watchlisted}
                                iconClass={watchlisted ? "text-accent" : "text-white/45"}
                                onClick={(e) => handleAction(e, "watchlist")}
                            />

                            {/* Mark as Watched / Unwatched — item.completed drives label */}
                            <MenuItem
                                icon={item.completed ? CheckCircle : Circle}
                                label={item.completed ? "Mark as Unwatched" : "Mark as Watched"}
                                active={item.completed}
                                iconClass={item.completed ? "text-success" : "text-white/45"}
                                onClick={(e) => handleAction(e, "watched")}
                            />

                            <Divider />

                            {/* Watch Trailer — not yet functional */}
                            <MenuItem icon={Film} label="Watch Trailer" iconClass="text-white/45" onClick={(e) => handleAction(e, "trailer")} />

                            {/* Copy Stream Link — clipboard functional */}
                            <MenuItem
                                icon={copied ? Check : Copy}
                                label={copied ? "Copied!" : "Copy Stream Link"}
                                active={copied}
                                iconClass={copied ? "text-success" : "text-white/45"}
                                onClick={(e) => handleAction(e, "copy")}
                            />

                            {/* Share — Web Share API */}
                            <MenuItem icon={Share2} label="Share" iconClass="text-white/45" onClick={(e) => handleAction(e, "share")} />

                            <Divider />

                            {/* Remove from History */}
                            <MenuItem icon={Trash2} label="Remove From History" iconClass="text-white/45" textClass="text-error/80 hover:text-error" onClick={(e) => handleAction(e, "remove")} />
                        </div>,
                        document.body,
                    )}
            </div>
        </Link>
    );
}

// ─── Shared menu item component ───────────────────────────────────────────────
function MenuItem({ icon: Icon, label, onClick, iconClass = "text-white/45", textClass = "text-white/80", active }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`w-full flex items-center gap-3 px-4 py-2.5 text-[13px] font-medium cursor-pointer
                        hover:bg-white/8 active:bg-white/12 transition-colors duration-100
                        ${textClass}`}>
            <Icon size={14} strokeWidth={1.8} className={`shrink-0 ${iconClass}`} fill={active && Icon.name === "Heart" ? "currentColor" : "none"} />
            {label}
        </button>
    );
}

// ─── Divider ──────────────────────────────────────────────────────────────────
function Divider() {
    return <div className="my-1 mx-3 border-t border-white/8" />;
}
