import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router";
import { Play, Eye, Heart, Star, Film, Tv, Clock, Calendar, Globe, Award, Users, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Layers, Info, Hash, Clapperboard, Volume2 } from "lucide-react";
import { useApi } from "../../../Context/apiContext";
import { getMediaById } from "../../../api";
import MediaDetailsSkeleton from "../../../Components/MediaDetailsSkeleton";
import MediaRow from "../../../Components/MediaRow";
import SimilarMedia from "../../../Components/SimilarMedia";

// ─── Language lookup ──────────────────────────────────────────────────────────
const LANG_NAMES = {
    af: "Afrikaans",
    ar: "Arabic",
    as: "Assamese",
    az: "Azerbaijani",
    be: "Belarusian",
    bg: "Bulgarian",
    bn: "Bengali",
    bo: "Tibetan",
    cs: "Czech",
    cy: "Welsh",
    da: "Danish",
    de: "German",
    el: "Greek",
    en: "English",
    es: "Spanish",
    et: "Estonian",
    eu: "Basque",
    fa: "Persian",
    fi: "Finnish",
    fr: "French",
    gl: "Galician",
    gu: "Gujarati",
    he: "Hebrew",
    hi: "Hindi",
    hr: "Croatian",
    hu: "Hungarian",
    hy: "Armenian",
    id: "Indonesian",
    is: "Icelandic",
    it: "Italian",
    ja: "Japanese",
    ka: "Georgian",
    kn: "Kannada",
    ko: "Korean",
    lt: "Lithuanian",
    lv: "Latvian",
    mk: "Macedonian",
    ml: "Malayalam",
    mn: "Mongolian",
    mr: "Marathi",
    ms: "Malay",
    mt: "Maltese",
    my: "Burmese",
    ne: "Nepali",
    nl: "Dutch",
    no: "Norwegian",
    or: "Odia",
    pa: "Punjabi",
    pl: "Polish",
    ps: "Pashto",
    pt: "Portuguese",
    ro: "Romanian",
    ru: "Russian",
    sa: "Sanskrit",
    sd: "Sindhi",
    si: "Sinhalese",
    sk: "Slovak",
    sl: "Slovenian",
    so: "Somali",
    sq: "Albanian",
    sr: "Serbian",
    sv: "Swedish",
    sw: "Swahili",
    ta: "Tamil",
    te: "Telugu",
    tg: "Tajik",
    th: "Thai",
    tk: "Turkmen",
    tl: "Filipino",
    tr: "Turkish",
    uk: "Ukrainian",
    ur: "Urdu",
    uz: "Uzbek",
    vi: "Vietnamese",
    xh: "Xhosa",
    yi: "Yiddish",
    zh: "Chinese",
    zu: "Zulu",
    "zh-cn": "Chinese (Simplified)",
    "zh-tw": "Chinese (Traditional)",
    "pt-br": "Portuguese (Brazil)",
};

function langName(code) {
    if (!code) return null;
    return LANG_NAMES[code.toLowerCase()] ?? LANG_NAMES[code.split("-")[0]?.toLowerCase()] ?? code;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtRuntime(mins) {
    if (!mins) return null;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtVotes(n) {
    if (!n) return null;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toLocaleString();
}

// Format ISO date "2023-07-21" → "July 21, 2023"
function fmtDate(iso) {
    if (!iso) return null;
    try {
        return new Date(iso).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
        });
    } catch {
        return iso;
    }
}

// ─── Shared primitives ────────────────────────────────────────────────────────
function Badge({ children, className = "" }) {
    return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${className}`}>{children}</span>;
}

function SectionHeading({ icon: Icon, children }) {
    return (
        <h2 className="text-base sm:text-lg font-semibold text-base-content mb-3 flex items-center gap-2">
            {Icon && <Icon size={18} className="text-primary" />}
            {children}
        </h2>
    );
}

function Divider() {
    return <div className="border-t border-white/5" />;
}

// ─── Rating bar ───────────────────────────────────────────────────────────────
function RatingBar({ rating }) {
    const pct = Math.round((rating / 10) * 100);
    return (
        <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-base-300 rounded-full overflow-hidden">
                <div className="h-full bg-warning rounded-full" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs text-base-content/50 w-6 text-right">{pct}%</span>
        </div>
    );
}

// ─── Cast card ────────────────────────────────────────────────────────────────
function CastCard({ member }) {
    const [imgErr, setImgErr] = useState(false);
    return (
        <div className="shrink-0 w-20 sm:w-24 text-center">
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full overflow-hidden bg-base-300 mx-auto ring-2 ring-white/10">
                {member.photo && !imgErr ? (
                    <img src={member.photo} alt={member.name} className="w-full h-full object-cover" onError={() => setImgErr(true)} loading="lazy" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center bg-base-200">
                        <Users size={24} className="text-base-content/30" />
                    </div>
                )}
            </div>
            <p className="text-[11px] font-medium text-base-content mt-1.5 leading-tight line-clamp-2">{member.name}</p>
            <p className="text-[10px] text-base-content/45 leading-tight line-clamp-2">{member.character}</p>
        </div>
    );
}

// ─── Cast carousel ────────────────────────────────────────────────────────────
function CastCarousel({ cast }) {
    const scrollRef = useRef(null);
    const [canLeft, setCanLeft] = useState(false);
    const [canRight, setCanRight] = useState(false);

    const checkScroll = useCallback(() => {
        const el = scrollRef.current;
        if (!el) return;
        setCanLeft(el.scrollLeft > 0);
        setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    }, []);

    useEffect(() => {
        const t = setTimeout(checkScroll, 50);
        const el = scrollRef.current;
        el?.addEventListener("scroll", checkScroll, { passive: true });
        window.addEventListener("resize", checkScroll);
        return () => {
            clearTimeout(t);
            el?.removeEventListener("scroll", checkScroll);
            window.removeEventListener("resize", checkScroll);
        };
    }, [cast, checkScroll]);

    const scroll = (dir) => scrollRef.current?.scrollBy({ left: dir * 300, behavior: "smooth" });

    return (
        <div className="relative">
            {canLeft && (
                <button
                    onClick={() => scroll(-1)}
                    className="absolute -left-4 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-base-300/90 hover:bg-base-200 border border-white/10 flex items-center justify-center shadow-lg transition-colors"
                    aria-label="Scroll left">
                    <ChevronLeft size={16} className="text-base-content/70" />
                </button>
            )}
            <div ref={scrollRef} className="flex gap-4 overflow-x-auto pb-2" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                {cast.map((member, i) => (
                    <CastCard key={i} member={member} />
                ))}
            </div>
            {canRight && (
                <button
                    onClick={() => scroll(1)}
                    className="absolute -right-4 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-base-300/90 hover:bg-base-200 border border-white/10 flex items-center justify-center shadow-lg transition-colors"
                    aria-label="Scroll right">
                    <ChevronRight size={16} className="text-base-content/70" />
                </button>
            )}
        </div>
    );
}

// ─── Episode row ──────────────────────────────────────────────────────────────
function EpisodeRow({ ep, onPlay }) {
    return (
        <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-base-300 cursor-pointer group transition-colors" onClick={() => ep.id && onPlay(ep.id)}>
            {ep.still ? (
                <img src={ep.still} alt={ep.title} className="w-20 h-12 object-cover rounded shrink-0" loading="lazy" />
            ) : (
                <div className="w-20 h-12 bg-base-300 rounded shrink-0 flex items-center justify-center">
                    <Play size={16} className="text-base-content/30 group-hover:text-primary transition-colors" />
                </div>
            )}
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-base-content line-clamp-1">
                    {ep.episode != null && <span className="text-primary mr-1.5">E{String(ep.episode).padStart(2, "0")}</span>}
                    {ep.title || ep.name}
                </p>
                {ep.overview && <p className="text-xs text-base-content/45 line-clamp-2 mt-0.5">{ep.overview}</p>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
                {ep.rating && (
                    <span className="hidden sm:flex items-center gap-0.5 text-xs text-base-content/40">
                        <Star size={10} className="fill-warning text-warning" />
                        {ep.rating}
                    </span>
                )}
                {ep.runtime && <span className="text-xs text-base-content/40">{fmtRuntime(ep.runtime)}</span>}
                <Play size={14} className="text-base-content/20 group-hover:text-primary transition-colors" />
            </div>
        </div>
    );
}

// ─── Season accordion ─────────────────────────────────────────────────────────
function SeasonsPanel({ seasons, onPlayEpisode }) {
    const seasonEntries = Object.entries(seasons).sort(([a], [b]) => Number(a) - Number(b));
    const [openSeason, setOpenSeason] = useState(seasonEntries[0]?.[0] ?? null);
    const [showAllEps, setShowAllEps] = useState({});

    return (
        <div className="space-y-3">
            {seasonEntries.map(([num, season]) => {
                const isOpen = openSeason === num;
                const eps = season.episodes || [];
                const showAll = showAllEps[num];
                const visibleEps = showAll ? eps : eps.slice(0, 5);

                return (
                    <div key={num} className="bg-base-200 rounded-xl overflow-hidden border border-white/5">
                        <button className="w-full flex items-center gap-3 p-4 hover:bg-base-300/50 transition-colors text-left" onClick={() => setOpenSeason(isOpen ? null : num)}>
                            {season.poster && <img src={season.poster} alt={season.name} className="w-10 h-14 object-cover rounded shrink-0" loading="lazy" />}
                            <div className="flex-1 min-w-0">
                                <h3 className="font-semibold text-base-content">{season.name || `Season ${num}`}</h3>
                                <p className="text-xs text-base-content/50 mt-0.5">
                                    {season.episodeCount} episode{season.episodeCount !== 1 ? "s" : ""}
                                </p>
                                {season.overview && !isOpen && <p className="text-xs text-base-content/40 line-clamp-1 mt-0.5">{season.overview}</p>}
                            </div>
                            {isOpen ? <ChevronUp size={16} className="text-base-content/40 shrink-0" /> : <ChevronDown size={16} className="text-base-content/40 shrink-0" />}
                        </button>

                        {isOpen && (
                            <div className="px-2 pb-3 space-y-1 border-t border-white/5">
                                {season.overview && <p className="text-xs text-base-content/45 px-2 py-2">{season.overview}</p>}
                                {visibleEps.map((ep) => (
                                    <EpisodeRow key={ep.id || ep.episode} ep={ep} onPlay={onPlayEpisode} />
                                ))}
                                {eps.length > 5 && (
                                    <button
                                        className="w-full text-xs text-primary py-2 hover:underline flex items-center justify-center gap-1"
                                        onClick={() => setShowAllEps((p) => ({ ...p, [num]: !p[num] }))}>
                                        {showAll ? (
                                            <>
                                                <ChevronUp size={12} /> Show less
                                            </>
                                        ) : (
                                            <>
                                                <ChevronDown size={12} /> Show all {eps.length} episodes
                                            </>
                                        )}
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// ─── Trailer modal ────────────────────────────────────────────────────────────
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
            <div className="w-full max-w-3xl aspect-video rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/10" onClick={(e) => e.stopPropagation()}>
                <iframe src={`https://www.youtube.com/embed/${trailerKey}?autoplay=1`} title="Trailer" className="w-full h-full" allow="autoplay; fullscreen" allowFullScreen />
            </div>
        </div>
    );
}

// ─── Detail cell ──────────────────────────────────────────────────────────────
function DetailCell({ label, value, icon: Icon, iconClass = "text-base-content/40", note }) {
    if (value == null || value === "") return null;
    return (
        <div className="bg-base-200 rounded-xl p-3 flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-xs text-base-content/45">
                {Icon && <Icon size={11} className={iconClass} />}
                {label}
            </div>
            <p className="text-sm font-semibold text-base-content leading-snug">{value}</p>
            {note && <span className="text-[10px] font-bold text-primary/80 leading-none mt-0.5">{note}</span>}
        </div>
    );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function MediaDetails() {
    const { id } = useParams();
    const navigate = useNavigate();

    const { isInWatchlist, toggleWatchlist, isFavourite, toggleFavourite, getResume, movies, series, anime } = useApi();

    const [item, setItem] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [overviewExpanded, setOverviewExpanded] = useState(false);
    const [imgError, setImgError] = useState(false);
    const [resumePos, setResumePos] = useState(null);
    const [showTrailer, setShowTrailer] = useState(false);

    const decodedId = decodeURIComponent(id);

    // ── Scroll to top on every navigation to this page ─────────────────────────
    useEffect(() => {
        window.scrollTo({ top: 0, behavior: "instant" });
    }, [decodedId]);

    // ── Resolve item — context-first, network fallback ────────────────────────
    // When navigating from the home/browse page the context arrays are already
    // populated, so we find the item instantly with zero network round-trip.
    // Only falls back to a fetch when landing via a deep-link before context loads.
    useEffect(() => {
        setImgError(false);
        setOverviewExpanded(false);

        // 1. Instant lookup from already-loaded context
        const contextItem = [...movies, ...series, ...anime].find((m) => m.id === decodedId);
        if (contextItem) {
            setItem(contextItem);
            setLoading(false);
            setError(null);
            return;
        }

        // 2. Network fallback (deep-link / context not yet loaded)
        let cancelled = false;
        setLoading(true);
        setError(null);
        setItem(null);

        getMediaById(decodedId)
            .then((data) => {
                if (!cancelled) {
                    setItem(data?.file ?? data);
                    setLoading(false);
                }
            })
            .catch((err) => {
                if (!cancelled) {
                    setError(err.message);
                    setLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [decodedId, movies.length, series.length, anime.length]);

    // ── Resume point (movies only) ─────────────────────────────────────────────
    useEffect(() => {
        if (!item || item.seasons) return;
        let cancelled = false;
        getResume(decodedId)
            .then((r) => {
                if (!cancelled) setResumePos(r?.position ?? null);
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [item, decodedId]);

    // ── Derived values ─────────────────────────────────────────────────────────
    const isSeries = Boolean(item?.seasons);
    const isAnime = item?.type === "anime";
    const mediaType = isAnime ? "anime" : isSeries ? "series" : "movie";

    const m = item?.metadata;
    const title = m?.title || item?.title || item?.name || "Unknown";
    const originalTitle = m?.originalTitle !== title ? m?.originalTitle : null;
    const overview = m?.overview;
    const poster = m?.poster;
    const backdrop = m?.backdrop;
    const year = m?.year;
    const rating = m?.rating;

    // ── Release date — exact ISO date from new API fields ─────────────────────
    // Movies expose `releaseDate`, TV/anime expose `firstAirDate`.
    const releaseIso = m?.releaseDate || m?.firstAirDate || null;
    const releaseDateFmt = fmtDate(releaseIso);
    const releaseDateLabel = m?.firstAirDate ? "First Aired" : "Released";
    const runtime = fmtRuntime(m?.runtime);
    const genres = m?.genres || item?.category || [];
    const cast = m?.cast || [];
    const trailerKey = m?.trailer;
    const tagline = m?.tagline;
    const seasons = isSeries ? item?.seasons : null;
    const partNum = !isSeries ? (item?.parsed?.part ?? null) : null;

    const watchlisted = isInWatchlist(decodedId);
    const favourited = isFavourite(decodedId);
    const overviewLong = overview && overview.length > 220;

    // ── Language / audio ───────────────────────────────────────────────────────
    // Parsed languages from filename e.g. ["hi","en"] take priority over TMDB lang code
    const parsedLangs = item?.parsed?.languages;
    const isDualAudio = item?.parsed?.dualAudio || item?.parsed?.multiAudio || (parsedLangs && parsedLangs.length > 1);
    const isMultiAudio = item?.parsed?.multiAudio || (parsedLangs && parsedLangs.length > 2);
    const audioLabel = isDualAudio ? (isMultiAudio ? "Multi Audio" : "Dual Audio") : null;

    // Full language name(s) for display — slash-separated for dual/multi audio
    const primaryLangDisplay = parsedLangs?.length > 0 ? parsedLangs.map(langName).join(" / ") : langName(m?.language);

    // Hero meta row: show primary language (from TMDB), full name
    const heroLang = langName(m?.language);

    // ── Related parts — other chapters of same multi-part movie ───────────────
    const relatedParts = useMemo(() => {
        if (!item || isSeries || partNum == null) return [];
        const baseTitle = item.parsed?.title?.toLowerCase();
        if (!baseTitle) return [];
        return movies.filter((mv) => mv.id !== item.id && mv.parsed?.title?.toLowerCase() === baseTitle && mv.parsed?.part != null);
    }, [item, isSeries, partNum, movies]);

    // ── Handlers ───────────────────────────────────────────────────────────────
    const handlePlayMovie = () => {
        if (item?.streamUrl) navigate(`/player/${encodeURIComponent(item.id)}`);
    };

    const handlePlayEpisode = (epId) => {
        navigate(`/player/${encodeURIComponent(epId)}`);
    };

    // ── Loading ────────────────────────────────────────────────────────────────
    if (loading) return <MediaDetailsSkeleton />;

    // ── Error ──────────────────────────────────────────────────────────────────
    if (error || !item) {
        return (
            <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
                {isSeries ? <Tv size={48} className="text-base-content/20" /> : <Film size={48} className="text-base-content/20" />}
                <p className="text-base-content/50">Media not found</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen -m-4 sm:-m-6 lg:-m-8">
            {/* ── Backdrop + Hero ──────────────────────────────────────────── */}
            <div className="relative">
                {/* Backdrop */}
                <div className="absolute inset-x-0 top-0 h-80 sm:h-105 pointer-events-none" style={{ zIndex: 0 }}>
                    {backdrop && !imgError ? (
                        <img src={backdrop} alt={title} className="w-full h-full object-cover object-top" onError={() => setImgError(true)} />
                    ) : (
                        <div className="w-full h-full bg-linear-to-br from-primary/20 via-base-300 to-base-200" />
                    )}
                    <div className="absolute inset-0 bg-linear-to-t from-base-100 via-base-100/70 to-transparent" />
                    <div className="absolute inset-0 bg-linear-to-r from-base-100/90 via-base-100/30 to-transparent hidden sm:block" />
                </div>

                {/* Hero content */}
                <div className="relative px-4 sm:px-8 lg:px-12 pt-8 sm:pt-10 pb-8" style={{ zIndex: 1 }}>
                    <div className="flex flex-col sm:flex-row gap-6 sm:gap-8 max-w-5xl">
                        {/* ── Poster ──────────────────────────────────────── */}
                        <div className="shrink-0 mx-auto sm:mx-0 w-36 sm:w-44 md:w-52">
                            <div className="aspect-2/3 rounded-2xl overflow-hidden shadow-2xl ring-2 ring-white/10 bg-base-300">
                                {poster ? (
                                    <img src={poster} alt={title} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                        {isSeries ? <Tv size={40} className="text-base-content/20" /> : <Film size={40} className="text-base-content/20" />}
                                    </div>
                                )}
                            </div>

                            {/* Rating below poster */}
                            {rating != null && (
                                <div className="mt-3 px-1">
                                    <div className="flex items-center justify-between mb-1">
                                        <div className="flex items-center gap-1">
                                            <Star size={13} className="text-warning fill-warning" />
                                            <span className="text-sm font-bold text-base-content">{rating.toFixed(1)}</span>
                                            <span className="text-xs text-base-content/40">/ 10</span>
                                        </div>
                                        {m?.votes && <span className="text-[10px] text-base-content/35">{fmtVotes(m.votes)} votes</span>}
                                    </div>
                                    <RatingBar rating={rating} />
                                </div>
                            )}
                        </div>

                        {/* ── Info panel ──────────────────────────────────── */}
                        <div className="flex-1 min-w-0">
                            {/* Type + Status + Part badges */}
                            <div className="flex flex-wrap gap-1.5 mb-2">
                                <Badge className={isAnime ? "bg-secondary/20 text-secondary" : isSeries ? "bg-accent/20 text-accent" : "bg-primary/20 text-primary"}>
                                    {isAnime ? <Clapperboard size={11} /> : isSeries ? <Tv size={11} /> : <Film size={11} />}
                                    {isAnime ? "Anime" : isSeries ? "Series" : "Movie"}
                                </Badge>

                                {m?.status && <Badge className="bg-base-300 text-base-content/55">{m.status}</Badge>}

                                {partNum != null && (
                                    <Badge className="bg-secondary/20 text-secondary">
                                        <Layers size={11} /> Part {partNum}
                                    </Badge>
                                )}

                                {audioLabel && (
                                    <Badge className="bg-success/15 text-success">
                                        <Volume2 size={11} /> {audioLabel}
                                    </Badge>
                                )}
                            </div>

                            {/* Title */}
                            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-base-content leading-tight mb-1">{title}</h1>

                            {/* Original title */}
                            {originalTitle && <p className="text-xs text-base-content/35 mb-2 font-medium">{originalTitle}</p>}

                            {/* Tagline */}
                            {tagline && <p className="text-sm text-base-content/50 italic mb-3">{tagline}</p>}

                            {/* Meta row */}
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-3 text-sm text-base-content/65">
                                {(releaseDateFmt || year) && (
                                    <span className="flex items-center gap-1">
                                        <Calendar size={13} className="shrink-0 text-base-content/40" />
                                        {releaseDateFmt ?? year}
                                    </span>
                                )}
                                {runtime && (
                                    <span className="flex items-center gap-1">
                                        <Clock size={13} className="shrink-0 text-base-content/40" />
                                        {runtime}
                                    </span>
                                )}
                                {heroLang && (
                                    <span className="flex items-center gap-1">
                                        <Globe size={13} className="shrink-0 text-base-content/40" />
                                        {heroLang}
                                    </span>
                                )}
                                {isSeries && m?.totalSeasons && (
                                    <span className="flex items-center gap-1">
                                        <Tv size={13} className="shrink-0 text-base-content/40" />
                                        {m.totalSeasons} {m.totalSeasons === 1 ? "season" : "seasons"}
                                        {m?.totalEpisodes && ` · ${m.totalEpisodes} episodes`}
                                    </span>
                                )}
                            </div>

                            {/* Genre tags */}
                            {genres.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 mb-4">
                                    {genres.map((g) => (
                                        <span key={g} className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-base-300 text-base-content/65 border border-white/5">
                                            {g}
                                        </span>
                                    ))}
                                </div>
                            )}

                            {/* Action buttons */}
                            <div className="flex flex-wrap items-center gap-2 mb-5">
                                {!isSeries && (
                                    <button onClick={handlePlayMovie} className="btn btn-primary btn-sm sm:btn-md gap-2 px-6 rounded-full border-none">
                                        <Play size={16} fill="currentColor" />
                                        {resumePos ? "Resume" : "Play"}
                                    </button>
                                )}

                                {trailerKey && (
                                    <button onClick={() => setShowTrailer(true)} className="btn btn-sm sm:btn-md btn-outline gap-2 rounded-full">
                                        <Play size={14} /> Trailer
                                    </button>
                                )}

                                <button
                                    onClick={() => toggleWatchlist(decodedId, { name: title, poster, type: mediaType })}
                                    className={`btn btn-sm sm:btn-md btn-circle btn-outline transition-colors ${watchlisted ? "text-accent border-accent bg-accent/10" : "text-base-content/60"}`}
                                    title={watchlisted ? "Remove from Watchlist" : "Add to Watchlist"}>
                                    <Eye size={17} />
                                </button>

                                <button
                                    onClick={() => toggleFavourite(decodedId, { name: title, poster, type: mediaType })}
                                    className={`btn btn-sm sm:btn-md btn-circle btn-outline transition-colors ${favourited ? "text-error border-error bg-error/10" : "text-base-content/60"}`}
                                    title={favourited ? "Remove from Favourites" : "Add to Favourites"}>
                                    <Heart size={17} fill={favourited ? "currentColor" : "none"} />
                                </button>
                            </div>

                            {/* Overview */}
                            {overview && (
                                <div>
                                    <p className={`text-sm sm:text-base text-base-content/70 leading-relaxed ${!overviewExpanded && overviewLong ? "line-clamp-3" : ""}`}>{overview}</p>
                                    {overviewLong && (
                                        <button onClick={() => setOverviewExpanded((v) => !v)} className="flex items-center gap-1 text-xs text-primary mt-1.5 cursor-pointer hover:underline">
                                            {overviewExpanded ? (
                                                <>
                                                    <ChevronUp size={13} /> Show less
                                                </>
                                            ) : (
                                                <>
                                                    <ChevronDown size={13} /> Read more
                                                </>
                                            )}
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Page body ────────────────────────────────────────────────── */}
            <div className="space-y-8 px-4 sm:px-8 lg:px-12 pb-20">
                {/* ── Seasons (series / anime) ─────────────────────────────── */}
                {isSeries && seasons && Object.keys(seasons).length > 0 && (
                    <section className="max-w-5xl">
                        <SectionHeading icon={Tv}>
                            Seasons
                            <span className="ml-1 text-sm font-normal text-base-content/40">({Object.keys(seasons).length})</span>
                        </SectionHeading>
                        <SeasonsPanel seasons={seasons} onPlayEpisode={handlePlayEpisode} />
                    </section>
                )}

                {/* ── Other parts row (multi-part movies: KGF Ch1 & Ch2) ───── */}
                {relatedParts.length > 0 && (
                    <section>
                        <MediaRow
                            title={`More of ${item.parsed?.title || title.split(" ")[0]}`}
                            items={relatedParts}
                            onPlay={(raw) => {
                                if (raw?.id) navigate(`/media/${encodeURIComponent(raw.id)}`);
                            }}
                        />
                    </section>
                )}

                {/* ── Cast ─────────────────────────────────────────────────── */}
                {cast.length > 0 && (
                    <section className="max-w-5xl">
                        <SectionHeading icon={Users}>Cast</SectionHeading>
                        <CastCarousel cast={cast} />
                    </section>
                )}

                <Divider />

                {/* ── Details grid ─────────────────────────────────────────── */}
                {m && (
                    <section className="max-w-5xl">
                        <SectionHeading icon={Info}>Details</SectionHeading>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                            <DetailCell icon={Calendar} iconClass="text-blue-400" label={releaseDateLabel} value={releaseDateFmt || (year ? String(year) : null)} />
                            <DetailCell icon={Globe} iconClass="text-emerald-400" label="Language" value={primaryLangDisplay} note={audioLabel} />
                            <DetailCell icon={Clock} iconClass="text-orange-400" label="Runtime" value={runtime} />
                            <DetailCell icon={Star} iconClass="text-warning" label="Rating" value={rating != null ? `${rating} / 10` : null} />
                            <DetailCell icon={Hash} iconClass="text-violet-400" label="Votes" value={m.votes ? m.votes.toLocaleString() : null} />
                            <DetailCell icon={Award} iconClass="text-pink-400" label="Status" value={m.status} />
                            {partNum != null && <DetailCell icon={Layers} iconClass="text-secondary" label="Part" value={`Part ${partNum}`} />}
                            {isSeries && <DetailCell icon={Tv} iconClass="text-accent" label="Seasons" value={m.totalSeasons} />}
                            {isSeries && <DetailCell icon={Clapperboard} iconClass="text-primary" label="Episodes" value={m.totalEpisodes} />}
                        </div>
                    </section>
                )}

                <Divider />

                {/* ── Similar media ─────────────────────────────────────────── */}
                <SimilarMedia currentId={decodedId} genres={genres} mediaType={mediaType} />
            </div>

            {/* ── Trailer modal ─────────────────────────────────────────────── */}
            {showTrailer && trailerKey && <TrailerModal trailerKey={trailerKey} onClose={() => setShowTrailer(false)} />}
        </div>
    );
}
