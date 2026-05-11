import { useState, useRef, useEffect } from "react";
import { NavLink } from "react-router";
import { Search, BarChart2, Bookmark, User, Users, Layers, ShieldCheck, Settings, List, Library, X } from "lucide-react";

const navLinks = [
    { to: "/live", label: "Live TV" },
    { to: "/movies", label: "Movies" },
    { to: "/series", label: "Series" },
    { to: "/library", label: "My Library" },
];

const profileMenuItems = [
    { icon: User, label: "Profile", to: "/profile" },
    { icon: Users, label: "Friends", to: "/friends" },
    { icon: Layers, label: "Services", to: "/services" },
    { icon: ShieldCheck, label: "Privacy Settings", to: "/privacy" },
    { icon: Settings, label: "Account Settings", to: "/settings" },
    { icon: List, label: "My Watchlist", to: "/watchlist" },
    { icon: Library, label: "My Media", to: "/media" },
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
        <nav className="w-full bg-[#1a1a1a] border-b border-white/5 px-6 h-14 flex items-center gap-4 relative z-50">
            {/* Logo */}
            <NavLink to="/" className="shrink-0 mr-2">
                <span className="text-primary font-black text-2xl tracking-tight select-none">
                    <span className="text-primary">PLAY</span>
                </span>
            </NavLink>

            {/* Search bar */}
            <div className={`flex items-center gap-2 bg-white/10 rounded-md px-3 h-9 transition-all duration-200 ${searchFocused ? "ring-1 ring-white/30 bg-white/15 w-80" : "w-64"}`}>
                <Search size={15} className="text-white/40 shrink-0" />
                <input
                    type="text"
                    placeholder="Search..."
                    onFocus={() => setSearchFocused(true)}
                    onBlur={() => setSearchFocused(false)}
                    className="bg-transparent outline-none text-sm text-white placeholder-white/30 w-full"
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

                {/* Profile button + floating menu */}
                <div className="relative ml-1" ref={menuRef}>
                    <button
                        onClick={() => setProfileOpen((prev) => !prev)}
                        className="w-8 h-8 rounded-full bg-primary flex items-center justify-center hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-primary/50"
                        aria-label="Open profile menu">
                        <User size={16} className="font-extrabold" />
                    </button>

                    {/* Floating profile dropdown */}
                    {profileOpen && (
                        <div className="absolute right-0 top-11 w-52 bg-[#252525] rounded-xl shadow-2xl border border-white/10 overflow-hidden">
                            <div className="flex items-center justify-between px-4 pt-3 pb-1">
                                <span className="text-[11px] font-semibold text-white/40 uppercase tracking-widest">Manage</span>
                                <button onClick={() => setProfileOpen(false)} className="text-white/40 hover:text-white transition-colors rounded p-0.5 hover:bg-white/10" aria-label="Close menu">
                                    <X size={14} />
                                </button>
                            </div>

                            <ul className="py-1.5">
                                {profileMenuItems.map(({ icon: Icon, label, to }) => (
                                    <li key={to}>
                                        <NavLink
                                            to={to}
                                            onClick={() => setProfileOpen(false)}
                                            className={({ isActive }) =>
                                                `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${isActive ? "text-[#e5a00d] bg-white/5" : "text-white/70 hover:text-white hover:bg-white/5"}`
                                            }>
                                            <Icon size={15} className="shrink-0 text-white/40" />
                                            {label}
                                        </NavLink>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            </div>
        </nav>
    );
};

export default Navbar;
