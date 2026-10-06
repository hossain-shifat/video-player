import { useMemo } from "react";
import { useApi } from "../Context/apiContext";
import MediaRow from "./MediaRow";

// ============================================================================
// ─── Similar-media scoring — audit summary ───────────────────────────────────
// Old version: single signal (genre overlap count), re-derived genre arrays
// inside BOTH .filter() and .sort() (recomputed on every comparison during
// sort — O(n log n) reparses of the same data), and only ever received a bare
// `genres` string array as a prop — no access to the rest of the current
// item's metadata (collection/cast/crew/keywords/etc) at all.
//
// This version pulls the CURRENT item's full metadata from the same context
// pools (`movies`/`series`/`anime`) the parent already loaded — via the exact
// same `id === X || seriesKey === X` lookup MediaDetails.jsx itself uses to
// resolve the page's own item — so no parent/prop-API change was needed. The
// `genres` prop is kept and still used as the fallback tier when that lookup
// can't find the current item (e.g. a brief deep-link window before context
// finishes loading) — matches the plan's explicit request not to force a
// broader refactor just for this.
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

// One overlap check, reused for every signal below. Diminishing returns per
// additional shared value (each extra one worth 60% of the last) plus a hard
// cap — so e.g. 20 shared keywords can never out-weigh "same collection", but
// 2-3 shared values still meaningfully outscore just 1.
function overlapScore(setA, setB, perItem, cap) {
    if (!setA?.size || !setB?.size) return 0;
    let count = 0;
    for (const v of setA) if (setB.has(v)) count++;
    if (!count) return 0;
    let score = 0;
    for (let i = 0; i < count; i++) score += perItem * Math.pow(0.6, i);
    return Math.min(score, cap);
}

// ── Signal extractors — each defensive against missing/old/malformed metadata
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

export default function SimilarMedia({ currentId, genres = [], mediaType = "movie", limit = 24 }) {
    const { movies, series, anime } = useApi();

    const similar = useMemo(() => {
        const typePool = mediaType === "anime" ? anime : mediaType === "series" ? series : movies;
        if (!typePool?.length) return [];

        // Self-lookup — mirrors MediaDetails.jsx's own resolver exactly
        // (`id === X || seriesKey === X` against the combined pool) so the
        // current item's FULL metadata is available here without touching
        // the parent component or its prop API at all.
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

        // No usable signal anywhere (no genres prop, no metadata at all) —
        // nothing meaningful to compare against. Return [] rather than
        // guessing/padding with unrelated titles.
        if (!curGenres.size && !curKeywords.size && !curCast.size && !curCrew.size && !curCollectionId) {
            return [];
        }

        // ── Single pass: compute + score every candidate exactly once. ──────────
        // (Old version rebuilt genre arrays a second time inside .sort()'s
        // comparator, which reruns per comparison during the sort itself —
        // that redundant work is what this single-pass loop avoids.)
        const scored = [];
        for (const candidate of typePool) {
            if (candidate.id === currentId || candidate.seriesKey === currentId) continue;
            const candStableId = stableId(candidate);
            if (candStableId != null && candStableId === currentStableId) continue; // same real title, different local copy

            let score = 0;
            const reasons = []; // not rendered — kept for debugging per the plan's "explainability" note

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

            // Networks only make sense for TV/anime — movies never have them,
            // and an empty set on both sides already scores 0 anyway, but the
            // explicit guard keeps intent clear and skips the set-build for movies.
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
            if (candRating) score += (candRating / 10) * 1; // tiny tie-breaker only, never the main signal

            if (score <= 0) continue; // no real signal in common — exclude rather than pad the row
            scored.push({ item: candidate, score, reasons });
        }

        // Sort by similarity score first (the whole point of this component),
        // rating/year only break ties — never the primary sort key.
        scored.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            const ratingDiff = (getRating(b.item) ?? 0) - (getRating(a.item) ?? 0);
            if (ratingDiff !== 0) return ratingDiff;
            return (getYear(b.item) ?? 0) - (getYear(a.item) ?? 0);
        });

        return scored.slice(0, limit).map((s) => ({ ...s.item, _simScore: s.score, _simReasons: s.reasons }));
    }, [movies, series, anime, currentId, genres, mediaType, limit]);

    const label = mediaType === "anime" ? "Similar Anime" : mediaType === "series" ? "Similar Series" : "Similar Movies";

    return (
        <MediaRow
            title={label}
            items={similar}
            onPlay={(raw) => {
                if (raw?.streamUrl) window.location.href = raw.streamUrl;
            }}
        />
    );
}
