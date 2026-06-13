import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useParams, useNavigate } from "react-router";
import { Users, ChevronLeft, ChevronRight, X, Calendar, MapPin, Star, Film, Tv, Globe, TrendingUp, Heart, Eye, MoreVertical, Bookmark, List, CheckCircle, Play, ExternalLink } from "lucide-react";
import { useApi } from "../Context/apiContext";
import { getMediaById } from "../api";

const TMDB_KEY = import.meta.env.VITE_TMDB_API_KEY;
const TMDB_BASE = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p";

// ─── TMDB person bio ──────────────────────────────────────────────────────────
async function fetchPersonBio(tmdbPersonId, name) {
    if (!TMDB_KEY) return null;
    let personId = tmdbPersonId;
    if (!personId) {
        const r = await fetch(`${TMDB_BASE}/search/person?api_key=${TMDB_KEY}&query=${encodeURIComponent(name)}&language=en-US`);
        if (!r.ok) return null;
        const d = await r.json();
        personId = d.results?.[0]?.id;
        if (!personId) return null;
    }
    const r = await fetch(`${TMDB_BASE}/person/${personId}?api_key=${TMDB_KEY}&language=en-US`);
    if (!r.ok) return null;
    return r.json();
}

// ─── Scan local library for person ───────────────────────────────────────────
function findInLibrary(person, movies, series, anime, currentMediaId) {
    const pid = person.tmdbPersonId;
    if (!pid) return [];
    const results = [];

    const hasPersonIn = (meta) => {
        if (!meta) return false;
        return (meta.cast || []).some((c) => c.tmdbPersonId === pid) || (meta.crew || []).some((c) => c.tmdbPersonId === pid);
    };
    const getRoleIn = (meta) => {
        if (!meta) return null;
        const c = (meta.cast || []).find((c) => c.tmdbPersonId === pid);
        if (c?.character) return c.character;
        const cr = (meta.crew || []).find((c) => c.tmdbPersonId === pid);
        if (cr?.job) return cr.job;
        return null;
    };

    for (const movie of movies) {
        if (movie.id === currentMediaId) continue;
        const meta = movie.metadata || movie;
        if (hasPersonIn(meta)) {
            results.push({
                id: movie.id,
                title: meta.title || movie.name,
                poster: meta.poster || null,
                year: meta.year || null,
                rating: meta.rating || null,
                type: "movie",
                role: getRoleIn(meta),
                raw: movie,
            });
        }
    }
    for (const show of [...series, ...anime]) {
        const meta = show.metadata || show;
        const showId = show.seriesKey || show.id;
        if (showId === currentMediaId) continue;
        if (hasPersonIn(meta)) {
            results.push({
                id: showId,
                title: meta.title || show.title,
                poster: meta.poster || null,
                year: meta.year || null,
                rating: meta.rating || null,
                type: show.type || "series",
                role: getRoleIn(meta),
                raw: show,
            });
        }
    }
    return results;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function mergeCrewJobs(crewList) {
    if (!crewList || !Array.isArray(crewList)) return [];
    const map = new Map();
    for (const member of crewList) {
        const key = member.tmdbPersonId || member.name;
        if (map.has(key)) {
            const existing = map.get(key);
            if (member.job && !existing.job.includes(member.job)) existing.job += ` / ${member.job}`;
        } else {
            map.set(key, { ...member });
        }
    }
    return Array.from(map.values());
}

function formatDate(dateStr) {
    if (!dateStr) return null;
    return new Date(dateStr).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function calcAge(birthday, deathday) {
    if (!birthday) return null;
    const end = deathday ? new Date(deathday) : new Date();
    const birth = new Date(birthday);
    let age = end.getFullYear() - birth.getFullYear();
    const m = end.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && end.getDate() < birth.getDate())) age--;
    return age;
}

function genderLabel(g) {
    if (g === 1) return "Female";
    if (g === 2) return "Male";
    if (g === 3) return "Non-binary";
    return null;
}

// ─── Library MediaCard ────────────────────────────────────────────────────────
const LIB_MENU_ITEMS = [
    { icon: Play, label: "Watch Now", key: "play" },
    { icon: Bookmark, label: "Add to Watchlist", key: "watchlist" },
    { icon: List, label: "Add to List", key: "list" },
    { icon: Tv, label: "Watch Trailer", key: "trailer" },
    { icon: CheckCircle, label: "Mark as Watched", key: "watched" },
];
const LIB_MENU_W = 208;
const LIB_MENU_H = LIB_MENU_ITEMS.length * 44 + 12;

function LibCardMenu({ open, anchor, onAction, onClose }) {
    const menuRef = useRef(null);
    const [pos, setPos] = useState({ top: 0, left: 0 });

    useEffect(() => {
        if (!open || !anchor) return;
        const rect = anchor.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        const top = spaceBelow >= LIB_MENU_H ? rect.bottom + 6 : rect.top - LIB_MENU_H - 6;
        const spaceRight = window.innerWidth - rect.left;
        const left = spaceRight >= LIB_MENU_W ? rect.left : rect.right - LIB_MENU_W;
        setPos({ top, left });
    }, [open, anchor]);

    useEffect(() => {
        if (!open) return;
        const onOut = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
        };
        const onScroll = () => onClose();
        document.addEventListener("mousedown", onOut);
        window.addEventListener("scroll", onScroll, true);
        return () => {
            document.removeEventListener("mousedown", onOut);
            window.removeEventListener("scroll", onScroll, true);
        };
    }, [open, onClose]);

    if (!open) return null;
    return createPortal(
        <>
            <style>{`@keyframes libMenuIn{from{opacity:0;transform:translateY(-4px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}`}</style>
            <div
                ref={menuRef}
                style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 999999, animation: "libMenuIn 0.12s ease-out both" }}
                className="w-52 rounded-2xl overflow-hidden shadow-2xl bg-[oklch(15%_0.01_260/0.97)] backdrop-blur-md border border-white/10 py-1.5">
                {LIB_MENU_ITEMS.map(({ icon: Icon, label, key }) => (
                    <button
                        key={key}
                        onClick={(e) => {
                            e.stopPropagation();
                            onAction(key);
                        }}
                        className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-white/90 hover:bg-white/10 active:bg-white/15 transition-colors duration-100 cursor-pointer">
                        <Icon size={15} strokeWidth={1.8} className="text-white/60 shrink-0" />
                        {label}
                    </button>
                ))}
            </div>
        </>,
        document.body,
    );
}

function LibraryMediaCard({ item, onClose }) {
    const navigate = useNavigate();
    const { isInWatchlist, toggleWatchlist, isFavourite, toggleFavourite } = useApi();
    const [imgErr, setImgErr] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const btnRef = useRef(null);

    const watchlisted = isInWatchlist(item.id);
    const favourited = isFavourite(item.id);

    const payload = { name: item.title, poster: item.poster, type: item.type, year: item.year, rating: item.rating };

    const handleClick = () => {
        onClose();
        navigate(`/media/${encodeURIComponent(item.id)}`);
    };

    const handleMenuAction = (key) => {
        setMenuOpen(false);
        if (key === "watchlist") toggleWatchlist(item.id, payload);
    };

    return (
        <div onClick={handleClick} className="group relative w-full cursor-pointer select-none">
            {/* Poster */}
            <div
                className="relative w-full aspect-[2/3] rounded-xl overflow-hidden bg-base-300
                            shadow-lg ring-1 ring-white/5 transition-transform duration-200
                            group-hover:scale-[1.03] group-hover:shadow-2xl group-hover:ring-white/20">
                {item.poster && !imgErr ? (
                    <img src={item.poster} alt={item.title} className="w-full h-full object-cover" onError={() => setImgErr(true)} loading="lazy" draggable={false} />
                ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-2" style={{ background: "var(--color-base-300)" }}>
                        {item.type === "series" || item.type === "anime" ? <Tv size={22} className="text-white/20" /> : <Film size={22} className="text-white/20" />}
                        <span className="text-[9px] text-white/30 font-medium text-center px-2 line-clamp-2 leading-tight">{item.title}</span>
                    </div>
                )}

                {/* Gradient */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

                {/* Type badge */}
                <div className="absolute top-1.5 left-1.5">
                    <span
                        className={`text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md
                        ${item.type === "series" || item.type === "anime" ? "bg-accent/90 text-accent-content" : "bg-primary/90 text-primary-content"}`}>
                        {item.type === "anime" ? "Anime" : item.type === "series" ? "Series" : "Movie"}
                    </span>
                </div>
            </div>

            {/* ⋮ button — outside overflow:hidden */}
            <div className="absolute inset-x-0 top-0 pointer-events-none" style={{ aspectRatio: "2/3" }}>
                <div className="absolute bottom-2 right-2 pointer-events-auto" onClick={(e) => e.stopPropagation()}>
                    <button
                        ref={btnRef}
                        onClick={(e) => {
                            e.stopPropagation();
                            setMenuOpen((v) => !v);
                        }}
                        className="w-6 h-6 rounded-full flex items-center justify-center shadow-md cursor-pointer
                                   opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-all duration-150
                                   active:scale-95 md:bg-white/90 hover:bg-white"
                        aria-label="More options">
                        <MoreVertical size={12} className="text-white md:text-black" />
                    </button>
                </div>
            </div>

            <LibCardMenu open={menuOpen} anchor={btnRef.current} onAction={handleMenuAction} onClose={() => setMenuOpen(false)} />

            {/* Info */}
            <div className="mt-1.5 px-0.5">
                <p className="text-[11px] font-semibold text-white truncate leading-tight">{item.title}</p>
                <div className="flex items-center justify-between mt-1 gap-1">
                    <span className="text-[10px] text-white/50 font-medium shrink-0">{item.year ?? "—"}</span>
                    <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => toggleFavourite(item.id, payload)} aria-label="Favourite" className="cursor-pointer">
                            <Heart size={11} fill={favourited ? "currentColor" : "none"} className={favourited ? "text-error fill-error" : "text-white/40 hover:text-error/70"} />
                        </button>
                        <button onClick={() => toggleWatchlist(item.id, payload)} aria-label="Watchlist" className="cursor-pointer">
                            <Eye size={11} className={watchlisted ? "text-accent" : "text-white/40 hover:text-accent/70"} />
                        </button>
                        {item.rating != null && (
                            <span className="flex items-center gap-0.5">
                                <Star size={9} className="text-warning fill-warning" />
                                <span className="text-[10px] text-white/60 font-medium">{item.rating.toFixed(1)}</span>
                            </span>
                        )}
                    </div>
                </div>
                {item.role && (
                    <p className="text-[10px] mt-0.5 truncate" style={{ color: "var(--color-primary)", opacity: 0.85 }}>
                        {item.role}
                    </p>
                )}
            </div>
        </div>
    );
}

// ─── Person Detail Modal ──────────────────────────────────────────────────────
function PersonModal({ member, currentMediaId, movies, series, anime, onClose }) {
    const [bio, setBio] = useState(null);
    const [loadingBio, setLoadingBio] = useState(true);
    const [imgErr, setImgErr] = useState(false);
    const [bioExpanded, setBioExpanded] = useState(false);
    const overlayRef = useRef(null);

    const libraryItems = findInLibrary(member, movies, series, anime, currentMediaId);

    // Lock body scroll
    useEffect(() => {
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = "";
        };
    }, []);

    // Fetch bio
    useEffect(() => {
        let cancelled = false;
        setLoadingBio(true);
        setBio(null);
        setImgErr(false);
        fetchPersonBio(member.tmdbPersonId, member.name)
            .then((d) => {
                if (!cancelled) {
                    setBio(d);
                    setLoadingBio(false);
                }
            })
            .catch(() => {
                if (!cancelled) setLoadingBio(false);
            });
        return () => {
            cancelled = true;
        };
    }, [member.tmdbPersonId, member.name]);

    // Escape close
    useEffect(() => {
        const h = (e) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [onClose]);

    const handleOverlayClick = (e) => {
        if (e.target === overlayRef.current) onClose();
    };

    const photo = member.photo || (bio?.profile_path ? `${IMG_BASE}/w300${bio.profile_path}` : null);
    const age = bio ? calcAge(bio.birthday, bio.deathday) : null;
    const biographyText = bio?.biography || "";

    const modal = (
        <>
            <div
                ref={overlayRef}
                onClick={handleOverlayClick}
                className="fixed inset-0 flex items-center justify-center p-3 sm:p-4"
                style={{
                    zIndex: 99998,
                    background: "rgba(0,0,0,0.80)",
                    backdropFilter: "blur(20px)",
                    WebkitBackdropFilter: "blur(20px)",
                }}>
                <div
                    className="relative w-full max-w-3xl rounded-2xl shadow-2xl flex flex-col overflow-hidden"
                    style={{
                        background: "oklch(14% 0.01 260 / 0.97)",
                        border: "1px solid rgba(255,255,255,0.10)",
                        height: "min(88vh, 820px)",
                        maxHeight: "90svh",
                        zIndex: 99999,
                    }}>
                    {/* Close btn — cursor-pointer added */}
                    <button
                        onClick={onClose}
                        className="absolute top-3 right-3 z-20 w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-white/15 cursor-pointer"
                        style={{ background: "rgba(255,255,255,0.08)" }}>
                        <X size={15} className="text-white/90" />
                    </button>

                    {/* Inner scroll */}
                    <div className="flex-1 overflow-y-auto overflow-x-hidden" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                        {/* HEADER */}
                        <div className="relative">
                            {photo && !imgErr && (
                                <div className="absolute inset-0 overflow-hidden rounded-t-2xl">
                                    <img src={photo} alt="" className="w-full h-full object-cover scale-110" style={{ filter: "blur(24px) brightness(0.3)", transform: "scale(1.15)" }} />
                                </div>
                            )}
                            {(!photo || imgErr) && <div className="absolute inset-0 rounded-t-2xl" style={{ background: "linear-gradient(135deg, oklch(20% 0.04 260), oklch(12% 0.02 260))" }} />}

                            <div className="relative flex gap-5 sm:gap-6 p-5 pb-5 pt-6">
                                {/* Photo */}
                                <div className="shrink-0 w-28 sm:w-36 rounded-xl overflow-hidden ring-2 ring-white/20 shadow-2xl" style={{ aspectRatio: "2/3" }}>
                                    {photo && !imgErr ? (
                                        <img src={photo} alt={member.name} className="w-full h-full object-cover" onError={() => setImgErr(true)} />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center" style={{ background: "oklch(20% 0.02 260)" }}>
                                            <Users size={36} className="text-white/20" />
                                        </div>
                                    )}
                                </div>

                                {/* Info */}
                                <div className="flex-1 min-w-0 pt-1">
                                    <h3 className="text-lg sm:text-2xl font-bold text-white leading-tight mb-1.5 pr-10">{member.name}</h3>

                                    {/* Role badges */}
                                    <div className="flex flex-wrap gap-1.5 mb-3">
                                        {member.character && (
                                            <span
                                                className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full"
                                                style={{
                                                    background: "color-mix(in oklch, var(--color-primary) 20%, transparent)",
                                                    color: "var(--color-primary)",
                                                    border: "1px solid color-mix(in oklch, var(--color-primary) 35%, transparent)",
                                                }}>
                                                as {member.character}
                                            </span>
                                        )}
                                        {member.job && (
                                            <span
                                                className="text-[11px] font-medium px-2.5 py-0.5 rounded-full text-white/70"
                                                style={{ background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.12)" }}>
                                                {member.job}
                                            </span>
                                        )}
                                    </div>

                                    {/* Loading shimmer */}
                                    {loadingBio && (
                                        <div className="space-y-2">
                                            <div className="h-3 w-2/3 rounded-md animate-pulse" style={{ background: "rgba(255,255,255,0.10)" }} />
                                            <div className="h-3 w-1/2 rounded-md animate-pulse" style={{ background: "rgba(255,255,255,0.08)" }} />
                                            <div className="h-3 w-3/4 rounded-md animate-pulse" style={{ background: "rgba(255,255,255,0.06)" }} />
                                        </div>
                                    )}

                                    {/* Person meta */}
                                    {!loadingBio && bio && (
                                        <div className="grid grid-cols-1 gap-1.5 text-[12px] text-white/70">
                                            {bio.known_for_department && (
                                                <div className="flex items-center gap-2">
                                                    <Star size={11} style={{ color: "var(--color-primary)" }} className="shrink-0" />
                                                    <span className="text-white/90 font-medium">{bio.known_for_department}</span>
                                                </div>
                                            )}
                                            {bio.gender > 0 && (
                                                <div className="flex items-center gap-2">
                                                    <Users size={11} style={{ color: "var(--color-primary)" }} className="shrink-0" />
                                                    <span>{genderLabel(bio.gender)}</span>
                                                </div>
                                            )}
                                            {bio.birthday && (
                                                <div className="flex items-center gap-2">
                                                    <Calendar size={11} style={{ color: "var(--color-primary)" }} className="shrink-0" />
                                                    <span>
                                                        {formatDate(bio.birthday)}
                                                        {age !== null && <span className="text-white/45 ml-1">{bio.deathday ? `· died age ${age}` : `· ${age} yrs`}</span>}
                                                    </span>
                                                </div>
                                            )}
                                            {bio.deathday && (
                                                <div className="flex items-center gap-2">
                                                    <Calendar size={11} className="shrink-0 text-white/30" />
                                                    <span className="text-white/45">Died {formatDate(bio.deathday)}</span>
                                                </div>
                                            )}
                                            {bio.place_of_birth && (
                                                <div className="flex items-start gap-2">
                                                    <MapPin size={11} style={{ color: "var(--color-primary)" }} className="shrink-0 mt-0.5" />
                                                    <span className="line-clamp-2">{bio.place_of_birth}</span>
                                                </div>
                                            )}
                                            {bio.popularity != null && (
                                                <div className="flex items-center gap-2">
                                                    <TrendingUp size={11} style={{ color: "var(--color-primary)" }} className="shrink-0" />
                                                    <span>
                                                        Popularity <span className="text-white/90 font-medium">{bio.popularity.toFixed(1)}</span>
                                                    </span>
                                                </div>
                                            )}
                                            {bio.homepage && (
                                                <div className="flex items-center gap-2">
                                                    <Globe size={11} style={{ color: "var(--color-primary)" }} className="shrink-0" />
                                                    <a
                                                        href={bio.homepage}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="flex items-center gap-1 underline underline-offset-2 hover:text-white/90 transition-colors">
                                                        Official site <ExternalLink size={9} />
                                                    </a>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Also known as */}
                                    {!loadingBio && bio?.also_known_as?.length > 0 && (
                                        <div className="mt-2">
                                            <p className="text-[10px] font-semibold uppercase tracking-widest text-white/30 mb-1">Also known as</p>
                                            <p className="text-[11px] text-white/55 leading-relaxed line-clamp-2">{bio.also_known_as.slice(0, 5).join(" · ")}</p>
                                        </div>
                                    )}

                                    {!loadingBio && !bio && <p className="text-[12px] text-white/35 italic">No details available</p>}
                                </div>
                            </div>
                        </div>

                        {/* ── Biography — always scrollable, no Read More button ── */}
                        {(loadingBio || biographyText) && (
                            <>
                                <div className="mx-5 h-px" style={{ background: "rgba(255,255,255,0.07)" }} />
                                <div className="px-5 py-4">
                                    <p className="text-[10px] font-semibold uppercase tracking-widest text-white/35 mb-2">Biography</p>

                                    {loadingBio ? (
                                        <div className="space-y-2">
                                            {[1, 0.9, 1, 0.7, 0.85].map((w, i) => (
                                                <div key={i} className="h-2.5 rounded animate-pulse" style={{ width: `${w * 100}%`, background: "rgba(255,255,255,0.08)" }} />
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="relative">
                                            <div
                                                className={`text-[12px] sm:text-[13px] text-white/75 leading-relaxed ${!bioExpanded ? "line-clamp-4 overflow-hidden" : "overflow-y-auto"}`}
                                                style={bioExpanded ? { maxHeight: "200px", scrollbarWidth: "none", msOverflowStyle: "none" } : {}}>
                                                {biographyText}
                                            </div>
                                            {biographyText.length > 200 && (
                                                <button onClick={() => setBioExpanded(!bioExpanded)} className="text-[11px] font-semibold text-primary hover:text-primary/80 mt-1 cursor-pointer">
                                                    {bioExpanded ? "Show less" : "Read more"}
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </>
                        )}

                        {/* ── Also in your library ── */}
                        {libraryItems.length > 0 && (
                            <>
                                <div className="mx-5 h-px" style={{ background: "rgba(255,255,255,0.07)" }} />
                                <div className="px-5 py-4 pb-6">
                                    <p className="text-[10px] font-semibold uppercase tracking-widest text-white/35 mb-3">Also in your library</p>
                                    <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))" }}>
                                        {libraryItems.map((libItem) => (
                                            <LibraryMediaCard key={libItem.id} item={libItem} onClose={onClose} />
                                        ))}
                                    </div>
                                </div>
                            </>
                        )}

                        {libraryItems.length === 0 && <div className="pb-5" />}
                    </div>
                </div>
            </div>
        </>
    );

    return createPortal(modal, document.body);
}

// ─── SectionHeading ───────────────────────────────────────────────────────────
function SectionHeading({ icon: Icon, children }) {
    return (
        <h2 className="text-base sm:text-lg font-semibold text-base-content mb-3 flex items-center gap-2">
            {Icon && <Icon size={18} className="text-primary" />}
            {children}
        </h2>
    );
}

// ─── PersonCard — cursor-pointer on avatar + name ─────────────────────────────
function PersonCard({ member, onClick }) {
    const [imgErr, setImgErr] = useState(false);
    return (
        <button onClick={() => onClick(member)} className="shrink-0 w-20 sm:w-24 text-center group focus:outline-none cursor-pointer">
            <div
                className="w-16 h-16 sm:w-20 sm:h-20 rounded-full overflow-hidden bg-base-300 mx-auto
                            ring-2 ring-white/10 transition-all duration-200 cursor-pointer
                            group-hover:ring-primary/60 group-hover:scale-105">
                {member.photo && !imgErr ? (
                    <img src={member.photo} alt={member.name} className="w-full h-full object-cover cursor-pointer" onError={() => setImgErr(true)} loading="lazy" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center bg-base-200">
                        <Users size={24} className="text-base-content/30" />
                    </div>
                )}
            </div>
            <p className="text-[11px] font-medium text-base-content mt-1.5 leading-tight line-clamp-2 group-hover:text-primary transition-colors cursor-pointer">{member.name}</p>
            <p className="text-[10px] text-base-content/45 leading-tight line-clamp-2">{member.character || member.job}</p>
        </button>
    );
}

// ─── PersonCarousel ───────────────────────────────────────────────────────────
function PersonCarousel({ people, onPersonClick }) {
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
    }, [people, checkScroll]);

    const scroll = (dir) => scrollRef.current?.scrollBy({ left: dir * 300, behavior: "smooth" });

    return (
        <div className="relative">
            {canLeft && (
                <button
                    onClick={() => scroll(-1)}
                    className="absolute -left-4 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full cursor-pointer
                               bg-base-300/90 hover:bg-base-200 border border-white/10
                               flex items-center justify-center shadow-lg transition-colors"
                    aria-label="Scroll left">
                    <ChevronLeft size={16} className="text-base-content/70" />
                </button>
            )}
            <div ref={scrollRef} className="flex gap-4 overflow-x-auto pb-2" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                {people.map((member, i) => (
                    <PersonCard key={i} member={member} onClick={onPersonClick} />
                ))}
            </div>
            {canRight && (
                <button
                    onClick={() => scroll(1)}
                    className="absolute -right-4 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full cursor-pointer
                               bg-base-300/90 hover:bg-base-200 border border-white/10
                               flex items-center justify-center shadow-lg transition-colors"
                    aria-label="Scroll right">
                    <ChevronRight size={16} className="text-base-content/70" />
                </button>
            )}
        </div>
    );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const CastAndCrew = () => {
    const { id } = useParams();
    const decodedId = decodeURIComponent(id);
    const { movies, series, anime } = useApi();

    const [cast, setCast] = useState([]);
    const [crew, setCrew] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedPerson, setSelectedPerson] = useState(null);

    useEffect(() => {
        const contextItem = [...movies, ...series, ...anime].find((m) => m.id === decodedId || m.seriesKey === decodedId);
        if (contextItem) {
            const m = contextItem.metadata || contextItem;
            setCast(m?.cast || []);
            setCrew(mergeCrewJobs(m?.crew));
            setLoading(false);
            return;
        }

        let cancelled = false;
        setLoading(true);
        getMediaById(decodedId)
            .then((data) => {
                if (!cancelled) {
                    const item = data?.file ?? data;
                    const m = item?.metadata || item;
                    setCast(m?.cast || []);
                    setCrew(mergeCrewJobs(m?.crew));
                    setLoading(false);
                }
            })
            .catch((err) => {
                if (!cancelled) {
                    console.error("Failed to load cast & crew:", err);
                    setLoading(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [decodedId, movies, series, anime]);

    if (loading) return <div className="w-full h-32 animate-pulse bg-base-200 rounded-xl" />;

    const combinedPeople = [...cast, ...crew];
    if (combinedPeople.length === 0) return null;

    return (
        <>
            <section className="w-full">
                <SectionHeading icon={Users}>Cast &amp; Crew</SectionHeading>
                <PersonCarousel people={combinedPeople} onPersonClick={setSelectedPerson} />
            </section>

            {selectedPerson && <PersonModal member={selectedPerson} currentMediaId={decodedId} movies={movies} series={series} anime={anime} onClose={() => setSelectedPerson(null)} />}
        </>
    );
};

export default CastAndCrew;
