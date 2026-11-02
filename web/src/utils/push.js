// web/src/utils/push.js
//
// Browser side of FCM push. Firebase is used ONLY to obtain a registration
// token (firebase/messaging); the token is then registered with FLUX's own
// backend, which owns everything else. The firebase SDK is dynamically
// imported so it never lands in the main bundle for people who don't opt in.
//
// Requirements (browser law, not ours): a secure context (HTTPS or localhost),
// Service Worker + Push API support, and a user gesture for the permission
// prompt — enablePush() must be called from a click handler.

import { registerPushDevice, unregisterPushToken } from "../api/notifications";

const SW_URL = "/flux-push-sw.js";
const STORE_KEY = "flux-push";
const CHANGE_EVENT = "flux-push-change";

// ─── Local opt-in state (per browser) ─────────────────────────────────────────
function readStore() {
    try {
        return JSON.parse(localStorage.getItem(STORE_KEY) || "null") || {};
    } catch {
        return {};
    }
}
function writeStore(next) {
    try {
        localStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch {
        /* storage blocked — push still works for this session */
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
}

// ─── Config ───────────────────────────────────────────────────────────────────
const env = import.meta.env;
const firebaseConfig = () => ({
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
});
const VAPID_KEY = env.VITE_FIREBASE_VAPID_KEY;

export function isFirebaseConfigured() {
    const c = firebaseConfig();
    return !!(c.apiKey && c.projectId && c.messagingSenderId && c.appId && VAPID_KEY);
}

// ─── Capability / state ───────────────────────────────────────────────────────
export function getPushSupport() {
    if (typeof window === "undefined") return { supported: false, reason: "unavailable", message: "Not available here." };
    if (!window.isSecureContext) {
        return { supported: false, reason: "insecure", message: "Push notifications need HTTPS (or localhost). This page was opened over plain HTTP." };
    }
    if (!("serviceWorker" in navigator)) return { supported: false, reason: "no-sw", message: "This browser doesn't support service workers." };
    if (!("PushManager" in window)) return { supported: false, reason: "no-push", message: "This browser doesn't support push messaging." };
    if (!("Notification" in window)) return { supported: false, reason: "no-notification", message: "This browser doesn't support notifications." };
    return { supported: true };
}

export function getPushState() {
    const support = getPushSupport();
    const permission = support.supported ? Notification.permission : "unsupported"; // default | granted | denied
    const store = readStore();
    return {
        support,
        configured: isFirebaseConfigured(),
        permission,
        enabledHere: !!store.enabled && permission === "granted",
    };
}

/** Subscribe to local push-state changes (enable/disable on this device). */
export function subscribePushState(cb) {
    window.addEventListener(CHANGE_EVENT, cb);
    window.addEventListener("storage", cb);
    return () => {
        window.removeEventListener(CHANGE_EVENT, cb);
        window.removeEventListener("storage", cb);
    };
}

// ─── FLUX notification branding ───────────────────────────────────────────────
// Chrome cannot show an SVG as a notification icon, and the repo has no PNG icon files. So the FLUX icon
// (a 192px tile) and the status-bar badge (96px white mask) are drawn from the existing /logo.svg in the page,
// stored as PNG data URLs in Cache Storage, and read back by the service worker when it shows a notification.
const BRAND_CACHE = "flux-brand-v1";
const BRAND_ICON_KEY = "/__flux/notification-icon.txt";
const BRAND_BADGE_KEY = "/__flux/notification-badge.txt";
const BRAND_VERSION = "1"; // bump to force regeneration (e.g. after changing logo.svg)
const LOGO_URL = "/logo.svg";
const TILE_COLOR = "#0b0d12"; // same as manifest background_color
let _brandIcon = null;

async function rasterizeLogo({ size, tile = false, mono = false }) {
    const res = await fetch(LOGO_URL, { cache: "force-cache" });
    if (!res.ok) throw new Error(`logo.svg not reachable (${res.status})`);
    const svg = await res.text();
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    try {
        const img = new Image();
        img.src = url;
        await img.decode();

        // Aspect ratio from the viewBox: SVGs without width/height report unreliable natural sizes.
        const vb = svg.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
        const ratio = vb ? parseFloat(vb[1]) / parseFloat(vb[2]) : (img.naturalWidth || 1) / (img.naturalHeight || 1);

        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext("2d");

        if (tile) {
            ctx.fillStyle = TILE_COLOR;
            if (ctx.roundRect) {
                ctx.beginPath();
                ctx.roundRect(0, 0, size, size, size * 0.22);
                ctx.fill();
            } else {
                ctx.fillRect(0, 0, size, size);
            }
        }

        const box = size * (tile ? 0.74 : 0.9);
        const w = ratio >= 1 ? box : box * ratio;
        const h = ratio >= 1 ? box / ratio : box;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);

        if (mono) {
            // Android uses only the alpha channel of a badge → paint every pixel white, keep its transparency.
            const d = ctx.getImageData(0, 0, size, size);
            for (let i = 0; i < d.data.length; i += 4) d.data[i] = d.data[i + 1] = d.data[i + 2] = 255;
            ctx.putImageData(d, 0, 0);
        }
        return canvas.toDataURL("image/png");
    } finally {
        URL.revokeObjectURL(url);
    }
}

/** Make sure the FLUX notification icon + badge exist in Cache Storage. Never throws; returns { icon, badge } or null. */
export async function ensureBrandIcons({ force = false } = {}) {
    if (typeof caches === "undefined" || typeof document === "undefined") return null;
    try {
        const cache = await caches.open(BRAND_CACHE);
        if (!force) {
            const hit = await cache.match(BRAND_ICON_KEY);
            if (hit && hit.headers.get("x-flux-brand") === BRAND_VERSION) {
                _brandIcon = await hit.text();
                return { icon: _brandIcon };
            }
        }
        const [icon, badge] = await Promise.all([rasterizeLogo({ size: 192, tile: true }), rasterizeLogo({ size: 96, mono: true })]);
        const headers = { "content-type": "text/plain", "x-flux-brand": BRAND_VERSION };
        await Promise.all([cache.put(BRAND_ICON_KEY, new Response(icon, { headers })), cache.put(BRAND_BADGE_KEY, new Response(badge, { headers }))]);
        _brandIcon = icon;
        return { icon, badge };
    } catch (err) {
        console.warn("[push] couldn't prepare the FLUX notification icon:", err.message);
        return null;
    }
}

/** Last prepared FLUX icon (PNG data URL) for synchronous callers such as the upload tray notification. */
export const getCachedBrandIcon = () => _brandIcon || undefined;

// ─── Firebase token ───────────────────────────────────────────────────────────
async function registerWorker() {
    // updateViaCache:"none" → the browser always re-fetches the worker script (never from the HTTP cache),
    // so a changed flux-push-sw.js is picked up on the next visit instead of staying stale.
    const reg = await navigator.serviceWorker.register(SW_URL, { scope: "/", updateViaCache: "none" });
    reg.update().catch(() => {});
    ensureBrandIcons(); // fire-and-forget: ready long before the first push arrives
    return navigator.serviceWorker.ready; // resolves once the worker is active
}

async function loadMessaging() {
    const [{ initializeApp, getApps, getApp }, messagingMod] = await Promise.all([import("firebase/app"), import("firebase/messaging")]);
    if (!(await messagingMod.isSupported())) throw new Error("This browser doesn't support Firebase push messaging.");
    const app = getApps().length ? getApp() : initializeApp(firebaseConfig());
    return { messagingMod, messaging: messagingMod.getMessaging(app) };
}

async function fetchToken(registration) {
    const { messagingMod, messaging } = await loadMessaging();
    return messagingMod.getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
}

// ─── Public actions ───────────────────────────────────────────────────────────

/** Must be called from a user gesture (click). Throws a human-readable Error on failure. */
export async function enablePush() {
    const support = getPushSupport();
    if (!support.supported) throw new Error(support.message);
    if (!isFirebaseConfigured()) throw new Error("Firebase web config is missing — set the VITE_FIREBASE_* variables and rebuild.");

    const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (permission !== "granted") {
        throw new Error(permission === "denied" ? "Notifications are blocked for this site. Allow them in your browser's site settings, then try again." : "Permission prompt was dismissed.");
    }

    const registration = await registerWorker();
    const token = await fetchToken(registration);
    if (!token) throw new Error("Firebase did not return a push token.");

    await registerPushDevice(token);
    writeStore({ enabled: true, token });
    return token;
}

/** Opt this browser out: remove it from the server, drop the FCM token, clear local state. */
export async function disablePush() {
    const { token } = readStore();

    if (token) await unregisterPushToken(token).catch(() => {});

    try {
        if (getPushSupport().supported && isFirebaseConfigured()) {
            const { messagingMod, messaging } = await loadMessaging();
            await messagingMod.deleteToken(messaging);
        }
    } catch {
        /* token already gone — fine */
    }

    writeStore({ enabled: false, token: null });
}

/**
 * Run after sign-in: if this browser opted in, refresh the token and (re)attach
 * it to the CURRENT account/session. Silent — never prompts.
 */
export async function syncPushToken() {
    const store = readStore();
    if (!store.enabled) return;

    const support = getPushSupport();
    if (!support.supported || !isFirebaseConfigured()) return;

    if (Notification.permission !== "granted") {
        // User revoked permission in browser settings → reflect it.
        writeStore({ enabled: false, token: null });
        return;
    }

    try {
        const registration = await registerWorker();
        const token = await fetchToken(registration);
        if (!token) return;
        await registerPushDevice(token);
        if (token !== store.token) writeStore({ enabled: true, token });
    } catch (err) {
        console.warn("[push] token sync failed:", err.message);
    }
}

/**
 * Messages from the service worker:
 *   FLUX_PUSH               a push just arrived (refresh the bell)
 *   FLUX_OPEN_NOTIFICATION  a system notification was clicked (open its details modal)
 * Returns a cleanup function.
 */
export function listenToServiceWorker({ onPush, onOpen }) {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return () => {};

    const handler = (event) => {
        const msg = event.data;
        if (!msg || typeof msg !== "object") return;
        if (msg.type === "FLUX_PUSH") onPush?.(msg.payload);
        else if (msg.type === "FLUX_OPEN_NOTIFICATION") onOpen?.(msg.id);
    };

    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
}
