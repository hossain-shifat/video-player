import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from "react";
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

    // FIX 1 (partial): run() now accepts an optional AbortSignal so callers
    // can cancel in-flight requests before they update state.
    async function run(key, fn, signal) {
        setLoading(key, true);
        setError(key, null);
        try {
            const result = await fn(signal);
            // If the request was aborted after resolution, discard the result
            // silently so we don't update state with stale data.
            if (signal?.aborted) return;
            return result;
        } catch (err) {
            // DOMException name "AbortError" means we cancelled intentionally —
            // swallow it so no error state is written for a clean unmount/remount.
            if (err?.name === "AbortError" || signal?.aborted) return;
            setError(key, err);
            throw err;
        } finally {
            if (!signal?.aborted) setLoading(key, false);
        }
    }

    // ─── Media ────────────────────────────────────────────────────────────────
    const [media, setMedia] = useState([]);
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
                    setMedia(data);
                    setMovies(data?.movies ?? []);
                    setSeries(data?.series ?? []);
                    setAnime(data?.anime ?? []);
                    return data;
                },
                signal,
            ),
        // run/setters are stable (defined in render scope) — no deps needed
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
    const [categories, setCategories] = useState([]);
    const [categoryMedia, setCategoryMedia] = useState([]);
    const [activeCategory, setActiveCategory] = useState(null);

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

    // ─── Metadata ────────────────────────────────────────────────────────────
    const refreshOneMetadata = useCallback((id) => run("refreshMetadata", () => refreshMetadata(id)), []);

    const refreshAll = useCallback(() => run("refreshAllMetadata", () => refreshAllMetadata()), []);

    // ─── Stable helpers (FIX 1: useCallback so identity is stable) ───────────
    const isInWatchlist = useCallback((id) => watchlist.some((w) => w.id === id), [watchlist]);

    const isFavourite = useCallback((id) => favourites.some((f) => f.id === id), [favourites]);

    const getStreamUrl = useCallback((id) => api.streamUrl(id), []);

    const getSubtitleUrl = useCallback((encoded) => api.subtitleUrl(encoded), []);

    const toggleWatchlist = useCallback((id, data) => (isInWatchlist(id) ? removeWatchlistItem(id) : addWatchlistItem(id, data)), [isInWatchlist, removeWatchlistItem, addWatchlistItem]);

    const toggleFavourite = useCallback((id, data) => (isFavourite(id) ? removeFavouriteItem(id) : addFavouriteItem(id, data)), [isFavourite, removeFavouriteItem, addFavouriteItem]);

    // ─── FIX 2: Auto-fetch with AbortController cleanup ──────────────────────
    // Each fetch function is stable (useCallback + [] deps), so listing them
    // here satisfies the exhaustive-deps rule without causing extra re-runs.
    useEffect(() => {
        const controller = new AbortController();
        const { signal } = controller;

        fetchMedia(undefined, signal);
        fetchFolders(signal);
        fetchCategories(signal);
        fetchHistory(signal);
        fetchWatchlist(signal);
        fetchFavourites(signal);

        // Abort all in-flight requests when the component unmounts or when
        // React StrictMode double-invokes the effect in development.
        return () => controller.abort();
    }, [fetchMedia, fetchFolders, fetchCategories, fetchHistory, fetchWatchlist, fetchFavourites]);

    // ─── FIX 1: Memoised context value ───────────────────────────────────────
    // Recreated only when the listed state slices or stable action refs change.
    const value = useMemo(
        () => ({
            // ── data
            media,
            movies,
            series,
            anime,
            searchResults,
            folders,
            categories,
            categoryMedia,
            activeCategory,
            history,
            watchlist,
            favourites,

            // ── status
            loading,
            errors,

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
        }),
        [
            // state
            media,
            movies,
            series,
            anime,
            searchResults,
            folders,
            categories,
            categoryMedia,
            activeCategory,
            history,
            watchlist,
            favourites,
            loading,
            errors,
            // stable action refs (useCallback [] — only listed so ESLint is happy;
            // their identities never change after mount)
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
