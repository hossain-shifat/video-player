import { useRef } from "react";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router";
import { useHistory, useDeleteHistory } from "../Hooks/useHistory";
import HistoryCard from "./HistoryCard";

/**
 * ContinueWatchingRow — "Continue Watching" section.
 *
 * - Pulls live data via useHistory() (GET /api/history)
 * - Sorts descending by watchedAt on the frontend (spec §5) so the most
 *   recently touched item is always first, independent of server sort order.
 * - Wires useDeleteHistory() into each card's onRemove prop — optimistic
 *   cache update via TanStack Query so the card vanishes instantly without
 *   a refetch round-trip.
 * - Renders nothing if empty / loading / errored — safe to drop into Home.jsx.
 */
export default function ContinueWatchingRow() {
    const { data: history = [], isLoading } = useHistory();
    const { mutate: deleteItem } = useDeleteHistory();
    const rowRef = useRef(null);

    if (isLoading || !history.length) return null;

    // Sort descending by watchedAt — most recently watched always first (spec §5)
    const sorted = [...history].sort((a, b) => new Date(b.watchedAt) - new Date(a.watchedAt));

    function handleRemove(item) {
        deleteItem(item.id);
    }

    return (
        <section className="relative">
            <Link to="/history" className="group flex items-center gap-2 mb-3 w-fit">
                <h2 className="text-base sm:text-lg font-semibold text-base-content group-hover:text-primary transition-colors">Continue Watching</h2>
                <span className="text-xs text-base-content/35 font-medium bg-base-300 px-2 py-0.5 rounded-full">{history.length}</span>
                <ChevronRight size={16} className="text-base-content/40 group-hover:text-primary transition-colors" />
            </Link>

            <div ref={rowRef} className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                {sorted.map((item) => (
                    <HistoryCard key={item.id} item={item} onRemove={handleRemove} />
                ))}
            </div>
        </section>
    );
}
