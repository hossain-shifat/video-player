// web/src/auth/ApprovedRoute.jsx
// Requires user to be approved (not pending/blocked/expired).
// Must be used INSIDE ProtectedRoute.

import { Navigate } from "react-router";
import { useAuth } from "./AuthContext";

export function ApprovedRoute({ children }) {
    const { user, isApproved, isExpired } = useAuth();

    if (!user) return null; // ProtectedRoute handles redirect if not authenticated

    if (isExpired) {
        return <Navigate to="/access-expired" replace />;
    }

    if (user.status === "blocked" || user.status === "rejected") {
        return <Navigate to="/access-denied" replace />;
    }

    if (!isApproved) {
        return <Navigate to="/pending" replace />;
    }

    return children;
}
