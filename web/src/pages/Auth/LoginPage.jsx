import { useState } from "react";
import { useNavigate, useLocation, useSearchParams, Link } from "react-router";
import { Mail, Lock } from "lucide-react";
import { useAuth } from "../../Auth/AuthContext";
import { authApi } from "../../Api/auth";
import { postAuthPath } from "../../Auth/accountRouting";
import { AuthPanel, AuthHeading, AuthAlert, AuthField, AuthSubmit, GoogleButton, OrDivider } from "../../Components/Auth/AuthUI";

export default function LoginPage() {
    const { login } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const [searchParams] = useSearchParams();
    const from = location.state?.from?.pathname ? `${location.state.from.pathname}${location.state.from.search || ""}` : null;
    const oauthError = searchParams.get("error");
    const oauthMessage = oauthError ? "Google sign-in didn’t complete. Try again, or sign in with your email." : null;
    const notice = location.state?.notice || null; // e.g. "Password updated…" after a reset

    async function handleSubmit(e) {
        e.preventDefault();
        setError(null);
        setLoading(true);

        try {
            const user = await login(email, password);
            // Unverified → /verify-email · blocked → /access-denied · expired → /access-expired ·
            // otherwise (verified, approved OR pending) → where the user was going, else Home.
            navigate(postAuthPath(user, from), { replace: true, state: user.emailVerified ? undefined : { codeSent: user._emailSent !== false, emailFailed: user._emailSent === false } });
        } catch (err) {
            setError(err.message || "Couldn’t sign in. Check your details and try again.");
        } finally {
            setLoading(false);
        }
    }

    function handleGoogleLogin() {
        try {
            if (from) sessionStorage.setItem("flux_return_to", from);
        } catch {
            /* storage unavailable — land on Home */
        }
        window.location.href = authApi.googleLoginUrl();
    }

    return (
        <AuthPanel>
            <AuthHeading title="Welcome back" subtitle="Sign in to pick up where you left off." />

            {notice && <AuthAlert kind="success">{notice}</AuthAlert>}
            {(error || oauthMessage) && <AuthAlert>{error || oauthMessage}</AuthAlert>}

            <form onSubmit={handleSubmit} className="flex flex-col gap-[var(--auth-gap)]" noValidate={false}>
                <AuthField
                    id="login-email"
                    label="Email"
                    icon={Mail}
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                />
                <AuthField
                    id="login-password"
                    label="Password"
                    labelAside={
                        <Link to="/forgot-password" className="text-xs font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary">
                            Forgot password?
                        </Link>
                    }
                    icon={Lock}
                    type="password"
                    autoComplete="current-password"
                    placeholder="Your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                />
                <div className="mt-1">
                    <AuthSubmit id="login-submit" loading={loading} loadingText="Signing in…">
                        Sign in
                    </AuthSubmit>
                </div>
            </form>

            <OrDivider />
            <GoogleButton id="login-google" onClick={handleGoogleLogin} />

            <p className="mt-[var(--auth-gap-lg)] text-center text-sm text-base-content/60">
                New to FLUX?{" "}
                <Link to="/register" className="font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary">
                    Create an account
                </Link>
            </p>
        </AuthPanel>
    );
}
