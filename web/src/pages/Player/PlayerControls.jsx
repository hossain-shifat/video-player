import { useState, useRef, useCallback, useEffect, memo } from "react";
import {
    Play,
    Pause,
    SkipBack,
    SkipForward,
    Volume2,
    VolumeX,
    Volume1,
    Maximize,
    Minimize,
    PictureInPicture2,
    Subtitles,
    ChevronLeft,
    Lock,
    MonitorPlay,
    Headphones,
    Check,
    Gauge,
    Repeat,
    Repeat1,
    RotateCcw,
    Zap,
    Settings,
    Type,
    AlignCenter,
} from "lucide-react";
import { usePlayerState } from "./UsePlayerState";
import { useIsMobile } from "./useIsMobile";
import SeekBar from "./SeekBar";
import "./player.css";

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
    English: "🇬🇧",
    Hindi: "🇮🇳",
    Bangla: "🇧🇩",
    Japanese: "🇯🇵",
    French: "🇫🇷",
    Spanish: "🇪🇸",
    Arabic: "🇸🇦",
    German: "🇩🇪",
    Korean: "🇰🇷",
    Chinese: "🇨🇳",
    Russian: "🇷🇺",
    Italian: "🇮🇹",
    Portuguese: "🇧🇷",
    Turkish: "🇹🇷",
};

function langAbbr(name) {
    if (!name) return "AUD";
    return name.slice(0, 3).toUpperCase();
}

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const ASPECT_LABELS = { auto: "Auto", fill: "Fill", "16:9": "16:9", "4:3": "4:3", "1:1": "1:1", stretch: "Stretch" };
const ASPECT_SHORT = { auto: "A", fill: "F", "16:9": "W", "4:3": "4:3", "1:1": "1:1", stretch: "S" };

// ─── Icon Button ─────────────────────────────────────────────────────────────

const IconBtn = memo(function IconBtn({ onClick, active, children, size = "md", className = "", label, title }) {
    const p = size === "lg" ? "p-3.5" : size === "sm" ? "p-1.5" : "p-2";
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={label}
            title={title || label}
            className={`flux-icon-btn ${p} ${active ? "active" : ""} ${className}`}
            style={{ WebkitTapHighlightColor: "transparent" }}>
            {children}
        </button>
    );
});

// ─── Popup Menu ───────────────────────────────────────────────────────────────

const PopupMenu = memo(function PopupMenu({ open, onClose, children, align = "right", title: menuTitle }) {
    const ref = useRef(null);

    useEffect(() => {
        if (!open) return;
        const close = (e) => {
            if (ref.current && !ref.current.contains(e.target)) onClose();
        };
        // small delay to avoid same-click close
        const id = setTimeout(() => document.addEventListener("mousedown", close), 50);
        return () => {
            clearTimeout(id);
            document.removeEventListener("mousedown", close);
        };
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div ref={ref} className={`flux-popup ${align === "left" ? "align-left" : ""}`} style={{ zIndex: 60 }}>
            {menuTitle && <div className="flux-popup-header">{menuTitle}</div>}
            {children}
        </div>
    );
});

function PopupItem({ active, onClick, children, icon: Icon }) {
    return (
        <button className={`flux-popup-item ${active ? "active" : ""}`} onClick={onClick}>
            {Icon && <Icon size={14} style={{ opacity: 0.6, flexShrink: 0 }} />}
            <span style={{ flex: 1 }}>{children}</span>
            {active && <Check size={13} className="check" />}
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
                onClick={() => {
                    actions.setActiveQuality(-1);
                    onClose();
                }}>
                <div>
                    <div>Auto</div>
                    <div style={{ fontSize: 11, opacity: 0.4 }}>Adaptive bitrate</div>
                </div>
            </PopupItem>
            {state.qualityLevels.map((lvl) => (
                <PopupItem
                    key={lvl.index}
                    active={state.activeQuality === lvl.index}
                    icon={MonitorPlay}
                    onClick={() => {
                        actions.setActiveQuality(lvl.index);
                        onClose();
                    }}>
                    <div>
                        <div>{lvl.label}</div>
                        {lvl.bitrate && <div style={{ fontSize: 11, opacity: 0.4 }}>{bitrateLabel(lvl.bitrate)}</div>}
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
                    onClick={() => {
                        actions.setActiveAudioTrack(track.index);
                        onClose();
                    }}>
                    <span style={{ fontSize: "1rem", lineHeight: 1 }}>{AUDIO_FLAGS[track.name] || "🎵"}</span>
                    <div>
                        <div>{track.name}</div>
                        <div style={{ fontSize: 11, opacity: 0.4, textTransform: "uppercase" }}>{track.lang}</div>
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
                    onClick={() => {
                        actions.setPlaybackSpeed(s);
                        onClose();
                    }}>
                    {s === 1 ? "Normal (1×)" : `${s}×`}
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
                onClick={() => {
                    actions.setActiveSubtitle(null);
                    onClose();
                }}>
                Off
            </PopupItem>
            {subtitles.map((sub) => (
                <PopupItem
                    key={sub.url}
                    active={state.activeSubtitle?.url === sub.url}
                    onClick={() => {
                        actions.setActiveSubtitle(sub);
                        onClose();
                    }}>
                    {sub.filename || sub.lang || "Unknown"}
                </PopupItem>
            ))}
        </PopupMenu>
    );
}

// ─── Subtitle Settings Panel ──────────────────────────────────────────────────

function SubtitleSettings({ open, onClose }) {
    const { state, actions } = usePlayerState();
    if (!open) return null;

    return (
        <div
            style={{
                position: "absolute",
                bottom: "calc(100% + 12px)",
                right: 0,
                width: 240,
                borderRadius: 16,
                background: "rgba(10, 10, 14, 0.97)",
                backdropFilter: "blur(24px)",
                border: "1px solid rgba(255,255,255,0.1)",
                boxShadow: "0 20px 60px rgba(0,0,0,0.8)",
                padding: "6px 0",
                zIndex: 60,
                animation: "flux-popup-in 0.18s cubic-bezier(0.34, 1.56, 0.64, 1)",
                transformOrigin: "bottom right",
            }}>
            <div className="flux-popup-header">Subtitle Settings</div>
            <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
                {/* Font size */}
                <div>
                    <label htmlFor="subtitle-size-range" style={{ display: "block", fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
                        Size — {state.subtitleFontSize}px
                    </label>
                    <input
                        id="subtitle-size-range"
                        name="subtitle-size"
                        type="range"
                        min={12}
                        max={36}
                        step={1}
                        value={state.subtitleFontSize}
                        onChange={(e) => actions.setSubtitleFontSize(+e.target.value)}
                        style={{ width: "100%", accentColor: "#e53e3e" }}
                    />
                </div>
                {/* Delay */}
                <div>
                    <label htmlFor="subtitle-delay-range" style={{ display: "block", fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
                        Delay — {(state.subtitleDelay / 1000).toFixed(1)}s
                    </label>
                    <input
                        id="subtitle-delay-range"
                        name="subtitle-delay"
                        type="range"
                        min={-5000}
                        max={5000}
                        step={100}
                        value={state.subtitleDelay}
                        onChange={(e) => actions.setSubtitleDelay(+e.target.value)}
                        style={{ width: "100%", accentColor: "#e53e3e" }}
                    />
                </div>
                {/* Reset */}
                <button
                    onClick={() => {
                        actions.setSubtitleDelay(0);
                        actions.setSubtitleFontSize(20);
                    }}
                    style={{
                        padding: "7px 0",
                        borderRadius: 8,
                        background: "rgba(255,255,255,0.06)",
                        color: "rgba(255,255,255,0.7)",
                        fontSize: 12,
                        border: "none",
                        cursor: "pointer",
                        fontWeight: 600,
                    }}>
                    Reset to defaults
                </button>
            </div>
        </div>
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
                    onClick={() => {
                        actions.setAspectRatio(val);
                        onClose();
                    }}>
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

// ─── Volume Control ───────────────────────────────────────────────────────────

const VolumeControl = memo(function VolumeControl() {
    const { state, actions } = usePlayerState();
    const [expanded, setExpanded] = useState(false);
    const timerRef = useRef(null);

    const VIcon = state.muted || state.volume === 0 ? VolumeX : state.volume < 0.5 ? Volume1 : Volume2;

    const expand = () => {
        clearTimeout(timerRef.current);
        setExpanded(true);
    };
    const collapse = () => {
        timerRef.current = setTimeout(() => setExpanded(false), 300);
    };

    return (
        <div className="flex items-center gap-1" onMouseEnter={expand} onMouseLeave={collapse}>
            <button onClick={() => actions.setMuted(!state.muted)} className="flux-icon-btn p-2" aria-label="Toggle mute">
                <VIcon size={18} strokeWidth={1.8} />
            </button>
            <div
                style={{
                    overflow: "hidden",
                    transition: "width 0.22s cubic-bezier(0.4,0,0.2,1), opacity 0.22s",
                    width: expanded ? 88 : 0,
                    opacity: expanded ? 1 : 0,
                }}>
                <label htmlFor="player-volume-range" className="sr-only">Volume</label>
                <input
                    id="player-volume-range"
                    name="player-volume"
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={state.muted ? 0 : state.volume}
                    onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        actions.setVolume(v);
                        if (v > 0) actions.setMuted(false);
                    }}
                    className="flux-volume-slider"
                />
            </div>
        </div>
    );
});

// ─── Time Display ─────────────────────────────────────────────────────────────

function TimeDisplay({ style = {} }) {
    const { state } = usePlayerState();
    const remaining = state.duration - state.currentTime;

    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontFamily: "ui-monospace,'SF Mono',monospace",
                fontSize: 12,
                color: "rgba(255,255,255,0.6)",
                whiteSpace: "nowrap",
                ...style,
            }}>
            <span style={{ color: "rgba(255,255,255,0.9)", fontWeight: 600 }}>{formatTime(state.currentTime)}</span>
            <span style={{ opacity: 0.4 }}>/</span>
            <span>{formatTime(state.duration)}</span>
            {state.duration > 0 && (
                <span style={{ opacity: 0.35, fontSize: 11 }}>
                    ({"-"}
                    {formatTime(remaining)})
                </span>
            )}
        </div>
    );
}

// ─── PlayerControls ───────────────────────────────────────────────────────────

export default function PlayerControls({ mediaInfo, videoRef, containerRef, subtitles = [], onBack, onShowControls }) {
    const { state, actions } = usePlayerState();
    const isMobile = useIsMobile();
    const [openMenu, setOpenMenu] = useState(null);

    const activeAudioName = state.audioTracks[state.activeAudioTrack]?.name || "";
    const activeQualityLabel = state.activeQuality === -1 ? (state.qualityLevels.length ? "Auto" : "") : state.qualityLevels[state.activeQuality]?.label || "";

    const toggleMenu = useCallback((menu) => setOpenMenu((v) => (v === menu ? null : menu)), []);
    const closeMenu = useCallback(() => setOpenMenu(null), []);

    const seek = useCallback(
        (delta) => {
            const v = videoRef.current;
            if (v) v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + delta));
        },
        [videoRef],
    );

    const toggleFullscreen = () => containerRef.current?._toggleFullscreen?.();
    const togglePiP = () => containerRef.current?._togglePiP?.();

    const title = mediaInfo?.title || "";
    const subtitle =
        mediaInfo?.type === "series" && mediaInfo.season && mediaInfo.episode
            ? `S${mediaInfo.season}E${mediaInfo.episode}${mediaInfo.episodeTitle ? ` — ${mediaInfo.episodeTitle}` : ""}`
            : mediaInfo?.year
              ? String(mediaInfo.year)
              : "";

    const iconMain = isMobile ? 30 : 26;
    const iconSub = isMobile ? 22 : 18;
    const iconTiny = isMobile ? 20 : 16;

    // ── Invisible controls: show center play bubble on mobile ─────────────────
    if (!state.controlsVisible) {
        if (!isMobile) return null;
        return (
            <div className="absolute inset-0 z-30 pointer-events-none flex items-center justify-center">
                <button type="button" onClick={onShowControls} className="pointer-events-auto flux-center-play" aria-label="Show controls">
                    {state.playing ? <Pause size={38} strokeWidth={2} fill="currentColor" /> : <Play size={38} strokeWidth={2} fill="currentColor" />}
                </button>
            </div>
        );
    }

    return (
        <div className="absolute inset-0 z-30 flex flex-col justify-between pointer-events-none">
            {/* ── Top bar ──────────────────────────────────────────────────────── */}
            <div className="pointer-events-auto flex items-start justify-between px-3 pt-3 pb-16 flux-controls-top">
                {/* Left: back + title */}
                <div className="flex items-center gap-2 min-w-0 flex-1">
                    <button onClick={onBack} className="flux-icon-btn p-2 shrink-0" aria-label="Go back" style={{ color: "rgba(255,255,255,0.9)" }}>
                        <ChevronLeft size={24} strokeWidth={2.5} />
                    </button>
                    <div className="min-w-0 flex-1">
                        <p className="text-white font-semibold text-sm sm:text-base leading-tight truncate">{title}</p>
                        {subtitle && <p className="text-white/50 text-xs mt-0.5 truncate">{subtitle}</p>}
                    </div>
                </div>

                {/* Right: quality badge + lock */}
                <div className="flex items-center gap-2 shrink-0 ml-2">
                    {activeQualityLabel && !isMobile && <span className="flux-quality-badge">{activeQualityLabel}</span>}
                    <button
                        onClick={() => {
                            actions.setLocked(true);
                            actions.setControlsVisible(false);
                        }}
                        className="flux-icon-btn p-2"
                        aria-label="Lock screen">
                        <Lock size={18} strokeWidth={1.8} />
                    </button>
                </div>
            </div>

            {/* ── Center controls (desktop) ─────────────────────────────────── */}
            {!isMobile && (
                <div className="pointer-events-auto flex items-center justify-center gap-5">
                    {/* -30s */}
                    <IconBtn onClick={() => seek(-30)} label="Back 30s" size="md">
                        <div className="flex flex-col items-center gap-0.5">
                            <RotateCcw size={22} strokeWidth={1.8} />
                            <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.65 }}>30</span>
                        </div>
                    </IconBtn>
                    {/* -10s */}
                    <IconBtn onClick={() => seek(-10)} label="Back 10s" size="md">
                        <div className="flex flex-col items-center gap-0.5">
                            <SkipBack size={24} strokeWidth={1.8} />
                            <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.65 }}>10</span>
                        </div>
                    </IconBtn>
                    {/* Play/Pause */}
                    <button type="button" onClick={() => actions.setPlaying(!state.playing)} className="flux-play-btn-desktop" aria-label={state.playing ? "Pause" : "Play"}>
                        {state.playing ? <Pause size={30} strokeWidth={2} fill="currentColor" /> : <Play size={30} strokeWidth={2} fill="currentColor" style={{ marginLeft: 2 }} />}
                    </button>
                    {/* +10s */}
                    <IconBtn onClick={() => seek(10)} label="Forward 10s" size="md">
                        <div className="flex flex-col items-center gap-0.5">
                            <SkipForward size={24} strokeWidth={1.8} />
                            <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.65 }}>10</span>
                        </div>
                    </IconBtn>
                    {/* +30s */}
                    <IconBtn onClick={() => seek(30)} label="Forward 30s" size="md">
                        <div className="flex flex-col items-center gap-0.5">
                            <RotateCcw size={22} strokeWidth={1.8} style={{ transform: "scaleX(-1)" }} />
                            <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.65 }}>30</span>
                        </div>
                    </IconBtn>
                </div>
            )}

            {/* ── Bottom bar ────────────────────────────────────────────────── */}
            <div className="pointer-events-auto px-3 pt-16 pb-[max(0.75rem,env(safe-area-inset-bottom))] flux-controls-bottom">
                {/* Time row (mobile) */}
                {isMobile && (
                    <div className="flex items-center justify-between px-1 mb-1.5">
                        <TimeDisplay />
                        <span
                            style={{
                                fontSize: 11,
                                fontWeight: 600,
                                color: state.playbackSpeed !== 1 ? "#e53e3e" : "rgba(255,255,255,0.4)",
                                fontFamily: "ui-monospace,'SF Mono',monospace",
                            }}>
                            {state.playbackSpeed !== 1 ? `${state.playbackSpeed}×` : ""}
                        </span>
                    </div>
                )}

                {/* Seek bar */}
                <SeekBar videoRef={videoRef} />

                {/* Controls row */}
                <div className={`flex items-center mt-1 ${isMobile ? "justify-between" : "gap-1"}`}>
                    {/* LEFT GROUP */}
                    <div className={`flex items-center ${isMobile ? "gap-0.5" : "gap-0.5"}`}>
                        {/* Play/pause (mobile) */}
                        {isMobile && (
                            <button
                                type="button"
                                onClick={() => actions.setPlaying(!state.playing)}
                                className="flux-icon-btn p-3"
                                style={{ color: "#fff" }}
                                aria-label={state.playing ? "Pause" : "Play"}>
                                {state.playing ? <Pause size={iconMain} strokeWidth={2} fill="currentColor" /> : <Play size={iconMain} strokeWidth={2} fill="currentColor" />}
                            </button>
                        )}

                        {/* Skip -10 */}
                        <button type="button" onClick={() => seek(-10)} className={`flex flex-col items-center gap-0.5 flux-icon-btn ${isMobile ? "p-3" : "p-2"}`} aria-label="Back 10 seconds">
                            <SkipBack size={iconSub} strokeWidth={1.8} />
                            {isMobile && <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.5 }}>10</span>}
                        </button>

                        {/* Skip +10 */}
                        <button type="button" onClick={() => seek(10)} className={`flex flex-col items-center gap-0.5 flux-icon-btn ${isMobile ? "p-3" : "p-2"}`} aria-label="Forward 10 seconds">
                            <SkipForward size={iconSub} strokeWidth={1.8} />
                            {isMobile && <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.5 }}>10</span>}
                        </button>

                        {/* Volume (desktop) */}
                        {!isMobile && <VolumeControl />}

                        {/* Time display (desktop) */}
                        {!isMobile && <TimeDisplay style={{ marginLeft: 8 }} />}
                    </div>

                    {!isMobile && <div style={{ flex: 1 }} />}

                    {/* RIGHT GROUP */}
                    <div className={`flex items-center shrink-0 ${isMobile ? "gap-0.5" : "gap-0.5"}`}>
                        {/* Loop (desktop) */}
                        {!isMobile && (
                            <IconBtn onClick={() => actions.cycleLoop()} active={state.loop !== "none"} size="sm" label="Loop" title={`Loop: ${state.loop}`}>
                                <LoopIcon loop={state.loop} />
                            </IconBtn>
                        )}

                        {/* Speed */}
                        <div style={{ position: "relative" }}>
                            <button
                                type="button"
                                onClick={() => toggleMenu("speed")}
                                style={{
                                    borderRadius: 8,
                                    border: "none",
                                    background: "transparent",
                                    color: state.playbackSpeed !== 1 ? "#e53e3e" : "rgba(255,255,255,0.7)",
                                    fontWeight: 700,
                                    fontSize: 12,
                                    padding: isMobile ? "10px 10px" : "4px 8px",
                                    cursor: "pointer",
                                    minHeight: isMobile ? 44 : "auto",
                                    fontFamily: "ui-monospace,'SF Mono',monospace",
                                    letterSpacing: "0.3px",
                                    WebkitTapHighlightColor: "transparent",
                                }}
                                aria-label="Playback speed">
                                {state.playbackSpeed}×
                            </button>
                            <SpeedPicker open={openMenu === "speed"} onClose={closeMenu} />
                        </div>

                        {/* Quality — desktop: text label, mobile: MonitorPlay icon */}
                        {state.qualityLevels.length > 0 && (
                            <div style={{ position: "relative" }}>
                                {isMobile ? (
                                    <IconBtn onClick={() => toggleMenu("quality")} active={state.activeQuality !== -1} size="sm" label="Quality">
                                        <MonitorPlay size={iconTiny} strokeWidth={1.8} />
                                    </IconBtn>
                                ) : (
                                    <button
                                        onClick={() => toggleMenu("quality")}
                                        style={{
                                            borderRadius: 8,
                                            border: "none",
                                            background: "transparent",
                                            color: "rgba(255,255,255,0.65)",
                                            fontSize: 12,
                                            fontWeight: 600,
                                            padding: "4px 8px",
                                            cursor: "pointer",
                                            WebkitTapHighlightColor: "transparent",
                                        }}
                                        aria-label="Quality">
                                        {activeQualityLabel || "Q"}
                                    </button>
                                )}
                                <QualityPicker open={openMenu === "quality"} onClose={closeMenu} />
                            </div>
                        )}

                        {/* Audio tracks */}
                        {state.audioTracks.length > 1 && (
                            <div style={{ position: "relative" }}>
                                <button
                                    onClick={() => toggleMenu("audio")}
                                    className="flux-icon-btn"
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 4,
                                        padding: isMobile ? "10px 10px" : "6px 8px",
                                    }}
                                    aria-label="Audio track">
                                    <Headphones size={iconTiny} strokeWidth={1.8} />
                                    {!isMobile && <span style={{ fontSize: 12, fontWeight: 600 }}>{langAbbr(activeAudioName)}</span>}
                                </button>
                                <AudioPicker open={openMenu === "audio"} onClose={closeMenu} />
                            </div>
                        )}

                        {/* Subtitles */}
                        <div style={{ position: "relative" }}>
                            <IconBtn onClick={() => toggleMenu("sub")} active={!!state.activeSubtitle} size={isMobile ? "md" : "sm"} label="Subtitles">
                                <Subtitles size={iconTiny} strokeWidth={1.8} />
                            </IconBtn>
                            <SubtitlePicker open={openMenu === "sub"} onClose={closeMenu} subtitles={subtitles} />
                        </div>

                        {/* Subtitle settings (only if subtitle active) */}
                        {state.activeSubtitle && (
                            <div style={{ position: "relative" }}>
                                <IconBtn onClick={() => toggleMenu("subSettings")} active={openMenu === "subSettings"} size="sm" label="Subtitle settings">
                                    <Type size={14} strokeWidth={1.8} />
                                </IconBtn>
                                <SubtitleSettings open={openMenu === "subSettings"} onClose={closeMenu} />
                            </div>
                        )}

                        {/* Aspect ratio — all devices */}
                        <div style={{ position: "relative" }}>
                            <button
                                onClick={() => toggleMenu("aspect")}
                                style={{
                                    borderRadius: 8,
                                    border: "none",
                                    background: "transparent",
                                    color: state.aspectRatio !== "auto" ? "#e53e3e" : "rgba(255,255,255,0.55)",
                                    fontSize: 11,
                                    fontWeight: 700,
                                    padding: isMobile ? "10px 8px" : "4px 8px",
                                    cursor: "pointer",
                                    minHeight: isMobile ? 44 : "auto",
                                    WebkitTapHighlightColor: "transparent",
                                }}
                                aria-label="Aspect ratio">
                                {ASPECT_SHORT[state.aspectRatio]}
                            </button>
                            <AspectPicker open={openMenu === "aspect"} onClose={closeMenu} />
                        </div>

                        {/* PiP */}
                        <IconBtn onClick={togglePiP} active={state.isPiP} size="sm" className="hidden sm:flex" label="Picture in Picture">
                            <PictureInPicture2 size={16} strokeWidth={1.8} />
                        </IconBtn>

                        {/* Fullscreen */}
                        <IconBtn onClick={toggleFullscreen} size={isMobile ? "md" : "sm"} label={state.isFullscreen ? "Exit fullscreen" : "Fullscreen"}>
                            {state.isFullscreen ? <Minimize size={iconTiny} strokeWidth={1.8} /> : <Maximize size={iconTiny} strokeWidth={1.8} />}
                        </IconBtn>
                    </div>
                </div>
            </div>
        </div>
    );
}
