import { api } from "./client";

// ─── Categories ───────────────────────────────────────────────────────────────

/**
 * GET /api/categories
 * Returns all unique genre categories with counts.
 * Response: { total, categories: [{ name, total, movies, series, anime }] }
 */
export function getCategories() {
    return api.get("/api/categories");
}

/**
 * GET /api/categories/:name
 * Returns all media belonging to a specific genre.
 * @param {string} name  — genre name e.g. "Action"
 * @param {string} type  — optional: "movies" | "series" | "anime"
 */
export function getByCategory(name, type) {
    const qs = type ? `?type=${encodeURIComponent(type)}` : "";
    return api.get(`/api/categories/${encodeURIComponent(name)}${qs}`);
}
