// web/src/dashboard/upload/uploadDB.js
//
// IndexedDB persistence for the upload queue. Replaces the old
// localStorage-only approach: localStorage is fine for a few small
// key/value pairs, but this needs to hold a growing queue of upload
// records (name, size, chunk progress, etc) continuously through a
// multi-GB upload — IndexedDB is the right tool, localStorage would
// mean a full JSON.stringify of the entire queue on every single
// progress tick, which gets slow and eventually hits the ~5MB quota.
//
// TWO stores, deliberately kept separate:
//   - "queue"   : plain-object metadata only (id, filename, size, status,
//                 chunkIndex, progress, ...) — safe to store on every browser,
//                 no special API needed.
//   - "handles" : FileSystemFileHandle objects, ONLY written when the browser
//                 supports the File System Access API (Chrome/Edge desktop).
//                 A FileSystemFileHandle is structured-clonable, so IndexedDB
//                 can hold it directly — this is what lets a resume reopen the
//                 original file without the user browsing for it again.
//                 Firefox, Safari, and every mobile browser never get a row
//                 here at all; those items just fall back to "needsFile".
//
// Every function degrades to a safe no-op (resolves to null/[]) if IndexedDB
// itself is unavailable (very old browser, or a locked-down private-mode
// Safari) — the upload still works, it just won't survive a refresh.

const DB_NAME = "flux_uploads";
const DB_VERSION = 1;
const STORE_QUEUE = "queue";
const STORE_HANDLES = "handles";

const isSupported = typeof indexedDB !== "undefined";

// Same on-screen debug ring buffer pattern as uploadManager.js — mirrored
// separately here (not imported from uploadManager, to keep this module
// dependency-free) so DashUploads.jsx can show IndexedDB-level messages too.
const _debugLog = [];
function _log(msg) {
    _debugLog.push(`${new Date().toTimeString().slice(0, 8)} ${msg}`);
    if (_debugLog.length > 300) _debugLog.shift();
    console.log(msg);
}
function getDebugLog() {
    return [..._debugLog];
}

let _dbPromise = null;

function _openDB() {
    if (!isSupported) return Promise.resolve(null);
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve) => {
        let req;
        try {
            req = indexedDB.open(DB_NAME, DB_VERSION);
        } catch {
            resolve(null);
            return;
        }
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_QUEUE)) db.createObjectStore(STORE_QUEUE, { keyPath: "id" });
            if (!db.objectStoreNames.contains(STORE_HANDLES)) db.createObjectStore(STORE_HANDLES, { keyPath: "id" });
        };
        req.onsuccess = () => {
            _log("IndexedDB opened OK");
            resolve(req.result);
        };
        req.onerror = () => {
            _log(`Failed to open IndexedDB (queue will not survive a refresh this session): ${req.error}`);
            resolve(null);
        };
    });
    return _dbPromise;
}

async function _store(name, mode) {
    const db = await _openDB();
    if (!db) return null;
    try {
        return db.transaction(name, mode).objectStore(name);
    } catch {
        return null;
    }
}

function _req(request, fallback) {
    return new Promise((resolve) => {
        if (!request) {
            resolve(fallback);
            return;
        }
        request.onsuccess = () => resolve(request.result ?? fallback);
        request.onerror = () => resolve(fallback);
    });
}

async function getAllQueueItems() {
    const store = await _store(STORE_QUEUE, "readonly");
    if (!store) {
        _log("getAllQueueItems: no object store (IndexedDB unavailable or failed to open) — queue will restore empty");
        return [];
    }
    const rows = await _req(store.getAll(), []);
    _log(`getAllQueueItems: restored ${rows.length} row(s)`);
    return rows;
}

async function putQueueItem(item) {
    const store = await _store(STORE_QUEUE, "readwrite");
    if (!store) {
        _log(`putQueueItem(${item.id}): no object store available — this item will NOT survive a reload`);
        return;
    }
    try {
        await _req(store.put(item), undefined);
    } catch (err) {
        _log(`putQueueItem(${item.id}) failed: ${err.message}`);
    }
}

async function deleteQueueItem(id) {
    const store = await _store(STORE_QUEUE, "readwrite");
    if (!store) return;
    await _req(store.delete(id), undefined);
    await deleteHandle(id);
}

async function putHandle(id, handle) {
    if (!handle) return;
    const store = await _store(STORE_HANDLES, "readwrite");
    if (!store) return;
    try {
        await _req(store.put({ id, handle }), undefined);
    } catch (err) {
        // Some handle types/browsers can reject structured-clone storage —
        // non-fatal, this id just won't get silent-resume, falls back to needsFile.
        _log(`Could not persist file handle for ${id}: ${err.message}`);
    }
}

async function getHandle(id) {
    const store = await _store(STORE_HANDLES, "readonly");
    if (!store) return null;
    const row = await _req(store.get(id), null);
    return row ? row.handle : null;
}

async function deleteHandle(id) {
    const store = await _store(STORE_HANDLES, "readwrite");
    if (!store) return;
    await _req(store.delete(id), undefined);
}

export const uploadDB = { isSupported, getDebugLog, getAllQueueItems, putQueueItem, deleteQueueItem, putHandle, getHandle, deleteHandle };
