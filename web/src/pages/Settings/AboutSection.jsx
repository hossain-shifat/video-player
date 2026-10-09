import { useState } from "react";
import { Code2 } from "lucide-react";
import { Card, Row, DangerButton, SectionLabel, ConfirmModal } from "./shared";
import { clearHistory } from "../../api";
import Logo from "../../Components/Logo";

const STACK = [
    ["Frontend", "React, Vite, DaisyUI, Tailwind CSS"],
    ["Backend", "Node.js, Express, Prisma"],
    ["Media", "HLS.js, FFmpeg"],
    ["Metadata", "TMDB API"],
];

export default function AboutSection({ setPrefs }) {
    const [confirm, setConfirm] = useState(null); // "history" | "prefs" | null
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState(null);

    async function clearWatch() {
        setBusy(true);
        try {
            await clearHistory();
            setDone("history");
        } catch {
        } finally {
            setBusy(false);
            setConfirm(null);
        }
    }
    function resetPrefs() {
        try {
            localStorage.removeItem("flux-prefs");
        } catch {}
        setPrefs({});
        setDone("prefs");
        setConfirm(null);
    }

    return (
        <div className="space-y-6 w-full">
            <Card>
                <div className="flex items-center gap-4 border-b border-base-content/10 px-4 py-4 sm:px-5">
                    <Logo />
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-base-content leading-tight">Flux</p>
                        <p className="mt-0.5 text-[13px] text-base-content/60">Self-hosted media player</p>
                    </div>
                    <span className="rounded-field border border-base-content/15 bg-base-300 px-2 py-1 font-mono text-xs text-base-content/70">v0.1.0</span>
                </div>
                <p className="px-4 py-4 text-sm leading-relaxed text-base-content/80 sm:px-5">
                    Personal self-hosted media server. Built as an alternative to Plex and Jellyfin, with MX Player–style gesture controls.
                </p>
            </Card>

            <div>
                <SectionLabel>Built with</SectionLabel>
                <Card>
                    <dl className="grid grid-cols-1 sm:grid-cols-2">
                        {STACK.map(([layer, tech]) => (
                            <div key={layer} className="flex items-start gap-3 border-b border-base-content/10 px-4 py-3 last:border-b-0 sm:px-5 sm:[&:nth-last-child(2)]:border-b-0">
                                <Code2 size={14} className="mt-0.5 shrink-0 text-primary" />
                                <div>
                                    <dt className="text-xs text-base-content/55">{layer}</dt>
                                    <dd className="mt-0.5 text-[13px] text-base-content">{tech}</dd>
                                </div>
                            </div>
                        ))}
                    </dl>
                </Card>
            </div>

            <div>
                <SectionLabel hint="These can't be undone.">Reset</SectionLabel>
                <Card>
                    <Row label={done === "history" ? "Watch history cleared" : "Clear watch history"} desc="Remove all viewing progress and resume points" danger>
                        <DangerButton onClick={() => setConfirm("history")}>Clear</DangerButton>
                    </Row>
                    <Row label={done === "prefs" ? "Preferences reset" : "Reset preferences"} desc="Put every setting back to its default" danger>
                        <DangerButton onClick={() => setConfirm("prefs")}>Reset</DangerButton>
                    </Row>
                </Card>
            </div>

            <ConfirmModal
                open={confirm === "history"}
                onClose={() => setConfirm(null)}
                title="Clear watch history?"
                subtitle="All resume points and viewing progress will be removed permanently."
                confirmLabel="Clear history"
                loading={busy}
                onConfirm={clearWatch}
            />
            <ConfirmModal
                open={confirm === "prefs"}
                onClose={() => setConfirm(null)}
                title="Reset all preferences?"
                subtitle="Playback, subtitle, server and privacy options return to their defaults."
                confirmLabel="Reset preferences"
                onConfirm={resetPrefs}
            />
        </div>
    );
}
