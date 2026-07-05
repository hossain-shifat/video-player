// web/src/dashboard/pages/DashIPTV.jsx
// Root causes fixed in this version:
//  1. Upload "file required" → Content-Type: undefined in addLiveUploadSource
//  2. Frontend pagination on 27k rows → backend pagination via query params
//  3. Null/undefined field display → safeChannel/safeSource from fallbacks.js
//  4. Single search state across tabs → separate channelQ + sourceQ
//  5. Missing .xml/.txt upload support → added to ACCEPTED_EXTENSIONS + backend

import { useState, useMemo, useRef, useEffect, useCallback, Component } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import {
    Tv,
    Satellite,
    Globe2,
    ListVideo,
    RefreshCw,
    AlertTriangle,
    Search,
    Plus,
    Upload,
    Link as LinkIcon,
    X,
    Trash2,
    Check,
    Loader2,
    ChevronLeft,
    ChevronRight,
    Info,
    Pencil,
    FileText,
    CheckCircle2,
    XCircle,
    Clock,
    Play,
    Copy,
    RotateCw,
    AlertCircle,
    Star,
} from "lucide-react";
import {
    getLiveSources,
    addLiveUrlSource,
    addLiveUploadSource,
    refreshLiveSource,
    removeLiveSource,
    updateLiveSource,
    getLiveChannelsFlat,
    getLiveCategories,
    checkLiveStreamStatus,
    getActiveLiveChannels,
    markLiveChannelActive,
    unmarkLiveChannelActive,
    updateLiveChannel,
    deleteLiveChannel,
} from "../../api/live";
import { safeChannel, safeSource } from "../../utils/fallbacks";

const ACCEPTED_EXTENSIONS = ".m3u,.m3u8,.yml,.yaml,.json,.xml,.txt";
const PAGE_SIZE = 50;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function detectFormat(name = "") {
    const lower = name.toLowerCase();
    if (lower.endsWith(".m3u8") || lower.endsWith(".m3u") || lower.endsWith(".txt")) return "M3U";
    if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "YAML";
    if (lower.endsWith(".json")) return "JSON";
    if (lower.endsWith(".xml")) return "XML";
    return "Unknown";
}

function fmtDate(iso) {
    if (!iso) return "—";
    try {
        return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    } catch {
        return "—";
    }
}

// ─── Shared UI ──────────────────────────────────────────────────────────────

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

function StatusBadge({ status }) {
    const map = {
        pending: { cls: "bg-warning/15 text-warning border-warning/20", Icon: Clock, label: "Pending" },
        ready: { cls: "bg-success/15 text-success border-success/20", Icon: CheckCircle2, label: "Ready" },
        error: { cls: "bg-error/15 text-error border-error/20", Icon: XCircle, label: "Error" },
    };
    const cfg = map[status] || map.pending;
    const { Icon } = cfg;
    return (
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[9px] font-bold uppercase tracking-wider ${cfg.cls}`}>
            <Icon size={9} />
            {cfg.label}
        </span>
    );
}

function WorkingStatusBadge({ status }) {
    const map = {
        checking: { cls: "bg-info/15 text-info border-info/20", Icon: RotateCw, label: "Checking", spin: true },
        working: { cls: "bg-success/15 text-success border-success/20", Icon: CheckCircle2, label: "Working" },
        offline: { cls: "bg-error/15 text-error border-error/20", Icon: XCircle, label: "Offline" },
        timeout: { cls: "bg-warning/15 text-warning border-warning/20", Icon: AlertCircle, label: "Timeout" },
    };
    const cfg = map[status] || { cls: "bg-base-content/8 text-base-content/40 border-base-content/10", Icon: Clock, label: "Pending" };
    const { Icon } = cfg;
    return (
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[9px] font-bold uppercase tracking-wider ${cfg.cls}`}>
            <Icon size={9} className={cfg.spin ? "animate-spin" : ""} />
            {cfg.label}
        </span>
    );
}

function TypeBadge({ type }) {
    return (
        <span className="inline-flex items-center gap-1.5 text-xs text-white/70">
            {type === "url" ? <LinkIcon size={11} className="text-accent" /> : <FileText size={11} className="text-primary" />}
            {type === "url" ? "URL" : "File"}
        </span>
    );
}

function Toast({ toast }) {
    if (!toast) return null;
    return createPortal(
        <div
            className={`fixed bottom-5 right-5 z-[9999] px-4 py-2.5 rounded-lg shadow-2xl text-sm font-semibold flex items-center gap-2 ${toast.type === "error" ? "bg-error text-error-content" : "bg-success text-success-content"}`}>
            {toast.type === "error" ? <AlertTriangle size={14} /> : <Check size={14} />}
            {toast.msg}
        </div>,
        document.body,
    );
}

function CopyIconBtn({ text, title }) {
    const [copied, setCopied] = useState(false);
    return (
        <button
            onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(text || "").catch(() => {});
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
            }}
            title={title}
            className="w-7 h-7 rounded-md flex items-center justify-center text-white/70 border-none hover:bg-white/8 hover:text-white transition-colors cursor-pointer">
            {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
        </button>
    );
}

// ─── Backend-pagination component ─────────────────────────────────────────────

function Pagination({ pagination, onPageChange }) {
    if (!pagination || pagination.totalItems === 0) return null;
    const { page, limit, totalItems, totalPages, hasNext, hasPrevious } = pagination;
    const start = (page - 1) * limit + 1;
    const end = Math.min(page * limit, totalItems);

    const pages = useMemo(() => {
        const delta = 1;
        const range = [];
        for (let i = Math.max(2, page - delta); i <= Math.min(totalPages - 1, page + delta); i++) range.push(i);
        const result = [1];
        if (range[0] > 2) result.push("...");
        result.push(...range);
        if (range[range.length - 1] < totalPages - 1) result.push("...");
        if (totalPages > 1) result.push(totalPages);
        return result;
    }, [page, totalPages]);

    return (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <p className="text-xs text-white/40 tabular-nums">
                Showing{" "}
                <span className="text-white/70 font-semibold">
                    {start.toLocaleString()}–{end.toLocaleString()}
                </span>{" "}
                of <span className="text-white/70 font-semibold">{totalItems.toLocaleString()}</span>
            </p>
            <div className="flex items-center gap-1">
                <button
                    onClick={() => onPageChange(page - 1)}
                    disabled={!hasPrevious}
                    className="w-8 h-8 rounded-md flex items-center justify-center text-white/70 border-none hover:bg-white/8 hover:text-white transition-colors disabled:opacity-25 disabled:cursor-not-allowed cursor-pointer">
                    <ChevronLeft size={14} />
                </button>
                {pages.map((p, i) =>
                    p === "..." ? (
                        <span key={`e${i}`} className="w-8 h-8 flex items-center justify-center text-white/30 text-xs">
                            …
                        </span>
                    ) : (
                        <button
                            key={p}
                            onClick={() => onPageChange(p)}
                            className={`w-8 h-8 rounded-md text-xs font-bold transition-colors border-none cursor-pointer ${p === page ? "bg-primary text-primary-content shadow-sm" : "text-white/60 hover:bg-white/8 hover:text-white"}`}>
                            {p}
                        </button>
                    ),
                )}
                <button
                    onClick={() => onPageChange(page + 1)}
                    disabled={!hasNext}
                    className="w-8 h-8 rounded-md flex items-center justify-center text-white/70 border-none hover:bg-white/8 hover:text-white transition-colors disabled:opacity-25 disabled:cursor-not-allowed cursor-pointer">
                    <ChevronRight size={14} />
                </button>
            </div>
        </div>
    );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function Modal({ onClose, title, icon: Icon, children }) {
    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm" onClick={onClose}>
            <div
                className="relative w-[min(28rem,90vw)] max-h-[85vh] bg-base-300 rounded-2xl shadow-2xl border border-base-content/10 overflow-hidden flex flex-col"
                style={{ boxShadow: "0 25px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)" }}
                onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-base-content/8 shrink-0">
                    <div className="flex items-center gap-2.5">
                        {Icon && (
                            <span className="w-8 h-8 rounded-md bg-primary/15 flex items-center justify-center shrink-0">
                                <Icon size={16} className="text-primary" />
                            </span>
                        )}
                        <h3 className="text-sm font-bold text-white">{title}</h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-7 h-7 rounded-md flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer border-none">
                        <X size={14} />
                    </button>
                </div>
                <div className="p-5 space-y-4 overflow-y-auto flex-1">{children}</div>
            </div>
        </div>,
        document.body,
    );
}

// ─── Row actions (Sources tab) ────────────────────────────────────────────────

function RowActions({ onInfo, onEdit, onRefresh, onDelete, refreshing }) {
    return (
        <div className="flex items-center justify-end gap-0.5">
            <button
                onClick={onInfo}
                title="Info"
                className="w-7 h-7 rounded-md flex items-center justify-center text-white/70 border-none hover:bg-white/8 hover:text-white transition-colors cursor-pointer">
                <Info size={13} />
            </button>
            <button
                onClick={onEdit}
                title="Edit"
                className="w-7 h-7 rounded-md flex items-center justify-center text-white/70 border-none hover:bg-white/8 hover:text-white transition-colors cursor-pointer">
                <Pencil size={13} />
            </button>
            <button
                onClick={onRefresh}
                disabled={refreshing}
                title="Refresh"
                className="w-7 h-7 rounded-md flex items-center justify-center text-white/70 border-none hover:bg-white/8 hover:text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
            </button>
            <button
                onClick={onDelete}
                title="Delete"
                className="w-7 h-7 rounded-md flex items-center justify-center text-error/80 border-none hover:bg-error/10 hover:text-error transition-colors cursor-pointer">
                <Trash2 size={13} />
            </button>
        </div>
    );
}

// ─── Channel table (shared by the Active tab and the Channels tab) ────────────
function ChannelsTable({ list, loading, pageOffset, emptyTitle, emptySub, getStatus, recheckOne, activeIds, onToggleActive, onInfo, onEdit, onHide }) {
    return (
        <table className="table w-full text-sm">
            <thead className="sticky top-0 z-10 bg-base-300/95 backdrop-blur-md border-b border-base-content/8">
                <tr className="text-[10px] font-bold uppercase tracking-widest text-white/40">
                    <th className="pl-4 pr-2 py-3 w-8">#</th>
                    <th className="px-3 py-3">Channel</th>
                    <th className="px-3 py-3">Country</th>
                    <th className="px-3 py-3">Group</th>
                    <th className="px-3 py-3">Category</th>
                    <th className="px-3 py-3">Working Status</th>
                    <th className="pl-3 pr-4 py-3 text-right">Actions</th>
                </tr>
            </thead>
            <tbody>
                {loading ? (
                    [...Array(8)].map((_, i) => (
                        <tr key={i} className="border-b border-white/4 last:border-0">
                            {[...Array(7)].map((__, j) => (
                                <td key={j} className="px-3 py-3.5">
                                    <div className="h-3 w-24 rounded bg-white/5 animate-pulse" />
                                </td>
                            ))}
                        </tr>
                    ))
                ) : list.length === 0 ? (
                    <tr>
                        <td colSpan={7} className="py-20 text-center">
                            <div className="flex flex-col items-center gap-2">
                                <Tv size={26} className="text-white/20" />
                                <p className="text-sm text-white/50 font-semibold">{emptyTitle}</p>
                                {emptySub && <p className="text-xs text-white/30">{emptySub}</p>}
                            </div>
                        </td>
                    </tr>
                ) : (
                    list.map((ch, i) => {
                        const isFav = activeIds.has(ch.id);
                        return (
                            <tr key={`${ch.url}-${i}`} className="group border-b border-white/4 last:border-0 hover:bg-white/[0.03] transition-colors duration-150">
                                <td className="pl-4 pr-2 py-3 text-white/55 font-mono text-[10px] tabular-nums">{pageOffset + i + 1}</td>
                                <td className="px-3 py-3 min-w-0">
                                    <div className="flex items-center gap-2.5">
                                        <div className="w-8 h-8 rounded-lg bg-base-300 flex items-center justify-center shrink-0 overflow-hidden ring-1 ring-base-content/8">
                                            <img
                                                src={ch.logo}
                                                alt=""
                                                className="w-full h-full object-contain"
                                                loading="lazy"
                                                onError={(e) => {
                                                    // Replace broken logo with initials avatar — never show broken img icon
                                                    const initials =
                                                        (ch.name || "?")
                                                            .trim()
                                                            .split(/\s+/)
                                                            .slice(0, 2)
                                                            .map((w) => w[0])
                                                            .join("")
                                                            .toUpperCase() || "?";
                                                    e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(initials)}&background=1e1e2e&color=a6e3a1&bold=true&size=64`;
                                                    e.target.onerror = null;
                                                }}
                                            />
                                        </div>
                                        <span className="font-semibold text-white/90 text-sm truncate max-w-[12rem] sm:max-w-[18rem]" title={ch.name}>
                                            {ch.name}
                                        </span>
                                    </div>
                                </td>
                                <td className="px-3 py-3">
                                    <span className="text-xs text-white/70">{ch.country}</span>
                                </td>
                                <td className="px-3 py-3">
                                    <span className="badge badge-sm badge-ghost text-[10px]">{ch.group}</span>
                                </td>
                                <td className="px-3 py-3">
                                    <span className="badge badge-sm badge-ghost text-[10px]">{ch.category}</span>
                                </td>
                                <td className="px-3 py-3">
                                    <WorkingStatusBadge status={getStatus(ch.url)} />
                                </td>
                                <td className="pl-3 pr-4 py-3 text-right">
                                    <div className="flex items-center justify-end gap-0.5 flex-wrap">
                                        <button
                                            onClick={() => onToggleActive(ch)}
                                            title={isFav ? "Remove from Active" : "Mark Active"}
                                            className={`w-7 h-7 rounded-md flex items-center justify-center border-none transition-colors cursor-pointer ${
                                                isFav ? "text-warning hover:bg-warning/10" : "text-white/70 hover:bg-white/8 hover:text-white"
                                            }`}>
                                            <Star size={12} fill={isFav ? "currentColor" : "none"} />
                                        </button>
                                        <a
                                            href={ch.url}
                                            target="_blank"
                                            rel="noreferrer"
                                            title="Play"
                                            className="w-7 h-7 rounded-md flex items-center justify-center text-white/70 hover:bg-white/8 hover:text-white transition-colors">
                                            <Play size={12} />
                                        </a>
                                        <button
                                            onClick={() => recheckOne(ch.url)}
                                            title="Recheck status"
                                            className="w-7 h-7 rounded-md flex items-center justify-center text-white/70 border-none hover:bg-white/8 hover:text-white transition-colors cursor-pointer">
                                            <RotateCw size={12} className={getStatus(ch.url) === "checking" ? "animate-spin" : ""} />
                                        </button>
                                        <button
                                            onClick={() => onInfo(ch)}
                                            title="Info"
                                            className="w-7 h-7 rounded-md flex items-center justify-center text-white/70 border-none hover:bg-white/8 hover:text-white transition-colors cursor-pointer">
                                            <Info size={12} />
                                        </button>
                                        <button
                                            onClick={() => onEdit(ch)}
                                            title="Edit"
                                            className="w-7 h-7 rounded-md flex items-center justify-center text-white/70 border-none hover:bg-white/8 hover:text-white transition-colors cursor-pointer">
                                            <Pencil size={12} />
                                        </button>
                                        <button
                                            onClick={() => onHide(ch)}
                                            title="Delete"
                                            className="w-7 h-7 rounded-md flex items-center justify-center text-error/80 border-none hover:bg-error/10 hover:text-error transition-colors cursor-pointer">
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        );
                    })
                )}
            </tbody>
        </table>
    );
}

// ─── Stream status queue ───────────────────────────────────────────────────────
const STATUS_CONCURRENCY = 5;

function useStreamStatusQueue() {
    const [statuses, setStatuses] = useState({});
    const cacheRef = useRef(new Map());
    const abortersRef = useRef(new Map());

    useEffect(
        () => () => {
            abortersRef.current.forEach((c) => c.abort());
            abortersRef.current.clear();
        },
        [],
    );

    const checkOne = useCallback(async (url) => {
        if (abortersRef.current.has(url)) return;
        const controller = new AbortController();
        abortersRef.current.set(url, controller);
        setStatuses((p) => ({ ...p, [url]: "checking" }));
        try {
            const { status } = await checkLiveStreamStatus(url, controller.signal);
            cacheRef.current.set(url, status);
            setStatuses((p) => ({ ...p, [url]: status }));
        } catch {
            /* aborted */
        } finally {
            abortersRef.current.delete(url);
        }
    }, []);

    const queueCheck = useCallback(
        async (urls) => {
            const todo = urls.filter((u) => u && !cacheRef.current.has(u) && !abortersRef.current.has(u));
            let idx = 0;
            async function worker() {
                while (idx < todo.length) await checkOne(todo[idx++]);
            }
            await Promise.all(Array.from({ length: Math.min(STATUS_CONCURRENCY, todo.length) }, worker));
        },
        [checkOne],
    );

    const getStatus = useCallback((url) => statuses[url] ?? (cacheRef.current.has(url) ? cacheRef.current.get(url) : "idle"), [statuses]);

    const recheckOne = useCallback(
        (url) => {
            cacheRef.current.delete(url);
            abortersRef.current.get(url)?.abort();
            abortersRef.current.delete(url);
            checkOne(url);
        },
        [checkOne],
    );

    return { queueCheck, getStatus, recheckOne };
}

// ─── Main component ────────────────────────────────────────────────────────────

function DashIPTVInner() {
    const queryClient = useQueryClient();

    const [toast, setToast] = useState(null);
    const showToast = (msg, type = "success") => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 3000);
    };

    const [activeTab, setActiveTab] = useState("channel");
    // Separate search per tab — switching tab doesn't contaminate the other query
    const [channelQ, setChannelQ] = useState("");
    const [sourceQ, setSourceQ] = useState("");
    const [channelPage, setChannelPage] = useState(1);
    const [channelSort, setChannelSort] = useState("name");
    const [categoryFilter, setCategoryFilter] = useState("all");

    const [refreshingId, setRefreshingId] = useState(null);
    const [uploadOpen, setUploadOpen] = useState(false);
    const [urlOpen, setUrlOpen] = useState(false);
    const [uploadName, setUploadName] = useState("");
    const [uploadFile, setUploadFile] = useState(null);
    const fileInputRef = useRef(null);
    const [urlName, setUrlName] = useState("");
    const [urlValue, setUrlValue] = useState("");

    // Info / Edit modals (Sources tab row actions)
    const [infoSource, setInfoSource] = useState(null);
    const [editSource, setEditSource] = useState(null);
    const [editName, setEditName] = useState("");
    const [editLocation, setEditLocation] = useState("");
    const [confirmDeleteSource, setConfirmDeleteSource] = useState(null);

    // ── Channel-level state — now backed by real endpoints (channelStateStore.js) ──
    const [activeQ, setActiveQ] = useState("");

    const [infoChannel, setInfoChannel] = useState(null);
    const [editChannel, setEditChannel] = useState(null);
    const [editChName, setEditChName] = useState("");
    const [editChCategory, setEditChCategory] = useState("");
    const [editChCountry, setEditChCountry] = useState("");
    const [confirmHideChannel, setConfirmHideChannel] = useState(null);

    const {
        data: activeChannelsData,
        isLoading: activeChannelsLoading,
        error: activeChannelsErrObj,
    } = useQuery({
        queryKey: ["admin", "iptv", "channels", "active"],
        queryFn: getActiveLiveChannels,
        staleTime: 15 * 1000,
    });
    const rawActiveChannels = activeChannelsData?.data?.channels ?? activeChannelsData?.channels ?? [];
    const activeIds = useMemo(() => new Set(rawActiveChannels.map((c) => c.id)), [rawActiveChannels]);
    const activeChannels = useMemo(() => {
        if (!activeQ) return rawActiveChannels;
        const q = activeQ.toLowerCase();
        return rawActiveChannels.filter((c) => (c.name || "").toLowerCase().includes(q) || (c.country || "").toLowerCase().includes(q) || (c.category || "").toLowerCase().includes(q));
    }, [rawActiveChannels, activeQ]);

    const invalidateChannelState = () => {
        queryClient.invalidateQueries({ queryKey: ["admin", "iptv", "channels"] }); // covers both the paginated list and ["…","active"]
    };

    const markActiveMutation = useMutation({
        mutationFn: (ch) => markLiveChannelActive(ch.id, ch),
        onSuccess: (_, ch) => {
            invalidateChannelState();
            showToast(`"${ch.name}" marked active`);
        },
        onError: (err) => showToast(err?.response?.data?.message || err.message || "Failed to mark active", "error"),
    });
    const unmarkActiveMutation = useMutation({
        mutationFn: (id) => unmarkLiveChannelActive(id),
        onSuccess: () => {
            invalidateChannelState();
            showToast("Removed from Active");
        },
        onError: (err) => showToast(err?.response?.data?.message || err.message || "Failed to remove from Active", "error"),
    });
    function toggleActiveChannel(ch) {
        if (activeIds.has(ch.id)) unmarkActiveMutation.mutate(ch.id);
        else markActiveMutation.mutate(ch);
    }

    function openEditChannelModal(ch) {
        setEditChannel(ch);
        setEditChName(ch.name || "");
        setEditChCategory(ch.category || "");
        setEditChCountry(ch.country || "");
    }
    function closeEditChannelModal() {
        setEditChannel(null);
        setEditChName("");
        setEditChCategory("");
        setEditChCountry("");
        editChannelMutation.reset();
    }
    const editChannelMutation = useMutation({
        mutationFn: ({ id, data }) => updateLiveChannel(id, data),
        onSuccess: () => {
            invalidateChannelState();
            showToast("Channel updated");
            closeEditChannelModal();
        },
        onError: (err) => showToast(err?.response?.data?.message || err.message || "Failed to update channel", "error"),
    });
    function saveChannelEdit() {
        editChannelMutation.mutate({
            id: editChannel.id,
            data: { name: editChName.trim(), category: editChCategory.trim(), country: editChCountry.trim() },
        });
    }

    const hideChannelMutation = useMutation({
        mutationFn: (id) => deleteLiveChannel(id),
        onSuccess: () => {
            invalidateChannelState();
            showToast("Channel deleted");
            setConfirmHideChannel(null);
        },
        onError: (err) => showToast(err?.response?.data?.message || err.message || "Failed to delete channel", "error"),
    });
    function hideChannel(ch) {
        hideChannelMutation.mutate(ch.id);
    }

    const { queueCheck, getStatus, recheckOne } = useStreamStatusQueue();

    // ── Queries ──────────────────────────────────────────────────────────────

    const {
        data: sourcesData,
        isLoading: sourcesLoading,
        isFetching: sourcesFetching,
        isError: sourcesError,
        error: sourcesErrObj,
        refetch: refetchSources,
    } = useQuery({
        queryKey: ["admin", "iptv", "sources"],
        queryFn: getLiveSources,
        staleTime: 1000 * 30,
        // Poll while any source is still ingesting in the background
        refetchInterval: (query) => {
            const list = query.state.data?.sources ?? [];
            return list.some((s) => s.status === "pending") ? 3000 : false;
        },
    });

    const {
        data: channelsData,
        isLoading: channelsLoading,
        isFetching: channelsFetching,
        isError: channelsError,
        error: channelsErrObj,
        refetch: refetchChannels,
    } = useQuery({
        // Include every param the backend uses — react-query re-fetches on change
        queryKey: ["admin", "iptv", "channels", { page: channelPage, q: channelQ, sort: channelSort, category: categoryFilter }],
        queryFn: () => getLiveChannelsFlat({ page: channelPage, limit: PAGE_SIZE, q: channelQ, sort: channelSort, category: categoryFilter === "all" ? undefined : categoryFilter }),
        staleTime: 1000 * 30,
        placeholderData: keepPreviousData, // smooth page transitions, no flash
    });

    // Backend response shape: { success, data: { channels, pagination } }
    // Overrides + hidden filtering now happen server-side (channelStateStore.js
    // applied inside getChannelsFlat) — what comes back here is already correct.
    const sources = (sourcesData?.data?.sources ?? sourcesData?.sources ?? []).map((s) => (s ? { ...safeSource(s), id: s.id } : null)).filter(Boolean);
    // IMPORTANT: safeChannel() is a display-fallback sanitizer (fills in null
    // name/logo/etc for rendering) — it does NOT guarantee it passes `id`
    // through untouched. Re-attach the real id explicitly here, or every
    // Star/Edit/Delete click below silently targets `undefined` instead of
    // the actual channel (backend still "succeeds" against a bogus id, so it
    // looks like the button does nothing since nothing visibly changes).
    const channels = (channelsData?.data?.channels ?? []).map((c) => (c ? { ...safeChannel(c), id: c.id } : null)).filter(Boolean);
    const pagination = channelsData?.data?.pagination ?? null;

    // Sources: client-side filter fine, typically < 100 rows
    const filteredSources = useMemo(() => {
        if (!sourceQ) return sources;
        const q = sourceQ.toLowerCase();
        return sources.filter((s) => s.name.toLowerCase().includes(q) || s.location.toLowerCase().includes(q));
    }, [sources, sourceQ]);

    // Auto-check stream status for visible channel page (Channels tab) or the active list (Active tab)
    useEffect(() => {
        if (activeTab === "channel" && channels.length) queueCheck(channels.map((c) => c.url));
        if (activeTab === "active" && activeChannels.length) queueCheck(activeChannels.map((c) => c.url));
    }, [activeTab, channels, activeChannels, queueCheck]);

    // Category pills — real list from /api/live/categories
    const { data: categoriesData } = useQuery({
        queryKey: ["admin", "iptv", "categories"],
        queryFn: getLiveCategories,
        staleTime: 1000 * 60,
    });
    const categoryOptions = categoriesData?.data?.categories ?? categoriesData?.categories ?? [];

    // Reset page when search/sort changes
    useEffect(() => {
        setChannelPage(1);
    }, [channelQ, channelSort, categoryFilter]);

    // ── Mutations ────────────────────────────────────────────────────────────

    const invalidateAll = () => {
        queryClient.invalidateQueries({ queryKey: ["admin", "iptv", "sources"] });
        queryClient.invalidateQueries({ queryKey: ["admin", "iptv", "channels"] });
    };

    const addUrlMutation = useMutation({
        mutationFn: addLiveUrlSource,
        onSuccess: () => {
            invalidateAll();
            showToast("Source added — ingesting in background");
            closeUrlModal();
        },
        onError: (err) => showToast(err?.response?.data?.message || err.message || "Failed to add source", "error"),
    });

    const addUploadMutation = useMutation({
        mutationFn: ({ name, file }) => addLiveUploadSource(name, file),
        onSuccess: () => {
            invalidateAll();
            showToast("Playlist uploaded and processing");
            closeUploadModal();
        },
        onError: (err) => showToast(err?.response?.data?.message || err.message || "Upload failed", "error"),
    });

    const deleteMutation = useMutation({
        mutationFn: removeLiveSource,
        onMutate: async (id) => {
            await queryClient.cancelQueries({ queryKey: ["admin", "iptv", "sources"] });
            const previous = queryClient.getQueryData(["admin", "iptv", "sources"]);
            queryClient.setQueryData(["admin", "iptv", "sources"], (old) => ({ ...old, sources: (old?.sources ?? []).filter((s) => s.id !== id) }));
            return { previous };
        },
        onError: (err, _id, context) => {
            if (context?.previous) queryClient.setQueryData(["admin", "iptv", "sources"], context.previous);
            showToast(err.message || "Failed to delete", "error");
        },
        onSuccess: () => {
            invalidateAll();
            showToast("Source removed");
            setConfirmDeleteSource(null);
        },
    });

    const editMutation = useMutation({
        mutationFn: ({ id, data }) => updateLiveSource(id, data),
        onSuccess: () => {
            invalidateAll();
            showToast("Source updated");
            closeEditModal();
        },
        onError: (err) => showToast(err?.response?.data?.message || err.message || "Failed to update source", "error"),
    });

    async function handleRefreshSource(id) {
        setRefreshingId(id);
        try {
            await refreshLiveSource(id);
            invalidateAll();
            showToast("Source refreshed");
        } catch (err) {
            showToast(err.message || "Refresh failed", "error");
        } finally {
            setRefreshingId(null);
        }
    }

    // ── Modal helpers ────────────────────────────────────────────────────────

    function closeUploadModal() {
        setUploadOpen(false);
        setUploadName("");
        setUploadFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        addUploadMutation.reset();
    }
    function closeUrlModal() {
        setUrlOpen(false);
        setUrlName("");
        setUrlValue("");
        addUrlMutation.reset();
    }
    function openEditModal(src) {
        setEditSource(src);
        setEditName(src.name || "");
        setEditLocation(src.location || "");
        editMutation.reset();
    }
    function closeEditModal() {
        setEditSource(null);
        setEditName("");
        setEditLocation("");
        editMutation.reset();
    }

    // ── Metrics ──────────────────────────────────────────────────────────────

    const metrics = useMemo(
        () => ({
            totalSources: sources.length,
            readySources: sources.filter((s) => s.status === "ready").length,
            errorSources: sources.filter((s) => s.status === "error").length,
            totalChannels: pagination?.totalItems ?? 0,
            countries: new Set(channels.map((c) => c.country).filter((c) => c && c !== "Unknown")).size,
            activeChannels: rawActiveChannels.length,
        }),
        [sources, channels, pagination, rawActiveChannels],
    );

    const isLoading = activeTab === "channel" ? channelsLoading : activeTab === "sources" ? sourcesLoading : false;
    const isFetching = activeTab === "channel" ? channelsFetching : activeTab === "sources" ? sourcesFetching : false;
    const isError = activeTab === "channel" ? channelsError : activeTab === "sources" ? sourcesError : false;
    const errorObj = activeTab === "channel" ? channelsErrObj : activeTab === "sources" ? sourcesErrObj : null;
    const activeSearch = activeTab === "channel" ? channelQ : activeTab === "sources" ? sourceQ : activeQ;
    const setActiveSearch = activeTab === "channel" ? (v) => setChannelQ(v) : activeTab === "sources" ? (v) => setSourceQ(v) : (v) => setActiveQ(v);

    return (
        <div className="space-y-5 max-w-full">
            <Toast toast={toast} />

            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2.5 mb-1">
                        <div className="w-8 h-8 rounded-xl bg-primary/15 flex items-center justify-center">
                            <Satellite size={15} className="text-primary" />
                        </div>
                        <h1 className="text-2xl font-black text-white tracking-tight">IPTV Manager</h1>
                        {isFetching && !isLoading && <span className="text-xs text-primary/70 font-semibold">Syncing…</span>}
                    </div>
                    <p className="text-sm text-white/70 mt-0.5">Manage live TV playlist sources and browse the resulting channel list.</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => (activeTab === "channel" ? refetchChannels() : activeTab === "sources" ? refetchSources() : null)}
                        disabled={isFetching || activeTab === "active"}
                        title="Refresh"
                        className="w-9 h-9 rounded-md flex items-center justify-center text-white/70 border-none hover:bg-white/8 hover:text-white transition-colors cursor-pointer disabled:opacity-40">
                        <RefreshCw size={15} className={isFetching ? "animate-spin" : ""} />
                    </button>
                    <button
                        onClick={() => setUploadOpen(true)}
                        className="h-9 px-3.5 rounded-md flex items-center gap-1.5 text-sm font-semibold bg-base-300 text-white/80 hover:bg-white/10 hover:text-white transition-colors border-none cursor-pointer">
                        <Upload size={14} /> Upload Playlist
                    </button>
                    <button
                        onClick={() => setUrlOpen(true)}
                        className="h-9 px-3.5 rounded-md flex items-center gap-1.5 text-sm font-semibold bg-primary text-primary-content hover:opacity-90 transition-opacity border-none cursor-pointer">
                        <Plus size={14} /> Add URL
                    </button>
                </div>
            </div>

            {/* Metric cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <MetricCard title="Total Channels" value={metrics.totalChannels.toLocaleString()} icon={Tv} accent="oklch(var(--p))" isLoading={channelsLoading} />
                <MetricCard title="Countries" value={metrics.countries.toLocaleString()} icon={Globe2} accent="oklch(var(--in))" isLoading={channelsLoading} />
                <MetricCard
                    title="Sources"
                    value={metrics.totalSources.toLocaleString()}
                    icon={ListVideo}
                    accent="oklch(var(--su))"
                    sub={`${metrics.readySources} ready · ${metrics.errorSources} error`}
                    isLoading={sourcesLoading}
                />
                <MetricCard
                    title="Avg per Source"
                    value={metrics.totalSources ? Math.round(metrics.totalChannels / metrics.totalSources).toLocaleString() : "0"}
                    icon={Satellite}
                    accent="oklch(var(--a))"
                    isLoading={sourcesLoading || channelsLoading}
                />
            </div>

            {isError && (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-error/10 text-error text-xs font-semibold border border-error/20">
                    <AlertTriangle size={13} />
                    <span className="flex-1">Failed to load: {errorObj?.response?.data?.message || errorObj?.message}</span>
                </div>
            )}

            {/* Toolbar — tabs left, search right (stacks on mobile) */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                {/* Tabs */}
                <div className="flex bg-base-300 rounded-md p-0.5 gap-0.5 border border-white/5 overflow-x-auto w-full sm:w-auto" style={{ scrollbarWidth: "none" }}>
                    {[
                        { key: "active", label: "Active", count: metrics.activeChannels, icon: Star },
                        { key: "channel", label: "Channels", count: metrics.totalChannels, icon: Tv },
                        { key: "sources", label: "Sources", count: metrics.totalSources, icon: ListVideo },
                    ].map(({ key, label, count, icon: Icon }) => {
                        const active = activeTab === key;
                        return (
                            <button
                                key={key}
                                onClick={() => {
                                    setActiveTab(key);
                                }}
                                className={`px-3 py-1.5 rounded-md text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 shrink-0 cursor-pointer border-none ${active ? "bg-primary text-primary-content shadow-sm" : "text-white/70 hover:text-white hover:bg-white/5"}`}>
                                <Icon size={11} />
                                {label}
                                <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-black tabular-nums ${active ? "bg-primary-content/20 text-primary-content" : "bg-white/8 text-white/50"}`}>
                                    {count.toLocaleString()}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* Search */}
                <div className="flex items-center gap-2 bg-base-300 rounded-md px-3.5 h-10 border border-white/8 focus-within:border-primary/30 transition-colors w-full sm:w-72 shrink-0">
                    <Search size={15} className="text-white/35 shrink-0" />
                    <input
                        type="text"
                        placeholder={activeTab === "channel" ? "Search channels, country, group…" : activeTab === "active" ? "Search active channels…" : "Search source name, location…"}
                        value={activeSearch}
                        onChange={(e) => setActiveSearch(e.target.value)}
                        className="flex-1 w-full bg-transparent text-sm text-white placeholder:text-white/35 focus:outline-none"
                    />
                    {activeSearch && (
                        <button onClick={() => setActiveSearch("")} className="rounded-md text-white/35 hover:text-white transition-colors border-none bg-transparent cursor-pointer shrink-0">
                            <X size={14} />
                        </button>
                    )}
                </div>
            </div>

            {/* Category pills — channel tab only, same pill design as tabs */}
            {activeTab === "channel" && (
                <div className="flex bg-base-300 rounded-md p-0.5 gap-0.5 border border-white/5 overflow-x-auto w-full" style={{ scrollbarWidth: "none" }}>
                    <button
                        onClick={() => setCategoryFilter("all")}
                        className={`px-3 py-1.5 rounded-md text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 shrink-0 cursor-pointer border-none ${categoryFilter === "all" ? "bg-primary text-primary-content shadow-sm" : "text-white/70 hover:text-white hover:bg-white/5"}`}>
                        All
                    </button>
                    {categoryOptions.map((cat) => {
                        const name = typeof cat === "string" ? cat : cat.name;
                        const count = typeof cat === "string" ? null : cat.count;
                        const active = categoryFilter === name;
                        return (
                            <button
                                key={name}
                                onClick={() => setCategoryFilter(name)}
                                className={`px-3 py-1.5 rounded-md text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 shrink-0 cursor-pointer border-none ${active ? "bg-primary text-primary-content shadow-sm" : "text-white/70 hover:text-white hover:bg-white/5"}`}>
                                {name}
                                {count != null && (
                                    <span
                                        className={`px-1.5 py-0.5 rounded-md text-[10px] font-black tabular-nums ${active ? "bg-primary-content/20 text-primary-content" : "bg-white/8 text-white/50"}`}>
                                        {count.toLocaleString()}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            )}
            <div className="bg-base-200 rounded-xl overflow-hidden border border-white/6 shadow-sm">
                <div className="overflow-x-auto">
                    {activeTab === "active" ? (
                        <ChannelsTable
                            list={activeChannels}
                            loading={activeChannelsLoading}
                            pageOffset={0}
                            emptyTitle={activeQ ? "No active channels match your search" : "No channels marked active yet"}
                            emptySub={activeQ ? "" : "Tap the star on a channel in the Channels tab to pin it here."}
                            getStatus={getStatus}
                            recheckOne={recheckOne}
                            activeIds={activeIds}
                            onToggleActive={toggleActiveChannel}
                            onInfo={setInfoChannel}
                            onEdit={openEditChannelModal}
                            onHide={setConfirmHideChannel}
                        />
                    ) : activeTab === "channel" ? (
                        <ChannelsTable
                            list={channels}
                            loading={channelsLoading}
                            pageOffset={(channelPage - 1) * PAGE_SIZE}
                            emptyTitle={channelQ ? "No channels match your search" : "No channels yet"}
                            emptySub={channelQ ? "" : "Add a playlist source to populate channels."}
                            getStatus={getStatus}
                            recheckOne={recheckOne}
                            activeIds={activeIds}
                            onToggleActive={toggleActiveChannel}
                            onInfo={setInfoChannel}
                            onEdit={openEditChannelModal}
                            onHide={setConfirmHideChannel}
                        />
                    ) : (
                        <table className="table w-full text-sm">
                            <thead className="sticky top-0 z-10 bg-base-300/95 backdrop-blur-md border-b border-base-content/8">
                                <tr className="text-[10px] font-bold uppercase tracking-widest text-white/40">
                                    <th className="pl-4 pr-2 py-3">Name</th>
                                    <th className="px-3 py-3">Type</th>
                                    <th className="px-3 py-3">Format</th>
                                    <th className="px-3 py-3">Location</th>
                                    <th className="px-3 py-3 text-center">Channels</th>
                                    <th className="px-3 py-3 text-center">Status</th>
                                    <th className="px-3 py-3">Added</th>
                                    <th className="pl-3 pr-4 py-3 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sourcesLoading ? (
                                    [...Array(5)].map((_, i) => (
                                        <tr key={i} className="border-b border-white/4 last:border-0">
                                            {[...Array(8)].map((__, j) => (
                                                <td key={j} className="px-3 py-3.5">
                                                    <div className="h-3 w-16 rounded bg-white/5 animate-pulse" />
                                                </td>
                                            ))}
                                        </tr>
                                    ))
                                ) : filteredSources.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} className="py-20 text-center">
                                            <div className="flex flex-col items-center gap-2">
                                                <Satellite size={26} className="text-white/20" />
                                                <p className="text-sm text-white/50 font-semibold">{sourceQ ? "No sources match your search" : "No IPTV sources yet"}</p>
                                                {!sourceQ && (
                                                    <button
                                                        onClick={() => setUrlOpen(true)}
                                                        className="h-7 px-3 rounded-md flex items-center gap-1 text-xs font-bold bg-primary text-primary-content hover:opacity-90 transition-opacity border-none cursor-pointer mt-2">
                                                        <Plus size={12} /> Add Source
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    filteredSources.map((src) => (
                                        <tr key={src.id} className="group border-b border-white/4 last:border-0 hover:bg-white/[0.03] transition-colors duration-150">
                                            <td className="pl-4 pr-2 py-3.5">
                                                <div className="flex items-center gap-2.5">
                                                    <span className="w-7 h-7 rounded-lg bg-base-300 flex items-center justify-center shrink-0">
                                                        <Tv size={13} className="text-white/40" />
                                                    </span>
                                                    <span className="text-sm font-semibold text-white/90 truncate max-w-50">{src.name}</span>
                                                </div>
                                            </td>
                                            <td className="px-3 py-3.5">
                                                <TypeBadge type={src.type} />
                                            </td>
                                            <td className="px-3 py-3.5">
                                                <span className="badge badge-sm badge-ghost font-mono">{src.format}</span>
                                            </td>
                                            <td className="px-3 py-3.5">
                                                <span className="text-xs text-white/45 font-mono truncate max-w-60 inline-block align-middle">{src.location}</span>
                                            </td>
                                            <td className="px-3 py-3.5 text-center">
                                                <span className="text-xs text-white/70 tabular-nums">{src.channelCount.toLocaleString()}</span>
                                            </td>
                                            <td className="px-3 py-3.5">
                                                <div className="flex flex-col items-center gap-1">
                                                    <StatusBadge status={src.status} />
                                                    {src.status === "error" && src.error && <span className="text-[9px] text-error/70 truncate max-w-32">{src.error}</span>}
                                                </div>
                                            </td>
                                            <td className="px-3 py-3.5">
                                                <span className="text-xs text-white/40">{fmtDate(src.date)}</span>
                                            </td>
                                            <td className="pl-3 pr-4 py-3.5 text-right">
                                                <RowActions
                                                    onInfo={() => setInfoSource(src)}
                                                    onEdit={() => openEditModal(src)}
                                                    onRefresh={() => handleRefreshSource(src.id)}
                                                    onDelete={() => setConfirmDeleteSource(src)}
                                                    refreshing={refreshingId === src.id}
                                                />
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>

            {/* Backend pagination — only for channels tab */}
            {activeTab === "channel" && pagination && <Pagination pagination={pagination} onPageChange={(p) => setChannelPage(p)} />}

            {/* Upload Modal */}
            {uploadOpen && (
                <Modal onClose={closeUploadModal} title="Upload Playlist" icon={Upload}>
                    {addUploadMutation.error && (
                        <div className="flex items-center gap-2.5 text-xs text-error bg-error/10 border border-error/20 rounded-xl px-4 py-3">
                            <AlertTriangle size={13} className="shrink-0" />
                            <span>{addUploadMutation.error?.response?.data?.message || addUploadMutation.error?.message}</span>
                        </div>
                    )}
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-white/70">Source Name</label>
                        <input
                            type="text"
                            placeholder="e.g. Sports Bundle"
                            value={uploadName}
                            onChange={(e) => setUploadName(e.target.value)}
                            className="input input-sm bg-base-100 border border-white/10 focus:outline-none focus:border-primary/50 w-full"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-white/70">File</label>
                        <div
                            onClick={() => fileInputRef.current?.click()}
                            className="rounded-xl border-2 border-dashed border-white/15 hover:border-primary/40 transition-colors cursor-pointer flex flex-col items-center justify-center gap-2 py-7 px-4 text-center">
                            <input ref={fileInputRef} type="file" accept={ACCEPTED_EXTENSIONS} className="hidden" onChange={(e) => setUploadFile(e.target.files?.[0] || null)} />
                            <Upload size={20} className="text-white/25" />
                            {uploadFile ? (
                                <p className="text-sm text-white/80 font-medium truncate max-w-full px-2">{uploadFile.name}</p>
                            ) : (
                                <>
                                    <p className="text-sm text-white/50">Click to choose a file</p>
                                    <p className="text-[11px] text-white/30">.m3u .m3u8 .yml .yaml .json .xml .txt — up to 50MB</p>
                                </>
                            )}
                        </div>
                        {uploadFile && <p className="text-[11px] text-white/35">Detected format: {detectFormat(uploadFile.name)}</p>}
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                        <button
                            onClick={closeUploadModal}
                            className="px-4 py-2 rounded-md text-sm font-bold text-white/75 hover:text-white hover:bg-white/8 transition-colors border-none cursor-pointer">
                            Cancel
                        </button>
                        <button
                            onClick={() => addUploadMutation.mutate({ name: uploadName.trim(), file: uploadFile })}
                            disabled={!uploadFile || addUploadMutation.isPending}
                            className="px-4 py-2 rounded-md text-sm font-bold bg-primary text-primary-content hover:opacity-90 transition-opacity border-none cursor-pointer disabled:opacity-40 flex items-center gap-1.5">
                            {addUploadMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                            {addUploadMutation.isPending ? "Uploading…" : "Add Source"}
                        </button>
                    </div>
                </Modal>
            )}

            {/* Add URL Modal */}
            {urlOpen && (
                <Modal onClose={closeUrlModal} title="Add Remote Playlist" icon={LinkIcon}>
                    {addUrlMutation.error && (
                        <div className="flex items-center gap-2.5 text-xs text-error bg-error/10 border border-error/20 rounded-xl px-4 py-3">
                            <AlertTriangle size={13} className="shrink-0" />
                            <span>{addUrlMutation.error?.response?.data?.message || addUrlMutation.error?.message}</span>
                        </div>
                    )}
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-white/70">Source Name</label>
                        <input
                            type="text"
                            placeholder="e.g. IPTV-ORG Country Index"
                            value={urlName}
                            onChange={(e) => setUrlName(e.target.value)}
                            className="input input-sm bg-base-100 border border-white/10 focus:outline-none focus:border-primary/50 w-full"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-white/70">Playlist URL</label>
                        <input
                            type="text"
                            placeholder="https://raw.githubusercontent.com/iptv-org/iptv/master/streams/bd.m3u"
                            value={urlValue}
                            onChange={(e) => setUrlValue(e.target.value)}
                            className="input input-sm bg-base-100 border border-white/10 focus:outline-none focus:border-primary/50 w-full font-mono"
                        />
                        {urlValue.trim() && <p className="text-[11px] text-white/35">Detected format: {detectFormat(urlValue.trim())}</p>}
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                        <button onClick={closeUrlModal} className="px-4 py-2 rounded-md text-sm font-bold text-white/75 hover:text-white hover:bg-white/8 transition-colors border-none cursor-pointer">
                            Cancel
                        </button>
                        <button
                            onClick={() => addUrlMutation.mutate({ name: urlName.trim(), url: urlValue.trim() })}
                            disabled={!urlValue.trim() || addUrlMutation.isPending}
                            className="px-4 py-2 rounded-md text-sm font-bold bg-primary text-primary-content hover:opacity-90 transition-opacity border-none cursor-pointer disabled:opacity-40 flex items-center gap-1.5">
                            {addUrlMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                            {addUrlMutation.isPending ? "Adding…" : "Add Source"}
                        </button>
                    </div>
                </Modal>
            )}

            {/* Source Info Modal */}
            {infoSource && (
                <Modal onClose={() => setInfoSource(null)} title="Source Info" icon={Info}>
                    <div className="space-y-3 text-sm">
                        {[
                            ["Name", infoSource.name],
                            ["Type", infoSource.type === "url" ? "URL" : "File"],
                            ["Format", infoSource.format],
                            ["Location", infoSource.location],
                            ["Channels", infoSource.channelCount?.toLocaleString?.() ?? infoSource.channelCount],
                            ["Status", infoSource.status],
                            ["Added", fmtDate(infoSource.date)],
                            ...(infoSource.status === "error" && infoSource.error ? [["Error", infoSource.error]] : []),
                        ].map(([label, value]) => (
                            <div key={label} className="space-y-0.5">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">{label}</p>
                                <p className="text-sm text-white/85 break-all">{value ?? "—"}</p>
                            </div>
                        ))}
                    </div>
                </Modal>
            )}

            {/* Edit Source Modal */}
            {editSource && (
                <Modal onClose={closeEditModal} title="Edit Source" icon={Pencil}>
                    {editMutation.error && (
                        <div className="flex items-center gap-2.5 text-xs text-error bg-error/10 border border-error/20 rounded-xl px-4 py-3">
                            <AlertTriangle size={13} className="shrink-0" />
                            <span>{editMutation.error?.response?.data?.message || editMutation.error?.message}</span>
                        </div>
                    )}
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-white/70">Source Name</label>
                        <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="input input-sm bg-base-100 border border-white/10 focus:outline-none focus:border-primary/50 w-full"
                        />
                    </div>
                    {editSource.type === "url" && (
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-white/70">Playlist URL</label>
                            <input
                                type="text"
                                value={editLocation}
                                onChange={(e) => setEditLocation(e.target.value)}
                                className="input input-sm bg-base-100 border border-white/10 focus:outline-none focus:border-primary/50 w-full font-mono"
                            />
                        </div>
                    )}
                    <div className="flex justify-end gap-2 pt-1">
                        <button
                            onClick={closeEditModal}
                            className="px-4 py-2 rounded-md text-sm font-bold text-white/75 hover:text-white hover:bg-white/8 transition-colors border-none cursor-pointer">
                            Cancel
                        </button>
                        <button
                            onClick={() =>
                                editMutation.mutate({
                                    id: editSource.id,
                                    data: editSource.type === "url" ? { name: editName.trim(), url: editLocation.trim() } : { name: editName.trim() },
                                })
                            }
                            disabled={!editName.trim() || editMutation.isPending}
                            className="px-4 py-2 rounded-md text-sm font-bold bg-primary text-primary-content hover:opacity-90 transition-opacity border-none cursor-pointer disabled:opacity-40 flex items-center gap-1.5">
                            {editMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                            {editMutation.isPending ? "Saving…" : "Save Changes"}
                        </button>
                    </div>
                </Modal>
            )}

            {/* Channel Info Modal */}
            {infoChannel && (
                <Modal onClose={() => setInfoChannel(null)} title="Channel Info" icon={Info}>
                    <div className="space-y-3 text-sm">
                        {[
                            ["Name", infoChannel.name],
                            ["Country", infoChannel.country],
                            ["Group", infoChannel.group],
                            ["Category", infoChannel.category],
                            ["Working Status", getStatus(infoChannel.url)],
                            ["Stream URL", infoChannel.url],
                        ].map(([label, value]) => (
                            <div key={label} className="space-y-0.5">
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">{label}</p>
                                    {label === "Stream URL" && <CopyIconBtn text={value} title="Copy stream URL" />}
                                </div>
                                <p className="text-sm text-white/85 break-all">{value ?? "—"}</p>
                            </div>
                        ))}
                    </div>
                </Modal>
            )}

            {/* Edit Channel Modal — saved to backend (channel-state.json) */}
            {editChannel && (
                <Modal onClose={closeEditChannelModal} title="Edit Channel" icon={Pencil}>
                    {editChannelMutation.error && (
                        <div className="flex items-center gap-2.5 text-xs text-error bg-error/10 border border-error/20 rounded-xl px-4 py-3">
                            <AlertTriangle size={13} className="shrink-0" />
                            <span>{editChannelMutation.error?.response?.data?.message || editChannelMutation.error?.message}</span>
                        </div>
                    )}
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-white/70">Channel Name</label>
                        <input
                            type="text"
                            value={editChName}
                            onChange={(e) => setEditChName(e.target.value)}
                            className="input input-sm bg-base-100 border border-white/10 focus:outline-none focus:border-primary/50 w-full"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-white/70">Category</label>
                        <input
                            type="text"
                            value={editChCategory}
                            onChange={(e) => setEditChCategory(e.target.value)}
                            className="input input-sm bg-base-100 border border-white/10 focus:outline-none focus:border-primary/50 w-full"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-white/70">Country</label>
                        <input
                            type="text"
                            value={editChCountry}
                            onChange={(e) => setEditChCountry(e.target.value)}
                            className="input input-sm bg-base-100 border border-white/10 focus:outline-none focus:border-primary/50 w-full"
                        />
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                        <button
                            onClick={closeEditChannelModal}
                            className="px-4 py-2 rounded-md text-sm font-bold text-white/75 hover:text-white hover:bg-white/8 transition-colors border-none cursor-pointer">
                            Cancel
                        </button>
                        <button
                            onClick={saveChannelEdit}
                            disabled={!editChName.trim() || editChannelMutation.isPending}
                            className="px-4 py-2 rounded-md text-sm font-bold bg-primary text-primary-content hover:opacity-90 transition-opacity border-none cursor-pointer disabled:opacity-40 flex items-center gap-1.5">
                            {editChannelMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                            {editChannelMutation.isPending ? "Saving…" : "Save Changes"}
                        </button>
                    </div>
                </Modal>
            )}

            {/* Confirm Delete Channel Modal */}
            {confirmHideChannel && (
                <Modal onClose={() => setConfirmHideChannel(null)} title="Delete Channel" icon={Trash2}>
                    <p className="text-sm text-white/75">
                        Remove <span className="font-bold text-white">{confirmHideChannel.name}</span>? This hides it everywhere (player and dashboard) — the source playlist file itself is unchanged,
                        so it comes back only if you restore it or the source is deleted and re-added.
                    </p>
                    {hideChannelMutation.error && (
                        <div className="flex items-center gap-2.5 text-xs text-error bg-error/10 border border-error/20 rounded-xl px-4 py-3">
                            <AlertTriangle size={13} className="shrink-0" />
                            <span>{hideChannelMutation.error?.response?.data?.message || hideChannelMutation.error?.message}</span>
                        </div>
                    )}
                    <div className="flex justify-end gap-2 pt-1">
                        <button
                            onClick={() => setConfirmHideChannel(null)}
                            className="px-4 py-2 rounded-md text-sm font-bold text-white/75 hover:text-white hover:bg-white/8 transition-colors border-none cursor-pointer">
                            Cancel
                        </button>
                        <button
                            onClick={() => hideChannel(confirmHideChannel)}
                            disabled={hideChannelMutation.isPending}
                            className="px-4 py-2 rounded-md text-sm font-bold bg-error text-error-content hover:opacity-90 transition-opacity border-none cursor-pointer disabled:opacity-40 flex items-center gap-1.5">
                            {hideChannelMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                            {hideChannelMutation.isPending ? "Deleting…" : "Delete"}
                        </button>
                    </div>
                </Modal>
            )}
        </div>
    );
}

// ─── Error boundary — forces any silent render crash onto the screen ──────────
// If Star/Edit/Delete "do nothing" and nothing shows in console, a crash
// during render is the other likely cause (a bad prop, undefined.something,
// etc). This makes that impossible to miss: instead of a blank/silent page,
// the actual error + component stack render right here, in the UI, no
// DevTools required.
class DashIPTVErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { error: null, info: null };
    }
    static getDerivedStateFromError(error) {
        return { error };
    }
    componentDidCatch(error, info) {
        this.setState({ info });
        console.error("[DashIPTV] Render crash:", error, info);
    }
    render() {
        if (this.state.error) {
            return (
                <div className="p-6 space-y-3 bg-error/10 border border-error/30 rounded-2xl m-4 font-mono text-sm">
                    <p className="text-error font-bold text-base">DashIPTV crashed — copy everything below and send it back:</p>
                    <pre className="whitespace-pre-wrap break-all text-error/90 bg-black/30 rounded-lg p-3">{this.state.error.message}</pre>
                    <pre className="whitespace-pre-wrap break-all text-white/50 text-xs bg-black/30 rounded-lg p-3 max-h-64 overflow-auto">
                        {this.state.error.stack}
                        {this.state.info?.componentStack}
                    </pre>
                    <button onClick={() => this.setState({ error: null, info: null })} className="px-4 py-2 rounded-md text-sm font-bold bg-error text-error-content border-none cursor-pointer">
                        Try again
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

export default function DashIPTV() {
    return (
        <DashIPTVErrorBoundary>
            <DashIPTVInner />
        </DashIPTVErrorBoundary>
    );
}
