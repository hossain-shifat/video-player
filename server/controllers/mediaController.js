"use strict";

const fs   = require("fs");
const path = require("path");
const { readFolders }   = require("./libraryController");
const { getAllCached, findById } = require("../utils/mediaCache");
const { SUBTITLE_EXTENSIONS, decodeFileId } = require("../utils/fileHelpers");
const { getMetadata }   = require("../utils/metadataStore");
const { groupMedia }    = require("../utils/grouper");

// Attaches TMDB metadata and category (genres) to a single file object
async function enrich(file) {
    const metadata = await getMetadata(file);
    return {
        ...file,
        metadata,
        category: metadata?.genres || [],   // genres array for direct use by frontend
    };
}

/**
 * GET /api/media
 * Returns everything in one response, separated by type.
 *
 * Query params:
 *   type=movies|series|anime     — filter to one category only
 *   q=<string>                   — search by title (applies to movies + series name)
 *   title=<string>               — exact series/anime title filter (for season query)
 *   season=<number>              — return only that season's episodes (requires title)
 */
async function getAllMedia(req, res) {
    try {
        // Normalize query params — coerce arrays to single string, guard toLowerCase
        const q        = String(Array.isArray(req.query.q)        ? req.query.q[0]        : req.query.q        ?? "").trim().toLowerCase();
        const title    = String(Array.isArray(req.query.title)    ? req.query.title[0]    : req.query.title    ?? "").trim().toLowerCase();
        const type     = String(Array.isArray(req.query.type)     ? req.query.type[0]     : req.query.type     ?? "").trim().toLowerCase();
        const category = String(Array.isArray(req.query.category) ? req.query.category[0] : req.query.category ?? "").trim().toLowerCase();
        const rawSeason = Array.isArray(req.query.season) ? req.query.season[0] : req.query.season;
        const season = rawSeason !== undefined ? parseInt(rawSeason, 10) : NaN;
        const hasSeason = !Number.isNaN(season);

        const folders = await readFolders();
        const { allMedia, folderStats } = await getAllCached(folders);
        const grouped = await groupMedia(allMedia);

        // ── Category (genre) filter ───────────────────────────────────────────
        if (category) {
            const matchesCategory = (genres) =>
                (genres || []).some((g) => g.toLowerCase() === category);

            grouped.movies = grouped.movies.filter((f) =>
                matchesCategory(f.metadata?.genres)
            );
            grouped.series = grouped.series.filter((s) =>
                matchesCategory(s.metadata?.genres)
            );
            grouped.anime = grouped.anime.filter((a) =>
                matchesCategory(a.metadata?.genres)
            );
        }

        // ── Search filter ─────────────────────────────────────────────────────
        if (q) {
            grouped.movies = grouped.movies.filter(f =>
                f.name.toLowerCase().includes(q) ||
                f.metadata?.title?.toLowerCase().includes(q)
            );
            grouped.series = grouped.series.filter(s =>
                s.title.toLowerCase().includes(q)
            );
            grouped.anime = grouped.anime.filter(a =>
                a.title.toLowerCase().includes(q)
            );
        }

        // ── Series/anime title + season filter ────────────────────────────────
        if (title) {
            const filterByTitle = (arr) =>
                arr.filter(s => s.title.toLowerCase().includes(title));
            grouped.series = filterByTitle(grouped.series);
            grouped.anime  = filterByTitle(grouped.anime);

            // Narrow to one season if requested
            if (hasSeason) {
                const narrowSeasons = (arr) => arr.map(s => ({
                    ...s,
                    seasons: Object.fromEntries(
                        Object.entries(s.seasons).filter(([n]) => parseInt(n) === season)
                    ),
                }));
                grouped.series = narrowSeasons(grouped.series);
                grouped.anime  = narrowSeasons(grouped.anime);
            }
        }

        // ── Build response ────────────────────────────────────────────────────
        const response = {
            folders: folderStats,
            movies:  { total: grouped.movies.length,  items: grouped.movies  },
            series:  { total: grouped.series.length,  items: grouped.series  },
            anime:   { total: grouped.anime.length,   items: grouped.anime   },
            unknown: { total: grouped.unknown.length, items: grouped.unknown },
        };

        // If type filter specified, return only that section
        if (type && response[type]) {
            return res.json(response[type]);
        }

        return res.json(response);
    } catch (err) {
        console.error("[Media] getAllMedia error:", err);
        return res.status(500).json({ error: "Failed to get media" });
    }
}

// GET /api/media/:id — single file with metadata
async function getMediaById(req, res) {
    try {
        const folders = await readFolders();
        const file = await findById(folders, req.params.id);
        if (!file) return res.status(404).json({ error: "Media not found" });
        return res.json({ file: await enrich(file) });
    } catch (err) {
        console.error("[Media] getMediaById error:", err);
        return res.status(500).json({ error: "Failed to get media" });
    }
}

// GET /api/media/search?q=&type=
async function searchMedia(req, res) {
    try {
        const q        = String(Array.isArray(req.query.q)      ? req.query.q[0]      : req.query.q      ?? "").trim().toLowerCase();
        const folderId = String(Array.isArray(req.query.folder) ? req.query.folder[0] : req.query.folder ?? "").trim();

        const folders = await readFolders();
        const { allMedia } = await getAllCached(folders);
        let results = allMedia;

        if (q) {
            results = results.filter(f => f.name.toLowerCase().includes(q));
        }
        if (folderId) {
            results = results.filter(f => f.folderId === folderId);
        }

        results.sort((a, b) => a.name.localeCompare(b.name));
        const enriched = await Promise.all(results.map(enrich));
        return res.json({ total: enriched.length, results: enriched });
    } catch (err) {
        console.error("[Media] searchMedia error:", err);
        return res.status(500).json({ error: "Search failed" });
    }
}

// GET /api/media/:id/subtitles
async function getMediaSubtitles(req, res) {
    try {
        const { id } = req.params;
        let filePath;
        try {
            filePath = decodeFileId(id);
        } catch {
            return res.status(400).json({ error: "Invalid media ID" });
        }

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: "Media file not found on disk" });
        }

        const dir      = path.dirname(filePath);
        const ext      = path.extname(filePath);
        const baseName = path.basename(filePath, ext);
        const subtitles = [];

        for (const subExt of SUBTITLE_EXTENSIONS) {
            const subPath = path.join(dir, baseName + subExt);
            if (fs.existsSync(subPath)) {
                const encodedPath = Buffer.from(subPath).toString("base64url");
                subtitles.push({
                    filename: baseName + subExt,
                    ext: subExt,
                    url: "/stream/subtitle/" + encodedPath,
                });
            }
        }

        return res.json({ subtitles });
    } catch (err) {
        console.error("[Media] getMediaSubtitles error:", err);
        return res.status(500).json({ error: "Failed to get subtitles" });
    }
}

module.exports = { getAllMedia, getMediaById, searchMedia, getMediaSubtitles };
