import { useRef, useState } from "react";
import { EllipsisVertical, Film, Tv, Check, Clock } from "lucide-react";
import { api } from "../../Api/client";
import { getOrCreateClientId } from "../../Api/stream";
import FloatingActionMenu from "../Layout/FloatingActionMenu";
import HorizontalCard from "./HorizontalCard";
import { routeId } from "../../Utils/shortId.js";

// ─── Icon fallback — only if ffmpeg frame AND poster both fail ─────────────
function IconFallback({ title, type }) {
    return (
        <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-linear-to-br from-base-300 to-base-200">
            {type === "series" || type === "anime" ? <Tv size={24} className="text-base-content/25" /> : <Film size={24} className="text-base-content/25" />}
            <span className="text-base-content/40 text-xs font-semibold text-center px-3 leading-tight line-clamp-1">{title}</span>
        </div>
    );
}

// ISO string / ms -> "Today", "2d ago" ...
function timeAgo(ts) {
    if (!ts) return null;
    const t = new Date(ts).getTime();
    if (Number.isNaN(t)) return null;
    const days = Math.floor((Date.now() - t) / 86400000);
    if (days < 1) return "Today";
    if (days < 30) return `${days}d ago`;
    return `${Math.floor(days / 30)}mo ago`;
}

// when the item was last watched — field name differs between history sources
const lastWatchedAt = (item) => item?.updatedAt ?? item?.lastWatched ?? item?.lastWatchedAt ?? item?.watchedAt ?? item?.timestamp ?? item?.date ?? null;

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
 * Same visuals as before — now composed from the shared HorizontalCard shell.
 *
 * onRemove(item) — fires after "Remove From History" confirmed in menu.
 * variant — card style id to force (settings preview); default follows the user setting.
 * previewThumb — image URL that replaces the server thumbnail (settings preview only).
 *
 * Builds props for every card style (classic props + rich props); each style's HorizontalShell picks what it uses.
 */
export default function HistoryCard({ item, onRemove, variant, previewThumb }) {
    const [thumbError, setThumbError] = useState(false);
    const [posterError, setPosterError] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const btnRef = useRef(null);

    const mediaType = item.mediaType || item.type || "movie";
    const isSeries = mediaType === "series" || mediaType === "anime";

    const thumbUrl = previewThumb ?? api.thumbnailUrl(item.id, item.position, getOrCreateClientId());

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
        streamUrl: item.streamUrl || `${window.location.origin}/player/${routeId(item.id)}`,
    };

    const thumbnail = (
        <>
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
        </>
    );

    const badge = (
        <span
            className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md ${isSeries ? "bg-accent/90 text-accent-content" : "bg-primary/90 text-primary-content"}`}>
            {mediaType === "anime" ? "Anime" : mediaType === "series" ? "Series" : "Movie"}
        </span>
    );

    const footerText = item.completed ? (
        "Watched"
    ) : (
        <>
            {watchedFmt} watched / {leftFmt} left <span className="px-1">•</span> {totalFmt}
        </>
    );

    const title = isSeries ? (
        <p className="text-[12.5px] font-medium text-base-content/85 truncate leading-tight" title={seriesLabel}>
            {seriesLabel}
        </p>
    ) : (
        <p className="text-[13px] font-medium text-base-content truncate leading-tight" title={item.title}>
            {item.title}
            {partLabel && <span className="ml-1 text-base-content/40 text-[11px] font-normal">{partLabel}</span>}
        </p>
    );

    // All option logic lives in FloatingActionMenu — same menu everywhere.
    // Each card style draws the ⋮ button with its own classes via renderMenu(className).
    // preventDefault on both the trigger button and the menu wrapper — the
    // card itself is a <Link>, this stops the menu from also navigating it.
    const renderMenu = (btnClass) => (
        <>
            <button
                ref={btnRef}
                type="button"
                aria-label="More options"
                onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setMenuOpen((v) => !v);
                }}
                className={btnClass}>
                <EllipsisVertical size={14} />
            </button>
            <div onClick={(e) => e.preventDefault()}>
                <FloatingActionMenu open={menuOpen} anchorRef={btnRef} onClose={() => setMenuOpen(false)} media={media} watched={item.completed} onRemove={() => onRemove?.(item)} />
            </div>
        </>
    );

    // ── Rich props (flat designs) ──
    const typeLabel = mediaType === "anime" ? "ANIME" : isSeries ? "SERIES" : "MOVIE";
    const seMeta = [item.seasonNumber != null ? `S${item.seasonNumber}` : null, item.episodeNumber != null ? `E${item.episodeNumber}` : null].filter(Boolean).join(" · ");
    const year = item.year ?? item.metadata?.year ?? null;
    const ago = timeAgo(lastWatchedAt(item));

    return (
        <HorizontalCard
            variant={variant}
            to={`/player/${routeId(item.id)}`}
            state={{ knownResumePosition: item.position }}
            thumbnail={thumbnail}
            progress={pct}
            completed={!!item.completed}
            renderMenu={renderMenu}
            // classic
            badge={badge}
            footerText={footerText}
            title={title}
            // rich
            tone={isSeries ? "accent" : "primary"}
            tag={item.completed ? { text: "Watched", icon: Check } : { text: `${leftFmt} left` }}
            tab={
                ago ? (
                    <>
                        <Clock size={12} className="text-base-content/70" />
                        {ago}
                    </>
                ) : null
            }
            heading={
                <span title={isSeries ? seriesLabel : item.title}>
                    {item.title}
                    {partLabel && <span className="ml-1 text-[11px] font-normal text-base-content/70">{partLabel}</span>}
                </span>
            }
            meta={isSeries ? seMeta || typeLabel : `${typeLabel}${year ? ` · ${year}` : ""}`}
        />
    );
}
