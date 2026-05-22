import { useEffect, useRef, forwardRef, useImperativeHandle } from "react";
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
            return { objectFit: "contain", width: "100%", height: "100%" }; // "auto"
    }
}

// ─── VideoCore ────────────────────────────────────────────────────────────────
/**
 * VideoCore — handles ALL low-level video/HLS lifecycle.
 *
 * Fix log vs original:
 *  1. async import("hls.js") race — `cancelled` flag checked BEFORE touching DOM.
 *     Without this, unmounting mid-import creates an orphan HLS instance that
 *     steals the video element and causes phantom seeking + timeline desync.
 *  2. Direct-play loadedmetadata/canplay listeners use named refs so cleanup
 *     can removeEventListener them, preventing double-firing after src reset.
 *  3. Audio track switch uses hlsRef.current.audioTrack (the track's ID field
 *     returned by HLS.js) rather than the array index — they can differ.
 *  4. MANIFEST_PARSED duration: falls back to hls.media.duration once it is
 *     finite, not just levelDetails.totalduration (which is 0 for VoD early on).
 */
const VideoCore = forwardRef(function VideoCore({ streamUrl, onVideoClick }, ref) {
    const videoRef = useRef(null);
    const hlsRef = useRef(null);
    const { state, actions } = usePlayerState();

    // Expose raw video element to parent (PlayerPage, PlayerControls seek, etc.)
    useImperativeHandle(ref, () => videoRef.current, []);

    // ── HLS.js / direct-play initialization ──────────────────────────────────
    useEffect(() => {
        if (!streamUrl || !videoRef.current) return;
        const video = videoRef.current;

        // ── BUG FIX 1: cancellation flag for async HLS.js import ──────────
        // If streamUrl changes (or component unmounts) before the dynamic import
        // resolves, `cancelled = true` ensures we never touch the stale video.
        let cancelled = false;

        const isHLS = streamUrl.includes(".m3u8");

        if (isHLS) {
            import("hls.js").then(({ default: Hls }) => {
                if (cancelled) return; // ← the critical guard

                // Native HLS (Safari / iPhone)
                if (!Hls.isSupported()) {
                    video.src = streamUrl;
                    return;
                }

                // Destroy any previous HLS instance synchronously so it
                // releases its network requests before the new one starts.
                if (hlsRef.current) {
                    const old = hlsRef.current;
                    hlsRef.current = null;
                    old.destroy();
                }

                const hls = new Hls({
                    enableWorker: true,
                    lowLatencyMode: false,
                    backBufferLength: 90,
                    maxBufferLength: 30,
                    maxMaxBufferLength: 60,
                    startFragPrefetch: true,
                    fragLoadingMaxRetry: 6,
                    fragLoadingRetryDelay: 500,
                    manifestLoadingMaxRetry: 4,
                    fragLoadingTimeOut: 30_000,
                });

                hlsRef.current = hls;
                hls.loadSource(streamUrl);
                hls.attachMedia(video);

                hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
                    if (cancelled) return;

                    // ── BUG FIX 4: reliable duration ─────────────────────
                    // hls.media.duration is Infinity for live-like manifests;
                    // fall back to totalduration from the first level's details.
                    const finDuration = isFinite(video.duration) && video.duration > 0 ? video.duration : data.levels?.[0]?.details?.totalduration || 0;
                    if (finDuration > 0) actions.setDuration(finDuration);

                    // Quality levels
                    const levels = hls.levels.map((l, i) => ({
                        index: i,
                        height: l.height,
                        width: l.width,
                        bitrate: l.bitrate,
                        label: l.height ? `${l.height}p` : `Level ${i}`,
                    }));
                    actions.setQualityLevels(levels);
                    actions.setActiveQuality(-1); // auto

                    // Audio tracks
                    const tracks = (hls.audioTracks || []).map((t, i) => ({
                        index: i,
                        id: t.id, // ← HLS.js uses ID for switching
                        name: resolveLanguageName(t),
                        lang: t.lang || t.language || "",
                        default: t.default || false,
                    }));
                    actions.setAudioTracks(tracks);
                    const defIdx = tracks.findIndex((t) => t.default);
                    actions.setActiveAudioTrack(defIdx >= 0 ? defIdx : 0);

                    actions.setReady(true);
                    actions.setPlaying(true);
                    video.play().catch(() => {});
                });

                hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
                    actions.setActiveQuality(hls.autoLevelEnabled ? -1 : data.level);
                });

                hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_, data) => {
                    // data.id is the HLS track ID, map back to our index
                    const idx = (hls.audioTracks || []).findIndex((t) => t.id === data.id);
                    actions.setActiveAudioTrack(idx >= 0 ? idx : 0);
                });

                // Error handling — mirrors Jellyfin's approach: only retry once
                // for transient network errors, hard-stop on 404/429.
                hls.on(Hls.Events.ERROR, (_, data) => {
                    if (!data.fatal) return;

                    const status = data.response?.code;

                    if (status === 429) {
                        hls.destroy();
                        hlsRef.current = null;
                        actions.setError("Stream rate limited. Please wait and try again.");
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
                            actions.setError(null);
                            hls.startLoad();
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            actions.setError(null);
                            hls.recoverMediaError();
                            break;
                        default:
                            hls.destroy();
                            hlsRef.current = null;
                            actions.setError("Unable to play stream. Please try again.");
                    }
                });
            });
        } else {
            // ── Direct play ───────────────────────────────────────────────
            video.src = streamUrl;
            actions.setReady(false);

            // ── BUG FIX 2: named listener references for proper cleanup ──
            // Using { once: true } anonymous functions leaks across src resets.
            const onLoadedMeta = () => {
                // Reset to 0 — overrides any browser speculative-seek from moov
                // atom parsing. useProgress resume logic fires AFTER canplay.
                video.currentTime = 0;
            };
            const onCanPlay = () => {
                actions.setError(null);

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

            // Return cleanup that removes them even if they haven't fired yet
            return () => {
                cancelled = true;
                video.removeEventListener("loadedmetadata", onLoadedMeta);
                video.removeEventListener("canplay", onCanPlay);
                if (hlsRef.current) {
                    hlsRef.current.destroy();
                    hlsRef.current = null;
                }
                video.src = "";
                video.load(); // abort any pending network request
            };
        }

        return () => {
            cancelled = true; // ← BUG FIX 1: stops async HLS setup from touching dead video
            if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
            }
            video.src = "";
            video.load();
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

    // ── BUG FIX 3: sync audio track by ID, not array index ───────────────────
    useEffect(() => {
        const hls = hlsRef.current;
        if (!hls) return;
        const track = hls.audioTracks?.[state.activeAudioTrack];
        if (track) {
            hls.audioTrack = track.id; // HLS.js uses .id, not array index
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
        if (videoRef.current) {
            actions.setCurrentTime(videoRef.current.currentTime);
            actions.setBuffered(videoRef.current.buffered);
        }
    };

    const handleDurationChange = () => {
        const dur = videoRef.current?.duration;
        if (dur && isFinite(dur) && dur > 0) {
            actions.setDuration(dur);
        }
    };

    const handlePlay = () => {
        actions.setError(null);
        actions.setPlaying(true);
    };
    const handlePause = () => actions.setPlaying(false);
    const handleWaiting = () => actions.setBuffering(true);
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
        // HLS.js handles its own errors; only surface native errors for direct play
        if (hlsRef.current) {
            if (video.readyState >= 2) return;
            if (video.currentTime > 0) return;
        }
        if (video.error?.code === MediaError.MEDIA_ERR_ABORTED) return;
        actions.setError("Video playback error. Check the stream.");
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
            onEnded={handleEnded}
            onError={handleError}
            onVolumeChange={handleVolumeChange}
            onProgress={handleProgress}
        />
    );
});

export default VideoCore;
