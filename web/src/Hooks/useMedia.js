// web/src/hooks/useMedia.js
// TanStack Query hooks for media endpoints.
// Drop-in replacements for apiContext media state.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMedia, getMediaById, searchMedia } from "../api/media";
import { getSeasonDetail } from "../api/metadata";
import { useAuth } from "../auth/AuthContext";

// ─── Query keys ───────────────────────────────────────────────────────────────
export const MEDIA_KEYS = {
    all: ["media"],
    list: (params = {}) => ["media", "list", params],
    byId: (id) => ["media", "byId", id],
    search: (q, folderId) => ["media", "search", q, folderId],
    seasonDetail: (tmdbId, seasonNumber) => ["media", "seasonDetail", tmdbId, seasonNumber],
};

// Restricted-content rule (mirrors backend mediaController.js canSeeRestricted):
// admin OR allowAdult:true → see everything.
// everyone else → permission:false items hidden.
function canSeeRestricted(user, permissions) {
    if (!user) return false;
    return user.role === "admin" || permissions?.allowAdult === true;
}

// Filters out permission:false items unless canSeeRestricted
function filterRestricted(data, user, permissions) {
    if (!data || canSeeRestricted(user, permissions)) return data;
    const filter = (arr) => (arr || []).filter((item) => item.permission !== false);
    return {
        ...data,
        movies: data.movies ? { ...data.movies, items: filter(data.movies.items) } : data.movies,
        series: data.series ? { ...data.series, items: filter(data.series.items) } : data.series,
        anime: data.anime ? { ...data.anime, items: filter(data.anime.items) } : data.anime,
    };
}

/**
 * useMedia() — fetches all media from /api/media
 * Accepts optional params: { type, q, category, title, season }
 *
 * @param {object} params
 * @param {object} [options] — additional useQuery options
 */
export function useMedia(params = {}, options = {}) {
    const { user, permissions } = useAuth();
    const query = useQuery({
        queryKey: MEDIA_KEYS.list(params),
        queryFn: () => getMedia(params),
        staleTime: 2 * 60 * 1000,
        ...options,
    });
    return {
        ...query,
        data: filterRestricted(query.data, user, permissions),
    };
}

/**
 * useMediaById(id) — fetches single media item by ID
 */
export function useMediaById(id, options = {}) {
    return useQuery({
        queryKey: MEDIA_KEYS.byId(id),
        queryFn: () => getMediaById(id),
        enabled: !!id,
        staleTime: 5 * 60 * 1000,
        ...options,
    });
}

/**
 * useMediaSearch(q, folderId) — search media
 */
export function useMediaSearch(q, folderId, options = {}) {
    const { user, permissions } = useAuth();
    const query = useQuery({
        queryKey: MEDIA_KEYS.search(q, folderId),
        queryFn: () => searchMedia(q, folderId),
        enabled: !!q,
        staleTime: 60 * 1000,
        ...options,
    });
    return {
        ...query,
        data: query.data
            ? {
                  ...query.data,
                  results: canSeeRestricted(user, permissions) ? query.data.results : (query.data.results || []).filter((item) => item.permission !== false),
              }
            : query.data,
    };
}

/**
 * useSeasonDetail(tmdbId, seasonNumber, options)
 *
 * Lazily fetches one season's TMDB detail via the new
 * GET /api/metadata/tv/:tmdbId/season/:seasonNumber endpoint (metadata
 * upgrade plan, feature 10). This is SEPARATE from the eager season data
 * grouper.js already attaches to every series/anime at scan time — that
 * data flow is untouched. Use this when a season needs an on-demand
 * (re)fetch: it was missing/empty at scan time, or the user asked to
 * refresh it. `enabled` defaults to false-when-no-ids so callers control
 * exactly when the automatic fetch fires; `refetch()` always works
 * on-demand regardless of `enabled` (TanStack Query behavior).
 */
export function useSeasonDetail(tmdbId, seasonNumber, options = {}) {
    return useQuery({
        queryKey: MEDIA_KEYS.seasonDetail(tmdbId, seasonNumber),
        queryFn: () => getSeasonDetail(tmdbId, seasonNumber),
        enabled: Boolean(tmdbId) && seasonNumber != null,
        staleTime: 5 * 60 * 1000,
        ...options,
    });
}

/**
 * useInvalidateMedia() — returns a function to invalidate all media queries.
 * Call after adding/removing library folders.
 */
export function useInvalidateMedia() {
    const qc = useQueryClient();
    return () => qc.invalidateQueries({ queryKey: MEDIA_KEYS.all });
}
