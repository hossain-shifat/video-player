import { X } from "lucide-react";
import { useEffect } from "react";

// ─── Theme Swatch ─────────────────────────────────────────────────────────────
export function ThemeSwatch({ preview, size = "md" }) {
    const h = size === "sm" ? "h-4" : "h-5";
    return (
        <span className={`flex items-center gap-px shrink-0 rounded overflow-hidden ${h}`} style={{ width: size === "sm" ? 36 : 44 }}>
            <span className="flex-1 h-full" style={{ background: preview?.base || "#111" }} />
            <span className="flex-1 h-full" style={{ background: preview?.primary || "#666" }} />
            <span className="flex-1 h-full" style={{ background: preview?.accent || "#444" }} />
        </span>
    );
}

// ─── Toggle ───────────────────────────────────────────────────────────────────
export function Toggle({ value, onChange, disabled }) {
    return (
        <button
            role="switch"
            aria-checked={value}
            onClick={() => !disabled && onChange(!value)}
            style={{ outline: "none", boxShadow: "none" }}
            className={`relative inline-flex w-10 h-[22px] rounded-full transition-all duration-200 shrink-0 focus:outline-none
                ${value ? "bg-primary" : "bg-white/[0.12]"}
                ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}>
            <span
                className={`absolute top-[3px] left-[3px] w-4 h-4 rounded-full shadow-sm transition-transform duration-200
                ${value ? "translate-x-[18px] bg-white" : "translate-x-0 bg-white/40"}`}
            />
        </button>
    );
}

// ─── Setting Row ──────────────────────────────────────────────────────────────
export function Row({ label, desc, children, danger, noBorder }) {
    return (
        <div
            className={`flex items-center justify-between gap-6 px-5 py-[14px] transition-colors
            ${danger ? "hover:bg-error/[0.03]" : "hover:bg-white/[0.015]"}
            ${noBorder ? "" : "border-b border-white/[0.045] last:border-0"}`}>
            <div className="min-w-0 flex-1">
                <p className={`text-[13px] font-semibold leading-tight ${danger ? "text-error/85" : "text-white/95"}`}>{label}</p>
                {desc &&
                    (typeof desc === "string" ? <p className="text-[12px] text-white/55 mt-0.5 leading-snug">{desc}</p> : <div className="text-[12px] text-white/55 mt-0.5 leading-snug">{desc}</div>)}
            </div>
            <div className="shrink-0">{children}</div>
        </div>
    );
}

// ─── Section Card ─────────────────────────────────────────────────────────────
export function Card({ children, className = "" }) {
    return (
        <div className={`rounded-xl border border-white/[0.07] overflow-hidden ${className}`} style={{ background: "rgba(255,255,255,0.028)" }}>
            {children}
        </div>
    );
}

// ─── Section Header (label above a card group) ────────────────────────────────
export function SectionLabel({ children }) {
    return <p className="text-[11px] font-bold text-white/55 uppercase tracking-[0.12em] mb-2 px-1">{children}</p>;
}

// ─── Danger Button ────────────────────────────────────────────────────────────
export function DangerButton({ onClick, children, loading }) {
    return (
        <button
            onClick={onClick}
            disabled={loading}
            style={{ outline: "none" }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-error/25 text-error/75 hover:text-error hover:bg-error/10 hover:border-error/40 transition-all text-[12px] font-semibold disabled:opacity-40">
            {children}
        </button>
    );
}

// ─── Primary Button ───────────────────────────────────────────────────────────
export function PrimaryButton({ onClick, children, loading, disabled, size = "sm" }) {
    const pad = size === "xs" ? "px-2.5 py-1" : "px-3.5 py-2";
    const txt = size === "xs" ? "text-[12px]" : "text-[12.5px]";
    return (
        <button
            onClick={onClick}
            disabled={disabled || loading}
            style={{ outline: "none" }}
            className={`flex items-center gap-1.5 ${pad} rounded-lg bg-primary text-primary-content hover:opacity-90 transition-all ${txt} font-semibold border-none disabled:opacity-40`}>
            {loading && <span className="loading loading-spinner loading-xs" />}
            {children}
        </button>
    );
}

// ─── Ghost Button ─────────────────────────────────────────────────────────────
export function GhostButton({ onClick, children, className = "" }) {
    return (
        <button
            onClick={onClick}
            style={{ outline: "none" }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.12] text-white/65 hover:text-white hover:border-white/25 hover:bg-white/[0.07] transition-all text-[12.5px] font-medium ${className}`}>
            {children}
        </button>
    );
}

// ─── Input ────────────────────────────────────────────────────────────────────
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
            style={{ outline: "none", boxShadow: "none" }}
            className={`input input-sm w-full bg-white/[0.05] border border-white/[0.08] hover:border-white/[0.14] focus:border-primary/50 rounded-lg text-[13px] text-white transition-colors placeholder:text-white/35 ${mono ? "font-mono" : ""} ${className}`}
        />
    );
}

// ─── Select ───────────────────────────────────────────────────────────────────
export function Select({ id, name, value, onChange, children, className = "" }) {
    return (
        <select
            id={id}
            name={name}
            value={value}
            onChange={onChange}
            style={{ outline: "none" }}
            className={`select select-sm bg-white/[0.06] border border-white/[0.08] rounded-lg text-[13px] text-white focus:outline-none focus:border-primary/40 ${className}`}>
            {children}
        </select>
    );
}

// ─── Modal ────────────────────────────────────────────────────────────────────
export function Modal({ open, onClose, title, subtitle, children, width = "max-w-md" }) {
    useEffect(() => {
        document.body.style.overflow = open ? "hidden" : "unset";
        return () => {
            document.body.style.overflow = "unset";
        };
    }, [open]);
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[9999999] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)" }} onClick={onClose}>
            <div
                className={`w-full ${width} rounded-2xl border border-white/[0.09] shadow-2xl p-6 overflow-y-auto max-h-[90vh]`}
                style={{ background: "oklch(13% 0.01 260)", animation: "modalIn .15s ease-out both" }}
                onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start justify-between mb-6">
                    <div>
                        <h3 className="font-semibold text-white text-[15px] leading-tight">{title}</h3>
                        {subtitle && <p className="text-[12px] text-white/55 mt-1">{subtitle}</p>}
                    </div>
                    <button
                        onClick={onClose}
                        style={{ outline: "none" }}
                        className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-white/10 text-white/55 hover:text-white transition-colors ml-4 shrink-0 border-none cursor-pointer">
                        <X size={14} strokeWidth={2.5} />
                    </button>
                </div>
                {children}
            </div>
            <style>{`@keyframes modalIn{from{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}`}</style>
        </div>
    );
}
