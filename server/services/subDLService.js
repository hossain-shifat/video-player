"use strict";

/**
 * subDLService.js — FLUX SubDL Integration
 *
 * Wraps SubDL API (https://api.subdl.com/api/v1/subtitles).
 * Handles: search, ZIP download, SRT extraction.
 *
 * Env: SUBDL_API
 *
 * Rate limits (free): 2000 req/day.
 * Downloads: 300/day (IP-based, anonymous).
 */

const https = require("https");
const http = require("http");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const zlib = require("zlib");

const SUBDL_BASE = "https://api.subdl.com/api/v1/subtitles";
const SUBDL_DL_BASE = "https://dl.subdl.com";
const API_KEY = process.env.SUBDL_API || "";

// Supported language codes for SubDL
const LANG_MAP = { en: "EN", bn: "BN" };
const SUPPORTED_LANGS = ["EN", "BN"];

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function fetchJSON(url, timeoutMs = 12000) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const lib = parsed.protocol === "https:" ? https : http;

        const req = lib.get(
            url,
            {
                headers: {
                    Accept: "application/json",
                    "User-Agent": "FLUX/1.0",
                },
                timeout: timeoutMs,
            },
            (res) => {
                const chunks = [];
                let stream = res;
                const enc = (res.headers["content-encoding"] || "").toLowerCase();
                if (enc === "gzip") stream = res.pipe(zlib.createGunzip());
                else if (enc === "deflate") stream = res.pipe(zlib.createInflate());

                stream.on("data", (c) => chunks.push(c));
                stream.on("end", () => {
                    try {
                        resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf-8")) });
                    } catch (e) {
                        reject(new Error("SubDL JSON parse error: " + e.message));
                    }
                });
                stream.on("error", reject);
            },
        );
        req.on("timeout", () => req.destroy(new Error("SubDL request timed out")));
        req.on("error", reject);
    });
}

/**
 * Download raw bytes from URL to Buffer.
 * Used for ZIP files.
 */
function fetchBuffer(url, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith("https:") ? https : http;
        const req = lib.get(url, { timeout: timeoutMs }, (res) => {
            // Follow one redirect
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return fetchBuffer(res.headers.location, timeoutMs).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`SubDL download HTTP ${res.statusCode}`));
            }
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => resolve(Buffer.concat(chunks)));
            res.on("error", reject);
        });
        req.on("timeout", () => req.destroy(new Error("SubDL download timed out")));
        req.on("error", reject);
    });
}

// ─── ZIP extraction (no external deps — pure Node) ───────────────────────────

/**
 * Minimal ZIP parser — extracts first .srt / .vtt / .ass file found.
 * Returns { filename, data: Buffer } or null.
 *
 * ZIP local file header: PK\x03\x04
 * Offsets:
 *   [6]  general purpose bit flag (2 bytes, LE)
 *   [8]  compression method (2 bytes): 0=store, 8=deflate
 *   [18] compressed size (4 bytes, LE)
 *   [22] uncompressed size (4 bytes, LE)
 *   [26] file name length (2 bytes, LE)
 *   [28] extra field length (2 bytes, LE)
 *   [30] file name (variable)
 */
function extractSubFromZip(buf) {
    const SUB_EXTS = [".srt", ".vtt", ".ass", ".ssa"];
    let offset = 0;

    while (offset < buf.length - 4) {
        // Find local file header signature PK\x03\x04
        if (buf[offset] !== 0x50 || buf[offset + 1] !== 0x4b || buf[offset + 2] !== 0x03 || buf[offset + 3] !== 0x04) {
            offset++;
            continue;
        }

        if (offset + 30 > buf.length) break;

        const compression = buf.readUInt16LE(offset + 8);
        const compressedSize = buf.readUInt32LE(offset + 18);
        const uncompressedSize = buf.readUInt32LE(offset + 22);
        const fileNameLen = buf.readUInt16LE(offset + 26);
        const extraLen = buf.readUInt16LE(offset + 28);
        const dataOffset = offset + 30 + fileNameLen + extraLen;
        const filename = buf.slice(offset + 30, offset + 30 + fileNameLen).toString("utf-8");
        const ext = path.extname(filename).toLowerCase();

        if (SUB_EXTS.includes(ext) && !filename.includes("__MACOSX")) {
            try {
                let data;
                if (compression === 0) {
                    // Store
                    data = buf.slice(dataOffset, dataOffset + uncompressedSize);
                } else if (compression === 8) {
                    // Deflate (raw, no zlib header)
                    data = zlib.inflateRawSync(buf.slice(dataOffset, dataOffset + compressedSize));
                } else {
                    // Unknown compression — skip
                    offset = dataOffset + compressedSize;
                    continue;
                }
                return { filename: path.basename(filename), ext, data };
            } catch {
                // Corrupted entry — skip
            }
        }

        offset = dataOffset + compressedSize;
    }
    return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * searchSubtitles({ title, year, imdbId, tmdbId, season, episode, type, languages })
 *
 * `languages` — array of "en"|"bn" (lowercase). Defaults to ["en","bn"].
 *
 * Returns:
 * {
 *   ok: true,
 *   results: [{
 *     url,        — relative SubDL path e.g. /subtitle/xxx.zip
 *     fullUrl,    — absolute download URL
 *     lang,       — "en" | "bn"
 *     label,      — "English" | "Bangla"
 *     releaseName,
 *     season, episode,
 *     hi,
 *   }]
 * }
 * or { ok: false, error }
 */
async function searchSubtitles({ title, year, imdbId, tmdbId, season, episode, type = "movie", languages = ["en", "bn"] } = {}) {
    if (!API_KEY) return { ok: false, error: "SUBDL_API not configured" };

    const langCodes = languages.map((l) => LANG_MAP[l] || l.toUpperCase()).join(",");

    const params = new URLSearchParams({ api_key: API_KEY, languages: langCodes, subs_per_page: "30" });

    if (imdbId) {
        const imdbStr = String(imdbId);
        params.set("imdb_id", imdbStr.startsWith("tt") ? imdbStr : `tt${imdbStr}`);
    } else if (tmdbId) params.set("tmdb_id", String(tmdbId));
    else if (title) params.set("film_name", title);

    if (year) params.set("year", String(year));
    if (type === "tv" || season != null) params.set("type", "tv");
    else params.set("type", "movie");
    if (season != null) params.set("season_number", String(season));
    if (episode != null) params.set("episode_number", String(episode));

    const url = `${SUBDL_BASE}?${params}`;

    try {
        const { status, body } = await fetchJSON(url);

        if (status === 429) return { ok: false, error: "rate_limit", retryAfter: 3600 };
        if (status === 403) return { ok: false, error: "quota_exceeded", retryAfter: 86400 };
        if (!body.status) return { ok: false, error: body.error || `SubDL error ${status}` };

        const LANG_LABEL = { EN: "English", BN: "Bangla" };

        const results = (body.subtitles || []).map((s) => {
            // SubDL returns language at subtitle level as s.language (uppercase code like "EN", "BN")
            const langCode = (s.language || "EN").toUpperCase();
            return {
                url: s.url,
                fullUrl: `${SUBDL_DL_BASE}${s.url}`,
                lang: langCode.toLowerCase(),
                label: LANG_LABEL[langCode] || langCode,
                releaseName: s.release_name || s.name || "",
                season: s.season ?? null,
                episode: s.episode ?? null,
                hi: !!s.hi,
            };
        });

        console.log(`[SubDL] Search "${title || imdbId || tmdbId}" → ${results.length} results (langs: ${langCodes})`);
        return { ok: true, results };
    } catch (err) {
        console.error("[SubDL] searchSubtitles error:", err.message);
        return { ok: false, error: err.message };
    }
}

/**
 * downloadSubtitle(subtitleUrl, destDir, baseName, lang)
 *
 * Downloads ZIP from SubDL, extracts first subtitle file,
 * saves as `{destDir}/{baseName}.{lang}.{ext}`.
 *
 * Returns { ok: true, destPath, filename, ext }
 * or      { ok: false, error }
 */
async function downloadSubtitle(subtitleUrl, destDir, baseName, lang = "en") {
    if (!API_KEY) return { ok: false, error: "SUBDL_API not configured" };

    const fullUrl = subtitleUrl.startsWith("http") ? subtitleUrl : `${SUBDL_DL_BASE}${subtitleUrl}`;

    try {
        const zipBuf = await fetchBuffer(fullUrl);
        const extracted = extractSubFromZip(zipBuf);

        if (!extracted) {
            return { ok: false, error: "No subtitle file found in ZIP" };
        }

        await fsp.mkdir(destDir, { recursive: true });

        const destFilename = `${baseName}${extracted.ext}`;
        const destPath = path.join(destDir, destFilename);
        await fsp.writeFile(destPath, extracted.data);

        return { ok: true, destPath, filename: destFilename, ext: extracted.ext };
    } catch (err) {
        console.error("[SubDL] downloadSubtitle error:", err.message);
        return { ok: false, error: err.message };
    }
}

module.exports = { searchSubtitles, downloadSubtitle, SUPPORTED_LANGS };
