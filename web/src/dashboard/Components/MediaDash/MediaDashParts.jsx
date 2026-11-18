// web/src/Dashboard/Components/MediaDash/MediaDashParts.jsx
// Building blocks shared by DashMedia, SubtitlesTable and FormatsTable. DaisyUI tokens only — no hard-coded
// colours (the toggle thumb is the one deliberate white). Every colour class is written out in full so Tailwind
// can see it. Palette roles: primary / secondary / accent / info for categories, success / warning / error for status.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info, ChevronLeft, ChevronRight, Check, Image as ImageIcon } from "lucide-react";
import { fmtHours, pad2, pct } from "./mediaDashUtils";

// ─── Tone maps ────────────────────────────────────────────────────────────────

export const BADGE_SOFT = {
    neutral: "bg-base-300 text-base-content",
    primary: "badge-soft badge-primary",
    secondary: "badge-soft badge-secondary",
    accent: "badge-soft badge-accent",
    info: "badge-soft badge-info",
    success: "badge-soft badge-success",
    warning: "badge-soft badge-warning",
    error: "badge-soft badge-error",
};
export const BADGE_OUTLINE = {
    neutral: "badge-outline",
    primary: "badge-outline badge-primary",
    secondary: "badge-outline badge-secondary",
    accent: "badge-outline badge-accent",
    info: "badge-outline badge-info",
    success: "badge-outline badge-success",
    warning: "badge-outline badge-warning",
    error: "badge-outline badge-error",
};
export const BORDER = { neutral: "border-base-300", primary: "border-primary", secondary: "border-secondary", accent: "border-accent", info: "border-info", success: "border-success", warning: "border-warning", error: "border-error" };
export const FILL = { neutral: "bg-neutral", primary: "bg-primary", secondary: "bg-secondary", accent: "bg-accent", info: "bg-info", success: "bg-success", warning: "bg-warning", error: "bg-error" };
// Solid segment colour + readable label colour for the quality bars.
export const SEGMENT = {
    "4K": "bg-primary text-primary-content",
    "1080p": "bg-secondary text-secondary-content",
    "720p": "bg-accent text-accent-content",
    SD: "bg-info text-info-content",
};
export const QUALITY_TONE = { "4K": "primary", "1080p": "secondary", "720p": "accent", "480p": "info", SD: "info" };
export const PLAYBACK_TONE = { direct: "success", remux: "info", transcode: "warning", unknown: "neutral" };
export const PLAYBACK_LABEL = { direct: "Direct play", remux: "Remux", transcode: "Transcode", unknown: "Not probed" };

// ─── Layout ───────────────────────────────────────────────────────────────────

export function Panel({ title, hint, right, children, className = "" }) {
    return (
        <section className={`flex min-w-0 flex-col overflow-hidden rounded-lg border border-base-300 bg-base-200 ${className}`}>
            {(title || right) && (
                <header className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-base-300 px-4 py-3">
                    <h3 className="text-base font-semibold text-base-content">{title}</h3>
                    <div className="flex min-w-0 items-center gap-3 text-sm text-base-content/70">
                        {hint && <span className="truncate">{hint}</span>}
                        {right}
                    </div>
                </header>
            )}
            <div className="flex flex-1 flex-col">{children}</div>
        </section>
    );
}

export function SectionLabel({ children }) {
    return (
        <div className="flex items-center gap-3 pt-3 text-base font-semibold text-base-content">
            {children}
            <span className="h-px flex-1 bg-base-300" />
        </div>
    );
}

// Footer line under a card: one insight on the left, one action on the right.
export function Note({ children, action, onAction, actionDisabled }) {
    return (
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-base-300 bg-base-300 px-4 py-3 text-sm text-base-content/85">
            <span className="min-w-0">{children}</span>
            {action && (
                <button type="button" onClick={onAction} disabled={actionDisabled} className="shrink-0 cursor-pointer font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-60">
                    {action}
                </button>
            )}
        </div>
    );
}

export function Empty({ icon: Icon = Info, text }) {
    return (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-10 text-center">
            <Icon size={20} className="text-base-content/60" />
            <p className="max-w-sm text-sm text-base-content/80">{text}</p>
        </div>
    );
}

export function Skel({ className = "" }) {
    return <div className={`skeleton rounded-lg ${className}`} />;
}

export function Dot({ className = "" }) {
    return <span className={`inline-block size-2 shrink-0 rounded-full bg-success ${className}`} />;
}

export function Bar({ value, tone = "primary", className = "" }) {
    return (
        <div className={`h-1.5 overflow-hidden rounded-full bg-base-300 ${className}`}>
            <div className={`h-full rounded-full ${FILL[tone]}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
        </div>
    );
}

// ─── Controls ─────────────────────────────────────────────────────────────────

export function Badge({ tone = "neutral", outline = false, children, className = "" }) {
    return <span className={`badge badge-sm h-6 gap-1 whitespace-nowrap rounded-md text-[13px] ${outline ? "" : "border-none"} ${(outline ? BADGE_OUTLINE : BADGE_SOFT)[tone]} ${className}`}>{children}</span>;
}

// Fully rounded switch with a white thumb.
export function Toggle({ checked, onChange, label, disabled }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            title={label}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${checked ? "bg-primary" : "bg-neutral"}`}>
            <span className={`absolute left-0.5 size-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : "translate-x-0"}`} />
        </button>
    );
}

export function Seg({ value, onChange, options }) {
    return (
        <div className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-md bg-base-300 p-0.5">
            {options.map((o) => (
                <button
                    key={o.value}
                    type="button"
                    onClick={() => onChange(o.value)}
                    className={`inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded px-3 text-sm font-medium transition-colors ${
                        value === o.value ? "bg-primary text-primary-content" : "text-base-content/85 hover:text-base-content"
                    }`}>
                    {o.label}
                    {o.count != null && <span className={`text-xs tabular-nums ${value === o.value ? "text-primary-content" : "text-base-content/70"}`}>{o.count}</span>}
                </button>
            ))}
        </div>
    );
}

export function ToolBtn({ icon: Icon, children, onClick, tone = "default", disabled, title, className = "" }) {
    const toneCls =
        tone === "primary" ? "border-primary bg-base-200 text-primary hover:bg-base-300" : tone === "error" ? "border-base-300 bg-base-200 text-error hover:bg-base-300" : "border-base-300 bg-base-300 text-base-content hover:bg-neutral";
    return (
        <button
            type="button"
            title={title}
            disabled={disabled}
            onClick={onClick}
            className={`inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-md border px-3.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${toneCls} ${className}`}>
            {Icon && <Icon size={15} />}
            {children}
        </button>
    );
}

export function IconBtn({ icon: Icon, title, onClick, disabled, className = "" }) {
    return (
        <button
            type="button"
            title={title}
            aria-label={title}
            disabled={disabled}
            onClick={onClick}
            className={`inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-base-300 bg-base-200 text-base-content/85 transition-colors hover:bg-base-300 hover:text-base-content disabled:cursor-not-allowed disabled:opacity-60 ${className}`}>
            <Icon size={15} />
        </button>
    );
}

export function ActionBtn({ icon: Icon, children, onClick, disabled, title }) {
    return (
        <button
            type="button"
            title={title}
            disabled={disabled}
            onClick={onClick}
            className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-primary bg-base-200 px-2.5 text-sm font-medium text-primary transition-colors hover:bg-base-300 disabled:cursor-not-allowed disabled:opacity-60">
            {Icon && <Icon size={14} />}
            {children}
        </button>
    );
}

export function SearchBox({ value, onChange, placeholder, icon: Icon }) {
    return (
        <label className="flex h-9 min-w-40 flex-1 cursor-text items-center gap-2 rounded-md border border-base-300 bg-base-300 px-3 text-sm">
            {Icon && <Icon size={15} className="shrink-0 text-base-content/70" />}
            <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="min-w-0 flex-1 bg-transparent text-base-content outline-none placeholder:text-base-content/65" />
        </label>
    );
}

export function SelectBox({ value, onChange, options, className = "" }) {
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={`h-9 max-w-44 shrink-0 cursor-pointer rounded-md border border-base-300 bg-base-300 px-2.5 text-sm font-medium text-base-content outline-none ${className}`}>
            {options.map((o) => (
                <option key={o.value} value={o.value}>
                    {o.label}
                </option>
            ))}
        </select>
    );
}

export function Pagination({ page, pages, total, from, to, onPage, note }) {
    return (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-base-300 px-4 py-3 text-sm text-base-content/80">
            <span>
                {total === 0 ? "No results" : `${from}–${to} of ${total.toLocaleString()}`}
                {note ? ` · ${note}` : ""}
            </span>
            {pages > 1 && (
                <div className="flex items-center gap-1">
                    <button type="button" disabled={page === 1} onClick={() => onPage(page - 1)} className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md border border-base-300 hover:bg-base-300 disabled:cursor-not-allowed disabled:opacity-60">
                        <ChevronLeft size={15} />
                    </button>
                    {Array.from({ length: Math.min(pages, 5) }, (_, i) => {
                        const start = Math.max(1, Math.min(page - 2, pages - 4));
                        const n = start + i;
                        return (
                            <button
                                key={n}
                                type="button"
                                onClick={() => onPage(n)}
                                className={`inline-flex size-8 cursor-pointer items-center justify-center rounded-md border text-sm font-medium ${
                                    n === page ? "border-primary bg-primary text-primary-content" : "border-base-300 hover:bg-base-300"
                                }`}>
                                {n}
                            </button>
                        );
                    })}
                    <button type="button" disabled={page === pages} onClick={() => onPage(page + 1)} className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md border border-base-300 hover:bg-base-300 disabled:cursor-not-allowed disabled:opacity-60">
                        <ChevronRight size={15} />
                    </button>
                </div>
            )}
        </div>
    );
}

// ─── Thumbnails (tinted by category / state) ──────────────────────────────────

// Wraps any thumbnail so that, in select mode, it turns into a checkbox (same pattern as the media table).
function CheckTile({ checked, onToggle, className = "" }) {
    return (
        <button type="button" onClick={onToggle} aria-pressed={checked} className={`flex shrink-0 cursor-pointer items-center justify-center rounded-md border border-base-300 bg-base-300 ${className}`}>
            <span className={`flex size-5 items-center justify-center rounded border-2 ${checked ? "border-primary bg-primary text-primary-content" : "border-base-content/60 bg-base-200"}`}>
                {checked && <Check size={12} strokeWidth={3} />}
            </span>
        </button>
    );
}

// Media poster, 32×44. Falls back to an icon when there is no image or it fails to load.
export function PosterTile({ src, selectMode, checked, onToggle, alt = "" }) {
    const [failed, setFailed] = useState(false);
    if (selectMode) return <CheckTile checked={checked} onToggle={onToggle} className="h-11 w-8" />;
    return (
        <div className="flex h-11 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-base-300 bg-base-300">
            {src && !failed ? <img src={src} alt="" aria-label={alt} loading="lazy" onError={() => setFailed(true)} className="size-full object-cover" /> : <ImageIcon size={14} className="text-base-content/65" />}
        </div>
    );
}

// Subtitle thumbnail: portrait page with the format label and two caption lines. 32×44.
export function SubtitleTile({ ext, tone = "secondary", selectMode, checked, onToggle }) {
    if (selectMode) return <CheckTile checked={checked} onToggle={onToggle} className="h-11 w-8" />;
    return (
        <div className={`badge ${BADGE_SOFT[tone]} ${BORDER[tone]} h-11 w-8 shrink-0 flex-col items-center justify-between rounded-md px-0 py-1.5`}>
            <span className="font-mono text-[10px] font-semibold leading-none">{ext}</span>
            <span className="flex flex-col items-center gap-0.5">
                <span className="h-0.5 w-5 rounded-full bg-current" />
                <span className="h-0.5 w-3 rounded-full bg-current" />
            </span>
        </div>
    );
}

// Container thumbnail: square, film-frame mark over the extension. 40×40. Tint follows the playback state.
export function FormatTile({ label, tone = "success", selectMode, checked, onToggle }) {
    if (selectMode) return <CheckTile checked={checked} onToggle={onToggle} className="size-10" />;
    return (
        <div className={`badge ${BADGE_SOFT[tone]} ${BORDER[tone]} size-10 shrink-0 flex-col items-center justify-center gap-1 rounded-md p-0`}>
            <span className="flex gap-0.5">
                <span className="h-2 w-0.5 rounded-full bg-current" />
                <span className="h-2 w-2 rounded-sm border border-current" />
                <span className="h-2 w-0.5 rounded-full bg-current" />
            </span>
            <span className="max-w-full truncate font-mono text-[10px] font-semibold leading-none">{label}</span>
        </div>
    );
}

// ─── Row menu (portal, so table overflow can never clip it) ───────────────────────

export function PortalMenu({ anchor, onClose, header, items }) {
    const ref = useRef(null);
    const [pos, setPos] = useState(null);

    useLayoutEffect(() => {
        if (!anchor || !ref.current) return;
        const r = anchor.getBoundingClientRect();
        const w = ref.current.offsetWidth;
        const h = ref.current.offsetHeight;
        let top = r.bottom + 6;
        if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
        const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w));
        setPos({ top, left });
    }, [anchor, items.length]);

    useEffect(() => {
        if (!anchor) return undefined;
        const down = (e) => {
            if (ref.current?.contains(e.target) || anchor.contains(e.target)) return;
            onClose();
        };
        const key = (e) => e.key === "Escape" && onClose();
        document.addEventListener("mousedown", down);
        document.addEventListener("keydown", key);
        window.addEventListener("resize", onClose);
        window.addEventListener("scroll", onClose, true);
        return () => {
            document.removeEventListener("mousedown", down);
            document.removeEventListener("keydown", key);
            window.removeEventListener("resize", onClose);
            window.removeEventListener("scroll", onClose, true);
        };
    }, [anchor, onClose]);

    if (!anchor) return null;
    return createPortal(
        <div
            ref={ref}
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
            className="fixed z-9999 w-64 rounded-lg border border-base-300 bg-base-200 p-1.5 shadow-xl">
            {header && <p className="truncate px-2.5 pb-1.5 pt-1 text-xs text-base-content/70">{header}</p>}
            {items.map((it, i) =>
                it.divider ? (
                    <div key={`d${i}`} className="my-1 h-px bg-base-300" />
                ) : (
                    <button
                        key={it.label}
                        type="button"
                        disabled={it.disabled}
                        onClick={() => {
                            onClose();
                            it.onClick?.();
                        }}
                        className={`flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-base-300 disabled:cursor-not-allowed disabled:opacity-60 ${
                            it.tone === "error" ? "text-error" : "text-base-content"
                        }`}>
                        {it.icon && <it.icon size={15} className={it.tone === "error" ? "" : "text-base-content/75"} />}
                        <span className="flex-1 truncate">{it.label}</span>
                        {it.hint && <span className="text-xs text-base-content/70">{it.hint}</span>}
                    </button>
                ),
            )}
        </div>,
        document.body,
    );
}

// ─── Charts ───────────────────────────────────────────────────────────────────

// Measures a container so SVG text keeps its real pixel size instead of scaling with the panel.
export function useElementWidth(fallback) {
    const ref = useRef(null);
    const [w, setW] = useState(fallback);
    useEffect(() => {
        const el = ref.current;
        if (!el) return undefined;
        const read = () => {
            const next = Math.round(el.getBoundingClientRect().width);
            if (next > 0) setW((p) => (p === next ? p : next));
        };
        read();
        if (typeof ResizeObserver === "undefined") return undefined;
        const ro = new ResizeObserver(read);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    return [ref, w];
}

function niceTop(max) {
    const raw = Math.max(max, 0.1) / 4;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
    return step * 4;
}

// Quietest run of `len` consecutive hours → { start, sum }.
export function quietWindow(hours, len = 4) {
    let best = { start: 0, sum: Infinity };
    for (let s = 0; s + len <= 24; s++) {
        let sum = 0;
        for (let i = 0; i < len; i++) sum += hours[s + i] || 0;
        if (sum < best.sum) best = { start: s, sum };
    }
    return best;
}

// 24 solid bars, one colour: watch time per hour of day.
export function HourBars({ hours, quiet }) {
    const [boxRef, W] = useElementWidth(720);
    const H = 176;
    const L = 40;
    const R = 6;
    const T = 10;
    const B = 24;
    const svgW = W - 32;
    const max = Math.max(...hours, 0);
    const topV = niceTop(max);
    const pw = svgW - L - R;
    const bw = pw / 24;
    const ph = H - T - B;
    const y = (v) => T + ph * (1 - v / topV);
    const peak = hours.indexOf(max);
    const fmtTick = (v) => (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10);
    const step = bw * 3 < 46 ? 6 : 3; // fewer x labels when the panel is narrow
    const ticks = Array.from({ length: Math.floor(24 / step) }, (_, i) => i * step);

    return (
        <div ref={boxRef} className="w-full px-4 pb-1 pt-3">
            <svg width={svgW} height={H} className="block max-w-full">
                {quiet && <rect x={L + quiet.start * bw} y={T} width={bw * 4} height={ph} className="fill-base-300" />}
                {[0, 1, 2, 3, 4].map((i) => {
                    const v = (topV * i) / 4;
                    return (
                        <g key={i}>
                            <line x1={L} x2={svgW - R} y1={y(v)} y2={y(v)} className="stroke-base-300" />
                            <text x={0} y={y(v) + 4} className="fill-base-content/70 text-xs">
                                {fmtTick(v)}
                            </text>
                        </g>
                    );
                })}
                {hours.map((v, i) => {
                    const h = Math.max(0, ph * (v / topV));
                    return (
                        <rect key={i} x={L + i * bw + bw * 0.18} y={T + ph - h} width={bw * 0.64} height={h} rx={2} className="fill-primary">
                            <title>{`${pad2(i)}:00 · ${fmtHours(v)}`}</title>
                        </rect>
                    );
                })}
                {ticks.map((h) => (
                    <text key={h} x={L + h * bw} y={H - 6} className="fill-base-content/70 text-xs">
                        {pad2(h)}:00
                    </text>
                ))}
                {quiet && (
                    <text x={L + quiet.start * bw + 4} y={T + 13} className="fill-base-content/80 text-xs">
                        Quiet window
                    </text>
                )}
                {max > 0 && peak >= 0 && (
                    <text x={Math.max(L, Math.min(svgW - 96, L + peak * bw - 40))} y={Math.max(T + 12, y(max) - 6)} className="fill-base-content text-xs">
                        {`Peak ${pad2(peak)}:00`}
                    </text>
                )}
            </svg>
        </div>
    );
}

// Two bars per row (storage vs watch time), both scaled to the same maximum so the longest fills the track.
export function ShareCompare({ rows }) {
    const max = Math.max(...rows.flatMap((r) => [r.storage, r.watch]), 1);
    return (
        <div className="flex flex-1 flex-col justify-around gap-3 px-4 py-4">
            {rows.map((r) => (
                <div key={r.key} className="grid grid-cols-[4.5rem_1fr] items-center gap-3 text-sm text-base-content/90">
                    <span className="truncate">{r.label}</span>
                    <div className="space-y-1.5">
                        {[
                            { v: r.storage, tone: "secondary", name: "Storage" },
                            { v: r.watch, tone: "primary", name: "Watch time" },
                        ].map((b) => (
                            <div key={b.name} className="flex items-center gap-2" title={`${b.name}: ${b.v}%`}>
                                <Bar value={(b.v / max) * 100} tone={b.tone} className="h-2 flex-1" />
                                <span className="w-10 text-right text-sm tabular-nums text-base-content">{b.v}%</span>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

export function RankedBars({ rows }) {
    const max = Math.max(...rows.map((r) => r.count), 1);
    return (
        <div className="flex flex-1 flex-col justify-around gap-3 px-4 py-4">
            {rows.map((r) => (
                <div key={r.key} className="grid grid-cols-[8rem_1fr_2.5rem] items-center gap-3 text-sm text-base-content/90">
                    <span className="truncate">{r.label}</span>
                    <Bar value={(r.count / max) * 100} tone="primary" className="h-2" />
                    <span className="text-right tabular-nums text-base-content">{r.count}</span>
                </div>
            ))}
        </div>
    );
}

// Stacked 100% bars of 4K / 1080p / 720p / SD per library type.
export function QualityMix({ rows, onReview }) {
    const buckets = ["4K", "1080p", "720p", "SD"];
    return (
        <div>
            <div className="grid grid-cols-[6.5rem_1fr] items-center gap-4 border-b border-base-300 bg-base-300 px-4 py-2.5 text-xs font-medium text-base-content/75 @3xl:grid-cols-[6.5rem_1fr_5rem_8rem_5rem]">
                <span>Library</span>
                <div className="flex justify-between">
                    {["0%", "25%", "50%", "75%", "100%"].map((t) => (
                        <span key={t}>{t}</span>
                    ))}
                </div>
                <span className="hidden text-right @3xl:block">4K titles</span>
                <span className="hidden text-right @3xl:block">Below 1080p</span>
                <span className="hidden @3xl:block" />
            </div>
            {rows.map((r) => (
                <div key={r.type} className="grid min-h-12 grid-cols-[6.5rem_1fr] items-center gap-4 border-b border-base-300 px-4 py-2 last:border-b-0 @3xl:grid-cols-[6.5rem_1fr_5rem_8rem_5rem]">
                    <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-base-content">{r.label}</p>
                        <p className="text-xs text-base-content/70">{r.titles.toLocaleString()} titles</p>
                    </div>
                    {r.known > 0 ? (
                        <div className="relative">
                            <span className="absolute -inset-y-2 left-1/4 w-px bg-base-300" />
                            <span className="absolute -inset-y-2 left-1/2 w-px bg-base-300" />
                            <span className="absolute -inset-y-2 left-3/4 w-px bg-base-300" />
                            <div className="relative flex h-4 gap-0.5 overflow-hidden rounded-full">
                                {buckets.map((b) => {
                                    const p = pct(r.counts[b], r.known);
                                    return p > 0 ? (
                                        <div key={b} style={{ width: `${(r.counts[b] / r.known) * 100}%` }} className={`flex items-center justify-center text-[11px] font-semibold ${SEGMENT[b]}`} title={`${b}: ${r.counts[b]} (${p}%)`}>
                                            {p >= 9 ? `${p}%` : ""}
                                        </div>
                                    ) : null;
                                })}
                            </div>
                        </div>
                    ) : (
                        <span className="text-sm text-base-content/70">Not probed yet</span>
                    )}
                    <span className="hidden text-right text-sm tabular-nums text-base-content @3xl:block">{r.counts["4K"].toLocaleString()}</span>
                    <span className="hidden text-right text-sm tabular-nums text-base-content @3xl:block">
                        {r.below.toLocaleString()} <span className="text-base-content/70">· {pct(r.below, r.known)}%</span>
                    </span>
                    <span className="hidden justify-end @3xl:flex">
                        <button
                            type="button"
                            onClick={() => onReview(r)}
                            className="inline-flex h-8 cursor-pointer items-center rounded-md border border-base-300 bg-base-200 px-3 text-sm font-medium hover:bg-base-300">
                            Review
                        </button>
                    </span>
                </div>
            ))}
        </div>
    );
}

export function ShareLegend() {
    return (
        <div className="flex items-center gap-3 text-sm text-base-content/80">
            <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-secondary" />
                Storage
            </span>
            <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-primary" />
                Watch time
            </span>
        </div>
    );
}

export function QualityLegend() {
    return (
        <div className="flex items-center gap-3 text-sm text-base-content/80">
            {["4K", "1080p", "720p", "SD"].map((b) => (
                <span key={b} className="inline-flex items-center gap-1.5">
                    <span className={`size-2.5 rounded-sm ${SEGMENT[b].split(" ")[0]}`} />
                    {b}
                </span>
            ))}
        </div>
    );
}
