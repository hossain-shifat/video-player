import { Code2 } from "lucide-react";
import { Card, Row, DangerButton } from "./shared";
import { clearHistory } from "../../api";
import Logo from "../../Components/Logo";

const STACK = [
    ["Frontend", "React · Vite · DaisyUI · Tailwind CSS"],
    ["Backend", "Node.js · Express · Prisma"],
    ["Media", "HLS.js · FFmpeg"],
    ["Metadata", "TMDB API"],
];

export default function AboutSection({ setPrefs }) {
    async function clearWatch() {
        try {
            await clearHistory();
        } catch {}
    }
    function resetPrefs() {
        try {
            localStorage.removeItem("flux-prefs");
        } catch {}
        setPrefs({});
    }

    return (
        <div className="space-y-5 w-full">
            <Card>
                <div className="flex items-center gap-4 px-5 py-4 border-b border-white/[0.09]">
                    <Logo />
                    <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-semibold text-white leading-tight">Flux</p>
                        <p className="text-[11px] text-white/75 mt-0.5">Self-hosted media player</p>
                    </div>
                    <span className="text-[10px] font-mono text-white/70 bg-white/[0.08] px-2 py-1 rounded-md border border-white/[0.14]">v0.1.0</span>
                </div>
                <div className="px-5 py-3 border-b border-white/[0.09]">
                    <p className="text-[12px] text-white/90 leading-relaxed">Personal self-hosted media server. Built as an alternative to Plex and Jellyfin with MX Player–style gesture controls.</p>
                </div>
                <div className="px-5 py-3 border-b border-white/[0.09]">
                    <p className="text-[10px] font-bold text-white/85 uppercase tracking-[0.12em] mb-2.5">Stack</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-6">
                        {STACK.map(([layer, tech]) => (
                            <div key={layer} className="flex items-start gap-2">
                                <Code2 size={11} className="text-primary/80 mt-0.5 shrink-0" />
                                <div>
                                    <p className="text-[9px] font-bold text-white/70 uppercase tracking-wider">{layer}</p>
                                    <p className="text-[11px] text-white/90 mt-0.5">{tech}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                <Row label="Clear watch history" desc="Permanently remove all viewing progress data" danger>
                    <DangerButton onClick={clearWatch}>Clear</DangerButton>
                </Row>
                <Row label="Reset preferences" desc="Restore every setting to its default value" danger>
                    <DangerButton onClick={resetPrefs}>Reset</DangerButton>
                </Row>
            </Card>
        </div>
    );
}
