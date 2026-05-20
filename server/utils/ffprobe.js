"use strict";

/**
 * ffprobe.js — FLUX v4 (Production)
 *
 * Improvements over v3:
 *  1. Disk-persisted cache — survives server restarts (no re-probe on every start)
 *  2. In-memory LRU on top of disk cache — fast path for hot files
 *  3. Async disk write (non-blocking on hot path)
 *  4. File mtime check — invalidates cache if file was modified since last probe
 *  5. Separate timeout for large files (30s) vs small (15s)
 */

const { execFile } = require("child_process");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { extractMediaInfo } = require("./streamingEngine");

// ─── Config ───────────────────────────────────────────────────────────────────

const CACHE_MAX = 500; // max in-memory entries
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour in-memory TTL
const DISK_CACHE_FILE = process.env.FFPROBE_CACHE_FILE || path.join(__dirname, "../data/ffprobe_cache.json");
const DISK_CACHE_MAX = 2000; // max entries to persist to disk
const PROBE_TIMEOUT_SMALL = 15_000; // files < 2GB
const PROBE_TIMEOUT_LARGE = 30_000; // files >= 2GB

// ─── In-memory cache ──────────────────────────────────────────────────────────
// Map<filePath, { data: mediaInfo, ts: number, mtime: number }>

const memCache = new Map();

// ─── Disk cache ───────────────────────────────────────────────────────────────

let diskCache = {}; // filePath → { data, ts, mtime }
let diskCacheLoaded = false;

function loadDiskCache() {
    if (diskCacheLoaded) return;
    diskCacheLoaded = true;
    try {
        const raw = fs.readFileSync(DISK_CACHE_FILE, "utf-8");
        diskCache = JSON.parse(raw);
        console.log(`[FFprobe] Loaded ${Object.keys(diskCache).length} cached probes from disk`);
    } catch {
        diskCache = {};
    }
}

let _diskWriteTimer = null;

function scheduleDiskWrite() {
    if (_diskWriteTimer) return;
    _diskWriteTimer = setTimeout(async () => {
        _diskWriteTimer = null;
        try {
            // Trim to max entries (keep newest)
            const entries = Object.entries(diskCache);
            if (entries.length > DISK_CACHE_MAX) {
                entries.sort((a, b) => b[1].ts - a[1].ts);
                diskCache = Object.fromEntries(entries.slice(0, DISK_CACHE_MAX));
            }
            await fsp.mkdir(path.dirname(DISK_CACHE_FILE), { recursive: true });
            const tmp = `${DISK_CACHE_FILE}.tmp.${Date.now()}`;
            await fsp.writeFile(tmp, JSON.stringify(diskCache), "utf-8");
            await fsp.rename(tmp, DISK_CACHE_FILE);
        } catch (e) {
            console.warn("[FFprobe] Disk cache write failed:", e.message);
        }
    }, 5000); // debounce 5s
}

// ─── Core probe function ──────────────────────────────────────────────────────

/**
 * probe(filePath) → mediaInfo object (see streamingEngine.extractMediaInfo)
 *
 * Cache hit order: memory → disk → ffprobe
 * Cache invalidation: file mtime change
 */
async function probe(filePath) {
    loadDiskCache();

    const absPath = path.resolve(filePath);
    const now = Date.now();

    // Get current file mtime for cache validation
    let fileMtime = 0;
    try {
        const stat = await fsp.stat(absPath);
        fileMtime = stat.mtimeMs;
    } catch (err) {
        throw new Error(`File not accessible: ${err.message}`);
    }

    // 1. Memory cache hit
    const memHit = memCache.get(absPath);
    if (memHit && now - memHit.ts < CACHE_TTL_MS && memHit.mtime === fileMtime) {
        return memHit.data;
    }

    // 2. Disk cache hit
    const diskHit = diskCache[absPath];
    if (diskHit && now - diskHit.ts < CACHE_TTL_MS && diskHit.mtime === fileMtime) {
        // Warm memory cache from disk
        if (memCache.size >= CACHE_MAX) {
            const firstKey = memCache.keys().next().value;
            memCache.delete(firstKey);
        }
        memCache.set(absPath, diskHit);
        return diskHit.data;
    }

    // 3. Run ffprobe
    const fileSize = (await fsp.stat(absPath).catch(() => ({ size: 0 }))).size;
    const timeout = fileSize >= 2 * 1024 * 1024 * 1024 ? PROBE_TIMEOUT_LARGE : PROBE_TIMEOUT_SMALL;

    const raw = await runFFprobe(absPath, timeout);
    const info = extractMediaInfo(raw);

    const entry = { data: info, ts: now, mtime: fileMtime };

    // Store in memory (LRU evict)
    if (memCache.size >= CACHE_MAX) {
        const firstKey = memCache.keys().next().value;
        memCache.delete(firstKey);
    }
    memCache.set(absPath, entry);

    // Store on disk (async, debounced)
    diskCache[absPath] = entry;
    scheduleDiskWrite();

    return info;
}

function runFFprobe(filePath, timeout) {
    return new Promise((resolve, reject) => {
        execFile("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", filePath], { timeout }, (err, stdout) => {
            if (err) return reject(new Error(`ffprobe failed: ${err.message}`));
            let raw;
            try {
                raw = JSON.parse(stdout);
            } catch {
                return reject(new Error("ffprobe JSON parse error"));
            }
            resolve(raw);
        });
    });
}

// ─── Cache invalidation ───────────────────────────────────────────────────────

function invalidate(filePath) {
    const absPath = path.resolve(filePath);
    memCache.delete(absPath);
    delete diskCache[absPath];
    scheduleDiskWrite();
}

function invalidateAll() {
    memCache.clear();
    diskCache = {};
    scheduleDiskWrite();
}

module.exports = { probe, invalidate, invalidateAll };
