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
    AlignCenter,
    UnlockKeyhole,
    Moon,
    PenLine,
    Shuffle,
    VolumeOff,
    Timer,
    SlidersHorizontal,
    Camera,
    AudioLines,
    Lock,
    Mic2,
    Speaker,
    Film,
    Music2,
    MoreVertical,
    ChevronDown,
    Waves,
    X,
    GripVertical,
    Maximize2,
    MoveHorizontal,
    Tv,
    Square,
} from "lucide-react";
import { MdOutlineHighQuality, MdHighQuality, MdOutlineScreenRotation, MdScreenLockRotation, MdMusicNote } from "react-icons/md";
import { usePlayerState } from "./UsePlayerState";
import { useIsMobile } from "./useIsMobile";
import SeekBar from "./SeekBar";
import VideoSidebar, { SidebarItem } from "./VideoSidebar";
import { SpeedSliderOverlay } from "./PlayerOverlays";

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
// MX-Player-style aspect ratio ring. Index order is the cycle order.
// Maps directly onto the existing aspectRatio reducer values — "fill" is
// reused for CROP/Zoom since getAspectStyle() already implements it as
// objectFit:"cover" (true crop-to-fill), and "auto" is FIT (contain).
const ASPECT_RING = ["auto", "stretch", "fill", "16:9", "4:3"];
const ASPECT_TOAST = {
    auto: "Aspect Ratio: Fit to Screen",
    stretch: "Aspect Ratio: Stretch",
    fill: "Aspect Ratio: Zoom / Crop",
    "16:9": "Aspect Ratio: 16:9",
    "4:3": "Aspect Ratio: 4:3",
};

// Lucide icon per ring state, per spec: FIT→Maximize2, STRETCH→MoveHorizontal,
// CROP→Maximize, 16:9→Tv, 4:3→Square.
const ASPECT_ICON = {
    auto: Maximize2,
    stretch: MoveHorizontal,
    fill: Maximize,
    "16:9": Tv,
    "4:3": Square,
};

// Tiny manual sub-label under the icon for the two numeric modes — the
// icons alone don't read as "16:9" vs "4:3" at a glance otherwise.
const ASPECT_SUBLABEL = { "16:9": "16:9", "4:3": "4:3" };

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
            <span style={{ flex: 1, display: "flex", alignItems: "center", minWidth: 0 }}>{children}</span>
            {active && <Check size={13} className="check" />}
        </button>
    );
}

// ─── Dual-mode menu shell ────────────────────────────────────────────────────
// Mobile: VideoSidebar (right in landscape / bottom in portrait, 45% size).
// Desktop: old floating PopupMenu. One call site per picker, body unchanged.

function MenuShell({ isMobile, open, onClose, title, children, align }) {
    if (isMobile) {
        return (
            <VideoSidebar open={open} onClose={onClose} title={title}>
                {children}
            </VideoSidebar>
        );
    }
    return (
        <PopupMenu open={open} onClose={onClose} title={title} align={align}>
            {children}
        </PopupMenu>
    );
}

function MenuItem({ isMobile, active, onClick, children, icon }) {
    if (isMobile) {
        return (
            <SidebarItem active={active} onClick={onClick} icon={icon}>
                {children}
                {active && <Check size={13} style={{ marginLeft: "auto", flexShrink: 0 }} />}
            </SidebarItem>
        );
    }
    return (
        <PopupItem active={active} onClick={onClick} icon={icon}>
            {children}
        </PopupItem>
    );
}

function QualityPicker({ open, onClose, isMobile, controlsPhase }) {
    const { state, actions } = usePlayerState();
    return (
        <MenuShell isMobile={isMobile} controlsPhase={controlsPhase} open={open} onClose={onClose} title="Quality">
            <MenuItem
                isMobile={isMobile}
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
            </MenuItem>
            {state.qualityLevels.map((lvl) => (
                <MenuItem
                    isMobile={isMobile}
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
                </MenuItem>
            ))}
        </MenuShell>
    );
}

function SpeedPicker({ open, onClose, isMobile, controlsPhase }) {
    const { state, actions } = usePlayerState();
    return (
        <MenuShell isMobile={isMobile} controlsPhase={controlsPhase} open={open} onClose={onClose} title="Playback Speed">
            {SPEEDS.map((s) => (
                <MenuItem
                    isMobile={isMobile}
                    key={s}
                    active={state.playbackSpeed === s}
                    onClick={() => {
                        actions.setPlaybackSpeed(s);
                        onClose();
                    }}>
                    {s === 1 ? "Normal (1×)" : `${s}×`}
                </MenuItem>
            ))}
        </MenuShell>
    );
}

function SubtitlePicker({ open, onClose, subtitles, isMobile, controlsPhase }) {
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
        <MenuShell isMobile={isMobile} controlsPhase={controlsPhase} open={open} onClose={onClose} title="Subtitles">
            <MenuItem
                isMobile={isMobile}
                active={!state.activeSubtitle}
                onClick={() => {
                    actions.setActiveSubtitle(null);
                }}>
                Off
            </MenuItem>
            {subtitles.map((sub) => (
                <MenuItem
                    isMobile={isMobile}
                    key={sub.url}
                    active={state.activeSubtitle?.url === sub.url}
                    onClick={() => {
                        actions.setActiveSubtitle(sub);
                    }}>
                    <span style={{ display: "flex", alignItems: "center" }}>
                        {getLabel(sub)}
                        {sub.forced && <span style={{ fontSize: 9, color: "#f87171", marginLeft: 4 }}>FORCED</span>}
                        <SourceBadge source={sub.source} />
                    </span>
                </MenuItem>
            ))}

            {/* Settings (size/delay) live in the same panel now — no separate
                "T" trigger button. Only shown once a subtitle track is on. */}
            {state.activeSubtitle && (
                <div style={{ padding: "14px 16px 4px", marginTop: 4, borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", flexDirection: "column", gap: 14 }}>
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
                            style={{ width: "100%", accentColor: "var(--color-primary)" }}
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
                            style={{ width: "100%", accentColor: "var(--color-primary)" }}
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
                            color: "#fff",
                            fontSize: 12,
                            border: "none",
                            cursor: "pointer",
                            fontWeight: 600,
                        }}>
                        Reset to defaults
                    </button>
                </div>
            )}
        </MenuShell>
    );
}

function AspectToggleButton({ size = 19 }) {
    const { state, actions } = usePlayerState();
    const [toast, setToast] = useState(null);
    const toastTimer = useRef(null);

    const cycle = () => {
        const idx = ASPECT_RING.indexOf(state.aspectRatio);
        // Ring-buffer index: unknown/legacy values (e.g. old "1:1") fall back
        // to index 0 rather than NaN-looping.
        const next = ASPECT_RING[((idx === -1 ? 0 : idx) + 1) % ASPECT_RING.length];
        actions.setAspectRatio(next);
        setToast(ASPECT_TOAST[next]);
        clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), 1500);
    };

    useEffect(() => () => clearTimeout(toastTimer.current), []);

    const mode = ASPECT_RING.includes(state.aspectRatio) ? state.aspectRatio : "auto";
    const active = mode !== "auto";
    const sub = ASPECT_SUBLABEL[mode];
    const Icon = ASPECT_ICON[mode];

    return (
        <div style={{ position: "relative" }}>
            <button
                type="button"
                onClick={cycle}
                className="flux-icon-btn"
                style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1, padding: "6px 8px" }}
                aria-label="Aspect ratio">
                <Icon size={size} strokeWidth={1.8} stroke={active ? "var(--color-primary)" : "#fff"} color={active ? "var(--color-primary)" : "#fff"} />
                {sub && <span style={{ fontSize: 8, fontWeight: 700, color: active ? "var(--color-primary)" : "#fff", letterSpacing: "0.2px" }}>{sub}</span>}
            </button>
            {toast && (
                <div
                    style={{
                        position: "absolute",
                        bottom: "calc(100% + 10px)",
                        right: 0,
                        whiteSpace: "nowrap",
                        background: "rgba(10,10,14,0.92)",
                        color: "#fff",
                        fontSize: 12,
                        fontWeight: 600,
                        padding: "7px 12px",
                        borderRadius: 8,
                        zIndex: 50,
                        animation: "flux-popup-in 0.18s cubic-bezier(0.34, 1.56, 0.64, 1)",
                        pointerEvents: "none",
                    }}>
                    {toast}
                </div>
            )}
        </div>
    );
}

function LoopIcon({ loop }) {
    if (loop === "one") return <Repeat1 size={17} strokeWidth={1.8} style={{ color: "var(--color-primary)" }} />;
    if (loop === "all") return <Repeat size={17} strokeWidth={1.8} style={{ color: "var(--color-primary)" }} />;
    return <Repeat size={17} strokeWidth={1.8} style={{ color: "#fff" }} />;
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

function AbRepeatPanel({ open, onClose, videoRef, isMobile, controlsPhase }) {
    const { state, actions } = usePlayerState();
    const { a, b, active } = state.abRepeat;
    const setPoint = (point) => actions.setAbRepeat({ [point]: videoRef.current?.currentTime ?? 0 });
    const clear = () => actions.setAbRepeat({ a: null, b: null, active: false });
    return (
        <MenuShell isMobile={isMobile} controlsPhase={controlsPhase} open={open} onClose={onClose} title="A-B Repeat">
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 16px 12px" }}>
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
        </MenuShell>
    );
}

// ─── Customise Items popup ────────────────────────────────────────────────────

// ─── Equalizer panel (3-band, real Web Audio DSP via VideoCore) ─────────────

// ─── Audio output device label (best-effort) ─────────────────────────────────
// Browsers only expose real device labels (e.g. "My Headphones (Bluetooth)")
// after mic/cam permission has been granted for some reason — we deliberately
// do NOT prompt for that here (would be a confusing, unrelated permission ask
// in a video player). If labels are already available we show the real one;
// otherwise a generic fallback.
function useAudioOutputLabel() {
    const [label, setLabel] = useState("Device Audio");

    useEffect(() => {
        if (!navigator.mediaDevices?.enumerateDevices) return;
        let cancelled = false;
        const check = () => {
            navigator.mediaDevices
                .enumerateDevices()
                .then((devices) => {
                    if (cancelled) return;
                    const out = devices.find((d) => d.kind === "audiooutput" && d.label);
                    if (out) setLabel(out.label);
                })
                .catch(() => {});
        };
        check();
        navigator.mediaDevices.addEventListener?.("devicechange", check);
        return () => {
            cancelled = true;
            navigator.mediaDevices.removeEventListener?.("devicechange", check);
        };
    }, []);

    return label;
}

const AUDIO_EFFECT_OPTIONS = [
    { key: "original", label: "Original", icon: AudioLines },
    { key: "clarity", label: "Clarity", icon: Mic2 },
    { key: "bassBoost", label: "Bass Boost", icon: Speaker },
    { key: "trebleBoost", label: "Treble Boost", icon: Waves },
    { key: "movie", label: "Movie", icon: Film },
    { key: "music", label: "Music", icon: Music2 },
];

const EQ_PRESET_OPTIONS = [
    { key: "custom", label: "Custom" },
    { key: "normal", label: "Normal" },
    { key: "classical", label: "Classical" },
    { key: "dance", label: "Dance" },
    { key: "flat", label: "Flat" },
    { key: "folk", label: "Folk" },
    { key: "heavyMetal", label: "Heavy Metal" },
    { key: "hipHop", label: "Hip Hop" },
    { key: "jazz", label: "Jazz" },
    { key: "pop", label: "Pop" },
    { key: "rock", label: "Rock" },
];
const EQ_BAND_KEYS = [
    { key: "b60", hz: "60 Hz" },
    { key: "b230", hz: "230 Hz" },
    { key: "b910", hz: "910 Hz" },
    { key: "b4000", hz: "4000 Hz" },
    { key: "b14000", hz: "14000 Hz" },
];

function DecoderLockedNotice({ onSwitch }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "28px 20px" }}>
            <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                <Lock size={20} color="rgba(255,255,255,0.85)" style={{ flexShrink: 0, marginTop: 2 }} />
                <p style={{ color: "rgba(255,255,255,0.85)", fontSize: 14, lineHeight: 1.5, margin: 0 }}>
                    Audio effects are not available in HW decoder mode. Switch to HW+ decoder or SW decoder mode to enable.
                </p>
            </div>
            <div style={{ display: "flex", gap: 8, paddingLeft: 34 }}>
                <button
                    onClick={() => onSwitch("hw+")}
                    style={{
                        padding: "7px 14px",
                        borderRadius: 8,
                        border: "1px solid var(--color-primary)",
                        background: "transparent",
                        color: "var(--color-primary)",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                    }}>
                    Use HW+
                </button>
                <button
                    onClick={() => onSwitch("sw")}
                    style={{
                        padding: "7px 14px",
                        borderRadius: 8,
                        border: "1px solid rgba(255,255,255,0.25)",
                        background: "transparent",
                        color: "#fff",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                    }}>
                    Use SW
                </button>
            </div>
        </div>
    );
}

const MOCK_AUDIO_TRACKS = ["HDHub4u.Ms - Hindi", "HDHub4u.Ms - English"];

function RadioRow({ label, checked, onClick }) {
    return (
        <button
            onClick={onClick}
            style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                width: "100%",
                padding: "13px 16px",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
            }}>
            <span
                style={{
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    border: `2px solid ${checked ? "var(--color-primary)" : "rgba(255,255,255,0.5)"}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                }}>
                {checked && <span style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--color-primary)" }} />}
            </span>
            <span style={{ color: "#fff", fontSize: 14.5 }}>{label}</span>
        </button>
    );
}

function CheckboxRow({ label, checked, onClick }) {
    return (
        <button
            onClick={onClick}
            style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                width: "100%",
                padding: "13px 16px",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
            }}>
            <span
                style={{
                    width: 18,
                    height: 18,
                    borderRadius: 4,
                    border: `2px solid ${checked ? "var(--color-primary)" : "rgba(255,255,255,0.5)"}`,
                    background: checked ? "var(--color-primary)" : "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                }}>
                {checked && <Check size={12} color="#fff" strokeWidth={3} />}
            </span>
            <span style={{ color: "#fff", fontSize: 14.5 }}>{label}</span>
        </button>
    );
}

function DisabledRow({ label }) {
    return <div style={{ padding: "13px 16px", color: "rgba(255,255,255,0.35)", fontSize: 14.5 }}>{label}</div>;
}

function AudioTrackPanel({ open, onClose, isMobile, controlsPhase }) {
    const { state, actions } = usePlayerState();
    return (
        <MenuShell isMobile={isMobile} controlsPhase={controlsPhase} open={open} onClose={onClose} title="Audio Track">
            {MOCK_AUDIO_TRACKS.map((track) => (
                <RadioRow key={track} label={track} checked={state.mockAudioTrack === track} onClick={() => actions.setMockAudioTrack(track)} />
            ))}
            <RadioRow label="Disable" checked={state.mockAudioTrack === "disable"} onClick={() => actions.setMockAudioTrack("disable")} />
            <CheckboxRow label="Use SW audio decoder" checked={state.useSwAudioDecoder} onClick={() => actions.toggleSwAudioDecoder()} />
            <div style={{ height: 1, background: "rgba(255,255,255,0.12)", margin: "8px 0" }} />
            {/* Backend doesn't support these yet — shown disabled, matching
                the reference UI's grayed-out placeholder rows. */}
            <DisabledRow label="Open" />
            <DisabledRow label="Stereo mode" />
            <DisabledRow label="Synchronization" />
            <DisabledRow label="AV sync" />
        </MenuShell>
    );
}

const DECODER_LABELS = { hw: "HW", "hw+": "HW+", sw: "SW" };

function DecoderModePanel({ open, onClose, isMobile, controlsPhase }) {
    const { state, actions } = usePlayerState();
    return (
        <MenuShell isMobile={isMobile} controlsPhase={controlsPhase} open={open} onClose={onClose} title="Decoder">
            {["hw", "hw+", "sw"].map((mode) => (
                <RadioRow key={mode} label={DECODER_LABELS[mode] + (mode === "hw+" ? " (Recommended)" : "")} checked={state.decoderMode === mode} onClick={() => actions.setDecoderMode(mode)} />
            ))}
        </MenuShell>
    );
}

function CircularKnob({ label, value, onChange, disabled }) {
    const knobRef = useRef(null);
    const dragging = useRef(false);

    const angleFor = (v) => -135 + (v / 100) * 270;
    const angle = angleFor(value);
    const handleX = 50 + 38 * Math.cos((angle * Math.PI) / 180);
    const handleY = 50 + 38 * Math.sin((angle * Math.PI) / 180);

    const updateFromEvent = (clientX, clientY) => {
        const rect = knobRef.current?.getBoundingClientRect();
        if (!rect) return;
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        let deg = (Math.atan2(clientY - cy, clientX - cx) * 180) / Math.PI;
        if (deg < -135) deg = -135;
        if (deg > 135) deg = 135;
        const pct = Math.round(((deg + 135) / 270) * 100);
        onChange(Math.max(0, Math.min(100, pct)));
    };

    const onPointerDown = (e) => {
        if (disabled) return;
        dragging.current = true;
        updateFromEvent(e.clientX, e.clientY);
        e.currentTarget.setPointerCapture?.(e.pointerId);
    };
    const onPointerMove = (e) => {
        if (!dragging.current) return;
        updateFromEvent(e.clientX, e.clientY);
    };
    const onPointerUp = () => {
        dragging.current = false;
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, flex: 1, opacity: disabled ? 0.4 : 1 }}>
            <div
                ref={knobRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                style={{
                    position: "relative",
                    width: 92,
                    height: 92,
                    borderRadius: "50%",
                    background: "radial-gradient(circle at 35% 30%, color-mix(in oklch, var(--color-primary) 75%, white 10%), color-mix(in oklch, var(--color-primary) 90%, black 20%))",
                    cursor: disabled ? "default" : "pointer",
                    touchAction: "none",
                    WebkitTapHighlightColor: "transparent",
                }}>
                <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                    <span style={{ color: "#fff", fontSize: 17, fontWeight: 700 }}>{value}%</span>
                </div>
                <div
                    style={{
                        position: "absolute",
                        left: `${handleX}%`,
                        top: `${handleY}%`,
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        background: "#fff",
                        transform: "translate(-50%, -50%)",
                        boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
                        pointerEvents: "none",
                    }}
                />
            </div>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.8)", fontWeight: 600 }}>{label}</span>
        </div>
    );
}

function AudioFxPanel({ open, onClose, isMobile, controlsPhase, initialTab = "effect", onTabChange }) {
    const { state, actions } = usePlayerState();
    const [tab, setTab] = useState(initialTab);
    const deviceLabel = useAudioOutputLabel();
    const locked = state.decoderMode === "hw";

    useEffect(() => {
        if (open) setTab(initialTab);
    }, [open, initialTab]);

    const changeTab = (next) => {
        setTab(next);
        onTabChange?.(next);
    };

    return (
        <MenuShell isMobile={isMobile} controlsPhase={controlsPhase} open={open} onClose={onClose} title={tab === "effect" ? "Audio Effect" : "Equalizer"}>
            <div style={{ display: "flex", padding: "0 16px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                {[
                    { key: "effect", label: "Audio Effect" },
                    { key: "equalizer", label: "Equalizer" },
                ].map((t) => (
                    <button
                        key={t.key}
                        onClick={() => changeTab(t.key)}
                        style={{
                            flex: 1,
                            padding: "10px 0",
                            background: "none",
                            border: "none",
                            borderBottom: tab === t.key ? "2px solid var(--color-primary)" : "2px solid transparent",
                            color: tab === t.key ? "#fff" : "rgba(255,255,255,0.5)",
                            fontSize: 13,
                            fontWeight: 700,
                            cursor: "pointer",
                            WebkitTapHighlightColor: "transparent",
                        }}>
                        {t.label}
                    </button>
                ))}
            </div>

            {locked ? (
                <DecoderLockedNotice onSwitch={actions.setDecoderMode} />
            ) : (
                <div style={{ padding: "14px 16px 8px", display: "flex", alignItems: "center", gap: 10, color: "rgba(255,255,255,0.8)", fontSize: 13 }}>
                    <Headphones size={16} />
                    <span>{deviceLabel}</span>
                </div>
            )}

            {!locked && tab === "effect" && (
                <div style={{ padding: "8px 16px 16px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    {AUDIO_EFFECT_OPTIONS.map((opt) => {
                        const Icon = opt.icon;
                        const active = state.audioEffectPreset === opt.key;
                        return (
                            <button
                                key={opt.key}
                                onClick={() => actions.setAudioEffectPreset(opt.key)}
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: 8,
                                    padding: "14px 6px",
                                    borderRadius: 10,
                                    border: active ? "1px solid var(--color-primary)" : "1px solid rgba(255,255,255,0.15)",
                                    background: active ? "color-mix(in oklch, var(--color-primary) 22%, transparent)" : "transparent",
                                    cursor: "pointer",
                                    WebkitTapHighlightColor: "transparent",
                                }}>
                                <Icon size={20} color={active ? "var(--color-primary)" : "#fff"} />
                                <span style={{ fontSize: 11.5, fontWeight: 600, color: active ? "var(--color-primary)" : "#fff", textAlign: "center" }}>{opt.label}</span>
                            </button>
                        );
                    })}
                </div>
            )}

            {!locked && tab === "equalizer" && (
                <div style={{ padding: "4px 16px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 10, color: "#fff", fontSize: 14, fontWeight: 600 }}>
                            <SlidersHorizontal size={16} />
                            Equalizer
                        </span>
                        <button
                            onClick={() => actions.toggleEq()}
                            role="switch"
                            aria-checked={state.eqEnabled}
                            style={{
                                width: 44,
                                height: 26,
                                borderRadius: 999,
                                border: "none",
                                position: "relative",
                                background: state.eqEnabled ? "var(--color-primary)" : "rgba(255,255,255,0.2)",
                                cursor: "pointer",
                                flexShrink: 0,
                                transition: "background 0.15s",
                            }}>
                            <span
                                style={{
                                    position: "absolute",
                                    top: 3,
                                    left: state.eqEnabled ? 21 : 3,
                                    width: 20,
                                    height: 20,
                                    borderRadius: "50%",
                                    background: "#fff",
                                    transition: "left 0.15s",
                                }}
                            />
                        </button>
                    </div>

                    <div className="flux-sidebar-scroll" style={{ display: "flex", gap: 6, padding: "6px 0 16px", overflowX: state.eqEnabled ? "auto" : "hidden" }}>
                        {EQ_PRESET_OPTIONS.map(({ key, label }) => (
                            <button
                                key={key}
                                onClick={() => actions.setEqPreset(key)}
                                disabled={!state.eqEnabled}
                                style={{
                                    flexShrink: 0,
                                    padding: "6px 12px",
                                    borderRadius: 999,
                                    border: "none",
                                    background: state.eqPreset === key ? "var(--color-primary)" : "rgba(255,255,255,0.08)",
                                    color: state.eqPreset === key ? "#fff" : "rgba(255,255,255,0.7)",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: state.eqEnabled ? "pointer" : "default",
                                    opacity: state.eqEnabled ? 1 : 0.5,
                                    WebkitTapHighlightColor: "transparent",
                                }}>
                                {label}
                            </button>
                        ))}
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-around", gap: 4 }}>
                        {EQ_BAND_KEYS.map(({ key, hz }) => {
                            const value = state.eqBands?.[key] ?? 0;
                            return (
                                <div key={key} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, flex: 1 }}>
                                    <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.5)", fontFamily: "ui-monospace,monospace" }}>{value > 0 ? `+${value}` : value} dB</span>
                                    <input
                                        type="range"
                                        min={-12}
                                        max={12}
                                        step={1}
                                        value={value}
                                        onChange={(e) => actions.setEqBands({ [key]: +e.target.value })}
                                        disabled={!state.eqEnabled}
                                        style={{
                                            writingMode: "vertical-lr",
                                            direction: "rtl",
                                            width: 24,
                                            height: 100,
                                            accentColor: "var(--color-primary)",
                                            opacity: state.eqEnabled ? 1 : 0.4,
                                        }}
                                    />
                                    <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.6)", fontWeight: 600 }}>{hz}</span>
                                </div>
                            );
                        })}
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-around", gap: 12, marginTop: 22, paddingTop: 18, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                        <CircularKnob label="Bass Boost" value={state.bassBoostLevel} onChange={actions.setBassBoostLevel} disabled={!state.eqEnabled} />
                        <CircularKnob label="Virtualizer" value={state.virtualizerLevel} onChange={actions.setVirtualizerLevel} disabled={!state.eqEnabled} />
                    </div>
                </div>
            )}
        </MenuShell>
    );
}

// ─── Sleep Timer panel (full overlay, matches reference screenshot) ─────────

function SleepTimerPanel({ open, onClose, isMobile, controlsPhase }) {
    const { state, actions } = usePlayerState();
    // Raw digit buffer, phone-dialer style: each digit pressed shifts left,
    // pushing existing digits further left (e.g. press 1 → 0001 → "00h01m",
    // press 5 → 0015 → "00h15m", press 3 → 0153 → "01h53m"). Max 4 digits.
    const [digits, setDigits] = useState("0000");

    const hours = parseInt(digits.slice(0, 2), 10);
    const minsRaw = parseInt(digits.slice(2, 4), 10);
    const minutes = Math.min(59, minsRaw); // clamp invalid minute entry (e.g. "75") down to 59

    const pressDigit = (d) => {
        setDigits((prev) => (prev + d).slice(-4));
    };
    const totalMs = (hours * 60 + minutes) * 60 * 1000;
    const isRunning = !!state.sleepTimerEndsAt;

    const handleStart = () => {
        if (totalMs <= 0) return;
        actions.setSleepTimer(Date.now() + totalMs);
        onClose();
    };
    const handleStop = () => {
        actions.setSleepTimer(null);
        setDigits("0000");
    };

    return (
        <MenuShell isMobile={isMobile} controlsPhase={controlsPhase} open={open} onClose={onClose} title="Sleep Timer">
            <div style={{ display: "flex", flexDirection: "column", padding: "4px 20px 0", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 4 }}>
                    <span style={{ color: "#fff", fontSize: 32, fontWeight: 800, lineHeight: 1 }}>
                        {String(hours).padStart(2, "0")}
                        <span style={{ fontSize: 14, fontWeight: 600, opacity: 0.6 }}>h</span>
                    </span>
                    <span style={{ color: "#fff", fontSize: 32, fontWeight: 800, lineHeight: 1, marginLeft: 6 }}>
                        {String(minutes).padStart(2, "0")}
                        <span style={{ fontSize: 14, fontWeight: 600, opacity: 0.6 }}>m</span>
                    </span>
                </div>
                <div style={{ height: 1, background: "rgba(255,255,255,0.18)" }} />

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, justifyContent: "center", maxWidth: 150, margin: "0 auto", width: "100%" }}>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                        <button
                            key={n}
                            onClick={() => pressDigit(String(n))}
                            style={{
                                width: "100%",
                                maxWidth: 34,
                                aspectRatio: "1",
                                margin: "0 auto",
                                borderRadius: "50%",
                                background: "rgba(255,255,255,0.08)",
                                border: "1px solid rgba(255,255,255,0.1)",
                                color: "#fff",
                                fontSize: 13,
                                fontWeight: 600,
                                cursor: "pointer",
                            }}>
                            {n}
                        </button>
                    ))}
                    <div />
                    <button
                        onClick={() => pressDigit("0")}
                        style={{
                            width: "100%",
                            maxWidth: 34,
                            aspectRatio: "1",
                            margin: "0 auto",
                            borderRadius: "50%",
                            background: "rgba(255,255,255,0.08)",
                            border: "1px solid rgba(255,255,255,0.1)",
                            color: "#fff",
                            fontSize: 13,
                            fontWeight: 600,
                            cursor: "pointer",
                        }}>
                        0
                    </button>
                </div>

                <label style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center", cursor: "pointer", marginTop: 2 }}>
                    <input type="checkbox" checked={state.sleepTimerPlayToEnd} onChange={() => actions.toggleSleepPlayToEnd()} style={{ width: 15, height: 15, accentColor: "#6366f1" }} />
                    <span style={{ color: "rgba(255,255,255,0.8)", fontSize: 12 }}>Play last media to the end</span>
                </label>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 20px", marginTop: 6, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                <button
                    onClick={handleStop}
                    disabled={!isRunning}
                    style={{
                        background: "none",
                        border: "none",
                        color: isRunning ? "#4d8dff" : "rgba(255,255,255,0.25)",
                        fontSize: 13,
                        fontWeight: 700,
                        letterSpacing: "0.04em",
                        cursor: isRunning ? "pointer" : "default",
                    }}>
                    STOP
                </button>
                <button
                    onClick={handleStart}
                    disabled={totalMs <= 0}
                    style={{
                        background: "none",
                        border: "none",
                        color: totalMs > 0 ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.25)",
                        fontSize: 13,
                        fontWeight: 700,
                        letterSpacing: "0.04em",
                        cursor: totalMs > 0 ? "pointer" : "default",
                    }}>
                    START
                </button>
            </div>
        </MenuShell>
    );
}

const ALL_QUICK_ITEMS = {
    nightMode: { label: "Night Mode", icon: Moon },
    customise: { label: "Customise Items", icon: PenLine },
    shuffle: { label: "Shuffle", icon: Shuffle },
    loop: { label: "Loop", icon: Repeat },
    mute: { label: "Mute", icon: VolumeOff },
    sleepTimer: { label: "Sleep Timer", icon: Timer },
    abRepeat: { label: "A - B Repeat", icon: Repeat }, // visual is the text glyph below (iconOverride), this is just a fallback
    audioFx: { label: "Audio Effect", icon: AudioLines },
    eq: { label: "Equalizer", icon: SlidersHorizontal },
    speed: { label: "Speed", icon: Gauge }, // visual is the "1×" text glyph below (iconOverride), this is just a fallback
    screenshot: { label: "Screenshot", icon: Camera },
    bgPlay: { label: "Background Play", icon: Headphones },
    rotation: { label: "Screen Rotation", icon: MdOutlineScreenRotation },
};

// Keys whose handler opens a sidebar/popup menu (toggleMenu(...)). These
// need the row collapse animation to finish FIRST, then the sidebar opens
// — opening it mid-collapse was rendering against stale layout. Everything
// else (mute, shuffle, pip, etc.) is an instant toggle with nothing to wait
// for, so it fires immediately and the row just collapses alongside it.
const QUICK_KEYS_WITH_SIDEBAR = new Set(["customise", "sleepTimer", "abRepeat", "audioFx", "eq", "speed"]);

function CustomiseItemsPanel({ open, onClose, isMobile, controlsPhase }) {
    const { state, actions } = usePlayerState();
    const dragIndex = useRef(null);
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
        <MenuShell isMobile={isMobile} controlsPhase={controlsPhase} open={open} onClose={onClose} title="Customise Items">
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", padding: "0 16px 8px", margin: 0 }}>Drag to reorder. Top 5 show in the quick row.</p>
            <div style={{ display: "flex", flexDirection: "column", padding: "0 12px 8px" }}>
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
        </MenuShell>
    );
}

// ─── Quick Icon Row ───────────────────────────────────────────────────────────

function QuickIconRow({ videoRef, containerRef, openMenu, toggleMenu, controlsPhase, isPortraitOverride, isMobile }) {
    const { state, actions } = usePlayerState();
    const [expanded, setExpanded] = useState(false);
    const [slideOut, setSlideOut] = useState(false); // true during the collapse slide animation
    const [audioFxTab, setAudioFxTab] = useState("effect"); // which tab the shared eq/audioFx panel opens on
    const scrollRef = useRef(null);
    const overscrollStart = useRef(null); // { x, atEnd, atStart } captured at touchstart, used to detect swipe-past-boundary in either direction

    // FIX: auto-collapse the expanded row back to the 5-icon quick view once
    // controls fade out — so it doesn't silently stay expanded and pop back
    // open mid-expanded the next time controls reappear.
    useEffect(() => {
        if (controlsPhase === "HIDDEN" || controlsPhase === "ANIMATING_OUT") {
            setExpanded(false);
            setSlideOut(false);
        }
    }, [controlsPhase]);

    const collapseWithSlide = useCallback(() => {
        setSlideOut(true);
        // Slowed down per feedback — was 220ms/24px (felt too fast/subtle
        // to read as an intentional slide). 420ms with cubic-bezier ease-out
        // and a larger travel distance reads as a real, deliberate motion
        // instead of a flicker. Timeout below must match the CSS transition
        // duration exactly, or the icon set swaps mid-animation.
        setTimeout(() => {
            setExpanded(false);
            setSlideOut(false);
        }, 420);
    }, []);

    const expandWithSlide = useCallback(() => {
        setExpanded(true);
    }, []);

    // Swipe-past-the-boundary detection, symmetric both directions:
    //   - At the RIGHT scroll edge (end), pulling further left (negative
    //     dx) collapses — nowhere left to scroll, so the gesture becomes
    //     "swipe to collapse" instead of a dead pull.
    //   - At the LEFT scroll edge (start), pulling further right (positive
    //     dx) expands — same idea, mirrored. Works whether currently
    //     collapsed or expanded; collapsed view has no scroll at all so
    //     it's always "at the start" by definition.
    const handleTouchStart = useCallback((e) => {
        const el = scrollRef.current;
        if (!el) return;
        const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
        const atStart = el.scrollLeft <= 2;
        overscrollStart.current = {
            x: e.touches[0].clientX,
            atEnd,
            atStart,
        };
    }, []);

    const handleTouchMove = useCallback(
        (e) => {
            if (!overscrollStart.current) return;
            const dx = e.touches[0].clientX - overscrollStart.current.x;
            // Pulling further left (negative dx) past an already-maxed
            // scroll position, beyond a small threshold, triggers collapse.
            if (expanded && overscrollStart.current.atEnd && dx < -40) {
                collapseWithSlide();
                overscrollStart.current = null;
                return;
            }
            // Pulling right (positive dx) while already at the left edge —
            // expand. Collapsed view is always "at start" since it never
            // scrolls, so this fires on a plain left-to-right swipe there.
            if (!expanded && overscrollStart.current.atStart && dx > 40) {
                expandWithSlide();
                overscrollStart.current = null;
            }
        },
        [expanded, collapseWithSlide, expandWithSlide],
    );

    const handlers = {
        nightMode: { onClick: () => actions.toggleNightMode(), active: state.nightMode },
        customise: { onClick: () => toggleMenu("customise"), active: openMenu === "customise" },
        shuffle: { onClick: () => actions.toggleShuffle(), active: state.shuffle },
        loop: { onClick: () => actions.cycleLoop(), active: state.loop !== "none", iconOverride: <LoopIcon loop={state.loop} /> },
        mute: { onClick: () => actions.setMuted(!state.muted), active: state.muted },
        sleepTimer: { onClick: () => toggleMenu("sleepTimer"), active: !!state.sleepTimerEndsAt || openMenu === "sleepTimer" },
        abRepeat: {
            onClick: () => toggleMenu("abRepeat"),
            active: state.abRepeat.active || openMenu === "abRepeat",
            iconOverride: (
                <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", lineHeight: 1.05, textAlign: "center" }}>
                    A→
                    <br />
                    ←B
                </span>
            ),
        },
        audioFx: {
            onClick: () => {
                setAudioFxTab("effect");
                toggleMenu("eq");
            },
            active: openMenu === "eq" && audioFxTab === "effect",
        },
        eq: {
            onClick: () => {
                setAudioFxTab("equalizer");
                toggleMenu("eq");
            },
            active: state.eqEnabled || (openMenu === "eq" && audioFxTab === "equalizer"),
        },
        speed: {
            onClick: () => toggleMenu("speedSlider"),
            active: state.playbackSpeed !== 1,
            iconOverride: <span style={{ fontSize: 11, fontWeight: 700, color: "#fff" }}>{state.playbackSpeed}×</span>,
        },
        screenshot: {
            onClick: () => {
                const video = videoRef?.current;
                if (!video || !video.videoWidth) return;
                const canvas = document.createElement("canvas");
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                canvas.toBlob((blob) => {
                    if (!blob) return;
                    const url = URL.createObjectURL(blob);
                    // Open in a new tab instead of triggering a forced
                    // download — Chrome blocks/warns on programmatic blob
                    // downloads from plain http:// origins ("not saved
                    // securely"), which this LAN server runs on. Opening
                    // the image directly isn't subject to that same
                    // download-specific policy; long-press/right-click to
                    // save from there works normally.
                    const win = window.open(url, "_blank");
                    if (!win) {
                        // Popup blocked — fall back to a same-tab navigation
                        // so the screenshot still isn't silently lost.
                        window.location.href = url;
                    }
                    setTimeout(() => URL.revokeObjectURL(url), 60000);
                }, "image/png");
            },
        },
        bgPlay: { onClick: () => actions.toggleBackgroundPlay(), active: state.backgroundPlay },
        rotation: {
            onClick: () => containerRef?.current?._toggleRotation?.(),
            active: isPortraitOverride,
            iconOverride: isPortraitOverride ? <MdScreenLockRotation size={17} color="var(--color-primary)" /> : <MdOutlineScreenRotation size={17} color="#fff" />,
        },
    };
    const order = state.quickIconOrder;
    const visibleKeys = expanded ? Object.keys(ALL_QUICK_ITEMS) : order.slice(0, 5);
    return (
        <div
            ref={scrollRef}
            className="flux-quick-row"
            data-gesture-exclude="true"
            onTouchStart={(e) => {
                e.stopPropagation();
                handleTouchStart(e);
            }}
            onTouchMove={(e) => {
                e.stopPropagation();
                handleTouchMove(e);
            }}
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
                // Slide-out-to-collapse animation: when triggered, the whole
                // row translates left and fades, then swaps back to the
                // collapsed 5-icon set once the transition finishes (see
                // collapseWithSlide's matching 420ms timeout above). 60px
                // travel + ease-out cubic-bezier reads as a real slide
                // rather than a quick flicker.
                transform: slideOut ? "translateX(-60px)" : "translateX(0)",
                opacity: slideOut ? 0 : 1,
                transition: "transform 420ms cubic-bezier(0.16, 1, 0.3, 1), opacity 420ms cubic-bezier(0.16, 1, 0.3, 1)",
            }}>
            {visibleKeys.map((key) => {
                const item = ALL_QUICK_ITEMS[key];
                if (!item) return null;
                const h = handlers[key] || {};
                const Icon = item.icon;
                return (
                    <div key={key} style={{ position: "relative", flexShrink: 0 }}>
                        <button
                            onClick={() => {
                                const needsSidebar = QUICK_KEYS_WITH_SIDEBAR.has(key);
                                if (expanded && needsSidebar) {
                                    // Collapse the row first, then open the
                                    // sidebar once the collapse animation
                                    // finishes — opening it mid-collapse
                                    // rendered against stale layout. Plain
                                    // toggles (mute, shuffle, pip, etc.) have
                                    // no sidebar to wait for, so the row stays
                                    // exactly as the user left it for those.
                                    setSlideOut(true);
                                    setTimeout(() => {
                                        setExpanded(false);
                                        setSlideOut(false);
                                    }, 420);
                                    setTimeout(() => h.onClick?.(), 420);
                                } else {
                                    h.onClick?.();
                                }
                            }}
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
                                WebkitTapHighlightColor: "transparent",
                                WebkitUserSelect: "none",
                                userSelect: "none",
                                outline: "none",
                                appearance: "none",
                                WebkitAppearance: "none",
                            }}>
                            <div
                                style={{
                                    width: 40,
                                    height: 40,
                                    borderRadius: "50%",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    background: h.active ? "color-mix(in oklch, var(--color-primary) 35%, transparent)" : "rgba(0,0,0,0.4)",
                                    border: "1px solid rgba(255,255,255,0.1)",
                                    WebkitTapHighlightColor: "transparent",
                                    outline: "none",
                                }}>
                                {h.iconOverride || <Icon size={20} strokeWidth={2} stroke={h.active ? "var(--color-primary)" : "#fff"} color={h.active ? "var(--color-primary)" : "#fff"} />}
                            </div>
                            {expanded && <span style={{ fontSize: 9.5, color: "rgba(255,255,255,0.85)", textAlign: "center", lineHeight: 1.15, fontWeight: 500 }}>{item.label}</span>}
                        </button>
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
                        WebkitTapHighlightColor: "transparent",
                        outline: "none",
                    }}
                    aria-label="More options">
                    <ChevronRight size={16} color="#fff" strokeWidth={2} />
                </button>
            )}

            <CustomiseItemsPanel open={openMenu === "customise"} onClose={() => toggleMenu(null)} isMobile={isMobile} controlsPhase={controlsPhase} />
            <AbRepeatPanel open={openMenu === "abRepeat"} onClose={() => toggleMenu(null)} videoRef={videoRef} isMobile={isMobile} controlsPhase={controlsPhase} />
            <AudioFxPanel open={openMenu === "eq"} onClose={() => toggleMenu(null)} isMobile={isMobile} controlsPhase={controlsPhase} initialTab={audioFxTab} onTabChange={setAudioFxTab} />
        </div>
    );
}

// ─── PlayerControls ───────────────────────────────────────────────────────────

export default function PlayerControls({ mediaInfo, videoRef, containerRef, subtitles = [], onBack, onShowControls, controlsPhase = "VISIBLE", isPortraitOverride = false }) {
    const { state, actions } = usePlayerState();
    const isMobile = useIsMobile();
    const [openMenu, setOpenMenu] = useState(null);

    const activeQualityLabel = state.activeQuality === -1 ? (state.qualityLevels.length ? "Auto" : "") : state.qualityLevels[state.activeQuality]?.label || "";

    const toggleMenu = useCallback((menu) => setOpenMenu((v) => (v === menu ? null : menu)), []);
    const closeMenu = useCallback(() => setOpenMenu(null), []);

    // VideoSidebar renders through a portal straight to document.body to
    // dodge parent opacity cascades — but that means interaction inside an
    // open sidebar (dragging a slider, tapping a list item) never bubbles up
    // through PlayerControls' own DOM tree, so it never reaches the
    // onClickCapture/onPointerDownCapture handlers on the top/center/bottom
    // bars that normally reset the 3s inactivity countdown. Without this,
    // controlsPhase can still march to ANIMATING_OUT/HIDDEN purely from idle
    // time while a menu is open, which visually drags the open sidebar's
    // containing controls layer down with it. Re-firing onShowControls on
    // an interval for as long as openMenu is set keeps the countdown
    // perpetually fresh, so the controls + whatever sidebar/menu is open
    // stay visible until the user explicitly closes it.
    useEffect(() => {
        if (!openMenu) return;
        onShowControls?.();
        const id = setInterval(() => onShowControls?.(), 1000);
        return () => clearInterval(id);
    }, [openMenu, onShowControls]);

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
    const iconTiny = isMobile ? 24 : 16;

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
                // FIX (no fade-in on appear): ANIMATING_IN and VISIBLE both
                // previously mapped to opacity:1 — but this component is
                // UNMOUNTED while HIDDEN and remounts fresh when controls
                // reappear. React's first painted frame on a fresh mount
                // can't "transition into" a value; it just IS that value.
                // Since ANIMATING_IN's first paint was already opacity:1,
                // there was nothing for the CSS transition to animate FROM
                // — hide worked (1→0 across two renders while staying
                // mounted) but show silently didn't (mounted already at 1).
                // ANIMATING_IN now paints at 0 on that first frame; the
                // next render (phase flips to VISIBLE after FADE_IN_MS)
                // changes it to 1, which is what the transition actually
                // animates.
                opacity: controlsPhase === "ANIMATING_OUT" || controlsPhase === "ANIMATING_IN" ? 0 : 1,
                transition: controlsPhase === "ANIMATING_OUT" ? "opacity 300ms linear" : "opacity 150ms cubic-bezier(0.16, 1, 0.3, 1)",
                // FIX ("nothing happens on second tap"): this was
                // pointerEvents:"auto", making the ENTIRE full-screen
                // overlay one giant hit-test box — including the visually
                // empty middle area over the video. Every tap there got
                // swallowed by this element instead of reaching the
                // gesture layer below, so toggleControls() (which lives on
                // PlayerGestures/VideoCore) never fired on that second tap.
                // pointer-events:none here lets empty-area taps pass
                // through; auto is re-enabled only on the actual bars
                // below (top/center/bottom), which already had
                // pointer-events-auto — the capture handler that marks
                // activity moved onto those three specifically instead of
                // sitting on this full-screen root.
                pointerEvents: "none",
            }}>
            {/* Sleep Timer — full-screen overlay, not an anchored popup like
                the others (matches reference screenshot's full-coverage
                layout). Rendered at this level since QuickIconRow's own
                container doesn't span the whole player. */}
            <SleepTimerPanel open={openMenu === "sleepTimer"} onClose={() => setOpenMenu(null)} isMobile={isMobile} controlsPhase={controlsPhase} />
            <SpeedSliderOverlay open={openMenu === "speedSlider"} onClose={() => setOpenMenu(null)} />

            {/* ══════════════════════════════════════════════════════════════════
                TOP BAR
                Order left→right: Back button → Title → [Quality] [Audio Track]
                [Subtitle] [Decoder] [More ⋮] → Quick icon row (mobile only,
                below the title row).
                To reorder the right-side icons, just move their numbered
                blocks (1-5) up/down inside the "shrink-0 ml-2" div below.
                ══════════════════════════════════════════════════════════════════ */}
            <div
                className="flex flex-col gap-3 px-3 pt-5 flux-controls-top"
                style={{
                    pointerEvents: controlsPhase === "ANIMATING_OUT" || openMenu === "speedSlider" ? "none" : "auto",
                    opacity: openMenu === "speedSlider" ? 0 : 1,
                    transition: "opacity 200ms ease",
                }}
                onClickCapture={onShowControls}
                onPointerDownCapture={onShowControls}>
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                        <button onClick={onBack} className="flux-icon-btn p-2 shrink-0" aria-label="Go back" style={{ color: "rgba(255,255,255,0.9)" }}>
                            <ChevronLeft size={24} strokeWidth={2.5} />
                        </button>
                        <div className="min-w-0 flex-1">
                            <p className="text-white font-semibold text-sm sm:text-base leading-tight truncate">{title}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                        {activeQualityLabel && !isMobile && <span className="flux-quality-badge">{activeQualityLabel}</span>}

                        {/* ── 1. QUALITY / RESOLUTION button ───────────────────────────
                            Opens <QualityPicker>. Only shows if there's more than
                            one quality level available (state.qualityLevels). */}
                        {state.qualityLevels.length > 0 && (
                            <div style={{ position: "relative" }}>
                                <button onClick={() => toggleMenu("quality")} className="flux-icon-btn p-2" aria-label="Quality">
                                    {state.activeQuality !== -1 ? <MdHighQuality size={iconTiny} color="var(--color-primary)" /> : <MdOutlineHighQuality size={iconTiny} color="#fff" />}
                                </button>
                                <QualityPicker open={openMenu === "quality"} onClose={closeMenu} isMobile={isMobile} controlsPhase={controlsPhase} />
                            </div>
                        )}

                        {/* ── 2. AUDIO TRACK button (music-note icon) ──────────────────
                            Opens <AudioTrackPanel> — currently a MOCK UI (backend
                            doesn't support real multi-track audio yet). Swap
                            MOCK_AUDIO_TRACKS for state.audioTracks once it does. */}
                        <div style={{ position: "relative" }}>
                            <button onClick={() => toggleMenu("audioTrack")} className="flux-icon-btn p-2" aria-label="Audio track">
                                <MdMusicNote size={iconTiny} />
                            </button>
                            <AudioTrackPanel open={openMenu === "audioTrack"} onClose={closeMenu} isMobile={isMobile} controlsPhase={controlsPhase} />
                        </div>

                        {/* ── 3. SUBTITLE button ────────────────────────────────────────
                            Opens <SubtitlePicker>. Highlights (active state) when
                            a subtitle track is currently selected. */}
                        <div style={{ position: "relative" }}>
                            <IconBtn onClick={() => toggleMenu("sub")} active={!!state.activeSubtitle} size="sm" label="Subtitles">
                                <Subtitles size={iconTiny} strokeWidth={1.8} />
                            </IconBtn>
                            <SubtitlePicker open={openMenu === "sub"} onClose={closeMenu} subtitles={subtitles} isMobile={isMobile} controlsPhase={controlsPhase} />
                        </div>

                        {/* ── 4. DECODER badge (HW / HW+ / SW) ──────────────────────────
                            Opens <DecoderModePanel>. Text label always shows the
                            current mode — see DECODER_LABELS for the short names. */}
                        <div style={{ position: "relative" }}>
                            <button
                                onClick={() => toggleMenu("decoder")}
                                className="flux-icon-btn"
                                style={{ padding: "6px 10px", fontSize: 13, fontWeight: 700, color: "#fff" }}
                                aria-label="Decoder mode">
                                {DECODER_LABELS[state.decoderMode]}
                            </button>
                            <DecoderModePanel open={openMenu === "decoder"} onClose={closeMenu} isMobile={isMobile} controlsPhase={controlsPhase} />
                        </div>

                        {/* ── 5. OVERFLOW (3-dot) menu ──────────────────────────────────
                            Opens a small <MenuShell> with placeholder rows (Cast/
                            Share/Details). Add real rows here as features land —
                            just add more <DisabledRow>/<MenuItem> children below. */}
                        <div style={{ position: "relative" }}>
                            <button onClick={() => toggleMenu("overflow")} className="flux-icon-btn p-2" aria-label="More options">
                                <MoreVertical size={20} strokeWidth={2} /> {/* iconTiny */}
                            </button>
                            <MenuShell isMobile={isMobile} controlsPhase={controlsPhase} open={openMenu === "overflow"} onClose={closeMenu} title="More" align="left">
                                <DisabledRow label="Cast" />
                                <DisabledRow label="Share" />
                                <DisabledRow label="Details" />
                            </MenuShell>
                        </div>
                    </div>
                </div>

                {/* ── Quick icon row (mobile only — matches MX Player reference) ──
                    Lives inside the top bar div now (same gradient background,
                    same fade-out lifecycle) instead of as a separate sibling.
                    Gap to the header row above is the gap-3 (12px) on the
                    parent flex-col — adjust that single class to retune. */}
                {isMobile && (
                    <QuickIconRow
                        videoRef={videoRef}
                        containerRef={containerRef}
                        openMenu={openMenu}
                        toggleMenu={toggleMenu}
                        controlsPhase={controlsPhase}
                        isPortraitOverride={isPortraitOverride}
                        isMobile={isMobile}
                    />
                )}
            </div>

            {/* ── Center controls (desktop) ─────────────────────────────────── */}
            {!isMobile && (
                <div
                    className="flex items-center justify-center gap-5"
                    style={{ pointerEvents: controlsPhase === "ANIMATING_OUT" ? "none" : "auto" }}
                    onClickCapture={onShowControls}
                    onPointerDownCapture={onShowControls}>
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

            {/* ══════════════════════════════════════════════════════════════════
                BOTTOM BAR
                Top row (mobile only): current time / duration.
                Seek bar.
                Main row, 3 zones: [Lock] ... [skip-back / play-pause /
                skip-forward, centered] ... [loop/speed/PiP/fullscreen, right].
                Desktop has its own separate big center-play cluster further
                up the file (look for "Center controls (desktop)").
                ══════════════════════════════════════════════════════════════════ */}
            <div
                className="px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flux-controls-bottom"
                style={{
                    pointerEvents: controlsPhase === "ANIMATING_OUT" || openMenu === "speedSlider" ? "none" : "auto",
                    opacity: openMenu === "speedSlider" ? 0 : 1,
                    transition: "opacity 200ms ease",
                }}
                onClickCapture={onShowControls}
                onPointerDownCapture={onShowControls}>
                {isMobile && (
                    <div className="flex items-center justify-between px-1 mb-1.5">
                        <TimeDisplay />
                    </div>
                )}

                <SeekBar videoRef={videoRef} />

                <div className={`flex items-center mt-1 ${isMobile ? "justify-between" : "gap-1"}`} style={{ position: isMobile ? "relative" : "static" }}>
                    {/* ── LOCK button (mobile, far-left) ──────────────────────────── */}
                    {isMobile && (
                        <button
                            onClick={() => {
                                actions.setLocked(true);
                                actions.setControlsVisible(false);
                            }}
                            className="flux-icon-btn p-3"
                            aria-label="Lock screen">
                            <UnlockKeyhole size={20} strokeWidth={2.5} stroke="#fff" />
                        </button>
                    )}

                    {/* ── PLAYBACK cluster: skip-back / play-pause / skip-forward ───
                        On mobile this is pinned to the exact horizontal center of
                        the screen (position:absolute + translateX(-50%)) so it
                        stays centered regardless of how wide the lock button or
                        the right-side icon cluster happen to be. On desktop it's
                        just a normal flex item (see the separate desktop center
                        controls block above, which already centers itself). */}
                    <div className="flex items-center gap-0.5" style={isMobile ? { position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)" } : undefined}>
                        <button type="button" onClick={() => seek(-10)} className={`flex flex-col items-center gap-0.5 flux-icon-btn ${isMobile ? "p-3" : "p-2"}`} aria-label="Back 10 seconds">
                            <SkipBack size={iconSub} strokeWidth={1.8} />
                        </button>
                        {/* Play/Pause — now sits BETWEEN skip-back and skip-forward
                            (previously was to the left of skip-back). */}
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
                        <button type="button" onClick={() => seek(10)} className={`flex flex-col items-center gap-0.5 flux-icon-btn ${isMobile ? "p-3" : "p-2"}`} aria-label="Forward 10 seconds">
                            <SkipForward size={iconSub} strokeWidth={1.8} />
                        </button>
                    </div>

                    {/* ── Desktop-only volume/time, sits where the playback cluster
                        used to live before the mobile centering change above. ── */}
                    {!isMobile && (
                        <div className="flex items-center gap-0.5">
                            <VolumeControl />
                            <TimeDisplay style={{ marginLeft: 8 }} />
                        </div>
                    )}

                    {!isMobile && <div style={{ flex: 1 }} />}

                    {/* ── RIGHT-SIDE icon cluster (loop/speed/aspect/PiP/fullscreen) ── */}
                    <div className={`flex items-center shrink-0 ${isMobile ? "gap-0.5" : "gap-0.5"}`}>
                        {!isMobile && (
                            <IconBtn onClick={() => actions.cycleLoop()} active={state.loop !== "none"} size="sm" label="Loop" title={`Loop: ${state.loop}`}>
                                <LoopIcon loop={state.loop} />
                            </IconBtn>
                        )}
                        {!isMobile && (
                            <div style={{ position: "relative" }}>
                                <button
                                    type="button"
                                    onClick={() => toggleMenu("speed")}
                                    style={{
                                        borderRadius: 8,
                                        border: "none",
                                        background: "transparent",
                                        color: state.playbackSpeed !== 1 ? "var(--color-primary)" : "#fff",
                                        fontWeight: 700,
                                        fontSize: 12,
                                        padding: "4px 8px",
                                        cursor: "pointer",
                                        minHeight: "auto",
                                        fontFamily: "ui-monospace,'SF Mono',monospace",
                                        letterSpacing: "0.3px",
                                        WebkitTapHighlightColor: "transparent",
                                    }}
                                    aria-label="Playback speed">
                                    {state.playbackSpeed}×
                                </button>
                                <SpeedPicker open={openMenu === "speed"} onClose={closeMenu} isMobile={isMobile} controlsPhase={controlsPhase} />
                            </div>
                        )}
                        {/* --- Quality (resolution) button moved to the TOP bar --- */}
                        {/* --- Subtitle button moved to the TOP bar --- */}
                        <AspectToggleButton size={isMobile ? 19 : 17} />
                        <IconBtn onClick={togglePiP} size="sm" className="hidden sm:flex" label="Picture in Picture">
                            <PictureInPicture2 size={16} strokeWidth={1.8} />
                        </IconBtn>
                        <IconBtn onClick={toggleFullscreen} size={isMobile ? "md" : "sm"} label={state.isFullscreen ? "Exit fullscreen" : "Fullscreen"}>
                            {state.isFullscreen ? <Minimize size={20} strokeWidth={1.8} /> : <Maximize size={20} strokeWidth={1.8} />}
                        </IconBtn>
                    </div>
                </div>
            </div>
        </div>
    );
}
