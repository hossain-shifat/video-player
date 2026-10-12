import { RotateCcw } from "lucide-react";
import { Card, Row, Toggle, Select, Slider, SectionLabel, GhostButton } from "./shared";

const SIZES = ["small", "medium", "large", "x-large"];
const SIZE_PX = { small: 15, medium: 19, large: 24, "x-large": 30 };
const COLORS = [
    { v: "#ffffff", l: "White" },
    { v: "#ffff00", l: "Yellow" },
    { v: "#00ff00", l: "Green" },
    { v: "#ff6b6b", l: "Red" },
    { v: "#87ceeb", l: "Sky blue" },
];
const LANGS = [
    ["auto", "Match audio language"],
    ["en", "English"],
    ["bn", "Bengali"],
    ["hi", "Hindi"],
    ["ja", "Japanese"],
    ["ko", "Korean"],
    ["es", "Spanish"],
    ["fr", "French"],
];

// Read in the player with loadPrefs() from ./shared
const KEYS = ["subtitles", "subLang", "subSize", "subColor", "subBg", "subBgOpacity", "subBold", "subPosition"];

export default function SubtitlesSection({ prefs, setPref }) {
    const cur = prefs.subColor ?? "#ffffff";
    const size = prefs.subSize ?? "medium";
    const bg = prefs.subBg ?? false;
    const bold = prefs.subBold ?? false;
    const opacity = prefs.subBgOpacity ?? 0.7;
    const position = prefs.subPosition ?? 8;

    return (
        <div className="w-full space-y-6">
            {/* Live preview — always dark, like a video frame */}
            <div>
                <SectionLabel hint="Changes below show here instantly.">Preview</SectionLabel>
                <div
                    className="relative flex aspect-video max-h-80 w-full items-end justify-center overflow-hidden rounded-md border border-base-content/10 px-6"
                    style={{ background: "linear-gradient(180deg, #1b1f2a 0%, #0b0d12 70%)", paddingBottom: `${position}%` }}>
                    <span className="absolute left-3 top-3 rounded-md bg-black/50 px-2 py-0.5 text-xs text-white/70">{prefs.subtitles ? "Subtitles on by default" : "Subtitles off by default"}</span>
                    <p
                        className="max-w-[90%] text-center leading-snug"
                        style={{
                            color: cur,
                            fontSize: SIZE_PX[size],
                            fontWeight: bold ? 700 : 400,
                            background: bg ? `rgba(0,0,0,${opacity})` : "transparent",
                            padding: bg ? "2px 10px" : 0,
                            borderRadius: 4,
                            textShadow: bg ? "none" : "0 1px 3px rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.7)",
                        }}>
                        Some stories are worth the long way home.
                    </p>
                </div>
            </div>

            <div>
                <SectionLabel>Defaults</SectionLabel>
                <Card>
                    <Row id="s-default" label="Show by default" desc="Turn subtitles on when a video starts">
                        <Toggle label="Show by default" value={prefs.subtitles ?? false} onChange={(v) => setPref("subtitles", v)} />
                    </Row>
                    <Row id="s-lang" stack label="Preferred language" desc="Chosen automatically when a matching track exists">
                        <Select id="sub-lang" name="subLang" value={prefs.subLang ?? "auto"} onChange={(e) => setPref("subLang", e.target.value)} className="w-full">
                            {LANGS.map(([v, l]) => (
                                <option key={v} value={v}>
                                    {l}
                                </option>
                            ))}
                        </Select>
                    </Row>
                </Card>
            </div>

            <div>
                <SectionLabel>Style</SectionLabel>
                <Card>
                    <Row id="s-size" stack label="Font size" desc="Size of subtitle text">
                        <Select id="sub-size" name="subSize" value={size} onChange={(e) => setPref("subSize", e.target.value)} className="w-full">
                            {SIZES.map((s) => (
                                <option key={s} value={s}>
                                    {s.charAt(0).toUpperCase() + s.slice(1)}
                                </option>
                            ))}
                        </Select>
                    </Row>
                    <Row id="s-color" stack label="Text colour" desc="Colour captions are drawn in">
                        <div className="flex flex-wrap items-center gap-2.5 sm:justify-end" role="radiogroup" aria-label="Text colour">
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
                                    className={`size-7 shrink-0 cursor-pointer rounded-md border border-base-content/30 transition-shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary
                                        ${cur === c.v ? "ring-2 ring-primary ring-offset-2 ring-offset-base-200" : ""}`}
                                />
                            ))}
                        </div>
                    </Row>
                    <Row id="s-bold" label="Bold text" desc="Use a heavier font weight">
                        <Toggle label="Bold text" value={bold} onChange={(v) => setPref("subBold", v)} />
                    </Row>
                    <Row id="s-bg" label="Background" desc="Dark box behind the text for easier reading">
                        <Toggle label="Background" value={bg} onChange={(v) => setPref("subBg", v)} />
                    </Row>
                    <Row id="s-opacity" stack label="Background opacity" desc="Only applies when the background is on">
                        <Slider label="Background opacity" value={opacity} onChange={(v) => setPref("subBgOpacity", Math.round(v * 100) / 100)} min={0.2} max={1} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} disabled={!bg} />
                    </Row>
                    <Row id="s-position" stack label="Position" desc="Distance from the bottom of the video">
                        <Slider label="Subtitle position" value={position} onChange={(v) => setPref("subPosition", v)} min={4} max={30} step={1} fmt={(v) => `${v}%`} />
                    </Row>
                </Card>
            </div>

            <div className="flex justify-end">
                <GhostButton onClick={() => KEYS.forEach((k) => setPref(k, undefined))}>
                    <RotateCcw size={13} /> Reset subtitle settings
                </GhostButton>
            </div>
        </div>
    );
}
