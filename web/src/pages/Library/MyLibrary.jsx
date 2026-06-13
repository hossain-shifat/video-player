import { useState, useCallback, useMemo } from "react";
import {
    FolderOpen,
    Plus,
    Trash2,
    Pencil,
    X,
    Check,
    AlertTriangle,
    HardDrive,
    Film,
    Layers,
    Clock,
    RefreshCw,
    Search,
    ChevronUp,
    ChevronDown,
    Database,
    Wifi,
    WifiOff,
    Info,
    FolderPlus,
    MoreVertical,
    ExternalLink,
} from "lucide-react";
import { useApi } from "../../Context/apiContext";

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ folder }) {
    // No real "status" from API — derive from existence of data
    const hasLabel = folder?.label?.length > 0;
    return (
        <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium tracking-wide
            ${hasLabel ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-amber-500/10 text-amber-400 border border-amber-500/20"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${hasLabel ? "bg-emerald-400" : "bg-amber-400"} animate-pulse`} />
            {hasLabel ? "Active" : "Unlabeled"}
        </span>
    );
}

// ─── Stats card ───────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, accent = false, sub }) {
    return (
        <div
            className={`relative overflow-hidden rounded-xl p-5 border
            ${accent ? "bg-primary/5 border-primary/20" : "bg-base-200 border-base-300"}`}>
            <div className="flex items-start justify-between">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-base-content/40 mb-1">{label}</p>
                    <p className={`text-2xl font-bold tabular-nums ${accent ? "text-primary" : "text-base-content"}`}>{value ?? <span className="opacity-30">—</span>}</p>
                    {sub && <p className="text-xs text-base-content/40 mt-0.5">{sub}</p>}
                </div>
                <div className={`p-2.5 rounded-lg ${accent ? "bg-primary/10" : "bg-base-300"}`}>
                    <Icon size={18} className={accent ? "text-primary" : "text-base-content/50"} />
                </div>
            </div>
        </div>
    );
}

// ─── Add / Edit modal ─────────────────────────────────────────────────────────
function FolderFormModal({ mode, folder, onClose, onSubmit, loading }) {
    const [path, setPath] = useState(folder?.path ?? "");
    const [label, setLabel] = useState(folder?.label ?? "");
    const [err, setErr] = useState(null);

    async function handleSubmit(e) {
        e.preventDefault();
        setErr(null);
        if (!path.trim()) {
            setErr("Path is required");
            return;
        }
        try {
            await onSubmit({ path: path.trim(), label: label.trim() });
            onClose();
        } catch (error) {
            setErr(error?.message ?? "Operation failed");
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
            <div className="relative w-full max-w-md bg-base-200 border border-base-300 rounded-2xl shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-base-300">
                    <div className="flex items-center gap-3">
                        <div className="p-1.5 bg-primary/10 rounded-lg">
                            <FolderPlus size={16} className="text-primary" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-base-content text-sm">{mode === "add" ? "Add Library Folder" : "Edit Library Folder"}</h3>
                            <p className="text-xs text-base-content/40">{mode === "add" ? "Register a new media directory" : "Modify folder settings"}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-base-300 text-base-content/40 hover:text-base-content transition-colors">
                        <X size={16} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    {err && (
                        <div className="flex items-start gap-2.5 px-4 py-3 bg-error/10 border border-error/20 rounded-xl text-sm text-error">
                            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                            <span>{err}</span>
                        </div>
                    )}

                    <div className="space-y-1.5">
                        <label htmlFor="lib-folder-path" className="text-xs font-semibold uppercase tracking-widest text-base-content/50">
                            Absolute Path <span className="text-error">*</span>
                        </label>
                        <input
                            id="lib-folder-path"
                            name="path"
                            value={path}
                            onChange={(e) => setPath(e.target.value)}
                            placeholder="D:\Media\Movies"
                            className="input input-sm w-full bg-base-300 border-base-300 text-base-content placeholder:text-base-content/25 font-mono text-xs focus:border-primary/50 focus:outline-none rounded-lg"
                        />
                        <p className="text-xs text-base-content/30">Must be an existing directory on the server.</p>
                    </div>

                    <div className="space-y-1.5">
                        <label htmlFor="lib-folder-label" className="text-xs font-semibold uppercase tracking-widest text-base-content/50">
                            Display Label
                        </label>
                        <input
                            id="lib-folder-label"
                            name="label"
                            value={label}
                            onChange={(e) => setLabel(e.target.value)}
                            placeholder="My Movies"
                            className="input input-sm w-full bg-base-300 border-base-300 text-base-content placeholder:text-base-content/25 focus:border-primary/50 focus:outline-none rounded-lg"
                        />
                        <p className="text-xs text-base-content/30">Optional — defaults to folder name.</p>
                    </div>

                    <div className="flex gap-3 pt-2">
                        <button type="button" onClick={onClose} className="btn btn-sm flex-1 bg-base-300 border-base-300 text-base-content/60 hover:text-base-content hover:bg-base-100 rounded-lg">
                            Cancel
                        </button>
                        <button type="submit" disabled={loading} className="btn btn-sm flex-1 btn-primary rounded-lg gap-1.5">
                            {loading ? <span className="loading loading-spinner loading-xs" /> : <Check size={13} />}
                            {mode === "add" ? "Add Folder" : "Save Changes"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// ─── Detail modal ─────────────────────────────────────────────────────────────
function FolderDetailModal({ folder, media, onClose, onEdit, onDelete }) {
    // Count media belonging to this folder
    const folderStats = useMemo(() => {
        if (!media) return { movies: 0, series: 0, anime: 0, total: 0 };
        const movies = (media.movies?.items ?? []).filter((m) => m.folderId === folder.id).length;
        const series = (media.series?.items ?? []).filter((s) => s.folderId === folder.id).length;
        const anime = (media.anime?.items ?? []).filter((a) => a.folderId === folder.id).length;
        return { movies, series, anime, total: movies + series + anime };
    }, [folder, media]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
            <div className="relative w-full max-w-lg bg-base-200 border border-base-300 rounded-2xl shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="px-6 py-5 border-b border-base-300">
                    <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 bg-primary/10 rounded-xl">
                                <FolderOpen size={20} className="text-primary" />
                            </div>
                            <div>
                                <h3 className="font-bold text-base-content">{folder.label}</h3>
                                <p className="text-xs text-base-content/40 font-mono mt-0.5 break-all">{folder.path}</p>
                            </div>
                        </div>
                        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-base-300 text-base-content/40 hover:text-base-content transition-colors">
                            <X size={16} />
                        </button>
                    </div>
                </div>

                {/* Stats */}
                <div className="px-6 py-4 grid grid-cols-4 gap-3 border-b border-base-300">
                    {[
                        { label: "Total", value: folderStats.total, color: "text-base-content" },
                        { label: "Movies", value: folderStats.movies, color: "text-blue-400" },
                        { label: "Series", value: folderStats.series, color: "text-violet-400" },
                        { label: "Anime", value: folderStats.anime, color: "text-pink-400" },
                    ].map((s) => (
                        <div key={s.label} className="text-center">
                            <p className={`text-xl font-bold tabular-nums ${s.color}`}>{s.value}</p>
                            <p className="text-xs text-base-content/40 mt-0.5">{s.label}</p>
                        </div>
                    ))}
                </div>

                {/* Details */}
                <div className="px-6 py-4 space-y-3">
                    {[
                        { label: "Folder ID", value: folder.id, mono: true },
                        { label: "Label", value: folder.label },
                        { label: "Added", value: folder.addedAt ? new Date(folder.addedAt).toLocaleString() : "—" },
                    ].map((row) => (
                        <div key={row.label} className="flex items-start justify-between gap-4">
                            <span className="text-xs font-semibold uppercase tracking-widest text-base-content/30 shrink-0 pt-0.5">{row.label}</span>
                            <span className={`text-sm text-base-content/80 text-right break-all ${row.mono ? "font-mono text-xs" : ""}`}>{row.value}</span>
                        </div>
                    ))}
                </div>

                {/* Actions */}
                <div className="px-6 py-4 border-t border-base-300 flex gap-3">
                    <button
                        onClick={() => {
                            onDelete(folder.id);
                            onClose();
                        }}
                        className="btn btn-sm btn-error btn-outline rounded-lg gap-1.5 flex-1">
                        <Trash2 size={13} /> Remove
                    </button>
                    <button
                        onClick={() => {
                            onEdit(folder);
                            onClose();
                        }}
                        className="btn btn-sm btn-primary rounded-lg gap-1.5 flex-1">
                        <Pencil size={13} /> Edit
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Sort icon ────────────────────────────────────────────────────────────────
function SortIcon({ col, sortKey, dir }) {
    if (col !== sortKey) return <ChevronUp size={12} className="opacity-20" />;
    return dir === "asc" ? <ChevronUp size={12} className="text-primary" /> : <ChevronDown size={12} className="text-primary" />;
}

// ─── Main Library page ────────────────────────────────────────────────────────
export default function MyLibrary() {
    const { folders, media, addLibraryFolder, updateLibraryFolder, removeLibraryFolder, loading, errors } = useApi();

    const [modal, setModal] = useState(null); // null | { type: 'add'|'edit'|'detail', folder? }
    const [search, setSearch] = useState("");
    const [sortKey, setSortKey] = useState("label");
    const [sortDir, setSortDir] = useState("asc");
    const [opLoading, setOpLoading] = useState(false);

    // ── sort + filter ──
    const filtered = useMemo(() => {
        let rows = folders ?? [];
        if (search.trim()) {
            const q = search.toLowerCase();
            rows = rows.filter((f) => f.label?.toLowerCase().includes(q) || f.path?.toLowerCase().includes(q));
        }
        rows = [...rows].sort((a, b) => {
            const av = (a[sortKey] ?? "").toString().toLowerCase();
            const bv = (b[sortKey] ?? "").toString().toLowerCase();
            return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
        });
        return rows;
    }, [folders, search, sortKey, sortDir]);

    function toggleSort(key) {
        if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        else {
            setSortKey(key);
            setSortDir("asc");
        }
    }

    // ── counts from media ──
    const totalMedia = useMemo(() => {
        if (!media) return 0;
        return (media.movies?.total ?? 0) + (media.series?.total ?? 0) + (media.anime?.total ?? 0);
    }, [media]);

    // ── actions ──
    async function handleAdd({ path, label }) {
        setOpLoading(true);
        try {
            await addLibraryFolder(path, label);
        } finally {
            setOpLoading(false);
        }
    }

    async function handleEdit({ path, label }) {
        setOpLoading(true);
        try {
            await updateLibraryFolder(modal.folder.id, { path, label });
        } finally {
            setOpLoading(false);
        }
    }

    async function handleDelete(id) {
        if (!window.confirm("Remove this folder from the library? Media files will not be deleted.")) return;
        await removeLibraryFolder(id);
    }

    // ─── skeleton row ──────────────────────────────────────────────────────────
    const SkeletonRow = () => (
        <tr>
            {[1, 2, 3, 4, 5].map((i) => (
                <td key={i} className="px-4 py-3.5">
                    <div className="h-4 bg-base-300 rounded animate-pulse" style={{ width: `${40 + i * 12}%` }} />
                </td>
            ))}
        </tr>
    );

    return (
        <div className="space-y-6">
            {/* ── Page header ── */}
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-base-content tracking-tight">Library</h1>
                    <p className="text-sm text-base-content/40 mt-0.5">Manage media directories and scan paths</p>
                </div>
                <button onClick={() => setModal({ type: "add" })} className="btn btn-sm btn-primary rounded-xl gap-1.5 px-4">
                    <Plus size={14} />
                    Add Folder
                </button>
            </div>

            {/* ── Stat cards ── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <StatCard icon={Database} label="Libraries" value={folders?.length ?? 0} accent />
                <StatCard icon={Film} label="Total Media" value={totalMedia} />
                <StatCard icon={Layers} label="Movies" value={media?.movies?.total ?? 0} />
                <StatCard icon={Layers} label="Series + Anime" value={(media?.series?.total ?? 0) + (media?.anime?.total ?? 0)} />
            </div>

            {/* ── Error ── */}
            {errors.folders && (
                <div className="flex items-center gap-3 px-4 py-3 bg-error/10 border border-error/20 rounded-xl text-sm text-error">
                    <AlertTriangle size={16} />
                    Failed to load folders: {errors.folders}
                </div>
            )}

            {/* ── Table panel ── */}
            <div className="bg-base-200 border border-base-300 rounded-2xl overflow-hidden">
                {/* Table toolbar */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-base-300">
                    <div className="relative flex-1 max-w-xs">
                        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-base-content/30" />
                        <label htmlFor="library-search" className="sr-only">Search folders</label>
                        <input
                            id="library-search"
                            name="q"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search folders…"
                            className="input input-xs w-full pl-8 bg-base-300 border-base-300 text-base-content placeholder:text-base-content/25 focus:border-primary/50 focus:outline-none rounded-lg"
                        />
                    </div>
                    <span className="text-xs text-base-content/30 ml-auto">
                        {filtered.length} {filtered.length === 1 ? "folder" : "folders"}
                    </span>
                </div>

                {/* Table */}
                <div className="overflow-x-auto">
                    <table className="table table-sm w-full">
                        <thead>
                            <tr className="border-b border-base-300 text-base-content/40">
                                {[
                                    { key: "label", label: "Label" },
                                    { key: "path", label: "Path" },
                                    { key: "addedAt", label: "Added" },
                                    { key: null, label: "Status" },
                                    { key: null, label: "" },
                                ].map((col, i) => (
                                    <th
                                        key={i}
                                        className={`px-4 py-3 text-xs font-semibold uppercase tracking-widest
                                            ${col.key ? "cursor-pointer select-none hover:text-base-content/70 transition-colors" : ""}`}
                                        onClick={() => col.key && toggleSort(col.key)}>
                                        <span className="flex items-center gap-1.5">
                                            {col.label}
                                            {col.key && <SortIcon col={col.key} sortKey={sortKey} dir={sortDir} />}
                                        </span>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {loading.folders ? (
                                Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} />)
                            ) : filtered.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="py-16 text-center">
                                        <div className="flex flex-col items-center gap-3">
                                            <div className="p-3 bg-base-300 rounded-2xl">
                                                <FolderOpen size={28} className="text-base-content/20" />
                                            </div>
                                            <div>
                                                <p className="font-semibold text-base-content/50">No folders found</p>
                                                <p className="text-sm text-base-content/30 mt-1">{search ? "Try a different search." : "Add a folder to get started."}</p>
                                            </div>
                                            {!search && (
                                                <button onClick={() => setModal({ type: "add" })} className="btn btn-xs btn-primary rounded-lg mt-2 gap-1">
                                                    <Plus size={11} /> Add Folder
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filtered.map((folder) => (
                                    <tr key={folder.id} className="border-b border-base-300/50 hover:bg-base-300/30 transition-colors group">
                                        <td className="px-4 py-3.5">
                                            <div className="flex items-center gap-2.5">
                                                <div className="p-1.5 bg-base-300 rounded-lg group-hover:bg-primary/10 transition-colors">
                                                    <FolderOpen size={14} className="text-base-content/50 group-hover:text-primary transition-colors" />
                                                </div>
                                                <span className="font-medium text-sm text-base-content">{folder.label || "—"}</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3.5">
                                            <span className="font-mono text-xs text-base-content/60 break-all">{folder.path}</span>
                                        </td>
                                        <td className="px-4 py-3.5">
                                            <span className="text-xs text-base-content/50">
                                                {folder.addedAt
                                                    ? new Date(folder.addedAt).toLocaleDateString("en-GB", {
                                                          day: "numeric",
                                                          month: "short",
                                                          year: "numeric",
                                                      })
                                                    : "—"}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3.5">
                                            <StatusBadge folder={folder} />
                                        </td>
                                        <td className="px-4 py-3.5">
                                            <div className="flex items-center gap-1 justify-end">
                                                <button
                                                    onClick={() => setModal({ type: "detail", folder })}
                                                    className="p-1.5 rounded-lg text-base-content/30 hover:text-base-content hover:bg-base-300 transition-colors"
                                                    title="Details">
                                                    <Info size={14} />
                                                </button>
                                                <button
                                                    onClick={() => setModal({ type: "edit", folder })}
                                                    className="p-1.5 rounded-lg text-base-content/30 hover:text-primary hover:bg-primary/10 transition-colors"
                                                    title="Edit">
                                                    <Pencil size={14} />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(folder.id)}
                                                    className="p-1.5 rounded-lg text-base-content/30 hover:text-error hover:bg-error/10 transition-colors"
                                                    title="Remove">
                                                    <Trash2 size={14} />
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

            {/* ── Modals ── */}
            {modal?.type === "add" && <FolderFormModal mode="add" onClose={() => setModal(null)} onSubmit={handleAdd} loading={opLoading} />}
            {modal?.type === "edit" && <FolderFormModal mode="edit" folder={modal.folder} onClose={() => setModal(null)} onSubmit={handleEdit} loading={opLoading} />}
            {modal?.type === "detail" && (
                <FolderDetailModal folder={modal.folder} media={media} onClose={() => setModal(null)} onEdit={(f) => setModal({ type: "edit", folder: f })} onDelete={handleDelete} />
            )}
        </div>
    );
}
