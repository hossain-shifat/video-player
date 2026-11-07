"use strict";

/**
 * utils/storageMonitor.js
 *
 * Periodically checks the disks that hold your library folders and alerts
 * admins when one is nearly full. Same lifecycle pattern as trailerScheduler:
 * .unref()'d timer, start at boot, stop on shutdown.
 *
 *   STORAGE_CHECK_INTERVAL_MS   default 30 min
 *   STORAGE_ALERT_PERCENT       default 90   (used % at/above which to alert)
 *   STORAGE_ALERT_MIN_FREE_GB   default 20   (free GB below which to alert; 0 = off)
 *   STORAGE_ALERT_COOLDOWN_MS   default 24 h (per-disk, survives restarts via DB dedupe)
 */

const path = require("path");
const si = require("systeminformation");

const { readFolders } = require("../../controllers/media/libraryController");
const notificationService = require("../../services/notificationService");

const INTERVAL_MS = parseInt(process.env.STORAGE_CHECK_INTERVAL_MS || String(30 * 60 * 1000), 10);
const ALERT_PERCENT = parseFloat(process.env.STORAGE_ALERT_PERCENT || "90");
const MIN_FREE_GB = parseFloat(process.env.STORAGE_ALERT_MIN_FREE_GB || "20");
const COOLDOWN_MS = parseInt(process.env.STORAGE_ALERT_COOLDOWN_MS || String(24 * 60 * 60 * 1000), 10);
const GB = 1024 ** 3;

let timer = null;
let bootTimer = null;
let running = false;

const norm = (p) => path.resolve(p).replace(/\\/g, "/").toLowerCase();

// Pick the mount point with the longest matching prefix for a folder path.
function mountFor(folderPath, disks) {
    const target = norm(folderPath);
    let best = null;
    for (const d of disks) {
        const m = (d.mount || "").replace(/\\/g, "/").toLowerCase().replace(/\/+$/, "");
        // Linux root "/" becomes "" after trimming the slash — it matches any absolute path.
        const matches = target === m || target.startsWith(m + "/");
        if (matches && (!best || m.length > best.m.length)) best = { disk: d, m };
    }
    return best?.disk || null;
}

const fmt = (bytes) => (bytes >= 1024 ** 4 ? `${(bytes / 1024 ** 4).toFixed(1)} TB` : `${(bytes / GB).toFixed(1)} GB`);

async function checkOnce() {
    if (running) return;
    running = true;
    try {
        const [folders, disks] = await Promise.all([readFolders(), si.fsSize()]);
        if (!folders.length || !disks.length) return;

        // mount → { disk, labels[] }
        const byMount = new Map();
        for (const f of folders) {
            const disk = mountFor(f.path, disks);
            if (!disk) continue;
            const key = disk.mount;
            if (!byMount.has(key)) byMount.set(key, { disk, labels: [] });
            byMount.get(key).labels.push(f.label || path.basename(f.path));
        }

        for (const [mount, { disk, labels }] of byMount) {
            const usedPct = disk.size > 0 ? (disk.used / disk.size) * 100 : 0;
            const free = disk.available ?? disk.size - disk.used;
            const tooFull = usedPct >= ALERT_PERCENT;
            const tooLittle = MIN_FREE_GB > 0 && free < MIN_FREE_GB * GB;
            if (!tooFull && !tooLittle) continue;

            await notificationService.notifyAdmins({
                type: notificationService.TYPES.STORAGE,
                title: "Storage running low",
                body: `A library disk is ${usedPct.toFixed(0)}% full — ${fmt(free)} free.`,
                meta: { mount, usedPercent: Math.round(usedPct), freeBytes: Math.max(0, Math.round(free)), libraries: labels.slice(0, 10) },
                dedupeKey: `storage:${mount}`,
                dedupeWindowMs: COOLDOWN_MS,
            });
        }
    } catch (err) {
        console.error("[StorageMonitor] check failed:", err.message);
    } finally {
        running = false;
    }
}

function startStorageMonitor() {
    // First check a minute after boot so startup scans aren't competing.
    bootTimer = setTimeout(checkOnce, 60 * 1000);
    bootTimer.unref();
    timer = setInterval(checkOnce, INTERVAL_MS);
    timer.unref();
}

function stopStorageMonitor() {
    if (bootTimer) clearTimeout(bootTimer);
    if (timer) clearInterval(timer);
    bootTimer = timer = null;
}

module.exports = { startStorageMonitor, stopStorageMonitor, checkOnce };
