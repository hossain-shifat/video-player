// web/src/Hooks/useWatchTime.js
// TanStack Query hook for the Watch Time page — its own query key and API,
// separate from watch history. Reuses the shared live-push connection so the
// page updates on its own while you (or another device) are watching.

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { getWatchTime } from "../api/watchtime";
import { useHistoryLive } from "./useHistory";

export const WATCHTIME_KEYS = {
    all: ["watchtime"],
    stats: () => ["watchtime", "stats"],
};

export function useWatchTime(options = {}) {
    const { isAuthenticated } = useAuth();
    useHistoryLive(isAuthenticated);
    return useQuery({
        queryKey: WATCHTIME_KEYS.stats(),
        queryFn: getWatchTime,
        enabled: isAuthenticated,
        staleTime: 5 * 1000,
        refetchOnMount: "always",
        refetchOnWindowFocus: true,
        refetchInterval: 30_000,
        refetchIntervalInBackground: false,
        ...options,
    });
}
