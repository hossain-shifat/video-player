import { useEffect, useRef, useCallback } from "react";
import { usePlayerState } from "./UsePlayerState";
import { useOverlay } from "./PlayerOverlays";

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

/**
 * PlayerGestures — handles ALL touch + keyboard input.
 *
 * Touch gestures (MX Player style):
 *   Left zone  vertical swipe → brightness
 *   Right zone vertical swipe → volume
 *   Horizontal swipe          → seek
 *   Double tap left/right     → rewind/forward 10s
 *   Long press                → 2× speed boost
 *   Pinch                     → aspect ratio / zoom
 *
 * Keyboard shortcuts (Netflix/YouTube style):
 *   Space / K   → play/pause
 *   ArrowLeft   → -10s  |  Shift+ArrowLeft  → -30s
 *   ArrowRight  → +10s  |  Shift+ArrowRight → +30s
 *   ArrowUp     → +10% volume
 *   ArrowDown   → -10% volume
 *   M           → mute
 *   F           → fullscreen
 *   P           → PiP
 *   C           → cycle subtitles
 *   A           → cycle audio track
 *   L           → cycle loop
 *   [  ]        → speed down/up
 *   0–9         → seek to 0%–90%
 */
export default function PlayerGestures({ videoRef, containerRef, overlayTriggers, setOverlayState, showControls, onTap, subtitles = [], onZoomChange }) {
    const { state, actions } = usePlayerState();
    const isMobile = useRef(false);
    const longPressTimer = useRef(null);
    const speedBoostActive = useRef(false);
    const lastTap = useRef({ time: 0, side: null });
    const dragStart = useRef(null);
    const pinchStart = useRef(null);

    // ── Pinch-zoom state (MX Player style: real scale + pan, not aspect toggle) ──
    // MIN_ZOOM is below 1 on purpose: some videos overflow the wrapper even
    // at the computed default letterbox size (e.g. right after a rotation,
    // or aspect ratios the letterbox math doesn't perfectly bound on every
    // device). Pinching in directly from default must be able to shrink
    // BELOW that baseline, not just clamp back up to it.
    const MIN_ZOOM = 0.5;
    const MAX_ZOOM = 3;
    const zoomRef = useRef({ scale: 1, panX: 0, panY: 0 });
    const panDragStart = useRef(null); // single-finger pan while zoomed

    const clampZoom = (v) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v));

    // Clamp pan so the zoomed video can't be dragged fully off-screen.
    // Max offset grows with (scale - 1) relative to container size.
    const clampPan = useCallback(
        (px, py, scale) => {
            const el = containerRef.current;
            if (!el) return { x: 0, y: 0 };
            const rect = el.getBoundingClientRect();
            const maxX = (rect.width * (scale - 1)) / 2;
            const maxY = (rect.height * (scale - 1)) / 2;
            return {
                x: Math.max(-maxX, Math.min(maxX, px)),
                y: Math.max(-maxY, Math.min(maxY, py)),
            };
        },
        [containerRef],
    );

    const applyZoom = useCallback(
        (scale, panX, panY) => {
            const s = clampZoom(scale);
            // No pan needed at or below default size — there's nothing to
            // clamp toward edges once the video is smaller than (or equal
            // to) the wrapper. Only pan when actually zoomed IN (s > 1).
            const { x, y } = s <= 1 ? { x: 0, y: 0 } : clampPan(panX, panY, s);
            zoomRef.current = { scale: s, panX: x, panY: y };
            onZoomChange?.(zoomRef.current);
        },
        [clampPan, onZoomChange],
    );

    const resetZoom = useCallback(() => {
        zoomRef.current = { scale: 1, panX: 0, panY: 0 };
        onZoomChange?.(zoomRef.current);
    }, [onZoomChange]);

    const { triggerBrightness, triggerVolume, triggerSeek, triggerSpeedBoost, triggerAudioTrack } = overlayTriggers;

    // ── Detect mobile ────────────────────────────────────────────────────────
    useEffect(() => {
        const check = () => {
            isMobile.current = window.innerWidth < 1024 || navigator.maxTouchPoints > 0;
        };
        check();
        window.addEventListener("resize", check, { passive: true });
        return () => window.removeEventListener("resize", check);
    }, []);

    // ── Fullscreen ───────────────────────────────────────────────────────────
    const toggleFullscreen = useCallback(() => {
        const el = containerRef.current;
        if (!el) return;
        if (!document.fullscreenElement) {
            el.requestFullscreen?.()
                .then(() => {
                    screen.orientation?.lock?.("landscape").catch(() => {});
                })
                .catch(() => {});
        } else {
            document
                .exitFullscreen?.()
                .then(() => {
                    screen.orientation?.unlock?.();
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

    // ── Subtitle cycling ─────────────────────────────────────────────────────
    const cycleSubtitle = useCallback(() => {
        if (!subtitles.length) return;
        const currentUrl = state.activeSubtitle?.url;
        const idx = subtitles.findIndex((s) => s.url === currentUrl);
        if (!state.activeSubtitle || idx === subtitles.length - 1) {
            actions.setActiveSubtitle(null); // → off
        } else {
            actions.setActiveSubtitle(subtitles[idx + 1]);
        }
    }, [subtitles, state.activeSubtitle, actions]);

    // ── Seek helper ──────────────────────────────────────────────────────────
    const seekBy = useCallback(
        (delta) => {
            const video = videoRef.current;
            if (!video || !video.duration) return;
            video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + delta));
            setOverlayState((s) => ({
                ...s,
                seekDir: delta >= 0 ? "forward" : "backward",
                seekSec: Math.abs(delta),
            }));
            triggerSeek();
        },
        [videoRef, setOverlayState, triggerSeek],
    );

    // ── Keyboard shortcuts ───────────────────────────────────────────────────
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
                    seekBy(e.shiftKey ? -30 : -10);
                    showControls();
                    break;

                case "ArrowRight":
                    e.preventDefault();
                    seekBy(e.shiftKey ? 30 : 10);
                    showControls();
                    break;

                case "ArrowUp":
                    e.preventDefault();
                    {
                        const newVol = Math.min(1, state.volume + 0.1);
                        actions.setVolume(newVol);
                        setOverlayState((s) => ({ ...s, volume: newVol, muted: false }));
                        triggerVolume();
                        showControls();
                    }
                    break;

                case "ArrowDown":
                    e.preventDefault();
                    {
                        const newVol = Math.max(0, state.volume - 0.1);
                        actions.setVolume(newVol);
                        setOverlayState((s) => ({ ...s, volume: newVol }));
                        triggerVolume();
                        showControls();
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

                case "c":
                case "C":
                    e.preventDefault();
                    cycleSubtitle();
                    break;

                case "a":
                case "A":
                    e.preventDefault();
                    cycleAudioTrack();
                    break;

                case "l":
                case "L":
                    e.preventDefault();
                    actions.cycleLoop();
                    break;

                case "[":
                    e.preventDefault();
                    cycleSpeed(-1);
                    break;

                case "]":
                    e.preventDefault();
                    cycleSpeed(1);
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
    }, [state.playing, state.volume, state.muted, state.audioTracks, state.activeAudioTrack, state.playbackSpeed]);

    // ── Touch zone ───────────────────────────────────────────────────────────
    const getZone = (x, w) => {
        if (x < w * 0.3) return "left";
        if (x > w * 0.7) return "right";
        return "center";
    };

    // ── handleTouchStart ─────────────────────────────────────────────────────
    const handleTouchStart = useCallback(
        (e) => {
            if (state.isLocked) return;
            const touch = e.touches[0];
            const now = Date.now();
            const el = containerRef.current;
            if (!el) return;
            const rect = el.getBoundingClientRect();
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;
            const zone = getZone(x, rect.width);

            // Pinch detection
            if (e.touches.length === 2) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const startDist = Math.sqrt(dx * dx + dy * dy);
                // FIX: touchstart for a 2-finger gesture can fire before both
                // touch points have fully settled — if startDist comes back
                // near 0, the very first touchmove's ratio = dist/startDist
                // explodes toward a huge number regardless of which way the
                // fingers actually move, making both spread AND pinch read
                // as "bigger". Mark pinch as not-yet-armed until we get a
                // sane starting distance; touchmove re-arms it once fingers
                // have a real, measurable gap.
                pinchStart.current =
                    startDist > 10
                        ? {
                              dist: startDist,
                              baseScale: zoomRef.current.scale,
                              basePanX: zoomRef.current.panX,
                              basePanY: zoomRef.current.panY,
                          }
                        : null;
                return;
            }

            // Double tap
            const dt = now - lastTap.current.time;
            if (dt < 280 && lastTap.current.side === zone && zone !== "center") {
                const video = videoRef.current;
                if (video) {
                    const delta = zone === "right" ? 10 : -10;
                    seekBy(delta);
                }
                lastTap.current = { time: 0, side: null };
                return;
            }
            if (dt < 280 && lastTap.current.side === zone && zone === "center" && zoomRef.current.scale !== 1) {
                resetZoom();
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

            // If already zoomed in, a single-finger drag pans the frame instead of
            // triggering brightness/volume/seek gestures.
            if (zoomRef.current.scale > 1) {
                panDragStart.current = { x, y, panX: zoomRef.current.panX, panY: zoomRef.current.panY };
            } else {
                panDragStart.current = null;
            }

            // Long press → speed boost
            longPressTimer.current = setTimeout(() => {
                if (!speedBoostActive.current) {
                    speedBoostActive.current = true;
                    actions.setSpeedBoost(true);
                    setOverlayState((s) => ({ ...s, speed: 2 }));
                    triggerSpeedBoost();
                }
            }, 480);
        },
        [state.isLocked, state.volume, state.brightness, state.aspectRatio, containerRef, videoRef, actions, setOverlayState, seekBy, triggerSpeedBoost, resetZoom],
    );

    // ── handleTouchEnd ───────────────────────────────────────────────────────
    const handleTouchEnd = useCallback(
        (e) => {
            clearTimeout(longPressTimer.current);

            if (speedBoostActive.current) {
                speedBoostActive.current = false;
                actions.setSpeedBoost(false);
            }
            // FIX: only tear down pinch/pan gesture state once ALL fingers
            // have lifted. A real-world pinch often has one finger lift a
            // few ms before the other (or briefly lose contact) — clearing
            // pinchStart/panDragStart on that partial lift caused the
            // remaining touchmove events to fall through into the wrong
            // gesture branch (brightness/volume/seek-drag) mid-pinch,
            // producing the wrong-direction jump + stretch/distortion.
            if (e.touches.length === 0) {
                pinchStart.current = null;
                panDragStart.current = null;
            }

            // Single tap → toggle controls
            if (dragStart.current && e.changedTouches.length === 1) {
                const el = containerRef.current;
                if (el) {
                    const rect = el.getBoundingClientRect();
                    const endX = e.changedTouches[0].clientX - rect.left;
                    const endY = e.changedTouches[0].clientY - rect.top;
                    const dx = Math.abs(endX - dragStart.current.x);
                    const dy = Math.abs(endY - dragStart.current.y);
                    if (dx < 12 && dy < 12) (onTap || showControls)();
                }
            }
            dragStart.current = null;
        },
        [actions, containerRef, showControls, onTap],
    );

    // ── handleTouchMove ──────────────────────────────────────────────────────
    const handleTouchMove = useCallback(
        (e) => {
            if (state.isLocked) return;
            clearTimeout(longPressTimer.current);

            // Pinch → real zoom (MX Player style), anchored at pinch midpoint
            if (e.touches.length === 2) {
                // Must claim this gesture explicitly — listener is now
                // non-passive specifically so this call works. Without it,
                // some browsers fall back to native pinch-zoom handling
                // mid-gesture, which is what froze zoom-out before.
                e.preventDefault();

                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (!pinchStart.current) {
                    // Wasn't armed at touchstart (fingers started too close
                    // together to get a reliable baseline) — arm it now that
                    // we have a measurable gap, using current zoom as the
                    // new baseline so the gesture starts cleanly from here.
                    if (dist > 10) {
                        pinchStart.current = {
                            dist,
                            baseScale: zoomRef.current.scale,
                            basePanX: zoomRef.current.panX,
                            basePanY: zoomRef.current.panY,
                        };
                    }
                    return;
                }

                const ratio = dist / pinchStart.current.dist;
                const newScale = clampZoom(pinchStart.current.baseScale * ratio);
                applyZoom(newScale, pinchStart.current.basePanX, pinchStart.current.basePanY);
                return;
            }

            // Single-finger pan while zoomed in
            if (panDragStart.current && e.touches.length === 1) {
                e.preventDefault();
                const touch = e.touches[0];
                const el = containerRef.current;
                if (el) {
                    const rect = el.getBoundingClientRect();
                    const x = touch.clientX - rect.left;
                    const y = touch.clientY - rect.top;
                    const dx = x - panDragStart.current.x;
                    const dy = y - panDragStart.current.y;
                    applyZoom(zoomRef.current.scale, panDragStart.current.panX + dx, panDragStart.current.panY + dy);
                }
                return;
            }

            // FIX: a pinch gesture that just dropped from 2 touches to 1
            // (one finger lifted a beat before the other) still has
            // pinchStart set. Don't let this single remaining touch fall
            // through into the brightness/volume/seek drag branch below —
            // that misread is what caused zoom-out to jump/stretch instead
            // of cleanly settling. Just hold the current zoom until touchend
            // fully clears pinchStart.
            if (pinchStart.current && e.touches.length === 1) {
                return;
            }

            if (!dragStart.current || e.touches.length !== 1) return;

            const el = containerRef.current;
            if (!el) return;
            const rect = el.getBoundingClientRect();
            const touch = e.touches[0];
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;
            const dx = x - dragStart.current.x;
            const dy = y - dragStart.current.y;
            const { zone } = dragStart.current;

            // Determine gesture direction on first significant move
            if (zone === "left" && Math.abs(dy) > Math.abs(dx)) {
                // Brightness — left vertical swipe
                const delta = -dy / (rect.height * 0.65);
                const newBrightness = Math.max(0.3, Math.min(2, dragStart.current.brightness + delta * 1.5));
                actions.setBrightness(newBrightness);
                setOverlayState((s) => ({ ...s, brightness: newBrightness }));
                triggerBrightness();
            } else if (zone === "right" && Math.abs(dy) > Math.abs(dx)) {
                // Volume — right vertical swipe
                const delta = -dy / (rect.height * 0.65);
                const newVol = Math.max(0, Math.min(1, dragStart.current.volume + delta));
                actions.setVolume(newVol);
                setOverlayState((s) => ({ ...s, volume: newVol, muted: false }));
                triggerVolume();
            } else if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 18) {
                // Horizontal seek
                const video = videoRef.current;
                if (video && video.duration) {
                    const seekDelta = (dx / rect.width) * 120; // ±120s over full width
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
        [state.isLocked, containerRef, videoRef, actions, setOverlayState, triggerBrightness, triggerVolume, triggerSeek, applyZoom],
    );

    // ── Attach touch listeners ────────────────────────────────────────────────
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        el.addEventListener("touchstart", handleTouchStart, { passive: true });
        el.addEventListener("touchend", handleTouchEnd, { passive: true });
        // FIX (zoom-out frozen): this listener must be non-passive so we can
        // call preventDefault() and fully claim 2-finger gestures ourselves.
        // With passive:true, some Android WebView/Chrome builds let the
        // browser's own native pinch-to-zoom-out handling claim the gesture
        // before our JS ever sees it — explains why spread (zoom in) worked
        // but pinch (zoom out) was completely frozen (event never arrived).
        el.addEventListener("touchmove", handleTouchMove, { passive: false });
        return () => {
            el.removeEventListener("touchstart", handleTouchStart);
            el.removeEventListener("touchend", handleTouchEnd);
            el.removeEventListener("touchmove", handleTouchMove);
        };
    }, [containerRef, handleTouchStart, handleTouchEnd, handleTouchMove]);

    // ── Expose APIs to container ref ──────────────────────────────────────────
    useEffect(() => {
        if (containerRef.current) {
            containerRef.current._toggleFullscreen = toggleFullscreen;
            containerRef.current._togglePiP = togglePiP;
            containerRef.current._cycleSpeed = cycleSpeed;
            containerRef.current._resetZoom = resetZoom;
        }
    }, [containerRef, toggleFullscreen, togglePiP, cycleSpeed, resetZoom]);

    return null;
}
