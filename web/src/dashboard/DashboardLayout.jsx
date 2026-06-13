// web/src/dashboard/DashboardLayout.jsx
// Admin shell — inherits global theme/CSS, NO dashboard.css

import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router";
import { LayoutDashboard, Users, HardDrive, Activity, Settings, LogOut, ChevronLeft, ChevronRight, Radio, ScrollText, Cpu, Menu, X, Server, Shield, Upload, FileVideo } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import Logo from "../Components/Logo";

const NAV = [
    {
        title: "Overview",
        items: [{ to: "/dashboard", icon: LayoutDashboard, label: "Overview", end: true }],
    },
    {
        title: "Manage",
        items: [
            { to: "/dashboard/users", icon: Users, label: "Users" },
            { to: "/dashboard/media", icon: FileVideo, label: "Media" },
            { to: "/dashboard/libraries", icon: HardDrive, label: "Libraries" },
            { to: "/dashboard/streams", icon: Radio, label: "Live Streams" },
            { to: "/dashboard/jobs", icon: Activity, label: "Jobs" },
            { to: "/dashboard/uploads", icon: Upload, label: "Uploads" },
        ],
    },
    {
        title: "System",
        items: [
            { to: "/dashboard/health", icon: Cpu, label: "System Health" },
            { to: "/dashboard/logs", icon: ScrollText, label: "Logs" },
        ],
    },
];

function NavItem({ item, collapsed, onClick }) {
    return (
        <NavLink
            to={item.to}
            end={item.end}
            onClick={onClick}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) =>
                [
                    "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium",
                    "transition-all duration-150 group select-none border",
                    isActive ? "bg-primary/15 text-primary border-primary/20" : "text-base-content/50 hover:text-base-content hover:bg-base-content/5 border-transparent",
                ].join(" ")
            }>
            <item.icon size={17} className="shrink-0 transition-transform duration-150 group-hover:scale-110" />
            {!collapsed && <span className="truncate">{item.label}</span>}
        </NavLink>
    );
}

function Sidebar({ collapsed, onNav, user, logout }) {
    const initial = (user?.name || user?.email || "A")[0].toUpperCase();
    return (
        <div className="flex flex-col min-h-screen overflow-hidden ">
            {/* Logo */}
            <div className={["flex items-center gap-2 px-4 py-4 border-b border-base-content/5 shrink-0", collapsed ? "justify-center" : ""].join(" ")}>
                {collapsed ? (
                    <div className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center text-primary font-black text-sm">F</div>
                ) : (
                    <div className="flex items-center gap-2 w-full min-w-0">
                        <Logo />
                        <span className="ml-auto text-[9px] font-bold uppercase tracking-widest text-base-content/25 bg-base-content/5 px-1.5 py-0.5 rounded whitespace-nowrap shrink-0">Admin</span>
                    </div>
                )}
            </div>

            {/* Nav sections */}
            <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-3">
                {NAV.map((section) => (
                    <div key={section.title}>
                        {!collapsed && <p className="text-[10px] font-bold uppercase tracking-widest text-base-content/25 px-3 mb-1">{section.title}</p>}
                        <div className="space-y-0.5">
                            {section.items.map((item) => (
                                <NavItem key={item.to} item={item} collapsed={collapsed} onClick={onNav} />
                            ))}
                        </div>
                    </div>
                ))}
                <div className="border-t border-base-content/5 pt-3 space-y-0.5">
                    <NavItem item={{ to: "/settings", icon: Settings, label: "Settings" }} collapsed={collapsed} onClick={onNav} />
                    <NavItem item={{ to: "/", icon: Server, label: "Back to FLUX" }} collapsed={collapsed} onClick={onNav} />
                </div>
            </nav>

            {/* User footer */}
            <div className="shrink-0 border-t border-base-content/5 p-2">
                <div className={["flex items-center gap-2.5 px-2 py-2 rounded-lg", collapsed ? "justify-center" : ""].join(" ")}>
                    {user?.avatar ? (
                        <img src={user.avatar} alt={user.name} className="w-7 h-7 rounded-full object-cover shrink-0" />
                    ) : (
                        <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0 text-xs font-bold text-primary">{initial}</div>
                    )}
                    {!collapsed && (
                        <>
                            <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold text-base-content/80 truncate">{user?.name || "Admin"}</p>
                                <p className="text-[10px] text-base-content/35 truncate">{user?.email}</p>
                            </div>
                            <button onClick={logout} title="Sign out" className="w-6 h-6 flex items-center justify-center text-base-content/30 hover:text-error transition-colors rounded shrink-0">
                                <LogOut size={14} className="text-error/80" />
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function DashboardLayout() {
    const { user, logout } = useAuth();
    const [collapsed, setCollapsed] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);

    if (!user) {
        return (
            <div className="min-h-screen bg-base-100 flex items-center justify-center">
                <span className="loading loading-spinner loading-lg text-primary" />
            </div>
        );
    }

    if (user.role !== "admin") {
        return (
            <div className="min-h-screen bg-base-100 flex items-center justify-center">
                <div className="card bg-base-200 shadow-lg w-80 text-center">
                    <div className="card-body gap-4">
                        <Shield size={36} className="mx-auto text-error/60" />
                        <h2 className="card-title justify-center">Access Denied</h2>
                        <p className="text-sm text-base-content/45">Admin access required.</p>
                        <Link to="/" className="btn btn-primary btn-sm">
                            Back to FLUX
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    const initial = (user.name || "A")[0].toUpperCase();

    return (
        <div className="flex h-screen overflow-hidden bg-base-100 text-base-content">
            {/* Desktop Sidebar */}
            <aside
                className={[
                    "hidden md:flex flex-col relative shrink-0",
                    "bg-base-200 border-r border-base-content/5",
                    "transition-all duration-300 ease-in-out",
                    collapsed ? "w-60px" : "w-220px",
                ].join(" ")}>
                <Sidebar collapsed={collapsed} onNav={() => {}} user={user} logout={logout} />
                <button
                    onClick={() => setCollapsed(!collapsed)}
                    aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                    className="absolute top-4 -right-3 z-10 w-6 h-6 rounded-full bg-base-300 border border-base-content/10 flex items-center justify-center text-base-content/60 hover:text-base-content transition-colors shadow-sm">
                    {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
                </button>
            </aside>

            {/* Mobile drawer overlay */}
            {mobileOpen && (
                <div className="fixed inset-0 z-50 md:hidden flex">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
                    <div className="relative w-64 bg-base-200 border-r border-base-content/5 flex flex-col z-10">
                        {/* Close button row — Logo already rendered inside Sidebar header */}
                        {/* <div className="absolute top-3 right-3 z-20">
                            <button
                                onClick={() => setMobileOpen(false)}
                                aria-label="Close menu"
                                className="w-9 h-9 flex items-center justify-center rounded-lg bg-base-content/15 hover:bg-base-content/25 text-base-content transition-colors">
                                <X size={18} strokeWidth={2.5} />
                            </button>
                        </div> */}
                        <div className="flex-1 overflow-y-auto">
                            <Sidebar collapsed={false} onNav={() => setMobileOpen(false)} user={user} logout={logout} />
                        </div>
                    </div>
                </div>
            )}

            {/* Main content */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                <header className="h-14 shrink-0 flex items-center gap-3 px-4 bg-base-300 border-b border-base-content/5 sticky top-0 z-20">
                    <button className="md:hidden btn btn-ghost btn-sm btn-square text-base-content/70" onClick={() => setMobileOpen(true)} aria-label="Open menu">
                        <Menu size={20} />
                    </button>
                    <div className="flex-1" />
                    <div className="flex items-center gap-2">
                        <span className="badge badge-primary badge-outline badge-sm rounded-full font-bold uppercase tracking-widest">{user.role}</span>
                        {user?.avatar ? (
                            <img src={user.avatar} alt={user.name} className="w-8 h-8 rounded-full object-cover" />
                        ) : (
                            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">{initial}</div>
                        )}
                    </div>
                </header>
                <main className="flex-1 overflow-auto p-4 sm:p-6 bg-base-100">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}
