import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router";
import { useApi } from "../../Context/apiContext";
import { useRecommendations, useRefreshRecommendations } from "../../Hooks/useRecommendations";
import MediaCard from "../../Components/MediaCard";

// ============================================================================
// RecommendationsPage.jsx — multi-section discovery page.
//
// CLIENT-SIDE ONLY, on purpose: every section below is derived from data the
// app already has loaded via useApi() (movies/series/anime with their .metadata,
// history, favourites, watchlist) plus the existing personalized
// GET /api/recommendations list (useRecommendations()). No new backend
// endpoint, no new API call beyond what Home already fetches — this page is
// just a different arrangement of already-loaded data.
//
// SimilarMedia.jsx was not touched, read, or referenced to build this.
//
// HERO BANNER: self-managing. useHeroBanner() picks the LATEST movies, series
// and anime (release date first, library-added date second), saves the set in
// localStorage with a random 3–7 day lifetime, shows it until it expires, then
// rebuilds it from whatever is newest at that point. Slides whose media left the library are dropped and the
// set is repaired without resetting the 3–7 day clock.
// ============================================================================

const SECTION_SIZE = 12;
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // "Trending" window
const NEW_LIBRARY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // "sat in library a while" threshold for Missed

// ── Hero banner config ─────────────────────────────────────────────────────
const DAY_MS = 24 * 60 * 60 * 1000;
const BANNER_MIN_MS = 3 * DAY_MS; // banner lives at least 3 days...
const BANNER_MAX_MS = 7 * DAY_MS; // ...and at most 7 (random in between)
const HERO_NEW_DAYS = 45; // "Latest ..." tag only for titles released within this many days
const HERO_SLIDES = 15; // slides per banner set
const HERO_MIN_SLIDES = 5; // below this (after removals / deletions) repair the set
const HERO_AUTOPLAY_MS = 3000;
const HERO_MIN_VOTES = 300; // "popular" = enough TMDB votes...
const HERO_MIN_RATING = 6.5; // ...and a decent rating
const HERO_SLIDE_MS = 800; // slide AND fade share this one duration
const HERO_EASE = "cubic-bezier(0.4, 0, 0.2, 1)"; // smooth ease-in-out, used by slide + fade
const HERO_ZOOM_MS = 1800; // slow image zoom-out while a slide settles
const HERO_TEXT_DELAY_MS = 300; // text starts a beat after the slide begins to move
const HERO_STAGGER_MS = 90; // gap between consecutive text elements
const HERO_TEXT_MS = 1000; // duration of each text element's entrance
const HERO_TEXT_EASE = "cubic-bezier(0.16, 1, 0.3, 1)"; // expo-out: fast start, long silky settle
const HERO_SPRING = "cubic-bezier(0.34, 1.4, 0.64, 1)"; // tiny overshoot, used by buttons
const HERO_SHIFT = 35; // % a slide drifts while it fades (small drift = no gaps)
// Landscape rectangle on every device; height capped so it never fills the screen.
const HERO_SIZE = "w-full aspect-[16/9] sm:aspect-[2/1] lg:aspect-[2.3/1] max-h-[230px] sm:max-h-[340px] lg:max-h-[400px] 2xl:max-h-[450px]";
const BANNER_STORAGE_KEY = "flux.heroBanner.v4";
const BANNER_HIDDEN_KEY = "flux.heroBanner.hidden.v1";

function norm(s) {
    return (s ?? "").toString().toLowerCase().trim();
}

function titleCase(s) {
    return (s ?? "").toString().replace(/\b\w/g, (c) => c.toUpperCase());
}

// History is recorded per-FILE (a movie's own id, or one episode's file id),
// but series/anime are grouped into one card per show. This maps any
// episode file id back to its parent card, using the seasons/episodes
// structure every series/anime item already carries.
function buildFileToItemMap(series, anime) {
    const map = new Map();
    for (const item of [...series, ...anime]) {
        for (const season of Object.values(item.seasons || {})) {
            for (const ep of season.episodes || []) map.set(ep.id, item);
        }
    }
    return map;
}

// Multi-category overlap score with a real qualification gate — replaces the
// old genre+keyword-only version that qualified on any score > 0 (a single
// weak shared genre was enough, which is what made this page feel random).
// Now: genres, keywords, important cast/crew, and an exact collection match
// all contribute; a candidate must hit at least 2 DISTINCT categories to
// qualify (a lone genre match no longer counts on its own) — a real
// collection/franchise match is the one exception, since that's specific
// enough to stand alone. Still not the backend engine's or SimilarMedia's
// algorithm — a third, deliberately lighter one, but no longer a naive one.
const IMPORTANT_JOBS = new Set(["Director", "Writer", "Screenplay", "Story", "Producer", "Executive Producer", "Editor"]);
const MIN_OVERLAP_SCORE = 8;
const MIN_OVERLAP_CATEGORIES = 2;

function overlapScore(itemA, itemB) {
    let score = 0;
    let categories = 0;

    const gA = new Set((itemA?.metadata?.genres || []).map(norm));
    const gB = new Set((itemB?.metadata?.genres || []).map(norm));
    let gHit = 0;
    for (const g of gB) if (gA.has(g)) gHit++;
    if (gHit) {
        score += Math.min(gHit * 4, 16);
        categories++;
    }

    const kA = new Set((itemA?.metadata?.keywords || []).map((k) => norm(typeof k === "string" ? k : k?.name)));
    const kB = new Set((itemB?.metadata?.keywords || []).map((k) => norm(typeof k === "string" ? k : k?.name)));
    let kHit = 0;
    for (const k of kB) if (kA.has(k)) kHit++;
    if (kHit) {
        score += Math.min(kHit * 3, 12);
        categories++;
    }

    const peopleIds = (item) =>
        new Set(
            [...(item?.metadata?.cast || []).map((c) => c?.tmdbPersonId), ...(item?.metadata?.crew || []).filter((c) => IMPORTANT_JOBS.has(c?.job)).map((c) => c?.tmdbPersonId)].filter(
                (v) => v != null,
            ),
        );
    const peopleA = peopleIds(itemA);
    let pHit = 0;
    for (const p of peopleIds(itemB)) if (peopleA.has(p)) pHit++;
    if (pHit) {
        score += Math.min(pHit * 5, 15);
        categories++;
    }

    const collectionHit = itemA?.metadata?.collection?.tmdbId != null && itemA.metadata.collection.tmdbId === itemB?.metadata?.collection?.tmdbId;
    if (collectionHit) score += 20;

    return { score, categories, collectionHit };
}

function bestOverlap(sources, candidate) {
    // Best SINGLE matching source, not summed across all of them — summing
    // meant someone with many favourites got inflated scores on everything
    // regardless of true match quality, which was its own source of
    // "feels random" (more favourites = bigger numbers, not better matches).
    let best = { score: 0, categories: 0, collectionHit: false };
    for (const source of sources) {
        const r = overlapScore(source, candidate);
        if (r.score > best.score) best = r;
    }
    return best;
}

function overlapQualifies(result) {
    return result.collectionHit || (result.score >= MIN_OVERLAP_SCORE && result.categories >= MIN_OVERLAP_CATEGORIES);
}

function genreTally(items) {
    const tally = {};
    for (const item of items) {
        for (const g of item?.metadata?.genres || item?.category || []) {
            const k = norm(g);
            if (k) tally[k] = (tally[k] || 0) + 1;
        }
    }
    return tally;
}

// ============================================================================
// Hero banner engine
// ============================================================================

function loadBanner() {
    try {
        const raw = JSON.parse(localStorage.getItem(BANNER_STORAGE_KEY));
        if (raw && Array.isArray(raw.slides) && typeof raw.expiresAt === "number") return raw;
    } catch {
        /* ignore corrupt / unavailable storage */
    }
    return null;
}

function saveBanner(banner) {
    try {
        localStorage.setItem(BANNER_STORAGE_KEY, JSON.stringify(banner));
    } catch {
        /* ignore quota / private mode */
    }
}

function loadHidden() {
    try {
        const raw = JSON.parse(localStorage.getItem(BANNER_HIDDEN_KEY));
        if (Array.isArray(raw)) return new Set(raw);
    } catch {
        /* ignore */
    }
    return new Set();
}

function saveHidden(set) {
    try {
        localStorage.setItem(BANNER_HIDDEN_KEY, JSON.stringify([...set].slice(-300)));
    } catch {
        /* ignore */
    }
}

// Banner = the LATEST media: real release date first (TMDB releaseDate /
// firstAirDate), then library-added date (metadata.date) as tie-breaker /
// fallback for items without a release date. Only popular titles (votes +
// rating) qualify first; mature-rated (R / NC-17 / TV-MA ...) never appear.
// Global ranking across movies, series and anime, no per-type quota.
const typeLabel = { movie: "Latest Movie", series: "Latest Series", anime: "Latest Anime" };

// Badge text, computed at render time from the release date so it flips on
// its own the day a title passes HERO_NEW_DAYS:
//   released ≤ 45 days ago  → "Latest Movie" / "Latest Series" / "Latest Anime"
//   older                   → Top Rated / Fan Favorite / Recent Hit / Featured
//   no release info at all  → "Just Added"
function heroTag(item, type) {
    const { rel } = latestRank(item);
    if (rel === -Infinity) return "Just Added";
    const ageDays = (Date.now() - rel) / DAY_MS;
    if (ageDays <= HERO_NEW_DAYS) return typeLabel[type] || "Latest Release";
    const m = item.metadata || {};
    if ((m.rating || 0) >= 8) return "Top Rated";
    if ((m.votes || 0) >= 1500) return "Fan Favorite";
    if (ageDays <= 365) return "Recent Hit";
    return "Featured";
}

function latestRank(item) {
    const m = item.metadata || {};
    // Release date → else just the year (Jan 1) → else unknown.
    let relMs = NaN;
    const rel = m.releaseDate || m.firstAirDate;
    if (rel) relMs = new Date(rel).getTime();
    if (!Number.isFinite(relMs) && m.year && Number.isFinite(Number(m.year))) relMs = Date.UTC(Number(m.year), 0, 1);
    const addMs = m.date ? new Date(m.date).getTime() : NaN;
    return { rel: Number.isFinite(relMs) ? relMs : -Infinity, add: Number.isFinite(addMs) ? addMs : -Infinity };
}

function byLatest(a, b) {
    const ra = latestRank(a);
    const rb = latestRank(b);
    if (rb.rel !== ra.rel) return rb.rel > ra.rel ? 1 : -1; // release date first
    if (rb.add !== ra.add) return rb.add > ra.add ? 1 : -1; // then added date
    return 0;
}

// ── Certification lookup (TMDB) ─────────────────────────────────────────────
// Banner must never show R / NC-17 / TV-MA titles. Metadata often has no
// certification, so picked titles are verified against TMDB (US rating); the
// answer is cached in localStorage and isMature() consults that cache, so a
// title known to be restricted is dropped by every banner filter instantly.
const TMDB_KEY = import.meta.env.VITE_TMDB_API_KEY;
const TMDB_BASE = "https://api.themoviedb.org/3";
const CERT_CACHE_KEY = "flux.certs.v1";
let _certs = null;
function certStore() {
    if (!_certs) {
        try {
            _certs = JSON.parse(localStorage.getItem(CERT_CACHE_KEY)) || {};
        } catch {
            _certs = {};
        }
    }
    return _certs;
}
function saveCerts() {
    try {
        localStorage.setItem(CERT_CACHE_KEY, JSON.stringify(certStore()));
    } catch {
        /* ignore quota / private mode */
    }
}
const certTarget = (item) => {
    const t = item.metadata?.tmdbId;
    return t ? { kind: item.seasons ? "tv" : "movie", id: String(t) } : null;
};
const isBlockedCert = (c) =>
    BLOCKED_CERTS.has(
        String(c || "")
            .trim()
            .toUpperCase(),
    );

async function fetchCert(kind, tmdbId) {
    if (!TMDB_KEY || !tmdbId) return "";
    const key = `${kind}:${tmdbId}`;
    const store = certStore();
    const hit = store[key];
    if (hit && Date.now() - hit.t < (hit.c ? 30 : 3) * DAY_MS) return hit.c;
    try {
        let c = "";
        if (kind === "movie") {
            const j = await (await fetch(`${TMDB_BASE}/movie/${tmdbId}/release_dates?api_key=${TMDB_KEY}`)).json();
            const us = (j.results || []).find((x) => x.iso_3166_1 === "US");
            const certs = (us?.release_dates || []).map((d) => d.certification).filter(Boolean);
            c = certs.find(isBlockedCert) || certs[0] || "";
        } else {
            const j = await (await fetch(`${TMDB_BASE}/tv/${tmdbId}/content_ratings?api_key=${TMDB_KEY}`)).json();
            c = (j.results || []).find((x) => x.iso_3166_1 === "US")?.rating || "";
        }
        store[key] = { c, t: Date.now() };
        saveCerts();
        return c;
    } catch {
        return ""; // network problem → unknown, don't cache
    }
}

// Build → verify the picked titles → if any is restricted (now cached, so the next
// build skips it) build again. Up to 4 rounds.
async function generateBannerVerified(build, poolById) {
    let banner = build();
    for (let round = 0; round < 4; round++) {
        const certs = await Promise.all(
            banner.slides.map((sl) => {
                const t = certTarget(poolById.get(sl.id) || {});
                return t ? fetchCert(t.kind, t.id) : "";
            }),
        );
        if (!certs.some(isBlockedCert)) break;
        banner = build();
    }
    return banner;
}

// Mature-rating filter. Checks every field a TMDB-derived metadata object
// might carry its certification in; also honours an `adult` flag.
const BLOCKED_CERTS = new Set(["R", "NC-17", "NC17", "X", "XXX", "TV-MA", "18", "18+", "18A", "R18", "R18+", "R-18", "AO"]);

function isMature(item) {
    const m = item.metadata || {};
    if (m.adult === true) return true;
    const raw = [m.certification, m.contentRating, m.mpaa, m.mpaaRating, m.rated, m.ageRating, m.maturityRating, ...(Array.isArray(m.certifications) ? m.certifications : [])];
    for (const v of raw) {
        if (v == null) continue;
        const c = String(typeof v === "object" ? v.certification || v.rating || "" : v)
            .trim()
            .toUpperCase()
            .replace(/^RATED\s+/, "");
        if (c && BLOCKED_CERTS.has(c)) return true;
    }
    const t = certTarget(item);
    const cached = t ? certStore()[`${t.kind}:${t.id}`] : null;
    return Boolean(cached && isBlockedCert(cached.c));
}

function isPopular(item) {
    const m = item.metadata || {};
    return (m.votes || 0) >= HERO_MIN_VOTES && (m.rating || 0) >= HERO_MIN_RATING;
}

function generateBanner(ctx, prev, hiddenIds, keepExpiresAt) {
    const hasArt = (i) => i.metadata?.backdrop || i.metadata?.poster;
    const all = ctx.pool.filter((i) => !hiddenIds.has(i.id) && !isMature(i));
    const withArt = all.filter(hasArt);
    const ranked = [...(withArt.length ? withArt : all)].sort(byLatest);

    // Popular titles first (newest → oldest); only if there aren't enough
    // popular ones do less-popular newest titles fill the remaining slots.
    const picked = [...ranked.filter(isPopular), ...ranked.filter((i) => !isPopular(i))].slice(0, HERO_SLIDES).sort(byLatest);

    const slides = picked.map((i) => ({
        id: i.id,
        reason: latestRank(i).rel === -Infinity ? "Just Added" : typeLabel[ctx.typeById.get(i.id)] || "New Release",
    }));

    const createdAt = Date.now();
    return {
        createdAt,
        expiresAt: keepExpiresAt ?? createdAt + BANNER_MIN_MS + Math.random() * (BANNER_MAX_MS - BANNER_MIN_MS),
        slides,
    };
}

// Owns the banner lifecycle: load → show → expire → regenerate.
//   ctx   = { pool, typeById } | null
//   ready = recommendations finished loading (so "Picked for You" can be used)
function useHeroBanner(ctx, ready) {
    const [stored, setStored] = useState(loadBanner);
    const [now, setNow] = useState(() => Date.now());

    // Re-check expiry while the page stays open.
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 60 * 1000);
        return () => clearInterval(t);
    }, []);

    const poolById = useMemo(() => new Map((ctx?.pool || []).map((i) => [i.id, i])), [ctx]);

    // Saved ids → live items (fresh metadata). Deleted media silently drops out.
    const slides = useMemo(() => {
        if (!stored) return [];
        return stored.slides
            .map((s) => {
                const item = poolById.get(s.id);
                return item ? { ...item, _heroReason: heroTag(item, ctx?.typeById?.get(item.id)) } : null;
            })
            .filter(Boolean);
    }, [stored, poolById, ctx]);

    // Selection is deterministic ("latest"), so the saved set is stale the
    // moment the library's real top-N changes (new media added, metadata
    // fetched) — rebuild then instead of waiting out the 3–7 day timer.
    const freshIds = useMemo(
        () =>
            ctx
                ? generateBanner(ctx, null, loadHidden(), 0)
                      .slides.map((s) => s.id)
                      .join("|")
                : null,
        [ctx],
    );
    const stale = !!stored && freshIds != null && stored.slides.map((s) => s.id).join("|") !== freshIds;

    const expired = !stored || now >= stored.expiresAt;
    const broken = !!stored && stored.slides.length >= HERO_MIN_SLIDES && slides.length < HERO_MIN_SLIDES;
    const needsNew = ready && !!ctx && (expired || broken || stale);

    useEffect(() => {
        if (!needsNew) return;
        // Expired → brand-new 3–7 day cycle. Broken (media removed) → repair
        // the set but keep the existing clock.
        const keep = stored && !expired ? stored.expiresAt : null;
        let alive = true;
        generateBannerVerified(() => generateBanner(ctx, stored, loadHidden(), keep), poolById).then((next) => {
            if (!alive) return;
            saveBanner(next);
            setStored(next);
        });
        return () => {
            alive = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [needsNew]);

    // Manual "new picks" — fresh set + fresh 3–7 day clock.
    const refresh = useCallback(() => {
        if (!ctx) return;
        const next = generateBanner(ctx, stored, loadHidden(), null);
        saveBanner(next);
        setStored(next);
    }, [ctx, stored]);

    // "Not interested" — never shown in a banner again; set is repaired if it
    // gets too small.
    const hide = useCallback(
        (id) => {
            const hidden = loadHidden();
            hidden.add(id);
            saveHidden(hidden);
            if (!stored || !ctx) return;
            const remaining = stored.slides.filter((s) => s.id !== id);
            const next = remaining.length >= HERO_MIN_SLIDES ? { ...stored, slides: remaining } : generateBanner(ctx, stored, hidden, stored.expiresAt);
            saveBanner(next);
            setStored(next);
        },
        [ctx, stored],
    );

    return { slides, expiresAt: stored?.expiresAt ?? null, now, refresh, hide };
}

// ============================================================================
// Hero UI
// ============================================================================

function HeroSkeleton() {
    return <div className={`${HERO_SIZE} rounded-xl sm:rounded-2xl bg-base-300 animate-pulse`} />;
}

function HeroSlide({ item, active }) {
    const meta = item.metadata || {};
    const genres = meta.genres || item.category || [];
    const isMovie = !item.seasons;
    const navigate = useNavigate();
    const detailsPath = `/media/${encodeURIComponent(item.id)}`;
    // Series: Play opens the details page with a season pre-selected
    // (lowest real season; Season 0 / specials only if nothing else exists).
    const seasonKeys = Object.keys(item.seasons || {}).sort((a, b) => Number(a) - Number(b));
    const firstSeason = seasonKeys.find((k) => Number(k) !== 0) ?? seasonKeys[0];
    const seasonPath = firstSeason != null ? `${detailsPath}?season=${encodeURIComponent(firstSeason)}` : detailsPath;
    const seasonCount = item.seasons ? Object.keys(item.seasons).length : 0;
    const runtime = isMovie && meta.runtime ? (meta.runtime >= 60 ? `${Math.floor(meta.runtime / 60)}h ${meta.runtime % 60}m` : `${meta.runtime}m`) : null;
    // ── Entrance choreography ───────────────────────────────────────────
    // badge  : pill wipes open left→right
    // title  : words rise out of a clipped mask, one by one
    // meta   : items slide in from the left, one by one
    // overview: fades up out of a soft blur
    // buttons: rise with a slight spring
    // Leaving a slide fades text out fast (280ms) and only THEN resets it
    // (0ms, delayed), so nothing visibly rewinds while the slide fades away.
    const delayOf = (n) => HERO_TEXT_DELAY_MS + n * HERO_STAGGER_MS;
    const trans = (props, n, ms = HERO_TEXT_MS, ease = HERO_TEXT_EASE) =>
        active ? props.map((p) => `${p} ${ms}ms ${ease} ${delayOf(n)}ms`).join(", ") : ["opacity 280ms ease-out", ...props.filter((p) => p !== "opacity").map((p) => `${p} 0ms 280ms`)].join(", ");

    const badgeStyle = {
        opacity: active ? 1 : 0,
        clipPath: active ? "inset(0 0 0 0 round 9999px)" : "inset(0 100% 0 0 round 9999px)",
        transition: trans(["opacity", "clip-path"], 0, 900),
    };
    const wordStyle = (i) => ({
        transform: active ? "translate3d(0,0,0)" : "translate3d(0,110%,0)",
        transition: trans(["transform"], 2 + i * 0.6, 1100),
    });
    let metaIndex = 0;
    const metaStyle = () => ({
        opacity: active ? 1 : 0,
        transform: active ? "translate3d(0,0,0)" : "translate3d(-12px,0,0)",
        transition: trans(["opacity", "transform"], 3 + metaIndex++ * 0.35, 800),
    });
    const overviewStyle = {
        opacity: active ? 1 : 0,
        transform: active ? "translate3d(0,0,0)" : "translate3d(0,12px,0)",
        filter: active ? "blur(0px)" : "blur(6px)",
        transition: trans(["opacity", "transform", "filter"], 4.5, 1100),
    };
    const buttonStyle = (n) => ({
        opacity: active ? 1 : 0,
        transform: active ? "translate3d(0,0,0) scale(1)" : "translate3d(0,22px,0) scale(0.92)",
        transition: trans(["opacity", "transform"], n, 1000, HERO_SPRING),
    });
    const titleWords = String(meta.title || item.title || item.name || "").split(" ");

    const btn =
        "group bg-primary text-primary-content font-semibold inline-flex items-center text-[11px] sm:text-sm px-3.5 sm:px-5 py-1.5 sm:py-2 rounded-md shadow-md transition-all duration-300 hover:-translate-y-0.5 hover:scale-105 hover:shadow-lg hover:bg-primary/90 active:scale-95";
    const playIcon = <span className="mr-1.5 transition-transform duration-300 group-hover:translate-x-0.5">▶</span>;
    return (
        <div
            role="link"
            tabIndex={-1}
            onClick={() => navigate(detailsPath)}
            onKeyDown={(e) => e.key === "Enter" && navigate(detailsPath)}
            className="relative w-full h-full rounded-xl sm:rounded-2xl overflow-hidden cursor-pointer">
            {(meta.backdrop || meta.poster) && (
                <img
                    src={meta.backdrop || meta.poster}
                    alt=""
                    draggable={false}
                    className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                    style={{ transform: active ? "scale(1)" : "scale(1.1)", transition: `transform ${HERO_ZOOM_MS}ms ${HERO_EASE}`, willChange: "transform" }}
                />
            )}
            {/* Light backdrop: soft dark fade from the bottom only, just enough for text. Raise/lower the /60 and /20 to tune. */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent pointer-events-none" />
            <div
                className="relative z-10 flex flex-col justify-end h-full px-3.5 pt-3.5 pb-6 sm:p-8 sm:pb-10 lg:p-10 lg:pb-12 gap-1.5 sm:gap-3"
                // Soft shadow keeps text legible over any poster.
                style={{ textShadow: "0 1px 3px rgba(0,0,0,0.85), 0 2px 14px rgba(0,0,0,0.55)" }}>
                {item._heroReason && (
                    <span
                        style={badgeStyle}
                        className="inline-flex items-center w-fit max-w-full truncate px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full bg-primary/90 text-primary-content text-[9px] sm:text-[10px] font-bold uppercase tracking-wider">
                        {item._heroReason}
                    </span>
                )}
                <h2 aria-label={titleWords.join(" ")} className="text-base sm:text-3xl lg:text-4xl font-bold text-white max-w-xl leading-tight drop-shadow line-clamp-2">
                    {titleWords.map((w, i) => (
                        <span key={i} aria-hidden="true">
                            <span className="inline-block overflow-hidden align-bottom pb-[0.12em] -mb-[0.12em]">
                                <span className="inline-block" style={wordStyle(i)}>
                                    {w}
                                </span>
                            </span>{" "}
                        </span>
                    ))}
                </h2>
                <div className="flex items-center flex-wrap gap-x-2.5 gap-y-1 sm:gap-3 text-[11px] sm:text-sm text-white font-medium">
                    {meta.rating != null && <span style={metaStyle()}>★ {meta.rating.toFixed(1)}</span>}
                    {meta.year && <span style={metaStyle()}>{meta.year}</span>}
                    {runtime && <span style={metaStyle()}>{runtime}</span>}
                    {seasonCount > 0 && (
                        <span style={metaStyle()}>
                            {seasonCount} season{seasonCount > 1 ? "s" : ""}
                        </span>
                    )}
                    {genres.slice(0, 3).map((g) => (
                        <span key={g} style={metaStyle()} className="hidden sm:inline-block px-2 py-0.5 rounded-full bg-white/20 text-xs">
                            {g}
                        </span>
                    ))}
                </div>
                {meta.overview && (
                    <p style={overviewStyle} className="hidden sm:block text-sm text-white/95 max-w-xl line-clamp-2 lg:line-clamp-3">
                        {meta.overview}
                    </p>
                )}
                <div className="flex gap-2 sm:gap-3 mt-0.5 sm:mt-2">
                    {isMovie && item.streamUrl && (
                        <div style={buttonStyle(5.5)}>
                            <Link to={`/player/${encodeURIComponent(item.id)}`} onClick={(e) => e.stopPropagation()} className={btn}>
                                {playIcon}Play
                            </Link>
                        </div>
                    )}
                    {!isMovie && (
                        <div style={buttonStyle(5.5)}>
                            <Link to={seasonPath} state={{ season: firstSeason }} onClick={(e) => e.stopPropagation()} className={btn}>
                                {playIcon}Play
                            </Link>
                        </div>
                    )}
                    <div style={buttonStyle(6.3)}>
                        <Link
                            to={detailsPath}
                            onClick={(e) => e.stopPropagation()}
                            className="group bg-white/20 text-white font-semibold inline-flex items-center text-[11px] sm:text-sm px-3.5 sm:px-5 py-1.5 sm:py-2 rounded-md backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:scale-105 hover:bg-white/30 active:scale-95">
                            More Info
                            <span className="ml-0 w-0 overflow-hidden opacity-0 transition-all duration-300 group-hover:ml-1.5 group-hover:w-2 group-hover:opacity-100">›</span>
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}

// One-at-a-time hero carousel: autoplays, pauses on hover/drag, has dots,
// prev/next arrows (desktop hover), arrow-key support, and mouse/touch swipe.
// Always a landscape rectangle (aspect-ratio based, never a fixed height).
function HeroCarousel({ items }) {
    const [active, setActive] = useState(0);
    const containerRef = useRef(null);
    const dragState = useRef({ down: false, startX: 0, moved: false });
    const pausedRef = useRef(false);
    const hoverRef = useRef(false);
    const count = items?.length || 0;
    const itemsKey = (items || []).map((i) => i.id).join("|");

    // New slide set (refresh / expiry / hide) — start from the first slide.
    // Keyed on ids, not array identity, so unrelated data updates (history
    // etc.) don't yank the carousel back to slide 1.
    useEffect(() => {
        setActive(0);
    }, [itemsKey]);

    const go = useCallback(
        (dir) => {
            if (count > 1) setActive((i) => (i + dir + count) % count);
        },
        [count],
    );

    // Autoplay — timer restarts on every slide change (manual or auto), and
    // ticks are skipped while hovering or interacting.
    useEffect(() => {
        if (count <= 1) return;
        const timer = setInterval(() => {
            if (!pausedRef.current && !hoverRef.current) setActive((i) => (i + 1) % count);
        }, HERO_AUTOPLAY_MS);
        return () => clearInterval(timer);
    }, [count, active]);

    // Manual grab/swipe — dragging left/right moves one slide; a real drag
    // also suppresses the click that follows it so Play/More Info don't fire
    // mid-swipe.
    useEffect(() => {
        const el = containerRef.current;
        if (!el || count <= 1) return;
        const s = dragState.current;
        let resumeTimer = null;

        const down = (clientX) => {
            s.down = true;
            s.moved = false;
            s.startX = clientX;
            pausedRef.current = true;
            if (resumeTimer) clearTimeout(resumeTimer);
        };
        const move = (clientX) => {
            if (!s.down) return;
            if (Math.abs(clientX - s.startX) > 5) s.moved = true;
        };
        const up = (clientX) => {
            if (s.down) {
                const delta = clientX - s.startX;
                if (Math.abs(delta) > 40) {
                    const dir = delta < 0 ? 1 : -1;
                    setActive((i) => (i + dir + count) % count);
                }
            }
            s.down = false;
            resumeTimer = setTimeout(() => {
                pausedRef.current = false;
            }, 3000);
        };
        const onClickCapture = (e) => {
            if (s.moved) {
                e.preventDefault();
                e.stopPropagation();
            }
        };

        const onMouseDown = (e) => down(e.pageX);
        const onMouseMove = (e) => move(e.pageX);
        const onMouseUp = (e) => up(e.pageX);
        const onTouchStart = (e) => down(e.touches[0].pageX);
        const onTouchMove = (e) => move(e.touches[0].pageX);
        const onTouchEnd = (e) => up(e.changedTouches[0].pageX);

        el.addEventListener("mousedown", onMouseDown);
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
        el.addEventListener("touchstart", onTouchStart, { passive: true });
        el.addEventListener("touchmove", onTouchMove, { passive: true });
        el.addEventListener("touchend", onTouchEnd);
        el.addEventListener("click", onClickCapture, true);

        return () => {
            if (resumeTimer) clearTimeout(resumeTimer);
            el.removeEventListener("mousedown", onMouseDown);
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
            el.removeEventListener("touchstart", onTouchStart);
            el.removeEventListener("touchmove", onTouchMove);
            el.removeEventListener("touchend", onTouchEnd);
            el.removeEventListener("click", onClickCapture, true);
        };
    }, [count]);

    if (!count) return null;

    const safeActive = Math.min(active, count - 1);

    return (
        <div>
            <div
                ref={containerRef}
                tabIndex={0}
                onMouseEnter={() => (hoverRef.current = true)}
                onMouseLeave={() => (hoverRef.current = false)}
                onKeyDown={(e) => {
                    if (e.key === "ArrowLeft") go(-1);
                    else if (e.key === "ArrowRight") go(1);
                }}
                className={`group relative ${HERO_SIZE} rounded-xl sm:rounded-2xl overflow-hidden cursor-pointer active:cursor-grabbing select-none outline-none focus-visible:ring-2 focus-visible:ring-primary`}>
                {items.map((item, i) => {
                    // Circular offset from the active slide. The active slide is
                    // fully visible; every other slide is transparent and parked
                    // slightly to one side. When the active slide changes, the
                    // outgoing slide drifts away while FADING OUT and the
                    // incoming one drifts in while FADING IN — same duration and
                    // easing for movement and fade, so they finish together.
                    let d = i - safeActive;
                    if (d > count / 2) d -= count;
                    else if (d < -count / 2) d += count;
                    const side = Math.max(-1, Math.min(1, d));
                    return (
                        <div
                            key={item.id ?? item.seriesKey}
                            className="absolute inset-0"
                            style={{
                                transform: `translate3d(${side * HERO_SHIFT}%, 0, 0)`,
                                opacity: d === 0 ? 1 : 0,
                                transition: `transform ${HERO_SLIDE_MS}ms ${HERO_EASE}, opacity ${HERO_SLIDE_MS}ms ${HERO_EASE}`,
                                willChange: "transform, opacity",
                                backfaceVisibility: "hidden",
                                pointerEvents: d === 0 ? "auto" : "none",
                            }}>
                            <HeroSlide item={item} active={d === 0} />
                        </div>
                    );
                })}

                {count > 1 && (
                    <div className="absolute z-20 bottom-2 sm:bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 sm:gap-1.5 px-2 py-1 rounded-full">
                        {items.map((_, i) => (
                            <button
                                key={i}
                                onClick={() => setActive(i)}
                                aria-label={`Go to slide ${i + 1}`}
                                className={`h-1 sm:h-1.5 rounded-full cursor-pointer transition-all duration-500 ease-in-out ${i === safeActive ? "w-4 sm:w-6 bg-primary" : "w-1 sm:w-1.5 bg-white/50 hover:bg-white/80"}`}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// Grid, not a horizontal-scrolling MediaRow — this is a dedicated full page,
// not a Home-style row.
const NO_SCROLLBAR = { scrollbarWidth: "none", msOverflowStyle: "none", WebkitOverflowScrolling: "touch" };
// Mobile (<sm): 16/9 landscape rectangle, min-h keeps text from clipping on tiny phones.
// sm+ unchanged: fixed heights.
const PICKS_SIZE = "w-full aspect-[16/9] min-h-[200px] sm:aspect-auto sm:min-h-0 sm:h-[380px] lg:h-[440px] 2xl:h-[490px]";
const PICKS_CANDIDATES = 45;
const PICKS_SHOWN = 15;
const PICKS_AUTOPLAY_MS = 5000;
const PICKS_SLIDE_MS = 1400;
const PICKS_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const PICKS_INOUT = "cubic-bezier(0.45, 0, 0.15, 1)";

const PlayGlyph = () => (
    <svg viewBox="0 0 24 24" className="mr-1.5 h-3.5 w-3.5 sm:h-4 sm:w-4" fill="currentColor" aria-hidden="true">
        <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
    </svg>
);

const compactVotes = (n) => (n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(n || 0));

function useOn(initial = false) {
    const [on, setOn] = useState(initial);
    useEffect(() => {
        if (initial) return;
        let r2;
        const r1 = requestAnimationFrame(() => {
            r2 = requestAnimationFrame(() => setOn(true));
        });
        return () => {
            cancelAnimationFrame(r1);
            cancelAnimationFrame(r2);
        };
    }, [initial]);
    return on;
}

function ScoreRing({ value, show }) {
    const r = 15;
    const c = 2 * Math.PI * r;
    const pct = Math.max(0, Math.min(10, value)) / 10;
    return (
        <span className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center sm:h-12 sm:w-12">
            <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
                <circle cx="18" cy="18" r={r} fill="rgba(0,0,0,0.45)" stroke="rgba(255,255,255,0.2)" strokeWidth="3" />
                <circle
                    cx="18"
                    cy="18"
                    r={r}
                    fill="none"
                    stroke="currentColor"
                    className="text-primary"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray={c}
                    strokeDashoffset={show ? c * (1 - pct) : c}
                    style={{ transition: `stroke-dashoffset 1400ms ${PICKS_EASE} ${show ? 700 : 0}ms` }}
                />
            </svg>
            <span className="relative text-xs font-bold text-white sm:text-sm">{value.toFixed(1)}</span>
        </span>
    );
}

function PickRise({ show, n = 0, children, className = "" }) {
    const delay = 250 + n * 80;
    return (
        <div
            className={className}
            style={{
                opacity: show ? 1 : 0,
                transform: show ? "translate3d(0,0,0)" : "translate3d(0,24px,0)",
                filter: show ? "blur(0px)" : "blur(6px)",
                transition: show ? `opacity 800ms ease ${delay}ms, transform 1000ms ${PICKS_EASE} ${delay}ms, filter 800ms ease ${delay}ms` : "none",
            }}>
            {children}
        </div>
    );
}

function PickTitle({ show, text }) {
    return (
        <h3 aria-label={text} className="flex max-h-[2.5em] flex-wrap gap-x-[0.26em] overflow-hidden text-xl font-bold leading-tight text-white sm:text-3xl lg:text-4xl 2xl:text-5xl">
            {text.split(" ").map((w, i) => (
                <span key={i} aria-hidden="true" className="-mb-[0.12em] inline-block overflow-hidden pb-[0.12em]">
                    <span
                        className="inline-block"
                        style={{
                            transform: show ? "translate3d(0,0,0) rotate(0deg)" : "translate3d(0,115%,0) rotate(4deg)",
                            transition: show ? `transform 1000ms ${PICKS_EASE} ${300 + i * 70}ms` : "none",
                        }}>
                        {w}
                    </span>
                </span>
            ))}
        </h3>
    );
}

function PickImage({ src, dir, out, first }) {
    const entered = useOn(first);
    const state = out ? "out" : entered ? "in" : "pre";
    const shift = state === "in" ? 0 : state === "out" ? -dir * 12 : dir * 12;
    return (
        <div
            className="absolute inset-0"
            style={{
                opacity: state === "in" ? 1 : 0,
                transform: `translate3d(${shift}%,0,0)`,
                transition: `opacity ${PICKS_SLIDE_MS}ms ${PICKS_INOUT}, transform ${PICKS_SLIDE_MS}ms ${PICKS_INOUT}`,
            }}>
            <img
                src={src}
                alt=""
                draggable={false}
                decoding="async"
                className="h-full w-full object-cover"
                style={{ transform: state === "pre" ? "scale(1.12)" : "scale(1)", transition: `transform 4000ms ${PICKS_EASE}` }}
            />
        </div>
    );
}

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-black";

function PickText({ item, rank, total, out }) {
    const show = useOn(false);
    const meta = item.metadata || {};
    const title = meta.title || item.title || item.name;
    const isMovie = !item.seasons;
    const detailsPath = `/media/${encodeURIComponent(item.id)}`;
    const seasonKeys = Object.keys(item.seasons || {}).sort((a, b) => Number(a) - Number(b));
    const firstSeason = seasonKeys.find((k) => Number(k) !== 0) ?? seasonKeys[0];
    const playPath = isMovie ? `/player/${encodeURIComponent(item.id)}` : firstSeason != null ? `${detailsPath}?season=${encodeURIComponent(firstSeason)}` : detailsPath;
    const label = item._pickTag || item._recReasons?.[0] || "Tonight's pick";
    const runtime = isMovie && meta.runtime ? (meta.runtime >= 60 ? `${Math.floor(meta.runtime / 60)}h ${meta.runtime % 60}m` : `${meta.runtime}m`) : null;
    const details = [meta.year, runtime, !isMovie ? `${seasonKeys.length} season${seasonKeys.length > 1 ? "s" : ""}` : null, meta.votes ? `${compactVotes(meta.votes)} votes` : null].filter(Boolean);
    const lockRef = (el) => {
        if (!el) return;
        if (out) el.setAttribute("inert", "");
        else el.removeAttribute("inert");
    };
    return (
        <div
            ref={lockRef}
            role="group"
            aria-roledescription="slide"
            aria-label={`${rank} of ${total}: ${title}`}
            aria-hidden={out || undefined}
            className="col-start-1 row-start-1 flex w-full flex-col gap-3 sm:gap-4 lg:gap-5"
            style={{
                opacity: out ? 0 : 1,
                transform: out ? "translate3d(0,-8px,0)" : "translate3d(0,0,0)",
                filter: out ? "blur(4px)" : "blur(0px)",
                transition: out ? `opacity ${PICKS_SLIDE_MS * 0.55}ms ease, transform ${PICKS_SLIDE_MS * 0.55}ms ease, filter ${PICKS_SLIDE_MS * 0.55}ms ease` : "none",
            }}>
            <PickRise show={show} n={0} className="flex max-w-full items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/85">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                <span className="truncate">{label}</span>
                <span className="text-white/35" aria-hidden="true">
                    /
                </span>
                <span className="shrink-0 font-medium tabular-nums text-white/60">
                    {String(rank).padStart(2, "0")} of {total}
                </span>
            </PickRise>
            <PickTitle show={show} text={title} />
            <PickRise show={show} n={2} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/85 sm:text-base">
                {meta.rating != null && <span className="font-bold text-amber-300">★ {meta.rating.toFixed(1)}</span>}
                {details.map((d) => (
                    <span key={d} className="flex items-center gap-3">
                        <span className="h-1 w-1 rounded-full bg-white/40" aria-hidden="true" />
                        {d}
                    </span>
                ))}
            </PickRise>
            {meta.overview && (
                <PickRise show={show} n={3} className="hidden 2xl:block">
                    <p className="line-clamp-2 max-w-xl text-base leading-relaxed text-white/80">{meta.overview}</p>
                </PickRise>
            )}
            <PickRise show={show} n={4} className="flex items-center gap-2 pt-1 sm:gap-3">
                <Link
                    to={playPath}
                    className={`inline-flex min-h-10 items-center rounded-lg bg-primary px-4 sm:min-h-11 text-sm font-semibold text-primary-content shadow-lg shadow-primary/30 transition-all duration-300 hover:-translate-y-0.5 active:scale-95 sm:px-6 ${focusRing}`}>
                    <PlayGlyph />
                    Play
                </Link>
                <Link
                    to={detailsPath}
                    className={`inline-flex min-h-10 items-center rounded-lg border border-white/30 px-4 sm:min-h-11 text-sm font-semibold text-white transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/10 active:scale-95 sm:px-6 ${focusRing}`}>
                    More Info
                </Link>
            </PickRise>
        </div>
    );
}

function TonightsPicks({ candidates }) {
    const [idx, setIdx] = useState(0);
    const [reduced] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const [held, setHeld] = useState(false);
    const [stack, setStack] = useState([]);
    const latest = useRef(candidates);
    const resumeRef = useRef(null);
    const inViewRef = useRef(true);
    const stageRef = useRef(null);
    const railRef = useRef(null);
    const prevIdxRef = useRef(0);
    const dirRef = useRef(1);
    const layerId = useRef(0);
    const drag = useRef({ moved: false });
    latest.current = candidates;
    const key = candidates.map((i) => i.id).join("|");

    const picks = useMemo(() => {
        return latest.current.slice(0, PICKS_SHOWN);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);

    const count = picks.length;
    const cur = picks[Math.min(idx, Math.max(count - 1, 0))];
    const running = !reduced && !hovered && !focused && !held;

    if (prevIdxRef.current !== idx && count) {
        const diff = idx - prevIdxRef.current;
        dirRef.current = (diff > 0 && diff <= count / 2) || diff < -count / 2 ? 1 : -1;
        prevIdxRef.current = idx;
    }

    useEffect(() => {
        setIdx(0);
    }, [key]);

    useEffect(() => {
        if (!cur) return;
        setStack((prev) => {
            if (prev.length && prev[prev.length - 1].item.id === cur.id) return prev;
            const next = prev.map((l) => ({ ...l, out: true }));
            next.push({ id: ++layerId.current, item: cur, rank: picks.indexOf(cur) + 1, dir: dirRef.current, out: false, first: prev.length === 0 });
            return next;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cur?.id]);

    useEffect(() => {
        if (!stack.some((l) => l.out)) return;
        const t = setTimeout(() => setStack((p) => p.filter((l) => !l.out)), PICKS_SLIDE_MS + 300);
        return () => clearTimeout(t);
    }, [stack]);

    useEffect(() => {
        if (count <= 1 || !running) return;
        const t = setInterval(() => {
            if (document.hidden || !inViewRef.current) return;
            setIdx((i) => (i + 1) % count);
        }, PICKS_AUTOPLAY_MS);
        return () => clearInterval(t);
    }, [count, idx, running]);

    useEffect(() => {
        const el = stageRef.current;
        if (!el || typeof IntersectionObserver === "undefined") return;
        const io = new IntersectionObserver(
            ([e]) => {
                inViewRef.current = e.isIntersecting;
            },
            { threshold: 0.2 },
        );
        io.observe(el);
        return () => io.disconnect();
    }, [count]);

    useEffect(() => {
        const rail = railRef.current;
        const el = rail?.children[idx];
        if (rail && el) rail.scrollTo({ left: el.offsetLeft - rail.clientWidth / 2 + el.clientWidth / 2, behavior: "smooth" });
    }, [idx, count]);

    useEffect(() => () => clearTimeout(resumeRef.current), []);

    if (count < 3) return null;

    const onPointerDown = (e) => {
        if (e.target.closest("[data-nav]") || (e.pointerType === "mouse" && e.button !== 0)) return;
        const sx = e.clientX;
        const sy = e.clientY;
        drag.current.moved = false;
        clearTimeout(resumeRef.current);
        setHeld(true);
        const finish = (ev) => {
            window.removeEventListener("pointerup", finish);
            window.removeEventListener("pointercancel", finish);
            const dx = ev.clientX - sx;
            const dy = ev.clientY - sy;
            drag.current.moved = Math.abs(dx) > 6 || Math.abs(dy) > 6;
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.2) setIdx((i) => (i + (dx < 0 ? 1 : -1) + count) % count);
            resumeRef.current = setTimeout(() => setHeld(false), 3000);
        };
        window.addEventListener("pointerup", finish);
        window.addEventListener("pointercancel", finish);
    };

    return (
        <section className="picks-root" aria-labelledby="tonights-picks-title">
            <style>{`@media (prefers-reduced-motion: reduce){.picks-root *{transition-duration:0.01ms !important;animation-duration:0.01ms !important;animation-iteration-count:1 !important}}`}</style>
            <div className="mb-3 flex items-center gap-3 sm:mb-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-content shadow-lg shadow-primary/30">
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
                        <path d="M12 2.5l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.5 6.1 20.7l1.2-6.6L2.5 9.5l6.6-.9L12 2.5z" />
                    </svg>
                </span>
                <div>
                    <h2 id="tonights-picks-title" className="text-lg font-bold leading-tight text-base-content sm:text-2xl">
                        Tonight's Picks
                    </h2>
                    <p className="text-sm text-base-content/70">The {count} highest-rated and most popular titles in your library</p>
                </div>
            </div>

            <div
                ref={stageRef}
                role="region"
                aria-roledescription="carousel"
                aria-label="Tonight's picks"
                tabIndex={0}
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
                onFocus={() => setFocused(true)}
                onBlur={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
                }}
                onKeyDown={(e) => {
                    if (e.key === "ArrowRight") setIdx((i) => (i + 1) % count);
                    if (e.key === "ArrowLeft") setIdx((i) => (i - 1 + count) % count);
                }}
                onPointerDown={onPointerDown}
                onClickCapture={(e) => {
                    if (drag.current.moved) {
                        e.preventDefault();
                        e.stopPropagation();
                        drag.current.moved = false;
                    }
                }}
                className={`relative touch-pan-y select-none overflow-hidden rounded-xl bg-black outline-none ring-1 ring-white/10 focus-visible:ring-2 focus-visible:ring-primary sm:rounded-2xl ${PICKS_SIZE}`}>
                {stack.map((l) => (
                    <PickImage key={l.id} src={l.item.metadata.backdrop || l.item.metadata.poster} dir={l.dir} out={l.out} first={l.first} />
                ))}
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-transparent" />
                <div className="absolute inset-y-0 left-0 w-full bg-gradient-to-r from-black/85 via-black/45 to-transparent sm:w-[72%]" />

                <div className="absolute inset-0 z-10 flex flex-col justify-end px-5 pb-5 sm:px-10 sm:pb-7 lg:px-14 lg:pb-9">
                    <div className="grid w-full max-w-[36rem]" aria-live={running ? "off" : "polite"}>
                        {stack.map((l) => (
                            <PickText key={l.id} item={l.item} rank={l.rank} total={count} out={l.out} />
                        ))}
                    </div>

                    <div data-nav className="mt-5 hidden w-full justify-center sm:flex lg:mt-8">
                        <div
                            ref={railRef}
                            className="flex w-fit max-w-full gap-2 overflow-x-auto px-4 py-1.5"
                            style={{
                                ...NO_SCROLLBAR,
                                WebkitMaskImage: "linear-gradient(to right, transparent, #000 16px, #000 calc(100% - 16px), transparent)",
                                maskImage: "linear-gradient(to right, transparent, #000 16px, #000 calc(100% - 16px), transparent)",
                            }}
                            role="tablist"
                            aria-label="Choose a pick">
                            {picks.map((it, i) => {
                                const on = i === idx;
                                const m = it.metadata || {};
                                const name = m.title || it.title || it.name;
                                return (
                                    <button
                                        key={it.id}
                                        type="button"
                                        role="tab"
                                        aria-selected={on}
                                        aria-label={`${i + 1}. ${name}`}
                                        title={`${i + 1}. ${name}`}
                                        onClick={() => setIdx(i)}
                                        className={`relative h-14 w-11 shrink-0 cursor-pointer overflow-hidden rounded-md transition-all duration-500 lg:h-16 lg:w-12 ${focusRing} ${
                                            on ? "-translate-y-0.5 opacity-100 ring-2 ring-primary" : "opacity-50 hover:opacity-100"
                                        }`}>
                                        {m.poster ? (
                                            <img src={m.poster} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" />
                                        ) : (
                                            <span className="block h-full w-full bg-white/10" />
                                        )}
                                        <span
                                            className={`absolute inset-x-0 bottom-0 py-px text-center text-[10px] font-bold tabular-nums ${on ? "bg-primary text-primary-content" : "bg-black/75 text-white"}`}>
                                            {i + 1}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}

function Section({ title, items }) {
    if (!items?.length) return null;
    return (
        <section>
            <h2 className="flex items-center gap-2 text-base sm:text-lg font-semibold text-base-content mb-3">
                <span className="w-1 h-5 rounded-full bg-primary" />
                {title}
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-3">
                {items.map((item) => (
                    <MediaCard key={item.id ?? item.seriesKey} item={item} />
                ))}
            </div>
        </section>
    );
}

function SectionSkeleton() {
    return (
        <div className="space-y-3">
            <div className="h-5 w-32 rounded bg-base-300 animate-pulse" />
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-3">
                {Array.from({ length: 7 }).map((_, i) => (
                    <div key={i} className="aspect-[2/3] rounded-lg bg-base-300 animate-pulse" />
                ))}
            </div>
        </div>
    );
}

export default function RecommendationsPage() {
    const { movies, series, anime, history, favourites, watchlist } = useApi();
    const { data: recommendations = [], isLoading } = useRecommendations();
    const refreshMut = useRefreshRecommendations();
    const refreshedOnce = useRef(false);

    // FIX: "For You" is the one section sourced from the backend's persisted
    // list (server/utils/recommendationEngine.js), which only regenerates on
    // its own every 30 min — every other section here is computed live from
    // useApi() and already updates instantly on favourite/watchlist/history
    // changes. Without this, visiting the page could show a "For You" list
    // that predates whatever you just favourited. Runs once per page visit
    // (StrictMode-safe via the ref), not on every render.
    useEffect(() => {
        if (refreshedOnce.current) return;
        refreshedOnce.current = true;
        refreshMut.mutate();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const feed = useMemo(() => {
        const pool = [...(movies || []), ...(series || []), ...(anime || [])];
        if (!pool.length) return null;

        const fileToItem = buildFileToItemMap(series || [], anime || []);
        const resolve = (fileId) => (movies || []).find((m) => m.id === fileId) || fileToItem.get(fileId) || null;

        const completedIds = new Set(
            (history || [])
                .filter((h) => h.completed)
                .map((h) => resolve(h.id)?.id)
                .filter(Boolean),
        );
        const watchedIds = new Set((history || []).map((h) => resolve(h.id)?.id).filter(Boolean));

        // ── Recommended For You — the existing personalized list, unchanged.
        const recommendedForYou = recommendations.slice(0, SECTION_SIZE);
        const recommendedIds = new Set(recommendedForYou.map((i) => i.id));

        // ── More Like Your Favourites (the "Because You Watched" replacement)
        // — deliberately favourites-only, not the blended profile Recommended
        // For You uses, so it's a genuinely different slice.
        const favItems = (favourites || []).map((f) => pool.find((p) => p.id === f.id)).filter(Boolean);
        const favIds = new Set(favItems.map((f) => f.id));
        const moreLikeFavourites = favItems.length
            ? pool
                  .filter((i) => !favIds.has(i.id) && !completedIds.has(i.id))
                  .map((i) => ({ item: i, result: bestOverlap(favItems, i) }))
                  .filter((e) => overlapQualifies(e.result))
                  .sort((a, b) => b.result.score - a.result.score)
                  .slice(0, SECTION_SIZE)
                  .map((e) => e.item)
            : [];

        // ── Trending Now — last 7 days of this client's own history,
        // resolved episode→series. (History here is single-client/LAN-install
        // scoped, matching this codebase's own history routes.)
        const trendCounts = new Map();
        for (const h of history || []) {
            if (!h.watchedAt || Date.now() - new Date(h.watchedAt).getTime() > RECENT_WINDOW_MS) continue;
            const item = resolve(h.id);
            if (!item) continue;
            trendCounts.set(item.id, { item, count: (trendCounts.get(item.id)?.count || 0) + (h.completed ? 2 : 1) });
        }
        const trendingNow = [...trendCounts.values()]
            .sort((a, b) => b.count - a.count)
            .slice(0, SECTION_SIZE)
            .map((t) => t.item);

        // ── Most Popular — all-time watch count, same resolution. Distinct
        // from Trending's 7-day momentum window.
        const popCounts = new Map();
        for (const h of history || []) {
            const item = resolve(h.id);
            if (!item) continue;
            popCounts.set(item.id, { item, count: (popCounts.get(item.id)?.count || 0) + (h.watchCount || 1) });
        }
        const mostPopular = [...popCounts.values()]
            .sort((a, b) => b.count - a.count)
            .slice(0, SECTION_SIZE)
            .map((p) => p.item);

        // ── New & Recently Added — real scanner-cache timestamp (metadata.date)
        const newAndRecentlyAdded = pool
            .filter((i) => i.metadata?.date)
            .sort((a, b) => new Date(b.metadata.date) - new Date(a.metadata.date))
            .slice(0, SECTION_SIZE);

        // ── Your Favorite Genres — top genres from favourites+watchlist+history,
        // each subsection needs enough real candidates or it's skipped entirely.
        const signalItems = [...favItems, ...(watchlist || []).map((w) => pool.find((p) => p.id === w.id)).filter(Boolean), ...(history || []).map((h) => resolve(h.id)).filter(Boolean)];
        const tally = genreTally(signalItems);
        const topGenres = Object.entries(tally)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([g]) => g);
        const favoriteGenres = topGenres
            .map((g) => ({
                genre: g,
                items: pool.filter((i) => (i.metadata?.genres || []).some((mg) => norm(mg) === g) && !completedIds.has(i.id)).sort((a, b) => (b.metadata?.rating || 0) - (a.metadata?.rating || 0)),
            }))
            .filter((s) => s.items.length >= 4)
            .map((s) => ({ ...s, items: s.items.slice(0, SECTION_SIZE) }));

        // ── Highly Rated — excludes anything already in Recommended For You
        const highlyRated = pool
            .filter((i) => (i.metadata?.rating || 0) >= 7.5 && !completedIds.has(i.id) && !recommendedIds.has(i.id))
            .sort((a, b) => (b.metadata?.rating || 0) - (a.metadata?.rating || 0))
            .slice(0, SECTION_SIZE);

        // ── Hidden Gems (own definition — the original spec's text cut off
        // before this section): good rating, low TMDB vote volume, never
        // watched here. A real obscure-but-good signal, not invented.
        const hiddenGems = pool
            .filter((i) => (i.metadata?.rating || 0) >= 7 && (i.metadata?.votes || 0) > 0 && (i.metadata?.votes || 0) < 2000 && !watchedIds.has(i.id))
            .sort((a, b) => (b.metadata?.rating || 0) - (a.metadata?.rating || 0))
            .slice(0, SECTION_SIZE);

        // ── You Might Have Missed (own definition, spec had no body text) —
        // sat in the library >30 days, never watched, shares real overlap
        // with your favourites.
        const youMightHaveMissed = pool
            .filter((i) => !watchedIds.has(i.id) && i.metadata?.date && Date.now() - new Date(i.metadata.date).getTime() > NEW_LIBRARY_WINDOW_MS)
            .map((i) => ({ item: i, result: bestOverlap(favItems, i) }))
            .filter((e) => overlapQualifies(e.result))
            .sort((a, b) => b.result.score - a.result.score)
            .slice(0, SECTION_SIZE)
            .map((e) => e.item);

        // ── Weekend Picks (own definition, spec had no body text) —
        // substantial single-sit movies (≥100min) or any binge-friendly
        // series/anime.
        const weekendPicks = pool.filter((i) => !completedIds.has(i.id) && (i.seasons || (i.metadata?.runtime || 0) >= 100)).slice(0, SECTION_SIZE);

        // ── More For You — overflow beyond the main recommended list, same
        // favourites-overlap scoring "More Like Your Favourites" uses, just
        // the next tier down, not a re-run of a different algorithm.
        const moreForYou = pool
            .filter((i) => !recommendedIds.has(i.id) && !completedIds.has(i.id))
            .map((i) => ({ item: i, result: bestOverlap(favItems, i) }))
            .filter((e) => overlapQualifies(e.result))
            .sort((a, b) => b.result.score - a.result.score)
            .slice(0, SECTION_SIZE)
            .map((e) => e.item);

        return {
            // Raw inputs for the self-managing hero banner (see useHeroBanner).
            heroCtx: {
                pool,
                typeById: new Map([...(movies || []).map((i) => [i.id, "movie"]), ...(series || []).map((i) => [i.id, "series"]), ...(anime || []).map((i) => [i.id, "anime"])]),
            },
            recommendedForYou,
            moreLikeFavourites,
            trendingNow,
            newAndRecentlyAdded,
            mostPopular,
            favoriteGenres,
            highlyRated,
            hiddenGems,
            youMightHaveMissed,
            weekendPicks,
            moreForYou,
        };
    }, [movies, series, anime, history, favourites, watchlist, recommendations]);

    // Banner builds/refreshes itself (latest releases, 3–7 day cycle).
    const hero = useHeroBanner(feed?.heroCtx ?? null, !isLoading);

    const nextPicks = useMemo(() => {
        if (!feed) return [];
        const usable = feed.heroCtx.pool.filter((i) => !isMature(i) && i.metadata?.rating && (i.metadata?.backdrop || i.metadata?.poster));
        const votes = (i) => i.metadata.votes || 0;
        const score = (i) => i.metadata.rating * Math.log10(votes(i) + 1);
        const cut = (values, p) => {
            const a = [...values].sort((x, y) => x - y);
            return a.length ? a[Math.floor((a.length - 1) * p)] : 0;
        };
        const ratings = usable.map((i) => i.metadata.rating);
        const allVotes = usable.map(votes);
        const tiers = [
            { tag: "Top Rated · Popular", p: 0.6, floor: 7.5 },
            { tag: "Top Rated · Popular", p: 0.4, floor: 7 },
            { tag: "Top Rated", p: 0.2, floor: 6.5 },
            { tag: null, p: 0, floor: 0 },
        ];
        const seen = new Set();
        const out = [];
        for (const t of tiers) {
            const ratingCut = Math.max(t.floor, cut(ratings, t.p));
            const votesCut = cut(allVotes, t.p);
            const pool = usable.filter((i) => i.metadata.rating >= ratingCut && votes(i) >= votesCut).sort((x, y) => score(y) - score(x));
            for (const i of pool) {
                if (seen.has(i.id)) continue;
                seen.add(i.id);
                out.push({ ...i, _pickTag: t.tag });
                if (out.length >= PICKS_SHOWN) return out;
            }
        }
        return out;
    }, [feed]);

    const nothingYet = !isLoading && (!feed || !feed.recommendedForYou.length);

    return (
        <div className="space-y-6 sm:space-y-10">
            {nothingYet && <div className="text-base-content/60">Not enough activity yet — favourite, watchlist, or watch a bit more and check back.</div>}

            {isLoading && !hero.slides.length ? <HeroSkeleton /> : <HeroCarousel items={hero.slides} />}

            {isLoading && !feed ? (
                <>
                    <SectionSkeleton />
                    <SectionSkeleton />
                </>
            ) : (
                <>
                    <Section title="For You" items={feed?.recommendedForYou} />
                    <Section title="Trending" items={feed?.trendingNow} />
                    <Section title="Your Taste" items={feed?.moreLikeFavourites} />
                    <Section title="New Arrivals" items={feed?.newAndRecentlyAdded} />
                    <Section title="Popular" items={feed?.mostPopular} />
                    <TonightsPicks candidates={nextPicks} />

                    {feed?.favoriteGenres?.length > 0 && (
                        <section>
                            <h2 className="text-base sm:text-lg font-semibold text-base-content mb-4">Top Genres</h2>
                            <div className="space-y-8">
                                {feed.favoriteGenres.map(({ genre, items }) => (
                                    <Section key={genre} title={titleCase(genre)} items={items} />
                                ))}
                            </div>
                        </section>
                    )}

                    <Section title="Top Rated" items={feed?.highlyRated} />
                    <Section title="Hidden Gems" items={feed?.hiddenGems} />
                    <Section title="You Missed" items={feed?.youMightHaveMissed} />
                    <Section title="Weekend Picks" items={feed?.weekendPicks} />
                    <Section title="More Picks" items={feed?.moreForYou} />
                </>
            )}
        </div>
    );
}
