// web/src/Dashboard/Pages/DashMedia.jsx
import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Info, SquarePen, Trash2, Ellipsis, SquareCheck, RefreshCw, Shield, ShieldOff, Download, FolderOpen, Search, X, Copy, Database } from "lucide-react";
import { api } from "../Shared";
import { MediaDeleteModal, MediaDetailsModal, MediaEditModal } from "../Components/DashModal";
import { useOverviewAnalytics } from "../Hooks/useOverviewAnalytics";
import { useDashboardStreams } from "../Hooks/useDashboard";
import SubtitlesTable from "../Components/MediaDash/SubtitlesTable";
import FormatsTable from "../Components/MediaDash/FormatsTable";
import {
    Panel,
    SectionLabel,
    Note,
    Empty,
    Skel,
    Dot,
    Badge,
    Toggle,
    Seg,
    SearchBox,
    SelectBox,
    ToolBtn,
    IconBtn,
    ActionBtn,
    PosterTile,
    Pagination,
    PortalMenu,
    HourBars,
    ShareCompare,
    RankedBars,
    QualityMix,
    QualityLegend,
    ShareLegend,
    quietWindow,
    QUALITY_TONE,
} from "../Components/MediaDash/MediaDashParts";
import { buildLibrary, buildPosterIndex, downloadCsv, fmtBytes, fmtDay, fmtYear, pad2, pct, num, runBatch, sl, TYPE_META } from "../Components/MediaDash/mediaDashUtils";

const PAGE_SIZE = 8;
const WEEK = 7 * 86400000;

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ toast }) {
    if (!toast) return null;
    return createPortal(
        <div
            className={`fixed bottom-5 right-5 z-99999 flex items-center gap-2 px-4 py-3
            rounded-lg shadow-2xl text-sm font-semibold max-w-sm
            ${toast.type === "error" ? "bg-error text-error-content" : "bg-success text-success-content"}`}>
            {toast.type === "error" ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
            <span>{toast.msg}</span>
        </div>,
        document.body,
    );
}

// ─── Stat strip ───────────────────────────────────────────────────────────────

function Stat({ label, value, sub, dot, subTone, onClick }) {
    const Tag = onClick ? "button" : "div";
    return (
        <Tag type={onClick ? "button" : undefined} onClick={onClick} className={`min-w-0 bg-base-200 px-4 py-3 text-left ${onClick ? "cursor-pointer transition-colors hover:bg-base-300" : ""}`}>
            <p className="text-sm text-base-content/80">{label}</p>
            <p className="mt-0.5 flex items-center gap-2 text-xl font-semibold leading-tight tabular-nums text-base-content">
                {dot && <Dot />}
                {value}
            </p>
            {sub && <p className={`truncate text-[13px] ${subTone === "primary" ? "font-medium text-primary" : "text-base-content/70"}`}>{sub}</p>}
        </Tag>
    );
}

function StatSkeleton() {
    return (
        <div className="grid grid-cols-2 gap-px bg-base-300 @2xl:grid-cols-3 @5xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="bg-base-200 px-4 py-3">
                    <Skel className="mb-2 h-3 w-16" />
                    <Skel className="h-5 w-12" />
                </div>
            ))}
        </div>
    );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashMedia({ onNavigate } = {}) {
    const queryClient = useQueryClient();
    const tableRef = useRef(null);

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
        dataUpdatedAt,
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
    const { data: permissionsData } = useQuery({
        queryKey: ["admin", "permissions"],
        queryFn: () => api.get("/api/permissions"),
        staleTime: 1000 * 60 * 5,
    });
    const permissionsMap = permissionsData?.permissions || {};

    // Real per-file added dates — bulk-fetched, keyed by real file id, works for every individual episode.
    const { data: addedDatesData } = useQuery({
        queryKey: ["admin", "added-dates"],
        queryFn: () => api.get("/api/mediainfo/added-dates"),
        staleTime: 1000 * 60 * 5,
    });
    const addedDatesMap = addedDatesData?.dates || {};

    // Watch-time analytics (same source the Overview page uses) and live streams.
    const analyticsQuery = useOverviewAnalytics();
    const an = analyticsQuery.data ?? null;
    const streamsQuery = useDashboardStreams();

    const updateMutation = useMutation({
        // REAL persist: permission goes to the /api/permissions endpoint (permissionsStore.js on the backend).
        //
        // TMDB refresh is best-effort and ONLY attempted for movies — series/anime use a synthetic group id
        // (e.g. "series:fatal seduction") that is never a real scanned-file id, so /api/metadata/refresh/:id always
        // 404s for them. Skipping avoids that error entirely instead of just swallowing it.
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
            // Cosmetic, session-level: title/year edits patch the media list cache immediately so the table updates without a refetch.
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

    // The server has no DELETE /api/media/:id route yet, so Delete is hidden (row menu) / disabled (bulk bar).
    // Flip to true together with a real server-side delete.
    const DELETE_SUPPORTED = false;

    const deleteMutation = useMutation({
        mutationFn: (id) => api.delete(`/api/media/${id}`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["admin", "media"] });
            showToast("Media deleted");
            setDeleteMedia(null);
        },
        onError: (err) => {
            // a failed delete must NOT remove the title from the cache or claim success — it is still there
            showToast(err?.message || "Could not delete this title", "error");
            setDeleteMedia(null);
        },
    });

    // Access toggle in the table (permission only — the edit modal still does title/year).
    const permissionMutation = useMutation({
        mutationKey: ["admin", "permission-write"],
        mutationFn: ({ id, allow }) => api.post(`/api/permissions/${id}`, { permission: allow }),
        onMutate: async ({ id, allow }) => {
            await queryClient.cancelQueries({ queryKey: ["admin", "permissions"] });
            const prevPerms = queryClient.getQueryData(["admin", "permissions"])?.permissions || {};
            const had = Object.prototype.hasOwnProperty.call(prevPerms, id);
            queryClient.setQueryData(["admin", "permissions"], (old) => ({ ...old, permissions: { ...(old?.permissions || {}), [id]: allow } }));
            return { id, allow, had, prev: prevPerms[id] }; // only THIS id's old value — never a whole-cache snapshot
        },
        onError: (err, _v, ctx) => {
            if (ctx) {
                queryClient.setQueryData(["admin", "permissions"], (old) => {
                    const perms = { ...(old?.permissions || {}) };
                    if (perms[ctx.id] !== ctx.allow) return old; // a newer write already changed this id — leave it alone
                    if (ctx.had) perms[ctx.id] = ctx.prev;
                    else delete perms[ctx.id];
                    return { ...old, permissions: perms };
                });
            }
            showToast(err?.message || "Could not change access", "error");
        },
        onSettled: () => {
            // when the LAST pending change settles, reconcile with what the server really saved
            if (queryClient.isMutating({ mutationKey: ["admin", "permission-write"] }) <= 1) queryClient.invalidateQueries({ queryKey: ["admin", "permissions"] });
        },
    });

    // ─── Derived data ─────────────────────────────────────────────────────────

    const lib = useMemo(() => buildLibrary({ mediaData, mediaInfoMap, permissionsMap, addedDatesMap }), [mediaData, mediaInfoData, permissionsData, addedDatesData]); // eslint-disable-line react-hooks/exhaustive-deps
    const { allMedia, metrics, stats, formats, formatSource, quality, causes, typeShare, libraries } = lib;

    const posterIndex = useMemo(() => buildPosterIndex(mediaData), [mediaData]);
    const addedThisWeek = useMemo(() => allMedia.filter((m) => m._added && Date.now() - m._added.getTime() < WEEK).length, [allMedia]);

    // streams: shape is defensive on purpose (array, or { streams | items | active })
    const streamList = useMemo(() => {
        const d = streamsQuery.data;
        return Array.isArray(d) ? d : (d?.streams ?? d?.items ?? d?.active ?? []);
    }, [streamsQuery.data]);
    const transcoding = streamList.filter((s) => s?.transcode === true || /transcode|hls/i.test(String(s?.mode ?? s?.type ?? s?.playMethod ?? ""))).length;

    const never = an?.neverWatched ?? null;
    const reclaimBytes = stats.duplicateBytes + (never?.available ? num(never.bytes) : 0);

    // ─── Table state ──────────────────────────────────────────────────────────

    const [search, setSearch] = useState("");
    const [activeTab, setActiveTab] = useState("all");
    const [library, setLibrary] = useState("all");
    const [containers, setContainers] = useState(null); // array of container labels
    const [playback, setPlayback] = useState(null); // "direct" | "remux" | "transcode"
    const [qualityFilter, setQualityFilter] = useState(null); // "below1080"
    const [issuesOnly, setIssuesOnly] = useState(false);
    const [page, setPage] = useState(1);
    const [selectMode, setSelectMode] = useState(false);
    const [selected, setSelected] = useState(() => new Set());
    const [menu, setMenu] = useState(null);
    const [bulkConfirm, setBulkConfirm] = useState(false);
    const [busy, setBusy] = useState(false);

    const goTable = () => requestAnimationFrame(() => tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    const resetFilters = () => {
        setContainers(null);
        setPlayback(null);
        setQualityFilter(null);
        setIssuesOnly(false);
        setLibrary("all");
        setPage(1);
    };
    const showFiltered = (patch) => {
        resetFilters();
        setSearch("");
        setActiveTab(patch.tab ?? "all");
        if (patch.containers) setContainers(patch.containers);
        if (patch.playback) setPlayback(patch.playback);
        if (patch.quality) setQualityFilter(patch.quality);
        if (patch.issues) setIssuesOnly(true);
        goTable();
    };

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return allMedia
            .filter((m) => {
                if (activeTab !== "all" && m._type !== activeTab) return false;
                if (library !== "all" && String(m._libraryId) !== library) return false;
                if (containers && !(m._containers || [m._container]).some((c) => containers.includes(c))) return false; // a series can use several formats
                if (playback && m._playback.status !== playback) return false;
                if (qualityFilter === "below1080" && !(m.res === "720p" || m.res === "480p")) return false;
                if (issuesOnly && !(m._flags.noMeta || m._flags.noPoster || m._flags.dup)) return false;
                if (!q) return true;
                return (
                    m._title.toLowerCase().includes(q) ||
                    m._originalTitle.toLowerCase().includes(q) ||
                    m._filename.toLowerCase().includes(q) ||
                    m._library.toLowerCase().includes(q) ||
                    m._typeLabel.toLowerCase().includes(q)
                );
            })
            .sort((a, b) => (b._added?.getTime() || 0) - (a._added?.getTime() || 0));
    }, [allMedia, search, activeTab, library, containers, playback, qualityFilter, issuesOnly]);

    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const cur = Math.min(page, pages);
    const slice = filtered.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE);
    const selMedia = allMedia.filter((m) => selected.has(m._id));

    const toggleSel = (id) =>
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    const exitSelect = () => {
        setSelectMode(false);
        setSelected(new Set());
        setBulkConfirm(false);
    };

    const invalidateAll = () => queryClient.invalidateQueries({ queryKey: ["admin"] });

    const bulk = async (kind) => {
        const list = selMedia;
        if (!list.length) return;
        // The server has no DELETE /api/media/:id route yet — every request would 404 and report "failed".
        // Refuse here instead of firing N doomed calls. Re-enable together with a real server-side delete.
        if (kind === "delete") {
            setBulkConfirm(false);
            showToast("Deleting titles is not supported by the server yet", "error");
            return;
        }
        setBusy(true);
        let res;
        if (kind === "refresh") {
            const movies = list.filter((m) => m._type === "movie");
            res = await runBatch(movies, (m) => api.post(`/api/metadata/refresh/${m._id}`));
        } else if (kind === "restrict" || kind === "allow") {
            res = await runBatch(list, (m) => api.post(`/api/permissions/${m._id}`, { permission: kind === "allow" }));
        } else {
            res = await runBatch(list, (m) => api.delete(`/api/media/${m._id}`));
        }
        setBusy(false);
        await invalidateAll();
        showToast(res.failed ? `${res.ok} done, ${res.failed} failed` : `${res.ok} updated`, res.failed ? "error" : "success");
        exitSelect();
    };

    const exportCsv = () =>
        downloadCsv(
            "media-library.csv",
            ["Title", "Type", "Year", "Quality", "Video codec", "Audio codec", "Container", "Playback", "Size (bytes)", "Library", "Added", "Access"],
            filtered.map((m) => [m._title, m._typeLabel, m._year || "", m.res || "", m.vcodec || "", m.acodec || "", m._container, m._playback.status, m._size, m._library, m._added ? m._added.toISOString() : "", m._permission ? "allowed" : "restricted"]),
        );

    const rowMenu = (m) => [
        { icon: Info, label: "Details", onClick: () => setDetailsMedia(m) },
        { icon: SquarePen, label: "Edit", onClick: () => setEditMedia(m) },
        {
            icon: RefreshCw,
            label: "Refresh metadata",
            hint: m._type === "movie" ? "" : "Movies",
            disabled: m._type !== "movie",
            onClick: () =>
                api
                    .post(`/api/metadata/refresh/${m._id}`)
                    .then(() => {
                        showToast("Metadata refreshed");
                        invalidateAll();
                    })
                    .catch((e) => showToast(e?.message || "Refresh failed", "error")),
        },
        m._permission ? { icon: ShieldOff, label: "Restrict access", onClick: () => permissionMutation.mutate({ id: m._id, allow: false }) } : { icon: Shield, label: "Allow access", onClick: () => permissionMutation.mutate({ id: m._id, allow: true }) },
        ...(m._flags.dup ? [{ icon: Search, label: "Show duplicates", onClick: () => {
                    showFiltered({ tab: m._type });
                    setSearch(m._title);
                },
            }] : []),
        {
            icon: Copy,
            label: "Copy file path",
            onClick: () => navigator.clipboard?.writeText(m._path || m._filename).then(() => showToast("Path copied"), () => showToast("Clipboard is not available here", "error")),
        },
        ...(DELETE_SUPPORTED ? [{ divider: true }] : []),
        ...(DELETE_SUPPORTED ? [{ icon: Trash2, label: "Delete", tone: "error", onClick: () => setDeleteMedia(m) }] : []),
    ];

    // ─── Chart data ───────────────────────────────────────────────────────────

    const hours = Array.isArray(an?.watch?.hoursOfDay) && an.watch.hoursOfDay.length === 24 ? an.watch.hoursOfDay : null;
    const hasHours = hours && Math.max(...hours) > 0;
    const quiet = hasHours ? quietWindow(hours) : null;

    const mix = an?.watch?.mix ?? null;
    const mixTotal = mix ? num(mix.movie) + num(mix.series) + num(mix.anime) : 0;
    const shareRows = typeShare.map((t) => ({
        key: t.type,
        label: TYPE_META[t.type].plural,
        storage: t.share,
        watch: mixTotal > 0 ? pct(num(mix[t.type]), mixTotal) : 0,
        type: t.type,
    }));
    const biggestGap = mixTotal > 0 ? shareRows.reduce((a, r) => (r.storage - r.watch > (a ? a.storage - a.watch : 9) ? r : a), null) : null;

    const causeTotal = causes.reduce((a, c) => a + c.count, 0);
    const qualityRows = quality.map((q) => ({ ...q, label: TYPE_META[q.type].plural }));
    const worstQuality = qualityRows.filter((q) => q.known > 0).sort((a, b) => b.below / b.known - a.below / a.known)[0];

    // ─── Loading / error ──────────────────────────────────────────────────────

    if (isLoading) {
        return (
            <div className="space-y-4">
                <Skel className="h-10 w-48" />
                <StatSkeleton />
                <Skel className="h-96" />
            </div>
        );
    }

    if (isError) {
        return (
            <div className="flex items-center gap-2 rounded-lg border border-error bg-base-200 px-4 py-3 text-sm text-error">
                <AlertTriangle size={14} />
                <span className="flex-1">Failed to load media library: {queryError?.message}</span>
            </div>
        );
    }

    const activeChips = [
        containers && { key: "c", label: `Format: ${containers.join(", ")}`, clear: () => setContainers(null) },
        playback && { key: "p", label: `Playback: ${playback}`, clear: () => setPlayback(null) },
        qualityFilter && { key: "q", label: "Quality: below 1080p", clear: () => setQualityFilter(null) },
        issuesOnly && { key: "i", label: "Needs attention", clear: () => setIssuesOnly(false) },
    ].filter(Boolean);

    const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : null;

    // ─── Render ───────────────────────────────────────────────────────────────

    return (
        <div className="@container max-w-full space-y-4 text-sm leading-normal text-base-content">
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
            <PortalMenu anchor={menu?.anchor} header={menu?.row._title} items={menu ? rowMenu(menu.row) : []} onClose={() => setMenu(null)} />

            {/* ── Header ── */}
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold leading-tight tracking-tight">Media</h1>
                    <p className="flex items-center gap-2 text-sm text-base-content/75">
                        <Dot />
                        {metrics.total.toLocaleString()} titles across {libraries.length} {libraries.length === 1 ? "library" : "libraries"}
                        {lastUpdated ? ` · updated ${lastUpdated}` : ""}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <ToolBtn
                        icon={RefreshCw}
                        onClick={() => {
                            refetch();
                            invalidateAll();
                        }}>
                        {isFetching ? "Refreshing…" : "Refresh"}
                    </ToolBtn>
                    <ToolBtn icon={Download} onClick={exportCsv}>
                        Export CSV
                    </ToolBtn>
                    {onNavigate && (
                        <ToolBtn icon={FolderOpen} tone="primary" onClick={() => onNavigate("libraries")}>
                            Manage libraries
                        </ToolBtn>
                    )}
                </div>
            </div>

            {/* ── Stat strip ── */}
            <section className="overflow-hidden rounded-lg border border-base-300 bg-base-200">
                <div className="grid grid-cols-2 gap-px bg-base-300 @2xl:grid-cols-3 @5xl:grid-cols-6">
                    <Stat label="Total titles" value={metrics.total.toLocaleString()} sub={`+${addedThisWeek} this week`} />
                    <Stat label="Storage" value={fmtBytes(metrics.size)} sub={metrics.total ? `avg ${fmtBytes(metrics.size / metrics.total)} per title` : "—"} />
                    <Stat label="Direct play" value={stats.known ? `${stats.directPct}%` : "—"} sub={stats.known ? `${stats.transcode} transcode · ${stats.remux} remux` : "media info not indexed"} />
                    <Stat label="Reclaimable" value={fmtBytes(reclaimBytes)} sub={never?.available ? "duplicates + never played" : "from duplicates"} />
                    <Stat label="Streaming now" value={streamList.length} dot={streamList.length > 0} sub={streamList.length ? `${transcoding} transcoding` : "no active streams"} />
                    <Stat
                        label="Needs attention"
                        value={stats.attention}
                        sub={stats.attention ? "Review →" : "All clear"}
                        subTone={stats.attention ? "primary" : undefined}
                        onClick={stats.attention ? () => showFiltered({ issues: true }) : undefined}
                    />
                </div>
            </section>

            {/* ── Media library ── */}
            <SectionLabel>Media library</SectionLabel>
            <div ref={tableRef} className="scroll-mt-4">
                <Panel>
                    <div className="flex flex-wrap items-center gap-2 border-b border-base-300 px-4 py-3">
                        <Seg
                            value={activeTab}
                            onChange={(v) => {
                                setActiveTab(v);
                                setPage(1);
                            }}
                            options={[
                                { value: "all", label: "All", count: metrics.total },
                                { value: "movie", label: "Movies", count: metrics.movies },
                                { value: "series", label: "Series", count: metrics.series },
                                { value: "anime", label: "Anime", count: metrics.anime },
                            ]}
                        />
                        <SearchBox
                            icon={Search}
                            value={search}
                            onChange={(v) => {
                                setSearch(v);
                                setPage(1);
                            }}
                            placeholder="Search title, filename, library…"
                        />
                        {libraries.length > 1 && (
                            <SelectBox
                                value={library}
                                onChange={(v) => {
                                    setLibrary(v);
                                    setPage(1);
                                }}
                                options={[{ value: "all", label: "All libraries" }, ...libraries.map((l) => ({ value: String(l.id), label: l.label }))]}
                            />
                        )}
                        <ToolBtn icon={SquareCheck} onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}>
                            {selectMode ? "Done" : "Select"}
                        </ToolBtn>
                    </div>

                    {activeChips.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 border-b border-base-300 px-4 py-2">
                            {activeChips.map((c) => (
                                <button key={c.key} type="button" onClick={c.clear} className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-primary bg-base-200 px-2.5 text-sm font-medium text-primary hover:bg-base-300">
                                    {c.label}
                                    <X size={11} />
                                </button>
                            ))}
                            <button type="button" onClick={resetFilters} className="cursor-pointer text-sm text-base-content/80 hover:text-base-content">
                                Clear all
                            </button>
                        </div>
                    )}

                    {selectMode && (
                        <div className="flex flex-wrap items-center gap-2 border-b border-base-300 bg-base-300 px-4 py-2.5 text-sm">
                            <b className="mr-1 font-semibold">{selMedia.length} selected</b>
                            {bulkConfirm ? (
                                <>
                                    <span className="text-base-content/80">Delete {selMedia.length} titles from the library?</span>
                                    <ToolBtn tone="error" disabled={busy} onClick={() => bulk("delete")}>
                                        Confirm
                                    </ToolBtn>
                                    <ToolBtn onClick={() => setBulkConfirm(false)}>Cancel</ToolBtn>
                                </>
                            ) : (
                                <>
                                    <ToolBtn icon={RefreshCw} disabled={busy || !selMedia.some((m) => m._type === "movie")} onClick={() => bulk("refresh")} title="Movies only">
                                        Refresh metadata
                                    </ToolBtn>
                                    <ToolBtn icon={ShieldOff} disabled={busy || !selMedia.length} onClick={() => bulk("restrict")}>
                                        Restrict
                                    </ToolBtn>
                                    <ToolBtn icon={Shield} disabled={busy || !selMedia.length} onClick={() => bulk("allow")}>
                                        Allow
                                    </ToolBtn>
                                    <ToolBtn icon={Trash2} tone="error" disabled={!DELETE_SUPPORTED || busy || !selMedia.length} title={DELETE_SUPPORTED ? undefined : "Deleting titles is not supported by the server yet"} onClick={() => setBulkConfirm(true)}>
                                        Delete
                                    </ToolBtn>
                                </>
                            )}
                            <button type="button" onClick={exitSelect} className="ml-auto inline-flex cursor-pointer items-center gap-1 text-base-content/80 hover:text-base-content">
                                <X size={14} /> Clear
                            </button>
                        </div>
                    )}

                    {filtered.length === 0 ? (
                        <Empty icon={Database} text={allMedia.length === 0 ? "No media found. Add a library folder and run a scan." : "No titles match these filters."} />
                    ) : (
                        <table className="w-full table-fixed text-sm">
                            <colgroup>
                                <col style={{ width: "5%" }} />
                                <col style={{ width: "22%" }} />
                                <col style={{ width: "9%" }} />
                                <col style={{ width: "8%" }} />
                                <col className="hidden @2xl:table-column" style={{ width: "11%" }} />
                                <col style={{ width: "8%" }} />
                                <col className="hidden @3xl:table-column" style={{ width: "9%" }} />
                                <col className="hidden @3xl:table-column" style={{ width: "8%" }} />
                                <col style={{ width: "6%" }} />
                                <col style={{ width: "14%" }} />
                            </colgroup>
                            <thead>
                                <tr className="bg-base-300 text-left text-xs font-medium text-base-content/75">
                                    <th className="px-3 py-2.5">Sl.</th>
                                    <th className="px-2 py-2.5">Title</th>
                                    <th className="px-2 py-2.5">Type</th>
                                    <th className="px-2 py-2.5">Quality</th>
                                    <th className="hidden px-2 py-2.5 @2xl:table-cell">Codec</th>
                                    <th className="px-2 py-2.5 text-right">Size</th>
                                    <th className="hidden px-2 py-2.5 @3xl:table-cell">Library</th>
                                    <th className="hidden px-2 py-2.5 @3xl:table-cell">Added</th>
                                    <th className="px-2 py-2.5">Access</th>
                                    <th className="px-3 py-2.5 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {slice.map((m, i) => {
                                    const meta = TYPE_META[m._type];
                                    const seasonCount = m._type === "movie" ? 0 : Object.keys(m.seasons || {}).length;
                                    const episodeCount = m._type === "movie" ? 0 : Object.values(m.seasons || {}).reduce((a, s) => a + (s.episodes?.length || 0), 0);
                                    return (
                                        <tr key={m._id} className="border-t border-base-300 align-middle">
                                            <td className="px-3 py-2.5 text-sm tabular-nums text-base-content/75">{sl((cur - 1) * PAGE_SIZE + i + 1)}</td>
                                            <td className="px-2 py-2.5">
                                                <div className="flex min-w-0 items-center gap-2.5">
                                                    <PosterTile src={m._poster} alt={m._title} selectMode={selectMode} checked={selected.has(m._id)} onToggle={() => toggleSel(m._id)} />
                                                    <div className="min-w-0">
                                                        <p className="truncate text-sm font-medium text-base-content" title={m._title}>
                                                            {m._title}
                                                            {m._year ? <span className="ml-1.5 font-normal text-base-content/70">{m._year}</span> : null}
                                                        </p>
                                                        {m._flags.noMeta || m._flags.noPoster || m._flags.dup ? (
                                                            <div className="mt-0.5 flex flex-wrap gap-1">
                                                                {m._flags.noMeta && <Badge tone="error">No metadata</Badge>}
                                                                {!m._flags.noMeta && m._flags.noPoster && <Badge tone="warning">No poster</Badge>}
                                                                {m._flags.dup && <Badge tone="warning">Duplicate ×{m._dupCount}</Badge>}
                                                            </div>
                                                        ) : (
                                                            <p className="truncate text-xs text-base-content/70" title={m._filename}>
                                                                {m._type === "movie" ? m._filename : `${seasonCount} SE · ${episodeCount} EPI`}
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-2 py-2.5">
                                                <Badge tone={meta.tone}>{meta.label}</Badge>
                                            </td>
                                            <td className="px-2 py-2.5">
                                                {m.res ? (
                                                    <Badge tone={QUALITY_TONE[m.res] || "neutral"} outline>
                                                        {m.res}
                                                    </Badge>
                                                ) : (
                                                    <span className="text-base-content/65">—</span>
                                                )}
                                            </td>
                                            <td className="hidden px-2 py-2.5 text-xs text-base-content/90 @2xl:table-cell">
                                                <p className="truncate">{[m.vcodec, m.acodec].filter(Boolean).join(" · ") || "—"}</p>
                                            </td>
                                            <td className="whitespace-nowrap px-2 py-2.5 text-right text-sm tabular-nums text-base-content">{fmtBytes(m._size)}</td>
                                            <td className="hidden truncate px-2 py-2.5 text-sm text-base-content @3xl:table-cell" title={m._library}>
                                                {m._library}
                                            </td>
                                            <td className="hidden px-2 py-2.5 @3xl:table-cell">
                                                <p className="text-sm text-base-content">{m._added ? fmtDay(m._added.toISOString()) : "—"}</p>
                                                <p className="text-xs text-base-content/70">{m._added ? fmtYear(m._added.toISOString()) : ""}</p>
                                            </td>
                                            <td className="px-2 py-2.5">
                                                <Toggle checked={m._permission} label={m._permission ? "Restrict access" : "Allow access"} onChange={(allow) => permissionMutation.mutate({ id: m._id, allow })} />
                                            </td>
                                            <td className="px-3 py-2.5">
                                                <div className="flex items-center justify-end gap-1">
                                                    {m._flags.noMeta ? (
                                                        <ActionBtn onClick={() => setEditMedia(m)}>Match</ActionBtn>
                                                    ) : m._flags.dup ? (
                                                        <ActionBtn
                                                            onClick={() => {
                                                                showFiltered({ tab: m._type });
                                                                setSearch(m._title);
                                                            }}>
                                                            Review
                                                        </ActionBtn>
                                                    ) : (
                                                        <>
                                                            <IconBtn icon={Info} title="Details" onClick={() => setDetailsMedia(m)} />
                                                            <IconBtn icon={SquarePen} title="Edit" onClick={() => setEditMedia(m)} />
                                                        </>
                                                    )}
                                                    <IconBtn icon={Ellipsis} title="More actions" onClick={(e) => setMenu({ anchor: e.currentTarget, row: m })} />
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}

                    <Pagination page={cur} pages={pages} total={filtered.length} from={(cur - 1) * PAGE_SIZE + 1} to={Math.min(cur * PAGE_SIZE, filtered.length)} onPage={setPage} />
                </Panel>
            </div>

            {/* ── Subtitles ── */}
            <SectionLabel>Subtitles</SectionLabel>
            <SubtitlesTable posterIndex={posterIndex} onToast={showToast} />

            {/* ── File formats ── */}
            <SectionLabel>File formats</SectionLabel>
            <FormatsTable
                formats={formats}
                source={formatSource}
                totalTitles={metrics.total}
                onToast={showToast}
                onShowTitles={(labels) => showFiltered({ containers: labels })}
            />

            {/* ── Analytics ── */}
            <SectionLabel>Library analytics</SectionLabel>

            <Panel title="Watch time by hour" hint="Hours watched, by hour of day">
                {hasHours ? <HourBars hours={hours} quiet={quiet} /> : <Empty icon={Info} text={analyticsQuery.isLoading ? "Loading watch data…" : "No watch time recorded yet, so there is no hourly pattern to show."} />}
                <Note action={onNavigate && hasHours ? "Open jobs →" : undefined} onAction={() => onNavigate?.("jobs")}>
                    {hasHours ? `Quietest window ${pad2(quiet.start)}:00–${pad2(quiet.start + 4)}:00. Best time for scans and transcode jobs.` : "Needs a few days of playback history."}
                </Note>
            </Panel>

            <div className="grid gap-4 @3xl:grid-cols-2">
                <Panel title="Storage share vs watch time" right={<ShareLegend />} className="min-h-60">
                    {mixTotal > 0 && metrics.size > 0 ? <ShareCompare rows={shareRows} /> : <Empty icon={Info} text="Needs watch history and indexed file sizes." />}
                    <Note action={biggestGap ? "Review" : undefined} onAction={() => biggestGap && showFiltered({ tab: biggestGap.type })}>
                        {biggestGap
                            ? `${biggestGap.label}: ${biggestGap.storage}% of storage, ${biggestGap.watch}% of watch time.`
                            : mixTotal > 0
                              ? "Storage and watch time are in proportion."
                              : "No comparison yet."}
                    </Note>
                </Panel>

                <Panel title="Why titles need work to play" hint={causeTotal ? `${causeTotal} titles` : undefined} className="min-h-60">
                    {stats.known > 0 && causeTotal > 0 ? <RankedBars rows={causes.filter((c) => c.count > 0)} /> : <Empty icon={Info} text={stats.known ? "Every indexed title plays directly." : "Media info has not been indexed yet."} />}
                    <Note action={stats.transcode ? "Show titles" : undefined} onAction={() => showFiltered({ playback: "transcode" })}>
                        {stats.remux > 0 ? `${stats.remux} titles need only a container remux, no re-encode.` : stats.transcode ? `${stats.transcode} titles need a full transcode.` : "Nothing to fix."}
                    </Note>
                </Panel>
            </div>

            <Panel title="Quality mix by library" right={<QualityLegend />}>
                <QualityMix
                    rows={qualityRows}
                    onReview={(r) =>
                        showFiltered({ tab: r.type, quality: "below1080" })
                    }
                />
                <Note
                    action={worstQuality && worstQuality.below > 0 ? `Review ${worstQuality.below}` : undefined}
                    onAction={() => worstQuality && showFiltered({ tab: worstQuality.type, quality: "below1080" })}>
                    {worstQuality && worstQuality.known > 0
                        ? `${worstQuality.label} has the highest share below 1080p (${pct(worstQuality.below, worstQuality.known)}%). Best upgrade candidates.`
                        : "Quality appears once media info is indexed."}
                </Note>
            </Panel>
        </div>
    );
}
