import { useState, useRef, useEffect } from "react";
import { NavLink } from "react-router";
import { Search, BarChart2, Bookmark, User, Users, Layers, ShieldCheck, FolderTree, Settings, List, Library, X, LogOut } from "lucide-react";
import Logo from "./Logo";
import ThemeDropdown from "./ThemeDropdown";

const navLinks = [
    { to: "/live", label: "Live TV" },
    { to: "/movies", label: "Movies" },
    { to: "/series", label: "Series" },
    { to: "/library", label: "My Library" },
];

const profileMenuItems = [
    { icon: User, label: "Profile", to: "/profile" },
    { icon: Users, label: "Friends", to: "/friends" },
    { icon: List, label: "My Watchlist", to: "/watchlist" },
    { icon: Library, label: "My Media", to: "/media" },
    { icon: FolderTree, label: "Folders", to: "/folders" },
    { icon: Layers, label: "Services", to: "/services" },
    { icon: ShieldCheck, label: "Privacy Settings", to: "/privacy" },
    { icon: Settings, label: "Settings", to: "/settings" },
];

const Navbar = () => {
    const [profileOpen, setProfileOpen] = useState(false);
    const [searchFocused, setSearchFocused] = useState(false);
    const menuRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) {
                setProfileOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    return (
        <nav className="w-full bg-[#1a1a1a] border-b border-white/5 px-2 md:px-6 h-14 flex items-center gap-4 relative z-50">
            {/* Logo */}
            <Logo />

            {/* Search bar */}
            <div className={`flex items-center gap-2 bg-white/10 rounded-md px-3 h-9 transition-all duration-200 ${searchFocused ? "ring-1 ring-white/30 bg-white/15 w-80" : "w-64"}`}>
                <Search size={20} className="text-white/40 shrink-0" />
                <input
                    type="text"
                    placeholder="Search..."
                    onFocus={() => setSearchFocused(true)}
                    onBlur={() => setSearchFocused(false)}
                    className="bg-transparent outline-none text-sm text-white placeholder-white/30 placeholder:text-md w-full"
                />
            </div>

            {/* Center nav links */}
            <div className="hidden lg:flex items-center gap-1 flex-1 justify-center">
                {navLinks.map(({ to, label }) => (
                    <NavLink
                        key={to}
                        to={to}
                        className={({ isActive }) =>
                            `px-4 py-1.5 rounded text-sm font-medium transition-colors duration-150 ${isActive ? "text-white bg-white/10" : "text-white/60 hover:text-white hover:bg-white/5"}`
                        }>
                        {label}
                    </NavLink>
                ))}
            </div>

            {/* Right side */}
            <div className="flex items-center gap-1 ml-auto">
                {/* my media */}
                <NavLink
                    to="/media"
                    className={({ isActive }) =>
                        `hidden lg:flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded transition-colors ${isActive ? "text-white bg-white/10" : "text-white/60 hover:text-white hover:bg-white/5"}`
                    }>
                    <BarChart2 size={16} />
                    <span>My Media</span>
                </NavLink>

                {/* Watchlist */}
                <NavLink
                    to="/watchlist"
                    className={({ isActive }) =>
                        `hidden lg:flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded transition-colors ${isActive ? "text-white bg-white/10" : "text-white/60 hover:text-white hover:bg-white/5"}`
                    }>
                    <Bookmark size={16} />
                    <span>Watchlist</span>
                </NavLink>

                <NavLink to="/watchlist">
                    <Bookmark size={25} />
                </NavLink>

                {/* Profile button + floating menu */}
                <div className="relative ml-1" ref={menuRef}>
                    <button
                        onClick={() => setProfileOpen((prev) => !prev)}
                        className="w-8.5 h-8.5 rounded-full bg-primary flex items-center justify-center hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-primary/50 cursor-pointer"
                        aria-label="Open profile menu">
                        <User size={20} strokeWidth={2} />
                    </button>

                    {/* Floating profile dropdown */}
                    {profileOpen && (
                        <div className="absolute right-1 top-14 w-52 bg-[#252525] rounded-xl shadow-2xl border border-white/10 overflow-hidden space-y-2">
                            <div className="flex items-center justify-end px-4 pt-3 pb-1">
                                {/* <span className="text-[11px] font-semibold text-white/40 uppercase tracking-widest">Manage</span> */}
                                <button
                                    onClick={() => setProfileOpen(false)}
                                    className="text-white/40 hover:text-white transition-colors rounded p-0.5 hover:bg-white/10 cursor-pointer"
                                    aria-label="Close menu">
                                    <X size={20} strokeWidth={3} color="white" />
                                </button>
                            </div>

                            {/* Profile inside floating menu */}
                            <NavLink to="/profile">
                                <div className="flex flex-col justify-center items-center gap-4">
                                    <h1 className="bg-primary w-20 h-20 flex justify-center items-center rounded-full">
                                        <User size={50} />
                                    </h1>
                                    <h1>Shifat-Hossain</h1>
                                </div>
                            </NavLink>
                            {/* profile floating navigations */}
                            <div>
                                <ul className="py-1.5">
                                    {profileMenuItems.map(({ icon: Icon, label, to }) => (
                                        <li key={to}>
                                            <NavLink
                                                to={to}
                                                onClick={() => setProfileOpen(false)}
                                                className={({ isActive }) =>
                                                    `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${isActive ? "text-[#e5a00d] bg-white/5" : "text-white/70 hover:text-white hover:bg-white/5"}`
                                                }>
                                                <Icon size={15} strokeWidth={3} className="shrink-0 text-white/40" />
                                                {label}
                                            </NavLink>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                            <div className="border-t border-error">
                                <button className="btn btn-error btn-wide btn-outline hover:bg-none border-0 w-full rounded-none">
                                    <p className="text-md">Logout</p> <LogOut size={16} strokeWidth={3} />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </nav>
    );
};

export default Navbar;
