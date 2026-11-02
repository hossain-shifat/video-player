/* FLUX push service worker — served from the site root so its scope is "/".
 *
 * FCM delivers DATA-ONLY messages (see server/services/pushService.js), so this
 * file decides how to display them. No Firebase SDK is needed in here: the page
 * uses firebase/messaging only to obtain the registration token; the browser's
 * push service hands the payload straight to the "push" event below.
 *
 * Payload fields (all strings): title, body, type, notificationId, tag
 * Deliberately minimal — no destination, no personal data. Clicking opens the
 * notification-details modal in the app, which loads everything else from the
 * authenticated API (so access control is enforced on the server).
 */

// Bump when this file changes in a way that matters, so it's obvious which copy a browser is running
// (DevTools → Application → Service Workers). The byte change also triggers the browser's update check.
const SW_VERSION = "2026-10-21.2";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// FLUX identity for the notification.
// Chrome/Android cannot render an SVG as a notification icon, and the repo ships no PNG icon files. So the page
// (src/utils/push.js → ensureBrandIcons) draws the FLUX icon/badge PNGs from /logo.svg and stores them as data
// URLs in Cache Storage; they are read here. A real /icons/icon-192.png, if you ever add one, takes priority.
// Never fall back to /logo.svg or a missing file: an unusable icon makes Chrome show ITS OWN logo instead.
let _brand = null;
function brandIcons() {
    if (!_brand) {
        _brand = (async () => {
            try {
                // Vite's dev server and SPA fallbacks answer 200 + index.html for files that don't exist,
                // so "ok" is not enough — it must really be an image.
                const head = await fetch("/icons/icon-192.png", { method: "HEAD" });
                if (head.ok && /^image\//i.test(head.headers.get("content-type") || "")) return { icon: "/icons/icon-192.png", badge: undefined };
            } catch {
                /* offline / not present — use the generated icon */
            }
            try {
                const cache = await caches.open("flux-brand-v1");
                const [i, b] = await Promise.all([cache.match("/__flux/notification-icon.txt"), cache.match("/__flux/notification-badge.txt")]);
                return { icon: i ? await i.text() : undefined, badge: b ? await b.text() : undefined };
            } catch {
                return { icon: undefined, badge: undefined };
            }
        })();
    }
    return _brand;
}

function readPayload(event) {
    if (!event.data) return null;

    let raw;
    try {
        raw = event.data.json();
    } catch {
        return { title: "FLUX", body: event.data.text() };
    }

    // FCM wraps data messages as { data: {...}, from, ... }. Be tolerant of a
    // flat payload or a "notification" object too.
    const d = (raw && (raw.data || raw.notification)) || raw || {};
    return {
        title: d.title || "FLUX",
        body: d.body || "",
        type: d.type || "system",
        notificationId: d.notificationId || "",
        tag: d.tag || d.notificationId || d.type || "flux",
    };
}

self.addEventListener("push", (event) => {
    event.waitUntil(
        (async () => {
            const p = readPayload(event);
            if (!p) return;

            const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

            // Tell every open tab so the bell/badge refreshes immediately.
            for (const c of windows) c.postMessage({ type: "FLUX_PUSH", payload: p });

            // If the user is actively looking at FLUX, the in-app bell is enough —
            // don't also pop a system notification on top of it.
            if (windows.some((c) => c.visibilityState === "visible")) return;

            const { icon, badge } = await brandIcons();
            if (!icon) {
                _brand = null; // the page hasn't generated it yet (first run) — look again next time
            }

            await self.registration.showNotification(p.title, {
                body: p.body,
                tag: p.tag, // same id → the browser replaces instead of stacking duplicates
                icon,
                badge,
                timestamp: Date.now(),
                // Security alerts stay on screen until acted on; everything else follows the OS default.
                requireInteraction: p.type === "security",
                data: { notificationId: p.notificationId },
            });
        })(),
    );
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();

    const id = (event.notification.data && event.notification.data.notificationId) || "";
    const target = self.location.origin + (id ? "/?n=" + encodeURIComponent(id) : "/");

    event.waitUntil(
        (async () => {
            const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
            for (const c of windows) {
                if (new URL(c.url).origin === self.location.origin) {
                    await c.focus();
                    // The SPA (main.jsx) routes client-side — no reload, so playback isn't interrupted.
                    c.postMessage({ type: "FLUX_OPEN_NOTIFICATION", id });
                    return;
                }
            }
            await self.clients.openWindow(target);
        })(),
    );
});
