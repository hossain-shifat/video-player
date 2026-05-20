"use strict";

/**
 * server.js — FLUX v4 (Production)
 *
 * Changes over v3:
 *  - /health returns active session count + temp dir size
 *  - Better graceful shutdown (wait for in-flight requests)
 *  - Startup validation (check ffmpeg/ffprobe in PATH)
 *  - keepAliveTimeout / headersTimeout tuned for streaming
 *  - Request size limit for JSON body (prevents abuse)
 */

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");

const libraryRouter = require("./routes/library");
const mediaRouter = require("./routes/media");
const streamRouter = require("./routes/stream");
const metadataRouter = require("./routes/metadata");
const historyRouter = require("./routes/history");
const userRouter = require("./routes/user");
const categoriesRouter = require("./routes/categories");

const { VIDEO_EXTENSIONS, SUBTITLE_EXTENSIONS } = require("./utils/fileHelpers");
const { startDaemon, stopDaemon } = require("./utils/hlsCleanup");
const { killAllSessions, getSessionStats, TEMP_DIR } = require("./utils/transcoderService");
const { detect: detectHW } = require("./utils/hwAccel");

// ─── Bootstrap ────────────────────────────────────────────────────────────────

const app = express();
const PORT = parseInt(process.env.PORT || "5000", 10);
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf-8"));
const APP_VERSION = pkg.version;

// ─── CORS ─────────────────────────────────────────────────────────────────────

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:5173,http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

app.use(
    cors({
        origin: (origin, callback) => {
            // Allow same-origin (no origin header) and listed origins
            if (!origin || allowedOrigins.includes(origin)) {
                callback(null, true);
            } else {
                // In development, be permissive. In production, restrict.
                if (process.env.NODE_ENV === "production") {
                    callback(null, false);
                } else {
                    callback(null, true);
                }
            }
        },
        methods: ["GET", "POST", "PATCH", "DELETE", "HEAD", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Range", "X-Flux-Client", "X-Flux-Profile"],
        exposedHeaders: ["Content-Range", "Accept-Ranges", "Content-Length", "X-Content-Duration", "ETag", "X-Stream-Decision", "X-Session-Id", "X-New-Session-Id"],
        credentials: false,
    }),
);

// Body parser — limit size to prevent abuse
app.use(express.json({ limit: "1mb" }));

// ─── Request logger ───────────────────────────────────────────────────────────

app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
        const ms = Date.now() - start;
        // Skip spammy HLS segment logs; only log if slow or error
        const isHLSSegment = /\/stream\/hls\/.+\.ts/.test(req.path);
        if (!isHLSSegment || res.statusCode >= 400) {
            const level = res.statusCode >= 500 ? "ERROR" : res.statusCode >= 400 ? "WARN" : "INFO";
            console.log(`[${level}] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
        }
    });
    next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use("/api/library", libraryRouter);
app.use("/api/media", mediaRouter);
app.use("/api/metadata", metadataRouter);
app.use("/api/history", historyRouter);
app.use("/api/user", userRouter);
app.use("/api/categories", categoriesRouter);
app.use("/stream", streamRouter);

// ─── Health ───────────────────────────────────────────────────────────────────

app.get("/health", async (req, res) => {
    const sessions = getSessionStats();
    let tempMB = 0;
    try {
        const { execSync } = require("child_process");
        const out = execSync(`du -sm "${TEMP_DIR}" 2>/dev/null || echo 0`, { encoding: "utf8" });
        tempMB = parseInt(out) || 0;
    } catch {}

    res.json({
        status: "ok",
        version: APP_VERSION,
        uptime: Math.round(process.uptime()),
        activeSessions: sessions.length,
        sessions: sessions.map((s) => ({
            id: s.id,
            decision: s.decision,
            status: s.status,
            idleSec: Math.round(s.idleMs / 1000),
        })),
        tempMB,
        memory: {
            rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + " MB",
            heap: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + " MB",
        },
    });
});

// ─── Server info ──────────────────────────────────────────────────────────────

app.get("/api/info", async (req, res) => {
    try {
        const foldersRaw = await fs.promises.readFile(path.join(__dirname, "data", "folders.json"), "utf-8").catch(() => "[]");
        const folders = JSON.parse(foldersRaw);
        const hw = await detectHW().catch(() => ({ type: "unknown" }));

        res.json({
            version: APP_VERSION,
            videoExtensions: VIDEO_EXTENSIONS,
            subtitleExtensions: SUBTITLE_EXTENSIONS,
            folderCount: folders.length,
            port: PORT,
            hwAccel: hw.type,
            segmentDuration: parseInt(process.env.HLS_SEGMENT_DURATION || "4", 10),
            maxSessions: parseInt(process.env.MAX_SESSIONS || "10", 10),
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── 404 / Error ──────────────────────────────────────────────────────────────

app.use((req, res) => res.status(404).json({ error: "Not found" }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    console.error("[Server] Unhandled error:", err.message, err.stack);
    if (!res.headersSent) {
        res.status(err.status || 500).json({ error: err.message || "Internal server error" });
    }
});

// ─── Startup validation ───────────────────────────────────────────────────────

function checkBinary(name) {
    return new Promise((resolve) => {
        execFile(name, ["-version"], { timeout: 5000 }, (err, stdout) => {
            if (err) {
                console.error(`[Server] ⚠️  ${name} not found in PATH — streaming will fail`);
                resolve(false);
            } else {
                const version = (stdout || "").split("\n")[0].trim();
                console.log(`[Server] ${name}: ${version}`);
                resolve(true);
            }
        });
    });
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

let _shutdownStarted = false;

async function shutdown(signal) {
    if (_shutdownStarted) return;
    _shutdownStarted = true;
    console.log(`\n[Server] ${signal} received — shutting down gracefully...`);

    stopDaemon();

    // Give in-flight requests 5s to complete
    await new Promise((resolve) => setTimeout(resolve, process.env.SHUTDOWN_GRACE_MS || 2000));

    await killAllSessions();
    console.log("[Server] All sessions terminated. Goodbye.");
    process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Catch unhandled rejections (prevent silent crashes)
process.on("unhandledRejection", (reason) => {
    console.error("[Server] Unhandled rejection:", reason);
});
process.on("uncaughtException", (err) => {
    console.error("[Server] Uncaught exception:", err);
    // Don't exit — let the server keep running for current sessions
});

// ─── Start ────────────────────────────────────────────────────────────────────

const server = app.listen(PORT, "0.0.0.0", async () => {
    console.log(`\n🎬  FLUX Media Server v${APP_VERSION}`);
    console.log(`    http://0.0.0.0:${PORT}`);
    console.log(`    Health:  /health`);
    console.log(`    Info:    /api/info`);
    console.log(`    Library: /api/library`);
    console.log(`    Stream:  /stream/video/:id`);
    console.log(`    HLS:     /stream/hls/:sessionId/*\n`);

    // Validate binaries
    await checkBinary("ffmpeg");
    await checkBinary("ffprobe");

    // Pre-warm hardware detection
    detectHW()
        .then((hw) => console.log(`[Server] HW accel: ${hw.type}`))
        .catch(() => {});

    // Start cleanup daemon
    startDaemon();

    // Ensure temp dir exists
    fs.mkdirSync(process.env.HLS_TEMP_DIR || path.join(__dirname, "../temp/hls"), { recursive: true });
    fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
});

// Streaming-optimised TCP settings:
//   keepAliveTimeout must be > load balancer timeout (typically 60s)
//   headersTimeout must be > keepAliveTimeout
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = 0; // no request timeout for streaming (range requests can be long)

module.exports = app; // for testing
