import { useEffect, useRef, useCallback } from "react";
import { usePlayerState } from "./UsePlayerState";
import { useOverlay } from "./PlayerOverlays";
import { isGestureLocked } from "./gestureLock";

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

// ── Continuous MX-Player-style horizontal seek curve ──────────────────────
// Maps total horizontal drag distance (px, since gesture start) to a signed
// seek offset in seconds. Small movements → small (~1s-scale) offsets;
// farther drags grow super-linearly, same "the farther you drag the bigger
// the jump" feel as MX Player's scrub bar — NOT the old fixed ±10s notches.
// Pure function of absolute drag distance (not velocity, not accumulated
// steps) so it's always recomputed fresh from dragStart, never compounds.
const SEEK_CURVE_PX = 8; // px per "unit" before the exponent is applied
const SEEK_CURVE_EXP = 1.3; // >1 = accelerating curve
function computeDragSeekSeconds(dxPx) {
    const sign = dxPx < 0 ? -1 : 1;
    const seconds = Math.pow(Math.abs(dxPx) / SEEK_CURVE_PX, SEEK_CURVE_EXP);
    return sign * seconds;
}

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
export default function PlayerGestures({ videoRef, containerRef, overlayTriggers, setOverlayState, showControls, onTap, subtitles = [], onZoomChange, manualClockRef, sessionTimeOffsetRef }) {
    const { state, actions } = usePlayerState();
    const isMobile = useRef(false);
    const longPressTimer = useRef(null);
    const speedBoostActive = useRef(false);
    const lastTap = useRef({ time: 0, side: null });
    const singleTapTimer = useRef(null);
    const dragStart = useRef(null);
    const pinchStart = useRef(null);
    // Pinching ON the subtitle caption resizes its text instead of zooming
    // the video — decided definitively at touchstart (geometric containment
    // against the caption's actual rendered rect, not DOM target/bubbling;
    // see the touchstart handler below for why bubbling-based exclusion
    // alone can't reliably catch this: a real pinch's second finger commonly
    // lands outside the caption's own narrow (single-line-height) DOM box,
    // so its OWN touchstart event never even passes through the caption
    // element at all).
    const subtitlePinchStart = useRef(null);

    // Mirrors state.volume/state.brightness without being a dependency of
    // handleTouchStart — that callback used to list state.volume and
    // state.brightness directly, which meant every gesture-driven update to
    // either one (i.e. every touchmove during a brightness/volume swipe)
    // produced a new handleTouchStart reference, which tore down and
    // re-attached all three touch listeners on the container mid-gesture.
    // Reading from this ref instead keeps handleTouchStart stable for the
    // whole gesture.
    const liveValues = useRef({ volume: state.volume, brightness: state.brightness, subtitleScale: state.subtitleScale, currentTime: state.currentTime });
    useEffect(() => {
        liveValues.current.volume = state.volume;
        liveValues.current.brightness = state.brightness;
        liveValues.current.subtitleScale = state.subtitleScale;
    }, [state.volume, state.brightness, state.subtitleScale]);
    // currentTime changes far more often (native timeupdate + the 200ms
    // manual-clock ticker) than the fields above — mirrored on every
    // render directly (a plain ref write, not inside useEffect) so it's
    // always fresh for seekBy/handleTouchStart to read via
    // liveValues.current.currentTime, WITHOUT ever needing state.currentTime
    // in any callback's dependency array. Putting it there directly (as a
    // previous fix did) recreated seekBy → handleTouchStart → the
    // touch-listener-attach effect several times a second, tearing down
    // and re-adding native touchstart/touchmove/touchend listeners
    // constantly — any touch event landing in that gap was silently
    // dropped, which is what broke horizontal drag-seek and left vertical
    // gestures in inconsistent states.
    liveValues.current.currentTime = state.currentTime;

    // ── New gesture-system refs (player-controls.md spec) ──────────────────────
    const axisLock = useRef(null); // null | "horizontal" | "vertical" — set once slop is crossed, held for the rest of the gesture
    const seekCancelled = useRef(false); // true once swipe-to-cancel has fired for this gesture
    // FIX (smoothness): the actual video.currentTime assignment during
    // drag-seek can be expensive per-call (especially for HLS/MSE streams,
    // which do real internal buffering/seeking work under the hood) —
    // writing it on EVERY raw touchmove (which can fire faster than the
    // display refresh rate on some touch digitizers) caused visible
    // stutter. Throttling the actual seek to once per animation frame
    // fixes that; the overlay (seekTarget/seekDir/seekSec) still updates
    // instantly every touchmove since that part is cheap.
    const seekRafRef = useRef(null);
    const pendingSeekTime = useRef(null);
    const lastMoveTime = useRef(0);
    const lastMoveX = useRef(0);
    const velocityPxPerMs = useRef(0);
    // ROOT CAUSE (double-tap overlay leaking across sessions, e.g. +20s
    // after a 30-min gap): this used to be a SINGLE ref shared by both
    // double-tap and horizontal-drag, expired via setTimeout(900ms). Two
    // separate problems:
    //   1) setTimeout is not a reliable clock — mobile browsers throttle
    //      or fully suspend timers once the tab is backgrounded / screen
    //      locks. The expiry callback silently never fires, so `total`
    //      and `dir` survive untouched across an arbitrarily long gap,
    //      and the next tap adds onto that stale total instead of
    //      starting fresh.
    //   2) Double-tap (must remember state ACROSS separate touch
    //      sessions, within a time window) and horizontal-drag (must
    //      NEVER remember anything beyond its own single continuous
    //      touch session) have fundamentally different lifetimes — they
    //      should never have shared one ref in the first place.
    // Fix: double-tap/keyboard skips get their own ref, expired by
    // comparing wall-clock Date.now() at the START of the next skip
    // (timestamp-based — correct regardless of any timer throttling that
    // happened while backgrounded). Horizontal-drag no longer touches
    // this ref at all — see dragNotchesRef usage below, which is already
    // reset at every touchstart/touchend and needs no expiry logic since
    // it never has to survive between separate gesture sessions.
    const tapSkipAccumRef = useRef({ total: 0, dir: null, lastAt: 0 });
    const SKIP_ACCUM_WINDOW_MS = 900;
    // dragNotchesRef/NOTCH_PX: no longer used by the seek curve itself
    // (replaced by computeDragSeekSeconds, a continuous function of total
    // drag distance) — kept only as a harmless no-op reset target for the
    // swipe-to-cancel branch below so that branch's diff stays minimal.
    const dragNotchesRef = useRef(0);
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

    // ── Dev diagnostic only (no behavior change) ──────────────────────────
    // If this prop was never passed down from PlayerPage.jsx, every
    // `sessionTimeOffsetRef?.current || 0` in this file silently resolves
    // to 0 — indistinguishable from a legitimately-zero offset, and exactly
    // reproduces "0 + delta = 0:00:1X" after any resume/quality-switch.
    // This makes that wiring gap impossible to miss instead of failing
    // silently.
    useEffect(() => {
        if (sessionTimeOffsetRef === undefined) {
            console.warn(
                "[PlayerGestures] sessionTimeOffsetRef prop is missing — pass sessionTimeOffsetRef={sessionTimeOffsetRef} from PlayerPage.jsx, or all seeks after a resume/quality-switch will land at the wrong position.",
            );
        }
    }, [sessionTimeOffsetRef]);

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
    // `displaySec`, when passed, is a caller-precomputed overlay total that
    // bypasses the tap accumulator entirely — this is what the horizontal
    // drag path uses (see handleTouchMove), since a drag's total is already
    // known exactly from its own local notch count and must never read or
    // write cross-session tap state (BUG 4: the two gestures must not share
    // an accumulator).
    const seekBy = useCallback(
        (delta, displaySec) => {
            const video = videoRef.current;
            if (!video) return;

            // ── Sole source of truth for "where playback REALLY is" ──────
            // ROOT CAUSE of the reported bug (double-tap/swipe landing at
            // 0:00 or another position computed from a session-relative
            // timeline, instead of relative to the position on screen):
            // this used to independently reconstruct "now" as
            // `video.currentTime + sessionTimeOffsetRef.current`, treating
            // that as more trustworthy than the displayed clock. But
            // sessionTimeOffsetRef is a single ESTIMATE computed once, on
            // the frontend, before the resume/quality-switch seek has even
            // landed (see PlayerPage.jsx handleReadyToSeek) — it is never
            // corrected afterward. Whenever it's off (even slightly), or
            // whenever video.currentTime itself hasn't caught up to where
            // the visible clock says we are, this formula silently
            // computes a "now" that does NOT match what the user is
            // looking at — and the resulting seek is relative to THAT
            // wrong value, landing wherever the mismatch put it (near 0
            // when the estimate is far off).
            //
            // state.currentTime is the ONE value already proven correct —
            // it's the exact number rendered on screen (seek bar, time
            // text), kept in sync by PlayerPage's manual-clock ticker
            // and/or native timeupdate. Reading it here instead makes the
            // seek pipeline single-source-of-truth: gestures always seek
            // relative to what's on screen, never a second, independently
            // (and now provably incorrectly) reconstructed "now".
            // sessionTimeOffsetRef is still needed below, but ONLY to
            // convert the resulting absolute target back into this
            // session's own relative timeline for the real <video>
            // element — never again to compute "now".
            const nowAbs = liveValues.current.currentTime;

            const absDuration = state.duration || video.duration || Infinity;
            if (!absDuration || !isFinite(absDuration)) return;

            const targetAbs = Math.max(0, Math.min(absDuration, nowAbs + delta));

            // ── REGRESSION FIX: real seek landing at a wrong/random spot ──
            // ROOT CAUSE: this used to convert targetAbs back to the real
            // element's own timeline via `targetAbs - sessionOffset`,
            // trusting sessionTimeOffsetRef as if it were a verified,
            // always-correct mapping between "absolute time" and "this
            // session's own relative time". It isn't — it's a single
            // ESTIMATE computed once on the frontend before the
            // resume/quality-switch seek had even landed (see
            // PlayerPage.jsx handleReadyToSeek), and can be off. Once the
            // "now" calculation was fixed to read state.currentTime
            // (previous fix), state/overlay stopped round-tripping through
            // the real video position at all — so any error in
            // sessionOffset now landed the REAL seek somewhere wrong while
            // the DISPLAY (driven straight from targetAbs) kept showing
            // the mathematically correct number regardless. That's exactly
            // "overlay right, playback wrong, sometimes backwards" — the
            // sign/magnitude of the error depends entirely on how wrong
            // that one estimate happened to be.
            //
            // FIX: never derive the real element's target from the
            // absolute number at all. video.currentTime is self-consistent
            // on its OWN timeline regardless of what absolute moment it
            // represents — so just move it by the exact same delta the
            // user asked for, relative to wherever it REALLY is right now.
            // No offset, no estimate, no conversion — this can't drift
            // because it never depends on sessionOffset being correct.
            const videoBound = isFinite(video.duration) ? video.duration : Infinity;
            video.currentTime = Math.max(0, Math.min(videoBound, video.currentTime + delta));
            actions.setCurrentTime(targetAbs);

            // Re-sync the manual display clock's baseline to this
            // now-confirmed real position, so the on-screen ticking clock
            // snaps back in step with reality instead of continuing to
            // drift from wherever it had extrapolated to. This does NOT
            // feed back into the calculation above — it's one-way,
            // display-only.
            if (manualClockRef?.current) {
                manualClockRef.current.baseX = targetAbs;
                manualClockRef.current.baseTime = Date.now();
            }

            const dir = delta >= 0 ? "forward" : "backward";
            let totalSec;

            if (displaySec !== undefined) {
                // Drag path: caller already computed the exact session-local
                // total. Don't touch tapSkipAccumRef — a drag must never
                // read from or leak into the separate double-tap/keyboard
                // accumulator, and vice versa.
                totalSec = displaySec;
            } else {
                // Double-tap / keyboard path: accumulate across separate
                // taps that land within SKIP_ACCUM_WINDOW_MS of each other
                // ("+10s" → "+20s" → "+30s"), same MX-Player feel as before.
                // Expiry is now decided by comparing wall-clock timestamps
                // at the moment of THIS call, not by a setTimeout callback —
                // setTimeout gets throttled/suspended by the browser once
                // the tab is backgrounded or the screen locks, which is
                // exactly the real-world scenario ("wait 30 minutes") that
                // let the old total silently survive and get added to
                // instead of reset. Date.now() is correct wall-clock time
                // regardless of any timer throttling that happened while
                // away, so this can't go stale.
                const acc = tapSkipAccumRef.current;
                const now = Date.now();
                const withinWindow = acc.dir === dir && now - acc.lastAt <= SKIP_ACCUM_WINDOW_MS;
                acc.total = withinWindow ? acc.total + Math.abs(delta) : Math.abs(delta);
                acc.dir = dir;
                acc.lastAt = now;
                totalSec = acc.total;
            }

            setOverlayState((s) => ({
                ...s,
                seekDir: dir,
                seekSec: totalSec,
                // Only the drag path sets an absolute target — this is the
                // exact discriminator PlayerOverlays.jsx uses to pick the
                // new slide-seek UI (SeekTimeOverlay + SlideSeekTrack)
                // instead of the double-tap SeekZone. Double-tap/keyboard
                // explicitly clear it so they keep using SeekZone,
                // unaffected by this change.
                seekTarget: displaySec !== undefined ? targetAbs : undefined,
            }));
            triggerSeek();
        },
        [videoRef, actions, setOverlayState, triggerSeek, manualClockRef, sessionTimeOffsetRef, state.duration],
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
                        // Same absolute/relative conversion as seekBy: percent
                        // must be taken against the REAL total duration
                        // (state.duration), not video.duration (session-
                        // relative length after a quality-switch/resume) —
                        // and the result must be converted back to this
                        // session's relative timeline before touching the
                        // real <video> element.
                        const absDur = state.duration || video.duration;
                        if (absDur) {
                            const targetAbs = absDur * pct;
                            // Same fix as seekBy: don't convert the absolute
                            // target via sessionOffset (a fallible estimate)
                            // — compute the delta from the current
                            // authoritative position and apply THAT to the
                            // real element's own timeline instead.
                            const delta = targetAbs - liveValues.current.currentTime;
                            const videoBound = isFinite(video.duration) ? video.duration : Infinity;
                            video.currentTime = Math.max(0, Math.min(videoBound, video.currentTime + delta));
                            actions.setCurrentTime(targetAbs);
                            if (manualClockRef?.current) {
                                manualClockRef.current.baseX = targetAbs;
                                manualClockRef.current.baseTime = Date.now();
                            }
                        }
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
                // FIX (subtitle pinch-resize vs video pinch-zoom conflict):
                // check BOTH raw touch points against the subtitle caption's
                // actual bounding rect — geometric containment, not
                // e.target/closest() or isGestureLocked(). Those only see
                // whichever single touch triggered THIS particular event; a
                // real pinch routinely has one finger land outside the
                // caption's own (single-line-height) box even though the
                // OTHER finger is squarely on it, and that stray finger's own
                // touchstart never passes through the caption element at all
                // — so DOM-bubbling-based exclusion can't see it. Checking
                // actual screen coordinates against the rect catches it
                // regardless of which element technically received the event.
                const subEl = containerRef.current?.querySelector(".flux-subtitle-container");
                const subRect = subEl?.getBoundingClientRect();
                // FIX ("only corner stretching works"): a small pad (24px)
                // meant a natural side-by-side pinch (both fingers roughly
                // level, spreading straight apart) commonly had one or both
                // touch points fall outside the caption's own thin box
                // vertically, while a diagonal/corner-style pinch happened
                // to keep at least one finger inside more often — which is
                // backwards from what most people naturally do. A much
                // bigger pad, PLUS checking the pinch's own midpoint (which
                // stays roughly centered near the caption for any pinch
                // style, side-by-side or diagonal), makes this reliable
                // regardless of exactly how the fingers are placed.
                const PAD = 90;
                const touchesSubtitle = (t) => !!subRect && t.clientX >= subRect.left - PAD && t.clientX <= subRect.right + PAD && t.clientY >= subRect.top - PAD && t.clientY <= subRect.bottom + PAD;
                const midpointOnSubtitle = (t1, t2) => {
                    if (!subRect) return false;
                    const mx = (t1.clientX + t2.clientX) / 2;
                    const my = (t1.clientY + t2.clientY) / 2;
                    return mx >= subRect.left - PAD && mx <= subRect.right + PAD && my >= subRect.top - PAD && my <= subRect.bottom + PAD;
                };

                if (subRect && (touchesSubtitle(e.touches[0]) || touchesSubtitle(e.touches[1]) || midpointOnSubtitle(e.touches[0], e.touches[1]))) {
                    const dx0 = e.touches[0].clientX - e.touches[1].clientX;
                    const dy0 = e.touches[0].clientY - e.touches[1].clientY;
                    const startDist0 = Math.sqrt(dx0 * dx0 + dy0 * dy0);
                    subtitlePinchStart.current = { dist: startDist0 > 10 ? startDist0 : 10, baseScale: liveValues.current.subtitleScale || 100 };
                    // Definitively a subtitle-resize gesture — never let it
                    // also arm video pinch-zoom or 2-finger speed-slide.
                    pinchStart.current = null;
                    twoFingerSpeedStart.current = null;
                    return;
                }
                subtitlePinchStart.current = null;

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
            dragNotchesRef.current = 0;

            dragStart.current = {
                x,
                y,
                zone,
                volume: liveValues.current.volume,
                brightness: liveValues.current.brightness,
                // Absolute position — same single source of truth seekBy
                // now uses (state.currentTime, the exact on-screen value).
                // Previously reconstructed as video.currentTime +
                // sessionTimeOffsetRef.current, which is only an ESTIMATE
                // that can diverge from what's actually displayed (see
                // seekBy's comment) — swipe-to-cancel would then restore to
                // that wrong estimate instead of the real pre-gesture time.
                currentTime: liveValues.current.currentTime,
                // Real element's own position at gesture start — used ONLY
                // to compute the actual <video> seek target as a delta from
                // ground truth (see handleTouchMove's horizontal branch and
                // its comment), never for display.
                videoTime: videoRef.current?.currentTime || 0,
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
                subtitlePinchStart.current = null;
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
            // Flush any in-flight rAF-throttled drag-seek write immediately
            // — touchend can land between animation frames, and without
            // this the very last bit of drag movement could be dropped.
            if (seekRafRef.current != null) {
                cancelAnimationFrame(seekRafRef.current);
                seekRafRef.current = null;
                const pending = pendingSeekTime.current;
                const v = videoRef.current;
                if (pending && v) {
                    v.currentTime = pending.real;
                    actions.setCurrentTime(pending.abs);
                    if (manualClockRef?.current) {
                        manualClockRef.current.baseX = pending.abs;
                        manualClockRef.current.baseTime = Date.now();
                    }
                }
                pendingSeekTime.current = null;
            }

            dragStart.current = null;
        },
        [actions, state.playing, containerRef, showControls, onTap, videoRef, manualClockRef, sessionTimeOffsetRef],
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

                // FIX (real remaining gap): don't just trust
                // subtitlePinchStart.current being already set — re-derive
                // subtitle containment fresh on EVERY touchmove. touchstart
                // can return early (via the data-gesture-exclude /
                // isGestureLocked checks earlier in handleTouchStart) before
                // EVER reaching any pinch-arming code at all, leaving
                // pinchStart.current unset — and the "wasn't armed at
                // touchstart" fallback further below has NO exclusion check
                // of its own, so it would arm video zoom anyway on the very
                // next touchmove. Checking geometry here, unconditionally,
                // closes that gap regardless of what did or didn't happen
                // at touchstart.
                const subEl = containerRef.current?.querySelector(".flux-subtitle-container");
                const subRect = subEl?.getBoundingClientRect();
                const PAD = 90; // same generous pad + midpoint fallback as touchstart above
                const touchesSubtitle = (t) => !!subRect && t.clientX >= subRect.left - PAD && t.clientX <= subRect.right + PAD && t.clientY >= subRect.top - PAD && t.clientY <= subRect.bottom + PAD;
                const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
                const midpointOnSubtitle = !!subRect && midX >= subRect.left - PAD && midX <= subRect.right + PAD && midY >= subRect.top - PAD && midY <= subRect.bottom + PAD;
                const onSubtitle = subRect && (touchesSubtitle(e.touches[0]) || touchesSubtitle(e.touches[1]) || midpointOnSubtitle);

                if (onSubtitle) {
                    const dxS = e.touches[0].clientX - e.touches[1].clientX;
                    const dyS = e.touches[0].clientY - e.touches[1].clientY;
                    const distS = Math.sqrt(dxS * dxS + dyS * dyS);
                    if (!subtitlePinchStart.current) {
                        // Wasn't armed at touchstart — arm it now, same
                        // lazy-arm pattern the video-zoom path already uses.
                        subtitlePinchStart.current = { dist: distS > 10 ? distS : 10, baseScale: liveValues.current.subtitleScale || 100 };
                        return;
                    }
                    const ratioS = distS / subtitlePinchStart.current.dist;
                    const newSubtitleScale = Math.round(Math.max(50, Math.min(200, subtitlePinchStart.current.baseScale * ratioS)));
                    actions.setSubtitleCustom({ subtitleScale: newSubtitleScale });
                    return; // never falls through to video pinch-zoom / speed-slide below
                }
                subtitlePinchStart.current = null;

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
                    // Reveal controls (default SeekBar included) the instant
                    // a drag-seek commits — without this, controls could
                    // still be hidden going into the gesture and the user
                    // has no seekbar to watch move in sync with the drag.
                    showControls();
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
                // MX-Player-style continuous seek: seek offset is a smooth
                // function of TOTAL drag distance from gesture start (dx is
                // already touch.x - dragStart.x), recomputed fresh every
                // touchmove — not accumulated notches. This is intentional
                // LIVE seeking (matches the existing architecture — the
                // video actually moves while dragging, same as double-tap),
                // just continuous instead of discrete ±10s steps.
                const video = videoRef.current;
                if (video && video.duration) {
                    // ── Swipe-to-cancel (doc Rule 3): drag down into the
                    // bottom margin while seeking aborts back to the
                    // pre-gesture timestamp.
                    if (y > rect.height * 0.92 && !seekCancelled.current) {
                        seekCancelled.current = true;
                        dragNotchesRef.current = 0;
                        if (seekRafRef.current != null) {
                            cancelAnimationFrame(seekRafRef.current);
                            seekRafRef.current = null;
                        }
                        pendingSeekTime.current = null;
                        // Restore the real element to exactly where it was
                        // at gesture start (captured directly, ground
                        // truth) — not a sessionOffset-converted absolute
                        // value, same fix as the rest of this file.
                        video.currentTime = dragStart.current.videoTime;
                        actions.setCurrentTime(dragStart.current.currentTime);
                        if (manualClockRef?.current) {
                            manualClockRef.current.baseX = dragStart.current.currentTime;
                            manualClockRef.current.baseTime = Date.now();
                        }
                        setOverlayState((s) => ({ ...s, seekCancelled: true, seekDir: "cancel" }));
                        triggerSeek();
                        return;
                    }
                    if (seekCancelled.current) return; // stay cancelled until finger lifts

                    const seekSeconds = computeDragSeekSeconds(dx);
                    const absDuration = state.duration || video.duration || Infinity;
                    const targetAbs = Math.max(0, Math.min(isFinite(absDuration) ? absDuration : Infinity, dragStart.current.currentTime + seekSeconds));

                    // Overlay updates every touchmove — cheap (just state),
                    // gives real-time, flicker-free readout at full touch
                    // frequency, independent of the throttled write below.
                    setOverlayState((s) => ({
                        ...s,
                        seekDir: seekSeconds >= 0 ? "forward" : "backward",
                        seekSec: Math.round(Math.abs(seekSeconds)),
                        seekTarget: targetAbs,
                    }));
                    triggerSeek();

                    // Actual video.currentTime / state writes throttled to
                    // once per animation frame — touchmove can fire faster
                    // than the video element (esp. HLS/MSE) needs, and
                    // writing on every raw event caused jank on lower-end
                    // devices. Always writes the LATEST target, never a
                    // stale intermediate one.
                    //
                    // REGRESSION FIX: the real write used to be
                    // `targetAbs - sessionOffset` — same fragile absolute-
                    // to-relative conversion as seekBy had, and the same
                    // bug (real seek lands wrong while display/overlay,
                    // no longer round-tripping through it, shows the
                    // correct number regardless). Fixed the same way: the
                    // REAL target is dragStart's captured real video
                    // position plus the seek offset — a delta from ground
                    // truth, never converted through sessionOffset. The
                    // ABSOLUTE target (for display/overlay) is unchanged.
                    const videoBound = isFinite(video.duration) ? video.duration : Infinity;
                    const realTarget = Math.max(0, Math.min(videoBound, dragStart.current.videoTime + seekSeconds));
                    pendingSeekTime.current = { real: realTarget, abs: targetAbs };
                    if (seekRafRef.current == null) {
                        seekRafRef.current = requestAnimationFrame(() => {
                            seekRafRef.current = null;
                            const pending = pendingSeekTime.current;
                            const v = videoRef.current;
                            if (!pending || !v) return;
                            v.currentTime = pending.real;
                            actions.setCurrentTime(pending.abs);
                            if (manualClockRef?.current) {
                                manualClockRef.current.baseX = pending.abs;
                                manualClockRef.current.baseTime = Date.now();
                            }
                        });
                    }
                }
            }
        },
        [
            state.isLocked,
            state.playbackSpeed,
            state.duration,
            containerRef,
            videoRef,
            actions,
            setOverlayState,
            showControls,
            triggerBrightness,
            triggerVolume,
            triggerSeek,
            triggerSpeedBoost,
            applyZoom,
            seekBy,
            manualClockRef,
            sessionTimeOffsetRef,
        ],
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
            if (seekRafRef.current != null) cancelAnimationFrame(seekRafRef.current);
        };
    }, [containerRef, handleTouchStart, handleTouchEnd, handleTouchMove]);

    // ── Expose APIs to container ref ──────────────────────────────────────────
    // FIX: was also assigning _toggleFullscreen/_togglePiP here — but both
    // LivePlayerPage.jsx and PlayerPage.jsx already assign those exact same
    // properties on this same containerRef themselves (their own page-level
    // implementations), and since parent effects run AFTER child effects on
    // mount, the page's version always won anyway, making this assignment
    // dead code that just made "which implementation actually runs" unclear.
    // _cycleSpeed/_resetZoom have no page-level equivalent — only this
    // component provides them — so those stay.
    useEffect(() => {
        if (containerRef.current) {
            containerRef.current._cycleSpeed = cycleSpeed;
            containerRef.current._resetZoom = resetZoom;
        }
    }, [containerRef, cycleSpeed, resetZoom]);

    return null;
}
