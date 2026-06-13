// web/src/hooks/useFavourites.js
// TanStack Query hooks for favourites endpoints.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { getFavourites, addToFavourites, removeFromFavourites } from "../api/user";

export const FAVOURITES_KEYS = {
    all: ["favourites"],
    list: () => ["favourites", "list"],
};

/**
 * useFavourites() — fetches favourites list.
 * Only enabled when user is authenticated.
 */
export function useFavourites(options = {}) {
    const { isAuthenticated } = useAuth();
    return useQuery({
        queryKey: FAVOURITES_KEYS.list(),
        queryFn: getFavourites,
        enabled: isAuthenticated,
        select: (data) => data?.favourites ?? [],
        staleTime: 2 * 60 * 1000,
        ...options,
    });
}

/**
 * useAddToFavourites() — marks item as favourite with optimistic update
 */
export function useAddToFavourites() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, data }) => addToFavourites(id, data),
        onMutate: async ({ id, data }) => {
            await qc.cancelQueries({ queryKey: FAVOURITES_KEYS.list() });
            const prev = qc.getQueryData(FAVOURITES_KEYS.list());
            qc.setQueryData(FAVOURITES_KEYS.list(), (old) => {
                const list = old?.favourites ?? [];
                return { favourites: [{ id, ...data, addedAt: new Date().toISOString() }, ...list] };
            });
            return { prev };
        },
        onError: (_, __, ctx) => {
            if (ctx?.prev) qc.setQueryData(FAVOURITES_KEYS.list(), ctx.prev);
        },
        onSettled: () => {
            qc.invalidateQueries({ queryKey: FAVOURITES_KEYS.list() });
        },
    });
}

/**
 * useRemoveFromFavourites() — removes item with optimistic update
 */
export function useRemoveFromFavourites() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id) => removeFromFavourites(id),
        onMutate: async (id) => {
            await qc.cancelQueries({ queryKey: FAVOURITES_KEYS.list() });
            const prev = qc.getQueryData(FAVOURITES_KEYS.list());
            qc.setQueryData(FAVOURITES_KEYS.list(), (old) => {
                const list = old?.favourites ?? [];
                return { favourites: list.filter((f) => f.id !== id) };
            });
            return { prev };
        },
        onError: (_, __, ctx) => {
            if (ctx?.prev) qc.setQueryData(FAVOURITES_KEYS.list(), ctx.prev);
        },
        onSettled: () => {
            qc.invalidateQueries({ queryKey: FAVOURITES_KEYS.list() });
        },
    });
}
