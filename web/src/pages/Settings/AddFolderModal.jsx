import { useState, useRef } from "react";
import { FolderPlus, FolderOpen } from "lucide-react";
import { Modal } from "./shared";

export default function AddFolderModal({ open, onClose, onAdd }) {
    const [label, setLabel] = useState("");
    const [path, setPath] = useState("");
    const fileInputRef = useRef(null);

    const handlePickerChange = (e) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        const firstPath = files[0].webkitRelativePath || "";
        const folderName = firstPath.split("/")[0] || "";
        if (folderName) setPath(folderName);
        e.target.value = "";
    };

    const submit = () => {
        if (!path.trim() || !label.trim()) return;
        onAdd(path.trim(), label.trim());
        setPath("");
        setLabel("");
        onClose();
    };

    return (
        <Modal open={open} onClose={onClose} title="Add Media Folder">
            <div className="space-y-4">
                {/* Label — required */}
                <div>
                    <label htmlFor="settings-folder-label" className="text-xs font-medium text-white/70 mb-1.5 block">
                        Display Label <span className="text-error">*</span>
                    </label>
                    <input
                        id="settings-folder-label"
                        name="label"
                        autoFocus
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        placeholder="Movies, Anime, TV Shows…"
                        className="input input-sm w-full bg-base-300 border-white/10 text-sm rounded"
                        onKeyDown={(e) => e.key === "Enter" && submit()}
                    />
                </div>

                {/* Folder path — picker button fused to input end */}
                <div>
                    <label htmlFor="settings-folder-path" className="text-xs font-medium text-white/70 mb-1.5 block">
                        Folder Path <span className="text-error">*</span>
                    </label>

                    <div className="flex items-center gap-0 rounded overflow-hidden border border-white/10 bg-base-300 focus-within:border-primary/40 transition-colors">
                        <input
                            id="settings-folder-path"
                            name="path"
                            value={path}
                            onChange={(e) => setPath(e.target.value)}
                            placeholder="D:\Movies  or  /media/movies"
                            className="input input-sm flex-1 bg-transparent border-0 rounded-none text-sm font-mono focus:outline-none min-w-0"
                            style={{ boxShadow: "none" }}
                            onKeyDown={(e) => e.key === "Enter" && submit()}
                        />
                        {/* Picker button fused to right end of input */}
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            title="Select folder"
                            style={{ outline: "none", boxShadow: "none" }}
                            className="flex items-center gap-1.5 px-3 h-8 shrink-0 border-l border-white/10 text-white/50 hover:text-white hover:bg-white/5 transition-colors text-xs font-medium focus:outline-none focus-visible:outline-none">
                            <FolderOpen size={13} />
                            <span className="hidden sm:inline">Browse</span>
                        </button>
                    </div>

                    {/* Hidden directory picker */}
                    <label htmlFor="settings-folder-picker" className="sr-only">Directory picker</label>
                    <input
                        id="settings-folder-picker"
                        name="folderPicker"
                        ref={fileInputRef}
                        type="file"
                        /* @ts-ignore */
                        webkitdirectory="true"
                        multiple
                        className="hidden"
                        onChange={handlePickerChange}
                    />
                    <p className="text-xs text-white/30 mt-1.5">Full absolute path to your media folder on the server.</p>
                </div>
            </div>

            <div className="flex gap-2 mt-5">
                <button onClick={onClose} style={{ outline: "none", boxShadow: "none" }} className="btn btn-sm btn-ghost flex-1 rounded focus:outline-none focus-visible:outline-none">
                    Cancel
                </button>
                <button onClick={submit} disabled={!path.trim() || !label.trim()} style={{ outline: "none", boxShadow: "none" }} className="btn btn-sm btn-primary flex-1 rounded gap-1.5 border-none">
                    <FolderPlus size={13} /> Add Folder
                </button>
            </div>
        </Modal>
    );
}
