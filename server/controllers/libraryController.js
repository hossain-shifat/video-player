"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const chokidar = require("chokidar");

const FOLDERS_FILE = path.join(__dirname, "..", "data", "folders.json");
const { invalidateFolder, invalidateAll, fileIndex, getAllCached, getCachedStats } = require("../utils/mediaCache");
const { reconcile, getMetadata } = require("../utils/metadataStore");
const { isVideoFile } = require("../utils/fileHelpers");

// In-memory folders cache — eliminates disk I/O on every API call.
// Populated on first read, updated atomically on every write.
let _cachedFolders = null;

// ─── Live folder watching (chokidar) ───────────────────────────────────────────
// Watches every library folder for add/remove so new movies/series/anime get
// picked up automatically — no server restart needed to load new media.
const DEBOUNCE_MS = parseInt(process.env.WATCH_DEBOUNCE_MS || "1500", 10);
// Set WATCH_USE_POLLING=true in .env for network/SMB/NFS mounts (CasaOS NAS
// shares often don't fire native inotify events) — costs more CPU but works.
const USE_POLLING = process.env.WATCH_USE_POLLING === "true";

const _watchers = new Map(); // folderId -> chokidar watcher instance
const _debounceTimers = new Map(); // folderId -> timeout handle

// Debounced so a big folder copy (50 files landing at once) triggers ONE
// rescan instead of 50.
function _scheduleRescan(folder) {
    if (_debounceTimers.has(folder.id)) clearTimeout(_debounceTimers.get(folder.id));

    _debounceTimers.set(
        folder.id,
        setTimeout(async () => {
            _debounceTimers.delete(folder.id);
            invalidateFolder(folder.id);
            console.log(`[Watcher] Change in "${folder.label}" — cache invalidated`);

            try {
                // Force the rescan NOW and warm TMDB metadata so posters are
                // ready before the user even opens the app.
                const { allMedia } = await getAllCached([folder]);
                await Promise.all(allMedia.map((f) => getMetadata(f).catch(() => null)));
                console.log(`[Watcher] Rescanned "${folder.label}" — ${allMedia.length} file(s), metadata warmed`);
            } catch (err) {
                console.error(`[Watcher] Rescan failed for "${folder.label}":`, err.message);
            }
        }, DEBOUNCE_MS),
    );
}

// Starts watching one folder. Safe to call again — restarts the watch.
function _watchFolder(folder) {
    _stopWatching(folder.id);

    if (!fs.existsSync(folder.path)) {
        console.warn(`[Watcher] Path missing, skipping: ${folder.path}`);
        return;
    }

    const watcher = chokidar.watch(folder.path, {
        persistent: true,
        ignoreInitial: true, // startup scan already handles existing files
        depth: 5, // matches scanner.js MAX_DEPTH
        usePolling: USE_POLLING,
        interval: USE_POLLING ? 2000 : undefined,
        awaitWriteFinish: {
            stabilityThreshold: 2000, // wait out large video copies before treating as "added"
            pollInterval: 200,
        },
    });

    const onFsEvent = (eventPath) => {
        if (!isVideoFile(eventPath)) return;
        _scheduleRescan(folder);
    };

    watcher.on("add", onFsEvent);
    watcher.on("unlink", onFsEvent);
    watcher.on("addDir", () => _scheduleRescan(folder));
    watcher.on("unlinkDir", () => _scheduleRescan(folder));
    watcher.on("error", (err) => console.error(`[Watcher] Error on "${folder.label}":`, err.message));

    _watchers.set(folder.id, watcher);
    console.log(`[Watcher] Watching "${folder.label}" → ${folder.path}`);
}

function _stopWatching(folderId) {
    const w = _watchers.get(folderId);
    if (w) {
        w.close();
        _watchers.delete(folderId);
    }
    if (_debounceTimers.has(folderId)) {
        clearTimeout(_debounceTimers.get(folderId));
        _debounceTimers.delete(folderId);
    }
}

// Call once at server boot with all library folders.
function watchAllFolders(folders) {
    for (const folder of folders) _watchFolder(folder);
}

// Call on graceful shutdown.
function stopAllWatchers() {
    for (const id of [..._watchers.keys()]) _stopWatching(id);
}

// Returns true only if resolvedPath exists and is a directory; false on any stat error
function isDirectory(resolvedPath) {
    try {
        return fs.lstatSync(resolvedPath).isDirectory();
    } catch {
        return false;
    }
}

// Reads folders.json and returns the parsed array.
// Uses in-memory cache — only reads disk on cold start or after server restart.
async function readFolders() {
    if (_cachedFolders !== null) return _cachedFolders;
    try {
        const raw = await fs.promises.readFile(FOLDERS_FILE, "utf-8");
        _cachedFolders = JSON.parse(raw);
        return _cachedFolders;
    } catch (err) {
        if (err && err.code === "ENOENT") {
            _cachedFolders = [];
            return _cachedFolders;
        }
        console.error("[Library] readFolders error:", err);
        throw err;
    }
}

// Serializes all write calls so only one temp-write/rename runs at a time
let writeQueue = Promise.resolve();

// Writes the given array to folders.json atomically (temp file → fsync → rename)
function writeFolders(folders) {
    writeQueue = writeQueue.catch(() => {}).then(() => _atomicWrite(folders));
    return writeQueue;
}

async function _atomicWrite(folders) {
    const tmp = `${FOLDERS_FILE}.tmp.${process.pid}.${Date.now()}`;
    const fd = await fs.promises.open(tmp, "w");
    try {
        await fd.writeFile(JSON.stringify(folders, null, 2), "utf-8");
        await fd.sync();
    } finally {
        await fd.close();
    }
    await fs.promises.rename(tmp, FOLDERS_FILE);
    // Update in-memory cache atomically after successful disk write
    _cachedFolders = folders;
}

// GET /api/library — returns all saved folders with media count per folder
async function getFolders(req, res) {
    try {
        const folders = await readFolders();
        // Attach media count to each folder using cached scan results only — no rescans
        const folderStats = getCachedStats(folders);
        const statMap = new Map(folderStats.map((s) => [s.id, s.count]));
        const foldersWithCount = folders.map((f) => ({
            ...f,
            count: statMap.get(f.id) ?? 0,
        }));
        return res.json({ folders: foldersWithCount });
    } catch (err) {
        console.error("[Library] getFolders error:", err);
        return res.status(500).json({ error: "Failed to read folders" });
    }
}

// POST /api/library — adds a new folder by path
async function addFolder(req, res) {
    try {
        const { path: folderPath, label } = req.body;

        if (!folderPath) {
            return res.status(400).json({ error: "path is required" });
        }

        const resolvedPath = path.resolve(folderPath);

        if (!isDirectory(resolvedPath)) {
            return res.status(400).json({ error: `Path is not a directory: ${resolvedPath}` });
        }

        const folders = await readFolders();

        const duplicate = folders.find((f) => path.resolve(f.path) === resolvedPath);
        if (duplicate) {
            return res.status(400).json({ error: "Folder is already in the library" });
        }

        const newFolder = {
            id: crypto.randomUUID(),
            path: resolvedPath,
            label: label || path.basename(resolvedPath),
            addedAt: new Date().toISOString(),
        };

        folders.push(newFolder);
        await writeFolders(folders);
        invalidateFolder(newFolder.id);

        // Live-watch this folder immediately — no restart needed to pick up
        // files added inside it from now on.
        _watchFolder(newFolder);

        return res.status(201).json({ folder: newFolder });
    } catch (err) {
        console.error("[Library] addFolder error:", err);
        return res.status(500).json({ error: "Failed to add folder" });
    }
}

// DELETE /api/library/:id — removes a folder by id
async function removeFolder(req, res) {
    try {
        const { id } = req.params;
        const folders = await readFolders();
        const index = folders.findIndex((f) => f.id === id);

        if (index === -1) {
            return res.status(404).json({ error: "Folder not found" });
        }

        // Run reconcile BEFORE committing the deletion — if these fail, folder is not yet removed
        const remainingFolders = folders.filter((_, i) => i !== index);
        const { allMedia } = await getAllCached(remainingFolders);
        const activeIds = new Set(allMedia.map((f) => f.id));

        await reconcile(activeIds);

        folders.splice(index, 1);
        await writeFolders(folders);
        invalidateFolder(id);
        _stopWatching(id);

        return res.json({ message: "Folder removed", id });
    } catch (err) {
        console.error("[Library] removeFolder error:", err);
        return res.status(500).json({ error: "Failed to remove folder" });
    }
}

// PATCH /api/library/:id — updates label or path of a folder
async function updateFolder(req, res) {
    try {
        const { id } = req.params;
        const { label, path: newPath } = req.body;

        const folders = await readFolders();
        const folder = folders.find((f) => f.id === id);

        if (!folder) {
            return res.status(404).json({ error: "Folder not found" });
        }

        if (newPath !== undefined) {
            const resolvedPath = path.resolve(newPath);
            if (!isDirectory(resolvedPath)) {
                return res.status(400).json({ error: `Path is not a directory: ${resolvedPath}` });
            }
            const duplicate = folders.find((f) => f.id !== id && path.resolve(f.path) === resolvedPath);
            if (duplicate) {
                return res.status(400).json({ error: `Folder path already in use: ${resolvedPath}` });
            }
            folder.path = resolvedPath;
        }

        if (label !== undefined) {
            folder.label = label;
        }

        await writeFolders(folders);
        invalidateFolder(id);

        // Re-arm watcher — picks up new path if it changed, harmless no-op otherwise
        _watchFolder(folder);

        return res.json({ folder });
    } catch (err) {
        console.error("[Library] updateFolder error:", err);
        return res.status(500).json({ error: "Failed to update folder" });
    }
}

module.exports = {
    getFolders,
    addFolder,
    removeFolder,
    updateFolder,
    readFolders,
    writeFolders,
    watchAllFolders,
    stopAllWatchers,
};
