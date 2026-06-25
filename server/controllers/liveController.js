"use strict";

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
    mergeChannelsForSource,
    removeChannelsForSource,
} = require("../utils/iptvStore");
const { parsePlaylist, detectFormat } = require("../utils/iptvParser");
const iptvOrgDb = require("../utils/iptvOrgDb");

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
        return updateSource(source.id, { status: "ready", channelCount: channels.length, error: null });
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
            format: format !== "Unknown" ? format : "M3U",
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
            format: format !== "Unknown" ? format : "M3U",
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
            patch.format = f !== "Unknown" ? f : "M3U";
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

// ─── In-memory flat-channel cache ─────────────────────────────────────────────
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
    for (const [group, list] of Object.entries(rich.channels || {})) {
        for (const ch of list) {
            rows.push({
                // Stable id derived from the stream URL — lets the frontend use
                // it as a React key / cache key without the backend needing to
                // track a separate id anywhere else.
                id: Buffer.from(ch.url).toString("base64url"),
                name: ch.name,
                logo: ch.logo,
                group: ch.group !== undefined && ch.group !== null ? ch.group : group,
                category: ch.category || null,
                country: ch.country || null,
                source: ch.source,
                url: ch.url,
            });
        }
    }
    rows.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

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

        let rows = buildFlatRows();

        if (q) {
            rows = rows.filter((c) => (c.name || "").toLowerCase().includes(q) || (c.group || "").toLowerCase().includes(q) || (c.category || "").toLowerCase().includes(q));
        }
        if (category) {
            rows = rows.filter((c) => (c.category || "").toLowerCase() === category);
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
        const rows = buildFlatRows();
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
        const sort = ["name", "country", "category", "group"].includes(req.query.sort) ? req.query.sort : "name";
        const order = req.query.order === "desc" ? -1 : 1;

        let flat = buildFlatRows().slice(); // copy — may re-sort by a different key below

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

        flat.sort((a, b) => {
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
        return ok(res, { status, code: r.status });
    } catch (err) {
        const status = err.name === "AbortError" ? "timeout" : "offline";
        return ok(res, { status, error: err.message });
    }
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
    refreshIptvOrgDb,
};
