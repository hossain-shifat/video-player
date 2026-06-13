// web/src/Context/apiContext.jsx
//
// Thin compatibility layer around TanStack Query hooks.
// Preserves the existing `useApi()` hook API for all consuming components.
//
// Migration strategy:
//   - Data fetching and caching now done by TanStack Query (useMedia, useLibrary, etc.)
//   - This context bridges TQ state into the existing useApi() shape
//   - No existing consumer needs to change
//   - New components can import hooks directly from src/hooks/

import { createContext, useContext, useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";

// TanStack Query hooks
import { useMedia, MEDIA_KEYS } from "../hooks/useMedia";
import { useLibrary, useAddFolder, useUpdateFolder, useRemoveFolder, LIBRARY_KEYS } from "../hooks/useLibrary";
import { useCategories, useCategoryMedia } from "../hooks/useCategories";
import { useHistory, useDeleteHistory, useClearHistory } from "../hooks/useHistory";
import { useWatchlist, useAddToWatchlist, useRemoveFromWatchlist } from "../hooks/useWatchlist";
import { useFavourites, useAddToFavourites, useRemoveFromFavourites } from "../hooks/useFavourites";

// Direct API calls (still needed for player and metadata refresh actions)
import { searchMedia, getResumePoint, saveProgress, refreshMetadata, refreshAllMetadata, api } from "../api";

const ApiContext = createContext(null);

export function ApiProvider({ children }) {
    const qc = useQueryClient();
    const { permissions } = useAuth();

    // ─── Media ────────────────────────────────────────────────────────────────
    const mediaQuery = useMedia();
    const movies = mediaQuery.data?.movies?.items ?? [];
    const series = mediaQuery.data?.series?.items ?? [];
    const anime = mediaQuery.data?.anime?.items ?? [];

    const [rawSearchResults, setRawSearchResults] = useState([]);

    // Derived — re-filters whenever permissions change without re-fetch
    const searchResults = useMemo(() => (permissions?.allowAdult === false ? rawSearchResults.filter((item) => item.permission !== false) : rawSearchResults), [rawSearchResults, permissions]);

    // ─── Library / Folders ────────────────────────────────────────────────────
    const libraryQuery = useLibrary();
    const folders = libraryQuery.data ?? [];

    const addFolderMut = useAddFolder();
    const updateFolderMut = useUpdateFolder();
    const removeFolderMut = useRemoveFolder();

    // ─── Categories ───────────────────────────────────────────────────────────
    const categoriesQuery = useCategories();
    const categories = categoriesQuery.data ?? [];

    // Active category for single-category views (CategoryPage)
    const [activeCategory, setActiveCategory] = useState(null);
    const [activeCatType, setActiveCatType] = useState(null);
    const catMediaQuery = useCategoryMedia(activeCategory, activeCatType);
    const categoryData = catMediaQuery.data ?? null;

    // ─── History ──────────────────────────────────────────────────────────────
    const historyQuery = useHistory();
    const history = historyQuery.data ?? [];
    const deleteHistMut = useDeleteHistory();
    const clearHistMut = useClearHistory();

    // ─── Watchlist ────────────────────────────────────────────────────────────
    const watchlistQuery = useWatchlist();
    const watchlist = watchlistQuery.data ?? [];
    const addWlMut = useAddToWatchlist();
    const removeWlMut = useRemoveFromWatchlist();

    // ─── Favourites ───────────────────────────────────────────────────────────
    const favouritesQuery = useFavourites();
    const favourites = favouritesQuery.data ?? [];
    const addFavMut = useAddToFavourites();
    const removeFavMut = useRemoveFromFavourites();

    // ─── Unified loading/error maps (matches old API shape) ──────────────────
    const loading = useMemo(
        () => ({
            media: mediaQuery.isLoading,
            folders: libraryQuery.isLoading,
            categories: categoriesQuery.isLoading,
            history: historyQuery.isLoading,
            watchlist: watchlistQuery.isLoading,
            favourites: favouritesQuery.isLoading,
            search: false,
            addFolder: addFolderMut.isPending,
            updateFolder: updateFolderMut.isPending,
            removeFolder: removeFolderMut.isPending,
        }),
        [
            mediaQuery.isLoading,
            libraryQuery.isLoading,
            categoriesQuery.isLoading,
            historyQuery.isLoading,
            watchlistQuery.isLoading,
            favouritesQuery.isLoading,
            addFolderMut.isPending,
            updateFolderMut.isPending,
            removeFolderMut.isPending,
        ],
    );

    const errors = useMemo(
        () => ({
            media: mediaQuery.error?.message ?? null,
            folders: libraryQuery.error?.message ?? null,
            categories: categoriesQuery.error?.message ?? null,
            history: null, // silenced
            watchlist: null, // silenced
            favourites: null, // silenced
        }),
        [mediaQuery.error, libraryQuery.error, categoriesQuery.error],
    );

    // ─── Actions ──────────────────────────────────────────────────────────────

    /** Refetch all media (for manual refresh) */
    const fetchMedia = useCallback(
        (params) => {
            return qc.invalidateQueries({ queryKey: MEDIA_KEYS.all });
        },
        [qc],
    );

    const search = useCallback(
        async (q, folderId) => {
            const data = await searchMedia(q, folderId);
            const raw = data?.results ?? [];
            setRawSearchResults(raw);
            const filtered = permissions?.allowAdult === false ? raw.filter((item) => item.permission !== false) : raw;
            return { ...data, results: filtered };
        },
        [permissions],
    );

    /** Refetch folders */
    const fetchFolders = useCallback(() => {
        return qc.invalidateQueries({ queryKey: LIBRARY_KEYS.folders() });
    }, [qc]);

    const addLibraryFolder = useCallback(
        async (path, label) => {
            await addFolderMut.mutateAsync({ path, label });
        },
        [addFolderMut],
    );

    const updateLibraryFolder = useCallback(
        async (id, updates) => {
            await updateFolderMut.mutateAsync({ id, updates });
        },
        [updateFolderMut],
    );

    const removeLibraryFolder = useCallback(
        async (id) => {
            await removeFolderMut.mutateAsync(id);
        },
        [removeFolderMut],
    );

    /** fetchCategories — invalidate TQ cache instead of refetching manually */
    const fetchCategories = useCallback(() => {
        return qc.invalidateQueries({ queryKey: ["categories"] });
    }, [qc]);

    /** fetchByCategory — sets the active category and triggers the lazy query */
    const fetchByCategory = useCallback((name, type) => {
        setActiveCategory(name || null);
        setActiveCatType(type || null);
    }, []);

    const fetchHistory = useCallback(() => {
        return qc.invalidateQueries({ queryKey: ["history"] });
    }, [qc]);

    const logProgress = useCallback((id, progressData) => saveProgress(id, progressData).catch(() => {}), []);

    const getResume = useCallback((id) => getResumePoint(id).catch(() => null), []);

    const removeHistoryItem = useCallback(
        async (id) => {
            await deleteHistMut.mutateAsync(id);
        },
        [deleteHistMut],
    );

    const clearAllHistory = useCallback(async () => {
        await clearHistMut.mutateAsync();
    }, [clearHistMut]);

    const fetchWatchlist = useCallback(() => {
        return qc.invalidateQueries({ queryKey: ["watchlist"] });
    }, [qc]);

    const addWatchlistItem = useCallback(
        async (id, data) => {
            await addWlMut.mutateAsync({ id, data });
        },
        [addWlMut],
    );

    const removeWatchlistItem = useCallback(
        async (id) => {
            await removeWlMut.mutateAsync(id);
        },
        [removeWlMut],
    );

    const fetchFavourites = useCallback(() => {
        return qc.invalidateQueries({ queryKey: ["favourites"] });
    }, [qc]);

    const addFavouriteItem = useCallback(
        async (id, data) => {
            await addFavMut.mutateAsync({ id, data });
        },
        [addFavMut],
    );

    const removeFavouriteItem = useCallback(
        async (id) => {
            await removeFavMut.mutateAsync(id);
        },
        [removeFavMut],
    );

    const refreshOneMetadata = useCallback(
        (id) =>
            refreshMetadata(id).then(() => {
                // Invalidate media cache so updated metadata appears
                qc.invalidateQueries({ queryKey: MEDIA_KEYS.all });
            }),
        [qc],
    );

    const refreshAll = useCallback(
        () =>
            refreshAllMetadata().then(() => {
                qc.invalidateQueries({ queryKey: MEDIA_KEYS.all });
            }),
        [qc],
    );

    // ─── Derived helpers ──────────────────────────────────────────────────────
    const isInWatchlist = useCallback((id) => watchlist.some((w) => w.id === id), [watchlist]);
    const isFavourite = useCallback((id) => favourites.some((f) => f.id === id), [favourites]);
    const getStreamUrl = useCallback((id) => api.streamUrl(id), []);
    const getSubtitleUrl = useCallback((encoded) => api.subtitleUrl(encoded), []);

    const toggleWatchlist = useCallback((id, data) => (isInWatchlist(id) ? removeWatchlistItem(id) : addWatchlistItem(id, data)), [isInWatchlist, removeWatchlistItem, addWatchlistItem]);

    const toggleFavourite = useCallback((id, data) => (isFavourite(id) ? removeFavouriteItem(id) : addFavouriteItem(id, data)), [isFavourite, removeFavouriteItem, addFavouriteItem]);

    // Derived category arrays for CategoryPage (compatible with existing consumers)
    const categoryMovies = categoryData?.movies?.items ?? [];
    const categorySeries = categoryData?.series?.items ?? [];
    const categoryAnime = categoryData?.anime?.items ?? [];

    // ─── Context value — identical shape to old ApiProvider ───────────────────
    const value = useMemo(
        () => ({
            // media
            movies,
            series,
            anime,
            searchResults,

            // library
            folders,

            // categories
            categories,
            categoryData,
            categoryMovies,
            categorySeries,
            categoryAnime,
            activeCategory,

            // user data
            history,
            watchlist,
            favourites,

            // status
            loading,
            errors,

            // actions
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

            // expose raw media query for advanced consumers
            media: mediaQuery.data,
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
            mediaQuery.data,
        ],
    );

    return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi() {
    const ctx = useContext(ApiContext);
    if (!ctx) throw new Error("useApi must be used inside <ApiProvider>");
    return ctx;
}
