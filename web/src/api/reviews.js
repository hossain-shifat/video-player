import { api } from "./client";

// ─── Reviews (IMDb-primary, TMDB-id fallback) ────────────────────────────────

/**
 * GET /api/reviews/:mediaId
 * → { success, source: "imdb"|"tmdb_fallback"|"empty", reviews: [...], tmdbReviewIds: [...], imdbId }
 *
 * `reviews` is populated only when source === "imdb" (full normalized
 * objects, ready to render). When source is "tmdb_fallback" or "empty",
 * `reviews` is [] and `tmdbReviewIds` carries the same TMDB review id list
 * Reviews.jsx already knows how to fetch and render on its own — nothing
 * else needs to change to keep that path working.
 */
export function getReviews(mediaId) {
    return api.get(`/api/reviews/${mediaId}`);
}

/** POST /api/reviews/refresh/:mediaId — clear cached reviews, re-fetch */
export function refreshReviews(mediaId) {
    return api.post(`/api/reviews/refresh/${mediaId}`);
}

// ─── Home page feeds (Popular Reviews / Popular Discussions) ──────────────────

/**
 * GET /api/media/popular-reviews
 * → { total, generatedAt, building, items: [{ id, author, avatar, rating, content, createdAt, likes, comments, media }] }
 * Built from the library, cached on the server and rebuilt every 3 days. `building: true` + no items = first build still running.
 */
export function getPopularReviews() {
    return api.get("/api/media/popular-reviews");
}

/**
 * GET /api/media/popular-discussions
 * → { total, generatedAt, building, items: [{ id, title, body, author, avatar, rating, createdAt, likes, comments, media }] }
 * Needs TRAKT_CLIENT_ID on the server — without it the list is empty (the Home row stays hidden).
 */
export function getPopularDiscussions() {
    return api.get("/api/media/popular-discussions");
}
