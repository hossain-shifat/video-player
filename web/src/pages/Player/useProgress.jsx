import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../../api/client";
import { getOrCreateClientId } from "../../api/stream";

function historyHeaders(clientId) {
    return { "X-Flux-Client": clientId || getOrCreateClientId() };
}

/**
 * @param {object} opts
 * @param {string} opts.mediaId
 * @param {string} [opts.clientId]
 * @param {string} opts.name
 * @param {string} opts.type
 * @param {string} opts.poster
 * @param {string} opts.streamUrl
 * @param {React.RefObject} opts.videoRef
 * @param {boolean} opts.playing
 * @param {number} opts.currentTime
 * @param {number} opts.duration
 */
export function useProgress({ mediaId, clientId, name, type, poster, streamUrl, videoRef, playing, currentTime, duration }) {
    const [resumePoint, setResumePoint] = useState(null);
    const [showResumeDialog, setShowResumeDialog] = useState(false);
    const [resumeCountdown, setResumeCountdown] = useState(5);
    const intervalRef = useRef(null);
    const countdownRef = useRef(null);
    const resolvedRef = useRef(false);
    const scopedClientId = clientId || getOrCreateClientId();

    const buildPayload = useCallback(
        (time) => ({
            name: name || "",
            type: type || "movie",
            poster: poster || null,
            streamUrl: streamUrl || null,
            position: Math.floor(time),
            duration: Math.floor(duration),
        }),
        [name, type, poster, streamUrl, duration],
    );

    const saveProgress = useCallback(
        async (time) => {
            if (!mediaId || !duration) return;
            try {
                await api.post(`/api/history/${mediaId}`, buildPayload(time), {
                    headers: historyHeaders(scopedClientId),
                });
            } catch {
                // don't disrupt playback
            }
        },
        [mediaId, duration, buildPayload, scopedClientId],
    );

    useEffect(() => {
        if (!mediaId) return;
        let cancelled = false;
        (async () => {
            try {
                const data = await api.get(`/api/history/${mediaId}`, {
                    headers: historyHeaders(scopedClientId),
                });
                if (cancelled) return;
                if (data?.position && data.position > 10 && !data.completed) {
                    setResumePoint(data);
                    setShowResumeDialog(true);
                    resolvedRef.current = false;
                }
            } catch {
                // no history for this client
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [mediaId, scopedClientId]);

    const handleResume = useCallback(() => {
        if (videoRef.current && resumePoint?.position) {
            videoRef.current.currentTime = resumePoint.position;
        }
        setShowResumeDialog(false);
        resolvedRef.current = true;
        clearInterval(countdownRef.current);
    }, [videoRef, resumePoint]);

    const handleStartOver = useCallback(() => {
        if (videoRef.current) videoRef.current.currentTime = 0;
        setShowResumeDialog(false);
        resolvedRef.current = true;
        clearInterval(countdownRef.current);
    }, [videoRef]);

    const handleResumeRef = useRef(handleResume);
    handleResumeRef.current = handleResume;

    useEffect(() => {
        if (!showResumeDialog) return undefined;
        setResumeCountdown(5);
        countdownRef.current = setInterval(() => {
            setResumeCountdown((c) => {
                if (c <= 1) {
                    clearInterval(countdownRef.current);
                    // Default to Start Over — user must explicitly click Resume
                    setShowResumeDialog(false);
                    resolvedRef.current = true;
                    if (videoRef.current) videoRef.current.currentTime = 0;
                    return 0;
                }
                return c - 1;
            });
        }, 1000);
        return () => clearInterval(countdownRef.current);
    }, [showResumeDialog]);

    useEffect(() => {
        if (playing && duration > 0) {
            intervalRef.current = setInterval(() => {
                if (videoRef.current) saveProgress(videoRef.current.currentTime);
            }, 5000);
        } else {
            clearInterval(intervalRef.current);
        }
        return () => clearInterval(intervalRef.current);
    }, [playing, duration, saveProgress, videoRef]);

    useEffect(() => {
        return () => {
            clearInterval(intervalRef.current);
            clearInterval(countdownRef.current);
            if (!videoRef.current || !duration || !mediaId) return;
            const payload = buildPayload(videoRef.current.currentTime);
            const base = import.meta.env.VITE_API_URL || "http://localhost:5000";
            fetch(`${base}/api/history/${mediaId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...historyHeaders(scopedClientId) },
                body: JSON.stringify(payload),
                credentials: "omit",
                keepalive: true,
            }).catch(() => {});
        };
    }, [mediaId, duration, buildPayload, scopedClientId, videoRef]);

    return {
        resumePoint,
        showResumeDialog,
        resumeCountdown,
        handleResume,
        handleStartOver,
    };
}

export default useProgress;
