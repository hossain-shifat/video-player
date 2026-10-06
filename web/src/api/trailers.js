import { api } from "./client";

// ─── Trailers (TMDB discover + library) ────────────────────────────────────────

/** GET /api/trailers/discover — new movies/series/anime from studios you own, not in your library yet, not yet released */
export function getDiscoverTrailers() {
    return api.get("/api/trailers/discover");
}

/** GET /api/trailers/library — trailers for stuff you already own */
export function getLibraryTrailers() {
    return api.get("/api/trailers/library");
}

/** POST /api/trailers/refresh — force-rebuild both lists right now */
export function refreshTrailers() {
    return api.post("/api/trailers/refresh");
}
