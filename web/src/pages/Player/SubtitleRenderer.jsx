import { useEffect, useState, useMemo, useRef } from "react";
import { usePlayerState } from "./UsePlayerState";
import { lockGesture, unlockGesture } from "./gestureLock";

// Backend base URL — subtitle URLs from the API are relative paths like
// /stream/subtitle/embedded/... and must be absolutified before fetch.
// Without this, the browser hits the Vite dev server which returns index.html.
const BACKEND = import.meta.env.VITE_API_URL || "http://localhost:5000";

function absoluteUrl(url) {
    if (!url) return url;
    // FIX: locally-opened subtitle files (via the "Open" row) use blob: URLs,
    // and data: URLs may also appear — neither should get BACKEND prefixed,
    // or fetch() 404s against the dev server instead of reading the blob.
    if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("blob:") || url.startsWith("data:")) return url;
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

const FONT_FAMILIES = {
    default: "inherit",
    "sans-serif": '"Helvetica Neue", Arial, sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    monospace: '"Courier New", monospace',
};

export default function SubtitleRenderer({ videoRef }) {
    const { state, actions } = usePlayerState();
    const {
        activeSubtitle,
        subtitleDelay,
        subtitleFontSize,
        subtitleColor = "#ffffff",
        subtitleBgOpacity = 0.72,
        currentTime,
        controlsVisible,
        // Customization panel fields — applied to the actual rendered cue
        // below so the sidebar controls do something, not just UI-only.
        subtitleSpeed = 100,
        subtitleAlignment = "center",
        subtitleBottomMargin = 0,
        subtitleBackgroundEnabled = false,
        subtitleBackgroundColor = "#000000",
        subtitleFitToVideo = false,
        subtitleFont = "default",
        subtitleScale = 100,
        subtitleBold = true,
        subtitleBorderEnabled = false,
        subtitleBorderColor = "#000000",
        subtitleBorderWidth = 50,
        subtitleShadow = true,
        subtitlePanelMode = false,
    } = state;

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

    // Find active cue. subtitleSpeed scales the subtitle TIMELINE itself
    // (independent of playback rate) — 100% = normal, 200% = cues arrive
    // twice as fast, 50% = half as fast.
    const activeCue = useMemo(() => {
        if (!cues.length) return null;
        const speedFactor = (subtitleSpeed || 100) / 100;
        const t = currentTime * speedFactor - (subtitleDelay || 0) / 1000;
        return cues.find((c) => t >= c.start && t < c.end) || null;
    }, [cues, currentTime, subtitleDelay, subtitleSpeed]);

    // ── Subtitle-relative dialogue-skip gesture ──────────────────────────────
    // A horizontal swipe *directly over the visible caption* jumps the
    // playhead to the previous/next dialogue line's timestamp — same idea as
    // MX Player's subtitle scrub gesture. Isolated from the app's normal
    // full-screen swipe-to-seek gesture two ways:
    //   1. This container only exists in the DOM while a cue is actually
    //      showing (see the `if (!activeSubtitle || !activeCue) return null`
    //      below) — there's nothing to "swipe over" otherwise, so it can
    //      never intercept a tap/swipe when no caption is visible.
    //   2. `data-gesture-exclude="true"` — PlayerGestures.jsx already checks
    //      for this exact attribute via `.closest()` on every touchstart and
    //      bails out immediately when found (see its own comment on that
    //      check). That's the SAME mechanism the sidebars/menus already rely
    //      on to not fight the global gesture layer, reused here rather than
    //      reinventing stopPropagation ordering against a listener this file
    //      has no direct reference to.
    const dragRef = useRef({ active: false, startX: 0, startY: 0 });
    const SWIPE_THRESHOLD_PX = 30;
    // Drives the slide-in animation direction; null = no animation (normal
    // playback advancing to the next line naturally, not via swipe).
    const [slideDir, setSlideDir] = useState(null);
    const slideTimerRef = useRef(null);

    function jumpToCueIndex(cuesList, targetIndex, speedFactor, delaySec) {
        if (targetIndex < 0 || targetIndex >= cuesList.length) return; // at the first/last line — no-op
        const target = cuesList[targetIndex];
        // Land a hair inside the cue's window (not exactly .start) so the
        // activeCue lookup above reliably resolves to THIS cue right after
        // the seek, even with normal seek/timeupdate jitter.
        const insidePad = Math.min(0.05, (target.end - target.start) / 4);
        const videoTime = (target.start + insidePad + delaySec) / speedFactor;
        if (videoRef?.current) videoRef.current.currentTime = Math.max(0, videoTime);
        actions.setCurrentTime(Math.max(0, videoTime));
    }

    function handleSubtitlePointerDown(e) {
        e.stopPropagation();
        // FIX (gesture conflict): lock immediately, synchronously, before
        // PlayerGestures' own native touchstart handler runs — pointerdown
        // fires before touchstart for the same physical touch, so this
        // wins the race regardless of DOM hit-test width quirks.
        lockGesture();
        dragRef.current = { active: true, startX: e.clientX, startY: e.clientY };
    }

    function handleSubtitlePointerUp(e) {
        if (!dragRef.current.active) return;
        e.stopPropagation();
        dragRef.current.active = false;
        unlockGesture();
        const dX = e.clientX - dragRef.current.startX;
        const dY = e.clientY - dragRef.current.startY;
        // Require a clean, mostly-horizontal swipe — ignore small taps and
        // vertical-dominant drags (those aren't a dialogue-skip gesture).
        if (Math.abs(dX) < SWIPE_THRESHOLD_PX || Math.abs(dX) < Math.abs(dY) * 1.3) return;

        const idx = cues.indexOf(activeCue);
        if (idx === -1) return;
        const speedFactor = (subtitleSpeed || 100) / 100;
        const delaySec = (subtitleDelay || 0) / 1000;
        // FIX (direction flip): right→left (dX < 0) = forward/next line;
        // left→right (dX > 0) = backward/previous line.
        const goingForward = dX < 0;
        clearTimeout(slideTimerRef.current);
        setSlideDir(goingForward ? "fwd" : "back");
        slideTimerRef.current = setTimeout(() => setSlideDir(null), 260);
        jumpToCueIndex(cues, goingForward ? idx + 1 : idx - 1, speedFactor, delaySec);
    }

    function handleSubtitlePointerCancel() {
        dragRef.current.active = false;
        unlockGesture();
    }

    // Safety net: if the active cue changes mid-swipe (playback moves past
    // its end during a slow drag) this component can unmount before
    // pointerup ever fires, which would leave the lock stuck on forever.
    useEffect(() => {
        return () => {
            unlockGesture();
            clearTimeout(slideTimerRef.current);
        };
    }, []);

    if (!activeSubtitle || !activeCue) return null;

    // Shift up when controls visible; bottomMargin adds extra user-set offset.
    const baseOffset = controlsVisible ? 88 : 32;
    const bottomOffset = `${baseOffset + (subtitleBottomMargin || 0)}px`;

    const alignToJustify = { left: "flex-start", center: "center", right: "flex-end" };
    const alignToText = { left: "left", center: "center", right: "right" };

    // Border ("stroke") approximated with layered text-shadow at
    // subtitleBorderWidth-scaled offsets — no real libass renderer here.
    const strokeW = Math.max(0.5, ((subtitleBorderWidth || 50) / 100) * 3);
    const borderShadow = subtitleBorderEnabled
        ? [
              `-${strokeW}px -${strokeW}px 0 ${subtitleBorderColor}`,
              `${strokeW}px -${strokeW}px 0 ${subtitleBorderColor}`,
              `-${strokeW}px ${strokeW}px 0 ${subtitleBorderColor}`,
              `${strokeW}px ${strokeW}px 0 ${subtitleBorderColor}`,
          ].join(", ")
        : null;
    const dropShadow = subtitleShadow ? "0 1px 4px rgba(0,0,0,0.9), 0 0 10px rgba(0,0,0,0.6)" : "none";
    const textShadow = [borderShadow, subtitleShadow ? dropShadow : null].filter(Boolean).join(", ") || "none";

    const scaledFontSize = ((subtitleFontSize || 20) * (subtitleScale || 100)) / 100;

    return (
        <div
            className="flux-subtitle-container"
            data-gesture-exclude="true"
            onPointerDown={handleSubtitlePointerDown}
            onPointerUp={handleSubtitlePointerUp}
            onPointerCancel={handleSubtitlePointerCancel}
            style={{
                bottom: bottomOffset,
                display: "flex",
                justifyContent: alignToJustify[subtitleAlignment] || "center",
                pointerEvents: "auto",
                touchAction: "none",
                // FIX (gesture conflict): always span the full width for HIT
                // TESTING, regardless of panel mode — without this, the
                // container shrinks to fit only the centered text, so a
                // natural wide swipe easily starts just outside the actual
                // DOM box (still visually "on the subtitle line") and
                // wasn't being excluded at all. Text itself stays centered
                // via justifyContent above; this only widens the swipeable/
                // excluded zone to match how someone actually swipes.
                left: 0,
                right: 0,
                width: "100%",
                // "Panel" mode additionally gives it an opaque background bar.
                ...(subtitlePanelMode ? { background: "rgba(0,0,0,0.85)", padding: "8px 0" } : {}),
                // "Fit subtitles into video size" constrains the caption box
                // to the video frame's own width rather than the full player.
                ...(subtitleFitToVideo ? { maxWidth: "100%" } : {}),
            }}>
            <style>{SLIDE_ANIMATION_CSS}</style>
            <div
                key={activeCue.start}
                className="flux-subtitle-text"
                style={{
                    fontSize: `${scaledFontSize}px`,
                    color: subtitleColor || "#fff",
                    fontFamily: FONT_FAMILIES[subtitleFont] || "inherit",
                    fontWeight: subtitleBold ? 700 : 400,
                    textAlign: alignToText[subtitleAlignment] || "center",
                    textShadow,
                    background: subtitleBackgroundEnabled
                        ? `${subtitleBackgroundColor}${Math.round((subtitleBgOpacity ?? 0.72) * 255)
                              .toString(16)
                              .padStart(2, "0")}`
                        : "transparent",
                    padding: subtitleBackgroundEnabled ? "2px 8px" : 0,
                    borderRadius: subtitleBackgroundEnabled ? 4 : 0,
                    display: "inline-block",
                    // Only animate when the line change came from the swipe
                    // gesture — normal automatic advancing during playback
                    // just cuts, same as before.
                    animation: slideDir === "fwd" ? "flux-sub-slide-fwd 260ms ease-out" : slideDir === "back" ? "flux-sub-slide-back 260ms ease-out" : "none",
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

// Slide-in keyframes for the swipe-triggered dialogue skip. "fwd" (swiped
// right→left) enters from the right; "back" (swiped left→right) enters
// from the left — matches the swipe's own direction.
const SLIDE_ANIMATION_CSS = `
@keyframes flux-sub-slide-fwd { from { transform: translateX(28px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
@keyframes flux-sub-slide-back { from { transform: translateX(-28px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
`;

// Exported so the player's settings/track-picker UI can list all available
// subtitle tracks (embedded/external/downloaded) for a given media item.
export { useSubtitleTracks };
