// web/src/dashboard/pages/DashUploads.jsx
// Upload manager — drag/drop files to a media library folder

import { useState, useRef, useCallback } from "react";
import { Upload, X, CheckCircle, AlertTriangle, FolderOpen, Film, Loader2, Plus } from "lucide-react";
import { api } from "../../api/client";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:5000";

function fmtBytes(b) {
    if (!b) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(b) / Math.log(1024));
    return `${(b / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function fmtSpeed(bps) {
    if (!bps) return "";
    return `${fmtBytes(bps)}/s`;
}

// Status icon for queue item
function StatusIcon({ status }) {
    if (status === "done") return <CheckCircle size={16} className="text-success shrink-0" />;
    if (status === "error") return <AlertTriangle size={16} className="text-error shrink-0" />;
    if (status === "uploading") return <Loader2 size={16} className="text-primary animate-spin shrink-0" />;
    return <Film size={16} className="text-base-content/30 shrink-0" />;
}

export default function DashUploads() {
    const [queue, setQueue] = useState([]); // [{ id, file, status, progress, error, speed }]
    const [dragging, setDragging] = useState(false);
    const [libraries, setLibraries] = useState([]);
    const [selectedLib, setSelectedLib] = useState("");
    const [libsLoaded, setLibsLoaded] = useState(false);
    const inputRef = useRef(null);

    // Load libraries once
    const loadLibs = useCallback(async () => {
        if (libsLoaded) return;
        try {
            const data = await api.get("/api/library");
            const folders = data.folders || [];
            setLibraries(folders);
            if (folders.length > 0) setSelectedLib(folders[0].id);
        } catch {}
        setLibsLoaded(true);
    }, [libsLoaded]);

    // Load libs on first interaction
    const handleFocus = () => {
        if (!libsLoaded) loadLibs();
    };

    function addFiles(files) {
        const newItems = Array.from(files).map((file) => ({
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            file,
            status: "queued",
            progress: 0,
            error: null,
            speed: 0,
        }));
        setQueue((q) => [...q, ...newItems]);
    }

    function removeItem(id) {
        setQueue((q) => q.filter((i) => i.id !== id));
    }

    function clearDone() {
        setQueue((q) => q.filter((i) => i.status !== "done"));
    }

    // Upload single item via XHR for progress
    function uploadItem(item) {
        return new Promise((resolve) => {
            const lib = libraries.find((l) => l.id === selectedLib);
            if (!lib) {
                setQueue((q) => q.map((i) => (i.id === item.id ? { ...i, status: "error", error: "No library selected" } : i)));
                return resolve();
            }

            const fd = new FormData();
            fd.append("file", item.file);
            fd.append("folderId", lib.id);
            fd.append("folderPath", lib.path);

            const xhr = new XMLHttpRequest();
            let lastTime = Date.now();
            let lastLoaded = 0;

            xhr.upload.onprogress = (e) => {
                if (!e.lengthComputable) return;
                const pct = Math.round((e.loaded / e.total) * 100);
                const now = Date.now();
                const dt = (now - lastTime) / 1000;
                const speed = dt > 0 ? (e.loaded - lastLoaded) / dt : 0;
                lastTime = now;
                lastLoaded = e.loaded;
                setQueue((q) => q.map((i) => (i.id === item.id ? { ...i, status: "uploading", progress: pct, speed } : i)));
            };

            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    setQueue((q) => q.map((i) => (i.id === item.id ? { ...i, status: "done", progress: 100 } : i)));
                } else {
                    setQueue((q) => q.map((i) => (i.id === item.id ? { ...i, status: "error", error: `Server error ${xhr.status}` } : i)));
                }
                resolve();
            };

            xhr.onerror = () => {
                setQueue((q) => q.map((i) => (i.id === item.id ? { ...i, status: "error", error: "Network error" } : i)));
                resolve();
            };

            xhr.open("POST", `${BASE}/api/admin-dashboard/upload`);
            xhr.send(fd);

            setQueue((q) => q.map((i) => (i.id === item.id ? { ...i, status: "uploading" } : i)));
        });
    }

    async function startUpload() {
        const queued = queue.filter((i) => i.status === "queued" || i.status === "error");
        for (const item of queued) {
            await uploadItem(item);
        }
    }

    // Drag events
    const onDragOver = (e) => {
        e.preventDefault();
        setDragging(true);
    };
    const onDragLeave = (e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
    };
    const onDrop = (e) => {
        e.preventDefault();
        setDragging(false);
        addFiles(e.dataTransfer.files);
        loadLibs();
    };

    const hasQueued = queue.some((i) => i.status === "queued" || i.status === "error");
    const hasUploading = queue.some((i) => i.status === "uploading");
    const hasDone = queue.some((i) => i.status === "done");

    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-base-content">Uploads</h1>
                    <p className="text-sm text-base-content/40 mt-0.5">Add media files directly to a library folder</p>
                </div>
                {hasDone && (
                    <button onClick={clearDone} className="btn btn-sm btn-ghost text-base-content/40 gap-1.5">
                        <X size={13} /> Clear done
                    </button>
                )}
            </div>

            {/* Library selector */}
            <div className="card bg-base-200 shadow-sm">
                <div className="card-body py-4 gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                        <FolderOpen size={16} className="text-primary shrink-0" />
                        <label htmlFor="target-library" className="text-sm font-medium text-base-content/70 shrink-0">Target Library</label>
                        <select id="target-library" name="targetLibrary" className="select select-sm select-bordered bg-base-300 flex-1 min-w-48" value={selectedLib} onChange={(e) => setSelectedLib(e.target.value)} onFocus={handleFocus}>
                            {!libsLoaded && <option value="">Loading libraries…</option>}
                            {libsLoaded && libraries.length === 0 && <option value="">No libraries configured</option>}
                            {libraries.map((l) => (
                                <option key={l.id} value={l.id}>
                                    {l.label || l.path}
                                </option>
                            ))}
                        </select>
                    </div>
                    {selectedLib && libraries.length > 0 && <p className="text-xs text-base-content/30 font-mono pl-7">{libraries.find((l) => l.id === selectedLib)?.path}</p>}
                </div>
            </div>

            {/* Drop zone */}
            <div
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                onClick={() => inputRef.current?.click()}
                className={[
                    "rounded-2xl border-2 border-dashed cursor-pointer",
                    "flex flex-col items-center justify-center gap-3 py-12 px-6",
                    "transition-all duration-200 select-none",
                    dragging ? "border-primary bg-primary/5 scale-[1.01]" : "border-base-content/15 hover:border-primary/40 hover:bg-base-content/2",
                ].join(" ")}>
                <label htmlFor="upload-files" className="sr-only">Upload files</label>
                <input
                    id="upload-files"
                    name="files"
                    ref={inputRef}
                    type="file"
                    multiple
                    accept="video/*,.mkv,.avi,.ts,.m2ts"
                    className="hidden"
                    onChange={(e) => {
                        addFiles(e.target.files);
                        loadLibs();
                        e.target.value = "";
                    }}
                />
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-colors ${dragging ? "bg-primary/20" : "bg-base-300"}`}>
                    <Upload size={24} className={dragging ? "text-primary" : "text-base-content/30"} />
                </div>
                <div className="text-center">
                    <p className="font-semibold text-base-content/70">{dragging ? "Drop files here" : "Drag & drop video files"}</p>
                    <p className="text-sm text-base-content/35 mt-1">or click to browse · mp4, mkv, avi, mov, ts supported</p>
                </div>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        inputRef.current?.click();
                    }}
                    className="btn btn-sm btn-primary gap-1.5 mt-1">
                    <Plus size={14} /> Choose Files
                </button>
            </div>

            {/* Queue */}
            {queue.length > 0 && (
                <div className="card bg-base-200 shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-base-content/5 flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-base-content/70">
                            Upload Queue
                            <span className="ml-2 badge badge-sm badge-ghost">{queue.length}</span>
                        </h3>
                        <button onClick={startUpload} disabled={!hasQueued || hasUploading || !selectedLib} className="btn btn-sm btn-primary gap-1.5">
                            {hasUploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                            {hasUploading ? "Uploading…" : "Start Upload"}
                        </button>
                    </div>

                    <ul className="divide-y divide-base-content/5">
                        {queue.map((item) => (
                            <li key={item.id} className="flex items-center gap-3 px-5 py-3">
                                <StatusIcon status={item.status} />

                                <div className="flex-1 min-w-0 space-y-1">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-sm text-base-content/75 truncate">{item.file.name}</span>
                                        <span className="text-xs text-base-content/35 shrink-0">{fmtBytes(item.file.size)}</span>
                                    </div>

                                    {item.status === "uploading" && (
                                        <div className="space-y-0.5">
                                            <progress className="progress progress-primary w-full h-1" value={item.progress} max="100" />
                                            <div className="flex justify-between text-[10px] text-base-content/30">
                                                <span>{item.progress}%</span>
                                                {item.speed > 0 && <span>{fmtSpeed(item.speed)}</span>}
                                            </div>
                                        </div>
                                    )}

                                    {item.status === "done" && <p className="text-xs text-success">Upload complete</p>}

                                    {item.status === "error" && <p className="text-xs text-error">{item.error || "Upload failed"}</p>}
                                </div>

                                {item.status !== "uploading" && (
                                    <button onClick={() => removeItem(item.id)} className="btn btn-ghost btn-xs btn-square text-base-content/30 hover:text-error shrink-0">
                                        <X size={14} />
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
