// web/src/Dashboard/Components/MediaDash/FormatsTable.jsx
// One row per container (MKV, MP4, AVI…), built from the library's real ffprobe data (see buildLibrary).
// Playback status is an estimate from PLAYBACK_RULES in mediaDashUtils.js.

import { useMemo, useState } from "react";
import { List, Ellipsis, SquareCheck, FileDown, X, Info } from "lucide-react";
import { fmtBytes, fmtBitrate, pct, downloadCsv, sl } from "./mediaDashUtils";
import { Panel, Seg, SearchBox, SelectBox, ToolBtn, IconBtn, FormatPreview, Badge, PortalMenu, Empty, PLAYBACK_TONE, PLAYBACK_LABEL } from "./MediaDashParts";

// Auto table layout: every column gets at least its content width plus a fixed gutter, and the leftover width is
// shared between the columns in proportion to their content — no single column swallows the free space.
const TH = "whitespace-nowrap px-3 py-2.5 @3xl:px-4";
const TD = "whitespace-nowrap px-3 py-3 align-middle @3xl:px-4";

const SORTS = [
    { value: "titles", label: "Sort: Titles" },
    { value: "size", label: "Sort: Size" },
    { value: "bitrate", label: "Sort: Bitrate" },
];

export default function FormatsTable({ formats, source, totalTitles, onShowTitles, onToast }) {
    const [tab, setTab] = useState("all");
    const [search, setSearch] = useState("");
    const [sort, setSort] = useState("titles");
    const [selectMode, setSelectMode] = useState(false);
    const [selected, setSelected] = useState(() => new Set());
    const [menu, setMenu] = useState(null);

    const counts = useMemo(() => {
        const c = { direct: 0, remux: 0, transcode: 0 };
        formats.forEach((f) => (c[f.status] = (c[f.status] || 0) + 1));
        return c;
    }, [formats]);

    const rows = useMemo(() => {
        const q = search.trim().toLowerCase();
        const list = formats.filter((f) => {
            if (tab !== "all" && f.status !== tab) return false;
            if (!q) return true;
            return [f.label, f.name, ...f.vcodecs, ...f.acodecs, ...f.subs].some((x) => String(x).toLowerCase().includes(q));
        });
        const key = sort === "size" ? "bytes" : sort === "bitrate" ? "avgBitrate" : "titles";
        return [...list].sort((a, b) => b[key] - a[key]);
    }, [formats, tab, search, sort]);

    const toggle = (label) =>
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(label)) next.delete(label);
            else next.add(label);
            return next;
        });
    const exitSelect = () => {
        setSelectMode(false);
        setSelected(new Set());
    };

    const exportList = () => {
        downloadCsv(
            "file-formats.csv",
            ["Format", "Name", "Titles", "Files", "Size (bytes)", "Avg bitrate (bps)", "Video codecs", "Audio codecs", "Embedded subs", "Playback"],
            (selected.size ? rows.filter((r) => selected.has(r.label)) : rows).map((r) => [r.label, r.name, r.titles, r.files, r.bytes, Math.round(r.avgBitrate), r.vcodecs.join(" "), r.acodecs.join(" "), r.subs.join(" "), PLAYBACK_LABEL[r.status]]),
        );
        onToast("Format list exported");
    };

    const menuItems = (f) => [
        { icon: List, label: "Show titles", onClick: () => onShowTitles([f.label]) },
        { icon: FileDown, label: "Export this format", onClick: () => downloadCsv(`${f.label}.csv`, ["Format", "Titles", "Size (bytes)"], [[f.label, f.titles, f.bytes]]) },
    ];

    const totalBytes = formats.reduce((a, f) => a + f.bytes, 0);

    return (
        <Panel title="File formats" hint="Container details across all libraries">
            <PortalMenu anchor={menu?.anchor} header={menu ? `${menu.row.label} · ${menu.row.name}` : ""} items={menu ? menuItems(menu.row) : []} onClose={() => setMenu(null)} />

            <div className="flex flex-wrap items-center gap-2 border-b border-base-300 px-4 py-3">
                <Seg
                    value={tab}
                    onChange={setTab}
                    options={[
                        { value: "all", label: "All", count: formats.length },
                        { value: "direct", label: "Direct play", count: counts.direct },
                        { value: "remux", label: "Remux", count: counts.remux },
                        { value: "transcode", label: "Transcode", count: counts.transcode },
                    ]}
                />
                <SearchBox value={search} onChange={setSearch} placeholder="Search format or codec…" />
                <SelectBox value={sort} onChange={setSort} options={SORTS} />
                <ToolBtn icon={SquareCheck} onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}>
                    {selectMode ? "Done" : "Select"}
                </ToolBtn>
                <ToolBtn icon={FileDown} onClick={exportList}>
                    Export
                </ToolBtn>
            </div>

            {selectMode && (
                <div className="flex flex-wrap items-center gap-2 border-b border-base-300 bg-base-300 px-4 py-2.5 text-sm">
                    <b className="mr-1 font-semibold">{selected.size} selected</b>
                    <ToolBtn
                        icon={List}
                        disabled={!selected.size}
                        onClick={() => {
                            onShowTitles([...selected]);
                            exitSelect();
                        }}>
                        Show titles
                    </ToolBtn>
                    <ToolBtn icon={FileDown} disabled={!selected.size} onClick={exportList}>
                        Export list
                    </ToolBtn>
                    <button type="button" onClick={exitSelect} className="ml-auto inline-flex cursor-pointer items-center gap-1 text-base-content/80 hover:text-base-content">
                        <X size={14} /> Clear
                    </button>
                </div>
            )}

            {formats.length === 0 ? (
                <Empty icon={Info} text="Media info has not been indexed yet, so containers and codecs are not available." />
            ) : (
                <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="bg-base-300 text-left text-xs font-medium text-base-content/75">
                            <th className={`${TH}`}>Sl.</th>
                            <th className={TH}>Format</th>
                            <th className={`${TH} text-right`}>Titles</th>
                            <th className={`${TH} hidden text-right @xl:table-cell`}>Size</th>
                            <th className={`${TH} hidden text-right @4xl:table-cell`}>Avg bitrate</th>
                            <th className={`${TH} hidden @min-[820px]:table-cell`}>Codecs (video / audio)</th>
                            <th className={`${TH} hidden @min-[1060px]:table-cell`}>Subs</th>
                            <th className={`${TH}`}>Playback</th>
                            <th className={`${TH} text-right`}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((f, i) => (
                            <tr key={f.label} className="border-t border-base-300 align-middle">
                                <td className={`${TD} tabular-nums text-base-content/75`}>{sl(i + 1)}</td>
                                <td className={TD}>
                                    <div className="flex items-center gap-3">
                                        <FormatPreview posters={f.posters} label={f.label === "UNKNOWN" ? "?" : f.label.slice(0, 4)} tone={PLAYBACK_TONE[f.status]} selectMode={selectMode} checked={selected.has(f.label)} onToggle={() => toggle(f.label)} />
                                        <div className="max-w-32">
                                            <p className="truncate text-sm font-semibold text-base-content" title={f.name}>{f.name}</p>
                                            <p className="truncate text-xs text-base-content/70">{f.label === "UNKNOWN" ? "no media info" : f.label === "OTHER" ? "other containers" : `.${f.label.toLowerCase()}`}</p>
                                        </div>
                                    </div>
                                </td>
                                <td className={`${TD} text-right`}>
                                    <p className="tabular-nums text-base-content">{f.titles.toLocaleString()}</p>
                                    <p className="text-xs text-base-content/70">{pct(f.titles, totalTitles)}%</p>
                                </td>
                                <td className={`${TD} hidden text-right tabular-nums text-base-content @xl:table-cell`}>{fmtBytes(f.bytes)}</td>
                                <td className={`${TD} hidden text-right tabular-nums text-base-content @4xl:table-cell`}>{fmtBitrate(f.avgBitrate)}</td>
                                <td className="hidden whitespace-nowrap px-4 py-3 text-xs leading-relaxed text-base-content/90 @min-[820px]:table-cell">
                                    <p>
                                        <span className="mr-1.5 font-semibold text-primary">V</span>
                                        {f.vcodecs.join(" · ") || "—"}
                                    </p>
                                    <p>
                                        <span className="mr-1.5 font-semibold text-primary">A</span>
                                        {f.acodecs.join(" · ") || "—"}
                                    </p>
                                </td>
                                <td className={`${TD} hidden text-xs text-base-content/90 @min-[1060px]:table-cell`}>{f.subs.join(" · ") || "None"}</td>
                                <td className={TD}>
                                    <Badge tone={PLAYBACK_TONE[f.status]}>{PLAYBACK_LABEL[f.status]}</Badge>
                                    {f.needWork > 0 && f.status !== "transcode" && <p className="mt-0.5 text-xs text-base-content/70">{f.needWork} need transcode</p>}
                                </td>
                                <td className={TD}>
                                    <div className="flex items-center justify-end gap-1">
                                        <IconBtn icon={List} title="Show titles" onClick={() => onShowTitles([f.label])} />
                                        <IconBtn icon={Ellipsis} title="More actions" onClick={(e) => setMenu({ anchor: e.currentTarget, row: f })} />
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {rows.length === 0 && (
                            <tr>
                                <td colSpan={9} className="px-4 py-8 text-center text-sm text-base-content/75">
                                    No formats match these filters.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
                </div>
            )}

            <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-base-300 px-4 py-3 text-sm text-base-content/80">
                <span>
                    {formats.length} containers · {totalTitles.toLocaleString()} titles · {fmtBytes(totalBytes)}
                </span>
                <span title="The container is read from the file extension when the filename has a real one, otherwise from ffprobe.">
                    From filename {source?.ext ?? 0} · from ffprobe {source?.probe ?? 0}
                    {source?.unprobed ? ` · not probed ${source.unprobed}` : ""} · playback is an estimate
                </span>
            </div>
        </Panel>
    );
}
