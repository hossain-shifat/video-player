import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
    Heart,
    Bookmark,
    BookmarkCheck,
    CheckCircle,
    Circle,
    Film,
    Share2,
    Cast,
    Copy,
    Check,
    Trash2,
    Info,
    X,
    Loader2,
    FileVideo,
    Clock,
    HardDrive,
    BarChart2,
    AudioLines,
    Subtitles,
    Hash,
    Layers,
    PlayCircle,
} from "lucide-react";
import { useApi } from "../Context/apiContext";
import { api } from "../api/client";
import { getMediaById } from "../api";
import { shareMedia, shareStream, copyToClipboard, getStreamUrl } from "../utils/shareMedia";

const MENU_W = 208; // w-52

// ─── Menu item ──────────────────────────────────────────────────────────────
function MenuItem({ icon: Icon, label, onClick, active, danger }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`w-full flex items-center gap-3 px-4 py-2.5 text-[13px] font-medium cursor-pointer border-none bg-transparent text-left
                        hover:bg-white/8 active:bg-white/12 transition-colors duration-100
                        ${danger ? "text-error/80 hover:text-error" : "text-white/92"}`}>
            <Icon
                size={14}
                strokeWidth={1.8}
                className={`shrink-0 ${danger ? "text-error/70" : active ? "text-primary" : "text-white/76"}`}
                fill={active && Icon.name === "Heart" ? "currentColor" : "none"}
            />
            {label}
        </button>
    );
}

function Divider() {
    return <div className="my-1 mx-3 border-t border-white/8" />;
}

// ─── Info modal bits (same design as MediaDetails used to have inline) ─────
function InfoStat({ label, value, icon: Icon, iconClass = "text-base-content/72" }) {
    if (value == null || value === "") return null;
    return (
        <div className="bg-base-300/60 rounded-lg p-3 flex flex-col gap-1 border border-white/5">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-base-content/72 font-semibold">
                {Icon && <Icon size={11} className={iconClass} />}
                {label}
            </div>
            <p className="text-sm font-semibold text-base-content leading-snug truncate">{value}</p>
        </div>
    );
}

const SUB_CODEC_NAMES = {
    hdmv_pgs_subtitle: "PGS",
    subrip: "SRT",
    ass: "ASS",
    ssa: "SSA",
    webvtt: "VTT",
    mov_text: "MP4 Text",
    dvd_subtitle: "VobSub",
    dvb_subtitle: "DVB",
};
function fmtSubCodec(codec) {
    if (!codec) return null;
    return SUB_CODEC_NAMES[codec.toLowerCase()] || codec.toUpperCase();
}
function fmtDate(iso) {
    if (!iso) return "";
    try {
        return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    } catch {
        return "";
    }
}

function InfoModal({ open, onClose, id, title }) {
    const [visible, setVisible] = useState(false);
    const [mounted, setMounted] = useState(false);
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState(null);
    const [fetchedFor, setFetchedFor] = useState(null);

    useEffect(() => {
        if (open) {
            setMounted(true);
            const raf = requestAnimationFrame(() => setVisible(true));
            if (id && fetchedFor !== id) {
                setLoading(true);
                api.get("/api/mediainfo")
                    .then((res) => setData(res?.mediaInfo?.[id] ?? null))
                    .catch(() => setData(null))
                    .finally(() => {
                        setLoading(false);
                        setFetchedFor(id);
                    });
            }
            return () => cancelAnimationFrame(raf);
        } else if (mounted) {
            setVisible(false);
            const t = setTimeout(() => setMounted(false), 180);
            return () => clearTimeout(t);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, id]);

    useEffect(() => {
        if (!mounted) return;
        const onKey = (e) => e.key === "Escape" && onClose();
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [mounted, onClose]);

    if (!mounted) return null;

    return createPortal(
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" style={{ opacity: visible ? 1 : 0, transition: "opacity 180ms ease" }} onClick={onClose}>
            <div
                className="w-full sm:w-[60vw] sm:min-w-[420px] sm:max-w-[820px] max-h-[85vh] flex flex-col bg-[oklch(15%_0.01_260)] rounded-2xl shadow-[0_24px_70px_-12px_rgba(0,0,0,0.65)] overflow-hidden"
                style={{
                    opacity: visible ? 1 : 0,
                    transform: visible ? "scale(1) translateY(0)" : "scale(0.96) translateY(8px)",
                    transition: "opacity 180ms ease, transform 180ms ease",
                }}
                onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="relative shrink-0 px-6 py-5 bg-linear-to-br from-primary/15 via-base-300/40 to-transparent border-b border-white/8">
                    <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
                                <FileVideo size={18} className="text-primary" />
                            </div>
                            <div className="min-w-0">
                                <h3 className="text-sm sm:text-base font-bold text-white truncate">{title || "Media Info"}</h3>
                                <p className="text-[11px] text-white/72 mt-0.5">Technical stream details</p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="w-8 h-8 rounded-full border-none bg-white/5 hover:bg-white/15 flex items-center justify-center cursor-pointer shrink-0 transition-colors"
                            aria-label="Close">
                            <X size={15} className="text-white/88" />
                        </button>
                    </div>
                </div>

                {/* Quick-glance summary strip */}
                {!loading && data && (
                    <div className="shrink-0 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-6 py-2.5 bg-black/20 border-b border-white/8 text-[11px] text-white/70">
                        {data.video?.resolution && (
                            <span className="flex items-center gap-1.5">
                                <Film size={12} className="text-primary" /> {data.video.codec} · {data.video.resolution}
                            </span>
                        )}
                        {data.container?.duration && (
                            <span className="flex items-center gap-1.5">
                                <Clock size={12} className="text-orange-400" /> {data.container.duration}
                            </span>
                        )}
                        {data.container?.size && (
                            <span className="flex items-center gap-1.5">
                                <HardDrive size={12} className="text-violet-400" /> {data.container.size}
                            </span>
                        )}
                        {data.audioTracks?.length > 0 && (
                            <span className="flex items-center gap-1.5">
                                <AudioLines size={12} className="text-emerald-400" /> {data.audioTracks.length} audio
                            </span>
                        )}
                        {data.subtitleTracks?.length > 0 && (
                            <span className="flex items-center gap-1.5">
                                <Subtitles size={12} className="text-secondary" /> {data.subtitleTracks.length} subtitle
                            </span>
                        )}
                    </div>
                )}

                {/* Body */}
                <div className="hs flex-1 overflow-y-auto px-6 py-5 space-y-6">
                    {loading && (
                        <div className="flex flex-col items-center justify-center gap-3 py-20 text-white/72">
                            <Loader2 size={24} className="animate-spin text-primary" />
                            <span className="text-xs">Reading stream info…</span>
                        </div>
                    )}

                    {!loading && !data && (
                        <div className="flex flex-col items-center justify-center gap-3 py-20 text-white/72">
                            <Info size={24} />
                            <span className="text-xs">No probe data available for this file yet.</span>
                        </div>
                    )}

                    {!loading && data && (
                        <>
                            {data.container && (
                                <section>
                                    <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-white/80 mb-2.5">
                                        <HardDrive size={12} className="text-blue-400" /> Container
                                    </h4>
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                                        <InfoStat label="Format" value={data.container.format} icon={FileVideo} iconClass="text-blue-400" />
                                        <InfoStat label="Duration" value={data.container.duration} icon={Clock} iconClass="text-orange-400" />
                                        <InfoStat label="Size" value={data.container.size} icon={HardDrive} iconClass="text-violet-400" />
                                        <InfoStat label="Bitrate" value={data.container.bitrate} icon={BarChart2} iconClass="text-emerald-400" />
                                    </div>
                                </section>
                            )}

                            {data.video && (
                                <section>
                                    <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-white/80 mb-2.5">
                                        <Film size={12} className="text-primary" /> Video
                                    </h4>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                                        <InfoStat label="Codec" value={data.video.profile ? `${data.video.codec} (${data.video.profile})` : data.video.codec} icon={Film} iconClass="text-primary" />
                                        <InfoStat label="Resolution" value={data.video.resolution} icon={Hash} iconClass="text-pink-400" />
                                        <InfoStat label="Aspect Ratio" value={data.video.aspectRatio} icon={Layers} iconClass="text-secondary" />
                                        <InfoStat label="Frame Rate" value={data.video.frameRate} icon={PlayCircle} iconClass="text-accent" />
                                        <InfoStat label="Bit Depth" value={data.video.bitDepth ? `${data.video.bitDepth}-bit` : null} icon={BarChart2} iconClass="text-emerald-400" />
                                        <InfoStat label="Bitrate" value={data.video.bitrate} icon={BarChart2} iconClass="text-emerald-400" />
                                    </div>
                                </section>
                            )}

                            {data.audioTracks?.length > 0 && (
                                <section>
                                    <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-white/80 mb-2.5">
                                        <AudioLines size={12} className="text-emerald-400" /> Audio {data.audioTracks.length > 1 && `(${data.audioTracks.length})`}
                                    </h4>
                                    <div className="space-y-2">
                                        {data.audioTracks.map((t, i) => (
                                            <div key={i} className="bg-base-300/60 rounded-lg p-3 border border-white/5">
                                                <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
                                                    <span className="text-sm font-semibold text-white flex items-center gap-1.5">
                                                        Track {i + 1} · {t.languageName || t.language}
                                                        {t.default && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-primary/20 text-primary">Default</span>}
                                                    </span>
                                                    <span className="text-xs text-white/76 font-mono">{t.codec}</span>
                                                    {t.channelLayout && (
                                                        <span className="text-xs text-white/76">
                                                            {t.channelLayout}
                                                            {t.channels ? ` (${t.channels}ch)` : ""}
                                                        </span>
                                                    )}
                                                    {t.sampleRate && <span className="text-xs text-white/76">{t.sampleRate}</span>}
                                                    {t.bitrate && <span className="text-xs text-white/76">{t.bitrate}</span>}
                                                </div>
                                                {t.title && t.title !== t.languageName && <p className="text-[11px] text-white/45 mt-1.5 truncate">{t.title}</p>}
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            )}

                            {data.subtitleTracks?.length > 0 && (
                                <section>
                                    <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-white/80 mb-2.5">
                                        <Subtitles size={12} className="text-secondary" /> Subtitles {data.subtitleTracks.length > 1 && `(${data.subtitleTracks.length})`}
                                    </h4>
                                    <div className="flex flex-wrap gap-1.5">
                                        {data.subtitleTracks.map((t, i) => (
                                            <span key={i} className="text-xs font-medium px-3 py-1.5 rounded-full bg-base-300/60 border border-white/5 text-white/88 flex items-center gap-1.5">
                                                {t.languageName || t.language}
                                                {fmtSubCodec(t.codec) && <span className="text-white/45 font-normal">· {fmtSubCodec(t.codec)}</span>}
                                                {t.forced && <span className="text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-warning/20 text-warning">Forced</span>}
                                            </span>
                                        ))}
                                    </div>
                                </section>
                            )}
                        </>
                    )}
                </div>

                {/* Footer */}
                {!loading && data && (
                    <div className="shrink-0 flex items-center justify-between gap-3 px-6 py-3.5 border-t border-white/8 bg-black/20">
                        <span className="text-[11px] text-white/55">{data.probedAt ? `Probed ${fmtDate(data.probedAt)}` : "Stream analysis"}</span>
                        <button onClick={onClose} className="btn btn-sm rounded-full border-none bg-white/10 hover:bg-white/18 text-white/88 px-5">
                            Close
                        </button>
                    </div>
                )}
            </div>
        </div>,
        document.body,
    );
}

// ─── Trailer modal — self-fetches the trailer key for this id, then embeds ──
function TrailerModal({ open, onClose, id, title }) {
    const [visible, setVisible] = useState(false);
    const [mounted, setMounted] = useState(false);
    const [loading, setLoading] = useState(false);
    const [trailerKey, setTrailerKey] = useState(null);
    const [fetchedFor, setFetchedFor] = useState(null);

    useEffect(() => {
        if (open) {
            setMounted(true);
            const raf = requestAnimationFrame(() => setVisible(true));
            if (id && fetchedFor !== id) {
                setLoading(true);
                getMediaById(id)
                    .then((res) => setTrailerKey(res?.trailer ?? res?.metadata?.trailer ?? null))
                    .catch(() => setTrailerKey(null))
                    .finally(() => {
                        setLoading(false);
                        setFetchedFor(id);
                    });
            }
            return () => cancelAnimationFrame(raf);
        } else if (mounted) {
            setVisible(false);
            const t = setTimeout(() => setMounted(false), 180);
            return () => clearTimeout(t);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, id]);

    useEffect(() => {
        if (!mounted) return;
        const onKey = (e) => e.key === "Escape" && onClose();
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [mounted, onClose]);

    if (!mounted) return null;

    return createPortal(
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" style={{ opacity: visible ? 1 : 0, transition: "opacity 180ms ease" }} onClick={onClose}>
            {loading && (
                <div className="flex flex-col items-center gap-3 text-white/72">
                    <Loader2 size={24} className="animate-spin text-primary" />
                    <span className="text-xs">Loading trailer…</span>
                </div>
            )}
            {!loading && !trailerKey && (
                <div className="flex flex-col items-center gap-3 text-white/72" onClick={(e) => e.stopPropagation()}>
                    <Film size={24} />
                    <span className="text-xs">No trailer available for {title || "this title"}.</span>
                </div>
            )}
            {!loading && trailerKey && (
                <div
                    className="w-full max-w-3xl aspect-video rounded-2xl overflow-hidden shadow-2xl"
                    style={{ transform: visible ? "scale(1)" : "scale(0.96)", transition: "transform 180ms ease" }}
                    onClick={(e) => e.stopPropagation()}>
                    <iframe src={`https://www.youtube.com/embed/${trailerKey}?autoplay=1`} title="Trailer" className="w-full h-full" allow="autoplay; fullscreen" allowFullScreen />
                </div>
            )}
        </div>,
        document.body,
    );
}

/**
 * FloatingActionMenu — THE ONLY floating 3-dot menu in FLUX (MediaCard,
 * HistoryCard, MediaDetails all render this same component). Fully
 * self-contained — menu AND the info modal both live in this one file.
 *
 * ── TO ADD/REMOVE/CHANGE AN OPTION: edit the `items` array below. That's it.
 *    Nothing in MediaCard.jsx / HistoryCard.jsx / MediaDetails.jsx needs to
 *    change — they all just pass `media` and get whatever is defined here.
 *
 * Required props: open, anchorRef, onClose, media: { id, title, poster, type }
 *
 * Optional props:
 *  - watched / onToggleWatched   → controlled watched state (else local toggle)
 *  - onWatchTrailer(media)       → override trailer action (else opens the
 *                                   built-in TrailerModal, self-fetching the
 *                                   trailer key for media.id — pass this on
 *                                   MediaDetails to reuse its own live trailer
 *                                   player instead of opening a second modal)
 *  - infoId                      → id used for the Info modal's mediainfo lookup,
 *                                   only needed when it differs from media.id
 *                                   (e.g. MediaDetails on a series page — the
 *                                   probe data is per-episode-file, not per-series)
 *  - onRemove(media)             → ONLY page-specific item: shows "Remove From
 *                                   History" — omit and it just won't render
 *  - onCopyFallback()            → fired when Share/Share Stream fell back to
 *                                   clipboard copy (no navigator.share) so the
 *                                   page can show its own toast
 */
export default function FloatingActionMenu({ open, anchorRef, onClose, media, watched, onToggleWatched, onWatchTrailer, infoId, onRemove, onCopyFallback }) {
    const { isFavourite, toggleFavourite, isInWatchlist, toggleWatchlist } = useApi();

    const [visible, setVisible] = useState(false);
    const [mounted, setMounted] = useState(false);
    const [pos, setPos] = useState({ top: 0, left: 0 });
    const [copied, setCopied] = useState(false);
    const [localWatched, setLocalWatched] = useState(false);
    const [showInfoModal, setShowInfoModal] = useState(false);
    const [showTrailerModal, setShowTrailerModal] = useState(false);
    const menuRef = useRef(null);

    const favourited = isFavourite(media.id);
    const watchlisted = isInWatchlist(media.id);
    const isWatched = watched ?? localWatched;
    const payload = { name: media.title, poster: media.poster, type: media.type };
    const detailsUrl = `${window.location.origin}/media/${encodeURIComponent(media.id)}`;

    function close() {
        setVisible(false);
        setTimeout(() => setMounted(false), 150);
    }

    function handleShare(fn, arg) {
        fn(arg)
            .then((r) => r === "copied" && onCopyFallback?.())
            .catch(() => {});
    }

    // ── EDIT THE OPTION LIST HERE — this is the single source of truth ─────
    const items = [
        { icon: Heart, label: favourited ? "Remove from Favorites" : "Add to Favorites", active: favourited, onClick: () => toggleFavourite(media.id, payload) },
        { icon: watchlisted ? BookmarkCheck : Bookmark, label: watchlisted ? "Remove from Watchlist" : "Add to Watchlist", active: watchlisted, onClick: () => toggleWatchlist(media.id, payload) },
        {
            icon: isWatched ? CheckCircle : Circle,
            label: isWatched ? "Mark as Unwatched" : "Mark as Watched",
            active: isWatched,
            onClick: () => (onToggleWatched ? onToggleWatched() : setLocalWatched((v) => !v)),
        },
        { divider: true },
        {
            icon: Film,
            label: "Watch Trailer",
            onClick: () => (onWatchTrailer ? onWatchTrailer(media) : setShowTrailerModal(true)),
        },
        {
            // Same link Share Stream shares — both call getStreamUrl(), which
            // hits GET /stream/video/:id?info=1 (the real backend decision),
            // not a guessed/placeholder URL.
            icon: copied ? Check : Copy,
            label: copied ? "Copied!" : "Copy Stream Link",
            active: copied,
            onClick: () =>
                getStreamUrl(media.id)
                    .then((url) => copyToClipboard(url))
                    .then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                    })
                    .catch(() => {}),
        },
        // url-only payload (no title/text before the link) + poster attached as a
        // share file when the browser/target supports it — see utils/shareMedia.js
        { icon: Share2, label: "Share", onClick: () => handleShare(shareMedia, { url: detailsUrl, poster: media.poster }) },
        { icon: Cast, label: "Share Stream", onClick: () => handleShare(shareStream, { id: media.id, poster: media.poster }) },
        { icon: Info, label: "Info", onClick: () => setShowInfoModal(true) },
        // ↓ page-specific — only appears where a page hands us onRemove
        onRemove && { divider: true },
        onRemove && { icon: Trash2, label: "Remove From History", danger: true, onClick: () => onRemove(media) },
    ].filter(Boolean);

    useEffect(() => {
        if (open) {
            if (anchorRef.current) {
                const r = anchorRef.current.getBoundingClientRect();
                let left = r.right - MENU_W;
                const top = r.bottom + 6; // always below the anchor — never flips above
                if (left < 8) left = 8;
                if (left + MENU_W > window.innerWidth - 8) left = window.innerWidth - MENU_W - 8;
                setPos({ top, left });
            }
            setMounted(true);
            const raf = requestAnimationFrame(() => setVisible(true));
            return () => cancelAnimationFrame(raf);
        } else if (mounted) {
            close();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    useEffect(() => {
        if (!mounted) return;
        const handleClick = (e) => {
            if (menuRef.current?.contains(e.target) || anchorRef.current?.contains(e.target)) return;
            onClose();
        };
        const handleKey = (e) => e.key === "Escape" && onClose();
        const handleScroll = () => onClose();
        document.addEventListener("mousedown", handleClick);
        document.addEventListener("keydown", handleKey);
        window.addEventListener("scroll", handleScroll, { capture: true, passive: true });
        window.addEventListener("resize", handleScroll, { passive: true });
        return () => {
            document.removeEventListener("mousedown", handleClick);
            document.removeEventListener("keydown", handleKey);
            window.removeEventListener("scroll", handleScroll, { capture: true });
            window.removeEventListener("resize", handleScroll);
        };
    }, [mounted, onClose, anchorRef]);

    return (
        <>
            {mounted &&
                createPortal(
                    <div
                        ref={menuRef}
                        role="menu"
                        style={{
                            position: "fixed",
                            top: pos.top,
                            left: pos.left,
                            width: MENU_W,
                            opacity: visible ? 1 : 0,
                            transform: visible ? "scale(1)" : "scale(0.95)",
                            transformOrigin: "top right",
                            transition: "opacity 150ms ease, transform 150ms ease",
                            zIndex: 100,
                        }}
                        className="rounded-xl bg-[oklch(15%_0.01_260/0.97)] backdrop-blur-md shadow-2xl border border-white/10 py-1.5 overflow-hidden"
                        onClick={(e) => e.stopPropagation()}>
                        {items.map((it, i) =>
                            it.divider ? (
                                <Divider key={i} />
                            ) : (
                                <MenuItem
                                    key={i}
                                    icon={it.icon}
                                    label={it.label}
                                    active={it.active}
                                    danger={it.danger}
                                    onClick={() => {
                                        it.onClick();
                                        onClose();
                                    }}
                                />
                            ),
                        )}
                    </div>,
                    document.body,
                )}
            <InfoModal open={showInfoModal} onClose={() => setShowInfoModal(false)} id={infoId ?? media.id} title={media.title} />
            {!onWatchTrailer && <TrailerModal open={showTrailerModal} onClose={() => setShowTrailerModal(false)} id={media.id} title={media.title} />}
        </>
    );
}
