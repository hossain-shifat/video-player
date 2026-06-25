// web/src/Errors/ErrorIllustration.jsx
import { Lock, Ban, SearchX, Tv, ServerCrash, RadioTower, Loader2 } from "lucide-react";

// ── 401 · Series — locked season vault ─────────────────────────────────────
export function AuthVaultIllustration() {
    return (
        <div className="scn scn-vault" aria-hidden="true">
            <div className="scn-vault__spines">
                {Array.from({ length: 6 }).map((_, i) => (
                    <span key={i} className="scn-vault__spine" style={{ "--i": i }} />
                ))}
            </div>
            <div className="scn-vault__chain" />
            <Lock className="scn-vault__lock" size={40} strokeWidth={1.6} />
            <style>{`
                .scn-vault { position: relative; width: 100%; height: 100%; display: flex; align-items: flex-end; justify-content: center; gap: 0.4rem; }
                .scn-vault__spines { display: flex; align-items: flex-end; gap: 0.45rem; height: 80%; }
                .scn-vault__spine { width: 1.1rem; border-radius: 0.25rem 0.25rem 0 0;
                    height: calc(55% + (var(--i) * 7%));
                    background: linear-gradient(180deg, color-mix(in oklch, var(--color-primary) 70%, var(--color-secondary)), color-mix(in oklch, var(--color-base-300) 80%, transparent));
                    box-shadow: inset -2px 0 0 color-mix(in oklch, black 15%, transparent);
                    animation: spineGlow 3.4s ease-in-out infinite; animation-delay: calc(var(--i) * 0.15s); }
                .scn-vault__chain { position: absolute; left: 8%; right: 8%; top: 38%; height: 3px; transform: rotate(-6deg);
                    background: repeating-linear-gradient(90deg, var(--color-base-content) 0 6px, transparent 6px 10px); opacity: 0.55; }
                .scn-vault__lock { position: absolute; top: 30%; color: var(--color-primary); filter: drop-shadow(0 0 10px color-mix(in oklch, var(--color-primary) 60%, transparent));
                    animation: lockSwing 3.2s ease-in-out infinite; transform-origin: 50% 0%; }
                @keyframes spineGlow { 0%,100% { filter: brightness(1); } 50% { filter: brightness(1.18); } }
                @keyframes lockSwing { 0%,100% { transform: rotate(-4deg); } 50% { transform: rotate(4deg); } }
                @media (prefers-reduced-motion: reduce) {
                    .scn-vault__spine, .scn-vault__lock { animation: none !important; }
                }
            `}</style>
        </div>
    );
}

// ── 403 · Anime — denied ink seal ───────────────────────────────────────────
export function ForbiddenShieldIllustration() {
    return (
        <div className="scn scn-seal" aria-hidden="true">
            <div className="scn-seal__ring" />
            <div className="scn-seal__ring scn-seal__ring--inner" />
            {Array.from({ length: 8 }).map((_, i) => (
                <span key={i} className="scn-seal__petal" style={{ "--i": i }} />
            ))}
            <Ban className="scn-seal__ban" size={46} strokeWidth={1.5} />
            <style>{`
                .scn-seal { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
                .scn-seal__ring { position: absolute; width: 70%; aspect-ratio: 1; border-radius: 999px; border: 2px solid var(--color-error);
                    opacity: 0.5; animation: sealSpin 16s linear infinite; }
                .scn-seal__ring--inner { width: 50%; border-style: dashed; opacity: 0.35; animation-duration: 10s; animation-direction: reverse; }
                .scn-seal__ban { color: var(--color-error); filter: drop-shadow(0 0 10px color-mix(in oklch, var(--color-error) 55%, transparent)); animation: banPulse 2.4s ease-in-out infinite; }
                .scn-seal__petal { position: absolute; width: 0.4rem; height: 0.6rem; border-radius: 50% 50% 50% 0; background: var(--color-accent); opacity: 0.6;
                    top: 50%; left: 50%; transform: rotate(calc(var(--i) * 45deg)) translateY(-7rem);
                    animation: petalDrift 4.5s ease-in-out infinite; animation-delay: calc(var(--i) * 0.3s); }
                @keyframes sealSpin { to { transform: rotate(360deg); } }
                @keyframes banPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.08); } }
                @keyframes petalDrift { 0%,100% { opacity: 0.6; transform: rotate(calc(var(--i) * 45deg)) translateY(-7rem) translateX(0); } 50% { opacity: 0.15; transform: rotate(calc(var(--i) * 45deg)) translateY(-8rem) translateX(4px); } }
                @media (prefers-reduced-motion: reduce) {
                    .scn-seal__ring, .scn-seal__ring--inner, .scn-seal__ban, .scn-seal__petal { animation: none !important; }
                }
            `}</style>
        </div>
    );
}

// ── 404 · Movies — unspooled reel, missing frame ────────────────────────────
export function NotFoundIllustration() {
    return (
        <div className="scn scn-reel" aria-hidden="true">
            <svg viewBox="0 0 100 100" className="scn-reel__ring" aria-hidden="true">
                <circle cx="50" cy="50" r="34" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="6 5" />
                <circle cx="50" cy="50" r="10" fill="none" stroke="currentColor" strokeWidth="3" />
                {[0, 72, 144, 216, 288].map((a) => {
                    const r = (a * Math.PI) / 180;
                    return <circle key={a} cx={50 + Math.cos(r) * 20} cy={50 + Math.sin(r) * 20} r="4" fill="currentColor" />;
                })}
            </svg>
            <div className="scn-reel__strip" />
            <div className="scn-reel__frame">
                <SearchX size={26} strokeWidth={1.6} />
            </div>
            <style>{`
                .scn-reel { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: var(--color-primary); }
                .scn-reel__ring { position: absolute; width: 60%; height: 60%; left: 6%; top: 18%; animation: reelTurn 9s linear infinite; }
                .scn-reel__strip { position: absolute; right: 4%; bottom: 14%; width: 46%; height: 22%;
                    background: repeating-linear-gradient(90deg, var(--color-base-300) 0 10%, var(--color-base-100) 10% 14%);
                    border: 2px solid var(--color-base-300); border-radius: 0.3rem; transform: rotate(-10deg);
                    animation: stripDrift 3.6s ease-in-out infinite; }
                .scn-reel__frame { position: absolute; right: 8%; bottom: 18%; width: 2.6rem; height: 2.6rem; border-radius: 0.4rem;
                    border: 2px dashed var(--color-accent); display: flex; align-items: center; justify-content: center; color: var(--color-accent);
                    background: color-mix(in oklch, var(--color-base-100) 70%, transparent); animation: frameBlink 2.2s ease-in-out infinite; }
                @keyframes reelTurn { to { transform: rotate(360deg); } }
                @keyframes stripDrift { 0%,100% { transform: rotate(-10deg) translateX(0); } 50% { transform: rotate(-6deg) translateX(4px); } }
                @keyframes frameBlink { 0%,100% { opacity: 1; } 50% { opacity: 0.45; } }
                @media (prefers-reduced-motion: reduce) {
                    .scn-reel__ring, .scn-reel__strip, .scn-reel__frame { animation: none !important; }
                }
            `}</style>
        </div>
    );
}

// ── 429 · Live TV — overloaded channel grid ─────────────────────────────────
export function RateLimitIllustration() {
    return (
        <div className="scn scn-grid" aria-hidden="true">
            <Tv className="scn-grid__icon" size={24} strokeWidth={1.6} />
            <div className="scn-grid__tiles">
                {Array.from({ length: 9 }).map((_, i) => (
                    <span key={i} className="scn-grid__tile" style={{ "--i": i }} />
                ))}
            </div>
            <style>{`
                .scn-grid { position: relative; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.6rem; }
                .scn-grid__icon { color: var(--color-warning); animation: gridIconPulse 2s ease-in-out infinite; }
                .scn-grid__tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.4rem; width: 70%; }
                .scn-grid__tile { aspect-ratio: 4/3; border-radius: 0.3rem;
                    background: linear-gradient(135deg, color-mix(in oklch, var(--color-warning) 55%, transparent), color-mix(in oklch, var(--color-secondary) 45%, transparent));
                    animation: tileOverload 1.6s ease-in-out infinite; animation-delay: calc(var(--i) * 0.12s); }
                @keyframes gridIconPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.15); } }
                @keyframes tileOverload { 0%,100% { opacity: 0.5; transform: scale(0.94); } 50% { opacity: 1; transform: scale(1.04); } }
                @media (prefers-reduced-motion: reduce) {
                    .scn-grid__icon, .scn-grid__tile { animation: none !important; }
                }
            `}</style>
        </div>
    );
}

// ── 500 · Static crash — glitch tear ────────────────────────────────────────
export function ServerCrashIllustration() {
    return (
        <div className="scn scn-static" aria-hidden="true">
            <div className="scn-static__bars">
                {Array.from({ length: 7 }).map((_, i) => (
                    <span key={i} className="scn-static__bar" style={{ "--i": i }} />
                ))}
            </div>
            <ServerCrash className="scn-static__icon" size={42} strokeWidth={1.6} />
            <style>{`
                .scn-static { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; overflow: hidden; }
                .scn-static__bars { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: space-evenly; }
                .scn-static__bar { height: 6%; background: color-mix(in oklch, var(--color-error) 35%, transparent);
                    animation: barTear 2.4s steps(6) infinite; animation-delay: calc(var(--i) * 0.18s); }
                .scn-static__icon { position: relative; color: var(--color-error); filter: drop-shadow(0 0 12px color-mix(in oklch, var(--color-error) 60%, transparent));
                    animation: crashShake 2.6s ease-in-out infinite; }
                @keyframes barTear { 0%,100% { transform: translateX(0); opacity: 0.4; } 30% { transform: translateX(-12%); opacity: 0.8; } 60% { transform: translateX(8%); opacity: 0.3; } }
                @keyframes crashShake { 0%,100% { transform: translate(0,0); } 20% { transform: translate(-2px,1px); } 40% { transform: translate(2px,-1px); } 60% { transform: translate(-1px,2px); } 80% { transform: translate(1px,-2px); } }
                @media (prefers-reduced-motion: reduce) {
                    .scn-static__bar, .scn-static__icon { animation: none !important; }
                }
            `}</style>
        </div>
    );
}

// ── Network · Live TV — dead antenna signal ─────────────────────────────────
export function NetworkOfflineIllustration() {
    return (
        <div className="scn scn-signal" aria-hidden="true">
            <RadioTower className="scn-signal__tower" size={40} strokeWidth={1.6} />
            {[0, 1, 2].map((i) => (
                <span key={i} className="scn-signal__ring" style={{ "--i": i }} />
            ))}
            <style>{`
                .scn-signal { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
                .scn-signal__tower { position: relative; z-index: 2; color: var(--color-info); animation: towerFlicker 2.6s ease-in-out infinite; }
                .scn-signal__ring { position: absolute; width: 3rem; height: 3rem; border: 2px solid var(--color-info); border-radius: 999px; opacity: 0;
                    animation: ringExpand 2.4s ease-out infinite; animation-delay: calc(var(--i) * 0.6s); }
                @keyframes ringExpand { 0% { transform: scale(0.6); opacity: 0.6; } 100% { transform: scale(3.2); opacity: 0; } }
                @keyframes towerFlicker { 0%,40%,100% { opacity: 1; } 45%,55% { opacity: 0.2; } }
                @media (prefers-reduced-motion: reduce) {
                    .scn-signal__tower, .scn-signal__ring { animation: none !important; }
                }
            `}</style>
        </div>
    );
}

// ── Timeout · Anime — stuck buffering spinner ───────────────────────────────
export function TimeoutClockIllustration() {
    return (
        <div className="scn scn-buffer" aria-hidden="true">
            <Loader2 className="scn-buffer__spin" size={46} strokeWidth={1.6} />
            {Array.from({ length: 6 }).map((_, i) => (
                <span key={i} className="scn-buffer__petal" style={{ "--i": i }} />
            ))}
            <style>{`
                .scn-buffer { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
                .scn-buffer__spin { color: var(--color-secondary); animation: bufferSpin 1.1s linear infinite; filter: drop-shadow(0 0 8px color-mix(in oklch, var(--color-secondary) 55%, transparent)); }
                .scn-buffer__petal { position: absolute; width: 0.35rem; height: 0.5rem; border-radius: 50% 50% 50% 0; background: var(--color-accent); opacity: 0.55;
                    top: 50%; left: 50%; transform: rotate(calc(var(--i) * 60deg)) translateY(-5.5rem);
                    animation: petalFloat 3.6s ease-in-out infinite; animation-delay: calc(var(--i) * 0.25s); }
                @keyframes bufferSpin { to { transform: rotate(360deg); } }
                @keyframes petalFloat { 0%,100% { opacity: 0.55; } 50% { opacity: 0.1; transform: rotate(calc(var(--i) * 60deg)) translateY(-6.2rem); } }
                @media (prefers-reduced-motion: reduce) {
                    .scn-buffer__spin, .scn-buffer__petal { animation: none !important; }
                }
            `}</style>
        </div>
    );
}
