/**
 * stream.js — FLUX Web API v4
 *
 * FIXED over v3:
 *  1. Uses new /stream/info/:id pre-flight endpoint (zero-latency play decision)
 *     instead of old /stream/video/:id?info=1
 *  2. HLS session start via POST /stream/transcode/:id (with warmup gate)
 *  3. heartbeatSession sends positionSec in body (was sending empty {})
 *  4. URL handling: backend v4 returns ABSOLUTE URLs — no more double-prefix
 *  5. Client ID generation moved here (single source of truth)
 */

const BASE = import.meta.env.VITE_API_URL || "http://localhost:5000";
const CLIENT_ID_KEY = "flux_client_id";

// ─── Client ID ────────────────────────────────────────────────────────────────

export function getOrCreateClientId() {
    try {
        let id = localStorage.getItem(CLIENT_ID_KEY);
        if (!id) {
            id = `web_${Math.random().toString(36).slice(2, 12)}_${Date.now().toString(36)}`;
            localStorage.setItem(CLIENT_ID_KEY, id);
        }
        return id;
    } catch {
        return "web_anonymous";
    }
}

// ─── Pre-flight stream info ────────────────────────────────────────────────────
/**
 * getStreamInfo — calls GET /stream/info/:id
 *
 * Returns decision WITHOUT starting transcoder.
 * Jellyfin equivalent: /Videos/{id}/PlaybackInfo
 *
 * @param {string} mediaId
 * @param {object} opts - { seekSec, quality, forceTranscode, maxHeight }
 * @returns {Promise<StreamInfo>}
 */
export async function getStreamInfo(mediaId, opts = {}) {
    const clientId = getOrCreateClientId();
    const qs = new URLSearchParams({ clientId });
    if (opts.seekSec > 0) qs.set("t", String(opts.seekSec));
    if (opts.quality) qs.set("quality", opts.quality);
    if (opts.forceTranscode) qs.set("transcode", "1");
    if (opts.maxHeight) qs.set("maxHeight", String(opts.maxHeight));

    const res = await fetch(`${BASE}/stream/info/${encodeURIComponent(mediaId)}?${qs}`, {
        headers: { "X-Flux-Client": clientId },
    });
    if (!res.ok) throw new Error(`Stream info failed: HTTP ${res.status}`);
    const data = await res.json();
    return { ...data, clientId };
}

// ─── Start HLS transcode session ──────────────────────────────────────────────
/**
 * startHLSSession — POSTs to /stream/transcode/:id
 *
 * Server generates warmup segments before responding.
 * Returns { sessionId, hlsUrl, startSegment, segmentDuration, ... }
 *
 * @param {string} mediaId
 * @param {object} opts - { seekSec, quality, forceTranscode }
 * @returns {Promise<HLSSession>}
 */
export async function startHLSSession(mediaId, opts = {}) {
    const clientId = getOrCreateClientId();
    const res = await fetch(`${BASE}/stream/transcode/${encodeURIComponent(mediaId)}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Flux-Client": clientId,
        },
        body: JSON.stringify({
            startAt: opts.seekSec || 0,
            quality: opts.quality || null,
            clientId,
        }),
    });
    if (!res.ok) throw new Error(`Start HLS failed: HTTP ${res.status}`);
    const data = await res.json();
    // hlsUrl from v4 backend is absolute — no prefix needed
    return { ...data, clientId };
}

// ─── Combined resolve: info → start if needed ─────────────────────────────────
/**
 * resolvePlayback — main entry point for player.
 *
 * 1. Calls /stream/info/:id for decision (instant, no transcode start)
 * 2. For direct play: returns streamUrl immediately
 * 3. For HLS: POSTs to start session, waits for warmup, returns hlsUrl
 *
 * @param {string} mediaId
 * @param {object} opts
 * @returns {Promise<PlaybackInfo>}
 */
export async function resolvePlayback(mediaId, opts = {}) {
    const clientId = getOrCreateClientId();

    try {
        const info = await getStreamInfo(mediaId, opts);

        if (info.mode === "direct") {
            return {
                mode: "direct",
                streamUrl: info.streamUrl, // already absolute from v4 backend
                sessionId: null,
                duration: info.duration,
                mediaInfo: info.mediaInfo,
                clientId,
            };
        }

        // HLS: start session (includes warmup wait on server)
        const session = await startHLSSession(mediaId, opts);
        return {
            mode: "hls",
            hlsUrl: session.hlsUrl, // absolute URL from v4 backend
            sessionId: session.sessionId,
            startSegment: session.startSegment || 0,
            segmentDuration: session.segmentDuration || 4,
            duration: session.duration || info.duration,
            mediaInfo: info.mediaInfo,
            clientId,
        };
    } catch (err) {
        console.warn("[resolvePlayback] Failed, falling back to direct URL:", err.message);
        // Last-resort fallback — direct URL attempt (may fail for HEVC/unsupported)
        return {
            mode: "direct",
            streamUrl: `${BASE}/stream/video/${encodeURIComponent(mediaId)}`,
            sessionId: null,
            clientId,
            _fallback: true,
        };
    }
}

// ─── Session heartbeat ────────────────────────────────────────────────────────
/**
 * heartbeatSession — POST /stream/sessions/:id/ping
 *
 * FIXED: v3 sent empty body; v4 sends positionSec for server-side
 * position-aware segment cleanup.
 *
 * @param {string} sessionId
 * @param {number} positionSec - current playback position
 * @param {string} [clientId]
 */
export function heartbeatSession(sessionId, positionSec = 0, clientId) {
    if (!sessionId) return Promise.resolve();
    const cid = clientId || getOrCreateClientId();
    return fetch(`${BASE}/stream/sessions/${sessionId}/ping`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Flux-Client": cid,
        },
        body: JSON.stringify({ positionSec }),
    }).catch(() => {}); // non-fatal
}

// ─── Stop session ─────────────────────────────────────────────────────────────

export function stopSession(sessionId, clientId) {
    if (!sessionId) return Promise.resolve();
    const cid = clientId || getOrCreateClientId();
    return fetch(`${BASE}/stream/sessions/${sessionId}`, {
        method: "DELETE",
        headers: { "X-Flux-Client": cid },
        keepalive: true,
    }).catch(() => {});
}
