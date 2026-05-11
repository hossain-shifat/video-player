import { api } from "./client";

// ─── Metadata (TMDB) ──────────────────────────────────────────────────────────

/** GET /api/metadata/:id — TMDB details for one file */
export function getMetadata(id) {
    return api.get(`/api/metadata/${id}`);
}

/** GET /api/metadata/enriched — all media with TMDB data attached */
export function getAllEnriched() {
    return api.get("/api/metadata/enriched");
}

/** POST /api/metadata/refresh/:id — force re-fetch TMDB for one file */
export function refreshMetadata(id) {
    return api.post(`/api/metadata/refresh/${id}`);
}

/** POST /api/metadata/refresh-all — clear entire metadata cache */
export function refreshAllMetadata() {
    return api.post("/api/metadata/refresh-all");
}

/**
 * GET /api/metadata/parse?filename=xxx
 * Debug helper — shows how a filename would be parsed.
 */
export function parseFilename(filename) {
    return api.get(`/api/metadata/parse?filename=${encodeURIComponent(filename)}`);
}
