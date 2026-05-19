import { useState, useMemo } from "react";
import { Film, ChevronDown } from "lucide-react";
import { useApi } from "../../../Context/apiContext";
import MediaCard from "../../../Components/MediaCard";

export default function Movies() {
    const { movies, loading, errors } = useApi();
    const [activeGenre, setActiveGenre] = useState("All");

    // Collect unique genres from all movies
    const genres = useMemo(() => {
        const set = new Set();
        movies.forEach((m) => (m.metadata?.genres ?? []).forEach((g) => set.add(g)));
        return ["All", ...Array.from(set).sort()];
    }, [movies]);

    const filtered = useMemo(() => {
        if (activeGenre === "All") return movies;
        return movies.filter((m) => m.metadata?.genres?.includes(activeGenre));
    }, [movies, activeGenre]);

    // ── Loading skeleton ──────────────────────────────────────────────────────
    if (loading.media) {
        return (
            <div className="space-y-6">
                <div className="h-8 w-48 bg-base-300 rounded-lg animate-pulse" />
                <div className="flex gap-2 flex-wrap">
                    {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="h-8 w-20 bg-base-300 rounded-full animate-pulse" />
                    ))}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                    {Array.from({ length: 12 }).map((_, i) => (
                        <div key={i} className="aspect-2/3 rounded-xl bg-base-300 animate-pulse" />
                    ))}
                </div>
            </div>
        );
    }

    if (errors.media) {
        return <p className="text-error py-8 text-sm">Failed to load movies: {errors.media}</p>;
    }

    return (
        <div className="space-y-6">
            {/* ── Header ── */}
            <div className="flex items-end justify-between">
                <div className="flex items-center gap-3">
                    <Film size={22} className="text-primary" />
                    <h1 className="text-2xl sm:text-3xl font-bold text-base-content font-circular">Movies</h1>
                    <span className="text-xs text-base-content/35 bg-base-300 px-2 py-0.5 rounded-full font-medium">{filtered.length}</span>
                </div>
            </div>

            {/* ── Genre filter pills ── */}
            {genres.length > 1 && (
                <div className="flex gap-2 flex-wrap">
                    {genres.map((g) => (
                        <button
                            key={g}
                            onClick={() => setActiveGenre(g)}
                            className={[
                                "px-3 py-1 rounded-full text-xs font-medium border transition-all duration-150 cursor-pointer",
                                activeGenre === g ? "bg-primary text-primary-content border-primary" : "bg-base-300/40 text-base-content/60 border-base-300 hover:bg-base-300 hover:text-base-content",
                            ].join(" ")}>
                            {g}
                        </button>
                    ))}
                </div>
            )}

            {/* ── Grid ── */}
            {filtered.length === 0 ? (
                <div className="py-20 text-center text-base-content/30 text-sm">No movies in &ldquo;{activeGenre}&rdquo;</div>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-4 gap-y-6">
                    {filtered.map((item) => (
                        <MediaCard key={item.id} item={item} />
                    ))}
                </div>
            )}
        </div>
    );
}
