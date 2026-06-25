import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useLocation } from "react-router";
import { Tv, AlertCircle, Loader, List, RefreshCw } from "lucide-react";
import Hls from "hls.js";

import { PlayerProvider, usePlayerState } from "./UsePlayerState";
import PlayerOverlays, { useOverlay, BufferingOverlay } from "./PlayerOverlays";
import PlayerGestures from "./PlayerGestures";
import PlayerLock from "./PlayerLock";
import PlayerControls from "./PlayerControls";
import { useIsMobile } from "./useIsMobile";
import VideoSidebar, { SidebarItem } from "./VideoSidebar";

// ── Landscape lock ────────────────────────────────────────────────────────────
function useLandscapeLock(enabled, containerRef) {
    useEffect(() => {
        if (!enabled || !containerRef?.current) return;
        let didLock = false;
        let didFullscreen = false;
        const lock = async () => {
            try {
                if (!document.fullscreenElement && containerRef.current.requestFullscreen) {
                    await containerRef.current.requestFullscreen();
                    didFullscreen = true;
                }
                if (screen?.orientation?.lock) {
                    await screen.orientation.lock("landscape");
                    didLock = true;
                }
            } catch (_) {}
        };
        lock();
        return () => {
            if (didLock && screen?.orientation?.unlock) screen.orientation.unlock();
            if (didFullscreen && document.fullscreenElement) document.exitFullscreen().catch(() => {});
        };
    }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}

// ── Live seek strip (used by PlayerControls SeekBar passthrough) ─────────────
// PlayerControls renders its own SeekBar internally — no separate strip needed.

// ── Main inner component ──────────────────────────────────────────────────────

function LivePlayerInner({ stateStreamUrl, stateChannelName, stateChannelLogo, stateCategory, stateChannels }) {
    const navigate = useNavigate();
    const videoRef = useRef(null);
    const containerRef = useRef(null);
    const isMobile = useIsMobile();

    const { state, actions } = usePlayerState();
    const [channel, setChannel] = useState(null);
    const [loading, setLoading] = useState(true);
    const [videoError, setVideoError] = useState(false);
    const hlsRef = useRef(null);
    const [refreshKey, setRefreshKey] = useState(0);

    const refreshStream = useCallback(() => {
        // Destroy current HLS instance and re-init by bumping refreshKey.
        // channel dep in HLS effect won't re-fire for same channel obj,
        // so we force it via a separate key dep added to the effect below.
        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }
        actions.setPlaying(false);
        actions.setBuffering(true);
        setRefreshKey((k) => k + 1);
    }, [actions]);

    // ── Channel list sidebar ─────────────────────────────────────────────────
    const [channelListOpen, setChannelListOpen] = useState(false);
    const categoryName = stateCategory || "Channels";
    const channelList = stateChannels || [];

    const switchChannel = useCallback((ch) => {
        setChannelListOpen(false);
        setChannel(ch);
    }, []);

    // ── Landscape lock — fires once channel is ready on mobile
    useLandscapeLock(isMobile && !!channel, containerRef);

    // ── Pinch-zoom ──────────────────────────────────────────────────────────
    const [zoomState, setZoomState] = useState({ scale: 1, panX: 0, panY: 0 });
    const handleZoomChange = useCallback((z) => setZoomState(z), []);
    useEffect(() => {
        setZoomState({ scale: 1, panX: 0, panY: 0 });
    }, [channel?.url]);

    // ── Overlay system ───────────────────────────────────────────────────────
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

    useEffect(() => {
        setOverlayState((s) => ({ ...s, brightness: state.brightness }));
    }, [state.brightness]);
    useEffect(() => {
        setOverlayState((s) => ({ ...s, volume: state.volume, muted: state.muted }));
    }, [state.volume, state.muted]);

    // ── Controls visibility (maps to controlsPhase for PlayerControls) ────────
    // PlayerControls expects "VISIBLE"|"HIDDEN"|"ANIMATING_IN"|"ANIMATING_OUT".
    // LivePlayer uses a simple show/hide — map to the two stable states only.
    const hideTimer = useRef(null);
    const HIDE_DELAY = 5000;

    const showControls = useCallback(() => {
        actions.setControlsVisible(true);
        clearTimeout(hideTimer.current);
        hideTimer.current = setTimeout(() => actions.setControlsVisible(false), HIDE_DELAY);
    }, [actions]);

    const toggleControls = useCallback(() => {
        if (state.controlsVisible) {
            clearTimeout(hideTimer.current);
            actions.setControlsVisible(false);
        } else {
            showControls();
        }
    }, [state.controlsVisible, actions, showControls]);

    const controlsPhase = state.controlsVisible ? "VISIBLE" : "HIDDEN";

    // ── Portrait override (for PlayerControls rotation button) ───────────────
    const [isPortraitOverride, setIsPortraitOverride] = useState(false);
    const toggleManualRotation = useCallback(() => {
        if (!screen.orientation?.lock) return;
        if (isPortraitOverride) {
            screen.orientation.lock("landscape").catch(() => {});
            setIsPortraitOverride(false);
        } else {
            screen.orientation.lock("portrait").catch(() => {});
            setIsPortraitOverride(true);
        }
    }, [isPortraitOverride]);

    // Attach _toggleRotation, _toggleFullscreen, _togglePiP to containerRef
    // so PlayerControls can call them without prop drilling (same pattern as PlayerPage)
    useEffect(() => {
        const c = containerRef.current;
        if (!c) return;
        c._toggleRotation = toggleManualRotation;
        return () => {
            delete c._toggleRotation;
        };
    }, [toggleManualRotation]);

    useEffect(() => {
        const c = containerRef.current;
        if (!c) return;
        c._toggleFullscreen = () => {
            if (!document.fullscreenElement) {
                c.requestFullscreen().catch(() => {});
            } else {
                document.exitFullscreen().catch(() => {});
            }
        };
        c._togglePiP = async () => {
            if (!videoRef.current) return;
            try {
                if (document.pictureInPictureElement) {
                    await document.exitPictureInPicture();
                    actions.setPiP(false);
                } else {
                    await videoRef.current.requestPictureInPicture();
                    actions.setPiP(true);
                }
            } catch (_) {}
        };
        return () => {
            delete c._toggleFullscreen;
            delete c._togglePiP;
        };
    }, [actions]);

    // ── Channel from route state ─────────────────────────────────────────────
    useEffect(() => {
        if (stateStreamUrl) {
            setChannel({ name: stateChannelName || "Live Channel", url: stateStreamUrl, logo: stateChannelLogo || null });
        } else {
            setChannel({ name: "Live Feed", url: "https://owrcovcrpy.gpcdn.net/bpk-tv/1709/output/index.m3u8", logo: null });
        }
        setLoading(false);
    }, [stateStreamUrl, stateChannelName, stateChannelLogo]);

    // Auto-show controls on mount
    useEffect(() => {
        showControls();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Live-specific quick-icon order ────────────────────────────────────────
    // Remove VOD-only items (loop, shuffle, abRepeat, bgPlay) from quick row.
    useEffect(() => {
        actions.setQuickIconOrder(["speed", "rotation", "nightMode", "eq", "sleepTimer"]);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Sync quality level → HLS engine
    useEffect(() => {
        if (!hlsRef.current) return;
        hlsRef.current.currentLevel = state.activeQuality; // -1 = auto
    }, [state.activeQuality]);

    // ── HLS engine ───────────────────────────────────────────────────────────
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !channel?.url) return;

        setVideoError(false);
        actions.setReady(false);
        let hls;

        const onTimeUpdate = () => actions.setCurrentTime(video.currentTime);
        const onDuration = () => {
            if (isFinite(video.duration)) actions.setDuration(video.duration);
        };
        const onWaiting = () => actions.setBuffering(true);
        const onPlaying = () => {
            actions.setBuffering(false);
            actions.setPlaying(true);
        };
        const onPause = () => actions.setPlaying(false);
        const onProgress = () => actions.setBuffered(video.buffered);
        const onVolumeChange = () => {
            actions.setVolume(video.volume);
            actions.setMuted(video.muted);
        };

        video.addEventListener("timeupdate", onTimeUpdate);
        video.addEventListener("durationchange", onDuration);
        video.addEventListener("waiting", onWaiting);
        video.addEventListener("playing", onPlaying);
        video.addEventListener("pause", onPause);
        video.addEventListener("progress", onProgress);
        video.addEventListener("volumechange", onVolumeChange);

        if (Hls.isSupported()) {
            hls = new Hls({ maxMaxBufferLength: 8, enableWorker: true, lowLatencyMode: true });
            hlsRef.current = hls;
            hls.loadSource(channel.url);
            hls.attachMedia(video);

            hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
                actions.setReady(true);
                actions.setBuffering(false);
                if (hls.levels?.length > 0) {
                    actions.setQualityLevels(
                        hls.levels.map((l, i) => ({
                            index: i,
                            height: l.height,
                            width: l.width,
                            bitrate: l.bitrate,
                            label: l.height ? `${l.height}p` : `Profile ${i + 1}`,
                        })),
                    );
                    actions.setActiveQuality(-1);
                }
                video
                    .play()
                    .then(() => actions.setPlaying(true))
                    .catch(() => actions.setPlaying(false));
            });

            hls.on(Hls.Events.LEVEL_SWITCHED, () => {
                if (hls.autoLevelEnabled) actions.setActiveQuality(-1);
            });

            hls.on(Hls.Events.ERROR, (_, d) => {
                if (d.fatal) setVideoError(true);
            });
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
            video.src = channel.url;
            video.addEventListener("loadedmetadata", () => {
                actions.setReady(true);
                video
                    .play()
                    .then(() => actions.setPlaying(true))
                    .catch(() => actions.setPlaying(false));
            });
            video.addEventListener("error", () => setVideoError(true));
        }

        return () => {
            video.removeEventListener("timeupdate", onTimeUpdate);
            video.removeEventListener("durationchange", onDuration);
            video.removeEventListener("waiting", onWaiting);
            video.removeEventListener("playing", onPlaying);
            video.removeEventListener("pause", onPause);
            video.removeEventListener("progress", onProgress);
            video.removeEventListener("volumechange", onVolumeChange);
            if (hls) hls.destroy();
            hlsRef.current = null;
            actions.setPlaying(false);
            actions.setReady(false);
            actions.setQualityLevels([]);
            actions.setCurrentTime(0);
            actions.setDuration(0);
        };
    }, [channel, refreshKey]); // refreshKey forces re-init on manual refresh

    // Sync playback speed to video element
    useEffect(() => {
        if (videoRef.current) videoRef.current.playbackRate = state.playbackSpeed;
    }, [state.playbackSpeed]);

    // Sync quality level → HLS engine
    // PlayerControls.QualityPicker writes to state via actions.setActiveQuality.
    // Mirror into hlsRef.currentLevel so the stream actually switches.
    useEffect(() => {
        if (!hlsRef.current) return;
        hlsRef.current.currentLevel = state.activeQuality; // -1 = auto
    }, [state.activeQuality]);

    // Fullscreen change sync
    useEffect(() => {
        const onFsChange = () => actions.setFullscreen(!!document.fullscreenElement);
        document.addEventListener("fullscreenchange", onFsChange);
        return () => document.removeEventListener("fullscreenchange", onFsChange);
    }, [actions]);

    // ── Play/pause state → video element sync ────────────────────────────────
    // PlayerControls calls actions.setPlaying() (state only). Without VideoCore
    // there is nothing to propagate that to the actual <video> element.
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        if (state.playing) {
            video.play().catch(() => {});
        } else {
            video.pause();
        }
    }, [state.playing]);

    const handleBack = () => {
        if (window.history.length > 1) navigate(-1);
        else navigate("/live");
    };

    const getAspectStyle = () => {
        if (state.aspectRatio === "fill") return "object-cover w-full h-full";
        if (state.aspectRatio === "16:9") return "aspect-video w-full max-h-full object-contain";
        if (state.aspectRatio === "stretch") return "w-full h-full object-fill";
        return "w-full h-full object-contain";
    };

    // mediaInfo — minimal shape PlayerControls needs for top bar title
    const mediaInfo = {
        title: channel?.name || "Live",
        type: "live",
        season: null,
        episode: null,
        episodeTitle: null,
        poster: channel?.logo || null,
        year: null,
    };

    // ── Loading / Error screens ───────────────────────────────────────────────
    if (loading) {
        return (
            <div className="fixed inset-0 bg-black flex items-center justify-center">
                <div className="flex flex-col items-center gap-3 text-white/60">
                    <Loader size={32} className="animate-spin" />
                    <span className="text-sm">Loading stream…</span>
                </div>
            </div>
        );
    }

    if (videoError || !channel) {
        return (
            <div className="fixed inset-0 bg-black flex items-center justify-center">
                <div className="flex flex-col items-center gap-4 text-center px-6 max-w-sm">
                    <AlertCircle size={40} className="text-error" />
                    <p className="text-white font-semibold">Stream Unreachable</p>
                    <p className="text-white/50 text-sm">Channel offline or unsupported by this engine.</p>
                    <button onClick={handleBack} className="mt-2 px-5 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm transition-colors">
                        Go Back
                    </button>
                </div>
            </div>
        );
    }

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div
            ref={containerRef}
            className="fixed inset-0 bg-black flex flex-col select-none overflow-hidden touch-none z-50 justify-center items-center"
            style={{ filter: `brightness(${state.brightness})` }}
            onMouseMove={showControls}>
            <style>{`@keyframes livePulse { 0%,100%{opacity:1}50%{opacity:0.3} }`}</style>

            {/* Video */}
            <video
                ref={videoRef}
                className={getAspectStyle()}
                playsInline
                style={{
                    transform:
                        zoomState.scale !== 1 || zoomState.panX !== 0 || zoomState.panY !== 0
                            ? `scale(${zoomState.scale}) translate(${zoomState.panX / zoomState.scale}px, ${zoomState.panY / zoomState.scale}px)`
                            : undefined,
                    transformOrigin: "center center",
                    transition: "transform 0.05s linear",
                }}
            />

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
            <BufferingOverlay visible={state.isBuffering} />
            <PlayerLock />

            {/* ── LIVE badge — always visible, top-right ── */}
            <div className="absolute top-3 right-4 z-29 pointer-events-none">
                <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-error text-white">LIVE</span>
            </div>

            {/* ── Top bar (channel name + channel list btn) — fades with controls ── */}
            <div
                className="absolute top-0 left-0 right-0 z-30 flex items-center gap-3 px-4 py-3 bg-linear-to-b from-black/90 via-black/40 to-transparent transition-opacity duration-300"
                style={{ opacity: state.controlsVisible ? 1 : 0, pointerEvents: state.controlsVisible ? "auto" : "none" }}>
                <div className="flex items-center gap-2 min-w-0 flex-1">
                    {channel.logo ? (
                        <img
                            src={channel.logo}
                            alt={channel.name}
                            className="w-7 h-7 rounded object-contain bg-white/10 p-0.5 shrink-0"
                            onError={(e) => {
                                e.currentTarget.style.display = "none";
                            }}
                        />
                    ) : (
                        <Tv size={18} stroke="rgba(255,255,255,0.6)" />
                    )}
                    <span className="text-white text-sm font-semibold truncate">{channel.name}</span>
                </div>
            </div>

            {/* ── Channel list sidebar ── */}
            <VideoSidebar open={channelListOpen} onClose={() => setChannelListOpen(false)} title={categoryName}>
                {channelList.map((ch, i) => (
                    <SidebarItem key={ch.url || i} active={ch.url === channel?.url} onClick={() => switchChannel(ch)} icon={Tv}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            {ch.logo && (
                                <img
                                    src={ch.logo}
                                    alt={ch.name}
                                    style={{ width: 22, height: 22, borderRadius: 4, objectFit: "contain", background: "rgba(255,255,255,0.08)", flexShrink: 0 }}
                                    onError={(e) => {
                                        e.currentTarget.style.display = "none";
                                    }}
                                />
                            )}
                            <span>{ch.name}</span>
                        </div>
                    </SidebarItem>
                ))}
            </VideoSidebar>

            {/* ── Channel list button — bottom-right, before quality icon ── */}
            {/* Absolutely positioned to align with PlayerControls bottom bar.
                Injected into the CSS scoped layer so it fades with controls.
                Placed before the quality/fullscreen cluster via right offset
                that matches PlayerControls right-cluster button widths. */}
            {channelList.length > 0 && state.controlsVisible && (
                <div
                    data-gesture-exclude="true"
                    style={{
                        position: "absolute",
                        bottom: "calc(max(0.75rem, env(safe-area-inset-bottom)) + 6px)",
                        right: isMobile ? 172 : 148,
                        zIndex: 35,
                        pointerEvents: "auto",
                    }}>
                    <button onClick={() => setChannelListOpen(true)} className="flux-icon-btn" style={{ padding: isMobile ? "10px 10px" : "6px 8px" }} aria-label="Channel list" title={categoryName}>
                        <List size={isMobile ? 20 : 16} stroke="#fff" />
                    </button>
                </div>
            )}

            {/* ── Refresh button — bottom-left, always in controls bar ── */}
            {state.controlsVisible && (
                <div
                    data-gesture-exclude="true"
                    style={{
                        position: "absolute",
                        bottom: "calc(max(0.75rem, env(safe-area-inset-bottom)) + 6px)",
                        left: isMobile ? 160 : 140,
                        zIndex: 35,
                        pointerEvents: "auto",
                    }}>
                    <button onClick={refreshStream} className="flux-icon-btn" style={{ padding: isMobile ? "10px 10px" : "6px 8px" }} aria-label="Refresh stream" title="Refresh stream">
                        <RefreshCw size={isMobile ? 20 : 16} stroke="#fff" />
                    </button>
                </div>
            )}

            {/* ── PlayerControls — VOD-only buttons hidden via CSS scope ── */}
            <style>{`
                [data-live-player] [aria-label="Back 10 seconds"],
                [data-live-player] [aria-label="Forward 10 seconds"],
                [data-live-player] [aria-label="Back 30s"],
                [data-live-player] [aria-label="Forward 30s"],
                [data-live-player] [aria-label="Loop"],
                [data-live-player] .flux-seek-thumb,
                [data-live-player] .flux-seek-tooltip { display: none !important; }
            `}</style>
            <div data-live-player style={{ position: "absolute", inset: 0, zIndex: 30, pointerEvents: "none" }}>
                <PlayerControls
                    mediaInfo={mediaInfo}
                    videoRef={videoRef}
                    containerRef={containerRef}
                    subtitles={[]}
                    onBack={handleBack}
                    onShowControls={showControls}
                    controlsPhase={controlsPhase}
                    isPortraitOverride={isPortraitOverride}
                />
            </div>
        </div>
    );
}

// ── Export ────────────────────────────────────────────────────────────────────

export default function LivePlayerPage() {
    const location = useLocation();
    return (
        <PlayerProvider>
            <LivePlayerInner
                stateStreamUrl={location.state?.streamUrl}
                stateChannelName={location.state?.channelName}
                stateChannelLogo={location.state?.channelLogo}
                stateCategory={location.state?.categoryName}
                stateChannels={location.state?.channels}
            />
        </PlayerProvider>
    );
}
