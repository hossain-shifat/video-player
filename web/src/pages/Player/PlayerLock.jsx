import { useEffect, useRef } from "react";
import { Lock, Unlock } from "lucide-react";
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

    return (
        <div
            className="absolute inset-0 z-50"
            onPointerDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}>
            {/* subtle dark tint */}
            <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.15)" }} />

            {/* Lock badge top-left */}
            <div
                className="absolute top-4 left-4 flex items-center gap-2 px-3 py-1.5 rounded-full"
                style={{
                    background: "rgba(0,0,0,0.55)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    backdropFilter: "blur(8px)",
                }}>
                <Lock size={13} className="text-white/60" strokeWidth={2} />
                <span className="text-white/60 text-xs font-semibold tracking-wide">Locked</span>
            </div>

            {/* Center unlock button */}
            <div className="absolute inset-0 flex items-center justify-center">
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        actions.setLocked(false);
                    }}
                    className="flex flex-col items-center gap-3 px-10 py-6 rounded-3xl
                               cursor-pointer active:scale-95 transition-transform duration-100"
                    style={{
                        background: "rgba(0,0,0,0.72)",
                        backdropFilter: "blur(20px)",
                        border: "1px solid rgba(255,255,255,0.15)",
                        boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
                    }}>
                    <div
                        className="w-14 h-14 rounded-full flex items-center justify-center"
                        style={{ background: "rgba(229,62,62,0.15)", border: "1.5px solid rgba(229,62,62,0.4)" }}>
                        <Unlock size={26} className="text-red-400" strokeWidth={1.8} />
                    </div>
                    <span className="text-white text-sm font-semibold">Tap to Unlock</span>
                </button>
            </div>
        </div>
    );
}
