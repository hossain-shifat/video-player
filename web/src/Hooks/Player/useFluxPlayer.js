/**
 * useFluxPlayer.js
 *
 * React hook that wraps HLS.js and the FLUX streaming API.
 *
 * Handles:
 *  - Fetching stream decision from /stream/video/:id?info=1
 *  - Attaching HLS.js for HLS streams
 *  - Direct play via <video src> for direct play
 *  - Session ping heartbeat (keeps session alive + updates downloadPosition)
 *  - Seek detection → triggers new ?t= session if backend needs restart
 *  - Session cleanup on unmount
 *
 * Usage:
 *   const { videoRef, status, error, currentTime, duration } = useFluxPlayer({ mediaId, autoPlay });
 *   <video ref={videoRef} controls />
 */

import { useEffect, useRef, useState, useCallback } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000";
const PING_INTERVAL_MS = 10_000; // ping every 10s

// Lazy-load HLS.js only when needed (avoids bundling for direct-play users)
let _hlsPromise = null;
function loadHlsJs() {
    if (!_hlsPromise) {
        _hlsPromise = import("hls.js").then((m) => m.default || m);
    }
    return _hlsPromise;
}

export function useFluxPlayer({ mediaId, autoPlay = false, quality, forceTranscode = false }) {
    const videoRef = useRef(null);
    const hlsRef = useRef(null);

    const [status, setStatus] = useState("idle"); // idle | loading | playing | error
    const [error, setError] = useState(null);
    const [sessionId, setSessionId] = useState(null);
    const [mode, setMode] = useState(null); // direct | hls
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);

    const sessionIdRef = useRef(null);

    // Keep sessionId in ref for use inside intervals/callbacks
    useEffect(() => {
        sessionIdRef.current = sessionId;
    }, [sessionId]);

    // ── Ping heartbeat ────────────────────────────────────────────────────────

    useEffect(() => {
        if (!sessionId) return;
        const interval = setInterval(() => {
            const vid = videoRef.current;
            const pos = vid ? vid.currentTime : 0;
            fetch(`${API_BASE}/stream/sessions/${sessionId}/ping`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ positionSec: pos }),
            }).catch(() => {});
        }, PING_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [sessionId]);

    // ── Cleanup on unmount or mediaId change ──────────────────────────────────

    const cleanup = useCallback(() => {
        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }
        if (sessionIdRef.current) {
            // Best-effort: kill session on server
            fetch(`${API_BASE}/stream/sessions/${sessionIdRef.current}`, {
                method: "DELETE",
                keepalive: true,
            }).catch(() => {});
            sessionIdRef.current = null;
        }
        setSessionId(null);
        setMode(null);
        setStatus("idle");
    }, []);

    useEffect(() => () => cleanup(), [cleanup]);

    // ── Main load effect ──────────────────────────────────────────────────────

    const load = useCallback(
        async (seekSec = 0) => {
            if (!mediaId) return;

            cleanup();
            setStatus("loading");
            setError(null);

            const params = new URLSearchParams({ info: "1" });
            if (seekSec > 0) params.set("t", String(seekSec));
            if (quality) params.set("quality", quality);
            if (forceTranscode) params.set("transcode", "1");

            let info;
            try {
                const res = await fetch(`${API_BASE}/stream/video/${encodeURIComponent(mediaId)}?${params}`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                info = await res.json();
            } catch (e) {
                setError(e.message);
                setStatus("error");
                return;
            }

            const video = videoRef.current;
            if (!video) {
                setStatus("error");
                setError("Video element not mounted");
                return;
            }

            // ── Direct play ───────────────────────────────────────────────────────
            if (info.mode === "direct") {
                setMode("direct");
                video.src = info.streamUrl;
                if (seekSec > 0) video.currentTime = seekSec;
                if (autoPlay) video.play().catch(() => {});
                setStatus("playing");
                return;
            }

            // ── HLS ───────────────────────────────────────────────────────────────
            if (info.mode === "hls") {
                setMode("hls");
                setSessionId(info.sessionId);
                sessionIdRef.current = info.sessionId;

                const hlsUrl = `${API_BASE}${info.hlsUrl}`;

                // Native HLS (Safari)
                if (video.canPlayType("application/vnd.apple.mpegurl")) {
                    video.src = hlsUrl;
                    if (autoPlay) video.play().catch(() => {});
                    setStatus("playing");
                    return;
                }

                // HLS.js
                let Hls;
                try {
                    Hls = await loadHlsJs();
                } catch {
                    setError("HLS.js failed to load");
                    setStatus("error");
                    return;
                }

                if (!Hls.isSupported()) {
                    setError("HLS not supported in this browser");
                    setStatus("error");
                    return;
                }

                const hls = new Hls({
                    // These settings match what Jellyfin/Plex clients use
                    enableWorker: true,
                    lowLatencyMode: false,
                    backBufferLength: 30, // keep 30s behind playhead
                    maxBufferLength: 30, // buffer up to 30s ahead
                    maxMaxBufferLength: 60,
                    startFragPrefetch: true,
                    // Don't start over when a segment is not found — wait
                    fragLoadingMaxRetry: 6,
                    fragLoadingRetryDelay: 500,
                    manifestLoadingMaxRetry: 4,
                    // Important: don't abandon segments too quickly
                    fragLoadingTimeOut: 30_000,
                });

                hls.loadSource(hlsUrl);
                hls.attachMedia(video);

                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    if (autoPlay) video.play().catch(() => {});
                    setStatus("playing");
                });

                hls.on(Hls.Events.ERROR, (_, data) => {
                    if (data.fatal) {
                        console.error("[HLS] Fatal error:", data.type, data.details);
                        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                            hls.startLoad(); // try to recover
                        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                            hls.recoverMediaError();
                        } else {
                            setError(`HLS fatal: ${data.details}`);
                            setStatus("error");
                        }
                    }
                });

                hlsRef.current = hls;
            }
        },
        [mediaId, quality, forceTranscode, autoPlay, cleanup],
    );

    // Load on mediaId change
    useEffect(() => {
        load(0);
    }, [load]);

    // ── Video time tracking ───────────────────────────────────────────────────
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        const onTime = () => setCurrentTime(video.currentTime);
        const onDuration = () => setDuration(video.duration || 0);
        video.addEventListener("timeupdate", onTime);
        video.addEventListener("durationchange", onDuration);
        return () => {
            video.removeEventListener("timeupdate", onTime);
            video.removeEventListener("durationchange", onDuration);
        };
    }, []);

    // ── Exposed seek function ─────────────────────────────────────────────────
    // For HLS: restart session at new seek point (server handles it)
    // For direct play: just set currentTime
    const seek = useCallback(
        (sec) => {
            const video = videoRef.current;
            if (!video) return;
            if (mode === "direct") {
                video.currentTime = sec;
                return;
            }
            // HLS: reload session from new position
            // The backend will detect gap and restart FFmpeg if needed
            load(sec);
        },
        [mode, load],
    );

    return {
        videoRef,
        status,
        error,
        mode,
        sessionId,
        currentTime,
        duration,
        seek,
        reload: () => load(currentTime),
    };
}
