import { api } from "./client";

const CLIENT_ID_KEY = "flux_client_id";

export function getOrCreateClientId() {
    try {
        let id = localStorage.getItem(CLIENT_ID_KEY);
        if (!id) {
            id = `web_${Math.random().toString(36).slice(2, 12)}`;
            localStorage.setItem(CLIENT_ID_KEY, id);
        }
        return id;
    } catch {
        return "web_anonymous";
    }
}

/**
 * Resolve playback URL.
 *
 * Calls GET /stream/video/:id?info=1 — server probes the file and returns JSON:
 *   Direct play   → { mode:"direct", streamUrl }
 *   HLS transcode → { mode:"hls", hlsUrl, sessionId }
 *
 * Using ?info=1 avoids CORB: without it the server returns a 302 redirect
 * whose HTML body is blocked by the browser when received as a cross-origin
 * response to a <video> element request.
 */
export async function resolvePlayback(mediaId, options = {}) {
    const clientId = getOrCreateClientId();
    const BASE = import.meta.env.VITE_API_URL || "http://localhost:5000";

    try {
        const qs = new URLSearchParams({ info: "1", clientId });
        if (options.maxHeight) qs.set("maxHeight", String(options.maxHeight));
        if (options.profile) qs.set("profile", options.profile);

        const data = await fetch(`${BASE}/stream/video/${encodeURIComponent(mediaId)}?${qs}`, {
            headers: { "X-Flux-Client": clientId },
        }).then((r) => {
            if (!r.ok) throw new Error(`Server probe failed: ${r.status}`);
            return r.json();
        });

        // Prefix relative URLs with BASE
        if (data.hlsUrl && !data.hlsUrl.startsWith("http")) data.hlsUrl = `${BASE}${data.hlsUrl}`;
        if (data.streamUrl && !data.streamUrl.startsWith("http")) data.streamUrl = `${BASE}${data.streamUrl}`;

        return { ...data, clientId };
    } catch (err) {
        console.warn("[resolvePlayback] Server probe failed, falling back to direct URL:", err.message);
        return {
            mode: "direct",
            clientId,
            streamUrl: `${BASE}/stream/video/${encodeURIComponent(mediaId)}`,
        };
    }
}

/**
 * Heartbeat — keep transcode session alive.
 * No-op if no sessionId (direct play has no session).
 */
export function heartbeatSession(sessionId, clientId) {
    if (!sessionId) return Promise.resolve();
    return api.post(`/stream/sessions/${sessionId}/ping`, {}, { headers: { "X-Flux-Client": clientId || getOrCreateClientId() } }).catch(() => {}); // non-fatal
}

/**
 * Stop transcode session.
 * No-op if no sessionId.
 */
export function stopSession(sessionId, clientId) {
    if (!sessionId) return Promise.resolve();
    return api
        .delete(`/stream/sessions/${sessionId}`, {
            headers: { "X-Flux-Client": clientId || getOrCreateClientId() },
        })
        .catch(() => {}); // non-fatal
}
