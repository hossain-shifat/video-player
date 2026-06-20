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
//
// NOTE on backend contract (server/controllers/streamController.js):
//   - .srt  → server converts to WebVTT server-side (Content-Type: text/vtt,
//             body starts with "WEBVTT"). This covers EVERY source: embedded
//             (always extracted as webvtt via ffmpeg), external .srt files,
//             and downloaded .srt files from SubSource.
//   - .vtt  → served as-is (already WebVTT).
//   - .ass / .ssa → served RAW, untouched (Content-Type: text/plain). This is
//             the only format that reaches the client in its original form.
//
// So in practice the client almost always receives WebVTT regardless of the
// original source extension — only .ass/.ssa needs client-side parsing of a
// non-VTT format. Detection below trusts the actual response body over the
// `ext` hint, since the server may convert .srt → vtt transparently.

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
            const parts = data.split(",");
            if (parts.length < formatOrder.length) continue;

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

/**
 * Detects the actual format of the response body. The server normalizes
 * .srt → WebVTT transparently, so the original file extension is NOT a
 * reliable signal — always sniff the body first.
 */
function detectFormat(raw) {
    const trimmed = raw.trimStart();
    if (trimmed.startsWith("WEBVTT")) return "vtt";
    if (trimmed.includes("[Script Info]") || trimmed.includes("[V4+ Styles]") || trimmed.includes("[Events]")) return "ass";
    // Fallback: anything else is treated as VTT-shaped (the VTT parser
    // tolerates a missing "WEBVTT" header line).
    return "vtt";
}

function parseCues(raw) {
    const fmt = detectFormat(raw);
    return fmt === "ass" ? parseASS(raw) : parseVTT(raw);
}

// ─── Subtitle track list (embedded + external + downloaded) ─────────────────
//
// GET /api/media/:id/subtitles → { subtitles: [{ source, lang, label, ext,
//   url, filename?, forced?, trackIndex?, codec? }] }
//
// `source` is one of: "embedded" | "external" | "downloaded"
// Exposed via this hook so the player's settings/track-picker UI can list
// and switch between all available subtitle tracks for a media item.

function useSubtitleTracks(mediaId) {
    const [tracks, setTracks] = useState([]);
    const [loadingTracks, setLoadingTracks] = useState(false);

    useEffect(() => {
        if (!mediaId) {
            setTracks([]);
            return;
        }
        const ctrl = new AbortController();
        setLoadingTracks(true);
        fetch(absoluteUrl(`/api/media/${mediaId}/subtitles`), { signal: ctrl.signal })
            .then((r) => r.json())
            .then((data) => setTracks(data?.subtitles || []))
            .catch((err) => {
                if (err.name !== "AbortError") setTracks([]);
            })
            .finally(() => setLoadingTracks(false));
        return () => ctrl.abort();
    }, [mediaId]);

    return { tracks, loadingTracks };
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

        abortRef.current?.abort();
        const ctrl = new AbortController();
        abortRef.current = ctrl;

        setLoading(true);
        fetch(absoluteUrl(activeSubtitle.url), { signal: ctrl.signal })
            .then((r) => r.text())
            .then((raw) => {
                setCues(parseCues(raw));
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
                    // background: `rgba(0,0,0,${subtitleBgOpacity ?? 0.72})`,
                    // textShadow: "0 1px 4px rgba(0,0,0,0.95), 0 0 12px rgba(0,0,0,0.7)",
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

// Exported so the player's settings/track-picker UI can list all available
// subtitle tracks (embedded/external/downloaded) for a given media item.
export { useSubtitleTracks };
