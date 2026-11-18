"use strict";

/**
 * subDLService.js — FLUX Subtitle Provider (SubSource API v1)
 *
 * API base: https://api.subsource.net/api/v1
 * Auth: X-API-Key header
 * Env: SUBSOURCE_API
 * Rate limits: 60/min · 1800/hr · 7200/day
 *
 * Flow:
 *   1. GET /movies/search?searchType=imdb&imdb=tt... (preferred)
 *      OR GET /movies/search?searchType=text&q=title&year=...
 *      → { success, data: [{ movieId, title, type, ... }] }
 *
 *   2. GET /subtitles?movieId=...&language=english&sort=popular&limit=5
 *      → { success, data: [{ subtitleId, language, downloads, rating, ... }] }
 *      (one call per language needed)
 *
 *   3. GET /subtitles/{subtitleId}/download
 *      → ZIP binary stream
 *      Extract .srt/.vtt/.ass → write to disk
 *
 * Exported (same signatures as before):
 *   searchSubtitles({ title, year, imdbId, tmdbId, season, episode, type, languages, spokenLanguage })
 *   downloadSubtitle(subtitleRef, destDir, baseName, lang)
 *   SUPPORTED_LANGS
 */

const https = require("https");
const http = require("http");
const fsp = require("fs").promises;
const path = require("path");
const zlib = require("zlib");

const API_BASE = "https://api.subsource.net/api/v1";
const API_KEY = process.env.SUBSOURCE_API || "";

// SubSource uses full language names (lowercase)
// Language table: code → SubSource language name, UI label, folder name under data/subtitles/<media>/.
// SubSource names are its own lowercase English names; a wrong name just returns no subtitles for that language.
const LANGS = {
    en: { ss: "english", label: "English", folder: "english" },
    bn: { ss: "bengali", label: "Bangla", folder: "bangla" },
    hi: { ss: "hindi", label: "Hindi", folder: "hindi" },
    ar: { ss: "arabic", label: "Arabic", folder: "arabic" },
    ur: { ss: "urdu", label: "Urdu", folder: "urdu" },
    es: { ss: "spanish", label: "Spanish", folder: "spanish" },
    fr: { ss: "french", label: "French", folder: "french" },
    de: { ss: "german", label: "German", folder: "german" },
    id: { ss: "indonesian", label: "Indonesian", folder: "indonesian" },
    tr: { ss: "turkish", label: "Turkish", folder: "turkish" },
    ta: { ss: "tamil", label: "Tamil", folder: "tamil" },
    ms: { ss: "malay", label: "Malay", folder: "malay" },
    ru: { ss: "russian", label: "Russian", folder: "russian" },
    it: { ss: "italian", label: "Italian", folder: "italian" },
    ko: { ss: "korean", label: "Korean", folder: "korean" },
    ja: { ss: "japanese", label: "Japanese", folder: "japanese" },
    pt: { ss: "brazilian_portuguese", label: "Portuguese (BR)", folder: "portuguese" },
    fa: { ss: "farsi_persian", label: "Persian", folder: "persian" },
};
const LANG_TO_SS = Object.fromEntries(Object.entries(LANGS).map(([k, v]) => [k, v.ss]));
const LANG_LABEL = Object.fromEntries(Object.entries(LANGS).map(([k, v]) => [k, v.label]));
const LANG_FOLDER = Object.fromEntries(Object.entries(LANGS).map(([k, v]) => [k, v.folder]));

// Languages the background worker downloads (only when SubSource actually has them for that title).
// Env SUBTITLE_LANGUAGES="en,bn,hi,ar" — English is always first/included.
const SUPPORTED_LANGS = (() => {
    const wanted = String(process.env.SUBTITLE_LANGUAGES || "en,bn,hi,ar")
        .split(",")
        .map((l) => l.trim().toLowerCase())
        .filter(Boolean);
    const known = [...new Set(wanted)].filter((l) => {
        if (LANGS[l]) return true;
        console.warn(`[SubSource] SUBTITLE_LANGUAGES: unknown language "${l}" ignored (known: ${Object.keys(LANGS).join(",")})`);
        return false;
    });
    if (!known.includes("en")) known.unshift("en");
    return known;
})();

// ─── Hourly budget (SubSource API limit, default 900 of 1000/hour — leaves headroom for the manual UI) ───
const HOURLY_LIMIT = Number(process.env.SUBSOURCE_HOURLY_LIMIT) || 900;
const _hourStamps = [];

// ─── Request history (dashboard graphs): requests per hour, kept 30 days, saved to disk ───
const fs = require("fs");
const USAGE_FILE = path.join(__dirname, "..", "data", "subtitles", "_api-usage.json");
const USAGE_KEEP_MS = 30 * 86_400_000;
const HOUR = 3_600_000;
let _usage = {}; // hourStart(ms) → { n, search, download, limited }
let _usageDirty = false;
try {
    const raw = JSON.parse(fs.readFileSync(USAGE_FILE, "utf8"));
    if (raw && typeof raw === "object") _usage = raw.hours || {};
} catch {
    /* first run, or unreadable — start empty */
}

function _record(kind) {
    const t = Math.floor(Date.now() / HOUR) * HOUR;
    const h = (_usage[t] ||= { n: 0, search: 0, download: 0, limited: 0 });
    if (kind === "limited") h.limited++;
    else {
        h.n++;
        h[kind === "download" ? "download" : "search"]++;
    }
    _usageDirty = true;
}

function _saveUsage() {
    if (!_usageDirty) return;
    _usageDirty = false;
    const cutoff = Date.now() - USAGE_KEEP_MS;
    for (const k of Object.keys(_usage)) if (Number(k) < cutoff) delete _usage[k];
    try {
        fs.mkdirSync(path.dirname(USAGE_FILE), { recursive: true });
        const tmp = `${USAGE_FILE}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify({ hours: _usage }));
        fs.renameSync(tmp, USAGE_FILE);
    } catch {
        _usageDirty = true; // try again next tick — never let this break a download
    }
}
const _usageTimer = setInterval(_saveUsage, 30_000);
if (_usageTimer.unref) _usageTimer.unref();
process.on("exit", _saveUsage);

function _rateLimited() {
    _record("limited");
    return Object.assign(new Error("rate_limit"), { code: "rate_limit", retryAfter: 60 });
}

function _hourlyCheck(kind = "search") {
    const now = Date.now();
    while (_hourStamps.length && now - _hourStamps[0] > 3_600_000) _hourStamps.shift();
    if (_hourStamps.length >= HOURLY_LIMIT) {
        const retryAfterMs = _hourStamps[0] + 3_600_000 - now + 1000;
        _record("limited");
        throw Object.assign(new Error("hourly_limit"), { code: "hourly_limit", retryAfterMs });
    }
    _hourStamps.push(now);
    _record(kind);
}

// ─── Rate limiter (provider layer only) ──────────────────────────────────────
const RL_MAX = 55; // stay under 60/min limit
const RL_WIN = 60_000;
let _rlCount = 0;
let _rlStart = Date.now();

async function _throttle(kind = "search") {
    _hourlyCheck(kind); // throws code "hourly_limit" when the hour's budget is spent — callers pause instead of waiting an hour
    const now = Date.now();
    if (now - _rlStart > RL_WIN) {
        _rlCount = 0;
        _rlStart = now;
    }
    if (_rlCount >= RL_MAX) {
        const wait = RL_WIN - (Date.now() - _rlStart) + 200;
        console.log(`[SubSource] Rate limit — waiting ${Math.round(wait / 1000)}s`);
        await new Promise((r) => setTimeout(r, wait));
        _rlCount = 0;
        _rlStart = Date.now();
    }
    _rlCount++;
}

// ─── HTTP GET helper ──────────────────────────────────────────────────────────

function _getRaw(urlStr, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlStr);
        const options = {
            hostname: url.hostname,
            port: url.port || 443,
            path: url.pathname + url.search,
            method: "GET",
            headers: {
                "X-API-Key": API_KEY,
                "User-Agent": "FLUX/1.0",
                Accept: "application/json",
            },
            timeout: timeoutMs,
        };

        const req = https.request(options, (res) => {
            const chunks = [];
            let stream = res;
            const enc = (res.headers["content-encoding"] || "").toLowerCase();
            if (enc === "gzip") stream = res.pipe(zlib.createGunzip());
            else if (enc === "deflate") stream = res.pipe(zlib.createInflate());

            stream.on("data", (c) => chunks.push(c));
            stream.on("end", () => {
                const raw = Buffer.concat(chunks).toString("utf-8");
                // Guard: if response is HTML (error page), surface it clearly
                if (raw.trimStart().startsWith("<")) {
                    return reject(new Error(`SubSource returned HTML (HTTP ${res.statusCode}) — check API key or endpoint`));
                }
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(raw) });
                } catch (e) {
                    reject(new Error("SubSource JSON parse error: " + e.message));
                }
            });
            stream.on("error", reject);
        });
        req.on("timeout", () => req.destroy(new Error("SubSource request timed out")));
        req.on("error", reject);
        req.end();
    });
}

/**
 * _get — wraps _getRaw with automatic retry on transient network errors
 * (timeout, ECONNRESET, ECONNREFUSED, socket hang up). Does NOT retry on
 * rate_limit/auth_error — those are thrown immediately by the caller after
 * inspecting status codes. 2 retries with short backoff = up to 3 attempts total.
 */
const TRANSIENT_RE = /timed out|ECONNRESET|ECONNREFUSED|socket hang up|EAI_AGAIN|ETIMEDOUT/i;

async function _get(urlStr, timeoutMs = 15000) {
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            return await _getRaw(urlStr, timeoutMs);
        } catch (err) {
            lastErr = err;
            if (!TRANSIENT_RE.test(err.message)) throw err; // non-transient — fail fast
            if (attempt < 2) {
                const backoff = 500 * (attempt + 1);
                console.warn(`[SubSource] Transient error (${err.message}) — retry ${attempt + 1}/2 in ${backoff}ms`);
                await new Promise((r) => setTimeout(r, backoff));
            }
        }
    }
    throw lastErr;
}

/** Download ZIP as Buffer (follows one redirect) */
function _getBuffer(urlStr, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        const lib = urlStr.startsWith("https:") ? https : http;
        lib.get(
            urlStr,
            {
                headers: { "X-API-Key": API_KEY, "User-Agent": "FLUX/1.0" },
                timeout: timeoutMs,
            },
            (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    return _getBuffer(res.headers.location, timeoutMs).then(resolve).catch(reject);
                }
                if (res.statusCode !== 200) {
                    return reject(new Error(`SubSource download HTTP ${res.statusCode}`));
                }
                const chunks = [];
                res.on("data", (c) => chunks.push(c));
                res.on("end", () => resolve(Buffer.concat(chunks)));
                res.on("error", reject);
            },
        )
            .on("timeout", function () {
                this.destroy(new Error("SubSource download timed out"));
            })
            .on("error", reject);
    });
}

// ─── ZIP extraction (pure Node) ──────────────────────────────────────────────
//
// Reads the ZIP *central directory* (at the end of the file) instead of
// scanning local file headers sequentially. This is required because some
// ZIPs (including SubSource's) set the "data descriptor" bit in the general
// purpose flag, leaving compressedSize/uncompressedSize as 0 in the local
// header — the real sizes only exist in the central directory. Scanning
// local headers in that case reads 0 bytes and silently "finds" no file.

const EOCD_SIG = 0x06054b50;
const CDFH_SIG = 0x02014b50;

function _findEOCD(buf) {
    const minOffset = Math.max(0, buf.length - 65557);
    for (let i = buf.length - 22; i >= minOffset; i--) {
        if (buf.readUInt32LE(i) === EOCD_SIG) return i;
    }
    return -1;
}

function _extractSubFromZip(buf) {
    const SUB_EXTS = [".srt", ".vtt", ".ass", ".ssa"];

    const eocdOffset = _findEOCD(buf);
    if (eocdOffset === -1) {
        console.warn("[SubSource] ZIP extract: EOCD signature not found — not a valid ZIP?");
        return null;
    }

    const totalEntries = buf.readUInt16LE(eocdOffset + 10);
    const cdOffset = buf.readUInt32LE(eocdOffset + 16);

    const candidates = [];
    let pos = cdOffset;

    for (let i = 0; i < totalEntries; i++) {
        if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== CDFH_SIG) break;

        const compression = buf.readUInt16LE(pos + 10);
        const compSize = buf.readUInt32LE(pos + 20);
        const uncompSize = buf.readUInt32LE(pos + 24);
        const fnLen = buf.readUInt16LE(pos + 28);
        const exLen = buf.readUInt16LE(pos + 30);
        const cmLen = buf.readUInt16LE(pos + 32);
        const localHdrOff = buf.readUInt32LE(pos + 42);
        const filename = buf.slice(pos + 46, pos + 46 + fnLen).toString("utf-8");
        const ext = path.extname(filename).toLowerCase();

        if (SUB_EXTS.includes(ext) && !filename.includes("__MACOSX") && !filename.startsWith(".")) {
            candidates.push({ filename, ext, compression, compSize, uncompSize, localHdrOff });
        }

        pos += 46 + fnLen + exLen + cmLen;
    }

    if (!candidates.length) {
        console.warn(`[SubSource] ZIP extract: no .srt/.vtt/.ass entries among ${totalEntries} file(s) in archive`);
        return null;
    }

    // Prefer .srt, then .vtt, then .ass/.ssa; ties broken by largest file
    const extRank = { ".srt": 0, ".vtt": 1, ".ass": 2, ".ssa": 2 };
    candidates.sort((a, b) => extRank[a.ext] - extRank[b.ext] || b.uncompSize - a.uncompSize);

    const chosen = candidates[0];

    const lh = chosen.localHdrOff;
    if (buf.readUInt32LE(lh) !== 0x04034b50) {
        console.warn("[SubSource] ZIP extract: local header signature mismatch for", chosen.filename);
        return null;
    }
    const lhFnLen = buf.readUInt16LE(lh + 26);
    const lhExLen = buf.readUInt16LE(lh + 28);
    const dataOffset = lh + 30 + lhFnLen + lhExLen;

    try {
        const raw = buf.slice(dataOffset, dataOffset + chosen.compSize);
        const data = chosen.compression === 0 ? raw.slice(0, chosen.uncompSize) : chosen.compression === 8 ? zlib.inflateRawSync(raw) : null;

        if (!data) {
            console.warn(`[SubSource] ZIP extract: unsupported compression method ${chosen.compression} for ${chosen.filename}`);
            return null;
        }

        return { filename: path.basename(chosen.filename), ext: chosen.ext, data };
    } catch (err) {
        console.warn(`[SubSource] ZIP extract: failed to decompress ${chosen.filename}: ${err.message}`);
        return null;
    }
}

// ─── SubSource v1 API calls ───────────────────────────────────────────────────

/**
 * Step 1 — find SubSource movieId using multiple strategies with fallback.
 *
 * Strategy order:
 *   1. IMDb ID search (most accurate — if imdbId available)
 *   2. Text search: title + year + type
 *   3. Text search: title + year (no type — broader)
 *   4. Text search: title only (no year, no type — widest net)
 *   5. Text search: first 3 words of title (catches partial matches)
 */
async function _findMovieId(title, year, imdbId, type, season) {
    // Wraps a strategy call: rate_limit/auth_error propagate immediately,
    // any other error (network blip, bad response shape) is swallowed —
    // we just move on to the next strategy instead of failing the whole search.
    async function tryStrategy(label, fn) {
        try {
            return await fn();
        } catch (err) {
            if (err.code === "rate_limit" || err.code === "auth_error" || err.code === "hourly_limit") throw err;
            console.warn(`[SubSource] Strategy "${label}" failed for "${title}": ${err.message} — trying next`);
            return null;
        }
    }

    // ── Strategy 1: IMDb ID ───────────────────────────────────────────────────
    if (imdbId) {
        const imdb = String(imdbId).startsWith("tt") ? imdbId : `tt${imdbId}`;
        const res1 = await tryStrategy("imdb", () => _searchAPI(`searchType=imdb&imdb=${encodeURIComponent(imdb)}`, season));
        if (res1) {
            console.log(`[SubSource] Found "${title}" via imdbId=${imdb} → movieId=${res1}`);
            return res1;
        }
    }

    // ── Strategy 2: Title + year + type ──────────────────────────────────────
    const ssType = type === "tv" ? "series" : "movie";
    const res2 = await tryStrategy("text+year+type", () => _searchText(title, year, ssType, season));
    if (res2) {
        console.log(`[SubSource] Found "${title}" via text+year+type → movieId=${res2}`);
        return res2;
    }

    // ── Strategy 3: Title + year (no type) ───────────────────────────────────
    if (year) {
        const res3 = await tryStrategy("text+year", () => _searchText(title, year, null, season));
        if (res3) {
            console.log(`[SubSource] Found "${title}" via text+year → movieId=${res3}`);
            return res3;
        }
    }

    // ── Strategy 4: Title only ────────────────────────────────────────────────
    const res4 = await tryStrategy("title-only", () => _searchText(title, null, null, season));
    if (res4) {
        console.log(`[SubSource] Found "${title}" via title-only → movieId=${res4}`);
        return res4;
    }

    // ── Strategy 5: Shortened title (first 3 words) ───────────────────────────
    const words = title.trim().split(/\s+/);
    if (words.length > 3) {
        const shortTitle = words.slice(0, 3).join(" ");
        const res5 = await tryStrategy("short-title", () => _searchText(shortTitle, year, null, season));
        if (res5) {
            console.log(`[SubSource] Found "${title}" via short title "${shortTitle}" → movieId=${res5}`);
            return res5;
        }
    }

    console.log(`[SubSource] No match for "${title}" (year=${year}, imdbId=${imdbId}) after all strategies`);
    return null;
}

/** Single /movies/search call. Returns best movieId or null. */
async function _searchAPI(queryString, season) {
    await _throttle();
    let url = `${API_BASE}/movies/search?${queryString}`;
    if (season != null) url += `&season=${season}`;

    let status, body;
    try {
        ({ status, body } = await _get(url));
    } catch (err) {
        throw err; // re-throw rate_limit / auth_error etc.
    }

    if (status === 429) throw _rateLimited();
    if (status === 401 || status === 403) throw Object.assign(new Error("auth_error"), { code: "auth_error" });
    if (!body?.success || !body.data?.length) return null;
    return body.data[0]?.movieId || null;
}

/** Text search with optional year and type. Returns best movieId or null. */
async function _searchText(title, year, type, season) {
    await _throttle();
    let url = `${API_BASE}/movies/search?searchType=text&q=${encodeURIComponent(title)}`;
    if (year) url += `&year=${year}`;
    if (type) url += `&type=${type}`;
    if (season != null) url += `&season=${season}`;

    let status, body;
    try {
        ({ status, body } = await _get(url));
    } catch (err) {
        throw err;
    }

    if (status === 429) throw _rateLimited();
    if (status === 401 || status === 403) throw Object.assign(new Error("auth_error"), { code: "auth_error" });
    if (!body?.success || !body.data?.length) return null;

    const results = body.data;
    const needle = title.toLowerCase();

    // Prefer exact title + year match, then exact title, then first result
    const best =
        (year && results.find((r) => r.title?.toLowerCase() === needle && String(r.releaseYear) === String(year))) ||
        results.find((r) => r.title?.toLowerCase() === needle) ||
        // Partial match: result title starts with our query
        results.find((r) => r.title?.toLowerCase().startsWith(needle.slice(0, 10))) ||
        results[0];

    return best?.movieId || null;
}

/**
 * Step 2 — get subtitles for a movieId + language.
 * Returns best subtitleId (highest rating/downloads).
 */
async function _findSubtitleId(movieId, ssLang) {
    await _throttle();
    const url = `${API_BASE}/subtitles?movieId=${movieId}&language=${encodeURIComponent(ssLang)}&sort=popular&limit=5`;
    const { status, body } = await _get(url);
    if (status === 429) throw _rateLimited();
    if (!body?.success || !body.data?.length) return null;

    // Pick subtitle with best rating (good votes), fallback to most downloaded
    const subs = body.data;
    const best = subs.sort((a, b) => {
        const ra = (a.rating?.good || 0) - (a.rating?.bad || 0);
        const rb = (b.rating?.good || 0) - (b.rating?.bad || 0);
        return rb !== ra ? rb - ra : (b.downloads || 0) - (a.downloads || 0);
    })[0];

    return best?.subtitleId || null;
}

/**
 * Same lookup as _findSubtitleId but returns up to `n` ranked candidates (best first) so the worker can
 * download several and keep the one that validates against the embedded track. n=1 behaves exactly like before.
 */
async function _findSubtitleIds(movieId, ssLang, n = 1) {
    await _throttle();
    const limit = Math.max(5, Math.min(20, n));
    const url = `${API_BASE}/subtitles?movieId=${movieId}&language=${encodeURIComponent(ssLang)}&sort=popular&limit=${limit}`;
    const { status, body } = await _get(url);
    if (status === 429) throw _rateLimited();
    if (!body?.success || !body.data?.length) return [];

    return [...body.data]
        .sort((a, b) => {
            const ra = (a.rating?.good || 0) - (a.rating?.bad || 0);
            const rb = (b.rating?.good || 0) - (b.rating?.bad || 0);
            return rb !== ra ? rb - ra : (b.downloads || 0) - (a.downloads || 0);
        })
        .slice(0, n)
        .filter((x) => x?.subtitleId)
        .map((x) => ({ subtitleId: x.subtitleId, releaseName: x.releaseInfo || x.release_info || x.releaseName || x.name || "" }));
}

// ─── Exported public API ──────────────────────────────────────────────────────

/**
 * searchSubtitles — same signature as before.
 *
 * spokenLanguage logic:
 *   Always fetch English.
 *   Fetch Bangla only if spokenLanguage is bn/ben/bangla/bengali OR languages[] includes "bn".
 *
 * candidates (default 1): how many ranked subtitles to return PER language. 1 = the single best one (old behaviour,
 * what the search endpoint/UI get); the background worker asks for more and validates them.
 *
 * Returns:
 *   { ok: true, results: [{ subtitleId, lang, label, ssLang, releaseName, url, fullUrl }] }
 *   url = "/subtitles/{id}/download" (relative)
 *   fullUrl = full download URL
 */
async function searchSubtitles({ title, year, imdbId, tmdbId, season, episode, type = "movie", languages = ["en", "bn"], spokenLanguage, candidates = 1 } = {}) {
    if (!API_KEY) return { ok: false, error: "SUBSOURCE_API not configured" };

    // Languages to look up: exactly what was asked (English only if nothing was asked). Every language is "only if
    // available" — a language SubSource has nothing for just returns no results. (spokenLanguage no longer restricts
    // anything: before, Bangla was fetched ONLY for Bangla-language movies.)
    const langsNeeded = languages.length ? [...new Set(languages)] : ["en"];

    try {
        // Step 1: find movieId
        const movieId = await _findMovieId(title, year, imdbId, type, season);
        if (!movieId) {
            console.log(`[SubSource] No movie found for "${title}"`);
            return { ok: true, results: [] };
        }

        // Step 2: find best subtitleId per lang (parallel, resilient —
        // one language failing must not discard results from the other)
        const results = [];
        let sawRateLimit = false;
        let sawAuthError = false;
        let hourly = null;
        const failedLangs = []; // lookups cut short by a rate/hourly limit — NOT "no subtitles", the caller must retry them

        const settled = await Promise.allSettled(
            langsNeeded.map(async (lang) => {
                const ssLang = LANG_TO_SS[lang];
                if (!ssLang) return null;
                const found = await _findSubtitleIds(movieId, ssLang, Math.max(1, Math.min(8, candidates | 0 || 1)));
                if (!found.length) return null;
                return found.map((f) => ({
                    subtitleId: f.subtitleId,
                    lang,
                    ssLang,
                    label: LANG_LABEL[lang] || lang,
                    releaseName: f.releaseName || "",
                    url: `/subtitles/${f.subtitleId}/download`,
                    fullUrl: `${API_BASE}/subtitles/${f.subtitleId}/download`,
                    hi: false,
                }));
            }),
        );

        for (let si = 0; si < settled.length; si++) {
            const s = settled[si];
            if (s.status === "fulfilled" && s.value) {
                results.push(...s.value);
            } else if (s.status === "rejected") {
                if (s.reason?.code === "rate_limit" || s.reason?.code === "hourly_limit") failedLangs.push(langsNeeded[si]);
                if (s.reason?.code === "rate_limit") sawRateLimit = true;
                if (s.reason?.code === "auth_error") sawAuthError = true;
                if (s.reason?.code === "hourly_limit") hourly = s.reason;
                console.warn(`[SubSource] Lang lookup failed for "${title}": ${s.reason?.message}`);
            }
        }

        // Only propagate rate_limit/auth_error if we got ZERO usable results —
        // if at least one language succeeded, return what we have.
        if (results.length === 0 && hourly) throw hourly;
        if (results.length === 0 && sawRateLimit) {
            throw Object.assign(new Error("rate_limit"), { code: "rate_limit", retryAfter: 60 });
        }
        if (results.length === 0 && sawAuthError) {
            throw Object.assign(new Error("auth_error"), { code: "auth_error" });
        }

        console.log(`[SubSource] "${title}" (movieId=${movieId}) → ${results.length} subtitle(s)`);
        return { ok: true, results, failedLangs, pauseMs: failedLangs.length ? (hourly?.retryAfterMs || 65_000) : 0 };
    } catch (err) {
        if (err.code === "hourly_limit") return { ok: false, error: "hourly_limit", retryAfterMs: err.retryAfterMs };
        if (err.code === "rate_limit") return { ok: false, error: "rate_limit", retryAfter: err.retryAfter || 60 };
        if (err.code === "auth_error") return { ok: false, error: "SUBSOURCE_API key invalid or missing" };
        if (err.code === "quota_exceeded") return { ok: false, error: "quota_exceeded", retryAfter: 86400 };
        console.error("[SubSource] searchSubtitles error:", err.message);
        return { ok: false, error: err.message };
    }
}

/**
 * downloadSubtitle(subtitleRef, destDir, baseName, lang)
 *
 * subtitleRef: result object from searchSubtitles (has fullUrl),
 *              OR a plain URL string (for frontend manual downloads).
 *
 * Downloads ZIP from SubSource, extracts first subtitle file, writes to destDir/subtitle.srt.
 * Returns { ok: true, destPath, filename, ext } or { ok: false, error }.
 */
async function downloadSubtitle(subtitleRef, destDir, baseName = "subtitle", lang = "en") {
    if (!API_KEY) return { ok: false, error: "SUBSOURCE_API not configured" };

    try {
        // Resolve download URL
        let dlUrl;
        if (typeof subtitleRef === "string") {
            dlUrl = subtitleRef.startsWith("http") ? subtitleRef : `${API_BASE}${subtitleRef}`;
        } else if (subtitleRef?.fullUrl) {
            dlUrl = subtitleRef.fullUrl;
        } else if (subtitleRef?.subtitleId) {
            dlUrl = `${API_BASE}/subtitles/${subtitleRef.subtitleId}/download`;
        } else {
            return { ok: false, error: "Invalid subtitle reference" };
        }

        await _throttle("download");
        const zipBuf = await _getBuffer(dlUrl);

        const magic = zipBuf.slice(0, 4).toString("hex");
        if (magic !== "504b0304" && magic !== "504b0506" && magic !== "504b0708") {
            const preview = zipBuf.slice(0, 120).toString("utf-8").replace(/\s+/g, " ");
            console.warn(`[SubSource] Response is not a ZIP (magic=${magic}, ${zipBuf.length} bytes): ${preview}`);
            return { ok: false, error: "Response was not a valid ZIP file" };
        }

        const extracted = _extractSubFromZip(zipBuf);

        if (!extracted) return { ok: false, error: "No subtitle file found in ZIP" };

        await fsp.mkdir(destDir, { recursive: true });

        const destFilename = `${baseName}${extracted.ext}`;
        const destPath = path.join(destDir, destFilename);
        await fsp.writeFile(destPath, extracted.data);

        return { ok: true, destPath, filename: destFilename, ext: extracted.ext };
    } catch (err) {
        if (err.code === "hourly_limit") return { ok: false, error: "hourly_limit", retryAfterMs: err.retryAfterMs };
        console.error("[SubSource] downloadSubtitle error:", err.message);
        return { ok: false, error: err.message };
    }
}

/** SubSource requests used in the last hour vs the configured budget (for the dashboard). */
function getBudget() {
    const now = Date.now();
    while (_hourStamps.length && now - _hourStamps[0] > 3_600_000) _hourStamps.shift();
    return { used: _hourStamps.length, limit: HOURLY_LIMIT };
}

/** Request history for the dashboard: last 48 hourly buckets, 14 daily totals, and the peak hour / day / typical busiest hour. */
function getUsage() {
    const now = Date.now();
    const nowHour = Math.floor(now / HOUR) * HOUR;
    const get = (t) => _usage[t] || { n: 0, search: 0, download: 0, limited: 0 };
    const hours = Array.from({ length: 48 }, (_, i) => {
        const t = nowHour - (47 - i) * HOUR;
        return { t, ...get(t) };
    });
    // daily totals (server local time) + hour-of-day profile over the whole history
    const dayKey = (t) => {
        const d = new Date(t);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    const perDay = new Map();
    const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, total: 0 }));
    let all = { n: 0, search: 0, download: 0, limited: 0 };
    let peakHour = null;
    let first = null;
    for (const [k, v] of Object.entries(_usage)) {
        const t = Number(k);
        first = first == null ? t : Math.min(first, t);
        perDay.set(dayKey(t), (perDay.get(dayKey(t)) || 0) + v.n);
        byHour[new Date(t).getHours()].total += v.n;
        for (const f of Object.keys(all)) all[f] += v[f] || 0;
        if (!peakHour || v.n > peakHour.n) peakHour = { t, n: v.n, search: v.search, download: v.download };
    }
    const days = Array.from({ length: 14 }, (_, i) => {
        const d = new Date(now - (13 - i) * 86_400_000);
        const key = dayKey(d.getTime());
        return { date: key, n: perDay.get(key) || 0 };
    });
    let peakDay = null;
    for (const [date, n] of perDay) if (!peakDay || n > peakDay.n) peakDay = { date, n };
    const busiest = byHour.reduce((a, b) => (b.total > a.total ? b : a), byHour[0]);
    const sum = (arr, f = "n") => arr.reduce((a, x) => a + (x[f] || 0), 0);
    const last24 = hours.slice(-24);
    return {
        hours,
        days,
        byHour,
        peak: { hour: peakHour, day: peakDay, typicalHour: busiest.total ? { hour: busiest.hour, total: busiest.total } : null },
        totals: { lastHour: hours[47].n, last24h: sum(last24), last7d: sum(days.slice(-7)), all: all.n, search: all.search, download: all.download, limited: all.limited, limitedLast24h: sum(last24, "limited") },
        since: first,
    };
}

module.exports = { searchSubtitles, downloadSubtitle, getBudget, getUsage, SUPPORTED_LANGS, LANGS, LANG_LABEL, LANG_FOLDER };
