// web/src/Components/auth/useMediaQuery.js
import { useSyncExternalStore } from "react";

/** Live `window.matchMedia(query).matches` (false during SSR/tests without matchMedia). */
export function useMediaQuery(query) {
    return useSyncExternalStore(
        (notify) => {
            if (typeof window === "undefined" || !window.matchMedia) return () => {};
            const mql = window.matchMedia(query);
            mql.addEventListener("change", notify);
            return () => mql.removeEventListener("change", notify);
        },
        () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false),
        () => false,
    );
}
