import { useEffect, useState, useMemo, useRef } from "react";
import { usePlayerState } from "./UsePlayerState";
import { lockGesture, unlockGesture } from "./GestureLock";

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

// A subtitle line legitimately displayed for longer than this is exceedingly
// rare (song lyrics blocks aside, unusual for regular dialogue tracks) —
// anything past it is almost certainly a missing/garbage end timestamp that
// got defaulted to the full stream length, a known issue with both ffmpeg's
// embedded-subtitle extraction and some auto-converted SubSource .srt files.
// Sanitizing here (post-parse) means parseVTT/parseASS themselves stay
// untouched — this only corrects entries that are already provably broken
// (duration on the order of the whole video), never a cue with a normal,
// even if slightly long, on-screen duration.
const MAX_SANE_CUE_SECONDS = 15;

function sanitizeCues(cues) {
    return cues.map((cue, i) => {
        const dur = cue.end - cue.start;
        if (dur <= MAX_SANE_CUE_SECONDS) return cue;
        const next = cues[i + 1];
        // Prefer clamping to just before the next cue starts (keeps normal
        // back-to-back dialogue spacing intact); otherwise cap to a sane
        // fixed max duration from this cue's own start.
        const cappedEnd = next && next.start > cue.start ? Math.min(next.start, cue.start + MAX_SANE_CUE_SECONDS) : cue.start + MAX_SANE_CUE_SECONDS;
        return { ...cue, end: cappedEnd };
    });
}

// ─── Frame-accurate cue timing (YouTube/Netflix-style lead-in/lead-out) ───────
//
// Applied ONCE per parsed cue list (not per-frame) — cheap, and keeps the
// per-frame lookup loop below a plain range check against precomputed
// windows instead of doing this math 60x/sec.
const SUB_LEAD_IN_SEC = 0.15; // cue appears 150ms before its authored start
const SUB_LEAD_OUT_SEC = 0.2; // cue holds 200ms after its authored end
const SUB_MIN_DURATION_SEC = 1.0; // never on-screen for less than this
const SUB_MIN_GAP_SEC = 0.09; // ~90ms of blank between consecutive cues

function applyLeadInOut(cues) {
    if (!cues.length) return [];
    const out = cues.map((c) => {
        let dispStart = c.start - SUB_LEAD_IN_SEC;
        let dispEnd = c.end + SUB_LEAD_OUT_SEC;
        if (dispEnd - dispStart < SUB_MIN_DURATION_SEC) {
            dispEnd = dispStart + SUB_MIN_DURATION_SEC;
        }
        return { ...c, dispStart, dispEnd };
    });
    // Trim the EARLIER cue's lead-out (never delay the next cue's lead-in —
    // that would make text changes feel late) so consecutive cues always
    // have a visible gap between them instead of visually merging.
    for (let i = 0; i < out.length - 1; i++) {
        const cur = out[i];
        const next = out[i + 1];
        if (cur.dispEnd + SUB_MIN_GAP_SEC > next.dispStart) {
            cur.dispEnd = Math.max(cur.start, next.dispStart - SUB_MIN_GAP_SEC);
        }
    }
    return out;
}

// ─── SubtitleRenderer ─────────────────────────────────────────────────────────

// The per-session audio-vs-video gap ramp below was a mitigation for the
// resume mismatch. The real cause was the session offset (keyframe-snapped
// video start, now measured in PlayerPage's launchSeek) plus a wall-clock
// subtitle clock — with both fixed, applying this on top would double-correct.
// Flip to true only to compare behaviour.
const APPLY_AV_GAP_CORRECTION = false;

const FONT_FAMILIES = {
    default: "inherit",
    "sans-serif": '"Helvetica Neue", Arial, sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    monospace: '"Courier New", monospace',
};

export default function SubtitleRenderer({ videoRef, isResumeSyncing = false, manualClockRef, sessionTimeOffsetRef, resumePositionRef, qualitySwitchStateRef, avGapSecRef }) {
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
    // Tracks the last computed absolute time so the clock below can tell
    // "video is genuinely advancing" apart from "native seeking flag says
    // we're mid-seek" — see the stable computation for why this matters.
    const prevAbsRef = useRef(null);

    // ── THE ONE AUTHORITATIVE SUBTITLE CLOCK ────────────────────────────────
    // ROOT CAUSE (subtitles ahead of audio, every previous attempt): cue
    // lookup used `currentTime` (state.currentTime) — the app's own
    // optimistic display clock. seekBy/resume set it to the TARGET the
    // instant a seek is requested (that's precisely "gesture target time" /
    // "seek target" / "resume target"), and between seeks it's ticked by
    // manualClockRef, a wall-clock EXTRAPOLATION (baseX + real time
    // elapsed) — a PREDICTED position, not a measured one. Both are
    // explicitly the kind of estimate that can run ahead of when audio is
    // actually, audibly there.
    //
    // FIX: subtitle cue lookup now reads ONLY the real media element's own
    // clock — video.currentTime — updated exclusively by the native
    // "timeupdate" event, which the browser fires ONLY as the media
    // element itself actually advances. No polling, no
    // requestAnimationFrame loop, no wall-clock extrapolation: if
    // video.currentTime hasn't moved, timeupdate simply doesn't fire, and
    // this value simply doesn't change — it cannot run ahead of the media
    // pipeline because it never leaves it. Converted to absolute time via
    // sessionTimeOffsetRef, the exact same coordinate transform
    // SeekBar.jsx's buffered-range display already relies on (a
    // measurement-scale conversion, not a prediction).
    //
    // state.currentTime / manualClockRef are UNTOUCHED and still drive the
    // seek bar and gesture math (they need to be optimistic — a seek bar
    // that waited for "confirmed" playback would feel laggy). They are no
    // longer read anywhere in this file.
    // ═══════════════════════════════════════════════════════════════════════
    // SIMPLIFIED, RACE-FREE ARCHITECTURE
    // ═══════════════════════════════════════════════════════════════════════
    // Previous rounds tracked "mediaTime" and "syncing" as STORED state,
    // accumulated via a growing set of event handlers (seeking/waiting/
    // playing/timeupdate-counter/seeked-if-paused/pause-if-not-resuming...).
    // Each patch fixed one specific ordering bug but the fundamental shape —
    // "remember a flag, clear it later from a different event" — is
    // inherently race-prone: the outcome depends on which event fires
    // first, which can vary between runs depending on network/buffering
    // speed. That's exactly why the same resume sometimes worked and
    // sometimes didn't.
    //
    // FIX: don't store anything that needs to be "cleared" at all. A single
    // tick counter forces a re-render on any relevant native event; on
    // every one of those re-renders, mediaTime and "stable" are computed
    // FRESH by reading the real video element directly. There is no flag
    // that can get stuck true or cleared too early, because nothing is
    // remembered between events — every render asks the video element
    // "where are you right now, and are you actually playing?" from
    // scratch. This is immune to event-ordering races by construction.
    const [tick, setTick] = useState(0);
    useEffect(() => {
        let cancelled = false;
        let detach = () => {};
        const attach = () => {
            const v = videoRef?.current;
            if (!v) {
                if (!cancelled) setTimeout(attach, 50); // element not mounted yet — retry until it exists
                return;
            }
            const bump = () => setTick((t) => t + 1);
            const events = ["timeupdate", "seeking", "seeked", "waiting", "playing", "pause", "canplay", "loadedmetadata"];
            events.forEach((ev) => v.addEventListener(ev, bump));
            detach = () => events.forEach((ev) => v.removeEventListener(ev, bump));
            // Recompute immediately now that the element exists — without
            // this, mediaTime/subtitlesStable stay stuck at the "not
            // mounted yet" memoized value until the first native event
            // happens to fire.
            bump();
        };
        attach();
        return () => {
            cancelled = true;
            detach();
        };
    }, [videoRef]);

    // FIX (subtitle never shows after resume): v.seeking can get stuck
    // true forever on some HLS.js/MSE resume-seek cases where 'seeked'
    // never cleanly fires (documented below at the `stable` computation).
    // The `genuinelyAdvancing` fallback only unsticks that once the video
    // is actually playing AND progressing — if playback doesn't (yet)
    // advance past the resume point (autoplay briefly blocked, still
    // paused right after landing, etc.) there's also no native event left
    // to even RE-RUN the mediaTime/stable memo, since a stuck `seeking`
    // flag stops the browser from firing further timeupdate/seeked events.
    // This is a plain safety-net poller, separate from the native listeners
    // above: while (and only while) v.seeking reads true, it nudges `tick`
    // every 300ms purely so the memo below gets a chance to re-evaluate its
    // own stuck-seeking timeout. It does nothing during normal playback
    // (interval body no-ops whenever seeking is false) and touches no
    // shared ref/state used elsewhere.
    //
    // ALSO ticks continuously whenever manualClockRef is active: that
    // clock advances purely from Date.now() on PlayerPage's own separate
    // 200ms interval, never firing any native <video> event of its own —
    // without this, mediaTime would only refresh whenever a native event
    // happened to fire (which can be sparse or momentarily stall right
    // after a resume), showing stale/jumpy subtitle timing instead of
    // smoothly tracking the wall clock like the on-screen timer does.
    useEffect(() => {
        const id = setInterval(() => {
            const v = videoRef?.current;
            if (v?.seeking || qualitySwitchStateRef?.current || isResumeSyncing || manualClockRef?.current?.active) setTick((t) => t + 1);
        }, 300);
        return () => clearInterval(id);
    }, [videoRef, qualitySwitchStateRef, isResumeSyncing, manualClockRef]);

    // Tracks when v.seeking first read true (real wall-clock timestamp),
    // so a genuinely stuck flag (see stable computation below) can be told
    // apart from a normal, still-settling seek — reset the instant seeking
    // clears so this never lingers into a later, unrelated seek.
    const seekingSinceRef = useRef(null);

    // Same idea, for the sessionTransitioning stuck-check further below.
    const transitionSinceRef = useRef(null);

    // FINAL SAFETY VALVE (subtitles resume-checked but overlay stays empty,
    // even after the two stuck-gate fixes above): those two fixes each
    // target ONE specific ref getting stuck. If some other, still-unknown
    // path leaves ANY of the three gates below truthy forever, subtitles
    // are hidden permanently with no way to self-correct — exactly what
    // keeps getting reported. This tracks how long the CURRENT gate
    // episode (this specific resume/seek, not the whole player session)
    // has been continuously active, resetting the instant it clears
    // normally — so it can never bypass gating for a later, unrelated
    // video or an ordinary mid-playback seek, only a stretch that's gone
    // on far longer than any real resume/session-restart handoff could
    // possibly take.
    const gateActiveSinceRef = useRef(null);
    // FIX (subtitle "totally mismatched / random timing" for the first
    // couple seconds after resume): see the render-gate block below —
    // tracks when the OTHER gates (isResumeSyncing/sessionTransitioning/
    // subtitlesStable) just cleared, so subtitles can be held a little
    // longer specifically until avGapSecRef has a real measured value.
    const gapGraceStartRef = useRef(null);

    // Derived EVERY render, straight from the video element — never stored.
    // `tick` is only in the deps list to force recomputation when a native
    // event fires; the values themselves always come from `v` directly.
    const { mediaTime, subtitlesStable } = useMemo(() => {
        const v = videoRef?.current;
        if (!v) {
            // Not mounted yet — use the resume seed so the very first
            // paint (before any native event has ever fired) already
            // shows the right cue instead of defaulting to 0.
            return { mediaTime: typeof resumePositionRef?.current === "number" ? resumePositionRef.current : 0, subtitlesStable: false };
        }

        // FIX (subtitle never shows / never synced right, specifically
        // and only since the seekSec-based auto-resume was added): before
        // that feature, ffmpeg's HLS session always started encoding from
        // file-time 0, so video.currentTime WAS the real absolute
        // position on its own — sessionTimeOffsetRef was always 0 and
        // never mattered. Auto-resume made ffmpeg start encoding near the
        // resume point instead, so video.currentTime is no longer
        // absolute on its own — it needs a session offset added back,
        // and that offset is only ever a CLIENT-SIDE ESTIMATE of where
        // ffmpeg's fast seek + hls.js's own internal handling actually
        // landed (see PlayerPage.jsx's sessionOffset computation). Any
        // mismatch between that estimate and reality throws subtitle
        // timing off for the WHOLE session — which lines up exactly with
        // "only broke once auto-resume shipped."
        //
        // manualClockRef is a SEPARATE, already-proven clock: pure
        // wall-clock time (Date.now() deltas), pause/buffering-aware
        // (PlayerPage.jsx's own ticker freezes it exactly when the video
        // isn't actually advancing), and it's what already drives the
        // visible timer/seek bar correctly — if it were wrong, that would
        // be wrong too, and it isn't. It never touches video.currentTime,
        // hls.js, or any session-offset estimate at all, so none of the
        // above can throw it off. Preferring it here — instead of
        // re-deriving a second, independently-fallible clock — makes
        // subtitles track exactly what's already shown on screen, by
        // construction.
        const clock = manualClockRef?.current;
        if (clock?.active) {
            const abs = clock.baseX;
            prevAbsRef.current = abs;
            seekingSinceRef.current = null;
            // Nothing here depends on the native `seeking` flag, so there
            // is nothing for it to get stuck on — safe to trust
            // immediately once this clock is the active source.
            return { mediaTime: abs, subtitlesStable: true };
        }

        const abs = v.currentTime + (sessionTimeOffsetRef?.current || 0);
        // "Stable" = not currently mid-seek. That's the ONLY state where
        // currentTime is provably not yet reflecting what's actually
        // audible. Deliberately does NOT require !paused or readyState>=3
        // anymore — those were over-corrections: hiding subtitles whenever
        // the user simply pauses isn't how any real player behaves (VLC/
        // YouTube/MX freeze the subtitle right along with the frame), and
        // requiring readyState>=3 could keep subtitles hidden through
        // ordinary momentary buffering blips during normal steady
        // playback that have nothing to do with seeking at all.
        //
        // FIX: v.seeking is a native flag whose timing we don't control.
        // Some HLS.js/MSE resume-seek cases never cleanly fire 'seeked',
        // leaving this flag stuck true for the rest of the session —
        // permanently blocking subtitles even though audio/video is
        // playing normally. A genuine seek holds currentTime still or
        // jumps once; it never produces multiple consecutive forward
        // increments the way real playback does. So if abs keeps
        // advancing while seeking still reads true, trust the
        // progression over the flag.
        const prevAbs = prevAbsRef.current;
        const genuinelyAdvancing = prevAbs != null && abs > prevAbs + 0.03 && !v.paused;

        // FIX (subtitle never shows after resume): track how long `seeking`
        // has read true. genuinelyAdvancing only proves the flag is stale
        // once the video is actually playing forward again — if it never
        // does (autoplay briefly blocked, still paused right after the
        // resume seek lands, etc.) a stuck flag blocked subtitles forever
        // with nothing left to unstick it. Past a bounded timeout (well
        // longer than any real in-flight seek takes to settle), trust that
        // the seek has landed and stop gating on this flag — the
        // setInterval safety-net above keeps nudging `tick` while seeking
        // reads true so this actually gets re-evaluated even with no
        // further native events.
        if (v.seeking) {
            if (seekingSinceRef.current == null) seekingSinceRef.current = Date.now();
        } else {
            seekingSinceRef.current = null;
        }
        const seekingStuck = v.seeking && seekingSinceRef.current != null && Date.now() - seekingSinceRef.current > 1200;

        const stable = !v.seeking || genuinelyAdvancing || seekingStuck;
        prevAbsRef.current = abs;
        return { mediaTime: abs, subtitlesStable: stable };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tick, videoRef, sessionTimeOffsetRef, resumePositionRef, manualClockRef]);

    // ═══════════════════════════════════════════════════════════════════════
    // TEMPORARY RUNTIME DEBUG LOGGER — remove after capturing the trace.
    // Purely additive: its own separate event listeners, only reads
    // existing values (mediaTime, isResumeSyncing, subtitlesStable) for the log
    // line — never writes to any state/ref the real pipeline uses, so it
    // cannot change runtime behavior, only observes it. Open devtools
    // console, reproduce (normal play / resume / double-tap / drag /
    // quality switch), copy the "[SUBSYNC]" lines, paste them back.
    // ═══════════════════════════════════════════════════════════════════════
    useEffect(() => {
        const v = videoRef?.current;
        if (!v) return;

        const snap = (event) => {
            const abs = v.currentTime + (sessionTimeOffsetRef?.current || 0);
            // eslint-disable-next-line no-console
            console.log(
                `[SUBSYNC] t=${performance.now().toFixed(1)}ms event=${event} ` +
                    `video.currentTime=${v.currentTime.toFixed(3)} ` +
                    `sessionOffset=${(sessionTimeOffsetRef?.current || 0).toFixed(3)} ` +
                    `absTime=${abs.toFixed(3)} ` +
                    `mediaTime=${mediaTime.toFixed(3)} ` +
                    `isResumeSyncing=${isResumeSyncing} stable=${subtitlesStable} ` +
                    `readyState=${v.readyState} paused=${v.paused} seeking=${v.seeking}`,
            );
        };

        const events = ["loadedmetadata", "canplay", "canplaythrough", "playing", "pause", "waiting", "stalled", "seeking", "seeked", "progress", "ended"];
        const handlers = events.map((ev) => [ev, () => snap(ev)]);
        // timeupdate would flood the console at ~4x/sec — throttle it.
        let lastTU = 0;
        const onTimeUpdate = () => {
            const now = performance.now();
            if (now - lastTU < 200) return;
            lastTU = now;
            snap("timeupdate");
        };
        handlers.forEach(([ev, fn]) => v.addEventListener(ev, fn));
        v.addEventListener("timeupdate", onTimeUpdate);
        // eslint-disable-next-line no-console
        console.log("[SUBSYNC] logger attached");
        return () => {
            handlers.forEach(([ev, fn]) => v.removeEventListener(ev, fn));
            v.removeEventListener("timeupdate", onTimeUpdate);
        };
        // Deliberately re-attaches whenever these change so the logged
        // snapshot values are never stale closures — this is a debug tool,
        // log correctness matters more than listener churn here.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [videoRef, sessionTimeOffsetRef, mediaTime, isResumeSyncing, subtitlesStable]);
    // ═══════════════════════════════════════════════════════════════════════
    // END TEMPORARY RUNTIME DEBUG LOGGER
    // ═══════════════════════════════════════════════════════════════════════

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
                const parsed = sanitizeCues(parseCues(raw));
                // TEMPORARY — ground-truth check: prints the FIRST 5 cues
                // exactly as parsed from whatever the server actually sent
                // (post srt→vtt conversion for .srt sources). Compare these
                // start/end numbers directly against the .srt file open in
                // a text editor — if they don't match the file, the bug is
                // in fetch/conversion/parsing. If they DO match, the bug is
                // downstream in the currentTime/AV_LAG_SEC comparison (see
                // the [SUBSYNC] SHOW/HIDE logs below).
                // eslint-disable-next-line no-console
                console.log(
                    `[SUBSYNC] loaded ${parsed.length} cues from url=${activeSubtitle.url} — first 5:`,
                    parsed.slice(0, 5).map((c) => ({ start: c.start, end: c.end, text: c.text.slice(0, 30) })),
                );
                setCues(parsed);
                setLoading(false);
            })
            .catch((err) => {
                if (err.name !== "AbortError") setLoading(false);
            });

        return () => ctrl.abort();
    }, [activeSubtitle]);

    // RACE FIX: truthy the instant a session restart (quality switch or
    // initial resume) is initiated, until handleReadyToSeek's `pending`
    // branch consumes/nulls it — covers the gap BEFORE isResumeSyncing
    // becomes true (see PlayerPage.jsx's prop-passing comment). Read fresh
    // every render, same pattern as mediaTime/subtitlesStable above — no
    // stored state, nothing to clear from a different event.
    //
    // FIX (subtitle checked in sidebar but overlay stays empty): this ref
    // is only ever nulled from inside PlayerPage's handleReadyToSeek. If
    // that callback never runs for any reason (onReadyToSeek not firing —
    // manifest/loadedmetadata event missed, etc.) the ref stays truthy
    // forever and subtitles are gated out permanently even though
    // activeSubtitle/cues are perfectly correct — exactly the "checked but
    // never shows" symptom, and NOT limited to the resume moment since
    // this gate blocks every render from then on. Same bounded-timeout
    // escape as the stuck-seeking fix above: once this has read truthy for
    // longer than any real session-restart handoff should ever take, stop
    // trusting it. This never touches qualitySwitchStateRef.current itself
    // (PlayerPage still owns and consumes it normally) — it only stops
    // THIS component from being gated by a value that's stopped being
    // meaningful.
    if (qualitySwitchStateRef) {
        if (qualitySwitchStateRef.current) {
            if (transitionSinceRef.current == null) transitionSinceRef.current = Date.now();
        } else {
            transitionSinceRef.current = null;
        }
    }
    const transitionStuck = !!qualitySwitchStateRef?.current && transitionSinceRef.current != null && Date.now() - transitionSinceRef.current > 8000;
    const sessionTransitioning = !!qualitySwitchStateRef?.current && !transitionStuck;

    // Find active cue. subtitleSpeed scales the subtitle TIMELINE itself
    // (independent of playback rate) — 100% = normal, 200% = cues arrive
    // twice as fast, 50% = half as fast.
    //
    // FIX (fine-tune — subtitle a little ahead of dialogue): mediaTime
    // tracks VIDEO position; the AV-DEBUG gap diagnostic
    // (transcoderService.js's debugAvOffset) confirmed this pipeline's
    // audio can start a bit after video for this decision path, so what's
    // actually audible lags mediaTime slightly. This correction is purely
    // additive on top of the existing subtitleDelay setting — the user's
    // own delay control keeps working unchanged.
    //
    // REVERTED (adaptive avGapSec caused intermittent delayed subtitles):
    // tried preferring the real per-session measured gap once the backend
    // heartbeat reported it, a few seconds into playback. Problem: when
    // that value showed up mid-playback, the correction changed instantly
    // — every cue lookup shifts the moment the ref updates, which reads as
    // subtitles suddenly falling behind right at that point. A steady
    // fixed value has no such jump. Back to fixed-only.
    // REVERTED: this was compensating for audio starting after video —
    // fixed properly at the source now (transcoderService.js's aresample
    // first_pts=0 + async=1000 fix), confirmed via AV-DEBUG gap(audio-video)
    // dropping to ~0.3s. Keeping this nonzero was double-correcting for a
    // problem that no longer exists at that magnitude, pushing subtitles
    // early. Zeroed rather than deleted so it's easy to reintroduce a small
    // value here if a future file still shows residual drift.
    // RESTORED, done right this time (subtitles showing before audio
    // arrives): the earlier zeroing assumed the backend's aresample
    // first_pts=0+async=1000 fix had closed the audio-vs-video start gap
    // to ~0.3s. Live production logs prove that's false for dual-audio
    // "separate renditions" sessions — AV-DEBUG measured gap(audio-video)
    // =5.112s, i.e. audio genuinely starts ~5s AFTER video's own first
    // PTS for this pipeline shape. Subtitles are keyed off `currentTime`,
    // which tracks VIDEO position — so with AV_LAG_SEC pinned at 0 they
    // necessarily play ~5s ahead of the audio a viewer actually hears.
    // That backend gap was also being silently clamped away before it
    // ever reached the client (see transcoderService.js's debugAvOffset —
    // the old `< 5` bound rejected exactly this 5.112s real value); fixed
    // there too.
    //
    // Un-reverting the adaptive avGapSec value, but fixing the actual
    // problem that caused the earlier revert ("value showing up mid-
    // playback caused an instant, visible jump"): instead of applying
    // avGapSecRef.current the instant it arrives, ramp toward it smoothly
    // over real wall-clock time. A viewer sees subtitle timing drift
    // gradually into place over ~2-3s instead of snapping.
    // RE-ENABLED — the assumption behind disabling this didn't hold. A
    // fresh production log taken AFTER the force_key_frames fix still
    // showed gap=9.170s (audioFirstPTS-requestedSeek=9.979s — identical to
    // the millisecond to every prior measurement, on THIS specific file,
    // regardless of which pipeline bug got fixed). Sandbox-tested the full
    // pipeline against a clean synthetic dual-audio source under harder
    // conditions than this file (10s GOP, mid-GOP seek, real re-encode)
    // and got near-perfect sync (video/audio within 45ms) — so the code
    // path itself now checks out. The unmoving 9.979s on THIS file most
    // likely means the source file's own Hindi audio track is muxed with a
    // genuine, constant offset relative to its video (common on dual-audio
    // remuxes assembled from separately-sourced tracks) — not something
    // any transcoder argument can correct, since it's baked into the
    // source. Whatever the true cause, this per-session-measured,
    // self-adaptive correction directly fixes the visible symptom
    // (subtitle vs. audio mismatch) regardless of where the real fault
    // lies, so it stays ON as the working mitigation.
    //
    // FIX (external debug report, confirmed real against this actual
    // file — two genuine bugs, both fixed by the same change):
    //
    // RC-1: AV_LAG_SEC was read inside the activeCue useMemo body but
    // never listed in its deps array. In practice currentTime updates
    // ~4x/sec during playback so the memo mostly recomputed anyway and
    // picked up the fresh value — but the moment playback is PAUSED
    // (currentTime frozen) while a fresh avGapSec measurement lands and
    // the ramp is still moving, the memo has no reason to re-run and
    // silently keeps using a stale AV_LAG_SEC. Real bug, narrow window.
    //
    // RC-2: the ramp ran as inline code in the render body (not a
    // useEffect/rAF loop), so it only ever advanced when something ELSE
    // triggered a re-render. No independent clock of its own — if
    // re-renders are sparse for any reason, the ramp just doesn't move,
    // silently.
    //
    // Both are fixed the same way: AV_LAG_SEC is now real React STATE,
    // advanced by its own requestAnimationFrame loop, independent of
    // whatever else does or doesn't cause this component to re-render.
    // Being real state (not a ref read inline) means any hook that lists
    // it as a dependency — activeCue's useMemo now does — correctly
    // reruns exactly when it changes, whether or not currentTime also
    // changed in that same tick.
    const [avLagSec, setAvLagSec] = useState(0);
    const appliedAvLagRef = useRef(0);
    useEffect(() => {
        let raf;
        let lastTs = null;
        const RAMP_RATE_SEC_PER_SEC = 3; // reaches a typical 2-10s gap in well under 3s
        const tick = (ts) => {
            const rawGap = avGapSecRef?.current;
            // FIX: was Math.max(0, ...) — a one-sided clamp that assumed
            // audio is always the delayed party. That was true before the
            // transcoderService.js per-file audio correction (asetpts)
            // started working — confirmed via production log: audio now
            // lands EXACTLY on the requested seek (audioFirstPTS=2480.000
            // for requestedSeek=2480.00), which flips the sign of gap
            // whenever VIDEO's own keyframe-snap seek drift (a separate,
            // real issue) exceeds audio's now-near-zero error — observed
            // gap=-8.604s in that same log. The old clamp silently zeroed
            // that out, discarding the exact correction now needed.
            // Symmetric range: video lagging behind audio is just as real
            // a case as audio lagging behind video.
            const target = APPLY_AV_GAP_CORRECTION && typeof rawGap === "number" && Number.isFinite(rawGap) ? Math.max(-10, Math.min(10, rawGap)) : 0;
            const last = lastTs ?? ts;
            const dt = Math.min(0.5, Math.max(0, (ts - last) / 1000));
            lastTs = ts;
            const diff = target - appliedAvLagRef.current;
            const maxStep = RAMP_RATE_SEC_PER_SEC * dt;
            const next = Math.abs(diff) <= maxStep ? target : appliedAvLagRef.current + Math.sign(diff) * maxStep;
            if (next !== appliedAvLagRef.current) {
                appliedAvLagRef.current = next;
                setAvLagSec(next);
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [avGapSecRef]);
    const AV_LAG_SEC = avLagSec;

    // ROOT CAUSE (subtitles drifting ahead/behind, not matching what the
    // seek bar / on-screen timer show): this component was maintaining its
    // OWN independently-computed "mediaTime" (300ms poll + native video
    // events, or manualClockRef.baseX) as a SECOND clock, separate from
    // `currentTime` (state.currentTime) — the value PlayerPage/VideoCore
    // already compute from the exact same two sources (handleTimeUpdate's
    // v.currentTime+sessionTimeOffsetRef, or the 200ms manualClockRef
    // ticker) and use to drive the seek bar and on-screen duration. Two
    // independently-ticking clocks that are SUPPOSED to represent the same
    // number will still read slightly differently at any given instant
    // (different polling cadence, different event ordering) — that's
    // exactly why subtitles sometimes ran a hair ahead and sometimes a
    // hair behind, with no consistent direction.
    //
    // FIX: cue lookup now reads `currentTime` directly — the SAME state
    // value already driving the seek bar/currentDuration display. There is
    // only one clock now; subtitles cannot disagree with what the UI
    // itself already shows as "now", by construction. The local mediaTime
    // memo above is kept only for `subtitlesStable` (seek-in-progress
    // gating) and the debug loggers — it no longer feeds the cue lookup.
    // ═══════════════════════════════════════════════════════════════════════
    // FRAME-ACCURATE SYNC ENGINE (requestVideoFrameCallback)
    // ═══════════════════════════════════════════════════════════════════════
    // REPLACES the old `currentTime`-keyed lookup above. `currentTime` is
    // PlayerPage's optimistic UI clock (timeupdate-driven, ~4x/sec, or a
    // wall-clock extrapolation during manualClockRef playback) — good
    // enough for a seek bar, not for frame-accurate cue timing.
    //
    // This loop instead asks the actual <video> element what frame it's
    // presenting RIGHT NOW, every time a new frame is presented:
    //   - `video.requestVideoFrameCallback` fires once per displayed video
    //     frame and hands back `metadata.mediaTime` — the exact
    //     presentation timestamp of that frame. This is as close to
    //     "what the viewer is looking at this instant" as the browser
    //     exposes.
    //   - Falls back to `requestAnimationFrame` + `video.currentTime` on
    //     browsers without rVFC support (older Safari/Firefox).
    //
    // displayCues carries lead-in/lead-out/min-duration/gap windows
    // precomputed above — the per-frame check here is just a range test,
    // cheap enough to run every frame.
    //
    // Re-render is intentionally NOT tied to the frame loop itself —
    // `activeCueRef` is updated every frame, but React only re-renders when
    // the SELECTED cue actually changes (activeCueTick), not on every one
    // of the ~24-60 evaluations per second. That's what keeps this cheap.
    const displayCues = useMemo(() => applyLeadInOut(cues), [cues]);
    const activeCueRef = useRef(null);
    const [activeCueTick, setActiveCueTick] = useState(0);
    const rvfcHandleRef = useRef(null);
    const rafHandleRef = useRef(null);
    const detachRef = useRef(null);

    useEffect(() => {
        let cancelled = false;
        let retryHandle = null;

        // FIX (subtitles not showing on fresh loads — real bug in this
        // effect, not a server issue): `videoRef` is a stable ref object,
        // its IDENTITY never changes, so it can never appear in a
        // dependency array as "changed." The effect used to bail out
        // permanently with a bare `if (!v) return` whenever it happened to
        // run before the <video> element had mounted (very possible right
        // after a fresh HLS session start/resume) — nothing would ever
        // trigger it to check again, so the whole frame-sync engine below
        // just never started for that mount, and no cue ever appears.
        // Retrying on a short timer until the element actually exists
        // fixes that without needing videoRef itself to be reactive.
        const start = () => {
            if (cancelled) return;
            const v = videoRef?.current;
            if (!v) {
                retryHandle = setTimeout(start, 100);
                return;
            }
            attach(v);
        };

        const attach = (v) => {
            const useRVFC = typeof v.requestVideoFrameCallback === "function";

            const findCue = (t) => displayCues.find((c) => t >= c.dispStart && t < c.dispEnd) || null;

            const evaluate = (mediaTimeSec) => {
                const speedFactor = (subtitleSpeed || 100) / 100;
                const t = mediaTimeSec * speedFactor - (subtitleDelay || 0) / 1000 - AV_LAG_SEC;
                const next = findCue(t);
                const prev = activeCueRef.current;
                const changed = (next?.start ?? null) !== (prev?.start ?? null) || (next?.end ?? null) !== (prev?.end ?? null);
                if (changed) {
                    activeCueRef.current = next;
                    setActiveCueTick((x) => x + 1);
                }
            };

            // FIX (subtitles disagreeing with the on-screen timer/seek bar
            // during a resume/quality-switch handoff): rVFC's metadata.mediaTime
            // is the REAL video element's clock — great for frame accuracy once
            // the element is actually the thing driving playback, but during a
            // resume/session-restart window `currentTime` (the state that feeds
            // the visible duration/seek bar) is deliberately driven by
            // manualClockRef instead — a pause/buffering-aware wall-clock
            // extrapolation, chosen specifically because video.currentTime
            // isn't trustworthy yet at that moment (this was already solved
            // once, see manualClockRef's own history). Reading rVFC unconditionally
            // reintroduces that exact "two clocks disagreeing" bug this project
            // already fixed once — matching the SAME source-selection here
            // (manualClockRef when active, else the real video clock) keeps
            // subtitles and the on-screen timer reading the same number by
            // construction, while still getting per-frame accuracy whenever
            // the real clock IS the authoritative one (the common case).
            // FIX (frame-accurate subtitles after resume): this used to return
            // manualClockRef.baseX whenever the manual clock was active — and
            // it stays active for the WHOLE resumed session. That clock is a
            // wall-clock extrapolation: it keeps running through stalls,
            // ignores playbackRate and audio-start gaps, and only matches
            // the video at one recalibration instant. Subtitles must follow
            // the frame actually presented: rVFC mediaTime (or
            // video.currentTime) + the session offset. Normal play was never
            // affected because the manual clock isn't active there.
            const resolveMediaTime = (video, metadata) => {
                return (metadata?.mediaTime ?? video.currentTime) + (sessionTimeOffsetRef?.current || 0);
            };

            const frame = (_now, metadata) => {
                if (cancelled) return;
                const video = videoRef.current;
                if (video) {
                    evaluate(resolveMediaTime(video, metadata));
                    if (useRVFC) {
                        rvfcHandleRef.current = video.requestVideoFrameCallback(frame);
                    } else {
                        rafHandleRef.current = requestAnimationFrame(() => frame(performance.now()));
                    }
                }
            };

            // ── State flushing on seek ───────────────────────────────────────────
            // `seeking`: flush IMMEDIATELY — clear the active cue the instant a
            // jump starts, so a stale cue from the old position can't linger on
            // screen (a full frame tick could otherwise show old text for one
            // more paint before the loop catches up).
            // `seeked`: the jump has landed — recompute right away from the
            // real post-seek position rather than waiting for the next rVFC/
            // rAF tick, so the correct cue (if any) appears with no visible gap.
            const onSeeking = () => {
                if (activeCueRef.current !== null) {
                    activeCueRef.current = null;
                    setActiveCueTick((x) => x + 1);
                }
            };
            const onSeeked = () => {
                const video = videoRef.current;
                if (!video) return;
                evaluate(resolveMediaTime(video, null));
            };
            v.addEventListener("seeking", onSeeking);
            v.addEventListener("seeked", onSeeked);

            if (useRVFC) {
                rvfcHandleRef.current = v.requestVideoFrameCallback(frame);
            } else {
                rafHandleRef.current = requestAnimationFrame((ts) => frame(ts));
            }

            detachRef.current = () => {
                v.removeEventListener("seeking", onSeeking);
                v.removeEventListener("seeked", onSeeked);
                if (useRVFC && rvfcHandleRef.current != null && typeof v.cancelVideoFrameCallback === "function") {
                    v.cancelVideoFrameCallback(rvfcHandleRef.current);
                }
                if (rafHandleRef.current != null) cancelAnimationFrame(rafHandleRef.current);
            };
        };

        start();

        return () => {
            cancelled = true;
            if (retryHandle != null) clearTimeout(retryHandle);
            if (detachRef.current) {
                detachRef.current();
                detachRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [videoRef, displayCues, subtitleDelay, subtitleSpeed, AV_LAG_SEC, sessionTimeOffsetRef, manualClockRef]);

    // eslint-disable-next-line react-hooks/exhaustive-deps
    const activeCue = useMemo(() => activeCueRef.current, [activeCueTick]);

    // TEMPORARY — logs whenever the SELECTED cue actually changes (not
    // every render), and whether it's currently allowed to render (gate).
    // REWRITTEN: previous version logged the OLD `mediaTime` local clock,
    // which activeCue no longer even uses — misleading. Now logs every
    // number that actually feeds the decision (currentTime, AV_LAG_SEC,
    // the computed comparison value t, and the matched cue's real start/
    // end from the parsed file) so a real discrepancy can be READ directly
    // off the console instead of inferred from server-side probes that
    // may not even share the same timestamp domain.
    const lastLoggedCueRef = useRef(undefined);
    useEffect(() => {
        const key = activeCue ? `${activeCue.start}-${activeCue.end}` : null;
        if (key === lastLoggedCueRef.current) return;
        lastLoggedCueRef.current = key;
        const gated = isResumeSyncing || sessionTransitioning || !subtitlesStable;
        const speedFactor = (subtitleSpeed || 100) / 100;
        const t = currentTime * speedFactor - (subtitleDelay || 0) / 1000 - AV_LAG_SEC;
        // eslint-disable-next-line no-console
        console.log(
            `[SUBSYNC] event=${activeCue ? "SHOW" : "HIDE"} ` +
                `currentTime=${currentTime.toFixed(3)} AV_LAG_SEC=${AV_LAG_SEC.toFixed(3)} t(compared)=${t.toFixed(3)} ` +
                `cueStart=${activeCue?.start ?? "-"} cueEnd=${activeCue?.end ?? "-"} ` +
                `gated=${gated} willRender=${!!(activeCue && !gated)} text="${(activeCue?.text || "").slice(0, 50)}"`,
        );
    }, [activeCue, currentTime, AV_LAG_SEC, isResumeSyncing, sessionTransitioning, subtitlesStable, subtitleDelay, subtitleSpeed]);
    // END TEMPORARY

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
    const dragRef = useRef({ active: false, mode: null, startX: 0, startY: 0, startMargin: 0 });
    const SWIPE_THRESHOLD_PX = 30;
    const AXIS_DECIDE_PX = 8; // ignore jitter smaller than this before committing to an axis
    const MAX_BOTTOM_MARGIN = 150; // matches the Bottom Margins slider's own max in the Customization panel
    const INDICATOR_HOLD_MS = 2000; // how long an indicator stays fully visible once idle
    const INDICATOR_FADE_MS = 300; // must match the CSS transition duration below
    // Drives the slide-in animation direction; null = no animation (normal
    // playback advancing to the next line naturally, not via swipe).
    const [slideDir, setSlideDir] = useState(null);
    const slideTimerRef = useRef(null);

    // Pinch-to-resize is now handled entirely by PlayerGestures.jsx (see its
    // own comment on subtitlePinchStart) — it checks actual touch-point
    // coordinates against this element's rect, which is the only reliable
    // way to catch a pinch whose second finger lands outside this thin,
    // single-line-height hit box. This component just watches
    // subtitleScale for changes and flashes the "Aa NN%" indicator —
    // no touch handling of its own needed here anymore.
    const [scaleIndicator, setScaleIndicator] = useState(null); // number (%) briefly after a change, else null once fully faded
    const scaleHideRef = useRef(null);
    const scaleClearRef = useRef(null);
    const prevScaleRef = useRef(subtitleScale);

    // Tap-hold + vertical drag → smoothly reposition the caption up/down,
    // with a live "↕ NNpx" indicator (MX-Player-style). A plain tap (no
    // real movement) instead toggles a translucent blurred background
    // behind the caption for a moment.
    const [posIndicator, setPosIndicator] = useState(null); // number (px) while dragging/settling, else null once fully faded
    const [liveMargin, setLiveMargin] = useState(null); // non-null only while actively dragging
    const posRafRef = useRef(null);
    const posHideRef = useRef(null);
    const posClearRef = useRef(null);
    const [tapHighlight, setTapHighlight] = useState(false);
    const tapHighlightTimerRef = useRef(null);
    // Fade state for the indicator pill — becomes false 2s after the
    // gesture ends, which (via the CSS opacity transition on the pill)
    // fades it out smoothly instead of the old abrupt unmount.
    const [indicatorVisible, setIndicatorVisible] = useState(false);

    // ── Time-based active/nearest cue lookup ─────────────────────────────────
    // Replaces the old `cues.indexOf(activeCue)` approach, which depended on
    // activeCue (a memoized object) staying reference-identical to something
    // in the current `cues` array — fragile, and the reported bug: after
    // playing on for a long time past an earlier manual swipe, a new swipe
    // needs to target whatever's ACTUALLY near the current video position,
    // not wherever an old index left off. This recomputes fresh from the
    // live currentTime every time it's called.
    //
    // FIX ("random" subtitle on swipe): does a full scan with no early exit
    // and no assumption that cuesList is perfectly sorted by start time —
    // real-world SRT files aren't always strictly ordered (fan-subs/edited
    // files especially), and the previous version's sorted-array assumption
    // (both the early-`break` scan AND using array position ± 1 as "next
    // line") could land on the wrong entry whenever that assumption didn't
    // hold, which is exactly what "random-feeling" jumps would look like.
    function findCueIndexNearTime(cuesList, t) {
        let exactIdx = -1;
        let lastBeforeIdx = -1;
        let lastBeforeStart = -Infinity;
        for (let i = 0; i < cuesList.length; i++) {
            const c = cuesList[i];
            if (exactIdx === -1 && t >= c.start && t < c.end) exactIdx = i; // first exact match (handles rare overlaps by preferring earliest)
            if (c.start <= t && c.start > lastBeforeStart) {
                lastBeforeStart = c.start;
                lastBeforeIdx = i; // nearest "already started" cue, regardless of array order
            }
        }
        if (exactIdx !== -1) return { index: exactIdx, isExactMatch: true };
        return { index: lastBeforeIdx, isExactMatch: false }; // gap — no cue's window contains t
    }

    // Finds the cue whose start time is the nearest one strictly after (dir=1)
    // or strictly before (dir=-1) referenceStart — i.e. true CHRONOLOGICAL
    // neighbor by timestamp, not "whatever's at array position ± 1". This is
    // what actually fixes the "random subtitle" bug: array position only
    // equals chronological order if cuesList happens to be perfectly sorted,
    // which isn't a safe assumption for real SRT files.
    function findAdjacentCueIndex(cuesList, referenceStart, dir) {
        let bestIdx = -1;
        let bestStart = dir > 0 ? Infinity : -Infinity;
        for (let i = 0; i < cuesList.length; i++) {
            const s = cuesList[i].start;
            if (dir > 0 && s > referenceStart && s < bestStart) {
                bestStart = s;
                bestIdx = i;
            } else if (dir < 0 && s < referenceStart && s > bestStart) {
                bestStart = s;
                bestIdx = i;
            }
        }
        return bestIdx;
    }

    function jumpToCueIndex(cuesList, targetIndex, speedFactor, delaySec) {
        if (targetIndex < 0 || targetIndex >= cuesList.length) return; // at the first/last line — no-op
        const target = cuesList[targetIndex];
        // Land a hair inside the cue's window (not exactly .start) so the
        // activeCue lookup above reliably resolves to THIS cue right after
        // the seek, even with normal seek/timeupdate jitter.
        const insidePad = Math.min(0.05, (target.end - target.start) / 4);
        // FIX: inverse of activeCue's transform, including the same fixed
        // AV_LAG_SEC correction — without matching it here, jumping to a
        // cue via swipe would land at a spot that activeCue's OWN lookup
        // (shifted by this same amount) wouldn't immediately resolve back
        // to this cue.
        const videoTime = Math.max(0, (target.start + insidePad + delaySec + AV_LAG_SEC) / speedFactor);
        if (videoRef?.current) videoRef.current.currentTime = Math.max(0, videoTime - (sessionTimeOffsetRef?.current || 0));
        actions.setCurrentTime(videoTime);
        // FIX: PlayerPage.jsx's manualClockRef, while active during a
        // quality-switch/resume transition, ticks every 200ms and
        // unconditionally overwrites state.currentTime with its own stale
        // extrapolated value — without resyncing it here, this swipe's
        // seek would get silently stomped the same way PlayerGestures.jsx's
        // seekBy was.
        if (manualClockRef?.current?.active) {
            manualClockRef.current.baseX = videoTime;
            manualClockRef.current.baseTime = Date.now();
        }
    }

    function handleSubtitlePointerDown(e) {
        e.stopPropagation();
        // FIX (gesture conflict): lock immediately, synchronously, before
        // PlayerGestures' own native touchstart handler runs — pointerdown
        // fires before touchstart for the same physical touch, so this
        // wins the race regardless of DOM hit-test width quirks.
        lockGesture();
        dragRef.current = { active: true, mode: null, startX: e.clientX, startY: e.clientY, startMargin: subtitleBottomMargin || 0 };
    }

    function handleSubtitlePointerMove(e) {
        if (!dragRef.current.active) return;
        const dX = e.clientX - dragRef.current.startX;
        const dY = e.clientY - dragRef.current.startY;

        // Commit to an axis once real movement starts — a mostly-vertical
        // drag repositions the caption, a mostly-horizontal one skips
        // dialogue lines (existing gesture, decided here now instead of at
        // pointerup so the two can't fight mid-gesture).
        if (dragRef.current.mode === null) {
            if (Math.abs(dX) < AXIS_DECIDE_PX && Math.abs(dY) < AXIS_DECIDE_PX) return;
            dragRef.current.mode = Math.abs(dY) > Math.abs(dX) * 1.3 ? "vertical" : "horizontal";
            if (dragRef.current.mode === "vertical") {
                clearTimeout(posHideRef.current);
                clearTimeout(posClearRef.current);
                setIndicatorVisible(true);
            }
        }

        if (dragRef.current.mode === "vertical") {
            // FIX (reversed direction): dragging the finger UP the screen
            // (negative dY, since screen Y increases downward) must
            // INCREASE the margin (moves the caption further from the
            // bottom edge, i.e. up); dragging DOWN (positive dY) decreases
            // it. That's startMargin MINUS dY, not plus — verified by
            // elimination: the previous "+dY" version produced exactly the
            // reported bug (up→down, down→up).
            const newMargin = Math.max(0, Math.min(MAX_BOTTOM_MARGIN, Math.round(dragRef.current.startMargin - dY)));
            setLiveMargin(newMargin); // instant — drives THIS component's own render
            setPosIndicator(newMargin);
            // Throttled to once per frame — keeps the Customization panel's
            // slider live-synced without dispatching on every touchmove.
            if (posRafRef.current == null) {
                posRafRef.current = requestAnimationFrame(() => {
                    posRafRef.current = null;
                    actions.setSubtitleCustom({ subtitleBottomMargin: newMargin });
                });
            }
        }
    }

    function handleSubtitlePointerUp(e) {
        if (!dragRef.current.active) return;
        e.stopPropagation();
        const mode = dragRef.current.mode;
        dragRef.current.active = false;
        unlockGesture();

        if (mode === "vertical") {
            if (posRafRef.current != null) {
                cancelAnimationFrame(posRafRef.current);
                posRafRef.current = null;
            }
            // Final commit — guarantees the last value lands even if it
            // arrived between animation frames.
            if (liveMargin !== null) actions.setSubtitleCustom({ subtitleBottomMargin: liveMargin });
            setLiveMargin(null);
            // Stay fully visible for INDICATOR_HOLD_MS, then fade out
            // smoothly (CSS opacity transition) instead of vanishing.
            clearTimeout(posHideRef.current);
            clearTimeout(posClearRef.current);
            posHideRef.current = setTimeout(() => {
                setIndicatorVisible(false);
                posClearRef.current = setTimeout(() => setPosIndicator(null), INDICATOR_FADE_MS);
            }, INDICATOR_HOLD_MS);
            return;
        }

        if (mode === "horizontal") {
            const dX = e.clientX - dragRef.current.startX;
            if (Math.abs(dX) < SWIPE_THRESHOLD_PX) return; // resolved horizontal but too small to count as a real skip

            const speedFactor = (subtitleSpeed || 100) / 100;
            const delaySec = (subtitleDelay || 0) / 1000;
            // Same time transform the activeCue memo uses (including the
            // fixed AV_LAG_SEC correction) — recomputed fresh from the LIVE
            // currentTime right now, not derived from any earlier
            // gesture's result. Uses `currentTime` (state) for the same
            // single-clock reason activeCue does now — see its comment.
            const tNow = currentTime * speedFactor - delaySec - AV_LAG_SEC;
            const { index, isExactMatch } = findCueIndexNearTime(cues, tNow);
            // right→left (dX < 0) = forward/next line; left→right (dX > 0) = backward/previous line.
            const goingForward = dX < 0;

            if (index === -1 && !isExactMatch) {
                // Before the very first cue entirely — only "next" (→ chronologically first cue) makes sense.
                if (!goingForward) return;
                const firstIdx = findAdjacentCueIndex(cues, -Infinity, 1);
                if (firstIdx === -1) return;
                clearTimeout(slideTimerRef.current);
                setSlideDir("fwd");
                slideTimerRef.current = setTimeout(() => setSlideDir(null), 260);
                jumpToCueIndex(cues, firstIdx, speedFactor, delaySec);
                return;
            }

            let targetIndex;
            if (isExactMatch) {
                targetIndex = findAdjacentCueIndex(cues, cues[index].start, goingForward ? 1 : -1);
            } else {
                // In a gap: "next" is the nearest UPCOMING cue by timestamp
                // (the one right after this gap); "previous" is the nearest
                // cue that already passed (index itself — the last one that
                // started, already found above).
                targetIndex = goingForward ? findAdjacentCueIndex(cues, cues[index].start, 1) : index;
            }
            if (targetIndex === -1) return; // already at the first/last chronological line

            clearTimeout(slideTimerRef.current);
            setSlideDir(goingForward ? "fwd" : "back");
            slideTimerRef.current = setTimeout(() => setSlideDir(null), 260);
            jumpToCueIndex(cues, targetIndex, speedFactor, delaySec);
            return;
        }

        // mode still null → negligible movement → a plain tap. Toggle the
        // translucent blur behind the caption for a moment.
        setTapHighlight(true);
        clearTimeout(tapHighlightTimerRef.current);
        tapHighlightTimerRef.current = setTimeout(() => setTapHighlight(false), INDICATOR_HOLD_MS);
    }

    function handleSubtitlePointerCancel() {
        dragRef.current.active = false;
        unlockGesture();
        if (posRafRef.current != null) {
            cancelAnimationFrame(posRafRef.current);
            posRafRef.current = null;
        }
        setLiveMargin(null);
    }

    // Flashes the "Aa NN%" indicator whenever subtitleScale actually changes
    // — from a pinch (now handled entirely by PlayerGestures.jsx) or the
    // Customization panel's slider, either way. Skips the very first mount
    // so opening the player doesn't immediately flash the indicator.
    useEffect(() => {
        if (prevScaleRef.current === subtitleScale) return;
        prevScaleRef.current = subtitleScale;
        setScaleIndicator(Math.round(subtitleScale || 100));
        setIndicatorVisible(true);
        clearTimeout(scaleHideRef.current);
        clearTimeout(scaleClearRef.current);
        scaleHideRef.current = setTimeout(() => {
            setIndicatorVisible(false);
            scaleClearRef.current = setTimeout(() => setScaleIndicator(null), INDICATOR_FADE_MS);
        }, INDICATOR_HOLD_MS);
    }, [subtitleScale]);

    // Safety net: if the active cue changes mid-gesture (playback moves past
    // its end during a slow drag/pinch) this component can unmount before
    // pointerup/touchend ever fires, which would leave the lock stuck on forever.
    useEffect(() => {
        return () => {
            unlockGesture();
            if (posRafRef.current != null) cancelAnimationFrame(posRafRef.current);
            clearTimeout(slideTimerRef.current);
            clearTimeout(posHideRef.current);
            clearTimeout(posClearRef.current);
            clearTimeout(scaleHideRef.current);
            clearTimeout(scaleClearRef.current);
            clearTimeout(tapHighlightTimerRef.current);
        };
    }, []);

    // Gate: isResumeSyncing (PlayerPage's own isSeekingToResume flag, gates
    // the "Preparing your stream" overlay too) OR !subtitlesStable (derived
    // fresh every render straight from the video element — see the useMemo
    // above; not stored state, so there's nothing here that can get stuck
    // true or cleared too early by event-ordering races).
    const otherGatesActive = isResumeSyncing || sessionTransitioning || !subtitlesStable;
    // FIX: these gates all clear the instant the SEEK itself settles — none
    // of them know or care whether avGapSecRef (the real, per-session
    // measured audio-video gap; see PlayerPage.jsx's heartbeat ping) has
    // actually arrived yet. That value can take up to ~1-3s to reach the
    // client after a resume, and production logs have shown it as large as
    // ~8s for a single file/session (dual-audio, audio_transcode path) —
    // rendering cues with AV_LAG_SEC still stuck at its default 0 during
    // that window is exactly "subtitle totally mismatched / random timing"
    // right after resume: every cue is off by the full uncorrected gap
    // until the ramp (SubtitleRenderer's own avGapSecRef effect) catches
    // up. GAP_GRACE_MS_CAP bounds this so direct-play/no-ping sessions
    // (avGapSecRef never populates — there's no HLS ping for them) don't
    // hold the gate forever; they simply pay this one small, one-time delay
    // per session/resume and then render normally like before.
    const avGapKnown = !APPLY_AV_GAP_CORRECTION || (typeof avGapSecRef?.current === "number" && Number.isFinite(avGapSecRef.current));
    const GAP_GRACE_MS_CAP = 1500;
    if (otherGatesActive) {
        gapGraceStartRef.current = null;
    } else if (!avGapKnown) {
        if (gapGraceStartRef.current == null) gapGraceStartRef.current = Date.now();
    } else {
        gapGraceStartRef.current = null;
    }
    const inGapGrace = !otherGatesActive && !avGapKnown && gapGraceStartRef.current != null && Date.now() - gapGraceStartRef.current < GAP_GRACE_MS_CAP;
    const gateActive = otherGatesActive || inGapGrace;
    if (gateActive) {
        if (gateActiveSinceRef.current == null) gateActiveSinceRef.current = Date.now();
    } else {
        gateActiveSinceRef.current = null;
    }
    const gateStuckTooLong = gateActive && gateActiveSinceRef.current != null && Date.now() - gateActiveSinceRef.current > 10000;
    if (gateActive && !gateStuckTooLong) return null;
    if (!activeSubtitle || !activeCue) return null;

    // REGRESSION 3 FIX (kept): 0 = true bottom edge, user's margin setting
    // is respected exactly at rest — no hidden baked-in offset.
    //
    // RESTORED (older behavior, layered back on top): when the control bar
    // is visible, lift the caption an extra CONTROLS_LIFT_PX above the
    // user's resting position so it clears the seek bar, and smoothly
    // settle back down to the resting position once controls fade out —
    // exactly like before, just additive to the user's own margin instead
    // of replacing/hiding it. Disabled while actively dragging (liveMargin
    // set) so the drag itself still tracks the finger 1:1 with no lag.
    const CONTROLS_LIFT_PX = 56;
    const effectiveBottomMargin = liveMargin !== null ? liveMargin : subtitleBottomMargin || 0;
    const controlsLift = liveMargin === null && controlsVisible ? CONTROLS_LIFT_PX : 0;
    const bottomOffset = `${effectiveBottomMargin + controlsLift}px`;

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

    // Pinch-to-resize is handled by PlayerGestures.jsx now (see its own
    // subtitlePinchStart comment) — it dispatches straight to subtitleScale,
    // so this just reads it directly, no local override needed.
    const scaledFontSize = ((subtitleFontSize || 20) * (subtitleScale || 100)) / 100;

    return (
        <div
            className="flux-subtitle-container"
            data-gesture-exclude="true"
            onPointerDown={handleSubtitlePointerDown}
            onPointerMove={handleSubtitlePointerMove}
            onPointerUp={handleSubtitlePointerUp}
            onPointerCancel={handleSubtitlePointerCancel}
            style={{
                bottom: bottomOffset,
                transition: liveMargin === null ? "bottom 220ms ease" : "none",
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
                position: "absolute",
                // "Panel" mode additionally gives it an opaque background bar.
                ...(subtitlePanelMode ? { background: "rgba(0,0,0,0.85)", padding: "8px 0" } : {}),
                // "Fit subtitles into video size" constrains the caption box
                // to the video frame's own width rather than the full player.
                ...(subtitleFitToVideo ? { maxWidth: "100%" } : {}),
            }}>
            <style>{SLIDE_ANIMATION_CSS}</style>

            {/* ── Live gesture indicators: vertical drag (reposition) and pinch (resize) ── */}
            {(posIndicator !== null || scaleIndicator !== null) && (
                <div
                    style={{
                        position: "absolute",
                        bottom: "100%",
                        left: "50%",
                        transform: "translateX(-50%)",
                        marginBottom: 14,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        color: "#fff",
                        fontWeight: 700,
                        fontSize: 22,
                        textShadow: "0 1px 6px rgba(0,0,0,0.8), 0 0 2px rgba(0,0,0,0.6)",
                        whiteSpace: "nowrap",
                        pointerEvents: "none",
                        opacity: indicatorVisible ? 1 : 0,
                        transition: `opacity ${INDICATOR_FADE_MS}ms ease`,
                    }}>
                    {posIndicator !== null ? (
                        <>
                            <span>↕</span>
                            {posIndicator}
                        </>
                    ) : (
                        <>
                            <span>Aa</span>
                            {scaleIndicator}%
                        </>
                    )}
                </div>
            )}

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
                    // Tap-to-highlight: a translucent blurred backdrop behind
                    // the caption, independent of the user's own
                    // subtitleBackgroundEnabled setting (that one is a
                    // persistent style choice; this is a momentary tap
                    // affordance) — layered on top when both are active.
                    background: tapHighlight
                        ? "rgba(0,0,0,0.45)"
                        : subtitleBackgroundEnabled
                          ? `${subtitleBackgroundColor}${Math.round((subtitleBgOpacity ?? 0.72) * 255)
                                .toString(16)
                                .padStart(2, "0")}`
                          : "transparent",
                    backdropFilter: tapHighlight ? "blur(6px)" : "none",
                    WebkitBackdropFilter: tapHighlight ? "blur(6px)" : "none",
                    transition: "background 220ms ease, backdrop-filter 220ms ease",
                    padding: tapHighlight || subtitleBackgroundEnabled ? "2px 8px" : 0,
                    borderRadius: tapHighlight || subtitleBackgroundEnabled ? 4 : 0,
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
