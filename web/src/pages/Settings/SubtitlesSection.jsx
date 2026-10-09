import { Card, Row, Toggle, Select, SectionLabel } from "./shared";

const SIZES = ["small", "medium", "large", "x-large"];
const SIZE_PX = { small: 15, medium: 19, large: 24, "x-large": 30 };
const COLORS = [
    { v: "#ffffff", l: "White" },
    { v: "#ffff00", l: "Yellow" },
    { v: "#00ff00", l: "Green" },
    { v: "#ff6b6b", l: "Red" },
    { v: "#87ceeb", l: "Sky blue" },
];

export default function SubtitlesSection({ prefs, setPref }) {
    const cur = prefs.subColor ?? "#ffffff";
    const size = prefs.subSize ?? "medium";
    const bg = prefs.subBg ?? false;
    const bold = prefs.subBold ?? false;

    return (
        <div className="space-y-6 w-full">
            {/* Live preview — always dark, like a video frame */}
            <div>
                <SectionLabel hint="Changes below show here instantly.">Preview</SectionLabel>
                <div
                    className="relative flex aspect-video max-h-72 w-full items-end justify-center overflow-hidden rounded-box border border-base-content/10 px-6 pb-[8%]"
                    style={{ background: "linear-gradient(180deg, #1b1f2a 0%, #0b0d12 70%)" }}>
                    <span className="absolute left-3 top-3 rounded-field bg-black/50 px-2 py-0.5 text-xs text-white/70">{prefs.subtitles ? "Subtitles on by default" : "Subtitles off by default"}</span>
                    <p
                        className="max-w-[90%] text-center leading-snug"
                        style={{
                            color: cur,
                            fontSize: SIZE_PX[size],
                            fontWeight: bold ? 700 : 400,
                            background: bg ? "rgba(0,0,0,0.7)" : "transparent",
                            padding: bg ? "2px 10px" : 0,
                            borderRadius: 4,
                            textShadow: bg ? "none" : "0 1px 3px rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.7)",
                        }}>
                        Some stories are worth the long way home.
                    </p>
                </div>
            </div>

            <div>
                <SectionLabel>Style</SectionLabel>
                <Card>
                    <Row label="Show by default" desc="Turn subtitles on when a video starts">
                        <Toggle label="Show by default" value={prefs.subtitles ?? false} onChange={(v) => setPref("subtitles", v)} />
                    </Row>
                    <Row label="Font size" desc="Size of subtitle text">
                        <Select id="sub-size" name="subSize" value={size} onChange={(e) => setPref("subSize", e.target.value)}>
                            {SIZES.map((s) => (
                                <option key={s} value={s}>
                                    {s.charAt(0).toUpperCase() + s.slice(1)}
                                </option>
                            ))}
                        </Select>
                    </Row>
                    <Row stack label="Text color" desc="Pick the colour captions are drawn in">
                        <div className="flex flex-wrap items-center gap-2 sm:justify-end" role="radiogroup" aria-label="Text color">
                            {COLORS.map((c) => (
                                <button
                                    key={c.v}
                                    type="button"
                                    role="radio"
                                    aria-checked={cur === c.v}
                                    aria-label={c.l}
                                    title={c.l}
                                    onClick={() => setPref("subColor", c.v)}
                                    style={{ background: c.v }}
                                    className={`size-6 shrink-0 rounded-full border border-base-content/30 cursor-pointer transition-shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary
                                        ${cur === c.v ? "ring-2 ring-primary ring-offset-2 ring-offset-base-200" : ""}`}
                                />
                            ))}
                        </div>
                    </Row>
                    <Row label="Background" desc="Dark box behind the text for easier reading">
                        <Toggle label="Background" value={bg} onChange={(v) => setPref("subBg", v)} />
                    </Row>
                    <Row label="Bold text" desc="Use a heavier font weight">
                        <Toggle label="Bold text" value={bold} onChange={(v) => setPref("subBold", v)} />
                    </Row>
                </Card>
            </div>
        </div>
    );
}
