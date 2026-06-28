import { Code2, ExternalLink } from "lucide-react";
import { Card, Row } from "./shared";
import { clearHistory } from "../../api";
import Logo from "../../Components/Logo";

export default function AboutSection({ setPrefs }) {
    const handleClearHistory = async () => {
        try {
            await clearHistory();
        } catch (e) {
            console.error("[About] clearHistory failed:", e);
        }
    };

    const handleResetPrefs = () => {
        try {
            localStorage.removeItem("flux-prefs");
        } catch {}
        setPrefs({});
    };

    const STACK = [
        ["Frontend", "React · Vite · DaisyUI · Tailwind CSS"],
        ["Backend", "Node.js · Express · Prisma"],
        ["Media", "HLS.js · FFmpeg (transcoding)"],
        ["Metadata", "TMDB API"],
    ];

    return (
        <div className="space-y-5">
            <Card>
                {/* Brand row */}
                <div className="flex items-center gap-4 px-5 py-5 border-b border-white/[0.06]">
                    <Logo />
                    <div className="flex-1 min-w-0">
                        <p className="font-semibold text-white">Flux</p>
                        <p className="text-xs text-white/40 mt-0.5">Self-hosted media player</p>
                    </div>
                    <span className="text-xs font-mono text-white/25 shrink-0 bg-white/[0.05] px-2 py-1 rounded-md">v0.1.0</span>
                </div>

                {/* Description */}
                <div className="px-5 py-4 border-b border-white/[0.06]">
                    <p className="text-xs text-white/50 leading-relaxed">
                        Flux is a personal self-hosted media server built as an alternative to Plex and Jellyfin.
                        Designed for CasaOS and local network use, with MX Player–style gesture controls.
                    </p>
                </div>

                {/* Stack */}
                <div className="px-5 py-4 border-b border-white/[0.06]">
                    <p className="text-[10px] font-bold text-white/25 uppercase tracking-widest mb-3">Built with</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {STACK.map(([layer, tech]) => (
                            <div key={layer} className="flex items-start gap-2">
                                <Code2 size={12} className="text-primary/50 mt-0.5 shrink-0" />
                                <div>
                                    <p className="text-[10px] text-white/30 font-semibold uppercase tracking-wider">{layer}</p>
                                    <p className="text-xs text-white/65 mt-0.5">{tech}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Danger actions */}
                <Row label="Clear watch history" desc="Permanently remove all viewing progress data" danger>
                    <button
                        onClick={handleClearHistory}
                        style={{ outline: "none", boxShadow: "none" }}
                        className="btn btn-xs btn-error btn-outline rounded-lg focus:outline-none focus-visible:outline-none border-error/30">
                        Clear
                    </button>
                </Row>
                <Row label="Reset all preferences" desc="Restore every setting to its default value" danger>
                    <button
                        onClick={handleResetPrefs}
                        style={{ outline: "none", boxShadow: "none" }}
                        className="btn btn-xs btn-error btn-outline rounded-lg focus:outline-none focus-visible:outline-none border-error/30">
                        Reset
                    </button>
                </Row>
            </Card>
        </div>
    );
}
