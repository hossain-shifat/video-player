// web/src/hooks/useUser.js
// TanStack Query hooks for user profile and system info endpoints.

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { api } from "../api/client";

export const USER_KEYS = {
    all: ["user"],
    info: () => ["user", "serverInfo"],
};

/**
 * useServerInfo() — fetches /api/info (public endpoint).
 * Returns server capabilities: extensions, port, hwAccel, version.
 */
export function useServerInfo(options = {}) {
    return useQuery({
        queryKey: USER_KEYS.info(),
        queryFn: () => api.get("/api/info"),
        staleTime: 10 * 60 * 1000, // server info almost never changes
        ...options,
    });
}
