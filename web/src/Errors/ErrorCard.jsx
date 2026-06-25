// web/src/Errors/ErrorCard.jsx
import { useNavigate } from "react-router";

function SprocketStrip({ position }) {
    return (
        <div className={`sprocket sprocket--${position}`} aria-hidden="true">
            {Array.from({ length: 24 }).map((_, i) => (
                <span key={i} className="sprocket__hole" style={{ animationDelay: `${(i % 6) * 0.15}s` }} />
            ))}
        </div>
    );
}

export default function ErrorCard({ code, title, description, illustration: Illustration, primaryAction, primaryLabel, primaryIcon: PrimaryIcon }) {
    const navigate = useNavigate();

    return (
        <div className="errcard">
            <SprocketStrip position="top" />
            <SprocketStrip position="bottom" />

            <div className="errcard__beam" aria-hidden="true" />
            <div className="errcard__grain" aria-hidden="true" />

            <div className="errcard__inner">
                {/* Countdown leader — the signature element */}
                <div className="leader">
                    <svg viewBox="0 0 200 200" className="leader__svg" aria-hidden="true">
                        <circle cx="100" cy="100" r="92" fill="none" stroke="currentColor" strokeWidth="1.5" className="leader__ring" />
                        <line x1="100" y1="100" x2="100" y2="14" stroke="currentColor" strokeWidth="2" className="leader__sweep" />
                        <line x1="8" y1="100" x2="192" y2="100" stroke="currentColor" strokeWidth="1" opacity="0.25" />
                        <line x1="100" y1="8" x2="100" y2="192" stroke="currentColor" strokeWidth="1" opacity="0.25" />
                    </svg>
                    <span className="leader__code">{code}</span>
                </div>

                <p className="errcard__eyebrow">FLUX · Reel Interrupted</p>
                <h1 className="errcard__title">{title}</h1>
                <p className="errcard__desc">{description}</p>

                <div className="errcard__icon">{Illustration && <Illustration />}</div>

                <div className="errcard__actions">
                    <button onClick={() => navigate(-1)} className="btn btn-ghost rounded-full px-8 border border-base-content/10 hover:bg-base-content/5 transition-colors">
                        Go Back
                    </button>
                    {primaryAction && primaryLabel && (
                        <button
                            onClick={primaryAction}
                            className="btn btn-primary rounded-full px-10 gap-2 shadow-lg shadow-primary/20 hover:-translate-y-0.5 transition-transform">
                            {PrimaryIcon && <PrimaryIcon size={16} />}
                            {primaryLabel}
                        </button>
                    )}
                </div>
            </div>

            <style>{`
                .errcard {
                    position: relative; width: 100%; max-width: 640px; margin: 2rem auto;
                    padding: 3.5rem 2rem; border-radius: 1.5rem;
                    background: var(--color-base-200);
                    border: 1px solid color-mix(in oklch, var(--color-base-content) 8%, transparent);
                    overflow: hidden; isolation: isolate;
                    animation: errcardIn 0.5s cubic-bezier(.2,.8,.2,1) both;
                }

                .sprocket { position: absolute; left: 0; right: 0; height: 1.4rem; display: flex; justify-content: space-between; padding: 0 1rem;
                    background: color-mix(in oklch, var(--color-base-content) 6%, transparent); z-index: 1; }
                .sprocket--top { top: 0; }
                .sprocket--bottom { bottom: 0; }
                .sprocket__hole { width: 0.5rem; height: 0.5rem; border-radius: 2px; margin-top: 0.45rem;
                    background: var(--color-base-100); animation: sprocketPulse 1.8s ease-in-out infinite; }

                .errcard__beam {
                    position: absolute; top: -25%; left: 50%; width: 140%; height: 140%; transform: translateX(-50%);
                    background: conic-gradient(from 180deg at 50% 0%, transparent 0deg, color-mix(in oklch, var(--color-primary) 16%, transparent) 8deg, transparent 26deg);
                    animation: beamSweep 7s ease-in-out infinite; z-index: 0; pointer-events: none;
                }

                .errcard__grain {
                    position: absolute; inset: 0; z-index: 1; pointer-events: none; opacity: 0.05; mix-blend-mode: overlay;
                    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
                    animation: grainShift 1s steps(2) infinite;
                }

                .errcard__inner { position: relative; z-index: 2; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 0.85rem; }

                .leader { position: relative; width: 7.5rem; height: 7.5rem; display: flex; align-items: center; justify-content: center; color: var(--color-primary); margin-bottom: 0.5rem; }
                .leader__svg { position: absolute; inset: 0; width: 100%; height: 100%; }
                .leader__ring { opacity: 0.4; }
                .leader__sweep { transform-origin: 100px 100px; animation: leaderSweep 6s linear infinite; }
                .leader__code { position: relative; z-index: 1; font-family: "CircularStd", "IBM Plex Sans", sans-serif; font-weight: 700; font-size: 1.7rem; letter-spacing: 0.04em; color: var(--color-base-content); }

                .errcard__eyebrow { font-size: 0.68rem; letter-spacing: 0.22em; text-transform: uppercase; color: var(--color-primary); font-weight: 600; }
                .errcard__title { font-size: clamp(1.5rem, 4vw, 2.1rem); font-weight: 800; color: var(--color-base-content); line-height: 1.15; }
                .errcard__desc { max-width: 30rem; color: color-mix(in oklch, var(--color-base-content) 65%, transparent); font-size: 0.92rem; line-height: 1.6; }
                .errcard__icon { margin: 1rem 0 0.5rem; }
                .errcard__actions { display: flex; flex-wrap: wrap; gap: 0.75rem; justify-content: center; margin-top: 1rem; }

                @keyframes errcardIn { from { opacity: 0; transform: translateY(10px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
                @keyframes leaderSweep { to { transform: rotate(360deg); } }
                @keyframes beamSweep { 0%,100% { opacity: 0.6; transform: translateX(-50%) rotate(-4deg); } 50% { opacity: 1; transform: translateX(-50%) rotate(4deg); } }
                @keyframes sprocketPulse { 0%,100% { opacity: 0.45; } 50% { opacity: 1; } }
                @keyframes grainShift { 0% { transform: translate(0,0); } 50% { transform: translate(-2%,1%); } 100% { transform: translate(0,0); } }

                @media (prefers-reduced-motion: reduce) {
                    .errcard, .leader__sweep, .errcard__beam, .errcard__grain, .sprocket__hole { animation: none !important; }
                }
            `}</style>
        </div>
    );
}
