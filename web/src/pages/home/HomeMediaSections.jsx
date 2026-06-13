import React from "react";
import MediaRow from "../../Components/MediaRow";

export const HomeMediaSections = ({ movieItems, seriesItems, animeItems, onPlay, onWatchTrailer, loading = false }) => {
    return (
        <div className="space-y-5">
            <MediaRow title="Movies" items={movieItems} loading={loading} onPlay={onPlay} onWatchTrailer={onWatchTrailer} viewAllTo="/movies" />
            <MediaRow title="Series" items={seriesItems} loading={loading} onPlay={onPlay} onWatchTrailer={onWatchTrailer} viewAllTo="/series" />
            <MediaRow title="Anime" items={animeItems} loading={loading} onPlay={onPlay} onWatchTrailer={onWatchTrailer} />
        </div>
    );
};
