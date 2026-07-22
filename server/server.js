"use strict";

/**
 * server.js (v2 — FLUX Streaming Engine)
 * Adds: HLS cleanup daemon, graceful shutdown, session cleanup on exit.
 * Adds: /api/mediainfo bulk read endpoint (ffprobe data now auto-generated
 * inline by scanner.js itself on every folder scan — no separate scan step
 * needed here, it just happens for free whenever any folder gets scanned,
 * e.g. the subtitle system's getAllCached() call below already triggers it).
 */

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const libraryRouter = require("./routes/library");
const mediaRouter = require("./routes/media");
const streamRouter = require("./routes/stream");
const metadataRouter = require("./routes/metadata");
const historyRouter = require("./routes/history");
const userRouter = require("./routes/user");
const categoriesRouter = require("./routes/categories");
const adminDashboardRouter = require("./routes/adminDashboard");
const liveRouter = require("./routes/live");
const mediaInfoRouter = require("./routes/mediainfo");
const permissionsRouter = require("./routes/permissions");

// ─── Auth layer (additive — does not touch existing routers above) ─────────────
const authRouter = require("./auth/routes/authRoutes");
const adminRouter = require("./auth/routes/adminRoutes");
const sessionRouter = require("./auth/routes/sessionRoutes");
const streamStartRouter = require("./auth/routes/streamStartRoutes");

const { VIDEO_EXTENSIONS, SUBTITLE_EXTENSIONS } = require("./utils/fileHelpers");
const { startDaemon, stopDaemon } = require("./utils/hlsCleanup");
const transcoderService = require("./utils/transcoderService");
const { detect: detectHW, getSysInfoRoute } = require("./utils/hwAccel");

const { authenticateJWT } = require("./auth/middleware/authenticateJWT");
const { requireApprovedUser } = require("./auth/middleware/requireApprovedUser");
const { requireRole } = require("./auth/middleware/requireRole");

const subtitleStore = require("./utils/subtitleStore");
const subtitleWorker = require("./utils/subtitleWorker");

const app = express();
const PORT = process.env.PORT || 5000;

const { version: APP_VERSION } = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf-8"));

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:5173").split(",").map((o) => o.trim());

app.use(
    cors({
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin)) callback(null, true);
            else callback(null, false);
        },
        methods: ["GET", "POST", "PATCH", "DELETE", "HEAD", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Range", "X-Flux-Client", "X-Flux-Profile", "Authorization"],
        exposedHeaders: ["Content-Range", "Accept-Ranges", "Content-Length", "X-Content-Duration", "ETag"],
    }),
);

app.use(express.json());

// ─── Request Logger ───────────────────────────────────────────────────────────
app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
        const ms = Date.now() - start;
        if (!req.path.startsWith("/stream/hls")) {
            // don't spam HLS segment logs
            console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
        }
    });
    next();
});

// ─── Auth routes (public — no middleware applied here) ────────────────────────
app.use("/auth", authRouter);
app.use("/admin", adminRouter);
app.use("/api/sessions", sessionRouter);
app.use("/stream/start", streamStartRouter); // POST /stream/start/:id — auth-gated stream token

// ─── Existing routes (auth middleware injected inside each router) ─────────────
app.use("/api/library", libraryRouter);
app.use("/api/media", mediaRouter);
app.use("/api/metadata", metadataRouter);
app.use("/api/mediainfo", mediaInfoRouter);
app.use("/api/permissions", permissionsRouter);
app.use("/api/history", historyRouter);
app.use("/api/user", userRouter);
app.use("/api/categories", categoriesRouter);
app.use("/api/admin-dashboard", adminDashboardRouter);
app.use("/api/live", liveRouter);
app.use("/stream", streamRouter);

// ─── Health ───────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
    res.json({ status: "ok", uptime: process.uptime(), version: APP_VERSION });
});

// ─── Info ─────────────────────────────────────────────────────────────────────
app.get("/api/info", async (req, res) => {
    try {
        const foldersRaw = await fs.promises.readFile(path.join(__dirname, "data", "folders.json"), "utf-8");
        const folders = JSON.parse(foldersRaw);
        const hw = await detectHW().catch(() => ({ type: "unknown" }));
        res.json({
            videoExtensions: VIDEO_EXTENSIONS,
            subtitleExtensions: SUBTITLE_EXTENSIONS,
            folderCount: folders.length,
            port: PORT,
            hwAccel: hw.type,
            version: APP_VERSION,
        });
    } catch {
        res.json({ videoExtensions: VIDEO_EXTENSIONS, subtitleExtensions: SUBTITLE_EXTENSIONS, folderCount: 0, port: PORT });
    }
});

// ─── System Info (hardware + transcoding diagnostics) ──────────────────────────
app.get("/api/sysinfo", authenticateJWT, requireApprovedUser, requireRole("admin"), getSysInfoRoute);

// ─── Subtitle queue API ───────────────────────────────────────────────────────
app.get("/api/subtitle/queue", authenticateJWT, requireApprovedUser, requireRole("admin"), async (req, res) => {
    try {
        const stats = await subtitleStore.getQueueStats();
        return res.json({ worker: subtitleWorker.getStatus(), ...stats });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.post("/api/subtitle/enqueue/:id", authenticateJWT, requireApprovedUser, async (req, res) => {
    try {
        const entry = await subtitleStore.enqueue(req.params.id, req.body || {});
        return res.status(201).json(entry);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ─── 404 / Error ─────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: "Not found" }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    console.error("[Server] Unhandled error:", err);
    res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
async function shutdown(signal) {
    console.log(`\n[Server] Received ${signal} — shutting down gracefully...`);
    stopDaemon();
    subtitleWorker.stop();
    await transcoderService.killAllSessions();
    console.log("[Server] All transcoding sessions terminated. Bye.");
    process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ─── Crash prevention — keep server alive, don't lose sessions ────────────────
// An unhandled promise rejection or uncaught exception must NOT kill the process.
// Log the full stack so we can debug, but keep running.
process.on("unhandledRejection", (reason, promise) => {
    console.error("[Server] ⚠ Unhandled Promise Rejection:", reason);
    if (reason instanceof Error) console.error(reason.stack);
    // Do NOT call process.exit() — that would destroy all in-memory HLS sessions
});

process.on("uncaughtException", (err, origin) => {
    console.error(`[Server] ⚠ Uncaught Exception (${origin}):`, err.message);
    console.error(err.stack);
    // Do NOT call process.exit() — that would destroy all in-memory HLS sessions
    // Exception is logged; server continues running
});

// ─── Start ────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, "0.0.0.0", async () => {
    console.log(`\n🎬  FLUX Media Server v${APP_VERSION}`);
    console.log(`    http://localhost:${PORT}`);
    console.log(`    Health:  /health`);
    console.log(`    Library: /api/library`);
    console.log(`    Media:   /api/media`);
    console.log(`    Live TV: /api/live/channels`);
    console.log(`    MediaInfo: /api/mediainfo`);
    console.log(`    Permissions: /api/permissions`);
    console.log(`    Stream:  /stream/video/:id\n`);

    // Start HLS cleanup daemon
    startDaemon();

    // Pre-warm hardware detection + FFmpeg path resolution at startup.
    // Without this, the first transcode session would block for 3-36s while
    // QSV/NVENC/VAAPI test encodes run sequentially.
    transcoderService.warmup().catch(() => {});

    // Start idle-session sweeper (kills abandoned sessions after SESSION_TIMEOUT_MS)
    transcoderService.startSweeper();

    // ── Subtitle system ───────────────────────────────────────────────────────
    // NOTE: getAllCached(folders) below scans every configured folder, which
    // means scanner.js's built-in ffprobe auto-probe (see scanner.js) fires
    // for every file automatically as a side effect of this call — that is
    // what populates data/mediainfo.json on boot. No extra step needed here.
    try {
        await subtitleStore.init();

        const { getAllCached } = require("./utils/mediaCache");
        const { readFolders } = require("./controllers/libraryController");
        const folders = await readFolders();

        console.log(`[Subtitle] Folders configured: ${folders.length}`);

        if (folders.length > 0) {
            const { allMedia } = await getAllCached(folders);
            console.log(`[Subtitle] Total media files found: ${allMedia.length}`);

            const allMediaIds = new Set(allMedia.map((f) => f.id));

            // Remove orphan subtitle data for media no longer in library
            await subtitleStore.reconcile(allMediaIds);

            // Auto-enqueue all media for subtitle download (skips already done/queued).
            // Uses TMDB metadata (title, year, tmdbId) for best SubSource match.
            //
            // IMPORTANT: metadataStore strips the 'parsed' field before caching
            // (see metadataStore.setCache), so meta.parsed is ALWAYS undefined
            // on a cache hit. season/episode/part must be re-derived locally
            // via parseFilename() — never read them off the TMDB metadata object.
            const { getMetadata } = require("./utils/metadataStore");
            const { parseFilename } = require("./utils/nameParser");

            // Fetch metadata for all files in parallel (bounded) instead of
            // one-by-one — sequential awaiting over a large library could take
            // minutes before enqueueBatch ever ran, making it look "stuck".
            const CONCURRENCY = 8;
            const batchItems = [];
            let processed = 0;

            for (let i = 0; i < allMedia.length; i += CONCURRENCY) {
                const chunk = allMedia.slice(i, i + CONCURRENCY);
                const results = await Promise.all(
                    chunk.map(async (file) => {
                        const meta = await getMetadata(file).catch((err) => {
                            console.warn(`[Subtitle] getMetadata failed for "${file.name}": ${err.message}`);
                            return null;
                        });
                        const parsedLocal = parseFilename(file.name); // always has season/episode/part
                        return { file, meta, parsedLocal };
                    }),
                );

                for (const { file, meta, parsedLocal } of results) {
                    batchItems.push({
                        mediaId: file.id,
                        title: meta?.title || parsedLocal.title || file.name,
                        year: meta?.year || parsedLocal.year || null,
                        imdbId: meta?.imdbId || null,
                        tmdbId: meta?.tmdbId ? String(meta.tmdbId) : null,
                        season: parsedLocal.season ?? null,
                        episode: parsedLocal.episode ?? null,
                        part: parsedLocal.part ?? null,
                        type: meta?.type === "series" || meta?.type === "anime" || parsedLocal.type === "series" || parsedLocal.type === "anime" ? "tv" : "movie",
                        spokenLanguage: meta?.language || null,
                    });
                    processed++;
                }
            }

            console.log(`[Subtitle] Metadata resolved for ${processed}/${allMedia.length} files`);

            const added = await subtitleStore.enqueueBatch(batchItems);
            console.log(`[Subtitle] Auto-enqueued ${added} item(s) for download (${batchItems.length - added} already done/queued)`);
        } else {
            console.log("[Subtitle] No library folders configured — nothing to enqueue");
        }

        subtitleWorker.start();
    } catch (err) {
        console.error("[Server] Subtitle system init error:", err.message);
        console.error(err.stack);
    }
});

// Keep-alive timeouts — prevents premature connection drops during chunked streaming
server.keepAliveTimeout = 65000; // 65s (must be > load balancer/proxy timeout)
server.headersTimeout = 66000; // slightly higher than keepAliveTimeout
