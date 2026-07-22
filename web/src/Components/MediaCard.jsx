import { useState, useRef } from "react";
import { MoreVertical, Tv, Star, Eye, Heart, Film } from "lucide-react";
import { useApi } from "../Context/apiContext";
import { useNavigate } from "react-router";
import FloatingActionMenu from "./FloatingActionMenu";

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
export default function MediaCard({ item, onPlay, onWatchTrailer, isLoading }) {
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
            </div>

            {/* ── ⋮ button — outside overflow:hidden so it never gets clipped ── */}
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

            {/* All option logic lives in FloatingActionMenu — same menu everywhere */}
            <div onClick={(e) => e.stopPropagation()}>
                <FloatingActionMenu open={menuOpen} anchorRef={btnRef} onClose={() => setMenuOpen(false)} media={media} onWatchTrailer={onWatchTrailer} />
            </div>

            {/* ── Info ── */}
            <div className="mt-2 px-0.5">
                <p className="text-[13px] font-medium text-base-content truncate leading-tight">{media.title}</p>

                <div className="flex items-center justify-between mt-1.5 gap-1">
                    <span className="text-[11px] text-base-content/45 font-medium shrink-0">{media.year ?? "—"}</span>

                    <div className="flex items-center gap-2.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => toggleFavourite(media.id, payload)} className="transition-colors duration-150" aria-label="Favourite">
                            <Heart size={13} fill={favourited ? "currentColor" : "none"} className={favourited ? "text-error fill-error" : "text-base-content/40 hover:text-error/70"} />
                        </button>

                        <button onClick={() => toggleWatchlist(media.id, payload)} className="transition-colors duration-150" aria-label="Watchlist">
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
