import { useEffect, useRef, useState, useCallback, memo } from "react";
import { usePlayerState } from "./UsePlayerState";

function formatTime(secs) {
    if (!secs || !isFinite(secs) || isNaN(secs)) return "0:00";
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
}

// Finds the buffered range relevant to currentTime and returns its absolute
// start/end as percentages of duration.
// FIX (buffered bar shows starting from 0:00 instead of from where the
// buffered content actually starts, e.g. after a resume): this used to only
// return a single "end" percentage, and the bar was always rendered with
// left:0 + that width — i.e. it could only ever represent "buffered from
// 0:00 to X", which happens to be true for a normal fresh play (buffering
// naturally starts at the beginning) but is WRONG after a resume — the
// backend seeks ffmpeg to start encoding near the resume position (see
// PlayerPage.jsx's seekSec fix), so the actual buffered content genuinely
// starts near there, not at 0:00. Returning both edges lets the bar be
// positioned with left+width instead of assuming left is always 0.
//
// buffered.start(i)/end(i) are reported in the CURRENT session's own
// relative timeline (same session-relative issue currentTime had) — adding
// sessionOffset converts them to absolute before computing percentages.
function getBufferedRange(buffered, duration, currentTime, sessionOffset = 0) {
    if (!buffered || !duration || !buffered.length) return { startPct: 0, endPct: 0 };

    // Prefer the range that actually covers currentTime.
    for (let i = 0; i < buffered.length; i++) {
        const start = buffered.start(i) + sessionOffset;
        const end = buffered.end(i) + sessionOffset;
        if (start <= currentTime && end >= currentTime) {
            return { startPct: (start / duration) * 100, endPct: (end / duration) * 100 };
        }
    }

    // Fallback: no range covers currentTime exactly (e.g. still landing
    // right after a seek) — use whichever range reaches furthest.
    let best = null;
    for (let i = 0; i < buffered.length; i++) {
        const start = buffered.start(i) + sessionOffset;
        const end = buffered.end(i) + sessionOffset;
        if (!best || end > best.end) best = { start, end };
    }
    if (!best) return { startPct: 0, endPct: 0 };
    return { startPct: (best.start / duration) * 100, endPct: (best.end / duration) * 100 };
}

/**
 * SeekBar — premium seek bar with buffered visualization,
 * hover timestamp tooltip, animated thumb, and smooth scrubbing.
 */
const SeekBar = memo(function SeekBar({ videoRef, sessionTimeOffsetRef }) {
    const { state, actions } = usePlayerState();
    const barRef = useRef(null);
    const thumbRef = useRef(null);
    const dragging = useRef(false);
    const [isDragging, setIsDragging] = useState(false);
    const [hoverInfo, setHoverInfo] = useState(null); // { time, x }
    const [isHovered, setIsHovered] = useState(false);
    const rafRef = useRef(null);

    const getTimeFromClientX = useCallback(
        (clientX) => {
            const rect = barRef.current?.getBoundingClientRect();
            if (!rect || !state.duration) return 0;
            const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            return pct * state.duration;
        },
        [state.duration],
    );

    const applySeek = useCallback(
        (clientX) => {
            const t = getTimeFromClientX(clientX);
            if (!isFinite(t) || isNaN(t)) return;
            // FIX: t here is always an ABSOLUTE position (state.duration is
            // the real full-file length). But if a quality-switch session
            // restart is currently loaded, the video element's own
            // currentTime is relative to THAT session's timeline (see
            // VideoCore.jsx's handleTimeUpdate comment for the full why) —
            // assigning the raw absolute t directly would seek to the wrong
            // spot the same way the original restore bug did.
            const v = videoRef.current;
            if (v) v.currentTime = Math.max(0, t - (sessionTimeOffsetRef?.current || 0));
            actions.setCurrentTime(t);

            // ADD (subtitle not matching after a mid-playback seek):
            // seeking to a position outside the currently-buffered HLS
            // segments silently restarts the backend transcode session
            // with a NEW segment-numbering baseline (see streamController.
            // js's serveHLSFile "backward seek... restart" handling) —
            // nothing on the client is told this happened, so
            // sessionTimeOffsetRef keeps using the OLD session's offset
            // for a video that's now actually playing from a different
            // session. This never mattered for small in-buffer seeks
            // (no restart happens, offset stays valid) — only for seeks
            // landing outside what's currently cached.
            //
            // One-shot: wait for this specific seek to actually land
            // (native 'seeked'), then recalibrate the offset from where
            // the video REALLY ended up vs. the absolute position `t` we
            // asked for — the exact same self-correcting math the resume
            // flow already uses once its own seek lands. If no restart
            // happened, v.currentTime already equals what was assigned
            // above and this recalibrates to the SAME value — a safe
            // no-op, not a second, competing correction.
            if (v && sessionTimeOffsetRef) {
                const onSeeked = () => {
                    sessionTimeOffsetRef.current = t - v.currentTime;
                };
                v.addEventListener("seeked", onSeeked, { once: true });
            }
        },
        [getTimeFromClientX, videoRef, actions, sessionTimeOffsetRef],
    );

    const getClientX = (e) => e.touches?.[0]?.clientX ?? e.clientX;

    // ── Pointer down (start drag) ────────────────────────────────────────────
    const onPointerDown = useCallback(
        (e) => {
            e.preventDefault();
            dragging.current = true;
            setIsDragging(true);
            applySeek(getClientX(e));
        },
        [applySeek],
    );

    // ── Mouse move for hover tooltip (non-drag) ──────────────────────────────
    const onMouseMove = useCallback(
        (e) => {
            if (!isHovered && !dragging.current) return;
            const rect = barRef.current?.getBoundingClientRect();
            if (!rect || !state.duration) return;
            const x = e.clientX - rect.left;
            const clampedX = Math.max(0, Math.min(rect.width, x));
            const t = (clampedX / rect.width) * state.duration;
            setHoverInfo({ time: t, x: clampedX });
            if (dragging.current) applySeek(e.clientX);
        },
        [isHovered, state.duration, applySeek],
    );

    // ── Global pointer up / move for drag outside bar ────────────────────────
    useEffect(() => {
        const onUp = (e) => {
            if (!dragging.current) return;
            applySeek(getClientX(e));
            dragging.current = false;
            setIsDragging(false);
        };
        const onMove = (e) => {
            if (!dragging.current) return;
            // Throttle via rAF for performance
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(() => {
                applySeek(getClientX(e));
                // Update hover info for tooltip during drag
                const rect = barRef.current?.getBoundingClientRect();
                if (rect && state.duration) {
                    const cx = getClientX(e);
                    const x = Math.max(0, Math.min(rect.width, cx - rect.left));
                    const t = (x / rect.width) * state.duration;
                    setHoverInfo({ time: t, x });
                }
            });
        };
        window.addEventListener("mouseup", onUp, { passive: true });
        window.addEventListener("touchend", onUp, { passive: true });
        window.addEventListener("mousemove", onMove, { passive: true });
        window.addEventListener("touchmove", onMove, { passive: false });
        return () => {
            window.removeEventListener("mouseup", onUp);
            window.removeEventListener("touchend", onUp);
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("touchmove", onMove);
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
    }, [applySeek, state.duration]);

    const playedPct = state.duration ? (state.currentTime / state.duration) * 100 : 0;
    const { endPct: bufferedEndPct } = getBufferedRange(state.buffered, state.duration, state.currentTime, sessionTimeOffsetRef?.current || 0);
    // ADD: thumb always visible (was hover/drag only). Grows on hover/drag.
    const thumbScale = isDragging ? 1.4 : isHovered ? 1.2 : 1;

    return (
        <div
            className="flux-seek-root"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => {
                setIsHovered(false);
                setHoverInfo(null);
            }}
            onMouseMove={onMouseMove}
            onMouseDown={onPointerDown}
            onTouchStart={onPointerDown}>
            {/* Hover tooltip */}
            {hoverInfo !== null && state.duration > 0 && (
                <div className="flux-seek-tooltip" style={{ left: hoverInfo.x }}>
                    {formatTime(hoverInfo.time)}
                </div>
            )}

            {/* Track */}
            <div ref={barRef} className={`flux-seek-track ${isDragging ? "dragging" : ""}`}>
                {/* Buffered — total width = played + buffer loaded ahead,
                    always anchored at left:0 (bufferedEndPct already IS
                    played + additional buffer, mathematically). */}
                <div
                    className="flux-seek-buffered"
                    style={{
                        width: `${Math.max(0, Math.min(100, bufferedEndPct || 0))}%`,
                        // FIX: width computes to ~0 (visually invisible)
                        // whenever playback has caught right up to the edge
                        // of what's loaded — a thin-buffer margin, not "no
                        // buffer at all". As long as there IS any buffered
                        // data (bufferedEndPct > 0), keep a small visible
                        // marker instead of letting it fully vanish.
                        minWidth: (bufferedEndPct || 0) > 0 ? "3px" : 0,
                        transition: "width 400ms ease-out",
                    }}
                />
                {/* Played */}
                <div className="flux-seek-played" style={{ width: `${Math.max(0, Math.min(100, playedPct || 0))}%` }} />
            </div>

            {/* Thumb */}
            <div
                ref={thumbRef}
                className={`flux-seek-thumb active ${isDragging ? "dragging" : ""}`}
                style={{
                    left: `${Math.max(0, Math.min(100, playedPct || 0))}%`,
                    position: "absolute",
                    top: "50%",
                    width: 13,
                    height: 13,
                    borderRadius: "50%",
                    // Red outer circle, white inner circle (thin red ring).
                    background: "#fff",
                    border: "2px solid var(--primary, #e50914)",
                    boxSizing: "border-box",
                    boxShadow: "none",
                    opacity: 1,
                    pointerEvents: "none",
                    transform: `translate(-50%, -50%) scale(${thumbScale})`,
                    transition: isDragging ? "none" : "transform 120ms ease-out",
                    zIndex: 2,
                }}
            />
        </div>
    );
});

export default SeekBar;
