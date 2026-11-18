"use strict";

/**
 * routes/streaming/subtitles.js — lets the player load DOWNLOADED subtitles (SubDL) from server/data/subtitles.
 *
 * Why this exists: GET /stream/subtitle/:encodedPath is guarded by restrictToLibraryPath, which only accepts files
 * inside a LIBRARY folder (D:\Media\…). Downloaded subtitles live in server/data/subtitles — outside every library
 * folder — so the gate answered 403 PATH_DENIED and they never reached the player. Subtitles that sit next to the
 * movie, and embedded tracks, were never affected.
 *
 * Mounted BEFORE the main /stream router. It answers ONLY when the decoded path is inside data/subtitles; for any
 * other path it calls next() and the normal gate (library check) runs exactly as before. Login is still required
 * (requirePlaybackAccess), and the file is served by the existing streamSubtitle controller (extension check,
 * sanitizePath, SRT→WebVTT) — nothing in the streaming code was changed.
 */

const express = require("express");
const path = require("path");
const { requirePlaybackAccess } = require("../../auth/middleware/requirePlaybackAccess");
const { streamSubtitle } = require("../../controllers/streaming/streamController");

const SUB_ROOT = path.resolve(__dirname, "..", "..", "data", "subtitles");
const norm = (p) => String(p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const insideSubtitles = (file) => norm(file).startsWith(`${norm(SUB_ROOT)}/`);

const router = express.Router();

// One line per subtitle request in the server console, so a failure is visible instead of silent
// (the player treats ANY non-subtitle answer as "zero cues" and shows nothing).
//   [Subtitle] GET file(subtitle.srt) → 200 (cred: header) 12ms        [Subtitle] GET embedded(Film.mkv #2) → 401 (cred: none) 1ms
function describe(req) {
    try {
        const parts = req.path.split("/").filter(Boolean); // relative to the /stream/subtitle mount
        const dec = (s) => path.basename(Buffer.from(s, "base64url").toString());
        return parts[0] === "embedded" ? `embedded(${dec(parts[1] || "")} #${parts[2] ?? "?"})` : `file(${dec(parts[0] || "")})`;
    } catch {
        return "?";
    }
}
function credOf(req) {
    if (req.headers["x-flux-stream-token"]) return "header";
    if (req.query?.st) return "query";
    if ((req.headers.cookie || "").includes("flux_st=")) return "cookie";
    if (req.headers.authorization) return "bearer";
    return "none";
}
// CORS FIX (subtitles selected, server logs 200, but nothing is shown):
// streamSubtitle / streamEmbeddedSubtitle (streamController.js, frozen) force `Access-Control-Allow-Origin: *`, which
// overwrites the specific origin the app-level cors() already set. The player's fetch wrapper (Api/stream.js) sends
// subtitle requests with credentials: "include", and browsers REJECT a wildcard origin on credentialed requests — the
// fetch fails, the renderer's .catch swallows it, zero cues. Fix from the outside: when the request has an Origin,
// ignore that late `*` so the origin cors() already allowed (plus Allow-Credentials) is what the browser sees.
router.use((req, res, next) => {
    if (req.headers.origin) {
        const setHeader = res.setHeader.bind(res);
        res.setHeader = (name, value) => (String(name).toLowerCase() === "access-control-allow-origin" && value === "*" ? res : setHeader(name, value));
    }
    next();
});

router.use((req, res, next) => {
    const t0 = Date.now();
    const what = describe(req); // read NOW: req.url changes while the request travels on to other routers
    const cred = credOf(req);
    res.on("finish", () => console.log(`[Subtitle] ${req.method} ${what} → ${res.statusCode} (cred: ${cred}) ${Date.now() - t0}ms`));
    next();
});

// Only single-segment paths (/stream/subtitle/<encoded>); /stream/subtitle/embedded/<v>/<i> never matches here.
router.get("/:encodedPath", (req, res, next) => {
    let decoded;
    try {
        decoded = Buffer.from(String(req.params.encodedPath), "base64url").toString();
    } catch {
        return next();
    }
    if (!decoded || decoded.includes("\0") || !insideSubtitles(path.resolve(decoded))) return next(); // not ours → normal library gate
    return requirePlaybackAccess(req, res, (err) => (err ? next(err) : streamSubtitle(req, res)));
});

module.exports = router;
