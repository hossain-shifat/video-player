// web/src/dashboard/pages/DashJobs.jsx
// Transcoding jobs viewer — uses DaisyUI/Tailwind only, no dashboard.css

import { useState, useEffect, useCallback } from "react";
import { Activity, RefreshCw, Clock } from "lucide-react";
import { dashApi } from "../api/dashboardApi";

function fmtRelTime(iso) {
    if (!iso) return "";
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    return `${Math.floor(m / 60)}h ago`;
}

const STATUS_CLS = {
    processing: "badge-info",
    completed:  "badge-success",
    failed:     "badge-error",
    pending:    "badge-warning",
};

export default function DashJobs() {
    const [jobs, setJobs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await dashApi.jobs();
            setJobs(data?.jobs || []);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
        const t = setInterval(load, 10_000);
        return () => clearInterval(t);
    }, [load]);

    return (
        <div className="space-y-5">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-base-content">Jobs</h1>
                    <p className="text-sm text-base-content/40 mt-0.5">
                        {jobs.length} active transcoding job{jobs.length !== 1 ? "s" : ""}
                    </p>
                </div>
                <button onClick={load} className="btn btn-sm btn-ghost gap-1.5">
                    <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
                </button>
            </div>

            {error && (
                <div className="alert alert-error">
                    <span>{error}</span>
                </div>
            )}

            {loading && !jobs.length ? (
                <div className="flex justify-center py-24">
                    <span className="loading loading-spinner loading-lg text-primary" />
                </div>
            ) : jobs.length === 0 ? (
                <div className="card bg-base-200 shadow-sm">
                    <div className="card-body items-center text-center py-16 gap-3">
                        <Activity size={40} className="text-base-content/15" />
                        <p className="text-base-content/40">No active jobs</p>
                        <p className="text-sm text-base-content/25">Transcoding jobs appear when users start streams</p>
                    </div>
                </div>
            ) : (
                <div className="card bg-base-200 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="table table-sm">
                            <thead>
                                <tr className="text-base-content/40 text-xs uppercase tracking-wider">
                                    <th>Job ID</th>
                                    <th>Type</th>
                                    <th>Media</th>
                                    <th>Position</th>
                                    <th>Started</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {jobs.map((j) => (
                                    <tr key={j.id} className="hover:bg-base-content/3 transition-colors">
                                        <td className="font-mono text-xs text-base-content/40">{j.id?.slice(0, 12)}…</td>
                                        <td>
                                            <span className="badge badge-xs badge-info">{j.type}</span>
                                        </td>
                                        <td className="max-w-xs">
                                            <p className="text-xs text-base-content/60 truncate">{j.mediaId || "—"}</p>
                                        </td>
                                        <td className="text-base-content/50 text-xs">
                                            {j.progress != null
                                                ? `${Math.floor(j.progress / 60)}m ${Math.floor(j.progress % 60)}s`
                                                : "—"}
                                        </td>
                                        <td className="text-base-content/35 text-xs">
                                            <div className="flex items-center gap-1">
                                                <Clock size={10} />
                                                {fmtRelTime(j.startedAt)}
                                            </div>
                                        </td>
                                        <td>
                                            <span className={`badge badge-xs capitalize ${STATUS_CLS[j.status] || "badge-ghost"}`}>
                                                {j.status}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
