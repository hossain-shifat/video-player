import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useLocation, useSearchParams, Link } from "react-router";
import { ChevronDown, ChevronUp, Minus, Plus, Share2, Check, Users, Search, X, Play, Eye, ArrowUpDown, CalendarDays, Star, Film, Tv, List, Library, GitCommitVertical } from "lucide-react";
import { useApi } from "../../Context/apiContext";
import MediaRow from "../../Components/MediaRow";

const TMDB_KEY = import.meta.env.VITE_TMDB_API_KEY;
const TMDB_BASE = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p";

// ─── TMDB: person + credits + socials in ONE call ─────────────────────────────
async function fetchPerson(personId, name) {
    if (!TMDB_KEY) throw new Error("NO_KEY");

    let id = /^\d+$/.test(personId) && personId !== "0" ? personId : null;

    // No tmdbPersonId on cast entry → search by name
    if (!id && name) {
        const r = await fetch(`${TMDB_BASE}/search/person?api_key=${TMDB_KEY}&query=${encodeURIComponent(name)}&language=en-US`);
        if (!r.ok) return null;
        const d = await r.json();
        id = d.results?.[0]?.id;
    }
    if (!id) return null;

    const r = await fetch(`${TMDB_BASE}/person/${id}?api_key=${TMDB_KEY}&language=en-US&append_to_response=combined_credits,external_ids`);
    if (!r.ok) return null;
    return r.json();
}

// ─── Local library helpers ────────────────────────────────────────────────────
// Map "movie:<tmdbId>" / "tv:<tmdbId>" → { id, raw } for everything the user owns
function buildLibraryIndex(movies, series, anime) {
    const map = new Map();
    for (const m of movies) {
        const t = m.metadata?.tmdbId;
        if (t) map.set(`movie:${t}`, { id: m.id, raw: m });
    }
    for (const s of series) {
        const t = s.metadata?.tmdbId;
        if (t) map.set(`tv:${t}`, { id: s.seriesKey || s.id, raw: s });
    }
    for (const a of anime) {
        const t = a.metadata?.tmdbId;
        if (!t) continue;
        const entry = { id: a.seriesKey || a.id, raw: a };
        // Pick the namespace from the anime item's own type; only when the type is
        // unknown (anime can be TV or film) map to both. Never overwrite a key that a
        // real movie/TV entry already owns — TMDB movie and TV id spaces are independent.
        const type = String(a.metadata?.type || a.parsed?.type || a.type || "").toLowerCase();
        const keys = type === "movie" ? [`movie:${t}`] : type === "tv" || type === "series" ? [`tv:${t}`] : [`tv:${t}`, `movie:${t}`];
        for (const key of keys) if (!map.has(key)) map.set(key, entry);
    }
    return map;
}

// Fallback: library metadata that already lists this person's tmdbPersonId
function findByPersonId(pid, movies, series, anime) {
    if (!pid) return [];
    const has = (meta) => meta && ((meta.cast || []).some((c) => c.tmdbPersonId === pid) || (meta.crew || []).some((c) => c.tmdbPersonId === pid));
    const out = [];
    for (const m of movies) if (has(m.metadata)) out.push({ id: m.id, raw: m });
    for (const s of [...series, ...anime]) if (has(s.metadata)) out.push({ id: s.seriesKey || s.id, raw: s });
    return out;
}

// ─── Credit helpers ───────────────────────────────────────────────────────────
const DEPT_LABEL = { Directing: "Director", Writing: "Writer", Production: "Producer" };
const SELF_RE = /^(self|himself|herself|themselves)\b/i;
// 10767 Talk · 10763 News · 10764 Reality · 99 Documentary
const APPEARANCE_GENRES = [10767, 10763, 10764, 99];

const isAppearance = (c) => SELF_RE.test(c.character || "") || (c.genre_ids || []).some((g) => APPEARANCE_GENRES.includes(g));
const creditDate = (c) => c.release_date || c.first_air_date || "";
const creditYear = (c) => creditDate(c).slice(0, 4);
const creditTitle = (c) => c.title || c.name || "Untitled";
const creditKey = (c) => `${c.media_type}:${c.id}`;

// Newest first; undated (upcoming / unknown) float to top like Plex
function byDateDesc(a, b) {
    const da = a.date || "9999";
    const db = b.date || "9999";
    return da < db ? 1 : da > db ? -1 : 0;
}

function toRow(c, sub, libIndex) {
    const lib = libIndex.get(creditKey(c));
    return {
        key: creditKey(c),
        title: creditTitle(c),
        year: creditYear(c),
        date: creditDate(c),
        sub,
        mediaType: c.media_type,
        tmdbId: c.id,
        libId: lib?.id ?? null,
        rating: c.vote_average || 0,
        votes: c.vote_count || 0,
    };
}

// Merge duplicate rows (same title, several roles/jobs) into one
function pushMerged(map, row) {
    const ex = map.get(row.key);
    if (!ex) return map.set(row.key, row);
    if (row.sub && !ex.sub.split(" / ").includes(row.sub)) ex.sub = ex.sub ? `${ex.sub} / ${row.sub}` : row.sub;
}

function buildFilmography(credits, libIndex) {
    const actor = new Map();
    const appearances = new Map();
    const crewMap = new Map(); // label → Map<key,row>

    for (const c of credits?.cast || []) {
        if (c.media_type !== "movie" && c.media_type !== "tv") continue;
        const row = toRow(c, c.character || "", libIndex);
        pushMerged(isAppearance(c) ? appearances : actor, row);
    }

    for (const c of credits?.crew || []) {
        if (c.media_type !== "movie" && c.media_type !== "tv") continue;
        const label = DEPT_LABEL[c.department] || c.department || "Crew";
        if (!crewMap.has(label)) crewMap.set(label, new Map());
        pushMerged(crewMap.get(label), toRow(c, c.job || "", libIndex));
    }

    const finish = (m) => [...m.values()].sort(byDateDesc);
    const sections = [];
    if (actor.size) sections.push({ title: "Actor", rows: finish(actor), open: true });

    // Director, Writer, Producer first, then everything else by size
    const order = ["Director", "Writer", "Producer"];
    const crewLabels = [...crewMap.keys()].sort((a, b) => {
        const ia = order.indexOf(a);
        const ib = order.indexOf(b);
        if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        return crewMap.get(b).size - crewMap.get(a).size;
    });
    for (const label of crewLabels) {
        sections.push({ title: label, rows: finish(crewMap.get(label)), open: order.includes(label) });
    }

    if (appearances.size) sections.push({ title: "Appearances", rows: finish(appearances), open: false });
    return sections;
}

// Items shaped for MediaCard. Owned → the real library item. Not owned → fake
// item whose id is "tmdb-<movie|tv>-<id>", opened by MediaDetails as "Not in library".
// Item shaped for MediaCard. Owned → the real library item. Not owned → fake item whose id is
// "tmdb-<movie|tv>-<id>", opened by MediaDetails as "Not in library".
function cardItem(c, libIndex) {
    const lib = libIndex.get(creditKey(c));
    if (lib) return lib.raw;
    const title = creditTitle(c);
    const year = creditYear(c) ? parseInt(creditYear(c), 10) : null;
    const rating = c.vote_average ? Math.round(c.vote_average * 10) / 10 : null;
    const metadata = { title, year, poster: c.poster_path ? `${IMG_BASE}/w342${c.poster_path}` : null, rating };
    return c.media_type === "tv"
        ? { id: `tmdb-tv-${c.id}`, seriesKey: `tmdb-tv-${c.id}`, title, type: "series", metadata }
        : { id: `tmdb-movie-${c.id}`, name: title, type: "movie", parsed: { type: "movie", title, year }, metadata, streamUrl: null };
}

function buildKnownFor(person, libIndex) {
    const cc = person?.combined_credits;
    if (!cc) return [];
    const pool = person.known_for_department === "Acting" ? cc.cast || [] : cc.crew || [];
    const seen = new Set();

    const candidates = pool
        .filter((c) => (c.media_type === "movie" || c.media_type === "tv") && c.poster_path && !isAppearance(c))
        .sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0))
        .filter((c) => {
            const k = creditKey(c);
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        });

    const owned = [];
    const others = [];
    for (const c of candidates) {
        const item = cardItem(c, libIndex);
        (libIndex.has(creditKey(c)) ? owned : others).push(item);
    }

    // owned first, then the rest — all owned kept, others fill up to 20 total
    return [...owned, ...others].slice(0, Math.max(20, owned.length));
}

// ─── Insights (career stats, decades, genres) ────────────────────────────────
// TMDB genre id → name. Same source (and names) as the library metadata.genres — fetched once, cached.
let genreMapPromise = null;
function loadGenreMap() {
    if (!TMDB_KEY) return Promise.resolve(new Map());
    if (!genreMapPromise) {
        genreMapPromise = Promise.all(
            ["movie", "tv"].map((kind) =>
                fetch(`${TMDB_BASE}/genre/${kind}/list?api_key=${TMDB_KEY}&language=en-US`)
                    .then((r) => (r.ok ? r.json() : { genres: [] }))
                    .catch(() => ({ genres: [] })),
            ),
        ).then((lists) => {
            const map = new Map();
            for (const l of lists) for (const g of l.genres || []) map.set(g.id, g.name);
            if (!map.size) genreMapPromise = null; // failed → retry next time
            return map;
        });
    }
    return genreMapPromise;
}
const mediaPath = (c, libIndex) => {
    const lib = libIndex.get(creditKey(c));
    return lib ? `/media/${encodeURIComponent(lib.id)}` : `/media/tmdb-${c.media_type}-${c.id}`;
};

function buildInsights(person, libIndex, genreMap) {
    const cc = person?.combined_credits;
    if (!cc) return null;

    // unique real titles (talk-show / "Self" appearances excluded)
    const uniq = new Map();
    for (const c of [...(cc.cast || []), ...(cc.crew || [])]) {
        if (c.media_type !== "movie" && c.media_type !== "tv") continue;
        if (isAppearance(c)) continue;
        const k = creditKey(c);
        if (!uniq.has(k)) uniq.set(k, c);
    }
    const list = [...uniq.values()];
    if (!list.length) return null;

    const today = new Date().toISOString().slice(0, 10);
    const years = list
        .filter((c) => creditDate(c) && creditDate(c) <= today)
        .map((c) => parseInt(creditYear(c), 10))
        .filter(Number.isFinite);
    const first = years.length ? Math.min(...years) : null;
    const last = years.length ? Math.max(...years) : null;

    // titles per year (gaps filled with 0) → line chart; per decade → peak caption
    const perYear = new Map();
    const perDecade = new Map();
    for (const y of years) {
        perYear.set(y, (perYear.get(y) || 0) + 1);
        const d = Math.floor(y / 10) * 10;
        perDecade.set(d, (perDecade.get(d) || 0) + 1);
    }
    const byYear = [];
    if (first !== null) for (let y = first; y <= last; y++) byYear.push({ year: y, count: perYear.get(y) || 0 });
    const peakDecade = [...perDecade.entries()].sort((a, b) => b[1] - a[1])[0] || null;

    // top genres
    const gCount = new Map();
    for (const c of list) {
        // owned title → genres straight from its library metadata; otherwise map the TMDB ids
        const own = libIndex.get(creditKey(c))?.raw?.metadata?.genres;
        const names = own?.length ? own : (c.genre_ids || []).map((g) => genreMap?.get(g)).filter(Boolean);
        for (const name of new Set(names)) gCount.set(name, (gCount.get(name) || 0) + 1);
    }
    const gSorted = [...gCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const gMax = gSorted[0]?.[1] || 1;
    const genres = gSorted.map(([name, count]) => ({ name, count, pct: Math.round((count / gMax) * 100) }));

    const rated = list.filter((c) => (c.vote_count || 0) >= 300);
    const avg = rated.length ? Math.round((rated.reduce((a, c) => a + c.vote_average, 0) / rated.length) * 10) / 10 : null;

    // strictest vote threshold that still yields a title (1000 → 200 → 30)
    let bestRaw = null;
    for (const min of [1000, 200, 30]) {
        bestRaw = list.filter((c) => (c.vote_count || 0) >= min).sort((a, b) => b.vote_average - a.vote_average)[0];
        if (bestRaw) break;
    }
    const best = bestRaw ? { title: creditTitle(bestRaw), rating: Math.round(bestRaw.vote_average * 10) / 10, to: mediaPath(bestRaw, libIndex) } : null;

    const movies = list.filter((c) => c.media_type === "movie").length;
    const owned = list.filter((c) => libIndex.has(creditKey(c))).length;

    // announced / unreleased titles, soonest first
    const upcoming = list
        .filter((c) => creditDate(c) && creditDate(c) > today)
        .sort((a, b) => (creditDate(a) < creditDate(b) ? -1 : 1))
        .slice(0, 8)
        .map((c) => ({ ...cardItem(c, libIndex), _badge: "Upcoming", _badgeTone: "glass", _badgeDot: true, _release: creditDate(c) }));

    return { total: list.length, movies, tv: list.length - movies, first, last, byYear, peakDecade, genres, avg, best, owned, upcoming };
}

// People who appear alongside this person in titles the user owns
function buildCoStars(items, personId, personName) {
    const map = new Map();
    for (const it of items) {
        for (const c of it.metadata?.cast || []) {
            if (!c.name || c.name === personName || (personId && c.tmdbPersonId === personId)) continue;
            const key = c.tmdbPersonId || c.name;
            const ex = map.get(key) || { key, name: c.name, photo: c.photo || null, pid: c.tmdbPersonId || 0, count: 0 };
            ex.count++;
            map.set(key, ex);
        }
    }
    return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 14);
}

// Owned movies in release order + what's been finished (from watch history)
function buildMarathon(items, history) {
    const yearOf = (m) => m.metadata?.year || m.parsed?.year || 9999;
    const movies = items.filter((it) => it.parsed?.type === "movie" || it.type === "movie").sort((a, b) => yearOf(a) - yearOf(b));
    if (!movies.length) return null;
    const done = new Set((history || []).filter((h) => h.completed).map((h) => h.id));
    const next = movies.find((m) => !done.has(m.id)) || null;
    return {
        total: movies.length,
        watched: movies.filter((m) => done.has(m.id)).length,
        next: next && { id: next.id, title: next.metadata?.title || next.parsed?.title || next.name, year: next.metadata?.year || next.parsed?.year || null },
    };
}

// ─── Format helpers ───────────────────────────────────────────────────────────
// TMDB dates are date-only ("YYYY-MM-DD") — new Date() parses those as UTC midnight, so
// local-time getters/formatting shift the day in negative-offset time zones. Everything
// below works on UTC / parsed Y-M-D components instead.
function _ymd(d) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || "");
    return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null;
}

function fmtDate(d) {
    if (!d) return null;
    const p = _ymd(d);
    const date = p ? new Date(Date.UTC(p.y, p.m, p.d)) : new Date(d);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function calcAge(birthday, deathday) {
    const birth = _ymd(birthday);
    if (!birth) return null;
    const now = new Date();
    const end = _ymd(deathday) || { y: now.getUTCFullYear(), m: now.getUTCMonth(), d: now.getUTCDate() };
    let age = end.y - birth.y;
    const m = end.m - birth.m;
    if (m < 0 || (m === 0 && end.d < birth.d)) age--;
    return age;
}

// ─── Brand icons (lucide v1 dropped brand glyphs) ─────────────────────────────
const FacebookIcon = ({ size = 20 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.78-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99A10 10 0 0 0 22 12z" />
    </svg>
);
const InstagramIcon = ({ size = 20 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
    </svg>
);
const XIcon = ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M18.9 2H22l-7.2 8.2L23 22h-6.6l-5.2-6.8L5.2 22H2l7.7-8.8L1.5 2h6.8l4.7 6.2L18.9 2zm-1.2 18h1.8L7.3 3.9H5.4L17.7 20z" />
    </svg>
);

// ─── Small building blocks ────────────────────────────────────────────────────
// Plain heading — same weight, size and left edge as the MediaRow headings
function SectionTitle({ children, className = "mb-3" }) {
    return <h2 className={`text-base sm:text-lg font-semibold text-base-content ${className}`}>{children}</h2>;
}

function StatCard({ label, value, sub, to }) {
    const body = (
        <div className="h-full rounded-2xl bg-base-200/70 backdrop-blur-sm border border-white/5 p-4 transition-colors hover:border-white/15">
            <p className="text-[10px] uppercase tracking-widest text-white/40 font-semibold">{label}</p>
            <p className="text-xl sm:text-2xl font-bold text-white mt-1 leading-tight truncate">{value}</p>
            {sub && <p className="text-[11px] sm:text-xs text-white/45 mt-0.5 truncate">{sub}</p>}
        </div>
    );
    return to ? (
        <Link to={to} className="block min-w-0">
            {body}
        </Link>
    ) : (
        <div className="min-w-0">{body}</div>
    );
}

// Ring = how much of their work you own. Button = next unwatched owned movie, release order.
function LibraryProgress({ owned, total, marathon }) {
    const pct = total ? Math.round((owned / total) * 100) : 0;
    return (
        <div className="rounded-2xl bg-base-200/70 backdrop-blur-sm border border-white/5 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
            <div className="flex items-center gap-4 min-w-0">
                <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-full shrink-0" style={{ background: `conic-gradient(var(--color-primary) ${pct * 3.6}deg, rgba(255,255,255,0.08) 0deg)` }}>
                    <div className="absolute inset-[7px] rounded-full bg-base-200 flex items-center justify-center">
                        <span className="text-lg sm:text-xl font-bold text-white leading-none">{pct}%</span>
                    </div>
                </div>
                <div className="min-w-0">
                    <p className="text-sm sm:text-base font-semibold text-white">Library completion</p>
                    <p className="text-xs sm:text-sm text-white/55 mt-0.5">
                        You own <span className="text-primary font-semibold">{owned}</span> of {total} titles
                    </p>
                    {marathon && (
                        <p className="text-xs text-white/40 mt-1">
                            Watched {marathon.watched} of {marathon.total} owned {marathon.total === 1 ? "movie" : "movies"}
                        </p>
                    )}
                </div>
            </div>

            {marathon && (
                <div className="sm:ml-auto min-w-0">
                    {marathon.next ? (
                        <Link
                            to={`/media/${encodeURIComponent(marathon.next.id)}`}
                            className="inline-flex max-w-full items-center justify-center gap-2 h-10 px-5 rounded-md bg-primary text-primary-content text-xs font-bold hover:opacity-90 active:scale-95 transition w-full sm:w-auto">
                            <Play size={14} fill="currentColor" className="shrink-0" />
                            <span className="truncate">
                                Up next: {marathon.next.title}
                                {marathon.next.year ? ` (${marathon.next.year})` : ""}
                            </span>
                        </Link>
                    ) : (
                        <span className="text-xs font-semibold text-success">All owned movies watched</span>
                    )}
                </div>
            )}
        </div>
    );
}

// true once the element has scrolled into view (fires once) — drives the fill-in animations
function useInView(threshold = 0.25) {
    const ref = useRef(null);
    const [on, setOn] = useState(false);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        if (typeof IntersectionObserver === "undefined") {
            setOn(true);
            return;
        }
        const io = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setOn(true);
                    io.disconnect();
                }
            },
            { threshold },
        );
        io.observe(el);
        return () => io.disconnect();
    }, [threshold]);
    return [ref, on];
}

// Titles per year. Straight segments + a dot (and stem) on every year that has titles,
// so each value belongs to exactly one year. Hover any year for a tooltip.
function CareerLine({ byYear, peakDecade }) {
    const n = byYear.length;
    const max = Math.max(...byYear.map((d) => d.count), 1);
    const xAt = (i) => ((i + 0.5) / n) * 100;
    const yAt = (c) => 92 - (c / max) * 78; // 14 … 92 (top room for the peak dot)
    const pts = byYear.map((d, i) => [xAt(i), yAt(d.count)]);
    const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ");
    const area = `${line} L${pts[n - 1][0]},100 L${pts[0][0]},100 Z`;
    const peakIdx = byYear.reduce((best, d, i) => (d.count > byYear[best].count ? i : best), 0);
    const [chartRef, on] = useInView();

    // x labels: every decade + first/last year, skipping ones that would crowd a neighbour
    const minGap = Math.max(2, Math.round(n * 0.14));
    const ticks = byYear.map((d, i) => i).filter((i) => byYear[i].year % 10 === 0);
    if (!ticks.length || ticks[0] >= minGap) ticks.unshift(0);
    if (n - 1 - ticks[ticks.length - 1] >= minGap) ticks.push(n - 1);

    return (
        <div className="flex-1 flex flex-col">
            <div ref={chartRef} className="relative h-36 sm:h-44">
                {/* line, area, stems and dots wipe in left → right, same direction as the genre bars */}
                <div
                    className="absolute inset-0 transition-[clip-path] duration-[1400ms] ease-out motion-reduce:transition-none"
                    style={{ clipPath: on ? "inset(-10px -10px -10px -10px)" : "inset(-10px 100% -10px -10px)" }}>
                    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full overflow-visible" aria-hidden="true">
                        <defs>
                            <linearGradient id="careerFill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" style={{ stopColor: "var(--color-primary)", stopOpacity: 0.32 }} />
                                <stop offset="100%" style={{ stopColor: "var(--color-primary)", stopOpacity: 0 }} />
                            </linearGradient>
                        </defs>
                        {[14, 53, 92].map((y) => (
                            <line
                                key={y}
                                x1="0"
                                x2="100"
                                y1={y}
                                y2={y}
                                stroke="rgba(255,255,255,0.07)"
                                strokeWidth="1"
                                strokeDasharray={y === 92 ? undefined : "3 5"}
                                vectorEffect="non-scaling-stroke"
                            />
                        ))}
                        <path d={area} fill="url(#careerFill)" />
                        {/* stems: tie each point to its own year on the baseline */}
                        {byYear.map(
                            (d, i) =>
                                d.count > 0 && (
                                    <line key={d.year} x1={pts[i][0]} x2={pts[i][0]} y1={pts[i][1]} y2="92" stroke="rgba(255,255,255,0.12)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                                ),
                        )}
                        <path d={line} fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                    </svg>

                    {/* a dot on every year that has titles */}
                    {byYear.map((d, i) =>
                        d.count > 0 ? (
                            <span
                                key={d.year}
                                className="absolute w-1.5 h-1.5 rounded-full bg-primary -translate-x-1/2 translate-y-1/2 pointer-events-none"
                                style={{ left: `${xAt(i)}%`, bottom: `${100 - yAt(d.count)}%` }}
                            />
                        ) : null,
                    )}

                    {/* peak marker */}
                    <span
                        className={`absolute w-2.5 h-2.5 rounded-full bg-primary ring-4 ring-primary/25 -translate-x-1/2 translate-y-1/2 pointer-events-none transition-transform duration-500 delay-1000 motion-reduce:transition-none ${on ? "scale-100" : "scale-0"}`}
                        style={{ left: `${xAt(peakIdx)}%`, bottom: `${100 - yAt(max)}%` }}
                    />
                </div>

                {/* hover columns — one per year */}
                <div className="absolute inset-0 flex">
                    {byYear.map((d, i) => {
                        const edge = i / Math.max(n - 1, 1);
                        const tipPos = edge < 0.12 ? "left-0" : edge > 0.88 ? "right-0" : "left-1/2 -translate-x-1/2";
                        return (
                            <div key={d.year} className="group relative flex-1 h-full cursor-default">
                                <span className="absolute inset-y-0 left-1/2 w-px bg-white/0 group-hover:bg-white/15 transition-colors" />
                                <span
                                    className="absolute left-1/2 w-2.5 h-2.5 -translate-x-1/2 translate-y-1/2 rounded-full bg-base-100 ring-2 ring-primary opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                                    style={{ bottom: `${100 - yAt(d.count)}%` }}
                                />
                                <span
                                    className={`absolute -top-2 ${tipPos} -translate-y-full z-10 whitespace-nowrap px-2 py-1 rounded-md bg-base-300 border border-white/10 text-[11px] text-white/85 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none`}>
                                    <span className="font-semibold">{d.year}</span> · {d.count === 0 ? "no titles" : `${d.count} ${d.count === 1 ? "title" : "titles"}`}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* x axis */}
            <div className="relative h-5 mt-2">
                {ticks.map((i) => (
                    <span key={i} className="absolute top-0 -translate-x-1/2 text-[10px] text-white/45 tabular-nums" style={{ left: `${xAt(i)}%` }}>
                        {byYear[i].year}
                    </span>
                ))}
            </div>

            <p className="mt-auto pt-4 text-xs text-white/45">
                Busiest year: <span className="text-white/80 font-semibold">{byYear[peakIdx].year}</span> · {byYear[peakIdx].count} {byYear[peakIdx].count === 1 ? "title" : "titles"}
                {peakDecade && (
                    <>
                        {" "}
                        · Peak decade <span className="text-white/80 font-semibold">{peakDecade[0]}s</span>
                    </>
                )}
            </p>
        </div>
    );
}

function GenreBars({ genres }) {
    const [ref, on] = useInView();
    const [zero, setZero] = useState(-1); // bar being reset for a hover replay
    const touched = useRef(false); // after the first hover, drop the stagger delay

    // hover (or tap) a bar → it empties and fills up again
    const replay = (i) => {
        if (!on) return;
        touched.current = true;
        setZero(i);
        requestAnimationFrame(() => requestAnimationFrame(() => setZero(-1)));
    };

    return (
        <ul ref={ref} className="flex-1 flex flex-col justify-between gap-3">
            {genres.map((g, i) => (
                <li key={g.name} className="group cursor-default" onPointerEnter={() => replay(i)}>
                    <div className="flex items-center justify-between text-xs">
                        <span className="text-white/80 font-medium group-hover:text-white transition-colors">{g.name}</span>
                        <span
                            className={`text-white/40 tabular-nums transition-opacity duration-500 motion-reduce:transition-none ${on ? "opacity-100" : "opacity-0"}`}
                            style={{ transitionDelay: `${i * 90 + 250}ms` }}>
                            {g.count}
                        </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/8 mt-1 overflow-hidden">
                        <div
                            className={`h-full rounded-full bg-primary/80 group-hover:bg-primary motion-reduce:transition-none ${zero === i ? "" : "transition-[width,background-color] duration-900 ease-out"}`}
                            style={{ width: on && zero !== i ? `${g.pct}%` : "0%", transitionDelay: touched.current ? "0ms" : `${i * 90}ms` }}
                        />
                    </div>
                </li>
            ))}
        </ul>
    );
}

function CoStarCard({ p }) {
    const [err, setErr] = useState(false);
    return (
        <Link to={`/person/${p.pid}?name=${encodeURIComponent(p.name)}`} state={{ name: p.name, photo: p.photo }} className="shrink-0 w-20 sm:w-24 text-center group">
            <div className="relative w-16 h-16 sm:w-20 sm:h-20 mx-auto">
                <div className="w-full h-full rounded-full overflow-hidden bg-base-300 ring-2 ring-white/10 transition-all duration-200 group-hover:ring-primary/60 group-hover:scale-105">
                    {p.photo && !err ? (
                        <img src={p.photo} alt={p.name} className="w-full h-full object-cover" onError={() => setErr(true)} loading="lazy" />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center bg-base-200">
                            <Users size={22} className="text-base-content/30" />
                        </div>
                    )}
                </div>
                {p.count > 1 && (
                    <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-primary text-primary-content whitespace-nowrap">×{p.count}</span>
                )}
            </div>
            <p className="text-[11px] font-medium text-base-content mt-2.5 leading-tight line-clamp-2 group-hover:text-primary transition-colors">{p.name}</p>
        </Link>
    );
}

// Segmented control — equal-width segments on phones (so the row is always full width), compact on desktop.
// Active segment is tinted with the theme primary.
function Segmented({ options, value, onChange, label, className = "" }) {
    return (
        <div role="group" aria-label={label} className={`flex items-stretch h-11 lg:h-10 rounded-md bg-base-100/60 border border-white/8 p-1 ${className}`}>
            {options.map(({ value: v, label: text, icon: Icon }) => (
                <button
                    key={v}
                    onClick={() => onChange(v)}
                    aria-pressed={value === v}
                    className={`flex-1 lg:flex-none lg:px-3.5 px-2 inline-flex items-center justify-center gap-1.5 rounded text-xs font-semibold transition-colors cursor-pointer ${
                        value === v ? "bg-primary/15 text-primary ring-1 ring-inset ring-primary/30" : "text-white/50 hover:text-white"
                    }`}>
                    {Icon && <Icon size={13} />}
                    {text}
                </button>
            ))}
        </div>
    );
}

// Select with a leading icon + chevron; turns primary-tinted once it holds a non-default value
function FilterSelect({ icon: Icon, value, onChange, label, active, children }) {
    return (
        <div className="relative">
            <Icon size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none ${active ? "text-primary" : "text-primary/60"}`} />
            <select
                value={value}
                onChange={onChange}
                aria-label={label}
                className={`h-11 lg:h-10 w-full appearance-none rounded-md border pl-9 pr-8 text-xs font-semibold outline-none cursor-pointer transition-colors focus:border-primary/60 ${
                    active ? "border-primary/50 bg-primary/10 text-primary" : "border-white/8 bg-base-100/60 text-white/80"
                }`}>
                {children}
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
        </div>
    );
}

// Filmography filters. Phones: every control fills its row (no dead space on the right).
// Desktop: one wrapping row that stays pinned under the navbar while the long lists scroll.
function FilmographyToolbar({
    q,
    setQ,
    kind,
    setKind,
    onlyLib,
    setOnlyLib,
    sort,
    setSort,
    decade,
    setDecade,
    decades,
    minRating,
    setMinRating,
    view,
    setView,
    customised,
    onClear,
    matchCount,
    total,
}) {
    const control = "h-11 lg:h-10 rounded-md border border-white/8 bg-base-100/60";
    return (
        <div className="lg:sticky lg:top-14 z-30 mb-4 lg:py-2 lg:-mx-2 lg:px-2 lg:bg-base-100/85 lg:backdrop-blur-md">
            <div className="relative overflow-hidden rounded-xl border border-white/8 bg-base-200/60 p-2.5 sm:p-3">
                <div className="grid grid-cols-2 gap-2 lg:flex lg:flex-wrap lg:items-center lg:gap-2.5">
                    {/* search */}
                    <label className={`${control} col-span-2 lg:col-span-1 lg:w-72 flex items-center gap-2 px-3 focus-within:border-primary/60 focus-within:bg-primary/5 transition-colors`}>
                        <Search size={16} className="text-primary/70 shrink-0" />
                        <input
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                            placeholder="Search title or role…"
                            className="bg-transparent outline-none text-sm text-white placeholder:text-white/35 w-full min-w-0"
                        />
                        {q && (
                            <button onClick={() => setQ("")} aria-label="Clear search" className="text-white/45 hover:text-white cursor-pointer">
                                <X size={14} />
                            </button>
                        )}
                    </label>

                    {/* type */}
                    <Segmented
                        className="col-span-2 lg:col-span-1"
                        label="Type"
                        value={kind}
                        onChange={setKind}
                        options={[
                            { value: "all", label: "All" },
                            { value: "movie", label: "Movies", icon: Film },
                            { value: "tv", label: "TV", icon: Tv },
                        ]}
                    />

                    {/* in library */}
                    <button
                        onClick={() => setOnlyLib((v) => !v)}
                        aria-pressed={onlyLib}
                        className={`${control} flex items-center justify-center gap-2 px-3 text-xs font-semibold transition-colors cursor-pointer ${
                            onlyLib ? "!border-primary/60 !bg-primary/15 text-primary" : "text-white/60 hover:text-white"
                        }`}>
                        {onlyLib ? <Check size={14} /> : <Library size={14} className="text-primary/60" />}
                        In library
                    </button>

                    {/* sort */}
                    <FilterSelect icon={ArrowUpDown} value={sort} onChange={(e) => setSort(e.target.value)} label="Sort filmography" active={sort !== "newest"}>
                        <option value="newest" className="bg-base-200">
                            Newest first
                        </option>
                        <option value="oldest" className="bg-base-200">
                            Oldest first
                        </option>
                        <option value="rating" className="bg-base-200">
                            Top rated
                        </option>
                    </FilterSelect>

                    {/* decade */}
                    <FilterSelect icon={CalendarDays} value={decade} onChange={(e) => setDecade(e.target.value)} label="Filter by decade" active={decade !== "all"}>
                        <option value="all" className="bg-base-200">
                            All years
                        </option>
                        {decades.map((d) => (
                            <option key={d} value={d} className="bg-base-200">
                                {d}s
                            </option>
                        ))}
                    </FilterSelect>

                    {/* minimum rating */}
                    <FilterSelect icon={Star} value={minRating} onChange={(e) => setMinRating(Number(e.target.value))} label="Minimum rating" active={minRating > 0}>
                        <option value={0} className="bg-base-200">
                            Any rating
                        </option>
                        <option value={6} className="bg-base-200">
                            6.0 and up
                        </option>
                        <option value={7} className="bg-base-200">
                            7.0 and up
                        </option>
                        <option value={8} className="bg-base-200">
                            8.0 and up
                        </option>
                    </FilterSelect>

                    {/* view */}
                    <Segmented
                        className="col-span-2 lg:col-span-1 lg:ml-auto"
                        label="Filmography view"
                        value={view}
                        onChange={setView}
                        options={[
                            { value: "timeline", label: "Timeline", icon: GitCommitVertical },
                            { value: "list", label: "List", icon: List },
                        ]}
                    />
                </div>

                {/* result summary — always visible, Clear appears once something is filtered */}
                <div className="mt-3 pt-3 border-t border-white/8 flex items-center justify-between gap-3 text-xs text-white/45">
                    <p>
                        Showing <span className="font-bold text-primary tabular-nums">{matchCount}</span> of <span className="tabular-nums">{total}</span> credits
                    </p>
                    {customised && (
                        <button onClick={onClear} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline cursor-pointer">
                            <X size={12} /> Clear filters
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Filmography section (collapsible) ────────────────────────────────────────
// Long lists (Appearances can hit 200+) render in pages so phones stay smooth.
const PAGE_SIZE = 40;

function FilmographySection({ title, rows, total, defaultOpen, forceOpen, view, watchedIds }) {
    const [openState, setOpen] = useState(defaultOpen);

    const isWatched = (r) => Boolean(r.libId && watchedIds?.has(r.libId));
    const open = openState || forceOpen;
    const [visible, setVisible] = useState(PAGE_SIZE);
    const shown = rows.slice(0, visible);
    const prefix = title === "Actor" || title === "Appearances" ? "as " : "";

    return (
        <div className="rounded-xl bg-base-200/70 border border-white/5 overflow-hidden">
            <button
                onClick={() => setOpen(!open)}
                className="w-full flex items-center justify-between gap-3 px-4 sm:px-5 py-4 min-h-12 cursor-pointer hover:bg-white/3 active:bg-white/5 transition-colors"
                aria-expanded={open}>
                <span className="text-sm sm:text-[15px] font-bold text-white">
                    {title}{" "}
                    <span className="text-white/35 font-medium">
                        · {rows.length}
                        {total !== rows.length ? ` of ${total}` : ""}
                    </span>
                </span>
                {open ? <Minus size={18} className="text-white/50 shrink-0" /> : <Plus size={18} className="text-white/50 shrink-0" />}
            </button>

            {open && (
                <>
                    {view === "timeline" ? (
                        /* daisyUI vertical timeline: year (start) · dot (middle) · title card (end).
                           Column widths are overridden so the year gets a slim column instead of half the row. */
                        <ul className="timeline timeline-vertical border-t border-white/8 px-2 sm:px-5 py-4 [&>li>hr]:w-0.5 [&>li>hr]:min-h-3 [&>li>hr]:bg-white/10">
                            {shown.map((r, i) => {
                                // Owned → real media page. Not owned → same page via tmdb-* id (shows "Not in library")
                                const to = r.libId ? `/media/${encodeURIComponent(r.libId)}` : `/media/tmdb-${r.mediaType}-${r.tmdbId}`;
                                return (
                                    <li key={r.key} className="grid-cols-[2.5rem_auto_minmax(0,1fr)] sm:grid-cols-[3.25rem_auto_minmax(0,1fr)]">
                                        {i > 0 && <hr />}
                                        <div className="timeline-start m-0 pr-2 text-right text-[12px] sm:text-[13px] font-semibold tabular-nums text-white/50">{r.year || "—"}</div>
                                        <div className="timeline-middle">
                                            {r.libId ? (
                                                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-content">
                                                    <Check size={12} strokeWidth={3} />
                                                </span>
                                            ) : (
                                                <span className="flex items-center justify-center w-5 h-5">
                                                    <span className="w-2.5 h-2.5 rounded-full border-2 border-white/30 bg-base-200" />
                                                </span>
                                            )}
                                        </div>
                                        <Link
                                            to={to}
                                            className="timeline-end timeline-box justify-self-stretch block min-w-0 mr-0 ml-2 my-1 px-3 py-2 bg-base-100/50 border-white/8 shadow-none hover:border-primary/40 hover:bg-white/5 transition-colors">
                                            <p className={`text-[13px] sm:text-sm font-medium leading-snug wrap-break-word ${r.libId ? "text-primary" : "text-white"}`}>
                                                {r.title}
                                                {isWatched(r) && <Eye size={12} aria-label="Watched" className="inline ml-1.5 text-success align-[-1px]" />}
                                            </p>
                                            {r.sub && (
                                                <p className="text-[12px] text-white/50 leading-snug mt-0.5 wrap-break-word">
                                                    {prefix}
                                                    {r.sub}
                                                </p>
                                            )}
                                        </Link>
                                        {i < shown.length - 1 && <hr />}
                                    </li>
                                );
                            })}
                        </ul>
                    ) : (
                        <ul className="border-t border-white/8 py-1.5 sm:py-2">
                            {shown.map((r) => {
                                // Owned → real media page. Not owned → same page via tmdb-* id (shows "Not in library")
                                const to = r.libId ? `/media/${encodeURIComponent(r.libId)}` : `/media/tmdb-${r.mediaType}-${r.tmdbId}`;
                                return (
                                    <li key={r.key}>
                                        {/* year | title · as role — text wraps under itself, never under the year */}
                                        <Link
                                            to={to}
                                            className="grid grid-cols-[2.75rem_minmax(0,1fr)] sm:grid-cols-[3.25rem_minmax(0,1fr)] gap-x-3 sm:gap-x-4 items-start px-4 sm:px-5 py-2 sm:py-1.5 hover:bg-white/5 active:bg-white/8 transition-colors">
                                            <span className="text-right text-[12px] sm:text-[13px] leading-snug pt-px tabular-nums text-white/45">{r.year || "—"}</span>
                                            <span className="text-[13px] sm:text-sm leading-snug wrap-break-word">
                                                <span className={`font-medium ${r.libId ? "text-primary" : "text-white"}`}>
                                                    {r.title}
                                                    {isWatched(r) && <Eye size={12} aria-label="Watched" className="inline ml-1.5 text-success align-[-1px]" />}
                                                </span>
                                                {r.sub && <span className="text-white/50">{` · ${prefix}${r.sub}`}</span>}
                                            </span>
                                        </Link>
                                    </li>
                                );
                            })}
                        </ul>
                    )}

                    {rows.length > visible && (
                        <button
                            onClick={() => setVisible((v) => v + PAGE_SIZE * 2)}
                            className="w-full py-3 border-t border-white/8 text-xs font-bold text-primary hover:bg-white/3 active:bg-white/5 transition-colors cursor-pointer">
                            Show {Math.min(PAGE_SIZE * 2, rows.length - visible)} more · {rows.length - visible} left
                        </button>
                    )}
                </>
            )}
        </div>
    );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function PersonSkeleton() {
    return (
        <div className="space-y-8 sm:space-y-10 animate-pulse">
            <div className="flex flex-col items-center sm:items-start sm:flex-row gap-5 sm:gap-8">
                <div className="w-36 sm:w-44 md:w-52 lg:w-60 aspect-2/3 rounded-xl bg-base-300 shrink-0" />
                <div className="w-full flex-1 flex flex-col items-center sm:items-start space-y-3 pt-1">
                    <div className="h-7 sm:h-8 w-56 sm:w-64 rounded bg-base-300" />
                    <div className="h-4 w-44 sm:w-48 rounded bg-base-300" />
                    <div className="h-3 w-32 rounded bg-base-300" />
                    <div className="h-10 sm:h-9 w-40 sm:w-72 rounded-md bg-base-300 mt-3" />
                    <div className="h-3 w-full max-w-3xl rounded bg-base-300 mt-4" />
                    <div className="h-3 w-5/6 max-w-3xl rounded bg-base-300 self-start" />
                    <div className="h-3 w-2/3 max-w-3xl rounded bg-base-300 self-start" />
                </div>
            </div>
            <div className="flex gap-3 overflow-hidden">
                {Array.from({ length: 7 }).map((_, i) => (
                    <div key={i} className="shrink-0 w-36 sm:w-40 aspect-2/3 rounded-xl bg-base-300" />
                ))}
            </div>
        </div>
    );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
const PersonPage = () => {
    const { personId } = useParams();
    const [searchParams] = useSearchParams();
    const { state } = useLocation();
    const { movies, series, anime, history } = useApi();

    const nameParam = searchParams.get("name") || state?.name || "";

    const [person, setPerson] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [bioOpen, setBioOpen] = useState(false);
    const [photoErr, setPhotoErr] = useState(false);
    const [copied, setCopied] = useState(false);

    // back-to-top button (long filmography)
    const [showTop, setShowTop] = useState(false);
    useEffect(() => {
        const onScroll = () => setShowTop(window.scrollY > 800);
        onScroll();
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => window.removeEventListener("scroll", onScroll);
    }, []);
    const watchedIds = useMemo(() => new Set((history || []).filter((h) => h.completed).map((h) => h.id)), [history]);

    // filmography filters
    const [q, setQ] = useState("");
    const [kind, setKind] = useState("all");
    const [onlyLib, setOnlyLib] = useState(false);
    const [sort, setSort] = useState("newest");
    const [decade, setDecade] = useState("all"); // "all" | 2020 | 2010 | …
    const [minRating, setMinRating] = useState(0); // 0 = any
    const [view, setView] = useState("timeline"); // "timeline" | "list"

    // TMDB genre names for titles that are not in the library
    const [genreMap, setGenreMap] = useState(null);
    useEffect(() => {
        let alive = true;
        loadGenreMap().then((m) => alive && setGenreMap(m));
        return () => {
            alive = false;
        };
    }, []);

    useEffect(() => {
        window.scrollTo(0, 0);
        let cancelled = false;
        setLoading(true);
        setError(null);
        setPerson(null);
        setBioOpen(false);
        setPhotoErr(false);
        setQ("");
        setKind("all");
        setOnlyLib(false);
        setSort("newest");
        setDecade("all");
        setMinRating(0);

        fetchPerson(personId, nameParam)
            .then((d) => {
                if (cancelled) return;
                setPerson(d);
                setLoading(false);
            })
            .catch((err) => {
                if (cancelled) return;
                setError(err.message === "NO_KEY" ? "Set VITE_TMDB_API_KEY in web/.env to load person details." : "Failed to load person.");
                setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [personId, nameParam]);

    // ── Derived data ──────────────────────────────────────────────────────────
    const libIndex = useMemo(() => buildLibraryIndex(movies, series, anime), [movies, series, anime]);

    const filmography = useMemo(() => (person ? buildFilmography(person.combined_credits, libIndex) : []), [person, libIndex]);

    const knownFor = useMemo(() => (person ? buildKnownFor(person, libIndex) : []), [person, libIndex]);

    // Everything this person is in that the user owns — de-duped by library id
    const libraryItems = useMemo(() => {
        if (!person) return [];
        const out = new Map();
        const cc = person.combined_credits || {};
        for (const c of [...(cc.cast || []), ...(cc.crew || [])]) {
            const hit = libIndex.get(creditKey(c));
            if (hit && !out.has(hit.id)) out.set(hit.id, hit.raw);
        }
        for (const hit of findByPersonId(person.id, movies, series, anime)) {
            if (!out.has(hit.id)) out.set(hit.id, hit.raw);
        }
        return [...out.values()];
    }, [person, libIndex, movies, series, anime]);

    // "Actor, Producer, Director, Writer" line
    const roleLine = useMemo(() => {
        const labels = filmography.map((s) => s.title).filter((t) => t !== "Appearances");
        return labels.slice(0, 4).join(", ");
    }, [filmography]);

    const insights = useMemo(() => (person ? buildInsights(person, libIndex, genreMap) : null), [person, libIndex, genreMap]);

    const coStars = useMemo(() => (person ? buildCoStars(libraryItems, person.id, person.name) : []), [person, libraryItems]);

    const marathon = useMemo(() => buildMarathon(libraryItems, history), [libraryItems, history]);

    // Soft backdrop for the header: most popular title of theirs that has one
    const heroBackdrop = useMemo(() => {
        const cc = person?.combined_credits;
        if (!cc) return null;
        const best = [...(cc.cast || []), ...(cc.crew || [])].filter((c) => c.backdrop_path && !isAppearance(c)).sort((a, b) => (b.popularity || 0) - (a.popularity || 0))[0];
        return best ? `${IMG_BASE}/w1280${best.backdrop_path}` : null;
    }, [person]);

    // Filmography after search / type / library / sort filters
    const filtering = q.trim() !== "" || kind !== "all" || onlyLib || decade !== "all" || minRating > 0;
    const customised = filtering || sort !== "newest";
    const shownSections = useMemo(() => {
        const needle = q.trim().toLowerCase();
        const score = (r) => (r.votes >= 20 ? r.rating : 0);
        return filmography
            .map((sec) => {
                let rows = sec.rows.filter(
                    (r) =>
                        (kind === "all" || r.mediaType === kind) &&
                        (!onlyLib || r.libId) &&
                        (decade === "all" || (r.year && Math.floor(Number(r.year) / 10) * 10 === Number(decade))) &&
                        (!minRating || (r.votes >= 20 && r.rating >= minRating)) &&
                        (!needle || r.title.toLowerCase().includes(needle) || (r.sub || "").toLowerCase().includes(needle)),
                );
                if (sort === "oldest") rows = [...rows].sort((a, b) => -byDateDesc(a, b));
                else if (sort === "rating") rows = [...rows].sort((a, b) => score(b) - score(a));
                return { ...sec, rows, total: sec.rows.length };
            })
            .filter((sec) => sec.rows.length);
    }, [filmography, q, kind, onlyLib, sort, decade, minRating]);
    // decades that actually appear in the filmography, newest first
    const decades = useMemo(() => {
        const set = new Set();
        for (const sec of filmography) for (const r of sec.rows) if (r.year) set.add(Math.floor(Number(r.year) / 10) * 10);
        return [...set].sort((a, b) => b - a);
    }, [filmography]);
    const matchCount = shownSections.reduce((n, sec) => n + sec.rows.length, 0);
    const totalCredits = filmography.reduce((n, sec) => n + sec.rows.length, 0);
    const clearFilters = () => {
        setQ("");
        setKind("all");
        setOnlyLib(false);
        setSort("newest");
        setDecade("all");
        setMinRating(0);
        setDecade("all");
        setMinRating(0);
    };

    // ── Share ─────────────────────────────────────────────────────────────────
    const handleShare = async () => {
        const url = window.location.href;
        const title = person?.name || nameParam;
        try {
            if (navigator.share) {
                await navigator.share({ title, url });
                return;
            }
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
        } catch {
            /* share dismissed */
        }
    };

    // ── Render states ─────────────────────────────────────────────────────────
    if (loading) {
        return (
            <div className="w-full">
                <PersonSkeleton />
            </div>
        );
    }

    if (error || !person) {
        return (
            <div className="w-full">
                <p className="text-sm text-white/50 py-10">{error || `No details found for “${nameParam || "this person"}”.`}</p>
            </div>
        );
    }

    const photo = person.profile_path ? `${IMG_BASE}/w500${person.profile_path}` : state?.photo || null;
    const age = calcAge(person.birthday, person.deathday);
    const bio = person.biography || "";
    const ext = person.external_ids || {};
    const socials = [
        { id: "fb", href: ext.facebook_id && `https://www.facebook.com/${ext.facebook_id}`, icon: <FacebookIcon />, label: "Facebook" },
        { id: "ig", href: ext.instagram_id && `https://www.instagram.com/${ext.instagram_id}`, icon: <InstagramIcon />, label: "Instagram" },
        { id: "x", href: ext.twitter_id && `https://x.com/${ext.twitter_id}`, icon: <XIcon />, label: "X" },
    ].filter((s) => s.href);

    return (
        <div className="relative -m-4 sm:-m-6 lg:-m-8 overflow-x-clip">
            {/* Ambient backdrop — full-bleed, fades into the page */}
            {heroBackdrop && (
                <div aria-hidden="true" className="absolute inset-x-0 top-0 h-120 pointer-events-none overflow-hidden">
                    <img src={heroBackdrop} alt="" className="w-full h-full object-cover opacity-30 blur-[2px] scale-105" onError={(e) => (e.currentTarget.style.display = "none")} />
                    <div className="absolute inset-0 bg-linear-to-b from-base-100/30 via-base-100/80 to-base-100" />
                    <div className="absolute inset-0 bg-linear-to-r from-base-100/70 via-transparent to-base-100/70" />
                </div>
            )}

            <div className="relative p-4 sm:p-6 lg:p-8 space-y-8 sm:space-y-10">
                <div>
                    {/* ── Header ───────────────────────────────────────────────── */}
                    <header className="flex flex-col items-center sm:items-start sm:flex-row gap-5 sm:gap-8 lg:gap-10">
                        <div className="w-36 sm:w-44 md:w-52 lg:w-60 aspect-2/3 rounded-xl overflow-hidden bg-base-300 shrink-0 shadow-xl">
                            {photo && !photoErr ? (
                                <img src={photo} alt={person.name} className="w-full h-full object-cover" onError={() => setPhotoErr(true)} />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                    <Users size={40} className="text-white/20" />
                                </div>
                            )}
                        </div>

                        <div className="min-w-0 w-full flex-1 text-center sm:text-left">
                            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white leading-tight wrap-break-word">{person.name}</h1>
                            {roleLine && <p className="text-sm sm:text-base lg:text-lg font-semibold text-white/70 mt-1.5">{roleLine}</p>}

                            {person.birthday && (
                                <p className="text-xs text-white/55 mt-3">
                                    {fmtDate(person.birthday)}
                                    {person.deathday ? ` – ${fmtDate(person.deathday)}` : ""}
                                    {age !== null && ` (${person.deathday ? `aged ${age}` : `${age} years`})`}
                                </p>
                            )}
                            {person.place_of_birth && <p className="text-xs text-white/40 mt-1">{person.place_of_birth}</p>}
                            {person.also_known_as?.length > 0 && (
                                <p className="hidden sm:block text-[11px] text-white/30 mt-1 truncate">Also known as {person.also_known_as.slice(0, 3).join(" · ")}</p>
                            )}

                            {/* Share + socials */}
                            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-4 mt-4 sm:mt-5">
                                <button
                                    onClick={handleShare}
                                    className="inline-flex items-center gap-2 h-10 sm:h-9 px-5 sm:px-4 rounded-md bg-white text-black text-xs font-bold hover:bg-white/90 active:scale-95 transition cursor-pointer">
                                    {copied ? <Check size={14} /> : <Share2 size={14} />}
                                    {copied ? "Link copied" : "Share"}
                                </button>
                                {socials.map((s) => (
                                    <a key={s.id} href={s.href} target="_blank" rel="noreferrer" aria-label={s.label} className="text-white/70 hover:text-white transition-colors">
                                        {s.icon}
                                    </a>
                                ))}
                            </div>

                            {/* Bio */}
                            {bio && (
                                <div className="mt-4 sm:mt-5 max-w-3xl xl:max-w-4xl text-left">
                                    <p className={`text-[13px] text-white/75 leading-relaxed whitespace-pre-line ${bioOpen ? "" : "line-clamp-3"}`}>{bio}</p>
                                    {bio.length > 260 && (
                                        <button
                                            onClick={() => setBioOpen((v) => !v)}
                                            className="mt-1.5 py-1 inline-flex items-center gap-0.5 text-xs sm:text-[11px] font-bold text-primary hover:text-primary/80 cursor-pointer">
                                            {bioOpen ? "Less" : "More"}
                                            <ChevronDown size={12} className={`transition-transform ${bioOpen ? "rotate-180" : ""}`} />
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    </header>
                </div>

                {/* ── Career at a glance + library completion ───────────────────── */}
                {insights && (
                    <section>
                        <SectionTitle>Career at a glance</SectionTitle>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                            <StatCard label="Titles" value={insights.total} sub={`${insights.movies} movies · ${insights.tv} shows`} />
                            <StatCard
                                label="Active"
                                value={insights.first ? (insights.first === insights.last ? insights.first : `${insights.first}–${insights.last}`) : "—"}
                                sub={insights.first ? `${Math.max(insights.last - insights.first, 1)} year career` : "No release dates"}
                            />
                            <StatCard label="Avg rating" value={insights.avg ? `★ ${insights.avg}` : "—"} sub="Titles with 300+ votes" />
                            <StatCard
                                label="Highest rated"
                                value={insights.best ? insights.best.title : "—"}
                                sub={insights.best ? `★ ${insights.best.rating}` : "Not enough votes yet"}
                                to={insights.best?.to}
                            />
                        </div>
                        <div className="mt-3">
                            <LibraryProgress owned={insights.owned} total={insights.total} marathon={marathon} />
                        </div>
                    </section>
                )}

                {/* ── In your library ──────────────────────────────────────────── */}
                <MediaRow title="Movies & Shows in Your Library" items={libraryItems} />

                {/* ── Known For ─────────────────────────────────────────────────── */}
                <MediaRow title="Known For" items={knownFor} />

                {/* ── Coming up ─────────────────────────────────────────────────── */}
                <MediaRow title="Coming Up" items={insights?.upcoming ?? []} />

                {/* ── Timeline + genre mix ──────────────────────────────────────── */}
                {insights && (insights.byYear.length > 1 || insights.genres.length > 0) && (
                    <section className="grid gap-4 lg:grid-cols-5 items-stretch">
                        {insights.byYear.length > 1 && (
                            <div className={`${insights.genres.length ? "lg:col-span-3" : "lg:col-span-5"} flex flex-col rounded-2xl bg-base-200/70 border border-white/5 p-4 sm:p-5`}>
                                <SectionTitle className="mb-4">Career timeline</SectionTitle>
                                <CareerLine byYear={insights.byYear} peakDecade={insights.peakDecade} />
                            </div>
                        )}
                        {insights.genres.length > 0 && (
                            <div className={`${insights.byYear.length > 1 ? "lg:col-span-2" : "lg:col-span-5"} flex flex-col rounded-2xl bg-base-200/70 border border-white/5 p-4 sm:p-5`}>
                                <SectionTitle className="mb-4">Genre mix</SectionTitle>
                                <GenreBars genres={insights.genres} />
                            </div>
                        )}
                    </section>
                )}

                {/* ── Co-stars found in your own library ────────────────────────── */}
                {coStars.length > 0 && (
                    <section>
                        <SectionTitle className="mb-1">Co-stars in your library</SectionTitle>
                        <p className="text-xs text-white/40 mb-3">People who appear with {person.name} in titles you own</p>
                        <div className="flex gap-4 overflow-x-auto pb-2" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                            {coStars.map((p) => (
                                <CoStarCard key={p.key} p={p} />
                            ))}
                        </div>
                    </section>
                )}

                {/* ── Filmography ───────────────────────────────────────────────── */}
                {filmography.length > 0 && (
                    <section>
                        <h2 className="text-base sm:text-lg lg:text-xl font-semibold text-base-content mb-3">Filmography</h2>
                        <FilmographyToolbar
                            q={q}
                            setQ={setQ}
                            kind={kind}
                            setKind={setKind}
                            onlyLib={onlyLib}
                            setOnlyLib={setOnlyLib}
                            sort={sort}
                            decade={decade}
                            setDecade={setDecade}
                            decades={decades}
                            minRating={minRating}
                            setMinRating={setMinRating}
                            setSort={setSort}
                            view={view}
                            setView={setView}
                            customised={customised}
                            onClear={clearFilters}
                            matchCount={matchCount}
                            total={totalCredits}
                        />
                        {shownSections.length === 0 ? (
                            <p className="text-sm text-white/45 py-8 text-center">No titles match these filters.</p>
                        ) : (
                            <div className="space-y-3">
                                {shownSections.map((sec) => (
                                    <FilmographySection
                                        key={sec.title}
                                        title={sec.title}
                                        rows={sec.rows}
                                        total={sec.total}
                                        defaultOpen={sec.open}
                                        forceOpen={filtering}
                                        view={view}
                                        watchedIds={watchedIds}
                                    />
                                ))}
                            </div>
                        )}
                    </section>
                )}
            </div>

            <button
                onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                aria-label="Back to top"
                className={`fixed bottom-5 right-4 sm:right-6 z-40 w-10 h-10 rounded-md bg-base-300/90 backdrop-blur border border-white/10 flex items-center justify-center shadow-lg hover:bg-base-200 active:scale-95 transition-all duration-200 cursor-pointer ${showTop ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3 pointer-events-none"}`}>
                <ChevronUp size={18} className="text-white/80" />
            </button>
        </div>
    );
};

export default PersonPage;
