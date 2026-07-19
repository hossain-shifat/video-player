/**
 * VideoSidebar.jsx — ALL sidebar/popup PANEL CONTENT lives here now.
 *
 * Split (per request): PlayerControls.jsx keeps only the button row itself
 * (icons, click handlers, open/close state, play-next/prev + library-nav
 * logic) and imports whatever it needs to trigger FROM this file. This file
 * owns everything that actually renders INSIDE a menu/sidebar once opened —
 * the quality list, audio track list, subtitle list, equalizer, sleep timer,
 * playlist, etc. — plus the two structural wrappers that make one set of
 * panel components work as both a mobile slide-in sidebar (VideoSidebar,
 * below) and a desktop popup (PopupMenu) via MenuShell picking the right one.
 *
 * Exports used by PlayerControls.jsx: MenuShell, MenuItem, DisabledRow,
 * PlaylistPanel, QualityPicker, SpeedPicker, SubtitlePicker, AbRepeatPanel,
 * AudioTrackPanel, DecoderModePanel, AudioFxPanel, SleepTimerPanel,
 * CustomiseItemsPanel — plus the default VideoSidebar export and
 * SidebarItem, both unchanged from before this split.
 *
 * DECODER_LABELS, ALL_QUICK_ITEMS, QUICK_KEYS_WITH_SIDEBAR, and formatTime
 * moved OUT to playerConstants.js (FIX: Vite Fast Refresh requires a file
 * to export only components — these are plain consts/functions, and mixing
 * them in here was breaking fine-grained hot reload for every component
 * below). Both this file and PlayerControls.jsx import them from there
 * directly now.
 *
 * One-directional dependency: this file never imports anything FROM
 * PlayerControls.jsx, to avoid a circular import between the two.
 */
import { useEffect, useState, useRef, memo } from "react";
import { createPortal } from "react-dom";
import {
    ArrowLeft,
    Play,
    Maximize,
    Subtitles,
    MonitorPlay,
    Headphones,
    Check,
    Gauge,
    Repeat,
    Settings,
    Timer,
    SlidersHorizontal,
    AudioLines,
    Lock,
    Mic2,
    Speaker,
    Film,
    Music2,
    ChevronDown,
    ChevronUp,
    Waves,
    GripVertical,
    Maximize2,
    MoveHorizontal,
    Tv,
    Square,
    FolderOpen,
} from "lucide-react";
import { usePlayerState } from "./UsePlayerState";
import { formatTime, DECODER_LABELS, ALL_QUICK_ITEMS, QUICK_KEYS_WITH_SIDEBAR } from "./playerConstants";
import { api } from "../../api/client";
import { getOrCreateClientId } from "../../api/stream";
import { useQuery, useQueries } from "@tanstack/react-query";
import { getLiveChannels } from "../../api/live";

// Backend base URL — used by the mediainfo.json fallback fetch (see
// SubtitlePicker) when a live track's language name is missing.
const BACKEND = import.meta.env.VITE_API_URL || "http://localhost:5000";

function useOrientation() {
    const [isLandscape, setIsLandscape] = useState(() => (typeof window === "undefined" ? true : window.innerWidth > window.innerHeight));
    useEffect(() => {
        const update = () => setIsLandscape(window.innerWidth > window.innerHeight);
        window.addEventListener("resize", update);
        window.addEventListener("orientationchange", update);
        return () => {
            window.removeEventListener("resize", update);
            window.removeEventListener("orientationchange", update);
        };
    }, []);
    return isLandscape;
}

/**
 * VideoSidebar — mobile-only slide-in panel replacing the old floating
 * dropdown menus. Landscape: slides from right, 40% width. Portrait:
 * slides from bottom, 40% height. PC keeps the old PopupMenu (caller's
 * job to render this only when isMobile).
 *
 * Stays open until manually closed (ArrowLeft button / tap outside) — never
 * auto-closes or fades on its own. This component has zero timers tied to
 * controlsPhase; the ONLY way it closes is the parent setting open=false.
 *
 * Rendered via createPortal(..., document.fullscreenElement || document.body)
 * — REQUIRED. PlayerControls is normally rendered inside a wrapper (in
 * PlayerPage.jsx) that fades to opacity:0 after 3s of inactivity. Without the
 * portal, this component is a normal DOM descendant of that wrapper, and CSS
 * opacity on a parent visually dims the WHOLE subtree at paint time —
 * position:fixed only escapes layout, not that opacity cascade. So even
 * though this component's own `visible`
 * state never changed, it looked like it was "auto-fading after 3s": it was
 * actually just inheriting the controls layer's own fade. The portal moves
 * it to document.body, fully outside that wrapper, so it's now visually and
 * functionally independent of the controls' inactivity timer.
 *
 * data-gesture-exclude="true" on the outer overlay is REQUIRED: the player's
 * gesture layer (PlayerGestures.jsx) attaches native touchstart/touchend
 * listeners directly on the video container and only skips elements whose
 * closest ancestor carries this marker. Without it, taps here also register
 * as taps on the video underneath — causing double-tap-seek and other
 * gestures to fire through the sidebar.
 */
export default function VideoSidebar({ open, onClose, title, children }) {
    const isLandscape = useOrientation();
    // Mount/visible are split so closing plays an exit animation instead of
    // an instant unmount: open=true → mount immediately, animate in next
    // frame. open=false → animate out first, unmount only after the
    // transition finishes.
    const [mounted, setMounted] = useState(open);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (open) {
            setMounted(true);
            // Next frame so the initial render starts from the off-screen
            // position before transitioning — required for the slide-in to
            // actually animate instead of snapping straight to place.
            const id = requestAnimationFrame(() => setVisible(true));
            return () => cancelAnimationFrame(id);
        }
        setVisible(false);
        const id = setTimeout(() => setMounted(false), 260);
        return () => clearTimeout(id);
    }, [open]);

    useEffect(() => {
        if (!mounted) return;
        const onKey = (e) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [mounted, onClose]);

    if (!mounted) return null;

    const offscreenTransform = isLandscape ? "translateX(100%)" : "translateY(100%)";

    const panelStyle = isLandscape
        ? {
              position: "fixed",
              top: 0,
              right: 0,
              bottom: 0,
              width: "40%",
              boxShadow: "-20px 0 60px rgba(0,0,0,0.5)",
          }
        : {
              position: "fixed",
              left: 0,
              right: 0,
              bottom: 0,
              height: "40%",
              borderRadius: "16px 16px 0 0",
              boxShadow: "0 -20px 60px rgba(0,0,0,0.5)",
          };

    return createPortal(
        <div
            className="flux-sidebar-overlay"
            data-gesture-exclude="true"
            onClick={onClose}
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 9999,
                background: "rgba(0,0,0,0.25)",
                opacity: visible ? 1 : 0,
                transition: "opacity 240ms cubic-bezier(0.16, 1, 0.3, 1)",
                pointerEvents: "auto",
            }}>
            <div
                className="flux-sidebar-panel"
                onClick={(e) => e.stopPropagation()}
                style={{
                    display: "flex",
                    flexDirection: "column",
                    background: "rgba(10, 10, 14, 0.94)",
                    transform: visible ? "translate(0, 0)" : offscreenTransform,
                    transition: "transform 260ms cubic-bezier(0.16, 1, 0.3, 1)",
                    pointerEvents: "auto",
                    ...panelStyle,
                }}>
                {/* Header row — reserves its own height so list content below
                    can never render underneath/overlap the title or close
                    button, which was happening in landscape when the title
                    floated independently above the panel with no space
                    reserved. */}
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        height: 44,
                        padding: "0 14px",
                        flexShrink: 0,
                    }}>
                    <button
                        onClick={onClose}
                        aria-label="Close"
                        style={{
                            width: 26,
                            height: 26,
                            borderRadius: "50%",
                            background: "rgba(255,255,255,0.14)",
                            border: "none",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            flexShrink: 0,
                            WebkitTapHighlightColor: "transparent",
                            outline: "none",
                        }}>
                        <ArrowLeft size={14} color="#fff" strokeWidth={2.5} />
                    </button>
                    <span style={{ color: "#fff", fontSize: 16, fontWeight: 700, flex: 1, minWidth: 0 }}>{title}</span>
                </div>
                {/* Scrollable body — flex:1 + minHeight:0 is required for the
                    overflow to actually constrain inside a flex column (without
                    minHeight:0 the child can refuse to shrink and just push
                    past the panel bounds, which read as "overlapping content"
                    in landscape where total height is tighter). Scrollbar is
                    hidden via .flux-sidebar-scroll in index.css. */}
                <div className="flux-sidebar-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 0 8px" }}>
                    {children}
                </div>
            </div>
        </div>,
        // FIX: was hardcoded document.body. LivePlayerPage's useLandscapeLock
        // calls containerRef.current.requestFullscreen() on mobile (real
        // Fullscreen API, not just a CSS/layout trick) — and per spec, only
        // the fullscreen element's own subtree actually paints while native
        // fullscreen is active. A portal to document.body sits outside that
        // subtree, so this drawer was opening (state changed fine, no error)
        // but was invisible the whole time on mobile Live. document.body is
        // still correct everywhere else (VOD doesn't engage real Fullscreen
        // API the same way on mobile), so fall back to it whenever nothing
        // is actually in native fullscreen.
        document.fullscreenElement || document.body,
    );
}

export function SidebarItem({ active, onClick, children, icon: Icon }) {
    return (
        <button
            onClick={onClick}
            className={`flux-sidebar-item ${active ? "active" : ""}`}
            style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                padding: "11px 16px",
                background: active ? "rgba(229,62,62,0.16)" : "transparent",
                border: "none",
                borderLeft: active ? "3px solid #e53e3e" : "3px solid transparent",
                color: "#fff",
                fontSize: 13.5,
                textAlign: "left",
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
            }}>
            {Icon && <Icon size={15} style={{ opacity: 0.65, flexShrink: 0 }} />}
            <span style={{ flex: 1, display: "flex", alignItems: "center", minWidth: 0 }}>{children}</span>
        </button>
    );
}

function bitrateLabel(bps) {
    if (!bps) return "";
    if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`;
    return `${Math.round(bps / 1000)} Kbps`;
}

function langAbbr(name) {
    if (!name) return "AUD";
    return name.slice(0, 3).toUpperCase();
}

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const PopupMenu = memo(function PopupMenu({ open, onClose, children, align = "right", side, title: menuTitle }) {
    const ref = useRef(null);
    useEffect(() => {
        if (!open) return;
        const close = (e) => {
            if (ref.current && !ref.current.contains(e.target)) onClose();
        };
        const id = setTimeout(() => document.addEventListener("mousedown", close), 50);
        return () => {
            clearTimeout(id);
            document.removeEventListener("mousedown", close);
        };
    }, [open, onClose]);
    if (!open) return null;
    // FIX: the quality picker's trigger button sits in a spot where the
    // default .flux-popup CSS (opens upward, anchored above the button) was
    // opening off the top edge / on the wrong side. Rather than touch the
    // shared CSS class (which every other picker also uses and shouldn't
    // change), an explicit side override wins via inline style only when a
    // caller actually asks for it — every other menu keeps its exact
    // existing default (no `side` passed = no change at all).
    const sideStyle = side === "bottom" ? { top: "100%", bottom: "auto", marginTop: 8 } : side === "top" ? { bottom: "100%", top: "auto", marginBottom: 8 } : {};
    return (
        <div ref={ref} className={`flux-popup ${align === "left" ? "align-left" : ""}`} style={{ zIndex: 60, ...sideStyle }}>
            {menuTitle && <div className="flux-popup-header">{menuTitle}</div>}
            {children}
        </div>
    );
});

function PopupItem({ active, onClick, children, icon: Icon }) {
    return (
        <button className={`flux-popup-item ${active ? "active" : ""}`} onClick={onClick}>
            {Icon && <Icon size={14} style={{ opacity: 0.6, flexShrink: 0 }} />}
            <span style={{ flex: 1, display: "flex", alignItems: "center", minWidth: 0 }}>{children}</span>
            {active && <Check size={13} className="check" />}
        </button>
    );
}

// ─── Dual-mode menu shell ────────────────────────────────────────────────────
// Mobile: VideoSidebar (right in landscape / bottom in portrait, 45% size).
// Desktop: old floating PopupMenu. One call site per picker, body unchanged.

export function MenuShell({ isMobile, open, onClose, title, children, align, side }) {
    if (isMobile) {
        return (
            <VideoSidebar open={open} onClose={onClose} title={title}>
                {children}
            </VideoSidebar>
        );
    }
    return (
        <PopupMenu open={open} onClose={onClose} title={title} align={align} side={side}>
            {children}
        </PopupMenu>
    );
}

export function MenuItem({ isMobile, active, onClick, children, icon }) {
    if (isMobile) {
        return (
            <SidebarItem active={active} onClick={onClick} icon={icon}>
                {children}
                {active && <Check size={13} style={{ marginLeft: "auto", flexShrink: 0 }} />}
            </SidebarItem>
        );
    }
    return (
        <PopupItem active={active} onClick={onClick} icon={icon}>
            {children}
        </PopupItem>
    );
}

// Fixed manual quality ladder for the on-demand switch (new backend session
// per tier — see PlayerPage.jsx's switchQuality). Separate from
// state.qualityLevels above, which reflects whatever hls.js found in the
// CURRENT manifest (currently always just the one variant actually being
// served) — these are user-requestable targets regardless of what's active.
const MANUAL_QUALITY_TIERS = ["1080p", "720p", "480p", "360p"];

// One series/anime's collapsible episode list. Multiple seasons render
// inside the SAME accordion, separated by a divider + "Season-N" header
// (not nested sub-accordions) — matches what was asked for.
// Adapted from MediaDetails.jsx's SeasonsPanel + EpisodeRow (same DaisyUI
// classes — bg-base-200, text-base-content, border-white/5, etc — so this
// looks consistent with the rest of the app instead of being a one-off
// inline-styled component). Added on top of the original: highlighting
// whichever episode is CURRENTLY PLAYING (currentEpisodeId), which
// MediaDetails' version has no concept of since it's not a "now playing"
// context there.
// Matches MediaDetails.jsx's real EpisodeRow + SeasonsPanel almost exactly
// (thumbnail, "E01" red episode badge, description, duration, play icon) —
// per request, reverted the extra series-level accordion wrapper from the
// previous version; this is flat, Season-level-only, same as the actual
// MediaDetails page. Added on top of the original: a static (non-collapsible)
// series title/poster label above the season list — not its own accordion,
// just enough to tell which show a season box belongs to when multiple
// series appear in this list — and highlighting whichever episode is
// CURRENTLY PLAYING, which MediaDetails has no concept of since it's not a
// now-playing context there.
function fmtRuntime(mins) {
    if (!mins) return null;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Uppercases a 2-3 letter language code into a short badge label. Best-effort —
// falls back to the raw value uppercased if it's not in the map.
const LANG_BADGE = { hi: "HI", en: "EN", ta: "TA", te: "TE", ml: "ML", kn: "KN", bn: "BN", pa: "PA", mr: "MR", gu: "GU", ja: "JA", ko: "KO", zh: "ZH", es: "ES", fr: "FR", de: "DE" };

/**
 * Landscape still for a library item — NEVER a poster (posters are portrait,
 * per request this whole panel is landscape thumbnails only). Prefers a
 * precomputed still/thumbnail field if the item already carries one (movies
 * may not; episodes already do via `ep.still` elsewhere in this file).
 * Otherwise falls back to the same on-demand ffmpeg frame-extraction endpoint
 * HistoryCard-style components use (api.thumbnailUrl) at a fixed offset
 * chosen to land past any black/logo intro on most files. Adjust FALLBACK_
 * STILL_SEC if 120s is consistently wrong for your library.
 */
const FALLBACK_STILL_SEC = 120;
// FIX (resolution not showing in the sidebar list): channel rows never
// displayed resolution at all. Backend channel objects don't reliably carry
// a dedicated resolution field (LiveCategory.jsx's quality filter sends
// "quality" as a search param, but individual channel results don't echo it
// back) — so this falls back to the same name-token parsing
// LivePlayerPage.jsx's extractNameMeta already does ("HD"/"4K"/"1080p" etc
// in the channel's raw name), preferring ch.resolution/ch.quality first in
// case the backend ever does start sending one.
const RES_TOKEN_RE = /(4k|uhd|2160p?|fhd|1080[ip]?|hd|720p?|sd|480[ip]?|576[ip]?)/i;
function resolutionFromChannel(ch) {
    if (ch?.resolution) return ch.resolution;
    if (ch?.quality) return ch.quality;
    const m = (ch?.name || "").match(RES_TOKEN_RE);
    if (!m) return null;
    const t = m[1].toLowerCase();
    if (t === "4k" || t === "uhd" || t.startsWith("2160")) return "4K";
    if (t === "fhd" || t.startsWith("1080")) return "1080p";
    if (t === "hd" || t.startsWith("720")) return "HD";
    if (t === "sd" || t.startsWith("480") || t.startsWith("576")) return "SD";
    return null;
}
// FIX: movie-only usages (MovieRow, NowPlayingCard, nextPart) now prefer the
// TMDB backdrop (landscape, same field SeriesAccordion already uses via
// seriesStill) over the ffmpeg-extracted still. Series/anime are untouched —
// they never call this, they use `seriesStill` / `ep.still` directly.
function stillUrl(m) {
    if (!m) return null;
    return m.metadata?.backdrop || m.backdrop || m.still || m.thumbnail || api.thumbnailUrl(m.id, FALLBACK_STILL_SEC, getOrCreateClientId());
}

/**
 * Resolution / source / codec / audio-language chips for a library item —
 * colorized per type (not a single flat gray) so they scan at a glance.
 * ASSUMPTION (no filename-parser schema was available to confirm exact field
 * names): reads m.parsed.{resolution,source,codec,languages} with a couple of
 * reasonable fallback field names, and silently omits any chip whose data
 * isn't present rather than showing "undefined". If your parser uses
 * different field names, this is the one place to fix them.
 */
function MediaBadges({ m, className = "" }) {
    const p = m?.parsed || {};
    const resolution = p.resolution || m?.resolution || null;
    const source = p.source || p.edition || null; // e.g. "BluRay", "WEB-DL"
    const codec = p.codec || p.videoCodec || null; // e.g. "x264", "HEVC"
    const languages = Array.isArray(p.languages) && p.languages.length ? p.languages : null;
    const audioLabel = languages ? languages.map((l) => LANG_BADGE[l?.toLowerCase()] || l?.toUpperCase()).join("+") : p.audio || null;

    if (!resolution && !source && !codec && !audioLabel) return null;

    return (
        <div className={`flex items-center gap-1 flex-wrap ${className}`}>
            {resolution && (
                <span className="inline-flex items-center gap-1 px-1.5 py-[3px] rounded-md border border-base-content/20 text-[10px] font-semibold tracking-wide text-base-content/65">
                    <MonitorPlay size={10} />
                    {resolution}
                </span>
            )}
            {codec && (
                <span className="inline-flex items-center gap-1 px-1.5 py-[3px] rounded-md border border-base-content/20 text-[10px] font-semibold tracking-wide text-base-content/65">
                    <Film size={10} />
                    {codec}
                </span>
            )}
            {audioLabel && (
                <span className="inline-flex items-center gap-1 px-1.5 py-[3px] rounded-md border border-base-content/20 text-[10px] font-semibold tracking-wide text-base-content/65">
                    <Music2 size={10} />
                    {audioLabel}
                </span>
            )}
            {source && <span className="px-1.5 py-[3px] rounded-md border border-base-content/20 text-[10px] font-semibold tracking-wide text-base-content/65">{source}</span>}
        </div>
    );
}

// One movie row in the "More Movies" list — landscape still + title + badges.
// Polished pass: softer rounded corners, subtle ring for definition against
// dark backgrounds, gentle hover lift + thumbnail zoom, faint bottom-gradient
// on the still for a touch of depth (matches the premium/streaming-app look
// requested) instead of a flat, purely-functional row.
function MovieRow({ m, onPlay }) {
    const still = stillUrl(m);
    const title = m?.metadata?.title || m?.parsed?.title || m?.name;
    return (
        <button
            onClick={() => onPlay(m.id)}
            className="w-full flex items-center gap-3 p-1.5 rounded-xl group hover:bg-base-300/40 hover:shadow-md active:scale-[0.99] transition-all duration-150 text-left">
            <div className="relative w-28 h-16 rounded-lg shrink-0 overflow-hidden ring-1 ring-white/10 shadow-sm">
                {still ? (
                    <img src={still} alt={title} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110" loading="lazy" />
                ) : (
                    <div className="w-full h-full bg-base-300 flex items-center justify-center">
                        <Film size={18} className="text-base-content/30" />
                    </div>
                )}
                {/* Subtle bottom gradient for depth — same treatment used across
                    the redesigned playlist thumbnails. */}
                <div className="absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-black/40 to-transparent pointer-events-none" />
                {/* Play badge — same circular-badge language as NowPlayingCard's
                    corner indicator, so the two components read as one system
                    instead of two different treatments. Hidden until hover. */}
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
                    <div className="w-7 h-7 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                        <Play size={13} className="text-black translate-x-[1px]" fill="currentColor" />
                    </div>
                </div>
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-base-content/90 truncate">{title}</p>
                <MediaBadges m={m} className="mt-1.5" />
            </div>
        </button>
    );
}

/**
 * "Now Playing" card — MOVIES ONLY. Series/anime use their full accordion
 * (moved to the top of the list, same accordion the show already renders
 * with — see PlaylistPanel) instead of a separate condensed card, per
 * explicit request. Landscape still, never a poster.
 * Polished pass: soft gradient accent background + ring (replacing the flat
 * solid border), and a small corner play-badge on the thumbnail itself —
 * this replaces the "● Now Playing" text label that was removed earlier
 * with a quieter visual cue that doesn't cost any vertical space.
 */
function NowPlayingCard({ m }) {
    const still = stillUrl(m);
    const title = m?.metadata?.title || m?.parsed?.title || m?.name;
    return (
        <div className="flex items-center gap-3 p-1.5 rounded-xl bg-gradient-to-r from-primary/15 via-primary/5 to-transparent ring-1 ring-primary/25 mb-2">
            <div className="relative w-28 h-16 rounded-lg shrink-0 overflow-hidden ring-1 ring-primary/30 shadow-sm">
                {still ? (
                    <img src={still} alt={title} className="w-full h-full object-cover" loading="lazy" />
                ) : (
                    <div className="w-full h-full bg-base-300 flex items-center justify-center">
                        <Play size={18} className="text-primary/60" />
                    </div>
                )}
                <div className="absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-black/50 to-transparent pointer-events-none" />
                {/* Small corner play-badge — quiet "this is playing" cue that
                    doesn't need its own text row. */}
                <div className="absolute bottom-1 right-1 w-4 h-4 rounded-full bg-primary flex items-center justify-center shadow">
                    <Play size={8} className="text-primary-content" fill="currentColor" />
                </div>
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-base-content truncate">{title}</p>
                <MediaBadges m={m} className="mt-1.5" />
            </div>
        </div>
    );
}

function EpisodeRow({ ep, isActive, onPlay }) {
    return (
        <div className={`flex items-center gap-3 p-2 rounded-lg group transition-colors cursor-pointer ${isActive ? "bg-primary/10" : "hover:bg-base-300"}`} onClick={() => ep.id && onPlay(ep.id)}>
            {ep.still ? (
                <img src={ep.still} alt={ep.title} className="w-20 h-12 object-cover rounded shrink-0" loading="lazy" />
            ) : (
                <div className="w-20 h-12 bg-base-300 rounded shrink-0 flex items-center justify-center">
                    <Play size={16} className="text-base-content/30 group-hover:text-primary transition-colors" />
                </div>
            )}
            <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium  ${isActive ? "text-primary" : "text-base-content"}`}>
                    {ep.episode != null && <span className={isActive ? "mr-1.5" : "text-primary mr-1.5"}>E{String(ep.episode).padStart(2, "0")}</span>}
                    {ep.title || ep.name}
                </p>
                {/* {ep.overview && <p className="text-xs text-base-content/45 line-clamp-2 mt-0.5">{ep.overview}</p>} */}
            </div>
            <div className="flex items-center gap-2 shrink-0">
                {ep.runtime && <span className="text-xs text-base-content/40">{fmtRuntime(ep.runtime)}</span>}
                {isActive ? <span className="w-1.5 h-1.5 rounded-full bg-primary" /> : <Play size={14} className="text-base-content/20 group-hover:text-primary transition-colors" />}
            </div>
        </div>
    );
}

// One accordion PER SERIES (not per season) — clicking the header opens/
// closes the whole show. Inside, all episodes across all seasons render as
// one flat list, with a plain-text "---- Season 02 ----" divider marking
// where each season's episodes begin — no nested per-season accordion.
function SeriesAccordion({ series, defaultOpen = false, currentEpisodeId, onNavigate }) {
    const seasonEntries = Object.entries(series.seasons || {}).sort(([a], [b]) => Number(a) - Number(b));
    const [isOpen, setIsOpen] = useState(defaultOpen);
    // FIX: was series.still || series.metadata?.poster — poster is portrait,
    // wrong aspect for this landscape header slot. metadata.backdrop is the
    // TMDB backdrop (landscape) — falls back to poster only if no backdrop
    // exists at all, so something still shows rather than nothing. Episode
    // thumbnails inside (EpisodeRow's ep.still) are untouched.
    const seriesStill = series.metadata?.backdrop || series.backdrop || series.metadata?.poster;
    const totalEpisodes = seasonEntries.reduce((sum, [, s]) => sum + (s.episodeCount ?? (s.episodes || []).length), 0);

    return (
        <div className="bg-base-200 rounded-xl overflow-hidden border border-white/5 mb-2">
            <button className="w-full flex items-center gap-3 p-0.5 hover:bg-base-300/50 transition-colors text-left" onClick={() => setIsOpen(!isOpen)}>
                {seriesStill ? (
                    <img src={seriesStill} alt={series.title} className="w-28 h-16 object-cover rounded shrink-0" loading="lazy" />
                ) : (
                    <div className="w-28 h-16 bg-base-300 rounded shrink-0 flex items-center justify-center">
                        <Tv size={18} className="text-base-content/30" />
                    </div>
                )}
                <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-base-content truncate">{series.title}</h3>
                    <p className="text-xs text-base-content/50 mt-0.5">
                        {seasonEntries.length} season{seasonEntries.length !== 1 ? "s" : ""} • {totalEpisodes} episode{totalEpisodes !== 1 ? "s" : ""}
                    </p>
                </div>
                {isOpen ? <ChevronUp size={16} className="text-base-content/40 shrink-0" /> : <ChevronDown size={16} className="text-base-content/40 shrink-0" />}
            </button>
            {isOpen && (
                <div className="px-2 py-3 space-y-1 border-t border-white/5">
                    {seasonEntries.map(([num, season]) => (
                        <div key={num}>
                            <div className="text-center text-[11px] font-semibold text-base-content/35 tracking-wide py-2">---- Season {String(num).padStart(2, "0")} ----</div>
                            {(season.episodes || []).map((ep) => (
                                <EpisodeRow key={ep.id || ep.episode} ep={ep} isActive={ep.id === currentEpisodeId} onPlay={onNavigate} />
                            ))}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export function PlaylistPanel({ open, onClose, isMobile, controlsPhase, mediaId, nav, onNavigate }) {
    if (!nav || nav.loading) {
        return (
            <MenuShell isMobile={isMobile} controlsPhase={controlsPhase} open={open} onClose={onClose} title="Playlist" side="bottom">
                <div className="text-center text-[13px] text-base-content/40 py-6">Loading…</div>
            </MenuShell>
        );
    }

    const { currentType, currentMovie, nextPart, otherMovies, seriesList, animeList, activeSeriesInfo, activeBucketKey } = nav;

    // Active show first, same list otherwise unchanged — this is what puts
    // its accordion (which already merges multiple seasons into ONE
    // accordion, divided by "Title • Season-N" headers, not separate
    // accordions per season) at the top instead of a separate condensed card.
    const orderedSeriesList =
        activeBucketKey === "series" && activeSeriesInfo
            ? [seriesList.find((s) => s.id === activeSeriesInfo.series.id), ...seriesList.filter((s) => s.id !== activeSeriesInfo.series.id)].filter(Boolean)
            : seriesList;
    const orderedAnimeList =
        activeBucketKey === "anime" && activeSeriesInfo
            ? [animeList.find((s) => s.id === activeSeriesInfo.series.id), ...animeList.filter((s) => s.id !== activeSeriesInfo.series.id)].filter(Boolean)
            : animeList;

    // FIX (desktop: playlist overflows off the top of the screen): the
    // desktop popup (PopupMenu, side="top") has no height cap of its own —
    // with enough movies/episodes it just grows past the top of the
    // viewport. Mobile already scrolls fine inside VideoSidebar's own
    // bottom-sheet container, so this only wraps content on desktop.
    // Scrollbar hidden per request (cross-browser: -webkit-scrollbar,
    // scrollbarWidth, msOverflowStyle) — scrolling still works via wheel/
    // trackpad/drag, just no visible track.
    const content = (
        <>
            {currentType === "movie" && (
                <div className="px-2">
                    {/* Now Playing — movies only; series/anime use their full
                        accordion moved to the top instead (see below). */}
                    <NowPlayingCard m={currentMovie} />

                    <div className="space-y-2">
                        {/* Movie continuation — only when the CURRENT item has a
                            next part available (e.g. watching Chapter 1, Chapter 2 exists).
                            Same landscape-still + badges treatment as everything else now,
                            placed directly under Now Playing so Part 1 → Part 2 reads as
                            one adjacent pair, not a separate plain-text row. */}
                        {nextPart && (
                            <button
                                onClick={() => onNavigate(nextPart.id)}
                                className="w-full flex items-center gap-3 p-1.5 rounded-xl bg-gradient-to-r from-primary/15 via-primary/5 to-transparent ring-1 ring-primary/20 hover:ring-primary/35 transition-all text-left">
                                <div className="relative w-28 h-16 rounded-lg shrink-0 overflow-hidden ring-1 ring-primary/25 shadow-sm">
                                    {stillUrl(nextPart) ? (
                                        <img src={stillUrl(nextPart)} alt="" className="w-full h-full object-cover" loading="lazy" />
                                    ) : (
                                        <div className="w-full h-full bg-base-300 flex items-center justify-center">
                                            <Film size={18} className="text-primary/40" />
                                        </div>
                                    )}
                                    <div className="absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-black/50 to-transparent pointer-events-none" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-[10px] font-bold text-primary tracking-wide uppercase mb-0.5">Part {nextPart.parsed?.part} • Continue</div>
                                    <p className="text-[13px] font-medium text-primary truncate">{nextPart.metadata?.title || nextPart.parsed?.title}</p>
                                    <MediaBadges m={nextPart} className="mt-1.5" />
                                </div>
                            </button>
                        )}
                        {otherMovies.length > 0 && (
                            <div className="flex items-center gap-2 px-2 pt-2 pb-0.5">
                                <span className="text-[11px] font-semibold text-base-content/40 uppercase tracking-wider">More Movies</span>
                                <div className="flex-1 h-px bg-base-content/10" />
                            </div>
                        )}
                        {otherMovies.map((m) => (
                            <MovieRow key={m.id} m={m} onPlay={onNavigate} />
                        ))}
                    </div>
                </div>
            )}

            {(currentType === "series" || currentType === "anime") && (
                <div className="px-2">
                    {currentType === "series" &&
                        orderedSeriesList.map((s) => (
                            <SeriesAccordion
                                key={s.id}
                                series={s}
                                defaultOpen={s.id === activeSeriesInfo?.series.id}
                                currentEpisodeId={s.id === activeSeriesInfo?.series.id ? mediaId : null}
                                onNavigate={onNavigate}
                            />
                        ))}

                    {currentType === "anime" &&
                        orderedAnimeList.map((s) => (
                            <SeriesAccordion
                                key={s.id}
                                series={s}
                                defaultOpen={s.id === activeSeriesInfo?.series.id}
                                currentEpisodeId={s.id === activeSeriesInfo?.series.id ? mediaId : null}
                                onNavigate={onNavigate}
                            />
                        ))}
                </div>
            )}
        </>
    );

    return (
        <MenuShell isMobile={isMobile} controlsPhase={controlsPhase} open={open} onClose={onClose} title="Playlist" side="bottom">
            {isMobile ? (
                content
            ) : (
                <>
                    <style>{`
                        .flux-playlist-scroll::-webkit-scrollbar { display: none; }
                    `}</style>
                    <div className="flux-playlist-scroll" style={{ maxHeight: "min(70vh, 560px)", overflowY: "auto", scrollbarWidth: "none", msOverflowStyle: "none" }}>
                        {content}
                    </div>
                </>
            )}
        </MenuShell>
    );
}

/**
 * LiveChannelsPanel — Live TV's equivalent of PlaylistPanel. Completely
 * separate data source (channel list, not the VOD library), reusing the
 * exact same API function + call shape Live.jsx already uses
 * (getLiveChannels with page/limit/workingOnly/all) — nothing about how
 * that data is fetched is reinvented here.
 *
 * Shows the OTHER channels (current one excluded), with a "Show active
 * only" toggle up top that flips the `all` flag on the SAME getLiveChannels
 * call, exactly like Live.jsx's "Active Only" / "All Channel" toggle does —
 * not a separate endpoint.
 */
// Same pref Live.jsx reads (Settings → Live tab "Hide non-working channels"),
// default false — matching Live.jsx exactly rather than guessing a
// different default that could return an empty list if channels haven't
// been through a recent health check.
function getLiveWorkingOnlyPref() {
    try {
        const prefs = JSON.parse(localStorage.getItem("flux-prefs") || "{}");
        return prefs.liveWorkingOnly === true;
    } catch {
        return false;
    }
}

// FIX (crash risk with 27,000+ non-active channels): the old single fetch
// used a flat `limit: 100` for BOTH modes — capped active channels at 100
// (fine today, not once the library grows) and would try to reason about
// the same shape for "all channels" too. Active channels are a small,
// curated set (today: 35) so one generous-limit fetch is plenty and never
// needs pagination. "All channels" is 27,000+ — that MUST page in on
// scroll (same IntersectionObserver + accumulated-pages pattern
// LiveCategory.jsx already uses), or the browser tries to render/hold tens
// of thousands of rows at once.
const PANEL_PAGE_LIMIT = 40; // per-fetch page size in "all channels" mode
const PANEL_ACTIVE_LIMIT = 200; // one-shot limit for "active only" mode — headroom above the current ~35 for future growth

export function LiveChannelsPanel({ open, onClose, isMobile, controlsPhase, currentChannelUrl, onSwitchChannel }) {
    // FIX (channels not loading): this used to call a separate
    // `getActiveLiveChannels()` function for "show active only" — but
    // Live.jsx (the known-working reference) never calls that endpoint at
    // all. It gets the exact same "Active Only" vs "All Channel" behavior
    // from the SAME getLiveChannels(...) call everywhere (CategoryRow,
    // SearchGrid, the banner query), just by passing `all: mode === "all"`.
    // Mirroring that here — one query fn, `all` flag flips the filter —
    // instead of a second endpoint that wasn't returning data.
    const [showActiveOnly, setShowActiveOnly] = useState(true);

    // Accumulated page numbers fetched so far, infinite-scroll style.
    // Active-only mode never needs more than page 1 (small dataset, high
    // limit) — this only actually grows in "all channels" mode.
    const [pages, setPages] = useState([1]);
    useEffect(() => {
        setPages([1]);
    }, [showActiveOnly, open]);

    const queryKeyBase = ["live", "channels", "panel", { workingOnly: getLiveWorkingOnlyPref(), all: !showActiveOnly }];

    // useQueries (not .map(useQuery)) — `pages` grows over time, and calling
    // useQuery inside .map() would change the hook count between renders.
    // Same reasoning as LiveCategory.jsx's identical pageQueries setup.
    const pageQueries = useQueries({
        queries: pages.map((p) => ({
            queryKey: [...queryKeyBase, p],
            queryFn: () =>
                getLiveChannels({
                    page: p,
                    limit: showActiveOnly ? PANEL_ACTIVE_LIMIT : PANEL_PAGE_LIMIT,
                    workingOnly: getLiveWorkingOnlyPref(),
                    all: !showActiveOnly,
                }),
            enabled: open,
            staleTime: 30 * 1000,
            keepPreviousData: true,
        })),
    });

    const isLoadingFirst = pageQueries[0]?.isLoading;
    const isFetchingMore = pageQueries.some((q) => q.isFetching) && pages.length > 1;
    const channelList = pageQueries.flatMap((pq) => pq.data?.channels ?? []);
    // Real total from the API (e.g. 35 active / 27,000+ all) — NOT
    // channelList.length, which is only however many pages have loaded so
    // far. This is what the header badge shows.
    const total = pageQueries[0]?.data?.total ?? channelList.length;
    const pageLimit = showActiveOnly ? PANEL_ACTIVE_LIMIT : PANEL_PAGE_LIMIT;
    const totalPages = pageQueries[0]?.data?.totalPages ?? Math.max(1, Math.ceil(total / pageLimit));
    // Active-only never paginates (one generous-limit fetch already covers
    // it) — only "all channels" mode ever has more pages to load.
    const hasMore = !showActiveOnly && pages.length < totalPages;

    // Infinite-scroll sentinel — loads the next page of "all channels" as
    // the user scrolls near the bottom, same pattern as LiveCategory.jsx.
    const sentinelRef = useRef(null);
    useEffect(() => {
        if (!sentinelRef.current || !hasMore || isFetchingMore || isLoadingFirst) return;
        const el = sentinelRef.current;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    setPages((prev) => (prev.length < totalPages ? [...prev, prev.length + 1] : prev));
                }
            },
            { rootMargin: "400px" },
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [hasMore, isFetchingMore, isLoadingFirst, totalPages]);

    const loading = isLoadingFirst;

    // FIX: current channel used to be filtered OUT entirely. Per request it
    // now stays in the list, pinned to the very top — just its status dot
    // switches to primary color as the "this one's playing" cue, no extra
    // active/highlighted row class needed. Note: in "all channels" mode this
    // only pins it once its page has actually loaded — deliberately NOT
    // fetching every page up front just to locate it, which would defeat
    // the whole point of paginating a 27,000+ channel list.
    // FIX (click plays whatever was already playing, not the tapped
    // channel): channel objects can come in two shapes in this codebase —
    // regular getLiveChannels results use {url, name, cleanName, logo}, but
    // "active"/fallback channel objects elsewhere (Live.jsx's
    // fallbackChannel) use {streamUrl, channelName, channelLogo}. Everything
    // here only ever read the first shape — in the second shape ch.url is
    // undefined, switchChannel built a channel with no url, and
    // LivePlayerPage's effect guard (`if (!channel?.url) return`) silently
    // no-ops, leaving the OLD stream running. Reading both shapes everywhere
    // a channel's url/name/logo is used closes that gap.
    const chUrl = (ch) => ch.url || ch.streamUrl;
    const currentChannel = channelList.find((ch) => chUrl(ch) === currentChannelUrl) || null;
    const restChannels = channelList.filter((ch) => chUrl(ch) !== currentChannelUrl);

    // FIX (category-wise, not A-Z): group the rest by ch.category instead of
    // one flat alphabetical list — same grouping key Live.jsx/LiveCategory.jsx
    // already show per-channel (ch.category), just used here to bucket
    // instead of only label. Order follows first-appearance across loaded
    // pages (backend order), not a re-sort.
    const categoryOrder = [];
    const categoryMap = new Map();
    for (const ch of restChannels) {
        const cat = ch.category || "General";
        if (!categoryMap.has(cat)) {
            categoryMap.set(cat, []);
            categoryOrder.push(cat);
        }
        categoryMap.get(cat).push(ch);
    }

    // One row — shared by the pinned current-channel row and every grouped
    // row below it. `isCurrent` only recolors the status dot to primary;
    // no separate highlighted/active row style per request.
    function ChannelRow({ ch, isCurrent }) {
        const name = ch.cleanName || ch.name || ch.channelName || "Channel";
        const logo = ch.logo || ch.channelLogo;
        const working = ch.streamStatus === "working";
        const dotClass = isCurrent ? "bg-primary" : working ? "bg-success" : "bg-base-content/20";
        const resLabel = resolutionFromChannel(ch);
        return (
            <button
                onClick={() => {
                    onSwitchChannel?.(ch);
                    onClose?.();
                }}
                className="w-full flex items-center gap-3 p-1.5 hover:bg-base-300/40 transition-colors text-left border-b border-white/5 last:border-b-0">
                {/* FIX: logo now fully covers the card (object-cover, no
                    padding) instead of floating contained inside it — matches
                    the "logo should be covered by the card" request. */}
                <div className="relative w-28 h-16 rounded-lg shrink-0 bg-black/20 flex items-center justify-center overflow-hidden ring-1 ring-white/10">
                    {logo ? <img src={logo} alt={name} className="w-full h-full object-cover" loading="lazy" /> : <Tv size={18} className="text-base-content/20" />}
                    <span className={`absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full ${dotClass}`} />
                    {resLabel && (
                        <span
                            className="absolute top-1 left-1 text-[9px] font-bold px-1 rounded"
                            style={{
                                background: resLabel === "4K" ? "rgba(255,200,50,0.85)" : resLabel === "SD" ? "rgba(255,255,255,0.25)" : "rgba(229,62,62,0.85)",
                                color: resLabel === "4K" ? "#000" : "#fff",
                            }}>
                            {resLabel}
                        </span>
                    )}
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-base-content/85 truncate">{name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                        {ch.category && ch.category !== "General" && <span className="text-[11px] text-base-content/40 truncate">{ch.category}</span>}
                        {ch.current?.title && <span className="text-[11px] text-base-content/40 truncate">▶ {ch.current.title}</span>}
                    </div>
                </div>
            </button>
        );
    }

    return (
        <MenuShell
            isMobile={isMobile}
            controlsPhase={controlsPhase}
            open={open}
            onClose={onClose}
            title={
                <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                    Playlist
                    {/* FIX: badge now shows the real API `total` (e.g. 35
                        active / 27,000+ all channels), not channelList.length
                        — which is only however many pages have loaded so far
                        and would visibly change as you scroll otherwise. */}
                    {total > 0 && (
                        <span
                            style={{
                                fontSize: 11,
                                fontWeight: 700,
                                lineHeight: 1,
                                padding: "3px 8px",
                                borderRadius: 999,
                                background: "var(--color-primary)",
                                color: "#fff",
                            }}>
                            {total}
                        </span>
                    )}
                </span>
            }
            side="top">
            {/* "Show active only" toggle — first row, right under the "← Playlist"
                header MenuShell already renders. Real slider toggle (not a
                checkmark) per request, default ON — toggling it off reveals
                all channels. */}
            {/* FIX (visible seam under header): background here was a
                slightly different rgba + backdrop-blur than the panel shell
                itself (VideoSidebar's own background, rgba(10,10,14,0.94)) —
                close enough to look like an intentional divider, but not an
                exact match, so it read as a stray gap/seam right under the
                header. Using the exact same solid color (no blur) makes this
                row visually continuous with the header instead. */}
            <div
                className="flex items-center justify-between px-3 py-2 mb-1"
                style={{
                    position: "sticky",
                    top: 0,
                    zIndex: 5,
                    // The scrollable body (.flux-sidebar-scroll) all menus
                    // share has its own paddingTop:4 — pulling this row up
                    // by that same 4px and adding it back as this row's own
                    // paddingTop closes that gap instead of leaving a sliver
                    // of the container's padding visible above it.
                    marginTop: -4,
                    paddingTop: 4,
                    background: "rgba(10, 10, 14, 0.94)",
                }}>
                <span className="text-sm text-base-content/80">Show active only</span>
                {/* FIX: was DaisyUI's `toggle toggle-sm toggle-primary` — reads
                    rectangular/blocky, inconsistent with every other on/off
                    switch in the player (Equalizer's enable toggle, etc.),
                    which all use this same round pill + sliding circle knob. */}
                <button
                    onClick={() => setShowActiveOnly((v) => !v)}
                    role="switch"
                    aria-checked={showActiveOnly}
                    style={{
                        width: 44,
                        height: 26,
                        borderRadius: 999,
                        border: "none",
                        position: "relative",
                        background: showActiveOnly ? "var(--color-primary)" : "rgba(255,255,255,0.2)",
                        cursor: "pointer",
                        flexShrink: 0,
                        transition: "background 0.15s",
                    }}>
                    <span
                        style={{
                            position: "absolute",
                            top: 3,
                            left: showActiveOnly ? 21 : 3,
                            width: 20,
                            height: 20,
                            borderRadius: "50%",
                            background: "#fff",
                            transition: "left 0.15s",
                        }}
                    />
                </button>
            </div>

            {/* FIX (desktop: playlist overflows off the top of the screen):
                same fix as PlaylistPanel — the desktop popup has no height
                cap of its own, so a long/paginated channel list just grows
                past the top of the viewport. Wraps only the LIST (sticky
                toggle above stays put, doesn't scroll with it). Mobile
                already scrolls fine inside VideoSidebar's own bottom-sheet
                container. Scrollbar hidden per request — scrolling still
                works via wheel/trackpad, just no visible track. */}
            {isMobile ? (
                <div className="px-2">
                    {loading ? (
                        <div className="text-center text-[13px] text-base-content/40 py-6">Loading…</div>
                    ) : channelList.length === 0 ? (
                        <div className="text-center text-[13px] text-base-content/40 py-6">{showActiveOnly ? "No active channels pinned yet." : "No other channels found."}</div>
                    ) : (
                        <>
                            {currentChannel && (
                                <div className="mb-2">
                                    <ChannelRow ch={currentChannel} isCurrent />
                                </div>
                            )}
                            {categoryOrder.map((cat) => (
                                <div key={cat} className="mb-1">
                                    <div className="text-[11px] font-semibold text-base-content/35 tracking-wide py-2 px-1">{cat}</div>
                                    {categoryMap.get(cat).map((ch) => (
                                        <ChannelRow key={ch.id ?? ch.url} ch={ch} isCurrent={false} />
                                    ))}
                                </div>
                            ))}
                            {hasMore && (
                                <div ref={sentinelRef} className="text-center text-[12px] text-base-content/30 py-4">
                                    {isFetchingMore ? "Loading more…" : ""}
                                </div>
                            )}
                        </>
                    )}
                </div>
            ) : (
                <>
                    <style>{`
                        .flux-channels-scroll::-webkit-scrollbar { display: none; }
                    `}</style>
                    <div className="flux-channels-scroll px-2" style={{ maxHeight: "min(70vh, 560px)", overflowY: "auto", scrollbarWidth: "none", msOverflowStyle: "none" }}>
                        {loading ? (
                            <div className="text-center text-[13px] text-base-content/40 py-6">Loading…</div>
                        ) : channelList.length === 0 ? (
                            <div className="text-center text-[13px] text-base-content/40 py-6">{showActiveOnly ? "No active channels pinned yet." : "No other channels found."}</div>
                        ) : (
                            <>
                                {currentChannel && (
                                    <div className="mb-2">
                                        <ChannelRow ch={currentChannel} isCurrent />
                                    </div>
                                )}
                                {categoryOrder.map((cat) => (
                                    <div key={cat} className="mb-1">
                                        <div className="text-[11px] font-semibold text-base-content/35 tracking-wide py-2 px-1">{cat}</div>
                                        {categoryMap.get(cat).map((ch) => (
                                            <ChannelRow key={ch.id ?? ch.url} ch={ch} isCurrent={false} />
                                        ))}
                                    </div>
                                ))}
                                {hasMore && (
                                    <div ref={sentinelRef} className="text-center text-[12px] text-base-content/30 py-4">
                                        {isFetchingMore ? "Loading more…" : ""}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </>
            )}
        </MenuShell>
    );
}

export function QualityPicker({ open, onClose, isMobile, controlsPhase, onSwitchQuality }) {
    const { state, actions } = usePlayerState();
    // With only one real video variant per session (this backend doesn't run
    // a live multi-bitrate ladder — see the on-demand switch design above),
    // "Auto" is always effectively "whatever this session's actual encode
    // resolution is." Show that resolution directly instead of a bare "Auto"
    // label that doesn't tell the user anything about what's actually
    // playing right now.
    const currentAutoLabel = state.qualityLevels[0]?.label;
    const isAutoActive = state.activeQuality === -1 && !state.requestedQuality;
    // FIX (Live: quality sidebar opens with nothing to pick): hls.js reports
    // a REAL multi-level ladder for Live (and for VOD when the multi-quality
    // ABR backend is on) in state.qualityLevels — this component populated
    // that array but never actually rendered it as selectable buttons, only
    // read qualityLevels[0] for the "Auto" label text above. The manual list
    // below it only ever showed the VOD "request a new transcode at a fixed
    // tier" flow (onSwitchQuality), which Live doesn't use at all. Now: if
    // hls.js actually reports more than one level, show THOSE (switching via
    // actions.setActiveQuality → hlsRef.nextLevel, already wired) instead.
    const hasRealLevels = state.qualityLevels.length > 1;
    return (
        <MenuShell isMobile={isMobile} controlsPhase={controlsPhase} open={open} onClose={onClose} title="Quality" side="bottom">
            <MenuItem
                isMobile={isMobile}
                active={isAutoActive}
                icon={Gauge}
                onClick={() => {
                    actions.setActiveQuality(-1);
                    actions.setRequestedQuality(null);
                    onClose();
                }}>
                <div>Auto{currentAutoLabel ? ` • ${currentAutoLabel}` : ""}</div>
            </MenuItem>
            {hasRealLevels && (
                <>
                    <div style={{ height: 1, background: "rgba(255,255,255,0.12)", margin: "6px 0" }} />
                    {/* High → Low for picking (qualityLevels itself is stored
                        ascending — see the sort comment where it's built). */}
                    {[...state.qualityLevels]
                        .sort((a, b) => (b.height || b.bitrate || 0) - (a.height || a.bitrate || 0))
                        .map((lvl) => (
                            <MenuItem
                                isMobile={isMobile}
                                key={lvl.index}
                                active={state.activeQuality === lvl.index}
                                icon={MonitorPlay}
                                onClick={() => {
                                    actions.setActiveQuality(lvl.index);
                                    actions.setRequestedQuality(null);
                                    onClose();
                                }}>
                                <div>{lvl.label}</div>
                            </MenuItem>
                        ))}
                </>
            )}
            {!hasRealLevels && onSwitchQuality && (
                <>
                    <div style={{ height: 1, background: "rgba(255,255,255,0.12)", margin: "6px 0" }} />
                    {MANUAL_QUALITY_TIERS.map((tier) => (
                        <MenuItem
                            isMobile={isMobile}
                            key={tier}
                            active={state.requestedQuality === tier}
                            icon={MonitorPlay}
                            onClick={() => {
                                actions.setRequestedQuality(tier);
                                onSwitchQuality(tier);
                                onClose();
                            }}>
                            <div>
                                <div>{tier}</div>
                                <div style={{ fontSize: 11, opacity: 0.4 }}>Starts a new stream at this resolution</div>
                            </div>
                        </MenuItem>
                    ))}
                </>
            )}
        </MenuShell>
    );
}

export function SpeedPicker({ open, onClose, isMobile, controlsPhase }) {
    const { state, actions } = usePlayerState();
    return (
        <MenuShell isMobile={isMobile} controlsPhase={controlsPhase} open={open} onClose={onClose} title="Playback Speed" side="bottom">
            {SPEEDS.map((s) => (
                <MenuItem
                    isMobile={isMobile}
                    key={s}
                    active={state.playbackSpeed === s}
                    onClick={() => {
                        actions.setPlaybackSpeed(s);
                        onClose();
                    }}>
                    {s === 1 ? "Normal (1×)" : `${s}×`}
                </MenuItem>
            ))}
        </MenuShell>
    );
}

// ─── Small shared bits for the Subtitle panel + Customization sub-page ──────

// Common ISO-639 codes → full language name, so the list shows "English"
// instead of "ENG".
const LANG_NAMES = {
    eng: "English",
    spa: "Spanish",
    fre: "French",
    fra: "French",
    ger: "German",
    deu: "German",
    ita: "Italian",
    por: "Portuguese",
    rus: "Russian",
    jpn: "Japanese",
    kor: "Korean",
    chi: "Chinese",
    zho: "Chinese",
    ara: "Arabic",
    hin: "Hindi",
    ben: "Bengali",
    urd: "Urdu",
    tur: "Turkish",
    vie: "Vietnamese",
    tha: "Thai",
    pol: "Polish",
    dut: "Dutch",
    nld: "Dutch",
    swe: "Swedish",
    nor: "Norwegian",
    dan: "Danish",
    fin: "Finnish",
    ell: "Greek",
    gre: "Greek",
    heb: "Hebrew",
    ind: "Indonesian",
    may: "Malay",
    msa: "Malay",
    ukr: "Ukrainian",
    ces: "Czech",
    cze: "Czech",
    ron: "Romanian",
    rum: "Romanian",
    hun: "Hungarian",
};

// Strips a trailing provider signature like "(SubDL)" / "(HDHub4u.Ms)" —
// the SourceBadge already conveys where a track came from, no need to
// repeat it inside the label text too.
function stripProviderSuffix(label) {
    return (label || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
}

function getSubLabel(sub, fallbackName) {
    // Prefer the backend's own inferred display name if it sends one
    // (mediaInfoStore's languageName — title-tag + filename aware, more
    // reliable than re-deriving it here from a bare code).
    if (sub.languageName) return sub.languageName;
    if (sub.label && sub.label.toLowerCase() !== sub.lang) {
        const cleaned = stripProviderSuffix(sub.label);
        if (cleaned) return cleaned;
    }
    const code = (sub.lang || "").toLowerCase();
    if (LANG_NAMES[code]) return LANG_NAMES[code];
    // Live data has nothing usable — try the mediainfo.json fallback
    // (queried by media id) before ever showing a placeholder word.
    if (fallbackName) return fallbackName;
    // Never show the raw "und"/"unk" placeholder, or generic words like
    // "Unknown"/"undefined" — only a real language name is allowed. If truly
    // nothing was found anywhere, fall back to a neutral position label
    // instead (a row still needs *some* text to be selectable).
    if (code && code !== "und" && code !== "unk" && code !== "unknown") return sub.lang.toUpperCase();
    return null;
}

function SourceBadge({ source }) {
    if (!source || source === "local") return null;
    const styles = {
        embedded: { background: "color-mix(in srgb, var(--color-primary, #6366f1) 22%, transparent)", color: "var(--color-primary, #6366f1)" },
        external: { background: "rgba(16,185,129,0.2)", color: "#6ee7b7" },
        // "Downloaded" → short form + success (green) color.
        downloaded: { background: "rgba(34,197,94,0.22)", color: "#4ade80" },
        online: { background: "rgba(251,191,36,0.2)", color: "#fcd34d" },
    };
    const labels = { embedded: "Embedded", external: "External", downloaded: "Download", online: "Web" };
    const label = labels[source] || source.toUpperCase();
    const style = styles[source] || { background: "rgba(255,255,255,0.1)", color: "#ccc" };
    return <span style={{ ...style, fontSize: 9, padding: "1px 5px", borderRadius: 4, marginLeft: 6, fontWeight: 700, letterSpacing: "0.04em" }}>{label}</span>;
}

// Checkbox-style row used everywhere in the Subtitle panel + Customization
// sub-page (track rows, Panel toggle, Advanced toggles).
// FIX: previously relied on the browser's native <label> → <input> click
// forwarding to fire onChange. That forwarding is unreliable in some
// WebViews (Android in-app browser, etc.) — taps did nothing. Now a single
// onClick on the row itself drives the toggle; the checkbox is
// pointer-events:none and purely visual, so there's exactly one
// deterministic tap target instead of depending on label semantics.
function CheckRow({ checked, onChange, children, disabled }) {
    const handleActivate = () => {
        if (disabled) return;
        onChange?.({ target: { checked: !checked } });
    };
    return (
        <div
            role="checkbox"
            aria-checked={!!checked}
            aria-disabled={!!disabled}
            tabIndex={disabled ? -1 : 0}
            onClick={handleActivate}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleActivate();
                }
            }}
            style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 16px",
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.45 : 1,
                color: "#fff",
                fontSize: 13.5,
                WebkitTapHighlightColor: "transparent",
                userSelect: "none",
            }}>
            <input
                type="checkbox"
                checked={!!checked}
                disabled={disabled}
                readOnly
                style={{ width: 16, height: 16, accentColor: "var(--color-primary, #6366f1)", flexShrink: 0, pointerEvents: "none" }}
            />
            <span style={{ display: "flex", alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>{children}</span>
        </div>
    );
}

// "−  [value]  +" stepper used for Synchronization and Speed.
function Stepper({ label, display, onDec, onInc }) {
    const btnStyle = {
        width: 34,
        height: 34,
        borderRadius: "50%",
        border: "none",
        background: "rgba(255,255,255,0.08)",
        color: "#fff",
        fontSize: 18,
        lineHeight: 1,
        cursor: "pointer",
        flexShrink: 0,
        WebkitTapHighlightColor: "transparent",
    };
    return (
        <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>{label}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button type="button" onClick={onDec} style={btnStyle} aria-label={`Decrease ${label}`}>
                    −
                </button>
                <div style={{ flex: 1, textAlign: "center", background: "rgba(255,255,255,0.06)", borderRadius: 8, padding: "8px 0", color: "#fff", fontSize: 13.5 }}>{display}</div>
                <button type="button" onClick={onInc} style={btnStyle} aria-label={`Increase ${label}`}>
                    +
                </button>
            </div>
        </div>
    );
}

// Collapsible section header (chevron up/down) reused by Layout/Text/Advanced.
function SectionHeader({ label, open, onToggle }) {
    return (
        <button
            type="button"
            onClick={onToggle}
            style={{
                display: "flex",
                alignItems: "center",
                width: "100%",
                padding: "12px 16px 8px",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "#fff",
                fontSize: 15,
                fontWeight: 700,
            }}>
            <span style={{ flex: 1, textAlign: "left" }}>{label}</span>
            {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
    );
}

const fieldLabelStyle = { display: "block", fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 };
const selectStyle = {
    width: "100%",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    padding: "8px 10px",
    fontSize: 13.5,
};
const colorSwatchStyle = { width: 40, height: 28, padding: 0, border: "1px solid rgba(255,255,255,0.15)", borderRadius: 6, background: "none", cursor: "pointer" };

// Injected once per Customization-page mount — styles the native range
// input's track/thumb across browsers (can't be done via inline style
// alone since ::-webkit-slider-thumb etc. are pseudo-elements).
const SLIDER_CSS = `
.flux-pro-slider { -webkit-appearance: none; appearance: none; width: 100%; height: 6px; border-radius: 3px; outline: none; cursor: pointer; }
.flux-pro-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; border-radius: 50%; background: #fff; border: 3px solid var(--color-primary, #6366f1); box-shadow: 0 1px 4px rgba(0,0,0,0.45); cursor: pointer; transition: transform 0.1s; }
.flux-pro-slider::-webkit-slider-thumb:active { transform: scale(1.15); }
.flux-pro-slider::-moz-range-thumb { width: 18px; height: 18px; border-radius: 50%; background: #fff; border: 3px solid var(--color-primary, #6366f1); box-shadow: 0 1px 4px rgba(0,0,0,0.45); cursor: pointer; }
.flux-pro-slider::-moz-range-track { height: 6px; border-radius: 3px; background: transparent; }
.flux-pro-slider:disabled::-webkit-slider-thumb { border-color: rgba(255,255,255,0.25); }
`;

// Custom slider — real filled-track + styled thumb, instead of a bare
// unstyled <input type="range">.
function ProSlider({ label, value, min, max, step, onChange, format, disabled }) {
    const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
    return (
        <div style={{ opacity: disabled ? 0.45 : 1 }}>
            {label && (
                <label style={fieldLabelStyle}>
                    {label} — {format ? format(value) : value}
                </label>
            )}
            <input
                type="range"
                className="flux-pro-slider"
                min={min}
                max={max}
                step={step}
                value={value}
                disabled={disabled}
                onChange={(e) => onChange(+e.target.value)}
                style={{
                    background: `linear-gradient(to right, var(--color-primary, #6366f1) 0%, var(--color-primary, #6366f1) ${pct}%, rgba(255,255,255,0.15) ${pct}%, rgba(255,255,255,0.15) 100%)`,
                }}
            />
        </div>
    );
}

// Custom dropdown — replaces native <select>, which on some mobile
// WebViews pops a plain OS action-sheet/alert instead of an in-page menu.
function Dropdown({ label, value, options, onChange }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        if (!open) return;
        const close = (e) => {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false);
        };
        document.addEventListener("mousedown", close);
        document.addEventListener("touchstart", close);
        return () => {
            document.removeEventListener("mousedown", close);
            document.removeEventListener("touchstart", close);
        };
    }, [open]);

    const current = options.find((o) => o.value === value);

    return (
        <div ref={ref} style={{ position: "relative" }}>
            {label && <label style={fieldLabelStyle}>{label}</label>}
            <button type="button" onClick={() => setOpen((o) => !o)} style={{ ...selectStyle, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
                <span>{current?.label || value}</span>
                <ChevronDown size={14} style={{ transition: "transform 0.15s", transform: open ? "rotate(180deg)" : "none", flexShrink: 0, opacity: 0.7 }} />
            </button>
            {open && (
                <div
                    style={{
                        position: "absolute",
                        top: "100%",
                        left: 0,
                        right: 0,
                        marginTop: 6,
                        background: "rgba(24,24,28,0.98)",
                        border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: 8,
                        overflow: "hidden",
                        zIndex: 30,
                        maxHeight: 220,
                        overflowY: "auto",
                        boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                    }}>
                    {options.map((o) => (
                        <div
                            key={o.value}
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                                onChange(o.value);
                                setOpen(false);
                            }}
                            style={{
                                padding: "10px 12px",
                                fontSize: 13.5,
                                color: "#fff",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                background: o.value === value ? "rgba(255,255,255,0.08)" : "transparent",
                            }}>
                            {o.label}
                            {o.value === value && <Check size={13} style={{ color: "var(--color-primary, #6366f1)" }} />}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Subtitles Customization (the drill-in sub-page: Layout / Text / Advanced) ───
// Self-contained — renders its OWN back-arrow header instead of touching
// MenuShell/VideoSidebar's shared header, so this doesn't couple onto (or
// risk breaking) every other picker that uses the same shell.
function SubtitleCustomizationBody() {
    const { state, actions } = usePlayerState();
    const [openSection, setOpenSection] = useState({ layout: true, text: true, advanced: true });
    const toggleSection = (key) => setOpenSection((s) => ({ ...s, [key]: !s[key] }));
    const setField = (patch) => actions.setSubtitleCustom(patch);

    return (
        <>
            <style>{SLIDER_CSS}</style>
            {/* Own back-header removed — MenuShell's shared header now shows
                "Subtitles Customization" with its arrow rewired to onBack
                (see SubtitlePicker), so there's a single header, not two. */}
            {/* ── Layout ── */}
            <SectionHeader label="Layout" open={openSection.layout} onToggle={() => toggleSection("layout")} />
            {openSection.layout && (
                <div style={{ padding: "0 16px 14px", display: "flex", flexDirection: "column", gap: 14 }}>
                    <Dropdown
                        label="Alignment"
                        value={state.subtitleAlignment}
                        onChange={(v) => setField({ subtitleAlignment: v })}
                        options={[
                            { value: "left", label: "Left" },
                            { value: "center", label: "Center" },
                            { value: "right", label: "Right" },
                        ]}
                    />
                    <ProSlider label="Bottom margins" value={state.subtitleBottomMargin} min={0} max={150} step={2} format={(v) => `${v}px`} onChange={(v) => setField({ subtitleBottomMargin: v })} />
                    {/* Reuses the same background fields as Text's "Background Color" —
                        one background target, exposed in both places to match the
                        reference layout. */}
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <CheckRow checked={state.subtitleBackgroundEnabled} onChange={(e) => setField({ subtitleBackgroundEnabled: e.target.checked })}>
                            Background
                        </CheckRow>
                        <input
                            type="color"
                            value={state.subtitleBackgroundColor}
                            onChange={(e) => setField({ subtitleBackgroundColor: e.target.value })}
                            style={colorSwatchStyle}
                            aria-label="Background color"
                        />
                    </div>
                    <CheckRow checked={state.subtitleFitToVideo} onChange={(e) => setField({ subtitleFitToVideo: e.target.checked })}>
                        Fit subtitles into video size
                    </CheckRow>
                </div>
            )}

            {/* ── Text ── */}
            <SectionHeader label="Text" open={openSection.text} onToggle={() => toggleSection("text")} />
            {openSection.text && (
                <div style={{ padding: "0 16px 14px", display: "flex", flexDirection: "column", gap: 14 }}>
                    <Dropdown
                        label="Font"
                        value={state.subtitleFont}
                        onChange={(v) => setField({ subtitleFont: v })}
                        options={[
                            { value: "default", label: "Default" },
                            { value: "sans-serif", label: "Sans-serif" },
                            { value: "serif", label: "Serif" },
                            { value: "monospace", label: "Monospace" },
                        ]}
                    />
                    <ProSlider label="Size" value={state.subtitleFontSize} min={10} max={48} step={1} format={(v) => `${v}px`} onChange={(v) => actions.setSubtitleFontSize(v)} />
                    <ProSlider label="Scale" value={state.subtitleScale} min={50} max={200} step={5} format={(v) => `${v}%`} onChange={(v) => setField({ subtitleScale: v })} />
                    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <label style={{ ...fieldLabelStyle, marginBottom: 0 }}>Color</label>
                            <input type="color" value={state.subtitleColor} onChange={(e) => actions.setSubtitleColor(e.target.value)} style={colorSwatchStyle} aria-label="Text color" />
                        </div>
                        <CheckRow checked={state.subtitleBold} onChange={(e) => setField({ subtitleBold: e.target.checked })}>
                            Bold
                        </CheckRow>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <CheckRow checked={state.subtitleBackgroundEnabled} onChange={(e) => setField({ subtitleBackgroundEnabled: e.target.checked })}>
                            Background Color
                        </CheckRow>
                        <input
                            type="color"
                            value={state.subtitleBackgroundColor}
                            onChange={(e) => setField({ subtitleBackgroundColor: e.target.value })}
                            style={colorSwatchStyle}
                            aria-label="Background color"
                        />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <CheckRow checked={state.subtitleBorderEnabled} onChange={(e) => setField({ subtitleBorderEnabled: e.target.checked })}>
                            Border
                        </CheckRow>
                        <input type="color" value={state.subtitleBorderColor} onChange={(e) => setField({ subtitleBorderColor: e.target.value })} style={colorSwatchStyle} aria-label="Border color" />
                        <div style={{ flex: 1 }}>
                            <ProSlider value={state.subtitleBorderWidth} min={0} max={100} step={5} disabled={!state.subtitleBorderEnabled} onChange={(v) => setField({ subtitleBorderWidth: v })} />
                        </div>
                    </div>
                </div>
            )}

            {/* ── Advanced ── */}
            <SectionHeader label="Advanced" open={openSection.advanced} onToggle={() => toggleSection("advanced")} />
            {openSection.advanced && (
                <div style={{ padding: "0 0 14px", display: "flex", flexDirection: "column", gap: 2 }}>
                    <CheckRow checked={state.subtitleImproveStroke} onChange={(e) => setField({ subtitleImproveStroke: e.target.checked })}>
                        Improve stroke rendering
                    </CheckRow>
                    <div style={{ display: "flex", flexWrap: "wrap" }}>
                        <CheckRow checked={state.subtitleShadow} onChange={(e) => setField({ subtitleShadow: e.target.checked })}>
                            Shadow
                        </CheckRow>
                        <CheckRow checked={state.subtitleFadeOut} onChange={(e) => setField({ subtitleFadeOut: e.target.checked })}>
                            Fade out
                        </CheckRow>
                    </div>
                    <CheckRow checked={state.subtitleImproveSSA} onChange={(e) => setField({ subtitleImproveSSA: e.target.checked })}>
                        Improve SSA rendering
                    </CheckRow>
                    <CheckRow checked={state.subtitleImproveComplexScripts} onChange={(e) => setField({ subtitleImproveComplexScripts: e.target.checked })}>
                        Improve the rendering of complex scripts
                    </CheckRow>
                    <CheckRow checked={state.subtitleIgnoreSSAFont} onChange={(e) => setField({ subtitleIgnoreSSAFont: e.target.checked })}>
                        Ignore font specified in SSA subtitles
                    </CheckRow>
                    <CheckRow checked={state.subtitleIgnoreBrokenSSAFont} onChange={(e) => setField({ subtitleIgnoreBrokenSSAFont: e.target.checked })}>
                        Ignore broken fonts specified in SSA subtitles (experimental)
                    </CheckRow>
                </div>
            )}
        </>
    );
}

export function SubtitlePicker({ open, onClose, subtitles, isMobile, controlsPhase, mediaId }) {
    const { state, actions } = usePlayerState();
    const [view, setView] = useState("main"); // 'main' | 'custom'
    const [settingsOpen, setSettingsOpen] = useState(false);
    const fileInputRef = useRef(null);

    // Always land back on the main list next time the panel is reopened —
    // otherwise it'd reopen stuck on the Customization sub-page.
    useEffect(() => {
        if (!open) {
            setView("main");
        }
    }, [open]);

    // Default-select the FIRST subtitle in the list once it loads — only
    // once per actual list/media change (keyed by URLs + mediaId, not
    // object reference, since `subtitles` may be a fresh array each
    // render), so explicitly turning "Off" afterwards sticks instead of
    // being re-overridden on the next unrelated render.
    // NOTE: a device-picked local file (via "Open") can't be remembered
    // across a reload — the browser's File API only ever hands back a
    // blob: URL for the current session, never a reusable path, so there's
    // nothing durable to restore for that case. This only restores the
    // last BACKEND-provided track (embedded/external/downloaded), which do
    // have stable URLs.
    const subsKey = subtitles.map((s) => s.url).join("|");
    const autoSelectedRef = useRef(false);
    useEffect(() => {
        autoSelectedRef.current = false;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [subsKey, mediaId]);
    useEffect(() => {
        if (autoSelectedRef.current) return;
        autoSelectedRef.current = true;
        if (state.activeSubtitle) return;
        if (mediaId) {
            try {
                const savedUrl = localStorage.getItem(`flux:subtitleUrl:${mediaId}`);
                const match = savedUrl && subtitles.find((s) => s.url === savedUrl);
                if (match) {
                    actions.setActiveSubtitle(match);
                    return;
                }
            } catch {
                // localStorage unavailable — fall through to default
            }
        }
        if (subtitles.length > 0) actions.setActiveSubtitle(subtitles[0]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [subsKey, mediaId]);

    // Persist which backend-provided track is active per media, so it's
    // restored next time this media is opened (see effect above). Local
    // device-picked files are intentionally excluded — see note above.
    useEffect(() => {
        if (!mediaId || !state.activeSubtitle || state.activeSubtitle.source === "local") return;
        try {
            localStorage.setItem(`flux:subtitleUrl:${mediaId}`, state.activeSubtitle.url);
        } catch {
            // localStorage unavailable — selection still works this session
        }
    }, [mediaId, state.activeSubtitle]);

    // The locally-opened file (via "Open") is kept in its own state slice so
    // it survives a `subtitles` prop refresh, but still needs to show up in
    // this list — appended once, deduped by url.
    const allSubs = state.localSubtitleFile && !subtitles.some((s) => s.url === state.localSubtitleFile.url) ? [...subtitles, state.localSubtitleFile] : subtitles;

    // mediainfo.json fallback (queried by media id) — only fetched if at
    // least one track's live data has no real language name to show.
    // getSubLabel already prefers languageName/lang-code first; this only
    // fills the gap when both of those come up empty.
    const needsMediaInfoFallback = allSubs.some((sub) => getSubLabel(sub) === null);
    const [mediaInfoFallback, setMediaInfoFallback] = useState(null);
    useEffect(() => {
        if (!needsMediaInfoFallback || !mediaId) return;
        let cancelled = false;
        fetch(`${BACKEND}/stream/mediainfo/${encodeURIComponent(mediaId)}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (!cancelled) setMediaInfoFallback(data);
            })
            .catch(() => {
                if (!cancelled) setMediaInfoFallback(null);
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [needsMediaInfoFallback, mediaId]);

    // "Open" — the device's own file manager/explorer (native OS file
    // picker), not an in-app browser. Gives back a blob: URL for the
    // session only (File API restriction — no real path is exposed).
    // FIX: re-engaging fullscreen/landscape only inside handleOpenFile
    // (onChange) missed the "cancel" case — backing out of the file
    // manager without picking anything never fires onChange at all, so it
    // never ran. `window focus` fires either way (picked or cancelled),
    // right as control returns to the page.
    function reengageFullscreenLandscape() {
        (async () => {
            try {
                if (!document.fullscreenElement) {
                    await document.documentElement.requestFullscreen({ navigationUI: "hide" });
                }
                await screen.orientation?.lock?.("landscape");
            } catch {
                // Some browsers require a fresh tap to re-enter fullscreen —
                // if so, the existing manual fullscreen/rotate button still
                // works as a fallback.
            }
        })();
    }

    function handleOpenFile(e) {
        const file = e.target.files?.[0];
        e.target.value = ""; // reset so picking the same file again still fires onChange
        if (!file) return;
        const url = URL.createObjectURL(file);
        const track = { url, filename: file.name, label: file.name, lang: "local", source: "local" };
        actions.setLocalSubtitleFile(track);
        actions.setActiveSubtitle(track);
    }

    // "Subtitles Customization" plain-string title reused via onClose swap
    // (see below) — customization view.
    if (view === "custom") {
        return (
            <MenuShell isMobile={isMobile} controlsPhase={controlsPhase} open={open} onClose={() => setView("main")} title="Subtitles Customization" side="bottom">
                <SubtitleCustomizationBody />
            </MenuShell>
        );
    }

    // "Online subtitles" sits next to the title itself (matches reference).
    // FIX: bigger explicit `gap` — 16 still read as flush/too tight.
    const mainTitle = (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", gap: 32 }}>
            <span>Subtitle</span>
            <span style={{ fontSize: 12.5, fontWeight: 400, color: "rgba(255,255,255,0.35)", cursor: "not-allowed", flexShrink: 0, marginLeft: "auto" }} title="Not available yet">
                Online subtitles
            </span>
        </div>
    );

    return (
        <MenuShell isMobile={isMobile} controlsPhase={controlsPhase} open={open} onClose={onClose} title={mainTitle} side="bottom">
            {/* "Open" — its own row, separate from "Online subtitles" above,
                with breathing room under the title. Opens the device's
                native file manager/picker. Arms a one-shot `focus` listener
                right before opening it — see reengageFullscreenLandscape. */}
            <input ref={fileInputRef} type="file" accept=".srt,.vtt,.ass,.ssa" style={{ display: "none" }} onChange={handleOpenFile} />
            <button
                type="button"
                onClick={() => {
                    window.addEventListener("focus", reengageFullscreenLandscape, { once: true });
                    fileInputRef.current?.click();
                }}
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    padding: "10px 16px",
                    marginTop: 10,
                    background: "transparent",
                    border: "none",
                    color: "#fff",
                    fontSize: 13.5,
                    fontWeight: 600,
                    textAlign: "left",
                    cursor: "pointer",
                }}>
                <FolderOpen size={16} style={{ opacity: 0.8, flexShrink: 0 }} />
                Open
            </button>

            <div style={{ margin: "2px 12px 4px", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, overflow: "hidden" }}>
                {/* FIX: removed the separate "Off" row per request — each
                    track's own checkbox now IS the on/off control. Checking
                    a track selects it (same as before); unchecking the
                    currently-active one turns subtitles off (previously
                    clicking an already-checked row did nothing — you had to
                    go find the separate Off row instead). Default-select-
                    first-subtitle-on-load and everything else above is
                    unchanged. */}
                {allSubs.map((sub, i) => {
                    const fallbackName = mediaInfoFallback?.subtitleTracks?.[i]?.languageName || null;
                    const label = getSubLabel(sub, fallbackName) || `Subtitle ${i + 1}`;
                    const isActive = state.activeSubtitle?.url === sub.url;
                    return (
                        <CheckRow key={sub.url} checked={isActive} onChange={() => actions.setActiveSubtitle(isActive ? null : sub)}>
                            {sub.forced && <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.55)", marginRight: 4 }}>[Forced]</span>}
                            {label}
                            <SourceBadge source={sub.source} />
                        </CheckRow>
                    );
                })}
                {allSubs.length === 0 && <div style={{ padding: "12px 16px", fontSize: 12.5, color: "rgba(255,255,255,0.4)" }}>No subtitles found for this media.</div>}
            </div>

            <SectionHeader label="Settings" open={settingsOpen} onToggle={() => setSettingsOpen((o) => !o)} />
            {settingsOpen && (
                <div style={{ padding: "0 16px 6px", display: "flex", flexDirection: "column", gap: 16 }}>
                    <Stepper
                        label="Synchronization"
                        display={`${(state.subtitleDelay / 1000).toFixed(1)}s`}
                        onDec={() => actions.setSubtitleDelay(state.subtitleDelay - 100)}
                        onInc={() => actions.setSubtitleDelay(state.subtitleDelay + 100)}
                    />
                    <Stepper
                        label="Speed"
                        display={`${state.subtitleSpeed.toFixed(1)}%`}
                        onDec={() => actions.setSubtitleCustom({ subtitleSpeed: Math.max(25, state.subtitleSpeed - 5) })}
                        onInc={() => actions.setSubtitleCustom({ subtitleSpeed: Math.min(300, state.subtitleSpeed + 5) })}
                    />
                    <CheckRow checked={state.subtitlePanelMode} onChange={(e) => actions.setSubtitleCustom({ subtitlePanelMode: e.target.checked })}>
                        Panel
                    </CheckRow>
                    <button
                        type="button"
                        onClick={() => setView("custom")}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            padding: "6px 0",
                            background: "transparent",
                            border: "none",
                            color: "#fff",
                            fontSize: 13.5,
                            textAlign: "left",
                            cursor: "pointer",
                        }}>
                        Customization
                    </button>
                </div>
            )}
        </MenuShell>
    );
}

// ─── A-B Repeat popup ─────────────────────────────────────────────────────────

export function AbRepeatPanel({ open, onClose, videoRef, isMobile, controlsPhase }) {
    const { state, actions } = usePlayerState();
    const { a, b, active } = state.abRepeat;
    const setPoint = (point) => actions.setAbRepeat({ [point]: videoRef.current?.currentTime ?? 0 });
    const clear = () => actions.setAbRepeat({ a: null, b: null, active: false });
    return (
        <MenuShell isMobile={isMobile} controlsPhase={controlsPhase} open={open} onClose={onClose} title="A-B Repeat" side="bottom">
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 16px 12px" }}>
                <button
                    onClick={() => setPoint("a")}
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "none",
                        background: a != null ? "rgba(229,62,62,0.18)" : "rgba(255,255,255,0.06)",
                        color: "#fff",
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: "pointer",
                    }}>
                    <span>Set Point A</span>
                    <span style={{ opacity: 0.6, fontFamily: "ui-monospace,monospace", fontSize: 12 }}>{a != null ? formatTime(a) : "—"}</span>
                </button>
                <button
                    onClick={() => setPoint("b")}
                    disabled={a == null}
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "none",
                        background: b != null ? "rgba(229,62,62,0.18)" : "rgba(255,255,255,0.06)",
                        color: a == null ? "rgba(255,255,255,0.3)" : "#fff",
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: a == null ? "not-allowed" : "pointer",
                    }}>
                    <span>Set Point B</span>
                    <span style={{ opacity: 0.6, fontFamily: "ui-monospace,monospace", fontSize: 12 }}>{b != null ? formatTime(b) : "—"}</span>
                </button>
                <button
                    onClick={() => {
                        if (a != null && b != null && b > a) actions.setAbRepeat({ active: !active });
                    }}
                    disabled={a == null || b == null || b <= a}
                    style={{
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "none",
                        background: active ? "#e53e3e" : "rgba(255,255,255,0.06)",
                        color: a != null && b != null && b > a ? "#fff" : "rgba(255,255,255,0.3)",
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: a != null && b != null && b > a ? "pointer" : "not-allowed",
                    }}>
                    {active ? "Repeating A → B" : "Start Repeat"}
                </button>
                {(a != null || b != null) && (
                    <button onClick={clear} style={{ padding: "6px 0", borderRadius: 8, background: "transparent", border: "none", color: "rgba(255,255,255,0.5)", fontSize: 12, cursor: "pointer" }}>
                        Clear points
                    </button>
                )}
            </div>
        </MenuShell>
    );
}

// ─── Customise Items popup ────────────────────────────────────────────────────

// ─── Equalizer panel (3-band, real Web Audio DSP via VideoCore) ─────────────

// ─── Audio output device label (best-effort) ─────────────────────────────────
// Browsers only expose real device labels (e.g. "My Headphones (Bluetooth)")
// after mic/cam permission has been granted for some reason — we deliberately
// do NOT prompt for that here (would be a confusing, unrelated permission ask
// in a video player). If labels are already available we show the real one;
// otherwise a generic fallback.
function useAudioOutputLabel() {
    const [label, setLabel] = useState("Device Audio");

    useEffect(() => {
        if (!navigator.mediaDevices?.enumerateDevices) return;
        let cancelled = false;
        const check = () => {
            navigator.mediaDevices
                .enumerateDevices()
                .then((devices) => {
                    if (cancelled) return;
                    const out = devices.find((d) => d.kind === "audiooutput" && d.label);
                    if (out) setLabel(out.label);
                })
                .catch(() => {});
        };
        check();
        navigator.mediaDevices.addEventListener?.("devicechange", check);
        return () => {
            cancelled = true;
            navigator.mediaDevices.removeEventListener?.("devicechange", check);
        };
    }, []);

    return label;
}

const AUDIO_EFFECT_OPTIONS = [
    { key: "original", label: "Original", icon: AudioLines },
    { key: "clarity", label: "Clarity", icon: Mic2 },
    { key: "bassBoost", label: "Bass Boost", icon: Speaker },
    { key: "trebleBoost", label: "Treble Boost", icon: Waves },
    { key: "movie", label: "Movie", icon: Film },
    { key: "music", label: "Music", icon: Music2 },
];

const EQ_PRESET_OPTIONS = [
    { key: "custom", label: "Custom" },
    { key: "normal", label: "Normal" },
    { key: "classical", label: "Classical" },
    { key: "dance", label: "Dance" },
    { key: "flat", label: "Flat" },
    { key: "folk", label: "Folk" },
    { key: "heavyMetal", label: "Heavy Metal" },
    { key: "hipHop", label: "Hip Hop" },
    { key: "jazz", label: "Jazz" },
    { key: "pop", label: "Pop" },
    { key: "rock", label: "Rock" },
];
const EQ_BAND_KEYS = [
    { key: "b60", hz: "60 Hz" },
    { key: "b230", hz: "230 Hz" },
    { key: "b910", hz: "910 Hz" },
    { key: "b4000", hz: "4000 Hz" },
    { key: "b14000", hz: "14000 Hz" },
];

function DecoderLockedNotice({ onSwitch }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "28px 20px" }}>
            <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                <Lock size={20} color="rgba(255,255,255,0.85)" style={{ flexShrink: 0, marginTop: 2 }} />
                <p style={{ color: "rgba(255,255,255,0.85)", fontSize: 14, lineHeight: 1.5, margin: 0 }}>
                    Audio effects are not available in HW decoder mode. Switch to HW+ decoder or SW decoder mode to enable.
                </p>
            </div>
            <div style={{ display: "flex", gap: 8, paddingLeft: 34 }}>
                <button
                    onClick={() => onSwitch("hw+")}
                    style={{
                        padding: "7px 14px",
                        borderRadius: 8,
                        border: "1px solid var(--color-primary)",
                        background: "transparent",
                        color: "var(--color-primary)",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                    }}>
                    Use HW+
                </button>
                <button
                    onClick={() => onSwitch("sw")}
                    style={{
                        padding: "7px 14px",
                        borderRadius: 8,
                        border: "1px solid rgba(255,255,255,0.25)",
                        background: "transparent",
                        color: "#fff",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                    }}>
                    Use SW
                </button>
            </div>
        </div>
    );
}

function RadioRow({ label, checked, onClick }) {
    return (
        <button
            onClick={onClick}
            style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                width: "100%",
                padding: "13px 16px",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
            }}>
            <span
                style={{
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    border: `2px solid ${checked ? "var(--color-primary)" : "rgba(255,255,255,0.5)"}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                }}>
                {checked && <span style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--color-primary)" }} />}
            </span>
            <span style={{ color: "#fff", fontSize: 14.5 }}>{label}</span>
        </button>
    );
}

function CheckboxRow({ label, checked, onClick }) {
    return (
        <button
            onClick={onClick}
            style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                width: "100%",
                padding: "13px 16px",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
            }}>
            <span
                style={{
                    width: 18,
                    height: 18,
                    borderRadius: 4,
                    border: `2px solid ${checked ? "var(--color-primary)" : "rgba(255,255,255,0.5)"}`,
                    background: checked ? "var(--color-primary)" : "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                }}>
                {checked && <Check size={12} color="#fff" strokeWidth={3} />}
            </span>
            <span style={{ color: "#fff", fontSize: 14.5 }}>{label}</span>
        </button>
    );
}

export function DisabledRow({ label }) {
    return <div style={{ padding: "13px 16px", color: "rgba(255,255,255,0.35)", fontSize: 14.5 }}>{label}</div>;
}

export function AudioTrackPanel({ open, onClose, isMobile, controlsPhase }) {
    const { state, actions } = usePlayerState();
    return (
        <MenuShell isMobile={isMobile} controlsPhase={controlsPhase} open={open} onClose={onClose} title="Audio Track" side="bottom">
            {state.audioTracks.length === 0 ? (
                <DisabledRow label="No alternate audio tracks for this file" />
            ) : (
                state.audioTracks.map((track) => (
                    <RadioRow
                        key={track.index}
                        label={track.name}
                        checked={!state.muted && state.activeAudioTrack === track.index}
                        onClick={() => {
                            actions.setMuted(false);
                            actions.setActiveAudioTrack(track.index);
                        }}
                    />
                ))
            )}
            {/* "Disable" is the closest real equivalent to muting — HLS.js
                has no concept of "no audio track", only switching between
                whatever tracks the manifest provides. */}
            <RadioRow label="Disable" checked={state.muted} onClick={() => actions.setMuted(true)} />
            <CheckboxRow label="Use SW audio decoder" checked={state.useSwAudioDecoder} onClick={() => actions.toggleSwAudioDecoder()} />
            <div style={{ height: 1, background: "rgba(255,255,255,0.12)", margin: "8px 0" }} />
            {/* Backend doesn't support these yet — shown disabled, matching
                the reference UI's grayed-out placeholder rows. */}
            <DisabledRow label="Open" />
            <DisabledRow label="Stereo mode" />
            <DisabledRow label="Synchronization" />
            <DisabledRow label="AV sync" />
        </MenuShell>
    );
}

export function DecoderModePanel({ open, onClose, isMobile, controlsPhase }) {
    const { state, actions } = usePlayerState();
    return (
        <MenuShell isMobile={isMobile} controlsPhase={controlsPhase} open={open} onClose={onClose} title="Decoder" side="bottom">
            {["hw", "hw+", "sw"].map((mode) => (
                <RadioRow key={mode} label={DECODER_LABELS[mode] + (mode === "hw+" ? " (Recommended)" : "")} checked={state.decoderMode === mode} onClick={() => actions.setDecoderMode(mode)} />
            ))}
        </MenuShell>
    );
}

function CircularKnob({ label, value, onChange, disabled }) {
    const knobRef = useRef(null);
    const dragging = useRef(false);

    const angleFor = (v) => -135 + (v / 100) * 270;
    const angle = angleFor(value);
    const handleX = 50 + 38 * Math.cos((angle * Math.PI) / 180);
    const handleY = 50 + 38 * Math.sin((angle * Math.PI) / 180);

    const updateFromEvent = (clientX, clientY) => {
        const rect = knobRef.current?.getBoundingClientRect();
        if (!rect) return;
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        let deg = (Math.atan2(clientY - cy, clientX - cx) * 180) / Math.PI;
        if (deg < -135) deg = -135;
        if (deg > 135) deg = 135;
        const pct = Math.round(((deg + 135) / 270) * 100);
        onChange(Math.max(0, Math.min(100, pct)));
    };

    const onPointerDown = (e) => {
        if (disabled) return;
        dragging.current = true;
        updateFromEvent(e.clientX, e.clientY);
        e.currentTarget.setPointerCapture?.(e.pointerId);
    };
    const onPointerMove = (e) => {
        if (!dragging.current) return;
        updateFromEvent(e.clientX, e.clientY);
    };
    const onPointerUp = () => {
        dragging.current = false;
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, flex: 1, opacity: disabled ? 0.4 : 1 }}>
            <div
                ref={knobRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                style={{
                    position: "relative",
                    width: 92,
                    height: 92,
                    borderRadius: "50%",
                    background: "radial-gradient(circle at 35% 30%, color-mix(in oklch, var(--color-primary) 75%, white 10%), color-mix(in oklch, var(--color-primary) 90%, black 20%))",
                    cursor: disabled ? "default" : "pointer",
                    touchAction: "none",
                    WebkitTapHighlightColor: "transparent",
                }}>
                <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                    <span style={{ color: "#fff", fontSize: 17, fontWeight: 700 }}>{value}%</span>
                </div>
                <div
                    style={{
                        position: "absolute",
                        left: `${handleX}%`,
                        top: `${handleY}%`,
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        background: "#fff",
                        transform: "translate(-50%, -50%)",
                        boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
                        pointerEvents: "none",
                    }}
                />
            </div>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.8)", fontWeight: 600 }}>{label}</span>
        </div>
    );
}

export function AudioFxPanel({ open, onClose, isMobile, controlsPhase, initialTab = "effect", onTabChange }) {
    const { state, actions } = usePlayerState();
    const [tab, setTab] = useState(initialTab);
    const deviceLabel = useAudioOutputLabel();
    const locked = state.decoderMode === "hw";

    useEffect(() => {
        if (open) setTab(initialTab);
    }, [open, initialTab]);

    const changeTab = (next) => {
        setTab(next);
        onTabChange?.(next);
    };

    return (
        <MenuShell isMobile={isMobile} controlsPhase={controlsPhase} open={open} onClose={onClose} title={tab === "effect" ? "Audio Effect" : "Equalizer"} side="bottom">
            <div style={{ display: "flex", padding: "0 16px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                {[
                    { key: "effect", label: "Audio Effect" },
                    { key: "equalizer", label: "Equalizer" },
                ].map((t) => (
                    <button
                        key={t.key}
                        onClick={() => changeTab(t.key)}
                        style={{
                            flex: 1,
                            padding: "10px 0",
                            background: "none",
                            border: "none",
                            borderBottom: tab === t.key ? "2px solid var(--color-primary)" : "2px solid transparent",
                            color: tab === t.key ? "#fff" : "rgba(255,255,255,0.5)",
                            fontSize: 13,
                            fontWeight: 700,
                            cursor: "pointer",
                            WebkitTapHighlightColor: "transparent",
                        }}>
                        {t.label}
                    </button>
                ))}
            </div>

            {locked ? (
                <DecoderLockedNotice onSwitch={actions.setDecoderMode} />
            ) : (
                <div style={{ padding: "14px 16px 8px", display: "flex", alignItems: "center", gap: 10, color: "rgba(255,255,255,0.8)", fontSize: 13 }}>
                    <Headphones size={16} />
                    <span>{deviceLabel}</span>
                </div>
            )}

            {!locked && tab === "effect" && (
                <div style={{ padding: "8px 16px 16px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    {AUDIO_EFFECT_OPTIONS.map((opt) => {
                        const Icon = opt.icon;
                        const active = state.audioEffectPreset === opt.key;
                        return (
                            <button
                                key={opt.key}
                                onClick={() => actions.setAudioEffectPreset(opt.key)}
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: 8,
                                    padding: "14px 6px",
                                    borderRadius: 10,
                                    border: active ? "1px solid var(--color-primary)" : "1px solid rgba(255,255,255,0.15)",
                                    background: active ? "color-mix(in oklch, var(--color-primary) 22%, transparent)" : "transparent",
                                    cursor: "pointer",
                                    WebkitTapHighlightColor: "transparent",
                                }}>
                                <Icon size={20} color={active ? "var(--color-primary)" : "#fff"} />
                                <span style={{ fontSize: 11.5, fontWeight: 600, color: active ? "var(--color-primary)" : "#fff", textAlign: "center" }}>{opt.label}</span>
                            </button>
                        );
                    })}
                </div>
            )}

            {!locked && tab === "equalizer" && (
                <div style={{ padding: "4px 16px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 10, color: "#fff", fontSize: 14, fontWeight: 600 }}>
                            <SlidersHorizontal size={16} />
                            Equalizer
                        </span>
                        <button
                            onClick={() => actions.toggleEq()}
                            role="switch"
                            aria-checked={state.eqEnabled}
                            style={{
                                width: 44,
                                height: 26,
                                borderRadius: 999,
                                border: "none",
                                position: "relative",
                                background: state.eqEnabled ? "var(--color-primary)" : "rgba(255,255,255,0.2)",
                                cursor: "pointer",
                                flexShrink: 0,
                                transition: "background 0.15s",
                            }}>
                            <span
                                style={{
                                    position: "absolute",
                                    top: 3,
                                    left: state.eqEnabled ? 21 : 3,
                                    width: 20,
                                    height: 20,
                                    borderRadius: "50%",
                                    background: "#fff",
                                    transition: "left 0.15s",
                                }}
                            />
                        </button>
                    </div>

                    <div className="flux-sidebar-scroll" style={{ display: "flex", gap: 6, padding: "6px 0 16px", overflowX: state.eqEnabled ? "auto" : "hidden" }}>
                        {EQ_PRESET_OPTIONS.map(({ key, label }) => (
                            <button
                                key={key}
                                onClick={() => actions.setEqPreset(key)}
                                disabled={!state.eqEnabled}
                                style={{
                                    flexShrink: 0,
                                    padding: "6px 12px",
                                    borderRadius: 999,
                                    border: "none",
                                    background: state.eqPreset === key ? "var(--color-primary)" : "rgba(255,255,255,0.08)",
                                    color: state.eqPreset === key ? "#fff" : "rgba(255,255,255,0.7)",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: state.eqEnabled ? "pointer" : "default",
                                    opacity: state.eqEnabled ? 1 : 0.5,
                                    WebkitTapHighlightColor: "transparent",
                                }}>
                                {label}
                            </button>
                        ))}
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-around", gap: 4 }}>
                        {EQ_BAND_KEYS.map(({ key, hz }) => {
                            const value = state.eqBands?.[key] ?? 0;
                            return (
                                <div key={key} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, flex: 1 }}>
                                    <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.5)", fontFamily: "ui-monospace,monospace" }}>{value > 0 ? `+${value}` : value} dB</span>
                                    <input
                                        type="range"
                                        min={-12}
                                        max={12}
                                        step={1}
                                        value={value}
                                        onChange={(e) => actions.setEqBands({ [key]: +e.target.value })}
                                        disabled={!state.eqEnabled}
                                        style={{
                                            writingMode: "vertical-lr",
                                            direction: "rtl",
                                            width: 24,
                                            height: 100,
                                            accentColor: "var(--color-primary)",
                                            opacity: state.eqEnabled ? 1 : 0.4,
                                        }}
                                    />
                                    <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.6)", fontWeight: 600 }}>{hz}</span>
                                </div>
                            );
                        })}
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-around", gap: 12, marginTop: 22, paddingTop: 18, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                        <CircularKnob label="Bass Boost" value={state.bassBoostLevel} onChange={actions.setBassBoostLevel} disabled={!state.eqEnabled} />
                        <CircularKnob label="Virtualizer" value={state.virtualizerLevel} onChange={actions.setVirtualizerLevel} disabled={!state.eqEnabled} />
                    </div>
                </div>
            )}
        </MenuShell>
    );
}

// ─── Sleep Timer panel (full overlay, matches reference screenshot) ─────────

export function SleepTimerPanel({ open, onClose, isMobile, controlsPhase }) {
    const { state, actions } = usePlayerState();
    // Raw digit buffer, phone-dialer style: each digit pressed shifts left,
    // pushing existing digits further left (e.g. press 1 → 0001 → "00h01m",
    // press 5 → 0015 → "00h15m", press 3 → 0153 → "01h53m"). Max 4 digits.
    const [digits, setDigits] = useState("0000");

    const hours = parseInt(digits.slice(0, 2), 10);
    const minsRaw = parseInt(digits.slice(2, 4), 10);
    const minutes = Math.min(59, minsRaw); // clamp invalid minute entry (e.g. "75") down to 59

    const pressDigit = (d) => {
        setDigits((prev) => (prev + d).slice(-4));
    };
    const totalMs = (hours * 60 + minutes) * 60 * 1000;
    const isRunning = !!state.sleepTimerEndsAt;

    const handleStart = () => {
        if (totalMs <= 0) return;
        actions.setSleepTimer(Date.now() + totalMs);
        onClose();
    };
    const handleStop = () => {
        actions.setSleepTimer(null);
        setDigits("0000");
    };

    return (
        <MenuShell isMobile={isMobile} controlsPhase={controlsPhase} open={open} onClose={onClose} title="Sleep Timer" side="bottom">
            <div style={{ display: "flex", flexDirection: "column", padding: "4px 20px 0", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 4 }}>
                    <span style={{ color: "#fff", fontSize: 32, fontWeight: 800, lineHeight: 1 }}>
                        {String(hours).padStart(2, "0")}
                        <span style={{ fontSize: 14, fontWeight: 600, opacity: 0.6 }}>h</span>
                    </span>
                    <span style={{ color: "#fff", fontSize: 32, fontWeight: 800, lineHeight: 1, marginLeft: 6 }}>
                        {String(minutes).padStart(2, "0")}
                        <span style={{ fontSize: 14, fontWeight: 600, opacity: 0.6 }}>m</span>
                    </span>
                </div>
                <div style={{ height: 1, background: "rgba(255,255,255,0.18)" }} />

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, justifyContent: "center", maxWidth: 150, margin: "0 auto", width: "100%" }}>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                        <button
                            key={n}
                            onClick={() => pressDigit(String(n))}
                            style={{
                                width: "100%",
                                maxWidth: 34,
                                aspectRatio: "1",
                                margin: "0 auto",
                                borderRadius: "50%",
                                background: "rgba(255,255,255,0.08)",
                                border: "1px solid rgba(255,255,255,0.1)",
                                color: "#fff",
                                fontSize: 13,
                                fontWeight: 600,
                                cursor: "pointer",
                            }}>
                            {n}
                        </button>
                    ))}
                    <div />
                    <button
                        onClick={() => pressDigit("0")}
                        style={{
                            width: "100%",
                            maxWidth: 34,
                            aspectRatio: "1",
                            margin: "0 auto",
                            borderRadius: "50%",
                            background: "rgba(255,255,255,0.08)",
                            border: "1px solid rgba(255,255,255,0.1)",
                            color: "#fff",
                            fontSize: 13,
                            fontWeight: 600,
                            cursor: "pointer",
                        }}>
                        0
                    </button>
                </div>

                <label style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center", cursor: "pointer", marginTop: 2 }}>
                    <input type="checkbox" checked={state.sleepTimerPlayToEnd} onChange={() => actions.toggleSleepPlayToEnd()} style={{ width: 15, height: 15, accentColor: "#6366f1" }} />
                    <span style={{ color: "rgba(255,255,255,0.8)", fontSize: 12 }}>Play last media to the end</span>
                </label>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 20px", marginTop: 6, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                <button
                    onClick={handleStop}
                    disabled={!isRunning}
                    style={{
                        background: "none",
                        border: "none",
                        color: isRunning ? "#4d8dff" : "rgba(255,255,255,0.25)",
                        fontSize: 13,
                        fontWeight: 700,
                        letterSpacing: "0.04em",
                        cursor: isRunning ? "pointer" : "default",
                    }}>
                    STOP
                </button>
                <button
                    onClick={handleStart}
                    disabled={totalMs <= 0}
                    style={{
                        background: "none",
                        border: "none",
                        color: totalMs > 0 ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.25)",
                        fontSize: 13,
                        fontWeight: 700,
                        letterSpacing: "0.04em",
                        cursor: totalMs > 0 ? "pointer" : "default",
                    }}>
                    START
                </button>
            </div>
        </MenuShell>
    );
}

export function CustomiseItemsPanel({ open, onClose, isMobile, controlsPhase }) {
    const { state, actions } = usePlayerState();
    const dragIndex = useRef(null);
    const order = state.quickIconOrder;
    const rest = Object.keys(ALL_QUICK_ITEMS).filter((k) => !order.includes(k));
    const fullList = [...order, ...rest];
    const handleDrop = (toIndex) => {
        if (dragIndex.current === null || dragIndex.current === toIndex) return;
        const next = [...fullList];
        const [moved] = next.splice(dragIndex.current, 1);
        next.splice(toIndex, 0, moved);
        actions.setQuickIconOrder(next.slice(0, 5));
        dragIndex.current = null;
    };
    return (
        <MenuShell isMobile={isMobile} controlsPhase={controlsPhase} open={open} onClose={onClose} title="Customise Items" side="bottom">
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", padding: "0 16px 8px", margin: 0 }}>Drag to reorder. Top 5 show in the quick row.</p>
            <div style={{ display: "flex", flexDirection: "column", padding: "0 12px 8px" }}>
                {fullList.map((key, i) => {
                    const item = ALL_QUICK_ITEMS[key];
                    if (!item) return null;
                    const Icon = item.icon;
                    const isQuick = i < 5;
                    return (
                        <div
                            key={key}
                            draggable
                            onDragStart={() => (dragIndex.current = i)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => handleDrop(i)}
                            style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 8px", borderRadius: 8, cursor: "grab", background: isQuick ? "rgba(229,62,62,0.1)" : "transparent" }}>
                            <GripVertical size={14} style={{ opacity: 0.35, flexShrink: 0 }} />
                            <Icon size={16} style={{ opacity: 0.7, flexShrink: 0 }} />
                            <span style={{ fontSize: 13, color: "#fff", flex: 1 }}>{item.label}</span>
                            {isQuick && <span style={{ fontSize: 9, fontWeight: 700, color: "#e53e3e" }}>QUICK</span>}
                        </div>
                    );
                })}
            </div>
        </MenuShell>
    );
}
