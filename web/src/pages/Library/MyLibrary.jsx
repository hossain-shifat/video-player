import { useState, useEffect, useCallback, useRef } from "react";
import {
    FolderOpen,
    Plus,
    RefreshCw,
    Trash2,
    Pencil,
    Eye,
    Search,
    X,
    HardDrive,
    Film,
    CheckCircle2,
    AlertCircle,
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
    FolderPlus,
    Copy,
    Check,
    Loader2,
    SquarePen,
} from "lucide-react";
import { getFolders, addFolder, updateFolder, removeFolder } from "../../api/library";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
    });
}

function truncate(str, n = 38) {
    if (!str) return "—";
    return str.length > n ? str.slice(0, n) + "…" : str;
}

// ─── Reusable Modal Shell ────────────────────────────────────────────────────

function Modal({ open, onClose, children, width = "max-w-md" }) {
    useEffect(() => {
        if (!open) return;
        const handler = (e) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
            <div className={`relative w-full ${width} bg-base-200 border border-white/10 rounded-2xl shadow-2xl`}>{children}</div>
        </div>
    );
}

// ─── Delete Confirm Modal ────────────────────────────────────────────────────

function DeleteModal({ folder, onConfirm, onClose, loading }) {
    return (
        <Modal open={!!folder} onClose={onClose}>
            <div className="p-6">
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-full bg-error/15 flex items-center justify-center shrink-0">
                        <Trash2 size={18} className="text-error" />
                    </div>
                    <div>
                        <h3 className="font-semibold text-base-content">Remove Library</h3>
                        <p className="text-xs text-base-content/50">This action cannot be undone</p>
                    </div>
                </div>
                <div className="bg-base-300/60 rounded-lg px-4 py-3 mb-5 border border-white/5">
                    <p className="text-sm font-medium text-base-content">{folder?.label}</p>
                    <p className="text-xs text-base-content/50 mt-0.5 font-mono break-all">{folder?.path}</p>
                </div>
                <p className="text-sm text-base-content/60 mb-5">Removing this library will stop the server from scanning this folder. Your actual files will not be deleted.</p>
                <div className="flex gap-3 justify-end">
                    <button onClick={onClose} className="px-4 py-2 rounded-md text-sm font-medium bg-base-300 hover:bg-base-300/70 text-base-content transition-colors">
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={loading}
                        className="px-4 py-2 rounded-md text-sm font-medium bg-error hover:bg-error/80 text-error-content transition-colors flex items-center gap-2 disabled:opacity-60">
                        {loading && <Loader2 size={14} className="animate-spin" />}
                        Remove Library
                    </button>
                </div>
            </div>
        </Modal>
    );
}

// ─── View Modal ──────────────────────────────────────────────────────────────

function ViewModal({ folder, onClose }) {
    const [copied, setCopied] = useState(false);

    const copyPath = () => {
        navigator.clipboard.writeText(folder?.path || "");
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    if (!folder) return null;

    const rows = [
        { label: "Display Label", value: folder.label },
        { label: "Folder ID", value: folder.id, mono: true },
        { label: "Added", value: fmtDate(folder.addedAt) },
    ];

    return (
        <Modal open={!!folder} onClose={onClose}>
            <div className="p-6">
                <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center">
                            <FolderOpen size={17} className="text-primary" />
                        </div>
                        <h3 className="font-semibold text-base-content">Library Details</h3>
                    </div>
                    <button onClick={onClose} className="text-base-content/40 hover:text-base-content transition-colors">
                        <X size={18} />
                    </button>
                </div>

                <div className="space-y-3 mb-5">
                    {rows.map(({ label, value, mono }) => (
                        <div key={label} className="flex justify-between items-start gap-4">
                            <span className="text-xs text-base-content/50 w-28 shrink-0 pt-0.5">{label}</span>
                            <span className={`text-sm text-base-content text-right break-all ${mono ? "font-mono text-xs text-base-content/70" : ""}`}>{value || "—"}</span>
                        </div>
                    ))}
                    {/* Path with copy */}
                    <div className="flex justify-between items-start gap-4">
                        <span className="text-xs text-base-content/50 w-28 shrink-0 pt-0.5">Folder Path</span>
                        <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-xs font-mono text-base-content/70 break-all text-right">{folder.path}</span>
                            <button onClick={copyPath} className="shrink-0 text-base-content/40 hover:text-primary transition-colors" title="Copy path">
                                {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
                            </button>
                        </div>
                    </div>
                </div>

                <button onClick={onClose} className="w-full py-2 rounded-md text-sm font-medium bg-base-300 hover:bg-base-300/70 text-base-content transition-colors">
                    Close
                </button>
            </div>
        </Modal>
    );
}

// ─── Add / Edit Modal ─────────────────────────────────────────────────────────

function FolderFormModal({ mode, folder, onSave, onClose, loading, error }) {
    const isEdit = mode === "edit";
    const [label, setLabel] = useState(folder?.label || "");
    const [path, setPath] = useState(folder?.path || "");

    useEffect(() => {
        setLabel(folder?.label || "");
        setPath(folder?.path || "");
    }, [folder]);

    const canSubmit = label.trim() && path.trim() && !loading;

    const handleSubmit = () => {
        if (!canSubmit) return;
        onSave({ label: label.trim(), path: path.trim() });
    };

    const handleKey = (e) => {
        if (e.key === "Enter" && canSubmit) handleSubmit();
    };

    return (
        <Modal open={mode === "add" || mode === "edit"} onClose={onClose}>
            <div className="p-6">
                <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center">
                            <FolderPlus size={17} className="text-primary" />
                        </div>
                        <h3 className="font-semibold text-base-content">{isEdit ? "Edit Library" : "Add Library"}</h3>
                    </div>
                    <button onClick={onClose} className="text-base-content/40 hover:text-base-content transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {error && (
                    <div className="flex items-start gap-2 bg-error/10 border border-error/20 rounded-lg px-3 py-2.5 mb-4">
                        <AlertCircle size={14} className="text-error shrink-0 mt-0.5" />
                        <p className="text-xs text-error">{error}</p>
                    </div>
                )}

                <div className="space-y-4 mb-5">
                    <div>
                        <label className="block text-xs font-medium text-base-content/60 mb-1.5">
                            Display Label <span className="text-error">*</span>
                        </label>
                        <input
                            autoFocus
                            value={label}
                            onChange={(e) => setLabel(e.target.value)}
                            onKeyDown={handleKey}
                            placeholder="e.g. Movies, Anime, TV Shows"
                            className="w-full bg-base-300 border border-white/10 rounded-md px-3 py-2 text-sm text-base-content placeholder-base-content/30 focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-base-content/60 mb-1.5">
                            Folder Path <span className="text-error">*</span>
                        </label>
                        <input
                            value={path}
                            onChange={(e) => setPath(e.target.value)}
                            onKeyDown={handleKey}
                            placeholder="e.g. D:\Media\Movies or /mnt/media/movies"
                            className="w-full bg-base-300 border border-white/10 rounded-md px-3 py-2 text-sm text-base-content placeholder-base-content/30 focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all font-mono"
                        />
                        <p className="text-xs text-base-content/40 mt-1.5">Absolute path on the server machine. Network paths supported.</p>
                    </div>
                </div>

                <div className="flex gap-3 justify-end">
                    <button onClick={onClose} className="px-4 py-2 rounded-md text-sm font-medium bg-base-300 hover:bg-base-300/70 text-base-content transition-colors">
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={!canSubmit}
                        className="px-4 py-2 rounded-md text-sm font-medium bg-primary hover:bg-primary/80 text-primary-content transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer">
                        {loading && <Loader2 size={14} className="animate-spin" />}
                        {isEdit ? "Save Changes" : "Add Library"}
                    </button>
                </div>
            </div>
        </Modal>
    );
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ toast }) {
    if (!toast) return null;
    const isErr = toast.type === "error";
    return (
        <div
            className={`fixed bottom-6 right-6 z-60 flex items-center gap-3 px-4 py-3 rounded-xl shadow-xl border text-sm font-medium transition-all
            ${isErr ? "bg-error/15 border-error/30 text-error" : "bg-success/15 border-success/30 text-success"}`}>
            {isErr ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
            {toast.msg}
        </div>
    );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonRow() {
    return (
        <tr className="border-b border-white/5">
            {[48, 96, 160, 200, 80, 80, 72].map((w, i) => (
                <td key={i} className="px-4 py-3.5">
                    <div className="h-3.5 rounded bg-white/8 animate-pulse" style={{ width: w }} />
                </td>
            ))}
        </tr>
    );
}

// ─── Pagination ──────────────────────────────────────────────────────────────

function Pagination({ page, totalPages, total, perPage, onPage }) {
    if (totalPages <= 1) return null;

    const start = (page - 1) * perPage + 1;
    const end = Math.min(page * perPage, total);

    const pages = [];
    const delta = 1;
    for (let i = Math.max(1, page - delta); i <= Math.min(totalPages, page + delta); i++) {
        pages.push(i);
    }

    return (
        <div className="flex items-center justify-between px-4 py-3 border-t border-white/8">
            <span className="text-xs text-base-content/50">
                Showing {start}–{end} of {total} libraries
            </span>
            <div className="flex items-center gap-1">
                <PagBtn icon={<ChevronsLeft size={14} />} onClick={() => onPage(1)} disabled={page === 1} />
                <PagBtn icon={<ChevronLeft size={14} />} onClick={() => onPage(page - 1)} disabled={page === 1} />
                {pages[0] > 1 && <span className="px-1.5 text-base-content/30 text-xs">…</span>}
                {pages.map((p) => (
                    <button
                        key={p}
                        onClick={() => onPage(p)}
                        className={`w-7 h-7 rounded-md text-xs font-medium transition-colors ${
                            p === page ? "bg-primary text-primary-content" : "text-base-content/60 hover:bg-white/8 hover:text-base-content"
                        }`}>
                        {p}
                    </button>
                ))}
                {pages[pages.length - 1] < totalPages && <span className="px-1.5 text-base-content/30 text-xs">…</span>}
                <PagBtn icon={<ChevronRight size={14} />} onClick={() => onPage(page + 1)} disabled={page === totalPages} />
                <PagBtn icon={<ChevronsRight size={14} />} onClick={() => onPage(totalPages)} disabled={page === totalPages} />
            </div>
        </div>
    );
}

function PagBtn({ icon, onClick, disabled }) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className="w-7 h-7 rounded-md flex items-center justify-center text-base-content/50 hover:bg-white/8 hover:text-base-content transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
            {icon}
        </button>
    );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const PER_PAGE = 15;

export default function MyLibrary() {
    const [folders, setFolders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState(null);

    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);

    // Modals
    const [viewFolder, setViewFolder] = useState(null);
    const [deleteFolder, setDeleteFolder] = useState(null);
    const [formMode, setFormMode] = useState(null); // "add" | "edit"
    const [editTarget, setEditTarget] = useState(null);

    // Action state
    const [actionLoading, setActionLoading] = useState(false);
    const [actionError, setActionError] = useState(null);
    const [toast, setToast] = useState(null);
    const toastTimer = useRef(null);

    // ── Fetch ──────────────────────────────────────────────────────────────────
    const fetchFolders = useCallback(async () => {
        setLoading(true);
        setFetchError(null);
        try {
            const data = await getFolders();
            setFolders(data?.folders ?? []);
        } catch (err) {
            setFetchError(err.message || "Failed to load libraries");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchFolders();
    }, [fetchFolders]);

    // ── Toast helper ──────────────────────────────────────────────────────────
    const showToast = (msg, type = "success") => {
        clearTimeout(toastTimer.current);
        setToast({ msg, type });
        toastTimer.current = setTimeout(() => setToast(null), 3200);
    };

    // ── Filter + paginate ────────────────────────────────────────────────────
    const filtered = folders.filter((f) => {
        const q = search.toLowerCase();
        return !q || f.label?.toLowerCase().includes(q) || f.path?.toLowerCase().includes(q) || f.id?.toLowerCase().includes(q);
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
    const safePage = Math.min(page, totalPages);
    const paginated = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

    // Reset page on search
    useEffect(() => {
        setPage(1);
    }, [search]);

    // ── ADD ──────────────────────────────────────────────────────────────────
    const handleAdd = async ({ label, path }) => {
        setActionLoading(true);
        setActionError(null);
        try {
            const data = await addFolder(path, label);
            setFolders((prev) => [...prev, data.folder]);
            setFormMode(null);
            showToast(`"${data.folder.label}" added to library`);
        } catch (err) {
            setActionError(err.message || "Failed to add folder");
        } finally {
            setActionLoading(false);
        }
    };

    // ── EDIT ─────────────────────────────────────────────────────────────────
    const handleEdit = async ({ label, path }) => {
        if (!editTarget) return;
        setActionLoading(true);
        setActionError(null);
        try {
            const data = await updateFolder(editTarget.id, { label, path });
            setFolders((prev) => prev.map((f) => (f.id === editTarget.id ? data.folder : f)));
            setFormMode(null);
            setEditTarget(null);
            showToast(`"${data.folder.label}" updated`);
        } catch (err) {
            setActionError(err.message || "Failed to update folder");
        } finally {
            setActionLoading(false);
        }
    };

    // ── DELETE ───────────────────────────────────────────────────────────────
    const handleDelete = async () => {
        if (!deleteFolder) return;
        setActionLoading(true);
        setActionError(null);
        try {
            await removeFolder(deleteFolder.id);
            setFolders((prev) => prev.filter((f) => f.id !== deleteFolder.id));
            const label = deleteFolder.label;
            setDeleteFolder(null);
            showToast(`"${label}" removed from library`);
        } catch (err) {
            setActionError(err.message || "Failed to remove folder");
            showToast(err.message || "Failed to remove folder", "error");
        } finally {
            setActionLoading(false);
        }
    };

    // ── Open modals ──────────────────────────────────────────────────────────
    const openAdd = () => {
        setEditTarget(null);
        setActionError(null);
        setFormMode("add");
    };
    const openEdit = (folder) => {
        setEditTarget(folder);
        setActionError(null);
        setFormMode("edit");
    };
    const closeForm = () => {
        setFormMode(null);
        setEditTarget(null);
        setActionError(null);
    };

    // ─── Stats ───────────────────────────────────────────────────────────────
    const stats = [
        {
            label: "Total Libraries",
            value: folders.length,
            icon: <HardDrive size={18} className="text-primary" />,
            bg: "bg-primary/10",
        },
        {
            label: "Filtered Results",
            value: filtered.length,
            icon: <Film size={18} className="text-accent" />,
            bg: "bg-accent/10",
        },
        {
            label: "Current Page",
            value: `${safePage} / ${totalPages}`,
            icon: <FolderOpen size={18} className="text-secondary" />,
            bg: "bg-secondary/10",
        },
    ];

    // ─── Render ──────────────────────────────────────────────────────────────
    return (
        <div className="min-h-screen bg-base-100 text-base-content">
            {/* ── Header ── */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-base-content tracking-tight">My Libraries</h1>
                    <p className="text-sm text-base-content/50 mt-0.5">Manage media folders scanned by the server</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={fetchFolders}
                        disabled={loading}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-base-300 hover:bg-base-300/70 text-base-content/80 hover:text-base-content transition-colors disabled:opacity-50 cursor-pointer">
                        <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                        Refresh
                    </button>
                    <button
                        onClick={openAdd}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-primary hover:bg-primary/80 text-primary-content transition-colors cursor-pointer">
                        <Plus size={14} />
                        Add Library
                    </button>
                </div>
            </div>

            {/* ── Stats ── */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
                {stats.map(({ label, value, icon, bg }) => (
                    <div key={label} className={`flex items-center gap-3 px-4 py-3 rounded-xl border border-white/8 ${bg}`}>
                        <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0">{icon}</div>
                        <div>
                            <div className="text-lg font-bold text-base-content leading-none">{value}</div>
                            <div className="text-xs text-base-content/50 mt-0.5">{label}</div>
                        </div>
                    </div>
                ))}
            </div>

            {/* ── Search toolbar ── */}
            <div className="flex items-center gap-2 mb-4">
                <div className="relative flex-1 max-w-sm">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-base-content/40" />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by label, path, or ID…"
                        className="w-full bg-base-200 border border-white/10 rounded-md pl-8 pr-3 py-2 text-sm text-base-content placeholder-base-content/30 focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all"
                    />
                    {search && (
                        <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-base-content/40 hover:text-base-content transition-colors">
                            <X size={13} />
                        </button>
                    )}
                </div>
                {search && (
                    <span className="text-xs text-base-content/40">
                        {filtered.length} result{filtered.length !== 1 ? "s" : ""}
                    </span>
                )}
            </div>

            {/* ── Table ── */}
            <div className="bg-base-200 border border-white/8 rounded-xl overflow-hidden">
                {fetchError && (
                    <div className="flex items-center gap-3 px-5 py-4 bg-error/10 border-b border-error/20">
                        <AlertCircle size={16} className="text-error shrink-0" />
                        <p className="text-sm text-error">{fetchError}</p>
                        <button onClick={fetchFolders} className="ml-auto text-xs underline text-error/80 hover:text-error">
                            Retry
                        </button>
                    </div>
                )}

                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-white/8 bg-base-300/40">
                                <th className="text-left px-4 py-3 font-medium text-base-content/50 text-xs uppercase tracking-wider w-12">#Id</th>
                                <th className="text-left px-4 py-3 font-medium text-base-content/50 text-xs uppercase tracking-wider">Label</th>
                                <th className="text-left px-4 py-3 font-medium text-base-content/50 text-xs uppercase tracking-wider">Folder ID</th>
                                <th className="text-left px-4 py-3 font-medium text-base-content/50 text-xs uppercase tracking-wider">Media Count</th>
                                <th className="text-left px-4 py-3 font-medium text-base-content/50 text-xs uppercase tracking-wider">Path</th>
                                <th className="text-left px-4 py-3 font-medium text-base-content/50 text-xs uppercase tracking-wider hidden md:table-cell">Added</th>
                                <th className="text-right px-4 py-3 font-medium text-base-content/50 text-xs uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
                            ) : paginated.length === 0 ? (
                                <tr>
                                    <td colSpan={6}>
                                        <EmptyState search={search} onAdd={openAdd} onClear={() => setSearch("")} />
                                    </td>
                                </tr>
                            ) : (
                                paginated.map((folder, idx) => {
                                    const globalIdx = (safePage - 1) * PER_PAGE + idx + 1;
                                    console.log(folder);
                                    return (
                                        <tr key={folder.id} className="border-b border-white/5 hover:bg-white/3 transition-colors group">
                                            {/* #Id */}
                                            <td className="px-4 py-3.5">
                                                <span className="text-xs font-mono text-base-content/40 font-medium">#{globalIdx}</span>
                                            </td>

                                            {/* Label */}
                                            <td className="px-4 py-3.5">
                                                <div className="flex items-center gap-2.5">
                                                    <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                                                        <FolderOpen size={13} className="text-primary" />
                                                    </div>
                                                    <span className="font-medium text-base-content text-sm">{folder.label || "—"}</span>
                                                </div>
                                            </td>

                                            {/* Folder ID */}
                                            <td className="px-4 py-3.5">
                                                <span className="text-xs font-mono text-base-content/50 bg-base-300/60 px-2 py-0.5 rounded border border-white/5">{folder.id || "—"}</span>
                                            </td>

                                            {/* Media Count */}
                                            <td className="px-4 py-3.5">
                                                <span className="text-xs font-mono text-base-content/50 bg-base-300/60 px-2 py-0.5 rounded border border-white/5">{folder.count || "—"}</span>
                                            </td>

                                            {/* Path */}
                                            <td className="px-4 py-3.5 max-w-xs">
                                                <span className="text-xs font-mono text-base-content/60 block truncate" title={folder.path}>
                                                    {truncate(folder.path, 40)}
                                                </span>
                                            </td>

                                            {/* Added */}
                                            <td className="px-4 py-3.5 hidden md:table-cell">
                                                <span className="text-xs text-base-content/50">{fmtDate(folder.addedAt)}</span>
                                            </td>

                                            {/* Actions */}
                                            <td className="px-4 py-3.5">
                                                <div className="flex items-center justify-end gap-1">
                                                    <ActionBtn
                                                        icon={<Eye size={13} />}
                                                        label="View"
                                                        onClick={() => setViewFolder(folder)}
                                                        className="text-base-content/50 hover:text-base-content hover:bg-white/8"
                                                    />
                                                    <ActionBtn
                                                        icon={<SquarePen size={13} />}
                                                        label="Edit"
                                                        onClick={() => openEdit(folder)}
                                                        className="text-base-content/50 hover:text-primary hover:bg-primary/10"
                                                    />
                                                    <ActionBtn
                                                        icon={<Trash2 size={13} />}
                                                        label="Delete"
                                                        onClick={() => setDeleteFolder(folder)}
                                                        className="text-base-content/50 hover:text-error hover:bg-error/10"
                                                    />
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                <Pagination page={safePage} totalPages={totalPages} total={filtered.length} perPage={PER_PAGE} onPage={setPage} />
            </div>

            {/* ── Modals ── */}
            <FolderFormModal mode={formMode} folder={editTarget} onSave={formMode === "edit" ? handleEdit : handleAdd} onClose={closeForm} loading={actionLoading} error={actionError} />

            <ViewModal folder={viewFolder} onClose={() => setViewFolder(null)} />

            <DeleteModal
                folder={deleteFolder}
                onConfirm={handleDelete}
                onClose={() => {
                    setDeleteFolder(null);
                    setActionError(null);
                }}
                loading={actionLoading}
            />

            <Toast toast={toast} />
        </div>
    );
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function ActionBtn({ icon, label, onClick, className }) {
    return (
        <button onClick={onClick} title={label} className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${className}`}>
            {icon}
        </button>
    );
}

function EmptyState({ search, onAdd, onClear }) {
    return (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
            <div className="w-14 h-14 rounded-full bg-base-300/60 flex items-center justify-center mb-4">
                <FolderOpen size={24} className="text-base-content/25" />
            </div>
            {search ? (
                <>
                    <h3 className="text-base font-semibold text-base-content mb-1">No libraries match</h3>
                    <p className="text-sm text-base-content/50 mb-4">Try a different search term</p>
                    <button onClick={onClear} className="px-3 py-1.5 rounded-md text-sm font-medium bg-base-300 hover:bg-base-300/70 text-base-content transition-colors">
                        Clear Search
                    </button>
                </>
            ) : (
                <>
                    <h3 className="text-base font-semibold text-base-content mb-1">No libraries yet</h3>
                    <p className="text-sm text-base-content/50 mb-4">Add a folder to start scanning media</p>
                    <button
                        onClick={onAdd}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-primary hover:bg-primary/80 text-primary-content transition-colors cursor-pointer">
                        <Plus size={14} /> Add Library
                    </button>
                </>
            )}
        </div>
    );
}
