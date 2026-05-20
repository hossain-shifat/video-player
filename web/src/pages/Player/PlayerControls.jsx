import { useState, useCallback, useEffect, useRef } from "react";
import { ChevronLeft, Play, Pause, RotateCcw, RotateCw, Volume2, VolumeX, Volume1, Maximize, Minimize, Subtitles, Gauge, Settings, Film, Tv } from "lucide-react";
import { usePlayerState } from "./UsePlayerState";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) return "0:00";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
}

/** Extract the farthest buffered end that contains currentTime. */
function getBufferedPct(buffered, currentTime, duration) {
    if (!buffered || !buffered.length || !duration) return 0;
    for (let i = buffered.length - 1; i >= 0; i--) {
        if (buffered.start(i) <= currentTime) {
            return buffered.end(i) / duration;
        }
    }
    return 0;
}

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

// ─── SeekBar ──────────────────────────────────────────────────────────────────

function SeekBar({ currentTime, duration, buffered, onSeek, onInteract }) {
    const barRef = useRef(null);
    const [hovering, setHovering] = useState(false);
    const [hoverTime, setHoverTime] = useState(0);
    const [hoverX, setHoverX] = useState(0);
    const dragging = useRef(false);

    const getTimeFromEvent = useCallback(
        (e) => {
            const rect = barRef.current?.getBoundingClientRect();
            if (!rect || !duration) return 0;
            const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
            const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
            return (x / rect.width) * duration;
        },
        [duration],
    );

    const handleDown = (e) => {
        dragging.current = true;
        const t = getTimeFromEvent(e);
        onSeek(t);
        onInteract?.();
    };

    const handleMove = (e) => {
        const rect = barRef.current?.getBoundingClientRect();
        if (!rect) return;
        const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
        const x = clientX - rect.left;
        setHoverX(x);
        setHoverTime(getTimeFromEvent(e));
        if (dragging.current) {
            onSeek(getTimeFromEvent(e));
            onInteract?.();
        }
    };

    const handleUp = (e) => {
        if (dragging.current) {
            dragging.current = false;
            onSeek(getTimeFromEvent(e));
        }
    };

    const pct = duration > 0 ? (currentTime / duration) * 100 : 0;
    const buffPct = getBufferedPct(buffered, currentTime, duration) * 100;

    return (
        <div
            ref={barRef}
            className="relative w-full cursor-pointer select-none"
            style={{ height: hovering ? 20 : 14, transition: "height 0.15s" }}
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => {
                setHovering(false);
                dragging.current = false;
            }}
            onMouseDown={handleDown}
            onMouseMove={handleMove}
            onMouseUp={handleUp}
            onTouchStart={handleDown}
            onTouchMove={handleMove}
            onTouchEnd={handleUp}>
            {/* Track */}
            <div className="absolute inset-y-0 inset-x-0 flex items-center">
                <div
                    className="relative w-full rounded-full overflow-hidden"
                    style={{
                        height: hovering ? 6 : 4,
                        transition: "height 0.15s",
                        background: "rgba(255,255,255,0.2)",
                    }}>
                    {/* Buffered */}
                    <div className="absolute inset-y-0 left-0 bg-white/30 rounded-full" style={{ width: `${buffPct}%` }} />
                    {/* Progress */}
                    <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: "oklch(58% 0.22 20)" }} />
                </div>
            </div>

            {/* Thumb */}
            <div
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full bg-white shadow-md"
                style={{
                    left: `${pct}%`,
                    width: hovering ? 16 : 0,
                    height: hovering ? 16 : 0,
                    opacity: hovering ? 1 : 0,
                    transition: "width 0.15s, height 0.15s, opacity 0.15s",
                }}
            />

            {/* Hover tooltip */}
            {hovering && (
                <div
                    className="absolute bottom-5 bg-black/80 text-white text-xs px-2 py-0.5 rounded pointer-events-none"
                    style={{
                        left: Math.max(20, Math.min(hoverX, (barRef.current?.offsetWidth || 0) - 20)),
                        transform: "translateX(-50%)",
                    }}>
                    {formatTime(hoverTime)}
                </div>
            )}
        </div>
    );
}

// ─── PlayerControls ───────────────────────────────────────────────────────────
/**
 * PlayerControls
 *
 * Renders the top bar (title / back) and bottom controls (seek bar + buttons).
 * All player state is consumed from usePlayerState — no individual state props.
 *
 * Props:
 *   mediaInfo      — { title, type, season, episode, poster }
 *   videoRef       — ref to <video> for direct seek writes
 *   containerRef   — ref to player root for fullscreen API
 *   subtitles      — array of subtitle track objects { url, filename, label }
 *   onBack         — fn() navigate back
 *   onShowControls — fn() resets the auto-hide timer (called on any interaction)
 */
export default function PlayerControls({ mediaInfo, videoRef, containerRef, subtitles = [], onBack, onShowControls }) {
    const { state, actions } = usePlayerState();
    const { playing, currentTime, duration, buffered, volume, muted, isFullscreen, playbackSpeed, controlsVisible, isLocked, activeSubtitle, qualityLevels, activeQuality } = state;

    const [showSpeed, setShowSpeed] = useState(false);
    const [showSubMenu, setShowSubMenu] = useState(false);
    const [showQuality, setShowQuality] = useState(false);
    const [showVolSlider, setShowVolSlider] = useState(false);

    const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
    const MediaIcon = mediaInfo?.type === "series" || mediaInfo?.type === "anime" ? Tv : Film;

    const visible = controlsVisible && !isLocked;

    const closeMenus = () => {
        setShowSpeed(false);
        setShowSubMenu(false);
        setShowQuality(false);
    };

    const interact = useCallback(() => onShowControls?.(), [onShowControls]);

    // ── Fullscreen ────────────────────────────────────────────────────────────

    const toggleFullscreen = useCallback(() => {
        const container = containerRef?.current;
        if (!container) return;
        if (!document.fullscreenElement) {
            container.requestFullscreen().catch(() => {});
        } else {
            document.exitFullscreen().catch(() => {});
        }
        interact();
    }, [containerRef, interact]);

    // Sync fullscreen state from browser events (e.g. Esc key)
    useEffect(() => {
        const handler = () => actions.setFullscreen(!!document.fullscreenElement);
        document.addEventListener("fullscreenchange", handler);
        return () => document.removeEventListener("fullscreenchange", handler);
    }, [actions]);

    // ── Seek ──────────────────────────────────────────────────────────────────

    const seek = useCallback(
        (pos) => {
            const video = videoRef.current;
            if (!video) return;
            const clamped = Math.max(0, Math.min(pos, duration));
            video.currentTime = clamped;
            actions.setCurrentTime(clamped);
        },
        [videoRef, duration, actions],
    );

    const seekBy = useCallback(
        (delta) => {
            const video = videoRef.current;
            if (!video) return;
            const clamped = Math.max(0, Math.min(video.currentTime + delta, duration));
            video.currentTime = clamped;
            actions.setCurrentTime(clamped);
        },
        [videoRef, duration, actions],
    );

    // ── Quality label ─────────────────────────────────────────────────────────

    const qualityLabel = activeQuality === -1 ? "Auto" : (qualityLevels[activeQuality]?.label ?? "Auto");

    // ── Subtitle display name ─────────────────────────────────────────────────

    const subLabel = (s) => s?.filename || s?.label || "Track";

    // ── Episode subtitle line ─────────────────────────────────────────────────

    const episodeLine = mediaInfo?.season && mediaInfo?.episode ? `Season ${mediaInfo.season} · Episode ${mediaInfo.episode}` : null;

    // ─────────────────────────────────────────────────────────────────────────

    return (
        <>
            {/* ── Top bar ──────────────────────────────────────────────────── */}
            <div
                className="absolute top-0 inset-x-0 z-20 transition-all duration-300"
                style={{
                    opacity: visible ? 1 : 0,
                    transform: visible ? "translateY(0)" : "translateY(-8px)",
                    pointerEvents: visible ? "auto" : "none",
                }}>
                {/* Top gradient */}
                <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/30 to-transparent pointer-events-none" />

                <div className="relative z-10 flex items-center gap-3 px-4 pt-4 pb-8">
                    <button
                        onClick={onBack}
                        className="w-9 h-9 rounded-full bg-black/30 backdrop-blur-sm
                                   flex items-center justify-center active:scale-90
                                   transition-transform border border-white/10"
                        aria-label="Back">
                        <ChevronLeft size={20} className="text-white" />
                    </button>

                    <div className="flex-1 min-w-0">
                        <p className="text-white font-semibold text-base leading-tight truncate">{mediaInfo?.title || "Playing"}</p>
                        {episodeLine && <p className="text-white/55 text-xs mt-0.5 truncate">{episodeLine}</p>}
                    </div>

                    <div className="shrink-0 text-white/30">
                        <MediaIcon size={18} />
                    </div>
                </div>
            </div>

            {/* ── Bottom controls ───────────────────────────────────────────── */}
            <div
                className="absolute bottom-0 inset-x-0 z-20 transition-all duration-300"
                style={{
                    opacity: visible ? 1 : 0,
                    transform: visible ? "translateY(0)" : "translateY(8px)",
                    pointerEvents: visible ? "auto" : "none",
                }}>
                {/* Bottom gradient */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent pointer-events-none" />

                <div className="relative z-10 px-4 pb-4 pt-8 flex flex-col gap-2">
                    {/* Seek bar */}
                    <SeekBar currentTime={currentTime} duration={duration} buffered={buffered} onSeek={seek} onInteract={interact} />

                    {/* Controls row */}
                    <div className="flex items-center justify-between gap-2">
                        {/* ── Left group ─────────────────────────────────── */}
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => {
                                    seekBy(-10);
                                    interact();
                                }}
                                className="text-white/80 hover:text-white active:scale-90 transition-transform"
                                aria-label="Seek back 10s">
                                <RotateCcw size={20} />
                            </button>

                            <button
                                onClick={() => {
                                    actions.setPlaying(!playing);
                                    interact();
                                }}
                                className="w-9 h-9 flex items-center justify-center rounded-full
                                           bg-white/15 hover:bg-white/25 active:scale-90 transition-all"
                                aria-label={playing ? "Pause" : "Play"}>
                                {playing ? <Pause size={18} className="text-white" /> : <Play size={18} className="text-white ml-0.5" />}
                            </button>

                            <button
                                onClick={() => {
                                    seekBy(10);
                                    interact();
                                }}
                                className="text-white/80 hover:text-white active:scale-90 transition-transform"
                                aria-label="Seek forward 10s">
                                <RotateCw size={20} />
                            </button>

                            {/* Volume */}
                            <div className="relative flex items-center gap-1.5" onMouseEnter={() => setShowVolSlider(true)} onMouseLeave={() => setShowVolSlider(false)}>
                                <button
                                    onClick={() => {
                                        actions.setMuted(!muted);
                                        interact();
                                    }}
                                    className="text-white/80 hover:text-white"
                                    aria-label="Toggle mute">
                                    <VolumeIcon size={20} />
                                </button>
                                <div className="overflow-hidden transition-all duration-200" style={{ width: showVolSlider ? 72 : 0, opacity: showVolSlider ? 1 : 0 }}>
                                    <input
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.02"
                                        value={muted ? 0 : volume}
                                        onChange={(e) => {
                                            actions.setVolume(parseFloat(e.target.value));
                                            interact();
                                        }}
                                        className="accent-primary h-1"
                                        style={{ width: 72 }}
                                    />
                                </div>
                            </div>

                            {/* Time */}
                            <span className="text-white/70 text-xs font-medium tabular-nums whitespace-nowrap">
                                {formatTime(currentTime)} / {formatTime(duration)}
                            </span>
                        </div>

                        {/* ── Right group ────────────────────────────────── */}
                        <div className="flex items-center gap-2 relative">
                            {/* Playback speed */}
                            <div className="relative">
                                <button
                                    onClick={() => {
                                        setShowSpeed((v) => !v);
                                        setShowSubMenu(false);
                                        setShowQuality(false);
                                        interact();
                                    }}
                                    className="flex items-center gap-1 text-white/70 hover:text-white
                                               text-xs font-medium px-2 py-1 rounded hover:bg-white/10"
                                    aria-label="Playback speed">
                                    <Gauge size={16} />
                                    <span>{playbackSpeed}x</span>
                                </button>

                                {showSpeed && (
                                    <div
                                        className="absolute bottom-10 right-0 bg-neutral/95 backdrop-blur
                                                    rounded-xl overflow-hidden border border-white/10 shadow-xl min-w-[80px]">
                                        {RATES.map((r) => (
                                            <button
                                                key={r}
                                                onClick={() => {
                                                    actions.setPlaybackSpeed(r);
                                                    setShowSpeed(false);
                                                    interact();
                                                }}
                                                className={`block w-full text-right px-4 py-2 text-sm
                                                            hover:bg-white/10 transition-colors
                                                            ${playbackSpeed === r ? "text-primary font-bold" : "text-white/80"}`}>
                                                {r}x
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Subtitles */}
                            {subtitles.length > 0 && (
                                <div className="relative">
                                    <button
                                        onClick={() => {
                                            setShowSubMenu((v) => !v);
                                            setShowSpeed(false);
                                            setShowQuality(false);
                                            interact();
                                        }}
                                        className={`p-1 rounded hover:bg-white/10
                                                    ${activeSubtitle ? "text-primary" : "text-white/70 hover:text-white"}`}
                                        aria-label="Subtitles">
                                        <Subtitles size={18} />
                                    </button>

                                    {showSubMenu && (
                                        <div
                                            className="absolute bottom-10 right-0 bg-neutral/95 backdrop-blur
                                                        rounded-xl overflow-hidden border border-white/10 shadow-xl min-w-[140px]">
                                            <button
                                                onClick={() => {
                                                    actions.setActiveSubtitle(null);
                                                    setShowSubMenu(false);
                                                    interact();
                                                }}
                                                className={`block w-full text-left px-4 py-2 text-sm hover:bg-white/10
                                                            ${!activeSubtitle ? "text-primary font-semibold" : "text-white/80"}`}>
                                                Off
                                            </button>
                                            {subtitles.map((s) => (
                                                <button
                                                    key={s.url}
                                                    onClick={() => {
                                                        actions.setActiveSubtitle(s);
                                                        setShowSubMenu(false);
                                                        interact();
                                                    }}
                                                    className={`block w-full text-left px-4 py-2 text-sm
                                                                hover:bg-white/10 truncate
                                                                ${activeSubtitle?.url === s.url ? "text-primary font-semibold" : "text-white/80"}`}>
                                                    {subLabel(s)}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Quality (HLS levels only) */}
                            {qualityLevels.length > 0 && (
                                <div className="relative">
                                    <button
                                        onClick={() => {
                                            setShowQuality((v) => !v);
                                            setShowSpeed(false);
                                            setShowSubMenu(false);
                                            interact();
                                        }}
                                        className="flex items-center gap-1 text-white/70 hover:text-white
                                                   text-xs font-medium px-2 py-1 rounded hover:bg-white/10"
                                        aria-label="Quality">
                                        <Settings size={14} />
                                        <span>{qualityLabel}</span>
                                    </button>

                                    {showQuality && (
                                        <div
                                            className="absolute bottom-10 right-0 bg-neutral/95 backdrop-blur
                                                        rounded-xl overflow-hidden border border-white/10 shadow-xl min-w-[80px]">
                                            {/* Auto */}
                                            <button
                                                onClick={() => {
                                                    actions.setActiveQuality(-1);
                                                    setShowQuality(false);
                                                    interact();
                                                }}
                                                className={`block w-full text-right px-4 py-2 text-sm hover:bg-white/10
                                                            ${activeQuality === -1 ? "text-primary font-bold" : "text-white/80"}`}>
                                                Auto
                                            </button>
                                            {qualityLevels.map((q) => (
                                                <button
                                                    key={q.index}
                                                    onClick={() => {
                                                        actions.setActiveQuality(q.index);
                                                        setShowQuality(false);
                                                        interact();
                                                    }}
                                                    className={`block w-full text-right px-4 py-2 text-sm hover:bg-white/10
                                                                ${activeQuality === q.index ? "text-primary font-bold" : "text-white/80"}`}>
                                                    {q.label}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Fullscreen */}
                            <button onClick={toggleFullscreen} className="text-white/80 hover:text-white p-1 rounded hover:bg-white/10" aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}>
                                {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Backdrop to close menus on outside click */}
                {(showSpeed || showSubMenu || showQuality) && <div className="fixed inset-0 z-0" onClick={closeMenus} />}
            </div>
        </>
    );
}
