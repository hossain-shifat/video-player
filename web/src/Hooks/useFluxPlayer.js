import { useState, useEffect, useRef, useCallback } from "react";
import { getStreamInfo, pingSession, killSession } from "../api/stream";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:5000";

/**
 * useFluxPlayer(mediaId, startTime)
 *
 * Calls GET /stream/video/:id?info=1 to get stream decision.
 * Manages HLS session lifecycle: ping every 10s, kill on unmount.
 *
 * Returns:
 *   mode:        "direct" | "hls" | null
 *   streamUrl:   full URL for direct play
 *   hlsUrl:      full URL for HLS manifest
 *   sessionId:   active transcode session id
 *   decision:    backend decision string
 *   duration:    seconds (null if unknown)
 *   loading:     bool
 *   error:       string | null
 *   restart:     fn(seekSec) — restart with new seek position
 *   killCurrent: fn() — kill current session
 */
export default function useFluxPlayer(mediaId, startTime = 0) {
    const [state, setState] = useState({
        mode: null,
        streamUrl: null,
        hlsUrl: null,
        sessionId: null,
        decision: null,
        duration: null,
        loading: true,
        error: null,
    });

    const sessionRef = useRef(null);
    const pingRef = useRef(null);
    const getPositionRef = useRef(null); // fn() → current playhead seconds

    const stopPing = useCallback(() => {
        if (pingRef.current) {
            clearInterval(pingRef.current);
            pingRef.current = null;
        }
    }, []);

    const killCurrent = useCallback(async () => {
        stopPing();
        if (sessionRef.current) {
            await killSession(sessionRef.current).catch(() => {});
            sessionRef.current = null;
        }
    }, [stopPing]);

    /** Start ping loop for an active HLS session */
    const startPing = useCallback(
        (sessionId, getPosition) => {
            stopPing();
            getPositionRef.current = getPosition;
            pingRef.current = setInterval(() => {
                const pos = getPositionRef.current?.() ?? 0;
                if (pos > 0) pingSession(sessionId, pos).catch(() => {});
            }, 10_000);
        },
        [stopPing],
    );

    const load = useCallback(
        async (seekSec = 0) => {
            if (!mediaId) return;
            await killCurrent();
            setState((s) => ({ ...s, loading: true, error: null }));

            try {
                const data = await getStreamInfo(mediaId, { t: seekSec });

                const newSessionId = data.sessionId || null;
                sessionRef.current = newSessionId;

                setState({
                    mode: data.mode,
                    streamUrl: data.mode === "direct" ? `${BASE}/stream/video/${mediaId}` : null,
                    hlsUrl: data.hlsUrl ? `${BASE}${data.hlsUrl}` : null,
                    sessionId: newSessionId,
                    decision: data.decision,
                    duration: data.duration || null,
                    loading: false,
                    error: null,
                });
            } catch (err) {
                setState((s) => ({ ...s, loading: false, error: err.message }));
            }
        },
        [mediaId, killCurrent],
    );

    // Load on mount / mediaId change
    useEffect(() => {
        load(startTime);
        return () => {
            killCurrent();
        };
    }, [mediaId]); // eslint-disable-line react-hooks/exhaustive-deps

    return { ...state, startPing, stopPing, killCurrent, restart: load };
}
