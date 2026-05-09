'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FOLDERS_FILE = path.join(__dirname, '..', 'data', 'folders.json');

// Reads folders.json and returns the parsed array
async function readFolders() {
  try {
    const raw = await fs.promises.readFile(FOLDERS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// Writes the given array to folders.json
async function writeFolders(folders) {
  await fs.promises.writeFile(FOLDERS_FILE, JSON.stringify(folders, null, 2), 'utf-8');
}

// GET /api/library — returns all saved folders
async function getFolders(req, res) {
  try {
    const folders = await readFolders();
    return res.json({ folders });
  } catch (err) {
    console.error('[Library] getFolders error:', err);
    return res.status(500).json({ error: 'Failed to read folders' });
  }
}

// POST /api/library — adds a new folder by path
async function addFolder(req, res) {
  try {
    const { path: folderPath, label } = req.body;

    if (!folderPath) {
      return res.status(400).json({ error: 'path is required' });
    }

    const resolvedPath = path.resolve(folderPath);

    if (!fs.existsSync(resolvedPath)) {
      return res.status(400).json({ error: `Path does not exist on disk: ${resolvedPath}` });
    }

    const folders = await readFolders();

    const duplicate = folders.find(
      (f) => path.resolve(f.path) === resolvedPath
    );
    if (duplicate) {
      return res.status(400).json({ error: 'Folder is already in the library' });
    }

    const newFolder = {
      id: crypto.randomUUID(),
      path: resolvedPath,
      label: label || path.basename(resolvedPath),
      addedAt: new Date().toISOString(),
    };

    folders.push(newFolder);
    await writeFolders(folders);

    return res.status(201).json({ folder: newFolder });
  } catch (err) {
    console.error('[Library] addFolder error:', err);
    return res.status(500).json({ error: 'Failed to add folder' });
  }
}

// DELETE /api/library/:id — removes a folder by id
async function removeFolder(req, res) {
  try {
    const { id } = req.params;
    const folders = await readFolders();
    const index = folders.findIndex((f) => f.id === id);

    if (index === -1) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    folders.splice(index, 1);
    await writeFolders(folders);

    return res.json({ message: 'Folder removed', id });
  } catch (err) {
    console.error('[Library] removeFolder error:', err);
    return res.status(500).json({ error: 'Failed to remove folder' });
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
      return res.status(404).json({ error: 'Folder not found' });
    }

    if (newPath !== undefined) {
      const resolvedPath = path.resolve(newPath);
      if (!fs.existsSync(resolvedPath)) {
        return res.status(400).json({ error: `Path does not exist on disk: ${resolvedPath}` });
      }
      folder.path = resolvedPath;
    }

    if (label !== undefined) {
      folder.label = label;
    }

    await writeFolders(folders);

    return res.json({ folder });
  } catch (err) {
    console.error('[Library] updateFolder error:', err);
    return res.status(500).json({ error: 'Failed to update folder' });
  }
}

module.exports = { getFolders, addFolder, removeFolder, updateFolder, readFolders };
