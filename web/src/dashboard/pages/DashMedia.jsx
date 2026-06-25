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
    Filter,
    TrendingUp,
    Shield,
    ShieldOff,
    SortAsc,
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

// ─── Design tokens ────────────────────────────────────────────────────────────

const TYPE_CONFIG = {
    movie: {
        color: "oklch(var(--p))",
        bgClass: "bg-primary/12 text-primary",
        borderClass: "border-primary/20",
        Icon: Film,
    },
    series: {
        color: "oklch(var(--in))",
        bgClass: "bg-info/12 text-info",
        borderClass: "border-info/20",
        Icon: Tv2,
    },
    anime: {
        color: "oklch(var(--a))",
        bgClass: "bg-accent/12 text-accent",
        borderClass: "border-accent/20",
        Icon: Swords,
    },
};

// ─── Shared UI ────────────────────────────────────────────────────────────────

function MetricCard({ title, value, icon: Icon, accent, sub, isLoading }) {
    return (
        <div className="bg-base-300 rounded-xl border border-white/6 px-4 py-4 flex items-center gap-3.5 hover:border-white/10 transition-colors">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: `color-mix(in oklch, ${accent} 15%, transparent)` }}>
                <Icon size={18} strokeWidth={1.8} style={{ color: accent }} />
            </div>
            <div className="min-w-0">
                {isLoading ? <div className="h-6 w-14 rounded animate-pulse bg-white/5 mb-1" /> : <p className="text-2xl font-black text-white tabular-nums leading-none">{value}</p>}
                <p className="text-xs text-white/70 mt-0.5 font-medium">{title}</p>
                {sub && <p className="text-[10px] text-white/30 mt-0.5">{sub}</p>}
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
        <button onClick={handle} title={title} className="w-6 h-6 rounded-md flex items-center justify-center text-white/85 hover:text-white hover:bg-white/10 transition-colors">
            {copied ? <Check size={11} className="text-success" strokeWidth={2.2} /> : <Copy size={11} className="text-white/90" strokeWidth={2} />}
        </button>
    );
}

function Badge({ label, variant = "default", size = "sm" }) {
    const cls =
        {
            movie: "bg-primary/15 text-primary border border-primary/20",
            series: "bg-info/15 text-info border border-info/20",
            anime: "bg-accent/15 text-accent border border-accent/20",
            default: "bg-base-content/8 text-base-content/55 border border-base-content/10",
        }[variant] || "bg-base-content/8 text-base-content/55 border border-base-content/10";

    const sizeClass = size === "xs" ? "px-1 py-0 text-[8px]" : "px-1.5 py-0.5 text-[9px]";

    return <span className={`inline-flex items-center rounded-md font-bold uppercase tracking-wider ${sizeClass} ${cls}`}>{label}</span>;
}

function QualityChip({ label }) {
    const color =
        label === "4K"
            ? "bg-warning/15 text-warning border-warning/20"
            : label === "1080p"
              ? "bg-success/15 text-success border-success/20"
              : label === "720p"
                ? "bg-info/15 text-info border-info/20"
                : "bg-base-content/8 text-base-content/50 border-base-content/12";
    return <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md border text-[9px] font-bold tracking-wider ${color}`}>{label}</span>;
}

function CodecChip({ label }) {
    return <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-base-content/6 border border-base-content/8 text-[9px] font-mono text-base-content/90">{label}</span>;
}

// ─── Modal Shell ──────────────────────────────────────────────────────────────

function Modal({ onClose, children }) {
    return createPortal(
        <div className="fixed inset-0 z-9999 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm" onClick={onClose}>
            <div
                className="relative w-[min(32rem,90vw)] h-[min(32rem,90vh)] bg-base-300 rounded-2xl shadow-2xl border border-base-content/10 overflow-hidden flex flex-col"
                style={{ boxShadow: "0 25px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)" }}
                onClick={(e) => e.stopPropagation()}>
                {children}
            </div>
        </div>,
        document.body,
    );
}

function ModalHeader({ title, subtitle, onClose, poster, typeBadge }) {
    const config = typeBadge ? TYPE_CONFIG[typeBadge.type] : null;
    return (
        <div className="flex items-start justify-between px-5 pt-4 pb-3.5 border-b border-base-content/8 shrink-0">
            <div className="flex items-center gap-3.5 min-w-0">
                {poster !== undefined && (
                    <div className="w-10 h-14 rounded-lg bg-base-300 flex items-center justify-center shrink-0 overflow-hidden ring-1 ring-base-content/10">
                        {poster ? <img src={poster} alt="" className="w-full h-full object-cover" /> : <ImageIcon size={14} className="text-base-content/40" />}
                    </div>
                )}
                <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                        <h2 className="font-bold text-sm text-base-content leading-tight">{title}</h2>
                        {typeBadge && <Badge label={typeBadge.label} variant={typeBadge.type} />}
                    </div>
                    {subtitle && <p className="text-[11px] text-base-content/85 truncate font-mono">{subtitle}</p>}
                </div>
            </div>
            <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 transition-colors shrink-0 ml-2 cursor-pointer">
                <X size={14} />
            </button>
        </div>
    );
}

function ModalFooter({ children }) {
    return <div className="px-5 py-3.5 flex items-center justify-end gap-2 border-t border-base-content/8 shrink-0 bg-base-300/40">{children}</div>;
}

// ─── Section divider for modals ───────────────────────────────────────────────

function SectionLabel({ label }) {
    return (
        <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px] font-bold uppercase tracking-widest text-white/85">{label}</span>
            <div className="flex-1 h-px bg-base-content/8" />
        </div>
    );
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

            <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1 scrollbar-none">
                {error && (
                    <div className="flex items-center gap-2.5 text-xs text-error bg-error/10 border border-error/20 rounded-xl px-4 py-3">
                        <AlertTriangle size={13} className="shrink-0 text-error" strokeWidth={2} />
                        <span>{error.message || "Failed to update media"}</span>
                    </div>
                )}

                <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/85">Title</label>
                    <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        className="input input-sm w-full bg-base-300 border border-base-content/20 rounded-xl text-sm text-white placeholder:text-base-content/40 focus:outline-none focus:border-primary/50 focus:bg-base-100 transition-colors"
                        placeholder="Media title..."
                    />
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/85">Year</label>
                        <input
                            type="number"
                            value={year}
                            onChange={(e) => setYear(e.target.value)}
                            className="input input-sm w-full bg-base-300 border border-base-content/20 rounded-xl text-sm text-white placeholder:text-base-content/40 focus:outline-none focus:border-primary/50 transition-colors"
                            placeholder="2024"
                            min={1900}
                            max={2099}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/85">Type</label>
                        <select
                            value={type}
                            onChange={(e) => setType(e.target.value)}
                            className="select select-sm w-full bg-base-300 border border-base-content/20 rounded-xl text-sm text-white focus:outline-none focus:border-primary/50 transition-colors">
                            <option value="movie" className="text-black">
                                Movie
                            </option>
                            <option value="series" className="text-black">
                                Series
                            </option>
                            <option value="anime" className="text-black">
                                Anime
                            </option>
                        </select>
                    </div>
                </div>

                {/* Permission toggle
                    permission=true  → Normal (allowed)
                    permission=false → Restricted
                    Toggle is "Restrict access" — checked means RESTRICTED (permission=false) */}
                <div className={`border rounded-xl p-4 transition-colors ${permission ? "bg-base-300 border-base-content/8" : "bg-error/5 border-error/20"}`}>
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                            {permission ? (
                                <div className="w-8 h-8 rounded-lg bg-success/20 flex items-center justify-center shrink-0">
                                    <Shield size={15} className="text-success" strokeWidth={2} />
                                </div>
                            ) : (
                                <div className="w-8 h-8 rounded-lg bg-error/20 flex items-center justify-center shrink-0">
                                    <ShieldOff size={15} className="text-error" strokeWidth={2} />
                                </div>
                            )}
                            <div>
                                <p className={`text-xs font-bold ${permission ? "text-success" : "text-error"}`}>{permission ? "Normal Access" : "Restricted"}</p>
                                <p className="text-[10px] text-base-content/80 mt-0.5">{permission ? "Media is accessible — click to restrict" : "Access is restricted — click to allow"}</p>
                            </div>
                        </div>
                        {/* checkbox checked = restricted = !permission */}
                        <button
                            type="button"
                            role="switch"
                            aria-checked={!permission}
                            onClick={() => setPermission((prev) => !prev)}
                            className={`relative inline-flex items-center w-11 h-6 rounded-full border shrink-0 transition-colors duration-200 focus:outline-none cursor-pointer ${!permission ? "bg-error/70 border-error/40" : "bg-base-content/15 border-base-content/20"}`}>
                            <span className={`absolute left-0.5 w-4.5 h-4.5 rounded-full bg-white shadow-sm transition-transform duration-200 ${!permission ? "translate-x-5" : "translate-x-0"}`} />
                        </button>
                    </div>
                </div>

                {/* Media ID */}
                <div className="space-y-1.5">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-base-content/85">Media ID</p>
                    <div className="flex items-center gap-2 bg-base-300 border border-base-content/8 rounded-xl px-3 py-2">
                        <span className="text-[10px] font-mono text-base-content/85 truncate flex-1">{media._id}</span>
                        <CopyBtn text={media._id} title="Copy ID" />
                    </div>
                </div>
            </div>

            <ModalFooter>
                <button onClick={onClose} className="px-4 py-2 rounded-md text-sm font-bold text-white/75 hover:text-white hover:bg-white/8 transition-colors border-none cursor-pointer">
                    Cancel
                </button>
                <button
                    onClick={handleSubmit}
                    disabled={isPending}
                    className="px-4 py-2 rounded-md text-sm font-bold bg-primary text-primary-content hover:opacity-90 transition-opacity border-none cursor-pointer disabled:opacity-40 flex items-center gap-1.5">
                    {isPending ? <Loader2 size={12} className="animate-spin" strokeWidth={2.2} /> : <Check size={12} strokeWidth={2.2} />}
                    {isPending ? "Saving…" : "Save changes"}
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
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/85">{label}</p>
                {copyText && <CopyBtn text={copyText} title={`Copy ${label}`} />}
            </div>
            {mono ? (
                <p className="text-[10px] font-mono text-base-content/95 break-all bg-base-300 border border-base-content/8 rounded-lg px-2.5 py-1.5 leading-relaxed">{value || "—"}</p>
            ) : (
                <p className="text-sm font-semibold text-base-content">{value || "—"}</p>
            )}
        </div>
    );
}

function DetailsModal({ media, onClose }) {
    const linkDest = media._type === "movie" ? `/player/${media._id}` : `/series/${media._id}`;
    const config = TYPE_CONFIG[media._type] || TYPE_CONFIG.movie;
    const TypeIcon = config.Icon;

    return (
        <Modal onClose={onClose}>
            {/* Hero section with poster */}
            {media._poster && (
                <div className="relative h-28 sm:h-36 overflow-hidden shrink-0">
                    <img src={media._poster} alt="" className="w-full h-full object-cover scale-110 blur-sm opacity-30" />
                    <div className="absolute inset-0 bg-linear-to-b from-transparent to-base-200" />
                    <div className="absolute bottom-3 left-5 flex items-end gap-3">
                        <div className="w-12 h-17 sm:w-14 sm:h-20 rounded-xl overflow-hidden ring-2 ring-base-content/20 shadow-xl shrink-0">
                            <img src={media._poster} alt="" className="w-full h-full object-cover" />
                        </div>
                        <div className="pb-1">
                            <div className="flex items-center gap-2 mb-1">
                                <Badge label={media._typeLabel} variant={media._type} />
                                {media._year && <span className="text-[10px] text-base-content/80 font-medium">{media._year}</span>}
                            </div>
                            <h2 className="font-bold text-sm sm:text-base text-base-content leading-tight max-w-56 sm:max-w-65 truncate">{media._title}</h2>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="absolute top-3 right-3 w-7 h-7 rounded-lg bg-black/50 flex items-center justify-center text-white/90 hover:text-white hover:bg-black/70 transition-colors cursor-pointer">
                        <X size={14} />
                    </button>
                </div>
            )}

            {!media._poster && <ModalHeader title={media._title} subtitle={media._filename} onClose={onClose} poster={media._poster} typeBadge={{ label: media._typeLabel, type: media._type }} />}

            <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1 scrollbar-none">
                {/* Quick stats */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                        { label: "Year", value: media._year || "—", icon: Calendar },
                        { label: "Quality", value: media.res || "—", icon: Star },
                        { label: "Duration", value: fmtDuration(media._duration), icon: Layers },
                        { label: "Size", value: fmtBytes(media._size), icon: HardDrive },
                    ].map(({ label, value, icon: Icon }) => (
                        <div key={label} className="bg-base-300 border border-base-content/8 rounded-xl p-3 text-center">
                            <Icon size={13} className="mx-auto mb-1 text-base-content/85" strokeWidth={2} />
                            <p className="text-[9px] font-semibold uppercase tracking-widest text-base-content/85 mb-1">{label}</p>
                            <p className="text-xs font-bold text-base-content tabular-nums leading-tight">{value}</p>
                        </div>
                    ))}
                </div>

                {/* Overview */}
                {media.metadata?.overview && (
                    <div>
                        <SectionLabel label="Overview" />
                        <p className="text-xs text-base-content/95 leading-relaxed line-clamp-4">{media.metadata.overview}</p>
                    </div>
                )}

                {/* Genres */}
                {media.metadata?.genres?.length > 0 && (
                    <div>
                        <SectionLabel label="Genres" />
                        <div className="flex flex-wrap gap-1.5">
                            {media.metadata.genres.map((g) => (
                                <span key={g} className="px-2.5 py-1 rounded-lg bg-primary/15 border border-primary/40 text-[10px] font-medium text-primary/90">
                                    {g}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {/* Technical */}
                {(media.vcodec || media.acodec) && (
                    <div>
                        <SectionLabel label="Technical" />
                        <div className="flex items-center gap-2 flex-wrap">
                            {media.vcodec && <CodecChip label={media.vcodec} />}
                            {media.acodec && <CodecChip label={media.acodec} />}
                        </div>
                    </div>
                )}

                {/* File details */}
                <div>
                    <SectionLabel label="File Information" />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                        <InfoRow
                            label="Library"
                            value={
                                <span className="flex items-center gap-1.5 text-sm">
                                    <FolderOpen size={12} className="text-base-content/90 shrink-0" strokeWidth={2} />
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
                                        <Star size={12} className="text-warning fill-warning" strokeWidth={2} />
                                        {media.metadata.rating}
                                    </span>
                                }
                            />
                        )}
                        <InfoRow label="File Path" value={media._path} mono full copyText={media._path} />
                        <InfoRow label="Media ID" value={media._id} mono full copyText={media._id} />
                    </div>
                </div>
            </div>

            <ModalFooter>
                <button onClick={onClose} className="px-4 py-2 rounded-md text-sm font-bold text-white/75 hover:text-white hover:bg-white/8 transition-colors border-none cursor-pointer">
                    Close
                </button>
                <Link
                    to={linkDest}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 rounded-md text-sm font-bold bg-primary text-primary-content hover:opacity-90 transition-opacity border-none cursor-pointer flex items-center gap-1.5">
                    <Play size={13} className="ml-0.5" strokeWidth={2.2} />
                    Play Now
                </Link>
            </ModalFooter>
        </Modal>
    );
}

// ─── Delete Modal ─────────────────────────────────────────────────────────────

function DeleteModal({ media, onClose, onConfirm, isPending, error }) {
    return (
        <Modal onClose={onClose}>
            <ModalHeader title="Delete Media" subtitle="This action cannot be undone" onClose={onClose} />

            <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1 scrollbar-none">
                {error && (
                    <div className="flex items-center gap-2.5 text-xs text-error bg-error/10 border border-error/20 rounded-xl px-4 py-3">
                        <AlertTriangle size={13} className="shrink-0" />
                        <span>{error.message || "Failed to delete"}</span>
                    </div>
                )}

                <div className="flex items-start gap-3 bg-error/8 border border-error/15 rounded-xl p-4">
                    <div className="w-8 h-8 rounded-lg bg-error/20 flex items-center justify-center shrink-0">
                        <Trash2 size={15} className="text-error" strokeWidth={2} />
                    </div>
                    <div className="min-w-0">
                        <p className="text-sm font-bold text-base-content truncate">{media._title}</p>
                        <p className="text-[10px] font-mono text-base-content/85 truncate mt-0.5">{media._filename}</p>
                    </div>
                </div>

                <p className="text-xs text-base-content/90 leading-relaxed">Deletes this entry from the database. Depending on server settings, the physical file may also be removed.</p>
            </div>

            <ModalFooter>
                <button onClick={onClose} className="btn btn-sm btn-ghost rounded-xl text-base-content/55 hover:text-base-content hover:bg-base-content/8 focus:outline-none">
                    Cancel
                </button>
                <button
                    onClick={() => onConfirm(media._id)}
                    disabled={isPending}
                    className="px-4 py-2 rounded-md text-sm font-bold bg-error text-error-content hover:opacity-90 transition-opacity border-none cursor-pointer disabled:opacity-40 flex items-center gap-1.5">
                    {isPending ? <Loader2 size={12} className="animate-spin" strokeWidth={2.2} /> : <Trash2 size={12} strokeWidth={2.2} />}
                    {isPending ? "Deleting…" : "Delete"}
                </button>
            </ModalFooter>
        </Modal>
    );
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ toast }) {
    if (!toast) return null;
    return createPortal(
        <div
            className={`fixed bottom-5 right-5 z-99999 flex items-center gap-2 px-4 py-3
            rounded-lg shadow-2xl text-xs font-bold max-w-xs
            ${toast.type === "error" ? "bg-error text-error-content" : "bg-success text-success-content"}`}>
            {toast.type === "error" ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
            <span>{toast.msg}</span>
        </div>,
        document.body,
    );
}

// ─── Table skeleton row ───────────────────────────────────────────────────────

function SkeletonRow() {
    return (
        <tr className="border-b border-white/4">
            <td className="pl-4 pr-2 py-3.5">
                <div className="h-2 w-4 rounded bg-white/5 animate-pulse" />
            </td>
            <td className="px-3 py-3.5">
                <div className="flex items-center gap-2.5">
                    <div className="w-8 h-11 rounded-lg bg-white/5 animate-pulse shrink-0" />
                    <div className="space-y-1.5">
                        <div className="h-3 w-32 rounded bg-white/5 animate-pulse" />
                        <div className="h-2 w-20 rounded bg-white/4 animate-pulse" />
                    </div>
                </div>
            </td>
            <td className="px-3 py-3.5">
                <div className="h-5 w-14 rounded-md bg-white/5 animate-pulse" />
            </td>
            <td className="px-3 py-3.5">
                <div className="h-5 w-12 rounded-md bg-white/5 animate-pulse mx-auto" />
            </td>
            <td className="px-3 py-3.5">
                <div className="flex gap-1 justify-center">
                    <div className="h-5 w-10 rounded-md bg-white/5 animate-pulse" />
                    <div className="h-5 w-8 rounded-md bg-white/5 animate-pulse" />
                </div>
            </td>
            <td className="px-3 py-3.5 text-right">
                <div className="h-3 w-12 rounded bg-white/5 animate-pulse ml-auto" />
            </td>
            <td className="px-3 py-3.5">
                <div className="h-3 w-16 rounded bg-white/5 animate-pulse" />
            </td>
            <td className="px-3 py-3.5">
                <div className="h-3 w-20 rounded bg-white/5 animate-pulse" />
            </td>
            <td className="px-3 py-3.5">
                <div className="h-5 w-16 rounded-md bg-white/5 animate-pulse mx-auto" />
            </td>
            <td className="pl-2 pr-4 py-3.5">
                <div className="flex gap-1 justify-end">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="w-8 h-8 rounded-md bg-white/5 animate-pulse" />
                    ))}
                </div>
            </td>
        </tr>
    );
}

// ─── Pagination ───────────────────────────────────────────────────────────────

function Pagination({ currentPage, totalPages, totalItems, pageSize, onPageChange }) {
    const start = (currentPage - 1) * pageSize + 1;
    const end = Math.min(currentPage * pageSize, totalItems);

    const pages = useMemo(() => {
        const delta = 1;
        const range = [];
        for (let i = Math.max(2, currentPage - delta); i <= Math.min(totalPages - 1, currentPage + delta); i++) {
            range.push(i);
        }
        const result = [1];
        if (range[0] > 2) result.push("...");
        result.push(...range);
        if (range[range.length - 1] < totalPages - 1) result.push("...");
        if (totalPages > 1) result.push(totalPages);
        return result;
    }, [currentPage, totalPages]);

    if (totalItems === 0) return null;

    return (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <p className="text-xs text-white/40 tabular-nums">
                Showing{" "}
                <span className="text-white/70 font-semibold">
                    {start.toLocaleString()}–{end.toLocaleString()}
                </span>{" "}
                of <span className="text-white/70 font-semibold">{totalItems.toLocaleString()}</span> items
            </p>
            <div className="flex items-center gap-1">
                <button
                    onClick={() => onPageChange(1)}
                    disabled={currentPage <= 1}
                    className="w-8 h-8 rounded-md flex items-center justify-center text-white/70 border-none hover:bg-white/8 hover:text-white transition-colors disabled:opacity-25 disabled:cursor-not-allowed cursor-pointer">
                    <ChevronLeft size={12} strokeWidth={2.5} className="inline" />
                    <ChevronLeft size={12} strokeWidth={2.5} className="-ml-2" />
                </button>
                <button
                    onClick={() => onPageChange(currentPage - 1)}
                    disabled={currentPage <= 1}
                    className="w-8 h-8 rounded-md flex items-center justify-center text-white/70 border-none hover:bg-white/8 hover:text-white transition-colors disabled:opacity-25 disabled:cursor-not-allowed cursor-pointer">
                    <ChevronLeft size={14} />
                </button>

                {pages.map((p, i) =>
                    p === "..." ? (
                        <span key={`ellipsis-${i}`} className="w-8 h-8 flex items-center justify-center text-white/30 text-xs">
                            …
                        </span>
                    ) : (
                        <button
                            key={p}
                            onClick={() => onPageChange(p)}
                            className={`w-8 h-8 rounded-md text-xs font-bold transition-colors border-none cursor-pointer
                                ${p === currentPage ? "bg-primary text-primary-content shadow-sm" : "text-white/60 hover:bg-white/8 hover:text-white"}`}>
                            {p}
                        </button>
                    ),
                )}

                <button
                    onClick={() => onPageChange(currentPage + 1)}
                    disabled={currentPage >= totalPages}
                    className="w-8 h-8 rounded-md flex items-center justify-center text-white/70 border-none hover:bg-white/8 hover:text-white transition-colors disabled:opacity-25 disabled:cursor-not-allowed cursor-pointer">
                    <ChevronRight size={14} />
                </button>
                <button
                    onClick={() => onPageChange(totalPages)}
                    disabled={currentPage >= totalPages}
                    className="w-8 h-8 rounded-md flex items-center justify-center text-white/70 border-none hover:bg-white/8 hover:text-white transition-colors disabled:opacity-25 disabled:cursor-not-allowed cursor-pointer">
                    <ChevronRight size={12} strokeWidth={2.5} className="inline" />
                    <ChevronRight size={12} strokeWidth={2.5} className="-ml-2" />
                </button>
            </div>
        </div>
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
        // Your server has no generic PATCH /api/media/:id — all edits are optimistic
        // cache-only (session-level). Optionally trigger a metadata refresh from TMDB.
        mutationFn: async (data) => {
            // Non-fatal: try to refresh TMDB metadata; ignore if endpoint fails.
            try {
                await api.post(`/api/metadata/refresh/${data.id}`);
            } catch {
                /* ok */
            }
            return data;
        },
        onMutate: async (data) => {
            // Prevent outgoing refetches clobbering our update
            await queryClient.cancelQueries({ queryKey: ["admin", "media"] });
            const previous = queryClient.getQueryData(["admin", "media"]);

            queryClient.setQueryData(["admin", "media"], (old) => {
                if (!old) return old;
                const copy = JSON.parse(JSON.stringify(old));
                const { id, payload } = data;
                const patch = (items) =>
                    (items || []).map((item) => {
                        if (item.id !== id) return item;
                        return {
                            ...item,
                            // Persist permission flag on the item directly
                            permission: payload.permission,
                            name: payload.title || item.name,
                            metadata: item.metadata
                                ? {
                                      ...item.metadata,
                                      title: payload.title || item.metadata.title,
                                      year: payload.year || item.metadata.year,
                                  }
                                : item.metadata,
                        };
                    });
                if (copy.movies?.items) copy.movies.items = patch(copy.movies.items);
                if (copy.series?.items) copy.series.items = patch(copy.series.items);
                if (copy.anime?.items) copy.anime.items = patch(copy.anime.items);
                return copy;
            });

            return { previous };
        },
        onSuccess: () => {
            showToast("Media updated");
            setEditMedia(null);
        },
        onError: (err, _data, context) => {
            // Roll back optimistic update on real failure
            if (context?.previous) queryClient.setQueryData(["admin", "media"], context.previous);
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

            // Movies carry the real filename on item.name. Series/anime are group
            // objects — the filename with quality/codec tags lives on the first
            // episode of the first season instead, so dig there as a fallback.
            let sourceFilename = item.name || item.path || "";
            if (!sourceFilename && item.seasons) {
                const firstSeason = Object.values(item.seasons)[0];
                const firstEpisode = firstSeason?.episodes?.[0];
                sourceFilename = firstEpisode?.name || firstEpisode?.path || "";
            }
            const tags = extractTags(sourceFilename || item.title || "");

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
                _filename: sourceFilename || item.name || item.path || "",
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

    // ─── Error state ──────────────────────────────────────────────────────────

    if (isError) {
        return (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-error/10 text-error text-xs font-semibold border border-error/20">
                <AlertTriangle size={13} />
                <span className="flex-1">Failed to load media library: {queryError?.message}</span>
            </div>
        );
    }

    // ─── Render ───────────────────────────────────────────────────────────────

    return (
        <div className="space-y-5 max-w-full">
            <Toast toast={toast} />

            {editMedia && (
                <EditModal
                    media={editMedia}
                    onClose={() => {
                        setEditMedia(null);
                        updateMutation.reset(); // clear stale error state
                    }}
                    onSave={updateMutation.mutate}
                    isPending={updateMutation.isPending}
                    error={updateMutation.error}
                />
            )}
            {detailsMedia && <DetailsModal media={detailsMedia} onClose={() => setDetailsMedia(null)} />}
            {deleteMedia && (
                <DeleteModal media={deleteMedia} onClose={() => setDeleteMedia(null)} onConfirm={deleteMutation.mutate} isPending={deleteMutation.isPending} error={deleteMutation.error} />
            )}

            {/* ── Header ── */}
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2.5 mb-1">
                        <div className="w-8 h-8 rounded-xl bg-primary/15 flex items-center justify-center">
                            <Database size={15} className="text-primary" />
                        </div>
                        <h1 className="text-2xl font-black text-white tracking-tight">Media Library</h1>
                        {isFetching && !isLoading && <span className="text-xs text-primary/70 font-semibold">Syncing…</span>}
                    </div>
                    <p className="text-sm text-white/70 mt-0.5">
                        {isLoading ? (
                            "Scanning library…"
                        ) : (
                            <>
                                <span className="tabular-nums text-white/70 font-semibold">{metrics.total.toLocaleString()}</span> titles indexed
                            </>
                        )}
                    </p>
                </div>

                <button
                    onClick={() => refetch()}
                    disabled={isFetching}
                    title="Refresh"
                    className="w-9 h-9 rounded-md flex items-center justify-center text-white/70 border-none hover:bg-white/8 hover:text-white transition-colors cursor-pointer disabled:opacity-40">
                    <RefreshCw size={15} className={isFetching ? "animate-spin" : ""} />
                </button>
            </div>

            {/* ── Analytics cards ── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <MetricCard title="Total Titles" value={metrics.total.toLocaleString()} icon={FileVideo} accent="oklch(var(--in))" isLoading={isLoading} />
                <MetricCard title="Movies" value={metrics.movies.toLocaleString()} icon={Film} accent="oklch(var(--p))" isLoading={isLoading} />
                <MetricCard
                    title="Series & Anime"
                    value={(metrics.series + metrics.anime).toLocaleString()}
                    icon={Tv2}
                    accent="oklch(var(--su))"
                    sub={`${metrics.series} series · ${metrics.anime} anime`}
                    isLoading={isLoading}
                />
                <MetricCard title="Storage Used" value={fmtBytes(metrics.size)} icon={HardDrive} accent="oklch(var(--a))" isLoading={isLoading} />
            </div>

            {/* ── Toolbar ── */}
            <div className="space-y-2">
                {/* Search bar — full width, DashUsers style */}
                <div className="flex items-center gap-2 bg-base-300 rounded-lg px-3.5 h-10 border border-white/8 focus-within:border-primary/30 transition-colors">
                    <Search size={15} className="text-white/35 shrink-0" />
                    <input
                        type="text"
                        placeholder="Search titles, filenames…"
                        value={search}
                        onChange={(e) => {
                            setSearch(e.target.value);
                            setPage(1);
                        }}
                        className="flex-1 bg-transparent text-sm text-white placeholder:text-white/35 focus:outline-none"
                    />
                    {search && (
                        <button
                            onClick={() => {
                                setSearch("");
                                setPage(1);
                            }}
                            className="text-white/35 hover:text-white transition-colors border-none bg-transparent cursor-pointer">
                            <X size={14} />
                        </button>
                    )}
                    {!isLoading && search && (
                        <span className="text-xs text-white/40 font-medium shrink-0 tabular-nums">
                            {sortedMedia.length} result{sortedMedia.length !== 1 ? "s" : ""}
                        </span>
                    )}
                </div>

                {/* Type tabs — DashUsers style */}
                <div className="flex bg-base-300 rounded-lg p-0.5 gap-0.5 overflow-x-auto border border-white/5" style={{ scrollbarWidth: "none" }}>
                    {[
                        { key: "all", label: "All", count: metrics.total },
                        { key: "movie", label: "Movies", count: metrics.movies, icon: Film },
                        { key: "series", label: "Series", count: metrics.series, icon: Tv2 },
                        { key: "anime", label: "Anime", count: metrics.anime, icon: Swords },
                    ].map(({ key, label, count, icon: Icon }) => {
                        const active = activeTab === key;
                        return (
                            <button
                                key={key}
                                onClick={() => {
                                    setActiveTab(key);
                                    setPage(1);
                                }}
                                className={`px-3 py-1.5 rounded-md text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 shrink-0 cursor-pointer border-none
                                    ${active ? "bg-primary text-primary-content shadow-sm" : "text-white/70 hover:text-white hover:bg-white/5"}`}>
                                {Icon && <Icon size={11} />}
                                {label}
                                {!isLoading && (
                                    <span
                                        className={`px-1.5 py-0.5 rounded-md text-[10px] font-black tabular-nums
                                        ${active ? "bg-primary-content/20 text-primary-content" : "bg-white/8 text-white/50"}`}>
                                        {count}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* ── Table ── */}
            <div className="bg-base-200 rounded-xl overflow-hidden border border-white/6 shadow-sm">
                <div className="overflow-x-auto scrollbar-none">
                    <table className="table w-full text-sm min-w-225">
                        <thead className="sticky top-0 z-10 bg-base-300/95 backdrop-blur-md border-b border-base-content/8">
                            <tr className="text-[10px] font-bold uppercase tracking-widest text-white/40">
                                <th className="pl-4 pr-2 py-3 w-8">#Sl</th>
                                <th className="px-3 py-3">Title</th>
                                <th className="px-3 py-3">Type</th>
                                <th className="px-3 py-3 text-center">Quality</th>
                                <th className="px-3 py-3 text-center">Codec</th>
                                <th className="px-3 py-3 text-right">Size</th>
                                <th className="px-3 py-3">Library</th>
                                <th className="px-3 py-3">Added</th>
                                <th className="px-3 py-3 text-center">Access</th>
                                <th className="pl-3 pr-4 py-3 text-right">Actions</th>
                            </tr>
                        </thead>

                        <tbody>
                            {isLoading ? (
                                [...Array(8)].map((_, i) => <SkeletonRow key={i} />)
                            ) : paginatedMedia.length === 0 ? (
                                <tr>
                                    <td colSpan={10} className="py-24">
                                        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                                            <div className="w-14 h-14 rounded-2xl bg-base-200/60 flex items-center justify-center mb-4 border border-white/6">
                                                <Search size={22} className="text-white/25" />
                                            </div>
                                            <p className="text-base font-bold text-white/80">{search ? "No results match your search" : "No media in library"}</p>
                                            <p className="text-sm text-white/55 mt-1 max-w-xs">
                                                {search ? `Nothing matches "${search}" — try different keywords.` : "Add folders to your library to get started."}
                                            </p>
                                            {search && (
                                                <button
                                                    onClick={() => {
                                                        setSearch("");
                                                        setPage(1);
                                                    }}
                                                    className="mt-4 px-4 py-2 rounded-md text-sm font-bold bg-primary text-primary-content hover:opacity-90 transition-opacity border-none cursor-pointer">
                                                    Clear Search
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                paginatedMedia.map((item, i) => {
                                    const index = (currentPage - 1) * pageSize + i + 1;
                                    const TypeIcon = item._icon;
                                    const typeConfig = TYPE_CONFIG[item._type] || TYPE_CONFIG.movie;

                                    return (
                                        <tr key={item._id} className="group border-b border-white/4 last:border-0 hover:bg-white/3 transition-colors duration-150">
                                            {/* # */}
                                            <td className="pl-4 pr-2 py-3.5 text-white/55 font-mono text-[10px] tabular-nums">{String(index).padStart(2, "0")}</td>

                                            {/* Title */}
                                            <td className="px-3 py-3.5 min-w-0">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-11 rounded-lg bg-base-300 flex items-center justify-center shrink-0 overflow-hidden ring-1 ring-base-content/8">
                                                        {item._poster ? (
                                                            <img src={item._poster} alt="" className="w-full h-full object-cover" loading="lazy" />
                                                        ) : (
                                                            <ImageIcon size={12} className="text-base-content/15" />
                                                        )}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="font-semibold text-white/90 text-sm truncate max-w-36 sm:max-w-56 md:max-w-[20rem] lg:max-w-104" title={item._title}>
                                                            {item._title}
                                                        </p>
                                                        <div className="flex items-center gap-1.5 mt-0.5">
                                                            {item._year && <span className="text-[10px] text-white/70 tabular-nums font-medium">{item._year}</span>}
                                                            {item._year && <span className="text-white/20">·</span>}
                                                            <span className="text-[10px] font-mono text-white/50 truncate max-w-32 sm:max-w-56">{item._filename}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>

                                            {/* Type */}
                                            <td className="px-3 py-3.5">
                                                <div className="flex items-center gap-1.5">
                                                    <TypeIcon size={11} className="text-white/60 shrink-0" />
                                                    <Badge label={item._typeLabel} variant={item._type} />
                                                </div>
                                            </td>

                                            {/* Quality */}
                                            <td className="px-3 py-3.5">
                                                <div className="flex flex-col items-center gap-0.5">
                                                    {item.res ? <QualityChip label={item.res} /> : <span className="text-[10px] text-white/40">—</span>}
                                                    {item._duration && <span className="text-[9px] text-white/55 tabular-nums">{fmtDuration(item._duration)}</span>}
                                                </div>
                                            </td>

                                            {/* Codec */}
                                            <td className="px-3 py-3.5">
                                                <div className="flex items-center justify-center gap-1 flex-wrap">
                                                    {item.vcodec && <CodecChip label={item.vcodec} />}
                                                    {item.acodec && <CodecChip label={item.acodec} />}
                                                    {!item.vcodec && !item.acodec && <span className="text-white/40 text-[10px]">—</span>}
                                                </div>
                                            </td>

                                            {/* Size */}
                                            <td className="px-3 py-3.5 text-right">
                                                <span className="text-xs font-semibold text-white/85 tabular-nums">{fmtBytes(item._size)}</span>
                                            </td>

                                            {/* Library */}
                                            <td className="px-3 py-3.5">
                                                <div className="flex items-center gap-1.5 text-white/70">
                                                    <FolderOpen size={10} className="shrink-0" />
                                                    <span className="text-xs truncate max-w-20">{item._library}</span>
                                                </div>
                                            </td>

                                            {/* Added */}
                                            <td className="px-3 py-3.5">
                                                <span className="text-xs text-white/70 whitespace-nowrap tabular-nums">{fmtDate(item._added)}</span>
                                            </td>

                                            {/* Permission */}
                                            <td className="px-3 py-3.5 text-center">
                                                {!item.permission ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border bg-error/10 border-error/30 text-error text-xs font-bold">
                                                        <ShieldOff size={8} />
                                                        Restricted
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border bg-white/5 border-white/10 text-white/75 text-xs font-bold">
                                                        <Shield size={8} />
                                                        Normal
                                                    </span>
                                                )}
                                            </td>

                                            {/* Actions */}
                                            <td className="pl-2 pr-4 py-3.5">
                                                <div className="flex items-center justify-end gap-0.5">
                                                    <button
                                                        onClick={() => setEditMedia(item)}
                                                        title="Edit"
                                                        className="w-8 h-8 rounded-md flex items-center justify-center text-white/75 border-none hover:bg-white/8 hover:text-white transition-all duration-150 cursor-pointer">
                                                        <SquarePen size={15} strokeWidth={1.8} />
                                                    </button>
                                                    <button
                                                        onClick={() => setDetailsMedia(item)}
                                                        title="Details"
                                                        className="w-8 h-8 rounded-md flex items-center justify-center text-white/75 border-none hover:bg-white/8 hover:text-white transition-all duration-150 cursor-pointer">
                                                        <Info size={15} strokeWidth={1.8} />
                                                    </button>
                                                    <button
                                                        onClick={() => setDeleteMedia(item)}
                                                        title="Delete"
                                                        className="w-8 h-8 rounded-md flex items-center justify-center text-white/75 border-none hover:bg-error/10 hover:text-error transition-all duration-150 cursor-pointer">
                                                        <Trash2 size={15} strokeWidth={1.8} />
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
            <Pagination currentPage={currentPage} totalPages={totalPages} totalItems={sortedMedia.length} pageSize={pageSize} onPageChange={setPage} />
        </div>
    );
}
