import { useMemo, useRef, useEffect, useState } from "react";
import { Link } from "react-router";
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
// ============================================================================

const SECTION_SIZE = 12;
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // "Trending" window
const NEW_LIBRARY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // "sat in library a while" threshold for Missed

function norm(s) {
    return (s ?? "").toString().toLowerCase().trim();
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

// One-at-a-time hero carousel: autoplays every 3s, has clickable pagination
// dots, and still supports manual grab/swipe (mouse drag or touch) — any
// manual interaction pauses autoplay briefly so it doesn't fight the user.
function HeroSlide({ item }) {
    const meta = item.metadata || {};
    const genres = meta.genres || item.category || [];
    const isMovie = !item.seasons;
    return (
        <div className="relative w-full h-full rounded-2xl overflow-hidden bg-base-300">
            {(meta.backdrop || meta.poster) && <img src={meta.backdrop || meta.poster} alt="" draggable={false} className="absolute inset-0 w-full h-full object-cover pointer-events-none" />}
            <div className="absolute inset-0 bg-gradient-to-t from-base-100 via-base-100/70 to-base-100/10 pointer-events-none" />
            <div className="relative z-10 flex flex-col justify-end h-full p-5 sm:p-8 lg:p-10 gap-2.5 sm:gap-3">
                {item._heroReason && (
                    <span className="inline-flex items-center w-fit px-2.5 py-1 rounded-full bg-primary/90 text-primary-content text-[10px] font-bold uppercase tracking-wider">
                        {item._heroReason}
                    </span>
                )}
                <h2 className="text-xl sm:text-3xl lg:text-4xl font-bold text-white max-w-xl leading-tight">{meta.title || item.title || item.name}</h2>
                <div className="flex items-center flex-wrap gap-2.5 sm:gap-3 text-xs sm:text-sm text-white/70">
                    {meta.rating != null && <span>★ {meta.rating.toFixed(1)}</span>}
                    {meta.year && <span>{meta.year}</span>}
                    {genres.slice(0, 3).map((g) => (
                        <span key={g} className="px-2 py-0.5 rounded-full bg-white/10 text-xs">
                            {g}
                        </span>
                    ))}
                </div>
                {meta.overview && <p className="hidden sm:block text-sm text-white/80 max-w-xl line-clamp-2 lg:line-clamp-3">{meta.overview}</p>}
                <div className="flex gap-2.5 sm:gap-3 mt-1 sm:mt-2">
                    {isMovie && item.streamUrl && (
                        <Link
                            to={`/player/${encodeURIComponent(item.id)}`}
                            className="bg-primary text-primary-content font-semibold text-xs sm:text-sm px-4 sm:px-5 py-2 rounded-md hover:bg-primary/90 transition-colors">
                            ▶ Play
                        </Link>
                    )}
                    <Link
                        to={`/media/${encodeURIComponent(item.id)}`}
                        className="bg-white/20 text-white font-semibold text-xs sm:text-sm px-4 sm:px-5 py-2 rounded-md hover:bg-white/30 transition-colors">
                        More Info
                    </Link>
                </div>
            </div>
        </div>
    );
}

function HeroCarousel({ items }) {
    const [active, setActive] = useState(0);
    const containerRef = useRef(null);
    const dragState = useRef({ down: false, startX: 0, moved: false });
    const pausedRef = useRef(false);

    // New item set (e.g. after a refresh) — start from the first slide again.
    useEffect(() => {
        setActive(0);
    }, [items]);

    // Autoplay — advances every 3s, skipped while the user is actively
    // interacting (drag in progress or just finished one).
    useEffect(() => {
        if (!items || items.length <= 1) return;
        const timer = setInterval(() => {
            if (!pausedRef.current) setActive((i) => (i + 1) % items.length);
        }, 3000);
        return () => clearInterval(timer);
    }, [items]);

    // Manual grab/swipe — still no visible prev/next buttons, but dragging
    // left/right moves one slide; a real drag also suppresses the click that
    // follows it so Play/More Info don't fire mid-swipe.
    useEffect(() => {
        const el = containerRef.current;
        if (!el || !items || items.length <= 1) return;
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
                    setActive((i) => (i + dir + items.length) % items.length);
                }
            }
            s.down = false;
            resumeTimer = setTimeout(() => {
                pausedRef.current = false;
            }, 4000);
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
    }, [items]);

    if (!items?.length) return null;

    return (
        <div className="space-y-3">
            <div ref={containerRef} className="relative w-full h-[280px] sm:h-[360px] lg:h-[440px] rounded-2xl overflow-hidden cursor-grab active:cursor-grabbing select-none">
                {items.map((item, i) => (
                    <div
                        key={item.id ?? item.seriesKey}
                        className="absolute inset-0 transition-opacity duration-700"
                        style={{ opacity: i === active ? 1 : 0, pointerEvents: i === active ? "auto" : "none" }}>
                        <HeroSlide item={item} />
                    </div>
                ))}
            </div>
            {items.length > 1 && (
                <div className="flex items-center justify-center gap-2">
                    {items.map((_, i) => (
                        <button
                            key={i}
                            onClick={() => setActive(i)}
                            aria-label={`Go to slide ${i + 1}`}
                            className={`h-1.5 rounded-full transition-all cursor-pointer ${i === active ? "w-6 bg-primary" : "w-1.5 bg-white/30 hover:bg-white/50"}`}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

// Grid, not a horizontal-scrolling MediaRow — this is a dedicated full page,
// not a Home-style row.
function Section({ title, items }) {
    if (!items?.length) return null;
    return (
        <section>
            <h2 className="text-base sm:text-lg font-semibold text-base-content mb-3">{title}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-3">
                {items.map((item) => (
                    <MediaCard key={item.id ?? item.seriesKey} item={item} />
                ))}
            </div>
        </section>
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
        // (Hero banners are built further below, once Trending/New are ready —
        // they draw from recently-released + trending, not just this list.)
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

        // ── Hero banners — REAL-WORLD signals, not local FLUX activity:
        //   "Recently Released" → actual TMDB releaseDate/firstAirDate,
        //     NOT metadata.date (that's when the file was scanned into your
        //     library, a totally different thing).
        //   "Trending" → rating × log(votes) as a real-world buzz proxy —
        //     TMDB's own crowd engagement, not this client's own watch
        //     history (which barely means anything on a small personal
        //     library). This is an APPROXIMATION: tmdb.js never captured
        //     TMDB's actual `popularity` field, so this isn't literally
        //     TMDB's trending list — that would need a small tmdb.js change.
        // Personalized top pick folded in first when one exists. Deduped,
        // capped at 6 slides.
        const heroSeen = new Set();
        const heroItems = [];
        const addHero = (item, reason) => {
            if (!item || heroSeen.has(item.id) || heroItems.length >= 6) return;
            heroSeen.add(item.id);
            heroItems.push({ ...item, _heroReason: reason });
        };

        // FIX: these previously had no real cutoff at all — "New Release" was
        // just "newest thing you happen to own" (could be a decade old) and
        // "Trending" used local watch history (meaningless on a small
        // personal library). Now both require a genuine minimum bar; if
        // nothing clears it, that bucket contributes nothing rather than
        // forcing in a stale/weak item under a misleading label.
        const recentCutoff = new Date();
        recentCutoff.setFullYear(recentCutoff.getFullYear() - 3);
        const recentReleases = [...pool]
            .filter((i) => {
                const d = i.metadata?.releaseDate || i.metadata?.firstAirDate;
                return d && new Date(d) >= recentCutoff;
            })
            .sort((a, b) => new Date(b.metadata.releaseDate || b.metadata.firstAirDate) - new Date(a.metadata.releaseDate || a.metadata.firstAirDate));

        const MIN_TRENDING_VOTES = 50; // below this, a rating is too thin to mean "trending"
        const buzzRanked = [...pool]
            .filter((i) => (i.metadata?.votes || 0) >= MIN_TRENDING_VOTES)
            .sort((a, b) => (b.metadata.rating || 0) * Math.log10(b.metadata.votes + 1) - (a.metadata.rating || 0) * Math.log10(a.metadata.votes + 1));

        if (recommendedForYou[0]) addHero(recommendedForYou[0], recommendedForYou[0]._recReasons?.[0] || "Picked for You");
        for (const item of recentReleases) addHero(item, "New Release");
        for (const item of buzzRanked) addHero(item, "Trending");

        return {
            heroItems,
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

    const nothingYet = !isLoading && (!feed || !feed.recommendedForYou.length);

    return (
        <div className="space-y-10">
            {nothingYet && <div className="text-base-content/60">Not enough activity yet — favourite, watchlist, or watch a bit more and check back.</div>}

            <HeroCarousel items={feed?.heroItems} />

            <Section title="For You" items={feed?.recommendedForYou} />
            <Section title="Trending" items={feed?.trendingNow} />
            <Section title="Your Taste" items={feed?.moreLikeFavourites} />
            <Section title="New Arrivals" items={feed?.newAndRecentlyAdded} />
            <Section title="Popular" items={feed?.mostPopular} />

            {feed?.favoriteGenres?.length > 0 && (
                <section>
                    <h2 className="text-base sm:text-lg font-semibold text-base-content mb-4">Top Genres</h2>
                    <div className="space-y-8">
                        {feed.favoriteGenres.map(({ genre, items }) => (
                            <Section key={genre} title={genre.replace(/\b\w/g, (c) => c.toUpperCase())} items={items} />
                        ))}
                    </div>
                </section>
            )}

            <Section title="Top Rated" items={feed?.highlyRated} />
            <Section title="Hidden Gems" items={feed?.hiddenGems} />
            <Section title="You Missed" items={feed?.youMightHaveMissed} />
            <Section title="Weekend Picks" items={feed?.weekendPicks} />
            <Section title="More Picks" items={feed?.moreForYou} />
        </div>
    );
}
