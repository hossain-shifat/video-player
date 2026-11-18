// web/src/Dashboard/Components/MediaDash/mediaDashUtils.js
// Pure helpers for the DashMedia page: formatters, the playback-compatibility rules, and the one function that
// turns /api/media + /api/mediainfo + /api/permissions + /api/mediainfo/added-dates into rows, stats and chart data.
// No React in here, so every number on the page can be checked in one place.

import { Film, Tv2, Swords } from "lucide-react";

// ─── Formatters ───────────────────────────────────────────────────────────────

export const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
export const pct = (v, total) => (total > 0 ? Math.round((v / total) * 100) : 0);

export function fmtBytes(n) {
    if (!n || n <= 0) return "0 B";
    const u = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < u.length - 1) {
        v /= 1024;
        i++;
    }
    return `${i >= 4 ? v.toFixed(2) : v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

export function fmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function fmtDay(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function fmtYear(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : String(d.getFullYear());
}

export function fmtDuration(seconds) {
    if (!seconds) return "—";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function fmtBitrate(bps) {
    if (!bps || bps <= 0) return "—";
    return bps >= 1_000_000 ? `${(bps / 1_000_000).toFixed(1)} Mbps` : `${Math.round(bps / 1000)} Kbps`;
}

// hours (number) → "42m" / "3.5 h" / "120 h"
export function fmtHours(h) {
    if (!h) return "0 h";
    if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
    return `${h >= 100 ? Math.round(h) : Math.round(h * 10) / 10} h`;
}

export function fmtCount(n) {
    const v = num(n);
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 10_000) return `${Math.round(v / 1000)}K`;
    return v.toLocaleString();
}

export const pad2 = (n) => String(n).padStart(2, "0");
// Serial number for table rows: 1 → "01", continues across pages.
export const sl = (n) => String(n).padStart(2, "0");

// ─── Playback compatibility (an ESTIMATE — edit these lists to match your clients) ──────────────────────────
// The server decides the real mode per session (transcoderService / hwAccel). These lists only classify the
// library in bulk so the dashboard can show how much of it plays without work. Codec names are the uppercase
// strings mediaInfoStore.js writes (video.codec, audioTracks[].codec).

export const PLAYBACK_RULES = {
    directContainers: ["mp4", "m4v", "mov", "mkv", "webm"],
    directVideo: ["H264", "HEVC", "H265", "VP9", "VP8", "AV1"],
    directAudio: ["AAC", "MP3", "OPUS", "VORBIS", "FLAC", "AC3", "EAC3", "ALAC"],
    imageSubtitles: ["hdmv_pgs_subtitle", "pgssub", "dvd_subtitle", "dvdsub", "dvb_subtitle", "xsub"],
};

const isDirectAudio = (codec) => PLAYBACK_RULES.directAudio.includes(codec) || codec.startsWith("PCM");

// → { status: "direct" | "remux" | "transcode" | "unknown", cause: null | "video" | "audio" | "container" | "subs" }
export function classifyPlayback(info, container) {
    if (!info) return { status: "unknown", cause: null };

    const vcodec = String(info.video?.codec || "").toUpperCase();
    if (vcodec && !PLAYBACK_RULES.directVideo.includes(vcodec)) return { status: "transcode", cause: "video" };

    const audio = (info.audioTracks || []).map((a) => String(a.codec || "").toUpperCase()).filter(Boolean);
    if (audio.length > 0 && !audio.some(isDirectAudio)) return { status: "transcode", cause: "audio" };

    if (!PLAYBACK_RULES.directContainers.includes(String(container || "").toLowerCase())) return { status: "remux", cause: "container" };

    const subs = info.subtitleTracks || [];
    const imageOnly = subs.length > 0 && subs.every((s) => PLAYBACK_RULES.imageSubtitles.includes(String(s.codec || "").toLowerCase()));
    return { status: "direct", cause: imageOnly ? "subs" : null };
}

export const CAUSE_LABEL = { video: "Video codec", audio: "Audio codec", container: "Container", subs: "Image subtitles" };

// ─── Names ────────────────────────────────────────────────────────────────────

const FORMAT_NAMES = {
    MKV: "Matroska",
    MP4: "MPEG-4",
    M4V: "MPEG-4",
    MOV: "QuickTime",
    AVI: "AVI",
    WEBM: "WebM",
    TS: "MPEG-TS",
    M2TS: "MPEG-TS",
    MTS: "MPEG-TS",
    WMV: "WMV",
    ASF: "ASF",
    FLV: "Flash Video",
    MPG: "MPEG-PS",
    MPEG: "MPEG-PS",
    OGV: "Ogg Video",
    "3GP": "3GPP",
    OTHER: "Other",
    UNKNOWN: "Unprobed",
};
export const formatName = (label) => FORMAT_NAMES[label] || label;

// ffprobe subtitle codec names → what an admin recognises
const SUB_LABELS = { SUBRIP: "SRT", SRT: "SRT", ASS: "ASS", SSA: "SSA", WEBVTT: "WebVTT", MOV_TEXT: "tx3g", HDMV_PGS_SUBTITLE: "PGS", PGSSUB: "PGS", DVD_SUBTITLE: "VobSub", DVDSUB: "VobSub", DVB_SUBTITLE: "DVB", TEXT: "Text" };
export const subLabel = (codec) => SUB_LABELS[String(codec || "").toUpperCase()] || String(codec || "").toUpperCase();

export const LANG_NAMES = {
    en: "English",
    bn: "Bangla",
    hi: "Hindi",
    ar: "Arabic",
    es: "Spanish",
    fr: "French",
    de: "German",
    it: "Italian",
    pt: "Portuguese",
    ru: "Russian",
    tr: "Turkish",
    ja: "Japanese",
    ko: "Korean",
    zh: "Chinese",
    ta: "Tamil",
    te: "Telugu",
    ur: "Urdu",
};
export const langName = (code) => LANG_NAMES[String(code || "").toLowerCase()] || String(code || "?").toUpperCase();

export const TYPE_META = {
    movie: { label: "Movie", plural: "Movies", Icon: Film, tone: "primary" },
    series: { label: "Series", plural: "Series", Icon: Tv2, tone: "secondary" },
    anime: { label: "Anime", plural: "Anime", Icon: Swords, tone: "accent" },
};

// ─── Filename fallbacks (used only until ffprobe has reached a file) ─────────────────────────────────────────

export function extractTags(filename) {
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

const extOf = (p) => {
    const m = String(p || "").match(/\.([a-z0-9]{2,5})$/i);
    return m ? m[1].toLowerCase() : "";
};

// Only these count as a REAL container extension (used when STRICT_CONTAINERS is on).
const KNOWN_EXT = new Set(["mkv", "mp4", "m4v", "mov", "avi", "wmv", "asf", "flv", "webm", "ts", "m2ts", "mts", "mpg", "mpeg", "ogv", "3gp", "vob", "divx", "rmvb", "mxf"]);

// ffprobe format_name (first token wins) → the label shown in the table (strict mode).
const PROBE_FORMAT = { matroska: "MKV", webm: "WEBM", mov: "MP4", mp4: "MP4", avi: "AVI", asf: "WMV", flv: "FLV", mpegts: "TS", mpeg: "MPG", mpegvideo: "MPG", ogg: "OGV", rm: "RMVB", "3gp": "3GP" };

// How the File formats table decides a title's container:
//   false (default) — whatever follows the last dot in the filename ("MKV", but also release-name endings such as
//                     "TV", "NL", "ESUB"), else ffprobe's format name. Shows every distinct suffix in the library.
//   true            — only real video extensions; anything else uses ffprobe's container, so release-name endings
//                     are folded into MKV / MP4 / … and the table only lists real containers.
export const STRICT_CONTAINERS = false;

const isExt = (ext) => (STRICT_CONTAINERS ? KNOWN_EXT.has(ext) : !!ext);

function containerLabel(path, info) {
    const ext = extOf(path);
    if (isExt(ext)) return ext.toUpperCase();
    const names = String(info?.container?.format || "").toLowerCase().split(",").map((n) => n.trim());
    if (STRICT_CONTAINERS) {
        for (const n of names) if (PROBE_FORMAT[n]) return PROBE_FORMAT[n];
        return "OTHER";
    }
    return names[0] ? names[0].toUpperCase() : "UNKNOWN";
}

const bump = (map, key, by = 1) => {
    if (key) map.set(key, (map.get(key) || 0) + by);
};
const top = (map, n = 3) =>
    [...map.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([k]) => k);

const normTitle = (s) =>
    String(s || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "");

// Every file of an item: a movie is one file, a series/anime group has one per episode.
function filesOf(item, type) {
    if (type === "movie") return [{ id: item.id, path: item.path || item.name || "", name: item.name || "" }];
    const out = [];
    for (const season of Object.values(item.seasons || {})) {
        for (const ep of season.episodes || []) out.push({ id: ep.id, path: ep.path || ep.name || "", name: ep.name || "" });
    }
    return out;
}

// ─── The one big derivation ───────────────────────────────────────────────────

export function buildLibrary({ mediaData, mediaInfoMap, permissionsMap, addedDatesMap }) {
    const empty = {
        allMedia: [],
        metrics: { total: 0, movies: 0, series: 0, anime: 0, size: 0 },
        stats: { directPct: 0, directCount: 0, transcode: 0, remux: 0, known: 0, attention: 0, duplicateBytes: 0, duplicateTitles: 0 },
        formats: [],
        formatSource: { ext: 0, probe: 0, unprobed: 0 },
        quality: [],
        causes: [],
        typeShare: [],
        libraries: [],
    };
    if (!mediaData) return empty;

    const items = [];
    const libs = new Map();
    let totalSize = 0;
    (mediaData.folders || []).forEach((f) => libs.set(f.id, f.label || f.path));

    const formatMap = new Map();
    const formatSource = { ext: 0, probe: 0, unprobed: 0 }; // where each title's container label came from
    const fmtRow = (label) => {
        if (!formatMap.has(label)) {
            formatMap.set(label, {
                label,
                titles: 0,
                files: 0,
                bytes: 0,
                bitrateSum: 0,
                bitrateN: 0,
                vcodecs: new Map(),
                acodecs: new Map(),
                subs: new Map(),
                status: { direct: 0, remux: 0, transcode: 0, unknown: 0 },
                titleIds: new Set(),
            });
        }
        return formatMap.get(label);
    };

    const processItem = (item, type) => {
        const meta = TYPE_META[type];
        const title = item.metadata?.name || item.metadata?.title || item.name || item.title || "Unknown";
        const originalTitle = item.metadata?.original_title || item.metadata?.original_name || "";
        const year = item.metadata?.year || item.year || null;
        const size = item.sizeBytes || 0;
        const duration = item.metadata?.duration || item.duration || null;

        totalSize += size;

        // Movies carry the real filename on item.name. Series/anime are group objects — the filename with
        // quality/codec tags lives on the first episode of the first season instead.
        let sourceFilename = item.name || item.path || "";
        if (!sourceFilename && item.seasons) {
            const firstSeason = Object.values(item.seasons)[0];
            const firstEpisode = firstSeason?.episodes?.[0];
            sourceFilename = firstEpisode?.name || firstEpisode?.path || "";
        }
        const tags = extractTags(sourceFilename || item.title || "");

        // Real ffprobe data. Movies: item.id is the file id. Series/anime: mediaInfoStore is keyed per EPISODE, so
        // the first episode that already has data is the representative for quality/codec, sizes are summed over
        // every probed episode, and the added date is the most recently added episode (Plex/Jellyfin convention).
        let repInfo = null;
        let repPath = type === "movie" ? item.path || item.name || "" : "";
        let seriesTotalSize = 0;
        let seriesLatestAdded = 0;
        const files = filesOf(item, type);

        for (const f of files) {
            const info = mediaInfoMap[f.id];
            if (info) {
                if (type !== "movie") seriesTotalSize += info.container?.sizeBytes || 0;
                if (!repInfo) {
                    repInfo = info;
                    repPath = f.path;
                }
                // file-level format stats
                const row = fmtRow(containerLabel(f.path, info));
                row.files += 1;
                row.bytes += info.container?.sizeBytes || 0;
                if (info.container?.bitrateBps) {
                    row.bitrateSum += info.container.bitrateBps;
                    row.bitrateN += 1;
                }
                bump(row.vcodecs, info.video?.codec);
                (info.audioTracks || []).slice(0, 1).forEach((a) => bump(row.acodecs, a.codec));
                (info.subtitleTracks || []).forEach((s) => bump(row.subs, subLabel(s.codec)));
            }
            if (type !== "movie") {
                const t = addedDatesMap[f.id] ? new Date(addedDatesMap[f.id]).getTime() : 0;
                if (t > seriesLatestAdded) seriesLatestAdded = t;
            }
        }

        const video = repInfo?.video || null;
        const primaryAudio = repInfo?.audioTracks?.[0] || null;
        const realRes = video?.height ? (video.height >= 2000 ? "4K" : video.height >= 1000 ? "1080p" : video.height >= 700 ? "720p" : "480p") : null;
        const finalTags = {
            res: realRes || tags.res,
            vcodec: video?.codec || tags.vcodec,
            acodec: primaryAudio?.codec || tags.acodec,
        };
        const realSize = type === "movie" ? repInfo?.container?.sizeBytes : seriesTotalSize;
        const added = type === "movie" ? item.addedAt || item.metadata?.date || null : seriesLatestAdded || item.metadata?.date || null;

        let poster = item.metadata?.poster;
        if (poster && poster.startsWith("/")) poster = `https://image.tmdb.org/t/p/w200${poster}`;

        const container = repInfo ? containerLabel(repPath, repInfo) : isExt(extOf(repPath || sourceFilename)) ? extOf(repPath || sourceFilename).toUpperCase() : "UNKNOWN";
        const playback = classifyPlayback(repInfo, container);
        if (repInfo) {
            const row = fmtRow(container);
            row.titles += 1;
            row.status[playback.status] += 1;
            row.titleIds.add(item.id);
            if (isExt(extOf(repPath))) formatSource.ext += 1;
            else formatSource.probe += 1;
        } else {
            // not probed yet: keep the title visible instead of silently dropping it from the table
            const row = fmtRow("UNKNOWN");
            row.titles += 1;
            row.bytes += size;
            row.status.unknown += 1;
            formatSource.unprobed += 1;
        }

        const noMeta = !item.metadata || (!item.metadata.name && !item.metadata.title && !item.metadata.poster);
        const noPoster = !poster;

        items.push({
            ...item,
            _id: item.id,
            _type: type,
            _typeLabel: meta.label,
            _icon: meta.Icon,
            _title: title,
            _originalTitle: originalTitle,
            _year: year,
            _size: realSize || size,
            _added: added ? new Date(added) : null,
            _duration: repInfo?.container?.durationSeconds || duration,
            _library: item.folderLabel || libs.get(item.folderId) || "Unknown",
            _libraryId: item.folderId,
            _poster: poster,
            _filename: sourceFilename || item.name || item.path || "",
            _path: item.path || "",
            _permission: permissionsMap[item.id] !== false,
            _resolution: video?.resolution || null,
            _fps: video?.frameRate || null,
            _bitrate: repInfo?.container?.bitrateBps || null,
            _audioChannels: primaryAudio?.channels || null,
            _audioLang: primaryAudio?.language || null,
            // added for the redesigned page
            _container: container,
            _playback: playback,
            _flags: { noMeta, noPoster, dup: false },
            _dupCount: 1,
            ...finalTags,
        });
    };

    (mediaData.movies?.items || []).forEach((m) => processItem(m, "movie"));
    (mediaData.series?.items || []).forEach((s) => processItem(s, "series"));
    (mediaData.anime?.items || []).forEach((a) => processItem(a, "anime"));

    // ── duplicates: same type + title + year seen more than once ──
    const groups = new Map();
    for (const it of items) {
        const key = `${it._type}:${normTitle(it._title)}:${it._year || ""}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(it);
    }
    let duplicateBytes = 0;
    let duplicateTitles = 0;
    for (const g of groups.values()) {
        if (g.length < 2) continue;
        duplicateTitles += g.length - 1;
        const sorted = [...g].sort((a, b) => b._size - a._size);
        sorted.slice(1).forEach((x) => (duplicateBytes += x._size));
        g.forEach((x) => {
            x._flags.dup = true;
            x._dupCount = g.length;
        });
    }

    // ── playback stats + transcode causes ──
    let direct = 0;
    let remux = 0;
    let transcode = 0;
    const causeCount = { video: 0, audio: 0, container: 0, subs: 0 };
    for (const it of items) {
        const p = it._playback;
        if (p.status === "direct") direct++;
        else if (p.status === "remux") remux++;
        else if (p.status === "transcode") transcode++;
        if (p.cause) causeCount[p.cause]++;
    }
    const known = direct + remux + transcode;

    // ── quality mix per type ──
    const bucket = (res) => (res === "4K" ? "4K" : res === "1080p" ? "1080p" : res === "720p" ? "720p" : res ? "SD" : null);
    const quality = ["movie", "series", "anime"].map((type) => {
        const rows = items.filter((i) => i._type === type);
        const c = { "4K": 0, "1080p": 0, "720p": 0, SD: 0 };
        rows.forEach((r) => {
            const b = bucket(r.res);
            if (b) c[b]++;
        });
        const total = c["4K"] + c["1080p"] + c["720p"] + c.SD;
        return { type, titles: rows.length, known: total, counts: c, below: c["720p"] + c.SD };
    });

    // ── storage share by type ──
    const bytesByType = { movie: 0, series: 0, anime: 0 };
    items.forEach((i) => (bytesByType[i._type] += i._size));
    const typeShare = ["movie", "series", "anime"].map((type) => ({ type, bytes: bytesByType[type], share: pct(bytesByType[type], totalSize) }));

    // ── formats ──
    const formats = [...formatMap.values()]
        .map((r) => {
            const total = r.status.direct + r.status.remux + r.status.transcode;
            const status = total === 0 ? "unknown" : r.status.transcode > 0 && r.status.transcode >= r.status.remux && r.status.transcode >= r.status.direct ? "transcode" : r.status.remux > r.status.direct ? "remux" : "direct";
            return {
                label: r.label,
                name: formatName(r.label),
                titles: r.titles,
                files: r.files,
                bytes: r.bytes,
                avgBitrate: r.bitrateN ? r.bitrateSum / r.bitrateN : 0,
                vcodecs: top(r.vcodecs),
                acodecs: top(r.acodecs),
                subs: top(r.subs, 3),
                status,
                needWork: r.status.transcode,
                total,
            };
        })
        .sort((a, b) => b.titles - a.titles);

    const attention = items.filter((i) => i._flags.noMeta || i._flags.noPoster || i._flags.dup).length;

    return {
        allMedia: items,
        metrics: {
            total: items.length,
            movies: mediaData.movies?.total || 0,
            series: mediaData.series?.total || 0,
            anime: mediaData.anime?.total || 0,
            size: totalSize,
        },
        stats: {
            directPct: pct(direct, known),
            directCount: direct,
            transcode,
            remux,
            known,
            attention,
            duplicateBytes,
            duplicateTitles,
        },
        formats,
        formatSource,
        quality,
        causes: Object.entries(causeCount)
            .map(([key, count]) => ({ key, label: CAUSE_LABEL[key], count }))
            .sort((a, b) => b.count - a.count),
        typeShare,
        libraries: (mediaData.folders || []).map((f) => ({ id: f.id, label: f.label || f.path })),
    };
}

// ─── CSV export (client-side) ─────────────────────────────────────────────────

export function downloadCsv(filename, header, rows) {
    const esc = (v) => {
        const s = v == null ? "" : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [header, ...rows].map((r) => r.map(esc).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Runs fn over ids a few at a time and reports how many worked.
export async function runBatch(ids, fn, size = 4) {
    let ok = 0;
    let failed = 0;
    for (let i = 0; i < ids.length; i += size) {
        const res = await Promise.allSettled(ids.slice(i, i + size).map(fn));
        res.forEach((r) => (r.status === "fulfilled" ? ok++ : failed++));
    }
    return { ok, failed };
}
