'use strict';

const { readFolders }   = require('./libraryController');
const { getAllCached, findById } = require('../utils/mediaCache');
const { getMetadata, getCached, invalidate, invalidateAll } = require('../utils/metadataStore');
const { parseFilename } = require('../utils/nameParser');

// GET /api/metadata/:id — returns metadata for one file, fetching TMDB if needed
async function getOne(req, res) {
  try {
    const folders = await readFolders();
    const file    = await findById(folders, req.params.id);
    if (!file) return res.status(404).json({ error: 'Media not found' });

    const metadata = await getMetadata(file);
    return res.json({ id: file.id, name: file.name, metadata });
  } catch (err) {
    console.error('[Metadata] getOne error:', err);
    return res.status(500).json({ error: 'Failed to get metadata' });
  }
}

// POST /api/metadata/refresh/:id — clears cache for one file and re-fetches TMDB
async function refreshOne(req, res) {
  try {
    const folders = await readFolders();
    const file    = await findById(folders, req.params.id);
    if (!file) return res.status(404).json({ error: 'Media not found' });

    invalidate(file.id);
    const metadata = await getMetadata(file);
    return res.json({ id: file.id, name: file.name, metadata });
  } catch (err) {
    console.error('[Metadata] refreshOne error:', err);
    return res.status(500).json({ error: 'Failed to refresh metadata' });
  }
}

// POST /api/metadata/refresh-all — clears entire cache and re-fetches all (slow, use sparingly)
async function refreshAll(req, res) {
  try {
    invalidateAll();
    return res.json({ message: 'Metadata cache cleared. Entries will be re-fetched on next request.' });
  } catch (err) {
    console.error('[Metadata] refreshAll error:', err);
    return res.status(500).json({ error: 'Failed to clear metadata cache' });
  }
}

// GET /api/metadata/parse?filename=xxx — debug helper: shows how a filename would be parsed
async function parseDebug(req, res) {
  const { filename } = req.query;
  if (!filename) return res.status(400).json({ error: 'filename query param required' });
  return res.json(parseFilename(filename));
}

// GET /api/media/enriched — returns full media list with metadata attached (may be slow first time)
async function getAllEnriched(req, res) {
  try {
    const folders = await readFolders();
    const { allMedia } = await getAllCached(folders);

    // Enrich each file — cache hits are instant, misses call TMDB
    const enriched = await Promise.all(
      allMedia.map(async (file) => {
        const metadata = await getMetadata(file);
        return { ...file, metadata };
      })
    );

    return res.json({ total: enriched.length, media: enriched });
  } catch (err) {
    console.error('[Metadata] getAllEnriched error:', err);
    return res.status(500).json({ error: 'Failed to get enriched media' });
  }
}

module.exports = { getOne, refreshOne, refreshAll, parseDebug, getAllEnriched };
