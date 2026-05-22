import { useEffect, useState, useMemo } from "react";
import { usePlayerState } from "./UsePlayerState";

// ─── SRT Parser ─────────────────────────────────────────────────────────────

function parseSRT(raw) {
    const cues = [];
    const blocks = raw.trim().split(/\n\s*\n/);
    for (const block of blocks) {
        const lines = block.trim().split("\n");
        if (lines.length < 3) continue;
        // Find the timing line
        const timingIdx = lines.findIndex((l) => l.includes("-->"));
        if (timingIdx < 0) continue;
        const [startStr, endStr] = lines[timingIdx].split("-->").map((s) => s.trim());
        const start = srtTimeToSeconds(startStr);
        const end = srtTimeToSeconds(endStr);
        const text = lines
            .slice(timingIdx + 1)
            .join("\n")
            .replace(/<[^>]+>/g, "");
        cues.push({ start, end, text });
    }
    return cues;
}

function srtTimeToSeconds(str) {
    // 00:01:23,456 or 00:01:23.456
    const clean = str.replace(",", ".");
    const parts = clean.split(":");
    if (parts.length !== 3) return 0;
    const [h, m, s] = parts;
    return parseInt(h) * 3600 + parseInt(m) * 60 + parseFloat(s);
}

// ─── VTT Parser ─────────────────────────────────────────────────────────────

function parseVTT(raw) {
    const cues = [];
    // Strip WEBVTT header
    const body = raw.replace(/^WEBVTT.*\n/, "").trim();
    const blocks = body.split(/\n\s*\n/);
    for (const block of blocks) {
        const lines = block.trim().split("\n");
        const timingIdx = lines.findIndex((l) => l.includes("-->"));
        if (timingIdx < 0) continue;
        const [startStr, endStr] = lines[timingIdx].split("-->").map((s) => s.trim().split(" ")[0]);
        const start = vttTimeToSeconds(startStr);
        const end = vttTimeToSeconds(endStr);
        const text = lines
            .slice(timingIdx + 1)
            .join("\n")
            .replace(/<[^>]+>/g, "");
        cues.push({ start, end, text });
    }
    return cues;
}

function vttTimeToSeconds(str) {
    // HH:MM:SS.mmm or MM:SS.mmm
    const parts = str.split(":");
    if (parts.length === 3) {
        return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
    }
    if (parts.length === 2) {
        return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
    }
    return parseFloat(str) || 0;
}

// ─── SubtitleRenderer ────────────────────────────────────────────────────────

export default function SubtitleRenderer() {
    const { state } = usePlayerState();
    const { activeSubtitle, subtitleDelay, subtitleFontSize, currentTime, controlsVisible } = state;

    const [cues, setCues] = useState([]);
    const [loading, setLoading] = useState(false);

    // Fetch and parse subtitle file whenever activeSubtitle changes
    useEffect(() => {
        if (!activeSubtitle?.url) {
            setCues([]);
            return;
        }
        let cancelled = false;
        setLoading(true);
        fetch(activeSubtitle.url)
            .then((r) => r.text())
            .then((raw) => {
                if (cancelled) return;
                const isVTT = activeSubtitle.ext === ".vtt" || raw.trimStart().startsWith("WEBVTT");
                const parsed = isVTT ? parseVTT(raw) : parseSRT(raw);
                setCues(parsed);
                setLoading(false);
            })
            .catch(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [activeSubtitle]);

    // Find the cue to display at current time (accounting for delay)
    const activeCue = useMemo(() => {
        if (!cues.length) return null;
        const adjustedTime = currentTime - subtitleDelay / 1000;
        return cues.find((c) => adjustedTime >= c.start && adjustedTime < c.end) || null;
    }, [cues, currentTime, subtitleDelay]);

    if (!activeSubtitle || !activeCue) return null;

    // Move subtitles up when controls are visible
    const bottomOffset = controlsVisible ? "5rem" : "2rem";

    return (
        <div className="absolute left-0 right-0 z-30 flex justify-center pointer-events-none px-4" style={{ bottom: bottomOffset, transition: "bottom 0.3s ease" }}>
            <div
                className="max-w-[85%] text-center px-3 py-1.5 rounded-lg"
                style={{
                    background: "rgba(0,0,0,0.65)",
                    fontSize: `${subtitleFontSize}px`,
                    lineHeight: 1.4,
                    color: "#fff",
                    textShadow: "0 1px 3px rgba(0,0,0,0.9)",
                    whiteSpace: "pre-wrap",
                }}>
                {activeCue.text}
            </div>
        </div>
    );
}
