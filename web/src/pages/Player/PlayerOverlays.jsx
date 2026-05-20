import { useState, useRef, useEffect, useCallback } from "react";
import { Sun, Volume2, VolumeX, SkipForward, SkipBack, Zap, Lock } from "lucide-react";

// ─── useOverlay ───────────────────────────────────────────────────────────────
/**
 * useOverlay(duration?)
 * Returns { visible, trigger } — trigger() shows the overlay for `duration` ms.
 * Used in PlayerPage to drive each overlay slot independently.
 */
export function useOverlay(duration = 1400) {
    const [visible, setVisible] = useState(false);
    const timerRef = useRef(null);

    const trigger = useCallback(() => {
        setVisible(true);
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setVisible(false), duration);
    }, [duration]);

    useEffect(() => () => clearTimeout(timerRef.current), []);

    return { visible, trigger };
}

// ─── OverlayPill ──────────────────────────────────────────────────────────────

function OverlayPill({ visible, side = "center", children }) {
    const posClass = side === "left" ? "left-10" : side === "right" ? "right-10" : "left-1/2 -translate-x-1/2";

    return (
        <div
            className={`pointer-events-none absolute top-1/2 -translate-y-1/2 z-30 ${posClass}
                        transition-opacity duration-150`}
            style={{ opacity: visible ? 1 : 0 }}>
            <div className="bg-black/65 backdrop-blur-sm rounded-2xl px-5 py-3 flex flex-col items-center gap-1.5">{children}</div>
        </div>
    );
}

// ─── Top-anchored pill (speed boost / audio track) ────────────────────────────

function TopPill({ visible, children }) {
    return (
        <div className="pointer-events-none absolute top-16 left-1/2 -translate-x-1/2 z-30 transition-opacity duration-150" style={{ opacity: visible ? 1 : 0 }}>
            <div className="bg-black/65 backdrop-blur-sm rounded-full px-4 py-1.5 flex items-center gap-2">{children}</div>
        </div>
    );
}

// ─── PlayerOverlays ───────────────────────────────────────────────────────────
/**
 * PlayerOverlays
 *
 * Pure visual-feedback layer — shows transient gesture-triggered overlays.
 * No gesture handling, no controls bar. Those live in PlayerGestures / PlayerControls.
 *
 * Props:
 *   overlayState — { brightness, volume, muted, seekDir, seekSec, audioTrack }
 *   overlayVis   — { showBrightness, showVolume, showSeek, showSpeedBoost, showLock, showAudioTrack }
 */
export default function PlayerOverlays({ overlayState, overlayVis }) {
    const { brightness = 1, volume = 1, muted = false, seekDir = "forward", seekSec = 10, audioTrack = "" } = overlayState || {};

    const { showBrightness, showVolume, showSeek, showSpeedBoost, showLock, showAudioTrack } = overlayVis || {};

    return (
        <>
            {/* Brightness — left side */}
            <OverlayPill visible={showBrightness} side="left">
                <Sun size={22} className="text-yellow-300" />
                <span className="text-white text-sm font-semibold">{Math.round(brightness * 100)}%</span>
            </OverlayPill>

            {/* Volume — right side */}
            <OverlayPill visible={showVolume} side="right">
                {muted || volume === 0 ? <VolumeX size={22} className="text-white" /> : <Volume2 size={22} className="text-white" />}
                <span className="text-white text-sm font-semibold">{Math.round(Math.max(0, Math.min(1, volume)) * 100)}%</span>
            </OverlayPill>

            {/* Seek — directional side */}
            <OverlayPill visible={showSeek} side={seekDir === "forward" ? "right" : "left"}>
                {seekDir === "forward" ? <SkipForward size={24} className="text-white" /> : <SkipBack size={24} className="text-white" />}
                <span className="text-white text-sm font-semibold">{seekSec}s</span>
            </OverlayPill>

            {/* Speed boost — top center, persists while held */}
            <TopPill visible={showSpeedBoost}>
                <Zap size={15} className="text-yellow-400" />
                <span className="text-white text-xs font-bold tracking-wide">2× Speed</span>
            </TopPill>

            {/* Lock indicator — center */}
            <OverlayPill visible={showLock} side="center">
                <Lock size={22} className="text-white" />
                <span className="text-white text-xs font-medium">Screen Locked</span>
            </OverlayPill>

            {/* Audio track — top center */}
            {audioTrack && (
                <TopPill visible={showAudioTrack}>
                    <span className="text-white text-xs font-medium">♪ {audioTrack}</span>
                </TopPill>
            )}
        </>
    );
}
