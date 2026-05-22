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

// ─── PlayerInner (inside PlayerProvider) ─────────────────────────────────────

function PlayerInner({ mediaId }) {
    const navigate = useNavigate();
    const containerRef = useRef(null);
    const videoRef = useRef(null);
    const hideTimer = useRef(null);
    const sessionIdRef = useRef(null);
    const clientIdRef = useRef(null);

    const { state, actions } = usePlayerState();

    // ── Media + stream state ──────────────────────────────────────────────────
    const [mediaInfo, setMediaInfo] = useState(null);
    const [subtitles, setSubtitles] = useState([]);
    const [streamUrl, setStreamUrl] = useState(null);
    const [sessionId, setSessionId] = useState(null);
    const [loadingMedia, setLoadingMedia] = useState(true);
    const [mediaError, setMediaError] = useState(null);

    // Keep session refs current for use inside intervals / cleanup
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

    // ── Auto-hide controls ────────────────────────────────────────────────────
    const showControls = useCallback(() => {
        actions.setControlsVisible(true);
        clearTimeout(hideTimer.current);
        hideTimer.current = setTimeout(() => {
            if (state.playing) actions.setControlsVisible(false);
        }, 3500);
    }, [actions, state.playing]);

    useEffect(() => {
        if (!state.playing) {
            clearTimeout(hideTimer.current);
            actions.setControlsVisible(true);
        } else {
            showControls();
        }
    }, [state.playing]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => () => clearTimeout(hideTimer.current), []);

    // Sync overlay state ← player state
    useEffect(() => {
        setOverlayState((s) => ({ ...s, brightness: state.brightness, volume: state.volume, muted: state.muted }));
    }, [state.brightness, state.volume, state.muted]);

    // ── Fullscreen ────────────────────────────────────────────────────────────
    // FIX: fullscreen implemented here and surfaced via containerRef helper
    // so PlayerControls can call containerRef.current._toggleFullscreen()
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const onFullscreenChange = () => {
            actions.setFullscreen(!!document.fullscreenElement);
        };
        document.addEventListener("fullscreenchange", onFullscreenChange);

        // Attach helpers to the DOM node so child components can call them
        container._toggleFullscreen = () => {
            if (document.fullscreenElement) {
                document.exitFullscreen().catch(() => {});
            } else {
                container.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
            }
        };

        return () => {
            document.removeEventListener("fullscreenchange", onFullscreenChange);
            if (container) {
                delete container._toggleFullscreen;
            }
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Picture-in-Picture ────────────────────────────────────────────────────
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
                if (document.pictureInPictureElement) {
                    await document.exitPictureInPicture();
                } else {
                    await video.requestPictureInPicture();
                }
            } catch {
                // PiP not supported or user denied
            }
        };

        return () => {
            document.removeEventListener("enterpictureinpicture", onPiPChange);
            document.removeEventListener("leavepictureinpicture", onPiPChange);
            if (container) delete container._togglePiP;
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── HLS session heartbeat ─────────────────────────────────────────────────
    // Keeps the transcode session alive every 10s + updates download position
    // so the server's segment cleaner knows what's safe to delete.
    useEffect(() => {
        if (!sessionId) return;
        const interval = setInterval(() => {
            heartbeatSession(sessionId, clientIdRef.current);
        }, 10_000);
        return () => clearInterval(interval);
    }, [sessionId]);

    // ── Session cleanup on unmount ────────────────────────────────────────────
    useEffect(() => {
        return () => {
            if (sessionIdRef.current) {
                stopSession(sessionIdRef.current, clientIdRef.current);
            }
            if (document.fullscreenElement) {
                document.exitFullscreen().catch(() => {});
            }
            if (screen.orientation?.unlock) {
                screen.orientation.unlock();
            }
        };
    }, []);

    // ── Load media info + resolve stream ──────────────────────────────────────
    useEffect(() => {
        if (!mediaId) return;
        let cancelled = false;
        setLoadingMedia(true);
        setMediaError(null);
        setStreamUrl(null);
        setSessionId(null);

        (async () => {
            try {
                // 1. Fetch media metadata (title, poster, etc.)
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

                // 2. Smart playback decision via /stream/video/:id?info=1
                //    Returns { mode: "direct"|"hls", streamUrl?, hlsUrl?, sessionId?, clientId }
                const playback = await resolvePlayback(mediaId);
                if (cancelled) return;

                clientIdRef.current = playback.clientId;

                if (playback.mode === "hls") {
                    setSessionId(playback.sessionId);
                    sessionIdRef.current = playback.sessionId;
                    setStreamUrl(playback.hlsUrl);
                } else {
                    setStreamUrl(playback.streamUrl);
                }

                // 3. Subtitles (non-fatal)
                try {
                    const subData = await getSubtitles(mediaId);
                    if (!cancelled) setSubtitles(subData?.subtitles || []);
                } catch {
                    /* no subtitles — fine */
                }
            } catch (err) {
                if (!cancelled) setMediaError(err.message || "Failed to load media");
            } finally {
                if (!cancelled) setLoadingMedia(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [mediaId]);

    // Lock orientation to landscape on mobile
    useEffect(() => {
        if (screen.orientation?.lock) {
            screen.orientation.lock("landscape").catch(() => {});
        }
        return () => {
            if (screen.orientation?.unlock) screen.orientation.unlock();
        };
    }, []);

    // ── Progress tracking (resume + history) ──────────────────────────────────
    const progressProps = useProgress({
        mediaId,
        clientId: clientIdRef.current,
        name: mediaInfo?.title,
        type: mediaInfo?.type,
        poster: mediaInfo?.poster,
        streamUrl,
        videoRef,
        playing: state.playing,
        currentTime: state.currentTime,
        duration: state.duration,
    });

    const handleBack = () => navigate(-1);

    // ── Loading ───────────────────────────────────────────────────────────────
    if (loadingMedia) {
        return (
            <div className="fixed inset-0 bg-black flex items-center justify-center z-50">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin" />
                    <span className="text-white/60 text-sm font-medium tracking-wide">Loading…</span>
                </div>
            </div>
        );
    }

    // ── Error ─────────────────────────────────────────────────────────────────
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
            {streamUrl && <VideoCore ref={videoRef} streamUrl={streamUrl} onVideoClick={showControls} />}

            {/* Gesture layer */}
            <PlayerGestures videoRef={videoRef} containerRef={containerRef} overlayTriggers={overlayTriggers} setOverlayState={setOverlayState} showControls={showControls} />

            {/* Visual overlays (brightness / volume / seek feedback) */}
            <PlayerOverlays overlayState={overlayState} overlayVis={overlayVis} />

            {/* Subtitles */}
            <SubtitleRenderer />

            {/* Screen lock */}
            <PlayerLock />

            {/* Controls UI */}
            <PlayerControls mediaInfo={mediaInfo} videoRef={videoRef} containerRef={containerRef} subtitles={subtitles} onBack={handleBack} onShowControls={showControls} />

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
                            onClick={progressProps.handleStartOver}
                            className="px-3 py-1.5 rounded-lg bg-white/10 text-white/70 text-xs
                                       hover:bg-white/20 transition-colors shrink-0">
                            Start Over
                            <span className="ml-1 text-white/40">({progressProps.resumeCountdown})</span>
                        </button>
                        <button
                            onClick={progressProps.handleResume}
                            className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs
                                       font-semibold hover:bg-red-500 transition-colors shrink-0">
                            Resume
                        </button>
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
                            className="pointer-events-auto mt-3 px-4 py-1.5 rounded-lg
                                       bg-white/10 text-white/70 text-xs hover:bg-white/20 transition-colors">
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
