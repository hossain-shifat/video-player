import { useState, useRef, useCallback, useEffect } from "react";
import {
    Play, Pause, SkipBack, SkipForward,
    Volume2, VolumeX, Volume1,
    Maximize, Minimize, PictureInPicture2,
    Subtitles, ChevronLeft, Lock,
    MonitorPlay, Headphones, Check,
    Gauge, Repeat, Repeat1, RotateCcw,
    Zap, Sun, Moon,
} from "lucide-react";
import { usePlayerState } from "./UsePlayerState";
import { useIsMobile } from "./useIsMobile";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(secs) {
    if (!secs || !isFinite(secs) || isNaN(secs)) return "0:00";
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
}

function bitrateLabel(bps) {
    if (!bps) return "";
    if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`;
    return `${Math.round(bps / 1000)} Kbps`;
}

const AUDIO_FLAGS = {
    English: "🇬🇧", Hindi: "🇮🇳", Bangla: "🇧🇩", Japanese: "🇯🇵",
    French: "🇫🇷", Spanish: "🇪🇸", Arabic: "🇸🇦", German: "🇩🇪",
    Korean: "🇰🇷", Chinese: "🇨🇳", Russian: "🇷🇺", Italian: "🇮🇹",
    Portuguese: "🇧🇷", Turkish: "🇹🇷",
};

function langAbbr(name) {
    if (!name) return "AUD";
    return name.slice(0, 3).toUpperCase();
}

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const ASPECT_LABELS = { auto: "Auto", fill: "Fill", "16:9": "16:9", "4:3": "4:3", "1:1": "1:1", stretch: "Stretch" };
const ASPECT_SHORT  = { auto: "A", fill: "F", "16:9": "W", "4:3": "4:3", "1:1": "1:1", stretch: "S" };

// ─── Seek Bar ────────────────────────────────────────────────────────────────

function SeekBar({ videoRef }) {
    const { state, actions } = usePlayerState();
    const barRef = useRef(null);
    const [dragging, setDragging] = useState(false);
    const [hoverTime, setHoverTime] = useState(null);
    const [hoverX, setHoverX] = useState(0);

    const getTimeFromX = (clientX) => {
        const rect = barRef.current?.getBoundingClientRect();
        if (!rect || !state.duration) return 0;
        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        return pct * state.duration;
    };

    const seekTo = (clientX) => {
        const t = getTimeFromX(clientX);
        if (!isFinite(t) || isNaN(t)) return;
        if (videoRef.current) videoRef.current.currentTime = t;
        actions.setCurrentTime(t);
    };

    const clientXFromEvent = (e) => (e.touches?.[0] ? e.touches[0].clientX : e.clientX);

    const handlePointerDown = (e) => {
        setDragging(true);
        seekTo(clientXFromEvent(e));
        e.preventDefault();
    };
    const handlePointerMove = (e) => {
        const cx = clientXFromEvent(e);
        const t = getTimeFromX(cx);
        const rect = barRef.current?.getBoundingClientRect();
        setHoverTime(t);
        setHoverX(cx - (rect?.left || 0));
        if (dragging) seekTo(cx);
    };
    const handlePointerUp = (e) => {
        if (dragging) seekTo(clientXFromEvent(e));
        setDragging(false);
    };

    useEffect(() => {
        if (!dragging) return;
        window.addEventListener("mouseup", handlePointerUp);
        window.addEventListener("mousemove", handlePointerMove);
        window.addEventListener("touchend", handlePointerUp);
        window.addEventListener("touchmove", handlePointerMove, { passive: false });
        return () => {
            window.removeEventListener("mouseup", handlePointerUp);
            window.removeEventListener("mousemove", handlePointerMove);
            window.removeEventListener("touchend", handlePointerUp);
            window.removeEventListener("touchmove", handlePointerMove);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dragging]);

    const playedPct = state.duration ? (state.currentTime / state.duration) * 100 : 0;

    let bufferedPct = 0;
    if (state.buffered && state.duration && state.buffered.length > 0) {
        for (let i = 0; i < state.buffered.length; i++) {
            if (state.buffered.start(i) <= state.currentTime && state.buffered.end(i) >= state.currentTime) {
                bufferedPct = (state.buffered.end(i) / state.duration) * 100;
                break;
            }
        }
    }

    return (
        <div className="relative w-full group/seek px-1 mb-2" style={{ paddingTop: 12, paddingBottom: 4 }}>
            {/* Hover timestamp */}
            {hoverTime !== null && (
                <div
                    className="absolute pointer-events-none z-10 px-2 py-1 rounded-md
                                bg-black/90 text-white text-xs font-mono shadow-lg"
                    style={{
                        bottom: "calc(100% - 4px)",
                        left: hoverX,
                        transform: "translateX(-50%)",
                        whiteSpace: "nowrap",
                    }}>
                    {formatTime(hoverTime)}
                </div>
            )}

            {/* Track */}
            <div
                ref={barRef}
                className="relative touch-none cursor-pointer"
                style={{
                    height: dragging ? 6 : 4,
                    background: "rgba(255,255,255,0.18)",
                    borderRadius: 99,
                    transition: "height 0.15s",
                }}
                onMouseDown={handlePointerDown}
                onMouseMove={handlePointerMove}
                onTouchStart={handlePointerDown}
                onTouchMove={handlePointerMove}
                onMouseLeave={() => setHoverTime(null)}>
                {/* Buffered */}
                <div
                    style={{
                        position: "absolute", inset: 0, left: 0,
                        width: `${bufferedPct}%`,
                        background: "rgba(255,255,255,0.28)",
                        borderRadius: 99,
                    }}
                />
                {/* Played */}
                <div
                    style={{
                        position: "absolute", inset: 0, left: 0,
                        width: `${playedPct}%`,
                        background: "linear-gradient(90deg, #e53e3e, #ff6b35)",
                        borderRadius: 99,
                    }}
                />
                {/* Thumb */}
                <div
                    style={{
                        position: "absolute",
                        top: "50%",
                        left: `${playedPct}%`,
                        transform: "translate(-50%, -50%)",
                        width: dragging ? 16 : 12,
                        height: dragging ? 16 : 12,
                        borderRadius: "50%",
                        background: "#fff",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.6)",
                        transition: "width 0.1s, height 0.1s",
                        opacity: dragging ? 1 : 0.9,
                    }}
                />
            </div>
        </div>
    );
}

// ─── Volume Control ───────────────────────────────────────────────────────────

function VolumeControl() {
    const { state, actions } = usePlayerState();
    const [expanded, setExpanded] = useState(false);

    const VIcon = state.muted || state.volume === 0 ? VolumeX
        : state.volume < 0.5 ? Volume1 : Volume2;

    return (
        <div
            className="flex items-center gap-1.5"
            onMouseEnter={() => setExpanded(true)}
            onMouseLeave={() => setExpanded(false)}>
            <button
                onClick={() => actions.setMuted(!state.muted)}
                className="p-1.5 rounded-lg text-white/70 hover:text-white
                           hover:bg-white/10 transition-all cursor-pointer">
                <VIcon size={18} strokeWidth={1.8} />
            </button>
            <div
                className="overflow-hidden transition-all duration-200"
                style={{ width: expanded ? 88 : 0, opacity: expanded ? 1 : 0 }}>
                <input
                    type="range" min={0} max={1} step={0.01}
                    value={state.muted ? 0 : state.volume}
                    onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        actions.setVolume(v);
                        if (v > 0) actions.setMuted(false);
                    }}
                    className="w-full cursor-pointer accent-red-500"
                    style={{ accentColor: "#e53e3e" }}
                />
            </div>
        </div>
    );
}

// ─── Popup Menu ───────────────────────────────────────────────────────────────

function PopupMenu({ open, onClose, children, align = "right", title: menuTitle }) {
    const ref = useRef(null);
    useEffect(() => {
        if (!open) return;
        const close = (e) => {
            if (ref.current && !ref.current.contains(e.target)) onClose();
        };
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
    }, [open, onClose]);

    if (!open) return null;
    return (
        <div
            ref={ref}
            className={`absolute bottom-full mb-3 ${align === "right" ? "right-0" : "left-0"}
                        min-w-[176px] rounded-2xl overflow-hidden shadow-2xl z-50
                        border border-white/10 py-2`}
            style={{
                background: "rgba(12, 12, 16, 0.96)",
                backdropFilter: "blur(20px)",
            }}>
            {menuTitle && (
                <div className="px-4 py-2.5 border-b border-white/8">
                    <span className="text-[10px] font-bold text-white/35 uppercase tracking-[0.15em]">{menuTitle}</span>
                </div>
            )}
            {children}
        </div>
    );
}

function PopupItem({ active, onClick, children, icon: Icon }) {
    return (
        <button
            onClick={onClick}
            className={`flex items-center gap-3 w-full px-4 py-2.5 text-sm text-left
                        transition-colors duration-100 cursor-pointer
                        ${active
                            ? "text-red-400 bg-red-500/10"
                            : "text-white/75 hover:bg-white/8 hover:text-white"}`}>
            {Icon && <Icon size={14} className="shrink-0 opacity-60" />}
            {children}
            {active && (
                <Check size={13} className="text-red-400 ml-auto shrink-0" />
            )}
        </button>
    );
}

// ─── Quality Picker ───────────────────────────────────────────────────────────

function QualityPicker({ open, onClose }) {
    const { state, actions } = usePlayerState();
    return (
        <PopupMenu open={open} onClose={onClose} title="Quality">
            <PopupItem
                active={state.activeQuality === -1}
                icon={Gauge}
                onClick={() => { actions.setActiveQuality(-1); onClose(); }}>
                <div>
                    <div>Auto</div>
                    <div className="text-[11px] text-white/35">Adaptive bitrate</div>
                </div>
            </PopupItem>
            {state.qualityLevels.map((lvl) => (
                <PopupItem
                    key={lvl.index}
                    active={state.activeQuality === lvl.index}
                    icon={MonitorPlay}
                    onClick={() => { actions.setActiveQuality(lvl.index); onClose(); }}>
                    <div>
                        <div>{lvl.label}</div>
                        {lvl.bitrate && <div className="text-[11px] text-white/35">{bitrateLabel(lvl.bitrate)}</div>}
                    </div>
                </PopupItem>
            ))}
        </PopupMenu>
    );
}

// ─── Audio Picker ─────────────────────────────────────────────────────────────

function AudioPicker({ open, onClose }) {
    const { state, actions } = usePlayerState();
    return (
        <PopupMenu open={open} onClose={onClose} title="Audio Track">
            {state.audioTracks.map((track) => (
                <PopupItem
                    key={track.index}
                    active={state.activeAudioTrack === track.index}
                    onClick={() => { actions.setActiveAudioTrack(track.index); onClose(); }}>
                    <span className="text-base leading-none">{AUDIO_FLAGS[track.name] || "🎵"}</span>
                    <div>
                        <div>{track.name}</div>
                        <div className="text-[11px] text-white/35 uppercase">{track.lang}</div>
                    </div>
                </PopupItem>
            ))}
        </PopupMenu>
    );
}

// ─── Speed Picker ─────────────────────────────────────────────────────────────

function SpeedPicker({ open, onClose }) {
    const { state, actions } = usePlayerState();
    return (
        <PopupMenu open={open} onClose={onClose} title="Playback Speed">
            {SPEEDS.map((s) => (
                <PopupItem
                    key={s}
                    active={state.playbackSpeed === s}
                    onClick={() => { actions.setPlaybackSpeed(s); onClose(); }}>
                    {s === 1 ? "Normal" : `${s}×`}
                </PopupItem>
            ))}
        </PopupMenu>
    );
}

// ─── Subtitle Picker ──────────────────────────────────────────────────────────

function SubtitlePicker({ open, onClose, subtitles }) {
    const { state, actions } = usePlayerState();
    return (
        <PopupMenu open={open} onClose={onClose} title="Subtitles">
            <PopupItem
                active={!state.activeSubtitle}
                onClick={() => { actions.setActiveSubtitle(null); onClose(); }}>
                Off
            </PopupItem>
            {subtitles.map((sub) => (
                <PopupItem
                    key={sub.url}
                    active={state.activeSubtitle?.url === sub.url}
                    onClick={() => { actions.setActiveSubtitle(sub); onClose(); }}>
                    {sub.filename}
                </PopupItem>
            ))}
        </PopupMenu>
    );
}

// ─── Aspect picker ────────────────────────────────────────────────────────────

function AspectPicker({ open, onClose }) {
    const { state, actions } = usePlayerState();
    return (
        <PopupMenu open={open} onClose={onClose} title="Aspect Ratio">
            {Object.entries(ASPECT_LABELS).map(([val, label]) => (
                <PopupItem
                    key={val}
                    active={state.aspectRatio === val}
                    onClick={() => { actions.setAspectRatio(val); onClose(); }}>
                    {label}
                </PopupItem>
            ))}
        </PopupMenu>
    );
}

// ─── Loop icon ────────────────────────────────────────────────────────────────

function LoopIcon({ loop }) {
    if (loop === "one") return <Repeat1 size={17} strokeWidth={1.8} />;
    if (loop === "all") return <Repeat size={17} strokeWidth={1.8} style={{ color: "#e53e3e" }} />;
    return <Repeat size={17} strokeWidth={1.8} />;
}

// ─── Icon Button ─────────────────────────────────────────────────────────────

function IconBtn({ onClick, active, children, size = "md", className = "", label }) {
    const p = size === "lg" ? "p-3.5" : size === "sm" ? "p-1.5" : "p-2";
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={label}
            className={`${p} rounded-xl flex items-center justify-center
                        transition-all duration-150 cursor-pointer
                        ${active
                            ? "text-red-400 bg-red-500/15"
                            : "text-white/75 hover:text-white hover:bg-white/10 active:scale-90"}
                        ${className}`}>
            {children}
        </button>
    );
}

// ─── PlayerControls ───────────────────────────────────────────────────────────

export default function PlayerControls({
    mediaInfo, videoRef, containerRef,
    subtitles = [], onBack, onShowControls,
}) {
    const { state, actions } = usePlayerState();
    const isMobile = useIsMobile();
    const [openMenu, setOpenMenu] = useState(null);

    const activeAudioName = state.audioTracks[state.activeAudioTrack]?.name || "";
    const activeQualityLabel = state.activeQuality === -1
        ? (state.qualityLevels.length ? "Auto" : "")
        : state.qualityLevels[state.activeQuality]?.label || "";

    const toggleMenu = (menu) => setOpenMenu((v) => v === menu ? null : menu);

    const seek = (delta) => {
        const v = videoRef.current;
        if (v) v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + delta));
    };

    const toggleFullscreen = () => containerRef.current?._toggleFullscreen?.();
    const togglePiP       = () => containerRef.current?._togglePiP?.();

    const title    = mediaInfo?.title || "";
    const subtitle = mediaInfo?.type === "series" && mediaInfo.season && mediaInfo.episode
        ? `S${mediaInfo.season}E${mediaInfo.episode}${mediaInfo.episodeTitle ? ` — ${mediaInfo.episodeTitle}` : ""}`
        : mediaInfo?.year ? String(mediaInfo.year) : "";

    // Sizes
    const iconMain = isMobile ? 30 : 26;
    const iconSub  = isMobile ? 22 : 18;
    const iconTiny = isMobile ? 20 : 16;

    // Hidden controls — show play/pause bubble on mobile
    if (!state.controlsVisible) {
        if (!isMobile) return null;
        return (
            <div className="absolute inset-0 z-30 pointer-events-none flex items-center justify-center">
                <button
                    type="button"
                    onClick={onShowControls}
                    className="pointer-events-auto p-5 rounded-full text-white
                               active:scale-90 transition-transform"
                    style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)" }}
                    aria-label="Show controls">
                    {state.playing
                        ? <Pause size={38} strokeWidth={2} fill="currentColor" />
                        : <Play  size={38} strokeWidth={2} fill="currentColor" />}
                </button>
            </div>
        );
    }

    return (
        <div className="absolute inset-0 z-30 flex flex-col justify-between pointer-events-none">
            {/* ── Top bar ────────────────────────────────────────────────────── */}
            <div
                className="pointer-events-auto flex items-start justify-between px-3 pt-3 pb-16"
                style={{
                    background: "linear-gradient(to bottom, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.3) 70%, transparent 100%)",
                }}>
                {/* Left: back + title */}
                <div className="flex items-center gap-2 min-w-0 flex-1">
                    <button
                        onClick={onBack}
                        className="p-2 rounded-xl text-white hover:bg-white/10 shrink-0
                                   transition-colors cursor-pointer active:scale-90">
                        <ChevronLeft size={22} strokeWidth={2.5} />
                    </button>
                    <div className="min-w-0 flex-1">
                        <p className="text-white font-semibold text-sm sm:text-base leading-tight truncate">
                            {title}
                        </p>
                        {subtitle && (
                            <p className="text-white/50 text-xs mt-0.5 truncate">{subtitle}</p>
                        )}
                    </div>
                </div>

                {/* Right: lock button */}
                <button
                    onClick={() => {
                        actions.setLocked(true);
                        actions.setControlsVisible(false);
                    }}
                    className="p-2 rounded-xl text-white/60 hover:text-white hover:bg-white/10
                               transition-colors cursor-pointer shrink-0 ml-2 active:scale-90">
                    <Lock size={18} strokeWidth={1.8} />
                </button>
            </div>

            {/* ── Center controls (desktop only) ─────────────────────────────── */}
            {!isMobile && (
                <div className="pointer-events-auto flex items-center justify-center gap-4">
                    <IconBtn onClick={() => seek(-30)} label="Back 30s">
                        <div className="flex flex-col items-center gap-0.5">
                            <RotateCcw size={22} strokeWidth={1.8} />
                            <span className="text-[9px] font-bold opacity-70">30</span>
                        </div>
                    </IconBtn>
                    <IconBtn onClick={() => seek(-10)} label="Back 10s">
                        <div className="flex flex-col items-center gap-0.5">
                            <SkipBack size={24} strokeWidth={1.8} />
                            <span className="text-[9px] font-bold opacity-70">10</span>
                        </div>
                    </IconBtn>
                    {/* Big play/pause */}
                    <button
                        type="button"
                        onClick={() => actions.setPlaying(!state.playing)}
                        className="w-16 h-16 rounded-full flex items-center justify-center
                                   text-white cursor-pointer active:scale-90 transition-transform"
                        style={{
                            background: "rgba(229, 62, 62, 0.9)",
                            boxShadow: "0 0 32px rgba(229, 62, 62, 0.4)",
                        }}>
                        {state.playing
                            ? <Pause size={30} strokeWidth={2} fill="currentColor" />
                            : <Play  size={30} strokeWidth={2} fill="currentColor" style={{ marginLeft: 2 }} />}
                    </button>
                    <IconBtn onClick={() => seek(10)} label="Forward 10s">
                        <div className="flex flex-col items-center gap-0.5">
                            <SkipForward size={24} strokeWidth={1.8} />
                            <span className="text-[9px] font-bold opacity-70">10</span>
                        </div>
                    </IconBtn>
                    <IconBtn onClick={() => seek(30)} label="Forward 30s">
                        <div className="flex flex-col items-center gap-0.5">
                            <RotateCcw size={22} strokeWidth={1.8} style={{ transform: "scaleX(-1)" }} />
                            <span className="text-[9px] font-bold opacity-70">30</span>
                        </div>
                    </IconBtn>
                </div>
            )}

            {/* ── Bottom bar ─────────────────────────────────────────────────── */}
            <div
                className="pointer-events-auto px-3 pt-16 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
                style={{
                    background: "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.5) 60%, transparent 100%)",
                }}>
                {/* Time display (mobile: center; desktop: inline left) */}
                {isMobile && (
                    <div className="flex items-center justify-between text-white/60 text-xs font-mono mb-1 px-1">
                        <span>{formatTime(state.currentTime)}</span>
                        <span>{formatTime(state.duration)}</span>
                    </div>
                )}

                {/* Seek bar */}
                <SeekBar videoRef={videoRef} />

                {/* Controls row */}
                <div className={`flex items-center mt-1 ${isMobile ? "justify-between" : "gap-1"}`}>
                    {/* LEFT GROUP */}
                    <div className={`flex items-center ${isMobile ? "gap-1" : "gap-0.5"}`}>
                        {/* Play/pause (mobile) */}
                        {isMobile && (
                            <button
                                type="button"
                                onClick={() => actions.setPlaying(!state.playing)}
                                className="p-3 rounded-xl text-white cursor-pointer
                                           active:scale-90 transition-transform">
                                {state.playing
                                    ? <Pause size={iconMain} strokeWidth={2} fill="currentColor" />
                                    : <Play  size={iconMain} strokeWidth={2} fill="currentColor" />}
                            </button>
                        )}

                        {/* Skip -10 */}
                        <button
                            type="button"
                            onClick={() => seek(-10)}
                            className={`flex flex-col items-center gap-0.5
                                        p-2 rounded-xl text-white/75 hover:text-white
                                        hover:bg-white/10 cursor-pointer active:scale-90 transition-all
                                        ${isMobile ? "p-3" : "p-2"}`}
                            aria-label="Back 10 seconds">
                            <SkipBack size={iconSub} strokeWidth={1.8} />
                            {isMobile && <span className="text-[9px] font-bold opacity-50">10</span>}
                        </button>

                        {/* Skip +10 */}
                        <button
                            type="button"
                            onClick={() => seek(10)}
                            className={`flex flex-col items-center gap-0.5
                                        p-2 rounded-xl text-white/75 hover:text-white
                                        hover:bg-white/10 cursor-pointer active:scale-90 transition-all
                                        ${isMobile ? "p-3" : "p-2"}`}
                            aria-label="Forward 10 seconds">
                            <SkipForward size={iconSub} strokeWidth={1.8} />
                            {isMobile && <span className="text-[9px] font-bold opacity-50">10</span>}
                        </button>

                        {/* Volume (desktop) */}
                        {!isMobile && <VolumeControl />}

                        {/* Time (desktop) */}
                        {!isMobile && (
                            <span className="text-white/55 text-xs font-mono ml-2 whitespace-nowrap">
                                {formatTime(state.currentTime)} / {formatTime(state.duration)}
                            </span>
                        )}
                    </div>

                    {!isMobile && <div className="flex-1" />}

                    {/* RIGHT GROUP */}
                    <div className={`flex items-center shrink-0 ${isMobile ? "gap-0.5" : "gap-0.5"}`}>
                        {/* Loop (desktop) */}
                        {!isMobile && (
                            <IconBtn
                                onClick={() => actions.cycleLoop()}
                                active={state.loop !== "none"}
                                size="sm"
                                label="Loop">
                                <LoopIcon loop={state.loop} />
                            </IconBtn>
                        )}

                        {/* Speed */}
                        <div className="relative">
                            <button
                                type="button"
                                onClick={() => toggleMenu("speed")}
                                className={`rounded-lg text-white/70 hover:text-white hover:bg-white/10
                                           transition-colors cursor-pointer font-bold
                                           ${isMobile ? "px-2.5 py-2.5 text-xs min-h-11" : "px-2 py-1 text-xs"}`}>
                                {state.playbackSpeed}×
                            </button>
                            <SpeedPicker open={openMenu === "speed"} onClose={() => setOpenMenu(null)} />
                        </div>

                        {/* Quality */}
                        {state.qualityLevels.length > 0 && (
                            <div className="relative hidden sm:block">
                                <button
                                    onClick={() => toggleMenu("quality")}
                                    className="px-2 py-1 rounded-lg text-white/70 hover:text-white hover:bg-white/10
                                               text-xs font-semibold transition-colors cursor-pointer">
                                    {activeQualityLabel || "Q"}
                                </button>
                                <QualityPicker open={openMenu === "quality"} onClose={() => setOpenMenu(null)} />
                            </div>
                        )}

                        {/* Audio */}
                        {state.audioTracks.length > 1 && (
                            <div className="relative">
                                <button
                                    onClick={() => toggleMenu("audio")}
                                    className={`rounded-lg text-white/70 hover:text-white hover:bg-white/10
                                               flex items-center gap-1 transition-colors cursor-pointer
                                               ${isMobile ? "px-2.5 py-2.5 min-h-11" : "px-2 py-1"}`}>
                                    <Headphones size={iconTiny} strokeWidth={1.8} />
                                    <span className={`text-xs font-semibold ${isMobile ? "hidden" : "inline"}`}>
                                        {langAbbr(activeAudioName)}
                                    </span>
                                </button>
                                <AudioPicker open={openMenu === "audio"} onClose={() => setOpenMenu(null)} />
                            </div>
                        )}

                        {/* Subtitles */}
                        <div className="relative">
                            <IconBtn
                                onClick={() => toggleMenu("sub")}
                                active={!!state.activeSubtitle}
                                size={isMobile ? "md" : "sm"}
                                label="Subtitles">
                                <Subtitles size={iconTiny} strokeWidth={1.8} />
                            </IconBtn>
                            <SubtitlePicker
                                open={openMenu === "sub"}
                                onClose={() => setOpenMenu(null)}
                                subtitles={subtitles}
                            />
                        </div>

                        {/* Aspect ratio */}
                        <div className="relative hidden sm:block">
                            <button
                                onClick={() => toggleMenu("aspect")}
                                className="px-2 py-1 rounded-lg text-white/60 hover:text-white hover:bg-white/10
                                           text-[11px] font-bold transition-colors cursor-pointer">
                                {ASPECT_SHORT[state.aspectRatio]}
                            </button>
                            <AspectPicker open={openMenu === "aspect"} onClose={() => setOpenMenu(null)} />
                        </div>

                        {/* PiP */}
                        <IconBtn
                            onClick={togglePiP}
                            active={state.isPiP}
                            size="sm"
                            className="hidden sm:flex"
                            label="Picture in Picture">
                            <PictureInPicture2 size={16} strokeWidth={1.8} />
                        </IconBtn>

                        {/* Fullscreen */}
                        <IconBtn
                            onClick={toggleFullscreen}
                            size={isMobile ? "md" : "sm"}
                            label={state.isFullscreen ? "Exit fullscreen" : "Fullscreen"}>
                            {state.isFullscreen
                                ? <Minimize size={iconTiny} strokeWidth={1.8} />
                                : <Maximize size={iconTiny} strokeWidth={1.8} />}
                        </IconBtn>
                    </div>
                </div>
            </div>
        </div>
    );
}
