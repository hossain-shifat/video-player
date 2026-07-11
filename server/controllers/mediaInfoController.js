"use strict";

const { readFolders } = require("./libraryController");
const { getAll, invalidateAll: invalidateAllMediaInfo } = require("../utils/mediaInfoStore");
const { getAllCached, getGroupedCached, invalidateAll: invalidateAllFolders } = require("../utils/mediaCache");

// ─── Name enrichment ────────────────────────────────────────────────────────
//
// mediaInfoStore.js only ever knows the raw scanned filename (it lives below
// grouper.js in the pipeline, before any TMDB matching happens). This builds
// a lookup so the API response can swap that raw filename for the real TMDB
// title, and — for series/anime — attach the episode's own id, its parent
// series id/title, and its season/episode number.
//
// Reuses grouper.js's EXISTING output via mediaCache.getGroupedCached(),
// which already wraps groupMedia() with its own cache (only recomputes when
// the underlying file list actually changes) — no grouping/TMDB logic is
// duplicated here, and grouper.js itself is never touched.
async function buildNameIndex(folders) {
    const { allMedia } = await getAllCached(folders);
    const grouped = await getGroupedCached(allMedia);

    // fileId -> { name, seriesId?, seriesTitle?, season?, episode?, episodeTitle? }
    const index = {};

    for (const movie of grouped.movies) {
        const title = movie.metadata?.title || movie.parsed?.title || movie.name;
        const year = movie.metadata?.year || movie.parsed?.year || null;
        index[movie.id] = { name: year ? `${title} (${year})` : title };
    }

    function indexShowGroup(group) {
        const seriesTitle = group.metadata?.title || group.title;
        const seasons = group.seasons || {};
        for (const seasonKey of Object.keys(seasons)) {
            const season = seasons[seasonKey];
            for (const ep of season.episodes || []) {
                const seasonNum = season.seasonNumber;
                const epNum = ep.episode;
                const epTitle = ep.title || null; // attached by grouper.js when TMDB season data matched this episode
                const seasonLabel = "S" + String(seasonNum).padStart(2, "0");
                const epLabel = epNum != null ? "E" + String(epNum).padStart(2, "0") : "";
                const name = seriesTitle + " - " + seasonLabel + epLabel + (epTitle ? " - " + epTitle : "");

                index[ep.id] = {
                    name: name,
                    seriesId: group.id,
                    seriesTitle: seriesTitle,
                    season: seasonNum,
                    episode: epNum,
                    episodeTitle: epTitle,
                };
            }
        }
    }

    for (const series of grouped.series) indexShowGroup(series);
    for (const anime of grouped.anime) indexShowGroup(anime);

    return index;
}

// GET /api/mediainfo — dumps the entire mediaInfo store as { id: info, ... }.
// Frontend (DashMedia) fetches this ONCE and merges into rows locally instead
// of firing one request per row.
//
// Every entry's "name" is now the real TMDB-resolved title when available
// (movie title + year, or "Series Title - S01E07 - Episode Name" for
// episodes) instead of the raw scanned filename. The original raw filename
// is kept under "rawName" for reference. Series/anime entries also get
// seriesId, seriesTitle, season, episode, and episodeTitle attached.
//
// Files ffprobe has already reached but TMDB hasn't matched yet (still
// mid-background-fetch, or a genuine no-match) fall back to the raw filename
// exactly as before — nothing regresses for those.
async function getAllMediaInfo(req, res) {
    try {
        const folders = await readFolders();
        const nameIndex = await buildNameIndex(folders);
        const rawStore = getAll();

        const mediaInfo = {};
        for (const id of Object.keys(rawStore)) {
            const entry = rawStore[id];
            const match = nameIndex[id];

            if (match) {
                mediaInfo[id] = Object.assign({}, entry, {
                    name: match.name,
                    rawName: entry.name,
                    seriesId: match.seriesId || null,
                    seriesTitle: match.seriesTitle || null,
                    season: match.season != null ? match.season : null,
                    episode: match.episode != null ? match.episode : null,
                    episodeTitle: match.episodeTitle || null,
                });
            } else {
                mediaInfo[id] = entry;
            }
        }

        return res.json({ total: Object.keys(mediaInfo).length, mediaInfo });
    } catch (err) {
        console.error("[MediaInfo] getAllMediaInfo error:", err);
        return res.status(500).json({ error: "Failed to get media info" });
    }
}

// GET /api/mediainfo/added-dates — bulk map of { fileId: addedAt(ISO) }.
// Reads DIRECTLY from mediaCache.getAllCached(), the same flat, PRE-grouping
// file list scanner.js produces — every movie AND every individual series/
// anime episode has its own real addedAt here (fs.stat birthtime).
async function getAddedDates(req, res) {
    try {
        const folders = await readFolders();
        const { allMedia } = await getAllCached(folders);
        const dates = {};
        for (const f of allMedia) {
            if (f.addedAt) dates[f.id] = f.addedAt;
        }
        return res.json({ total: Object.keys(dates).length, dates });
    } catch (err) {
        console.error("[MediaInfo] getAddedDates error:", err);
        return res.status(500).json({ error: "Failed to get added dates" });
    }
}

// POST /api/mediainfo/scan — manually re-trigger a FULL re-probe.
//
// Clears BOTH caches:
//   - mediaCache (folder scan results) — so scanFolder() actually re-runs
//     instead of serving a stale file list
//   - mediaInfoStore (ffprobe results) — so getMediaInfo() treats every file
//     as a cache miss and genuinely re-runs ffprobe, instead of returning
//     whatever's already stored
//
// Use this after fixing a probing bug, or if you suspect stored data is
// stale/wrong for any reason — it's the "start over" button for mediaInfo.
async function triggerScan(req, res) {
    try {
        const folders = await readFolders();
        invalidateAllFolders();
        invalidateAllMediaInfo();
        // Fire and forget — respond immediately, scan (+ ffprobe re-probe) continues in background
        getAllCached(folders).catch((err) => console.error("[MediaInfo] Manual rescan failed:", err.message));
        return res.json({ message: "Full re-probe started — every file will be re-run through ffprobe in the background" });
    } catch (err) {
        console.error("[MediaInfo] triggerScan error:", err);
        return res.status(500).json({ error: "Failed to start scan" });
    }
}

module.exports = { getAllMediaInfo, getAddedDates, triggerScan };
