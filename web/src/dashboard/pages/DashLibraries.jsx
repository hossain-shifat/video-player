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
    Check,
    Server,
    TrendingUp,
    Activity,
    Loader2,
    Info,
    SquarePen,
    Cloud,
} from "lucide-react";
import { dashApi } from "../api/dashboardApi";
import { api } from "../../api/client";
import { storageApi } from "../api/storageApi";
import { Link } from "react-router";
import ConfirmModal, { ModalShell, ModalHeader, ModalContent, ModalSection, ModalRows, ModalKV, ModalStats, ModalCallout, ModalReview, ModalCopyButton, ModalFooter, ModalBadge, ModalButton, ModalMeter, PANEL, MODAL_INPUT, TONE } from "../components/ConfirmModal";

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
    if (s.includes("anime")) return { label: "Anime", Icon: Swords, tone: "accent", badgeClass: "badge-accent", barClass: "progress-accent", dotClass: "bg-accent" };
    if (s.includes("series") || s.includes("tv") || s.includes("show")) return { label: "TV", Icon: Tv2, tone: "info", badgeClass: "badge-info", barClass: "progress-info", dotClass: "bg-info" };
    return { label: "Movies", Icon: Film, tone: "primary", badgeClass: "badge-primary", barClass: "progress-primary", dotClass: "bg-primary" };
}

// ─── Detail Modal (view only) ─────────────────────────────────────────────────
function DetailModal({ lib, totalSize, onClose, onEdit }) {
    if (!lib) return null;

    const { label: typeLabel, Icon, tone } = guessType(lib);
    const online = lib.status === "online";
    const pct = totalSize > 0 ? Math.min(100, Math.round(((lib.sizeBytes || 0) / totalSize) * 100)) : 0;
    const used = lib.size || fmtBytes(lib.sizeBytes);

    return (
        <ModalShell onClose={onClose} labelledBy="lib-detail-t">
            <ModalHeader
                id="lib-detail-t"
                icon={Icon}
                tone={online ? TONE[tone] : "text-base-content/50"}
                title={lib.label || "Unnamed Library"}
                subtitle={<span className="font-mono">{lib.path}</span>}
                badges={
                    <>
                        <ModalBadge tone={tone}>{typeLabel}</ModalBadge>
                        {online ? (
                            <ModalBadge tone="success" icon={CheckCircle2}>
                                Online
                            </ModalBadge>
                        ) : (
                            <ModalBadge tone="error" icon={WifiOff}>
                                Offline
                            </ModalBadge>
                        )}
                    </>
                }
                onClose={onClose}
            />
            <ModalContent>
                <ModalStats
                    items={[
                        { icon: FileVideo, tone: "text-info", label: "Media files", value: (lib.fileCount ?? 0).toLocaleString() },
                        { icon: Database, tone: "text-success", label: "Storage used", value: used },
                        { icon: TrendingUp, tone: "text-warning", label: "Share of total", value: `${pct}%` },
                    ]}
                />

                <section className={`${PANEL} flex shrink-0 flex-col gap-3 px-4 py-4`}>
                    <div className="flex items-center justify-between gap-3 text-[13px]">
                        <span className="text-base-content">Disk usage share</span>
                        <span className="text-xs text-base-content/60">
                            {used} of {fmtBytes(totalSize)} total
                        </span>
                    </div>
                    <ModalMeter value={pct} tone={online ? tone : "error"} label="Disk usage share" />
                </section>

                <ModalSection label="Library" grow>
                    <ModalRows className="flex-1">
                        <ModalKV icon={FolderOpen} tone="text-primary" label="Path" mono action={<ModalCopyButton text={lib.path} label="path" />}>
                            <span title={lib.path}>{lib.path}</span>
                        </ModalKV>
                        <ModalKV icon={Icon} tone={TONE[tone]} label="Type">
                            {typeLabel}
                        </ModalKV>
                        <ModalKV icon={Server} tone={online ? "text-success" : "text-error"} label="Status">
                            <span className={online ? "text-success" : "text-error"}>{online ? "Online" : "Offline"}</span>
                        </ModalKV>
                        <ModalKV icon={Activity} label="Added">
                            {fmtDate(lib.addedAt)}
                        </ModalKV>
                    </ModalRows>
                </ModalSection>
            </ModalContent>
            <ModalFooter note="Click a library row to inspect it">
                <ModalButton onClick={onClose}>Close</ModalButton>
                <ModalButton
                    variant="primary"
                    className="gap-1.5"
                    onClick={() => {
                        onClose();
                        onEdit(lib);
                    }}>
                    <SquarePen size={14} />
                    Edit library
                </ModalButton>
            </ModalFooter>
        </ModalShell>
    );
}

// ─── Edit Modal (functional — calls PATCH /api/library/:id) ──────────────────
function EditModal({ lib, onClose, onSaved }) {
    const [label, setLabel] = useState(lib?.label || "");
    const [path, setPath] = useState(lib?.path || "");
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState(null);

    if (!lib) return null;

    const changes = [
        label.trim() !== (lib.label || "") && { name: "Name", from: lib.label || "—", to: label.trim() || "—" },
        path.trim() !== (lib.path || "") && { name: "Path", from: lib.path || "—", to: path.trim() || "—" },
    ].filter(Boolean);
    const dirty = changes.length > 0;

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
        <ModalShell onClose={onClose} busy={saving} labelledBy="lib-edit-t">
            <ModalHeader id="lib-edit-t" icon={SquarePen} tone="text-warning" title="Edit Library" subtitle={lib.label || lib.path} onClose={onClose} busy={saving} />
            <ModalContent>
                <ModalSection label="Display name">
                    <input
                        id="edit-lib-label"
                        name="label"
                        type="text"
                        data-autofocus
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        className={`${MODAL_INPUT} !h-[42px] ${label.trim() !== (lib.label || "") ? "!border-primary/60" : ""}`}
                        placeholder="e.g. My Movies"
                    />
                </ModalSection>
                <div className="flex shrink-0 flex-col gap-2">
                    <ModalSection label="Folder path">
                        <input
                            id="edit-lib-path"
                            name="path"
                            type="text"
                            value={path}
                            onChange={(e) => setPath(e.target.value)}
                            className={`${MODAL_INPUT} !h-[42px] font-mono ${path.trim() !== (lib.path || "") ? "!border-primary/60" : ""}`}
                            placeholder="e.g. D:\Media\Movies"
                        />
                    </ModalSection>
                    <p className="text-xs text-base-content/55">Must be an absolute path accessible by the server.</p>
                </div>

                <ModalStats
                    items={[
                        { icon: FileVideo, tone: "text-info", label: "Files", value: lib.fileCount?.toLocaleString?.() ?? lib.fileCount ?? "—" },
                        { icon: Database, tone: "text-success", label: "Size", value: lib.sizeBytes != null ? fmtBytes(lib.sizeBytes) : "—" },
                    ]}
                />

                {err && (
                    <ModalCallout tone="error" icon={AlertTriangle} compact className="mt-auto">
                        {err}
                    </ModalCallout>
                )}
                <ModalReview
                    changes={changes}
                    saved={[
                        { name: "Name", value: lib.label },
                        { name: "Path", value: lib.path },
                    ]}
                    className={err ? "" : "mt-auto"}
                />
            </ModalContent>
            <ModalFooter
                note={
                    dirty ? (
                        <span className="inline-flex items-center gap-1.5 text-warning">
                            <span className="size-2 rounded-full bg-warning" />
                            Unsaved changes
                        </span>
                    ) : (
                        <span className="text-base-content/60">No changes yet</span>
                    )
                }>
                <ModalButton onClick={onClose} disabled={saving}>
                    Cancel
                </ModalButton>
                <ModalButton variant="primary" className="gap-1.5" onClick={handleSave} loading={saving} loadingText="Saving…" disabled={!dirty}>
                    <Check size={14} />
                    Save changes
                </ModalButton>
            </ModalFooter>
        </ModalShell>
    );
}

// ─── Remove Confirm Modal (local libraries, and cloud libraries with `cloud`) ─
function RemoveModal({ lib, onClose, onRemoved, cloud = false }) {
    const [removing, setRemoving] = useState(false);
    const [err, setErr] = useState(null);
    if (!lib) return null;

    async function handleRemove() {
        setRemoving(true);
        setErr(null);
        try {
            if (cloud) await storageApi.removeLibrary(lib.id);
            else await api.delete(`/api/library/${lib.id}`);
            onRemoved(lib.id);
            onClose();
        } catch (e) {
            setErr(e.message || "Remove failed");
            setRemoving(false);
        }
    }

    const where = cloud ? lib.provider || "the provider" : "disk";
    const { label: typeLabel, Icon: TypeIcon, tone } = guessType(lib);

    return (
        <ConfirmModal
            open
            badge={false}
            onClose={onClose}
            onConfirm={handleRemove}
            loading={removing}
            error={err}
            variant="danger"
            title={`Remove ${lib.label || "library"}?`}
            subtitle={cloud ? `${lib.provider || "Cloud"} library` : <span className="font-mono">{lib.path}</span>}
            confirmIcon={Trash2}
            confirmText="Remove library"
            timeline={[
                { icon: Layers, tone: "warning", title: "Removed", text: "The library disappears from FLUX." },
                { icon: FolderOpen, tone: "info", title: "Scanning stops", text: cloud ? "FLUX stops reading this folder." : "FLUX no longer scans this folder." },
                { icon: cloud ? Cloud : HardDrive, tone: "success", title: "Files stay safe", text: `Nothing on ${where} is deleted.` },
            ]}
            note={cloud ? `Files stay on ${where}; only the library link is removed.` : "Your media files on disk are never deleted."}
            noteTone="success">
            <ModalSection label="You are about to remove">
                <div className={`${PANEL} flex items-center gap-4 px-4 py-3`}>
                    <span className="grid size-10 shrink-0 place-items-center rounded-full border border-base-content/10 bg-base-200">
                        <TypeIcon size={17} className={TONE[tone]} />
                    </span>
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-base-content">{lib.label || "Unnamed library"}</p>
                        <p className="truncate font-mono text-xs text-base-content/55">{cloud ? `${lib.provider || "Cloud"}` : lib.path}</p>
                    </div>
                    <ModalBadge tone={tone}>{typeLabel}</ModalBadge>
                </div>
            </ModalSection>
            {cloud && (
                <ModalStats
                    items={[
                        { icon: Cloud, tone: "text-info", label: "Provider", value: lib.provider || "Cloud" },
                        { icon: Activity, tone: "text-warning", label: "Added", value: fmtDate(lib.addedAt) },
                        { icon: Layers, tone: "text-success", label: "Type", value: lib.shared ? "Shared folder" : "Cloud library" },
                    ]}
                />
            )}
            {!cloud && (
                <ModalStats
                    items={[
                        { icon: FileVideo, tone: "text-info", label: "Media files", value: (lib.fileCount ?? 0).toLocaleString() },
                        { icon: Database, tone: "text-success", label: "Storage used", value: lib.size || fmtBytes(lib.sizeBytes) },
                        { icon: lib.status === "online" ? CheckCircle2 : WifiOff, tone: lib.status === "online" ? "text-success" : "text-error", label: "Status", value: lib.status === "online" ? "Online" : "Offline" },
                    ]}
                />
            )}
        </ConfirmModal>
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
                "btn btn-ghost btn-sm btn-square rounded-lg border-none",
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

function CloudSkeletonRow() {
    return (
        <tr className="border-b border-base-content/5">
            {[6, 24, 14, 12, 10, 10, 10].map((w, i) => (
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
        <div className="flex items-center gap-2 sm:gap-2.5 bg-base-200 border border-base-content/8 rounded-xl px-3 sm:px-4 py-2.5 shadow-sm w-full min-w-0">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: `color-mix(in oklch, ${accent} 15%, transparent)` }}>
                <Icon size={13} style={{ color: accent }} />
            </div>
            <div className="min-w-0">
                <p className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-widest text-base-content/45 leading-none truncate">{label}</p>
                <p className="text-sm font-bold text-base-content mt-0.5 tabular-nums leading-none truncate">{value}</p>
            </div>
        </div>
    );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function DashLibraries() {
    const [tab, setTab] = useState("local"); // 'local' (default) | 'cloud'

    const [libs, setLibs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // ── Cloud libraries — separate data source entirely (GoFile/Drive via
    // StorageManager, scanned recursively by cloudScanner.js which feeds
    // filenames through the existing nameParser, untouched). Only loaded
    // when the Cloud tab is actually opened.
    const [cloudLibs, setCloudLibs] = useState([]);
    const [cloudLoading, setCloudLoading] = useState(false);
    const [cloudLoaded, setCloudLoaded] = useState(false);
    const [cloudError, setCloudError] = useState(null);
    const [cloudRescanning, setCloudRescanning] = useState({});
    const [cloudRemoveLib, setCloudRemoveLib] = useState(null);

    const loadCloud = useCallback(async () => {
        setCloudLoading(true);
        setCloudError(null);
        try {
            const data = await storageApi.librariesSummary();
            setCloudLibs(data?.libraries ?? []);
        } catch (err) {
            setCloudError(err.message);
        } finally {
            setCloudLoading(false);
            setCloudLoaded(true);
        }
    }, []);

    useEffect(() => {
        if (tab === "cloud" && !cloudLoaded) loadCloud();
    }, [tab, cloudLoaded, loadCloud]);

    async function handleCloudRescan(lib) {
        setCloudRescanning((r) => ({ ...r, [lib.id]: true }));
        await loadCloud();
        setCloudRescanning((r) => ({ ...r, [lib.id]: false }));
    }

    // Opens the same Remove dialog as local libraries (replaces the native window.confirm).
    function handleCloudRemove(lib) {
        setCloudRemoveLib(lib);
    }

    const cloudTotalFiles = cloudLibs.reduce((a, l) => a + (l.fileCount || 0), 0);
    const cloudTotalSize = cloudLibs.reduce((a, l) => a + (l.sizeBytes || 0), 0);

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
            {cloudRemoveLib && <RemoveModal cloud lib={cloudRemoveLib} onClose={() => setCloudRemoveLib(null)} onRemoved={(id) => setCloudLibs((prev) => prev.filter((l) => l.id !== id))} />}
            <Toast toast={toast} />

            <div className="space-y-5">
                {/* header */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h1 className="text-xl font-bold text-base-content tracking-tight">Libraries</h1>
                        <p className="text-sm text-base-content/50 mt-0.5">Media folder management and storage monitoring</p>
                    </div>
                    <div className="flex gap-2">
                        {tab === "local" ? (
                            <>
                                <Link to="/settings" className="btn btn-sm btn-primary gap-1.5 border-none">
                                    <FolderOpen size={12} />
                                    Add Library
                                </Link>
                                <button onClick={load} disabled={loading} className="btn btn-sm btn-ghost gap-1.5 disabled:opacity-50 border-none">
                                    <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
                                    Refresh
                                </button>
                            </>
                        ) : (
                            <>
                                <Link to="/dashboard/storage" className="btn btn-sm btn-primary gap-1.5 border-none">
                                    <Cloud size={12} />
                                    Import Cloud Library
                                </Link>
                                <button onClick={loadCloud} disabled={cloudLoading} className="btn btn-sm btn-ghost gap-1.5 disabled:opacity-50 border-none">
                                    <RefreshCw size={12} className={cloudLoading ? "animate-spin" : ""} />
                                    Refresh
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {/* Local / Cloud tabs */}
                <div className="flex bg-base-300 rounded-md p-0.5 gap-0.5 w-fit border border-base-content/8">
                    <button
                        onClick={() => setTab("local")}
                        className={`px-3.5 py-1.5 rounded-md text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer border-none ${
                            tab === "local" ? "bg-primary text-primary-content shadow-sm" : "text-base-content/60 hover:text-base-content hover:bg-base-content/5"
                        }`}>
                        <HardDrive size={13} /> Local
                    </button>
                    <button
                        onClick={() => setTab("cloud")}
                        className={`px-3.5 py-1.5 rounded-md text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer border-none ${
                            tab === "cloud" ? "bg-primary text-primary-content shadow-sm" : "text-base-content/60 hover:text-base-content hover:bg-base-content/5"
                        }`}>
                        <Cloud size={13} /> Cloud
                    </button>
                </div>

                {tab === "local" ? (
                    <>
                        {/* error */}
                        {error && (
                            <div className="alert alert-error shadow-sm text-sm">
                                <AlertTriangle size={15} />
                                <span>{error}</span>
                            </div>
                        )}

                        {/* metrics */}
                        {(!loading || libs.length > 0) && (
                            <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-2">
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
                            <div className="overflow-x-auto scrollbar-none">
                                <table className="table w-full text-sm min-w-225">
                                    <thead className="sticky top-0 z-10 bg-base-300/95 backdrop-blur-sm border-b border-base-content/8">
                                        <tr className="text-[10px] font-semibold uppercase tracking-widest text-base-content/50">
                                            <th className="pl-5 pr-3 py-3.5 w-10">#Sl</th>
                                            <th className="px-3 py-3.5">Library</th>
                                            <th className="px-3 py-3.5">Path</th>
                                            <th className="px-3 py-3.5">Type</th>
                                            <th className="px-3 py-3.5">Status</th>
                                            <th className="px-3 py-3.5 text-right">Files</th>
                                            <th className="px-3 py-3.5 text-right">Storage</th>
                                            <th className="px-3 py-3.5 min-w-130px">Usage %</th>
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
                                                                Libraries are folders FLUX scans for video files. Add one via{" "}
                                                                <span className="font-medium text-base-content/55">Settings → Library</span>.
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
                                                        <td className="px-3 py-3.5 max-w-180px">
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
                                                        <td className="px-3 py-3.5 text-right">
                                                            <span className="text-sm font-medium text-base-content tabular-nums">{(lib.fileCount ?? 0).toLocaleString()}</span>
                                                        </td>

                                                        {/* storage */}
                                                        <td className="px-3 py-3.5 text-right">
                                                            <span className="text-sm font-medium text-base-content tabular-nums">{lib.size || fmtBytes(lib.sizeBytes)}</span>
                                                        </td>

                                                        {/* usage % */}
                                                        <td className="px-3 py-3.5">
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
                    </>
                ) : (
                    <>
                        {/* cloud error */}
                        {cloudError && (
                            <div className="alert alert-error shadow-sm text-sm">
                                <AlertTriangle size={15} />
                                <span>{cloudError}</span>
                            </div>
                        )}

                        {/* cloud metrics */}
                        {(!cloudLoading || cloudLibs.length > 0) && (
                            <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 gap-2">
                                <MetricChip icon={Layers} label="Cloud Libraries" value={cloudLoading ? "—" : cloudLibs.length} accent="oklch(var(--p))" />
                                <MetricChip icon={FileVideo} label="Total Files" value={cloudLoading ? "—" : cloudTotalFiles.toLocaleString()} accent="oklch(var(--in))" />
                                <MetricChip icon={Database} label="Total Storage" value={cloudLoading ? "—" : fmtBytes(cloudTotalSize)} accent="oklch(var(--su))" />
                            </div>
                        )}

                        {/* cloud table */}
                        <div className="card bg-base-200 border border-base-content/8 shadow-sm overflow-hidden">
                            <div className="overflow-x-auto scrollbar-none">
                                <table className="table w-full text-sm min-w-175">
                                    <thead className="sticky top-0 z-10 bg-base-300/95 backdrop-blur-sm border-b border-base-content/8">
                                        <tr className="text-[10px] font-semibold uppercase tracking-widest text-base-content/50">
                                            <th className="pl-5 pr-3 py-3.5 w-10">#Sl</th>
                                            <th className="px-3 py-3.5">Library</th>
                                            <th className="px-3 py-3.5">Provider</th>
                                            <th className="px-3 py-3.5">Status</th>
                                            <th className="px-3 py-3.5 text-right">Files</th>
                                            <th className="px-3 py-3.5 text-right">Storage</th>
                                            <th className="pl-3 pr-4 py-3.5 text-center w-24">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {cloudLoading ? (
                                            [...Array(3)].map((_, i) => <CloudSkeletonRow key={i} />)
                                        ) : cloudLibs.length === 0 ? (
                                            <tr>
                                                <td colSpan={7}>
                                                    <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
                                                        <div className="w-14 h-14 rounded-2xl bg-base-300 flex items-center justify-center">
                                                            <Cloud size={26} className="text-base-content/25" />
                                                        </div>
                                                        <div className="max-w-xs">
                                                            <p className="font-semibold text-base-content/60">No cloud libraries imported</p>
                                                            <p className="text-[13px] text-base-content/40 mt-1.5 leading-relaxed">
                                                                Import a Google Drive or GoFile folder as a Library from the <span className="font-medium text-base-content/55">Storage</span> page.
                                                            </p>
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        ) : (
                                            cloudLibs.map((lib, i) => {
                                                const online = lib.status === "online";
                                                return (
                                                    <tr key={lib.id} className="group border-b border-base-content/5 last:border-0 hover:bg-base-content/4 transition-colors">
                                                        <td className="pl-5 pr-3 py-3.5 text-base-content/30 font-mono text-xs tabular-nums">{String(i + 1).padStart(2, "0")}</td>
                                                        <td className="px-3 py-3.5">
                                                            <div className="flex items-center gap-2.5">
                                                                <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${online ? "bg-base-300" : "bg-base-300/60"}`}>
                                                                    <Cloud size={13} className={online ? "text-base-content/60" : "text-base-content/25"} />
                                                                </div>
                                                                <span className="font-semibold text-base-content leading-tight">{lib.label || "Unnamed Library"}</span>
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-3.5">
                                                            <span className="badge badge-sm badge-outline rounded-md font-medium uppercase">{lib.provider}</span>
                                                        </td>
                                                        <td className="px-3 py-3.5">
                                                            <div className="flex items-center gap-1.5">
                                                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${online ? "bg-success" : "bg-error"}`} />
                                                                <span className={`text-xs font-medium ${online ? "text-success" : "text-error"}`} title={lib.error || ""}>
                                                                    {online ? "Online" : lib.error || "Error"}
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-3.5 text-right">
                                                            <span className="text-sm font-medium text-base-content tabular-nums">{(lib.fileCount ?? 0).toLocaleString()}</span>
                                                        </td>
                                                        <td className="px-3 py-3.5 text-right">
                                                            <span className="text-sm font-medium text-base-content tabular-nums">{fmtBytes(lib.sizeBytes)}</span>
                                                        </td>
                                                        <td className="pl-3 pr-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                                                            <div className="flex items-center justify-center gap-0.5">
                                                                <ActionBtn icon={RotateCcw} title="Rescan library" onClick={() => handleCloudRescan(lib)} spinning={!!cloudRescanning[lib.id]} />
                                                                <ActionBtn icon={Trash2} title="Remove library" onClick={() => handleCloudRemove(lib)} danger />
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            {!cloudLoading && cloudLibs.length > 0 && (
                                <div className="px-5 py-3 border-t border-base-content/5 flex items-center justify-between">
                                    <p className="text-[11px] text-base-content/40">
                                        {cloudLibs.length} {cloudLibs.length === 1 ? "library" : "libraries"} · {cloudTotalFiles.toLocaleString()} files · {fmtBytes(cloudTotalSize)} total
                                    </p>
                                    <p className="text-[11px] text-base-content/30 hidden sm:block">Scanned live via nameParser — same parser local libraries use</p>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
        </>
    );
}
