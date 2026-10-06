import React, { useMemo } from "react";
import { useNavigate } from "react-router";
import { useApi } from "../../Context/apiContext";
import CategoryBar from "../../Components/CategoryBar";
import { HomeMediaSections } from "./HomeMediaSections";
import LiveMediaRow from "../../Components/LiveMediaRow";
import ContinueWatchingRow from "../../Components/ContinueWatchingRow";
import Recommendations from "../../Components/Recommendations";
import TrailerRow from "../../Components/TrailerRow";
import { useTrailers } from "../../Hooks/useTrailers";

const Home = () => {
    const navigate = useNavigate();
    const { movies, series, anime, history, loading, fetchByCategory } = useApi();
    const { discoverTrailers, loading: trailersLoading } = useTrailers();

    const movieItems = movies?.items ?? movies ?? [];
    const seriesItems = series?.items ?? series ?? [];
    const animeItems = anime?.items ?? anime ?? [];

    const hasData = movieItems.length > 0 || seriesItems.length > 0 || animeItems.length > 0;
    const isLoading = loading.media && !hasData;

    // Same discover feed, two orderings — Plex shows both rows over one
    // dataset. discoverTrailers already arrives views/popularity-sorted from
    // the backend (that IS "Trending"); "New" re-sorts by when the trailer
    // itself was published on YouTube, falling back to release date.
    const newTrailers = useMemo(
        () => [...discoverTrailers].sort((a, b) => new Date(b.trailerPublishedAt || b.releaseDate || 0) - new Date(a.trailerPublishedAt || a.releaseDate || 0)),
        [discoverTrailers],
    );

    const handlePlay = (rawItem) => {
        if (rawItem?.id) navigate(`/player/${encodeURIComponent(rawItem.id)}`);
    };

    const handleTrailer = (normItem) => {
        const key = normItem.raw?.metadata?.trailer;
        if (key) window.open(`https://www.youtube.com/watch?v=${key}`, "_blank");
    };

    return (
        <div className="flex flex-col gap-5">
            <ContinueWatchingRow />

            <CategoryBar onSelect={(cat) => (cat ? fetchByCategory(cat) : null)} />

            <LiveMediaRow />

            <HomeMediaSections movieItems={movieItems} seriesItems={seriesItems} animeItems={animeItems} onPlay={handlePlay} onWatchTrailer={handleTrailer} loading={isLoading} />

            <Recommendations />

            <TrailerRow title="Trending Trailers" items={discoverTrailers} loading={trailersLoading} />

            <TrailerRow title="New Trailers" items={newTrailers} loading={trailersLoading} />
        </div>
    );
};

export default Home;
