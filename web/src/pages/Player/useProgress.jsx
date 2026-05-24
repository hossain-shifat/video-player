import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../../api/client";
import { getOrCreateClientId } from "../../api/stream";

function historyHeaders(clientId) {
    return { "X-Flux-Client": clientId || getOrCreateClientId() };
}

export function useProgress({ mediaId, clientId, name, type, poster, streamUrl, videoRef, playing, duration }) {
    const [resumePoint, setResumePoint] = useState(null);
    const [showResumeDialog, setShowResumeDialog] = useState(false);
    const [resumeCountdown, setResumeCountdown] = useState(5);
    const intervalRef = useRef(null);
    const countdownRef = useRef(null);
    const resolvedRef = useRef(false);
    // Track whether onReadyToSeek has fired — prevents double-seek on HLS
    // which fires canplay multiple times as segments buffer.
    const seekFiredRef = useRef(false);
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
                // non-fatal
            }
        },
        [mediaId, duration, buildPayload, scopedClientId],
    );

    // ── Load resume point from history ────────────────────────────────────────
    useEffect(() => {
        if (!mediaId) return;
        let cancelled = false;
        seekFiredRef.current = false;
        resolvedRef.current = false;
        setResumePoint(null);
        setShowResumeDialog(false);

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
                // no history
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [mediaId, scopedClientId]);

    // ── Resume dialog actions ─────────────────────────────────────────────────

    const handleResume = useCallback(() => {
        if (videoRef.current && resumePoint?.position) {
            videoRef.current.currentTime = resumePoint.position;
        }
        setShowResumeDialog(false);
        resolvedRef.current = true;
        seekFiredRef.current = true;
        clearInterval(countdownRef.current);
    }, [videoRef, resumePoint]);

    const handleStartOver = useCallback(() => {
        if (videoRef.current) videoRef.current.currentTime = 0;
        setShowResumeDialog(false);
        resolvedRef.current = true;
        seekFiredRef.current = true;
        clearInterval(countdownRef.current);
    }, [videoRef]);

    // ── Resume countdown (auto Start Over after 5s) ────────────────────────────
    useEffect(() => {
        if (!showResumeDialog) return undefined;
        setResumeCountdown(5);
        countdownRef.current = setInterval(() => {
            setResumeCountdown((c) => {
                if (c <= 1) {
                    clearInterval(countdownRef.current);
                    setShowResumeDialog(false);
                    resolvedRef.current = true;
                    seekFiredRef.current = true;
                    if (videoRef.current) videoRef.current.currentTime = 0;
                    return 0;
                }
                return c - 1;
            });
        }, 1000);
        return () => clearInterval(countdownRef.current);
    }, [showResumeDialog]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── onReadyToSeek — called from PlayerPage on video canplay ──────────────
    // FIX: was missing from return → PlayerPage threw "undefined is not a function"
    //
    // Purpose: if a resume dialog is pending and the video just became ready to
    // play, we can auto-seek to the resume position if the user hasn't interacted.
    // This fires on every canplay (HLS fires it multiple times), so we guard with
    // seekFiredRef to ensure we only act once per media load.
    //
    // If the dialog is showing: let the user choose (handleResume / handleStartOver).
    // If no resume point: no-op.
    const onReadyToSeek = useCallback(() => {
        if (seekFiredRef.current) return;
        if (showResumeDialog) return; // dialog is showing, let user choose
        if (!resumePoint?.position) return;
        // No dialog but we have a resume point (e.g. short session, auto-resume)
        seekFiredRef.current = true;
        if (videoRef.current) {
            videoRef.current.currentTime = resumePoint.position;
        }
    }, [showResumeDialog, resumePoint, videoRef]);

    // ── Periodic progress save ────────────────────────────────────────────────
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

    // ── Save on unmount ───────────────────────────────────────────────────────
    useEffect(() => {
        return () => {
            clearInterval(intervalRef.current);
            clearInterval(countdownRef.current);
            if (!videoRef.current || !duration || !mediaId) return;
            const payload = buildPayload(videoRef.current.currentTime);
            const base = import.meta.env.VITE_API_URL || "http://localhost:5000";
            fetch(`${base}/api/history/${mediaId}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...historyHeaders(scopedClientId),
                },
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
        onReadyToSeek,
    };
}

export default useProgress;
