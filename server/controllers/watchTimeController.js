"use strict";

const { trackWatch, getWatchTime } = require("../utils/watchTimeStore");
const { markHistoryCompleted } = require("../utils/userStore");
const { notify, enrichMediaData, isLiveMedia } = require("./historyController");

const ID_RE = /^[A-Za-z0-9_=-]+$/;

/**
 * POST /api/watchtime/:id — progress beat from the player.
 * Body: { position, duration, type|mediaType, name|title, poster, ... } (same payload the player already builds)
 * Watch Time owns its own data; the only thing that touches history.json is the
 * `completed` flag, flipped when a run is finished / a replay starts so that
 * Continue Watching hides watched titles and shows replays again.
 */
async function beat(req, res) {
    try {
        const userId = req.historyUserId;
        if (!userId) return res.status(401).json({ error: "Authentication required" });

        const { id } = req.params;
        const data = req.body || {};
        if (!id || id.length >= 512 || !ID_RE.test(id)) return res.status(400).json({ error: "Invalid media ID" });
        if (isLiveMedia(data) || typeof data.position !== "number") return res.status(204).end();

        const e = await enrichMediaData(id, data);
        const out = trackWatch(
            userId,
            req.historyEmail,
            id,
            {
                mediaType: e.mediaType || e.type || "movie",
                title: e.title || "",
                poster: e.poster || null,
                seasonNumber: e.seasonNumber ?? null,
                episodeNumber: e.episodeNumber ?? null,
                seriesTitle: e.seriesTitle ?? null,
            },
            data.position,
            data.duration,
        );

        if (out.counted || out.rearmed) {
            markHistoryCompleted(userId, id, out.counted);
            notify(userId, true); // finished / replay started → other devices update at once
        }
        return res.status(204).end();
    } catch (err) {
        console.error("[WatchTime] beat error:", err);
        return res.status(500).json({ error: "Failed to record watch time" });
    }
}

// GET /api/watchtime — stats, 180-day series, insights, watched titles
function stats(req, res) {
    const userId = req.historyUserId;
    if (!userId) return res.status(401).json({ error: "Authentication required" });
    try {
        return res.json(getWatchTime(userId, req.historyEmail));
    } catch (err) {
        console.error("[WatchTime] stats error:", err);
        return res.status(500).json({ error: "Failed to load watch time" });
    }
}

module.exports = { beat, stats };
