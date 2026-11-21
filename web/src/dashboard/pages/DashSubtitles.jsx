// web/src/Dashboard/Pages/DashSubtitles.jsx
// Subtitle manager. Top to bottom: hero · KPI cards · subtitles table · titles without a subtitle · insight panels · charts.
// Data: GET /api/subtitle/admin/{overview,list,missing}. Dialogs live in Components/DashModal.jsx, charts in Components/DashCharts.jsx.

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import {
    Search,
    MoreVertical,
    ChevronLeft,
    ChevronRight,
    X,
    Eye,
    RefreshCw,
    Trash2,
    ShieldCheck,
    Scissors,
    Timer,
    AlertTriangle,
    CheckCircle,
    HardDrive,
    Languages,
    Sparkles,
    ArrowUp,
    ArrowDown,
    ArrowUpDown,
    Inbox,
    Activity,
    Archive,
    Loader2,
    Film,
    Tv,
    FileDown,
    FileText,
    Gauge as GaugeIcon,
    BarChart3,
    Layers,
    Zap,
    Clock,
    TrendingUp,
} from "lucide-react";
import { subtitleApi } from "../Api/dashboardApi";
import { ConfirmModal, DASH_MODALS, SubtitlePreviewModal, SubtitleShiftModal } from "../Components/DashModal";
import { AreaChart, BarChart, CHART, DonutChart, HBars, Ring, Sparkline } from "../Components/DashCharts";

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtBytes(b) {
    if (!b) return "0 B";
    const u = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
    return `${(b / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}
const fmtInt = (n) => (n == null ? "—" : Number(n).toLocaleString());
function rel(iso) {
    if (!iso) return "—";
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
const shortDay = (iso) => new Date(iso + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });

// ─── Building blocks ──────────────────────────────────────────────────────────

const CARD = "rounded-xl border border-base-300 bg-base-200";

function Skeleton({ className = "" }) {
    return <div className={`animate-pulse rounded-md bg-base-300 ${className}`} />;
}

function Bar({ value, tone = "bg-primary", className = "" }) {
    return (
        <div className={`h-1.5 overflow-hidden rounded-full bg-base-300 ${className}`}>
            <div className={`h-full rounded-full transition-all duration-500 ${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
        </div>
    );
}

const TILE = {
    primary: "bg-primary/12 text-primary",
    success: "bg-success/12 text-success",
    warning: "bg-warning/12 text-warning",
    info: "bg-info/12 text-info",
    accent: "bg-accent/12 text-accent",
    neutral: "bg-base-content/8 text-base-content/70",
};
function IconTile({ icon: Icon, tone = "primary", size = 36 }) {
    return (
        <span className={`inline-flex shrink-0 items-center justify-center rounded-lg ${TILE[tone]}`} style={{ width: size, height: size }}>
            <Icon size={Math.round(size * 0.48)} strokeWidth={1.9} />
        </span>
    );
}

function CardHeader({ icon, tone = "primary", title, desc, right }) {
    return (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-base-300 px-5 py-4">
            <div className="flex min-w-0 items-center gap-3">
                <IconTile icon={icon} tone={tone} />
                <div className="min-w-0">
                    <h3 className="text-sm font-semibold leading-tight text-base-content">{title}</h3>
                    {desc && <p className="mt-0.5 text-xs leading-snug text-base-content/65">{desc}</p>}
                </div>
            </div>
            {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
        </header>
    );
}

const ICON_BTN =
    "size-8 rounded-lg border border-base-300 flex items-center justify-center text-base-content/80 shrink-0 " +
    "transition-colors cursor-pointer hover:bg-base-300 hover:text-base-content " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60";
const BTN = "btn btn-sm rounded-lg border border-base-300 bg-base-100 hover:bg-base-300";

function ActionBtn({ icon: Icon, label, onClick, tone }) {
    return (
        <button onClick={onClick} aria-label={label} title={label} className={`${ICON_BTN} ${tone || ""}`}>
            <Icon size={15} strokeWidth={1.8} />
        </button>
    );
}

function Toast({ toast }) {
    if (!toast) return null;
    return createPortal(
        <div
            role="status"
            className={`fixed bottom-5 right-5 z-99999 flex max-w-sm items-center gap-2.5 rounded-xl px-4 py-3 text-xs font-medium shadow-2xl
            ${toast.type === "error" ? "bg-error text-error-content" : "bg-success text-success-content"}`}>
            {toast.type === "error" ? <AlertTriangle size={14} /> : <CheckCircle size={14} />}
            {toast.msg}
        </div>,
        document.body,
    );
}

// ─── Quality ──────────────────────────────────────────────────────────────────

const QUALITY = {
    good: { dot: "bg-success", badge: "bg-success/10 border-success/30 text-success", label: "High quality", short: "High", accent: null },
    fallback: { dot: "bg-warning", badge: "bg-warning/10 border-warning/30 text-warning", label: "Nearest usable", short: "Nearest", accent: "var(--color-warning)" },
    unvalidated: { dot: "bg-base-content/40", badge: "bg-base-content/5 border-base-content/20 text-base-content/70", label: "Not checked", short: "Unchecked", accent: null },
    upload: { dot: "bg-info", badge: "bg-info/10 border-info/30 text-info", label: "Uploaded", short: "Uploaded", accent: "var(--color-info)" },
};

function QualityBadge({ quality, short = false }) {
    const c = QUALITY[quality] || QUALITY.unvalidated;
    return (
        <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${c.badge}`}>
            <span className={`size-1.5 shrink-0 rounded-full ${c.dot}`} />
            {short ? c.short : c.label}
        </span>
    );
}

const scoreColor = (s) => (s >= 0.85 ? CHART.success : s >= 0.6 ? CHART.warning : CHART.error);

// ─── Hero + KPI cards ─────────────────────────────────────────────────────────

function WorkerChip({ ov }) {
    if (!ov) return <Skeleton className="h-8 w-40" />;
    const w = ov.worker;
    const st = w.paused ? { label: "Paused — limit reached", dot: "bg-warning" } : w.running ? { label: "Working", dot: "bg-success animate-pulse" } : w.idle ? { label: "Idle · ready", dot: "bg-success" } : { label: "Waiting for idle", dot: "bg-base-content/40" };
    return (
        <span className="inline-flex h-8 items-center gap-2 rounded-lg border border-base-300 bg-base-100 px-3 text-xs font-medium">
            <span className={`size-2 shrink-0 rounded-full ${st.dot}`} />
            {st.label}
        </span>
    );
}

function Hero({ ov, fetching, onRefresh }) {
    return (
        <section className={`${CARD} relative overflow-hidden`}>
            <div
                className="pointer-events-none absolute inset-0"
                style={{ background: "radial-gradient(760px 200px at 0% 0%, color-mix(in oklab, var(--color-primary) 15%, transparent), transparent 70%), radial-gradient(520px 180px at 100% 100%, color-mix(in oklab, var(--color-accent) 10%, transparent), transparent 70%)" }}
            />
            <div className="relative flex flex-wrap items-center justify-between gap-4 p-5">
                <div className="flex min-w-0 items-center gap-4">
                    <IconTile icon={Languages} tone="primary" size={48} />
                    <div className="min-w-0">
                        <h1 className="text-xl font-semibold leading-tight tracking-tight">Subtitles</h1>
                        <p className="mt-1 max-w-xl text-sm leading-snug text-base-content/70">Every subtitle FLUX has stored — how good it is, how much space it takes, and which titles still have none.</p>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <WorkerChip ov={ov} />
                    <button onClick={onRefresh} className={BTN}>
                        <RefreshCw size={14} className={fetching ? "animate-spin" : ""} /> Refresh
                    </button>
                </div>
            </div>
        </section>
    );
}

function Kpi({ icon, tone, label, value, sub, visual, partial }) {
    return (
        <div className={`${CARD} flex min-w-0 flex-col gap-3 p-4`}>
            <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                    <IconTile icon={icon} tone={tone} size={32} />
                    <p className="min-w-0 text-xs font-medium leading-tight text-base-content/70">{label}</p>
                </div>
                {visual}
            </div>
            <div>
                <p className="flex items-center gap-2 text-2xl font-semibold leading-none tracking-tight tabular-nums">
                    {value}
                    {partial && <Loader2 size={13} className="animate-spin text-base-content/45" aria-label="Still reading files" />}
                </p>
                <p className="mt-1.5 break-words text-xs leading-snug text-base-content/65">{sub}</p>
            </div>
        </div>
    );
}

function KpiRow({ ov }) {
    if (!ov)
        return (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {[0, 1, 2, 3].map((i) => (
                    <div key={i} className={`${CARD} space-y-3 p-4`}>
                        <Skeleton className="h-8 w-32" />
                        <Skeleton className="h-7 w-24" />
                        <Skeleton className="h-3 w-40" />
                    </div>
                ))}
            </div>
        );
    const t = ov.totals;
    const partial = !ov.analysis.complete;
    const last30 = ov.charts.added.map((d) => d.count);
    const month = last30.reduce((a, b) => a + b, 0);
    const diskShare = ov.storage.dataBytes ? (t.bytes / ov.storage.dataBytes) * 100 : 100;
    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi icon={Languages} tone="primary" label="Subtitles stored" value={fmtInt(t.files)} sub={`${fmtInt(t.titles)} titles · ${ov.languages.length} languages · +${month} in 30 days`} visual={<Sparkline values={last30} color={CHART.primary} />} />
            <Kpi
                icon={HardDrive}
                tone="warning"
                label="Total size of subtitles"
                value={fmtBytes(t.bytes)}
                partial={partial}
                sub={`${fmtBytes(ov.storage.dataBytes)} on disk incl. ${fmtBytes(ov.storage.rejectedBytes)} rejected`}
                visual={
                    <div className="w-16 pt-1" title={`${Math.round(diskShare)}% of the subtitle folder is active files`}>
                        <Bar value={diskShare} tone="bg-warning" />
                        <p className="mt-1 text-right text-[10px] tabular-nums text-base-content/55">{Math.round(diskShare)}% active</p>
                    </div>
                }
            />
            <Kpi icon={FileText} tone="info" label="Total cues" value={fmtInt(t.cues)} partial={partial} sub={t.avgCuePerMin != null ? `${t.avgCuePerMin} cues/min on average` : "Reading files…"} />
            <Kpi
                icon={ShieldCheck}
                tone="success"
                label="Average quality score"
                value={t.avgScore != null ? t.avgScore.toFixed(2) : "—"}
                sub={`${ov.quality.good} high · ${ov.quality.fallback} nearest · ${ov.quality.unvalidated} unchecked`}
                visual={t.avgScore != null && <Ring value={t.avgScore} size={44} stroke={5} color={scoreColor(t.avgScore)} label={`Average score ${t.avgScore.toFixed(2)}`} />}
            />
        </div>
    );
}

// ─── Background worker ───────────────────────────────────────────────────────

function WorkerPanel({ ov, onClearRejected, className = "" }) {
    if (!ov)
        return (
            <section className={`${CARD} overflow-hidden ${className}`}>
                <CardHeader icon={Activity} tone="info" title="Background worker" />
                <div className="space-y-3 p-5">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-16 w-full" />
                </div>
            </section>
        );
    const w = ov.worker;
    const state = w.paused ? { label: "Paused (limit)", dot: "bg-warning" } : w.running ? { label: "Working", dot: "bg-success animate-pulse" } : w.idle ? { label: "Idle · ready", dot: "bg-success" } : { label: "Waiting for the server to be idle", dot: "bg-base-content/40" };
    const qc = ov.queue || {};
    return (
        <section className={`${CARD} flex min-w-0 flex-col overflow-hidden ${className}`}>
            <CardHeader icon={Activity} tone="info" title="Background worker" desc={`Runs after ${ov.config.idleSeconds}s of no streaming`} />
            <div className="flex flex-1 flex-col gap-4 p-5">
                <p className="flex items-center gap-2 text-sm font-medium">
                    <span className={`size-2 shrink-0 rounded-full ${state.dot}`} />
                    {state.label}
                    {w.activeSessions > 0 && <span className="text-xs font-normal text-base-content/65">· {w.activeSessions} stream{w.activeSessions === 1 ? "" : "s"} active</span>}
                </p>
                <div className="grid grid-cols-4 gap-2 text-center">
                    {[
                        ["Pending", (qc.pending || 0) + (qc.downloading || 0)],
                        ["Done", qc.done || 0],
                        ["Skipped", qc.skipped || 0],
                        ["Failed", qc.failed || 0],
                    ].map(([k, v]) => (
                        <div key={k} className="rounded-lg bg-base-300 px-1 py-2.5">
                            <p className="text-base font-semibold leading-none tabular-nums">{v}</p>
                            <p className="mt-1 text-[11px] text-base-content/65">{k}</p>
                        </div>
                    ))}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                    {ov.config.languages.map((l) => (
                        <span key={l} className="rounded-md border border-base-300 px-1.5 py-0.5 text-[11px] font-medium uppercase text-base-content/75">
                            {l}
                        </span>
                    ))}
                    <span className="text-[11px] text-base-content/55">· {ov.config.candidates} candidates per title</span>
                </div>
                <div className="mt-auto flex items-center justify-between gap-2 rounded-lg border border-base-300 bg-base-100 px-3 py-2.5">
                    <p className="min-w-0 text-xs text-base-content/75">
                        <span className="font-semibold text-base-content">{fmtBytes(ov.storage.rejectedBytes)}</span> in rejected files ({ov.storage.rejectedFiles})
                    </p>
                    <button onClick={onClearRejected} disabled={!ov.storage.rejectedFiles} className="btn btn-xs rounded-md border-none bg-base-300 disabled:opacity-40">
                        <Archive size={12} /> Clear
                    </button>
                </div>
            </div>
        </section>
    );
}

// ─── Row ⋮ menu ───────────────────────────────────────────────────────────────
// Fixed-height items on an explicit line-height so text can never overlap, however the page around it is styled.

function useAnchoredMenu(width, estHeight) {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState({ left: 0, top: 0 });
    const btnRef = useRef(null);
    const menuRef = useRef(null);

    useEffect(() => {
        if (!open) return;
        const close = (e) => {
            if (!btnRef.current?.contains(e.target) && !menuRef.current?.contains(e.target)) setOpen(false);
        };
        const esc = (e) => {
            if (e.key === "Escape") {
                setOpen(false);
                btnRef.current?.focus();
            }
        };
        const scroll = (e) => {
            if (!menuRef.current?.contains(e.target)) setOpen(false);
        };
        const resize = () => setOpen(false);
        document.addEventListener("mousedown", close);
        document.addEventListener("keydown", esc);
        window.addEventListener("scroll", scroll, true);
        window.addEventListener("resize", resize);
        menuRef.current?.querySelector("button")?.focus();
        return () => {
            document.removeEventListener("mousedown", close);
            document.removeEventListener("keydown", esc);
            window.removeEventListener("scroll", scroll, true);
            window.removeEventListener("resize", resize);
        };
    }, [open]);

    function toggle(e) {
        e.stopPropagation();
        if (!btnRef.current) return;
        const r = btnRef.current.getBoundingClientRect();
        const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
        const flip = window.innerHeight - r.bottom < estHeight + 12 && r.top > estHeight;
        setPos(flip ? { left, bottom: window.innerHeight - r.top + 6 } : { left, top: r.bottom + 6 });
        setOpen((o) => !o);
    }
    return { open, setOpen, btnRef, menuRef, pos, toggle };
}

function rowMenuGroups(r) {
    return [
        { label: "Inspect", items: [{ key: "preview", label: "View details", icon: Eye }] },
        {
            label: "Quality",
            items: [
                { key: "revalidate", label: "Re-validate", icon: ShieldCheck },
                ...(r.quality === "fallback" ? [{ key: "upgrade", label: "Find a better one", icon: Sparkles }] : []),
                { key: "shift", label: "Shift timing…", icon: Timer },
                ...(r.ext === ".srt" ? [{ key: "clean", label: "Remove watermark cues", icon: Scissors }] : []),
            ],
        },
        { label: "Replace", items: [{ key: "redownload", label: "Re-download", icon: RefreshCw }] },
        { label: null, items: [{ key: "delete", label: "Delete subtitle", icon: Trash2, danger: true }] },
    ];
}

function RowMenu({ row, onAction }) {
    const W = 244;
    const { open, setOpen, btnRef, menuRef, pos, toggle } = useAnchoredMenu(W, 330);
    return (
        <>
            <button ref={btnRef} onClick={toggle} aria-label="More actions" aria-haspopup="menu" aria-expanded={open} title="More actions" className={`${ICON_BTN} ${open ? "bg-base-300 text-base-content" : ""}`}>
                <MoreVertical size={15} strokeWidth={1.8} />
            </button>
            {open &&
                createPortal(
                    <div
                        ref={menuRef}
                        role="menu"
                        aria-label={`Actions for ${row.title}`}
                        style={{ position: "fixed", ...pos, zIndex: 99999, width: W, lineHeight: "20px", fontSize: 13 }}
                        className="overflow-hidden rounded-xl border border-base-300 bg-base-200 p-1.5 font-sans shadow-2xl">
                        {rowMenuGroups(row).map((g, gi) => (
                            <div key={gi} className={gi ? "mt-1 border-t border-base-300 pt-1" : ""}>
                                {g.label && <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-base-content/45">{g.label}</p>}
                                {g.items.map((a) => (
                                    <button
                                        key={a.key}
                                        role="menuitem"
                                        onClick={() => {
                                            setOpen(false);
                                            onAction(row, a.key);
                                        }}
                                        className={`flex h-9 w-full cursor-pointer items-center gap-3 rounded-lg border-none bg-transparent px-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${a.danger ? "text-error hover:bg-error/10" : "text-base-content hover:bg-base-300"}`}>
                                        <a.icon size={15} className={`shrink-0 ${a.danger ? "" : "text-base-content/60"}`} />
                                        <span className="min-w-0 flex-1 whitespace-nowrap font-medium">{a.label}</span>
                                    </button>
                                ))}
                            </div>
                        ))}
                    </div>,
                    document.body,
                )}
        </>
    );
}

// The one-click action next to "details": fallbacks get "find a better one", everything else "re-validate"
function quickAction(r) {
    return r.quality === "fallback" ? { key: "upgrade", label: "Find a better one", icon: Sparkles, tone: "hover:!text-success" } : { key: "revalidate", label: "Re-validate", icon: ShieldCheck, tone: "hover:!text-info" };
}

// ─── Table pieces ─────────────────────────────────────────────────────────────

const TH = "px-3 py-3 align-bottom text-[11px] font-medium uppercase tracking-wider";

function SortTh({ id, label, sort, order, onSort, align = "left", className = "" }) {
    const active = sort === id;
    const Icon = !active ? ArrowUpDown : order === "asc" ? ArrowUp : ArrowDown;
    return (
        <th className={`${TH} ${align === "right" ? "text-right" : "text-left"} ${className}`} aria-sort={active ? (order === "asc" ? "ascending" : "descending") : "none"}>
            <button onClick={() => onSort(id)} className={`inline-flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-[11px] font-medium uppercase tracking-wider transition-colors hover:text-base-content ${align === "right" ? "flex-row-reverse" : ""} ${active ? "text-base-content" : "text-base-content/55"}`}>
                {label}
                <Icon size={11} className={`shrink-0 ${active ? "text-primary" : "opacity-50"}`} />
            </button>
        </th>
    );
}

function TableSkeleton() {
    return (
        <div>
            {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 border-b border-base-300 px-5 py-3.5">
                    <Skeleton className="size-5 shrink-0" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                        <Skeleton className="h-3.5 w-3/5" />
                        <Skeleton className="h-2.5 w-4/5" />
                    </div>
                    <Skeleton className="h-6 w-16" />
                    <div className="flex gap-1.5">
                        <Skeleton className="size-8" />
                        <Skeleton className="size-8" />
                    </div>
                </div>
            ))}
        </div>
    );
}

function EmptyState({ icon: Icon = Inbox, title, text, onClear }) {
    return (
        <div className="flex flex-col items-center justify-center px-4 py-14 text-center">
            <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-base-300">
                <Icon size={22} className="text-base-content/55" />
            </div>
            <p className="text-sm font-semibold text-base-content">{title}</p>
            <p className="mt-1 max-w-sm text-xs leading-relaxed text-base-content/65">{text}</p>
            {onClear && (
                <button onClick={onClear} className="btn btn-sm btn-primary mt-4 rounded-lg border-none">
                    Clear filters
                </button>
            )}
        </div>
    );
}

const PAGE_SIZE = 10;

function Pagination({ page, pages, total, limit, onPage }) {
    const from = total === 0 ? 0 : (page - 1) * limit + 1;
    const to = Math.min(page * limit, total);
    const makePages = () => {
        if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
        const out = [];
        for (let i = 1; i <= pages; i++) {
            if (i === 1 || i === pages || (i >= page - 1 && i <= page + 1)) out.push(i);
            else if (out[out.length - 1] !== "...") out.push("...");
        }
        return out;
    };
    return (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-base-300 px-5 py-3">
            <p className="text-xs tabular-nums text-base-content/70">
                Showing {from}–{to} of {total}
            </p>
            {pages > 1 && (
                <div className="flex flex-wrap items-center gap-1.5">
                    <button onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page" className={`${ICON_BTN} disabled:cursor-not-allowed disabled:opacity-30`}>
                        <ChevronLeft size={15} />
                    </button>
                    {makePages().map((p, i) =>
                        p === "..." ? (
                            <span key={`d${i}`} className="flex size-8 items-center justify-center text-xs text-base-content/60">
                                …
                            </span>
                        ) : (
                            <button
                                key={p}
                                onClick={() => onPage(p)}
                                aria-current={page === p ? "page" : undefined}
                                className={`size-8 cursor-pointer rounded-lg border-none text-xs font-medium transition-colors ${page === p ? "bg-primary text-primary-content" : "bg-transparent text-base-content/80 hover:bg-base-300 hover:text-base-content"}`}>
                                {p}
                            </button>
                        ),
                    )}
                    <button onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page" className={`${ICON_BTN} disabled:cursor-not-allowed disabled:opacity-30`}>
                        <ChevronRight size={15} />
                    </button>
                </div>
            )}
        </div>
    );
}

function Stat({ label, children }) {
    return (
        <div className="min-w-0">
            <p className="text-[11px] text-base-content/60">{label}</p>
            <div className="text-sm font-medium tabular-nums">{children}</div>
        </div>
    );
}

// ─── Subtitles table ──────────────────────────────────────────────────────────
// Wide screens: an auto-layout table — every column is exactly as wide as its content (no wrapping, no wasted space) and
// only the Title column takes what is left and wraps. Nothing scrolls sideways. Narrower screens: stacked cards.

const fmtExt = (ext) => (ext ? ext.replace(".", "").toUpperCase() : "—");
const SHRINK = "w-px whitespace-nowrap";
const CELL = "px-2 py-3.5 align-top";

function ScoreDot({ score }) {
    if (score == null) return <span className="text-xs text-base-content/45">—</span>;
    const tone = score >= 0.85 ? "bg-success" : score >= 0.6 ? "bg-warning" : "bg-error";
    return (
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold tabular-nums" title={`Score ${score.toFixed(2)}`}>
            <span className={`size-2 shrink-0 rounded-full ${tone}`} aria-hidden="true" />
            {score.toFixed(2)}
        </span>
    );
}

const LangChip = ({ code, label }) => (
    <span title={label} className="inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-bold uppercase tracking-wide text-primary">
        {code}
    </span>
);
const FormatChip = ({ ext }) => <span className="inline-flex items-center rounded-md bg-base-300 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-base-content/80">{fmtExt(ext)}</span>;

function SubtitleTable({ rows, offset, sort, order, onSort, onAction }) {
    return (
        <>
            <div className="hidden min-[1360px]:block">
                <table className="w-full table-auto border-collapse">
                    <thead>
                        <tr className="border-b border-base-300 bg-base-100/40">
                            <th className={`${TH} ${SHRINK} pl-5 text-left text-base-content/55`}>SL</th>
                            <SortTh id="title" label="Title" sort={sort} order={order} onSort={onSort} className="w-full" />
                            <SortTh id="lang" label="Lang" sort={sort} order={order} onSort={onSort} className={SHRINK} />
                            <th className={`${TH} ${SHRINK} text-left text-base-content/55`}>Format</th>
                            <SortTh id="quality" label="Quality" sort={sort} order={order} onSort={onSort} className={SHRINK} />
                            <SortTh id="score" label="Score" sort={sort} order={order} onSort={onSort} className={SHRINK} />
                            <SortTh id="cues" label="Cues" sort={sort} order={order} onSort={onSort} align="right" className={SHRINK} />
                            <SortTh id="cuePerSec" label="Cue/s" sort={sort} order={order} onSort={onSort} align="right" className={SHRINK} />
                            <SortTh id="size" label="Size" sort={sort} order={order} onSort={onSort} align="right" className={SHRINK} />
                            <SortTh id="added" label="Added" sort={sort} order={order} onSort={onSort} className={SHRINK} />
                            <th className={`${TH} ${SHRINK} text-left text-base-content/55`}>Source</th>
                            <th className={`${TH} ${SHRINK} pr-5 text-right text-base-content/55`}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r, i) => {
                            const accent = (QUALITY[r.quality] || {}).accent;
                            const qa = quickAction(r);
                            return (
                                <tr key={r.key} className="group/row border-b border-base-300 transition-colors last:border-b-0 hover:bg-base-300/50">
                                    <td className={`${CELL} ${SHRINK} pl-5 text-sm tabular-nums text-base-content/60`} style={accent ? { boxShadow: `inset 3px 0 0 ${accent}` } : undefined}>
                                        {offset + i + 1}
                                    </td>
                                    <td className={`${CELL} min-w-40`}>
                                        <button onClick={() => onAction(r, "preview")} className="block w-full cursor-pointer border-none bg-transparent p-0 text-left">
                                            <span className="block text-sm font-semibold leading-snug transition-colors [overflow-wrap:anywhere] group-hover/row:text-primary">{r.title}</span>
                                            {r.missing && <span className="mt-0.5 block text-xs text-error">File missing on disk</span>}
                                        </button>
                                    </td>
                                    <td className={`${CELL} ${SHRINK}`}>
                                        <LangChip code={r.lang} label={r.label} />
                                    </td>
                                    <td className={`${CELL} ${SHRINK}`}>
                                        <FormatChip ext={r.ext} />
                                    </td>
                                    <td className={`${CELL} ${SHRINK}`}>
                                        <QualityBadge quality={r.quality} short />
                                    </td>
                                    <td className={`${CELL} ${SHRINK}`}>
                                        <ScoreDot score={r.score} />
                                    </td>
                                    <td className={`${CELL} ${SHRINK} text-right text-sm tabular-nums`}>{r.cues != null ? fmtInt(r.cues) : "…"}</td>
                                    <td className={`${CELL} ${SHRINK} text-right text-sm tabular-nums`} title={r.cuePerMin != null ? `${r.cuePerMin} cues per minute` : undefined}>
                                        {r.cuePerSec != null ? r.cuePerSec.toFixed(2) : "—"}
                                    </td>
                                    <td className={`${CELL} ${SHRINK} text-right text-sm tabular-nums`}>{r.sizeBytes != null ? fmtBytes(r.sizeBytes) : "—"}</td>
                                    <td className={`${CELL} ${SHRINK} text-sm`}>{rel(r.addedAt)}</td>
                                    <td className={`${CELL} ${SHRINK} text-sm capitalize text-base-content/80`}>{r.source}</td>
                                    <td className={`${CELL} ${SHRINK} pr-5`}>
                                        <div className="flex items-center justify-end gap-1.5">
                                            <ActionBtn icon={Eye} label="View details" onClick={() => onAction(r, "preview")} tone="hover:!text-primary" />
                                            <ActionBtn icon={qa.icon} label={qa.label} onClick={() => onAction(r, qa.key)} tone={qa.tone} />
                                            <RowMenu row={r} onAction={onAction} />
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Narrower screens: stacked cards */}
            <ul className="divide-y divide-base-300 min-[1360px]:hidden">
                {rows.map((r, i) => {
                    const qa = quickAction(r);
                    return (
                        <li key={r.key} className="space-y-3 px-4 py-3.5">
                            <div className="flex items-start gap-3">
                                <span className="mt-0.5 w-6 shrink-0 text-sm tabular-nums text-base-content/55">{offset + i + 1}</span>
                                <button onClick={() => onAction(r, "preview")} className="min-w-0 flex-1 cursor-pointer border-none bg-transparent p-0 text-left">
                                    <span className="block text-sm font-semibold leading-snug [overflow-wrap:anywhere]">{r.title}</span>
                                    {r.missing && <span className="block text-xs text-error">File missing on disk</span>}
                                </button>
                                <div className="flex shrink-0 items-center gap-1.5">
                                    <ActionBtn icon={Eye} label="View details" onClick={() => onAction(r, "preview")} />
                                    <ActionBtn icon={qa.icon} label={qa.label} onClick={() => onAction(r, qa.key)} />
                                    <RowMenu row={r} onAction={onAction} />
                                </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 pl-9">
                                <LangChip code={r.lang} label={r.label} />
                                <FormatChip ext={r.ext} />
                                <QualityBadge quality={r.quality} />
                                <ScoreDot score={r.score} />
                            </div>
                            <div className="grid grid-cols-3 gap-x-3 gap-y-2.5 pl-9 sm:grid-cols-5">
                                <Stat label="Cues">{r.cues != null ? fmtInt(r.cues) : "…"}</Stat>
                                <Stat label="Cue/s">{r.cuePerSec != null ? r.cuePerSec.toFixed(2) : "—"}</Stat>
                                <Stat label="Size">{r.sizeBytes != null ? fmtBytes(r.sizeBytes) : "—"}</Stat>
                                <Stat label="Added">{rel(r.addedAt)}</Stat>
                                <Stat label="Source">
                                    <span className="capitalize">{r.source}</span>
                                </Stat>
                            </div>
                        </li>
                    );
                })}
            </ul>
        </>
    );
}

// ─── Titles with no subtitle ──────────────────────────────────────────────────

const MISSING_TABS = [
    { v: "", label: "All" },
    { v: "waiting", label: "Waiting" },
    { v: "nomatch", label: "No match" },
    { v: "failed", label: "Failed" },
];

const STATUS_BADGE = {
    waiting: { cls: "bg-info/10 border-info/30 text-info", dot: "bg-info", label: "Waiting" },
    nomatch: { cls: "bg-warning/10 border-warning/30 text-warning", dot: "bg-warning", label: "No match" },
    failed: { cls: "bg-error/10 border-error/30 text-error", dot: "bg-error", label: "Failed" },
};
const statusOf = (r) => (r.status === "failed" ? "failed" : r.status === "pending" || r.status === "downloading" ? "waiting" : "nomatch");

const REASONS = {
    waiting: "Waiting for its turn — runs when the server is idle",
    no_results: "SubSource has no entry for this title",
    no_valid_candidate: "Subtitles exist, but none was good enough",
    no_language_available: "None in your languages",
    all_downloads_failed: "Downloads failed",
    none_stored: "Nothing stored (deleted, or unavailable)",
};
const reasonText = (r) => REASONS[r.reason] || r.lastError || "—";

const RES_TONE = { "4K": "bg-accent/15 text-accent", "1440p": "bg-primary/15 text-primary", "1080p": "bg-success/15 text-success", "720p": "bg-info/15 text-info" };
const RES_COLOR = { "4K": CHART.accent, "1440p": CHART.primary, "1080p": CHART.success, "720p": CHART.info, "480p": CHART.warning, SD: CHART.warning, Unknown: CHART.muted };
function ResBadge({ label }) {
    if (!label) return <span className="text-xs text-base-content/50">Unknown</span>;
    return <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-bold tracking-wide ${RES_TONE[label] || "bg-base-content/10 text-base-content/70"}`}>{label}</span>;
}
function EmbeddedCell({ r }) {
    if (r.embeddedText) return <span className="text-xs font-medium text-success">{r.embeddedText} text track{r.embeddedText === 1 ? "" : "s"}</span>;
    if (r.embeddedImage) return <span className="text-xs font-medium text-warning">Picture only</span>;
    return <span className="text-xs text-base-content/55">None</span>;
}
function StatusPill({ r }) {
    const c = STATUS_BADGE[statusOf(r)];
    return (
        <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${c.cls}`}>
            <span className={`size-1.5 shrink-0 rounded-full ${c.dot}`} />
            {c.label}
        </span>
    );
}

function MissingSection({ flash, onQueued }) {
    const [status, setStatus] = useState("");
    const [type, setType] = useState("");
    const [search, setSearch] = useState("");
    const [debounced, setDebounced] = useState("");
    const [sort, setSort] = useState("quality");
    const [order, setOrder] = useState("desc");
    const [page, setPage] = useState(1);
    const limit = PAGE_SIZE;
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        const t = setTimeout(() => setDebounced(search.trim()), 300);
        return () => clearTimeout(t);
    }, [search]);
    useEffect(() => setPage(1), [status, type, debounced, sort, order]);

    const params = { page, limit, status, type, search: debounced, sort, order };
    const q = useQuery({ queryKey: ["subtitle-admin", "missing", params], queryFn: () => subtitleApi.missing(params), placeholderData: (prev) => prev, refetchInterval: 30000 });
    const d = q.data;
    const rows = d?.rows || [];
    const c = d?.counts;
    useEffect(() => {
        if (d?.pages && page > d.pages) setPage(d.pages); // last row of the last page was acted on → fewer pages now
    }, [d?.pages, page]);

    async function retry(body, label) {
        setBusy(true);
        try {
            const r = await subtitleApi.retryMissing(body);
            flash(r.queued ? `${label}: ${r.queued} queued — searched when the server is idle` : "Nothing to queue");
            q.refetch();
            onQueued?.();
        } catch (e) {
            flash(e?.message || "Couldn’t queue", "error");
        } finally {
            setBusy(false);
        }
    }

    const onSort = (id) => {
        if (id === sort) setOrder((o) => (o === "asc" ? "desc" : "asc"));
        else {
            setSort(id);
            setOrder(id === "quality" ? "desc" : "asc");
        }
    };
    const tabCount = (v) => (!c ? 0 : v === "" ? c.total : c[v] || 0);
    const offset = (page - 1) * limit;
    const hasFilter = !!(status || type || debounced);
    const retryable = c ? (status === "" ? c.nomatch + c.failed : tabCount(status)) : 0;

    return (
        <section className={`${CARD} flex min-w-0 flex-col overflow-hidden`}>
            <CardHeader
                icon={Film}
                tone="warning"
                title={`Titles without a subtitle${c ? ` · ${c.total}` : ""}`}
                desc={`Best video quality first${c && c.withEmbedded ? ` · ${c.withEmbedded} already have an embedded text track` : ""}`}
                right={
                    <button onClick={() => retry({ all: true, status: status === "waiting" ? "" : status }, "Search again")} disabled={busy || !retryable || status === "waiting"} className="btn btn-sm btn-primary rounded-lg border-none disabled:opacity-40">
                        <RefreshCw size={14} className={busy ? "animate-spin" : ""} /> Search again{retryable ? ` · ${retryable}` : ""}
                    </button>
                }
            />

            <div className="flex flex-wrap items-center gap-3 border-b border-base-300 px-5 py-3">
                <div className="flex flex-wrap items-center gap-1 rounded-xl border border-base-300 bg-base-100 p-1">
                    {MISSING_TABS.map((t) => {
                        const active = status === t.v;
                        const n = tabCount(t.v);
                        return (
                            <button
                                key={t.v || "all"}
                                onClick={() => setStatus(t.v)}
                                className={`flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border-none px-3 text-sm font-medium transition-colors ${active ? "bg-primary text-primary-content shadow-sm" : "bg-transparent text-base-content hover:bg-base-300"}`}>
                                {t.label}
                                {n > 0 && <span className={`text-xs font-normal tabular-nums ${active ? "text-primary-content/90" : "text-base-content/60"}`}>{n}</span>}
                            </button>
                        );
                    })}
                </div>
                <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
                    <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type" className="h-9 shrink-0 cursor-pointer rounded-lg border border-base-300 bg-base-100 px-2.5 text-sm text-base-content focus:border-primary focus:outline-none">
                        <option value="">Movies & series</option>
                        <option value="movie">Movies</option>
                        <option value="tv">Series</option>
                    </select>
                    <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-base-300 bg-base-100 px-3 transition-colors focus-within:border-primary sm:w-56 sm:flex-none">
                        <Search size={14} className="shrink-0 text-base-content/60" />
                        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search titles" className="min-w-0 flex-1 bg-transparent text-base text-base-content placeholder:text-base-content/55 focus:outline-none sm:text-sm" />
                        {search && (
                            <button onClick={() => setSearch("")} aria-label="Clear search" className="cursor-pointer border-none bg-transparent text-base-content/60 hover:text-base-content">
                                <X size={14} />
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {q.isLoading ? (
                <TableSkeleton />
            ) : q.isError && !d ? (
                <div className="flex flex-col items-center gap-3 rounded-box border border-dashed border-base-300 px-6 py-12 text-center">
                    <p className="text-sm font-semibold">Couldn’t load the list of missing subtitles</p>
                    <p className="text-xs text-base-content/70">{q.error?.message || "The request failed."}</p>
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => q.refetch()}>
                        Retry
                    </button>
                </div>
            ) : rows.length === 0 ? (
                hasFilter ? (
                    <EmptyState title="No titles match your filters" text="Try another search or clear the filters." onClear={() => { setStatus(""); setType(""); setSearch(""); }} />
                ) : (
                    <EmptyState icon={CheckCircle} title="Every title has a subtitle" text="Nothing is waiting for a subtitle download." />
                )
            ) : (
                <>
                    <div className="hidden min-[1360px]:block">
                        <table className="w-full table-auto border-collapse">
                            <thead>
                                <tr className="border-b border-base-300 bg-base-100/40">
                                    <th className={`${TH} ${SHRINK} pl-5 text-left text-base-content/55`}>SL</th>
                                    <SortTh id="title" label="Title" sort={sort} order={order} onSort={onSort} className="w-1/3" />
                                    <SortTh id="quality" label="Video" sort={sort} order={order} onSort={onSort} className={SHRINK} />
                                    <SortTh id="status" label="Status" sort={sort} order={order} onSort={onSort} className={SHRINK} />
                                    <th className={`${TH} w-full text-left text-base-content/55`}>Why</th>
                                    <th className={`${TH} ${SHRINK} text-left text-base-content/55`}>Embedded</th>
                                    <th className={`${TH} ${SHRINK} pr-5 text-right text-base-content/55`}>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r, i) => (
                                    <tr key={r.mediaId} className="border-b border-base-300 transition-colors last:border-b-0 hover:bg-base-300/50">
                                        <td className={`${CELL} ${SHRINK} pl-5 text-sm tabular-nums text-base-content/60`}>{offset + i + 1}</td>
                                        <td className={`${CELL} min-w-40`}>
                                            <p className="flex items-start gap-1.5 text-sm font-semibold leading-snug [overflow-wrap:anywhere]">
                                                {r.type === "movie" ? <Film size={13} className="mt-0.5 shrink-0 text-base-content/45" /> : <Tv size={13} className="mt-0.5 shrink-0 text-base-content/45" />}
                                                <span className="min-w-0">{r.title}</span>
                                            </p>
                                            {r.sizeBytes ? <p className="pl-5 text-[11px] text-base-content/55">{fmtBytes(r.sizeBytes)}</p> : null}
                                        </td>
                                        <td className={`${CELL} ${SHRINK}`}>
                                            <ResBadge label={r.quality} />
                                        </td>
                                        <td className={`${CELL} ${SHRINK}`}>
                                            <StatusPill r={r} />
                                        </td>
                                        <td className={`${CELL} text-xs leading-snug text-base-content/80`}>
                                            {reasonText(r)}
                                            {r.attempts > 0 && <span className="whitespace-nowrap text-base-content/55"> · tried {r.attempts}×</span>}
                                        </td>
                                        <td className={`${CELL} ${SHRINK}`}>
                                            <EmbeddedCell r={r} />
                                        </td>
                                        <td className={`${CELL} ${SHRINK} pr-5`}>
                                            <div className="flex justify-end">
                                                <button onClick={() => retry({ mediaIds: [r.mediaId] }, r.title)} disabled={busy || statusOf(r) === "waiting"} title={statusOf(r) === "waiting" ? "Already queued" : "Search again"} className="btn btn-xs rounded-lg border border-base-300 bg-base-100 hover:bg-base-300 disabled:opacity-40">
                                                    <RefreshCw size={12} /> Retry
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <ul className="divide-y divide-base-300 min-[1360px]:hidden">
                        {rows.map((r, i) => (
                            <li key={r.mediaId} className="space-y-2.5 px-4 py-3.5">
                                <div className="flex items-start gap-3">
                                    <span className="mt-0.5 w-6 shrink-0 text-sm tabular-nums text-base-content/55">{offset + i + 1}</span>
                                    <div className="min-w-0 flex-1">
                                        <p className="break-words text-sm font-semibold leading-snug">{r.title}</p>
                                        <p className="text-xs text-base-content/70">{reasonText(r)}</p>
                                    </div>
                                    <button onClick={() => retry({ mediaIds: [r.mediaId] }, r.title)} disabled={busy || statusOf(r) === "waiting"} className="btn btn-xs shrink-0 rounded-lg border border-base-300 bg-base-100 disabled:opacity-40">
                                        <RefreshCw size={12} /> Retry
                                    </button>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 pl-9">
                                    <ResBadge label={r.quality} />
                                    <StatusPill r={r} />
                                    <EmbeddedCell r={r} />
                                </div>
                            </li>
                        ))}
                    </ul>
                </>
            )}

            {d && d.total > 0 && <Pagination page={d.page} pages={d.pages} total={d.total} limit={d.limit} onPage={setPage} />}
        </section>
    );
}

// ─── Charts ───────────────────────────────────────────────────────────────────

function ChartCard({ icon, tone, title, desc, children, className = "", right }) {
    return (
        <section className={`${CARD} flex min-w-0 flex-col overflow-hidden ${className}`}>
            <CardHeader icon={icon} tone={tone} title={title} desc={desc} right={right} />
            <div className="flex flex-1 flex-col justify-center p-5">{children}</div>
        </section>
    );
}

function ChartsSkeleton({ n = 6 }) {
    return (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: n }).map((_, i) => (
                <div key={i} className={`${CARD} space-y-4 p-5`}>
                    <Skeleton className="h-8 w-40" />
                    <Skeleton className="h-40 w-full" />
                </div>
            ))}
        </div>
    );
}

function Charts({ ov, missing }) {
    if (!ov) return <ChartsSkeleton n={9} />;
    const ch = ov.charts;
    const q = ov.quality;
    const files = ov.totals.files;
    const qSeg = [
        { label: "High quality", value: q.good || 0, color: CHART.success },
        { label: "Nearest usable", value: q.fallback || 0, color: CHART.warning },
        { label: "Not checked", value: q.unvalidated || 0, color: CHART.muted },
        { label: "Uploaded", value: q.upload || 0, color: CHART.info },
    ];
    const cov = ch.coverage;
    const covPct = cov.titles ? Math.round((cov.withSubs / cov.titles) * 100) : 0;
    const month = ch.added.reduce((a, d) => a + d.count, 0);
    const binColor = (b) => (b.from < 0.5 ? CHART.error : b.from < 0.7 ? CHART.warning : CHART.success);
    const resRows = (missing?.counts?.byResolution || []).map((r) => ({ label: r.label, value: r.count, color: RES_COLOR[r.label] || CHART.muted }));
    const langRows = ov.languages.map((l, i) => ({ label: l.label, value: l.bytes, hint: `${fmtInt(l.files)} files`, color: [CHART.primary, CHART.accent, CHART.info, CHART.success, CHART.warning][i % 5] }));
    const sizeRows = [
        { label: "High quality", value: ch.sizeByQuality.good || 0, color: CHART.success },
        { label: "Nearest usable", value: ch.sizeByQuality.fallback || 0, color: CHART.warning },
        { label: "Not checked", value: ch.sizeByQuality.unvalidated || 0, color: CHART.muted },
        { label: "Uploaded", value: ch.sizeByQuality.upload || 0, color: CHART.info },
    ].filter((r) => r.value);
    const SRC = { subsource: ["SubSource", CHART.primary], manual: ["Manual download", CHART.accent], upload: ["Uploaded by you", CHART.info], legacy: ["Earlier version", CHART.muted] };
    const srcSeg = Object.entries(ov.sources || {}).map(([k, v]) => ({ label: (SRC[k] || [k])[0], value: v, color: (SRC[k] || [0, CHART.muted])[1] }));
    return (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <ChartCard icon={ShieldCheck} tone="success" title="Quality mix" desc="How the stored subtitles were judged">
                <DonutChart segments={qSeg} center={{ value: files, label: "subtitles" }} />
            </ChartCard>

            <ChartCard icon={GaugeIcon} tone="primary" title="Score distribution" desc={`${ch.noScore ? `${ch.noScore} unscored · ` : ""}green = high quality (0.72+)`}>
                <BarChart data={ch.scoreHistogram.map((b) => ({ label: b.label, value: b.count, color: binColor(b), tip: `Score ${b.label}` }))} height={160} unit=" subtitles" />
            </ChartCard>

            <ChartCard icon={Activity} tone="info" title="Added in the last 30 days" desc={`${month} subtitle${month === 1 ? "" : "s"} stored`}>
                <AreaChart points={ch.added.map((d) => ({ label: shortDay(d.date), value: d.count }))} color={CHART.info} height={160} peak unit=" added" />
            </ChartCard>

            <ChartCard icon={BarChart3} tone="accent" title="Cue density" desc="Cues per minute · 8–16 is typical for dialogue">
                <BarChart data={ch.cueDensity.map((b) => ({ label: b.label, value: b.count, tip: `${b.label} cues/min` }))} height={160} color={CHART.accent} highlight={(d) => d.label === "8–12" || d.label === "12–16"} unit=" subtitles" />
            </ChartCard>

            <ChartCard icon={Layers} tone="warning" title="Title coverage" desc="Titles that have at least one subtitle">
                <DonutChart
                    segments={[
                        { label: "With a subtitle", value: cov.withSubs, color: CHART.success },
                        { label: "Without", value: cov.withoutSubs, color: CHART.warning },
                    ]}
                    center={{ value: `${covPct}%`, label: "covered" }}
                />
            </ChartCard>

            <ChartCard icon={Film} tone="warning" title="Missing, by video quality" desc="Titles still without a subtitle">
                <HBars rows={resRows} empty="No titles are missing a subtitle" />
            </ChartCard>

            <ChartCard icon={HardDrive} tone="primary" title="Storage by language" desc={`${fmtBytes(ov.totals.bytes)} in total`}>
                <HBars rows={langRows} format={fmtBytes} empty="No subtitles stored yet" />
            </ChartCard>

            <ChartCard icon={HardDrive} tone="warning" title="Storage by quality" desc="Where the disk space goes">
                <HBars rows={sizeRows} format={fmtBytes} empty="Sizes appear once the files are read" />
            </ChartCard>

            <ChartCard icon={Layers} tone="accent" title="Where subtitles come from" desc="Source of each stored file">
                <DonutChart segments={srcSeg} center={{ value: files, label: "subtitles" }} />
            </ChartCard>
        </div>
    );
}

// ─── API requests (bottom of the page) ────────────────────────────────────────

const hourLabel = (t) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric" });
const hourRange = (t) => `${hourLabel(t)} – ${hourLabel(t + 3_600_000)}`;
const dayTitle = (t) => new Date(t).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const clock = (h) => `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
const clockShort = (h) => `${h % 12 || 12}${h < 12 ? "a" : "p"}`;

function Tile({ icon, tone = "primary", label, value, sub, children }) {
    return (
        <div className="min-w-0 rounded-xl border border-base-300 bg-base-100 p-4">
            <div className="flex items-center gap-2.5">
                <IconTile icon={icon} tone={tone} size={28} />
                <p className="text-xs font-medium text-base-content/70">{label}</p>
            </div>
            <p className="mt-3 text-xl font-semibold leading-tight tabular-nums">{value}</p>
            {sub && <p className="mt-1 text-xs leading-snug text-base-content/65">{sub}</p>}
            {children}
        </div>
    );
}

function ApiSection({ ov, onClearRejected }) {
    if (!ov) return <ChartsSkeleton n={6} />;
    const u = ov.usage;
    const t = u.totals;
    const used = ov.budget.used;
    const limit = ov.budget.limit;
    const last24 = u.hours.slice(-24);
    const hasData = t.all > 0;
    const peakH = u.peak.hour;
    const typ = u.peak.typicalHour;
    const typPct = typ && t.all ? Math.round((typ.total / t.all) * 100) : 0;
    const hourBars = last24.map((h) => ({ label: hourLabel(h.t), value: h.n, color: h.limited ? CHART.error : undefined, tip: `${new Date(h.t).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${hourRange(h.t)} · ${h.search} searches, ${h.download} downloads${h.limited ? `, ${h.limited} rate-limited` : ""}` }));
    const profile = u.byHour.map((b) => ({ label: clockShort(b.hour), value: b.total, hour: b.hour, tip: `${clock(b.hour)} – ${clock((b.hour + 1) % 24)} (server time)` }));
    const mix = [
        { label: "Searches & lookups", value: t.search, color: CHART.info },
        { label: "Subtitle downloads", value: t.download, color: CHART.success },
        { label: "Rate-limited", value: t.limited, color: CHART.warning },
    ];
    return (
        <div className="space-y-4">
            <section className={`${CARD} overflow-hidden`}>
                <CardHeader icon={Zap} tone="info" title="SubSource API requests" desc={u.since ? `Recorded since ${new Date(u.since).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}` : "Recorded from now on"} />
                <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
                    <Tile icon={Zap} tone="info" label="This hour" value={`${used} / ${limit}`} sub={`${Math.round((used / Math.max(1, limit)) * 100)}% of the hourly budget`}>
                        <Bar value={(used / Math.max(1, limit)) * 100} tone={used / limit > 0.85 ? "bg-warning" : "bg-info"} className="mt-3" />
                    </Tile>
                    <Tile icon={Clock} tone="primary" label="Last 24 hours" value={fmtInt(t.last24h)} sub={`${fmtInt(t.last7d)} in the last 7 days · ${fmtInt(t.all)} in total`} />
                    <Tile icon={AlertTriangle} tone={t.limitedLast24h ? "warning" : "success"} label="Rate-limit hits (24 h)" value={fmtInt(t.limitedLast24h)} sub={t.limited ? `${fmtInt(t.limited)} since recording began` : "None so far — within the limits"} />
                    <Tile
                        icon={TrendingUp}
                        tone="warning"
                        label="Peak hour"
                        value={peakH ? hourRange(peakH.t) : "—"}
                        sub={peakH ? `${fmtInt(peakH.n)} requests · ${new Date(peakH.t).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}` : "No requests recorded yet"}
                    />
                    <Tile icon={Clock} tone="accent" label="Usually busiest" value={typ ? `${clock(typ.hour)} – ${clock((typ.hour + 1) % 24)}` : "—"} sub={typ ? `${typPct}% of all requests · server time` : "Needs a few days of data"} />
                    <Tile icon={BarChart3} tone="success" label="Busiest day" value={u.peak.day ? shortDay(u.peak.day.date) : "—"} sub={u.peak.day ? `${fmtInt(u.peak.day.n)} requests` : "No requests recorded yet"} />
                </div>
            </section>

            <div className="grid gap-4 xl:grid-cols-3">
                <ChartCard
                    icon={Activity}
                    tone="info"
                    title="Requests per hour · last 24 hours"
                    desc={hasData && peakH ? `Peak: ${hourRange(peakH.t)} with ${fmtInt(peakH.n)} requests` : "Each search and download counts as one request"}
                    className="xl:col-span-2">
                    <BarChart data={hourBars} height={190} color={CHART.info} peak labelEvery={3} unit=" requests" />
                    <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-base-content/60">
                        <span className="flex items-center gap-1.5">
                            <span className="size-2 rounded-sm" style={{ background: CHART.info }} /> requests
                        </span>
                        <span className="flex items-center gap-1.5">
                            <span className="size-2 rounded-sm" style={{ background: CHART.error }} /> hours that hit a rate limit
                        </span>
                        <span className="flex items-center gap-1.5">
                            <span className="size-2 rounded-sm" style={{ outline: `2px solid ${CHART.primary}` }} /> peak hour
                        </span>
                    </p>
                </ChartCard>

                <WorkerPanel ov={ov} onClearRejected={onClearRejected} />

                <ChartCard icon={Layers} tone="info" title="Request mix" desc="Searches vs downloads since recording began">
                    <DonutChart segments={mix} center={{ value: fmtInt(t.all), label: "requests" }} size={148} />
                </ChartCard>

                <ChartCard icon={Clock} tone="accent" title="When requests usually happen" desc={typ ? `Busiest around ${clock(typ.hour)} · server time` : "Hour of day, all days combined"}>
                    <BarChart data={profile} height={170} color={CHART.accent} peak={!!typ} labelEvery={4} unit=" requests" highlight={(d) => (typ ? d.hour === typ.hour || null : null)} />
                </ChartCard>

                <ChartCard icon={TrendingUp} tone="primary" title="Daily requests · last 14 days" desc={u.peak.day ? `Busiest day: ${shortDay(u.peak.day.date)} (${fmtInt(u.peak.day.n)})` : "Per day"}>
                    <AreaChart points={u.days.map((d) => ({ label: shortDay(d.date), value: d.n }))} color={CHART.primary} height={170} peak unit=" requests" />
                </ChartCard>
            </div>
        </div>
    );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TABS = [
    { v: "", label: "All" },
    { v: "good", label: "High quality" },
    { v: "fallback", label: "Nearest usable" },
    { v: "unvalidated", label: "Not checked" },
    { v: "upload", label: "Uploaded" },
];

export default function DashSubtitles() {
    const [quality, setQuality] = useState("");
    const [lang, setLang] = useState("");
    const [search, setSearch] = useState("");
    const [debounced, setDebounced] = useState("");
    const [sort, setSort] = useState("score"); // highest score first
    const [order, setOrder] = useState("desc");
    const [page, setPage] = useState(1);
    const limit = PAGE_SIZE;
    const [exporting, setExporting] = useState(false);
    const [previewRow, setPreviewRow] = useState(null);
    const [shiftRows, setShiftRows] = useState(null);
    const [confirm, setConfirm] = useState(null);
    const [busy, setBusy] = useState(false);
    const [toast, setToast] = useState(null);
    const [pollMs, setPollMs] = useState(2500);
    const toastTimer = useRef(null);

    useEffect(() => {
        const t = setTimeout(() => setDebounced(search.trim()), 300);
        return () => clearTimeout(t);
    }, [search]);

    // ── data ──
    const ovQ = useQuery({ queryKey: ["subtitle-admin", "overview"], queryFn: subtitleApi.overview, refetchInterval: pollMs, staleTime: 0 });
    const ov = ovQ.data;
    useEffect(() => {
        if (ov) setPollMs(ov.analysis?.complete ? 30000 : 2500); // fast while files are still being read
    }, [ov]);

    const params = { page, limit, sort, order, quality, lang, search: debounced };
    const listQ = useQuery({ queryKey: ["subtitle-admin", "list", params], queryFn: () => subtitleApi.list(params), placeholderData: (prev) => prev, refetchInterval: ov && !ov.analysis?.complete ? 3000 : 30000 });
    const list = listQ.data;
    const rows = list?.rows || [];
    useEffect(() => {
        if (list?.pages && page > list.pages) setPage(list.pages);
    }, [list?.pages, page]);
    const loading = listQ.isLoading;
    const missQ = useQuery({ queryKey: ["subtitle-admin", "missing-summary"], queryFn: () => subtitleApi.missing({ limit: 5 }), refetchInterval: 60000 });

    useEffect(() => setPage(1), [quality, lang, debounced, sort, order]);

    const flash = useCallback((msg, type = "success") => {
        setToast({ msg, type });
        clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), 4200);
    }, []);

    const refreshAll = useCallback(() => {
        ovQ.refetch();
        listQ.refetch();
        missQ.refetch();
    }, [ovQ, listQ, missQ]);

    // ── actions ──
    async function run(action, targets, actionParams) {
        setBusy(true);
        try {
            const res = await subtitleApi.action(action, targets.map((r) => ({ mediaId: r.mediaId, lang: r.lang })), actionParams);
            const firstMsg = res.results?.find((x) => x.message)?.message;
            if (res.failed && !res.ok) flash(`${res.failed} failed${firstMsg ? ` — ${firstMsg}` : ""}`, "error");
            else flash(`${res.ok} done${res.failed ? `, ${res.failed} failed` : ""}${targets.length === 1 && firstMsg ? ` — ${firstMsg}` : ""}`, res.failed ? "error" : "success");
            refreshAll();
            return res;
        } catch (e) {
            flash(e?.message || "Action failed", "error");
            return null;
        } finally {
            setBusy(false);
        }
    }

    // The table has no download button any more — the details dialog keeps one.
    async function download(r) {
        try {
            const blob = await subtitleApi.file(r.mediaId, r.lang);
            const url = URL.createObjectURL(blob instanceof Blob ? blob : new Blob([blob]));
            const a = document.createElement("a");
            a.href = url;
            a.download = `${r.title.replace(/[^\w.-]+/g, "_")}.${r.lang}${r.ext || ".srt"}`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1500);
        } catch (e) {
            flash(e?.message || "Download failed", "error");
        }
    }

    function confirmFor(action, targets) {
        const n = targets.length;
        const one = n === 1 ? targets[0] : null;
        const what = one ? `${one.title} · ${one.label}` : `${n} subtitles`;
        const size = fmtBytes(targets.reduce((a, r) => a + (r.sizeBytes || 0), 0));
        if (action === "delete")
            return {
                variant: "danger",
                title: one ? "Delete this subtitle?" : `Delete ${n} subtitles?`,
                subtitle: what,
                confirmText: "Delete",
                confirmIcon: Trash2,
                message: `The file${n > 1 ? "s are" : " is"} removed from disk (${size}). It will not be downloaded again automatically.`,
                note: "You can still re-download later with Re-download.",
                noteTone: "info",
            };
        return {
            variant: "warning",
            title: one ? "Re-download this subtitle?" : `Re-download ${n} subtitles?`,
            subtitle: what,
            confirmText: "Re-download",
            confirmIcon: RefreshCw,
            message: "The current file is moved to the rejected folder and a fresh candidate is downloaded and validated when the server is idle.",
            note: "Uploaded files without a library entry cannot be re-downloaded.",
            noteTone: "warning",
        };
    }

    function handleAction(r, key) {
        if (key === "preview") return setPreviewRow(r);
        if (key === "shift") return setShiftRows([r]);
        if (key === "delete" || key === "redownload") return setConfirm({ action: key, targets: [r], ...confirmFor(key, [r]) });
        return run(key, [r]);
    }

    // All rows for the current filters (the API pages at 100) — used by the export and the "check unchecked" button.
    async function fetchAllRows(extra = {}) {
        const out = [];
        // follow the server-reported last page (no fixed 50-page cut-off → a 5,001-row list is exported whole)
        for (let p = 1; p <= 2000; p++) {
            const d = await subtitleApi.list({ page: p, limit: 100, sort, order, quality, lang, search: debounced, ...extra });
            out.push(...d.rows);
            if (p >= d.pages) break;
        }
        return out;
    }

    async function exportCsv() {
        setExporting(true);
        try {
            const all = await fetchAllRows();
            const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
            const head = ["SL", "Title", "Language", "Format", "Quality", "Score", "Cues", "Cues per second", "Cues per minute", "Size (bytes)", "Added", "Source", "Release", "File"];
            const lines = all.map((r, i) => [i + 1, r.title, r.label, fmtExt(r.ext), (QUALITY[r.quality] || QUALITY.unvalidated).label, r.score ?? "", r.cues ?? "", r.cuePerSec ?? "", r.cuePerMin ?? "", r.sizeBytes ?? "", r.addedAt ?? "", r.source, r.releaseName, r.filename].map(cell).join(","));
            const blob = new Blob(["\uFEFF" + [head.map(cell).join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `flux-subtitles-${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1500);
            flash(`Exported ${all.length} subtitle${all.length === 1 ? "" : "s"}`);
        } catch (e) {
            flash(e?.message || "Export failed", "error");
        } finally {
            setExporting(false);
        }
    }

    // One click: judge every subtitle that has never been checked (they are validated when the server is idle).
    async function checkUnchecked() {
        setExporting(true);
        try {
            const all = await fetchAllRows({ quality: "unvalidated", lang: "", search: "" });
            if (!all.length) return flash("Everything has been checked already");
            // the server queues at most 200 per call — send batches; a failed batch stops here, finished batches stay done
            let okTotal = 0;
            let failedTotal = 0;
            for (let i = 0; i < all.length; i += 200) {
                const res = await run("revalidate", all.slice(i, i + 200));
                if (!res) {
                    flash(`Queued ${okTotal} of ${all.length} — the next batch failed`, "error");
                    return;
                }
                okTotal += res.ok || 0;
                failedTotal += res.failed || 0;
            }
            flash(`Queued ${okTotal} of ${all.length}${failedTotal ? `, ${failedTotal} failed` : ""}`, failedTotal ? "error" : "success");
        } catch (e) {
            flash(e?.message || "Couldn’t queue the check", "error");
        } finally {
            setExporting(false);
        }
    }

    async function executeConfirm() {
        if (!confirm) return;
        if (confirm.action === "purge") {
            setBusy(true);
            try {
                const r = await subtitleApi.purgeRejected();
                flash(`Freed ${fmtBytes(r.freedBytes)} (${r.files} files)`);
                refreshAll();
            } catch (e) {
                flash(e?.message || "Couldn’t clear rejected files", "error");
            } finally {
                setBusy(false);
                setConfirm(null);
            }
            return;
        }
        await run(confirm.action, confirm.targets);
        setConfirm(null);
    }

    function clearRejected() {
        setConfirm({
            action: "purge",
            targets: [],
            variant: "warning",
            title: "Clear rejected files?",
            subtitle: ov ? `${ov.storage.rejectedFiles} files · ${fmtBytes(ov.storage.rejectedBytes)}` : undefined,
            confirmText: "Clear rejected",
            confirmIcon: Archive,
            message: "Subtitles that failed validation or were replaced are kept here as a safety net. Clearing them frees the space for good.",
            note: "Active subtitles are not touched.",
            noteTone: "success",
        });
    }

    async function applyShift(seconds) {
        const res = await run("shift", shiftRows, { seconds });
        if (res) setShiftRows(null);
    }

    const onSort = (id) => {
        if (id === sort) setOrder((o) => (o === "asc" ? "desc" : "asc"));
        else {
            setSort(id);
            setOrder(id === "title" || id === "lang" ? "asc" : "desc");
        }
    };

    const hasFilter = !!(quality || lang || debounced);
    const clearFilters = () => {
        setQuality("");
        setLang("");
        setSearch("");
    };
    const tabCount = (v) => (!ov ? 0 : v === "" ? ov.totals.files : ov.quality[v] || 0);
    const offset = list ? (list.page - 1) * list.limit : 0;

    return (
        <div className="max-w-full space-y-5 bg-base-100 text-sm leading-normal text-base-content">
            <Hero ov={ov} fetching={ovQ.isFetching} onRefresh={refreshAll} />

            {(ovQ.isError || listQ.isError) && (
                <div className="flex items-center gap-2 rounded-xl border border-error/20 bg-error/10 px-4 py-3 text-xs font-medium text-error">
                    <AlertTriangle size={14} />
                    <span className="flex-1">{ovQ.error?.message || listQ.error?.message || "Couldn’t load subtitles"}</span>
                    <button onClick={refreshAll} className="cursor-pointer border-none bg-transparent font-semibold text-error/80 hover:text-error">
                        Retry
                    </button>
                </div>
            )}

            <KpiRow ov={ov} />

            {ov && !ov.analysis.complete && (
                <div className="flex items-center gap-3 rounded-xl border border-info/30 bg-info/10 px-4 py-3 text-xs text-base-content/85">
                    <Loader2 size={14} className="shrink-0 animate-spin text-info" />
                    <span className="flex-1">
                        Reading subtitle files for cue counts… {ov.analysis.done} of {ov.analysis.total}
                    </span>
                    <Bar value={(ov.analysis.done / Math.max(1, ov.analysis.total)) * 100} className="w-32" tone="bg-info" />
                </div>
            )}

            {/* ── Subtitles table ── */}
            <section className={`${CARD} overflow-hidden`}>
                <CardHeader
                    icon={Languages}
                    tone="primary"
                    title="Stored subtitles"
                    desc="Highest score first · click a title for every detail"
                    right={
                        <>
                            {ov && ov.quality.unvalidated > 0 && (
                                <button onClick={checkUnchecked} disabled={exporting || busy} className={BTN} title="Judge every subtitle that has not been checked yet">
                                    <ShieldCheck size={14} /> Check unchecked · {ov.quality.unvalidated}
                                </button>
                            )}
                            <button onClick={exportCsv} disabled={exporting || !list?.total} className={BTN} title="Download this list (current filters) as a CSV file">
                                {exporting ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />} Export CSV
                            </button>
                        </>
                    }
                />
                <div className="flex flex-wrap items-center gap-3 border-b border-base-300 px-5 py-3">
                    <div className="flex flex-wrap items-center gap-1 rounded-xl border border-base-300 bg-base-100 p-1">
                        {TABS.map((t) => {
                            const active = quality === t.v;
                            const count = tabCount(t.v);
                            return (
                                <button
                                    key={t.v || "all"}
                                    onClick={() => setQuality(t.v)}
                                    className={`flex h-8 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border-none px-3 text-sm font-medium transition-colors ${active ? "bg-primary text-primary-content shadow-sm" : "bg-transparent text-base-content hover:bg-base-300"}`}>
                                    {t.label}
                                    {count > 0 && <span className={`text-xs font-normal tabular-nums ${active ? "text-primary-content/90" : "text-base-content/60"}`}>{count}</span>}
                                </button>
                            );
                        })}
                    </div>

                    <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
                        <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language" className="h-9 shrink-0 cursor-pointer rounded-lg border border-base-300 bg-base-100 px-2.5 text-sm text-base-content focus:border-primary focus:outline-none">
                            <option value="">All languages</option>
                            {(ov?.languages || []).map((l) => (
                                <option key={l.lang} value={l.lang}>
                                    {l.label} ({l.files})
                                </option>
                            ))}
                        </select>
                        <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-base-300 bg-base-100 px-3 transition-colors focus-within:border-primary sm:w-60 sm:flex-none">
                            <Search size={14} className="shrink-0 text-base-content/60" />
                            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title or file" className="min-w-0 flex-1 bg-transparent text-base text-base-content placeholder:text-base-content/55 focus:outline-none sm:text-sm" />
                            {search && (
                                <button onClick={() => setSearch("")} aria-label="Clear search" className="cursor-pointer border-none bg-transparent text-base-content/60 transition-colors hover:text-base-content">
                                    <X size={14} />
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {loading ? (
                    <TableSkeleton />
                ) : rows.length === 0 ? (
                    <EmptyState title={hasFilter ? "No subtitles match your filters" : "No subtitles stored yet"} text={hasFilter ? "Try another search or clear the filters." : "The background worker downloads them while the server is idle."} onClear={hasFilter ? clearFilters : undefined} />
                ) : (
                    <SubtitleTable rows={rows} offset={offset} sort={sort} order={order} onSort={onSort} onAction={handleAction} />
                )}

                {!loading && list && list.total > 0 && <Pagination page={list.page} pages={list.pages} total={list.total} limit={list.limit} onPage={setPage} />}
            </section>

            {/* ── Titles without a subtitle ── */}
            <MissingSection flash={flash} onQueued={() => { ovQ.refetch(); missQ.refetch(); }} />

            {/* ── Charts ── */}
            <div>
                <div className="mb-3 flex items-center gap-3">
                    <IconTile icon={BarChart3} tone="accent" size={32} />
                    <div>
                        <h2 className="text-base font-semibold leading-tight">Insights</h2>
                        <p className="text-xs text-base-content/65">Quality, coverage, storage and growth at a glance</p>
                    </div>
                </div>
                <Charts ov={ov} missing={missQ.data} />
            </div>

            {/* ── API requests + worker (bottom) ── */}
            <div>
                <div className="mb-3 flex items-center gap-3">
                    <IconTile icon={Zap} tone="info" size={32} />
                    <div>
                        <h2 className="text-base font-semibold leading-tight">API requests & worker</h2>
                        <p className="text-xs text-base-content/65">How much the background worker asks SubSource, and when</p>
                    </div>
                </div>
                <ApiSection ov={ov} onClearRejected={clearRejected} />
            </div>

            <p className="flex items-center gap-2 pb-2 text-xs text-base-content/60">
                <HardDrive size={12} className="shrink-0" />
                Cue/s = cues divided by the time between the first and last cue. Re-validate and Re-download run in the background when the server is idle.
            </p>

            {/* ── Modals ── */}
            {previewRow && <SubtitlePreviewModal row={previewRow} onClose={() => setPreviewRow(null)} onDownload={download} />}
            {shiftRows && <SubtitleShiftModal rows={shiftRows} onClose={() => !busy && setShiftRows(null)} onApply={applyShift} busy={busy} />}
            <ConfirmModal
                modal={DASH_MODALS.subtitleConfirm}
                open={!!confirm}
                onClose={() => !busy && setConfirm(null)}
                onConfirm={executeConfirm}
                title={confirm?.title}
                subtitle={confirm?.subtitle}
                confirmIcon={confirm?.confirmIcon}
                message={confirm?.message}
                note={confirm?.note}
                noteTone={confirm?.noteTone}
                variant={confirm?.variant || "danger"}
                confirmText={confirm?.confirmText}
                loading={busy}
            />
            <Toast toast={toast} />
        </div>
    );
}
