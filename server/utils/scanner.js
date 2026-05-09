"use strict";

const fs = require("fs");
const path = require("path");
const { isVideoFile, generateFileId, formatFileSize } = require("./fileHelpers");

const MAX_DEPTH = 5;

// Scans a single folder recursively (up to MAX_DEPTH) and returns video file objects
async function scanFolder(folderPath, currentDepth = 0) {
    if (currentDepth > MAX_DEPTH) return [];

    let entries;
    try {
        entries = await fs.promises.readdir(folderPath, { withFileTypes: true });
    } catch (err) {
        console.warn(`[Scanner] Cannot read folder: ${folderPath} — ${err.message}`);
        return [];
    }

    const results = [];

    for (const entry of entries) {
        // Skip hidden files and folders
        if (entry.name.startsWith(".")) continue;

        const fullPath = path.join(folderPath, entry.name);

        if (entry.isDirectory()) {
            // Recurse into subdirectory
            const subFiles = await scanFolder(fullPath, currentDepth + 1);
            results.push(...subFiles);
        } else if (entry.isFile() && isVideoFile(entry.name)) {
            // Build file object for this video
            let stat;
            try {
                stat = await fs.promises.stat(fullPath);
            } catch (err) {
                console.warn(`[Scanner] Cannot stat file: ${fullPath} — ${err.message}`);
                continue;
            }

            const ext = path.extname(entry.name).toLowerCase();
            const nameWithoutExt = path.basename(entry.name, ext);
            const id = generateFileId(fullPath);

            results.push({
                id,
                name: nameWithoutExt,
                size: formatFileSize(stat.size),
                streamUrl: `/stream/video/${id}`,
            });
        }
    }

    return results;
}

module.exports = { scanFolder };
