// web/src/hooks/useHistory.js
// TanStack Query hooks for watch history endpoints.
// All history queries use skipAuthHandler — don't open login modal on 401.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { getHistory, deleteHistory, clearHistory } from "../api/history";

export const HISTORY_KEYS = {
    all: ["history"],
    list: () => ["history", "list"],
};

/**
 * useHistory() — fetches full watch history.
 * Only fetches when user is authenticated.
 */
export function useHistory(options = {}) {
    const { isAuthenticated } = useAuth();
    return useQuery({
        queryKey: HISTORY_KEYS.list(),
        queryFn: getHistory,
        enabled: isAuthenticated,
        select: (data) => data?.history ?? [],
        staleTime: 60 * 1000, // history can change frequently during playback
        ...options,
    });
}

/**
 * useDeleteHistory() — removes one entry from history
 */
export function useDeleteHistory() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id) => deleteHistory(id),
        onSuccess: (_, id) => {
            qc.setQueryData(HISTORY_KEYS.list(), (old) => {
                if (!old) return old;
                return { history: old.history?.filter((h) => h.id !== id) ?? [] };
            });
        },
    });
}

/**
 * useClearHistory() — wipes all history
 */
export function useClearHistory() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: clearHistory,
        onSuccess: () => {
            qc.setQueryData(HISTORY_KEYS.list(), { history: [] });
        },
    });
}
