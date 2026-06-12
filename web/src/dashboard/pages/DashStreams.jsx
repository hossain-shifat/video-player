// web/src/dashboard/pages/DashStreams.jsx
import { useState, useEffect, useCallback } from "react";
import { Radio, RefreshCw, Square, Clock } from "lucide-react";
import { dashApi } from "../api/dashboardApi";
import ConfirmModal from "../components/ConfirmModal";

function fmtRelTime(iso) {
    if (!iso) return "";
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    return `${Math.floor(m / 60)}h ago`;
}

export default function DashStreams() {
    const [streams, setStreams] = useState([]);
    const [loading, setLoading] = useState(true);
    const [confirm, setConfirm] = useState(null);
    const [stopping, setStopping] = useState(false);
    const [error, setError]   = useState(null);

    const load = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            const data = await dashApi.streams();
            setStreams(data.streams || []);
        } catch (err) { setError(err.message); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => {
        load();
        const t = setInterval(load, 10_000);
        return () => clearInterval(t);
    }, [load]);

    async function handleStopConfirmed() {
        if (!confirm) return;
        setStopping(true);
        try {
            await dashApi.stopStream(confirm);
            setTimeout(load, 500);
            setConfirm(null);
        } catch (err) { setError(err.message); }
        finally { setStopping(false); }
    }

    return (
        <div className="space-y-5">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-base-content">Live Streams</h1>
                    <p className="text-sm text-base-content/45 mt-0.5">
                        {streams.length} active session{streams.length !== 1 ? "s" : ""}
                    </p>
                </div>
                <button onClick={load} className="btn btn-sm btn-ghost gap-1.5">
                    <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
                </button>
            </div>

            {error && <div className="alert alert-error"><span>{error}</span></div>}

            {loading && !streams.length ? (
                <div className="flex justify-center py-20"><span className="loading loading-spinner loading-md text-primary" /></div>
            ) : streams.length === 0 ? (
                <div className="card bg-base-200 shadow-sm">
                    <div className="card-body items-center text-center py-16 gap-3">
                        <Radio size={40} className="text-base-content/15" />
                        <p className="text-base-content/40">No active streams</p>
                        <p className="text-sm text-base-content/25">Streams appear when users start playback</p>
                    </div>
                </div>
            ) : (
                <div className="card bg-base-200 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="table table-sm">
                            <thead>
                                <tr className="text-base-content/40 text-xs uppercase tracking-wider">
                                    <th>Session</th><th>Media</th><th>Position</th><th>Started</th><th>Status</th><th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {streams.map((s) => {
                                    const id = s.sessionId || s.id || "";
                                    return (
                                        <tr key={id} className="hover:bg-base-content/3 transition-colors">
                                            <td>
                                                <div className="flex items-center gap-2">
                                                    <span className="w-2 h-2 rounded-full bg-success animate-pulse inline-block" />
                                                    <span className="font-mono text-xs text-base-content/50">{id.slice(0,14)}…</span>
                                                </div>
                                            </td>
                                            <td className="max-w-xs">
                                                <p className="text-sm text-base-content/70 truncate">{s.filePath || s.mediaPath || "Unknown"}</p>
                                            </td>
                                            <td className="text-base-content/50 text-xs">
                                                {s.downloadPositionSec != null
                                                    ? `${Math.floor(s.downloadPositionSec/60)}m ${Math.floor(s.downloadPositionSec%60)}s`
                                                    : "—"}
                                            </td>
                                            <td className="text-base-content/35 text-xs">
                                                <div className="flex items-center gap-1">
                                                    <Clock size={10}/>{fmtRelTime(s.startedAt)}
                                                </div>
                                            </td>
                                            <td><span className="badge badge-xs badge-success">Live</span></td>
                                            <td>
                                                <button
                                                    onClick={() => setConfirm(id)}
                                                    className="btn btn-ghost btn-xs text-error hover:bg-error/10"
                                                    title="Stop stream"
                                                >
                                                    <Square size={13} />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            <ConfirmModal
                open={!!confirm}
                onClose={() => !stopping && setConfirm(null)}
                onConfirm={handleStopConfirmed}
                title="Stop Stream?"
                message="This will terminate the active transcoding session. The user will be disconnected."
                variant="warning"
                confirmText="Stop Stream"
                loading={stopping}
            />
        </div>
    );
}
