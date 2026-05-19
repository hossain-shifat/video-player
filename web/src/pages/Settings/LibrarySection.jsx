import { FolderOpen, FolderPlus, Trash2, RefreshCw } from "lucide-react";
import { Card, SectionTitle } from "./shared";

export default function LibrarySection({ folders, removeLibraryFolder, setAddFolderOpen, refreshAll, loading }) {
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
                                {f.label && <p className="text-xs text-base-content/35 truncate mt-0.5">{f.path}</p>}
                            </div>
                            <button
                                onClick={() => removeLibraryFolder(f.id)}
                                style={{ outline: "none", boxShadow: "none" }}
                                className="opacity-0 group-hover:opacity-100 transition-opacity w-7 h-7 rounded flex items-center justify-center hover:bg-error/15 text-base-content/30 hover:text-error focus:outline-none focus-visible:outline-none">
                                <Trash2 size={13} />
                            </button>
                        </div>
                    ))
                )}
                <div className="px-6 py-4 border-t border-white/5 flex items-center gap-3">
                    <button onClick={() => setAddFolderOpen(true)} style={{ outline: "none", boxShadow: "none" }} className="btn btn-sm btn-primary rounded gap-1.5 border-none">
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
        </div>
    );
}
