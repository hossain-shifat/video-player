import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Search, X } from "lucide-react";
import MediaCard from "./MediaCard";

// Common "See all" view. Pure UI — the parent page owns the data.
//   title        — section heading
//   items        — MediaCard items (library items or tmdb-* upcoming items)
//   loading      — first load in progress
//   hasMore      — parent can fetch more (TMDB paging)
//   moreLoading  — parent is fetching the next page
//   onLoadMore   — () => void, called when everything already loaded is shown
//   onBack       — () => void
const PAGE = 60;

const titleOf = (it) => it.metadata?.title || it.parsed?.title || it.title || it.name || "";

export default function SeeAllPage({ title, items = [], loading = false, hasMore = false, moreLoading = false, onLoadMore, onBack, emptyText = "Nothing here yet." }) {
    const [q, setQ] = useState("");
    const [visible, setVisible] = useState(PAGE);

    useEffect(() => {
        window.scrollTo(0, 0);
    }, [title]);

    const needle = q.trim().toLowerCase();
    const filtered = useMemo(() => (needle ? items.filter((it) => titleOf(it).toLowerCase().includes(needle)) : items), [items, needle]);
    const shown = filtered.slice(0, visible);
    const canMore = !needle && (filtered.length > visible || hasMore);

    const more = () => {
        if (filtered.length > visible) setVisible((v) => v + PAGE);
        else onLoadMore?.();
    };

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">
                <button
                    type="button"
                    onClick={onBack}
                    aria-label="Back"
                    className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-base-300 text-base-content transition-colors hover:bg-base-200">
                    <ArrowLeft size={18} />
                </button>
                <div className="min-w-0 flex-1">
                    <h1 className="truncate text-xl font-bold leading-tight text-base-content sm:text-2xl">{title}</h1>
                    {!loading && (
                        <p className="text-xs text-base-content/50">
                            {needle ? `${filtered.length} of ${items.length}` : items.length}
                            {hasMore && !needle ? "+" : ""} {items.length === 1 ? "title" : "titles"}
                        </p>
                    )}
                </div>

                {!loading && items.length > 8 && (
                    <label className="flex h-9 w-full items-center gap-2 rounded-full border border-white/10 bg-base-200/70 px-3 transition-colors focus-within:border-primary/60 sm:w-64">
                        <Search size={15} className="shrink-0 text-base-content/50" />
                        <input
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                            placeholder="Filter titles…"
                            className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-base-content/35"
                        />
                        {q && (
                            <button type="button" onClick={() => setQ("")} aria-label="Clear filter" className="cursor-pointer text-base-content/50 hover:text-base-content">
                                <X size={14} />
                            </button>
                        )}
                    </label>
                )}
            </div>

            {loading && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-3">
                    {Array.from({ length: 14 }).map((_, i) => (
                        <div key={i} className="aspect-[2/3] animate-pulse rounded-xl bg-base-300" />
                    ))}
                </div>
            )}

            {!loading && shown.length === 0 && <p className="py-12 text-center text-sm text-base-content/50">{needle ? "No titles match." : emptyText}</p>}

            {shown.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-3">
                    {shown.map((item) => (
                        <MediaCard key={item.id ?? item.seriesKey ?? item.title} item={item} />
                    ))}
                </div>
            )}

            {canMore && (
                <div className="flex justify-center pt-2">
                    <button
                        type="button"
                        onClick={more}
                        disabled={moreLoading}
                        className="cursor-pointer rounded-full bg-base-300 px-6 py-2 text-xs font-semibold text-base-content transition-colors hover:bg-base-200 disabled:cursor-wait disabled:opacity-50">
                        {moreLoading ? "Loading…" : "Load more"}
                    </button>
                </div>
            )}
        </div>
    );
}
