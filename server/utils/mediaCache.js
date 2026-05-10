"use strict";

const { scanFolder } = require("./scanner");

// TTL in ms — default 5 minutes, override with CACHE_TTL_MS env var
const TTL = parseInt(process.env.CACHE_TTL_MS || "300000", 10);

// Map<folderId, { files: [], label: string, path: string, scannedAt: number }>
const cache = new Map();

// Returns cached files for a folder, rescanning if missing or expired
async function getOrScan(folder) {
    const entry = cache.get(folder.id);
    const now = Date.now();

    if (entry && now - entry.scannedAt < TTL) {
        return entry.files;
    }

    const files = await scanFolder(folder.path);
    cache.set(folder.id, { files, label: folder.label, path: folder.path, scannedAt: now });
    console.log(`[Cache] Scanned folder "${folder.label}" — ${files.length} files`);
    return files;
}

// Drops a single folder's cache entry (call after add/remove/update)
function invalidateFolder(folderId) {
    if (cache.has(folderId)) {
        cache.delete(folderId);
        console.log(`[Cache] Invalidated folder ${folderId}`);
    }
}

// Drops all cache entries (call after bulk changes)
function invalidateAll() {
    cache.clear();
    console.log("[Cache] Full cache invalidated");
}

// Returns a flat array of all cached media across all folders,
// rescanning any that are missing or expired
async function getAllCached(folders) {
    const allMedia = [];
    const folderStats = [];

    for (const folder of folders) {
        const files = await getOrScan(folder);
        const withMeta = files.map((f) => ({ ...f, folderLabel: folder.label, folderId: folder.id }));
        allMedia.push(...withMeta);
        folderStats.push({ id: folder.id, path: folder.path, label: folder.label, count: files.length });
    }

    return { allMedia, folderStats };
}

// Finds a single file by id across all folders using the cache
async function findById(folders, id) {
    for (const folder of folders) {
        const files = await getOrScan(folder);
        const found = files.find((f) => f.id === id);
        if (found) return { ...found, folderLabel: folder.label, folderId: folder.id };
    }
    return null;
}

module.exports = { getAllCached, findById, invalidateFolder, invalidateAll };
