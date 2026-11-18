import { api } from "./client";

// ─── Review system (reviews · reactions · discussions) ───────────────────────
// Backend: /api/reviews (server/routes/media/reviews.js) — data lives in server/data/media/reviews.json.
// Everything here talks to YOUR server only; nothing is sent to TMDB.
//
// Titles are addressed by TMDB id + kind ("movie" | "tv"; "series"/"anime" are accepted and mean tv).
// Reaction types: "like" | "love" | "funny" | "wow" | "sad" | "dislike"  (or null to remove yours).
//
// (The old getReviews(mediaId) / refreshReviews(mediaId) pair is gone — it called routes that never existed.)

const qs = (params) => {
    const p = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => v != null && p.set(k, String(v)));
    const s = p.toString();
    return s ? `?${s}` : "";
};

/** GET → { key, total, average (/10), histogram [1★…5★], mine (review id | null), importing, items: [review] } */
export const getTitleReviews = (kind, tmdbId, params) => api.get(`/api/reviews/title/${kind}/${tmdbId}${qs(params)}`);

/** POST { rating: 1-10, content, title?, poster?, backdrop? } → { review } — 409 ALREADY_REVIEWED if you have one */
export const createReview = (kind, tmdbId, body) => api.post(`/api/reviews/title/${kind}/${tmdbId}`, body);

/** PATCH { rating?, content? } → { review } */
export const updateReview = (id, body) => api.patch(`/api/reviews/${id}`, body);

export const deleteReview = (id) => api.delete(`/api/reviews/${id}`);

/** POST { type } → { id, reactions } */
export const reactToReview = (id, type) => api.post(`/api/reviews/${id}/react`, { type });

/** GET → { review, replies: [comment], media } — replies are flat; parentId groups them under their top-level comment */
export const getReviewThread = (id) => api.get(`/api/reviews/${id}/thread`);

/** POST { content, parentId? } → { reply, replyCount } — parentId = the comment you are answering */
export const addReply = (reviewId, body) => api.post(`/api/reviews/${reviewId}/replies`, body);

export const updateReply = (replyId, content) => api.patch(`/api/reviews/replies/${replyId}`, { content });

export const deleteReply = (replyId) => api.delete(`/api/reviews/replies/${replyId}`);

export const reactToReply = (replyId, type) => api.post(`/api/reviews/replies/${replyId}/react`, { type });

// ─── Home page rows ──────────────────────────────────────────────────────────

/** GET → { total, items: [{ id, author, avatar, rating, content, createdAt, likes, comments, media }] } */
export const getPopularReviews = () => api.get("/api/reviews/popular");

/** GET → { total, items: [{ id, title, body, author, avatar, rating, createdAt, likes, comments, media }] }
 *  = the reviews with the most reactions + replies (until there is activity, the best imported reviews). */
export const getPopularDiscussions = () => api.get("/api/reviews/discussions");
