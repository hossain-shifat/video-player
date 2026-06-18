import { useEffect, useState, useRef } from "react";
import { Sun, Volume2, VolumeX, Volume1, FastForward, Rewind, Zap, Lock, Headphones, Moon, Wifi, WifiOff, RotateCcw } from "lucide-react";

// ─── Hook: useOverlay ────────────────────────────────────────────────────────

export function useOverlay(duration = 1500) {
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
                width: "36%",
                zIndex: 40,
                pointerEvents: "none",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                borderRadius: isRight ? "0 8px 8px 0" : "8px 0 0 8px",
                background: visible
                    ? isRight
                        ? "radial-gradient(ellipse at 30% 50%, rgba(255,107,53,0.18), transparent 70%)"
                        : "radial-gradient(ellipse at 70% 50%, rgba(255,107,53,0.18), transparent 70%)"
                    : "transparent",
                transition: "background 0.25s",
            }}>
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 6,
                    opacity: visible ? 1 : 0,
                    transform: visible ? "scale(1)" : "scale(0.8)",
                    transition: "opacity 0.2s, transform 0.2s cubic-bezier(0.34,1.56,0.64,1)",
                }}>
                <div style={{ display: "flex", gap: 2 }}>
                    <Icon size={28} color="#fff" strokeWidth={1.8} />
                    <Icon size={28} color="rgba(255,255,255,0.5)" strokeWidth={1.8} />
                </div>
                <span style={{ color: "#fff", fontWeight: 700, fontSize: 14 }}>
                    {isRight ? "+" : "−"}
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

    const brightnessNorm = (brightness - 0.5) / 1.5;
    const brightnessPercent = Math.round(brightnessNorm * 100);
    const volumePct = muted ? 0 : volume;
    const volumePercent = muted ? 0 : Math.round(volume * 100);

    return (
        <>
            {/* Brightness — left */}
            <BarPill visible={showBrightness} side="left" iconNode={<Moon size={22} color="#fff" strokeWidth={1.8} />} pct={brightnessNorm} label={`${brightnessPercent}%`} />

            {/* Volume — right */}
            <BarPill visible={showVolume} side="right" iconNode={<VolumeIcon volume={volume} muted={muted} />} pct={volumePct} label={`${volumePercent}%`} />

            {/* Seek zones */}
            <SeekZone visible={showSeek && seekDir === "backward"} direction="backward" seconds={seekSec} />
            <SeekZone visible={showSeek && seekDir === "forward"} direction="forward" seconds={seekSec} />

            {/* Speed boost */}
            <SpeedBoostBadge visible={showSpeedBoost} speed={speed} />

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
