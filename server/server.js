"use strict";

/**
 * server.js (v2 — FLUX Streaming Engine)
 * Adds: HLS cleanup daemon, graceful shutdown, session cleanup on exit.
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

const { VIDEO_EXTENSIONS, SUBTITLE_EXTENSIONS } = require("./utils/fileHelpers");
const { startDaemon, stopDaemon } = require("./utils/hlsCleanup");
const { killAllSessions } = require("./utils/transcoderService");
const { detect: detectHW, getSysInfoRoute } = require("./utils/hwAccel");

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
        allowedHeaders: ["Content-Type", "Range", "X-Flux-Client", "X-Flux-Profile"],
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

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/api/library", libraryRouter);
app.use("/api/media", mediaRouter);
app.use("/api/metadata", metadataRouter);
app.use("/api/history", historyRouter);
app.use("/api/user", userRouter);
app.use("/api/categories", categoriesRouter);
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
app.get("/api/sysinfo", getSysInfoRoute);

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
    await killAllSessions();
    console.log("[Server] All transcoding sessions terminated. Bye.");
    process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ─── Start ────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, "0.0.0.0", async () => {
    console.log(`\n🎬  FLUX Media Server v${APP_VERSION}`);
    console.log(`    http://localhost:${PORT}`);
    console.log(`    Health:  /health`);
    console.log(`    Library: /api/library`);
    console.log(`    Media:   /api/media`);
    console.log(`    Stream:  /stream/video/:id\n`);

    // Start HLS cleanup daemon
    startDaemon();

    // Pre-warm hardware detection
    detectHW()
        .then((hw) => {
            console.log(`[Server] Hardware acceleration: ${hw.type}`);
        })
        .catch(() => {});
});

// Keep-alive timeouts — prevents premature connection drops during chunked streaming
server.keepAliveTimeout = 65000; // 65s (must be > load balancer/proxy timeout)
server.headersTimeout = 66000; // slightly higher than keepAliveTimeout
