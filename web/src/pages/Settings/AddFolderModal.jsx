import { useState, useRef } from "react";
import { FolderPlus, FolderOpen } from "lucide-react";
import { Modal, Input, GhostButton, PrimaryButton } from "./shared";

export default function AddFolderModal({ open, onClose, onAdd }) {
    const [label, setLabel] = useState("");
    const [path, setPath] = useState("");
    const fileRef = useRef(null);

    function pickFolder(e) {
        const files = e.target.files;
        if (!files?.length) return;
        const name = (files[0].webkitRelativePath || "").split("/")[0] || "";
        if (name) setPath(name);
        e.target.value = "";
    }

    function submit() {
        if (!path.trim() || !label.trim()) return;
        onAdd(path.trim(), label.trim());
        setPath("");
        setLabel("");
        onClose();
    }

    return (
        <Modal open={open} onClose={onClose} title="Add media folder" subtitle="Point Flux to a folder on your server">
            <div className="space-y-4">
                {[{ id: "af-label", label: "Display label", val: label, set: setLabel, ph: "Movies, Anime, TV Shows…", autoFocus: true }].map(({ id, label: lbl, val, set, ph, autoFocus }) => (
                    <div key={id} className="space-y-1.5">
                        <label htmlFor={id} className="text-[10px] font-bold text-white/75 uppercase tracking-[0.1em] block">
                            {lbl} <span className="text-error">*</span>
                        </label>
                        <Input id={id} name={id} value={val} onChange={(e) => set(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder={ph} autoFocus={autoFocus} />
                    </div>
                ))}

                <div className="space-y-1.5">
                    <label htmlFor="af-path" className="text-[10px] font-bold text-white/75 uppercase tracking-[0.1em] block">
                        Folder path <span className="text-error">*</span>
                    </label>
                    <div className="flex items-center rounded-lg overflow-hidden border border-white/[0.18] bg-white/[0.09] focus-within:border-primary transition-colors">
                        <input
                            id="af-path"
                            name="path"
                            value={path}
                            onChange={(e) => setPath(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && submit()}
                            placeholder="D:\Movies  or  /media/movies"
                            style={{ outline: "none", boxShadow: "none" }}
                            className="flex-1 bg-transparent border-0 px-3 py-[7px] text-[13px] text-white font-mono placeholder:text-white/55 min-w-0 focus:outline-none"
                        />
                        <button
                            type="button"
                            onClick={() => fileRef.current?.click()}
                            style={{ outline: "none" }}
                            className="flex items-center gap-1 px-3 h-8 shrink-0 border-l border-white/[0.18] text-white/85 hover:text-white hover:bg-white/[0.12] transition-colors text-[11px] font-semibold">
                            <FolderOpen size={12} />
                            <span className="hidden sm:inline">Browse</span>
                        </button>
                    </div>
                    <p className="text-[10.5px] text-white/65">Absolute path to the folder on your server.</p>
                    <input ref={fileRef} type="file" webkitdirectory="true" multiple className="hidden" onChange={pickFolder} />
                </div>
            </div>

            <div className="flex gap-2 mt-5">
                <GhostButton onClick={onClose} className="flex-1 justify-center">
                    Cancel
                </GhostButton>
                <PrimaryButton onClick={submit} disabled={!path.trim() || !label.trim()}>
                    <span className="flex-1 flex items-center justify-center gap-1.5 w-full">
                        <FolderPlus size={12} /> Add folder
                    </span>
                </PrimaryButton>
            </div>
        </Modal>
    );
}
