import { RotateCcw } from "lucide-react";
import { Card, Row, Toggle, Seg, Select, SectionLabel, GhostButton } from "./shared";

const SPEEDS = ["0.5", "0.75", "1.0", "1.25", "1.5", "1.75", "2.0"];

const COUNTDOWN = [
    { id: "0", label: "Instant" },
    { id: "5", label: "5 s" },
    { id: "10", label: "10 s" },
];
const SEEK_STEPS = ["5", "10", "15", "30"].map((s) => ({ id: s, label: `${s} s` }));
const HIDE_AFTER = [
    { id: "3", label: "3 s" },
    { id: "5", label: "5 s" },
    { id: "8", label: "8 s" },
    { id: "0", label: "Never" },
];

const AUDIO_LANGS = [
    ["auto", "Original audio"],
    ["en", "English"],
    ["bn", "Bengali"],
    ["hi", "Hindi"],
    ["ja", "Japanese"],
    ["ko", "Korean"],
    ["es", "Spanish"],
    ["fr", "French"],
];

// Read in the player with loadPrefs() from ./shared — keys + defaults:
const KEYS = [
    "autoplay",
    "nextDelay",
    "resume",
    "skipIntro",
    "rememberVolume",
    "gestureSeek",
    "gestureVolume",
    "gestureBrightness",
    "doubleTap",
    "seekStep",
    "controlsHide",
    "prefAudio",
    "rememberAudio",
    "speed",
];

export default function PlaybackSection({ prefs, setPref }) {
    const autoplay = prefs.autoplay ?? true;

    return (
        <div className="w-full space-y-6">
            <div>
                <SectionLabel hint="What the player does on its own.">Behaviour</SectionLabel>
                <Card>
                    <Row id="p-autoplay" label="Auto-play next episode" desc="Continue to the next episode when one ends">
                        <Toggle label="Auto-play next episode" value={autoplay} onChange={(v) => setPref("autoplay", v)} />
                    </Row>
                    <Row id="p-countdown" stack label="Next episode countdown" desc="How long to wait before the next episode starts">
                        <Seg opts={COUNTDOWN} value={prefs.nextDelay ?? "5"} onChange={(v) => setPref("nextDelay", v)} disabled={!autoplay} />
                    </Row>
                    <Row id="p-resume" label="Resume playback" desc="Pick up where you left off">
                        <Toggle label="Resume playback" value={prefs.resume ?? true} onChange={(v) => setPref("resume", v)} />
                    </Row>
                    <Row id="p-skip" label="Skip intro" desc="Jump past detected intro sequences">
                        <Toggle label="Skip intro" value={prefs.skipIntro ?? false} onChange={(v) => setPref("skipIntro", v)} />
                    </Row>
                    <Row id="p-volume" label="Remember volume" desc="Keep your volume level between sessions">
                        <Toggle label="Remember volume" value={prefs.rememberVolume ?? true} onChange={(v) => setPref("rememberVolume", v)} />
                    </Row>
                </Card>
            </div>

            <div>
                <SectionLabel hint="Touch and mouse gestures inside the player.">Controls and gestures</SectionLabel>
                <Card>
                    <Row id="p-seek-gesture" label="Swipe to seek" desc="Drag left or right across the video to jump in time">
                        <Toggle label="Swipe to seek" value={prefs.gestureSeek ?? true} onChange={(v) => setPref("gestureSeek", v)} />
                    </Row>
                    <Row id="p-vol-gesture" label="Swipe for volume" desc="Drag up or down on the right side">
                        <Toggle label="Swipe for volume" value={prefs.gestureVolume ?? true} onChange={(v) => setPref("gestureVolume", v)} />
                    </Row>
                    <Row id="p-bright-gesture" label="Swipe for brightness" desc="Drag up or down on the left side">
                        <Toggle label="Swipe for brightness" value={prefs.gestureBrightness ?? true} onChange={(v) => setPref("gestureBrightness", v)} />
                    </Row>
                    <Row id="p-doubletap" label="Double-tap to seek" desc="Double-tap the left or right edge to skip back or forward">
                        <Toggle label="Double-tap to seek" value={prefs.doubleTap ?? true} onChange={(v) => setPref("doubleTap", v)} />
                    </Row>
                    <Row id="p-seekstep" stack label="Seek step" desc="Seconds skipped by double-tap and arrow keys">
                        <Seg opts={SEEK_STEPS} value={prefs.seekStep ?? "10"} onChange={(v) => setPref("seekStep", v)} />
                    </Row>
                    <Row id="p-hide" stack label="Hide controls after" desc="Idle time before the on-screen controls fade out">
                        <Seg opts={HIDE_AFTER} value={prefs.controlsHide ?? "5"} onChange={(v) => setPref("controlsHide", v)} />
                    </Row>
                </Card>
            </div>

            <div>
                <SectionLabel hint="Used when a file has more than one audio track.">Audio</SectionLabel>
                <Card>
                    <Row id="p-audio" stack label="Preferred audio language" desc="Picked automatically when available">
                        <Select id="pref-audio" name="prefAudio" value={prefs.prefAudio ?? "auto"} onChange={(e) => setPref("prefAudio", e.target.value)} className="w-full">
                            {AUDIO_LANGS.map(([v, l]) => (
                                <option key={v} value={v}>
                                    {l}
                                </option>
                            ))}
                        </Select>
                    </Row>
                    <Row label="Remember audio track" desc="Reuse your last audio choice for the same series">
                        <Toggle label="Remember audio track" value={prefs.rememberAudio ?? true} onChange={(v) => setPref("rememberAudio", v)} />
                    </Row>
                </Card>
            </div>

            <div id="p-speed" className="scroll-mt-28">
                <SectionLabel hint="Applied each time a video starts. You can still change speed in the player.">Default speed</SectionLabel>
                <Card className="p-3 sm:p-4">
                    <Seg opts={SPEEDS.map((s) => ({ id: s, label: `${s}×` }))} value={prefs.speed ?? "1.0"} onChange={(v) => setPref("speed", v)} />
                </Card>
            </div>

            <div className="flex justify-end">
                <GhostButton onClick={() => KEYS.forEach((k) => setPref(k, undefined))}>
                    <RotateCcw size={13} /> Reset playback settings
                </GhostButton>
            </div>
        </div>
    );
}
