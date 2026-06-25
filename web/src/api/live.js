import { api, axiosInstance } from "./client";

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
    if (params.q) qs.set("q", params.q);
    if (params.category) qs.set("category", params.category);
    if (params.page) qs.set("page", String(params.page));
    if (params.limit) qs.set("limit", String(params.limit));
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

// ─── IPTV Source Management (admin — DashIPTV.jsx) ───────────────────────────
// Separate concern from the EPG functions above: these manage the raw
// playlist sources (M3U/YAML/JSON) that feed the channel list, not programme
// schedule data. JWT is auto-attached by client.js's request interceptor.

/** GET /api/live/sources — list all configured IPTV playlist sources */
export function getLiveSources() {
    return api.get("/api/live/sources");
}

/**
 * POST /api/live/sources/url — register a remote playlist URL
 * @param {{ name: string, url: string }} data
 */
export function addLiveUrlSource(data) {
    return api.post("/api/live/sources/url", data);
}

/**
 * POST /api/live/sources/upload — upload a playlist file (.m3u/.m3u8/.yml/.yaml/.json)
 * Uses axiosInstance directly (not the `api` facade) so axios can set the
 * multipart boundary itself — same interceptor still attaches the JWT.
 * @param {string} name
 * @param {File} file
 */
export async function addLiveUploadSource(name, file) {
    const form = new FormData();
    if (name) form.append("name", name);
    form.append("file", file);
    // Root-cause fix: axiosInstance default "Content-Type: application/json"
    // clobbers the multipart/form-data boundary that the browser needs to
    // set — multer then sees the wrong content-type and req.file is undefined.
    // Explicitly set to undefined so axios auto-detects FormData and lets
    // the browser write the correct "multipart/form-data; boundary=..." header.
    const res = await axiosInstance.post("/api/live/sources/upload", form, {
        headers: { "Content-Type": undefined },
    });
    return res.data;
}

/** POST /api/live/sources/:id/refresh — re-fetch/re-parse a source */
export function refreshLiveSource(id) {
    return api.post(`/api/live/sources/${id}/refresh`);
}

/**
 * PATCH /api/live/sources/:id — update a source's name (and url, for url-type sources)
 * @param {string} id
 * @param {{ name?: string, url?: string }} data
 */
export function updateLiveSource(id, data) {
    return api.patch(`/api/live/sources/${id}`, data);
}

/** DELETE /api/live/sources/:id */
export function removeLiveSource(id) {
    return api.delete(`/api/live/sources/${id}`);
}

/**
 * GET /api/live/channels/flat — backend-paginated flat channel list for DashIPTV.jsx.
 * Backend does filter/sort/paginate — never slice on the client.
 */
export function getLiveChannelsFlat(params = {}) {
    const qs = new URLSearchParams();
    if (params.page) qs.set("page", String(params.page));
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.q) qs.set("q", params.q);
    if (params.category) qs.set("category", params.category);
    if (params.sort) qs.set("sort", params.sort);
    if (params.order) qs.set("order", params.order);
    const query = qs.toString();
    return api.get(`/api/live/channels/flat${query ? `?${query}` : ""}`);
}

/**
 * GET /api/live/check?url=... — tests one stream URL's reachability.
 * Returns { status: 'working' | 'offline' | 'timeout' }.
 * Caller (DashIPTV.jsx) is responsible for queueing/concurrency limiting —
 * this is a single fire-and-await call.
 * @param {string} url
 * @param {AbortSignal} [signal] — pass to cancel in-flight checks on unmount
 */
export async function checkLiveStreamStatus(url, signal) {
    const res = await axiosInstance.get(`/api/live/check`, { params: { url }, signal });
    return res.data;
}
