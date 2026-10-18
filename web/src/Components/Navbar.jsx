import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { NavLink, Link } from "react-router";
import { BarChart2, Bookmark, User, Users, Layers, ShieldCheck, FolderTree, Settings, List, Library, X, LogOut, LogIn, LayoutDashboard, LayoutGrid, Heart, Activity } from "lucide-react";
import Logo from "./Logo";
import Search from "./Search";
import Notifications from "./Notifications";
import { useAuth } from "../auth/AuthContext";
import { useAuthModal } from "../auth/AuthModalContext";
import { useApi } from "../Context/apiContext";

const profileMenuItems = [
    { icon: User, label: "Profile", to: "/settings?tab=profile" },
    { icon: Users, label: "Friends", to: "/friends" },
    { icon: List, label: "My Watchlist", to: "/watchlist" },
    { icon: Activity, label: "My Activity", to: "/my-activity" },
    { icon: Library, label: "My Media", to: "/my-media", adminOnly: true },
    { icon: FolderTree, label: "Folders", to: "/settings?tab=library", adminOnly: true },
    { icon: Layers, label: "Services", to: "/services" },
    { icon: ShieldCheck, label: "Privacy Settings", to: "/settings?tab=privacy" },
    { icon: Settings, label: "Settings", to: "/settings" },
];

// Shared keyboard focus indicator (single primary color, no border)
const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60";

// Dropdown / sidebar row — hover + focus-visible share the same look
const MENU_ITEM = [
    "flex items-center gap-3 mx-1 px-3 py-2 rounded-lg text-sm transition-colors duration-150",
    "text-[oklch(70%_0.01_260)] hover:text-white hover:bg-white/5 focus-visible:text-white focus-visible:bg-white/5",
    FOCUS_RING,
].join(" ");

// Shared icon-button box — same size/radius as the bell (now in <Notifications />) so the action row is uniform
const ICON_BTN = [
    "relative inline-flex shrink-0 items-center justify-center w-9 h-9 lg:w-8 lg:h-8 rounded-full lg:rounded-md",
    "active:scale-90 transition-colors duration-200 cursor-pointer",
    FOCUS_RING,
].join(" ");

// Idle fill shared by search pill, watchlist, bell, menu (below lg). lg+ goes back to ghost.
const ICON_FILL = "bg-white/[0.07] hover:bg-white/12 text-white/80 hover:text-white";

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
    if (user?.avatar) {
        return <img src={user.avatar} alt={user.name || "Profile"} className="w-8 h-8 rounded-full object-cover ring-2 ring-white/10" />;
    }
    const initial = user?.name?.[0]?.toUpperCase() ?? userInitial ?? "?";
    return <div className="w-8 h-8 rounded-full bg-primary/90 flex items-center justify-center text-primary-content font-semibold text-sm ring-2 ring-primary/30 select-none">{initial}</div>;
}

function navLinkClass({ isActive }) {
    return [
        "relative px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors duration-200",
        "after:absolute after:bottom-0 after:left-1/2 after:-translate-x-1/2",
        "after:h-[2px] after:rounded-full after:transition-all after:duration-200",
        "focus-visible:outline-none focus-visible:text-white focus-visible:after:w-4/5 focus-visible:after:bg-primary",
        isActive ? "text-white after:w-4/5 after:bg-primary" : "text-white/80 hover:text-white after:w-0",
    ].join(" ");
}

// Hamburger ⇄ cross morph. Bars slide to centre, then rotate (and back in reverse order).
// Dimensions match the old lucide <Menu size={19} strokeWidth={2} />: ~12.7px wide, 1.6px bars, 4.75px pitch.
const TOGGLE_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const BAR_W = 12.7;
const BAR_T = 1.6;
const BAR_GAP = 4.75; // centre-to-centre distance between bars
function MenuToggleIcon({ open }) {
    const move = (y) => ({
        transform: open ? `translateY(${y}px)` : "translateY(0px)",
        transition: `transform 300ms ${TOGGLE_EASE} ${open ? 0 : 150}ms`,
    });
    const spin = (deg) => ({
        height: BAR_T,
        transform: open ? `rotate(${deg}deg)` : "rotate(0deg)",
        transition: `transform 420ms cubic-bezier(0.34, 1.35, 0.64, 1) ${open ? 140 : 0}ms`,
    });
    const bar = "block w-full rounded-full bg-current";
    return (
        <span aria-hidden="true" className="relative block" style={{ width: BAR_W, height: BAR_GAP * 2 + BAR_T }}>
            <span className="absolute left-0 w-full" style={{ top: 0, ...move(BAR_GAP) }}>
                <span className={bar} style={spin(45)} />
            </span>
            <span className="absolute left-0 w-full" style={{ top: BAR_GAP }}>
                <span
                    className={bar}
                    style={{
                        height: BAR_T,
                        opacity: open ? 0 : 1,
                        transform: open ? "scaleX(0.2)" : "scaleX(1)",
                        transition: `opacity 200ms ease ${open ? 0 : 220}ms, transform 280ms ${TOGGLE_EASE} ${open ? 0 : 220}ms`,
                    }}
                />
            </span>
            <span className="absolute left-0 w-full" style={{ top: BAR_GAP * 2, ...move(-BAR_GAP) }}>
                <span className={bar} style={spin(-45)} />
            </span>
        </span>
    );
}

const Navbar = () => {
    const [profileOpen, setProfileOpen] = useState(false);
    const [browseOpen, setBrowseOpen] = useState(false);
    // lg+ => avatar + floating dropdown. Below lg => 3-line icon + sidebar.
    const [isDesktop, setIsDesktop] = useState(() => window.matchMedia(DESKTOP_QUERY).matches);
    // Lazy init + ref so state only changes when the threshold is crossed
    const [scrolled, setScrolled] = useState(() => window.scrollY > 8);
    const scrolledRef = useRef(scrolled);

    const menuRef = useRef(null); // desktop profile wrapper (avatar + dropdown)
    const profileBtnRef = useRef(null); // whichever trigger is rendered (avatar or 3-line icon)
    const sidebarRef = useRef(null);
    const sidebarCloseRef = useRef(null);
    const trapActiveRef = useRef(false); // true only while the sidebar focus trap should act
    const pendingFocusRef = useRef(null); // trigger ref to focus AFTER its panel has actually closed
    const browseWrapRef = useRef(null); // browse trigger + panel (display: contents wrapper)
    const browseBtnRef = useRef(null);
    const browsePanelRef = useRef(null);
    const [searchExpanded, setSearchExpanded] = useState(false); // phones: inline search is open → other icons hide

    // ── Spring-driven collapse of the action row (phones) ──────────────────────────
    // Real damped-spring physics on one CSS variable (--sp: 0 = row shown, 1 = row gone).
    // Row width = W·(1 − sp); when sp overshoots 1 the width goes negative → the search pill
    // stretches a little past its final width then settles (x axis only). GSAP-like, zero deps.
    const actRowRef = useRef(null);
    const closeSearchRef = useRef(null); // Search registers its close() here
    const [signedOutCloseOn, setSignedOutCloseOn] = useState(false); // lets the signed-out close icon morph in
    useEffect(() => {
        if (!searchExpanded) {
            setSignedOutCloseOn(false);
            return;
        }
        const id = requestAnimationFrame(() => setSignedOutCloseOn(true));
        return () => cancelAnimationFrame(id);
    }, [searchExpanded]);
    const springRef = useRef({ raf: 0, x: 0, v: 0, w: 0 });
    const springFirstRun = useRef(true);
    useEffect(() => {
        const row = actRowRef.current;
        if (!row) return;
        if (springFirstRun.current) {
            springFirstRun.current = false;
            return;
        }
        const st = springRef.current;
        cancelAnimationFrame(st.raf);
        const target = searchExpanded ? 1 : 0;
        const K = 300; // stiffness
        const C = 21; // damping  (ζ ≈ 0.6 → soft overshoot)
        const GAIN = 0.65; // visual overshoot multiplier (keeps pill off the menu button)

        const settle = () => {
            st.x = target;
            st.v = 0;
            row.style.removeProperty("--sp");
            if (target === 1) row.dataset.spring = "open";
            else delete row.dataset.spring;
        };
        const mobile = window.matchMedia("(max-width: 639px)").matches;
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        clearTimeout(st.revealTimer);
        delete row.dataset.reveal;
        if (!mobile || reduce) {
            settle();
            return;
        }
        if (target === 0) {
            row.dataset.reveal = "1"; // staggered icon entrance (CSS), cleared once finished
            st.revealTimer = setTimeout(() => delete row.dataset.reveal, 1800);
        }

        if (!row.dataset.spring) st.w = row.offsetWidth || st.w || 128; // measure natural width while row is visible
        row.style.setProperty("--w", `${st.w || 128}px`);
        row.dataset.spring = "run";

        const show = (x) => (x > 1 ? 1 + (x - 1) * GAIN : x < 0 ? 0 : x);
        row.style.setProperty("--sp", show(st.x).toFixed(4));

        let last = performance.now();
        const frame = (now) => {
            const dt = Math.min((now - last) / 1000, 0.032);
            last = now;
            const steps = Math.max(1, Math.ceil(dt / 0.004));
            const h = dt / steps;
            for (let i = 0; i < steps; i++) {
                const a = -K * (st.x - target) - C * st.v;
                st.v += a * h;
                st.x += st.v * h;
            }
            if (Math.abs(st.x - target) < 0.0008 && Math.abs(st.v) < 0.01) {
                settle();
                return;
            }
            row.style.setProperty("--sp", show(st.x).toFixed(4));
            st.raf = requestAnimationFrame(frame);
        };
        st.raf = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(st.raf);
    }, [searchExpanded]);

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

    // Single dismissal paths. restoreFocus=true for Escape / close button / backdrop: focus is NOT moved here
    // (the dialog is still mounted and its trap still active) — it is queued and applied by the effect below
    // once React has committed the close and the trap cleanup has run. After navigation / sign-out it stays
    // false so the destination page owns focus.
    const closeProfile = useCallback((restoreFocus = false) => {
        if (restoreFocus) pendingFocusRef.current = profileBtnRef;
        setProfileOpen(false);
    }, []);

    const closeBrowse = useCallback((restoreFocus = false) => {
        if (restoreFocus) pendingFocusRef.current = browseBtnRef;
        setBrowseOpen(false);
    }, []);

    // Runs after the commit that closed a panel (effect cleanups of that commit run first, so the focus
    // trap and focusin listener are already gone). Skips if the panel was reopened or the trigger is gone.
    useEffect(() => {
        const target = pendingFocusRef.current;
        if (!target) return;
        if ((target === profileBtnRef && profileOpen) || (target === browseBtnRef && browseOpen)) return;
        pendingFocusRef.current = null;
        const el = target.current;
        if (el && el.isConnected) el.focus();
    }, [profileOpen, browseOpen]);

    // Track the lg breakpoint
    useEffect(() => {
        const mq = window.matchMedia(DESKTOP_QUERY);
        const onChange = (e) => {
            setIsDesktop(e.matches);
            setProfileOpen(false);
            setBrowseOpen(false);
        };
        mq.addEventListener("change", onChange);
        return () => mq.removeEventListener("change", onChange);
    }, []);

    // Click outside: desktop dropdown + browse panel (sidebar closes via its overlay)
    useEffect(() => {
        function handleClickOutside(e) {
            const t = e.target;
            if (isDesktop && menuRef.current && !menuRef.current.contains(t)) setProfileOpen(false);
            if (!browseBtnRef.current?.contains(t) && !browsePanelRef.current?.contains(t)) setBrowseOpen(false);
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [isDesktop]);

    // One document-level key handler: Escape closes the open panel (focus returns to its trigger);
    // Tab/Shift+Tab are contained inside the sidebar dialog while it is open.
    useEffect(() => {
        if (!profileOpen && !browseOpen) return;
        function handleKeyDown(e) {
            if (e.key === "Tab" && profileOpen && !isDesktop && sidebarRef.current) {
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
            if (e.key !== "Escape") return;
            if (profileOpen) closeProfile(true);
            else if (browseOpen) closeBrowse(true);
        }
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [profileOpen, browseOpen, isDesktop, closeProfile, closeBrowse]);

    // Sidebar open (below lg): focus moves in, focus can't land behind the modal, page scroll is locked.
    // Previous body overflow is restored on close and on unmount.
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
        if (isAuthenticated) {
            setBrowseOpen(false);
            setProfileOpen((prev) => !prev);
        } else {
            setBrowseOpen(false);
            openAuthModal({ view: "login" });
        }
    }

    function handleBrowseButtonClick() {
        closeProfile();
        setBrowseOpen((prev) => !prev);
    }

    // Desktop dropdown: tabbing out of the profile area dismisses it
    function handleProfileBlur(e) {
        if (e.relatedTarget && menuRef.current && !menuRef.current.contains(e.relatedTarget)) setProfileOpen(false);
    }

    // Browse disclosure: focus moving to an element outside trigger+panel closes it (pointer clicks are handled
    // by the outside-mousedown listener and never steal focus)
    function handleBrowseBlur(e) {
        if (e.relatedTarget && browseWrapRef.current && !browseWrapRef.current.contains(e.relatedTarget)) setBrowseOpen(false);
    }

    function handleSearchOpenChange(open) {
        setSearchExpanded(open);
        if (open) setBrowseOpen(false);
    }

    function handleLogout() {
        closeProfile(); // sign-out: no focus restore, the page re-renders signed-out
        logout();
    }

    const displayName = user?.name || "Account";
    const displayInitial = displayName?.[0]?.toUpperCase() ?? "?";

    // Account panel body — identical content/design in the floating dropdown (lg+) and the sidebar (<lg)
    const renderAccountPanel = (closeRef, isSidebar = false) => (
        <div className={isSidebar ? "min-h-full flex flex-col" : ""}>
            <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
                <span className={`${isSidebar ? "text-xs" : "text-[10px]"} font-semibold uppercase tracking-widest text-[oklch(62%_0.015_260)]`}>Account</span>
                <button
                    ref={closeRef}
                    onClick={() => closeProfile(true)}
                    className={`${isSidebar ? "w-8 h-8" : "w-6 h-6"} flex items-center justify-center rounded-md transition-colors duration-150 cursor-pointer text-[oklch(62%_0.015_260)] hover:text-white focus-visible:text-white ${FOCUS_RING}`}
                    aria-label="Close menu">
                    <X size={isSidebar ? 18 : 14} strokeWidth={2.5} />
                </button>
            </div>

            <Link
                to="/settings?tab=profile"
                onClick={() => closeProfile()}
                className={`flex items-center gap-3 mx-2 mb-1 px-3 py-3 rounded-lg transition-colors duration-150 hover:bg-white/5 focus-visible:bg-white/5 ${FOCUS_RING}`}>
                <div className="shrink-0">
                    {user?.avatar ? (
                        <img src={user.avatar} alt={user.name} className="w-11 h-11 rounded-full object-cover ring-1 ring-white/10" />
                    ) : (
                        <div className="w-11 h-11 rounded-full flex items-center justify-center text-primary-content font-bold text-lg select-none" style={{ background: "oklch(58% 0.22 20 / 0.9)" }}>
                            {user?.name?.[0]?.toUpperCase() ?? displayInitial}
                        </div>
                    )}
                </div>
                <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate leading-snug">{user?.name}</p>
                    <p className="text-xs truncate text-[oklch(62%_0.015_260)]">{user?.email}</p>
                </div>
            </Link>

            <div className="mx-3 my-1 h-px" style={{ background: "oklch(100% 0 0 / 0.07)" }} />

            {/* Admin Dashboard link — admin only (presentation only; backend must enforce) */}
            {user?.role === "admin" && (
                <div className="px-2 py-1">
                    <Link
                        to="/dashboard"
                        onClick={() => closeProfile()}
                        className={`flex items-center gap-2.5 w-full px-3 py-2 border border-primary text-primary rounded-lg text-sm font-medium transition-colors duration-150 hover:bg-primary/15 focus-visible:bg-primary/15 ${FOCUS_RING}`}>
                        <LayoutDashboard size={14} className="shrink-0" />
                        Admin Dashboard
                    </Link>
                </div>
            )}

            <ul className="py-1">
                {profileMenuItems
                    .filter((item) => !item.adminOnly || isAdmin)
                    .map(({ icon: Icon, label, to }) => (
                        <li key={to}>
                            <Link to={to} onClick={() => closeProfile()} className={MENU_ITEM}>
                                <Icon size={15} strokeWidth={1.8} className="shrink-0 opacity-70" />
                                <span>{label}</span>
                            </Link>
                        </li>
                    ))}
            </ul>

            <div className={`mx-2 mb-2 ${isSidebar ? "mt-auto pt-3 pb-[max(0px,env(safe-area-inset-bottom))]" : "mt-1"}`}>
                <div className="h-px mb-2" style={{ background: "oklch(100% 0 0 / 0.07)" }} />
                <button
                    onClick={handleLogout}
                    className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer text-[oklch(62%_0.22_25)] border border-[oklch(62%_0.22_25/0.25)] hover:bg-[oklch(62%_0.22_25/0.12)] hover:border-[oklch(62%_0.22_25/0.5)] focus-visible:bg-[oklch(62%_0.22_25/0.12)] focus-visible:border-[oklch(62%_0.22_25/0.5)] ${FOCUS_RING}`}>
                    <LogOut size={14} strokeWidth={2} />
                    <span>Sign Out</span>
                </button>
            </div>
        </div>
    );

    return (
        <nav
            className="sticky top-0 z-50 w-full bg-base-200 transition-shadow duration-300"
            style={{
                borderBottom: "1px solid oklch(100% 0 0 / 0.06)",
                boxShadow: scrolled ? "0 8px 32px oklch(0% 0 0 / 0.5)" : "0 1px 24px oklch(0% 0 0 / 0.35)",
            }}>
            {/* Mobile: flex row. lg+: 3-column grid [left | center | right] — center column reserves its own width, no overlap */}
            <div className="relative w-full max-w-480 mx-auto px-3 sm:px-5 lg:px-6 xl:px-8 h-14 flex items-center gap-2 sm:gap-3 lg:grid lg:grid-cols-[1fr_auto_1fr] lg:gap-4">
                {/* Left cell: logo + desktop search */}
                <div className="flex items-center gap-2 sm:gap-6 sm:shrink-0 max-sm:flex-1 max-sm:min-w-0">
                    <div className="shrink-0">
                        <Logo />
                    </div>
                    <Search className="w-48 lg:w-[clamp(10rem,17vw,16rem)] shrink-0" hideMobileBtn inlineMobile closeMobileRef={closeSearchRef} onMobileOpenChange={handleSearchOpenChange} />
                </div>

                {/* Center cell: desktop nav links */}
                <div className="hidden lg:flex items-center gap-0.5 min-w-0">
                    {navLinks.map(({ to, label }) => (
                        <NavLink key={to} to={to} className={navLinkClass}>
                            {label}
                        </NavLink>
                    ))}
                </div>

                {/* Right cell */}
                <div className="flex items-center gap-1 ml-auto lg:ml-0 lg:justify-self-end shrink-0">
                    {/* My Media / Favourites — xl+ desktop */}
                    <NavLink
                        to={isAdmin ? "/my-media" : "/favourites"}
                        className={({ isActive }) =>
                            [
                                "hidden xl:flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md transition-colors duration-200",
                                FOCUS_RING,
                                isActive ? "text-white" : "text-white/80 hover:text-white",
                            ].join(" ")
                        }>
                        {isAdmin ? <BarChart2 size={15} /> : <Heart size={15} />}
                        <span>{isAdmin ? "My Media" : "Favourites"}</span>
                    </NavLink>

                    {/* Watchlist — desktop */}
                    <NavLink
                        to="/watchlist"
                        aria-label="Watchlist"
                        title="Watchlist"
                        className={({ isActive }) =>
                            [
                                "hidden lg:flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md transition-colors duration-200",
                                FOCUS_RING,
                                isActive ? "text-white" : "text-white/80 hover:text-white",
                            ].join(" ")
                        }>
                        <Bookmark size={15} />
                        <span className="hidden xl:inline">Watchlist</span>
                    </NavLink>

                    {/* Action row — browse, watchlist, bell: ghost icons, one shared size. Collapses on phones while search is open */}
                    <div
                        ref={actRowRef}
                        className={["nav-act flex items-center gap-1", "max-sm:overflow-hidden max-sm:px-0.5 max-sm:-mx-0.5 max-sm:py-0.5 max-sm:-my-0.5"].join(" ")}
                        aria-hidden={searchExpanded ? true : undefined}
                        inert={searchExpanded ? true : undefined}>
                        {/* Browse — below lg, all users; disclosure (focus stays on trigger, Tab enters the links) */}
                        <div className="contents" ref={browseWrapRef} onBlur={handleBrowseBlur}>
                            <button
                                ref={browseBtnRef}
                                onClick={handleBrowseButtonClick}
                                aria-label="Browse"
                                aria-expanded={browseOpen}
                                aria-controls={browseOpen ? "browse-menu" : undefined}
                                data-i="0"
                                className={["nav-act-item lg:hidden", ICON_BTN, browseOpen ? "bg-white/15 text-white" : ICON_FILL].join(" ")}>
                                <LayoutGrid size={17} strokeWidth={2} />
                            </button>
                            {/* Browse panel — disclosure: sits right after its trigger so Tab flows trigger → links; anchored under the header row */}
                            {browseOpen && (
                                <div
                                    id="browse-menu"
                                    ref={browsePanelRef}
                                    className="nav-anim lg:hidden absolute right-3 sm:right-5 top-full mt-1.5 w-56 rounded-xl overflow-hidden"
                                    style={{
                                        background: "oklch(15% 0.012 260 / 0.97)",
                                        backdropFilter: "blur(24px) saturate(160%)",
                                        border: "1px solid oklch(100% 0 0 / 0.08)",
                                        boxShadow: "0 12px 40px oklch(0% 0 0 / 0.6), 0 0 0 1px oklch(100% 0 0 / 0.04)",
                                        animation: "dropdownIn 0.18s ease-out",
                                    }}>
                                    <p className="text-[10px] font-semibold uppercase tracking-widest px-4 pt-3.5 pb-1.5 text-[oklch(62%_0.015_260)]">Browse</p>
                                    <ul className="pb-2 px-1">
                                        {navLinks.map(({ to, label }) => (
                                            <li key={to}>
                                                <NavLink
                                                    to={to}
                                                    onClick={() => closeBrowse()}
                                                    className={({ isActive }) =>
                                                        [
                                                            "flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150",
                                                            FOCUS_RING,
                                                            isActive ? "text-white bg-white/8" : "text-white/80 hover:text-white hover:bg-white/5 focus-visible:text-white focus-visible:bg-white/5",
                                                        ].join(" ")
                                                    }>
                                                    {label}
                                                </NavLink>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>

                        {/* Watchlist icon — mobile/tablet */}
                        <div className="nav-act-item tooltip tooltip-bottom lg:hidden shrink-0" data-tip="Watchlist" data-i="1">
                            <NavLink to="/watchlist" aria-label="Watchlist" className={({ isActive }) => [ICON_BTN, isActive ? "bg-primary/25 text-white" : ICON_FILL].join(" ")}>
                                {({ isActive }) => <Bookmark size={17} strokeWidth={2} fill={isActive ? "currentColor" : "none"} />}
                            </NavLink>
                        </div>

                        {/* Divider — tablet/desktop only */}
                        <div className="hidden lg:block w-px h-5 mx-1.5" style={{ background: "oklch(100% 0 0 / 0.1)" }} />

                        {/* Bell — same icon/button as before, now self-contained with dropdown panel */}
                        <Notifications />
                    </div>

                    {/* gap — tablet/desktop only */}
                    <div className="hidden lg:block w-3" />

                    {/* ── Signed out: Sign In (all sizes) ── */}
                    {!isAuthenticated && (
                        <button
                            onClick={handleProfileButtonClick}
                            className={`${searchExpanded ? "max-sm:hidden " : ""}ml-1 sm:ml-2 lg:ml-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full sm:rounded-lg text-sm font-medium bg-primary text-primary-content sm:bg-transparent sm:text-white/80 sm:hover:text-white sm:hover:bg-white/5 active:scale-95 transition-all duration-200 cursor-pointer ${FOCUS_RING}`}
                            aria-label="Sign in">
                            <LogIn size={15} />
                            <span className="hidden sm:inline">Sign In</span>
                        </button>
                    )}

                    {/* ── Signed out, phones, search open: morphing close icon ── */}
                    {!isAuthenticated && searchExpanded && (
                        <button
                            data-search-toggle=""
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => closeSearchRef.current?.()}
                            className={`sm:hidden ml-1 relative inline-flex items-center justify-center w-9 h-9 rounded-full ${ICON_FILL} active:scale-90 transition-colors duration-200 cursor-pointer ${FOCUS_RING}`}
                            aria-label="Close search">
                            <MenuToggleIcon open={signedOutCloseOn} />
                        </button>
                    )}

                    {/* ── Signed in, lg+: avatar + floating dropdown (as before) ── */}
                    {isAuthenticated && isDesktop && (
                        <div className="relative" ref={menuRef} onBlur={handleProfileBlur}>
                            <button
                                ref={profileBtnRef}
                                onClick={handleProfileButtonClick}
                                className={`flex items-center justify-center p-0.5 rounded-full hover:ring-2 hover:ring-primary/40 active:scale-95 transition-all duration-200 cursor-pointer ${FOCUS_RING}`}
                                aria-label="Open profile menu"
                                aria-expanded={profileOpen}
                                aria-controls={profileOpen ? "profile-menu" : undefined}>
                                <NavAvatar user={user} userInitial={displayInitial} />
                            </button>

                            {profileOpen && (
                                <div
                                    id="profile-menu"
                                    className="nav-anim absolute right-0 top-12 w-64 rounded-xl"
                                    style={{ ...PANEL_SURFACE, animation: "dropdownIn 0.18s ease-out", maxHeight: "calc(100dvh - 80px)" }}>
                                    {renderAccountPanel(null)}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── Signed in, below lg: 3-line icon (rounded bg) + sidebar ── */}
                    {isAuthenticated && !isDesktop && (
                        <button
                            ref={profileBtnRef}
                            data-search-toggle={searchExpanded ? "" : undefined}
                            onMouseDown={(e) => {
                                if (searchExpanded) e.preventDefault(); // don't let the input blur-collapse before click
                            }}
                            onClick={searchExpanded ? () => closeSearchRef.current?.() : handleProfileButtonClick}
                            className={`nav-menu-item ml-1 relative inline-flex items-center justify-center w-9 h-9 rounded-full active:scale-90 transition-colors duration-300 cursor-pointer ${FOCUS_RING} ${profileOpen && !searchExpanded ? "bg-white/15 text-white" : ICON_FILL}`}
                            aria-label={searchExpanded ? "Close search" : "Open menu"}
                            aria-haspopup={searchExpanded ? undefined : "dialog"}
                            aria-expanded={searchExpanded ? true : profileOpen}
                            aria-controls={!searchExpanded && profileOpen ? "account-sidebar" : undefined}>
                            <MenuToggleIcon open={searchExpanded} />
                        </button>
                    )}
                </div>
            </div>

            {/* Sidebar — portal so the navbar's backdrop-filter can't trap position:fixed */}
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
                            className="nav-anim fixed top-0 right-0 z-[61] h-dvh w-72 max-w-[85vw] rounded-l-xl focus:outline-none"
                            style={{ ...PANEL_SURFACE, animation: "sidebarIn 0.22s ease-out" }}>
                            {renderAccountPanel(sidebarCloseRef, true)}
                        </aside>
                    </>,
                    document.body,
                )}

            <style>{`
                @media (max-width: 639px) {
                    .nav-act[data-spring="run"] {
                        width: max(0px, calc(var(--w, 128px) * (1 - var(--sp, 0))));
                        margin-left: calc(-2px + min(0px, calc(var(--w, 128px) * (1 - var(--sp, 0)))));
                        opacity: clamp(0, calc(1 - var(--sp, 0) * 1.4), 1);
                        will-change: width, opacity;
                    }
                    /* Closing search: icons shoot out from behind the menu button one by one (browse → watchlist → bell).
                       Each one slams into the previous, which gets nudged and springs back — never overlapping. */
                    .nav-act[data-reveal] {
                        overflow: visible;
                    }
                    .nav-act[data-spring="run"][data-reveal] {
                        opacity: 1;
                    }
                    /* Arrival order (right → left): browse → watchlist → bell → menu. All start at the menu's spot and move LEFT. */
                    .nav-act[data-reveal] .nav-act-item[data-i="0"] {
                        animation: actClashBrowse 1270ms 160ms backwards, actFade 140ms 160ms backwards;
                    }
                    .nav-act[data-reveal] .nav-act-item[data-i="1"] {
                        animation: actClashWatch 1120ms 310ms backwards, actFade 140ms 310ms backwards;
                    }
                    .nav-act[data-reveal] .nav-act-item[data-i="2"] {
                        animation: actClashBell 970ms 460ms backwards, actFade 140ms 460ms backwards;
                    }
                    .nav-act[data-reveal] ~ .nav-menu-item {
                        animation: actClashMenu 1430ms, actMenuFade 1430ms;
                    }
                    .nav-act[data-spring="open"] {
                        width: 0;
                        opacity: 0;
                        pointer-events: none;
                    }
                }
                @media (prefers-reduced-motion: reduce) {
                    .nav-anim { animation: none !important; }
                }
                /* One-sided physics (Newton's cradle), right → left: every icon flies in moving LEFT and lands on its spot.
                   Each landing knocks the icons already placed 1.2px further LEFT (away from the hit).
                   Displacements only grow, never reverse, then all release back to rest together.
                   Nothing ever goes right of its resting place, and gaps only widen — no overlap. */
                @keyframes actClashBrowse { /* lands first, knocked 3× → 3.6px */
                    0%    { transform: translateX(128px); animation-timing-function: cubic-bezier(0.25, 0.8, 0.35, 1); }
                    23.6% { transform: translateX(0); }
                    35.4% { transform: translateX(0); animation-timing-function: cubic-bezier(0.2, 0.7, 0.3, 1); }
                    40.9% { transform: translateX(-1.2px); }
                    47.2% { transform: translateX(-1.2px); animation-timing-function: cubic-bezier(0.2, 0.7, 0.3, 1); }
                    52.8% { transform: translateX(-2.4px); }
                    59.1% { transform: translateX(-2.4px); animation-timing-function: cubic-bezier(0.2, 0.7, 0.3, 1); }
                    64.6% { transform: translateX(-3.6px); animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1); }
                    100%  { transform: translateX(0); }
                }
                @keyframes actClashWatch { /* lands (hits browse), knocked 2× → 2.4px */
                    0%    { transform: translateX(88px); animation-timing-function: cubic-bezier(0.25, 0.8, 0.35, 1); }
                    26.8% { transform: translateX(0); }
                    40.2% { transform: translateX(0); animation-timing-function: cubic-bezier(0.2, 0.7, 0.3, 1); }
                    46.4% { transform: translateX(-1.2px); }
                    53.6% { transform: translateX(-1.2px); animation-timing-function: cubic-bezier(0.2, 0.7, 0.3, 1); }
                    59.8% { transform: translateX(-2.4px); animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1); }
                    100%  { transform: translateX(0); }
                }
                @keyframes actClashBell { /* lands (hits watchlist), knocked once → 1.2px */
                    0%    { transform: translateX(48px); animation-timing-function: cubic-bezier(0.25, 0.8, 0.35, 1); }
                    30.9% { transform: translateX(0); }
                    46.4% { transform: translateX(0); animation-timing-function: cubic-bezier(0.2, 0.7, 0.3, 1); }
                    53.6% { transform: translateX(-1.2px); animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1); }
                    100%  { transform: translateX(0); }
                }
                @keyframes actClashMenu { /* last in: slides in from the right edge, hits bell, stays put */
                    0%    { transform: translateX(0); animation-timing-function: step-end; }
                    42.7% { transform: translateX(12px); animation-timing-function: cubic-bezier(0.25, 0.8, 0.35, 1); }
                    63.6% { transform: translateX(0); }
                    100%  { transform: translateX(0); }
                }
                @keyframes actMenuFade { /* cross fades out, hamburger fades in when it arrives */
                    0%    { opacity: 1; }
                    8%    { opacity: 0; }
                    42.7% { opacity: 0; }
                    52.5% { opacity: 1; }
                    100%  { opacity: 1; }
                }
                @keyframes actFade {
                    from { opacity: 0; }
                    to   { opacity: 1; }
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
