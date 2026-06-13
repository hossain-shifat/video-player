import { useState } from "react";
import { useNavigate, useLocation, Link } from "react-router";
import { useAuth } from "../../auth/AuthContext";
import { authApi } from "../../api/auth";

export default function LoginPage() {
    const { login } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const from = location.state?.from?.pathname || "/";

    async function handleSubmit(e) {
        e.preventDefault();
        setError(null);
        setLoading(true);

        try {
            const user = await login(email, password);

            if (user.status === "pending") {
                navigate("/pending", { replace: true });
            } else if (user.status === "blocked" || user.status === "rejected") {
                navigate("/access-denied", { replace: true });
            } else if (user.accessType === "temporary" && user.accessExpiresAt && Date.now() > new Date(user.accessExpiresAt).getTime()) {
                navigate("/access-expired", { replace: true });
            } else {
                navigate(from, { replace: true });
            }
        } catch (err) {
            if (err.status === 403 && err.message?.includes("EMAIL_NOT_VERIFIED")) {
                // TODO: redirect to verify email with userId
                setError("Email not verified. Please check your inbox for the verification code.");
            } else {
                setError(err.message || "Login failed");
            }
        } finally {
            setLoading(false);
        }
    }

    function handleGoogleLogin() {
        window.location.href = authApi.googleLoginUrl();
    }

    return (
        <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
            <div className="w-full max-w-md">
                {/* Logo */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-primary-content font-bold text-lg">🎬</div>
                        <span className="text-2xl font-bold text-base-content tracking-tight">FLUX</span>
                    </div>
                    <p className="text-base-content/50 text-sm">Sign in to your account</p>
                </div>

                {/* Card */}
                <div className="bg-base-200 rounded-2xl p-8 shadow-xl border border-base-300">
                    {error && (
                        <div className="alert alert-error mb-6 text-sm py-3">
                            <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
                            </svg>
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-5">
                        <div className="form-control">
                            <label htmlFor="login-email" className="label pb-1">
                                <span className="label-text text-sm font-medium">Email</span>
                            </label>
                            <input
                                id="login-email"
                                name="email"
                                type="email"
                                className="input input-bordered w-full bg-base-100"
                                placeholder="you@example.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                autoComplete="email"
                            />
                        </div>

                        <div className="form-control">
                            <label htmlFor="login-password" className="label pb-1">
                                <span className="label-text text-sm font-medium">Password</span>
                            </label>
                            <input
                                id="login-password"
                                name="password"
                                type="password"
                                className="input input-bordered w-full bg-base-100"
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                autoComplete="current-password"
                            />
                        </div>

                        <button
                            id="login-submit"
                            type="submit"
                            className="btn btn-primary w-full"
                            disabled={loading}
                        >
                            {loading ? <span className="loading loading-spinner loading-sm"></span> : "Sign in"}
                        </button>
                    </form>

                    <div className="divider my-5 text-xs text-base-content/30">OR</div>

                    <button
                        id="login-google"
                        type="button"
                        className="btn btn-outline w-full gap-2"
                        onClick={handleGoogleLogin}
                    >
                        <svg className="w-5 h-5" viewBox="0 0 24 24">
                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                        </svg>
                        Continue with Google
                    </button>

                    <p className="text-center text-sm text-base-content/50 mt-6">
                        Don't have an account?{" "}
                        <Link to="/register" className="text-primary hover:underline font-medium">
                            Create one
                        </Link>
                    </p>
                </div>
            </div>
        </div>
    );
}
