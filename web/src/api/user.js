import { api } from "./client";

// ─── Watchlist ────────────────────────────────────────────────────────────────

/** GET /api/user/watchlist */
export function getWatchlist() {
    // skipAuthHandler: background fetch — don't open modal on 401
    return api.get("/api/user/watchlist", { skipAuthHandler: true });
}

/**
 * POST /api/user/watchlist/:id — add to watchlist
 * @param {string} id
 * @param {{ name: string, poster?: string, type?: string }} data
 */
export function addToWatchlist(id, data) {
    return api.post(`/api/user/watchlist/${id}`, data);
}

/** DELETE /api/user/watchlist/:id */
export function removeFromWatchlist(id) {
    return api.delete(`/api/user/watchlist/${id}`);
}

// ─── Favourites ───────────────────────────────────────────────────────────────

/** GET /api/user/favourites */
export function getFavourites() {
    // skipAuthHandler: background fetch — don't open modal on 401
    return api.get("/api/user/favourites", { skipAuthHandler: true });
}

/**
 * POST /api/user/favourites/:id — mark as favourite
 * @param {string} id
 * @param {{ name: string, poster?: string, type?: string }} data
 */
export function addToFavourites(id, data) {
    return api.post(`/api/user/favourites/${id}`, data);
}

/** DELETE /api/user/favourites/:id */
export function removeFromFavourites(id) {
    return api.delete(`/api/user/favourites/${id}`);
}

// ─── Devices & sessions (owner only — admins have no equivalent) ──────────────

/** GET /api/sessions → { devices[], legacySessions[], counts:{registeredDevices, activeSessions} } */
export function getDevices() {
    return api.get("/api/sessions", { skipAuthHandler: true });
}

/** PATCH /api/sessions/devices/:id { name } — empty name resets to the automatic name */
export function renameDevice(id, name) {
    return api.patch(`/api/sessions/devices/${id}`, { name });
}

/** POST /api/sessions/devices/revoke { deviceIds, sessionIds } — log out one list row (may cover several records of the same browser + IP) */
export function logoutDevices(payload) {
    return api.post("/api/sessions/devices/revoke", payload);
}

/** DELETE /api/sessions/devices/:id — log out every session on one device */
export function logoutDevice(id) {
    return api.delete(`/api/sessions/devices/${id}`);
}

/** DELETE /api/sessions/others — log out everything except this session */
export function logoutOtherDevices() {
    return api.delete("/api/sessions/others");
}

/** DELETE /api/sessions/:id — revoke one session (used for pre-device-tracking sign-ins) */
export function revokeOwnSession(id) {
    return api.delete(`/api/sessions/${id}`);
}
