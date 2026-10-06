"use strict";

// web/src/dashboard/upload/FluxUploaderPlugin.js
//
// A custom Uppy (v5) uploader plugin. This is the actual "Uppy as the
// upload engine" integration point: Uppy owns file selection, the queue,
// pause/cancel/retry primitives, and event plumbing; this plugin owns the
// TRANSPORT — chunking a file, POSTing chunks to our existing
// /api/storage/upload-chunk endpoint, and polling /api/storage/upload-progress
// for the server's own server->provider (local/cloud) leg. Nothing about the
// backend contract changes — this is the exact same protocol the previous
// hand-rolled manager used, just driven by Uppy's plugin lifecycle instead.
//
// Why not @uppy/tus / @uppy/aws-s3 / @uppy/xhr-upload? Those all assume a
// specific server protocol (tus, S3 presigned multipart, plain single POST)
// that FLUX's backend doesn't speak — FLUX's chunk protocol is custom
// (chunkUploadStore.js, storageController.js). Writing a small custom
// uploader plugin against BasePlugin.addUploader() is Uppy's own documented
// extension point for exactly this situation, and is the only way to use
// Uppy here without rewriting the backend (which was explicitly ruled out).
//
// FILE STATE CONTRACT (what this plugin reads/writes on each Uppy file):
//   file.data           — Blob|File, the actual bytes (may be a 0-byte
//                          placeholder for a restored-but-not-reattached file)
//   file.name           — display filename (renameable)
//   file.error          — Uppy's own native error string field
//   file.isPaused        — Uppy's own native pause flag (toggled by pauseResume())
//   file.meta.fileSize   — the REAL size (decoupled from file.data.size, which
//                          may be a placeholder — see uploadManager.js's init())
//   file.meta.mimeType, .lastModified, .libraryId, .storageSource,
//        .providerLabel, .totalChunks, .chunkIndex, .status, .canRetryStage2,
//        .neverStarted, .hasHandle, .suggestRename, .speed, .phaseLabel, .stalled
//   — all FLUX-specific fields live in `meta`, Uppy's designated free-form bag.

import { BasePlugin } from "@uppy/core";
import { storageApi } from "../api/storageApi";

export const CHUNK_SIZE = 16 * 1024 * 1024; // 16MB per chunk
const CHUNK_CONCURRENCY = 5;
const CHUNK_MAX_RETRIES = 6; // per-chunk retry ceiling before the item is marked failed
const CHUNK_RETRY_BASE_MS = 1000; // 1s,2s,4s,8s,16s,32s

export function computeTotalChunks(size) {
    return Math.max(1, Math.ceil(size / CHUNK_SIZE));
}

function _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export default class FluxUploaderPlugin extends BasePlugin {
    constructor(uppy, opts) {
        super(uppy, opts);
        this.id = opts?.id || "FluxUploaderPlugin";
        this.type = "uploader";
        this.upload = this.upload.bind(this);
        // fileID -> { abortSet: Set<AbortController>, missingIndices: number[]|null,
        //             pollTimer, runningLoop: bool }
        this._runtime = new Map();
    }

    install() {
        this.uppy.addUploader(this.upload);
        // REQUIRED — pauseResume() silently no-ops (returns undefined, does
        // nothing) unless a resumable-capable plugin explicitly sets this.
        // Confirmed against Uppy's real source (Uppy.js pauseResume()) before
        // writing this — normally set by @uppy/tus, which we're not using.
        this.uppy.setState({ capabilities: { ...this.uppy.getState().capabilities, resumableUploads: true } });
        this.uppy.on("upload-pause", this._onPause);
    }

    uninstall() {
        this.uppy.removeUploader(this.upload);
        this.uppy.off("upload-pause", this._onPause);
    }

    _rt(fileID) {
        let rt = this._runtime.get(fileID);
        if (!rt) {
            rt = { abortSet: new Set(), missingIndices: null, pollTimer: null, runningLoop: false };
            this._runtime.set(fileID, rt);
        }
        return rt;
    }

    _onPause = (file, isPaused) => {
        if (!file) return;
        const rt = this._rt(file.id);
        if (isPaused) {
            rt.abortSet.forEach((c) => c.abort());
        } else if (file.meta.status !== "finalizing" && file.meta.status !== "done") {
            // Only re-run stage 1 (chunking) if it wasn't already finished —
            // otherwise this would start a second, redundant poll cycle
            // alongside whichever one is already tracking stage 2.
            this.reconcileAndRun(file.id);
        }
    };

    _patchMeta(fileID, patch) {
        const file = this.uppy.getFile(fileID);
        if (!file) return;
        this.uppy.setFileState(fileID, { meta: { ...file.meta, ...patch } });
    }

    abortFile(fileID) {
        const rt = this._runtime.get(fileID);
        if (!rt) return;
        rt.cancelled = true;
        if (rt.pollTimer) {
            clearInterval(rt.pollTimer);
            rt.pollTimer = null;
        }
        rt.abortSet.forEach((c) => c.abort());
    }

    // Called by uploadManager.js when the Start Upload button (or a resume/
    // reattach) needs this file to actually begin transferring.
    async reconcileAndRun(fileID) {
        const file = this.uppy.getFile(fileID);
        if (!file || !file.data || file.data.size === 0) return; // no real bytes attached yet (needsFile/needsPermission)
        // REQUIRED — Uppy's internal upload-progress handler ignores every
        // progress event until the file's progress.uploadStarted is set; this
        // is the only public way to set it (mirrors what @uppy/tus etc do
        // internally). Guarded to fire once per file — re-emitting on every
        // resume would reset bytesUploaded to 0 in Uppy's own bookkeeping,
        // causing a visible flash back to 0% each time.
        if (file.progress.uploadStarted == null) {
            this.uppy.emit("upload-start", [file]);
        }
        const rt = this._rt(fileID);
        rt.cancelled = false; // a fresh run always clears any prior cancel — otherwise a retry/resume after cancel would be permanently stuck
        try {
            const status = await storageApi.chunkStatus(file.meta.sessionId);
            rt.missingIndices = status.missingIndices;
            this._patchMeta(fileID, { chunkIndex: status.receivedChunks, totalChunks: status.totalChunks });
        } catch {
            rt.missingIndices = null; // no session found server-side (expired/cleaned) — starts fresh under the same id
        }
        await this._runChunkLoop(fileID);
    }

    // Uppy's own uploader entry point — called with the fileIDs it has
    // decided need uploading (its internal, well-tested batching logic).
    async upload(fileIDs) {
        for (const fileID of fileIDs) {
            const file = this.uppy.getFile(fileID);
            if (!file) continue;
            if (file.meta.canRetryStage2) continue; // stage-2-only retry goes through retryStage2Upload directly, not a fresh chunk run
            await this.reconcileAndRun(fileID);
        }
    }

    async _uploadChunkWithRetry(fileID, chunkIndex, blob, totalChunks, file, rt) {
        for (let attempt = 0; attempt <= CHUNK_MAX_RETRIES; attempt++) {
            if (file.isPaused || rt.cancelled) return { aborted: true };
            const controller = new AbortController();
            rt.abortSet.add(controller);

            const fd = new FormData();
            fd.append("chunk", blob, `chunk_${chunkIndex}`);
            fd.append("sessionId", file.meta.sessionId);
            fd.append("chunkIndex", String(chunkIndex));
            fd.append("totalChunks", String(totalChunks));
            fd.append("chunkSize", String(CHUNK_SIZE));
            fd.append("fileSize", String(file.meta.fileSize));
            fd.append("filename", file.name);
            fd.append("libraryId", file.meta.libraryId);
            fd.append("mimeType", file.meta.mimeType || "application/octet-stream");

            try {
                const res = await storageApi.uploadChunk(fd, controller.signal);
                rt.abortSet.delete(controller);
                return { res };
            } catch (err) {
                rt.abortSet.delete(controller);
                if (err.name === "AbortError") return { aborted: true };
                if (attempt === CHUNK_MAX_RETRIES) return { error: err };
                const delayMs = CHUNK_RETRY_BASE_MS * 2 ** attempt;
                this._patchMeta(fileID, { stalled: true, phaseLabel: `Network hiccup — retrying in ${Math.round(delayMs / 1000)}s…` });
                await _sleep(delayMs);
                if (this.uppy.getFile(fileID)?.isPaused || rt.cancelled) return { aborted: true };
            }
        }
        return { aborted: true }; // unreachable, satisfies linters
    }

    async _runChunkLoop(fileID) {
        const rt = this._rt(fileID);
        if (rt.runningLoop) return;
        rt.runningLoop = true;

        const file = this.uppy.getFile(fileID);
        const blob = file.data;
        const totalChunks = file.meta.totalChunks;
        // `rt.missingIndices === null` means no reconciliation happened yet
        // (fresh upload) — send everything. An EMPTY array means reconcile
        // DID happen and found nothing missing — must NOT fall through to
        // "send everything" (that check used to be `.length` truthiness,
        // which treats `[]` the same as null/undefined — `[].length` is
        // falsy — silently triggering a full wasteful re-upload of chunks
        // the server already had, on every single resume of an
        // already-fully-chunked file).
        const pending = rt.missingIndices === null ? Array.from({ length: totalChunks }, (_, k) => k) : [...rt.missingIndices];

        if (pending.length === 0) {
            // Every chunk already landed server-side — this resume picked up
            // mid stage-2 (or exactly at the stage-1/stage-2 boundary).
            // Nothing to send; just make sure polling is running instead of
            // spinning up a worker that would immediately no-op.
            rt.runningLoop = false;
            const providerLabel = file.meta.providerLabel || "your library";
            this._patchMeta(fileID, { status: "finalizing", phaseLabel: `Uploading to ${providerLabel}` });
            this.startPollingProvider(fileID);
            return;
        }
        let cursor = 0;
        let transitioned = false;
        let bytesAcked = (totalChunks - pending.length) * CHUNK_SIZE;
        const loopStart = Date.now();
        let lastUpdate = 0;

        const nextIndex = () => (cursor < pending.length ? pending[cursor++] : null);

        const worker = async () => {
            while (true) {
                const liveFile = this.uppy.getFile(fileID);
                if (!liveFile || liveFile.isPaused || rt.cancelled) return;
                const idx = nextIndex();
                if (idx === null) return;

                const start = idx * CHUNK_SIZE;
                const end = Math.min(start + CHUNK_SIZE, blob.size);
                const chunkBlob = blob.slice(start, end);

                const outcome = await this._uploadChunkWithRetry(fileID, idx, chunkBlob, totalChunks, liveFile, rt);
                if (outcome.aborted) return;
                if (outcome.error) {
                    this.uppy.emit("upload-error", liveFile, { name: "ChunkUploadError", message: outcome.error.message || "Chunk upload failed" });
                    this._patchMeta(fileID, { status: "error", speed: 0, stalled: false });
                    return;
                }

                const res = outcome.res;
                bytesAcked += end - start;
                const now = Date.now();
                const elapsed = (now - loopStart) / 1000;
                const speed = elapsed > 0 ? bytesAcked / elapsed : 0;
                const pct = Math.round((res.receivedChunks / totalChunks) * 100);

                if (now - lastUpdate > 150 || res.complete) {
                    lastUpdate = now;
                    this._patchMeta(fileID, { chunkIndex: res.receivedChunks, status: "uploading", speed, stalled: false, phaseLabel: "Processing for upload" });
                    this.uppy.emit("upload-progress", liveFile, { uploadStarted: loopStart, bytesUploaded: Math.min(res.receivedChunks * CHUNK_SIZE, liveFile.meta.fileSize), bytesTotal: liveFile.meta.fileSize });
                }

                if (res.complete && !transitioned && !rt.cancelled) {
                    transitioned = true;
                    const providerLabel = liveFile.meta.providerLabel || "your library";
                    this._patchMeta(fileID, { status: "finalizing", phaseLabel: `Uploading to ${providerLabel}`, speed: 0 });
                    this.startPollingProvider(fileID);
                }
            }
        };

        const workerCount = Math.max(1, Math.min(CHUNK_CONCURRENCY, pending.length));
        await Promise.all(Array.from({ length: workerCount }, () => worker()));
        rt.runningLoop = false;
    }

    // Exposed so uploadManager.js's stage-2-only retry (retryItem) can
    // restart polling without re-running the whole chunk loop — every chunk
    // already made it to the server, only the server->provider leg failed.
    startPollingProvider(fileID) {
        const rt = this._rt(fileID);
        if (rt.pollTimer) {
            clearInterval(rt.pollTimer); // a stale timer from an earlier reconcile pass would otherwise be orphaned here — never cleared, ticking forever
            rt.pollTimer = null;
        }
        const file = this.uppy.getFile(fileID);
        const providerLabel = file?.meta.providerLabel || "your library";
        let lastBytes = 0;
        let lastTime = Date.now();
        let stalledTicks = 0;
        const STALL_THRESHOLD = 4;

        rt.pollTimer = setInterval(async () => {
            if (rt.cancelled) {
                clearInterval(rt.pollTimer);
                rt.pollTimer = null;
                return;
            }
            try {
                const session = await storageApi.uploadProgress(file.meta.sessionId);
                const liveFile = this.uppy.getFile(fileID);
                if (!liveFile) {
                    clearInterval(rt.pollTimer);
                    rt.pollTimer = null;
                    return;
                }
                if (session.status === "done") {
                    clearInterval(rt.pollTimer);
                    rt.pollTimer = null;
                    this._patchMeta(fileID, { status: "done", speed: 0, stalled: false });
                    this.uppy.emit("upload-progress", liveFile, { uploadStarted: lastTime, bytesUploaded: liveFile.meta.fileSize, bytesTotal: liveFile.meta.fileSize });
                    this.uppy.emit("upload-success", liveFile, { status: 200, body: {}, uploadURL: undefined });
                    return;
                }
                if (session.status === "error") {
                    clearInterval(rt.pollTimer);
                    rt.pollTimer = null;
                    this._patchMeta(fileID, { status: "error", speed: 0, canRetryStage2: true });
                    this.uppy.emit("upload-error", liveFile, { name: "ProviderUploadError", message: "Upload to provider failed — connection issue" });
                    return;
                }

                const now = Date.now();
                const dt = (now - lastTime) / 1000;
                const deltaBytes = session.sent - lastBytes;
                const speed = dt > 0 ? deltaBytes / dt : 0;
                lastTime = now;
                lastBytes = session.sent;
                stalledTicks = deltaBytes > 0 ? 0 : stalledTicks + 1;
                const isStalled = stalledTicks >= STALL_THRESHOLD;

                this._patchMeta(fileID, {
                    status: "finalizing",
                    speed,
                    stalled: isStalled,
                    phaseLabel: isStalled ? `Uploading to ${providerLabel} (waiting on response…)` : `Uploading to ${providerLabel}`,
                });
                this.uppy.emit("upload-progress", liveFile, { uploadStarted: lastTime, bytesUploaded: session.sent, bytesTotal: session.total || liveFile.meta.fileSize });
            } catch {
                stalledTicks += 1;
                if (stalledTicks >= STALL_THRESHOLD) this._patchMeta(fileID, { stalled: true, phaseLabel: `Uploading to ${providerLabel} — poll failing` });
            }
        }, 1000);
    }
}
