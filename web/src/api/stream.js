/**
 * stream.js — FLUX Web API (web/src/api/stream.js)
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
        // FIX: ffmpeg's actual -ss seek target is
        // sourceStartOffset + startSegment*segmentDuration
        // (transcoderService.js), not just startSegment*segmentDuration.
        // The backend now reports sourceStartOffset as startTimeOffset —
        // without passing it through here, PlayerPage.jsx's own
        // sessionOffset math (subtitle clock, resume position, seek bar)
        // was silently wrong by that amount for any file with a non-zero
        // container start_time (documented MKV-remux case in
        // streamingEngine.js's extractMediaInfo).
        startTimeOffset: data.startTimeOffset || 0,
        // NEW — this is the actual fix for "resume plays from the wrong
        // spot" / audio-video mismatch specifically ON RESUME. The server
        // has been computing this the whole time (transcoderService.js's
        // measureRealStartOffset, session.measuredStartOffset) and
        // returning it right here in this same response — this function
        // just never read it. `-c:v copy` can't seek to an arbitrary
        // frame, only to the nearest keyframe at/after the requested
        // point (0.8s–9.6s past target, confirmed in production logs) —
        // that's unavoidable without re-encoding video. The fix isn't to
        // eliminate that snap, it's to tell the PLAYER where video
        // actually landed, so the seek bar / subtitle clock / resume
        // position all agree with reality instead of the original request.
        // Usually null on this FIRST response (the probe that measures it
        // runs async, doesn't block this reply — see streamController.js's
        // own "reverted: was blocking here" comment), so PlayerPage should
        // treat this as "if present, use it," and get the real value a few
        // seconds later from heartbeatSession's response instead (now
        // wired below — this was being silently discarded before).
        measuredStartOffset: data.measuredStartOffset ?? null,
        duration: data.duration || null,
        clientId,
    };
}

// ─── Session heartbeat ────────────────────────────────────────────────────────
//
// FIX (the actual resume/lip-sync-on-resume bug): this used to fire the
// ping and throw away the response entirely (`.catch(() => {})`, no
// `.then()`). The server's ping endpoint (streamController.js) has always
// returned `measuredStartOffset` and `avGapSec` in that response — real,
// per-session-measured values telling the client exactly where video
// actually landed after a resume seek and how far audio currently trails
// it. Discarding the response meant that data reached the browser and was
// then thrown away every single ping, forever — nothing downstream could
// ever correct for the keyframe-snap drift AUDIO_TRANSCODE resumes always
// have. Now returns the parsed body so a caller (PlayerPage's ping
// interval) can actually apply the correction once it arrives.
export async function heartbeatSession(sessionId, positionSec = 0, clientId) {
    if (!sessionId) return null;
    const cid = clientId || getOrCreateClientId();
    try {
        const res = await fetch(`${BASE}/stream/sessions/${sessionId}/ping`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Flux-Client": cid,
            },
            body: JSON.stringify({ positionSec }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        return {
            downloadPositionSec: data.downloadPositionSec ?? null,
            measuredStartOffset: data.measuredStartOffset ?? null,
            avGapSec: data.avGapSec ?? null,
        };
    } catch {
        return null;
    }
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

// ─── Media info fallback (NEW) ─────────────────────────────────────────────────
/**
 * getMediaInfoFallback — queries the mediaInfoStore cache (data/mediainfo.json)
 * by media id. Used as a fallback language source when a live track list
 * shows "und"/missing for an audio or subtitle track — this returns the same
 * already-inferred { audioTracks, subtitleTracks } with real languageName
 * fields, so the picker can patch in a name instead of showing a placeholder.
 *
 * @param {string} mediaId
 * @returns {Promise<{audioTracks: Array, subtitleTracks: Array} | null>}
 */
export async function getMediaInfoFallback(mediaId) {
    if (!mediaId) return null;
    try {
        const res = await fetch(`${BASE}/stream/mediainfo/${encodeURIComponent(mediaId)}`);
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}
