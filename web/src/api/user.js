import { api } from "./client";

// ─── Watchlist ────────────────────────────────────────────────────────────────

/** GET /api/user/watchlist */
export function getWatchlist() {
    return api.get("/api/user/watchlist");
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
    return api.get("/api/user/favourites");
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
