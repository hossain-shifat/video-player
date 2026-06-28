import { createContext, useContext, useReducer, useCallback, useMemo } from "react";

// ─── Initial State ────────────────────────────────────────────────────────────

const initialState = {
    playing: false,
    currentTime: 0,
    duration: 0,
    volume: 1,
    muted: false,
    brightness: 1, // 0.5 – 2 (CSS filter brightness)
    playbackSpeed: 1,
    isFullscreen: false,
    isPiP: false,
    loop: "none", // 'none' | 'one' | 'all'
    aspectRatio: "auto", // 'auto' | 'fill' | '16:9' | '4:3' | '1:1' | 'stretch'
    controlsVisible: true,
    isLocked: false,
    activeSubtitle: null, // track object { url, filename, ext, lang } or null
    subtitleDelay: 0, // ms (positive = delay, negative = advance)
    subtitleFontSize: 20, // px
    subtitleColor: "#ffffff",
    subtitleBgOpacity: 0.72,
    qualityLevels: [], // HLS quality levels [{ index, height, width, bitrate, label }]
    activeQuality: -1, // -1 = auto
    audioTracks: [], // [{ index, id, name, lang, default }]
    activeAudioTrack: 0,
    buffered: null, // TimeRanges
    isReady: false,
    isBuffering: false,
    stallCount: 0, // incremented on each stall for recovery tracking
    speedBoostActive: false,
    preSpeedBoost: 1,
    error: null,

    // ── New mobile control-bar features ────────────────────────────────────
    shuffle: false, // shuffle next-up queue (no-op without a queue, toggle only for now)
    sleepTimerEndsAt: null, // epoch ms when playback should auto-pause, or null = off
    sleepTimerPlayToEnd: false, // "Play last media to the end" — if true, don't hard-cut at the timer; wait for the current video to naturally end first
    abRepeat: { a: null, b: null, active: false }, // A-B repeat points in seconds
    backgroundPlay: false, // keep audio playing if tab/app backgrounded
    nightMode: false, // placeholder toggle, no visual effect yet (per product decision)
    eqEnabled: false, // master on/off — when false, VideoCore applies 0 gain on all bands regardless of stored values
    eqBands: { b60: 0, b230: 0, b910: 0, b4000: 0, b14000: 0 }, // dB, range -12..+12 each, 5-band (60/230/910/4000/14000 Hz)

    eqPreset: "normal", // 'custom' | 'normal' | 'classical' | 'dance' | 'flat' — manual slider edits switch this to 'custom'
    audioEffectPreset: "original", // 'original' | 'clarity' | 'bassBoost' | 'trebleBoost' | 'movie' | 'music' — convenience curves, same 5-band EQ under the hood
    decoderMode: "hw+", // 'hw' | 'hw+' | 'sw' — audio effects/EQ are disabled in pure 'hw' decode (no Web Audio graph access)
    // Mock audio-track selection UI (top-bar music-note icon). Backend
    // doesn't support real multi-track audio yet — this is placeholder
    // state matching the reference screenshots until that's wired up.
    mockAudioTrack: "HDHub4u.Ms - English",
    useSwAudioDecoder: false,
    bassBoostLevel: 0, // 0-100%, extra low-shelf boost layered on top of the 5-band EQ
    virtualizerLevel: 0, // 0-100%, stereo widening effect
    // Which 5 icons show in the collapsed mobile row before the chevron;
    // order also defines "Customise Items" drag-reorder result.
    quickIconOrder: ["eq", "speed", "screenshot", "audioFx", "rotation"],
    volumeBoost: 1, // 1.0-2.0 — software gain multiplier on top of native volume, doc: "Volume Boost up to 200%"
};

// ─── EQ preset curves (dB per band: 60/230/910/4000/14000 Hz) ────────────────
// Shared by both the Equalizer tab's named presets and the Audio Effect
// tab's convenience presets — they're the same 5-band graph underneath.
// Matrix per spec: Band1=60Hz, Band2=230Hz, Band3=910Hz, Band4=4kHz, Band5=14kHz.

export const EQ_PRESETS = {
    custom: null, // not a curve — manual mode, no auto-apply
    normal: { b60: 0, b230: 0, b910: 0, b4000: 0, b14000: 0 },
    classical: { b60: 5, b230: 3, b910: -2, b4000: 4, b14000: 4 },
    dance: { b60: 6, b230: 0, b910: 2, b4000: 4, b14000: 1 },
    flat: { b60: 0, b230: 0, b910: 0, b4000: 0, b14000: 0 },
    folk: { b60: 3, b230: 1, b910: 0, b4000: 2, b14000: -1 },
    heavyMetal: { b60: 4, b230: 1, b910: 9, b4000: 3, b14000: 0 },
    hipHop: { b60: 5, b230: 3, b910: 0, b4000: 1, b14000: 3 },
    jazz: { b60: 4, b230: 2, b910: -2, b4000: 2, b14000: 5 },
    pop: { b60: -2, b230: -1, b910: 5, b4000: 1, b14000: -2 },
    rock: { b60: 5, b230: 3, b910: -3, b4000: 2, b14000: 5 },
};

export const AUDIO_EFFECT_PRESETS = {
    original: { b60: 0, b230: 0, b910: 0, b4000: 0, b14000: 0 },
    clarity: { b60: -2, b230: 0, b910: 3, b4000: 4, b14000: 2 },
    bassBoost: { b60: 8, b230: 4, b910: 0, b4000: 0, b14000: 0 },
    trebleBoost: { b60: 0, b230: 0, b910: 0, b4000: 4, b14000: 7 },
    movie: { b60: 4, b230: 2, b910: 0, b4000: 1, b14000: 2 },
    music: { b60: 3, b230: 1, b910: 0, b4000: 2, b14000: 3 },
};

// ─── Action Types ─────────────────────────────────────────────────────────────

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
    SET_SUBTITLE_COLOR: "SET_SUBTITLE_COLOR",
    SET_SUBTITLE_BG_OPACITY: "SET_SUBTITLE_BG_OPACITY",
    SET_QUALITY_LEVELS: "SET_QUALITY_LEVELS",
    SET_ACTIVE_QUALITY: "SET_ACTIVE_QUALITY",
    SET_AUDIO_TRACKS: "SET_AUDIO_TRACKS",
    SET_ACTIVE_AUDIO_TRACK: "SET_ACTIVE_AUDIO_TRACK",
    SET_BUFFERED: "SET_BUFFERED",
    SET_READY: "SET_READY",
    SET_BUFFERING: "SET_BUFFERING",
    INCREMENT_STALL: "INCREMENT_STALL",
    SET_SPEED_BOOST: "SET_SPEED_BOOST",
    COMMIT_SPEED_BOOST: "COMMIT_SPEED_BOOST",
    SET_ERROR: "SET_ERROR",
    RESET: "RESET",
    TOGGLE_SHUFFLE: "TOGGLE_SHUFFLE",
    SET_SLEEP_TIMER: "SET_SLEEP_TIMER",
    TOGGLE_SLEEP_PLAY_TO_END: "TOGGLE_SLEEP_PLAY_TO_END",
    SET_AB_REPEAT: "SET_AB_REPEAT",
    TOGGLE_BACKGROUND_PLAY: "TOGGLE_BACKGROUND_PLAY",
    TOGGLE_NIGHT_MODE: "TOGGLE_NIGHT_MODE",
    TOGGLE_EQ: "TOGGLE_EQ",
    SET_EQ_BANDS: "SET_EQ_BANDS",
    SET_EQ_PRESET: "SET_EQ_PRESET",
    SET_AUDIO_EFFECT_PRESET: "SET_AUDIO_EFFECT_PRESET",
    SET_DECODER_MODE: "SET_DECODER_MODE",
    SET_MOCK_AUDIO_TRACK: "SET_MOCK_AUDIO_TRACK",
    TOGGLE_SW_AUDIO_DECODER: "TOGGLE_SW_AUDIO_DECODER",
    SET_BASS_BOOST_LEVEL: "SET_BASS_BOOST_LEVEL",
    SET_VIRTUALIZER_LEVEL: "SET_VIRTUALIZER_LEVEL",
    SET_QUICK_ICON_ORDER: "SET_QUICK_ICON_ORDER",
    SET_VOLUME_BOOST: "SET_VOLUME_BOOST",
};

// ─── Reducer ──────────────────────────────────────────────────────────────────

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
            return { ...state, brightness: Math.max(0.3, Math.min(2, action.payload)) };
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
            return { ...state, subtitleDelay: Math.max(-10000, Math.min(10000, action.payload)) };
        case A.SET_SUBTITLE_FONT_SIZE:
            return { ...state, subtitleFontSize: Math.max(10, Math.min(48, action.payload)) };
        case A.SET_SUBTITLE_COLOR:
            return { ...state, subtitleColor: action.payload };
        case A.SET_SUBTITLE_BG_OPACITY:
            return { ...state, subtitleBgOpacity: Math.max(0, Math.min(1, action.payload)) };
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
            return { ...state, isBuffering: action.payload };
        case A.INCREMENT_STALL:
            return { ...state, stallCount: state.stallCount + 1 };
        case A.SET_SPEED_BOOST:
            if (action.payload) {
                return { ...state, speedBoostActive: true, preSpeedBoost: state.playbackSpeed, playbackSpeed: 2 };
            } else {
                return { ...state, speedBoostActive: false, playbackSpeed: state.preSpeedBoost };
            }
        case A.COMMIT_SPEED_BOOST:
            // Turbo-lock: clear the transient boost flag but keep the
            // currently-boosted playbackSpeed instead of reverting to
            // preSpeedBoost — the user explicitly locked it in.
            return { ...state, speedBoostActive: false };
        case A.SET_ERROR:
            return { ...state, error: action.payload };
        case A.TOGGLE_SHUFFLE:
            return { ...state, shuffle: !state.shuffle };
        case A.SET_SLEEP_TIMER:
            return { ...state, sleepTimerEndsAt: action.payload };
        case A.TOGGLE_SLEEP_PLAY_TO_END:
            return { ...state, sleepTimerPlayToEnd: !state.sleepTimerPlayToEnd };
        case A.SET_AB_REPEAT:
            return { ...state, abRepeat: { ...state.abRepeat, ...action.payload } };
        case A.TOGGLE_BACKGROUND_PLAY:
            return { ...state, backgroundPlay: !state.backgroundPlay };
        case A.TOGGLE_NIGHT_MODE:
            return { ...state, nightMode: !state.nightMode };
        case A.TOGGLE_EQ:
            return { ...state, eqEnabled: !state.eqEnabled };
        case A.SET_EQ_BANDS: {
            const clamp = (v) => Math.max(-12, Math.min(12, v));
            return {
                ...state,
                eqBands: { ...state.eqBands, ...Object.fromEntries(Object.entries(action.payload).map(([k, v]) => [k, clamp(v)])) },
                eqPreset: "custom", // manual slider drag always detaches from whatever named preset was active
            };
        }
        case A.SET_EQ_PRESET: {
            const preset = action.payload;
            const curve = EQ_PRESETS[preset];
            return { ...state, eqPreset: preset, eqBands: curve ? { ...curve } : state.eqBands, audioEffectPreset: "original" };
        }
        case A.SET_AUDIO_EFFECT_PRESET: {
            const preset = action.payload;
            const curve = AUDIO_EFFECT_PRESETS[preset];
            return { ...state, audioEffectPreset: preset, eqBands: curve ? { ...curve } : state.eqBands, eqPreset: "custom" };
        }
        case A.SET_DECODER_MODE:
            return { ...state, decoderMode: action.payload };
        case A.SET_MOCK_AUDIO_TRACK:
            return { ...state, mockAudioTrack: action.payload };
        case A.TOGGLE_SW_AUDIO_DECODER:
            return { ...state, useSwAudioDecoder: !state.useSwAudioDecoder };
        case A.SET_BASS_BOOST_LEVEL:
            return { ...state, bassBoostLevel: Math.max(0, Math.min(100, action.payload)) };
        case A.SET_VIRTUALIZER_LEVEL:
            return { ...state, virtualizerLevel: Math.max(0, Math.min(100, action.payload)) };
        case A.SET_QUICK_ICON_ORDER:
            return { ...state, quickIconOrder: action.payload };
        case A.SET_VOLUME_BOOST:
            return { ...state, volumeBoost: Math.max(1, Math.min(2, action.payload)) };
        case A.RESET:
            return { ...initialState };
        default:
            return state;
    }
}

// ─── Context ──────────────────────────────────────────────────────────────────

export const PlayerContext = createContext(null);

/**
 * PlayerProvider — wraps the player page and provides all state + actions.
 */
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
    const setSubtitleColor = useCallback((v) => dispatch({ type: A.SET_SUBTITLE_COLOR, payload: v }), []);
    const setSubtitleBgOpacity = useCallback((v) => dispatch({ type: A.SET_SUBTITLE_BG_OPACITY, payload: v }), []);
    const setQualityLevels = useCallback((v) => dispatch({ type: A.SET_QUALITY_LEVELS, payload: v }), []);
    const setActiveQuality = useCallback((v) => dispatch({ type: A.SET_ACTIVE_QUALITY, payload: v }), []);
    const setAudioTracks = useCallback((v) => dispatch({ type: A.SET_AUDIO_TRACKS, payload: v }), []);
    const setActiveAudioTrack = useCallback((v) => dispatch({ type: A.SET_ACTIVE_AUDIO_TRACK, payload: v }), []);
    const setBuffered = useCallback((v) => dispatch({ type: A.SET_BUFFERED, payload: v }), []);
    const setReady = useCallback((v) => dispatch({ type: A.SET_READY, payload: v }), []);
    const setBuffering = useCallback((v) => dispatch({ type: A.SET_BUFFERING, payload: v }), []);
    const incrementStall = useCallback(() => dispatch({ type: A.INCREMENT_STALL }), []);
    const setSpeedBoost = useCallback((v) => dispatch({ type: A.SET_SPEED_BOOST, payload: v }), []);
    const commitSpeedBoost = useCallback(() => dispatch({ type: A.COMMIT_SPEED_BOOST }), []);
    const setError = useCallback((v) => dispatch({ type: A.SET_ERROR, payload: v }), []);
    const reset = useCallback(() => dispatch({ type: A.RESET }), []);
    const toggleShuffle = useCallback(() => dispatch({ type: A.TOGGLE_SHUFFLE }), []);
    const setSleepTimer = useCallback((v) => dispatch({ type: A.SET_SLEEP_TIMER, payload: v }), []);
    const toggleSleepPlayToEnd = useCallback(() => dispatch({ type: A.TOGGLE_SLEEP_PLAY_TO_END }), []);
    const setAbRepeat = useCallback((v) => dispatch({ type: A.SET_AB_REPEAT, payload: v }), []);
    const toggleBackgroundPlay = useCallback(() => dispatch({ type: A.TOGGLE_BACKGROUND_PLAY }), []);
    const toggleNightMode = useCallback(() => dispatch({ type: A.TOGGLE_NIGHT_MODE }), []);
    const toggleEq = useCallback(() => dispatch({ type: A.TOGGLE_EQ }), []);
    const setEqBands = useCallback((v) => dispatch({ type: A.SET_EQ_BANDS, payload: v }), []);
    const setEqPreset = useCallback((v) => dispatch({ type: A.SET_EQ_PRESET, payload: v }), []);
    const setAudioEffectPreset = useCallback((v) => dispatch({ type: A.SET_AUDIO_EFFECT_PRESET, payload: v }), []);
    const setDecoderMode = useCallback((v) => dispatch({ type: A.SET_DECODER_MODE, payload: v }), []);
    const setMockAudioTrack = useCallback((v) => dispatch({ type: A.SET_MOCK_AUDIO_TRACK, payload: v }), []);
    const toggleSwAudioDecoder = useCallback(() => dispatch({ type: A.TOGGLE_SW_AUDIO_DECODER }), []);
    const setBassBoostLevel = useCallback((v) => dispatch({ type: A.SET_BASS_BOOST_LEVEL, payload: v }), []);
    const setVirtualizerLevel = useCallback((v) => dispatch({ type: A.SET_VIRTUALIZER_LEVEL, payload: v }), []);
    const setQuickIconOrder = useCallback((v) => dispatch({ type: A.SET_QUICK_ICON_ORDER, payload: v }), []);
    const setVolumeBoost = useCallback((v) => dispatch({ type: A.SET_VOLUME_BOOST, payload: v }), []);

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
            setSubtitleColor,
            setSubtitleBgOpacity,
            setQualityLevels,
            setActiveQuality,
            setAudioTracks,
            setActiveAudioTrack,
            setBuffered,
            setReady,
            setBuffering,
            incrementStall,
            setSpeedBoost,
            commitSpeedBoost,
            setError,
            reset,
            toggleShuffle,
            setSleepTimer,
            toggleSleepPlayToEnd,
            setAbRepeat,
            toggleBackgroundPlay,
            toggleNightMode,
            toggleEq,
            setEqBands,
            setEqPreset,
            setAudioEffectPreset,
            setDecoderMode,
            setMockAudioTrack,
            toggleSwAudioDecoder,
            setBassBoostLevel,
            setVirtualizerLevel,
            setQuickIconOrder,
            setVolumeBoost,
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
            setSubtitleColor,
            setSubtitleBgOpacity,
            setQualityLevels,
            setActiveQuality,
            setAudioTracks,
            setActiveAudioTrack,
            setBuffered,
            setReady,
            setBuffering,
            incrementStall,
            setSpeedBoost,
            commitSpeedBoost,
            setError,
            reset,
            toggleShuffle,
            setSleepTimer,
            toggleSleepPlayToEnd,
            setAbRepeat,
            toggleBackgroundPlay,
            toggleNightMode,
            toggleEq,
            setEqBands,
            setEqPreset,
            setAudioEffectPreset,
            setDecoderMode,
            setMockAudioTrack,
            toggleSwAudioDecoder,
            setBassBoostLevel,
            setVirtualizerLevel,
            setQuickIconOrder,
            setVolumeBoost,
        ],
    );

    const value = useMemo(() => ({ state, actions }), [state, actions]);

    return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

/**
 * usePlayerState — consume player state and actions anywhere in the player tree.
 */
export function usePlayerState() {
    const ctx = useContext(PlayerContext);
    if (!ctx) throw new Error("usePlayerState must be used within PlayerProvider");
    return ctx;
}

export default usePlayerState;
