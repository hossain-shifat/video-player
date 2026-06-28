import { Card, Row, Toggle } from "./shared";

const SIZES = ["small", "medium", "large", "x-large"];

const COLORS = [
    { value: "#ffffff", label: "White" },
    { value: "#ffff00", label: "Yellow" },
    { value: "#00ff00", label: "Green" },
    { value: "#ff6b6b", label: "Red" },
    { value: "#87ceeb", label: "Sky Blue" },
];

export default function SubtitlesSection({ prefs, setPref }) {
    return (
        <div className="space-y-5">
            <Card>
                <Row
                    label="Show subtitles by default"
                    desc="Automatically enable subtitles when a video starts">
                    <Toggle value={prefs.subtitles ?? false} onChange={(v) => setPref("subtitles", v)} />
                </Row>

                <Row
                    label="Subtitle font size"
                    desc="Scale the size of subtitle text">
                    <label htmlFor="subtitle-size" className="sr-only">Subtitle font size</label>
                    <select
                        id="subtitle-size"
                        name="subSize"
                        value={prefs.subSize ?? "medium"}
                        onChange={(e) => setPref("subSize", e.target.value)}
                        className="select select-sm bg-white/[0.07] border border-white/10 rounded-lg text-sm text-white focus:outline-none"
                        style={{ outline: "none" }}>
                        {SIZES.map((s) => (
                            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                        ))}
                    </select>
                </Row>

                <Row
                    label="Subtitle text color"
                    desc="Default color for subtitle text">
                    <div className="flex items-center gap-2">
                        {COLORS.map((c) => (
                            <button
                                key={c.value}
                                onClick={() => setPref("subColor", c.value)}
                                title={c.label}
                                style={{
                                    background: c.value,
                                    outline: "none",
                                    boxShadow: (prefs.subColor ?? "#ffffff") === c.value
                                        ? `0 0 0 2px var(--color-primary), 0 0 0 4px oklch(from var(--color-primary) l c h / 0.3)`
                                        : "none",
                                }}
                                className="w-6 h-6 rounded-full border border-white/20 cursor-pointer transition-all shrink-0"
                            />
                        ))}
                    </div>
                </Row>

                <Row
                    label="Subtitle background"
                    desc="Add a dark backdrop behind text for readability">
                    <Toggle value={prefs.subBg ?? false} onChange={(v) => setPref("subBg", v)} />
                </Row>

                <Row
                    label="Bold subtitles"
                    desc="Use bold font weight for subtitle text">
                    <Toggle value={prefs.subBold ?? false} onChange={(v) => setPref("subBold", v)} />
                </Row>
            </Card>
        </div>
    );
}
