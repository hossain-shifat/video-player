// web/src/Hooks/Query/useMediaRouteId.js
// Pages mounted on /media/:id and /player/:id may receive the 9-char alias (/media/WPr6c9UPq) or a long id.
// Routes wrap those pages with withResolvedMediaId (Routes/MediaIdGate.jsx), which resolves the alias first
// and hands the page the LONG id through this context — so everything inside the page keeps using the id it
// always did (history, watchlist, progress, API calls).
import { createContext, useContext } from "react";
import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../Api/client";
import { isShortId, lookupLongId, rememberLongId } from "../../Utils/shortId";

export const MediaRouteIdContext = createContext(null);

/** The long media id of the current /media/:id or /player/:id route. */
export function useMediaRouteId() {
    const fromGate = useContext(MediaRouteIdContext);
    const { id } = useParams();
    if (fromGate) return fromGate;
    // Safety net: if a page is ever mounted without the gate, never hand the 9-char alias to API calls / history lookups.
    return isShortId(id) ? (lookupLongId(id) ?? id) : id;
}

/** alias | long id → { id, pending, notFound } */
export function useResolveMediaId(param) {
    const short = isShortId(param);
    const local = short ? lookupLongId(param) : param;
    const q = useQuery({
        queryKey: ["mediaShortId", param],
        enabled: short && !local,
        staleTime: Infinity,
        retry: false,
        queryFn: async () => {
            const r = await api.get(`/api/ids/${param}`);
            if (r?.id) rememberLongId(r.id);
            return r?.id || null;
        },
    });
    if (!short) return { id: param, pending: false, notFound: false };
    if (local) return { id: local, pending: false, notFound: false };
    if (q.isError || (q.isSuccess && !q.data)) return { id: null, pending: false, notFound: true };
    return { id: q.data || null, pending: !q.data, notFound: false };
}
