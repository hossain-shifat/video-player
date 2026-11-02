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
import Hls from "hls.js";
import { useNavigate } from "react-router";
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
    Image as ImageIcon,
    FileText,
    CheckCircle2,
    XCircle,
    Clock,
    Play,
    RotateCw,
    AlertCircle,
    Star,
    Copy,
    ShieldCheck,
    SquarePen,
    RotateCcw,
    MonitorPlay,
    EyeOff,
    Layers,
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
    startLiveBulkCheck,
    getLiveBulkCheckStatus,
    getActiveLiveChannels,
    markLiveChannelActive,
    unmarkLiveChannelActive,
    updateLiveChannel,
    updateActiveLiveChannel,
    uploadActiveLiveLogo,
    deleteLiveChannel,
} from "../../api/live";
import { safeChannel, safeSource } from "../../utils/fallbacks";
import {
    ModalShell,
    ModalHeader,
    ModalContent,
    ModalSection,
    ModalRows,
    ModalKV,
    ModalStats,
    ModalCallout,
    ModalBullets,
    ModalReview,
    ModalCopyButton,
    ModalFooter,
    ModalBadge,
    ModalButton,
    PANEL,
} from "../components/ConfirmModal";

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

// ─── Modals ───────────────────────────────────────────────────────────────────
// Same labelled-section design as the Users / Media / Libraries / Storage dialogs (ConfirmModal.jsx).

const TONE_CLS = { primary: "text-primary", info: "text-info", success: "text-success", warning: "text-warning", error: "text-error", accent: "text-accent" };
const FIELD = "flex h-[42px] items-center gap-2 rounded-md border border-base-content/15 bg-base-100 px-3 transition-colors focus-within:border-primary/60";
const FIELD_INPUT = "min-w-0 flex-1 bg-transparent text-[13px] text-base-content outline-none placeholder:text-base-content/40";

const apiError = (e) => e?.response?.data?.message || e?.message;
const STATUS_TONE = { ready: "success", working: "success", pending: "warning", timeout: "warning", error: "error", offline: "error", checking: "info" };
const STATUS_ICON = { success: CheckCircle2, warning: Clock, error: AlertCircle, info: Loader2 };
const cap = (v) => (v ? String(v).charAt(0).toUpperCase() + String(v).slice(1) : "—");

/** Shell + header + body + footer. `dense` tightens the gaps for the tall edit forms. */
function IptvModal({ id, icon, tone = "primary", avatar, dense = false, title, subtitle, badges, right, busy = false, onClose, error, note, actions, children }) {
    return (
        <ModalShell onClose={onClose} busy={busy} labelledBy={id}>
            <ModalHeader id={id} icon={icon} avatar={avatar} tone={TONE_CLS[tone] || TONE_CLS.primary} title={title} subtitle={subtitle} badges={badges} right={right} onClose={onClose} busy={busy} />
            <ModalContent className={`${dense ? "!gap-3 !py-4" : ""}`}>
                {error && (
                    <ModalCallout tone="error" icon={AlertTriangle} compact>
                        {error}
                    </ModalCallout>
                )}
                {children}
            </ModalContent>
            <ModalFooter note={note}>{actions}</ModalFooter>
        </ModalShell>
    );
}

/** Small muted label above a control. A dot + Reset appear once the field differs from the saved value. */
function Field({ label, hint, htmlFor, changed = false, onReset, className = "", children }) {
    return (
        <section className={`flex shrink-0 flex-col gap-1.5 ${className}`}>
            <div className="flex min-h-5 items-center justify-between gap-2">
                <label htmlFor={htmlFor} className="flex items-center gap-1.5 text-xs font-medium text-base-content/65">
                    {label}
                    {hint && <span className="font-normal text-base-content/45">· {hint}</span>}
                    {changed && <span className="size-1.5 rounded-full bg-warning" title="Changed" />}
                </label>
                {changed && onReset && (
                    <button type="button" onClick={onReset} className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-base-content/55 transition-colors hover:text-base-content">
                        <RotateCcw size={11} />
                        Reset
                    </button>
                )}
            </div>
            {children}
        </section>
    );
}

function TextInput({ icon: Icon, changed = false, mono = false, readOnly = false, ...props }) {
    return (
        <div className={`${FIELD} ${changed ? "!border-primary/60" : ""} ${readOnly ? "bg-base-200/40" : ""}`}>
            {Icon && <Icon size={14} className="shrink-0 text-base-content/50" />}
            <input type="text" readOnly={readOnly} {...props} className={`${FIELD_INPUT} ${mono ? "font-mono text-xs" : ""}`} />
        </div>
    );
}

/** Footer note of the edit dialogs: "● Unsaved changes" or a quiet idle line. */
function DirtyNote({ dirty }) {
    return dirty ? (
        <span className="inline-flex items-center gap-1.5 text-warning">
            <span className="size-2 rounded-full bg-warning" />
            Unsaved changes
        </span>
    ) : (
        <span className="text-base-content/60">No changes yet</span>
    );
}

/** Split a playlist / stream address into the pieces the info dialogs show. */
function parseAddress(raw) {
    try {
        const u = new URL(String(raw));
        const file = u.pathname.split("/").filter(Boolean).pop() || "";
        const ext = file.includes(".") ? file.split(".").pop().toLowerCase() : "";
        return { ok: true, host: u.host, scheme: u.protocol.replace(":", "").toUpperCase(), secure: u.protocol === "https:", path: `${u.pathname}${u.search}` || "/", file, ext };
    } catch {
        return { ok: false };
    }
}
const STREAM_KIND = { m3u8: "HLS", m3u: "HLS", mpd: "MPEG-DASH", ts: "MPEG-TS", mp4: "MP4", mkv: "MKV", flv: "FLV" };

/** Round channel logo (falls back to the initial when missing or broken), used in place of an icon tile. */
function ChannelLogo({ src, name, size = "size-10" }) {
    const [bad, setBad] = useState(false);
    useEffect(() => setBad(false), [src]);
    const initial = (name || "?").trim()[0]?.toUpperCase() || "?";
    return (
        <div className={`${size} grid shrink-0 place-items-center overflow-hidden rounded-full border border-base-content/20 bg-base-300`}>
            {src && !bad ? (
                <img src={src} alt="" onError={() => setBad(true)} className="h-full w-full object-contain p-1" />
            ) : (
                <span className="text-sm font-medium text-base-content">{initial}</span>
            )}
        </div>
    );
}

function ModalStatus({ status }) {
    const tone = STATUS_TONE[status] || "neutral";
    return (
        <ModalBadge tone={tone} icon={STATUS_ICON[tone]}>
            {cap(status)}
        </ModalBadge>
    );
}

/** Panel naming what a delete dialog is about to remove. */
function TargetCard({ avatar, title, sub, mono = false, badge }) {
    return (
        <div className={`${PANEL} flex shrink-0 items-center gap-4 px-4 py-3`}>
            {avatar}
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-base-content">{title}</p>
                {sub && <p className={`truncate text-xs text-base-content/55 ${mono ? "font-mono" : ""}`}>{sub}</p>}
            </div>
            {badge}
        </div>
    );
}

// ─── Player Modal — "Play" action opens this instead of a raw new-tab <a> ─────
// A bare <a href={m3u8} target="_blank"> just downloads/404s in most browsers
// (Chrome/Firefox can't natively play HLS). This attaches hls.js so the admin
// can actually preview the stream, and treats 404/503/timeout as retryable
// network errors instead of a dead end.
function PlayerModal({ channel, onClose }) {
    const navigate = useNavigate();
    const videoRef = useRef(null);
    const hlsRef = useRef(null);
    const retriesRef = useRef(0);
    const [status, setStatus] = useState("loading"); // loading | playing | error
    const [errorMsg, setErrorMsg] = useState("");

    useEffect(() => {
        let destroyed = false;
        const video = videoRef.current;
        if (!video || !channel?.url) return;

        setStatus("loading");
        setErrorMsg("");
        retriesRef.current = 0;

        function fail(msg) {
            if (destroyed) return;
            setStatus("error");
            setErrorMsg(msg);
        }

        if (Hls.isSupported()) {
            const hls = new Hls({
                maxBufferLength: 30,
                manifestLoadingMaxRetry: 4,
                manifestLoadingRetryDelay: 1000,
                levelLoadingMaxRetry: 4,
                fragLoadingMaxRetry: 6,
                fragLoadingRetryDelay: 1000,
            });
            hlsRef.current = hls;

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                if (destroyed) return;
                setStatus("playing");
                video.play().catch(() => {});
            });

            hls.on(Hls.Events.ERROR, (_evt, data) => {
                if (destroyed || !data.fatal) return;
                const code = data.response?.code;
                if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                    // 404 / 503 / timeout — retry a few times (backend may be
                    // rate-limiting or the CDN edge is briefly flaky) before
                    // surfacing a hard error.
                    if (retriesRef.current < 3) {
                        retriesRef.current += 1;
                        setTimeout(() => !destroyed && hls.startLoad(), 1200);
                        return;
                    }
                    fail(code ? `Stream unreachable — HTTP ${code}` : `Network error — ${data.details}`);
                } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                    hls.recoverMediaError();
                } else {
                    fail(data.details || "Playback failed");
                }
            });

            hls.loadSource(channel.url);
            hls.attachMedia(video);
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
            // Safari / iOS — native HLS
            video.src = channel.url;
            const onLoaded = () => !destroyed && setStatus("playing");
            const onErr = () => fail("Stream unreachable — playback failed");
            video.addEventListener("loadedmetadata", onLoaded);
            video.addEventListener("error", onErr);
            video.play().catch(() => {});
        } else {
            fail("HLS playback not supported in this browser");
        }

        return () => {
            destroyed = true;
            if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
            }
            video.removeAttribute("src");
            video.load();
        };
    }, [channel?.url]);

    if (!channel) return null;

    const tone = status === "playing" ? "success" : status === "error" ? "error" : "info";
    const addr = parseAddress(channel.url);
    return (
        <IptvModal
            id="iptv-player-t"
            avatar={<ChannelLogo src={channel.logo} name={channel.name} />}
            title={channel.name || "Preview"}
            subtitle={[channel.group || channel.category, channel.country].filter(Boolean).join(" · ") || undefined}
            badges={
                <ModalBadge tone={tone} icon={STATUS_ICON[tone]}>
                    {status === "playing" ? "Playing" : status === "error" ? "Error" : "Connecting"}
                </ModalBadge>
            }
            onClose={onClose}
            note={<span className="block truncate font-mono">{channel.url}</span>}
            actions={
                <>
                    <ModalCopyButton text={channel.url} label="stream URL" />
                    <ModalButton onClick={onClose}>Close</ModalButton>
                    <ModalButton
                        variant="primary"
                        className="gap-1.5"
                        onClick={() =>
                            navigate(`/live/watch/${encodeURIComponent(channel.id ?? "preview")}`, {
                                state: { streamUrl: channel.url, channelName: channel.name, channelLogo: channel.logo || null },
                            })
                        }>
                        <MonitorPlay size={14} />
                        Open in player
                    </ModalButton>
                </>
            }>
            <div className="relative min-h-40 flex-1 overflow-hidden rounded-lg border border-base-content/10 bg-black">
                <video ref={videoRef} controls autoPlay playsInline className="h-full w-full object-contain" />
                {status === "loading" && (
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2">
                        <span className="grid size-14 place-items-center rounded-full border border-base-content/25 bg-base-content/10">
                            <Loader2 size={24} className="animate-spin text-base-content/70" />
                        </span>
                        <p className="text-xs text-white/70">Connecting</p>
                    </div>
                )}
                {status === "error" && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/85 px-4 text-center">
                        <span className="grid size-14 place-items-center rounded-full border border-error/35 bg-error/10">
                            <AlertCircle size={24} className="text-error" />
                        </span>
                        <p className="text-xs text-white/70">{errorMsg}</p>
                    </div>
                )}
            </div>
            <ModalStats
                items={[
                    { icon: Play, tone: "text-info", label: "Stream type", value: addr.ok ? STREAM_KIND[addr.ext] || "Stream" : "—" },
                    { icon: ShieldCheck, tone: addr.secure ? "text-success" : "text-warning", label: "Protocol", value: addr.ok ? addr.scheme : "—" },
                    { icon: Globe2, tone: "text-accent", label: "Host", value: addr.ok ? addr.host : "—", mono: true },
                ]}
            />
        </IptvModal>
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
                <SquarePen size={13} />
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
function ChannelsTable({ list, loading, pageOffset, emptyTitle, emptySub, getStatus, recheckOne, activeIds, onToggleActive, onInfo, onEdit, onHide, onPlay }) {
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
                                    <WorkingStatusBadge status={getStatus(ch)} />
                                </td>
                                <td className="pl-3 pr-4 py-3 text-right">
                                    <div className="flex items-center justify-end gap-0.5 flex-nowrap">
                                        <button
                                            onClick={() => onToggleActive(ch)}
                                            title={isFav ? "Remove from Active" : "Mark Active"}
                                            className={`w-7 h-7 rounded-md flex items-center justify-center border-none transition-colors cursor-pointer shrink-0 ${
                                                isFav ? "text-warning hover:bg-warning/10" : "text-white/70 hover:bg-white/8 hover:text-white"
                                            }`}>
                                            <Star size={12} fill={isFav ? "currentColor" : "none"} />
                                        </button>
                                        <button
                                            onClick={() => onPlay(ch)}
                                            title="Play"
                                            className="w-7 h-7 rounded-md flex items-center justify-center text-white/70 border-none hover:bg-white/8 hover:text-white transition-colors cursor-pointer shrink-0">
                                            <Play size={12} />
                                        </button>
                                        <button
                                            onClick={() => recheckOne(ch.url)}
                                            title="Recheck status"
                                            className="w-7 h-7 rounded-md flex items-center justify-center text-white/70 border-none hover:bg-white/8 hover:text-white transition-colors cursor-pointer">
                                            <RotateCw size={12} className={getStatus(ch) === "checking" ? "animate-spin" : ""} />
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
                                            <SquarePen size={12} />
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
    const [channelSort, setChannelSort] = useState("status"); // auto-detect: working channels float to top
    const [playChannel, setPlayChannel] = useState(null); // channel obj for the Play preview modal
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

    // ── Active-tab CRUD (separate from the Channels-tab edit above — this
    // one writes only to active_live.json via updateActiveLiveChannel) ──────
    const [editActiveChannel, setEditActiveChannel] = useState(null);
    const [activeEditForm, setActiveEditForm] = useState({ name: "", logo: "", category: "", country: "", group: "", url: "" });
    const [activeLogoFile, setActiveLogoFile] = useState(null);
    const activeLogoInputRef = useRef(null);

    function openEditActiveModal(ch) {
        setEditActiveChannel(ch);
        setActiveEditForm({
            name: ch.name || "",
            logo: ch.logo || "",
            category: ch.category || "",
            country: ch.country || "",
            group: ch.group || "",
            url: ch.url || "",
        });
        setActiveLogoFile(null);
    }
    function closeEditActiveModal() {
        setEditActiveChannel(null);
        setActiveLogoFile(null);
        editActiveMutation.reset();
        uploadActiveLogoMutation.reset();
    }
    const editActiveMutation = useMutation({
        mutationFn: ({ id, data }) => updateActiveLiveChannel(id, data),
        onSuccess: () => {
            invalidateChannelState();
            showToast("Active channel updated");
            closeEditActiveModal();
        },
        onError: (err) => showToast(err?.response?.data?.message || err.message || "Failed to update channel", "error"),
    });
    const uploadActiveLogoMutation = useMutation({
        mutationFn: ({ id, file }) => uploadActiveLiveLogo(id, file),
        onSuccess: (res) => {
            const url = res?.data?.logo ?? res?.logo;
            if (url) setActiveEditForm((f) => ({ ...f, logo: url }));
            setActiveLogoFile(null);
            invalidateChannelState();
            showToast("Logo uploaded");
        },
        onError: (err) => showToast(err?.response?.data?.message || err.message || "Logo upload failed", "error"),
    });
    function saveActiveChannelEdit() {
        editActiveMutation.mutate({ id: editActiveChannel.id, data: activeEditForm });
    }

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

    const { getStatus, recheckOne } = useStreamStatusQueue();

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
    const channels = (channelsData?.data?.channels ?? []).map((c) => (c ? { ...safeChannel(c), id: c.id, streamStatus: c.streamStatus || "unknown" } : null)).filter(Boolean);
    const pagination = channelsData?.data?.pagination ?? null;

    // Sources: client-side filter fine, typically < 100 rows
    const filteredSources = useMemo(() => {
        if (!sourceQ) return sources;
        const q = sourceQ.toLowerCase();
        return sources.filter((s) => s.name.toLowerCase().includes(q) || s.location.toLowerCase().includes(q));
    }, [sources, sourceQ]);

    // Status shown in the table: prefer a manual, in-flight/just-finished
    // live probe (getStatus from useStreamStatusQueue) for THIS row, else
    // fall back to the server-persisted streamStatus that already came back
    // with the channel list (set by the backend's auto/scheduled bulk check).
    // No auto-probing on mount/page-change anymore — that was firing dozens
    // of concurrent live checks on every tab switch, which is both why the
    // badge always showed "checking"/"pending" and a likely contributor to
    // server-side crashes under load.
    const channelStatus = useCallback((ch) => (getStatus(ch.url) !== "idle" ? getStatus(ch.url) : ch.streamStatus || "unknown"), [getStatus]);

    // ── Reload (bulk recheck) ───────────────────────────────────────────────
    const [bulkChecking, setBulkChecking] = useState(false);
    async function reloadWorkingStatus() {
        if (bulkChecking) return;
        setBulkChecking(true);
        try {
            await startLiveBulkCheck();
            showToast("Rechecking all channels…");
            // Poll until the server-side bulk job finishes, then pull fresh streamStatus
            const poll = setInterval(async () => {
                try {
                    const { data } = await getLiveBulkCheckStatus();
                    if (!data?.running) {
                        clearInterval(poll);
                        setBulkChecking(false);
                        refetchChannels();
                        showToast("Working status updated");
                    }
                } catch {
                    clearInterval(poll);
                    setBulkChecking(false);
                }
            }, 2000);
        } catch (err) {
            setBulkChecking(false);
            showToast(err?.response?.data?.message || err.message || "Failed to start recheck", "error");
        }
    }

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

                {/* Search + Reload */}
                <div className="flex items-center gap-2 w-full sm:w-auto">
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
                    {(activeTab === "channel" || activeTab === "active") && (
                        <button
                            onClick={reloadWorkingStatus}
                            disabled={bulkChecking}
                            title="Recheck working status for every channel"
                            className="h-10 px-3 rounded-md flex items-center gap-1.5 text-xs font-bold text-white/70 bg-base-300 border border-white/8 hover:bg-white/8 hover:text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0">
                            <RefreshCw size={13} className={bulkChecking ? "animate-spin" : ""} />
                            <span className="hidden sm:inline">Reload</span>
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
                            getStatus={channelStatus}
                            recheckOne={recheckOne}
                            activeIds={activeIds}
                            onToggleActive={toggleActiveChannel}
                            onInfo={setInfoChannel}
                            onEdit={openEditActiveModal}
                            onHide={setConfirmHideChannel}
                            onPlay={setPlayChannel}
                        />
                    ) : activeTab === "channel" ? (
                        <ChannelsTable
                            list={channels}
                            loading={channelsLoading}
                            pageOffset={(channelPage - 1) * PAGE_SIZE}
                            emptyTitle={channelQ ? "No channels match your search" : "No channels yet"}
                            emptySub={channelQ ? "" : "Add a playlist source to populate channels."}
                            getStatus={channelStatus}
                            recheckOne={recheckOne}
                            activeIds={activeIds}
                            onToggleActive={toggleActiveChannel}
                            onInfo={setInfoChannel}
                            onEdit={openEditChannelModal}
                            onHide={setConfirmHideChannel}
                            onPlay={setPlayChannel}
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
                <IptvModal
                    id="iptv-upload-t"
                    icon={Upload}
                    tone="primary"
                    title="Upload playlist"
                    subtitle="Add channels from a file"
                    busy={addUploadMutation.isPending}
                    onClose={closeUploadModal}
                    error={addUploadMutation.error ? apiError(addUploadMutation.error) : null}
                    note={`${uploadFile ? `Detected format: ${detectFormat(uploadFile.name)}` : "No file chosen yet"} · Accepted: ${ACCEPTED_EXTENSIONS.split(",").join(" ")}`}
                    actions={
                        <>
                            <ModalButton onClick={closeUploadModal} disabled={addUploadMutation.isPending}>
                                Cancel
                            </ModalButton>
                            <ModalButton
                                variant="primary"
                                className="gap-1.5"
                                onClick={() => addUploadMutation.mutate({ name: uploadName.trim(), file: uploadFile })}
                                disabled={!uploadFile}
                                loading={addUploadMutation.isPending}
                                loadingText="Uploading…">
                                <Plus size={14} />
                                Add source
                            </ModalButton>
                        </>
                    }>
                    <Field label="Source name" htmlFor="iptv-upload-name">
                        <TextInput
                            id="iptv-upload-name"
                            data-autofocus
                            changed={!!uploadName.trim()}
                            placeholder="e.g. Sports Bundle"
                            value={uploadName}
                            onChange={(e) => setUploadName(e.target.value)}
                        />
                    </Field>
                    <ModalSection label="File" grow>
                        <div
                            role="button"
                            tabIndex={0}
                            onClick={() => fileInputRef.current?.click()}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    fileInputRef.current?.click();
                                }
                            }}
                            className={`flex min-h-32 flex-1 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 text-center transition-colors ${
                                uploadFile ? "border-primary/50 bg-base-100" : "border-base-content/25 bg-base-100 hover:border-primary/50"
                            }`}>
                            <input ref={fileInputRef} type="file" accept={ACCEPTED_EXTENSIONS} className="hidden" onChange={(e) => setUploadFile(e.target.files?.[0] || null)} />
                            <span className={`grid size-12 place-items-center rounded-full border border-base-content/10 bg-base-200 ${uploadFile ? "text-primary" : "text-base-content/60"}`}>
                                {uploadFile ? <FileText size={20} /> : <Upload size={20} />}
                            </span>
                            {uploadFile ? (
                                <>
                                    <p className="max-w-full truncate text-sm text-base-content">{uploadFile.name}</p>
                                    <p className="text-xs text-base-content/55">Click to choose a different file</p>
                                </>
                            ) : (
                                <>
                                    <p className="text-sm text-base-content">Click to choose a file</p>
                                    <p className="text-xs text-base-content/55">M3U, M3U8, YAML, JSON, XML or TXT · up to 50 MB</p>
                                </>
                            )}
                        </div>
                    </ModalSection>
                    <ModalStats
                        items={[
                            { icon: Layers, tone: "text-success", label: "Size", value: uploadFile ? `${(uploadFile.size / 1048576).toFixed(1)} MB` : "—" },
                            { icon: ShieldCheck, tone: "text-warning", label: "Limit", value: "50 MB" },
                        ]}
                    />
                </IptvModal>
            )}

            {/* Add URL Modal */}
            {urlOpen &&
                (() => {
                    const addr = parseAddress(urlValue.trim());
                    return (
                        <IptvModal
                            id="iptv-url-t"
                            icon={LinkIcon}
                            tone="info"
                            title="Add remote playlist"
                            subtitle="Import channels from a URL"
                            busy={addUrlMutation.isPending}
                            onClose={closeUrlModal}
                            error={addUrlMutation.error ? apiError(addUrlMutation.error) : null}
                            note={urlValue.trim() ? `Detected format: ${detectFormat(urlValue.trim())}` : "Waiting for a URL"}
                            actions={
                                <>
                                    <ModalButton onClick={closeUrlModal} disabled={addUrlMutation.isPending}>
                                        Cancel
                                    </ModalButton>
                                    <ModalButton
                                        variant="primary"
                                        className="gap-1.5"
                                        onClick={() => addUrlMutation.mutate({ name: urlName.trim(), url: urlValue.trim() })}
                                        disabled={!urlValue.trim()}
                                        loading={addUrlMutation.isPending}
                                        loadingText="Adding…">
                                        <Plus size={14} />
                                        Add source
                                    </ModalButton>
                                </>
                            }>
                            <Field label="Source name" htmlFor="iptv-url-name">
                                <TextInput
                                    id="iptv-url-name"
                                    data-autofocus
                                    changed={!!urlName.trim()}
                                    placeholder="e.g. IPTV-ORG Country Index"
                                    value={urlName}
                                    onChange={(e) => setUrlName(e.target.value)}
                                />
                            </Field>
                            <Field label="Playlist URL" htmlFor="iptv-url-value">
                                <TextInput
                                    id="iptv-url-value"
                                    mono
                                    changed={!!urlValue.trim()}
                                    placeholder="https://raw.githubusercontent.com/iptv-org/iptv/master/streams/bd.m3u"
                                    value={urlValue}
                                    onChange={(e) => setUrlValue(e.target.value)}
                                />
                            </Field>
                            <ModalStats
                                items={[
                                    { icon: Globe2, tone: "text-accent", label: "Host", value: addr.ok ? addr.host : "—", mono: true },
                                    { icon: ShieldCheck, tone: addr.secure ? "text-success" : "text-warning", label: "Protocol", value: addr.ok ? addr.scheme : "—" },
                                ]}
                            />
                            <ModalCallout tone="info" compact className="mt-auto">
                                M3U, YAML, JSON or XML playlist address. Format and host are detected as you type.
                            </ModalCallout>
                        </IptvModal>
                    );
                })()}

            {/* Source Info Modal */}
            {infoSource &&
                (() => {
                    const addr = infoSource.type === "url" ? parseAddress(infoSource.location) : { ok: false };
                    const isUrl = infoSource.type === "url";
                    const sTone = STATUS_TONE[infoSource.status] || "neutral";
                    return (
                        <IptvModal
                            id="iptv-src-info-t"
                            icon={isUrl ? LinkIcon : FileText}
                            tone="info"
                            title={infoSource.name || "Source"}
                            subtitle={<span className="font-mono">{infoSource.location}</span>}
                            badges={
                                <>
                                    <ModalBadge tone="info">{isUrl ? "URL" : "File"}</ModalBadge>
                                    {infoSource.format && <ModalBadge>{infoSource.format}</ModalBadge>}
                                    <ModalStatus status={infoSource.status} />
                                </>
                            }
                            onClose={() => setInfoSource(null)}
                            note="Read only"
                            actions={<ModalButton onClick={() => setInfoSource(null)}>Close</ModalButton>}>
                            <ModalStats
                                items={[
                                    { icon: Tv, tone: "text-info", label: "Channels", value: infoSource.channelCount?.toLocaleString?.() ?? infoSource.channelCount ?? "—" },
                                    {
                                        icon: STATUS_ICON[sTone] || Info,
                                        tone: TONE_CLS[sTone] || "text-base-content/60",
                                        label: "Status",
                                        value: cap(infoSource.status),
                                        valueTone: sTone === "neutral" ? undefined : sTone,
                                    },
                                    { icon: Clock, tone: "text-warning", label: "Added", value: fmtDate(infoSource.date) },
                                ]}
                            />
                            <ModalSection label="Source" grow>
                                <ModalRows className="flex-1">
                                    <ModalKV label="Name">{infoSource.name ?? "—"}</ModalKV>
                                    <ModalKV label="Type">{isUrl ? "URL" : "Uploaded file"}</ModalKV>
                                    <ModalKV label="Format">{infoSource.format ?? "—"}</ModalKV>
                                    {isUrl && addr.ok && (
                                        <>
                                            <ModalKV label="Host" mono>
                                                {addr.host}
                                            </ModalKV>
                                            <ModalKV label="Protocol">
                                                <span className={addr.secure ? "text-success" : "text-warning"}>{addr.scheme}</span>
                                            </ModalKV>
                                        </>
                                    )}
                                    <ModalKV label={isUrl ? "Location" : "Stored as"} mono action={infoSource.location ? <ModalCopyButton text={infoSource.location} label="location" /> : null}>
                                        <span title={infoSource.location}>{infoSource.location ?? "—"}</span>
                                    </ModalKV>
                                    {infoSource.id != null && (
                                        <ModalKV label="Source ID" mono action={<ModalCopyButton text={String(infoSource.id)} label="source ID" />}>
                                            {String(infoSource.id)}
                                        </ModalKV>
                                    )}
                                </ModalRows>
                            </ModalSection>
                            {infoSource.status === "error" && infoSource.error && (
                                <ModalCallout tone="error" icon={AlertTriangle} compact>
                                    {infoSource.error}
                                </ModalCallout>
                            )}
                        </IptvModal>
                    );
                })()}

            {/* Edit Source Modal */}
            {editSource &&
                (() => {
                    const isUrl = editSource.type === "url";
                    const changes = [
                        editName.trim() !== (editSource.name || "") && { name: "Name", from: editSource.name || "—", to: editName.trim() || "—" },
                        isUrl && editLocation.trim() !== (editSource.location || "") && { name: "URL", from: editSource.location || "—", to: editLocation.trim() || "—" },
                    ].filter(Boolean);
                    return (
                        <IptvModal
                            id="iptv-src-edit-t"
                            icon={SquarePen}
                            tone="warning"
                            title="Edit source"
                            subtitle={editSource.name}
                            busy={editMutation.isPending}
                            onClose={closeEditModal}
                            error={editMutation.error ? apiError(editMutation.error) : null}
                            note={<DirtyNote dirty={changes.length > 0} />}
                            actions={
                                <>
                                    <ModalButton onClick={closeEditModal} disabled={editMutation.isPending}>
                                        Cancel
                                    </ModalButton>
                                    <ModalButton
                                        variant="primary"
                                        className="gap-1.5"
                                        onClick={() =>
                                            editMutation.mutate({
                                                id: editSource.id,
                                                data: isUrl ? { name: editName.trim(), url: editLocation.trim() } : { name: editName.trim() },
                                            })
                                        }
                                        disabled={!editName.trim()}
                                        loading={editMutation.isPending}
                                        loadingText="Saving…">
                                        <Check size={14} />
                                        Save changes
                                    </ModalButton>
                                </>
                            }>
                            <Field label="Source name" htmlFor="iptv-src-edit-name" changed={editName.trim() !== (editSource.name || "")} onReset={() => setEditName(editSource.name || "")}>
                                <TextInput
                                    id="iptv-src-edit-name"
                                    data-autofocus
                                    changed={editName.trim() !== (editSource.name || "")}
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                />
                            </Field>
                            <Field
                                label="Playlist URL"
                                hint="URL sources only"
                                htmlFor="iptv-src-edit-url"
                                changed={isUrl && editLocation.trim() !== (editSource.location || "")}
                                onReset={() => setEditLocation(editSource.location || "")}>
                                <TextInput
                                    id="iptv-src-edit-url"
                                    mono
                                    readOnly={!isUrl}
                                    changed={isUrl && editLocation.trim() !== (editSource.location || "")}
                                    value={isUrl ? editLocation : editSource.location || "Uploaded file — nothing to edit"}
                                    onChange={(e) => isUrl && setEditLocation(e.target.value)}
                                />
                            </Field>
                            <ModalStats
                                items={[
                                    { icon: isUrl ? LinkIcon : FileText, tone: "text-info", label: "Type", value: isUrl ? "URL" : "File" },
                                    { icon: FileText, tone: "text-accent", label: "Format", value: editSource.format ?? "—" },
                                    { icon: Tv, tone: "text-success", label: "Channels", value: editSource.channelCount?.toLocaleString?.() ?? editSource.channelCount ?? "—" },
                                ]}
                            />
                            {!isUrl && (
                                <ModalCallout tone="info" icon={Info} compact>
                                    Uploaded as a file, so only the name can be changed. Upload a new file to replace the channels.
                                </ModalCallout>
                            )}
                            <ModalReview changes={changes} saved={[{ name: "Name", value: editSource.name }, ...(isUrl ? [{ name: "URL", value: editSource.location }] : [])]} className="mt-auto" />
                        </IptvModal>
                    );
                })()}

            {/* Channel Info Modal */}
            {infoChannel &&
                (() => {
                    const st = channelStatus(infoChannel);
                    const addr = parseAddress(infoChannel.url);
                    const sTone = STATUS_TONE[st] || "neutral";
                    return (
                        <IptvModal
                            id="iptv-ch-info-t"
                            avatar={<ChannelLogo src={infoChannel.logo} name={infoChannel.name} />}
                            title={infoChannel.name || "Channel"}
                            subtitle={[infoChannel.country, infoChannel.group].filter(Boolean).join(" · ") || undefined}
                            badges={
                                <>
                                    <ModalStatus status={st} />
                                    {addr.ok && <ModalBadge>{STREAM_KIND[addr.ext] || "Stream"}</ModalBadge>}
                                </>
                            }
                            onClose={() => setInfoChannel(null)}
                            note="Read only"
                            actions={<ModalButton onClick={() => setInfoChannel(null)}>Close</ModalButton>}>
                            <ModalStats
                                items={[
                                    { icon: Play, tone: "text-info", label: "Stream type", value: addr.ok ? STREAM_KIND[addr.ext] || "Stream" : "—" },
                                    { icon: ShieldCheck, tone: addr.secure ? "text-success" : "text-warning", label: "Protocol", value: addr.ok ? addr.scheme : "—" },
                                    { icon: Globe2, tone: "text-accent", label: "Host", value: addr.ok ? addr.host : "—", mono: true },
                                ]}
                            />
                            <ModalSection label="Channel" grow>
                                <ModalRows className="flex-1">
                                    <ModalKV label="Name">{infoChannel.name ?? "—"}</ModalKV>
                                    <ModalKV label="Country">{infoChannel.country ?? "—"}</ModalKV>
                                    <ModalKV label="Group">{infoChannel.group ?? "—"}</ModalKV>
                                    <ModalKV label="Category">{infoChannel.category ?? "—"}</ModalKV>
                                    <ModalKV label="Working status">
                                        <span className={TONE_CLS[sTone] || ""}>{cap(st)}</span>
                                    </ModalKV>
                                    <ModalKV label="Stream URL" mono action={infoChannel.url ? <ModalCopyButton text={infoChannel.url} label="stream URL" /> : null}>
                                        <span title={infoChannel.url}>{infoChannel.url ?? "—"}</span>
                                    </ModalKV>
                                </ModalRows>
                            </ModalSection>
                        </IptvModal>
                    );
                })()}

            {/* Edit Channel Modal — saved to backend (channel-state.json) */}
            {editChannel &&
                (() => {
                    const changes = [
                        editChName.trim() !== (editChannel.name || "") && { name: "Name", from: editChannel.name || "—", to: editChName.trim() || "—" },
                        editChCategory.trim() !== (editChannel.category || "") && { name: "Category", from: editChannel.category || "—", to: editChCategory.trim() || "—" },
                        editChCountry.trim() !== (editChannel.country || "") && { name: "Country", from: editChannel.country || "—", to: editChCountry.trim() || "—" },
                    ].filter(Boolean);
                    const addr = parseAddress(editChannel.url);
                    const nameCh = editChName.trim() !== (editChannel.name || "");
                    const catCh = editChCategory.trim() !== (editChannel.category || "");
                    const couCh = editChCountry.trim() !== (editChannel.country || "");
                    return (
                        <IptvModal
                            id="iptv-ch-edit-t"
                            avatar={<ChannelLogo src={editChannel.logo} name={editChannel.name} />}
                            title="Edit channel"
                            subtitle={editChannel.name}
                            dense
                            busy={editChannelMutation.isPending}
                            onClose={closeEditChannelModal}
                            error={editChannelMutation.error ? apiError(editChannelMutation.error) : null}
                            note={<DirtyNote dirty={changes.length > 0} />}
                            actions={
                                <>
                                    <ModalButton onClick={closeEditChannelModal} disabled={editChannelMutation.isPending}>
                                        Cancel
                                    </ModalButton>
                                    <ModalButton
                                        variant="primary"
                                        className="gap-1.5"
                                        onClick={saveChannelEdit}
                                        disabled={!editChName.trim()}
                                        loading={editChannelMutation.isPending}
                                        loadingText="Saving…">
                                        <Check size={14} />
                                        Save changes
                                    </ModalButton>
                                </>
                            }>
                            <Field label="Channel name" htmlFor="iptv-ch-name" changed={nameCh} onReset={() => setEditChName(editChannel.name || "")}>
                                <TextInput id="iptv-ch-name" data-autofocus changed={nameCh} value={editChName} onChange={(e) => setEditChName(e.target.value)} />
                            </Field>
                            <div className="grid shrink-0 grid-cols-1 gap-4 sm:grid-cols-2">
                                <Field label="Category" htmlFor="iptv-ch-category" changed={catCh} onReset={() => setEditChCategory(editChannel.category || "")}>
                                    <TextInput id="iptv-ch-category" changed={catCh} value={editChCategory} onChange={(e) => setEditChCategory(e.target.value)} />
                                </Field>
                                <Field label="Country" htmlFor="iptv-ch-country" changed={couCh} onReset={() => setEditChCountry(editChannel.country || "")}>
                                    <TextInput id="iptv-ch-country" changed={couCh} value={editChCountry} onChange={(e) => setEditChCountry(e.target.value)} />
                                </Field>
                            </div>
                            <Field label="Stream URL" hint="read only">
                                <div className={`${FIELD} bg-base-200/40`}>
                                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-base-content/80" title={editChannel.url}>
                                        {editChannel.url ?? "—"}
                                    </span>
                                    {editChannel.url && <ModalCopyButton text={editChannel.url} label="stream URL" />}
                                </div>
                            </Field>
                            <ModalStats
                                items={[
                                    { icon: ListVideo, tone: "text-info", label: "Group", value: editChannel.group || "—" },
                                    { icon: Clock, tone: "text-warning", label: "Status", value: cap(channelStatus(editChannel)) },
                                    { icon: Globe2, tone: "text-accent", label: "Host", value: addr.ok ? addr.host : "—", mono: true },
                                ]}
                            />
                            <ModalReview
                                changes={changes}
                                saved={[
                                    { name: "Name", value: editChannel.name },
                                    { name: "Category", value: editChannel.category },
                                    { name: "Country", value: editChannel.country },
                                ]}
                                className="mt-auto"
                            />
                        </IptvModal>
                    );
                })()}

            {/* Edit Active Channel Modal — CRUD scoped to active_live.json only,
                separate from the Channels-tab "Edit Channel" modal above. */}
            {editActiveChannel &&
                (() => {
                    const changes = ["name", "logo", "category", "country", "group", "url"]
                        .filter((k) => (activeEditForm[k] || "").trim() !== (editActiveChannel[k] || ""))
                        .map((k) => ({ name: cap(k), from: editActiveChannel[k] || "—", to: (activeEditForm[k] || "").trim() || "—" }));
                    const setF = (k) => (e) => setActiveEditForm((f) => ({ ...f, [k]: e.target.value }));
                    const chg = (k) => (activeEditForm[k] || "").trim() !== (editActiveChannel[k] || "");
                    const rst = (k) => () => setActiveEditForm((f) => ({ ...f, [k]: editActiveChannel[k] || "" }));
                    return (
                        <IptvModal
                            id="iptv-active-edit-t"
                            avatar={<ChannelLogo src={editActiveChannel.logo} name={editActiveChannel.name} />}
                            title="Edit active channel"
                            subtitle={editActiveChannel.name}
                            dense
                            busy={editActiveMutation.isPending || uploadActiveLogoMutation.isPending}
                            onClose={closeEditActiveModal}
                            error={editActiveMutation.error || uploadActiveLogoMutation.error ? apiError(editActiveMutation.error) || apiError(uploadActiveLogoMutation.error) : null}
                            note={<DirtyNote dirty={changes.length > 0} />}
                            actions={
                                <>
                                    <ModalButton onClick={closeEditActiveModal} disabled={editActiveMutation.isPending}>
                                        Cancel
                                    </ModalButton>
                                    <ModalButton
                                        variant="primary"
                                        className="gap-1.5"
                                        onClick={saveActiveChannelEdit}
                                        disabled={!activeEditForm.name.trim()}
                                        loading={editActiveMutation.isPending}
                                        loadingText="Saving…">
                                        <Check size={14} />
                                        Save changes
                                    </ModalButton>
                                </>
                            }>
                            <input
                                ref={activeLogoInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                    const file = e.target.files?.[0] || null;
                                    setActiveLogoFile(file);
                                    if (file) uploadActiveLogoMutation.mutate({ id: editActiveChannel.id, file });
                                }}
                            />
                            <Field label="Logo" htmlFor="iptv-active-logo" changed={chg("logo")} onReset={rst("logo")}>
                                <div className="flex items-center gap-3">
                                    <ChannelLogo src={activeEditForm.logo.trim()} name={activeEditForm.name} size="size-[42px]" />
                                    <div className="min-w-0 flex-1">
                                        <TextInput id="iptv-active-logo" mono changed={chg("logo")} placeholder="https://…" value={activeEditForm.logo} onChange={setF("logo")} />
                                    </div>
                                    <ModalButton
                                        className="h-[42px] shrink-0 gap-1.5 px-4"
                                        onClick={() => activeLogoInputRef.current?.click()}
                                        loading={uploadActiveLogoMutation.isPending}
                                        loadingText="Uploading…">
                                        <Upload size={14} />
                                        Upload
                                    </ModalButton>
                                </div>
                            </Field>
                            <Field label="Channel name" htmlFor="iptv-active-name" changed={chg("name")} onReset={rst("name")}>
                                <TextInput id="iptv-active-name" data-autofocus changed={chg("name")} value={activeEditForm.name} onChange={setF("name")} />
                            </Field>
                            <div className="grid shrink-0 grid-cols-1 gap-4 sm:grid-cols-3">
                                <Field label="Category" htmlFor="iptv-active-category" changed={chg("category")} onReset={rst("category")}>
                                    <TextInput id="iptv-active-category" changed={chg("category")} value={activeEditForm.category} onChange={setF("category")} />
                                </Field>
                                <Field label="Country" htmlFor="iptv-active-country" changed={chg("country")} onReset={rst("country")}>
                                    <TextInput id="iptv-active-country" changed={chg("country")} value={activeEditForm.country} onChange={setF("country")} />
                                </Field>
                                <Field label="Group" htmlFor="iptv-active-group" changed={chg("group")} onReset={rst("group")}>
                                    <TextInput id="iptv-active-group" changed={chg("group")} value={activeEditForm.group} onChange={setF("group")} />
                                </Field>
                            </div>
                            <Field label="Stream URL" htmlFor="iptv-active-url" changed={chg("url")} onReset={rst("url")}>
                                <TextInput id="iptv-active-url" mono changed={chg("url")} value={activeEditForm.url} onChange={setF("url")} />
                            </Field>
                            <ModalReview changes={changes} saved={["name", "category", "country", "group"].map((k) => ({ name: cap(k), value: editActiveChannel[k] }))} className="mt-auto" />
                        </IptvModal>
                    );
                })()}

            {/* Play Preview Modal — plays the .m3u8 in-place via hls.js */}
            {playChannel && <PlayerModal channel={playChannel} onClose={() => setPlayChannel(null)} />}

            {/* Confirm Delete Source Modal */}
            {confirmDeleteSource && (
                <IptvModal
                    id="iptv-del-src-t"
                    icon={Trash2}
                    tone="error"
                    title={`Delete ${confirmDeleteSource.name}?`}
                    subtitle="Playlist source"
                    busy={deleteMutation.isPending}
                    onClose={() => setConfirmDeleteSource(null)}
                    error={deleteMutation.error ? apiError(deleteMutation.error) : null}
                    actions={
                        <>
                            <ModalButton onClick={() => setConfirmDeleteSource(null)} disabled={deleteMutation.isPending} data-autofocus>
                                Cancel
                            </ModalButton>
                            <ModalButton variant="danger" className="gap-1.5" onClick={() => deleteMutation.mutate(confirmDeleteSource.id)} loading={deleteMutation.isPending} loadingText="Deleting…">
                                <Trash2 size={14} />
                                Delete source
                            </ModalButton>
                        </>
                    }>
                    <ModalSection label="You are about to delete">
                        <TargetCard
                            avatar={
                                <span className="grid size-10 shrink-0 place-items-center rounded-full border border-base-content/10 bg-base-200">
                                    {confirmDeleteSource.type === "url" ? <LinkIcon size={16} className="text-info" /> : <FileText size={16} className="text-info" />}
                                </span>
                            }
                            title={confirmDeleteSource.name || "Source"}
                            sub={confirmDeleteSource.location}
                            mono
                            badge={<ModalBadge tone="info">{confirmDeleteSource.type === "url" ? "URL" : "File"}</ModalBadge>}
                        />
                    </ModalSection>
                    <ModalStats
                        items={[
                            { icon: Tv, tone: "text-error", label: "Channels removed", value: confirmDeleteSource.channelCount?.toLocaleString?.() ?? confirmDeleteSource.channelCount ?? "—" },
                            { icon: FileText, tone: "text-info", label: "Format", value: confirmDeleteSource.format ?? "—" },
                            { icon: Clock, tone: "text-warning", label: "Added", value: fmtDate(confirmDeleteSource.date) },
                        ]}
                    />
                    <ModalBullets
                        items={[
                            { icon: Trash2, tone: "text-error", text: "Every channel ingested from this source is removed too." },
                            { icon: RefreshCw, tone: "text-warning", text: "You would need to re-add the playlist to get them back." },
                        ]}
                    />
                    <ModalCallout tone="error" icon={AlertTriangle} compact className="mt-auto">
                        This can’t be undone.
                    </ModalCallout>
                </IptvModal>
            )}

            {/* Confirm Delete Channel Modal */}
            {confirmHideChannel && (
                <IptvModal
                    id="iptv-del-ch-t"
                    icon={Trash2}
                    tone="error"
                    title={`Delete ${confirmHideChannel.name}?`}
                    subtitle="Hidden everywhere in FLUX"
                    busy={hideChannelMutation.isPending}
                    onClose={() => setConfirmHideChannel(null)}
                    error={hideChannelMutation.error ? apiError(hideChannelMutation.error) : null}
                    actions={
                        <>
                            <ModalButton onClick={() => setConfirmHideChannel(null)} disabled={hideChannelMutation.isPending} data-autofocus>
                                Cancel
                            </ModalButton>
                            <ModalButton variant="danger" className="gap-1.5" onClick={() => hideChannel(confirmHideChannel)} loading={hideChannelMutation.isPending} loadingText="Deleting…">
                                <Trash2 size={14} />
                                Delete channel
                            </ModalButton>
                        </>
                    }>
                    <ModalSection label="You are about to delete">
                        <TargetCard
                            avatar={<ChannelLogo src={confirmHideChannel.logo} name={confirmHideChannel.name} />}
                            title={confirmHideChannel.name || "Channel"}
                            sub={[confirmHideChannel.country, confirmHideChannel.group].filter(Boolean).join(" · ") || undefined}
                        />
                    </ModalSection>
                    <ModalStats
                        items={[
                            { icon: Globe2, tone: "text-info", label: "Country", value: confirmHideChannel.country || "—" },
                            { icon: ListVideo, tone: "text-accent", label: "Group", value: confirmHideChannel.group || "—" },
                            { icon: Satellite, tone: "text-warning", label: "Category", value: confirmHideChannel.category || "—" },
                        ]}
                    />
                    <ModalBullets
                        items={[
                            { icon: EyeOff, tone: "text-error", text: "Hidden in both the player and the dashboard." },
                            { icon: FileText, tone: "text-success", text: "The source playlist file itself is unchanged." },
                            { icon: RotateCcw, tone: "text-warning", text: "It comes back only if you restore it, or the source is deleted and re-added." },
                        ]}
                    />
                </IptvModal>
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
