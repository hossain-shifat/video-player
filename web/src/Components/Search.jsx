import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router";
import { Search as SearchIcon, X, Film, Tv, Loader2, Star, ArrowLeft, Sparkles } from "lucide-react";
import { useApi } from "../Context/apiContext";

// ─── Type resolver ────────────────────────────────────────────────────────────
// Source of truth priority: metadata.type > parsed.type > explicit bucket
// Never trust a hardcoded fallback — always prefer what the server gave us.
function resolveType(item, bucketType) {
    const mt = item.metadata?.type;
    const pt = item.parsed?.type;
    // "series" and "anime" are strong signals — never downgrade to "movie"
    if (mt === "series" || mt === "anime") return mt;
    if (pt === "series" || pt === "anime") return pt;
    // movie signals
    if (mt === "movie" || pt === "movie") return "movie";
    // fall back to the bucket the caller placed it in
    return bucketType;
}

// ─── Scorer ───────────────────────────────────────────────────────────────────
// Returns 0-100. Checks both TMDB title AND raw filename.
function scoreTitle(text, query) {
    if (!text || !query) return 0;
    const t = text.toLowerCase().trim();
    const q = query.toLowerCase().trim();
    if (!t || !q) return 0;

    if (t === q) return 100;
    if (t.startsWith(q)) return 85;

    const words = q.split(/\s+/).filter(Boolean);

    // All query words at word boundaries
    const allBoundary = words.every((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(t));
    if (allBoundary && words.length > 1) return 70;
    if (allBoundary) return 65;

    // All words contained
    if (words.every((w) => t.includes(w))) return 50;

    // Some words contained
    const hitCount = words.filter((w) => t.includes(w)).length;
    if (hitCount > 0) return Math.round(30 * (hitCount / words.length));

    // Fuzzy char sequence (only for 3+ char queries)
    if (q.length >= 3) {
        const chars = q.replace(/\s/g, "").split("");
        let ti = 0,
            matched = 0;
        for (const ch of chars) {
            while (ti < t.length && t[ti] !== ch) ti++;
            if (ti < t.length) {
                matched++;
                ti++;
            }
        }
        if (matched === chars.length) return 10;
    }

    return 0;
}

// ─── Search-upgrade: metadata-aware scoring ───────────────────────────────────
// Centralized normalization — replaces scattered .toLowerCase().trim() calls.
function normalize(str) {
    return (str || "").toLowerCase().trim().replace(/\s+/g, " ");
}

// Ranking order (per search audit): title tiers (scoreTitle, above) always
// win first. Below that: collection/people/company/network/genre/keyword.
// Below THAT: overview/language/country/certification. External IDs are a
// precise lookup, not fuzzy text, so they get their own near-top tier and
// skip the "reason" caption (an ID match is self-explanatory).
const SECONDARY_CAP = 45;
const TERTIARY_CAP = 22;
const EXTERNAL_ID_SCORE = 92;

function matchExternalId(metadata, qn) {
    if (!metadata || !qn) return null;
    const ext = metadata.externalIds;
    const candidates = [ext?.imdb, ext?.tmdb, ext?.wikidata, metadata.imdbId].filter(Boolean).map((v) => normalize(String(v)));
    return candidates.includes(qn) ? { score: EXTERNAL_ID_SCORE, reason: null } : null;
}

// Returns the first matching field as { score, reason } for the "Matched: X"
// caption, or null. Keywords are handled defensively (object OR bare string)
// per the audit — never assume the shape. originCountries/certifications use
// exact match (short codes like "US"/"PG-13" — .includes() would false-hit
// on single letters).
function matchSecondaryFields(metadata, qn) {
    if (!metadata || !qn) return null;

    const people = [...(metadata.cast || []).flatMap((c) => [c?.name, c?.character]), ...(metadata.crew || []).map((c) => c?.name)].filter(Boolean);
    for (const v of people) if (normalize(v).includes(qn)) return { score: SECONDARY_CAP, reason: v };

    if (metadata.collection?.name && normalize(metadata.collection.name).includes(qn)) {
        return { score: SECONDARY_CAP, reason: metadata.collection.name };
    }
    for (const p of metadata.production_companies || []) if (p?.name && normalize(p.name).includes(qn)) return { score: SECONDARY_CAP, reason: p.name };
    for (const n of metadata.networks || []) if (n?.name && normalize(n.name).includes(qn)) return { score: SECONDARY_CAP, reason: n.name };
    for (const g of metadata.genres || []) if (normalize(g).includes(qn)) return { score: SECONDARY_CAP, reason: g };
    for (const k of metadata.keywords || []) {
        const name = typeof k === "string" ? k : k?.name;
        if (name && normalize(name).includes(qn)) return { score: SECONDARY_CAP, reason: name };
    }

    if (qn.length >= 3 && normalize(metadata.overview).includes(qn)) return { score: TERTIARY_CAP, reason: null };
    for (const l of metadata.spokenLanguages || []) {
        for (const v of [l?.name, l?.englishName, l?.code]) if (v && normalize(v).includes(qn)) return { score: TERTIARY_CAP, reason: v };
    }
    for (const cc of metadata.originCountries || []) if (normalize(cc) === qn) return { score: TERTIARY_CAP, reason: cc };
    for (const certs of Object.values(metadata.certifications || {})) {
        for (const c of certs || []) if (c?.certification && normalize(c.certification) === qn) return { score: TERTIARY_CAP, reason: c.certification };
    }

    return null;
}

// Score an item against query — title/filename first (always wins if decent,
// per ranking order), only falls through to secondary/tertiary metadata scan
// when title itself doesn't already score well. This is also the perf guard:
// a clean title hit skips scanning cast/crew/keywords entirely.
function scoreItem(item, query) {
    const qn = normalize(query);
    const tmdbTitle = item.metadata?.title || "";
    const rawName = item.name || item.title || item.parsed?.title || "";
    const titleScore = Math.max(scoreTitle(tmdbTitle, query), scoreTitle(rawName, query));

    if (titleScore >= 65) return { score: titleScore, reason: null };

    const idHit = matchExternalId(item.metadata, qn);
    if (idHit && idHit.score > titleScore) return idHit;

    const secondaryHit = matchSecondaryFields(item.metadata, qn);
    if (secondaryHit && secondaryHit.score > titleScore) return secondaryHit;

    return { score: titleScore, reason: null };
}

// ─── Rank + dedupe results from context state ─────────────────────────────────
// movies/series/anime come from apiContext — already grouped by server.
// series items have: { seriesKey, title, metadata, seasons, ... }
// movie items have:  { id, name, parsed, metadata, ... }
function rankResults(movies, series, anime, query) {
    const q = query.trim();
    if (!q) return [];

    const candidates = [];

    // Movies bucket
    for (const m of movies) {
        const type = resolveType(m, "movie");
        // If server grouped it as movie but parsed says series/anime — skip,
        // it will appear in the correct bucket
        if (type !== "movie") continue;
        const { score: sc, reason } = scoreItem(m, q);
        if (sc > 0) {
            const title = m.metadata?.title || m.parsed?.title || m.name || "";
            candidates.push({ ...m, _type: "movie", _displayTitle: title, _score: sc, _matchReason: reason });
        }
    }

    // Series bucket — grouped objects, one card per show (not per episode).
    // Uses the SAME scoreItem() as movies now — was previously a separate
    // title-only path that never saw cast/crew/keywords/etc.
    for (const s of series) {
        const type = resolveType(s, "series");
        const title = s.metadata?.title || s.title || "";
        const { score: sc, reason } = scoreItem(s, q);
        if (sc > 0) {
            candidates.push({ ...s, _type: type, _displayTitle: title, _score: sc, _matchReason: reason });
        }
    }

    // Anime bucket — same grouped shape as series, same unified scoring.
    for (const a of anime) {
        const type = resolveType(a, "anime");
        const title = a.metadata?.title || a.title || "";
        const { score: sc, reason } = scoreItem(a, q);
        if (sc > 0) {
            candidates.push({ ...a, _type: type, _displayTitle: title, _score: sc, _matchReason: reason });
        }
    }

    // Sort: score desc → title asc
    candidates.sort((a, b) => b._score - a._score || a._displayTitle.localeCompare(b._displayTitle));

    // Dedupe by type::normalised-title  (prevents same show appearing twice)
    const seen = new Set();
    return candidates.filter((item) => {
        const key = `${item._type}::${item._displayTitle.toLowerCase().replace(/\s+/g, " ").trim()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// ─── Merge flat API search results (from /api/media/search) ──────────────────
// These are individual files — must resolve type carefully and dedupe against
// already-grouped results.
function mergeApiResults(existing, rawApiResults, query) {
    if (!rawApiResults?.length) return existing;

    const existingKeys = new Set(existing.map((i) => `${i._type}::${i._displayTitle.toLowerCase().trim()}`));

    const toAdd = [];

    for (const r of rawApiResults) {
        // resolveType with no bucket hint — rely purely on metadata/parsed
        const type = resolveType(r, r.type || "movie");

        // Display title: prefer TMDB, then parsed title, then raw filename
        const title =
            r.metadata?.title ||
            r.parsed?.title ||
            r.name?.replace(/\.[^.]+$/, "") || // strip extension if present
            "";

        const { score: sc, reason } = scoreItem(r, query);
        if (sc === 0 || !title) continue;

        const key = `${type}::${title.toLowerCase().trim()}`;
        if (existingKeys.has(key)) continue;

        existingKeys.add(key);
        toAdd.push({ ...r, _type: type, _displayTitle: title, _score: sc, _matchReason: reason });
    }

    const merged = [...existing, ...toAdd];
    merged.sort((a, b) => b._score - a._score || a._displayTitle.localeCompare(b._displayTitle));
    return merged;
}

// ─── Type badge config ────────────────────────────────────────────────────────
const TYPE_CONFIG = {
    movie: { label: "Movie", color: "bg-primary/20 text-primary border border-primary/30", icon: Film },
    series: { label: "Series", color: "bg-accent/20 text-accent border border-accent/30", icon: Tv },
    anime: { label: "Anime", color: "bg-secondary/20 text-secondary border border-secondary/30", icon: Tv },
};

// ─── Result row ───────────────────────────────────────────────────────────────
function ResultRow({ item, query, onClick }) {
    const title = item._displayTitle;
    const q = query.toLowerCase().trim();
    const cfg = TYPE_CONFIG[item._type] ?? TYPE_CONFIG.movie;
    const Icon = cfg.icon;

    function highlight(text) {
        if (!q || !text) return text;
        const idx = text.toLowerCase().indexOf(q);
        if (idx === -1) return text;
        return [
            text.slice(0, idx),
            <mark key="hl" className="bg-primary/25 text-primary rounded-sm not-italic font-semibold">
                {text.slice(idx, idx + q.length)}
            </mark>,
            text.slice(idx + q.length),
        ];
    }

    const poster = item.metadata?.poster ?? null;
    const year = item.metadata?.year ?? item.parsed?.year ?? null;
    const rating = item.metadata?.rating ?? null;
    // Extra info for series: season count
    const seasons = item.seasons ? Object.keys(item.seasons).length : (item.metadata?.totalSeasons ?? null);

    return (
        <button
            onClick={onClick}
            className="w-full flex items-center gap-3 px-4 py-2.5
                       hover:bg-base-300/50 active:bg-base-300/80
                       transition-colors duration-100 text-left group cursor-pointer">
            {/* Poster */}
            <div className="w-9 h-13 rounded-lg overflow-hidden shrink-0 bg-base-300 ring-1 ring-white/5">
                {poster ? (
                    <img src={poster} alt={title} className="w-full h-full object-cover" loading="lazy" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center">
                        <Icon size={14} className="text-base-content/25" />
                    </div>
                )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-base-content truncate leading-snug">{highlight(title)}</p>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    {/* Type badge */}
                    <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${cfg.color}`}>{cfg.label}</span>
                    {year && <span className="text-[11px] text-base-content/40">{year}</span>}
                    {seasons && seasons > 0 && (
                        <span className="text-[11px] text-base-content/40">
                            {seasons} season{seasons !== 1 ? "s" : ""}
                        </span>
                    )}
                    {rating != null && (
                        <span className="flex items-center gap-0.5 ml-auto">
                            <Star size={9} className="text-warning fill-warning" />
                            <span className="text-[11px] text-base-content/50 font-medium">{rating.toFixed(1)}</span>
                        </span>
                    )}
                </div>
                {/* Search-upgrade: only shown when the hit came from a secondary
                    field (cast/collection/company/network/genre/keyword/language/
                    country/certification) rather than the title itself — tells
                    the user WHY an otherwise-unrelated-looking title matched. */}
                {item._matchReason && <p className="text-[10px] text-primary/65 mt-1 truncate">Matched: {highlight(item._matchReason)}</p>}
            </div>
        </button>
    );
}

// ─── Empty state ──────────────────────────────────────────────────────────────
function EmptyState({ query }) {
    return (
        <div className="flex flex-col items-center justify-center py-10 gap-2 px-4">
            <SearchIcon size={24} className="text-base-content/15" />
            <p className="text-sm text-base-content/40 text-center">
                No results for <span className="text-base-content/60 font-medium">&ldquo;{query}&rdquo;</span>
            </p>
            <p className="text-xs text-base-content/25">Try different keywords</p>
        </div>
    );
}

// ─── Results list ─────────────────────────────────────────────────────────────
function ResultsList({ results, query, onSelect, limit = 12 }) {
    const shown = results.slice(0, limit);
    return (
        <div className="flex flex-col" style={{ maxHeight: "320px" }}>
            {/* sticky header */}
            <div className="px-4 py-2 border-b border-base-300/50 flex items-center gap-2 shrink-0">
                <Sparkles size={10} className="text-primary/60" />
                <p className="text-[10px] text-base-content/40 font-semibold uppercase tracking-widest">
                    {results.length} result{results.length !== 1 ? "s" : ""}
                </p>
            </div>
            {/* scrollable list — scrollbar hidden */}
            <div className="overflow-y-auto py-1 flex-1" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                {shown.map((item) => {
                    const key = item.id ?? item.seriesKey ?? item._displayTitle;
                    return <ResultRow key={key} item={item} query={query} onClick={() => onSelect(item)} />;
                })}
            </div>
            {results.length > limit && (
                <div className="px-4 py-2 border-t border-base-300/50 text-center shrink-0">
                    <p className="text-[11px] text-base-content/30">+{results.length - limit} more — refine your search</p>
                </div>
            )}
        </div>
    );
}

// ─── Search component ─────────────────────────────────────────────────────────
// Props:
//   className            — classes for the desktop (sm+) search field wrapper
//   hideMobileBtn        — hide the built-in mobile icon trigger
//   openMobileRef        — ref that receives an "open mobile search" function
//   inlineMobile         — phones: instead of the full-screen overlay, render an inline pill that
//                          expands inside the navbar (results drop down under the navbar)
//   onMobileOpenChange   — (open: boolean) => void, fired whenever the mobile search opens/closes
export default function Search({ className = "", hideMobileBtn = false, openMobileRef = null, closeMobileRef = null, inlineMobile = false, onMobileOpenChange = null }) {
    const { movies, series, anime, search, searchResults, loading } = useApi();
    const navigate = useNavigate();

    const [query, setQuery] = useState("");
    const [open, setOpen] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [results, setResults] = useState([]);

    const inputRef = useRef(null);
    const mobileInputRef = useRef(null);
    const containerRef = useRef(null);
    const inlineRef = useRef(null); // inline pill wrapper
    const panelRef = useRef(null); // inline results panel
    const debounceRef = useRef(null);
    const mountedRef = useRef(true);

    // Single place that opens/closes mobile search and tells the parent
    function setMobile(next) {
        setMobileOpen(next);
        if (onMobileOpenChange) onMobileOpenChange(next);
    }

    // Mount/unmount: wire openMobileRef, mark mounted, clear debounce on cleanup
    useEffect(() => {
        mountedRef.current = true;
        if (openMobileRef) openMobileRef.current = () => setMobile(true);
        return () => {
            mountedRef.current = false;
            clearTimeout(debounceRef.current);
            if (openMobileRef) openMobileRef.current = null;
        };
        // openMobileRef is a stable ref object; setMobile only uses stable setters — no extra deps needed
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Expose close() so the navbar's morphing menu/close icon can collapse the search
    useEffect(() => {
        if (closeMobileRef) closeMobileRef.current = closeMobile;
        return () => {
            if (closeMobileRef) closeMobileRef.current = null;
        };
    });

    const runSearch = useCallback(
        (val) => {
            setQuery(val);
            clearTimeout(debounceRef.current);

            if (!val.trim()) {
                setResults([]);
                setOpen(false);
                return;
            }

            // Instant client-side results from grouped context state
            const ranked = rankResults(movies, series, anime, val);
            setResults(ranked);
            setOpen(true);

            // Debounced API call — catches files not yet surfaced
            debounceRef.current = setTimeout(async () => {
                if (!mountedRef.current) return;
                // Capture query at schedule time; abort if it changed by the time we run
                const capturedVal = val;
                try {
                    await search(capturedVal);
                } catch {
                    /* silent */
                }
            }, 300);
        },
        [movies, series, anime, search],
    );

    // Merge API flat results when they arrive
    useEffect(() => {
        if (!query.trim() || !mountedRef.current) return;
        setResults((prev) => mergeApiResults(prev, searchResults, query));
    }, [searchResults, query]); // query dep prevents stale merge after clear

    // Outside click closes desktop dropdown
    useEffect(() => {
        function handler(e) {
            if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
        }
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    // Auto-focus mobile input
    useEffect(() => {
        if (mobileOpen) setTimeout(() => mobileInputRef.current?.focus(), inlineMobile ? 0 : 80);
    }, [mobileOpen, inlineMobile]);

    // Lock body scroll — full-screen overlay only (inline mode scrolls inside its own panel)
    useEffect(() => {
        if (!mobileOpen || inlineMobile) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = prev;
        };
    }, [mobileOpen, inlineMobile]);

    // Inline mode: click outside the pill + results panel collapses the search
    useEffect(() => {
        if (!inlineMobile || !mobileOpen) return;
        function handler(e) {
            const t = e.target;
            if (inlineRef.current?.contains(t) || panelRef.current?.contains(t)) return;
            if (t.closest?.("[data-search-toggle]")) return; // navbar morph icon handles its own close
            clearTimeout(debounceRef.current);
            setQuery("");
            setResults([]);
            setOpen(false);
            setMobileOpen(false);
            if (onMobileOpenChange) onMobileOpenChange(false);
        }
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [inlineMobile, mobileOpen, onMobileOpenChange]);

    function navigateToResult(item) {
        setOpen(false);
        setMobile(false);
        setQuery("");
        setResults([]);
        const id = item.id ?? item.seriesKey ?? encodeURIComponent(item._displayTitle);
        navigate(`/media/${encodeURIComponent(id)}`);
    }

    function clear() {
        clearTimeout(debounceRef.current);
        setQuery("");
        setResults([]);
        setOpen(false);
    }

    // Collapse mobile search and reset it
    function closeMobile() {
        setMobile(false);
        clear();
        // drop focus so caret + keyboard go away
        mobileInputRef.current?.blur();
        if (document.activeElement instanceof HTMLElement && inlineRef.current?.contains(document.activeElement)) document.activeElement.blur();
    }

    function handleKeyDown(e) {
        if (e.key === "Escape") {
            setOpen(false);
            inputRef.current?.blur();
        }
        if (e.key === "Enter" && results.length > 0) navigateToResult(results[0]);
    }

    function handleMobileKeyDown(e) {
        if (e.key === "Escape") closeMobile();
        if (e.key === "Enter" && results.length > 0) navigateToResult(results[0]);
    }

    // Inline mode: tabbing away with an empty query collapses the pill
    function handleInlineBlur(e) {
        if (e.relatedTarget?.closest?.("[data-search-toggle]")) return;
        if (!query.trim() && e.relatedTarget && inlineRef.current && !inlineRef.current.contains(e.relatedTarget)) closeMobile();
    }

    const isSearching = loading.search;

    return (
        <>
            {/* ── Desktop ── */}
            <div ref={containerRef} className={`relative hidden sm:block ${className}`}>
                <div
                    className={`flex items-center gap-2 bg-white/10 rounded-md px-3 h-9 w-full
                                 transition-all duration-200 ${open ? "ring-1 ring-white/30 brightness-110" : ""}`}>
                    {isSearching ? <Loader2 size={15} className="text-base-content/50 shrink-0 animate-spin" /> : <SearchIcon size={15} className="text-base-content/50 shrink-0" />}
                    <label htmlFor="desktop-search" className="sr-only">
                        Search
                    </label>
                    <input
                        id="desktop-search"
                        name="q"
                        ref={inputRef}
                        type="text"
                        placeholder="Search movies, series, anime..."
                        value={query}
                        onChange={(e) => runSearch(e.target.value)}
                        onFocus={() => query.trim() && setOpen(true)}
                        onKeyDown={handleKeyDown}
                        className="bg-transparent outline-none text-sm text-white
                                   placeholder-base-content/40 w-full min-w-0"
                    />
                    {query && (
                        <button
                            onMouseDown={(e) => e.preventDefault()} // keep input focused
                            onClick={clear}
                            className="shrink-0 text-base-content/35 hover:text-base-content
                                       transition-colors rounded-full hover:bg-white/10 p-0.5">
                            <X size={13} />
                        </button>
                    )}
                </div>

                {open && query && (
                    <div
                        className="absolute top-[calc(100%+6px)] left-0 w-full min-w-80 z-[99999]
                                    bg-base-200/98 backdrop-blur-xl border border-base-300/80
                                    rounded-2xl shadow-2xl overflow-hidden"
                        style={{ animation: "sDrop .12s ease-out both" }}>
                        <style>{`@keyframes sDrop{from{opacity:0;transform:translateY(-4px) scale(.97)}to{opacity:1;transform:none}}`}</style>
                        {results.length > 0 ? <ResultsList results={results} query={query} onSelect={navigateToResult} limit={10} /> : <EmptyState query={query} />}
                    </div>
                )}
            </div>

            {/* ── Mobile inline pill (phones) — expands inside the navbar ── */}
            {inlineMobile && (
                <>
                    <div ref={inlineRef} className="sm:hidden flex-1 min-w-0" onBlur={handleInlineBlur}>
                        <style>{`
                            @keyframes pillPulse{
                                0%{box-shadow:inset 0 0 0 1px rgba(255,255,255,.4)}
                                100%{box-shadow:inset 0 0 0 1px rgba(255,255,255,0)}
                            }
                            .pill-pulse{animation:pillPulse 700ms cubic-bezier(.22,1,.36,1) backwards}
                            @media (prefers-reduced-motion: reduce){.pill-pulse{animation:none !important}}
                        `}</style>
                        <div
                            role={mobileOpen ? undefined : "button"}
                            tabIndex={mobileOpen ? -1 : 0}
                            aria-label={mobileOpen ? undefined : "Search"}
                            onClick={() => {
                                if (mobileOpen) return;
                                setMobile(true);
                                mobileInputRef.current?.focus(); // inside the tap gesture so iOS keyboard opens
                            }}
                            onKeyDown={(e) => {
                                if (!mobileOpen && (e.key === "Enter" || e.key === " ")) {
                                    e.preventDefault();
                                    setMobile(true);
                                    mobileInputRef.current?.focus();
                                }
                            }}
                            className={`group relative flex items-center gap-2 h-9 px-3.5 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
                                mobileOpen ? "" : "cursor-pointer"
                            }`}>
                            {/* Background layer — colour + ring fade; width spring comes from the navbar (x axis only) */}
                            <span
                                aria-hidden="true"
                                className={`pointer-events-none absolute inset-0 rounded-full bg-white/[0.07] ${mobileOpen ? "pill-pulse" : "transition-colors duration-200 group-hover:bg-white/12"}`}
                            />
                            {isSearching ? (
                                <Loader2 size={16} className="relative text-white/60 shrink-0 animate-spin" />
                            ) : (
                                <SearchIcon size={16} strokeWidth={2} className={`relative shrink-0 transition-colors duration-500 ${mobileOpen ? "text-white" : "text-white/60"}`} />
                            )}
                            <label htmlFor="mobile-search-inline" className="sr-only">
                                Search
                            </label>
                            <input
                                id="mobile-search-inline"
                                name="q"
                                ref={mobileInputRef}
                                type="text"
                                enterKeyHint="search"
                                autoComplete="off"
                                placeholder="Search"
                                value={query}
                                tabIndex={mobileOpen ? 0 : -1}
                                onChange={(e) => runSearch(e.target.value)}
                                onKeyDown={handleMobileKeyDown}
                                // 16px typed text stops iOS zoom; placeholder is smaller
                                className={`relative bg-transparent outline-none text-[16px] text-white w-full min-w-0 truncate placeholder:text-[13px] placeholder:font-medium placeholder:transition-colors placeholder:duration-500 ${
                                    mobileOpen ? "placeholder:text-white/55" : "placeholder:text-white/50 pointer-events-none"
                                }`}
                            />
                        </div>
                    </div>

                    {/* Results drop down right under the navbar row (positioned against the navbar row) */}
                    {mobileOpen && query.trim() && (
                        <div
                            ref={panelRef}
                            className="nav-anim-search sm:hidden absolute left-0 right-0 top-full z-[99999] bg-base-100 border-b border-base-300 shadow-2xl overflow-hidden"
                            style={{ animation: "mIn .42s cubic-bezier(0.22,1,0.36,1) both", maxHeight: "calc(100dvh - 4rem)" }}>
                            <style>{`@keyframes mIn{from{opacity:0;transform:translateY(-12px)}to{opacity:1;transform:none}} @media (prefers-reduced-motion: reduce){.nav-anim-search{animation:none !important}}`}</style>
                            {results.length > 0 ? <ResultsList results={results} query={query} onSelect={navigateToResult} limit={20} /> : <EmptyState query={query} />}
                        </div>
                    )}
                </>
            )}

            {/* ── Mobile icon trigger ── */}
            {!hideMobileBtn && !inlineMobile && (
                <button
                    onClick={() => setMobile(true)}
                    className="sm:hidden inline-flex items-center justify-center w-9 h-9
                           rounded-md hover:bg-white/15 transition-colors text-base-content"
                    aria-label="Search">
                    <SearchIcon size={18} />
                </button>
            )}

            {/* ── Mobile overlay (full screen) — used when not inline ── */}
            {!inlineMobile && mobileOpen && (
                <div className="sm:hidden fixed inset-0 z-[999999] bg-base-100 flex flex-col" style={{ animation: "mIn .15s ease-out both" }}>
                    <style>{`@keyframes mIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}`}</style>

                    <div className="flex items-center gap-3 px-3 h-14 border-b border-base-300 shrink-0 bg-base-200">
                        <button onClick={closeMobile} className="text-base-content/60 hover:text-base-content transition-colors p-1" aria-label="Close search">
                            <ArrowLeft size={20} />
                        </button>
                        <div className={`flex-1 flex items-center gap-2 bg-base-300 rounded-md px-3 h-9`}>
                            {isSearching ? <Loader2 size={15} className="text-base-content/50 shrink-0 animate-spin" /> : <SearchIcon size={15} className="text-base-content/50 shrink-0" />}
                            <label htmlFor="mobile-search" className="sr-only">
                                Search
                            </label>
                            <input
                                id="mobile-search"
                                name="q"
                                ref={mobileInputRef}
                                type="text"
                                placeholder="Search movies, series, anime..."
                                value={query}
                                onChange={(e) => runSearch(e.target.value)}
                                onKeyDown={handleMobileKeyDown}
                                className="bg-transparent outline-none text-sm text-base-content
                                           placeholder-base-content/40 w-full min-w-0"
                            />
                            {query && (
                                <button
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={clear}
                                    className="shrink-0 text-base-content/35 hover:text-base-content
                                               transition-colors rounded-full p-0.5">
                                    <X size={13} />
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                        {query.trim() ? (
                            results.length > 0 ? (
                                <ResultsList results={results} query={query} onSelect={navigateToResult} limit={20} />
                            ) : (
                                <EmptyState query={query} />
                            )
                        ) : (
                            <div className="flex flex-col items-center justify-center h-48 gap-2">
                                <SearchIcon size={28} className="text-base-content/10" />
                                <p className="text-sm text-base-content/25">Start typing to search</p>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}
