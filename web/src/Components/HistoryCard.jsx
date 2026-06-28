import { useState } from "react";
import { Link } from "react-router";
import { Film, Tv } from "lucide-react";
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

// 65 → "1h 5m", 45 → "45m"
function fmtDuration(secs) {
    if (!secs || secs <= 0) return "0m";
    const mins = Math.round(secs / 60);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

/**
 * HistoryCard — "Continue Watching" card, landscape (same shape/hover as LiveCard).
 *
 * item shape (server/utils/userStore.js → saveProgress) — note there is NO
 * image field here at all anymore. Preview frame comes from a dedicated
 * on-demand route, not history.json:
 *   { id, mediaType, title, episodeTitle, name, poster,
 *     position, maxPositionReached, duration, completed, streamUrl }
 *
 * <img src> hits GET /api/media/:id/thumbnail?time=<position>&clientId=<cid>
 * — the backend extracts a single frame with ffmpeg at that timestamp and
 * caches/overwrites it server-side. Falls back to poster, then an icon tile,
 * if extraction fails (codec issue, file moved, etc).
 */
export default function HistoryCard({ item }) {
    const [thumbError, setThumbError] = useState(false);
    const [posterError, setPosterError] = useState(false);

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

    return (
        <Link
            to={`/player/${encodeURIComponent(item.id)}`}
            state={{ knownResumePosition: item.position }}
            className="group relative shrink-0 w-56 sm:w-64 cursor-pointer select-none no-underline my-2">
            {/* ── Thumbnail ── */}
            <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-base-300 shadow-lg ring-1 ring-white/5 transition-transform duration-200 group-hover:scale-[1.03] group-hover:shadow-2xl group-hover:ring-white/20">
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

                {/* Type badge — same color scheme as MediaCard: accent(blue)=series/anime, primary=movie */}
                <span
                    className={`absolute top-2 right-2 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md ${isSeries ? "bg-accent/90 text-accent-content" : "bg-primary/90 text-primary-content"}`}>
                    {mediaType === "anime" ? "Anime" : mediaType === "series" ? "Series" : "Movie"}
                </span>
            </div>

            {/* Seekbar — rounded, overlaps thumbnail bottom edge, fill = position/duration */}
            <div className="relative -mt-2 mx-2 h-1.5 rounded-full bg-black/70 overflow-hidden z-10">
                <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
            </div>

            {/* ── Info ── */}
            <div className="mt-2 px-0.5">
                <p className="text-[13px] font-medium text-base-content truncate leading-tight">
                    {isSeries && item.title ? (
                        <>
                            {item.title}
                            <span className="px-1 text-base-content/35">•</span>
                            {item.episodeTitle || item.name}
                        </>
                    ) : (
                        item.title || item.name
                    )}
                </p>
                <p className="text-[11px] text-base-content/45 font-medium mt-1 truncate">
                    {item.completed ? (
                        "Watched"
                    ) : (
                        <>
                            {watchedFmt} watched / {leftFmt} left <span className="px-1">•</span> {totalFmt}
                        </>
                    )}
                </p>
            </div>
        </Link>
    );
}
