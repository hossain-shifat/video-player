"use strict";

const fs = require("fs");
const path = require("path");
const { readFolders } = require("./libraryController");
const { getAllCached, findById } = require("../utils/mediaCache");
const { SUBTITLE_EXTENSIONS, decodeFileId } = require("../utils/fileHelpers");
const { getMetadata } = require("../utils/metadataStore");
const { groupMedia } = require("../utils/grouper");

// Attaches TMDB metadata to a single file object
async function enrich(file) {
    const metadata = await getMetadata(file);
    return { ...file, metadata };
}

// Returns all media with TMDB metadata attached
async function getAllMedia(req, res) {
    try {
        const folders = await readFolders();
        const { allMedia, folderStats } = await getAllCached(folders);
        const media = await Promise.all(allMedia.map(enrich));
        return res.json({ total: media.length, media, folders: folderStats });
    } catch (err) {
        console.error("[Media] getAllMedia error:", err);
        return res.status(500).json({ error: "Failed to get media" });
    }
}

// Finds a single media file by ID with TMDB metadata attached
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

// Searches cached media by name/folder, returns results with TMDB metadata
async function searchMedia(req, res) {
    try {
        const { q, folder: folderId, sort = "name" } = req.query;

        const folders = await readFolders();
        const { allMedia } = await getAllCached(folders);
        let results = allMedia;

        if (q) {
            const term = q.toLowerCase();
            results = results.filter((f) => f.name.toLowerCase().includes(term));
        }

        if (folderId) {
            results = results.filter((f) => f.folderId === folderId);
        }

        results.sort((a, b) => a.name.localeCompare(b.name));

        const enriched = await Promise.all(results.map(enrich));
        return res.json({ total: enriched.length, results: enriched });
    } catch (err) {
        console.error("[Media] searchMedia error:", err);
        return res.status(500).json({ error: "Search failed" });
    }
}

// Finds subtitle files for a media item by decoding its ID back to an absolute path
async function getMediaSubtitles(req, res) {
    try {
        const { id } = req.params;

        // The file ID is base64url(absolutePath) — decode directly, no scan needed
        let filePath;
        try {
            filePath = decodeFileId(id);
        } catch {
            return res.status(400).json({ error: "Invalid media ID" });
        }

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: "Media file not found on disk" });
        }

        const dir = path.dirname(filePath);
        const ext = path.extname(filePath);
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

// Returns all media grouped into movies / series / anime with season+episode structure
async function getGrouped(req, res) {
    try {
        const folders = await readFolders();
        const { allMedia } = await getAllCached(folders);
        const grouped = await groupMedia(allMedia);
        return res.json({
            movies: { total: grouped.movies.length, items: grouped.movies },
            series: { total: grouped.series.length, items: grouped.series },
            anime: { total: grouped.anime.length, items: grouped.anime },
            unknown: { total: grouped.unknown.length, items: grouped.unknown },
        });
    } catch (err) {
        console.error("[Media] getGrouped error:", err);
        return res.status(500).json({ error: "Failed to group media" });
    }
}

module.exports = { getAllMedia, getMediaById, searchMedia, getMediaSubtitles, getGrouped };
