import { useState, useRef, useCallback, useEffect, useMemo, memo } from "react";
import { useNavigate } from "react-router";
import { getMedia } from "../../api/media";
import {
    Play,
    Pause,
    SkipBack,
    SkipForward,
    Volume2,
    VolumeX,
    Volume1,
    Maximize,
    Minimize,
    PictureInPicture2,
    Subtitles,
    ChevronLeft,
    ChevronRight,
    Unlock,
    MonitorPlay,
    Headphones,
    Check,
    Gauge,
    Repeat,
    Repeat1,
    Zap,
    Settings,
    AlignCenter,
    UnlockKeyhole,
    Moon,
    PenLine,
    Shuffle,
    VolumeOff,
    Timer,
    SlidersHorizontal,
    Camera,
    AudioLines,
    Lock,
    Mic2,
    Speaker,
    Film,
    Music2,
    MoreVertical,
    ChevronDown,
    Waves,
    X,
    GripVertical,
    Maximize2,
    MoveHorizontal,
    Tv,
    Square,
    ListVideo,
} from "lucide-react";
import { MdOutlineHighQuality, MdOutlineScreenRotation, MdScreenLockRotation, MdMusicNote, MdSubtitles } from "react-icons/md";
import { usePlayerState } from "./UsePlayerState";
import { useIsMobile } from "./useIsMobile";
import SeekBar from "./SeekBar";
// VideoSidebar.jsx now owns all the actual panel/menu CONTENT (per the
// refactor: PlayerControls.jsx keeps only the button row + open/close state
// + play-next/prev/library-nav logic; the popup/sidebar bodies themselves —
// what's actually INSIDE each menu — live in VideoSidebar.jsx). Imported
// back here since the buttons in this file are what trigger/render them.
import VideoSidebar, {
    SidebarItem,
    MenuShell,
    MenuItem,
    DisabledRow,
    PlaylistPanel,
    LiveChannelsPanel,
    QualityPicker,
    SpeedPicker,
    SubtitlePicker,
    AbRepeatPanel,
    AudioTrackPanel,
    DecoderModePanel,
    AudioFxPanel,
    SleepTimerPanel,
    CustomiseItemsPanel,
} from "./VideoSidebar";
// FIX: these are plain consts/a function, not components — importing them
// from VideoSidebar.jsx (alongside its component exports) was what broke
// Fast Refresh ("ALL_QUICK_ITEMS export is incompatible"). They live in
// their own file now; both files import from here directly.
import { DECODER_LABELS, ALL_QUICK_ITEMS, QUICK_KEYS_WITH_SIDEBAR, formatTime } from "./playerConstants";
import { SpeedSliderOverlay } from "./PlayerOverlays";

/**
 * PlayerControls.jsx — the button row/controls bar ONLY.
 *
 * Per the sidebar/content split: this file is responsible for what buttons
 * exist, what they look like, when they're enabled/highlighted, and what
 * happens on click (open a panel, seek, toggle play, switch quality, jump to
 * the next/previous video, etc). It does NOT render what's actually INSIDE
 * any panel/menu anymore — that content (audio track list, quality list,
 * subtitle list, equalizer, playlist sidebar, sleep timer, etc.) has moved
 * to VideoSidebar.jsx and is imported back in from there.
 *
 * Still lives here (control-bar-level, not panel content):
 *   - useLibraryNav — computes play-next/play-previous targets + the data
 *     the Playlist panel needs; used directly by the skip buttons in this
 *     file, so it stays here rather than moving with PlaylistPanel itself.
 *   - IconBtn, AspectToggleButton, LoopIcon, VolumeControl, SeekTimeRow,
 *     QuickIconRow — these ARE the visible control-bar elements themselves,
 *     not panel content, so they stay.
 */

// ─── Library navigation (Playlist sidebar + Play Next/Previous) ─────────────
//
// ASSUMPTIONS FLAGGED — I don't have api/media.js in this project, so this is
// a raw, self-contained fetch rather than using whatever wrapper function
// that file exports elsewhere. Confirmed from earlier in this project:
// grouper.js's real output shape is { movies: [...], series: [...], anime:
// [...] } where each series/anime entry has .seasons = { [num]: {
// seasonNumber, episodes: [{ id, episode, name, streamUrl, parsed, title,
// ... }] } } — that part is solid. What's NOT confirmed: the exact endpoint
// path (guessed /api/media, matching the route files seen in the project's
// file tree).
//
// Next AND Previous are both derived purely from this library/playlist
// order (movies array order; same-season → previous/next season → previous/
// next series' first/last episode for series+anime) — Previous used to be
// based on watch history instead ("whatever you watched right before this"),
// which is why it looked like it jumped to a random video instead of the
// actual previous item in the playlist.
function normalizeTitle(t) {
    return (t || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function findEpisodeInBucket(bucket, mediaId) {
    for (const series of bucket || []) {
        for (const seasonNum of Object.keys(series.seasons || {})) {
            const season = series.seasons[seasonNum];
            const episode = (season.episodes || []).find((e) => e.id === mediaId);
            if (episode) return { series, seasonNum: Number(seasonNum), episode };
        }
    }
    return null;
}

function useLibraryNav(mediaId) {
    const [library, setLibrary] = useState(null);

    useEffect(() => {
        let cancelled = false;
        // getMedia() with no params returns the whole library grouped by
        // type — exactly the { movies, series, anime } shape this hook needs.
        getMedia()
            .then((d) => !cancelled && setLibrary(d))
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, []);

    return useMemo(() => {
        if (!library || !mediaId) return { loading: true };

        // FIX (real bug, confirmed via useMedia.js): each category from
        // getMedia() is an object with an .items array inside — { movies:
        // { items: [...] }, series: { items: [...] }, ... } — not a bare
        // array like grouper.js's raw output alone suggested. This was the
        // actual "movies.find is not a function" crash: .movies was the
        // wrapper object, not the array.
        const movies = library.movies?.items || [];
        const seriesList = library.series?.items || [];
        const animeList = library.anime?.items || [];

        const currentMovie = movies.find((m) => m.id === mediaId);
        const inSeries = findEpisodeInBucket(seriesList, mediaId);
        const inAnime = !inSeries ? findEpisodeInBucket(animeList, mediaId) : null;
        const active = inSeries || inAnime;
        const currentType = currentMovie ? "movie" : inSeries ? "series" : inAnime ? "anime" : null;

        // ── Movie parts (multi-part films, e.g. "KGF Chapter 1/2") ──────────
        let movieParts = [];
        let nextPart = null;
        if (currentMovie?.partId) {
            movieParts = movies.filter((m) => m.partId && normalizeTitle(m.parsed?.title) === normalizeTitle(currentMovie.parsed?.title)).sort((a, b) => (a.parsed?.part || 0) - (b.parsed?.part || 0));
            const idx = movieParts.findIndex((m) => m.id === mediaId);
            nextPart = idx >= 0 ? movieParts[idx + 1] || null : null;
        }
        const otherMovies = movies.filter((m) => m.id !== mediaId && !movieParts.some((p) => p.id === m.id));

        // ── Next episode: same season → next season → next series/anime ────
        let nextMediaId = null;
        if (currentType === "movie") {
            if (nextPart) {
                nextMediaId = nextPart.id;
            } else {
                const idx = movies.findIndex((m) => m.id === mediaId);
                nextMediaId = movies[idx + 1]?.id || null;
            }
        } else if (active) {
            const { series, seasonNum, episode } = active;
            const seasonNums = Object.keys(series.seasons)
                .map(Number)
                .sort((a, b) => a - b);
            const season = series.seasons[seasonNum];
            const epIdx = (season.episodes || []).findIndex((e) => e.id === episode.id);
            if (epIdx >= 0 && epIdx < season.episodes.length - 1) {
                nextMediaId = season.episodes[epIdx + 1].id;
            } else {
                const nextSeasonNum = seasonNums.find((n) => n > seasonNum);
                if (nextSeasonNum != null) {
                    nextMediaId = series.seasons[nextSeasonNum].episodes?.[0]?.id || null;
                } else {
                    const bucket = inSeries ? seriesList : animeList;
                    const idx = bucket.findIndex((s) => s.id === series.id);
                    const nextSeries = bucket[idx + 1];
                    if (nextSeries) {
                        const firstSeasonNum = Object.keys(nextSeries.seasons)
                            .map(Number)
                            .sort((a, b) => a - b)[0];
                        nextMediaId = firstSeasonNum != null ? nextSeries.seasons[firstSeasonNum]?.episodes?.[0]?.id || null : null;
                    }
                }
            }
        }

        // ── Previous: mirror of the Next logic above, walking the SAME
        // playlist/library order backward — same movies array, same
        // season→previous season→previous series/anime chain for episodes.
        // FIX: this used to be "whatever history entry was watched right
        // before this one" — completely unrelated to playlist order, which
        // is exactly why Previous looked like it played a random video (it
        // played whatever you happened to watch earlier, not what's
        // actually previous in the playlist/series).
        let prevMediaId = null;
        if (currentType === "movie") {
            if (currentMovie?.partId && movieParts.length) {
                const idx = movieParts.findIndex((m) => m.id === mediaId);
                prevMediaId = idx > 0 ? movieParts[idx - 1].id : null;
            } else {
                const idx = movies.findIndex((m) => m.id === mediaId);
                prevMediaId = idx > 0 ? movies[idx - 1].id : null;
            }
        } else if (active) {
            const { series, seasonNum, episode } = active;
            const seasonNums = Object.keys(series.seasons)
                .map(Number)
                .sort((a, b) => a - b);
            const season = series.seasons[seasonNum];
            const epIdx = (season.episodes || []).findIndex((e) => e.id === episode.id);
            if (epIdx > 0) {
                prevMediaId = season.episodes[epIdx - 1].id;
            } else {
                const prevSeasonNum = [...seasonNums].reverse().find((n) => n < seasonNum);
                if (prevSeasonNum != null) {
                    const prevEpisodes = series.seasons[prevSeasonNum].episodes || [];
                    prevMediaId = prevEpisodes[prevEpisodes.length - 1]?.id || null;
                } else {
                    const bucket = inSeries ? seriesList : animeList;
                    const idx = bucket.findIndex((s) => s.id === series.id);
                    const prevSeries = idx > 0 ? bucket[idx - 1] : null;
                    if (prevSeries) {
                        const prevSeasonNums = Object.keys(prevSeries.seasons)
                            .map(Number)
                            .sort((a, b) => a - b);
                        const lastSeasonNum = prevSeasonNums[prevSeasonNums.length - 1];
                        const lastEpisodes = prevSeries.seasons[lastSeasonNum]?.episodes || [];
                        prevMediaId = lastEpisodes[lastEpisodes.length - 1]?.id || null;
                    }
                }
            }
        }

        return {
            loading: false,
            library,
            currentType,
            currentMovie,
            movieParts,
            nextPart,
            otherMovies,
            seriesList,
            animeList,
            activeSeriesInfo: active,
            activeBucketKey: inSeries ? "series" : inAnime ? "anime" : null,
            nextMediaId,
            prevMediaId,
        };
    }, [library, mediaId]);
}

const AUDIO_FLAGS = {
    English: "🇬🇧",
    Hindi: "🇮🇳",
    Bangla: "🇧🇩",
    Japanese: "🇯🇵",
    French: "🇫🇷",
    Spanish: "🇪🇸",
    Arabic: "🇸🇦",
    German: "🇩🇪",
    Korean: "🇰🇷",
    Chinese: "🇨🇳",
    Russian: "🇷🇺",
    Italian: "🇮🇹",
    Portuguese: "🇧🇷",
    Turkish: "🇹🇷",
};

// MX-Player-style aspect ratio ring. Index order is the cycle order.
// Maps directly onto the existing aspectRatio reducer values — "fill" is
// reused for CROP/Zoom since getAspectStyle() already implements it as
// objectFit:"cover" (true crop-to-fill), and "auto" is FIT (contain).
const ASPECT_RING = ["auto", "stretch", "fill", "16:9", "4:3"];
const ASPECT_TOAST = {
    auto: "Aspect Ratio: Fit to Screen",
    stretch: "Aspect Ratio: Stretch",
    fill: "Aspect Ratio: Zoom / Crop",
    "16:9": "Aspect Ratio: 16:9",
    "4:3": "Aspect Ratio: 4:3",
};

// Lucide icon per ring state, per spec: FIT→Maximize2, STRETCH→MoveHorizontal,
// CROP→Maximize, 16:9→Tv, 4:3→Square.
const ASPECT_ICON = {
    auto: Maximize2,
    stretch: MoveHorizontal,
    fill: Maximize,
    "16:9": Tv,
    "4:3": Square,
};

// Tiny manual sub-label under the icon for the two numeric modes — the
// icons alone don't read as "16:9" vs "4:3" at a glance otherwise.
const ASPECT_SUBLABEL = { "16:9": "16:9", "4:3": "4:3" };

const IconBtn = memo(function IconBtn({ onClick, active, children, size = "md", className = "", label, title }) {
    const p = size === "lg" ? "p-3.5" : size === "sm" ? "p-1.5" : "p-2";
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={label}
            title={title || label}
            className={`flux-icon-btn ${p} ${active ? "active" : ""} ${className}`}
            style={{ WebkitTapHighlightColor: "transparent" }}>
            {children}
        </button>
    );
});

function AspectToggleButton({ size = 19 }) {
    const { state, actions } = usePlayerState();
    const [toast, setToast] = useState(null);
    const toastTimer = useRef(null);

    const cycle = () => {
        const idx = ASPECT_RING.indexOf(state.aspectRatio);
        // Ring-buffer index: unknown/legacy values (e.g. old "1:1") fall back
        // to index 0 rather than NaN-looping.
        const next = ASPECT_RING[((idx === -1 ? 0 : idx) + 1) % ASPECT_RING.length];
        actions.setAspectRatio(next);
        setToast(ASPECT_TOAST[next]);
        clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), 1500);
    };

    useEffect(() => () => clearTimeout(toastTimer.current), []);

    const mode = ASPECT_RING.includes(state.aspectRatio) ? state.aspectRatio : "auto";
    const active = mode !== "auto";
    const sub = ASPECT_SUBLABEL[mode];
    const Icon = ASPECT_ICON[mode];

    return (
        <div style={{ position: "relative" }}>
            <button
                type="button"
                onClick={cycle}
                className="flux-icon-btn"
                style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1, padding: "6px 8px" }}
                aria-label="Aspect ratio">
                <Icon size={size} strokeWidth={1.8} stroke={active ? "var(--color-primary)" : "#fff"} color={active ? "var(--color-primary)" : "#fff"} />
                {sub && <span style={{ fontSize: 8, fontWeight: 700, color: active ? "var(--color-primary)" : "#fff", letterSpacing: "0.2px" }}>{sub}</span>}
            </button>
            {toast && (
                <div
                    style={{
                        position: "absolute",
                        bottom: "calc(100% + 10px)",
                        right: 0,
                        whiteSpace: "nowrap",
                        background: "rgba(10,10,14,0.92)",
                        color: "#fff",
                        fontSize: 12,
                        fontWeight: 600,
                        padding: "7px 12px",
                        borderRadius: 8,
                        zIndex: 50,
                        animation: "flux-popup-in 0.18s cubic-bezier(0.34, 1.56, 0.64, 1)",
                        pointerEvents: "none",
                    }}>
                    {toast}
                </div>
            )}
        </div>
    );
}

function LoopIcon({ loop }) {
    if (loop === "one") return <Repeat1 size={17} strokeWidth={1.8} style={{ color: "var(--color-primary)" }} />;
    if (loop === "all") return <Repeat size={17} strokeWidth={1.8} style={{ color: "var(--color-primary)" }} />;
    return <Repeat size={17} strokeWidth={1.8} style={{ color: "#fff" }} />;
}

const VolumeControl = memo(function VolumeControl() {
    const { state, actions } = usePlayerState();
    const [expanded, setExpanded] = useState(false);
    const timerRef = useRef(null);
    const VIcon = state.muted || state.volume === 0 ? VolumeX : state.volume < 0.5 ? Volume1 : Volume2;
    const expand = () => {
        clearTimeout(timerRef.current);
        setExpanded(true);
    };
    const collapse = () => {
        timerRef.current = setTimeout(() => setExpanded(false), 300);
    };
    return (
        <div className="flex items-center gap-1" onMouseEnter={expand} onMouseLeave={collapse}>
            <button onClick={() => actions.setMuted(!state.muted)} className="flux-icon-btn p-2" aria-label="Toggle mute">
                <VIcon size={18} strokeWidth={1.8} />
            </button>
            <div style={{ overflow: "hidden", transition: "width 0.22s cubic-bezier(0.4,0,0.2,1), opacity 0.22s", width: expanded ? 88 : 0, opacity: expanded ? 1 : 0 }}>
                <label htmlFor="player-volume-range" className="sr-only">
                    Volume
                </label>
                <input
                    id="player-volume-range"
                    name="player-volume"
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={state.muted ? 0 : state.volume}
                    onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        actions.setVolume(v);
                        if (v > 0) actions.setMuted(false);
                    }}
                    className="flux-volume-slider"
                />
            </div>
        </div>
    );
});

// FIX: was a single combined "current / duration (-remaining)" string.
// Per request: left side of the seek bar shows current-time / buffered-so-far
// (NOT total duration) — right side shows total duration by default, but
// toggles to remaining time on click/tap, staying on whichever the person
// picked until they toggle it again. Local useState is intentional here: this
// component remounts fresh every time a new video loads (PlayerPage keys its
// player subtree by mediaId), so the toggle naturally resets to the default
// (duration) on every new play/start without any extra reset logic needed.
// FIX: showRemaining used to be local useState — but this component lives
// inside the part of PlayerControls that fully unmounts whenever controls
// auto-hide (see the controlsVisible early-return above), so local state
// here was being wiped on every single tap, resetting the toggle back to
// "showing duration" each time. Moved to shared player state
// (state.showRemainingTime / actions.toggleRemainingTime in
// UsePlayerState.jsx), whose Provider lives up in PlayerPage and does NOT
// unmount when controls hide — so it now only resets when it's actually
// supposed to: a genuinely new video (this whole hook re-initializes per
// mediaId).
function SeekTimeRow({ style = {} }) {
    const { state, actions } = usePlayerState();

    const bufferedSec = (() => {
        const b = state.buffered;
        if (!b || !b.length) return 0;
        let maxEnd = 0;
        for (let i = 0; i < b.length; i++) {
            if (b.end(i) > maxEnd) maxEnd = b.end(i);
        }
        return maxEnd;
    })();
    const remaining = Math.max(0, state.duration - state.currentTime);

    // FIX: was hardcoded to a monospace font stack, which — being an inline
    // style — overrode index.css's global `* { font-family:
    // var(--flux-font-family) }` rule (inline always wins over any external
    // stylesheet, regardless of selector specificity). That's the app's
    // actual configured theme font (Inter by default, user-changeable),
    // used everywhere else — this row was the one place quietly not
    // matching it. Both x/p and y/z now explicitly reference the same CSS
    // variable, so there's no possibility of them drifting from each other.
    const valueStyle = {
        fontFamily: "var(--flux-font-family)",
        fontSize: 12,
        fontWeight: 600,
        color: "rgba(255,255,255,0.9)",
    };

    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                whiteSpace: "nowrap",
                ...style,
            }}>
            {/* Top-left: current time / buffered-so-far */}
            <div style={{ display: "flex", alignItems: "center", gap: 4, lineHeight: "normal", ...valueStyle }}>
                <span>{formatTime(state.currentTime)}</span>
                {/* FIX: was opacity 0.4 — raised per request ("/" too dim
                    compared to the values around it). */}
                <span style={{ opacity: 0.75 }}>/</span>
                <span>{formatTime(bufferedSec)}</span>
            </div>
            {/* Top-right: duration ↔ remaining toggle.
                FIX: was a <button> — even with every font property set
                explicitly inline, some browsers still apply their own
                user-agent line-height/font-smoothing to <button> elements
                that plain text doesn't get, which can make it LOOK like a
                different font even when the declared properties match
                exactly. A <span> has none of that baggage to fight against. */}
            <span
                role="button"
                tabIndex={0}
                onClick={actions.toggleRemainingTime}
                onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        actions.toggleRemainingTime();
                    }
                }}
                aria-label={state.showRemainingTime ? "Showing remaining time — tap to show total duration" : "Showing total duration — tap to show remaining time"}
                style={{ ...valueStyle, cursor: "pointer", lineHeight: "normal" }}>
                {state.showRemainingTime ? `-${formatTime(remaining)}` : formatTime(state.duration)}
            </span>
        </div>
    );
}

// ─── Quick Icon Row ───────────────────────────────────────────────────────────

function QuickIconRow({ videoRef, containerRef, openMenu, toggleMenu, controlsPhase, isPortraitOverride, isMobile }) {
    const { state, actions } = usePlayerState();
    const [expanded, setExpanded] = useState(false);
    const [slideOut, setSlideOut] = useState(false); // true during the collapse slide animation
    const [audioFxTab, setAudioFxTab] = useState("effect"); // which tab the shared eq/audioFx panel opens on
    const scrollRef = useRef(null);
    const overscrollStart = useRef(null); // { x, atEnd, atStart } captured at touchstart, used to detect swipe-past-boundary in either direction

    // FIX: auto-collapse the expanded row back to the 5-icon quick view once
    // controls fade out — so it doesn't silently stay expanded and pop back
    // open mid-expanded the next time controls reappear.
    useEffect(() => {
        if (controlsPhase === "HIDDEN" || controlsPhase === "ANIMATING_OUT") {
            setExpanded(false);
            setSlideOut(false);
        }
    }, [controlsPhase]);

    const collapseWithSlide = useCallback(() => {
        setSlideOut(true);
        // Slowed down per feedback — was 220ms/24px (felt too fast/subtle
        // to read as an intentional slide). 420ms with cubic-bezier ease-out
        // and a larger travel distance reads as a real, deliberate motion
        // instead of a flicker. Timeout below must match the CSS transition
        // duration exactly, or the icon set swaps mid-animation.
        setTimeout(() => {
            setExpanded(false);
            setSlideOut(false);
        }, 420);
    }, []);

    const expandWithSlide = useCallback(() => {
        setExpanded(true);
    }, []);

    // Swipe-past-the-boundary detection, symmetric both directions:
    //   - At the RIGHT scroll edge (end), pulling further left (negative
    //     dx) collapses — nowhere left to scroll, so the gesture becomes
    //     "swipe to collapse" instead of a dead pull.
    //   - At the LEFT scroll edge (start), pulling further right (positive
    //     dx) expands — same idea, mirrored. Works whether currently
    //     collapsed or expanded; collapsed view has no scroll at all so
    //     it's always "at the start" by definition.
    const handleTouchStart = useCallback((e) => {
        const el = scrollRef.current;
        if (!el) return;
        const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
        const atStart = el.scrollLeft <= 2;
        overscrollStart.current = {
            x: e.touches[0].clientX,
            atEnd,
            atStart,
        };
    }, []);

    const handleTouchMove = useCallback(
        (e) => {
            if (!overscrollStart.current) return;
            const dx = e.touches[0].clientX - overscrollStart.current.x;
            // Pulling further left (negative dx) past an already-maxed
            // scroll position, beyond a small threshold, triggers collapse.
            if (expanded && overscrollStart.current.atEnd && dx < -40) {
                collapseWithSlide();
                overscrollStart.current = null;
                return;
            }
            // Pulling right (positive dx) while already at the left edge —
            // expand. Collapsed view is always "at start" since it never
            // scrolls, so this fires on a plain left-to-right swipe there.
            if (!expanded && overscrollStart.current.atStart && dx > 40) {
                expandWithSlide();
                overscrollStart.current = null;
            }
        },
        [expanded, collapseWithSlide, expandWithSlide],
    );

    const handlers = {
        nightMode: { onClick: () => actions.toggleNightMode(), active: state.nightMode },
        customise: { onClick: () => toggleMenu("customise"), active: openMenu === "customise" },
        shuffle: { onClick: () => actions.toggleShuffle(), active: state.shuffle },
        loop: { onClick: () => actions.cycleLoop(), active: state.loop !== "none", iconOverride: <LoopIcon loop={state.loop} /> },
        mute: { onClick: () => actions.setMuted(!state.muted), active: state.muted },
        sleepTimer: { onClick: () => toggleMenu("sleepTimer"), active: !!state.sleepTimerEndsAt || openMenu === "sleepTimer" },
        abRepeat: {
            onClick: () => toggleMenu("abRepeat"),
            active: state.abRepeat.active || openMenu === "abRepeat",
            iconOverride: (
                <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", lineHeight: 1.05, textAlign: "center" }}>
                    A→
                    <br />
                    ←B
                </span>
            ),
        },
        audioFx: {
            onClick: () => {
                setAudioFxTab("effect");
                toggleMenu("eq");
            },
            active: openMenu === "eq" && audioFxTab === "effect",
        },
        eq: {
            onClick: () => {
                setAudioFxTab("equalizer");
                toggleMenu("eq");
            },
            active: state.eqEnabled || (openMenu === "eq" && audioFxTab === "equalizer"),
        },
        speed: {
            onClick: () => toggleMenu("speedSlider"),
            active: state.playbackSpeed !== 1,
            iconOverride: (
                <span style={{ display: "flex", alignItems: "center", fontSize: 15, fontWeight: 600, color: "#fff" }}>
                    {state.playbackSpeed} <X size={14} strokeWidth={2.9} />{" "}
                </span>
            ),
        },
        screenshot: {
            onClick: () => {
                const video = videoRef?.current;
                if (!video || !video.videoWidth) return;
                const canvas = document.createElement("canvas");
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                canvas.toBlob((blob) => {
                    if (!blob) return;
                    const url = URL.createObjectURL(blob);
                    // Open in a new tab instead of triggering a forced
                    // download — Chrome blocks/warns on programmatic blob
                    // downloads from plain http:// origins ("not saved
                    // securely"), which this LAN server runs on. Opening
                    // the image directly isn't subject to that same
                    // download-specific policy; long-press/right-click to
                    // save from there works normally.
                    const win = window.open(url, "_blank");
                    if (!win) {
                        // Popup blocked — fall back to a same-tab navigation
                        // so the screenshot still isn't silently lost.
                        window.location.href = url;
                    }
                    setTimeout(() => URL.revokeObjectURL(url), 60000);
                }, "image/png");
            },
        },
        bgPlay: { onClick: () => actions.toggleBackgroundPlay(), active: state.backgroundPlay },
        rotation: {
            onClick: () => containerRef?.current?._toggleRotation?.(),
            active: isPortraitOverride,
            iconOverride: isPortraitOverride ? <MdScreenLockRotation size={20} color="var(--color-primary)" /> : <MdOutlineScreenRotation size={20} color="#fff" />,
        },
    };
    const order = state.quickIconOrder;
    const visibleKeys = expanded ? Object.keys(ALL_QUICK_ITEMS) : order.slice(0, 5);
    return (
        <div
            ref={scrollRef}
            className="flux-quick-row"
            data-gesture-exclude="true"
            onTouchStart={(e) => {
                e.stopPropagation();
                handleTouchStart(e);
            }}
            onTouchMove={(e) => {
                e.stopPropagation();
                handleTouchMove(e);
            }}
            style={{
                display: "grid",
                gridAutoFlow: "column",
                gridAutoColumns: "max-content",
                alignItems: "start",
                gap: 0,
                overflowX: "auto",
                overflowY: "hidden",
                paddingBottom: 2,
                position: "relative",
                WebkitOverflowScrolling: "touch",
                scrollbarWidth: "none",
                msOverflowStyle: "none",
                // Native touch-action so the browser itself treats this as
                // a horizontally-pannable region, complementing the JS-level
                // exclusion above.
                touchAction: "pan-x",
                // Slide-out-to-collapse animation: when triggered, the whole
                // row translates left and fades, then swaps back to the
                // collapsed 5-icon set once the transition finishes (see
                // collapseWithSlide's matching 420ms timeout above). 60px
                // travel + ease-out cubic-bezier reads as a real slide
                // rather than a quick flicker.
                transform: slideOut ? "translateX(-60px)" : "translateX(0)",
                opacity: slideOut ? 0 : 1,
                transition: "transform 420ms cubic-bezier(0.16, 1, 0.3, 1), opacity 420ms cubic-bezier(0.16, 1, 0.3, 1)",
            }}>
            {visibleKeys.map((key) => {
                const item = ALL_QUICK_ITEMS[key];
                if (!item) return null;
                const h = handlers[key] || {};
                const Icon = item.icon;
                return (
                    <div key={key} style={{ position: "relative", flexShrink: 0 }}>
                        <button
                            onClick={() => {
                                const needsSidebar = QUICK_KEYS_WITH_SIDEBAR.has(key);
                                if (expanded && needsSidebar) {
                                    // Collapse the row first, then open the
                                    // sidebar once the collapse animation
                                    // finishes — opening it mid-collapse
                                    // rendered against stale layout. Plain
                                    // toggles (mute, shuffle, pip, etc.) have
                                    // no sidebar to wait for, so the row stays
                                    // exactly as the user left it for those.
                                    setSlideOut(true);
                                    setTimeout(() => {
                                        setExpanded(false);
                                        setSlideOut(false);
                                    }, 420);
                                    setTimeout(() => h.onClick?.(), 420);
                                } else {
                                    h.onClick?.();
                                }
                            }}
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                gap: expanded ? 4 : 0,
                                background: "transparent",
                                border: "none",
                                cursor: "pointer",
                                flexShrink: 0,
                                width: 56,
                                padding: 0,
                                WebkitTapHighlightColor: "transparent",
                                WebkitUserSelect: "none",
                                userSelect: "none",
                                outline: "none",
                                appearance: "none",
                                WebkitAppearance: "none",
                            }}>
                            <div
                                style={{
                                    width: 40,
                                    height: 40,
                                    borderRadius: "50%",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    background: h.active ? "color-mix(in oklch, var(--color-primary) 35%, transparent)" : "rgba(0,0,0,0.4)",
                                    border: "1px solid rgba(255,255,255,0.1)",
                                    WebkitTapHighlightColor: "transparent",
                                    outline: "none",
                                }}>
                                {h.iconOverride || <Icon size={20} strokeWidth={2} stroke={h.active ? "var(--color-primary)" : "#fff"} color={h.active ? "var(--color-primary)" : "#fff"} />}
                            </div>
                            {expanded && <span style={{ fontSize: 9.5, color: "rgba(255,255,255,0.85)", textAlign: "center", lineHeight: 1.15, fontWeight: 500 }}>{item.label}</span>}
                        </button>
                    </div>
                );
            })}
            {!expanded && (
                <button
                    onClick={() => setExpanded(true)}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 30,
                        height: 30,
                        borderRadius: "50%",
                        flexShrink: 0,
                        background: "rgba(0,0,0,0.4)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        cursor: "pointer",
                        // Align vertical center with the 38px icon circles
                        // above (not the full icon+label cell, which would
                        // visually sink the chevron below the icon row).
                        marginTop: 5,
                        padding: 0,
                        marginLeft: 2,
                        WebkitTapHighlightColor: "transparent",
                        outline: "none",
                    }}
                    aria-label="More options">
                    <ChevronRight size={16} color="#fff" strokeWidth={2} />
                </button>
            )}

            <CustomiseItemsPanel open={openMenu === "customise"} onClose={() => toggleMenu(null)} isMobile={isMobile} controlsPhase={controlsPhase} />
            <AbRepeatPanel open={openMenu === "abRepeat"} onClose={() => toggleMenu(null)} videoRef={videoRef} isMobile={isMobile} controlsPhase={controlsPhase} />
            <AudioFxPanel open={openMenu === "eq"} onClose={() => toggleMenu(null)} isMobile={isMobile} controlsPhase={controlsPhase} initialTab={audioFxTab} onTabChange={setAudioFxTab} />
        </div>
    );
}

// ─── PlayerControls ───────────────────────────────────────────────────────────

export default function PlayerControls({
    mediaInfo,
    videoRef,
    containerRef,
    subtitles = [],
    onBack,
    onShowControls,
    controlsPhase = "VISIBLE",
    isPortraitOverride = false,
    onSwitchQuality,
    mediaId,
    onSwitchChannel,
    showResumeDialog,
    resumeDialogFading,
    resumePoint,
    onResume,
    onStartOver,
    onDismissResumeDialog,
    sessionTimeOffsetRef,
}) {
    const navigate = useNavigate();
    const nav = useLibraryNav(mediaId);
    // FIX (back button required one click per media switch instead of one
    // click total): this used to be a plain push navigate() — every playlist
    // switch (or Next/Previous tap) added a NEW entry to browser/router
    // history. So Back/the chevron/Android back only ever popped ONE
    // switch at a time, landing on the previous video instead of leaving the
    // player. replace:true swaps the current history entry instead of
    // pushing a new one — no matter how many times media gets switched,
    // there's still only one entry for "the player" in history, so Back
    // always exits in a single click.
    const goToMedia = useCallback(
        (id) => {
            if (!id) return;
            navigate(`/player/${id}`, { replace: true });
        },
        [navigate],
    );
    const { state, actions } = usePlayerState();
    const isMobile = useIsMobile();
    const [openMenu, setOpenMenu] = useState(null);

    // Resume dialog needs to sit right above the seek bar with a small gap —
    // measured, not guessed, since the seek bar's screen position varies by
    // device/orientation/mobile-vs-desktop layout. seekRowRef is attached to
    // the small wrapper directly around SeekTimeRow+SeekBar further down.
    const seekRowRef = useRef(null);
    const [seekRowTop, setSeekRowTop] = useState(null);
    useEffect(() => {
        const measure = () => {
            if (seekRowRef.current) setSeekRowTop(seekRowRef.current.getBoundingClientRect().top);
        };
        measure();
        window.addEventListener("resize", measure);
        window.addEventListener("orientationchange", measure);
        const id = setInterval(measure, 500); // catches layout shifts (controls fading in/out, menu open/close) without needing a ResizeObserver per element
        return () => {
            window.removeEventListener("resize", measure);
            window.removeEventListener("orientationchange", measure);
            clearInterval(id);
        };
    }, []);

    const activeQualityLabel = state.activeQuality === -1 ? (state.qualityLevels.length ? "Auto" : "") : state.qualityLevels[state.activeQuality]?.label || "";

    const toggleMenu = useCallback((menu) => setOpenMenu((v) => (v === menu ? null : menu)), []);
    const closeMenu = useCallback(() => setOpenMenu(null), []);

    // VideoSidebar renders through a portal straight to document.body to
    // dodge parent opacity cascades — but that means interaction inside an
    // open sidebar (dragging a slider, tapping a list item) never bubbles up
    // through PlayerControls' own DOM tree, so it never reaches the
    // onClickCapture/onPointerDownCapture handlers on the top/center/bottom
    // bars that normally reset the 3s inactivity countdown. Without this,
    // controlsPhase can still march to ANIMATING_OUT/HIDDEN purely from idle
    // time while a menu is open, which visually drags the open sidebar's
    // containing controls layer down with it. Re-firing onShowControls on
    // an interval for as long as openMenu is set keeps the countdown
    // perpetually fresh, so the controls + whatever sidebar/menu is open
    // stay visible until the user explicitly closes it.
    useEffect(() => {
        if (!openMenu) return;
        onShowControls?.();
        const id = setInterval(() => onShowControls?.(), 1000);
        return () => clearInterval(id);
    }, [openMenu, onShowControls]);

    const seek = useCallback(
        (delta) => {
            const v = videoRef.current;
            if (v) v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + delta));
        },
        [videoRef],
    );

    const toggleFullscreen = () => containerRef.current?._toggleFullscreen?.();
    const togglePiP = () => containerRef.current?._togglePiP?.();

    // FIX: was `const title = mediaInfo?.title` shown alone in the top bar,
    // plus a separate `subtitle` string that was computed but never actually
    // rendered anywhere (dead code) — so series/anime only ever showed the
    // show name, no episode info. Now builds one combined line for
    // series/anime: "Show Name • Episode Name • S01 E02". Movies unaffected
    // — just the plain title, same as before.
    const isEpisodic = (mediaInfo?.type === "series" || mediaInfo?.type === "anime") && mediaInfo?.season && mediaInfo?.episode;
    const displayTitle = isEpisodic
        ? [mediaInfo.title, mediaInfo.episodeTitle, `SE-${String(mediaInfo.season).padStart(2, "0")} E-${String(mediaInfo.episode).padStart(2, "0")}`].filter(Boolean).join(" • ")
        : mediaInfo?.title || "";

    const iconMain = isMobile ? 30 : 26;
    const iconSub = isMobile ? 22 : 18;
    const iconTiny = isMobile ? 24 : 16;

    // FIX: no center play/pause bubble on mobile anymore — removed per
    // explicit request ("remove the center play pause button which is with
    // red bg"). Tap-to-toggle (wired in PlayerPage/PlayerGestures) is now
    // the ONLY way to bring controls back on mobile. Desktop already
    // returned null here (mouse movement reveals controls there).
    // ══════════════════════════════════════════════════════════════════════
    // RESUME DIALOG — moved here from PlayerPage.jsx. Computed as its own
    // stable element BEFORE the controlsVisible early-return below, and
    // rendered as a sibling OUTSIDE the controls tree that early-return
    // guards (see the final return statement) — NOT nested inside it.
    //
    // FIX (was reappearing on every tap): this used to live INSIDE the big
    // controls <div>, which this whole component stops rendering entirely
    // (`if (!state.controlsVisible) return null`) whenever controls
    // auto-hide. Every tap remounts that whole subtree from scratch, and a
    // freshly-mounted element can't be "mid-fade" — it just paints at
    // whatever its current style evaluates to, i.e. fully opaque again,
    // regardless of how much of the real 6s timeout had already elapsed.
    // That's what looked like "the resume overlay reappears on touch": it
    // wasn't reappearing, it was being destroyed and rebuilt at full
    // opacity on every single controls-visibility toggle.
    // Keeping it as a separate, always-present sibling (Fragment, see
    // bottom) means it only ever mounts/unmounts when showResumeDialog
    // itself changes — never because of controlsVisible — so its fade
    // timing (driven by useProgress's dialogFadeTimer, unchanged) plays out
    // for real, once, and stays gone after either the 6s timeout or the X.
    // ══════════════════════════════════════════════════════════════════════
    // RESUME DIALOG auto-close — OWNED HERE, not just relying on
    // useProgress.jsx's own internal timer. This is deliberately redundant:
    // whatever the exact reason the upstream timer wasn't reliably closing
    // this (report was "still not closing after 4s" even with that timer
    // verified correct on paper), a SECOND independent timer living right
    // next to where the dialog actually renders removes any dependency on
    // however many effects/props sit between here and useProgress. Calls the
    // same onDismissResumeDialog the X button already uses — identical
    // effect, just triggered by time instead of a click.
    const [localResumeFading, setLocalResumeFading] = useState(false);
    useEffect(() => {
        if (!showResumeDialog) {
            setLocalResumeFading(false);
            return undefined;
        }
        setLocalResumeFading(false);
        const fadeTimer = setTimeout(() => {
            setLocalResumeFading(true);
            setTimeout(() => onDismissResumeDialog?.(), 300);
        }, 4000);
        return () => clearTimeout(fadeTimer);
    }, [showResumeDialog, onDismissResumeDialog]);
    const resumeIsFading = resumeDialogFading || localResumeFading;

    const resumeDialogEl = showResumeDialog && (
        <div
            className="fixed left-0 right-0 z-60 flex justify-center px-4"
            style={{
                // FIX: was "absolute inset-0 ... items-end ... pb-28" — a fixed
                // 112px guess that put it mid-screen on some layouts instead
                // of hugging the seek bar. Now positioned using the actually
                // measured top edge of the seek bar row (seekRowTop), with an
                // 8px gap, and translateY(-100%) so it sits fully ABOVE that
                // line regardless of the dialog's own height.
                top: seekRowTop != null ? seekRowTop - 8 : undefined,
                bottom: seekRowTop == null ? 96 : undefined, // fallback before first measurement
                transform: seekRowTop != null ? "translateY(-100%)" : undefined,
                opacity: resumeIsFading ? 0 : 1,
                transition: "opacity 280ms ease",
                pointerEvents: "none",
            }}>
            {/* FIX: was one single horizontal row (text + both buttons all
                inline), with the X absolutely positioned on top of that same
                row — it ended up visually overlapping/competing with the
                Resume/Start Over buttons, which is the "weird" look. Now a
                proper card: header row (title/subtitle + X, X has its own
                clear corner with nothing else there) then a separate
                full-width button row underneath. */}
            <div
                className="relative pointer-events-auto flex flex-col gap-3 px-5 py-4
                            rounded-2xl bg-black/80 backdrop-blur-md border border-white/15
                            shadow-2xl max-w-sm w-full">
                <button
                    onClick={onDismissResumeDialog}
                    aria-label="Dismiss"
                    className="absolute top-3 right-3 w-6 h-6 rounded-full
                               flex items-center justify-center text-white/40
                               hover:text-white hover:bg-white/10 transition-colors">
                    <X size={14} strokeWidth={2} />
                </button>
                <div className="pr-6">
                    <p className="text-white text-sm font-semibold leading-tight">Resume watching?</p>
                    <p className="text-white/50 text-xs mt-0.5">
                        Paused at {Math.floor((resumePoint?.position || 0) / 60)}m {Math.floor((resumePoint?.position || 0) % 60)}s
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={onStartOver}
                        className="flex-1 px-3 py-2 rounded-lg bg-white/10 text-white/70 text-xs
                                   hover:bg-white/20 transition-colors">
                        Start Over
                    </button>
                    <button
                        onClick={onResume}
                        className="flex-1 px-3 py-2 rounded-lg bg-red-600 text-white text-xs
                                   font-semibold hover:bg-red-500 transition-colors">
                        Resume
                    </button>
                </div>
            </div>
        </div>
    );

    if (!state.controlsVisible) {
        return resumeDialogEl || null;
    }

    return (
        <>
            {resumeDialogEl}
            <div
                className="absolute inset-0 z-30 flex flex-col justify-between"
                style={{
                    // FIX (no fade-in on appear): ANIMATING_IN and VISIBLE both
                    // previously mapped to opacity:1 — but this component is
                    // UNMOUNTED while HIDDEN and remounts fresh when controls
                    // reappear. React's first painted frame on a fresh mount
                    // can't "transition into" a value; it just IS that value.
                    // Since ANIMATING_IN's first paint was already opacity:1,
                    // there was nothing for the CSS transition to animate FROM
                    // — hide worked (1→0 across two renders while staying
                    // mounted) but show silently didn't (mounted already at 1).
                    // ANIMATING_IN now paints at 0 on that first frame; the
                    // next render (phase flips to VISIBLE after FADE_IN_MS)
                    // changes it to 1, which is what the transition actually
                    // animates.
                    opacity: controlsPhase === "ANIMATING_OUT" || controlsPhase === "ANIMATING_IN" ? 0 : 1,
                    transition: controlsPhase === "ANIMATING_OUT" ? "opacity 300ms linear" : "opacity 150ms cubic-bezier(0.16, 1, 0.3, 1)",
                    // FIX ("nothing happens on second tap"): this was
                    // pointerEvents:"auto", making the ENTIRE full-screen
                    // overlay one giant hit-test box — including the visually
                    // empty middle area over the video. Every tap there got
                    // swallowed by this element instead of reaching the
                    // gesture layer below, so toggleControls() (which lives on
                    // PlayerGestures/VideoCore) never fired on that second tap.
                    // pointer-events:none here lets empty-area taps pass
                    // through; auto is re-enabled only on the actual bars
                    // below (top/center/bottom), which already had
                    // pointer-events-auto — the capture handler that marks
                    // activity moved onto those three specifically instead of
                    // sitting on this full-screen root.
                    pointerEvents: "none",
                }}>
                {/* Sleep Timer — full-screen overlay, not an anchored popup like
                    the others (matches reference screenshot's full-coverage
                    layout). Rendered at this level since QuickIconRow's own
                    container doesn't span the whole player. */}
                <SleepTimerPanel open={openMenu === "sleepTimer"} onClose={() => setOpenMenu(null)} isMobile={isMobile} controlsPhase={controlsPhase} />
                <SpeedSliderOverlay open={openMenu === "speedSlider"} onClose={() => setOpenMenu(null)} />

                {/* ══════════════════════════════════════════════════════════════════
                TOP BAR
                Order left→right: Back button → Title → [Quality] [Audio Track]
                [Subtitle] [Decoder] [More ⋮] → Quick icon row (mobile only,
                below the title row).
                To reorder the right-side icons, just move their numbered
                blocks (1-5) up/down inside the "shrink-0 ml-2" div below.
                ══════════════════════════════════════════════════════════════════ */}
                <div
                    className="flex flex-col gap-3 px-3 pt-5 flux-controls-top"
                    style={{
                        pointerEvents: controlsPhase === "ANIMATING_OUT" || openMenu === "speedSlider" ? "none" : "auto",
                        opacity: openMenu === "speedSlider" ? 0 : 1,
                        transition: "opacity 200ms ease",
                    }}
                    onClickCapture={onShowControls}
                    onPointerDownCapture={onShowControls}>
                    <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                            <button onClick={onBack} className="flux-icon-btn p-2 shrink-0" aria-label="Go back" style={{ color: "rgba(255,255,255,0.9)" }}>
                                <ChevronLeft size={24} strokeWidth={2.5} />
                            </button>
                            <div className="min-w-0 flex-1">
                                <p className="text-white font-semibold text-sm sm:text-base leading-tight truncate">{displayTitle}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-2">
                            {activeQualityLabel && !isMobile && <span className="flux-quality-badge">{activeQualityLabel}</span>}

                            {/* ── 1. QUALITY / RESOLUTION button ───────────────────────────
                            Opens <QualityPicker>. Only shows if there's more than
                            one quality level available (state.qualityLevels). */}
                            {(state.qualityLevels.length > 0 || onSwitchQuality) && (
                                <div style={{ position: "relative" }}>
                                    <button onClick={() => toggleMenu("quality")} className="flux-icon-btn p-2" aria-label="Quality">
                                        <MdOutlineHighQuality size={iconTiny} color="#fff" />
                                    </button>
                                    <QualityPicker open={openMenu === "quality"} onClose={closeMenu} isMobile={isMobile} controlsPhase={controlsPhase} onSwitchQuality={onSwitchQuality} />
                                </div>
                            )}

                            {/* ── 2. AUDIO TRACK button (music-note icon) ──────────────────
                            Opens <AudioTrackPanel> — reads real audio tracks from
                            state.audioTracks (populated by VideoCore.jsx from
                            hls.audioTracks on MANIFEST_PARSED). Switching tracks
                            is instant — HLS.js handles it via hls.audioTrack,
                            no new request to the server, no session restart. */}
                            <div style={{ position: "relative" }}>
                                <button onClick={() => toggleMenu("audioTrack")} className="flux-icon-btn p-2" aria-label="Audio track">
                                    <MdMusicNote size={iconTiny} />
                                </button>
                                <AudioTrackPanel open={openMenu === "audioTrack"} onClose={closeMenu} isMobile={isMobile} controlsPhase={controlsPhase} />
                            </div>

                            {/* ── 3. SUBTITLE button ────────────────────────────────────────
                            Opens <SubtitlePicker>. Highlights (active state) when
                            a subtitle track is currently selected. */}
                            <div style={{ position: "relative" }}>
                                <IconBtn onClick={() => toggleMenu("sub")} size="sm" label="Subtitles">
                                    <MdSubtitles size={iconTiny} />
                                </IconBtn>
                                <SubtitlePicker open={openMenu === "sub"} onClose={closeMenu} subtitles={subtitles} isMobile={isMobile} controlsPhase={controlsPhase} mediaId={mediaId} />
                            </div>

                            {/* ── 4. DECODER badge (HW / HW+ / SW) ──────────────────────────
                            Opens <DecoderModePanel>. Text label always shows the
                            current mode — see DECODER_LABELS for the short names. */}
                            <div style={{ position: "relative" }}>
                                <button
                                    onClick={() => toggleMenu("decoder")}
                                    className="flux-icon-btn"
                                    style={{ padding: "6px 10px", fontSize: 13, fontWeight: 700, color: "#fff" }}
                                    aria-label="Decoder mode">
                                    {DECODER_LABELS[state.decoderMode]}
                                </button>
                                <DecoderModePanel open={openMenu === "decoder"} onClose={closeMenu} isMobile={isMobile} controlsPhase={controlsPhase} />
                            </div>

                            {/* ── 5. OVERFLOW (3-dot) menu ──────────────────────────────────
                            Opens a small <MenuShell> with placeholder rows (Cast/
                            Share/Details). Add real rows here as features land —
                            just add more <DisabledRow>/<MenuItem> children below. */}
                            <div style={{ position: "relative" }}>
                                <button onClick={() => toggleMenu("overflow")} className="flux-icon-btn p-2" aria-label="More options">
                                    <MoreVertical size={20} strokeWidth={2} /> {/* iconTiny */}
                                </button>
                                <MenuShell isMobile={isMobile} controlsPhase={controlsPhase} open={openMenu === "overflow"} onClose={closeMenu} title="More" align="left">
                                    <DisabledRow label="Cast" />
                                    <DisabledRow label="Share" />
                                    <DisabledRow label="Details" />
                                </MenuShell>
                            </div>
                        </div>
                    </div>

                    {/* ── Quick icon row (mobile only — matches MX Player reference) ──
                    Lives inside the top bar div now (same gradient background,
                    same fade-out lifecycle) instead of as a separate sibling.
                    Gap to the header row above is the gap-3 (12px) on the
                    parent flex-col — adjust that single class to retune. */}
                    {isMobile && (
                        <QuickIconRow
                            videoRef={videoRef}
                            containerRef={containerRef}
                            openMenu={openMenu}
                            toggleMenu={toggleMenu}
                            controlsPhase={controlsPhase}
                            isPortraitOverride={isPortraitOverride}
                            isMobile={isMobile}
                        />
                    )}
                </div>

                {/* Center controls (desktop) removed per request — PC no longer
                shows a big center play/pause/skip cluster over the video.
                Mobile's own center cluster (further down, near the seek bar)
                is untouched. */}

                {/* ══════════════════════════════════════════════════════════════════
                BOTTOM BAR
                Top row (mobile only): current time / duration.
                Seek bar.
                Main row, 3 zones: [Lock] ... [skip-back / play-pause /
                skip-forward, centered] ... [loop/speed/PiP/fullscreen, right].
                Desktop has its own separate big center-play cluster further
                up the file (look for "Center controls (desktop)").
                ══════════════════════════════════════════════════════════════════ */}
                <div
                    className="px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flux-controls-bottom"
                    style={{
                        pointerEvents: controlsPhase === "ANIMATING_OUT" || openMenu === "speedSlider" ? "none" : "auto",
                        opacity: openMenu === "speedSlider" ? 0 : 1,
                        transition: "opacity 200ms ease",
                    }}
                    onClickCapture={onShowControls}
                    onPointerDownCapture={onShowControls}>
                    <div ref={seekRowRef}>
                        <div className="px-1 mb-1.5">
                            <SeekTimeRow />
                        </div>

                        <SeekBar videoRef={videoRef} sessionTimeOffsetRef={sessionTimeOffsetRef} />
                    </div>

                    <div className={`flex items-center mt-1 ${isMobile ? "justify-between" : "gap-1"}`} style={{ position: isMobile ? "relative" : "static" }}>
                        {/* ── LOCK button (mobile, far-left) ──────────────────────────── */}
                        {isMobile && (
                            <button
                                onClick={() => {
                                    actions.setLocked(true);
                                    actions.setControlsVisible(false);
                                }}
                                className="flux-icon-btn p-3"
                                aria-label="Lock screen">
                                <UnlockKeyhole size={20} strokeWidth={2.5} stroke="#fff" />
                            </button>
                        )}

                        {/* ── PLAYBACK cluster: play-previous / play-pause / play-next ──
                        SkipBack/SkipForward changed from ±10s seeking to
                        play-previous/play-next per request — see
                        useLibraryNav above for the actual next/prev logic
                        (movie parts → next movie; episode → next episode →
                        next season → next series; previous = last watched
                        from history). Disabled (dimmed) when there's nothing
                        to jump to. Mobile-only — desktop has no equivalent
                        cluster under the seek bar anymore (removed per
                        request, along with the old big center-of-video
                        cluster above). Stays pinned to the exact horizontal
                        center of the screen (position:absolute +
                        translateX(-50%)) so it stays centered regardless of
                        how wide the lock button or the right-side icon
                        cluster happen to be. */}
                        {isMobile && (
                            <div className="flex items-center gap-0.5" style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}>
                                <button
                                    type="button"
                                    onClick={() => goToMedia(nav.prevMediaId)}
                                    disabled={!nav.prevMediaId}
                                    className="flex flex-col items-center gap-0.5 flux-icon-btn p-3"
                                    style={{ opacity: nav.prevMediaId ? 1 : 0.35 }}
                                    aria-label="Play previous">
                                    <SkipBack size={iconSub} strokeWidth={1.8} />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => actions.setPlaying(!state.playing)}
                                    className="flux-icon-btn p-3"
                                    style={{ color: "#fff" }}
                                    aria-label={state.playing ? "Pause" : "Play"}>
                                    {state.playing ? <Pause size={iconMain} strokeWidth={2} fill="currentColor" /> : <Play size={iconMain} strokeWidth={2} fill="currentColor" />}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => goToMedia(nav.nextMediaId)}
                                    disabled={!nav.nextMediaId}
                                    className="flex flex-col items-center gap-0.5 flux-icon-btn p-3"
                                    style={{ opacity: nav.nextMediaId ? 1 : 0.35 }}
                                    aria-label="Play next">
                                    <SkipForward size={iconSub} strokeWidth={1.8} />
                                </button>
                            </div>
                        )}

                        {/* ── Desktop-only volume, sits where the playback cluster
                        used to live before the mobile centering change above.
                        Time display moved to SeekTimeRow above the seek bar. ── */}
                        {!isMobile && (
                            <div className="flex items-center gap-0.5">
                                <VolumeControl />
                            </div>
                        )}

                        {!isMobile && <div style={{ flex: 1 }} />}

                        {/* ── RIGHT-SIDE icon cluster (loop/speed/aspect/PiP/fullscreen) ── */}
                        <div className={`flex items-center shrink-0 ${isMobile ? "gap-0.5" : "gap-0.5"}`}>
                            <div style={{ position: "relative" }}>
                                <button onClick={() => toggleMenu("playlist")} className="flux-icon-btn p-2" aria-label="Playlist">
                                    <ListVideo size={iconTiny} color="#fff" />
                                </button>
                                {mediaInfo?.type === "live" ? (
                                    <LiveChannelsPanel
                                        open={openMenu === "playlist"}
                                        onClose={closeMenu}
                                        isMobile={isMobile}
                                        controlsPhase={controlsPhase}
                                        currentChannelUrl={mediaInfo?.url}
                                        onSwitchChannel={onSwitchChannel}
                                    />
                                ) : (
                                    <PlaylistPanel
                                        open={openMenu === "playlist"}
                                        onClose={closeMenu}
                                        isMobile={isMobile}
                                        controlsPhase={controlsPhase}
                                        mediaId={mediaId}
                                        nav={nav}
                                        onNavigate={goToMedia}
                                    />
                                )}
                            </div>
                            {!isMobile && (
                                <IconBtn onClick={() => actions.cycleLoop()} active={state.loop !== "none"} size="sm" label="Loop" title={`Loop: ${state.loop}`}>
                                    <LoopIcon loop={state.loop} />
                                </IconBtn>
                            )}
                            {!isMobile && (
                                <div style={{ position: "relative" }}>
                                    <button
                                        type="button"
                                        onClick={() => toggleMenu("speed")}
                                        style={{
                                            borderRadius: 8,
                                            border: "none",
                                            background: "transparent",
                                            color: state.playbackSpeed !== 1 ? "var(--color-primary)" : "#fff",
                                            fontWeight: 700,
                                            fontSize: 12,
                                            padding: "4px 8px",
                                            cursor: "pointer",
                                            minHeight: "auto",
                                            fontFamily: "ui-monospace,'SF Mono',monospace",
                                            letterSpacing: "0.3px",
                                            WebkitTapHighlightColor: "transparent",
                                        }}
                                        aria-label="Playback speed">
                                        {state.playbackSpeed}×
                                    </button>
                                    <SpeedPicker open={openMenu === "speed"} onClose={closeMenu} isMobile={isMobile} controlsPhase={controlsPhase} />
                                </div>
                            )}
                            {/* --- Quality (resolution) button moved to the TOP bar --- */}
                            {/* --- Subtitle button moved to the TOP bar --- */}
                            <AspectToggleButton size={isMobile ? 19 : 17} />
                            <IconBtn onClick={togglePiP} size="sm" className="hidden sm:flex" label="Picture in Picture">
                                <PictureInPicture2 size={16} strokeWidth={1.8} />
                            </IconBtn>
                            <IconBtn onClick={toggleFullscreen} size={isMobile ? "md" : "sm"} label={state.isFullscreen ? "Exit fullscreen" : "Fullscreen"}>
                                {state.isFullscreen ? <Minimize size={20} strokeWidth={1.8} /> : <Maximize size={20} strokeWidth={1.8} />}
                            </IconBtn>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
