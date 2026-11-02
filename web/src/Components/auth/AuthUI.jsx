// web/src/Components/auth/AuthUI.jsx
// Small shared kit for the full-page auth screens (login / register / verify / status pages).
// Everything is built from daisyUI/Tailwind theme tokens (base-*, primary, accent, error…) so the
// pages follow whichever FLUX theme is active — Cinema, AMOLED, Slate or Light Studio.
// Sizes read the --auth-* variables set by AuthLayout, which shrink on short screens so the
// page never needs to scroll.

import { useId, useLayoutEffect, useRef, useState } from "react";
import { staggerIn } from "./motion";
import { Eye, EyeOff, AlertCircle, CheckCircle2 } from "lucide-react";

export function AuthHeading({ title, subtitle, persistent = false, className = "" }) {
    return (
        <div className={`mb-[var(--auth-gap-lg)] ${className}`}>
            <h1 className="font-circular text-[1.7rem] leading-[1.15] tracking-tight text-base-content">{title}</h1>
            {subtitle && <p className={`${persistent ? "" : "auth-sub"} mt-1.5 text-sm leading-relaxed text-base-content/60`}>{subtitle}</p>}
        </div>
    );
}

export function AuthAlert({ kind = "error", children }) {
    const isError = kind === "error";
    const Icon = isError ? AlertCircle : CheckCircle2;
    return (
        <div
            role={isError ? "alert" : "status"}
            className={`mb-[var(--auth-gap)] flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[13px] leading-snug ${
                isError ? "border-error/35 bg-error/10 text-error" : "border-success/35 bg-success/10 text-success"
            }`}>
            <Icon size={16} className="mt-px shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words">{children}</span>
        </div>
    );
}

/** Labelled text input. `type="password"` gets a show/hide toggle. */
export function AuthField({ label, labelAside, hint, icon: Icon, type = "text", id, className = "", ref, ...rest }) {
    const auto = useId();
    const inputId = id || auto;
    const [shown, setShown] = useState(false);
    const isPassword = type === "password";

    return (
        <div className={`min-w-0 ${className}`}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <label htmlFor={inputId} className="text-[13px] font-medium text-base-content/80">
                    {label}
                </label>
                {labelAside}
            </div>
            <div className="relative">
                {Icon && <Icon size={16} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-base-content/40" />}
                <input
                    id={inputId}
                    ref={ref}
                    type={isPassword && shown ? "text" : type}
                    className={`block h-[var(--auth-field)] w-full min-w-0 rounded-lg border border-base-content/12 bg-base-200/70 text-sm text-base-content outline-none transition-colors
                        placeholder:text-base-content/35 hover:border-base-content/25 focus:border-primary focus:bg-base-200 focus:ring-2 focus:ring-primary/30
                        ${Icon ? "pl-10" : "pl-3.5"} ${isPassword ? "pr-11" : "pr-3.5"}`}
                    {...rest}
                />
                {isPassword && (
                    <button
                        type="button"
                        onClick={() => setShown((s) => !s)}
                        aria-label={shown ? "Hide password" : "Show password"}
                        aria-pressed={shown}
                        className="absolute top-1/2 right-1.5 flex h-8 w-8 cursor-pointer -translate-y-1/2 items-center justify-center rounded-md text-base-content/50 transition-colors hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary">
                        {shown ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                )}
            </div>
            {hint && <p className="auth-hint mt-1.5 text-xs text-base-content/50">{hint}</p>}
        </div>
    );
}

export function AuthSubmit({ loading, children, loadingText, ...rest }) {
    return (
        <button
            type="submit"
            disabled={loading}
            className="flex h-[var(--auth-field)] w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-content shadow-lg shadow-primary/20 transition
                hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            {...rest}>
            {loading && <span className="loading loading-spinner loading-xs" aria-hidden="true" />}
            {loading ? loadingText || "Please wait…" : children}
        </button>
    );
}

function GoogleMark() {
    return (
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.2C12.4 13.6 17.7 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.1 5.5c4.3-4 6.8-9.9 6.8-16.9z" />
            <path fill="#FBBC05" d="M10.5 28.6a14.5 14.5 0 0 1 0-9.2l-7.9-6.2a24 24 0 0 0 0 21.6l7.9-6.2z" />
            <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.1-5.5c-2 1.4-4.6 2.3-8.8 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.2C6.5 42.6 14.6 48 24 48z" />
        </svg>
    );
}

export function GoogleButton({ onClick, children = "Continue with Google", ...rest }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="flex h-[var(--auth-field)] w-full cursor-pointer items-center justify-center gap-2.5 rounded-lg border border-base-content/15 bg-base-200/40 text-sm font-medium text-base-content transition-colors
                hover:border-base-content/30 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            {...rest}>
            <GoogleMark />
            {children}
        </button>
    );
}

export function OrDivider({ children = "or" }) {
    return (
        <div className="my-[var(--auth-gap)] flex items-center gap-3 text-xs text-base-content/40" role="separator">
            <span className="h-px flex-1 bg-base-content/12" />
            {children}
            <span className="h-px flex-1 bg-base-content/12" />
        </div>
    );
}

/** The column every auth form sits in. The surface itself (sheet / split panel) comes from AuthLayout. */
export function AuthPanel({ children, className = "" }) {
    return <div className={`w-full max-w-[26rem] ${className}`}>{children}</div>;
}

/** Slides its content in when `stepKey` changes (direction "fwd" | "back") and staggers the content. Classes live in AuthLayout's CSS. */
export function StepTransition({ stepKey, dir = "fwd", children }) {
    const ref = useRef(null);
    useLayoutEffect(() => {
        staggerIn(ref.current, { delay: 60 });
    }, []);
    return (
        <div key={stepKey} ref={ref} className={dir === "back" ? "auth-in-back" : "auth-in-fwd"}>
            {children}
        </div>
    );
}

/** Two-segment progress bar for multi-step forms (announced to screen readers as "Step n of total"). */
export function StepBar({ step, total = 2 }) {
    return (
        <div role="img" aria-label={`Step ${step} of ${total}`} className="mb-[var(--auth-gap)] flex gap-1.5">
            {Array.from({ length: total }, (_, i) => (
                <span key={i} className={`h-1 flex-1 rounded-full transition-colors duration-300 ${i < step ? "bg-primary" : "bg-base-content/15"}`} />
            ))}
        </div>
    );
}

/** Round icon badge used on the status pages (pending / expired / denied / verify). */
export function AuthBadge({ icon: Icon, tone = "primary" }) {
    const tones = {
        primary: "border-primary/30 bg-primary/10 text-primary",
        warning: "border-warning/30 bg-warning/10 text-warning",
        error: "border-error/30 bg-error/10 text-error",
    };
    return (
        <div className={`mb-[var(--auth-gap-lg)] flex h-12 w-12 items-center justify-center rounded-full border ${tones[tone]}`}>
            <Icon size={22} aria-hidden="true" />
        </div>
    );
}
