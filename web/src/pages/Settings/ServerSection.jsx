import { useState } from "react";
import { Wifi, WifiOff, CheckCircle, Server as ServerIcon, Radio } from "lucide-react";
import { Card, Row, Toggle, SectionLabel } from "./shared";

function safeLabel(url) {
    try {
        const u = new URL(url);
        const isLocalhost = u.hostname === "localhost" || u.hostname === "127.0.0.1";
        const isLan = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(u.hostname);
        if (isLocalhost) return `localhost · port ${u.port || 80}`;
        if (isLan) return `Local network · port ${u.port || 80}`;
        return `Remote · port ${u.port || (u.protocol === "https:" ? 443 : 80)}`;
    } catch {
        return "Configured";
    }
}

export default function ServerSection({ prefs, setPref }) {
    const serverUrl = import.meta.env.VITE_API_URL || "http://localhost:5000";
    const [ping, setPing] = useState(null);

    async function doPing() {
        setPing("checking");
        try {
            const r = await fetch(`${serverUrl}/api/health`, { signal: AbortSignal.timeout(4000) });
            setPing(r.ok ? "ok" : "error");
        } catch {
            setPing("error");
        }
        setTimeout(() => setPing(null), 3000);
    }

    return (
        <div className="w-full space-y-6">
            <div>
                <SectionLabel icon={ServerIcon}>Connection</SectionLabel>
                <Card>
                    <div className="flex items-center justify-between gap-6 px-5 py-5">
                        <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-xl bg-success/20 flex items-center justify-center shrink-0">
                                <Wifi size={17} className="text-success" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-[14px] font-semibold text-white leading-tight">Media server</p>
                                <p className="text-[12px] text-white/85 mt-0.5 truncate">{safeLabel(serverUrl)}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            {ping === "ok" && <CheckCircle size={14} className="text-success" />}
                            {ping === "error" && <WifiOff size={14} className="text-error" />}
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-success bg-success/20 px-2.5 py-1 rounded-full border border-success/40">
                                <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" /> Online
                            </span>
                            <button
                                onClick={doPing}
                                disabled={ping === "checking"}
                                style={{ outline: "none" }}
                                className="text-[11px] text-white font-semibold px-3 py-1.5 rounded-lg hover:bg-white/[0.12] border border-white/[0.18] hover:border-white/30 transition-all disabled:opacity-40">
                                {ping === "checking" ? "Pinging…" : "Ping"}
                            </button>
                        </div>
                    </div>
                </Card>
            </div>

            <div>
                <SectionLabel icon={Radio}>Streaming</SectionLabel>
                <Card>
                    <Row label="Direct play" desc="Stream files directly without transcoding">
                        <Toggle value={prefs.directPlay ?? true} onChange={(v) => setPref("directPlay", v)} />
                    </Row>
                    <Row label="Prefer HLS" desc="Use adaptive HLS streaming when available (requires FFmpeg)">
                        <Toggle value={prefs.preferHLS ?? false} onChange={(v) => setPref("preferHLS", v)} />
                    </Row>
                    <Row label="Buffer ahead" desc="Pre-buffer segments for smoother playback" noBorder>
                        <Toggle value={prefs.bufferAhead ?? true} onChange={(v) => setPref("bufferAhead", v)} />
                    </Row>
                </Card>
            </div>
        </div>
    );
}
