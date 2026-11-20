import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { Search as SearchIcon, X, Film, Tv, Loader2, Star, ArrowLeft, Clock, Compass, CornerDownLeft } from "lucide-react";
import { useApi } from "../../Context/apiContext";
import { routeId } from "../../Utils/shortId.js";

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

// ─── Recent searches (per browser) ────────────────────────────────────────────
const RECENT_KEY = "flux.recentSearches";
const RECENT_MAX = 6;

function readRecent() {
    try {
        const v = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
        return Array.isArray(v) ? v.filter((s) => typeof s === "string").slice(0, RECENT_MAX) : [];
    } catch {
        return [];
    }
}

function writeRecent(list) {
    try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    } catch {
        /* storage blocked — recents just won't persist */
    }
}

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60";
// Keycap — high-contrast so shortcuts are readable at a glance
const KEYCAP =
    "inline-flex items-center justify-center min-w-[26px] h-[26px] px-1.5 rounded-md bg-white/[0.07] border border-white/10 border-b-2 text-white/60 text-xs font-semibold font-mono leading-none";
const PAGE_LIMIT = 8; // "More results" rows shown before "Show N more"

function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

// Highlights the first occurrence of `query` inside `text`
function Highlight({ text, query }) {
    const q = query.toLowerCase().trim();
    if (!q || !text) return text;
    const idx = text.toLowerCase().indexOf(q);
    if (idx === -1) return text;
    return (
        <>
            {text.slice(0, idx)}
            <mark className="bg-primary/25 text-primary rounded-sm not-italic font-semibold">{text.slice(idx, idx + q.length)}</mark>
            {text.slice(idx + q.length)}
        </>
    );
}

// ─── Result row (poster, highlight, type badge, year, seasons, rating, "Matched: …") ──
function ResultRow({ item, query, id, active, featured = false, onSelect, onHover }) {
    const title = item._displayTitle;
    const cfg = TYPE_CONFIG[item._type] ?? TYPE_CONFIG.movie;
    const Icon = cfg.icon;
    const poster = item.metadata?.poster ?? null;
    const year = item.metadata?.year ?? item.parsed?.year ?? null;
    const rating = item.metadata?.rating ?? null;
    const seasons = item.seasons ? Object.keys(item.seasons).length : (item.metadata?.totalSeasons ?? null);
    const overview = featured ? item.metadata?.overview : null;

    return (
        <div
            id={id}
            role="option"
            aria-selected={active}
            onClick={() => onSelect(item)}
            onMouseMove={onHover}
            className={`flex items-center gap-3 mx-2 md:mx-3 rounded-xl cursor-pointer transition-colors duration-100 ${featured ? "p-3" : "px-3 py-2.5"} ${
                active ? "bg-white/[0.08] ring-1 ring-inset ring-white/10" : "hover:bg-white/[0.04]"
            }`}>
            <div className={`${featured ? "w-14 h-20" : "w-10 h-14"} rounded-lg overflow-hidden shrink-0 bg-base-300 ring-1 ring-white/5`}>
                {poster ? (
                    <img src={poster} alt="" className="w-full h-full object-cover" loading="lazy" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center">
                        <Icon size={16} className="text-base-content/25" />
                    </div>
                )}
            </div>

            <div className="flex-1 min-w-0">
                <p className={`${featured ? "text-base" : "text-sm"} font-medium text-base-content truncate leading-snug`}>
                    <Highlight text={title} query={query} />
                </p>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${cfg.color}`}>{cfg.label}</span>
                    {year && <span className="text-[11px] text-base-content/45">{year}</span>}
                    {seasons > 0 && (
                        <span className="text-[11px] text-base-content/45">
                            {seasons} season{seasons !== 1 ? "s" : ""}
                        </span>
                    )}
                    {rating != null && (
                        <span className="flex items-center gap-0.5 ml-auto">
                            <Star size={10} className="text-warning fill-warning" />
                            <span className="text-[11px] text-base-content/60 font-medium">{Number(rating).toFixed(1)}</span>
                        </span>
                    )}
                </div>
                {overview && <p className="text-xs text-base-content/50 mt-1.5 line-clamp-2 leading-snug">{overview}</p>}
                {/* Only when the hit came from a secondary field (cast, genre, keyword…) — explains WHY it matched */}
                {item._matchReason && (
                    <p className="text-[10px] text-primary/70 mt-1 truncate">
                        Matched: <Highlight text={item._matchReason} query={query} />
                    </p>
                )}
            </div>
        </div>
    );
}

function SectionLabel({ children, right }) {
    return (
        <div className="flex items-center justify-between px-5 md:px-6 pt-3 pb-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-base-content/40">{children}</p>
            {right}
        </div>
    );
}

function EmptyState({ query }) {
    return (
        <div className="flex flex-col items-center justify-center py-14 gap-2 px-4">
            <SearchIcon size={26} className="text-base-content/15" />
            <p className="text-sm text-base-content/50 text-center">
                No results for <span className="text-base-content/70 font-medium">&ldquo;{query}&rdquo;</span>
            </p>
            <p className="text-xs text-base-content/30">Try a title, actor, genre or year</p>
        </div>
    );
}

// ─── Search ───────────────────────────────────────────────────────────────────
// One component, two surfaces:
//   • md+  → centered command palette (680px)
//   • <md  → full-screen search sheet
// Trigger: pill with "/" hint on lg+ (when `compact` is false), otherwise an icon button.
// Shortcuts: "/" or Ctrl/⌘+K open · ↑ ↓ move · Enter open · Esc close.
// Props:
//   compact   — render the icon trigger even on lg+ (navbar passes true once the page is scrolled)
//   className — extra classes for the trigger wrapper-less buttons
export default function Search({ compact = false, className = "", hideMobileBtn = false, openMobileRef = null, closeMobileRef = null, inlineMobile = false, onMobileOpenChange = null }) {
    // Page mode: any caller passing className / hideMobileBtn (Movies, Series, …) wants an in-page search FIELD at every breakpoint.
    // The navbar passes neither, so it keeps the pill (lg+) / icon (below lg) triggers.
    const fieldMode = hideMobileBtn || !!className;
    const { movies, series, anime, search, searchResults, loading } = useApi();
    const navigate = useNavigate();

    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [results, setResults] = useState([]);
    const [filter, setFilter] = useState("all");
    const [active, setActive] = useState(0);
    const [showCount, setShowCount] = useState(PAGE_LIMIT + 1); // rows exposed; "Show more" raises it until every match is visible
    const [recent, setRecent] = useState(readRecent);

    const inputRef = useRef(null);
    const dialogRef = useRef(null);
    const lastTriggerRef = useRef(null);
    const debounceRef = useRef(null);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            clearTimeout(debounceRef.current);
        };
    }, []);

    const openSearch = useCallback((e) => {
        if (e?.currentTarget) lastTriggerRef.current = e.currentTarget;
        setOpen(true);
    }, []);

    const reset = useCallback(() => {
        clearTimeout(debounceRef.current);
        setQuery("");
        setResults([]);
        setFilter("all");
        setActive(0);
        setShowCount(PAGE_LIMIT + 1);
    }, []);

    const close = useCallback(
        (restoreFocus = false) => {
            setOpen(false);
            reset();
            if (restoreFocus) {
                const el = lastTriggerRef.current;
                if (el?.isConnected) requestAnimationFrame(() => el.focus());
            }
        },
        [reset],
    );

    // Global shortcuts
    useEffect(() => {
        if (fieldMode) return; // the navbar instance owns the shortcuts — avoids two palettes opening at once
        // Another modal already owns focus + the scroll lock (its own dialog, or any open dialog) → do not stack search on top.
        const otherModalOpen = () => document.body.style.overflow === "hidden" || !!document.querySelector('[aria-modal="true"], dialog[open]');
        function onKey(e) {
            if ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey)) {
                if (open) {
                    e.preventDefault();
                    close(true);
                } else if (!otherModalOpen()) {
                    e.preventDefault();
                    setOpen(true);
                }
                return;
            }
            if (e.key === "/" && !open && !e.ctrlKey && !e.metaKey && !e.altKey && !isTypingTarget(e.target) && !otherModalOpen()) {
                e.preventDefault();
                setOpen(true);
            }
        }
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [open, close, fieldMode]);

    // While open: lock page scroll + focus the field
    useEffect(() => {
        if (!open) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        const raf = requestAnimationFrame(() => inputRef.current?.focus());
        return () => {
            document.body.style.overflow = prev;
            cancelAnimationFrame(raf);
        };
    }, [open]);

    const runSearch = useCallback(
        (val) => {
            setQuery(val);
            setActive(0);
            setShowCount(PAGE_LIMIT + 1);
            clearTimeout(debounceRef.current);

            if (!val.trim()) {
                setResults([]);
                return;
            }

            // Instant client-side results from grouped context state
            setResults(rankResults(movies, series, anime, val));

            // Debounced API call — catches files not yet surfaced
            debounceRef.current = setTimeout(async () => {
                if (!mountedRef.current) return;
                try {
                    await search(val);
                } catch {
                    /* silent */
                }
            }, 300);
        },
        [movies, series, anime, search],
    );

    // Merge flat API results when they arrive
    useEffect(() => {
        if (!open || !query.trim() || !mountedRef.current) return;
        setResults((prev) => mergeApiResults(prev, searchResults, query));
    }, [searchResults, query, open]);

    const counts = useMemo(() => {
        const c = { all: results.length, movie: 0, series: 0, anime: 0 };
        for (const r of results) if (c[r._type] != null) c[r._type] += 1;
        return c;
    }, [results]);

    const filtered = useMemo(() => (filter === "all" ? results : results.filter((r) => r._type === filter)), [results, filter]);
    const flat = useMemo(() => filtered.slice(0, showCount), [filtered, showCount]);
    const hiddenCount = filtered.length - flat.length;

    // Keep the active row in view while arrowing
    useEffect(() => {
        if (!open) return;
        document.getElementById(`search-opt-${active}`)?.scrollIntoView({ block: "nearest" });
    }, [active, open]);

    function saveRecent(q) {
        const term = q.trim();
        if (!term) return;
        setRecent((prev) => {
            const next = [term, ...prev.filter((s) => s.toLowerCase() !== term.toLowerCase())].slice(0, RECENT_MAX);
            writeRecent(next);
            return next;
        });
    }

    function removeRecent(term) {
        setRecent((prev) => {
            const next = prev.filter((s) => s !== term);
            writeRecent(next);
            return next;
        });
    }

    function clearRecent() {
        setRecent([]);
        writeRecent([]);
    }

    function selectItem(item) {
        saveRecent(query);
        close(false);
        const id = item.id ?? item.seriesKey ?? encodeURIComponent(item._displayTitle);
        navigate(`/media/${routeId(id)}`);
    }

    function goTo(path) {
        close(false);
        navigate(path);
    }

    function onDialogKeyDown(e) {
        if (e.key === "Escape") {
            e.preventDefault();
            close(true);
            return;
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            if (!flat.length) return;
            e.preventDefault();
            setActive((i) => (e.key === "ArrowDown" ? (i + 1) % flat.length : (i - 1 + flat.length) % flat.length));
            return;
        }
        if (e.key === "Enter") {
            if (e.target !== inputRef.current) return; // buttons handle their own Enter
            if (flat[active]) {
                e.preventDefault();
                selectItem(flat[active]);
            }
            return;
        }
        if (e.key === "Tab" && dialogRef.current) {
            const f = Array.from(dialogRef.current.querySelectorAll('button:not([disabled]), input, [tabindex]:not([tabindex="-1"])')).filter((el) => el.getClientRects().length > 0);
            if (!f.length) return;
            const first = f[0];
            const last = f[f.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    }

    const hasQuery = query.trim().length > 0;
    const best = flat[0];
    const more = flat.slice(1);
    const isSearching = loading?.search;

    const browseCards = [
        { label: "Movies", to: "/movies", count: movies?.length ?? 0, icon: Film },
        { label: "Series", to: "/series", count: series?.length ?? 0, icon: Tv },
        { label: "Anime", to: "/anime", count: anime?.length ?? 0, icon: Tv },
        { label: "Discover", to: "/discover", count: null, icon: Compass },
    ].filter((c) => c.count === null || c.count > 0);

    const chips = [
        { key: "all", label: "All" },
        { key: "movie", label: "Movies" },
        { key: "series", label: "Series" },
        { key: "anime", label: "Anime" },
    ];

    const triggerBase = `items-center justify-center cursor-pointer focus-visible:outline-none`;

    return (
        <>
            {/* Trigger — pill on lg+ (top of page), icon everywhere else / when scrolled */}
            {fieldMode && (
                <button
                    type="button"
                    onClick={openSearch}
                    aria-label="Search"
                    aria-haspopup="dialog"
                    aria-keyshortcuts="/"
                    className={`flex ${triggerBase} group justify-start gap-2.5 h-10 px-3.5 rounded-md bg-base-200 border border-base-300 focus-visible:outline-none text-base-content/55 w-full min-w-0 ${className}`}>
                    <SearchIcon size={16} className="shrink-0" />
                    <span className="flex-1 text-left text-sm truncate">Search</span>
                </button>
            )}
            {!fieldMode && !compact && (
                <button
                    type="button"
                    onClick={openSearch}
                    aria-label="Search"
                    aria-haspopup="dialog"
                    aria-keyshortcuts="/"
                    className={`hidden lg:flex ${triggerBase} group gap-2.5 h-10 w-[clamp(11rem,18vw,18rem)] pl-3.5 pr-2 rounded-md bg-base-100/60 border border-white/10 shadow-inner focus-visible:outline-none text-white/55 ${className}`}>
                    <SearchIcon size={16} className="shrink-0" />
                    <span className="flex-1 text-left text-sm truncate">Search</span>
                    <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1 rounded-md bg-white/[0.06] border border-white/10 border-b-2 text-white/50 text-[11px] font-semibold font-mono leading-none">
                        /
                    </kbd>
                </button>
            )}
            {!fieldMode && (
                <button
                    type="button"
                    onClick={openSearch}
                    aria-label="Search"
                    aria-haspopup="dialog"
                    className={`${compact ? "inline-flex" : "inline-flex lg:hidden"} ${triggerBase} w-10 h-10 md:w-9 md:h-9 rounded-full text-white/85 ${className}`}>
                    <SearchIcon size={18} strokeWidth={1.8} />
                </button>
            )}

            {/* Overlay is portalled: the navbar's blur layer must never become its containing block */}
            {open &&
                createPortal(
                    <div className="fixed inset-0 z-[999999]">
                        <style>{`
                            @keyframes fxFade{from{opacity:0}to{opacity:1}}
                            @keyframes fxPop{from{opacity:0;transform:translateY(-8px) scale(.985)}to{opacity:1;transform:none}}
                            @media (prefers-reduced-motion: reduce){.fx-anim{animation:none !important}}
                        `}</style>
                        <div
                            className="fx-anim absolute inset-0 bg-black/60 md:backdrop-blur-sm"
                            style={{ animation: "fxFade .15s ease-out both" }}
                            onMouseDown={() => close(true)}
                            aria-hidden="true"
                        />

                        <div
                            ref={dialogRef}
                            role="dialog"
                            aria-modal="true"
                            aria-label="Search"
                            onKeyDown={onDialogKeyDown}
                            className="fx-anim absolute inset-0 flex flex-col overflow-hidden bg-base-100 pt-[env(safe-area-inset-top)] md:pt-0 md:inset-auto md:left-1/2 md:top-[10vh] md:w-[min(680px,calc(100vw-2rem))] md:max-h-[min(640px,80dvh)] md:-translate-x-1/2 md:rounded-2xl md:bg-base-200 md:border md:border-white/10 md:shadow-2xl"
                            style={{ animation: "fxPop .18s ease-out both" }}>
                            {/* Field — original full-width row (icon · input · clear). Esc hint on lg+ only; no keycaps on touch sizes */}
                            <div className="flex items-center gap-2 px-3 md:px-5 h-14 md:h-16 shrink-0 md:border-b md:border-white/[0.08]">
                                <button
                                    type="button"
                                    onClick={() => close(true)}
                                    aria-label="Close search"
                                    className={`md:hidden inline-flex items-center justify-center w-10 h-10 -ml-1 rounded-full text-white/60 hover:bg-white/10 cursor-pointer ${FOCUS_RING}`}>
                                    <ArrowLeft size={20} />
                                </button>
                                <span className="hidden md:inline-flex shrink-0 text-base-content/50">{isSearching ? <Loader2 size={18} className="animate-spin" /> : <SearchIcon size={18} />}</span>
                                <label htmlFor="flux-search-input" className="sr-only">
                                    Search movies, series, anime
                                </label>
                                <input
                                    id="flux-search-input"
                                    ref={inputRef}
                                    name="q"
                                    type="text"
                                    role="combobox"
                                    aria-expanded={hasQuery && flat.length > 0}
                                    aria-controls="flux-search-list"
                                    aria-autocomplete="list"
                                    aria-activedescendant={hasQuery && flat.length > 0 ? `search-opt-${active}` : undefined}
                                    enterKeyHint="search"
                                    autoComplete="off"
                                    spellCheck={false}
                                    placeholder="Search movies, series, anime, people…"
                                    value={query}
                                    onChange={(e) => runSearch(e.target.value)}
                                    // 16px stops iOS focus-zoom
                                    className="flex-1 min-w-0 bg-transparent outline-none text-[16px] md:text-base text-white placeholder:text-base-content/35"
                                />
                                {isSearching && <Loader2 size={16} className="md:hidden animate-spin text-base-content/50 shrink-0" />}
                                {query && (
                                    <button
                                        type="button"
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={() => {
                                            reset();
                                            inputRef.current?.focus();
                                        }}
                                        aria-label="Clear search"
                                        className={`shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full text-base-content/50 hover:text-white hover:bg-white/10 cursor-pointer ${FOCUS_RING}`}>
                                        <X size={15} />
                                    </button>
                                )}
                                <kbd className={`hidden lg:inline-flex px-2 ${KEYCAP}`}>Esc</kbd>
                            </div>

                            {/* Type chips with counts */}
                            {hasQuery && results.length > 0 && (
                                <div className="flex items-center gap-2 px-3 md:px-5 py-2.5 shrink-0 overflow-x-auto" role="group" aria-label="Filter by type">
                                    {chips.map((c) => {
                                        const on = filter === c.key;
                                        const n = counts[c.key];
                                        if (c.key !== "all" && !n) return null;
                                        return (
                                            <button
                                                key={c.key}
                                                type="button"
                                                aria-pressed={on}
                                                onClick={() => {
                                                    setFilter(c.key);
                                                    setActive(0);
                                                    setShowCount(PAGE_LIMIT + 1);
                                                    inputRef.current?.focus();
                                                }}
                                                className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-semibold whitespace-nowrap transition-colors duration-150 cursor-pointer ${FOCUS_RING} ${
                                                    on ? "bg-primary text-primary-content" : "bg-white/[0.07] text-white/70 hover:bg-white/[0.12] hover:text-white"
                                                }`}>
                                                {c.label}
                                                <span className={`text-[10px] ${on ? "opacity-80" : "text-white/40"}`}>{n}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}

                            {/* Body */}
                            <div className="flex-1 overflow-y-auto overscroll-contain pb-3" style={{ scrollbarWidth: "none" }}>
                                {hasQuery ? (
                                    results.length === 0 ? (
                                        isSearching ? (
                                            <div className="flex items-center justify-center gap-2 py-14 text-sm text-base-content/50">
                                                <Loader2 size={16} className="animate-spin" /> Searching…
                                            </div>
                                        ) : (
                                            <EmptyState query={query} />
                                        )
                                    ) : filtered.length === 0 ? (
                                        <EmptyState query={query} />
                                    ) : (
                                        <div id="flux-search-list" role="listbox" aria-label="Search results">
                                            <SectionLabel>Best match</SectionLabel>
                                            <ResultRow item={best} query={query} id="search-opt-0" featured active={active === 0} onSelect={selectItem} onHover={() => active !== 0 && setActive(0)} />
                                            {more.length > 0 && <SectionLabel>More results</SectionLabel>}
                                            {more.map((item, i) => {
                                                const idx = i + 1;
                                                return (
                                                    <ResultRow
                                                        key={`${item._type}-${item.id ?? item.seriesKey ?? item._displayTitle}`}
                                                        item={item}
                                                        query={query}
                                                        id={`search-opt-${idx}`}
                                                        active={active === idx}
                                                        onSelect={selectItem}
                                                        onHover={() => active !== idx && setActive(idx)}
                                                    />
                                                );
                                            })}
                                            {hiddenCount > 0 && (
                                                <div className="px-3 md:px-5 pt-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowCount((c) => c + 60)}
                                                        className={`w-full h-10 rounded-xl text-xs font-semibold text-white/70 bg-white/[0.06] hover:bg-white/[0.1] hover:text-white transition-colors cursor-pointer ${FOCUS_RING}`}>
                                                        Show {hiddenCount} more result{hiddenCount !== 1 ? "s" : ""}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )
                                ) : (
                                    <div>
                                        {recent.length > 0 && (
                                            <>
                                                <SectionLabel
                                                    right={
                                                        <button
                                                            type="button"
                                                            onClick={clearRecent}
                                                            className={`text-xs font-semibold text-primary hover:brightness-125 px-1.5 py-0.5 rounded cursor-pointer ${FOCUS_RING}`}>
                                                            Clear all
                                                        </button>
                                                    }>
                                                    Recent
                                                </SectionLabel>
                                                <ul className="px-2 md:px-3">
                                                    {recent.map((term) => (
                                                        <li key={term} className="group flex items-center rounded-xl hover:bg-white/[0.05]">
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    runSearch(term);
                                                                    inputRef.current?.focus();
                                                                }}
                                                                className={`flex-1 min-w-0 flex items-center gap-3 px-3 h-11 text-left text-sm text-white/80 rounded-xl cursor-pointer ${FOCUS_RING}`}>
                                                                <Clock size={15} className="shrink-0 text-base-content/35" />
                                                                <span className="truncate">{term}</span>
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => removeRecent(term)}
                                                                aria-label={`Remove ${term} from recent searches`}
                                                                className={`mr-1 inline-flex items-center justify-center w-8 h-8 rounded-full text-base-content/40 hover:text-white hover:bg-white/10 cursor-pointer ${FOCUS_RING}`}>
                                                                <X size={14} />
                                                            </button>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </>
                                        )}

                                        <SectionLabel>Browse by type</SectionLabel>
                                        <div className="grid grid-cols-2 gap-2.5 px-4 md:px-5">
                                            {browseCards.map(({ label, to, count, icon: Icon }) => (
                                                <button
                                                    key={to}
                                                    type="button"
                                                    onClick={() => goTo(to)}
                                                    className={`flex items-center gap-3 p-3 rounded-xl text-left bg-white/[0.05] hover:bg-white/[0.09] transition-colors cursor-pointer ${FOCUS_RING}`}>
                                                    <span className="flex items-center justify-center w-10 h-10 rounded-lg bg-white/[0.07] text-white/80 shrink-0">
                                                        <Icon size={18} strokeWidth={1.8} />
                                                    </span>
                                                    <span className="min-w-0">
                                                        <span className="block text-sm font-semibold text-white truncate">{label}</span>
                                                        <span className="block text-[11px] text-base-content/45">{count === null ? "Explore" : `${count} title${count !== 1 ? "s" : ""}`}</span>
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Keyboard hints — desktop only */}
                            <div className="hidden lg:flex items-center gap-5 px-5 h-12 shrink-0 border-t border-white/10 bg-base-100/40 text-[13px] font-medium text-white/55">
                                <span className="flex items-center gap-2">
                                    <kbd className={KEYCAP}>↑</kbd>
                                    <kbd className={KEYCAP}>↓</kbd>
                                    Navigate
                                </span>
                                <span className="flex items-center gap-2">
                                    <kbd className={KEYCAP}>
                                        <CornerDownLeft size={13} strokeWidth={2.5} />
                                    </kbd>
                                    Open
                                </span>
                                {hasQuery && results.length > 0 && (
                                    <span className="ml-auto text-white/60">
                                        {filtered.length} result{filtered.length !== 1 ? "s" : ""}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>,
                    document.body,
                )}
        </>
    );
}
