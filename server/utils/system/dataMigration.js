"use strict";

/**
 * utils/system/dataMigration.js — one-time, idempotent reorganisation of server/data.
 *
 * Runs FIRST in server.js (before any store loads its file). Moves old flat files into folders:
 *   library/ media/ subtitles/ live/ users/ system/ legacy/
 * Rules: never overwrites, never deletes. Every moved file is first copied to
 * data/_migration-backup-<date>/. If a move FAILS the server refuses to boot (a store would
 * otherwise silently start with an empty file while the real one sits in the old place).
 *
 * Deliberately NOT moved: metadata.json (its store is frozen), flux-auth.db (Prisma path),
 * subtitle folders (subtitle-meta.json stores absolute paths into them).
 */

const fs = require("fs");
const path = require("path");

const DATA = path.join(__dirname, "..", "..", "data");

const DIRS = ["library", "media", "media/thumbnails", "subtitles", "live", "users", "system", "legacy"];

const FILE_MOVES = [
    ["folders.json", "library/folders.json"],
    ["mediainfo.json", "media/mediainfo.json"],
    ["trailers.json", "media/trailers.json"],
    ["audioSync.json", "media/audioSync.json"],
    ["recommendations.json", "media/recommendations.json"],
    ["subtitle-meta.json", "subtitles/subtitle-meta.json"],
    ["subtitle-queue.json", "subtitles/subtitle-queue.json"],
    ["live.json", "live/live.json"],
    ["active_live.json", "live/active_live.json"],
    ["iptv-sources.json", "live/iptv-sources.json"],
    ["channel-state.json", "live/channel-state.json"],
    ["iptvorg-cache.json", "live/iptvorg-cache.json"],
    ["userdata.json", "users/userdata.json"],
    ["history.json", "users/history.json"],
    ["watchtime.json", "users/watchtime.json"],
    ["permissions.json", "users/permissions.json"],
    ["reminders.json", "users/reminders.json"],
    ["hwaccel_cache.json", "system/hwaccel_cache.json"],
    ["sysinfo_cache.json", "system/sysinfo_cache.json"],
    // no code reads these any more (removed cloud/upload subsystem) — parked, not deleted
    ["chunkUploads.json", "legacy/chunkUploads.json"],
    ["cloudLibraries.json", "legacy/cloudLibraries.json"],
    ["storageProviders.json", "legacy/storageProviders.json"],
    ["uploadHistory.json", "legacy/uploadHistory.json"],
];

// Directory moves: old thumbnails (unreadable names, regenerate on demand) are parked, not deleted.
const DIR_MOVES = [
    ["iptv-uploads", "live/iptv-uploads"],
    ["thumbnails", "media/thumbnails/_old"],
];

const TMP_RE = /\.tmp\.\d+\.\d+$/; // leftovers of an interrupted atomic write

const p = (rel) => path.join(DATA, ...rel.split("/"));
const exists = (f) => fs.existsSync(f);
const size = (f) => {
    try {
        return fs.statSync(f).size;
    } catch {
        return -1;
    }
};
function isEmptyDir(d) {
    try {
        return fs.statSync(d).isDirectory() && fs.readdirSync(d).length === 0;
    } catch {
        return false;
    }
}

function run() {
    if (!exists(DATA)) fs.mkdirSync(DATA, { recursive: true });
    for (const d of DIRS) fs.mkdirSync(p(d), { recursive: true });

    const pending = [];
    const errors = [];
    const stamp = new Date().toISOString().slice(0, 10);
    const backupDir = path.join(DATA, `_migration-backup-${stamp}`);

    for (const [from, to] of FILE_MOVES) if (exists(p(from))) pending.push({ kind: "file", from, to });
    for (const [from, to] of DIR_MOVES) if (exists(p(from))) pending.push({ kind: "dir", from, to });
    for (const name of safeReaddir(DATA)) {
        if (TMP_RE.test(name) && fs.statSync(p(name)).isFile()) pending.push({ kind: "file", from: name, to: `legacy/interrupted-writes/${name}` });
    }
    if (!pending.length) return { moved: 0 };

    let moved = 0;
    for (const m of pending) {
        const src = p(m.from);
        const dst = p(m.to);
        try {
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            if (m.kind === "file") {
                fs.mkdirSync(backupDir, { recursive: true });
                const bak = path.join(backupDir, m.from);
                if (!exists(bak)) fs.copyFileSync(src, bak);
                if (exists(dst)) {
                    if (size(dst) < size(src)) {
                        // a store created an empty/stub file at the new place first — park it, keep the real data
                        const stub = path.join(backupDir, `STUB-${m.to.replace(/\//g, "_")}`);
                        if (!exists(stub)) fs.renameSync(dst, stub);
                        else fs.unlinkSync(dst);
                    } else {
                        console.warn(`[DataMigration] both exist, keeping both: ${m.from} and ${m.to} — check manually`);
                        continue;
                    }
                }
                fs.renameSync(src, dst);
            } else {
                if (exists(dst)) {
                    if (isEmptyDir(dst)) fs.rmdirSync(dst);
                    else {
                        console.warn(`[DataMigration] both exist, keeping both: ${m.from}/ and ${m.to}/ — check manually`);
                        continue;
                    }
                }
                fs.renameSync(src, dst);
            }
            moved++;
        } catch (err) {
            errors.push(`${m.from} → ${m.to}: ${err.code || err.message}`);
        }
    }

    if (errors.length) {
        throw new Error(`[DataMigration] could not move ${errors.length} item(s) — is another server instance still running? ${errors.join("; ")}`);
    }
    console.log(`[DataMigration] moved ${moved} item(s) into folders. Backup: data/_migration-backup-${stamp}/`);
    return { moved };
}

function safeReaddir(d) {
    try {
        return fs.readdirSync(d);
    } catch {
        return [];
    }
}

module.exports = { run };
