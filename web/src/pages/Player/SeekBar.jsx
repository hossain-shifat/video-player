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

// Compute buffered percentage from TimeRanges covering currentTime
function getBufferedPct(buffered, duration, currentTime) {
    if (!buffered || !duration || !buffered.length) return 0;
    for (let i = 0; i < buffered.length; i++) {
        if (buffered.start(i) <= currentTime && buffered.end(i) >= currentTime) {
            return (buffered.end(i) / duration) * 100;
        }
    }
    // Fallback: use the furthest buffered end
    let maxEnd = 0;
    for (let i = 0; i < buffered.length; i++) {
        if (buffered.end(i) > maxEnd) maxEnd = buffered.end(i);
    }
    return (maxEnd / duration) * 100;
}

/**
 * SeekBar — premium seek bar with buffered visualization,
 * hover timestamp tooltip, animated thumb, and smooth scrubbing.
 */
const SeekBar = memo(function SeekBar({ videoRef }) {
    const { state, actions } = usePlayerState();
    const barRef       = useRef(null);
    const thumbRef     = useRef(null);
    const dragging     = useRef(false);
    const [isDragging, setIsDragging] = useState(false);
    const [hoverInfo, setHoverInfo]   = useState(null); // { time, x }
    const [isHovered, setIsHovered]   = useState(false);
    const rafRef = useRef(null);

    const getTimeFromClientX = useCallback((clientX) => {
        const rect = barRef.current?.getBoundingClientRect();
        if (!rect || !state.duration) return 0;
        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        return pct * state.duration;
    }, [state.duration]);

    const applySeek = useCallback((clientX) => {
        const t = getTimeFromClientX(clientX);
        if (!isFinite(t) || isNaN(t)) return;
        // Direct DOM mutation for zero-latency feel during drag
        if (videoRef.current) videoRef.current.currentTime = t;
        actions.setCurrentTime(t);
    }, [getTimeFromClientX, videoRef, actions]);

    const getClientX = (e) => e.touches?.[0]?.clientX ?? e.clientX;

    // ── Pointer down (start drag) ────────────────────────────────────────────
    const onPointerDown = useCallback((e) => {
        e.preventDefault();
        dragging.current = true;
        setIsDragging(true);
        applySeek(getClientX(e));
    }, [applySeek]);

    // ── Mouse move for hover tooltip (non-drag) ──────────────────────────────
    const onMouseMove = useCallback((e) => {
        if (!isHovered && !dragging.current) return;
        const rect = barRef.current?.getBoundingClientRect();
        if (!rect || !state.duration) return;
        const x = e.clientX - rect.left;
        const clampedX = Math.max(0, Math.min(rect.width, x));
        const t = (clampedX / rect.width) * state.duration;
        setHoverInfo({ time: t, x: clampedX });
        if (dragging.current) applySeek(e.clientX);
    }, [isHovered, state.duration, applySeek]);

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
        window.addEventListener("mouseup",    onUp,   { passive: true });
        window.addEventListener("touchend",   onUp,   { passive: true });
        window.addEventListener("mousemove",  onMove, { passive: true });
        window.addEventListener("touchmove",  onMove, { passive: false });
        return () => {
            window.removeEventListener("mouseup",   onUp);
            window.removeEventListener("touchend",  onUp);
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("touchmove", onMove);
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
    }, [applySeek, state.duration]);

    const playedPct   = state.duration ? (state.currentTime / state.duration) * 100 : 0;
    const bufferedPct = getBufferedPct(state.buffered, state.duration, state.currentTime);
    const showThumb   = isHovered || isDragging;

    return (
        <div
            className="flux-seek-root"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => { setIsHovered(false); setHoverInfo(null); }}
            onMouseMove={onMouseMove}
            onMouseDown={onPointerDown}
            onTouchStart={onPointerDown}
        >
            {/* Hover tooltip */}
            {hoverInfo !== null && state.duration > 0 && (
                <div
                    className="flux-seek-tooltip"
                    style={{ left: hoverInfo.x }}
                >
                    {formatTime(hoverInfo.time)}
                </div>
            )}

            {/* Track */}
            <div
                ref={barRef}
                className={`flux-seek-track ${isDragging ? "dragging" : ""}`}
            >
                {/* Buffered */}
                <div
                    className="flux-seek-buffered"
                    style={{ width: `${bufferedPct}%` }}
                />
                {/* Played */}
                <div
                    className="flux-seek-played"
                    style={{ width: `${playedPct}%` }}
                />
            </div>

            {/* Thumb */}
            <div
                ref={thumbRef}
                className={`flux-seek-thumb ${showThumb ? "active" : ""} ${isDragging ? "dragging" : ""}`}
                style={{ left: `${playedPct}%` }}
            />
        </div>
    );
});

export default SeekBar;
