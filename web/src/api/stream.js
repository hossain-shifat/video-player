/**
 * stream.js — FLUX Web API
 *
 * FIX: resolvePlayback now calls GET /stream/video/:id?info=1 (exists on backend)
 *      instead of GET /stream/info/:id (never existed → was causing 404 on every
 *      play attempt → PlayerPage always failed → black screen).
 *
 * The backend GET /stream/video/:id?info=1 returns:
 *   Direct:  { mode: "direct", streamUrl: "http://...", duration, decision }
 *   HLS:     { mode: "hls", sessionId, hlsUrl: "/stream/hls/.../index.m3u8",
 *              decision, startSegment, segmentDuration }
 *
 * For HLS the backend already starts the transcoding session and waits for
 * the manifest before responding — no separate POST /stream/transcode needed.
 *
 * hlsUrl from backend is a relative path (/stream/hls/...) — we prepend BASE.
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

// ─── Resolve playback ─────────────────────────────────────────────────────────
/**
 * resolvePlayback — main entry for PlayerPage.
 *
 * Calls GET /stream/video/:id?info=1 which:
 *   1. Probes the file with ffprobe
 *   2. Decides direct/HLS based on codec + container
 *   3. For HLS: starts the transcoder session and waits for manifest
 *   4. Returns stream URL (absolute for direct, relative for HLS)
 *
 * @param {string} mediaId
 * @param {object} opts - { seekSec, quality, forceTranscode }
 * @returns {Promise<PlaybackInfo>}
 */
export async function resolvePlayback(mediaId, opts = {}) {
    const clientId = getOrCreateClientId();

    const qs = new URLSearchParams({ info: "1" });
    if (opts.seekSec > 0) qs.set("t", String(opts.seekSec));
    if (opts.quality) qs.set("quality", opts.quality);
    if (opts.forceTranscode) qs.set("transcode", "1");
    if (opts.maxHeight) qs.set("maxHeight", String(opts.maxHeight));

    const res = await fetch(`${BASE}/stream/video/${encodeURIComponent(mediaId)}?${qs}`, { headers: { "X-Flux-Client": clientId } });

    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Stream resolve failed: HTTP ${res.status}`);
    }

    const data = await res.json();

    if (data.mode === "direct") {
        return {
            mode: "direct",
            // streamUrl from backend is already absolute (includes BASE)
            streamUrl: data.streamUrl,
            sessionId: null,
            duration: data.duration || null,
            clientId,
        };
    }

    // HLS — backend returns relative hlsUrl e.g. /stream/hls/<id>/index.m3u8
    // VideoCore / HLS.js needs an absolute URL.
    const hlsUrl = data.hlsUrl?.startsWith("http") ? data.hlsUrl : `${BASE}${data.hlsUrl}`;

    return {
        mode: "hls",
        hlsUrl,
        sessionId: data.sessionId,
        startSegment: data.startSegment || 0,
        segmentDuration: data.segmentDuration || 4,
        duration: data.duration || null,
        clientId,
    };
}

// ─── Session heartbeat ────────────────────────────────────────────────────────
/**
 * heartbeatSession — POST /stream/sessions/:id/ping
 *
 * Sends positionSec so server's segment cleaner knows what's safe to delete.
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
    }).catch(() => {});
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
