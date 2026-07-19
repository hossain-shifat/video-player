import { useState, useEffect, useRef, useMemo } from "react";
import { useSearchParams } from "react-router";
import { User, Palette, Database, Play, Captions, Server, Info, ShieldCheck } from "lucide-react";
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

const NAV = [
    { id: "profile", label: "Profile", icon: User, desc: "Account & identity" },
    { id: "appearance", label: "Appearance", icon: Palette, desc: "Themes & typography" },
    { id: "library", label: "Library", icon: Database, desc: "Media folders", adminOnly: true },
    { id: "playback", label: "Playback", icon: Play, desc: "Player behaviour" },
    { id: "subtitles", label: "Subtitles", icon: Captions, desc: "Caption settings" },
    { id: "server", label: "Server", icon: Server, desc: "Connection & streaming" },
    { id: "privacy", label: "Privacy", icon: ShieldCheck, desc: "Data & visibility" },
    { id: "about", label: "About", icon: Info, desc: "App info & reset" },
];

export default function Settings() {
    const { theme, setTheme, themes } = useTheme();
    const { folders, addLibraryFolder, removeLibraryFolder, updateLibraryFolder, refreshAll, loading } = useApi();
    const { user, logout } = useAuth();
    const { openAuthModal } = useAuthModal();
    const isAdmin = user?.role === "admin";

    const NAV_ITEMS = useMemo(() => NAV.filter((n) => !n.adminOnly || isAdmin), [isAdmin]);
    const IDS = useMemo(() => NAV_ITEMS.map((n) => n.id), [NAV_ITEMS]);

    const [searchParams, setSearchParams] = useSearchParams();
    const initial = IDS.includes(searchParams.get("tab")) ? searchParams.get("tab") : "profile";
    const [active, setActive] = useState(initial);
    const contentRef = useRef(null);

    const go = (id) => {
        setActive(id);
        setSearchParams({ tab: id }, { replace: true });
        contentRef.current?.scrollTo({ top: 0 });
    };

    useEffect(() => {
        const t = searchParams.get("tab");
        if (t && IDS.includes(t) && t !== active) setActive(t);
        else if (t === "library" && !isAdmin) go("profile");
    }, [searchParams, isAdmin]); // eslint-disable-line

    const [addFolderOpen, setAddFolderOpen] = useState(false);

    const [prefs, setPrefsState] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem("flux-prefs") || "{}");
        } catch {
            return {};
        }
    });
    const setPref = (key, val) =>
        setPrefsState((p) => {
            const next = { ...p, [key]: val };
            try {
                localStorage.setItem("flux-prefs", JSON.stringify(next));
            } catch {}
            return next;
        });

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
                    />
                ) : null;
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
    })();

    return (
        <div className="-m-4 sm:-m-6 lg:-m-8 flex flex-col w-full">
            {/* ── Mobile tab strip ── */}
            <div className="sm:hidden shrink-0 border-b border-white/[0.10]" style={{ background: "rgba(10,10,14,0.97)", backdropFilter: "blur(16px)" }}>
                <div className="flex overflow-x-auto px-3 py-2.5 gap-1" style={{ scrollbarWidth: "none" }}>
                    {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
                        <button
                            key={id}
                            onClick={() => go(id)}
                            style={{ outline: "none", boxShadow: "none" }}
                            className={`flex items-center gap-1.5 shrink-0 px-3 py-1.5 text-[11px] font-semibold whitespace-nowrap transition-all focus:outline-none
                                ${active === id ? "rounded-md bg-primary/20 text-primary border border-primary/30" : "rounded-lg text-white/85 hover:text-white border border-transparent hover:bg-white/[0.08]"}`}>
                            <Icon size={11} strokeWidth={active === id ? 2.5 : 2} />
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            {/* ── Desktop body ── */}
            <div className="flex flex-1 min-h-0">
                {/* Sidebar with labels */}
                <aside className="hidden sm:flex flex-col shrink-0 border-r border-white/[0.10]" style={{ width: "200px", background: "rgba(0,0,0,0.22)" }}>
                    <nav className="flex flex-col py-3 px-2.5 gap-0.5 flex-1">
                        {NAV_ITEMS.map(({ id, icon: Icon, label }) => {
                            const on = active === id;
                            return (
                                <button
                                    key={id}
                                    onClick={() => go(id)}
                                    style={{ outline: "none", boxShadow: "none" }}
                                    className={`relative flex items-center gap-3 px-3 py-2.5 w-full text-left transition-all cursor-pointer focus:outline-none
                                        ${on ? "rounded-md bg-primary/18 text-primary" : "rounded-xl text-white/80 hover:text-white hover:bg-white/[0.08]"}`}>
                                    {on && <span className="absolute left-0 top-0 bottom-0 w-0.5 rounded-r bg-primary" />}
                                    <Icon size={15} strokeWidth={on ? 2.2 : 1.8} className="shrink-0" />
                                    <span className="text-[13px] font-medium">{label}</span>
                                </button>
                            );
                        })}
                    </nav>
                    <div className="px-4 py-3 border-t border-white/[0.08] shrink-0">
                        <p className="text-[10px] text-white/60 font-mono">Flux v0.1.0</p>
                    </div>
                </aside>

                {/* Section panel */}
                <div className="flex-1 flex flex-col min-h-0 min-w-0">
                    {/* Section header — desktop only */}
                    <div className="hidden sm:flex items-center gap-4 px-7 py-4 border-b border-white/[0.09] shrink-0" style={{ background: "rgba(0,0,0,0.12)" }}>
                        {activeNav && (
                            <>
                                <div
                                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                                    style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
                                    <activeNav.icon size={15} className="text-primary" />
                                </div>
                                <div>
                                    <h2 className="text-[14px] font-semibold text-white leading-tight">{activeNav.label}</h2>
                                    <p className="text-[11px] text-white/70 leading-none mt-0.5">{activeNav.desc}</p>
                                </div>
                            </>
                        )}
                    </div>

                    {/* Content — no scroll */}
                    <main ref={contentRef} className="flex-1 min-h-0 w-full">
                        <div className="px-5 sm:px-7 py-6 w-full">{section}</div>
                    </main>
                </div>
            </div>

            {isAdmin && <AddFolderModal open={addFolderOpen} onClose={() => setAddFolderOpen(false)} onAdd={addLibraryFolder} />}
        </div>
    );
}
