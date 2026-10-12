import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useSearchParams } from "react-router";
import { User, Palette, Database, Play, Captions, Server, Info, ShieldCheck, Lock, Search, Check, CornerDownLeft, X } from "lucide-react";
import { useApi } from "../../Context/apiContext";
import { useAuth } from "../../auth/AuthContext";
import { useAuthModal } from "../../auth/AuthModalContext";

import ProfileSection from "./ProfileSection";
import AppearanceSection from "./AppearanceSection";
import LibrarySection from "./LibrarySection";
import RestrictionsSection from "./RestrictionsSection";
import PlaybackSection from "./PlaybackSection";
import SubtitlesSection from "./SubtitlesSection";
import ServerSection from "./ServerSection";
import PrivacySection from "./PrivacySection";
import AboutSection from "./AboutSection";
import AddFolderModal from "./AddFolderModal";
import { FOCUS, PREFS_KEY, loadPrefs, savePrefs } from "./shared";

// ─── Navigation (grouped, Plex-style) ─────────────────────────────────────────
const GROUPS = [
    { label: "Account", items: [{ id: "profile", label: "Profile", icon: User, desc: "Account, access and password" }] },
    {
        label: "Experience",
        items: [
            { id: "appearance", label: "Appearance", icon: Palette, desc: "Themes, typography and layout" },
            { id: "playback", label: "Playback", icon: Play, desc: "Player behaviour and gestures" },
            { id: "subtitles", label: "Subtitles", icon: Captions, desc: "Caption style and language" },
        ],
    },
    {
        label: "Library",
        items: [
            { id: "library", label: "Library", icon: Database, desc: "Media folders and metadata", adminOnly: true },
            { id: "restrictions", label: "Restrictions", icon: Lock, desc: "Rating limits and PIN lock" },
        ],
    },
    {
        label: "System",
        items: [
            { id: "server", label: "Server", icon: Server, desc: "Connection and streaming" },
            { id: "privacy", label: "Privacy", icon: ShieldCheck, desc: "Data, history and visibility" },
            { id: "about", label: "About", icon: Info, desc: "App info and reset" },
        ],
    },
];

// [tab, label, anchor (Row id), extra search keywords]
const INDEX = [
    ["profile", "Edit profile", null, "name photo avatar display picture"],
    ["profile", "Change password", null, "security sign in"],
    ["profile", "Sign out", null, "logout log out"],
    ["profile", "Watch activity", null, "stats history time watched titles"],
    ["profile", "Profile preferences", null, "summary quick links theme speed subtitles setup"],
    ["profile", "Account checklist", null, "photo pin security complete setup"],
    ["appearance", "Theme", "a-theme", "colour color dark light custom palette"],
    ["appearance", "Font family", "a-font", "typeface text"],
    ["appearance", "Font scale", "a-scale", "text size zoom"],
    ["appearance", "Line height", "a-line", "spacing"],
    ["appearance", "Density", "a-density", "compact comfortable spacing"],
    ["appearance", "Border radius", "a-radius", "rounded corners"],
    ["appearance", "Sidebar width", "a-sidebar", "layout"],
    ["appearance", "Reduced motion", "a-motion", "animation accessibility"],
    ["appearance", "High contrast", "a-contrast", "accessibility"],
    ["appearance", "Focus indicators", "a-focus", "keyboard accessibility"],
    ["playback", "Auto-play next episode", "p-autoplay", "continue binge"],
    ["playback", "Next episode countdown", "p-countdown", "delay autoplay"],
    ["playback", "Resume playback", "p-resume", "continue where left"],
    ["playback", "Skip intro", "p-skip", "intro"],
    ["playback", "Remember volume", "p-volume", "sound"],
    ["playback", "Swipe to seek", "p-seek-gesture", "gesture touch mx"],
    ["playback", "Swipe for volume", "p-vol-gesture", "gesture touch"],
    ["playback", "Swipe for brightness", "p-bright-gesture", "gesture touch"],
    ["playback", "Double-tap to seek", "p-doubletap", "gesture touch skip"],
    ["playback", "Seek step", "p-seekstep", "skip forward back seconds"],
    ["playback", "Hide controls after", "p-hide", "auto hide overlay"],
    ["playback", "Preferred audio language", "p-audio", "dub dual audio"],
    ["playback", "Default speed", "p-speed", "playback rate"],
    ["subtitles", "Show subtitles by default", "s-default", "captions cc"],
    ["subtitles", "Subtitle language", "s-lang", "captions preferred"],
    ["subtitles", "Subtitle font size", "s-size", "captions text"],
    ["subtitles", "Subtitle text colour", "s-color", "color captions"],
    ["subtitles", "Subtitle background", "s-bg", "captions box"],
    ["subtitles", "Subtitle background opacity", "s-opacity", "captions transparency"],
    ["subtitles", "Bold subtitles", "s-bold", "captions weight"],
    ["subtitles", "Subtitle position", "s-position", "captions height offset"],
    ["library", "Media folders", "l-folders", "add remove path directory scan"],
    ["library", "Refresh metadata", "l-folders", "tmdb posters rescan"],
    ["restrictions", "Content rating limit", "r-limit", "restricted parental kids rated pg r tv-ma"],
    ["restrictions", "Hide unrated titles", "r-unrated", "restricted parental"],
    ["restrictions", "Restriction PIN", "r-pin", "lock parental code"],
    ["server", "Connection status", "sv-conn", "online latency health uptime"],
    ["server", "Direct play", "sv-direct", "streaming"],
    ["server", "Prefer HLS", "sv-hls", "adaptive streaming ffmpeg transcode"],
    ["server", "Buffer ahead", "sv-buffer", "smooth streaming"],
    ["privacy", "Crash reports", "pv-crash", "diagnostics"],
    ["privacy", "Usage analytics", "pv-telemetry", "diagnostics telemetry"],
    ["privacy", "Activity status", "pv-activity", "online visibility"],
    ["privacy", "Public watchlist", "pv-watchlist", "visibility profile"],
    ["privacy", "Show playback progress", "pv-progress", "visibility profile"],
    ["privacy", "Keep watch history", "pv-history", "resume tracking"],
    ["privacy", "Keep search history", "pv-search", "suggestions"],
    ["privacy", "Export data", "pv-export", "backup download json"],
    ["privacy", "Import data", "pv-import", "restore backup upload json"],
    ["privacy", "Clear local data", "pv-clear", "delete reset cache"],
    ["about", "Clear watch history", "ab-history", "reset"],
    ["about", "Reset preferences", "ab-prefs", "defaults restore"],
    ["about", "Copy diagnostics", "ab-diag", "debug support version"],
];

const CSS = `
@keyframes fluxFlash{0%{background:color-mix(in oklab,var(--color-primary) 24%,transparent)}100%{background:transparent}}
.flux-flash{animation:fluxFlash 1.7s ease-out}
.flux-range{-webkit-appearance:none;appearance:none;height:6px;border-radius:999px;outline:none;cursor:pointer}
.flux-range::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:#fff;border:2px solid var(--color-primary);box-shadow:0 1px 3px rgba(0,0,0,.45)}
.flux-range::-moz-range-thumb{width:12px;height:12px;border-radius:50%;background:#fff;border:2px solid var(--color-primary)}
.flux-range:focus-visible{outline:2px solid var(--color-primary);outline-offset:4px}
@media (prefers-reduced-motion:reduce){.flux-flash{animation:none}}
`;

const len = (x) => (Array.isArray(x) ? x.length : (x?.items?.length ?? 0));

// ─── Settings search ──────────────────────────────────────────────────────────
const RECENT_KEY = "flux-settings-recent";
const SUGGESTED = ["Theme", "Subtitle font size", "Restriction PIN", "Export data", "Connection status"];

const readRecent = () => {
    try {
        const v = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
        return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 5) : [];
    } catch {
        return [];
    }
};
const writeRecent = (list) => {
    try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    } catch {}
};

// Higher = better. -1 = a term did not match anywhere.
function score(e, terms) {
    const label = e.label.toLowerCase();
    const rest = `${e.kw} ${e.sectionLabel}`.toLowerCase();
    let s = 0;
    for (const t of terms) {
        if (label.startsWith(t)) s += 4;
        else if (label.split(/\s+/).some((w) => w.startsWith(t))) s += 3;
        else if (label.includes(t)) s += 2;
        else if (rest.includes(t)) s += 1;
        else return -1;
    }
    return s;
}

function Hit({ text, terms }) {
    if (!terms.length) return text;
    const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "ig");
    return text.split(re).map((part, i) =>
        i % 2 ? (
            <mark key={i} className="bg-transparent font-semibold text-primary">
                {part}
            </mark>
        ) : (
            part
        ),
    );
}

function SettingsSearch({ entries, onPick, inputRef }) {
    const [q, setQ] = useState("");
    const [open, setOpen] = useState(false);
    const [idx, setIdx] = useState(0);
    const [recent, setRecent] = useState(readRecent);
    const [mobileOpen, setMobileOpen] = useState(false); // icon-only below md, expands to a full-width bar

    const terms = useMemo(() => q.trim().toLowerCase().split(/\s+/).filter(Boolean), [q]);

    const groups = useMemo(() => {
        if (terms.length) {
            const hits = entries
                .map((e) => ({ e, s: score(e, terms) }))
                .filter((x) => x.s >= 0)
                .sort((a, b) => b.s - a.s)
                .slice(0, 10)
                .map((x) => x.e);
            const order = [];
            const map = new Map();
            hits.forEach((e) => {
                if (!map.has(e.sectionLabel)) {
                    map.set(e.sectionLabel, []);
                    order.push(e.sectionLabel);
                }
                map.get(e.sectionLabel).push(e);
            });
            return order.map((label) => ({ label, items: map.get(label) }));
        }
        const byLabel = (labels) => labels.map((l) => entries.find((e) => e.label === l)).filter(Boolean);
        const rec = byLabel(recent);
        return [{ label: rec.length ? "Recent" : "Suggested", items: rec.length ? rec : byLabel(SUGGESTED) }];
    }, [terms, entries, recent]);

    const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

    useEffect(() => setIdx(0), [q]);
    useEffect(() => {
        if (open) document.getElementById(`ss-opt-${idx}`)?.scrollIntoView({ block: "nearest" });
    }, [idx, open]);
    useEffect(() => {
        if (mobileOpen) inputRef.current?.focus();
    }, [mobileOpen, inputRef]);

    const closeMobile = () => {
        setMobileOpen(false);
        setQ("");
        setOpen(false);
    };

    function pick(e) {
        const next = [e.label, ...recent.filter((l) => l !== e.label)].slice(0, 5);
        setRecent(next);
        writeRecent(next);
        onPick(e);
        setQ("");
        setOpen(false);
        setMobileOpen(false);
        inputRef.current?.blur();
    }

    function onKeyDown(e) {
        if (e.key === "ArrowDown" && flat.length) {
            e.preventDefault();
            setOpen(true);
            setIdx((i) => (i + 1) % flat.length);
        } else if (e.key === "ArrowUp" && flat.length) {
            e.preventDefault();
            setIdx((i) => (i - 1 + flat.length) % flat.length);
        } else if (e.key === "Enter" && open && flat[idx]) {
            e.preventDefault();
            pick(flat[idx]);
        } else if (e.key === "Escape") {
            if (q) setQ("");
            else {
                setOpen(false);
                setMobileOpen(false);
                e.currentTarget.blur();
            }
        }
    }

    let n = -1;
    const noMatch = terms.length > 0 && flat.length === 0;

    return (
        <>
            {/* Small screens: icon only */}
            <button
                type="button"
                aria-label="Search settings"
                aria-expanded={mobileOpen}
                onClick={() => {
                    setMobileOpen(true);
                    setOpen(true);
                }}
                className={`flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-md bg-base-300 text-base-content/75 transition-colors hover:bg-base-content/10 hover:text-base-content md:hidden ${FOCUS}`}>
                <Search size={17} />
            </button>

            {mobileOpen && <div aria-hidden="true" onClick={closeMobile} className="fixed inset-0 z-[59] bg-black/50 md:hidden" />}

            <div
                className={`${
                    mobileOpen ? "fixed inset-x-0 top-14 z-[60] flex items-center gap-2 border-b border-base-content/10 bg-base-200 p-3 shadow-xl" : "hidden"
                } md:relative md:inset-auto md:z-auto md:block md:w-72 md:border-0 md:bg-transparent md:p-0 md:shadow-none lg:w-96`}
                onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
                <div className="relative min-w-0 flex-1 md:flex-none">
                    <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-base-content/50" />
                    <input
                        ref={inputRef}
                        type="text"
                        role="combobox"
                        aria-expanded={open}
                        aria-controls="settings-search-list"
                        aria-activedescendant={open && flat[idx] ? `ss-opt-${idx}` : undefined}
                        aria-autocomplete="list"
                        autoComplete="off"
                        spellCheck={false}
                        aria-label="Search settings"
                        value={q}
                        onChange={(e) => {
                            setQ(e.target.value);
                            setOpen(true);
                        }}
                        onFocus={() => setOpen(true)}
                        onKeyDown={onKeyDown}
                        placeholder="Search settings"
                        className={`h-11 w-full rounded-md border-0 bg-base-300 pl-10 pr-10 text-base text-base-content placeholder:text-base-content/45 transition-colors hover:bg-base-content/10 focus:bg-base-100 focus:outline-none md:h-10 md:text-[13px]`}
                    />
                    {q ? (
                        <button
                            type="button"
                            aria-label="Clear search"
                            onClick={() => {
                                setQ("");
                                inputRef.current?.focus();
                            }}
                            className={`absolute right-2 top-1/2 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-base-content/55 hover:bg-base-content/10 hover:text-base-content ${FOCUS}`}>
                            <X size={14} />
                        </button>
                    ) : (
                        <kbd className="pointer-events-none absolute right-3.5 top-1/2 hidden -translate-y-1/2 rounded border border-base-content/20 px-1.5 text-[11px] text-base-content/50 md:block">
                            /
                        </kbd>
                    )}
                </div>

                <button type="button" onClick={closeMobile} className={`shrink-0 cursor-pointer rounded-md px-2 py-2 text-[13px] font-medium text-primary md:hidden ${FOCUS}`}>
                    Cancel
                </button>

                {open && (
                    <div
                        id="settings-search-list"
                        role="listbox"
                        aria-label="Matching settings"
                        onMouseDown={(e) => e.preventDefault()}
                        className="absolute inset-x-0 top-full z-50 overflow-hidden border-y border-base-content/15 bg-base-200 shadow-2xl md:inset-x-auto md:right-0 md:mt-2 md:w-[26rem] md:rounded-md md:border">
                        <div className="max-h-[min(60vh,26rem)] overflow-y-auto py-1">
                            {noMatch ? (
                                <div className="px-4 py-8 text-center">
                                    <p className="text-sm font-medium text-base-content">No settings match “{q.trim()}”</p>
                                    <p className="mt-1 text-[13px] text-base-content/60">Try “theme”, “subtitle” or “PIN”.</p>
                                </div>
                            ) : (
                                groups.map((g) => (
                                    <div key={g.label}>
                                        <div className="flex items-center justify-between px-4 pb-1 pt-2.5">
                                            <p className="text-xs font-medium text-base-content/55">{g.label}</p>
                                            {g.label === "Recent" && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setRecent([]);
                                                        writeRecent([]);
                                                    }}
                                                    className={`cursor-pointer rounded px-1 text-xs text-base-content/55 hover:text-base-content ${FOCUS}`}>
                                                    Clear
                                                </button>
                                            )}
                                        </div>
                                        {g.items.map((r) => {
                                            n += 1;
                                            const i = n;
                                            const on = i === idx;
                                            return (
                                                <button
                                                    key={`${r.tab}-${r.label}`}
                                                    id={`ss-opt-${i}`}
                                                    type="button"
                                                    role="option"
                                                    aria-selected={on}
                                                    onClick={() => pick(r)}
                                                    onMouseEnter={() => setIdx(i)}
                                                    className={`flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors md:py-2.5 ${on ? "bg-primary/12" : ""}`}>
                                                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-base-300">
                                                        <r.icon size={15} className="text-base-content/65" />
                                                    </span>
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block truncate text-[13px] font-medium text-base-content">
                                                            <Hit text={r.label} terms={terms} />
                                                        </span>
                                                        <span className="block truncate text-xs text-base-content/55">{r.sectionLabel}</span>
                                                    </span>
                                                    {on && <CornerDownLeft size={13} className="hidden shrink-0 text-base-content/45 md:block" />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                ))
                            )}
                        </div>
                        <div className="hidden items-center gap-4 border-t border-base-content/10 bg-base-300/40 px-4 py-2 text-xs text-base-content/50 md:flex">
                            <span>↑ ↓ to move</span>
                            <span>Enter to open</span>
                            <span>Esc to close</span>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Settings() {
    const { folders, addLibraryFolder, removeLibraryFolder, updateLibraryFolder, refreshAll, loading, movies, series, anime } = useApi();
    const { user, logout } = useAuth();
    const { openAuthModal } = useAuthModal();
    const isAdmin = user?.role === "admin";

    const NAV_GROUPS = useMemo(() => GROUPS.map((g) => ({ ...g, items: g.items.filter((n) => !n.adminOnly || isAdmin) })).filter((g) => g.items.length), [isAdmin]);
    const NAV_ITEMS = useMemo(() => NAV_GROUPS.flatMap((g) => g.items), [NAV_GROUPS]);
    const IDS = useMemo(() => NAV_ITEMS.map((n) => n.id), [NAV_ITEMS]);

    const entries = useMemo(
        () =>
            INDEX.map(([tab, label, anchor, kw]) => {
                const nav = NAV_ITEMS.find((n) => n.id === tab);
                return nav ? { tab, label, anchor, kw, icon: nav.icon, sectionLabel: nav.label } : null;
            }).filter(Boolean),
        [NAV_ITEMS],
    );

    const [searchParams, setSearchParams] = useSearchParams();
    const initial = IDS.includes(searchParams.get("tab")) ? searchParams.get("tab") : "profile";
    const [active, setActive] = useState(initial);
    const [jump, setJump] = useState(0);
    const anchorRef = useRef(null);
    const searchRef = useRef(null);

    const go = useCallback(
        (id) => {
            setActive(id);
            setSearchParams({ tab: id }, { replace: true });
            if (!anchorRef.current) window.scrollTo({ top: 0 });
        },
        [setSearchParams],
    );

    useEffect(() => {
        const t = searchParams.get("tab");
        if (t && IDS.includes(t) && t !== active) setActive(t);
        else if (t === "library" && !isAdmin) go("profile");
    }, [searchParams, isAdmin]); // eslint-disable-line

    // Jump to + flash the setting picked from search
    useEffect(() => {
        const a = anchorRef.current;
        if (!a) return;
        anchorRef.current = null;
        const t = setTimeout(() => {
            const el = document.getElementById(a);
            if (!el) return;
            el.scrollIntoView({ block: "center", behavior: "smooth" });
            el.classList.remove("flux-flash");
            void el.offsetWidth;
            el.classList.add("flux-flash");
            setTimeout(() => el.classList.remove("flux-flash"), 1800);
        }, 80);
        return () => clearTimeout(t);
    }, [active, jump]);

    function pickEntry(e) {
        anchorRef.current = e.anchor;
        go(e.tab);
        setJump((j) => j + 1);
    }

    // "/" or Ctrl/Cmd+K focuses search
    useEffect(() => {
        const on = (e) => {
            const isK = e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey);
            const isSlash = e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey;
            if (!isK && !isSlash) return;
            const t = e.target;
            const tag = t?.tagName;
            if (isSlash && (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable)) return;
            e.preventDefault();
            searchRef.current?.focus();
            searchRef.current?.select();
        };
        window.addEventListener("keydown", on);
        return () => window.removeEventListener("keydown", on);
    }, []);

    // ── Preferences (localStorage "flux-prefs", shared with the player) ──
    const [addFolderOpen, setAddFolderOpen] = useState(false);
    const [prefs, setPrefsState] = useState(loadPrefs);
    const prefsRef = useRef(prefs);
    const [saved, setSaved] = useState(false);
    const savedTimer = useRef(null);

    const flashSaved = useCallback(() => {
        setSaved(true);
        clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSaved(false), 1600);
    }, []);
    useEffect(() => () => clearTimeout(savedTimer.current), []);

    const commit = useCallback(
        (next) => {
            prefsRef.current = next;
            setPrefsState(next);
            savePrefs(next);
            flashSaved();
        },
        [flashSaved],
    );
    // setPref(key, undefined) removes the key → falls back to the default
    const setPref = useCallback((key, val) => commit({ ...prefsRef.current, [key]: val }), [commit]);
    const replacePrefs = useCallback((obj) => commit(obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {}), [commit]);

    // Keep in sync with other browser tabs
    useEffect(() => {
        const on = (e) => {
            if (e.key === PREFS_KEY || e.key === null) {
                const next = loadPrefs();
                prefsRef.current = next;
                setPrefsState(next);
            }
        };
        window.addEventListener("storage", on);
        return () => window.removeEventListener("storage", on);
    }, []);

    const activeNav = NAV_ITEMS.find((n) => n.id === active);

    const section = (() => {
        switch (active) {
            case "profile":
                return <ProfileSection handleLogout={() => logout()} setLoginOpen={() => openAuthModal({ view: "login" })} />;
            case "appearance":
                return <AppearanceSection />;
            case "library":
                return isAdmin ? (
                    <LibrarySection
                        folders={folders}
                        removeLibraryFolder={removeLibraryFolder}
                        updateLibraryFolder={updateLibraryFolder}
                        setAddFolderOpen={setAddFolderOpen}
                        refreshAll={refreshAll}
                        loading={loading}
                        counts={{ movies: len(movies), series: len(series), anime: len(anime) }}
                    />
                ) : null;
            case "restrictions":
                return <RestrictionsSection prefs={prefs} setPref={setPref} />;
            case "playback":
                return <PlaybackSection prefs={prefs} setPref={setPref} />;
            case "subtitles":
                return <SubtitlesSection prefs={prefs} setPref={setPref} />;
            case "server":
                return <ServerSection prefs={prefs} setPref={setPref} />;
            case "privacy":
                return <PrivacySection prefs={prefs} setPref={setPref} setPrefs={replacePrefs} />;
            case "about":
                return <AboutSection setPrefs={replacePrefs} />;
            default:
                return null;
        }
    })();

    return (
        <div className="-m-4 sm:-m-6 lg:-m-8">
            <style>{CSS}</style>

            {/* ── Page header ── */}
            <header className="border-b border-base-content/10 bg-base-200/50 px-4 py-4 sm:px-7 sm:py-5">
                <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <h1 className="text-xl font-semibold leading-tight text-base-content">Settings</h1>
                        <p className="mt-0.5 hidden text-[13px] text-base-content/60 sm:block">Manage your account, player and server.</p>
                    </div>
                    <div className="flex items-center gap-2.5">
                        <span
                            role="status"
                            aria-live="polite"
                            className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border border-success/35 bg-success/10 px-2.5 py-1 text-xs font-medium text-success transition-opacity duration-200 ${saved ? "opacity-100" : "opacity-0"}`}>
                            <Check size={12} strokeWidth={3} /> Saved
                        </span>
                        <SettingsSearch entries={entries} onPick={pickEntry} inputRef={searchRef} />
                    </div>
                </div>
            </header>

            {/* ── Mobile tab strip ── */}
            <div className="sticky top-14 z-30 border-b border-base-content/10 bg-base-100/95 backdrop-blur md:hidden">
                <div className="flex gap-1 overflow-x-auto px-3 py-2.5" style={{ scrollbarWidth: "none" }}>
                    {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
                        <button
                            key={id}
                            onClick={() => go(id)}
                            aria-current={active === id ? "page" : undefined}
                            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-3.5 py-2 text-xs font-medium transition-colors ${FOCUS}
                                ${active === id ? "border-primary/40 bg-primary/15 text-primary" : "border-transparent text-base-content/75 hover:bg-base-content/10 hover:text-base-content"}`}>
                            <Icon size={13} strokeWidth={active === id ? 2.4 : 2} />
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex">
                {/* ── Sidebar ── */}
                <aside className="hidden w-60 shrink-0 border-r border-base-content/10 md:block">
                    <nav aria-label="Settings sections" className="sticky top-14 max-h-[calc(100vh-3.5rem)] overflow-y-auto px-3 py-4">
                        {NAV_GROUPS.map((g) => (
                            <div key={g.label} className="mb-5 last:mb-0">
                                <p className="mb-1.5 px-3 text-xs font-medium text-base-content/50">{g.label}</p>
                                <div className="flex flex-col gap-0.5">
                                    {g.items.map(({ id, icon: Icon, label }) => {
                                        const on = active === id;
                                        return (
                                            <button
                                                key={id}
                                                onClick={() => go(id)}
                                                aria-current={on ? "page" : undefined}
                                                className={`relative flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-left text-[13px] font-medium transition-colors ${FOCUS}
                                                    ${on ? "bg-primary/12 text-primary" : "text-base-content/70 hover:bg-base-content/8 hover:text-base-content"}`}>
                                                {on && <span className="absolute bottom-2 left-0 top-2 w-0.5 rounded-r bg-primary" />}
                                                <Icon size={16} strokeWidth={on ? 2.2 : 1.8} className="shrink-0" />
                                                {label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                        <p className="mt-6 px-3 font-mono text-[11px] text-base-content/45">Flux v0.1.0</p>
                    </nav>
                </aside>

                {/* ── Content ── */}
                <main className="min-w-0 flex-1 px-4 py-6 sm:px-7">
                    <div className="w-full max-w-5xl">
                        {activeNav && (
                            <div className="mb-6 flex items-center gap-3.5">
                                <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-base-content/10 bg-base-200">
                                    <activeNav.icon size={18} className="text-primary" />
                                </span>
                                <div className="min-w-0">
                                    <h2 className="text-lg font-semibold leading-tight text-base-content">{activeNav.label}</h2>
                                    <p className="mt-0.5 text-[13px] text-base-content/60">{activeNav.desc}</p>
                                </div>
                            </div>
                        )}
                        {section}
                    </div>
                </main>
            </div>

            {isAdmin && <AddFolderModal open={addFolderOpen} onClose={() => setAddFolderOpen(false)} onAdd={addLibraryFolder} />}
        </div>
    );
}
