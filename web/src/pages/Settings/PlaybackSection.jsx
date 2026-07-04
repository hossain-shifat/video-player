import { Card, Row, Toggle, Select, SectionLabel } from "./shared";

const SPEEDS = ["0.5", "0.75", "1.0", "1.25", "1.5", "1.75", "2.0"];

export default function PlaybackSection({ prefs, setPref }) {
    return (
        <div className="space-y-5 w-full">
            <SectionLabel>Behaviour</SectionLabel>
            <Card>
                <Row label="Auto-play next episode" desc="Automatically continue to the next episode in a series">
                    <Toggle value={prefs.autoplay ?? true} onChange={(v) => setPref("autoplay", v)} />
                </Row>
                <Row label="Resume playback" desc="Continue from where you left off">
                    <Toggle value={prefs.resume ?? true} onChange={(v) => setPref("resume", v)} />
                </Row>
                <Row label="Skip intro" desc="Auto-skip detected intro sequences">
                    <Toggle value={prefs.skipIntro ?? false} onChange={(v) => setPref("skipIntro", v)} />
                </Row>
                <Row label="Remember volume" desc="Restore volume level between sessions">
                    <Toggle value={prefs.rememberVolume ?? true} onChange={(v) => setPref("rememberVolume", v)} />
                </Row>
            </Card>

            <SectionLabel>Defaults</SectionLabel>
            <Card>
                <Row label="Default speed" desc="Playback speed applied when a video starts">
                    <Select id="speed" name="speed" value={prefs.speed ?? "1.0"} onChange={(e) => setPref("speed", e.target.value)}>
                        {SPEEDS.map((s) => (
                            <option key={s} value={s}>
                                {s}×
                            </option>
                        ))}
                    </Select>
                </Row>
            </Card>
        </div>
    );
}
