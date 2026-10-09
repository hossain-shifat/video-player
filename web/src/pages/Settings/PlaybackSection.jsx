import { Card, Row, Toggle, Seg, SectionLabel } from "./shared";

const SPEEDS = ["0.5", "0.75", "1.0", "1.25", "1.5", "1.75", "2.0"];

export default function PlaybackSection({ prefs, setPref }) {
    return (
        <div className="space-y-6 w-full">
            <div>
                <SectionLabel hint="What the player does on its own.">Behaviour</SectionLabel>
                <Card>
                    <Row label="Auto-play next episode" desc="Continue to the next episode when one ends">
                        <Toggle label="Auto-play next episode" value={prefs.autoplay ?? true} onChange={(v) => setPref("autoplay", v)} />
                    </Row>
                    <Row label="Resume playback" desc="Pick up where you left off">
                        <Toggle label="Resume playback" value={prefs.resume ?? true} onChange={(v) => setPref("resume", v)} />
                    </Row>
                    <Row label="Skip intro" desc="Jump past detected intro sequences">
                        <Toggle label="Skip intro" value={prefs.skipIntro ?? false} onChange={(v) => setPref("skipIntro", v)} />
                    </Row>
                    <Row label="Remember volume" desc="Keep your volume level between sessions">
                        <Toggle label="Remember volume" value={prefs.rememberVolume ?? true} onChange={(v) => setPref("rememberVolume", v)} />
                    </Row>
                </Card>
            </div>

            <div>
                <SectionLabel hint="Applied each time a video starts. You can still change speed in the player.">Default speed</SectionLabel>
                <Card className="p-3 sm:p-4">
                    <Seg opts={SPEEDS.map((s) => ({ id: s, label: `${s}×` }))} value={prefs.speed ?? "1.0"} onChange={(v) => setPref("speed", v)} />
                </Card>
            </div>
        </div>
    );
}
