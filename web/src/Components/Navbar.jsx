import { useState, useRef, useEffect } from "react";
import { NavLink, Link } from "react-router";
import { BarChart2, Bookmark, User, Users, Layers, ShieldCheck, FolderTree, Settings, List, Library, X, LogOut } from "lucide-react";
import Logo from "./Logo";
import Search from "./Search";

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
        <nav className="sticky top-0 w-full bg-base-300 px-4 md:px-6 h-14 flex items-center gap-4 z-999999999999">
            {/* Logo */}
            <Logo />

            {/* Search bar */}
            <div className="">
                <Search />
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
                    to="/my-media"
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

                <div className="tooltip tooltip-bottom" data-tip="Watchlist">
                    <NavLink
                        to="/watchlist"
                        aria-label="Watchlist"
                        className={({ isActive }) =>
                            `lg:hidden inline-flex items-center justify-center p-2 rounded transition-colors ${isActive ? "text-white bg-none" : "text-white/70 hover:text-white hover:bg-white/5"}`
                        }>
                        <Bookmark size={25} />
                    </NavLink>
                </div>

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
                        <div className="absolute right-0 top-14 w-62 bg-base-100 rounded-xl shadow-2xl border border-white/10 overflow-hidden space-y-2">
                            <div className="flex items-center justify-end px-4 pt-3 pb-1">
                                {/* <span className="text-[11px] font-semibold text-white/40 uppercase tracking-widest">Manage</span> */}
                                <div className="tooltip tooltip-bottom" data-tip="Close">
                                    <button onClick={() => setProfileOpen(false)} className="text-white/40 hover:text-white transition-colors rounded p-0.5 cursor-pointer" aria-label="Close menu">
                                        <X size={20} strokeWidth={3} color="white" />
                                    </button>
                                </div>
                            </div>

                            {/* Profile inside floating menu */}
                            <Link to="/settings?tab=profile" onClick={() => setProfileOpen(false)}>
                                <div className="flex flex-col justify-center items-center gap-4">
                                    <h1 className="bg-primary w-20 h-20 flex justify-center items-center rounded-full">
                                        <User size={50} />
                                    </h1>
                                    <div className="text-center">
                                        <h1 className="text-primary font-semibold">Shifat-Hossain</h1>
                                        <p className="text-white/70">hossain222</p>
                                    </div>
                                </div>
                            </Link>
                            {/* profile floating navigations */}
                            <div>
                                <ul className="py-2">
                                    {profileMenuItems.map(({ icon: Icon, label, to }) => (
                                        <li key={to}>
                                            <Link to={to} onClick={() => setProfileOpen(false)} className="flex items-center gap-3 px-4 py-2.5 text-md md:text-sm transition-colors hover:bg-white/5">
                                                <Icon size={20} strokeWidth={2} className="shrink-0 text-base-content" />
                                                <span className="text-base-content">{label}</span>
                                            </Link>
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
