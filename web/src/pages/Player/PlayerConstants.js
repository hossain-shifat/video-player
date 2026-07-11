// playerConstants.js
//
// Non-component values shared between VideoSidebar.jsx and PlayerControls.jsx.
// FIX: these used to live inside VideoSidebar.jsx alongside its component
// exports (SubtitlePicker, AudioTrackPanel, etc.) — Vite's Fast Refresh
// requires a file to export ONLY components to do a fine-grained hot
// update; a plain function/const/Set export mixed in forces a full reload
// instead, which is exactly the "ALL_QUICK_ITEMS export is incompatible"
// warning. Moving them here (and having both files import from here
// directly, instead of PlayerControls re-importing them through
// VideoSidebar) fixes it with no behavior change.

import { Moon, PenLine, Shuffle, Repeat, VolumeOff, Timer, AudioLines, SlidersHorizontal, Gauge, Camera, Headphones } from "lucide-react";
import { MdOutlineScreenRotation } from "react-icons/md";

export function formatTime(secs) {
    if (!secs || !isFinite(secs) || isNaN(secs)) return "0:00";
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
}

export const DECODER_LABELS = { hw: "HW", "hw+": "HW+", sw: "SW" };

export const ALL_QUICK_ITEMS = {
    nightMode: { label: "Night Mode", icon: Moon },
    customise: { label: "Customise Items", icon: PenLine },
    shuffle: { label: "Shuffle", icon: Shuffle },
    loop: { label: "Loop", icon: Repeat },
    mute: { label: "Mute", icon: VolumeOff },
    sleepTimer: { label: "Sleep Timer", icon: Timer },
    abRepeat: { label: "A - B Repeat", icon: Repeat }, // visual is the text glyph below (iconOverride), this is just a fallback
    audioFx: { label: "Audio Effect", icon: AudioLines },
    eq: { label: "Equalizer", icon: SlidersHorizontal },
    speed: { label: "Speed", icon: Gauge }, // visual is the "1×" text glyph below (iconOverride), this is just a fallback
    screenshot: { label: "Screenshot", icon: Camera },
    bgPlay: { label: "Background Play", icon: Headphones },
    rotation: { label: "Screen Rotation", icon: MdOutlineScreenRotation },
};

// Keys whose handler opens a sidebar/popup menu (toggleMenu(...)). These
// need the row collapse animation to finish FIRST, then the sidebar opens
// — opening it mid-collapse was rendering against stale layout. Everything
// else (mute, shuffle, pip, etc.) is an instant toggle with nothing to wait
// for, so it fires immediately and the row just collapses alongside it.
export const QUICK_KEYS_WITH_SIDEBAR = new Set(["customise", "sleepTimer", "abRepeat", "audioFx", "eq", "speed"]);
