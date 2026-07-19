"use strict";

// ─── Crash safety net ──────────────────────────────────────────────────────
// The bulk/per-channel health checker fires many concurrent fetch() calls at
// third-party IPTV hosts that are often slow, flaky, or actively hostile
// (redirect loops, connection resets mid-body). Aborting/timing those out
// can occasionally surface as an unhandled rejection or a dangling-socket
// 'error' event that bypasses normal try/catch — which previously took the
// whole Node process down. This is scoped narrowly (log + survive) rather
// than silently swallowing real bugs elsewhere.
process.on("unhandledRejection", (err) => {
    console.error("[IPTV] Unhandled rejection (survived):", err?.message || err);
});
process.on("uncaughtException", (err) => {
    console.error("[IPTV] Uncaught exception (survived):", err?.message || err);
});

const fs = require("fs");
const path = require("path");
const {
    UPLOADS_DIR,
    newSourceId,
    getSources,
    saveSource,
    updateSource,
    deleteSource,
    getPublicLive,
    getPublicLiveRich,
    getLive,
    writeLive,
    getActiveLive,
    mergeChannelsForSource,
    removeChannelsForSource,
} = require("../utils/iptvStore");
const { parsePlaylist, detectFormat } = require("../utils/iptvParser");
const iptvOrgDb = require("../utils/iptvOrgDb");
const channelStateStore = require("../utils/channelStateStore");

// Browser UA → many CDN/raw hosts drop no-UA requests → surfaces as AbortError
const BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
};

// ─── Consistent response helpers ──────────────────────────────────────────────
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
const fail = (res, message, status = 500) => res.status(status).json({ success: false, message });

// ─── Fetch with retry ─────────────────────────────────────────────────────────
async function fetchText(url, attempt = 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
        const res = await fetch(url, { headers: BROWSER_HEADERS, redirect: "follow", signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
    } catch (err) {
        clearTimeout(timer);
        if (attempt < 2) {
            console.warn(`[IPTV] fetch attempt ${attempt} failed (${err.message}) — retrying: ${url}`);
            return fetchText(url, attempt + 1);
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

// ─── Content-type sniff for files with no recognized extension ────────────────
function sniffFormat(content) {
    const head = content.trimStart().slice(0, 300);
    if (head.startsWith("#EXTM3U") || head.includes("#EXTINF")) return "M3U";
    if (head.startsWith("{") || head.startsWith("[")) return "JSON";
    if (head.startsWith("<")) return "XML";
    if (head.includes("channels:") || head.includes("name:") || head.includes("- url:")) return "YAML";
    // Try M3U as last resort — most plain-text playlists are M3U without EXTM3U header
    return "M3U";
}

// ─── Core: parse + store channels for one source ─────────────────────────────
async function ingestSource(source, content) {
    try {
        await iptvOrgDb.ensureLoaded().catch((err) => {
            // DB fetch failing must not block ingestion — fall back to keyword classifier
            console.warn("[IPTV] iptvOrgDb load failed, proceeding without it:", err.message);
        });
        const format = source.format && source.format !== "Unknown" ? source.format : sniffFormat(content);
        const channels = parsePlaylist(content, format, source.location);
        await mergeChannelsForSource(source.id, source.name, channels);
        const result = await updateSource(source.id, { status: "ready", channelCount: channels.length, error: null });
        // Auto health-check the fresh batch in background — no admin click
        // needed before "Working Status" / status-sort has real data.
        runBulkStreamCheck().catch((err) => console.warn("[IPTV] post-ingest bulk check failed:", err.message));
        return result;
    } catch (err) {
        console.error(`[IPTV] ingest failed for source ${source.id}:`, err.message);
        return updateSource(source.id, { status: "error", error: err.message });
    }
}

// Background ingest — never awaited by HTTP handler
function ingestInBackground(source) {
    (async () => {
        try {
            const content = await fetchText(source.location);
            await ingestSource(source, content);
        } catch (err) {
            console.error(`[IPTV] background ingest failed for ${source.id}:`, err.message);
            await updateSource(source.id, { status: "error", error: `Fetch failed: ${err.message}` });
        }
    })();
}

// ─── GET /api/live/sources ────────────────────────────────────────────────────
function listSources(req, res) {
    try {
        return ok(res, { sources: getSources() });
    } catch (err) {
        return fail(res, err.message);
    }
}

// ─── POST /api/live/sources/url — { name, url } ───────────────────────────────
async function addUrlSource(req, res) {
    try {
        const { name, url } = req.body || {};
        if (!url || !url.trim()) return fail(res, "url is required", 400);

        // Accept even "Unknown" format — sniffFormat resolves it after fetch
        const format = detectFormat(url);

        const source = {
            id: newSourceId(),
            name: (name || "").trim() || "Untitled Source",
            type: "url",
            // Keep "Unknown" when detectFormat can't tell from URL alone —
            // sniffFormat() inside ingestSource() will detect from content.
            format: format !== "Unknown" ? format : "Unknown",
            location: url.trim(),
            status: "pending",
            date: new Date().toISOString(),
            channelCount: 0,
            error: null,
        };
        await saveSource(source);
        ingestInBackground(source); // fire-and-forget
        return ok(res, { source }, 201);
    } catch (err) {
        console.error("[IPTV] addUrlSource error:", err);
        return fail(res, err.message);
    }
}

// ─── POST /api/live/sources/upload — multipart "file" ─────────────────────────
// Root-cause note: if multer fileFilter rejects, it calls next(err) —
// Express catches that in the error handler below, not here. We wrap the
// entire fn so any residual throw still returns JSON, never HTML.
async function addUploadSource(req, res) {
    try {
        // multer stores nothing on req.file if Content-Type wasn't multipart —
        // happens when axios default "application/json" header isn't cleared.
        // Fixed on frontend (Content-Type: undefined). Belt + suspenders here:
        if (!req.file) {
            return fail(res, 'No file received. Ensure the request uses multipart/form-data and the field name is "file".', 400);
        }

        const ext = path.extname(req.file.originalname).toLowerCase();
        const format = detectFormat(req.file.originalname);
        const name = (req.body?.name || "").trim() || req.file.originalname;

        const source = {
            id: newSourceId(),
            name,
            type: "file",
            // Keep "Unknown" — sniffFormat() reads content at ingest time
            // so .yml/.yaml/.xml files aren't silently mis-parsed as M3U.
            format: format !== "Unknown" ? format : "Unknown",
            location: req.file.originalname,
            filePath: req.file.path,
            status: "pending",
            date: new Date().toISOString(),
            channelCount: 0,
            error: null,
        };
        await saveSource(source);

        let content;
        try {
            content = await fs.promises.readFile(req.file.path, "utf-8");
        } catch (readErr) {
            await updateSource(source.id, { status: "error", error: `Could not read file: ${readErr.message}` });
            return fail(res, `File saved but could not be read: ${readErr.message}`, 500);
        }

        const updated = await ingestSource(source, content);
        return ok(res, { source: updated }, 201);
    } catch (err) {
        console.error("[IPTV] addUploadSource error:", err);
        return fail(res, err.message);
    }
}

// ─── PATCH /api/live/sources/:id — { name?, url? } ────────────────────────────
async function editSource(req, res) {
    try {
        const { id } = req.params;
        const { name, url } = req.body || {};
        const source = getSources().find((s) => s.id === id);
        if (!source) return fail(res, "Source not found", 404);

        const patch = {};
        if (name !== undefined && name.trim()) patch.name = name.trim();

        const urlChanged = source.type === "url" && url !== undefined && url.trim() && url.trim() !== source.location;
        if (urlChanged) {
            patch.location = url.trim();
            const f = detectFormat(url.trim());
            patch.format = f !== "Unknown" ? f : "Unknown";
        }

        let updated = await updateSource(id, patch);

        // Location changed on a url source — re-ingest so channels reflect the new playlist
        if (urlChanged) {
            updated = await updateSource(id, { status: "pending", error: null });
            ingestInBackground(updated);
        }

        return ok(res, { source: updated });
    } catch (err) {
        console.error("[IPTV] editSource error:", err);
        return fail(res, err.message);
    }
}

// ─── POST /api/live/sources/:id/refresh ──────────────────────────────────────
async function refreshSource(req, res) {
    try {
        const { id } = req.params;
        const source = getSources().find((s) => s.id === id);
        if (!source) return fail(res, "Source not found", 404);

        if (source.type === "url") {
            const pending = await updateSource(id, { status: "pending", error: null });
            ingestInBackground(pending);
            return ok(res, { source: pending });
        }

        let content;
        try {
            content = await fs.promises.readFile(source.filePath, "utf-8");
        } catch (err) {
            return fail(res, `Cannot read source file: ${err.message}`, 500);
        }
        const updated = await ingestSource(source, content);
        return ok(res, { source: updated });
    } catch (err) {
        console.error("[IPTV] refreshSource error:", err);
        return fail(res, err.message);
    }
}

// ─── DELETE /api/live/sources/:id ─────────────────────────────────────────────
async function removeSource(req, res) {
    try {
        const { id } = req.params;
        const deleted = await deleteSource(id);
        if (!deleted) return fail(res, "Source not found", 404);
        await removeChannelsForSource(id);
        return ok(res, { id, message: "Source removed" });
    } catch (err) {
        console.error("[IPTV] removeSource error:", err);
        return fail(res, err.message);
    }
}

// ─── In-memory flat-channel cache: active_live.json ───────────────────────────
// Deliberately a SEPARATE cache + separate source file from buildFlatRows()
// below. Active Only reads straight from active_live.json (already-final
// snapshots, curated via the Star button / Active-tab CRUD) — it does NOT
// filter live.json rows by an id set. All Channel reads straight from
// live.json via buildFlatRows(). Two independent files, two independent
// code paths — deleting a source only ever touches live.json's cache.
let _activeFlatCache = null; // { builtFromDate, rows: [...] }

function buildActiveFlatRows() {
    const active = getActiveLive();
    if (_activeFlatCache && _activeFlatCache.builtFromDate === active.date) return _activeFlatCache.rows;

    const rows = [];
    let globalIndex = 0;

    for (const [group, list] of Object.entries(active.channels || {})) {
        for (const ch of list) {
            rows.push({
                id: ch.id || Buffer.from(ch.url).toString("base64url"),
                index: globalIndex++,
                name: ch.name,
                logo: ch.logo,
                group: ch.group !== undefined && ch.group !== null ? ch.group : group,
                category: ch.category || null,
                country: ch.country || null,
                language: ch.language || null,
                resolution: ch.resolution || null,
                isHD: !!ch.isHD,
                source: ch.source,
                url: ch.url,
                streamStatus: ch.streamStatus || "unknown",
                httpCode: ch.httpCode ?? null,
                lastChecked: ch.lastChecked || null,
                activatedAt: ch.activatedAt || null,
            });
        }
    }

    // Default order: oldest-marked-active first (ascending activatedAt) —
    // matches the Active tab's own ordering.
    rows.sort((a, b) => new Date(a.activatedAt || 0) - new Date(b.activatedAt || 0));

    _activeFlatCache = { builtFromDate: active.date, rows };
    return rows;
}

// ─── In-memory flat-channel cache: live.json ──────────────────────────────────
// Root cause of the frontend freeze: this endpoint used to dump all 2700+
// channels on every single request (no pagination, no filtering at all), so
// the player had to download + render the entire dataset before anything
// was interactive, and re-did that full download on every keystroke / every
// page revisit.
//
// Fix: flatten live.json once per change (cheap — plain object iteration)
// and cache the result; every request then filters/sorts/slices the cached
// array instead of re-flattening + sending everything every time.
let _flatCache = null; // { builtFromDate, rows: [...] }

function buildFlatRows() {
    const rich = getPublicLiveRich();
    if (_flatCache && _flatCache.builtFromDate === rich.date) return _flatCache.rows;

    const rows = [];
    let globalIndex = 0; // Initialize index counter starting from 0

    for (const [group, list] of Object.entries(rich.channels || {})) {
        for (const ch of list) {
            rows.push({
                // Stable id derived from the stream URL
                id: Buffer.from(ch.url).toString("base64url"),
                index: globalIndex++, // Assign sequential index
                name: ch.name,
                logo: ch.logo,
                group: ch.group !== undefined && ch.group !== null ? ch.group : group,
                category: ch.category || null,
                country: ch.country || null,
                language: ch.language || null,
                resolution: ch.resolution || null, // "4K" | "1080p" | "720p" | "576p" | "480p" | "360p" | "240p" | "SD" | null
                isHD: !!ch.isHD,
                source: ch.source,
                url: ch.url,
                // Written by the bulk stream-health checker (runBulkStreamCheck) —
                // "working" | "offline" | "timeout" | "unknown" (unprobed / non-HTTP).
                // Was previously dropped here, so /api/live/channels?workingOnly=true
                // had nothing to actually filter on.
                streamStatus: ch.streamStatus || "unknown",
                httpCode: ch.httpCode ?? null,
                lastChecked: ch.lastChecked || null,
            });
        }
    }

    // REMOVED: rows.sort(...) alphabetical sorting has been disabled
    // to preserve the original structural index order.

    _flatCache = { builtFromDate: rich.date, rows };
    return rows;
}

// ─── GET /api/live/channels — player-facing, now ACTUALLY paginated ──────────
// Query: q, category, page (default 1), limit (default 24, max 100)
function getChannels(req, res) {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 24));
        const q = (req.query.q || "").toLowerCase().trim();
        const category = (req.query.category || "").toLowerCase().trim();
        const workingOnly = req.query.workingOnly === "true" || req.query.workingOnly === "1";
        const quality = (req.query.quality || "").trim(); // "4K" | "1080p" | "720p" | "SD"
        const country = (req.query.country || "").toLowerCase().trim();
        const language = (req.query.language || "").toLowerCase().trim();
        // ?all=true → "All Channel": every parsed channel, straight from
        // live.json (buildFlatRows). Default → "Active Only": straight from
        // active_live.json (buildActiveFlatRows) — a genuinely separate file
        // and cache, not a filter over live.json by id. Deleting a source
        // only ever rewrites live.json, so it can never affect this branch.
        const showAll = req.query.all === "true" || req.query.all === "1";

        let rows = showAll ? channelStateStore.applyChannelState(buildFlatRows()) : buildActiveFlatRows();

        if (q) {
            rows = rows.filter((c) => (c.name || "").toLowerCase().includes(q) || (c.group || "").toLowerCase().includes(q) || (c.category || "").toLowerCase().includes(q));
        }
        if (category) {
            rows = rows.filter((c) => (c.category || "").toLowerCase() === category);
        }
        if (workingOnly) {
            // Strictly "confirmed working" — excludes offline, timeout, AND
            // unknown/unprobed. A channel that's never been health-checked
            // yet doesn't get the benefit of the doubt here; it'll show up
            // once the bulk checker (or the next scheduled run) confirms it.
            rows = rows.filter((c) => c.streamStatus === "working");
        }
        if (quality) {
            if (quality.toUpperCase() === "SD") {
                // "SD" is a bucket, not one exact label — anything explicitly
                // tagged low-res AND not flagged HD counts as SD.
                rows = rows.filter((c) => c.resolution && !c.isHD);
            } else {
                rows = rows.filter((c) => (c.resolution || "").toLowerCase() === quality.toLowerCase());
            }
        }
        if (country) {
            rows = rows.filter((c) => (c.country || "").toLowerCase() === country);
        }
        if (language) {
            rows = rows.filter((c) => (c.language || "").toLowerCase() === language);
        }

        const totalItems = rows.length;
        const totalPages = Math.max(1, Math.ceil(totalItems / limit));
        const safePage = Math.min(page, totalPages);
        const channels = rows.slice((safePage - 1) * limit, safePage * limit);

        return res.json({
            channels,
            total: totalItems,
            page: safePage,
            limit,
            totalPages,
        });
    } catch (err) {
        console.error("[IPTV] getChannels error:", err);
        return fail(res, err.message);
    }
}

// ─── GET /api/live/categories — distinct categories + counts ────────────────
// Was missing entirely — the frontend called it but got a 404 that it
// silently swallowed, so the category tabs on the Live page never had
// anything real to show.
function getCategoriesList(req, res) {
    try {
        const rows = channelStateStore.applyChannelState(buildFlatRows());
        const counts = new Map();
        for (const c of rows) {
            const name = c.category || "Uncategorized";
            counts.set(name, (counts.get(name) || 0) + 1);
        }
        const categories = [...counts.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
        return res.json({ categories });
    } catch (err) {
        console.error("[IPTV] getCategoriesList error:", err);
        return fail(res, err.message);
    }
}

// ─── GET /api/live/channels/flat — admin dashboard, paginated ─────────────────
function getChannelsFlat(req, res) {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
        const q = (req.query.q || "").toLowerCase().trim();
        const category = (req.query.category || "").toLowerCase().trim();

        // 1. "status" sort auto-surfaces channels that are confirmed playable
        // (no 404/503/timeout) at the top — this is the "auto detect active
        // channel" the admin uses to pick candidates before hitting the Star
        // (Mark Active) button. Falls back to "index" when not requested.
        const sort = ["index", "name", "country", "category", "group", "status"].includes(req.query.sort) ? req.query.sort : "index";
        const order = req.query.order === "desc" ? -1 : 1;
        const STATUS_RANK = { working: 0, unknown: 1, timeout: 2, offline: 3 };

        let flat = channelStateStore.applyChannelState(buildFlatRows());

        if (q) {
            flat = flat.filter(
                (c) =>
                    (c.name || "").toLowerCase().includes(q) ||
                    (c.country || "").toLowerCase().includes(q) ||
                    (c.group || "").toLowerCase().includes(q) ||
                    (c.category || "").toLowerCase().includes(q),
            );
        }
        if (category) {
            flat = flat.filter((c) => (c.category || "").toLowerCase() === category);
        }

        // 2. Handle numeric sorting for 'index' vs string sorting for other fields
        flat.sort((a, b) => {
            if (sort === "index") {
                return (a.index - b.index) * order;
            }
            if (sort === "status") {
                const ra = STATUS_RANK[a.streamStatus] ?? 1;
                const rb = STATUS_RANK[b.streamStatus] ?? 1;
                if (ra !== rb) return (ra - rb) * order;
                return a.index - b.index; // stable tiebreak, ignores order flip on purpose
            }
            const av = (a[sort] || "").toLowerCase();
            const bv = (b[sort] || "").toLowerCase();
            return av < bv ? -order : av > bv ? order : 0;
        });

        const totalItems = flat.length;
        const totalPages = Math.ceil(totalItems / limit) || 1;
        const safePage = Math.min(page, totalPages);
        const channels = flat.slice((safePage - 1) * limit, safePage * limit);

        return ok(res, {
            channels,
            pagination: {
                page: safePage,
                limit,
                totalItems,
                totalPages,
                hasNext: safePage < totalPages,
                hasPrevious: safePage > 1,
            },
        });
    } catch (err) {
        console.error("[IPTV] getChannelsFlat error:", err);
        return fail(res, err.message);
    }
}

// ─── GET /api/live/check?url= — per-stream status probe ──────────────────────
async function checkStreamStatus(req, res) {
    const { url } = req.query;
    if (!url || !url.trim()) return fail(res, "url is required", 400);

    async function attempt(method) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8_000);
        try {
            const headers = { ...BROWSER_HEADERS, ...(method === "GET" ? { Range: "bytes=0-1024" } : {}) };
            return await fetch(url, { method, headers, signal: controller.signal, redirect: "follow" });
        } finally {
            clearTimeout(timer);
        }
    }

    try {
        let r;
        try {
            r = await attempt("HEAD");
            if (r.status === 405 || r.status === 501) r = await attempt("GET");
        } catch {
            r = await attempt("GET");
        }

        const status = r.ok || r.status === 206 ? "working" : "offline";
        r.body?.cancel?.().catch(() => {}); // never leave the body unread/unclosed
        return ok(res, { status, code: r.status });
    } catch (err) {
        const status = err.name === "AbortError" ? "timeout" : "offline";
        return ok(res, { status, error: err.message });
    }
}

// ─── Bulk stream health checker ───────────────────────────────────────────────
// Probes every channel URL in live.json concurrently (bounded pool) and writes
// streamStatus + lastChecked back into each channel record.
//
// streamStatus values:
//   "working"  — HTTP 2xx or 206
//   "offline"  — got a response but non-2xx / non-206
//   "timeout"  — no response within PROBE_TIMEOUT_MS
//   "unknown"  — not yet probed (default on first ingest)
//
// Probe is HEAD first (fast, no body), falls back to GET with Range header
// when server returns 405/501 (common for HLS/IPTV servers).
// RTMP / SRT / UDP streams can't be HTTP-probed → marked "unknown".

const PROBE_TIMEOUT_MS = 7_000;
// Was a hardcoded 20 — for a large playlist that's 20 concurrent open
// sockets/response buffers at once, plus a big write-back afterward (see
// merge fix below). Lowering the default eases memory/fd pressure on small
// NAS/CasaOS boxes; override with PROBE_CONCURRENCY env if you want it back up.
const PROBE_CONCURRENCY = parseInt(process.env.PROBE_CONCURRENCY || "10", 10);

let _bulkCheckRunning = false; // prevent concurrent full-scan jobs

async function probeUrl(url) {
    // Non-HTTP protocols can't be probed via fetch
    const lower = (url || "").toLowerCase();
    if (/^(rtmp|rtmps|rtsp|udp|rtp|srt):\/\//.test(lower)) {
        return { streamStatus: "unknown", httpCode: null };
    }

    async function tryFetch(method) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
        try {
            const headers = {
                ...BROWSER_HEADERS,
                ...(method === "GET" ? { Range: "bytes=0-1023" } : {}),
            };
            return await fetch(url, { method, headers, signal: ctrl.signal, redirect: "follow" });
        } finally {
            clearTimeout(timer);
        }
    }

    try {
        let r;
        try {
            r = await tryFetch("HEAD");
            if (r.status === 405 || r.status === 501) r = await tryFetch("GET");
        } catch {
            r = await tryFetch("GET");
        }
        const streamStatus = r.ok || r.status === 206 ? "working" : "offline";
        r.body?.cancel?.().catch(() => {});
        return { streamStatus, httpCode: r.status };
    } catch (err) {
        const streamStatus = err.name === "AbortError" ? "timeout" : "offline";
        return { streamStatus, httpCode: null };
    }
}

// Runs a bounded concurrent probe of all channels in live.json.
// Writes streamStatus + lastChecked back via writeLive (queue-safe atomic write).
// Returns a summary: { total, working, offline, timeout, unknown, durationMs }
async function runBulkStreamCheck() {
    if (_bulkCheckRunning) {
        console.log("[IPTV] bulk check already running — skipping");
        return null;
    }
    _bulkCheckRunning = true;
    const startMs = Date.now();
    console.log("[IPTV] Starting bulk stream health check...");

    try {
        const live = getLive();
        const grouped = live.channels || {};

        // Flatten all channels to a work list
        const tasks = [];
        for (const [group, list] of Object.entries(grouped)) {
            for (let i = 0; i < list.length; i++) {
                tasks.push({ group, index: i, url: list[i].url });
            }
        }

        if (tasks.length === 0) {
            _bulkCheckRunning = false;
            return { total: 0, working: 0, offline: 0, timeout: 0, unknown: 0, durationMs: 0 };
        }

        const results = new Array(tasks.length);
        let cursor = 0;

        // Bounded concurrent pool — PROBE_CONCURRENCY workers drain task queue
        async function worker() {
            while (true) {
                const idx = cursor++;
                if (idx >= tasks.length) break;
                results[idx] = await probeUrl(tasks[idx].url);
            }
        }
        await Promise.all(Array.from({ length: PROBE_CONCURRENCY }, worker));

        // Merge probe results back into the grouped structure in ONE pass —
        // previously this deep-cloned every channel once (list.map(...)) then
        // overwrote each entry again in a second loop, so every channel was
        // copied twice right before a JSON.stringify write. For a large
        // playlist that's real peak-memory pressure on a small box. Build a
        // group|index → result lookup once, then produce each channel's
        // final shape in a single map pass.
        const resultByKey = new Map();
        for (let i = 0; i < tasks.length; i++) {
            resultByKey.set(`${tasks[i].group}\u0000${tasks[i].index}`, results[i]);
        }
        const checkedAt = new Date().toISOString();
        const updatedGrouped = {};
        for (const [group, list] of Object.entries(grouped)) {
            updatedGrouped[group] = list.map((ch, index) => {
                const r = resultByKey.get(`${group}\u0000${index}`);
                if (!r) return ch; // shouldn't happen — no probe result for this slot
                return { ...ch, streamStatus: r.streamStatus, httpCode: r.httpCode, lastChecked: checkedAt };
            });
        }

        // Atomic write through the store's serialised queue
        await writeLive({ date: live.date, channels: updatedGrouped });

        // The write above intentionally reuses the OLD live.date (this is a
        // health-check update, not a content change), so buildFlatRows()'s
        // date-based cache check would never notice this write happened and
        // would keep serving pre-check streamStatus/httpCode/lastChecked
        // values indefinitely. Force a rebuild on next read instead —
        // unrelated requests (ingest/source edits, which DO bump the date)
        // are unaffected by this and keep using the existing cache exactly
        // as before.
        _flatCache = null;

        const summary = {
            total: tasks.length,
            working: 0,
            offline: 0,
            timeout: 0,
            unknown: 0,
            durationMs: Date.now() - startMs,
        };
        for (const r of results) {
            const s = r?.streamStatus || "unknown";
            if (s in summary) summary[s]++;
        }
        console.log(`[IPTV] Bulk check done in ${summary.durationMs}ms —`, summary);
        return summary;
    } catch (err) {
        console.error("[IPTV] runBulkStreamCheck failed:", err.message);
        return null;
    } finally {
        _bulkCheckRunning = false;
    }
}

// ─── POST /api/live/check/bulk — start background bulk check ─────────────────
async function startBulkCheck(req, res) {
    if (_bulkCheckRunning) {
        return ok(res, { status: "already_running", message: "Bulk check already in progress" });
    }
    // Fire and forget — respond immediately with accepted
    runBulkStreamCheck().catch((err) => console.error("[IPTV] bulk check failed:", err.message));
    return ok(res, { status: "started", message: "Bulk stream health check started in background" }, 202);
}

// ─── GET /api/live/check/status — bulk check progress / summary ──────────────
function getBulkCheckStatus(req, res) {
    return ok(res, { running: _bulkCheckRunning });
}

// ─── POST /api/live/iptvorg/refresh — force re-download iptv-org DB ──────────
async function refreshIptvOrgDb(req, res) {
    try {
        await iptvOrgDb.ensureLoaded(true);
        return ok(res, { message: "iptv-org database refreshed" });
    } catch (err) {
        console.error("[IPTV] refreshIptvOrgDb error:", err);
        return fail(res, `iptv-org refresh failed: ${err.message}`);
    }
}

// ─── Channel state — Active / Edit / Delete (DashIPTV.jsx) ───────────────────
// Backed by channelStateStore.js (server/data/channel-state.json). Channel
// rows themselves are still derived from parsed playlists — this only stores
// the small admin overlay (active pin, name/category/country override, hidden).

// GET /api/live/channel-state — raw state, mostly for debugging/admin UI init
function getChannelState(req, res) {
    try {
        return ok(res, channelStateStore.getState());
    } catch (err) {
        return fail(res, err.message);
    }
}

// GET /api/live/channels/active — reads directly from active_live.json (not
// derived from live.json + overrides anymore) — sorted ascending by
// activatedAt (oldest-marked-active first), per requirement.
function getActiveChannels(req, res) {
    try {
        const live = getActiveLive();
        const channels = [];
        for (const group of Object.values(live.channels || {})) channels.push(...group);
        channels.sort((a, b) => new Date(a.activatedAt || 0) - new Date(b.activatedAt || 0));
        return ok(res, { channels, date: live.date });
    } catch (err) {
        console.error("[IPTV] getActiveChannels error:", err);
        return fail(res, err.message);
    }
}

// POST /api/live/channels/:id/active — body is the channel object snapshot to pin
function markChannelActive(req, res) {
    try {
        const { id } = req.params;
        if (!channelStateStore.isValidId(id)) return fail(res, "Invalid channel id", 400);
        const snapshot = req.body && typeof req.body === "object" ? req.body : {};
        const saved = channelStateStore.setActive(id, snapshot);
        return ok(res, { channel: saved }, 201);
    } catch (err) {
        console.error("[IPTV] markChannelActive error:", err);
        return fail(res, err.message);
    }
}

// DELETE /api/live/channels/:id/active — unpin from Active tab
// DELETE /api/live/channels/:id/active — unpin from Active tab
function unmarkChannelActive(req, res) {
    try {
        const { id } = req.params;
        if (!channelStateStore.isValidId(id)) return fail(res, "Invalid channel id", 400);
        const removed = channelStateStore.unsetActive(id);
        if (!removed) return fail(res, "Channel was not marked active", 404);
        // Best-effort cleanup — channel going inactive means its imgbb-hosted
        // logo (if any) is no longer needed anywhere.
        if (removed.logoDeleteUrl) deleteFromImgbb(removed.logoDeleteUrl);
        return ok(res, { id, message: "Removed from Active" });
    } catch (err) {
        console.error("[IPTV] unmarkChannelActive error:", err);
        return fail(res, err.message);
    }
}

// PATCH /api/live/active/:id — full CRUD on an Active-tab entry: name, logo,
// category, country, group, url — anything. Deliberately separate from
// updateChannel() below, which patches the main list (live.json-derived)
// via overrides. This only ever writes active_live.json.
function updateActiveChannelDetails(req, res) {
    try {
        const { id } = req.params;
        if (!channelStateStore.isValidId(id)) return fail(res, "Invalid channel id", 400);
        const body = req.body && typeof req.body === "object" ? req.body : {};
        const patch = {};
        for (const key of ["name", "logo", "category", "country", "group", "url", "language", "resolution"]) {
            if (body[key] === undefined) continue;
            patch[key] = typeof body[key] === "string" ? body[key].trim() : body[key];
        }
        if (Object.keys(patch).length === 0) return fail(res, "Nothing to update", 400);

        // Logo is being changed by hand (typed/pasted URL, not the imgbb
        // upload button) — if the old logo was an imgbb upload, clean it up,
        // and drop the now-stale delete token since the new value isn't ours.
        const before = channelStateStore.getState().active[id];
        if (patch.logo !== undefined && before && patch.logo !== before.logo) {
            if (before.logoDeleteUrl) deleteFromImgbb(before.logoDeleteUrl);
            patch.logoDeleteUrl = null;
        }

        const updated = channelStateStore.updateActiveChannel(id, patch);
        if (!updated) return fail(res, "Channel not found in Active list", 404);
        return ok(res, { channel: updated });
    } catch (err) {
        console.error("[IPTV] updateActiveChannelDetails error:", err);
        return fail(res, err.message);
    }
}

// ─── imgbb logo upload/cleanup ──────────────────────────────────────────────
const IMGBB_UPLOAD_URL = "https://api.imgbb.com/1/upload";

async function uploadToImgbb(buffer, filename) {
    const apiKey = process.env.IMGBB_API_KEY;
    if (!apiKey) throw new Error("IMGBB_API_KEY is not set in .env");

    const form = new FormData();
    form.append("image", new Blob([buffer]), filename || "logo.png");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let res;
    try {
        res = await fetch(`${IMGBB_UPLOAD_URL}?key=${apiKey}`, { method: "POST", body: form, signal: controller.signal });
    } catch (err) {
        if (err.name === "AbortError") throw new Error("imgbb upload timed out");
        throw err;
    } finally {
        clearTimeout(timer);
    }
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`imgbb ${res.status}: ${body.slice(0, 150)}`);
    }
    const data = await res.json();
    if (!data?.success || !data?.data?.url) throw new Error("imgbb upload did not return a URL");
    // delete_url is imgbb's own deletion token for this specific upload —
    // stash it so we can clean up later without needing an API key-based
    // delete endpoint (imgbb's public API doesn't have one).
    return { url: data.data.url, deleteUrl: data.data.delete_url || null };
}

// Best-effort — imgbb's delete_url is a plain GET link, not a documented
// guaranteed API contract. Never let a failure here affect the caller;
// just log and move on.
async function deleteFromImgbb(deleteUrl) {
    if (!deleteUrl) return;
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        try {
            await fetch(deleteUrl, { method: "GET", signal: controller.signal });
        } finally {
            clearTimeout(timer);
        }
    } catch (err) {
        console.warn("[IPTV] imgbb delete failed (best-effort, ignoring):", err.message);
    }
}

// POST /api/live/active/:id/logo — multipart field "logo" — uploads to imgbb,
// deletes the PREVIOUS imgbb logo (if any) for this channel, then saves the
// new URL. active_live.json only.
async function uploadActiveLogo(req, res) {
    try {
        const { id } = req.params;
        if (!channelStateStore.isValidId(id)) return fail(res, "Invalid channel id", 400);
        if (!req.file) return fail(res, 'Logo file is required (multipart field name: "logo")', 400);

        const before = channelStateStore.getState().active[id];
        const { url, deleteUrl } = await uploadToImgbb(req.file.buffer, req.file.originalname);
        const updated = channelStateStore.updateActiveChannel(id, { logo: url, logoDeleteUrl: deleteUrl });
        if (!updated) return fail(res, "Channel not found in Active list", 404);

        if (before?.logoDeleteUrl) deleteFromImgbb(before.logoDeleteUrl); // old image cleanup, fire-and-forget
        return ok(res, { logo: url, channel: updated });
    } catch (err) {
        console.error("[IPTV] uploadActiveLogo error:", err);
        return fail(res, err.message || "Logo upload failed");
    }
}

// PATCH /api/live/channels/:id — body: { name?, category?, country? }
function updateChannel(req, res) {
    try {
        const { id } = req.params;
        if (!channelStateStore.isValidId(id)) return fail(res, "Invalid channel id", 400);
        const { name, category, country } = req.body || {};
        const patch = {};
        if (name !== undefined && name.trim()) patch.name = name.trim();
        if (category !== undefined) patch.category = category.trim();
        if (country !== undefined) patch.country = country.trim();
        if (Object.keys(patch).length === 0) return fail(res, "Nothing to update", 400);
        const saved = channelStateStore.setOverride(id, patch);
        return ok(res, { override: saved });
    } catch (err) {
        console.error("[IPTV] updateChannel error:", err);
        return fail(res, err.message);
    }
}

// DELETE /api/live/channels/:id — hide channel everywhere (player + dashboard)
function deleteChannel(req, res) {
    try {
        const { id } = req.params;
        if (!channelStateStore.isValidId(id)) return fail(res, "Invalid channel id", 400);
        channelStateStore.setHidden(id);
        return ok(res, { id, message: "Channel hidden" });
    } catch (err) {
        console.error("[IPTV] deleteChannel error:", err);
        return fail(res, err.message);
    }
}

// POST /api/live/channels/:id/restore — undo a hide
function restoreChannel(req, res) {
    try {
        const { id } = req.params;
        if (!channelStateStore.isValidId(id)) return fail(res, "Invalid channel id", 400);
        const restored = channelStateStore.unsetHidden(id);
        if (!restored) return fail(res, "Channel was not hidden", 404);
        return ok(res, { id, message: "Channel restored" });
    } catch (err) {
        console.error("[IPTV] restoreChannel error:", err);
        return fail(res, err.message);
    }
}

// ─── Periodic auto health-check ────────────────────────────────────────────
// Keeps streamStatus fresh (so status-sort / 404-503 detection stays accurate)
// without the admin needing to press "recheck" manually. Guarded per learned
// pattern (EPG scheduler) — an error inside the interval must never crash
// the process or stop future ticks.
const AUTO_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 min
setInterval(() => {
    try {
        runBulkStreamCheck().catch((err) => console.warn("[IPTV] scheduled bulk check failed:", err.message));
    } catch (err) {
        console.warn("[IPTV] scheduled bulk check threw synchronously:", err.message);
    }
}, AUTO_CHECK_INTERVAL_MS).unref();

module.exports = {
    listSources,
    addUrlSource,
    addUploadSource,
    editSource,
    refreshSource,
    removeSource,
    getChannels,
    getCategoriesList,
    getChannelsFlat,
    checkStreamStatus,
    startBulkCheck,
    getBulkCheckStatus,
    refreshIptvOrgDb,
    // Channel state — Active/Edit/Delete
    getChannelState,
    getActiveChannels,
    markChannelActive,
    unmarkChannelActive,
    updateActiveChannelDetails,
    uploadActiveLogo,
    updateChannel,
    deleteChannel,
    restoreChannel,
};
