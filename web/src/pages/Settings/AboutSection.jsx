import { Code2 } from "lucide-react";
import { Card, Row, SectionTitle } from "./shared";
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

    return (
        <div className="space-y-5">

            <Card>
                <div className="flex items-center gap-4 px-6 py-5 border-b border-white/5">
                    <Logo />
                    <div className="flex-1 min-w-0">
                        <p className="font-semibold text-white">Flux</p>
                        <p className="text-xs text-white/50 mt-0.5">Self-hosted media player</p>
                    </div>
                    <span className="text-xs font-mono text-white/30 shrink-0">v0.1.0</span>
                </div>
                <div className="px-6 py-4 border-b border-white/5">
                    <p className="text-xs text-white/50 leading-relaxed">
                        Flux is a personal self-hosted media server built as an alternative to Plex and Jellyfin. Designed for CasaOS + local network use.
                    </p>
                </div>
                <Row label="Built with" desc="React · Node.js · Express · TMDB API">
                    <Code2 size={14} className="text-white/40" />
                </Row>
                <Row label="Clear watch history" desc="Permanently remove all viewing progress data" danger>
                    <button
                        onClick={handleClearHistory}
                        style={{ outline: "none", boxShadow: "none" }}
                        className="btn btn-xs btn-error btn-outline rounded focus:outline-none focus-visible:outline-none">
                        Clear
                    </button>
                </Row>
                <Row label="Reset all preferences" desc="Restore every setting to its default value" danger>
                    <button
                        onClick={handleResetPrefs}
                        style={{ outline: "none", boxShadow: "none" }}
                        className="btn btn-xs btn-error btn-outline rounded focus:outline-none focus-visible:outline-none">
                        Reset
                    </button>
                </Row>
            </Card>
        </div>
    );
}
