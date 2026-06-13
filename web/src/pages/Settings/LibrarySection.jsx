import { useState, useEffect } from "react";
import { FolderOpen, FolderPlus, Trash2, RefreshCw, SquarePen, Check } from "lucide-react";
import { Card, Modal } from "./shared";

// ─── Edit Folder Modal ────────────────────────────────────────────────────────
function EditFolderModal({ open, onClose, folder, onSave }) {
    const [label, setLabel] = useState("");
    const [path, setPath] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    // Sync fields whenever the target folder changes or modal opens
    useEffect(() => {
        if (folder) {
            setLabel(folder.label || "");
            setPath(folder.path || "");
            setError(null);
            setSaving(false);
        }
    }, [folder]);

    async function handleSave() {
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
                {error && <div className="rounded bg-error/10 border border-error/20 px-3 py-2 text-xs text-error">{error}</div>}

                <div className="space-y-1">
                    <label htmlFor="edit-folder-label" className="text-xs text-base-content/50 font-medium">
                        Display Label <span className="text-error">*</span>
                    </label>
                    <input
                        id="edit-folder-label"
                        name="label"
                        autoFocus
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSave()}
                        placeholder="Movies, Anime, TV Shows…"
                        className="input input-sm w-full bg-base-300 border-white/10 text-sm rounded focus:outline-none"
                        style={{ outline: "none", boxShadow: "none" }}
                    />
                </div>

                <div className="space-y-1">
                    <label htmlFor="edit-folder-path" className="text-xs text-base-content/50 font-medium">
                        Folder Path <span className="text-error">*</span>
                    </label>
                    <input
                        id="edit-folder-path"
                        name="path"
                        value={path}
                        onChange={(e) => setPath(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSave()}
                        placeholder="D:\Movies  or  /media/movies"
                        className="input input-sm w-full bg-base-300 border-white/10 text-sm rounded font-mono focus:outline-none"
                        style={{ outline: "none", boxShadow: "none" }}
                    />
                    <p className="text-xs text-base-content/30">Absolute path on the server.</p>
                </div>

                <div className="flex gap-2 pt-1">
                    <button onClick={onClose} style={{ outline: "none" }} className="btn btn-sm btn-ghost rounded flex-1 focus:outline-none">
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={!label.trim() || !path.trim() || saving}
                        style={{ outline: "none" }}
                        className="btn btn-sm btn-primary rounded gap-1.5 flex-1 border-none focus:outline-none">
                        {saving ? <span className="loading loading-spinner loading-xs" /> : <Check size={13} />}
                        {saving ? "Saving…" : "Save Changes"}
                    </button>
                </div>
            </div>
        </Modal>
    );
}

// ─── LibrarySection ───────────────────────────────────────────────────────────
export default function LibrarySection({ folders, removeLibraryFolder, updateLibraryFolder, setAddFolderOpen, refreshAll, loading }) {
    const [editTarget, setEditTarget] = useState(null);

    async function handleSave(id, updates) {
        await updateLibraryFolder(id, updates);
    }

    return (
        <div className="space-y-5">
            <Card>
                {folders.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 py-12 text-center">
                        <FolderOpen size={32} className="text-base-content/15" />
                        <div>
                            <p className="text-sm font-medium text-base-content/50">No folders added</p>
                            <p className="text-xs text-base-content/30 mt-0.5">Add a folder to start scanning media</p>
                        </div>
                    </div>
                ) : (
                    folders.map((f) => (
                        <div key={f.id} className="flex items-center gap-3 px-6 py-4 border-b border-white/5 last:border-0 hover:bg-white/0.02 transition-colors group">
                            <FolderOpen size={16} className="text-primary/60 shrink-0" />

                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-base-content truncate">{f.label || f.path}</p>
                                {f.label && <p className="text-xs text-base-content/35 truncate mt-0.5 font-mono">{f.path}</p>}
                                {f.addedAt && (
                                    <p className="text-xs text-base-content/20 mt-0.5">
                                        Added {new Date(f.addedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                                    </p>
                                )}
                            </div>

                            {/* Action buttons — always visible, dimmed when idle */}
                            <div className="flex items-center gap-1 shrink-0">
                                <button
                                    onClick={() => setEditTarget(f)}
                                    title="Edit folder"
                                    style={{ outline: "none", boxShadow: "none" }}
                                    className="w-7 h-7 rounded flex items-center justify-center
                                               text-base-content/25 hover:text-primary hover:bg-primary/15
                                               sm:opacity-0 sm:group-hover:opacity-100
                                               transition-all focus:outline-none">
                                    <SquarePen size={18} className="text-accent" />
                                </button>
                                <button
                                    onClick={() => removeLibraryFolder(f.id)}
                                    title="Remove folder"
                                    style={{ outline: "none", boxShadow: "none" }}
                                    className="w-7 h-7 rounded flex items-center justify-center
                                               text-base-content/25 hover:text-error hover:bg-error/15
                                               sm:opacity-0 sm:group-hover:opacity-100
                                               transition-all focus:outline-none">
                                    <Trash2 size={18} className="text-error" />
                                </button>
                            </div>
                        </div>
                    ))
                )}

                <div className="px-6 py-4 border-t border-white/5 flex items-center gap-3 flex-wrap">
                    <button onClick={() => setAddFolderOpen(true)} style={{ outline: "none", boxShadow: "none" }} className="btn btn-sm btn-primary rounded gap-1.5 border-none focus:outline-none">
                        <FolderPlus size={13} /> Add Folder
                    </button>
                    <button
                        onClick={refreshAll}
                        disabled={loading.refreshAllMetadata}
                        style={{ outline: "none", boxShadow: "none" }}
                        className="btn btn-sm btn-ghost rounded gap-1.5 text-base-content/55 focus:outline-none focus-visible:outline-none">
                        <RefreshCw size={13} className={loading.refreshAllMetadata ? "animate-spin" : ""} />
                        Refresh Metadata
                    </button>
                </div>
            </Card>

            <EditFolderModal open={!!editTarget} onClose={() => setEditTarget(null)} folder={editTarget} onSave={handleSave} />
        </div>
    );
}
