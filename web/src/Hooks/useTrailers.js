import { useState, useEffect, useCallback } from "react";
import { getDiscoverTrailers, getLibraryTrailers } from "../api";

/**
 * useTrailers
 * -----------
 * Fetches both trailer feeds once on mount. Self-contained — same pattern
 * as the other Hooks/use*.js files (useHistory, useMedia, etc.), no
 * apiContext wiring needed.
 */
export function useTrailers() {
    const [discoverTrailers, setDiscoverTrailers] = useState([]);
    const [libraryTrailers, setLibraryTrailers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const load = useCallback(async (signal) => {
        setLoading(true);
        setError(null);
        try {
            const [discover, library] = await Promise.all([getDiscoverTrailers(), getLibraryTrailers()]);
            if (signal?.aborted) return;
            setDiscoverTrailers(discover?.items ?? []);
            setLibraryTrailers(library?.items ?? []);
        } catch (err) {
            if (err?.name === "AbortError" || signal?.aborted) return;
            setError(err);
        } finally {
            if (!signal?.aborted) setLoading(false);
        }
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        load(controller.signal);
        return () => controller.abort();
    }, [load]);

    return { discoverTrailers, libraryTrailers, loading, error, refetch: load };
}
