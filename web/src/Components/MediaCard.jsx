import { Fragment, useState, useRef, useEffect } from "react";
import { MoreVertical, Tv, Star, Eye, Heart, Film } from "lucide-react";
import { useApi } from "../Context/apiContext";
import { useNavigate } from "react-router";
import FloatingActionMenu from "./FloatingActionMenu";

// ─── Badge (reusable) ─────────────────────────────────────────────────────────
// <Badge tone="glass" dot>Upcoming</Badge> — tones follow the daisyUI theme colours.
const BADGE_TONES = {
    primary: "bg-primary/90 text-primary-content",
    secondary: "bg-secondary/90 text-secondary-content",
    accent: "bg-accent/90 text-accent-content",
    success: "bg-success/90 text-success-content",
    warning: "bg-warning/90 text-warning-content",
    info: "bg-info/90 text-info-content",
    neutral: "bg-black/65 text-white backdrop-blur-sm",
    glass: "bg-black/70 text-white backdrop-blur-sm ring-1 ring-primary/70",
};

export function Badge({ children, tone = "primary", dot = false, className = "" }) {
    return (
        <span className={`inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md ${BADGE_TONES[tone] ?? BADGE_TONES.primary} ${className}`}>
            {dot && <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />}
            {children}
        </span>
    );
}

// ─── Countdown (only rendered when a card gets a releaseDate) ────────────────
export function useCountdown(iso) {
    const target = iso ? new Date(iso).getTime() : NaN;
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (Number.isNaN(target)) return;
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [target]);

    if (Number.isNaN(target)) return null;
    const diff = Math.max(target - now, 0);
    return {
        done: diff === 0,
        d: Math.floor(diff / 86400000),
        h: Math.floor(diff / 3600000) % 24,
        m: Math.floor(diff / 60000) % 60,
        s: Math.floor(diff / 1000) % 60,
    };
}

// Pass `t` (from useCountdown) to share one ticker with the parent, or just `releaseDate`.
// Renders nothing once the date has passed.
export function Countdown({ releaseDate, t: tProp }) {
    const own = useCountdown(tProp ? null : releaseDate);
    const t = tProp ?? own;
    if (!t || t.done) return null;

    // one accent colour (theme primary — red = urgency, the same ring as the Upcoming badge), everything else white
    const panel = "rounded-md bg-black/60 backdrop-blur-md ring-1 ring-primary shadow-lg";

    const cells = [
        [t.d, "Days"],
        [t.h, "Hrs"],
        [t.m, "Min"],
        [t.s, "Sec"],
    ];

    return (
        <div className={`${panel} relative overflow-hidden pt-1.5`} role="timer" aria-label={`Releases in ${t.d} days ${t.h} hours ${t.m} minutes`}>
            <div className="flex items-stretch">
                {cells.map(([v, label], i) => (
                    <Fragment key={label}>
                        {i > 0 && <span className="w-px self-stretch bg-primary" />}
                        <div className="min-w-7.5 px-1.5 pb-2 text-center">
                            <div className={`text-[13px] font-semibold leading-none tabular-nums ${label === "Sec" ? "text-primary" : "text-white"}`}>{String(v).padStart(2, "0")}</div>
                            <div className={`text-[7px] font-semibold uppercase leading-none mt-1 tracking-[0.14em] ${label === "Sec" ? "text-primary/60" : "text-white/50"}`}>{label}</div>
                        </div>
                    </Fragment>
                ))}
            </div>
            {/* <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" /> */}
        </div>
    );
}

// ─── Data normaliser ──────────────────────────────────────────────────────────
function normalise(item) {
    const isMovie = item.parsed?.type === "movie" || item.type === "movie";
    if (isMovie) {
        return {
            id: item.id,
            type: "movie",
            // Prefer TMDB title/year; fall back to parsed (pre-enrichment or KGF)
            title: item.metadata?.title || item.parsed?.title || item.name || item.title || "Unknown",
            year: item.metadata?.year ?? item.parsed?.year ?? item.year ?? null,
            poster: item.metadata?.poster ?? item.poster ?? null,
            rating: item.metadata?.rating ?? item.rating ?? null,
            streamUrl: item.streamUrl,
            raw: item,
        };
    }
    return {
        id: item.id,
        type: "series",
        title: item.metadata?.title ?? item.title ?? item.name ?? "Unknown",
        year: item.metadata?.year ?? item.year ?? null,
        poster: item.metadata?.poster ?? item.poster ?? null,
        rating: item.metadata?.rating ?? item.rating ?? null,
        streamUrl: null,
        raw: item,
    };
}

// ─── Poster fallback ──────────────────────────────────────────────────────────
function PosterFallback({ title, type }) {
    return (
        <div
            className="w-full h-full flex flex-col items-center justify-center gap-3
                        bg-linear-to-br from-base-300 to-base-200">
            {type === "series" ? <Tv size={30} className="text-base-content/40" /> : <Film size={30} className="text-base-content/40" />}
            <span
                className="text-base-content/60 text-xs font-semibold text-center
                             px-3 leading-tight line-clamp-3">
                {title}
            </span>
        </div>
    );
}

// ─── MediaCard ────────────────────────────────────────────────────────────────
// Optional extras — pass as props or put them on the item (_badge, _badgeTone, _release).
// Nothing extra is shown unless a page provides them:
//   badge        — text for a top-left Badge
//   badgeTone    — Badge tone (default "primary")
//   badgeDot     — small pulsing dot before the badge text
//   releaseDate  — ISO date; shows a live countdown centred at the bottom of the poster
export default function MediaCard({ item, onPlay, onWatchTrailer, isLoading, badge: badgeProp, badgeTone: toneProp, badgeDot: dotProp, releaseDate: releaseProp }) {
    const badge = badgeProp ?? item._badge;
    const badgeTone = toneProp ?? item._badgeTone ?? "primary";
    const badgeDot = dotProp ?? item._badgeDot ?? false;
    const releaseDate = releaseProp ?? item._release;
    // upcoming = has a release date that hasn't passed yet; after release the card turns back into a normal one
    const countdown = useCountdown(releaseDate);
    const isUpcoming = Boolean(countdown && !countdown.done);
    const { isInWatchlist, toggleWatchlist, isFavourite, toggleFavourite } = useApi();
    const navigate = useNavigate();
    const media = normalise(item);

    const [menuOpen, setMenuOpen] = useState(false);
    const [imgError, setImgError] = useState(false);
    const btnRef = useRef(null);

    const watchlisted = isInWatchlist(media.id);
    const favourited = isFavourite(media.id);
    const payload = { name: media.title, poster: media.poster, type: media.type, year: media.year, rating: media.rating };

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
                <div className="absolute top-2 right-2">
                    <span
                        className={`text-[9px] font-bold uppercase tracking-wider
                                     px-1.5 py-0.5 rounded-md
                                     ${media.type === "series" ? "bg-accent/90 text-accent-content" : "bg-primary/90 text-primary-content"}`}>
                        {media.type === "series" ? "Series" : "Movie"}
                    </span>
                </div>

                {/* Custom badge — top-left, only when provided */}
                {badge && (!releaseDate || isUpcoming) && (
                    <div className="absolute top-2 left-2">
                        <Badge tone={badgeTone} dot={badgeDot}>
                            {badge}
                        </Badge>
                    </div>
                )}

                {/* Release countdown — bottom-centre, only when provided */}
                {isUpcoming && (
                    <div className="absolute inset-x-0 bottom-2 flex justify-center pointer-events-none">
                        <Countdown t={countdown} />
                    </div>
                )}
            </div>

            {/* ── ⋮ button — outside overflow:hidden so it never gets clipped ── */}
            {!isUpcoming && (
                <div className="absolute inset-x-0 top-0 pointer-events-none" style={{ aspectRatio: "2 / 3" }}>
                    <div className="absolute bottom-2 right-2 pointer-events-auto" onClick={(e) => e.stopPropagation()}>
                        <button
                            ref={btnRef}
                            onClick={(e) => {
                                e.stopPropagation();
                                setMenuOpen((v) => !v);
                            }}
                            className="w-7 h-7 rounded-full md:bg-white/90 hover:bg-white
                                   flex items-center justify-center shadow-md
                                   opacity-100 lg:opacity-0 lg:group-hover:opacity-100
                                   transition-all duration-150 active:scale-95 cursor-pointer"
                            aria-label="More options">
                            <MoreVertical size={14} className="text-white font-bold md:text-black" />
                        </button>
                    </div>
                </div>
            )}

            {/* All option logic lives in FloatingActionMenu — same menu everywhere */}
            <div onClick={(e) => e.stopPropagation()}>
                <FloatingActionMenu open={menuOpen} anchorRef={btnRef} onClose={() => setMenuOpen(false)} media={media} onWatchTrailer={onWatchTrailer} />
            </div>

            {/* ── Info ── */}
            <div className="mt-2 px-0.5">
                <p className="text-[13px] font-medium text-base-content truncate leading-tight">{media.title}</p>

                <div className="flex items-center justify-between mt-1.5 gap-1">
                    <span className="text-[11px] text-base-content/70 font-medium shrink-0">{media.year ?? "—"}</span>

                    <div className="flex items-center gap-2.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => toggleFavourite(media.id, payload)} className="transition-colors duration-150" aria-label="Favourite">
                            <Heart size={13} fill={favourited ? "currentColor" : "none"} className={favourited ? "text-error fill-error" : "text-base-content/65 hover:text-error/85"} />
                        </button>

                        <button onClick={() => toggleWatchlist(media.id, payload)} className="transition-colors duration-150" aria-label="Watchlist">
                            <Eye size={13} className={watchlisted ? "text-accent" : "text-base-content/65 hover:text-accent/85"} />
                        </button>

                        {media.rating != null && (
                            <span className="flex items-center gap-0.5">
                                <Star size={10} className="text-warning fill-warning" />
                                <span className="text-[11px] text-base-content/75 font-medium">{media.rating.toFixed(1)}</span>
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
