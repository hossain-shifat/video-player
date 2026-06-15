"use strict";

const { parseFilename } = require("./nameParser");
const { getMetadata, getCachedSeason, setCachedSeason } = require("./metadataStore");
const { getSeasonDetails } = require("./tmdb");

// ─── ID helpers ───────────────────────────────────────────────────────────────
// IDs follow the same convention as file IDs produced by generateFileId() in
// fileHelpers.js: Buffer.from(someString).toString("base64url").
// This keeps all IDs visually consistent across the API.

/**
 * Series ID  — encodes "series:<type>:<normalizedTitle>"
 *   e.g. Buffer.from("series:series:stranger things").toString("base64url")
 *
 * Season ID  — encodes "season:<seriesId>:<seasonNum>"
 *   e.g. Buffer.from("season:<seriesId>:1").toString("base64url")
 *
 * Part ID    — encodes "part:<normalizedTitle>:<partNum>"
 *   e.g. Buffer.from("part:kgf chapter:1").toString("base64url")
 */
function makeSeriesId(type, normalizedTitle) {
    return Buffer.from(`${type}:${normalizedTitle}`).toString("base64url");
}

function makeSeasonId(seriesId, seasonNum) {
    return Buffer.from(`season:${seriesId}:${seasonNum}`).toString("base64url");
}

function makePartId(normalizedTitle, partNum) {
    return Buffer.from(`part:${normalizedTitle}:${partNum}`).toString("base64url");
}

// ─── Main grouper ─────────────────────────────────────────────────────────────

/**
 * Groups a flat file list into:
 * {
 *   movies:  [ { id?, partId?, ...file, parsed, metadata, category } ],
 *   series:  [ { id, title, type, seriesKey, metadata, seasons, category } ],
 *   anime:   [ same shape as series ],
 *   unknown: []
 * }
 */
async function groupMedia(flatFiles) {
    const movieFiles = [];
    const seriesMap = new Map(); // normalizedKey → series group
    const animeMap = new Map();
    const unknown = [];

    // ── Pass 1: classify and bucket every file ────────────────────────────────
    for (const file of flatFiles) {
        const parsed = parseFilename(file.name);

        if (parsed.type === "movie") {
            movieFiles.push({ ...file, parsed });
            continue;
        }

        const key = normalizeKey(parsed.title);
        const targetMap = parsed.type === "anime" ? animeMap : seriesMap;

        if (!targetMap.has(key)) {
            const seriesId = makeSeriesId(parsed.type, key);
            targetMap.set(key, {
                // ← stable series-level ID
                id: seriesId,
                title: parsed.title,
                type: parsed.type,
                seriesKey: key,
                metadata: null,
                seasons: new Map(), // seasonNum → { id, tmdbMeta, episodes[] }
                folderId: file.folderId,
                folderLabel: file.folderLabel,
            });
        }

        const group = targetMap.get(key);
        const seasonNum = parsed.season ?? 1;
        const episodeNum = parsed.episode ?? null;

        if (!group.seasons.has(seasonNum)) {
            // ← stable season-level ID
            const seasonId = makeSeasonId(group.id, seasonNum);
            group.seasons.set(seasonNum, {
                id: seasonId,
                seasonNumber: seasonNum,
                tmdbMeta: null,
                episodes: [],
            });
        }

        group.seasons.get(seasonNum).episodes.push({
            id: file.id,
            episode: episodeNum,
            name: file.name,
            size: file.size,
            streamUrl: file.streamUrl,
            parsed,
        });
    }

    // ── Pass 2: enrich movies with TMDB metadata ──────────────────────────────
    const movies = await Promise.all(
        movieFiles.map(async (movie) => {
            const metadata = await getMetadata(movie);

            // If the movie has a part number, add a stable part ID so the
            // client can group multi-part films (KGF Chapter 1 / 2, etc.)
            const partId = movie.parsed.part != null ? makePartId(normalizeKey(movie.parsed.title), movie.parsed.part) : null;

            return {
                ...movie,
                ...(partId && { partId }), // only included when part exists
                metadata,
                category: metadata?.genres ?? [],
            };
        }),
    );

    // ── Pass 3: enrich series / anime with TMDB ───────────────────────────────
    await enrichGroups(seriesMap);
    await enrichGroups(animeMap);

    // ── Pass 4: sort + shape each group for the API response ─────────────────
    return {
        movies,
        series: [...seriesMap.values()].map(sortGroup),
        anime: [...animeMap.values()].map(sortGroup),
        unknown,
    };
}

// ─── Group shaping ────────────────────────────────────────────────────────────

function sortGroup(group) {
    const seasonsObj = {};
    const sortedSeasons = [...group.seasons.entries()].sort(([a], [b]) => a - b);

    for (const [num, season] of sortedSeasons) {
        // Sort episodes by episode number (nulls last)
        season.episodes.sort((a, b) => (a.episode ?? Infinity) - (b.episode ?? Infinity));

        // Attach TMDB per-episode detail when available
        if (season.tmdbMeta?.episodes) {
            season.episodes = season.episodes.map((ep) => {
                const tmdbEp = season.tmdbMeta.episodes.find((t) => t.episode === ep.episode);
                return tmdbEp
                    ? {
                          ...ep,
                          title: tmdbEp.title,
                          overview: tmdbEp.overview,
                          airDate: tmdbEp.airDate,
                          runtime: tmdbEp.runtime,
                          still: tmdbEp.still,
                          rating: tmdbEp.rating,
                      }
                    : ep;
            });
        }

        const { tmdbMeta, ...seasonOut } = season;
        seasonsObj[num] = {
            id: season.id, // ← season ID included in output
            seasonNumber: num,
            name: tmdbMeta?.name || `Season ${num}`,
            overview: tmdbMeta?.overview || null,
            poster: tmdbMeta?.poster || null,
            episodeCount: season.episodes.length,
            episodes: seasonOut.episodes,
        };
    }

    return {
        id: group.id, // ← series ID included in output
        title: group.title,
        type: group.type,
        seriesKey: group.seriesKey,
        folderId: group.folderId,
        folderLabel: group.folderLabel,
        metadata: group.metadata,
        seasons: seasonsObj,
        category: group.metadata?.genres ?? [],
    };
}

// ─── TMDB enrichment ──────────────────────────────────────────────────────────

/**
 * For each series / anime group:
 *   1. Finds the best representative episode to use for the TMDB lookup.
 *      Priority: S01E01 → lowest season + lowest episode → any episode.
 *   2. Fetches (or returns cached) TMDB metadata via getMetadata().
 *   3. Fetches per-season detail for every season in the group.
 *
 * "New media not getting TMDB details" was caused by always using
 * firstSeason.episodes[0] — if that episode happened to have a stale /
 * _notFound cache entry the whole series silently returned null.
 * Now we pick the most canonical episode and let metadataStore handle
 * version-based cache invalidation.
 */
async function enrichGroups(groupMap) {
    for (const group of groupMap.values()) {
        // ── Pick the best representative episode ──────────────────────────────
        const representativeEp = pickRepresentativeEpisode(group.seasons);
        if (!representativeEp) continue;

        // getMetadata() will re-fetch from TMDB whenever the cache entry is
        // absent, stale (parser version bump), or marked _notFound — so newly
        // added files are always enriched on next request.
        const metadata = await getMetadata(representativeEp);
        group.metadata = metadata;

        // ── Fetch per-season details from TMDB ───────────────────────────────────────
        if (metadata?.tmdbId) {
            await Promise.all(
                [...group.seasons.entries()].map(async ([seasonNum, season]) => {
                    try {
                        // FIX: Check persistent cache first — avoids live TMDB call
                        // on every server restart. Season data cached for 7 days.
                        let seasonData = await getCachedSeason(metadata.tmdbId, seasonNum);
                        if (!seasonData) {
                            seasonData = await getSeasonDetails(metadata.tmdbId, seasonNum);
                            await setCachedSeason(metadata.tmdbId, seasonNum, seasonData);
                        }
                        season.tmdbMeta = seasonData;
                    } catch {
                        // Season doesn't exist on TMDB — skip silently
                    }
                }),
            );
        }
    }
}

/**
 * Returns the best episode file to use as the TMDB lookup representative.
 * Preference: S01E01 → lowest-season lowest-episode → any episode.
 */
function pickRepresentativeEpisode(seasonsMap) {
    // Collect all episodes across all seasons
    const all = [];
    for (const season of seasonsMap.values()) {
        for (const ep of season.episodes) {
            all.push({ ...ep, _seasonNum: season.seasonNumber });
        }
    }
    if (!all.length) return null;

    // Prefer S01E01
    const s1e1 = all.find((e) => e._seasonNum === 1 && e.episode === 1);
    if (s1e1) return s1e1;

    // Fall back to the episode with the lowest season + episode number
    all.sort((a, b) => (a._seasonNum ?? 99) - (b._seasonNum ?? 99) || (a.episode ?? 99) - (b.episode ?? 99));
    return all[0];
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Normalizes a title to a stable map key (lowercase, alphanumeric + spaces) */
function normalizeKey(title) {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

module.exports = { groupMedia };
