import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { NavLink, Link } from "react-router";
import {
    BarChart2,
    Bookmark,
    User,
    Users,
    Layers,
    ShieldCheck,
    FolderTree,
    Settings,
    List,
    Library,
    X,
    LogOut,
    LogIn,
    LayoutDashboard,
    ChevronRight,
    Heart,
    Activity,
    Radio,
    Film,
    Tv,
    Sparkles,
    Compass,
} from "lucide-react";
import Logo from "./Logo";
import Search from "../Media/Search";
import Notifications from "./Notifications";
import { useAuth } from "../../Auth/AuthContext";
import { useAuthModal } from "../../Auth/AuthModalContext";
import { useApi } from "../../Context/apiContext";

const profileMenuGroups = [
    {
        label: "Library",
        items: [
            { icon: List, label: "My Watchlist", to: "/watchlist" },
            { icon: Activity, label: "My Activity", to: "/my-activity" },
            { icon: Library, label: "My Media", to: "/my-media", adminOnly: true },
            { icon: FolderTree, label: "Folders", to: "/settings?tab=library", adminOnly: true },
        ],
    },
    {
        label: "Account",
        items: [
            { icon: User, label: "Profile", to: "/settings?tab=profile" },
            { icon: Users, label: "Friends", to: "/friends" },
            { icon: Layers, label: "Services", to: "/services" },
            { icon: ShieldCheck, label: "Privacy Settings", to: "/settings?tab=privacy" },
            { icon: Settings, label: "Settings", to: "/settings" },
        ],
    },
];

// Route icons for the sidebar's Browse grid (phones only — md+ shows the routes in the bar)
const ROUTE_ICONS = { "/live": Radio, "/movies": Film, "/series": Tv, "/anime": Sparkles, "/discover": Compass };

// Shared keyboard focus indicator (single primary color, no border)
const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60";

// Dropdown / sidebar row — hover + focus-visible share the same look
const MENU_ITEM = [
    "group flex items-center gap-3 mx-1.5 px-2 py-1.5 rounded-md text-sm transition-colors duration-150",
    "text-[oklch(70%_0.01_260)] hover:text-white hover:bg-white/5 focus-visible:text-white focus-visible:bg-white/5",
    FOCUS_RING,
].join(" ");

// Rounded-md icon box shared by every row
const ICON_BOX = "shrink-0 w-7 h-7 rounded-md flex items-center justify-center bg-white/[0.06] group-hover:bg-white/10 group-focus-visible:bg-white/10 transition-colors duration-150";
const ROW_CHEVRON = "shrink-0 ml-auto text-white/25 group-hover:text-white/60 group-focus-visible:text-white/60 transition-colors duration-150";
const GROUP_LABEL = "px-4 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-[oklch(62%_0.015_260)]";

// Active route / icon colour — lifted a little toward white so it keeps ≥4.5:1 on the dark bar in every theme
const ACTIVE_TEXT = "text-[color-mix(in_oklch,var(--color-primary)_78%,white)]";

// Ghost icon button — 40px touch target on phones, 36px from md up. Add `inline-flex` / `hidden lg:inline-flex` at the call site.
const ICON_BASE = ["relative shrink-0 items-center justify-center w-10 h-10 md:w-9 md:h-9 rounded-full", "active:scale-90 transition-colors duration-200 cursor-pointer", FOCUS_RING].join(" ");
const ICON_IDLE = "text-white/85 hover:text-white hover:bg-white/10";
const ICON_ON = `${ACTIVE_TEXT} bg-white/[0.07]`;

// Shared glass surface for the account panel (floating dropdown on lg+, sidebar below lg)
const PANEL_SURFACE = {
    background: "oklch(15% 0.012 260 / 0.97)",
    backdropFilter: "blur(24px) saturate(160%)",
    WebkitBackdropFilter: "blur(24px) saturate(160%)",
    border: "1px solid oklch(100% 0 0 / 0.08)",
    boxShadow: "0 12px 40px oklch(0% 0 0 / 0.6), 0 0 0 1px oklch(100% 0 0 / 0.04)",
    overflowY: "auto",
    overflowX: "hidden",
    overscrollBehavior: "contain",
    WebkitOverflowScrolling: "touch",
    touchAction: "pan-y",
    scrollbarWidth: "none",
    msOverflowStyle: "none",
};

const DESKTOP_QUERY = "(min-width: 1024px)"; // = Tailwind lg

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';
// Visible, enabled focus targets inside a container (re-queried on every Tab so content changes are handled)
function getFocusable(root) {
    return Array.from(root.querySelectorAll(FOCUSABLE)).filter((el) => el.getClientRects().length > 0 && !el.closest('[inert], [aria-hidden="true"]'));
}

function NavAvatar({ user, userInitial }) {
    const ring = "ring-2 ring-primary/50 ring-offset-2 ring-offset-base-100";
    if (user?.avatar) {
        return <img src={user.avatar} alt={user.name || "Profile"} className={`w-[30px] h-[30px] md:w-8 md:h-8 rounded-full object-cover ${ring}`} />;
    }
    const initial = user?.name?.[0]?.toUpperCase() ?? userInitial ?? "?";
    return <div className={`w-[30px] h-[30px] md:w-8 md:h-8 rounded-full bg-primary flex items-center justify-center text-primary-content font-semibold text-sm select-none ${ring}`}>{initial}</div>;
}

// Routes: centered, active = primary-tinted text + glowing 2px underline
function navLinkClass({ isActive }) {
    return [
        "relative inline-flex items-center h-10 px-2.5 lg:px-3.5 text-sm font-medium whitespace-nowrap transition-colors duration-200",
        "after:absolute after:bottom-0.5 after:left-1/2 after:-translate-x-1/2",
        "after:h-[2px] after:rounded-full after:transition-all after:duration-200",
        FOCUS_RING,
        "focus-visible:text-white",
        isActive ? `${ACTIVE_TEXT} font-semibold after:w-[calc(100%-1.25rem)] after:bg-primary after:shadow-[0_0_12px_var(--color-primary)]` : "text-white/80 hover:text-white after:w-0",
    ].join(" ");
}

const Navbar = () => {
    const [profileOpen, setProfileOpen] = useState(false);
    // lg+ => floating account dropdown. Below lg => sidebar. (Same avatar trigger for both.)
    const [isDesktop, setIsDesktop] = useState(() => window.matchMedia(DESKTOP_QUERY).matches);
    // Lazy init + ref so state only changes when the threshold is crossed
    const [scrolled, setScrolled] = useState(() => window.scrollY > 8);
    const scrolledRef = useRef(scrolled);

    const menuRef = useRef(null); // avatar + desktop dropdown wrapper
    const profileBtnRef = useRef(null);
    const sidebarRef = useRef(null);
    const sidebarCloseRef = useRef(null);
    const trapActiveRef = useRef(false); // true only while the sidebar focus trap should act
    const pendingFocusRef = useRef(null); // trigger ref to focus AFTER its panel has actually closed

    const { user, isAuthenticated, logout } = useAuth();
    const { openAuthModal } = useAuthModal();
    const { movies, series, anime } = useApi();
    const isAdmin = user?.role === "admin";

    const navLinks = useMemo(() => {
        const links = [{ to: "/live", label: "Live TV" }];
        if (movies?.length > 0) links.push({ to: "/movies", label: "Movies" });
        if (series?.length > 0) links.push({ to: "/series", label: "Series" });
        if (anime?.length > 0) links.push({ to: "/anime", label: "Anime" });
        links.push({ to: "/discover", label: "Discover" }); // everyone (admin + normal users)
        return links;
    }, [movies, series, anime]);

    // Single dismissal path. restoreFocus=true for Escape / close button / backdrop: focus is queued and applied
    // by the effect below once React has committed the close and the trap cleanup has run. After navigation /
    // sign-out it stays false so the destination page owns focus.
    const closeProfile = useCallback((restoreFocus = false) => {
        if (restoreFocus) pendingFocusRef.current = profileBtnRef;
        setProfileOpen(false);
    }, []);

    useEffect(() => {
        const target = pendingFocusRef.current;
        if (!target) return;
        if (target === profileBtnRef && profileOpen) return;
        pendingFocusRef.current = null;
        const el = target.current;
        if (el && el.isConnected) el.focus();
    }, [profileOpen]);

    // Track the lg breakpoint
    useEffect(() => {
        const mq = window.matchMedia(DESKTOP_QUERY);
        const onChange = (e) => {
            setIsDesktop(e.matches);
            setProfileOpen(false);
        };
        mq.addEventListener("change", onChange);
        return () => mq.removeEventListener("change", onChange);
    }, []);

    // Click outside: desktop dropdown (sidebar closes via its overlay)
    useEffect(() => {
        function handleClickOutside(e) {
            if (isDesktop && menuRef.current && !menuRef.current.contains(e.target)) setProfileOpen(false);
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [isDesktop]);

    // Escape closes the open panel (focus returns to the avatar); Tab/Shift+Tab are contained inside the sidebar dialog.
    useEffect(() => {
        if (!profileOpen) return;
        function handleKeyDown(e) {
            if (e.key === "Tab" && !isDesktop && sidebarRef.current) {
                const root = sidebarRef.current;
                const f = getFocusable(root);
                if (!f.length) {
                    e.preventDefault();
                    root.focus();
                    return;
                }
                const first = f[0];
                const last = f[f.length - 1];
                const active = document.activeElement;
                if (!root.contains(active)) {
                    e.preventDefault();
                    (e.shiftKey ? last : first).focus();
                } else if (e.shiftKey && active === first) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && active === last) {
                    e.preventDefault();
                    first.focus();
                }
                return;
            }
            if (e.key === "Escape") closeProfile(true);
        }
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [profileOpen, isDesktop, closeProfile]);

    // Sidebar open (below lg): focus moves in, focus can't land behind the modal, page scroll is locked.
    useEffect(() => {
        if (!profileOpen || isDesktop) return;
        const focusDialog = () => (sidebarCloseRef.current ?? sidebarRef.current)?.focus();
        trapActiveRef.current = true;
        focusDialog();
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        function onFocusIn(e) {
            if (trapActiveRef.current && sidebarRef.current && !sidebarRef.current.contains(e.target)) focusDialog();
        }
        document.addEventListener("focusin", onFocusIn);
        return () => {
            trapActiveRef.current = false;
            document.removeEventListener("focusin", onFocusIn);
            document.body.style.overflow = prev;
        };
    }, [profileOpen, isDesktop]);

    // Scroll-aware bar: only touches React state when the 8px threshold flips
    useEffect(() => {
        function onScroll() {
            const next = window.scrollY > 8;
            if (next === scrolledRef.current) return;
            scrolledRef.current = next;
            setScrolled(next);
        }
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => window.removeEventListener("scroll", onScroll);
    }, []);

    function handleProfileButtonClick() {
        if (isAuthenticated) setProfileOpen((prev) => !prev);
        else openAuthModal({ view: "login" });
    }

    // Desktop dropdown: tabbing out of the profile area dismisses it
    function handleProfileBlur(e) {
        if (isDesktop && e.relatedTarget && menuRef.current && !menuRef.current.contains(e.relatedTarget)) setProfileOpen(false);
    }

    function handleLogout() {
        closeProfile(); // sign-out: no focus restore, the page re-renders signed-out
        logout();
    }

    const displayName = user?.name || "Account";
    const displayInitial = displayName?.[0]?.toUpperCase() ?? "?";

    // Account panel body — identical content/design in the floating dropdown (lg+) and the sidebar (<lg). Unchanged.
    const renderAccountPanel = (closeRef, isSidebar = false) => (
        <div className={isSidebar ? "flex flex-col h-full min-h-0" : ""}>
            <div className="flex items-center justify-between px-4 pt-3.5 pb-2 shrink-0">
                <span className={`${isSidebar ? "text-xs" : "text-[10px]"} font-semibold uppercase tracking-widest text-[oklch(62%_0.015_260)]`}>{isSidebar ? "Menu" : "Account"}</span>
                <button
                    ref={closeRef}
                    onClick={() => closeProfile(true)}
                    className={`${isSidebar ? "w-8 h-8" : "w-6 h-6"} flex items-center justify-center rounded-md bg-white/[0.06] transition-colors duration-150 cursor-pointer text-[oklch(62%_0.015_260)] hover:text-white hover:bg-white/10 focus-visible:text-white focus-visible:bg-white/10 ${FOCUS_RING}`}
                    aria-label="Close menu">
                    <X size={isSidebar ? 18 : 14} strokeWidth={2.5} />
                </button>
            </div>

            {/* Sidebar: this block scrolls, header above and Sign Out below stay pinned */}
            <div className={isSidebar ? "flex-1 min-h-0 overflow-y-auto overscroll-contain" : ""} style={isSidebar ? { scrollbarWidth: "none" } : undefined}>
                <Link
                    to="/settings?tab=profile"
                    onClick={() => closeProfile()}
                    className={`group flex items-center gap-3 mx-2 mb-1 px-3 py-3 rounded-md bg-white/[0.04] border border-white/[0.07] transition-colors duration-150 hover:bg-white/[0.08] focus-visible:bg-white/[0.08] ${FOCUS_RING}`}>
                    <div className="shrink-0">
                        {user?.avatar ? (
                            <img src={user.avatar} alt={user.name} className="w-11 h-11 rounded-full object-cover ring-1 ring-white/10" />
                        ) : (
                            <div
                                className="w-11 h-11 rounded-full flex items-center justify-center text-primary-content font-bold text-lg select-none ring-2 ring-white/10"
                                style={{ background: "linear-gradient(145deg, color-mix(in oklch, var(--color-primary) 85%, white), color-mix(in oklch, var(--color-primary) 75%, black))" }}>
                                {user?.name?.[0]?.toUpperCase() ?? displayInitial}
                            </div>
                        )}
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-white truncate leading-snug">{user?.name}</p>
                        <p className="text-xs truncate text-[oklch(62%_0.015_260)]">{user?.email}</p>
                    </div>
                    <ChevronRight size={16} className={ROW_CHEVRON} />
                </Link>

                {/* Admin Dashboard link — admin only (presentation only; backend must enforce) */}
                {user?.role === "admin" && (
                    <div className="px-2 py-1">
                        <Link
                            to="/dashboard"
                            onClick={() => closeProfile()}
                            className={`group flex items-center gap-3 w-full px-3 py-2.5 rounded-md text-white border border-primary/40 bg-gradient-to-br from-primary/30 to-primary/10 transition-all duration-150 hover:from-primary/40 hover:to-primary/20 focus-visible:from-primary/40 focus-visible:to-primary/20 ${FOCUS_RING}`}>
                            <span className="shrink-0 w-8 h-8 rounded-md flex items-center justify-center bg-primary text-primary-content">
                                <LayoutDashboard size={16} />
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block text-sm font-semibold leading-snug">Admin Dashboard</span>
                                <span className="block text-xs text-white/60 truncate">Libraries, users, streams</span>
                            </span>
                            <ChevronRight size={16} className="shrink-0 text-white/50" />
                        </Link>
                    </div>
                )}

                {/* Browse routes — sidebar only, below md (the bar has no route links there). Same rows as every other group. */}
                {isSidebar && (
                    <div className="md:hidden">
                        <p className={GROUP_LABEL}>Browse</p>
                        <ul className="pb-1">
                            {navLinks.map(({ to, label }) => {
                                const RouteIcon = ROUTE_ICONS[to] ?? Compass;
                                return (
                                    <li key={to}>
                                        <NavLink
                                            to={to}
                                            onClick={() => closeProfile()}
                                            className={({ isActive }) =>
                                                [
                                                    "group flex items-center gap-3 mx-1.5 px-2 py-1.5 rounded-md text-sm transition-colors duration-150",
                                                    FOCUS_RING,
                                                    isActive
                                                        ? `${ACTIVE_TEXT} font-semibold bg-primary/15`
                                                        : "text-[oklch(70%_0.01_260)] hover:text-white hover:bg-white/5 focus-visible:text-white focus-visible:bg-white/5",
                                                ].join(" ")
                                            }>
                                            {({ isActive }) => (
                                                <>
                                                    <span className={`${ICON_BOX} ${isActive ? "!bg-primary/20" : ""}`}>
                                                        <RouteIcon size={15} strokeWidth={1.8} />
                                                    </span>
                                                    <span>{label}</span>
                                                    {isActive ? (
                                                        <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" aria-hidden="true" />
                                                    ) : (
                                                        <ChevronRight size={15} className={ROW_CHEVRON} />
                                                    )}
                                                </>
                                            )}
                                        </NavLink>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                )}

                {profileMenuGroups.map((group) => {
                    const items = group.items.filter((item) => !item.adminOnly || isAdmin);
                    if (!items.length) return null;
                    return (
                        <div key={group.label}>
                            <p className={GROUP_LABEL}>{group.label}</p>
                            <ul className="pb-1">
                                {items.map(({ icon: Icon, label, to, adminOnly }) => (
                                    <li key={to}>
                                        <Link to={to} onClick={() => closeProfile()} className={MENU_ITEM}>
                                            <span className={ICON_BOX}>
                                                <Icon size={15} strokeWidth={1.8} />
                                            </span>
                                            <span>{label}</span>
                                            {adminOnly && (
                                                <span className="ml-1 px-1.5 py-0.5 rounded-sm text-[9px] font-bold uppercase tracking-wider bg-primary/15 border border-primary/35 text-[color-mix(in_oklch,var(--color-primary)_78%,white)]">
                                                    Admin
                                                </span>
                                            )}
                                            <ChevronRight size={15} className={ROW_CHEVRON} />
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    );
                })}
            </div>
            {isSidebar && <div aria-hidden="true" className="h-4 -mt-4 shrink-0 pointer-events-none relative bg-gradient-to-t from-[oklch(18.5%_0.014_265)] to-transparent" />}

            <div className={`mx-2 mb-2 shrink-0 ${isSidebar ? "pt-3 pb-[max(0px,env(safe-area-inset-bottom))]" : "mt-1"}`}>
                <div className="h-px mb-2" style={{ background: "oklch(100% 0 0 / 0.07)" }} />
                <button
                    onClick={handleLogout}
                    className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all duration-150 cursor-pointer text-[oklch(62%_0.22_25)] border border-[oklch(62%_0.22_25/0.25)] hover:bg-[oklch(62%_0.22_25/0.12)] hover:border-[oklch(62%_0.22_25/0.5)] focus-visible:bg-[oklch(62%_0.22_25/0.12)] focus-visible:border-[oklch(62%_0.22_25/0.5)] ${FOCUS_RING}`}>
                    <LogOut size={14} strokeWidth={2} />
                    <span>Sign Out</span>
                </button>
            </div>
        </div>
    );

    return (
        <nav className="sticky top-0 z-50 w-full">
            {/* Surface layer. Base-100 fading gradient at the top of the page, translucent blurred glass once scrolled.
                Kept as a child (not on <nav>) so backdrop-filter never becomes the containing block for fixed descendants. */}
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 -z-10 transition-[background-color,border-color,box-shadow] duration-300"
                style={{
                    background: scrolled ? "color-mix(in oklch, var(--color-base-100) 82%, transparent)" : "color-mix(in oklch, var(--color-base-100) 100%, transparent)",
                    backdropFilter: "blur(20px) saturate(150%)",
                    WebkitBackdropFilter: "blur(20px) saturate(150%)",
                    borderBottom: "1px solid oklch(100% 0 0 / " + (scrolled ? "0.08" : "0") + ")",
                    boxShadow: "0 8px 32px oklch(0% 0 0 / " + (scrolled ? "0.5" : "0") + ")",
                }}
            />

            {/* Full-bleed. Phones: [logo | actions]. md+: [logo | routes centered | actions] */}
            <div className="relative w-full h-15 md:h-16 px-4 md:px-5 lg:px-6 xl:px-8 grid grid-cols-[1fr_auto] md:grid-cols-[1fr_auto_1fr] items-center gap-3 lg:gap-4">
                {/* Left: logo */}
                <div className="flex items-center min-w-0">
                    <Logo />
                </div>

                {/* Center: routes (tablet + desktop). Phones have none here by design. */}
                <div className="hidden md:flex items-center justify-center min-w-0">
                    {navLinks.map(({ to, label }) => (
                        <NavLink key={to} to={to} className={navLinkClass}>
                            {label}
                        </NavLink>
                    ))}
                </div>

                {/* Right: actions. md only = one glass capsule; lg+ = open row */}
                <div className="flex items-center gap-0.5 md:gap-1 justify-self-end md:h-12 md:px-1 md:rounded-full md:bg-white/[0.07] md:border md:border-white/[0.09] lg:h-auto lg:px-0 lg:rounded-none lg:bg-transparent lg:border-transparent">
                    {/* Search — pill with "/" hint on lg at top of page, icon otherwise */}
                    <Search compact={scrolled} />

                    {/* My Media / Favourites — lg+ */}
                    <NavLink
                        to={isAdmin ? "/my-media" : "/favourites"}
                        aria-label={isAdmin ? "My Media" : "Favourites"}
                        title={isAdmin ? "My Media" : "Favourites"}
                        className={({ isActive }) => ["hidden lg:inline-flex", ICON_BASE, isActive ? ICON_ON : ICON_IDLE].join(" ")}>
                        {({ isActive }) => (isAdmin ? <BarChart2 size={18} strokeWidth={1.8} /> : <Heart size={18} strokeWidth={1.8} fill={isActive ? "currentColor" : "none"} />)}
                    </NavLink>

                    {/* Watchlist — all sizes */}
                    <NavLink to="/watchlist" aria-label="Watchlist" title="Watchlist" className={({ isActive }) => ["inline-flex", ICON_BASE, isActive ? ICON_ON : ICON_IDLE].join(" ")}>
                        {({ isActive }) => <Bookmark size={18} strokeWidth={1.8} fill={isActive ? "currentColor" : "none"} />}
                    </NavLink>

                    {/* Bell — self-contained (badge + dropdown panel live in <Notifications />) */}
                    <Notifications />

                    {/* Divider — phones + lg+ (inside the md capsule it would be noise) */}
                    <span aria-hidden="true" className="hidden max-md:block lg:block w-px h-[22px] mx-1.5" style={{ background: "oklch(100% 0 0 / 0.12)" }} />

                    {/* Signed out: Sign In */}
                    {!isAuthenticated && (
                        <button
                            onClick={handleProfileButtonClick}
                            className={`ml-1 flex items-center gap-1.5 px-3 h-9 rounded-full text-sm font-medium bg-primary text-primary-content active:scale-95 transition-all duration-200 cursor-pointer ${FOCUS_RING}`}
                            aria-label="Sign in">
                            <LogIn size={15} />
                            <span className="hidden sm:inline">Sign In</span>
                        </button>
                    )}

                    {/* Signed in: avatar. lg+ → floating dropdown, below lg → sidebar (both unchanged) */}
                    {isAuthenticated && (
                        <div className="relative" ref={menuRef} onBlur={handleProfileBlur}>
                            <button
                                ref={profileBtnRef}
                                onClick={handleProfileButtonClick}
                                className={`inline-flex items-center justify-center w-10 h-10 md:w-9 md:h-9 rounded-full active:scale-95 transition-transform duration-200 cursor-pointer ${FOCUS_RING}`}
                                aria-label={isDesktop ? "Open profile menu" : "Open menu"}
                                aria-haspopup="dialog"
                                aria-expanded={profileOpen}
                                aria-controls={profileOpen ? (isDesktop ? "profile-menu" : "account-sidebar") : undefined}>
                                <NavAvatar user={user} userInitial={displayInitial} />
                            </button>

                            {isDesktop && profileOpen && (
                                <div
                                    id="profile-menu"
                                    className="nav-anim absolute right-0 top-12 w-64 rounded-md"
                                    style={{ ...PANEL_SURFACE, animation: "dropdownIn 0.18s ease-out", maxHeight: "calc(100dvh - 80px)" }}>
                                    {renderAccountPanel(null)}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Sidebar — portal so the navbar can never trap position:fixed */}
            {isAuthenticated &&
                !isDesktop &&
                profileOpen &&
                createPortal(
                    <>
                        <div className="nav-anim fixed inset-0 z-[60] bg-black/50" style={{ animation: "overlayIn 0.2s ease-out" }} onClick={() => closeProfile(true)} aria-hidden="true" />
                        <aside
                            id="account-sidebar"
                            ref={sidebarRef}
                            role="dialog"
                            aria-modal="true"
                            aria-label="Account menu"
                            tabIndex={-1}
                            className="nav-anim fixed top-0 right-0 z-[61] h-dvh w-72 max-w-[85vw] rounded-l-md focus:outline-none"
                            style={{ ...PANEL_SURFACE, overflowY: "hidden", animation: "sidebarIn 0.22s ease-out" }}>
                            {renderAccountPanel(sidebarCloseRef, true)}
                        </aside>
                    </>,
                    document.body,
                )}

            <style>{`
                @media (prefers-reduced-motion: reduce) {
                    .nav-anim { animation: none !important; }
                }
                @keyframes sidebarIn {
                    from { transform: translateX(100%); }
                    to   { transform: translateX(0); }
                }
                @keyframes overlayIn {
                    from { opacity: 0; }
                    to   { opacity: 1; }
                }
                @keyframes dropdownIn {
                    from { opacity: 0; transform: translateY(-6px) scale(0.97); }
                    to   { opacity: 1; transform: translateY(0) scale(1); }
                }
            `}</style>
        </nav>
    );
};

export default Navbar;
