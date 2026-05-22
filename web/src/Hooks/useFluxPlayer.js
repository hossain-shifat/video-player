/**
 * useFluxPlayer.js — FLUX v4
 *
 * Lightweight hook for components that need direct player access
 * WITHOUT the full PlayerPage stack (e.g. inline previews, trailers).
 *
 * For the main player → use PlayerPage + VideoCore directly.
 *
 * FIXED over v3:
 *  1. Uses new resolvePlayback() from api/stream.js (pre-flight + warmup)
 *  2. HLS URL is absolute (v4 backend) — no double-prefix
 *  3. Heartbeat sends positionSec correctly
 *  4. Cleanup uses keepalive DELETE (survives page close)
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { resolvePlayback, heartbeatSession, stopSession } from "../api/stream";

const PING_MS = 10_000;

export function useFluxPlayer({ mediaId, autoPlay = false, quality, forceTranscode = false }) {
    const videoRef = useRef(null);
    const hlsRef = useRef(null);

    const [status, setStatus] = useState("idle"); // idle | loading | playing | error
    const [error, setError] = useState(null);
    const [sessionId, setSid] = useState(null);
    const [mode, setMode] = useState(null);
    const [currentTime, setCT] = useState(0);
    const [duration, setDur] = useState(0);

    const sidRef = useRef(null);
    useEffect(() => {
        sidRef.current = sessionId;
    }, [sessionId]);

    // Heartbeat
    useEffect(() => {
        if (!sessionId) return;
        const t = setInterval(() => {
            const pos = videoRef.current?.currentTime || 0;
            heartbeatSession(sessionId, pos);
        }, PING_MS);
        return () => clearInterval(t);
    }, [sessionId]);

    // Cleanup
    const cleanup = useCallback(() => {
        const hls = hlsRef.current;
        hlsRef.current = null;
        if (hls) hls.destroy();
        if (sidRef.current) {
            stopSession(sidRef.current);
            sidRef.current = null;
        }
        setSid(null);
        setMode(null);
        setStatus("idle");
    }, []);
    useEffect(() => () => cleanup(), [cleanup]);

    // Load
    const load = useCallback(
        async (seekSec = 0) => {
            if (!mediaId) return;
            cleanup();
            setStatus("loading");
            setError(null);

            let playback;
            try {
                playback = await resolvePlayback(mediaId, { seekSec, quality, forceTranscode });
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

            if (playback.mode === "direct") {
                setMode("direct");
                video.src = playback.streamUrl;
                if (seekSec > 0) {
                    video.addEventListener(
                        "loadedmetadata",
                        () => {
                            video.currentTime = seekSec;
                        },
                        { once: true },
                    );
                }
                if (autoPlay) video.play().catch(() => {});
                setStatus("playing");
                return;
            }

            // HLS
            setMode("hls");
            setSid(playback.sessionId);
            sidRef.current = playback.sessionId;

            const hlsUrl = playback.hlsUrl; // absolute URL from v4 backend

            if (video.canPlayType("application/vnd.apple.mpegurl")) {
                video.src = hlsUrl;
                if (autoPlay) video.play().catch(() => {});
                setStatus("playing");
                return;
            }

            const { default: Hls } = await import("hls.js");
            if (!Hls.isSupported()) {
                setError("HLS not supported");
                setStatus("error");
                return;
            }

            const hls = new Hls({
                enableWorker: true,
                lowLatencyMode: false,
                backBufferLength: 30,
                maxBufferLength: 30,
                maxMaxBufferLength: 60,
                startPosition: seekSec > 0 ? seekSec : -1,
                fragLoadingMaxRetry: 3,
                manifestLoadingMaxRetry: 2,
                fragLoadingTimeOut: 30_000,
            });

            hls.loadSource(hlsUrl);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                if (autoPlay) video.play().catch(() => {});
                setStatus("playing");
            });
            hls.on(Hls.Events.ERROR, (_, data) => {
                if (!data.fatal) return;
                if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                    hls.startLoad(video.currentTime);
                } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                    hls.recoverMediaError();
                } else {
                    setError(`HLS: ${data.details}`);
                    setStatus("error");
                }
            });
            hlsRef.current = hls;
        },
        [mediaId, quality, forceTranscode, autoPlay, cleanup],
    );

    useEffect(() => {
        load(0);
    }, [load]);

    // Time tracking
    useEffect(() => {
        const v = videoRef.current;
        if (!v) return;
        const onTime = () => setCT(v.currentTime);
        const onDur = () => setDur(v.duration || 0);
        v.addEventListener("timeupdate", onTime);
        v.addEventListener("durationchange", onDur);
        return () => {
            v.removeEventListener("timeupdate", onTime);
            v.removeEventListener("durationchange", onDur);
        };
    }, []);

    const seek = useCallback(
        (sec) => {
            const v = videoRef.current;
            if (!v) return;
            if (mode === "direct") {
                v.currentTime = sec;
                return;
            }
            load(sec);
        },
        [mode, load],
    );

    return { videoRef, status, error, mode, sessionId, currentTime, duration, seek, reload: () => load(currentTime) };
}
