// web/src/Dashboard/Components/MediaDash/SubtitlesTable.jsx
// Downloaded subtitles, straight from the subtitle admin API your Subtitles page already uses
// (GET /api/subtitle/admin/{overview,list}, POST /api/subtitle/admin/action). Embedded tracks are never listed.
// Same query keys as DashSubtitles, so both pages share one cache. Same modals (preview / shift / confirm).

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Captions, Eye, Download, Ellipsis, SquareCheck, WandSparkles, RefreshCw, ShieldCheck, Timer, Scissors, Sparkles, Trash2, X } from "lucide-react";
import { subtitleApi } from "../../Api/dashboardApi";
import { ConfirmModal, DASH_MODALS, SubtitlePreviewModal, SubtitleShiftModal } from "../DashModal";
import { fmtBytes, fmtDay, fmtYear, sl } from "./mediaDashUtils";
import { Panel, Badge, Seg, SearchBox, SelectBox, ToolBtn, IconBtn, ActionBtn, SubtitleTile, Pagination, PortalMenu, Empty, Skel } from "./MediaDashParts";

const PAGE_SIZE = 8;
const EXT_TONE = { SRT: "secondary", VTT: "accent", ASS: "info", SSA: "info" };

// quality → status dot + label (same wording as the Subtitles page)
const QUALITY = {
    good: { tone: "success", label: "High quality" },
    fallback: { tone: "warning", label: "Nearest usable" },
    unvalidated: { tone: "neutral", label: "Not checked" },
    upload: { tone: "info", label: "Uploaded" },
};
const QUALITY_FILTER = [
    { value: "", label: "Any quality" },
    { value: "good", label: "High quality" },
    { value: "fallback", label: "Nearest usable" },
    { value: "unvalidated", label: "Not checked" },
    { value: "upload", label: "Uploaded" },
];
const shiftable = (r) => /\.(srt|vtt)$/.test(r.ext || r.filename || "");

function confirmFor(action, targets) {
    const n = targets.length;
    const one = n === 1 ? targets[0] : null;
    const what = one ? `${one.title} · ${one.label}` : `${n} subtitles`;
    const size = fmtBytes(targets.reduce((a, r) => a + (r.sizeBytes || 0), 0));
    if (action === "delete")
        return {
            variant: "danger",
            title: one ? "Delete this subtitle?" : `Delete ${n} subtitles?`,
            subtitle: what,
            confirmText: "Delete",
            confirmIcon: Trash2,
            message: `The file${n > 1 ? "s are" : " is"} removed from disk (${size}). It will not be downloaded again automatically.`,
            note: "You can still re-download later with Re-download.",
            noteTone: "info",
        };
    return {
        variant: "warning",
        title: one ? "Re-download this subtitle?" : `Re-download ${n} subtitles?`,
        subtitle: what,
        confirmText: "Re-download",
        confirmIcon: RefreshCw,
        message: "The current file is moved to the rejected folder and a fresh candidate is downloaded and validated when the server is idle.",
        note: "Uploaded files without a library entry cannot be re-downloaded.",
        noteTone: "warning",
    };
}

export default function SubtitlesTable({ onToast }) {
    const qc = useQueryClient();
    const [tab, setTab] = useState("all");
    const [search, setSearch] = useState("");
    const [debounced, setDebounced] = useState("");
    const [quality, setQuality] = useState("");
    const [page, setPage] = useState(1);
    const [selectMode, setSelectMode] = useState(false);
    const [selected, setSelected] = useState(() => new Set());
    const [menu, setMenu] = useState(null); // { anchor, row }
    const [previewRow, setPreviewRow] = useState(null);
    const [shiftRows, setShiftRows] = useState(null);
    const [confirm, setConfirm] = useState(null);
    const [fixAsk, setFixAsk] = useState(false);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        const t = setTimeout(() => setDebounced(search.trim()), 300);
        return () => clearTimeout(t);
    }, [search]);
    useEffect(() => setPage(1), [tab, quality, debounced]);
    useEffect(() => setSelected(new Set()), [tab, quality, debounced, page]);

    const ovQ = useQuery({
        queryKey: ["subtitle-admin", "overview"],
        queryFn: subtitleApi.overview,
        staleTime: 30_000,
        refetchInterval: (q) => (q.state.data?.analysis && !q.state.data.analysis.complete ? 3000 : 60_000),
    });
    const ov = ovQ.data;

    const params = { page, limit: PAGE_SIZE, sort: "added", order: "desc", quality, lang: tab === "all" ? "" : tab, search: debounced };
    const listQ = useQuery({
        queryKey: ["subtitle-admin", "list", params],
        queryFn: () => subtitleApi.list(params),
        placeholderData: (prev) => prev,
        refetchInterval: (q) => (q.state.data?.rows?.some((r) => !r.analyzed) ? 3000 : false), // files still being read
    });
    const rows = listQ.data?.rows ?? [];
    const total = listQ.data?.total ?? 0;
    const pages = listQ.data?.pages ?? 1;
    const selRows = rows.filter((r) => selected.has(r.key));

    const langTabs = useMemo(() => (ov?.languages ?? []).slice(0, 3), [ov]);
    const fixCount = (ov?.quality?.fallback || 0) + (ov?.quality?.unvalidated || 0);

    const refresh = () => qc.invalidateQueries({ queryKey: ["subtitle-admin"] });

    const toggle = (key) =>
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    const exitSelect = () => {
        setSelectMode(false);
        setSelected(new Set());
    };

    // ── actions (same contract as the Subtitles page) ──
    async function run(action, targets, actionParams) {
        setBusy(true);
        try {
            const res = await subtitleApi.action(action, targets.map((r) => ({ mediaId: r.mediaId, lang: r.lang })), actionParams);
            const firstMsg = res.results?.find((x) => x.message)?.message;
            if (res.failed && !res.ok) onToast(`${res.failed} failed${firstMsg ? ` — ${firstMsg}` : ""}`, "error");
            else onToast(`${res.ok} done${res.failed ? `, ${res.failed} failed` : ""}${targets.length === 1 && firstMsg ? ` — ${firstMsg}` : ""}`, res.failed ? "error" : "success");
            setSelected(new Set());
            refresh();
            return res;
        } catch (e) {
            onToast(e?.message || "Action failed", "error");
            return null;
        } finally {
            setBusy(false);
        }
    }

    async function download(r) {
        try {
            const blob = await subtitleApi.file(r.mediaId, r.lang);
            const url = URL.createObjectURL(blob instanceof Blob ? blob : new Blob([blob]));
            const a = document.createElement("a");
            a.href = url;
            a.download = `${r.title.replace(/[^\w.-]+/g, "_")}.${r.lang}${r.ext || ".srt"}`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1500);
        } catch (e) {
            onToast(e?.message || "Download failed", "error");
        }
    }

    function handle(r, key) {
        if (key === "preview") return setPreviewRow(r);
        if (key === "download") return download(r);
        if (key === "shift") return setShiftRows([r]);
        if (key === "delete" || key === "redownload") return setConfirm({ action: key, targets: [r], ...confirmFor(key, [r]) });
        return run(key, [r]);
    }

    function handleBulk(key) {
        if (!selRows.length) return;
        if (key === "shift") return setShiftRows(selRows);
        if (key === "delete" || key === "redownload") return setConfirm({ action: key, targets: selRows, ...confirmFor(key, selRows) });
        return run(key, selRows);
    }

    async function executeConfirm() {
        if (!confirm) return;
        await run(confirm.action, confirm.targets);
        setConfirm(null);
    }

    async function applyShift(seconds) {
        const res = await run("shift", shiftRows, { seconds });
        if (res) setShiftRows(null);
    }

    // Auto-fix: look for a better file for every "nearest usable" subtitle and re-check every unchecked one (up to 100 each).
    async function autoFix() {
        setBusy(true);
        setFixAsk(false);
        try {
            const [fb, uv] = await Promise.all([subtitleApi.list({ quality: "fallback", limit: 100 }), subtitleApi.list({ quality: "unvalidated", limit: 100 })]);
            const pick = (l) => l.rows.map((r) => ({ mediaId: r.mediaId, lang: r.lang }));
            const results = await Promise.all([fb.rows.length ? subtitleApi.action("upgrade", pick(fb)) : null, uv.rows.length ? subtitleApi.action("revalidate", pick(uv)) : null]);
            const ok = results.reduce((a, r) => a + (r?.ok || 0), 0);
            const failed = results.reduce((a, r) => a + (r?.failed || 0), 0);
            onToast(`${ok} queued${failed ? `, ${failed} failed` : ""} — they run when the server is idle`, failed ? "error" : "success");
            refresh();
        } catch (e) {
            onToast(e?.message || "Auto-fix failed", "error");
        } finally {
            setBusy(false);
        }
    }

    const menuItems = (r) => [
        { icon: Eye, label: "Preview cues", onClick: () => handle(r, "preview") },
        { icon: Download, label: "Download file", onClick: () => handle(r, "download") },
        { divider: true },
        { icon: Timer, label: "Adjust timing…", disabled: !shiftable(r), onClick: () => handle(r, "shift") },
        { icon: ShieldCheck, label: "Re-validate", onClick: () => handle(r, "revalidate") },
        { icon: Scissors, label: "Clean watermarks", disabled: r.ext !== ".srt", onClick: () => handle(r, "clean") },
        ...(r.quality === "fallback" ? [{ icon: Sparkles, label: "Look for a better one", onClick: () => handle(r, "upgrade") }] : []),
        { icon: RefreshCw, label: "Re-download", onClick: () => handle(r, "redownload") },
        { divider: true },
        { icon: Trash2, label: "Delete file", tone: "error", onClick: () => handle(r, "delete") },
    ];

    const quick = (r) => {
        if (r.missing) return { label: "Re-download", icon: RefreshCw, key: "redownload" };
        if (r.quality === "fallback") return { label: "Upgrade", icon: Sparkles, key: "upgrade" };
        return null;
    };

    const hint = ov ? `${ov.totals.files.toLocaleString()} files · ${fmtBytes(ov.totals.bytes)} · embedded tracks not listed` : "Downloaded .srt / .vtt only";
    const err = listQ.error;
    const base = (page - 1) * PAGE_SIZE;

    return (
        <Panel title="Downloaded subtitles" hint={hint}>
            {previewRow && <SubtitlePreviewModal row={previewRow} onClose={() => setPreviewRow(null)} onDownload={download} />}
            {shiftRows && <SubtitleShiftModal rows={shiftRows} onClose={() => !busy && setShiftRows(null)} onApply={applyShift} busy={busy} />}
            <ConfirmModal
                modal={DASH_MODALS.subtitleConfirm}
                open={!!confirm}
                onClose={() => !busy && setConfirm(null)}
                onConfirm={executeConfirm}
                title={confirm?.title}
                subtitle={confirm?.subtitle}
                confirmIcon={confirm?.confirmIcon}
                message={confirm?.message}
                note={confirm?.note}
                noteTone={confirm?.noteTone}
                variant={confirm?.variant || "danger"}
                confirmText={confirm?.confirmText}
                loading={busy}
            />
            <PortalMenu anchor={menu?.anchor} header={menu?.row.filename} items={menu ? menuItems(menu.row) : []} onClose={() => setMenu(null)} />

            <div className="flex flex-wrap items-center gap-2 border-b border-base-300 px-4 py-3">
                <Seg
                    value={tab}
                    onChange={setTab}
                    options={[{ value: "all", label: "All", count: ov?.totals.files }, ...langTabs.map((l) => ({ value: l.lang, label: l.label, count: l.files }))]}
                />
                <SearchBox value={search} onChange={setSearch} placeholder="Search title or file…" />
                <SelectBox value={quality} onChange={setQuality} options={QUALITY_FILTER} />
                <ToolBtn icon={SquareCheck} onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}>
                    {selectMode ? "Done" : "Select"}
                </ToolBtn>
                {fixCount > 0 &&
                    (fixAsk ? (
                        <span className="inline-flex items-center gap-2 text-sm">
                            <span className="text-base-content/85">Fix up to {Math.min(fixCount, 200)}?</span>
                            <ToolBtn tone="primary" disabled={busy} onClick={autoFix}>
                                Confirm
                            </ToolBtn>
                            <ToolBtn onClick={() => setFixAsk(false)}>Cancel</ToolBtn>
                        </span>
                    ) : (
                        <ToolBtn icon={WandSparkles} tone="primary" onClick={() => setFixAsk(true)} title="Look for better files and re-check unchecked ones">
                            Auto-fix {fixCount}
                        </ToolBtn>
                    ))}
            </div>

            {selectMode && (
                <div className="flex flex-wrap items-center gap-2 border-b border-base-300 bg-base-300 px-4 py-2.5 text-sm">
                    <b className="mr-1 font-semibold">{selRows.length} selected</b>
                    <ToolBtn icon={ShieldCheck} disabled={busy || !selRows.length} onClick={() => handleBulk("revalidate")}>
                        Re-validate
                    </ToolBtn>
                    <ToolBtn icon={Timer} disabled={busy || !selRows.length} onClick={() => handleBulk("shift")}>
                        Shift timing
                    </ToolBtn>
                    <ToolBtn icon={Scissors} disabled={busy || !selRows.length} onClick={() => handleBulk("clean")}>
                        Clean
                    </ToolBtn>
                    <ToolBtn icon={RefreshCw} disabled={busy || !selRows.length} onClick={() => handleBulk("redownload")}>
                        Re-download
                    </ToolBtn>
                    <ToolBtn icon={Trash2} tone="error" disabled={busy || !selRows.length} onClick={() => handleBulk("delete")}>
                        Delete
                    </ToolBtn>
                    <button type="button" onClick={exitSelect} className="ml-auto inline-flex cursor-pointer items-center gap-1 text-base-content/80 hover:text-base-content">
                        <X size={14} /> Clear
                    </button>
                </div>
            )}

            {listQ.isLoading ? (
                <div className="space-y-2 p-4">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <Skel key={i} className="h-14" />
                    ))}
                </div>
            ) : err && !rows.length ? (
                <Empty icon={Captions} text={err?.message || "Could not load downloaded subtitles."} />
            ) : rows.length === 0 ? (
                <Empty icon={Captions} text={debounced || quality || tab !== "all" ? "No subtitles match these filters." : "No downloaded subtitles yet. The background worker fetches them while the server is idle."} />
            ) : (
                <table className="w-full table-fixed text-sm">
                    <colgroup>
                        <col style={{ width: "5%" }} />
                        <col style={{ width: "21%" }} />
                        <col style={{ width: "8%" }} />
                        <col className="hidden @2xl:table-column" style={{ width: "7%" }} />
                        <col className="hidden @3xl:table-column" style={{ width: "8%" }} />
                        <col style={{ width: "7%" }} />
                        <col className="hidden @3xl:table-column" style={{ width: "7%" }} />
                        <col style={{ width: "13%" }} />
                        <col className="hidden @3xl:table-column" style={{ width: "8%" }} />
                        <col style={{ width: "16%" }} />
                    </colgroup>
                    <thead>
                        <tr className="bg-base-300 text-left text-xs font-medium text-base-content/75">
                            <th className="px-3 py-2.5">Sl.</th>
                            <th className="px-2 py-2.5">Subtitle</th>
                            <th className="px-2 py-2.5">Language</th>
                            <th className="hidden px-2 py-2.5 @2xl:table-cell">Format</th>
                            <th className="hidden px-2 py-2.5 text-right @3xl:table-cell">Size</th>
                            <th className="px-2 py-2.5 text-right">Cues</th>
                            <th className="hidden px-2 py-2.5 text-right @3xl:table-cell">Cues/s</th>
                            <th className="px-2 py-2.5">Status</th>
                            <th className="hidden px-2 py-2.5 @3xl:table-cell">Date</th>
                            <th className="px-3 py-2.5 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r, i) => {
                            const st = r.missing ? { tone: "error", label: "File missing" } : QUALITY[r.quality] || QUALITY.unvalidated;
                            const q = quick(r);
                            const ext = String(r.ext || ".srt").replace(".", "").toUpperCase();
                            return (
                                <tr key={r.key} className="border-t border-base-300 align-middle">
                                    <td className="px-3 py-2.5 text-sm tabular-nums text-base-content/75">{sl(base + i + 1)}</td>
                                    <td className="px-2 py-2.5">
                                        <div className="flex min-w-0 items-center gap-2.5">
                                            <SubtitleTile ext={ext} tone={EXT_TONE[ext] || "secondary"} selectMode={selectMode} checked={selected.has(r.key)} onToggle={() => toggle(r.key)} />
                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-medium text-base-content" title={r.title}>
                                                    {r.title}
                                                </p>
                                                <p className="truncate text-xs text-base-content/70" title={r.releaseName || r.filename}>
                                                    {r.releaseName || r.filename}
                                                </p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="truncate px-2 py-2.5 text-sm text-base-content">{r.label}</td>
                                    <td className="hidden px-2 py-2.5 @2xl:table-cell">
                                        <Badge tone={EXT_TONE[ext] || "secondary"} outline>{ext}</Badge>
                                    </td>
                                    <td className="hidden whitespace-nowrap px-2 py-2.5 text-right text-sm tabular-nums text-base-content @3xl:table-cell">{r.sizeBytes == null ? "…" : fmtBytes(r.sizeBytes)}</td>
                                    <td className="px-2 py-2.5 text-right text-sm tabular-nums text-base-content">{r.cues == null ? "…" : r.cues.toLocaleString()}</td>
                                    <td className="hidden px-2 py-2.5 text-right text-sm tabular-nums text-base-content @3xl:table-cell">{r.cuePerSec == null ? "…" : r.cuePerSec.toFixed(2)}</td>
                                    <td className="px-2 py-2.5">
                                        <Badge tone={st.tone}>{st.label}</Badge>
                                        <p className="mt-0.5 truncate text-xs text-base-content/70">
                                            {r.score != null ? `score ${r.score.toFixed(2)}` : r.source}
                                            {r.shiftApplied ? ` · shifted ${r.shiftApplied > 0 ? "+" : ""}${r.shiftApplied}s` : ""}
                                        </p>
                                    </td>
                                    <td className="hidden px-2 py-2.5 @3xl:table-cell">
                                        <p className="text-sm text-base-content">{fmtDay(r.addedAt)}</p>
                                        <p className="text-xs text-base-content/70">{fmtYear(r.addedAt)}</p>
                                    </td>
                                    <td className="px-3 py-2.5">
                                        <div className="flex items-center justify-end gap-1">
                                            {q ? (
                                                <ActionBtn icon={q.icon} disabled={busy} onClick={() => handle(r, q.key)}>
                                                    {q.label}
                                                </ActionBtn>
                                            ) : (
                                                <>
                                                    <IconBtn icon={Eye} title="Preview cues" onClick={() => handle(r, "preview")} />
                                                    <IconBtn icon={Download} title="Download file" onClick={() => handle(r, "download")} />
                                                </>
                                            )}
                                            <IconBtn icon={Ellipsis} title="More actions" onClick={(e) => setMenu({ anchor: e.currentTarget, row: r })} />
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            )}

            <Pagination page={Math.min(page, pages)} pages={pages} total={total} from={base + 1} to={Math.min(base + PAGE_SIZE, total)} onPage={setPage} note="cues counted from downloaded files only" />
        </Panel>
    );
}
