import { useEffect, useState, useRef } from "react";
import {
    Sun, Volume2, VolumeX, Volume1,
    FastForward, Rewind, Zap, Lock, Headphones,
    Moon,
} from "lucide-react";

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

// ─── Pill ────────────────────────────────────────────────────────────────────

function Pill({ visible, children, side = "center" }) {
    const posClass = {
        left:   "left-6",
        right:  "right-6",
        center: "left-1/2 -translate-x-1/2",
    }[side];

    return (
        <div
            className={`absolute top-1/2 -translate-y-1/2 ${posClass} z-40 pointer-events-none
                        transition-all duration-200 ease-out`}
            style={{
                opacity: visible ? 1 : 0,
                transform: `${posClass.includes("1/2") ? "translate(-50%, -50%)" : "translateY(-50%)"} scale(${visible ? 1 : 0.88})`,
            }}>
            <div
                className="flex flex-col items-center gap-2 px-5 py-3.5 rounded-2xl min-w-[88px] text-center"
                style={{
                    background: "rgba(0, 0, 0, 0.72)",
                    backdropFilter: "blur(16px)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                }}>
                {children}
            </div>
        </div>
    );
}

// ─── Seek ripple ─────────────────────────────────────────────────────────────

function SeekPill({ visible, direction, seconds }) {
    const isRight = direction === "forward";
    const Icon = isRight ? FastForward : Rewind;

    return (
        <Pill visible={visible} side={isRight ? "right" : "left"}>
            <Icon size={26} className="text-white" strokeWidth={1.8} />
            <span className="text-white text-sm font-bold">
                {isRight ? "+" : "−"}{seconds}s
            </span>
        </Pill>
    );
}

// ─── Speed boost badge ────────────────────────────────────────────────────────

function SpeedBoostBadge({ visible }) {
    return (
        <div
            className="absolute top-5 left-1/2 -translate-x-1/2 z-40 pointer-events-none
                        transition-all duration-200"
            style={{
                opacity: visible ? 1 : 0,
                transform: `translateX(-50%) scale(${visible ? 1 : 0.75})`,
            }}>
            <div
                className="flex items-center gap-2 px-4 py-2 rounded-full"
                style={{
                    background: "rgba(245, 158, 11, 0.92)",
                    border: "1px solid rgba(255,220,80,0.5)",
                    boxShadow: "0 4px 20px rgba(245,158,11,0.4)",
                }}>
                <Zap size={15} className="text-black" fill="currentColor" />
                <span className="text-black text-sm font-black tracking-wide">2× Speed</span>
            </div>
        </div>
    );
}

// ─── Volume icon ──────────────────────────────────────────────────────────────

function VolumeIcon({ volume, muted }) {
    if (muted || volume === 0) return <VolumeX size={26} className="text-white" strokeWidth={1.8} />;
    if (volume < 0.5)          return <Volume1 size={26} className="text-white" strokeWidth={1.8} />;
    return <Volume2 size={26} className="text-white" strokeWidth={1.8} />;
}

// ─── Bar indicator (brightness / volume) ─────────────────────────────────────

function BarPill({ visible, side, icon: Icon, iconNode, pct, label }) {
    const posClass = side === "left" ? "left-6" : "right-6";

    return (
        <div
            className={`absolute top-1/2 -translate-y-1/2 ${posClass} z-40 pointer-events-none
                        transition-all duration-200 ease-out`}
            style={{
                opacity: visible ? 1 : 0,
                transform: `translateY(-50%) scale(${visible ? 1 : 0.88})`,
            }}>
            <div
                className="flex flex-col items-center gap-2.5 px-4 py-4 rounded-2xl min-w-[80px]"
                style={{
                    background: "rgba(0,0,0,0.72)",
                    backdropFilter: "blur(16px)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                }}>
                {iconNode || (Icon && <Icon size={24} className="text-white" strokeWidth={1.8} />)}
                {/* Vertical bar */}
                <div
                    className="w-1 rounded-full overflow-hidden"
                    style={{ height: 60, background: "rgba(255,255,255,0.2)" }}>
                    <div
                        style={{
                            height: `${Math.round(pct * 100)}%`,
                            background: "linear-gradient(to top, #e53e3e, #ff8c42)",
                            borderRadius: 99,
                            marginTop: "auto",
                            transition: "height 0.1s",
                        }}
                    />
                </div>
                <span className="text-white text-xs font-bold">{label}</span>
            </div>
        </div>
    );
}

// ─── Main PlayerOverlays ──────────────────────────────────────────────────────

export default function PlayerOverlays({ overlayState, overlayVis }) {
    const {
        brightness = 1, volume = 1, muted = false,
        seekDir = "forward", seekSec = 10, audioTrack = "",
    } = overlayState || {};

    const {
        showBrightness, showVolume, showSeek,
        showSpeedBoost, showLock, showAudioTrack,
    } = overlayVis || {};

    const brightnessNorm = (brightness - 0.5) / 1.5;
    const brightnessPercent = Math.round(brightnessNorm * 100);
    const volumePct = muted ? 0 : volume;
    const volumePercent = muted ? 0 : Math.round(volume * 100);

    return (
        <>
            {/* Brightness — left */}
            <BarPill
                visible={showBrightness}
                side="left"
                iconNode={<Moon size={24} className="text-white" strokeWidth={1.8} />}
                pct={brightnessNorm}
                label={`${brightnessPercent}%`}
            />

            {/* Volume — right */}
            <BarPill
                visible={showVolume}
                side="right"
                iconNode={<VolumeIcon volume={volume} muted={muted} />}
                pct={volumePct}
                label={`${volumePercent}%`}
            />

            {/* Seek */}
            <SeekPill visible={showSeek} direction={seekDir} seconds={seekSec} />

            {/* Speed boost */}
            <SpeedBoostBadge visible={showSpeedBoost} />

            {/* Lock */}
            <Pill visible={showLock} side="center">
                <Lock size={24} className="text-white" strokeWidth={1.8} />
                <span className="text-white text-xs font-semibold">Screen Locked</span>
            </Pill>

            {/* Audio track */}
            <Pill visible={showAudioTrack} side="center">
                <Headphones size={24} className="text-white" strokeWidth={1.8} />
                <span className="text-white text-xs font-semibold">{audioTrack || "Audio"}</span>
            </Pill>
        </>
    );
}
