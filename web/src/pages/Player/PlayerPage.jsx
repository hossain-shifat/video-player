import { useRef, useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, useLocation } from "react-router";
import { PlayerProvider, usePlayerState } from "./UsePlayerState";
import VideoCore from "./VideoCore";
import PlayerControls from "./PlayerControls";
import PlayerGestures from "./PlayerGestures";
import PlayerLock from "./PlayerLock";
import PlayerOverlays, { useOverlay } from "./PlayerOverlays";
import SubtitleRenderer from "./SubtitleRenderer";
import { useProgress } from "./useProgress";
import { getMediaById, getSubtitles } from "../../api/media";
import { resolvePlayback, heartbeatSession, stopSession } from "../../api/stream";
import { useAuth } from "../../auth/AuthContext";
import { useIsMobile } from "./useIsMobile";

// ─── Mobile playback init state machine ──────────────────────────────────────
// Module-scope constant (stable reference, never recreated) so effects that
// depend on it don't churn every render.
const INIT_PHASE = {
    IDLE: "IDLE",
    LOADING_MEDIA: "LOADING_MEDIA",
    METADATA_READY: "METADATA_READY",
    BUFFERING: "BUFFERING",
    SEEKING: "SEEKING",
    SEEK_COMPLETE: "SEEK_COMPLETE",
    LANDSCAPE_READY: "LANDSCAPE_READY",
    FULLSCREEN_READY: "FULLSCREEN_READY",
    FIRST_FRAME_READY: "FIRST_FRAME_READY",
    PLAYING: "PLAYING",
};

// ─── PlayerInner (inside PlayerProvider) ─────────────────────────────────────

function PlayerInner({ mediaId, knownResumePosition, containerRef }) {
    const navigate = useNavigate();
    const isMobile = useIsMobile();
    const videoRef = useRef(null);
    const hideTimer = useRef(null);
    const sessionIdRef = useRef(null);
    const clientIdRef = useRef(null);
    // FIX (Report-25): store ffprobe duration for useProgress unmount save
    const mediaDurationRef = useRef(null);
    // Subtitle default selection: populated after subtitle list loads, consumed after history loads
    const setDefaultSubRef = useRef(null);
    // HLS instance ref — populated by VideoCore via onHlsCreated, used by useProgress deferredSeek
    const hlsRef = useRef(null);
    // Captured playback state during an on-demand quality switch (position/
    // playing/etc to restore once the new-quality session is ready). Kept
    // completely separate from useProgress's history-resume machinery —
    // this is a mid-playback stream swap, not a fresh video load, and must
    // never trigger the resume dialog or INIT_PHASE reset logic.
    const qualitySwitchStateRef = useRef(null);
    // FIX (quality switch: video genuinely restarts from 0:00, not just a
    // display glitch): the backend correctly seeks the SOURCE file via -ss
    // when starting a quality-switch session (see transcoderService.js —
    // it even preserves absolute PTS via -copyts specifically so this
    // works). But VideoCore.jsx forces `hls.startPosition = 0` on every
    // MANIFEST_PARSED (an established fix for a DIFFERENT problem — see its
    // own comment) — which normalizes THIS NEW session's timeline to start
    // counting from 0 regardless of the segments' real absolute PTS. So a
    // quality-switch session that server-seeked to real position ~1029s has
    // its OWN video.currentTime start at 0 (representing that ~1029s point),
    // while a fresh/resume session (which starts from real position 0) has
    // video.currentTime=0 ALSO mean real position 0 — same number, totally
    // different meaning depending on which kind of session is active. This
    // ref holds "what absolute time does THIS session's 0 actually
    // represent" — 0 for fresh/resume sessions, the aligned segment-boundary
    // time for a quality-switch restart. VideoCore's timeupdate, SeekBar's
    // manual-seek assignment, and useProgress's watch-position save all need
    // to add/subtract this to convert between "what the user sees" (always
    // absolute) and "what the video element's own currentTime actually is"
    // (relative to whichever session is currently loaded).
    const sessionTimeOffsetRef = useRef(0);

    const { state, actions } = usePlayerState();
    const { getToken } = useAuth();

    // FIX (giving up on reverse-engineering hls.js's internal timeline):
    // repeated attempts to reconstruct "what does this session's own 0
    // actually mean in absolute terms" (via a formula, then via calibrating
    // off video.currentTime once a seek lands) kept failing in ways I
    // couldn't diagnose further without live devtools access. This is a
    // completely different, much simpler strategy: after a quality-switch
    // restart, STOP asking video.currentTime what the position is at all.
    // Track it ourselves with a plain wall-clock — { baseTime: real Date.now()
    // ms, baseX: the displayed position at that moment }. Every tick (see the
    // ticker effect below), advance baseX by real elapsed time while
    // actually playing. This can never "jump to 0" or misread hls.js
    // internals, because it never asks hls.js anything.
    const manualClockRef = useRef({ active: false, baseTime: 0, baseX: 0 });
    const playingRef = useRef(false);
    const bufferingRef = useRef(false);
    useEffect(() => {
        playingRef.current = state.playing;
    }, [state.playing]);
    useEffect(() => {
        bufferingRef.current = state.isBuffering;
    }, [state.isBuffering]);
    // Ticks every 200ms — while manualClockRef is active and actually
    // playing (not paused/buffering), advances the displayed position by
    // real elapsed time. Freezes (but keeps resyncing its own baseTime) the
    // rest of the time so resuming play never causes a jump.
    useEffect(() => {
        const id = setInterval(() => {
            const clock = manualClockRef.current;
            if (!clock.active) return;
            const now = Date.now();
            if (!playingRef.current || bufferingRef.current) {
                clock.baseTime = now; // resync so a later resume doesn't jump
                return;
            }
            const elapsed = (now - clock.baseTime) / 1000;
            const x = clock.baseX + elapsed;
            clock.baseTime = now;
            clock.baseX = x;
            actions.setCurrentTime(x);
        }, 200);
        return () => clearInterval(id);
    }, [actions]);

    // ── Mobile init state machine (per explicit spec) ───────────────────────────
    // IDLE → LOADING_MEDIA → METADATA_READY → BUFFERING → SEEKING (resume only)
    // → SEEK_COMPLETE → LANDSCAPE_READY → FULLSCREEN_READY → FIRST_FRAME_READY
    // → PLAYING. Each stage completes before the next begins. Desktop/tablet
    // skip straight through LANDSCAPE_READY/FULLSCREEN_READY (no-ops there) —
    // this entire pipeline only changes MOBILE behavior, matching "implement
    // this only on mobile devices, desktop/tablet unchanged" explicitly.
    const [initPhase, setInitPhase] = useState(INIT_PHASE.IDLE);
    // Ref mirror so synchronous callbacks (event handlers) can read the
    // current phase without a stale closure — state alone would lag by one
    // render in a callback captured earlier in the same tick.
    const initPhaseRef = useRef(INIT_PHASE.IDLE);
    const advancePhase = useCallback((next) => {
        initPhaseRef.current = next;
        setInitPhase(next);
    }, []);
    // Reset the pipeline to IDLE for every new video (mediaId changes) —
    // key={mediaId} on the outer wrapper already forces a full remount, so
    // this mainly documents intent / guards against any future change that
    // removes the key.
    useEffect(() => {
        advancePhase(INIT_PHASE.IDLE);
    }, [mediaId, advancePhase]);

    // ── Media + stream state ──────────────────────────────────────────────────
    const [mediaInfo, setMediaInfo] = useState(null);
    const [subtitles, setSubtitles] = useState([]);
    const [streamUrl, setStreamUrl] = useState(null);
    const [sessionId, setSessionId] = useState(null);
    const [loadingMedia, setLoadingMedia] = useState(true);
    const [mediaError, setMediaError] = useState(null);
    // FIX: separate "preparing HLS" state — shows a friendlier buffering message
    // while backend spins up FFmpeg and generates the first segments (3-5s).
    const [preparingStream, setPreparingStream] = useState(false);
    const [prepareLabel, setPrepareLabel] = useState("Preparing stream…");

    // ── Pinch-zoom state (real scale/pan, lifted so VideoCore can apply transform) ──
    const [zoomState, setZoomState] = useState({ scale: 1, panX: 0, panY: 0 });
    const handleZoomChange = useCallback((z) => setZoomState(z), []);

    // Reset zoom whenever a new stream loads
    useEffect(() => {
        setZoomState({ scale: 1, panX: 0, panY: 0 });
    }, [streamUrl]);

    useEffect(() => {
        sessionIdRef.current = sessionId;
    }, [sessionId]);

    // Suppresses VideoCore's handleTimeUpdate → actions.setCurrentTime while
    // a quality-switch restore is in flight. Without this, the freshly
    // attached <video> element's own real (not-yet-seeked) timeupdate events
    // keep reporting ~0 and immediately overwrite the optimistic
    // setCurrentTime(pending.time) below every single tick, for however long
    // deferredSeek's poll takes to actually land the seek — which is exactly
    // why the seek bar/time text sat at 00:00 despite the underlying seek
    // being correct the whole time. Same race the audio-track watchdog had
    // against deliberate seeks elsewhere in this codebase, same fix shape.
    const suppressTimeUpdateRef = useRef(false);

    // ── Overlay state ─────────────────────────────────────────────────────────
    const [overlayState, setOverlayState] = useState({
        brightness: 1,
        volume: 1,
        muted: false,
        seekDir: "forward",
        seekSec: 10,
        audioTrack: "",
    });

    const brightnessOverlay = useOverlay(1400);
    const volumeOverlay = useOverlay(1400);
    const seekOverlay = useOverlay(900);
    const speedBoostOverlay = useOverlay(60000);
    const lockOverlay = useOverlay(1800);
    const audioTrackOverlay = useOverlay(1800);

    const overlayTriggers = {
        triggerBrightness: brightnessOverlay.trigger,
        triggerVolume: volumeOverlay.trigger,
        triggerSeek: seekOverlay.trigger,
        triggerSpeedBoost: speedBoostOverlay.trigger,
        triggerLock: lockOverlay.trigger,
        triggerAudioTrack: audioTrackOverlay.trigger,
    };

    const overlayVis = {
        showBrightness: brightnessOverlay.visible,
        showVolume: volumeOverlay.visible,
        showSeek: seekOverlay.visible,
        showSpeedBoost: speedBoostOverlay.visible,
        showLock: lockOverlay.visible,
        showAudioTrack: audioTrackOverlay.visible,
    };

    // ── Controls visibility state machine ─────────────────────────────────────
    //
    // ROOT CAUSE AUDIT (doc section 9) of the previous implementation:
    //  1. onVideoClick was wired to showControls() (always-show), not a
    //     toggle — tapping while controls were visible just reset the timer
    //     instead of hiding them. Fixed last session via toggleControls(),
    //     kept here.
    //  2. showControls()/the hide timer was ONLY called from: keyboard
    //     shortcuts, and the center-play-bubble tap. Touch-drag gestures
    //     (brightness/volume/seek swipe) and PlayerControls' own buttons
    //     (play/pause, seek±10, subtitle/audio/speed menus, SeekBar drag)
    //     never restarted the timer — controls could vanish out from under
    //     an open menu or mid-swipe. Doc section 4 requires ALL of these to
    //     count as activity. Fixed by exposing one markActivity() function
    //     that everything in the tree now calls.
    //  3. Only one boolean (controlsVisible) existed — no distinction
    //     between "hidden" and "currently fading out", so a fast re-tap
    //     during the fade could restart the show timer while the hide CSS
    //     transition was still animating, causing a visible flicker/race.
    //     Fixed with an explicit 4-phase machine; the boolean exposed to
    //     PlayerControls is just phase === VISIBLE || ANIMATING_OUT (so it
    //     stays mounted/rendered during the fade-out, and CSS opacity does
    //     the animating — see flux-controls-fade class).
    //
    // Single timer source of truth: hideTimer ref, always cleared before any
    // new one is set. No other timer for this concern exists anywhere else
    // in the tree after this change.
    const PHASE = { HIDDEN: "HIDDEN", ANIMATING_IN: "ANIMATING_IN", VISIBLE: "VISIBLE", ANIMATING_OUT: "ANIMATING_OUT" };
    const [controlsPhase, setControlsPhase] = useState(PHASE.VISIBLE);
    const animTimer = useRef(null);
    const HIDE_DELAY = 3000; // spec section 2.B / 3-Second Auto-Hide Countdown Timer: exactly 3000ms
    // Spec explicitly gives DIFFERENT durations per direction — not one
    // shared value: "ease-out alpha-fade... over 150 milliseconds" for
    // entrance (State B), vs "smooth 300ms linear alpha fade-out" for the
    // auto-hide/tap-to-hide exit (Requirement II.3 / III.2).
    const FADE_IN_MS = 150;
    const FADE_OUT_MS = 300;

    const clearAllControlsTimers = useCallback(() => {
        clearTimeout(hideTimer.current);
        clearTimeout(animTimer.current);
    }, []);

    // markActivity — THE one function any interaction anywhere should call.
    // Always shows controls (or keeps them shown) and restarts the 3s timer.
    const markActivity = useCallback(() => {
        clearAllControlsTimers();
        setControlsPhase((prev) => (prev === PHASE.VISIBLE ? PHASE.VISIBLE : PHASE.ANIMATING_IN));
        actions.setControlsVisible(true);
        if (controlsPhase !== PHASE.VISIBLE) {
            animTimer.current = setTimeout(() => setControlsPhase(PHASE.VISIBLE), FADE_IN_MS);
        }
        if (state.playing) {
            hideTimer.current = setTimeout(() => {
                setControlsPhase(PHASE.ANIMATING_OUT);
                animTimer.current = setTimeout(() => {
                    setControlsPhase(PHASE.HIDDEN);
                    actions.setControlsVisible(false);
                }, FADE_OUT_MS);
            }, HIDE_DELAY);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [actions, state.playing, controlsPhase, clearAllControlsTimers]);

    // Back-compat name used by existing call sites (keyboard shortcuts, etc).
    const showControls = markActivity;

    // toggleControls — used only by the actual single-tap-on-video path.
    // Visible → hide immediately, regardless of paused/playing. Previously
    // gated on state.playing, which meant tapping to hide silently did
    // nothing while paused — a deliberate tap should always be able to
    // dismiss controls; only the AUTOMATIC 3s auto-hide stays disabled
    // while paused (that's handled separately, in markActivity and the
    // playing-state effect below — unaffected by this change).
    // Hidden/animating → markActivity (show + restart timer, timer itself
    // a no-op while paused).
    const toggleControls = useCallback(() => {
        if (controlsPhase === PHASE.VISIBLE || controlsPhase === PHASE.ANIMATING_IN) {
            clearAllControlsTimers();
            setControlsPhase(PHASE.ANIMATING_OUT);
            animTimer.current = setTimeout(() => {
                setControlsPhase(PHASE.HIDDEN);
                actions.setControlsVisible(false);
            }, FADE_OUT_MS);
        } else {
            markActivity();
        }
    }, [controlsPhase, clearAllControlsTimers, markActivity, actions]);

    // Pausing must always reveal controls and hold them (no auto-hide while
    // paused — doc section 5 "never become stuck", matches prior behavior).
    useEffect(() => {
        if (!state.playing) {
            clearAllControlsTimers();
            setControlsPhase(PHASE.VISIBLE);
            actions.setControlsVisible(true);
        } else {
            markActivity();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.playing]);

    // Cleanup on unmount — doc section 8.
    useEffect(() => clearAllControlsTimers, [clearAllControlsTimers]);

    useEffect(() => {
        setOverlayState((s) => ({ ...s, brightness: state.brightness, volume: state.volume, muted: state.muted }));
    }, [state.brightness, state.volume, state.muted]);

    // ── Fullscreen ────────────────────────────────────────────────────────────
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        let settleTimer = null;
        const onFullscreenChange = () => {
            // FIX: some Android browsers fire a real (not just duplicate)
            // fullscreenchange blip during a pure orientation transition —
            // document.fullscreenElement briefly reads null then restores
            // itself a moment later, even though the user never actually
            // exited fullscreen. This happens e.g. when the Quick Action
            // Row's "Screen Rotation" icon calls
            // screen.orientation.lock("portrait"/"landscape") while already
            // in fullscreen. Reacting to the event immediately made the
            // unrelated bottom-right Fullscreen icon flip its
            // Maximize/Minimize display for that blip — rotation and
            // fullscreen are meant to stay fully independent. Re-check
            // after a short settle delay; only commit the state change if
            // the value still holds, filtering out self-correcting blips.
            clearTimeout(settleTimer);
            settleTimer = setTimeout(() => {
                actions.setFullscreen(!!document.fullscreenElement);
            }, 120);
        };
        document.addEventListener("fullscreenchange", onFullscreenChange);
        container._toggleFullscreen = () => {
            if (document.fullscreenElement) {
                document.exitFullscreen().catch(() => {});
            } else {
                container.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
            }
        };
        return () => {
            clearTimeout(settleTimer);
            document.removeEventListener("fullscreenchange", onFullscreenChange);
            if (container) delete container._toggleFullscreen;
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── PiP ───────────────────────────────────────────────────────────────────
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const onPiPChange = () => {
            actions.setPiP(document.pictureInPictureElement === videoRef.current);
        };
        document.addEventListener("enterpictureinpicture", onPiPChange);
        document.addEventListener("leavepictureinpicture", onPiPChange);
        container._togglePiP = async () => {
            const video = videoRef.current;
            if (!video) return;
            try {
                if (document.pictureInPictureElement) await document.exitPictureInPicture();
                else await video.requestPictureInPicture();
            } catch {
                /* PiP not supported */
            }
        };
        return () => {
            document.removeEventListener("enterpictureinpicture", onPiPChange);
            document.removeEventListener("leavepictureinpicture", onPiPChange);
            if (container) delete container._togglePiP;
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── HLS session heartbeat ─────────────────────────────────────────────────
    // FIX (Report-08): was heartbeatSession(sessionId, clientIdRef.current)
    // which passed clientId string as positionSec → parseFloat("web_xyz") = NaN
    // → downloadPositionSec never updated → cleanup couldn't track real position.
    // Correct signature: heartbeatSession(sessionId, positionSec, clientId)
    useEffect(() => {
        if (!sessionId) return;
        const interval = setInterval(() => {
            const positionSec = videoRef.current?.currentTime ?? 0;
            heartbeatSession(sessionId, positionSec, clientIdRef.current);
        }, 10_000);
        return () => clearInterval(interval);
    }, [sessionId]);

    // ── Cleanup on unmount (per-video, fires on every switch AND true exit) ──
    // FIX: this used to ALSO call document.exitFullscreen() + orientation
    // unlock right here. Since PlayerInner remounts on every media switch
    // (key={mediaId}), that meant fullscreen got exited and orientation
    // unlocked on every single switch — the exact two-step "flips to
    // portrait, then auto-switches back to landscape" bug. stopSession
    // correctly belongs here (this video's backend transcode session really
    // does need stopping on every switch); fullscreen/orientation lifecycle
    // now belongs to PlayerShell, which only unmounts on true exit.
    useEffect(() => {
        return () => {
            if (sessionIdRef.current) stopSession(sessionIdRef.current, clientIdRef.current);
        };
    }, []);

    // ── Load media + resolve stream ───────────────────────────────────────────
    useEffect(() => {
        if (!mediaId) return;
        let cancelled = false;
        setLoadingMedia(true);
        setMediaError(null);
        setStreamUrl(null);
        setSessionId(null);
        setPreparingStream(false);
        // FIX (subtitle picker shows nothing checked, but a subtitle still
        // renders): state.activeSubtitle lives in PlayerProvider's context,
        // which correctly no longer remounts per media switch — but nothing
        // ever cleared it between videos. The PREVIOUS video's subtitle
        // stayed active (and kept rendering) until the new video's own
        // history-load async callback eventually overwrote it — meanwhile
        // the Picker lists the NEW video's own tracks, none of which match
        // that stale leftover URL, so nothing showed as checked.
        actions.setActiveSubtitle(null);
        sessionTimeOffsetRef.current = 0;
        manualClockRef.current = { active: false, baseTime: 0, baseX: 0 };
        advancePhase(INIT_PHASE.LOADING_MEDIA);

        (async () => {
            try {
                // Step 1 — fetch media metadata
                setPrepareLabel("Loading media info…");
                const data = await getMediaById(mediaId);
                if (cancelled) return;
                const file = data?.file || data;
                const metadata = file?.metadata || {};

                setMediaInfo({
                    title: metadata?.title || file?.name || "Unknown",
                    type: metadata?.type || file?.parsed?.type || "movie",
                    season: file?.parsed?.season || null,
                    episode: file?.parsed?.episode || null,
                    episodeTitle: null,
                    poster: metadata?.poster || null,
                    year: metadata?.year || null,
                });

                // Step 2 — resolve playback (may take 3-5s for HLS to start FFmpeg)
                setPreparingStream(true);
                setPrepareLabel("Preparing stream…");

                const playback = await resolvePlayback(mediaId);
                if (cancelled) return;

                clientIdRef.current = playback.clientId;

                // FIX (Report-25): capture real ffprobe duration
                if (playback.duration && playback.duration > 0) {
                    mediaDurationRef.current = playback.duration;
                }

                if (playback.mode === "hls") {
                    setSessionId(playback.sessionId);
                    sessionIdRef.current = playback.sessionId;
                    setStreamUrl(playback.hlsUrl);
                } else {
                    setStreamUrl(playback.streamUrl);
                }

                // Step 3 — subtitles (non-fatal)
                try {
                    const subData = await getSubtitles(mediaId);
                    if (!cancelled) {
                        const subs = subData?.subtitles || [];
                        setSubtitles(subs);

                        // Auto-select subtitle from history pref first; then default to English.
                        // Deferred so history load (below) can override.
                        if (subs.length > 0) {
                            // Prefer English track; fall back to first track
                            const english = subs.find((s) => (s.lang || "").toLowerCase().startsWith("en") || (s.label || "").toLowerCase().startsWith("english"));
                            const defaultSub = english || null; // null = off by default if no English
                            // Will be overridden below if history has a saved subtitle pref
                            setDefaultSubRef.current = { subs, defaultSub };
                        }
                    }
                } catch {
                    /* no subtitles */
                }
            } catch (err) {
                if (!cancelled) setMediaError(err.message || "Failed to load media");
            } finally {
                if (!cancelled) {
                    setLoadingMedia(false);
                    setPreparingStream(false);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [mediaId]);

    // Tracks whether landscape has EVER actually engaged this mount. Once
    // true, later media switches must NOT re-call screen.orientation.lock()
    // at all — doing so (even redundantly, to the same orientation) was
    // ── Orientation + Fullscreen orchestration (mobile init pipeline) ─────────
    // Runs exactly once SEEK_COMPLETE is reached (resume seek finished, or
    // immediately for a fresh video with no seek stage at all — see the
    // SEEK_COMPLETE-entry effects further down). Desktop/tablet bypass this
    // entirely and jump straight to FIRST_FRAME_READY, leaving existing
    // desktop behavior completely untouched.
    //
    // Sequence: request fullscreen → lock landscape once fullscreen engages
    // → advance to FULLSCREEN_READY regardless of success/failure. A
    // rejected fullscreen/orientation call (gesture-policy, unsupported
    // API, etc.) does NOT block the pipeline forever — it just means this
    // stage is skipped, matching the doc's explicit "unless the browser
    // prevents earlier orientation changes" allowance. Blocking playback
    // indefinitely because a non-critical cosmetic stage failed would be
    // strictly worse than the bug we're fixing.
    const fullscreenStageStarted = useRef(false);
    useEffect(() => {
        if (initPhase !== INIT_PHASE.SEEK_COMPLETE) return;

        if (!isMobile) {
            // Desktop/tablet: skip landscape+fullscreen stages entirely.
            advancePhase(INIT_PHASE.FIRST_FRAME_READY);
            return;
        }
        if (fullscreenStageStarted.current) return;
        fullscreenStageStarted.current = true;

        advancePhase(INIT_PHASE.LANDSCAPE_READY);

        const container = containerRef.current;
        const proceedToFullscreenReady = () => advancePhase(INIT_PHASE.FULLSCREEN_READY);

        if (!container || document.fullscreenElement) {
            // containerRef now belongs to the stable PlayerShell wrapper (not
            // recreated per video), so fullscreen/orientation state is no
            // longer interrupted by a media switch — screen.orientation.type
            // is a reliable, non-racy read here. Only re-locks if genuinely
            // not landscape (e.g. the previous video had a manual portrait
            // override) and there's no override in effect for THIS video.
            if (isMobile && !isPortraitOverride && !screen.orientation?.type?.startsWith("landscape")) {
                screen.orientation?.lock?.("landscape").catch(() => {});
            }
            proceedToFullscreenReady();
            return;
        }

        container
            .requestFullscreen?.({ navigationUI: "hide" })
            .then(() => {
                screen.orientation?.lock?.("landscape").catch((err) => {
                    console.warn("[Player] orientation.lock failed after fullscreen:", err?.name, err?.message || err);
                });
            })
            .catch((err) => {
                // Gesture-policy rejection on cross-page navigation is the
                // expected/common case here — logged for visibility, not
                // treated as fatal. Pipeline proceeds regardless.
                console.warn("[Player] requestFullscreen failed on auto-trigger:", err?.name, err?.message || err);
            })
            .finally(proceedToFullscreenReady);
    }, [initPhase, isMobile, advancePhase]);

    // Reset the fullscreen-stage guard per video.
    useEffect(() => {
        fullscreenStageStarted.current = false;
    }, [mediaId]);

    // Orientation unlock-on-exit now lives in PlayerShell (below), which only
    // unmounts when actually leaving the player — this component remounts on
    // every media switch (key={mediaId} on the outer wrapper), so a cleanup
    // effect here would incorrectly unlock orientation on every switch too.

    // ── FULLSCREEN_READY → FIRST_FRAME_READY → PLAYING ────────────────────────
    // Keep phase advance for pipeline consistency; play is now triggered
    // separately below, directly on state.isReady, bypassing stalled phases.
    const reachedPlayingRef = useRef(false);
    useEffect(() => {
        if (initPhase !== INIT_PHASE.FULLSCREEN_READY || !state.isReady) return;
        if (reachedPlayingRef.current) return;
        reachedPlayingRef.current = true;
        advancePhase(INIT_PHASE.FIRST_FRAME_READY);
        advancePhase(INIT_PHASE.PLAYING);
    }, [initPhase, state.isReady, advancePhase]);
    useEffect(() => {
        reachedPlayingRef.current = false;
    }, [mediaId]);

    // ── Autoplay — direct trigger on isReady, no initPhase dependency ────────
    // Root cause of previous failures: play was gated on initPhase reaching
    // FULLSCREEN_READY, which required SEEK_COMPLETE — but SEEK_COMPLETE was
    // never advanced when useProgress guards (seekFiredRef / showResumeDialog)
    // short-circuited. Fix: trigger directly on state.isReady + streamUrl.
    // Muted first (browsers always allow muted autoplay), unmuted 400ms later
    // once play() is committed — flipping muted too early rejects play() on
    // some Android builds.
    const autoplayFiredRef = useRef(false);
    useEffect(() => {
        if (!state.isReady || !streamUrl) return;
        if (autoplayFiredRef.current) return;
        autoplayFiredRef.current = true;
        actions.setMuted(true);
        actions.setPlaying(true);
        const t = setTimeout(() => actions.setMuted(false), 400);
        return () => clearTimeout(t);
    }, [state.isReady, streamUrl, actions]);
    useEffect(() => {
        autoplayFiredRef.current = false;
    }, [mediaId]);

    // ── Manual screen rotation toggle (Screen Rotation icon) ──────────────────
    // Default is locked landscape (set above + via auto-fullscreen). This lets
    // the user manually flip to portrait without fighting that lock — tapping
    // again returns to locked landscape. Exposed via containerRef like the
    // other manual toggles (_toggleFullscreen, _togglePiP) so PlayerControls
    // can call it without prop-drilling.
    // FIX: this was a plain useRef, which is invisible to React — the Quick
    // Action Row's icon had no way to reflect whether rotation override was
    // actually active (always rendered "off"/inactive regardless of real
    // state). Converted to real state so the icon's active/inactive look
    // can genuinely track it.
    const [isPortraitOverride, setIsPortraitOverride] = useState(false);
    useEffect(() => {
        setIsPortraitOverride(false);
    }, [mediaId]);
    const toggleManualRotation = useCallback(() => {
        if (!screen.orientation?.lock) return; // unsupported — button still visually present, just inert
        if (isPortraitOverride) {
            screen.orientation.lock("landscape").catch(() => {});
            setIsPortraitOverride(false);
        } else {
            screen.orientation.lock("portrait").catch(() => {});
            setIsPortraitOverride(true);
        }
    }, [isPortraitOverride]);

    useEffect(() => {
        const container = containerRef.current;
        if (container) container._toggleRotation = toggleManualRotation;
        return () => {
            if (container) delete container._toggleRotation;
        };
    }, [toggleManualRotation]);

    // ── A-B Repeat ──────────────────────────────────────────────────────────────
    // Real loop: when active and both points are set, jump back to A every
    // time playback crosses B. Implemented via timeupdate polling (cheap —
    // timeupdate already fires ~4x/sec) rather than a separate interval.
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !state.abRepeat.active) return;
        const { a, b } = state.abRepeat;
        if (a == null || b == null || b <= a) return;
        const onTimeUpdate = () => {
            if (video.currentTime >= b) {
                video.currentTime = a;
            }
        };
        video.addEventListener("timeupdate", onTimeUpdate);
        return () => video.removeEventListener("timeupdate", onTimeUpdate);
    }, [state.abRepeat.active, state.abRepeat.a, state.abRepeat.b]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Background Play ─────────────────────────────────────────────────────────
    // When enabled, don't let the browser/OS pause playback when the tab/app
    // is backgrounded. Most mobile browsers auto-pause <video> on
    // visibilitychange to save resources — when this is on, we explicitly
    // re-call play() to override that. Audio continues even with screen off
    // on most platforms once this fires. When disabled, let default behavior
    // happen (don't fight the browser's own pause).
    useEffect(() => {
        if (!state.backgroundPlay) return;
        const onVisibilityChange = () => {
            if (document.visibilityState === "hidden" && state.playing) {
                videoRef.current?.play().catch(() => {});
            }
        };
        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => document.removeEventListener("visibilitychange", onVisibilityChange);
    }, [state.backgroundPlay, state.playing]);

    // ── Sleep Timer ──────────────────────────────────────────────────────────────
    // sleepTimerPlayToEnd ("Play last media to the end" checkbox): when true,
    // the timer elapsing does NOT hard-pause mid-scene — it just clears its
    // own pending state and lets playback continue naturally. VideoCore's
    // existing handleEnded already calls setPlaying(false) once the video
    // actually finishes, which is the real pause point in that mode.
    useEffect(() => {
        if (!state.sleepTimerEndsAt) return;
        const msLeft = state.sleepTimerEndsAt - Date.now();
        const fire = () => {
            if (!state.sleepTimerPlayToEnd) {
                actions.setPlaying(false);
            }
            actions.setSleepTimer(null);
        };
        if (msLeft <= 0) {
            fire();
            return;
        }
        const t = setTimeout(fire, msLeft);
        return () => clearTimeout(t);
    }, [state.sleepTimerEndsAt, state.sleepTimerPlayToEnd, actions]);

    // ── Progress tracking ─────────────────────────────────────────────────────
    const progressProps = useProgress({
        mediaId,
        clientId: clientIdRef.current,
        name: mediaInfo?.title,
        type: mediaInfo?.type,
        poster: mediaInfo?.poster,
        videoRef,
        playing: state.playing,
        mediaDuration: mediaDurationRef.current,
        streamUrl, // FIX (Report-28): needed as dep so timeupdate listener attaches
        getToken, // FIX (Report-28): auth token for unmount keepalive fetch
        activeSubtitle: state.activeSubtitle, // NEW: save subtitle pref to history
        hlsRef, // NEW: hls instance for accurate resume seek via startLoad
        knownResumePosition, // NEW: instant resume-dialog hint from MediaDetails, avoids waiting on this hook's own history fetch before showing the dialog
        // FIX (resume showed 0:00 climbing up instead of the real saved
        // position): deferredSeek needs these to optimistically update the
        // displayed time immediately and block native timeupdate from
        // overwriting it while the seek is still polling — same mechanism
        // the quality-switch path already used, just never wired through
        // to the resume-dialog path before.
        actions,
        suppressTimeUpdateRef,
        sessionTimeOffsetRef,
        onHistoryLoaded: (entry) => {
            // Restore subtitle preference from history
            if (!entry?.subtitlePref) {
                // No saved pref — apply default (English or off)
                const { subs, defaultSub } = setDefaultSubRef.current || {};
                if (subs?.length > 0) actions.setActiveSubtitle(defaultSub || null);
                return;
            }
            const { subs } = setDefaultSubRef.current || {};
            if (!subs?.length) return;
            // Match saved subtitle by lang + source
            const saved = entry.subtitlePref;
            const match = subs.find((s) => s.url === saved.url || (s.lang === saved.lang && s.source === saved.source));
            actions.setActiveSubtitle(match || null);
        },
    });

    // ── Autoplay (doc section 1) ───────────────────────────────────────────────
    // useProgress never calls setPlaying — playback start has always been
    // fully manual (user taps play). Root cause for "autoplay doesn't work":
    // there was no autoplay trigger anywhere in this codebase.
    //
    // Implemented WITHOUT touching useProgress.jsx (it's load-bearing for
    // resume/seek/history-save — editing it blind risks regressing those).
    // Instead: wrap the onReadyToSeek callback already passed into VideoCore.
    // If no resume dialog is about to show (fresh video, or already past 10s
    // threshold check), start playback right after ready. If the resume
    // dialog WILL show, hold off — autoplay fires instead from the
    // Resume/Start Over button handlers below, after the user's explicit
    // choice (you don't want it auto-playing under the dialog while they're
    // still deciding where to resume from).
    // ── Autoplay (simplified per explicit request) ─────────────────────────────
    // Every video, every time it opens: auto-rotate to landscape + auto-play,
    // no special navigation flag needed. For a fresh video (no history),
    // play starts immediately once ready. For a previously-watched video,
    // auto-resume fires the SAME way the manual "Resume" button does —
    // wait for HLS to reach the saved position, then play — but triggered
    // automatically instead of waiting for a tap. The resume dialog still
    // shows on top of this the whole time, purely as an optional override
    // if the user actually wants to start over instead.
    // Drives METADATA_READY → BUFFERING → SEEKING/SEEK_COMPLETE. VideoCore
    // calling this signals the HLS manifest, metadata, and initial buffer
    // are all ready — exactly METADATA_READY + BUFFERING combined per the
    // doc's pipeline (VideoCore's own internal logic already gates this
    // callback on those conditions). play() is intentionally NOT called
    // here — it only happens once the phase machine actually reaches
    // PLAYING (see the dedicated effect below), so the sequence can't be
    // accidentally short-circuited by calling this function early.
    // ── On-demand quality switch (new session per tier, not a full ABR ladder) ──
    // Backend already supports an explicit ?quality= override on the same
    // endpoint used for initial playback (streamController.js req.query.quality)
    // — this just calls it again mid-playback, captures/restores state around
    // the swap, same spirit as the audio-track seamless-switch work in
    // VideoCore.jsx but for a full new session (quality changes always need a
    // new ffmpeg process — there's no way around that, unlike audio which
    // stays within one manifest).
    //
    // ASSUMPTION FLAGGED: this calls resolvePlayback(mediaId, { quality }) —
    // assuming it forwards a second options arg through as ?quality=, the way
    // getMediaById/etc typically do in this codebase. I don't have
    // src/api/stream.js to confirm the exact signature — if this 401s or the
    // quality param doesn't reach the backend, that file's resolvePlayback
    // signature is different from assumed and needs adjusting here.
    // Maps a quality label (as sent by the picker / backend qualityLadder)
    // to a pixel height, for matching against state.qualityLevels (built
    // from hls.levels in MANIFEST_PARSED). "4k" isn't parseInt-friendly
    // (would read as 4), everything else is.
    const qualityLabelToHeight = useCallback((label) => {
        if (!label) return null;
        if (label === "4k") return 2160;
        const n = parseInt(label, 10);
        return Number.isFinite(n) ? n : null;
    }, []);

    const switchQuality = useCallback(
        async (targetQuality) => {
            if (!mediaId || !targetQuality) return;
            const video = videoRef.current;

            // ── Seamless path (YouTube-style) ───────────────────────────────
            // If the CURRENT manifest already lists a rendition at this
            // height (i.e. this session's HLS master.m3u8 is a real
            // multi-quality ladder, not a single-rendition stream), switch
            // to it via hls.nextLevel — HLS.js keeps playing whatever's
            // already buffered at the OLD level and only switches which
            // rendition the NEXT fragment loads from, seamlessly, at
            // whatever currentTime playback is already at. No new backend
            // session, no buffer flush, no deferredSeek, no restore race —
            // the entire class of "quality switch resets to 0:00" bugs
            // simply doesn't apply to this path because nothing ever tears
            // down or reloads.
            const targetHeight = qualityLabelToHeight(targetQuality);
            const matchingLevel = (state.qualityLevels || []).find((l) => l.height === targetHeight);
            if (matchingLevel && hlsRef.current) {
                console.log("[QUALITY] Seamless native switch — level", matchingLevel.index, `(${matchingLevel.label})`, "at currentTime", video?.currentTime);
                actions.setActiveQuality(matchingLevel.index);
                actions.setRequestedQuality(targetQuality);
                return;
            }

            // ── Fallback path: session restart ──────────────────────────────
            // No matching rendition in the current manifest — this session
            // was transcoded as a single fixed quality (ENABLE_MULTI_QUALITY
            // off, or the backend chose not to ladder this particular
            // media). Only option here is a genuinely new backend session
            // at the requested quality, so fall back to the proven
            // save-position → new-session → deferredSeek-restore flow.
            console.log("[QUALITY] No matching rendition in current manifest — falling back to session restart. Save Position:", video?.currentTime);
            qualitySwitchStateRef.current = {
                time: video?.currentTime || 0,
                playing: !!video && !video.paused,
                playbackRate: video?.playbackRate || 1,
                volume: video?.volume,
                muted: video?.muted,
                subtitle: state.activeSubtitle,
            };
            try {
                console.log("[QUALITY] Creating New Stream");
                // Pass seekSec so the new session's ffmpeg starts encoding
                // near where we actually are, not from 0:00 — without this,
                // the restore-seek below would jump forward past whatever
                // the fresh session buffered from the start, tripping the
                // exact same forward-gap-restart logic debugged at length
                // earlier in this project for audio switching.
                const playback = await resolvePlayback(mediaId, { quality: targetQuality, seekSec: qualitySwitchStateRef.current.time });
                if (playback.mode === "hls") {
                    setSessionId(playback.sessionId);
                    sessionIdRef.current = playback.sessionId;
                    setStreamUrl(playback.hlsUrl);
                    // FIX (video actually restarts from 0:00 after a quality
                    // switch): the backend DOES seek its source read via -ss
                    // to roughly this position (that's what seekSec above is
                    // for) — but VideoCore.jsx forces hls.startPosition = 0
                    // on every load, which normalizes THIS session's own
                    // timeline to start counting from 0 regardless of the
                    // segments' real absolute PTS. So this session's own
                    // video.currentTime=0 actually MEANS real position
                    // playback.startSegment * playback.segmentDuration, not
                    // real position 0. Seeking to the raw absolute time
                    // (qualitySwitchStateRef.current.time) here would be
                    // asking for a position way beyond anything this brand
                    // new session has buffered — exactly why it looked like
                    // a full restart. Store both the offset (for
                    // timeupdate/manual-seek correction elsewhere) and the
                    // actual RELATIVE seek target the video element should
                    // be told to go to.
                    const sessionOffset = (playback.startSegment || 0) * (playback.segmentDuration || 4);
                    qualitySwitchStateRef.current.sessionOffset = sessionOffset;
                    qualitySwitchStateRef.current.seekTarget = Math.max(0, qualitySwitchStateRef.current.time - sessionOffset);
                } else {
                    setStreamUrl(playback.streamUrl);
                    qualitySwitchStateRef.current.sessionOffset = 0;
                    qualitySwitchStateRef.current.seekTarget = qualitySwitchStateRef.current.time;
                }
                actions.setRequestedQuality(targetQuality);
                // VideoCore's existing [streamUrl] effect tears down and
                // rebuilds hls.js for the new URL, then fires onReadyToSeek
                // same as it does for the very first load — handleReadyToSeek
                // below checks qualitySwitchStateRef first and restores from
                // it instead of running the normal resume-dialog flow.
            } catch (err) {
                console.error("[PlayerPage] Quality switch failed:", err.message);
                qualitySwitchStateRef.current = null;
            }
        },
        [mediaId, state.activeSubtitle, state.qualityLevels, qualityLabelToHeight, actions],
    );

    const handledReadyForUrlRef = useRef(null);

    const handleReadyToSeek = useCallback(() => {
        // Defensive idempotency guard: if this streamUrl already had its
        // ready-to-seek signal handled once, ignore any further fire for the
        // SAME url (e.g. a phantom/internal HLS.js retry re-parsing the
        // manifest). Without this, a second fire would find
        // qualitySwitchStateRef already null (consumed by the first, correct
        // fire below) and incorrectly fall through to the fresh-video/resume
        // path, which can reset the just-restored displayed position.
        if (handledReadyForUrlRef.current === streamUrl) return;
        handledReadyForUrlRef.current = streamUrl;

        // Quality-switch restore path: if a quality switch is pending, this
        // ready signal is from the NEW-quality session finishing its initial
        // buffer, not a fresh video load. Restore captured state directly and
        // skip the resume-dialog/INIT_PHASE machinery entirely — that flow
        // assumes "opening a video for the first time," which is not what's
        // happening here and must not be disturbed by this addition.
        const pending = qualitySwitchStateRef.current;
        if (pending) {
            qualitySwitchStateRef.current = null;
            const video = videoRef.current;
            // FIX: was missing an immediate `actions.setCurrentTime(pending.time)`
            // here. video.currentTime only actually gets set once deferredSeek's
            // poll below confirms the new session's manifest is seekable to that
            // position — that can take a couple seconds (or worse, up to its full
            // 15s ceiling on a slow transcode start). Until it lands, the ONLY
            // thing driving the displayed seek bar / time text (state.currentTime)
            // is the native timeupdate event, which — on the freshly attached
            // video element — is still firing from 0 while waiting. So the real
            // playback position was always correct once landed, but the UI number
            // sat at 0:00 for however long the poll took. Setting it here,
            // immediately, using the value captured the instant the switch was
            // requested, makes the seek bar/time correct right away instead of
            // waiting on the async seek to catch up.
            actions.setCurrentTime(pending.time);
            // Manual clock takes over displaying x from here — it never
            // reads video.currentTime, so it can't be wrong about what
            // hls.js's internal timeline means. suppressTimeUpdateRef stays
            // true for the rest of this session (see below) so native
            // timeupdate never fights with it.
            manualClockRef.current = { active: true, baseTime: Date.now(), baseX: pending.time };
            // Block handleTimeUpdate from ever driving state.currentTime for
            // the rest of this quality-switched session — the manual clock
            // above is now the sole source of truth for x. (handleTimeUpdate
            // still updates state.buffered regardless, unaffected by this.)
            suppressTimeUpdateRef.current = true;
            // The actual video element still needs a real seek so the
            // CONTENT is correct — pending.seekTarget (computed in
            // switchQuality) is our best estimate of where that is in this
            // session's own timeline. Its precision no longer matters for
            // what's DISPLAYED (the manual clock owns that now); it only
            // affects which frames are actually playing.
            if (video) {
                console.log(`[QUALITY] Restoring: display=${pending.time} (manual clock engaged, seek target=${pending.seekTarget})`);
                progressProps.deferredSeek(pending.seekTarget, () => {
                    video.playbackRate = pending.playbackRate;
                    if (pending.volume != null) video.volume = pending.volume;
                    if (pending.muted != null) video.muted = pending.muted;
                    console.log("[QUALITY] Underlying video seek settled at:", video.currentTime, "— display is independently tracked by the manual clock now.");
                    if (pending.playing) video.play().catch(() => {});
                    // NOTE: suppressTimeUpdateRef intentionally stays true —
                    // it is NOT cleared here anymore. The manual clock is
                    // the permanent x source for this session.
                });
            }
            return;
        }
        console.log("[QUALITY] handleReadyToSeek: no pending quality-switch state — falling into fresh-video/resume-dialog path", { streamUrl, showResumeDialog: progressProps.showResumeDialog });
        advancePhase(INIT_PHASE.METADATA_READY);
        advancePhase(INIT_PHASE.BUFFERING);
        if (progressProps.showResumeDialog) {
            advancePhase(INIT_PHASE.SEEKING);
            // autoResume does NOT close the dialog — it keeps showing,
            // purely as an optional escape hatch the user can still tap to
            // Start Over instead. The onLanded callback fires once
            // deferredSeek's HLS-readiness poll actually succeeds.
            progressProps.autoResume?.(() => advancePhase(INIT_PHASE.SEEK_COMPLETE));
        } else {
            // Fresh video — no resume point, nothing to seek. There's
            // still a SEEKING/SEEK_COMPLETE stage per the doc's diagram,
            // but with zero work to do, so it resolves immediately.
            progressProps.onReadyToSeek?.(() => advancePhase(INIT_PHASE.SEEK_COMPLETE));
        }
    }, [progressProps, advancePhase, streamUrl]);

    const handleResumeWithAutoplay = useCallback(() => {
        progressProps.handleResume?.(() => actions.setPlaying(true));
    }, [progressProps, actions]);

    const handleStartOverWithAutoplay = useCallback(() => {
        // Start Over seeks to 0, which is always instantly seekable (segment 0
        // is transcoded first) — no need to wait, but route through the same
        // callback pattern for consistency.
        progressProps.handleStartOver?.();
        actions.setPlaying(true);
    }, [progressProps, actions]);

    // Browser autoplay restriction fallback: VideoCore's own play/pause sync
    // effect already calls video.play() when state.playing becomes true —
    // this effect does NOT duplicate that call. It only listens for the
    // FIRST interaction anywhere on the page after an autoplay attempt may
    // have been silently rejected by the browser (no user-gesture in the
    // call stack — SPA client-side navigation doesn't reliably count as one
    // for autoplay-permission purposes, even though the original button
    // press was a real click). Retries play() once that interaction lands,
    // so the video never just sits paused with zero explanation.
    useEffect(() => {
        if (!state.playing) return;
        const video = videoRef.current;
        if (!video) return;
        const retryIfPaused = () => {
            if (video.paused) video.play().catch(() => {});
        };
        // Broad net: any of these counts as "the user did something" —
        // covers taps on the gesture layer, the controls, or anywhere else.
        document.addEventListener("pointerdown", retryIfPaused, { once: true });
        document.addEventListener("touchstart", retryIfPaused, { once: true });
        document.addEventListener("keydown", retryIfPaused, { once: true });
        return () => {
            document.removeEventListener("pointerdown", retryIfPaused);
            document.removeEventListener("touchstart", retryIfPaused);
            document.removeEventListener("keydown", retryIfPaused);
        };
    }, [state.playing, streamUrl]);

    const handleBack = () => navigate(-1);

    // ── Loading / Preparing screen ────────────────────────────────────────────
    if (loadingMedia) {
        return (
            <div className="fixed inset-0 bg-black flex items-center justify-center z-50">
                <div className="flex flex-col items-center gap-5">
                    {/* Spinner */}
                    <div className="relative w-16 h-16">
                        <div className="absolute inset-0 border-4 border-white/10 rounded-full" />
                        <div className="absolute inset-0 border-4 border-transparent border-t-red-500 rounded-full animate-spin" />
                    </div>

                    {/* Label */}
                    <div className="flex flex-col items-center gap-1">
                        <span className="text-white/80 text-sm font-medium tracking-wide">{prepareLabel}</span>
                        {preparingStream && <span className="text-white/40 text-xs">Starting transcoder, please wait…</span>}
                    </div>

                    {/* Dot progress bar */}
                    {preparingStream && (
                        <div className="flex gap-1.5">
                            {[0, 1, 2, 3, 4].map((i) => (
                                <div
                                    key={i}
                                    className="w-1.5 h-1.5 rounded-full bg-red-500/70"
                                    style={{
                                        animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                                    }}
                                />
                            ))}
                        </div>
                    )}
                </div>

                <style>{`
                    @keyframes pulse {
                        0%, 100% { opacity: 0.3; transform: scale(0.8); }
                        50%       { opacity: 1;   transform: scale(1.2); }
                    }
                `}</style>
            </div>
        );
    }

    // ── Error screen ──────────────────────────────────────────────────────────
    if (mediaError) {
        return (
            <div className="fixed inset-0 bg-black flex flex-col items-center justify-center gap-4 z-50">
                <span className="text-red-400 text-base">{mediaError}</span>
                <button
                    onClick={handleBack}
                    className="px-6 py-2 rounded-xl bg-white/10 text-white text-sm
                               hover:bg-white/20 transition-colors">
                    Go Back
                </button>
            </div>
        );
    }

    // ── Player ────────────────────────────────────────────────────────────────
    return (
        <>
            {/* Video core */}
            {streamUrl && (
                <VideoCore
                    ref={videoRef}
                    streamUrl={streamUrl}
                    onVideoClick={toggleControls}
                    mediaDuration={mediaDurationRef.current}
                    onReadyToSeek={handleReadyToSeek}
                    suppressTimeUpdateRef={suppressTimeUpdateRef}
                    sessionTimeOffsetRef={sessionTimeOffsetRef}
                    onHlsCreated={(hls) => {
                        hlsRef.current = hls;
                    }}
                    zoomScale={zoomState.scale}
                    panX={zoomState.panX}
                    panY={zoomState.panY}
                />
            )}

            {/* Gesture layer */}
            <PlayerGestures
                videoRef={videoRef}
                containerRef={containerRef}
                overlayTriggers={overlayTriggers}
                setOverlayState={setOverlayState}
                showControls={showControls}
                onTap={toggleControls}
                onZoomChange={handleZoomChange}
            />

            {/* Visual overlays */}
            <PlayerOverlays overlayState={overlayState} overlayVis={overlayVis} />

            {/* Subtitles */}
            <SubtitleRenderer videoRef={videoRef} />

            {/* Screen lock */}
            <PlayerLock />

            {/* Controls UI — resume dialog now lives inside PlayerControls
                (moved from here per request); pass the data/handlers it
                needs through as props. */}
            <PlayerControls
                mediaInfo={mediaInfo}
                videoRef={videoRef}
                containerRef={containerRef}
                subtitles={subtitles}
                onBack={handleBack}
                onShowControls={showControls}
                controlsPhase={controlsPhase}
                isPortraitOverride={isPortraitOverride}
                onSwitchQuality={switchQuality}
                mediaId={mediaId}
                showResumeDialog={progressProps.showResumeDialog}
                resumeDialogFading={progressProps.resumeDialogFading}
                resumePoint={progressProps.resumePoint}
                onResume={handleResumeWithAutoplay}
                onStartOver={handleStartOverWithAutoplay}
                onDismissResumeDialog={progressProps.dismissResumeDialog}
                sessionTimeOffsetRef={sessionTimeOffsetRef}
            />

            {/* Waiting for stream to reach resume point — distinct from the
                generic buffering spinner below so the user understands why
                playback hasn't started yet (transcoding hasn't reached their
                saved position). Auto-clears + autoplay fires via the
                onLanded callback once deferredSeek's poll succeeds. */}
            {progressProps.isSeekingToResume && (
                <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
                    <div className="flex flex-col items-center gap-3 px-6 py-5 rounded-2xl bg-black/70 backdrop-blur-md border border-white/10">
                        <div className="w-10 h-10 border-3 border-white/20 border-t-white/90 rounded-full animate-spin" />
                        <p className="text-white/80 text-sm font-medium">Preparing your stream…</p>
                    </div>
                </div>
            )}

            {/* Buffering spinner */}
            {state.isBuffering && !state.error && (
                <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
                    <div className="w-14 h-14 border-4 border-white/20 border-t-white/90 rounded-full animate-spin" />
                </div>
            )}

            {/* Error overlay */}
            {state.error && (
                <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
                    <div className="px-6 py-4 rounded-2xl bg-black/80 border border-red-500/30 text-center max-w-xs">
                        <p className="text-red-400 text-sm font-medium">{state.error}</p>
                        <button
                            onClick={() => actions.setError(null)}
                            className="pointer-events-auto mt-3 px-4 py-1.5 rounded-lg bg-white/10 text-white/70 text-xs hover:bg-white/20 transition-colors">
                            Dismiss
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}

// ─── PlayerShell — stable across media switches ──────────────────────────────
// FIX (root cause of the portrait/landscape flip on every media switch):
// PlayerInner is keyed by mediaId (key={mediaId} below) so its internal
// per-video state resets cleanly — but that also fully unmounted/remounted
// PlayerInner's own containerRef div on every switch. Removing that div from
// the document forces the browser to exit fullscreen (fullscreenElement was
// just deleted), which drops the orientation lock — screen flips to
// portrait, then the new PlayerInner's own re-lock brings it back to
// landscape a moment later. Two-step flip, every single switch.
//
// PlayerShell owns containerRef and the actual fullscreen div instead — it
// has NO key, so it never unmounts on a media switch, only when actually
// leaving the player (navigating away). PlayerInner now receives
// containerRef as a prop and no longer creates its own or renders its own
// outer div, so switching media never touches the real fullscreen element at
// all anymore.
function PlayerShell({ mediaId, knownResumePosition }) {
    const isMobile = useIsMobile();
    const containerRef = useRef(null);

    // ── Immediate landscape lock — fires ONCE per player session, not once
    // per video. screen.orientation.lock() requires fullscreen on Android
    // Chrome — but containerRef.current is null before first paint, so this
    // fullscreens document.documentElement (always available) first.
    useEffect(() => {
        if (!isMobile) return;
        let engaged = false;
        const lock = async () => {
            try {
                if (!document.fullscreenElement) {
                    await document.documentElement.requestFullscreen({ navigationUI: "hide" });
                }
                await screen.orientation?.lock?.("landscape");
                engaged = true;
            } catch (_) {
                // iOS Safari / desktop / gesture-policy — fail silently.
                // Cross-page navigation often lacks the "transient user
                // activation" some browsers require for fullscreen/lock —
                // the fallback below catches this on the person's first tap.
            }
        };
        lock();
        // FIX (player opens in portrait, never rotates): if the silent
        // attempt above gets rejected (missing transient activation is the
        // common case right after a fresh navigation), it used to just give
        // up forever — player would sit in portrait until manually rotated.
        // A genuine tap anywhere on the player IS real user activation, so
        // retry once on the first pointerdown if not yet engaged.
        const retryOnFirstTap = () => {
            if (engaged) return;
            lock();
        };
        document.addEventListener("pointerdown", retryOnFirstTap, { once: true });
        return () => document.removeEventListener("pointerdown", retryOnFirstTap);
    }, [isMobile]);

    // ── Orientation unlock + fullscreen exit — ONLY on true unmount (leaving
    // the player), since PlayerShell itself is never remounted by a media
    // switch. This is the piece that used to live inside PlayerInner and
    // fire on every switch instead.
    useEffect(() => {
        return () => {
            if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
            try {
                screen.orientation?.unlock?.();
            } catch {
                // Unsupported — fail silently.
            }
        };
    }, []);

    return (
        <div ref={containerRef} className="fixed inset-0 bg-black select-none overflow-hidden" style={{ touchAction: "none" }}>
            <PlayerInner key={mediaId} mediaId={mediaId} knownResumePosition={knownResumePosition} containerRef={containerRef} />
        </div>
    );
}

// ─── Page export ──────────────────────────────────────────────────────────────

export default function PlayerPage() {
    const { id } = useParams();
    const location = useLocation();
    const mediaId = decodeURIComponent(id);
    const knownResumePosition = location.state?.knownResumePosition ?? null;
    return (
        <PlayerProvider>
            <PlayerShell mediaId={mediaId} knownResumePosition={knownResumePosition} />
        </PlayerProvider>
    );
}
