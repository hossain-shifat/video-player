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
 * @param {string}  [params.sort]   — sort key (alphabetical|popularity|recommended|recent|live|working) — backend-defined
 * @param {string}  [params.order]  — asc|desc
 * @param {boolean} [params.workingOnly] — only return working-status channels
 * @param {string}  [params.country]
 * @param {string}  [params.language]
 * @param {string}  [params.quality]
 */
export function getLiveChannels(params = {}) {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.category) qs.set("category", params.category);
    if (params.page) qs.set("page", String(params.page));
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.sort) qs.set("sort", params.sort);
    if (params.order) qs.set("order", params.order);
    if (params.workingOnly) qs.set("workingOnly", "true");
    if (params.country) qs.set("country", params.country);
    if (params.language) qs.set("language", params.language);
    if (params.quality) qs.set("quality", params.quality);
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

// ─── Sports Events (Hybrid EPG + Sports Event Service) ────────────────────────
// Backend is the single source of truth for matching, scoring, and working-
// status filtering — the frontend only renders what these return.

/**
 * GET /api/live/featured-events
 * Homepage-ready payload: featuredEvents, liveNow, todayMatches,
 * upcomingHighlights, recommendedChannels, recentlyFinished.
 */
export function getFeaturedEvents() {
    return api.get("/api/live/featured-events");
}

/** GET /api/live/events/live — all currently live sports events + channels */
export function getSportsLiveEvents() {
    return api.get("/api/live/events/live");
}

/** GET /api/live/events/today — today's sports events + channels */
export function getSportsTodayEvents() {
    return api.get("/api/live/events/today");
}

/** GET /api/live/events/upcoming — upcoming sports events + channels */
export function getSportsUpcomingEvents() {
    return api.get("/api/live/events/upcoming");
}

/** GET /api/live/events/:id — single event with full channel list */
export function getSportsEvent(id) {
    return api.get(`/api/live/events/${encodeURIComponent(id)}`);
}

/** GET /api/live/events/:id/channels — just the channel list for one event */
export function getSportsEventChannels(id) {
    return api.get(`/api/live/events/${encodeURIComponent(id)}/channels`);
}

// ─── IPTV Source Management (admin — DashIPTV.jsx) ─────────────────────────────
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
 * @param {string} url
 * @param {AbortSignal} [signal]
 */
export async function checkLiveStreamStatus(url, signal) {
    const res = await axiosInstance.get(`/api/live/check`, { params: { url }, signal });
    return res.data;
}

// ─── Channel State — Active / Edit / Delete (DashIPTV.jsx) ─────────────────────
// Backed by channelStateStore.js on the server (server/data/channel-state.json).
// Separate from source management above — these act on individual channels.

/** GET /api/live/channels/active — full channel objects currently pinned active */
export function getActiveLiveChannels() {
    return api.get("/api/live/channels/active");
}

/**
 * POST /api/live/channels/:id/active — pin a channel to the Active tab
 * @param {string} id — channel id (base64url of its stream url, from ch.id)
 * @param {object} channel — the channel object snapshot to store
 */
export function markLiveChannelActive(id, channel) {
    return api.post(`/api/live/channels/${encodeURIComponent(id)}/active`, channel);
}

/** DELETE /api/live/channels/:id/active — unpin from Active */
export function unmarkLiveChannelActive(id) {
    return api.delete(`/api/live/channels/${encodeURIComponent(id)}/active`);
}

/**
 * PATCH /api/live/channels/:id — edit name/category/country
 * @param {string} id
 * @param {{ name?: string, category?: string, country?: string }} data
 */
export function updateLiveChannel(id, data) {
    return api.patch(`/api/live/channels/${encodeURIComponent(id)}`, data);
}

/** DELETE /api/live/channels/:id — hide channel everywhere (player + dashboard) */
export function deleteLiveChannel(id) {
    return api.delete(`/api/live/channels/${encodeURIComponent(id)}`);
}

/** POST /api/live/channels/:id/restore — undo a hide */
export function restoreLiveChannel(id) {
    return api.post(`/api/live/channels/${encodeURIComponent(id)}/restore`);
}
