"use strict";

const { readFolders } = require("./libraryController");
const { getAllCached } = require("../utils/mediaCache");
const { getMetadata } = require("../utils/metadataStore");
const { groupMedia } = require("../utils/grouper");

const CATEGORY_META = {
    Action: {
        title: "Action Movies & TV Shows",
        subtitle: "High-octane thrills, explosive sequences, and edge-of-your-seat adventure — the best action titles in your library.",
    },
    Adventure: {
        title: "Adventure Movies & TV Shows",
        subtitle: "Epic journeys, daring heroes, and worlds waiting to be explored. Your next great adventure starts here.",
    },
    Animation: {
        title: "Animation Movies & TV Shows",
        subtitle: "From hand-drawn classics to stunning CGI — animated films and series for every age.",
    },
    Anime: {
        title: "Anime",
        subtitle: "The finest Japanese animation — from shonen battles to slice-of-life, fantasy epics, and everything in between.",
    },
    Comedy: {
        title: "Comedy Movies & TV Shows",
        subtitle: "Laugh out loud with the funniest films and series in your collection.",
    },
    Crime: {
        title: "Crime & Mystery",
        subtitle: "Detectives, heists, and criminal masterminds. Gripping crime dramas and mysteries that keep you guessing.",
    },
    Documentary: {
        title: "Documentaries",
        subtitle: "Real stories, real people, real impact. Explore the world through the lens of documentary filmmaking.",
    },
    Drama: {
        title: "Drama Movies & TV Shows",
        subtitle: "Powerful performances and emotionally resonant stories that stay with you long after the credits roll.",
    },
    Fantasy: {
        title: "Fantasy Movies & TV Shows",
        subtitle: "Magic, mythical creatures, and worlds beyond imagination. Escape into extraordinary realms.",
    },
    Horror: {
        title: "Horror Movies & TV Shows",
        subtitle: "Things that go bump in the night. The scariest horror films and series in your library — if you dare.",
    },
    Music: {
        title: "Music & Musicals",
        subtitle: "The power of music on screen — from concert films and biopics to classic Broadway-style musicals.",
    },
    Romance: {
        title: "Romance Movies & TV Shows",
        subtitle: "Love stories that make your heart race. Romantic comedies, dramatic love affairs, and everything in between.",
    },
    "Sci-Fi": {
        title: "Science Fiction Movies & TV Shows",
        subtitle: "Space exploration, artificial intelligence, time travel — the greatest sci-fi in your collection.",
    },
    "Science Fiction": {
        title: "Science Fiction Movies & TV Shows",
        subtitle: "Space exploration, artificial intelligence, time travel — the greatest sci-fi in your collection.",
    },
    Thriller: {
        title: "Thrillers & Suspense",
        subtitle: "Heart-pounding tension and nail-biting suspense. The best psychological and action thrillers in your library.",
    },
    Western: {
        title: "Westerns",
        subtitle: "Cowboys, outlaws, and the wild frontier. Classic and modern westerns from your collection.",
    },
    War: {
        title: "War Movies & TV Shows",
        subtitle: "Heroism, sacrifice, and the human cost of conflict. Powerful war films and series.",
    },
    History: {
        title: "Historical Movies & TV Shows",
        subtitle: "Epic tales from history's most defining moments — battles, empires, revolutions, and the people who shaped the world.",
    },
    Family: {
        title: "Family Movies & TV Shows",
        subtitle: "Entertainment the whole family can enjoy together — heartwarming stories and fun adventures for all ages.",
    },
    Mystery: {
        title: "Mystery Movies & TV Shows",
        subtitle: "Whodunits, unsolved cases, and detective stories. Can you figure it out before the reveal?",
    },
    Biography: {
        title: "Biographies & True Stories",
        subtitle: "The extraordinary real lives of remarkable people — inspiring biopics and true-story dramas.",
    },
    Sport: {
        title: "Sports Movies & TV Shows",
        subtitle: "The thrill of victory, the agony of defeat. The best sports films and series in your library.",
    },
};

// Generates a fallback title/subtitle for genres not in CATEGORY_META
function getCategoryMeta(genreName) {
    if (CATEGORY_META[genreName]) return CATEGORY_META[genreName];
    return {
        title: `${genreName} Movies & TV Shows`,
        subtitle: `All ${genreName} movies and TV shows from your library.`,
    };
}

// ─── Shared index builder ─────────────────────────────────────────────────────
// Builds enriched items with _genres and _mediaType for both endpoints.
async function buildCategoryIndex(folders) {
    const { allMedia } = await getAllCached(folders);
    const grouped = await groupMedia(allMedia);
    const items = [];

    for (const movie of grouped.movies) {
        const metadata = await getMetadata(movie);
        items.push({
            ...movie,
            metadata,
            category: metadata?.genres || [], // ← extra key the frontend can use
            _genres: metadata?.genres || [],
            _mediaType: "movie",
        });
    }

    for (const series of grouped.series) {
        items.push({
            ...series,
            category: series.metadata?.genres || [],
            _genres: series.metadata?.genres || [],
            _mediaType: "series",
        });
    }

    for (const anime of grouped.anime) {
        items.push({
            ...anime,
            category: anime.metadata?.genres || [],
            _genres: anime.metadata?.genres || [],
            _mediaType: "anime",
        });
    }

    return { items, grouped };
}

async function getCategories(req, res) {
    try {
        const folders = await readFolders();
        const { items } = await buildCategoryIndex(folders);

        const map = new Map();

        for (const item of items) {
            for (const genre of item._genres) {
                if (!map.has(genre)) {
                    const meta = getCategoryMeta(genre);
                    map.set(genre, {
                        name: genre,
                        title: meta.title,
                        subtitle: meta.subtitle,
                        total: 0,
                        movies: 0,
                        series: 0,
                        anime: 0,
                    });
                }
                const entry = map.get(genre);
                entry.total++;
                entry[item._mediaType === "movie" ? "movies" : item._mediaType === "series" ? "series" : "anime"]++;
            }
        }

        const categories = [...map.values()].sort((a, b) => b.total - a.total);
        return res.json({ total: categories.length, categories });
    } catch (err) {
        console.error("[Category] getCategories error:", err);
        return res.status(500).json({ error: "Failed to get categories" });
    }
}

// ─── GET /api/categories/:name ────────────────────────────────────────────────
// Query: ?type=movies|series|anime
async function getByCategory(req, res) {
    try {
        const category = String(req.params.name || "").trim();
        const type = String(Array.isArray(req.query.type) ? req.query.type[0] : (req.query.type ?? ""))
            .trim()
            .toLowerCase();

        if (!category) return res.status(400).json({ error: "Category name is required" });

        const folders = await readFolders();
        const { items } = await buildCategoryIndex(folders);
        const categoryLower = category.toLowerCase();

        const matches = items.filter((item) => item._genres.some((g) => g.toLowerCase() === categoryLower));

        // Strip internal fields before sending to client
        const clean = (arr) => arr.map(({ _genres, _mediaType, ...rest }) => rest);

        const movies = clean(matches.filter((i) => i._mediaType === "movie"));
        const series = clean(matches.filter((i) => i._mediaType === "series"));
        const anime = clean(matches.filter((i) => i._mediaType === "anime"));

        const { title, subtitle } = getCategoryMeta(category);

        const response = {
            category,
            title,
            subtitle,
            movies: { total: movies.length, items: movies },
            series: { total: series.length, items: series },
            anime: { total: anime.length, items: anime },
        };

        if (type && response[type]) {
            return res.json({ category, title, subtitle, ...response[type] });
        }

        return res.json(response);
    } catch (err) {
        console.error("[Category] getByCategory error:", err);
        return res.status(500).json({ error: "Failed to get media by category" });
    }
}

module.exports = { getCategories, getByCategory };
