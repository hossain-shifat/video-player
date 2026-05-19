import { Card, Row, SectionTitle, Toggle } from "./shared";

const SIZES = ["small", "medium", "large", "x-large"];

export default function SubtitlesSection({ prefs, setPref }) {
    return (
        <div className="space-y-5">

            <Card>
                <Row label="Show subtitles by default" desc="Automatically enable subtitles when a video starts">
                    <Toggle value={prefs.subtitles ?? false} onChange={(v) => setPref("subtitles", v)} />
                </Row>
                <Row label="Subtitle font size" desc="Scale the size of subtitle text">
                    <select
                        value={prefs.subSize ?? "medium"}
                        onChange={(e) => setPref("subSize", e.target.value)}
                        className="select select-sm bg-base-300 border-white/10 rounded text-sm">
                        {SIZES.map((s) => (
                            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                        ))}
                    </select>
                </Row>
                <Row label="Subtitle background" desc="Add a dark background behind text for readability">
                    <Toggle value={prefs.subBg ?? false} onChange={(v) => setPref("subBg", v)} />
                </Row>
            </Card>
        </div>
    );
}
