// web/src/dashboard/upload/notifications.js
//
// Tray notifications for upload progress — deliberately the PLAIN
// `Notification` constructor, not `ServiceWorkerRegistration.showNotification`.
// The latter needs a Service Worker, which needs a secure context (HTTPS or
// localhost) — not available on a LAN IP over plain HTTP. This means:
//   - No true "closed tab" notifications (the page has to still be running).
//   - No native progress-bar widget — the Notification API has never exposed
//     one, on any browser; that's a native-app-only capability. This shows
//     the percentage as TEXT in the notification body instead, which is the
//     closest a browser tab can get.
//   - Chrome currently still allows plain `Notification` from a top-level
//     HTTP page (unlike iframes, which it blocked years ago), but this is
//     flagged deprecated and could be tightened without notice — an HTTPS
//     setup (even a free self-signed cert via mkcert) removes that risk
//     entirely, worth doing eventually but not required for this to work now.
//
// Every function here degrades to a silent no-op if Notification is
// unsupported, permission isn't granted, or the browser rejects the call for
// any reason — a notification failure must never affect the upload itself.

const isSupported = typeof window !== "undefined" && "Notification" in window;

// Android Chrome (and other mobile Chromium) has NEVER supported the plain
// `new Notification(...)` constructor from a page — it throws
// "Illegal constructor; use ServiceWorkerRegistration.showNotification()
// instead", specifically BECAUSE Android's OS-level notification model was
// built assuming a Service-Worker-backed channel. Desktop Chrome/Firefox/Edge
// have no such restriction. Since a Service Worker needs a secure context
// (HTTPS or localhost) — not available on a plain-HTTP LAN address — this
// means: no HTTPS => no working tray notifications on Android, full stop,
// not just "risky". This flag reflects whether we've actually confirmed that
// block on THIS browser (set the first time show() below actually throws),
// so the UI can say "not supported here" instead of quietly doing nothing
// while claiming to be "on".
let _constructorBlocked = false;
function isBlocked() {
    return _constructorBlocked;
}

function permissionState() {
    if (!isSupported) return "unsupported";
    return Notification.permission; // 'granted' | 'denied' | 'default'
}

// MUST be called from a real user gesture (a click handler) — same browser
// law as requestPermission() everywhere else. Returns the resulting state.
async function requestPermission() {
    if (!isSupported) return "unsupported";
    if (Notification.permission !== "default") return Notification.permission;
    try {
        return await Notification.requestPermission();
    } catch {
        return "denied";
    }
}

const _active = new Map(); // id -> Notification instance, so a later update/close can find it

// tag ensures a repeated call for the same id REPLACES the existing tray
// notification instead of stacking a new one on every progress tick.
function show(id, { title, body, silent = true }) {
    if (!isSupported || Notification.permission !== "granted" || _constructorBlocked) return null;
    try {
        const n = new Notification(title, { body, tag: `flux-upload-${id}`, silent, icon: "/favicon.ico" });
        _active.set(id, n);
        return n;
    } catch (err) {
        // This is the expected, permanent failure mode on Android Chrome
        // without a Service Worker (see the comment above _constructorBlocked)
        // — not a transient glitch, so stop trying for the rest of this
        // session instead of throwing (silently, since it's caught) on every
        // single progress tick.
        _constructorBlocked = true;
        console.warn(`[notifications] Notification constructor blocked on this browser (needs a Service Worker + HTTPS on Android) — disabling for this session:`, err.message);
        return null;
    }
}

function close(id) {
    const n = _active.get(id);
    if (n) {
        try {
            n.close();
        } catch {}
        _active.delete(id);
    }
}

export const notifications = { isSupported, isBlocked, permissionState, requestPermission, show, close };
