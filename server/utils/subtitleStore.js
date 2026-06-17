"use strict";

/**
 * subtitleStore.js — FLUX Subtitle Persistence Layer (v2)
 *
 * Storage layout:
 *   data/subtitles/<hash16>/english/subtitle.srt
 *   data/subtitles/<hash16>/bangla/subtitle.srt
 *
 * <hash16> = first 16 hex chars of SHA-256(mediaId) — Windows-safe, short, stable.
 *
 * Metadata: data/subtitle-meta.json
 *   { [mediaId]: { downloaded: [{ lang, filename, path, addedAt }] } }
 *
 * Queue: data/subtitle-queue.json
 *   [{ id, mediaId, title, year, imdbId, tmdbId, season, episode, type,
 *      status, addedAt, attempts, lastError, completedAt? }]
 *   status: "pending"|"downloading"|"done"|"failed"|"skipped"
 *
 * Perf:
 *   - In-memory write cache for meta + queue — debounced 2s disk write
 *   - In-memory subtitle availability Set<"mediaId:lang"> to avoid disk checks
 *   - Bulk enqueue via enqueueBatch() — single disk write for N items
 */

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "data");
const SUB_DIR = path.join(DATA_DIR, "subtitles");
const META_FILE = path.join(DATA_DIR, "subtitle-meta.json");
const QUEUE_FILE = path.join(DATA_DIR, "subtitle-queue.json");

const LANG_FOLDER = { en: "english", bn: "bangla" };

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Windows-safe directory name from mediaId
function safeDirName(mediaId) {
    return crypto.createHash("sha256").update(mediaId).digest("hex").slice(0, 16);
}

function langFolder(lang) {
    return LANG_FOLDER[lang] || lang;
}

// ─── Atomic write + debounce ──────────────────────────────────────────────────

async function atomicWrite(file, data) {
    const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
    await fsp.rename(tmp, file);
}

// Debounced writer — coalesces rapid mutations into one disk write
function makeDebounced(writeFn, delayMs = 2000) {
    let timer = null;
    let pending = false;
    return {
        schedule() {
            pending = true;
            if (timer) return;
            timer = setTimeout(async () => {
                timer = null;
                if (!pending) return;
                pending = false;
                await writeFn().catch((e) => console.error("[SubtitleStore] Debounced write error:", e.message));
            }, delayMs);
        },
        async flush() {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            if (pending) {
                pending = false;
                await writeFn();
            }
        },
    };
}

// ─── Meta store ──────────────────────────────────────────────────────────────

let _meta = null; // { [mediaId]: { downloaded: [...] } }

// In-memory availability cache: Set<"mediaId:lang">
// Populated on init and updated on recordDownloaded / removeMediaSubtitles
const _available = new Set();

const _metaWriter = makeDebounced(async () => atomicWrite(META_FILE, _meta));

async function _loadMeta() {
    try {
        const raw = await fsp.readFile(META_FILE, "utf-8");
        _meta = JSON.parse(raw);
    } catch {
        _meta = {};
    }
    // Rebuild availability cache
    _available.clear();
    for (const [mediaId, entry] of Object.entries(_meta)) {
        for (const dl of entry.downloaded || []) {
            _available.add(`${mediaId}:${dl.lang}`);
        }
    }
}

async function getMediaMeta(mediaId) {
    if (!_meta) await _loadMeta();
    return _meta[mediaId] || { downloaded: [] };
}

async function recordDownloaded(mediaId, { lang, filename, destPath }) {
    if (!_meta) await _loadMeta();
    if (!_meta[mediaId]) _meta[mediaId] = { downloaded: [] };
    // Replace existing entry for same lang
    _meta[mediaId].downloaded = _meta[mediaId].downloaded.filter((d) => d.lang !== lang);
    _meta[mediaId].downloaded.push({ lang, filename, path: destPath, addedAt: new Date().toISOString() });
    _available.add(`${mediaId}:${lang}`);
    _metaWriter.schedule();
}

async function removeMediaSubtitles(mediaId) {
    if (!_meta) await _loadMeta();
    const entry = _meta[mediaId];
    delete _meta[mediaId];
    // Clear availability cache for this media
    for (const lang of ["en", "bn"]) _available.delete(`${mediaId}:${lang}`);
    _metaWriter.schedule();

    // Remove subtitle directory
    try {
        await fsp.rm(path.join(SUB_DIR, safeDirName(mediaId)), { recursive: true, force: true });
    } catch {
        /* non-fatal */
    }

    // Remove from queue
    await _removeQueueEntries(mediaId);
}

async function removeLibrarySubtitles(mediaIds) {
    await Promise.all(mediaIds.map(removeMediaSubtitles));
}

// Fast in-memory check — no disk access
function hasDownloadedSubtitle(mediaId, lang) {
    if (!_meta) return false; // not loaded yet — treat as no
    return _available.has(`${mediaId}:${lang}`);
}

// ─── Queue store ─────────────────────────────────────────────────────────────

let _queue = null; // array of queue entries
// O(1) lookup: Map<mediaId, entry>
const _queueIndex = new Map();

const _queueWriter = makeDebounced(async () => atomicWrite(QUEUE_FILE, _queue));

async function _loadQueue() {
    try {
        const raw = await fsp.readFile(QUEUE_FILE, "utf-8");
        _queue = JSON.parse(raw);
    } catch {
        _queue = [];
    }
    // Reset interrupted "downloading" → "pending"
    let changed = false;
    for (const e of _queue) {
        if (e.status === "downloading") {
            e.status = "pending";
            changed = true;
        }
    }
    // Rebuild index
    _queueIndex.clear();
    for (const e of _queue) _queueIndex.set(e.mediaId, e);
    if (changed) await atomicWrite(QUEUE_FILE, _queue);
}

async function enqueue(mediaId, meta = {}) {
    if (!_queue) await _loadQueue();
    const existing = _queueIndex.get(mediaId);
    if (existing) {
        if (existing.status === "done" || existing.status === "skipped") return existing;
        if (existing.status === "failed") {
            existing.status = "pending";
            existing.attempts = 0;
            existing.lastError = null;
            _queueWriter.schedule();
        }
        return existing;
    }
    const entry = {
        id: `${safeDirName(mediaId)}-${Date.now()}`,
        mediaId,
        title: meta.title || "",
        year: meta.year || null,
        imdbId: meta.imdbId || null,
        tmdbId: meta.tmdbId ? String(meta.tmdbId) : null,
        season: meta.season ?? null,
        episode: meta.episode ?? null,
        type: meta.type || "movie",
        status: "pending",
        addedAt: new Date().toISOString(),
        attempts: 0,
        lastError: null,
    };
    _queue.push(entry);
    _queueIndex.set(mediaId, entry);
    _queueWriter.schedule();
    return entry;
}

/**
 * Bulk enqueue — single disk write for many items.
 * items: [{ mediaId, title, year, imdbId, tmdbId, season, episode, type }]
 * Returns count of newly added items.
 */
async function enqueueBatch(items) {
    if (!_queue) await _loadQueue();
    let added = 0;
    for (const item of items) {
        const existing = _queueIndex.get(item.mediaId);
        if (existing && (existing.status === "done" || existing.status === "skipped" || existing.status === "pending" || existing.status === "downloading")) continue;
        if (existing && existing.status === "failed") {
            existing.status = "pending";
            existing.attempts = 0;
            existing.lastError = null;
            continue;
        }
        if (existing) continue;
        const entry = {
            id: `${safeDirName(item.mediaId)}-${Date.now()}-${added}`,
            mediaId: item.mediaId,
            title: item.title || "",
            year: item.year || null,
            imdbId: item.imdbId || null,
            tmdbId: item.tmdbId ? String(item.tmdbId) : null,
            season: item.season ?? null,
            episode: item.episode ?? null,
            type: item.type || "movie",
            status: "pending",
            addedAt: new Date().toISOString(),
            attempts: 0,
            lastError: null,
        };
        _queue.push(entry);
        _queueIndex.set(item.mediaId, entry);
        added++;
    }
    if (added > 0) await atomicWrite(QUEUE_FILE, _queue); // immediate for batch
    return added;
}

function dequeue() {
    if (!_queue) return null;
    return _queue.find((e) => e.status === "pending") || null;
}

function markDownloading(entry) {
    entry.status = "downloading";
    entry.attempts++;
    _queueWriter.schedule();
}

function markDone(entry) {
    entry.status = "done";
    entry.completedAt = new Date().toISOString();
    _queueWriter.schedule();
}

function markFailed(entry, error) {
    entry.status = entry.attempts >= 3 ? "failed" : "pending";
    entry.lastError = error;
    _queueWriter.schedule();
}

function markFailedPermanent(entry, error) {
    entry.status = "failed";
    entry.lastError = error;
    _queueWriter.schedule();
}

function markSkipped(entry, reason) {
    entry.status = "skipped";
    entry.lastError = reason;
    _queueWriter.schedule();
}

async function _removeQueueEntries(mediaId) {
    if (!_queue) await _loadQueue();
    const before = _queue.length;
    _queue = _queue.filter((e) => e.mediaId !== mediaId);
    _queueIndex.delete(mediaId);
    if (_queue.length !== before) _queueWriter.schedule();
}

async function getQueueStats() {
    if (!_queue) await _loadQueue();
    const counts = { pending: 0, downloading: 0, done: 0, failed: 0, skipped: 0, total: _queue.length };
    for (const e of _queue) counts[e.status] = (counts[e.status] || 0) + 1;
    return { counts, queue: _queue };
}

// ─── Path helpers ─────────────────────────────────────────────────────────────

/**
 * Returns the language subfolder path: data/subtitles/<hash16>/<langfolder>/
 */
function getSubtitleLangDir(mediaId, lang) {
    return path.join(SUB_DIR, safeDirName(mediaId), langFolder(lang));
}

/**
 * Returns the base subtitle dir: data/subtitles/<hash16>/
 * (kept for uploadSubtitle backward-compat path)
 */
function getSubtitleDir(mediaId) {
    return path.join(SUB_DIR, safeDirName(mediaId));
}

function getSubtitleStreamUrl(destPath) {
    const encoded = Buffer.from(destPath).toString("base64url");
    return `/stream/subtitle/${encoded}`;
}

// ─── Startup reconciliation ───────────────────────────────────────────────────

async function reconcile(allMediaIds) {
    if (!_meta) await _loadMeta();
    if (!_queue) await _loadQueue();

    // Remove meta for missing media
    let metaChanged = false;
    for (const mediaId of Object.keys(_meta)) {
        if (!allMediaIds.has(mediaId)) {
            delete _meta[mediaId];
            for (const lang of ["en", "bn"]) _available.delete(`${mediaId}:${lang}`);
            metaChanged = true;
        }
    }
    if (metaChanged) await atomicWrite(META_FILE, _meta);

    // Build set of safe dir names for current media
    const safeDirs = new Set([...allMediaIds].map(safeDirName));

    // Remove orphan subtitle dirs
    try {
        await fsp.mkdir(SUB_DIR, { recursive: true });
        const dirs = await fsp.readdir(SUB_DIR);
        await Promise.all(
            dirs.map(async (dir) => {
                if (!safeDirs.has(dir)) {
                    await fsp.rm(path.join(SUB_DIR, dir), { recursive: true, force: true });
                }
            }),
        );
    } catch {
        /* dir may not exist yet */
    }

    // Remove queue entries for missing media
    const before = _queue.length;
    _queue = _queue.filter((e) => {
        if (!allMediaIds.has(e.mediaId)) {
            _queueIndex.delete(e.mediaId);
            return false;
        }
        return true;
    });
    if (_queue.length !== before) await atomicWrite(QUEUE_FILE, _queue);

    console.log(`[SubtitleStore] Reconcile: meta=${Object.keys(_meta).length} queue=${_queue.length} available=${_available.size}`);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
    await fsp.mkdir(SUB_DIR, { recursive: true });
    await _loadMeta();
    await _loadQueue();
    const pending = _queue.filter((e) => e.status === "pending").length;
    console.log(`[SubtitleStore] Init: meta=${Object.keys(_meta).length} queue=${_queue.length} pending=${pending} available=${_available.size}`);
}

module.exports = {
    init,
    reconcile,
    // meta
    getMediaMeta,
    recordDownloaded,
    removeMediaSubtitles,
    removeLibrarySubtitles,
    hasDownloadedSubtitle, // sync, in-memory
    // queue
    enqueue,
    enqueueBatch,
    dequeue, // sync
    markDownloading, // sync
    markDone, // sync
    markFailed, // sync
    markFailedPermanent, // sync
    markSkipped, // sync
    getQueueStats,
    // paths
    getSubtitleDir,
    getSubtitleLangDir,
    getSubtitleStreamUrl,
};
