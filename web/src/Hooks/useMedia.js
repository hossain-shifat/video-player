// web/src/hooks/useMedia.js
// TanStack Query hooks for media endpoints.
// Drop-in replacements for apiContext media state.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMedia, getMediaById, searchMedia } from "../api/media";

// ─── Query keys ───────────────────────────────────────────────────────────────
export const MEDIA_KEYS = {
    all: ["media"],
    list: (params = {}) => ["media", "list", params],
    byId: (id) => ["media", "byId", id],
    search: (q, folderId) => ["media", "search", q, folderId],
};

/**
 * useMedia() — fetches all media from /api/media
 * Accepts optional params: { type, q, category, title, season }
 *
 * @param {object} params
 * @param {object} [options] — additional useQuery options
 */
export function useMedia(params = {}, options = {}) {
    return useQuery({
        queryKey: MEDIA_KEYS.list(params),
        queryFn: () => getMedia(params),
        staleTime: 2 * 60 * 1000,
        ...options,
    });
}

/**
 * useMediaById(id) — fetches single media item by ID
 */
export function useMediaById(id, options = {}) {
    return useQuery({
        queryKey: MEDIA_KEYS.byId(id),
        queryFn: () => getMediaById(id),
        enabled: !!id,
        staleTime: 5 * 60 * 1000, // media metadata rarely changes
        ...options,
    });
}

/**
 * useMediaSearch(q, folderId) — search media
 */
export function useMediaSearch(q, folderId, options = {}) {
    return useQuery({
        queryKey: MEDIA_KEYS.search(q, folderId),
        queryFn: () => searchMedia(q, folderId),
        enabled: !!q,
        staleTime: 60 * 1000,
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
