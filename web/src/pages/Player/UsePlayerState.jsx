import { createContext, useContext, useReducer, useCallback, useMemo } from "react";

// ─── Initial State ──────────────────────────────────────────────────────────

const initialState = {
    playing: false,
    currentTime: 0,
    duration: 0,
    volume: 1,
    muted: false,
    brightness: 1, // 0.5–2 (CSS filter brightness)
    playbackSpeed: 1,
    isFullscreen: false,
    isPiP: false,
    loop: "none", // 'none' | 'one' | 'all'
    aspectRatio: "auto", // 'auto' | 'fill' | '16:9' | '4:3' | '1:1' | 'stretch'
    controlsVisible: true,
    isLocked: false,
    activeSubtitle: null, // subtitle track object or null
    subtitleDelay: 0, // ms
    subtitleFontSize: 20, // px
    qualityLevels: [], // HLS quality levels from HLS.js
    activeQuality: -1, // -1 = auto ABR
    audioTracks: [],
    activeAudioTrack: 0,
    buffered: null, // TimeRanges object
    isReady: false,
    isBuffering: false,
    isStalled: false, // NEW: stall detection (no timeupdate for >4s)
    speedBoostActive: false,
    preSpeedBoost: 1,
    error: null, // string | null
};

// ─── Action Types ────────────────────────────────────────────────────────────

export const A = {
    SET_PLAYING: "SET_PLAYING",
    SET_CURRENT_TIME: "SET_CURRENT_TIME",
    SET_DURATION: "SET_DURATION",
    SET_VOLUME: "SET_VOLUME",
    SET_MUTED: "SET_MUTED",
    SET_BRIGHTNESS: "SET_BRIGHTNESS",
    SET_PLAYBACK_SPEED: "SET_PLAYBACK_SPEED",
    SET_FULLSCREEN: "SET_FULLSCREEN",
    SET_PIP: "SET_PIP",
    SET_LOOP: "SET_LOOP",
    SET_ASPECT_RATIO: "SET_ASPECT_RATIO",
    SET_CONTROLS_VISIBLE: "SET_CONTROLS_VISIBLE",
    SET_LOCKED: "SET_LOCKED",
    SET_ACTIVE_SUBTITLE: "SET_ACTIVE_SUBTITLE",
    SET_SUBTITLE_DELAY: "SET_SUBTITLE_DELAY",
    SET_SUBTITLE_FONT_SIZE: "SET_SUBTITLE_FONT_SIZE",
    SET_QUALITY_LEVELS: "SET_QUALITY_LEVELS",
    SET_ACTIVE_QUALITY: "SET_ACTIVE_QUALITY",
    SET_AUDIO_TRACKS: "SET_AUDIO_TRACKS",
    SET_ACTIVE_AUDIO_TRACK: "SET_ACTIVE_AUDIO_TRACK",
    SET_BUFFERED: "SET_BUFFERED",
    SET_READY: "SET_READY",
    SET_BUFFERING: "SET_BUFFERING",
    SET_STALLED: "SET_STALLED", // NEW
    SET_SPEED_BOOST: "SET_SPEED_BOOST",
    SET_ERROR: "SET_ERROR",
    RESET: "RESET",
};

// ─── Reducer ─────────────────────────────────────────────────────────────────

function playerReducer(state, action) {
    switch (action.type) {
        case A.SET_PLAYING:
            return { ...state, playing: action.payload };
        case A.SET_CURRENT_TIME:
            return { ...state, currentTime: action.payload };
        case A.SET_DURATION:
            return { ...state, duration: action.payload };
        case A.SET_VOLUME:
            return { ...state, volume: Math.max(0, Math.min(1, action.payload)) };
        case A.SET_MUTED:
            return { ...state, muted: action.payload };
        case A.SET_BRIGHTNESS:
            return { ...state, brightness: Math.max(0.2, Math.min(2, action.payload)) };
        case A.SET_PLAYBACK_SPEED:
            return { ...state, playbackSpeed: action.payload };
        case A.SET_FULLSCREEN:
            return { ...state, isFullscreen: action.payload };
        case A.SET_PIP:
            return { ...state, isPiP: action.payload };
        case A.SET_LOOP: {
            const modes = ["none", "one", "all"];
            const next = action.payload !== undefined ? action.payload : modes[(modes.indexOf(state.loop) + 1) % modes.length];
            return { ...state, loop: next };
        }
        case A.SET_ASPECT_RATIO: {
            const ratios = ["auto", "fill", "16:9", "4:3", "1:1", "stretch"];
            const next = action.payload !== undefined ? action.payload : ratios[(ratios.indexOf(state.aspectRatio) + 1) % ratios.length];
            return { ...state, aspectRatio: next };
        }
        case A.SET_CONTROLS_VISIBLE:
            return { ...state, controlsVisible: action.payload };
        case A.SET_LOCKED:
            return { ...state, isLocked: action.payload };
        case A.SET_ACTIVE_SUBTITLE:
            return { ...state, activeSubtitle: action.payload };
        case A.SET_SUBTITLE_DELAY:
            return { ...state, subtitleDelay: action.payload };
        case A.SET_SUBTITLE_FONT_SIZE:
            return { ...state, subtitleFontSize: action.payload };
        case A.SET_QUALITY_LEVELS:
            return { ...state, qualityLevels: action.payload };
        case A.SET_ACTIVE_QUALITY:
            return { ...state, activeQuality: action.payload };
        case A.SET_AUDIO_TRACKS:
            return { ...state, audioTracks: action.payload };
        case A.SET_ACTIVE_AUDIO_TRACK:
            return { ...state, activeAudioTrack: action.payload };
        case A.SET_BUFFERED:
            return { ...state, buffered: action.payload };
        case A.SET_READY:
            return { ...state, isReady: action.payload };
        case A.SET_BUFFERING:
            // Buffering clears stall state (we know why we're waiting)
            return { ...state, isBuffering: action.payload, isStalled: action.payload ? false : state.isStalled };
        case A.SET_STALLED:
            return { ...state, isStalled: action.payload };
        case A.SET_SPEED_BOOST:
            if (action.payload) {
                return { ...state, speedBoostActive: true, preSpeedBoost: state.playbackSpeed, playbackSpeed: 2 };
            } else {
                return { ...state, speedBoostActive: false, playbackSpeed: state.preSpeedBoost };
            }
        case A.SET_ERROR:
            return { ...state, error: action.payload };
        case A.RESET:
            return { ...initialState };
        default:
            return state;
    }
}

// ─── Context ─────────────────────────────────────────────────────────────────

export const PlayerContext = createContext(null);

export function PlayerProvider({ children }) {
    const [state, dispatch] = useReducer(playerReducer, initialState);

    const setPlaying = useCallback((v) => dispatch({ type: A.SET_PLAYING, payload: v }), []);
    const setCurrentTime = useCallback((v) => dispatch({ type: A.SET_CURRENT_TIME, payload: v }), []);
    const setDuration = useCallback((v) => dispatch({ type: A.SET_DURATION, payload: v }), []);
    const setVolume = useCallback((v) => dispatch({ type: A.SET_VOLUME, payload: v }), []);
    const setMuted = useCallback((v) => dispatch({ type: A.SET_MUTED, payload: v }), []);
    const setBrightness = useCallback((v) => dispatch({ type: A.SET_BRIGHTNESS, payload: v }), []);
    const setPlaybackSpeed = useCallback((v) => dispatch({ type: A.SET_PLAYBACK_SPEED, payload: v }), []);
    const setFullscreen = useCallback((v) => dispatch({ type: A.SET_FULLSCREEN, payload: v }), []);
    const setPiP = useCallback((v) => dispatch({ type: A.SET_PIP, payload: v }), []);
    const cycleLoop = useCallback(() => dispatch({ type: A.SET_LOOP }), []);
    const setLoop = useCallback((v) => dispatch({ type: A.SET_LOOP, payload: v }), []);
    const cycleAspectRatio = useCallback(() => dispatch({ type: A.SET_ASPECT_RATIO }), []);
    const setAspectRatio = useCallback((v) => dispatch({ type: A.SET_ASPECT_RATIO, payload: v }), []);
    const setControlsVisible = useCallback((v) => dispatch({ type: A.SET_CONTROLS_VISIBLE, payload: v }), []);
    const setLocked = useCallback((v) => dispatch({ type: A.SET_LOCKED, payload: v }), []);
    const setActiveSubtitle = useCallback((v) => dispatch({ type: A.SET_ACTIVE_SUBTITLE, payload: v }), []);
    const setSubtitleDelay = useCallback((v) => dispatch({ type: A.SET_SUBTITLE_DELAY, payload: v }), []);
    const setSubtitleFontSize = useCallback((v) => dispatch({ type: A.SET_SUBTITLE_FONT_SIZE, payload: v }), []);
    const setQualityLevels = useCallback((v) => dispatch({ type: A.SET_QUALITY_LEVELS, payload: v }), []);
    const setActiveQuality = useCallback((v) => dispatch({ type: A.SET_ACTIVE_QUALITY, payload: v }), []);
    const setAudioTracks = useCallback((v) => dispatch({ type: A.SET_AUDIO_TRACKS, payload: v }), []);
    const setActiveAudioTrack = useCallback((v) => dispatch({ type: A.SET_ACTIVE_AUDIO_TRACK, payload: v }), []);
    const setBuffered = useCallback((v) => dispatch({ type: A.SET_BUFFERED, payload: v }), []);
    const setReady = useCallback((v) => dispatch({ type: A.SET_READY, payload: v }), []);
    const setBuffering = useCallback((v) => dispatch({ type: A.SET_BUFFERING, payload: v }), []);
    const setStalled = useCallback((v) => dispatch({ type: A.SET_STALLED, payload: v }), []);
    const setSpeedBoost = useCallback((v) => dispatch({ type: A.SET_SPEED_BOOST, payload: v }), []);
    const setError = useCallback((v) => dispatch({ type: A.SET_ERROR, payload: v }), []);
    const reset = useCallback(() => dispatch({ type: A.RESET }), []);

    const actions = useMemo(
        () => ({
            setPlaying,
            setCurrentTime,
            setDuration,
            setVolume,
            setMuted,
            setBrightness,
            setPlaybackSpeed,
            setFullscreen,
            setPiP,
            cycleLoop,
            setLoop,
            cycleAspectRatio,
            setAspectRatio,
            setControlsVisible,
            setLocked,
            setActiveSubtitle,
            setSubtitleDelay,
            setSubtitleFontSize,
            setQualityLevels,
            setActiveQuality,
            setAudioTracks,
            setActiveAudioTrack,
            setBuffered,
            setReady,
            setBuffering,
            setStalled,
            setSpeedBoost,
            setError,
            reset,
        }),
        [
            setPlaying,
            setCurrentTime,
            setDuration,
            setVolume,
            setMuted,
            setBrightness,
            setPlaybackSpeed,
            setFullscreen,
            setPiP,
            cycleLoop,
            setLoop,
            cycleAspectRatio,
            setAspectRatio,
            setControlsVisible,
            setLocked,
            setActiveSubtitle,
            setSubtitleDelay,
            setSubtitleFontSize,
            setQualityLevels,
            setActiveQuality,
            setAudioTracks,
            setActiveAudioTrack,
            setBuffered,
            setReady,
            setBuffering,
            setStalled,
            setSpeedBoost,
            setError,
            reset,
        ],
    );

    const value = useMemo(() => ({ state, actions }), [state, actions]);

    return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayerState() {
    const ctx = useContext(PlayerContext);
    if (!ctx) throw new Error("usePlayerState must be used within PlayerProvider");
    return ctx;
}

export default usePlayerState;
