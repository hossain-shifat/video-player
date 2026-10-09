import { X } from "lucide-react";
import { useEffect } from "react";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const BTN = `inline-flex items-center justify-center gap-1.5 min-h-10 rounded-field px-3.5 py-2 text-[13px] font-medium transition-colors cursor-pointer sm:min-h-9 disabled:opacity-40 disabled:cursor-not-allowed ${FOCUS}`;

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

/** stack = control drops under the label on mobile (use for sliders / segmented controls) */
export function Row({ label, desc, children, danger, stack }) {
    return (
        <div
            className={`flex gap-3 px-4 py-3.5 sm:px-5 border-b border-base-content/10 last:border-b-0
            ${stack ? "flex-col sm:flex-row sm:items-center sm:justify-between sm:gap-6" : "items-center justify-between gap-4"}`}>
            <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium leading-tight ${danger ? "text-error" : "text-base-content"}`}>{label}</p>
                {desc && <div className="mt-0.5 text-[13px] leading-snug text-base-content/60">{desc}</div>}
            </div>
            <div className={stack ? "w-full sm:w-64 sm:shrink-0" : "shrink-0"}>{children}</div>
        </div>
    );
}

export function Card({ children, className = "" }) {
    return <div className={`rounded-box border border-base-content/10 bg-base-200 overflow-hidden ${className}`}>{children}</div>;
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
        <button type="button" onClick={onClick} disabled={disabled} className={`${BTN} border border-base-content/20 text-base-content/85 hover:bg-base-content/10 hover:text-base-content ${className}`}>
            {children}
        </button>
    );
}

export function Input({ id, name, value, onChange, onKeyDown, placeholder, type = "text", autoFocus, mono, className = "" }) {
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
            className={`input input-sm h-9 w-full rounded-field bg-base-100 border-base-content/20 text-[13px] text-base-content placeholder:text-base-content/40 focus:border-primary ${mono ? "font-mono" : ""} ${className}`}
        />
    );
}

export function Select({ id, name, value, onChange, children, className = "" }) {
    return (
        <select
            id={id}
            name={name}
            value={value}
            onChange={onChange}
            className={`select select-sm h-9 rounded-field bg-base-100 border-base-content/20 text-[13px] text-base-content focus:border-primary ${className}`}>
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
export function Seg({ opts, value, onChange, className = "" }) {
    return (
        <div role="radiogroup" className={`flex flex-wrap gap-1 rounded-field bg-base-300 p-1 ${className}`}>
            {opts.map((o) => {
                const on = value === o.id;
                return (
                    <button
                        key={o.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => onChange(o.id)}
                        className={`flex-1 whitespace-nowrap rounded-[calc(var(--radius-field)-2px)] px-2.5 py-1.5 text-[13px] font-medium transition-colors cursor-pointer ${FOCUS}
                        ${on ? "bg-primary text-primary-content" : "text-base-content/70 hover:text-base-content hover:bg-base-content/10"}`}>
                        {o.label}
                    </button>
                );
            })}
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
        <div className="fixed inset-0 z-[9999999] flex items-end justify-center bg-black/70 sm:items-center sm:p-4" onClick={onClose}>
            <div
                role="dialog"
                aria-modal="true"
                aria-label={title}
                className={`w-full ${width} max-h-[92vh] overflow-y-auto rounded-t-box border border-base-content/15 bg-base-200 p-5 shadow-2xl sm:rounded-box sm:p-6`}
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
                        className={`-mr-1.5 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-field text-base-content/60 transition-colors hover:bg-base-content/10 hover:text-base-content cursor-pointer ${FOCUS}`}>
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
