// web/src/Dashboard/Components/DashCharts.jsx
// Dependency-free chart kit (SVG + CSS) used by pages/DashSubtitles.jsx and the subtitle details dialog.
// Colours come from the active daisyUI theme (CSS variables), so every chart follows the selected theme.
//   BarChart  · y-axis, grid, hover tooltip, optional peak marker, thinned x labels
//   AreaChart · y-axis, smooth curve, crosshair + tooltip, peak dot
//   Donut     · interactive (hover a slice or a legend row), centre shows the hovered value
//   HBars / Ring / Sparkline / Gauge / Legend

import { useId, useMemo, useRef, useState } from "react";

export const CHART = {
    primary: "var(--color-primary)",
    success: "var(--color-success)",
    warning: "var(--color-warning)",
    error: "var(--color-error)",
    info: "var(--color-info)",
    accent: "var(--color-accent)",
    muted: "color-mix(in oklab, var(--color-base-content) 28%, transparent)",
    grid: "color-mix(in oklab, var(--color-base-content) 10%, transparent)",
    text: "color-mix(in oklab, var(--color-base-content) 62%, transparent)",
};

const num = (n) => Number(n || 0).toLocaleString();

/** 1-2-5 "nice" axis maximum and 3 evenly spaced ticks (0, mid, max). */
function niceScale(max) {
    if (!(max > 0)) return { max: 1, ticks: [0, 0.5, 1] };
    const pow = Math.pow(10, Math.floor(Math.log10(max)));
    const f = max / pow;
    const nice = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
    return { max: nice, ticks: [0, nice / 2, nice] };
}
const tick = (v, fmt) => (v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : fmt ? fmt(v) : String(Math.round(v * 10) / 10));

function Tooltip({ x, children, align = "center" }) {
    return (
        <div
            className="pointer-events-none absolute z-30 w-max max-w-48 -translate-y-full rounded-lg border border-base-300 bg-base-100 px-2.5 py-1.5 text-xs shadow-xl"
            style={{ left: `${x}%`, top: -6, transform: `translate(${align === "left" ? "0" : align === "right" ? "-100%" : "-50%"}, -100%)` }}
            role="tooltip">
            {children}
        </div>
    );
}

// ─── Ring (progress / score gauge) ───────────────────────────────────────────

export function Ring({ value = 0, size = 40, stroke = 4, color = CHART.success, children, label }) {
    const v = Math.max(0, Math.min(1, value));
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    return (
        <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }} role="img" aria-label={label || `${Math.round(v * 100)}%`}>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
                <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={CHART.grid} strokeWidth={stroke} />
                <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${c * v} ${c}`} style={{ transition: "stroke-dasharray .5s ease" }} />
            </svg>
            {children != null && <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold tabular-nums">{children}</span>}
        </span>
    );
}

// ─── Sparkline ───────────────────────────────────────────────────────────────

export function Sparkline({ values = [], width = 96, height = 30, color = CHART.primary }) {
    const id = useId();
    const v = values.length > 1 ? values : [0, 0];
    const max = Math.max(1, ...v);
    const step = width / (v.length - 1);
    const pts = v.map((y, i) => [i * step, height - 2 - (y / max) * (height - 6)]);
    const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    return (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="shrink-0 overflow-visible">
            <defs>
                <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity=".35" />
                    <stop offset="100%" stopColor={color} stopOpacity="0" />
                </linearGradient>
            </defs>
            <path d={`${line} L${width},${height} L0,${height} Z`} fill={`url(#${id})`} />
            <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={pts.at(-1)[0]} cy={pts.at(-1)[1]} r="2.2" fill={color} />
        </svg>
    );
}

// ─── Donut (interactive) ─────────────────────────────────────────────────────

/** Donut + legend that talk to each other: hover a slice or a legend row and the centre shows that slice. */
export function DonutChart({ segments = [], size = 156, thickness = 18, center, unit = "", className = "" }) {
    const [active, setActive] = useState(null);
    const total = segments.reduce((a, s) => a + (s.value || 0), 0);
    const r = (size - thickness) / 2;
    const c = 2 * Math.PI * r;
    let acc = 0;
    const act = segments.find((s) => s.label === active);
    const pct = (v) => (total ? Math.round((v / total) * 100) : 0);
    return (
        <div className={`flex flex-wrap items-center justify-center gap-x-8 gap-y-5 ${className}`}>
            <div className="relative shrink-0" style={{ width: size, height: size }} onMouseLeave={() => setActive(null)}>
                <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" role="img" aria-label={segments.map((s) => `${s.label}: ${s.value}`).join(", ")}>
                    <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={CHART.grid} strokeWidth={thickness} />
                    {total > 0 &&
                        segments.map((s) => {
                            if (!s.value) return null;
                            const len = (s.value / total) * c;
                            const gap = segments.filter((x) => x.value).length > 1 ? 3 : 0;
                            const on = active === s.label;
                            const el = (
                                <circle
                                    key={s.label}
                                    cx={size / 2}
                                    cy={size / 2}
                                    r={r}
                                    fill="none"
                                    stroke={s.color}
                                    strokeWidth={on ? thickness + 4 : thickness}
                                    strokeLinecap="butt"
                                    strokeDasharray={`${Math.max(0, len - gap)} ${c}`}
                                    strokeDashoffset={-acc}
                                    opacity={active && !on ? 0.35 : 1}
                                    style={{ transition: "stroke-width .15s ease, opacity .15s ease", cursor: "pointer" }}
                                    onMouseEnter={() => setActive(s.label)}
                                />
                            );
                            acc += len;
                            return el;
                        })}
                </svg>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-5 text-center">
                    <span className="text-2xl font-semibold leading-none tabular-nums">{act ? num(act.value) : center?.value}</span>
                    <span className="mt-1.5 max-w-full text-[11px] leading-tight text-base-content/60">{act ? `${act.label} · ${pct(act.value)}%` : center?.label}</span>
                </div>
            </div>
            <ul className="flex min-w-40 flex-1 flex-col gap-1">
                {segments.map((s) => (
                    <li key={s.label}>
                        <button
                            type="button"
                            onMouseEnter={() => setActive(s.label)}
                            onMouseLeave={() => setActive(null)}
                            onFocus={() => setActive(s.label)}
                            onBlur={() => setActive(null)}
                            className={`flex w-full cursor-default items-center justify-between gap-3 rounded-lg border-none px-2.5 py-1.5 text-left text-sm transition-colors ${active === s.label ? "bg-base-300" : "bg-transparent"}`}>
                            <span className="flex min-w-0 items-center gap-2.5 text-base-content/85">
                                <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: s.color }} />
                                <span className="[overflow-wrap:anywhere]">{s.label}</span>
                            </span>
                            <span className="shrink-0 text-right">
                                <span className="font-semibold tabular-nums">{num(s.value)}{unit}</span>
                                <span className="ml-2 text-xs tabular-nums text-base-content/55">{pct(s.value)}%</span>
                            </span>
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
}

// kept for callers that want the bare donut
export function Donut(props) {
    return <DonutChart {...props} />;
}

export function Legend({ items = [], className = "" }) {
    return (
        <ul className={`flex flex-col gap-2 ${className}`}>
            {items.map((i) => (
                <li key={i.label} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2 text-base-content/85">
                        <span className="size-2.5 shrink-0 rounded-sm" style={{ background: i.color }} />
                        <span className="[overflow-wrap:anywhere]">{i.label}</span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">{i.display ?? num(i.value)}</span>
                </li>
            ))}
        </ul>
    );
}

// ─── Bar chart ───────────────────────────────────────────────────────────────
// data: [{ label, value, color?, tip? }]   peak: mark the tallest bar   labelEvery: show every Nth x label

export function BarChart({ data = [], height = 160, color = CHART.primary, formatValue = num, highlight, peak = false, labelEvery = 1, unit = "", tipLabel }) {
    const [hover, setHover] = useState(null);
    const rawMax = Math.max(0, ...data.map((d) => d.value));
    const { max, ticks } = useMemo(() => niceScale(rawMax), [rawMax]);
    const empty = rawMax === 0;
    const peakIdx = peak && !empty ? data.findIndex((d) => d.value === rawMax) : -1;
    const plotH = height;
    const dense = data.length > 14;
    return (
        <div className="w-full select-none" role="img" aria-label={data.map((d) => `${d.label}: ${d.value}`).join(", ")}>
            <div className="flex gap-2">
                {/* y axis */}
                <div className="flex shrink-0 flex-col justify-between text-right text-[10px] tabular-nums leading-none text-base-content/50" style={{ height: plotH, width: 28 }}>
                    {[...ticks].reverse().map((t) => (
                        <span key={t}>{tick(t)}</span>
                    ))}
                </div>
                {/* plot */}
                <div className="relative min-w-0 flex-1" style={{ height: plotH }} onMouseLeave={() => setHover(null)}>
                    {[0, 0.5, 1].map((g) => (
                        <div key={g} className="pointer-events-none absolute inset-x-0 border-t" style={{ bottom: `${g * 100}%`, borderColor: CHART.grid, borderStyle: g === 0 ? "solid" : "dashed" }} />
                    ))}
                    <div className={`absolute inset-0 flex items-end ${dense ? "gap-[3px]" : "gap-2"}`}>
                        {data.map((d, i) => {
                            const h = d.value ? Math.max(4, (d.value / max) * (plotH - 6)) : 0;
                            const hot = highlight ? highlight(d, i) : null;
                            const fill = d.color || (hot ? CHART.success : color);
                            const dim = highlight && !hot && !d.color;
                            const on = hover === i;
                            return (
                                <div key={d.label + i} className="relative flex h-full min-w-0 flex-1 items-end justify-center" onMouseEnter={() => setHover(i)}>
                                    <div
                                        className="w-full rounded-t-[5px] transition-[filter,opacity] duration-150"
                                        style={{
                                            height: h,
                                            background: `linear-gradient(to top, ${fill}, color-mix(in oklab, ${fill} 72%, white))`,
                                            opacity: dim ? 0.5 : 1,
                                            filter: on ? "brightness(1.12) saturate(1.1)" : undefined,
                                            outline: i === peakIdx ? `2px solid ${CHART.primary}` : undefined,
                                            outlineOffset: 1,
                                        }}
                                    />
                                    {i === peakIdx && (
                                        <span className="pointer-events-none absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: CHART.primary, color: "var(--color-primary-content)" }}>
                                            peak {formatValue(d.value)}
                                        </span>
                                    )}
                                    {!dense && d.value > 0 && i !== peakIdx && <span className="pointer-events-none absolute left-0 right-0 text-center text-[10px] font-medium tabular-nums text-base-content/70" style={{ bottom: h + 3 }}>{formatValue(d.value)}</span>}
                                </div>
                            );
                        })}
                    </div>
                    {hover != null && data[hover] && (
                        <Tooltip x={((hover + 0.5) / data.length) * 100} align={hover < 2 ? "left" : hover > data.length - 3 ? "right" : "center"}>
                            <p className="font-semibold">{data[hover].tip || tipLabel?.(data[hover]) || data[hover].label}</p>
                            <p className="tabular-nums text-base-content/70">
                                {formatValue(data[hover].value)}
                                {unit}
                            </p>
                        </Tooltip>
                    )}
                    {empty && <p className="absolute inset-0 z-10 flex items-center justify-center text-xs text-base-content/55">Nothing to plot yet</p>}
                </div>
            </div>
            {/* x labels */}
            <div className="mt-2 flex gap-2" style={{ paddingLeft: 36 }}>
                <div className={`flex min-w-0 flex-1 ${dense ? "gap-[3px]" : "gap-2"}`}>
                    {data.map((d, i) => (
                        <span key={d.label + i} className="min-w-0 flex-1 text-center text-[10px] leading-tight text-base-content/55">
                            {i % labelEvery === 0 ? <span className="whitespace-nowrap">{d.label}</span> : null}
                        </span>
                    ))}
                </div>
            </div>
        </div>
    );
}

// ─── Area chart (time series) ────────────────────────────────────────────────
// points: [{ label, value, tip? }]

export function AreaChart({ points = [], height = 160, color = CHART.primary, formatValue = num, peak = false, unit = "", xTicks }) {
    const id = useId();
    const wrap = useRef(null);
    const [hover, setHover] = useState(null);
    const W = 400;
    const H = height;
    const padT = 10;
    const rawMax = Math.max(0, ...points.map((p) => p.value));
    const { max, ticks } = useMemo(() => niceScale(rawMax), [rawMax]);
    const n = Math.max(1, points.length - 1);
    const X = (i) => (i / n) * W;
    const Y = (v) => H - 1 - (v / max) * (H - padT - 2);
    const xy = points.map((p, i) => [X(i), Y(p.value)]);
    const path = xy.reduce((d, [x, y], i) => {
        if (!i) return `M${x},${y}`;
        const [px, py] = xy[i - 1];
        const cx = (px + x) / 2;
        return `${d} C${cx},${py} ${cx},${y} ${x},${y}`;
    }, "");
    const peakIdx = peak && rawMax ? points.findIndex((p) => p.value === rawMax) : -1;
    const labelIdx = xTicks || [0, Math.round(n / 2), n];
    const move = (e) => {
        const r = wrap.current?.getBoundingClientRect();
        if (!r || !points.length) return;
        setHover(Math.max(0, Math.min(points.length - 1, Math.round(((e.clientX - r.left) / r.width) * n))));
    };
    const hp = hover != null ? points[hover] : null;
    return (
        <div className="w-full select-none" role="img" aria-label={`${points.length} points, peak ${rawMax}`}>
            <div className="flex gap-2">
                <div className="flex shrink-0 flex-col justify-between text-right text-[10px] tabular-nums leading-none text-base-content/50" style={{ height: H, width: 28 }}>
                    {[...ticks].reverse().map((t) => (
                        <span key={t}>{tick(t)}</span>
                    ))}
                </div>
                <div ref={wrap} className="relative min-w-0 flex-1" style={{ height: H }} onMouseMove={move} onMouseLeave={() => setHover(null)}>
                    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H} className="block overflow-visible">
                        <defs>
                            <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
                                <stop offset="0%" stopColor={color} stopOpacity=".34" />
                                <stop offset="100%" stopColor={color} stopOpacity="0" />
                            </linearGradient>
                        </defs>
                        {[0, 0.5, 1].map((g) => (
                            <line key={g} x1="0" x2={W} y1={H - 1 - g * (H - padT - 2)} y2={H - 1 - g * (H - padT - 2)} stroke={CHART.grid} strokeDasharray={g === 0 ? undefined : "3 4"} vectorEffect="non-scaling-stroke" />
                        ))}
                        {points.length > 1 && <path d={`${path} L${W},${H} L0,${H} Z`} fill={`url(#${id})`} />}
                        {points.length > 1 && <path d={path} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
                        {hover != null && <line x1={X(hover)} x2={X(hover)} y1="0" y2={H} stroke={CHART.text} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
                    </svg>
                    {/* dots are HTML so they stay round while the SVG stretches */}
                    {peakIdx >= 0 && hover == null && (
                        <>
                            <span className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-base-100" style={{ left: `${(peakIdx / n) * 100}%`, top: (xy[peakIdx][1] / H) * H, background: CHART.primary }} />
                            <span className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={{ left: `${Math.min(88, Math.max(12, (peakIdx / n) * 100))}%`, top: Math.max(0, xy[peakIdx][1] - 24), background: CHART.primary, color: "var(--color-primary-content)" }}>
                                peak {formatValue(rawMax)}
                            </span>
                        </>
                    )}
                    {hp && (
                        <>
                            <span className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-base-100" style={{ left: `${(hover / n) * 100}%`, top: xy[hover][1], background: color }} />
                            <Tooltip x={(hover / n) * 100} align={hover < n * 0.12 ? "left" : hover > n * 0.88 ? "right" : "center"}>
                                <p className="font-semibold">{hp.tip || hp.label}</p>
                                <p className="tabular-nums text-base-content/70">
                                    {formatValue(hp.value)}
                                    {unit}
                                </p>
                            </Tooltip>
                        </>
                    )}
                    {rawMax === 0 && <p className="absolute inset-0 flex items-center justify-center text-xs text-base-content/55">Nothing to plot yet</p>}
                </div>
            </div>
            <div className="relative mt-2 h-3 text-[10px] text-base-content/55" style={{ marginLeft: 36 }}>
                {labelIdx.map((i, k) => (
                    <span key={i} className="absolute whitespace-nowrap" style={{ left: `${(i / n) * 100}%`, transform: `translateX(${k === 0 ? "0" : k === labelIdx.length - 1 ? "-100%" : "-50%"})` }}>
                        {points[i]?.label}
                    </span>
                ))}
            </div>
        </div>
    );
}

// ─── Horizontal bars ─────────────────────────────────────────────────────────

export function HBars({ rows = [], format = num, empty = "Nothing to show" }) {
    const max = Math.max(1, ...rows.map((r) => r.value));
    const total = rows.reduce((a, r) => a + r.value, 0);
    if (!rows.length || rows.every((r) => !r.value)) return <p className="py-8 text-center text-xs text-base-content/55">{empty}</p>;
    return (
        <ul className="flex flex-col gap-3.5">
            {rows.map((r) => (
                <li key={r.label} title={`${r.label}: ${format(r.value)}`}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                        <span className="flex min-w-0 items-center gap-2 text-base-content/90">
                            <span className="size-2 shrink-0 rounded-full" style={{ background: r.color || CHART.primary }} />
                            <span className="[overflow-wrap:anywhere]">{r.label}</span>
                        </span>
                        <span className="shrink-0 font-semibold tabular-nums">
                            {format(r.value)}
                            <span className="ml-2 text-xs font-normal text-base-content/55">{r.hint ?? `${total ? Math.round((r.value / total) * 100) : 0}%`}</span>
                        </span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full" style={{ background: CHART.grid }}>
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(r.value / max) * 100}%`, background: `linear-gradient(to right, ${r.color || CHART.primary}, color-mix(in oklab, ${r.color || CHART.primary} 70%, white))` }} />
                    </div>
                </li>
            ))}
        </ul>
    );
}

// ─── Metric gauge (value on a track with threshold marks) ────────────────────

export function Gauge({ value = 0, min = 0, max = 1, marks = [], color = CHART.success, className = "" }) {
    const pos = (v) => `${Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100))}%`;
    return (
        <div className={`relative h-2 rounded-full ${className}`} style={{ background: CHART.grid }}>
            <div className="h-full rounded-full transition-all duration-500" style={{ width: pos(value), background: color }} />
            {marks.map((m) => (
                <span key={m.label} className="absolute -top-1 h-4 w-px" style={{ left: pos(m.at), background: CHART.text }} title={m.label} />
            ))}
        </div>
    );
}
