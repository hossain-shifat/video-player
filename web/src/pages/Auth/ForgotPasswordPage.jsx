import { useEffect, useRef, useState } from "react";
import { useNavigate, Link } from "react-router";
import { Mail, Lock, KeyRound, ChevronLeft, ShieldCheck } from "lucide-react";
import { authApi } from "../../Api/auth";
import { AuthPanel, AuthHeading, AuthAlert, AuthField, AuthSubmit, AuthBadge, StepTransition } from "../../Components/Auth/AuthUI";

const RESEND_COOLDOWN_SEC = 60;

// /forgot-password — three short stages on one route:
//   1. email → "Send reset code"        (server answers identically whether or not the account exists)
//   2. code + new password → "Reset"    (the server revokes every session of the account)
//   3. done → back to /login with a success notice
export default function ForgotPasswordPage() {
    const navigate = useNavigate();
    const [stage, setStage] = useState("request"); // request | reset
    const [dir, setDir] = useState("fwd");
    const [email, setEmail] = useState("");
    const [code, setCode] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [info, setInfo] = useState(null);
    const [cooldown, setCooldown] = useState(0);
    const firstRef = useRef(null);

    useEffect(() => {
        if (cooldown <= 0) return undefined;
        const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
        return () => clearTimeout(t);
    }, [cooldown]);

    useEffect(() => {
        firstRef.current?.focus();
    }, [stage]);

    async function sendCode(e) {
        e?.preventDefault();
        setError(null);
        setInfo(null);
        setLoading(true);
        try {
            await authApi.forgotPassword(email.trim());
            setDir("fwd");
            setStage("reset");
            setCooldown(RESEND_COOLDOWN_SEC);
        } catch (err) {
            setError(err.message || "Couldn’t send the code. Try again.");
        } finally {
            setLoading(false);
        }
    }

    async function resend() {
        setError(null);
        setInfo(null);
        try {
            await authApi.forgotPassword(email.trim());
            setCooldown(RESEND_COOLDOWN_SEC);
            setInfo("If the account exists, a new code is on its way.");
        } catch (err) {
            setError(err.message || "Couldn’t resend the code.");
        }
    }

    async function reset(e) {
        e.preventDefault();
        setError(null);
        if (!/^\d{6}$/.test(code)) {
            setError("Enter the 6-digit code from your email.");
            return;
        }
        if (password.length < 8 || password.length > 128) {
            setError("Use a password between 8 and 128 characters.");
            return;
        }
        setLoading(true);
        try {
            await authApi.resetPassword(email.trim(), code, password);
            navigate("/login", { replace: true, state: { notice: "Password updated. Sign in with your new password." } });
        } catch (err) {
            if (err.apiCode === "RESET_CODE_INVALID") setError("That code is invalid or has expired. Request a new one below.");
            else setError(err.message || "Couldn’t reset the password.");
        } finally {
            setLoading(false);
        }
    }

    if (stage === "request") {
        return (
            <AuthPanel>
                <StepTransition stepKey="request" dir={dir}>
                <AuthBadge icon={KeyRound} />
                <AuthHeading title="Forgot your password?" subtitle="Enter your account email and we’ll send you a 6-digit code to reset it." />
                {error && <AuthAlert>{error}</AuthAlert>}
                <form onSubmit={sendCode} className="flex flex-col gap-[var(--auth-gap)]">
                    <AuthField
                        id="forgot-email"
                        ref={firstRef}
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
                    <AuthSubmit id="forgot-submit" loading={loading} loadingText="Sending…">
                        Send reset code
                    </AuthSubmit>
                </form>
                <p className="mt-[var(--auth-gap-lg)] text-center text-sm text-base-content/60">
                    <Link to="/login" className="inline-flex items-center gap-1 font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary">
                        <ChevronLeft size={15} aria-hidden="true" />
                        Back to sign in
                    </Link>
                </p>
                </StepTransition>
            </AuthPanel>
        );
    }

    return (
        <AuthPanel>
            <StepTransition stepKey="reset" dir={dir}>
            <AuthBadge icon={ShieldCheck} />
            <AuthHeading
                persistent
                title="Choose a new password"
                subtitle={
                    <>
                        If <span className="font-medium text-base-content [overflow-wrap:anywhere]">{email}</span> has an account, we sent it a code. Enter it below.
                    </>
                }
            />
            {info && <AuthAlert kind="success">{info}</AuthAlert>}
            {error && <AuthAlert>{error}</AuthAlert>}
            <form onSubmit={reset} className="flex flex-col gap-[var(--auth-gap)]">
                <AuthField
                    id="reset-code"
                    ref={firstRef}
                    label="6-digit code"
                    icon={KeyRound}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    required
                />
                <AuthField
                    id="reset-password"
                    label="New password"
                    icon={Lock}
                    type="password"
                    autoComplete="new-password"
                    placeholder="Create a new password"
                    hint="Use at least 8 characters."
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    maxLength={128}
                />
                <AuthSubmit id="reset-submit" loading={loading} loadingText="Updating…">
                    Reset password
                </AuthSubmit>
            </form>
            <p className="mt-[var(--auth-gap-lg)] text-center text-sm text-base-content/60">
                Didn’t get a code?{" "}
                <button
                    id="reset-resend"
                    type="button"
                    onClick={resend}
                    disabled={cooldown > 0}
                    className="font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:text-base-content/40 disabled:no-underline">
                    {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                </button>
            </p>
            <p className="mt-2 text-center text-xs text-base-content/45">
                <button type="button" onClick={() => {
                    setDir("back");
                    setStage("request");
                }} className="underline decoration-base-content/30 underline-offset-2 hover:text-base-content/80">
                    Use a different email
                </button>
            </p>
            </StepTransition>
        </AuthPanel>
    );
}
