import { useRef, useState } from "react";
import { Link } from "react-router";
import { EllipsisVertical, Film, Tv } from "lucide-react";
import { api } from "../api/client";
import { getOrCreateClientId } from "../api/stream";
import FloatingActionMenu from "./FloatingActionMenu";

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
    const [thumbError, setThumbError] = useState(false);
    const [posterError, setPosterError] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const btnRef = useRef(null);

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

    // media shape FloatingActionMenu expects — same as MediaCard/MediaDetails
    const media = {
        id: item.id,
        title: item.title,
        poster: item.poster,
        type: mediaType,
        streamUrl: item.streamUrl || `${window.location.origin}/player/${encodeURIComponent(item.id)}`,
    };

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
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setMenuOpen((v) => !v);
                    }}
                    className="shrink-0 mt-0.5 mx-2 border-0 leading-none flex items-center justify-center rounded-md text-white/60 hover:text-white cursor-pointer transition-colors">
                    <EllipsisVertical size={14} />
                </button>

                {/* All option logic lives in FloatingActionMenu — same menu everywhere */}
                <div onClick={(e) => e.preventDefault()}>
                    <FloatingActionMenu open={menuOpen} anchorRef={btnRef} onClose={() => setMenuOpen(false)} media={media} watched={item.completed} onRemove={() => onRemove?.(item)} />
                </div>
            </div>
        </Link>
    );
}
