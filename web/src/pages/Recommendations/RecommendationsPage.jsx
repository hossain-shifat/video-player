import { useMemo, useRef, useEffect } from "react";
import { useApi } from "../../Context/apiContext";
import { useRecommendations, useRefreshRecommendations } from "../../Hooks/Query/useRecommendations";
import MediaCard from "../../Components/Media/MediaCard";
import { RecommendationsHeroBanner, RecommendationsTonightsPicksBanner } from "../../Components/Layout/Banner";

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
// HERO BANNER + TONIGHT'S PICKS: live in Components/Banner.jsx as self-contained
// sections (<RecommendationsHeroBanner />, <RecommendationsTonightsPicksBanner />).
// Ids + placement: Components/BANNERS.md.
// ============================================================================

const SECTION_SIZE = 12;
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // "Trending" window
const NEW_LIBRARY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // "sat in library a while" threshold for Missed

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

// Grid, not a horizontal-scrolling MediaRow — this is a dedicated full page,
// not a Home-style row.
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
        <div className="space-y-6 sm:space-y-10">
            {nothingYet && <div className="text-base-content/60">Not enough activity yet — favourite, watchlist, or watch a bit more and check back.</div>}

            {/* BANNER 4 · id banner-recommendations-hero */}
            <RecommendationsHeroBanner />

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
                    {/* BANNER 5 · id banner-recommendations-tonights-picks */}
                    <RecommendationsTonightsPicksBanner />

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
