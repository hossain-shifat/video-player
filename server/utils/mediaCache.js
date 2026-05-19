"use strict";

const { scanFolder } = require("./scanner");

// TTL in ms — default 5 minutes, override with CACHE_TTL_MS env var
const TTL = parseInt(process.env.CACHE_TTL_MS || "300000", 10);

// Map<folderId, { files: [], label: string, path: string, scannedAt: number }>
const cache = new Map();

// ─── Fast file-by-ID index ────────────────────────────────────────────────────
// O(1) lookup for streamController.resolveFileById — avoids full folder re-scan.
const fileIndex = new Map(); // id → file object

function getFileById(id) {
    return fileIndex.get(id) || null;
}

function updateFromFiles(files) {
    for (const f of files) {
        fileIndex.set(f.id, { ...f });
    }
}

// Rebuild fileIndex from all current cache entries
function rebuildFileIndex() {
    fileIndex.clear();
    for (const entry of cache.values()) {
        for (const f of entry.files) {
            fileIndex.set(f.id, { ...f, folderLabel: entry.label, folderId: entry.folderId });
        }
    }
}

// Returns cached files for a folder, rescanning if missing or expired
async function getOrScan(folder) {
    const entry = cache.get(folder.id);
    const now = Date.now();

    if (entry && now - entry.scannedAt < TTL) {
        return entry.files;
    }

    const files = await scanFolder(folder.path);
    cache.set(folder.id, { files, label: folder.label, path: folder.path, folderId: folder.id, scannedAt: now });
    // Update file index with new scan results
    for (const f of files) {
        fileIndex.set(f.id, { ...f, folderLabel: folder.label, folderId: folder.id });
    }
    console.log(`[Cache] Scanned folder "${folder.label}" — ${files.length} files`);
    return files;
}

// Drops a single folder's cache entry (call after add/remove/update)
function invalidateFolder(folderId) {
    if (cache.has(folderId)) {
        // Remove file index entries for this folder
        const entry = cache.get(folderId);
        if (entry) {
            for (const f of entry.files) {
                fileIndex.delete(f.id);
            }
        }
        cache.delete(folderId);
        console.log(`[Cache] Invalidated folder ${folderId}`);
    }
}

// Drops all cache entries (call after bulk changes)
function invalidateAll() {
    cache.clear();
    fileIndex.clear();
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
    // Try fast index first
    const indexed = fileIndex.get(id);
    if (indexed) return indexed;

    // Fallback: scan folders
    for (const folder of folders) {
        const files = await getOrScan(folder);
        const found = files.find((f) => f.id === id);
        if (found) return { ...found, folderLabel: folder.label, folderId: folder.id };
    }
    return null;
}

module.exports = { getAllCached, findById, invalidateFolder, invalidateAll, getFileById, updateFromFiles };
