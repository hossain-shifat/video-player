import { api } from "./client";

// History is per-account (server reads user id from the JWT).
// Authorization header is added automatically by the axios interceptor in client.js.

// ─── Watch History ────────────────────────────────────────────────────────────

/** GET /api/history — full watch history for this account */
export function getHistory() {
    return api.get("/api/history", { skipAuthHandler: true });
}

/**
 * GET /api/history/:id — get resume position for this account+media.
 * Returns null if never watched.
 */
export async function getResumePoint(id) {
    try {
        const data = await api.get(`/api/history/${id}`, { skipAuthHandler: true });
        if (!data || data.position === null || data.position === undefined) return null;
        return data;
    } catch (err) {
        if (err.status === 404 || err.status === 401) return null;
        throw err;
    }
}

/**
 * POST /api/history/:id — save watch progress for this account.
 */
export function saveProgress(id, data) {
    return api.post(`/api/history/${id}`, data, { skipAuthHandler: true });
}

/** DELETE /api/history/:id — remove one entry for this account */
export function deleteHistory(id) {
    return api.delete(`/api/history/${id}`, { skipAuthHandler: true });
}

/** DELETE /api/history — clear all history for this account */
export function clearHistory() {
    return api.delete("/api/history", { skipAuthHandler: true });
}
