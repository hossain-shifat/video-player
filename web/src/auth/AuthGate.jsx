// web/src/Auth/AuthGate.jsx
// Route guard for the normal application (layout route — renders <Outlet/>).
//
// Browsing needs: signed in + e-mail verified (+ not blocked / not expired).
// It deliberately does NOT need administrator approval: verified users who are still pending can
// browse everything. Watching is guarded separately by PlaybackGate (and, for real, by the server).

import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "./AuthContext";
import { requiredPathFor } from "./accountRouting";

export function FullScreenSpinner() {
    return (
        <div className="min-h-screen bg-base-100 flex items-center justify-center" role="status" aria-label="Loading">
            <span className="loading loading-spinner loading-lg text-primary" />
        </div>
    );
}

export default function AuthGate({ children }) {
    const { user, loading } = useAuth();
    const location = useLocation();

    // Wait for the stored session to be restored — never redirect on a half-known state.
    if (loading) return <FullScreenSpinner />;

    const target = requiredPathFor(user);
    if (target) {
        return <Navigate to={target} replace state={target === "/login" ? { from: location } : undefined} />;
    }
    return children || <Outlet />;
}
