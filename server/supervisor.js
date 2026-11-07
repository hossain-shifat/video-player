"use strict";

/**
 * supervisor.js — keeps server.js alive.
 *
 *   npm start      → node supervisor.js
 *   npm run dev    → nodemon --exec "node supervisor.js"
 *   npm run dev:raw→ nodemon server.js   (old behaviour, no supervisor)
 *
 * What it does when server.js dies:
 *   FIXABLE   (memory, native crash, exception storm, random exit) → restart with backoff + alert
 *   UNFIXABLE (syntax error, missing module, port in use, bad DB/env config, disk full, crash loop,
 *              same crash again and again) → STOP, alert "needs your fix" with the last output
 *
 * Alerts: console banner + logs/supervisor.log, plus a webhook POST when ALERT_WEBHOOK_URL is set in
 * server/.env (Discord webhook URL works as-is; Slack / ntfy-style URLs too). This file never writes .env.
 *
 * Optional env (all have defaults): SUP_BASE_DELAY_MS, SUP_LOOP_MAX, SUP_LOOP_WINDOW_MS, SUP_SAME_MAX,
 * SUP_STOP_TIMEOUT_MS, SUPERVISED_ENTRY.
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

try {
    require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });
} catch {}

const num = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);

const NAME = "FLUX";
const ENTRY = process.env.SUPERVISED_ENTRY || path.join(__dirname, "server.js");
const LOG_DIR = path.join(__dirname, "logs");
const SUP_LOG = path.join(LOG_DIR, "supervisor.log");
const WEBHOOK = (process.env.ALERT_WEBHOOK_URL || "").trim();

const BASE_DELAY_MS = num(process.env.SUP_BASE_DELAY_MS, 2000);
const MAX_DELAY_MS = 30_000;
const LOOP_MAX = num(process.env.SUP_LOOP_MAX, 5); // crashes ...
const LOOP_WINDOW_MS = num(process.env.SUP_LOOP_WINDOW_MS, 120_000); // ... inside this window = give up
const SAME_MAX = num(process.env.SUP_SAME_MAX, 3); // same crash N times in a row = give up
const STABLE_MS = 60_000; // ran this long = crash counters reset
const BOOT_WINDOW_MS = 30_000; // crash this early = boot problem, pattern-check the output
const STOP_TIMEOUT_MS = num(process.env.SUP_STOP_TIMEOUT_MS, 10_000);
const ALERT_COOLDOWN_MS = 60_000;

try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
} catch {}

// Crash text that a restart can NOT fix. Only checked for crashes during boot (see BOOT_WINDOW_MS),
// because server.js logs (and survives) many harmless errors while running.
const UNFIXABLE = [
    [/SyntaxError/, "Syntax error in code, or a corrupt JSON file"],
    [/Cannot find module|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND/, "Missing module — run: npm install"],
    [/EADDRINUSE/, "Port already in use — another server instance is still running"],
    [/ENOSPC/, "Disk is full"],
    [/EACCES|EPERM/, "Permission denied on a file, folder or port"],
    [/ERR_DLOPEN_FAILED|not a valid Win32 application/, "Native module broken — reinstall node_modules"],
    [/PrismaClientInitializationError|PrismaClientKnownRequestError|Environment variable not found|P1001|P1003|P1012/, "Database or .env config problem"],
];

// ─── logging + alerts ─────────────────────────────────────────────────────────
function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(`[supervisor] ${msg}`);
    try {
        if (fs.existsSync(SUP_LOG) && fs.statSync(SUP_LOG).size > 1_000_000) fs.renameSync(SUP_LOG, SUP_LOG + ".1");
        fs.appendFileSync(SUP_LOG, line + "\n");
    } catch {}
}

let lastAlertAt = 0;
async function alert(title, detail, { force = false } = {}) {
    const text = `[${NAME}] ${title}\n${detail}`.slice(0, 1800);
    log(`ALERT: ${title}\n${detail}`);
    console.error(`\n\x1b[41m\x1b[97m ${NAME} ${title} \x1b[0m\n${detail}\n`);
    if (!WEBHOOK || typeof fetch !== "function") return;
    if (!force && Date.now() - lastAlertAt < ALERT_COOLDOWN_MS) return;
    lastAlertAt = Date.now();
    try {
        await fetch(WEBHOOK, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: text, text }),
            signal: AbortSignal.timeout(5000),
        });
    } catch (err) {
        log(`webhook failed: ${err.message}`);
    }
}

// ─── child process ────────────────────────────────────────────────────────────
let child = null;
let stopping = false;
let startedAt = 0;
let tail = "";
let delay = BASE_DELAY_MS;
let crashes = [];
let lastSig = "";
let sameSig = 0;
let totalCrashes = 0;

function pushTail(chunk) {
    tail = (tail + chunk.toString()).slice(-8000);
}

function describeExit(code, signal) {
    if (signal) return `killed by signal ${signal}`;
    if (code === 70) return "exit 70 (exception storm inside server)";
    if (code === 134) return "exit 134 (abort — usually out of memory)";
    if (code === 137) return "exit 137 (SIGKILL — usually out of memory killer)";
    if (code === 3221226505) return "exit 0xC0000409 (Windows fast-fail / native crash)";
    if (code === 3221225477) return "exit 0xC0000005 (Windows access violation / native crash)";
    return `exit code ${code}`;
}

function lastLine(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    return (lines[lines.length - 1] || "").slice(0, 200);
}

function start() {
    tail = "";
    startedAt = Date.now();
    log(`starting ${path.basename(ENTRY)}`);
    child = spawn(process.execPath, ["--report-on-fatalerror", `--report-directory=${LOG_DIR}`, ENTRY], {
        cwd: __dirname,
        stdio: ["inherit", "pipe", "pipe", "ipc"],
        env: process.env,
        windowsHide: true,
    });
    child.stdout.on("data", (d) => {
        process.stdout.write(d);
        pushTail(d);
    });
    child.stderr.on("data", (d) => {
        process.stderr.write(d);
        pushTail(d);
    });
    child.on("error", (err) => {
        // spawn itself failed — restarting will not help
        alert("cannot start server — NEEDS YOUR FIX", `spawn error: ${err.message}`, { force: true }).finally(() => process.exit(1));
    });
    child.on("exit", onExit);
}

function onExit(code, signal) {
    const uptime = Date.now() - startedAt;
    child = null;

    if (stopping) {
        log("server stopped (supervisor was asked to stop)");
        return process.exit(0);
    }
    if (code === 0 && !signal) {
        log("server exited cleanly (code 0) — not restarting");
        return process.exit(0);
    }

    totalCrashes++;
    const now = Date.now();
    if (uptime >= STABLE_MS) {
        crashes = [];
        delay = BASE_DELAY_MS;
        sameSig = 0;
        lastSig = "";
    }
    crashes = crashes.filter((t) => now - t < LOOP_WINDOW_MS);
    crashes.push(now);

    const what = describeExit(code, signal);
    const sig = `${code}|${signal}|${lastLine(tail)}`;
    sameSig = sig === lastSig ? sameSig + 1 : 1;
    lastSig = sig;

    let reason = null;
    if (uptime < BOOT_WINDOW_MS) {
        for (const [re, msg] of UNFIXABLE) {
            if (re.test(tail)) {
                reason = msg;
                break;
            }
        }
    }
    if (!reason && crashes.length >= LOOP_MAX) reason = `Crash loop: ${crashes.length} crashes in ${Math.round(LOOP_WINDOW_MS / 1000)}s — restart does not fix it`;
    if (!reason && sameSig >= SAME_MAX) reason = `Same crash ${sameSig}x in a row — restart does not fix it`;

    const tailText = tail.slice(-1200).trim() || "(no output captured)";
    const ranFor = `ran ${Math.round(uptime / 1000)}s`;

    if (reason) {
        alert(`STOPPED — NEEDS YOUR FIX: ${reason}`, `${what}, ${ranFor}. Crash #${totalCrashes} since supervisor start.\nLast output:\n${tailText}\nMore: server/logs/crash.log, memory.log, supervisor.log`, { force: true }).finally(() => process.exit(1));
        return;
    }

    alert(`crashed (${what}, ${ranFor}) — restarting in ${Math.round(delay / 1000)}s`, `Crash #${totalCrashes} since supervisor start.\nLast output:\n${tailText}`);
    const wait = delay;
    delay = Math.min(delay * 2, MAX_DELAY_MS);
    setTimeout(start, wait);
}

// ─── stop handling ────────────────────────────────────────────────────────────
function stopChild(why) {
    if (stopping) return;
    stopping = true;
    log(`stopping (${why})`);
    if (!child) return process.exit(0);
    try {
        if (child.connected) child.send({ type: "shutdown" });
    } catch {}
    setTimeout(() => {
        if (child) {
            log("server did not stop in time — killing");
            try {
                child.kill("SIGKILL");
            } catch {}
        }
    }, STOP_TIMEOUT_MS).unref();
}
process.on("SIGINT", () => stopChild("SIGINT"));
process.on("SIGTERM", () => stopChild("SIGTERM"));
process.on("SIGUSR2", () => stopChild("SIGUSR2 (nodemon restart)"));
process.on("SIGBREAK", () => stopChild("SIGBREAK"));

start();
