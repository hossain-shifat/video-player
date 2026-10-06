import { api } from "./client";
import { getOrCreateClientId } from "./stream";

// ─── Recommendations (personalized — NOT SimilarMedia) ────────────────────────
//
// Unlike history.js, these do NOT pass { skipAuthHandler: true } — a real
// account is required for this feature (routes/recommendations.js hard-
// requires authenticateJWT + requireApprovedUser), so a genuine 401 here
// should trigger the normal re-auth flow, not be silently swallowed.
//
// X-Flux-Client is still attached (same helper history.js already uses) —
// the backend needs it to read this device's watch-history signal; see
// server/controllers/recommendationController.js for why both identities
// are needed.

function clientHeaders() {
    return { "X-Flux-Client": getOrCreateClientId() };
}

/** GET /api/recommendations */
export function getRecommendations() {
    return api.get("/api/recommendations", { headers: clientHeaders() });
}

/** POST /api/recommendations/refresh — force regeneration now */
export function refreshRecommendations() {
    return api.post("/api/recommendations/refresh", undefined, { headers: clientHeaders() });
}
