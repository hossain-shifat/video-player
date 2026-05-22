/**
 * Player.jsx — FLUX Media Player
 *
 * Handles both direct-play (range stream) and HLS transcoded sessions.
 *
 * Flow:
 *   1. Mount → call GET /stream/video/:id?info=1
 *   2. Server responds { mode: "direct" | "hls", streamUrl | hlsUrl, sessionId }
 *   3a. Direct → set <video src=streamUrl>
 *   3b. HLS    → load HLS.js with hlsUrl, heartbeat every 10s to ping session
 *   4. On unmount / stop → DELETE /stream/sessions/:sessionId
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import { ArrowLeft, Play, Pause, Volume2, VolumeX, Maximize, Minimize, Settings, Loader, AlertCircle, SkipBack, SkipForward } from "lucide-react";

const API = import.meta.env.VITE_API_URL || "http://localhost:5000";

// ─── HLS.js dynamic import (only needed for HLS sessions) ────────────────────
let HlsClass = null;
async function loadHls() {
    if (HlsClass) return HlsClass;
    try {
        const mod = await import("hls.js");
        HlsClass = mod.default ?? mod;
        return HlsClass;
    } catch {
        return null;
    }
}

// ─── Format helpers ───────────────────────────────────────────────────────────
function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) return "0:00";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function Player() {
    const { id } = useParams();
    const navigate = useNavigate();
    const videoRef = useRef(null);
    const hlsRef = useRef(null);
    const sessionIdRef = useRef(null);
    const heartbeatRef = useRef(null);
    const controlsTimerRef = useRef(null);
    const containerRef = useRef(null);

    const [status, setStatus] = useState("loading"); // loading | playing | error
    const [errorMsg, setErrorMsg] = useState("");
    const [streamInfo, setStreamInfo] = useState(null);

    // Playback state
    const [paused, setPaused] = useState(true);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [muted, setMuted] = useState(false);
    const [buffered, setBuffered] = useState(0);
    const [showControls, setShowControls] = useState(true);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [seeking, setSeeking] = useState(false);

    // ── Cleanup on unmount ────────────────────────────────────────────────────
    useEffect(() => {
        return () => {
            clearInterval(heartbeatRef.current);
            clearTimeout(controlsTimerRef.current);

            if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
            }

            // Kill server-side transcoding session
            const sid = sessionIdRef.current;
            if (sid) {
                navigator.sendBeacon(`${API}/stream/sessions/${sid}`, JSON.stringify({ _method: "DELETE" }));
                fetch(`${API}/stream/sessions/${sid}`, { method: "DELETE" }).catch(() => {});
            }
        };
    }, []);

    // ── Fetch stream info ─────────────────────────────────────────────────────
    useEffect(() => {
        if (!id) return;
        initPlayer(id);
    }, [id]);

    async function initPlayer(mediaId) {
        setStatus("loading");
        setErrorMsg("");

        try {
            const res = await fetch(`${API}/stream/video/${encodeURIComponent(mediaId)}?info=1`);
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || `HTTP ${res.status}`);
            }
            const info = await res.json();
            setStreamInfo(info);

            if (info.mode === "direct") {
                await attachDirect(info.streamUrl);
            } else {
                // HLS mode
                sessionIdRef.current = info.sessionId;
                await attachHLS(info.hlsUrl, info.sessionId);
                startHeartbeat(info.sessionId);
            }
        } catch (err) {
            console.error("[Player] init error:", err);
            setErrorMsg(err.message || "Failed to load stream");
            setStatus("error");
        }
    }

    async function attachDirect(url) {
        const video = videoRef.current;
        if (!video) return;
        video.src = url;
        video.load();
        setStatus("playing");
    }

    async function attachHLS(manifestUrl, sessionId) {
        const video = videoRef.current;
        if (!video) return;

        const Hls = await loadHls();

        // HLS.js not available (Safari natively supports HLS)
        if (!Hls || !Hls.isSupported()) {
            if (video.canPlayType("application/vnd.apple.mpegurl")) {
                video.src = `${API}${manifestUrl}`;
                video.load();
                setStatus("playing");
                return;
            }
            throw new Error("HLS not supported in this browser. Install hls.js or use Safari.");
        }

        // Destroy any existing HLS instance
        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }

        const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            // Start loading from beginning of manifest
            startPosition: -1,
            // Buffer settings matching segment size (4s)
            maxBufferLength: 30,
            maxMaxBufferLength: 60,
            maxBufferSize: 60 * 1000 * 1000, // 60 MB
            // Retry on segment 404 (transcoder might be slightly behind)
            fragLoadingMaxRetry: 4,
            fragLoadingRetryDelay: 500,
            manifestLoadingMaxRetry: 3,
            manifestLoadingRetryDelay: 1000,
            // XhrSetup for CORS
            xhrSetup(xhr) {
                xhr.withCredentials = false;
            },
        });

        hls.loadSource(`${API}${manifestUrl}`);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            console.log("[Player] HLS manifest parsed");
            setStatus("playing");
            video.play().catch(() => {});
        });

        hls.on(Hls.Events.ERROR, (_, data) => {
            if (data.fatal) {
                console.error("[Player] HLS fatal error:", data.type, data.details);
                if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                    // Retry on network errors
                    hls.startLoad();
                } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                    hls.recoverMediaError();
                } else {
                    setErrorMsg(`Playback error: ${data.details}`);
                    setStatus("error");
                }
            } else {
                console.warn("[Player] HLS non-fatal error:", data.details);
            }
        });

        // Handle session restart after seeking (server sends X-New-Session-Id header)
        hls.on(Hls.Events.FRAG_LOADED, (_, data) => {
            const newSid = data.frag?.url && extractHeader(data.frag.url, "X-New-Session-Id");
            if (newSid && newSid !== sessionIdRef.current) {
                console.log("[Player] Session restarted by server:", newSid);
                sessionIdRef.current = newSid;
                clearInterval(heartbeatRef.current);
                startHeartbeat(newSid);
            }
        });

        hlsRef.current = hls;
    }

    function extractHeader(url, header) {
        // HLS.js doesn't expose response headers easily; we skip this for now
        return null;
    }

    // ── Heartbeat — keeps server session alive ────────────────────────────────
    function startHeartbeat(sessionId) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = setInterval(async () => {
            const video = videoRef.current;
            const pos = video?.currentTime || 0;
            try {
                await fetch(`${API}/stream/sessions/${sessionId}/ping`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ positionSec: pos }),
                });
            } catch {
                // Silently ignore heartbeat failures
            }
        }, 10_000);
    }

    // ── Video event listeners ─────────────────────────────────────────────────
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const onTimeUpdate = () => {
            setCurrentTime(video.currentTime);
            // Update buffered amount
            if (video.buffered.length > 0) {
                setBuffered(video.buffered.end(video.buffered.length - 1));
            }
        };
        const onDurationChange = () => setDuration(video.duration || 0);
        const onPlay = () => setPaused(false);
        const onPause = () => setPaused(true);
        const onVolumeChange = () => {
            setVolume(video.volume);
            setMuted(video.muted);
        };
        const onWaiting = () => setSeeking(true);
        const onCanPlay = () => setSeeking(false);

        video.addEventListener("timeupdate", onTimeUpdate);
        video.addEventListener("durationchange", onDurationChange);
        video.addEventListener("play", onPlay);
        video.addEventListener("pause", onPause);
        video.addEventListener("volumechange", onVolumeChange);
        video.addEventListener("waiting", onWaiting);
        video.addEventListener("canplay", onCanPlay);
        video.addEventListener("ended", () => setPaused(true));

        return () => {
            video.removeEventListener("timeupdate", onTimeUpdate);
            video.removeEventListener("durationchange", onDurationChange);
            video.removeEventListener("play", onPlay);
            video.removeEventListener("pause", onPause);
            video.removeEventListener("volumechange", onVolumeChange);
            video.removeEventListener("waiting", onWaiting);
            video.removeEventListener("canplay", onCanPlay);
        };
    }, [status]);

    // ── Fullscreen listener ───────────────────────────────────────────────────
    useEffect(() => {
        const onChange = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener("fullscreenchange", onChange);
        return () => document.removeEventListener("fullscreenchange", onChange);
    }, []);

    // ── Controls auto-hide ────────────────────────────────────────────────────
    const resetControlsTimer = useCallback(() => {
        setShowControls(true);
        clearTimeout(controlsTimerRef.current);
        controlsTimerRef.current = setTimeout(() => {
            if (!videoRef.current?.paused) setShowControls(false);
        }, 3000);
    }, []);

    // ── Playback controls ─────────────────────────────────────────────────────
    const togglePlay = () => {
        const v = videoRef.current;
        if (!v) return;
        v.paused ? v.play() : v.pause();
    };

    const handleSeek = (e) => {
        const v = videoRef.current;
        if (!v || !duration) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const ratio = (e.clientX - rect.left) / rect.width;
        const newTime = ratio * duration;
        v.currentTime = newTime;
        setCurrentTime(newTime);
    };

    const handleVolumeChange = (e) => {
        const v = videoRef.current;
        if (!v) return;
        const val = parseFloat(e.target.value);
        v.volume = val;
        v.muted = val === 0;
    };

    const toggleMute = () => {
        const v = videoRef.current;
        if (!v) return;
        v.muted = !v.muted;
    };

    const toggleFullscreen = () => {
        const el = containerRef.current;
        if (!el) return;
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            el.requestFullscreen();
        }
    };

    const skipSeconds = (sec) => {
        const v = videoRef.current;
        if (!v) return;
        v.currentTime = Math.max(0, Math.min(duration, v.currentTime + sec));
    };

    // Keyboard shortcuts
    useEffect(() => {
        const onKey = (e) => {
            if (e.target.tagName === "INPUT") return;
            switch (e.code) {
                case "Space":
                    e.preventDefault();
                    togglePlay();
                    break;
                case "ArrowRight":
                    skipSeconds(10);
                    break;
                case "ArrowLeft":
                    skipSeconds(-10);
                    break;
                case "ArrowUp":
                    e.preventDefault();
                    if (videoRef.current) videoRef.current.volume = Math.min(1, videoRef.current.volume + 0.1);
                    break;
                case "ArrowDown":
                    e.preventDefault();
                    if (videoRef.current) videoRef.current.volume = Math.max(0, videoRef.current.volume - 0.1);
                    break;
                case "KeyF":
                    toggleFullscreen();
                    break;
                case "KeyM":
                    toggleMute();
                    break;
            }
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [duration]);

    const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
    const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0;
    const isHLS = streamInfo?.mode === "hls";

    return (
        <div
            ref={containerRef}
            className="relative w-full h-screen bg-black flex items-center justify-center select-none"
            onMouseMove={resetControlsTimer}
            onClick={resetControlsTimer}
            style={{ cursor: showControls ? "default" : "none" }}>
            {/* ── Video element ─────────────────────────────────────────── */}
            <video ref={videoRef} className="w-full h-full object-contain" playsInline preload="auto" onClick={togglePlay} onDoubleClick={toggleFullscreen} />

            {/* ── Loading overlay ───────────────────────────────────────── */}
            {(status === "loading" || (seeking && status !== "error")) && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 pointer-events-none">
                    <div className="flex flex-col items-center gap-3">
                        <Loader size={40} className="text-primary animate-spin" />
                        <p className="text-white/60 text-sm">{status === "loading" ? (isHLS ? "Starting transcoder…" : "Loading stream…") : "Buffering…"}</p>
                    </div>
                </div>
            )}

            {/* ── Error overlay ─────────────────────────────────────────── */}
            {status === "error" && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                    <div className="text-center max-w-sm px-6 py-8 rounded-2xl bg-base-200/90 border border-error/30">
                        <AlertCircle size={40} className="text-error mx-auto mb-3" />
                        <p className="text-white font-semibold mb-1">Video playback error</p>
                        <p className="text-white/50 text-sm mb-5">{errorMsg}</p>
                        <div className="flex gap-3 justify-center">
                            <button className="btn btn-primary btn-sm rounded-full px-6" onClick={() => initPlayer(id)}>
                                Retry
                            </button>
                            <button className="btn btn-ghost btn-sm rounded-full px-6 text-white/60" onClick={() => navigate(-1)}>
                                Go Back
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Controls overlay ──────────────────────────────────────── */}
            {status !== "error" && (
                <div className={`absolute inset-0 flex flex-col justify-between transition-opacity duration-300 ${showControls ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
                    {/* Top bar */}
                    <div className="flex items-center gap-3 px-4 py-4 bg-gradient-to-b from-black/70 to-transparent">
                        <button className="text-white/80 hover:text-white transition-colors p-1" onClick={() => navigate(-1)}>
                            <ArrowLeft size={22} />
                        </button>
                        <div className="flex-1 min-w-0">
                            <p className="text-white font-semibold truncate text-sm">{streamInfo?.title || "Now Playing"}</p>
                            {isHLS && <span className="text-[10px] text-primary/70 font-medium">HLS · {streamInfo?.decision?.replace(/_/g, " ").toUpperCase()}</span>}
                        </div>
                    </div>

                    {/* Center play/pause (big click area) */}
                    <div className="flex-1 flex items-center justify-center" onClick={togglePlay}>
                        {paused && status === "playing" && (
                            <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                                <Play size={28} className="text-white ml-1" fill="white" />
                            </div>
                        )}
                    </div>

                    {/* Bottom controls */}
                    <div className="px-4 pb-4 bg-gradient-to-t from-black/80 to-transparent">
                        {/* Progress bar */}
                        <div className="relative h-1 bg-white/20 rounded-full cursor-pointer group mb-3 hover:h-2 transition-all" onClick={handleSeek}>
                            {/* Buffered */}
                            <div className="absolute top-0 left-0 h-full bg-white/30 rounded-full pointer-events-none" style={{ width: `${bufferedPct}%` }} />
                            {/* Played */}
                            <div className="absolute top-0 left-0 h-full bg-primary rounded-full pointer-events-none" style={{ width: `${progressPct}%` }} />
                            {/* Thumb */}
                            <div
                                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-primary rounded-full opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                                style={{ left: `calc(${progressPct}% - 6px)` }}
                            />
                        </div>

                        {/* Buttons row */}
                        <div className="flex items-center gap-3">
                            {/* Skip back */}
                            <button className="text-white/70 hover:text-white transition-colors" onClick={() => skipSeconds(-10)} title="Rewind 10s">
                                <SkipBack size={18} />
                            </button>

                            {/* Play/Pause */}
                            <button className="text-white hover:text-primary transition-colors" onClick={togglePlay}>
                                {paused ? <Play size={24} fill="currentColor" /> : <Pause size={24} fill="currentColor" />}
                            </button>

                            {/* Skip forward */}
                            <button className="text-white/70 hover:text-white transition-colors" onClick={() => skipSeconds(10)} title="Forward 10s">
                                <SkipForward size={18} />
                            </button>

                            {/* Volume */}
                            <div className="flex items-center gap-2 group/vol">
                                <button className="text-white/70 hover:text-white transition-colors shrink-0" onClick={toggleMute}>
                                    {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                                </button>
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.05"
                                    value={muted ? 0 : volume}
                                    onChange={handleVolumeChange}
                                    className="w-20 h-1 accent-primary opacity-0 group-hover/vol:opacity-100 transition-opacity cursor-pointer"
                                />
                            </div>

                            {/* Time */}
                            <span className="text-white/60 text-xs font-mono ml-1">
                                {fmtTime(currentTime)} / {fmtTime(duration)}
                            </span>

                            {/* Spacer */}
                            <div className="flex-1" />

                            {/* Fullscreen */}
                            <button className="text-white/70 hover:text-white transition-colors" onClick={toggleFullscreen}>
                                {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
