"use strict";

/**
 * hlsCleanup.js — FLUX v4 (Production)
 *
 * FIXED race condition from v3:
 *  v3 bug: expireInactiveSessions() ran BEFORE deleteConsumedSegments()
 *         This meant a session could be killed mid-delete → orphan segments
 *
 *  CORRECT order (Jellyfin TranscodingSegmentCleaner pattern):
 *   1. deleteConsumedSegments  — position-aware segment trim (safe, non-destructive)
 *   2. expireInactiveSessions  — kill idle sessions + their dirs
 *   3. removeOrphanFolders     — clean up after crashes
 *   4. enforceStorageLimit     — LRU evict if over quota
 *
 * Position-aware deletion (Jellyfin TranscodingSegmentCleaner):
 *   idxMaxToDelete = floor((downloadPositionSec - KEEP_SECONDS) / SEGMENT_DURATION)
 *   → Only delete segments the player has already consumed and won't seek back to
 *
 * Storage limits:
 *   MAX_TEMP_MB: total temp dir cap (default 4GB)
 *   SEGMENT_KEEP_SECONDS: how many seconds of past segments to keep (default 30s)
 */

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const { getSession, killSession, getSessionStats, TEMP_DIR, SESSION_TIMEOUT_MS, SEGMENT_DURATION } = require("./transcoderService");

// ─── Config ───────────────────────────────────────────────────────────────────

const CLEANUP_INTERVAL_MS = parseInt(process.env.CLEANUP_INTERVAL_MS || "30000", 10);
const MAX_TEMP_MB = parseInt(process.env.MAX_TEMP_MB || "4096", 10);
const ORPHAN_AGE_MS = parseInt(process.env.ORPHAN_AGE_MS || "600000", 10); // 10 min
const SEGMENT_KEEP_SECONDS = parseInt(process.env.SEGMENT_KEEP_SECONDS || "30", 10);

let _timer = null;
let _running = false;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getDirSizeBytes(dirPath) {
    let total = 0;
    try {
        const entries = await fsp.readdir(dirPath, { withFileTypes: true });
        await Promise.all(
            entries.map(async (e) => {
                const full = path.join(dirPath, e.name);
                try {
                    if (e.isFile()) {
                        const stat = await fsp.stat(full);
                        total += stat.size;
                    } else if (e.isDirectory()) {
                        total += await getDirSizeBytes(full);
                    }
                } catch {}
            }),
        );
    } catch {}
    return total;
}

// ─── Step 1: Position-aware segment deletion (run FIRST — safe, no kill) ─────

async function deleteConsumedSegments() {
    const stats = getSessionStats();
    let deleted = 0;

    for (const s of stats) {
        const session = getSession(s.id);
        if (!session) continue;
        if (!session.downloadPositionSec || session.downloadPositionSec <= SEGMENT_KEEP_SECONDS) continue;

        // Only delete segments behind keep-window
        const idxMaxToDelete = Math.floor((session.downloadPositionSec - SEGMENT_KEEP_SECONDS) / SEGMENT_DURATION);
        if (idxMaxToDelete <= 0) continue;

        let files;
        try {
            files = await fsp.readdir(session.sessionDir);
        } catch {
            continue;
        }

        for (const file of files) {
            const m = file.match(/^index(\d+)\.ts$/);
            if (!m) continue;
            const idx = parseInt(m[1], 10);
            if (idx >= idxMaxToDelete) continue;

            try {
                await fsp.unlink(path.join(session.sessionDir, file));
                deleted++;
            } catch {}
        }
    }

    if (deleted > 0) {
        console.log(`[Cleanup] Deleted ${deleted} consumed segments`);
    }
}

// ─── Step 2: Expire idle sessions (AFTER segment cleanup) ─────────────────────

async function expireInactiveSessions() {
    const stats = getSessionStats();
    for (const s of stats) {
        if (s.idleMs > SESSION_TIMEOUT_MS) {
            console.log(`[Cleanup] Expire idle session ${s.id} (idle ${Math.round(s.idleMs / 1000)}s)`);
            await killSession(s.id);
        }
    }
}

// ─── Step 3: Remove orphan folders (dirs with no active session) ───────────────

async function removeOrphanFolders() {
    try {
        await fsp.mkdir(TEMP_DIR, { recursive: true });
        const entries = await fsp.readdir(TEMP_DIR, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const sessionDir = path.join(TEMP_DIR, entry.name);
            if (getSession(entry.name)) continue; // active session — skip

            let stat;
            try {
                stat = await fsp.stat(sessionDir);
            } catch {
                continue;
            }

            // Only remove if old enough (prevents removing very new dirs)
            if (Date.now() - stat.mtimeMs < ORPHAN_AGE_MS) continue;

            console.log(`[Cleanup] Remove orphan: ${entry.name}`);
            try {
                await fsp.rm(sessionDir, { recursive: true, force: true });
            } catch (e) {
                console.error("[Cleanup] rm orphan failed:", e.message);
            }
        }
    } catch (e) {
        console.error("[Cleanup] orphan scan error:", e.message);
    }
}

// ─── Step 4: Enforce storage limit (LRU eviction) ─────────────────────────────

async function enforceStorageLimit() {
    const totalBytes = await getDirSizeBytes(TEMP_DIR);
    const totalMB = totalBytes / (1024 * 1024);

    if (totalMB <= MAX_TEMP_MB) return;

    console.warn(`[Cleanup] Temp ${Math.round(totalMB)} MB > limit ${MAX_TEMP_MB} MB — evicting LRU sessions`);

    const dirs = [];
    try {
        const entries = await fsp.readdir(TEMP_DIR, { withFileTypes: true });
        for (const e of entries) {
            if (!e.isDirectory()) continue;
            const full = path.join(TEMP_DIR, e.name);
            try {
                const stat = await fsp.stat(full);
                dirs.push({ id: e.name, full, mtime: stat.mtimeMs });
            } catch {}
        }
    } catch {
        return;
    }

    dirs.sort((a, b) => a.mtime - b.mtime); // oldest first

    let runningTotal = totalMB;
    for (const dir of dirs) {
        if (runningTotal <= MAX_TEMP_MB * 0.85) break;
        const sizeMB = (await getDirSizeBytes(dir.full)) / (1024 * 1024);
        console.log(`[Cleanup] Evict ${dir.id} (${Math.round(sizeMB)} MB)`);
        await killSession(dir.id);
        try {
            await fsp.rm(dir.full, { recursive: true, force: true });
        } catch {}
        runningTotal -= sizeMB;
    }
}

// ─── Main cycle (correct order) ───────────────────────────────────────────────

async function runCycle() {
    if (_running) return;
    _running = true;
    try {
        // ORDER MATTERS: delete segments first (safe), then kill sessions, then clean dirs
        await deleteConsumedSegments();
        await expireInactiveSessions();
        await removeOrphanFolders();
        await enforceStorageLimit();
    } catch (e) {
        console.error("[Cleanup] cycle error:", e.message);
    } finally {
        _running = false;
    }
}

function startDaemon() {
    console.log(`[Cleanup] Daemon started — ${CLEANUP_INTERVAL_MS / 1000}s interval, keep ${SEGMENT_KEEP_SECONDS}s buffer, max ${MAX_TEMP_MB} MB`);
    fs.mkdirSync(TEMP_DIR, { recursive: true });
    // Run immediately on start to clean up from previous crash
    runCycle();
    _timer = setInterval(runCycle, CLEANUP_INTERVAL_MS);
    // Prevent timer from keeping process alive if everything else exits
    if (_timer.unref) _timer.unref();
}

function stopDaemon() {
    if (_timer) {
        clearInterval(_timer);
        _timer = null;
    }
    console.log("[Cleanup] Daemon stopped");
}

async function forceCleanupNow() {
    await runCycle();
}

module.exports = { startDaemon, stopDaemon, forceCleanupNow };
