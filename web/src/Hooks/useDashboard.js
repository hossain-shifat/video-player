// web/src/hooks/useDashboard.js
// TanStack Query hooks for admin dashboard endpoints.
// dashApi now uses the shared Axios client — token injection is automatic.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { dashApi } from "../dashboard/api/dashboardApi";
import { useAuth } from "../auth/AuthContext";

export const DASHBOARD_KEYS = {
    all: ["dashboard"],
    stats: () => ["dashboard", "stats"],
    activity: () => ["dashboard", "activity"],
    health: () => ["dashboard", "health"],
    streams: () => ["dashboard", "streams"],
    jobs: () => ["dashboard", "jobs"],
    logs: (params) => ["dashboard", "logs", params],
    libraries: () => ["dashboard", "libraries"],
    users: (params) => ["dashboard", "users", params],
    userSessions: (id) => ["dashboard", "userSessions", id],
};

/**
 * useDashboardStats() — fetches /api/admin-dashboard/stats
 * Auto-refreshes every 30 seconds.
 */
export function useDashboardStats(options = {}) {
    const { isAdmin } = useAuth();
    return useQuery({
        queryKey: DASHBOARD_KEYS.stats(),
        queryFn: () => dashApi.stats(),
        enabled: isAdmin,
        refetchInterval: 30_000,
        staleTime: 15_000,
        ...options,
    });
}

/**
 * useDashboardActivity() — fetches /api/admin-dashboard/activity
 */
export function useDashboardActivity(options = {}) {
    const { isAdmin } = useAuth();
    return useQuery({
        queryKey: DASHBOARD_KEYS.activity(),
        queryFn: () => dashApi.activity(),
        enabled: isAdmin,
        refetchInterval: 30_000,
        staleTime: 15_000,
        ...options,
    });
}

/**
 * useDashboardHealth() — fetches /api/admin-dashboard/health
 */
export function useDashboardHealth(options = {}) {
    const { isAdmin } = useAuth();
    return useQuery({
        queryKey: DASHBOARD_KEYS.health(),
        queryFn: () => dashApi.health(),
        enabled: isAdmin,
        refetchInterval: 30_000,
        staleTime: 15_000,
        ...options,
    });
}

/**
 * useDashboardStreams() — fetches active HLS/direct streams
 */
export function useDashboardStreams(options = {}) {
    const { isAdmin } = useAuth();
    return useQuery({
        queryKey: DASHBOARD_KEYS.streams(),
        queryFn: () => dashApi.streams(),
        enabled: isAdmin,
        refetchInterval: 10_000,
        staleTime: 5_000,
        ...options,
    });
}

/**
 * useDashboardJobs() — fetches background job queue
 */
export function useDashboardJobs(options = {}) {
    const { isAdmin } = useAuth();
    return useQuery({
        queryKey: DASHBOARD_KEYS.jobs(),
        queryFn: () => dashApi.jobs(),
        enabled: isAdmin,
        refetchInterval: 30_000,
        staleTime: 15_000,
        ...options,
    });
}

/**
 * useDashboardLogs(params) — fetches server logs with optional filters
 */
export function useDashboardLogs(params = {}, options = {}) {
    const { isAdmin } = useAuth();
    return useQuery({
        queryKey: DASHBOARD_KEYS.logs(params),
        queryFn: () => dashApi.logs(params),
        enabled: isAdmin,
        staleTime: 10_000,
        ...options,
    });
}

/**
 * useDashboardLibraries() — fetches library stats
 */
export function useDashboardLibraries(options = {}) {
    const { isAdmin } = useAuth();
    return useQuery({
        queryKey: DASHBOARD_KEYS.libraries(),
        queryFn: () => dashApi.libraries(),
        enabled: isAdmin,
        staleTime: 2 * 60 * 1000,
        ...options,
    });
}

/**
 * useDashboardUsers(params) — fetches user list with optional filters
 */
export function useDashboardUsers(params = {}, options = {}) {
    const { isAdmin } = useAuth();
    return useQuery({
        queryKey: DASHBOARD_KEYS.users(params),
        queryFn: () => dashApi.users(params),
        enabled: isAdmin,
        staleTime: 60 * 1000,
        ...options,
    });
}

/**
 * useDashboardUserSessions(id) — fetches sessions for a specific user
 */
export function useDashboardUserSessions(id, options = {}) {
    const { isAdmin } = useAuth();
    return useQuery({
        queryKey: DASHBOARD_KEYS.userSessions(id),
        queryFn: () => dashApi.userSessions(id),
        enabled: isAdmin && !!id,
        staleTime: 30_000,
        ...options,
    });
}

/**
 * useUpdateDashboardUser() — mutation to update a user's status/role
 */
export function useUpdateDashboardUser() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, data }) => dashApi.updateUser(id, data),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: DASHBOARD_KEYS.all });
        },
    });
}

/**
 * useDeleteDashboardUser() — mutation to delete a user
 */
export function useDeleteDashboardUser() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id) => dashApi.deleteUser(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: DASHBOARD_KEYS.all });
        },
    });
}

/**
 * useRevokeDashboardSession() — mutation to revoke a session
 */
export function useRevokeDashboardSession() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id) => dashApi.revokeSession(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: DASHBOARD_KEYS.all });
        },
    });
}

/**
 * useStopDashboardStream() — mutation to stop an active stream
 */
export function useStopDashboardStream() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id) => dashApi.stopStream(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: DASHBOARD_KEYS.streams() });
        },
    });
}
