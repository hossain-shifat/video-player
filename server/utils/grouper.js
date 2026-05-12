"use strict";

const { parseFilename } = require("./nameParser");
const { getMetadata } = require("./metadataStore");
const { getSeasonDetails } = require("./tmdb");

/**
 * Groups a flat enriched media list into:
 * {
 *   movies:  [ { ...file, parsed, metadata, category } ],
 *   series:  [ { title, type, seriesKey, metadata, seasons, category } ],
 *   anime:   [ same shape as series ],
 *   unknown: [ files where type could not be determined ]
 * }
 */
async function groupMedia(flatFiles) {
    const movieFiles = [];
    const seriesMap = new Map(); // key → series group
    const animeMap = new Map();
    const unknown = [];

    for (const file of flatFiles) {
        const parsed = parseFilename(file.name);

        if (parsed.type === "movie") {
            movieFiles.push({ ...file, parsed });
            continue;
        }

        // Series or anime — group by title key
        const key = normalizeKey(parsed.title);
        const targetMap = parsed.type === "anime" ? animeMap : seriesMap;

        if (!targetMap.has(key)) {
            targetMap.set(key, {
                title: parsed.title,
                type: parsed.type,
                seriesKey: key,
                metadata: null, // filled below
                seasons: new Map(), // seasonNum → { meta, episodes[] }
                folderId: file.folderId,
                folderLabel: file.folderLabel,
            });
        }

        const group = targetMap.get(key);
        const seasonNum = parsed.season ?? 1; // default to season 1 if not detected
        const episodeNum = parsed.episode ?? null;

        if (!group.seasons.has(seasonNum)) {
            group.seasons.set(seasonNum, { seasonNumber: seasonNum, tmdbMeta: null, episodes: [] });
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

    // ── Enrich movies with TMDB metadata ──────────────────────────────────────
    // Mirrors exactly what categoryController.buildCategoryIndex() does so both
    // endpoints return identical movie shapes (poster, rating, genres, etc.).
    const movies = await Promise.all(
        movieFiles.map(async (movie) => {
            const metadata = await getMetadata(movie);
            return {
                ...movie,
                metadata,
                category: metadata?.genres ?? [],
            };
        }),
    );

    // ── Enrich series / anime with TMDB ───────────────────────────────────────
    await enrichGroups(seriesMap);
    await enrichGroups(animeMap);

    // ── Sort episodes within each season ─────────────────────────────────────
    function sortGroup(group) {
        const seasonsObj = {};
        const sortedSeasons = [...group.seasons.entries()].sort(([a], [b]) => a - b);
        for (const [num, season] of sortedSeasons) {
            season.episodes.sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0));
            // Attach TMDB episode detail if available
            if (season.tmdbMeta?.episodes) {
                season.episodes = season.episodes.map((ep) => {
                    const tmdbEp = season.tmdbMeta.episodes.find((t) => t.episode === ep.episode);
                    return tmdbEp ? { ...ep, title: tmdbEp.title, overview: tmdbEp.overview, airDate: tmdbEp.airDate, runtime: tmdbEp.runtime, still: tmdbEp.still, rating: tmdbEp.rating } : ep;
                });
            }
            const { tmdbMeta, ...seasonOut } = season;
            seasonsObj[num] = {
                seasonNumber: num,
                name: tmdbMeta?.name || `Season ${num}`,
                overview: tmdbMeta?.overview || null,
                poster: tmdbMeta?.poster || null,
                episodeCount: season.episodes.length,
                episodes: seasonOut.episodes,
            };
        }
        return { ...group, seasons: seasonsObj, category: group.metadata?.genres ?? [] };
    }

    return {
        movies,
        series: [...seriesMap.values()].map(sortGroup),
        anime: [...animeMap.values()].map(sortGroup),
        unknown,
    };
}

// Fetches TMDB metadata for each group and season
async function enrichGroups(groupMap) {
    for (const group of groupMap.values()) {
        // Use first episode file as the representative file for metadata lookup
        const firstSeason = [...group.seasons.values()][0];
        const firstEpisode = firstSeason?.episodes[0];
        if (!firstEpisode) continue;

        const metadata = await getMetadata(firstEpisode);
        group.metadata = metadata;

        // If TMDB returned season/episode data, fetch per-season details
        if (metadata?.tmdbId) {
            for (const [seasonNum, season] of group.seasons.entries()) {
                try {
                    season.tmdbMeta = await getSeasonDetails(metadata.tmdbId, seasonNum);
                } catch {
                    // Season may not exist on TMDB — skip silently
                }
            }
        }
    }
}

// Normalizes a title to a stable map key (lowercase, no punctuation)
function normalizeKey(title) {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

module.exports = { groupMedia };
