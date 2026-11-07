// web/src/Hooks/Query/useNotifications.js
//
// Notification state for the bell + Settings. Server is the source of truth;
// this just caches it with TanStack Query (polls every 60s while the tab is
// visible, refetches on focus, and refreshes instantly when the service worker
// reports an incoming push).

import { useEffect, useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../Auth/AuthContext";
import { getNotifications, getNotification, markNotificationRead, markAllNotificationsRead, deleteNotification, clearNotifications, getNotificationPreferences, updateNotificationPreferences, getPushDevices, removePushDevice, getPushStatus } from "../../Api/notifications";
import { getPushState, subscribePushState, syncPushToken, listenToServiceWorker } from "../../Utils/push";

export const NOTIFICATION_KEYS = {
    all: ["notifications"],
    list: ["notifications", "list"],
    detail: (id) => ["notifications", "detail", id],
    prefs: ["notifications", "prefs"],
    devices: ["notifications", "devices"],
    status: ["notifications", "status"],
};

// Mutation with an instant UI update, rolled back if the server says no.
function useOptimisticList(mutationFn, applyToList) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn,
        onMutate: async (arg) => {
            await qc.cancelQueries({ queryKey: NOTIFICATION_KEYS.list });
            const previous = qc.getQueryData(NOTIFICATION_KEYS.list);
            if (previous) qc.setQueryData(NOTIFICATION_KEYS.list, applyToList(previous, arg));
            return { previous };
        },
        onError: (_err, _arg, ctx) => {
            if (ctx?.previous) qc.setQueryData(NOTIFICATION_KEYS.list, ctx.previous);
        },
        onSettled: () => qc.invalidateQueries({ queryKey: NOTIFICATION_KEYS.list }),
    });
}

export function useNotifications() {
    const { isAuthenticated } = useAuth();

    const query = useQuery({
        queryKey: NOTIFICATION_KEYS.list,
        queryFn: () => getNotifications({ limit: 30 }),
        enabled: isAuthenticated,
        refetchInterval: 60_000,
        refetchOnWindowFocus: true,
        staleTime: 15_000,
    });

    const markRead = useOptimisticList(markNotificationRead, (old, id) => {
        const target = old.items.find((n) => n.id === id);
        return {
            ...old,
            unreadCount: target && !target.read ? Math.max(0, old.unreadCount - 1) : old.unreadCount,
            items: old.items.map((n) => (n.id === id ? { ...n, read: true } : n)),
        };
    });

    const markAllRead = useOptimisticList(markAllNotificationsRead, (old) => ({ ...old, unreadCount: 0, items: old.items.map((n) => ({ ...n, read: true })) }));

    const remove = useOptimisticList(deleteNotification, (old, id) => {
        const target = old.items.find((n) => n.id === id);
        return {
            ...old,
            unreadCount: target && !target.read ? Math.max(0, old.unreadCount - 1) : old.unreadCount,
            items: old.items.filter((n) => n.id !== id),
        };
    });

    const clearAll = useOptimisticList(clearNotifications, (old) => ({ ...old, unreadCount: 0, items: [], nextCursor: null }));

    return {
        items: isAuthenticated ? (query.data?.items ?? []) : [],
        unreadCount: isAuthenticated ? (query.data?.unreadCount ?? 0) : 0,
        isLoading: isAuthenticated && query.isLoading,
        isError: query.isError,
        isAuthenticated,
        markRead: (id) => markRead.mutate(id),
        markAllRead: () => markAllRead.mutate(),
        remove: (id) => remove.mutate(id),
        clearAll: () => clearAll.mutate(),
    };
}

/** Full details for one notification (type-specific context + verified destination), loaded from the API. */
export function useNotificationDetail(id) {
    const { isAuthenticated } = useAuth();
    return useQuery({
        queryKey: NOTIFICATION_KEYS.detail(id),
        queryFn: () => getNotification(id).then((r) => r.notification),
        enabled: isAuthenticated && !!id,
        staleTime: 30_000,
        retry: false,
    });
}

/**
 * Mount ONCE (the bell does). Re-attaches this browser's push token to the
 * signed-in account and refreshes the bell when a push arrives. (Clicking a
 * system notification is routed globally in main.jsx.)
 */
export function usePushLifecycle() {
    const { isAuthenticated, user } = useAuth();
    const qc = useQueryClient();

    useEffect(() => {
        if (isAuthenticated) syncPushToken();
    }, [isAuthenticated, user?.id]);

    useEffect(() => listenToServiceWorker({ onPush: () => qc.invalidateQueries({ queryKey: NOTIFICATION_KEYS.list }) }), [qc]);
}

/** Push capability + opt-in state of THIS browser, kept live. */
export function usePushState() {
    const [state, setState] = useState(() => getPushState());
    const refresh = useCallback(() => setState(getPushState()), []);
    useEffect(() => subscribePushState(refresh), [refresh]);
    return { ...state, refresh };
}

// ─── Settings hooks ───────────────────────────────────────────────────────────

export function usePushStatus() {
    const { isAuthenticated } = useAuth();
    return useQuery({ queryKey: NOTIFICATION_KEYS.status, queryFn: getPushStatus, enabled: isAuthenticated, staleTime: 5 * 60_000 });
}

export function useNotificationPreferences() {
    const { isAuthenticated } = useAuth();
    const qc = useQueryClient();

    const query = useQuery({ queryKey: NOTIFICATION_KEYS.prefs, queryFn: getNotificationPreferences, enabled: isAuthenticated, staleTime: 60_000 });

    const update = useMutation({
        mutationFn: updateNotificationPreferences,
        onMutate: async (patch) => {
            await qc.cancelQueries({ queryKey: NOTIFICATION_KEYS.prefs });
            const previous = qc.getQueryData(NOTIFICATION_KEYS.prefs);
            if (previous) qc.setQueryData(NOTIFICATION_KEYS.prefs, { preferences: { ...previous.preferences, ...patch } });
            return { previous };
        },
        onError: (_e, _p, ctx) => ctx?.previous && qc.setQueryData(NOTIFICATION_KEYS.prefs, ctx.previous),
        onSettled: () => qc.invalidateQueries({ queryKey: NOTIFICATION_KEYS.prefs }),
    });

    return { preferences: query.data?.preferences, isLoading: query.isLoading, update: (patch) => update.mutate(patch) };
}

export function usePushDevices() {
    const { isAuthenticated } = useAuth();
    const qc = useQueryClient();

    const query = useQuery({ queryKey: NOTIFICATION_KEYS.devices, queryFn: getPushDevices, enabled: isAuthenticated, staleTime: 30_000 });
    const remove = useMutation({
        mutationFn: removePushDevice,
        onSuccess: () => qc.invalidateQueries({ queryKey: NOTIFICATION_KEYS.devices }),
    });

    return { devices: query.data?.devices ?? [], isLoading: query.isLoading, remove: (id) => remove.mutateAsync(id), refetch: query.refetch };
}
