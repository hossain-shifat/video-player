import React, { useState, useRef } from "react";
import { useNavigate, useLocation, Link } from "react-router";
import { useAuth } from "../../auth/AuthContext";

export default function VerifyEmailPage() {
    const { verifyEmail, resendOTP } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    const { userId, email } = location.state || {};
    const [code, setCode] = useState(["", "", "", "", "", ""]);
    const [loading, setLoading] = useState(false);
    const [resending, setResending] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);

    const inputRefs = useRef([]);

    if (!userId) {
        return (
            <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
                <div className="text-center">
                    <p className="text-base-content/60 mb-4">No verification session found.</p>
                    <Link to="/register" className="btn btn-primary">Register</Link>
                </div>
            </div>
        );
    }

    function handleDigit(idx, val) {
        if (!/^\d*$/.test(val)) return;
        const next = [...code];
        next[idx] = val.slice(-1);
        setCode(next);

        if (val && idx < 5) {
            inputRefs.current[idx + 1]?.focus();
        }
    }

    function handleKeyDown(idx, e) {
        if (e.key === "Backspace" && !code[idx] && idx > 0) {
            inputRefs.current[idx - 1]?.focus();
        }
    }

    function handlePaste(e) {
        e.preventDefault();
        const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
        if (pasted.length === 6) {
            setCode(pasted.split(""));
            inputRefs.current[5]?.focus();
        }
    }

    async function handleVerify(e) {
        e.preventDefault();
        const fullCode = code.join("");
        if (fullCode.length < 6) {
            setError("Enter the 6-digit code");
            return;
        }

        setError(null);
        setLoading(true);

        try {
            await verifyEmail(userId, fullCode);
            setSuccess("Email verified! Redirecting...");
            setTimeout(() => navigate("/pending", { replace: true }), 1500);
        } catch (err) {
            setError(err.message || "Verification failed");
            setCode(["", "", "", "", "", ""]);
            inputRefs.current[0]?.focus();
        } finally {
            setLoading(false);
        }
    }

    async function handleResend() {
        setResending(true);
        setError(null);
        try {
            await resendOTP(userId);
            setSuccess("New code sent!");
            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            setError(err.message || "Failed to resend code");
        } finally {
            setResending(false);
        }
    }

    return (
        <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
            <div className="w-full max-w-md">
                <div className="text-center mb-8">
                    <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-4">
                        <span className="text-3xl">📧</span>
                    </div>
                    <h1 className="text-2xl font-bold text-base-content mb-2">Check your email</h1>
                    <p className="text-base-content/50 text-sm">
                        We sent a 6-digit code to{" "}
                        <span className="text-base-content font-medium">{email || "your email"}</span>
                    </p>
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
                    {success && (
                        <div className="alert alert-success mb-6 text-sm py-3">
                            <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
                            </svg>
                            {success}
                        </div>
                    )}

                    <form onSubmit={handleVerify}>
                        {/* OTP digit inputs */}
                        <div className="flex gap-3 justify-center mb-6" onPaste={handlePaste}>
                            {code.map((digit, idx) => (
                                <React.Fragment key={idx}>
                                    <label htmlFor={`otp-digit-${idx}`} className="sr-only">Digit {idx + 1}</label>
                                    <input
                                        id={`otp-digit-${idx}`}
                                        name={`otp-digit-${idx}`}
                                        autoComplete="one-time-code"
                                        ref={(el) => (inputRefs.current[idx] = el)}
                                        type="text"
                                        inputMode="numeric"
                                    maxLength={1}
                                    value={digit}
                                    onChange={(e) => handleDigit(idx, e.target.value)}
                                    onKeyDown={(e) => handleKeyDown(idx, e)}
                                        className="w-12 h-14 text-center text-xl font-bold input input-bordered bg-base-100 focus:border-primary"
                                    />
                                </React.Fragment>
                            ))}
                        </div>

                        <button
                            id="otp-verify-btn"
                            type="submit"
                            className="btn btn-primary w-full"
                            disabled={loading || code.join("").length < 6}
                        >
                            {loading ? <span className="loading loading-spinner loading-sm"></span> : "Verify email"}
                        </button>
                    </form>

                    <div className="text-center mt-6">
                        <p className="text-sm text-base-content/50">
                            Didn't receive the code?{" "}
                            <button
                                id="otp-resend-btn"
                                type="button"
                                className="text-primary hover:underline font-medium disabled:opacity-50"
                                onClick={handleResend}
                                disabled={resending}
                            >
                                {resending ? "Sending..." : "Resend"}
                            </button>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
