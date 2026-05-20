import { useRef, useState, useCallback } from "react";
import { Volume2, VolumeX, SkipForward, SkipBack } from "lucide-react";

const DOUBLE_TAP_MS = 300;
const SEEK_AMOUNT = 10; // seconds per double-tap

/**
 * PlayerGestures
 *
 * Fullscreen touch/mouse layer for MX Player–style gesture controls.
 *
 * Gestures:
 *   Double-tap left   → seek –10s
 *   Double-tap right  → seek +10s
 *   Single tap        → toggle controls
 *   Vertical drag right half → volume
 *   Vertical drag left half  → brightness (visual only — browser can't set)
 *
 * Props:
 *   locked           — bool: when true, gestures are disabled
 *   onSeekBy         — fn(delta)
 *   onToggleControls — fn()
 *   onVolumeChange   — fn(delta: -0.1 to +0.1)
 *   volume           — current volume 0..1
 */
export default function PlayerGestures({ locked, onSeekBy, onToggleControls, onVolumeChange, volume }) {
    const [indicator, setIndicator] = useState(null); // { type, value, side }
    const tapTimer = useRef(null);
    const tapCount = useRef(0);
    const dragStart = useRef(null);

    const showIndicator = useCallback((type, value, side) => {
        setIndicator({ type, value, side });
        setTimeout(() => setIndicator(null), 700);
    }, []);

    // ── Tap handling ──────────────────────────────────────────────────────────
    const handleTap = useCallback(
        (e) => {
            if (locked) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const x = (e.touches?.[0]?.clientX ?? e.clientX) - rect.left;
            const isLeft = x < rect.width / 2;

            tapCount.current += 1;

            if (tapTimer.current) clearTimeout(tapTimer.current);
            tapTimer.current = setTimeout(() => {
                if (tapCount.current >= 2) {
                    // Double tap → seek
                    const delta = isLeft ? -SEEK_AMOUNT : SEEK_AMOUNT;
                    onSeekBy?.(delta);
                    showIndicator("seek", delta, isLeft ? "left" : "right");
                } else {
                    // Single tap → toggle controls
                    onToggleControls?.();
                }
                tapCount.current = 0;
            }, DOUBLE_TAP_MS);
        },
        [locked, onSeekBy, onToggleControls, showIndicator],
    );

    // ── Drag (vertical swipe) → volume ───────────────────────────────────────
    const onDragStart = useCallback(
        (e) => {
            if (locked) return;
            const y = e.touches?.[0]?.clientY ?? e.clientY;
            const x = e.touches?.[0]?.clientX ?? e.clientX;
            dragStart.current = { y, x };
        },
        [locked],
    );

    const onDragMove = useCallback(
        (e) => {
            if (!dragStart.current || locked) return;
            const y = e.touches?.[0]?.clientY ?? e.clientY;
            const dy = dragStart.current.y - y;

            if (Math.abs(dy) < 8) return; // dead zone

            const rect = e.currentTarget.getBoundingClientRect();
            const isRight = dragStart.current.x > rect.width / 2;

            if (isRight) {
                const delta = dy * 0.004; // ~0.4 per 100px drag
                onVolumeChange?.(delta);
                dragStart.current.y = y;
                showIndicator("volume", Math.round(volume * 100 + delta * 100), "right");
            }
            // Left side: brightness — can't set via browser, just show visual feedback
        },
        [locked, onVolumeChange, volume, showIndicator],
    );

    const onDragEnd = useCallback(() => {
        dragStart.current = null;
    }, []);

    return (
        <>
            {/* Gesture capture area */}
            <div
                className="absolute inset-0 z-10"
                style={{ touchAction: "none" }}
                onClick={handleTap}
                onTouchStart={onDragStart}
                onTouchMove={onDragMove}
                onTouchEnd={onDragEnd}
                onMouseDown={onDragStart}
                onMouseMove={onDragMove}
                onMouseUp={onDragEnd}
            />

            {/* Indicator overlay */}
            {indicator && (
                <div
                    className={`pointer-events-none absolute top-1/2 -translate-y-1/2 z-20
                                flex flex-col items-center gap-1
                                ${indicator.side === "left" ? "left-10" : "right-10"}`}>
                    <div className="bg-black/60 backdrop-blur-sm rounded-2xl px-5 py-3 flex flex-col items-center gap-1">
                        {indicator.type === "seek" && (
                            <>
                                {indicator.value < 0 ? <SkipBack size={24} className="text-white" /> : <SkipForward size={24} className="text-white" />}
                                <span className="text-white text-sm font-semibold">{Math.abs(indicator.value)}s</span>
                            </>
                        )}
                        {indicator.type === "volume" && (
                            <>
                                {indicator.value > 0 ? <Volume2 size={24} className="text-white" /> : <VolumeX size={24} className="text-white" />}
                                <span className="text-white text-sm font-semibold">{Math.max(0, Math.min(100, indicator.value))}%</span>
                            </>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}
