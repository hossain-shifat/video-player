import { api } from "./client";

// ─── Live TV (EPG) ────────────────────────────────────────────────────────────

/**
 * GET /api/live/channels
 * Returns paginated channels with current + next programme.
 *
 * @param {object} params
 * @param {string}  params.q        — search by channel name / programme title
 * @param {string}  params.category — filter by programme category
 * @param {number}  params.page     — page number (default 1)
 * @param {number}  params.limit    — items per page (default 50)
 */
export function getLiveChannels(params = {}) {
    const qs = new URLSearchParams();
    if (params.q)        qs.set("q",        params.q);
    if (params.category) qs.set("category", params.category);
    if (params.page)     qs.set("page",     String(params.page));
    if (params.limit)    qs.set("limit",    String(params.limit));
    const query = qs.toString();
    return api.get(`/api/live/channels${query ? `?${query}` : ""}`);
}

/**
 * GET /api/live/channels/:id
 * Returns one channel with its full 6-hour schedule.
 */
export function getLiveChannel(id) {
    return api.get(`/api/live/channels/${encodeURIComponent(id)}`);
}

/**
 * GET /api/live/categories
 * Returns all programme categories with counts.
 */
export function getLiveCategories() {
    return api.get("/api/live/categories");
}

/**
 * GET /api/live/status
 * Returns EPG cache status (channel count, cache age, etc.)
 */
export function getLiveStatus() {
    return api.get("/api/live/status");
}

/**
 * POST /api/live/refresh
 * Forces EPG cache invalidation.
 */
export function refreshLiveEpg() {
    return api.post("/api/live/refresh");
}
