import React, { useMemo } from "react";
import { useApi } from "../../Context/apiContext";
import MediaRow from "../../Components/MediaRow";

const WatchList = () => {
    const { watchlist, movies: allMovies, series: allSeries } = useApi();

    const { movies, series } = useMemo(() => {
        const m = [];
        const s = [];
        if (!watchlist) return { movies: m, series: s };

        watchlist.forEach((wItem) => {
            if (wItem.type === "movie") {
                const fullItem = allMovies?.find((x) => x.id === wItem.id);
                m.push(fullItem ? { ...fullItem, addedAt: wItem.addedAt } : wItem);
            } else if (wItem.type === "series") {
                const fullItem = allSeries?.find((x) => x.id === wItem.id);
                s.push(fullItem ? { ...fullItem, addedAt: wItem.addedAt } : wItem);
            }
        });
        return { movies: m, series: s };
    }, [watchlist, allMovies, allSeries]);

    return (
        <div className="space-y-10">
            <div>
                <h1 className="text-3xl sm:text-4xl font-bold text-white leading-tight capitalize font-circular">Watchlist</h1>
            </div>

            {!watchlist || watchlist.length === 0 ? (
                <div className="text-base-content/60">No items in your watchlist</div>
            ) : (
                <>
                    <MediaRow title="Movies" items={movies} />
                    <MediaRow title="Series" items={series} />
                </>
            )}
        </div>
    );
};

export default WatchList;
