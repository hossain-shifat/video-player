"use strict";

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const libraryRouter   = require("./routes/library");
const mediaRouter     = require("./routes/media");
const streamRouter    = require("./routes/stream");
const metadataRouter  = require("./routes/metadata");
const historyRouter   = require("./routes/history");
const userRouter      = require("./routes/user");
const categoriesRouter = require("./routes/categories");
const { VIDEO_EXTENSIONS, SUBTITLE_EXTENSIONS } = require("./utils/fileHelpers");

const app = express();
const PORT = process.env.PORT || 5000;

// Load package.json once at startup — avoids blocking readFileSync on request paths
const { version: APP_VERSION } = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf-8"));

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:5173").split(",").map((o) => o.trim());

app.use(
    cors({
        origin: (origin, callback) => {
            // Allow requests with no origin (e.g. mobile apps, curl, Postman)
            if (!origin || allowedOrigins.includes(origin)) {
                callback(null, true);
            } else {
                // Deny without throwing — throwing causes a 500; null,false gives a proper CORS denial
                callback(null, false);
            }
        },
        methods: ["GET", "POST", "PATCH", "DELETE", "HEAD", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Range"],
        exposedHeaders: ["Content-Range", "Accept-Ranges", "Content-Length"],
    }),
);

// ─── BODY PARSING ─────────────────────────────────────────────────────────────
app.use(express.json());

// ─── REQUEST LOGGER ───────────────────────────────────────────────────────────
app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
        const duration = Date.now() - start;
        const date = new Date().toISOString();
        console.log(`[${date}] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
    });
    next();
});

// ─── ROUTES ───────────────────────────────────────────────────────────────────
app.use("/api/library",    libraryRouter);
app.use("/api/media",     mediaRouter);
app.use("/api/metadata",  metadataRouter);
app.use("/api/history",   historyRouter);
app.use("/api/user",      userRouter);
app.use("/api/categories", categoriesRouter);
app.use("/stream",        streamRouter);

// ─── HEALTH ENDPOINT ──────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        version: APP_VERSION || "1.0.0",
    });
});

// ─── INFO ENDPOINT ────────────────────────────────────────────────────────────
app.get("/api/info", async (req, res) => {
    try {
        const foldersRaw = await fs.promises.readFile(path.join(__dirname, "data", "folders.json"), "utf-8");
        const folders = JSON.parse(foldersRaw);
        res.json({
            videoExtensions: VIDEO_EXTENSIONS,
            subtitleExtensions: SUBTITLE_EXTENSIONS,
            folderCount: folders.length,
            port: PORT,
        });
    } catch {
        res.json({
            videoExtensions: VIDEO_EXTENSIONS,
            subtitleExtensions: SUBTITLE_EXTENSIONS,
            folderCount: 0,
            port: PORT,
        });
    }
});

// ─── 404 HANDLER ──────────────────────────────────────────────────────────────
app.use((req, res) => {
    res.status(404).json({ error: "Not found" });
});

// ─── GLOBAL ERROR HANDLER ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    console.error("[Server] Unhandled error:", err);
    const status = err.status || err.statusCode || 500;
    res.status(status).json({ error: err.message || "Internal server error" });
});

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`\n🎬 Media Server running at http://localhost:${PORT}`);
    console.log(`   Health:  http://localhost:${PORT}/health`);
    console.log(`   Library: http://localhost:${PORT}/api/library`);
    console.log(`   Media:   http://localhost:${PORT}/api/media`);
    console.log(`   Stream:  http://localhost:${PORT}/stream/video/:id`);
    console.log(`   Info:    http://localhost:${PORT}/api/info\n`);
});
