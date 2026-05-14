import { useMemo } from "react";
import { useApi } from "../Context/apiContext";
import MediaRow from "./MediaRow";

export default function SimilarMedia({ currentId, genres = [], mediaType = "movie", limit = 24 }) {
    const { movies, series, anime } = useApi();

    const similar = useMemo(() => {
        let pool;
        if (mediaType === "anime") pool = anime;
        else if (mediaType === "series") pool = series;
        else pool = movies;

        if (!pool?.length || !genres.length) return [];

        const genreSet = new Set(genres.map((g) => g.toLowerCase()));

        return pool
            .filter((item) => {
                if (item.id === currentId) return false;
                const itemGenres = (item.metadata?.genres || item.category || []).map((g) => g.toLowerCase());
                return itemGenres.some((g) => genreSet.has(g));
            })
            .sort((a, b) => {
                const aGenres = (a.metadata?.genres || a.category || []).map((g) => g.toLowerCase());
                const bGenres = (b.metadata?.genres || b.category || []).map((g) => g.toLowerCase());
                const aMatches = aGenres.filter((g) => genreSet.has(g)).length;
                const bMatches = bGenres.filter((g) => genreSet.has(g)).length;
                if (bMatches !== aMatches) return bMatches - aMatches;
                return (b.metadata?.rating ?? 0) - (a.metadata?.rating ?? 0);
            })
            .slice(0, limit);
    }, [movies, series, anime, currentId, genres, mediaType, limit]);

    const label = mediaType === "anime" ? "Similar Anime" : mediaType === "series" ? "Similar Series" : "Similar Movies";

    return (
        <MediaRow
            title={label}
            items={similar}
            onPlay={(raw) => {
                if (raw?.streamUrl) window.location.href = raw.streamUrl;
            }}
        />
    );
}
