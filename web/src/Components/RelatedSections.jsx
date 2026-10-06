import { useMemo } from "react";
import { useApi } from "../Context/apiContext";
import MediaRow from "./MediaRow";

// ============================================================================
// ─── RelatedSections ──────────────────────────────────────────────────────────
// Single container for MediaDetails.jsx's 4 "related titles" rows, modeled on
// the Plex media-details layout: Titles You Might Like → More From This Cast
// & Crew → [Title] Collection → More From This Studio. Rendered together from
// one call site so MediaDetails.jsx doesn't grow another import/JSX block per
// section.
//
// Every section here is LOCAL-LIBRARY matching only (movies/series/anime
// pools from useApi()) — same philosophy as the original SimilarMedia.jsx:
// recommend from what the user actually owns, never an external TMDB
// discover call. No backend changes were needed for any of this — cast,
// crew, production_companies, and collection are already in cached metadata
// (server/utils/tmdb.js, v18/v19 layer).
//
// Real metadata shapes used below (confirmed against server/utils/tmdb.js —
// NOT invented):
//   metadata.genres            → string[]
//   metadata.collection        → { tmdbId, name, poster, backdrop } | null
//   metadata.keywords          → { tmdbId, name }[]  (defensively also accepts bare strings)
//   metadata.cast              → { tmdbPersonId, name, character, order, photo }[]
//   metadata.crew              → { tmdbPersonId, name, job, department, photo }[]
//   metadata.production_companies → { tmdbCompanyId, name, logo, originCountry, ... }[]
//   metadata.networks          → { id, name, logo }[]   (NOTE: field is `id`, not `tmdbId`)
//   metadata.spokenLanguages   → { code, name, englishName }[]
//   metadata.originCountries   → string[] (ISO codes)
//   metadata.tmdbId, .year, .rating → number | null
//   item.category              → string[] — pre-metadata / old-cache genre fallback
// ============================================================================

function norm(s) {
    return (s ?? "").toString().toLowerCase().trim();
}

// One overlap check, reused for the TitlesYouMightLike signal scoring below.
// Diminishing returns per additional shared value (each extra one worth 60%
// of the last) plus a hard cap — so e.g. 20 shared keywords can never
// out-weigh "same collection", but 2-3 shared values still meaningfully
// outscore just 1.
function overlapScore(setA, setB, perItem, cap) {
    if (!setA?.size || !setB?.size) return 0;
    let count = 0;
    for (const v of setA) if (setB.has(v)) count++;
    if (!count) return 0;
    let score = 0;
    for (let i = 0; i < count; i++) score += perItem * Math.pow(0.6, i);
    return Math.min(score, cap);
}

// ── Signal / identity extractors — shared by every section below, each
// defensive against missing/old/malformed metadata.
function genreSet(item, fallbackGenres) {
    const arr = item?.metadata?.genres?.length ? item.metadata.genres : item?.category?.length ? item.category : fallbackGenres || [];
    return new Set(arr.map(norm).filter(Boolean));
}
function keywordSet(item) {
    const arr = item?.metadata?.keywords || [];
    return new Set(arr.map((k) => norm(typeof k === "string" ? k : k?.name)).filter(Boolean));
}
function castIdSet(item) {
    return new Set((item?.metadata?.cast || []).map((c) => c?.tmdbPersonId).filter((v) => v != null));
}
// Any crew role at all (not just director/writer/producer) — used by
// MoreFromCastAndCrew below, matching the same "does this person appear
// anywhere in this title" check CastAndCrew.jsx's per-person filmography
// already uses.
function crewIdSet(item) {
    return new Set((item?.metadata?.crew || []).map((c) => c?.tmdbPersonId).filter((v) => v != null));
}
const IMPORTANT_CREW_JOBS = new Set(["Director", "Writer", "Screenplay", "Story", "Producer", "Executive Producer", "Editor"]);
function importantCrewIdSet(item) {
    return new Set(
        (item?.metadata?.crew || [])
            .filter((c) => IMPORTANT_CREW_JOBS.has(c?.job))
            .map((c) => c?.tmdbPersonId)
            .filter((v) => v != null),
    );
}
function companyIdSet(item) {
    return new Set((item?.metadata?.production_companies || []).map((p) => p?.tmdbCompanyId ?? (p?.name ? `name:${norm(p.name)}` : null)).filter(Boolean));
}
function networkIdSet(item) {
    return new Set((item?.metadata?.networks || []).map((n) => n?.id ?? (n?.name ? `name:${norm(n.name)}` : null)).filter((v) => v != null));
}
function languageCodeSet(item) {
    return new Set((item?.metadata?.spokenLanguages || []).map((l) => l?.code).filter(Boolean));
}
function countryCodeSet(item) {
    return new Set((item?.metadata?.originCountries || []).filter(Boolean));
}
function getCollectionId(item) {
    return item?.metadata?.collection?.tmdbId ?? null;
}
function getYear(item) {
    return item?.metadata?.year ?? null;
}
function getRating(item) {
    return item?.metadata?.rating ?? null;
}
// Prefer the TMDB id — same real-world title scanned twice into two folders
// (two different local file/series ids) still correctly counts as "the same
// thing", not a recommendation of itself. Falls back to local id/seriesKey
// when there's no TMDB match at all (old/notFound metadata).
function stableId(item) {
    return item?.metadata?.tmdbId ?? item?.id ?? item?.seriesKey ?? null;
}
function localId(item) {
    return item?.id ?? item?.seriesKey ?? null;
}

// Same franchise-title heuristic the old inline relatedParts block in
// MediaDetails.jsx used — kept verbatim as the fallback path for
// CollectionRow below, for titles TMDB hasn't linked to a real collection.
function franchiseBase(t) {
    return t
        .toLowerCase()
        .replace(/\s*:\s*.+$/, (m, offset, str) => (str.slice(0, offset).length >= 3 ? "" : m))
        .replace(/\s+(chapter|part|vol\.?|volume)\s+[\divxIVX]+\s*$/i, "")
        .replace(/\s+\d+\s*$/, "")
        .trim();
}

// ─── 1. Titles You Might Like ─────────────────────────────────────────────────
// Formerly SimilarMedia.jsx, relocated verbatim (see prior delivery for the
// full audit trail) — only the component name/location and row title changed.
function TitlesYouMightLike({ currentId, genres = [], mediaType = "movie", limit = 24 }) {
    const { movies, series, anime } = useApi();

    const similar = useMemo(() => {
        const typePool = mediaType === "anime" ? anime : mediaType === "series" ? series : movies;
        if (!typePool?.length) return [];

        const currentItem = [...movies, ...series, ...anime].find((x) => x.id === currentId || x.seriesKey === currentId) ?? null;

        const curGenres = genreSet(currentItem, genres);
        const curKeywords = keywordSet(currentItem);
        const curCast = castIdSet(currentItem);
        const curCrew = importantCrewIdSet(currentItem);
        const curCompanies = companyIdSet(currentItem);
        const curNetworks = networkIdSet(currentItem);
        const curLangs = languageCodeSet(currentItem);
        const curCountries = countryCodeSet(currentItem);
        const curCollectionId = getCollectionId(currentItem);
        const curYear = getYear(currentItem);
        const currentStableId = stableId(currentItem) ?? currentId;

        if (!curGenres.size && !curKeywords.size && !curCast.size && !curCrew.size && !curCollectionId) {
            return [];
        }

        const scored = [];
        for (const candidate of typePool) {
            if (candidate.id === currentId || candidate.seriesKey === currentId) continue;
            const candStableId = stableId(candidate);
            if (candStableId != null && candStableId === currentStableId) continue;

            let score = 0;
            const reasons = [];

            const candCollectionId = getCollectionId(candidate);
            if (curCollectionId != null && candCollectionId != null && curCollectionId === candCollectionId) {
                score += 50;
                reasons.push("Same collection");
            }

            const g = overlapScore(curGenres, genreSet(candidate, null), 10, 30);
            if (g > 0) {
                score += g;
                reasons.push("Shared genres");
            }

            const k = overlapScore(curKeywords, keywordSet(candidate), 8, 16);
            if (k > 0) {
                score += k;
                reasons.push("Shared keywords");
            }

            const c = overlapScore(curCast, castIdSet(candidate), 8, 16);
            if (c > 0) {
                score += c;
                reasons.push("Shared cast");
            }

            const cr = overlapScore(curCrew, importantCrewIdSet(candidate), 12, 12);
            if (cr > 0) {
                score += cr;
                reasons.push("Same director/writer/producer");
            }

            const co = overlapScore(curCompanies, companyIdSet(candidate), 6, 6);
            if (co > 0) {
                score += co;
                reasons.push("Same studio");
            }

            if (mediaType !== "movie") {
                const n = overlapScore(curNetworks, networkIdSet(candidate), 4, 4);
                if (n > 0) {
                    score += n;
                    reasons.push("Same network");
                }
            }

            score += overlapScore(curLangs, languageCodeSet(candidate), 3, 3);
            score += overlapScore(curCountries, countryCodeSet(candidate), 2, 2);

            const candYear = getYear(candidate);
            if (curYear && candYear) {
                score += Math.max(0, 2 - Math.floor(Math.abs(curYear - candYear) / 3));
            }

            const candRating = getRating(candidate);
            if (candRating) score += (candRating / 10) * 1;

            if (score <= 0) continue;
            scored.push({ item: candidate, score, reasons });
        }

        scored.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            const ratingDiff = (getRating(b.item) ?? 0) - (getRating(a.item) ?? 0);
            if (ratingDiff !== 0) return ratingDiff;
            return (getYear(b.item) ?? 0) - (getYear(a.item) ?? 0);
        });

        return scored.slice(0, limit).map((s) => ({ ...s.item, _simScore: s.score, _simReasons: s.reasons }));
    }, [movies, series, anime, currentId, genres, mediaType, limit]);

    return (
        <MediaRow
            title="Titles You Might Like"
            items={similar}
            onPlay={(raw) => {
                if (raw?.streamUrl) window.location.href = raw.streamUrl;
            }}
        />
    );
}

// ─── 2. More From This Cast & Crew ────────────────────────────────────────────
// Aggregates library appearances across the current title's top-billed cast
// (by TMDB `order`, top 8) plus its key crew (director/writer/producer/etc,
// same IMPORTANT_CREW_JOBS set the similarity scorer above uses) into ONE
// row, ranked by how many of those people each candidate shares. Same
// per-person "does this id appear in this title's cast or crew" check
// CastAndCrew.jsx's per-person filmography modal already does — this just
// runs it for every top person at once and merges the results into a single
// always-visible row instead of requiring a click per person.
function MoreFromCastAndCrew({ currentId, limit = 24 }) {
    const { movies, series, anime } = useApi();

    const items = useMemo(() => {
        const pool = [...movies, ...series, ...anime];
        const currentItem = pool.find((x) => x.id === currentId || x.seriesKey === currentId) ?? null;
        if (!currentItem) return [];

        const topCastIds = (currentItem?.metadata?.cast || [])
            .slice()
            .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
            .slice(0, 8)
            .map((c) => c.tmdbPersonId)
            .filter((v) => v != null);
        const keyCrewIds = importantCrewIdSet(currentItem);
        const personIds = new Set([...topCastIds, ...keyCrewIds]);
        if (!personIds.size) return [];

        const currentStableId = stableId(currentItem) ?? currentId;
        const scored = [];
        for (const candidate of pool) {
            if (localId(candidate) === currentId) continue;
            const candStable = stableId(candidate);
            if (candStable != null && candStable === currentStableId) continue;

            const candCast = castIdSet(candidate);
            const candCrew = crewIdSet(candidate);
            let matchCount = 0;
            for (const pid of personIds) {
                if (candCast.has(pid) || candCrew.has(pid)) matchCount++;
            }
            if (matchCount === 0) continue;
            scored.push({ item: candidate, matchCount, rating: getRating(candidate) ?? 0 });
        }

        scored.sort((a, b) => b.matchCount - a.matchCount || b.rating - a.rating);
        return scored.slice(0, limit).map((s) => s.item);
    }, [movies, series, anime, currentId, limit]);

    return (
        <MediaRow
            title="More From This Cast & Crew"
            items={items}
            onPlay={(raw) => {
                if (raw?.streamUrl) window.location.href = raw.streamUrl;
            }}
        />
    );
}

// ─── 3. [Title] Collection ────────────────────────────────────────────────────
// Movie-only (TV has no TMDB "collection" concept — same gate the old inline
// relatedParts block used). Primary match is the real metadata.collection.tmdbId
// (already fetched by tmdb.js, previously only ever displayed as plain text in
// the Details grid). Falls back to the old franchise-title heuristic when the
// current movie has no TMDB-linked collection, so no matching capability that
// existed before was lost.
function CollectionRow({ currentId, mediaType, limit = 24 }) {
    const { movies } = useApi();

    const { list, heading } = useMemo(() => {
        if (mediaType !== "movie") return { list: [], heading: null };
        const currentItem = movies.find((mv) => mv.id === currentId) ?? null;
        if (!currentItem) return { list: [], heading: null };

        const curCollectionId = getCollectionId(currentItem);
        if (curCollectionId != null) {
            const list = movies.filter((mv) => mv.id !== currentId && getCollectionId(mv) === curCollectionId).sort((a, b) => (getYear(a) ?? 0) - (getYear(b) ?? 0));
            return { list, heading: currentItem?.metadata?.collection?.name || null };
        }

        // Fallback: title-text heuristic (pre-existing behavior, unchanged)
        const tmdbTitle = currentItem?.metadata?.title;
        if (!tmdbTitle) return { list: [], heading: null };
        const base = franchiseBase(tmdbTitle);
        if (!base || base.length < 3) return { list: [], heading: null };
        const list = movies
            .filter((mv) => {
                if (mv.id === currentId) return false;
                const otherTitle = mv.metadata?.title;
                if (!otherTitle) return false;
                const otherBase = franchiseBase(otherTitle);
                return otherBase === base || otherBase.startsWith(base) || base.startsWith(otherBase);
            })
            .sort((a, b) => (getYear(a) ?? 0) - (getYear(b) ?? 0));
        return { list, heading: null };
    }, [movies, currentId, mediaType]);

    if (!list.length) return null;

    const fallbackTitle =
        movies
            .find((mv) => mv.id === currentId)
            ?.metadata?.title?.replace(/\s*:.*$/, "")
            .replace(/\s+\d+$/, "")
            .replace(/\s+(chapter|part|vol|volume)\s+[\divxIVX]+$/i, "")
            .trim() || "like this";

    return <MediaRow title={heading || `More ${fallbackTitle}`} items={list.slice(0, limit)} />;
}

// ─── 4. More From This Studio ─────────────────────────────────────────────────
// Movies match by shared production_companies[].tmdbCompanyId; series/anime
// additionally match by shared networks[].id (movies never have networks, TV
// rarely carries production_companies the way movies do — using both covers
// "studio" for every media type without a separate code path per type).
function MoreFromStudio({ currentId, limit = 24 }) {
    const { movies, series, anime } = useApi();

    const items = useMemo(() => {
        const pool = [...movies, ...series, ...anime];
        const currentItem = pool.find((x) => x.id === currentId || x.seriesKey === currentId) ?? null;
        if (!currentItem) return [];

        const curCompanies = companyIdSet(currentItem);
        const curNetworks = networkIdSet(currentItem);
        if (!curCompanies.size && !curNetworks.size) return [];

        const currentStableId = stableId(currentItem) ?? currentId;
        const scored = [];
        for (const candidate of pool) {
            if (localId(candidate) === currentId) continue;
            const candStable = stableId(candidate);
            if (candStable != null && candStable === currentStableId) continue;

            const candCompanies = companyIdSet(candidate);
            const candNetworks = networkIdSet(candidate);
            let matchCount = 0;
            for (const v of curCompanies) if (candCompanies.has(v)) matchCount++;
            for (const v of curNetworks) if (candNetworks.has(v)) matchCount++;
            if (matchCount === 0) continue;
            scored.push({ item: candidate, matchCount, rating: getRating(candidate) ?? 0 });
        }

        scored.sort((a, b) => b.matchCount - a.matchCount || b.rating - a.rating);
        return scored.slice(0, limit).map((s) => s.item);
    }, [movies, series, anime, currentId, limit]);

    return (
        <MediaRow
            title="More From This Studio"
            items={items}
            onPlay={(raw) => {
                if (raw?.streamUrl) window.location.href = raw.streamUrl;
            }}
        />
    );
}

// ─── RelatedSections — main export ────────────────────────────────────────────
// Order matches the Plex reference layout: Might Like → Cast & Crew →
// Collection → Studio. Each inner row already returns null when it has
// nothing to show (MediaRow.jsx's own empty-array guard), so no extra
// wrapping/guards are needed here.
export default function RelatedSections({ currentId, genres = [], mediaType = "movie" }) {
    return (
        <>
            <TitlesYouMightLike currentId={currentId} genres={genres} mediaType={mediaType} />
            <MoreFromCastAndCrew currentId={currentId} />
            <CollectionRow currentId={currentId} mediaType={mediaType} />
            <MoreFromStudio currentId={currentId} />
        </>
    );
}
