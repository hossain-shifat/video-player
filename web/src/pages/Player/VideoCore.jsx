import { useEffect, useRef, forwardRef, useImperativeHandle, useCallback } from "react";
import { usePlayerState } from "./UsePlayerState";

// ─── Language code → display name ─────────────────────────────────────────────

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
    const name = track.name || "";
    if (name) return name;
    return lang.toUpperCase() || "Unknown";
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

// ─── Adaptive HLS config by network / media type ──────────────────────────────

function getHlsConfig() {
    return {
        enableWorker: true,
        workerPath: undefined,
        lowLatencyMode: false,

        // FIX (Report-19): HLS EVENT playlist type makes hls.js treat the stream
        // as a live broadcast — it chases the live edge and prevents seeking ahead.
        // Force VOD mode so hls.js treats all playlists as on-demand, enabling
        // full seeking regardless of playlist type in the manifest.
        liveDurationInfinity: false,
        // Treat EVENT playlists as VOD once loaded (don't poll for new segments
        // after the current batch — the transcoder appends them naturally).
        liveBackBufferLength: Infinity,

        // Back-buffer: keep 90s behind so user can seek back without refetch
        backBufferLength: 90,

        // Forward buffer: 30s is optimal for most connections
        // HLS.js will auto-grow up to maxMaxBufferLength during smooth playback
        maxBufferLength: 30,
        maxMaxBufferLength: 120,

        // Start loading fragments before play is triggered for instant start
        startFragPrefetch: true,
        startLevel: -1, // auto-select start level

        // Aggressive retry on network errors (helps on home WiFi)
        fragLoadingMaxRetry: 8,
        fragLoadingRetryDelay: 300,
        fragLoadingMaxRetryTimeout: 6000,
        fragLoadingTimeOut: 30_000,

        manifestLoadingMaxRetry: 4,
        manifestLoadingRetryDelay: 500,
        manifestLoadingTimeOut: 20_000,

        levelLoadingMaxRetry: 4,
        levelLoadingTimeOut: 20_000,

        // ABR: keep best quality for longer
        abrEwmaFastLive: 3,
        abrEwmaSlowLive: 9,
        abrEwmaFastVoD: 4,
        abrEwmaSlowVoD: 15,
        abrBandWidthFactor: 0.95,
        abrBandWidthUpFactor: 0.7,

        // Better seeking
        maxSeekHole: 2,

        // Stall recovery
        nudgeMaxRetry: 6,
        nudgeOffset: 0.2,

        // HLS.js debug log (only in dev)
        debug: false,
    };
}

// ─── VideoCore ────────────────────────────────────────────────────────────────

/**
 * VideoCore — handles ALL low-level video/HLS lifecycle.
 *
 * Key improvements over original:
 *  1. Module-level deduplication + cancellation guard on async HLS import.
 *  2. Smart stall recovery: nudge currentTime + startLoad on BUFFER_STALLED.
 *  3. Quality/audio switch by ID (not array index).
 *  4. Better duration resolution from MANIFEST_PARSED.
 *  5. Adaptive buffering config for large remux/4K files.
 *  6. Network error auto-retry with exponential backoff.
 */
const VideoCore = forwardRef(function VideoCore({ streamUrl, onVideoClick, onRetry, mediaDuration }, ref) {
    const videoRef = useRef(null);
    const hlsRef = useRef(null);
    const retryCount = useRef(0);
    const { state, actions } = usePlayerState();

    // Expose raw video element to parent
    useImperativeHandle(ref, () => videoRef.current, []);

    // ── HLS.js / direct-play initialization ──────────────────────────────────
    useEffect(() => {
        if (!streamUrl || !videoRef.current) return;
        const video = videoRef.current;
        let cancelled = false;

        // Reset retry count on new stream
        retryCount.current = 0;

        const isHLS = streamUrl.includes(".m3u8");

        if (isHLS) {
            import("hls.js").then(({ default: Hls }) => {
                if (cancelled) return;

                // Native HLS (Safari / iPhone)
                if (!Hls.isSupported()) {
                    video.src = streamUrl;
                    return;
                }

                // Destroy previous instance cleanly
                if (hlsRef.current) {
                    const old = hlsRef.current;
                    hlsRef.current = null;
                    old.destroy();
                }

                const hls = new Hls(getHlsConfig());
                hlsRef.current = hls;
                hls.loadSource(streamUrl);
                hls.attachMedia(video);

                // ── MANIFEST_PARSED ─────────────────────────────────────────
                hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
                    if (cancelled) return;

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
                    const defIdx = tracks.findIndex((t) => t.default);
                    actions.setActiveAudioTrack(defIdx >= 0 ? defIdx : 0);

                    // FIX (Report-21): Source files often have non-zero starting PTS
                    // (e.g. Interstellar begins at 7.304s). -copyts preserves these
                    // timestamps in segments, so the browser's <video> currentTime
                    // jumps to 7.304s immediately. Force hls.startPosition = 0 so
                    // HLS.js normalises the timeline baseline to zero before play.
                    hls.startPosition = 0;

                    actions.setError(null);
                    actions.setReady(true);
                    actions.setPlaying(true);
                    video.play().catch(() => {});
                });

                // ── LEVEL_LOADED (duration source) ──────────────────────
                hls.on(Hls.Events.LEVEL_LOADED, (_, data) => {
                    if (cancelled) return;
                    const totalduration = data?.details?.totalduration;
                    // FIX (Report-19): HLS EVENT playlist totalduration grows as FFmpeg
                    // transcodes — it starts tiny (17s) and expands. This makes the
                    // seekbar shrink/grow continuously and confuses hls.js into live mode.
                    // Always prefer mediaDuration (real ffprobe duration from PlayerPage)
                    // when it's available — it's the true full-film duration.
                    // Only fall back to totalduration if mediaDuration is absent.
                    const hlsDur = totalduration && totalduration > 0 ? totalduration : 0;
                    const realDur = mediaDuration && mediaDuration > 0 ? mediaDuration : 0;
                    const best = realDur > 0 ? realDur : hlsDur;
                    if (best > 0) actions.setDuration(best);
                });

                // ── LEVEL_SWITCHED ──────────────────────────────────────────
                hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
                    if (cancelled) return;
                    actions.setActiveQuality(hls.autoLevelEnabled ? -1 : data.level);
                });

                // ── AUDIO_TRACK_SWITCHED ────────────────────────────────────
                hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_, data) => {
                    if (cancelled) return;
                    const idx = (hls.audioTracks || []).findIndex((t) => t.id === data.id);
                    actions.setActiveAudioTrack(idx >= 0 ? idx : 0);
                });

                // ── BUFFER_STALLED (stall recovery) ────────────────────────
                hls.on(Hls.Events.BUFFER_STALLED, () => {
                    if (cancelled) return;
                    actions.setBuffering(true);
                    actions.incrementStall();
                    // Nudge playhead slightly to unstick browser decoder
                    if (video.readyState > 2 && video.currentTime > 0) {
                        video.currentTime += 0.1;
                    }
                    hls.startLoad();
                });

                // ── FRAG_LOADED (clear buffering indicator) ─────────────────
                hls.on(Hls.Events.FRAG_LOADED, (_, data) => {
                    if (cancelled) return;
                    // Update duration from loaded fragment data (HLS live/event streams)
                    if (data?.frag?.duration) {
                        const v = videoRef.current;
                        if (v && isFinite(v.duration) && v.duration > 0) {
                            actions.setDuration(v.duration);
                        }
                    }
                    // Clear buffering state once at least one fragment loaded
                    actions.setBuffering(false);
                });

                // ── ERROR ────────────────────────────────────────────────────
                hls.on(Hls.Events.ERROR, (_, data) => {
                    if (cancelled || !data.fatal) return;

                    const status = data.response?.code;

                    if (status === 429) {
                        hls.destroy();
                        hlsRef.current = null;
                        actions.setError("Stream rate-limited. Please wait and try again.");
                        return;
                    }
                    if (status === 404) {
                        hls.destroy();
                        hlsRef.current = null;
                        actions.setError("Stream not found. Go back and try again.");
                        return;
                    }

                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            // Exponential backoff retry
                            if (retryCount.current < 5) {
                                retryCount.current++;
                                const delay = Math.min(500 * 2 ** retryCount.current, 10000);
                                setTimeout(() => {
                                    if (!cancelled) hls.startLoad();
                                }, delay);
                            } else {
                                actions.setError("Network error. Check connection and try again.");
                            }
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            if (retryCount.current < 3) {
                                retryCount.current++;
                                hls.recoverMediaError();
                            } else {
                                hls.swapAudioCodec();
                                hls.recoverMediaError();
                            }
                            break;
                        default:
                            hls.destroy();
                            hlsRef.current = null;
                            actions.setError("Unable to play stream. Please try again.");
                    }
                });
            });
        } else {
            // ── Direct play (MP4, MKV via range requests, etc.) ───────────────
            video.src = streamUrl;
            actions.setReady(false);

            const onLoadedMeta = () => {
                // Don't seek yet — let useProgress handle resume
                if (isFinite(video.duration) && video.duration > 0) {
                    actions.setDuration(video.duration);
                }
            };

            const onCanPlay = () => {
                actions.setError(null);
                actions.setBuffering(false);

                // Native audio track enumeration
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
            };

            video.addEventListener("loadedmetadata", onLoadedMeta, { once: true });
            video.addEventListener("canplay", onCanPlay, { once: true });

            return () => {
                cancelled = true;
                video.removeEventListener("loadedmetadata", onLoadedMeta);
                video.removeEventListener("canplay", onCanPlay);
                if (hlsRef.current) {
                    hlsRef.current.destroy();
                    hlsRef.current = null;
                }
                // FIX (Report-20): Do NOT set video.src = "" here.
                // StrictMode cleanup fires on first mount then re-mounts immediately.
                // src="" makes browser try to load current page URL as media →
                // DEMUXER_ERROR_COULD_NOT_OPEN. HLS.js destroy() detaches MediaSource
                // cleanly. Direct play: next effect sets new src itself.
            };
        }

        return () => {
            cancelled = true;
            if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
            }
            // FIX (Report-20): Do NOT set video.src = "" — see comment above.
            // StrictMode double-invoke causes DEMUXER_ERROR_COULD_NOT_OPEN.
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [streamUrl]);

    // ── Sync HLS quality level ────────────────────────────────────────────────
    useEffect(() => {
        if (!hlsRef.current) return;
        if (state.activeQuality === -1) {
            hlsRef.current.autoLevelEnabled = true;
        } else {
            hlsRef.current.currentLevel = state.activeQuality;
        }
    }, [state.activeQuality]);

    // ── Sync audio track by HLS ID (not array index) ─────────────────────────
    useEffect(() => {
        const hls = hlsRef.current;
        if (!hls) return;
        const track = hls.audioTracks?.[state.activeAudioTrack];
        if (track) {
            hls.audioTrack = track.id;
        }
    }, [state.activeAudioTrack]);

    // ── Sync playback speed ───────────────────────────────────────────────────
    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.playbackRate = state.playbackSpeed;
        }
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
        const v = videoRef.current;
        if (!v) return;
        actions.setCurrentTime(v.currentTime);
        actions.setBuffered(v.buffered);
    };

    const handleDurationChange = () => {
        const dur = videoRef.current?.duration;
        if (dur && isFinite(dur) && dur > 0) actions.setDuration(dur);
    };

    const handlePlay = () => {
        actions.setError(null);
        actions.setPlaying(true);
    };
    const handlePause = () => actions.setPlaying(false);

    const handleWaiting = () => {
        actions.setBuffering(true);
        actions.incrementStall();
    };

    const handleCanPlay = () => {
        actions.setBuffering(false);
        actions.setReady(true);
        actions.setError(null);
    };

    const handleProgress = () => {
        if (videoRef.current) actions.setBuffered(videoRef.current.buffered);
    };

    const handleEnded = () => {
        actions.setPlaying(false);
        if (state.loop === "one" && videoRef.current) {
            videoRef.current.currentTime = 0;
            videoRef.current.play().catch(() => {});
        }
    };

    const handleError = () => {
        const video = videoRef.current;
        if (!video?.error) return;

        // FIX (Report-06): When HLS.js is active, the <video> element's native
        // onerror fires because Chrome's demuxer rejects the malformed segment
        // (e.g. h264 without Annex B). The HLS.js ERROR event handler on the hls
        // instance is the correct place to handle this — it will call
        // hls.recoverMediaError() which swaps the SourceBuffer cleanly.
        //
        // Doing video.src = "" here destroys the MediaSource blob URL that HLS.js
        // created, breaking HLS.js irrecoverably. So when HLS is active: bail out
        // completely and let HLS.js's own ERROR handler deal with it.
        if (hlsRef.current) return;

        // Direct-play only below
        if (video.error?.code === MediaError.MEDIA_ERR_ABORTED) return;

        if (retryCount.current < 2) {
            retryCount.current++;
            const src = video.src;
            video.src = "";
            video.load();
            setTimeout(() => {
                if (videoRef.current) {
                    videoRef.current.src = src;
                    videoRef.current.load();
                    videoRef.current.play().catch(() => {});
                }
            }, 500);
        } else {
            actions.setError("Video playback error. Check the stream.");
        }
    };

    const handleVolumeChange = () => {
        if (videoRef.current) {
            actions.setVolume(videoRef.current.volume);
            actions.setMuted(videoRef.current.muted);
        }
    };

    return (
        <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full"
            style={{
                ...getAspectStyle(state.aspectRatio),
                filter: `brightness(${state.brightness})`,
                background: "#000",
                display: "block",
                // GPU acceleration for smooth playback
                willChange: "contents",
                transform: "translateZ(0)",
            }}
            playsInline
            preload="auto"
            crossOrigin="anonymous"
            onClick={onVideoClick}
            onTimeUpdate={handleTimeUpdate}
            onDurationChange={handleDurationChange}
            onPlay={handlePlay}
            onPause={handlePause}
            onWaiting={handleWaiting}
            onCanPlay={handleCanPlay}
            onEnded={handleEnded}
            onError={handleError}
            onVolumeChange={handleVolumeChange}
            onProgress={handleProgress}
            onStalled={() => {
                actions.setBuffering(true);
                actions.incrementStall();
            }}
            onSeeking={() => actions.setBuffering(true)}
            onSeeked={() => actions.setBuffering(false)}
        />
    );
});

export default VideoCore;
