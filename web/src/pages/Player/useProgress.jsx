import { useState, useEffect, useRef, useCallback } from "react";
import { getOrCreateClientId } from "../../api/stream";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:5000";

/**
 * useProgress — watch history + resume tracking
 *
 * FIXED over v3:
 *  1. Resume seek fires only after canplay (not before video is ready)
 *     Previous: `videoRef.current.currentTime = pos` could fire before loadedmetadata
 *     Fixed: onReadyToSeek callback pattern
 *
 *  2. Progress saved on Page Visibility API (tab switch / minimize)
 *     Previous: only saved on interval + unmount
 *     Fixed: visibilitychange listener
 *
 *  3. Heartbeat uses correct positionSec in body (not empty {})
 *     (this is handled in api/stream.js but useProgress saves to /api/history)
 *
 *  4. Auto-resume countdown defaults to START OVER (not resume)
 *     Users must explicitly click Resume — start over auto-fires after 5s
 */
export function useProgress({ mediaId, name, type, poster, streamUrl, videoRef, playing, duration }) {
    const [resumePoint, setResumePoint] = useState(null);
    const [showResumeDialog, setShowResumeDialog] = useState(false);
    const [resumeCountdown, setResumeCountdown] = useState(5);
    // Whether the user has resolved the resume dialog (clicked Resume or Start Over)
    const resolvedRef = useRef(false);
    // Track if video is ready to seek (canplay has fired)
    const readyToSeekRef = useRef(false);
    const pendingSeekRef = useRef(null); // seek position waiting for canplay
    const clientId = getOrCreateClientId();
    const intervalRef = useRef(null);
    const countdownRef = useRef(null);

    // ── Build history payload ─────────────────────────────────────────────────

    const buildPayload = useCallback(
        (time) => ({
            name: name || "",
            type: type || "movie",
            poster: poster || null,
            streamUrl: streamUrl || null,
            position: Math.floor(time || 0),
            duration: Math.floor(duration || 0),
        }),
        [name, type, poster, streamUrl, duration],
    );

    // ── Save progress (non-fatal) ─────────────────────────────────────────────

    const saveProgress = useCallback(
        async (time) => {
            if (!mediaId || !duration || duration < 1) return;
            const pos = Math.floor(time || 0);
            if (pos < 1) return; // don't save position 0
            try {
                await fetch(`${BASE}/api/history/${encodeURIComponent(mediaId)}`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-Flux-Client": clientId,
                    },
                    body: JSON.stringify(buildPayload(time)),
                });
            } catch {
                // non-fatal — don't disrupt playback
            }
        },
        [mediaId, duration, buildPayload, clientId],
    );

    // ── Fetch existing history on mount ───────────────────────────────────────

    useEffect(() => {
        if (!mediaId) return;
        let cancelled = false;
        resolvedRef.current = false;
        readyToSeekRef.current = false;
        pendingSeekRef.current = null;

        (async () => {
            try {
                const res = await fetch(`${BASE}/api/history/${encodeURIComponent(mediaId)}`, {
                    headers: { "X-Flux-Client": clientId },
                });
                if (cancelled || !res.ok) return;
                const data = await res.json();
                if (cancelled) return;
                // Show resume dialog if: position > 10s AND not completed
                if (data?.position && data.position > 10 && !data.completed) {
                    setResumePoint(data);
                    setShowResumeDialog(true);
                }
            } catch {
                // no history — fresh play
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [mediaId, clientId]);

    // ── Resume handlers ───────────────────────────────────────────────────────

    /**
     * seekWhenReady: if video is ready to seek, do it now.
     * Otherwise, store the position and let VideoCore call onReady.
     */
    const seekWhenReady = useCallback(
        (position) => {
            const video = videoRef.current;
            if (!video) return;
            // canplay has fired → safe to seek
            if (readyToSeekRef.current || video.readyState >= 3) {
                video.currentTime = position;
            } else {
                // Store for when canplay fires
                pendingSeekRef.current = position;
            }
        },
        [videoRef],
    );

    const handleResume = useCallback(() => {
        const pos = resumePoint?.position;
        if (pos) seekWhenReady(pos);
        setShowResumeDialog(false);
        resolvedRef.current = true;
        clearInterval(countdownRef.current);
    }, [resumePoint, seekWhenReady]);

    const handleStartOver = useCallback(() => {
        seekWhenReady(0);
        setShowResumeDialog(false);
        resolvedRef.current = true;
        clearInterval(countdownRef.current);
    }, [seekWhenReady]);

    // ── Mark ready to seek (called from PlayerPage when canplay fires) ─────────

    const onReadyToSeek = useCallback(() => {
        readyToSeekRef.current = true;
        if (pendingSeekRef.current !== null) {
            const pos = pendingSeekRef.current;
            pendingSeekRef.current = null;
            const video = videoRef.current;
            if (video) video.currentTime = pos;
        }
    }, [videoRef]);

    // ── Resume countdown ──────────────────────────────────────────────────────

    useEffect(() => {
        if (!showResumeDialog) return;
        setResumeCountdown(5);
        countdownRef.current = setInterval(() => {
            setResumeCountdown((c) => {
                if (c <= 1) {
                    clearInterval(countdownRef.current);
                    // Default: Start Over (don't auto-resume — user must be explicit)
                    setShowResumeDialog(false);
                    resolvedRef.current = true;
                    // Don't seek — leave at position 0 (loaded at 0 by default)
                    return 0;
                }
                return c - 1;
            });
        }, 1_000);
        return () => clearInterval(countdownRef.current);
    }, [showResumeDialog]);

    // ── Periodic progress save (every 5s while playing) ───────────────────────

    useEffect(() => {
        if (playing && duration > 0) {
            intervalRef.current = setInterval(() => {
                const video = videoRef.current;
                if (video && video.currentTime > 0) {
                    saveProgress(video.currentTime);
                }
            }, 5_000);
        } else {
            clearInterval(intervalRef.current);
        }
        return () => clearInterval(intervalRef.current);
    }, [playing, duration, saveProgress, videoRef]);

    // ── Save on tab switch / minimize (Page Visibility API) ───────────────────
    // Jellyfin pattern: save on visibilitychange to prevent loss if tab is closed

    useEffect(() => {
        const onVisibilityChange = () => {
            if (document.hidden) {
                const video = videoRef.current;
                if (video && duration > 0 && video.currentTime > 0) {
                    saveProgress(video.currentTime);
                }
            }
        };
        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => document.removeEventListener("visibilitychange", onVisibilityChange);
    }, [videoRef, duration, saveProgress]);

    // ── Save on unmount (keepalive fetch) ─────────────────────────────────────

    useEffect(() => {
        return () => {
            clearInterval(intervalRef.current);
            clearInterval(countdownRef.current);
            const video = videoRef.current;
            if (!video || !duration || !mediaId) return;
            const pos = video.currentTime;
            if (pos < 1) return;
            // keepalive: survives page close
            fetch(`${BASE}/api/history/${encodeURIComponent(mediaId)}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Flux-Client": clientId,
                },
                body: JSON.stringify(buildPayload(pos)),
                keepalive: true,
            }).catch(() => {});
        };
    }, [mediaId, duration, buildPayload, clientId, videoRef]);

    return {
        resumePoint,
        showResumeDialog,
        resumeCountdown,
        handleResume,
        handleStartOver,
        onReadyToSeek, // PlayerPage passes to VideoCore's canplay handler
    };
}

export default useProgress;
