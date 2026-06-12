/**
 * stream.js — FLUX Web API
 *
 * Single-user self-hosted install — no auth tokens needed.
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
 *   1. Probes file with ffprobe
 *   2. Decides direct/HLS based on codec + container
 *   3. For HLS: starts transcoder session, waits for manifest
 *   4. Returns stream URL
 *
 * @param {string} mediaId
 * @param {object} opts - { seekSec, quality, forceTranscode, maxHeight }
 * @returns {Promise<PlaybackInfo>}
 */
export async function resolvePlayback(mediaId, opts = {}) {
    const clientId = getOrCreateClientId();

    const qs = new URLSearchParams({ info: "1" });
    if (opts.seekSec > 0) qs.set("t", String(opts.seekSec));
    if (opts.quality) qs.set("quality", opts.quality);
    if (opts.forceTranscode) qs.set("transcode", "1");
    if (opts.maxHeight) qs.set("maxHeight", String(opts.maxHeight));

    const res = await fetch(`${BASE}/stream/video/${encodeURIComponent(mediaId)}?${qs}`, {
        headers: { "X-Flux-Client": clientId },
    });

    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Stream resolve failed: HTTP ${res.status}`);
    }

    const data = await res.json();

    if (data.mode === "direct") {
        return {
            mode: "direct",
            streamUrl: data.streamUrl,
            sessionId: null,
            duration: data.duration || null,
            clientId,
        };
    }

    // HLS — backend returns relative hlsUrl e.g. /stream/hls/<id>/index.m3u8
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
