import { useState, useEffect, useRef } from "react";
import { usePlayerState } from "./UsePlayerState";

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * parseTime — converts "HH:MM:SS,mmm" / "MM:SS.mmm" / "HH:MM:SS.mmm" → float seconds
 * Handles both VTT (.) and SRT (,) decimal separators.
 */
function parseTime(str) {
    const s = str.trim().replace(",", ".");
    const parts = s.split(":");
    if (parts.length === 3) {
        return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
    }
    if (parts.length === 2) {
        return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
    }
    return parseFloat(s) || 0;
}

/**
 * parseCues — minimal VTT/SRT parser.
 * Returns [{ start, end, text }] sorted by start time.
 */
function parseCues(raw) {
    const cues = [];
    const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const blocks = text.split(/\n{2,}/);

    for (const block of blocks) {
        const lines = block.trim().split("\n");
        let ti = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes("-->")) {
                ti = i;
                break;
            }
        }
        if (ti < 0) continue;

        const m = lines[ti].match(/(\d{1,2}:?[\d:.]+[.,]\d{1,3})\s*-->\s*(\d{1,2}:?[\d:.]+[.,]\d{1,3})/);
        if (!m) continue;

        const start = parseTime(m[1]);
        const end = parseTime(m[2]);

        // Strip VTT positioning tags but keep line breaks
        const body = lines
            .slice(ti + 1)
            .join("\n")
            .replace(/<[^>]+>/g, "")
            .trim();

        if (body) cues.push({ start, end, text: body });
    }

    return cues.sort((a, b) => a.start - b.start);
}

// ─── SubtitleRenderer ─────────────────────────────────────────────────────────
/**
 * SubtitleRenderer
 *
 * No props — reads everything from usePlayerState:
 *   activeSubtitle  — { url, filename, label } or null
 *   currentTime     — seconds
 *   subtitleDelay   — ms offset (positive = delay, negative = advance)
 *   subtitleFontSize — px
 *
 * Fetches the subtitle file on activeSubtitle change, parses VTT/SRT,
 * and renders the active cue at the bottom of the player.
 */
export default function SubtitleRenderer() {
    const { state } = usePlayerState();
    const { activeSubtitle, currentTime, subtitleDelay, subtitleFontSize } = state;

    const [cues, setCues] = useState([]);
    const loadedUrlRef = useRef(null);

    // Fetch + parse whenever subtitle track changes
    useEffect(() => {
        const url = activeSubtitle?.url;

        if (!url) {
            setCues([]);
            loadedUrlRef.current = null;
            return;
        }

        // Already loaded this URL — no re-fetch needed
        if (url === loadedUrlRef.current) return;
        loadedUrlRef.current = url;

        let cancelled = false;
        fetch(url)
            .then((r) => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.text();
            })
            .then((text) => {
                if (!cancelled) setCues(parseCues(text));
            })
            .catch(() => {
                if (!cancelled) setCues([]);
            });

        return () => {
            cancelled = true;
        };
    }, [activeSubtitle?.url]);

    if (!activeSubtitle || !cues.length) return null;

    // Apply subtitle delay: positive delay shifts cues later (subtract from currentTime)
    const adjustedTime = currentTime - (subtitleDelay || 0) / 1000;

    // Binary search would be optimal, but cue counts are small — linear is fine
    const cue = cues.find((c) => adjustedTime >= c.start && adjustedTime <= c.end);

    if (!cue) return null;

    return (
        <div className="absolute bottom-20 inset-x-0 z-25 flex justify-center pointer-events-none px-6">
            <p
                className="bg-black/75 text-white text-center px-3 py-1.5 rounded-lg leading-snug max-w-2xl"
                style={{ fontSize: subtitleFontSize || 20 }}
                // VTT body may contain <b>/<i>/<u> — keep sanitised markup for italics support
                dangerouslySetInnerHTML={{ __html: cue.text.replace(/\n/g, "<br/>") }}
            />
        </div>
    );
}
