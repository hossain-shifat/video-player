import { api } from "./client";

// ─── Watch History ────────────────────────────────────────────────────────────

/** GET /api/history — full watch history sorted by most recent */
export function getHistory() {
    return api.get("/api/history");
}

/**
 * GET /api/history/:id — get resume position for one file.
 * Returns null if the file has never been watched.
 */
export async function getResumePoint(id) {
    try {
        const data = await api.get(`/api/history/${id}`);
        // FIX: handle new 200+null pattern (exists:false) and old 404 pattern
        if (!data || data.position === null || data.position === undefined) return null;
        return data;
    } catch (err) {
        if (err.status === 404) return null; // backwards compat
        throw err;
    }
}

/**
 * POST /api/history/:id — save watch progress.
 * Call this periodically while playing (e.g. every 10 seconds).
 *
 * @param {string} id
 * @param {object} data
 * @param {string}  data.name       — display name
 * @param {string}  data.type       — "movie" | "series" | "anime"
 * @param {string}  data.poster     — poster image URL
 * @param {string}  data.streamUrl  — stream URL
 * @param {number}  data.position   — current position in seconds
 * @param {number}  data.duration   — total duration in seconds
 */
export function saveProgress(id, data) {
    return api.post(`/api/history/${id}`, data);
}

/** DELETE /api/history/:id — remove one entry from history */
export function deleteHistory(id) {
    return api.delete(`/api/history/${id}`);
}

/** DELETE /api/history — clear all watch history */
export function clearHistory() {
    return api.delete("/api/history");
}
