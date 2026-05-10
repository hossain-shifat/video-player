"use strict";

const fs   = require("fs");
const path = require("path");
const { readFolders }   = require("./libraryController");
const { getAllCached, findById } = require("../utils/mediaCache");
const { SUBTITLE_EXTENSIONS, decodeFileId } = require("../utils/fileHelpers");
const { getMetadata }   = require("../utils/metadataStore");
const { groupMedia }    = require("../utils/grouper");

// Attaches TMDB metadata to a single file object
async function enrich(file) {
    const metadata = await getMetadata(file);
    return { ...file, metadata };
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
        const { type, q, title, season } = req.query;

        const folders = await readFolders();
        const { allMedia, folderStats } = await getAllCached(folders);
        const grouped = await groupMedia(allMedia);

        // ── Search filter ─────────────────────────────────────────────────────
        if (q) {
            const term = q.toLowerCase();
            grouped.movies = grouped.movies.filter(f =>
                f.name.toLowerCase().includes(term) ||
                f.metadata?.title?.toLowerCase().includes(term)
            );
            grouped.series = grouped.series.filter(s =>
                s.title.toLowerCase().includes(term)
            );
            grouped.anime = grouped.anime.filter(a =>
                a.title.toLowerCase().includes(term)
            );
        }

        // ── Series/anime title + season filter ────────────────────────────────
        if (title) {
            const titleLower = title.toLowerCase();
            const filterByTitle = (arr) =>
                arr.filter(s => s.title.toLowerCase().includes(titleLower));
            grouped.series = filterByTitle(grouped.series);
            grouped.anime  = filterByTitle(grouped.anime);

            // Narrow to one season if requested
            if (season !== undefined) {
                const seasonNum = parseInt(season, 10);
                const narrowSeasons = (arr) => arr.map(s => ({
                    ...s,
                    seasons: Object.fromEntries(
                        Object.entries(s.seasons).filter(([n]) => parseInt(n) === seasonNum)
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
        const { q, folder: folderId } = req.query;

        const folders = await readFolders();
        const { allMedia } = await getAllCached(folders);
        let results = allMedia;

        if (q) {
            const term = q.toLowerCase();
            results = results.filter(f => f.name.toLowerCase().includes(term));
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
