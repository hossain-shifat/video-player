import { useEffect, useRef, useCallback } from "react";
import { usePlayerState } from "./UsePlayerState";
import { useOverlay } from "./PlayerOverlays";

// Speed levels for cycling
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

function formatTime(secs) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * @param {object} props
 * @param {React.RefObject} props.videoRef
 * @param {React.RefObject} props.containerRef
 * @param {object} props.overlayTriggers - { triggerBrightness, triggerVolume, triggerSeek, ... }
 * @param {function} props.setOverlayState
 * @param {function} props.showControls - shows controls temporarily
 */
export default function PlayerGestures({ videoRef, containerRef, overlayTriggers, setOverlayState, showControls }) {
    const { state, actions } = usePlayerState();
    const isMobile = useRef(false);
    const longPressTimer = useRef(null);
    const speedBoostActive = useRef(false);
    const lastTap = useRef({ time: 0, x: 0, side: null });
    const dragStart = useRef(null);
    const pinchStart = useRef(null);
    const scaleRef = useRef(1);

    const { triggerBrightness, triggerVolume, triggerSeek, triggerSpeedBoost, triggerAudioTrack } = overlayTriggers;

    // Detect if mobile
    useEffect(() => {
        const check = () => {
            isMobile.current = window.innerWidth < 1024 || navigator.maxTouchPoints > 0;
        };
        check();
        window.addEventListener("resize", check);
        return () => window.removeEventListener("resize", check);
    }, []);

    // ── Keyboard shortcuts (desktop) ─────────────────────────────────────────
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
                    video.currentTime = Math.max(0, video.currentTime - 10);
                    setOverlayState((s) => ({ ...s, seekDir: "backward", seekSec: 10 }));
                    triggerSeek();
                    showControls();
                    break;
                case "ArrowRight":
                    e.preventDefault();
                    video.currentTime = Math.min(video.duration, video.currentTime + 10);
                    setOverlayState((s) => ({ ...s, seekDir: "forward", seekSec: 10 }));
                    triggerSeek();
                    showControls();
                    break;
                case "ArrowUp":
                    e.preventDefault();
                    actions.setVolume(Math.min(1, state.volume + 0.1));
                    setOverlayState((s) => ({ ...s, volume: Math.min(1, state.volume + 0.1), muted: false }));
                    triggerVolume();
                    showControls();
                    break;
                case "ArrowDown":
                    e.preventDefault();
                    actions.setVolume(Math.max(0, state.volume - 0.1));
                    setOverlayState((s) => ({ ...s, volume: Math.max(0, state.volume - 0.1) }));
                    triggerVolume();
                    showControls();
                    break;
                case "f":
                case "F":
                    e.preventDefault();
                    toggleFullscreen();
                    break;
                case "m":
                case "M":
                    e.preventDefault();
                    actions.setMuted(!state.muted);
                    setOverlayState((s) => ({ ...s, muted: !state.muted, volume: state.volume }));
                    triggerVolume();
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
                    if (e.key >= "0" && e.key <= "9" && !e.ctrlKey && !e.metaKey) {
                        e.preventDefault();
                        const pct = parseInt(e.key) / 10;
                        if (video.duration) video.currentTime = video.duration * pct;
                        showControls();
                    }
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.playing, state.volume, state.muted, state.audioTracks, state.activeAudioTrack]);

    // ── Fullscreen toggle ────────────────────────────────────────────────────
    const toggleFullscreen = useCallback(() => {
        const el = containerRef.current;
        if (!el) return;
        if (!document.fullscreenElement) {
            el.requestFullscreen?.()
                .then(() => {
                    // Lock to landscape on mobile (silently ignore if unavailable on desktop)
                    if (screen.orientation?.lock) {
                        screen.orientation.lock("landscape").catch(() => {});
                    }
                })
                .catch(() => {});
        } else {
            document.exitFullscreen?.()
                .then(() => {
                    if (screen.orientation?.unlock) {
                        screen.orientation.unlock();
                    }
                })
                .catch(() => {});
        }
    }, [containerRef]);

    useEffect(() => {
        const onFS = () => actions.setFullscreen(!!document.fullscreenElement);
        document.addEventListener("fullscreenchange", onFS);
        return () => document.removeEventListener("fullscreenchange", onFS);
    }, [actions]);

    // ── PiP ──────────────────────────────────────────────────────────────────
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

    // ── Speed cycling ────────────────────────────────────────────────────────
    const cycleSpeed = useCallback(
        (dir) => {
            const idx = SPEEDS.indexOf(state.playbackSpeed);
            const next = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, idx + dir))];
            actions.setPlaybackSpeed(next);
        },
        [state.playbackSpeed, actions],
    );

    // ── Audio track cycling ──────────────────────────────────────────────────
    const cycleAudioTrack = useCallback(() => {
        if (!state.audioTracks.length) return;
        const next = (state.activeAudioTrack + 1) % state.audioTracks.length;
        actions.setActiveAudioTrack(next);
        const trackName = state.audioTracks[next]?.name || "Track";
        setOverlayState((s) => ({ ...s, audioTrack: trackName }));
        triggerAudioTrack();
    }, [state.audioTracks, state.activeAudioTrack, actions, setOverlayState, triggerAudioTrack]);

    // ── Touch gesture handlers ───────────────────────────────────────────────

    const getZone = (x, containerWidth) => {
        if (x < containerWidth * 0.3) return "left";
        if (x > containerWidth * 0.7) return "right";
        return "center";
    };

    const handleTouchStart = useCallback(
        (e) => {
            if (state.isLocked) return;
            const touch = e.touches[0];
            const now = Date.now();
            const container = containerRef.current;
            if (!container) return;
            const rect = container.getBoundingClientRect();
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;
            const zone = getZone(x, rect.width);

            // Pinch detection
            if (e.touches.length === 2) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                pinchStart.current = Math.sqrt(dx * dx + dy * dy);
                return;
            }

            // Double tap detection
            const timeSinceLast = now - lastTap.current.time;
            const sameSide = lastTap.current.side === zone;
            if (timeSinceLast < 300 && sameSide && zone !== "center") {
                // Double tap
                const video = videoRef.current;
                if (video) {
                    if (zone === "right") {
                        video.currentTime = Math.min(video.duration, video.currentTime + 10);
                        setOverlayState((s) => ({ ...s, seekDir: "forward", seekSec: 10 }));
                        triggerSeek();
                    } else {
                        video.currentTime = Math.max(0, video.currentTime - 10);
                        setOverlayState((s) => ({ ...s, seekDir: "backward", seekSec: 10 }));
                        triggerSeek();
                    }
                }
                lastTap.current = { time: 0, x: 0, side: null };
                return;
            }

            lastTap.current = { time: now, x, side: zone };
            dragStart.current = { x, y, volume: state.volume, brightness: state.brightness, currentTime: videoRef.current?.currentTime || 0, zone };

            // Long press for speed boost
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

            // Single tap → toggle controls
            if (dragStart.current && e.changedTouches.length === 1) {
                const container = containerRef.current;
                if (!container) return;
                const rect = container.getBoundingClientRect();
                const endX = e.changedTouches[0].clientX - rect.left;
                const endY = e.changedTouches[0].clientY - rect.top;
                const dx = Math.abs(endX - dragStart.current.x);
                const dy = Math.abs(endY - dragStart.current.y);
                if (dx < 10 && dy < 10) {
                    showControls();
                }
            }
            dragStart.current = null;
        },
        [actions, state.controlsVisible, showControls, containerRef],
    );

    const handleTouchMove = useCallback(
        (e) => {
            if (state.isLocked) return;
            clearTimeout(longPressTimer.current);

            // Pinch to zoom
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
            const touch = e.touches[0];
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;
            const dx = x - dragStart.current.x;
            const dy = y - dragStart.current.y;
            const { zone } = dragStart.current;

            if (zone === "left") {
                // Brightness
                const delta = -dy / (rect.height * 0.7);
                const newBrightness = Math.max(0.5, Math.min(2, dragStart.current.brightness + delta * 1.5));
                actions.setBrightness(newBrightness);
                setOverlayState((s) => ({ ...s, brightness: newBrightness }));
                triggerBrightness();
            } else if (zone === "right") {
                // Volume
                const delta = -dy / (rect.height * 0.7);
                const newVol = Math.max(0, Math.min(1, dragStart.current.volume + delta));
                actions.setVolume(newVol);
                setOverlayState((s) => ({ ...s, volume: newVol, muted: false }));
                triggerVolume();
            } else if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 20) {
                // Horizontal seek
                const video = videoRef.current;
                if (video && video.duration) {
                    const seekDelta = (dx / rect.width) * 90; // ±90s over full width
                    const newTime = Math.max(0, Math.min(video.duration, dragStart.current.currentTime + seekDelta));
                    video.currentTime = newTime;
                    const dir = seekDelta >= 0 ? "forward" : "backward";
                    setOverlayState((s) => ({ ...s, seekDir: dir, seekSec: Math.abs(Math.round(seekDelta)) }));
                    triggerSeek();
                }
            }
        },
        [state.isLocked, containerRef, videoRef, actions, setOverlayState, triggerBrightness, triggerVolume, triggerSeek],
    );

    // Attach touch events to container
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

    // Expose toggleFullscreen and togglePiP for PlayerControls
    useEffect(() => {
        if (containerRef.current) {
            containerRef.current._toggleFullscreen = toggleFullscreen;
            containerRef.current._togglePiP = togglePiP;
            containerRef.current._cycleSpeed = cycleSpeed;
        }
    }, [containerRef, toggleFullscreen, togglePiP, cycleSpeed]);

    return null; // Renders nothing — all logic
}
