// web/src/Dashboard/Pages/DashOverview.jsx
// Admin landing page. Existing endpoints (stats, activity, libraries, logs) plus two read-only
// analytics endpoints. Every panel has an empty state, so a missing data source never breaks the page.
//
// Optional prop: onNavigate(page) — if DashboardLayout passes it, "Review / Open" buttons appear.
// Pages used: "users" | "libraries" | "storage" | "logs" | "media" | "streams".

import { useEffect, useMemo, useRef, useState } from "react";
import {
    Users,
    Radio,
    Film,
    Activity,
    Clock,
    RefreshCw,
    Server,
    Folder,
    Database,
    HardDrive,
    Cpu,
    CheckCircle,
    AlertTriangle,
    Play,
    Shield,
    Bell,
    Eye,
    Check,
    X,
    Info,
    Square,
    TrendingUp,
    TrendingDown,
    Layers,
    Tv,
    Flame,
    Trophy,
    Sparkles,
    Stethoscope,
    Calendar,
    Lock,
} from "lucide-react";
import { useAuth } from "../Shared";
import { useDashboardStats, useDashboardActivity, useDashboardLibraries, useDashboardLogs, useUpdateDashboardUser, useStopDashboardStream } from "../Hooks/useDashboard";
import { useOverviewAnalytics, useOverviewLive } from "../Hooks/useOverviewAnalytics";

// ─── Tailwind class maps (full strings so the compiler can see them) ──────────

const TEXT = { error: "text-error", warning: "text-warning", success: "text-success", info: "text-info", neutral: "text-base-content/70" };
const BADGE = {
    error: "badge-error",
    warning: "badge-warning",
    success: "badge-success",
    info: "badge-info",
    neutral: "bg-base-300 text-base-content",
    primary: "badge-primary",
    accent: "badge-accent",
};
const FILL = { error: "bg-error", warning: "bg-warning", success: "bg-success", info: "bg-info", primary: "bg-primary", secondary: "bg-secondary", accent: "bg-accent" };

// ─── Formatters ───────────────────────────────────────────────────────────────

const DAY = 86400000;

function fmtUptime(sec) {
    if (!sec) return "—";
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

function fmtRel(iso) {
    if (!iso) return "—";
    const diff = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(diff)) return "—";
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < DAY) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / DAY)}d ago`;
}

function fmtIn(iso) {
    const diff = new Date(iso).getTime() - Date.now();
    if (!Number.isFinite(diff)) return "—";
    if (diff < 3_600_000) return "within the hour";
    if (diff < DAY) return `in ${Math.floor(diff / 3_600_000)}h`;
    return `in ${Math.ceil(diff / DAY)}d`;
}

function fmtBytes(n) {
    if (!n || n <= 0) return "0 B";
    const u = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < u.length - 1) {
        v /= 1024;
        i++;
    }
    return `${i >= 4 ? v.toFixed(2) : v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

// hours (number) → "42m" / "3.5 h" / "120 h"
function fmtHours(h) {
    if (!h) return "0 h";
    if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
    return `${h >= 100 ? Math.round(h) : Math.round(h * 10) / 10} h`;
}

// seconds → "12d 5h" / "7h 20m" / "35m"
function fmtRuntime(sec) {
    if (!sec || sec < 60) return "0m";
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d >= 2) return `${d}d ${h}h`;
    if (sec >= 3600) return `${Math.floor(sec / 3600)}h ${m}m`;
    return `${m}m`;
}

function cleanTitle(name = "") {
    return String(name)
        .replace(/\.(mkv|mp4|avi|mov|wmv|webm|ts|m2ts)$/i, "")
        .replace(/[._]+/g, " ")
        .trim();
}

const pct = (v, total) => (total > 0 ? Math.round((v / total) * 100) : 0);
const ordinalDay = (iso) => new Date(`${iso}T12:00:00`);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function tickLabel(iso, n) {
    const d = ordinalDay(iso);
    return n <= 7 ? d.toLocaleDateString(undefined, { weekday: "short" }) : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

// ─── Small building blocks ────────────────────────────────────────────────────

function Panel({ title, icon: Icon, right, children, className = "" }) {
    return (
        <section className={`flex min-w-0 flex-col overflow-hidden rounded-lg border border-base-300 bg-base-200 ${className}`}>
            <header className="flex min-h-[2.75rem] items-center justify-between gap-2 border-b border-base-300 px-4 py-2.5">
                <h3 className="flex items-center gap-2 text-sm font-medium text-base-content/90">
                    {Icon && <Icon size={14} className="shrink-0" />}
                    {title}
                </h3>
                <div className="flex items-center gap-2">{right}</div>
            </header>
            <div className="flex flex-1 flex-col">{children}</div>
        </section>
    );
}

function SectionLabel({ children }) {
    return (
        <div className="flex items-center gap-3 pt-2 text-sm font-semibold text-base-content/90">
            {children}
            <span className="h-px flex-1 bg-base-300" />
        </div>
    );
}

function Badge({ tone = "neutral", children, className = "" }) {
    return <span className={`badge badge-soft badge-sm gap-1 whitespace-nowrap rounded-md border-none ${BADGE[tone]} ${className}`}>{children}</span>;
}

function Dot({ className = "" }) {
    return <span className={`inline-block size-2 shrink-0 rounded-full bg-success ${className}`} />;
}

function Avatar({ name = "?", online = false }) {
    return (
        <div className="relative shrink-0">
            <div className="flex size-8 items-center justify-center rounded-full bg-base-300 text-xs font-semibold text-base-content">{(name || "?")[0].toUpperCase()}</div>
            {online && <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-base-200 bg-success" />}
        </div>
    );
}

function Bar({ value, tone = "primary", className = "" }) {
    return (
        <div className={`h-1.5 overflow-hidden rounded-full bg-base-300 ${className}`}>
            <div className={`h-full rounded-full ${FILL[tone]}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
        </div>
    );
}

function Seg({ value, onChange, options }) {
    return (
        <div className="inline-flex gap-0.5 rounded-md bg-base-300 p-0.5">
            {options.map((o) => (
                <button
                    key={o.value}
                    type="button"
                    onClick={() => onChange(o.value)}
                    className={`h-6 rounded px-2.5 text-xs font-medium transition-colors ${value === o.value ? "bg-base-100 text-base-content" : "text-base-content/70 hover:text-base-content"}`}>
                    {o.label}
                </button>
            ))}
        </div>
    );
}

function Empty({ icon: Icon = Info, text }) {
    return (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-8 text-center">
            <Icon size={18} className="text-base-content/60" />
            <p className="max-w-xs text-sm text-base-content/75">{text}</p>
        </div>
    );
}

function Note({ children }) {
    return (
        <div className="mt-auto flex items-start gap-2 border-t border-base-300 bg-base-300 px-4 py-2.5 text-xs text-base-content/80">
            <Info size={13} className="mt-0.5 shrink-0" />
            <span>{children}</span>
        </div>
    );
}

function Kpis({ items, cols = "lg:grid-cols-4", first = false, grow = false }) {
    const odd = items.length % 2 === 1;
    return (
        <div className={`grid grid-cols-2 gap-px bg-base-300 ${cols} ${first ? "" : "border-t border-base-300"} ${grow ? "flex-1" : ""}`}>
            {items.map((k, i) => (
                <div key={k.label} className={`min-w-0 bg-base-200 px-4 py-3 ${odd && i === items.length - 1 ? "col-span-2 lg:col-span-1" : ""}`}>
                    <p className="text-xs text-base-content/75">{k.label}</p>
                    <p className={`mt-0.5 flex items-center gap-2 text-lg font-semibold leading-tight tabular-nums ${k.tone ? TEXT[k.tone] : ""}`}>
                        {k.dot && <Dot />}
                        {k.value}
                    </p>
                    {k.sub && <p className="truncate text-xs text-base-content/65">{k.sub}</p>}
                </div>
            ))}
        </div>
    );
}

function Skel({ className = "" }) {
    return <div className={`skeleton rounded-lg ${className}`} />;
}

// ─── Charts (SVG, DaisyUI tokens only) ────────────────────────────────────────

// Measures a container so SVG text stays at its real pixel size instead of scaling with the panel.
function useElementWidth(fallback) {
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

function TrendChart({ dates, values, prev, hover, onHover }) {
    const [boxRef, W] = useElementWidth(640);
    const H = 180;
    const L = 36;
    const R = 8;
    const T = 10;
    const B = 22;
    const n = values.length;
    if (n < 2) return null;
    const top = niceTop(Math.max(...values, ...prev));
    const x = (i) => L + ((W - L - R) * i) / (n - 1);
    const y = (v) => T + (H - T - B) * (1 - v / top);
    const line = (arr) => arr.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
    const step = n > 12 ? Math.ceil(n / 6) : 1;

    const move = (e) => {
        const b = e.currentTarget.getBoundingClientRect();
        const px = ((e.clientX - b.left) / b.width) * W;
        onHover(Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1)))));
    };

    return (
        <div ref={boxRef} className="w-full">
            <svg
                viewBox={`0 0 ${W} ${H}`}
                width={W}
                height={H}
                className="block"
                role="img"
                aria-label="Watch time trend compared with the previous period"
                onMouseMove={move}
                onMouseLeave={() => onHover(null)}>
                {[0, 1, 2, 3, 4].map((g) => {
                    const v = (top * g) / 4;
                    return (
                        <g key={g}>
                            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="stroke-base-300" />
                            <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="12" className="fill-base-content" fillOpacity="0.7">
                                {Number(v.toFixed(1))}
                            </text>
                        </g>
                    );
                })}
                {dates.map((d, i) =>
                    i % step === 0 ? (
                        <text key={d} x={x(i)} y={H - 6} textAnchor="middle" fontSize="12" className="fill-base-content" fillOpacity="0.7">
                            {tickLabel(d, n)}
                        </text>
                    ) : null,
                )}
                <path d={line(prev)} fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 4" className="text-base-content" strokeOpacity="0.5" />
                <path d={`${line(values)} L${x(n - 1)} ${y(0)} L${x(0)} ${y(0)} Z`} className="fill-primary" fillOpacity="0.12" />
                <path d={line(values)} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" className="text-primary" />
                {hover != null && (
                    <g>
                        <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="stroke-base-content" strokeOpacity="0.4" />
                        <circle cx={x(hover)} cy={y(values[hover])} r="4" className="fill-primary stroke-base-200" strokeWidth="2" />
                    </g>
                )}
            </svg>
        </div>
    );
}

const pad2 = (n) => String(n).padStart(2, "0");

function TrafficClock({ hours }) {
    const [hv, setHv] = useState(null);
    const max = Math.max(...hours);
    if (!max) return <Empty icon={Clock} text="No watch time recorded yet, so there is no hourly pattern to show." />;

    const peak = hours.indexOf(max);
    const low = hours.indexOf(Math.min(...hours));
    const cx = 130;
    const cy = 108;
    const r0 = 34;
    const ML = 52;
    const pt = (a, r) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const shown = hv ?? peak;

    return (
        <div className="flex flex-1 flex-col px-4 pb-3 pt-3">
            <div className="flex flex-1 items-center justify-center">
                <svg viewBox="0 0 260 216" className="w-full max-w-[290px]" role="img" aria-label="Radial 24-hour traffic clock, hour 0 at the top" onMouseLeave={() => setHv(null)}>
                    <circle cx={cx} cy={cy} r={r0 - 6} fill="none" className="stroke-base-300" />
                    <circle cx={cx} cy={cy} r={r0 + ML + 4} fill="none" className="stroke-base-300" strokeDasharray="2 4" />
                    {hours.map((v, h) => {
                        const a = (h / 24) * 2 * Math.PI - Math.PI / 2;
                        const len = 3 + (v / max) * ML;
                        const [x1, y1] = pt(a, r0);
                        const [x2, y2] = pt(a, r0 + len);
                        return (
                            <g key={h}>
                                <line
                                    x1={x1}
                                    y1={y1}
                                    x2={x2}
                                    y2={y2}
                                    strokeWidth="7"
                                    strokeLinecap="round"
                                    stroke="currentColor"
                                    className="cursor-pointer text-primary"
                                    strokeOpacity={h === peak ? 1 : 0.2 + 0.6 * (v / max)}
                                    onMouseEnter={() => setHv(h)}
                                />
                                {h === low && <circle cx={x2} cy={y2} r="6" fill="none" stroke="currentColor" strokeDasharray="2 2" className="text-base-content" strokeOpacity="0.7" />}
                            </g>
                        );
                    })}
                    {[0, 6, 12, 18].map((h) => {
                        const [tx, ty] = pt((h / 24) * 2 * Math.PI - Math.PI / 2, r0 + ML + 16);
                        return (
                            <text key={h} x={tx} y={ty + 4} textAnchor="middle" fontSize="12" className="fill-base-content" fillOpacity="0.7">
                                {h}h
                            </text>
                        );
                    })}
                    <text x={cx} y={cy + 2} textAnchor="middle" fontSize="15" fontWeight="600" className="fill-base-content">
                        {pad2(shown)}:00
                    </text>
                    <text x={cx} y={cy + 17} textAnchor="middle" fontSize="12" className="fill-base-content" fillOpacity="0.7">
                        {fmtHours(hours[shown])}
                    </text>
                </svg>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-md bg-base-300">
                <div className="bg-base-200 px-3 py-2">
                    <p className="text-xs text-base-content/65">Busiest hour</p>
                    <p className="text-sm font-semibold tabular-nums text-primary">
                        {pad2(peak)}:00 · {fmtHours(max)}
                    </p>
                </div>
                <div className="bg-base-200 px-3 py-2">
                    <p className="text-xs text-base-content/65">Quietest hour</p>
                    <p className="text-sm font-semibold tabular-nums">
                        {pad2(low)}:00 · {fmtHours(hours[low])}
                    </p>
                </div>
            </div>
        </div>
    );
}

function ActivityCalendar({ days }) {
    const max = Math.max(...days.map((d) => d.hours), 0);
    if (!max) return <Empty icon={Calendar} text="Daily activity appears here once people start watching." />;

    const C = 11; // cell size in px, same as a GitHub contribution graph
    const G = 3;
    const P = C + G;
    const LABEL = 34;
    const TOP = 16;
    const first = ordinalDay(days[0].date);
    const offset = (first.getDay() + 6) % 7; // Monday = row 0
    const cols = Math.ceil((days.length + offset) / 7);
    const W = LABEL + cols * P - G;
    const H = TOP + 7 * P - G;
    const level = (h) => (h <= 0 ? 0 : Math.min(4, Math.ceil((h / max) * 4)));
    const opacity = [0, 0.25, 0.5, 0.75, 1];

    const months = [];
    let lastMonth = -1;
    for (let c = 0; c < cols; c++) {
        const d = days[Math.max(0, c * 7 - offset)];
        if (!d) continue;
        const m = ordinalDay(d.date).getMonth();
        if (m !== lastMonth) {
            if (c < cols - 1 || months.length === 0) months.push({ c, label: ordinalDay(d.date).toLocaleDateString(undefined, { month: "short" }) });
            lastMonth = m;
        }
    }

    const activeDays = days.filter((d) => d.hours > 0).length;
    let streak = 0;
    let best = 0;
    days.forEach((d) => {
        streak = d.hours > 0 ? streak + 1 : 0;
        best = Math.max(best, streak);
    });
    const topDay = days.reduce((a, d) => (d.hours > a.hours ? d : a), days[0]);

    return (
        <div className="flex flex-1 flex-col">
            <div className="overflow-x-auto px-4 pb-1 pt-4">
                <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="mx-auto block max-w-none" role="img" aria-label="Daily watch activity for the last 26 weeks">
                    {months.map((m) => (
                        <text key={m.c} x={LABEL + m.c * P} y={10} fontSize="12" className="fill-base-content" fillOpacity="0.7">
                            {m.label}
                        </text>
                    ))}
                    {[
                        [0, "Mon"],
                        [2, "Wed"],
                        [4, "Fri"],
                    ].map(([row, label]) => (
                        <text key={label} x={0} y={TOP + row * P + C - 1} fontSize="12" className="fill-base-content" fillOpacity="0.7">
                            {label}
                        </text>
                    ))}
                    {days.map((d, i) => {
                        const idx = i + offset;
                        const lv = level(d.hours);
                        return (
                            <rect
                                key={d.date}
                                x={LABEL + Math.floor(idx / 7) * P}
                                y={TOP + (idx % 7) * P}
                                width={C}
                                height={C}
                                rx="2"
                                className={lv ? "fill-primary" : "fill-base-300"}
                                fillOpacity={lv ? opacity[lv] : 1}>
                                <title>{`${d.date}: ${fmtHours(d.hours)}, ${d.users} active ${d.users === 1 ? "user" : "users"}`}</title>
                            </rect>
                        );
                    })}
                </svg>
            </div>
            <div className="flex items-center justify-end gap-1.5 px-4 pb-3 text-xs text-base-content/70">
                Less
                {[0, 1, 2, 3, 4].map((l) => (
                    <svg key={l} width={C} height={C} viewBox={`0 0 ${C} ${C}`}>
                        <rect width={C} height={C} rx="2" className={l ? "fill-primary" : "fill-base-300"} fillOpacity={l ? opacity[l] : 1} />
                    </svg>
                ))}
                More
            </div>
            <Kpis
                grow
                cols="lg:grid-cols-3"
                items={[
                    { label: "Active days", value: activeDays, sub: `of the last ${days.length}` },
                    { label: "Longest streak", value: `${best} ${best === 1 ? "day" : "days"}`, sub: "in a row with activity" },
                    { label: "Best day", value: fmtHours(topDay.hours), sub: ordinalDay(topDay.date).toLocaleDateString(undefined, { day: "numeric", month: "short" }) },
                ]}
            />
        </div>
    );
}

function ForecastChart({ disk }) {
    const [boxRef, W] = useElementWidth(420);
    const hist = disk.history || [];
    if (disk.daysToFull == null || hist.length < 3) {
        return (
            <div ref={boxRef}>
                <p className="px-4 pb-3 text-xs text-base-content/75">
                    {hist.length < 3 ? `Collecting disk history for the forecast (${hist.length} of 3 days so far).` : "Disk usage is flat or shrinking, so no fill-up date is forecast."}
                </p>
            </div>
        );
    }
    const H = 120;
    const L = 34;
    const R = 8;
    const T = 8;
    const B = 20;
    const t0 = ordinalDay(hist[0].d).getTime();
    const tEnd = ordinalDay(disk.fullDate).getTime();
    const tNow = ordinalDay(hist[hist.length - 1].d).getTime();
    const minUsed = Math.min(...hist.map((p) => p.used)) * 0.95;
    const SW = Math.max(120, W - 32);
    const x = (t) => L + ((SW - L - R) * (t - t0)) / Math.max(1, tEnd - t0);
    const y = (v) => T + (H - T - B) * (1 - (v - minUsed) / Math.max(1, disk.sizeBytes - minUsed));
    const path = hist.map((p, i) => `${i ? "L" : "M"}${x(ordinalDay(p.d).getTime()).toFixed(1)} ${y(p.used).toFixed(1)}`).join(" ");
    const last = hist[hist.length - 1];
    const label = (t) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });

    return (
        <div ref={boxRef} className="px-4 pb-3">
            <svg viewBox={`0 0 ${SW} ${H}`} width={SW} height={H} className="block" role="img" aria-label="Disk usage history with projection to full">
                <line x1={L} x2={SW - R} y1={y(disk.sizeBytes)} y2={y(disk.sizeBytes)} stroke="currentColor" strokeDasharray="3 3" className="text-error" />
                <text x={L + 4} y={y(disk.sizeBytes) + 13} fontSize="12" className="fill-error">
                    {fmtBytes(disk.sizeBytes)} capacity
                </text>
                <path d={path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" className="text-primary" />
                <line
                    x1={x(tNow)}
                    y1={y(last.used)}
                    x2={x(tEnd)}
                    y2={y(disk.sizeBytes)}
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeDasharray="4 4"
                    className="text-base-content"
                    strokeOpacity="0.6"
                />
                <circle cx={x(tNow)} cy={y(last.used)} r="4" className="fill-primary stroke-base-200" strokeWidth="2" />
                {[
                    [t0, "start"],
                    [tNow, "middle"],
                    [tEnd, "end"],
                ].map(([t, anchor]) => (
                    <text key={t} x={anchor === "end" ? SW - R : x(t)} y={H - 5} textAnchor={anchor} fontSize="12" className="fill-base-content" fillOpacity="0.7">
                        {anchor === "middle" ? "Today" : label(t)}
                    </text>
                ))}
            </svg>
        </div>
    );
}

// One table for both "Media by resolution" and "File formats", so type sizes, columns and spacing always match.
// It renders whatever rows the server sends, so new resolutions, formats and codecs show up with no UI change.
const pctNZ = (v, t) => (v > 0 ? Math.max(1, pct(v, t)) : 0);

function BreakdownTable({ firstHead, rows, total, tone, partsLabel }) {
    const cols = "grid-cols-[5rem_minmax(0,1fr)_5.5rem_5rem]";
    return (
        <>
            <div className={`grid ${cols} items-center gap-3 border-b border-base-300 px-4 py-2 text-xs text-base-content/65`}>
                <span>{firstHead}</span>
                <span className="text-right">Files</span>
                <span className="text-right">Runtime</span>
                <span className="text-right">Size</span>
            </div>
            <ul className="flex flex-1 flex-col divide-y divide-base-300">
                {rows.map((r) => (
                    <li key={r.name} className="flex flex-1 flex-col justify-center gap-1.5 px-4 py-3">
                        <div className={`grid ${cols} items-center gap-3 text-sm`}>
                            <span className="truncate font-semibold" title={r.name}>
                                {r.name}
                            </span>
                            <span className="text-right tabular-nums">{r.count.toLocaleString()}</span>
                            <span className="text-right tabular-nums">{fmtRuntime(r.seconds)}</span>
                            <span className="text-right tabular-nums">{fmtBytes(r.bytes)}</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <Bar value={pct(r.count, total)} tone={tone} className="flex-1" />
                            <span className="w-10 text-right text-xs tabular-nums text-base-content/75">{pctNZ(r.count, total)}%</span>
                        </div>
                        {r.parts?.length > 0 && (
                            <p className="truncate text-xs text-base-content/75">
                                {partsLabel}: {r.parts.map((x) => `${x.name} ${pctNZ(x.count, r.count)}%`).join(" · ")}
                            </p>
                        )}
                    </li>
                ))}
            </ul>
        </>
    );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const RANGES = [
    { value: "7d", label: "7 days" },
    { value: "30d", label: "30 days" },
    { value: "90d", label: "90 days" },
];

const STATUS_TONE = { approved: "success", pending: "warning", rejected: "error", suspended: "error", blocked: "error" };

const DECISION_LABEL = { full_transcode: "Full transcode", direct_stream: "Direct stream", audio_transcode: "Audio transcode", direct_play: "Direct play" };

const AUDIT_LABEL = {
    account_deleted: "Account deleted",
    account_recovered: "Account recovered",
    account_purged: "Account permanently removed",
    account_purge_failed: "Account removal failed",
    role_changed: "Role changed",
    status_changed: "Status changed",
};

export default function DashOverview({ onNavigate } = {}) {
    const auth = useAuth();
    const statsQuery = useDashboardStats();
    const activityQuery = useDashboardActivity();
    const libsQuery = useDashboardLibraries();
    const analyticsQuery = useOverviewAnalytics();
    const liveQuery = useOverviewLive();
    const logsQuery = useDashboardLogs({ level: "error", limit: 50 });
    const updateUser = useUpdateDashboardUser();
    const stopStream = useStopDashboardStream();

    const [range, setRange] = useState("7d");
    const [hover, setHover] = useState(null);
    const [mediaTab, setMediaTab] = useState("most");
    const [alertFilter, setAlertFilter] = useState("all");
    const [feedFilter, setFeedFilter] = useState("all");
    const [handled, setHandled] = useState(() => new Set());

    const stats = statsQuery.data ?? null;
    const activity = activityQuery.data ?? null;
    const libraries = libsQuery.data?.libraries ?? [];
    const an = analyticsQuery.data ?? null;
    const live = liveQuery.data ?? null;
    const sys = stats?.system ?? {};
    const users = stats?.users ?? {};

    const me = auth?.user ?? auth?.currentUser ?? null;
    const firstName = (me?.name || me?.username || "").split(" ")[0] || "Admin";
    const hour = new Date().getHours();
    const greeting = hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

    const onlineSet = useMemo(() => new Set(live?.onlineUserIds ?? []), [live]);
    const onlineCount = live ? live.onlineUserIds.length : (stats?.sessions?.active ?? 0);

    const errors24h = useMemo(() => {
        const rows = logsQuery.data?.logs ?? [];
        return rows.filter((l) => Date.now() - new Date(l.ts).getTime() < DAY);
    }, [logsQuery.data]);

    const disks = an?.storage?.disks ?? [];
    const primaryDisk = disks[0] ?? null;
    const watch = an?.watch ?? null;
    const trend = watch?.trend?.[range] ?? null;
    const trendSum = trend ? trend.values.reduce((a, b) => a + b, 0) : 0;
    const trendPrevSum = trend ? trend.prev.reduce((a, b) => a + b, 0) : 0;
    const delta = trendPrevSum > 0 ? Math.round(((trendSum - trendPrevSum) / trendPrevSum) * 100) : null;
    const todayHours = watch?.trend?.["7d"]?.values?.slice(-1)[0] ?? 0;
    const eng = watch?.engagement ?? null;
    const go = (page) => (onNavigate ? () => onNavigate(page) : null);

    // ── attention queue ───────────────────────────────────────────────────────
    const attention = useMemo(() => {
        const a = [];
        libraries
            .filter((l) => l.status === "offline")
            .forEach((l) =>
                a.push({
                    id: `lib-${l.id ?? l.path}`,
                    tone: "error",
                    icon: Folder,
                    title: `Library "${l.label || l.path}" is offline`,
                    detail: `${l.path} cannot be reached, its files are hidden from users`,
                    page: "libraries",
                    action: "Check",
                }),
            );
        disks.forEach((d) => {
            const soon = d.daysToFull != null && d.daysToFull <= 30;
            if (d.usedPct >= 90)
                a.push({
                    id: `disk-${d.mount}`,
                    tone: "error",
                    icon: Database,
                    title: `Disk ${d.mount} is ${d.usedPct}% full`,
                    detail: `${fmtBytes(d.freeBytes)} free${soon ? ` · full in about ${d.daysToFull} days` : ""}`,
                    page: "storage",
                    action: "Manage",
                });
            else if (d.usedPct >= 80 || (soon && d.daysToFull <= 14))
                a.push({
                    id: `disk-${d.mount}`,
                    tone: "warning",
                    icon: Database,
                    title: soon ? `Disk ${d.mount} full in about ${d.daysToFull} days` : `Disk ${d.mount} is ${d.usedPct}% full`,
                    detail: `${fmtBytes(d.freeBytes)} free${d.growthPerDay ? ` · growing ${fmtBytes(d.growthPerDay)}/day` : ""}`,
                    page: "storage",
                    action: "Manage",
                });
        });
        if (errors24h.length > 0)
            a.push({
                id: "errors",
                tone: "warning",
                icon: AlertTriangle,
                title: `${errors24h.length} server ${errors24h.length === 1 ? "error" : "errors"} in the last 24h`,
                detail: String(errors24h[0].message || "").slice(0, 110),
                page: "logs",
                action: "View logs",
            });
        const pendingCount = users.pending ?? 0;
        if (pendingCount > 0) {
            const oldest = an?.accounts?.pending?.[0]?.createdAt;
            a.push({
                id: "pending",
                tone: "warning",
                icon: Users,
                title: `${pendingCount} ${pendingCount === 1 ? "user is" : "users are"} awaiting approval`,
                detail: oldest ? `Oldest request ${fmtRel(oldest)}` : "Approve or reject below",
                page: "users",
                action: "Review",
            });
        }
        const exp = an?.accounts?.expiring ?? [];
        if (exp.length > 0)
            a.push({
                id: "expiring",
                tone: "warning",
                icon: Clock,
                title: `${exp.length} access ${exp.length === 1 ? "pass expires" : "passes expire"} within 7 days`,
                detail: exp.map((e) => `${e.name || e.email} (${fmtIn(e.accessExpiresAt)})`).join(" · "),
                page: "users",
                action: "Manage",
            });
        if ((an?.accounts?.expiredAccess ?? 0) > 0)
            a.push({
                id: "expired",
                tone: "warning",
                icon: Lock,
                title: `${an.accounts.expiredAccess} temporary ${an.accounts.expiredAccess === 1 ? "account has" : "accounts have"} expired access`,
                detail: "Still marked approved",
                page: "users",
                action: "Review",
            });
        if (num(sys.cpuPercent) >= 90 || num(sys.memPercent) >= 90)
            a.push({ id: "load", tone: "warning", icon: Cpu, title: "Server under heavy load", detail: `CPU ${Math.round(num(sys.cpuPercent))}% · memory ${Math.round(num(sys.memPercent))}%` });
        return a;
    }, [libraries, disks, errors24h, users.pending, an, sys.cpuPercent, sys.memPercent]);

    const critical = attention.filter((a) => a.tone === "error").length;
    const warnings = attention.length - critical;
    const visibleAttention = attention.filter((a) => alertFilter === "all" || (alertFilter === "critical" ? a.tone === "error" : a.tone === "warning"));

    // health score — deliberately simple and explained in the tooltip
    const health = Math.max(0, 100 - critical * 20 - Math.min(warnings, 5) * 5);
    const healthTone = health >= 85 ? "success" : health >= 65 ? "warning" : "error";

    const pendingList = (an?.accounts?.pending ?? []).filter((p) => !handled.has(p.id));
    const recentSignups = (activity?.recentUsers ?? []).filter((r) => r.status !== "pending").slice(0, 4);

    const decide = (id, status) => {
        updateUser.mutate(
            { id, data: { status } },
            {
                onSuccess: () => setHandled((s) => new Set(s).add(id)),
            },
        );
    };

    const doStop = (id) => {
        if (window.confirm("Stop this transcode session? The viewer's playback will end.")) stopStream.mutate(id);
    };

    // ── activity feed ─────────────────────────────────────────────────────────
    const feed = useMemo(() => {
        const rows = [];
        (an?.audit?.events ?? []).forEach((e) => {
            const d = e.detail || {};
            const label = AUDIT_LABEL[e.action] || String(e.action || "").replace(/_/g, " ");
            const extra = d.from && d.to ? ` · ${d.from} to ${d.to}` : "";
            rows.push({
                id: `a-${e.id}`,
                kind: "accounts",
                tone: e.action === "account_purge_failed" ? "error" : e.action === "account_deleted" ? "warning" : "neutral",
                icon: Users,
                text: `${label}${extra}`,
                sub: e.target,
                at: e.at,
            });
        });
        errors24h
            .slice(0, 8)
            .forEach((l, i) =>
                rows.push({ id: `e-${i}-${l.ts}`, kind: "errors", tone: "error", icon: AlertTriangle, text: String(l.message || "").slice(0, 120), sub: l.category || "system", at: l.ts }),
            );
        return rows.sort((x, y) => new Date(y.at) - new Date(x.at)).slice(0, 6);
    }, [an, errors24h]);
    const visibleFeed = feed.filter((f) => feedFilter === "all" || f.kind === feedFilter);

    const refreshAll = () => {
        statsQuery.refetch();
        activityQuery.refetch();
        libsQuery.refetch();
        analyticsQuery.refetch();
        liveQuery.refetch();
        logsQuery.refetch();
    };

    const loading = statsQuery.isLoading || activityQuery.isLoading;
    if (loading) {
        return (
            <div className="space-y-4">
                <Skel className="h-40" />
                <Skel className="h-48" />
                <div className="grid gap-4 lg:grid-cols-2">
                    <Skel className="h-64" />
                    <Skel className="h-64" />
                </div>
            </div>
        );
    }

    const lastAt = statsQuery.dataUpdatedAt ? new Date(statsQuery.dataUpdatedAt) : null;
    const refreshing = statsQuery.isFetching || analyticsQuery.isFetching;
    const mediaRows = mediaTab === "most" ? an?.mostWatched : mediaTab === "stopped" ? an?.stoppedEarly : an?.neverWatched?.top;
    const maxMostHours = Math.max(...(an?.mostWatched ?? []).map((m) => m.hours), 1);
    const res = an?.resolution ?? null;
    const resTotalWatched = res ? res.watchedHours.reduce((a, b) => a + b, 0) : 0;
    const resTotalLib = res ? res.libraryFiles.reduce((a, b) => a + b, 0) : 0;
    const topResIdx = res && resTotalWatched > 0 ? res.watchedHours.indexOf(Math.max(...res.watchedHours)) : -1;
    const mix = watch?.mix ?? null;
    const mixTotal = mix ? mix.movie + mix.series + mix.anime : 0;
    const libTotalBytes = libraries.reduce((a, l) => a + num(l.sizeBytes), 0);
    const totalBytes = num(stats?.storage?.usedBytes) || libTotalBytes;
    const ses = an?.sessions ?? null;
    const inv = an?.inventory ?? null;
    const largestLib = libraries.reduce((a, l) => (!a || num(l.sizeBytes) > num(a.sizeBytes) ? l : a), null);
    const health_ = an?.contentHealth ?? null;

    return (
        <div className="space-y-4 text-sm leading-normal text-base-content">
            {/* ── Header ─────────────────────────────────────────────────── */}
            <section className="overflow-hidden rounded-lg border border-base-300 bg-base-200">
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
                    <div className="flex items-center gap-3">
                        <div className="flex size-10 items-center justify-center rounded-md bg-primary text-primary-content">
                            <Play size={18} />
                        </div>
                        <div>
                            <p className="text-xs text-base-content/75">FLUX · Admin dashboard</p>
                            <h1 className="text-xl font-semibold leading-tight tracking-tight">
                                {greeting}, {firstName}
                            </h1>
                            <p className="text-xs text-base-content/65">{new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {lastAt && <span className="hidden font-mono text-xs text-base-content/65 sm:inline">updated {lastAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
                        <button type="button" onClick={refreshAll} className="btn btn-sm rounded-md border-none bg-base-300">
                            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
                            Refresh
                        </button>
                    </div>
                </div>
                <Kpis
                    cols="lg:grid-cols-5"
                    items={[
                        { label: "Server", value: "Online", dot: true, sub: `up ${fmtUptime(sys.uptime)} · Node ${String(sys.nodeVersion || "").replace("v", "") || "—"}` },
                        { label: "Health score", value: `${health} / 100`, tone: healthTone, sub: critical + warnings === 0 ? "No open issues" : `${critical} critical · ${warnings} warnings` },
                        { label: "Users online", value: onlineCount, dot: onlineCount > 0, sub: `of ${users.total ?? 0} accounts` },
                        { label: "Media files", value: (stats?.media?.total ?? 0).toLocaleString(), sub: `${fmtBytes(num(stats?.storage?.usedBytes))} total size` },
                        { label: "Watched today", value: fmtHours(todayHours), sub: watch ? `${fmtHours(watch.totalHours)} all time` : "no data yet" },
                    ]}
                />
            </section>

            {/* ── Needs attention ────────────────────────────────────────── */}
            <SectionLabel>Needs attention</SectionLabel>
            <Panel
                title="Action queue"
                icon={Bell}
                right={
                    <Seg
                        value={alertFilter}
                        onChange={setAlertFilter}
                        options={[
                            { value: "all", label: `All ${attention.length}` },
                            { value: "critical", label: `Critical ${critical}` },
                            { value: "warning", label: `Warnings ${warnings}` },
                        ]}
                    />
                }>
                {attention.length === 0 ? (
                    <div className="flex items-center gap-3 px-4 py-4">
                        <CheckCircle size={18} className="text-success" />
                        <p className="text-sm text-base-content/85">All clear. Libraries are online, disk space is healthy and there are no pending requests.</p>
                    </div>
                ) : visibleAttention.length === 0 ? (
                    <Empty icon={CheckCircle} text="Nothing in this category." />
                ) : (
                    <ul className="divide-y divide-base-300">
                        {visibleAttention.map((a) => {
                            const Icon = a.icon;
                            return (
                                <li key={a.id} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 sm:grid-cols-[2rem_minmax(0,1fr)_4.5rem_5.5rem]">
                                    <div className={`flex size-8 items-center justify-center rounded-md bg-base-300 ${TEXT[a.tone]}`}>
                                        <Icon size={15} />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-medium">{a.title}</p>
                                        <p className="truncate text-xs text-base-content/75">{a.detail}</p>
                                    </div>
                                    <div className="hidden sm:block">
                                        <Badge tone={a.tone}>{a.tone === "error" ? "Critical" : "Warning"}</Badge>
                                    </div>
                                    <div className="flex justify-end">
                                        {a.page && go(a.page) ? (
                                            <button type="button" onClick={go(a.page)} className="btn btn-xs w-[5.5rem] rounded-md border-none bg-base-300">
                                                {a.action}
                                            </button>
                                        ) : null}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </Panel>

            {/* ── Live now ───────────────────────────────────────────────── */}
            <SectionLabel>Live now</SectionLabel>
            <section className="overflow-hidden rounded-lg border border-base-300 bg-base-200">
                <Kpis
                    first
                    items={[
                        { label: "Watching now", value: live?.nowWatching?.length ?? "—", dot: (live?.nowWatching?.length ?? 0) > 0, sub: "playing in the last 90 s" },
                        { label: "Transcodes", value: live ? live.transcodes.length : (stats?.streams?.active ?? 0), sub: "FFmpeg sessions running" },
                        { label: "Users online", value: onlineCount, dot: onlineCount > 0, sub: `${stats?.devices?.registered ?? 0} registered devices` },
                        { label: "CPU · Memory", value: `${Math.round(num(sys.cpuPercent))}% · ${Math.round(num(sys.memPercent))}%`, sub: `${sys.memUsed ?? "—"} of ${sys.memTotal ?? "—"}` },
                    ]}
                />
                {(live?.nowWatching ?? []).map((w) => (
                    <div key={`${w.userId}-${w.id}`} className="flex items-center gap-3 border-t border-base-300 px-4 py-2.5">
                        <Avatar name={w.name} online />
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{cleanTitle(w.title)}</p>
                            <p className="truncate text-xs text-base-content/75">
                                {w.name}
                                {w.season != null && w.episode != null ? ` · S${w.season} E${w.episode}` : ""}
                            </p>
                        </div>
                        <Badge tone={w.type === "movie" ? "primary" : "accent"}>{w.type === "movie" ? "Movie" : w.type === "anime" ? "Anime" : "Series"}</Badge>
                        <span className="w-14 text-right text-xs text-base-content/65">{w.agoSec < 10 ? "now" : `${w.agoSec}s ago`}</span>
                    </div>
                ))}
                {(live?.transcodes ?? []).map((t) => (
                    <div key={t.id} className="flex items-center gap-3 border-t border-base-300 px-4 py-2.5">
                        <div className="flex size-8 items-center justify-center rounded-md bg-base-300">
                            <Cpu size={15} />
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{cleanTitle(t.title)}</p>
                            <p className="truncate text-xs text-base-content/75">
                                {t.status || "running"}
                                {t.fps ? ` · ${Math.round(t.fps)} fps` : ""}
                                {t.speed ? ` · ${t.speed}x speed` : ""}
                                {t.bitrate ? ` · ${t.bitrate}` : ""}
                            </p>
                        </div>
                        <Badge tone="info">{DECISION_LABEL[t.decision] || "Transcode"}</Badge>
                        <button type="button" onClick={() => doStop(t.id)} disabled={stopStream.isPending} className="btn btn-xs rounded-md border-none bg-base-300">
                            <Square size={11} />
                            Stop
                        </button>
                    </div>
                ))}
                {!(live?.nowWatching?.length || live?.transcodes?.length) && (
                    <div className="border-t border-base-300">
                        <Empty icon={Radio} text={live ? "Nobody is watching right now." : "Live data is not available yet."} />
                    </div>
                )}
            </section>

            {/* ── Usage and engagement ───────────────────────────────────── */}
            <SectionLabel>Usage and engagement</SectionLabel>
            {analyticsQuery.isError && (
                <div className="flex items-center gap-3 rounded-lg border border-base-300 bg-base-200 px-4 py-3">
                    <AlertTriangle size={16} className="text-warning" />
                    <p className="flex-1 text-sm text-base-content/85">Analytics could not be loaded. The rest of this page still works.</p>
                    <button type="button" onClick={() => analyticsQuery.refetch()} className="btn btn-xs rounded-md border-none bg-base-300">
                        Retry
                    </button>
                </div>
            )}

            <section className="overflow-hidden rounded-lg border border-base-300 bg-base-200">
                <div className="flex flex-wrap items-start justify-between gap-3 px-4 pb-1 pt-4">
                    <div>
                        <p className="text-xs text-base-content/75">Total watch time</p>
                        <div className="mt-1 flex items-baseline gap-2">
                            <span className="text-3xl font-semibold leading-tight tabular-nums">{trend ? (trendSum >= 100 ? Math.round(trendSum) : Math.round(trendSum * 10) / 10) : "—"}</span>
                            <span className="text-sm text-base-content/75">hours</span>
                            {delta != null && (
                                <Badge tone={delta >= 0 ? "success" : "error"}>
                                    {delta >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                                    {delta >= 0 ? "+" : ""}
                                    {delta}%
                                </Badge>
                            )}
                        </div>
                        <p className="mt-1 text-xs text-base-content/65">
                            Last {range.replace("d", "")} days vs the {range.replace("d", "")} days before
                        </p>
                    </div>
                    <div className="text-right">
                        <Seg value={range} onChange={setRange} options={RANGES} />
                        <p className="mt-2 min-h-5 text-xs tabular-nums text-base-content/80">
                            {trend && hover != null ? `${tickLabel(trend.dates[hover], 30)} · ${fmtHours(trend.values[hover])} (before: ${fmtHours(trend.prev[hover])})` : ""}
                        </p>
                    </div>
                </div>
                {trend && trendSum + trendPrevSum > 0 ? (
                    <div className="px-4">
                        <TrendChart dates={trend.dates} values={trend.values} prev={trend.prev} hover={hover} onHover={setHover} />
                    </div>
                ) : (
                    <Empty icon={Activity} text="No watch time recorded for this period yet." />
                )}
                <div className="flex gap-4 px-4 pb-3 pt-1 text-xs text-base-content/75">
                    <span className="flex items-center gap-1.5">
                        <span className="h-0.5 w-3 bg-primary" />
                        This period
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="w-3 border-t-2 border-dashed border-base-content/50" />
                        Previous period
                    </span>
                </div>
                <Kpis
                    items={[
                        { label: "Active today", value: eng?.activeToday ?? "—", sub: eng ? `${pct(eng.activeToday, users.total || eng.trackedUsers)}% of accounts` : "" },
                        { label: "Active this week", value: eng?.activeWeek ?? "—", sub: eng ? `${eng.activeMonth} in the last 30 days` : "" },
                        { label: "Avg per active user", value: eng?.avgHoursPerActiveUser != null ? fmtHours(eng.avgHoursPerActiveUser) : "—", sub: "per week" },
                        { label: "Completion rate", value: eng?.completionPct != null ? `${eng.completionPct}%` : "—", sub: "titles finished past 90%" },
                    ]}
                />
            </section>

            <div className="grid gap-4 lg:grid-cols-2">
                <Panel title="Traffic clock" icon={Clock} right={<span className="text-xs text-base-content/65">watch hours by hour of day · all time</span>}>
                    {watch ? <TrafficClock hours={watch.hoursOfDay} /> : <Empty text="Traffic data is not available yet." />}
                </Panel>

                <Panel title="Traffic by weekday" icon={Calendar} right={<span className="text-xs text-base-content/65">watch hours · last 180 days</span>}>
                    {watch && Math.max(...watch.weekdays.hours) > 0 ? (
                        <>
                            {(() => {
                                const hrs = watch.weekdays.hours;
                                const mx = Math.max(...hrs);
                                const mn = Math.min(...hrs);
                                const total = hrs.reduce((a, b) => a + b, 0);
                                return (
                                    <>
                                        <ul className="flex flex-1 flex-col justify-around gap-2 px-4 py-3">
                                            {watch.weekdays.labels.map((d, i) => (
                                                <li key={d} className="grid grid-cols-[2rem_minmax(0,1fr)_3.5rem_4.5rem] items-center gap-3">
                                                    <span className="text-xs text-base-content/80">{d}</span>
                                                    <Bar value={(hrs[i] / mx) * 100} tone={hrs[i] === mx ? "primary" : "secondary"} />
                                                    <span className="text-right text-xs tabular-nums">{fmtHours(hrs[i])}</span>
                                                    <span className="flex justify-end">
                                                        {hrs[i] === mx ? <Badge tone="primary">Busiest</Badge> : hrs[i] === mn ? <Badge tone="neutral">Quietest</Badge> : null}
                                                    </span>
                                                </li>
                                            ))}
                                        </ul>
                                        <Kpis
                                            items={[
                                                { label: "Busiest day", value: watch.weekdays.labels[hrs.indexOf(mx)], sub: fmtHours(mx) },
                                                { label: "Weekend share", value: `${pct(hrs[5] + hrs[6], total)}%`, sub: "Saturday and Sunday" },
                                            ]}
                                            cols="lg:grid-cols-2"
                                        />
                                        <Note>Run library scans and cleanup on the quietest day, around the quietest hour.</Note>
                                    </>
                                );
                            })()}
                        </>
                    ) : (
                        <Empty icon={Calendar} text="Weekday traffic appears once watch time is recorded." />
                    )}
                </Panel>

                <Panel title="Resolution ladder" icon={Layers} right={<span className="text-xs text-base-content/65">watched vs in library</span>}>
                    {res && (resTotalWatched > 0 || resTotalLib > 0) ? (
                        <>
                            <ul className="flex flex-1 flex-col justify-around gap-3 px-4 py-3">
                                {res.buckets.map((b, i) => {
                                    const w = pct(res.watchedHours[i], resTotalWatched);
                                    const l = pct(res.libraryFiles[i], resTotalLib);
                                    return (
                                        <li key={b} className="grid grid-cols-[4.5rem_minmax(0,1fr)_6rem] items-center gap-3">
                                            <span className={`text-xs ${i === topResIdx ? "font-semibold text-base-content" : "text-base-content/80"}`}>{b}</span>
                                            <div className="space-y-1">
                                                <Bar value={w} tone="primary" />
                                                <Bar value={l} tone="secondary" />
                                            </div>
                                            <span className="text-right text-xs tabular-nums">
                                                <span className={i === topResIdx ? "font-semibold" : ""}>{w}%</span>
                                                <span className="text-base-content/65"> · {l}%</span>
                                            </span>
                                        </li>
                                    );
                                })}
                            </ul>
                            <div className="flex gap-4 px-4 pb-3 text-xs text-base-content/75">
                                <span className="flex items-center gap-1.5">
                                    <span className="size-2 rounded-sm bg-primary" />
                                    Share of watch time
                                </span>
                                <span className="flex items-center gap-1.5">
                                    <span className="size-2 rounded-sm bg-secondary" />
                                    Share of library files
                                </span>
                            </div>
                            <Note>
                                {topResIdx >= 0 ? `${res.buckets[topResIdx]} is the most watched resolution (${pct(res.watchedHours[topResIdx], resTotalWatched)}% of watch time). ` : ""}
                                {res.totalTitles > 0 && res.matchedTitles < res.totalTitles
                                    ? `Based on ${res.matchedTitles} of ${res.totalTitles} watched titles with known resolution.`
                                    : "Resolution is the resolution of the file watched, not the quality delivered."}
                            </Note>
                        </>
                    ) : (
                        <Empty icon={Layers} text="Resolution data appears once media info is indexed and titles are watched." />
                    )}
                </Panel>

                <Panel title="Engagement insights" icon={Sparkles} right={<span className="text-xs text-base-content/65">all users</span>}>
                    {eng ? (
                        <>
                            <Kpis
                                first
                                grow
                                cols="lg:grid-cols-2"
                                items={[
                                    { label: "Weekly retention", value: eng.retentionPct != null ? `${eng.retentionPct}%` : "—", sub: "last week's viewers who came back" },
                                    { label: "Re-watch rate", value: eng.rewatchPct != null ? `${eng.rewatchPct}%` : "—", sub: "finished titles watched twice or more" },
                                    { label: "Night owls", value: eng.nightSharePct != null ? `${eng.nightSharePct}%` : "—", sub: "watch time between 00:00 and 06:00" },
                                    { label: "Titles finished", value: eng.totalPlays.toLocaleString(), sub: `${eng.titlesStarted.toLocaleString()} started` },
                                ]}
                            />
                            {mix && mixTotal > 0 && (
                                <div className="mt-auto border-t border-base-300 px-4 py-3">
                                    <p className="mb-2 text-xs text-base-content/75">Content mix by watch time</p>
                                    <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
                                        <div className="bg-primary" style={{ width: `${pct(mix.movie, mixTotal)}%` }} />
                                        <div className="bg-accent" style={{ width: `${pct(mix.series, mixTotal)}%` }} />
                                        <div className="bg-secondary" style={{ width: `${pct(mix.anime, mixTotal)}%` }} />
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-base-content/80">
                                        <span className="flex items-center gap-1.5">
                                            <span className="size-2 rounded-sm bg-primary" />
                                            Movies {pct(mix.movie, mixTotal)}%
                                        </span>
                                        <span className="flex items-center gap-1.5">
                                            <span className="size-2 rounded-sm bg-accent" />
                                            Series {pct(mix.series, mixTotal)}%
                                        </span>
                                        <span className="flex items-center gap-1.5">
                                            <span className="size-2 rounded-sm bg-secondary" />
                                            Anime {pct(mix.anime, mixTotal)}%
                                        </span>
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (
                        <Empty text="Engagement stats appear once watch time is recorded." />
                    )}
                </Panel>

                <Panel title="Daily activity" icon={Calendar} right={<span className="text-xs text-base-content/65">last 26 weeks</span>}>
                    {watch ? <ActivityCalendar days={watch.calendar} /> : <Empty text="Activity data is not available yet." />}
                </Panel>

                <Panel
                    title="Top viewers"
                    icon={Trophy}
                    right={
                        <span className="flex items-center gap-1.5 text-xs text-base-content/70">
                            <Dot /> active now · hours this week
                        </span>
                    }>
                    {an?.topViewers?.length ? (
                        <ul className="flex flex-1 flex-col divide-y divide-base-300">
                            {an.topViewers.map((u, i) => (
                                <li key={u.id} className="flex flex-1 items-center gap-3 px-4 py-2.5">
                                    <Avatar name={u.name} online={onlineSet.has(u.id)} />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="truncate text-sm font-medium">{u.name}</span>
                                            <span className="text-xs tabular-nums">{fmtHours(u.hours)}</span>
                                        </div>
                                        {u.email && <p className="truncate text-xs text-base-content/75">{u.email}</p>}
                                        <Bar value={(u.hours / an.topViewers[0].hours) * 100} tone={i === 0 ? "primary" : "secondary"} className="mt-1.5" />
                                    </div>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <Empty icon={Trophy} text="No one has watched anything in the last 7 days." />
                    )}
                </Panel>
            </div>

            <Panel
                title="Media performance"
                icon={Flame}
                right={
                    <Seg
                        value={mediaTab}
                        onChange={setMediaTab}
                        options={[
                            { value: "most", label: "Most watched" },
                            { value: "never", label: "Never watched" },
                            { value: "stopped", label: "Stopped early" },
                        ]}
                    />
                }>
                {mediaTab === "never" && an?.neverWatched?.available && (
                    <Note>
                        {an.neverWatched.count.toLocaleString()} of {an.neverWatched.totalFiles.toLocaleString()} files never played · {fmtBytes(an.neverWatched.bytes)} could be reclaimed. Largest
                        first.
                    </Note>
                )}
                {mediaTab === "stopped" && <Note>Titles people started and left before the halfway mark and have not returned to for a day. Worth checking audio sync and subtitles.</Note>}
                {mediaTab === "never" && an?.neverWatched && !an.neverWatched.available ? (
                    <Empty icon={Film} text="The media list is not loaded yet. Open the library in FLUX once, then refresh." />
                ) : mediaRows?.length ? (
                    <ul className="divide-y divide-base-300">
                        {mediaRows.map((m, i) => {
                            const isFile = mediaTab === "never";
                            const type = m.type || "movie";
                            return (
                                <li key={`${m.title || m.id}-${i}`} className="grid grid-cols-[1.25rem_2rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5">
                                    <span className="text-center text-xs text-base-content/65">{i + 1}</span>
                                    <div className="flex size-8 items-center justify-center rounded-md bg-base-300">{type === "movie" || isFile ? <Film size={14} /> : <Tv size={14} />}</div>
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-medium">{cleanTitle(m.title || m.name)}</p>
                                        {mediaTab === "most" && <Bar value={(m.hours / maxMostHours) * 100} tone={i === 0 ? "primary" : "secondary"} className="mt-1.5" />}
                                        {mediaTab === "stopped" && <p className="text-xs text-base-content/75">Left at about {m.avgPct}% on average</p>}
                                        {isFile && <p className="truncate text-xs text-base-content/75">{[m.library, m.resolution].filter(Boolean).join(" · ") || "Library file"}</p>}
                                    </div>
                                    <div className="flex items-center gap-2 text-right text-xs tabular-nums">
                                        {mediaTab === "most" && (
                                            <>
                                                <span className="w-16 text-base-content/75">
                                                    {m.plays} {m.plays === 1 ? "finish" : "finishes"}
                                                </span>
                                                <span className="w-14">{fmtHours(m.hours)}</span>
                                                <span className="w-16 text-base-content/75">
                                                    {m.viewers} {m.viewers === 1 ? "viewer" : "viewers"}
                                                </span>
                                            </>
                                        )}
                                        {mediaTab === "stopped" && (
                                            <span>
                                                {m.users} {m.users === 1 ? "viewer" : "viewers"}
                                            </span>
                                        )}
                                        {isFile && <span>{fmtBytes(m.sizeBytes)}</span>}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                ) : (
                    <Empty icon={Flame} text="Nothing to show yet. This fills in as people watch." />
                )}
            </Panel>

            {/* ── Content and storage ────────────────────────────────────── */}
            <SectionLabel>Content and storage</SectionLabel>
            <Panel
                title="Media library size"
                icon={Database}
                right={
                    <span className="text-xs text-base-content/65">
                        {(stats?.media?.total ?? 0).toLocaleString()} files · {libraries.length} {libraries.length === 1 ? "library" : "libraries"}
                    </span>
                }>
                <div className="flex flex-wrap items-end justify-between gap-4 px-4 py-4">
                    <div>
                        <p className="text-xs text-base-content/75">Total size of all media</p>
                        <p className="mt-1 text-3xl font-semibold leading-tight tabular-nums">{fmtBytes(totalBytes)}</p>
                    </div>
                    {primaryDisk && totalBytes > 0 && (
                        <div className="w-full max-w-xs">
                            <div className="mb-1.5 flex justify-between text-xs text-base-content/80">
                                <span>Share of disk {primaryDisk.mount}</span>
                                <span className="tabular-nums">{Math.round((totalBytes / primaryDisk.sizeBytes) * 1000) / 10}%</span>
                            </div>
                            <Bar value={(totalBytes / primaryDisk.sizeBytes) * 100} tone="primary" />
                        </div>
                    )}
                </div>
                <Kpis
                    items={[
                        { label: "In terabytes", value: `${(totalBytes / 1024 ** 4).toFixed(2)} TB`, sub: "1 TB = 1,024 GB" },
                        { label: "In gigabytes", value: `${(totalBytes / 1024 ** 3).toLocaleString(undefined, { maximumFractionDigits: 1 })} GB`, sub: "1 GB = 1,024 MB" },
                        { label: "In megabytes", value: `${Math.round(totalBytes / 1024 ** 2).toLocaleString()} MB`, sub: "exact library total" },
                        { label: "Average file size", value: stats?.media?.total ? fmtBytes(totalBytes / stats.media.total) : "—", sub: `across ${(stats?.media?.total ?? 0).toLocaleString()} files` },
                    ]}
                />
                {libraries.length > 0 && (
                    <Kpis
                        cols="lg:grid-cols-3"
                        items={[
                            {
                                label: "Largest library",
                                value: largestLib ? fmtBytes(num(largestLib.sizeBytes)) : "—",
                                sub: largestLib ? `${largestLib.label || largestLib.path} · ${pct(num(largestLib.sizeBytes), libTotalBytes)}% of media` : "",
                            },
                            {
                                label: "Libraries online",
                                value: `${libraries.filter((l) => l.status !== "offline").length} of ${libraries.length}`,
                                tone: libraries.some((l) => l.status === "offline") ? "warning" : undefined,
                                sub: libraries.some((l) => l.status === "offline") ? "some offline, size may be understated" : "all reachable",
                            },
                            {
                                label: "Free on disk",
                                value: primaryDisk ? fmtBytes(primaryDisk.freeBytes) : "—",
                                sub: primaryDisk
                                    ? `room for about ${Math.floor(primaryDisk.freeBytes / Math.max(1, totalBytes / Math.max(1, stats?.media?.total ?? 1))).toLocaleString()} more files at the average size`
                                    : "disk capacity unavailable",
                            },
                        ]}
                    />
                )}
            </Panel>
            <div className="grid gap-4 lg:grid-cols-2">
                <Panel
                    title="Media by resolution"
                    icon={Layers}
                    right={
                        <span className="text-xs text-base-content/65">
                            {inv && inv.totals.files > 0 ? `${inv.totals.files.toLocaleString()} files · ${fmtRuntime(inv.totals.seconds)} of video` : ""}
                        </span>
                    }>
                    {inv && inv.totals.files > 0 ? (
                        <>
                            <BreakdownTable firstHead="Resolution" rows={inv.rows} total={inv.totals.files} tone="primary" partsLabel="Codecs" />
                            <Note>
                                All codecs:{" "}
                                {inv.codecs
                                    .slice(0, 4)
                                    .map((c) => `${c.name} ${pctNZ(c.count, inv.totals.files)}%`)
                                    .join(" · ")}
                            </Note>
                        </>
                    ) : (
                        <Empty icon={Layers} text="Media info has not been indexed yet, so resolutions and runtime are not available." />
                    )}
                </Panel>

                <Panel
                    title="File formats"
                    icon={Film}
                    right={<span className="text-xs text-base-content/65">{inv && inv.formats.length ? `${inv.formats.length} ${inv.formats.length === 1 ? "format" : "formats"}` : ""}</span>}>
                    {inv && inv.totals.files > 0 ? (
                        <>
                            <BreakdownTable firstHead="Format" rows={inv.formats} total={inv.totals.files} tone="secondary" partsLabel="Resolutions" />
                            <Note>Read from your media info. New resolutions, formats and codecs appear here automatically.</Note>
                        </>
                    ) : (
                        <Empty icon={Film} text="Media info has not been indexed yet, so file formats are not available." />
                    )}
                </Panel>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
                <Panel title="Storage" icon={HardDrive} right={<span className="text-xs text-base-content/65">{stats?.storage?.used ?? "0 B"} in libraries</span>}>
                    {disks.length ? (
                        <>
                            <div className="space-y-4 px-4 py-3">
                                {disks.slice(0, 3).map((d) => (
                                    <div key={d.mount}>
                                        <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                                            <span className="font-medium">
                                                {d.mount} <span className="text-base-content/65">· {d.libraries.join(", ")}</span>
                                            </span>
                                            <span className={`tabular-nums ${d.usedPct >= 90 ? "text-error" : d.usedPct >= 80 ? "text-warning" : ""}`}>{d.usedPct}%</span>
                                        </div>
                                        <Bar value={d.usedPct} tone={d.usedPct >= 90 ? "error" : d.usedPct >= 80 ? "warning" : "primary"} />
                                        <p className="mt-1 text-xs text-base-content/65">
                                            {fmtBytes(d.usedBytes)} of {fmtBytes(d.sizeBytes)} · {fmtBytes(d.freeBytes)} free
                                        </p>
                                    </div>
                                ))}
                            </div>
                            {primaryDisk && (
                                <div className="border-t border-base-300 pt-3">
                                    <div className="flex items-center justify-between px-4 pb-1">
                                        <span className="text-xs text-base-content/80">Forecast · {primaryDisk.mount}</span>
                                        {primaryDisk.daysToFull != null && <Badge tone={primaryDisk.daysToFull <= 14 ? "warning" : "neutral"}>full in about {primaryDisk.daysToFull} days</Badge>}
                                    </div>
                                    <ForecastChart disk={primaryDisk} />
                                </div>
                            )}
                        </>
                    ) : (
                        <Empty icon={HardDrive} text="Disk capacity is not available on this server." />
                    )}
                    {libraries.length > 0 && (
                        <ul className="space-y-2.5 border-t border-base-300 px-4 py-3">
                            {[...libraries]
                                .sort((a, b) => num(b.sizeBytes) - num(a.sizeBytes))
                                .slice(0, 6)
                                .map((l) => (
                                    <li key={l.id ?? l.path}>
                                        <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                                            <span className="flex min-w-0 items-center gap-1.5 truncate font-medium">
                                                {l.status === "offline" ? <AlertTriangle size={12} className="shrink-0 text-error" /> : <Folder size={12} className="shrink-0" />}
                                                <span className="truncate">{l.label || l.path}</span>
                                            </span>
                                            <span className="tabular-nums text-base-content/80">
                                                {l.status === "offline" ? "Offline" : `${l.size ?? fmtBytes(l.sizeBytes)} · ${num(l.fileCount).toLocaleString()} files`}
                                            </span>
                                        </div>
                                        <Bar value={pct(num(l.sizeBytes), libTotalBytes)} tone={l.status === "offline" ? "error" : "secondary"} />
                                    </li>
                                ))}
                        </ul>
                    )}
                </Panel>

                <Panel title="Content health" icon={Stethoscope} right={<span className="text-xs text-base-content/65">{health_ ? `${health_.totalFiles.toLocaleString()} files` : ""}</span>}>
                    {health_ && health_.totalFiles > 0 ? (
                        <ul className="flex flex-1 flex-col divide-y divide-base-300">
                            {[
                                { tone: "warning", icon: Database, label: "Not indexed yet", hint: "no media info, resolution unknown", v: health_.notProbed },
                                { tone: "warning", icon: Cpu, label: "Video needs transcoding", hint: "HEVC, MPEG-4 or other non-browser codec", v: health_.videoTranscode },
                                { tone: "warning", icon: Cpu, label: "Audio needs transcoding", hint: "DTS, TrueHD, AC-3 or 24-bit PCM", v: health_.audioTranscode },
                                { tone: "info", icon: Info, label: "No subtitles", hint: "no embedded subtitle track", v: health_.noSubtitles },
                                { tone: "neutral", icon: Layers, label: "Low resolution", hint: "below 480p", v: health_.lowRes },
                                { tone: "success", icon: Sparkles, label: "Newly indexed", hint: "added in the last 7 days", v: health_.newThisWeek },
                            ]
                                .filter((r) => r.v != null)
                                .map((r) => {
                                    const Icon = r.icon;
                                    return (
                                        <li key={r.label} className="flex flex-1 items-center gap-3 px-4 py-2.5">
                                            <div className={`flex size-8 items-center justify-center rounded-md bg-base-300 ${TEXT[r.tone]}`}>
                                                <Icon size={15} />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate text-sm font-medium">{r.label}</p>
                                                <p className="truncate text-xs text-base-content/75">{r.hint}</p>
                                            </div>
                                            <span className="w-16 text-right text-sm font-semibold tabular-nums">{r.v.toLocaleString()}</span>
                                            <span className="w-10 text-right text-xs tabular-nums text-base-content/65">{pct(r.v, health_.totalFiles)}%</span>
                                        </li>
                                    );
                                })}
                        </ul>
                    ) : (
                        <Empty icon={Stethoscope} text="Media info has not been indexed yet, so there is nothing to check." />
                    )}
                </Panel>
            </div>

            {/* ── Users and security ─────────────────────────────────────── */}
            <SectionLabel>Users and security</SectionLabel>
            <div className="grid gap-4 lg:grid-cols-2">
                <Panel
                    title="Accounts"
                    icon={Users}
                    right={<span className="text-xs text-base-content/65">{an?.accounts?.newUsers7d != null ? `+${an.accounts.newUsers7d} this week` : `${users.total ?? 0} total`}</span>}>
                    <div className="px-4 py-3">
                        {(() => {
                            const total = users.total || 1;
                            const other = Math.max(0, (users.total ?? 0) - (users.approved ?? 0) - (users.pending ?? 0) - (users.suspended ?? 0));
                            return (
                                <>
                                    <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-base-300">
                                        <div className="bg-success" style={{ width: `${pct(users.approved ?? 0, total)}%` }} />
                                        <div className="bg-warning" style={{ width: `${pct(users.pending ?? 0, total)}%` }} />
                                        <div className="bg-error" style={{ width: `${pct(users.suspended ?? 0, total)}%` }} />
                                        <div className="bg-secondary" style={{ width: `${pct(other, total)}%` }} />
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-base-content/80">
                                        <span className="flex items-center gap-1.5">
                                            <span className="size-2 rounded-sm bg-success" />
                                            {users.approved ?? 0} approved
                                        </span>
                                        <span className="flex items-center gap-1.5">
                                            <span className="size-2 rounded-sm bg-warning" />
                                            {users.pending ?? 0} pending
                                        </span>
                                        <span className="flex items-center gap-1.5">
                                            <span className="size-2 rounded-sm bg-error" />
                                            {users.suspended ?? 0} blocked
                                        </span>
                                        {other > 0 && (
                                            <span className="flex items-center gap-1.5">
                                                <span className="size-2 rounded-sm bg-secondary" />
                                                {other} other
                                            </span>
                                        )}
                                    </div>
                                </>
                            );
                        })()}
                    </div>
                    {pendingList.length > 0 && (
                        <ul className="divide-y divide-base-300 border-t border-base-300">
                            {pendingList.map((p) => (
                                <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                                    <Avatar name={p.name || p.email} />
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium">{p.name || p.email}</p>
                                        <p className="truncate text-xs text-base-content/75">Requested {fmtRel(p.createdAt)}</p>
                                    </div>
                                    <button type="button" disabled={updateUser.isPending} onClick={() => decide(p.id, "rejected")} className="btn btn-xs rounded-md border-none bg-base-300">
                                        <X size={12} />
                                        Reject
                                    </button>
                                    <button type="button" disabled={updateUser.isPending} onClick={() => decide(p.id, "approved")} className="btn btn-xs btn-primary rounded-md border-none">
                                        <Check size={12} />
                                        Approve
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                    {(an?.accounts?.expiring ?? []).length > 0 && (
                        <ul className="divide-y divide-base-300 border-t border-base-300">
                            {an.accounts.expiring.map((e) => (
                                <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                                    <Avatar name={e.name || e.email} online={onlineSet.has(e.id)} />
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium">{e.name || e.email}</p>
                                        <p className="truncate text-xs text-base-content/75">Access ends {fmtIn(e.accessExpiresAt)}</p>
                                    </div>
                                    <Badge tone="warning">Expiring</Badge>
                                </li>
                            ))}
                        </ul>
                    )}
                    <div className="flex flex-1 flex-col border-t border-base-300">
                        <p className="px-4 pb-1 pt-3 text-xs font-medium text-base-content/75">Recent sign-ups</p>
                        {recentSignups.length ? (
                            <ul className="flex flex-1 flex-col divide-y divide-base-300">
                                {recentSignups.map((r) => (
                                    <li key={r.id} className="flex flex-1 items-center gap-3 px-4 py-2.5">
                                        <Avatar name={r.name || r.email} online={onlineSet.has(r.id)} />
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-sm font-medium">{r.name || r.email}</p>
                                            <p className="truncate text-xs text-base-content/75">{r.email}</p>
                                        </div>
                                        <Badge tone={STATUS_TONE[r.status] || "neutral"}>{r.status || "unknown"}</Badge>
                                        <span className="w-16 text-right text-xs text-base-content/65">{fmtRel(r.createdAt)}</span>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <Empty icon={Users} text="No other recent sign-ups." />
                        )}
                    </div>
                    {updateUser.isError && <p className="border-t border-base-300 px-4 py-2 text-xs text-error">Could not update that account. Try again from the Users page.</p>}
                </Panel>

                <Panel title="Security and access" icon={Shield} right={<span className="text-xs text-base-content/65">account hygiene</span>}>
                    <Kpis
                        first
                        grow
                        cols="lg:grid-cols-2"
                        items={[
                            {
                                label: "Unverified emails",
                                value: an?.accounts?.unverified ?? "—",
                                tone: (an?.accounts?.unverified ?? 0) > 0 ? "warning" : undefined,
                                sub: "accounts that never confirmed",
                            },
                            { label: "Blocked or rejected", value: users.suspended ?? 0, sub: "cannot sign in" },
                            { label: "Sign-ins, 24h", value: an?.accounts?.logins24h ?? "—", sub: "real logins, not token refreshes" },
                            { label: "Admin actions, 24h", value: an?.audit?.count24h ?? "—", sub: "audit log entries" },
                            {
                                label: "Expired access",
                                value: an?.accounts?.expiredAccess ?? "—",
                                tone: (an?.accounts?.expiredAccess ?? 0) > 0 ? "warning" : undefined,
                                sub: "temporary, still approved",
                            },
                            { label: "Pending deletion", value: users.pendingDeletion ?? 0, sub: `${users.admins ?? 0} admin ${users.admins === 1 ? "account" : "accounts"}` },
                        ]}
                    />
                    <Note>Failed-login counts are not recorded by the server yet, so they are not shown here.</Note>
                </Panel>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                <Panel
                    title="Logins and devices"
                    icon={Users}
                    right={<span className="text-xs text-base-content/65">{ses?.totalOnRecord != null ? `${ses.totalOnRecord.toLocaleString()} sessions on record` : "active now"}</span>}>
                    {ses ? (
                        <>
                            <Kpis
                                first
                                cols="lg:grid-cols-2"
                                items={[
                                    { label: "Active now", value: ses.activeNow ?? 0, dot: (ses.activeNow ?? 0) > 0, sub: `seen in the last ${ses.activeNowMinutes ?? 5} minutes` },
                                    { label: "Logged-in sessions", value: ses.activeSessions, sub: `${ses.avgPerUser} per user on average` },
                                    { label: "Devices", value: ses.devices, sub: "distinct machines" },
                                    { label: "Users signed in", value: ses.usersSignedIn, sub: `of ${users.total ?? 0} accounts` },
                                ]}
                            />
                            <div className="grid grid-cols-[2rem_minmax(0,1fr)_4rem_4rem_5rem] items-center gap-3 border-t border-base-300 px-4 py-2 text-xs text-base-content/65">
                                <span />
                                <span>User</span>
                                <span className="text-right">Sessions</span>
                                <span className="text-right">Devices</span>
                                <span className="text-right">Active now</span>
                            </div>
                            <ul className="flex flex-1 flex-col divide-y divide-base-300 border-t border-base-300">
                                {ses.users.map((u) => (
                                    <li key={u.id} className="grid flex-1 grid-cols-[2rem_minmax(0,1fr)_4rem_4rem_5rem] items-center gap-3 px-4 py-2.5">
                                        <Avatar name={u.name} online={onlineSet.has(u.id)} />
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-medium">{u.name}</p>
                                            {u.email && <p className="truncate text-xs text-base-content/75">{u.email}</p>}
                                            <p className="truncate text-xs text-base-content/65">
                                                {u.labels.join(" · ")}
                                                {u.moreLabels > 0 ? ` · +${u.moreLabels} more` : ""}
                                            </p>
                                        </div>
                                        <span className="text-right text-sm font-semibold tabular-nums">{u.sessions}</span>
                                        <span className="text-right text-sm font-semibold tabular-nums">{u.devices}</span>
                                        <span className="flex items-center justify-end gap-1.5 text-sm tabular-nums">
                                            {u.activeNow > 0 ? (
                                                <>
                                                    <Dot />
                                                    <span className="font-semibold">{u.activeNow}</span>
                                                </>
                                            ) : (
                                                <span className="text-xs text-base-content/65">{fmtRel(u.lastSeenAt)}</span>
                                            )}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                            {(() => {
                                const t = ses.byType;
                                const total = t.desktop + t.mobile + t.tablet + t.other;
                                if (!total) return null;
                                return (
                                    <div className="mt-auto border-t border-base-300 px-4 py-3">
                                        <p className="mb-2 text-xs text-base-content/75">Device types</p>
                                        <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-base-300">
                                            <div className="bg-primary" style={{ width: `${pct(t.desktop, total)}%` }} />
                                            <div className="bg-accent" style={{ width: `${pct(t.mobile, total)}%` }} />
                                            <div className="bg-secondary" style={{ width: `${pct(t.tablet, total)}%` }} />
                                        </div>
                                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-base-content/80">
                                            <span className="flex items-center gap-1.5">
                                                <span className="size-2 rounded-sm bg-primary" />
                                                Desktop {t.desktop}
                                            </span>
                                            <span className="flex items-center gap-1.5">
                                                <span className="size-2 rounded-sm bg-accent" />
                                                Mobile {t.mobile}
                                            </span>
                                            <span className="flex items-center gap-1.5">
                                                <span className="size-2 rounded-sm bg-secondary" />
                                                Tablet {t.tablet}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })()}
                        </>
                    ) : (
                        <Empty icon={Users} text="Session data is not available yet." />
                    )}
                </Panel>
                <Panel
                    title="Active sessions"
                    icon={Eye}
                    right={
                        <span className="flex items-center gap-1.5 text-xs text-base-content/70">
                            <Dot /> active now
                        </span>
                    }>
                    {(activity?.recentSessions ?? []).length ? (
                        <ul className="flex flex-1 flex-col divide-y divide-base-300">
                            {activity.recentSessions.map((s) => (
                                <li key={s.id} className="flex flex-1 items-center gap-3 px-4 py-2.5">
                                    <Avatar name={s.user?.name || s.user?.email} online={onlineSet.has(s.user?.id)} />
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium">{s.user?.name || s.user?.email || "—"}</p>
                                        <p className="truncate text-xs text-base-content/75">{[s.device, s.browser, s.os].filter(Boolean).join(" · ") || "Unknown device"}</p>
                                    </div>
                                    <span className="text-xs text-base-content/75">{onlineSet.has(s.user?.id) ? "online" : fmtRel(s.lastSeen)}</span>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <Empty icon={Eye} text="No active sessions." />
                    )}
                    <Note>Latest 5 sessions. Online means the session was active recently.</Note>
                </Panel>
            </div>

            {/* ── System and activity ────────────────────────────────────── */}
            <SectionLabel>System and activity</SectionLabel>
            <div className="grid gap-4 lg:grid-cols-2">
                <Panel title="Resources" icon={Server} right={<span className="font-mono text-xs text-base-content/65">Node {String(sys.nodeVersion || "").replace("v", "") || "—"}</span>}>
                    <div className="flex flex-1 flex-col justify-around gap-4 px-4 py-4">
                        {[
                            { label: "CPU", v: num(sys.cpuPercent), sub: "" },
                            { label: "Memory", v: num(sys.memPercent), sub: `${sys.memUsed ?? "—"} of ${sys.memTotal ?? "—"}` },
                            ...disks.slice(0, 3).map((d) => ({ label: `Disk ${d.mount}`, v: d.usedPct, sub: `${fmtBytes(d.freeBytes)} free` })),
                        ].map((r) => (
                            <div key={r.label}>
                                <div className="mb-1.5 flex items-center justify-between text-xs">
                                    <span className="text-base-content/80">
                                        {r.label} {r.sub && <span className="text-base-content/65">· {r.sub}</span>}
                                    </span>
                                    <span className={`tabular-nums ${r.v >= 90 ? "text-error" : r.v >= 80 ? "text-warning" : ""}`}>{Math.round(r.v)}%</span>
                                </div>
                                <Bar value={r.v} tone={r.v >= 90 ? "error" : r.v >= 80 ? "warning" : "primary"} />
                            </div>
                        ))}
                    </div>
                    <Kpis
                        items={[
                            { label: "Uptime", value: fmtUptime(sys.uptime), sub: "since last restart" },
                            { label: "Devices", value: stats?.devices?.registered ?? 0, sub: "registered" },
                            { label: "Users online", value: onlineCount, dot: onlineCount > 0, sub: `of ${users.total ?? 0} accounts` },
                            { label: "Transcodes", value: live ? live.transcodes.length : (stats?.streams?.active ?? 0), sub: "running now" },
                        ]}
                        cols="lg:grid-cols-2"
                    />
                </Panel>

                <Panel
                    title="Recent activity"
                    icon={Activity}
                    right={
                        <Seg
                            value={feedFilter}
                            onChange={setFeedFilter}
                            options={[
                                { value: "all", label: "All" },
                                { value: "errors", label: "Errors" },
                                { value: "accounts", label: "Accounts" },
                            ]}
                        />
                    }>
                    {visibleFeed.length ? (
                        <ul className="divide-y divide-base-300">
                            {visibleFeed.map((f) => {
                                const Icon = f.icon;
                                return (
                                    <li key={f.id} className="flex items-center gap-3 px-4 py-2.5">
                                        <div className={`flex size-8 shrink-0 items-center justify-center rounded-md bg-base-300 ${TEXT[f.tone]}`}>
                                            <Icon size={15} />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-sm font-medium">{f.text}</p>
                                            {f.sub && <p className="truncate text-xs text-base-content/75">{f.sub}</p>}
                                        </div>
                                        <span className="text-xs tabular-nums text-base-content/65">{fmtRel(f.at)}</span>
                                    </li>
                                );
                            })}
                        </ul>
                    ) : (
                        <Empty icon={CheckCircle} text="No errors or account events in the recent window." />
                    )}
                    <Note>Latest account events and server errors from the last 24 hours.</Note>
                </Panel>
            </div>

            <p className="pb-2 text-center text-xs text-base-content/65">Auto-refreshes every 10 to 60 seconds · live data and analytics are read-only</p>
        </div>
    );
}
