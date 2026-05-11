import { createContext, useContext, useState, useEffect, useCallback } from "react";
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

    async function run(key, fn) {
        setLoading(key, true);
        setError(key, null);
        try {
            return await fn();
        } catch (err) {
            setError(key, err);
            throw err;
        } finally {
            setLoading(key, false);
        }
    }

    // ─── Media ────────────────────────────────────────────────────────────────
    // media = { movies: [], series: [], anime: [] }   (whatever backend returns)
    const [media, setMedia] = useState([]);
    const [movies, setMovies] = useState([]);
    const [series, setSeries] = useState([]);
    const [anime, setAnime] = useState([]);
    const [searchResults, setSearchResults] = useState([]);

    const fetchMedia = useCallback(
        (params) =>
            run("media", async () => {
                const data = await getMedia(params);
                // backend returns grouped object — flatten or keep based on your API shape
                setMedia(data);
                setMovies(data?.movies ?? []);
                setSeries(data?.series ?? []);
                setAnime(data?.anime ?? []);
                return data;
            }),
        [],
    );

    const search = useCallback(
        (q, folderId) =>
            run("search", async () => {
                const data = await searchMedia(q, folderId);
                setSearchResults(data?.results ?? data ?? []);
                return data;
            }),
        [],
    );

    // ─── Library / Folders ────────────────────────────────────────────────────
    const [folders, setFolders] = useState([]);

    const fetchFolders = useCallback(
        () =>
            run("folders", async () => {
                const data = await getFolders();
                setFolders(data?.folders ?? []);
            }),
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
    const [categories, setCategories] = useState([]);
    const [categoryMedia, setCategoryMedia] = useState([]);
    const [activeCategory, setActiveCategory] = useState(null);

    const fetchCategories = useCallback(
        () =>
            run("categories", async () => {
                const data = await getCategories();
                setCategories(data?.categories ?? []);
            }),
        [],
    );

    const fetchByCategory = useCallback(
        (name, type) =>
            run("categoryMedia", async () => {
                const data = await getByCategory(name, type);
                setCategoryMedia(data?.results ?? data ?? []);
                setActiveCategory(name);
            }),
        [],
    );

    // ─── History ──────────────────────────────────────────────────────────────
    const [history, setHistory] = useState([]);

    const fetchHistory = useCallback(
        () =>
            run("history", async () => {
                const data = await getHistory();
                setHistory(data?.history ?? []);
            }),
        [],
    );

    // fires silently while video is playing — no loading state needed
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
        () =>
            run("watchlist", async () => {
                const data = await getWatchlist();
                setWatchlist(data?.watchlist ?? []);
            }),
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
        () =>
            run("favourites", async () => {
                const data = await getFavourites();
                setFavourites(data?.favourites ?? []);
            }),
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

    // ─── Metadata ────────────────────────────────────────────────────────────
    const refreshOneMetadata = useCallback((id) => run("refreshMetadata", () => refreshMetadata(id)), []);

    const refreshAll = useCallback(() => run("refreshAllMetadata", () => refreshAllMetadata()), []);

    // ─── Helpers ─────────────────────────────────────────────────────────────
    const isInWatchlist = (id) => watchlist.some((w) => w.id === id);
    const isFavourite = (id) => favourites.some((f) => f.id === id);
    const getStreamUrl = (id) => api.streamUrl(id);
    const getSubtitleUrl = (encoded) => api.subtitleUrl(encoded);

    const toggleWatchlist = (id, data) => (isInWatchlist(id) ? removeWatchlistItem(id) : addWatchlistItem(id, data));

    const toggleFavourite = (id, data) => (isFavourite(id) ? removeFavouriteItem(id) : addFavouriteItem(id, data));

    // ─── Auto-fetch on mount ──────────────────────────────────────────────────
    useEffect(() => {
        fetchMedia();
        fetchFolders();
        fetchCategories();
        fetchHistory();
        fetchWatchlist();
        fetchFavourites();
    }, []);

    // ─── Context value ────────────────────────────────────────────────────────
    const value = {
        // ── data — use these directly, e.g. movies.map(...)
        media, // full grouped response from backend
        movies, // data.movies array
        series, // data.series array
        anime, // data.anime array
        searchResults, // flat array
        folders, // array of library folders
        categories, // array of category objects
        categoryMedia, // array — result of fetchByCategory()
        activeCategory, // string — currently selected category name
        history, // watch history array
        watchlist, // watchlist array
        favourites, // favourites array

        // ── status
        loading, // { media: bool, folders: bool, ... }
        errors, // { media: "msg" | null, ... }

        // ── media actions
        fetchMedia,
        search,

        // ── library actions
        fetchFolders,
        addLibraryFolder,
        updateLibraryFolder,
        removeLibraryFolder,

        // ── category actions
        fetchCategories,
        fetchByCategory,

        // ── history actions
        fetchHistory,
        logProgress,
        getResume,
        removeHistoryItem,
        clearAllHistory,

        // ── watchlist actions
        fetchWatchlist,
        addWatchlistItem,
        removeWatchlistItem,

        // ── favourite actions
        fetchFavourites,
        addFavouriteItem,
        removeFavouriteItem,

        // ── helpers
        isInWatchlist,
        isFavourite,
        toggleWatchlist,
        toggleFavourite,
        getStreamUrl,
        getSubtitleUrl,

        // ── metadata actions
        refreshOneMetadata,
        refreshAll,
    };

    return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi() {
    const ctx = useContext(ApiContext);
    if (!ctx) throw new Error("useApi must be used inside <ApiProvider>");
    return ctx;
}
