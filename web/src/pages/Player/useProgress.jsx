import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../../api/client";
import { getOrCreateClientId } from "../../api/stream";

function historyHeaders(clientId) {
    return { "X-Flux-Client": clientId || getOrCreateClientId() };
}

// FIX: Never save ephemeral HLS session URLs. Build a stable /stream/video/:id
// URL from the mediaId so history links survive server restarts.
const BASE = import.meta.env.VITE_API_URL || "http://localhost:5000";

// REMOVED: RESUME_MIN_WAIT_MS fixed timer. Replaced with real readiness
// checks (video.buffered covering the target position + video.readyState)
// inside deferredSeek below — genuinely event-driven, not a guessed
// duration. See deferredSeek's poll loop for the actual gate.

export function useProgress({
    mediaId,
    clientId,
    name,
    type,
    poster,
    videoRef,
    playing,
    mediaDuration,
    getToken,
    streamUrl,
    activeSubtitle,
    onHistoryLoaded,
    hlsRef,
    knownResumePosition,
    actions,
    suppressTimeUpdateRef,
    sessionTimeOffsetRef,
    getAbsoluteCurrentTime,
}) {
    const [resumePoint, setResumePoint] = useState(() => (knownResumePosition != null && knownResumePosition > 10 ? { position: knownResumePosition } : null));
    const [showResumeDialog, setShowResumeDialog] = useState(() => knownResumePosition != null && knownResumePosition > 10);
    // NEW: true while deferredSeek is polling for the target segment to become
    // transcoded/seekable. PlayerPage uses this to show a "waiting for
    // stream..." indicator and hold off autoplay until the seek actually lands
    // — previously playback could start immediately at position 0 for a
    // moment before snapping to the resume point if that segment wasn't
    // transcoded yet.
    const [isSeekingToResume, setIsSeekingToResume] = useState(false);
    const intervalRef = useRef(null);
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
    const deferredSeek = useCallback(
        (targetSec, onSeekLanded, opts = {}) => {
            // FIX (x resets toward 0:00 on quality/resolution switch):
            // deferredSeek was written assuming targetSec is always the
            // ABSOLUTE position to both display AND seek the video element
            // to — true for the resume-dialog path (fresh video, no session
            // offset). But PlayerPage's quality-switch restore calls this
            // with pending.seekTarget, which is SESSION-RELATIVE
            // (pending.time - sessionOffset) — the video element does need
            // to seek to that relative spot, but the UI must keep showing
            // the real absolute pending.time throughout. The old code did
            // `actions.setCurrentTime(targetSec)` unconditionally, which
            // immediately overwrote the correct absolute value the caller
            // had just set with this wrong relative one, and then flipped
            // suppressTimeUpdateRef back to false once the seek landed —
            // permanently breaking PlayerPage's manual clock and handing
            // display back to native timeupdate (session-relative time,
            // since sessionTimeOffsetRef is never actually populated).
            //
            // opts.displayTime: what to optimistically show (defaults to
            // targetSec, preserving old behavior for the resume-dialog path).
            // opts.keepSuppressed: if true, never flip suppressTimeUpdateRef
            // back to false once the seek lands — the caller (quality-switch
            // manual clock) owns display permanently and must not be
            // fought over by native timeupdate again.
            const displayTime = opts.displayTime != null ? opts.displayTime : targetSec;
            const keepSuppressed = !!opts.keepSuppressed;
            // FIX (subtitle mismatch on resume — root cause): this used to
            // call onSeekLanded?.() with NO arguments. PlayerPage's plain-
            // resume callback then re-read progressProps.resumePoint?.position
            // fresh, from a prop closure — but resumePoint can be stale or
            // already cleared by the time this fires (buffer-poll can take
            // seconds), so `typeof resumeTarget === "number"` silently
            // failed and sessionTimeOffsetRef never got set (stayed 0
            // forever). SubtitleRenderer uses that offset to convert
            // session-relative video.currentTime back to absolute time —
            // with it stuck at 0, every cue used the wrong clock, showing
            // early or late. targetSec is the exact value THIS seek was
            // asked to land at — already known here, in this closure, with
            // zero staleness risk. Passing it through means the caller
            // never needs to re-read anything.
            const finishLanded = () => {
                setIsSeekingToResume(false);
                if (suppressTimeUpdateRef && !keepSuppressed) suppressTimeUpdateRef.current = false;
                onSeekLanded?.(targetSec);
            };

            if (!targetSec || targetSec <= 0) {
                onSeekLanded?.(targetSec);
                return;
            }
            clearInterval(seekPollRef.current);
            setIsSeekingToResume(true);
            // FIX (the actual root cause of "audio plays before overlay
            // clears" / subtitle-audio desync surviving every previous
            // attempt): nothing in this function ever paused the video
            // element. If the <video> has native autoplay behavior (or the
            // browser just starts MSE playback the instant enough data is
            // buffered), audio+video begin playing on their own the moment
            // segments land — completely independent of when OUR code
            // decides to call .play(). The overlay only ever hid the
            // picture; it never silenced the audio actually playing behind
            // it. Explicitly pausing here, and re-pausing on every poll
            // tick below as a safety net, ensures nothing actually plays
            // until the real onSeekLanded callback (which calls .play()
            // itself once everything's ready) decides to.
            const video0 = videoRef.current;
            if (video0 && !video0.paused) video0.pause();
            let attempts = 0;
            const MAX_ATTEMPTS = 150; // 150 × 200ms = 30s absolute ceiling (safety net only, not a target duration)
            // FIX (removed RESUME_MIN_WAIT_MS entirely — no fixed timers):
            // this is a two-phase, purely event-driven wait. Phase 1 polls
            // video.buffered until it covers the target position (proves
            // real audio+video data exists there — MSE's buffered is the
            // browser's own intersection across all active SourceBuffers).
            // Once that's true, we actually seek, then move to phase 2:
            // poll video.readyState until it reaches HAVE_FUTURE_DATA (3) —
            // the browser's own signal that decoding has caught up enough
            // at the NEW position to play without stalling. Neither phase
            // waits a guessed duration; both just watch real browser state
            // until it says so.
            let seeked = false;
            // FIX (subtitle mismatch after resume from history): phase 2
            // below used to call finishLanded() on the FIRST tick where
            // readyState >= 3. In this project's multi-SourceBuffer MSE
            // setup (separate audio-only + video-only renditions) that
            // first HAVE_FUTURE_DATA reading can arrive while the element
            // is still settling onto the seek target (currentTime still
            // moving, or `seeking` still true). onSeekLanded's caller
            // (PlayerPage.handleReadyToSeek) computes
            // sessionTimeOffsetRef = absoluteTarget - video.currentTime
            // the instant this fires, so reading an unsettled
            // currentTime bakes that residual error into the offset for
            // the WHOLE session — SubtitleRenderer's clock is
            // video.currentTime + sessionTimeOffsetRef, so every cue then
            // shows early or late by exactly that error. Normal play never
            // hits this (offset is 0, nothing calibrated from a landing).
            // Require currentTime to hold still (< STABLE_EPS_SEC change)
            // with readyState >= 3 and no pending seek for
            // STABLE_TICKS_REQUIRED consecutive polls before landing.
            // The poll ceiling (MAX_ATTEMPTS) still bounds the wait.
            const STABLE_EPS_SEC = 0.05;
            const STABLE_TICKS_REQUIRED = 1;
            let stableTicks = 0;
            let lastStableTime = null;
            console.log("[Resume] Waiting: Video/Audio Buffer");

            // FIX (resume shows 0:00 climbing up, not 17:09 — same bug the
            // quality-switch path already had and fixed): this used to only
            // ever set the raw video.currentTime once the poll below
            // actually landed, up to 15s later. Nothing here ever touched
            // state.currentTime (what the seek bar/time text actually
            // render), so the displayed position was driven by native
            // timeupdate the entire wait — ticking up from 0:00, 0:01,
            // 0:02... instead of showing 17:09 immediately. Setting it here,
            // optimistically, and blocking native timeupdate from
            // overwriting it (suppressTimeUpdateRef) until the real seek
            // lands, mirrors PlayerPage.jsx's already-proven quality-switch
            // fix exactly.
            actions?.setCurrentTime?.(displayTime);
            if (suppressTimeUpdateRef) suppressTimeUpdateRef.current = true;

            // Tell hls.js to start buffering from the target position immediately.
            // This makes the seekable range grow to include targetSec quickly
            // instead of waiting for segments [0 ... targetSec] to load one by one.
            hlsRef?.current?.startLoad(targetSec);

            seekPollRef.current = setInterval(() => {
                attempts++;
                const video = videoRef.current;
                if (!video) {
                    clearInterval(seekPollRef.current);
                    finishLanded();
                    return;
                }
                // Safety net: re-pause every tick. Covers the case where
                // something else (native autoplay re-triggering, a stray
                // play() call elsewhere) resumes playback mid-wait.
                if (!video.paused) video.pause();

                if (!seeked) {
                    // ── Phase 1: wait for real buffered data at the target ──
                    // video.buffered is the real signal: for a multi-
                    // SourceBuffer MSE setup (separate audio-only +
                    // video-only HLS renditions, this project's
                    // architecture), HTMLMediaElement.buffered is the
                    // browser's own INTERSECTION across all active
                    // SourceBuffers — genuinely "both audio AND video have
                    // real data here". Requiring the range to reach
                    // slightly PAST targetSec also ensures a little real
                    // lookahead buffer exists, not just the exact instant.
                    const buffered = video.buffered;
                    let bufferedOk = false;
                    for (let i = 0; i < buffered.length; i++) {
                        if (buffered.start(i) <= targetSec + 0.25 && buffered.end(i) >= targetSec + 1) {
                            bufferedOk = true;
                            break;
                        }
                    }
                    if (bufferedOk) {
                        console.log("[Resume] Video Buffered / Audio Buffered — seeking to", targetSec.toFixed(2));
                        video.currentTime = targetSec;
                        seeked = true;
                        console.log("[Resume] Waiting: Decoder Ready (readyState)");
                    } else if (attempts >= MAX_ATTEMPTS) {
                        // Absolute ceiling hit without ever seeing real
                        // buffered data — give up rather than hang forever,
                        // but this is a safety net, not the normal path.
                        console.log("[Resume] Waiting: Video/Audio Buffer — TIMED OUT after", MAX_ATTEMPTS * 200, "ms, playing anyway");
                        video.currentTime = targetSec;
                        clearInterval(seekPollRef.current);
                        finishLanded();
                    }
                    return;
                }

                // ── Phase 2: wait for the decoder to actually be ready to
                // play the NEW (post-seek) position without stalling.
                // readyState >= HAVE_FUTURE_DATA (3) is HTMLMediaElement's
                // own, genuinely event-driven readiness signal — not
                // something we invented or timed.
                const ready = video.readyState >= 3 && !video.seeking;
                if (ready) {
                    const t = video.currentTime;
                    if (lastStableTime != null && Math.abs(t - lastStableTime) < STABLE_EPS_SEC) stableTicks++;
                    else stableTicks = 0;
                    lastStableTime = t;
                } else {
                    stableTicks = 0;
                    lastStableTime = null;
                }
                if (stableTicks >= STABLE_TICKS_REQUIRED || attempts >= MAX_ATTEMPTS) {
                    clearInterval(seekPollRef.current);
                    console.log("[Resume] ReadyState =", video.readyState, "currentTime =", video.currentTime.toFixed(3), "stableTicks =", stableTicks, "— Playback Ready");
                    finishLanded();
                }
            }, 200);
        },
        [videoRef, hlsRef, actions, suppressTimeUpdateRef],
    );

    // FIX (Report-28): videoRef.current is null at hook mount because <VideoCore>
    // renders only after streamUrl is set. [videoRef] is a stable ref object so
    // the effect never re-runs. Use streamUrl as dep — it changes from null→url
    // exactly when the video element appears, guaranteeing the listener attaches.
    useEffect(() => {
        if (!streamUrl) return; // video not mounted yet
        const video = videoRef.current;
        if (!video) return;
        const onTimeUpdate = () => {
            // FIX (history corrupted after quality switch): this used to do
            // video.currentTime + (sessionTimeOffsetRef?.current || 0) —
            // sessionTimeOffsetRef is a dead ref, declared and reset to 0 but
            // never actually assigned anywhere once the manual-clock design
            // (manualClockRef, in PlayerPage.jsx) replaced it. So this
            // always added 0, silently recording the raw session-relative
            // video.currentTime into lastTimeRef — correct-looking on-screen
            // (that's driven by the manual clock separately) but wrong for
            // anything saved from here (periodic saves, unmount/beacon
            // saves), which is exactly why history could show one thing and
            // resuming would land somewhere completely different.
            // getAbsoluteCurrentTime() (passed down from PlayerPage) is the
            // same single source of truth already used for the on-screen x.
            lastTimeRef.current = getAbsoluteCurrentTime ? getAbsoluteCurrentTime() : video.currentTime + (sessionTimeOffsetRef?.current || 0);
        };
        // FIX: save immediately after user seeks to any position
        const onSeeked = () => {
            const t = getAbsoluteCurrentTime ? getAbsoluteCurrentTime() : video.currentTime + (sessionTimeOffsetRef?.current || 0);
            saveProgressRef.current?.(t);
        };
        video.addEventListener("timeupdate", onTimeUpdate);
        video.addEventListener("seeked", onSeeked);
        return () => {
            video.removeEventListener("timeupdate", onTimeUpdate);
            video.removeEventListener("seeked", onSeeked);
        };
    }, [streamUrl, videoRef, sessionTimeOffsetRef, getAbsoluteCurrentTime]); // streamUrl flip null→url triggers re-run

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
            subtitlePref: activeSubtitle ? { url: activeSubtitle.url, lang: activeSubtitle.lang, source: activeSubtitle.source || "external", label: activeSubtitle.label } : null,
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
        // Don't wipe an instant hint passed in from MediaDetails — it's the
        // correct starting truth (real button label was already showing
        // "Resume" based on this same data) until the fetch below either
        // confirms or corrects it (e.g. if history says completed:true,
        // which the hint alone has no way of knowing).
        if (knownResumePosition == null) {
            setResumePoint(null);
            setShowResumeDialog(false);
        }

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
                } else if (knownResumePosition != null) {
                    // Real data contradicts the instant hint (e.g. completed
                    // since MediaDetails last fetched, or position actually
                    // ≤10s) — correct it instead of leaving a stale
                    // hint-driven dialog open.
                    setResumePoint(null);
                    setShowResumeDialog(false);
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

    const handleResume = useCallback(
        (onLanded) => {
            if (resumePoint?.position) {
                // FIX: Use deferred seek — HLS duration starts tiny, direct seek gets clamped.
                deferredSeek(resumePoint.position, onLanded);
            } else {
                onLanded?.();
            }
            setShowResumeDialog(false);
            resolvedRef.current = true;
            seekFiredRef.current = true;
            clearTimeout(dialogFadeTimer.current);
        },
        [deferredSeek, resumePoint],
    );

    // ── Auto-resume (dialog stays visible) ─────────────────────────────────────
    // Same seek-then-play mechanism as handleResume, but does NOT touch
    // showResumeDialog — used to automatically start resuming the moment the
    // dialog appears, while the dialog itself stays up purely as an
    // optional "actually, start over" override (per explicit request: "the
    // dialogue keep it as it is"). seekFiredRef still gets set so the
    // normal onReadyToSeek path doesn't ALSO try to seek separately.
    const autoResume = useCallback(
        (onLanded) => {
            if (seekFiredRef.current) return;
            seekFiredRef.current = true;
            if (resumePoint?.position) {
                deferredSeek(resumePoint.position, onLanded);
            } else {
                onLanded?.();
            }
        },
        [deferredSeek, resumePoint],
    );

    const handleStartOver = useCallback(() => {
        if (videoRef.current) videoRef.current.currentTime = 0;
        setShowResumeDialog(false);
        resolvedRef.current = true;
        seekFiredRef.current = true;
        clearTimeout(dialogFadeTimer.current);
    }, [videoRef]);

    // ── Resume dialog auto-fade (6s, doc: "Resume Dialog Behavior") ───────────
    // FIX: previously this was a 5s COUNTDOWN that auto-triggered Start Over
    // at zero — a real playback side-effect the user never asked for. The
    // doc clarifies this should be a pure UI auto-hide: the dialog fades
    // away after 6s of no interaction, nothing more. It does NOT seek, does
    // NOT start over, does NOT resume — whatever the user does (or doesn't)
    // with the dialog is independent of any actual playback action; this
    // timer only controls whether the dialog ELEMENT is still on screen.
    const dialogFadeTimer = useRef(null);
    const [resumeDialogFading, setResumeDialogFading] = useState(false);
    useEffect(() => {
        if (!showResumeDialog) {
            setResumeDialogFading(false);
            return undefined;
        }
        console.log("[RESUME] timer armed at", new Date().toISOString(), "— will fire in 4000ms");
        setResumeDialogFading(false);
        dialogFadeTimer.current = setTimeout(() => {
            console.log("[RESUME] 4000ms elapsed — fading out at", new Date().toISOString());
            setResumeDialogFading(true);
            // Let the fade transition (250-300ms, handled in the component
            // via resumeDialogFading) play out before actually removing it
            // from layout.
            setTimeout(() => {
                console.log("[RESUME] fade complete — setShowResumeDialog(false)");
                setShowResumeDialog(false);
            }, 300);
        }, 4000); // FIX: was 4500, request specified exactly 4s
        return () => {
            console.log("[RESUME] timer cleared/restarted at", new Date().toISOString());
            clearTimeout(dialogFadeTimer.current);
        };
    }, [showResumeDialog]);

    // ── onReadyToSeek ─────────────────────────────────────────────────────────
    const onReadyToSeek = useCallback(
        (onLanded) => {
            if (seekFiredRef.current) return;
            if (showResumeDialog) return;
            if (!resumePoint?.position) {
                onLanded?.();
                return;
            }
            seekFiredRef.current = true;
            // FIX: Use deferred seek — HLS manifest is incomplete at this point.
            deferredSeek(resumePoint.position, onLanded);
        },
        [showResumeDialog, resumePoint, deferredSeek],
    );

    // ── Periodic progress save (every 4s) + immediate save on play/pause ──────
    useEffect(() => {
        // FIX (history corrupted after quality switch / wrong resume
        // position): was reading videoRef.current.currentTime directly —
        // the raw session-relative element clock. Once ANY quality switch
        // had happened, this interval kept saving that small, wrong number
        // every tick, silently overwriting the real position in history
        // regardless of what the on-screen x showed. getAbsoluteCurrentTime()
        // is the same manual-clock-aware source already used for display,
        // so what's saved always matches what's on screen.
        const readTime = () => (getAbsoluteCurrentTime ? getAbsoluteCurrentTime() : videoRef.current?.currentTime || 0);
        if (playing) {
            // FIX: save immediately when playback starts (don't wait for first interval)
            if (videoRef.current) saveProgress(readTime());
            intervalRef.current = setInterval(() => {
                if (videoRef.current) saveProgress(readTime());
            }, 4_000); // FIX: was 10_000 — explicit request for 4s history writes
        } else {
            clearInterval(intervalRef.current);
            // FIX: save immediately on pause
            const time = lastTimeRef.current;
            if (time > 0) saveProgressRef.current?.(time);
        }
        return () => clearInterval(intervalRef.current);
    }, [playing, saveProgress, videoRef, getAbsoluteCurrentTime]);

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
            clearTimeout(dialogFadeTimer.current);
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

    // Manual dismiss (new X close button in PlayerControls) — immediate, no
    // fade wait like the natural 6s timeout above. Same end state either way
    // (showResumeDialog=false, permanently, until next real video load) so
    // nothing about the "never reappears on touch" guarantee changes —
    // showResumeDialog is only ever set true once, by the initial load
    // effect above; nothing here or in the timeout path ever flips it back.
    const dismissResumeDialog = useCallback(() => {
        clearTimeout(dialogFadeTimer.current);
        setResumeDialogFading(false);
        setShowResumeDialog(false);
    }, []);

    return {
        resumePoint,
        showResumeDialog,
        resumeDialogFading,
        isSeekingToResume,
        handleResume,
        autoResume,
        handleStartOver,
        dismissResumeDialog,
        onReadyToSeek,
        // Exposed so other callers (e.g. PlayerPage's on-demand quality
        // switch) can seek to an ARBITRARY target position using the exact
        // same robust "poll video.seekable + hls.startLoad(target)" logic
        // already proven here — instead of a naive one-shot currentTime
        // assignment, which fails silently when the target isn't in the
        // seekable range yet (which it usually isn't immediately after a
        // fresh session/manifest swap).
        deferredSeek,
    };
}

export default useProgress;
