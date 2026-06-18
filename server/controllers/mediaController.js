"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const multer = require("multer");
const { readFolders } = require("./libraryController");
const { getAllCached, findById, getGroupedCached } = require("../utils/mediaCache");
const { SUBTITLE_EXTENSIONS, decodeFileId, parseSubtitleFilename, isSubtitleFile } = require("../utils/fileHelpers");
const { getMetadata } = require("../utils/metadataStore");
const { groupMedia } = require("../utils/grouper");
const { getPermission } = require("../utils/permissionsStore");
const { probe } = require("../utils/ffprobe");
const { searchSubtitles, downloadSubtitle } = require("../services/subDLService");
const subtitleStore = require("../utils/subtitleStore");

// ─── Multer upload config (memory → then we move to media dir) ────────────────
// Store in memory; we validate and write to disk manually so we can place it
// next to the media file instead of a random temp path.
const _upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max per subtitle
    fileFilter: (_req, file, cb) => {
        if (isSubtitleFile(file.originalname)) {
            cb(null, true);
        } else {
            cb(new Error("Only subtitle files (.srt, .vtt, .ass, .ssa) are accepted"));
        }
    },
}).single("subtitle");

function handleUploadMiddleware(req, res) {
    return new Promise((resolve, reject) => {
        _upload(req, res, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

// Attaches TMDB metadata and category (genres) to a single file object
async function enrich(file) {
    const metadata = await getMetadata(file);
    return {
        ...file,
        metadata,
        category: metadata?.genres || [],
        permission: getPermission(file.id),
    };
}

/**
 * GET /api/media
 * Returns everything in one response, separated by type.
 *
 * Query params:
 *   type=movies|series|anime     — filter to one category only
 *   q=<string>                   — search by title (applies to movies + series name)
 *   title=<string>               — exact series/anime title filter (for season query)
 *   season=<number>              — return only that season's episodes (requires title)
 */
async function getAllMedia(req, res) {
    try {
        // Normalize query params — coerce arrays to single string, guard toLowerCase
        const q = String(Array.isArray(req.query.q) ? req.query.q[0] : (req.query.q ?? ""))
            .trim()
            .toLowerCase();
        const title = String(Array.isArray(req.query.title) ? req.query.title[0] : (req.query.title ?? ""))
            .trim()
            .toLowerCase();
        const type = String(Array.isArray(req.query.type) ? req.query.type[0] : (req.query.type ?? ""))
            .trim()
            .toLowerCase();
        const category = String(Array.isArray(req.query.category) ? req.query.category[0] : (req.query.category ?? ""))
            .trim()
            .toLowerCase();
        const rawSeason = Array.isArray(req.query.season) ? req.query.season[0] : req.query.season;
        const season = rawSeason !== undefined ? parseInt(rawSeason, 10) : NaN;
        const hasSeason = !Number.isNaN(season);

        const folders = await readFolders();
        const { allMedia, folderStats } = await getAllCached(folders);
        // Use cached grouped result — avoids recomputing entire library structure per request.
        // getGroupedCached returns a shallow clone, so filter mutations are safe.
        const grouped = await getGroupedCached(allMedia);

        // ── Category (genre) filter ───────────────────────────────────────────
        if (category) {
            const matchesCategory = (genres) => (genres || []).some((g) => g.toLowerCase() === category);

            grouped.movies = grouped.movies.filter((f) => matchesCategory(f.metadata?.genres));
            grouped.series = grouped.series.filter((s) => matchesCategory(s.metadata?.genres));
            grouped.anime = grouped.anime.filter((a) => matchesCategory(a.metadata?.genres));
        }

        // ── Search filter ─────────────────────────────────────────────────────
        if (q) {
            grouped.movies = grouped.movies.filter((f) => f.name.toLowerCase().includes(q) || f.metadata?.title?.toLowerCase().includes(q));
            grouped.series = grouped.series.filter((s) => s.title.toLowerCase().includes(q));
            grouped.anime = grouped.anime.filter((a) => a.title.toLowerCase().includes(q));
        }

        // ── Series/anime title + season filter ────────────────────────────────
        if (title) {
            const filterByTitle = (arr) => arr.filter((s) => s.title.toLowerCase().includes(title));
            grouped.series = filterByTitle(grouped.series);
            grouped.anime = filterByTitle(grouped.anime);

            // Narrow to one season if requested
            if (hasSeason) {
                const narrowSeasons = (arr) =>
                    arr.map((s) => ({
                        ...s,
                        seasons: Object.fromEntries(Object.entries(s.seasons).filter(([n]) => parseInt(n) === season)),
                    }));
                grouped.series = narrowSeasons(grouped.series);
                grouped.anime = narrowSeasons(grouped.anime);
            }
        }

        // ── Attach permission field ───────────────────────────────────────────
        grouped.movies = grouped.movies.map((m) => ({ ...m, permission: getPermission(m.id) }));
        grouped.series = grouped.series.map((s) => ({ ...s, permission: getPermission(s.id || s.seriesKey) }));
        grouped.anime = grouped.anime.map((a) => ({ ...a, permission: getPermission(a.id || a.seriesKey) }));

        // ── Build response ────────────────────────────────────────────────────
        const response = {
            folders: folderStats,
            movies: { total: grouped.movies.length, items: grouped.movies },
            series: { total: grouped.series.length, items: grouped.series },
            anime: { total: grouped.anime.length, items: grouped.anime },
            unknown: { total: grouped.unknown.length, items: grouped.unknown },
        };

        // If type filter specified, return only that section
        if (type && response[type]) {
            return res.json(response[type]);
        }

        return res.json(response);
    } catch (err) {
        console.error("[Media] getAllMedia error:", err);
        return res.status(500).json({ error: "Failed to get media" });
    }
}

// GET /api/media/:id — single file with metadata
// Handles both movie IDs and series-episode file IDs (which are nested inside seasons)
async function getMediaById(req, res) {
    try {
        const { id } = req.params;
        const folders = await readFolders();
        const { allMedia } = await getAllCached(folders);
        // Use cached grouped result for ID lookup
        const grouped = await getGroupedCached(allMedia);

        // 1. Check top-level items by id (movies + series-group objects)
        const topLevel = [...grouped.movies, ...grouped.series, ...grouped.anime].find((item) => item.id === id);
        if (topLevel) return res.json(topLevel);

        // 1b. Fallback: find series/anime by seriesKey (some frontend paths use this)
        const byKey = [...grouped.series, ...grouped.anime].find((s) => s.seriesKey === id);
        if (byKey) return res.json(byKey);

        // 2. Search inside series/anime episode lists (episode file IDs are nested)
        for (const group of [...grouped.series, ...grouped.anime]) {
            for (const season of Object.values(group.seasons)) {
                const ep = season.episodes.find((e) => e.id === id);
                if (ep) {
                    // Return episode enriched with series-level metadata so the player
                    // has title, poster, season/episode number, etc.
                    return res.json({
                        ...ep,
                        type: group.type,
                        seriesTitle: group.title,
                        metadata: {
                            ...(ep.metadata || {}),
                            title: ep.title || ep.name,
                            poster: ep.still || group.metadata?.poster || null,
                            backdrop: group.metadata?.backdrop || null,
                            // carry series-level fields the player uses
                            seriesPoster: group.metadata?.poster || null,
                            seriesTitle: group.title,
                        },
                        parsed: ep.parsed,
                    });
                }
            }
        }

        return res.status(404).json({ error: "Media not found" });
    } catch (err) {
        console.error("[Media] getMediaById error:", err);
        return res.status(500).json({ error: "Failed to get media" });
    }
}

// GET /api/media/search?q=&type=
async function searchMedia(req, res) {
    try {
        const q = String(Array.isArray(req.query.q) ? req.query.q[0] : (req.query.q ?? ""))
            .trim()
            .toLowerCase();
        const folderId = String(Array.isArray(req.query.folder) ? req.query.folder[0] : (req.query.folder ?? "")).trim();

        const folders = await readFolders();
        const { allMedia } = await getAllCached(folders);
        let results = allMedia;

        if (q) {
            results = results.filter((f) => f.name.toLowerCase().includes(q));
        }
        if (folderId) {
            results = results.filter((f) => f.folderId === folderId);
        }

        results.sort((a, b) => a.name.localeCompare(b.name));
        const enriched = await Promise.all(results.map(enrich));
        return res.json({ total: enriched.length, results: enriched });
    } catch (err) {
        console.error("[Media] searchMedia error:", err);
        return res.status(500).json({ error: "Search failed" });
    }
}

// GET /api/media/:id/subtitles
// Returns unified subtitle list:
//   source=embedded  — tracks extracted from the media file itself via FFmpeg
//   source=external  — .srt/.vtt/.ass/.ssa files found alongside the media file
async function getMediaSubtitles(req, res) {
    try {
        const { id } = req.params;
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
        const ext = path.extname(filePath).toLowerCase();
        const baseName = path.basename(filePath, ext);
        const subtitles = [];

        // ── 1. Embedded subtitle tracks (MKV / MP4 / etc.) ───────────────────
        // Probe is cached in ffprobe.js (10-min TTL) so this is O(1) on repeat calls.
        try {
            const mediaInfo = await probe(filePath);
            if (mediaInfo?.subtitles?.length) {
                for (const track of mediaInfo.subtitles) {
                    // Build a URL the frontend can request to extract this track.
                    // streamController will handle the actual FFmpeg extraction.
                    const encodedVideo = Buffer.from(filePath).toString("base64url");
                    subtitles.push({
                        source: "embedded",
                        trackIndex: track.index, // ffprobe global stream index
                        codec: track.codec,
                        lang: track.language || "und",
                        label: track.language ? track.language.toUpperCase() : "Unknown",
                        forced: track.forced,
                        // URL pattern: /stream/subtitle/embedded/<base64url_video>/<streamIndex>
                        url: `/stream/subtitle/embedded/${encodedVideo}/${track.index}`,
                    });
                }
            }
        } catch (probeErr) {
            // Non-fatal: if ffprobe fails (e.g. file not yet accessible), skip embedded
            console.warn("[Media] ffprobe for embedded subtitles failed:", probeErr.message);
        }

        // ── 2. External subtitle files in the same directory ──────────────────
        // Scans the directory once and matches any file that starts with baseName.
        // Supports: Movie.srt  Movie.en.srt  Movie.bn.forced.srt  Movie.en-US.vtt
        try {
            const dirEntries = await fsp.readdir(dir);
            for (const entry of dirEntries) {
                if (!isSubtitleFile(entry)) continue;
                const parsed = parseSubtitleFilename(baseName, entry);
                if (!parsed) continue; // doesn't belong to this video

                const subPath = path.join(dir, entry);
                const encodedPath = Buffer.from(subPath).toString("base64url");
                subtitles.push({
                    source: "external",
                    filename: entry,
                    ext: path.extname(entry).toLowerCase(),
                    lang: parsed.lang,
                    label: parsed.label,
                    forced: parsed.forced,
                    url: "/stream/subtitle/" + encodedPath,
                });
            }
        } catch (dirErr) {
            // Non-fatal: if directory is unreadable, skip external
            console.warn("[Media] directory scan for external subtitles failed:", dirErr.message);
        }

        // ── 3. Downloaded subtitles (from SubDL / user uploads in data/subtitles/) ──
        try {
            const meta = await subtitleStore.getMediaMeta(id);
            for (const dl of meta.downloaded || []) {
                // Quick in-memory check first, then verify file on disk
                let fileOk = false;
                try {
                    fs.accessSync(dl.path);
                    fileOk = true;
                } catch {
                    /* missing */
                }
                if (!fileOk) continue;
                const langLabel = dl.lang === "bn" ? "Bangla" : dl.lang === "en" ? "English" : dl.lang.toUpperCase();
                subtitles.push({
                    source: "downloaded",
                    lang: dl.lang,
                    label: `${langLabel} (SubDL)`,
                    filename: dl.filename,
                    ext: path.extname(dl.filename).toLowerCase(),
                    url: subtitleStore.getSubtitleStreamUrl(dl.path),
                });
            }
        } catch (dlErr) {
            console.warn("[Media] downloaded subtitles lookup failed:", dlErr.message);
        }

        return res.json({ subtitles });
    } catch (err) {
        console.error("[Media] getMediaSubtitles error:", err);
        return res.status(500).json({ error: "Failed to get subtitles" });
    }
}

// POST /api/media/:id/subtitle/upload
// Accepts a subtitle file in multipart/form-data (field: "subtitle").
// Saves it next to the media file so it's discovered by getMediaSubtitles.
async function uploadSubtitle(req, res) {
    try {
        // Run multer middleware to parse the upload
        await handleUploadMiddleware(req, res);
    } catch (uploadErr) {
        return res.status(400).json({ error: uploadErr.message || "File upload failed" });
    }

    if (!req.file) {
        return res.status(400).json({ error: 'No subtitle file provided (field: "subtitle")' });
    }

    const { id } = req.params;
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
    const ext = path.extname(filePath).toLowerCase();
    const baseName = path.basename(filePath, ext);

    // Derive safe destination filename.
    // Use the uploaded filename if it starts with baseName, otherwise prefix it.
    const origName = req.file.originalname;
    const origExt = path.extname(origName).toLowerCase();
    const origBase = path.basename(origName, origExt);

    let destName;
    if (origBase.toLowerCase().startsWith(baseName.toLowerCase())) {
        destName = origName; // already correctly named
    } else {
        // Prefix with video base name: user uploaded "english.srt" → "Movie.en.srt" if lang detected
        const parsed = parseSubtitleFilename("", origName); // parse lang from just the filename
        destName = parsed && parsed.lang !== "und" ? `${baseName}.${parsed.lang}${origExt}` : `${baseName}.uploaded${origExt}`;
    }

    const destPath = path.join(dir, destName);

    try {
        await fsp.writeFile(destPath, req.file.buffer);

        // Also copy into data/subtitles/<hash16>/<language>/subtitle.srt
        // so the store tracks it and it survives media file moves.
        try {
            const langMatch = destName.match(/\.([a-z]{2,3})\.\w+$/);
            const lang = langMatch ? langMatch[1] : "und";
            const subExt = path.extname(destName).toLowerCase();
            const langDir = subtitleStore.getSubtitleLangDir(id, lang);
            await fsp.mkdir(langDir, { recursive: true });
            const storePath = path.join(langDir, `subtitle${subExt}`);
            await fsp.writeFile(storePath, req.file.buffer);
            await subtitleStore.recordDownloaded(id, {
                lang,
                filename: `subtitle${subExt}`,
                destPath: storePath,
            });
        } catch (storeErr) {
            // Non-fatal — file already saved next to media
            console.warn("[Media] uploadSubtitle store copy failed:", storeErr.message);
        }

        const encodedPath = Buffer.from(destPath).toString("base64url");
        return res.status(201).json({
            message: "Subtitle uploaded successfully",
            filename: destName,
            url: "/stream/subtitle/" + encodedPath,
        });
    } catch (writeErr) {
        console.error("[Media] uploadSubtitle write error:", writeErr);
        return res.status(500).json({ error: "Failed to save subtitle file" });
    }
}

// GET /api/media/:id/subtitle/search?lang=en,bn&tmdbId=&imdbId=&season=&episode=
// Searches SubDL for available subtitles for this media item.
async function searchOnlineSubtitles(req, res) {
    try {
        const { id } = req.params;
        let filePath;
        try {
            filePath = decodeFileId(id);
        } catch {
            return res.status(400).json({ error: "Invalid media ID" });
        }

        const lang = String(req.query.lang || "en,bn").trim();
        const tmdbId = req.query.tmdbId ? String(req.query.tmdbId) : null;
        const imdbId = req.query.imdbId ? String(req.query.imdbId) : null;
        const season = req.query.season != null ? parseInt(req.query.season, 10) : null;
        const episode = req.query.episode != null ? parseInt(req.query.episode, 10) : null;
        const title = String(req.query.q || path.basename(filePath, path.extname(filePath))).trim();
        const year = req.query.year ? parseInt(req.query.year, 10) : null;
        const type = req.query.type || "movie";

        const languages = lang
            .split(",")
            .map((l) => l.trim().toLowerCase())
            .filter(Boolean);

        const result = await searchSubtitles({
            title,
            year,
            imdbId,
            tmdbId,
            season: Number.isFinite(season) ? season : null,
            episode: Number.isFinite(episode) ? episode : null,
            type,
            languages,
        });

        return res.json(result);
    } catch (err) {
        console.error("[Media] searchOnlineSubtitles error:", err);
        return res.status(500).json({ error: "Online subtitle search failed" });
    }
}

// POST /api/media/:id/subtitle/download
// Body: { url: <subdl relative url>, lang: "en"|"bn", releaseName? }
// Downloads subtitle from SubDL ZIP, extracts, saves to data/subtitles/{mediaId}/
async function downloadOnlineSubtitle(req, res) {
    try {
        const { id } = req.params;
        let filePath;
        try {
            filePath = decodeFileId(id);
        } catch {
            return res.status(400).json({ error: "Invalid media ID" });
        }

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: "Media file not found on disk" });
        }

        const { url: subtitleUrl, lang = "en" } = req.body || {};
        if (!subtitleUrl) return res.status(400).json({ error: "url is required" });

        // Save into data/subtitles/<hash16>/<language>/subtitle.srt
        const langDir = subtitleStore.getSubtitleLangDir(id, lang);
        const result = await downloadSubtitle(subtitleUrl, langDir, "subtitle", lang);

        if (!result.ok) {
            return res.status(500).json({ error: result.error || "Download failed" });
        }

        await subtitleStore.recordDownloaded(id, {
            lang,
            filename: result.filename,
            destPath: result.destPath,
        });

        return res.status(201).json({
            message: "Subtitle downloaded from SubDL",
            filename: result.filename,
            lang,
            url: subtitleStore.getSubtitleStreamUrl(result.destPath),
        });
    } catch (err) {
        console.error("[Media] downloadOnlineSubtitle error:", err);
        return res.status(500).json({ error: "Failed to download subtitle" });
    }
}

module.exports = {
    getAllMedia,
    getMediaById,
    searchMedia,
    getMediaSubtitles,
    uploadSubtitle,
    searchOnlineSubtitles,
    downloadOnlineSubtitle,
};
