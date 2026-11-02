// web/src/auth/useRequireAuth.js
// Gate for actions (not routes). Browsing never needs this; only things that need an account.
//
//   const requireAuth = useRequireAuth();
//   <button onClick={() => requireAuth(() => addToWatchlist(id))}>
//
// Not signed in  → sends the user to /login (and back afterwards).
// Unverified     → /verify-email.
// Otherwise      → runs the action (pending users included: approval only matters for playback).

import { useCallback } from "react";
import { useNavigate, useLocation } from "react-router";
import { useAuth } from "./AuthContext";
import { requiredPathFor } from "./accountRouting";

export function useRequireAuth() {
    const { user, loading } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    return useCallback(
        (action) => {
            if (loading) return false;
            const target = requiredPathFor(user);
            if (target) {
                navigate(target, { state: target === "/login" ? { from: location } : undefined });
                return false;
            }
            action?.();
            return true;
        },
        [user, loading, navigate, location],
    );
}
