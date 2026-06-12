// web/src/dashboard/pages/DashLogs.jsx
// Server: { total, logs: [{ id, ts, level, category, message, meta? }] }

import { useState, useEffect, useCallback, useRef } from "react";
import { RefreshCw, Download, ChevronDown, ChevronRight, Terminal } from "lucide-react";
import { dashApi } from "../api/dashboardApi";

// ── palette ───────────────────────────────────────────────────────────────────
// info  → amber/gold    — eye-catching, warm, readable
// warn  → orange        — clearly a step above info
// error → rose-red      — danger, impossible to miss
// debug → cool slate    — background noise, doesn't compete

const LEVELS = ["info", "warn", "error", "debug"];

const L = {
    info: {
        dot: "bg-amber-400",
        pill: "bg-amber-400/15 text-amber-400 border-amber-400/30 hover:bg-amber-400/25",
        active: "bg-amber-400 text-black border-transparent",
        badge: "border-amber-400/60 text-amber-400",
        row: "",
        msg: "text-amber-300/90",
    },
    warn: {
        dot: "bg-orange-400",
        pill: "bg-orange-400/15 text-orange-400 border-orange-400/30 hover:bg-orange-400/25",
        active: "bg-orange-400 text-black border-transparent",
        badge: "border-orange-400/60 text-orange-400",
        row: "bg-orange-400/[.03]",
        msg: "text-orange-300/90",
    },
    error: {
        dot: "bg-rose-500",
        pill: "bg-rose-500/15 text-rose-400 border-rose-500/30 hover:bg-rose-500/25",
        active: "bg-rose-500 text-white border-transparent",
        badge: "border-rose-500/60 text-rose-400",
        row: "bg-rose-500/[.04]",
        msg: "text-rose-300/90",
    },
    debug: {
        dot: "bg-slate-500",
        pill: "bg-slate-500/10 text-slate-400 border-slate-500/20 hover:bg-slate-500/20",
        active: "bg-slate-500 text-white border-transparent",
        badge: "border-slate-500/40 text-slate-400",
        row: "",
        msg: "text-slate-400/70",
    },
};

const DEF = L.debug;

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtTs(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString(undefined, {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    });
}

function fmtTsShort(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    });
}

// ── Level pill ────────────────────────────────────────────────────────────────

function LevelPill({ level, count, active, onClick }) {
    const s = L[level] || DEF;
    return (
        <button
            onClick={onClick}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold
                        border transition-all duration-150 select-none
                        ${active ? s.active : s.pill}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${s.dot} shrink-0`} />
            {level.toUpperCase()}
            <span className="opacity-60 tabular-nums">{count}</span>
        </button>
    );
}

// ── Detail row ────────────────────────────────────────────────────────────────

function DetailRow({ log }) {
    const s = L[log.level] || DEF;
    return (
        <tr className={`${s.row} border-l-2 ${(s.badge.split(" ")[0] || "border-slate-500/30").replace("border-", "border-l-")}`}>
            <td colSpan={5} className="px-5 py-3">
                <div className="space-y-2 max-w-4xl">
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] font-mono text-base-content/35">
                        <span>
                            <span className="text-base-content/20">ts </span>
                            {log.ts}
                        </span>
                        {log.category && (
                            <span>
                                <span className="text-base-content/20">cat </span>
                                {log.category}
                            </span>
                        )}
                        {log.source && (
                            <span>
                                <span className="text-base-content/20">src </span>
                                {log.source}
                            </span>
                        )}
                    </div>
                    <div className="font-mono text-[11px] text-base-content/60 bg-base-300/60 rounded-lg px-3 py-2.5 break-all leading-relaxed">{log.message}</div>
                    {log.meta && (
                        <pre className="font-mono text-[10px] text-base-content/35 bg-base-300/60 rounded-lg px-3 py-2.5 overflow-x-auto whitespace-pre-wrap break-all">
                            {JSON.stringify(log.meta, null, 2)}
                        </pre>
                    )}
                </div>
            </td>
        </tr>
    );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function DashLogs() {
    const [logs, setLogs] = useState([]);
    const [total, setTotal] = useState(0);
    const [levelFilter, setLevelFilter] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [countdown, setCountdown] = useState(5);
    const [expanded, setExpanded] = useState(null);

    const timerRef = useRef(null);
    const countRef = useRef(null);

    const counts = logs.reduce((acc, l) => {
        acc[l.level] = (acc[l.level] || 0) + 1;
        return acc;
    }, {});

    // ── load ──────────────────────────────────────────────────────────────────
    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params = { limit: 300 };
            if (levelFilter) params.level = levelFilter;
            const data = await dashApi.logs(params);
            setLogs(data.logs || []);
            setTotal(data.total || 0);
        } catch (err) {
            setError(err?.message || "Failed to load logs");
        } finally {
            setLoading(false);
        }
    }, [levelFilter]);

    useEffect(() => {
        load();
    }, [levelFilter]); // eslint-disable-line

    useEffect(() => {
        clearInterval(timerRef.current);
        clearInterval(countRef.current);
        if (!autoRefresh) return;
        setCountdown(5);
        timerRef.current = setInterval(() => {
            load();
            setCountdown(5);
        }, 5000);
        countRef.current = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
        return () => {
            clearInterval(timerRef.current);
            clearInterval(countRef.current);
        };
    }, [autoRefresh, load]);

    // ── export ────────────────────────────────────────────────────────────────
    function downloadLogs() {
        const txt = logs.map((l) => `[${l.ts}] [${(l.level || "").toUpperCase().padEnd(5)}] [${(l.category || "—").padEnd(8)}] ${l.message}`).join("\n");
        const url = URL.createObjectURL(new Blob([txt], { type: "text/plain" }));
        Object.assign(document.createElement("a"), { href: url, download: `flux-logs-${Date.now()}.txt` }).click();
        URL.revokeObjectURL(url);
    }

    // ── render ────────────────────────────────────────────────────────────────
    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-base-content flex items-center gap-2">
                        <Terminal size={20} className="text-base-content/50" />
                        Server Logs
                    </h1>
                    <p className="text-sm text-base-content/35 mt-0.5">
                        {total} entries
                        {loading && <span className="loading loading-dots loading-xs ml-2 text-base-content/30 align-middle" />}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={downloadLogs} disabled={!logs.length} className="btn btn-sm btn-ghost gap-1.5 text-base-content/50">
                        <Download size={13} /> Export
                    </button>
                    <button
                        onClick={() => setAutoRefresh((v) => !v)}
                        className={`btn btn-sm gap-1.5 ${autoRefresh ? "bg-amber-400/15 text-amber-400 border-amber-400/30 hover:bg-amber-400/25" : "btn-ghost text-base-content/50"}`}>
                        <RefreshCw size={13} className={autoRefresh ? "animate-spin" : ""} />
                        {autoRefresh ? `${countdown}s` : "Auto"}
                    </button>
                    <button onClick={load} disabled={loading} className="btn btn-sm btn-ghost text-base-content/50">
                        <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
                    </button>
                </div>
            </div>

            {/* Level pills — only filter */}
            <div className="flex flex-wrap gap-2">
                <button
                    onClick={() => setLevelFilter("")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold
                                border transition-all duration-150 select-none
                                ${!levelFilter ? "bg-base-content text-base-100 border-transparent" : "border-base-content/10 bg-base-200 text-base-content/40 hover:bg-base-300"}`}>
                    ALL
                    <span className="opacity-50 tabular-nums">{total || logs.length}</span>
                </button>
                {LEVELS.map((lv) => (
                    <LevelPill key={lv} level={lv} count={counts[lv] || 0} active={levelFilter === lv} onClick={() => setLevelFilter(levelFilter === lv ? "" : lv)} />
                ))}
            </div>

            {/* Error */}
            {error && <div className="alert alert-error py-2 text-sm">{error}</div>}

            {/* Table */}
            <div className="card bg-base-200 shadow-sm overflow-hidden">
                {loading && !logs.length ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-3">
                        <span className="loading loading-spinner loading-md text-base-content/30" />
                        <p className="text-xs text-base-content/25">Loading logs…</p>
                    </div>
                ) : logs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-2">
                        <Terminal size={28} className="text-base-content/10" />
                        <p className="text-sm text-base-content/20">No log entries found</p>
                        {levelFilter && (
                            <button onClick={() => setLevelFilter("")} className="btn btn-xs btn-ghost mt-1 text-base-content/40">
                                Clear filter
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="overflow-x-auto max-h-[65vh] overflow-y-auto">
                        <table className="table table-xs">
                            <thead className="sticky top-0 z-10 bg-base-200">
                                <tr className="text-base-content/25 text-[10px] uppercase tracking-wider border-b border-base-content/5">
                                    <th className="w-5 py-2.5"></th>
                                    <th className="w-8 py-2.5">#</th>
                                    <th className="w-32 py-2.5 hidden sm:table-cell">Time</th>
                                    <th className="w-16 py-2.5">Level</th>
                                    <th className="w-20 py-2.5 hidden md:table-cell">Category</th>
                                    <th className="py-2.5">Message</th>
                                </tr>
                            </thead>

                            <tbody>
                                {logs.map((log, i) => {
                                    const s = L[log.level] || DEF;
                                    const key = log.id ?? i;
                                    const open = expanded === key;
                                    return [
                                        <tr
                                            key={key}
                                            onClick={() => setExpanded(open ? null : key)}
                                            className={`cursor-pointer border-b border-base-content/[.03]
                                                        transition-colors hover:bg-base-content/[.04]
                                                        ${s.row} ${open ? "bg-base-content/[.05]" : ""}`}>
                                            <td className="text-base-content/15 py-2">{open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</td>
                                            <td className="text-base-content/15 tabular-nums text-[10px] py-2 font-mono">{i + 1}</td>
                                            <td className="hidden sm:table-cell font-mono text-[10px] text-base-content/25 whitespace-nowrap py-2">{fmtTs(log.ts)}</td>
                                            <td className="py-2">
                                                <span className={`badge badge-xs badge-outline rounded-full font-bold text-[9px] tracking-wide ${s.badge}`}>
                                                    {(log.level || "—").slice(0, 4).toUpperCase()}
                                                </span>
                                            </td>
                                            <td className="hidden md:table-cell py-2">
                                                {log.category && <span className="badge badge-xs badge-ghost rounded-full text-base-content/30 text-[9px]">{log.category}</span>}
                                            </td>
                                            <td
                                                className={`py-2 font-mono text-[11px] leading-relaxed
                                                           ${open ? "whitespace-normal break-all" : "truncate"}
                                                           ${s.msg}
                                                           max-w-[160px] sm:max-w-xs md:max-w-sm lg:max-w-lg xl:max-w-2xl`}>
                                                <span className="sm:hidden text-base-content/20 mr-1.5">{fmtTsShort(log.ts)}</span>
                                                {log.message}
                                            </td>
                                        </tr>,
                                        open && <DetailRow key={`${key}-d`} log={log} />,
                                    ];
                                })}
                            </tbody>

                            <tfoot className="border-t border-base-content/5">
                                <tr className="text-base-content/20 text-[10px] uppercase tracking-wider">
                                    <th></th>
                                    <th>#</th>
                                    <th className="hidden sm:table-cell">Time</th>
                                    <th>Level</th>
                                    <th className="hidden md:table-cell">Category</th>
                                    <th>Message</th>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                )}

                {/* footer */}
                {logs.length > 0 && (
                    <div className="px-4 py-2 border-t border-base-content/5 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[11px] text-base-content/20">
                            {logs.length} of {total} entries
                        </span>
                        <div className="flex gap-3 flex-wrap">
                            {LEVELS.filter((lv) => counts[lv]).map((lv) => (
                                <span key={lv} className={`text-[10px] font-semibold tabular-nums ${L[lv].msg}`}>
                                    {lv.toUpperCase()} {counts[lv]}
                                </span>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {logs.length >= 100 && <p className="text-[11px] text-base-content/15 text-center">Showing last {logs.length} entries · use level filter to narrow</p>}
        </div>
    );
}
