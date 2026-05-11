import { api } from "./client";

// ─── Library (folder management) ─────────────────────────────────────────────

/** GET /api/library — list all saved folders */
export function getFolders() {
    return api.get("/api/library");
}

/**
 * POST /api/library — add a new folder
 * @param {string} path   — absolute path on the server e.g. D:\Media\Movies
 * @param {string} label  — display name (optional)
 */
export function addFolder(path, label) {
    return api.post("/api/library", { path, label });
}

/**
 * PATCH /api/library/:id — update a folder's label or path
 * @param {string} id
 * @param {{ label?: string, path?: string }} updates
 */
export function updateFolder(id, updates) {
    return api.patch(`/api/library/${id}`, updates);
}

/** DELETE /api/library/:id — remove a folder from the library */
export function removeFolder(id) {
    return api.delete(`/api/library/${id}`);
}
