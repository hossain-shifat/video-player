import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Clock, Flame, ArrowUpRight, ArrowDownRight, Film, Tv, CheckCircle2, Activity, Minus, Repeat2, Sunrise, Sun, Sunset, Moon } from "lucide-react";
import { useWatchTime } from "../../Hooks/useWatchTime";
import { useAuth } from "../../auth/AuthContext";

// ─── formatting ───────────────────────────────────────────────────────────────
function splitDur(sec) {
    const mins = Math.floor((sec || 0) / 60);
    return { h: Math.floor(mins / 60), m: mins % 60 };
}

// 2h 5m · 12m · 40s (even a few seconds of watching is counted)
function fmtShort(sec) {
    const { h, m } = splitDur(sec);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m`;
    return sec >= 1 ? `${Math.round(sec)}s` : "0m";
}

// compact y-axis label: 45m · 1.5h · 2h
function fmtAxis(sec) {
    if (!sec) return "0";
    if (sec < 3600) return `${Math.round(sec / 60)}m`;
    const h = sec / 3600;
    return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}

function parseKey(key) {
    const [y, mo, d] = key.split("-").map(Number);
    return new Date(y, mo - 1, d);
}

const toKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

const fmtDay = (key) => parseKey(key).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const fmtTick = (key) => parseKey(key).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function niceCeil(sec) {
    const steps = [120, 300, 600, 900, 1800, 3600, 7200, 10800, 14400, 21600, 28800, 43200];
    return steps.find((s) => s >= sec) ?? Math.ceil(sec / 3600) * 3600;
}

const typeOf = (t) => (t.mediaType === "anime" ? "anime" : t.mediaType === "series" ? "series" : "movie");

// ─── motion ───────────────────────────────────────────────────────────────────
// Cards rise in with CSS (opacity + translate only). Charts and bars are driven by one rAF
// engine that uses the same easeOutQuart curve as the line chart, so everything moves alike.
const MOTION_CSS = `
@keyframes wt-fade{from{opacity:0}to{opacity:1}}
@keyframes wt-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@keyframes wt-pop{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
.wt-fade{animation:wt-fade .7s ease-out both;animation-delay:var(--d,0ms)}
.wt-pop{animation:wt-pop .18s ease-out both}
.wt-rise{animation:wt-rise .75s cubic-bezier(.16,1,.3,1) backwards;animation-delay:calc(var(--i,0) * 70ms)}
.wt-rise:nth-child(2){--i:1}.wt-rise:nth-child(3){--i:2}.wt-rise:nth-child(4){--i:3}.wt-rise:nth-child(5){--i:4}
[data-reveal]{will-change:clip-path}
@media (prefers-reduced-motion:reduce){.wt-fade,.wt-pop,.wt-rise{animation:none!important}}
`;

const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const prefersReducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// data-reveal = "y" (rise from bottom) | "x" (grow from left) | "fade" | "arc" (svg stroke sweep)
function applyReveal(el, p) {
    const kind = el.dataset.reveal;
    if (kind === "y") el.style.clipPath = p >= 1 ? "" : `inset(${(1 - p) * 100}% 0 0 0)`;
    else if (kind === "x") el.style.clipPath = p >= 1 ? "" : `inset(0 ${(1 - p) * 100}% 0 0)`;
    else if (kind === "fade") el.style.opacity = p >= 1 ? "" : String(p);
    else if (kind === "arc") el.setAttribute("stroke-dasharray", `${Number(el.dataset.len) * p} ${el.dataset.c}`);
}

function runReveal(els, { from = 0, dur = 1100, step = 0, maxStagger = 520 }) {
    if (!els.length) return () => {};
    if (prefersReducedMotion()) {
        els.forEach((el) => applyReveal(el, 1));
        return () => {};
    }
    els.forEach((el) => applyReveal(el, from));
    const delay = (el) => Math.min(maxStagger, Number(el.dataset.i || 0) * step);
    const total = Math.max(...els.map(delay), 0) + dur;
    let raf = 0;
    let t0 = null;
    const tick = (now) => {
        if (t0 == null) t0 = now;
        const ms = now - t0;
        for (const el of els) applyReveal(el, from + (1 - from) * easeOutQuart(clamp01((ms - delay(el)) / dur)));
        if (ms < total) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
}

// Entry animation for every [data-reveal] inside the ref'd element (re-runs when `sig` changes);
// hovering a [data-hover] group re-fills just that group from ~40% with the same easing.
function useReveal(sig) {
    const ref = useRef(null);
    const runs = useRef(new Map());
    const startedAt = useRef(0);
    useLayoutEffect(() => {
        const root = ref.current;
        if (!root) return undefined;
        const m = runs.current;
        startedAt.current = typeof performance !== "undefined" ? performance.now() : 0;
        m.get(root)?.();
        m.set(root, runReveal([...root.querySelectorAll("[data-reveal]")], { step: 45, dur: 1100 }));
        return () => {
            m.forEach((c) => c());
            m.clear();
        };
    }, [sig]);
    const onPointerOver = (e) => {
        const root = ref.current;
        const g = e.target?.closest?.("[data-hover]");
        if (!root || !g || !root.contains(g)) return;
        if (e.relatedTarget && g.contains(e.relatedTarget)) return;
        if (performance.now() - startedAt.current < 1300) return; // let the entry finish first
        const m = runs.current;
        m.get(g)?.();
        m.set(g, runReveal([...g.querySelectorAll("[data-reveal]")], { from: 0.4, dur: 700 }));
    };
    return [ref, onPointerOver];
}

// ─── layout primitives ────────────────────────────────────────────────────────
function Card({ children, className = "" }) {
    return <section className={`wt-rise min-w-0 rounded-lg border border-base-content/10 bg-base-200 shadow-sm ${className}`}>{children}</section>;
}

function CardHead({ title, sub, right }) {
    return (
        <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
                <h2 className="text-sm font-semibold tracking-tight text-base-content">{title}</h2>
                {sub && <p className="mt-0.5 text-xs text-base-content/70">{sub}</p>}
            </div>
            {right}
        </div>
    );
}

function Label({ children }) {
    return <p className="min-w-0 truncate text-xs font-medium text-base-content/70">{children}</p>;
}

function Segmented({ options, value, onChange }) {
    return (
        <div className="inline-flex rounded-lg border border-base-content/10 bg-base-100 p-0.5">
            {options.map((o) => (
                <button
                    key={o.value}
                    onClick={() => onChange(o.value)}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${value === o.value ? "bg-primary text-primary-content" : "text-base-content/80 hover:text-base-content"}`}>
                    {o.label}
                </button>
            ))}
        </div>
    );
}

function Delta({ pct }) {
    if (pct == null) return <span className="text-[11px] text-base-content/70">No earlier data</span>;
    if (Math.abs(pct) < 0.5)
        return (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-base-content/80">
                <Minus size={12} /> No change
            </span>
        );
    const up = pct > 0;
    return (
        <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${up ? "bg-success/15 text-success" : "bg-error/15 text-error"}`}>
            {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
            {Math.abs(Math.round(pct))}%
        </span>
    );
}

function Kpi({ icon: Icon, label, value, foot }) {
    return (
        <Card className="p-3.5 sm:p-4">
            <div className="flex items-center justify-between gap-2">
                <Label>{label}</Label>
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-base-content/5 text-base-content/70">
                    <Icon size={14} />
                </span>
            </div>
            <p className="mt-3 text-xl sm:text-2xl font-semibold tracking-tight text-base-content tabular-nums">{value}</p>
            <div className="mt-2 flex min-h-5 items-center text-xs text-base-content/70">{foot}</div>
        </Card>
    );
}

// ─── measuring ────────────────────────────────────────────────────────────────
function useElementWidth() {
    const ref = useRef(null);
    const [w, setW] = useState(0);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return undefined;
        const update = () => setW(Math.round(el.getBoundingClientRect().width));
        update();
        if (typeof ResizeObserver === "undefined") return undefined;
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    return [ref, w];
}

// ─── smooth area chart (responsive SVG) ───────────────────────────────────────
// Monotone cubic interpolation — smooth, and never dips below the baseline.
function monotonePath(pts) {
    const n = pts.length;
    if (n < 2) return "";
    if (n === 2) return `M${pts[0][0]},${pts[0][1]}L${pts[1][0]},${pts[1][1]}`;
    const dx = [];
    const m = [];
    for (let i = 0; i < n - 1; i++) {
        dx[i] = pts[i + 1][0] - pts[i][0];
        m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i];
    }
    const t = [m[0]];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
    t[n - 1] = m[n - 2];
    for (let i = 0; i < n - 1; i++) {
        if (m[i] === 0) {
            t[i] = 0;
            t[i + 1] = 0;
        } else {
            const a = t[i] / m[i];
            const b = t[i + 1] / m[i];
            const s = a * a + b * b;
            if (s > 9) {
                const tau = 3 / Math.sqrt(s);
                t[i] = tau * a * m[i];
                t[i + 1] = tau * b * m[i];
            }
        }
    }
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 0; i < n - 1; i++) {
        d += `C${pts[i][0] + dx[i] / 3},${pts[i][1] + (t[i] * dx[i]) / 3} ${pts[i + 1][0] - dx[i] / 3},${pts[i + 1][1] - (t[i + 1] * dx[i]) / 3} ${pts[i + 1][0]},${pts[i + 1][1]}`;
    }
    return d;
}

export function AreaChart({ data, prev, width, height, today }) {
    const gid = useId().replace(/:/g, "");
    const [hover, setHover] = useState(null);
    const [replay, setReplay] = useState(0);
    const clipRef = useRef(null);
    const lineRef = useRef(null);
    const dotRef = useRef(null);
    const n = data.length;
    const compact = width < 480;
    const M = { l: compact ? 34 : 44, r: compact ? 10 : 16, t: 12, b: 26 };
    const iw = Math.max(width - M.l - M.r, 10);
    const ih = height - M.t - M.b;
    const top = niceCeil(Math.max(1, ...data.map((d) => d.seconds), ...(prev ? prev.map((d) => d.seconds) : [0])));

    const x = (i) => M.l + (n <= 1 ? 0 : (i * iw) / (n - 1));
    const y = (v) => M.t + ih * (1 - v / top);
    const pts = data.map((d, i) => [x(i), y(d.seconds)]);
    const line = monotonePath(pts);
    const area = `${line}L${x(n - 1)},${M.t + ih}L${x(0)},${M.t + ih}Z`;
    const prevLine = prev ? monotonePath(prev.map((d, i) => [x(i), y(d.seconds)])) : null;

    // draw the line left → right; a clip rect reveals the area under it, a dot rides the tip
    const sig = `${replay}|${n}|${top}|${data[0]?.date}|${data[n - 1]?.date}`;
    useLayoutEffect(() => {
        const rect = clipRef.current;
        const path = lineRef.current;
        const dot = dotRef.current;
        if (!rect || !path) return undefined;
        let len = 0;
        try {
            len = path.getTotalLength();
        } catch {
            len = 0;
        }
        const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        const fullW = path.ownerSVGElement ? path.ownerSVGElement.getBoundingClientRect().width + 8 : 4000;
        if (reduce || len === 0) {
            rect.setAttribute("width", String(fullW));
            dot?.setAttribute("opacity", "0");
            return undefined;
        }
        const dur = sig.startsWith("0|") ? 1300 : 900;
        let raf = 0;
        let t0 = null;
        rect.setAttribute("width", "0");
        const step = (now) => {
            if (t0 == null) t0 = now;
            const t = Math.min(1, (now - t0) / dur);
            const e = 1 - Math.pow(1 - t, 4); // easeOutQuart
            const pt = path.getPointAtLength(len * e);
            rect.setAttribute("width", String(pt.x));
            if (dot) {
                dot.setAttribute("cx", String(pt.x));
                dot.setAttribute("cy", String(pt.y));
                dot.setAttribute("opacity", t < 1 ? "1" : "0");
            }
            if (t < 1) raf = requestAnimationFrame(step);
            else rect.setAttribute("width", String(fullW));
        };
        raf = requestAnimationFrame(step);
        return () => cancelAnimationFrame(raf);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sig]);

    // x labels: only as many as comfortably fit — keeps mobile tidy
    const count = Math.max(2, Math.min(n, Math.floor(iw / 96)));
    const xTicks = Array.from({ length: count }, (_, k) => Math.round((k * (n - 1)) / (count - 1)));

    function onMove(e) {
        const rect = e.currentTarget.getBoundingClientRect();
        const px = e.clientX - rect.left;
        setHover(Math.min(n - 1, Math.max(0, Math.round(((px - M.l) / iw) * (n - 1)))));
    }

    const h = hover != null ? data[hover] : null;
    const tipLeft = hover != null ? Math.min(Math.max(x(hover), 68), width - 68) : 0;

    return (
        <div className="relative select-none" style={{ width, height }} onPointerEnter={() => setReplay((r) => r + 1)}>
            <svg width={width} height={height} className="block overflow-visible" role="img" aria-label="Daily watch time chart">
                <defs>
                    <linearGradient id={`g${gid}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.38" />
                        <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0.02" />
                    </linearGradient>
                    <clipPath id={`c${gid}`}>
                        <rect ref={clipRef} x="0" y="-8" width={width + 8} height={height + 16} />
                    </clipPath>
                </defs>

                {[0, 1 / 3, 2 / 3, 1].map((f) => (
                    <g key={f}>
                        <line
                            x1={M.l}
                            x2={M.l + iw}
                            y1={y(top * f)}
                            y2={y(top * f)}
                            className="stroke-base-content"
                            strokeOpacity={f === 0 ? 0.25 : 0.12}
                            strokeDasharray={f === 0 ? undefined : "3 4"}
                        />
                        <text x={M.l - 8} y={y(top * f) + 3.5} textAnchor="end" className="fill-base-content/75" fontSize="10.5">
                            {fmtAxis(top * f)}
                        </text>
                    </g>
                ))}

                {prevLine && <path d={prevLine} fill="none" className="stroke-base-content" strokeOpacity="0.45" strokeWidth="1.5" strokeDasharray="4 4" />}
                <g clipPath={`url(#c${gid})`}>
                    <path d={area} fill={`url(#g${gid})`} />
                    <path ref={lineRef} d={line} fill="none" className="stroke-primary" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                </g>
                <circle
                    ref={dotRef}
                    r="4.5"
                    opacity="0"
                    pointerEvents="none"
                    className="fill-primary stroke-base-200"
                    strokeWidth="2"
                    style={{ filter: "drop-shadow(0 0 6px var(--color-primary))" }}
                />

                {data[n - 1]?.date === today && (
                    <circle key={`dot-${replay}-${n}`} cx={x(n - 1)} cy={y(data[n - 1].seconds)} r="3.5" className="wt-fade fill-primary stroke-base-200" strokeWidth="2" style={{ "--d": "1300ms" }} />
                )}

                {xTicks.map((i, k) => (
                    <text key={i} x={x(i)} y={height - 7} textAnchor={k === 0 ? "start" : k === xTicks.length - 1 ? "end" : "middle"} className="fill-base-content/75" fontSize="10.5">
                        {fmtTick(data[i].date)}
                    </text>
                ))}

                {hover != null && (
                    <g pointerEvents="none">
                        <line x1={x(hover)} x2={x(hover)} y1={M.t} y2={M.t + ih} className="stroke-base-content" strokeOpacity="0.35" />
                        <circle cx={x(hover)} cy={y(h.seconds)} r="4" className="fill-primary stroke-base-200" strokeWidth="2" />
                    </g>
                )}

                <rect
                    x={M.l}
                    y={0}
                    width={iw}
                    height={height}
                    fill="transparent"
                    style={{ touchAction: "pan-y" }}
                    onPointerMove={onMove}
                    onPointerDown={onMove}
                    onPointerLeave={() => setHover(null)}
                />
            </svg>

            {h && (
                <div
                    className="wt-pop pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg border border-base-content/15 bg-base-100 px-2.5 py-1.5 text-xs shadow-xl"
                    style={{ left: tipLeft }}>
                    <p className="font-semibold text-base-content">{fmtDay(h.date)}</p>
                    <p className="text-base-content/85 tabular-nums">
                        {h.seconds > 0 ? fmtShort(h.seconds) : "No activity"}
                        {h.completed > 0 && <span className="text-primary"> · {h.completed} finished</span>}
                    </p>
                    {prev?.[hover] && <p className="text-base-content/65 tabular-nums">Previous: {prev[hover].seconds > 0 ? fmtShort(prev[hover].seconds) : "—"}</p>}
                </div>
            )}
        </div>
    );
}

function ChartBox({ data, prev, today }) {
    const [ref, w] = useElementWidth();
    return (
        <div ref={ref} className="w-full">
            {w > 0 && <AreaChart data={data} prev={prev} width={w} height={w < 520 ? 196 : 260} today={today} />}
        </div>
    );
}

// ─── content split (donut) ────────────────────────────────────────────────────
const SPLIT = [
    { key: "movie", label: "Movies", cls: "stroke-primary", dot: "bg-primary" },
    { key: "series", label: "Series", cls: "stroke-accent", dot: "bg-accent" },
    { key: "anime", label: "Anime", cls: "stroke-secondary", dot: "bg-secondary" },
];

function SplitCard({ byType }) {
    const total = SPLIT.reduce((a, s) => a + (byType[s.key] || 0), 0);
    const [ref, onPointerOver] = useReveal(`split|${total}`);
    const R = 52;
    const C = 2 * Math.PI * R;
    let acc = 0;
    return (
        <Card className="flex flex-col p-4 sm:p-5">
            <CardHead title="Content split" sub="All-time watch time by type" />
            <div ref={ref} onPointerOver={onPointerOver} className="mt-4 flex flex-1 flex-col items-center justify-center gap-6">
                <div data-hover className="relative shrink-0">
                    <svg viewBox="0 0 140 140" className="h-36 w-36 -rotate-90">
                        <circle cx="70" cy="70" r={R} fill="none" strokeWidth="14" className="stroke-base-300" />
                        {total > 0 &&
                            SPLIT.map((s, idx) => {
                                const frac = (byType[s.key] || 0) / total;
                                if (frac <= 0) return null;
                                const len = frac * C;
                                const seg = Math.max(len - 2, 0);
                                const el = (
                                    <circle
                                        key={s.key}
                                        data-reveal="arc"
                                        data-len={seg}
                                        data-c={C}
                                        data-i={idx * 3}
                                        cx="70"
                                        cy="70"
                                        r={R}
                                        fill="none"
                                        strokeWidth="14"
                                        className={s.cls}
                                        strokeDasharray={`${seg} ${C}`}
                                        strokeDashoffset={-acc}
                                    />
                                );
                                acc += len;
                                return el;
                            })}
                    </svg>
                    <div className="absolute inset-0 grid place-items-center text-center">
                        <div>
                            <p className="text-lg font-bold tabular-nums text-base-content">{total > 0 ? fmtShort(total) : "—"}</p>
                            <p className="text-[11px] text-base-content/70">Total</p>
                        </div>
                    </div>
                </div>
                <ul className="w-full space-y-3">
                    {SPLIT.map((s, idx) => {
                        const v = byType[s.key] || 0;
                        const pct = total > 0 ? (v / total) * 100 : 0;
                        return (
                            <li key={s.key} data-hover>
                                <div className="flex items-center gap-2 text-xs">
                                    <span className={`h-2.5 w-2.5 rounded-sm ${s.dot}`} />
                                    <span className="text-base-content/90">{s.label}</span>
                                    <span className="ml-auto tabular-nums font-semibold text-base-content">{fmtShort(v)}</span>
                                    <span className="w-9 text-right tabular-nums text-base-content/70">{Math.round(pct)}%</span>
                                </div>
                                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-base-300">
                                    <div data-reveal="x" data-i={idx + 1} className={`h-full rounded-full ${s.dot}`} style={{ width: `${pct}%` }} />
                                </div>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </Card>
    );
}

// ─── insights: time of day / weekday / heatmap ────────────────────────────────
// Bar areas are `flex-1` + absolutely-filled, so they stretch to the row height —
// no empty band under a card when its neighbour is taller.
function HoursCard({ hours }) {
    const max = Math.max(...hours, 0);
    const peak = max > 0 ? hours.indexOf(max) : -1;
    const hourLabel = (h) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;
    const [ref, onPointerOver] = useReveal(`hours|${hours.join(",")}`);
    return (
        <Card className="flex flex-col p-4 sm:p-5">
            <CardHead title="Time of day" sub={peak >= 0 ? `Peak hour: ${hourLabel(peak)} · ${fmtShort(max)}` : "Builds up as you watch"} />
            <div className="relative mt-4 min-h-24 flex-1">
                <div ref={ref} onPointerOver={onPointerOver} className="absolute inset-0 flex items-end gap-0.5">
                    {hours.map((v, h) => (
                        <div key={h} data-hover className="group flex h-full flex-1 items-end" title={`${hourLabel(h)} — ${fmtShort(v)}`}>
                            <div
                                data-reveal="y"
                                data-i={h}
                                className={`w-full rounded-t-[2px] ${h === peak ? "bg-primary" : "bg-primary/45 group-hover:bg-primary/80"}`}
                                style={{ height: v > 0 ? `${Math.max((v / max) * 100, 4)}%` : "2px", opacity: v > 0 ? 1 : 0.25 }}
                            />
                        </div>
                    ))}
                </div>
            </div>
            <div className="mt-2 flex justify-between text-[10.5px] text-base-content/75">
                {["12a", "6a", "12p", "6p", "11p"].map((l) => (
                    <span key={l}>{l}</span>
                ))}
            </div>
        </Card>
    );
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function WeekdayCard({ series }) {
    const { avg, best } = useMemo(() => {
        const sum = Array(7).fill(0);
        const cnt = Array(7).fill(0);
        for (const d of series) {
            const wd = (parseKey(d.date).getDay() + 6) % 7;
            sum[wd] += d.seconds;
            cnt[wd]++;
        }
        const a = sum.map((s, i) => (cnt[i] ? s / cnt[i] : 0));
        const m = Math.max(...a, 0);
        return { avg: a, best: m > 0 ? a.indexOf(m) : -1 };
    }, [series]);
    const max = Math.max(...avg, 1);
    const [ref, onPointerOver] = useReveal(`weekday|${avg.map(Math.round).join(",")}`);
    return (
        <Card className="flex flex-col p-4 sm:p-5">
            <CardHead title="Weekday pattern" sub={best >= 0 ? `Most active: ${DAYS[best]} · avg ${fmtShort(avg[best])}` : "Builds up as you watch"} />
            <div className="relative mt-4 min-h-24 flex-1">
                <div ref={ref} onPointerOver={onPointerOver} className="absolute inset-0 flex items-end gap-2">
                    {avg.map((v, i) => (
                        <div key={i} data-hover className="flex h-full flex-1 items-end justify-center" title={`${DAYS[i]} — avg ${fmtShort(v)}`}>
                            <div
                                data-reveal="y"
                                data-i={i * 1.5}
                                className={`w-2 rounded-full sm:w-2.5 ${i === best ? "bg-primary" : "bg-primary/45"}`}
                                style={{ height: v > 0 ? `${Math.max((v / max) * 100, 5)}%` : "3px", opacity: v > 0 ? 1 : 0.3 }}
                            />
                        </div>
                    ))}
                </div>
            </div>
            <div className="mt-2 flex gap-2 text-[10.5px] text-base-content/75">
                {DAYS.map((d) => (
                    <span key={d} className="flex-1 text-center">
                        {d[0]}
                    </span>
                ))}
            </div>
        </Card>
    );
}

const HEAT = ["bg-base-content/10", "bg-primary/25", "bg-primary/45", "bg-primary/70", "bg-primary"];
const CELL = 10; // px — small squares
const GAP = 3;
const MAX_WEEKS = 53;

function HeatmapCard({ series }) {
    const [ref, w] = useElementWidth();
    const labelW = 16;
    // as many week-columns as fit the card at the small cell size → graph always fills the width
    const cols = w > 0 ? Math.max(8, Math.min(MAX_WEEKS, Math.floor((w - labelW - 8 + GAP) / (CELL + GAP)))) : 0;

    const { cells, months, activeCount } = useMemo(() => {
        if (!cols || !series.length) return { cells: [], months: [], activeCount: 0 };
        const byDate = new Map(series.map((s) => [s.date, s]));
        const max = Math.max(...series.map((s) => s.seconds), 1);
        const lvl = (s) => (!s || (s.seconds <= 0 && s.completed <= 0) ? 0 : s.seconds <= 0 ? 1 : Math.min(4, Math.max(1, Math.ceil((s.seconds / max) * 4))));
        const end = parseKey(series[series.length - 1].date);
        const row = (end.getDay() + 6) % 7; // Monday-first rows
        const total = cols * 7;
        const lastSlot = total - 1 - (6 - row);
        const start = addDays(end, -lastSlot);
        const out = [];
        let active = 0;
        for (let i = 0; i < total; i++) {
            if (i > lastSlot) {
                out.push(null);
                continue;
            }
            const d = addDays(start, i);
            const key = toKey(d);
            const s = byDate.get(key);
            const l = lvl(s);
            if (l > 0) active++;
            out.push({ date: key, seconds: s?.seconds || 0, completed: s?.completed || 0, lvl: l });
        }
        // month markers on the first week-column where a new month begins
        const mk = [];
        let lastM = -1;
        for (let c = 0; c < cols; c++) {
            const cell = out.slice(c * 7, c * 7 + 7).find(Boolean);
            if (!cell) continue;
            const m = parseKey(cell.date).getMonth();
            if (m !== lastM) {
                if (lastM !== -1 || c < cols - 3) mk.push({ c, label: parseKey(cell.date).toLocaleDateString(undefined, { month: "short" }) });
                lastM = m;
            }
        }
        // drop a marker that would collide with the next one (labels need ~3 columns)
        const spaced = mk.filter((m, i) => i === mk.length - 1 || mk[i + 1].c - m.c >= 3);
        return { cells: out, months: spaced, activeCount: active };
    }, [series, cols]);

    const [revealRef] = useReveal(`heat|${cols}|${cells.length}|${activeCount}`);
    return (
        <Card className="flex flex-col p-4 sm:p-5 md:col-span-2 lg:col-span-1">
            <CardHead title="Activity" sub={cols ? `${activeCount} active days · last ${cols} weeks` : "Daily activity"} />
            <div ref={ref} className="mt-4 flex flex-1 items-center">
                {cols > 0 && (
                    <div ref={revealRef} className="w-full">
                        <div className="relative h-4" style={{ marginLeft: labelW + 8 }}>
                            {months.map((m) => (
                                <span key={m.c} className="absolute text-[10.5px] text-base-content/70" style={{ left: m.c * (CELL + GAP) }}>
                                    {m.label}
                                </span>
                            ))}
                        </div>
                        <div className="flex" style={{ gap: 8 }}>
                            <div className="grid text-[9px] leading-none text-base-content/70" style={{ width: labelW, gridTemplateRows: `repeat(7, ${CELL}px)`, rowGap: GAP }}>
                                {["M", "", "W", "", "F", "", ""].map((l, i) => (
                                    <span key={i} className="flex items-center">
                                        {l}
                                    </span>
                                ))}
                            </div>
                            <div className="grid" style={{ gridAutoFlow: "column", gridTemplateRows: `repeat(7, ${CELL}px)`, gridAutoColumns: `${CELL}px`, gap: GAP }}>
                                {cells.map((c, i) =>
                                    c ? (
                                        <div
                                            key={c.date}
                                            title={`${fmtDay(c.date)} — ${c.seconds > 0 ? fmtShort(c.seconds) : "no activity"}${c.completed ? ` · ${c.completed} finished` : ""}`}
                                            data-reveal="fade"
                                            data-i={(Math.floor(i / 7) * 0.25).toFixed(2)}
                                            className={`rounded-[2px] ${HEAT[c.lvl]}`}
                                        />
                                    ) : (
                                        <div key={`pad-${i}`} />
                                    ),
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
            <div className="mt-3 flex items-center justify-end gap-1.5 text-[10.5px] text-base-content/70">
                <span>Less</span>
                {HEAT.map((cls, i) => (
                    <span key={i} className={`h-2.5 w-2.5 rounded-[2px] ${cls}`} />
                ))}
                <span>More</span>
            </div>
        </Card>
    );
}

// ─── weekly helpers (Monday-first weeks, anchored to the latest day in the series) ─
function weeklyTotals(series, weeks) {
    if (!series.length) return [];
    const byDate = new Map(series.map((d) => [d.date, d.seconds]));
    const end = parseKey(series[series.length - 1].date);
    const row = (end.getDay() + 6) % 7;
    const curStart = addDays(end, -row);
    return Array.from({ length: weeks }, (_, w) => {
        const start = addDays(curStart, -7 * (weeks - 1 - w));
        let sec = 0;
        for (let i = 0; i < 7; i++) sec += byDate.get(toKey(addDays(start, i))) || 0;
        return { start: toKey(start), seconds: sec, current: w === weeks - 1 };
    });
}

// ─── weekly trend (bar count adapts to card width) ────────────────────────────
function WeeklyTrendCard({ series }) {
    const [mRef, w] = useElementWidth();
    const count = w === 0 ? 8 : w < 330 ? 5 : w < 460 ? 6 : 8;
    const weeks = useMemo(() => weeklyTotals(series, count), [series, count]);
    const [ref, onPointerOver] = useReveal(`weeks|${count}|${weeks.map((x) => Math.round(x.seconds)).join(",")}`);
    const max = Math.max(...weeks.map((x) => x.seconds), 1);
    const full = weeks.filter((x) => !x.current);
    const avg = full.length ? sumSec(full) / full.length : 0;
    const last = full[full.length - 1]?.seconds;
    const before = full[full.length - 2]?.seconds;

    return (
        <Card className="flex flex-col p-4 sm:p-5 md:col-span-3 lg:col-span-2">
            <CardHead title="Weekly trend" sub={`Last ${count} weeks · avg ${fmtShort(avg)} per full week`} right={before != null && last != null ? <Delta pct={pctChange(last, before)} /> : null} />
            <div ref={mRef} className="relative mt-4 min-h-36 flex-1 sm:min-h-44">
                <div ref={ref} onPointerOver={onPointerOver} className="absolute inset-0 flex gap-1.5 sm:gap-3">
                    {weeks.map((x, wi) => {
                        const p = x.seconds > 0 ? Math.max((x.seconds / max) * 84, 3) : 0;
                        return (
                            <div
                                key={x.start}
                                data-hover
                                className="relative flex-1"
                                title={`Week of ${fmtDay(x.start)} — ${x.seconds > 0 ? fmtShort(x.seconds) : "no activity"}${x.current ? " (in progress)" : ""}`}>
                                <div className="absolute inset-x-0 bottom-0 border-b border-base-content/20" />
                                <span
                                    data-reveal="fade"
                                    data-i={wi + 4}
                                    className="absolute inset-x-0 text-center text-[10.5px] font-medium tabular-nums text-base-content/80"
                                    style={{ bottom: `calc(${p}% + 4px)` }}>
                                    {x.seconds > 0 ? fmtAxis(x.seconds) : ""}
                                </span>
                                <div className="absolute inset-x-0 bottom-0 flex justify-center" style={{ height: `${p}%` }}>
                                    <div data-reveal="y" data-i={wi} className={`h-full w-2 rounded-t-[3px] sm:w-2.5 ${x.current ? "bg-primary" : "bg-primary/45"}`} />
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
            <div className="mt-2 flex gap-1.5 text-[10px] text-base-content/70 sm:gap-3 sm:text-[10.5px]">
                {weeks.map((x) => (
                    <span key={x.start} className={`flex-1 truncate text-center ${x.current ? "font-semibold text-base-content" : ""}`}>
                        {x.current ? "This wk" : fmtTick(x.start)}
                    </span>
                ))}
            </div>
        </Card>
    );
}

// ─── viewing habits: when you watch (day parts) + weekday vs weekend ──────────
const DAY_PARTS = [
    { key: "morning", label: "Morning", range: "5 AM – 12 PM", hours: [5, 6, 7, 8, 9, 10, 11], icon: Sunrise },
    { key: "afternoon", label: "Afternoon", range: "12 – 5 PM", hours: [12, 13, 14, 15, 16], icon: Sun },
    { key: "evening", label: "Evening", range: "5 – 10 PM", hours: [17, 18, 19, 20, 21], icon: Sunset },
    { key: "night", label: "Night", range: "10 PM – 5 AM", hours: [22, 23, 0, 1, 2, 3, 4], icon: Moon },
];

function ViewingHabitsCard({ hours, series }) {
    const parts = DAY_PARTS.map((d) => ({ ...d, sec: d.hours.reduce((a, h) => a + (hours[h] || 0), 0) }));
    const total = parts.reduce((a, d) => a + d.sec, 0);
    const top = total > 0 ? parts.reduce((a, d) => (d.sec > a.sec ? d : a), parts[0]).key : null;
    const [ref, onPointerOver] = useReveal(`habits|${parts.map((d) => Math.round(d.sec)).join(",")}`);

    const { wd, we } = useMemo(() => {
        let wdS = 0;
        let wdN = 0;
        let weS = 0;
        let weN = 0;
        for (const d of series) {
            const dow = parseKey(d.date).getDay();
            if (dow === 0 || dow === 6) {
                weS += d.seconds;
                weN++;
            } else {
                wdS += d.seconds;
                wdN++;
            }
        }
        return { wd: wdN ? wdS / wdN : 0, we: weN ? weS / weN : 0 };
    }, [series]);

    return (
        <Card className="flex flex-col p-4 sm:p-5 md:col-span-2 lg:col-span-1">
            <CardHead title="Viewing habits" sub={top ? `Most watched in the ${DAY_PARTS.find((d) => d.key === top).label.toLowerCase()}` : "Builds up as you watch"} />
            <ul ref={ref} onPointerOver={onPointerOver} className="mt-4 flex-1 space-y-3.5">
                {parts.map((d, i) => {
                    const pct = total > 0 ? (d.sec / total) * 100 : 0;
                    return (
                        <li key={d.key} data-hover className="flex items-start gap-3">
                            <d.icon size={15} className="mt-0.5 shrink-0 text-base-content/60" />
                            <div className="min-w-0 flex-1">
                                <div className="flex items-baseline justify-between gap-2 text-xs">
                                    <p className="truncate font-medium text-base-content">
                                        {d.label} <span className="font-normal text-base-content/60">{d.range}</span>
                                    </p>
                                    <span className="shrink-0 tabular-nums text-base-content/70">
                                        <span className="font-semibold text-base-content">{Math.round(pct)}%</span> · {fmtShort(d.sec)}
                                    </span>
                                </div>
                                <div className="mt-1.5 h-1.5 overflow-hidden rounded-sm bg-base-content/10">
                                    <div data-reveal="x" data-i={i} className={`h-full ${d.key === top ? "bg-primary" : "bg-primary/50"}`} style={{ width: `${pct}%` }} />
                                </div>
                            </div>
                        </li>
                    );
                })}
            </ul>
            <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-base-content/10 pt-4">
                <div>
                    <dt className="text-xs text-base-content/70">Weekday average</dt>
                    <dd className="mt-1 text-base font-semibold tabular-nums text-base-content">{wd > 0 ? fmtShort(wd) : "—"}</dd>
                </div>
                <div>
                    <dt className="text-xs text-base-content/70">Weekend average</dt>
                    <dd className="mt-1 flex items-center gap-2 text-base font-semibold tabular-nums text-base-content">
                        {we > 0 ? fmtShort(we) : "—"}
                        {wd > 0 && we > 0 && <Delta pct={pctChange(we, wd)} />}
                    </dd>
                </div>
            </dl>
        </Card>
    );
}

// ─── most watched: ranked poster cards (episodes grouped per series) ──────────
function RankCard({ g, rank, totalSeconds }) {
    const navigate = useNavigate();
    const [imgError, setImgError] = useState(false);
    const isSeries = g.type !== "movie";
    const [badgeLabel, badgeCls] = TYPE_BADGE[g.type];
    const share = totalSeconds > 0 ? Math.round((g.seconds / totalSeconds) * 100) : 0;
    const target = isSeries ? `/player/${encodeURIComponent(g.targetId)}` : `/media/${encodeURIComponent(g.targetId)}`;

    return (
        <div onClick={() => navigate(target)} className="group relative my-2 w-full min-w-0 cursor-pointer select-none">
            <div className="relative aspect-2/3 w-full overflow-hidden rounded-xl bg-base-300 shadow-lg ring-1 ring-white/5 transition-transform duration-200 group-hover:scale-[1.03] group-hover:shadow-2xl group-hover:ring-white/20">
                {g.poster && !imgError ? (
                    <img src={g.poster} alt={g.name} className="h-full w-full object-cover" onError={() => setImgError(true)} loading="lazy" draggable={false} />
                ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-linear-to-br from-base-300 to-base-200">
                        {isSeries ? <Tv size={30} className="text-base-content/50" /> : <Film size={30} className="text-base-content/50" />}
                        <span className="line-clamp-3 px-3 text-center text-xs font-semibold leading-tight text-base-content/80">{g.name}</span>
                    </div>
                )}
                <div className="absolute left-2 top-2">
                    <span className="rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white backdrop-blur-sm">#{rank}</span>
                </div>
                <div className="absolute right-2 top-2">
                    <span className={`rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${badgeCls}`}>{badgeLabel}</span>
                </div>
                <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-linear-to-t from-black/90 via-black/60 to-transparent px-2.5 pb-2.5 pt-10">
                    <div className="min-w-0">
                        <p className="text-[10px] font-medium text-white/60">Watch time</p>
                        <p className="mt-0.5 truncate text-sm font-semibold leading-none tabular-nums text-white">{fmtShort(g.seconds)}</p>
                    </div>
                    <div className="shrink-0 text-right">
                        <p className="text-[10px] font-medium text-white/60">Share</p>
                        <p className="mt-0.5 text-sm font-semibold leading-none tabular-nums text-white">{share}%</p>
                    </div>
                </div>
            </div>
            <div className="mt-2 px-0.5">
                <p className="truncate text-[13px] font-medium leading-tight text-base-content" title={g.name}>
                    {g.name}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-base-content/80">{isSeries ? `${g.items} ${g.items === 1 ? "episode" : "episodes"} watched` : "Movie"}</p>
            </div>
        </div>
    );
}

// ─── shared: top titles (episodes grouped per series) ─────────────────────────
// One calculation feeds both "Most watched" and "Your watching".
function topTitles(titles, n) {
    const map = new Map();
    for (const t of titles) {
        const type = typeOf(t);
        const grouped = type !== "movie" && t.seriesTitle;
        const key = grouped ? `s:${t.seriesTitle}` : `m:${t.id}`;
        const g = map.get(key) || { key, name: grouped ? t.seriesTitle : t.title || "Unknown", type, poster: t.poster, targetId: t.id, bestSec: -1, seconds: 0, items: 0 };
        g.seconds += t.watchedSeconds || 0;
        g.items += 1;
        if (!g.poster && t.poster) g.poster = t.poster;
        if ((t.watchedSeconds || 0) > g.bestSec) {
            g.bestSec = t.watchedSeconds || 0;
            g.targetId = t.id;
        }
        map.set(key, g);
    }
    return [...map.values()]
        .filter((g) => g.seconds > 0)
        .sort((a, b) => b.seconds - a.seconds)
        .slice(0, n);
}

function MostWatchedSection({ titles, totalSeconds }) {
    const top = useMemo(() => topTitles(titles, 5), [titles]);

    if (top.length === 0) return null;
    return (
        <section className="mt-6 sm:mt-8">
            <h2 className="text-base font-semibold tracking-tight text-base-content sm:text-lg">Most watched</h2>
            <p className="mt-0.5 text-xs text-base-content/75">Ranked by total time spent · episodes are grouped by series.</p>
            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] sm:gap-x-4">
                {top.map((g, i) => (
                    <RankCard key={g.key} g={g} rank={i + 1} totalSeconds={totalSeconds} />
                ))}
            </div>
        </section>
    );
}

// ─── viewing log ──────────────────────────────────────────────────────────────
const STATUS = [
    { id: "all", label: "All" },
    { id: "finished", label: "Finished" },
    { id: "progress", label: "In progress" },
];

// Poster card for this page — same look as MediaCard (poster, ring, hover lift, badges,
// title row), but built around activity: finished/in-progress state, watch time, replay count.
const TYPE_BADGE = {
    movie: ["Movie", "bg-primary/90 text-primary-content"],
    series: ["Series", "bg-accent/90 text-accent-content"],
    anime: ["Anime", "bg-secondary/90 text-secondary-content"],
};

function ProgressRing({ pct, size = 30 }) {
    const r = (size - 4) / 2;
    const c = 2 * Math.PI * r;
    return (
        <div className="relative shrink-0" style={{ width: size, height: size }} title={`${Math.round(pct)}% watched`} aria-label={`${Math.round(pct)}% watched`}>
            <svg width={size} height={size} className="-rotate-90">
                <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="2.5" stroke="rgba(255,255,255,0.25)" />
                <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="2.5" strokeLinecap="round" className="stroke-primary" strokeDasharray={`${(pct / 100) * c} ${c}`} />
            </svg>
            <span className="absolute inset-0 grid place-items-center text-[9px] font-semibold tabular-nums text-white">{Math.round(pct)}</span>
        </div>
    );
}

function ActivityCard({ t }) {
    const navigate = useNavigate();
    const [imgError, setImgError] = useState(false);
    const type = typeOf(t);
    const isSeries = type !== "movie";
    const finished = t.watchCount > 0;
    const pct = finished ? 100 : t.duration > 0 ? Math.min(100, (t.watchedSeconds / t.duration) * 100) : 0;
    const ep = isSeries ? [t.seasonNumber != null ? `S${t.seasonNumber}` : null, t.episodeNumber != null ? `E${t.episodeNumber}` : null].filter(Boolean).join(" ") : "";
    const sub = [ep, isSeries ? t.seriesTitle : null].filter(Boolean).join(" · ");
    const title = t.title || "Unknown";
    const [badgeLabel, badgeCls] = TYPE_BADGE[type];
    const target = isSeries ? `/player/${encodeURIComponent(t.id)}` : `/media/${encodeURIComponent(t.id)}`;

    return (
        <div onClick={() => navigate(target)} className="group relative my-2 w-full min-w-0 cursor-pointer select-none">
            <div className="relative aspect-2/3 w-full overflow-hidden rounded-xl bg-base-300 shadow-lg ring-1 ring-white/5 transition-transform duration-200 group-hover:scale-[1.03] group-hover:shadow-2xl group-hover:ring-white/20">
                {t.poster && !imgError ? (
                    <img src={t.poster} alt={title} className="h-full w-full object-cover" onError={() => setImgError(true)} loading="lazy" draggable={false} />
                ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-linear-to-br from-base-300 to-base-200">
                        {isSeries ? <Tv size={30} className="text-base-content/50" /> : <Film size={30} className="text-base-content/50" />}
                        <span className="line-clamp-3 px-3 text-center text-xs font-semibold leading-tight text-base-content/80">{title}</span>
                    </div>
                )}

                <div className="absolute left-2 top-2">
                    <span className={`rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${badgeCls}`}>{badgeLabel}</span>
                </div>
                {finished && (
                    <div className="absolute right-2 top-2" title={`Completed ${t.watchCount} ${t.watchCount === 1 ? "time" : "times"}`}>
                        <span className="inline-flex items-center gap-1 rounded-full bg-black/75 px-2 py-0.5 text-[10px] font-bold tabular-nums text-white ring-1 ring-primary/70 backdrop-blur-sm">
                            <Repeat2 size={11} className="text-primary" strokeWidth={2.5} />×{t.watchCount}
                        </span>
                    </div>
                )}

                {/* stats — bottom of card */}
                <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-linear-to-t from-black/90 via-black/60 to-transparent px-2.5 pb-2.5 pt-10">
                    <div className="min-w-0">
                        <p className="text-[10px] font-medium text-white/60">Watch time</p>
                        <p className="mt-0.5 truncate text-sm font-semibold leading-none tabular-nums text-white">{fmtShort(t.watchedSeconds)}</p>
                    </div>
                    {finished ? <CheckCircle2 size={22} strokeWidth={2} className="shrink-0 text-success" aria-label="Completed" /> : <ProgressRing pct={pct} />}
                </div>
            </div>

            <div className="mt-2 px-0.5">
                <p className="truncate text-[13px] font-medium leading-tight text-base-content" title={title}>
                    {title}
                </p>
                {sub && <p className="mt-0.5 truncate text-[11px] text-base-content/80">{sub}</p>}
            </div>
        </div>
    );
}

const selectCls = "select select-sm w-full sm:w-auto border-base-content/15 bg-base-200 text-xs text-base-content";

function ViewingLog({ titles }) {
    const [status, setStatus] = useState("all");
    const [type, setType] = useState("all");
    const [sort, setSort] = useState("recent");

    const counts = useMemo(
        () => ({
            all: titles.length,
            finished: titles.filter((t) => t.watchCount > 0).length,
            progress: titles.filter((t) => t.watchCount === 0).length,
        }),
        [titles],
    );

    const list = useMemo(() => {
        const out = titles.filter((t) => (status === "all" || (status === "finished" ? t.watchCount > 0 : t.watchCount === 0)) && (type === "all" || typeOf(t) === type));
        if (sort === "time") out.sort((a, b) => b.watchedSeconds - a.watchedSeconds);
        else if (sort === "finishes") out.sort((a, b) => b.watchCount - a.watchCount || b.watchedSeconds - a.watchedSeconds);
        else if (sort === "az") out.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
        return out;
    }, [titles, status, type, sort]);

    return (
        <section className="mt-6 sm:mt-8">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h2 className="text-base sm:text-lg font-semibold tracking-tight text-base-content">Viewing log</h2>
                    <p className="mt-0.5 text-xs text-base-content/75">Complete record of watched titles, with completion status and time spent.</p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:flex">
                    <select value={type} onChange={(e) => setType(e.target.value)} className={selectCls} aria-label="Filter by type">
                        <option value="all">All types</option>
                        <option value="movie">Movies</option>
                        <option value="series">Series</option>
                        <option value="anime">Anime</option>
                    </select>
                    <select value={sort} onChange={(e) => setSort(e.target.value)} className={selectCls} aria-label="Sort">
                        <option value="recent">Recently watched</option>
                        <option value="time">Most time spent</option>
                        <option value="finishes">Most finishes</option>
                        <option value="az">A → Z</option>
                    </select>
                </div>
            </div>

            <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
                {STATUS.map((s) => (
                    <button
                        key={s.id}
                        onClick={() => setStatus(s.id)}
                        className={`shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                            status === s.id ? "border-primary bg-primary text-primary-content" : "border-base-content/15 bg-base-200 text-base-content/85 hover:text-base-content"
                        }`}>
                        {s.label}
                        <span className={`ml-1.5 tabular-nums ${status === s.id ? "text-primary-content/80" : "text-base-content/65"}`}>{counts[s.id]}</span>
                    </button>
                ))}
            </div>

            {list.length === 0 ? (
                <Card className="mt-3">
                    <div className="px-6 py-12 text-center">
                        <Film size={26} className="mx-auto text-base-content/50" />
                        <p className="mt-3 text-sm font-semibold text-base-content">{titles.length === 0 ? "Nothing watched yet" : "No titles match these filters"}</p>
                        <p className="mt-1 text-xs text-base-content/75">{titles.length === 0 ? "Playback time is recorded automatically once you start watching." : "Try a different filter."}</p>
                    </div>
                </Card>
            ) : (
                <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] sm:gap-x-4">
                    {list.map((t) => (
                        <ActivityCard key={t.id} t={t} />
                    ))}
                </div>
            )}
        </section>
    );
}

// ─── states ───────────────────────────────────────────────────────────────────
function PageSkeleton() {
    return (
        <div className="animate-pulse space-y-3 sm:space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 sm:gap-4">
                {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-28 rounded-lg bg-base-200" />
                ))}
            </div>
            <div className="grid gap-3 lg:grid-cols-3 sm:gap-4">
                <div className="h-64 rounded-lg bg-base-200 sm:h-80 lg:col-span-2" />
                <div className="h-64 rounded-lg bg-base-200 sm:h-80" />
            </div>
            <div className="h-48 rounded-lg bg-base-200" />
        </div>
    );
}

function Notice({ icon: Icon, title, text, action }) {
    return (
        <Card>
            <div className="px-6 py-16 text-center">
                <Icon size={28} className="mx-auto text-base-content/50" />
                <p className="mt-3 text-sm font-semibold text-base-content">{title}</p>
                {text && <p className="mt-1 text-xs text-base-content/75">{text}</p>}
                {action}
            </div>
        </Card>
    );
}

// ─── page ─────────────────────────────────────────────────────────────────────
const RANGES = [
    { value: 7, label: "7D" },
    { value: 30, label: "30D" },
    { value: 90, label: "90D" },
];

const sumSec = (arr) => arr.reduce((a, d) => a + d.seconds, 0);
const pctChange = (cur, prev) => (prev > 0 ? ((cur - prev) / prev) * 100 : null);

function Dashboard({ data }) {
    const [range, setRange] = useState(30);
    const { stats, series, byType, hours, titles, today } = data;

    const cur = useMemo(() => series.slice(-range), [series, range]);
    const prev = useMemo(() => {
        const p = series.slice(-2 * range, -range);
        return p.length === range ? p : null;
    }, [series, range]);

    const curSec = sumSec(cur);
    const prevSec = prev ? sumSec(prev) : null;
    const finishedInRange = cur.reduce((a, d) => a + d.completed, 0);
    const avg = curSec / range;

    return (
        <>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs sm:text-sm text-base-content/80">
                    All time <span className="font-semibold text-base-content tabular-nums">{fmtShort(stats.totalSeconds)}</span>
                    <span className="mx-2 text-base-content/40">•</span>
                    <span className="font-semibold text-base-content tabular-nums">{stats.totalTitles}</span> titles
                    <span className="mx-2 text-base-content/40">•</span>
                    <span className="font-semibold text-base-content tabular-nums">{stats.totalWatches}</span> finishes
                </p>
                <Segmented options={RANGES} value={range} onChange={setRange} />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                <Kpi icon={Clock} label="Watch time" value={fmtShort(curSec)} foot={<Delta pct={prevSec != null ? pctChange(curSec, prevSec) : null} />} />
                <Kpi icon={Activity} label="Daily average" value={fmtShort(avg)} foot={<Delta pct={prevSec != null ? pctChange(avg, prevSec / range) : null} />} />
                <Kpi icon={CheckCircle2} label="Finished" value={finishedInRange} foot={`${stats.totalWatches} all time`} />
                <Kpi
                    icon={Flame}
                    label="Current streak"
                    value={`${stats.currentStreak} ${stats.currentStreak === 1 ? "day" : "days"}`}
                    foot={
                        <div className="w-full">
                            <div className="flex gap-1" aria-label="Last 7 days">
                                {series.slice(-7).map((d) => (
                                    <span
                                        key={d.date}
                                        title={`${fmtDay(d.date)} — ${d.seconds > 0 ? fmtShort(d.seconds) : "no activity"}`}
                                        className={`h-1.5 flex-1 rounded-full ${d.seconds > 0 || d.completed > 0 ? "bg-primary" : "bg-base-content/15"}`}
                                    />
                                ))}
                            </div>
                            <p className="mt-1.5">Longest {stats.longestStreak} · last 7 days</p>
                        </div>
                    }
                />
            </div>

            <div className="mt-3 grid gap-3 sm:mt-4 sm:gap-4 lg:grid-cols-3">
                <Card className="p-4 sm:p-5 lg:col-span-2">
                    <CardHead
                        title="Daily watch time"
                        sub={`${fmtShort(curSec)} over the last ${range} days`}
                        right={
                            <div className="hidden items-center gap-3 text-[11px] text-base-content/80 sm:flex">
                                <span className="inline-flex items-center gap-1.5">
                                    <span className="h-0.5 w-4 rounded bg-primary" /> This period
                                </span>
                                {prev && (
                                    <span className="inline-flex items-center gap-1.5">
                                        <span className="w-4 border-t-2 border-dashed border-base-content/50" /> Previous
                                    </span>
                                )}
                            </div>
                        }
                    />
                    <div className="mt-3">
                        <ChartBox data={cur} prev={prev} today={today} />
                    </div>
                </Card>
                <SplitCard byType={byType} />
            </div>

            <div className="mt-3 grid gap-3 sm:mt-4 sm:gap-4 md:grid-cols-2 lg:grid-cols-3">
                <HoursCard hours={hours} />
                <WeekdayCard series={series.slice(-91)} />
                <HeatmapCard series={series} />
            </div>

            <div className="mt-3 grid gap-3 sm:mt-4 sm:gap-4 md:grid-cols-5 lg:grid-cols-3">
                <WeeklyTrendCard series={series} />
                <ViewingHabitsCard hours={hours} series={series} />
            </div>

            <ViewingLog titles={titles} />

            <MostWatchedSection titles={titles} totalSeconds={stats.totalSeconds} />
        </>
    );
}

export default function WatchTime() {
    const { isAuthenticated } = useAuth();
    const { data, isLoading, isError, refetch } = useWatchTime();

    return (
        <div className="mx-auto w-full max-w-7xl 2xl:max-w-[92rem]">
            <style>{MOTION_CSS}</style>
            <header className="border-b border-base-content/10 pb-4">
                <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-base-content">My Activity</h1>
                <p className="mt-1 text-xs sm:text-sm text-base-content/70">Viewing analytics, synced across all devices on your account.</p>
            </header>

            {!isAuthenticated ? (
                <div className="mt-5">
                    <Notice icon={Clock} title="Log in to see your activity" text="Your stats follow your account across every device." />
                </div>
            ) : isLoading ? (
                <div className="mt-5">
                    <PageSkeleton />
                </div>
            ) : isError || !data ? (
                <div className="mt-5">
                    <Notice
                        icon={Activity}
                        title="Couldn't load your activity"
                        action={
                            <button onClick={() => refetch()} className="btn btn-sm btn-primary mt-4">
                                Try again
                            </button>
                        }
                    />
                </div>
            ) : (
                <Dashboard data={data} />
            )}
        </div>
    );
}
