import React from "react";
import { useNavigate } from "react-router";
import { useApi } from "../../Context/apiContext";
import CategoryBar from "../../Components/CategoryBar";
import { HomeMediaSections } from "./HomeMediaSections";

const Home = () => {
    const navigate = useNavigate();
    const { movies, series, anime, history, loading, fetchByCategory } = useApi();

    const movieItems = movies?.items ?? movies ?? [];
    const seriesItems = series?.items ?? series ?? [];
    const animeItems = anime?.items ?? anime ?? [];

    const hasData = movieItems.length > 0 || seriesItems.length > 0 || animeItems.length > 0;
    const isLoading = loading.media && !hasData;

    const handlePlay = (rawItem) => {
        if (rawItem?.id) navigate(`/player/${encodeURIComponent(rawItem.id)}`);
    };

    const handleTrailer = (normItem) => {
        const key = normItem.raw?.metadata?.trailer;
        if (key) window.open(`https://www.youtube.com/watch?v=${key}`, "_blank");
    };

    return (
        <div className="flex flex-col gap-4">
            <CategoryBar onSelect={(cat) => (cat ? fetchByCategory(cat) : null)} />

            {/* Continue Watching row — only renders if history exists */}

            <HomeMediaSections movieItems={movieItems} seriesItems={seriesItems} animeItems={animeItems} onPlay={handlePlay} onWatchTrailer={handleTrailer} loading={isLoading} />
        </div>
    );
};

export default Home;
