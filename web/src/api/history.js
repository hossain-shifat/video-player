import { api } from "./client";
import { getOrCreateClientId } from "./stream";

// ─── Client header helper ─────────────────────────────────────────────────────
function clientHeaders() {
    return { "X-Flux-Client": getOrCreateClientId() };
}

// ─── Watch History ────────────────────────────────────────────────────────────

/** GET /api/history — full watch history for this client */
export function getHistory() {
    return api.get("/api/history", { skipAuthHandler: true, headers: clientHeaders() });
}

/**
 * GET /api/history/:id — get resume position for this client+media.
 * Returns null if never watched.
 */
export async function getResumePoint(id) {
    try {
        const data = await api.get(`/api/history/${id}`, { skipAuthHandler: true, headers: clientHeaders() });
        if (!data || data.position === null || data.position === undefined) return null;
        return data;
    } catch (err) {
        if (err.status === 404 || err.status === 401) return null;
        throw err;
    }
}

/**
 * POST /api/history/:id — save watch progress for this client.
 */
export function saveProgress(id, data) {
    return api.post(`/api/history/${id}`, data, { skipAuthHandler: true, headers: clientHeaders() });
}

/** DELETE /api/history/:id — remove one entry for this client */
export function deleteHistory(id) {
    return api.delete(`/api/history/${id}`, { skipAuthHandler: true, headers: clientHeaders() });
}

/** DELETE /api/history — clear all history for this client */
export function clearHistory() {
    return api.delete("/api/history", { skipAuthHandler: true, headers: clientHeaders() });
}
