import { Fragment, useState, useRef, useEffect } from "react";
import { MoreVertical, Tv, Star, Eye, Heart, Film } from "lucide-react";
import { useApi } from "../../Context/apiContext";
import { useNavigate } from "react-router";
import FloatingActionMenu from "../Layout/FloatingActionMenu";
import { routeId } from "../../Utils/shortId.js";
import { useCardStyle } from "../../Pages/Settings/Components/shared";

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
    const panel = "rounded-md bg-black/75 ring-1 ring-primary shadow-lg";

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

// ─── Classic MediaCard (original design, default) ─────────────────────────────
// Optional extras — pass as props or put them on the item (_badge, _badgeTone, _release).
// Nothing extra is shown unless a page provides them:
//   badge        — text for a top-left Badge
//   badgeTone    — Badge tone (default "primary")
//   badgeDot     — small pulsing dot before the badge text
//   releaseDate  — ISO date; shows a live countdown centred at the bottom of the poster
function ClassicMediaCard({ item, onPlay, onWatchTrailer, isLoading, badge: badgeProp, badgeTone: toneProp, badgeDot: dotProp, releaseDate: releaseProp }) {
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
        <div onClick={() => navigate(`/media/${routeId(media.id)}`)} className="group relative shrink-0 w-40 sm:w-44 cursor-pointer select-none my-2">
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
                <div className="absolute inset-0 bg-linear-to-t from-black/25 via-transparent to-transparent" />

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

// ─── Card detail helpers (used by the Flux design) ────────────────────────────
// Every helper returns null when the field is missing, so the tag/tile simply hides.
// If your /media items use different field names, change them here — one place only.

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
};

const firstEpisode = (item) => item?.episodes?.[0] ?? item?.seasons?.[0]?.episodes?.[0] ?? null;

function labelFromHeight(h) {
    if (h >= 2000) return "4K";
    if (h >= 1400) return "1440p";
    if (h >= 1000) return "1080p";
    if (h >= 700) return "720p";
    return "SD";
}

/** "4K" | "1080p" | "720p" | "SD" | null */
function getResolution(item) {
    const src = item?.mediaInfo ?? item?.mediainfo ?? item;
    const ep = firstEpisode(item);
    const raw = src?.resolution ?? item?.parsed?.resolution ?? item?.quality ?? ep?.resolution ?? ep?.parsed?.resolution ?? null;

    if (typeof raw === "string") {
        if (/4k|2160/i.test(raw)) return "4K";
        const p = raw.match(/(\d{3,4})\s*p/i);
        if (p) return labelFromHeight(Number(p[1]));
        const wh = raw.match(/(\d{3,4})\s*[x×]\s*(\d{3,4})/i);
        if (wh) return labelFromHeight(Number(wh[2]));
    }
    const h = num(src?.height ?? src?.video?.height ?? ep?.height ?? ep?.video?.height);
    return h ? labelFromHeight(h) : null;
}

/** minutes -> "2H 49M" */
function fmtRuntimeMins(mins) {
    const m = Math.round(mins);
    if (!m || m <= 0) return null;
    const h = Math.floor(m / 60);
    const r = m % 60;
    return h > 0 ? `${h}H ${r}M` : `${r}M`;
}

/** movie runtime label, e.g. "2H 49M" */
function getRuntimeLabel(item) {
    const mins = num(item?.metadata?.runtime ?? item?.runtime);
    if (mins) return fmtRuntimeMins(mins);
    const secs = num(item?.duration ?? item?.mediaInfo?.duration ?? item?.mediainfo?.duration);
    return secs ? fmtRuntimeMins(secs / 60) : null;
}

/** series label, e.g. "2 SE · 18 EPI" */
function getSeasonEpLabel(item) {
    const seasons = num(item?.seasonCount ?? item?.metadata?.seasonCount ?? item?.seasons?.length);
    let eps = num(item?.episodeCount ?? item?.metadata?.episodeCount);
    if (!eps && Array.isArray(item?.seasons)) {
        const total = item.seasons.reduce((n, s) => n + (Array.isArray(s?.episodes) ? s.episodes.length : 0), 0);
        eps = num(total);
    }
    if (!eps && Array.isArray(item?.episodes)) eps = num(item.episodes.length);
    const parts = [seasons ? `${seasons} SE` : null, eps ? `${eps} EPI` : null].filter(Boolean);
    return parts.length ? parts.join(" · ") : null;
}

// ─── Flux MediaCard ───────────────────────────────────────────────────────────
// Flat card, no outline. Corner rating tab, type-coloured tags (primary = movie,
// accent = series), one-line meta footer, tiled actions on hover (lg+).
const FLUX_TONE = {
    movie: "bg-primary text-primary-content",
    series: "bg-accent text-accent-content",
};

function FluxTag({ type, className = "", children }) {
    return <span className={`inline-flex items-center rounded-sm px-1.5 py-0.5 font-mono text-[11px] font-medium leading-tight ${FLUX_TONE[type]} ${className}`}>{children}</span>;
}

function FluxPosterFallback({ title, type }) {
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2.5 bg-base-300 px-3 text-center">
            {type === "series" ? <Tv size={28} className="text-base-content/40" /> : <Film size={28} className="text-base-content/40" />}
            <span className="line-clamp-3 text-[13px] font-medium leading-tight text-base-content/80">{title}</span>
        </div>
    );
}

function FluxMediaCard({ item, onWatchTrailer, badge: badgeProp, badgeDot: dotProp, releaseDate: releaseProp }) {
    const badge = badgeProp ?? item._badge;
    const badgeDot = dotProp ?? item._badgeDot ?? false;
    const releaseDate = releaseProp ?? item._release;
    const countdown = useCountdown(releaseDate);
    const isUpcoming = Boolean(countdown && !countdown.done);
    const { isInWatchlist, toggleWatchlist, isFavourite, toggleFavourite } = useApi();
    const navigate = useNavigate();
    const media = normalise(item);

    const [menuOpen, setMenuOpen] = useState(false);
    const [imgError, setImgError] = useState(false);
    const anchorRef = useRef(null);

    const watchlisted = isInWatchlist(media.id);
    const favourited = isFavourite(media.id);
    const payload = { name: media.title, poster: media.poster, type: media.type, year: media.year, rating: media.rating };

    const resolution = getResolution(item);
    const lengthLabel = media.type === "series" ? getSeasonEpLabel(item) : getRuntimeLabel(item);
    const showBadgeTab = Boolean(badge) && (!releaseDate || isUpcoming);

    const openMenu = (e) => {
        e.stopPropagation();
        anchorRef.current = e.currentTarget;
        setMenuOpen((v) => !v);
    };

    // surface colour follows the card on hover so tabs/tiles blend in
    const surface = "bg-base-200 group-hover:bg-base-300";

    return (
        <div onClick={() => navigate(`/media/${routeId(media.id)}`)} className="group relative my-2 w-40 shrink-0 cursor-pointer select-none sm:w-44">
            <div className="overflow-hidden rounded-lg bg-base-200 shadow-md transition-colors duration-150 group-hover:bg-base-300">
                {/* ── Poster ── */}
                <div className="relative aspect-5/7 w-full bg-base-300">
                    {media.poster && !imgError ? (
                        <img src={media.poster} alt={media.title} className="h-full w-full object-cover" onError={() => setImgError(true)} loading="lazy" draggable={false} />
                    ) : (
                        <FluxPosterFallback title={media.title} type={media.type} />
                    )}

                    {/* Top-right corner tab: custom badge (e.g. Upcoming) or rating */}
                    {showBadgeTab ? (
                        <div className={`absolute right-0 top-0 flex items-center gap-1.5 rounded-bl-lg px-2.5 pb-1.5 pt-1.5 text-xs font-medium text-base-content ${surface}`}>
                            {badgeDot && <span className="size-1.5 animate-pulse rounded-full bg-primary" />}
                            {badge}
                        </div>
                    ) : (
                        media.rating != null && (
                            <div className={`absolute right-0 top-0 flex items-center gap-1 rounded-bl-lg px-2.5 pb-1.5 pt-1.5 text-xs font-medium text-base-content ${surface}`}>
                                <Star size={12} className="fill-warning text-warning" />
                                {media.rating.toFixed(1)}
                            </div>
                        )
                    )}

                    {/* Top-left: resolution tag + saved tiles */}
                    {!isUpcoming && (resolution || favourited || watchlisted) && (
                        <div className="absolute left-2 top-2 flex flex-col items-start gap-1.5">
                            {resolution && <FluxTag type={media.type}>{resolution}</FluxTag>}
                            {(favourited || watchlisted) && (
                                <div className="flex gap-1">
                                    {favourited && (
                                        <span className={`flex size-6 items-center justify-center rounded-sm ${surface}`}>
                                            <Heart size={13} className="fill-primary text-primary" />
                                        </span>
                                    )}
                                    {watchlisted && (
                                        <span className={`flex size-6 items-center justify-center rounded-sm ${surface}`}>
                                            <Eye size={13} className="text-primary" />
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Bottom-left: runtime / seasons + episodes */}
                    {!isUpcoming && lengthLabel && (
                        <div className="absolute bottom-2 left-2">
                            <FluxTag type={media.type} className="py-[3px] tracking-wide">
                                {lengthLabel}
                            </FluxTag>
                        </div>
                    )}

                    {/* Release countdown — original clock design */}
                    {isUpcoming && (
                        <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
                            <Countdown t={countdown} />
                        </div>
                    )}

                    {/* Hover actions (lg+): tiled strip */}
                    {!isUpcoming && (
                        <div className="absolute inset-x-0 bottom-0 hidden translate-y-full grid-cols-3 gap-1.5 bg-base-300 p-1.5 opacity-0 transition-all duration-150 group-hover:translate-y-0 group-hover:opacity-100 lg:grid" onClick={(e) => e.stopPropagation()}>
                            <button type="button" onClick={() => toggleFavourite(media.id, payload)} aria-label="Favourite" className="flex h-8 cursor-pointer items-center justify-center rounded-md border-none bg-base-200 transition-colors hover:bg-base-100">
                                <Heart size={15} className={favourited ? "fill-primary text-primary" : "text-base-content"} />
                            </button>
                            <button type="button" onClick={() => toggleWatchlist(media.id, payload)} aria-label="Watchlist" className="flex h-8 cursor-pointer items-center justify-center rounded-md border-none bg-base-200 transition-colors hover:bg-base-100">
                                <Eye size={15} className={watchlisted ? "text-primary" : "text-base-content"} />
                            </button>
                            <button type="button" onClick={openMenu} aria-label="More options" className="flex h-8 cursor-pointer items-center justify-center rounded-md border-none bg-base-200 transition-colors hover:bg-base-100">
                                <MoreVertical size={15} className="text-base-content" />
                            </button>
                        </div>
                    )}

                    {/* Touch / small screens: single ⋮ (no hover available) */}
                    {!isUpcoming && (
                        <button type="button" onClick={openMenu} aria-label="More options" className={`absolute bottom-2 right-2 flex size-7 cursor-pointer items-center justify-center rounded-md border-none lg:hidden ${surface}`}>
                            <MoreVertical size={14} className="text-base-content" />
                        </button>
                    )}
                </div>

                {/* ── Footer: one line title, one line meta ── */}
                <div className="px-2.5 pb-2.5 pt-2.5">
                    <p className="truncate text-[13px] font-medium leading-tight text-base-content">{media.title}</p>
                    <p className="mt-1 truncate font-mono text-[11px] uppercase tracking-wide text-base-content/80">
                        {media.type === "series" ? "Series" : "Movie"}
                        {media.year != null && ` · ${media.year}`}
                    </p>
                </div>
            </div>

            {/* All option logic lives in FloatingActionMenu — same menu everywhere */}
            <div onClick={(e) => e.stopPropagation()}>
                <FloatingActionMenu open={menuOpen} anchorRef={anchorRef} onClose={() => setMenuOpen(false)} media={media} onWatchTrailer={onWatchTrailer} />
            </div>
        </div>
    );
}

// ─── Card styles ──────────────────────────────────────────────────────────────
// ADD A NEW DESIGN: write its component in this file, then add ONE entry below.
// It shows up by name in Settings → Appearance → Cards (dropdown + preview + Apply)
// automatically — the settings section is never edited.
// Give the same id a shell in HorizontalCard.jsx (SHELLS) to restyle Continue Watching / Trailer
// cards too; without one, that design uses the Classic horizontal card.
const POSTER_STYLES = {
    classic: { label: "Classic", desc: "The original FLUX cards. Default.", Card: ClassicMediaCard },
    flux: { label: "Flux", desc: "Flat cards with corner rating tab, type-coloured tags and a compact footer.", Card: FluxMediaCard },
};

export const DEFAULT_CARD_STYLE = "classic";

/** [{ id, label, desc }] — read by the Appearance section */
export const CARD_STYLES = Object.entries(POSTER_STYLES).map(([id, s]) => ({ id, label: s.label, desc: s.desc }));

// ─── MediaCard (entry point) ──────────────────────────────────────────────────
// The design comes from Settings → Appearance → Cards.
// `variant="<style id>"` forces a design (used by the settings preview).
export default function MediaCard({ variant, ...props }) {
    const global = useCardStyle();
    const { Card } = POSTER_STYLES[variant ?? global] ?? POSTER_STYLES[DEFAULT_CARD_STYLE];
    return <Card {...props} />;
}
