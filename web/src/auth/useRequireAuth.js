// web/src/auth/useRequireAuth.js
// Hook for protecting actions (not routes).
// If user is authenticated, runs the action immediately.
// If not, opens auth modal and queues the action to run after login.
//
// Usage:
//   const requireAuth = useRequireAuth();
//   <button onClick={() => requireAuth(() => startPlayback(id))}>Watch</button>

import { useCallback } from "react";
import { useAuth } from "./AuthContext";
import { useAuthModal } from "./AuthModalContext";

export function useRequireAuth() {
    const { isAuthenticated, isApproved, loading } = useAuth();
    const { openAuthModal } = useAuthModal();

    return useCallback(
        (action, opts = {}) => {
            // If auth is still initializing, don't open modal yet — session may still be restoring
            if (loading) return;

            if (isAuthenticated && isApproved) {
                // Already good — run action immediately
                if (typeof action === "function") action();
                return;
            }
            // Not authenticated — open modal, action runs as onSuccess
            openAuthModal({
                view: opts.view || "login",
                onSuccess: typeof action === "function" ? action : null,
            });
        },
        [isAuthenticated, isApproved, loading, openAuthModal],
    );
}
