// web/src/dashboard/pages/DashHealth.jsx
// GET /api/admin-dashboard/health
// Live polling · sparklines · streaming engine info · codec matrix · HW priority

import { useState, useEffect, useCallback, useRef } from "react";
import { Cpu, HardDrive, Server, RefreshCw, Wifi, CheckCircle, AlertTriangle, XCircle, Activity, Zap, Clock, Database, Film, Play, Radio, Shield } from "lucide-react";
import { dashApi } from "../api/dashboardApi";

// ─── Config ───────────────────────────────────────────────────────────────────
const HISTORY_LEN = 40;
const REFRESH_MS = 5000;

// ─── Color helpers ────────────────────────────────────────────────────────────
function pctColor(p) {
    if (p == null) return "#6b7280";
    if (p > 85) return "#ef4444";
    if (p > 65) return "#f59e0b";
    return "#22c55e";
}
function pctCls(p) {
    if (p == null) return "text-base-content/30";
    if (p > 85) return "text-red-400";
    if (p > 65) return "text-amber-400";
    return "text-emerald-400";
}

// ─── Circular Gauge ───────────────────────────────────────────────────────────
function CircleGauge({ pct, label, sub, size = 136 }) {
    const r = size / 2 - 12;
    const c = size / 2;
    const circ = 2 * Math.PI * r;
    const color = pctColor(pct);
    const fill = circ * ((pct ?? 0) / 100);

    return (
        <div className="flex flex-col items-center gap-3">
            <div className="relative" style={{ width: size, height: size }}>
                <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
                    <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={9} />
                    <circle
                        cx={c}
                        cy={c}
                        r={r}
                        fill="none"
                        stroke={color}
                        strokeWidth={9}
                        strokeLinecap="round"
                        strokeDasharray={`${fill} ${circ - fill}`}
                        style={{
                            transition: "stroke-dasharray 0.7s ease, stroke 0.4s ease",
                            filter: `drop-shadow(0 0 8px ${color}55)`,
                        }}
                    />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
                    <span className={`text-2xl font-black tabular-nums leading-none ${pctCls(pct)}`}>{pct != null ? `${pct.toFixed(0)}%` : "—"}</span>
                    {sub && <span className="text-[10px] text-base-content/40 font-semibold uppercase tracking-widest">{sub}</span>}
                </div>
            </div>
            <span className="text-xs font-bold text-base-content/50 uppercase tracking-widest">{label}</span>
        </div>
    );
}

// ─── Sparkline ────────────────────────────────────────────────────────────────
function Sparkline({ data, color, height = 52 }) {
    const W = 400;
    const H = height;

    if (!data || data.length < 2) {
        return (
            <div style={{ height }} className="flex items-center justify-center">
                <span className="text-[11px] text-base-content/20 italic">Collecting data…</span>
            </div>
        );
    }

    const max = Math.max(...data, 1);
    const pts = data.map((v, i) => {
        const x = (i / (data.length - 1)) * W;
        const y = H - (v / max) * H * 0.88;
        return [x, y];
    });

    const linePts = pts.map((p) => p.join(",")).join(" ");
    const areaPath = `M ${pts[0][0]},${pts[0][1]} ${pts.map((p) => `L ${p[0]},${p[1]}`).join(" ")} L ${W},${H} L 0,${H} Z`;
    const [lx, ly] = pts[pts.length - 1];

    const gradId = `sg${color.replace(/#/g, "").slice(0, 6)}`;

    return (
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height, display: "block" }}>
            <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity="0.3" />
                    <stop offset="100%" stopColor={color} stopOpacity="0.02" />
                </linearGradient>
            </defs>
            <path d={areaPath} fill={`url(#${gradId})`} />
            <polyline points={linePts} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={lx} cy={ly} r="4" fill={color} style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
        </svg>
    );
}

// ─── Pill badge ───────────────────────────────────────────────────────────────
function OkPill({ label, ok, okTxt = "Active", nokTxt = "Inactive", pulse }) {
    return (
        <div className={`flex items-center gap-2.5 rounded-xl px-4 py-3 ${ok ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
            <span className={`w-2 h-2 rounded-full shrink-0 flex-none ${ok ? "bg-emerald-400" : "bg-red-400"} ${pulse && ok ? "animate-pulse" : ""}`} />
            <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-base-content/35 mb-0.5">{label}</p>
                <p className={`text-sm font-black leading-none ${ok ? "text-emerald-400" : "text-red-400"}`}>{ok ? okTxt : nokTxt}</p>
            </div>
        </div>
    );
}

// ─── Section card ─────────────────────────────────────────────────────────────
function Card({ title, icon: Icon, badge, children }) {
    return (
        <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="flex items-center gap-2.5 px-5 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <Icon size={15} className="text-primary shrink-0" />
                <span className="text-[11px] font-black uppercase tracking-widest text-base-content/60 flex-1">{title}</span>
                {badge}
            </div>
            <div className="p-5">{children}</div>
        </div>
    );
}

// ─── Key-value table ──────────────────────────────────────────────────────────
function KVTable({ rows }) {
    const valid = rows.filter(([, v]) => v != null && v !== "" && v !== undefined);
    if (!valid.length) return null;
    return (
        <dl className="space-y-0" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
            {valid.map(([k, v, mono]) => (
                <div key={k} className="flex items-center justify-between py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <dt className="text-xs text-base-content/40 shrink-0 mr-4">{k}</dt>
                    <dd className={`text-xs font-semibold text-base-content/85 text-right truncate max-w-[60%] ${mono ? "font-mono" : ""}`}>{String(v)}</dd>
                </div>
            ))}
        </dl>
    );
}

// ─── Stat pill (top strip) ────────────────────────────────────────────────────
function StatPill({ icon: Icon, label, value, sub, accent }) {
    const accents = {
        green: { bg: "rgba(34,197,94,0.1)", text: "text-emerald-400" },
        amber: { bg: "rgba(245,158,11,0.1)", text: "text-amber-400" },
        red: { bg: "rgba(239,68,68,0.1)", text: "text-red-400" },
        blue: { bg: "rgba(99,102,241,0.1)", text: "text-indigo-400" },
        purple: { bg: "rgba(168,85,247,0.1)", text: "text-purple-400" },
    };
    const a = accents[accent] ?? accents.blue;
    return (
        <div className="flex items-center gap-3 rounded-2xl px-4 py-3.5" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: a.bg }}>
                <Icon size={16} className={a.text} />
            </div>
            <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-base-content/35">{label}</p>
                <p className={`text-sm font-black text-base-content tabular-nums truncate`}>{value ?? "—"}</p>
                {sub && <p className="text-[10px] text-base-content/35 truncate mt-0.5">{sub}</p>}
            </div>
        </div>
    );
}

// ─── Codec chip ───────────────────────────────────────────────────────────────
function CodecChip({ label, supported }) {
    return (
        <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold
            ${supported ? "text-emerald-400" : "text-base-content/25"}`}
            style={{ background: supported ? "rgba(34,197,94,0.1)" : "rgba(255,255,255,0.04)" }}>
            <span className={`w-1.5 h-1.5 rounded-full ${supported ? "bg-emerald-400" : "bg-white/15"}`} />
            {label}
        </span>
    );
}

// ─── HW priority row ──────────────────────────────────────────────────────────
function HWRow({ rank, name, desc, active }) {
    return (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl ${active ? "bg-primary/15" : "bg-white/3"}`}>
            <span className={`text-xs font-black w-5 shrink-0 ${active ? "text-primary" : "text-base-content/20"}`}>{rank}</span>
            <div className="flex-1 min-w-0">
                <p className={`text-sm font-bold leading-tight ${active ? "text-base-content" : "text-base-content/40"}`}>{name}</p>
                <p className="text-[10px] text-base-content/30 mt-0.5">{desc}</p>
            </div>
            {active && (
                <span className="flex items-center gap-1.5 text-[10px] font-black text-primary shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                    ACTIVE
                </span>
            )}
        </div>
    );
}

// ─── Playback decision row ────────────────────────────────────────────────────
function DecisionRow({ num, label, desc, color }) {
    const colors = {
        green: { dot: "bg-emerald-400", txt: "text-emerald-400", bg: "bg-emerald-400/8" },
        blue: { dot: "bg-blue-400", txt: "text-blue-400", bg: "bg-blue-400/8" },
        amber: { dot: "bg-amber-400", txt: "text-amber-400", bg: "bg-amber-400/8" },
        red: { dot: "bg-red-400", txt: "text-red-400", bg: "bg-red-400/8" },
    };
    const c = colors[color] ?? colors.blue;
    return (
        <div className={`flex items-start gap-3 px-4 py-3 rounded-xl ${c.bg}`}>
            <span className={`text-xs font-black mt-0.5 shrink-0 w-4 ${c.txt}`}>{num}</span>
            <div>
                <p className={`text-sm font-bold ${c.txt}`}>{label}</p>
                <p className="text-[11px] text-base-content/40 mt-0.5 leading-relaxed">{desc}</p>
            </div>
        </div>
    );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function DashHealth() {
    const [info, setInfo] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [lastAt, setLastAt] = useState(null);
    const [live, setLive] = useState(true);

    const histRef = useRef([]);
    const [hist, setHist] = useState([]);
    const timerRef = useRef(null);

    const load = useCallback(async () => {
        setError(null);
        try {
            const raw = await dashApi.health();
            const data = raw?.system ?? raw; // unwrap if nested
            setInfo(data);
            setLastAt(new Date());

            const cpu = data?.health?.cpuUsagePercent ?? data?.cpu?.usagePercent ?? null;
            const mem = data?.health?.memoryUsagePercent ?? data?.memory?.usagePercent ?? null;

            if (cpu != null || mem != null) {
                histRef.current = [...histRef.current.slice(-(HISTORY_LEN - 1)), { cpu: cpu ?? 0, mem: mem ?? 0 }];
                setHist([...histRef.current]);
            }
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    useEffect(() => {
        clearInterval(timerRef.current);
        if (live) timerRef.current = setInterval(load, REFRESH_MS);
        return () => clearInterval(timerRef.current);
    }, [live, load]);

    // ── Derived ───────────────────────────────────────────────────────────────
    const h = info?.health;
    const cpu = info?.cpu;
    const mem = info?.memory;
    const ff = info?.ffmpeg;
    const tc = info?.transcoding;
    const st = info?.storage;
    const net = info?.network;
    const os = info?.os;
    const rt = info?.runtime;

    const cpuPct = h?.cpuUsagePercent ?? cpu?.usagePercent ?? null;
    const memPct = h?.memoryUsagePercent ?? mem?.usagePercent ?? null;
    const cpuHist = hist.map((p) => p.cpu);
    const memHist = hist.map((p) => p.mem);

    // detect active HW accel from transcoding config
    const hwType = tc?.hwAccelType?.toLowerCase() ?? "";
    const qsvOn = tc?.hardwareAcceleration && hwType.includes("qsv");
    const vaapiOn = tc?.hardwareAcceleration && hwType.includes("vaapi");
    const nvencOn = tc?.hardwareAcceleration && (hwType.includes("nvenc") || hwType.includes("cuda") || hwType.includes("nvidia"));
    const cpuOnly = !tc?.hardwareAcceleration;

    const overall = h?.overall;
    const statusBanner = {
        healthy: { bg: "rgba(34,197,94,0.12)", border: "rgba(34,197,94,0.2)", icon: CheckCircle, color: "#4ade80", txt: "All Systems Healthy" },
        degraded: { bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.2)", icon: AlertTriangle, color: "#fbbf24", txt: "Degraded Performance Detected" },
        critical: { bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.2)", icon: XCircle, color: "#f87171", txt: "Critical Issues Detected" },
    }[overall] ?? { bg: "rgba(99,102,241,0.1)", border: "rgba(99,102,241,0.2)", icon: Activity, color: "#818cf8", txt: "Loading diagnostics…" };

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="space-y-5 text-base-content">
            {/* ── Header ── */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-black text-base-content tracking-tight">System Health</h1>
                    <p className="text-sm text-base-content/45 mt-0.5">Real-time hardware, transcoding &amp; runtime diagnostics</p>
                </div>
                <div className="flex items-center gap-2">
                    {lastAt && (
                        <span className="text-[11px] text-base-content/30 flex items-center gap-1.5 font-mono">
                            <Clock size={10} className="text-base-content/25" />
                            {lastAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </span>
                    )}
                    <button
                        onClick={() => setLive((v) => !v)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all
                            ${live ? "text-emerald-400" : "text-base-content/35"}`}
                        style={{ background: live ? "rgba(34,197,94,0.1)" : "rgba(255,255,255,0.05)" }}>
                        <span className={`w-1.5 h-1.5 rounded-full ${live ? "bg-emerald-400 animate-pulse" : "bg-white/20"}`} />
                        {live ? "Live" : "Paused"}
                    </button>
                    <button
                        onClick={load}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-base-content/50 hover:text-base-content transition-colors"
                        style={{ background: "rgba(255,255,255,0.05)" }}>
                        <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
                        Refresh
                    </button>
                </div>
            </div>

            {/* ── Error ── */}
            {error && (
                <div className="flex items-start gap-3 px-5 py-4 rounded-2xl" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)" }}>
                    <AlertTriangle size={16} className="text-red-400 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-red-400">Health endpoint unreachable</p>
                        <p className="text-xs text-base-content/45 mt-0.5 break-all">{error}</p>
                        <p className="text-xs text-base-content/30 mt-1">
                            Ensure <code className="font-mono bg-white/5 px-1 rounded">/api/admin-dashboard/health</code> is deployed
                        </p>
                    </div>
                    <button onClick={load} className="btn btn-xs rounded-lg shrink-0 text-red-400" style={{ background: "rgba(239,68,68,0.15)" }}>
                        Retry
                    </button>
                </div>
            )}

            {loading && !info ? (
                <div className="flex flex-col items-center justify-center py-32 gap-4">
                    <span className="loading loading-spinner loading-lg text-primary" />
                    <p className="text-sm text-base-content/30">Gathering system diagnostics…</p>
                </div>
            ) : info ? (
                <div className="space-y-4">
                    {/* ── Status banner ── */}
                    <div className="flex items-center gap-3 px-5 py-4 rounded-2xl" style={{ background: statusBanner.bg, border: `1px solid ${statusBanner.border}` }}>
                        <statusBanner.icon size={20} style={{ color: statusBanner.color }} className="shrink-0" />
                        <span className="font-black text-base-content text-sm flex-1">{statusBanner.txt}</span>
                        {h && (
                            <div className="flex items-center gap-3 text-[11px] font-semibold text-base-content/50 flex-wrap justify-end">
                                {h.ffmpegHealthy && <span className="text-emerald-400">FFmpeg ✓</span>}
                                {h.hardwareAccelerationHealthy && <span className="text-emerald-400">HW Accel ✓</span>}
                                {!h.lowMemoryWarning && <span className="text-emerald-400">RAM ✓</span>}
                                {!h.highCpuWarning && <span className="text-emerald-400">CPU ✓</span>}
                                {h.lowMemoryWarning && <span className="text-amber-400">⚠ Low RAM</span>}
                                {h.highCpuWarning && <span className="text-red-400">⚠ High CPU</span>}
                            </div>
                        )}
                    </div>

                    {/* ── CPU + RAM cards with sparklines ── */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* CPU */}
                        <div className="rounded-2xl p-5 space-y-5" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Cpu size={15} className="text-primary" />
                                    <span className="text-xs font-black uppercase tracking-widest text-base-content/60">CPU</span>
                                </div>
                                {cpu?.model && <span className="text-[11px] text-base-content/40 truncate max-w-[55%] text-right">{cpu.model.split(" ").slice(0, 5).join(" ")}</span>}
                            </div>

                            <div className="flex items-center gap-5">
                                <CircleGauge pct={cpuPct} label="Usage" sub={cpu?.logicalCores ? `${cpu.logicalCores} threads` : undefined} size={130} />
                                <div className="flex-1 min-w-0 space-y-0">
                                    <KVTable
                                        rows={[
                                            ["Physical cores", cpu?.physicalCores],
                                            ["Logical threads", cpu?.logicalCores],
                                            ["Speed", cpu?.speedGHz != null ? `${cpu.speedGHz} GHz` : null],
                                            ["Load avg 1m", cpu?.loadAvg1m?.toFixed(2)],
                                            ["Load avg 5m", cpu?.loadAvg5m?.toFixed(2)],
                                            ["Load avg 15m", cpu?.loadAvg15m?.toFixed(2)],
                                        ]}
                                    />
                                </div>
                            </div>

                            {/* Sparkline */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-bold uppercase tracking-widest text-base-content/25">CPU History</span>
                                    <span className="text-[10px] text-base-content/20 tabular-nums">
                                        {cpuHist.length}/{HISTORY_LEN} pts
                                    </span>
                                </div>
                                <div className="rounded-xl overflow-hidden" style={{ background: "rgba(0,0,0,0.25)", padding: "6px 4px 4px" }}>
                                    <Sparkline data={cpuHist} color={pctColor(cpuPct)} height={52} />
                                </div>
                            </div>
                        </div>

                        {/* Memory */}
                        <div className="rounded-2xl p-5 space-y-5" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Database size={15} className="text-info" />
                                    <span className="text-xs font-black uppercase tracking-widest text-base-content/60">Memory</span>
                                </div>
                                <span className="text-[11px] text-base-content/40">{mem?.total ?? "—"} total</span>
                            </div>

                            <div className="flex items-center gap-5">
                                <CircleGauge pct={memPct} label="Used" sub={mem?.used ?? undefined} size={130} />
                                <div className="flex-1 min-w-0 space-y-0">
                                    <KVTable
                                        rows={[
                                            ["Total", mem?.total],
                                            ["Used", mem?.used],
                                            ["Free", mem?.free],
                                            ["Swap total", mem?.swap?.total],
                                            ["Swap used", mem?.swap?.used],
                                        ]}
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-bold uppercase tracking-widest text-base-content/25">Memory History</span>
                                    <span className="text-[10px] text-base-content/20 tabular-nums">
                                        {memHist.length}/{HISTORY_LEN} pts
                                    </span>
                                </div>
                                <div className="rounded-xl overflow-hidden" style={{ background: "rgba(0,0,0,0.25)", padding: "6px 4px 4px" }}>
                                    <Sparkline data={memHist} color={pctColor(memPct)} height={52} />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ── Stat strip ── */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <StatPill
                            icon={Activity}
                            label="CPU Usage"
                            value={cpuPct != null ? `${cpuPct.toFixed(1)}%` : "—"}
                            sub={`${cpu?.physicalCores ?? "?"} physical cores`}
                            accent={cpuPct > 85 ? "red" : cpuPct > 65 ? "amber" : "green"}
                        />
                        <StatPill
                            icon={Database}
                            label="Memory Used"
                            value={memPct != null ? `${memPct.toFixed(1)}%` : "—"}
                            sub={mem?.used ?? ""}
                            accent={memPct > 85 ? "red" : memPct > 65 ? "amber" : "green"}
                        />
                        <StatPill icon={Clock} label="System Uptime" value={os?.uptimeFormatted ?? rt?.processUptimeFmt ?? "—"} sub="continuous runtime" accent="blue" />
                        <StatPill icon={Server} label="Node Runtime" value={rt?.nodeVersion ?? "—"} sub={`PID ${rt?.pid ?? "?"}`} accent="purple" />
                    </div>

                    {/* ── Status chips ── */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <OkPill label="FFmpeg" ok={h?.ffmpegHealthy ?? false} okTxt="Available" nokTxt="Not Found" />
                        <OkPill label="HW Acceleration" ok={h?.hardwareAccelerationHealthy ?? false} okTxt="Active" nokTxt="CPU Only" pulse />
                        <OkPill label="Memory Pressure" ok={!(h?.lowMemoryWarning ?? false)} okTxt="Normal" nokTxt="Low RAM" />
                        <OkPill label="CPU Pressure" ok={!(h?.highCpuWarning ?? false)} okTxt="Normal" nokTxt="High Load" />
                    </div>

                    {/* ── Storage drives ── */}
                    {st?.drives?.length > 0 && (
                        <Card title="Storage Drives" icon={HardDrive}>
                            <div className="space-y-5">
                                {st.drives.map((d, i) => {
                                    const pct = d.usagePercent ?? 0;
                                    const barCls = pct > 90 ? "bg-red-500" : pct > 75 ? "bg-amber-500" : "bg-primary";
                                    const txtCls = pct > 90 ? "text-red-400" : pct > 75 ? "text-amber-400" : "text-emerald-400";
                                    return (
                                        <div key={i} className="space-y-2.5">
                                            <div className="flex items-end justify-between gap-2">
                                                <div>
                                                    <p className="text-sm font-black text-base-content font-mono">{d.mountPoint || d.device}</p>
                                                    <p className="text-[11px] text-base-content/40 mt-0.5">{d.fileSystem || d.type || "disk"}</p>
                                                </div>
                                                <div className="text-right shrink-0">
                                                    <span className={`text-xl font-black tabular-nums ${txtCls}`}>{pct.toFixed(0)}%</span>
                                                    <p className="text-[11px] text-base-content/40">
                                                        {d.used} / {d.total}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
                                                <div className={`h-full rounded-full transition-all duration-700 ${barCls}`} style={{ width: `${Math.min(100, pct)}%` }} />
                                            </div>
                                            <p className="text-[10px] text-base-content/30">{d.free ?? "—"} free</p>
                                        </div>
                                    );
                                })}
                            </div>
                        </Card>
                    )}

                    {/* ── FFmpeg + Transcoding ── */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {ff && (
                            <Card
                                title="FFmpeg Engine"
                                icon={Film}
                                badge={
                                    <span className={`text-[10px] font-black px-2 py-1 rounded-lg ${ff.version ? "text-emerald-400 bg-emerald-400/10" : "text-red-400 bg-red-400/10"}`}>
                                        {ff.version ? "OK" : "ERROR"}
                                    </span>
                                }>
                                <div className="space-y-4">
                                    <KVTable
                                        rows={[
                                            ["Version", ff.version, true],
                                            ["ffprobe", ff.ffprobeAvailable ? (ff.ffprobeVersion ?? "✓") : "✗ Missing", true],
                                        ]}
                                    />
                                    <div>
                                        <p className="text-[10px] font-bold uppercase tracking-widest text-base-content/30 mb-2">Encoder Support</p>
                                        <div className="grid grid-cols-2 gap-1.5">
                                            {[
                                                { label: "NVENC (NVIDIA)", ok: ff.hasNVENC },
                                                { label: "QSV (Intel)", ok: ff.hasQSV },
                                                { label: "VAAPI (Linux)", ok: ff.hasVAAPI },
                                                { label: "libx264 (CPU)", ok: ff.hasLibx264 },
                                            ].map(({ label, ok }) => (
                                                <div key={label} className={`flex items-center gap-2 px-3 py-2 rounded-lg ${ok ? "bg-emerald-500/10" : "bg-white/3"}`}>
                                                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ok ? "bg-emerald-400" : "bg-white/15"}`} />
                                                    <span className={`text-xs font-bold ${ok ? "text-emerald-400" : "text-base-content/25"}`}>{label}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    {ff.hwaccels?.length > 0 && (
                                        <div>
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-base-content/30 mb-2">HW Accelerators</p>
                                            <div className="flex flex-wrap gap-1.5">
                                                {ff.hwaccels.map((a) => (
                                                    <span key={a} className="px-2.5 py-1 rounded-lg text-[11px] font-bold text-primary" style={{ background: "rgba(var(--p),0.1)" }}>
                                                        {a}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </Card>
                        )}

                        {tc && (
                            <Card
                                title="Transcoding Engine"
                                icon={Zap}
                                badge={
                                    tc.hardwareAcceleration ? (
                                        <span className="text-[10px] font-black px-2 py-1 rounded-lg text-primary bg-primary/10">HW</span>
                                    ) : (
                                        <span className="text-[10px] font-black px-2 py-1 rounded-lg text-base-content/40 bg-white/5">CPU</span>
                                    )
                                }>
                                <div className="space-y-4">
                                    <div className="grid grid-cols-3 gap-2">
                                        {[
                                            { label: "HW Accel", value: tc.hardwareAcceleration ? (tc.hwAccelType ?? "On") : "Off", ok: tc.hardwareAcceleration },
                                            { label: "Realtime", value: tc.realtimeCapable ? "Yes" : "No", ok: tc.realtimeCapable },
                                            { label: "Max Sessions", value: tc.maxRecommendedSessions ?? "10", ok: true },
                                        ].map(({ label, value, ok }) => (
                                            <div key={label} className="rounded-xl px-3 py-3 text-center" style={{ background: ok ? "rgba(34,197,94,0.08)" : "rgba(255,255,255,0.04)" }}>
                                                <p className="text-[10px] text-base-content/35 uppercase tracking-widest">{label}</p>
                                                <p className={`text-sm font-black mt-1 ${ok ? "text-emerald-400" : "text-base-content/50"}`}>{value}</p>
                                            </div>
                                        ))}
                                    </div>
                                    <KVTable
                                        rows={[
                                            ["H.264 Encoder", tc.preferredEncoder, true],
                                            ["H.265 Encoder", tc.recommendedH265Encoder, true],
                                            ["Gap Restart", "6 segments (~24s)"],
                                            ["Segment Size", "4 seconds / segment"],
                                            ["Chunk Size", "2 MB (direct play)"],
                                            ["HLS Playlist", "Persistent (list_size 0)"],
                                        ]}
                                    />
                                </div>
                            </Card>
                        )}
                    </div>

                    {/* ── HW Acceleration Priority + Playback Decision ── */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Card title="HW Acceleration Priority" icon={Shield}>
                            <div className="space-y-2">
                                <HWRow rank="1" name="QSV — Intel QuickSync" desc="Checks /dev/dri/renderD128 or test encode" active={qsvOn} />
                                <HWRow rank="2" name="VAAPI — Linux GPU" desc="Checks /dev/dri, runs h264_vaapi" active={vaapiOn} />
                                <HWRow rank="3" name="NVENC — NVIDIA CUDA" desc="Validates h264_nvenc, parses nvidia-smi" active={nvencOn} />
                                <HWRow rank="4" name="libx264 — CPU Fallback" desc="Software encode, always available" active={cpuOnly} />
                            </div>
                        </Card>

                        <Card title="Playback Decision Engine" icon={Play}>
                            <div className="space-y-2">
                                <DecisionRow num="1" color="green" label="Direct Play" desc="Original file streamed verbatim. Codec, container, audio all compatible." />
                                <DecisionRow num="2" color="blue" label="Direct Stream" desc="Codecs match but container incompatible. Remux with -c:v copy -c:a copy." />
                                <DecisionRow num="3" color="amber" label="Audio Transcode" desc="Video copied, audio re-encoded to AAC 192kbps stereo." />
                                <DecisionRow num="4" color="red" label="Full Transcode → HLS" desc="HEVC, WMV, DTS, TrueHD, HDR, or subtitle burn-in required." />
                            </div>
                        </Card>
                    </div>

                    {/* ── Codec Matrix ── */}
                    <Card title="Codec Compatibility Matrix" icon={Radio}>
                        <div className="space-y-4">
                            <div>
                                <p className="text-[10px] font-bold uppercase tracking-widest text-base-content/35 mb-2.5">Video — Native Browser Support</p>
                                <div className="flex flex-wrap gap-1.5">
                                    {[
                                        { label: "H.264 / AVC", ok: true },
                                        { label: "VP8", ok: true },
                                        { label: "VP9", ok: true },
                                        { label: "AV1", ok: true },
                                        { label: "HEVC / H.265", ok: false },
                                        { label: "MPEG-2", ok: false },
                                        { label: "WMV", ok: false },
                                    ].map((c) => (
                                        <CodecChip key={c.label} label={c.label} supported={c.ok} />
                                    ))}
                                </div>
                            </div>
                            <div>
                                <p className="text-[10px] font-bold uppercase tracking-widest text-base-content/35 mb-2.5">Audio — Native Browser Support</p>
                                <div className="flex flex-wrap gap-1.5">
                                    {[
                                        { label: "AAC", ok: true },
                                        { label: "MP3", ok: true },
                                        { label: "Opus", ok: true },
                                        { label: "Vorbis", ok: true },
                                        { label: "FLAC", ok: true },
                                        { label: "PCM", ok: true },
                                        { label: "DTS", ok: false },
                                        { label: "TrueHD", ok: false },
                                        { label: "AC3", ok: false },
                                        { label: "EAC3", ok: false },
                                    ].map((c) => (
                                        <CodecChip key={c.label} label={c.label} supported={c.ok} />
                                    ))}
                                </div>
                            </div>
                            <p className="text-[10px] text-base-content/25 leading-relaxed">
                                ✓ Supported codecs stream via Direct Play / Direct Stream. ✗ Unsupported codecs trigger full HLS transcode to H.264 + AAC.
                            </p>
                        </div>
                    </Card>

                    {/* ── Network Interfaces ── */}
                    {net?.length > 0 && (
                        <Card title="Network Interfaces" icon={Wifi}>
                            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr style={{ background: "rgba(255,255,255,0.04)" }}>
                                            {["Interface", "Address", "Family", "Type"].map((h) => (
                                                <th key={h} className="px-4 py-2.5 text-left font-black uppercase tracking-widest text-base-content/30 text-[10px]">
                                                    {h}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {net.map((n, i) => (
                                            <tr key={i} style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }} className="hover:bg-white/3 transition-colors">
                                                <td className="px-4 py-3 font-mono font-bold text-base-content/80">{n.interface}</td>
                                                <td className="px-4 py-3 font-mono text-base-content/55">{n.address}</td>
                                                <td className="px-4 py-3 text-base-content/40">{n.family}</td>
                                                <td className="px-4 py-3">
                                                    <span
                                                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold
                                                        ${n.type === "external" ? "text-blue-400 bg-blue-400/10" : "text-base-content/30 bg-white/5"}`}>
                                                        {n.type ?? "internal"}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </Card>
                    )}

                    {/* ── OS + Runtime ── */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {os && (
                            <Card title="Operating System" icon={Server}>
                                <KVTable
                                    rows={[
                                        ["Platform", os.platform],
                                        ["Architecture", os.arch],
                                        ["Hostname", os.hostname],
                                        ["Distribution", os.distro],
                                        ["Kernel", os.kernelVersion, true],
                                        ["System Uptime", os.uptimeFormatted],
                                    ]}
                                />
                            </Card>
                        )}

                        {rt && (
                            <Card title="Node.js Runtime" icon={Activity}>
                                <div className="space-y-4">
                                    <KVTable
                                        rows={[
                                            ["Node Version", rt.nodeVersion, true],
                                            ["Process ID", rt.pid, true],
                                            ["Process Uptime", rt.processUptimeFmt],
                                            ["Heap Used", rt.memUsage?.heapUsed],
                                            ["RSS Memory", rt.memUsage?.rss],
                                            ["External Memory", rt.memUsage?.external],
                                        ]}
                                    />

                                    {rt.memUsage?.heapUsedBytes && rt.memUsage?.heapTotalBytes && (
                                        <div className="space-y-2">
                                            <div className="flex justify-between text-[10px] text-base-content/30 font-bold uppercase tracking-widest">
                                                <span>Heap utilisation</span>
                                                <span className="tabular-nums">{((rt.memUsage.heapUsedBytes / rt.memUsage.heapTotalBytes) * 100).toFixed(0)}%</span>
                                            </div>
                                            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
                                                <div
                                                    className="h-full rounded-full bg-primary transition-all duration-700"
                                                    style={{ width: `${Math.min(100, (rt.memUsage.heapUsedBytes / rt.memUsage.heapTotalBytes) * 100)}%` }}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </Card>
                        )}
                    </div>

                    {/* Refresh timestamp footer */}
                    {lastAt && (
                        <p className="text-[11px] text-base-content/20 text-center flex items-center justify-center gap-1.5">
                            <Clock size={10} />
                            Last refreshed {lastAt.toLocaleTimeString()} · Auto-refresh every {REFRESH_MS / 1000}s
                        </p>
                    )}
                </div>
            ) : !error && !loading ? (
                <div className="flex flex-col items-center justify-center py-32 gap-4">
                    <Server size={40} className="text-base-content/15" />
                    <p className="text-base-content/40 text-sm">No health data available</p>
                    <button onClick={load} className="btn btn-sm btn-primary">
                        Retry
                    </button>
                </div>
            ) : null}
        </div>
    );
}
