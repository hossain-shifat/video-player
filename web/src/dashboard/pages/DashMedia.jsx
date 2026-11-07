// web/src/Dashboard/Pages/DashMedia.jsx
import { useState, useMemo } from "react";
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
    Info,
    FolderOpen,
    Image as ImageIcon,
    SquarePen,
    Trash2,
    X,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    Database,
    Shield,
    ShieldOff,
} from "lucide-react";
import { api } from "../Shared";
import { MediaDeleteModal, MediaDetailsModal, MediaEditModal } from "../Components/DashModal";

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

// ffprobe reports frame rate as a fraction string like "24000/1001" or "24/1" —
// parse it safely (no eval) into a rounded whole number for display.
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

function Badge({ label, variant = "default", size = "sm" }) {
    const cls =
        {
            movie: "bg-primary/15 text-primary border border-primary/20",
            series: "bg-info/15 text-info border border-info/20",
            anime: "bg-accent/15 text-accent border border-accent/20",
            default: "bg-white/8 text-white/70 border border-white/12",
        }[variant] || "bg-white/8 text-white/70 border border-white/12";

    const sizeClass = size === "xs" ? "px-1 py-0 text-[8px]" : "px-1.5 py-0.5 text-[9px]";

    return <span className={`inline-flex items-center rounded-md font-bold uppercase tracking-wider ${sizeClass} ${cls}`}>{label}</span>;
}

function QualityChip({ label }) {
    const color =
        label === "4K"
            ? "bg-warning/15 text-warning border-warning/25"
            : label === "1080p"
              ? "bg-success/15 text-success border-success/25"
              : label === "720p"
                ? "bg-info/15 text-info border-info/25"
                : "bg-white/8 text-white/60 border-white/12";
    return <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md border text-[9px] font-bold tracking-wider ${color}`}>{label}</span>;
}

// Color-codes by codec family so video/audio codecs are visually distinct at
// a glance, instead of every codec looking identical in flat gray.
function CodecChip({ label }) {
    const l = (label || "").toUpperCase();
    const cls = /HEVC|H\.?265|X265/.test(l)
        ? "bg-accent/15 text-accent border-accent/25"
        : /H\.?264|AVC|X264/.test(l)
          ? "bg-info/15 text-info border-info/25"
          : /AV1/.test(l)
            ? "bg-success/15 text-success border-success/25"
            : /VP9|VP8/.test(l)
              ? "bg-warning/15 text-warning border-warning/25"
              : /AAC|AC3|EAC3|DTS|TRUEHD|FLAC|MP3|OPUS/.test(l)
                ? "bg-secondary/15 text-secondary border-secondary/25"
                : "bg-white/8 text-white/70 border-white/12";
    return <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md border text-[9px] font-mono font-bold ${cls}`}>{label}</span>;
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

    // Bulk ffprobe-backed media info — fetched ONCE, merged into rows locally.
    // Backend auto-scans this in the background on server boot (mediaInfoScanner),
    // so this is usually already populated by the time the dashboard loads.
    const { data: mediaInfoData } = useQuery({
        queryKey: ["admin", "mediainfo"],
        queryFn: () => api.get("/api/mediainfo"),
        staleTime: 1000 * 60 * 5,
    });
    const mediaInfoMap = mediaInfoData?.mediaInfo || {};

    // Real permission state — bulk-fetched once, same pattern as mediaInfo.
    // Previously there was NO route exposing permissionsStore.js at all, so
    // the toggle only ever patched React Query's in-memory cache and reverted
    // on every refresh. This is the actual persisted state now.
    const { data: permissionsData } = useQuery({
        queryKey: ["admin", "permissions"],
        queryFn: () => api.get("/api/permissions"),
        staleTime: 1000 * 60 * 5,
    });
    const permissionsMap = permissionsData?.permissions || {};

    // Real per-file added dates — bulk-fetched, keyed by real file id, works
    // for every individual episode (grouper.js strips addedAt off episodes
    // before they ever reach this component, so this bypasses that entirely
    // by reading straight from the flat pre-grouping scan).
    const { data: addedDatesData } = useQuery({
        queryKey: ["admin", "added-dates"],
        queryFn: () => api.get("/api/mediainfo/added-dates"),
        staleTime: 1000 * 60 * 5,
    });
    const addedDatesMap = addedDatesData?.dates || {};

    const updateMutation = useMutation({
        // REAL persist: permission goes to the new /api/permissions endpoint
        // (permissionsStore.js on the backend — this is what was missing
        // entirely before, hence the toggle never actually sticking).
        //
        // TMDB refresh is best-effort and ONLY attempted for movies — series/
        // anime use a synthetic group id (e.g. "series:fatal seduction") that
        // is never a real scanned-file id, so /api/metadata/refresh/:id always
        // 404s for them. Skipping avoids that error entirely instead of just
        // swallowing it.
        mutationFn: async (data) => {
            const { id, payload } = data;

            await api.post(`/api/permissions/${id}`, { permission: payload.permission });

            if (payload.type === "movie") {
                try {
                    await api.post(`/api/metadata/refresh/${id}`);
                } catch {
                    /* non-fatal — permission save above already succeeded */
                }
            }

            return data;
        },
        onMutate: async (data) => {
            // Cosmetic, session-level: title/year edits patch the media list
            // cache immediately so the table updates without a refetch.
            await queryClient.cancelQueries({ queryKey: ["admin", "media"] });
            await queryClient.cancelQueries({ queryKey: ["admin", "permissions"] });

            const previousMedia = queryClient.getQueryData(["admin", "media"]);
            const previousPermissions = queryClient.getQueryData(["admin", "permissions"]);

            queryClient.setQueryData(["admin", "media"], (old) => {
                if (!old) return old;
                const copy = JSON.parse(JSON.stringify(old));
                const { id, payload } = data;
                const patch = (items) =>
                    (items || []).map((item) => {
                        if (item.id !== id) return item;
                        return {
                            ...item,
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

            // Real, persisted state: permission goes on its own cache entry.
            queryClient.setQueryData(["admin", "permissions"], (old) => ({
                ...old,
                permissions: { ...(old?.permissions || {}), [data.id]: data.payload.permission },
            }));

            return { previousMedia, previousPermissions };
        },
        onSuccess: () => {
            showToast("Media updated");
            setEditMedia(null);
        },
        onError: (err, _data, context) => {
            // Roll back both optimistic updates on real failure
            if (context?.previousMedia) queryClient.setQueryData(["admin", "media"], context.previousMedia);
            if (context?.previousPermissions) queryClient.setQueryData(["admin", "permissions"], context.previousPermissions);
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

            // ── Real ffprobe data override ────────────────────────────────────
            // Movies: item.id IS the file id, matches mediaInfoMap directly.
            //
            // Series/anime: mediaInfoStore is keyed per EPISODE (each episode is
            // its own scanned file), so:
            //   - Quality/codec: scan every episode across every season and use
            //     the FIRST one that already has data — not just episode 1, since
            //     the background probe may not have reached that specific episode
            //     yet even if others further along are already done.
            //   - Size: SUM every episode's real probed bytes — a series' total
            //     size is the sum of all its episode files, never just one.
            //   - Added date: use the MOST RECENTLY added episode's real
            //     filesystem date (same convention Plex/Jellyfin use for a
            //     show's "date added" — whenever you most recently added new
            //     episodes to it), sourced from addedDatesMap which is keyed
            //     by real episode file id (works regardless of what
            //     grouper.js trims off the episode objects themselves).
            //
            // mediaInfoStore now returns { container, video, audioTracks,
            // subtitleTracks } per file — cover-art "video" streams (embedded
            // poster images) are already excluded server-side when video is
            // picked, no client-side filtering needed anymore.
            let repInfo = null;
            let seriesTotalSize = 0;
            let seriesLatestAdded = 0;
            if (type === "movie") {
                repInfo = mediaInfoMap[item.id] || null;
            } else if (item.seasons) {
                for (const season of Object.values(item.seasons)) {
                    for (const ep of season.episodes || []) {
                        const epInfo = mediaInfoMap[ep.id];
                        if (epInfo) {
                            seriesTotalSize += epInfo.container?.sizeBytes || 0;
                            if (!repInfo) repInfo = epInfo; // first one found = representative for quality/codec
                        }
                        const epAdded = addedDatesMap[ep.id];
                        if (epAdded) {
                            const t = new Date(epAdded).getTime();
                            if (t > seriesLatestAdded) seriesLatestAdded = t;
                        }
                    }
                }
            }

            const video = repInfo?.video || null;
            const primaryAudio = repInfo?.audioTracks?.[0] || null;

            const realRes = video?.height ? (video.height >= 2000 ? "4K" : video.height >= 1000 ? "1080p" : video.height >= 700 ? "720p" : "480p") : null;

            // Real data wins when present; filename-guess (tags) is the fallback
            // for files ffprobe hasn't reached yet (scan still running in background).
            const finalTags = {
                res: realRes || tags.res,
                vcodec: video?.codec || tags.vcodec, // already uppercase from mediaInfoStore
                acodec: primaryAudio?.codec || tags.acodec,
            };

            // Movies: single probed file size. Series/anime: summed across episodes.
            const realSize = type === "movie" ? repInfo?.container?.sizeBytes : seriesTotalSize;

            // Extra technical detail for the Details modal — captured once here
            // so the modal doesn't need a second probe fetch for series/anime
            // (which can't re-fetch per-file anyway, see DetailsModal notes).
            const resolution = video?.resolution || null;
            const fps = video?.frameRate || null; // already a formatted string, e.g. "23.976 fps"
            const bitrate = repInfo?.container?.bitrateBps || null;
            const audioChannels = primaryAudio?.channels || null;
            const audioLang = primaryAudio?.language || null;

            // Movies: use the real filesystem date attached by scanner.js.
            // Series/anime: use the most recently added episode's real date
            // (seriesLatestAdded, computed above from addedDatesMap). Only
            // fall back to metadata.date (TMDB-fetch-time, not a real file
            // date) if neither real source is available yet. No 0 fallback —
            // an unavailable date must stay nullish, not become new Date(0)
            // (epoch / Jan 1 1970), which fmtDate would render as a real
            // (wrong) date instead of "—".
            const added = type === "movie" ? item.addedAt || item.metadata?.date || null : seriesLatestAdded || item.metadata?.date || null;

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
                _size: realSize || size, // real probed bytes when available, else scanner bytes (movies only have scanner fallback — series never had one)
                _added: added ? new Date(added) : null,
                _duration: repInfo?.container?.durationSeconds || duration,
                _library: item.folderLabel || libs.get(item.folderId) || "Unknown",
                _libraryId: item.folderId,
                _poster: poster,
                _filename: sourceFilename || item.name || item.path || "",
                _path: item.path || "",
                _permission: permissionsMap[item.id] !== false, // real persisted value — defaults true (allowed) same as backend
                _resolution: resolution,
                _fps: fps,
                _bitrate: bitrate,
                _audioChannels: audioChannels,
                _audioLang: audioLang,
                ...finalTags,
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
    }, [mediaData, mediaInfoMap, permissionsMap, addedDatesMap]);

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
        return [...filteredMedia].sort((a, b) => b._added - a._added);
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
                <MediaEditModal
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
            {detailsMedia && <MediaDetailsModal media={detailsMedia} onClose={() => setDetailsMedia(null)} />}
            {deleteMedia && (
                <MediaDeleteModal media={deleteMedia} onClose={() => setDeleteMedia(null)} onConfirm={deleteMutation.mutate} isPending={deleteMutation.isPending} error={deleteMutation.error} />
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
                                                {!item._permission ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border bg-error/15 border-error/30 text-error text-xs font-bold">
                                                        <ShieldOff size={8} />
                                                        Restricted
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border bg-success/15 border-success/30 text-success text-xs font-bold">
                                                        <Shield size={8} />
                                                        Normal
                                                    </span>
                                                )}
                                            </td>

                                            {/* Actions — Details, Edit, Delete (delete always shown in error color) */}
                                            <td className="pl-2 pr-4 py-3.5">
                                                <div className="flex items-center justify-end gap-0.5">
                                                    <button
                                                        onClick={() => setDetailsMedia(item)}
                                                        title="Details"
                                                        className="w-8 h-8 rounded-md flex items-center justify-center text-white/75 border-none hover:bg-white/8 hover:text-white transition-all duration-150 cursor-pointer">
                                                        <Info size={15} strokeWidth={1.8} />
                                                    </button>
                                                    <button
                                                        onClick={() => setEditMedia(item)}
                                                        title="Edit"
                                                        className="w-8 h-8 rounded-md flex items-center justify-center text-white/75 border-none hover:bg-white/8 hover:text-white transition-all duration-150 cursor-pointer">
                                                        <SquarePen size={15} strokeWidth={1.8} />
                                                    </button>
                                                    <button
                                                        onClick={() => setDeleteMedia(item)}
                                                        title="Delete"
                                                        className="w-8 h-8 rounded-md flex items-center justify-center text-error/85 border-none hover:bg-error/15 hover:text-error transition-all duration-150 cursor-pointer">
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
