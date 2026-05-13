import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router";
import { Play, Eye, Heart, Star, Film, Tv, Clock, Calendar, Globe, Award, Users, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, ArrowLeft, Layers } from "lucide-react";
import { useApi } from "../../../Context/apiContext";
import { getMediaById } from "../../../api";

// ─── API helpers ──────────────────────────────────────────────────────────────
// Movies  → GET /api/media/:id          (file id)
// Series  → GET /api/media?type=series  then find by series id  (grouped shape)
// We pass ?mediaType=series in the URL so the component knows which path to use.

async function fetchMovieItem(id) {
    const data = await getMediaById(id);
    return data?.file ?? data;
}

async function fetchSeriesItem(seriesId, apiGet) {
    // apiGet is api.get from the client so we can re-use the shared base URL
    const data = await apiGet(`/api/media?type=series`);
    const all = [...(data?.series?.items ?? []), ...(data?.anime?.items ?? [])];
    return all.find((s) => s.id === seriesId) ?? null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtRuntime(mins) {
    if (!mins) return null;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ─── Tiny shared primitives ───────────────────────────────────────────────────
function Badge({ children, className = "" }) {
    return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${className}`}>{children}</span>;
}

function SectionHeading({ icon: Icon, children }) {
    return (
        <h2 className="text-base sm:text-lg font-semibold text-base-content mb-3 flex items-center gap-2">
            {Icon && <Icon size={18} className="text-primary" />}
            {children}
        </h2>
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

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function Skeleton() {
    return (
        <div className="min-h-screen -m-4 sm:-m-6 lg:-m-8 animate-pulse">
            <div className="h-72 sm:h-96 bg-base-200" />
            <div className="px-4 sm:px-8 lg:px-12 -mt-32 sm:-mt-48 relative z-10 pb-10 max-w-5xl space-y-4">
                <div className="flex gap-6">
                    <div className="w-36 sm:w-44 aspect-2/3 rounded-xl bg-base-300 shrink-0" />
                    <div className="flex-1 space-y-3 pt-8">
                        <div className="h-8 bg-base-300 rounded w-3/4" />
                        <div className="h-4 bg-base-300 rounded w-1/3" />
                        <div className="h-4 bg-base-300 rounded w-1/2" />
                        <div className="h-10 bg-base-300 rounded w-40 mt-4" />
                    </div>
                </div>
            </div>
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
                    {ep.episode != null ? <span className="text-primary mr-1.5">E{String(ep.episode).padStart(2, "0")}</span> : null}
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
                        {/* Season header — clickable to expand/collapse */}
                        <button className="w-full flex items-center gap-3 p-4 hover:bg-base-300/50 transition-colors text-left" onClick={() => setOpenSeason(isOpen ? null : num)}>
                            {season.poster && <img src={season.poster} alt={season.name} className="w-10 h-14 object-cover rounded shrink-0" loading="lazy" />}
                            <div className="flex-1 min-w-0">
                                <h3 className="font-semibold text-base-content">{season.name || `Season ${num}`}</h3>
                                <p className="text-xs text-base-content/50 mt-0.5">
                                    {season.episodeCount} episode{season.episodeCount !== 1 ? "s" : ""}
                                    {season.id && <span className="ml-2 opacity-30 font-mono text-[9px]">id:{season.id.slice(0, 8)}…</span>}
                                </p>
                                {season.overview && !isOpen && <p className="text-xs text-base-content/40 line-clamp-1 mt-0.5">{season.overview}</p>}
                            </div>
                            {isOpen ? <ChevronUp size={16} className="text-base-content/40 shrink-0" /> : <ChevronDown size={16} className="text-base-content/40 shrink-0" />}
                        </button>

                        {/* Episodes */}
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
                                                <ChevronUp size={12} />
                                                Show less
                                            </>
                                        ) : (
                                            <>
                                                <ChevronDown size={12} />
                                                Show all {eps.length} episodes
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

// ─── Main component ───────────────────────────────────────────────────────────
export default function MediaDetails() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    // ?mediaType=series  →  fetch grouped series shape
    // (default / absent) →  fetch single file shape (movie)
    const mediaType = searchParams.get("mediaType") || "movie";
    const isSeries = mediaType === "series" || mediaType === "anime";

    const {
        isInWatchlist,
        toggleWatchlist,
        isFavourite,
        toggleFavourite,
        getResume,
        getStreamUrl,
        api: apiClient, // raw api.get for direct calls
    } = useApi();

    const [item, setItem] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [overviewExpanded, setOverviewExpanded] = useState(false);
    const [imgError, setImgError] = useState(false);
    const [resumePos, setResumePos] = useState(null);

    const decodedId = decodeURIComponent(id);

    // ── Fetch ──────────────────────────────────────────────────────────────────
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);

        const fetchFn = isSeries ? () => fetchSeriesItem(decodedId, apiClient.get) : () => fetchMovieItem(decodedId);

        fetchFn()
            .then((data) => {
                if (!cancelled) {
                    setItem(data);
                    setLoading(false);
                }
            })
            .catch((err) => {
                if (!cancelled) {
                    setError(err.message);
                    setLoading(false);
                }
            });

        // Only fetch resume point for movie files (they have a streamable file id)
        if (!isSeries) {
            getResume(decodedId).then((r) => {
                if (!cancelled) setResumePos(r?.position ?? null);
            });
        }

        return () => {
            cancelled = true;
        };
    }, [decodedId, isSeries]);

    // ── Loading / Error states ─────────────────────────────────────────────────
    if (loading) return <Skeleton />;

    if (error || !item)
        return (
            <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
                {isSeries ? <Tv size={48} className="text-base-content/20" /> : <Film size={48} className="text-base-content/20" />}
                <p className="text-base-content/50">Media not found</p>
                <button onClick={() => navigate(-1)} className="btn btn-sm btn-ghost gap-1">
                    <ArrowLeft size={14} /> Go back
                </button>
            </div>
        );

    // ── Derive display fields — same logic regardless of movie vs series ───────
    const m = item.metadata;
    const title = m?.title || item.title || item.name || "Unknown";
    const overview = m?.overview;
    const poster = m?.poster;
    const backdrop = m?.backdrop;
    const year = m?.year;
    const rating = m?.rating;
    const runtime = fmtRuntime(m?.runtime);
    const genres = m?.genres || item.category || [];
    const cast = m?.cast || [];
    const trailerKey = m?.trailer;
    const tagline = m?.tagline;

    // For series: seasons come from item.seasons (grouped shape)
    // For movies: item.parsed?.part gives the part number (if multi-part)
    const seasons = isSeries ? item.seasons : null;
    const partNum = !isSeries ? item.parsed?.part : null;
    const partId = !isSeries ? item.partId : null;

    const watchId = decodedId;
    const watchlisted = isInWatchlist(watchId);
    const favourited = isFavourite(watchId);
    const overviewLong = overview && overview.length > 200;

    // ── Play handlers ──────────────────────────────────────────────────────────
    const handlePlayMovie = () => {
        if (item.streamUrl) navigate(`/player/${encodeURIComponent(item.id)}`);
    };

    const handlePlayEpisode = (epId) => {
        navigate(`/player/${encodeURIComponent(epId)}`);
    };

    // ─────────────────────────────────────────────────────────────────────────
    return (
        <div className="min-h-screen -m-4 sm:-m-6 lg:-m-8 space-y-5">
            {/* ── Backdrop + Hero ─────────────────────────────────────────── */}
            <div className="relative">
                {/* Fixed-height backdrop */}
                <div className="absolute inset-x-0 top-0 h-90 sm:h-105 pointer-events-none" style={{ zIndex: 0 }}>
                    {backdrop && !imgError ? (
                        <img src={backdrop} alt={title} className="w-full h-full object-cover object-top" onError={() => setImgError(true)} />
                    ) : (
                        <div className="w-full h-full bg-linear-to-br from-primary/30 to-base-300" />
                    )}
                    <div className="absolute inset-0 bg-linear-to-t from-base-100 via-base-100/60 to-transparent" />
                    <div className="absolute inset-0 bg-linear-to-r from-base-100/80 via-transparent to-transparent hidden sm:block" />
                </div>

                {/* Hero content */}
                <div className="relative px-4 sm:px-8 lg:px-12 pt-6 pb-8 sm:pt-8" style={{ zIndex: 1 }}>
                    <div className="flex flex-col sm:flex-row gap-6 sm:gap-8 max-w-5xl">
                        {/* Poster */}
                        <div className="shrink-0 mx-auto sm:mx-0 w-36 sm:w-44 md:w-52">
                            <div className="aspect-2/3 rounded-xl overflow-hidden shadow-2xl ring-2 ring-white/10 bg-base-300">
                                {poster ? (
                                    <img src={poster} alt={title} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                        {isSeries ? <Tv size={40} className="text-base-content/20" /> : <Film size={40} className="text-base-content/20" />}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white leading-tight mb-1">{title}</h1>
                            {tagline && <p className="text-sm text-base-content/50 italic mb-3">{tagline}</p>}

                            {/* Meta badges */}
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-3 text-sm text-base-content/70">
                                {/* movie / series / anime badge */}
                                <Badge className={isSeries ? "bg-accent/20 text-accent" : "bg-primary/20 text-primary"}>{mediaType === "anime" ? "Anime" : isSeries ? "Series" : "Movie"}</Badge>

                                {m?.status && <Badge className="bg-base-300 text-base-content/60">{m.status}</Badge>}

                                {/* part badge for multi-part movies */}
                                {partNum != null && (
                                    <Badge className="bg-secondary/20 text-secondary flex items-center gap-1">
                                        <Layers size={11} /> Part {partNum}
                                    </Badge>
                                )}

                                {year && (
                                    <span className="flex items-center gap-1">
                                        <Calendar size={13} className="shrink-0" />
                                        {year}
                                    </span>
                                )}
                                {runtime && (
                                    <span className="flex items-center gap-1">
                                        <Clock size={13} className="shrink-0" />
                                        {runtime}
                                    </span>
                                )}
                                {m?.language && (
                                    <span className="flex items-center gap-1 uppercase">
                                        <Globe size={13} className="shrink-0" />
                                        {m.language}
                                    </span>
                                )}
                                {isSeries && m?.totalSeasons && (
                                    <span className="flex items-center gap-1">
                                        <Tv size={13} className="shrink-0" />
                                        {m.totalSeasons} {m.totalSeasons === 1 ? "season" : "seasons"}
                                    </span>
                                )}
                            </div>

                            {/* Rating + genres */}
                            <div className="flex flex-wrap items-center gap-3 mb-4">
                                {rating != null && (
                                    <span className="flex items-center gap-1.5">
                                        <Star size={15} className="text-warning fill-warning" />
                                        <span className="text-sm font-bold text-base-content">{rating.toFixed(1)}</span>
                                        {m?.votes ? <span className="text-xs text-base-content/40">({m.votes.toLocaleString()})</span> : null}
                                    </span>
                                )}
                                {genres.length > 0 && <span className="text-xs text-base-content/55">{genres.join(", ")}</span>}
                            </div>

                            {/* Action buttons */}
                            <div className="flex flex-wrap items-center gap-2 mb-5">
                                {/* Play — only for movies (series plays per-episode) */}
                                {!isSeries && (
                                    <button onClick={handlePlayMovie} className="btn btn-primary btn-sm sm:btn-md gap-2 px-6 rounded-full border-none">
                                        <Play size={16} fill="currentColor" />
                                        {resumePos ? "Resume" : "Play"}
                                    </button>
                                )}

                                {trailerKey && (
                                    <a href={`https://www.youtube.com/watch?v=${trailerKey}`} target="_blank" rel="noreferrer" className="btn btn-sm sm:btn-md btn-outline gap-2 rounded-full">
                                        <Play size={14} /> Trailer
                                    </a>
                                )}

                                <button
                                    onClick={() => toggleWatchlist(watchId, { name: title, poster, type: mediaType })}
                                    className={`btn btn-sm sm:btn-md btn-circle btn-outline ${watchlisted ? "text-accent border-accent" : "text-base-content"}`}
                                    title={watchlisted ? "Remove from Watchlist" : "Add to Watchlist"}>
                                    <Eye size={18} />
                                </button>
                                <button
                                    onClick={() => toggleFavourite(watchId, { name: title, poster, type: mediaType })}
                                    className={`btn btn-sm sm:btn-md btn-circle btn-outline ${favourited ? "text-error border-error" : "text-base-content"}`}
                                    title={favourited ? "Remove from Favourites" : "Add to Favourites"}>
                                    <Heart size={18} fill={favourited ? "currentColor" : "none"} />
                                </button>
                            </div>

                            {/* Overview */}
                            {overview && (
                                <div>
                                    <p className={`text-sm sm:text-base text-base-content/75 leading-relaxed ${!overviewExpanded && overviewLong ? "line-clamp-3" : ""}`}>{overview}</p>
                                    {overviewLong && (
                                        <button onClick={() => setOverviewExpanded((v) => !v)} className="flex items-center gap-1 text-xs text-primary mt-1 cursor-pointer">
                                            {overviewExpanded ? (
                                                <>
                                                    <ChevronUp size={13} />
                                                    Less
                                                </>
                                            ) : (
                                                <>
                                                    <ChevronDown size={13} />
                                                    More
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

            {/* ── Seasons (series only) ────────────────────────────────────── */}
            {isSeries && seasons && Object.keys(seasons).length > 0 && (
                <div className="px-4 sm:px-8 lg:px-12 pb-6 max-w-5xl">
                    <SectionHeading icon={Tv}>
                        Seasons
                        <span className="ml-1 text-sm font-normal text-base-content/40">({Object.keys(seasons).length})</span>
                    </SectionHeading>
                    <SeasonsPanel seasons={seasons} onPlayEpisode={handlePlayEpisode} />
                </div>
            )}

            {/* ── Cast carousel ────────────────────────────────────────────── */}
            {cast.length > 0 && (
                <div className="px-4 sm:px-8 lg:px-12 py-6 w-full">
                    <SectionHeading icon={Users}>Cast &amp; Crew</SectionHeading>
                    <CastCarousel cast={cast} />
                </div>
            )}

            {/* ── Details grid ─────────────────────────────────────────────── */}
            {m && (
                <div className="px-4 sm:px-8 lg:px-12 pb-16 max-w-5xl">
                    <SectionHeading icon={Award}>Details</SectionHeading>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {[
                            { label: "Status", val: m.status },
                            { label: "Language", val: m.language?.toUpperCase() },
                            { label: "Runtime", val: runtime },
                            { label: "Rating", val: rating ? `${rating} / 10` : null },
                            { label: "Votes", val: m.votes?.toLocaleString() },
                            { label: "Year", val: year },
                            partNum != null && { label: "Part", val: partNum },
                            isSeries && { label: "Seasons", val: m.totalSeasons },
                            isSeries && { label: "Episodes", val: m.totalEpisodes },
                        ]
                            .filter(Boolean)
                            .filter((r) => r.val != null)
                            .map(({ label, val }) => (
                                <div key={label} className="bg-base-200 rounded-xl p-3">
                                    <p className="text-xs text-base-content/45 mb-0.5">{label}</p>
                                    <p className="text-sm font-semibold text-base-content">{val}</p>
                                </div>
                            ))}
                    </div>
                </div>
            )}
        </div>
    );
}
