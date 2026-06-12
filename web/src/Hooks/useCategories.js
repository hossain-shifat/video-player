// web/src/hooks/useCategories.js
// TanStack Query hooks for genre category endpoints.

import { useQuery } from "@tanstack/react-query";
import { getCategories, getByCategory } from "../api/categories";

export const CATEGORY_KEYS = {
    all: ["categories"],
    list: () => ["categories", "list"],
    byName: (name, type) => ["categories", "byName", name, type],
};

/**
 * useCategories() — fetches all genre categories from /api/categories
 */
export function useCategories(options = {}) {
    return useQuery({
        queryKey: CATEGORY_KEYS.list(),
        queryFn: getCategories,
        select: (data) => data?.categories ?? [],
        staleTime: 5 * 60 * 1000, // categories only change when media changes
        ...options,
    });
}

/**
 * useCategoryMedia(name, type?) — fetches media for a specific genre
 */
export function useCategoryMedia(name, type, options = {}) {
    return useQuery({
        queryKey: CATEGORY_KEYS.byName(name, type),
        queryFn: () => getByCategory(name, type),
        enabled: !!name,
        staleTime: 2 * 60 * 1000,
        ...options,
    });
}
