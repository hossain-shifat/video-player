import { useState, useRef, useEffect } from "react";
import { NavLink, Link } from "react-router";
import { BarChart2, Bookmark, User, Users, Layers, ShieldCheck, FolderTree, Settings, List, Library, X, LogOut, LogIn, Bell, LayoutDashboard } from "lucide-react";
import Logo from "./Logo";
import Search from "./Search";
import { useAuth } from "../auth/AuthContext";
import { useAuthModal } from "../auth/AuthModalContext";

const navLinks = [
    { to: "/live", label: "Live TV" },
    { to: "/movies", label: "Movies" },
    { to: "/series", label: "Series" },
    { to: "/library", label: "My Library" },
];

const profileMenuItems = [
    { icon: User, label: "Profile", to: "/settings?tab=profile" },
    { icon: Users, label: "Friends", to: "/friends" },
    { icon: List, label: "My Watchlist", to: "/watchlist" },
    { icon: Library, label: "My Media", to: "/my-media" },
    { icon: FolderTree, label: "Folders", to: "/settings?tab=library" },
    { icon: Layers, label: "Services", to: "/services" },
    { icon: ShieldCheck, label: "Privacy Settings", to: "/settings?tab=privacy" },
    { icon: Settings, label: "Settings", to: "/settings" },
];

function NavAvatar({ user, userInitial }) {
    if (user?.avatar) {
        return <img src={user.avatar} alt={user.name || "Profile"} className="w-8 h-8 rounded-full object-cover ring-2 ring-white/10" />;
    }
    const initial = user?.name?.[0]?.toUpperCase() ?? userInitial ?? "?";
    return <div className="w-8 h-8 rounded-full bg-primary/90 flex items-center justify-center text-primary-content font-semibold text-sm ring-2 ring-primary/30 select-none">{initial}</div>;
}

function navLinkClass({ isActive }) {
    return [
        "relative px-3 py-1.5 text-sm font-medium transition-colors duration-200",
        "after:absolute after:bottom-0 after:left-1/2 after:-translate-x-1/2",
        "after:h-[2px] after:rounded-full after:transition-all after:duration-200",
        isActive ? "text-white after:w-4/5 after:bg-primary" : "text-white/80 hover:text-white after:w-0",
    ].join(" ");
}

const Navbar = () => {
    const [profileOpen, setProfileOpen] = useState(false);
    const menuRef = useRef(null);

    const { user, isAuthenticated, logout } = useAuth();
    const { openAuthModal } = useAuthModal();

    useEffect(() => {
        function handleClickOutside(e) {
            if (menuRef.current && !menuRef.current.contains(e.target)) setProfileOpen(false);
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    function handleProfileButtonClick() {
        if (isAuthenticated) setProfileOpen((prev) => !prev);
        else openAuthModal({ view: "login" });
    }

    function handleLogout() {
        setProfileOpen(false);
        logout();
    }

    const displayName = user?.name || "Account";
    const displayInitial = displayName?.[0]?.toUpperCase() ?? "?";
    const notifCount = 3;

    return (
        <nav
            className="sticky top-0 z-50 w-full bg-base-300"
            style={{
                backdropFilter: "blur(16px) saturate(160%)",
                WebkitBackdropFilter: "blur(16px) saturate(160%)",
                borderBottom: "1px solid oklch(100% 0 0 / 0.06)",
                boxShadow: "0 1px 24px oklch(0% 0 0 / 0.35)",
            }}>
            <div className="relative w-full max-w-480 mx-auto px-3 sm:px-5 lg:px-8 h-14 flex items-center gap-3">
                {/* Logo */}
                <div className="shrink-0">
                    <Logo />
                </div>

                {/* Search — handles desktop & mobile internally */}
                <Search className="flex-1 max-w-xs lg:max-w-sm xl:max-w-md" />

                {/* Center nav links — desktop only */}
                <div className="hidden lg:flex items-center gap-0.5 absolute left-1/2 -translate-x-1/2">
                    {navLinks.map(({ to, label }) => (
                        <NavLink key={to} to={to} className={navLinkClass}>
                            {label}
                        </NavLink>
                    ))}
                </div>

                {/* Right side */}
                <div className="flex items-center gap-1 ml-auto">
                    {/* My Media — xl+ desktop */}
                    <NavLink
                        to="/my-media"
                        className={({ isActive }) =>
                            [
                                "hidden xl:flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md transition-colors duration-200",
                                isActive ? "text-white" : "text-white/80 hover:text-white",
                            ].join(" ")
                        }>
                        <BarChart2 size={15} />
                        <span>My Media</span>
                    </NavLink>

                    {/* Watchlist — desktop */}
                    <NavLink
                        to="/watchlist"
                        className={({ isActive }) =>
                            [
                                "hidden lg:flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md transition-colors duration-200",
                                isActive ? "text-white" : "text-white/80 hover:text-white",
                            ].join(" ")
                        }>
                        <Bookmark size={15} />
                        <span>Watchlist</span>
                    </NavLink>



                    {/* Watchlist icon — mobile/tablet */}
                    <div className="tooltip tooltip-bottom lg:hidden" data-tip="Watchlist">
                        <NavLink
                            to="/watchlist"
                            aria-label="Watchlist"
                            className={({ isActive }) =>
                                ["inline-flex items-center justify-center p-2 rounded-md transition-colors duration-200", isActive ? "text-white" : "text-white/80 hover:text-white"].join(" ")
                            }>
                            <Bookmark size={20} />
                        </NavLink>
                    </div>

                    {/* Divider */}
                    <div className="w-px h-5 mx-1.5" style={{ background: "oklch(100% 0 0 / 0.1)" }} />

                    {/* Bell — FIXED badge */}
                    <button
                        className="relative inline-flex items-center justify-center w-8 h-8 rounded-md text-white/75 hover:text-white hover:bg-white/5 transition-all duration-200"
                        aria-label="Notifications"
                        style={{ outline: "none" }}>
                        <Bell size={18} strokeWidth={1.8} />
                        {notifCount > 0 && (
                            <span
                                className="absolute -top-0.5 -right-0.5 flex items-center justify-center rounded-full text-[9px] font-bold text-white px-1"
                                style={{ background: "oklch(58% 0.22 20)", lineHeight: 1, minWidth: "16px", height: "16px" }}>
                                {notifCount > 9 ? "9+" : notifCount}
                            </span>
                        )}
                    </button>

                    {/* gap — FIXED wider */}
                    <div className="w-3" />

                    {/* Profile */}
                    <div className="relative" ref={menuRef}>
                        {isAuthenticated ? (
                            <button
                                onClick={handleProfileButtonClick}
                                className="flex items-center justify-center p-0.5 rounded-full hover:ring-2 hover:ring-primary/40 transition-all duration-200 cursor-pointer"
                                aria-label="Open profile menu"
                                style={{ outline: "none" }}>
                                <NavAvatar user={user} userInitial={displayInitial} />
                            </button>
                        ) : (
                            <button
                                onClick={handleProfileButtonClick}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white/80 hover:text-white hover:bg-white/5 transition-all duration-200 cursor-pointer"
                                aria-label="Sign in"
                                style={{ outline: "none" }}>
                                <LogIn size={15} />
                                <span className="hidden sm:inline">Sign In</span>
                            </button>
                        )}

                        {/* Profile dropdown — FIXED scrollable, no scrollbar */}
                        {profileOpen && isAuthenticated && (
                            <div
                                className="absolute right-0 top-12 w-64 rounded-xl overflow-hidden"
                                style={{
                                    background: "oklch(15% 0.012 260 / 0.97)",
                                    backdropFilter: "blur(24px) saturate(160%)",
                                    border: "1px solid oklch(100% 0 0 / 0.08)",
                                    boxShadow: "0 12px 40px oklch(0% 0 0 / 0.6), 0 0 0 1px oklch(100% 0 0 / 0.04)",
                                    animation: "dropdownIn 0.18s ease-out",
                                    maxHeight: "calc(100vh - 80px)",
                                    overflowY: "auto",
                                    scrollbarWidth: "none",
                                    msOverflowStyle: "none",
                                }}>
                                <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
                                    <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "oklch(50% 0.015 260)" }}>
                                        Account
                                    </span>
                                    <button
                                        onClick={() => setProfileOpen(false)}
                                        className="w-6 h-6 flex items-center justify-center rounded-md transition-colors duration-150 cursor-pointer"
                                        style={{ color: "oklch(50% 0.015 260)", outline: "none" }}
                                        onMouseEnter={(e) => (e.currentTarget.style.color = "white")}
                                        onMouseLeave={(e) => (e.currentTarget.style.color = "oklch(50% 0.015 260)")}
                                        aria-label="Close menu">
                                        <X size={14} strokeWidth={2.5} />
                                    </button>
                                </div>

                                <Link
                                    to="/settings?tab=profile"
                                    onClick={() => setProfileOpen(false)}
                                    className="flex items-center gap-3 mx-2 mb-1 px-3 py-3 rounded-lg transition-colors duration-150"
                                    style={{ outline: "none" }}
                                    onMouseEnter={(e) => (e.currentTarget.style.background = "oklch(100% 0 0 / 0.05)")}
                                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                                    <div className="shrink-0">
                                        {user?.avatar ? (
                                            <img src={user.avatar} alt={user.name} className="w-11 h-11 rounded-full object-cover ring-1 ring-white/10" />
                                        ) : (
                                            <div
                                                className="w-11 h-11 rounded-full flex items-center justify-center text-primary-content font-bold text-lg select-none"
                                                style={{ background: "oklch(58% 0.22 20 / 0.9)" }}>
                                                {user?.name?.[0]?.toUpperCase() ?? displayInitial}
                                            </div>
                                        )}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-sm font-semibold text-white truncate leading-snug">{user?.name}</p>
                                        <p className="text-xs truncate" style={{ color: "oklch(50% 0.015 260)" }}>
                                            {user?.email}
                                        </p>
                                    </div>
                                </Link>

                                <div className="mx-3 my-1 h-px" style={{ background: "oklch(100% 0 0 / 0.07)" }} />

                                {/* Admin Dashboard link — admin only */}
                                {user?.role === "admin" && (
                                    <div className="px-2 py-1">
                                        <Link
                                            to="/dashboard"
                                            onClick={() => setProfileOpen(false)}
                                            className="flex items-center gap-2.5 w-full px-3 py-2 border border-primary text-primary rounded-lg text-sm font-medium transition-colors duration-150"
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.background = "oklch(60% 0.18 280 / 0.18)";
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.background = "oklch(60% 0.18 280 / 0.1)";
                                            }}>
                                            <LayoutDashboard size={14} className="shrink-0" />
                                            Admin Dashboard
                                        </Link>
                                    </div>
                                )}

                                {/* Nav links — mobile/tablet only */}
                                <div className="lg:hidden px-2 pt-1 pb-0.5">
                                    <p className="text-[10px] font-semibold uppercase tracking-widest px-2 mb-1" style={{ color: "oklch(50% 0.015 260)" }}>
                                        Browse
                                    </p>
                                    <div className="grid grid-cols-1 gap-1">
                                        {navLinks.map(({ to, label }) => (
                                            <NavLink
                                                key={to}
                                                to={to}
                                                onClick={() => setProfileOpen(false)}
                                                className={({ isActive }) =>
                                                    [
                                                        "flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-150",
                                                        isActive ? "text-white bg-white/8" : "text-white/80 hover:text-white hover:bg-white/5",
                                                    ].join(" ")
                                                }
                                                style={{ outline: "none" }}>
                                                {label}
                                            </NavLink>
                                        ))}
                                    </div>
                                </div>

                                <div className="lg:hidden mx-3 mt-1 mb-0 h-px" style={{ background: "oklch(100% 0 0 / 0.07)" }} />

                                <ul className="py-1">
                                    {profileMenuItems.map(({ icon: Icon, label, to }) => (
                                        <li key={to}>
                                            <Link
                                                to={to}
                                                onClick={() => setProfileOpen(false)}
                                                className="flex items-center gap-3 mx-1 px-3 py-2 rounded-lg text-sm transition-colors duration-150"
                                                style={{ color: "oklch(70% 0.01 260)", outline: "none" }}
                                                onMouseEnter={(e) => {
                                                    e.currentTarget.style.color = "white";
                                                    e.currentTarget.style.background = "oklch(100% 0 0 / 0.05)";
                                                }}
                                                onMouseLeave={(e) => {
                                                    e.currentTarget.style.color = "oklch(70% 0.01 260)";
                                                    e.currentTarget.style.background = "transparent";
                                                }}>
                                                <Icon size={15} strokeWidth={1.8} className="shrink-0 opacity-70" />
                                                <span>{label}</span>
                                            </Link>
                                        </li>
                                    ))}
                                </ul>

                                <div className="mx-2 mb-2 mt-1">
                                    <div className="h-px mb-2" style={{ background: "oklch(100% 0 0 / 0.07)" }} />
                                    <button
                                        onClick={handleLogout}
                                        className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer"
                                        style={{ color: "oklch(62% 0.22 25)", outline: "none", border: "1px solid oklch(62% 0.22 25 / 0.25)" }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.background = "oklch(62% 0.22 25 / 0.12)";
                                            e.currentTarget.style.borderColor = "oklch(62% 0.22 25 / 0.5)";
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.background = "transparent";
                                            e.currentTarget.style.borderColor = "oklch(62% 0.22 25 / 0.25)";
                                        }}>
                                        <LogOut size={14} strokeWidth={2} />
                                        <span>Sign Out</span>
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            <style>{`
                @keyframes dropdownIn {
                    from { opacity: 0; transform: translateY(-6px) scale(0.97); }
                    to   { opacity: 1; transform: translateY(0) scale(1); }
                }
            `}</style>
        </nav>
    );
};

export default Navbar;
