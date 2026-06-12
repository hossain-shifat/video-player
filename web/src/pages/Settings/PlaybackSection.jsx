import { Card, Row, SectionTitle, Toggle } from "./shared";

const SPEEDS = ["0.5", "0.75", "1.0", "1.25", "1.5", "1.75", "2.0"];

export default function PlaybackSection({ prefs, setPref }) {
    return (
        <div className="space-y-5">

            <Card>
                <Row label="Auto-play next episode" desc="Automatically continue to the next episode in a series">
                    <Toggle value={prefs.autoplay ?? true} onChange={(v) => setPref("autoplay", v)} />
                </Row>
                <Row label="Resume playback" desc="Continue from where you left off">
                    <Toggle value={prefs.resume ?? true} onChange={(v) => setPref("resume", v)} />
                </Row>
                <Row label="Remember volume" desc="Restore volume level between sessions">
                    <Toggle value={prefs.rememberVolume ?? true} onChange={(v) => setPref("rememberVolume", v)} />
                </Row>
                <Row label="Default playback speed" desc="Speed applied automatically when a video starts">
                    <label htmlFor="playback-speed" className="sr-only">Default playback speed</label>
                    <select
                        id="playback-speed"
                        name="speed"
                        value={prefs.speed ?? "1.0"}
                        onChange={(e) => setPref("speed", e.target.value)}
                        className="select select-sm bg-base-300 border-white/10 rounded text-sm min-w-20">
                        {SPEEDS.map((s) => (
                            <option key={s} value={s}>{s}×</option>
                        ))}
                    </select>
                </Row>
            </Card>
        </div>
    );
}
