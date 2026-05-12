import { useEffect } from "react";
import { useParams } from "react-router";
import { useApi } from "../../Context/apiContext";
import MediaRow from "../../Components/MediaRow";

const CategoryPage = () => {
    const { name } = useParams();
    const { categoryData, categoryMovies, categorySeries, categoryAnime, fetchByCategory, loading, errors } = useApi();

    const decodedName = decodeURIComponent(name);

    // Fetch whenever the category name in the URL changes
    useEffect(() => {
        fetchByCategory(decodedName);
    }, [decodedName]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Skeleton ──────────────────────────────────────────────────────────────
    if (loading.categoryMedia) {
        return (
            <div className="py-6 space-y-8">
                {/* Header skeleton */}
                <div>
                    <div className="h-7 w-72 rounded-lg bg-base-300 animate-pulse mb-2" />
                    <div className="h-4 w-full max-w-xl rounded bg-base-300 animate-pulse mb-1" />
                    <div className="h-4 w-2/3 max-w-md rounded bg-base-300 animate-pulse" />
                </div>

                {/* Row skeletons */}
                {[1, 2].map((r) => (
                    <div key={r}>
                        <div className="h-5 w-32 rounded bg-base-300 animate-pulse mb-3" />
                        <div className="flex gap-3 overflow-hidden">
                            {Array.from({ length: 6 }).map((_, i) => (
                                <div key={i} className="shrink-0 w-32.5 sm:w-37 aspect-2/3 rounded-xl bg-base-300 animate-pulse" />
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    // ── Error ─────────────────────────────────────────────────────────────────
    if (errors.categoryMedia) {
        return <div className="py-8 text-error text-sm">Failed to load: {errors.categoryMedia}</div>;
    }

    const totalCount = categoryMovies.length + categorySeries.length + categoryAnime.length;

    return (
        <div className=" space-y-10">
            {/* ── Page header ──────────────────────────────────────────────── */}
            <div>
                <h1 className="text-3xl sm:text-4xl font-bold text-white leading-tight capitalize font-circular">{categoryData?.title ?? decodedName}</h1>

                {categoryData?.subtitle && <p className="text-lg text-white mt-1.5 max-w-2xl leading-relaxed">{categoryData.subtitle}</p>}

                {totalCount > 0 && (
                    <p className="text-xs text-base-content/35 mt-2">
                        {totalCount} title{totalCount !== 1 ? "s" : ""}
                    </p>
                )}
            </div>

            {/* ── Empty state ──────────────────────────────────────────────── */}
            {totalCount === 0 && <p className="text-base-content/40 text-sm">No media found for &ldquo;{decodedName}&rdquo;.</p>}

            {/*
             * Each MediaRow receives the already-split slice directly from
             * the context — no extra transformation needed here.
             *
             * MediaRow already handles empty arrays (returns null), so
             * sections with no content are hidden automatically.
             */}
            <MediaRow title="Movies" items={categoryMovies} />
            <MediaRow title="TV Shows" items={categorySeries} />
            <MediaRow title="Anime" items={categoryAnime} />
        </div>
    );
};

export default CategoryPage;
