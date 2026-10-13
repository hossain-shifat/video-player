import { useState, useCallback, useEffect } from "react";
import { Wifi, WifiOff, Server as ServerIcon, Radio, RefreshCw, Activity, Clock, Tag, FileVideo } from "lucide-react";
import { Card, Row, Toggle, SectionLabel, GhostButton, Chip, StatGrid, StatTile } from "./shared";

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

function fmtUptime(sec) {
    if (typeof sec !== "number" || !isFinite(sec)) return "—";
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    return `${Math.max(m, 0)}m`;
}

const STATUS = {
    checking: { text: "Checking…", tone: "neutral", dot: "bg-base-content/50 animate-pulse" },
    ok: { text: "Online", tone: "success", dot: "bg-success" },
    error: { text: "Unreachable", tone: "error", dot: "bg-error" },
};

const POLL_MS = 30000;
const MAX_SAMPLES = 16;

function LatencyBars({ samples }) {
    const max = Math.max(60, ...samples.filter((s) => s != null));
    return (
        <div className="flex h-9 items-end gap-1" role="img" aria-label="Recent response times">
            {samples.length === 0 && <span className="text-xs text-base-content/50">No samples yet</span>}
            {samples.map((s, i) => (
                <span
                    key={i}
                    title={s == null ? "No reply" : `${s} ms`}
                    className={`w-1.5 rounded-sm ${s == null ? "bg-error/70" : s > 300 ? "bg-warning/80" : "bg-success/70"}`}
                    style={{ height: s == null ? "100%" : `${Math.max(12, Math.round((s / max) * 100))}%` }}
                />
            ))}
        </div>
    );
}

export default function ServerSection({ prefs, setPref }) {
    const serverUrl = import.meta.env.VITE_API_URL || "http://localhost:5000";
    const [ping, setPing] = useState("checking");
    const [ms, setMs] = useState(null);
    const [health, setHealth] = useState(null);
    const [info, setInfo] = useState(null);
    const [samples, setSamples] = useState([]);

    const push = (v) => setSamples((s) => [...s, v].slice(-MAX_SAMPLES));

    const check = useCallback(async () => {
        const t0 = performance.now();
        try {
            const r = await fetch(`${serverUrl}/health`, { signal: AbortSignal.timeout(4000) });
            const took = Math.round(performance.now() - t0);
            if (!r.ok) throw new Error("bad status");
            setHealth(await r.json().catch(() => null));
            setMs(took);
            setPing("ok");
            push(took);
        } catch {
            setMs(null);
            setPing("error");
            push(null);
        }
    }, [serverUrl]);

    // Check now, then every 30 s while the tab is open
    useEffect(() => {
        check();
        const id = setInterval(check, POLL_MS);
        return () => clearInterval(id);
    }, [check]);

    // Static server info (formats, folder count)
    useEffect(() => {
        const ctl = new AbortController();
        fetch(`${serverUrl}/api/info`, { signal: ctl.signal })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => d && setInfo(d))
            .catch(() => {});
        return () => ctl.abort();
    }, [serverUrl]);

    const s = STATUS[ping];
    const Icon = ping === "error" ? WifiOff : Wifi;

    return (
        <div className="w-full space-y-6">
            <div id="sv-conn" className="scroll-mt-28">
                <SectionLabel icon={ServerIcon} hint="Checked every 30 seconds while this page is open.">
                    Connection
                </SectionLabel>
                <Card>
                    <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                        <div className="flex min-w-0 items-center gap-3">
                            <Icon size={20} className={ping === "error" ? "text-error" : ping === "ok" ? "text-success" : "text-base-content/50"} />
                            <div className="min-w-0">
                                <p className="text-sm font-medium text-base-content">Media server</p>
                                <p className="mt-0.5 truncate text-[13px] text-base-content/60">
                                    {networkKind(serverUrl)}
                                    {ping === "ok" && ms != null ? `, replied in ${ms} ms` : ""}
                                    {ping === "error" ? ", check that the server is running" : ""}
                                </p>
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <Chip tone={s.tone}>
                                <span className={`size-1.5 rounded-md ${s.dot}`} /> {s.text}
                            </Chip>
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
                    <div className="flex items-center justify-between gap-4 border-t border-base-content/10 bg-base-300/40 px-4 py-3 sm:px-5">
                        <p className="text-xs text-base-content/60">Response time, last {samples.length || 0} checks</p>
                        <LatencyBars samples={samples} />
                    </div>
                </Card>
            </div>

            <StatGrid>
                <StatTile icon={Activity} label="Status" value={s.text} tone={ping === "ok" ? "ok" : ping === "error" ? "danger" : "muted"} />
                <StatTile icon={Radio} label="Latency" value={ms != null ? `${ms} ms` : "—"} tone={ms != null && ms > 300 ? "warn" : "default"} />
                <StatTile icon={Clock} label="Uptime" value={fmtUptime(health?.uptime)} />
                <StatTile icon={Tag} label="Server version" value={health?.version ? `v${health.version}` : "—"} />
            </StatGrid>

            {info && (
                <div>
                    <SectionLabel icon={FileVideo} hint="File types this server picks up. Set VIDEO_EXTENSIONS and SUBTITLE_EXTENSIONS in the server .env to change them.">
                        Supported files
                    </SectionLabel>
                    <Card>
                        <div className="space-y-3 px-4 py-4 sm:px-5">
                            <div>
                                <p className="mb-1.5 text-xs text-base-content/55">Video</p>
                                <div className="flex flex-wrap gap-1.5">
                                    {(info.videoExtensions || []).map((e) => (
                                        <Chip key={e} className="font-mono">
                                            {e}
                                        </Chip>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <p className="mb-1.5 text-xs text-base-content/55">Subtitles</p>
                                <div className="flex flex-wrap gap-1.5">
                                    {(info.subtitleExtensions || []).map((e) => (
                                        <Chip key={e} className="font-mono">
                                            {e}
                                        </Chip>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </Card>
                </div>
            )}

            <div>
                <SectionLabel icon={Radio} hint="Direct play is fastest. HLS needs FFmpeg on the server.">Streaming</SectionLabel>
                <Card>
                    <Row id="sv-direct" label="Direct play" desc="Stream files as they are, no conversion">
                        <Toggle label="Direct play" value={prefs.directPlay ?? true} onChange={(v) => setPref("directPlay", v)} />
                    </Row>
                    <Row id="sv-hls" label="Prefer HLS" desc="Use adaptive streaming when available (requires FFmpeg)">
                        <Toggle label="Prefer HLS" value={prefs.preferHLS ?? false} onChange={(v) => setPref("preferHLS", v)} />
                    </Row>
                    <Row id="sv-buffer" label="Buffer ahead" desc="Load more video in advance for smoother playback">
                        <Toggle label="Buffer ahead" value={prefs.bufferAhead ?? true} onChange={(v) => setPref("bufferAhead", v)} />
                    </Row>
                </Card>
            </div>
        </div>
    );
}
