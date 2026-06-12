// web/src/components/auth/LoginForm.jsx
// Wired to real AuthContext login. Used inside AuthModal.

import { useState } from "react";
import { LogIn, Eye, EyeOff } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { authApi } from "../../api/auth";

export default function LoginForm({ onSuccess, onSwitchToRegister, onOTPRequired }) {
    const { login } = useAuth();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPass, setShowPass] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    async function handleSubmit(e) {
        e?.preventDefault();
        if (!email.trim() || !password) return;
        setError(null);
        setLoading(true);
        try {
            const user = await login(email, password);
            onSuccess?.(user);
        } catch (err) {
            if (err.status === 403 && err.body?.code === "EMAIL_NOT_VERIFIED") {
                onOTPRequired?.({ email, userId: err.body?.userId });
            } else {
                setError(err.message || "Invalid email or password");
            }
        } finally {
            setLoading(false);
        }
    }

    function handleGoogleLogin() {
        window.location.href = authApi.googleLoginUrl();
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-3">
            {error && <div className="rounded bg-error/10 border border-error/20 px-3 py-2 text-xs text-error">{error}</div>}

            <label htmlFor="auth-login-email" className="sr-only">
                Email address
            </label>
            <input
                id="auth-login-email"
                name="email"
                type="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email address"
                style={{ outline: "none", boxShadow: "none" }}
                className="input input-sm w-full bg-base-300 border-white/10 text-sm rounded focus:outline-none focus-visible:outline-none"
                autoComplete="email"
                required
            />

            <div className="relative">
                <label htmlFor="auth-login-password" className="sr-only">
                    Password
                </label>
                <input
                    id="auth-login-password"
                    name="password"
                    type={showPass ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    style={{ outline: "none", boxShadow: "none" }}
                    className="input input-sm w-full bg-base-300 border-white/10 text-sm rounded pr-9 focus:outline-none focus-visible:outline-none"
                    autoComplete="current-password"
                    required
                />
                <button
                    type="button"
                    onClick={() => setShowPass((v) => !v)}
                    style={{ outline: "none", boxShadow: "none" }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-base-content/40 hover:text-base-content transition-colors focus:outline-none">
                    {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
            </div>

            <button
                id="auth-login-submit"
                type="submit"
                disabled={loading || !email.trim() || !password}
                style={{ outline: "none", boxShadow: "none" }}
                className="btn btn-sm btn-primary w-full rounded mt-4 gap-1.5 focus:outline-none">
                {loading ? <span className="loading loading-spinner loading-xs" /> : <LogIn size={13} />}
                {loading ? "Signing in…" : "Sign In"}
            </button>

            <div className="divider my-2 text-[10px] text-base-content/20">OR</div>

            <button
                id="auth-google-btn"
                type="button"
                onClick={handleGoogleLogin}
                style={{ outline: "none", boxShadow: "none" }}
                className="btn btn-sm btn-outline w-full rounded gap-2 focus:outline-none border-white/10 hover:bg-white/5 hover:border-white/20">
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Continue with Google
            </button>

            <p className="text-center text-xs text-base-content/40 mt-3">
                Don't have an account?{" "}
                <button type="button" onClick={onSwitchToRegister} style={{ outline: "none", boxShadow: "none" }} className="text-primary hover:underline font-medium cursor-pointer">
                    Sign up
                </button>
            </p>
        </form>
    );
}
