import { useRef, useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import { PlayerProvider } from "./UsePlayerState";
import VideoCore from "./VideoCore";
import PlayerControls from "./PlayerControls";
import PlayerGestures from "./PlayerGestures";
import PlayerLock from "./PlayerLock";
import PlayerOverlays, { useOverlay } from "./PlayerOverlays";
import SubtitleRenderer from "./SubtitleRenderer";
import { usePlayerState } from "./UsePlayerState";
import { useProgress } from "./useProgress";
import { getMediaById, getSubtitles } from "../../api/media";
import { resolvePlayback, heartbeatSession, stopSession } from "../../api/stream";

// ─── Inner component (inside PlayerProvider) ──────────────────────────────────

function PlayerInner({ mediaId }) {
    const navigate = useNavigate();
    const containerRef = useRef(null);
    const videoRef = useRef(null);
    const hideTimer = useRef(null);

    // Session state — in refs for use in intervals/cleanup
    const sessionIdRef = useRef(null);
    const clientIdRef = useRef(null);
    const [sessionId, setSessionId] = useState(null);

    // Keep ref in sync
    useEffect(() => {
        sessionIdRef.current = sessionId;
    }, [sessionId]);

    const { state, actions } = usePlayerState();

    // Media + stream state
    const [mediaInfo, setMediaInfo] = useState(null);
    const [subtitles, setSubtitles] = useState([]);
    const [streamUrl, setStreamUrl] = useState(null);
    const [startTimeSec, setStartTimeSec] = useState(0);
    const [loadingMedia, setLoadingMedia] = useState(true);
    const [mediaError, setMediaError] = useState(null);
    const [streamMode, setStreamMode] = useState(null); // "direct" | "hls"

    // Retry state
    const retryCountRef = useRef(0);
    const [isReconnecting, setIsReconnecting] = useState(false);

    // Overlay state
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

    // Sync overlay from state
    useEffect(() => {
        setOverlayState((s) => ({
            ...s,
            brightness: state.brightness,
            volume: state.volume,
            muted: state.muted,
        }));
    }, [state.brightness, state.volume, state.muted]);

    // ── Session heartbeat ─────────────────────────────────────────────────────
    // Sends positionSec so server knows what segments are safe to delete.
    // Jellyfin equivalent: ReportPlaybackProgress

    useEffect(() => {
        if (!sessionId) return;
        const interval = setInterval(() => {
            const pos = videoRef.current?.currentTime || 0;
            heartbeatSession(sessionId, pos, clientIdRef.current);
        }, 10_000);
        return () => clearInterval(interval);
    }, [sessionId]);

    // ── Session cleanup on unmount ────────────────────────────────────────────

    useEffect(() => {
        return () => {
            if (sessionIdRef.current) {
                stopSession(sessionIdRef.current, clientIdRef.current);
            }
        };
    }, []);

    // ── Stream reconnect (called when VideoCore reports 404 / session expired) ─

    const handleStreamReconnect = useCallback(async () => {
        if (isReconnecting || retryCountRef.current >= 3) {
            actions.setError("Stream failed after retries. Go back and try again.");
            return;
        }
        retryCountRef.current++;
        setIsReconnecting(true);
        actions.setError(null);

        try {
            const currentPos = videoRef.current?.currentTime || 0;
            const playback = await resolvePlayback(mediaId, {
                seekSec: Math.max(0, currentPos - 2), // small back-step to avoid edge
            });

            clientIdRef.current = playback.clientId;
            setStreamUrl(playback.mode === "hls" ? playback.hlsUrl : playback.streamUrl);
            setStartTimeSec(currentPos > 2 ? currentPos - 2 : 0);
            if (playback.sessionId) {
                setSessionId(playback.sessionId);
            }
            setStreamMode(playback.mode);
        } catch (err) {
            actions.setError(`Reconnect failed: ${err.message}`);
        } finally {
            setIsReconnecting(false);
        }
    }, [mediaId, isReconnecting, actions]);

    // ── Handle new session ID from server (seek restart) ─────────────────────
    // Server sends X-New-Session-Id when it restarted the session for a seek.
    // We must update our session ID to keep heartbeat pointing at the right session.

    const handleNewSessionId = useCallback((newSid) => {
        console.log("[PlayerPage] Server restarted session, new ID:", newSid);
        setSessionId(newSid);
    }, []);

    // ── Load media + resolve stream ───────────────────────────────────────────

    useEffect(() => {
        if (!mediaId) return;
        let cancelled = false;
        setLoadingMedia(true);
        setMediaError(null);
        retryCountRef.current = 0;

        (async () => {
            try {
                // 1. Fetch media metadata
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

                // 2. Resolve stream — pre-flight then start if needed
                //    Uses new /stream/info/:id → then POST /stream/transcode/:id for HLS
                //    This is the Jellyfin pattern: PlaybackInfo first, then StartStream
                const playback = await resolvePlayback(mediaId);
                if (cancelled) return;

                clientIdRef.current = playback.clientId;

                if (playback.mode === "hls") {
                    setStreamUrl(playback.hlsUrl);
                    setSessionId(playback.sessionId);
                } else {
                    setStreamUrl(playback.streamUrl);
                    setSessionId(null);
                }
                setStreamMode(playback.mode);
                setStartTimeSec(0); // resume handled by useProgress after canplay

                // 3. Subtitles (non-fatal)
                try {
                    const subData = await getSubtitles(mediaId);
                    if (!cancelled) setSubtitles(subData?.subtitles || []);
                } catch {
                    /* no subtitles */
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

    // ── Lock orientation to landscape on mobile ───────────────────────────────

    useEffect(() => {
        if (screen.orientation?.lock) {
            screen.orientation.lock("landscape").catch(() => {});
        }
        return () => {
            screen.orientation?.unlock?.();
        };
    }, []);

    // ── Progress / resume tracking ────────────────────────────────────────────

    const progressProps = useProgress({
        mediaId,
        name: mediaInfo?.title,
        type: mediaInfo?.type,
        poster: mediaInfo?.poster,
        streamUrl,
        videoRef,
        playing: state.playing,
        duration: state.duration,
    });

    // Wire canplay → onReadyToSeek so resume seek fires at the right time
    // This is called from a useEffect in VideoCore via the onCanPlay path.
    // We attach it by passing a callback to VideoCore through a ref trick,
    // OR we can listen on the video element directly here.
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        const handler = () => progressProps.onReadyToSeek();
        video.addEventListener("canplay", handler, { once: false });
        return () => video.removeEventListener("canplay", handler);
    }, [streamUrl, progressProps.onReadyToSeek]); // eslint-disable-line react-hooks/exhaustive-deps

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

    // ── Error (fatal load error) ──────────────────────────────────────────────

    if (mediaError) {
        return (
            <div className="fixed inset-0 bg-black flex flex-col items-center justify-center gap-4 z-50">
                <span className="text-red-400 text-base">{mediaError}</span>
                <button onClick={handleBack} className="px-6 py-2 rounded-xl bg-white/10 text-white text-sm hover:bg-white/20 transition-colors">
                    Go Back
                </button>
            </div>
        );
    }

    // ── Player ────────────────────────────────────────────────────────────────

    return (
        <div ref={containerRef} className="fixed inset-0 bg-black select-none overflow-hidden" style={{ touchAction: "none" }}>
            {/* Video core */}
            {streamUrl && <VideoCore ref={videoRef} streamUrl={streamUrl} startTimeSec={startTimeSec} onVideoClick={showControls} onNewSessionId={handleNewSessionId} />}

            {/* Gesture layer */}
            <PlayerGestures videoRef={videoRef} containerRef={containerRef} overlayTriggers={overlayTriggers} setOverlayState={setOverlayState} showControls={showControls} />

            {/* Visual overlays */}
            <PlayerOverlays overlayState={overlayState} overlayVis={overlayVis} />

            {/* Subtitles */}
            <SubtitleRenderer />

            {/* Screen lock */}
            <PlayerLock />

            {/* Controls */}
            <PlayerControls mediaInfo={mediaInfo} videoRef={videoRef} containerRef={containerRef} subtitles={subtitles} onBack={handleBack} onShowControls={showControls} />

            {/* Resume dialog */}
            {progressProps.showResumeDialog && (
                <div className="absolute inset-0 z-60 flex items-end justify-center pb-28 px-4 pointer-events-none">
                    <div className="pointer-events-auto flex items-center gap-3 px-5 py-4 rounded-2xl bg-black/80 backdrop-blur-md border border-white/15 shadow-2xl max-w-sm w-full">
                        <div className="flex-1 min-w-0">
                            <p className="text-white text-sm font-semibold leading-tight">Resume watching?</p>
                            <p className="text-white/50 text-xs mt-0.5">
                                Paused at {Math.floor((progressProps.resumePoint?.position || 0) / 60)}m {Math.floor((progressProps.resumePoint?.position || 0) % 60)}s
                            </p>
                        </div>
                        <button onClick={progressProps.handleStartOver} className="px-3 py-1.5 rounded-lg bg-white/10 text-white/70 text-xs hover:bg-white/20 transition-colors shrink-0">
                            Start Over
                            <span className="ml-1 text-white/40">({progressProps.resumeCountdown})</span>
                        </button>
                        <button onClick={progressProps.handleResume} className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-500 transition-colors shrink-0">
                            Resume
                        </button>
                    </div>
                </div>
            )}

            {/* Buffering spinner */}
            {(state.isBuffering || isReconnecting) && !state.error && (
                <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
                    <div className="w-14 h-14 border-4 border-white/20 border-t-white/90 rounded-full animate-spin" />
                    {isReconnecting && <span className="absolute top-[calc(50%+40px)] text-white/50 text-xs font-medium">Reconnecting…</span>}
                </div>
            )}

            {/* Error overlay (recoverable) */}
            {state.error && (
                <div className="absolute inset-0 z-20 flex items-center justify-center">
                    <div className="px-6 py-4 rounded-2xl bg-black/80 border border-red-500/30 text-center max-w-xs flex flex-col gap-3">
                        <p className="text-red-400 text-sm font-medium">{state.error}</p>
                        <div className="flex gap-2 justify-center">
                            <button
                                onClick={() => {
                                    actions.setError(null);
                                    handleStreamReconnect();
                                }}
                                className="px-4 py-1.5 rounded-lg bg-red-600/80 text-white text-xs font-semibold hover:bg-red-500 transition-colors">
                                Retry
                            </button>
                            <button onClick={handleBack} className="px-4 py-1.5 rounded-lg bg-white/10 text-white/70 text-xs hover:bg-white/20 transition-colors">
                                Go Back
                            </button>
                        </div>
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
