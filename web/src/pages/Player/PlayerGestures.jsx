import { useEffect, useRef, useCallback } from "react";
import { usePlayerState } from "./UsePlayerState";
import { useOverlay } from "./PlayerOverlays";
import { isGestureLocked } from "./gestureLock";

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
    const singleTapTimer = useRef(null);
    const dragStart = useRef(null);
    const pinchStart = useRef(null);

    // Mirrors state.volume/state.brightness without being a dependency of
    // handleTouchStart — that callback used to list state.volume and
    // state.brightness directly, which meant every gesture-driven update to
    // either one (i.e. every touchmove during a brightness/volume swipe)
    // produced a new handleTouchStart reference, which tore down and
    // re-attached all three touch listeners on the container mid-gesture.
    // Reading from this ref instead keeps handleTouchStart stable for the
    // whole gesture.
    const liveValues = useRef({ volume: state.volume, brightness: state.brightness });
    useEffect(() => {
        liveValues.current = { volume: state.volume, brightness: state.brightness };
    }, [state.volume, state.brightness]);

    // ── New gesture-system refs (player-controls.md spec) ──────────────────────
    const axisLock = useRef(null); // null | "horizontal" | "vertical" — set once slop is crossed, held for the rest of the gesture
    const seekCancelled = useRef(false); // true once swipe-to-cancel has fired for this gesture
    const lastMoveTime = useRef(0);
    const lastMoveX = useRef(0);
    const velocityPxPerMs = useRef(0);
    const twoFingerSpeedStart = useRef(null); // { avgY, baseSpeed } for 2-finger vertical speed slide
    const turboLocked = useRef(false); // true once long-press turbo has been "locked" by sliding to top margin
    const preTurboSpeed = useRef(1);
    const SLOP = 20; // px — doc Rule 1: 15-25px threshold before locking an axis

    // ── Pinch-zoom state (MX Player style: real scale + pan, not aspect toggle) ──
    // MIN_ZOOM is below 1 on purpose: some videos overflow the wrapper even
    // at the computed default letterbox size (e.g. right after a rotation,
    // or aspect ratios the letterbox math doesn't perfectly bound on every
    // device). Pinching in directly from default must be able to shrink
    // BELOW that baseline, not just clamp back up to it.
    const MIN_ZOOM = 0.5;
    const MAX_ZOOM = 4; // doc spec: pinch-zoom up to 400%
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
    // Doc spec: left 40% / center 20% dead zone / right 40%.
    const getZone = (x, w) => {
        if (x < w * 0.4) return "left";
        if (x > w * 0.6) return "right";
        return "center";
    };

    // ── handleTouchStart ─────────────────────────────────────────────────────
    const handleTouchStart = useCallback(
        (e) => {
            if (state.isLocked) return;

            // FIX (gesture conflict): listeners here are attached natively
            // on containerRef, so they fire during DOM bubbling REGARDLESS
            // of any React-level e.stopPropagation() called by a descendant
            // like the Quick Action row — React's synthetic event system
            // and native addEventListener listeners are separate dispatch
            // paths; stopping one doesn't stop the other. The only reliable
            // fix is checking the touch's origin here and bailing out
            // completely if it started inside an excluded zone. Excluded
            // elements are marked with data-gesture-exclude="true" (set on
            // the Quick Action row's wrapper in PlayerControls).
            if (e.target?.closest?.('[data-gesture-exclude="true"]')) {
                return;
            }
            // FIX (gesture conflict): second, DOM-independent check — see
            // gestureLock.js. The subtitle dialogue-skip zone's actual DOM
            // hit box is narrower than its visual swipe area (only as wide
            // as the centered caption text), so a touch can start just
            // outside it and still slip past the closest() check above
            // while visually feeling like the same swipe. This catches
            // that case too.
            if (isGestureLocked()) {
                return;
            }

            const touch = e.touches[0];
            const now = Date.now();
            const el = containerRef.current;
            if (!el) return;
            const rect = el.getBoundingClientRect();
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;
            const zone = getZone(x, rect.width);

            // 2-finger gesture: capture baselines for BOTH possible
            // interpretations (pinch-zoom vs 2-finger speed-slide). Which one
            // actually engages is decided in touchmove based on whether the
            // finger-to-finger distance changes (→ pinch) or stays roughly
            // constant while both fingers move vertically together (→ speed).
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
                twoFingerSpeedStart.current = {
                    startDist,
                    avgY: (e.touches[0].clientY + e.touches[1].clientY) / 2,
                    baseSpeed: state.playbackSpeed,
                    resolved: null, // "pinch" | "speed" | null (undecided)
                };
                return;
            }

            // Double tap
            const dt = now - lastTap.current.time;
            if (dt < 280 && lastTap.current.side === zone && zone !== "center") {
                clearTimeout(singleTapTimer.current);
                const video = videoRef.current;
                if (video) {
                    const delta = zone === "right" ? 10 : -10;
                    seekBy(delta);
                }
                lastTap.current = { time: 0, side: null };
                return;
            }
            if (dt < 280 && lastTap.current.side === zone && zone === "center") {
                clearTimeout(singleTapTimer.current);
                actions.setPlaying(!state.playing);
                if (zoomRef.current.scale !== 1) resetZoom();
                lastTap.current = { time: 0, side: null };
                return;
            }
            lastTap.current = { time: now, side: zone };

            // Reset gesture-tracking state for this fresh touch
            axisLock.current = null;
            seekCancelled.current = false;
            lastMoveTime.current = 0;
            lastMoveX.current = touch.clientX;
            velocityPxPerMs.current = 0;
            turboLocked.current = false;

            dragStart.current = {
                x,
                y,
                zone,
                volume: liveValues.current.volume,
                brightness: liveValues.current.brightness,
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
        [state.isLocked, state.aspectRatio, containerRef, videoRef, actions, setOverlayState, seekBy, triggerSpeedBoost, resetZoom],
    );

    // ── handleTouchEnd ───────────────────────────────────────────────────────
    const handleTouchEnd = useCallback(
        (e) => {
            clearTimeout(longPressTimer.current);

            // Doc "Turbo Lock": if the user slid to the top margin while
            // long-pressing, the boosted speed stays after release instead
            // of reverting. Otherwise, releasing always snaps back to 1.0x
            // (or whatever the pre-boost speed was) per doc spec.
            if (speedBoostActive.current && !turboLocked.current) {
                speedBoostActive.current = false;
                actions.setSpeedBoost(false);
            } else if (speedBoostActive.current && turboLocked.current) {
                speedBoostActive.current = false;
                turboLocked.current = false;
                actions.commitSpeedBoost();
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
                twoFingerSpeedStart.current = null;
            }

            // Single tap → toggle controls. Delayed by the same debounce
            // window as double-tap detection (doc: "Conflict Resolution
            // Logic") — if a second tap lands within that window, the
            // double-tap branch above already returned early and cleared
            // lastTap, so this deferred single-tap fires a check against a
            // FRESH tap state to decide whether it's still a genuine single.
            if (dragStart.current && e.changedTouches.length === 1) {
                const el = containerRef.current;
                if (el) {
                    const rect = el.getBoundingClientRect();
                    const endX = e.changedTouches[0].clientX - rect.left;
                    const endY = e.changedTouches[0].clientY - rect.top;
                    const dx = Math.abs(endX - dragStart.current.x);
                    const dy = Math.abs(endY - dragStart.current.y);
                    if (dx < 12 && dy < 12) {
                        const tapTimeSnapshot = lastTap.current.time;
                        clearTimeout(singleTapTimer.current);
                        singleTapTimer.current = setTimeout(() => {
                            // If lastTap.current.time changed since we
                            // scheduled this, a double-tap consumed it —
                            // don't also fire the single-tap toggle.
                            if (lastTap.current.time === tapTimeSnapshot) {
                                (onTap || showControls)();
                            }
                        }, 280);
                    }
                }
            }
            dragStart.current = null;
        },
        [actions, state.playing, containerRef, showControls, onTap],
    );

    // ── handleTouchMove ──────────────────────────────────────────────────────
    const handleTouchMove = useCallback(
        (e) => {
            if (state.isLocked) return;
            clearTimeout(longPressTimer.current);

            // Pinch → real zoom (MX Player style), anchored at pinch midpoint
            // — OR — 2-finger vertical speed-slide (doc spec). Disambiguated
            // by movement pattern: if finger-to-finger distance changes
            // meaningfully, it's a pinch. If distance stays roughly constant
            // while both fingers move vertically together, it's speed-slide.
            if (e.touches.length === 2) {
                e.preventDefault();

                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const tfs = twoFingerSpeedStart.current;

                if (tfs && !tfs.resolved) {
                    const distDelta = Math.abs(dist - tfs.startDist);
                    const avgY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
                    const yDelta = Math.abs(avgY - tfs.avgY);
                    if (distDelta > SLOP) {
                        tfs.resolved = "pinch";
                    } else if (yDelta > SLOP) {
                        tfs.resolved = "speed";
                    } else {
                        return; // not enough movement yet to tell which
                    }
                }

                if (tfs?.resolved === "speed") {
                    // Doc: slide up accelerates (max 4.0x), slide down slows
                    // (min 0.25x). Map total vertical travel across ~40% of
                    // container height to the full speed range for a
                    // predictable, not-too-twitchy feel.
                    const el = containerRef.current;
                    const rect = el?.getBoundingClientRect();
                    if (rect) {
                        const avgY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
                        const travel = (tfs.avgY - avgY) / (rect.height * 0.4); // up = positive
                        const next = Math.max(0.25, Math.min(4, tfs.baseSpeed + travel * 2));
                        // Snap to common speed steps for a less twitchy feel
                        const snapped = SPEEDS.reduce((best, s) => (Math.abs(s - next) < Math.abs(best - next) ? s : best), SPEEDS[0]);
                        if (snapped !== state.playbackSpeed) {
                            actions.setPlaybackSpeed(snapped);
                            setOverlayState((s) => ({ ...s, speed: snapped }));
                            triggerSpeedBoost();
                        }
                    }
                    return;
                }

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

            // ── Turbo-lock: if long-press turbo is active and the finger
            // slides up into the top margin, lock the boosted speed so the
            // user can release without it reverting (doc: "Turbo Lock").
            if (speedBoostActive.current && !turboLocked.current) {
                if (y < rect.height * 0.08) {
                    turboLocked.current = true;
                    setOverlayState((s) => ({ ...s, speed: state.playbackSpeed, turboLocked: true }));
                }
            }

            // ── Speed-boost custom slide: while the long-press boost is
            // active, dragging horizontally anywhere on screen lets the user
            // pick a custom speed on the 0.25x-4.0x slider shown by
            // SpeedBoostSlider, instead of being stuck at the default 2x.
            // Maps the finger's absolute x-position across the full screen
            // width to the slider range — mirrors how the slider's own touch
            // handler computes position, so dragging here and dragging the
            // visible dots produce the same result.
            if (speedBoostActive.current) {
                const MIN_SPEED = 0.25;
                const MAX_SPEED = 4.0;
                const pct = Math.max(0, Math.min(1, x / rect.width));
                const rawSpeed = MIN_SPEED + pct * (MAX_SPEED - MIN_SPEED);
                const customSpeed = Math.round(rawSpeed * 20) / 20;
                actions.setPlaybackSpeed(customSpeed);
                setOverlayState((s) => ({ ...s, speed: customSpeed }));
                return;
            }

            // ── Axis lock (doc Rule 1): don't interpret direction at the
            // exact down-point. Wait until movement crosses SLOP (15-25px),
            // then commit to whichever axis broke the threshold first and
            // hold that interpretation for the rest of the gesture — this is
            // what prevents a vertical brightness swipe from jittering into
            // a horizontal seek (or vice versa) from natural hand wobble.
            if (!axisLock.current) {
                if (Math.abs(dx) > SLOP && Math.abs(dx) > Math.abs(dy)) {
                    axisLock.current = "horizontal";
                } else if (Math.abs(dy) > SLOP && Math.abs(dy) > Math.abs(dx)) {
                    axisLock.current = "vertical";
                } else {
                    return; // still inside the dead zone — not committed yet
                }
            }

            if (axisLock.current === "vertical" && zone === "left") {
                // Brightness — left vertical swipe. Range is 0.0 (scrim
                // fully dims toward the spec's 0.85 black ceiling) to 1.0
                // (scrim fully clear, native screen brightness). No boost
                // ceiling above 1.0 here — unlike volume, there's no way to
                // push light output past whatever the real backlight is
                // currently at from inside a browser tab; the scrim can only
                // subtract light, never add it.
                const delta = -dy / (rect.height * 0.65);
                const rawBrightness = Math.max(0, Math.min(1, dragStart.current.brightness + delta));
                // Quantize to 5% steps so the value advances in clean
                // increments rather than tracking every sub-pixel of finger
                // movement — avoids visible flicker on the scrim opacity.
                const newBrightness = Math.round(rawBrightness * 20) / 20;
                actions.setBrightness(newBrightness);
                setOverlayState((s) => ({ ...s, brightness: newBrightness }));
                triggerBrightness();
            } else if (axisLock.current === "vertical" && zone === "right") {
                // Volume — right vertical swipe. Doc: supports boost to 200%
                // via software amplification — the 0-1 portion is native
                // <video>.volume, the 1-2 portion is the GainNode boost
                // wired in VideoCore (see boostGain prop / applyVolumeBoost).
                const delta = -dy / (rect.height * 0.65);
                const rawVol = Math.max(0, Math.min(2, dragStart.current.volume + delta * 2));
                // Quantize to 5% steps, same reasoning as brightness above.
                const newVol = Math.round(rawVol * 20) / 20;
                actions.setVolume(Math.min(1, newVol));
                actions.setVolumeBoost(Math.max(1, newVol));
                setOverlayState((s) => ({ ...s, volume: newVol, muted: false }));
                triggerVolume();
            } else if (axisLock.current === "horizontal") {
                // ── Velocity-based seek (doc Rule 2): exponential curve
                // combining distance + velocity. Slow deliberate drag → fine
                // frame-level scrubbing. Fast fling → coarse multi-minute jumps.
                const now = performance.now();
                const dt = now - (lastMoveTime.current || now);
                if (dt > 0) {
                    const instVelocity = (touch.clientX - (lastMoveX.current || touch.clientX)) / dt; // px/ms
                    // Smooth velocity so a single jittery frame doesn't spike the curve
                    velocityPxPerMs.current = velocityPxPerMs.current * 0.7 + instVelocity * 0.3;
                }
                lastMoveTime.current = now;
                lastMoveX.current = touch.clientX;

                const video = videoRef.current;
                if (video && video.duration) {
                    const distFactor = dx / rect.width; // -1..1 across full width
                    const speedFactor = Math.min(3, Math.abs(velocityPxPerMs.current) * 8); // fast flings amplify the jump
                    // Exponential-ish blend: base linear distance term (fine
                    // control at low speed) plus a velocity-scaled term that
                    // grows the jump on fast flings (coarse control).
                    const seekDelta = distFactor * 90 + Math.sign(dx) * speedFactor * distFactor * 180;
                    const targetTime = Math.max(0, Math.min(video.duration, dragStart.current.currentTime + seekDelta));

                    // ── Swipe-to-cancel (doc Rule 3): drag down into the
                    // bottom margin while seeking aborts back to the
                    // pre-gesture timestamp.
                    if (y > rect.height * 0.92 && !seekCancelled.current) {
                        seekCancelled.current = true;
                        video.currentTime = dragStart.current.currentTime;
                        setOverlayState((s) => ({ ...s, seekCancelled: true, seekDir: "cancel" }));
                        triggerSeek();
                        return;
                    }
                    if (seekCancelled.current) return; // stay cancelled until finger lifts

                    video.currentTime = targetTime;
                    setOverlayState((s) => ({
                        ...s,
                        seekDir: seekDelta >= 0 ? "forward" : "backward",
                        seekSec: Math.abs(Math.round(seekDelta)),
                        seekTarget: targetTime,
                        seekCancelled: false,
                    }));
                    triggerSeek();
                }
            }
        },
        [state.isLocked, state.playbackSpeed, containerRef, videoRef, actions, setOverlayState, triggerBrightness, triggerVolume, triggerSeek, triggerSpeedBoost, applyZoom],
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
            clearTimeout(singleTapTimer.current);
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
