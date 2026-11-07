// web/src/Pages/Auth/OAuthCallbackPage.jsx
// Landing page of the Google sign-in redirect: /auth/callback?code=<single-use code>
// The server no longer puts tokens in the URL — this page trades the one-time code for the session.

import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useAuth } from "../../Auth/AuthContext";
import { postAuthPath } from "../../Auth/accountRouting";
import { AuthPanel } from "../../Components/Auth/AuthUI";

export default function OAuthCallbackPage() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { loginWithOAuthCode } = useAuth();
    const ran = useRef(false); // the code is single-use: StrictMode's double effect must not spend it twice

    useEffect(() => {
        if (ran.current) return;
        ran.current = true;

        const code = searchParams.get("code");
        const error = searchParams.get("error");
        // Strip the one-time code from the address bar / history right away.
        window.history.replaceState(null, "", window.location.pathname);

        if (error || !code) {
            navigate(`/login?error=${encodeURIComponent(error || "oauth_failed")}`, { replace: true });
            return;
        }

        loginWithOAuthCode(code)
            .then((user) => {
                let returnTo = null;
                try {
                    returnTo = sessionStorage.getItem("flux_return_to");
                    sessionStorage.removeItem("flux_return_to");
                } catch {
                    /* ignore */
                }
                navigate(postAuthPath(user, returnTo), { replace: true });
            })
            .catch(() => navigate("/login?error=oauth_failed", { replace: true }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <AuthPanel>
            <div className="flex flex-col items-center py-6 text-center" role="status" aria-live="polite">
                <span className="loading loading-spinner loading-lg text-primary" />
                <p className="mt-4 text-sm text-base-content/60">Completing sign in…</p>
            </div>
        </AuthPanel>
    );
}
