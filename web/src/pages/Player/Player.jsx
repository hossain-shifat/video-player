/**
 * Player.jsx — FLUX Media Player (Professional Edition)
 *
 * Features:
 *   - Fetches media name from /api/media/:id
 *   - Direct play + HLS transcoded sessions
 *   - Playback speed (0.25x–2x)
 *   - Subtitle track selector
 *   - Volume with persistent slider
 *   - Draggable seek bar with time preview tooltip
 *   - Double-click side zones to seek ±10s (MX style)
 *   - Picture-in-Picture
 *   - Keyboard shortcuts overlay (press ?)
 *   - Auto-hide controls
 *   - Buffered progress indicator
 *   - Quality badge for HLS mode
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import {
    ArrowLeft,
    Play,
    Pause,
    Volume2,
    Volume1,
    VolumeX,
    Maximize,
    Minimize,
    Loader,
    AlertCircle,
    SkipBack,
    SkipForward,
    Settings,
    Subtitles,
    Gauge,
    PictureInPicture2,
    Keyboard,
    X,
    Check,
    ChevronLeft,
    RotateCcw,
    RotateCw,
} from "lucide-react";

const API = import.meta.env.VITE_API_URL || "http://localhost:5000";

// ─── HLS.js lazy loader ───────────────────────────────────────────────────────
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

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) return "0:00";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
}

function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
}

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

// ─── Seek ripple animation component ─────────────────────────────────────────
function SeekRipple({ side, onDone }) {
    useEffect(() => {
        const t = setTimeout(onDone, 600);
        return () => clearTimeout(t);
    }, [onDone]);
    return (
        <div
            className={`absolute top-0 bottom-0 ${side === "left" ? "left-0" : "right-0"} w-1/3 flex items-center justify-center pointer-events-none`}
            style={{ animation: "rippleFade 0.6s ease-out forwards" }}>
            <div className="flex flex-col items-center gap-1">
                {side === "left" ? <RotateCcw size={32} className="text-white/80" /> : <RotateCw size={32} className="text-white/80" />}
                <span className="text-white/80 text-sm font-semibold">10s</span>
            </div>
        </div>
    );
}

// ─── Settings panel ───────────────────────────────────────────────────────────
function SettingsMenu({ speed, onSpeedChange, subtitles, activeSubtitle, onSubtitleChange, onClose }) {
    const [page, setPage] = useState("main"); // main | speed | subtitles

    return (
        <div className="absolute bottom-16 right-4 w-56 rounded-2xl overflow-hidden shadow-2xl border border-white/10 z-50" style={{ background: "rgba(10,10,15,0.96)", backdropFilter: "blur(20px)" }}>
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
                {page !== "main" ? (
                    <button onClick={() => setPage("main")} className="text-white/60 hover:text-white transition-colors">
                        <ChevronLeft size={16} />
                    </button>
                ) : null}
                <span className="text-white text-sm font-semibold flex-1 capitalize">{page === "main" ? "Settings" : page}</span>
                <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
                    <X size={16} />
                </button>
            </div>

            {/* Main page */}
            {page === "main" && (
                <div className="py-1">
                    <button onClick={() => setPage("speed")} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left">
                        <Gauge size={16} className="text-white/50 shrink-0" />
                        <span className="text-white/80 text-sm flex-1">Playback Speed</span>
                        <span className="text-primary text-xs font-semibold">{speed === 1 ? "Normal" : `${speed}×`}</span>
                    </button>
                    {subtitles.length > 0 && (
                        <button onClick={() => setPage("subtitles")} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left">
                            <Subtitles size={16} className="text-white/50 shrink-0" />
                            <span className="text-white/80 text-sm flex-1">Subtitles</span>
                            <span className="text-primary text-xs font-semibold truncate max-w-20">{activeSubtitle === -1 ? "Off" : subtitles[activeSubtitle]?.label || "On"}</span>
                        </button>
                    )}
                </div>
            )}

            {/* Speed page */}
            {page === "speed" && (
                <div className="py-1">
                    {SPEEDS.map((s) => (
                        <button
                            key={s}
                            onClick={() => {
                                onSpeedChange(s);
                                setPage("main");
                            }}
                            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left">
                            <span className="text-white/80 text-sm flex-1">{s === 1 ? "Normal" : `${s}×`}</span>
                            {speed === s && <Check size={14} className="text-primary shrink-0" />}
                        </button>
                    ))}
                </div>
            )}

            {/* Subtitles page */}
            {page === "subtitles" && (
                <div className="py-1">
                    <button
                        onClick={() => {
                            onSubtitleChange(-1);
                            setPage("main");
                        }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left">
                        <span className="text-white/80 text-sm flex-1">Off</span>
                        {activeSubtitle === -1 && <Check size={14} className="text-primary shrink-0" />}
                    </button>
                    {subtitles.map((sub, i) => (
                        <button
                            key={i}
                            onClick={() => {
                                onSubtitleChange(i);
                                setPage("main");
                            }}
                            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left">
                            <span className="text-white/80 text-sm flex-1 truncate">{sub.label}</span>
                            {activeSubtitle === i && <Check size={14} className="text-primary shrink-0" />}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Keyboard shortcuts overlay ───────────────────────────────────────────────
function KeyboardHelp({ onClose }) {
    const shortcuts = [
        ["Space / K", "Play / Pause"],
        ["← / →", "Seek ±10s"],
        ["↑ / ↓", "Volume ±10%"],
        ["M", "Mute"],
        ["F", "Fullscreen"],
        ["P", "Picture-in-Picture"],
        ["< / >", "Speed down/up"],
        ["?", "Toggle this help"],
    ];
    return (
        <div className="absolute inset-0 flex items-center justify-center z-50 bg-black/70 backdrop-blur-sm">
            <div className="w-80 rounded-2xl border border-white/10 shadow-2xl overflow-hidden" style={{ background: "rgba(10,10,15,0.97)" }}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                    <div className="flex items-center gap-2">
                        <Keyboard size={18} className="text-primary" />
                        <span className="text-white font-semibold text-sm">Keyboard Shortcuts</span>
                    </div>
                    <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
                        <X size={18} />
                    </button>
                </div>
                <div className="p-2">
                    {shortcuts.map(([key, desc]) => (
                        <div key={key} className="flex items-center justify-between px-3 py-2">
                            <span className="text-white/50 text-xs">{desc}</span>
                            <kbd className="text-[11px] font-mono bg-white/10 text-white/80 px-2 py-0.5 rounded border border-white/15">{key}</kbd>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

// ─── Main Player ──────────────────────────────────────────────────────────────
export default function Player() {
    const { id } = useParams();
    const navigate = useNavigate();
    const videoRef = useRef(null);
    const hlsRef = useRef(null);
    const sessionIdRef = useRef(null);
    const heartbeatRef = useRef(null);
    const controlsTimerRef = useRef(null);
    const containerRef = useRef(null);
    const seekBarRef = useRef(null);
    const isDraggingRef = useRef(false);

    // Status
    const [status, setStatus] = useState("loading");
    const [errorMsg, setErrorMsg] = useState("");
    const [streamInfo, setStreamInfo] = useState(null);
    const [mediaTitle, setMediaTitle] = useState("");
    const [mediaYear, setMediaYear] = useState(null);

    // Playback
    const [paused, setPaused] = useState(true);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [muted, setMuted] = useState(false);
    const [buffered, setBuffered] = useState(0);
    const [waiting, setWaiting] = useState(false);
    const [speed, setSpeed] = useState(1);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [isPip, setIsPip] = useState(false);

    // UI
    const [showControls, setShowControls] = useState(true);
    const [seekTooltip, setSeekTooltip] = useState({ visible: false, x: 0, time: 0 });
    const [showSettings, setShowSettings] = useState(false);
    const [showKeyHelp, setShowKeyHelp] = useState(false);
    const [ripple, setRipple] = useState(null); // "left" | "right" | null
    const [toastMsg, setToastMsg] = useState("");

    // Subtitles
    const [subtitles, setSubtitles] = useState([]);
    const [activeSubtitle, setActiveSubtitle] = useState(-1);

    // ── Toast helper ──────────────────────────────────────────────────────────
    const toastTimer = useRef(null);
    const showToast = useCallback((msg) => {
        setToastMsg(msg);
        clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToastMsg(""), 1500);
    }, []);

    // ── Cleanup ───────────────────────────────────────────────────────────────
    useEffect(() => {
        return () => {
            clearInterval(heartbeatRef.current);
            clearTimeout(controlsTimerRef.current);
            clearTimeout(toastTimer.current);
            if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
            }
            const sid = sessionIdRef.current;
            if (sid) {
                navigator.sendBeacon(`${API}/stream/sessions/${sid}`, JSON.stringify({ _method: "DELETE" }));
                fetch(`${API}/stream/sessions/${sid}`, { method: "DELETE" }).catch(() => {});
            }
        };
    }, []);

    // ── Fetch media metadata (name) ───────────────────────────────────────────
    useEffect(() => {
        if (!id) return;
        fetch(`${API}/api/media/${encodeURIComponent(id)}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (!data) return;
                const file = data.file ?? data;
                const title = file.metadata?.title || file.parsed?.title || file.name || "Now Playing";
                const year = file.metadata?.year || file.parsed?.year || null;
                setMediaTitle(title);
                setMediaYear(year);
            })
            .catch(() => {});
    }, [id]);

    // ── Fetch subtitles ───────────────────────────────────────────────────────
    useEffect(() => {
        if (!id) return;
        fetch(`${API}/api/media/${encodeURIComponent(id)}/subtitles`)
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (data?.subtitles?.length) setSubtitles(data.subtitles);
            })
            .catch(() => {});
    }, [id]);

    // ── Init stream ───────────────────────────────────────────────────────────
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
                // info=1 not supported — fall back to direct stream URL
                const directUrl = `${API}/stream/video/${encodeURIComponent(mediaId)}`;
                await attachDirect(directUrl);
                return;
            }
            const info = await res.json();
            // If server returned HTML/non-JSON (doesn't support ?info=1), go direct
            if (!info || typeof info !== "object") {
                await attachDirect(`${API}/stream/video/${encodeURIComponent(mediaId)}`);
                return;
            }
            setStreamInfo(info);
            if (info.mode === "direct" || !info.mode) {
                await attachDirect(info.streamUrl || `${API}/stream/video/${encodeURIComponent(mediaId)}`);
            } else {
                sessionIdRef.current = info.sessionId;
                await attachHLS(info.hlsUrl, info.sessionId);
                startHeartbeat(info.sessionId);
            }
        } catch (err) {
            // Last resort: try direct stream
            try {
                await attachDirect(`${API}/stream/video/${encodeURIComponent(id)}`);
            } catch (err2) {
                setErrorMsg(err.message || "Failed to load stream");
                setStatus("error");
            }
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

        if (!Hls || !Hls.isSupported()) {
            if (video.canPlayType("application/vnd.apple.mpegurl")) {
                video.src = `${API}${manifestUrl}`;
                video.load();
                setStatus("playing");
                return;
            }
            throw new Error("HLS not supported. Use Safari or install hls.js.");
        }

        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }

        const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            startPosition: -1,
            maxBufferLength: 30,
            maxMaxBufferLength: 60,
            maxBufferSize: 60 * 1000 * 1000,
            fragLoadingMaxRetry: 4,
            fragLoadingRetryDelay: 500,
            manifestLoadingMaxRetry: 3,
            manifestLoadingRetryDelay: 1000,
        });

        hls.loadSource(`${API}${manifestUrl}`);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            setStatus("playing");
            video.play().catch(() => {});
        });

        hls.on(Hls.Events.ERROR, (_, data) => {
            if (data.fatal) {
                if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                    hls.startLoad();
                } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                    hls.recoverMediaError();
                } else {
                    setErrorMsg(`Playback error: ${data.details}`);
                    setStatus("error");
                }
            }
        });

        hlsRef.current = hls;
    }

    function startHeartbeat(sessionId) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = setInterval(async () => {
            try {
                await fetch(`${API}/stream/sessions/${sessionId}/ping`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ positionSec: videoRef.current?.currentTime || 0 }),
                });
            } catch {}
        }, 10_000);
    }

    // ── Video event listeners ─────────────────────────────────────────────────
    useEffect(() => {
        const v = videoRef.current;
        if (!v) return;

        const onTimeUpdate = () => {
            setCurrentTime(v.currentTime);
            if (v.buffered.length > 0) setBuffered(v.buffered.end(v.buffered.length - 1));
        };
        const onDuration = () => setDuration(v.duration || 0);
        const onPlay = () => setPaused(false);
        const onPause = () => setPaused(true);
        const onVolume = () => {
            setVolume(v.volume);
            setMuted(v.muted);
        };
        const onWaiting = () => setWaiting(true);
        const onCanPlay = () => setWaiting(false);
        const onEnded = () => setPaused(true);
        const onRateChange = () => setSpeed(v.playbackRate);
        const onPipEnter = () => setIsPip(true);
        const onPipExit = () => setIsPip(false);

        v.addEventListener("timeupdate", onTimeUpdate);
        v.addEventListener("durationchange", onDuration);
        v.addEventListener("play", onPlay);
        v.addEventListener("pause", onPause);
        v.addEventListener("volumechange", onVolume);
        v.addEventListener("waiting", onWaiting);
        v.addEventListener("canplay", onCanPlay);
        v.addEventListener("playing", onCanPlay);
        v.addEventListener("ended", onEnded);
        v.addEventListener("ratechange", onRateChange);
        v.addEventListener("enterpictureinpicture", onPipEnter);
        v.addEventListener("leavepictureinpicture", onPipExit);

        return () => {
            v.removeEventListener("timeupdate", onTimeUpdate);
            v.removeEventListener("durationchange", onDuration);
            v.removeEventListener("play", onPlay);
            v.removeEventListener("pause", onPause);
            v.removeEventListener("volumechange", onVolume);
            v.removeEventListener("waiting", onWaiting);
            v.removeEventListener("canplay", onCanPlay);
            v.removeEventListener("playing", onCanPlay);
            v.removeEventListener("ended", onEnded);
            v.removeEventListener("ratechange", onRateChange);
            v.removeEventListener("enterpictureinpicture", onPipEnter);
            v.removeEventListener("leavepictureinpicture", onPipExit);
        };
    }, [status]);

    // ── Subtitle track management ─────────────────────────────────────────────
    useEffect(() => {
        const v = videoRef.current;
        if (!v || subtitles.length === 0) return;

        // Remove existing added tracks
        const toRemove = Array.from(v.textTracks).filter((t) => t.label?.startsWith("FLUX_"));
        toRemove.forEach(() => {}); // can't remove text tracks directly, use <track> elements

        // Manage visibility of existing tracks
        Array.from(v.textTracks).forEach((t, i) => {
            t.mode = activeSubtitle === i ? "showing" : "hidden";
        });
    }, [activeSubtitle, subtitles]);

    // Apply subtitle tracks to video when subtitles list changes
    useEffect(() => {
        const v = videoRef.current;
        if (!v || subtitles.length === 0) return;

        // Remove old <track> elements added by us
        Array.from(v.querySelectorAll("track[data-flux]")).forEach((el) => el.remove());

        subtitles.forEach((sub, i) => {
            const track = document.createElement("track");
            track.setAttribute("data-flux", "1");
            track.kind = "subtitles";
            track.label = sub.filename || `Subtitle ${i + 1}`;
            track.src = `${API}${sub.url}`;
            track.default = false;
            v.appendChild(track);
        });
    }, [subtitles]);

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
            if (!videoRef.current?.paused && !showSettings) setShowControls(false);
        }, 3000);
    }, [showSettings]);

    // ── Playback controls ─────────────────────────────────────────────────────
    const togglePlay = useCallback(() => {
        const v = videoRef.current;
        if (!v) return;
        v.paused ? v.play() : v.pause();
    }, []);

    const skipSeconds = useCallback(
        (sec) => {
            const v = videoRef.current;
            if (!v) return;
            v.currentTime = clamp(v.currentTime + sec, 0, duration);
            setRipple(sec < 0 ? "left" : "right");
            showToast(sec < 0 ? `−${Math.abs(sec)}s` : `+${sec}s`);
        },
        [duration, showToast],
    );

    const toggleMute = useCallback(() => {
        const v = videoRef.current;
        if (!v) return;
        v.muted = !v.muted;
    }, []);

    const handleVolumeChange = useCallback((e) => {
        const v = videoRef.current;
        if (!v) return;
        const val = parseFloat(e.target.value);
        v.volume = val;
        v.muted = val === 0;
    }, []);

    const toggleFullscreen = useCallback(() => {
        const el = containerRef.current;
        if (!el) return;
        document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen();
    }, []);

    const togglePip = useCallback(async () => {
        const v = videoRef.current;
        if (!v) return;
        try {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
            } else if (document.pictureInPictureEnabled) {
                await v.requestPictureInPicture();
            }
        } catch {}
    }, []);

    const changeSpeed = useCallback(
        (s) => {
            const v = videoRef.current;
            if (!v) return;
            v.playbackRate = s;
            setSpeed(s);
            showToast(`${s}× speed`);
        },
        [showToast],
    );

    const handleSubtitleChange = useCallback(
        (idx) => {
            setActiveSubtitle(idx);
            const v = videoRef.current;
            if (!v) return;
            Array.from(v.textTracks).forEach((t, i) => {
                t.mode = i === idx ? "showing" : "hidden";
            });
            showToast(idx === -1 ? "Subtitles off" : `Subtitle: ${subtitles[idx]?.filename || "On"}`);
        },
        [subtitles, showToast],
    );

    // ── Seek bar interactions ─────────────────────────────────────────────────
    const getSeekRatio = useCallback((e) => {
        const bar = seekBarRef.current;
        if (!bar) return 0;
        const rect = bar.getBoundingClientRect();
        return clamp((e.clientX - rect.left) / rect.width, 0, 1);
    }, []);

    const handleSeekMouseMove = useCallback(
        (e) => {
            const bar = seekBarRef.current;
            if (!bar) return;
            const rect = bar.getBoundingClientRect();
            const ratio = clamp((e.clientX - rect.left) / rect.width, 0, 1);
            const time = ratio * duration;
            setSeekTooltip({ visible: true, x: e.clientX - rect.left, time });
            if (isDraggingRef.current && videoRef.current) {
                videoRef.current.currentTime = time;
                setCurrentTime(time);
            }
        },
        [duration],
    );

    const handleSeekMouseDown = useCallback(
        (e) => {
            isDraggingRef.current = true;
            const ratio = getSeekRatio(e);
            const time = ratio * duration;
            if (videoRef.current) {
                videoRef.current.currentTime = time;
                setCurrentTime(time);
            }
        },
        [duration, getSeekRatio],
    );

    const handleSeekMouseUp = useCallback((e) => {
        isDraggingRef.current = false;
    }, []);

    const handleSeekMouseLeave = useCallback(() => {
        isDraggingRef.current = false;
        setSeekTooltip((t) => ({ ...t, visible: false }));
    }, []);

    // Global mouse up to end drag even outside bar
    useEffect(() => {
        const up = () => {
            isDraggingRef.current = false;
        };
        window.addEventListener("mouseup", up);
        return () => window.removeEventListener("mouseup", up);
    }, []);

    // ── Keyboard shortcuts ────────────────────────────────────────────────────
    useEffect(() => {
        const onKey = (e) => {
            if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
            const v = videoRef.current;

            switch (e.code) {
                case "Space":
                case "KeyK":
                    e.preventDefault();
                    togglePlay();
                    break;
                case "ArrowRight":
                    e.preventDefault();
                    skipSeconds(10);
                    break;
                case "ArrowLeft":
                    e.preventDefault();
                    skipSeconds(-10);
                    break;
                case "ArrowUp":
                    e.preventDefault();
                    if (v) {
                        v.volume = clamp(v.volume + 0.1, 0, 1);
                        showToast(`Volume ${Math.round(v.volume * 100)}%`);
                    }
                    break;
                case "ArrowDown":
                    e.preventDefault();
                    if (v) {
                        v.volume = clamp(v.volume - 0.1, 0, 1);
                        showToast(`Volume ${Math.round(v.volume * 100)}%`);
                    }
                    break;
                case "KeyF":
                    toggleFullscreen();
                    break;
                case "KeyM":
                    toggleMute();
                    showToast(videoRef.current?.muted ? "Muted" : "Unmuted");
                    break;
                case "KeyP":
                    togglePip();
                    break;
                case "Comma":
                    if (e.shiftKey) {
                        const idx = SPEEDS.indexOf(speed);
                        if (idx > 0) changeSpeed(SPEEDS[idx - 1]);
                    }
                    break;
                case "Period":
                    if (e.shiftKey) {
                        const idx = SPEEDS.indexOf(speed);
                        if (idx < SPEEDS.length - 1) changeSpeed(SPEEDS[idx + 1]);
                    }
                    break;
                case "Slash":
                    if (e.shiftKey) setShowKeyHelp((v) => !v);
                    break;
                case "Escape":
                    setShowSettings(false);
                    setShowKeyHelp(false);
                    break;
            }
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [duration, speed, togglePlay, skipSeconds, toggleMute, toggleFullscreen, togglePip, changeSpeed, showToast]);

    // ── Double-click zones (MX style) ─────────────────────────────────────────
    const handleZoneDoubleClick = useCallback(
        (side) => {
            skipSeconds(side === "left" ? -10 : 10);
        },
        [skipSeconds],
    );

    // ── Derived values ────────────────────────────────────────────────────────
    const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
    const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0;
    const isHLS = streamInfo?.mode === "hls";
    const isLoading = status === "loading" || (waiting && status !== "error");

    const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

    return (
        <>
            {/* Global animation styles */}
            <style>{`
                @keyframes rippleFade {
                    0%   { opacity: 1; transform: scale(0.8); }
                    50%  { opacity: 1; transform: scale(1); }
                    100% { opacity: 0; transform: scale(1.1); }
                }
                @keyframes toastIn {
                    from { opacity: 0; transform: translateX(-50%) translateY(4px); }
                    to   { opacity: 1; transform: translateX(-50%) translateY(0); }
                }
                .seek-bar-thumb {
                    position: absolute;
                    top: 50%;
                    transform: translate(-50%, -50%);
                    width: 14px;
                    height: 14px;
                    border-radius: 50%;
                    background: var(--color-primary, #e5a00d);
                    box-shadow: 0 0 0 3px rgba(255,255,255,0.2);
                    opacity: 0;
                    transition: opacity 0.15s;
                    pointer-events: none;
                }
                .seek-bar-container:hover .seek-bar-thumb { opacity: 1; }
                .volume-slider {
                    -webkit-appearance: none;
                    appearance: none;
                    height: 4px;
                    border-radius: 2px;
                    background: linear-gradient(
                        to right,
                        var(--color-primary, #e5a00d) 0%,
                        var(--color-primary, #e5a00d) var(--vol-pct, 100%),
                        rgba(255,255,255,0.2) var(--vol-pct, 100%)
                    );
                    cursor: pointer;
                    outline: none;
                }
                .volume-slider::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    width: 12px; height: 12px;
                    border-radius: 50%;
                    background: white;
                    cursor: pointer;
                    box-shadow: 0 1px 4px rgba(0,0,0,0.4);
                }
                .volume-slider::-moz-range-thumb {
                    width: 12px; height: 12px;
                    border-radius: 50%;
                    background: white;
                    cursor: pointer;
                    border: none;
                }
            `}</style>

            <div
                ref={containerRef}
                className="relative w-full h-screen bg-black flex items-center justify-center select-none overflow-hidden"
                onMouseMove={resetControlsTimer}
                style={{ cursor: showControls ? "default" : "none" }}>
                {/* ── Video ───────────────────────────────────────────────── */}
                <video ref={videoRef} className="w-full h-full object-contain" playsInline preload="auto" crossOrigin="anonymous" />

                {/* ── MX-style double-click seek zones ─────────────────── */}
                {status !== "error" && !showControls && (
                    <>
                        <div className="absolute left-0 top-0 bottom-0 w-1/3 z-10" onClick={togglePlay} onDoubleClick={() => handleZoneDoubleClick("left")} />
                        <div className="absolute right-0 top-0 bottom-0 w-1/3 z-10" onClick={togglePlay} onDoubleClick={() => handleZoneDoubleClick("right")} />
                        <div className="absolute inset-x-1/3 top-0 bottom-0 z-10" onClick={togglePlay} />
                    </>
                )}

                {/* ── Seek ripple ──────────────────────────────────────── */}
                {ripple && <SeekRipple side={ripple} onDone={() => setRipple(null)} />}

                {/* ── Toast ────────────────────────────────────────────── */}
                {toastMsg && (
                    <div
                        className="absolute bottom-28 left-1/2 px-4 py-1.5 rounded-full text-white text-sm font-semibold pointer-events-none z-50"
                        style={{
                            background: "rgba(0,0,0,0.75)",
                            backdropFilter: "blur(8px)",
                            animation: "toastIn 0.2s ease-out",
                            transform: "translateX(-50%)",
                        }}>
                        {toastMsg}
                    </div>
                )}

                {/* ── Loading overlay ──────────────────────────────────── */}
                {isLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 pointer-events-none z-20">
                        <div className="flex flex-col items-center gap-3">
                            <Loader size={44} className="text-primary animate-spin" />
                            <p className="text-white/60 text-sm">{status === "loading" ? (isHLS ? "Starting transcoder…" : "Loading stream…") : "Buffering…"}</p>
                        </div>
                    </div>
                )}

                {/* ── Error overlay ─────────────────────────────────────── */}
                {status === "error" && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/85 z-30">
                        <div className="text-center max-w-sm px-6 py-8 rounded-2xl border border-red-500/20" style={{ background: "rgba(10,10,15,0.95)" }}>
                            <AlertCircle size={44} className="text-red-500 mx-auto mb-4" />
                            <p className="text-white font-semibold text-lg mb-2">Playback Error</p>
                            <p className="text-white/50 text-sm mb-6 leading-relaxed">{errorMsg}</p>
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

                {/* ── Keyboard help overlay ─────────────────────────────── */}
                {showKeyHelp && <KeyboardHelp onClose={() => setShowKeyHelp(false)} />}

                {/* ── Settings menu ─────────────────────────────────────── */}
                {showSettings && (
                    <SettingsMenu
                        speed={speed}
                        onSpeedChange={changeSpeed}
                        subtitles={subtitles}
                        activeSubtitle={activeSubtitle}
                        onSubtitleChange={handleSubtitleChange}
                        onClose={() => setShowSettings(false)}
                    />
                )}

                {/* ── Controls overlay ──────────────────────────────────── */}
                {status !== "error" && (
                    <div
                        className="absolute inset-0 flex flex-col justify-between z-20"
                        style={{
                            opacity: showControls ? 1 : 0,
                            transition: "opacity 0.3s ease",
                            pointerEvents: showControls ? "auto" : "none",
                        }}>
                        {/* ── Top bar ──────────────────────────────────── */}
                        <div
                            className="flex items-center gap-3 px-5 py-5"
                            style={{
                                background: "linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, transparent 100%)",
                            }}>
                            <button className="w-9 h-9 flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-all" onClick={() => navigate(-1)}>
                                <ArrowLeft size={20} />
                            </button>

                            <div className="flex-1 min-w-0">
                                <p className="text-white font-semibold text-base truncate leading-tight">{mediaTitle || streamInfo?.title || "Now Playing"}</p>
                                <div className="flex items-center gap-2 mt-0.5">
                                    {mediaYear && <span className="text-white/40 text-xs">{mediaYear}</span>}
                                    {isHLS && <span className="text-[10px] bg-primary/20 text-primary px-2 py-0.5 rounded-full font-semibold">HLS · TRANSCODED</span>}
                                    {speed !== 1 && <span className="text-[10px] bg-white/10 text-white/70 px-2 py-0.5 rounded-full font-semibold">{speed}×</span>}
                                </div>
                            </div>

                            {/* Top-right actions */}
                            <div className="flex items-center gap-1">
                                <button
                                    className="w-9 h-9 flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-all"
                                    onClick={() => setShowKeyHelp(true)}
                                    title="Keyboard shortcuts (?)">
                                    <Keyboard size={18} />
                                </button>
                                {document.pictureInPictureEnabled && (
                                    <button
                                        className={`w-9 h-9 flex items-center justify-center rounded-full transition-all ${
                                            isPip ? "text-primary bg-primary/15" : "text-white/60 hover:text-white hover:bg-white/10"
                                        }`}
                                        onClick={togglePip}
                                        title="Picture-in-Picture (P)">
                                        <PictureInPicture2 size={18} />
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* ── Center click zone ─────────────────────────── */}
                        <div className="flex-1" onClick={togglePlay} />

                        {/* ── Bottom controls ───────────────────────────── */}
                        <div
                            className="px-4 pb-5 pt-10"
                            style={{
                                background: "linear-gradient(to top, rgba(0,0,0,0.9) 0%, transparent 100%)",
                            }}>
                            {/* ── Seek bar ─────────────────────────────── */}
                            <div
                                ref={seekBarRef}
                                className="seek-bar-container relative h-6 flex items-center cursor-pointer mb-1 group"
                                onMouseDown={handleSeekMouseDown}
                                onMouseMove={handleSeekMouseMove}
                                onMouseUp={handleSeekMouseUp}
                                onMouseLeave={handleSeekMouseLeave}>
                                {/* Track */}
                                <div className="relative w-full h-1 group-hover:h-1.5 transition-all duration-150 rounded-full overflow-hidden bg-white/15">
                                    {/* Buffered */}
                                    <div className="absolute top-0 left-0 h-full bg-white/25 rounded-full pointer-events-none transition-all" style={{ width: `${bufferedPct}%` }} />
                                    {/* Played */}
                                    <div
                                        className="absolute top-0 left-0 h-full rounded-full pointer-events-none transition-all"
                                        style={{ width: `${progressPct}%`, background: "var(--color-primary, #e5a00d)" }}
                                    />
                                </div>

                                {/* Thumb */}
                                <div className="seek-bar-thumb" style={{ left: `${progressPct}%` }} />

                                {/* Seek tooltip */}
                                {seekTooltip.visible && duration > 0 && (
                                    <div
                                        className="absolute bottom-7 px-2 py-1 rounded-md text-white text-xs font-mono font-semibold pointer-events-none"
                                        style={{
                                            background: "rgba(0,0,0,0.85)",
                                            left: clamp(seekTooltip.x, 20, (seekBarRef.current?.clientWidth || 300) - 20),
                                            transform: "translateX(-50%)",
                                        }}>
                                        {fmtTime(seekTooltip.time)}
                                    </div>
                                )}
                            </div>

                            {/* ── Controls row ─────────────────────────── */}
                            <div className="flex items-center gap-1 mt-1">
                                {/* Skip back */}
                                <button
                                    className="w-9 h-9 flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-all"
                                    onClick={() => skipSeconds(-10)}
                                    title="Rewind 10s (←)">
                                    <SkipBack size={18} />
                                </button>

                                {/* Play/Pause */}
                                <button className="w-10 h-10 flex items-center justify-center rounded-full text-white hover:bg-white/10 transition-all" onClick={togglePlay} title="Play/Pause (Space)">
                                    {paused ? <Play size={22} fill="currentColor" /> : <Pause size={22} fill="currentColor" />}
                                </button>

                                {/* Skip forward */}
                                <button
                                    className="w-9 h-9 flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-all"
                                    onClick={() => skipSeconds(10)}
                                    title="Forward 10s (→)">
                                    <SkipForward size={18} />
                                </button>

                                {/* Volume */}
                                <div className="flex items-center gap-2 ml-1 group/vol">
                                    <button
                                        className="w-9 h-9 flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-all shrink-0"
                                        onClick={toggleMute}
                                        title="Mute (M)">
                                        <VolumeIcon size={18} />
                                    </button>
                                    <div className="w-0 group-hover/vol:w-20 overflow-hidden transition-all duration-200">
                                        <input
                                            type="range"
                                            min="0"
                                            max="1"
                                            step="0.02"
                                            value={muted ? 0 : volume}
                                            onChange={handleVolumeChange}
                                            className="volume-slider w-20"
                                            style={{ "--vol-pct": `${(muted ? 0 : volume) * 100}%` }}
                                        />
                                    </div>
                                </div>

                                {/* Time */}
                                <span className="text-white/55 text-xs font-mono ml-1 shrink-0 tabular-nums">
                                    {fmtTime(currentTime)}
                                    <span className="text-white/30 mx-1">/</span>
                                    {fmtTime(duration)}
                                </span>

                                {/* Spacer */}
                                <div className="flex-1" />

                                {/* Subtitle quick toggle (if available) */}
                                {subtitles.length > 0 && (
                                    <button
                                        className={`w-9 h-9 flex items-center justify-center rounded-full transition-all ${
                                            activeSubtitle >= 0 ? "text-primary bg-primary/15" : "text-white/60 hover:text-white hover:bg-white/10"
                                        }`}
                                        onClick={() => handleSubtitleChange(activeSubtitle >= 0 ? -1 : 0)}
                                        title="Subtitles">
                                        <Subtitles size={18} />
                                    </button>
                                )}

                                {/* Settings */}
                                <button
                                    className={`w-9 h-9 flex items-center justify-center rounded-full transition-all ${
                                        showSettings ? "text-primary bg-primary/15" : "text-white/60 hover:text-white hover:bg-white/10"
                                    }`}
                                    onClick={() => setShowSettings((v) => !v)}
                                    title="Settings">
                                    <Settings size={18} />
                                </button>

                                {/* Fullscreen */}
                                <button
                                    className="w-9 h-9 flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-all"
                                    onClick={toggleFullscreen}
                                    title="Fullscreen (F)">
                                    {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}
