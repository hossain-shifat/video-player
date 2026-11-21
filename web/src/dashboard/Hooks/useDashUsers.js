// web/src/Dashboard/Hooks/useDashUsers.js
// Data hooks for the Users dashboard page. The page never touches the overview hooks directly.
//
// useUsersActivity() returns only user-related data:
//   presence  { onlineSet, seen }   live online list + last-seen per user id
//   data      { calendar, dauDates, dau, activeToday, activeWeek, activeMonth, topViewers, devices } | null
//   state     "loading" | "ready" | "error"
//   refetch() re-pull everything
//
// Right now it reads from the same server analytics the overview page uses and keeps ONLY the
// user fields. When you add a dedicated users-activity endpoint, change this one file and the
// page needs no edits.

import { useMemo } from "react";
import { useOverviewAnalytics, useOverviewLive } from "./useOverviewAnalytics";

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function useUsersActivity() {
    const analytics = useOverviewAnalytics();
    const live = useOverviewLive();
    const an = analytics.data ?? null;
    const lv = live.data ?? null;

    const presence = useMemo(
        () => ({
            onlineSet: lv?.onlineUserIds ? new Set(lv.onlineUserIds) : null,
            seen: Object.fromEntries((an?.sessions?.users ?? []).map((u) => [u.id, u.lastSeenAt])),
        }),
        [lv, an],
    );

    const data = useMemo(() => {
        if (!an) return null;
        const calAll = Array.isArray(an.watch?.calendar) ? an.watch.calendar : [];
        const cal = calAll.slice(-30);
        const eng = an.watch?.engagement ?? {};
        const bt = an.sessions?.byType ?? {};
        return {
            calendar: calAll.map((d) => ({ date: d.date, users: num(d.users) })),
            dauDates: cal.map((d) => d.date),
            dau: cal.map((d) => num(d.users)),
            activeToday: num(eng.activeToday),
            activeWeek: num(eng.activeWeek),
            activeMonth: num(eng.activeMonth),
            topViewers: (an.topViewers ?? []).map((u) => ({ id: u.id, label: u.name || u.email || "—", value: num(u.hours) })),
            devices: [
                ["Desktop", bt.desktop, "stroke-primary", "bg-primary"],
                ["Mobile", bt.mobile, "stroke-info", "bg-info"],
                ["Tablet", bt.tablet, "stroke-base-content/55", "bg-base-content/55"],
                ["Other", bt.other, "stroke-base-content/30", "bg-base-content/30"],
            ]
                .map(([label, v, stroke, bg]) => ({ label, value: num(v), stroke, bg }))
                .filter((d) => d.value > 0),
        };
    }, [an]);

    const state = analytics.isLoading ? "loading" : analytics.isError && !an ? "error" : "ready";

    const refetch = () => {
        analytics.refetch();
        live.refetch();
    };

    return { presence, data, state, refetch };
}
