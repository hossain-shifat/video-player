import { useRef, useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
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

// ─── PlayerInner (inside PlayerProvider) ─────────────────────────────────────

function PlayerInner({ mediaId }) {
    const navigate = useNavigate();
    const isMobile = useIsMobile();
    const containerRef = useRef(null);
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

    const { state, actions } = usePlayerState();
    const { getToken } = useAuth();

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
    const HIDE_DELAY = 3000; // doc section 3: 3 seconds
    const FADE_MS = 200; // doc section 10: 150-250ms

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
            animTimer.current = setTimeout(() => setControlsPhase(PHASE.VISIBLE), FADE_MS);
        }
        if (state.playing) {
            hideTimer.current = setTimeout(() => {
                setControlsPhase(PHASE.ANIMATING_OUT);
                animTimer.current = setTimeout(() => {
                    setControlsPhase(PHASE.HIDDEN);
                    actions.setControlsVisible(false);
                }, FADE_MS);
            }, HIDE_DELAY);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [actions, state.playing, controlsPhase, clearAllControlsTimers]);

    // Back-compat name used by existing call sites (keyboard shortcuts, etc).
    const showControls = markActivity;

    // toggleControls — used only by the actual single-tap-on-video path.
    // Visible → hide immediately (still respects "don't hide while paused").
    // Hidden/animating → markActivity (show + restart timer).
    const toggleControls = useCallback(() => {
        if ((controlsPhase === PHASE.VISIBLE || controlsPhase === PHASE.ANIMATING_IN) && state.playing) {
            clearAllControlsTimers();
            setControlsPhase(PHASE.ANIMATING_OUT);
            animTimer.current = setTimeout(() => {
                setControlsPhase(PHASE.HIDDEN);
                actions.setControlsVisible(false);
            }, FADE_MS);
        } else {
            markActivity();
        }
    }, [controlsPhase, state.playing, clearAllControlsTimers, markActivity]);

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
        const onFullscreenChange = () => {
            actions.setFullscreen(!!document.fullscreenElement);
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

    // ── Cleanup on unmount ────────────────────────────────────────────────────
    useEffect(() => {
        return () => {
            if (sessionIdRef.current) stopSession(sessionIdRef.current, clientIdRef.current);
            if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
            try {
                screen.orientation?.unlock?.();
            } catch {
                // Unsupported — fail silently per doc section 2.
            }
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

    // ── Lock orientation ──────────────────────────────────────────────────────
    useEffect(() => {
        try {
            screen.orientation?.lock?.("landscape").catch(() => {});
        } catch {
            // Unsupported on this browser — fail silently per doc section 2.
        }
        return () => {
            try {
                screen.orientation?.unlock?.();
            } catch {
                // Unsupported — fail silently.
            }
        };
    }, []);

    // ── Auto-fullscreen + landscape on mobile when playback starts ────────────
    // FIX: screen.orientation.lock() generally only succeeds while the
    // document is actually in fullscreen on mobile browsers — calling it
    // outside fullscreen (as the effect above does on mount) silently fails
    // on most devices. So on mobile we also need to actively request
    // fullscreen once playback begins, then lock landscape once fullscreen
    // has actually engaged (fullscreenchange fires, THEN lock — locking
    // before the transition completes is unreliable).
    //
    // autoFullscreenDone ref ensures this only fires ONCE per mount — if the
    // user manually exits fullscreen mid-playback, we must not force them
    // back in on every subsequent play/pause toggle.
    const autoFullscreenDone = useRef(false);
    useEffect(() => {
        if (!isMobile || autoFullscreenDone.current || !state.playing) return;
        const container = containerRef.current;
        if (!container || document.fullscreenElement) {
            autoFullscreenDone.current = true;
            return;
        }
        autoFullscreenDone.current = true;
        container
            .requestFullscreen?.({ navigationUI: "hide" })
            .then(() => {
                screen.orientation?.lock?.("landscape").catch(() => {});
            })
            .catch(() => {
                // Fullscreen request can be rejected if not triggered by a
                // direct user gesture on some browsers — harmless no-op,
                // user can still tap the manual fullscreen button.
            });
    }, [isMobile, state.playing]);

    // ── Manual screen rotation toggle (Screen Rotation icon) ──────────────────
    // Default is locked landscape (set above + via auto-fullscreen). This lets
    // the user manually flip to portrait without fighting that lock — tapping
    // again returns to locked landscape. Exposed via containerRef like the
    // other manual toggles (_toggleFullscreen, _togglePiP) so PlayerControls
    // can call it without prop-drilling.
    const isPortraitOverride = useRef(false);
    const toggleManualRotation = useCallback(() => {
        if (!screen.orientation?.lock) return; // unsupported — button still visually present, just inert
        if (isPortraitOverride.current) {
            screen.orientation.lock("landscape").catch(() => {});
            isPortraitOverride.current = false;
        } else {
            screen.orientation.lock("portrait").catch(() => {});
            isPortraitOverride.current = true;
        }
    }, []);

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
    // Icon-only for now (per product decision) — sleepTimerEndsAt is tracked
    // in state but nothing currently sets it from the UI, so this effect is
    // dormant until that's wired up. Left in place so turning the UI on later
    // is a pure UI change with no logic to add.
    useEffect(() => {
        if (!state.sleepTimerEndsAt) return;
        const msLeft = state.sleepTimerEndsAt - Date.now();
        if (msLeft <= 0) {
            actions.setPlaying(false);
            actions.setSleepTimer(null);
            return;
        }
        const t = setTimeout(() => {
            actions.setPlaying(false);
            actions.setSleepTimer(null);
        }, msLeft);
        return () => clearTimeout(t);
    }, [state.sleepTimerEndsAt, actions]);

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
    const handleReadyToSeek = useCallback(() => {
        if (!progressProps.showResumeDialog) {
            progressProps.onReadyToSeek?.(() => actions.setPlaying(true));
        }
        // If the dialog IS showing, do nothing here — autoplay fires from the
        // Resume/Start Over handlers below once the user actually chooses.
    }, [progressProps, actions]);

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

    // Browser autoplay restriction fallback: if the play() promise rejects
    // (no prior user gesture on this page load — common when navigating
    // straight into the player), retry once on the very next tap/click
    // anywhere on the page, so the video never just sits paused with no
    // explanation (doc: "never leave the player paused without explanation").
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !state.playing) return;
        video.play().catch(() => {
            const retryOnce = () => {
                video.play().catch(() => {});
                document.removeEventListener("pointerdown", retryOnce);
            };
            document.addEventListener("pointerdown", retryOnce, { once: true });
        });
    }, [state.playing, streamUrl]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <div ref={containerRef} className="fixed inset-0 bg-black select-none overflow-hidden" style={{ touchAction: "none" }}>
            {/* Video core */}
            {streamUrl && (
                <VideoCore
                    ref={videoRef}
                    streamUrl={streamUrl}
                    onVideoClick={toggleControls}
                    mediaDuration={mediaDurationRef.current}
                    onReadyToSeek={handleReadyToSeek}
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
            <SubtitleRenderer />

            {/* Screen lock */}
            <PlayerLock />

            {/* Controls UI */}
            <PlayerControls
                mediaInfo={mediaInfo}
                videoRef={videoRef}
                containerRef={containerRef}
                subtitles={subtitles}
                onBack={handleBack}
                onShowControls={showControls}
                controlsPhase={controlsPhase}
            />

            {/* Resume dialog */}
            {progressProps.showResumeDialog && (
                <div className="absolute inset-0 z-60 flex items-end justify-center pb-28 px-4 pointer-events-none">
                    <div
                        className="pointer-events-auto flex items-center gap-3 px-5 py-4
                                    rounded-2xl bg-black/80 backdrop-blur-md border border-white/15
                                    shadow-2xl max-w-sm w-full">
                        <div className="flex-1 min-w-0">
                            <p className="text-white text-sm font-semibold leading-tight">Resume watching?</p>
                            <p className="text-white/50 text-xs mt-0.5">
                                Paused at {Math.floor((progressProps.resumePoint?.position || 0) / 60)}m {Math.floor((progressProps.resumePoint?.position || 0) % 60)}s
                            </p>
                        </div>
                        <button
                            onClick={handleStartOverWithAutoplay}
                            className="px-3 py-1.5 rounded-lg bg-white/10 text-white/70 text-xs
                                       hover:bg-white/20 transition-colors shrink-0">
                            Start Over
                            <span className="ml-1 text-white/40">({progressProps.resumeCountdown})</span>
                        </button>
                        <button
                            onClick={handleResumeWithAutoplay}
                            className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs
                                       font-semibold hover:bg-red-500 transition-colors shrink-0">
                            Resume
                        </button>
                    </div>
                </div>
            )}

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
        </div>
    );
}

// ─── Page export ──────────────────────────────────────────────────────────────

export default function PlayerPage() {
    const { id } = useParams();
    const mediaId = decodeURIComponent(id);
    return (
        <PlayerProvider>
            <PlayerInner mediaId={mediaId} />
        </PlayerProvider>
    );
}
