// web/src/Auth/GuestOnly.jsx
// Wraps /login and /register: a signed-in user has no business there, so send them to wherever
// their account belongs (verify-email / access pages / the page they came from / Home).

import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "./AuthContext";
import { postAuthPath } from "./accountRouting";
import { FullScreenSpinner } from "./AuthGate";

export default function GuestOnly() {
    const { user, loading } = useAuth();
    const location = useLocation();
    if (loading) return <FullScreenSpinner />;
    if (user) {
        const f = location.state?.from;
        const from = f?.pathname ? `${f.pathname}${f.search || ""}` : null;
        return <Navigate to={postAuthPath(user, from)} replace />;
    }
    return <Outlet />;
}
