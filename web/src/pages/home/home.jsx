import React, { useMemo } from "react";
import { useNavigate } from "react-router";
import { useApi } from "../../Context/apiContext";
import CategoryBar from "../../Components/Category/CategoryBar";
import { HomeMediaSections } from "./HomeMediaSections";
import LiveMediaRow from "../../Components/Live/LiveMediaRow";
import ContinueWatchingRow from "../../Components/Media/ContinueWatchingRow";
import Recommendations from "../../Components/Media/Recommendations";
import SmartShelves from "../../Components/Media/SmartShelves";
import { PopularReviews } from "../../Components/Media/Reviews";
import PopularDiscussions from "../../Components/Media/PopularDiscussions";
import TrailerRow from "../../Components/Trailers/TrailerRow";
import { useTrailers } from "../../Hooks/Query/useTrailers";
import { HomeHeroBanner, SeasonalBanner } from "../../Components/Layout/Banner";

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
            <HomeHeroBanner />

            <ContinueWatchingRow />

            <CategoryBar onSelect={(cat) => (cat ? fetchByCategory(cat) : null)} />

            <LiveMediaRow />

            <TrailerRow title="Trending Trailers" items={discoverTrailers} loading={trailersLoading} />

            <HomeMediaSections movieItems={movieItems} seriesItems={seriesItems} animeItems={animeItems} onPlay={handlePlay} onWatchTrailer={handleTrailer} loading={isLoading} />

            {/* Seasonal banner — hides itself when no season is active (see Banner.jsx BANNER 7) */}
            <SeasonalBanner />

            {/* Smart shelves #1 — taste-based, built from your history + library metadata */}
            <SmartShelves variant="for-you" onPlay={handlePlay} onWatchTrailer={handleTrailer} />

            <Recommendations />

            {/* Smart shelves #2 — discovery rules (hidden gems, quick watch, decades…) */}
            <SmartShelves variant="discover" onPlay={handlePlay} onWatchTrailer={handleTrailer} />

            <TrailerRow title="New Trailers" items={newTrailers} loading={trailersLoading} />

            {/* Plex-style community rows — each fetches its own cached feed and hides itself when empty */}
            <PopularReviews />

            <PopularDiscussions />
        </div>
    );
};

export default Home;
