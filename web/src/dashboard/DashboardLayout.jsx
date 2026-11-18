// web/src/Dashboard/DashboardLayout.jsx
// Admin shell — inherits global theme/CSS (DaisyUI tokens), NO dashboard.css

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet } from "react-router";
import {
    LayoutDashboard,
    Users,
    HardDrive,
    Activity,
    Settings,
    LogOut,
    Radio,
    ScrollText,
    Cpu,
    Menu,
    X,
    Shield,
    Upload,
    FileVideo,
    Tv,
    Cloud,
    Megaphone,
    Languages,
    ArrowLeft,
    PanelLeftClose,
    PanelLeftOpen,
} from "lucide-react";
import { useAuth, Logo } from "./Shared";
import { useDashboardLibraries } from "./Hooks/useDashboard";
import Notifications from "../Components/Layout/Notifications";

/* ─── Navigation ─────────────────────────────────────────────────────────── */

const NAV = [
    {
        title: null,
        items: [{ to: "/dashboard", icon: LayoutDashboard, label: "Overview", end: true }],
    },
    {
        title: "Media",
        items: [
            { to: "/dashboard/media", icon: FileVideo, label: "Media" },
            { to: "/dashboard/libraries", icon: HardDrive, label: "Libraries" },
            { to: "/dashboard/subtitles", icon: Languages, label: "Subtitles" },
            { to: "/dashboard/uploads", icon: Upload, label: "Uploads", badgeKey: "uploads" },
        ],
    },
    {
        title: "Live",
        items: [
            { to: "/dashboard/iptv", icon: Tv, label: "IPTV" },
            { to: "/dashboard/streams", icon: Radio, label: "Live Streams" },
        ],
    },
    {
        title: "Community",
        items: [
            { to: "/dashboard/users", icon: Users, label: "Users" },
            { to: "/dashboard/announcements", icon: Megaphone, label: "Announcements" },
        ],
    },
    {
        title: "System",
        items: [
            { to: "/dashboard/jobs", icon: Activity, label: "Jobs", badgeKey: "jobs" },
            { to: "/dashboard/storage", icon: Cloud, label: "Storage" },
            { to: "/dashboard/health", icon: Cpu, label: "System Health" },
            { to: "/dashboard/logs", icon: ScrollText, label: "Logs" },
        ],
    },
];

const FOOTER_NAV = [
    { to: "/settings", icon: Settings, label: "Settings" },
    { to: "/", icon: ArrowLeft, label: "Back to FLUX" },
];

// Live counts for nav badges, e.g. { uploads: 2, jobs: 3 }. TODO: wire once the jobs / upload-queue data shapes are known.
function useNavBadges() {
    return {};
}

const STORAGE_KEY = "flux.dash.sidebar";
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

function readCollapsed() {
    try {
        return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
        return false;
    }
}

/* ─── Small parts ────────────────────────────────────────────────────────── */

// Same maths as DashLibraries: used = sum of library sizes, total = server disk size (if known).
const TB = 1024 ** 4;
const GB = 1024 ** 3;
const fmtSize = (b) => (b >= TB ? `${(b / TB).toFixed(1)} TB` : `${Math.round(b / GB)} GB`);

function useStorageSummary() {
    const { data } = useDashboardLibraries();
    const libs = data?.libraries ?? [];
    const used = libs.reduce((a, l) => a + (l.sizeBytes ?? 0), 0);
    const driveTotals = libs.map((l) => l.driveTotalBytes ?? l.diskTotalBytes ?? null);
    const total = data?.diskTotalBytes ?? (libs.length && driveTotals.every(Boolean) ? driveTotals.reduce((a, b) => a + b, 0) : null);
    return { used, total, pct: total ? Math.min(100, Math.round((used / total) * 100)) : null };
}

function StorageMeter() {
    const { used, total, pct } = useStorageSummary();
    if (!used && !total) return null;
    return (
        <div className="px-3 pb-2.5 pt-1">
            <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="font-semibold text-base-content/85">Storage</span>
                <span className="truncate tabular-nums text-base-content/70">{total ? `${fmtSize(used)} of ${fmtSize(total)}` : `${fmtSize(used)} used`}</span>
            </div>
            {pct != null && (
                <div role="progressbar" aria-label="Storage used" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className="mt-2 h-1 overflow-hidden rounded-full bg-base-content/10">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
            )}
        </div>
    );
}

function AdminBadge() {
    return <span className="shrink-0 rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none tracking-widest text-primary-content">Admin</span>;
}

function Avatar({ user, className = "h-10 w-10 text-sm" }) {
    const initial = (user?.name || user?.email || "A")[0].toUpperCase();
    if (user?.avatar) {
        return <img src={user.avatar} alt="" className={`${className} shrink-0 rounded-full object-cover`} />;
    }
    return <div className={`${className} flex shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/20 font-bold text-primary`}>{initial}</div>;
}

function NavItem({ item, collapsed, badge, onClick }) {
    // Collapsed-rail tooltip. Positioned with `fixed` so the nav's scroll container can't clip it.
    const [tip, setTip] = useState(null);
    const showTip = (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setTip({ top: r.top + r.height / 2, left: r.right + 12 });
    };
    const hideTip = () => setTip(null);

    return (
        <NavLink
            to={item.to}
            end={item.end}
            onClick={(e) => {
                hideTip();
                onClick?.(e);
            }}
            onMouseEnter={collapsed ? showTip : undefined}
            onMouseLeave={collapsed ? hideTip : undefined}
            onFocus={collapsed ? showTip : undefined}
            onBlur={collapsed ? hideTip : undefined}
            aria-label={collapsed ? item.label : undefined}
            className={({ isActive }) =>
                [
                    "relative flex items-center rounded-lg text-sm font-medium select-none transition-colors duration-150",
                    FOCUS,
                    collapsed ? "mx-auto h-11 w-11 justify-center" : "h-9 gap-3 px-3",
                    isActive ? "bg-primary text-primary-content" : "text-base-content/75 hover:bg-base-content/5 hover:text-base-content",
                ].join(" ")
            }>
            {({ isActive }) => (
                <>
                    <item.icon size={18} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                    {badge > 0 &&
                        (collapsed ? (
                            <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-secondary ring-2 ring-base-200" aria-label={`${badge} active`} />
                        ) : (
                            <span
                                className={`ml-auto flex h-5 min-w-[22px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold ${isActive ? "bg-primary-content/20 text-primary-content" : "bg-secondary/15 text-secondary"}`}>
                                {badge}
                            </span>
                        ))}
                    {collapsed && tip && (
                        <span
                            role="tooltip"
                            style={{ top: tip.top, left: tip.left }}
                            className="pointer-events-none fixed z-[60] flex -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-content opacity-100 shadow-xl shadow-black/40 transition-opacity duration-150 starting:opacity-0">
                            <span aria-hidden="true" className="absolute -left-[5px] top-1/2 h-2.5 w-2.5 -translate-y-1/2 rotate-45 rounded-[2px] bg-primary" />
                            <span className="relative">{item.label}</span>
                            {badge > 0 && <span className="relative rounded bg-primary-content/20 px-1.5 py-0.5 text-[10px] font-bold leading-none text-primary-content">{badge}</span>}
                        </span>
                    )}
                </>
            )}
        </NavLink>
    );
}

/* ─── Sidebar ────────────────────────────────────────────────────────────── */

function Sidebar({ collapsed, variant, onNav, onToggle, user }) {
    const badges = useNavBadges();
    const isDrawer = variant === "drawer";
    // Expanded desktop: collapse button lives here. Collapsed: the expand button lives in the navbar.
    const ToggleIcon = isDrawer ? X : PanelLeftClose;
    const toggleLabel = isDrawer ? "Close menu" : "Collapse sidebar";

    const toggleBtn = (
        <button
            type="button"
            onClick={onToggle}
            title={isDrawer ? toggleLabel : `${toggleLabel} ( [ )`}
            aria-label={toggleLabel}
            aria-keyshortcuts={isDrawer ? undefined : "["}
            className={`flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-base-content/70 transition-colors duration-150 hover:bg-base-content/10 hover:text-base-content ${FOCUS}`}>
            <ToggleIcon size={19} strokeWidth={1.6} aria-hidden="true" />
        </button>
    );

    return (
        <div className="flex h-full min-h-0 flex-col bg-base-200">
            {/* Header */}
            {collapsed ? (
                <div className="flex h-[52px] shrink-0 items-center justify-center border-b border-base-content/15">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-black text-primary-content">F</div>
                </div>
            ) : (
                <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-base-content/15 pl-5 pr-2.5">
                    <div className="min-w-0 flex-1">
                        <Logo />
                    </div>
                    {toggleBtn}
                </div>
            )}

            {/* Routes */}
            <nav aria-label="Dashboard" className={`min-h-0 flex-1 overflow-y-auto pb-1 pt-3.5 ${collapsed ? "px-2" : "px-3"}`}>
                {NAV.map((section, i) => (
                    <div key={section.title ?? "root"} className={i === 0 ? "" : collapsed ? "mt-3" : "mt-5"}>
                        {section.title &&
                            (collapsed ? (
                                <div className="mx-auto mb-2 h-px w-7 bg-base-content/10" role="presentation" />
                            ) : (
                                <p className="mb-1.5 px-3 text-[11px] font-bold uppercase tracking-wider text-primary">{section.title}</p>
                            ))}
                        <div className="space-y-0.5">
                            {section.items.map((item) => (
                                <NavItem key={item.to} item={item} collapsed={collapsed} badge={badges[item.badgeKey]} onClick={onNav} />
                            ))}
                        </div>
                    </div>
                ))}
                {/* General: storage meter + settings + exit — scroll with the routes, not pinned */}
                <div className={collapsed ? "mt-3" : "mt-5"}>
                    {collapsed ? (
                        <div className="mx-auto mb-2 h-px w-7 bg-base-content/10" role="presentation" />
                    ) : (
                        <p className="mb-1.5 px-3 text-[11px] font-bold uppercase tracking-wider text-primary">General</p>
                    )}
                    {!collapsed && <StorageMeter />}
                    <div className="space-y-0.5">
                        {FOOTER_NAV.map((item) => (
                            <NavItem key={item.to} item={item} collapsed={collapsed} onClick={onNav} />
                        ))}
                    </div>
                </div>
            </nav>

            {/* Profile */}
            {collapsed ? (
                <div className="flex shrink-0 justify-center border-t border-base-content/15 py-3.5" title={`${user?.name || "Admin"} (Admin)`}>
                    <Avatar user={user} />
                </div>
            ) : (
                <div className="flex shrink-0 items-center gap-3 border-t border-base-content/15 py-3.5 pl-4 pr-3">
                    <Avatar user={user} />
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold text-base-content">{user?.name || "Admin"}</span>
                            <AdminBadge />
                        </div>
                        <p className="mt-0.5 truncate text-xs text-base-content/70">{user?.email}</p>
                    </div>
                </div>
            )}
        </div>
    );
}

/* ─── Navbar account menu ────────────────────────────────────────────────── */

function AccountMenu({ user, logout }) {
    const [open, setOpen] = useState(false);
    const btnRef = useRef(null);
    const panelRef = useRef(null);

    useEffect(() => {
        if (!open) return;
        const onDown = (e) => {
            if (btnRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return;
            setOpen(false);
        };
        const onKey = (e) => {
            if (e.key === "Escape") {
                setOpen(false);
                btnRef.current?.focus();
            }
        };
        document.addEventListener("mousedown", onDown);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onDown);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

    const itemCls = `flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-base-content/80 transition-colors hover:bg-base-content/5 hover:text-base-content ${FOCUS}`;

    return (
        <div className="relative">
            <button
                ref={btnRef}
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label="Account menu"
                className={`flex h-10 cursor-pointer items-center gap-2.5 rounded-full pl-3 pr-1 transition-colors duration-150 hover:bg-base-content/10 ${open ? "bg-base-content/10" : ""} ${FOCUS}`}>
                <AdminBadge />
                <Avatar user={user} className="h-8 w-8 text-[13px]" />
            </button>

            {open && (
                <div
                    ref={panelRef}
                    role="menu"
                    aria-label="Account"
                    className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-base-content/10 bg-base-200 shadow-xl">
                    <div className="border-b border-base-content/10 px-4 py-3">
                        <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold">{user?.name || "Admin"}</span>
                            <AdminBadge />
                        </div>
                        <p className="mt-0.5 truncate text-xs text-base-content/70">{user?.email}</p>
                    </div>
                    <div className="p-1.5">
                        <Link to="/settings" role="menuitem" onClick={() => setOpen(false)} className={itemCls}>
                            <Settings size={16} strokeWidth={1.75} aria-hidden="true" />
                            Settings
                        </Link>
                        <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                                setOpen(false);
                                logout();
                            }}
                            className={`${itemCls} !text-error/90 hover:!text-error`}>
                            <LogOut size={16} strokeWidth={1.75} aria-hidden="true" />
                            Sign out
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

/* ─── Layout ─────────────────────────────────────────────────────────────── */

export default function DashboardLayout() {
    const { user, logout } = useAuth();
    const [collapsed, setCollapsed] = useState(readCollapsed);
    const [mobileOpen, setMobileOpen] = useState(false);

    const toggle = useCallback(() => setCollapsed((c) => !c), []);

    // Persist collapsed state
    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
        } catch {
            /* storage unavailable */
        }
    }, [collapsed]);

    // "[" toggles the sidebar (ignored while typing)
    useEffect(() => {
        const onKey = (e) => {
            if (e.key !== "[" || e.metaKey || e.ctrlKey || e.altKey) return;
            const t = e.target;
            if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
            toggle();
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [toggle]);

    // Escape closes the mobile drawer
    useEffect(() => {
        if (!mobileOpen) return;
        const onKey = (e) => e.key === "Escape" && setMobileOpen(false);
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [mobileOpen]);

    if (!user) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-base-100">
                <span className="loading loading-spinner loading-lg text-primary" />
            </div>
        );
    }

    if (user.role !== "admin") {
        return (
            <div className="flex min-h-screen items-center justify-center bg-base-100">
                <div className="card w-80 bg-base-200 text-center shadow-lg">
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

    return (
        <div className="flex h-screen overflow-hidden bg-base-100 text-base-content">
            {/* Desktop sidebar */}
            <aside
                className={["hidden shrink-0 flex-col overflow-hidden border-r border-base-content/10 transition-[width] duration-200 ease-out md:flex", collapsed ? "w-[64px]" : "w-[240px]"].join(
                    " ",
                )}>
                <Sidebar collapsed={collapsed} variant="desktop" onNav={() => {}} onToggle={toggle} user={user} />
            </aside>

            {/* Mobile drawer */}
            {mobileOpen && (
                <div className="fixed inset-0 z-50 flex md:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
                    <button type="button" tabIndex={-1} aria-label="Close menu" className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
                    <div className="relative z-10 h-full w-72 max-w-[85vw] border-r border-base-content/10 shadow-2xl">
                        <Sidebar collapsed={false} variant="drawer" onNav={() => setMobileOpen(false)} onToggle={() => setMobileOpen(false)} user={user} />
                    </div>
                </div>
            )}

            {/* Main column */}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                {/* Navbar: left = menu (mobile) / expand sidebar (desktop, only when collapsed). Right = notifications + profile. */}
                <header className="relative z-30 flex h-[52px] shrink-0 items-center gap-3 border-b border-base-content/15 bg-base-200 px-4 sm:px-5">
                    <button
                        type="button"
                        className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-base-content/70 transition-colors hover:bg-base-content/10 hover:text-base-content md:hidden ${FOCUS}`}
                        onClick={() => setMobileOpen(true)}
                        aria-label="Open menu">
                        <Menu size={19} aria-hidden="true" />
                    </button>
                    {collapsed && (
                        <button
                            type="button"
                            onClick={toggle}
                            title="Expand sidebar ( [ )"
                            aria-label="Expand sidebar"
                            aria-keyshortcuts="["
                            className={`hidden h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-base-content/70 transition-colors duration-150 hover:bg-base-content/10 hover:text-base-content md:flex ${FOCUS}`}>
                            <PanelLeftOpen size={19} strokeWidth={1.6} aria-hidden="true" />
                        </button>
                    )}
                    <div className="flex-1" />
                    <Notifications />
                    <div className="h-[22px] w-px bg-base-content/15" aria-hidden="true" />
                    <AccountMenu user={user} logout={logout} />
                </header>

                <main className="flex-1 overflow-auto bg-base-100 p-4 sm:p-6">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}
