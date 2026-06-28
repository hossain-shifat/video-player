import { useEffect, useState, useRef } from "react";
import { Sun, Volume2, VolumeX, Volume1, Zap, Lock, Headphones, Moon, Wifi, WifiOff, RotateCcw, Minus, Plus, Pencil, SquarePen } from "lucide-react";
import { MdFastForward as FastForward, MdFastRewind as Rewind } from "react-icons/md";
import { usePlayerState } from "./UsePlayerState";

// ─── Hook: useOverlay ────────────────────────────────────────────────────────

export function useOverlay(duration = 2000) {
    const [visible, setVisible] = useState(false);
    const timerRef = useRef(null);

    const trigger = () => {
        setVisible(true);
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setVisible(false), duration);
    };

    useEffect(() => () => clearTimeout(timerRef.current), []);

    return { visible, trigger };
}

// ─── Animated Pill ────────────────────────────────────────────────────────────

function Pill({ visible, children, side = "center", offset = {} }) {
    const posStyle = {
        left: { left: 24 },
        right: { right: 24 },
        center: { left: "50%", transform: "translateX(-50%)" },
    }[side] || { left: "50%", transform: "translateX(-50%)" };

    return (
        <div
            style={{
                position: "absolute",
                top: "50%",
                ...posStyle,
                transform: `${posStyle.transform || ""} translateY(-50%)`,
                zIndex: 40,
                pointerEvents: "none",
                transition: "opacity 0.2s cubic-bezier(0.4,0,0.2,1), transform 0.2s cubic-bezier(0.4,0,0.2,1)",
                opacity: visible ? 1 : 0,
                willChange: "opacity, transform",
                ...offset,
            }}>
            <div className="flux-pill">{children}</div>
        </div>
    );
}

// ─── Seek ripple zones (left / right double-tap) ──────────────────────────────

function SeekZone({ visible, direction, seconds }) {
    const isRight = direction === "forward";
    const Icon = isRight ? FastForward : Rewind;

    return (
        <div
            style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                [isRight ? "right" : "left"]: 0,
                width: "25%",
                zIndex: 40,
                pointerEvents: "none",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                borderRadius: isRight ? "100% 0 0 100%" : "0 100% 100% 0",
                background: visible ? (isRight ? "rgba(0, 0, 0, 0.4)" : "rgba(0, 0, 0, 0.4)") : "transparent",
                transition: "background 0.25s",
            }}>
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 4,
                    opacity: visible ? 1 : 0,
                    transform: visible ? "scale(1)" : "scale(0.8)",
                    transition: "opacity 0.2s, transform 0.2s cubic-bezier(0.34,1.56,0.64,1)",
                }}>
                <div>
                    <Icon size={35} color="#fff" fill="#fff" />
                </div>
                <span style={{ display: "flex", alignItems: "center", color: "#fff", fontWeight: 700, fontSize: 20 }}>
                    {isRight ? <Plus size={15} strokeWidth={3.5} /> : <Minus size={15} strokeWidth={3.5} />}
                    {seconds}s
                </span>
            </div>
        </div>
    );
}

// ─── Speed boost badge ────────────────────────────────────────────────────────

function SpeedBoostBadge({ visible, speed = 2 }) {
    return (
        <div
            style={{
                position: "absolute",
                top: 20,
                left: "50%",
                zIndex: 40,
                pointerEvents: "none",
                transition: "opacity 0.2s, transform 0.2s cubic-bezier(0.34,1.56,0.64,1)",
                opacity: visible ? 1 : 0,
                transform: `translateX(-50%) scale(${visible ? 1 : 0.75})`,
            }}>
            <div className="flux-speed-badge">
                <Zap size={15} fill="currentColor" />
                <span>{speed}× Speed</span>
            </div>
        </div>
    );
}

// ─── Speed Boost Slider (tap-and-hold) ───────────────────────────────────────

export function SpeedBoostSlider({ visible, speed = 2 }) {
    const [showSlider, setShowSlider] = useState(true);
    const [showPill, setShowPill] = useState(false);
    const collapseTimer = useRef(null);
    const pillHideTimer = useRef(null);
    const lastSpeed = useRef(speed);

    const MIN = 0.25;
    const MAX = 4.0;
    const TRACK_DOTS = [0.25, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0];
    const TOP_LABELS = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0];
    const pctOf = (v) => ((v - MIN) / (MAX - MIN)) * 100;

    useEffect(() => {
        if (!visible) {
            setShowSlider(true);
            setShowPill(false);
            clearTimeout(collapseTimer.current);
            clearTimeout(pillHideTimer.current);
            return;
        }
        if (speed !== lastSpeed.current) {
            lastSpeed.current = speed;
            setShowSlider(true);
            setShowPill(false);
            clearTimeout(pillHideTimer.current);
        }
        clearTimeout(collapseTimer.current);
        collapseTimer.current = setTimeout(() => {
            setShowSlider(false);
            setShowPill(true);
        }, 3000);
        return () => clearTimeout(collapseTimer.current);
    }, [visible, speed]);

    useEffect(() => {
        if (!showPill) return;
        pillHideTimer.current = setTimeout(() => setShowPill(false), 3000);
        return () => clearTimeout(pillHideTimer.current);
    }, [showPill]);

    if (!visible) return null;

    return (
        <div
            style={{
                position: "absolute",
                top: 40,
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 41,
                pointerEvents: "none",
            }}>
            <div
                style={{
                    overflow: "hidden",
                    width: showSlider ? "min(640px, 88vw)" : 0,
                    maxHeight: showSlider ? 90 : 0,
                    opacity: showSlider ? 1 : 0,
                    transition: "width 0.25s cubic-bezier(0.4,0,0.2,1), max-height 0.25s cubic-bezier(0.4,0,0.2,1), opacity 0.2s",
                    background: "rgba(0,0,0,0.5)",
                    borderRadius: 16,
                    padding: showSlider ? "14px 20px" : 0,
                }}>
                <div style={{ position: "relative", height: 18, marginBottom: 4 }}>
                    {TOP_LABELS.map((v) => (
                        <span
                            key={v}
                            style={{
                                position: "absolute",
                                left: `${pctOf(v)}%`,
                                transform: "translateX(-50%)",
                                fontSize: 13,
                                fontWeight: 600,
                                color: Math.abs(v - speed) < 0.001 ? "var(--color-primary)" : "rgba(255,255,255,0.85)",
                                whiteSpace: "nowrap",
                            }}>
                            {v.toFixed(1)}x
                        </span>
                    ))}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ color: "#fff", fontSize: 15, fontWeight: 600, flexShrink: 0 }}>0.25x</span>
                    <div style={{ position: "relative", flex: 1, height: 18, display: "flex", alignItems: "center" }}>
                        <div style={{ position: "absolute", left: 0, right: 0, height: 3, borderRadius: 99, background: "rgba(255,255,255,0.35)" }} />
                        {TRACK_DOTS.map((v) => (
                            <div
                                key={v}
                                style={{
                                    position: "absolute",
                                    left: `${pctOf(v)}%`,
                                    top: "50%",
                                    width: Math.abs(v - speed) < 0.001 ? 14 : 6,
                                    height: Math.abs(v - speed) < 0.001 ? 14 : 6,
                                    borderRadius: "50%",
                                    background: Math.abs(v - speed) < 0.001 ? "var(--color-primary)" : "#fff",
                                    transform: "translate(-50%, -50%)",
                                }}
                            />
                        ))}
                    </div>
                    <span style={{ color: "#fff", fontSize: 15, fontWeight: 600, flexShrink: 0 }}>4.0x</span>
                </div>
            </div>

            <div
                style={{
                    position: "absolute",
                    top: 30,
                    left: "50%",
                    transform: "translateX(-50%)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    padding: "10px 18px",
                    borderRadius: 999,
                    background: "rgba(0,0,0,0.5)",
                    width: "fit-content",
                    opacity: showPill ? 1 : 0,
                    transition: "opacity 0.2s",
                }}>
                <FastForward size={16} color="#fff" />
                <span style={{ color: "#fff", fontSize: 15, fontWeight: 600, whiteSpace: "nowrap" }}>{speed.toFixed(1)}x Speed Playing</span>
            </div>
        </div>
    );
}

// ─── Volume icon ──────────────────────────────────────────────────────────────

function VolumeIcon({ volume, muted }) {
    if (muted || volume === 0) return <VolumeX size={26} color="#fff" strokeWidth={1.8} />;
    if (volume < 0.5) return <Volume1 size={26} color="#fff" strokeWidth={1.8} />;
    return <Volume2 size={26} color="#fff" strokeWidth={1.8} />;
}

// ─── Bar indicator (brightness / volume) ─────────────────────────────────────

function BarPill({ visible, side, iconNode, pct, label }) {
    return (
        <div
            style={{
                position: "absolute",
                top: "50%",
                [side === "left" ? "left" : "right"]: 20,
                zIndex: 40,
                pointerEvents: "none",
                transition: "opacity 0.2s cubic-bezier(0.4,0,0.2,1), transform 0.2s cubic-bezier(0.4,0,0.2,1)",
                opacity: visible ? 1 : 0,
                transform: `translateY(-50%) scale(${visible ? 1 : 0.88})`,
                willChange: "opacity, transform",
            }}>
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 10,
                    padding: "16px 14px",
                    borderRadius: 20,
                    background: "rgba(0,0,0,0.75)",
                    backdropFilter: "blur(20px)",
                    WebkitBackdropFilter: "blur(20px)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                    minWidth: 72,
                }}>
                {iconNode}
                {/* Vertical bar */}
                <div style={{ width: 4, height: 64, borderRadius: 99, background: "rgba(255,255,255,0.18)", overflow: "hidden", position: "relative" }}>
                    <div
                        style={{
                            position: "absolute",
                            bottom: 0,
                            left: 0,
                            right: 0,
                            height: `${Math.round(Math.max(0, Math.min(1, pct)) * 100)}%`,
                            background: "linear-gradient(to top, #e53e3e, #ff8c42)",
                            borderRadius: 99,
                            transition: "height 0.08s",
                        }}
                    />
                </div>
                <span style={{ color: "#fff", fontSize: 11, fontWeight: 700, fontFamily: "ui-monospace,'SF Mono',monospace" }}>{label}</span>
            </div>
        </div>
    );
}

// ─── Buffering Spinner ────────────────────────────────────────────────────────

export function BufferingOverlay({ visible }) {
    return (
        <div
            style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 35,
                pointerEvents: "none",
                transition: "opacity 0.3s",
                opacity: visible ? 1 : 0,
            }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
                <div className="flux-spinner" />
                <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 13, fontWeight: 500, letterSpacing: "0.02em" }}>Buffering…</span>
            </div>
        </div>
    );
}

// ─── Error Overlay ────────────────────────────────────────────────────────────

export function ErrorOverlay({ error, onRetry }) {
    if (!error) return null;
    return (
        <div className="flux-error-overlay">
            <div
                style={{
                    width: 56,
                    height: 56,
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "rgba(229,62,62,0.15)",
                    border: "1px solid rgba(229,62,62,0.4)",
                    marginBottom: 4,
                }}>
                <WifiOff size={26} color="#e53e3e" strokeWidth={1.5} />
            </div>
            <p style={{ color: "rgba(255,255,255,0.85)", fontSize: 15, fontWeight: 600, maxWidth: 300, textAlign: "center", lineHeight: 1.5 }}>{error}</p>
            {onRetry && (
                <button
                    onClick={onRetry}
                    style={{
                        marginTop: 8,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "10px 24px",
                        borderRadius: 12,
                        border: "none",
                        background: "rgba(229,62,62,0.85)",
                        color: "#fff",
                        fontSize: 14,
                        fontWeight: 700,
                        cursor: "pointer",
                        boxShadow: "0 4px 20px rgba(229,62,62,0.4)",
                        transition: "transform 0.12s, box-shadow 0.2s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.04)")}
                    onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}>
                    <RotateCcw size={16} strokeWidth={2} />
                    Try again
                </button>
            )}
        </div>
    );
}

// ─── Main PlayerOverlays ──────────────────────────────────────────────────────

export default function PlayerOverlays({ overlayState, overlayVis }) {
    const { brightness = 1, volume = 1, muted = false, seekDir = "forward", seekSec = 10, audioTrack = "", speed = 2 } = overlayState || {};

    const { showBrightness, showVolume, showSeek, showSpeedBoost, showLock, showAudioTrack } = overlayVis || {};

    const brightnessNorm = Math.max(0, Math.min(1, brightness));
    const brightnessPercent = Math.round(brightnessNorm * 100);
    const volumePct = muted ? 0 : volume;
    const volumePercent = muted ? 0 : Math.round(volume * 100);

    return (
        <>
            {/* Brightness — triggered by LEFT-side swipe, overlay shown on
                the RIGHT (opposite side from the swipe zone, per spec). */}
            <BarPill visible={showBrightness} side="right" iconNode={<Moon size={22} color="#fff" strokeWidth={1.8} />} pct={brightnessNorm} label={`${brightnessPercent}%`} />

            {/* Volume — triggered by RIGHT-side swipe, overlay shown on the
                LEFT (opposite side from the swipe zone, per spec). */}
            <BarPill visible={showVolume} side="left" iconNode={<VolumeIcon volume={volume} muted={muted} />} pct={volumePct} label={`${volumePercent}%`} />

            {/* Seek zones */}
            <SeekZone visible={showSeek && seekDir === "backward"} direction="backward" seconds={seekSec} />
            <SeekZone visible={showSeek && seekDir === "forward"} direction="forward" seconds={seekSec} />

            {/* Speed boost */}
            <SpeedBoostSlider visible={showSpeedBoost} speed={speed} />

            {/* Lock */}
            <Pill visible={showLock} side="center">
                <Lock size={24} color="#fff" strokeWidth={1.8} />
                <span style={{ color: "#fff", fontSize: 12, fontWeight: 600 }}>Screen Locked</span>
            </Pill>

            {/* Audio track */}
            <Pill visible={showAudioTrack} side="center">
                <Headphones size={24} color="#fff" strokeWidth={1.8} />
                <span style={{ color: "#fff", fontSize: 12, fontWeight: 600 }}>{audioTrack || "Audio"}</span>
            </Pill>
        </>
    );
}

// ─── Speed Slider Overlay (MX-Player-style scrubber) ─────────────────────────

export function SpeedSliderOverlay({ open, onClose }) {
    const { state, actions } = usePlayerState();
    const MIN = 0.25;
    const MAX = 4.0;
    const STEP = 0.05;
    const MAJORS = [0.25, 1.0, 2.0, 3.0, 4.0];
    const dots = [];
    for (let i = 0; i < MAJORS.length; i++) {
        dots.push({ value: MAJORS[i], major: true });
        if (i < MAJORS.length - 1) {
            dots.push({ value: (MAJORS[i] + MAJORS[i + 1]) / 2, major: false });
        }
    }

    const pctOf = (v) => ((v - MIN) / (MAX - MIN)) * 100;

    const step = (dir) => {
        const next = Math.round((state.playbackSpeed + dir * STEP) * 100) / 100;
        actions.setPlaybackSpeed(Math.max(MIN, Math.min(MAX, next)));
    };

    if (!open) return null;

    return (
        <div
            data-gesture-exclude="true"
            onClick={onClose}
            style={{
                position: "absolute",
                inset: 0,
                zIndex: 70,
                pointerEvents: "auto",
            }}>
            {/* Panel: 65% width, horizontally centered, anchored to the
                bottom of the screen. */}
            <div onClick={(e) => e.stopPropagation()} className="absolute left-1/2 bottom-5 w-[65%] -translate-x-1/2 py-5 px-7.5 bg-black/55 rounded-xl">
                {/* -  [ 1.00x ✎ ]  + */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 18, marginBottom: 22 }}>
                    <button
                        onClick={() => step(-1)}
                        aria-label="Decrease speed"
                        style={{
                            width: 40,
                            height: 40,
                            borderRadius: "50%",
                            background: "rgba(255,255,255,0.14)",
                            border: "none",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            flexShrink: 0,
                            WebkitTapHighlightColor: "transparent",
                        }}>
                        <Minus size={20} color="#fff" strokeWidth={2.5} />
                    </button>

                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "10px 20px",
                            borderRadius: 12,
                        }}
                        className="bg-gray-900/60">
                        <span style={{ color: "#fff", fontSize: 26, fontWeight: 700, fontFamily: "ui-monospace,'SF Mono',monospace" }}>{state.playbackSpeed.toFixed(2)}x</span>
                        <SquarePen size={18} color="#fff" strokeWidth={2} />
                    </div>

                    <button
                        onClick={() => step(1)}
                        aria-label="Increase speed"
                        style={{
                            width: 40,
                            height: 40,
                            borderRadius: "50%",
                            background: "rgba(255,255,255,0.14)",
                            border: "none",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            flexShrink: 0,
                            WebkitTapHighlightColor: "transparent",
                        }}>
                        <Plus size={20} color="#fff" strokeWidth={2.5} />
                    </button>
                </div>

                {/* Slider track + dots + reset, all on one row like the screenshot */}
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <div style={{ position: "relative", flex: 1, height: 28, display: "flex", alignItems: "center" }}>
                        {/* Track */}
                        <div style={{ position: "absolute", left: 0, right: 0, height: 3, borderRadius: 99, background: "rgba(255,255,255,0.3)" }} />
                        {/* Filled portion up to current value */}
                        <div style={{ position: "absolute", left: 0, width: `${pctOf(state.playbackSpeed)}%`, height: 3, borderRadius: 99, background: "var(--color-primary)" }} />
                        {/* Tick dots — majors slightly bigger, midpoints smaller/dimmer */}
                        {dots.map((d) => (
                            <div
                                key={d.value}
                                style={{
                                    position: "absolute",
                                    left: `${pctOf(d.value)}%`,
                                    top: "50%",
                                    width: d.major ? 7 : 5,
                                    height: d.major ? 7 : 5,
                                    borderRadius: "50%",
                                    background: d.value <= state.playbackSpeed ? "var(--color-primary)" : "#fff",
                                    transform: "translate(-50%, -50%)",
                                    pointerEvents: "none",
                                }}
                            />
                        ))}
                        {/* Active thumb */}
                        <div
                            style={{
                                position: "absolute",
                                left: `${pctOf(state.playbackSpeed)}%`,
                                top: "50%",
                                width: 18,
                                height: 18,
                                borderRadius: "50%",
                                background: "var(--color-primary)",
                                transform: "translate(-50%, -50%)",
                                boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
                                pointerEvents: "none",
                            }}
                        />
                        {/* Invisible range input handles the actual drag/tap interaction */}
                        <input
                            type="range"
                            min={MIN}
                            max={MAX}
                            step={STEP}
                            value={state.playbackSpeed}
                            onChange={(e) => actions.setPlaybackSpeed(parseFloat(e.target.value))}
                            style={{
                                position: "absolute",
                                inset: 0,
                                width: "100%",
                                height: "100%",
                                opacity: 0,
                                cursor: "pointer",
                                margin: 0,
                            }}
                            aria-label="Playback speed"
                        />
                    </div>

                    <button
                        onClick={() => actions.setPlaybackSpeed(1)}
                        aria-label="Reset speed"
                        style={{
                            width: 30,
                            height: 30,
                            borderRadius: "50%",
                            background: "transparent",
                            border: "none",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            flexShrink: 0,
                            WebkitTapHighlightColor: "transparent",
                        }}>
                        <RotateCcw size={20} color="#fff" strokeWidth={2} />
                    </button>
                </div>

                {/* Labels under the 5 major stops only */}
                <div style={{ position: "relative", marginTop: 8, height: 16 }}>
                    {MAJORS.map((v) => (
                        <span
                            key={v}
                            style={{
                                position: "absolute",
                                left: `${pctOf(v)}%`,
                                transform: "translateX(-50%)",
                                color: "rgba(255,255,255,0.85)",
                                fontSize: 13,
                                fontWeight: 600,
                                whiteSpace: "nowrap",
                            }}>
                            {v === 0.25 ? "0.25x" : `${v.toFixed(1)}x`}
                        </span>
                    ))}
                </div>
            </div>
        </div>
    );
}
