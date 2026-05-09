'use strict';

const fs = require('fs');
const path = require('path');
const { readFolders } = require('./libraryController');
const { scanFolder } = require('../utils/scanner');
const { generateFileId, isSubtitleFile, SUBTITLE_EXTENSIONS } = require('../utils/fileHelpers');

// Scans all saved folders and returns a flat list of all media files
async function getAllMedia(req, res) {
  try {
    const folders = await readFolders();
    const folderStats = [];
    let allMedia = [];

    for (const folder of folders) {
      const files = await scanFolder(folder.path);
      const withLabel = files.map((f) => ({ ...f, folderLabel: folder.label, folderId: folder.id }));
      allMedia = allMedia.concat(withLabel);
      folderStats.push({ id: folder.id, path: folder.path, label: folder.label, count: files.length });
    }

    return res.json({
      total: allMedia.length,
      media: allMedia,
      folders: folderStats,
    });
  } catch (err) {
    console.error('[Media] getAllMedia error:', err);
    return res.status(500).json({ error: 'Failed to scan media' });
  }
}

// Finds a single media file by its ID across all folders
async function getMediaById(req, res) {
  try {
    const { id } = req.params;
    const folders = await readFolders();

    for (const folder of folders) {
      const files = await scanFolder(folder.path);
      const found = files.find((f) => f.id === id);
      if (found) {
        return res.json({ file: { ...found, folderLabel: folder.label, folderId: folder.id } });
      }
    }

    return res.status(404).json({ error: 'Media not found' });
  } catch (err) {
    console.error('[Media] getMediaById error:', err);
    return res.status(500).json({ error: 'Failed to get media' });
  }
}

// Searches media by name, extension, folder, and sort order
async function searchMedia(req, res) {
  try {
    const { q, ext, folder: folderId, sort = 'name' } = req.query;

    const folders = await readFolders();
    let allMedia = [];

    for (const folder of folders) {
      const files = await scanFolder(folder.path);
      const withLabel = files.map((f) => ({ ...f, folderLabel: folder.label, folderId: folder.id }));
      allMedia = allMedia.concat(withLabel);
    }

    // Filter by search query
    if (q) {
      const term = q.toLowerCase();
      allMedia = allMedia.filter(
        (f) => f.name.toLowerCase().includes(term) || f.filename.toLowerCase().includes(term)
      );
    }

    // Filter by extension
    if (ext) {
      const extNorm = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
      allMedia = allMedia.filter((f) => f.ext === extNorm);
    }

    // Filter by folder id
    if (folderId) {
      allMedia = allMedia.filter((f) => f.folderId === folderId);
    }

    // Sort results
    const sortMap = {
      name: (a, b) => a.name.localeCompare(b.name),
      size: (a, b) => b.size - a.size,
      modified: (a, b) => new Date(b.modified) - new Date(a.modified),
    };
    const sortFn = sortMap[sort] || sortMap.name;
    allMedia.sort(sortFn);

    return res.json({ total: allMedia.length, results: allMedia });
  } catch (err) {
    console.error('[Media] searchMedia error:', err);
    return res.status(500).json({ error: 'Search failed' });
  }
}

// Finds subtitle files associated with a media file by its ID
async function getMediaSubtitles(req, res) {
  try {
    const { id } = req.params;
    const folders = await readFolders();

    let targetFile = null;
    for (const folder of folders) {
      const files = await scanFolder(folder.path);
      const found = files.find((f) => f.id === id);
      if (found) { targetFile = found; break; }
    }

    if (!targetFile) {
      return res.status(404).json({ error: 'Media not found' });
    }

    const dir = path.dirname(targetFile.path);
    const baseName = path.basename(targetFile.filename, targetFile.ext);
    const subtitles = [];

    for (const subExt of SUBTITLE_EXTENSIONS) {
      const subPath = path.join(dir, baseName + subExt);
      if (fs.existsSync(subPath)) {
        const encodedPath = Buffer.from(subPath).toString('base64url');
        subtitles.push({
          filename: baseName + subExt,
          ext: subExt,
          url: `/stream/subtitle/${encodedPath}`,
        });
      }
    }

    return res.json({ subtitles });
  } catch (err) {
    console.error('[Media] getMediaSubtitles error:', err);
    return res.status(500).json({ error: 'Failed to get subtitles' });
  }
}

module.exports = { getAllMedia, getMediaById, searchMedia, getMediaSubtitles };
