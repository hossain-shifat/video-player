// web/src/dashboard/pages/DashIPTV.jsx
// IPTV source manager — upload playlist files or register remote playlist URLs.
// Frontend-only: state lives in this component, no API calls, no persistence.

import { useState, useRef, useCallback } from "react";
import { Tv, Plus, Upload, Link as LinkIcon, X, Trash2, Pencil, RefreshCw, MoreVertical, Satellite, FileText } from "lucide-react";

// ─── Helpers ────────────────────────────────────────────────────────────────

function genId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Guesses a playlist "format" label from a filename or URL
function detectFormat(name = "") {
    const lower = name.toLowerCase();
    if (lower.endsWith(".m3u8") || lower.endsWith(".m3u")) return "M3U";
    if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "YAML";
    if (lower.endsWith(".json")) return "JSON";
    return "Unknown";
}

const ACCEPTED_EXTENSIONS = ".m3u,.m3u8,.yml,.yaml,.json";

// ─── Status badge ───────────────────────────────────────────────────────────

function StatusBadge({ status }) {
    const map = {
        pending: "badge-warning badge-outline",
        ready: "badge-success badge-outline",
        error: "badge-error badge-outline",
    };
    const label = {
        pending: "Pending",
        ready: "Ready",
        error: "Error",
    };
    return <span className={`badge badge-sm ${map[status] || "badge-ghost"} font-medium`}>{label[status] || "Pending"}</span>;
}

// ─── Type badge ─────────────────────────────────────────────────────────────

function TypeBadge({ type }) {
    return (
        <span className="inline-flex items-center gap-1.5 text-xs text-base-content/60">
            {type === "url" ? <LinkIcon size={12} className="text-accent" /> : <FileText size={12} className="text-primary" />}
            {type === "url" ? "URL" : "File"}
        </span>
    );
}

// ─── Modal shell — matches the floating-card pattern used across the app ────

function Modal({ open, onClose, title, icon: Icon, children }) {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

            {/* Panel */}
            <div className="relative w-full max-w-md bg-base-200 rounded-2xl shadow-2xl border border-base-content/10 overflow-hidden animate-[modalIn_0.15s_ease-out_both]">
                <div className="flex items-center justify-between px-5 py-4 border-b border-base-content/5">
                    <div className="flex items-center gap-2.5">
                        {Icon && (
                            <span className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                                <Icon size={16} className="text-primary" />
                            </span>
                        )}
                        <h3 className="text-sm font-semibold text-base-content">{title}</h3>
                    </div>
                    <button onClick={onClose} className="btn btn-ghost btn-xs btn-square cursor-pointer" aria-label="Close">
                        <X size={18} color="white" strokeWidth={1.5} />
                    </button>
                </div>

                <div className="p-5 space-y-4">{children}</div>
            </div>

            <style>{`
                @keyframes modalIn {
                    from { opacity: 0; transform: translateY(-6px) scale(0.97); }
                    to   { opacity: 1; transform: translateY(0)  scale(1); }
                }
            `}</style>
        </div>
    );
}

// ─── Empty state ────────────────────────────────────────────────────────────

function EmptyState({ onAddSource }) {
    return (
        <div className="flex flex-col items-center justify-center text-center py-16 px-6">
            <div className="w-16 h-16 rounded-2xl bg-base-300 flex items-center justify-center mb-4">
                <Satellite size={28} className="text-base-content/25" />
            </div>
            <h3 className="text-base font-semibold text-base-content/80">No IPTV Sources</h3>
            <p className="text-sm text-base-content/40 mt-1.5 max-w-sm">Upload a playlist file or add a remote playlist URL to begin.</p>
            <button onClick={onAddSource} className="btn btn-sm btn-primary gap-1.5 mt-5 border-none">
                <Plus size={14} /> Add Source
            </button>
        </div>
    );
}

// ─── Row actions menu ───────────────────────────────────────────────────────

function RowActions({ onEdit, onDelete, onRefresh }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    return (
        <div className="relative" ref={ref}>
            <button onClick={() => setOpen((v) => !v)} className="btn btn-ghost btn-xs btn-square text-base-content/40 hover:text-base-content" aria-label="Row actions">
                <MoreVertical size={15} />
            </button>
            {open && (
                <>
                    <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
                    <div className="absolute right-0 top-8 z-20 w-40 rounded-xl overflow-hidden shadow-2xl bg-base-300 border border-base-content/10 py-1">
                        <button
                            onClick={() => {
                                setOpen(false);
                                onRefresh?.();
                            }}
                            disabled
                            className="flex items-center gap-2.5 w-full px-3.5 py-2 text-xs text-base-content/40 cursor-not-allowed">
                            <RefreshCw size={13} /> Refresh
                        </button>
                        <button
                            onClick={() => {
                                setOpen(false);
                                onEdit?.();
                            }}
                            disabled
                            className="flex items-center gap-2.5 w-full px-3.5 py-2 text-xs text-base-content/40 cursor-not-allowed">
                            <Pencil size={13} /> Edit
                        </button>
                        <button
                            onClick={() => {
                                setOpen(false);
                                onDelete?.();
                            }}
                            className="flex items-center gap-2.5 w-full px-3.5 py-2 text-xs text-error/80 hover:bg-error/10 hover:text-error transition-colors">
                            <Trash2 size={13} /> Delete
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}

// ─── Main page ──────────────────────────────────────────────────────────────

export default function DashIPTV() {
    // sources: { id, name, type: 'url'|'file', format, location, status, date, file? }
    const [sources, setSources] = useState([]);

    const [uploadOpen, setUploadOpen] = useState(false);
    const [urlOpen, setUrlOpen] = useState(false);

    // Upload-file modal local state
    const [uploadName, setUploadName] = useState("");
    const [uploadFile, setUploadFile] = useState(null);
    const fileInputRef = useRef(null);

    // Add-URL modal local state
    const [urlName, setUrlName] = useState("");
    const [urlValue, setUrlValue] = useState("");

    const resetUploadForm = useCallback(() => {
        setUploadName("");
        setUploadFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
    }, []);

    const resetUrlForm = useCallback(() => {
        setUrlName("");
        setUrlValue("");
    }, []);

    function closeUploadModal() {
        setUploadOpen(false);
        resetUploadForm();
    }

    function closeUrlModal() {
        setUrlOpen(false);
        resetUrlForm();
    }

    // Local-only "save" — no backend, just pushes into component state
    function handleSaveUpload() {
        if (!uploadFile) return;
        const newSource = {
            id: genId(),
            name: uploadName.trim() || uploadFile.name,
            type: "file",
            format: detectFormat(uploadFile.name),
            location: uploadFile.name,
            status: "pending",
            date: new Date().toISOString(),
            file: uploadFile,
        };
        setSources((s) => [newSource, ...s]);
        closeUploadModal();
    }

    function handleSaveUrl() {
        if (!urlValue.trim()) return;
        const newSource = {
            id: genId(),
            name: urlName.trim() || "Untitled Source",
            type: "url",
            format: detectFormat(urlValue),
            location: urlValue.trim(),
            status: "pending",
            date: new Date().toISOString(),
        };
        setSources((s) => [newSource, ...s]);
        closeUrlModal();
    }

    function handleDelete(id) {
        setSources((s) => s.filter((src) => src.id !== id));
    }

    function fmtDate(iso) {
        if (!iso) return "—";
        try {
            return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
        } catch {
            return "—";
        }
    }

    return (
        <div className="space-y-5">
            {/* ── Header ───────────────────────────────────────────────────── */}
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-base-content">IPTV Manager</h1>
                    <p className="text-sm text-base-content/40 mt-0.5">Manage IPTV playlist sources for your media server.</p>
                </div>

                <div className="flex items-center gap-2">
                    <button onClick={() => setUploadOpen(true)} className="btn btn-sm btn-ghost bg-base-300 gap-1.5">
                        <Upload size={14} /> Upload Playlist
                    </button>
                    <button onClick={() => setUrlOpen(true)} className="btn btn-sm btn-primary gap-1.5 border-none">
                        <Plus size={14} /> Add URL
                    </button>
                </div>
            </div>

            {/* ── Content card ─────────────────────────────────────────────── */}
            <div className="card bg-base-200 shadow-sm overflow-hidden">
                {sources.length === 0 ? (
                    <EmptyState onAddSource={() => setUrlOpen(true)} />
                ) : (
                    <>
                        <div className="px-5 py-4 border-b border-base-content/5 flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-base-content/70">
                                Sources
                                <span className="ml-2 badge badge-sm badge-ghost">{sources.length}</span>
                            </h3>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="table table-sm">
                                <thead>
                                    <tr className="text-[11px] uppercase tracking-wider text-base-content/35">
                                        <th className="font-semibold">Name</th>
                                        <th className="font-semibold">Type</th>
                                        <th className="font-semibold">Format</th>
                                        <th className="font-semibold">Location</th>
                                        <th className="font-semibold">Status</th>
                                        <th className="font-semibold">Added</th>
                                        <th className="font-semibold text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sources.map((src) => (
                                        <tr key={src.id} className="hover:bg-base-content/3 transition-colors">
                                            <td>
                                                <div className="flex items-center gap-2.5">
                                                    <span className="w-7 h-7 rounded-lg bg-base-300 flex items-center justify-center shrink-0">
                                                        <Tv size={13} className="text-base-content/40" />
                                                    </span>
                                                    <span className="text-sm font-medium text-base-content/85 truncate max-w-50">{src.name}</span>
                                                </div>
                                            </td>
                                            <td>
                                                <TypeBadge type={src.type} />
                                            </td>
                                            <td>
                                                <span className="badge badge-sm badge-ghost font-mono">{src.format}</span>
                                            </td>
                                            <td>
                                                <span className="text-xs text-base-content/45 font-mono truncate max-w-60 inline-block align-middle">{src.location}</span>
                                            </td>
                                            <td>
                                                <StatusBadge status={src.status} />
                                            </td>
                                            <td>
                                                <span className="text-xs text-base-content/40">{fmtDate(src.date)}</span>
                                            </td>
                                            <td className="text-right">
                                                <RowActions onDelete={() => handleDelete(src.id)} />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </div>

            {/* ── Upload Playlist Modal ───────────────────────────────────── */}
            <Modal open={uploadOpen} onClose={closeUploadModal} title="Upload Playlist" icon={Upload}>
                <div className="space-y-1.5">
                    <label htmlFor="upload-source-name" className="text-xs font-medium text-base-content/60">
                        Source Name
                    </label>
                    <input
                        id="upload-source-name"
                        name="sourceName"
                        type="text"
                        placeholder="e.g. Sports Bundle"
                        value={uploadName}
                        onChange={(e) => setUploadName(e.target.value)}
                        className="input input-sm bg-base-300 border-none focus:outline-none w-full"
                    />
                </div>

                <div className="space-y-1.5">
                    <label htmlFor="upload-source-file" className="text-xs font-medium text-base-content/60">
                        File
                    </label>
                    <div
                        onClick={() => fileInputRef.current?.click()}
                        className="rounded-xl border-2 border-dashed border-base-content/15 hover:border-primary/40 hover:bg-base-content/2 transition-colors cursor-pointer flex flex-col items-center justify-center gap-2 py-7 px-4 text-center">
                        <input
                            id="upload-source-file"
                            name="sourceFile"
                            ref={fileInputRef}
                            type="file"
                            accept={ACCEPTED_EXTENSIONS}
                            className="hidden"
                            onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                        />
                        <Upload size={20} className="text-base-content/25" />
                        {uploadFile ? (
                            <p className="text-sm text-base-content/70 font-medium truncate max-w-full px-2">{uploadFile.name}</p>
                        ) : (
                            <>
                                <p className="text-sm text-base-content/50">Click to choose a file</p>
                                <p className="text-[11px] text-base-content/30">.m3u, .m3u8, .yml, .yaml, .json</p>
                            </>
                        )}
                    </div>
                </div>

                <div className="flex justify-end gap-2 pt-1">
                    <button onClick={closeUploadModal} className="btn btn-sm btn-ghost border border-base-content/20">
                        Cancel
                    </button>
                    <button onClick={handleSaveUpload} disabled={!uploadFile} className="btn btn-sm btn-primary gap-1.5 border-none">
                        <Plus size={14} /> Add Source
                    </button>
                </div>
            </Modal>

            {/* ── Add Remote URL Modal ────────────────────────────────────── */}
            <Modal open={urlOpen} onClose={closeUrlModal} title="Add Remote Playlist" icon={LinkIcon}>
                <div className="space-y-1.5">
                    <label htmlFor="url-source-name" className="text-xs font-medium text-base-content/60">
                        Source Name
                    </label>
                    <input
                        id="url-source-name"
                        name="sourceName"
                        type="text"
                        placeholder="e.g. IPTV-ORG Index"
                        value={urlName}
                        onChange={(e) => setUrlName(e.target.value)}
                        className="input input-sm bg-base-300 border-none focus:outline-none w-full"
                    />
                </div>

                <div className="space-y-1.5">
                    <label htmlFor="url-source-value" className="text-xs font-medium text-base-content/60">
                        Playlist URL
                    </label>
                    <input
                        id="url-source-value"
                        name="sourceUrl"
                        type="text"
                        placeholder="Paste URL"
                        value={urlValue}
                        onChange={(e) => setUrlValue(e.target.value)}
                        className="input input-sm bg-base-300 border-none focus:outline-none w-full font-mono"
                    />
                </div>

                <div className="flex justify-end gap-2 pt-1">
                    <button onClick={closeUrlModal} className="btn btn-sm btn-ghost border border-base-content/20">
                        Cancel
                    </button>
                    <button onClick={handleSaveUrl} disabled={!urlValue.trim()} className="btn btn-sm btn-primary gap-1.5 border-none">
                        <Plus size={14} /> Add Source
                    </button>
                </div>
            </Modal>
        </div>
    );
}
