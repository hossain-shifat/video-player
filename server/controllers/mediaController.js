"use strict";

const fs = require("fs");
const path = require("path");
const { readFolders } = require("./libraryController");
const { getAllCached, findById } = require("../utils/mediaCache");
const { SUBTITLE_EXTENSIONS, decodeFileId } = require("../utils/fileHelpers");

// Returns all media from the cache, rescanning stale/missing folders automatically
async function getAllMedia(req, res) {
    try {
        const folders = await readFolders();
        const { allMedia, folderStats } = await getAllCached(folders);
        return res.json({ total: allMedia.length, media: allMedia, folders: folderStats });
    } catch (err) {
        console.error("[Media] getAllMedia error:", err);
        return res.status(500).json({ error: "Failed to get media" });
    }
}

// Finds a single media file by ID using the cache
async function getMediaById(req, res) {
    try {
        const folders = await readFolders();
        const file = await findById(folders, req.params.id);
        if (!file) return res.status(404).json({ error: "Media not found" });
        return res.json({ file });
    } catch (err) {
        console.error("[Media] getMediaById error:", err);
        return res.status(500).json({ error: "Failed to get media" });
    }
}

// Searches and filters cached media by name, folder, and sort order
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

        const sortMap = {
            name: (a, b) => a.name.localeCompare(b.name),
        };
        results.sort(sortMap[sort] || sortMap.name);

        return res.json({ total: results.length, results });
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

module.exports = { getAllMedia, getMediaById, searchMedia, getMediaSubtitles };
