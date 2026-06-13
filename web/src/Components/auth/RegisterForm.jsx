// web/src/components/auth/RegisterForm.jsx
// Wired to real AuthContext register. Used inside AuthModal.

import { useState } from "react";
import { UserPlus, Eye, EyeOff } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";

function getStrength(pw) {
    if (!pw) return 0;
    let score = 0;
    if (pw.length >= 8) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[a-z]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    return score;
}

const STRENGTH_LABELS = ["", "Weak", "Fair", "Good", "Strong"];
const SEGMENT_COLORS = ["bg-error", "bg-warning", "bg-yellow-400", "bg-success"];

function StrengthBar({ password }) {
    const score = getStrength(password);
    if (!password) return null;
    const labelColor = score <= 1 ? "text-error" : score === 2 ? "text-warning" : score === 3 ? "text-yellow-400" : "text-success";
    return (
        <div className="mt-2 space-y-1">
            <div className="flex gap-1">
                {SEGMENT_COLORS.map((color, i) => (
                    <div key={i} className={`h-1 flex-1 rounded-full transition-all duration-300 ${i < score ? color : "bg-white/10"}`} />
                ))}
            </div>
            <p className={`text-xs ${labelColor}`}>{STRENGTH_LABELS[score]}</p>
        </div>
    );
}

export default function RegisterForm({ onSuccess, onSwitchToLogin, onOTPRequired, onAdminCreated }) {
    const { register } = useAuth();
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [showPass, setShowPass] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const passwordValid = getStrength(password) >= 2 && password.length >= 8;
    const passwordsMatch = password === confirm;
    const canSubmit = name.trim() && email.trim() && passwordValid && confirm && passwordsMatch;

    async function handleSubmit(e) {
        e?.preventDefault();
        if (!canSubmit) return;
        setError(null);
        setLoading(true);

        try {
            const data = await register(email.trim(), password, name.trim());

            if (data.requiresVerification === false && data.isAdmin) {
                // Admin email — server returned full login tokens
                // AuthContext.register only calls authApi.register, doesn't set state
                // We need to log in directly using the returned tokens
                onAdminCreated?.(data);
            } else {
                // Normal user — needs OTP
                onOTPRequired?.({ userId: data.userId, email: email.trim() });
            }
        } catch (err) {
            setError(err.message || "Registration failed");
        } finally {
            setLoading(false);
        }
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-3">
            {error && (
                <div className="rounded bg-error/10 border border-error/20 px-3 py-2 text-xs text-error">
                    {error}
                </div>
            )}

            <label htmlFor="auth-reg-name" className="sr-only">Full name</label>
            <input
                id="auth-reg-name"
                name="name"
                type="text"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
                style={{ outline: "none", boxShadow: "none" }}
                className="input input-sm w-full bg-base-300 border-white/10 text-sm rounded focus:outline-none"
                autoComplete="name"
                required
            />

            <label htmlFor="auth-reg-email" className="sr-only">Email address</label>
            <input
                id="auth-reg-email"
                name="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email address"
                style={{ outline: "none", boxShadow: "none" }}
                className="input input-sm w-full bg-base-300 border-white/10 text-sm rounded focus:outline-none"
                autoComplete="email"
                required
            />

            <div>
                <div className="relative">
                    <label htmlFor="auth-reg-password" className="sr-only">Password</label>
                    <input
                        id="auth-reg-password"
                        name="password"
                        type={showPass ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Password (8+ chars)"
                        style={{ outline: "none", boxShadow: "none" }}
                        className="input input-sm w-full bg-base-300 border-white/10 text-sm rounded pr-9 focus:outline-none"
                        autoComplete="new-password"
                        required
                    />
                    <button type="button" onClick={() => setShowPass((v) => !v)}
                        style={{ outline: "none", boxShadow: "none" }}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-base-content/40 hover:text-base-content transition-colors focus:outline-none">
                        {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                </div>
                <StrengthBar password={password} />
            </div>

            <div className="relative">
                <label htmlFor="auth-reg-confirm" className="sr-only">Confirm password</label>
                <input
                    id="auth-reg-confirm"
                    name="confirmPassword"
                    type={showConfirm ? "text" : "password"}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Confirm password"
                    style={{ outline: "none", boxShadow: "none" }}
                    className={`input input-sm w-full bg-base-300 border-white/10 text-sm rounded pr-9 focus:outline-none ${confirm && !passwordsMatch ? "border-error/50" : ""}`}
                    autoComplete="new-password"
                    required
                />
                <button type="button" onClick={() => setShowConfirm((v) => !v)}
                    style={{ outline: "none", boxShadow: "none" }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-base-content/40 hover:text-base-content transition-colors focus:outline-none">
                    {showConfirm ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
            </div>
            {confirm && !passwordsMatch && <p className="text-xs text-error -mt-1">Passwords do not match</p>}

            <button
                id="auth-reg-submit"
                type="submit"
                disabled={!canSubmit || loading}
                style={{ outline: "none", boxShadow: "none" }}
                className="btn btn-sm btn-primary w-full rounded mt-4 gap-1.5 focus:outline-none">
                {loading ? <span className="loading loading-spinner loading-xs" /> : <UserPlus size={13} />}
                {loading ? "Creating…" : "Create Account"}
            </button>

            <p className="text-center text-xs text-base-content/40 mt-3">
                Already have an account?{" "}
                <button type="button" onClick={onSwitchToLogin}
                    style={{ outline: "none", boxShadow: "none" }}
                    className="text-primary hover:underline font-medium cursor-pointer">
                    Sign in
                </button>
            </p>
        </form>
    );
}
