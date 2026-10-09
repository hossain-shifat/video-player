import { api } from "./client";

// Watch Time has its own API — independent of /api/history.
// Authorization header is added automatically by the axios interceptor.

/** GET /api/watchtime — stats, 180-day series, insights, watched titles */
export function getWatchTime() {
    return api.get("/api/watchtime", { skipAuthHandler: true });
}

/** POST /api/watchtime/:id — progress beat from the player (seconds watched + finish detection) */
export function sendWatchBeat(id, payload) {
    return api.post(`/api/watchtime/${id}`, payload, { skipAuthHandler: true });
}
