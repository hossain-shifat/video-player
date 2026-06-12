// web/src/Pages/Auth/OAuthCallbackPage.jsx
// Handles redirect from Google OAuth callback.
// Server redirects to /auth/callback?accessToken=...&refreshToken=...&sessionId=...

import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useAuth } from "../../auth/AuthContext";
import { authApi } from "../../api/auth";

export default function OAuthCallbackPage() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { loginWithTokens } = useAuth();

    useEffect(() => {
        const accessToken = searchParams.get("accessToken");
        const refreshToken = searchParams.get("refreshToken");
        const sessionId = searchParams.get("sessionId");
        const error = searchParams.get("error");

        if (error) {
            navigate("/", { replace: true });
            return;
        }

        if (!accessToken || !refreshToken || !sessionId) {
            navigate("/", { replace: true });
            return;
        }

        // Decode JWT payload to get user info
        try {
            const payload = JSON.parse(atob(accessToken.split(".")[1]));
            const user = {
                id: payload.sub,
                email: payload.email,
                name: payload.name,
                role: payload.role,
                status: payload.status,
                permissions: payload.permissions || {},
            };

            loginWithTokens({ accessToken, refreshToken, sessionId, user });

            // Return to previous route if saved, otherwise go home
            const returnTo = sessionStorage.getItem("flux_return_to") || "/";
            sessionStorage.removeItem("flux_return_to");
            navigate(returnTo, { replace: true });
        } catch {
            navigate("/", { replace: true });
        }
    }, []);

    return (
        <div className="min-h-screen bg-base-100 flex items-center justify-center">
            <div className="text-center">
                <span className="loading loading-spinner loading-lg text-primary"></span>
                <p className="text-base-content/50 text-sm mt-4">Completing sign in…</p>
            </div>
        </div>
    );
}
