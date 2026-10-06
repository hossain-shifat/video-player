// web/src/Hooks/useRecommendations.js
// TanStack Query hooks for the personalized recommendations endpoint.
// Same conventions as useHistory.js / useFavourites.js / useWatchlist.js.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { getRecommendations, refreshRecommendations } from "../api/recommendations";

export const RECOMMENDATIONS_KEYS = {
    all: ["recommendations"],
    list: () => ["recommendations", "list"],
};

/**
 * useRecommendations() — fetches this user's personalized recommendation
 * list. Only enabled when authenticated (the endpoint hard-requires it).
 * A new/inactive user's list is simply [] — the component decides what to
 * render for that, this hook just exposes the data/loading/error state.
 */
export function useRecommendations(options = {}) {
    const { isAuthenticated } = useAuth();
    return useQuery({
        queryKey: RECOMMENDATIONS_KEYS.list(),
        queryFn: getRecommendations,
        enabled: isAuthenticated,
        select: (data) => data?.recommendations ?? [],
        staleTime: 15 * 60 * 1000, // backend itself only regenerates every 30 min or on manual refresh
        ...options,
    });
}

/**
 * useRefreshRecommendations() — manual "refresh my recommendations now".
 * Not wired to any UI by default (not requested) — available for a future
 * settings/refresh button without needing another hook.
 */
export function useRefreshRecommendations() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: refreshRecommendations,
        onSuccess: (data) => {
            qc.setQueryData(RECOMMENDATIONS_KEYS.list(), data);
        },
    });
}
