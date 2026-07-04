import { Card, Row, Toggle, Select, SectionLabel } from "./shared";

const SIZES = ["small", "medium", "large", "x-large"];
const COLORS = [
    { v: "#ffffff", l: "White" },
    { v: "#ffff00", l: "Yellow" },
    { v: "#00ff00", l: "Green" },
    { v: "#ff6b6b", l: "Red" },
    { v: "#87ceeb", l: "Sky Blue" },
];

export default function SubtitlesSection({ prefs, setPref }) {
    const cur = prefs.subColor ?? "#ffffff";
    return (
        <div className="space-y-5 w-full">
            <SectionLabel>Display</SectionLabel>
            <Card>
                <Row label="Show by default" desc="Enable subtitles automatically when video starts">
                    <Toggle value={prefs.subtitles ?? false} onChange={(v) => setPref("subtitles", v)} />
                </Row>
                <Row label="Font size" desc="Scale subtitle text size">
                    <Select id="sub-size" name="subSize" value={prefs.subSize ?? "medium"} onChange={(e) => setPref("subSize", e.target.value)}>
                        {SIZES.map((s) => (
                            <option key={s} value={s}>
                                {s.charAt(0).toUpperCase() + s.slice(1)}
                            </option>
                        ))}
                    </Select>
                </Row>
                <Row label="Text color" desc="Default subtitle text color">
                    <div className="flex items-center gap-1.5">
                        {COLORS.map((c) => (
                            <button
                                key={c.v}
                                onClick={() => setPref("subColor", c.v)}
                                title={c.l}
                                style={{ background: c.v, outline: "none", boxShadow: cur === c.v ? "0 0 0 2px var(--color-primary),0 0 0 4px oklch(from var(--color-primary) l c h / 0.25)" : "none" }}
                                className="w-5 h-5 rounded-full border border-white/20 cursor-pointer transition-all shrink-0"
                            />
                        ))}
                    </div>
                </Row>
                <Row label="Background" desc="Dark backdrop behind subtitle text">
                    <Toggle value={prefs.subBg ?? false} onChange={(v) => setPref("subBg", v)} />
                </Row>
                <Row label="Bold text" desc="Use bold font weight">
                    <Toggle value={prefs.subBold ?? false} onChange={(v) => setPref("subBold", v)} />
                </Row>
            </Card>
        </div>
    );
}
