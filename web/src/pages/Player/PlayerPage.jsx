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

// ─── PlayerInner (inside PlayerProvider) ─────────────────────────────────────

function PlayerInner({ mediaId }) {
    const navigate = useNavigate();
    const containerRef = useRef(null);
    const videoRef = useRef(null);
    const hideTimer = useRef(null);
    const sessionIdRef = useRef(null);
    const clientIdRef = useRef(null);
    // FIX (Report-25): store ffprobe duration for useProgress unmount save
    const mediaDurationRef = useRef(null);

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
            if (screen.orientation?.unlock) screen.orientation.unlock();
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
                    if (!cancelled) setSubtitles(subData?.subtitles || []);
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
        if (screen.orientation?.lock) screen.orientation.lock("landscape").catch(() => {});
        return () => {
            if (screen.orientation?.unlock) screen.orientation.unlock();
        };
    }, []);

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
    });

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
            {streamUrl && <VideoCore ref={videoRef} streamUrl={streamUrl} onVideoClick={showControls} />}

            {/* Gesture layer */}
            <PlayerGestures videoRef={videoRef} containerRef={containerRef} overlayTriggers={overlayTriggers} setOverlayState={setOverlayState} showControls={showControls} />

            {/* Visual overlays */}
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
