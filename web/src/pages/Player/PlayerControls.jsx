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
    ChevronRight,
    Unlock,
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
    UnlockKeyhole,
    Moon,
    ListOrdered,
    Shuffle,
    VolumeOff,
    Timer,
    SlidersHorizontal,
    SquareDashedBottomCode,
    AudioLines,
    SmartphoneNfc,
    X,
    GripVertical,
} from "lucide-react";
import { usePlayerState } from "./UsePlayerState";
import { useIsMobile } from "./useIsMobile";
import SeekBar from "./SeekBar";

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

const PopupMenu = memo(function PopupMenu({ open, onClose, children, align = "right", title: menuTitle }) {
    const ref = useRef(null);
    useEffect(() => {
        if (!open) return;
        const close = (e) => {
            if (ref.current && !ref.current.contains(e.target)) onClose();
        };
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

function SubtitlePicker({ open, onClose, subtitles }) {
    const { state, actions } = usePlayerState();
    function getLabel(sub) {
        if (sub.label && sub.label.toLowerCase() !== sub.lang) return sub.label;
        return (sub.lang || "Unknown").toUpperCase();
    }
    function SourceBadge({ source }) {
        if (!source) return null;
        const styles = {
            embedded: { background: "rgba(99,102,241,0.25)", color: "#a5b4fc" },
            external: { background: "rgba(16,185,129,0.2)", color: "#6ee7b7" },
            online: { background: "rgba(251,191,36,0.2)", color: "#fcd34d" },
        };
        const label = { embedded: "EMB", external: "EXT", online: "WEB" }[source] || source.toUpperCase();
        const style = styles[source] || { background: "rgba(255,255,255,0.1)", color: "#ccc" };
        return <span style={{ ...style, fontSize: 9, padding: "1px 5px", borderRadius: 4, marginLeft: 6, fontWeight: 700, letterSpacing: "0.04em" }}>{label}</span>;
    }
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
                    <span style={{ display: "flex", alignItems: "center" }}>
                        {getLabel(sub)}
                        {sub.forced && <span style={{ fontSize: 9, color: "#f87171", marginLeft: 4 }}>FORCED</span>}
                        <SourceBadge source={sub.source} />
                    </span>
                </PopupItem>
            ))}
        </PopupMenu>
    );
}

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
                <div>
                    <label
                        htmlFor="subtitle-size-range"
                        style={{ display: "block", fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
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
                <div>
                    <label
                        htmlFor="subtitle-delay-range"
                        style={{ display: "block", fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
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

function LoopIcon({ loop }) {
    if (loop === "one") return <Repeat1 size={17} strokeWidth={1.8} />;
    if (loop === "all") return <Repeat size={17} strokeWidth={1.8} style={{ color: "#e53e3e" }} />;
    return <Repeat size={17} strokeWidth={1.8} />;
}

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
            <div style={{ overflow: "hidden", transition: "width 0.22s cubic-bezier(0.4,0,0.2,1), opacity 0.22s", width: expanded ? 88 : 0, opacity: expanded ? 1 : 0 }}>
                <label htmlFor="player-volume-range" className="sr-only">
                    Volume
                </label>
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

function TimeDisplay({ style = {} }) {
    const { state } = usePlayerState();
    const remaining = state.duration - state.currentTime;
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: "ui-monospace,'SF Mono',monospace", fontSize: 12, color: "rgba(255,255,255,0.6)", whiteSpace: "nowrap", ...style }}>
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

// ─── A-B Repeat popup ─────────────────────────────────────────────────────────

function AbRepeatPanel({ open, onClose, videoRef }) {
    const { state, actions } = usePlayerState();
    if (!open) return null;
    const { a, b, active } = state.abRepeat;
    const setPoint = (point) => actions.setAbRepeat({ [point]: videoRef.current?.currentTime ?? 0 });
    const clear = () => actions.setAbRepeat({ a: null, b: null, active: false });
    return (
        <div className="flux-popup" style={{ zIndex: 60, width: 220 }}>
            <div className="flux-popup-header">A-B Repeat</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 12px 12px" }}>
                <button
                    onClick={() => setPoint("a")}
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "none",
                        background: a != null ? "rgba(229,62,62,0.18)" : "rgba(255,255,255,0.06)",
                        color: "#fff",
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: "pointer",
                    }}>
                    <span>Set Point A</span>
                    <span style={{ opacity: 0.6, fontFamily: "ui-monospace,monospace", fontSize: 12 }}>{a != null ? formatTime(a) : "—"}</span>
                </button>
                <button
                    onClick={() => setPoint("b")}
                    disabled={a == null}
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "none",
                        background: b != null ? "rgba(229,62,62,0.18)" : "rgba(255,255,255,0.06)",
                        color: a == null ? "rgba(255,255,255,0.3)" : "#fff",
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: a == null ? "not-allowed" : "pointer",
                    }}>
                    <span>Set Point B</span>
                    <span style={{ opacity: 0.6, fontFamily: "ui-monospace,monospace", fontSize: 12 }}>{b != null ? formatTime(b) : "—"}</span>
                </button>
                <button
                    onClick={() => {
                        if (a != null && b != null && b > a) actions.setAbRepeat({ active: !active });
                    }}
                    disabled={a == null || b == null || b <= a}
                    style={{
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "none",
                        background: active ? "#e53e3e" : "rgba(255,255,255,0.06)",
                        color: a != null && b != null && b > a ? "#fff" : "rgba(255,255,255,0.3)",
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: a != null && b != null && b > a ? "pointer" : "not-allowed",
                    }}>
                    {active ? "Repeating A → B" : "Start Repeat"}
                </button>
                {(a != null || b != null) && (
                    <button onClick={clear} style={{ padding: "6px 0", borderRadius: 8, background: "transparent", border: "none", color: "rgba(255,255,255,0.5)", fontSize: 12, cursor: "pointer" }}>
                        Clear points
                    </button>
                )}
            </div>
        </div>
    );
}

// ─── Customise Items popup ────────────────────────────────────────────────────

const ALL_QUICK_ITEMS = {
    nightMode: { label: "Night Mode", icon: Moon },
    customise: { label: "Customise Items", icon: ListOrdered },
    shuffle: { label: "Shuffle", icon: Shuffle },
    loop: { label: "Loop", icon: Repeat },
    mute: { label: "Mute", icon: VolumeOff },
    sleepTimer: { label: "Sleep Timer", icon: Timer },
    abRepeat: { label: "A - B Repeat", icon: SquareDashedBottomCode },
    audioFx: { label: "Audio Effect", icon: AudioLines },
    eq: { label: "Equalizer", icon: SlidersHorizontal },
    speed: { label: "Speed", icon: Gauge },
    pip: { label: "Pop-out Play", icon: PictureInPicture2 },
    bgPlay: { label: "Background Play", icon: SmartphoneNfc },
    rotation: { label: "Screen Rotation", icon: RotateCcw },
};

function CustomiseItemsPanel({ open, onClose }) {
    const { state, actions } = usePlayerState();
    const dragIndex = useRef(null);
    if (!open) return null;
    const order = state.quickIconOrder;
    const rest = Object.keys(ALL_QUICK_ITEMS).filter((k) => !order.includes(k));
    const fullList = [...order, ...rest];
    const handleDrop = (toIndex) => {
        if (dragIndex.current === null || dragIndex.current === toIndex) return;
        const next = [...fullList];
        const [moved] = next.splice(dragIndex.current, 1);
        next.splice(toIndex, 0, moved);
        actions.setQuickIconOrder(next.slice(0, 5));
        dragIndex.current = null;
    };
    return (
        <div className="flux-popup" style={{ zIndex: 60, width: 250, maxHeight: 360, overflowY: "auto" }}>
            <div className="flux-popup-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>Customise Items</span>
                <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.5)" }}>
                    <X size={14} />
                </button>
            </div>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", padding: "0 12px 8px", margin: 0 }}>Drag to reorder. Top 5 show in the quick row.</p>
            <div style={{ display: "flex", flexDirection: "column", padding: "0 8px 8px" }}>
                {fullList.map((key, i) => {
                    const item = ALL_QUICK_ITEMS[key];
                    if (!item) return null;
                    const Icon = item.icon;
                    const isQuick = i < 5;
                    return (
                        <div
                            key={key}
                            draggable
                            onDragStart={() => (dragIndex.current = i)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => handleDrop(i)}
                            style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 8px", borderRadius: 8, cursor: "grab", background: isQuick ? "rgba(229,62,62,0.1)" : "transparent" }}>
                            <GripVertical size={14} style={{ opacity: 0.35, flexShrink: 0 }} />
                            <Icon size={16} style={{ opacity: 0.7, flexShrink: 0 }} />
                            <span style={{ fontSize: 13, color: "#fff", flex: 1 }}>{item.label}</span>
                            {isQuick && <span style={{ fontSize: 9, fontWeight: 700, color: "#e53e3e" }}>QUICK</span>}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ─── Quick Icon Row ───────────────────────────────────────────────────────────

function QuickIconRow({ videoRef, containerRef, openMenu, toggleMenu, controlsPhase }) {
    const { state, actions } = usePlayerState();
    const [expanded, setExpanded] = useState(false);

    // FIX: auto-collapse the expanded row back to the 5-icon quick view once
    // controls fade out — so it doesn't silently stay expanded and pop back
    // open mid-expanded the next time controls reappear.
    useEffect(() => {
        if (controlsPhase === "HIDDEN" || controlsPhase === "ANIMATING_OUT") {
            setExpanded(false);
        }
    }, [controlsPhase]);

    const handlers = {
        nightMode: { onClick: () => actions.toggleNightMode(), active: state.nightMode },
        customise: { onClick: () => toggleMenu("customise"), active: openMenu === "customise" },
        shuffle: { onClick: () => actions.toggleShuffle(), active: state.shuffle },
        loop: { onClick: () => actions.cycleLoop(), active: state.loop !== "none", iconOverride: <LoopIcon loop={state.loop} /> },
        mute: { onClick: () => actions.setMuted(!state.muted), active: state.muted },
        sleepTimer: { onClick: () => {}, active: !!state.sleepTimerEndsAt },
        abRepeat: { onClick: () => toggleMenu("abRepeat"), active: state.abRepeat.active || openMenu === "abRepeat" },
        audioFx: { onClick: () => {}, active: false },
        eq: { onClick: () => actions.toggleEq(), active: state.eqEnabled },
        speed: { onClick: () => toggleMenu("speed"), active: state.playbackSpeed !== 1 },
        pip: { onClick: () => videoRef?.current?.requestPictureInPicture?.().catch(() => {}), active: state.isPiP },
        bgPlay: { onClick: () => actions.toggleBackgroundPlay(), active: state.backgroundPlay },
        rotation: { onClick: () => containerRef?.current?._toggleRotation?.(), active: false },
    };
    const order = state.quickIconOrder;
    const visibleKeys = expanded ? [...order, ...Object.keys(ALL_QUICK_ITEMS).filter((k) => !order.includes(k))] : order.slice(0, 5);
    return (
        <div
            className="flux-quick-row"
            data-gesture-exclude="true"
            onTouchStart={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
            style={{
                display: "grid",
                gridAutoFlow: "column",
                gridAutoColumns: "max-content",
                alignItems: "start",
                gap: 6,
                overflowX: "auto",
                overflowY: "hidden",
                paddingBottom: 2,
                position: "relative",
                WebkitOverflowScrolling: "touch",
                scrollbarWidth: "none",
                msOverflowStyle: "none",
                // Native touch-action so the browser itself treats this as
                // a horizontally-pannable region, complementing the JS-level
                // exclusion above.
                touchAction: "pan-x",
            }}>
            {visibleKeys.map((key) => {
                const item = ALL_QUICK_ITEMS[key];
                if (!item) return null;
                const h = handlers[key] || {};
                const Icon = item.icon;
                return (
                    <div key={key} style={{ position: "relative", flexShrink: 0 }}>
                        <button
                            onClick={h.onClick}
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                gap: expanded ? 4 : 0,
                                background: "transparent",
                                border: "none",
                                cursor: "pointer",
                                flexShrink: 0,
                                width: 56,
                                padding: 0,
                            }}>
                            <div
                                style={{
                                    width: 40,
                                    height: 40,
                                    borderRadius: "50%",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    background: h.active ? "rgba(229,62,62,0.35)" : "rgba(0,0,0,0.4)",
                                    border: "1px solid rgba(255,255,255,0.1)",
                                }}>
                                {h.iconOverride || <Icon size={20} strokeWidth={2} stroke={h.active ? "var(--color-primary)" : "#fff"} />}
                            </div>
                            {expanded && <span style={{ fontSize: 9.5, color: "rgba(255,255,255,0.85)", textAlign: "center", lineHeight: 1.15, fontWeight: 500 }}>{item.label}</span>}
                        </button>
                        {key === "customise" && <CustomiseItemsPanel open={openMenu === "customise"} onClose={() => toggleMenu(null)} />}
                        {key === "abRepeat" && <AbRepeatPanel open={openMenu === "abRepeat"} onClose={() => toggleMenu(null)} videoRef={videoRef} />}
                    </div>
                );
            })}
            {!expanded && (
                <button
                    onClick={() => setExpanded(true)}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 30,
                        height: 30,
                        borderRadius: "50%",
                        flexShrink: 0,
                        background: "rgba(0,0,0,0.4)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        cursor: "pointer",
                        // Align vertical center with the 38px icon circles
                        // above (not the full icon+label cell, which would
                        // visually sink the chevron below the icon row).
                        marginTop: 5,
                        padding: 0,
                        marginLeft: 2,
                    }}
                    aria-label="More options">
                    <ChevronRight size={16} color="#fff" strokeWidth={2} />
                </button>
            )}
            {expanded && (
                <button
                    onClick={() => setExpanded(false)}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 30,
                        height: 30,
                        borderRadius: "50%",
                        flexShrink: 0,
                        background: "rgba(0,0,0,0.4)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        cursor: "pointer",
                        marginTop: 5,
                        padding: 0,
                        marginLeft: 2,
                    }}
                    aria-label="Collapse options">
                    <ChevronLeft size={16} color="#fff" strokeWidth={2} />
                </button>
            )}
        </div>
    );
}

// ─── PlayerControls ───────────────────────────────────────────────────────────

export default function PlayerControls({ mediaInfo, videoRef, containerRef, subtitles = [], onBack, onShowControls, controlsPhase = "VISIBLE" }) {
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

    // FIX: no center play/pause bubble on mobile anymore — removed per
    // explicit request ("remove the center play pause button which is with
    // red bg"). Tap-to-toggle (wired in PlayerPage/PlayerGestures) is now
    // the ONLY way to bring controls back on mobile. Desktop already
    // returned null here (mouse movement reveals controls there).
    if (!state.controlsVisible) {
        return null;
    }

    return (
        <div
            className="absolute inset-0 z-30 flex flex-col justify-between"
            style={{
                opacity: controlsPhase === "ANIMATING_OUT" ? 0 : 1,
                transition: "opacity 200ms ease",
                pointerEvents: controlsPhase === "ANIMATING_OUT" ? "none" : "auto",
            }}
            onClickCapture={onShowControls}
            onPointerDownCapture={onShowControls}>
            {/* ── Top bar ──────────────────────────────────────────────────────── */}
            <div className="pointer-events-auto flex flex-col gap-3 px-3 pt-3 flux-controls-top">
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                        <button onClick={onBack} className="flux-icon-btn p-2 shrink-0" aria-label="Go back" style={{ color: "rgba(255,255,255,0.9)" }}>
                            <ChevronLeft size={24} strokeWidth={2.5} />
                        </button>
                        <div className="min-w-0 flex-1">
                            <p className="text-white font-semibold text-sm sm:text-base leading-tight truncate">{title}</p>
                            {subtitle && <p className="text-white/50 text-xs mt-0.5 truncate">{subtitle}</p>}
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                        {activeQualityLabel && !isMobile && <span className="flux-quality-badge">{activeQualityLabel}</span>}
                        <button
                            onClick={() => {
                                actions.setLocked(true);
                                actions.setControlsVisible(false);
                            }}
                            className="flux-icon-btn p-2"
                            aria-label="Lock screen">
                            <UnlockKeyhole size={20} strokeWidth={2.5} stroke="#fff" />
                        </button>
                    </div>
                </div>

                {/* ── Quick icon row (mobile only — matches MX Player reference) ──
                    Lives inside the top bar div now (same gradient background,
                    same fade-out lifecycle) instead of as a separate sibling.
                    Gap to the header row above is the gap-3 (12px) on the
                    parent flex-col — adjust that single class to retune. */}
                {isMobile && <QuickIconRow videoRef={videoRef} containerRef={containerRef} openMenu={openMenu} toggleMenu={toggleMenu} controlsPhase={controlsPhase} />}
            </div>

            {/* ── Center controls (desktop) ─────────────────────────────────── */}
            {!isMobile && (
                <div className="pointer-events-auto flex items-center justify-center gap-5">
                    <IconBtn onClick={() => seek(-30)} label="Back 30s" size="md">
                        <div className="flex flex-col items-center gap-0.5">
                            <RotateCcw size={22} strokeWidth={1.8} />
                            <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.65 }}>30</span>
                        </div>
                    </IconBtn>
                    <IconBtn onClick={() => seek(-10)} label="Back 10s" size="md">
                        <div className="flex flex-col items-center gap-0.5">
                            <SkipBack size={24} strokeWidth={1.8} />
                            <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.65 }}>10</span>
                        </div>
                    </IconBtn>
                    <button type="button" onClick={() => actions.setPlaying(!state.playing)} className="flux-play-btn-desktop" aria-label={state.playing ? "Pause" : "Play"}>
                        {state.playing ? <Pause size={30} strokeWidth={2} fill="currentColor" /> : <Play size={30} strokeWidth={2} fill="currentColor" style={{ marginLeft: 2 }} />}
                    </button>
                    <IconBtn onClick={() => seek(10)} label="Forward 10s" size="md">
                        <div className="flex flex-col items-center gap-0.5">
                            <SkipForward size={24} strokeWidth={1.8} />
                            <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.65 }}>10</span>
                        </div>
                    </IconBtn>
                    <IconBtn onClick={() => seek(30)} label="Forward 30s" size="md">
                        <div className="flex flex-col items-center gap-0.5">
                            <RotateCcw size={22} strokeWidth={1.8} style={{ transform: "scaleX(-1)" }} />
                            <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.65 }}>30</span>
                        </div>
                    </IconBtn>
                </div>
            )}

            {/* ── Bottom bar ────────────────────────────────────────────────── */}
            <div className="pointer-events-auto px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flux-controls-bottom">
                {isMobile && (
                    <div className="flex items-center justify-between px-1 mb-1.5">
                        <TimeDisplay />
                        <span style={{ fontSize: 11, fontWeight: 600, color: state.playbackSpeed !== 1 ? "#e53e3e" : "rgba(255,255,255,0.4)", fontFamily: "ui-monospace,'SF Mono',monospace" }}>
                            {state.playbackSpeed !== 1 ? `${state.playbackSpeed}×` : ""}
                        </span>
                    </div>
                )}

                <SeekBar videoRef={videoRef} />

                <div className={`flex items-center mt-1 ${isMobile ? "justify-between" : "gap-1"}`}>
                    <div className={`flex items-center ${isMobile ? "gap-0.5" : "gap-0.5"}`}>
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
                        <button type="button" onClick={() => seek(-10)} className={`flex flex-col items-center gap-0.5 flux-icon-btn ${isMobile ? "p-3" : "p-2"}`} aria-label="Back 10 seconds">
                            <SkipBack size={iconSub} strokeWidth={1.8} />
                            {isMobile && <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.5 }}>10</span>}
                        </button>
                        <button type="button" onClick={() => seek(10)} className={`flex flex-col items-center gap-0.5 flux-icon-btn ${isMobile ? "p-3" : "p-2"}`} aria-label="Forward 10 seconds">
                            <SkipForward size={iconSub} strokeWidth={1.8} />
                            {isMobile && <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.5 }}>10</span>}
                        </button>
                        {!isMobile && <VolumeControl />}
                        {!isMobile && <TimeDisplay style={{ marginLeft: 8 }} />}
                    </div>

                    {!isMobile && <div style={{ flex: 1 }} />}

                    <div className={`flex items-center shrink-0 ${isMobile ? "gap-0.5" : "gap-0.5"}`}>
                        {!isMobile && (
                            <IconBtn onClick={() => actions.cycleLoop()} active={state.loop !== "none"} size="sm" label="Loop" title={`Loop: ${state.loop}`}>
                                <LoopIcon loop={state.loop} />
                            </IconBtn>
                        )}
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
                        {state.audioTracks.length > 1 && (
                            <div style={{ position: "relative" }}>
                                <button
                                    onClick={() => toggleMenu("audio")}
                                    className="flux-icon-btn"
                                    style={{ display: "flex", alignItems: "center", gap: 4, padding: isMobile ? "10px 10px" : "6px 8px" }}
                                    aria-label="Audio track">
                                    <Headphones size={iconTiny} strokeWidth={1.8} />
                                    {!isMobile && <span style={{ fontSize: 12, fontWeight: 600 }}>{langAbbr(activeAudioName)}</span>}
                                </button>
                                <AudioPicker open={openMenu === "audio"} onClose={closeMenu} />
                            </div>
                        )}
                        <div style={{ position: "relative" }}>
                            <IconBtn onClick={() => toggleMenu("sub")} active={!!state.activeSubtitle} size={isMobile ? "md" : "sm"} label="Subtitles">
                                <Subtitles size={iconTiny} strokeWidth={1.8} />
                            </IconBtn>
                            <SubtitlePicker open={openMenu === "sub"} onClose={closeMenu} subtitles={subtitles} />
                        </div>
                        {state.activeSubtitle && (
                            <div style={{ position: "relative" }}>
                                <IconBtn onClick={() => toggleMenu("subSettings")} active={openMenu === "subSettings"} size="sm" label="Subtitle settings">
                                    <Type size={14} strokeWidth={1.8} />
                                </IconBtn>
                                <SubtitleSettings open={openMenu === "subSettings"} onClose={closeMenu} />
                            </div>
                        )}
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
                        <IconBtn onClick={togglePiP} active={state.isPiP} size="sm" className="hidden sm:flex" label="Picture in Picture">
                            <PictureInPicture2 size={16} strokeWidth={1.8} />
                        </IconBtn>
                        <IconBtn onClick={toggleFullscreen} size={isMobile ? "md" : "sm"} label={state.isFullscreen ? "Exit fullscreen" : "Fullscreen"}>
                            {state.isFullscreen ? <Minimize size={iconTiny} strokeWidth={1.8} /> : <Maximize size={iconTiny} strokeWidth={1.8} />}
                        </IconBtn>
                    </div>
                </div>
            </div>
        </div>
    );
}
