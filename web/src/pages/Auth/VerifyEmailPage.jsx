import { useState, useRef, useEffect } from "react";
import { useNavigate, useLocation, Navigate } from "react-router";
import { useAuth } from "../../auth/AuthContext";
import { postAuthPath } from "../../auth/accountRouting";
import { FullScreenSpinner } from "../../auth/AuthGate";
import { MailCheck } from "lucide-react";
import { AuthPanel, AuthHeading, AuthAlert, AuthSubmit, AuthBadge } from "../../Components/auth/AuthUI";

const RESEND_COOLDOWN_SEC = 60;

// The account being verified comes from the signed-in (restricted) session — not from router state —
// so this page survives a refresh, a closed tab or a re-opened browser.
export default function VerifyEmailPage() {
    const { user, loading: authLoading, verifyEmail, resendOTP, logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    const email = user?.email;
    const [code, setCode] = useState(["", "", "", "", "", ""]);
    const [loading, setLoading] = useState(false);
    const [resending, setResending] = useState(false);
    // arriving from sign-up / sign-in when the server could NOT send the code: say so instead of waiting for a mail that will never come
    const [error, setError] = useState(location.state?.emailFailed ? "We couldn’t send the verification email. Press Resend code to try again, or ask the administrator to check the mail settings." : null);
    const [success, setSuccess] = useState(null);
    // A code was just e-mailed when we arrive from register/login → start the resend cooldown.
    const [cooldown, setCooldown] = useState(location.state?.codeSent ? RESEND_COOLDOWN_SEC : 0);

    const inputRefs = useRef([]);

    useEffect(() => {
        if (cooldown <= 0) return undefined;
        const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
        return () => clearTimeout(t);
    }, [cooldown]);

    useEffect(() => {
        inputRefs.current[0]?.focus();
    }, [authLoading]);

    if (authLoading) return <FullScreenSpinner />;
    if (!user) return <Navigate to="/login" replace />;
    // Already verified (e.g. verified in another tab / refreshed after success): go where the account belongs.
    if (user.emailVerified && !success) return <Navigate to={postAuthPath(user)} replace />;

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
            // Validates the code on the server, marks the e-mail verified and returns the
            // authoritative account (status, canPlay…). Verification never grants playback by itself.
            const verifiedUser = await verifyEmail(fullCode);
            setSuccess("Email verified! Taking you to FLUX…");
            setTimeout(() => navigate(postAuthPath(verifiedUser), { replace: true }), 900);
        } catch (err) {
            if (err.apiCode === "OTP_EXPIRED") setError("This code has expired. Request a new one below.");
            else if (err.apiCode === "OTP_LOCKED" || err.status === 429) setError(err.message || "Too many attempts. Please wait a moment and try again.");
            else setError(err.message || "Verification failed");
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
            await resendOTP();
            setSuccess("New code sent!");
            setCooldown(RESEND_COOLDOWN_SEC);
            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            if (err.retryAfterSec) setCooldown(Math.min(err.retryAfterSec, 3600));
            setError(err.message || "Failed to resend code");
        } finally {
            setResending(false);
        }
    }

    async function handleSignOut() {
        await logout();
        navigate("/login", { replace: true });
    }

    return (
        <AuthPanel>
            <AuthBadge icon={MailCheck} />
            <AuthHeading
                persistent
                title="Check your email"
                subtitle={
                    <>
                        We sent a 6-digit code to <span className="font-medium text-base-content [overflow-wrap:anywhere]">{email}</span>. It expires in 10 minutes.
                    </>
                }
            />

            {error && <AuthAlert>{error}</AuthAlert>}
            {success && <AuthAlert kind="success">{success}</AuthAlert>}

            <form onSubmit={handleVerify}>
                <fieldset className="min-w-0" disabled={loading || !!success && success.startsWith("Email verified")}>
                    <legend className="sr-only">Verification code</legend>
                    <div className="grid grid-cols-6 gap-2 sm:gap-2.5" onPaste={handlePaste}>
                        {code.map((digit, idx) => (
                            <input
                                key={idx}
                                id={`otp-${idx}`}
                                ref={(el) => (inputRefs.current[idx] = el)}
                                type="text"
                                inputMode="numeric"
                                autoComplete={idx === 0 ? "one-time-code" : "off"}
                                pattern="\d"
                                maxLength={1}
                                value={digit}
                                onChange={(e) => handleDigit(idx, e.target.value)}
                                onKeyDown={(e) => handleKeyDown(idx, e)}
                                onFocus={(e) => e.target.select()}
                                aria-label={`Digit ${idx + 1} of 6`}
                                className={`h-[calc(var(--auth-field)*1.25)] min-w-0 w-full rounded-lg border bg-base-200/70 px-0 text-center text-xl font-semibold text-base-content outline-none transition-colors
                                    focus:border-primary focus:bg-base-200 focus:ring-2 focus:ring-primary/30 ${digit ? "border-primary/50" : "border-base-content/12"}`}
                            />
                        ))}
                    </div>
                </fieldset>

                <div className="mt-[var(--auth-gap-lg)]">
                    <AuthSubmit id="otp-verify-btn" loading={loading} loadingText="Verifying…" disabled={loading || code.join("").length < 6}>
                        Verify email
                    </AuthSubmit>
                </div>
            </form>

            <p className="mt-[var(--auth-gap-lg)] text-center text-sm text-base-content/60">
                Didn’t get it?{" "}
                <button
                    id="otp-resend-btn"
                    type="button"
                    onClick={handleResend}
                    disabled={resending || cooldown > 0}
                    className="font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:text-base-content/40 disabled:no-underline">
                    {resending ? "Sending…" : cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                </button>
            </p>
            <p className="mt-2 text-center text-xs text-base-content/45">
                Wrong account?{" "}
                <button id="otp-signout-btn" type="button" className="underline decoration-base-content/30 underline-offset-2 hover:text-base-content/80" onClick={handleSignOut}>
                    Sign out
                </button>
            </p>
        </AuthPanel>
    );
}
