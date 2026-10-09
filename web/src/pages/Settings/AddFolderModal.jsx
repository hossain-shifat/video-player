import { useState, useRef } from "react";
import { FolderPlus, FolderOpen } from "lucide-react";
import { Modal, Input, Field, GhostButton, PrimaryButton } from "./shared";

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
        <Modal open={open} onClose={onClose} title="Add media folder" subtitle="Point Flux to a folder on your server.">
            <div className="space-y-4">
                <Field id="af-label" label="Display name" required>
                    <Input id="af-label" name="af-label" value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Movies, Anime, TV Shows…" autoFocus />
                </Field>

                <Field id="af-path" label="Folder path" required hint="Type the full path as the server sees it. Browse only fills in the folder name.">
                    <div className="flex items-stretch gap-2">
                        <Input id="af-path" name="path" value={path} onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="D:\Movies  or  /media/movies" mono />
                        <GhostButton onClick={() => fileRef.current?.click()} className="shrink-0">
                            <FolderOpen size={14} />
                            <span className="hidden sm:inline">Browse</span>
                        </GhostButton>
                    </div>
                    <input ref={fileRef} type="file" webkitdirectory="true" multiple className="hidden" onChange={pickFolder} />
                </Field>
            </div>

            <div className="mt-6 flex gap-2">
                <GhostButton onClick={onClose} className="flex-1">
                    Cancel
                </GhostButton>
                <PrimaryButton onClick={submit} disabled={!path.trim() || !label.trim()} className="flex-1">
                    <FolderPlus size={14} /> Add folder
                </PrimaryButton>
            </div>
        </Modal>
    );
}
