import { useEffect, useState, useMemo, useRef } from "react";
import { usePlayerState } from "./UsePlayerState";

// Backend base URL — subtitle URLs from the API are relative paths like
// /stream/subtitle/embedded/... and must be absolutified before fetch.
// Without this, the browser hits the Vite dev server which returns index.html.
const BACKEND = import.meta.env.VITE_API_URL || "http://localhost:5000";

function absoluteUrl(url) {
    if (!url) return url;
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    return `${BACKEND}${url}`;
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

function srtTimeToSeconds(str) {
    const clean = str.trim().replace(",", ".");
    const parts = clean.split(":");
    if (parts.length !== 3) return 0;
    const [h, m, s] = parts;
    return parseInt(h) * 3600 + parseInt(m) * 60 + parseFloat(s);
}

function vttTimeToSeconds(str) {
    const parts = str.trim().split(":");
    if (parts.length === 3) return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
    if (parts.length === 2) return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
    return parseFloat(str) || 0;
}

function assTimeToSeconds(str) {
    // H:MM:SS.cs (centiseconds)
    const parts = str.trim().split(":");
    if (parts.length !== 3) return 0;
    return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
}

function stripHtmlTags(str) {
    return str.replace(/<[^>]+>/g, "");
}

// Strip ASS/SSA override tags: {\an8}, {\b1}, etc.
function stripAssTags(str) {
    return str.replace(/\{[^}]*\}/g, "").replace(/\\N/g, "\n");
}

function parseSRT(raw) {
    const cues = [];
    const blocks = raw.trim().split(/\n\s*\n/);
    for (const block of blocks) {
        const lines = block.trim().split("\n");
        if (lines.length < 2) continue;
        const timingIdx = lines.findIndex((l) => l.includes("-->"));
        if (timingIdx < 0) continue;
        const [startStr, endStr] = lines[timingIdx].split("-->").map((s) => s.trim());
        const start = srtTimeToSeconds(startStr);
        const end = srtTimeToSeconds(endStr);
        const text = stripHtmlTags(
            lines
                .slice(timingIdx + 1)
                .join("\n")
                .trim(),
        );
        if (text) cues.push({ start, end, text });
    }
    return cues;
}

function parseVTT(raw) {
    const cues = [];
    const body = raw.replace(/^WEBVTT[^\n]*\n/, "").trim();
    const blocks = body.split(/\n\s*\n/);
    for (const block of blocks) {
        const lines = block.trim().split("\n");
        const timingIdx = lines.findIndex((l) => l.includes("-->"));
        if (timingIdx < 0) continue;
        const [startStr, endStr] = lines[timingIdx].split("-->").map((s) => s.trim().split(" ")[0]);
        const start = vttTimeToSeconds(startStr);
        const end = vttTimeToSeconds(endStr);
        const text = stripHtmlTags(
            lines
                .slice(timingIdx + 1)
                .join("\n")
                .trim(),
        );
        if (text) cues.push({ start, end, text });
    }
    return cues;
}

function parseASS(raw) {
    const cues = [];
    const lines = raw.split("\n");
    let inEvents = false;
    let formatOrder = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.toLowerCase() === "[events]") {
            inEvents = true;
            continue;
        }
        if (trimmed.startsWith("[") && inEvents) {
            inEvents = false;
            continue;
        }
        if (!inEvents) continue;

        if (trimmed.toLowerCase().startsWith("format:")) {
            formatOrder = trimmed
                .replace(/^format:\s*/i, "")
                .split(",")
                .map((s) => s.trim().toLowerCase());
            continue;
        }

        if (trimmed.toLowerCase().startsWith("dialogue:")) {
            const data = trimmed.replace(/^dialogue:\s*/i, "");
            // Split by comma, but only up to formatOrder.length (text can contain commas)
            const parts = data.split(",");
            if (parts.length < formatOrder.length) continue;

            // Rejoin text with commas beyond the format fields
            const fields = parts.slice(0, formatOrder.length - 1);
            const textPart = parts.slice(formatOrder.length - 1).join(",");

            const get = (name) => {
                const idx = formatOrder.indexOf(name);
                return idx >= 0 ? (fields[idx] || "").trim() : "";
            };

            const startStr = get("start");
            const endStr = get("end");
            const text = stripAssTags(textPart.trim());

            if (!startStr || !endStr || !text) continue;

            const start = assTimeToSeconds(startStr);
            const end = assTimeToSeconds(endStr);
            if (text) cues.push({ start, end, text });
        }
    }
    return cues.sort((a, b) => a.start - b.start);
}

function detectFormat(raw, ext) {
    if (ext === ".vtt") return "vtt";
    if (ext === ".ass" || ext === ".ssa") return "ass";
    if (ext === ".srt") return "srt";
    const trimmed = raw.trimStart();
    if (trimmed.startsWith("WEBVTT")) return "vtt";
    if (trimmed.includes("[Script Info]") || trimmed.includes("[Events]")) return "ass";
    return "srt";
}

function parseCues(raw, ext) {
    const fmt = detectFormat(raw, ext);
    if (fmt === "vtt") return parseVTT(raw);
    if (fmt === "ass") return parseASS(raw);
    return parseSRT(raw);
}

// ─── SubtitleRenderer ─────────────────────────────────────────────────────────

export default function SubtitleRenderer() {
    const { state } = usePlayerState();
    const { activeSubtitle, subtitleDelay, subtitleFontSize, subtitleColor = "#ffffff", subtitleBgOpacity = 0.72, currentTime, controlsVisible } = state;

    const [cues, setCues] = useState([]);
    const [loading, setLoading] = useState(false);
    const abortRef = useRef(null);

    // Fetch + parse on subtitle change
    useEffect(() => {
        if (!activeSubtitle?.url) {
            setCues([]);
            return;
        }

        // Cancel previous fetch
        abortRef.current?.abort();
        const ctrl = new AbortController();
        abortRef.current = ctrl;

        setLoading(true);
        fetch(absoluteUrl(activeSubtitle.url), { signal: ctrl.signal })
            .then((r) => r.text())
            .then((raw) => {
                // For embedded tracks the backend always returns WebVTT.
                // Force 'vtt' extension so parseCues uses parseVTT regardless
                // of missing .ext / .filename fields.
                let ext = activeSubtitle.ext || activeSubtitle.filename?.match(/\.\w+$/)?.[0] || "";

                if (!ext && activeSubtitle.source === "embedded") ext = ".vtt";
                if (!ext && raw.trimStart().startsWith("WEBVTT")) ext = ".vtt";

                setCues(parseCues(raw, ext.toLowerCase()));
                setLoading(false);
            })
            .catch((err) => {
                if (err.name !== "AbortError") setLoading(false);
            });

        return () => ctrl.abort();
    }, [activeSubtitle]);

    // Find active cue
    const activeCue = useMemo(() => {
        if (!cues.length) return null;
        const t = currentTime - (subtitleDelay || 0) / 1000;
        return cues.find((c) => t >= c.start && t < c.end) || null;
    }, [cues, currentTime, subtitleDelay]);

    if (!activeSubtitle || !activeCue) return null;

    // Shift up when controls visible
    const bottomOffset = controlsVisible ? "5.5rem" : "2rem";

    return (
        <div className="flux-subtitle-container" style={{ bottom: bottomOffset }}>
            <div
                className="flux-subtitle-text"
                style={{
                    fontSize: `${subtitleFontSize || 20}px`,
                    color: subtitleColor || "#fff",
                    background: `rgba(0,0,0,${subtitleBgOpacity ?? 0.72})`,
                    textShadow: "0 1px 4px rgba(0,0,0,0.95), 0 0 12px rgba(0,0,0,0.7)",
                }}>
                {activeCue.text.split("\n").map((line, i, arr) => (
                    <span key={i}>
                        {line}
                        {i < arr.length - 1 && <br />}
                    </span>
                ))}
            </div>
        </div>
    );
}
