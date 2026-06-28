import { useRef } from "react";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router";
import { useHistory } from "../Hooks/useHistory";
import HistoryCard from "./HistoryCard";

/**
 * ContinueWatchingRow — "Continue Watching" section, same scroll-row pattern
 * as MediaRow. Pulls live data via useHistory() (GET /api/history), renders
 * nothing if empty/loading/errored — drop it straight into Home.jsx.
 */
export default function ContinueWatchingRow() {
    const { data: history = [], isLoading } = useHistory();
    const rowRef = useRef(null);

    if (isLoading || !history.length) return null;

    return (
        <section className="relative">
            <Link to="/history" className="group flex items-center gap-2 mb-3 w-fit">
                <h2 className="text-base sm:text-lg font-semibold text-base-content group-hover:text-primary transition-colors">Continue Watching</h2>
                <span className="text-xs text-base-content/35 font-medium bg-base-300 px-2 py-0.5 rounded-full">{history.length}</span>
                <ChevronRight size={16} className="text-base-content/40 group-hover:text-primary transition-colors" />
            </Link>

            <div ref={rowRef} className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                {history.map((item) => (
                    <HistoryCard key={item.id} item={item} />
                ))}
            </div>
        </section>
    );
}
