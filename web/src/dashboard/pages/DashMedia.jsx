// web/src/dashboard/pages/DashMedia.jsx
import { useState, useMemo } from "react";
import { Link } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import {
    Film,
    Tv2,
    Swords,
    RefreshCw,
    AlertTriangle,
    FileVideo,
    HardDrive,
    Search,
    Play,
    Info,
    Copy,
    FolderOpen,
    Check,
    Image as ImageIcon,
    SquarePen,
    Trash2,
    X,
    Loader2,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    Database,
    Star,
    Calendar,
    Layers,
} from "lucide-react";
import { api } from "../../api/client";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function fmtDuration(seconds) {
    if (!seconds) return "—";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

function extractTags(filename) {
    if (!filename) return { res: null, vcodec: null, acodec: null };
    const str = filename.toLowerCase();

    let res = null;
    if (str.match(/\b(2160p|4k|uhd)\b/)) res = "4K";
    else if (str.match(/\b(1080p|fhd)\b/)) res = "1080p";
    else if (str.match(/\b(720p|hd)\b/)) res = "720p";
    else if (str.match(/\b(480p|sd)\b/)) res = "480p";

    let vcodec = null;
    if (str.match(/\b(x265|h265|hevc)\b/)) vcodec = "H265";
    else if (str.match(/\b(x264|h264|avc)\b/)) vcodec = "H264";
    else if (str.match(/\b(av1)\b/)) vcodec = "AV1";

    let acodec = null;
    if (str.match(/\b(aac)\b/)) acodec = "AAC";
    else if (str.match(/\b(dts-hd|dts)\b/)) acodec = "DTS";
    else if (str.match(/\b(eac3|ac3|dd5\.1|ddp5\.1)\b/)) acodec = "AC3";
    else if (str.match(/\b(flac)\b/)) acodec = "FLAC";

    return { res, vcodec, acodec };
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

function MetricCard({ title, value, icon: Icon, accent, sub }) {
    return (
        <div className="bg-base-200 border border-base-content/8 rounded-lg p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded flex items-center justify-center shrink-0" style={{ background: `color-mix(in oklch, ${accent} 12%, transparent)` }}>
                <Icon size={18} style={{ color: accent }} />
            </div>
            <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-base-content/40 mb-0.5">{title}</p>
                <p className="text-xl font-bold text-base-content leading-none tabular-nums">{value}</p>
                {sub && <p className="text-[10px] text-base-content/30 mt-0.5">{sub}</p>}
            </div>
        </div>
    );
}

function CopyBtn({ text, title }) {
    const [copied, setCopied] = useState(false);
    const handle = (e) => {
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard.writeText(text).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    return (
        <button onClick={handle} title={title} className="w-6 h-6 rounded flex items-center justify-center text-base-content/40 hover:text-base-content hover:bg-base-content/10 transition-colors">
            {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
        </button>
    );
}

function Badge({ label, variant = "default" }) {
    const cls =
        {
            movie: "bg-primary/15 text-primary",
            series: "bg-info/15 text-info",
            anime: "bg-accent/15 text-accent",
            default: "bg-base-content/10 text-base-content/60",
        }[variant] || "bg-base-content/10 text-base-content/60";

    return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${cls}`}>{label}</span>;
}

// ─── Modal Shell ──────────────────────────────────────────────────────────────

function Modal({ onClose, width = "max-w-md", children }) {
    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
            <div className={`relative w-full ${width} bg-base-200 rounded-lg shadow-2xl border border-base-content/10 overflow-hidden flex flex-col max-h-[88vh]`} onClick={(e) => e.stopPropagation()}>
                {children}
            </div>
        </div>,
        document.body,
    );
}

function ModalHeader({ title, subtitle, onClose, poster, typeBadge }) {
    return (
        <div className="flex items-start justify-between px-5 pt-4 pb-3.5 border-b border-base-content/8 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
                {poster !== undefined && (
                    <div className="w-9 h-12 rounded bg-base-300 flex items-center justify-center shrink-0 overflow-hidden">
                        {poster ? <img src={poster} alt="" className="w-full h-full object-cover" /> : <ImageIcon size={14} className="text-base-content/20" />}
                    </div>
                )}
                <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="font-semibold text-sm text-base-content leading-tight">{title}</h2>
                        {typeBadge && <Badge label={typeBadge.label} variant={typeBadge.type} />}
                    </div>
                    {subtitle && <p className="text-[11px] text-base-content/40 mt-0.5 truncate">{subtitle}</p>}
                </div>
            </div>
            <button
                onClick={onClose}
                className="w-6 h-6 rounded flex items-center justify-center text-base-content/40 hover:text-base-content hover:bg-base-content/10 transition-colors shrink-0 ml-2">
                <X size={14} />
            </button>
        </div>
    );
}

function ModalFooter({ children }) {
    return <div className="px-5 py-3.5 flex items-center justify-end gap-2 border-t border-base-content/8 shrink-0 bg-base-200/50">{children}</div>;
}

// ─── Edit Modal ───────────────────────────────────────────────────────────────

function EditModal({ media, onClose, onSave, isPending, error }) {
    const [title, setTitle] = useState(media._title || "");
    const [year, setYear] = useState(media._year || "");
    const [type, setType] = useState(media._type || "movie");
    const [permission, setPermission] = useState(media.permission !== false);

    const handleSubmit = () => {
        onSave({ id: media._id, payload: { title, year: Number(year), type, permission } });
    };

    return (
        <Modal onClose={onClose}>
            <ModalHeader title="Edit Metadata" subtitle={media._filename} onClose={onClose} poster={media._poster} typeBadge={{ label: media._typeLabel, type: media._type }} />

            <div className="px-5 py-4 space-y-4 overflow-y-auto">
                {error && (
                    <div className="flex items-center gap-2 text-xs text-error bg-error/10 border border-error/20 rounded px-3 py-2">
                        <AlertTriangle size={12} className="shrink-0" />
                        <span>{error.message || "Failed to update media"}</span>
                    </div>
                )}

                <div className="space-y-1">
                    <label className="text-[10px] font-semibold uppercase tracking-widest text-base-content/45">Title</label>
                    <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        className="input input-sm w-full bg-base-100 border border-base-content/12 rounded text-sm focus:outline-none focus:border-primary/50"
                        placeholder="Media title..."
                    />
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                        <label className="text-[10px] font-semibold uppercase tracking-widest text-base-content/45">Year</label>
                        <input
                            type="number"
                            value={year}
                            onChange={(e) => setYear(e.target.value)}
                            className="input input-sm w-full bg-base-100 border border-base-content/12 rounded text-sm focus:outline-none focus:border-primary/50"
                            placeholder="2024"
                            min={1900}
                            max={2099}
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-[10px] font-semibold uppercase tracking-widest text-base-content/45">Type</label>
                        <select
                            value={type}
                            onChange={(e) => setType(e.target.value)}
                            className="select select-sm w-full bg-base-100 border border-base-content/12 rounded text-sm focus:outline-none focus:border-primary/50">
                            <option value="movie">Movie</option>
                            <option value="series">Series</option>
                            <option value="anime">Anime</option>
                        </select>
                    </div>
                </div>

                <div className="space-y-1">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-base-content/45">Media ID</p>
                    <div className="flex items-center gap-2 bg-base-100 border border-base-content/8 rounded px-2.5 py-1.5">
                        <span className="text-[10px] font-mono text-base-content/40 truncate flex-1">{media._id}</span>
                        <CopyBtn text={media._id} title="Copy ID" />
                    </div>
                </div>

                <div className="space-y-1">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-base-content/45">Permission Control</p>
                    <label className="flex items-center gap-2.5 cursor-pointer select-none">
                        <input type="checkbox" className="checkbox checkbox-sm checkbox-error" checked={!permission} onChange={(e) => setPermission(!e.target.checked)} />
                        <span className="text-xs text-base-content/70">Restricted (mark as restricted)</span>
                    </label>
                </div>
            </div>

            <ModalFooter>
                <button
                    onClick={onClose}
                    className="btn btn-sm btn-ghost rounded text-base-content/60 hover:text-base-content hover:bg-base-content/8 focus:outline-none focus-visible:outline-none focus:shadow-none [&:focus]:shadow-none">
                    Cancel
                </button>
                <button
                    onClick={handleSubmit}
                    disabled={isPending}
                    className="btn btn-sm btn-info rounded gap-1.5 disabled:opacity-50 focus:outline-none focus-visible:outline-none focus:shadow-none [&:focus]:shadow-none">
                    {isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                    {isPending ? "Saving…" : "Save"}
                </button>
            </ModalFooter>
        </Modal>
    );
}

// ─── Details Modal ────────────────────────────────────────────────────────────

function InfoRow({ label, value, mono = false, full = false, copyText }) {
    return (
        <div className={full ? "col-span-2" : ""}>
            <div className="flex items-center gap-1.5 mb-1">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-base-content/35">{label}</p>
                {copyText && <CopyBtn text={copyText} title={`Copy ${label}`} />}
            </div>
            {mono ? (
                <p className="text-[10px] font-mono text-base-content/55 break-all bg-base-100 border border-base-content/8 rounded px-2 py-1.5 leading-relaxed">{value || "—"}</p>
            ) : (
                <p className="text-sm font-medium text-base-content">{value || "—"}</p>
            )}
        </div>
    );
}

function DetailsModal({ media, onClose }) {
    const linkDest = media._type === "movie" ? `/player/${media._id}` : `/series/${media._id}`;

    return (
        <Modal onClose={onClose} width="max-w-lg">
            <ModalHeader title={media._title} subtitle={media._filename} onClose={onClose} poster={media._poster} typeBadge={{ label: media._typeLabel, type: media._type }} />

            <div className="px-5 py-4 space-y-4 overflow-y-auto">
                {/* Quick stats row */}
                <div className="grid grid-cols-4 gap-2">
                    {[
                        { label: "Year", value: media._year || "—", icon: Calendar },
                        { label: "Quality", value: media.res || "—", icon: Star },
                        { label: "Duration", value: fmtDuration(media._duration), icon: Layers },
                        { label: "Size", value: fmtBytes(media._size), icon: HardDrive },
                    ].map(({ label, value, icon: Icon }) => (
                        <div key={label} className="bg-base-100 border border-base-content/8 rounded p-2.5 text-center">
                            <p className="text-[9px] font-semibold uppercase tracking-widest text-base-content/35 mb-1">{label}</p>
                            <p className="text-xs font-bold text-base-content tabular-nums">{value}</p>
                        </div>
                    ))}
                </div>

                {/* Codec row */}
                {(media.vcodec || media.acodec) && (
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[9px] font-semibold uppercase tracking-widest text-base-content/35">Codec</span>
                        {media.vcodec && <span className="px-2 py-0.5 rounded bg-base-100 border border-base-content/10 text-[10px] font-mono text-base-content/60">{media.vcodec}</span>}
                        {media.acodec && <span className="px-2 py-0.5 rounded bg-base-100 border border-base-content/10 text-[10px] font-mono text-base-content/60">{media.acodec}</span>}
                    </div>
                )}

                {/* TMDB metadata */}
                {media.metadata?.overview && (
                    <div>
                        <p className="text-[9px] font-semibold uppercase tracking-widest text-base-content/35 mb-1.5">Overview</p>
                        <p className="text-xs text-base-content/60 leading-relaxed line-clamp-4">{media.metadata.overview}</p>
                    </div>
                )}

                {/* Genres */}
                {media.metadata?.genres?.length > 0 && (
                    <div>
                        <p className="text-[9px] font-semibold uppercase tracking-widest text-base-content/35 mb-1.5">Genres</p>
                        <div className="flex flex-wrap gap-1">
                            {media.metadata.genres.map((g) => (
                                <span key={g} className="px-2 py-0.5 rounded bg-base-content/8 text-[10px] text-base-content/60">
                                    {g}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {/* Grid details */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 pt-1">
                    <InfoRow
                        label="Library"
                        value={
                            <span className="flex items-center gap-1.5 text-sm">
                                <FolderOpen size={12} className="text-base-content/40 shrink-0" />
                                {media._library}
                            </span>
                        }
                        full
                    />
                    <InfoRow label="Added" value={fmtDate(media._added)} />
                    {media.metadata?.rating && (
                        <InfoRow
                            label="TMDB Rating"
                            value={
                                <span className="flex items-center gap-1">
                                    <Star size={11} className="text-warning fill-warning" />
                                    {media.metadata.rating}
                                </span>
                            }
                        />
                    )}
                    <InfoRow label="File Path" value={media._path} mono full copyText={media._path} />
                    <InfoRow label="Media ID" value={media._id} mono full copyText={media._id} />
                </div>
            </div>

            <ModalFooter>
                <button
                    onClick={onClose}
                    className="btn btn-sm btn-ghost rounded text-base-content/60 hover:text-base-content hover:bg-base-content/8 focus:outline-none focus-visible:outline-none focus:shadow-none [&:focus]:shadow-none">
                    Close
                </button>
                <Link to={linkDest} target="_blank" className="btn btn-sm btn-primary rounded gap-1.5 focus:outline-none focus-visible:outline-none focus:shadow-none [&:focus]:shadow-none">
                    <Play size={12} className="ml-0.5" />
                    Play
                </Link>
            </ModalFooter>
        </Modal>
    );
}

// ─── Delete Modal ─────────────────────────────────────────────────────────────

function DeleteModal({ media, onClose, onConfirm, isPending, error }) {
    return (
        <Modal onClose={onClose} width="max-w-sm">
            <ModalHeader title="Delete Media" subtitle="This action cannot be undone" onClose={onClose} />

            <div className="px-5 py-4 space-y-3">
                {error && (
                    <div className="flex items-center gap-2 text-xs text-error bg-error/10 border border-error/20 rounded px-3 py-2">
                        <AlertTriangle size={12} className="shrink-0" />
                        <span>{error.message || "Failed to delete"}</span>
                    </div>
                )}

                <div className="flex items-start gap-2.5 bg-error/8 border border-error/15 rounded p-3">
                    <AlertTriangle size={14} className="text-error mt-0.5 shrink-0" />
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-base-content truncate">{media._title}</p>
                        <p className="text-[10px] font-mono text-base-content/40 truncate mt-0.5">{media._filename}</p>
                    </div>
                </div>

                <p className="text-xs text-base-content/50 leading-relaxed">Deletes this entry from the database. Depending on server settings, the physical file may also be removed.</p>
            </div>

            <ModalFooter>
                <button
                    onClick={onClose}
                    className="btn btn-sm btn-ghost rounded text-base-content/60 hover:text-base-content hover:bg-base-content/8 focus:outline-none focus-visible:outline-none focus:shadow-none [&:focus]:shadow-none">
                    Cancel
                </button>
                <button
                    onClick={() => onConfirm(media._id)}
                    disabled={isPending}
                    className="btn btn-sm btn-error rounded gap-1.5 disabled:opacity-50 focus:outline-none focus-visible:outline-none focus:shadow-none [&:focus]:shadow-none">
                    {isPending ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                    {isPending ? "Deleting…" : "Delete"}
                </button>
            </ModalFooter>
        </Modal>
    );
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ toast }) {
    if (!toast) return null;
    const color = toast.type === "success" ? "bg-success/15 border-success/30 text-success" : toast.type === "error" ? "bg-error/15 border-error/30 text-error" : "bg-info/15 border-info/30 text-info";
    return createPortal(
        <div className={`fixed bottom-5 right-5 z-[99999] flex items-center gap-2.5 border rounded px-4 py-2.5 shadow-xl text-xs font-medium max-w-xs ${color}`}>
            {toast.type === "success" && <CheckCircle2 size={14} className="shrink-0" />}
            {toast.type === "error" && <AlertTriangle size={14} className="shrink-0" />}
            <span>{toast.msg}</span>
        </div>,
        document.body,
    );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DashMedia() {
    const queryClient = useQueryClient();

    const [toast, setToast] = useState(null);
    const showToast = (msg, type = "success") => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 3000);
    };

    const [editMedia, setEditMedia] = useState(null);
    const [detailsMedia, setDetailsMedia] = useState(null);
    const [deleteMedia, setDeleteMedia] = useState(null);

    const {
        data: mediaData,
        isLoading,
        isError,
        error: queryError,
        refetch,
        isFetching,
    } = useQuery({
        queryKey: ["admin", "media"],
        queryFn: () => api.get("/api/media"),
        staleTime: 1000 * 60 * 5,
    });

    const updateMutation = useMutation({
        mutationFn: async (data) => {
            const { permission, ...rest } = data.payload;
            await api.patch(`/api/admin-dashboard/media/${data.id}`, { permission: permission === true });
            return api.patch(`/api/media/${data.id}`, rest);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["admin", "media"] });
            showToast("Media updated");
            setEditMedia(null);
        },
        onError: (err) => {
            showToast(err?.message || "Update failed", "error");
        },
    });

    const deleteMutation = useMutation({
        mutationFn: (id) => api.delete(`/api/media/${id}`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["admin", "media"] });
            showToast("Media deleted");
            setDeleteMedia(null);
        },
        onError: (err, id) => {
            queryClient.setQueryData(["admin", "media"], (old) => {
                if (!old) return old;
                const copy = JSON.parse(JSON.stringify(old));
                ["movies", "series", "anime"].forEach((key) => {
                    if (copy[key]?.items) {
                        copy[key].items = copy[key].items.filter((i) => i.id !== id);
                        copy[key].total = copy[key].items.length;
                    }
                });
                return copy;
            });
            showToast("Media deleted (optimistic)");
            setDeleteMedia(null);
        },
    });

    const [search, setSearch] = useState("");
    const [activeTab, setActiveTab] = useState("all");
    const [page, setPage] = useState(1);
    const pageSize = 5;

    const { allMedia, metrics } = useMemo(() => {
        if (!mediaData) return { allMedia: [], metrics: { total: 0, movies: 0, series: 0, anime: 0, size: 0 } };

        const items = [];
        const libs = new Map();
        let totalSize = 0;

        (mediaData.folders || []).forEach((f) => libs.set(f.id, f.label || f.path));

        const processItem = (item, type, Icon, label) => {
            const title = item.metadata?.name || item.metadata?.title || item.name || item.title || "Unknown";
            const originalTitle = item.metadata?.original_title || item.metadata?.original_name || "";
            const year = item.metadata?.year || item.year || null;
            const size = item.sizeBytes || 0;
            const added = item.addedAt || 0;
            const duration = item.metadata?.duration || item.duration || null;

            totalSize += size;
            const tags = extractTags(item.name || item.title || item.path || "");

            let poster = item.metadata?.poster;
            if (poster && poster.startsWith("/")) poster = `https://image.tmdb.org/t/p/w200${poster}`;

            items.push({
                ...item,
                _id: item.id,
                _type: type,
                _typeLabel: label,
                _icon: Icon,
                _title: title,
                _originalTitle: originalTitle,
                _year: year,
                _size: size,
                _added: new Date(added),
                _duration: duration,
                _library: item.folderLabel || libs.get(item.folderId) || "Unknown",
                _libraryId: item.folderId,
                _poster: poster,
                _filename: item.name || item.path || "",
                _path: item.path || "",
                ...tags,
            });
        };

        (mediaData.movies?.items || []).forEach((m) => processItem(m, "movie", Film, "Movie"));
        (mediaData.series?.items || []).forEach((s) => processItem(s, "series", Tv2, "Series"));
        (mediaData.anime?.items || []).forEach((a) => processItem(a, "anime", Swords, "Anime"));

        return {
            allMedia: items,
            metrics: {
                total: items.length,
                movies: mediaData.movies?.total || 0,
                series: mediaData.series?.total || 0,
                anime: mediaData.anime?.total || 0,
                size: totalSize,
            },
        };
    }, [mediaData]);

    const filteredMedia = useMemo(() => {
        let filtered = allMedia;
        if (search) {
            const q = search.toLowerCase();
            filtered = filtered.filter(
                (m) => m._title.toLowerCase().includes(q) || m._originalTitle.toLowerCase().includes(q) || m._filename.toLowerCase().includes(q) || (m._year && m._year.toString().includes(q)),
            );
        }
        if (activeTab !== "all") filtered = filtered.filter((m) => m._type === activeTab);
        return filtered;
    }, [allMedia, search, activeTab]);

    const sortedMedia = useMemo(() => {
        return [...filteredMedia].sort((a, b) => a._title.localeCompare(b._title));
    }, [filteredMedia]);

    const totalPages = Math.ceil(sortedMedia.length / pageSize) || 1;
    const currentPage = Math.min(page, totalPages);
    const paginatedMedia = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return sortedMedia.slice(start, start + pageSize);
    }, [sortedMedia, currentPage, pageSize]);

    // ─── Render ───────────────────────────────────────────────────────────────

    if (isError) {
        return (
            <div className="flex items-center gap-3 text-sm text-error bg-error/10 border border-error/20 rounded p-4">
                <AlertTriangle size={15} className="shrink-0" />
                <span>Failed to load media: {queryError?.message}</span>
            </div>
        );
    }

    return (
        <div className="space-y-5 pb-10 relative">
            <Toast toast={toast} />

            {editMedia && <EditModal media={editMedia} onClose={() => setEditMedia(null)} onSave={updateMutation.mutate} isPending={updateMutation.isPending} error={updateMutation.error} />}
            {detailsMedia && <DetailsModal media={detailsMedia} onClose={() => setDetailsMedia(null)} />}
            {deleteMedia && (
                <DeleteModal media={deleteMedia} onClose={() => setDeleteMedia(null)} onConfirm={deleteMutation.mutate} isPending={deleteMutation.isPending} error={deleteMutation.error} />
            )}

            {/* ── Header ── */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-xl font-bold text-base-content tracking-tight flex items-center gap-2">
                        <Database size={18} className="text-primary" />
                        Media Library
                    </h1>
                    <p className="text-xs text-base-content/40 mt-0.5 ml-6.5">{isLoading ? "Loading…" : `${metrics.total.toLocaleString()} titles indexed`}</p>
                </div>
                <button
                    onClick={() => refetch()}
                    disabled={isFetching}
                    className="btn btn-sm btn-primary rounded gap-1.5 disabled:opacity-50 focus:outline-none focus-visible:outline-none focus:shadow-none [&:focus]:shadow-none">
                    <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />
                    {isFetching ? "Syncing…" : "Sync"}
                </button>
            </div>

            {/* ── Metrics ── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <MetricCard title="Total" value={isLoading ? "—" : metrics.total.toLocaleString()} icon={FileVideo} accent="oklch(var(--in))" />
                <MetricCard title="Movies" value={isLoading ? "—" : metrics.movies.toLocaleString()} icon={Film} accent="oklch(var(--p))" />
                <MetricCard
                    title="Series & Anime"
                    value={isLoading ? "—" : (metrics.series + metrics.anime).toLocaleString()}
                    icon={Tv2}
                    accent="oklch(var(--su))"
                    sub={`${metrics.series} series · ${metrics.anime} anime`}
                />
                <MetricCard title="Storage" value={isLoading ? "—" : fmtBytes(metrics.size)} icon={HardDrive} accent="oklch(var(--a))" />
            </div>

            {/* ── Controls ── */}
            <div className="space-y-3">
                {/* Tab filter menu */}
                <div className="flex items-center gap-1">
                    {[
                        { key: "all", label: "All", count: metrics.total },
                        { key: "movie", label: "Movies", count: metrics.movies },
                        { key: "series", label: "Series", count: metrics.series },
                        { key: "anime", label: "Anime", count: metrics.anime },
                    ].map(({ key, label, count }) => {
                        const active = activeTab === key;
                        return (
                            <button
                                key={key}
                                onClick={() => {
                                    setActiveTab(key);
                                    setPage(1);
                                }}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors focus:outline-none focus-visible:outline-none focus:shadow-none [&:focus]:shadow-none ${
                                    active ? "bg-primary text-primary-content" : "text-base-content/50 hover:text-base-content hover:bg-base-content/8"
                                }`}>
                                {label}
                                {!isLoading && <span className={`tabular-nums text-[10px] ${active ? "opacity-70" : "opacity-50"}`}>{count}</span>}
                            </button>
                        );
                    })}

                    {/* Search — pushed to right */}
                    <div className="relative ml-auto">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-base-content/35 pointer-events-none" />
                        <input
                            type="text"
                            placeholder="Search…"
                            value={search}
                            onChange={(e) => {
                                setSearch(e.target.value);
                                setPage(1);
                            }}
                            className="input input-sm w-48 pl-7.5 bg-base-200 border border-base-content/10 rounded text-xs focus:outline-none focus:border-primary/40 focus:w-64 transition-all duration-200"
                        />
                    </div>
                </div>
            </div>

            {/* ── Table ── */}
            <div className="bg-base-200 border border-base-content/8 rounded-lg overflow-hidden">
                <div className="overflow-x-auto min-h-[360px]">
                    <table className="table w-full text-sm">
                        <thead className="sticky top-0 z-10 bg-base-300/95 backdrop-blur-md border-b border-base-content/8">
                            <tr className="text-[9px] font-semibold uppercase tracking-widest text-base-content/40">
                                <th className="pl-5 pr-3 py-3.5 w-10">#</th>
                                <th className="px-3 py-3.5">Title</th>
                                <th className="px-3 py-3.5 hidden sm:table-cell">Type</th>
                                <th className="px-3 py-3.5 hidden lg:table-cell text-center">Quality</th>
                                <th className="px-3 py-3.5 hidden xl:table-cell text-center">Codec</th>
                                <th className="px-3 py-3.5 hidden md:table-cell text-right">Size</th>
                                <th className="px-3 py-3.5 hidden lg:table-cell">Library</th>
                                <th className="px-3 py-3.5 hidden xl:table-cell">Added</th>
                                <th className="px-3 py-3.5 hidden lg:table-cell text-center">Permission</th>
                                <th className="pl-3 pr-5 py-3.5 text-right">Actions</th>
                            </tr>
                        </thead>

                        <tbody>
                            {isLoading ? (
                                [...Array(10)].map((_, i) => (
                                    <tr key={i} className="border-b border-base-content/5">
                                        {[4, 30, 8, 8, 8, 8, 10, 8, 10].map((w, j) => (
                                            <td
                                                key={j}
                                                className="px-3 py-3.5 first:pl-5 last:pr-5 hidden first:table-cell last:table-cell sm:[&:nth-child(3)]:table-cell md:[&:nth-child(6)]:table-cell lg:[&:nth-child(4)]:table-cell lg:[&:nth-child(7)]:table-cell xl:table-cell">
                                                <div className="h-2.5 rounded bg-base-content/6 animate-pulse" style={{ width: `${w}%`, minWidth: "1.5rem" }} />
                                            </td>
                                        ))}
                                    </tr>
                                ))
                            ) : paginatedMedia.length === 0 ? (
                                <tr>
                                    <td colSpan={9} className="py-20">
                                        <div className="flex flex-col items-center gap-3 text-center">
                                            <div className="w-12 h-12 rounded bg-base-300 flex items-center justify-center">
                                                <Search size={22} className="text-base-content/15" />
                                            </div>
                                            <div>
                                                <p className="font-semibold text-sm text-base-content/60">No media found</p>
                                                <p className="text-xs text-base-content/35 mt-0.5">Try adjusting filters or search query</p>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                paginatedMedia.map((item, i) => {
                                    const index = (currentPage - 1) * pageSize + i + 1;
                                    const TypeIcon = item._icon;

                                    return (
                                        <tr key={item._id} className="group border-b border-base-content/5 last:border-0 hover:bg-base-100/60 transition-colors">
                                            {/* # */}
                                            <td className="pl-5 pr-3 py-3 text-base-content/25 font-mono text-[10px] tabular-nums">{String(index).padStart(2, "0")}</td>

                                            {/* Title */}
                                            <td className="px-3 py-3">
                                                <div className="flex items-center gap-2.5">
                                                    <div className="w-8 h-11 rounded bg-base-300 flex items-center justify-center shrink-0 overflow-hidden">
                                                        {item._poster ? (
                                                            <img src={item._poster} alt="" className="w-full h-full object-cover" loading="lazy" />
                                                        ) : (
                                                            <ImageIcon size={13} className="text-base-content/15" />
                                                        )}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="font-semibold text-base-content/85 text-[13px] truncate max-w-[160px] md:max-w-[260px]" title={item._title}>
                                                            {item._title}
                                                        </p>
                                                        <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-base-content/35">
                                                            {item._year && <span className="tabular-nums">{item._year}</span>}
                                                            {item._year && <span>·</span>}
                                                            <span className="font-mono text-[9px] truncate max-w-[100px]">{item._filename}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>

                                            {/* Type */}
                                            <td className="px-3 py-3 hidden sm:table-cell">
                                                <div className="flex items-center gap-1.5">
                                                    <TypeIcon size={12} className="text-base-content/35 shrink-0" />
                                                    <Badge label={item._typeLabel} variant={item._type} />
                                                </div>
                                            </td>

                                            {/* Quality */}
                                            <td className="px-3 py-3 hidden lg:table-cell text-center">
                                                <div className="flex flex-col items-center gap-0.5">
                                                    {item.res ? (
                                                        <span className="px-1.5 py-0.5 rounded bg-base-content/8 text-[9px] font-bold text-base-content/60">{item.res}</span>
                                                    ) : (
                                                        <span className="text-[10px] text-base-content/15">—</span>
                                                    )}
                                                    {item._duration && <span className="text-[9px] text-base-content/30 tabular-nums">{fmtDuration(item._duration)}</span>}
                                                </div>
                                            </td>

                                            {/* Codec */}
                                            <td className="px-3 py-3 hidden xl:table-cell">
                                                <div className="flex items-center justify-center gap-1 flex-wrap">
                                                    {item.vcodec && <span className="px-1.5 py-0.5 rounded bg-base-content/6 text-[9px] font-mono text-base-content/45">{item.vcodec}</span>}
                                                    {item.acodec && <span className="px-1.5 py-0.5 rounded bg-base-content/6 text-[9px] font-mono text-base-content/45">{item.acodec}</span>}
                                                    {!item.vcodec && !item.acodec && <span className="text-base-content/15 text-[10px]">—</span>}
                                                </div>
                                            </td>

                                            {/* Size */}
                                            <td className="px-3 py-3 hidden md:table-cell text-right">
                                                <span className="text-[11px] font-medium text-base-content/70 tabular-nums">{fmtBytes(item._size)}</span>
                                            </td>

                                            {/* Library */}
                                            <td className="px-3 py-3 hidden lg:table-cell">
                                                <div className="flex items-center gap-1.5 text-base-content/40">
                                                    <FolderOpen size={11} className="shrink-0" />
                                                    <span className="text-[11px] truncate max-w-[90px]">{item._library}</span>
                                                </div>
                                            </td>

                                            {/* Added */}
                                            <td className="px-3 py-3 hidden xl:table-cell">
                                                <span className="text-[11px] text-base-content/40 whitespace-nowrap tabular-nums">{fmtDate(item._added)}</span>
                                            </td>

                                            {/* Permission Control */}
                                            <td className="px-3 py-3 hidden lg:table-cell text-center">
                                                {!item.permission ? (
                                                    <span className="px-1.5 py-0.5 rounded bg-error/15 text-error text-[9px] font-bold uppercase tracking-wider">Restricted</span>
                                                ) : (
                                                    <span className="px-1.5 py-0.5 rounded bg-base-content/8 text-base-content/40 text-[9px] font-bold uppercase tracking-wider">Normal</span>
                                                )}
                                            </td>

                                            {/* Actions */}
                                            <td className="pl-3 pr-5 py-3">
                                                <div className="flex items-center justify-end gap-0.5">
                                                    <button
                                                        onClick={() => setEditMedia(item)}
                                                        title="Edit"
                                                        className="w-7 h-7 rounded flex items-center justify-center text-base-content/35 hover:text-info hover:bg-info/12 transition-colors">
                                                        <SquarePen size={14} strokeWidth={2} />
                                                    </button>
                                                    <button
                                                        onClick={() => setDetailsMedia(item)}
                                                        title="Details"
                                                        className="w-7 h-7 rounded flex items-center justify-center text-base-content/35 hover:text-primary hover:bg-primary/12 transition-colors">
                                                        <Info size={14} strokeWidth={2} />
                                                    </button>
                                                    <button
                                                        onClick={() => setDeleteMedia(item)}
                                                        title="Delete"
                                                        className="w-7 h-7 rounded flex items-center justify-center text-base-content/35 hover:text-error hover:bg-error/12 transition-colors">
                                                        <Trash2 size={14} strokeWidth={2} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ── Pagination ── */}
            {sortedMedia.length > 0 && (
                <div className="flex items-center justify-between">
                    <span className="text-xs text-base-content/40 tabular-nums">
                        {((currentPage - 1) * pageSize + 1).toLocaleString()}–{Math.min(currentPage * pageSize, sortedMedia.length).toLocaleString()} of {sortedMedia.length.toLocaleString()}
                    </span>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            disabled={currentPage <= 1}
                            className="w-7 h-7 rounded flex items-center justify-center text-base-content/50 hover:text-base-content hover:bg-base-content/8 disabled:opacity-25 transition-colors focus:outline-none focus-visible:outline-none focus:shadow-none [&:focus]:shadow-none">
                            <ChevronLeft size={15} />
                        </button>
                        <span className="text-xs text-base-content/40 px-2 tabular-nums">
                            {currentPage} / {totalPages}
                        </span>
                        <button
                            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                            disabled={currentPage >= totalPages}
                            className="w-7 h-7 rounded flex items-center justify-center text-base-content/50 hover:text-base-content hover:bg-base-content/8 disabled:opacity-25 transition-colors focus:outline-none focus-visible:outline-none focus:shadow-none ">
                            <ChevronRight size={15} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
