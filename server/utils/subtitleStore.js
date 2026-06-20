"use strict";

/**
 * subtitleStore.js — FLUX Subtitle Persistence Layer (v3)
 *
 * Storage layout:
 *
 *   MOVIE:
 *     data/subtitles/Interstellar_a1b2c3d4/english/subtitle.srt
 *     data/subtitles/Interstellar_a1b2c3d4/bangla/subtitle.srt
 *
 *   MOVIE (multi-part):
 *     data/subtitles/Harry_Potter_Part_1_a1b2c3d4/english/subtitle.srt
 *     data/subtitles/Harry_Potter_Part_2_b2c3d4e5/english/subtitle.srt
 *
 *   SERIES:
 *     data/subtitles/Breaking_Bad_500/S01E01/english/subtitle.srt
 *     data/subtitles/Breaking_Bad_500/S01E02/bangla/subtitle.srt
 *     data/subtitles/Breaking_Bad_500/S02E01/english/subtitle.srt
 *
 * Folder name rules:
 *   - Title sanitized: spaces→_, strip invalid chars, truncate to 40 chars
 *   - Movie suffix: _<shortId>  (8-char hex of SHA-256(mediaId))
 *   - Series root: <SeriesTitle>_<tmdbId>  (tmdbId groups all episodes)
 *   - Episode subdir: S<SS>E<EEE>
 *   - Language dir: english | bangla
 *
 * Filesystem is source of truth — on startup we scan disk and rebuild
 * in-memory availability cache. Never download if file already exists.
 *
 * Metadata: data/subtitle-meta.json
 *   { [mediaId]: { dirName, downloaded: [{lang, filename, path, addedAt}] } }
 *
 * Queue: data/subtitle-queue.json
 *   status: "pending"|"downloading"|"done"|"failed"|"skipped"
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
const SUPPORTED_LANGS = ["en", "bn"];

// ─── Naming helpers ───────────────────────────────────────────────────────────

/**
 * Sanitize a string for use as a folder name component.
 * Spaces → underscore. Strip chars invalid on Windows/Linux. Truncate.
 */
function sanitizeName(str, maxLen = 40) {
    return (
        (str || "Unknown")
            .replace(/[<>:"/\\|?*\x00-\x1f]/g, "") // strip invalid chars
            .replace(/\s+/g, "_") // spaces → _
            .replace(/[._]+$/g, "") // strip trailing dots/underscores
            .replace(/^[._]+/, "") // strip leading dots/underscores
            .slice(0, maxLen) || "Unknown"
    );
}

/** 8-char hex suffix from mediaId — unique but short */
function shortId(mediaId) {
    return crypto.createHash("sha256").update(mediaId).digest("hex").slice(0, 8);
}

/** Episode subdir: S01E001 */
function episodeDir(season, episode) {
    const s = String(season ?? 1).padStart(2, "0");
    const e = String(episode ?? 0).padStart(3, "0");
    return `S${s}E${e}`;
}

/**
 * Resolve the base subtitle directory for a media item.
 *
 * meta shape (from queue entry):
 *   { title, type, tmdbId, season, episode, part }
 *
 * Returns { baseDir, langDir(lang) }
 */
function resolveSubtitlePaths(mediaId, meta = {}) {
    const { title, type, tmdbId, season, episode, part } = meta;
    const safeTitle = sanitizeName(title || "Unknown");
    const sid = shortId(mediaId);

    let baseDir;

    if (type === "tv" || (season != null && episode != null)) {
        // Series: group all episodes under one series root using tmdbId
        // Fallback: use sid if no tmdbId (shouldn't happen with TMDB metadata)
        const seriesRoot = tmdbId ? `${safeTitle}_${tmdbId}` : `${safeTitle}_${sid}`;
        const epSubdir = episodeDir(season, episode);
        baseDir = path.join(SUB_DIR, seriesRoot, epSubdir);
    } else if (part != null) {
        // Multi-part movie
        baseDir = path.join(SUB_DIR, `${safeTitle}_Part_${part}_${sid}`);
    } else {
        // Regular movie
        baseDir = path.join(SUB_DIR, `${safeTitle}_${sid}`);
    }

    return {
        baseDir,
        langDir: (lang) => path.join(baseDir, LANG_FOLDER[lang] || lang),
        subtitlePath: (lang, ext = ".srt") => path.join(baseDir, LANG_FOLDER[lang] || lang, `subtitle${ext}`),
    };
}

// ─── Atomic write + debounce ──────────────────────────────────────────────────

async function atomicWrite(file, data) {
    const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
    await fsp.rename(tmp, file);
}

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

// ─── In-memory state ──────────────────────────────────────────────────────────

let _meta = null; // { [mediaId]: { dirName, downloaded: [...] } }
let _queue = null; // queue entry array
const _available = new Set(); // "mediaId:lang" — filesystem source of truth
const _queueIndex = new Map(); // mediaId → entry

const _metaWriter = makeDebounced(async () => atomicWrite(META_FILE, _meta));
const _queueWriter = makeDebounced(async () => atomicWrite(QUEUE_FILE, _queue));

// ─── Meta store ──────────────────────────────────────────────────────────────

async function _loadMeta() {
    try {
        const raw = await fsp.readFile(META_FILE, "utf-8");
        _meta = JSON.parse(raw);
    } catch {
        _meta = {};
    }
}

async function getMediaMeta(mediaId) {
    if (!_meta) await _loadMeta();
    return _meta[mediaId] || { downloaded: [] };
}

async function recordDownloaded(mediaId, { lang, filename, destPath }) {
    if (!_meta) await _loadMeta();
    if (!_meta[mediaId]) _meta[mediaId] = { downloaded: [] };
    _meta[mediaId].downloaded = _meta[mediaId].downloaded.filter((d) => d.lang !== lang);
    _meta[mediaId].downloaded.push({
        lang,
        filename,
        path: destPath,
        addedAt: new Date().toISOString(),
    });
    _available.add(`${mediaId}:${lang}`);
    _metaWriter.schedule();
}

async function removeMediaSubtitles(mediaId) {
    if (!_meta) await _loadMeta();
    const entry = _meta[mediaId];
    delete _meta[mediaId];
    for (const lang of SUPPORTED_LANGS) _available.delete(`${mediaId}:${lang}`);
    _metaWriter.schedule();

    // Remove subtitle dirs — check stored paths first, then fall back to dirName
    if (entry?.downloaded?.length) {
        const dirs = new Set(entry.downloaded.map((d) => path.dirname(path.dirname(d.path))));
        for (const dir of dirs) {
            try {
                await fsp.rm(dir, { recursive: true, force: true });
            } catch {
                /* ok */
            }
        }
    }

    await _removeQueueEntry(mediaId);
}

async function removeLibrarySubtitles(mediaIds) {
    await Promise.all(mediaIds.map(removeMediaSubtitles));
}

function hasDownloadedSubtitle(mediaId, lang) {
    return _available.has(`${mediaId}:${lang}`);
}

// ─── Filesystem scan — rebuild _available from disk ──────────────────────────

/**
 * On startup: walk data/subtitles/ and mark every subtitle that exists on disk.
 * Filesystem is the source of truth — if file exists, language is available.
 * Also syncs subtitle-meta.json to match reality (adds missing, removes stale entries).
 *
 * We rely on subtitle-meta.json mapping mediaId → { downloaded: [{lang, path}] }
 * to know WHICH mediaId owns a discovered file.
 */
async function scanExistingSubtitles() {
    if (!_meta) await _loadMeta();
    _available.clear();

    let found = 0;
    let fixed = 0;

    for (const [mediaId, entry] of Object.entries(_meta)) {
        const surviving = [];
        for (const dl of entry.downloaded || []) {
            try {
                await fsp.access(dl.path);
                // File exists — mark available
                _available.add(`${mediaId}:${dl.lang}`);
                surviving.push(dl);
                found++;
            } catch {
                // File missing — drop from metadata (will re-download if still needed)
                fixed++;
            }
        }
        if (surviving.length !== (entry.downloaded || []).length) {
            _meta[mediaId].downloaded = surviving;
        }
    }

    if (fixed > 0) {
        console.log(`[SubtitleStore] Scan: removed ${fixed} stale metadata entries`);
        await atomicWrite(META_FILE, _meta);
    }

    console.log(`[SubtitleStore] Scan complete: ${found} subtitle files confirmed on disk`);
}

// ─── Migration: hash dirs → readable dirs ────────────────────────────────────

/**
 * One-time migration: if subtitle-meta.json has entries with paths inside
 * hash-named directories (16-char hex), rename them to the new readable format.
 * Run before scanExistingSubtitles so paths are correct.
 */
const OLD_HASH_RE = /^[0-9a-f]{16}$/;

async function migrateHashDirs() {
    if (!_meta) await _loadMeta();
    let migrated = 0;

    let dirs;
    try {
        await fsp.mkdir(SUB_DIR, { recursive: true });
        dirs = await fsp.readdir(SUB_DIR);
    } catch (err) {
        console.warn("[SubtitleStore] migrateHashDirs: cannot read SUB_DIR:", err.message);
        return;
    }

    const hashDirs = dirs.filter((d) => OLD_HASH_RE.test(d));
    if (hashDirs.length === 0) return;

    // Without queue entries we have no title/type/season info to build the
    // new readable path — skip migration this run, old dirs stay untouched
    // (NOT deleted) and will be picked up once queue is populated.
    if (_queueIndex.size === 0) {
        console.log(`[SubtitleStore] migrateHashDirs: ${hashDirs.length} legacy dir(s) found but queue is empty — deferring migration`);
        return;
    }

    // Build reverse map: hash → mediaId from current meta
    const hashToMedia = new Map();
    for (const [mediaId, entry] of Object.entries(_meta)) {
        for (const dl of entry.downloaded || []) {
            try {
                const parts = dl.path.split(path.sep);
                const idx = parts.indexOf("subtitles");
                if (idx >= 0 && OLD_HASH_RE.test(parts[idx + 1])) {
                    hashToMedia.set(parts[idx + 1], { mediaId, entry });
                }
            } catch {
                /* malformed path entry — skip */
            }
        }
    }

    for (const hashDir of hashDirs) {
        try {
            const match = hashToMedia.get(hashDir);
            if (!match) {
                // Orphan hash dir with no known owner — leave it alone rather
                // than risk deleting subtitles we can't account for.
                console.log(`[SubtitleStore] migrateHashDirs: unowned legacy dir "${hashDir}" — leaving as-is`);
                continue;
            }
            const { mediaId } = match;
            const queueEntry = _queueIndex.get(mediaId);
            if (!queueEntry) continue; // no metadata to build new name — skip this one, try next boot

            const resolved = resolveSubtitlePaths(mediaId, {
                title: queueEntry.title,
                type: queueEntry.type,
                tmdbId: queueEntry.tmdbId,
                season: queueEntry.season,
                episode: queueEntry.episode,
                part: queueEntry.part,
            });

            const oldBase = path.join(SUB_DIR, hashDir);
            const newBase = resolved.baseDir;
            if (oldBase === newBase) continue;

            await fsp.mkdir(path.dirname(newBase), { recursive: true });
            await fsp.rename(oldBase, newBase);

            for (const dl of _meta[mediaId]?.downloaded || []) {
                dl.path = dl.path.replace(oldBase, newBase);
            }
            migrated++;
            console.log(`[SubtitleStore] Migrated: ${hashDir} → ${path.basename(newBase)}`);
        } catch (err) {
            // One bad entry must never abort migration for the rest
            console.warn(`[SubtitleStore] Migration failed for "${hashDir}" (non-fatal):`, err.message);
        }
    }

    if (migrated > 0) await atomicWrite(META_FILE, _meta);
}

// ─── Queue store ─────────────────────────────────────────────────────────────

async function _loadQueue() {
    try {
        const raw = await fsp.readFile(QUEUE_FILE, "utf-8");
        _queue = JSON.parse(raw);
    } catch {
        _queue = [];
    }
    let changed = false;
    let retried = 0;
    for (const e of _queue) {
        if (e.status === "downloading") {
            e.status = "pending";
            changed = true;
        }
        // Items that exhausted their 3 attempts last run get a fresh start
        // on every server boot — "failed" is never truly permanent, only
        // permanent for the duration of a single run.
        if (e.status === "failed") {
            e.status = "pending";
            e.attempts = 0;
            e.lastError = null;
            e.nextRetryAt = null;
            changed = true;
            retried++;
        }
    }
    if (retried > 0) console.log(`[SubtitleStore] Resetting ${retried} previously-failed item(s) for retry this run`);
    _queueIndex.clear();
    for (const e of _queue) _queueIndex.set(e.mediaId, e);
    if (changed) await atomicWrite(QUEUE_FILE, _queue);
}

/**
 * Bulk enqueue — single disk write.
 * Skips items where BOTH langs already exist on disk (_available).
 * items: [{ mediaId, title, year, imdbId, tmdbId, season, episode, part, type }]
 */
async function enqueueBatch(items) {
    if (!_queue) await _loadQueue();
    let added = 0;

    for (const item of items) {
        // Skip if ALL supported langs are already available
        const allDone = SUPPORTED_LANGS.every((l) => hasDownloadedSubtitle(item.mediaId, l));
        if (allDone) continue;

        const existing = _queueIndex.get(item.mediaId);
        if (existing) {
            if (existing.status === "done" || existing.status === "pending" || existing.status === "downloading" || existing.status === "skipped") continue;
            if (existing.status === "failed") {
                existing.status = "pending";
                existing.attempts = 0;
                existing.lastError = null;
            }
            continue;
        }

        const entry = {
            id: `${shortId(item.mediaId)}-${Date.now()}-${added}`,
            mediaId: item.mediaId,
            title: item.title || "",
            year: item.year || null,
            imdbId: item.imdbId || null,
            tmdbId: item.tmdbId ? String(item.tmdbId) : null,
            season: item.season ?? null,
            episode: item.episode ?? null,
            part: item.part ?? null,
            type: item.type || "movie",
            spokenLanguage: item.spokenLanguage || null,
            status: "pending",
            addedAt: new Date().toISOString(),
            attempts: 0,
            lastError: null,
        };
        _queue.push(entry);
        _queueIndex.set(item.mediaId, entry);
        added++;
    }

    if (added > 0) await atomicWrite(QUEUE_FILE, _queue);
    return added;
}

async function enqueue(mediaId, meta = {}) {
    if (!_queue) await _loadQueue();
    const allDone = SUPPORTED_LANGS.every((l) => hasDownloadedSubtitle(mediaId, l));
    if (allDone) return _queueIndex.get(mediaId) || { mediaId, status: "done" };

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
        id: `${shortId(mediaId)}-${Date.now()}`,
        mediaId,
        title: meta.title || "",
        year: meta.year || null,
        imdbId: meta.imdbId || null,
        tmdbId: meta.tmdbId ? String(meta.tmdbId) : null,
        season: meta.season ?? null,
        episode: meta.episode ?? null,
        part: meta.part ?? null,
        type: meta.type || "movie",
        spokenLanguage: meta.spokenLanguage || null,
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

function dequeue() {
    if (!_queue) return null;
    const now = Date.now();
    return _queue.find((e) => e.status === "pending" && (!e.nextRetryAt || e.nextRetryAt <= now)) || null;
}

function markDownloading(entry) {
    entry.status = "downloading";
    entry.attempts++;
    entry.nextRetryAt = null;
    _queueWriter.schedule();
}

function markDone(entry) {
    entry.status = "done";
    entry.completedAt = new Date().toISOString();
    _queueWriter.schedule();
}

// Max retry attempts within a single run before skipping to the next item.
// After 3 failed attempts the item is marked "failed" and the worker moves
// on — but "failed" entries are reset to "pending" again on next server
// start (see _loadQueue) so they get a fresh 3 attempts every restart.
const MAX_ATTEMPTS = 3;

function markFailed(entry, error) {
    if (entry.attempts >= MAX_ATTEMPTS) {
        entry.status = "failed";
        entry.nextRetryAt = null;
        console.log(`[SubtitleStore] "${entry.title}" failed after ${entry.attempts} attempts — skipping (will retry on next server start)`);
    } else {
        entry.status = "pending";
        // Short backoff so a broken item doesn't hog every tick before its
        // 3 attempts are used up: attempt 1→ retry now, 2→ ~12s
        const backoffMs = Math.min(entry.attempts * 12_000, 30_000);
        entry.nextRetryAt = Date.now() + backoffMs;
    }
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

async function _removeQueueEntry(mediaId) {
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
 * Get lang dir for a media item given queue-entry-style meta.
 * Used by worker and mediaController.
 */
function getSubtitleLangDir(mediaId, lang, meta = {}) {
    const resolved = resolveSubtitlePaths(mediaId, meta);
    return resolved.langDir(lang);
}

/**
 * Backward-compat: base dir (used by uploadSubtitle).
 * When meta not available, use mediaId shortId only.
 */
function getSubtitleDir(mediaId, meta = {}) {
    return resolveSubtitlePaths(mediaId, meta).baseDir;
}

function getSubtitleStreamUrl(destPath) {
    const encoded = Buffer.from(destPath).toString("base64url");
    return `/stream/subtitle/${encoded}`;
}

// ─── Startup reconciliation ───────────────────────────────────────────────────

async function reconcile(allMediaIds) {
    if (!_meta) await _loadMeta();
    if (!_queue) await _loadQueue();

    // Remove meta entries for missing media
    let metaChanged = false;
    for (const mediaId of Object.keys(_meta)) {
        if (!allMediaIds.has(mediaId)) {
            delete _meta[mediaId];
            for (const lang of SUPPORTED_LANGS) _available.delete(`${mediaId}:${lang}`);
            metaChanged = true;
        }
    }
    if (metaChanged) await atomicWrite(META_FILE, _meta);

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

    // Migration and disk-scan must NEVER abort startup — if either throws,
    // log it and continue with whatever state we have. A failure here
    // must not prevent the worker from finding pending queue items.
    try {
        await migrateHashDirs();
    } catch (err) {
        console.error("[SubtitleStore] migrateHashDirs failed (non-fatal):", err.message);
    }

    try {
        await scanExistingSubtitles();
    } catch (err) {
        console.error("[SubtitleStore] scanExistingSubtitles failed (non-fatal):", err.message);
    }

    const pending = _queue.filter((e) => e.status === "pending").length;
    const failed = _queue.filter((e) => e.status === "failed").length;
    const done = _queue.filter((e) => e.status === "done").length;
    console.log(`[SubtitleStore] Ready: meta=${Object.keys(_meta).length} queue=${_queue.length} pending=${pending} done=${done} failed=${failed} available=${_available.size}`);
}

/**
 * requeueEntry — put an entry back to pending WITHOUT counting the attempt.
 * Used by worker on 429 rate_limit so the entry retries after cooldown
 * and the attempt counter is not burned.
 */
function requeueEntry(entry) {
    entry.status = "pending";
    entry.attempts = Math.max(0, (entry.attempts || 1) - 1); // undo the markDownloading increment
    entry.lastError = null;
    _queueWriter.schedule();
}

module.exports = {
    init,
    reconcile,
    resolveSubtitlePaths, // used by worker
    // meta
    getMediaMeta,
    recordDownloaded,
    removeMediaSubtitles,
    removeLibrarySubtitles,
    hasDownloadedSubtitle, // sync
    // queue
    enqueue,
    enqueueBatch,
    dequeue, // sync
    markDownloading, // sync
    markDone, // sync
    markFailed, // sync
    markFailedPermanent, // sync
    markSkipped, // sync
    requeueEntry, // sync — re-queues without burning attempt
    getQueueStats,
    // paths
    getSubtitleDir,
    getSubtitleLangDir,
    getSubtitleStreamUrl,
};
