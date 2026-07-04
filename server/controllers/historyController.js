"use strict";

const fs = require("fs");
const path = require("path");
const { getHistory, getHistoryEntry, saveProgress, deleteHistoryEntry, clearHistory } = require("../utils/userStore");
const { getCached, getCachedSeason } = require("../utils/metadataStore");

function getClientId(req) {
    return req.headers["x-flux-client"] || req.query.clientId || null;
}

function decodeId(id) {
    try {
        return Buffer.from(id, "base64").toString("utf-8");
    } catch {
        return null;
    }
}

// Windows backslash paths — split manually (server runs Linux/CasaOS)
function winParts(filePath) {
    return filePath.split("\\");
}

const SE_RE = /[Ss](\d{1,2})[._-]?[Ee](\d{1,3})/;

/**
 * LIVE MEDIA GUARD — explicit flags only.
 * Only blocks requests that explicitly declare themselves as live.
 * DO NOT try to infer liveness from the ID — movie IDs can also look
 * ambiguous and that caused false-positive drops.
 */
function isLiveMedia(data) {
    const mt = (data.mediaType || data.type || "").toLowerCase();
    return mt === "live" || mt === "livetv" || mt === "iptv" || data.isLive === true;
}

/**
 * enrichMediaData — cache-only metadata enrichment for movies + series.
 *
 * Movies:  getCached(id) → title, poster
 * Series:  getCached(id) → title, tmdbId
 *          + S/E parsed from filename → seasonNumber, episodeNumber
 *          + getCachedSeason(tmdbId, S) → episodes → seriesTitle
 *
 * If getCached misses (metadata not yet scraped), falls back to parsing
 * a readable title from the file path.
 */
async function enrichMediaData(id, data) {
    const mediaType = (data.mediaType || data.type || "movie").toLowerCase();
    const isSeries = mediaType === "series" || mediaType === "anime";

    let title = data.title || null;
    let poster = data.poster || null;
    let seriesTitle = data.seriesTitle ?? null;
    let seasonNumber = data.seasonNumber ?? null;
    let episodeNumber = data.episodeNumber ?? null;

    // ── Parse S/E from filename (series only) ─────────────────────────────
    if (isSeries && (seasonNumber == null || episodeNumber == null)) {
        const fp = decodeId(id);
        if (fp) {
            const parts = winParts(fp);
            const fileName = parts[parts.length - 1] || "";
            const m = fileName.match(SE_RE);
            if (m) {
                if (seasonNumber == null) seasonNumber = parseInt(m[1], 10);
                if (episodeNumber == null) episodeNumber = parseInt(m[2], 10);
            }
        }
    }

    // Short-circuit: all fields present, nothing to enrich
    if (title && poster && (!isSeries || seriesTitle != null)) {
        return { ...data, title, poster, seriesTitle, seasonNumber, episodeNumber };
    }

    try {
        // ── Metadata cache lookup (O(1) in-memory Map, zero network) ──────
        const meta = await getCached(id);

        if (meta && !meta._notFound) {
            if (!title && meta.title) title = meta.title;
            if (!poster && meta.poster) poster = meta.poster;

            // Series: episode title from season cache
            if (isSeries && meta.tmdbId && seasonNumber != null && episodeNumber != null) {
                const season = await getCachedSeason(meta.tmdbId, seasonNumber);
                if (season?.episodes) {
                    const ep = season.episodes.find((e) => e.episode === episodeNumber);
                    if (ep?.title) seriesTitle = ep.title;
                }
            }
        }

        // ── Fallback: parse readable name from file path ───────────────────
        // Runs for both movies and series when getCached misses.
        if (!title) {
            const fp = decodeId(id);
            if (fp) {
                const parts = winParts(fp);
                const fileName = parts[parts.length - 1] || "";
                const folderName = parts[parts.length - 2] || "";

                // Series → parse from parent folder name
                // Movie  → parse from filename itself
                const raw = isSeries ? folderName : fileName;

                title =
                    raw
                        .replace(/\.mkv$|\.mp4$|\.avi$|\.m4v$/i, "") // strip extension
                        .replace(/[._]S\d{1,2}([._-].*)?$/i, "") // strip S01 suffix (series)
                        .replace(/[._]\d{4}[._-].*/, "") // strip year+quality (movie)
                        .replace(/[._]/g, " ")
                        .trim() || null;
            }
        }
    } catch (err) {
        console.warn("[History] Metadata enrichment failed:", id, err.message);
    }

    return { ...data, title, poster, seriesTitle, seasonNumber, episodeNumber };
}

// ─── Thumbnail cleanup ────────────────────────────────────────────────────────
const THUMB_DIR = path.join(__dirname, "../data/thumbnails");
const THUMB_EXTS = [".jpg", ".jpeg", ".webp", ".png"];

function deleteThumbnailFile(id) {
    for (const ext of THUMB_EXTS) {
        const fp = path.join(THUMB_DIR, `${id}${ext}`);
        try {
            fs.unlinkSync(fp);
            return;
        } catch (err) {
            if (err.code !== "ENOENT") console.warn("[History] Thumbnail delete failed:", fp, err.message);
        }
    }
}

// ─── Route handlers ───────────────────────────────────────────────────────────

function getAllHistory(req, res) {
    const clientId = getClientId(req);
    if (!clientId) return res.status(400).json({ error: "X-Flux-Client header required" });
    const history = getHistory(clientId);
    const items = Object.values(history).sort((a, b) => new Date(b.watchedAt) - new Date(a.watchedAt));
    return res.json({ total: items.length, history: items });
}

function getOne(req, res) {
    const clientId = getClientId(req);
    const entry = getHistoryEntry(req.params.id, clientId);
    if (!entry) return res.json({ position: null, duration: null, exists: false });
    return res.json({ ...entry, exists: true });
}

/**
 * POST /api/history/:id
 *
 * Guards:
 *   - Live media (mediaType=live/livetv/iptv or isLive=true) → 204 drop
 *   - Enriches title/poster/episode fields from metadata cache before saving
 *
 * Resume position behaviour (enforced in userStore.saveProgress):
 *   - Milestone lock: position only advances, never goes backward
 *   - maxPositionReached is NEVER zeroed — even on completion — so replaying
 *     a movie from 0:00 does NOT reset the stored progress until the user
 *     genuinely surpasses their previous furthest point
 */
async function logProgress(req, res) {
    try {
        if (isLiveMedia(req.body)) return res.status(204).end();

        const clientId = getClientId(req);
        const enriched = await enrichMediaData(req.params.id, req.body);
        const entry = saveProgress(req.params.id, enriched, clientId);
        return res.json(entry);
    } catch (err) {
        console.error("[History] logProgress error:", err);
        return res.status(500).json({ error: "Failed to save progress" });
    }
}

function deleteOne(req, res) {
    const clientId = getClientId(req);
    const { id } = req.params;
    const deleted = deleteHistoryEntry(id, clientId);
    if (!deleted) return res.status(404).json({ error: "History entry not found" });
    try {
        deleteThumbnailFile(id);
    } catch (err) {
        console.warn("[History] Thumbnail cleanup error for", id, err.message);
    }
    return res.json({ message: "Removed from history", id });
}

function clearAll(req, res) {
    const clientId = getClientId(req);
    if (!clientId) {
        if (req.query.all !== "true") return res.status(400).json({ error: "X-Flux-Client header required. Pass ?all=true to clear all." });
        clearHistory(null);
        return res.json({ message: "All history cleared" });
    }
    clearHistory(clientId);
    return res.json({ message: "History cleared" });
}

module.exports = { getAllHistory, getOne, logProgress, deleteOne, clearAll };
