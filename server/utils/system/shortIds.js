"use strict";

/**
 * utils/system/shortIds.js — short, stable aliases for the long media ids.
 *
 * A media id is base64url(file path) — or base64url("series:…"/"season:<base64>:1"/"part:…") for groups —
 * so it is 60–300 characters long. Its alias is a pure function of it: 9 characters [0-9A-Za-z].
 *   shortOf(longId)  — same result in the browser (web/src/Utils/shortId.js has the identical code)
 *   expand(short)    — short → long, via a registry that fills itself with every id this server has sent out
 *                      (and every file in the library cache), persisted in data/media/shortIds.json
 *
 * Nothing about the long ids changes: stored history/watchlist/progress keep using them. The alias is only
 * an address-bar / share-link convenience, and the server also understands it as an id in URL paths,
 * query strings and JSON bodies (see middleware()).
 */

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "..", "data", "media", "shortIds.json");
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const SHORT_LEN = 9;
const SHORT_RE = /^[0-9A-Za-z]{9}$/;

// ── hash: cyrb53 (53 bits) → base62, 9 chars. IDENTICAL code lives in web/src/Utils/shortId.js ──────────────
function cyrb53(str) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
function toBase62(n) {
    let s = "";
    for (let i = 0; i < SHORT_LEN; i++) {
        s = ALPHABET[n % 62] + s;
        n = Math.floor(n / 62);
    }
    return s;
}
function shortOf(longId) {
    return toBase62(cyrb53(String(longId)));
}

// ── what counts as a media id (so unrelated strings are never registered) ───────────────────────────────────
const NOT_MEDIA = /^(?:https?|rtmp|rtsp|udp|mms|file|data):/i;
function isMediaId(s) {
    if (typeof s !== "string" || s.length < 11 || !/^[A-Za-z0-9_-]+$/.test(s)) return false;
    let text;
    try {
        text = Buffer.from(s, "base64url").toString("utf8");
    } catch {
        return false;
    }
    if (text.length < 3 || /[\u0000-\u001f\ufffd]/.test(text)) return false;
    if (NOT_MEDIA.test(text)) return false; // live-channel ids are base64url(url) — not shortened
    return /^(?:[A-Za-z]:[\\/]|\/|[a-z]+:)/.test(text);
}
const isShortId = (s) => typeof s === "string" && SHORT_RE.test(s);

// ── registry ─────────────────────────────────────────────────────────────────────────────────────────────
const toLong = new Map(); // short → long
const seen = new Map(); // long → true/false (isMediaId memo, bounded)
let dirty = false;
let timer = null;

function load() {
    try {
        const obj = JSON.parse(fs.readFileSync(FILE, "utf8"));
        for (const [s, l] of Object.entries(obj)) if (isShortId(s) && typeof l === "string") toLong.set(s, l);
    } catch {
        /* first run / unreadable → starts empty and refills */
    }
}
function scheduleSave() {
    dirty = true;
    if (timer) return;
    timer = setTimeout(() => {
        timer = null;
        if (!dirty) return;
        dirty = false;
        const tmp = `${FILE}.tmp.${process.pid}.${Date.now()}`;
        try {
            fs.mkdirSync(path.dirname(FILE), { recursive: true });
            fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(toLong)));
            fs.renameSync(tmp, FILE);
        } catch (err) {
            try { fs.unlinkSync(tmp); } catch {}
            console.warn("[ShortIds] could not persist registry:", err.message);
        }
    }, 3000);
    timer.unref?.();
}

/** Registers a long id. Returns its short alias, or null if it is not a media id. */
function register(longId) {
    let ok = seen.get(longId);
    if (ok === undefined) {
        ok = isMediaId(longId);
        if (seen.size > 200000) seen.clear();
        seen.set(longId, ok);
    }
    if (!ok) return null;
    const s = shortOf(longId);
    const cur = toLong.get(s);
    if (cur === undefined) {
        toLong.set(s, longId);
        scheduleSave();
    } else if (cur !== longId) {
        console.warn(`[ShortIds] alias collision ${s}: keeping the first id, this one stays long-only`);
        return null;
    }
    return s;
}

// Series / season / part ids are NOT file ids, but they are pure functions of the file names (see grouper.js:
// base64url of "<type>:<normalizedTitle>", "season:<seriesId>:<n>", "part:<normalizedTitle>:<n>"). Re-deriving them from the
// library file index lets a copied series link resolve on a cold start (empty registry / another server instance).
// Same normalisation as grouper.js — keep the two in sync. Cached; rebuilt only when the file index changes size.
let _derived = { size: -1, map: new Map() };
function _normKey(title) {
    return String(title || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}
function derivedGroupIds(fileIndex) {
    if (_derived.size === fileIndex.size) return _derived.map;
    const map = new Map();
    try {
        const { parseFilename } = require("../../metadata/nameParser");
        const b64 = (t) => Buffer.from(t).toString("base64url");
        const add = (longId) => {
            const sh = shortOf(longId);
            if (!map.has(sh)) map.set(sh, longId);
        };
        for (const f of fileIndex.values()) {
            let parsed;
            try {
                parsed = parseFilename(f.name, f.path);
            } catch {
                continue; // one odd file name must not stop the others
            }
            if (!parsed) continue;
            const key = _normKey(parsed.title);
            if (parsed.type === "movie") {
                if (parsed.part != null) add(b64(`part:${key}:${parsed.part}`));
                continue;
            }
            const seriesId = b64(`${parsed.type}:${key}`);
            add(seriesId);
            add(b64(`season:${seriesId}:${parsed.season ?? 1}`));
        }
    } catch (err) {
        console.warn("[ShortIds] could not derive series ids:", err.message);
    }
    _derived = { size: fileIndex.size, map };
    return map;
}

/** short → long id, or null. Falls back to the library file index (and the ids derived from it) when the registry has not seen it yet. */
function expand(short) {
    if (!isShortId(short)) return null;
    const hit = toLong.get(short);
    if (hit) return hit;
    try {
        const { fileIndex } = require("../media/mediaCache");
        for (const id of fileIndex.keys()) if (shortOf(id) === short) { register(id); return id; }
        const grouped = derivedGroupIds(fileIndex).get(short);
        if (grouped) { register(grouped); return grouped; }
    } catch {}
    return null;
}

/** Registers every media-looking id found in a JSON string. */
const CANDIDATE = /"([A-Za-z0-9_-]{11,})"/g;
function observeJson(json) {
    let m;
    CANDIDATE.lastIndex = 0;
    while ((m = CANDIDATE.exec(json))) register(m[1]);
}

/** Registers the whole library (called at boot and after scans). */
function registerLibrary() {
    try {
        const { fileIndex } = require("../media/mediaCache");
        for (const id of fileIndex.keys()) register(id);
    } catch {}
}

// ── Express middleware ───────────────────────────────────────────────────────────────────────────────────
// 1. URL path/query: any 9-char token that is a REGISTERED alias becomes the long id before routing, so
//    /api/media/<alias>, /stream/video/<alias>, ?mediaId=<alias> all work with no route changes.
// 2. JSON bodies: string values that are registered aliases are expanded (history/progress/watchlist saves).
// 3. Responses under media-related /api prefixes are scanned so every id sent to a client is registered.
const TOKEN = /(?<![0-9A-Za-z_-])[0-9A-Za-z]{9}(?![0-9A-Za-z_-])/g;
const OBSERVE_PREFIXES = ["/api/media", "/api/history", "/api/user", "/api/recommendations", "/api/trailers", "/api/categories", "/api/mediainfo", "/api/watchtime", "/api/library", "/api/metadata"];

function expandDeep(v, depth = 0) {
    if (depth > 6) return v;
    if (typeof v === "string") return toLong.get(v) || v;
    if (Array.isArray(v)) return v.map((x) => expandDeep(x, depth + 1));
    if (v && typeof v === "object") {
        for (const k of Object.keys(v)) v[k] = expandDeep(v[k], depth + 1);
    }
    return v;
}

function middleware(req, res, next) {
    try {
        // /api/ids/<alias> is the alias LOOKUP itself — rewriting it to the long id would make it 404.
        if (!req.path.startsWith("/api/ids/")) {
            const rewritten = req.url.replace(TOKEN, (t) => toLong.get(t) || t);
            if (rewritten !== req.url) req.url = rewritten;
        }
        if (req.body && typeof req.body === "object") req.body = expandDeep(req.body);

        if (req.method === "GET" && OBSERVE_PREFIXES.some((p) => req.path === p || req.path.startsWith(p + "/"))) {
            const original = res.json.bind(res);
            res.json = (body) => {
                if (body && typeof body === "object") {
                    let s;
                    try {
                        s = JSON.stringify(body);
                    } catch {
                        return original(body);
                    }
                    observeJson(s);
                    return res.type("json").send(s);
                }
                return original(body);
            };
        }
    } catch (err) {
        console.warn("[ShortIds] middleware skipped:", err.message);
    }
    next();
}

load();

module.exports = { shortOf, isShortId, isMediaId, register, expand, observeJson, registerLibrary, middleware };
