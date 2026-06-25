import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { ChevronRight, List } from "lucide-react";
import LiveCard from "./LiveCard";
import { getLiveChannels } from "../api/live";
import { useAuth } from "../auth/useAuth";

// ─── Skeleton — sized to match LiveCard ─────────────────────────────────────
function LiveCardSkeleton() {
    return (
        <div className="shrink-0 w-56 sm:w-64">
            <div className="aspect-video rounded-xl bg-base-300 animate-pulse" />
            <div className="h-3.5 w-3/4 rounded bg-base-300 animate-pulse mt-2" />
            <div className="h-3 w-1/3 rounded bg-base-300 animate-pulse mt-1.5" />
        </div>
    );
}

// ─── "All Channels" button card ───────────────────────────────────────────────
function AllChannelsCard({ count }) {
    return (
        <Link to="/live" className="group shrink-0 w-56 sm:w-64 cursor-pointer select-none no-underline">
            <div
                className="relative aspect-video rounded-xl overflow-hidden
                           bg-linear-to-br from-primary via-primary/80 to-secondary
                           ring-1 ring-white/10 shadow-lg
                           flex flex-col items-center justify-center gap-2
                           transition-transform duration-200
                           group-hover:scale-[1.03] active:scale-[0.97]">
                <div className="absolute w-24 h-24 rounded-full bg-white/15 blur-md -bottom-10 -right-8" />
                <div className="absolute w-14 h-14 rounded-full bg-black/10 blur-sm -top-6 -left-6" />
                <span className="relative z-1 w-10 h-10 rounded-full bg-white/15 backdrop-blur-sm ring-1 ring-white/25 flex items-center justify-center">
                    <List size={18} className="text-primary-content" />
                </span>
                <span className="relative z-1 text-primary-content text-xs font-semibold uppercase tracking-wider">All Channels</span>
            </div>
            <div className="mt-2 px-0.5">
                <p className="text-[13px] font-medium text-base-content truncate leading-tight">All Channels</p>
                <p className="text-[11px] text-base-content/45 font-medium mt-1">{count} channels</p>
            </div>
        </Link>
    );
}

// ─── Row ─────────────────────────────────────────────────────────────────────
const ROW_LIMIT = 12;

export default function LiveMediaRow() {
    const { isAuthenticated, isApproved, loading: authLoading } = useAuth();
    const enabled = !authLoading && isAuthenticated && isApproved;

    // Backend used to ignore `limit` entirely and return all 2700+ channels
    // for this 12-card row — now it's a real paginated call, and react-query
    // caches it for a minute so navigating Home → Live → Home doesn't
    // redownload it every time.
    const {
        data,
        isLoading: loading,
        error,
    } = useQuery({
        queryKey: ["live", "channels", { page: 1, limit: ROW_LIMIT, row: "home" }],
        queryFn: () => getLiveChannels({ page: 1, limit: ROW_LIMIT }),
        enabled,
        staleTime: 60 * 1000,
    });

    const items = data?.channels ?? [];
    const total = data?.total ?? 0;

    // Hide while auth loading, not authed, or not approved
    if (authLoading || !isAuthenticated || !isApproved) return null;
    if (!loading && !error && items.length === 0) return null;

    return (
        <section>
            <Link to="/live" className="flex items-center gap-1.5 mb-0.5 no-underline">
                <h2 className="text-base sm:text-lg font-semibold text-base-content">What's On Now</h2>
                <ChevronRight size={18} className="text-base-content/60" />
            </Link>
            <p className="text-xs text-base-content/45 mb-3">Live TV</p>

            {error ? (
                <p className="text-sm text-error">Failed to load live channels: {error.message}</p>
            ) : (
                <div className="flex items-start gap-3 overflow-x-auto overflow-y-visible pb-3 pt-2 -mx-1 px-1 min-h-48 sm:min-h-52" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                    {loading ? (
                        <>
                            <div className="shrink-0 w-56 sm:w-64">
                                <div className="aspect-video rounded-xl bg-base-300 animate-pulse" />
                                <div className="h-3.5 w-2/3 rounded bg-base-300 animate-pulse mt-2" />
                                <div className="h-3 w-1/3 rounded bg-base-300 animate-pulse mt-1.5" />
                            </div>
                            {Array.from({ length: 5 }).map((_, i) => (
                                <LiveCardSkeleton key={i} />
                            ))}
                        </>
                    ) : (
                        <>
                            <AllChannelsCard count={total} />
                            {items.map((item, i) => (
                                <LiveCard key={item.id ?? item.url ?? i} item={item} />
                            ))}
                        </>
                    )}
                </div>
            )}
        </section>
    );
}
