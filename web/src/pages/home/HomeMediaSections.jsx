import React from "react";
import MediaRow from "../../Components/MediaRow";

export const HomeMediaSections = ({ movieItems, seriesItems, animeItems, onPlay, onWatchTrailer }) => {
    return (
        <div className="space-y-15">
            <div>{movieItems.length > 0 && <MediaRow title="Movies" items={movieItems} onPlay={onPlay} onWatchTrailer={onWatchTrailer} viewAllTo="/movies" />}</div>
            <div>{seriesItems.length > 0 && <MediaRow title="Series" items={seriesItems} onPlay={onPlay} onWatchTrailer={onWatchTrailer} viewAllTo="/series" />}</div>
            <div>{animeItems.length > 0 && <MediaRow title="Anime" items={animeItems} onPlay={onPlay} onWatchTrailer={onWatchTrailer} />}</div>
        </div>
    );
};
