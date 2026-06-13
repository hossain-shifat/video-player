// web/src/providers/QueryProvider.jsx
// Wraps the app with TanStack Query client.
// Configure global defaults: staleTime, retry strategy, error handling.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            // Data considered fresh for 2 minutes; won't refetch on window focus within this window
            staleTime: 2 * 60 * 1000,
            // Keep inactive query data in cache for 5 minutes
            gcTime: 5 * 60 * 1000,
            // Retry once on network errors; skip 401/403/404 (expected auth/not-found states)
            retry: (failureCount, error) => {
                if (error?.status === 401 || error?.status === 403 || error?.status === 404) return false;
                return failureCount < 1;
            },
            // Don't spam refetches on window focus — media data changes infrequently
            refetchOnWindowFocus: false,
        },
        mutations: {
            // Mutations don't retry by default to avoid double-write
            retry: 0,
        },
    },
});

export { queryClient };

export function QueryProvider({ children }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
