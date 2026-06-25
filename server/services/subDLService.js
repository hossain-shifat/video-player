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
const LANG_TO_SS = { en: "english", bn: "bengali" };
const LANG_LABEL = { en: "English", bn: "Bangla" };
const SUPPORTED_LANGS = ["en", "bn"];

// ─── Rate limiter (provider layer only) ──────────────────────────────────────
const RL_MAX = 55; // stay under 60/min limit
const RL_WIN = 60_000;
let _rlCount = 0;
let _rlStart = Date.now();

async function _throttle() {
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
            if (err.code === "rate_limit" || err.code === "auth_error") throw err;
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

    if (status === 429) throw Object.assign(new Error("rate_limit"), { code: "rate_limit", retryAfter: 60 });
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

    if (status === 429) throw Object.assign(new Error("rate_limit"), { code: "rate_limit", retryAfter: 60 });
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
    if (status === 429) throw Object.assign(new Error("rate_limit"), { code: "rate_limit", retryAfter: 60 });
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

// ─── Exported public API ──────────────────────────────────────────────────────

/**
 * searchSubtitles — same signature as before.
 *
 * spokenLanguage logic:
 *   Always fetch English.
 *   Fetch Bangla only if spokenLanguage is bn/ben/bangla/bengali OR languages[] includes "bn".
 *
 * Returns:
 *   { ok: true, results: [{ subtitleId, lang, label, ssLang, releaseName, url, fullUrl }] }
 *   url = "/subtitles/{id}/download" (relative)
 *   fullUrl = full download URL
 */
async function searchSubtitles({ title, year, imdbId, tmdbId, season, episode, type = "movie", languages = ["en", "bn"], spokenLanguage } = {}) {
    if (!API_KEY) return { ok: false, error: "SUBSOURCE_API not configured" };

    // Determine langs to fetch
    let langsNeeded = languages.length ? [...new Set(languages)] : ["en"];
    // Always include EN
    if (!langsNeeded.includes("en")) langsNeeded.unshift("en");

    // spokenLanguage filter: only add BN if spoken lang is Bangla
    if (spokenLanguage) {
        const spoken = (Array.isArray(spokenLanguage) ? spokenLanguage : [spokenLanguage]).map((l) => l.toLowerCase());
        const isBangla = spoken.some((l) => ["bn", "ben", "bangla", "bengali"].includes(l));
        langsNeeded = ["en", ...(isBangla ? ["bn"] : [])];
    }

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

        const settled = await Promise.allSettled(
            langsNeeded.map(async (lang) => {
                const ssLang = LANG_TO_SS[lang];
                if (!ssLang) return null;
                const subtitleId = await _findSubtitleId(movieId, ssLang);
                if (!subtitleId) return null;
                return {
                    subtitleId,
                    lang,
                    ssLang,
                    label: LANG_LABEL[lang] || lang,
                    releaseName: "",
                    url: `/subtitles/${subtitleId}/download`,
                    fullUrl: `${API_BASE}/subtitles/${subtitleId}/download`,
                    hi: false,
                };
            }),
        );

        for (const s of settled) {
            if (s.status === "fulfilled" && s.value) {
                results.push(s.value);
            } else if (s.status === "rejected") {
                if (s.reason?.code === "rate_limit") sawRateLimit = true;
                if (s.reason?.code === "auth_error") sawAuthError = true;
                console.warn(`[SubSource] Lang lookup failed for "${title}": ${s.reason?.message}`);
            }
        }

        // Only propagate rate_limit/auth_error if we got ZERO usable results —
        // if at least one language succeeded, return what we have.
        if (results.length === 0 && sawRateLimit) {
            throw Object.assign(new Error("rate_limit"), { code: "rate_limit", retryAfter: 60 });
        }
        if (results.length === 0 && sawAuthError) {
            throw Object.assign(new Error("auth_error"), { code: "auth_error" });
        }

        console.log(`[SubSource] "${title}" (movieId=${movieId}) → ${results.length} subtitle(s)`);
        return { ok: true, results };
    } catch (err) {
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

        await _throttle();
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
        console.error("[SubSource] downloadSubtitle error:", err.message);
        return { ok: false, error: err.message };
    }
}

module.exports = { searchSubtitles, downloadSubtitle, SUPPORTED_LANGS };
