"use strict";

/**
 * services/pushService.js
 *
 * Thin wrapper around firebase-admin, used ONLY for push delivery (FCM).
 * Notification records, preferences and access control live in
 * notificationService.js / Prisma — nothing here touches the database except
 * deactivating registration tokens that FCM says are dead.
 *
 * Uses the MODULAR firebase-admin API (firebase-admin/app, /messaging). The old
 * namespaced `admin.credential.cert()` is gone in current firebase-admin
 * releases, which is what produced "Cannot read properties of undefined
 * (reading 'cert')".
 *
 * Credentials (first match wins):
 *   FIREBASE_SERVICE_ACCOUNT_JSON  raw JSON, or base64 of the JSON
 *   FIREBASE_SERVICE_ACCOUNT_PATH  path to the JSON file (relative to server/)
 *   GOOGLE_APPLICATION_CREDENTIALS standard Google ADC path
 *
 * Network needs: outbound HTTPS (443) from the server to
 *   oauth2.googleapis.com / www.googleapis.com (access token) and
 *   fcm.googleapis.com (send), and the "Firebase Cloud Messaging API (V1)"
 *   enabled for the project.
 *
 * Every failure is contained: push degrades to "disabled / unreachable" and
 * in-app notification history keeps working.
 */

const fs = require("fs");
const path = require("path");
const prisma = require("../auth/prismaClient");

const MULTICAST_LIMIT = 500; // FCM hard limit per sendEachForMulticast call
const RETRY_DELAY_MS = 2000;

// Token will never work again → deactivate. (messaging/invalid-argument is
// deliberately NOT here: it can mean a bad payload and would kill every token.)
const DEAD_TOKEN_CODES = new Set(["messaging/registration-token-not-registered", "messaging/invalid-registration-token", "messaging/mismatched-credential", "messaging/sender-id-mismatch"]);

// Worth one retry: temporary FCM / network trouble.
const TRANSIENT_CODES = new Set(["messaging/server-unavailable", "messaging/internal-error", "messaging/message-rate-exceeded", "messaging/device-message-rate-exceeded", "app/network-error", "app/network-timeout"]);

// A dry-run with a bogus token proves auth + reachability when FCM answers with one of these.
const REACHABLE_CODES = new Set(["messaging/invalid-argument", "messaging/registration-token-not-registered", "messaging/invalid-registration-token"]);

let _state = "uninitialised"; // uninitialised | ready | disabled
let _reason = "not-initialised"; // machine-readable
let _message = "";
let _messaging = null;
let _connectivity = { checked: false, ok: null, code: null, message: "", at: null };

const _lastLog = new Map();
/** log at most once per minute per key so an outage can't flood the console */
function logThrottled(key, fn) {
    const now = Date.now();
    if (now - (_lastLog.get(key) || 0) < 60_000) return;
    _lastLog.set(key, now);
    fn();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function _disable(reason, message) {
    _state = "disabled";
    _reason = reason;
    _message = message;
}

function _loadServiceAccount() {
    const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (rawJson && rawJson.trim()) {
        let text = rawJson.trim();
        if (!text.startsWith("{")) text = Buffer.from(text, "base64").toString("utf-8");
        return JSON.parse(text);
    }

    const filePath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    if (filePath && filePath.trim()) {
        const abs = path.isAbsolute(filePath) ? filePath : path.resolve(__dirname, "..", filePath);
        if (!fs.existsSync(abs)) {
            const err = new Error(`service-account file not found: ${abs}`);
            err.code = "FILE_MISSING";
            throw err;
        }
        return JSON.parse(fs.readFileSync(abs, "utf-8"));
    }

    return null;
}

/** Idempotent. Safe to call at boot and lazily. Never throws. */
function init() {
    if (_state !== "uninitialised") return _state === "ready";

    let appMod, messagingMod;
    try {
        appMod = require("firebase-admin/app");
        messagingMod = require("firebase-admin/messaging");
    } catch {
        _disable("not-installed", "firebase-admin is not installed on the server (npm i firebase-admin).");
        console.warn(`[Push] ${_message} Push disabled.`);
        return false;
    }

    try {
        let credential = null;
        const account = _loadServiceAccount();

        if (account) {
            if (account.private_key) account.private_key = account.private_key.replace(/\\n/g, "\n");
            credential = appMod.cert(account);
        } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            credential = appMod.applicationDefault();
        }

        if (!credential) {
            _disable("no-credentials", "No Firebase service-account credentials are configured on the server.");
            console.warn("[Push] No Firebase credentials configured — push disabled (in-app notifications still work).");
            return false;
        }

        const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp({ credential });
        _messaging = messagingMod.getMessaging(app);
        _state = "ready";
        _reason = "ready";
        _message = "";
        console.log("[Push] Firebase Cloud Messaging initialised — checking connectivity…");

        // Non-blocking: proves OAuth + network + API enablement without sending anything.
        checkConnectivity().catch(() => {});
        return true;
    } catch (err) {
        const missing = err.code === "FILE_MISSING";
        _disable(missing ? "file-missing" : "init-failed", missing ? err.message : `Firebase credentials could not be loaded: ${err.message}`);
        console.error(`[Push] ${_message} — push disabled`);
        return false;
    }
}

/**
 * Dry-run send with a fake token. Nothing is delivered; it only checks that the
 * server can get an access token and reach fcm.googleapis.com.
 */
async function checkConnectivity() {
    if (!init() || !_messaging) return _connectivity;

    try {
        await _messaging.send({ token: "flux-connectivity-check", data: { ping: "1" } }, true);
        _connectivity = { checked: true, ok: true, code: null, message: "", at: new Date().toISOString() };
    } catch (err) {
        const code = err.code || "unknown";
        if (REACHABLE_CODES.has(code)) {
            _connectivity = { checked: true, ok: true, code: null, message: "", at: new Date().toISOString() };
            console.log("[Push] FCM reachable and credentials accepted ✓");
        } else {
            _connectivity = { checked: true, ok: false, code, message: _explain(code, err), at: new Date().toISOString() };
            console.error(`[Push] FCM connectivity check failed (${code}): ${_connectivity.message}`);
        }
    }
    return _connectivity;
}

function _explain(code, err) {
    const msg = String(err?.message || "");
    if (code === "app/network-error" || code === "app/network-timeout" || /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN/i.test(msg)) {
        return "The server couldn't reach Google (check internet/DNS/firewall for outbound HTTPS to googleapis.com).";
    }
    if (/has not been used|is disabled|SERVICE_DISABLED/i.test(msg)) {
        return "Firebase Cloud Messaging API (V1) is not enabled for this Firebase project.";
    }
    if (code === "app/invalid-credential" || /invalid_grant|private key|Invalid JWT/i.test(msg)) {
        return "Google rejected the service-account key (wrong/expired key, or the server clock is off).";
    }
    if (code === "messaging/authentication-error" || code === "messaging/third-party-auth-error") {
        return "Google rejected the credentials for Cloud Messaging.";
    }
    return msg.slice(0, 200) || "Unknown error";
}

function isEnabled() {
    return init();
}

/** Safe-to-show status for the UI (never includes secrets). */
function getStatus() {
    init();
    const ready = _state === "ready";
    const unreachable = ready && _connectivity.checked && _connectivity.ok === false;
    return {
        state: ready && !unreachable ? "ready" : "disabled",
        reason: unreachable ? "unreachable" : _reason,
        message: unreachable ? _connectivity.message : _message,
        connectivity: _connectivity,
    };
}

async function _sendChunk(chunk, data) {
    return _messaging.sendEachForMulticast({
        tokens: chunk.map((d) => d.token),
        data,
        webpush: { headers: { Urgency: "high", TTL: "86400" } },
        android: { priority: "high" },
    });
}

/**
 * Send one payload to many devices (PushDevice rows: { id, token }).
 * payload: { title, body, url, type, notificationId }
 * Returns { sent, failed, deactivated }. Never throws.
 */
async function sendToDevices(devices, payload) {
    const result = { sent: 0, failed: 0, deactivated: 0 };
    if (!devices?.length || !init()) return result;

    // FCM "data" values must all be strings. Data-only (no `notification` key)
    // so our service worker controls display, click target and tag.
    const data = {
        title: String(payload.title || "FLUX"),
        body: String(payload.body || ""),
        url: String(payload.url || "/"),
        type: String(payload.type || "system"),
        notificationId: String(payload.notificationId || ""),
        tag: String(payload.notificationId || payload.type || "flux"),
    };

    const dead = [];

    for (let i = 0; i < devices.length; i += MULTICAST_LIMIT) {
        let pending = devices.slice(i, i + MULTICAST_LIMIT);

        for (let attempt = 0; attempt < 2 && pending.length; attempt++) {
            if (attempt > 0) await sleep(RETRY_DELAY_MS);

            let res;
            try {
                res = await _sendChunk(pending, data);
            } catch (err) {
                // Whole call failed — usually network/auth. Retry once, then give up quietly.
                logThrottled("send-throw", () => console.error(`[Push] FCM request failed: ${err.code || ""} ${err.message}`));
                if (attempt === 1) result.failed += pending.length;
                continue;
            }

            const retry = [];
            res.responses.forEach((r, idx) => {
                const device = pending[idx];
                if (r.success) {
                    result.sent++;
                    return;
                }
                const code = r.error?.code || "";
                if (DEAD_TOKEN_CODES.has(code)) {
                    result.failed++;
                    dead.push(device.id);
                } else if (TRANSIENT_CODES.has(code) && attempt === 0) {
                    retry.push(device);
                } else {
                    result.failed++;
                    logThrottled(`send-${code}`, () => console.warn(`[Push] send failed (${code || "unknown"}): ${r.error?.message || ""}`));
                }
            });
            pending = retry;
        }
    }

    if (dead.length) {
        try {
            await prisma.pushDevice.updateMany({ where: { id: { in: dead } }, data: { isActive: false } });
            result.deactivated = dead.length;
        } catch (err) {
            console.error("[Push] failed to deactivate dead tokens:", err.message);
        }
    }

    return result;
}

module.exports = { init, isEnabled, getStatus, checkConnectivity, sendToDevices };
