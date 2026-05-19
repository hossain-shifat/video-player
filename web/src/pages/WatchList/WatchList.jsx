import React from "react";
import { useApi } from "../../Context/apiContext";
import MediaRow from "../../Components/MediaRow";

const WatchList = () => {
    const { watchlist } = useApi();

    const movies = watchlist?.filter((item) => item.type === "movie") || [];
    const series = watchlist?.filter((item) => item.type === "series") || [];

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
