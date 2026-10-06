import { useEffect, useRef } from "react";
import { useRecommendations, useRefreshRecommendations } from "../Hooks/useRecommendations";
import MediaRow from "./MediaRow";

/**
 * Recommendations — "what should THIS USER watch next", built from their own
 * history/favourites/watchlist (server/utils/recommendationEngine.js).
 *
 * This is NOT SimilarMedia: no currentId/genres/mediaType props — it is
 * entirely user-level, not tied to whatever media is currently open.
 * SimilarMedia.jsx was not touched to build this.
 *
 * A brand-new/inactive user's list is [] — renders nothing, no popular/
 * random/global fallback row.
 *
 * FIX: the backend only regenerates when its saved state is missing/forced/
 * >30min stale (recommendationEngine.js REFRESH_STALE_MS) — it does NOT
 * regenerate just because you favourited/watchlisted something 2 minutes
 * ago. Without this, a genuinely-empty-but-now-stale cache would sit
 * invisible for up to 30 minutes with zero way to tell "empty because no
 * activity yet" apart from "empty because it hasn't re-checked". This
 * fires ONE forced refresh (guarded by the ref, never loops) the first time
 * the list comes back empty, so newly-added signals take effect immediately
 * instead of silently waiting out the stale window.
 */
export default function Recommendations() {
    const { data: recommendations = [], isLoading, isFetched } = useRecommendations();
    const refreshMut = useRefreshRecommendations();
    const triedRefresh = useRef(false);

    useEffect(() => {
        if (isFetched && !isLoading && recommendations.length === 0 && !triedRefresh.current && !refreshMut.isPending) {
            triedRefresh.current = true;
            refreshMut.mutate();
        }
    }, [isFetched, isLoading, recommendations.length, refreshMut]);

    if ((isLoading && !isFetched) || !recommendations.length) return null;

    return (
        <MediaRow
            title="Recommended for You"
            items={recommendations}
            viewAllTo="/recommendations"
            onPlay={(raw) => {
                if (raw?.streamUrl) window.location.href = raw.streamUrl;
            }}
        />
    );
}
