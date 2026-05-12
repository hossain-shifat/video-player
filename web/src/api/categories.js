import { api } from "./client";

// ─── Categories ───────────────────────────────────────────────────────────────

/**
 * GET /api/categories
 * Response: {
 *   total,
 *   categories: [{ name, title, subtitle, total, movies, series, anime }]
 * }
 */
export function getCategories() {
    return api.get("/api/categories");
}

/**
 * GET /api/categories/:name
 * Response (no type filter): {
 *   category, title, subtitle,
 *   movies: { total, items: [] },
 *   series: { total, items: [] },
 *   anime:  { total, items: [] },
 * }
 * Response (with ?type=movies|series|anime): { total, items: [] }
 *
 * @param {string} name  — genre name e.g. "Action"
 * @param {string} [type] — optional: "movies" | "series" | "anime"
 */
export function getByCategory(name, type) {
    const qs = type ? `?type=${encodeURIComponent(type)}` : "";
    return api.get(`/api/categories/${encodeURIComponent(name)}${qs}`);
}
