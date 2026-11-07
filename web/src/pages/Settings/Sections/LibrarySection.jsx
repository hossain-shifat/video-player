import { useState } from "react";
import { FolderOpen, FolderPlus, Trash2, RefreshCw, SquarePen, Check, Film, Tv, Sparkles } from "lucide-react";
import { Card, SectionLabel, GhostButton, PrimaryButton, StatGrid, StatTile, FOCUS } from "../Components/shared";
import { EditFolderModal, SettingsConfirm } from "../../../Components/Layout/Modal";

export default function LibrarySection({ folders, removeLibraryFolder, updateLibraryFolder, setAddFolderOpen, refreshAll, loading, counts }) {
    const [editTarget, setEditTarget] = useState(null);
    const [removeTarget, setRemoveTarget] = useState(null);
    const [refreshOpen, setRefreshOpen] = useState(false);
    const [refreshState, setRefreshState] = useState("idle"); // idle | done | error
    const [removeError, setRemoveError] = useState(null);

    const refreshing = !!loading?.refreshAllMetadata;
    const c = counts || { movies: 0, series: 0, anime: 0 };

    async function doRefresh() {
        setRefreshOpen(false);
        setRefreshState("idle");
        try {
            await refreshAll();
            setRefreshState("done");
        } catch {
            setRefreshState("error");
        }
    }

    async function doRemove() {
        const target = removeTarget;
        setRemoveTarget(null);
        setRemoveError(null);
        try {
            await removeLibraryFolder(target.id);
        } catch (err) {
            setRemoveError(err?.message || "Could not remove folder");
        }
    }

    return (
        <div className="w-full space-y-6">
            <StatGrid>
                <StatTile icon={FolderOpen} label="Folders" value={folders.length} />
                <StatTile icon={Film} label="Movies" value={c.movies} />
                <StatTile icon={Tv} label="Series" value={c.series} />
                <StatTile icon={Sparkles} label="Anime" value={c.anime} />
            </StatGrid>

            <div id="l-folders" className="scroll-mt-28">
                <SectionLabel hint="Flux scans these folders for video files. Removing a folder never deletes your files.">Media folders</SectionLabel>
                {removeError && (
                    <p role="alert" className="mb-2 rounded-md border border-error/35 bg-error/10 px-3 py-2 text-[13px] text-error">
                        {removeError}
                    </p>
                )}
                <Card>
                    {folders.length === 0 ? (
                        <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
                            <FolderOpen size={28} className="text-base-content/35" />
                            <div>
                                <p className="text-sm font-medium text-base-content">No folders yet</p>
                                <p className="mt-0.5 text-[13px] text-base-content/60">Add a folder to start building your library.</p>
                            </div>
                            <PrimaryButton onClick={() => setAddFolderOpen(true)}>
                                <FolderPlus size={14} /> Add folder
                            </PrimaryButton>
                        </div>
                    ) : (
                        folders.map((f) => (
                            <div key={f.id} className="group flex items-center gap-3 border-b border-base-content/10 px-4 py-3 last:border-b-0 hover:bg-base-content/[0.03] sm:px-5">
                                <FolderOpen size={18} className="shrink-0 text-primary" />
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium leading-tight text-base-content">{f.label || f.path}</p>
                                    {f.label && <p className="mt-0.5 truncate font-mono text-xs text-base-content/55">{f.path}</p>}
                                    {f.addedAt && (
                                        <p className="mt-0.5 text-xs text-base-content/45">Added {new Date(f.addedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</p>
                                    )}
                                </div>
                                <div className="flex shrink-0 items-center gap-0.5 transition-opacity focus-within:opacity-100 lg:opacity-60 lg:group-hover:opacity-100">
                                    <button
                                        onClick={() => setEditTarget(f)}
                                        aria-label={`Edit ${f.label || f.path}`}
                                        className={`flex size-8 cursor-pointer items-center justify-center rounded-md text-base-content/60 transition-colors hover:bg-base-content/10 hover:text-base-content ${FOCUS}`}>
                                        <SquarePen size={15} />
                                    </button>
                                    <button
                                        onClick={() => setRemoveTarget(f)}
                                        aria-label={`Remove ${f.label || f.path}`}
                                        className={`flex size-8 cursor-pointer items-center justify-center rounded-md text-base-content/60 transition-colors hover:bg-error/10 hover:text-error ${FOCUS}`}>
                                        <Trash2 size={15} />
                                    </button>
                                </div>
                            </div>
                        ))
                    )}

                    {folders.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 border-t border-base-content/10 bg-base-300/40 px-4 py-3 sm:px-5">
                            <PrimaryButton onClick={() => setAddFolderOpen(true)}>
                                <FolderPlus size={14} /> Add folder
                            </PrimaryButton>
                            <GhostButton onClick={() => setRefreshOpen(true)} disabled={refreshing}>
                                <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
                                {refreshing ? "Refreshing…" : "Refresh metadata"}
                            </GhostButton>
                            {refreshState === "done" && !refreshing && (
                                <span role="status" className="inline-flex items-center gap-1 text-xs font-medium text-success">
                                    <Check size={12} strokeWidth={3} /> Metadata cache cleared. Posters refetch as you browse.
                                </span>
                            )}
                            {refreshState === "error" && !refreshing && (
                                <span role="alert" className="text-xs font-medium text-error">
                                    Refresh failed. Check the server.
                                </span>
                            )}
                        </div>
                    )}
                </Card>
            </div>

            <EditFolderModal open={!!editTarget} onClose={() => setEditTarget(null)} folder={editTarget} onSave={async (id, u) => await updateLibraryFolder(id, u)} />

            <SettingsConfirm
                kind="confirmRefreshMetadata"
                open={refreshOpen}
                onClose={() => setRefreshOpen(false)}
                onConfirm={doRefresh}
            />

            <SettingsConfirm
                kind="confirmRemoveFolder"
                data={{ folder: removeTarget }}
                open={!!removeTarget}
                onClose={() => setRemoveTarget(null)}
                onConfirm={doRemove}
            />
        </div>
    );
}
