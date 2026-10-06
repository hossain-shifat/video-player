import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useParams, useNavigate, Link } from "react-router";
import {
    Play,
    Star,
    Film,
    Tv,
    Clock,
    Calendar,
    Globe,
    Award,
    Users,
    ChevronDown,
    ChevronUp,
    ChevronLeft,
    ChevronRight,
    Layers,
    Info,
    Hash,
    Clapperboard,
    Volume2,
    BarChart2,
    MessageSquare,
    PlayCircle,
    ThumbsUp,
    MoreVertical,
    Link2,
    Languages,
    MapPin,
    DollarSign,
    CalendarClock,
    RefreshCw,
} from "lucide-react";
import { useApi } from "../../../Context/apiContext";
import { useSeasonDetail } from "../../../Hooks/useMedia";
import { getMediaById } from "../../../api";
import { api } from "../../../api/client";
import MediaDetailsSkeleton from "../../../Components/MediaDetailsSkeleton";
import MediaRow from "../../../Components/MediaRow";
import MediaCard, { useCountdown } from "../../../Components/MediaCard";
import RelatedSections from "../../../Components/RelatedSections";
import { assets } from "../../../assets/assets";
import CastAndCrew from "../../../Components/CastAndCrew";
import Reviews from "../../../Components/Reviews";
import FloatingActionMenu from "../../../Components/FloatingActionMenu";

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
function fmtDate(iso) {
    if (!iso) return null;
    try {
        return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    } catch {
        return iso;
    }
}

// ── FIX: Budget/Revenue were built as `$${n.toLocaleString()}` — calling
// toLocaleString() with NO locale argument means the browser/OS's own
// default locale decides the number formatting, and on some locales that
// substitutes different grouping/digit conventions that read as "wrong
// currency" next to a hardcoded "$". TMDB documents budget/revenue as
// always USD regardless of the film's origin — pinning both the locale AND
// currency here makes the symbol deterministic (always "$", compact form
// like "$356.0M") no matter what locale the browser/device is set to.
function fmtCurrency(n) {
    if (!n) return null;
    try {
        return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(n);
    } catch {
        return `$${n.toLocaleString("en-US")}`;
    }
}

// ── ADDED: country code → flag emoji, zero-dependency ──────────────────────
// Regional indicator symbols start at U+1F1E6 for 'A' — offsetting each
// letter's char code by the same amount TMDB's 2-letter ISO codes already
// use ('US' → 🇺🇸, 'GB' → 🇬🇧, etc). Used by both the certifications and
// production-companies sections below for a small shared visual signature.
function flagEmoji(countryCode) {
    if (!countryCode || countryCode.length !== 2) return null;
    const points = countryCode
        .toUpperCase()
        .split("")
        .map((c) => 127397 + c.charCodeAt(0));
    return String.fromCodePoint(...points);
}

// ─── Shared primitives ────────────────────────────────────────────────────────
function Badge({ children, className = "", ...rest }) {
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${className}`} {...rest}>
            {children}
        </span>
    );
}
function SectionHeading({ icon: Icon, children }) {
    return (
        <h2 className="text-base sm:text-lg font-semibold text-base-content mb-3 flex items-center gap-2.5">
            <span className="w-1 h-4 rounded-full bg-primary shrink-0" />
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
            <span className="text-xs text-base-content/80 w-6 text-right">{pct}%</span>
        </div>
    );
}

// ─── Cast card ────────────────────────────────────────────────────────────────

// ─── Episode row ──────────────────────────────────────────────────────────────
function EpisodeRow({ ep, onPlay }) {
    return (
        <div className={`flex items-center gap-3 p-2 rounded-lg hover:bg-base-300 group transition-colors${ep.id ? " cursor-pointer" : ""}`} onClick={() => ep.id && onPlay(ep.id)}>
            {ep.still ? (
                <img src={ep.still} alt={ep.title} className="w-20 h-12 object-cover rounded shrink-0" loading="lazy" />
            ) : (
                <div className="w-20 h-12 bg-base-300 rounded shrink-0 flex items-center justify-center">
                    <Play size={16} className="text-base-content/62 group-hover:text-primary transition-colors" />
                </div>
            )}
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-base-content line-clamp-1">
                    {ep.episode != null && <span className="text-primary mr-1.5">E{String(ep.episode).padStart(2, "0")}</span>}
                    {ep.title || ep.name}
                </p>
                {ep.overview && <p className="text-xs text-base-content/76 line-clamp-2 mt-0.5">{ep.overview}</p>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
                {ep.rating && (
                    <span className="hidden sm:flex items-center gap-0.5 text-xs text-base-content/72">
                        <Star size={10} className="fill-warning text-warning" /> {ep.rating}
                    </span>
                )}
                {ep.runtime && <span className="text-xs text-base-content/72">{fmtRuntime(ep.runtime)}</span>}
                <Play size={14} className="text-base-content/58 group-hover:text-primary transition-colors" />
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
                                <p className="text-xs text-base-content/80 mt-0.5">
                                    {season.episodeCount} episode{season.episodeCount !== 1 ? "s" : ""}
                                </p>
                                {season.overview && !isOpen && <p className="text-xs text-base-content/72 line-clamp-1 mt-0.5">{season.overview}</p>}
                            </div>
                            {isOpen ? <ChevronUp size={16} className="text-base-content/72 shrink-0" /> : <ChevronDown size={16} className="text-base-content/72 shrink-0" />}
                        </button>

                        {isOpen && (
                            <div className="px-2 pb-3 space-y-1 border-t border-white/5">
                                {season.overview && <p className="text-xs text-base-content/76 px-2 py-2">{season.overview}</p>}
                                {visibleEps.map((ep) => (
                                    <EpisodeRow key={ep.id || ep.episode} ep={ep} onPlay={onPlayEpisode} />
                                ))}
                                {eps.length > 5 && (
                                    <button
                                        className="w-full text-xs text-primary py-2 hover:underline flex items-center justify-center gap-1 cursor-pointer"
                                        onClick={() => setShowAllEps((p) => ({ ...p, [num]: !p[num] }))}>
                                        {showAllEps[num] ? (
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
            <div className="w-full max-w-3xl aspect-video rounded-2xl overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <iframe src={`https://www.youtube.com/embed/${trailerKey}?autoplay=1`} title="Trailer" className="w-full h-full" allow="autoplay; fullscreen" allowFullScreen />
            </div>
        </div>
    );
}

// ─── Not-in-library modal ─────────────────────────────────────────────────────
// Opened from the "Not in library" button on titles reached via the person page.
// Portal → body with max z-index so it sits above the sticky navbar.
function NotInLibraryModal({ title, poster, isSeries, onClose, onOpenSettings }) {
    const kind = isSeries ? "series" : "movie";

    useEffect(() => {
        const onKey = (e) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.removeEventListener("keydown", onKey);
            document.body.style.overflow = prev;
        };
    }, [onClose]);

    return createPortal(
        <div
            className="fixed inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            style={{ zIndex: 2147483647 }}
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-labelledby="nil-title">
            <div className="w-full max-w-md rounded-2xl bg-base-200 border border-white/10 shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start gap-4 p-5 sm:p-6">
                    {poster ? (
                        <img src={poster} alt="" className="w-16 sm:w-20 aspect-2/3 rounded-lg object-cover shrink-0 ring-1 ring-white/10" />
                    ) : (
                        <div className="w-16 sm:w-20 aspect-2/3 rounded-lg bg-base-300 flex items-center justify-center shrink-0">
                            <Film size={22} className="text-base-content/30" />
                        </div>
                    )}
                    <div className="min-w-0">
                        <div className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-warning mb-1.5">
                            <Info size={12} /> Not available
                        </div>
                        <h3 id="nil-title" className="text-base sm:text-lg font-bold text-base-content leading-snug wrap-break-word">
                            {title}
                        </h3>
                        <p className="text-sm text-base-content/70 mt-2 leading-relaxed">
                            This {kind} isn&apos;t in your FLUX library yet, so there&apos;s no file to play. You&apos;re seeing it for reference only — details come from TMDB.
                        </p>
                    </div>
                </div>

                <div className="px-5 sm:px-6 pb-5 sm:pb-6">
                    <p className="text-xs font-semibold text-base-content/50 uppercase tracking-wider mb-2">How to get it here</p>
                    <ol className="text-[13px] text-base-content/70 space-y-1.5 list-decimal pl-4 marker:text-base-content/35">
                        <li>Put the {kind} file in a folder your server already scans, or add its folder under Settings → Library.</li>
                        <li>Let FLUX rescan. It matches by file name, so keep the title and year in it.</li>
                        <li>Come back — this page will switch to the Play button.</li>
                    </ol>

                    <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-5">
                        <button onClick={onOpenSettings} className="btn btn-sm sm:btn-md btn-ghost rounded-[999px] border border-white/10 cursor-pointer">
                            Library settings
                        </button>
                        <button onClick={onClose} className="btn btn-sm sm:btn-md btn-primary rounded-[999px] px-6 cursor-pointer">
                            Got it
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
}

// ─── Release countdown (details page) ────────────────────────────────────────
// Four equal tiles on their own row: fills the width on phones, stays compact on desktop.
function ReleaseCountdown({ t }) {
    const cells = [
        [t.d, "Days"],
        [t.h, "Hours"],
        [t.m, "Minutes"],
        [t.s, "Seconds"],
    ];
    return (
        <div className="mb-5 w-full max-w-sm sm:max-w-md" role="timer" aria-label={`Releases in ${t.d} days ${t.h} hours ${t.m} minutes`}>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-base-content/60">Releases in</p>
            <div className="grid grid-cols-4 gap-2 sm:gap-3">
                {cells.map(([v, label]) => (
                    <div key={label} className="rounded-xl border border-primary/40 bg-black/45 backdrop-blur-sm py-2.5 sm:py-3 text-center">
                        <div className={`text-2xl sm:text-3xl font-bold leading-none tabular-nums ${label === "Seconds" ? "text-primary" : "text-white"}`}>{String(v).padStart(2, "0")}</div>
                        <div className="mt-1.5 text-[9px] sm:text-[10px] font-semibold uppercase tracking-[0.12em] text-white/50">{label}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ─── Ratings section ──────────────────────────────────────────────────────────
function RatingsSection({ ratings, imdbId }) {
    if (!ratings) return null;
    const { tmdb, tmdbVotes, imdb, imdbVotes, rottenTomatoes, metascore } = ratings;
    if (!tmdb && !imdb && !rottenTomatoes && !metascore) return null;
    return (
        <section className="w-full">
            <SectionHeading icon={BarChart2}>Ratings</SectionHeading>
            <div className="flex flex-wrap gap-3">
                {tmdb != null && (
                    <div className="flex items-center gap-3 bg-base-200 rounded-xl px-4 py-3 border border-white/5 min-w-7.5rem">
                        <div className="w-8 h-8 rounded-lg bg-[#01b4e4]/15 flex items-center justify-center shrink-0">
                            <Star size={15} className="text-[#01b4e4] fill-[#01b4e4]" />
                        </div>
                        <div>
                            <p className="text-[10px] text-base-content/72 font-semibold uppercase tracking-wider">TMDB</p>
                            <p className="text-lg font-bold text-white leading-none">
                                {tmdb}
                                <span className="text-xs text-base-content/66 font-normal">/10</span>
                            </p>
                            {tmdbVotes > 0 && <p className="text-[10px] text-base-content/66 mt-0.5">{fmtVotes(tmdbVotes)} votes</p>}
                        </div>
                    </div>
                )}
                {imdb != null && (
                    <a
                        href={imdbId ? `https://www.imdb.com/title/${imdbId}` : undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 bg-base-200 rounded-xl px-4 py-3 border border-white/5 min-w-7.5rem hover:border-[#f5c518]/30 transition-colors no-underline">
                        <div className="w-8 h-8 rounded-lg bg-[#f5c518]/10 flex items-center justify-center shrink-0">
                            <span className="text-[9px] font-black text-[#f5c518] leading-none">IMDb</span>
                        </div>
                        <div>
                            <p className="text-[10px] text-base-content/72 font-semibold uppercase tracking-wider">IMDb</p>
                            <p className="text-lg font-bold text-white leading-none">
                                {imdb}
                                <span className="text-xs text-base-content/66 font-normal">/10</span>
                            </p>
                            {imdbVotes && <p className="text-[10px] text-base-content/66 mt-0.5">{fmtVotes(parseInt(imdbVotes, 10))} votes</p>}
                        </div>
                    </a>
                )}
                {rottenTomatoes && (
                    <div className="flex items-center gap-3 bg-base-200 rounded-xl px-4 py-3 border border-white/5 min-w-7.5rem">
                        <div className="w-8 h-8 rounded-lg bg-[#fa320a]/10 flex items-center justify-center shrink-0 text-base leading-none">🍅</div>
                        <div>
                            <p className="text-[10px] text-base-content/72 font-semibold uppercase tracking-wider">Tomatometer</p>
                            <p className="text-lg font-bold text-white leading-none">{rottenTomatoes}</p>
                        </div>
                    </div>
                )}
                {metascore != null && (
                    <div className="flex items-center gap-3 bg-base-200 rounded-xl px-4 py-3 border border-white/5 min-w-7.5rem">
                        <div
                            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                            style={{ background: metascore >= 61 ? "rgba(54,135,22,0.18)" : metascore >= 40 ? "rgba(255,178,0,0.18)" : "rgba(220,38,38,0.18)" }}>
                            <span className="text-xs font-black" style={{ color: metascore >= 61 ? "#4ade80" : metascore >= 40 ? "#fbbf24" : "#f87171" }}>
                                {metascore}
                            </span>
                        </div>
                        <div>
                            <p className="text-[10px] text-base-content/72 font-semibold uppercase tracking-wider">Metascore</p>
                            <p className="text-lg font-bold text-white leading-none">
                                {metascore}
                                <span className="text-xs text-base-content/66 font-normal">/100</span>
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}

// ─── Production companies section ─────────────────────────────────────────────
// Quiet logo gallery — clean landscape card, logo plate + name + country.
// No modal, no click behavior — just a plain informational display.
function ProductionCompanyCard({ c }) {
    const flag = flagEmoji(c.originCountry);

    return (
        <div className="flex items-start gap-3 bg-base-200 rounded-xl border border-white/5 px-3.5 py-3 w-40 sm:w-44 shrink-0">
            <div className="w-12 h-9 rounded-md bg-white/95 ring-1 ring-black/5 flex items-center justify-center shrink-0 p-1 mt-0.5">
                {c.logo ? <img src={c.logo} alt={c.name} className="w-full h-full object-contain" loading="lazy" /> : <Clapperboard size={16} className="text-base-content/35" />}
            </div>
            <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold text-base-content/90 leading-snug line-clamp-2">{c.name}</p>
                {(flag || c.originCountry) && (
                    <p className="text-[10px] text-base-content/50 mt-1">
                        {flag ? `${flag} ` : ""}
                        {c.originCountry}
                    </p>
                )}
            </div>
        </div>
    );
}

// Responsive: below the `sm` breakpoint (phones) this is a horizontal-scroll
// row with the scrollbar hidden (this app's global index.css already hides
// scrollbars everywhere, plus the inline style below as a safety net); from
// `sm:` up it switches to a normal wrapping grid instead of scrolling.
function ProductionCompaniesSection({ companies }) {
    if (!companies?.length) return null;
    return (
        <section className="w-full">
            <SectionHeading icon={Clapperboard}>Production</SectionHeading>
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 sm:flex-wrap sm:overflow-x-visible sm:mx-0 sm:px-0 sm:pb-0" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                {companies.map((c) => (
                    <ProductionCompanyCard key={c.tmdbCompanyId} c={c} />
                ))}
            </div>
        </section>
    );
}

// ─── Reviews section ──────────────────────────────────────────────────────────
// Fetches each review by ID from TMDB and shows full cards like Plex/reference UI
const Profile_IMG = "https://image.tmdb.org/t/p/w45";

function StarRating({ rating, max = 10 }) {
    // TMDB ratings are /10, display as /5 stars
    const stars = rating != null ? Math.round((rating / max) * 5) : null;
    if (stars == null) return null;
    return (
        <div className="flex items-center gap-0.5">
            {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} size={13} className={i < stars ? "text-warning fill-warning" : "text-base-content/58 fill-base-content/45"} />
            ))}
        </div>
    );
}

// ─── Trailers & Extras ────────────────────────────────────────────────────────
function TrailersSection({ videos, onPlay }) {
    const scrollRef = useRef(null);
    if (!videos?.length) return null;
    const scroll = (dir) => scrollRef.current?.scrollBy({ left: dir * 360, behavior: "smooth" });
    return (
        <section className="w-full">
            <div className="flex items-center justify-between mb-3">
                <h2 className="text-base sm:text-lg font-semibold text-base-content flex items-center gap-2">
                    <PlayCircle size={18} className="text-primary" /> Trailers &amp; Extras
                </h2>
                <div className="flex gap-1">
                    <button onClick={() => scroll(-1)} className="w-7 h-7 rounded-full bg-base-300 hover:bg-base-200 flex items-center justify-center transition-colors" aria-label="Scroll left">
                        <ChevronLeft size={14} className="text-base-content/84" />
                    </button>
                    <button onClick={() => scroll(1)} className="w-7 h-7 rounded-full bg-base-300 hover:bg-base-200 flex items-center justify-center transition-colors" aria-label="Scroll right">
                        <ChevronRight size={14} className="text-base-content/84" />
                    </button>
                </div>
            </div>
            <div ref={scrollRef} className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                {videos.map((v) => (
                    <button
                        key={v.key}
                        onClick={() => onPlay(v.key)}
                        className="shrink-0 w-52 sm:w-60 group relative rounded-xl overflow-hidden bg-base-300 border border-white/5 hover:border-primary/30 transition-all hover:scale-[1.02] text-left">
                        <div className="relative aspect-video">
                            <img src={`https://img.youtube.com/vi/${v.key}/mqdefault.jpg`} alt={v.name} className="w-full h-full object-cover" loading="lazy" />
                            <div className="absolute inset-0 bg-black/35 group-hover:bg-black/15 transition-colors flex items-center justify-center">
                                <div className="w-10 h-10 rounded-full bg-black/40 group-hover:bg-primary/80 backdrop-blur-sm flex items-center justify-center transition-all group-hover:scale-110">
                                    <Play size={16} fill="white" className="text-white ml-0.5" />
                                </div>
                            </div>
                            <span className="absolute top-2 left-2 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-black/60 text-white/92">{v.type}</span>
                        </div>
                        <div className="px-3 py-2">
                            <p className="text-xs font-medium text-base-content line-clamp-2 leading-tight">{v.name}</p>
                        </div>
                    </button>
                ))}
            </div>
        </section>
    );
}

// ─── Detail cell ──────────────────────────────────────────────────────────────
function DetailCell({ label, value, icon: Icon, iconClass = "text-base-content/72", note }) {
    if (value == null || value === "") return null;
    return (
        <div className="bg-base-200 rounded-xl p-3 flex flex-col gap-1 border border-white/5 transition-all duration-200 hover:border-primary/20 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/20">
            <div className="flex items-center gap-1.5 text-xs text-base-content/76">
                {Icon && <Icon size={11} className={iconClass} />}
                {label}
            </div>
            <p className="text-sm font-semibold text-base-content leading-snug">{value}</p>
            {note && <span className="text-[10px] font-bold text-primary/80 leading-none mt-0.5">{note}</span>}
        </div>
    );
}

// ─── Episodes accordion (old SeasonsPanel style, single season) ──────────────
function EpisodesAccordion({ season, seasonNum, onPlay }) {
    const [showAll, setShowAll] = useState(false);
    const [collapsed, setCollapsed] = useState(false);
    const eps = season.episodes || [];
    const visibleEps = showAll ? eps : eps.slice(0, 5);

    return (
        <div className="bg-base-200 rounded-xl overflow-hidden border border-white/5">
            <div className="flex items-center gap-3 p-4 border-b border-white/5">
                {season.poster && <img src={season.poster} alt={season.name} className="w-10 h-14 object-cover rounded shrink-0" loading="lazy" />}
                <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-base-content">{season.name || `Season ${seasonNum}`}</h3>
                    <p className="text-xs text-base-content/80 mt-0.5">
                        {eps.length} episode{eps.length !== 1 ? "s" : ""}
                    </p>
                    {season.overview && <p className="text-xs text-base-content/72 line-clamp-2 mt-0.5">{season.overview}</p>}
                </div>
                <button
                    onClick={() => setCollapsed((v) => !v)}
                    className="shrink-0 w-7 h-7 rounded-full hover:bg-base-300 flex items-center justify-center transition-colors cursor-pointer"
                    aria-label={collapsed ? "Expand" : "Collapse"}>
                    {collapsed ? <ChevronDown size={16} className="text-base-content/72" /> : <ChevronUp size={16} className="text-base-content/72" />}
                </button>
            </div>
            {!collapsed && (
                <div className="px-2 pb-3 space-y-1 pt-1">
                    {visibleEps.map((ep) => (
                        <EpisodeRow key={ep.id || ep.episode} ep={ep} onPlay={onPlay} />
                    ))}
                    {eps.length > 5 && (
                        <button className="w-full text-xs text-primary py-2 hover:underline flex items-center justify-center gap-1 cursor-pointer" onClick={() => setShowAll((v) => !v)}>
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
}

// ─── TMDB-only titles (not in the local library) ─────────────────────────────
// ids look like "tmdb-movie-123" / "tmdb-tv-456". Person page + Known For link
// here for titles the user does not own, so the details page can still render.
const TMDB_IMG = "https://image.tmdb.org/t/p";
const TMDB_ID_RE = /^tmdb-(movie|tv)-(\d+)$/;
const KEY_CREW_JOBS = ["Director", "Writer", "Screenplay", "Story", "Creator", "Producer", "Executive Producer", "Original Music Composer", "Director of Photography"];

async function fetchTmdbItem(fullId) {
    const match = TMDB_ID_RE.exec(fullId);
    if (!match) throw new Error("Media not found");
    const [, kind, tmdbId] = match;
    const isTv = kind === "tv";

    // Server-side proxy (uses the server's tmdbFetch) — the TMDB key never ships in the bundle.
    const d = await api.get(`/api/metadata/tmdb/${kind}/${tmdbId}`).catch(() => {
        throw new Error("Media not found");
    });
    if (!d) throw new Error("Media not found");

    const title = isTv ? d.name : d.title;
    const dateIso = (isTv ? d.first_air_date : d.release_date) || null;
    const year = dateIso ? parseInt(dateIso.slice(0, 4), 10) : null;
    const rating = d.vote_average ? Math.round(d.vote_average * 10) / 10 : null;

    const cast = (d.credits?.cast || []).slice(0, 24).map((c) => ({
        name: c.name,
        character: c.character,
        photo: c.profile_path ? `${TMDB_IMG}/w185${c.profile_path}` : null,
        tmdbPersonId: c.id,
    }));
    const crew = (d.credits?.crew || [])
        .filter((c) => KEY_CREW_JOBS.includes(c.job))
        .slice(0, 16)
        .map((c) => ({
            name: c.name,
            job: c.job,
            photo: c.profile_path ? `${TMDB_IMG}/w185${c.profile_path}` : null,
            tmdbPersonId: c.id,
        }));

    const trailer = (d.videos?.results || []).find((v) => v.type === "Trailer" && v.site === "YouTube")?.key || null;

    const metadata = {
        tmdbId: d.id,
        type: isTv ? "series" : "movie",
        title,
        originalTitle: isTv ? d.original_name : d.original_title,
        year,
        releaseDate: isTv ? null : dateIso,
        firstAirDate: isTv ? dateIso : null,
        overview: d.overview || null,
        rating,
        votes: d.vote_count || 0,
        runtime: isTv ? d.episode_run_time?.[0] || null : d.runtime || null,
        genres: (d.genres || []).map((g) => g.name),
        poster: d.poster_path ? `${TMDB_IMG}/w500${d.poster_path}` : null,
        backdrop: d.backdrop_path ? `${TMDB_IMG}/w1280${d.backdrop_path}` : null,
        tagline: d.tagline || null,
        status: d.status || null,
        language: d.original_language || null,
        trailer,
        cast,
        crew,
        imdbId: d.external_ids?.imdb_id || null,
        ratings: rating != null ? { tmdb: rating } : null,
        spokenLanguages: (d.spoken_languages || []).map((l) => ({ englishName: l.english_name, name: l.name })),
        originCountries: d.origin_country || (d.production_countries || []).map((c) => c.iso_3166_1),
        collection: d.belongs_to_collection ? { name: d.belongs_to_collection.name, tmdbId: d.belongs_to_collection.id } : null,
        financials: !isTv && (d.budget || d.revenue) ? { budget: d.budget || null, revenue: d.revenue || null } : null,
        ...(isTv ? { totalSeasons: d.number_of_seasons || null, totalEpisodes: d.number_of_episodes || null } : {}),
    };

    return {
        id: fullId,
        name: title,
        title,
        type: isTv ? "series" : "movie",
        notInLibrary: true,
        parsed: { type: isTv ? "series" : "movie", title, year },
        metadata,
        // empty seasons object → treated as a series (no Play button, no episode list)
        ...(isTv ? { seasons: {} } : {}),
    };
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function MediaDetails() {
    const { id } = useParams();
    const navigate = useNavigate();

    const { getResume, movies, series, anime } = useApi();

    const [item, setItem] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [overviewExpanded, setOverviewExpanded] = useState(false);
    const [imgError, setImgError] = useState(false);
    const [resumePos, setResumePos] = useState(null);
    const [showTrailer, setShowTrailer] = useState(false);
    const [videoModalKey, setVideoModalKey] = useState(null);
    const [showNotInLibrary, setShowNotInLibrary] = useState(false);
    const [selectedSeasonNum, setSelectedSeasonNum] = useState(null);
    const episodesRef = useRef(null);

    // ── Floating action menu + Info modal ──────────────────────────────────────
    const [showActionMenu, setShowActionMenu] = useState(false);
    const [watched, setWatched] = useState(false);
    const actionBtnRef = useRef(null);
    const [shareToast, setShareToast] = useState(false);

    // id from URL is already the raw base64url string — no encode/decode needed.
    // React Router passes :id exactly as typed in the URL.
    // We used encodeURIComponent() when navigating, so decode once here.
    const decodedId = decodeURIComponent(id);

    // ── Scroll to top on every navigation ─────────────────────────────────────
    useEffect(() => {
        window.scrollTo({ top: 0, behavior: "instant" });
    }, [decodedId]);

    // ── Resolve item — context-first, network fallback ────────────────────────
    useEffect(() => {
        setImgError(false);
        setOverviewExpanded(false);

        // 1. Instant lookup from already-loaded context
        const contextItem = [...movies, ...series, ...anime].find((m) => m.id === decodedId || m.seriesKey === decodedId);
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

        // tmdb-* ids = titles from the person page that are not in the library
        const request = TMDB_ID_RE.test(decodedId) ? fetchTmdbItem(decodedId) : getMediaById(decodedId);
        request
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

    // ── Reset selected season + resume position when item changes ────────────
    // FIX (Report-23): resumePos must be cleared synchronously when decodedId
    // changes so the play button shows "Play" (not stale "Resume") during the
    // network round-trip for the new item's history entry.
    useEffect(() => {
        setSelectedSeasonNum(null);
        setResumePos(null);
    }, [decodedId]);
    useEffect(() => {
        if (!item || item.seasons || item.notInLibrary) return;
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

    // Not-in-library titles that are still unreleased show a countdown in place of the "Not in library" button.
    // When it reaches zero (and the title still isn't in the library) the button takes over.
    const upcomingIso = item?.notInLibrary ? m?.releaseDate || m?.firstAirDate || null : null;
    const releaseCountdown = useCountdown(upcomingIso);
    const isUpcoming = Boolean(releaseCountdown && !releaseCountdown.done);
    const seasons = isSeries ? item?.seasons : null;

    // ── Selected season logic ──────────────────────────────────────────────────
    const seasonEntries = seasons ? Object.entries(seasons).sort(([a], [b]) => Number(a) - Number(b)) : [];
    const baseActiveSeason = selectedSeasonNum != null && seasons ? seasons[selectedSeasonNum] : null;

    // ── Lazy season refresh (metadata upgrade, feature 10) ──────────────────────
    // baseActiveSeason is whatever grouper.js cached at scan time (untouched —
    // standing constraint, grouper.js is never modified). If that season came
    // back with zero episodes (TMDB miss at scan time, or a season TMDB added
    // since), auto-fetch it here via the new on-demand endpoint. A manual
    // refresh button (below, in the Episodes section) can also trigger this
    // for any season, not just empty ones.
    const seasonNeedsAutoRefresh = Boolean(baseActiveSeason && (!baseActiveSeason.episodes || baseActiveSeason.episodes.length === 0));
    const {
        data: freshSeasonData,
        refetch: refetchSeason,
        isFetching: seasonRefreshing,
    } = useSeasonDetail(m?.tmdbId, selectedSeasonNum, { enabled: Boolean(m?.tmdbId && selectedSeasonNum != null && seasonNeedsAutoRefresh) });

    // Merge: file-backed episodes (id/streamUrl/size) always come from
    // baseActiveSeason and are NEVER overwritten — only TMDB-side fields
    // (title/overview/airDate/runtime/still/rating) get refreshed per episode
    // number. If baseActiveSeason had no episodes at all, the fresh TMDB
    // episode list is shown as-is (informational — nothing to play yet, but
    // at least the season isn't a dead end).
    const activeSeason = useMemo(() => {
        const fresh = freshSeasonData?.season;
        if (!fresh) return baseActiveSeason;
        if (!baseActiveSeason) return fresh;
        const freshByEp = new Map((fresh.episodes || []).map((e) => [e.episode, e]));
        const hasBaseEpisodes = (baseActiveSeason.episodes || []).length > 0;
        const mergedEpisodes = hasBaseEpisodes
            ? baseActiveSeason.episodes.map((ep) => {
                  const f = freshByEp.get(ep.episode);
                  return f ? { ...ep, title: f.title, overview: f.overview, airDate: f.airDate, runtime: f.runtime, still: f.still, rating: f.rating } : ep;
              })
            : fresh.episodes || [];
        return {
            ...baseActiveSeason,
            name: fresh.name || baseActiveSeason.name,
            overview: fresh.overview || baseActiveSeason.overview,
            poster: fresh.poster || baseActiveSeason.poster,
            episodeCount: mergedEpisodes.length,
            episodes: mergedEpisodes,
        };
    }, [baseActiveSeason, freshSeasonData]);

    // Hero values — override with season data when a season is selected
    const title = activeSeason ? activeSeason.name || `Season ${selectedSeasonNum}` : m?.title || item?.title || item?.name || "Unknown";
    const originalTitle = !activeSeason && m?.originalTitle !== (m?.title || item?.title || item?.name || "Unknown") ? m?.originalTitle : null;
    const overview = activeSeason ? activeSeason.overview || m?.overview : m?.overview;
    const poster = activeSeason ? activeSeason.poster || m?.poster : m?.poster;
    const backdrop = m?.backdrop;
    const year = m?.year;
    const rating = m?.rating;

    const releaseIso = m?.releaseDate || m?.firstAirDate || null;
    const releaseDateFmt = fmtDate(releaseIso);
    const releaseDateLabel = m?.firstAirDate ? "First Aired" : "Released";
    const runtime = fmtRuntime(m?.runtime);
    const genres = m?.genres || item?.category || [];
    const cast = m?.cast || [];
    const crew = m?.crew || [];
    const trailerKey = m?.trailer;
    const tagline = m?.tagline;
    const partNum = !isSeries ? (item?.parsed?.part ?? null) : null;

    // ── certification (age rating) + production companies ────────────────────
    // certifications shape from backend: { "US": [{certification, meaning,
    // order}], "GB": [...], ... } — prefer US, fall back to whichever
    // country actually has data (matches backend's own default preference).
    const allCertifications = m?.certifications && typeof m.certifications === "object" ? m.certifications : null;
    const certification = useMemo(() => {
        if (!allCertifications) return null;
        return allCertifications.US?.[0] ?? Object.values(allCertifications)[0]?.[0] ?? null;
    }, [allCertifications]);
    const productionCompanies = Array.isArray(m?.production_companies) ? m.production_companies : [];

    // ── New: ratings / reviews / videos ───────────────────────────────────────
    const ratings = m?.ratings ?? null;
    const imdbId = m?.imdbId ?? null;
    const reviews = Array.isArray(m?.reviews) ? m.reviews : [];
    const videos = Array.isArray(m?.videos) ? m.videos : [];

    // ── New (metadata upgrade, v18/v19): languages, origin, collection,
    // financials, episode schedule — all optional, all null/[]-safe.
    const spokenLanguages = Array.isArray(m?.spokenLanguages) ? m.spokenLanguages : [];
    const originCountries = Array.isArray(m?.originCountries) ? m.originCountries : [];
    const collection = m?.collection ?? null;
    const financials = m?.financials ?? null;
    const episodeSchedule = m?.episodeSchedule ?? null;

    const overviewLong = overview && overview.length > 220;

    const parsedLangs = item?.parsed?.languages;
    const isDualAudio = item?.parsed?.dualAudio || item?.parsed?.multiAudio || (parsedLangs && parsedLangs.length > 1);
    const isMultiAudio = item?.parsed?.multiAudio || (parsedLangs && parsedLangs.length > 2);
    const audioLabel = isDualAudio ? (isMultiAudio ? "Multi Audio" : "Dual Audio") : null;
    const primaryLangDisplay = parsedLangs?.length > 0 ? parsedLangs.map(langName).join(" / ") : langName(m?.language);
    const heroLang = langName(m?.language);

    // relatedParts (franchise-title-heuristic "More X" row) removed — superseded
    // by the Collection section in RelatedSections.jsx, which matches via the
    // real metadata.collection.tmdbId (already fetched by tmdb.js) instead of
    // guessing from the title string. Falls back to the same text heuristic
    // internally when a title has no TMDB-linked collection, so no matching
    // capability was lost, just relocated + made more accurate.

    // ── Handlers ───────────────────────────────────────────────────────────────

    /**
     * handlePlayMovie — navigates to the player with the movie's file ID.
     *
     * BUG FIX: was navigating to `/stream/${id}` which is a backend URL,
     * not a React Router route. Corrected to `/player/:id`.
     *
     * The ID is already a base64url string (URL-safe). We still wrap it in
     * encodeURIComponent so React Router gets a clean single-segment param.
     */
    const handlePlayMovie = () => {
        navigate(`/player/${encodeURIComponent(decodedId)}`, {
            state: resumePos != null ? { knownResumePosition: resumePos } : undefined,
        });
    };

    /**
     * handlePlayEpisode — navigates to the player with a specific episode file ID.
     * Called from EpisodeRow inside the SeasonsPanel.
     */
    const handlePlayEpisode = (epId) => {
        navigate(`/player/${encodeURIComponent(epId)}`);
    };

    /**
     * handleSeasonSelect — selects a season, updates hero, scrolls to episodes
     */
    const handleSeasonSelect = (seasonNum) => {
        setSelectedSeasonNum(seasonNum);
        setTimeout(() => {
            episodesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 50);
    };

    // Movies: the file itself. Series: prefer the currently open episode,
    // else fall back to the first episode of the first season — mediaInfo
    // (ffprobe) is only ever recorded per-file, never per-series.
    const infoTargetId = item?.notInLibrary ? null : !isSeries ? decodedId : ((activeSeason?.episodes || seasonEntries[0]?.[1]?.episodes || [])[0]?.id ?? null);

    if (loading) return <MediaDetailsSkeleton />;

    // ── Error ──────────────────────────────────────────────────────────────────
    if (error || !item) {
        return (
            <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
                {isSeries ? <Tv size={48} className="text-base-content/58" /> : <Film size={48} className="text-base-content/58" />}
                <p className="text-base-content/80">Media not found</p>
            </div>
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    return (
        <div className="min-h-screen -m-4 sm:-m-6 lg:-m-8">
            {/* ── Backdrop + Hero ──────────────────────────────────────────── */}
            <div className="relative">
                {/* Backdrop */}
                <div className="absolute inset-x-0 top-0 h-[42vh] min-h-[280px] max-h-[520px] sm:h-[48vh] sm:max-h-[560px] pointer-events-none" style={{ zIndex: 0 }}>
                    {backdrop && !imgError ? (
                        <img src={backdrop} alt={title} className="w-full h-full object-cover object-top" onError={() => setImgError(true)} />
                    ) : (
                        <div className="w-full h-full bg-linear-to-br from-primary/20 via-base-300 to-base-200" />
                    )}
                    <div className="absolute inset-0 bg-linear-to-t from-base-100 via-base-100/75 to-transparent" />
                    <div className="absolute inset-0 bg-linear-to-r from-base-100/95 via-base-100/40 to-transparent hidden sm:block" />
                </div>

                {/* Hero content */}
                <div className="relative px-4 sm:px-6 md:px-8 lg:px-12 pt-6 sm:pt-10 pb-8" style={{ zIndex: 1 }}>
                    <div className="flex flex-col sm:flex-row gap-5 sm:gap-8 max-w-6xl">
                        {/* ── Poster ──────────────────────────────────────── */}
                        <div className="shrink-0 mx-auto sm:mx-0 w-32 xs:w-36 sm:w-44 md:w-52 lg:w-56">
                            <div className="aspect-2/3 rounded-2xl overflow-hidden shadow-2xl bg-base-300 transition-transform duration-300">
                                {poster ? (
                                    <img src={poster} alt={title} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                        {isSeries ? <Tv size={40} className="text-base-content/58" /> : <Film size={40} className="text-base-content/58" />}
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
                                            <span className="text-xs text-base-content/72">/ 10</span>
                                        </div>
                                        {m?.votes && <span className="text-[10px] text-base-content/66">{fmtVotes(m.votes)} votes</span>}
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
                                {m?.status && <Badge className="bg-base-300 text-base-content/82">{m.status}</Badge>}
                                {certification && (
                                    <Badge className="bg-base-300 text-base-content/82 border border-white/10" title={certification.meaning || undefined}>
                                        <Award size={11} /> {certification.certification}
                                    </Badge>
                                )}
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
                            {activeSeason && (
                                <button onClick={() => setSelectedSeasonNum(null)} className="text-xs text-base-content/72 hover:text-primary transition-colors mb-1 flex items-center gap-1">
                                    <ChevronLeft size={12} />
                                    {m?.title || item?.title || item?.name}
                                </button>
                            )}
                            <h1 className="text-2xl sm:text-3xl lg:text-4xl xl:text-[2.75rem] font-bold text-white leading-tight mb-1 tracking-tight">
                                {activeSeason ? (
                                    <>
                                        {m?.title || item?.title || item?.name} <span className="text-white/75">({activeSeason.name || `Season ${selectedSeasonNum}`})</span>
                                    </>
                                ) : (
                                    title
                                )}
                            </h1>
                            {originalTitle && <p className="text-xs text-base-content/66 mb-2 font-medium">{originalTitle}</p>}
                            {tagline && <p className="text-sm text-base-content/80 italic mb-3">{tagline}</p>}

                            {/* Meta row */}
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-3 text-sm text-base-content/86">
                                {(releaseDateFmt || year) && (
                                    <span className="flex items-center gap-1">
                                        <Calendar size={13} className="shrink-0 text-base-content/72" />
                                        {releaseDateFmt ?? year}
                                    </span>
                                )}
                                {runtime && (
                                    <span className="flex items-center gap-1">
                                        <Clock size={13} className="shrink-0 text-base-content/72" />
                                        {runtime}
                                    </span>
                                )}
                                {heroLang && (
                                    <span className="flex items-center gap-1">
                                        <Globe size={13} className="shrink-0 text-base-content/72" />
                                        {heroLang}
                                    </span>
                                )}
                                {isSeries && m?.totalSeasons && (
                                    <span className="flex items-center gap-1">
                                        <Tv size={13} className="shrink-0 text-base-content/72" />
                                        {m.totalSeasons} {m.totalSeasons === 1 ? "season" : "seasons"}
                                        {m?.totalEpisodes && ` · ${m.totalEpisodes} episodes`}
                                    </span>
                                )}
                            </div>

                            {/* Inline rating badges — IMDb / RT / TMDB */}
                            {ratings && (ratings.tmdb != null || ratings.imdb != null || ratings.rottenTomatoes) && (
                                <div className="flex flex-wrap items-center gap-2 mb-3">
                                    {ratings.imdb != null && (
                                        <div className="flex items-center gap-1.5 px-2.5 py-1 no-underline transition-colors">
                                            <img src={assets.imdbIcon} className="w-6" alt="IMDb Icon" />
                                            <span className="text-xs md:text-[0.8rem] font-bold text-[#f5c518]">{ratings.imdb}</span>
                                        </div>
                                    )}
                                    {ratings.rottenTomatoes && (
                                        <div className="flex items-center gap-1.5 px-2.5 py-1">
                                            <img src={assets.rottenTomatoes} className="w-4.5" alt="Rotten Tomatoes Icon" />
                                            <span className="text-xs md:text-[0.8rem] font-bold text-[#fa320a]">{ratings.rottenTomatoes}</span>
                                        </div>
                                    )}
                                    {ratings.tmdb != null && (
                                        <div className="flex items-center gap-1.5 rounded-full px-2.5 py-1">
                                            <img src={assets.tmdbIcon} className="w-6" alt="TMDB Icon" />
                                            <span className="text-xs md:text-[0.8rem] font-bold text-[#01b4e4]">{ratings.tmdb}</span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Genre tags */}
                            {genres.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 mb-5">
                                    {genres.map((g) => (
                                        <Link
                                            key={g}
                                            to={`/category/${encodeURIComponent(g)}`}
                                            className="text-xs font-medium px-2.5 py-0.5 rounded-md bg-base-300 text-base-content/86 border border-white/5 hover:border-primary/40 hover:text-primary transition-colors">
                                            {g}
                                        </Link>
                                    ))}
                                </div>
                            )}

                            {/* Upcoming + not in library → release countdown, on its own row above the buttons */}
                            {item.notInLibrary && isUpcoming && <ReleaseCountdown t={releaseCountdown} />}

                            {/* Action buttons */}
                            <div className="flex flex-nowrap items-center gap-2 mb-5 overflow-x-auto -mx-1 px-1 pb-1" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                                {/* Not in library — replaces Play for titles opened from the person page (once released) */}
                                {item.notInLibrary && !isUpcoming && (
                                    <button
                                        onClick={() => setShowNotInLibrary(true)}
                                        className="btn btn-sm sm:btn-md gap-2 px-6 rounded-[999px] shrink-0 border border-white/10 bg-base-300 text-base-content/80 hover:bg-base-200 hover:border-white/25 cursor-pointer"
                                        aria-haspopup="dialog">
                                        <Info size={16} />
                                        Not in library
                                    </button>
                                )}

                                {/* Play button — movies only (series use the episode list below) */}
                                {!isSeries && !item.notInLibrary && (
                                    <button
                                        onClick={handlePlayMovie}
                                        className="btn btn-primary btn-sm sm:btn-md gap-2 px-6 rounded-[999px] border-none shadow-lg shadow-primary/25 hover:shadow-primary/40 hover:scale-[1.03] transition-all shrink-0">
                                        <Play size={16} fill="currentColor" />
                                        {resumePos ? "Resume" : "Play"}
                                    </button>
                                )}

                                {trailerKey && (
                                    <button onClick={() => setShowTrailer(true)} className="btn btn-sm sm:btn-md btn-outline gap-2 rounded-[999px] shrink-0">
                                        <Play size={14} /> Trailer
                                    </button>
                                )}

                                <button
                                    ref={actionBtnRef}
                                    onClick={() => setShowActionMenu((v) => !v)}
                                    className={`btn btn-sm sm:btn-md btn-circle btn-outline shrink-0 transition-colors cursor-pointer ${showActionMenu ? "text-primary border-primary bg-primary/10" : "text-base-content/84"}`}
                                    title="More options"
                                    aria-haspopup="menu"
                                    aria-expanded={showActionMenu}>
                                    <MoreVertical size={17} />
                                </button>
                            </div>

                            {/* Overview — always full, toggle only if > 500 chars */}
                            {overview && (
                                <div>
                                    <p className="text-sm sm:text-base text-base-content/88 leading-relaxed">{overview}</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Page body ────────────────────────────────────────────────── */}
            <div className="space-y-8 px-4 sm:px-8 lg:px-12 pb-20">
                {/* ── Seasons (card grid using MediaCard) ──────────────────── */}
                {isSeries && seasonEntries.length > 0 && (
                    <section className="w-full">
                        <SectionHeading icon={Tv}>
                            Seasons
                            <span className="ml-1 text-sm font-normal text-base-content/72">({seasonEntries.length})</span>
                        </SectionHeading>
                        <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                            {seasonEntries.map(([num, season]) => {
                                const seriesTitle = m?.title || item?.title || item?.name || "Unknown";
                                const seasonName = season.name || `Season ${num}`;
                                // Shape season into a fake item MediaCard can normalise
                                const fakeItem = {
                                    id: `season-${num}`,
                                    type: "series",
                                    title: `${seriesTitle} (${seasonName})`,
                                    metadata: {
                                        title: `${seriesTitle} (${seasonName})`,
                                        poster: season.poster || m?.poster || null,
                                        year: m?.year ?? null,
                                        rating: null,
                                    },
                                    seasons: true, // triggers series branch in normalise
                                };
                                return (
                                    <div
                                        key={num}
                                        className="shrink-0 relative cursor-pointer"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            handleSeasonSelect(num);
                                        }}>
                                        {/* Capture all child clicks to prevent MediaCard navigation */}
                                        <div className="pointer-events-none">
                                            <MediaCard item={fakeItem} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                )}

                {/* ── Episode schedule (metadata upgrade, v18) ────────────────── */}
                {isSeries && episodeSchedule && (episodeSchedule.nextEpisode || episodeSchedule.lastAirDate) && (
                    <section className="w-full">
                        <SectionHeading icon={CalendarClock}>Episode Schedule</SectionHeading>
                        {episodeSchedule.nextEpisode ? (
                            <div className="bg-base-200 rounded-xl border border-white/5 px-4 py-3.5 flex items-center gap-3">
                                <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                                    <CalendarClock size={18} className="text-primary" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-base-content">
                                        S{String(episodeSchedule.nextEpisode.season).padStart(2, "0")}E{String(episodeSchedule.nextEpisode.episode).padStart(2, "0")} ·{" "}
                                        {episodeSchedule.nextEpisode.name}
                                    </p>
                                    <p className="text-xs text-base-content/66 mt-0.5">Airs {fmtDate(episodeSchedule.nextEpisode.airDate) || episodeSchedule.nextEpisode.airDate}</p>
                                </div>
                            </div>
                        ) : (
                            <div className="bg-base-200 rounded-xl border border-white/5 px-4 py-3.5 text-sm text-base-content/70">
                                {m?.status === "Ended" || m?.status === "Canceled" ? "Series complete" : "No upcoming episode scheduled"}
                            </div>
                        )}
                    </section>
                )}

                {/* ── Episodes accordion (shown only after a season is selected) */}
                {isSeries && activeSeason && (
                    <section ref={episodesRef} className="w-full scroll-mt-20">
                        <div className="flex items-center justify-between gap-3 mb-3">
                            <SectionHeading icon={Clapperboard}>
                                {m?.title || item?.title || item?.name} <span className="font-normal text-primary">[{activeSeason.name || `Season ${selectedSeasonNum}`}]</span>
                                <span className="ml-1 text-sm font-normal text-base-content/72">· {(activeSeason.episodes || []).length} ep</span>
                            </SectionHeading>
                            {m?.tmdbId && (
                                <button
                                    onClick={() => refetchSeason()}
                                    disabled={seasonRefreshing}
                                    title="Re-fetch this season's TMDB data"
                                    className="shrink-0 flex items-center gap-1.5 text-xs font-medium text-base-content/60 hover:text-primary disabled:opacity-50 transition-colors cursor-pointer px-2 py-1 rounded-lg hover:bg-white/5">
                                    <RefreshCw size={13} className={seasonRefreshing ? "animate-spin" : ""} />
                                    {seasonRefreshing ? "Refreshing…" : "Refresh"}
                                </button>
                            )}
                        </div>
                        <EpisodesAccordion season={activeSeason} seasonNum={selectedSeasonNum} onPlay={handlePlayEpisode} />
                    </section>
                )}

                {/* cast and crew */}

                <CastAndCrew metadata={item.notInLibrary ? m : undefined} />

                {/* ── Reviews ──────────────────────────────────────────────── */}
                {reviews.length > 0 && (
                    <>
                        <Divider />
                        <Reviews reviews={reviews} tmdbId={m?.tmdbId} mediaType={mediaType} />
                    </>
                )}

                {/* ── Trailers & Extras ─────────────────────────────────────── */}
                {videos.length > 0 && (
                    <>
                        <Divider />
                        <TrailersSection videos={videos} onPlay={(key) => setVideoModalKey(key)} />
                    </>
                )}

                {/* ── Production companies ──────────────────────────────────── */}
                {productionCompanies.length > 0 && (
                    <>
                        <Divider />
                        <ProductionCompaniesSection companies={productionCompanies} />
                    </>
                )}

                <Divider />

                {/* ── Details grid ─────────────────────────────────────────── */}
                {m && (
                    <section className="w-full">
                        <SectionHeading icon={Info}>Details</SectionHeading>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                            <DetailCell icon={Calendar} iconClass="text-blue-400" label={releaseDateLabel} value={releaseDateFmt || (year ? String(year) : null)} />
                            <DetailCell icon={Globe} iconClass="text-emerald-400" label="Language" value={primaryLangDisplay} note={audioLabel} />
                            <DetailCell icon={Clock} iconClass="text-orange-400" label="Runtime" value={runtime} />
                            <DetailCell icon={Star} iconClass="text-warning" label="Rating" value={rating != null ? `${rating} / 10` : null} />
                            <DetailCell icon={Hash} iconClass="text-violet-400" label="Votes" value={m.votes ? m.votes.toLocaleString() : null} />
                            <DetailCell icon={Award} iconClass="text-pink-400" label="Status" value={m.status} />
                            {partNum != null && <DetailCell icon={Layers} iconClass="text-secondary" label="Part" value={`Part ${partNum}`} />}
                            {isSeries && <DetailCell icon={Tv} iconClass="text-accent" label="Seasons" value={m.totalSeasons} />}
                            {isSeries && <DetailCell icon={Clapperboard} iconClass="text-primary" label="Episodes" value={m.totalEpisodes} />}
                            <DetailCell
                                icon={Languages}
                                iconClass="text-cyan-400"
                                label="Spoken Languages"
                                value={
                                    spokenLanguages.length
                                        ? spokenLanguages
                                              .map((l) => l.englishName || l.name)
                                              .filter(Boolean)
                                              .join(" · ")
                                        : null
                                }
                            />
                            <DetailCell
                                icon={MapPin}
                                iconClass="text-rose-400"
                                label="Origin"
                                value={originCountries.length ? originCountries.map((cc) => `${flagEmoji(cc) ? flagEmoji(cc) + " " : ""}${cc}`).join(" · ") : null}
                            />
                            <DetailCell icon={DollarSign} iconClass="text-green-400" label="Budget (USD)" value={fmtCurrency(financials?.budget)} />
                            <DetailCell icon={DollarSign} iconClass="text-lime-400" label="Revenue (USD)" value={fmtCurrency(financials?.revenue)} />
                            <DetailCell
                                icon={Layers}
                                iconClass="text-indigo-400"
                                label="Collection"
                                value={collection?.name && collection.name.trim().toLowerCase() !== (title || "").trim().toLowerCase() ? collection.name : null}
                            />
                        </div>
                    </section>
                )}

                <Divider />

                {/* ── Similar media ─────────────────────────────────────────── */}
                <RelatedSections currentId={decodedId} genres={genres} mediaType={mediaType} />
            </div>

            {/* ── Trailer modal ─────────────────────────────────────────────── */}
            {showTrailer && trailerKey && <TrailerModal trailerKey={trailerKey} onClose={() => setShowTrailer(false)} />}
            {videoModalKey && <TrailerModal trailerKey={videoModalKey} onClose={() => setVideoModalKey(null)} />}
            {showNotInLibrary && (
                <NotInLibraryModal
                    title={title}
                    poster={poster}
                    isSeries={isSeries}
                    onClose={() => setShowNotInLibrary(false)}
                    onOpenSettings={() => {
                        setShowNotInLibrary(false);
                        navigate("/settings");
                    }}
                />
            )}

            {/* ── Floating 3-dot menu — same component/design/items as MediaCard & HistoryCard ── */}
            <FloatingActionMenu
                open={showActionMenu}
                anchorRef={actionBtnRef}
                onClose={() => setShowActionMenu(false)}
                media={{ id: decodedId, title, poster, type: mediaType }}
                watched={watched}
                onToggleWatched={() => setWatched((v) => !v)}
                infoId={infoTargetId}
                onCopyFallback={() => {
                    setShareToast(true);
                    setTimeout(() => setShareToast(false), 2200);
                }}
            />

            {/* ── Share toast (clipboard fallback confirmation) ──────────────── */}
            {shareToast && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-100 flex items-center gap-2 px-4 py-2.5 rounded-full bg-[oklch(15%_0.01_260/0.97)] backdrop-blur-md shadow-2xl border border-white/10">
                    <Link2 size={14} className="text-primary shrink-0" />
                    <span className="text-xs font-medium text-white/92">Link copied to clipboard</span>
                </div>
            )}
        </div>
    );
}
