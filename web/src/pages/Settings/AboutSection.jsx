import { useState, useEffect } from "react";
import { Code2, Copy, Check } from "lucide-react";
import { Card, Row, DangerButton, GhostButton, SectionLabel, ConfirmModal, PinModal, copyText, hasPin } from "./shared";
import { clearHistory } from "../../api";
import Logo from "../../Components/Logo";

const APP_VERSION = "0.1.0";

const STACK = [
    ["Frontend", "React, Vite, DaisyUI, Tailwind CSS"],
    ["Backend", "Node.js, Express, Prisma"],
    ["Media", "HLS.js, FFmpeg"],
    ["Metadata", "TMDB API"],
];

export default function AboutSection({ setPrefs }) {
    const serverUrl = import.meta.env.VITE_API_URL || "http://localhost:5000";

    const [confirm, setConfirm] = useState(null); // "history" | "prefs" | null
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState(null); // "history" | "prefs" | "error" | null
    const [copied, setCopied] = useState(false);
    const [pinGate, setPinGate] = useState(null);
    const [server, setServer] = useState(null);

    useEffect(() => {
        const ctl = new AbortController();
        fetch(`${serverUrl}/health`, { signal: ctl.signal })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => d && setServer(d))
            .catch(() => {});
        return () => ctl.abort();
    }, [serverUrl]);

    async function clearWatch() {
        setBusy(true);
        try {
            await clearHistory();
            setDone("history");
        } catch {
            setDone("error");
        } finally {
            setBusy(false);
            setConfirm(null);
        }
    }

    function resetPrefs() {
        setPrefs({});
        setDone("prefs");
        setConfirm(null);
    }

    async function copyDiagnostics() {
        const info = {
            app: `Flux v${APP_VERSION}`,
            server: server ? `v${server.version ?? "?"}, up ${Math.round((server.uptime ?? 0) / 60)} min` : "unreachable",
            userAgent: navigator.userAgent,
            screen: `${window.screen.width}x${window.screen.height} @${window.devicePixelRatio}x`,
            viewport: `${window.innerWidth}x${window.innerHeight}`,
            language: navigator.language,
            time: new Date().toISOString(),
        };
        const ok = await copyText(JSON.stringify(info, null, 2));
        setCopied(ok);
        if (ok) setTimeout(() => setCopied(false), 2000);
    }

    return (
        <div className="w-full space-y-6">
            <Card>
                <div className="flex items-center gap-4 border-b border-base-content/10 px-4 py-4 sm:px-5">
                    <Logo />
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold leading-tight text-base-content">Flux</p>
                        <p className="mt-0.5 text-[13px] text-base-content/60">Self-hosted media player</p>
                    </div>
                    <span className="rounded-md border border-base-content/15 bg-base-300 px-2 py-1 font-mono text-xs text-base-content/70">v{APP_VERSION}</span>
                </div>
                <p className="px-4 py-4 text-sm leading-relaxed text-base-content/80 sm:px-5">Personal self-hosted media server. Built as an alternative to Plex and Jellyfin, with MX Player–style gesture controls.</p>
                <dl className="grid grid-cols-2 border-t border-base-content/10 bg-base-300/40">
                    <div className="px-4 py-3 sm:px-5">
                        <dt className="text-xs text-base-content/55">Server version</dt>
                        <dd className="mt-0.5 font-mono text-[13px] text-base-content">{server?.version ? `v${server.version}` : "—"}</dd>
                    </div>
                    <div className="border-l border-base-content/10 px-4 py-3 sm:px-5">
                        <dt className="text-xs text-base-content/55">Web app version</dt>
                        <dd className="mt-0.5 font-mono text-[13px] text-base-content">v{APP_VERSION}</dd>
                    </div>
                </dl>
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
                <SectionLabel hint="Paste this when reporting a bug. No personal data included.">Support</SectionLabel>
                <Card>
                    <Row id="ab-diag" label="Copy diagnostics" desc="App and server version, browser and screen size">
                        <GhostButton onClick={copyDiagnostics}>
                            {copied ? <Check size={13} strokeWidth={3} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
                        </GhostButton>
                    </Row>
                </Card>
            </div>

            <div>
                <SectionLabel hint="These can't be undone.">Reset</SectionLabel>
                {done === "error" && (
                    <p role="alert" className="mb-2 rounded-md border border-error/35 bg-error/10 px-3 py-2 text-[13px] text-error">
                        Could not reach the server. Nothing was cleared.
                    </p>
                )}
                <Card>
                    <Row id="ab-history" label={done === "history" ? "Watch history cleared" : "Clear watch history"} desc="Remove all viewing progress and resume points" danger>
                        <DangerButton onClick={() => setConfirm("history")}>Clear</DangerButton>
                    </Row>
                    <Row id="ab-prefs" label={done === "prefs" ? "Preferences reset" : "Reset preferences"} desc="Put every setting back to its default" danger>
                        <DangerButton onClick={() => (hasPin() ? setPinGate(() => () => setConfirm("prefs")) : setConfirm("prefs"))}>Reset</DangerButton>
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
                subtitle="Playback, subtitle, server, privacy and restriction options return to their defaults. Your PIN stays."
                confirmLabel="Reset preferences"
                onConfirm={resetPrefs}
            />
            <PinModal
                open={!!pinGate}
                onClose={() => setPinGate(null)}
                onVerified={() => {
                    const fn = pinGate;
                    setPinGate(null);
                    fn?.();
                }}
            />
        </div>
    );
}
