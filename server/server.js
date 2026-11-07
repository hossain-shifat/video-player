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

// Reorganise server/data into folders BEFORE any store loads its file (idempotent, never overwrites, backs up first).
require("./utils/system/dataMigration").run();

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const libraryRouter = require("./routes/media/library");
const mediaRouter = require("./routes/media/media");
const streamRouter = require("./routes/streaming/stream");
const metadataRouter = require("./routes/media/metadata");
const historyRouter = require("./routes/user/history");
const watchTimeRouter = require("./routes/user/watchtime");
const userRouter = require("./routes/user/user");
const categoriesRouter = require("./routes/media/categories");
const recommendationsRouter = require("./routes/media/recommendations");
const adminDashboardRouter = require("./routes/admin/adminDashboard");
const liveRouter = require("./routes/live/live");
const mediaInfoRouter = require("./routes/media/mediainfo");
const permissionsRouter = require("./routes/user/permissions");
const trailersRouter = require("./routes/trailers/trailers");
const notificationsRouter = require("./routes/user/notifications");
const { startTrailerScheduler, stopTrailerScheduler } = require("./utils/trailers/trailerScheduler");
const { startReviewIdRefresher, stopReviewIdRefresher } = require("./metadata/metadataStore");
const { startCommunityFeedScheduler, stopCommunityFeedScheduler } = require("./controllers/media/metadataController");
const { startStorageMonitor, stopStorageMonitor } = require("./utils/system/storageMonitor");
const notificationService = require("./services/notificationService");
const { startAccountPurgeScheduler, stopAccountPurgeScheduler } = require("./utils/user/userStore");
const pushService = require("./services/pushService");

// ─── Auth layer (additive — does not touch existing routers above) ─────────────
const authRouter = require("./auth/routes/authRoutes");
const adminRouter = require("./auth/routes/adminRoutes");
const sessionRouter = require("./auth/routes/sessionRoutes");
const streamStartRouter = require("./auth/routes/streamStartRoutes");

const { VIDEO_EXTENSIONS, SUBTITLE_EXTENSIONS } = require("./utils/media/fileHelpers");
const { startDaemon, stopDaemon } = require("./utils/streaming/hlsCleanup");
const transcoderService = require("./utils/streaming/transcoderService");
const { detect: detectHW, getSysInfoRoute } = require("./utils/streaming/hwAccel");

const { authenticateJWT } = require("./auth/middleware/authenticateJWT");
const { requireApprovedUser } = require("./auth/middleware/requireApprovedUser");
const { requireRole } = require("./auth/middleware/requireRole");
const { enforceEmailVerified } = require("./auth/middleware/enforceEmailVerified");

const subtitleStore = require("./utils/subtitles/subtitleStore");
const subtitleWorker = require("./utils/subtitles/subtitleWorker");

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
        // Needed so the browser stores/sends the HttpOnly device cookie (flux_did). Origins are an
        // explicit allow-list (never "*"), which is what makes credentials safe.
        credentials: true,
        methods: ["GET", "POST", "PATCH", "DELETE", "HEAD", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Range", "X-Flux-Client", "X-Flux-Profile", "X-Flux-Device", "Authorization", "X-Flux-Stream-Token"],
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

// ─── Email-verification gate (soft, app-wide) ─────────────────────────────────
// A token whose account has NOT verified its e-mail is refused everywhere except /auth/* (the
// verification flow itself) and /health. Anonymous requests and verified users pass untouched;
// approval is NOT checked here — pending users may browse. Playback is gated in routes/stream.js.
app.use(enforceEmailVerified);

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
app.use("/api/watchtime", watchTimeRouter);
app.use("/api/user", userRouter);
app.use("/api/recommendations", recommendationsRouter);
app.use("/api/categories", categoriesRouter);
app.use("/api/admin-dashboard", adminDashboardRouter);
app.use("/api/live", liveRouter);
app.use("/api/trailers", trailersRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/stream", streamRouter);

// ─── Health ───────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
    res.json({ status: "ok", uptime: process.uptime(), version: APP_VERSION });
});

// ─── Info ─────────────────────────────────────────────────────────────────────
app.get("/api/info", async (req, res) => {
    try {
        const foldersRaw = await fs.promises.readFile(path.join(__dirname, "data", "library", "folders.json"), "utf-8");
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
    const status = err.status || err.statusCode || 500;
    // Never leak internal error text (paths, SQL, library messages) on 5xx.
    res.status(status).json({ error: status >= 500 ? "Internal server error" : err.message || "Request failed" });
});

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
let _shuttingDown = false;
async function shutdown(signal) {
    if (_shuttingDown) return;
    _shuttingDown = true;
    setTimeout(() => process.exit(0), 8000).unref(); // never hang on a stuck cleanup
    console.log(`\n[Server] Received ${signal} — shutting down gracefully...`);
    stopDaemon();
    stopTrailerScheduler();
    stopReviewIdRefresher();
    stopCommunityFeedScheduler();
    stopStorageMonitor();
    stopAccountPurgeScheduler();
    notificationService.stopMaintenance();
    subtitleWorker.stop();
    await transcoderService.killAllSessions();
    console.log("[Server] All transcoding sessions terminated. Bye.");
    process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ─── Crash diagnostics + guard ────────────────────────────────────────────────
// Policy unchanged: a stray exception / rejection must NOT kill the process (that would destroy every
// live HLS session). Added on top:
//   • every event is written to logs/crash.log with memory + session count + stack
//   • logs/memory.log gets one line / 30 s — the LAST lines before a fatal OOM or native crash show what grew
//   • event-loop blocks > 1 s are logged (finds sync work that freezes the whole server)
//   • an exception STORM (10 non-transient errors in 60 s = state probably corrupt) exits with code 70
//     so supervisor.js restarts clean instead of limping on
//   • "process exit" line in crash.log: if the last line of crash.log is NOT an exit line, the process was
//     hard-killed (out of memory / native crash / killed from outside)
const LOG_DIR = path.join(__dirname, "logs");
try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
} catch {}
const CRASH_LOG = path.join(LOG_DIR, "crash.log");
const MEMORY_LOG = path.join(LOG_DIR, "memory.log");
const TRANSIENT_CODES = new Set(["ECONNRESET", "EPIPE", "ECONNABORTED", "ETIMEDOUT", "ERR_STREAM_PREMATURE_CLOSE", "ERR_STREAM_DESTROYED", "ERR_STREAM_WRITE_AFTER_END", "ERR_HTTP_HEADERS_SENT"]);
const STORM_LIMIT = 10;
const STORM_WINDOW_MS = 60_000;
let _stormHits = [];

const toMB = (n) => Math.round(n / 1048576);
function snapshotLine() {
    const m = process.memoryUsage();
    let sessions = "?";
    try {
        sessions = transcoderService.getSessionStats().length;
    } catch {}
    return `rss=${toMB(m.rss)}MB heap=${toMB(m.heapUsed)}/${toMB(m.heapTotal)}MB ext=${toMB(m.external)}MB sessions=${sessions} up=${Math.round(process.uptime())}s`;
}
function appendLog(file, text) {
    try {
        fs.appendFileSync(file, text + "\n");
    } catch {}
}
function trimLog(file, maxBytes = 1_000_000) {
    try {
        if (fs.statSync(file).size > maxBytes) fs.renameSync(file, file + ".1");
    } catch {}
}
function crashLog(kind, err) {
    const code = err && err.code ? ` code=${err.code}` : "";
    trimLog(CRASH_LOG);
    appendLog(CRASH_LOG, `[${new Date().toISOString()}] ${kind}${code} | ${snapshotLine()}\n${err && err.stack ? err.stack : String(err)}\n`);
}

function onProcessError(kind, err) {
    if (err && TRANSIENT_CODES.has(err.code)) {
        console.warn(`[Server] ${kind} (transient ${err.code}) — ignored`); // client dropped / socket reset — harmless, not logged to file
        return;
    }
    console.error(`[Server] ⚠ ${kind}:`, err && err.message ? err.message : err);
    if (err && err.stack) console.error(err.stack);
    crashLog(kind, err);

    const now = Date.now();
    _stormHits = _stormHits.filter((t) => now - t < STORM_WINDOW_MS);
    _stormHits.push(now);
    if (_stormHits.length >= STORM_LIMIT) {
        const msg = `exception storm (${_stormHits.length} in ${STORM_WINDOW_MS / 1000}s) — exiting 70 for clean restart`;
        console.error(`[Server] ✖ ${msg}`);
        appendLog(CRASH_LOG, `[${new Date().toISOString()}] ${msg}`);
        const hard = setTimeout(() => process.exit(70), 4000);
        transcoderService
            .killAllSessions()
            .catch(() => {})
            .finally(() => {
                clearTimeout(hard);
                process.exit(70);
            });
    }
}
process.on("unhandledRejection", (reason) => onProcessError("unhandledRejection", reason));
process.on("uncaughtException", (err, origin) => onProcessError(`uncaughtException(${origin})`, err));
process.on("exit", (code) => appendLog(CRASH_LOG, `[${new Date().toISOString()}] process exit code=${code} | ${snapshotLine()}`));
appendLog(CRASH_LOG, `[${new Date().toISOString()}] boot pid=${process.pid} node=${process.version}`);

// Memory trail + event-loop block detector (timers are unref'd — they never keep the process alive)
setInterval(() => {
    trimLog(MEMORY_LOG);
    appendLog(MEMORY_LOG, `[${new Date().toISOString()}] ${snapshotLine()}`);
}, 30_000).unref();
let _lastTick = Date.now();
let _lastLagLog = 0;
setInterval(() => {
    const now = Date.now();
    const lag = now - _lastTick - 1000;
    _lastTick = now;
    if (lag > 1000 && now - _lastLagLog > 10_000) {
        _lastLagLog = now;
        appendLog(CRASH_LOG, `[${new Date(now).toISOString()}] EVENT-LOOP BLOCKED ~${lag}ms | ${snapshotLine()}`);
    }
}, 1000).unref();

// Started under supervisor.js: shut down cleanly when it asks (works on Windows, unlike signals) or vanishes.
process.on("message", (m) => {
    if (m && m.type === "shutdown") shutdown("supervisor");
});
if (process.send) process.on("disconnect", () => shutdown("supervisor-disconnect"));

// One feature failing to start must not stop the others from starting.
function safeStart(name, fn) {
    const fail = (err) => {
        console.error(`[Boot] ${name} failed:`, err && err.message ? err.message : err);
        crashLog(`boot:${name}`, err);
    };
    try {
        const r = fn();
        if (r && typeof r.catch === "function") r.catch(fail);
    } catch (err) {
        fail(err);
    }
}

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
    console.log(`    Trailers: /api/trailers`);
    console.log(`    Popular:  /api/media/popular-reviews  /api/media/popular-discussions`);
    console.log(`    Stream:  /stream/video/:id\n`);

    // Start HLS cleanup daemon
    safeStart("hls-cleanup", () => startDaemon());

    // Keeps data/trailers.json fresh daily without any frontend request
    safeStart("trailer-scheduler", () => startTrailerScheduler());

    // Re-checks TMDB every 3 days for NEW review ids and stores them in metadata.json (all reviews, not 10)
    safeStart("review-id-refresher", () => startReviewIdRefresher());

    // Builds the Popular Reviews / Popular Discussions feeds for Home (cached in metadata.json, rebuilt every 3 days)
    safeStart("community-feeds", () => startCommunityFeedScheduler());

    // FCM push (no-op + log line if Firebase credentials aren't configured),
    // disk-space alerts, and daily pruning of old notifications / stale devices.
    safeStart("push-service", () => pushService.init());
    safeStart("storage-monitor", () => startStorageMonitor());
    safeStart("notification-maintenance", () => notificationService.startMaintenance());

    // Permanently removes accounts whose 30-day recovery window has passed. DB-backed (users.purgeAt),
    // so it survives restarts; the timer is only the trigger. Idempotent.
    safeStart("account-purge", () => startAccountPurgeScheduler());

    // Pre-warm hardware detection + FFmpeg path resolution at startup.
    // Without this, the first transcode session would block for 3-36s while
    // QSV/NVENC/VAAPI test encodes run sequentially.
    safeStart("transcoder-warmup", () => transcoderService.warmup());

    // Start idle-session sweeper (kills abandoned sessions after SESSION_TIMEOUT_MS)
    safeStart("transcoder-sweeper", () => transcoderService.startSweeper());

    // ── Subtitle system ───────────────────────────────────────────────────────
    // NOTE: getAllCached(folders) below scans every configured folder, which
    // means scanner.js's built-in ffprobe auto-probe (see scanner.js) fires
    // for every file automatically as a side effect of this call — that is
    // what populates data/mediainfo.json on boot. No extra step needed here.
    try {
        await subtitleStore.init();

        const { getAllCached } = require("./utils/media/mediaCache");
        const { readFolders } = require("./controllers/media/libraryController");
        const folders = await readFolders();

        console.log(`[Subtitle] Folders configured: ${folders.length}`);

        if (folders.length > 0) {
            const { allMedia } = await getAllCached(folders);
            console.log(`[Subtitle] Total media files found: ${allMedia.length}`);

            // Live folder watching. watchAllFolders() exists in libraryController but was never called, so
            // files added to EXISTING libraries were never detected (no cache refresh, no "new media"
            // notification). Done after the first scan so the baseline of known files is warm.
            require("./controllers/media/libraryController").watchAllFolders(folders);

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
            const { getMetadata } = require("./metadata/metadataStore");
            const { parseFilename } = require("./metadata/nameParser");

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
