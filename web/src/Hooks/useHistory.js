// web/src/Hooks/useHistory.js
// TanStack Query hooks for watch history endpoints.
// All history queries use skipAuthHandler — don't open login modal on 401.

import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { getAuthToken } from "../api/client";
import { getHistory, deleteHistory, clearHistory } from "../api/history";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:5000";

export const HISTORY_KEYS = {
    all: ["history"],
    list: () => ["history", "list"],
};

// Live pings refresh everything derived from watching: history + the Watch Time page.
const refreshLive = (qc) => {
    qc.invalidateQueries({ queryKey: HISTORY_KEYS.all });
    qc.invalidateQueries({ queryKey: ["watchtime"] });
};

// Safety-net poll only. Real-time updates come from the SSE push below
// (server → "history changed" ping → refetch), so this can be slow.
const HISTORY_POLL_MS = 30_000;

// ─── Live push (Server-Sent Events) ───────────────────────────────────────────
// ONE shared EventSource for the whole app, ref-counted across every
// component that calls useHistory(). Server pings whenever this account's
// history changes (any device) → we invalidate → TanStack refetches.
let _es = null;
let _refs = 0;
let _retry = null;
let _wasDown = false;

function scheduleReopen(qc, ms) {
    if (_refs <= 0 || _retry) return;
    _retry = setTimeout(() => {
        _retry = null;
        openHistoryStream(qc);
    }, ms);
}

function openHistoryStream(qc) {
    if (_es || _retry || _refs <= 0) return;
    const token = getAuthToken();
    // Auth provider may not be registered yet on first mount — try again shortly
    // instead of giving up (otherwise live updates silently never start).
    if (!token) return scheduleReopen(qc, 500);
    const es = new EventSource(`${BASE}/api/history/events?token=${encodeURIComponent(token)}`);
    _es = es;
    es.onopen = () => {
        console.debug("[History] live stream connected");
        // Re-sync once after a drop so nothing missed while offline is lost.
        if (_wasDown) refreshLive(qc);
        _wasDown = false;
    };
    es.onmessage = () => refreshLive(qc);
    es.onerror = () => {
        // Browser auto-retry doesn't refresh the token; rebuild with a fresh one.
        console.debug("[History] live stream dropped — reconnecting");
        es.close();
        if (_es === es) _es = null;
        _wasDown = true;
        scheduleReopen(qc, 1500);
    };
}

function closeHistoryStream() {
    clearTimeout(_retry);
    _retry = null;
    _wasDown = false;
    if (_es) _es.close();
    _es = null;
}

/**
 * useHistory() — fetches full watch history for the logged-in account.
 *
 * Freshness (no manual reload needed):
 *  - refetchOnMount "always"  → coming back to Home after playing refetches
 *  - refetchOnWindowFocus     → switching tabs/devices refetches
 *  - SSE push (above)         → other devices' progress shows up in ~100ms
 *  - refetchInterval          → slow safety-net poll in case the push drops
 *  - useProgress also writes each save straight into this cache (same device = instant)
 */
export function useHistoryLive(isAuthenticated) {
    const qc = useQueryClient();
    useEffect(() => {
        if (!isAuthenticated || typeof EventSource === "undefined") return undefined;
        _refs++;
        openHistoryStream(qc);
        return () => {
            _refs--;
            if (_refs <= 0) {
                _refs = 0;
                closeHistoryStream();
            }
        };
    }, [isAuthenticated, qc]);
}

export function useHistory(options = {}) {
    const { isAuthenticated } = useAuth();
    useHistoryLive(isAuthenticated);

    return useQuery({
        queryKey: HISTORY_KEYS.list(),
        queryFn: getHistory,
        enabled: isAuthenticated,
        select: (data) => data?.history ?? [],
        staleTime: 5 * 1000,
        refetchOnMount: "always",
        refetchOnWindowFocus: true,
        refetchInterval: HISTORY_POLL_MS,
        refetchIntervalInBackground: false,
        ...options,
    });
}

/**
 * useDeleteHistory() — removes one entry from history (optimistic)
 */
export function useDeleteHistory() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id) => deleteHistory(id),
        onMutate: async (id) => {
            await qc.cancelQueries({ queryKey: HISTORY_KEYS.list() });
            const prev = qc.getQueryData(HISTORY_KEYS.list());
            qc.setQueryData(HISTORY_KEYS.list(), (old) => {
                if (!old) return old;
                const next = old.history?.filter((h) => h.id !== id) ?? [];
                return { ...old, total: next.length, history: next };
            });
            return { prev };
        },
        onError: (_, __, ctx) => {
            if (ctx?.prev) qc.setQueryData(HISTORY_KEYS.list(), ctx.prev);
        },
        onSettled: () => {
            qc.invalidateQueries({ queryKey: HISTORY_KEYS.list() });
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
            qc.setQueryData(HISTORY_KEYS.list(), { total: 0, history: [] });
        },
    });
}
