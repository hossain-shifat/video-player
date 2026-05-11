import { api } from "./client";

// ─── Media ────────────────────────────────────────────────────────────────────

/**
 * GET /api/media
 * Returns all media grouped by type (movies, series, anime).
 *
 * @param {object} params
 * @param {string}  params.type      — "movies" | "series" | "anime"
 * @param {string}  params.q         — search query
 * @param {string}  params.category  — filter by genre e.g. "Action"
 * @param {string}  params.title     — series/anime title for season filter
 * @param {number}  params.season    — season number (requires title)
 */
export function getMedia(params = {}) {
    const qs = new URLSearchParams();
    if (params.type) qs.set("type", params.type);
    if (params.q) qs.set("q", params.q);
    if (params.category) qs.set("category", params.category);
    if (params.title) qs.set("title", params.title);
    if (params.season !== undefined) qs.set("season", params.season);
    const query = qs.toString();
    return api.get(`/api/media${query ? `?${query}` : ""}`);
}

/** GET /api/media/:id — single file with metadata */
export function getMediaById(id) {
    return api.get(`/api/media/${id}`);
}

/** GET /api/media/search?q=&folder= */
export function searchMedia(q, folderId) {
    const qs = new URLSearchParams();
    if (q) qs.set("q", q);
    if (folderId) qs.set("folder", folderId);
    return api.get(`/api/media/search?${qs}`);
}

/** GET /api/media/:id/subtitles */
export function getSubtitles(id) {
    return api.get(`/api/media/${id}/subtitles`);
}
