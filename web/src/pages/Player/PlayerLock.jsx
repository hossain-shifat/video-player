import { useEffect, useRef } from "react";
import { Lock, LockKeyhole, Unlock } from "lucide-react";
import { usePlayerState } from "./UsePlayerState";

const AUTO_UNLOCK_MS = 30 * 60 * 1000;

export default function PlayerLock() {
    const { state, actions } = usePlayerState();
    const timerRef = useRef(null);

    useEffect(() => {
        if (state.isLocked) {
            timerRef.current = setTimeout(() => {
                actions.setLocked(false);
            }, AUTO_UNLOCK_MS);
        } else {
            clearTimeout(timerRef.current);
        }
        return () => clearTimeout(timerRef.current);
    }, [state.isLocked, actions]);

    if (!state.isLocked) return null;

    // FIX: replaced the large centered "Tap to Unlock" overlay (big button,
    // icon, text, dark tint) with a small icon-only button in the same
    // top-right spot the Lock button itself occupies in PlayerControls
    // (which is unmounted/hidden while locked, so this needs its own anchor).
    // Same size/style as the lock icon (flux-icon-btn, size 18) — just a
    // same-size icon swap, not a separate UI moment.
    return (
        <div className="absolute inset-0 z-50" onPointerDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    actions.setLocked(false);
                }}
                className="flux-icon-btn p-2 absolute top-4 right-4 pointer-events-auto"
                aria-label="Unlock screen">
                <LockKeyhole size={20} strokeWidth={2.5} stroke="#fff" />
            </button>
        </div>
    );
}
