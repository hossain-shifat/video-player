// web/src/Errors/ErrorScene.jsx
import { useNavigate } from "react-router";

function Bulbs({ count = 16 }) {
    return (
        <div className="bulbs" aria-hidden="true">
            {Array.from({ length: count }).map((_, i) => (
                <span key={i} className="bulbs__dot" style={{ animationDelay: `${(i % 6) * 0.18}s` }} />
            ))}
        </div>
    );
}

function Sprockets() {
    return (
        <div className="sprockets" aria-hidden="true">
            {Array.from({ length: 48 }).map((_, i) => (
                <span key={i} className="sprockets__hole" />
            ))}
        </div>
    );
}

export default function ErrorScene({ code, title, description, illustration: Illustration, primaryAction, primaryLabel, primaryIcon: PrimaryIcon, eyebrow = "FLUX" }) {
    const navigate = useNavigate();

    return (
        <div className="errscene">
            <div className="errscene__bg" aria-hidden="true" />
            <div className="errscene__scanlines" aria-hidden="true" />
            <div className="errscene__grain" aria-hidden="true" />
            <div className="errscene__vignette" aria-hidden="true" />

            <Sprockets />

            <header className="errscene__marquee">
                <span className="errscene__brand">FLUX</span>
                <Bulbs />
            </header>

            <main className="errscene__stage">
                <div className="errscene__illustration">{Illustration && <Illustration />}</div>

                <p className="errscene__eyebrow">{eyebrow}</p>
                <div className="errscene__code">{code}</div>
                <h1 className="errscene__title">{title}</h1>
                <p className="errscene__desc">{description}</p>

                <div className="errscene__actions">
                    <button
                        onClick={() => navigate(-1)}
                        className="btn btn-ghost rounded-md px-8 border border-base-content/10 hover:bg-base-content/5 hover:scale-105 active:scale-95 transition-all duration-200">
                        Go Back
                    </button>
                    {primaryAction && primaryLabel && (
                        <button
                            onClick={primaryAction}
                            className="btn btn-primary border-none rounded-md px-10 gap-2 shadow-lg shadow-primary/30 hover:-translate-y-0.5 hover:scale-105 hover:shadow-xl hover:shadow-primary/40 active:scale-95 active:translate-y-0 transition-all duration-200">
                            {PrimaryIcon && <PrimaryIcon size={16} />}
                            {primaryLabel}
                        </button>
                    )}
                </div>
            </main>

            <Sprockets />

            <style>{`
                .errscene { position: fixed; inset: 0; z-index: 60; height: 100dvh; overflow: hidden auto; background: var(--color-base-100); isolation: isolate; display: flex; flex-direction: column; }
                .errscene__bg { position: fixed; inset: 0; z-index: 0;
                    background:
                        radial-gradient(60rem 40rem at 50% -10%, color-mix(in oklch, var(--color-primary) 20%, transparent), transparent 60%),
                        radial-gradient(50rem 36rem at 90% 110%, color-mix(in oklch, var(--color-accent) 14%, transparent), transparent 60%),
                        var(--color-base-100); }
                .errscene__vignette { position: fixed; inset: 0; z-index: 1; pointer-events: none;
                    background: radial-gradient(120% 100% at 50% 50%, transparent 40%, color-mix(in oklch, var(--color-base-100) 75%, black) 100%); }
                .errscene__scanlines { position: fixed; inset: 0; z-index: 1; pointer-events: none; opacity: 0.05;
                    background: repeating-linear-gradient(0deg, var(--color-base-content) 0px, var(--color-base-content) 1px, transparent 1px, transparent 3px);
                    animation: scanDrift 9s linear infinite; }
                .errscene__grain { position: fixed; inset: 0; z-index: 1; pointer-events: none; opacity: 0.045; mix-blend-mode: overlay;
                    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
                    animation: grainShift 1s steps(2) infinite; }

                .sprockets { position: relative; flex-shrink: 0; left: 0; right: 0; height: 1.3rem; display: flex; gap: 0.6rem; padding: 0 1rem; align-items: center;
                    background: color-mix(in oklch, var(--color-base-content) 6%, transparent); z-index: 5; overflow: hidden; }
                .sprockets__hole { flex: none; width: 0.42rem; height: 0.42rem; border-radius: 2px; background: var(--color-base-100); opacity: 0.6; }

                .errscene__marquee { position: relative; z-index: 5; flex-shrink: 0; display: flex; flex-direction: column; align-items: center; gap: 0.4rem; padding: 0.6rem 1rem 0; }
                .errscene__brand { font-family: "IBM Plex Sans", sans-serif; font-weight: 900; letter-spacing: 0.08em; font-size: 1.05rem; color: var(--color-primary); }
                .bulbs { display: flex; gap: 0.45rem; }
                .bulbs__dot { width: 0.38rem; height: 0.38rem; border-radius: 999px; background: var(--color-secondary); animation: bulbBlink 1.8s ease-in-out infinite;
                    box-shadow: 0 0 6px color-mix(in oklch, var(--color-secondary) 70%, transparent); }

                .errscene__stage { position: relative; z-index: 5; max-width: 640px; width: 100%; margin: 0 auto; padding: clamp(0.5rem,2vh,1.5rem) 1.25rem;
                    display: flex; flex-direction: column; align-items: center; text-align: center; gap: clamp(0.3rem,1vh,0.75rem);
                    flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; justify-content: center; }
                .errscene__illustration { width: 100%; max-width: min(14rem, 32vh); aspect-ratio: 1.25; display: flex; align-items: center; justify-content: center; flex-shrink: 1; }
                .errscene__eyebrow { font-size: 0.66rem; letter-spacing: 0.24em; text-transform: uppercase; color: var(--color-primary); font-weight: 700; }
                .errscene__code { font-family: "CircularStd", "IBM Plex Sans", sans-serif; font-weight: 800; font-size: clamp(1.8rem, 6vh, 3.8rem); line-height: 1; letter-spacing: 0.02em;
                    background: linear-gradient(180deg, var(--color-base-content), color-mix(in oklch, var(--color-base-content) 35%, transparent));
                    -webkit-background-clip: text; background-clip: text; color: transparent; }
                .errscene__title { font-size: clamp(1.1rem, 3.6vh, 1.85rem); font-weight: 800; color: var(--color-base-content); }
                .errscene__desc { max-width: 27rem; color: color-mix(in oklch, var(--color-base-content) 65%, transparent); font-size: clamp(0.78rem, 2vh, 0.9rem); line-height: 1.5; }
                .errscene__actions { display: flex; flex-wrap: wrap; gap: 0.6rem; justify-content: center; margin-top: clamp(0.25rem,1vh,1rem); }
                .errscene__actions .btn { height: clamp(2rem, 5vh, 2.75rem); min-height: 0; font-size: clamp(0.78rem, 1.8vh, 0.9rem); }

                @keyframes scanDrift { from { background-position: 0 0; } to { background-position: 0 40px; } }
                @keyframes grainShift { 0% { transform: translate(0,0); } 50% { transform: translate(-2%,1%); } 100% { transform: translate(0,0); } }
                @keyframes bulbBlink { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }

                @media (prefers-reduced-motion: reduce) {
                    .errscene__scanlines, .errscene__grain, .bulbs__dot { animation: none !important; }
                }
            `}</style>
        </div>
    );
}
