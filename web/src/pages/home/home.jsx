import React from "react";
import { useApi } from "../../Context/apiContext";
import CategoryBar from "../../Components/CategoryBar";
import MediaRow from "../../Components/MediaRow";
import { HomeMediaSections } from "./HomeMediaSections";
import { useNavigate } from "react-router";

const Home = () => {
    const navigate = useNavigate();
    const { movies, series, anime, fetchByCategory } = useApi();

    const movieItems = movies?.items ?? movies ?? [];
    const seriesItems = series?.items ?? series ?? [];
    const animeItems = anime?.items ?? anime ?? [];

    const handlePlay = (rawItem) => {
        if (rawItem?.id) {
            navigate(`/player/${encodeURIComponent(rawItem.id)}`);
        }
    };

    const handleTrailer = (normItem) => {
        const key = normItem.raw?.metadata?.trailer;
        if (key) window.open(`https://www.youtube.com/watch?v=${key}`, "_blank");
    };

    return (
        <div className="flex flex-col gap-4">
            <CategoryBar onSelect={(cat) => (cat ? fetchByCategory(cat) : null)} />
            {/* TODO: Here Add History As Currently Watchig */}

            <HomeMediaSections movieItems={movieItems} seriesItems={seriesItems} animeItems={animeItems} onPlay={handlePlay} onWatchTrailer={handleTrailer} />
        </div>
    );
};

export default Home;
