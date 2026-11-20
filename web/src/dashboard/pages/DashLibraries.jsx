// web/src/Dashboard/Pages/DashLibraries.jsx

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
    HardDrive,
    RefreshCw,
    AlertTriangle,
    Film,
    Tv2,
    Swords,
    FileText,
    Smile,
    FolderOpen,
    Database,
    FileVideo,
    Layers,
    RotateCcw,
    Trash2,
    Server,
    Loader2,
    Info,
    SquarePen,
    Cloud,
    Search,
    Plus,
    Clock,
    Activity,
    File as FileIcon,
    MoreHorizontal,
    ChevronLeft,
    ChevronRight,
    CircleAlert,
} from "lucide-react";
import { dashApi } from "../Api/dashboardApi";
import { api } from "../Shared";
import { storageApi } from "../Api/storageApi";
import { Link } from "react-router";
import { LibraryDetailModal, LibraryEditModal, LibraryRemoveModal } from "../Components/DashModal";

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtBytes(b) {
    if (!b || b === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.min(units.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
    return `${(b / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

const TD = "px-3 py-3.5 text-[13px] font-medium text-base-content align-middle";
const TB = Math.pow(1024, 4);
const GB = Math.pow(1024, 3);

function tbOf(b) {
    return ((b || 0) / TB).toFixed(1);
}

function fmtNum(n) {
    return (n ?? 0).toLocaleString();
}

function timeAgo(date) {
    if (!date) return "—";
    const d = new Date(date);
    if (isNaN(d)) return "—";
    const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
    return fmtDate(d);
}

function fmtDate(date) {
    if (!date) return "—";
    const d = new Date(date);
    if (isNaN(d)) return "—";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtIso(date) {
    if (!date) return "—";
    const d = new Date(date);
    if (isNaN(d)) return "—";
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtShortDate(date) {
    if (!date) return "—";
    const d = new Date(date);
    if (isNaN(d)) return "—";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function guessType(folder) {
    const s = ((folder.label || "") + " " + (folder.path || "")).toLowerCase();
    if (s.includes("anime")) return { key: "anime", label: "Anime", Icon: Swords, badgeClass: "badge-accent", barClass: "progress-accent" };
    if (s.includes("kid")) return { key: "kids", label: "Kids", Icon: Smile, badgeClass: "badge-warning", barClass: "progress-warning" };
    if (s.includes("doc")) return { key: "docs", label: "Docs", Icon: FileText, badgeClass: "badge-secondary", barClass: "progress-secondary" };
    if (s.includes("series") || s.includes("tv") || s.includes("show")) return { key: "tv", label: "TV", Icon: Tv2, badgeClass: "badge-info", barClass: "progress-info" };
    return { key: "movies", label: "Movies", Icon: Film, badgeClass: "badge-primary", barClass: "progress-primary" };
}

function guessDrive(lib) {
    if (lib.drive) return lib.drive;
    if (lib.driveType) return lib.driveType;
    const p = (lib.path || "").toLowerCase();
    if (p.startsWith("//") || p.startsWith("\\\\") || p.includes("/nas") || p.includes("smb") || p.includes("nfs")) return "Network";
    if (p.includes("/external") || p.includes("/hdd") || p.includes("/usb") || /^[e-z]:/.test(p)) return "External";
    return "Internal";
}

// Graph colours — sampled from the design reference. Graphs only; the rest of the page uses theme tokens.
const GC = { red: "#e23248", red2: "#9a2739", red3: "#601f2b", redFill: "#2e171f", g1: "#656971", g2: "#babec4", g3: "#8b8f97", track: "#222630", grid: "rgba(255,255,255,0.07)", ink: "#101319" };
const SEG = [
    { hex: GC.red, ink: "#fff" },
    { hex: GC.red2, ink: "#fff" },
    { hex: GC.red3, ink: "#fff" },
    { hex: GC.g1, ink: "#fff" },
    { hex: GC.g2, ink: GC.ink },
    { hex: GC.g3, ink: GC.ink },
];
const seg = (i) => SEG[i % SEG.length];

// Resolution buckets: red ramp for HD+, grey for SD (same as reference).
const QSEG = {
    "4K": { hex: GC.red },
    "1080p": { hex: GC.red2 },
    "720p": { hex: GC.red3 },
    SD: { hex: GC.g1 },
};
const HEAT = ["#1a1e27", "#3a1922", GC.red3, GC.red2, GC.red];

// ─── Rescan (no per-library endpoint — refresh-all is the mechanism) ──────────
async function triggerRescan(libLabel, setToast) {
    setToast({ msg: `Rescanning "${libLabel}"…`, type: "info" });
    try {
        await api.post("/api/metadata/refresh-all", {});
        setToast({ msg: "Metadata cache cleared. Rescan complete.", type: "success" });
        setTimeout(() => setToast(null), 3500);
        return true;
    } catch (e) {
        setToast({ msg: e.message || "Rescan failed", type: "error" });
        setTimeout(() => setToast(null), 3500);
        return false; // callers must not record a failed request as a completed scan
    }
}

// ─── Small UI atoms ───────────────────────────────────────────────────────────
function Toast({ toast }) {
    if (!toast) return null;
    const color = toast.type === "success" ? "alert-success" : toast.type === "error" ? "alert-error" : "alert-info";
    return (
        <div className={`fixed bottom-5 right-5 z-200 alert ${color} shadow-lg max-w-xs text-sm py-2.5 px-4 rounded-xl`}>
            <span>{toast.msg}</span>
        </div>
    );
}

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
                "btn btn-ghost btn-xs btn-square rounded-md border-none disabled:opacity-40",
                danger ? "hover:bg-error/15 hover:text-error text-base-content/80" : "hover:bg-base-content/10 text-base-content/80 hover:text-base-content",
            ].join(" ")}>
            {spinning ? <Loader2 size={13} className="animate-spin" /> : <Icon size={14} />}
        </button>
    );
}

function Panel({ className = "", children }) {
    return <div className={`card bg-base-200 border border-base-300 shadow-sm min-w-0 ${className}`}>{children}</div>;
}

function PanelHead({ title, sub, right }) {
    return (
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
            <div className="min-w-0">
                <div className="flex items-center gap-2">
                    <span className="h-3.5 w-0.75 rounded-full bg-primary shrink-0" />
                    <h2 className="text-[13px] font-bold text-base-content tracking-tight">{title}</h2>
                </div>
                {sub && <p className="text-xs text-base-content/80 mt-1 leading-relaxed">{sub}</p>}
            </div>
            {right != null && <div className="text-xs text-base-content/80 tabular-nums">{right}</div>}
        </div>
    );
}

function EmptyNote({ children }) {
    return <div className="flex items-center justify-center h-full min-h-24 text-xs text-base-content/70 text-center px-4">{children}</div>;
}

// Sparkline / area — values[] → svg path, stretches to its box
function Spark({ values, area = false, className = "text-primary", height = 28 }) {
    if (!values || values.length < 2) return <div style={{ height }} />;
    const max = Math.max(...values);
    const min = Math.min(...values);
    const span = max - min || 1;
    const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 36 - ((v - min) / span) * 32 - 2]);
    const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
    return (
        <svg viewBox="0 0 100 36" preserveAspectRatio="none" className="w-full" style={{ height, color: GC.red }}>
            {area && <path d={`${line} L100,36 L0,36 Z`} fill={GC.redFill} />}
            <path d={line} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>
    );
}

// Axis chart — measured to its box so text never stretches. Fills parent (flex-1).
function AxisChart({ values, xLabels = [], area = true, minHeight = 140, fmtY = (v) => v, yMin = 0, yMax, limit, limitLabel, avg, avgLabel, ticks = 4 }) {
    const ref = useRef(null);
    const [box, setBox] = useState({ w: 0, h: 0 });
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const ro = new ResizeObserver(([e]) => setBox({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) }));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    const ok = values && values.length >= 2 && box.w > 40 && box.h > 40;
    const W = box.w;
    const H = box.h;
    const padL = 34;
    const padR = 8;
    const padT = 12;
    const padB = 20;
    const top = Math.max(yMax ?? 0, limit ?? 0, ...(values || [0]), avg ?? 0) || 1;
    const sx = (i) => padL + (i / (values.length - 1)) * (W - padL - padR);
    const sy = (v) => padT + (1 - (v - yMin) / (top - yMin || 1)) * (H - padT - padB);
    let body = null;
    if (ok) {
        const pts = values.map((v, i) => [sx(i), sy(v)]);
        const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
        const grid = Array.from({ length: ticks + 1 }, (_, i) => yMin + ((top - yMin) / ticks) * i);
        const last = pts[pts.length - 1];
        body = (
            <svg width={W} height={H} className="block" style={{ color: GC.red }}>
                {grid.map((g, i) => (
                    <g key={i}>
                        <line x1={padL} x2={W - padR} y1={sy(g)} y2={sy(g)} stroke={GC.grid} />
                        <text
                            paintOrder="stroke"
                            stroke="var(--color-base-200)"
                            strokeWidth="3"
                            strokeLinejoin="round"
                            x={padL - 6}
                            y={sy(g) + 3}
                            textAnchor="end"
                            fontSize="11"
                            className="fill-base-content"
                            opacity="0.85">
                            {fmtY(g)}
                        </text>
                    </g>
                ))}
                {limit != null && (
                    <g style={{ color: GC.red }}>
                        <line x1={padL} x2={W - padR} y1={sy(limit)} y2={sy(limit)} stroke="currentColor" strokeDasharray="5 4" />
                        {limitLabel && (
                            <text
                                paintOrder="stroke"
                                stroke="var(--color-base-200)"
                                strokeWidth="3"
                                strokeLinejoin="round"
                                x={W - padR}
                                y={sy(limit) + 12}
                                textAnchor="end"
                                fontSize="11"
                                fill="currentColor">
                                {limitLabel}
                            </text>
                        )}
                    </g>
                )}
                {avg != null && (
                    <g>
                        <line x1={padL} x2={W - padR} y1={sy(avg)} y2={sy(avg)} stroke={GC.g3} strokeDasharray="3 3" />
                        {avgLabel && (
                            <text
                                paintOrder="stroke"
                                stroke="var(--color-base-200)"
                                strokeWidth="3"
                                strokeLinejoin="round"
                                x={W - padR}
                                y={sy(avg) - 4}
                                textAnchor="end"
                                fontSize="11"
                                className="fill-base-content"
                                opacity="0.85">
                                {avgLabel}
                            </text>
                        )}
                    </g>
                )}
                {area && <path d={`${line} L${last[0]},${H - padB} L${pts[0][0]},${H - padB} Z`} fill={GC.redFill} />}
                <path d={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                <circle cx={last[0]} cy={last[1]} r="4" fill={GC.red} stroke={GC.ink} strokeWidth="2" />
                {xLabels.map(([idx, label], i) => (
                    <text key={i} x={sx(idx)} y={H - 5} textAnchor={idx === 0 ? "start" : idx >= values.length - 1 ? "end" : "middle"} fontSize="11" className="fill-base-content" opacity="0.85">
                        {label}
                    </text>
                ))}
            </svg>
        );
    }
    return (
        <div ref={ref} className="flex-1 w-full overflow-hidden" style={{ minHeight }}>
            {body}
        </div>
    );
}

function Donut({ segments, size = 96, stroke = 12, children }) {
    const total = segments.reduce((a, s) => a + s.value, 0);
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    let offset = 0;
    return (
        <div className="relative shrink-0" style={{ width: size, height: size }}>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
                <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={GC.track} strokeWidth={stroke} />
                {total > 0 &&
                    segments.map((s, i) => {
                        const len = (s.value / total) * c;
                        const el = (
                            <circle
                                key={i}
                                cx={size / 2}
                                cy={size / 2}
                                r={r}
                                fill="none"
                                stroke={s.color || "transparent"}
                                strokeWidth={stroke}
                                strokeDasharray={`${Math.max(0, len - 1.5)} ${c - Math.max(0, len - 1.5)}`}
                                strokeDashoffset={-offset}
                            />
                        );
                        offset += len;
                        return el;
                    })}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
        </div>
    );
}

function Dots({ online, total }) {
    return (
        <div className="flex items-center gap-1">
            {Array.from({ length: total }).map((_, i) => (
                <span key={i} className={`h-1 w-3.5 rounded-full ${i < online ? "bg-success" : "bg-error"}`} />
            ))}
        </div>
    );
}

function KpiCard({ icon: Icon, label, tone = "text-primary", children }) {
    return (
        <div className="bg-base-200 px-4 py-3 min-w-0">
            <div className="flex items-center gap-2">
                <span className={`flex h-5.5 w-5.5 items-center justify-center rounded-md bg-base-300 ${tone}`}>
                    <Icon size={12} className="shrink-0" />
                </span>
                <p className="text-xs font-medium text-base-content/85 truncate">{label}</p>
            </div>
            <div className="mt-2">{children}</div>
        </div>
    );
}

function Th({ children, className = "" }) {
    return <th className={`px-3 py-3.5 text-xs font-semibold text-base-content/85 text-left align-middle whitespace-nowrap overflow-hidden text-ellipsis ${className}`}>{children}</th>;
}

// ─── Table skeletons ──────────────────────────────────────────────────────────
function SkeletonRow({ cols }) {
    return (
        <tr className="border-b border-base-300">
            {Array.from({ length: cols }).map((_, i) => (
                <td key={i} className="px-3 py-4">
                    <div className="h-3 rounded bg-base-content/8 animate-pulse w-3/4" />
                </td>
            ))}
        </tr>
    );
}

// ─── Insights — derived client-side from the real media list ──────────────────
// Library endpoint only returns label/path/status/fileCount/sizeBytes. Everything
// else (quality, runtime, metadata %, posters, growth, activity) is computed here
// from /api/media + /api/metadata/enriched so charts have real data.
const QUALITY_KEYS = ["4K", "1080p", "720p", "SD"];
const DAY = 86400000;
const VIDEO_RE = /\.(mkv|mp4|avi|mov|wmv|webm|m4v|ts|flv|mpg|mpeg)$/i;

function flattenItems(node, out = [], depth = 0) {
    if (!node || depth > 6 || typeof node !== "object") return out;
    if (Array.isArray(node)) {
        node.forEach((n) => flattenItems(n, out, depth + 1));
        return out;
    }
    const p = node.path || node.filePath || node.file;
    if (typeof p === "string" && VIDEO_RE.test(p)) {
        out.push(node);
        return out;
    }
    Object.values(node).forEach((v) => v && typeof v === "object" && flattenItems(v, out, depth + 1));
    return out;
}

const normPath = (p) =>
    String(p || "")
        .replace(/\\/g, "/")
        .replace(/\/+$/, "")
        .toLowerCase();

function qualityOf(it, name) {
    const h = Number(it.height ?? it.video?.height ?? it.resolutionHeight ?? 0);
    if (h) return h >= 2000 ? "4K" : h >= 1000 ? "1080p" : h >= 700 ? "720p" : "SD";
    const s = String(it.resolution || it.quality || name || "").toLowerCase();
    if (/2160p|\b4k\b|uhd/.test(s)) return "4K";
    if (/1080[pi]|fhd/.test(s)) return "1080p";
    if (/720p/.test(s)) return "720p";
    if (/480p|360p|dvdrip|dvdscr|hdcam|\bcam\b/.test(s)) return "SD";
    return null; // unknown — not guessed
}

function codecOf(it, name) {
    const s = String(it.codec || it.video?.codec || name || "").toLowerCase();
    if (/hevc|x265|h\.?265/.test(s)) return "HEVC";
    if (/\bav1\b/.test(s)) return "AV1";
    if (/xvid|divx/.test(s)) return "XviD";
    if (/x264|h\.?264|avc/.test(s)) return "H.264";
    return null;
}

function posterOf(it) {
    const v = it.poster || it.posterUrl || it.poster_path || it.metadata?.poster || it.metadata?.posterUrl || it.metadata?.poster_path || it.tmdb?.poster_path || null;
    if (typeof v !== "string" || !v) return null;
    if (/^(https?:|data:)/.test(v)) return v;
    if (/^\/[\w-]{10,}\.(jpg|jpeg|png|webp)$/i.test(v)) return `https://image.tmdb.org/t/p/w185${v}`;
    return null;
}

function buildInsights(libs, items) {
    const now = Date.now();
    const sorted = [...libs].sort((a, b) => normPath(b.path).length - normPath(a.path).length);
    const per = {};
    libs.forEach((l) => (per[l.id] = { files: 0, size: 0, runtimeSec: 0, runtimeN: 0, qc: {}, matched: 0, codecs: {}, posters: [], dated: [] }));
    const all = { dated: 0, total: 0, days: new Array(84).fill(0), dated2: [] };

    const seen = new Set();
    items.forEach((it) => {
        const p = it.path || it.filePath || it.file;
        const key = it.id || p;
        if (seen.has(key)) return;
        seen.add(key);
        const np = normPath(p);
        const lib = sorted.find((l) => (it.libraryId ?? it.folderId) === l.id) || sorted.find((l) => {
            if (!l.path) return false;
            const lp = normPath(l.path);
            return np === lp || np.startsWith(lp + "/"); // directory boundary: /media/Movies must not claim /media/Movies2/…
        });
        if (!lib) return;
        const b = per[lib.id];
        const name = it.name || it.filename || String(p).split(/[\\/]/).pop();
        const size = Number(it.size ?? it.sizeBytes ?? 0) || 0;
        const t = new Date(it.mtime ?? it.modified ?? it.addedAt ?? it.createdAt ?? it.birthtime ?? NaN).getTime();
        const dur = Number(it.duration ?? it.durationSec ?? 0) || (Number(it.metadata?.runtime ?? it.tmdb?.runtime ?? it.runtime ?? 0) || 0) * 60;
        b.files++;
        b.size += size;
        if (dur > 0) {
            b.runtimeSec += dur;
            b.runtimeN++;
        }
        const q = qualityOf(it, name);
        if (q) b.qc[q] = (b.qc[q] || 0) + 1;
        const c = codecOf(it, name);
        if (c) b.codecs[c] = (b.codecs[c] || 0) + 1;
        const poster = posterOf(it);
        if (poster || it.tmdbId || it.metadata?.tmdbId || it.tmdb) b.matched++;
        all.total++;
        if (!isNaN(t)) {
            all.dated++;
            all.dated2.push({ t, size, lib: lib.id });
            b.dated.push({ t, size });
            if (poster) b.posters.push({ t, poster });
            const d = Math.floor((now - t) / DAY);
            if (d >= 0 && d < 84) all.days[83 - d]++;
        } else if (poster) b.posters.push({ t: 0, poster });
    });

    const hasDates = all.total > 0 && all.dated / all.total > 0.5;
    const cum = (arr, w) => {
        const cut = now - w * 7 * DAY;
        return arr.reduce((a, x) => (x.t <= cut ? a + x.size : a), 0);
    };
    const weekly = hasDates ? Array.from({ length: 13 }, (_, i) => ({ date: now - (12 - i) * 7 * DAY, bytes: cum(all.dated2, 12 - i) })) : null;

    const out = {};
    libs.forEach((l) => {
        const b = per[l.id];
        const top = Object.entries(b.qc).sort((x, y) => y[1] - x[1])[0]?.[0] || null;
        const topCodec = Object.entries(b.codecs).sort((x, y) => y[1] - x[1])[0]?.[0] || null;
        const g = hasDates && b.dated.length ? Array.from({ length: 13 }, (_, i) => cum(b.dated, 12 - i)) : null;
        const posters = [];
        const seenP = new Set();
        b.posters
            .sort((x, y) => y.t - x.t)
            .forEach((x) => {
                if (posters.length < 6 && !seenP.has(x.poster)) {
                    seenP.add(x.poster);
                    posters.push(x.poster);
                }
            });
        out[l.id] = {
            has: b.files > 0,
            runtimeH: b.runtimeN > 0 ? Math.round(b.runtimeSec / 3600) : null,
            qc: Object.keys(b.qc).length ? b.qc : null,
            quality: top,
            codec: topCodec,
            matched: b.files > 0 ? b.matched : null,
            files: b.files,
            posters,
            growth: g,
            growthBytes: g ? g[g.length - 1] - g[0] : null,
            lastAdded: b.dated.length ? Math.max(...b.dated.map((x) => x.t)) : null,
        };
    });
    return {
        per: out,
        weekly,
        growthPerWeek: weekly ? (weekly[12].bytes - weekly[0].bytes) / 12 : null,
        filesAdded: hasDates ? all.days.slice(-30) : null,
        activity: hasDates ? all.days : null,
    };
}

// scan timings are measured in this browser (server has no scan history yet)
const SCAN_KEY = "flux.libraries.scanSeconds";
function readScans() {
    try {
        const v = JSON.parse(localStorage.getItem(SCAN_KEY) || "[]");
        return Array.isArray(v) ? v : [];
    } catch {
        return [];
    }
}
function pushScan(sec) {
    try {
        localStorage.setItem(SCAN_KEY, JSON.stringify([...readScans(), Math.round(sec * 10) / 10].slice(-14)));
    } catch {}
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function DashLibraries() {
    const [tab, setTab] = useState("local");

    const [raw, setRaw] = useState(null); // full dashApi.libraries() payload
    const [libs, setLibs] = useState([]);
    const [items, setItems] = useState([]);
    const [scans, setScans] = useState(readScans);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // local table controls
    const [filter, setFilter] = useState("all"); // all | online | offline
    const [query, setQuery] = useState("");
    const [rowsPer, setRowsPer] = useState(10);
    const [page, setPage] = useState(1);

    // cloud
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

    // load cloud count up-front so the tab badge is correct; table still lazy-renders
    useEffect(() => {
        if (!cloudLoaded) loadCloud();
    }, [cloudLoaded, loadCloud]);

    async function handleCloudRescan(lib) {
        setCloudRescanning((r) => ({ ...r, [lib.id]: true }));
        await loadCloud();
        setCloudRescanning((r) => ({ ...r, [lib.id]: false }));
    }

    const cloudTotalFiles = cloudLibs.reduce((a, l) => a + (l.fileCount || 0), 0);
    const cloudTotalSize = cloudLibs.reduce((a, l) => a + (l.sizeBytes || 0), 0);

    // modals
    const [detailLib, setDetailLib] = useState(null);
    const [editLib, setEditLib] = useState(null);
    const [removeLib, setRemoveLib] = useState(null);
    const [rescanning, setRescanning] = useState({});
    const [toast, setToast] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await dashApi.libraries();
            setRaw(data || null);
            setLibs(data?.libraries ?? []);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
        // media list → insights. Best effort: table still works if these fail.
        try {
            const [m, e] = await Promise.allSettled([api.get("/api/media"), api.get("/api/metadata/enriched")]);
            const list = [];
            if (m.status === "fulfilled") flattenItems(m.value, list);
            if (e.status === "fulfilled") flattenItems(e.value, list);
            // enriched copies come last; later entries win on merge
            const byKey = new Map();
            list.forEach((it) => {
                const k = it.id || it.path || it.filePath || it.file;
                byKey.set(k, { ...(byKey.get(k) || {}), ...it });
            });
            setItems([...byKey.values()]);
        } catch {
            setItems([]);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    // ── Normalised rows — every optional field falls back safely ──────────────
    const insights = useMemo(() => buildInsights(libs, items), [libs, items]);

    const rows = useMemo(() => {
        const totalSize = libs.reduce((a, l) => a + (l.sizeBytes ?? 0), 0);
        return libs.map((l0) => {
            const ins = insights.per[l0.id] || {};
            // server fields win; derived insights fill the gaps
            const l = {
                ...l0,
                runtimeHours: l0.runtimeHours ?? ins.runtimeH,
                quality: l0.quality ?? ins.quality,
                codec: l0.codec ?? ins.codec,
                qualityCounts: l0.qualityCounts ?? ins.qc,
                metadataMatched: l0.metadataMatched ?? ins.matched,
                // a file's mtime is NOT a scan time — keep "last scan" unknown unless the server says so; file activity is separate
                lastScan: l0.lastScan ?? l0.scannedAt ?? l0.lastScanned ?? null,
                lastFileActivity: ins.lastAdded ? new Date(ins.lastAdded).toISOString() : null,
                posters: l0.posters ?? ins.posters,
                growth: l0.growth ?? ins.growth,
                growthBytes: l0.growthBytes ?? ins.growthBytes,
            };
            const files = l.fileCount ?? 0;
            const size = l.sizeBytes ?? 0;
            const matched = l.metadataMatched ?? l.matchedCount ?? null;
            const matchPct = l.metadataPct ?? (matched != null && files > 0 ? Math.min(100, Math.round((matched / files) * 100)) : null);
            const qc = l.qualityCounts || null;
            const topQuality = qc ? Object.entries(qc).sort((a, b) => b[1] - a[1])[0]?.[0] : null;
            return {
                ...l,
                _type: guessType(l),
                _online: l.status === "online",
                _files: files,
                _size: size,
                _avg: files > 0 ? size / files : 0,
                _share: totalSize > 0 ? Math.round((size / totalSize) * 100) : 0,
                _runtimeH: l.runtimeHours ?? (l.runtimeMinutes != null ? Math.round(l.runtimeMinutes / 60) : l.runtimeSeconds != null ? Math.round(l.runtimeSeconds / 3600) : null),
                _quality: [l.quality || topQuality, l.codec].filter(Boolean).join(" · ") || "—",
                _matched: matched,
                _matchPct: matchPct,
                _lastScan: l.lastScan ?? l.scannedAt ?? l.lastScanned ?? null,
                _added: l.addedAt ?? l.createdAt ?? null,
                _drive: guessDrive(l),
                _driveTotal: l.driveTotalBytes ?? l.diskTotalBytes ?? null,
                _driveFree: l.driveFreeBytes ?? l.diskFreeBytes ?? null,
                _qc: qc,
                _growth: Array.isArray(l.growth) ? l.growth : null,
                _posters: Array.isArray(l.posters) ? l.posters : [],
            };
        });
    }, [libs, insights]);

    // ── Aggregates ────────────────────────────────────────────────────────────
    const totalFiles = rows.reduce((a, l) => a + l._files, 0);
    const totalSize = rows.reduce((a, l) => a + l._size, 0);
    const onlineCount = rows.filter((l) => l._online).length;
    const offlineCount = rows.length - onlineCount;
    const offlineLibs = rows.filter((l) => !l._online);
    const runtimeTotalH = rows.some((l) => l._runtimeH != null) ? rows.reduce((a, l) => a + (l._runtimeH || 0), 0) : null;
    const avgFile = totalFiles > 0 ? totalSize / totalFiles : 0;
    const diskTotal = raw?.diskTotalBytes ?? (rows.length && rows.every((l) => l._driveTotal) ? rows.reduce((a, l) => a + l._driveTotal, 0) : null);
    const diskPct = diskTotal ? Math.round((totalSize / diskTotal) * 100) : null;
    const growthPerWeek = raw?.growthPerWeekBytes ?? insights.growthPerWeek ?? null;
    const weeksToFull = diskTotal && growthPerWeek > 0 ? Math.max(0, (diskTotal - totalSize) / growthPerWeek) : null;
    const largest = rows.reduce((m, l) => (!m || l._size > m._size ? l : m), null);
    const addedThisMonth = rows.filter((l) => {
        const d = l._added ? new Date(l._added) : null;
        const n = new Date();
        return d && !isNaN(d) && d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
    }).length;

    const filesAdded = Array.isArray(raw?.filesAdded) ? raw.filesAdded : insights.filesAdded; // daily counts
    const growthSeries = Array.isArray(raw?.growth) ? raw.growth : insights.weekly; // [{date, bytes}]
    const scanActivity = Array.isArray(raw?.scanActivity) ? raw.scanActivity : insights.activity; // 84 numbers, week-major
    const scanDurations = Array.isArray(raw?.scanDurations) ? raw.scanDurations : scans.length > 1 ? scans.map((x) => x / 60) : null; // minutes

    const qualityTotals = useMemo(() => {
        const out = {};
        rows.forEach((l) => l._qc && Object.entries(l._qc).forEach(([k, v]) => (out[k] = (out[k] || 0) + v)));
        return raw?.qualityCounts || out;
    }, [rows, raw]);
    const qualityKeys = ["4K", "1080p", "720p", "SD"];
    const hasQuality = qualityKeys.some((k) => qualityTotals[k] > 0);

    const matchedTotal = rows.reduce((a, l) => a + (l._matched ?? 0), 0);
    const hasMatch = rows.some((l) => l._matched != null);
    const matchOverall = hasMatch && totalFiles > 0 ? Math.round((matchedTotal / totalFiles) * 100) : null;
    const unmatched = hasMatch ? Math.max(0, totalFiles - matchedTotal) : null;
    const sdCount = qualityTotals.SD || 0;

    // ── Filtering + paging ────────────────────────────────────────────────────
    const filtered = rows.filter((l) => {
        if (filter === "online" && !l._online) return false;
        if (filter === "offline" && l._online) return false;
        const q = query.trim().toLowerCase();
        if (q && !((l.label || "").toLowerCase().includes(q) || (l.path || "").toLowerCase().includes(q))) return false;
        return true;
    });
    const pageCount = Math.max(1, Math.ceil(filtered.length / rowsPer));
    const curPage = Math.min(page, pageCount);
    const pageRows = filtered.slice((curPage - 1) * rowsPer, curPage * rowsPer);
    const fromN = filtered.length === 0 ? 0 : (curPage - 1) * rowsPer + 1;
    const toN = Math.min(curPage * rowsPer, filtered.length);

    useEffect(() => setPage(1), [filter, query, rowsPer]);

    // handlers
    function handleSaved(updated) {
        setLibs((prev) => prev.map((l) => (l.id === updated.id ? { ...l, ...updated } : l)));
    }
    function handleRemoved(id) {
        setLibs((prev) => prev.filter((l) => l.id !== id));
    }
    async function handleRescan(lib) {
        setRescanning((r) => ({ ...r, [lib.id]: true }));
        const t0 = Date.now();
        try {
            if (await triggerRescan(lib.label, setToast)) {
                pushScan((Date.now() - t0) / 1000); // only a SUCCESSFUL scan enters the duration history
                setScans(readScans());
            }
        } finally {
            setRescanning((r) => ({ ...r, [lib.id]: false })); // spinner clears on either outcome
        }
    }
    async function handleScanAll() {
        setRescanning((r) => ({ ...r, __all: true }));
        const t0 = Date.now();
        try {
            if (await triggerRescan("all libraries", setToast)) {
                pushScan((Date.now() - t0) / 1000);
                setScans(readScans());
            }
        } finally {
            setRescanning((r) => ({ ...r, __all: false }));
        }
        load();
    }

    const monthLabel = new Date().toLocaleDateString("en-US", { month: "long" });

    return (
        <>
            {/* modals */}
            {detailLib && (
                <LibraryDetailModal
                    lib={detailLib}
                    totalSize={totalSize}
                    onClose={() => setDetailLib(null)}
                    onEdit={(lib) => {
                        setDetailLib(null);
                        setEditLib(lib);
                    }}
                />
            )}
            {editLib && <LibraryEditModal lib={editLib} onClose={() => setEditLib(null)} onSaved={handleSaved} />}
            {removeLib && <LibraryRemoveModal lib={removeLib} onClose={() => setRemoveLib(null)} onRemoved={handleRemoved} />}
            {cloudRemoveLib && <LibraryRemoveModal cloud lib={cloudRemoveLib} onClose={() => setCloudRemoveLib(null)} onRemoved={(id) => setCloudLibs((prev) => prev.filter((l) => l.id !== id))} />}
            <Toast toast={toast} />

            <div className="space-y-5">
                {/* ── header ─────────────────────────────────────────────── */}
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h1 className="text-2xl font-bold text-base-content tracking-tight">Libraries</h1>
                        <p className="text-sm text-base-content/80 mt-1">Media folders FLUX scans, with storage, quality and scan health.</p>
                    </div>
                    <div className="flex gap-2">
                        {tab === "local" ? (
                            <>
                                <button
                                    onClick={handleScanAll}
                                    disabled={loading || !!rescanning.__all}
                                    className="btn btn-sm btn-ghost border border-base-300 bg-base-200 gap-1.5 disabled:opacity-50">
                                    <RefreshCw size={12} className={rescanning.__all || loading ? "animate-spin" : ""} />
                                    Scan all
                                </button>
                                <Link to="/settings" className="btn btn-sm btn-primary gap-1.5 border-none">
                                    <Plus size={13} />
                                    Add library
                                </Link>
                            </>
                        ) : (
                            <>
                                <button onClick={loadCloud} disabled={cloudLoading} className="btn btn-sm btn-ghost border border-base-300 bg-base-200 gap-1.5 disabled:opacity-50">
                                    <RefreshCw size={12} className={cloudLoading ? "animate-spin" : ""} />
                                    Refresh
                                </button>
                                <Link to="/dashboard/storage" className="btn btn-sm btn-primary gap-1.5 border-none">
                                    <Cloud size={12} />
                                    Import Cloud Library
                                </Link>
                            </>
                        )}
                    </div>
                </div>

                {/* ── offline banner ─────────────────────────────────────── */}
                {tab === "local" && offlineLibs.length > 0 && (
                    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-error/30 bg-error/8 px-4 py-2.5 text-sm">
                        <AlertTriangle size={15} className="text-error shrink-0" />
                        <p className="flex-1 min-w-0 text-base-content/80">
                            <span className="font-bold text-base-content">
                                {offlineLibs[0].label || "Library"}
                                {offlineLibs.length > 1 ? ` +${offlineLibs.length - 1} more are` : " is"} offline.
                            </span>{" "}
                            The path <span className="font-mono text-xs text-base-content/85">{offlineLibs[0].path}</span> has been unreachable
                            {offlineLibs[0]._lastScan ? ` since ${fmtShortDate(offlineLibs[0]._lastScan)}` : ""}. Check the drive or NAS is on and mounted.
                        </p>
                        <button onClick={load} className="btn btn-xs btn-outline btn-error rounded-md">
                            Retry connection
                        </button>
                    </div>
                )}

                {error && tab === "local" && (
                    <div className="alert alert-error shadow-sm text-sm">
                        <AlertTriangle size={15} />
                        <span>{error}</span>
                    </div>
                )}

                {/* ── KPI cards ──────────────────────────────────────────── */}
                {tab === "local" && (
                    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-px overflow-hidden rounded-lg border border-base-300 bg-base-300">
                        <KpiCard icon={Layers} label="Libraries" tone="text-base-content/85">
                            <p className="text-xl font-bold tabular-nums leading-none">{loading ? "—" : rows.length}</p>
                            <div className="mt-2 flex items-center justify-between gap-2">
                                <p className="text-xs text-success truncate">{addedThisMonth > 0 ? `+${addedThisMonth} added in ${monthLabel}` : "No new libraries this month"}</p>
                            </div>
                        </KpiCard>

                        <KpiCard icon={FileVideo} label="Total files" tone="text-base-content/85">
                            <div className="flex items-end justify-between gap-2">
                                <p className="text-xl font-bold tabular-nums leading-none">{loading ? "—" : fmtNum(totalFiles)}</p>
                                <div className="w-16 shrink-0">
                                    <Spark values={filesAdded} />
                                </div>
                            </div>
                            <p className="mt-2 text-xs text-success truncate">{filesAdded ? `+${fmtNum(filesAdded.slice(-7).reduce((a, b) => a + b, 0))} this week` : "Across all libraries"}</p>
                        </KpiCard>

                        <KpiCard icon={Database} label="Storage used" tone="text-base-content/85">
                            <div className="flex items-center justify-between gap-2">
                                <p className="text-xl font-bold tabular-nums leading-none">
                                    {loading ? "—" : tbOf(totalSize)} <span className="text-xs font-semibold text-base-content/80">TB</span>
                                </p>
                                {diskPct != null && (
                                    <Donut
                                        size={30}
                                        stroke={5}
                                        segments={[
                                            { value: diskPct, color: GC.red },
                                            { value: Math.max(0, 100 - diskPct), color: "transparent" },
                                        ]}
                                    />
                                )}
                            </div>
                            <p className="mt-2 text-xs text-base-content/80 truncate">{diskTotal ? `${diskPct}% of ${tbOf(diskTotal)} TB` : "Disk size unknown"}</p>
                        </KpiCard>

                        <KpiCard icon={Clock} label="Total runtime" tone="text-base-content/85">
                            <p className="text-xl font-bold tabular-nums leading-none">
                                {loading || runtimeTotalH == null ? "—" : fmtNum(runtimeTotalH)} <span className="text-xs font-semibold text-base-content/80">h</span>
                            </p>
                            <p className="mt-2 text-xs text-base-content/80 truncate">{runtimeTotalH != null ? `About ${Math.round(runtimeTotalH / 24)} days of video` : "No runtime data"}</p>
                        </KpiCard>

                        <KpiCard icon={FileIcon} label="Avg file size" tone="text-base-content/85">
                            <p className="text-xl font-bold tabular-nums leading-none">
                                {loading ? "—" : (avgFile / GB).toFixed(1)} <span className="text-xs font-semibold text-base-content/80">GB</span>
                            </p>
                            <p className="mt-2 text-xs text-base-content/80 truncate">{raw?.largestFileBytes ? `Largest file ${(raw.largestFileBytes / GB).toFixed(1)} GB` : "Per video file"}</p>
                        </KpiCard>

                        <KpiCard icon={Activity} label="Health" tone="text-success">
                            <p className="text-xl font-bold tabular-nums leading-none">
                                {loading ? "—" : onlineCount} <span className="text-xs font-semibold text-base-content/80">of {rows.length}</span>
                            </p>
                            <div className="mt-2">{!loading && <Dots online={onlineCount} total={rows.length} />}</div>
                            <p className={`mt-1.5 text-xs truncate ${offlineCount > 0 ? "text-error" : "text-success"}`}>{offlineCount > 0 ? `${offlineCount} offline` : "All online"}</p>
                        </KpiCard>
                    </div>
                )}

                {/* ── main table card ────────────────────────────────────── */}
                <Panel>
                    {/* toolbar */}
                    <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 pb-3">
                        <div className="flex bg-base-300 rounded-lg p-0.5 gap-0.5 border border-base-300">
                            <button
                                onClick={() => setTab("local")}
                                className={`px-3 py-1.5 rounded-md text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer border-none ${
                                    tab === "local" ? "bg-primary text-primary-content shadow-sm" : "text-base-content/80 hover:text-base-content hover:bg-base-content/5"
                                }`}>
                                <HardDrive size={13} /> Local
                                <span className={`rounded px-1.5 text-[11px] ${tab === "local" ? "bg-black/20" : "bg-base-content/10"}`}>{rows.length}</span>
                            </button>
                            <button
                                onClick={() => setTab("cloud")}
                                className={`px-3 py-1.5 rounded-md text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer border-none ${
                                    tab === "cloud" ? "bg-primary text-primary-content shadow-sm" : "text-base-content/80 hover:text-base-content hover:bg-base-content/5"
                                }`}>
                                <Cloud size={13} /> Cloud
                                <span className={`rounded px-1.5 text-[11px] ${tab === "cloud" ? "bg-black/20" : "bg-base-content/10"}`}>{cloudLibs.length}</span>
                            </button>
                        </div>

                        {tab === "local" && (
                            <div className="flex flex-wrap items-center gap-2">
                                {[
                                    { k: "all", label: `All ${rows.length}`, on: "bg-base-content/15 text-base-content border-base-300", off: "" },
                                    { k: "online", label: `Online ${onlineCount}`, on: "bg-success/15 text-success border-success/40", off: "text-success border-success/30" },
                                    { k: "offline", label: `Offline ${offlineCount}`, on: "bg-error/15 text-error border-error/40", off: "text-error border-error/30" },
                                ].map((f) => (
                                    <button
                                        key={f.k}
                                        onClick={() => setFilter(f.k)}
                                        className={`px-2.5 py-1 rounded-md text-xs font-semibold border cursor-pointer transition-colors ${
                                            filter === f.k ? f.on : `border-base-300 text-base-content/80 hover:bg-base-content/5 ${f.off}`
                                        }`}>
                                        {f.label}
                                    </button>
                                ))}
                                <label className="input input-sm bg-base-300 border-base-300 flex items-center gap-2 w-56 max-w-full">
                                    <Search size={13} className="text-base-content/70" />
                                    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or path" className="grow text-xs" />
                                </label>
                            </div>
                        )}
                    </div>

                    {tab === "local" ? (
                        <>
                            {/* Grid, not <table>: every column is as wide as its content needs and the spare width is split
                                equally between columns (justify-between). Rows are subgrids so they still align. No scroll. */}
                            <div className="grid w-full border-t border-base-300 text-[13px] gap-x-5 justify-between [grid-template-columns:repeat(13,minmax(0,max-content))]">
                                <div className="col-span-full grid grid-cols-subgrid items-center bg-base-300 px-4">
                                    {["SL", "Library", "Status", "Drive", "Files", "Avg size", "Storage", "Share", "Runtime", "Quality", "Last scan", "Added", "Actions"].map((h) => (
                                        <div key={h} className={`min-w-0 truncate py-3.5 text-xs font-semibold text-base-content/85 ${h === "Actions" ? "text-right" : ""}`}>
                                            {h}
                                        </div>
                                    ))}
                                </div>

                                {loading ? (
                                    [...Array(4)].map((_, r) => (
                                        <div key={r} className="col-span-full grid grid-cols-subgrid items-center border-t border-base-300 px-4">
                                            {Array.from({ length: 13 }).map((__, c) => (
                                                <div key={c} className="py-4">
                                                    <div className="h-3 w-10 rounded bg-base-300 animate-pulse" />
                                                </div>
                                            ))}
                                        </div>
                                    ))
                                ) : pageRows.length === 0 ? (
                                    <div className="col-span-full border-t border-base-300">
                                        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
                                            <div className="w-14 h-14 rounded-2xl bg-base-300 flex items-center justify-center">
                                                <HardDrive size={26} className="text-base-content/25" />
                                            </div>
                                            <div className="max-w-xs">
                                                <p className="font-semibold text-base-content/80">{rows.length === 0 ? "No libraries configured" : "No libraries match"}</p>
                                                <p className="text-[13px] text-base-content/70 mt-1.5 leading-relaxed">
                                                    {rows.length === 0 ? (
                                                        <>
                                                            Libraries are folders FLUX scans for video files. Add one via <span className="font-medium text-base-content/80">Settings → Library</span>.
                                                        </>
                                                    ) : (
                                                        "Try a different filter or search."
                                                    )}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    pageRows.map((lib, i) => {
                                        const { label: typeLabel, Icon, barClass } = lib._type;
                                        const online = lib._online;
                                        const dropUp = pageRows.length > 3 && i >= pageRows.length - 2;
                                        const cell = "min-w-0 py-3.5 flex items-center font-medium text-base-content";
                                        return (
                                            <div
                                                key={lib.id}
                                                onClick={() => setDetailLib(lib)}
                                                className={`col-span-full grid grid-cols-subgrid items-center border-t border-base-300 px-4 cursor-pointer transition-colors ${online ? "hover:bg-base-300/50" : "bg-error/5 hover:bg-error/10"}`}>
                                                <div className={`${cell} font-mono tabular-nums text-base-content/70`}>{(curPage - 1) * rowsPer + i + 1}</div>

                                                <div className={`${cell} gap-2.5`}>
                                                    <div className="w-8 h-8 rounded-lg bg-base-300 border border-base-300 flex items-center justify-center shrink-0">
                                                        <Icon size={14} className={online ? "text-base-content/80" : "text-base-content/60"} />
                                                    </div>
                                                    <div className="min-w-0 max-w-56 leading-tight">
                                                        <div className="truncate font-semibold text-sm" title={lib.label}>
                                                            {lib.label || "Unnamed Library"}
                                                        </div>
                                                        <div className="truncate text-xs text-base-content/70 mt-0.5">{typeLabel}</div>
                                                    </div>
                                                </div>

                                                <div className={cell}>
                                                    <span
                                                        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-xs font-semibold ${online ? "border-success/30 bg-success/10 text-success" : "border-error/30 bg-error/10 text-error"}`}>
                                                        <span className={`w-1.5 h-1.5 rounded-full ${online ? "bg-success" : "bg-error"}`} />
                                                        {online ? "Online" : "Offline"}
                                                    </span>
                                                </div>

                                                <div className={cell} title={lib.path}>
                                                    <span className="truncate max-w-28">{lib._drive}</span>
                                                </div>

                                                <div className={`${cell} tabular-nums`}>{fmtNum(lib._files)}</div>

                                                <div className={`${cell} tabular-nums whitespace-nowrap`}>{`${(lib._avg / GB).toFixed(2)} GB`}</div>

                                                <div className={`${cell} tabular-nums whitespace-nowrap font-semibold`}>{lib.size || fmtBytes(lib._size)}</div>

                                                <div className={`${cell} gap-2`}>
                                                    <progress className={`progress h-1.5 w-14 shrink-0 ${online ? barClass : "progress-error"}`} value={lib._share} max="100" />
                                                    <span className="text-xs font-semibold tabular-nums text-base-content/85 w-8">{lib._share}%</span>
                                                </div>

                                                <div className={`${cell} tabular-nums whitespace-nowrap`}>{lib._runtimeH != null ? `${fmtNum(lib._runtimeH)} h` : "—"}</div>

                                                <div className={cell} title={lib._quality}>
                                                    <span className="truncate max-w-40">{lib._quality}</span>
                                                </div>

                                                <div className={`${cell} tabular-nums whitespace-nowrap ${online ? "" : "text-error font-semibold"}`}>{timeAgo(lib._lastScan)}</div>

                                                <div className={`${cell} tabular-nums whitespace-nowrap`}>{fmtIso(lib._added)}</div>

                                                <div className={`${cell} justify-end gap-0.5`} onClick={(e) => e.stopPropagation()}>
                                                    <ActionBtn icon={RotateCcw} title="Rescan library" onClick={() => handleRescan(lib)} spinning={!!rescanning[lib.id]} />
                                                    <div className={`dropdown dropdown-end ${dropUp ? "dropdown-top" : ""}`}>
                                                        <button
                                                            tabIndex={0}
                                                            title="More"
                                                            className="btn btn-ghost btn-xs btn-square rounded-md border-none text-base-content/80 hover:text-base-content hover:bg-base-content/10">
                                                            <MoreHorizontal size={14} />
                                                        </button>
                                                        <ul tabIndex={0} className="dropdown-content menu menu-sm z-30 w-40 rounded-xl bg-base-300 border border-base-300 p-1.5 shadow-lg">
                                                            <li>
                                                                <button onClick={() => setDetailLib(lib)}>
                                                                    <Info size={13} /> View details
                                                                </button>
                                                            </li>
                                                            <li>
                                                                <button onClick={() => setEditLib(lib)}>
                                                                    <SquarePen size={13} /> Edit library
                                                                </button>
                                                            </li>
                                                            <li>
                                                                <button className="text-error" onClick={() => setRemoveLib(lib)}>
                                                                    <Trash2 size={13} /> Remove
                                                                </button>
                                                            </li>
                                                        </ul>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>

                            {/* footer / pagination */}
                            {!loading && rows.length > 0 && (
                                <div className="px-4 py-3 border-t border-base-300 flex flex-wrap items-center justify-between gap-3">
                                    <p className="text-xs text-base-content/70">
                                        Showing {fromN}–{toN} of {filtered.length} {filtered.length === 1 ? "library" : "libraries"} · {fmtNum(totalFiles)} files · {tbOf(totalSize)} TB
                                    </p>
                                    <div className="flex items-center gap-3 text-xs text-base-content/80">
                                        <label className="flex items-center gap-2">
                                            Rows per page
                                            <select value={rowsPer} onChange={(e) => setRowsPer(Number(e.target.value))} className="select select-xs bg-base-300 border-base-300 w-16">
                                                {[5, 10, 25, 50].map((n) => (
                                                    <option key={n} value={n}>
                                                        {n}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                        <span>
                                            Page {curPage} of {pageCount}
                                        </span>
                                        <div className="flex items-center gap-1">
                                            <button disabled={curPage <= 1} onClick={() => setPage(curPage - 1)} className="btn btn-xs btn-square btn-ghost border border-base-300 disabled:opacity-30">
                                                <ChevronLeft size={13} />
                                            </button>
                                            <span className="btn btn-xs btn-square btn-primary border-none pointer-events-none">{curPage}</span>
                                            <button
                                                disabled={curPage >= pageCount}
                                                onClick={() => setPage(curPage + 1)}
                                                className="btn btn-xs btn-square btn-ghost border border-base-300 disabled:opacity-30">
                                                <ChevronRight size={13} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (
                        <>
                            {cloudError && (
                                <div className="alert alert-error shadow-sm text-sm mx-4 mb-3">
                                    <AlertTriangle size={15} />
                                    <span>{cloudError}</span>
                                </div>
                            )}

                            {(!cloudLoading || cloudLibs.length > 0) && (
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 px-4 pb-4">
                                    {[
                                        { icon: Layers, label: "Cloud Libraries", value: cloudLibs.length, accent: "var(--color-primary)" },
                                        { icon: FileVideo, label: "Total Files", value: fmtNum(cloudTotalFiles), accent: "var(--color-info)" },
                                        { icon: Database, label: "Total Storage", value: fmtBytes(cloudTotalSize), accent: "var(--color-success)" },
                                    ].map((m) => (
                                        <div key={m.label} className="flex items-center gap-2.5 bg-base-300 border border-base-300 rounded-xl px-4 py-2.5 min-w-0">
                                            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: `color-mix(in oklch, ${m.accent} 15%, transparent)` }}>
                                                <m.icon size={13} style={{ color: m.accent }} />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-[11px] font-semibold uppercase tracking-widest text-base-content/70 leading-none truncate">{m.label}</p>
                                                <p className="text-sm font-bold mt-0.5 tabular-nums leading-none truncate">{cloudLoading ? "—" : m.value}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <table className="table table-fixed w-full text-sm border-t border-base-300">
                                <colgroup>
                                    <col style={{ width: "6%" }} />
                                    <col style={{ width: "30%" }} />
                                    <col style={{ width: "14%" }} />
                                    <col style={{ width: "16%" }} />
                                    <col style={{ width: "12%" }} />
                                    <col style={{ width: "12%" }} />
                                    <col style={{ width: "10%" }} />
                                </colgroup>
                                <thead className="bg-base-300">
                                    <tr>
                                        <Th>SL</Th>
                                        <Th>Library</Th>
                                        <Th>Provider</Th>
                                        <Th>Status</Th>
                                        <Th className="text-right">Files</Th>
                                        <Th className="text-right">Storage</Th>
                                        <Th className="text-right">Actions</Th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {cloudLoading ? (
                                        [...Array(3)].map((_, i) => <SkeletonRow key={i} cols={7} />)
                                    ) : cloudLibs.length === 0 ? (
                                        <tr>
                                            <td colSpan={7}>
                                                <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
                                                    <div className="w-14 h-14 rounded-2xl bg-base-300 flex items-center justify-center">
                                                        <Cloud size={26} className="text-base-content/25" />
                                                    </div>
                                                    <div className="max-w-xs">
                                                        <p className="font-semibold text-base-content/80">No cloud libraries imported</p>
                                                        <p className="text-[13px] text-base-content/70 mt-1.5 leading-relaxed">
                                                            Import a Google Drive or GoFile folder as a Library from the <span className="font-medium text-base-content/80">Storage</span> page.
                                                        </p>
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : (
                                        cloudLibs.map((lib, i) => {
                                            const online = lib.status === "online";
                                            return (
                                                <tr key={lib.id} className="border-b border-base-300 last:border-0 hover:bg-base-300/50 transition-colors">
                                                    <td className="px-2 py-3 text-base-content/70 font-mono text-xs tabular-nums">{i + 1}</td>
                                                    <td className="px-2 py-3">
                                                        <div className="flex items-center gap-2.5 min-w-0">
                                                            <div className="w-8 h-8 rounded-lg bg-base-300 border border-base-300 flex items-center justify-center shrink-0">
                                                                <Cloud size={14} className={online ? "text-base-content/60" : "text-base-content/30"} />
                                                            </div>
                                                            <span className="font-semibold text-[13px] truncate">{lib.label || "Unnamed Library"}</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-2 py-3">
                                                        <span className="badge badge-sm badge-outline rounded-md font-medium uppercase">{lib.provider}</span>
                                                    </td>
                                                    <td className="px-2 py-3">
                                                        <div className="flex items-center gap-1.5 min-w-0">
                                                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${online ? "bg-success" : "bg-error"}`} />
                                                            <span className={`text-xs font-medium truncate ${online ? "text-success" : "text-error"}`} title={lib.error || ""}>
                                                                {online ? "Online" : lib.error || "Error"}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td className="px-2 py-3 text-right text-[13px] font-semibold tabular-nums">{fmtNum(lib.fileCount)}</td>
                                                    <td className="px-2 py-3 text-right text-[13px] font-semibold tabular-nums">{fmtBytes(lib.sizeBytes)}</td>
                                                    <td className="px-2 py-3">
                                                        <div className="flex items-center justify-end gap-0.5">
                                                            <ActionBtn icon={RotateCcw} title="Rescan library" onClick={() => handleCloudRescan(lib)} spinning={!!cloudRescanning[lib.id]} />
                                                            <ActionBtn icon={Trash2} title="Remove library" onClick={() => setCloudRemoveLib(lib)} danger />
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>

                            {!cloudLoading && cloudLibs.length > 0 && (
                                <div className="px-4 py-3 border-t border-base-300 flex items-center justify-between">
                                    <p className="text-xs text-base-content/70">
                                        {cloudLibs.length} {cloudLibs.length === 1 ? "library" : "libraries"} · {fmtNum(cloudTotalFiles)} files · {fmtBytes(cloudTotalSize)} total
                                    </p>
                                    <p className="text-xs text-base-content/70 hidden sm:block">Scanned live via nameParser — same parser local libraries use</p>
                                </div>
                            )}
                        </>
                    )}
                </Panel>

                {/* ═════════ Everything below is local-library analytics ═════════ */}
                {tab === "local" && !loading && rows.length > 0 && (
                    <>
                        {/* ── Disk capacity ─────────────────────────────── */}
                        <Panel className="p-5 space-y-4">
                            <PanelHead
                                title="Disk capacity"
                                sub="Total space across all connected drives, split by library, so you can see how full the system is."
                                right={diskTotal ? `${tbOf(totalSize)} TB used · ${tbOf(Math.max(0, diskTotal - totalSize))} TB free · ${tbOf(diskTotal)} TB total` : `${tbOf(totalSize)} TB used`}
                            />
                            <div className="flex h-7 w-full gap-0.5 rounded-md overflow-hidden" style={{ background: GC.track }}>
                                {rows.map((l, i) => (
                                    <div
                                        key={l.id}
                                        style={{ background: seg(i).hex, width: `${((diskTotal || totalSize) > 0 ? l._size / (diskTotal || totalSize) : 0) * 100}%` }}
                                        title={`${l.label}: ${fmtBytes(l._size)}`}
                                    />
                                ))}
                            </div>
                            <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-base-content/80">
                                {rows.map((l, i) => (
                                    <span key={l.id} className="inline-flex items-center gap-1.5">
                                        <span className="w-2 h-2 rounded-sm" style={{ background: seg(i).hex }} />
                                        {l.label} <span className="text-base-content/70 tabular-nums">{tbOf(l._size)} TB</span>
                                    </span>
                                ))}
                                {diskTotal && (
                                    <span className="inline-flex items-center gap-1.5">
                                        <span className="w-2 h-2 rounded-sm border border-base-300" />
                                        Free <span className="text-base-content/70 tabular-nums">{tbOf(Math.max(0, diskTotal - totalSize))} TB</span>
                                    </span>
                                )}
                            </div>
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                                {[
                                    { k: "Used", v: diskPct != null ? `${diskPct}%` : "—", s: diskTotal ? `of ${tbOf(diskTotal)} TB disk` : "Disk size unknown" },
                                    { k: "Growth", v: growthPerWeek ? `${(growthPerWeek / TB).toFixed(2)} TB` : "—", s: "per week, last 12 weeks" },
                                    {
                                        k: "Time to full",
                                        v: weeksToFull != null ? `~${Math.round(weeksToFull)} weeks` : "—",
                                        s: weeksToFull != null ? `around ${fmtShortDate(Date.now() + weeksToFull * 7 * 86400000)}` : "Needs growth data",
                                    },
                                    { k: "Largest library", v: largest?.label || "—", s: largest ? `${tbOf(largest._size)} TB · ${largest._share}% of used` : "" },
                                ].map((c) => (
                                    <div key={c.k} className="rounded-lg bg-base-100/40 border border-base-300 px-3.5 py-2.5 min-w-0">
                                        <p className="text-xs text-base-content/80">{c.k}</p>
                                        <p className="text-base font-bold mt-0.5 tabular-nums truncate">{c.v}</p>
                                        <p className="text-xs text-base-content/70 mt-0.5 truncate">{c.s}</p>
                                    </div>
                                ))}
                            </div>
                        </Panel>

                        {/* ── Space by library ──────────────────────────── */}
                        <Panel className="p-5 space-y-4">
                            <PanelHead
                                title="Space by library"
                                sub="How the used space is divided between libraries, and how much room is left on the drive each library lives on."
                                right={`All ${rows.length} libraries · ${tbOf(totalSize)} TB used`}
                            />
                            <div className="flex h-7 w-full gap-0.5 rounded-md overflow-hidden">
                                {rows.map((l, i) => (
                                    <div
                                        key={l.id}
                                        className="flex items-center justify-center text-[11px] font-bold overflow-hidden"
                                        style={{ background: seg(i).hex, color: seg(i).ink, width: `${l._share}%` }}>
                                        {l._share >= 8 ? `${l._share}%` : ""}
                                    </div>
                                ))}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                                {rows.map((l, i) => {
                                    const avail = l._driveFree;
                                    const pctDrive = l._driveTotal ? Math.min(100, Math.round((l._size / l._driveTotal) * 100)) : l._share;
                                    return (
                                        <div key={l.id} className="rounded-lg bg-base-100/40 border border-base-300 px-3.5 py-3 min-w-0">
                                            <div className="flex items-center justify-between gap-2 text-xs">
                                                <span className="inline-flex items-center gap-1.5 font-semibold text-base-content min-w-0">
                                                    <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: seg(i).hex }} />
                                                    <span className="truncate">{l.label}</span>
                                                </span>
                                                <span className="text-base-content/70 truncate">{l._drive}</span>
                                            </div>
                                            <div className="flex items-end justify-between mt-2">
                                                <p className="text-xl font-bold tabular-nums">{tbOf(l._size)} TB</p>
                                                <p className="text-xs text-base-content/80 mb-1">{l._share}% of used</p>
                                            </div>
                                            <div className="h-1.5 rounded-full mt-2 overflow-hidden" style={{ background: GC.track }}>
                                                <div className="h-full rounded-full" style={{ background: seg(i).hex, width: `${pctDrive}%` }} />
                                            </div>
                                            <div className="flex items-center justify-between mt-2 text-xs">
                                                <span className="text-success">{avail != null ? `${tbOf(avail)} TB available` : "— available"}</span>
                                                <span className="text-base-content/70">{l._driveTotal ? `of ${tbOf(l._driveTotal)} TB drive` : ""}</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </Panel>

                        {/* ── Storage growth + Video quality ────────────── */}
                        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
                            <Panel className="p-5 xl:col-span-2 gap-3 flex flex-col">
                                <PanelHead title="Storage growth" right={growthPerWeek ? `Last 12 weeks · +${tbOf(growthPerWeek)} TB per week` : "Last 12 weeks"} />
                                {growthSeries && growthSeries.length > 1 ? (
                                    <AxisChart
                                        values={growthSeries.map((p) => (p.bytes ?? p) / TB)}
                                        minHeight={200}
                                        yMax={diskTotal ? diskTotal / TB : undefined}
                                        limit={diskTotal ? diskTotal / TB : undefined}
                                        limitLabel={diskTotal ? `Disk limit ${tbOf(diskTotal)} TB` : undefined}
                                        fmtY={(v) => `${v.toFixed(v < 10 ? 1 : 0)}`}
                                        ticks={4}
                                        xLabels={[
                                            [0, fmtShortDate(growthSeries[0].date)],
                                            [Math.floor(growthSeries.length / 2), fmtShortDate(growthSeries[Math.floor(growthSeries.length / 2)].date)],
                                            [growthSeries.length - 1, "Today"],
                                        ]}
                                    />
                                ) : (
                                    <div className="h-56">
                                        <EmptyNote>No growth history yet. Needs file modified dates from /api/media.</EmptyNote>
                                    </div>
                                )}
                            </Panel>

                            <Panel className="p-5 gap-3 flex flex-col">
                                <PanelHead title="Video quality" right="By resolution" />
                                {hasQuality ? (
                                    <div className="flex-1 flex flex-col justify-between gap-4">
                                        <div className="flex items-center gap-5 flex-1">
                                            <Donut size={120} stroke={14} segments={qualityKeys.map((k) => ({ value: qualityTotals[k] || 0, color: QSEG[k].hex }))}>
                                                <span className="text-lg font-bold tabular-nums leading-none">{fmtNum(qualityKeys.reduce((a, k) => a + (qualityTotals[k] || 0), 0))}</span>
                                                <span className="text-[11px] text-base-content/80 mt-0.5">files</span>
                                            </Donut>
                                            <div className="flex-1 space-y-3 min-w-0">
                                                {qualityKeys.map((k) => {
                                                    const tot = qualityKeys.reduce((a, q) => a + (qualityTotals[q] || 0), 0) || 1;
                                                    return (
                                                        <div key={k} className="flex items-center justify-between gap-2 text-xs">
                                                            <span className="inline-flex items-center gap-2 text-base-content/85">
                                                                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: QSEG[k].hex }} />
                                                                {k}
                                                            </span>
                                                            <span className="font-semibold tabular-nums">
                                                                {fmtNum(qualityTotals[k] || 0)}{" "}
                                                                <span className="text-base-content/70 font-normal">· {Math.round(((qualityTotals[k] || 0) / tot) * 100)}%</span>
                                                            </span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                        {sdCount > 0 && <p className="text-xs text-base-content/70 border-t border-base-300 pt-3">{fmtNum(sdCount)} SD files could be replaced with better copies.</p>}
                                    </div>
                                ) : (
                                    <EmptyNote>No resolution data yet. Needs `qualityCounts` per library.</EmptyNote>
                                )}
                            </Panel>
                        </div>

                        {/* ── Media libraries (poster rail cards) ───────── */}
                        <div className="space-y-3">
                            <div className="flex items-baseline justify-between gap-3">
                                <h2 className="text-lg font-bold tracking-tight">Media libraries</h2>
                                <p className="text-xs text-base-content/70 hidden sm:block">Poster rail shows the latest titles in each folder</p>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                                {rows.map((l) => (
                                    <Panel key={l.id} className="overflow-hidden">
                                        <div className="relative bg-base-300/60 px-3 pt-3 h-24 flex gap-2 overflow-hidden">
                                            {(l._posters.length ? l._posters.slice(0, 6) : [null, null, null, null, null, null]).map((p, i) =>
                                                p ? (
                                                    <img key={i} src={p} alt="" loading="lazy" className="h-20 w-14 rounded-md object-cover shrink-0" />
                                                ) : (
                                                    <div key={i} className="h-20 w-14 rounded-md bg-base-content/10 shrink-0" />
                                                ),
                                            )}
                                            <span className="absolute top-2 right-2 rounded bg-base-100/80 px-1.5 py-0.5 text-[11px] font-semibold">{l._type.label}</span>
                                        </div>
                                        <div className="p-4 space-y-3">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <p className="font-bold truncate">{l.label || "Unnamed Library"}</p>
                                                    <p className="text-xs font-mono text-base-content/70 truncate" title={l.path}>
                                                        {l.path}
                                                    </p>
                                                </div>
                                                <span
                                                    className={`shrink-0 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${l._online ? "border-success/30 text-success" : "border-error/30 text-error"}`}>
                                                    <span className={`w-1.5 h-1.5 rounded-full ${l._online ? "bg-success" : "bg-error"}`} />
                                                    {l._online ? "Online" : "Offline"}
                                                </span>
                                            </div>
                                            <div className="grid grid-cols-3 gap-2 text-xs">
                                                <div>
                                                    <p className="text-base-content/70">Files</p>
                                                    <p className="text-sm font-semibold tabular-nums">{fmtNum(l._files)}</p>
                                                </div>
                                                <div>
                                                    <p className="text-base-content/70">Storage</p>
                                                    <p className="text-sm font-semibold tabular-nums">{tbOf(l._size)} TB</p>
                                                </div>
                                                <div>
                                                    <p className="text-base-content/70">Scanned</p>
                                                    <p className={`text-sm font-semibold tabular-nums ${l._online ? "" : "text-error"}`}>{timeAgo(l._lastScan)}</p>
                                                </div>
                                            </div>
                                            <div>
                                                <div className="flex items-center justify-between text-xs text-base-content/70">
                                                    <span>12-week growth</span>
                                                    <span className="text-success tabular-nums">{l.growthBytes != null ? `+${tbOf(l.growthBytes)} TB` : "—"}</span>
                                                </div>
                                                <div className="mt-1.5 text-primary h-8">
                                                    <Spark values={l._growth} area height={32} />
                                                </div>
                                            </div>
                                            <div className="flex items-center justify-between pt-1">
                                                <p className="text-xs text-base-content/80">{l._matchPct != null ? `${l._matchPct}% metadata matched` : "Metadata not scanned"}</p>
                                                <div className="flex gap-0.5">
                                                    <ActionBtn icon={RotateCcw} title="Rescan library" onClick={() => handleRescan(l)} spinning={!!rescanning[l.id]} />
                                                    <ActionBtn icon={SquarePen} title="Edit library" onClick={() => setEditLib(l)} />
                                                </div>
                                            </div>
                                        </div>
                                    </Panel>
                                ))}
                                {Array.from({ length: (4 - (rows.length % 4)) % 4 }).map((_, k) =>
                                    k === 0 ? (
                                        <Link
                                            key="add"
                                            to="/settings"
                                            className="card flex min-h-64 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-base-300 bg-base-200/50 p-5 text-center transition-colors hover:border-primary hover:bg-base-200">
                                            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-base-300 text-base-content/85">
                                                <Plus size={18} />
                                            </span>
                                            <p className="text-sm font-semibold">Add library</p>
                                            <p className="max-w-48 text-xs text-base-content/75">Point FLUX at another folder, drive or network share.</p>
                                        </Link>
                                    ) : k === 1 ? (
                                        <Panel key="sum" className="min-h-64 p-5 gap-3 flex flex-col">
                                            <PanelHead title="All libraries" />
                                            <dl className="flex flex-1 flex-col justify-around text-sm">
                                                {[
                                                    ["Libraries", `${onlineCount} online of ${rows.length}`],
                                                    ["Files", fmtNum(totalFiles)],
                                                    ["Storage", `${tbOf(totalSize)} TB`],
                                                    ["Runtime", runtimeTotalH != null ? `${fmtNum(runtimeTotalH)} h` : "—"],
                                                ].map(([a, b]) => (
                                                    <div key={a} className="flex items-center justify-between border-b border-base-300 pb-2 last:border-0 last:pb-0">
                                                        <dt className="text-base-content/80">{a}</dt>
                                                        <dd className="font-semibold tabular-nums">{b}</dd>
                                                    </div>
                                                ))}
                                            </dl>
                                        </Panel>
                                    ) : (
                                        <Panel key="scan" className="min-h-64 p-5 gap-3 flex flex-col">
                                            <PanelHead title="Scan health" />
                                            <div className="flex flex-1 flex-col justify-center gap-3">
                                                <p className="text-3xl font-bold tabular-nums">{offlineCount === 0 ? "All clear" : `${offlineCount} offline`}</p>
                                                <p className="text-sm text-base-content/80">
                                                    {offlineCount === 0 ? "Every library is reachable." : `${offlineLibs.map((l) => l.label).join(", ")} can't be reached.`}
                                                </p>
                                                <button onClick={handleScanAll} disabled={!!rescanning.__all} className="btn btn-sm btn-ghost border border-base-300 bg-base-300/50 w-fit gap-1.5">
                                                    <RefreshCw size={12} className={rescanning.__all ? "animate-spin" : ""} /> Scan all
                                                </button>
                                            </div>
                                        </Panel>
                                    ),
                                )}
                            </div>
                        </div>

                        {/* ── Files added / Scan activity / Metadata match ─ */}
                        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
                            <Panel className="p-5 gap-3 flex flex-col">
                                <PanelHead title="Files added" right="30 days · 7-day average" />
                                {filesAdded && filesAdded.length > 1 ? (
                                    <div className="flex-1 flex flex-col gap-3 min-h-0">
                                        <AxisChart
                                            values={filesAdded}
                                            minHeight={140}
                                            ticks={3}
                                            fmtY={(v) => Math.round(v)}
                                            avg={filesAdded.reduce((a, b) => a + b, 0) / filesAdded.length}
                                            avgLabel="avg"
                                            xLabels={[
                                                [0, fmtShortDate(Date.now() - 29 * DAY)],
                                                [14, fmtShortDate(Date.now() - 15 * DAY)],
                                                [29, "Today"],
                                            ]}
                                        />
                                        <div className="flex justify-between text-xs text-base-content/80">
                                            <span>{fmtNum(filesAdded.slice(-7).reduce((a, b) => a + b, 0))} this week</span>
                                            <span>Max {fmtNum(Math.max(...filesAdded))} / day</span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="h-40">
                                        <EmptyNote>No daily file counts yet. Needs file modified dates from /api/media.</EmptyNote>
                                    </div>
                                )}
                            </Panel>

                            <Panel className="p-5 gap-3 flex flex-col">
                                <PanelHead title="Scan activity" right="12 weeks · by day" />
                                {scanActivity && scanActivity.length > 0 ? (
                                    <>
                                        <div className="grid grid-flow-col grid-rows-7 gap-1 pt-1 flex-1 min-h-32">
                                            {scanActivity.slice(-84).map((v, i) => {
                                                const mx = Math.max(...scanActivity, 1);
                                                const lvl = v <= 0 ? 0 : Math.min(4, Math.ceil((v / mx) * 4));
                                                return <div key={i} className="rounded-sm min-h-3" style={{ background: HEAT[lvl] }} title={`${v} files`} />;
                                            })}
                                        </div>
                                        <p className="text-xs text-base-content/70">Busiest day: {fmtNum(Math.max(...scanActivity))} files</p>
                                    </>
                                ) : (
                                    <div className="h-40">
                                        <EmptyNote>No scan history yet. Needs file modified dates from /api/media.</EmptyNote>
                                    </div>
                                )}
                            </Panel>

                            <Panel className="p-5 gap-3 flex flex-col">
                                <PanelHead title="Metadata match" right={matchOverall != null ? `TMDB · ${matchOverall}% overall` : "TMDB"} />
                                {hasMatch ? (
                                    <>
                                        <div className="flex items-center gap-4">
                                            <Donut
                                                size={84}
                                                stroke={9}
                                                segments={[
                                                    { value: matchOverall, color: GC.red },
                                                    { value: 100 - matchOverall, color: "transparent" },
                                                ]}>
                                                <span className="text-lg font-bold tabular-nums">{matchOverall}%</span>
                                            </Donut>
                                            <div className="text-xs space-y-1">
                                                <p className="font-semibold tabular-nums">{fmtNum(matchedTotal)} matched</p>
                                                <p className="font-semibold tabular-nums">{fmtNum(unmatched)} need review</p>
                                            </div>
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            {rows.map((l) => (
                                                <div key={l.id} className="flex items-center gap-3 text-xs">
                                                    <span className="w-24 truncate text-base-content/85">{l.label}</span>
                                                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: GC.track }}>
                                                        <div className="h-full rounded-full" style={{ background: GC.red, width: `${l._matchPct ?? 0}%` }} />
                                                    </div>
                                                    <span className="w-8 text-right tabular-nums text-base-content/80">{l._matchPct != null ? `${l._matchPct}%` : "—"}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                ) : (
                                    <div className="h-40">
                                        <EmptyNote>No metadata stats yet. Needs /api/metadata/enriched.</EmptyNote>
                                    </div>
                                )}
                            </Panel>
                        </div>

                        {/* ── Quality by library / Scan duration / Needs attention ─ */}
                        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
                            <Panel className="p-5 gap-3 flex flex-col">
                                <PanelHead title="Quality by library" right="Share of files" />
                                {rows.some((l) => l._qc) ? (
                                    <>
                                        <div className="flex-1 flex flex-col justify-around gap-2.5">
                                            {rows.map((l) => {
                                                const tot = qualityKeys.reduce((a, k) => a + (l._qc?.[k] || 0), 0) || 1;
                                                return (
                                                    <div key={l.id} className="flex items-center gap-3 text-xs">
                                                        <span className="w-24 truncate text-base-content/85">{l.label}</span>
                                                        <div className="flex-1 flex h-2.5 gap-0.5 rounded-sm overflow-hidden" style={{ background: GC.track }}>
                                                            {qualityKeys.map((k) => (
                                                                <div key={k} style={{ background: QSEG[k].hex, width: `${((l._qc?.[k] || 0) / tot) * 100}%` }} title={`${k}: ${l._qc?.[k] || 0}`} />
                                                            ))}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        <div className="flex gap-4 text-xs text-base-content/80 pt-1">
                                            {qualityKeys.map((k) => (
                                                <span key={k} className="inline-flex items-center gap-1.5">
                                                    <span className="w-2 h-2 rounded-sm" style={{ background: QSEG[k].hex }} />
                                                    {k}
                                                </span>
                                            ))}
                                        </div>
                                    </>
                                ) : (
                                    <div className="h-40">
                                        <EmptyNote>No resolution data yet. Needs `qualityCounts` per library.</EmptyNote>
                                    </div>
                                )}
                            </Panel>

                            <Panel className="p-5 gap-3 flex flex-col">
                                <PanelHead title="Scan duration" right="Last 14 full scans" />
                                {scanDurations && scanDurations.length > 1 ? (
                                    <div className="flex-1 flex flex-col gap-3 min-h-0">
                                        <AxisChart
                                            values={scanDurations}
                                            area={false}
                                            minHeight={140}
                                            ticks={3}
                                            fmtY={(v) => (v < 10 ? v.toFixed(1) : Math.round(v))}
                                            avg={scanDurations.reduce((a, b) => a + b, 0) / scanDurations.length}
                                            avgLabel="avg"
                                            xLabels={[
                                                [0, "Oldest"],
                                                [scanDurations.length - 1, "Latest"],
                                            ]}
                                        />
                                        <p className="text-xs text-base-content/80">
                                            Average {(scanDurations.reduce((a, b) => a + b, 0) / scanDurations.length).toFixed(1)} min · measured from scans run here
                                        </p>
                                    </div>
                                ) : (
                                    <div className="h-40">
                                        <EmptyNote>No scan timings yet. Run Scan all twice to start the chart.</EmptyNote>
                                    </div>
                                )}
                            </Panel>

                            <Panel className="p-5 gap-3 flex flex-col">
                                <PanelHead
                                    title="Needs attention"
                                    right={
                                        <span className="rounded bg-base-content/10 px-1.5 py-0.5 text-[11px] font-bold">{offlineLibs.length + (unmatched > 0 ? 1 : 0) + (sdCount > 0 ? 1 : 0)}</span>
                                    }
                                />
                                <div className="flex-1 flex flex-col justify-around gap-3">
                                    {offlineLibs.map((l) => (
                                        <div key={l.id} className="flex items-start gap-3">
                                            <div className="w-8 h-8 rounded-lg bg-error/15 text-error flex items-center justify-center shrink-0">
                                                <CircleAlert size={15} />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-[13px] font-semibold truncate">{l.label} offline</p>
                                                <p className="text-xs text-base-content/80 truncate">{l._lastScan ? `Unreachable since ${fmtShortDate(l._lastScan)}` : "Unreachable"}</p>
                                            </div>
                                            <span className="text-xs text-error">Critical</span>
                                        </div>
                                    ))}
                                    {unmatched > 0 && (
                                        <div className="flex items-start gap-3">
                                            <div className="w-8 h-8 rounded-lg bg-warning/15 text-warning flex items-center justify-center shrink-0">
                                                <AlertTriangle size={15} />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-[13px] font-semibold truncate">{fmtNum(unmatched)} files unmatched</p>
                                                <p className="text-xs text-base-content/80 truncate">No poster or description yet</p>
                                            </div>
                                            <span className="text-xs text-warning">Review</span>
                                        </div>
                                    )}
                                    {sdCount > 0 && (
                                        <div className="flex items-start gap-3">
                                            <div className="w-8 h-8 rounded-lg bg-base-content/10 text-base-content/80 flex items-center justify-center shrink-0">
                                                <Info size={15} />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-[13px] font-semibold truncate">{fmtNum(sdCount)} SD files</p>
                                                <p className="text-xs text-base-content/80 truncate">Could be replaced by better copies</p>
                                            </div>
                                            <span className="text-xs text-base-content/80">Info</span>
                                        </div>
                                    )}
                                    {offlineLibs.length === 0 && !(unmatched > 0) && !(sdCount > 0) && <EmptyNote>Nothing needs attention.</EmptyNote>}
                                </div>
                                <Link to="/dashboard" className="btn btn-sm btn-ghost border border-base-300 bg-base-300/60 w-full">
                                    Open review queue
                                </Link>
                            </Panel>
                        </div>
                    </>
                )}
            </div>
        </>
    );
}
