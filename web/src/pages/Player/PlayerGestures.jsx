import { useEffect, useRef, useCallback } from "react";
import { usePlayerState } from "./UsePlayerState";

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

/**
 * PlayerGestures — renderless component
 *
 * Handles ALL input outside the controls bar:
 *   • Keyboard shortcuts (desktop)
 *   • Touch gestures: double-tap seek, swipe volume/brightness/seek, long-press speed boost
 *   • Pinch-to-zoom video scaling
 *   • Fullscreen / PiP lifecycle
 *
 * Exposes toggleFullscreen + togglePiP + cycleSpeed on containerRef._xxx
 * so PlayerControls can call them without prop drilling.
 */
export default function PlayerGestures({ videoRef, containerRef, overlayTriggers, setOverlayState, showControls }) {
    const { state, actions } = usePlayerState();
    const isMobileRef = useRef(false);
    const longPressTimer = useRef(null);
    const speedBoostActive = useRef(false);
    const lastTap = useRef({ time: 0, side: null });
    const dragStart = useRef(null);
    const pinchStart = useRef(null);
    const scaleRef = useRef(1);

    const { triggerBrightness, triggerVolume, triggerSeek, triggerSpeedBoost, triggerAudioTrack } = overlayTriggers;

    // Detect mobile/touch device
    useEffect(() => {
        const check = () => {
            isMobileRef.current = window.innerWidth < 1024 || navigator.maxTouchPoints > 0;
        };
        check();
        window.addEventListener("resize", check);
        return () => window.removeEventListener("resize", check);
    }, []);

    // ── Fullscreen ────────────────────────────────────────────────────────────

    const toggleFullscreen = useCallback(() => {
        const el = containerRef.current;
        if (!el) return;
        if (!document.fullscreenElement) {
            el.requestFullscreen?.()
                .then(() => {
                    screen.orientation?.lock?.("landscape").catch(() => {});
                    actions.setFullscreen(true);
                })
                .catch(() => {});
        } else {
            document
                .exitFullscreen?.()
                .then(() => {
                    screen.orientation?.unlock?.();
                    actions.setFullscreen(false);
                })
                .catch(() => {});
        }
    }, [containerRef, actions]);

    // Sync fullscreen state from browser events (user presses Esc etc.)
    useEffect(() => {
        const onChange = () => {
            actions.setFullscreen(!!document.fullscreenElement);
        };
        document.addEventListener("fullscreenchange", onChange);
        return () => document.removeEventListener("fullscreenchange", onChange);
    }, [actions]);

    // ── Picture-in-Picture ────────────────────────────────────────────────────

    const togglePiP = useCallback(async () => {
        const video = videoRef.current;
        if (!video) return;
        try {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
                actions.setPiP(false);
            } else {
                await video.requestPictureInPicture();
                actions.setPiP(true);
            }
        } catch {}
    }, [videoRef, actions]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        const onEnter = () => actions.setPiP(true);
        const onLeave = () => actions.setPiP(false);
        video.addEventListener("enterpictureinpicture", onEnter);
        video.addEventListener("leavepictureinpicture", onLeave);
        return () => {
            video.removeEventListener("enterpictureinpicture", onEnter);
            video.removeEventListener("leavepictureinpicture", onLeave);
        };
    }, [videoRef, actions]);

    // ── Speed cycle ───────────────────────────────────────────────────────────

    const cycleSpeed = useCallback(
        (dir) => {
            const idx = SPEEDS.indexOf(state.playbackSpeed);
            const next = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, idx + dir))];
            actions.setPlaybackSpeed(next);
        },
        [state.playbackSpeed, actions],
    );

    // ── Audio track cycle ─────────────────────────────────────────────────────

    const cycleAudioTrack = useCallback(() => {
        if (!state.audioTracks.length) return;
        const next = (state.activeAudioTrack + 1) % state.audioTracks.length;
        actions.setActiveAudioTrack(next);
        const name = state.audioTracks[next]?.name || "Track";
        setOverlayState((s) => ({ ...s, audioTrack: name }));
        triggerAudioTrack();
    }, [state.audioTracks, state.activeAudioTrack, actions, setOverlayState, triggerAudioTrack]);

    // ── Keyboard shortcuts ────────────────────────────────────────────────────

    useEffect(() => {
        const onKey = (e) => {
            if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
            const video = videoRef.current;
            if (!video) return;

            switch (e.key) {
                case " ":
                case "k":
                    e.preventDefault();
                    actions.setPlaying(!state.playing);
                    showControls();
                    break;
                case "ArrowLeft":
                    e.preventDefault();
                    {
                        const seekBy = e.shiftKey ? 30 : 10;
                        video.currentTime = Math.max(0, video.currentTime - seekBy);
                        setOverlayState((s) => ({ ...s, seekDir: "backward", seekSec: seekBy }));
                        triggerSeek();
                        showControls();
                    }
                    break;
                case "ArrowRight":
                    e.preventDefault();
                    {
                        const seekBy = e.shiftKey ? 30 : 10;
                        video.currentTime = Math.min(video.duration || 0, video.currentTime + seekBy);
                        setOverlayState((s) => ({ ...s, seekDir: "forward", seekSec: seekBy }));
                        triggerSeek();
                        showControls();
                    }
                    break;
                case "ArrowUp":
                    e.preventDefault();
                    {
                        const newVol = Math.min(1, state.volume + 0.1);
                        actions.setVolume(newVol);
                        if (state.muted) actions.setMuted(false);
                        setOverlayState((s) => ({ ...s, volume: newVol, muted: false }));
                        triggerVolume();
                    }
                    break;
                case "ArrowDown":
                    e.preventDefault();
                    {
                        const newVol = Math.max(0, state.volume - 0.1);
                        actions.setVolume(newVol);
                        setOverlayState((s) => ({ ...s, volume: newVol }));
                        triggerVolume();
                    }
                    break;
                case "f":
                case "F":
                    e.preventDefault();
                    toggleFullscreen();
                    break;
                case "m":
                case "M":
                    e.preventDefault();
                    {
                        const newMuted = !state.muted;
                        actions.setMuted(newMuted);
                        setOverlayState((s) => ({ ...s, muted: newMuted, volume: state.volume }));
                        triggerVolume();
                    }
                    break;
                case "p":
                case "P":
                    e.preventDefault();
                    togglePiP();
                    break;
                case "[":
                    e.preventDefault();
                    cycleSpeed(-1);
                    break;
                case "]":
                    e.preventDefault();
                    cycleSpeed(1);
                    break;
                case "l":
                case "L":
                    e.preventDefault();
                    actions.cycleLoop();
                    break;
                case "a":
                case "A":
                    e.preventDefault();
                    cycleAudioTrack();
                    break;
                default:
                    // 0-9 → jump to % of duration
                    if (e.key >= "0" && e.key <= "9" && !e.ctrlKey && !e.metaKey) {
                        e.preventDefault();
                        if (video.duration) {
                            video.currentTime = video.duration * (parseInt(e.key) / 10);
                        }
                        showControls();
                    }
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.playing, state.volume, state.muted, state.audioTracks, state.activeAudioTrack]);

    // ── Touch zone helper ─────────────────────────────────────────────────────

    const getZone = (x, w) => {
        if (x < w * 0.3) return "left";
        if (x > w * 0.7) return "right";
        return "center";
    };

    // ── Touch handlers ────────────────────────────────────────────────────────

    const handleTouchStart = useCallback(
        (e) => {
            if (state.isLocked) return;
            if (e.touches.length === 2) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                pinchStart.current = Math.sqrt(dx * dx + dy * dy);
                return;
            }
            const touch = e.touches[0];
            const container = containerRef.current;
            if (!container) return;
            const rect = container.getBoundingClientRect();
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;
            const zone = getZone(x, rect.width);
            const now = Date.now();

            // Double-tap detection
            const sinceLastTap = now - lastTap.current.time;
            if (sinceLastTap < 300 && lastTap.current.side === zone && zone !== "center") {
                const video = videoRef.current;
                if (video) {
                    const seekBy = 10;
                    if (zone === "right") {
                        video.currentTime = Math.min(video.duration || 0, video.currentTime + seekBy);
                        setOverlayState((s) => ({ ...s, seekDir: "forward", seekSec: seekBy }));
                    } else {
                        video.currentTime = Math.max(0, video.currentTime - seekBy);
                        setOverlayState((s) => ({ ...s, seekDir: "backward", seekSec: seekBy }));
                    }
                    triggerSeek();
                }
                lastTap.current = { time: 0, side: null };
                return;
            }
            lastTap.current = { time: now, side: zone };

            dragStart.current = {
                x,
                y,
                zone,
                volume: state.volume,
                brightness: state.brightness,
                currentTime: videoRef.current?.currentTime || 0,
            };

            // Long press → 2× speed boost
            longPressTimer.current = setTimeout(() => {
                if (!speedBoostActive.current) {
                    speedBoostActive.current = true;
                    actions.setSpeedBoost(true);
                    triggerSpeedBoost();
                }
            }, 500);
        },
        [state.isLocked, state.volume, state.brightness, containerRef, videoRef, actions, setOverlayState, triggerSeek, triggerSpeedBoost],
    );

    const handleTouchEnd = useCallback(
        (e) => {
            clearTimeout(longPressTimer.current);
            if (speedBoostActive.current) {
                speedBoostActive.current = false;
                actions.setSpeedBoost(false);
            }
            pinchStart.current = null;

            // Single tap → toggle controls visibility
            if (dragStart.current && e.changedTouches.length === 1) {
                const container = containerRef.current;
                if (container) {
                    const rect = container.getBoundingClientRect();
                    const t = e.changedTouches[0];
                    const dx = Math.abs(t.clientX - rect.left - dragStart.current.x);
                    const dy = Math.abs(t.clientY - rect.top - dragStart.current.y);
                    if (dx < 12 && dy < 12) showControls();
                }
            }
            dragStart.current = null;
        },
        [actions, containerRef, showControls],
    );

    const handleTouchMove = useCallback(
        (e) => {
            if (state.isLocked) return;
            clearTimeout(longPressTimer.current);

            // Pinch-to-zoom
            if (e.touches.length === 2 && pinchStart.current) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const scale = Math.max(1, Math.min(3, scaleRef.current * (dist / pinchStart.current)));
                const video = videoRef.current;
                if (video) video.style.transform = `scale(${scale})`;
                return;
            }

            if (!dragStart.current || e.touches.length !== 1) return;
            const container = containerRef.current;
            if (!container) return;
            const rect = container.getBoundingClientRect();
            const t = e.touches[0];
            const x = t.clientX - rect.left;
            const y = t.clientY - rect.top;
            const dx = x - dragStart.current.x;
            const dy = y - dragStart.current.y;
            const { zone } = dragStart.current;

            if (zone === "left") {
                // Left swipe → brightness
                const delta = -dy / (rect.height * 0.7);
                const newBr = Math.max(0.2, Math.min(2, dragStart.current.brightness + delta * 1.5));
                actions.setBrightness(newBr);
                setOverlayState((s) => ({ ...s, brightness: newBr }));
                triggerBrightness();
            } else if (zone === "right") {
                // Right swipe → volume
                const delta = -dy / (rect.height * 0.7);
                const newVol = Math.max(0, Math.min(1, dragStart.current.volume + delta));
                actions.setVolume(newVol);
                if (newVol > 0) actions.setMuted(false);
                setOverlayState((s) => ({ ...s, volume: newVol, muted: newVol === 0 }));
                triggerVolume();
            } else if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 20) {
                // Horizontal center swipe → seek (±90s over full width)
                const video = videoRef.current;
                if (video?.duration) {
                    const seekDelta = (dx / rect.width) * 90;
                    const newTime = Math.max(0, Math.min(video.duration, dragStart.current.currentTime + seekDelta));
                    video.currentTime = newTime;
                    setOverlayState((s) => ({
                        ...s,
                        seekDir: seekDelta >= 0 ? "forward" : "backward",
                        seekSec: Math.abs(Math.round(seekDelta)),
                    }));
                    triggerSeek();
                }
            }
        },
        [state.isLocked, containerRef, videoRef, actions, setOverlayState, triggerBrightness, triggerVolume, triggerSeek],
    );

    // Attach touch listeners to container (passive for performance)
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        el.addEventListener("touchstart", handleTouchStart, { passive: true });
        el.addEventListener("touchend", handleTouchEnd, { passive: true });
        el.addEventListener("touchmove", handleTouchMove, { passive: true });
        return () => {
            el.removeEventListener("touchstart", handleTouchStart);
            el.removeEventListener("touchend", handleTouchEnd);
            el.removeEventListener("touchmove", handleTouchMove);
        };
    }, [containerRef, handleTouchStart, handleTouchEnd, handleTouchMove]);

    // Expose to PlayerControls via containerRef (avoids prop-drilling)
    useEffect(() => {
        if (containerRef.current) {
            containerRef.current._toggleFullscreen = toggleFullscreen;
            containerRef.current._togglePiP = togglePiP;
            containerRef.current._cycleSpeed = cycleSpeed;
        }
    }, [containerRef, toggleFullscreen, togglePiP, cycleSpeed]);

    return null; // pure logic component — renders nothing
}
