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

// Score an item against query — takes best of TMDB title + raw filename
function scoreItem(item, query) {
    const tmdbTitle = item.metadata?.title || "";
    const rawName = item.name || item.title || item.parsed?.title || "";
    return Math.max(scoreTitle(tmdbTitle, query), scoreTitle(rawName, query));
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
        const sc = scoreItem(m, q);
        if (sc > 0) {
            const title = m.metadata?.title || m.parsed?.title || m.name || "";
            candidates.push({ ...m, _type: "movie", _displayTitle: title, _score: sc });
        }
    }

    // Series bucket — grouped objects, one card per show (not per episode)
    for (const s of series) {
        const type = resolveType(s, "series");
        const title = s.metadata?.title || s.title || "";
        const sc = Math.max(scoreTitle(title, q), scoreTitle(s.title || "", q));
        if (sc > 0) {
            candidates.push({ ...s, _type: type, _displayTitle: title, _score: sc });
        }
    }

    // Anime bucket — same grouped shape as series
    for (const a of anime) {
        const type = resolveType(a, "anime");
        const title = a.metadata?.title || a.title || "";
        const sc = Math.max(scoreTitle(title, q), scoreTitle(a.title || "", q));
        if (sc > 0) {
            candidates.push({ ...a, _type: type, _displayTitle: title, _score: sc });
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

        const sc = scoreItem(r, query);
        if (sc === 0 || !title) continue;

        const key = `${type}::${title.toLowerCase().trim()}`;
        if (existingKeys.has(key)) continue;

        existingKeys.add(key);
        toAdd.push({ ...r, _type: type, _displayTitle: title, _score: sc });
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
export default function Search({ className = "" }) {
    const { movies, series, anime, search, searchResults, loading } = useApi();
    const navigate = useNavigate();

    const [query, setQuery] = useState("");
    const [open, setOpen] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [results, setResults] = useState([]);

    const inputRef = useRef(null);
    const mobileInputRef = useRef(null);
    const containerRef = useRef(null);
    const debounceRef = useRef(null);

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
                try {
                    await search(val);
                } catch {
                    /* silent */
                }
            }, 300);
        },
        [movies, series, anime, search],
    );

    // Merge API flat results when they arrive
    useEffect(() => {
        if (!query.trim()) return;
        setResults((prev) => mergeApiResults(prev, searchResults, query));
    }, [searchResults]); // eslint-disable-line react-hooks/exhaustive-deps

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
        if (mobileOpen) setTimeout(() => mobileInputRef.current?.focus(), 80);
    }, [mobileOpen]);

    // Lock body scroll
    useEffect(() => {
        document.body.style.overflow = mobileOpen ? "hidden" : "";
        return () => {
            document.body.style.overflow = "";
        };
    }, [mobileOpen]);

    function navigateToResult(item) {
        setOpen(false);
        setMobileOpen(false);
        setQuery("");
        setResults([]);
        const id = item.id ?? item.seriesKey ?? encodeURIComponent(item._displayTitle);
        navigate(`/media/${encodeURIComponent(id)}`);
    }

    function clear() {
        setQuery("");
        setResults([]);
        setOpen(false);
    }

    function handleKeyDown(e) {
        if (e.key === "Escape") {
            setOpen(false);
            inputRef.current?.blur();
        }
        if (e.key === "Enter" && results.length > 0) navigateToResult(results[0]);
    }

    function handleMobileKeyDown(e) {
        if (e.key === "Escape") {
            setMobileOpen(false);
            clear();
        }
        if (e.key === "Enter" && results.length > 0) navigateToResult(results[0]);
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
                    <input
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
                        className="absolute top-[calc(100%+6px)] left-0 w-full min-w-80 z-99999
                                    bg-base-200/98 backdrop-blur-xl border border-base-300/80
                                    rounded-2xl shadow-2xl overflow-hidden"
                        style={{ animation: "sDrop .12s ease-out both" }}>
                        <style>{`@keyframes sDrop{from{opacity:0;transform:translateY(-4px) scale(.97)}to{opacity:1;transform:none}}`}</style>
                        {results.length > 0 ? <ResultsList results={results} query={query} onSelect={navigateToResult} limit={10} /> : <EmptyState query={query} />}
                    </div>
                )}
            </div>

            {/* ── Mobile icon trigger ── */}
            <button
                onClick={() => setMobileOpen(true)}
                className="sm:hidden inline-flex items-center justify-center w-9 h-9
                           rounded-md bg-white/10 hover:bg-white/15 transition-colors text-base-content"
                aria-label="Search">
                <SearchIcon size={18} />
            </button>

            {/* ── Mobile overlay ── */}
            {mobileOpen && (
                <div className="sm:hidden fixed inset-0 z-999999 bg-base-100 flex flex-col" style={{ animation: "mIn .15s ease-out both" }}>
                    <style>{`@keyframes mIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}`}</style>

                    <div className="flex items-center gap-3 px-3 h-14 border-b border-base-300 shrink-0 bg-base-200">
                        <button
                            onClick={() => {
                                setMobileOpen(false);
                                clear();
                            }}
                            className="text-base-content/60 hover:text-base-content transition-colors p-1">
                            <ArrowLeft size={20} />
                        </button>
                        <div className={`flex-1 flex items-center gap-2 bg-base-300 rounded-md px-3 h-9`}>
                            {isSearching ? <Loader2 size={15} className="text-base-content/50 shrink-0 animate-spin" /> : <SearchIcon size={15} className="text-base-content/50 shrink-0" />}
                            <input
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
