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
    ScanLine,
    AudioLines,
    X,
    GripVertical,
    Maximize2,
    MoveHorizontal,
    Tv,
    Square,
} from "lucide-react";
import { MdOutlineHighQuality, MdHighQuality, MdOutlineScreenRotation, MdScreenLockRotation } from "react-icons/md";
import { usePlayerState } from "./UsePlayerState";
import { useIsMobile } from "./useIsMobile";
import SeekBar from "./SeekBar";
import VideoSidebar, { SidebarItem } from "./VideoSidebar";

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
            <span style={{ flex: 1 }}>{children}</span>
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

function AudioPicker({ open, onClose, isMobile, controlsPhase }) {
    const { state, actions } = usePlayerState();
    return (
        <MenuShell isMobile={isMobile} controlsPhase={controlsPhase} open={open} onClose={onClose} title="Audio Track">
            {state.audioTracks.map((track) => (
                <MenuItem
                    isMobile={isMobile}
                    key={track.index}
                    active={state.activeAudioTrack === track.index}
                    onClick={() => {
                        actions.setActiveAudioTrack(track.index);
                        onClose();
                    }}>
                    <span style={{ fontSize: "1rem", lineHeight: 1, marginRight: 8 }}>{AUDIO_FLAGS[track.name] || "🎵"}</span>
                    <div>
                        <div>{track.name}</div>
                        <div style={{ fontSize: 11, opacity: 0.4, textTransform: "uppercase" }}>{track.lang}</div>
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

function EqPanel({ open, onClose, isMobile, controlsPhase }) {
    const { state, actions } = usePlayerState();
    if (!open) return null;
    const { bass = 0, mid = 0, treble = 0 } = state.eqBands || {};

    const Slider = ({ label, value, onChange }) => (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, flex: 1 }}>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", fontFamily: "ui-monospace,monospace" }}>{value > 0 ? `+${value}` : value}</span>
            <input
                type="range"
                min={-12}
                max={12}
                step={1}
                value={value}
                onChange={(e) => onChange(+e.target.value)}
                disabled={!state.eqEnabled}
                style={{
                    writingMode: "vertical-lr",
                    direction: "rtl",
                    width: 28,
                    height: 110,
                    accentColor: "#e53e3e",
                    opacity: state.eqEnabled ? 1 : 0.4,
                }}
            />
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>{label}</span>
        </div>
    );

    return (
        <MenuShell isMobile={isMobile} controlsPhase={controlsPhase} open={open} onClose={onClose} title="Equalizer">
            <div style={{ display: "flex", justifyContent: "flex-end", padding: "4px 16px 4px" }}>
                <button
                    onClick={() => actions.toggleEq()}
                    style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "3px 10px",
                        borderRadius: 999,
                        border: "none",
                        cursor: "pointer",
                        background: state.eqEnabled ? "#e53e3e" : "rgba(255,255,255,0.1)",
                        color: "#fff",
                    }}>
                    {state.eqEnabled ? "ON" : "OFF"}
                </button>
            </div>
            <div style={{ display: "flex", justifyContent: "space-around", padding: "16px 14px 12px", gap: 8 }}>
                <Slider label="Bass" value={bass} onChange={(v) => actions.setEqBands({ bass: v })} />
                <Slider label="Mid" value={mid} onChange={(v) => actions.setEqBands({ mid: v })} />
                <Slider label="Treble" value={treble} onChange={(v) => actions.setEqBands({ treble: v })} />
            </div>
            <button
                onClick={() => actions.setEqBands({ bass: 0, mid: 0, treble: 0 })}
                style={{
                    width: "calc(100% - 32px)",
                    margin: "0 16px 12px",
                    padding: "6px 0",
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.06)",
                    color: "rgba(255,255,255,0.6)",
                    fontSize: 11,
                    border: "none",
                    cursor: "pointer",
                }}>
                Reset
            </button>
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
    pip: { label: "Pop-out Play", icon: ScanLine },
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
        audioFx: { onClick: () => toggleMenu("eq"), active: state.eqEnabled || openMenu === "eq" },
        eq: { onClick: () => toggleMenu("eq"), active: state.eqEnabled || openMenu === "eq" },
        speed: {
            onClick: () => toggleMenu("speed"),
            active: state.playbackSpeed !== 1,
            iconOverride: <span style={{ fontSize: 11, fontWeight: 700, color: "#fff" }}>{state.playbackSpeed}×</span>,
        },
        pip: { onClick: () => containerRef?.current?._togglePiP?.() },
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
                        {key === "customise" && <CustomiseItemsPanel open={openMenu === "customise"} onClose={() => toggleMenu(null)} isMobile={isMobile} controlsPhase={controlsPhase} />}
                        {key === "abRepeat" && <AbRepeatPanel open={openMenu === "abRepeat"} onClose={() => toggleMenu(null)} videoRef={videoRef} isMobile={isMobile} controlsPhase={controlsPhase} />}
                        {(key === "eq" || key === "audioFx") && <EqPanel open={openMenu === "eq"} onClose={() => toggleMenu(null)} isMobile={isMobile} controlsPhase={controlsPhase} />}
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
        </div>
    );
}

// ─── PlayerControls ───────────────────────────────────────────────────────────

export default function PlayerControls({ mediaInfo, videoRef, containerRef, subtitles = [], onBack, onShowControls, controlsPhase = "VISIBLE", isPortraitOverride = false }) {
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

            {/* ── Top bar ──────────────────────────────────────────────────────── */}
            <div
                className="flex flex-col gap-3 px-3 pt-3 flux-controls-top"
                style={{ pointerEvents: controlsPhase === "ANIMATING_OUT" ? "none" : "auto" }}
                onClickCapture={onShowControls}
                onPointerDownCapture={onShowControls}>
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

            {/* ── Bottom bar ────────────────────────────────────────────────── */}
            <div
                className="px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flux-controls-bottom"
                style={{ pointerEvents: controlsPhase === "ANIMATING_OUT" ? "none" : "auto" }}
                onClickCapture={onShowControls}
                onPointerDownCapture={onShowControls}>
                {isMobile && (
                    <div className="flex items-center justify-between px-1 mb-1.5">
                        <TimeDisplay />
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
                        {state.qualityLevels.length > 0 && (
                            <div style={{ position: "relative" }}>
                                {isMobile ? (
                                    <button
                                        type="button"
                                        onClick={() => toggleMenu("quality")}
                                        className="flux-icon-btn"
                                        style={{ display: "flex", alignItems: "center", padding: "10px 10px" }}
                                        aria-label="Quality">
                                        {state.activeQuality !== -1 ? <MdHighQuality size={iconTiny} color="var(--color-primary)" /> : <MdOutlineHighQuality size={iconTiny} color="#fff" />}
                                    </button>
                                ) : (
                                    <button onClick={() => toggleMenu("quality")} className="flux-icon-btn" style={{ display: "flex", alignItems: "center", padding: "6px 8px" }} aria-label="Quality">
                                        {state.activeQuality !== -1 ? <MdHighQuality size={iconTiny} color="var(--color-primary)" /> : <MdOutlineHighQuality size={iconTiny} color="#fff" />}
                                    </button>
                                )}
                                <QualityPicker open={openMenu === "quality"} onClose={closeMenu} isMobile={isMobile} controlsPhase={controlsPhase} />
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
                                <AudioPicker open={openMenu === "audio"} onClose={closeMenu} isMobile={isMobile} controlsPhase={controlsPhase} />
                            </div>
                        )}
                        <div style={{ position: "relative" }}>
                            <IconBtn onClick={() => toggleMenu("sub")} active={!!state.activeSubtitle} size={isMobile ? "md" : "sm"} label="Subtitles">
                                <Subtitles size={iconTiny} strokeWidth={1.8} />
                            </IconBtn>
                            <SubtitlePicker open={openMenu === "sub"} onClose={closeMenu} subtitles={subtitles} isMobile={isMobile} controlsPhase={controlsPhase} />
                        </div>
                        <AspectToggleButton size={isMobile ? 19 : 17} />
                        <IconBtn onClick={togglePiP} size="sm" className="hidden sm:flex" label="Picture in Picture">
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
