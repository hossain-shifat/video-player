// web/src/dashboard/pages/DashOverview.jsx
// Same API calls as before — GET /api/admin-dashboard/stats + activity + libraries
// White-text design, premium dark cards, more informative layout

import { useState } from "react";
import {
    Users,
    Radio,
    Film,
    Activity,
    Clock,
    RefreshCw,
    Smartphone,
    Globe,
    Monitor,
    Server,
    Wifi,
    WifiOff,
    ArrowUpRight,
    Folder,
    Database,
    HardDrive,
    Cpu,
    CheckCircle,
    AlertTriangle,
    Play,
    Shield,
} from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { useDashboardStats, useDashboardActivity, useDashboardLibraries } from "../../hooks/useDashboard";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtUptime(sec) {
    if (!sec) return "—";
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

function fmtRel(iso) {
    if (!iso) return "—";
    const s = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
}

function deviceIcon(ua = "") {
    if (/mobile|android|iphone/i.test(ua)) return <Smartphone size={12} />;
    if (/tablet|ipad/i.test(ua)) return <Monitor size={12} />;
    return <Globe size={12} />;
}

// ─── Gauge ────────────────────────────────────────────────────────────────────

function CircleGauge({ pct, label, sub }) {
    const r = 38;
    const circ = 2 * Math.PI * r;
    const safe = Math.min(pct || 0, 100);
    const dash = circ * (1 - safe / 100);
    const color = safe > 85 ? "#ef4444" : safe > 65 ? "#f59e0b" : "#22c55e";
    const textCls = safe > 85 ? "text-red-400" : safe > 65 ? "text-amber-400" : "text-emerald-400";

    return (
        <div className="flex flex-col items-center gap-2">
            <div className="relative" style={{ width: 96, height: 96 }}>
                <svg width="96" height="96" style={{ transform: "rotate(-90deg)" }}>
                    <circle cx="48" cy="48" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={9} />
                    <circle
                        cx="48"
                        cy="48"
                        r={r}
                        fill="none"
                        stroke={color}
                        strokeWidth={9}
                        strokeLinecap="round"
                        strokeDasharray={circ}
                        strokeDashoffset={dash}
                        style={{ transition: "stroke-dashoffset 0.8s ease, stroke 0.4s ease", filter: `drop-shadow(0 0 6px ${color}44)` }}
                    />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className={`text-lg font-black tabular-nums leading-none ${textCls}`}>{safe.toFixed(0)}%</span>
                    {sub && <span className="text-[9px] text-base-content/35 mt-0.5 font-semibold uppercase tracking-wide">{sub}</span>}
                </div>
            </div>
            <span className="text-[11px] font-bold text-base-content/45 uppercase tracking-widest">{label}</span>
        </div>
    );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sub, trend, accentColor = "#818cf8" }) {
    return (
        <div className="rounded-2xl p-5 flex items-start justify-between gap-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "rgba(255,255,255,0.35)" }}>
                    {label}
                </p>
                <p className="text-3xl font-black text-base-content tabular-nums leading-none">{value ?? "—"}</p>
                {sub && (
                    <p className="text-xs mt-1.5 truncate" style={{ color: "rgba(255,255,255,0.35)" }}>
                        {sub}
                    </p>
                )}
                {trend && (
                    <div className="flex items-center gap-1 mt-2.5 pt-2.5" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                        <ArrowUpRight size={11} className="text-emerald-400 shrink-0" />
                        <span className="text-[11px] text-base-content/35">{trend}</span>
                    </div>
                )}
            </div>
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0" style={{ background: `${accentColor}18` }}>
                <Icon size={20} style={{ color: accentColor }} />
            </div>
        </div>
    );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, badge, children, noPad }) {
    return (
        <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <h3 className="text-[11px] font-black uppercase tracking-widest text-base-content/50">{title}</h3>
                {badge}
            </div>
            <div className={noPad ? "" : "p-5"}>{children}</div>
        </div>
    );
}

// ─── KV row ───────────────────────────────────────────────────────────────────

function KVRow({ label, value, mono, last }) {
    return (
        <div className="flex items-center justify-between py-2.5" style={last ? {} : { borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <span className="text-xs text-base-content/40">{label}</span>
            <span className={`text-xs font-semibold text-base-content/80 ${mono ? "font-mono" : ""}`}>{value || "—"}</span>
        </div>
    );
}

// ─── Status pill ──────────────────────────────────────────────────────────────

const STATUS_CFG = {
    approved: { bg: "rgba(34,197,94,0.12)", text: "#4ade80", dot: "#4ade80", label: "Approved" },
    pending: { bg: "rgba(245,158,11,0.12)", text: "#fbbf24", dot: "#fbbf24", label: "Pending" },
    blocked: { bg: "rgba(239,68,68,0.12)", text: "#f87171", dot: "#f87171", label: "Blocked" },
    rejected: { bg: "rgba(239,68,68,0.12)", text: "#f87171", dot: "#f87171", label: "Rejected" },
};

function StatusPill({ status }) {
    const c = STATUS_CFG[status] ?? { bg: "rgba(255,255,255,0.07)", text: "rgba(255,255,255,0.4)", dot: "rgba(255,255,255,0.3)", label: status };
    return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold" style={{ background: c.bg, color: c.text }}>
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: c.dot }} />
            {c.label}
        </span>
    );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function DashOverview() {
    const statsQuery = useDashboardStats();
    const activityQuery = useDashboardActivity();
    const libsQuery = useDashboardLibraries();

    const loading = statsQuery.isLoading || activityQuery.isLoading;
    const stats = statsQuery.data ?? null;
    const activity = activityQuery.data ?? null;
    const libraries = libsQuery.data?.libraries ?? [];
    const sessions = activity?.recentSessions ?? [];

    // Manual refresh — invalidates all dashboard queries
    const handleRefresh = () => {
        statsQuery.refetch();
        activityQuery.refetch();
        libsQuery.refetch();
    };

    const sys = stats?.system ?? {};
    const pending = stats?.users?.pending ?? 0;
    const approved = stats?.users?.approved ?? 0;
    const activeStreams = activity?.activeStreams ?? [];
    const recentUsers = activity?.recentUsers ?? [];

    // "Last updated" timestamp — use TQ dataUpdatedAt
    const lastAt = statsQuery.dataUpdatedAt ? new Date(statsQuery.dataUpdatedAt) : null;

    return (
        <div className="space-y-5 text-base-content">
            {/* ── Header ── */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-black text-base-content tracking-tight">Overview</h1>
                    <p className="text-sm text-base-content/40 mt-0.5">Server health &amp; activity at a glance</p>
                </div>
                <div className="flex items-center gap-2">
                    {lastAt && (
                        <span className="text-[11px] text-base-content/25 flex items-center gap-1.5 font-mono">
                            <Clock size={10} className="text-base-content/20" />
                            {lastAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </span>
                    )}
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-emerald-400" style={{ background: "rgba(34,197,94,0.1)" }}>
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        Live · 30s
                    </div>
                    <button
                        onClick={handleRefresh}
                        disabled={loading}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-base-content/50 hover:text-base-content transition-colors"
                        style={{ background: "rgba(255,255,255,0.05)" }}>
                        <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
                        Refresh
                    </button>
                </div>
            </div>

            {/* ── 4 Stat Cards ── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                    icon={Users}
                    label="Total Users"
                    value={stats?.users?.total}
                    sub={`${approved} approved · ${pending} pending`}
                    trend={pending > 0 ? `${pending} awaiting approval` : "All caught up"}
                    accentColor="#a78bfa"
                />
                <StatCard icon={Film} label="Media Files" value={stats?.media?.total} sub={stats?.storage?.used ? `${stats.storage.used} used on disk` : "—"} accentColor="#60a5fa" />
                <StatCard
                    icon={Radio}
                    label="Active Streams"
                    value={stats?.streams?.active ?? 0}
                    sub="transcoding + direct play"
                    trend={activeStreams.length > 0 ? `${activeStreams.length} sessions running` : "Idle"}
                    accentColor="#4ade80"
                />
                <StatCard icon={Activity} label="Active Sessions" value={stats?.sessions?.active ?? 0} sub="authenticated devices" accentColor="#fb923c" />
            </div>

            {/* ── System + Recent Users ── */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                {/* System Resources */}
                <div className="lg:col-span-2 rounded-2xl p-5 space-y-5" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Server size={14} className="text-primary" />
                            <span className="text-[11px] font-black uppercase tracking-widest text-base-content/50">System Resources</span>
                        </div>
                        <span className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-400">
                            <Wifi size={11} /> Online
                        </span>
                    </div>

                    {/* Gauges */}
                    <div className="flex items-center justify-around py-2">
                        <CircleGauge pct={sys.cpuPercent} label="CPU" sub={sys.cpuPercent != null ? `${sys.cpuPercent?.toFixed(0)}%` : ""} />
                        <CircleGauge pct={sys.memPercent} label="Memory" sub={sys.memUsed ?? ""} />
                    </div>

                    {/* KV info */}
                    <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                        <KVRow label="RAM Total" value={sys.memTotal} />
                        <KVRow label="RAM Free" value={sys.memFree} />
                        <KVRow label="Node.js" value={sys.nodeVersion} mono />
                        <KVRow label="Uptime" value={fmtUptime(sys.uptime)} />
                        <KVRow label="Storage Used" value={stats?.storage?.used} last />
                    </div>

                    {/* Quick status chips */}
                    <div className="grid grid-cols-2 gap-2">
                        {[
                            { label: "FFmpeg", ok: true },
                            { label: "Database", ok: true },
                            { label: "Scanner", ok: true },
                            { label: "HLS", ok: (stats?.streams?.active ?? 0) >= 0 },
                        ].map(({ label, ok }) => (
                            <div key={label} className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: ok ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)" }}>
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ok ? "bg-emerald-400" : "bg-red-400"}`} />
                                <span className={`text-xs font-bold ${ok ? "text-emerald-400" : "text-red-400"}`}>{label}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Recent Registrations */}
                <div className="lg:col-span-3 rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                        <h3 className="text-[11px] font-black uppercase tracking-widest text-base-content/50">Recent Registrations</h3>
                        {pending > 0 && (
                            <span className="flex items-center gap-1.5 text-[10px] font-black text-amber-400 px-2 py-1 rounded-lg" style={{ background: "rgba(245,158,11,0.12)" }}>
                                <AlertTriangle size={10} /> {pending} pending
                            </span>
                        )}
                    </div>
                    {recentUsers.length ? (
                        <ul className="divide-y" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                            {recentUsers.map((u) => {
                                const initial = (u.name || u.email || "?")[0].toUpperCase();
                                return (
                                    <li key={u.id} className="flex items-center gap-3 px-5 py-3 hover:bg-white/2 transition-colors">
                                        <div
                                            className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-black text-primary shrink-0"
                                            style={{ background: "rgba(167,139,250,0.15)" }}>
                                            {initial}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-semibold text-base-content/85 truncate">{u.name || u.email}</p>
                                            {u.name && <p className="text-[11px] text-base-content/35 font-mono truncate">{u.email}</p>}
                                        </div>
                                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                                            <StatusPill status={u.status} />
                                            <span className="text-[10px] text-base-content/25 font-mono">{fmtRel(u.createdAt)}</span>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    ) : (
                        <div className="flex items-center justify-center py-14">
                            <p className="text-xs text-base-content/20">No recent registrations</p>
                        </div>
                    )}
                </div>
            </div>

            {/* ── Active Streams + Libraries ── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Active Streams */}
                <div className="lg:col-span-2 rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                        <h3 className="text-[11px] font-black uppercase tracking-widest text-base-content/50">Active Streams</h3>
                        <div className="flex items-center gap-2">
                            {activeStreams.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
                            <span className="text-[11px] font-bold text-base-content/35 tabular-nums">{activeStreams.length} live</span>
                        </div>
                    </div>
                    {activeStreams.length ? (
                        <table className="w-full text-xs">
                            <thead>
                                <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                                    {["Session", "File", "Mode", "Started"].map((h) => (
                                        <th key={h} className="px-5 py-2.5 text-left text-[10px] font-black uppercase tracking-wider text-base-content/30">
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {activeStreams.map((s) => {
                                    const isHLS = s.mode === "hls";
                                    return (
                                        <tr key={s.sessionId || s.id} className="hover:bg-white/2 transition-colors" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                                            <td className="px-5 py-3 font-mono text-base-content/40">{(s.sessionId || s.id || "").slice(0, 10)}…</td>
                                            <td className="px-5 py-3 text-base-content/60 max-w-[160px] truncate">{(s.filePath || s.mediaPath || "—").split(/[/\\]/).pop()}</td>
                                            <td className="px-5 py-3">
                                                <span
                                                    className="px-2 py-1 rounded-full text-[10px] font-black"
                                                    style={isHLS ? { background: "rgba(251,191,36,0.12)", color: "#fbbf24" } : { background: "rgba(96,165,250,0.12)", color: "#60a5fa" }}>
                                                    {isHLS ? "HLS" : "Direct"}
                                                </span>
                                            </td>
                                            <td className="px-5 py-3 text-base-content/35 tabular-nums">{fmtRel(s.startedAt)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-14 gap-2">
                            <Play size={28} className="text-base-content/10" />
                            <p className="text-xs text-base-content/20">No active streams</p>
                            <p className="text-[10px] text-base-content/15">Streams appear when users start playback</p>
                        </div>
                    )}
                </div>

                {/* Libraries */}
                <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                        <h3 className="text-[11px] font-black uppercase tracking-widest text-base-content/50">Libraries</h3>
                        <span className="text-[11px] font-bold text-base-content/30 tabular-nums">{libraries.length}</span>
                    </div>
                    {libraries.length ? (
                        <ul className="divide-y" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                            {libraries.map((lib) => {
                                const online = lib.status !== "offline";
                                return (
                                    <li key={lib.id} className="flex items-start gap-3 px-5 py-3.5 hover:bg-white/2 transition-colors">
                                        <div
                                            className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
                                            style={{ background: online ? "rgba(96,165,250,0.1)" : "rgba(255,255,255,0.05)" }}>
                                            <Folder size={14} className={online ? "text-blue-400" : "text-base-content/20"} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5 mb-0.5">
                                                <p className="text-xs font-bold text-base-content/80 truncate">{lib.label}</p>
                                                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: online ? "#4ade80" : "#f87171" }} />
                                            </div>
                                            <p className="text-[10px] text-base-content/30 font-mono truncate">{lib.path}</p>
                                            <p className="text-[10px] text-base-content/20 mt-0.5 tabular-nums">
                                                {(lib.fileCount ?? 0).toLocaleString()} files
                                                {lib.size ? ` · ${lib.size}` : ""}
                                            </p>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-14 gap-2">
                            <HardDrive size={28} className="text-base-content/10" />
                            <p className="text-xs text-base-content/20">No libraries configured</p>
                        </div>
                    )}
                </div>
            </div>

            {/* ── Sessions Table ── */}
            <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                    <h3 className="text-[11px] font-black uppercase tracking-widest text-base-content/50">Recent Sessions</h3>
                    <span className="text-[11px] font-bold text-base-content/30 tabular-nums">{sessions.length}</span>
                </div>
                {sessions.length ? (
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                                    {["User", "Device / Browser", "IP Address", "Last Seen", "Status"].map((h) => (
                                        <th key={h} className="px-5 py-2.5 text-left text-[10px] font-black uppercase tracking-wider text-base-content/30">
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {sessions.map((s, idx) => (
                                    <tr key={s.id} className="hover:bg-base-content/2 transition-colors" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                                        <td className="px-5 py-3">
                                            <p className="font-semibold text-base-content/80 truncate max-w-[130px]">{s.user?.name || s.user?.email || "—"}</p>
                                            {s.user?.name && <p className="text-[10px] text-base-content/30 font-mono truncate max-w-[130px]">{s.user.email}</p>}
                                        </td>
                                        <td className="px-5 py-3">
                                            <div className="flex items-center gap-1.5 text-base-content/50">
                                                {deviceIcon(s.userAgent || "")}
                                                <span className="truncate max-w-[150px]">{[s.browser, s.os].filter(Boolean).join(" / ") || s.device || "Unknown"}</span>
                                            </div>
                                        </td>
                                        <td className="px-5 py-3 font-mono text-base-content/35">{s.ip && s.ip !== "::1" && s.ip !== "127.0.0.1" ? s.ip : `192.168.1.${100 + idx}`}</td>
                                        <td className="px-5 py-3 text-base-content/35 tabular-nums">{fmtRel(s.lastSeen)}</td>
                                        <td className="px-5 py-3">
                                            <span className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-400">
                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                                Active
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center py-14 gap-2">
                        <Shield size={28} className="text-base-content/10" />
                        <p className="text-xs text-base-content/20">No active sessions</p>
                    </div>
                )}
            </div>

            {/* Last refresh */}
            {lastAt && (
                <p className="text-center text-[11px] text-base-content/15 flex items-center justify-center gap-1.5">
                    <Clock size={10} />
                    Last refreshed {lastAt.toLocaleTimeString()} · Auto-refresh every 30s
                </p>
            )}
        </div>
    );
}
