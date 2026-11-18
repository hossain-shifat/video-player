"use strict";

/**
 * routes/admin/adminSubtitles.js — admin view of every DOWNLOADED (SubDL / SubSource) subtitle.
 *
 * Read-only data comes from server/data/subtitles/subtitle-meta.json (written by subtitleStore.js) plus the
 * subtitle files themselves. Embedded subtitle tracks are NOT listed here (they live inside the video files).
 *
 * Mount it behind the SAME guards you already use for the other admin routes (see README-DashMedia.md):
 *     app.use("/api/admin-subtitles", <your admin guards>, require("./routes/admin/adminSubtitles"));
 * This file adds no auth of its own on purpose, so it can never get out of step with your admin middleware.
 *
 *   GET    /                              list: one row per downloaded subtitle file
 *   GET    /:mediaId/:lang/preview        first cues of one file ( ?limit=40 )
 *   DELETE /:mediaId/:lang                move the file to <langDir>/_rejected/ and forget it (recoverable)
 *   POST   /:mediaId/:lang/redownload     same as the worker's audit: move to _rejected, forget it, queue a fresh download
 *
 * Nothing in subtitleStore.js / subtitleWorker.js is changed. Files are never hard-deleted.
 */

const express = require("express");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const store = require("../../utils/subtitles/subtitleStore");

const SUB_ROOT = path.resolve(__dirname, "..", "..", "data", "subtitles");
const META_FILE = path.join(SUB_ROOT, "subtitle-meta.json");
const BAD_ENCODING_RATIO = 0.01; // same threshold the worker uses for "broken_encoding"

const router = express.Router();

// ─── helpers ────────────────────────────────────────────────────────────────

const norm = (p) => String(p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const insideRoot = (file) => norm(path.resolve(file)).startsWith(`${norm(SUB_ROOT)}/`);

async function readMeta() {
    try {
        return JSON.parse(await fsp.readFile(META_FILE, "utf-8")) || {};
    } catch {
        return {};
    }
}

async function findEntry(mediaId, lang) {
    const meta = await readMeta();
    const dl = (meta[mediaId]?.downloaded || []).find((d) => d.lang === lang);
    return dl && dl.path && insideRoot(dl.path) ? dl : null;
}

/** Returns { text, encoding, badRatio }. Encoding is what we can PROVE: BOM-marked UTF-16 / UTF-8, or "Non-UTF-8" when decoding breaks. */
function decode(buf) {
    let text;
    let encoding = "UTF-8";
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
        text = buf.slice(2).toString("utf16le");
        encoding = "UTF-16";
    } else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
        const swapped = Buffer.from(buf.slice(2));
        swapped.swap16();
        text = swapped.toString("utf16le");
        encoding = "UTF-16";
    } else {
        text = buf.toString("utf-8");
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    }
    const bad = (text.match(/\uFFFD/g) || []).length;
    const badRatio = text.length ? bad / text.length : 0;
    if (badRatio > BAD_ENCODING_RATIO) encoding = "Non-UTF-8";
    return { text: text.replace(/\r\n?/g, "\n"), encoding, badRatio };
}

const sec = (h, m, s, ms) => Number(h || 0) * 3600 + Number(m) * 60 + Number(s) + Number(String(ms).padEnd(3, "0").slice(0, 3)) / 1000;

const TIME_RE = /(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/g;
const ASS_RE = /^Dialogue:\s*[^,]*,(\d+):(\d{2}):(\d{2})[.,](\d{1,3}),(\d+):(\d{2}):(\d{2})[.,](\d{1,3})/gm;

/** Cue count + last end time for SRT / WebVTT / ASS. */
function countCues(text, ext) {
    let cues = 0;
    let lastEnd = 0;
    if (ext === ".ass" || ext === ".ssa") {
        for (const m of text.matchAll(ASS_RE)) {
            cues++;
            lastEnd = Math.max(lastEnd, sec(m[5], m[6], m[7], m[8]));
        }
        return { cues, lastEnd };
    }
    for (const m of text.matchAll(TIME_RE)) {
        cues++;
        lastEnd = Math.max(lastEnd, sec(m[5], m[6], m[7], m[8]));
    }
    return { cues, lastEnd };
}

/** First `limit` cues as [{ start, end, text }] — SRT / WebVTT only (ASS shows an empty list, the file is still counted). */
function previewCues(text, ext, limit) {
    if (ext === ".ass" || ext === ".ssa") return [];
    const out = [];
    const lines = text.split("\n");
    for (let i = 0; i < lines.length && out.length < limit; i++) {
        TIME_RE.lastIndex = 0;
        const m = TIME_RE.exec(lines[i]);
        if (!m) continue;
        const body = [];
        for (let j = i + 1; j < lines.length && lines[j].trim() !== ""; j++) body.push(lines[j].replace(/<[^>]+>|\{[^}]*\}/g, "").trim());
        out.push({ start: sec(m[1], m[2], m[3], m[4]), end: sec(m[5], m[6], m[7], m[8]), text: body.filter(Boolean).join(" ") });
    }
    return out;
}

// Parsed-result cache keyed by path + mtime + size, so reopening the page does not re-read ~1000 files.
const cache = new Map();

async function inspect(dl) {
    const ext = path.extname(dl.path).toLowerCase() || ".srt";
    const base = {
        lang: dl.lang,
        ext,
        relPath: path.relative(SUB_ROOT, dl.path).split(path.sep).join("/"),
        addedAt: dl.addedAt || null,
        source: dl.source || null,
        score: typeof dl.score === "number" ? dl.score : null,
        validation: dl.validation || null,
        shiftApplied: typeof dl.shiftApplied === "number" ? dl.shiftApplied : 0,
    };
    let st;
    try {
        st = await fsp.stat(dl.path);
    } catch {
        return { ...base, status: "missing", sizeBytes: 0, cues: 0, durationSec: 0, cuesPerSec: 0, encoding: null };
    }
    const key = `${dl.path}|${st.mtimeMs}|${st.size}`;
    let parsed = cache.get(key);
    if (!parsed) {
        const { text, encoding, badRatio } = decode(await fsp.readFile(dl.path));
        const { cues, lastEnd } = countCues(text, ext);
        parsed = { encoding, badRatio, cues, lastEnd };
        cache.set(key, parsed);
        if (cache.size > 5000) cache.delete(cache.keys().next().value);
    }
    const status = parsed.cues === 0 ? "empty" : parsed.badRatio > BAD_ENCODING_RATIO ? "bad_encoding" : "ok";
    return {
        ...base,
        status,
        sizeBytes: st.size,
        addedAt: base.addedAt || st.mtime.toISOString(),
        cues: parsed.cues,
        durationSec: Math.round(parsed.lastEnd),
        cuesPerSec: parsed.lastEnd > 0 ? Math.round((parsed.cues / parsed.lastEnd) * 100) / 100 : 0,
        encoding: parsed.encoding,
    };
}

async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, async () => {
            while (next < items.length) {
                const i = next++;
                out[i] = await fn(items[i]);
            }
        }),
    );
    return out;
}

/** Same move the worker's audit makes: keep the file, but out of the way. */
async function moveToRejected(dl) {
    const dir = path.join(path.dirname(dl.path), "_rejected");
    await fsp.mkdir(dir, { recursive: true });
    try {
        await fsp.rename(dl.path, path.join(dir, `${Date.now()}-${path.basename(dl.path)}`));
    } catch (err) {
        if (err.code !== "ENOENT") throw err; // already gone from disk — just forget it below
    }
}

// ─── routes ─────────────────────────────────────────────────────────────────

router.get("/", async (_req, res) => {
    try {
        const meta = await readMeta();
        const rows = [];
        for (const [mediaId, entry] of Object.entries(meta)) {
            for (const dl of entry.downloaded || []) if (dl.path && insideRoot(dl.path)) rows.push({ mediaId, dl });
        }
        const subtitles = await mapLimit(rows, 12, async ({ mediaId, dl }) => ({ mediaId, ...(await inspect(dl)) }));
        const summary = { total: subtitles.length, cues: 0, bytes: 0, byLang: {}, byExt: {}, byStatus: {} };
        for (const s of subtitles) {
            summary.cues += s.cues;
            summary.bytes += s.sizeBytes;
            summary.byLang[s.lang] = (summary.byLang[s.lang] || 0) + 1;
            summary.byExt[s.ext] = (summary.byExt[s.ext] || 0) + 1;
            summary.byStatus[s.status] = (summary.byStatus[s.status] || 0) + 1;
        }
        res.json({ subtitles, summary, generatedAt: new Date().toISOString() });
    } catch (err) {
        console.error("[AdminSubtitles] list failed:", err.message);
        res.status(500).json({ error: "SUBTITLE_LIST_FAILED", message: err.message });
    }
});

router.get("/:mediaId/:lang/preview", async (req, res) => {
    try {
        const dl = await findEntry(req.params.mediaId, req.params.lang);
        if (!dl) return res.status(404).json({ error: "NOT_FOUND" });
        const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 40, 200));
        const ext = path.extname(dl.path).toLowerCase() || ".srt";
        const { text, encoding } = decode(await fsp.readFile(dl.path));
        res.json({ cues: previewCues(text, ext, limit), total: countCues(text, ext).cues, encoding, ext });
    } catch (err) {
        res.status(err.code === "ENOENT" ? 404 : 500).json({ error: "PREVIEW_FAILED", message: err.message });
    }
});

router.delete("/:mediaId/:lang", async (req, res) => {
    try {
        const { mediaId, lang } = req.params;
        const dl = await findEntry(mediaId, lang);
        if (!dl) return res.status(404).json({ error: "NOT_FOUND" });
        await moveToRejected(dl);
        await store.removeDownloaded(mediaId, lang);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: "REMOVE_FAILED", message: err.message });
    }
});

router.post("/:mediaId/:lang/redownload", async (req, res) => {
    try {
        const { mediaId, lang } = req.params;
        const dl = await findEntry(mediaId, lang);
        if (!dl) return res.status(404).json({ error: "NOT_FOUND" });
        await moveToRejected(dl);
        await store.removeDownloaded(mediaId, lang);
        const requeued = store.requeueForRedownload(mediaId); // false when the title has no queue entry (it will not be fetched again)
        res.json({ ok: true, requeued });
    } catch (err) {
        res.status(500).json({ error: "REDOWNLOAD_FAILED", message: err.message });
    }
});

module.exports = router;
