import { useState } from "react";
import { useNavigate, Link } from "react-router";
import { useAuth } from "../../auth/AuthContext";

export default function RegisterPage() {
    const { register } = useAuth();
    const navigate = useNavigate();

    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    async function handleSubmit(e) {
        e.preventDefault();
        setError(null);

        if (password !== confirmPassword) {
            setError("Passwords do not match");
            return;
        }

        if (password.length < 8) {
            setError("Password must be at least 8 characters");
            return;
        }

        setLoading(true);

        try {
            const data = await register(email, password, name);
            // Navigate to verify email page with userId
            navigate("/verify-email", { state: { userId: data.userId, email }, replace: true });
        } catch (err) {
            setError(err.message || "Registration failed");
        } finally {
            setLoading(false);
        }
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
                    <p className="text-base-content/50 text-sm">Create your account</p>
                </div>

                <div className="bg-base-200 rounded-2xl p-8 shadow-xl border border-base-300">
                    {error && (
                        <div className="alert alert-error mb-6 text-sm py-3">
                            <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
                            </svg>
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="form-control">
                            <label htmlFor="register-name" className="label pb-1">
                                <span className="label-text text-sm font-medium">Full name</span>
                            </label>
                            <input
                                id="register-name"
                                name="name"
                                type="text"
                                className="input input-bordered w-full bg-base-100"
                                placeholder="Your name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                required
                                autoComplete="name"
                            />
                        </div>

                        <div className="form-control">
                            <label htmlFor="register-email" className="label pb-1">
                                <span className="label-text text-sm font-medium">Email</span>
                            </label>
                            <input
                                id="register-email"
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
                            <label htmlFor="register-password" className="label pb-1">
                                <span className="label-text text-sm font-medium">Password</span>
                            </label>
                            <input
                                id="register-password"
                                name="password"
                                type="password"
                                className="input input-bordered w-full bg-base-100"
                                placeholder="Min. 8 characters"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                minLength={8}
                                autoComplete="new-password"
                            />
                        </div>

                        <div className="form-control">
                            <label htmlFor="register-confirm-password" className="label pb-1">
                                <span className="label-text text-sm font-medium">Confirm password</span>
                            </label>
                            <input
                                id="register-confirm-password"
                                name="confirmPassword"
                                type="password"
                                className="input input-bordered w-full bg-base-100"
                                placeholder="Repeat password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                required
                                autoComplete="new-password"
                            />
                        </div>

                        <button
                            id="register-submit"
                            type="submit"
                            className="btn btn-primary w-full mt-2"
                            disabled={loading}
                        >
                            {loading ? <span className="loading loading-spinner loading-sm"></span> : "Create account"}
                        </button>
                    </form>

                    <p className="text-center text-sm text-base-content/50 mt-6">
                        Already have an account?{" "}
                        <Link to="/login" className="text-primary hover:underline font-medium">
                            Sign in
                        </Link>
                    </p>
                </div>
            </div>
        </div>
    );
}
