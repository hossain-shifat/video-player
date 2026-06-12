// web/src/hooks/useWatchlist.js
// TanStack Query hooks for watchlist endpoints.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { getWatchlist, addToWatchlist, removeFromWatchlist } from "../api/user";

export const WATCHLIST_KEYS = {
    all: ["watchlist"],
    list: () => ["watchlist", "list"],
};

/**
 * useWatchlist() — fetches watchlist.
 * Only enabled when user is authenticated.
 */
export function useWatchlist(options = {}) {
    const { isAuthenticated } = useAuth();
    return useQuery({
        queryKey: WATCHLIST_KEYS.list(),
        queryFn: getWatchlist,
        enabled: isAuthenticated,
        select: (data) => data?.watchlist ?? [],
        staleTime: 2 * 60 * 1000,
        ...options,
    });
}

/**
 * useAddToWatchlist() — adds an item to watchlist with optimistic update
 */
export function useAddToWatchlist() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, data }) => addToWatchlist(id, data),
        onMutate: async ({ id, data }) => {
            await qc.cancelQueries({ queryKey: WATCHLIST_KEYS.list() });
            const prev = qc.getQueryData(WATCHLIST_KEYS.list());
            qc.setQueryData(WATCHLIST_KEYS.list(), (old) => {
                const list = old?.watchlist ?? [];
                return { watchlist: [{ id, ...data, addedAt: new Date().toISOString() }, ...list] };
            });
            return { prev };
        },
        onError: (_, __, ctx) => {
            // Rollback on error
            if (ctx?.prev) qc.setQueryData(WATCHLIST_KEYS.list(), ctx.prev);
        },
        onSettled: () => {
            qc.invalidateQueries({ queryKey: WATCHLIST_KEYS.list() });
        },
    });
}

/**
 * useRemoveFromWatchlist() — removes an item with optimistic update
 */
export function useRemoveFromWatchlist() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id) => removeFromWatchlist(id),
        onMutate: async (id) => {
            await qc.cancelQueries({ queryKey: WATCHLIST_KEYS.list() });
            const prev = qc.getQueryData(WATCHLIST_KEYS.list());
            qc.setQueryData(WATCHLIST_KEYS.list(), (old) => {
                const list = old?.watchlist ?? [];
                return { watchlist: list.filter((w) => w.id !== id) };
            });
            return { prev };
        },
        onError: (_, __, ctx) => {
            if (ctx?.prev) qc.setQueryData(WATCHLIST_KEYS.list(), ctx.prev);
        },
        onSettled: () => {
            qc.invalidateQueries({ queryKey: WATCHLIST_KEYS.list() });
        },
    });
}
