// web/src/components/auth/VerifyOTPForm.jsx
// 6-digit OTP entry. Auto-focus, paste support, resend.

import { useState, useRef } from "react";
import { useAuth } from "../../auth/AuthContext";
import React from "react";

export default function VerifyOTPForm({ userId, email, onVerified, onPending }) {
    const { verifyEmail, resendOTP } = useAuth();
    const [digits, setDigits] = useState(["", "", "", "", "", ""]);
    const [loading, setLoading] = useState(false);
    const [resending, setResending] = useState(false);
    const [error, setError] = useState(null);
    const [resendMsg, setResendMsg] = useState(null);
    const refs = useRef([]);

    function handleDigit(idx, val) {
        if (!/^\d*$/.test(val)) return;
        const next = [...digits];
        next[idx] = val.slice(-1);
        setDigits(next);
        if (val && idx < 5) refs.current[idx + 1]?.focus();
    }

    function handleKeyDown(idx, e) {
        if (e.key === "Backspace" && !digits[idx] && idx > 0) refs.current[idx - 1]?.focus();
    }

    function handlePaste(e) {
        e.preventDefault();
        const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
        if (pasted.length === 6) {
            setDigits(pasted.split(""));
            refs.current[5]?.focus();
        }
    }

    async function handleVerify(e) {
        e?.preventDefault();
        const code = digits.join("");
        if (code.length < 6) { setError("Enter the 6-digit code"); return; }
        setError(null);
        setLoading(true);
        try {
            await verifyEmail(userId, code);
            // verifyEmail doesn't log user in — pass result up
            // caller (AuthModal) decides if user is approved or pending
            onVerified?.({ userId });
        } catch (err) {
            setError(err.message || "Invalid code");
            setDigits(["", "", "", "", "", ""]);
            refs.current[0]?.focus();
        } finally {
            setLoading(false);
        }
    }

    async function handleResend() {
        setResending(true);
        setError(null);
        try {
            await resendOTP(userId);
            setResendMsg("New code sent!");
            setTimeout(() => setResendMsg(null), 3000);
        } catch (err) {
            setError(err.message || "Failed to resend");
        } finally {
            setResending(false);
        }
    }

    return (
        <form onSubmit={handleVerify} className="space-y-4">
            <div className="text-center mb-2">
                <p className="text-xs text-base-content/50">
                    Code sent to <span className="text-base-content font-medium">{email}</span>
                </p>
            </div>

            {error && (
                <div className="rounded bg-error/10 border border-error/20 px-3 py-2 text-xs text-error">
                    {error}
                </div>
            )}
            {resendMsg && (
                <div className="rounded bg-success/10 border border-success/20 px-3 py-2 text-xs text-success">
                    {resendMsg}
                </div>
            )}

            {/* OTP digit inputs */}
            <div className="flex gap-2 justify-center" onPaste={handlePaste}>
                {digits.map((d, i) => (
                    <React.Fragment key={i}>
                        <label htmlFor={`otp-digit-${i}`} className="sr-only">Digit {i + 1}</label>
                        <input
                            id={`otp-digit-${i}`}
                            name={`otp-digit-${i}`}
                            autoComplete="one-time-code"
                            ref={(el) => (refs.current[i] = el)}
                            type="text"
                            inputMode="numeric"
                        maxLength={1}
                        value={d}
                        onChange={(e) => handleDigit(i, e.target.value)}
                        onKeyDown={(e) => handleKeyDown(i, e)}
                        style={{ outline: "none", boxShadow: "none" }}
                        className="w-10 h-12 text-center text-lg font-bold bg-base-300 border border-white/10 rounded focus:border-primary focus:outline-none transition-colors"
                        />
                    </React.Fragment>
                ))}
            </div>

            <button
                id="otp-verify-submit"
                type="submit"
                disabled={loading || digits.join("").length < 6}
                style={{ outline: "none", boxShadow: "none" }}
                className="btn btn-sm btn-primary w-full rounded gap-1.5 focus:outline-none">
                {loading ? <span className="loading loading-spinner loading-xs" /> : null}
                {loading ? "Verifying…" : "Verify Email"}
            </button>

            <p className="text-center text-xs text-base-content/40">
                Didn't receive it?{" "}
                <button type="button" onClick={handleResend} disabled={resending}
                    style={{ outline: "none", boxShadow: "none" }}
                    className="text-primary hover:underline font-medium cursor-pointer disabled:opacity-50">
                    {resending ? "Sending…" : "Resend"}
                </button>
            </p>
        </form>
    );
}
