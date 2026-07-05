import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { EllipsisVertical, Film, Tv, Trash2 } from "lucide-react";
import { api } from "../api/client";
import { getOrCreateClientId } from "../api/stream";

// ─── Icon fallback — only if ffmpeg frame AND poster both fail ─────────────
function IconFallback({ title, type }) {
    return (
        <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-linear-to-br from-base-300 to-base-200">
            {type === "series" || type === "anime" ? <Tv size={24} className="text-base-content/25" /> : <Film size={24} className="text-base-content/25" />}
            <span className="text-base-content/40 text-xs font-semibold text-center px-3 leading-tight line-clamp-1">{title}</span>
        </div>
    );
}

// 14 → "14s", 65 → "1h 5m", 45 → "45m"
function fmtDuration(secs) {
    if (!secs || secs <= 0) return "0s";
    if (secs < 60) return `${Math.round(secs)}s`;
    const mins = Math.round(secs / 60);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

/**
 * HistoryCard — "Continue Watching" card, landscape (same shape/hover as LiveCard).
 *
 * item shape (server/utils/userStore.js → saveProgress):
 *   { id, mediaType, title,
 *     seriesTitle,   — episode title for series/anime (replaces episodeTitle)
 *     seasonNumber,  — integer | null
 *     episodeNumber, — integer | null
 *     partNumber,    — integer | null  (multi-part movies)
 *     episodeTitle,  — legacy alias, still accepted
 *     poster, streamUrl, position, maxPositionReached,
 *     duration, completed, watchedAt }
 *
 * <img src> → GET /api/media/:id/thumbnail?time=<position>&clientId=<cid>
 * Falls back to poster → icon tile if ffmpeg extraction fails.
 *
 * onRemove(item) — fired by parent (ContinueWatchingRow) which owns the
 * TanStack mutation + optimistic cache update.
 */
export default function HistoryCard({ item, onRemove }) {
    const [thumbError, setThumbError] = useState(false);
    const [posterError, setPosterError] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [menuVisible, setMenuVisible] = useState(false);
    const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
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

    // partNumber sub-label for multi-part movies
    const partLabel = !isSeries && item.partNumber != null ? `Part ${item.partNumber}` : null;

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

    function handleRemove(e) {
        e.preventDefault();
        e.stopPropagation();
        closeMenu();
        onRemove?.(item);
    }

    return (
        <Link
            to={`/player/${encodeURIComponent(item.id)}`}
            state={{ knownResumePosition: item.position }}
            className="relative shrink-0 w-56 sm:w-64 cursor-pointer select-none no-underline my-2 ml-0.5">
            {/* ── Thumbnail ── */}
            <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-base-300 shadow-lg ring-1 ring-white/5 transition-transform duration-200 hover:scale-[1.03] hover:shadow-2xl hover:ring-white/20">
                {showThumbnail && <img src={thumbUrl} alt={item.title || item.name} className="w-full h-full object-cover" loading="lazy" draggable={false} onError={() => setThumbError(true)} />}

                {showPosterFallback && (
                    <img
                        src={item.poster}
                        alt={item.title || item.name}
                        className="absolute inset-0 w-full h-full object-cover"
                        loading="lazy"
                        draggable={false}
                        onError={() => setPosterError(true)}
                    />
                )}

                {showIconFallback && (
                    <div className="absolute inset-0">
                        <IconFallback title={item.title || item.name} type={mediaType} />
                    </div>
                )}

                <div className="absolute inset-0 bg-linear-to-t from-black/55 via-transparent to-transparent" />

                {/* Type badge */}
                <span
                    className={`absolute top-2 right-2 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md ${
                        isSeries ? "bg-accent/90 text-accent-content" : "bg-primary/90 text-primary-content"
                    }`}>
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
                        <>
                            {/* Line 1: Series Name · Episode Title */}
                            <p
                                className="text-[13px] font-medium text-base-content truncate leading-tight"
                                title={`${item.title}${item.seriesTitle || item.episodeTitle ? ` · ${item.seriesTitle || item.episodeTitle}` : ""}`}>
                                <span>{item.title}</span>
                                {(item.seriesTitle || item.episodeTitle) && (
                                    <>
                                        <span className="mx-1 text-base-content/30">·</span>
                                        <span className="text-base-content/70">{item.seriesTitle || item.episodeTitle}</span>
                                    </>
                                )}
                            </p>
                            {/* Line 2: S1 · E3 */}
                            {(item.seasonNumber != null || item.episodeNumber != null) && (
                                <p className="text-[11px] text-base-content/45 font-medium mt-0.5 truncate leading-snug">
                                    {item.seasonNumber != null && <span>S{item.seasonNumber}</span>}
                                    {item.seasonNumber != null && item.episodeNumber != null && <span className="mx-1 text-base-content/25">·</span>}
                                    {item.episodeNumber != null && <span>E{item.episodeNumber}</span>}
                                </p>
                            )}
                        </>
                    ) : (
                        /* Movie: title + optional Part N */
                        <p className="text-[13px] font-medium text-base-content truncate leading-tight" title={item.title || item.name}>
                            {item.title || item.name}
                            {partLabel && <span className="ml-1 text-base-content/40 text-[11px] font-normal">{partLabel}</span>}
                        </p>
                    )}
                </div>

                <button
                    ref={btnRef}
                    type="button"
                    onClick={handleToggleMenu}
                    className="shrink-0 mt-0.5 mx-2 border-0 leading-none flex items-center justify-center rounded-md text-white hover:text-primary cursor-pointer transition-colors">
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
                            className="w-48 rounded-md bg-base-200 shadow-xl ring-1 ring-white/10 py-1"
                            onClick={(e) => e.stopPropagation()}>
                            <button
                                type="button"
                                onClick={handleRemove}
                                className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-base-content/80 hover:bg-base-300 hover:text-error transition-colors">
                                <Trash2 size={14} />
                                Remove From History
                            </button>
                        </div>,
                        document.body,
                    )}
            </div>
        </Link>
    );
}
