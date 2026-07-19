import { useState, useEffect } from "react";
import { FolderOpen, FolderPlus, Trash2, RefreshCw, SquarePen, Check } from "lucide-react";
import { Card, Modal, Input, SectionLabel, GhostButton } from "./shared";

function EditFolderModal({ open, onClose, folder, onSave }) {
    const [label, setLabel] = useState("");
    const [path, setPath] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (folder) {
            setLabel(folder.label || "");
            setPath(folder.path || "");
            setError(null);
            setSaving(false);
        }
    }, [folder]);

    async function save() {
        if (!label.trim() || !path.trim()) return;
        setSaving(true);
        setError(null);
        try {
            await onSave(folder.id, { label: label.trim(), path: path.trim() });
            onClose();
        } catch (err) {
            setError(err.message || "Update failed");
        } finally {
            setSaving(false);
        }
    }

    return (
        <Modal open={open} onClose={onClose} title="Edit Folder">
            <div className="space-y-4">
                {error && <p className="rounded-lg bg-error/12 border border-error/25 px-3 py-2 text-[11px] text-error">{error}</p>}
                {[
                    { id: "el", label: "Display Label", val: label, set: setLabel, ph: "Movies, Anime…", autoFocus: true },
                    { id: "ep", label: "Folder Path", val: path, set: setPath, ph: "D:\\Movies  or  /media/movies", mono: true },
                ].map(({ id, label: lbl, val, set, ph, autoFocus, mono }) => (
                    <div key={id} className="space-y-1.5">
                        <label htmlFor={id} className="text-[10px] font-bold text-white/70 uppercase tracking-[0.1em] block">
                            {lbl} <span className="text-error">*</span>
                        </label>
                        <Input id={id} name={id} value={val} onChange={(e) => set(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} placeholder={ph} autoFocus={autoFocus} mono={mono} />
                    </div>
                ))}
                <div className="flex gap-2 pt-1">
                    <button
                        onClick={onClose}
                        style={{ outline: "none" }}
                        className="flex-1 py-2 rounded-lg text-[12px] text-white/85 hover:text-white hover:bg-white/[0.08] transition-colors border border-white/[0.14]">
                        Cancel
                    </button>
                    <button
                        onClick={save}
                        disabled={!label.trim() || !path.trim() || saving}
                        style={{ outline: "none" }}
                        className="flex-1 py-2 rounded-lg text-[12px] font-semibold bg-primary text-primary-content hover:opacity-90 transition-opacity border-none disabled:opacity-40 flex items-center justify-center gap-1.5">
                        {saving ? <span className="loading loading-spinner loading-xs" /> : <Check size={11} />}
                        {saving ? "Saving…" : "Save"}
                    </button>
                </div>
            </div>
        </Modal>
    );
}

export default function LibrarySection({ folders, removeLibraryFolder, updateLibraryFolder, setAddFolderOpen, refreshAll, loading }) {
    const [editTarget, setEditTarget] = useState(null);

    return (
        <div className="space-y-5 w-full">
            <SectionLabel>Media Folders</SectionLabel>

            <Card>
                {folders.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 py-14 text-center">
                        <FolderOpen size={28} className="text-white/25" />
                        <div>
                            <p className="text-[13px] font-medium text-white/90">No folders yet</p>
                            <p className="text-[11px] text-white/70 mt-0.5">Add a folder to start scanning media</p>
                        </div>
                    </div>
                ) : (
                    folders.map((f) => (
                        <div key={f.id} className="flex items-center gap-3 px-5 py-3.5 border-b border-white/[0.09] last:border-0 hover:bg-white/[0.04] transition-colors group">
                            <FolderOpen size={15} className="text-primary/80 shrink-0" />
                            <div className="flex-1 min-w-0">
                                <p className="text-[13px] font-medium text-white truncate leading-tight">{f.label || f.path}</p>
                                {f.label && <p className="text-[10px] text-white/65 truncate font-mono mt-0.5">{f.path}</p>}
                                {f.addedAt && (
                                    <p className="text-[9px] text-white/50 mt-0.5">Added {new Date(f.addedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</p>
                                )}
                            </div>
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                <button
                                    onClick={() => setEditTarget(f)}
                                    style={{ outline: "none" }}
                                    className="w-7 h-7 rounded-lg flex items-center justify-center text-white/65 hover:text-accent hover:bg-accent/15 transition-all">
                                    <SquarePen size={13} />
                                </button>
                                <button
                                    onClick={() => removeLibraryFolder(f.id)}
                                    style={{ outline: "none" }}
                                    className="w-7 h-7 rounded-lg flex items-center justify-center text-white/65 hover:text-error hover:bg-error/15 transition-all">
                                    <Trash2 size={13} />
                                </button>
                            </div>
                        </div>
                    ))
                )}

                <div className="px-5 py-3.5 border-t border-white/[0.09] flex items-center gap-2.5 flex-wrap">
                    <button
                        onClick={() => setAddFolderOpen(true)}
                        style={{ outline: "none" }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/15 border border-primary/30 text-primary/95 hover:bg-primary/22 hover:text-primary transition-all text-[11px] font-semibold">
                        <FolderPlus size={12} /> Add Folder
                    </button>
                    <button
                        onClick={refreshAll}
                        disabled={loading?.refreshAllMetadata}
                        style={{ outline: "none" }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.14] text-white/85 hover:text-white transition-all text-[11px] font-medium disabled:opacity-40">
                        <RefreshCw size={11} className={loading?.refreshAllMetadata ? "animate-spin" : ""} />
                        Refresh Metadata
                    </button>
                </div>
            </Card>

            <EditFolderModal open={!!editTarget} onClose={() => setEditTarget(null)} folder={editTarget} onSave={async (id, u) => await updateLibraryFolder(id, u)} />
        </div>
    );
}
