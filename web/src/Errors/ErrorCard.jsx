// web/src/Errors/ErrorCard.jsx
import { useNavigate } from "react-router";

export default function ErrorCard({
    code,
    title,
    description,
    illustration: Illustration,
    primaryAction,
    primaryLabel,
}) {
    const navigate = useNavigate();

    return (
        <div className="w-full flex flex-col items-center text-center relative py-12 md:py-20 z-10">
            {/* Massive Background Text */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none overflow-hidden z-0">
                <span className="text-[40vw] md:text-[280px] font-black text-base-content/[0.03] tracking-tighter leading-none whitespace-nowrap">
                    {code}
                </span>
            </div>

            {/* Top Text */}
            <div className="z-10 mb-4 md:mb-8">
                <h1 className="text-4xl md:text-5xl font-black text-base-content mb-2 tracking-tight">Oops!</h1>
                <p className="text-base-content/60 text-sm md:text-base font-semibold uppercase tracking-widest">{title}</p>
            </div>

            {/* Illustration Area */}
            <div className="z-10 relative my-10 md:my-16 flex items-center justify-center">
                {/* Playful background blobs */}
                <div className="w-40 h-40 md:w-56 md:h-56 bg-primary/10 rounded-[3rem] rotate-6 absolute -z-10 transition-transform duration-1000 hover:rotate-12"></div>
                <div className="w-40 h-40 md:w-56 md:h-56 bg-secondary/10 rounded-[4rem] -rotate-12 absolute -z-10 transition-transform duration-1000 hover:-rotate-3"></div>
                
                {/* Icon */}
                <div className="bg-base-100 p-6 md:p-8 rounded-full shadow-xl border border-base-content/5">
                    {Illustration && <Illustration size={80} strokeWidth={1.5} className="text-primary" />}
                </div>
            </div>

            {/* Description & Actions */}
            <div className="z-10 flex flex-col items-center">
                <p className="text-base-content/70 max-w-sm mb-8 text-sm md:text-base leading-relaxed">{description}</p>
                <div className="flex flex-col sm:flex-row gap-3 md:gap-4 w-full sm:w-auto px-6">
                    <button 
                        onClick={() => navigate(-1)} 
                        className="btn btn-ghost rounded-full px-8 hover:bg-base-content/5 transition-colors border border-base-content/10"
                    >
                        Go Back
                    </button>
                    {primaryAction && primaryLabel && (
                        <button 
                            onClick={primaryAction} 
                            className="btn btn-primary rounded-full px-10 shadow-lg shadow-primary/20 hover:-translate-y-0.5 transition-transform"
                        >
                            {primaryLabel}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
