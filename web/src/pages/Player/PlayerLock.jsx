import { Lock, LockOpen } from "lucide-react";
import { usePlayerState } from "./UsePlayerState";

/**
 * PlayerLock
 *
 * Reads isLocked + controlsVisible from usePlayerState.
 * No props required.
 *
 * Locked:
 *   Full overlay blocks all taps. Only the unlock button is interactive.
 *
 * Unlocked + controls visible:
 *   Small lock button in bottom-right corner.
 */
export default function PlayerLock() {
    const { state, actions } = usePlayerState();
    const { isLocked, controlsVisible } = state;

    const toggle = () => actions.setLocked(!isLocked);

    if (isLocked) {
        return (
            <div className="absolute inset-0 z-30 flex items-center justify-end pr-5 pb-5">
                {/* Transparent blocker — absorbs taps, passes through visual */}
                <div className="absolute inset-0 bg-transparent" />
                {/* Unlock button is always reachable */}
                <button
                    onClick={toggle}
                    className="relative z-10 w-11 h-11 rounded-full bg-white/20 backdrop-blur-sm
                               border border-white/30 flex items-center justify-center
                               active:scale-95 transition-transform"
                    aria-label="Unlock player">
                    <Lock size={18} className="text-white" />
                </button>
            </div>
        );
    }

    if (!controlsVisible) return null;

    return (
        <button
            onClick={toggle}
            className="absolute right-5 bottom-20 z-20
                       w-9 h-9 rounded-full bg-black/40 backdrop-blur-sm
                       border border-white/20 flex items-center justify-center
                       active:scale-95 transition-all opacity-70 hover:opacity-100"
            aria-label="Lock player">
            <LockOpen size={15} className="text-white/80" />
        </button>
    );
}
