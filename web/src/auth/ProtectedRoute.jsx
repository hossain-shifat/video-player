// web/src/auth/ProtectedRoute.jsx
// Redirect to /login if not authenticated.
// Shows loading state while session restores.

import { Navigate, useLocation } from "react-router";
import { useAuth } from "./AuthContext";

export function ProtectedRoute({ children }) {
    const { isAuthenticated, loading } = useAuth();
    const location = useLocation();

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-base-100">
                <span className="loading loading-spinner loading-lg text-primary"></span>
            </div>
        );
    }

    if (!isAuthenticated) {
        return <Navigate to="/login" state={{ from: location }} replace />;
    }

    return children;
}
