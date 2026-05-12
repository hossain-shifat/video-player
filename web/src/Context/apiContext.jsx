import { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import {
    getMedia,
    searchMedia,
    getFolders,
    addFolder,
    updateFolder,
    removeFolder,
    getCategories,
    getByCategory,
    getHistory,
    getResumePoint,
    saveProgress,
    deleteHistory,
    clearHistory,
    getWatchlist,
    addToWatchlist,
    removeFromWatchlist,
    getFavourites,
    addToFavourites,
    removeFromFavourites,
    refreshMetadata,
    refreshAllMetadata,
    api,
} from "../api";

const ApiContext = createContext(null);

export function ApiProvider({ children }) {
    // ─── Loading & Error ──────────────────────────────────────────────────────
    const [loading, setLoadingMap] = useState({});
    const [errors, setErrorMap] = useState({});

    function setLoading(key, val) {
        setLoadingMap((p) => ({ ...p, [key]: val }));
    }
    function setError(key, err) {
        setErrorMap((p) => ({ ...p, [key]: err?.message ?? null }));
    }

    async function run(key, fn, signal) {
        setLoading(key, true);
        setError(key, null);
        try {
            const result = await fn(signal);
            if (signal?.aborted) return;
            return result;
        } catch (err) {
            if (err?.name === "AbortError" || signal?.aborted) return;
            setError(key, err);
            throw err;
        } finally {
            if (!signal?.aborted) setLoading(key, false);
        }
    }

    // ─── Media ────────────────────────────────────────────────────────────────
    // Server response shape:
    // { folders, movies: { total, items }, series: { total, items }, anime: { total, items }, unknown: { total, items } }
    const [movies, setMovies] = useState([]);
    const [series, setSeries] = useState([]);
    const [anime, setAnime] = useState([]);
    const [searchResults, setSearchResults] = useState([]);

    const fetchMedia = useCallback(
        (params, signal) =>
            run(
                "media",
                async (sig) => {
                    const data = await getMedia(params, sig);
                    setMovies(data?.movies?.items ?? []);
                    setSeries(data?.series?.items ?? []);
                    setAnime(data?.anime?.items ?? []);
                    return data;
                },
                signal,
            ),
        [],
    );

    const search = useCallback(
        (q, folderId) =>
            run("search", async () => {
                const data = await searchMedia(q, folderId);
                // server returns { total, results: [] }
                setSearchResults(data?.results ?? []);
                return data;
            }),
        [],
    );

    // ─── Library / Folders ────────────────────────────────────────────────────
    const [folders, setFolders] = useState([]);

    const fetchFolders = useCallback(
        (signal) =>
            run(
                "folders",
                async (sig) => {
                    const data = await getFolders(sig);
                    setFolders(data?.folders ?? []);
                },
                signal,
            ),
        [],
    );

    const addLibraryFolder = useCallback(
        (path, label) =>
            run("addFolder", async () => {
                const data = await addFolder(path, label);
                setFolders((p) => [...p, data.folder]);
            }),
        [],
    );

    const updateLibraryFolder = useCallback(
        (id, updates) =>
            run("updateFolder", async () => {
                const data = await updateFolder(id, updates);
                setFolders((p) => p.map((f) => (f.id === id ? data.folder : f)));
            }),
        [],
    );

    const removeLibraryFolder = useCallback(
        (id) =>
            run("removeFolder", async () => {
                await removeFolder(id);
                setFolders((p) => p.filter((f) => f.id !== id));
            }),
        [],
    );

    // ─── Categories ───────────────────────────────────────────────────────────
    // GET /api/categories
    //   → { total, categories: [{ name, title, subtitle, total, movies, series, anime }] }
    //
    // GET /api/categories/:name
    //   → { category, title, subtitle,
    //       movies: { total, items: [] },
    //       series: { total, items: [] },
    //       anime:  { total, items: [] } }
    const [categories, setCategories] = useState([]);
    const [categoryData, setCategoryData] = useState(null);
    const [activeCategory, setActiveCategory] = useState(null);

    // Derived flat arrays — recalculated whenever categoryData changes
    const categoryMovies = categoryData?.movies?.items ?? [];
    const categorySeries = categoryData?.series?.items ?? [];
    const categoryAnime = categoryData?.anime?.items ?? [];

    const fetchCategories = useCallback(
        (signal) =>
            run(
                "categories",
                async (sig) => {
                    const data = await getCategories(sig);
                    setCategories(data?.categories ?? []);
                },
                signal,
            ),
        [],
    );

    /**
     * fetchByCategory(name, type?)
     * Loads all media for one genre into categoryData / categoryMovies / etc.
     * The CategoryPage calls this with the :name param from the URL.
     */
    const fetchByCategory = useCallback(
        (name, type) =>
            run("categoryMedia", async () => {
                const data = await getByCategory(name, type);
                setCategoryData(data);
                setActiveCategory(name);
                return data;
            }),
        [],
    );

    // ─── History ──────────────────────────────────────────────────────────────
    const [history, setHistory] = useState([]);

    const fetchHistory = useCallback(
        (signal) =>
            run(
                "history",
                async (sig) => {
                    const data = await getHistory(sig);
                    setHistory(data?.history ?? []);
                },
                signal,
            ),
        [],
    );

    const logProgress = useCallback((id, progressData) => saveProgress(id, progressData).catch(() => {}), []);

    const getResume = useCallback((id) => getResumePoint(id), []);

    const removeHistoryItem = useCallback(
        (id) =>
            run("deleteHistory", async () => {
                await deleteHistory(id);
                setHistory((p) => p.filter((h) => h.id !== id));
            }),
        [],
    );

    const clearAllHistory = useCallback(
        () =>
            run("clearHistory", async () => {
                await clearHistory();
                setHistory([]);
            }),
        [],
    );

    // ─── Watchlist ────────────────────────────────────────────────────────────
    const [watchlist, setWatchlist] = useState([]);

    const fetchWatchlist = useCallback(
        (signal) =>
            run(
                "watchlist",
                async (sig) => {
                    const data = await getWatchlist(sig);
                    setWatchlist(data?.watchlist ?? []);
                },
                signal,
            ),
        [],
    );

    const addWatchlistItem = useCallback(
        (id, data) =>
            run("addWatchlist", async () => {
                const item = await addToWatchlist(id, data);
                setWatchlist((p) => [item, ...p]);
            }),
        [],
    );

    const removeWatchlistItem = useCallback(
        (id) =>
            run("removeWatchlist", async () => {
                await removeFromWatchlist(id);
                setWatchlist((p) => p.filter((w) => w.id !== id));
            }),
        [],
    );

    // ─── Favourites ───────────────────────────────────────────────────────────
    const [favourites, setFavourites] = useState([]);

    const fetchFavourites = useCallback(
        (signal) =>
            run(
                "favourites",
                async (sig) => {
                    const data = await getFavourites(sig);
                    setFavourites(data?.favourites ?? []);
                },
                signal,
            ),
        [],
    );

    const addFavouriteItem = useCallback(
        (id, data) =>
            run("addFavourite", async () => {
                const item = await addToFavourites(id, data);
                setFavourites((p) => [item, ...p]);
            }),
        [],
    );

    const removeFavouriteItem = useCallback(
        (id) =>
            run("removeFavourite", async () => {
                await removeFromFavourites(id);
                setFavourites((p) => p.filter((f) => f.id !== id));
            }),
        [],
    );

    // ─── Metadata ─────────────────────────────────────────────────────────────
    const refreshOneMetadata = useCallback((id) => run("refreshMetadata", () => refreshMetadata(id)), []);

    const refreshAll = useCallback(() => run("refreshAllMetadata", () => refreshAllMetadata()), []);

    // ─── Helpers ──────────────────────────────────────────────────────────────
    const isInWatchlist = useCallback((id) => watchlist.some((w) => w.id === id), [watchlist]);
    const isFavourite = useCallback((id) => favourites.some((f) => f.id === id), [favourites]);
    const getStreamUrl = useCallback((id) => api.streamUrl(id), []);
    const getSubtitleUrl = useCallback((encoded) => api.subtitleUrl(encoded), []);

    const toggleWatchlist = useCallback((id, data) => (isInWatchlist(id) ? removeWatchlistItem(id) : addWatchlistItem(id, data)), [isInWatchlist, removeWatchlistItem, addWatchlistItem]);

    const toggleFavourite = useCallback((id, data) => (isFavourite(id) ? removeFavouriteItem(id) : addFavouriteItem(id, data)), [isFavourite, removeFavouriteItem, addFavouriteItem]);

    // ─── Auto-fetch on mount ──────────────────────────────────────────────────
    useEffect(() => {
        const controller = new AbortController();
        const { signal } = controller;

        fetchMedia(undefined, signal);
        fetchFolders(signal);
        fetchCategories(signal);
        fetchHistory(signal);
        fetchWatchlist(signal);
        fetchFavourites(signal);

        return () => controller.abort();
    }, [fetchMedia, fetchFolders, fetchCategories, fetchHistory, fetchWatchlist, fetchFavourites]);

    // ─── Memoised context value ───────────────────────────────────────────────
    const value = useMemo(
        () => ({
            // ── media — use directly: movies.map(...), series.map(...)
            movies, // /api/media → movies.items
            series, // /api/media → series.items
            anime, // /api/media → anime.items
            searchResults, // /api/media/search → results

            // ── library
            folders,

            // ── categories list (for AllCategory page & CategoryBar)
            // each item: { name, title, subtitle, total, movies, series, anime }
            categories,

            // ── single category page (populated after fetchByCategory)
            categoryData, // raw full response
            categoryMovies, // categoryData.movies.items
            categorySeries, // categoryData.series.items
            categoryAnime, // categoryData.anime.items
            activeCategory, // name string of current category

            // ── user data
            history,
            watchlist,
            favourites,

            // ── status maps  e.g. loading.media, loading.categories, errors.media
            loading,
            errors,

            // ── actions
            fetchMedia,
            search,
            fetchFolders,
            addLibraryFolder,
            updateLibraryFolder,
            removeLibraryFolder,
            fetchCategories,
            fetchByCategory,
            fetchHistory,
            logProgress,
            getResume,
            removeHistoryItem,
            clearAllHistory,
            fetchWatchlist,
            addWatchlistItem,
            removeWatchlistItem,
            fetchFavourites,
            addFavouriteItem,
            removeFavouriteItem,
            isInWatchlist,
            isFavourite,
            toggleWatchlist,
            toggleFavourite,
            getStreamUrl,
            getSubtitleUrl,
            refreshOneMetadata,
            refreshAll,
        }),
        [
            movies,
            series,
            anime,
            searchResults,
            folders,
            categories,
            categoryData,
            categoryMovies,
            categorySeries,
            categoryAnime,
            activeCategory,
            history,
            watchlist,
            favourites,
            loading,
            errors,
            fetchMedia,
            search,
            fetchFolders,
            addLibraryFolder,
            updateLibraryFolder,
            removeLibraryFolder,
            fetchCategories,
            fetchByCategory,
            fetchHistory,
            logProgress,
            getResume,
            removeHistoryItem,
            clearAllHistory,
            fetchWatchlist,
            addWatchlistItem,
            removeWatchlistItem,
            fetchFavourites,
            addFavouriteItem,
            removeFavouriteItem,
            isInWatchlist,
            isFavourite,
            toggleWatchlist,
            toggleFavourite,
            getStreamUrl,
            getSubtitleUrl,
            refreshOneMetadata,
            refreshAll,
        ],
    );

    return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi() {
    const ctx = useContext(ApiContext);
    if (!ctx) throw new Error("useApi must be used inside <ApiProvider>");
    return ctx;
}
