// web/src/dashboard/pages/DashUploads.jsx
// Upload manager — drag/drop files to a media library folder (local or cloud)

import React, { useState, useRef, useCallback, useMemo, useEffect } from "react";
import {
    Upload,
    X,
    CheckCircle,
    AlertTriangle,
    FolderOpen,
    Video,
    Loader2,
    Plus,
    HardDrive,
    Cloud,
    ChevronDown,
    Search,
    Trash2,
    Clock,
    ListChecks,
    History,
    XCircle,
    Info,
    Pause,
    Play,
    FileUp,
    SquarePen,
    Bell,
    BellOff,
    Bug,
} from "lucide-react";
import { api } from "../../api/client";
import { storageApi } from "../api/storageApi";
import { uploadManager, CHUNK_SIZE } from "../upload/uploadManager";
import { uploadDB } from "../upload/uploadDB";
import { useUploadQueue } from "../upload/useUploadQueue";
import { UppyContextProvider, useFileInput } from "@uppy/react";

// ─── Inline modal (replaces native alert()/confirm()) ──────────────────────
// Defined directly in this file — no separate imported component — so there's
// no cross-file import path to get wrong.
function useAppModal() {
    const [modal, setModal] = useState(null); // { type: 'confirm' | 'notice', message, tone, resolve }

    const confirm = useCallback((message) => {
        return new Promise((resolve) => setModal({ type: "confirm", message, resolve }));
    }, []);

    // tone: 'error' (default) | 'success' | 'info'
    const notify = useCallback((message, tone = "error") => {
        return new Promise((resolve) => setModal({ type: "notice", message, tone, resolve }));
    }, []);

    function close(result) {
        if (modal?.resolve) modal.resolve(result);
        setModal(null);
    }

    const ToneIcon = modal?.tone === "success" ? CheckCircle : modal?.tone === "info" ? Info : AlertTriangle;
    const toneClass = modal?.tone === "success" ? "text-success" : modal?.tone === "info" ? "text-primary" : "text-error";

    const modalElement = modal ? (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/50 p-4" onClick={() => close(false)}>
            <div className="bg-base-200 rounded-md shadow-xl w-full max-w-sm border border-base-content/10" onClick={(e) => e.stopPropagation()}>
                <div className="p-5 space-y-4">
                    <div className="flex items-start gap-3">
                        {modal.type === "notice" && <ToneIcon size={20} className={`${toneClass} shrink-0 mt-0.5`} />}
                        <p className="text-sm text-base-content/90 leading-relaxed">{modal.message}</p>
                    </div>
                    <div className="flex justify-end gap-2">
                        {modal.type === "confirm" && (
                            <button onClick={() => close(false)} className="btn btn-sm btn-ghost rounded-md border-none outline-none focus:outline-none">
                                Cancel
                            </button>
                        )}
                        <button onClick={() => close(true)} className={`btn btn-sm rounded-md border-none outline-none focus:outline-none ${modal.type === "confirm" ? "btn-primary" : "btn-neutral"}`}>
                            {modal.type === "confirm" ? "Confirm" : "OK"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    ) : null;

    return { modalElement, confirm, notify };
}

function fmtBytes(b) {
    if (!b) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(b) / Math.log(1024));
    return `${(b / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function fmtSpeed(bps) {
    if (!bps) return "";
    return `${fmtBytes(bps)}/s`;
}

function fmtDate(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const PROVIDER_LABELS = { gofile: "GoFile", gdrive: "Google Drive" };
const NOTIFICATIONS_ENABLED = true; // re-enabled — the mobile freeze was isolated to the File System Access picker/accept-attribute combo, not this
const FSA_PICKER_ENABLED = false; // TEMP — bisection flag: force plain <input type=file>, skip showOpenFilePicker entirely

// ─── Progress bar ───────────────────────────────────────────────────────────
const TONE_GRADIENT = {
    primary: "from-primary/80 to-primary shadow-[0_0_8px_-1px_var(--color-primary)]",
    warning: "from-warning/80 to-warning shadow-[0_0_8px_-1px_var(--color-warning)]",
    success: "from-success/80 to-success shadow-[0_0_8px_-1px_var(--color-success)]",
    error: "from-error/80 to-error shadow-[0_0_8px_-1px_var(--color-error)]",
};

function ProgressBar({ pct, tone = "primary", indeterminate = false }) {
    const gradientClass = TONE_GRADIENT[tone] || TONE_GRADIENT.primary;
    if (indeterminate) {
        return (
            <div className="w-full h-1.5 rounded-md bg-black/25 ring-1 ring-white/5 overflow-hidden">
                <div className={`h-full w-full rounded-md bg-gradient-to-r ${gradientClass} animate-pulse opacity-50`} />
            </div>
        );
    }
    return (
        <div className="w-full h-1.5 rounded-md bg-black/25 ring-1 ring-white/5 overflow-hidden">
            <div className={`h-full rounded-md bg-gradient-to-r ${gradientClass} transition-[width] duration-300 ease-out`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
        </div>
    );
}

// ─── Status line config ─────────────────────────────────────────────────────
const STATUS_CONFIG = {
    queued: { label: "Queued", Icon: Clock, dot: "bg-base-content/40" },
    uploading: { label: "Uploading", Icon: Loader2, spin: true, dot: "bg-primary animate-pulse" },
    finalizing: { label: "Uploading", Icon: Loader2, spin: true, dot: "bg-primary animate-pulse" },
    paused: { label: "Paused", Icon: Pause, dot: "bg-warning" },
    needsFile: { label: "Paused — select file to resume", Icon: FileUp, dot: "bg-warning" },
    needsPermission: { label: "Paused — tap to allow resume", Icon: FileUp, dot: "bg-warning" },
    done: { label: "Completed", Icon: CheckCircle, dot: "bg-success" },
    error: { label: "Failed", Icon: AlertTriangle, dot: "bg-error" },
};

// ─── Library picker — replaces the plain <select>, one component for both
// local folders and cloud libraries. ─────────────────────────────────────────
function LibraryPicker({ items, selectedId, onSelect, kind, loading, emptyLabel }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const wrapRef = useRef(null);

    const selected = items.find((l) => l.id === selectedId) || null;

    const filtered = useMemo(() => {
        if (!query.trim()) return items;
        const q = query.toLowerCase();
        return items.filter((l) => (l.label || "").toLowerCase().includes(q) || (l.path || l.ref || "").toLowerCase().includes(q));
    }, [items, query]);

    useEffect(() => {
        function handler(e) {
            if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
        }
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    return (
        <div className="relative flex-1 min-w-56" ref={wrapRef}>
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="w-full flex items-center gap-2.5 px-3.5 h-11 rounded-md bg-base-300 border border-base-content/10 hover:border-primary/40 transition-colors text-left">
                <div className="w-7 h-7 rounded-md bg-primary/12 flex items-center justify-center shrink-0">
                    {kind === "cloud" ? <Cloud size={14} className="text-primary" /> : <HardDrive size={14} className="text-primary" />}
                </div>
                <div className="flex-1 min-w-0">
                    {loading ? (
                        <span className="text-sm text-base-content/60">Loading…</span>
                    ) : selected ? (
                        <>
                            <p className="text-sm font-semibold text-base-content/85 truncate leading-tight">{selected.label || selected.path}</p>
                            <p className="text-[10px] font-mono text-base-content/60 truncate leading-tight">{selected.path || selected.ref}</p>
                        </>
                    ) : (
                        <span className="text-sm text-base-content/60">{emptyLabel}</span>
                    )}
                </div>
                <ChevronDown size={14} className={`text-base-content/60 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>

            {open && (
                <div className="absolute z-30 top-full left-0 right-0 mt-1.5 bg-base-200 border border-base-content/10 rounded-md shadow-xl overflow-hidden">
                    {items.length > 5 && (
                        <div className="flex items-center gap-2 px-3 py-2 border-b border-base-content/8">
                            <Search size={13} className="text-base-content/60 shrink-0" />
                            <input
                                autoFocus
                                type="text"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Search libraries…"
                                className="flex-1 bg-transparent text-sm text-base-content/80 placeholder:text-base-content/60 focus:outline-none"
                            />
                        </div>
                    )}
                    <div className="max-h-64 overflow-y-auto">
                        {filtered.length === 0 ? (
                            <p className="text-center text-xs text-base-content/60 py-6">No libraries found</p>
                        ) : (
                            filtered.map((l) => {
                                const active = l.id === selectedId;
                                return (
                                    <button
                                        key={l.id}
                                        type="button"
                                        onClick={() => {
                                            onSelect(l.id);
                                            setOpen(false);
                                            setQuery("");
                                        }}
                                        className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors ${active ? "bg-primary/10" : "hover:bg-base-content/5"}`}>
                                        <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${active ? "bg-primary/20" : "bg-base-300"}`}>
                                            {kind === "cloud" ? (
                                                <Cloud size={12} className={active ? "text-primary" : "text-base-content/60"} />
                                            ) : (
                                                <HardDrive size={12} className={active ? "text-primary" : "text-base-content/60"} />
                                            )}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className={`text-sm truncate leading-tight ${active ? "font-semibold text-primary" : "text-base-content/80"}`}>
                                                {l.label || l.path}
                                                {kind === "cloud" && l.provider && <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wider text-base-content/60">{l.provider}</span>}
                                            </p>
                                            <p className="text-[10px] font-mono text-base-content/60 truncate leading-tight">{l.path || l.ref}</p>
                                        </div>
                                        {typeof l.count === "number" && <span className="text-[10px] font-bold text-base-content/60 tabular-nums shrink-0">{l.count}</span>}
                                    </button>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Error boundary around the queue list — if something in QueueCard throws
// during render, this catches it and shows the actual error INLINE on the
// page (no DevTools needed to see it) instead of the whole page going
// unresponsive. React does not offer a hook equivalent for render-phase
// errors — a class component is the only way to implement this. ────────────
class QueueErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { error: null };
    }
    static getDerivedStateFromError(error) {
        return { error };
    }
    componentDidCatch(error, info) {
        console.error("[DashUploads] Queue list crashed while rendering:", error, info?.componentStack);
    }
    render() {
        if (this.state.error) {
            return (
                <div className="rounded-md border-2 border-error/40 bg-error/10 p-4 text-sm text-error space-y-2">
                    <p className="font-bold">The upload queue crashed while rendering — this is the actual bug, screenshot this:</p>
                    <p className="font-mono text-xs break-all">{this.state.error.message}</p>
                    {this.state.error.stack && <pre className="font-mono text-[10px] whitespace-pre-wrap opacity-70 max-h-40 overflow-auto">{this.state.error.stack}</pre>}
                    <button onClick={() => this.setState({ error: null })} className="btn btn-xs btn-error btn-outline mt-1">
                        Try rendering again
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

// ─── Queue item card — matches the reference list style: icon, name, size/status
// line, progress bar while active, action buttons (pause/resume + cancel while
// busy, delete once done). ───────────────────────────────────────────────────
const QueueCard = React.memo(function QueueCard({ item, onCancel, onPauseResume, onRemove, onPickResumeFile, fileInputRef, onRetry, onRename, onRequestPermission, isEditing, onStartEdit, onConfirmEdit, onCancelEdit }) {
    const busy = item.status === "uploading" || item.status === "finalizing";
    const showBar = busy || item.status === "paused" || item.status === "needsFile" || item.status === "needsPermission";
    const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.queued;
    const tone =
        item.status === "done"
            ? "success"
            : item.status === "error"
              ? "error"
              : item.status === "paused" || item.status === "needsFile" || item.status === "needsPermission"
                ? "warning"
                : "primary";

    const [editValue, setEditValue] = useState(item.filename);
    const canRename = item.status === "queued"; // renaming after bytes have started sending would desync from what the server already has

    useEffect(() => {
        if (isEditing) setEditValue(item.filename);
    }, [isEditing, item.filename]);

    function confirmEdit() {
        const trimmed = editValue.trim();
        if (trimmed && trimmed !== item.filename) onRename(item, trimmed);
        onConfirmEdit();
    }

    return (
        <div className="bg-base-200 rounded-md p-3.5 flex flex-col gap-2 border border-base-content/5">
            {item.suggestRename && !isEditing && item.status === "queued" && (
                <div className="flex items-center gap-2 px-2.5 py-2 rounded-md bg-warning/10 border border-warning/25 text-xs text-warning">
                    <AlertTriangle size={13} className="shrink-0" />
                    <span>This name looks auto-generated by your phone (not the real filename) — check it before uploading.</span>
                </div>
            )}
            <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-md bg-primary/12 flex items-center justify-center shrink-0 mt-0.5">
                    <Video size={18} className="text-primary" />
                </div>

                <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                        {isEditing ? (
                            <input
                                autoFocus
                                type="text"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={confirmEdit}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") confirmEdit();
                                    if (e.key === "Escape") onCancelEdit();
                                }}
                                className="input input-xs input-bordered bg-base-300 rounded-md flex-1 min-w-0 font-semibold text-sm"
                            />
                        ) : (
                            <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                <p className="font-semibold text-base-content/90 text-sm truncate" title={item.filename}>
                                    {item.filename}
                                </p>
                                {canRename && (
                                    <button
                                        onClick={() => onStartEdit(item)}
                                        title="Rename before uploading"
                                        className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-base-content/50 border-none outline-none hover:bg-primary/15 hover:text-primary active:bg-primary/20">
                                        <SquarePen size={13} />
                                    </button>
                                )}
                            </div>
                        )}
                        <div className="flex items-center gap-1 shrink-0">
                            {item.isChunked && (busy || item.status === "paused") && (
                                <button
                                    onClick={() => onPauseResume(item)}
                                    title={busy ? "Pause" : "Resume"}
                                    className="w-7 h-7 rounded-md flex items-center justify-center text-base-content/60 border-none hover:bg-primary/15 hover:text-primary transition-all duration-150 cursor-pointer">
                                    {busy ? <Pause size={14} /> : <Play size={14} />}
                                </button>
                            )}
                            {item.status === "needsPermission" && (
                                <button
                                    onClick={() => onRequestPermission(item)}
                                    title="Grant access to continue — the file is already known, no need to browse for it"
                                    className="btn btn-xs btn-primary rounded-md border-none outline-none gap-1">
                                    <FileUp size={12} /> Allow &amp; Resume
                                </button>
                            )}
                            {item.status === "needsFile" && (
                                <>
                                    <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => onPickResumeFile(item, e)} />
                                    <button onClick={() => fileInputRef.current?.click()} title="Select file to resume" className="btn btn-xs btn-primary rounded-md border-none outline-none gap-1">
                                        <FileUp size={12} /> Resume
                                    </button>
                                </>
                            )}
                            {(busy || item.status === "paused" || item.status === "needsFile" || item.status === "needsPermission") && (
                                <button
                                    onClick={() => onCancel(item)}
                                    title="Discard"
                                    className="w-7 h-7 rounded-md flex items-center justify-center text-base-content/60 border-none hover:bg-error/15 hover:text-error transition-all duration-150 cursor-pointer">
                                    <XCircle size={14} />
                                </button>
                            )}
                            {item.status === "error" && item.canRetryStage2 && (
                                <button
                                    onClick={() => onRetry(item)}
                                    title="Retry — resumes from the already-uploaded file, no re-sending needed"
                                    className="btn btn-xs btn-primary rounded-md border-none outline-none gap-1">
                                    Retry
                                </button>
                            )}
                            {(item.status === "done" || item.status === "error") && (
                                <button
                                    onClick={() => onRemove(item.id)}
                                    title="Delete"
                                    className="w-7 h-7 rounded-md flex items-center justify-center text-base-content/60 border-none hover:bg-error/15 hover:text-error transition-all duration-150 cursor-pointer">
                                    <Trash2 size={14} strokeWidth={1.8} />
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
                        <span className="text-xs text-base-content/60 truncate">
                            {item.status === "error"
                                ? item.error || "Failed"
                                : item.status === "done"
                                  ? `${fmtBytes(item.fileSize)} of ${fmtBytes(item.fileSize)} · Completed`
                                  : item.status === "needsPermission"
                                    ? `${fmtBytes((item.chunkIndex || 0) * CHUNK_SIZE)} of ${fmtBytes(item.fileSize)} · File already known — tap Allow to continue, no browsing needed`
                                    : item.status === "needsFile"
                                      ? item.neverStarted
                                          ? `${fmtBytes(item.fileSize)} · Reselect the file to re-queue`
                                          : `${fmtBytes((item.chunkIndex || 0) * CHUNK_SIZE)} of ${fmtBytes(item.fileSize)} · Paused — select the same file to resume`
                                      : `${fmtBytes(item.sentBytes || 0)} of ${fmtBytes(item.fileSize)} · ${busy ? (item.phaseLabel || "Uploading") + "…" : cfg.label}${item.speed > 0 && busy ? ` · ${fmtSpeed(item.speed)}` : ""}`}
                        </span>
                        {busy && <span className="ml-auto shrink-0 text-xs font-bold tabular-nums text-primary">{item.progress}%</span>}
                    </div>

                    {showBar && <ProgressBar pct={item.progress} tone={tone} indeterminate={!!item.stalled} />}
                </div>
            </div>
        </div>
    );
});

export default function DashUploads() {
    // useFileInput (below) needs Uppy's context, which has to come from an
    // ancestor in the tree — can't provide and consume it in the same
    // component. This wrapper is the entire reason DashUploadsInner exists.
    return (
        <UppyContextProvider uppy={uploadManager._uppy}>
            <DashUploadsInner />
        </UppyContextProvider>
    );
}

function DashUploadsInner() {
    const { modalElement, confirm: confirmModal, notify } = useAppModal();
    const [tab, setTab] = useState("session"); // 'session' (Uploads) | 'all' (All Uploads)

    // ── TEMPORARY CRASH DIAGNOSTIC — remove once the real bug is found ──────
    // Surfaces any uncaught error or unhandled promise rejection as a plain
    // alert() right on the device, so a crash on mobile (where DevTools isn't
    // easily reachable) shows its exact message/file/line instead of just
    // "the page froze, no idea why". Shows the alert only ONCE per session —
    // if the same error is actually firing repeatedly (e.g. every render or
    // every tick of a timer), a blocking alert() on every single occurrence
    // would ITSELF produce the exact "stuck, no buttons respond" symptom,
    // since alert() halts all page interaction until dismissed. Only the
    // first occurrence blocks; everything after that just logs to console.
    useEffect(() => {
        let shown = false;
        function onErr(e) {
            console.error("[FLUX crash]", e.message, `${e.filename}:${e.lineno}:${e.colno}`, e.error?.stack);
            if (!shown) {
                shown = true;
                alert(`[FLUX crash]\n${e.message}\n${e.filename}:${e.lineno}:${e.colno}\n\n${e.error?.stack || ""}`);
            }
        }
        function onRej(e) {
            console.error("[FLUX crash - unhandled promise]", e.reason?.message || e.reason, e.reason?.stack);
            if (!shown) {
                shown = true;
                alert(`[FLUX crash - unhandled promise]\n${e.reason?.message || e.reason}\n\n${e.reason?.stack || ""}`);
            }
        }
        window.addEventListener("error", onErr);
        window.addEventListener("unhandledrejection", onRej);
        return () => {
            window.removeEventListener("error", onErr);
            window.removeEventListener("unhandledrejection", onRej);
        };
    }, []);

    const queue = useUploadQueue();
    const [editingItemId, setEditingItemId] = useState(null); // controls which QueueCard's filename is being edited
    const [dragging, setDragging] = useState(false);
    const [libraries, setLibraries] = useState([]);
    const [selectedLib, setSelectedLib] = useState("");
    const [libsLoaded, setLibsLoaded] = useState(false);
    // Uppy's real headless file-input hook — click-to-open now goes through
    // Uppy's own mechanism (getButtonProps) instead of a plain ref click.
    // Its onChange is intentionally NOT used (see onLegacyInputChange below) —
    // Uppy's default onChange calls uppy.addFiles() directly, bypassing our
    // sessionId/meta setup entirely, which would silently break every upload.
    const uppyFileInput = useFileInput({
        multiple: true,
        accept: ".mp4,.mkv,.avi,.mov,.ts,.m2ts,.webm,.m4v,.flv,.wmv,application/octet-stream",
    });

    const resumeFileInputRefs = useRef({}); // itemId -> <input type=file> ref, for the "select file to resume" flow

    function getResumeFileInputRef(id) {
        if (!resumeFileInputRefs.current[id]) resumeFileInputRefs.current[id] = React.createRef();
        return resumeFileInputRefs.current[id];
    }

    const [storageSource, setStorageSource] = useState("local"); // 'local' | 'cloud'
    const [cloudLibraries, setCloudLibraries] = useState([]);
    const [cloudLibsLoaded, setCloudLibsLoaded] = useState(false);

    const loadCloudLibs = useCallback(async () => {
        if (cloudLibsLoaded) return;
        try {
            const data = await storageApi.cloudLibraries();
            setCloudLibraries(data.libraries || []);
        } catch {
            // Storage router may not be reachable / configured — fail silent.
        }
        setCloudLibsLoaded(true);
    }, [cloudLibsLoaded]);

    const loadLibs = useCallback(async () => {
        if (libsLoaded) return;
        try {
            const data = await api.get("/api/library");
            const folders = data.folders || [];
            setLibraries(folders);
            if (folders.length > 0) setSelectedLib(folders[0].id);
        } catch {}
        setLibsLoaded(true);
        loadCloudLibs();
    }, [libsLoaded, loadCloudLibs]);

    useEffect(() => {
        loadLibs();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const activeLibs = storageSource === "cloud" ? cloudLibraries : libraries;

    // ── TEMPORARY on-screen debug panel — console access hasn't been
    // reachable during testing, so this mirrors the same diagnostic lines
    // directly on the page instead. Remove once remaining bugs are fixed. ───
    const [showDebug, setShowDebug] = useState(false);
    const [debugText, setDebugText] = useState("");
    useEffect(() => {
        if (!showDebug) return;
        const tick = () => {
            const combined = [...uploadDB.getDebugLog(), ...uploadManager.getDebugLog()];
            setDebugText(combined.join("\n"));
        };
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [showDebug]);

    const [notifPermission, setNotifPermission] = useState(() => (NOTIFICATIONS_ENABLED ? uploadManager.notifications.permissionState() : "unsupported"));
    const [notifBlocked, setNotifBlocked] = useState(false);
    async function toggleNotifications() {
        if (!NOTIFICATIONS_ENABLED) return;
        if (notifPermission !== "default") return; // already granted/denied/unsupported — nothing this click can change
        const result = await uploadManager.notifications.requestPermission(); // must run inside this click handler — browser gesture requirement
        setNotifPermission(result);
    }
    // Android Chrome only reveals its "no plain Notification without a
    // Service Worker" restriction the first time one is actually attempted —
    // poll the flag lightly so the button corrects itself once that happens.
    useEffect(() => {
        if (!NOTIFICATIONS_ENABLED || notifPermission !== "granted") return;
        const id = setInterval(() => {
            if (uploadManager.notifications.isBlocked()) {
                setNotifBlocked(true);
                clearInterval(id);
            }
        }, 1000);
        return () => clearInterval(id);
    }, [notifPermission]);

    // ── File selection — tries the File System Access picker first (Chrome/
    // Edge desktop) so a resumed upload later can reopen the file with a
    // single permission tap instead of a full re-browse. Falls back to the
    // plain hidden <input> everywhere else (Firefox, Safari, all mobile). ────
    async function handleNewFiles(entries) {
        try {
            await uploadManager.addFiles(entries);
        } catch (err) {
            console.error("[DashUploads] addFiles failed:", err);
            await notify(`Couldn't add that file: ${err.message || err}`);
        }
        // NOTE: this used to auto-open the rename editor (setEditingItemId +
        // autoFocus) for a suspicious auto-generated filename. Removed —
        // triggering autoFocus immediately after a file-picker render is the
        // prime suspect for a page freeze reported on mobile. The warning
        // banner on the card still shows; renaming is one manual tap away.
    }

    async function pickFiles() {
        if (!FSA_PICKER_ENABLED) {
            uppyFileInput.getButtonProps().onClick();
            return;
        }
        try {
            const entries = await uploadManager.pickFilesViaFSA();
            if (entries === null) {
                uppyFileInput.getButtonProps().onClick(); // API unsupported on this browser — fall back to Uppy's own input
                return;
            }
            if (entries.length === 0) return; // user backed out of the native picker
            await handleNewFiles(entries);
        } catch (err) {
            console.error("[DashUploads] pickFiles failed:", err);
            await notify(`Couldn't open the file picker: ${err.message || err}`);
        }
    }

    function onLegacyInputChange(e) {
        try {
            const entries = Array.from(e.target.files).map((file) => ({ file, handle: null }));
            e.target.value = "";
            handleNewFiles(entries);
        } catch (err) {
            console.error("[DashUploads] onLegacyInputChange failed:", err);
        }
    }

    // Renaming corrects an auto-generated mobile filename (e.g. "10241.mkv")
    // before upload — cosmetic on the in-memory File only, never touches
    // anything on disk (matters for a handle-backed file too: this doesn't
    // need write permission, it just wraps the same bytes in a new File).
    function renameQueueItem(item, newName) {
        uploadManager.renameItem(item.id, newName);
    }

    function removeItem(id) {
        uploadManager.removeItem(id);
        delete resumeFileInputRefs.current[id];
    }

    // ── Thin wrappers over the upload manager — all the actual chunk-loop,
    // retry/backoff, stage-2 polling, and pause/cancel bookkeeping now lives
    // in uploadManager.js (module singleton, survives this component
    // unmounting entirely — see the comment at the top of that file). ───────

    function pauseOrResumeItem(item) {
        uploadManager.pauseOrResumeItem(item.id);
    }

    // Handles the file input for a "needsFile" (post-refresh, no stored
    // handle) card — the manual fallback for browsers/paths without File
    // System Access support. Verifies it's plausibly the same file (name +
    // size match), then resumes from whatever the server actually has.
    async function handleResumeFileSelected(item, e) {
        const selected = e.target.files[0];
        e.target.value = "";
        if (!selected) return;
        const result = await uploadManager.attachFileAndResume(item.id, selected);
        if (!result.ok) await notify(result.error);
    }

    // One-tap continuation for a "needsPermission" card — a File System
    // Access handle IS already known for this file, it just needs a fresh
    // requestPermission() grant, which (browser law) must run inside a real
    // click handler like this one. No file browsing involved.
    async function requestPermission(item) {
        await uploadManager.requestPermissionAndResume(item.id);
    }

    // Retries just the stage-2 (server -> provider) leg after a transient
    // failure (network blip, provider timeout) — no chunks get re-sent, the
    // server kept the already-assembled file specifically for this.
    async function retryItem(item) {
        await uploadManager.retryItem(item.id);
    }

    async function cancelItem(item) {
        await uploadManager.cancelItem(item.id);
    }

    function clearDone() {
        uploadManager.clearDone();
    }

    // Kicks the manager's own upload loop off for this library/destination —
    // fire-and-forget from the component's point of view. The manager keeps
    // running even if this page unmounts a moment later (route change,
    // browser back button, etc) since it's never tied to this component.
    function startUpload() {
        const lib = activeLibs.find((l) => l.id === selectedLib);
        if (!lib) return;
        const isCloud = storageSource === "cloud";
        // Local uploads go through the same chunked/resumable pipeline as
        // cloud now (the server resolves a local library id too — see
        // _resolveLibrary in storageController.js), so "your library" stands
        // in for a provider name that doesn't apply here.
        const providerLabel = isCloud ? PROVIDER_LABELS[lib.provider] || lib.provider : "your library";
        uploadManager.startUpload({ libraryId: lib.id, storageSource, providerLabel });
    }

    // ── "All Uploads" tab — LIVE from the cloud provider, not a local record.
    // A locally-cached history file can drift from reality (delete a file on
    // gofile.io directly and our own record would never know) — this fetches
    // the actual current contents of every imported cloud library each time.
    const [cloudFiles, setCloudFiles] = useState([]);
    const [cloudFileErrors, setCloudFileErrors] = useState([]); // per-library fetch failures (e.g. GoFile free-tier Premium gate)
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyLoaded, setHistoryLoaded] = useState(false);
    const [deletingRef, setDeletingRef] = useState(null);

    const loadUploadHistory = useCallback(async () => {
        setHistoryLoading(true);
        try {
            const data = await storageApi.cloudFiles();
            setCloudFiles(data.files || []);
            setCloudFileErrors(data.errors || []);
        } catch {}
        setHistoryLoading(false);
        setHistoryLoaded(true);
    }, []);

    useEffect(() => {
        if (tab === "all" && !historyLoaded) loadUploadHistory();
    }, [tab, historyLoaded, loadUploadHistory]);

    // Refreshes "All Uploads" whenever anything finishes — including an item
    // that finished while this page wasn't even mounted (the manager runs
    // independently of any route, see uploadManager.js).
    useEffect(() => uploadManager.onComplete(() => loadUploadHistory()), [loadUploadHistory]);

    async function deleteUploadedEntry(entry) {
        const ok = await confirmModal(`Permanently delete "${entry.name}" from ${entry.provider}? This removes the actual file, not just this record.`);
        if (!ok) return;
        setDeletingRef(entry.ref);
        try {
            await storageApi.deleteCloudFile(entry.provider, entry.ref);
            setCloudFiles((files) => files.filter((f) => f.ref !== entry.ref));
        } catch (err) {
            await notify(`Delete failed: ${err.message || err}`);
        }
        setDeletingRef(null);
    }

    // Drag events
    const onDragOver = (e) => {
        e.preventDefault();
        setDragging(true);
    };
    const onDragLeave = (e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
    };
    const onDrop = (e) => {
        e.preventDefault();
        setDragging(false);
        if (!FSA_PICKER_ENABLED) {
            const entries = Array.from(e.dataTransfer.files).map((file) => ({ file, handle: null }));
            if (entries.length) handleNewFiles(entries);
            return;
        }
        // getAsFileSystemHandle() (Chromium) is checked first inside this
        // helper — a drag-and-drop pick gets the same resumability advantage
        // as the picker, not just a click through "Choose Files".
        uploadManager
            .filesFromDataTransfer(e.dataTransfer)
            .then((entries) => {
                if (entries.length) handleNewFiles(entries);
            })
            .catch((err) => console.error("[DashUploads] onDrop failed:", err));
    };

    // Not checking `.file` here — the manager's queue snapshot intentionally
    // never includes the raw File object (kept internal, avoids re-cloning it
    // into every notify). An item only ever sits in "queued"/plain "error"
    // once a file is actually attached (fresh add, or auto/manually reattached
    // on resume) — see uploadManager.js's state machine.
    const hasQueued = queue.some((i) => (i.status === "queued" || i.status === "error") && !i.canRetryStage2);
    const hasUploading = queue.some((i) => i.status === "uploading" || i.status === "finalizing");
    const hasDone = queue.some((i) => i.status === "done");

    return (
        <div className="space-y-5 max-w-full [&_button]:outline-none [&_button]:focus:outline-none [&_button]:focus-visible:outline-none [&_button]:active:outline-none [&_button]:border-none">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-base-content">Uploads</h1>
                    <p className="text-sm text-base-content/60 mt-0.5">Add media files directly to a library folder</p>
                </div>
                <div className="flex items-center gap-2">
                    {uploadManager.notifications.isSupported && notifPermission !== "unsupported" && (
                        <button
                            onClick={toggleNotifications}
                            disabled={notifPermission !== "default"}
                            title={
                                notifBlocked
                                    ? "This browser blocks tray notifications without HTTPS (Android requires a secure Service Worker) — set up HTTPS to enable"
                                    : notifPermission === "granted"
                                      ? "Tray notifications on for upload progress"
                                      : notifPermission === "denied"
                                        ? "Notifications blocked — allow them in your browser's site settings to re-enable"
                                        : "Get upload progress in your notification tray"
                            }
                            className="btn btn-sm btn-ghost gap-1.5 text-base-content/60 disabled:opacity-60">
                            {notifPermission === "granted" && !notifBlocked ? <Bell size={13} className="text-primary" /> : <BellOff size={13} />}
                            {notifBlocked ? "Not supported here (needs HTTPS)" : notifPermission === "granted" ? "Notifications on" : notifPermission === "denied" ? "Notifications blocked" : "Enable notifications"}
                        </button>
                    )}
                    {tab === "session" && hasDone && (
                        <button onClick={clearDone} className="btn btn-sm btn-ghost text-base-content/60 gap-1.5">
                            <X size={13} /> Clear done
                        </button>
                    )}
                    <button onClick={() => setShowDebug((v) => !v)} className="btn btn-sm btn-ghost gap-1.5 text-base-content/50">
                        <Bug size={13} /> Debug
                    </button>
                </div>
            </div>

            {showDebug && (
                <div className="rounded-md border border-base-content/15 bg-base-300 p-3">
                    <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-bold text-base-content/70">
                            Debug log — instance {uploadManager._instanceId}, IndexedDB {uploadDB.isSupported ? "supported" : "NOT supported"}
                        </p>
                        <button
                            onClick={() => navigator.clipboard?.writeText(debugText)}
                            className="btn btn-xs btn-ghost gap-1">
                            <SquarePen size={11} /> Copy
                        </button>
                    </div>
                    <pre className="font-mono text-[10px] leading-tight whitespace-pre-wrap max-h-64 overflow-auto text-base-content/70">{debugText || "(empty — nothing logged yet)"}</pre>
                </div>
            )}

            {/* Tabs */}
            <div className="flex bg-base-300 rounded-md p-0.5 gap-0.5 w-fit border border-base-content/5">
                <button
                    onClick={() => setTab("session")}
                    className={`px-3.5 py-1.5 rounded-md text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer border-none ${
                        tab === "session" ? "bg-primary text-primary-content shadow-sm" : "text-base-content/60 hover:text-base-content hover:bg-base-content/5"
                    }`}>
                    <ListChecks size={13} /> Uploads
                    {queue.length > 0 && (
                        <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-black tabular-nums ${tab === "session" ? "bg-primary-content/20" : "bg-base-content/10"}`}>{queue.length}</span>
                    )}
                </button>
                <button
                    onClick={() => setTab("all")}
                    className={`px-3.5 py-1.5 rounded-md text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer border-none ${
                        tab === "all" ? "bg-primary text-primary-content shadow-sm" : "text-base-content/60 hover:text-base-content hover:bg-base-content/5"
                    }`}>
                    <History size={13} /> All Uploads
                </button>
            </div>

            {tab === "session" ? (
                <>
                    {/* Destination card */}
                    <div className="card bg-base-200 shadow-sm">
                        <div className="card-body py-4 gap-3">
                            {cloudLibsLoaded && cloudLibraries.length > 0 && (
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-base-content/70 shrink-0">Storage</span>
                                    <div className="join">
                                        <button
                                            className={`btn btn-sm join-item gap-1.5 ${storageSource === "local" ? "btn-primary" : "btn-ghost"}`}
                                            onClick={() => {
                                                setStorageSource("local");
                                                setSelectedLib(libraries[0]?.id || "");
                                            }}>
                                            <HardDrive size={13} /> Local
                                        </button>
                                        <button
                                            className={`btn btn-sm join-item gap-1.5 ${storageSource === "cloud" ? "btn-primary" : "btn-ghost"}`}
                                            onClick={() => {
                                                setStorageSource("cloud");
                                                setSelectedLib(cloudLibraries[0]?.id || "");
                                            }}>
                                            <Cloud size={13} /> Cloud
                                        </button>
                                    </div>
                                </div>
                            )}

                            <div className="flex flex-wrap items-center gap-3">
                                <span className="text-sm font-medium text-base-content/70 shrink-0">Target Library</span>
                                <LibraryPicker
                                    items={activeLibs}
                                    selectedId={selectedLib}
                                    onSelect={setSelectedLib}
                                    kind={storageSource}
                                    loading={storageSource === "local" ? !libsLoaded : !cloudLibsLoaded}
                                    emptyLabel={storageSource === "local" ? "No libraries configured" : "No cloud libraries imported"}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Drop zone */}
                    <div
                        onDragOver={onDragOver}
                        onDragLeave={onDragLeave}
                        onDrop={onDrop}
                        onClick={() => pickFiles()}
                        className={[
                            "rounded-md border-2 border-dashed cursor-pointer",
                            "flex flex-col items-center justify-center gap-3 py-12 px-6",
                            "transition-all duration-200 select-none",
                            dragging ? "border-primary bg-primary/5 scale-101" : "border-base-content/15 hover:border-primary/40 hover:bg-base-content/2",
                        ].join(" ")}>
                        <input
                            {...uppyFileInput.getInputProps()}
                            // Restored — accept trick back in (FSA picker still OFF below, testing
                            // this in isolation to find out which of the two actually caused the freeze).
                            // Android/Chrome auto-launches the Photo Picker (looks like Gallery)
                            // whenever every entry in `accept` resolves to an image/video MIME type —
                            // adding one non-media MIME type breaks that heuristic and forces the
                            // normal system file picker, which preserves the real filename.
                            aria-label="Upload files"
                            className="hidden"
                            onChange={onLegacyInputChange}
                        />
                        <div className={`w-14 h-14 rounded-md flex items-center justify-center transition-colors ${dragging ? "bg-primary/20" : "bg-base-300"}`}>
                            <Upload size={24} className={dragging ? "text-primary" : "text-base-content/60"} />
                        </div>
                        <div className="text-center">
                            <p className="font-semibold text-base-content/70">{dragging ? "Drop files here" : "Drag & drop video files"}</p>
                            <p className="text-sm text-base-content/60 mt-1">or click to browse · mp4, mkv, avi, mov, ts supported</p>
                        </div>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                pickFiles();
                            }}
                            className="btn btn-sm btn-primary gap-1.5 mt-1">
                            <Plus size={14} /> Choose Files
                        </button>
                    </div>

                    {/* Upload queue — card list */}
                    {queue.length > 0 && (
                        <QueueErrorBoundary>
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-sm font-bold text-base-content/85 flex items-center gap-2">
                                        Upload Queue
                                        <span className="px-1.5 py-0.5 rounded-md bg-base-content/8 text-base-content/60 text-[10px] font-black tabular-nums">{queue.length}</span>
                                    </h3>
                                    <button onClick={startUpload} disabled={!hasQueued || hasUploading || !selectedLib} className="btn btn-sm btn-primary gap-1.5">
                                        {hasUploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                                        {hasUploading ? "Uploading…" : "Start Upload"}
                                    </button>
                                </div>

                                <div className="space-y-2.5">
                                    {queue.map((item) => (
                                        <QueueCard
                                            key={item.id}
                                            item={item}
                                            onCancel={cancelItem}
                                            onPauseResume={pauseOrResumeItem}
                                            onRemove={removeItem}
                                            onPickResumeFile={handleResumeFileSelected}
                                            fileInputRef={getResumeFileInputRef(item.id)}
                                            onRetry={retryItem}
                                            onRename={renameQueueItem}
                                            onRequestPermission={requestPermission}
                                            isEditing={editingItemId === item.id}
                                            onStartEdit={(i) => setEditingItemId(i.id)}
                                            onConfirmEdit={() => setEditingItemId(null)}
                                            onCancelEdit={() => setEditingItemId(null)}
                                        />
                                    ))}
                                </div>
                            </div>
                        </QueueErrorBoundary>
                    )}
                </>
            ) : (
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <p className="text-xs text-base-content/65">Live from the cloud provider — this is what's actually there right now, not a local record.</p>
                        <button onClick={loadUploadHistory} disabled={historyLoading} className="btn btn-xs btn-ghost gap-1.5 text-base-content/50">
                            {historyLoading ? <Loader2 size={12} className="animate-spin" /> : <History size={12} />}
                            Refresh
                        </button>
                    </div>

                    {cloudFileErrors.length > 0 && (
                        <div className="rounded-md border border-warning/25 bg-warning/10 px-3.5 py-2.5 flex items-start gap-2.5">
                            <AlertTriangle size={14} className="text-warning shrink-0 mt-0.5" />
                            <div className="text-xs text-base-content/75 space-y-1">
                                {cloudFileErrors.map((e) => (
                                    <p key={e.libraryId}>
                                        <span className="font-semibold">{e.libraryLabel}</span> ({e.provider}): {e.message}
                                    </p>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="bg-base-200 rounded-md overflow-hidden border border-white/6 shadow-sm">
                        <div className="overflow-x-auto scrollbar-none">
                            <table className="table w-full text-sm min-w-175">
                                <thead className="sticky top-0 z-10 bg-base-300/95 backdrop-blur-md border-b border-base-content/8">
                                    <tr className="text-[10px] font-bold uppercase tracking-widest text-white/65">
                                        <th className="pl-4 pr-2 py-3 w-8">#</th>
                                        <th className="px-3 py-3">File</th>
                                        <th className="px-3 py-3">Library</th>
                                        <th className="px-3 py-3 text-center">Provider</th>
                                        <th className="px-3 py-3">Added</th>
                                        <th className="pl-3 pr-4 py-3 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {historyLoading && cloudFiles.length === 0 ? (
                                        <tr>
                                            <td colSpan={6} className="py-16 text-center">
                                                <Loader2 size={20} className="animate-spin text-base-content/60 mx-auto" />
                                            </td>
                                        </tr>
                                    ) : cloudFiles.length === 0 ? (
                                        <tr>
                                            <td colSpan={6} className="py-20">
                                                <div className="flex flex-col items-center justify-center text-center">
                                                    <div className="w-14 h-14 rounded-md bg-base-200/60 flex items-center justify-center mb-4 border border-white/6">
                                                        <History size={22} className="text-white/55" />
                                                    </div>
                                                    <p className="text-base font-bold text-white/80">No files found</p>
                                                    <p className="text-sm text-white/55 mt-1 max-w-xs">Nothing in your cloud libraries yet, or the library couldn't be listed — see above.</p>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : (
                                        cloudFiles.map((entry, i) => (
                                            <tr key={`${entry.provider}:${entry.ref}`} className="group border-b border-white/4 last:border-0 hover:bg-white/3 transition-colors duration-150">
                                                <td className="pl-4 pr-2 py-3.5 text-white/55 font-mono text-[10px] tabular-nums">{String(i + 1).padStart(2, "0")}</td>

                                                <td className="px-3 py-3.5 min-w-0">
                                                    <div className="flex items-center gap-2.5">
                                                        <div className="w-8 h-8 rounded-md bg-base-300 flex items-center justify-center shrink-0 ring-1 ring-white/8">
                                                            <Video size={14} className="text-white/65" />
                                                        </div>
                                                        <div className="min-w-0">
                                                            <p className="font-semibold text-white/90 text-sm truncate max-w-48 sm:max-w-72" title={entry.name}>
                                                                {entry.metadata?.title || entry.title || entry.name}
                                                            </p>
                                                            <p className="text-[10px] text-white/65 tabular-nums truncate">
                                                                {fmtBytes(entry.sizeBytes)}
                                                                {entry.metadata?.title && entry.metadata.title !== entry.name ? ` · ${entry.name}` : ""}
                                                            </p>
                                                        </div>
                                                    </div>
                                                </td>

                                                <td className="px-3 py-3.5">
                                                    <div className="flex items-center gap-1.5 text-white/70">
                                                        <Cloud size={11} className="shrink-0" />
                                                        <span className="text-xs truncate max-w-32">{entry.libraryLabel || "—"}</span>
                                                    </div>
                                                </td>

                                                <td className="px-3 py-3.5 text-center">
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-white/8 text-white/60 text-[10px] font-bold uppercase tracking-wide">
                                                        {entry.provider}
                                                    </span>
                                                </td>

                                                <td className="px-3 py-3.5">
                                                    <span className="text-xs text-white/70 whitespace-nowrap tabular-nums">{fmtDate(entry.addedAt)}</span>
                                                </td>

                                                <td className="pl-2 pr-4 py-3.5">
                                                    <div className="flex items-center justify-end">
                                                        <button
                                                            onClick={() => deleteUploadedEntry(entry)}
                                                            disabled={deletingRef === entry.ref}
                                                            title="Delete from provider"
                                                            className="w-8 h-8 rounded-md flex items-center justify-center text-white/70 border-none hover:bg-error/15 hover:text-error transition-all duration-150 cursor-pointer disabled:opacity-40">
                                                            {deletingRef === entry.ref ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} strokeWidth={1.8} />}
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
            {modalElement}
        </div>
    );
}
