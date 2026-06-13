// web/src/hooks/useMedia.js
// TanStack Query hooks for media endpoints.
// Drop-in replacements for apiContext media state.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMedia, getMediaById, searchMedia } from "../api/media";
import { useAuth } from "../auth/AuthContext";

// ─── Query keys ───────────────────────────────────────────────────────────────
export const MEDIA_KEYS = {
    all: ["media"],
    list: (params = {}) => ["media", "list", params],
    byId: (id) => ["media", "byId", id],
    search: (q, folderId) => ["media", "search", q, folderId],
};

// Filters out permission:false items when allowAdult is false
function filterRestricted(data, allowAdult) {
    if (allowAdult !== false || !data) return data;
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
    const { permissions } = useAuth();
    const query = useQuery({
        queryKey: MEDIA_KEYS.list(params),
        queryFn: () => getMedia(params),
        staleTime: 2 * 60 * 1000,
        ...options,
    });
    return {
        ...query,
        data: filterRestricted(query.data, permissions?.allowAdult),
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
    const { permissions } = useAuth();
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
                  results: permissions?.allowAdult === false ? (query.data.results || []).filter((item) => item.permission !== false) : query.data.results,
              }
            : query.data,
    };
}

/**
 * useInvalidateMedia() — returns a function to invalidate all media queries.
 * Call after adding/removing library folders.
 */
export function useInvalidateMedia() {
    const qc = useQueryClient();
    return () => qc.invalidateQueries({ queryKey: MEDIA_KEYS.all });
}
