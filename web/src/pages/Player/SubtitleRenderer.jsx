import { useEffect, useState, useMemo } from "react";
import { usePlayerState } from "./UsePlayerState";

// ─── SRT parser ──────────────────────────────────────────────────────────────

function parseSRT(raw) {
    const cues = [];
    const blocks = raw.trim().split(/\n\s*\n/);
    for (const block of blocks) {
        const lines = block.trim().split("\n");
        if (lines.length < 2) continue;
        const timingIdx = lines.findIndex((l) => l.includes("-->"));
        if (timingIdx < 0) continue;
        const [startStr, endStr] = lines[timingIdx].split("-->").map((s) => s.trim());
        const start = srtTime(startStr);
        const end = srtTime(endStr);
        // Strip HTML tags but keep line breaks
        const text = lines
            .slice(timingIdx + 1)
            .join("\n")
            .replace(/<[^>]+>/g, "")
            .trim();
        if (text) cues.push({ start, end, text });
    }
    return cues;
}

function srtTime(str) {
    const clean = str.replace(",", ".").trim();
    const parts = clean.split(":");
    if (parts.length !== 3) return 0;
    return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
}

// ─── VTT parser ──────────────────────────────────────────────────────────────

function parseVTT(raw) {
    const cues = [];
    const body = raw.replace(/^WEBVTT[^\n]*\n/, "").trim();
    const blocks = body.split(/\n\s*\n/);
    for (const block of blocks) {
        const lines = block.trim().split("\n");
        const timingIdx = lines.findIndex((l) => l.includes("-->"));
        if (timingIdx < 0) continue;
        // Strip optional position cue settings (everything after first space)
        const [startStr, endStr] = lines[timingIdx].split("-->").map((s) => s.trim().split(/\s/)[0]);
        const start = vttTime(startStr);
        const end = vttTime(endStr);
        const text = lines
            .slice(timingIdx + 1)
            .join("\n")
            .replace(/<[^>]+>/g, "")
            .trim();
        if (text) cues.push({ start, end, text });
    }
    return cues;
}

function vttTime(str) {
    const parts = str.split(":");
    if (parts.length === 3) return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
    if (parts.length === 2) return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
    return parseFloat(str) || 0;
}

// ─── SubtitleRenderer ─────────────────────────────────────────────────────────

export default function SubtitleRenderer() {
    const { state } = usePlayerState();
    const { activeSubtitle, subtitleDelay, subtitleFontSize, currentTime, controlsVisible } = state;

    const [cues, setCues] = useState([]);

    // Fetch + parse subtitle file on track change
    useEffect(() => {
        if (!activeSubtitle?.url) {
            setCues([]);
            return;
        }
        let cancelled = false;
        fetch(activeSubtitle.url)
            .then((r) => {
                if (!r.ok) throw new Error(`Subtitle fetch failed: ${r.status}`);
                return r.text();
            })
            .then((raw) => {
                if (cancelled) return;
                const isVTT = activeSubtitle.ext === ".vtt" || activeSubtitle.url?.endsWith(".vtt") || raw.trimStart().startsWith("WEBVTT");
                setCues(isVTT ? parseVTT(raw) : parseSRT(raw));
            })
            .catch(() => {
                if (!cancelled) setCues([]);
            });
        return () => {
            cancelled = true;
        };
    }, [activeSubtitle]);

    // Find active cue (accounting for delay in ms)
    const activeCue = useMemo(() => {
        if (!cues.length) return null;
        const t = currentTime - subtitleDelay / 1000;
        return cues.find((c) => t >= c.start && t < c.end) || null;
    }, [cues, currentTime, subtitleDelay]);

    if (!activeSubtitle || !activeCue) return null;

    // Raise subtitles above controls when visible
    // Matches Jellyfin's approach: shift up when controls shown
    const bottomOffset = controlsVisible ? "6.5rem" : "2rem";

    return (
        <div className="absolute left-0 right-0 z-30 flex justify-center pointer-events-none px-4" style={{ bottom: bottomOffset, transition: "bottom 0.25s ease" }}>
            <div
                className="max-w-[90%] sm:max-w-[75%] text-center px-3 py-1.5 rounded-lg"
                style={{
                    background: "rgba(0,0,0,0.68)",
                    fontSize: `${subtitleFontSize}px`,
                    lineHeight: 1.45,
                    color: "#fff",
                    textShadow: "0 1px 4px rgba(0,0,0,0.95)",
                    whiteSpace: "pre-line", // preserve soft line breaks in SRT
                    wordBreak: "break-word",
                }}>
                {activeCue.text}
            </div>
        </div>
    );
}
