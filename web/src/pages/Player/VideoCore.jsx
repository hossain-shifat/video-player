import { useEffect, useRef, forwardRef, useImperativeHandle, useCallback } from "react";
import { usePlayerState } from "./UsePlayerState";

// ─── Language code → display name ────────────────────────────────────────────

const LANG_MAP = {
    eng: "English",
    en: "English",
    hin: "Hindi",
    hi: "Hindi",
    ben: "Bangla",
    bn: "Bangla",
    jpn: "Japanese",
    ja: "Japanese",
    fra: "French",
    fr: "French",
    spa: "Spanish",
    es: "Spanish",
    ara: "Arabic",
    ar: "Arabic",
    deu: "German",
    de: "German",
    kor: "Korean",
    ko: "Korean",
    zho: "Chinese",
    zh: "Chinese",
    rus: "Russian",
    ru: "Russian",
    ita: "Italian",
    it: "Italian",
    por: "Portuguese",
    pt: "Portuguese",
    tur: "Turkish",
    tr: "Turkish",
    urd: "Urdu",
    ur: "Urdu",
};

function resolveLanguageName(track) {
    const lang = (track.lang || track.language || "").toLowerCase();
    if (LANG_MAP[lang]) return LANG_MAP[lang];
    return track.name || lang.toUpperCase() || "Unknown";
}

// ─── Aspect ratio CSS ─────────────────────────────────────────────────────────

function getAspectStyle(aspectRatio) {
    switch (aspectRatio) {
        case "fill":
            return { objectFit: "cover", width: "100%", height: "100%" };
        case "16:9":
            return { objectFit: "contain", width: "100%", aspectRatio: "16/9" };
        case "4:3":
            return { objectFit: "contain", width: "100%", aspectRatio: "4/3" };
        case "1:1":
            return { objectFit: "contain", width: "100%", aspectRatio: "1/1" };
        case "stretch":
            return { objectFit: "fill", width: "100%", height: "100%" };
        default:
            return { objectFit: "contain", width: "100%", height: "100%" };
    }
}

// ─── Stall detector ───────────────────────────────────────────────────────────
// Jellyfin pattern: if timeupdate stops firing while playing=true for >4s, we're stalled.
// Recovery: restart HLS from current position.

const STALL_THRESHOLD_MS = 4_000;

// ─── HLS.js config (tuned for VOD streaming) ─────────────────────────────────
// Based on Jellyfin's HLS.js configuration strategy:
//   - Progressive loading (not live/low-latency)
//   - Aggressive buffer filling (smooth playback > low memory)
//   - Conservative retry (prevent server flood on error)
//   - startPosition: skip to correct segment immediately

function buildHLSConfig(startTimeSec = 0) {
    return {
        // Worker for non-blocking media parsing
        enableWorker: true,
        workerPath: null, // auto-detect

        // VOD (not live streaming)
        lowLatencyMode: false,

        // Buffer config (Jellyfin uses similar values):
        //   maxBufferLength: target buffer ahead of playhead (seconds)
        //   maxMaxBufferLength: hard cap (seconds) — prevents OOM on fast connections
        //   backBufferLength: how many seconds to keep behind playhead for seek-back
        maxBufferLength: 30,
        maxMaxBufferLength: 120,
        backBufferLength: 60,

        // How much to buffer before unblocking playback start
        maxBufferHole: 0.5,

        // Start position (Jellyfin passes startTimeTicks; we use seconds)
        // HLS.js uses this to seek immediately after manifest parse
        startPosition: startTimeSec > 0 ? startTimeSec : -1,

        // Retry policy — CRITICAL: without this, a single 404 retries infinitely
        // (the default) which causes server overload and infinite buffering UI
        manifestLoadingMaxRetry: 2,
        manifestLoadingRetryDelay: 1_000,
        manifestLoadingMaxRetryTimeout: 8_000,

        fragLoadingMaxRetry: 3,
        fragLoadingRetryDelay: 1_000,
        fragLoadingMaxRetryTimeout: 16_000,

        levelLoadingMaxRetry: 2,
        levelLoadingRetryDelay: 1_000,

        // Stall handling — auto-recovery from video element stalls
        enableSoftwareAES: true,
        nudgeMaxRetry: 3,
        nudgeOffset: 0.2, // advance playhead by 0.2s to unstick

        // Append error recovery
        appendErrorMaxRetry: 3,

        // ABR (Adaptive Bitrate) — we're using server-side quality selection,
        // but HLS.js ABR is used for manifest quality levels
        abrEwmaDefaultEstimate: 5_000_000, // 5 Mbps starting estimate
        abrBandWidthFactor: 0.9,
        abrBandWidthUpFactor: 0.7,

        // Network timeout
        fragLoadingTimeOut: 30_000,
        manifestLoadingTimeOut: 20_000,
    };
}

/**
 * VideoCore
 *
 * Improvements over v3:
 *  1. HLS.js config: startPosition, retry limits, stall nudge
 *  2. Stall detector: if no timeupdate for 4s while playing → force reload
 *  3. X-New-Session-Id header tracking: when server restarts seek, update sessionId
 *  4. Error recovery: finite retry with exponential backoff, no infinite loop
 *  5. Direct play: seek to 0 only after loadedmetadata (not before)
 *  6. HLS destroy order: null ref THEN destroy (prevents use-after-free)
 *  7. cleanup() exposed via ref so PlayerPage can trigger on unmount
 */
const VideoCore = forwardRef(function VideoCore({ streamUrl, startTimeSec = 0, onVideoClick, onNewSessionId }, ref) {
    const videoRef = useRef(null);
    const hlsRef = useRef(null);
    const stallTimerRef = useRef(null);
    const networkRetryCountRef = useRef(0);
    const lastTimeRef = useRef(0);
    const { state, actions } = usePlayerState();

    // Expose video element to parent
    useImperativeHandle(ref, () => videoRef.current, []);

    // ── Stall detection ───────────────────────────────────────────────────────
    // Tracks last known currentTime. If it hasn't changed in STALL_THRESHOLD_MS
    // while playing=true and not buffering → we're stalled (frozen frame).
    const resetStallTimer = useCallback(() => {
        clearTimeout(stallTimerRef.current);
    }, []);

    const startStallTimer = useCallback(() => {
        clearTimeout(stallTimerRef.current);
        stallTimerRef.current = setTimeout(() => {
            const video = videoRef.current;
            const hls = hlsRef.current;
            if (!video || !hls) return;
            if (video.paused || video.ended) return;
            // Check if truly stalled (currentTime hasn't advanced)
            if (video.currentTime === lastTimeRef.current) {
                console.warn("[VideoCore] Stall detected — recovering at", video.currentTime.toFixed(1));
                actions.setBuffering(true);
                // Jellyfin recovery: restart load from current position
                hls.startLoad(video.currentTime);
            }
        }, STALL_THRESHOLD_MS);
    }, [actions]);

    // ── HLS.js initialization ─────────────────────────────────────────────────
    useEffect(() => {
        if (!streamUrl || !videoRef.current) return;
        const video = videoRef.current;

        const isHLS = streamUrl.includes(".m3u8");

        if (isHLS) {
            import("hls.js").then(({ default: Hls }) => {
                if (!videoRef.current) return; // unmounted during import

                if (!Hls.isSupported()) {
                    // Safari native HLS — set src directly
                    video.src = streamUrl;
                    if (startTimeSec > 0) {
                        video.addEventListener(
                            "loadedmetadata",
                            () => {
                                video.currentTime = startTimeSec;
                            },
                            { once: true },
                        );
                    }
                    return;
                }

                // Destroy old instance first (null ref BEFORE destroy to prevent use-after-free)
                const old = hlsRef.current;
                hlsRef.current = null;
                if (old) old.destroy();

                networkRetryCountRef.current = 0;

                const hls = new Hls(buildHLSConfig(startTimeSec));
                hlsRef.current = hls;

                // Track X-New-Session-Id from segment responses
                // Server sends this when it restarted a session due to seek gap
                hls.config.xhrSetup = (xhr, url) => {
                    // Add client tracking header
                    xhr.setRequestHeader("X-Flux-Client", "web");
                    // Monitor response headers for session ID changes
                    const origOpen = xhr.open.bind(xhr);
                    xhr.addEventListener("load", () => {
                        const newSid = xhr.getResponseHeader("X-New-Session-Id");
                        if (newSid && onNewSessionId) {
                            console.log("[VideoCore] Server restarted session:", newSid);
                            onNewSessionId(newSid);
                        }
                    });
                };

                hls.loadSource(streamUrl);
                hls.attachMedia(video);

                hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
                    // Duration — HLS.js provides totalduration from manifest
                    const levelDetails = hls.levels?.[0]?.details;
                    const hlsDuration = levelDetails?.totalduration || 0;
                    if (hlsDuration > 0 && (!isFinite(video.duration) || video.duration === 0)) {
                        actions.setDuration(hlsDuration);
                    }

                    // Quality levels
                    const levels = hls.levels.map((l, i) => ({
                        index: i,
                        height: l.height,
                        width: l.width,
                        bitrate: l.bitrate,
                        label: l.height ? `${l.height}p` : `Level ${i}`,
                    }));
                    actions.setQualityLevels(levels);
                    actions.setActiveQuality(-1); // start on auto

                    // Audio tracks
                    const tracks = (hls.audioTracks || []).map((t, i) => ({
                        index: i,
                        id: t.id,
                        name: resolveLanguageName(t),
                        lang: t.lang || t.language || "",
                        default: t.default || false,
                    }));
                    actions.setAudioTracks(tracks);
                    const defaultAudioIdx = tracks.findIndex((t) => t.default);
                    actions.setActiveAudioTrack(defaultAudioIdx >= 0 ? defaultAudioIdx : 0);

                    actions.setReady(true);
                    actions.setBuffering(false);
                    video.play().catch(() => {});
                });

                hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
                    actions.setActiveQuality(hls.autoLevelEnabled ? -1 : data.level);
                });

                hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_, data) => {
                    actions.setActiveAudioTrack(data.id);
                });

                hls.on(Hls.Events.FRAG_LOADED, () => {
                    // Fragment loaded successfully — reset network retry counter
                    networkRetryCountRef.current = 0;
                    actions.setBuffering(false);
                });

                hls.on(Hls.Events.FRAG_BUFFERED, () => {
                    actions.setBuffering(false);
                    actions.setError(null);
                });

                // ── Error handling (Jellyfin pattern) ─────────────────────────
                // Key insight: only act on FATAL errors.
                // Non-fatal: HLS.js recovers automatically.
                // Fatal HTTP 404/429: don't retry (session expired / rate limited).
                // Fatal NETWORK: retry once from current position.
                // Fatal MEDIA: attempt recoverMediaError once, then give up.

                hls.on(Hls.Events.ERROR, (_, data) => {
                    if (!data.fatal) return; // non-fatal: HLS.js handles it

                    const status = data.response?.code;
                    console.error("[VideoCore] Fatal HLS error:", data.type, data.details, "HTTP:", status);

                    // HTTP 404 → session expired, no point retrying same URL
                    if (status === 404) {
                        const hls2 = hlsRef.current;
                        hlsRef.current = null;
                        hls2?.destroy();
                        actions.setError("Stream session expired. Go back and try again.");
                        return;
                    }

                    // HTTP 429 → server overloaded
                    if (status === 429) {
                        const hls2 = hlsRef.current;
                        hlsRef.current = null;
                        hls2?.destroy();
                        actions.setError("Too many streams. Please wait a moment.");
                        return;
                    }

                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            // Max 3 network retries (prevents infinite loop)
                            networkRetryCountRef.current++;
                            if (networkRetryCountRef.current <= 3) {
                                console.warn("[VideoCore] Network error, retry", networkRetryCountRef.current);
                                actions.setBuffering(true);
                                actions.setError(null);
                                setTimeout(() => {
                                    if (hlsRef.current) {
                                        hlsRef.current.startLoad(video.currentTime);
                                    }
                                }, networkRetryCountRef.current * 1_500); // exponential backoff
                            } else {
                                const hls3 = hlsRef.current;
                                hlsRef.current = null;
                                hls3?.destroy();
                                actions.setError("Network error. Check connection and try again.");
                            }
                            break;

                        case Hls.ErrorTypes.MEDIA_ERROR:
                            // Try recoverMediaError once
                            if (networkRetryCountRef.current === 0) {
                                networkRetryCountRef.current = 1;
                                console.warn("[VideoCore] Media error, attempting recovery");
                                actions.setError(null);
                                hls.recoverMediaError();
                            } else {
                                const hls4 = hlsRef.current;
                                hlsRef.current = null;
                                hls4?.destroy();
                                actions.setError("Playback error. Please try again.");
                            }
                            break;

                        default:
                            const hls5 = hlsRef.current;
                            hlsRef.current = null;
                            hls5?.destroy();
                            actions.setError("Unable to play stream. Please try again.");
                            break;
                    }
                });
            });
        } else {
            // Direct play
            video.src = streamUrl;
            actions.setReady(false);
            actions.setBuffering(false);

            video.addEventListener(
                "loadedmetadata",
                () => {
                    // Seek AFTER metadata loaded (before canplay)
                    // startTimeSec is resume position passed from PlayerPage
                    if (startTimeSec > 0) {
                        video.currentTime = startTimeSec;
                    }
                },
                { once: true },
            );

            video.addEventListener(
                "canplay",
                () => {
                    actions.setError(null);
                    actions.setBuffering(false);
                    // Audio tracks for direct play (native HTMLVideoElement API)
                    if (video.audioTracks && video.audioTracks.length > 1) {
                        const tracks = Array.from(video.audioTracks).map((t, i) => ({
                            index: i,
                            id: t.id,
                            name: resolveLanguageName({ lang: t.language, name: t.label }),
                            lang: t.language || "",
                            default: t.enabled,
                        }));
                        actions.setAudioTracks(tracks);
                        const activeIdx = tracks.findIndex((t) => t.default);
                        actions.setActiveAudioTrack(activeIdx >= 0 ? activeIdx : 0);
                    }
                    actions.setReady(true);
                },
                { once: true },
            );
        }

        return () => {
            clearTimeout(stallTimerRef.current);
            const hls = hlsRef.current;
            hlsRef.current = null;
            if (hls) hls.destroy();
            video.src = "";
            video.load(); // release media resource
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [streamUrl, startTimeSec]);

    // ── Sync quality level to HLS ─────────────────────────────────────────────
    useEffect(() => {
        if (!hlsRef.current) return;
        hlsRef.current.currentLevel = state.activeQuality;
        hlsRef.current.autoLevelEnabled = state.activeQuality === -1;
    }, [state.activeQuality]);

    // ── Sync audio track to HLS ───────────────────────────────────────────────
    useEffect(() => {
        if (!hlsRef.current) return;
        hlsRef.current.audioTrack = state.activeAudioTrack;
    }, [state.activeAudioTrack]);

    // ── Sync playback speed ───────────────────────────────────────────────────
    useEffect(() => {
        if (videoRef.current) videoRef.current.playbackRate = state.playbackSpeed;
    }, [state.playbackSpeed]);

    // ── Sync play/pause ───────────────────────────────────────────────────────
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        if (state.playing) {
            video.play().catch(() => {});
        } else {
            video.pause();
        }
    }, [state.playing]);

    // ── Sync volume / mute ────────────────────────────────────────────────────
    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.volume = state.volume;
            videoRef.current.muted = state.muted;
        }
    }, [state.volume, state.muted]);

    // ── Native video event handlers ───────────────────────────────────────────

    const handleTimeUpdate = () => {
        const video = videoRef.current;
        if (!video) return;
        lastTimeRef.current = video.currentTime;
        actions.setCurrentTime(video.currentTime);
        actions.setBuffered(video.buffered);
        // Reset stall timer on every timeupdate (position is advancing)
        if (!video.paused && !video.ended) {
            startStallTimer();
        }
    };

    const handleDurationChange = () => {
        const video = videoRef.current;
        if (video && isFinite(video.duration) && video.duration > 0) {
            actions.setDuration(video.duration);
        }
    };

    const handlePlay = () => {
        actions.setError(null);
        actions.setPlaying(true);
        startStallTimer();
    };

    const handlePause = () => {
        actions.setPlaying(false);
        resetStallTimer();
    };

    const handleWaiting = () => {
        actions.setBuffering(true);
        // Don't start stall timer while we know we're buffering
        resetStallTimer();
    };

    const handleCanPlay = () => {
        actions.setBuffering(false);
        actions.setReady(true);
        actions.setError(null);
        if (!videoRef.current?.paused) startStallTimer();
    };

    const handleStalled = () => {
        // Native stalled event (different from our timer-based detection)
        actions.setBuffering(true);
        const hls = hlsRef.current;
        if (hls && videoRef.current) {
            // Try to restart from current position
            hls.startLoad(videoRef.current.currentTime);
        }
    };

    const handleEnded = () => {
        actions.setPlaying(false);
        resetStallTimer();
        if (state.loop === "one" && videoRef.current) {
            videoRef.current.currentTime = 0;
            videoRef.current.play().catch(() => {});
        }
    };

    const handleError = () => {
        const video = videoRef.current;
        if (!video?.error) return;

        // With HLS.js: video element fires spurious errors while segments load.
        // Only surface if HLS.js is not handling it (direct play or dead HLS).
        if (hlsRef.current) {
            if (video.readyState >= 2) return; // HAVE_CURRENT_DATA — recoverable
            if (video.currentTime > 0) return; // mid-stream, HLS.js handles
        }

        if (video.error.code === MediaError.MEDIA_ERR_ABORTED) return; // intentional

        actions.setError("Video playback error. Check the stream.");
    };

    const handleVolumeChange = () => {
        if (videoRef.current) {
            actions.setVolume(videoRef.current.volume);
            actions.setMuted(videoRef.current.muted);
        }
    };

    const handleProgress = () => {
        if (videoRef.current) {
            actions.setBuffered(videoRef.current.buffered);
        }
    };

    const handleSeeking = () => {
        actions.setBuffering(true);
        resetStallTimer();
    };

    const handleSeeked = () => {
        actions.setBuffering(false);
        if (!videoRef.current?.paused) startStallTimer();
    };

    const aspectStyle = getAspectStyle(state.aspectRatio);

    return (
        <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full"
            style={{
                ...aspectStyle,
                filter: `brightness(${state.brightness})`,
                background: "#000",
                display: "block",
            }}
            playsInline
            preload="metadata"
            onClick={onVideoClick}
            onTimeUpdate={handleTimeUpdate}
            onDurationChange={handleDurationChange}
            onPlay={handlePlay}
            onPause={handlePause}
            onWaiting={handleWaiting}
            onCanPlay={handleCanPlay}
            onStalled={handleStalled}
            onEnded={handleEnded}
            onError={handleError}
            onVolumeChange={handleVolumeChange}
            onProgress={handleProgress}
            onSeeking={handleSeeking}
            onSeeked={handleSeeked}
        />
    );
});

export default VideoCore;
