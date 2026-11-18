"use strict";

/**
 * controllers/streaming/shareController.js — short, player-friendly stream links.
 *
 *   POST   /stream/share/:id     (logged in)  create a link   → { code, urls: { direct, hls }, expiresAt }
 *   GET    /stream/share         (logged in)  my active links
 *   DELETE /stream/share/:code   (logged in)  revoke one
 *   GET/HEAD /s/:code[/name.ext]              the link itself — raw file with Range support (VLC, MX Player, mpv…)
 *   GET/HEAD /s/:code/h/stream.m3u8           the same movie as HLS (server transcodes on first request)
 *   GET/HEAD /s/:code/h/<segment|playlist>    HLS parts, relative to the playlist
 *
 * A link is a row in the existing StreamToken table whose token is a 12-char code and whose sessionId is null
 * — the same capability the player's own ?st= tokens are, only longer-lived and shorter to type. Every request
 * runs through the normal requirePlaybackAccess + requireMediaAccess chain, so blocked/expired users, revoked
 * library access and wrong media are refused exactly as for the web player. NOTHING in the transcoder or the
 * streaming engine is modified: HLS uses their exported startTranscode / serveHLSFile as they are.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const mime = require("mime-types");

const prisma = require("../../auth/prismaClient");
const mediaCache = require("../../utils/media/mediaCache");
const transcoderService = require("../../utils/streaming/transcoderService");
const { readFolders } = require("../media/libraryController");
const { startTranscode, serveHLSFile } = require("./streamController");
const { requirePlaybackAccess, requireMediaAccess } = require("../../auth/middleware/requirePlaybackAccess");
const { parseFilename } = require("../../metadata/nameParser");

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const CODE_LEN = 12;
const CODE_RE = /^[0-9A-Za-z]{12}$/;
const DEFAULT_TTL_H = 24;
const MAX_TTL_H = 720; // 30 days
const MAX_ACTIVE_PER_USER = 50;

const newCode = () => Array.from({ length: CODE_LEN }, () => ALPHABET[crypto.randomInt(62)]).join("");

// ── helpers ───────────────────────────────────────────────────────────────────────────────────────────────
async function resolveFile(id) {
    const hit = mediaCache.getFileById(id);
    if (hit) return hit;
    return mediaCache.findById(await readFolders(), id);
}

/**
 * A series / season / multi-part-movie id is not a file. Maps it to the file a player would start with:
 * first episode (lowest season, lowest episode) of the series or season, or the first part of a movie set.
 * Returns the file object or null. Never throws.
 */
async function resolveGroupToFile(id) {
    try {
        const { allMedia } = await mediaCache.getAllCached(await readFolders());
        const grouped = await mediaCache.getGroupedCached(allMedia);
        const firstOf = (seasons) => {
            for (const s of [...(seasons || [])].sort((a, b) => (a.seasonNumber ?? 99) - (b.seasonNumber ?? 99))) {
                const ep = [...(s.episodes || [])].sort((a, b) => (a.episode ?? 99) - (b.episode ?? 99))[0];
                if (ep) return ep.id;
            }
            return null;
        };
        let fileId = null;
        for (const g of [...(grouped.series || []), ...(grouped.anime || [])]) {
            if (g.id === id) { fileId = firstOf(g.seasons); break; }
            const season = (g.seasons || []).find((s) => s.id === id);
            if (season) { fileId = firstOf([season]); break; }
        }
        if (!fileId) {
            const part = (grouped.movies || []).filter((m) => m.partId === id).sort((a, b) => (a.parsed?.part ?? 0) - (b.parsed?.part ?? 0))[0];
            if (part) fileId = part.id;
        }
        return fileId ? await resolveFile(fileId) : null;
    } catch {
        return null;
    }
}

/** Router middleware: if :id is a series/season/part id, swap in the episode file id BEFORE requireMediaAccess runs,
 *  so the library/restriction check is made against the file that will really be shared. */
async function resolveGroupParam(req, _res, next) {
    try {
        const id = req.params.id;
        if (id && !(await resolveFile(id))) {
            const file = await resolveGroupToFile(id);
            if (file) req.params.id = file.id;
        }
    } catch {
        /* leave the id as is → createShare answers 404 */
    }
    next();
}

function lanIp() {
    const pref = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/;
    let any = null;
    for (const list of Object.values(os.networkInterfaces())) {
        for (const i of list || []) {
            if (i.family !== "IPv4" || i.internal) continue;
            if (pref.test(i.address)) return i.address;
            any = any || i.address;
        }
    }
    return any;
}

/** Origin the link should point at: what the caller used to reach us; never "localhost" (useless on a phone). */
function baseUrl(req) {
    if (process.env.SHARE_BASE_URL) return process.env.SHARE_BASE_URL.replace(/\/+$/, "");
    const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0].trim();
    let host = String(req.headers["x-forwarded-host"] || req.get("host") || "").split(",")[0].trim();
    const name = host.replace(/:\d+$/, "");
    if (/^(localhost|127\.0\.0\.1|\[?::1\]?)$/i.test(name)) {
        const ip = lanIp();
        if (ip) host = host.replace(name, ip);
    }
    return `${proto}://${host}`;
}

function niceName(file) {
    const base = path.basename(file.path || file.name || "");
    const ext = path.extname(base);
    let label = "";
    try {
        const p = parseFilename(base);
        if (p && p.title) {
            label = p.title;
            if (p.year) label += ` (${p.year})`;
            if (p.season != null && p.episode != null) label += ` S${String(p.season).padStart(2, "0")}E${String(p.episode).padStart(2, "0")}`;
        }
    } catch {}
    if (!label) label = path.basename(base, ext);
    label = label.replace(/[<>:"/\\|?*%#\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "video";
    return { label, fileName: label + ext };
}

const isShareToken = (t) => t && typeof t.token === "string" && t.token.length === CODE_LEN && !t.sessionId;

// ── authenticated: create / list / revoke ──────────────────────────────────────────────────────────────────
async function createShare(req, res) {
    try {
        const id = req.params.id;
        const file = await resolveFile(id);
        if (!file) return res.status(404).json({ error: "Media not found" });

        const ttl = Math.min(MAX_TTL_H, Math.max(1, Number(req.body?.ttlHours) || DEFAULT_TTL_H));
        let expiresAt = new Date(Date.now() + ttl * 3600 * 1000);

        // keep the per-user list bounded: drop expired, then the oldest beyond the cap
        const mine = (await prisma.streamToken.findMany({ where: { userId: req.user.id, sessionId: null }, orderBy: { createdAt: "asc" } })).filter(isShareToken);
        const stale = mine.filter((t) => t.expiresAt < new Date());
        const live = mine.filter((t) => t.expiresAt >= new Date());
        const reuse = live.find((t) => t.mediaId === file.id && t.expiresAt.getTime() - Date.now() >= (Math.min(ttl, DEFAULT_TTL_H) * 3600 * 1000) / 2);
        const drop = [...stale, ...live.filter((t) => t !== reuse).slice(0, Math.max(0, live.length - (MAX_ACTIVE_PER_USER - 1)))];
        if (drop.length) await prisma.streamToken.deleteMany({ where: { id: { in: drop.map((t) => t.id) } } });

        let code = reuse ? reuse.token : null;
        for (let attempt = 0; !code && attempt < 5; attempt++) {
            code = newCode();
            try {
                await prisma.streamToken.create({ data: { userId: req.user.id, mediaId: file.id, token: code, expiresAt, sessionId: null } });
                break;
            } catch (err) {
                if (attempt === 4) throw err; // 12 random base-62 chars: a collision is practically impossible
            }
        }

        if (reuse) expiresAt = reuse.expiresAt;
        const base = baseUrl(req);
        const { label, fileName } = niceName(file);
        res.json({
            code,
            title: label,
            expiresAt: expiresAt.toISOString(),
            ttlHours: Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 3600000)),
            urls: {
                direct: `${base}/s/${code}/${encodeURIComponent(fileName)}`,
                hls: `${base}/s/${code}/h/stream.m3u8`,
            },
        });
    } catch (err) {
        console.error("[Share] create error:", err);
        if (!res.headersSent) res.status(500).json({ error: "Could not create share link" });
    }
}

async function listShares(req, res) {
    try {
        const rows = (await prisma.streamToken.findMany({ where: { userId: req.user.id, sessionId: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } })).filter(isShareToken);
        const base = baseUrl(req);
        res.json({
            shares: rows.map((t) => {
                const f = mediaCache.getFileById(t.mediaId);
                const { label, fileName } = f ? niceName(f) : { label: null, fileName: "video" };
                return { code: t.code || t.token, mediaId: t.mediaId, title: label, expiresAt: t.expiresAt, url: `${base}/s/${t.token}/${encodeURIComponent(fileName)}` };
            }),
        });
    } catch (err) {
        console.error("[Share] list error:", err);
        res.status(500).json({ error: "Could not list share links" });
    }
}

async function revokeShare(req, res) {
    try {
        const code = String(req.params.code || "");
        if (!CODE_RE.test(code)) return res.status(404).json({ error: "Not found" });
        const r = await prisma.streamToken.deleteMany({ where: { token: code, userId: req.user.id, sessionId: null } });
        hlsByCode.delete(code);
        if (!r.count) return res.status(404).json({ error: "Not found" });
        res.json({ ok: true });
    } catch (err) {
        console.error("[Share] revoke error:", err);
        res.status(500).json({ error: "Could not revoke" });
    }
}

// ── public: /s/:code[/...] ────────────────────────────────────────────────────────────────────────────────
// Runs an existing Express middleware and tells us whether it let the request through.
function runMiddleware(mw, req, res) {
    return new Promise((resolve) => {
        let passed = false;
        const next = (err) => {
            passed = !err;
            resolve(passed);
        };
        Promise.resolve(mw(req, res, next)).then(
            () => { if (!passed) resolve(false); },
            () => resolve(false),
        );
    });
}

function deny(res, status, text) {
    if (res.headersSent) return;
    res.status(status).type("text/plain").send(text);
}

/** Raw file with Range support. Same wire behaviour as the player's direct play, minus the decision logic. */
function sendFile(req, res, file) {
    const filePath = file.path;
    let stat;
    try {
        stat = fs.statSync(filePath);
    } catch {
        return deny(res, 404, "File not found");
    }
    const size = stat.size;
    const type = mime.lookup(filePath) || "application/octet-stream";
    const { fileName } = niceName(file);

    const common = {
        "Content-Type": type,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    };

    let start = 0;
    let end = size - 1;
    let partial = false;
    const range = req.headers.range;
    if (range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
        if (!m || (m[1] === "" && m[2] === "")) {
            res.writeHead(416, { ...common, "Content-Range": `bytes */${size}` });
            return res.end();
        }
        if (m[1] === "") {
            const n = parseInt(m[2], 10); // suffix range: last n bytes
            start = Math.max(0, size - n);
        } else {
            start = parseInt(m[1], 10);
            if (m[2] !== "") end = Math.min(parseInt(m[2], 10), size - 1);
        }
        if (start >= size || start > end) {
            res.writeHead(416, { ...common, "Content-Range": `bytes */${size}` });
            return res.end();
        }
        partial = true;
    }

    const length = end - start + 1;
    res.writeHead(partial ? 206 : 200, {
        ...common,
        "Content-Length": length,
        ...(partial ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
    });
    if (req.method === "HEAD") return res.end();

    const stream = fs.createReadStream(filePath, { start, end });
    stream.on("error", () => res.destroy());
    res.on("close", () => stream.destroy()); // player seeked / stopped
    stream.pipe(res);
}

// code → { sessionId, playlist }  — one HLS session per link, started on first request, reused after.
const hlsByCode = new Map();
const hlsStarting = new Map();

function captureRes() {
    return {
        statusCode: 200,
        body: undefined,
        headersSent: false,
        status(c) { this.statusCode = c; return this; },
        json(b) { this.body = b; return this; },
    };
}

async function ensureHls(code, mediaId) {
    const cur = hlsByCode.get(code);
    if (cur && transcoderService.getSession(cur.sessionId)) return cur;
    if (hlsStarting.has(code)) return hlsStarting.get(code);
    const job = (async () => {
        const cap = captureRes();
        await startTranscode({ params: { id: mediaId }, body: {} }, cap);
        if (cap.statusCode >= 400 || !cap.body?.sessionId) throw new Error(cap.body?.error || "Could not start HLS");
        const entry = { sessionId: cap.body.sessionId, playlist: path.posix.basename(cap.body.hlsUrl || "index.m3u8") };
        hlsByCode.set(code, entry);
        return entry;
    })();
    hlsStarting.set(code, job);
    try {
        return await job;
    } finally {
        hlsStarting.delete(code);
    }
}

async function servePublic(req, res) {
    try {
        const code = String(req.params.code || "");
        if (!CODE_RE.test(code)) return deny(res, 404, "Invalid link");

        const row = await prisma.streamToken.findUnique({ where: { token: code } });
        if (!row || row.sessionId || row.expiresAt < new Date()) {
            hlsByCode.delete(code);
            return deny(res, 410, "This link has expired or was revoked");
        }

        // The link IS the credential: feed it to the normal gates exactly as ?st= would be.
        req.headers["x-flux-stream-token"] = code;
        req.params.id = row.mediaId;
        if (!(await runMiddleware(requirePlaybackAccess, req, res))) return;
        if (!(await runMiddleware(requireMediaAccess, req, res))) return;

        const restParam = req.params.rest;
        const rest = (Array.isArray(restParam) ? restParam.join("/") : String(restParam ?? "")).replace(/^\/+/, "");

        if (rest === "h" || rest.startsWith("h/")) {
            const asset = rest.replace(/^h\/?/, "") || "stream.m3u8";
            const entry = await ensureHls(code, row.mediaId);
            req.params = { sessionId: entry.sessionId, file: asset === "stream.m3u8" ? entry.playlist : asset };
            return serveHLSFile(req, res);
        }

        const file = await resolveFile(row.mediaId);
        if (!file) return deny(res, 404, "Media not found");
        return sendFile(req, res, file);
    } catch (err) {
        console.error("[Share] serve error:", err.message);
        deny(res, 500, "Stream error");
    }
}

module.exports = { createShare, listShares, revokeShare, servePublic, resolveGroupParam, _sendFile: sendFile };
