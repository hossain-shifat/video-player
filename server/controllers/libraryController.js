"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const FOLDERS_FILE = path.join(__dirname, "..", "data", "folders.json");
const { invalidateFolder, invalidateAll } = require("../utils/mediaCache");

// Returns true only if resolvedPath exists and is a directory; false on any stat error
function isDirectory(resolvedPath) {
    try {
        return fs.lstatSync(resolvedPath).isDirectory();
    } catch {
        return false;
    }
}

// Reads folders.json and returns the parsed array
async function readFolders() {
    try {
        const raw = await fs.promises.readFile(FOLDERS_FILE, "utf-8");
        return JSON.parse(raw);
    } catch (err) {
        if (err && err.code === "ENOENT") return [];
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
}

// GET /api/library — returns all saved folders
async function getFolders(req, res) {
    try {
        const folders = await readFolders();
        return res.json({ folders });
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

        folders.splice(index, 1);
        await writeFolders(folders);
        invalidateFolder(id);

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

        return res.json({ folder });
    } catch (err) {
        console.error("[Library] updateFolder error:", err);
        return res.status(500).json({ error: "Failed to update folder" });
    }
}

module.exports = { getFolders, addFolder, removeFolder, updateFolder, readFolders, writeFolders };
