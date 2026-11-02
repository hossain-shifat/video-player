// web/src/dashboard/components/ConfirmModal.jsx
//
// Shared dialog primitives for the dashboard + the confirm dialog built on them.
// Built with daisyUI 5 components (modal, btn, badge, toggle, join, tabs, alert, avatar, card, input, timeline).
// Design rules for every modal built here: see MODAL_DESIGN_GUIDE.md
//
//   ModalShell    – daisyUI modal + portal, focus trap, Esc/backdrop close, scroll lock, focus restore.
//                   Every modal uses the same viewport-relative size (MODAL_SIZE). Scrollbars are always hidden.
//   ModalHeader   – avatar/icon + title/subtitle (+ badges row, right slot) + close button
//   ModalTabs     – daisyUI tabs (arrow-key navigation)
//   ModalBody     – scroll area (classic sizes)
//   PanelBody     – body for the fixed-size modal (content is designed to fit)
//   ModalAside    – icon + title + facts panel for PanelBody `aside`
//   ModalFooter   – action bar
//   Atoms         – ModalAvatar, ModalBadge, ModalButton, ModalSegmented, ModalToggle, ModalNote, ModalChange
//   ConfirmModal  – default export. Optional props: `timeline` and `note`.

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Trash2, ShieldAlert, Info, X, Check, Copy, AlertTriangle } from "lucide-react";

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
// Keep every modal proportional to the viewport instead of forcing a square or fixed max-width.
const MODAL_SIZE = "h-[75dvh]  w-[60dvw] max-h-[75dvh]  max-w-[60dvw]";

export const TONE = {
    neutral: "text-base-content/70",
    primary: "text-primary",
    success: "text-success",
    warning: "text-warning",
    error: "text-error",
    info: "text-info",
    accent: "text-accent",
};
// Same tinted-chip palette the rest of the app uses (shared.jsx Chip): text-X bg-X/10 border-X/35
const BADGE = {
    neutral: "text-base-content/80 bg-base-content/10 border-base-content/20",
    primary: "text-primary bg-primary/10 border-primary/35",
    success: "text-success bg-success/10 border-success/35",
    warning: "text-warning bg-warning/10 border-warning/40",
    error: "text-error bg-error/10 border-error/40",
    info: "text-info bg-info/10 border-info/35",
    accent: "text-accent bg-accent/10 border-accent/35",
};

// ─── Shell ────────────────────────────────────────────────────────────────────

export function ModalShell({ onClose, busy = false, labelledBy, describedBy, children }) {
    const panelRef = useRef(null);
    const closeRef = useRef(onClose);
    const busyRef = useRef(busy);
    closeRef.current = onClose;
    busyRef.current = busy;

    useEffect(() => {
        const previouslyFocused = document.activeElement;
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        const panel = panelRef.current;

        const t = setTimeout(() => {
            const target = panel?.querySelector("[data-autofocus]") || panel;
            target?.focus();
        }, 30);

        const onKey = (e) => {
            if (e.key === "Escape") {
                if (busyRef.current) return;
                e.stopPropagation();
                closeRef.current?.();
                return;
            }
            if (e.key !== "Tab" || !panel) return;
            const nodes = [...panel.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
            if (!nodes.length) return;
            const first = nodes[0];
            const last = nodes[nodes.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        };
        document.addEventListener("keydown", onKey, true);

        return () => {
            clearTimeout(t);
            document.removeEventListener("keydown", onKey, true);
            document.body.style.overflow = prevOverflow;
            previouslyFocused?.focus?.();
        };
    }, []);

    return createPortal(
        <div className="modal modal-open modal-middle bg-black/70 p-2 backdrop-blur-[3px]" style={{ zIndex: 99990 }}>
            <div className="absolute inset-0" onClick={() => !busy && onClose?.()} aria-hidden="true" />
            <div
                ref={panelRef}
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
                aria-labelledby={labelledBy}
                aria-describedby={describedBy}
                aria-busy={busy || undefined}
                className={`modal-box relative flex ${MODAL_SIZE} min-w-0 flex-col overflow-hidden rounded-lg border border-base-content/15 bg-base-200 p-0 shadow-2xl outline-none max-sm:w-[96dvw] max-sm:max-w-[96dvw]`}>
                {children}
            </div>
            <style>{`
                @media (prefers-reduced-motion: reduce) { .modal, .modal-box { transition: none !important } }
                [role="dialog"], [role="dialog"] * { scrollbar-width: none !important; -ms-overflow-style: none !important }
                [role="dialog"] *::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important }
            `}</style>
        </div>,
        document.body,
    );
}

// ─── Header / body / footer ───────────────────────────────────────────────────

/** daisyUI avatar. Pass `src` for a photo, otherwise the initial of `name` is shown. */
export function ModalAvatar({ name, src, className = "w-9", ring = "border-base-content/20" }) {
    const initial = (name || "U").trim()[0]?.toUpperCase() || "U";
    return src ? (
        <div className="avatar shrink-0">
            <div className={`${className} rounded-full border ${ring}`}>
                <img src={src} alt="" />
            </div>
        </div>
    ) : (
        <div className="avatar avatar-placeholder shrink-0">
            <div className={`${className} rounded-full border ${ring} bg-base-300 text-base-content`}>
                <span className="text-sm font-medium">{initial}</span>
            </div>
        </div>
    );
}

export function ModalHeader({ id, icon: Icon, tone = "text-primary", avatar, title, subtitle, badges, right, onClose, busy = false }) {
    return (
        <div className="flex shrink-0 items-center gap-3 px-6 py-3.5">
            {avatar ??
                (Icon && (
                    <div className="avatar avatar-placeholder shrink-0">
                        <div className={`w-10 rounded-full border border-current/35 bg-current/10 ${tone}`}>
                            <Icon size={18} strokeWidth={1.9} />
                        </div>
                    </div>
                ))}
            <div className="min-w-0 flex-1">
                <h2 id={id} className="truncate text-[15px] font-medium leading-snug text-base-content">
                    {title}
                </h2>
                {subtitle && <p className="truncate text-xs text-base-content/60">{subtitle}</p>}
            </div>
            {badges && <div className="hidden shrink-0 items-center gap-1.5 sm:flex">{badges}</div>}
            {right}
            <button
                type="button"
                onClick={onClose}
                disabled={busy}
                aria-label="Close dialog"
                className="btn btn-sm btn-square rounded-md border border-base-content/15 bg-transparent text-base-content/70 hover:bg-base-content/10 hover:text-base-content [--depth:0] [--noise:0]">
                <X size={16} strokeWidth={2} />
            </button>
        </div>
    );
}

/** Kept for older callers. Solid surface, no gradient. New dialogs should use ModalHeader. */
export function ModalHero({ id, eyebrow, avatar, title, subtitle, badges, stats, onClose, busy = false }) {
    return <ModalHeader id={id} avatar={avatar} title={title} subtitle={subtitle || eyebrow} badges={badges} right={stats} onClose={onClose} busy={busy} />;
}

export function ModalBody({ children, className = "" }) {
    return <div className={`min-h-0 flex-1 overflow-y-auto border-t border-base-content/10 px-6 py-5 ${className}`}>{children}</div>;
}

/**
 * Body for the fixed-size modal. Design the content to fit; scrollbars are hidden globally.
 * `bordered={false}` when ModalTabs sits right above it.
 */
export function PanelBody({ aside, children, bordered = true, className = "" }) {
    return (
        <div className={`flex min-h-0 flex-1 flex-col md:flex-row ${bordered ? "border-t border-base-content/10" : ""}`}>
            {aside && <aside className="max-h-44 shrink-0 overflow-y-auto border-b border-base-content/10 bg-base-100 p-4 md:max-h-none md:w-64 md:border-b-0 md:border-r md:p-5">{aside}</aside>}
            <div className={`flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-6 py-4 ${className}`}>{children}</div>
        </div>
    );
}

/**
 * Side panel for PanelBody `aside`: big tinted icon (or avatar), a title and a short facts list,
 * centred so the left column is never an empty strip.
 */
export function ModalAside({ icon: Icon, tone = "text-primary", avatar, title, subtitle, facts = [] }) {
    return (
        <div className="flex min-h-full flex-col items-center justify-center gap-5 text-center">
            <div className="flex max-w-full flex-col items-center gap-3">
                {avatar || (
                    <span className={`grid size-16 place-items-center rounded-full border border-current/35 bg-current/10 ${TONE[tone] || tone}`}>{Icon && <Icon size={28} strokeWidth={1.7} />}</span>
                )}
                {title && <p className="line-clamp-2 max-w-full break-words text-sm font-semibold text-base-content">{title}</p>}
                {subtitle && <p className="-mt-2 line-clamp-2 max-w-full break-all text-[11.5px] text-base-content/55">{subtitle}</p>}
            </div>
            {facts.length > 0 && (
                <dl className="w-full divide-y divide-base-content/10 rounded-md border border-base-content/10 bg-base-200/40">
                    {facts.map((f) => (
                        <div key={f.label} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                            <dt className="shrink-0 text-base-content/55">{f.label}</dt>
                            <dd className="min-w-0 truncate text-right font-medium text-base-content" title={typeof f.value === "string" ? f.value : undefined}>
                                {f.value ?? "—"}
                            </dd>
                        </div>
                    ))}
                </dl>
            )}
        </div>
    );
}

export function ModalFooter({ children, note }) {
    return (
        <div className="flex shrink-0 items-center gap-3 border-t border-base-content/10 px-6 py-3">
            <div className="min-w-0 flex-1 text-[11.5px] text-base-content/70">{note}</div>
            <div className="flex shrink-0 items-center gap-2">{children}</div>
        </div>
    );
}

export function ModalTabs({ tabs, value, onChange }) {
    const refs = useRef({});
    const onKey = (e) => {
        const i = tabs.findIndex((t) => t.id === value);
        let n = null;
        if (e.key === "ArrowRight") n = (i + 1) % tabs.length;
        if (e.key === "ArrowLeft") n = (i - 1 + tabs.length) % tabs.length;
        if (n == null) return;
        e.preventDefault();
        onChange(tabs[n].id);
        refs.current[tabs[n].id]?.focus();
    };
    return (
        <div role="tablist" aria-label="Sections" onKeyDown={onKey} className="flex shrink-0 items-center gap-2 border-t border-base-content/10 px-6 py-2.5">
            {tabs.map((t) => {
                const on = t.id === value;
                const Icon = t.icon;
                return (
                    <button
                        key={t.id}
                        ref={(el) => (refs.current[t.id] = el)}
                        id={`tab-${t.id}`}
                        role="tab"
                        type="button"
                        aria-selected={on}
                        aria-controls={`panel-${t.id}`}
                        tabIndex={on ? 0 : -1}
                        onClick={() => onChange(t.id)}
                        className={`btn btn-sm gap-1.5 rounded-md border [--depth:0] [--noise:0] ${on ? "border-primary/40 bg-primary/15 font-medium text-primary" : "border-base-content/15 bg-transparent text-base-content/70 hover:bg-base-content/10 hover:text-base-content"}`}>
                        {Icon && <Icon size={14} />}
                        {t.label}
                        {t.count != null && (
                            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-base-content/15 px-1.5 text-[10px] tabular-nums text-base-content">{t.count}</span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}

// ─── Atoms ────────────────────────────────────────────────────────────────────

export function ModalBadge({ tone = "neutral", icon: Icon, children }) {
    return (
        <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium ${BADGE[tone] || BADGE.neutral}`}>
            {Icon && <Icon size={11} strokeWidth={2.2} />}
            {children}
        </span>
    );
}

const BTN = {
    ghost: "border-base-content/20 bg-transparent text-base-content/85 hover:bg-base-content/10 hover:text-base-content",
    primary: "btn-primary border-primary hover:brightness-110",
    danger: "btn-error border-error",
    warning: "btn-warning border-warning",
    success: "btn-soft btn-success",
    dangerSoft: "btn-soft btn-error",
};

export function ModalButton({ variant = "ghost", loading = false, loadingText = "Working…", children, className = "", type = "button", ...rest }) {
    return (
        <button
            type={type}
            {...rest}
            disabled={rest.disabled || loading}
            className={`btn btn-sm rounded-md border [--depth:0] [--noise:0] disabled:border-base-content/10 disabled:bg-transparent disabled:text-base-content/40 ${BTN[variant] || BTN.ghost} ${className}`}>
            {loading && <span className="loading loading-spinner loading-xs" />}
            {loading ? loadingText : children}
        </button>
    );
}

/** daisyUI join of buttons with radio semantics. */
export function ModalSegmented({ value, onChange, options, label, className = "", split = false, size = "sm" }) {
    return (
        <div role="radiogroup" aria-label={label} className={split ? `flex gap-2 ${className}` : `flex gap-1 rounded-md border border-base-content/15 bg-base-100 p-1 ${className}`}>
            {options.map((o) => {
                const on = value === o.value;
                const Icon = o.icon;
                return (
                    <button
                        key={String(o.value)}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => onChange(o.value)}
                        className={`btn ${size === "md" ? "btn-md" : "btn-sm"} flex-1 gap-1.5 whitespace-nowrap rounded-md border [--depth:0] [--noise:0] ${on ? "border-primary/40 bg-primary/15 text-primary" : "border-base-content/15 bg-transparent text-base-content/70 hover:bg-base-content/10 hover:text-base-content"}`}>
                        {Icon && <Icon size={13} />}
                        {o.label}
                    </button>
                );
            })}
        </div>
    );
}

/**
 * Pill switch, same look as the app's Settings toggle: primary track when on, muted track when off, white knob.
 * Plain button (not daisyUI toggle) so the theme's square selector radius can't change its shape.
 * Wrap it in a <label> to make a whole row clickable.
 */
export function ModalToggle({ value, onChange, disabled, label }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={!!value}
            aria-label={label}
            disabled={disabled}
            onClick={() => onChange(!value)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${value ? "bg-primary" : "bg-base-content/25"} ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}>
            <span className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white transition-transform duration-150 ${value ? "translate-x-5" : ""}`} />
        </button>
    );
}

// Same notice palette as shared.jsx Notice: info stays plain, other tones are tinted border/bg/icon.
const NOTE = {
    warning: "border-warning/40 bg-warning/10",
    error: "border-error/40 bg-error/10",
    success: "border-success/35 bg-success/10",
};
const NOTE_ICON = { warning: "text-warning", error: "text-error", success: "text-success" };
export function ModalNote({ tone = "info", icon: Icon = Info, children }) {
    return (
        <div
            role={tone === "error" ? "alert" : "note"}
            className={`flex items-start gap-2.5 rounded-md border px-3 py-2 text-[12.5px] leading-snug text-base-content/85 ${NOTE[tone] ?? "border-base-content/10 bg-base-100"}`}>
            <Icon size={15} className={`mt-0.5 shrink-0 ${NOTE_ICON[tone] ?? "text-info"}`} />
            <div className="min-w-0">{children}</div>
        </div>
    );
}

/** One chip of the "pending changes" review: name  from → to */
const cut = (v) => {
    const t = String(v ?? "—");
    return t.length > 24 ? `${t.slice(0, 23)}…` : t;
};
export function ModalChange({ name, from, to }) {
    from = cut(from);
    to = cut(to);
    return (
        <li className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md border border-base-content/15 bg-base-100 px-2.5 text-xs text-base-content/70">
            <span className="font-medium text-base-content">{name}</span>
            <span>{from}</span>
            <span aria-hidden="true" className="text-primary">
                →
            </span>
            <span className="font-medium text-primary">{to}</span>
        </li>
    );
}

// ─── Shared form + detail atoms (used by every dashboard modal) ──────────────

/** Text input look used inside modals: bordered, primary focus ring, matches the site's inputs. */
export const MODAL_INPUT =
    "input input-sm h-9 w-full rounded-md border border-base-content/15 bg-base-100 text-[13px] text-base-content placeholder:text-base-content/40 focus:border-primary/50 focus:outline-none focus-within:outline-none";

/** Label + control + optional hint. `right` sits on the label row (a counter, a link). */
export function ModalField({ label, hint, htmlFor, right, children }) {
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
                <label htmlFor={htmlFor} className="text-xs font-medium text-base-content/70">
                    {label}
                </label>
                {right}
            </div>
            {children}
            {hint && <p className="text-[11.5px] leading-snug text-base-content/50">{hint}</p>}
        </div>
    );
}

/** Titled card of label / value rows (spec sheet). `plain` swaps the row list for free content. */
export function ModalCard({ icon: Icon, title, plain = false, className = "", children }) {
    return (
        <section className={`flex min-h-0 flex-col overflow-hidden rounded-md border border-base-content/10 bg-base-100 ${className}`}>
            <h3 className="flex items-center gap-2 border-b border-base-content/10 bg-base-content/5 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-base-content/60">
                {Icon && <Icon size={13} className="text-primary" />}
                {title}
            </h3>
            {plain ? <div className="flex-1 p-4">{children}</div> : <dl className="flex flex-1 flex-col divide-y divide-base-content/10">{children}</dl>}
        </section>
    );
}

export function ModalRow({ icon: Icon, tone = "text-base-content/50", label, children }) {
    return (
        <div className="flex min-h-11 items-center justify-between gap-4 px-4 py-2 md:flex-1">
            <dt className="flex shrink-0 items-center gap-2 text-xs text-base-content/60">
                {Icon && <Icon size={14} className={tone} />}
                {label}
            </dt>
            <dd className="flex min-w-0 items-center justify-end gap-2 text-[13px] font-medium text-base-content">{children}</dd>
        </div>
    );
}

/** Clipboard write that also works on plain-http LAN addresses (execCommand fallback). */
async function writeClipboard(text) {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text ?? "");
    else {
        const ta = document.createElement("textarea");
        ta.value = text ?? "";
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
    }
}

/** Outlined "Copy" button for key/value rows. */
export function ModalCopyButton({ text, label = "value" }) {
    const [done, setDone] = useState(false);
    async function copy(e) {
        e?.stopPropagation?.();
        try {
            await writeClipboard(text);
            setDone(true);
            setTimeout(() => setDone(false), 1400);
        } catch {
            /* ignore */
        }
    }
    return (
        <button
            type="button"
            onClick={copy}
            aria-label={done ? "Copied" : `Copy ${label}`}
            className="btn btn-xs h-7 shrink-0 gap-1.5 rounded-md border border-base-content/20 bg-transparent px-2.5 text-xs font-normal text-base-content/85 hover:bg-base-content/10 [--depth:0] [--noise:0]">
            {done ? <Check size={12} className="text-success" /> : <Copy size={12} />}
            {done ? "Copied" : "Copy"}
        </button>
    );
}

/** Small copy-to-clipboard icon button. */
export function ModalCopy({ text, label = "value" }) {
    const [done, setDone] = useState(false);
    async function copy(e) {
        e?.stopPropagation?.();
        try {
            await writeClipboard(text);
            setDone(true);
            setTimeout(() => setDone(false), 1400);
        } catch {
            /* ignore */
        }
    }
    return (
        <button
            type="button"
            onClick={copy}
            aria-label={done ? "Copied" : `Copy ${label}`}
            title={done ? "Copied" : `Copy ${label}`}
            className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-base-content/50 transition-colors hover:bg-base-content/10 hover:text-base-content">
            {done ? <Check size={13} className="text-success" /> : <Copy size={13} />}
        </button>
    );
}

const METER = { primary: "bg-primary", success: "bg-success", warning: "bg-warning", error: "bg-error", info: "bg-info", accent: "bg-accent" };
/** Rounded progress bar (0-100). */
export function ModalMeter({ value = 0, tone = "primary", label }) {
    const v = Math.min(100, Math.max(0, Number(value) || 0));
    return (
        <div role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label} className="h-1.5 w-full overflow-hidden rounded-full bg-base-content/10">
            <div className={`h-full rounded-full transition-[width] ${METER[tone] || METER.primary}`} style={{ width: `${v}%` }} />
        </div>
    );
}

/** Footer note for edit dialogs: "● Unsaved" + one chip per change, or a quiet idle line. */
export function ModalDirty({ changes = [], idle = "No changes yet" }) {
    if (!changes.length) return <span className="text-base-content/60">{idle}</span>;
    return (
        <div className="flex min-w-0 items-center gap-3">
            <span className="inline-flex shrink-0 items-center gap-1.5 text-warning">
                <span className="size-2 shrink-0 rounded-full bg-warning" />
                Unsaved
            </span>
            <ul className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto" aria-live="polite" aria-label="Pending changes">
                {changes.map((c) => (
                    <ModalChange key={c.name} {...c} />
                ))}
            </ul>
        </div>
    );
}

// ─── Labelled-section layout (the dashboard modal design) ────────────────────
//
//   <ModalContent>                       single column, 16px gaps, scroll hidden
//     <ModalSection label="…">           small muted label above one panel
//       <ModalRows> <ModalKV label>…     key / value list
//       <ModalStats items=[…]/>          row of stat tiles
//       <ModalCallout tone icon>…        coloured statement
//       <ModalBullets items=[…]/>        icon / number + text list
//     </ModalSection>
//     <ModalReview changes=[…]/>         pinned to the bottom with className="mt-auto"
//   </ModalContent>

export const PANEL = "rounded-lg border border-base-content/10 bg-base-100";

export function ModalContent({ children, className = "", bordered = true }) {
    return <div className={`flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 ${bordered ? "border-t border-base-content/10" : ""} ${className}`}>{children}</div>;
}

/** `pin` pushes the section to the bottom of the body, `grow` lets its panel take the leftover height. */
export function ModalSection({ label, hint, right, pin = false, grow = false, className = "", children }) {
    return (
        <section className={`flex flex-col gap-1.5 ${pin ? "mt-auto" : ""} ${grow ? "min-h-0 flex-1" : "shrink-0"} ${className}`}>
            {(label || right) && (
                <div className="flex min-h-5 items-center justify-between gap-2">
                    <h3 className="text-xs font-medium text-base-content/65">
                        {label}
                        {hint && <span className="ml-1.5 font-normal text-base-content/45">· {hint}</span>}
                    </h3>
                    {right}
                </div>
            )}
            {children}
        </section>
    );
}

/** Key / value list panel. Children: ModalKV. */
export function ModalRows({ children, className = "" }) {
    return <dl className={`${PANEL} flex flex-col divide-y divide-base-content/10 overflow-hidden ${className}`}>{children}</dl>;
}

export function ModalKV({ icon: Icon, tone = "text-base-content/50", label, mono = false, action, children }) {
    return (
        <div className="flex min-h-11 flex-1 items-center gap-4 px-4 py-2">
            <dt className="flex w-28 shrink-0 items-center gap-2 text-xs text-base-content/60">
                {Icon && <Icon size={13} className={TONE[tone] || tone} />}
                {label}
            </dt>
            <dd className={`flex min-w-0 flex-1 items-center gap-2 text-[13px] text-base-content ${mono ? "font-mono text-xs" : ""}`}>
                <span className="min-w-0 flex-1 truncate">{children}</span>
                {action}
            </dd>
        </div>
    );
}

/** Grid of stat tiles: [{ icon, tone, label, value, mono }] */
export function ModalStats({ items, className = "" }) {
    const cols = items.length >= 4 ? "sm:grid-cols-4" : items.length === 3 ? "sm:grid-cols-3" : items.length === 2 ? "sm:grid-cols-2" : "";
    return (
        <div className={`grid grid-cols-2 gap-3 ${cols} ${className}`}>
            {items.map((it) => {
                const Icon = it.icon;
                return (
                    <div key={it.label} className={`${PANEL} flex min-w-0 flex-col gap-1 px-4 py-3`}>
                        <span className="flex items-center gap-1.5 text-xs text-base-content/60">
                            {Icon && <Icon size={13} className={TONE[it.tone] || it.tone || "text-base-content/50"} />}
                            {it.label}
                        </span>
                        <span
                            className={`truncate text-[15px] font-medium text-base-content ${it.mono ? "font-mono text-[13px]" : ""} ${it.valueTone ? TONE[it.valueTone] : ""}`}
                            title={typeof it.value === "string" ? it.value : undefined}>
                            {it.value ?? "—"}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}

const CALLOUT = {
    error: { box: "border-error/60", icon: "text-error" },
    warning: { box: "border-warning/60", icon: "text-warning" },
    success: { box: "border-success/50", icon: "text-success" },
    info: { box: "border-info/50", icon: "text-info" },
    neutral: { box: "border-base-content/10", icon: "text-base-content/60" },
};
/** Coloured statement panel. `compact` = slim one-line bar without the icon disc. */
export function ModalCallout({ tone = "info", icon: Icon = Info, compact = false, className = "", children }) {
    const c = CALLOUT[tone] || CALLOUT.info;
    return (
        <div role={tone === "error" ? "alert" : "note"} className={`flex items-center gap-3 rounded-lg border bg-base-100 ${c.box} ${compact ? "px-4 py-3" : "px-4 py-4"} ${className}`}>
            {compact ? (
                <Icon size={16} className={`shrink-0 ${c.icon}`} />
            ) : (
                <span className="grid size-9 shrink-0 place-items-center rounded-full border border-base-content/10 bg-base-200">
                    <Icon size={16} className={c.icon} />
                </span>
            )}
            <div className="min-w-0 flex-1 text-[13px] leading-snug text-base-content/90">{children}</div>
        </div>
    );
}

/**
 * List of consequences / steps: [{ icon, tone, n, title, text }].
 * `n` shows a number disc instead of an icon. `fill` stretches rows to use the leftover height.
 */
export function ModalBullets({ items, fill = false, className = "" }) {
    return (
        <ul className={`${PANEL} flex flex-col divide-y divide-base-content/10 overflow-hidden ${fill ? "min-h-0 flex-1" : ""} ${className}`}>
            {items.map((it, i) => {
                const Icon = it.icon;
                return (
                    <li key={it.title || it.text || i} className={`flex items-center gap-3.5 px-4 py-3 ${fill ? "min-h-14 flex-1" : ""}`}>
                        <span className="grid size-8 shrink-0 place-items-center rounded-full border border-base-content/10 bg-base-200 text-xs font-medium text-base-content">
                            {Icon ? <Icon size={15} className={TONE[it.tone] || it.tone || "text-base-content/60"} /> : (it.n ?? i + 1)}
                        </span>
                        <div className="min-w-0 flex-1">
                            {it.title && <p className="text-[13px] font-medium leading-snug text-base-content">{it.title}</p>}
                            {it.text && <p className={`text-xs leading-snug ${it.title ? "text-base-content/60" : "text-[13px] text-base-content/85"}`}>{it.text}</p>}
                        </div>
                    </li>
                );
            })}
        </ul>
    );
}

/** "Review changes" panel for edit dialogs. Always rendered so the layout does not jump. */
export function ModalReview({ changes = [], saved = [], className = "" }) {
    const has = changes.length > 0;
    if (!has) {
        if (!saved.length) return null;
        return (
            <section className={`${PANEL} flex shrink-0 flex-col gap-2.5 px-4 py-3.5 ${className}`}>
                <p className="flex items-center gap-2 text-[13px] text-base-content/80">
                    <Info size={15} className="text-info" />
                    Saved values
                </p>
                <ul className="flex flex-wrap items-center gap-2">
                    {saved.map((c) => (
                        <li key={c.name} className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border border-base-content/15 bg-base-200 px-2.5 text-xs">
                            <span className="shrink-0 font-medium text-base-content">{c.name}</span>
                            <span className="truncate text-base-content/65">{cut(c.value)}</span>
                        </li>
                    ))}
                </ul>
                <p className="text-xs text-base-content/50">Edit a field above and the change shows up here for review before you save.</p>
            </section>
        );
    }
    return (
        <section aria-live="polite" className={`${PANEL} flex shrink-0 flex-col gap-2.5 px-4 py-3.5 ${className}`}>
            <p className="flex items-center gap-2 text-[13px] text-base-content">
                <Check size={15} className="text-success" />
                Review changes
            </p>
            <ul className="flex flex-wrap items-center gap-2">
                {changes.map((c) => (
                    <ModalChange key={c.name} {...c} />
                ))}
            </ul>
        </section>
    );
}

/** Rounded square tile with an icon or an image, used for media / channel previews inside panels. */
export function ModalThumb({ icon: Icon, tone = "text-primary", src, className = "size-11" }) {
    return (
        <span className={`grid shrink-0 place-items-center overflow-hidden rounded-md border border-base-content/10 bg-base-200 ${className}`}>
            {src ? <img src={src} alt="" className="size-full object-cover" /> : Icon && <Icon size={18} className={TONE[tone] || tone} />}
        </span>
    );
}

// ─── ConfirmModal ─────────────────────────────────────────────────────────────

const VARIANT = {
    danger: { icon: Trash2, text: "text-error", btn: "danger", badge: "Danger", tone: "error", dot: "text-error" },
    warning: { icon: ShieldAlert, text: "text-warning", btn: "warning", badge: "Warning", tone: "warning", dot: "text-warning" },
    info: { icon: Info, text: "text-info", btn: "primary", badge: "Info", tone: "info", dot: "text-info" },
};

/**
 * ConfirmModal
 *   open, onClose, onConfirm, title, subtitle, message, confirmText, cancelText, variant("danger"|"warning"|"info"), loading
 *   facts:     optional [{ icon, tone, label, value, mono }]   – "You are about to …" key/value panel
 *   factsLabel optional string                                  – label above that panel
 *   message:   the coloured statement of what is about to happen
 *   timeline:  optional [{ icon, tone, title, text }]           – consequences, one row each
 *   details:   optional string[]                                – plain consequence list (used when no timeline)
 *   note:      optional string                                  – slim closing bar pinned to the bottom
 *   noteTone / noteIcon   optional                              – tone ("info"|"warning"|"error"|"success") and icon of that bar
 *   children:  optional node shown between the message and the consequences (e.g. a card naming what is affected)
 *   error:     optional string                                  – failure message
 *   badge:     false hides the Danger / Warning / Info badge in the header
 */
export default function ConfirmModal({
    open,
    onClose,
    onConfirm,
    title = "Are you sure?",
    subtitle,
    confirmIcon: ConfirmIcon,
    message,
    messageIcon,
    facts,
    factsLabel,
    details,
    timeline,
    note,
    noteTone = "info",
    noteIcon,
    confirmText = "Confirm",
    cancelText = "Cancel",
    variant = "danger",
    loading = false,
    error,
    badge = true,
    children,
}) {
    const uid = useId();
    if (!open) return null;
    const v = VARIANT[variant] || VARIANT.danger;
    const steps =
        Array.isArray(timeline) && timeline.length > 0
            ? timeline
            : Array.isArray(details) && details.length > 0
              ? details.map((d) => ({ icon: variant === "danger" ? AlertTriangle : Info, tone: v.text, text: d }))
              : null;
    const hasFacts = Array.isArray(facts) && facts.length > 0;

    return (
        <ModalShell onClose={onClose} busy={loading} labelledBy={`${uid}-t`} describedBy={`${uid}-d`}>
            <ModalHeader
                id={`${uid}-t`}
                icon={v.icon}
                tone={v.text}
                title={title}
                subtitle={subtitle}
                badges={badge ? <ModalBadge tone={v.tone}>{v.badge}</ModalBadge> : undefined}
                onClose={onClose}
                busy={loading}
            />
            <ModalContent>
                <div id={`${uid}-d`} className="contents">
                    {hasFacts && (
                        <ModalSection label={factsLabel || (variant === "danger" ? "You are about to delete" : "You are about to change")}>
                            <ModalRows>
                                {facts.map((f) => (
                                    <ModalKV key={f.label} icon={f.icon} tone={f.tone} label={f.label} mono={f.mono}>
                                        {f.value ?? "—"}
                                    </ModalKV>
                                ))}
                            </ModalRows>
                        </ModalSection>
                    )}

                    {message && (
                        <ModalCallout tone={v.tone} icon={messageIcon || v.icon}>
                            {message}
                        </ModalCallout>
                    )}

                    {children}

                    {steps && <ModalBullets items={steps} fill={!note && !error} />}

                    {error && (
                        <ModalCallout tone="error" icon={AlertTriangle} compact>
                            {error}
                        </ModalCallout>
                    )}

                    {note && (
                        <ModalCallout
                            tone={noteTone}
                            icon={noteIcon || (noteTone === "error" || noteTone === "warning" ? AlertTriangle : noteTone === "success" ? Check : Info)}
                            compact
                            className="mt-auto">
                            {note}
                        </ModalCallout>
                    )}
                </div>
            </ModalContent>
            <ModalFooter>
                <ModalButton data-autofocus onClick={onClose} disabled={loading}>
                    {cancelText}
                </ModalButton>
                <ModalButton variant={v.btn} onClick={onConfirm} loading={loading} className="gap-1.5">
                    {ConfirmIcon && <ConfirmIcon size={14} />}
                    {confirmText}
                </ModalButton>
            </ModalFooter>
        </ModalShell>
    );
}
