import { useState } from "react";
import { Wifi, WifiOff, CheckCircle } from "lucide-react";
import { Card, Row, Toggle } from "./shared";

export default function ServerSection({ prefs, setPref }) {
    const serverUrl = import.meta.env.VITE_API_URL || "http://localhost:5000";
    const [pingStatus, setPingStatus] = useState(null); // null | "ok" | "error" | "checking"

    async function handlePing() {
        setPingStatus("checking");
        try {
            const res = await fetch(`${serverUrl}/api/health`, { signal: AbortSignal.timeout(4000) });
            setPingStatus(res.ok ? "ok" : "error");
        } catch {
            setPingStatus("error");
        }
        setTimeout(() => setPingStatus(null), 3000);
    }

    return (
        <div className="space-y-5">
            <Card>
                <Row label="Direct play" desc="Stream files directly without server-side transcoding">
                    <Toggle value={prefs.directPlay ?? true} onChange={(v) => setPref("directPlay", v)} />
                </Row>
                <Row label="Prefer HLS" desc="Use adaptive HLS streaming when available (requires FFmpeg)">
                    <Toggle value={prefs.preferHLS ?? false} onChange={(v) => setPref("preferHLS", v)} />
                </Row>
                <Row label="Buffer ahead" desc="Pre-buffer video segments for smoother playback">
                    <Toggle value={prefs.bufferAhead ?? true} onChange={(v) => setPref("bufferAhead", v)} />
                </Row>
            </Card>
        </div>
    );
}
