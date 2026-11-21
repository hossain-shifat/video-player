// web/src/Dashboard/Hooks/useOverviewAnalytics.js
// Data hooks for the Overview page only. New file — useDashboard.js and dashboardApi.js are untouched.
//   GET /api/admin-dashboard/analytics        heavy aggregates (server-cached 60 s)
//   GET /api/admin-dashboard/analytics/live   who is watching / transcoding right now (server-cached 5 s)

import { useQuery } from "@tanstack/react-query";
import { api } from "../Shared";

const BASE = "/api/admin-dashboard/analytics";

export const OVERVIEW_KEYS = {
    analytics: () => ["dashboard", "analytics"],
    live: () => ["dashboard", "analytics", "live"],
};

export function useOverviewAnalytics(options = {}) {
    return useQuery({
        queryKey: OVERVIEW_KEYS.analytics(),
        queryFn: () => api.get(BASE),
        refetchInterval: 60_000,
        staleTime: 30_000,
        retry: 1,
        ...options,
    });
}

export function useOverviewLive(options = {}) {
    return useQuery({
        queryKey: OVERVIEW_KEYS.live(),
        queryFn: () => api.get(`${BASE}/live`),
        refetchInterval: 10_000,
        staleTime: 5_000,
        retry: 1,
        ...options,
    });
}
