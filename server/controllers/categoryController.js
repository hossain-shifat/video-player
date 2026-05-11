"use strict";

const { readFolders }     = require("./libraryController");
const { getAllCached }    = require("../utils/mediaCache");
const { getMetadata }     = require("../utils/metadataStore");
const { groupMedia }      = require("../utils/grouper");

/**
 * Builds a flat array of all enriched items (movies + series + anime),
 * each with its genres array from TMDB metadata attached.
 * Used internally by both category listing and category filtering.
 */
async function buildCategoryIndex(folders) {
    const { allMedia } = await getAllCached(folders);
    const grouped = await groupMedia(allMedia);

    const items = [];

    // Movies — enrich with metadata then attach genres
    for (const movie of grouped.movies) {
        const metadata = await getMetadata(movie);
        items.push({
            ...movie,
            metadata,
            _genres: metadata?.genres || [],
            _mediaType: "movie",
        });
    }

    // Series — metadata is already on the group object
    for (const series of grouped.series) {
        items.push({
            ...series,
            _genres: series.metadata?.genres || [],
            _mediaType: "series",
        });
    }

    // Anime
    for (const anime of grouped.anime) {
        items.push({
            ...anime,
            _genres: anime.metadata?.genres || [],
            _mediaType: "anime",
        });
    }

    return { items, grouped };
}

/**
 * GET /api/categories
 * Returns all unique genre categories found across the entire library,
 * with per-category counts broken down by media type.
 *
 * Response:
 * {
 *   total: 12,
 *   categories: [
 *     { name: "Action", total: 8, movies: 5, series: 2, anime: 1 },
 *     ...
 *   ]
 * }
 */
async function getCategories(req, res) {
    try {
        const folders = await readFolders();
        const { items } = await buildCategoryIndex(folders);

        // Aggregate counts per genre
        const map = new Map(); // genre → { total, movies, series, anime }

        for (const item of items) {
            for (const genre of item._genres) {
                if (!map.has(genre)) {
                    map.set(genre, { name: genre, total: 0, movies: 0, series: 0, anime: 0 });
                }
                const entry = map.get(genre);
                entry.total++;
                entry[item._mediaType === "movie" ? "movies"
                    : item._mediaType === "series" ? "series"
                    : "anime"]++;
            }
        }

        const categories = [...map.values()].sort((a, b) => b.total - a.total);
        return res.json({ total: categories.length, categories });
    } catch (err) {
        console.error("[Category] getCategories error:", err);
        return res.status(500).json({ error: "Failed to get categories" });
    }
}

/**
 * GET /api/categories/:name
 * Returns all media that belongs to a specific category/genre.
 * Supports the same type filter as /api/media.
 *
 * Query params:
 *   type=movies|series|anime   — filter to one media type
 *
 * Response:
 * {
 *   category: "Action",
 *   movies:  { total, items },
 *   series:  { total, items },
 *   anime:   { total, items },
 * }
 */
async function getByCategory(req, res) {
    try {
        const category = String(req.params.name || "").trim();
        const type     = String(
            Array.isArray(req.query.type) ? req.query.type[0] : req.query.type ?? ""
        ).trim().toLowerCase();

        if (!category) return res.status(400).json({ error: "Category name is required" });

        const folders = await readFolders();
        const { items } = await buildCategoryIndex(folders);

        const categoryLower = category.toLowerCase();

        const matches = items.filter((item) =>
            item._genres.some((g) => g.toLowerCase() === categoryLower)
        );

        const movies = matches.filter((i) => i._mediaType === "movie");
        const series = matches.filter((i) => i._mediaType === "series");
        const anime  = matches.filter((i) => i._mediaType === "anime");

        const response = {
            category,
            movies: { total: movies.length, items: movies },
            series: { total: series.length, items: series },
            anime:  { total: anime.length,  items: anime  },
        };

        // If type filter specified, return only that section
        if (type && response[type]) {
            return res.json({ category, ...response[type] });
        }

        return res.json(response);
    } catch (err) {
        console.error("[Category] getByCategory error:", err);
        return res.status(500).json({ error: "Failed to get media by category" });
    }
}

module.exports = { getCategories, getByCategory };
