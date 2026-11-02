"use strict";

/**
 * auth/middleware/rateLimit.js
 * Tiny in-memory fixed-window rate limiter (no new dependency).
 * FLUX runs as a single Node process, so in-process counters are exact.
 *
 *   router.post("/login", rateLimit({ name: "login", max: 10, windowMs: 15 * 60_000 }), handler)
 *
 * Keys: client IP by default; pass `keyFn(req)` to key on something else (e.g. account id)
 * — an array of keys is allowed, and ALL must be under the limit.
 * Behind a reverse proxy set `app.set("trust proxy", 1)` so req.ip is the real client.
 */

const buckets = new Map(); // `${name}|${key}` → { count, resetAt }

function hit(name, key, max, windowMs, now = Date.now()) {
    const id = `${name}|${key}`;
    let b = buckets.get(id);
    if (!b || b.resetAt <= now) {
        b = { count: 0, resetAt: now + windowMs };
        buckets.set(id, b);
    }
    b.count += 1;
    return { allowed: b.count <= max, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
}

function rateLimit({ name, max, windowMs, keyFn, message = "Too many attempts. Please try again later." }) {
    return function rateLimitMiddleware(req, res, next) {
        const raw = keyFn ? keyFn(req) : req.ip;
        const keys = (Array.isArray(raw) ? raw : [raw]).filter(Boolean).map(String);
        if (!keys.length) keys.push("unknown");
        let worst = null;
        for (const k of keys) {
            const r = hit(name, k, max, windowMs);
            if (!r.allowed && (!worst || r.retryAfterSec > worst.retryAfterSec)) worst = r;
        }
        if (worst) {
            res.setHeader("Retry-After", String(worst.retryAfterSec));
            return res.status(429).json({ error: message, code: "RATE_LIMITED", retryAfterSec: worst.retryAfterSec });
        }
        next();
    };
}

// Housekeeping so the map cannot grow forever
const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [id, b] of buckets) if (b.resetAt <= now) buckets.delete(id);
}, 5 * 60_000);
sweeper.unref?.();

function _resetForTests() {
    buckets.clear();
}

module.exports = { rateLimit, _resetForTests };
