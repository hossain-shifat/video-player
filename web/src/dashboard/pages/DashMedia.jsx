// web/src/dashboard/pages/DashMedia.jsx
import { useState, useMemo, Fragment } from "react";
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
    User,
    Monitor,
    Volume2,
    Gauge,
    Clock,
    Link2,
    Languages,
} from "lucide-react";
import { api } from "../../api/client";
import ConfirmModal, {
    ModalShell,
    ModalHeader,
    ModalTabs,
    ModalContent,
    ModalSection,
    ModalRows,
    ModalKV,
    ModalStats,
    ModalCallout,
    ModalReview,
    ModalCopyButton,
    ModalFooter,
    ModalBadge,
    ModalButton,
    ModalSegmented,
    ModalToggle,
    PANEL,
    MODAL_INPUT,
} from "../components/ConfirmModal";

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

// Generic "all metadata" rows: turns a flat ffprobe-ish object into label / value pairs.
const humanize = (k) =>
    k
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .replace(/^./, (c) => c.toUpperCase());
function fmtMeta(k, v) {
    if (typeof v === "boolean") return v ? "Yes" : "No";
    if (typeof v === "number") {
        if (/bytes$|^size$/i.test(k)) return fmtBytes(v);
        if (/bps$|bitrate/i.test(k)) return `${(v / 1_000_000).toFixed(2)} Mbps`;
        if (/seconds$|^duration$/i.test(k)) return fmtDuration(v);
        return v.toLocaleString();
    }
    return String(v);
}
function metaRows(obj, prefix = "") {
    if (!obj || typeof obj !== "object") return [];
    const out = [];
    for (const [k, v] of Object.entries(obj)) {
        if (v == null || v === "") continue;
        const label = prefix ? `${prefix} · ${humanize(k)}` : humanize(k);
        if (Array.isArray(v)) {
            if (v.every((x) => x == null || typeof x !== "object")) out.push({ label, value: v.join(", ") });
            else v.forEach((x, i) => out.push(...metaRows(x, `${label} ${i + 1}`)));
        } else if (typeof v === "object") out.push(...metaRows(v, label));
        else out.push({ label, value: fmtMeta(k, v) });
    }
    return out.filter((r) => r.value !== "");
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

// ─── Modals (shared shell, header, footer and atoms: ../components/ConfirmModal) ──

const TYPE_TONE = { movie: "primary", series: "info", anime: "accent" };
const TYPE_LABEL = { movie: "Movie", series: "Series", anime: "Anime" };

function PosterThumb({ src, Icon, className = "h-14 w-10" }) {
    return (
        <div className={`grid ${className} shrink-0 place-items-center overflow-hidden rounded-md border border-base-content/15 bg-base-300`}>
            {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <Icon size={16} className="text-base-content/40" />}
        </div>
    );
}

const INPUT_LG = `${MODAL_INPUT} !h-[42px]`;

// ─── Edit Modal ───────────────────────────────────────────────────────────────

function EditModal({ media, onClose, onSave, isPending, error }) {
    const [title, setTitle] = useState(media._title || "");
    const [year, setYear] = useState(media._year || "");
    const [type, setType] = useState(media._type || "movie");
    const [permission, setPermission] = useState(media._permission !== false);
    const TypeIcon = (TYPE_CONFIG[media._type] || TYPE_CONFIG.movie).Icon;

    const handleSubmit = () => {
        onSave({ id: media._id, payload: { title, year: Number(year), type, permission } });
    };

    const access = (v) => (v ? "Normal" : "Restricted");
    const changes = [
        title !== (media._title || "") && { name: "Title", from: media._title || "—", to: title || "—" },
        String(year) !== String(media._year || "") && { name: "Year", from: media._year || "—", to: year || "—" },
        type !== (media._type || "movie") && { name: "Type", from: TYPE_LABEL[media._type || "movie"], to: TYPE_LABEL[type] },
        permission !== (media._permission !== false) && { name: "Access", from: access(media._permission !== false), to: access(permission) },
    ].filter(Boolean);
    const dirty = changes.length > 0;
    const edited = (a, b) => (String(a) !== String(b) ? "!border-primary/60" : "");

    return (
        <ModalShell onClose={onClose} busy={isPending} labelledBy="media-edit-t">
            <ModalHeader
                id="media-edit-t"
                avatar={<PosterThumb src={media._poster} Icon={TypeIcon} className="h-[60px] w-[42px]" />}
                title="Edit metadata"
                subtitle={<span className="font-mono">{media._filename}</span>}
                badges={
                    <ModalBadge tone={TYPE_TONE[media._type] || "primary"} icon={TypeIcon}>
                        {media._typeLabel}
                    </ModalBadge>
                }
                onClose={onClose}
                busy={isPending}
            />
            <ModalContent>
                <ModalSection label="Title">
                    <input
                        id="media-edit-title"
                        type="text"
                        data-autofocus
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        className={`${INPUT_LG} ${edited(title, media._title || "")}`}
                        placeholder="Media title…"
                    />
                </ModalSection>

                <div className="grid shrink-0 grid-cols-1 items-start gap-4 sm:grid-cols-2">
                    <ModalSection label="Year">
                        <input
                            id="media-edit-year"
                            type="number"
                            value={year}
                            onChange={(e) => setYear(e.target.value)}
                            className={`${INPUT_LG} ${edited(year, media._year || "")}`}
                            placeholder="2024"
                            min={1900}
                            max={2099}
                        />
                    </ModalSection>
                    <ModalSection label="Type">
                        <ModalSegmented
                            label="Type"
                            value={type}
                            onChange={setType}
                            options={[
                                { value: "movie", label: "Movie", icon: Film },
                                { value: "series", label: "Series", icon: Tv2 },
                                { value: "anime", label: "Anime", icon: Swords },
                            ]}
                        />
                    </ModalSection>
                </div>

                {/* permission=true → Normal (allowed), permission=false → Restricted.
                    The switch is "Restrict access": ON means RESTRICTED (permission=false). */}
                <ModalSection label="Access & identity">
                    <div className={`${PANEL} divide-y divide-base-content/10 overflow-hidden`}>
                        <label className="flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-base-content/5">
                            <span className="grid size-9 shrink-0 place-items-center rounded-full border border-base-content/10 bg-base-200">
                                {permission ? <Shield size={16} className="text-success" /> : <ShieldOff size={16} className="text-error" />}
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block text-[13px] font-medium text-base-content">{permission ? "Normal access" : "Restricted"}</span>
                                <span className="block text-xs text-base-content/60">
                                    {permission ? "Media is accessible. Turn on to restrict it." : "Access is restricted. Turn off to allow it."}
                                </span>
                            </span>
                            <span className="text-xs text-base-content/60">{permission ? "Off" : "On"}</span>
                            <ModalToggle value={!permission} onChange={(v) => setPermission(!v)} label="Restrict access" />
                        </label>
                        <div className="flex min-h-12 items-center gap-4 px-4 py-2">
                            <span className="w-28 shrink-0 text-xs text-base-content/60">Media ID</span>
                            <span className="min-w-0 flex-1 truncate font-mono text-xs text-base-content/90">{media._id}</span>
                            <ModalCopyButton text={media._id} label="media ID" />
                        </div>
                    </div>
                </ModalSection>

                {error && (
                    <ModalCallout tone="error" icon={AlertTriangle} compact className="mt-auto">
                        {error.message || "Failed to update media"}
                    </ModalCallout>
                )}
                <ModalReview
                    changes={changes}
                    saved={[
                        { name: "Title", value: media._title },
                        { name: "Year", value: media._year },
                        { name: "Type", value: TYPE_LABEL[media._type || "movie"] },
                        { name: "Access", value: access(media._permission !== false) },
                    ]}
                    className={error ? "" : "mt-auto"}
                />
            </ModalContent>
            <ModalFooter
                note={
                    dirty ? (
                        <span className="inline-flex items-center gap-1.5 text-warning">
                            <span className="size-2 rounded-full bg-warning" />
                            Unsaved changes
                        </span>
                    ) : (
                        <span className="text-base-content/60">No changes yet</span>
                    )
                }>
                <ModalButton onClick={onClose} disabled={isPending}>
                    Cancel
                </ModalButton>
                <ModalButton variant="primary" className="gap-1.5" onClick={handleSubmit} loading={isPending} loadingText="Saving…" disabled={!dirty}>
                    <Check size={14} />
                    Save changes
                </ModalButton>
            </ModalFooter>
        </ModalShell>
    );
}

// ─── Details Modal ────────────────────────────────────────────────────────────

function DetailsModal({ media, onClose }) {
    const [tab, setTab] = useState("overview");
    const linkDest = media._type === "movie" ? `/player/${media._id}` : `/series/${media._id}`;
    const config = TYPE_CONFIG[media._type] || TYPE_CONFIG.movie;
    const TypeIcon = config.Icon;

    // Fetches ffprobe-backed mediaInfo lazily on modal open — ONLY for movies.
    // Series/anime media._id is a synthetic group id (e.g. "series:series:wednesday"),
    // not a real scanned-file id, so GET /api/metadata/:id would always 404 for
    // them — findById() only matches real file ids. For series/anime we already
    // have everything we need on `media` itself (res/vcodec/acodec/_size/_duration
    // were merged in from the bulk /api/mediainfo fetch back in the table's
    // processItem, aggregated across all episodes there).
    const { data: fullData } = useQuery({
        queryKey: ["media-detail", media._id],
        queryFn: () => api.get(`/api/metadata/${media._id}`),
        staleTime: 1000 * 60 * 10,
        enabled: media._type === "movie",
    });

    // mediaInfoStore now returns an organized shape: { container, video, audioTracks, subtitleTracks }.
    // Cover-art "video" streams (embedded poster images) are already filtered
    // out server-side when video is picked, so no client-side filtering needed here.
    const mediaInfo = media._type === "movie" ? fullData?.mediaInfo : null;
    const video = mediaInfo?.video || null;
    const primaryAudio = mediaInfo?.audioTracks?.[0] || null;

    // Movies: prefer freshly-fetched single-file data, fall back to row data.
    // Series/anime: row data IS the data (already aggregated across episodes
    // back in the table's processItem — see _resolution/_fps/_bitrate/etc).
    const realRes = video?.height ? (video.height >= 2000 ? "4K" : video.height >= 1000 ? "1080p" : video.height >= 700 ? "720p" : "480p") : media.res;

    const realDuration = mediaInfo?.container?.durationSeconds || (media.metadata?.runtime ? media.metadata.runtime * 60 : media._duration);
    const realSize = mediaInfo?.container?.sizeBytes || media._size;
    const realAdded = media.metadata?.date || media._added;
    const realResolution = video?.resolution || media._resolution;
    const realFps = video?.frameRate || media._fps; // already a formatted string like "23.976 fps" — no parsing needed
    const realBitrate = mediaInfo?.container?.bitrateBps || media._bitrate;
    const realChannels = primaryAudio?.channels || media._audioChannels;
    const realAudioLang = primaryAudio?.language || media._audioLang;

    const linkUrl = typeof window !== "undefined" ? `${window.location.origin}${linkDest}` : linkDest;
    const tone = TYPE_TONE[media._type] || "primary";

    const specs = [
        { label: "Resolution", icon: Monitor, tone: "text-info", value: realResolution },
        { label: "Frame rate", icon: Gauge, tone: "text-success", value: realFps || null },
        { label: "Bitrate", icon: Database, tone: "text-warning", value: realBitrate ? `${(realBitrate / 1_000_000).toFixed(1)} Mbps` : null },
        { label: "Audio", icon: Volume2, tone: "text-accent", value: realChannels ? `${realChannels}ch${realAudioLang ? ` · ${realAudioLang}` : ""}` : null },
    ].filter((x) => x.value);

    const monoRow = (icon, label, value) => (
        <ModalKV icon={icon} label={label} mono action={value ? <ModalCopyButton text={value} label={label.toLowerCase()} /> : null}>
            <span title={value}>{value || "—"}</span>
        </ModalKV>
    );

    const techGroups = [
        {
            label: "Summary",
            rows: [
                realResolution && { label: "Resolution", value: realResolution },
                realRes && { label: "Quality", value: realRes },
                realFps && { label: "Frame rate", value: realFps },
                realBitrate && { label: "Bitrate", value: `${(realBitrate / 1_000_000).toFixed(2)} Mbps` },
                realDuration && { label: "Duration", value: fmtDuration(realDuration) },
                realSize && { label: "Size", value: fmtBytes(realSize) },
                media.vcodec && { label: "Video codec", value: media.vcodec },
                media.acodec && { label: "Audio codec", value: media.acodec },
                realChannels && { label: "Audio", value: `${realChannels}ch${realAudioLang ? ` · ${realAudioLang}` : ""}` },
            ].filter(Boolean),
        },
        { label: "Container", rows: metaRows(mediaInfo?.container) },
        { label: "Video stream", rows: metaRows(mediaInfo?.video) },
        ...(mediaInfo?.audioTracks || []).map((t, i) => ({ label: `Audio track ${i + 1}`, rows: metaRows(t) })),
        ...(mediaInfo?.subtitleTracks || []).map((t, i) => ({ label: `Subtitle track ${i + 1}`, rows: metaRows(t) })),
    ].filter((g) => g.rows.length > 0);

    const genres = media.metadata?.genres || [];
    const cast = media.metadata?.cast || [];
    const audioCount = mediaInfo?.audioTracks?.length;
    const subCount = mediaInfo?.subtitleTracks?.length;

    return (
        <ModalShell onClose={onClose} labelledBy="media-details-t">
            <ModalHeader
                id="media-details-t"
                avatar={<PosterThumb src={media._poster} Icon={TypeIcon} />}
                title={media._title}
                subtitle={<span className="font-mono">{media._filename}</span>}
                badges={
                    <>
                        <ModalBadge tone={tone} icon={TypeIcon}>
                            {media._typeLabel}
                        </ModalBadge>
                        {media._year && <ModalBadge>{media._year}</ModalBadge>}
                        {realRes && <ModalBadge tone={realRes === "4K" ? "warning" : realRes === "1080p" ? "success" : "info"}>{realRes}</ModalBadge>}
                        {media._permission ? (
                            <ModalBadge tone="success" icon={Shield}>
                                Normal
                            </ModalBadge>
                        ) : (
                            <ModalBadge tone="error" icon={ShieldOff}>
                                Restricted
                            </ModalBadge>
                        )}
                    </>
                }
                onClose={onClose}
            />
            <ModalTabs
                value={tab}
                onChange={setTab}
                tabs={[
                    { id: "overview", label: "Overview", icon: Info },
                    { id: "technical", label: "Technical", icon: Monitor },
                    { id: "file", label: "File", icon: FolderOpen },
                ]}
            />
            <ModalContent>
                {tab === "overview" && (
                    <div role="tabpanel" id="panel-overview" aria-labelledby="tab-overview" className="flex shrink-0 flex-col gap-4">
                        <ModalStats
                            items={[
                                { icon: Calendar, tone: "text-info", label: "Year", value: media._year || "—" },
                                { icon: Star, tone: "text-warning", label: "Quality", value: realRes ? `${realRes}${video ? ` · ${video.width}×${video.height}` : ""}` : "—" },
                                { icon: Clock, tone: "text-accent", label: "Duration", value: fmtDuration(realDuration) },
                                { icon: HardDrive, tone: "text-success", label: "Size", value: fmtBytes(realSize) },
                            ]}
                        />

                        <ModalSection label="Overview">
                            <div className={`${PANEL} flex flex-col gap-2 p-4`}>
                                {media.metadata?.overview ? (
                                    <>
                                        {media.metadata?.tagline && <p className="text-xs italic text-base-content/60">“{media.metadata.tagline}”</p>}
                                        <p className="text-[13px] leading-relaxed text-base-content/90">{media.metadata.overview}</p>
                                    </>
                                ) : (
                                    <p className="flex items-center gap-2 text-[13px] text-base-content/55">
                                        <Info size={15} className="shrink-0 text-info" />
                                        No description yet. Metadata comes from TMDB once this title is matched.
                                    </p>
                                )}
                            </div>
                        </ModalSection>

                        <ModalSection label="Genres">
                            {genres.length > 0 ? (
                                <div className="flex flex-wrap gap-2">
                                    {genres.map((g) => (
                                        <ModalBadge key={g} tone="primary">
                                            {g}
                                        </ModalBadge>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-[13px] text-base-content/50">No genres yet.</p>
                            )}
                        </ModalSection>
                    </div>
                )}

                {tab === "technical" && (
                    <div role="tabpanel" id="panel-technical" aria-labelledby="tab-technical" className="flex flex-1 flex-col gap-4">
                        {techGroups.length === 0 ? (
                            <ModalCallout tone="info" compact>
                                No technical details available for this title yet.
                            </ModalCallout>
                        ) : (
                            <div className={`${PANEL} overflow-hidden`}>
                                <table className="w-full table-fixed border-collapse text-left text-[13px]">
                                    <thead>
                                        <tr className="border-b border-base-content/10 bg-base-content/5 text-xs text-base-content/65">
                                            <th className="w-2/5 px-4 py-2.5 font-medium">Property</th>
                                            <th className="px-4 py-2.5 font-medium">Value</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {techGroups.map((g) => (
                                            <Fragment key={g.label}>
                                                <tr className="border-y border-base-content/10 bg-base-200/60">
                                                    <td colSpan={2} className="px-4 py-2 text-xs font-medium uppercase tracking-wider text-base-content/60">
                                                        {g.label}
                                                    </td>
                                                </tr>
                                                {g.rows.map((r) => (
                                                    <tr key={`${g.label}-${r.label}`} className="border-b border-base-content/10 last:border-b-0">
                                                        <td className="px-4 py-2.5 align-top text-xs text-base-content/60">{r.label}</td>
                                                        <td className="break-words px-4 py-2.5 align-top text-base-content tabular-nums">{r.value}</td>
                                                    </tr>
                                                ))}
                                            </Fragment>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {tab === "file" && (
                    <div role="tabpanel" id="panel-file" aria-labelledby="tab-file" className="flex shrink-0 flex-col gap-4">
                        <ModalSection label="File information">
                            <ModalRows>
                                <ModalKV icon={FolderOpen} tone="text-primary" label="Library">
                                    {media._library || "—"}
                                </ModalKV>
                                <ModalKV icon={Calendar} tone="text-info" label="Added">
                                    {fmtDate(realAdded)}
                                </ModalKV>
                                {media.metadata?.rating && (
                                    <ModalKV icon={Star} tone="text-warning" label="TMDB rating">
                                        <span className="tabular-nums">{media.metadata.rating}</span>
                                    </ModalKV>
                                )}
                                {media.metadata?.status && (
                                    <ModalKV icon={Info} label="Status">
                                        {media.metadata.status}
                                    </ModalKV>
                                )}
                                {media.metadata?.language && (
                                    <ModalKV icon={Languages} label="Language">
                                        {media.metadata.language.toUpperCase()}
                                    </ModalKV>
                                )}
                                <ModalKV icon={media._permission ? Shield : ShieldOff} tone={media._permission ? "text-success" : "text-error"} label="Access">
                                    <span className={media._permission ? "text-success" : "text-error"}>{media._permission ? "Normal" : "Restricted"}</span>
                                </ModalKV>
                            </ModalRows>
                        </ModalSection>

                        <ModalSection label="Links & IDs">
                            <ModalRows>
                                {monoRow(Play, "Player link", linkUrl)}
                                {monoRow(FolderOpen, "File path", media._path)}
                                {monoRow(Database, "Media ID", media._id)}
                            </ModalRows>
                        </ModalSection>
                    </div>
                )}
            </ModalContent>
            <ModalFooter note="Read only">
                <ModalButton onClick={onClose}>Close</ModalButton>
                <Link to={linkDest} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-primary gap-1.5 rounded-md border border-primary hover:brightness-110 [--depth:0] [--noise:0]">
                    <Play size={14} />
                    Play now
                </Link>
            </ModalFooter>
        </ModalShell>
    );
}

// ─── Delete Modal ─────────────────────────────────────────────────────────────

function DeleteModal({ media, onClose, onConfirm, isPending, error }) {
    const TypeIcon = (TYPE_CONFIG[media._type] || TYPE_CONFIG.movie).Icon;
    return (
        <ConfirmModal
            open
            badge={false}
            onClose={onClose}
            onConfirm={() => onConfirm(media._id)}
            loading={isPending}
            error={error ? error.message || "Failed to delete" : null}
            variant="danger"
            title={`Delete ${media._title}?`}
            subtitle={<span className="font-mono">{media._filename}</span>}
            confirmIcon={Trash2}
            confirmText="Delete media"
            timeline={[
                { icon: Database, tone: "text-error", title: "Always", text: "This entry is removed from the database." },
                { icon: AlertTriangle, tone: "text-warning", title: "Depends on server settings", text: "The physical file may also be removed." },
            ]}
            note="This action cannot be undone."
            noteTone="error">
            <ModalSection label="You are about to delete">
                <div className={`${PANEL} flex items-center gap-4 px-4 py-3`}>
                    <PosterThumb src={media._poster} Icon={TypeIcon} />
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-base-content">{media._title}</p>
                        <p className="truncate font-mono text-xs text-base-content/55">{media._filename}</p>
                    </div>
                    <ModalBadge tone={TYPE_TONE[media._type] || "primary"} icon={TypeIcon}>
                        {media._typeLabel}
                    </ModalBadge>
                </div>
            </ModalSection>
            <ModalStats
                items={[
                    { icon: Calendar, tone: "text-info", label: "Year", value: media._year || "—" },
                    { icon: HardDrive, tone: "text-success", label: "Size", value: fmtBytes(media._size) },
                    { icon: FolderOpen, tone: "text-primary", label: "Library", value: media._library || "—" },
                ]}
            />
        </ConfirmModal>
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
