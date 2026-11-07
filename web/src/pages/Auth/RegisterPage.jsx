import { useEffect, useRef, useState } from "react";
import { useNavigate, Link } from "react-router";
import { User, Mail, Lock, ChevronLeft } from "lucide-react";
import { useAuth } from "../../Auth/AuthContext";
import { authApi } from "../../Api/auth";
import { AuthPanel, AuthHeading, AuthAlert, AuthField, AuthSubmit, GoogleButton, OrDivider, StepBar, StepTransition } from "../../Components/Auth/AuthUI";
import { useMediaQuery } from "../../Hooks/Ui/useMediaQuery";

// Phones and short windows get a TWO-STEP sign-up (email first, then name + password): each screen has
// 2–3 controls, so nothing is cramped and nothing needs scrolling. Roomy screens keep the single form.
const COMPACT_QUERY = "(max-width: 767px), (max-height: 640px)";

function TermsNote() {
    return (
        <p className="text-center text-xs leading-relaxed text-base-content/50">
            By creating an account you agree to the{" "}
            <Link to="/terms" className="underline decoration-base-content/30 underline-offset-2 hover:text-base-content/80">
                Terms
            </Link>{" "}
            and{" "}
            <Link to="/privacy" className="underline decoration-base-content/30 underline-offset-2 hover:text-base-content/80">
                Privacy Policy
            </Link>
            .
        </p>
    );
}

export default function RegisterPage() {
    const { register } = useAuth();
    const navigate = useNavigate();
    const compact = useMediaQuery(COMPACT_QUERY);

    const [step, setStep] = useState(1); // only meaningful when `compact`
    const [dir, setDir] = useState("fwd"); // slide direction of the step change
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const showStep = compact ? step : 0; // 0 = everything on one screen
    const nameRef = useRef(null);
    const emailRef = useRef(null);

    // Move focus to the first field of the step the user just entered (keyboard / screen-reader friendly).
    useEffect(() => {
        if (!compact) return;
        (step === 2 ? nameRef : emailRef).current?.focus();
    }, [step, compact]);

    function goToStep2(e) {
        e.preventDefault();
        setError(null);
        setDir("fwd");
        setStep(2);
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setError(null);

        if (password.length < 8 || password.length > 128) {
            setError("Use a password between 8 and 128 characters.");
            return;
        }

        setLoading(true);
        try {
            const data = await register(email, password, name);
            // The server issued a restricted session, so /verify-email works after a refresh too —
            // nothing is passed through router state any more.
            navigate(data.requiresVerification === false ? "/" : "/verify-email", { replace: true, state: { codeSent: data.emailSent !== false, emailFailed: data.emailSent === false } });
        } catch (err) {
            setError(err.message || "Couldn’t create your account. Try again.");
            // e.g. "Email already registered" → send them back to the field that needs fixing
            if (compact && /email/i.test(err.message || "")) {
                setDir("back");
                setStep(1);
            }
        } finally {
            setLoading(false);
        }
    }

    const emailField = (
        <AuthField
            id="register-email"
            ref={emailRef}
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
    );
    const nameField = (
        <AuthField id="register-name" ref={nameRef} label="Full name" icon={User} autoComplete="name" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required />
    );
    const passwordField = (
        <AuthField
            id="register-password"
            label="Password"
            icon={Lock}
            type="password"
            autoComplete="new-password"
            placeholder="Create a password"
            hint="Use at least 8 characters."
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            maxLength={128}
        />
    );

    const social = (
        <>
            <OrDivider />
            <GoogleButton id="register-google" onClick={() => (window.location.href = authApi.googleLoginUrl())} />
        </>
    );
    const signInLink = (
        <p className="mt-[var(--auth-gap-lg)] text-center text-sm text-base-content/60">
            Already have an account?{" "}
            <Link to="/login" className="font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary">
                Sign in
            </Link>
        </p>
    );

    // ── Step 1 (compact): email ─────────────────────────────────────────────
    if (showStep === 1) {
        return (
            <AuthPanel>
                <StepTransition stepKey="s1" dir={dir}>
                <StepBar step={1} />
                <AuthHeading title="Create your account" subtitle="Start with your email. It takes a minute." />
                {error && <AuthAlert>{error}</AuthAlert>}
                <form onSubmit={goToStep2} className="flex flex-col gap-[var(--auth-gap)]">
                    {emailField}
                    <AuthSubmit id="register-continue">Continue</AuthSubmit>
                </form>
                {social}
                {signInLink}
                </StepTransition>
            </AuthPanel>
        );
    }

    // ── Step 2 (compact): name + password ───────────────────────────────────
    if (showStep === 2) {
        return (
            <AuthPanel>
                <StepTransition stepKey="s2" dir={dir}>
                <StepBar step={2} />
                <button
                    type="button"
                    id="register-back"
                    onClick={() => {
                        setDir("back");
                        setStep(1);
                    }}
                    className="-ml-1 mb-[var(--auth-gap)] inline-flex max-w-full items-center gap-1 rounded-md py-1 pr-2 text-[13px] text-base-content/60 hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary">
                    <ChevronLeft size={16} aria-hidden="true" className="shrink-0" />
                    <span className="truncate">{email || "Back"}</span>
                </button>
                <AuthHeading title="Almost there" subtitle="Add your name and choose a password." />
                {error && <AuthAlert>{error}</AuthAlert>}
                <form onSubmit={handleSubmit} className="flex flex-col gap-[var(--auth-gap)]">
                    {nameField}
                    {passwordField}
                    <div className="mt-1">
                        <AuthSubmit id="register-submit" loading={loading} loadingText="Creating account…">
                            Create account
                        </AuthSubmit>
                    </div>
                    <TermsNote />
                </form>
                </StepTransition>
            </AuthPanel>
        );
    }

    // ── Roomy screens: one form ─────────────────────────────────────────────
    return (
        <AuthPanel>
            <AuthHeading title="Create your account" subtitle="Browse the library right after you verify your email." />
            {error && <AuthAlert>{error}</AuthAlert>}
            <form onSubmit={handleSubmit} className="flex flex-col gap-[var(--auth-gap)]">
                {nameField}
                {emailField}
                {passwordField}
                <div className="mt-1">
                    <AuthSubmit id="register-submit" loading={loading} loadingText="Creating account…">
                        Create account
                    </AuthSubmit>
                </div>
                <TermsNote />
            </form>
            {social}
            {signInLink}
        </AuthPanel>
    );
}
