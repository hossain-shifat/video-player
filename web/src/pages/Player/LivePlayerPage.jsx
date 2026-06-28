import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useLocation } from "react-router";
import { Tv, AlertCircle, Loader } from "lucide-react";
import Hls from "hls.js";

import { PlayerProvider, usePlayerState } from "./UsePlayerState";
import PlayerOverlays, { useOverlay, BufferingOverlay } from "./PlayerOverlays";
import PlayerGestures from "./PlayerGestures";
import PlayerLock from "./PlayerLock";
import PlayerControls from "./PlayerControls";
import { useIsMobile } from "./useIsMobile";

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

// ── extractNameMeta ─────────────────────────────────────────────────────────
// Ported from backend normalizeChannel utility.
// Strips noise tokens (HD, SD, 4K, codec tags, bracket junk) from IPTV channel
// names and returns a clean display name + resolution metadata.

const RES_TOKENS = /(4k|uhd|2160p?|fhd|1080[ip]?|hd|720p?|sd|480[ip]?|576[ip]?)/gi;
const CODEC_TOKENS = /(h\.?264|h\.?265|hevc|avc|av1|vp9|aac|mp3|ac3|opus)/gi;
const BRACKET_NOISE = /[\[(][^\])]*(hd|sd|4k|uhd|fhd|hevc|h\.?26[45]|avc)[^\])]*[\])]/gi;

function extractNameMeta(rawName = "") {
    if (!rawName) return { cleanName: "", resolution: null, isHD: false };

    // Strip bracket/paren groups that are pure noise (resolution/codec only)
    let name = rawName.replace(BRACKET_NOISE, "").trim();

    // Collect resolution tokens before removing them
    const resMatches = [];
    name = name.replace(RES_TOKENS, (m) => {
        resMatches.push(m.toLowerCase());
        return "";
    });
    name = name.replace(CODEC_TOKENS, "").trim();

    // Clean up leftover punctuation / double spaces
    name = name
        .replace(/[-|:,_]+$/g, "") // trailing separators
        .replace(/^[-|:,_]+/g, "") // leading separators
        .replace(/\s{2,}/g, " ")
        .trim();

    // Derive canonical resolution label from collected tokens
    let resolution = null;
    let isHD = false;
    for (const t of resMatches) {
        if (t === "4k" || t === "uhd" || t.startsWith("2160")) {
            resolution = "4K";
            isHD = true;
            break;
        }
        if (t === "fhd" || t.startsWith("1080")) {
            resolution = "1080p";
            isHD = true;
            break;
        }
        if (t === "hd" || t.startsWith("720")) {
            resolution = "HD";
            isHD = true;
            break;
        }
        if (t === "sd" || t.startsWith("480") || t.startsWith("576")) {
            resolution = "SD";
            break;
        }
    }

    return { cleanName: name || rawName, resolution, isHD };
}

// ── Live seek strip (used by PlayerControls SeekBar passthrough) ─────────────
// PlayerControls renders its own SeekBar internally — no separate strip needed.

// ── Main inner component ──────────────────────────────────────────────────────

function LivePlayerInner({ stateStreamUrl, stateChannelName, stateChannelLogo }) {
    const navigate = useNavigate();
    const videoRef = useRef(null);
    const containerRef = useRef(null);
    const isMobile = useIsMobile();

    const { state, actions } = usePlayerState();
    const [channel, setChannel] = useState(null);
    const [loading, setLoading] = useState(true);
    const [videoError, setVideoError] = useState(false);
    const hlsRef = useRef(null);
    const [subtitles, setSubtitles] = useState([]);

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
                        hls.levels
                            .map((l, i) => ({
                                index: i,
                                height: l.height,
                                width: l.width,
                                bitrate: l.bitrate,
                                label: (() => {
                                    if (l.height > 0) return `${l.height}p`;
                                    const { resolution: nameRes } = extractNameMeta(channel?.name || "");
                                    if (nameRes) return nameRes;
                                    if (l.bitrate > 0) {
                                        const kbps = Math.round(l.bitrate / 1000);
                                        return kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbps` : `${kbps} kbps`;
                                    }
                                    return "Live";
                                })(),
                            }))
                            // Low → High: ascending bitrate order for display
                            .sort((a, b) => (a.bitrate || 0) - (b.bitrate || 0)),
                    );
                    actions.setActiveQuality(-1);
                }
                // Extract embedded HLS subtitle tracks (EXT-X-MEDIA TYPE=SUBTITLES)
                if (hls.subtitleTracks?.length > 0) {
                    const hlsSubs = hls.subtitleTracks.map((t, i) => ({
                        index: i,
                        lang: t.lang || t.language || "und",
                        label: t.name || t.lang || `Track ${i + 1}`,
                        url: null, // HLS-native track; switching via hls.subtitleTrack
                        source: "hls",
                        codec: "webvtt",
                    }));
                    setSubtitles(hlsSubs);
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
    }, [channel]);

    // Sync active subtitle → HLS engine for HLS-native subtitle tracks
    useEffect(() => {
        if (!hlsRef.current) return;
        if (!state.activeSubtitle) {
            hlsRef.current.subtitleTrack = -1; // off
            return;
        }
        if (state.activeSubtitle.source === "hls" && state.activeSubtitle.index != null) {
            hlsRef.current.subtitleTrack = state.activeSubtitle.index;
        }
    }, [state.activeSubtitle]);

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

    // Sync mute state → video element.
    // PlayerControls calls actions.setMuted() (state only) — must mirror to DOM.
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        video.muted = state.muted;
    }, [state.muted]);

    // Sync volume → video element.
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        video.volume = state.volume;
    }, [state.volume]);

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
        title: (() => {
            const m = extractNameMeta(channel?.cleanName || channel?.name || "");
            return m.cleanName || channel?.name || "Live";
        })(),
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
                    {(() => {
                        const meta = extractNameMeta(channel.cleanName || channel.name);
                        return (
                            <>
                                <span className="text-white text-sm font-semibold truncate">{meta.cleanName}</span>
                                {meta.resolution && (
                                    <span
                                        style={{
                                            flexShrink: 0,
                                            fontSize: 9,
                                            fontWeight: 800,
                                            letterSpacing: "0.08em",
                                            padding: "1px 5px",
                                            borderRadius: 4,
                                            background: meta.resolution === "4K" ? "rgba(255,200,50,0.2)" : meta.isHD ? "rgba(229,62,62,0.2)" : "rgba(255,255,255,0.12)",
                                            color: meta.resolution === "4K" ? "#ffc832" : meta.isHD ? "#e53e3e" : "rgba(255,255,255,0.6)",
                                            border: `1px solid ${meta.resolution === "4K" ? "rgba(255,200,50,0.4)" : meta.isHD ? "rgba(229,62,62,0.35)" : "rgba(255,255,255,0.2)"}`,
                                        }}>
                                        {meta.resolution}
                                    </span>
                                )}
                            </>
                        );
                    })()}
                </div>
            </div>

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
                    subtitles={subtitles}
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
            <LivePlayerInner stateStreamUrl={location.state?.streamUrl} stateChannelName={location.state?.channelName} stateChannelLogo={location.state?.channelLogo} />
        </PlayerProvider>
    );
}
