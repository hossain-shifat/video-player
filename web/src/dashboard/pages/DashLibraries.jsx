// web/src/dashboard/pages/DashLibraries.jsx

import { useState, useEffect, useCallback, useRef } from "react";
import {
    HardDrive,
    RefreshCw,
    AlertTriangle,
    Film,
    Tv2,
    Swords,
    FolderOpen,
    Database,
    FileVideo,
    Layers,
    WifiOff,
    CheckCircle2,
    Eye,
    RotateCcw,
    Pencil,
    Trash2,
    X,
    Copy,
    Check,
    Server,
    TrendingUp,
    Activity,
    Loader2,
    Info,
    SquarePen,
} from "lucide-react";
import { dashApi } from "../api/dashboardApi";
import { api } from "../../api/client";
import { Link } from "react-router";

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtBytes(b) {
    if (!b || b === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(b) / Math.log(1024));
    return `${(b / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function fmtDate(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
    });
}

function guessType(folder) {
    const s = (folder.label + " " + folder.path).toLowerCase();
    if (s.includes("anime")) return { label: "Anime", Icon: Swords, badgeClass: "badge-accent", barClass: "progress-accent", dotClass: "bg-accent" };
    if (s.includes("series") || s.includes("tv") || s.includes("show")) return { label: "TV", Icon: Tv2, badgeClass: "badge-info", barClass: "progress-info", dotClass: "bg-info" };
    return { label: "Movies", Icon: Film, badgeClass: "badge-primary", barClass: "progress-primary", dotClass: "bg-primary" };
}

// ─── copy hook ────────────────────────────────────────────────────────────────
function useCopy() {
    const [copied, setCopied] = useState(false);
    const copy = (text) => {
        navigator.clipboard?.writeText(text).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
    };
    return [copied, copy];
}

// ─── Detail Modal (view only) ─────────────────────────────────────────────────
function DetailModal({ lib, totalSize, onClose, onEdit }) {
    const [copied, copy] = useCopy();
    if (!lib) return null;

    const { label: typeLabel, Icon, badgeClass, barClass } = guessType(lib);
    const online = lib.status === "online";
    const pct = totalSize > 0 ? Math.min(100, Math.round(((lib.sizeBytes || 0) / totalSize) * 100)) : 0;

    return (
        <div className="fixed inset-0 z-100 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
            <div className="relative w-full max-w-lg bg-base-200 rounded-2xl shadow-2xl border border-base-content/10 overflow-hidden" onClick={(e) => e.stopPropagation()}>
                {/* header */}
                <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-base-content/8">
                    <div className="flex items-center gap-3 min-w-0">
                        <div
                            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0
                            ${online ? "bg-primary/10" : "bg-base-300"}`}>
                            <Icon size={18} className={online ? "text-primary" : "text-base-content/30"} />
                        </div>
                        <div className="min-w-0">
                            <h2 className="font-bold text-base text-base-content truncate leading-tight">{lib.label || "Unnamed Library"}</h2>
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                <span className={`badge badge-sm badge-outline rounded-full ${badgeClass}`}>{typeLabel}</span>
                                {online ? (
                                    <span className="badge badge-sm badge-success badge-outline rounded-full gap-1">
                                        <CheckCircle2 size={9} /> Online
                                    </span>
                                ) : (
                                    <span className="badge badge-sm badge-error   badge-outline rounded-full gap-1">
                                        <WifiOff size={9} /> Offline
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                    <button onClick={onClose} className="btn btn-ghost btn-xs btn-square rounded-lg ml-2 shrink-0">
                        <X size={15} />
                    </button>
                </div>

                {/* path */}
                <div className="px-6 py-3 bg-base-300/30 border-b border-base-content/6 flex items-center gap-2">
                    <FolderOpen size={12} className="text-base-content/40 shrink-0" />
                    <p className="text-[12px] font-mono text-base-content/60 flex-1 truncate" title={lib.path}>
                        {lib.path}
                    </p>
                    <button onClick={() => copy(lib.path)} className="btn btn-ghost btn-xs btn-square rounded shrink-0" title="Copy path">
                        {copied ? <Check size={11} className="text-success" /> : <Copy size={11} />}
                    </button>
                </div>

                {/* stats grid */}
                <div className="px-6 py-5">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-base-content/40 mb-3">Library Statistics</p>
                    <div className="grid grid-cols-2 gap-3">
                        {[
                            { icon: <FileVideo size={14} />, label: "Total Media Files", value: (lib.fileCount ?? 0).toLocaleString() },
                            { icon: <Database size={14} />, label: "Storage Used", value: lib.size || fmtBytes(lib.sizeBytes) },
                            { icon: <TrendingUp size={14} />, label: "Share of Total Storage", value: `${pct}%` },
                            { icon: <Activity size={14} />, label: "Added", value: fmtDate(lib.addedAt) },
                        ].map(({ icon, label, value }) => (
                            <div key={label} className="bg-base-300/50 rounded-xl px-4 py-3 border border-base-content/5">
                                <div className="flex items-center gap-1.5 mb-1.5">
                                    <span className="text-base-content/40">{icon}</span>
                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-base-content/45">{label}</p>
                                </div>
                                <p className="text-sm font-bold text-base-content tabular-nums">{value}</p>
                            </div>
                        ))}
                    </div>
                </div>

                {/* storage bar */}
                <div className="px-6 pb-5 space-y-2">
                    <div className="flex items-center justify-between">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-base-content/40">Disk Usage Share</p>
                        <span className="text-xs font-bold text-base-content tabular-nums">{pct}%</span>
                    </div>
                    <progress className={`progress w-full h-2 rounded-full ${online ? barClass : "progress-error"}`} value={pct} max="100" />
                    <p className="text-[11px] text-base-content/40">
                        {lib.size || fmtBytes(lib.sizeBytes)} of {fmtBytes(totalSize)} total
                    </p>
                </div>

                {/* footer actions */}
                <div className="px-6 pb-5 flex items-center gap-2 border-t border-base-content/8 pt-4">
                    <button
                        onClick={() => {
                            onClose();
                            onEdit(lib);
                        }}
                        className="btn btn-sm btn-ghost gap-1.5">
                        <SquarePen size={13} /> Edit Library
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Edit Modal (functional — calls PATCH /api/library/:id) ──────────────────
function EditModal({ lib, onClose, onSaved }) {
    const [label, setLabel] = useState(lib?.label || "");
    const [path, setPath] = useState(lib?.path || "");
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState(null);

    if (!lib) return null;

    async function handleSave() {
        if (!label.trim() && !path.trim()) return;
        setSaving(true);
        setErr(null);
        try {
            const updates = {};
            if (label.trim() !== lib.label) updates.label = label.trim();
            if (path.trim() !== lib.path) updates.path = path.trim();
            if (Object.keys(updates).length === 0) {
                onClose();
                return;
            }

            await api.patch(`/api/library/${lib.id}`, updates);
            onSaved({ ...lib, ...updates });
            onClose();
        } catch (e) {
            setErr(e.message || "Save failed");
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="fixed inset-0 z-100 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
            <div className="relative w-full max-w-md bg-base-200 rounded-2xl shadow-2xl border border-base-content/10 overflow-hidden" onClick={(e) => e.stopPropagation()}>
                {/* header */}
                <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-base-content/8">
                    <div>
                        <h2 className="font-bold text-base text-base-content">Edit Library</h2>
                        <p className="text-[12px] text-base-content/45 mt-0.5">Update label or folder path</p>
                    </div>
                    <button onClick={onClose} className="btn btn-ghost btn-xs btn-square rounded-lg">
                        <X size={15} />
                    </button>
                </div>

                {/* form */}
                <div className="px-6 py-5 space-y-4">
                    {err && (
                        <div className="alert alert-error text-sm py-2 px-3 rounded-xl">
                            <AlertTriangle size={14} />
                            <span>{err}</span>
                        </div>
                    )}

                    {/* label */}
                    <div className="space-y-1.5">
                        <label htmlFor="edit-lib-label" className="text-[11px] font-semibold uppercase tracking-widest text-base-content/50">
                            Display Name
                        </label>
                        <input
                            id="edit-lib-label"
                            name="label"
                            type="text"
                            value={label}
                            onChange={(e) => setLabel(e.target.value)}
                            className="input input-sm w-full bg-base-300 border border-base-content/10 rounded-xl focus:outline-none focus:border-primary/40 text-sm"
                            placeholder="e.g. My Movies"
                        />
                    </div>

                    {/* path */}
                    <div className="space-y-1.5">
                        <label htmlFor="edit-lib-path" className="text-[11px] font-semibold uppercase tracking-widest text-base-content/50">
                            Folder Path
                        </label>
                        <input
                            id="edit-lib-path"
                            name="path"
                            type="text"
                            value={path}
                            onChange={(e) => setPath(e.target.value)}
                            className="input input-sm w-full bg-base-300 border border-base-content/10 rounded-xl focus:outline-none focus:border-primary/40 text-sm font-mono"
                            placeholder="e.g. D:\Media\Movies"
                        />
                        <p className="text-[11px] text-base-content/35">Must be an absolute path accessible by the server.</p>
                    </div>
                </div>

                {/* footer */}
                <div className="px-6 pb-5 flex items-center justify-end gap-2 border-t border-base-content/8 pt-4">
                    <button onClick={onClose} className="btn btn-sm btn-ghost rounded-xl">
                        Cancel
                    </button>
                    <button onClick={handleSave} disabled={saving} className="btn btn-sm btn-primary rounded-xl gap-1.5 disabled:opacity-60">
                        {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                        {saving ? "Saving…" : "Save Changes"}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Remove Confirm Modal ─────────────────────────────────────────────────────
function RemoveModal({ lib, onClose, onRemoved }) {
    const [removing, setRemoving] = useState(false);
    const [err, setErr] = useState(null);
    if (!lib) return null;

    async function handleRemove() {
        setRemoving(true);
        setErr(null);
        try {
            await api.delete(`/api/library/${lib.id}`);
            onRemoved(lib.id);
            onClose();
        } catch (e) {
            setErr(e.message || "Remove failed");
            setRemoving(false);
        }
    }

    return (
        <div className="fixed inset-0 z-100 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
            <div className="relative w-full max-w-sm bg-base-200 rounded-2xl shadow-2xl border border-base-content/10 overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="px-6 pt-5 pb-4 border-b border-base-content/8">
                    <h2 className="font-bold text-base text-base-content">Remove Library</h2>
                    <p className="text-[12px] text-base-content/45 mt-0.5">This cannot be undone.</p>
                </div>
                <div className="px-6 py-5 space-y-3">
                    {err && (
                        <div className="alert alert-error text-sm py-2 px-3 rounded-xl">
                            <AlertTriangle size={14} />
                            <span>{err}</span>
                        </div>
                    )}
                    <div className="bg-base-300/50 rounded-xl px-4 py-3 border border-base-content/5">
                        <p className="text-sm font-semibold text-base-content">{lib.label}</p>
                        <p className="text-[11px] font-mono text-base-content/45 truncate mt-0.5">{lib.path}</p>
                    </div>
                    <p className="text-sm text-base-content/60">
                        Removing this library will stop FLUX from scanning this folder. Your media files on disk will <span className="font-semibold text-base-content/80">not</span> be deleted.
                    </p>
                </div>
                <div className="px-6 pb-5 flex items-center justify-end gap-2 border-t border-base-content/8 pt-4">
                    <button onClick={onClose} className="btn btn-sm btn-ghost rounded-xl">
                        Cancel
                    </button>
                    <button onClick={handleRemove} disabled={removing} className="btn btn-sm btn-error rounded-xl gap-1.5 disabled:opacity-60">
                        {removing ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                        {removing ? "Removing…" : "Remove Library"}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Rescan toast (calls POST /api/metadata/refresh-all) ─────────────────────
// No per-library rescan endpoint exists in the API — refresh-all is the mechanism.
async function triggerRescan(libLabel, setToast) {
    setToast({ msg: `Rescanning "${libLabel}"…`, type: "info" });
    try {
        await api.post("/api/metadata/refresh-all", {});
        setToast({ msg: "Metadata cache cleared. Rescan complete.", type: "success" });
    } catch (e) {
        setToast({ msg: e.message || "Rescan failed", type: "error" });
    }
    setTimeout(() => setToast(null), 3500);
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ toast }) {
    if (!toast) return null;
    const color = toast.type === "success" ? "alert-success" : toast.type === "error" ? "alert-error" : "alert-info";
    return (
        <div className={`fixed bottom-5 right-5 z-200 alert ${color} shadow-lg max-w-xs text-sm py-2.5 px-4 rounded-xl`}>
            <span>{toast.msg}</span>
        </div>
    );
}

// ─── Inline action icon button ────────────────────────────────────────────────
function ActionBtn({ icon: Icon, title, onClick, danger = false, spinning = false }) {
    return (
        <button
            title={title}
            onClick={(e) => {
                e.stopPropagation();
                onClick();
            }}
            disabled={spinning}
            className={[
                "btn btn-ghost btn-sm btn-square rounded-lg",
                // "opacity-0 group-hover:opacity-100 focus:opacity-100",
                "disabled:opacity-40",
                danger ? "hover:bg-error/15 hover:text-error text-base-content/50" : "hover:bg-base-content/10 text-base-content/50 hover:text-base-content",
            ].join(" ")}>
            {spinning ? <Loader2 size={15} className="animate-spin" /> : <Icon size={16} />}
        </button>
    );
}

// ─── Skeleton row ─────────────────────────────────────────────────────────────
function SkeletonRow() {
    return (
        <tr className="border-b border-base-content/5">
            {[6, 22, 18, 10, 10, 8, 10, 18, 10].map((w, i) => (
                <td key={i} className="px-4 py-3.5">
                    <div className="h-3 rounded bg-base-content/8 animate-pulse" style={{ width: `${w}%`, minWidth: "2rem" }} />
                </td>
            ))}
        </tr>
    );
}

// ─── Metric chip ──────────────────────────────────────────────────────────────
function MetricChip({ icon: Icon, label, value, accent }) {
    return (
        <div className="flex items-center gap-2.5 bg-base-200 border border-base-content/8 rounded-xl px-4 py-2.5 shadow-sm">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: `color-mix(in oklch, ${accent} 15%, transparent)` }}>
                <Icon size={13} style={{ color: accent }} />
            </div>
            <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-base-content/45 leading-none">{label}</p>
                <p className="text-sm font-bold text-base-content mt-0.5 tabular-nums leading-none">{value}</p>
            </div>
        </div>
    );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function DashLibraries() {
    const [libs, setLibs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // modal states
    const [detailLib, setDetailLib] = useState(null);
    const [editLib, setEditLib] = useState(null);
    const [removeLib, setRemoveLib] = useState(null);

    // per-row rescan spinner map { [id]: bool }
    const [rescanning, setRescanning] = useState({});

    // toast
    const [toast, setToast] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await dashApi.libraries();
            setLibs(data?.libraries ?? []);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    // computed
    const totalFiles = libs.reduce((a, l) => a + (l.fileCount ?? 0), 0);
    const totalSize = libs.reduce((a, l) => a + (l.sizeBytes ?? 0), 0);
    const onlineCount = libs.filter((l) => l.status === "online").length;
    const offlineCount = libs.length - onlineCount;

    // handlers
    function handleSaved(updated) {
        setLibs((prev) => prev.map((l) => (l.id === updated.id ? { ...l, ...updated } : l)));
    }

    function handleRemoved(id) {
        setLibs((prev) => prev.filter((l) => l.id !== id));
    }

    async function handleRescan(lib) {
        setRescanning((r) => ({ ...r, [lib.id]: true }));
        await triggerRescan(lib.label, setToast);
        setRescanning((r) => ({ ...r, [lib.id]: false }));
    }

    return (
        <>
            {/* modals */}
            {detailLib && (
                <DetailModal
                    lib={detailLib}
                    totalSize={totalSize}
                    onClose={() => setDetailLib(null)}
                    onEdit={(lib) => {
                        setDetailLib(null);
                        setEditLib(lib);
                    }}
                />
            )}
            {editLib && <EditModal lib={editLib} onClose={() => setEditLib(null)} onSaved={handleSaved} />}
            {removeLib && <RemoveModal lib={removeLib} onClose={() => setRemoveLib(null)} onRemoved={handleRemoved} />}
            <Toast toast={toast} />

            <div className="space-y-5">
                {/* header */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h1 className="text-xl font-bold text-base-content tracking-tight">Libraries</h1>
                        <p className="text-sm text-base-content/50 mt-0.5">Media folder management and storage monitoring</p>
                    </div>
                    <div className="flex gap-2">
                        <Link to="/settings" className="btn btn-sm btn-primary gap-1.5">
                            <FolderOpen size={12} />
                            Add Library
                        </Link>
                        <button onClick={load} disabled={loading} className="btn btn-sm btn-ghost gap-1.5 disabled:opacity-50">
                            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
                            Refresh
                        </button>
                    </div>
                </div>

                {/* error */}
                {error && (
                    <div className="alert alert-error shadow-sm text-sm">
                        <AlertTriangle size={15} />
                        <span>{error}</span>
                    </div>
                )}

                {/* metrics */}
                {(!loading || libs.length > 0) && (
                    <div className="flex flex-wrap gap-2">
                        <MetricChip icon={Layers} label="Libraries" value={loading ? "—" : libs.length} accent="oklch(var(--p))" />
                        <MetricChip icon={FileVideo} label="Total Files" value={loading ? "—" : totalFiles.toLocaleString()} accent="oklch(var(--in))" />
                        <MetricChip icon={Database} label="Total Storage" value={loading ? "—" : fmtBytes(totalSize)} accent="oklch(var(--su))" />
                        <MetricChip
                            icon={Server}
                            label="Online / Offline"
                            value={loading ? "—" : `${onlineCount} / ${offlineCount}`}
                            accent={offlineCount > 0 ? "oklch(var(--er))" : "oklch(var(--su))"}
                        />
                    </div>
                )}

                {/* main table */}
                <div className="card bg-base-200 border border-base-content/8 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="table w-full text-sm">
                            <thead className="sticky top-0 z-10 bg-base-300/95 backdrop-blur-sm border-b border-base-content/8">
                                <tr className="text-[10px] font-semibold uppercase tracking-widest text-base-content/50">
                                    <th className="pl-5 pr-3 py-3.5 w-10">#</th>
                                    <th className="px-3 py-3.5">Library</th>
                                    <th className="px-3 py-3.5 hidden md:table-cell">Path</th>
                                    <th className="px-3 py-3.5">Type</th>
                                    <th className="px-3 py-3.5">Status</th>
                                    <th className="px-3 py-3.5 text-right hidden sm:table-cell">Files</th>
                                    <th className="px-3 py-3.5 text-right hidden sm:table-cell">Storage</th>
                                    <th className="px-3 py-3.5 hidden lg:table-cell min-w-130px">Usage %</th>
                                    {/* action column header */}
                                    <th className="pl-3 pr-4 py-3.5 text-center w-32">Actions</th>
                                </tr>
                            </thead>

                            <tbody>
                                {loading ? (
                                    [...Array(4)].map((_, i) => <SkeletonRow key={i} />)
                                ) : libs.length === 0 ? (
                                    <tr>
                                        <td colSpan={9}>
                                            <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
                                                <div className="w-14 h-14 rounded-2xl bg-base-300 flex items-center justify-center">
                                                    <HardDrive size={26} className="text-base-content/25" />
                                                </div>
                                                <div className="max-w-xs">
                                                    <p className="font-semibold text-base-content/60">No libraries configured</p>
                                                    <p className="text-[13px] text-base-content/40 mt-1.5 leading-relaxed">
                                                        Libraries are folders FLUX scans for video files. Add one via <span className="font-medium text-base-content/55">Settings → Library</span>.
                                                    </p>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    libs.map((lib, i) => {
                                        const { label: typeLabel, Icon, badgeClass, barClass } = guessType(lib);
                                        const online = lib.status === "online";
                                        const pct = totalSize > 0 ? Math.min(100, Math.round(((lib.sizeBytes || 0) / totalSize) * 100)) : 0;

                                        return (
                                            <tr
                                                key={lib.id}
                                                className="group border-b border-base-content/5 last:border-0
                                                    hover:bg-base-content/4 transition-colors cursor-pointer"
                                                onClick={() => setDetailLib(lib)}>
                                                {/* # */}
                                                <td className="pl-5 pr-3 py-3.5 text-base-content/30 font-mono text-xs tabular-nums">{String(i + 1).padStart(2, "0")}</td>

                                                {/* name */}
                                                <td className="px-3 py-3.5">
                                                    <div className="flex items-center gap-2.5">
                                                        <div
                                                            className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0
                                                            ${online ? "bg-base-300" : "bg-base-300/60"}`}>
                                                            <Icon size={13} className={online ? "text-base-content/60" : "text-base-content/25"} />
                                                        </div>
                                                        <span className="font-semibold text-base-content leading-tight">{lib.label || "Unnamed Library"}</span>
                                                    </div>
                                                </td>

                                                {/* path */}
                                                <td className="px-3 py-3.5 hidden md:table-cell max-w-180px">
                                                    <p className="text-[12px] font-mono text-base-content/45 truncate" title={lib.path}>
                                                        {lib.path}
                                                    </p>
                                                </td>

                                                {/* type */}
                                                <td className="px-3 py-3.5">
                                                    <span className={`badge badge-sm badge-outline rounded-full font-medium ${badgeClass}`}>{typeLabel}</span>
                                                </td>

                                                {/* status */}
                                                <td className="px-3 py-3.5">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${online ? "bg-success" : "bg-error"}`} />
                                                        <span className={`text-xs font-medium ${online ? "text-success" : "text-error"}`}>{online ? "Online" : "Offline"}</span>
                                                    </div>
                                                </td>

                                                {/* files */}
                                                <td className="px-3 py-3.5 text-right hidden sm:table-cell">
                                                    <span className="text-sm font-medium text-base-content tabular-nums">{(lib.fileCount ?? 0).toLocaleString()}</span>
                                                </td>

                                                {/* storage */}
                                                <td className="px-3 py-3.5 text-right hidden sm:table-cell">
                                                    <span className="text-sm font-medium text-base-content tabular-nums">{lib.size || fmtBytes(lib.sizeBytes)}</span>
                                                </td>

                                                {/* usage % */}
                                                <td className="px-3 py-3.5 hidden lg:table-cell">
                                                    <div className="flex items-center gap-2.5">
                                                        <progress className={`progress h-1.5 w-20 rounded-full ${online ? barClass : "progress-error"}`} value={pct} max="100" />
                                                        <span className="text-[11px] font-semibold text-base-content/50 tabular-nums w-8 text-right">{pct}%</span>
                                                    </div>
                                                </td>

                                                {/* ── action icon buttons ── */}
                                                <td className="pl-3 pr-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                                                    <div className="flex items-center justify-center gap-0.5">
                                                        {/* Details */}
                                                        <ActionBtn icon={Info} title="View details" onClick={() => setDetailLib(lib)} />
                                                        {/* Rescan */}
                                                        <ActionBtn icon={RotateCcw} title="Rescan library" onClick={() => handleRescan(lib)} spinning={!!rescanning[lib.id]} />
                                                        {/* Edit */}
                                                        <ActionBtn icon={SquarePen} title="Edit library" onClick={() => setEditLib(lib)} />
                                                        {/* Remove */}
                                                        <ActionBtn icon={Trash2} title="Remove library" onClick={() => setRemoveLib(lib)} danger />
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* table footer */}
                    {!loading && libs.length > 0 && (
                        <div className="px-5 py-3 border-t border-base-content/5 flex items-center justify-between">
                            <p className="text-[11px] text-base-content/40">
                                {libs.length} {libs.length === 1 ? "library" : "libraries"} · {totalFiles.toLocaleString()} files · {fmtBytes(totalSize)} total
                            </p>
                            <p className="text-[11px] text-base-content/30 hidden sm:block">Click row to inspect</p>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}
