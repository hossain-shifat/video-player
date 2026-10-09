import { useState, useCallback, useEffect } from "react";
import { Wifi, WifiOff, Server as ServerIcon, Radio, RefreshCw } from "lucide-react";
import { Card, Row, Toggle, SectionLabel, GhostButton } from "./shared";

// Never show host, IP or port — only the kind of connection.
function networkKind(url) {
    try {
        const u = new URL(url);
        if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return "This device";
        if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(u.hostname)) return "Local network";
        return "Remote server";
    } catch {
        return "Configured";
    }
}

const STATUS = {
    checking: { text: "Checking…", cls: "text-base-content/70 bg-base-content/10 border-base-content/20", dot: "bg-base-content/50 animate-pulse" },
    ok: { text: "Online", cls: "text-success bg-success/10 border-success/35", dot: "bg-success" },
    error: { text: "Unreachable", cls: "text-error bg-error/10 border-error/35", dot: "bg-error" },
};

export default function ServerSection({ prefs, setPref }) {
    const serverUrl = import.meta.env.VITE_API_URL || "http://localhost:5000";
    const [ping, setPing] = useState("checking");
    const [ms, setMs] = useState(null);

    const check = useCallback(async () => {
        const t0 = performance.now();
        try {
            const r = await fetch(`${serverUrl}/health`, { signal: AbortSignal.timeout(4000) });
            setMs(Math.round(performance.now() - t0));
            setPing(r.ok ? "ok" : "error");
        } catch {
            setMs(null);
            setPing("error");
        }
    }, [serverUrl]);

    useEffect(() => {
        check();
    }, [check]);

    const s = STATUS[ping];
    const Icon = ping === "error" ? WifiOff : Wifi;

    return (
        <div className="w-full space-y-6">
            <div>
                <SectionLabel icon={ServerIcon}>Connection</SectionLabel>
                <Card>
                    <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                        <div className="flex min-w-0 items-center gap-3">
                            <Icon size={20} className={ping === "error" ? "text-error" : ping === "ok" ? "text-success" : "text-base-content/50"} />
                            <div className="min-w-0">
                                <p className="text-sm font-medium text-base-content">Media server</p>
                                <p className="mt-0.5 truncate text-[13px] text-base-content/60">
                                    {networkKind(serverUrl)}
                                    {ping === "ok" && ms != null ? ` · replied in ${ms} ms` : ""}
                                    {ping === "error" ? " · check that the server is running" : ""}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${s.cls}`}>
                                <span className={`size-1.5 rounded-full ${s.dot}`} /> {s.text}
                            </span>
                            <GhostButton
                                disabled={ping === "checking"}
                                onClick={() => {
                                    setPing("checking");
                                    check();
                                }}>
                                <RefreshCw size={13} className={ping === "checking" ? "animate-spin" : ""} /> Check again
                            </GhostButton>
                        </div>
                    </div>
                </Card>
            </div>

            <div>
                <SectionLabel icon={Radio} hint="Direct play is fastest. HLS needs FFmpeg on the server.">Streaming</SectionLabel>
                <Card>
                    <Row label="Direct play" desc="Stream files as they are, no conversion">
                        <Toggle label="Direct play" value={prefs.directPlay ?? true} onChange={(v) => setPref("directPlay", v)} />
                    </Row>
                    <Row label="Prefer HLS" desc="Use adaptive streaming when available (requires FFmpeg)">
                        <Toggle label="Prefer HLS" value={prefs.preferHLS ?? false} onChange={(v) => setPref("preferHLS", v)} />
                    </Row>
                    <Row label="Buffer ahead" desc="Load more video in advance for smoother playback">
                        <Toggle label="Buffer ahead" value={prefs.bufferAhead ?? true} onChange={(v) => setPref("bufferAhead", v)} />
                    </Row>
                </Card>
            </div>
        </div>
    );
}
