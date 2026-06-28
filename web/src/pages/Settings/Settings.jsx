import { useState, useEffect } from "react";
import { useSearchParams } from "react-router";
import { User, Palette, Database, Play, Captions, Server, Info, ShieldCheck, ChevronRight } from "lucide-react";
import { useTheme } from "../../Context/themeContext";
import { useApi } from "../../Context/apiContext";
import { useAuth } from "../../auth/AuthContext";
import { useAuthModal } from "../../auth/AuthModalContext";

import ProfileSection from "./ProfileSection";
import AppearanceSection from "./AppearanceSection";
import LibrarySection from "./LibrarySection";
import PlaybackSection from "./PlaybackSection";
import SubtitlesSection from "./SubtitlesSection";
import ServerSection from "./ServerSection";
import PrivacySection from "./PrivacySection";
import AboutSection from "./AboutSection";
import AddFolderModal from "./AddFolderModal";

const NAV_ITEMS = [
    { id: "profile",    label: "Profile",       icon: User },
    { id: "appearance", label: "Appearance",     icon: Palette },
    { id: "library",    label: "Media Library",  icon: Database },
    { id: "playback",   label: "Playback",       icon: Play },
    { id: "subtitles",  label: "Subtitles",      icon: Captions },
    { id: "server",     label: "Server",         icon: Server },
    { id: "privacy",    label: "Privacy",        icon: ShieldCheck },
    { id: "about",      label: "About",          icon: Info },
];

const VALID_TABS = NAV_ITEMS.map((n) => n.id);

export default function Settings() {
    const { theme, setTheme, themes } = useTheme();
    const { folders, addLibraryFolder, removeLibraryFolder, updateLibraryFolder, refreshAll, loading } = useApi();

    const [searchParams, setSearchParams] = useSearchParams();
    const tabParam = searchParams.get("tab");
    const initialTab = VALID_TABS.includes(tabParam) ? tabParam : "profile";

    const [active, setActive] = useState(initialTab);

    useEffect(() => {
        const t = searchParams.get("tab");
        if (t && VALID_TABS.includes(t) && t !== active) setActive(t);
    }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

    const switchTab = (id) => {
        setActive(id);
        setSearchParams({ tab: id }, { replace: true });
    };

    const [addFolderOpen, setAddFolderOpen] = useState(false);

    const { user, logout } = useAuth();
    const { openAuthModal } = useAuthModal();

    useEffect(() => {}, [user?.name]);

    const handleLogout = () => logout();

    const [prefs, setPrefsState] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem("flux-prefs") || "{}");
        } catch {
            return {};
        }
    });

    const setPref = (key, val) => {
        setPrefsState((p) => {
            const next = { ...p, [key]: val };
            try {
                localStorage.setItem("flux-prefs", JSON.stringify(next));
            } catch {}
            return next;
        });
    };

    const renderSection = () => {
        switch (active) {
            case "profile":
                return <ProfileSection handleLogout={handleLogout} setLoginOpen={() => openAuthModal({ view: "login" })} />;
            case "appearance":
                return <AppearanceSection theme={theme} setTheme={setTheme} themes={themes} />;
            case "library":
                return (
                    <LibrarySection
                        folders={folders}
                        removeLibraryFolder={removeLibraryFolder}
                        updateLibraryFolder={updateLibraryFolder}
                        setAddFolderOpen={setAddFolderOpen}
                        refreshAll={refreshAll}
                        loading={loading}
                    />
                );
            case "playback":
                return <PlaybackSection prefs={prefs} setPref={setPref} />;
            case "subtitles":
                return <SubtitlesSection prefs={prefs} setPref={setPref} />;
            case "server":
                return <ServerSection prefs={prefs} setPref={setPref} />;
            case "privacy":
                return <PrivacySection prefs={prefs} setPref={setPref} />;
            case "about":
                return <AboutSection setPrefs={setPrefsState} />;
            default:
                return null;
        }
    };

    const activeItem = NAV_ITEMS.find((n) => n.id === active);

    return (
        <div className="-m-4 sm:-m-6 lg:-m-8 min-h-screen flex flex-col bg-base-100">
            {/* ── Header ── */}
            <div className="px-5 sm:px-8 py-5 border-b border-white/[0.07] bg-base-200/40 shrink-0">
                <h1 className="text-2xl font-bold text-white tracking-tight">Settings</h1>
                <p className="text-xs text-white/40 mt-0.5">Manage your Flux preferences</p>
            </div>

            {/* ── Body ── */}
            <div className="flex flex-1 min-h-0 overflow-hidden">

                {/* Sidebar — desktop */}
                <aside
                    className="hidden sm:flex flex-col shrink-0 border-r border-white/[0.07]"
                    style={{ width: "var(--flux-sidebar-width, 15rem)", background: "oklch(from var(--color-base-200) calc(l - 0.01) c h / 0.6)" }}>
                    <nav className="p-3 space-y-0.5 flex-1 overflow-y-auto">
                        {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
                            const isActive = active === id;
                            return (
                                <button
                                    key={id}
                                    onClick={() => switchTab(id)}
                                    style={{ outline: "none", boxShadow: "none" }}
                                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-150 cursor-pointer group focus:outline-none ${
                                        isActive
                                            ? "bg-primary/15 text-white"
                                            : "text-white/55 hover:text-white hover:bg-white/[0.05]"
                                    }`}>
                                    <Icon
                                        size={15}
                                        className={`shrink-0 transition-colors ${
                                            isActive ? "text-primary" : "text-white/35 group-hover:text-white/70"
                                        }`}
                                    />
                                    <span className="text-sm font-medium flex-1">{label}</span>
                                    {isActive && (
                                        <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                                    )}
                                </button>
                            );
                        })}
                    </nav>
                    <div className="px-4 py-3 border-t border-white/[0.06]">
                        <p className="text-[11px] text-white/20 font-mono">Flux v0.1.0</p>
                    </div>
                </aside>

                {/* Mobile tab bar */}
                <div
                    className="sm:hidden fixed left-0 right-0 z-10"
                    style={{ top: "calc(var(--navbar-height, 56px) + 73px)" }}>
                    <div
                        className="flex overflow-x-auto bg-base-100/98 backdrop-blur-md border-b border-white/[0.07] px-2 py-2 gap-1"
                        style={{ scrollbarWidth: "none" }}>
                        {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
                            <button
                                key={id}
                                onClick={() => switchTab(id)}
                                style={{ outline: "none", boxShadow: "none" }}
                                className={`flex items-center gap-1.5 shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap focus:outline-none ${
                                    active === id
                                        ? "bg-primary text-white"
                                        : "text-white/50 hover:text-white hover:bg-white/[0.06]"
                                }`}>
                                <Icon size={13} />
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Content area */}
                <main className="flex-1 overflow-y-auto h-full">
                    {/* Section heading — desktop */}
                    <div className="hidden sm:flex items-center gap-3 px-8 py-5 border-b border-white/[0.05] bg-base-200/20 sticky top-0 z-10 backdrop-blur-sm">
                        {activeItem && (
                            <>
                                <activeItem.icon size={16} className="text-primary shrink-0" />
                                <span className="text-sm font-semibold text-white">{activeItem.label}</span>
                            </>
                        )}
                    </div>

                    <div
                        className="px-4 sm:px-8 py-6 mt-14 sm:mt-0 mx-auto"
                        style={{ maxWidth: "var(--flux-content-width, 720px)" }}>
                        {renderSection()}
                    </div>
                </main>
            </div>

            {/* Modals */}
            <AddFolderModal open={addFolderOpen} onClose={() => setAddFolderOpen(false)} onAdd={addLibraryFolder} />
        </div>
    );
}
