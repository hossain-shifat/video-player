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
    { id: "profile", label: "Profile", icon: User },
    { id: "appearance", label: "Appearance", icon: Palette },
    { id: "library", label: "Media Library", icon: Database },
    { id: "playback", label: "Playback", icon: Play },
    { id: "subtitles", label: "Subtitles", icon: Captions },
    { id: "server", label: "Server", icon: Server },
    { id: "privacy", label: "Privacy", icon: ShieldCheck },
    { id: "about", label: "About", icon: Info },
];

const VALID_TABS = NAV_ITEMS.map((n) => n.id);

export default function Settings() {
    const { theme, setTheme, themes } = useTheme();
    const { folders, addLibraryFolder, removeLibraryFolder, refreshAll, loading } = useApi();

    // ── URL-driven tab: /settings?tab=library opens library section ──────────
    const [searchParams, setSearchParams] = useSearchParams();
    const tabParam = searchParams.get("tab");
    const initialTab = VALID_TABS.includes(tabParam) ? tabParam : "profile";

    const [active, setActive] = useState(initialTab);

    // Sync if URL param changes (e.g. browser back/forward or NavLink)
    useEffect(() => {
        const t = searchParams.get("tab");
        if (t && VALID_TABS.includes(t) && t !== active) setActive(t);
    }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

    const switchTab = (id) => {
        setActive(id);
        setSearchParams({ tab: id }, { replace: true });
    };

    // ── Modals ────────────────────────────────────────────────────────────────
    const [addFolderOpen, setAddFolderOpen] = useState(false);

    // ── Auth (from real AuthContext) ──────────────────────────────────────────
    const { user, logout } = useAuth();
    const { openAuthModal } = useAuthModal();
    const [editingName, setEditingName] = useState(false);
    const [draftName, setDraftName] = useState(user?.name ?? "");

    // Sync draftName when user changes
    useEffect(() => {
        setDraftName(user?.name ?? "");
    }, [user?.name]);

    const handleLogout = () => {
        logout();
    };

    // Name editing is local-only for now (profile update API can be added later)
    const saveName = () => {
        // TODO: call PATCH /api/profile when profile edit API is wired
        setEditingName(false);
    };

    // ── Prefs ─────────────────────────────────────────────────────────────────
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

    // ── Section renderer ──────────────────────────────────────────────────────
    const renderSection = () => {
        switch (active) {
            case "profile":
                return <ProfileSection handleLogout={handleLogout} setLoginOpen={() => openAuthModal({ view: "login" })} />;
            case "appearance":
                return <AppearanceSection theme={theme} setTheme={setTheme} themes={themes} />;
            case "library":
                return <LibrarySection folders={folders} removeLibraryFolder={removeLibraryFolder} setAddFolderOpen={setAddFolderOpen} refreshAll={refreshAll} loading={loading} />;
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

    return (
        <div className="-m-4 sm:-m-6 lg:-m-8 min-h-screen flex flex-col">
            {/* ── Header ── */}
            <div className="px-4 sm:px-6 py-4 border-b border-white/5 bg-base-200/30 shrink-0">
                <h1 className="text-xl sm:text-2xl font-bold text-white">Settings</h1>
                <p className="text-xs text-white/40 mt-0.5">Manage your Flux preferences</p>
            </div>

            {/* ── Body ── */}
            <div className="flex flex-1 min-h-0 overflow-hidden">
                {/* Sidebar — desktop */}
                <aside className="hidden sm:flex flex-col shrink-0 border-r border-white/5 bg-base-200/20" style={{ width: "var(--flux-sidebar-width, 14rem)" }}>
                    <nav className="p-2 space-y-0.5 flex-1">
                        {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
                            const isActive = active === id;
                            return (
                                <button
                                    key={id}
                                    onClick={() => switchTab(id)}
                                    style={{ outline: "none", boxShadow: "none" }}
                                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all duration-150 cursor-pointer group focus:outline-none focus-visible:outline-none ${
                                        isActive ? "bg-primary/15 text-primary" : "text-white/60 hover:text-white hover:bg-white/0.04"
                                    }`}>
                                    <Icon size={15} className={isActive ? "text-primary" : "text-white/35 group-hover:text-white/70 transition-colors"} />
                                    <span className="text-sm font-medium flex-1">{label}</span>
                                    {isActive && <ChevronRight size={12} className="text-primary/40" />}
                                </button>
                            );
                        })}
                    </nav>
                    <div className="p-3 border-t border-white/5">
                        <p className="text-xs text-white/20">Flux v0.1.0 · Personal</p>
                    </div>
                </aside>

                {/* Mobile tab bar */}
                <div className="sm:hidden absolute left-0 right-0 z-10" style={{ top: "calc(var(--navbar-height, 56px) + 73px)" }}>
                    <div className="flex overflow-x-auto bg-base-100/95 backdrop-blur-sm border-b border-white/5 px-2 py-1.5 gap-1" style={{ scrollbarWidth: "none" }}>
                        {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
                            <button
                                key={id}
                                onClick={() => switchTab(id)}
                                style={{ outline: "none", boxShadow: "none" }}
                                className={`flex items-center gap-1.5 shrink-0 px-3 py-1.5 rounded text-xs font-medium transition-colors whitespace-nowrap focus:outline-none focus-visible:outline-none ${
                                    active === id ? "bg-primary text-primary-content" : "text-white/50 hover:text-white hover:bg-base-300"
                                }`}>
                                <Icon size={13} />
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Content */}
                <main className="flex-1 overflow-y-auto h-full">
                    <div className="w-full h-full px-4 sm:px-8 lg:px-12 py-8 mt-12 sm:mt-0 mx-auto" style={{ maxWidth: "var(--flux-content-width, 100%)" }}>
                        {renderSection()}
                    </div>
                </main>
            </div>

            {/* Modals */}
            <AddFolderModal open={addFolderOpen} onClose={() => setAddFolderOpen(false)} onAdd={addLibraryFolder} />
            {/* Auth is handled globally via AuthModal — no local LoginModal needed */}
        </div>
    );
}
