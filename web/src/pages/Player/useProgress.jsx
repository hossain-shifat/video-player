import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../../api/client";
import { getOrCreateClientId } from "../../api/stream";

function historyHeaders(clientId) {
    return { "X-Flux-Client": clientId || getOrCreateClientId() };
}

// FIX: Never save ephemeral HLS session URLs. Build a stable /stream/video/:id
// URL from the mediaId so history links survive server restarts.
const BASE = import.meta.env.VITE_API_URL || "http://localhost:5000";

export function useProgress({ mediaId, clientId, name, type, poster, videoRef, playing, mediaDuration, getToken, streamUrl, activeSubtitle, onHistoryLoaded, hlsRef }) {
    const [resumePoint, setResumePoint] = useState(null);
    const [showResumeDialog, setShowResumeDialog] = useState(false);
    const [resumeCountdown, setResumeCountdown] = useState(5);
    const intervalRef = useRef(null);
    const countdownRef = useRef(null);
    const resolvedRef = useRef(false);
    const seekFiredRef = useRef(false);
    const seekPollRef = useRef(null); // NEW: poll timer for deferred seek
    // FIX (Report-25): capture currentTime continuously so unmount cleanup
    // doesn't rely on videoRef.current (nullified before cleanup runs in React 17+)
    const lastTimeRef = useRef(0);
    const scopedClientId = clientId || getOrCreateClientId();

    // NEW: deferredSeek — polls video.seekable until targetSec is reachable,
    // then seeks. Solves HLS EVENT playlist clamping (duration starts tiny).
    // Also calls hls.startLoad(targetSec) to redirect hls.js buffering so the
    // seekable range grows to include the target quickly (without waiting for
    // natural playback to reach the target).
    const deferredSeek = useCallback((targetSec) => {
        if (!targetSec || targetSec <= 0) return;
        clearInterval(seekPollRef.current);
        let attempts = 0;
        const MAX_ATTEMPTS = 75; // 75 × 200ms = 15s max wait

        // Tell hls.js to start buffering from the target position immediately.
        // This makes the seekable range grow to include targetSec quickly
        // instead of waiting for segments [0 ... targetSec] to load one by one.
        hlsRef?.current?.startLoad(targetSec);

        seekPollRef.current = setInterval(() => {
            attempts++;
            const video = videoRef.current;
            if (!video) { clearInterval(seekPollRef.current); return; }

            // Check if seekable range includes target position
            const seekable = video.seekable;
            let canSeek = false;
            for (let i = 0; i < seekable.length; i++) {
                if (targetSec <= seekable.end(i) + 1) { canSeek = true; break; }
            }

            if (canSeek || attempts >= MAX_ATTEMPTS) {
                clearInterval(seekPollRef.current);
                video.currentTime = targetSec;
            }
        }, 200);
    }, [videoRef, hlsRef]);

    // FIX (Report-28): videoRef.current is null at hook mount because <VideoCore>
    // renders only after streamUrl is set. [videoRef] is a stable ref object so
    // the effect never re-runs. Use streamUrl as dep — it changes from null→url
    // exactly when the video element appears, guaranteeing the listener attaches.
    useEffect(() => {
        if (!streamUrl) return; // video not mounted yet
        const video = videoRef.current;
        if (!video) return;
        const onTimeUpdate = () => {
            lastTimeRef.current = video.currentTime;
        };
        // FIX: save immediately after user seeks to any position
        const onSeeked = () => {
            saveProgressRef.current?.(video.currentTime);
        };
        video.addEventListener("timeupdate", onTimeUpdate);
        video.addEventListener("seeked", onSeeked);
        return () => {
            video.removeEventListener("timeupdate", onTimeUpdate);
            video.removeEventListener("seeked", onSeeked);
        };
    }, [streamUrl, videoRef]); // streamUrl flip null→url triggers re-run

    // FIX: stable stream URL — never use ephemeral HLS session URL
    const stableStreamUrl = mediaId ? `${BASE}/stream/video/${encodeURIComponent(mediaId)}` : null;

    const buildPayload = useCallback(
        (time, duration) => ({
            name: name || "",
            type: type || "movie",
            poster: poster || null,
            streamUrl: stableStreamUrl,
            position: Math.floor(time),
            // FIX: cap duration from videoRef directly — HLS EVENT playlist grows
            // dynamically, so state.duration may be tiny early on.
            // Only save actual duration when it looks real (>30s); otherwise skip
            // the completion check by passing the position as duration (never 90%+).
            duration: Math.floor(duration),
            // Save subtitle preference so next session can restore it
            subtitlePref: activeSubtitle
                ? { url: activeSubtitle.url, lang: activeSubtitle.lang, source: activeSubtitle.source || "external", label: activeSubtitle.label }
                : null,
        }),
        [name, type, poster, stableStreamUrl, activeSubtitle],
    );

    const saveProgress = useCallback(
        async (time) => {
            if (!mediaId) return;
            const video = videoRef.current;
            if (!video) return;

            // Read duration directly from video element (not state — HLS EVENT playlist
            // grows state.duration dynamically which can be tiny early on).
            // Use mediaDuration (from ffprobe/PlayerPage) when available as the ground
            // truth; fall back to video.duration only when mediaDuration is absent.
            const rawDuration = video.duration;
            const videoDur = isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 0;
            // Prefer the real ffprobe duration passed in from PlayerPage
            const duration = mediaDuration && mediaDuration > 60 ? mediaDuration : videoDur;

            try {
                await api.post(`/api/history/${mediaId}`, buildPayload(time, duration), {
                    headers: historyHeaders(scopedClientId),
                });
            } catch {
                // non-fatal
            }
        },
        [mediaId, buildPayload, scopedClientId, videoRef, mediaDuration],
    );

    // FIX: Keep a ref to saveProgress so event handlers and page-exit listeners
    // can always call the latest version without stale closures.
    const saveProgressRef = useRef(saveProgress);
    useEffect(() => {
        saveProgressRef.current = saveProgress;
    }, [saveProgress]);

    // ── Load resume point ─────────────────────────────────────────────────────
    // FIX (Report-19): Race condition — AuthContext registers the token via
    // registerAuthProvider() inside a useEffect. If this hook runs before that
    // effect fires, client.js has _getToken=null and sends no Authorization header.
    // Solution: short delay (50ms) lets React flush all mount effects first, then
    // the Axios interceptor will have a valid token. The interceptor also does
    // silent refresh+retry on 401, so a single retry covers token-expiry cases.
    useEffect(() => {
        if (!mediaId) return;
        let cancelled = false;
        seekFiredRef.current = false;
        resolvedRef.current = false;
        setResumePoint(null);
        setShowResumeDialog(false);

        const load = async () => {
            try {
                const data = await api.get(`/api/history/${mediaId}`, {
                    headers: historyHeaders(scopedClientId),
                    skipAuthHandler: true,
                });
                if (cancelled) return;
                if (data?.position && data.position > 10 && !data.completed) {
                    setResumePoint(data);
                    setShowResumeDialog(true);
                    resolvedRef.current = false;
                }
                // Restore subtitle pref regardless of whether we're resuming
                if (onHistoryLoaded) onHistoryLoaded(data || null);
            } catch {
                // no history or not authenticated — silent
            }
        };

        // Delay 50ms so all mount useEffects (incl. registerAuthProvider) fire first
        const t = setTimeout(load, 50);
        return () => {
            cancelled = true;
            clearTimeout(t);
        };
    }, [mediaId, scopedClientId]);

    // ── Resume dialog actions ─────────────────────────────────────────────────

    const handleResume = useCallback(() => {
        if (resumePoint?.position) {
            // FIX: Use deferred seek — HLS duration starts tiny, direct seek gets clamped.
            deferredSeek(resumePoint.position);
        }
        setShowResumeDialog(false);
        resolvedRef.current = true;
        seekFiredRef.current = true;
        clearInterval(countdownRef.current);
    }, [deferredSeek, resumePoint]);

    const handleStartOver = useCallback(() => {
        if (videoRef.current) videoRef.current.currentTime = 0;
        setShowResumeDialog(false);
        resolvedRef.current = true;
        seekFiredRef.current = true;
        clearInterval(countdownRef.current);
    }, [videoRef]);

    // ── Resume countdown (auto Start Over after 5s) ───────────────────────────
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

    // ── onReadyToSeek ─────────────────────────────────────────────────────────
    const onReadyToSeek = useCallback(() => {
        if (seekFiredRef.current) return;
        if (showResumeDialog) return;
        if (!resumePoint?.position) return;
        seekFiredRef.current = true;
        // FIX: Use deferred seek — HLS manifest is incomplete at this point.
        deferredSeek(resumePoint.position);
    }, [showResumeDialog, resumePoint, deferredSeek]);

    // ── Periodic progress save (every 10s) + immediate save on play/pause ─────
    useEffect(() => {
        if (playing) {
            // FIX: save immediately when playback starts (don't wait for first interval)
            if (videoRef.current) saveProgress(videoRef.current.currentTime);
            intervalRef.current = setInterval(() => {
                if (videoRef.current) saveProgress(videoRef.current.currentTime);
            }, 10_000);
        } else {
            clearInterval(intervalRef.current);
            // FIX: save immediately on pause
            const time = lastTimeRef.current;
            if (time > 0) saveProgressRef.current?.(time);
        }
        return () => clearInterval(intervalRef.current);
    }, [playing, saveProgress, videoRef]);

    // ── sendBeacon helper — used by unmount, pagehide, visibilitychange ───────
    // Kept as a ref so page-exit handlers always read the latest mediaId/token/etc.
    const sendBeaconRef = useRef(null);
    useEffect(() => {
        sendBeaconRef.current = () => {
            const time = lastTimeRef.current;
            if (!mediaId || time < 1) return;
            const video = videoRef.current;
            const rawDuration = video ? video.duration : 0;
            const videoDur = isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 0;
            const duration = mediaDuration && mediaDuration > 60 ? mediaDuration : videoDur;
            const payload = buildPayload(time, duration);
            const token = getToken ? getToken() : null;

            // FIX (Report-29): navigator.sendBeacon() is keepalive-safe and CORS-exempt
            // for text/plain blobs. Token + clientId go in query params since
            // sendBeacon cannot set custom headers.
            const qs = new URLSearchParams({ clientId: scopedClientId });
            if (token) qs.set("token", token);
            const beaconUrl = `${BASE}/api/history/${mediaId}?${qs}`;
            const blob = new Blob([JSON.stringify(payload)], { type: "text/plain" });
            const sent = navigator.sendBeacon(beaconUrl, blob);

            // Fallback: if sendBeacon unavailable or returns false (quota exceeded),
            // try plain fetch without custom headers.
            if (!sent) {
                fetch(beaconUrl, {
                    method: "POST",
                    body: JSON.stringify(payload),
                }).catch(() => {});
            }
        };
    }, [mediaId, buildPayload, scopedClientId, getToken, mediaDuration, videoRef]);

    // ── pagehide + visibilitychange — catch tab close / refresh / navigate ────
    // FIX: useEffect cleanup (unmount) fires for SPA navigation but NOT for
    // hard tab closes or F5 refresh. Wire document-level events that always fire.
    useEffect(() => {
        const onPageHide = () => sendBeaconRef.current?.();
        const onVisibilityChange = () => {
            if (document.visibilityState === "hidden") sendBeaconRef.current?.();
        };
        window.addEventListener("pagehide", onPageHide);
        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => {
            window.removeEventListener("pagehide", onPageHide);
            document.removeEventListener("visibilitychange", onVisibilityChange);
        };
    }, []); // mount once — sendBeaconRef always holds latest values

    // ── Save on unmount ───────────────────────────────────────────────────────
    // FIX (Report-22): deps array was missing `mediaDuration` — the closure
    // captured the value at mount (undefined/0), so duration was always 0 and
    // the early-return `if (time < 1)` sometimes fired incorrectly.
    // Added mediaDuration to deps so the closure always has the latest value.
    useEffect(() => {
        return () => {
            clearInterval(intervalRef.current);
            clearInterval(countdownRef.current);
            clearInterval(seekPollRef.current); // NEW: cancel any pending deferred seek poll

            if (!mediaId) return;
            // FIX (Report-25): videoRef.current is null by cleanup time (React 17+
            // async unmount). Use lastTimeRef which was updated on every timeupdate.
            const time = lastTimeRef.current;
            if (time < 1) return;
            const video = videoRef.current;
            const rawDuration = video ? video.duration : 0;
            const videoDur = isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 0;
            const duration = mediaDuration && mediaDuration > 60 ? mediaDuration : videoDur;
            const payload = buildPayload(time, duration);
            const token = getToken ? getToken() : null;

            // FIX (Report-29): fetch+keepalive fails on cross-origin requests that
            // require a CORS preflight (custom headers trigger preflight; browser
            // forbids keepalive on preflighted requests → silent TypeError).
            // Solution: navigator.sendBeacon() is always keepalive-safe and CORS-exempt
            // for text/plain blobs. Token + clientId go in query params since
            // sendBeacon cannot set custom headers.
            const qs = new URLSearchParams({ clientId: scopedClientId });
            if (token) qs.set("token", token);
            const beaconUrl = `${BASE}/api/history/${mediaId}?${qs}`;
            const blob = new Blob([JSON.stringify(payload)], { type: "text/plain" });
            const sent = navigator.sendBeacon(beaconUrl, blob);

            // Fallback: if sendBeacon unavailable or returns false (quota exceeded),
            // try plain fetch without custom headers — CORS preflight still fires but
            // at least we get one attempt through. Token goes in query param only.
            if (!sent) {
                fetch(beaconUrl, {
                    method: "POST",
                    body: JSON.stringify(payload),
                }).catch(() => {});
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mediaId, mediaDuration, buildPayload, scopedClientId, videoRef]);

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
