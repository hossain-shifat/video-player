import { Wifi } from "lucide-react";
import { Card, Row, SectionTitle, Toggle } from "./shared";

export default function ServerSection({ prefs, setPref }) {
    return (
        <div className="space-y-5">

            <Card>
                <Row label="Server URL" desc={import.meta.env.VITE_API_URL || "http://localhost:5000"}>
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success bg-success/10 px-2.5 py-1 rounded-full">
                        <Wifi size={10} /> Local
                    </span>
                </Row>
                <Row label="Direct play" desc="Stream files directly without server-side transcoding">
                    <Toggle value={prefs.directPlay ?? true} onChange={(v) => setPref("directPlay", v)} />
                </Row>
                <Row label="Prefer HLS" desc="Use adaptive HLS streaming when available (requires FFmpeg)">
                    <Toggle value={prefs.preferHLS ?? false} onChange={(v) => setPref("preferHLS", v)} />
                </Row>
            </Card>
        </div>
    );
}
