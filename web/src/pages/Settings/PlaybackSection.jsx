import { Card, Row, Toggle } from "./shared";

const SPEEDS = ["0.5", "0.75", "1.0", "1.25", "1.5", "1.75", "2.0"];

export default function PlaybackSection({ prefs, setPref }) {
    return (
        <div className="space-y-5">
            <Card>
                <Row
                    label="Auto-play next episode"
                    desc="Automatically continue to the next episode in a series">
                    <Toggle value={prefs.autoplay ?? true} onChange={(v) => setPref("autoplay", v)} />
                </Row>
                <Row
                    label="Resume playback"
                    desc="Continue from where you left off">
                    <Toggle value={prefs.resume ?? true} onChange={(v) => setPref("resume", v)} />
                </Row>
                <Row
                    label="Remember volume"
                    desc="Restore volume level between sessions">
                    <Toggle value={prefs.rememberVolume ?? true} onChange={(v) => setPref("rememberVolume", v)} />
                </Row>
                <Row
                    label="Skip intro"
                    desc="Automatically skip detected intro sequences">
                    <Toggle value={prefs.skipIntro ?? false} onChange={(v) => setPref("skipIntro", v)} />
                </Row>
                <Row
                    label="Default playback speed"
                    desc="Speed applied automatically when a video starts">
                    <label htmlFor="playback-speed" className="sr-only">Default playback speed</label>
                    <select
                        id="playback-speed"
                        name="speed"
                        value={prefs.speed ?? "1.0"}
                        onChange={(e) => setPref("speed", e.target.value)}
                        className="select select-sm bg-white/[0.07] border border-white/10 rounded-lg text-sm text-white min-w-[5.5rem] focus:outline-none"
                        style={{ outline: "none" }}>
                        {SPEEDS.map((s) => (
                            <option key={s} value={s}>{s}×</option>
                        ))}
                    </select>
                </Row>
            </Card>
        </div>
    );
}
