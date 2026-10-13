import { X } from "lucide-react";
import { useEffect, useState, useCallback } from "react";

export const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const BTN = `inline-flex items-center justify-center gap-1.5 min-h-10 rounded-md px-3.5 py-2 text-[13px] font-medium transition-colors cursor-pointer sm:min-h-9 disabled:opacity-40 disabled:cursor-not-allowed ${FOCUS}`;

// ─── Prefs storage (single source of truth for the player too) ────────────────
// Player / other pages can read settings with:  loadPrefs().seekStep  etc.
// Same-tab listeners: window.addEventListener("flux-prefs-changed", e => e.detail)
export const PREFS_KEY = "flux-prefs";
export const PIN_KEY = "flux-pin";

export function loadPrefs() {
    try {
        const v = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
        return v && typeof v === "object" && !Array.isArray(v) ? v : {};
    } catch {
        return {};
    }
}

export function savePrefs(next) {
    try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {}
    try {
        window.dispatchEvent(new CustomEvent("flux-prefs-changed", { detail: next }));
    } catch {}
}

// ─── Restricted-content rules ─────────────────────────────────────────────────
export const RATING_RANK = {
    "TV-Y": 1,
    "TV-Y7": 1,
    "TV-G": 1,
    G: 1,
    "TV-PG": 2,
    PG: 2,
    "TV-14": 3,
    "PG-13": 3,
    "TV-MA": 4,
    R: 4,
    "NC-17": 5,
};

export const RATING_LIMITS = [
    { id: "all", label: "No limit", rank: 99, desc: "Everything in your library is visible." },
    { id: "G", label: "G", rank: 1, desc: "Everyone. Only G, TV-Y and TV-G titles." },
    { id: "PG", label: "PG", rank: 2, desc: "Parental guidance. Up to PG and TV-PG." },
    { id: "PG-13", label: "PG-13", rank: 3, desc: "Teens 13 and up. Up to PG-13 and TV-14." },
    { id: "R", label: "R", rank: 4, desc: "Restricted. Up to R and TV-MA, hides anything stricter." },
];

const COMPACT = { PG13: "PG-13", TV14: "TV-14", TVMA: "TV-MA", TVPG: "TV-PG", TVG: "TV-G", TVY: "TV-Y", TVY7: "TV-Y7", NC17: "NC-17" };

function normRating(s) {
    if (typeof s !== "string") return null;
    let v = s
        .trim()
        .toUpperCase()
        .replace(/^US[:\s-]+/, "")
        .replace(/\s+/g, "");
    v = COMPACT[v] || v;
    return RATING_RANK[v] ? { label: v, rank: RATING_RANK[v] } : null;
}

function pickRating(raw) {
    if (raw == null) return null;
    if (typeof raw === "string") return normRating(raw);
    if (Array.isArray(raw)) {
        const parsed = raw
            .map((e) =>
                typeof e === "string"
                    ? { c: "", r: normRating(e) }
                    : { c: String(e?.country || e?.iso_3166_1 || e?.region || "").toUpperCase(), r: normRating(e?.rating ?? e?.certification ?? e?.cert ?? e?.value) },
            )
            .filter((x) => x.r);
        return (parsed.find((x) => x.c === "US") || parsed[0])?.r || null;
    }
    if (typeof raw === "object") {
        const us = raw.US ?? raw.us;
        if (us != null) return pickRating(us);
        for (const key of Object.keys(raw)) {
            const r = pickRating(raw[key]);
            if (r) return r;
        }
    }
    return null;
}

/** Returns { label, rank } or null when the title has no known rating. */
export function getItemRating(item) {
    const m = item?.metadata ?? item;
    return pickRating(m?.certification) ?? pickRating(m?.certifications) ?? pickRating(m?.contentRating);
}

/** true = title may be shown under the current restriction prefs */
export function isAllowedByPrefs(item, prefs = loadPrefs()) {
    const limit = RATING_LIMITS.find((l) => l.id === (prefs.maxRating ?? "all")) || RATING_LIMITS[0];
    const rating = getItemRating(item);
    if (!rating) return !prefs.blockUnrated;
    return rating.rank <= limit.rank;
}

/** Hook for any page: const { filter } = useContentFilter();  filter(movies) */
export function useContentFilter() {
    const [prefs, setPrefs] = useState(loadPrefs);
    useEffect(() => {
        const on = () => setPrefs(loadPrefs());
        window.addEventListener("flux-prefs-changed", on);
        window.addEventListener("storage", on);
        return () => {
            window.removeEventListener("flux-prefs-changed", on);
            window.removeEventListener("storage", on);
        };
    }, []);
    const filter = useCallback((items) => (Array.isArray(items) ? items.filter((i) => isAllowedByPrefs(i, prefs)) : items), [prefs]);
    return { filter, prefs };
}

// ─── PIN (soft lock — stops casual changes, not a security boundary) ─────────
function cyrb53(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

// Pure JS on purpose: crypto.subtle is missing on plain-http LAN addresses.
function hashPin(pin, salt) {
    let out = `${salt}:${pin}`;
    for (let i = 0; i < 2000; i++) out = cyrb53(out, i).toString(36);
    return out;
}

function readPin() {
    try {
        const p = JSON.parse(localStorage.getItem(PIN_KEY) || "null");
        return p && p.hash && p.salt ? p : null;
    } catch {
        return null;
    }
}

export const hasPin = () => !!readPin();
export const isValidPin = (pin) => /^\d{4,6}$/.test(pin);

export function setPin(pin) {
    const salt = Math.random().toString(36).slice(2, 10);
    localStorage.setItem(PIN_KEY, JSON.stringify({ salt, hash: hashPin(pin, salt) }));
}

export function checkPin(pin) {
    const p = readPin();
    return !!p && hashPin(pin, p.salt) === p.hash;
}

export function removePin() {
    localStorage.removeItem(PIN_KEY);
}

// ─── Primitives ───────────────────────────────────────────────────────────────
export function ThemeSwatch({ preview, size = "md" }) {
    const h = size === "sm" ? "h-4" : "h-5";
    return (
        <span className={`flex items-center shrink-0 rounded-sm overflow-hidden ring-1 ring-base-content/15 ${h}`} style={{ width: size === "sm" ? 36 : 44 }}>
            <span className="flex-1 h-full" style={{ background: preview?.base || "#111" }} />
            <span className="flex-1 h-full" style={{ background: preview?.primary || "#666" }} />
            <span className="flex-1 h-full" style={{ background: preview?.accent || "#444" }} />
        </span>
    );
}

export function Toggle({ value, onChange, disabled, label }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={!!value}
            aria-label={label}
            disabled={disabled}
            onClick={() => onChange(!value)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${FOCUS}
                ${value ? "bg-primary" : "bg-base-content/25"}
                ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}>
            <span className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white transition-transform duration-150 ${value ? "translate-x-5" : ""}`} />
        </button>
    );
}

/** stack = control drops under the label on mobile (use for sliders / segmented controls). id = search anchor */
export function Row({ id, label, desc, children, danger, stack }) {
    return (
        <div
            id={id}
            className={`scroll-mt-28 flex gap-3 px-4 py-3.5 sm:px-5 border-b border-base-content/10 last:border-b-0
            ${stack ? "flex-col sm:flex-row sm:items-center sm:justify-between sm:gap-6" : "items-center justify-between gap-4"}`}>
            <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium leading-tight ${danger ? "text-error" : "text-base-content"}`}>{label}</p>
                {desc && <div className="mt-0.5 text-[13px] leading-snug text-base-content/60">{desc}</div>}
            </div>
            <div className={stack ? "w-full sm:w-72 sm:shrink-0" : "shrink-0"}>{children}</div>
        </div>
    );
}

export function Card({ children, className = "" }) {
    return <div className={`rounded-md border border-base-content/10 bg-base-200 overflow-hidden ${className}`}>{children}</div>;
}

export function SectionLabel({ children, icon: Icon, hint }) {
    return (
        <div className="mb-2 px-1">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-base-content">
                {Icon && <Icon size={14} className="text-base-content/50" />}
                {children}
            </h3>
            {hint && <p className="mt-0.5 text-[13px] text-base-content/55">{hint}</p>}
        </div>
    );
}

const CHIP = {
    neutral: "text-base-content/80 bg-base-content/10 border-base-content/20",
    primary: "text-primary bg-primary/10 border-primary/35",
    success: "text-success bg-success/10 border-success/35",
    warning: "text-warning bg-warning/10 border-warning/35",
    error: "text-error bg-error/10 border-error/35",
};

export function Chip({ children, tone = "neutral", className = "" }) {
    return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-0.5 text-xs font-medium ${CHIP[tone]} ${className}`}>{children}</span>;
}

const TONE = { default: "text-primary", ok: "text-success", warn: "text-warning", danger: "text-error", muted: "text-base-content/50" };

export function StatTile({ icon: Icon, label, value, tone = "default" }) {
    return (
        <div className="flex min-w-0 items-center gap-3 bg-base-200 px-4 py-3.5 sm:px-5">
            {Icon && <Icon size={20} className={`shrink-0 ${TONE[tone]}`} />}
            <div className="min-w-0">
                <p className="truncate text-base font-semibold leading-tight text-base-content">{value}</p>
                <p className="mt-0.5 truncate text-xs text-base-content/60">{label}</p>
            </div>
        </div>
    );
}

export function StatGrid({ children, cols = "grid-cols-2 lg:grid-cols-4" }) {
    return (
        <div className="overflow-hidden rounded-md border border-base-content/10 bg-base-content/10">
            <div className={`grid gap-px ${cols}`}>{children}</div>
        </div>
    );
}

const NOTICE = {
    info: "border-primary/35 bg-primary/10 text-primary",
    ok: "border-success/35 bg-success/10 text-success",
    warn: "border-warning/40 bg-warning/10 text-warning",
    error: "border-error/40 bg-error/10 text-error",
};

export function Notice({ tone = "info", icon: Icon, title, children }) {
    return (
        <div role={tone === "error" ? "alert" : "status"} className={`flex items-start gap-3 rounded-md border px-4 py-3.5 ${NOTICE[tone]}`}>
            {Icon && <Icon size={18} className="mt-0.5 shrink-0" />}
            <div className="min-w-0">
                {title && <p className="text-sm font-semibold">{title}</p>}
                {children && <div className="mt-0.5 text-[13px] leading-relaxed text-base-content/80">{children}</div>}
            </div>
        </div>
    );
}

export function DangerButton({ onClick, children, loading, className = "" }) {
    return (
        <button type="button" onClick={onClick} disabled={loading} className={`${BTN} border border-error/40 text-error hover:bg-error/10 ${className}`}>
            {children}
        </button>
    );
}

export function PrimaryButton({ onClick, children, loading, disabled, className = "" }) {
    return (
        <button type="button" onClick={onClick} disabled={disabled || loading} className={`${BTN} bg-primary text-primary-content hover:brightness-110 ${className}`}>
            {loading && <span className="loading loading-spinner loading-xs" />}
            {children}
        </button>
    );
}

export function GhostButton({ onClick, children, className = "", disabled }) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={`${BTN} border border-base-content/20 text-base-content/85 hover:bg-base-content/10 hover:text-base-content ${className}`}>
            {children}
        </button>
    );
}

export function Input({ id, name, value, onChange, onKeyDown, placeholder, type = "text", autoFocus, mono, className = "", inputMode, maxLength, disabled, autoComplete }) {
    return (
        <input
            id={id}
            name={name}
            type={type}
            value={value}
            onChange={onChange}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            autoFocus={autoFocus}
            inputMode={inputMode}
            maxLength={maxLength}
            disabled={disabled}
            autoComplete={autoComplete}
            className={`input input-sm h-9 w-full rounded-md bg-base-100 border-base-content/20 text-[13px] text-base-content placeholder:text-base-content/40 focus:border-primary ${mono ? "font-mono" : ""} ${className}`}
        />
    );
}

export function Select({ id, name, value, onChange, children, className = "", disabled }) {
    return (
        <select
            id={id}
            name={name}
            value={value}
            onChange={onChange}
            disabled={disabled}
            className={`select select-sm h-9 rounded-md bg-base-100 border-base-content/20 text-[13px] text-base-content focus:border-primary ${className}`}>
            {children}
        </select>
    );
}

export function Field({ id, label, required, hint, children }) {
    return (
        <div className="space-y-1.5">
            <label htmlFor={id} className="block text-[13px] font-medium text-base-content">
                {label} {required && <span className="text-error">*</span>}
            </label>
            {children}
            {hint && <p className="text-xs text-base-content/55">{hint}</p>}
        </div>
    );
}

/** Pill-group selector. opts: [{ id, label }] */
export function Seg({ opts, value, onChange, className = "", disabled }) {
    return (
        <div role="radiogroup" aria-disabled={disabled || undefined} className={`flex flex-wrap gap-1 rounded-md bg-base-300 p-1 ${disabled ? "pointer-events-none opacity-45" : ""} ${className}`}>
            {opts.map((o) => {
                const on = value === o.id;
                return (
                    <button
                        key={o.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        disabled={disabled}
                        onClick={() => onChange(o.id)}
                        className={`flex-1 whitespace-nowrap rounded-[4px] px-2.5 py-1.5 text-[13px] font-medium transition-colors cursor-pointer ${FOCUS}
                        ${on ? "bg-primary text-primary-content" : "text-base-content/70 hover:text-base-content hover:bg-base-content/10"}`}>
                        {o.label}
                    </button>
                );
            })}
        </div>
    );
}

/** Range slider with live value. Thumb styles (.flux-range) live in Settings.jsx */
export function Slider({ value, onChange, min, max, step = 1, fmt, label, disabled }) {
    const pct = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
    return (
        <div className={`flex items-center gap-3 ${disabled ? "pointer-events-none opacity-45" : ""}`}>
            <input
                type="range"
                aria-label={label}
                min={min}
                max={max}
                step={step}
                value={value}
                disabled={disabled}
                onChange={(e) => onChange(parseFloat(e.target.value))}
                className="flux-range flex-1"
                style={{ background: `linear-gradient(to right, var(--color-primary) ${pct}%, color-mix(in oklab, var(--color-base-content) 22%, transparent) ${pct}%)` }}
            />
            <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-base-content/70">{fmt ? fmt(value) : value}</span>
        </div>
    );
}

export function Modal({ open, onClose, title, subtitle, children, width = "max-w-md" }) {
    useEffect(() => {
        if (!open) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        const onKey = (e) => e.key === "Escape" && onClose?.();
        window.addEventListener("keydown", onKey);
        return () => {
            document.body.style.overflow = prev;
            window.removeEventListener("keydown", onKey);
        };
    }, [open, onClose]);
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[2147483647] flex items-end justify-center bg-black/70 sm:items-center sm:p-4" onClick={onClose}>
            <div
                role="dialog"
                aria-modal="true"
                aria-label={title}
                className={`w-full ${width} max-h-[92vh] overflow-y-auto rounded-t-md border border-base-content/15 bg-base-200 p-5 shadow-2xl sm:rounded-md sm:p-6`}
                style={{ animation: "modalIn .16s ease-out both" }}
                onClick={(e) => e.stopPropagation()}>
                <div className="mb-5 flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <h3 className="text-base font-semibold leading-tight text-base-content">{title}</h3>
                        {subtitle && <p className="mt-1 text-[13px] leading-snug text-base-content/65">{subtitle}</p>}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close"
                        className={`-mr-1.5 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-md text-base-content/60 transition-colors hover:bg-base-content/10 hover:text-base-content cursor-pointer ${FOCUS}`}>
                        <X size={16} strokeWidth={2.2} />
                    </button>
                </div>
                {children}
            </div>
            <style>{`@keyframes modalIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}@media (prefers-reduced-motion:reduce){[role=dialog]{animation:none!important}}`}</style>
        </div>
    );
}

/** Standard destructive confirmation — Cancel + red action */
export function ConfirmModal({ open, onClose, title, subtitle, confirmLabel = "Confirm", onConfirm, loading, children }) {
    return (
        <Modal open={open} onClose={onClose} title={title} subtitle={subtitle}>
            {children}
            <div className="mt-5 flex gap-2">
                <GhostButton onClick={onClose} className="flex-1">
                    Cancel
                </GhostButton>
                <button type="button" onClick={onConfirm} disabled={loading} className={`${BTN} flex-1 bg-error text-error-content hover:brightness-110`}>
                    {loading && <span className="loading loading-spinner loading-xs" />}
                    {confirmLabel}
                </button>
            </div>
        </Modal>
    );
}

/** Asks for the restriction PIN. Calls onVerified() when it matches. */
export function PinModal({ open, onClose, onVerified, title = "Enter PIN", subtitle = "This action is protected by your restriction PIN." }) {
    const [value, setValue] = useState("");
    const [error, setError] = useState(null);

    useEffect(() => {
        if (open) {
            setValue("");
            setError(null);
        }
    }, [open]);

    function submit() {
        if (checkPin(value)) {
            onVerified?.();
        } else {
            setError("Wrong PIN. Try again.");
            setValue("");
        }
    }

    return (
        <Modal open={open} onClose={onClose} title={title} subtitle={subtitle}>
            <div className="space-y-4">
                {error && (
                    <p role="alert" className="rounded-md border border-error/35 bg-error/10 px-3 py-2 text-[13px] text-error">
                        {error}
                    </p>
                )}
                <Field id="pin-check" label="PIN">
                    <Input
                        id="pin-check"
                        name="pin-check"
                        type="password"
                        inputMode="numeric"
                        maxLength={6}
                        autoComplete="off"
                        value={value}
                        onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
                        onKeyDown={(e) => e.key === "Enter" && submit()}
                        placeholder="4 to 6 digits"
                        autoFocus
                        mono
                    />
                </Field>
                <div className="flex gap-2">
                    <GhostButton onClick={onClose} className="flex-1">
                        Cancel
                    </GhostButton>
                    <PrimaryButton onClick={submit} disabled={value.length < 4} className="flex-1">
                        Unlock
                    </PrimaryButton>
                </div>
            </div>
        </Modal>
    );
}

// Tiny helper used by a few sections
export async function copyText(text) {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {}
    // plain-http LAN addresses have no navigator.clipboard
    try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return ok;
    } catch {
        return false;
    }
}
