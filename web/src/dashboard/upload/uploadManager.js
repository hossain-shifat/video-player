"use strict";

// web/src/dashboard/upload/uploadManager.js
//
// Same public API as before this rewrite (addFiles, startUpload, subscribe,
// getQueue, pauseOrResumeItem, cancelItem, removeItem, retryItem, renameItem,
// attachFileAndResume, requestPermissionAndResume, clearDone, notifications,
// hasFSA, _instanceId, getDebugLog) — DashUploads.jsx, useUploadQueue.js, and
// notifications.js needed ZERO changes for this rewrite. What changed is
// entirely underneath: this now runs on a real Uppy (v5) instance with a
// custom uploader plugin (FluxUploaderPlugin.js) doing the actual chunked
// transport against FLUX's existing, unmodified backend endpoints.
//
// IMPORTANT — SESSION ID vs UPPY FILE ID (read before touching this file):
// Uppy's `file.id` is NOT stable across a page reload — it's deterministically
// generated from name+type+size+lastModified (verified against @uppy/utils'
// generateFileID.js), and a restored file uses a 0-byte placeholder Blob
// (real bytes are gone after a reload) whose size/lastModified will never
// match the original. So `file.id` is only ever used here for Uppy's OWN
// bookkeeping within a single page session. The server-side chunk session —
// which MUST survive a reload to make resume possible at all — is tracked
// separately as `file.meta.sessionId`, a UUID we generate once and persist
// to IndexedDB ourselves. Every server call (chunk upload, chunk status,
// progress poll, cancel, retry) uses `meta.sessionId`, never `file.id`.
//
// Still a module-level singleton (not React state) — the Uppy instance is
// created once at import time, so uploads survive this component unmounting
// on a route change, exactly like the previous hand-rolled manager did.

import Uppy from "@uppy/core";
import FluxUploaderPlugin, { CHUNK_SIZE, computeTotalChunks } from "./FluxUploaderPlugin";
import { uploadDB } from "./uploadDB";
import { notifications } from "./notifications";
import { storageApi } from "../api/storageApi";

export { CHUNK_SIZE };

const NOTIFICATIONS_ENABLED = true; // re-enabled — the mobile freeze was isolated to the File System Access picker/accept-attribute combo, not this

const _instanceId = Math.random().toString(36).slice(2, 8);

// On-screen debug log — mirrors console messages into a ring buffer the UI
// can render directly (DashUploads.jsx's Debug panel). Kept from the earlier
// diagnostic round since this is a large rewrite; safe to remove later.
const _debugLog = [];
function _log(msg) {
    _debugLog.push(`${new Date().toTimeString().slice(0, 8)} ${msg}`);
    if (_debugLog.length > 300) _debugLog.shift();
    console.log(msg);
}
function getDebugLog() {
    return [..._debugLog];
}
_log(`module instance loaded: ${_instanceId}`);

// Matches "10241.mkv", "48213829.mp4" — a bare number as the base name, the
// shape of a MediaStore content id (what Android hands the browser for a
// file picked via Gallery/Photo-Picker instead of a real file manager).
function looksLikeGenericMobileName(filename) {
    const base = filename.replace(/\.[^./]+$/, "");
    return /^\d{3,10}$/.test(base);
}

function _newSessionId() {
    return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ── Uppy instance + plugin — the actual engine ──────────────────────────────
const uppy = new Uppy({ id: "flux-uploads", restrictions: {}, autoProceed: false, allowMultipleUploadBatches: true });
uppy.use(FluxUploaderPlugin);
const _plugin = uppy.getPlugin("FluxUploaderPlugin");

// ── File System Access helpers (pure browser API, no Uppy dependency) ──────
const VIDEO_EXTENSIONS = [".mp4", ".mkv", ".avi", ".mov", ".ts", ".m2ts", ".webm", ".m4v", ".flv", ".wmv"];
const hasFSA = typeof window !== "undefined" && "showOpenFilePicker" in window;

async function pickFilesViaFSA() {
    if (!hasFSA) return null;
    try {
        const handles = await window.showOpenFilePicker({
            multiple: true,
            excludeAcceptAllOption: false,
            types: [{ description: "Video files", accept: { "video/*": VIDEO_EXTENSIONS } }],
        });
        const out = [];
        for (const handle of handles) out.push({ file: await handle.getFile(), handle });
        return out;
    } catch (err) {
        if (err.name === "AbortError") return [];
        console.warn("[uploadManager] showOpenFilePicker failed, falling back to <input>:", err.message);
        return null;
    }
}

async function filesFromDataTransfer(dataTransfer) {
    const out = [];
    const items = dataTransfer.items;
    if (items && items.length && typeof items[0]?.getAsFileSystemHandle === "function") {
        for (const item of items) {
            if (item.kind !== "file") continue;
            try {
                const handle = await item.getAsFileSystemHandle();
                if (handle && handle.kind === "file") {
                    out.push({ file: await handle.getFile(), handle });
                    continue;
                }
            } catch {
                // fall through to getAsFile for this one item
            }
            const file = item.getAsFile ? item.getAsFile() : null;
            if (file) out.push({ file, handle: null });
        }
        if (out.length) return out;
    }
    for (const file of dataTransfer.files) out.push({ file, handle: null });
    return out;
}

// ── Persistence — keyed by OUR sessionId, not Uppy's file.id (see header) ──
const PERSIST_META_FIELDS = [
    "sessionId",
    "fileSize",
    "mimeType",
    "lastModified",
    "libraryId",
    "storageSource",
    "providerLabel",
    "isChunked",
    "totalChunks",
    "chunkIndex",
    "status",
    "canRetryStage2",
    "neverStarted",
    "hasHandle",
    "suggestRename",
];

function _persistFile(uppyFileId) {
    const file = uppy.getFile(uppyFileId);
    if (!file) return;
    if (file.meta.status === "done") {
        uploadDB.deleteQueueItem(file.meta.sessionId);
        return;
    }
    const row = { id: file.meta.sessionId, filename: file.name };
    for (const f of PERSIST_META_FIELDS) row[f] = file.meta[f];
    uploadDB.putQueueItem(row).catch((err) => _log(`persist failed for ${file.meta.sessionId}: ${err.message}`));
}

// ── Queue snapshot — mapped to the exact shape DashUploads.jsx/QueueCard
// already expect, unchanged from before this rewrite. ───────────────────────
function _mapFileToItem(file) {
    return {
        id: file.id,
        filename: file.name,
        fileSize: file.meta.fileSize,
        status: file.meta.status,
        error: file.error || null,
        speed: file.meta.speed || 0,
        sentBytes: file.progress?.bytesUploaded || 0,
        chunkIndex: file.meta.chunkIndex || 0,
        totalChunks: file.meta.totalChunks,
        isChunked: true,
        progress: file.progress?.percentage || 0,
        phaseLabel: file.meta.phaseLabel || null,
        stalled: !!file.meta.stalled,
        canRetryStage2: !!file.meta.canRetryStage2,
        neverStarted: !!file.meta.neverStarted,
        hasHandle: !!file.meta.hasHandle,
        suggestRename: !!file.meta.suggestRename,
        libraryId: file.meta.libraryId,
        storageSource: file.meta.storageSource,
        providerLabel: file.meta.providerLabel,
    };
}

function getQueue() {
    return Object.values(uppy.getState().files).map(_mapFileToItem);
}

const _listeners = new Set();
function subscribe(listener) {
    _listeners.add(listener);
    listener(getQueue());
    return () => _listeners.delete(listener);
}

const _completeListeners = new Set();
function onComplete(listener) {
    _completeListeners.add(listener);
    return () => _completeListeners.delete(listener);
}

uppy.store.subscribe(() => {
    const snapshot = getQueue();
    for (const l of _listeners) l(snapshot);
    for (const file of Object.values(uppy.getState().files)) _persistFile(file.id);
});

// ── Tray notifications — throttled progress ping + final done/error ────────
const _notifyRuntime = new Map(); // fileID -> { lastNotifiedPct, lastNotifiedAt }

function _maybeNotifyProgress(fileID) {
    if (!NOTIFICATIONS_ENABLED) return;
    if (notifications.permissionState() !== "granted") return;
    const file = uppy.getFile(fileID);
    if (!file) return;
    const rt = _notifyRuntime.get(fileID) || {};
    const now = Date.now();
    const pct = file.progress?.percentage || 0;
    const lastPct = rt.lastNotifiedPct ?? -100;
    const lastAt = rt.lastNotifiedAt ?? 0;
    if (pct - lastPct < 5 && now - lastAt < 3000) return;
    _notifyRuntime.set(fileID, { lastNotifiedPct: pct, lastNotifiedAt: now });
    notifications.show(file.meta.sessionId, { title: file.name, body: `${pct}% — ${file.meta.phaseLabel || "Uploading"}` });
}

uppy.on("upload-progress", (file) => {
    if (file && (file.meta.status === "uploading" || file.meta.status === "finalizing")) _maybeNotifyProgress(file.id);
});
uppy.on("upload-success", (file) => {
    if (!file) return;
    if (NOTIFICATIONS_ENABLED) {
        notifications.show(file.meta.sessionId, { title: file.name, body: "Upload complete ✓", silent: false });
        setTimeout(() => notifications.close(file.meta.sessionId), 6000);
    }
    for (const l of _completeListeners) l(file.id);
});
uppy.on("upload-error", (file) => {
    if (!file) return;
    if (NOTIFICATIONS_ENABLED && file.meta.canRetryStage2) {
        notifications.show(file.meta.sessionId, { title: file.name, body: "Upload failed — tap Retry in FLUX", silent: false });
    }
});

// ── Queue mutation — public API ─────────────────────────────────────────────

async function addFiles(entries) {
    const newIds = [];
    for (const { file, handle } of entries) {
        const sessionId = _newSessionId();
        const hasHandle = !!handle;
        const uppyId = uppy.addFile({
            name: file.name,
            type: file.type || "application/octet-stream",
            data: file,
            size: file.size,
            meta: {
                sessionId,
                fileSize: file.size,
                mimeType: file.type || "application/octet-stream",
                lastModified: file.lastModified,
                libraryId: null,
                storageSource: null,
                providerLabel: null,
                isChunked: true,
                totalChunks: computeTotalChunks(file.size),
                chunkIndex: 0,
                status: "queued",
                canRetryStage2: false,
                neverStarted: true,
                hasHandle,
                suggestRename: looksLikeGenericMobileName(file.name),
                phaseLabel: null,
                stalled: false,
                speed: 0,
            },
        });
        if (hasHandle) await uploadDB.putHandle(sessionId, handle);
        _persistFile(uppyId);
        newIds.push(uppyId);
    }
    return newIds;
}

let _startRunnerActive = false;
async function startUpload(target) {
    if (_startRunnerActive) return;
    _startRunnerActive = true;
    try {
        const eligible = Object.values(uppy.getState().files).filter(
            (f) => (f.meta.status === "queued" || f.meta.status === "error") && !f.meta.canRetryStage2 && f.data && f.data.size > 0,
        );
        for (const f of eligible) {
            uppy.setFileState(f.id, {
                meta: { ...f.meta, libraryId: target.libraryId, storageSource: target.storageSource, providerLabel: target.providerLabel, status: "uploading", neverStarted: false, chunkIndex: 0 },
            });
        }
        if (eligible.length) await uppy.upload();
    } finally {
        _startRunnerActive = false;
    }
}

function pauseOrResumeItem(id) {
    uppy.pauseResume(id);
}

async function cancelItem(id) {
    const file = uppy.getFile(id);
    if (!file) return;
    _plugin.abortFile(id);
    if (NOTIFICATIONS_ENABLED) notifications.close(file.meta.sessionId);
    storageApi.cancelUpload(file.meta.sessionId).catch((err) => console.error(`[uploadManager] server-side cancel failed for ${file.meta.sessionId}:`, err));
    uppy.setFileState(id, { error: "Cancelled", meta: { ...uppy.getFile(id).meta, status: "error" } });
}

async function removeItem(id) {
    const file = uppy.getFile(id);
    if (file) {
        _plugin.abortFile(id);
        await uploadDB.deleteQueueItem(file.meta.sessionId);
    }
    uppy.removeFile(id);
}

function clearDone() {
    for (const file of Object.values(uppy.getState().files)) {
        if (file.meta.status === "done") uppy.removeFile(file.id);
    }
}

// Stage-2-only retry — every chunk already made it to the server, only the
// server->provider leg needs another attempt.
async function retryItem(id) {
    const file = uppy.getFile(id);
    if (!file) return;
    uppy.setFileState(id, { error: null, meta: { ...file.meta, status: "finalizing", canRetryStage2: false } });
    try {
        await storageApi.retryStage2(file.meta.sessionId);
        _plugin.startPollingProvider(id);
    } catch (err) {
        uppy.setFileState(id, { error: err.message || "Retry failed", meta: { ...uppy.getFile(id).meta, status: "error", canRetryStage2: true } });
    }
}

function renameItem(id, newName) {
    const file = uppy.getFile(id);
    if (!file) return;
    uppy.setFileState(id, { name: newName, meta: { ...file.meta, suggestRename: false } });
}

// Verifies a reselected/reopened file plausibly IS the same file the upload
// was queued against — name+size alone can't catch "same name, same size,
// different file" (rare but real, e.g. a re-encoded file landing at the same
// byte count). lastModified is compared too whenever both sides have it,
// which real File objects (from any picker, any platform) always do. Name
// itself is checked separately by each call site against Uppy's `file.name`.
function _looksLikeSameFile(candidate, meta) {
    if (candidate.size !== meta.fileSize) return false;
    if (candidate.lastModified != null && meta.lastModified != null && candidate.lastModified !== meta.lastModified) return false;
    return true;
}

// Manual reselect fallback (no usable handle) — verifies name+size+lastModified match.
async function attachFileAndResume(id, selectedFile) {
    const file = uppy.getFile(id);
    if (!file) return { ok: false, error: "Unknown upload." };
    if (selectedFile.name !== file.name || !_looksLikeSameFile(selectedFile, file.meta)) {
        return { ok: false, error: `That doesn't look like the same file. Expected "${file.name}".` };
    }
    uppy.setFileState(id, { data: selectedFile, size: selectedFile.size });
    const cur = uppy.getFile(id);
    if (cur.meta.neverStarted) {
        uppy.setFileState(id, { error: null, meta: { ...cur.meta, status: "queued" } });
        return { ok: true };
    }
    uppy.setFileState(id, { error: null, meta: { ...cur.meta, status: "uploading" } });
    await _plugin.reconcileAndRun(id);
    return { ok: true };
}

// One-tap continuation for a File System Access handle whose permission
// needs a fresh grant — MUST be called from a real click handler, browser law.
async function requestPermissionAndResume(id) {
    const file = uppy.getFile(id);
    if (!file) return;
    const handle = await uploadDB.getHandle(file.meta.sessionId);
    if (!handle) {
        uppy.setFileState(id, { meta: { ...file.meta, status: "needsFile", hasHandle: false } });
        return;
    }
    try {
        const perm = await handle.requestPermission({ mode: "read" });
        if (perm !== "granted") {
            uppy.setFileState(id, { meta: { ...uppy.getFile(id).meta, status: "needsFile" } });
            return;
        }
        const realFile = await handle.getFile();
        if (realFile.name !== file.name || !_looksLikeSameFile(realFile, file.meta)) {
            uppy.setFileState(id, { error: "The file on disk has changed since this upload was queued.", meta: { ...uppy.getFile(id).meta, status: "needsFile" } });
            return;
        }
        uppy.setFileState(id, { data: realFile, size: realFile.size });
        const cur = uppy.getFile(id);
        if (cur.meta.neverStarted) {
            uppy.setFileState(id, { meta: { ...cur.meta, status: "queued" } });
            return;
        }
        uppy.setFileState(id, { meta: { ...cur.meta, status: "uploading" } });
        await _plugin.reconcileAndRun(id);
    } catch (err) {
        uppy.setFileState(id, { error: err.message, meta: { ...uppy.getFile(id).meta, status: "needsFile" } });
    }
}

// ── Startup — inspect every unfinished upload, continue automatically where
// possible (see FluxUploaderPlugin.js's own header for the honest limits
// on what "automatically" can mean without HTTPS / on mobile). ─────────────
async function _tryAutoResume(uppyId) {
    const file = uppy.getFile(uppyId);
    if (!file) return;
    if (file.meta.status === "error") {
        _log(`_tryAutoResume(${file.meta.sessionId}): status is "error" — leaving for manual Retry/remove`);
        return;
    }
    if (file.meta.status === "finalizing") {
        // Every chunk already reached the server before the reload — stage 2
        // (server -> provider) needs zero client bytes, so there's nothing
        // to reselect. Just resume polling, on any browser/platform.
        _log(`_tryAutoResume(${file.meta.sessionId}): already finalizing, no file needed — resuming poll directly`);
        _plugin.startPollingProvider(uppyId);
        return;
    }
    if (!file.meta.hasHandle) {
        uppy.setFileState(uppyId, { meta: { ...file.meta, status: "needsFile" } });
        return;
    }
    const handle = await uploadDB.getHandle(file.meta.sessionId);
    if (!handle) {
        uppy.setFileState(uppyId, { meta: { ...file.meta, status: "needsFile", hasHandle: false } });
        return;
    }
    try {
        const perm = await handle.queryPermission({ mode: "read" }); // no gesture required, safe on load
        _log(`_tryAutoResume(${file.meta.sessionId}): handle permission = "${perm}"`);
        if (perm === "granted") {
            const realFile = await handle.getFile();
            if (realFile.name !== file.name || !_looksLikeSameFile(realFile, file.meta)) {
                uppy.setFileState(uppyId, { error: "The file on disk has changed since this upload was queued.", meta: { ...file.meta, status: "needsFile" } });
                return;
            }
            uppy.setFileState(uppyId, { data: realFile, size: realFile.size });
            const cur = uppy.getFile(uppyId);
            if (cur.meta.neverStarted) {
                uppy.setFileState(uppyId, { meta: { ...cur.meta, status: "queued" } });
                return;
            }
            uppy.setFileState(uppyId, { meta: { ...cur.meta, status: "uploading" } });
            await _plugin.reconcileAndRun(uppyId);
        } else if (perm === "prompt") {
            uppy.setFileState(uppyId, { meta: { ...file.meta, status: "needsPermission" } });
        } else {
            uppy.setFileState(uppyId, { meta: { ...file.meta, status: "needsFile" } });
        }
    } catch {
        uppy.setFileState(uppyId, { meta: { ...file.meta, status: "needsFile" } });
    }
}

let _initialized = false;
async function init() {
    if (_initialized) {
        _log("init() called again — already initialized, skipping");
        return;
    }
    _initialized = true;
    _log("init() starting — reading persisted queue from IndexedDB…");

    const rows = await uploadDB.getAllQueueItems();
    _log(`init(): ${rows.length} row(s) to restore`);

    const addedIds = [];
    for (const row of rows) {
        // 0-byte placeholder — real bytes are gone after a reload. Uppy's own
        // `size`/`data` reflect this placeholder; `meta.fileSize` (below)
        // carries the REAL size for all display/progress math, decoupled
        // from whatever's currently attached (see file header comment).
        const uppyId = uppy.addFile({
            name: row.filename,
            type: row.mimeType || "application/octet-stream",
            data: new Blob([], { type: row.mimeType }),
            size: 0,
            meta: { ...row, speed: 0, phaseLabel: null, stalled: false },
        });
        addedIds.push(uppyId);
    }
    for (const l of _listeners) l(getQueue()); // queue reappears immediately, even before auto-resume finishes checking permissions/sessions

    for (const uppyId of addedIds) {
        await _tryAutoResume(uppyId);
    }
    _log("init(): auto-resume pass complete");
}

// ── Network resilience — pause on offline, auto-resume on reconnect ────────
const _offlinePaused = new Set();
function _handleOffline() {
    for (const file of Object.values(uppy.getState().files)) {
        if (file.meta.status === "uploading" || file.meta.status === "finalizing") {
            _offlinePaused.add(file.id);
            _plugin.abortFile(file.id);
            uppy.setFileState(file.id, { isPaused: true, meta: { ...file.meta, status: "paused", stalled: true, phaseLabel: "Offline — will resume automatically" } });
        }
    }
}
function _handleOnline() {
    for (const fileId of _offlinePaused) {
        _offlinePaused.delete(fileId);
        const file = uppy.getFile(fileId);
        if (!file) continue;
        uppy.setFileState(fileId, { isPaused: false, meta: { ...file.meta, status: "uploading" } });
        _plugin.reconcileAndRun(fileId);
    }
}
if (typeof window !== "undefined") {
    window.addEventListener("offline", _handleOffline);
    window.addEventListener("online", _handleOnline);
    init(); // fires the moment this module is first imported, from ANY route
}

export const uploadManager = {
    _instanceId,
    _uppy: uppy, // raw Uppy instance — needed by DashUploads.jsx to wrap in <UppyContextProvider> for Uppy's real useFileInput hook. Everything else in this file should keep going through the wrapped methods below, not this directly.
    getDebugLog,
    hasFSA,
    notifications,
    init,
    subscribe,
    onComplete,
    getQueue,
    addFiles,
    pickFilesViaFSA,
    filesFromDataTransfer,
    startUpload,
    pauseOrResumeItem,
    cancelItem,
    removeItem,
    retryItem,
    renameItem,
    attachFileAndResume,
    requestPermissionAndResume,
    clearDone,
};
