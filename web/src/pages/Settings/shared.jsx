import { X } from "lucide-react";
import { useEffect } from "react";

export function ThemeSwatch({ preview }) {
    return (
        <span className="flex items-center gap-0.5 shrink-0">
            <span className="w-3.5 h-6 rounded-l" style={{ background: preview.base, border: "1px solid rgba(255,255,255,0.1)" }} />
            <span className="w-3.5 h-6" style={{ background: preview.primary }} />
            <span className="w-3.5 h-6 rounded-r" style={{ background: preview.accent }} />
        </span>
    );
}

export function Toggle({ value, onChange }) {
    return (
        <button
            role="switch"
            aria-checked={value}
            onClick={() => onChange(!value)}
            style={{ outline: "none", boxShadow: "none" }}
            className={`relative inline-flex w-11 h-6 rounded-full transition-colors duration-200 cursor-pointer shrink-0 focus:outline-none focus-visible:outline-none ${
                value ? "bg-primary" : "bg-white/10"
            }`}>
            <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full shadow transition-transform duration-200 ${
                    value ? "translate-x-5 bg-white" : "translate-x-0 bg-white/60"
                }`}
            />
        </button>
    );
}

export function Row({ label, desc, children, danger }) {
    return (
        <div
            className={`flex items-center justify-between gap-6 px-5 py-4 border-b border-white/[0.06] last:border-0 transition-colors ${
                danger ? "hover:bg-error/5" : "hover:bg-white/[0.025]"
            }`}>
            <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium leading-tight ${danger ? "text-error" : "text-white"}`}>{label}</p>
                {desc && <p className="text-xs text-white/45 mt-0.5 leading-snug">{desc}</p>}
            </div>
            <div className="shrink-0">{children}</div>
        </div>
    );
}

export function SectionTitle({ children }) {
    return <h2 className="text-xl font-bold text-white mb-5">{children}</h2>;
}

export function Card({ children }) {
    return (
        <div className="bg-white/[0.04] rounded-xl border border-white/[0.08] overflow-hidden backdrop-blur-sm">
            {children}
        </div>
    );
}

export function Modal({ open, onClose, title, subtitle, children }) {
    useEffect(() => {
        if (open) {
            document.body.style.overflow = "hidden";
        } else {
            document.body.style.overflow = "unset";
        }
        return () => {
            document.body.style.overflow = "unset";
        };
    }, [open]);

    if (!open) return null;
    return (
        <div
            className="fixed inset-0 z-[9999999999999] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md"
            onClick={onClose}>
            <div
                className="w-full max-w-md bg-base-200 rounded-2xl border border-white/10 shadow-2xl p-6 overflow-y-auto max-h-[90vh]"
                onClick={(e) => e.stopPropagation()}
                style={{ animation: "fadeUp .16s ease-out both" }}>
                <div className="flex items-start justify-between mb-5">
                    <div>
                        <h3 className="font-semibold text-white text-base">{title}</h3>
                        {subtitle && <p className="text-xs text-white/40 mt-0.5">{subtitle}</p>}
                    </div>
                    <button
                        onClick={onClose}
                        style={{ outline: "none", boxShadow: "none" }}
                        className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10 text-white/60 hover:text-white transition-colors ml-4 shrink-0 focus:outline-none border-none cursor-pointer">
                        <X size={16} strokeWidth={2.5} />
                    </button>
                </div>
                {children}
            </div>
            <style>{`@keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>
        </div>
    );
}
