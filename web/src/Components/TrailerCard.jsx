import { useEffect, useState } from "react";
import { Film } from "lucide-react";
import HorizontalCard from "./HorizontalCard";

// Icon fallback — only if backdrop AND poster both fail
function IconFallback({ title }) {
    return (
        <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-linear-to-br from-base-300 to-base-200">
            <Film size={24} className="text-base-content/25" />
            <span className="text-base-content/40 text-xs font-semibold text-center px-3 leading-tight line-clamp-1">{title}</span>
        </div>
    );
}

// Same modal MediaDetails.jsx has (kept as its own local copy there too, per
// request — no shared file). Escape-to-close, click-outside-to-close.
function TrailerModal({ trailerKey, onClose }) {
    useEffect(() => {
        const onKey = (e) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [onClose]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
            <div className="w-full max-w-3xl aspect-video rounded-2xl overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <iframe src={`https://www.youtube.com/embed/${trailerKey}?autoplay=1`} title="Trailer" className="w-full h-full" allow="autoplay; fullscreen" allowFullScreen />
            </div>
        </div>
    );
}

/**
 * TrailerCard
 * -----------
 * Shape expected — matches /api/trailers/discover and /api/trailers/library
 * item objects directly (no adapting needed):
 *   { tmdbId, fileId?, type: "movie"|"series"|"anime", title,
 *     thumbnail, poster, backdrop, releaseDate?, company?: { name },
 *     trailer, videos: [{ type, key, name }] }
 *
 * onPlay(item, videoKey) — optional override; when omitted, clicking opens
 * the in-page trailer modal instead of leaving the site to YouTube.
 */
export default function TrailerCard({ item, onPlay }) {
    const [imgError, setImgError] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);

    if (!item) return null; // defensive — bad/missing data shouldn't crash the row

    const isSeries = item.type === "series" || item.type === "anime";
    const image = item.thumbnail || item.backdrop || item.poster; // backend already picks backdrop-first with poster fallback; kept as belt-and-suspenders for older cached items
    const videoKey = item.trailer || item.videos?.[0]?.key;

    const handleClick = () => {
        if (onPlay) return onPlay(item, videoKey);
        if (videoKey) setModalOpen(true);
    };

    const thumbnail =
        image && !imgError ? (
            <img src={image} alt={item.title} className="absolute inset-0 w-full h-full object-cover object-center block" loading="lazy" draggable={false} onError={() => setImgError(true)} />
        ) : (
            <IconFallback title={item.title} />
        );

    const badge = (
        <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md ${isSeries ? "bg-accent/90 text-accent-content" : "bg-primary/90 text-primary-content"}`}>
            {item.type === "anime" ? "Anime" : item.type === "series" ? "Series" : "Movie"}
        </span>
    );

    const footerText = [item.company?.name, item.releaseDate ? item.releaseDate.slice(0, 4) : null].filter(Boolean).join(" • ") || null;

    const title = (
        <p className="text-[13px] font-medium text-base-content truncate leading-tight" title={item.title}>
            {item.title}
        </p>
    );

    return (
        <>
            <HorizontalCard onClick={handleClick} thumbnail={thumbnail} badge={badge} footerText={footerText} title={title} ring={false} />
            {modalOpen && videoKey && <TrailerModal trailerKey={videoKey} onClose={() => setModalOpen(false)} />}
        </>
    );
}
