"use strict";

/**
 * openSubtitlesService.js — FLUX Subtitle Service
 *
 * Provides a lightweight, dependency-free wrapper around the
 * OpenSubtitles REST API v1 (https://opensubtitles.stoplight.io/).
 *
 * Requires env vars:
 *   OPENSUBTITLES_API_KEY  — your API key from opensubtitles.com
 *   OPENSUBTITLES_USER     — optional: username (for increased rate limits)
 *   OPENSUBTITLES_PASS     — optional: password
 *
 * Flow:
 *   1. searchSubtitles(query) → array of subtitle results from OS API
 *   2. downloadSubtitle(fileId, destPath) → downloads + saves VTT to disk
 *
 * Safety:
 *   - All network calls have a 15s timeout.
 *   - Errors are caught and surfaced — never crash the caller.
 *   - No caching here; callers cache the disk file.
 */

const https = require("https");
const http = require("http");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const zlib = require("zlib");

const OS_API_BASE = "api.opensubtitles.com";
const OS_API_PATH = "/api/v1";
const API_KEY = process.env.OPENSUBTITLES_API_KEY || "";

// ─── Internal HTTP helper ─────────────────────────────────────────────────────

function httpsGet(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const isHttps = parsed.protocol === "https:";
        const lib = isHttps ? https : http;

        const options = {
            hostname: parsed.hostname,
            port: parsed.port || (isHttps ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                "Api-Key": API_KEY,
                "User-Agent": "FLUX/1.0",
                ...headers,
            },
            timeout: 15000,
        };

        const req = lib.request(options, (res) => {
            const chunks = [];
            let stream = res;

            // Handle gzip/deflate
            const enc = (res.headers["content-encoding"] || "").toLowerCase();
            if (enc === "gzip") stream = res.pipe(zlib.createGunzip());
            else if (enc === "deflate") stream = res.pipe(zlib.createInflate());

            stream.on("data", (c) => chunks.push(c));
            stream.on("end", () => {
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: Buffer.concat(chunks).toString("utf-8"),
                });
            });
            stream.on("error", reject);
        });

        req.on("timeout", () => {
            req.destroy(new Error("OpenSubtitles request timed out"));
        });
        req.on("error", reject);
        req.end();
    });
}

// ─── OpenSubtitles Login (optional, increases rate limits) ───────────────────

let _token = null;
let _tokenExpiry = 0;

async function getToken() {
    if (!process.env.OPENSUBTITLES_USER || !process.env.OPENSUBTITLES_PASS) {
        return null; // anonymous — API key only
    }
    if (_token && Date.now() < _tokenExpiry) return _token;

    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            username: process.env.OPENSUBTITLES_USER,
            password: process.env.OPENSUBTITLES_PASS,
        });
        const options = {
            hostname: OS_API_BASE,
            port: 443,
            path: `${OS_API_PATH}/login`,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body),
                "Api-Key": API_KEY,
                "User-Agent": "FLUX/1.0",
            },
            timeout: 15000,
        };

        const req = https.request(options, (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => {
                try {
                    const data = JSON.parse(Buffer.concat(chunks).toString());
                    _token = data.token || null;
                    // Tokens expire in 24h; refresh 1h early
                    _tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
                    resolve(_token);
                } catch {
                    resolve(null);
                }
            });
        });
        req.on("error", () => resolve(null));
        req.on("timeout", () => {
            req.destroy();
            resolve(null);
        });
        req.write(body);
        req.end();
    });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * searchSubtitles({ query, imdbId, tmdbId, languages, season, episode })
 *
 * Returns array of subtitle objects suitable for the frontend:
 * [{ id, fileId, lang, label, filename, downloadCount, url: null }]
 *
 * `url` is null — caller must call downloadSubtitle(fileId, destPath) to get a URL.
 */
async function searchSubtitles({ query, imdbId, tmdbId, languages, season, episode } = {}) {
    if (!API_KEY) {
        return { error: "OPENSUBTITLES_API_KEY not configured", results: [] };
    }

    const params = new URLSearchParams();
    if (query) params.set("query", query);
    if (imdbId) params.set("imdb_id", String(imdbId).replace(/^tt/i, ""));
    if (tmdbId) params.set("tmdb_id", String(tmdbId));
    if (languages) params.set("languages", languages); // comma-separated ISO 639-1 codes
    if (season != null) params.set("season_number", String(season));
    if (episode != null) params.set("episode_number", String(episode));
    params.set("type", season != null ? "episode" : "movie");

    const url = `https://${OS_API_BASE}${OS_API_PATH}/subtitles?${params.toString()}`;

    try {
        const token = await getToken();
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const resp = await httpsGet(url, headers);

        if (resp.status !== 200) {
            console.warn(`[OpenSubtitles] Search returned ${resp.status}: ${resp.body.slice(0, 200)}`);
            return { error: `OpenSubtitles API error ${resp.status}`, results: [] };
        }

        const data = JSON.parse(resp.body);
        const results = (data.data || []).map((item) => {
            const attrs = item.attributes || {};
            const file = (attrs.files || [])[0] || {};
            return {
                id: item.id,
                fileId: file.file_id,
                lang: attrs.language || "und",
                label: attrs.language || "Unknown",
                filename: file.file_name || attrs.release || "subtitle",
                downloadCount: attrs.download_count || 0,
                fps: attrs.fps || null,
                hearingImpaired: !!attrs.hearing_impaired,
                machineTranslated: !!attrs.machine_translated,
                // url is resolved on-demand via downloadSubtitle()
                url: null,
                source: "opensubtitles",
            };
        });

        return { results };
    } catch (err) {
        console.error("[OpenSubtitles] searchSubtitles error:", err.message);
        return { error: err.message, results: [] };
    }
}

/**
 * downloadSubtitle(fileId, destPath)
 *
 * Downloads a subtitle from OpenSubtitles to `destPath` (absolute path).
 * Returns { ok: true, path: destPath } on success.
 * Returns { ok: false, error } on failure.
 *
 * OpenSubtitles download endpoint: POST /api/v1/download
 * Rate limit: 5/day (anonymous) or 20/day (authenticated) → we cache to disk.
 */
async function downloadSubtitle(fileId, destPath) {
    if (!API_KEY) {
        return { ok: false, error: "OPENSUBTITLES_API_KEY not configured" };
    }

    try {
        // Step 1: get download link
        const token = await getToken();
        const body = JSON.stringify({ file_id: fileId });

        const dlLink = await new Promise((resolve, reject) => {
            const options = {
                hostname: OS_API_BASE,
                port: 443,
                path: `${OS_API_PATH}/download`,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(body),
                    "Api-Key": API_KEY,
                    "User-Agent": "FLUX/1.0",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                timeout: 15000,
            };

            const req = https.request(options, (res) => {
                const chunks = [];
                res.on("data", (c) => chunks.push(c));
                res.on("end", () => {
                    try {
                        const data = JSON.parse(Buffer.concat(chunks).toString());
                        if (data.link) resolve(data.link);
                        else reject(new Error(data.message || "No download link returned"));
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            req.on("error", reject);
            req.on("timeout", () => {
                req.destroy(new Error("Download link request timed out"));
            });
            req.write(body);
            req.end();
        });

        // Step 2: stream the subtitle file to disk
        await fsp.mkdir(path.dirname(destPath), { recursive: true });

        await new Promise((resolve, reject) => {
            const parsed = new URL(dlLink);
            const isHttps = parsed.protocol === "https:";
            const lib = isHttps ? https : http;
            const fileStream = fs.createWriteStream(destPath);

            lib.get(dlLink, { timeout: 30000 }, (res) => {
                let stream = res;
                const enc = (res.headers["content-encoding"] || "").toLowerCase();
                if (enc === "gzip") stream = res.pipe(zlib.createGunzip());
                else if (enc === "deflate") stream = res.pipe(zlib.createInflate());

                stream.pipe(fileStream);
                fileStream.on("finish", resolve);
                fileStream.on("error", reject);
                stream.on("error", reject);
            })
                .on("error", reject)
                .on("timeout", function () {
                    this.destroy(new Error("Subtitle download timed out"));
                });
        });

        return { ok: true, path: destPath };
    } catch (err) {
        console.error("[OpenSubtitles] downloadSubtitle error:", err.message);
        return { ok: false, error: err.message };
    }
}

module.exports = { searchSubtitles, downloadSubtitle };
