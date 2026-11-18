import { useState, useEffect, useCallback, useMemo, useRef, useId } from "react";
import { createPortal } from "react-dom";
import {
    Search,
    MoreVertical,
    CheckCircle,
    XCircle,
    Ban,
    Trash2,
    ChevronLeft,
    ChevronRight,
    Crown,
    KeyRound,
    UserCheck,
    X,
    Clock,
    Calendar,
    AlertTriangle,
    Users,
    LogOut,
    Archive,
    Flame,
    SlidersHorizontal,
    ListChecks,
    Eye,
    Download,
    Plus,
    Info,
    Trophy,
    Tv,
    TrendingUp,
    Filter,
    Gauge,
    ShieldCheck,
    Inbox,
    Hourglass,
    LayoutGrid,
    ChevronDown,
} from "lucide-react";
import { dashApi } from "../Api/dashboardApi";
import { useUsersActivity } from "../Hooks/useDashUsers";
import { ConfirmModal, DASH_MODALS, UserInfoModal, UserPermissionModal, UserRequestModal } from "../Components/DashModal";

// Type scale follows DashOverview:
//   text-sm  body / names / values      text-xs  labels, sub text, table headers
//   text-lg  KPI values                 text-xl  page title
// Weights: font-medium + font-semibold only. Radius: rounded-lg panels, rounded-md controls.
// Colours: primary = main series, neutral grey = secondary series, semantic tokens (success/info/warning/error) for status only.

// ─── helpers ──────────────────────────────────────────────────────────────────

const DAY = 86400000;

const sum = (a) => (a ?? []).reduce((s, v) => s + v, 0);
const pct = (v, total) => (total > 0 ? Math.round((v / total) * 100) : 0);
const ordinalDay = (iso) => new Date(`${iso}T12:00:00`);

function fmtDateShort(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function tickLabel(iso, n) {
    const d = ordinalDay(iso);
    return n <= 7 ? d.toLocaleDateString(undefined, { weekday: "short" }) : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
function isExpired(u) {
    return u?.accessType === "temporary" && u?.accessExpiresAt && Date.now() > new Date(u.accessExpiresAt);
}
function daysLeft(iso) {
    return Math.max(0, Math.ceil((new Date(iso) - Date.now()) / DAY));
}
function startOfDay(t) {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

// "2h ago" · "Yesterday" · "9d ago"
function relShort(iso) {
    if (!iso) return "";
    const s = (Date.now() - new Date(iso)) / 1000;
    if (s < 60) return "just now";
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return d === 1 ? "Yesterday" : `${d}d ago`;
}
// "2 hours ago" · "2 days ago"
function relLong(iso) {
    if (!iso) return "";
    const s = (Date.now() - new Date(iso)) / 1000;
    if (s < 60) return "just now";
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
    const d = Math.floor(h / 24);
    return `${d} day${d === 1 ? "" : "s"} ago`;
}
// hours (number) → "42m" / "3.5 h" / "120 h"  (same as DashOverview)
function fmtHours(h) {
    if (!h) return "0 h";
    if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
    return `${h >= 100 ? Math.round(h) : Math.round(h * 10) / 10} h`;
}

// Presence: live "online" list from the overview endpoint when we have it,
// otherwise fall back to signed-in devices. ctx = { onlineSet, seen }.
function getPresence(u, ctx) {
    const devices = u._count?.devices ?? 0;
    const online = ctx?.onlineSet ? ctx.onlineSet.has(u.id) : devices > 0;
    const lastSeen = ctx?.seen?.[u.id] ?? u.lastSeenAt ?? u.lastActiveAt ?? u.lastLoginAt ?? null;
    return { online, devices, lastSeen };
}

// Which libraries a user may open. Adjust the field names to your permission shape.
function libraryLabel(u, libraries) {
    const ids = u.libraryIds ?? u.allowedLibraryIds ?? u.permissions?.libraryIds;
    if (!Array.isArray(ids)) return "All libraries";
    if (!ids.length) return "No libraries";
    if (libraries.length && ids.length >= libraries.length) return "All libraries";
    const names = ids
        .map((id) => libraries.find((l) => String(l.id) === String(id)))
        .map((l) => l?.label ?? l?.name)
        .filter(Boolean);
    return names.join(", ") || `${ids.length} libraries`;
}

// Everything account-related (strip, banner, account mix) is calculated from the user list.
function computeInsights(list, ctx) {
    const users = list.filter((u) => !u.deletedAt);
    const today = startOfDay(Date.now());
    const created = users.map((u) => (u.createdAt ? startOfDay(u.createdAt) : null));

    const cum = Array.from({ length: 30 }, (_, i) => {
        const day = today - (29 - i) * DAY;
        return created.filter((c) => c !== null && c <= day).length;
    });
    const isoDay = (t) => {
        const d = new Date(t);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    const growthDates = Array.from({ length: 30 }, (_, i) => isoDay(today - (29 - i) * DAY));
    const signups = Array.from({ length: 30 }, (_, i) => created.filter((c) => c === today - (29 - i) * DAY).length);
    const signupDates = growthDates;
    const newWeek = created.filter((c) => c !== null && c > today - 7 * DAY).length;

    const counts = { approved: 0, pending: 0, blocked: 0, rejected: 0 };
    users.forEach((u) => {
        if (counts[u.status] !== undefined) counts[u.status]++;
    });

    const approved = users.filter((u) => u.status === "approved");
    const expired = approved.filter(isExpired).length;
    const tempActive = approved.filter((u) => u.accessType === "temporary" && !isExpired(u));
    const ending7 = tempActive.filter((u) => u.accessExpiresAt && daysLeft(u.accessExpiresAt) <= 7).length;
    const permanent = approved.filter((u) => u.accessType !== "temporary").length;

    const devices = users.reduce((s, u) => s + (u._count?.devices ?? 0), 0);
    const online = users.filter((u) => getPresence(u, ctx).online).length;

    const pending = users.filter((u) => u.status === "pending");
    const pendingVerified = pending.filter((u) => u.emailVerified);
    const oldestPending = pending.reduce((o, u) => (u.createdAt && (!o || new Date(u.createdAt) < new Date(o)) ? u.createdAt : o), null);

    const prevWeek = created.filter((c) => c !== null && c > today - 14 * DAY && c <= today - 7 * DAY).length;
    const now = Date.now();
    const seenAt = (u) => {
        const p = getPresence(u, ctx);
        return p.online ? now : p.lastSeen ? new Date(p.lastSeen).getTime() : 0;
    };
    const verified = users.filter((u) => u.emailVerified).length;
    const active30 = approved.filter((u) => now - seenAt(u) < 30 * DAY).length;
    const active7 = approved.filter((u) => now - seenAt(u) < 7 * DAY).length;
    const onlineApproved = approved.filter((u) => getPresence(u, ctx).online).length;
    const dormant = approved.length - active30;
    const hasSeen = !!ctx?.onlineSet || Object.keys(ctx?.seen ?? {}).length > 0;

    const funnel = [
        { label: "Signed up", value: users.length },
        { label: "Approved", value: approved.length },
        { label: "Signed in (30d)", value: active30 },
        { label: "Active (7d)", value: active7 },
        { label: "Online now", value: onlineApproved },
    ];

    const ageBuckets = [
        ["Under 1 day", 0, 1, "bg-info"],
        ["1 to 3 days", 1, 3, "bg-warning"],
        ["3 to 7 days", 3, 7, "bg-warning"],
        ["Over 7 days", 7, Infinity, "bg-error"],
    ];
    const pendingAge = ageBuckets.map(([label, lo, hi, cls]) => ({
        label,
        cls,
        value: pending.filter((u) => {
            const d = (now - new Date(u.createdAt)) / DAY;
            return d >= lo && d < hi;
        }).length,
    }));

    const expiring = tempActive
        .filter((u) => u.accessExpiresAt)
        .map((u) => ({ u, d: daysLeft(u.accessExpiresAt) }))
        .sort((a, b) => a.d - b.d);
    const expDays = Array.from({ length: 30 }, () => 0);
    expiring.forEach(({ d }) => {
        if (d >= 1 && d <= 30) expDays[d - 1]++;
    });

    const devHist = [0, 1, 2, 3, 4].map(
        (n) =>
            users.filter((u) => {
                const c = u._count?.devices ?? 0;
                return n === 4 ? c >= 4 : c === n;
            }).length,
    );
    const withDev = users.filter((u) => (u._count?.devices ?? 0) > 0).length;
    const avgDevices = withDev ? devices / withDev : 0;

    return {
        presence: ctx,
        expiredUsers: approved.filter(isExpired).sort((a, b) => new Date(b.accessExpiresAt) - new Date(a.accessExpiresAt)),
        prevWeek,
        verified,
        active7,
        active30,
        dormant,
        hasSeen,
        funnel,
        pendingAge,
        expiring,
        expDays,
        devHist,
        avgDevices,
        users,
        total: users.length,
        deleted: list.length - users.length,
        counts,
        cum,
        growthDates,
        signups,
        signupDates,
        newWeek,
        online,
        devices,
        ending: ending7 + expired,
        attention: counts.pending + ending7 + expired,
        access: { permanent, limited: tempActive.length - ending7, ending7, expired },
        pending,
        pendingVerified,
        oldestPending,
    };
}

function exportCsv(list) {
    // Neutralise spreadsheet formulas (=, +, -, @, tab, CR) so an account name like "=1+1" cannot execute when opened in Excel.
    const esc = (v) => {
        let t = String(v ?? "");
        if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
        return `"${t.replace(/"/g, '""')}"`;
    };
    const day = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : "");
    const head = ["Name", "Email", "Role", "Status", "Email verified", "Access", "Access expires", "Devices", "Joined"];
    const rows = list.map((u) =>
        [u.name, u.email, u.role, u.deletedAt ? "pending deletion" : u.status, u.emailVerified ? "yes" : "no", u.accessType, day(u.accessExpiresAt), u._count?.devices ?? 0, day(u.createdAt)]
            .map(esc)
            .join(","),
    );
    const blob = new Blob(["﻿" + [head.map(esc).join(","), ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `flux-users-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

// Client-side filters (applied to the loaded page only)
const FILTER_GROUPS = [
    {
        key: "role",
        label: "Role",
        opts: [
            ["", "Any"],
            ["admin", "Admin"],
            ["user", "User"],
        ],
    },
    {
        key: "email",
        label: "Email",
        opts: [
            ["", "Any"],
            ["verified", "Verified"],
            ["unverified", "Unverified"],
        ],
    },
    {
        key: "access",
        label: "Access",
        opts: [
            ["", "Any"],
            ["permanent", "Permanent"],
            ["temporary", "Time limited"],
            ["expired", "Expired"],
        ],
    },
];
const NO_FILTERS = { role: "", email: "", access: "" };

function matchFilters(u, f) {
    if (f.role && u.role !== f.role) return false;
    if (f.email === "verified" && !u.emailVerified) return false;
    if (f.email === "unverified" && u.emailVerified) return false;
    if (f.access === "expired" && !isExpired(u)) return false;
    if (f.access === "temporary" && !(u.accessType === "temporary" && !isExpired(u))) return false;
    if (f.access === "permanent" && u.accessType === "temporary") return false;
    return true;
}

// ─── anchored menu hook (portal menus: ⋮, Filters, Time limit) ────────────────

function useAnchoredMenu(width) {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState({ left: 0, top: 0 });
    const btnRef = useRef(null);
    const menuRef = useRef(null);

    useEffect(() => {
        if (!open) return;
        const close = (e) => {
            if (!btnRef.current?.contains(e.target) && !menuRef.current?.contains(e.target)) setOpen(false);
        };
        const scroll = (e) => {
            if (menuRef.current?.contains(e.target)) return;
            setOpen(false);
        };
        document.addEventListener("mousedown", close);
        window.addEventListener("scroll", scroll, true);
        return () => {
            document.removeEventListener("mousedown", close);
            window.removeEventListener("scroll", scroll, true);
        };
    }, [open]);

    function toggle(e) {
        e.stopPropagation();
        if (!btnRef.current) return;
        const r = btnRef.current.getBoundingClientRect();
        const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
        const flip = window.innerHeight - r.bottom < 300;
        setPos(flip ? { left, bottom: window.innerHeight - r.top + 4 } : { left, top: r.bottom + 4 });
        setOpen((o) => !o);
    }

    return { open, setOpen, btnRef, menuRef, pos, toggle };
}

// ─── Small building blocks (same look as DashOverview) ───────────────────────

function Panel({ title, icon: Icon, right, children, className = "" }) {
    return (
        <section className={`flex min-w-0 flex-col overflow-hidden rounded-lg border border-base-300 bg-base-200 ${className}`}>
            <header className="flex h-[3.25rem] items-center justify-between gap-2 border-b border-base-300 px-4">
                <h3 className="flex items-center gap-2 text-sm font-medium text-base-content/90">
                    {Icon && <Icon size={14} className="shrink-0" />}
                    {title}
                </h3>
                <div className="flex items-center gap-2">{right}</div>
            </header>
            <div className="flex flex-1 flex-col">{children}</div>
        </section>
    );
}

function SectionLabel({ children }) {
    return (
        <div className="flex items-center gap-3 pt-2 text-sm font-semibold text-base-content/90">
            {children}
            <span className="h-px flex-1 bg-base-300" />
        </div>
    );
}

function Dot({ className = "" }) {
    return <span className={`inline-block size-2 shrink-0 rounded-full bg-success ${className}`} />;
}

function Bar({ value, tone = "bg-primary", className = "" }) {
    return (
        <div className={`h-1.5 overflow-hidden rounded-full bg-base-300 ${className}`}>
            <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
        </div>
    );
}

function Empty({ icon: Icon = Info, text }) {
    return (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-8 text-center">
            <Icon size={18} className="text-base-content/60" />
            <p className="max-w-xs text-sm text-base-content/75">{text}</p>
        </div>
    );
}

function Skeleton({ className = "" }) {
    return <div className={`animate-pulse rounded-md bg-base-300 ${className}`} />;
}

function Kpis({ items, cols = "lg:grid-cols-4", first = false }) {
    const odd = items.length % 2 === 1;
    return (
        <div className={`grid grid-cols-2 gap-px bg-base-300 ${cols} ${first ? "" : "border-t border-base-300"}`}>
            {items.map((k, i) => (
                <div key={k.label} className={`min-w-0 bg-base-200 px-4 py-3 ${odd && i === items.length - 1 ? "col-span-2 lg:col-span-1" : ""}`}>
                    <p className="text-xs text-base-content/75">{k.label}</p>
                    <p className="mt-0.5 flex items-center gap-2 text-lg font-semibold leading-tight tabular-nums">{k.value}</p>
                    {k.sub && <p className="truncate text-xs text-base-content/65">{k.sub}</p>}
                </div>
            ))}
        </div>
    );
}

// ─── STATUS atoms ─────────────────────────────────────────────────────────────

const STATUS_CFG = {
    approved: { dot: "bg-success", badge: "bg-success/10 border-success/30 text-success", label: "Approved" },
    pending: { dot: "bg-warning", badge: "bg-warning/10 border-warning/30 text-warning", label: "Pending" },
    rejected: { dot: "bg-error", badge: "bg-error/10   border-error/30   text-error", label: "Rejected" },
    blocked: { dot: "bg-error/70", badge: "bg-error/8   border-error/20   text-error/80", label: "Blocked" },
    deleted: { dot: "bg-warning", badge: "bg-warning/8 border-warning/25 text-warning", label: "Pending deletion" },
};

function StatusBadge({ status }) {
    const c = STATUS_CFG[status] ?? {
        dot: "bg-base-content/30",
        badge: "bg-base-content/5 border-base-content/20 text-base-content/60",
        label: status,
    };
    return (
        <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${c.badge}`}>
            <span className={`size-1.5 shrink-0 rounded-full ${c.dot}`} />
            {c.label}
        </span>
    );
}

const AVATAR_TINTS = [
    "bg-primary/20 text-primary ring-primary/20",
    "bg-success/20 text-success ring-success/20",
    "bg-warning/20 text-warning ring-warning/20",
    "bg-info/20 text-info ring-info/20",
    "bg-accent/20 text-accent ring-accent/20",
    "bg-secondary/20 text-secondary ring-secondary/20",
];

function Avatar({ user }) {
    const seed = String(user.id ?? user.email ?? "u");
    const tint = AVATAR_TINTS[[...seed].reduce((s, ch) => s + ch.charCodeAt(0), 0) % AVATAR_TINTS.length];
    const initial = (user.name || user.email || "U")[0].toUpperCase();

    return user.avatar ? (
        <img src={user.avatar} alt="" className="size-8 shrink-0 rounded-full object-cover ring-1 ring-base-300" />
    ) : (
        <div className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1 ${tint}`}>{initial}</div>
    );
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ toast }) {
    if (!toast) return null;
    return createPortal(
        <div
            className={`fixed bottom-5 right-5 z-99999 flex max-w-xs items-center gap-2 rounded-lg px-4 py-3 text-xs font-medium shadow-2xl
            ${toast.type === "error" ? "bg-error text-error-content" : "bg-success text-success-content"}`}>
            {toast.type === "error" ? <AlertTriangle size={13} /> : <CheckCircle size={13} />}
            {toast.msg}
        </div>,
        document.body,
    );
}

// ─── Action buttons (bordered icon buttons) ───────────────────────────────────

const ICON_BTN =
    "size-8 rounded-md border border-base-300 flex items-center justify-center text-base-content/80 " +
    "transition-colors cursor-pointer hover:bg-base-300 hover:text-base-content " +
    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary";

const BTN = "btn btn-sm rounded-md border-none bg-base-300";

function ActionBtn({ icon: Icon, label, onClick }) {
    return (
        <button onClick={onClick} aria-label={label} title={label} className={ICON_BTN}>
            <Icon size={15} strokeWidth={1.8} />
        </button>
    );
}

// ─── ⋮ Action Menu ────────────────────────────────────────────────────────────

function ActionMenu({ user, onAction }) {
    const MENU_W = 196;
    const { open, setOpen, btnRef, menuRef, pos, toggle } = useAnchoredMenu(MENU_W);

    const accessItem =
        user.status === "approved" && user.accessType === "temporary"
            ? [{ label: isExpired(user) ? "Renew access" : "Extend access", icon: Clock, key: "access", cls: "text-warning hover:bg-base-300" }]
            : [];

    const actions = user.deletedAt
        ? [{ label: "View details", icon: Eye, key: "info", cls: "text-base-content hover:bg-base-300" }]
        : [
              { label: "View details", icon: Eye, key: "info", cls: "text-base-content hover:bg-base-300" },
              ...accessItem,
              null,
              ...(user.status !== "approved" ? [{ label: "Approve", icon: CheckCircle, key: "approve", cls: "text-success hover:bg-base-300" }] : []),
              ...(user.status !== "rejected" ? [{ label: "Reject", icon: XCircle, key: "reject", cls: "text-warning hover:bg-base-300" }] : []),
              ...(user.status !== "blocked" ? [{ label: "Block", icon: Ban, key: "block", cls: "text-error hover:bg-base-300" }] : []),
              null,
              { label: "Delete user", icon: Trash2, key: "delete", cls: "text-error font-semibold hover:bg-base-300" },
          ];

    return (
        <>
            <button ref={btnRef} onClick={toggle} aria-label="More actions" aria-expanded={open} title="More actions" className={`${ICON_BTN} ${open ? "bg-base-300 text-base-content" : ""}`}>
                <MoreVertical size={15} strokeWidth={1.8} />
            </button>

            {open &&
                createPortal(
                    <div ref={menuRef} style={{ position: "fixed", ...pos, zIndex: 99999, width: MENU_W }} className="rounded-md border border-base-300 bg-base-200 p-1 shadow-2xl">
                        {actions.map((a, i) =>
                            !a ? (
                                <div key={i} className="my-1 border-t border-base-300" />
                            ) : (
                                <button
                                    key={a.key}
                                    onClick={() => {
                                        onAction(user, a.key);
                                        setOpen(false);
                                    }}
                                    className={`flex w-full cursor-pointer items-center gap-2.5 rounded-md border-none bg-transparent px-3 py-2 text-sm font-medium transition-colors ${a.cls}`}>
                                    <a.icon size={14} className="shrink-0" /> {a.label}
                                </button>
                            ),
                        )}
                    </div>,
                    document.body,
                )}
        </>
    );
}

// ─── Filters menu ─────────────────────────────────────────────────────────────

function FilterMenu({ filters, onChange }) {
    const MENU_W = 280;
    const { open, btnRef, menuRef, pos, toggle } = useAnchoredMenu(MENU_W);
    const active = Object.values(filters).filter(Boolean).length;

    return (
        <>
            <button
                ref={btnRef}
                onClick={toggle}
                aria-expanded={open}
                className={`btn btn-sm rounded-md border bg-transparent ${active || open ? "border-primary text-primary" : "border-base-300 text-base-content"}`}>
                <SlidersHorizontal size={14} />
                Filters
                {active > 0 && <span className="flex h-4 min-w-4 items-center justify-center rounded-md bg-primary px-1 text-[10px] font-semibold tabular-nums text-primary-content">{active}</span>}
            </button>

            {open &&
                createPortal(
                    <div ref={menuRef} style={{ position: "fixed", ...pos, zIndex: 99999, width: MENU_W }} className="space-y-4 rounded-md border border-base-300 bg-base-200 p-4 shadow-2xl">
                        {FILTER_GROUPS.map((g) => (
                            <div key={g.key}>
                                <p className="mb-2 text-xs text-base-content/70">{g.label}</p>
                                <div className="flex flex-wrap gap-1.5">
                                    {g.opts.map(([v, label]) => (
                                        <button
                                            key={v}
                                            onClick={() => onChange({ ...filters, [g.key]: v })}
                                            className={`h-7 cursor-pointer rounded-md border-none px-2.5 text-xs font-medium transition-colors
                                                ${filters[g.key] === v ? "bg-primary text-primary-content" : "bg-base-300 text-base-content/80 hover:text-base-content"}`}>
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                        <div className="flex items-center justify-between border-t border-base-300 pt-3">
                            <p className="text-xs text-base-content/70">Applies to the users on this page</p>
                            <button
                                onClick={() => onChange(NO_FILTERS)}
                                disabled={!active}
                                className="cursor-pointer border-none bg-transparent text-xs font-medium text-primary disabled:cursor-not-allowed disabled:opacity-30">
                                Reset
                            </button>
                        </div>
                    </div>,
                    document.body,
                )}
        </>
    );
}

// ─── Time limit menu (bulk bar) ───────────────────────────────────────────────

const LIMIT_OPTS = [
    [7, "7 days"],
    [30, "30 days"],
    [90, "90 days"],
    [365, "1 year"],
];

function TimeLimitMenu({ onPick }) {
    const MENU_W = 176;
    const { open, setOpen, btnRef, menuRef, pos, toggle } = useAnchoredMenu(MENU_W);
    return (
        <>
            <button ref={btnRef} onClick={toggle} aria-expanded={open} className="btn btn-sm rounded-md border-none bg-base-100">
                Time limit
            </button>
            {open &&
                createPortal(
                    <div ref={menuRef} style={{ position: "fixed", ...pos, zIndex: 99999, width: MENU_W }} className="rounded-md border border-base-300 bg-base-200 p-1 shadow-2xl">
                        <p className="px-3 pb-1 pt-2 text-xs text-base-content/70">Limit access to</p>
                        {LIMIT_OPTS.map(([days, label]) => (
                            <button
                                key={days}
                                onClick={() => {
                                    onPick(days, label);
                                    setOpen(false);
                                }}
                                className="flex w-full cursor-pointer items-center rounded-md border-none bg-transparent px-3 py-2 text-sm font-medium text-base-content transition-colors hover:bg-base-300">
                                {label}
                            </button>
                        ))}
                    </div>,
                    document.body,
                )}
        </>
    );
}

// ─── Charts (SVG measured in real pixels, DaisyUI tokens only) ───────────────

// Measures a container so SVG text stays at its real pixel size instead of scaling with the panel.
function useElementWidth(fallback) {
    const ref = useRef(null);
    const [w, setW] = useState(fallback);
    useEffect(() => {
        const el = ref.current;
        if (!el) return undefined;
        const read = () => {
            const next = Math.round(el.getBoundingClientRect().width);
            if (next > 0) setW((p) => (p === next ? p : next));
        };
        read();
        if (typeof ResizeObserver === "undefined") return undefined;
        const ro = new ResizeObserver(read);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    return [ref, w];
}

function niceTop(max) {
    const raw = Math.max(max, 0.1) / 4;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
    return step * 4;
}

function Sparkline({ data, className = "text-primary" }) {
    if (!data || data.length < 2) return null;
    const w = 64;
    const h = 28;
    const pad = 4;
    const max = Math.max(...data);
    const min = Math.min(...data);
    const pts = data.map((v, i) => [(i / (data.length - 1)) * (w - 2) + 1, max === min ? h / 2 : h - pad - ((v - min) / (max - min)) * (h - pad * 2)]);
    const line = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
    return (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={`${className} shrink-0`} fill="none" aria-hidden="true">
            <polygon points={`1,${h} ${line} ${w - 1},${h}`} className="fill-current" fillOpacity="0.14" />
            <polyline points={line} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

// Area line with an optional dashed overlay (moving average) and hover read-out.
function AreaChart({ dates, values, overlay, unit = (v) => String(v), overlayLabel = "7-day average", height = 190 }) {
    const [boxRef, W] = useElementWidth(480);
    const [hover, setHover] = useState(null);
    const gid = useId().replace(/:/g, "");
    const H = height;
    const L = 32;
    const R = 8;
    const T = 10;
    const B = 22;
    const n = values.length;
    if (n < 2) return null;
    const top = niceTop(Math.max(...values, ...(overlay ?? [0])));
    const x = (i) => L + ((W - L - R) * i) / (n - 1);
    const y = (v) => T + (H - T - B) * (1 - v / top);
    const path = (arr) => arr.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
    const step = n > 12 ? Math.ceil(n / 5) : 1;

    const move = (e) => {
        const b = e.currentTarget.getBoundingClientRect();
        const px = ((e.clientX - b.left) / b.width) * W;
        setHover(Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1)))));
    };

    return (
        <div ref={boxRef} className="w-full">
            <p className="mb-1 min-h-5 text-xs tabular-nums text-base-content/80">
                {hover != null ? `${tickLabel(dates[hover], 30)} · ${unit(values[hover])}${overlay ? ` · ${overlayLabel} ${Math.round(overlay[hover] * 10) / 10}` : ""}` : ""}
            </p>
            <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block" role="img" onMouseMove={move} onMouseLeave={() => setHover(null)}>
                {[0, 1, 2, 3, 4].map((g) => {
                    const v = (top * g) / 4;
                    return (
                        <g key={g}>
                            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="stroke-base-300" />
                            <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="12" className="fill-base-content" fillOpacity="0.7">
                                {Number(v.toFixed(1))}
                            </text>
                        </g>
                    );
                })}
                {dates.map((d, i) =>
                    i % step === 0 ? (
                        <text key={d} x={x(i)} y={H - 6} textAnchor="middle" fontSize="12" className="fill-base-content" fillOpacity="0.7">
                            {tickLabel(d, n)}
                        </text>
                    ) : null,
                )}
                <g className="text-primary">
                    <defs>
                        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
                            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                        </linearGradient>
                    </defs>
                    <path d={`${path(values)} L${x(n - 1)} ${y(0)} L${x(0)} ${y(0)} Z`} fill={`url(#${gid})`} />
                    <path d={path(values)} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                </g>
                {overlay && <path d={path(overlay)} fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 4" className="text-base-content" strokeOpacity="0.6" />}
                {hover != null && (
                    <g>
                        <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="stroke-base-content" strokeOpacity="0.4" />
                        <circle cx={x(hover)} cy={y(values[hover])} r="4" className="fill-primary stroke-base-200" strokeWidth="2" />
                    </g>
                )}
            </svg>
            {overlay && (
                <div className="mt-1 flex gap-4 text-xs text-base-content/75">
                    <span className="flex items-center gap-1.5">
                        <span className="h-0.5 w-3 bg-primary" /> Daily
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="w-3 border-t-2 border-dashed border-base-content/50" /> {overlayLabel}
                    </span>
                </div>
            )}
        </div>
    );
}

// Thin labelled columns (value above each bar). Tallest = primary, rest = secondary.
function ColumnChart({ data, labels, height = 120, unit = (v) => String(v) }) {
    const max = Math.max(...data, 1);
    const top = data.indexOf(Math.max(...data));
    const area = height - 22;
    return (
        <div>
            <div className="flex items-end" style={{ height }}>
                {data.map((v, i) => (
                    <div key={i} title={`${labels[i]} · ${unit(v)}`} className="flex flex-1 flex-col items-center justify-end gap-1">
                        <span className="text-xs tabular-nums text-base-content/80">{v}</span>
                        <div className={`w-3 rounded-sm ${i === top && v > 0 ? "bg-primary" : "bg-base-content/35"}`} style={{ height: Math.max(3, Math.round((v / max) * area)) }} />
                    </div>
                ))}
            </div>
            <div className="mt-2 flex">
                {labels.map((l, i) => (
                    <span key={i} className="flex-1 text-center text-xs text-base-content/70">
                        {l}
                    </span>
                ))}
            </div>
        </div>
    );
}

// Daily signups (thin bars, right axis) over cumulative accounts (line, left axis).
function ComboChart({ dates, bars, line, height = 200 }) {
    const [boxRef, W] = useElementWidth(560);
    const [hover, setHover] = useState(null);
    const gid = useId().replace(/:/g, "");
    const H = height;
    const L = 34;
    const R = 30;
    const T = 10;
    const B = 22;
    const n = line.length;
    if (n < 2) return null;
    const topL = niceTop(Math.max(...line, 1));
    const topB = niceTop(Math.max(...bars, 1));
    const cw = (W - L - R) / n;
    const x = (i) => L + cw * (i + 0.5);
    const yL = (v) => T + (H - T - B) * (1 - v / topL);
    const yB = (v) => T + (H - T - B) * (1 - v / topB);
    const bw = Math.max(3, Math.min(7, cw * 0.42));
    const step = Math.ceil(n / 6);
    const path = line.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${yL(v).toFixed(1)}`).join(" ");

    const move = (e) => {
        const b = e.currentTarget.getBoundingClientRect();
        const px = ((e.clientX - b.left) / b.width) * W;
        setHover(Math.max(0, Math.min(n - 1, Math.floor((px - L) / cw))));
    };

    return (
        <div ref={boxRef} className="w-full">
            <p className="mb-1 min-h-5 text-xs tabular-nums text-base-content/80">{hover != null ? `${tickLabel(dates[hover], 30)} · +${bars[hover]} new · ${line[hover]} total accounts` : ""}</p>
            <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block" role="img" aria-label="Daily signups and total accounts" onMouseMove={move} onMouseLeave={() => setHover(null)}>
                {[0, 1, 2, 3, 4].map((g) => (
                    <g key={g}>
                        <line x1={L} x2={W - R} y1={yL((topL * g) / 4)} y2={yL((topL * g) / 4)} className="stroke-base-300" />
                        <text x={L - 6} y={yL((topL * g) / 4) + 4} textAnchor="end" fontSize="12" className="fill-primary" fillOpacity="0.9">
                            {Number(((topL * g) / 4).toFixed(1))}
                        </text>
                        <text x={W - R + 6} y={yL((topL * g) / 4) + 4} textAnchor="start" fontSize="12" className="fill-base-content" fillOpacity="0.6">
                            {Number(((topB * g) / 4).toFixed(1))}
                        </text>
                    </g>
                ))}
                {dates.map((d, i) =>
                    i % step === 0 ? (
                        <text key={d} x={x(i)} y={H - 6} textAnchor="middle" fontSize="12" className="fill-base-content" fillOpacity="0.7">
                            {tickLabel(d, n)}
                        </text>
                    ) : null,
                )}
                {bars.map((v, i) => (
                    <rect
                        key={i}
                        x={x(i) - bw / 2}
                        y={yB(v)}
                        width={bw}
                        height={Math.max(0, yB(0) - yB(v))}
                        rx="1.5"
                        className={i === hover ? "fill-primary" : "fill-base-content/35"}
                        fillOpacity={i === hover ? 1 : 0.7}
                    />
                ))}
                <g className="text-primary">
                    <defs>
                        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
                            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                        </linearGradient>
                    </defs>
                    <path d={`${path} L${x(n - 1)} ${yL(0)} L${x(0)} ${yL(0)} Z`} fill={`url(#${gid})`} />
                    <path d={path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                </g>
                {hover != null && (
                    <g>
                        <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="stroke-base-content" strokeOpacity="0.35" />
                        <circle cx={x(hover)} cy={yL(line[hover])} r="4" className="fill-primary stroke-base-200" strokeWidth="2" />
                    </g>
                )}
            </svg>
            <div className="mt-1 flex flex-wrap gap-4 text-xs text-base-content/75">
                <span className="flex items-center gap-1.5">
                    <span className="h-0.5 w-3 bg-primary" /> Total accounts (left axis)
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-1 rounded-sm bg-base-content/35" /> New per day (right axis)
                </span>
            </div>
        </div>
    );
}

// GitHub-style calendar of daily active users.
function Heatmap({ days }) {
    const C = 14;
    const G = 4;
    const P = C + G;
    const LABEL = 32;
    const TOP = 18;
    const max = Math.max(...days.map((d) => d.users), 1);
    const offset = (ordinalDay(days[0].date).getDay() + 6) % 7; // Monday = row 0
    const cols = Math.ceil((days.length + offset) / 7);
    const W = LABEL + cols * P - G;
    const H = TOP + 7 * P - G;
    const level = (v) => (v <= 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4)));
    const op = [0, 0.25, 0.5, 0.75, 1];

    const months = [];
    let last = -1;
    for (let c = 0; c < cols; c++) {
        const d = days[Math.max(0, c * 7 - offset)];
        if (!d) continue;
        const m = ordinalDay(d.date).getMonth();
        if (m !== last) {
            if (c < cols - 1 || months.length === 0) months.push({ c, label: ordinalDay(d.date).toLocaleDateString(undefined, { month: "short" }) });
            last = m;
        }
    }

    return (
        <div>
            <div className="overflow-x-auto">
                <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="mx-auto block max-w-none" role="img" aria-label="Daily active users calendar">
                    {months.map((m) => (
                        <text key={m.c} x={LABEL + m.c * P} y={11} fontSize="12" className="fill-base-content" fillOpacity="0.7">
                            {m.label}
                        </text>
                    ))}
                    {[
                        [0, "Mon"],
                        [2, "Wed"],
                        [4, "Fri"],
                    ].map(([row, label]) => (
                        <text key={label} x={0} y={TOP + row * P + C - 2} fontSize="12" className="fill-base-content" fillOpacity="0.7">
                            {label}
                        </text>
                    ))}
                    {days.map((d, i) => {
                        const idx = i + offset;
                        const lv = level(d.users);
                        return (
                            <rect
                                key={d.date}
                                x={LABEL + Math.floor(idx / 7) * P}
                                y={TOP + (idx % 7) * P}
                                width={C}
                                height={C}
                                rx="3"
                                className={lv ? "fill-primary" : "fill-base-300"}
                                fillOpacity={lv ? op[lv] : 1}>
                                <title>{`${d.date}: ${d.users} active ${d.users === 1 ? "user" : "users"}`}</title>
                            </rect>
                        );
                    })}
                </svg>
            </div>
            <div className="mt-2 flex items-center justify-end gap-1.5 text-xs text-base-content/70">
                Less
                {[0, 1, 2, 3, 4].map((l) => (
                    <svg key={l} width={C} height={C} viewBox={`0 0 ${C} ${C}`}>
                        <rect width={C} height={C} rx="3" className={l ? "fill-primary" : "fill-base-300"} fillOpacity={l ? op[l] : 1} />
                    </svg>
                ))}
                More
            </div>
        </div>
    );
}

// Half-circle gauge with scale ticks and a knob.
function GaugeChart({ value, max = 0.5, label }) {
    const R = 80;
    const len = Math.PI * R;
    const frac = Math.max(0, Math.min(1, value / max));
    const a = Math.PI * (1 - frac);
    const arc = "M 20 100 A 80 80 0 0 1 180 100";
    return (
        <svg viewBox="-10 0 220 118" className="w-full max-w-[280px]" role="img" aria-label={`${label} ${Math.round(value * 100)} percent`}>
            <path d={arc} fill="none" strokeWidth="14" strokeLinecap="round" className="stroke-base-300" />
            <path d={arc} fill="none" strokeWidth="14" strokeLinecap="round" className="stroke-primary" strokeDasharray={`${frac * len} ${len}`} />
            {[0, 0.1, 0.2, 0.5].map((t) => {
                const ta = Math.PI * (1 - t / max);
                const px = (r) => 100 + r * Math.cos(ta);
                const py = (r) => 100 - r * Math.sin(ta);
                return (
                    <g key={t}>
                        <line x1={px(64)} y1={py(64)} x2={px(70)} y2={py(70)} className="stroke-base-content" strokeOpacity="0.4" />
                        <text x={px(95)} y={py(95) + 3} textAnchor="middle" fontSize="9" className="fill-base-content" fillOpacity="0.7">
                            {Math.round(t * 100)}%
                        </text>
                    </g>
                );
            })}
            <circle cx={100 + R * Math.cos(a)} cy={100 - R * Math.sin(a)} r="7" className="fill-base-200 stroke-primary" strokeWidth="3" />
            <text x="100" y="92" textAnchor="middle" fontSize="28" fontWeight="600" className="fill-base-content">
                {Math.round(value * 100)}%
            </text>
            <text x="100" y="110" textAnchor="middle" fontSize="10" className="fill-base-content" fillOpacity="0.7">
                {label}
            </text>
        </svg>
    );
}

// Concentric progress rings, outermost first.
function Rings({ rings }) {
    const radii = [58, 47, 36, 25];
    const SW = 7;
    return (
        <svg viewBox="0 0 132 132" className="size-32 shrink-0 -rotate-90" fill="none" strokeWidth={SW} aria-hidden="true">
            {rings.map((g, i) => {
                const r = radii[i];
                const c = 2 * Math.PI * r;
                return (
                    <g key={g.label}>
                        <circle cx="66" cy="66" r={r} className="stroke-base-300" />
                        <circle cx="66" cy="66" r={r} className={g.stroke} strokeLinecap="round" strokeDasharray={`${(c * Math.max(0, Math.min(100, g.value))) / 100} ${c}`} />
                    </g>
                );
            })}
        </svg>
    );
}

// Tapered funnel: each stage narrows to the next, with conversion and drop-off.
function Funnel({ stages }) {
    const top = Math.max(stages[0].value, 1);
    return (
        <ul className="space-y-1 p-4">
            {stages.map((s, i) => {
                const w = (s.value / top) * 100;
                const next = stages[i + 1] ? (stages[i + 1].value / top) * 100 : w * 0.8;
                const prev = i ? stages[i - 1].value : null;
                return (
                    <li key={s.label} className="grid grid-cols-[7.5rem_minmax(0,1fr)_6.5rem] items-center gap-3">
                        <span className="truncate text-sm">{s.label}</span>
                        <svg viewBox="0 0 100 36" preserveAspectRatio="none" className="h-9 w-full" aria-hidden="true">
                            <polygon points={`${(100 - w) / 2},0 ${(100 + w) / 2},0 ${(100 + next) / 2},36 ${(100 - next) / 2},36`} className="fill-primary" fillOpacity={1 - i * 0.16} />
                        </svg>
                        <span className="text-right">
                            <span className="text-sm font-semibold tabular-nums">{s.value}</span>
                            <span className="block text-xs tabular-nums text-base-content/65">{prev == null ? "100%" : `${pct(s.value, prev)}%${prev > s.value ? ` · -${prev - s.value}` : ""}`}</span>
                        </span>
                    </li>
                );
            })}
        </ul>
    );
}

// Only two accents: red = already expired, amber = ends within 7 days. Everything else stays neutral.
const EXP_TONE = {
    expired: { text: "text-error", bg: "bg-error" },
    soon: { text: "text-warning", bg: "bg-warning" },
    later: { text: "text-base-content/70", bg: "bg-base-content/40" },
};
const expBand = (d) => (d == null ? "expired" : d <= 7 ? "soon" : "later");

const EXTEND_OPTS = [
    [7, "7 days"],
    [30, "30 days"],
    [90, "90 days"],
    [365, "1 year"],
];

// Split-style button with a duration menu. Extending adds time on top of what is left.
function ExtendMenu({ label = "Extend", title = "Extend by", onPick, onCustom, primary = false }) {
    const MENU_W = 188;
    const { open, setOpen, btnRef, menuRef, pos, toggle } = useAnchoredMenu(MENU_W);
    return (
        <>
            <button
                ref={btnRef}
                type="button"
                onClick={toggle}
                aria-haspopup="menu"
                aria-expanded={open}
                className={`btn btn-sm gap-1 rounded-md ${primary ? "btn-primary border-none" : "border border-base-300 bg-transparent"}`}>
                {label}
                <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
            {open &&
                createPortal(
                    <div ref={menuRef} role="menu" style={{ position: "fixed", ...pos, zIndex: 99999, width: MENU_W }} className="rounded-md border border-base-300 bg-base-200 p-1 shadow-2xl">
                        <p className="px-3 pb-1 pt-2 text-xs text-base-content/70">{title}</p>
                        {EXTEND_OPTS.map(([days, l]) => (
                            <button
                                key={days}
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                    onPick(days, l);
                                    setOpen(false);
                                }}
                                className="flex w-full cursor-pointer items-center rounded-md border-none bg-transparent px-3 py-2 text-sm font-medium text-base-content transition-colors hover:bg-base-300">
                                + {l}
                            </button>
                        ))}
                        {onCustom && (
                            <>
                                <div className="my-1 border-t border-base-300" />
                                <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => {
                                        onCustom();
                                        setOpen(false);
                                    }}
                                    className="flex w-full cursor-pointer items-center rounded-md border-none bg-transparent px-3 py-2 text-sm font-medium text-base-content transition-colors hover:bg-base-300">
                                    Custom date…
                                </button>
                            </>
                        )}
                    </div>,
                    document.body,
                )}
        </>
    );
}

function SegDonut({ segments }) {
    const total = segments.reduce((s, x) => s + x.value, 0) || 1;
    const GAP = 1.2;
    let acc = 0;
    return (
        <svg viewBox="0 0 36 36" className="size-24 shrink-0 -rotate-90" fill="none" strokeWidth="4.5" aria-hidden="true">
            <circle cx="18" cy="18" r="15.9155" className="stroke-base-300" />
            {segments.map((s) => {
                const len = (s.value / total) * 100;
                const dash = Math.max(len - GAP, 0);
                const el = <circle key={s.label} cx="18" cy="18" r="15.9155" className={s.stroke} strokeDasharray={`${dash} ${100 - dash}`} strokeDashoffset={-acc} />;
                acc += len;
                return el;
            })}
        </svg>
    );
}

function StackBar({ segments, fmt = (v) => v }) {
    const total = segments.reduce((s, x) => s + x.value, 0);
    return (
        <div>
            <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-base-300">
                {total > 0 && segments.filter((s) => s.value > 0).map((s) => <div key={s.label} className={s.cls} style={{ flex: s.value }} />)}
            </div>
            <div className="mt-3 space-y-2">
                {segments.map((s) => (
                    <div key={s.label} className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 text-base-content">
                            <span className={`size-2 rounded-sm ${s.cls}`} />
                            {s.label}
                        </span>
                        <span className="font-medium tabular-nums">{fmt(s.value)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ─── Insights (user related only) ─────────────────────────────────────────────

function Insights({ ins, usage, usageState, state, onRetry, onRetryUsage, onExtend, onExtendBy }) {
    const [exFilter, setExFilter] = useState("all");
    const [exAll, setExAll] = useState(false);
    const [exSel, setExSel] = useState(() => new Set());
    const loadingU = usageState === "loading";
    const wait = (ok, node, icon, text) => (loadingU ? <Skeleton className="h-28 w-full" /> : ok ? node : <Empty icon={icon} text={text} />);

    const dau = usage?.dau ?? [];
    const avg7 = dau.map((_, i) => {
        const w = dau.slice(Math.max(0, i - 6), i + 1);
        return sum(w) / w.length;
    });
    const cal = usage?.calendar ?? [];
    const calActive = cal.filter((d) => d.users > 0).length;
    const calPeak = cal.reduce((a, d) => (d.users > a.users ? d : a), cal[0] ?? { users: 0, date: "" });
    const avgDau = dau.length ? sum(dau) / dau.length : 0;
    const mau = usage?.activeMonth ?? 0;
    const stick = mau > 0 && avgDau > 0 ? Math.min(1, avgDau / mau) : null;
    const stickLabel = stick == null ? "" : stick >= 0.2 ? "Strong" : stick >= 0.1 ? "Healthy" : "Low";
    const stickTone = stick == null ? "" : stick >= 0.2 ? "text-success" : stick >= 0.1 ? "text-info" : "text-warning";

    const devices = usage?.devices ?? [];
    const devTotal = sum(devices.map((d) => d.value));
    const top = usage?.topViewers ?? [];

    const approved = ins?.counts.approved ?? 0;
    const rings = ins
        ? [
              { label: "Email verified", value: pct(ins.verified, ins.total), stroke: "stroke-success", bg: "bg-success", sub: `${ins.verified} of ${ins.total} users` },
              { label: "Approved", value: pct(approved, ins.total), stroke: "stroke-primary", bg: "bg-primary", sub: `${approved} of ${ins.total} users` },
              { label: "Active in 7 days", value: pct(ins.active7, approved), stroke: "stroke-info", bg: "bg-info", sub: `${ins.active7} of ${approved} approved` },
              {
                  label: "Permanent access",
                  value: pct(ins.access.permanent, approved),
                  stroke: "stroke-base-content/50",
                  bg: "bg-base-content/50",
                  sub: `${ins.access.permanent} of ${approved} approved`,
              },
          ]
        : [];
    const statusSegs = ins
        ? [
              { label: "Approved", value: ins.counts.approved, stroke: "stroke-success", bg: "bg-success" },
              { label: "Pending", value: ins.counts.pending, stroke: "stroke-warning", bg: "bg-warning" },
              { label: "Blocked", value: ins.counts.blocked, stroke: "stroke-error", bg: "bg-error" },
              { label: "Rejected", value: ins.counts.rejected, stroke: "stroke-base-content/40", bg: "bg-base-content/40" },
          ]
        : [];

    return (
        <section className="space-y-4">
            <SectionLabel>
                User insights <span className="font-normal text-base-content/65">growth, engagement, access and devices</span>
            </SectionLabel>

            {usageState === "error" && (
                <div className="flex items-center gap-3 rounded-lg border border-base-300 bg-base-200 px-4 py-3">
                    <AlertTriangle size={16} className="text-warning" />
                    <p className="flex-1 text-sm text-base-content/85">User activity could not be loaded. Account stats below still work.</p>
                    <button type="button" onClick={onRetryUsage} className="btn btn-xs rounded-md border-none bg-base-300">
                        Retry
                    </button>
                </div>
            )}

            {state === "error" ? (
                <div className="flex items-center gap-3 rounded-lg border border-base-300 bg-base-200 px-4 py-3">
                    <AlertTriangle size={16} className="text-error" />
                    <p className="flex-1 text-sm text-base-content/85">Couldn’t load account insights.</p>
                    <button type="button" onClick={onRetry} className="btn btn-xs rounded-md border-none bg-base-300">
                        Retry
                    </button>
                </div>
            ) : !ins ? (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                        <div key={i} className={`space-y-4 rounded-lg border border-base-300 bg-base-200 p-4 ${i % 3 === 0 ? "lg:col-span-2" : ""}`}>
                            <Skeleton className="h-4 w-32" />
                            <Skeleton className="h-32 w-full" />
                        </div>
                    ))}
                </div>
            ) : (
                <>
                    <div className="overflow-hidden rounded-lg border border-base-300">
                        <Kpis
                            first
                            items={[
                                { label: "Email verified", value: `${pct(ins.verified, ins.total)}%`, sub: `${ins.total - ins.verified} unverified` },
                                { label: "Dormant accounts", value: ins.hasSeen ? ins.dormant : "—", sub: "approved, no sign-in in 30 days" },
                                { label: "Avg devices per user", value: ins.avgDevices ? ins.avgDevices.toFixed(1) : "—", sub: `${ins.devices} signed in in total` },
                                { label: "Signups this week", value: ins.newWeek, sub: `${ins.prevWeek} the week before` },
                            ]}
                        />
                    </div>

                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                        <Panel
                            title="Account growth"
                            icon={TrendingUp}
                            className="lg:col-span-2"
                            right={
                                <span className="text-xs tabular-nums text-base-content/65">
                                    {ins.total} total · +{sum(ins.signups)} in 30 days
                                </span>
                            }>
                            <div className="p-4">
                                <ComboChart dates={ins.growthDates} bars={ins.signups} line={ins.cum} />
                            </div>
                        </Panel>

                        <Panel title="Account health" icon={ShieldCheck} right={<span className="text-xs text-base-content/65">share of accounts</span>}>
                            <div className="flex flex-1 items-center gap-4 p-4">
                                <Rings rings={rings} />
                                <ul className="min-w-0 flex-1 space-y-2.5">
                                    {rings.map((g) => (
                                        <li key={g.label} title={g.sub}>
                                            <div className="flex items-center justify-between gap-2 text-sm">
                                                <span className="flex min-w-0 items-center gap-2">
                                                    <span className={`size-2 shrink-0 rounded-sm ${g.bg}`} />
                                                    <span className="truncate">{g.label}</span>
                                                </span>
                                                <span className="font-semibold tabular-nums">{g.value}%</span>
                                            </div>
                                            <p className="truncate pl-4 text-xs text-base-content/65">{g.sub}</p>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </Panel>

                        <Panel
                            title="Daily active users"
                            icon={Calendar}
                            className="lg:col-span-2"
                            right={
                                dau.length ? (
                                    <span className="text-xs tabular-nums text-base-content/65">Avg {Math.round(avgDau * 10) / 10} per day · 30 days</span>
                                ) : (
                                    <span className="text-xs text-base-content/65">30 days</span>
                                )
                            }>
                            <div className="p-4">
                                {wait(
                                    sum(dau) > 0,
                                    <AreaChart dates={usage?.dauDates ?? []} values={dau} overlay={avg7} unit={(v) => `${v} active`} />,
                                    Calendar,
                                    "Daily activity appears once people start watching.",
                                )}
                            </div>
                        </Panel>

                        <Panel title="Stickiness" icon={Gauge} right={<span className="text-xs text-base-content/65">daily ÷ monthly active</span>}>
                            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4">
                                {loadingU ? (
                                    <Skeleton className="h-28 w-full" />
                                ) : stick != null ? (
                                    <>
                                        <GaugeChart value={stick} label="DAU / MAU" />
                                        <p className="text-center text-xs text-base-content/75">
                                            <span className={`font-semibold ${stickTone}`}>{stickLabel}</span> · {Math.round(avgDau * 10) / 10} daily vs {mau} monthly active users
                                        </p>
                                    </>
                                ) : (
                                    <Empty icon={Gauge} text="Needs a few days of activity to calculate." />
                                )}
                            </div>
                        </Panel>

                        <Panel
                            title="Registration funnel"
                            icon={Filter}
                            className="lg:col-span-2"
                            right={<span className="text-xs text-base-content/65">{ins.hasSeen ? "conversion from the previous stage" : "activity data not available"}</span>}>
                            <Funnel stages={ins.funnel} />
                        </Panel>

                        <Panel title="Account status" icon={Users} right={<span className="text-xs text-base-content/65">{ins.total} users</span>}>
                            <div className="flex flex-1 items-center gap-5 p-4">
                                <div className="relative shrink-0">
                                    <SegDonut segments={statusSegs} />
                                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                                        <span className="text-lg font-semibold leading-none tabular-nums">{ins.total}</span>
                                        <span className="mt-0.5 text-xs text-base-content/65">users</span>
                                    </div>
                                </div>
                                <ul className="min-w-0 flex-1 space-y-2 text-sm">
                                    {statusSegs.map((g) => (
                                        <li key={g.label} className="flex items-center justify-between gap-2">
                                            <span className="flex items-center gap-2">
                                                <span className={`size-2 shrink-0 rounded-sm ${g.bg}`} />
                                                {g.label}
                                            </span>
                                            <span className="tabular-nums text-base-content/80">
                                                {g.value} · {pct(g.value, ins.total)}%
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </Panel>

                        <Panel
                            title="Activity heatmap"
                            icon={LayoutGrid}
                            className="lg:col-span-2"
                            right={<span className="text-xs text-base-content/65">daily active users{cal.length ? ` · ${cal.length} days` : ""}</span>}>
                            {loadingU ? (
                                <div className="p-4">
                                    <Skeleton className="h-28 w-full" />
                                </div>
                            ) : calActive > 0 ? (
                                <>
                                    <div className="p-4">
                                        <Heatmap days={cal} />
                                    </div>
                                    <div className="mt-auto">
                                        <Kpis
                                            cols="lg:grid-cols-3"
                                            items={[
                                                { label: "Active days", value: calActive, sub: `of the last ${cal.length}` },
                                                {
                                                    label: "Busiest day",
                                                    value: `${calPeak.users} users`,
                                                    sub: calPeak.date ? ordinalDay(calPeak.date).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "",
                                                },
                                                { label: "Daily average", value: Math.round((sum(cal.map((d) => d.users)) / cal.length) * 10) / 10, sub: "active users" },
                                            ]}
                                        />
                                    </div>
                                </>
                            ) : (
                                <Empty icon={LayoutGrid} text="Daily activity appears here once people start watching." />
                            )}
                        </Panel>

                        <Panel title="Approval queue" icon={Inbox} right={<span className="text-xs text-base-content/65">{ins.counts.pending} waiting</span>}>
                            {ins.counts.pending === 0 ? (
                                <Empty icon={CheckCircle} text="Queue is empty. Nobody is waiting for approval." />
                            ) : (
                                <div className="flex flex-1 flex-col justify-between gap-3 p-4">
                                    <div className="space-y-3">
                                        {ins.pendingAge.map((b) => (
                                            <div key={b.label}>
                                                <div className="mb-1.5 flex items-center justify-between text-sm">
                                                    <span>{b.label}</span>
                                                    <span className="font-medium tabular-nums">{b.value}</span>
                                                </div>
                                                <Bar value={pct(b.value, ins.counts.pending)} tone={b.cls} />
                                            </div>
                                        ))}
                                    </div>
                                    <p className="text-xs text-base-content/70">
                                        {ins.oldestPending ? `Oldest request ${relLong(ins.oldestPending)}` : ""}
                                        {ins.pendingVerified.length > 0 ? ` · ${ins.pendingVerified.length} verified` : ""}
                                    </p>
                                </div>
                            )}
                        </Panel>

                        {(() => {
                            const COLS = "grid-cols-[1.25rem_minmax(0,1fr)_auto] sm:grid-cols-[1.25rem_minmax(0,1fr)_4.5rem_10rem_5.5rem_6rem]";
                            const seenOf = (u) => getPresence(u, ins.presence).lastSeen;
                            const expired = ins.expiredUsers;
                            const exp = ins.expiring;
                            const near = exp.filter(({ d }) => d <= 7);
                            const mid = exp.filter(({ d }) => d > 7 && d <= 30);
                            const later = exp.filter(({ d }) => d > 30);
                            const expRows = expired.map((u) => ({ u, d: null }));
                            const all = [...expRows, ...near, ...mid, ...later];
                            const tabs = [
                                ["all", "All", all.length],
                                ["expired", "Expired", expRows.length],
                                ["soon", "Within 7 days", near.length],
                                ["month", "8–30 days", mid.length],
                                ["later", "Later", later.length],
                            ];
                            const rows = { all, expired: expRows, soon: near, month: mid, later }[exFilter] ?? all;
                            const shown = exAll ? rows : rows.slice(0, 5);
                            const urgent = [...expired, ...near.map(({ u }) => u)];
                            const sel = all.filter(({ u }) => exSel.has(u.id)).map(({ u }) => u);
                            const shownOn = shown.length > 0 && shown.every(({ u }) => exSel.has(u.id));
                            const clearSel = () => setExSel(new Set());
                            const toggleOne = (id) =>
                                setExSel((prev) => {
                                    const n = new Set(prev);
                                    n.has(id) ? n.delete(id) : n.add(id);
                                    return n;
                                });
                            const toggleShown = () =>
                                setExSel((prev) => {
                                    const n = new Set(prev);
                                    shown.forEach(({ u }) => (shownOn ? n.delete(u.id) : n.add(u.id)));
                                    return n;
                                });

                            return (
                                <Panel
                                    title="Access renewals"
                                    icon={Hourglass}
                                    className="lg:col-span-2"
                                    right={
                                        sel.length > 0 ? (
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs tabular-nums text-base-content/70">{sel.length} selected</span>
                                                <button type="button" onClick={clearSel} className="btn btn-sm btn-ghost rounded-md">
                                                    Clear
                                                </button>
                                                <ExtendMenu primary title="Extend selected by" onPick={(days, label) => onExtendBy(sel, days, label, clearSel)} />
                                            </div>
                                        ) : urgent.length > 0 ? (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setExFilter("all");
                                                    setExAll(true);
                                                    setExSel(new Set(urgent.map((u) => u.id)));
                                                }}
                                                className="btn btn-sm rounded-md border border-base-300 bg-transparent">
                                                Select urgent ({urgent.length})
                                            </button>
                                        ) : null
                                    }>
                                    {all.length === 0 ? (
                                        <Empty icon={Hourglass} text="No time-limited accounts yet. Accounts with an expiry date show up here." />
                                    ) : (
                                        <>
                                            <div
                                                role="tablist"
                                                aria-label="Filter renewals"
                                                className="flex gap-1 overflow-x-auto border-b border-base-300 px-4 py-2"
                                                style={{ scrollbarWidth: "none" }}>
                                                {tabs.map(([key, label, n]) => {
                                                    const on = exFilter === key;
                                                    return (
                                                        <button
                                                            key={key}
                                                            type="button"
                                                            role="tab"
                                                            aria-selected={on}
                                                            onClick={() => {
                                                                setExFilter(key);
                                                                setExAll(false);
                                                            }}
                                                            className={`flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border-none px-2.5 py-1.5 text-xs font-medium transition-colors ${
                                                                on ? "bg-base-300 text-base-content" : "bg-transparent text-base-content/65 hover:bg-base-300/60 hover:text-base-content"
                                                            }`}>
                                                            {label}
                                                            <span className={`tabular-nums font-normal ${key === "expired" && n > 0 ? "text-error" : "text-base-content/60"}`}>{n}</span>
                                                        </button>
                                                    );
                                                })}
                                            </div>

                                            <div className={`hidden items-center gap-3 border-b border-base-300 bg-base-200 px-4 py-2 text-xs font-medium text-base-content/65 sm:grid ${COLS}`}>
                                                <input
                                                    type="checkbox"
                                                    className="checkbox checkbox-xs checkbox-primary"
                                                    checked={shownOn}
                                                    onChange={toggleShown}
                                                    aria-label="Select all listed accounts"
                                                    disabled={!shown.length}
                                                />
                                                <span>Account</span>
                                                <span>Expires</span>
                                                <span>Remaining</span>
                                                <span>Last seen</span>
                                                <span />
                                            </div>

                                            {rows.length > 0 ? (
                                                <ul className="divide-y divide-base-300">
                                                    {shown.map(({ u, d }) => {
                                                        const t = EXP_TONE[expBand(d)];
                                                        const isSel = exSel.has(u.id);
                                                        const remain = d == null ? `Expired ${relLong(u.accessExpiresAt)}` : d === 0 ? "Today" : `${d} day${d === 1 ? "" : "s"}`;
                                                        const seen = seenOf(u);
                                                        return (
                                                            <li
                                                                key={u.id}
                                                                className={`grid items-center gap-3 px-4 py-2.5 transition-colors ${COLS} ${isSel ? "bg-base-300/70" : "hover:bg-base-300/40"}`}>
                                                                <input
                                                                    type="checkbox"
                                                                    className="checkbox checkbox-xs checkbox-primary"
                                                                    checked={isSel}
                                                                    onChange={() => toggleOne(u.id)}
                                                                    aria-label={`Select ${u.name || u.email}`}
                                                                />
                                                                <div className="min-w-0">
                                                                    <p className="truncate text-sm font-medium">{u.name || u.email}</p>
                                                                    <p className="truncate text-xs text-base-content/70">{u.email}</p>
                                                                    <p className={`text-xs font-medium tabular-nums sm:hidden ${t.text}`}>
                                                                        {remain} · {fmtDateShort(u.accessExpiresAt)}
                                                                    </p>
                                                                </div>
                                                                <span className="hidden text-sm tabular-nums text-base-content/80 sm:block">{fmtDateShort(u.accessExpiresAt)}</span>
                                                                <span className={`hidden truncate text-sm font-medium tabular-nums sm:block ${t.text}`}>{remain}</span>
                                                                <span className="hidden truncate text-sm tabular-nums text-base-content/70 sm:block">{seen ? relShort(seen) : "Never"}</span>
                                                                <div className="flex justify-end">
                                                                    <ExtendMenu
                                                                        label={d == null ? "Renew" : "Extend"}
                                                                        title={d == null ? "Renew for" : "Extend by"}
                                                                        onPick={(days, label) => onExtendBy([u], days, label, clearSel)}
                                                                        onCustom={() => onExtend(u)}
                                                                    />
                                                                </div>
                                                            </li>
                                                        );
                                                    })}
                                                </ul>
                                            ) : (
                                                <p className="px-4 py-10 text-center text-sm text-base-content/70">No accounts in this group.</p>
                                            )}

                                            {rows.length > 5 && (
                                                <button
                                                    type="button"
                                                    onClick={() => setExAll((v) => !v)}
                                                    className="w-full cursor-pointer border-0 border-t border-base-300 bg-transparent px-4 py-2.5 text-xs font-medium text-primary transition-colors hover:bg-base-300/50">
                                                    {exAll ? "Show less" : `Show ${rows.length - 5} more`}
                                                </button>
                                            )}
                                        </>
                                    )}
                                </Panel>
                            );
                        })()}

                        <Panel title="Access outlook" icon={Clock} className="lg:self-start" right={<span className="text-xs text-base-content/65">approved accounts</span>}>
                            <div className="flex flex-1 flex-col justify-between gap-4 p-4">
                                <StackBar
                                    segments={[
                                        { label: "Permanent", value: ins.access.permanent, cls: "bg-success" },
                                        { label: "Time limited", value: ins.access.limited, cls: "bg-info" },
                                        { label: "Ending within 7 days", value: ins.access.ending7, cls: "bg-warning" },
                                        { label: "Expired", value: ins.access.expired, cls: "bg-error" },
                                    ]}
                                />
                                {(() => {
                                    const wk = [
                                        ["This week", 1, 7],
                                        ["Next week", 8, 14],
                                        ["In 3 weeks", 15, 21],
                                        ["In 4 weeks", 22, 30],
                                    ].map(([label, a, b]) => ({ label, value: ins.expiring.filter(({ d }) => d >= a && d <= b).length }));
                                    const mx = Math.max(...wk.map((w) => w.value), 1);
                                    return (
                                        <div>
                                            <p className="mb-2 text-xs text-base-content/70">Expiries by week</p>
                                            <ul className="space-y-2">
                                                {wk.map((w) => (
                                                    <li key={w.label} className="grid grid-cols-[5.5rem_minmax(0,1fr)_1.5rem] items-center gap-2">
                                                        <span className="text-xs text-base-content/80">{w.label}</span>
                                                        <Bar value={(w.value / mx) * 100} tone="bg-base-content/45" />
                                                        <span className="text-right text-xs tabular-nums">{w.value}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    );
                                })()}
                                <div className="space-y-2 border-t border-base-300 pt-3 text-xs">
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="text-base-content/70">Next to expire</span>
                                        <span className="truncate font-medium">{ins.expiring[0] ? `${ins.expiring[0].u.name || ins.expiring[0].u.email} · ${ins.expiring[0].d}d` : "—"}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="text-base-content/70">Average time left</span>
                                        <span className="font-medium tabular-nums">{ins.expiring.length ? `${Math.round(sum(ins.expiring.map((x) => x.d)) / ins.expiring.length)} days` : "—"}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="text-base-content/70">Permanent share</span>
                                        <span className="font-medium tabular-nums">{pct(ins.access.permanent, ins.counts.approved)}%</span>
                                    </div>
                                </div>
                            </div>
                        </Panel>

                        <Panel
                            title="Devices per user"
                            icon={Tv}
                            right={<span className="text-xs text-base-content/65">{ins.avgDevices ? `${ins.avgDevices.toFixed(1)} avg` : "signed-in devices"}</span>}>
                            <div className="p-4">
                                <ColumnChart data={ins.devHist} labels={["0", "1", "2", "3", "4+"]} unit={(v) => `${v} users`} />
                            </div>
                        </Panel>

                        <Panel title="Device types" icon={Tv} right={<span className="text-xs text-base-content/65">signed-in sessions</span>}>
                            <div className="flex flex-1 items-center p-4">
                                {loadingU ? (
                                    <Skeleton className="h-28 w-full" />
                                ) : devTotal > 0 ? (
                                    <div className="flex w-full items-center gap-5">
                                        <SegDonut segments={devices} />
                                        <div className="min-w-0 flex-1 space-y-2 text-sm">
                                            {devices.map((d) => (
                                                <div key={d.label} className="flex items-center justify-between gap-3">
                                                    <span className="flex items-center gap-2 truncate">
                                                        <span className={`size-2 shrink-0 rounded-sm ${d.bg}`} />
                                                        {d.label}
                                                    </span>
                                                    <span className="tabular-nums text-base-content/80">
                                                        {d.value} · {pct(d.value, devTotal)}%
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <Empty icon={Tv} text="No signed-in devices yet." />
                                )}
                            </div>
                        </Panel>

                        <Panel title="Most active users" icon={Trophy} right={<span className="text-xs text-base-content/65">hours this week</span>}>
                            {loadingU ? (
                                <div className="p-4">
                                    <Skeleton className="h-28 w-full" />
                                </div>
                            ) : top.length ? (
                                <ul className="flex flex-1 flex-col justify-around gap-3 p-4">
                                    {top.slice(0, 5).map((v, i) => (
                                        <li key={v.id ?? v.label}>
                                            <div className="mb-1.5 flex items-center justify-between gap-3">
                                                <span className="truncate text-sm font-medium">{v.label}</span>
                                                <span className="text-xs tabular-nums">{fmtHours(v.value)}</span>
                                            </div>
                                            <Bar value={(v.value / top[0].value) * 100} tone={i === 0 ? "bg-primary" : "bg-base-content/35"} />
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <Empty icon={Trophy} text="No one has watched anything in the last 7 days." />
                            )}
                        </Panel>
                    </div>
                </>
            )}
        </section>
    );
}

// ─── Stat strip (user related only) ───────────────────────────────────────────

function StatStrip({ ins, usage }) {
    let cells = null;
    if (ins) {
        cells = [
            { label: "Total accounts", value: ins.total, spark: ins.cum, sparkCls: "text-primary", sub: `+${ins.newWeek} this week`, subCls: "text-success" },
            { label: "Online now", value: ins.online, dot: ins.online > 0, sub: `${ins.devices} device${ins.devices === 1 ? "" : "s"} signed in` },
            {
                label: "Active this week",
                value: usage ? usage.activeWeek : "—",
                spark: usage?.dau?.slice(-14),
                sparkCls: "text-primary",
                sub: usage ? `${pct(usage.activeWeek, ins.total)}% of accounts · ${usage.activeToday} today` : "No activity data yet",
            },
            {
                label: "Needs attention",
                value: ins.attention,
                tone: ins.attention ? "text-warning" : "",
                sub: ins.attention ? `${ins.counts.pending} pending · ${ins.ending} ending` : "All clear",
            },
        ];
    }

    return (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-base-300 bg-base-300 lg:grid-cols-4">
            {cells
                ? cells.map((c) => (
                      <div key={c.label} className="min-w-0 bg-base-200 px-4 py-3">
                          <p className="text-xs text-base-content/75">{c.label}</p>
                          <div className="mt-0.5 flex items-center justify-between gap-3">
                              <p className={`flex items-center gap-2 text-lg font-semibold leading-tight tabular-nums ${c.tone || ""}`}>
                                  {c.dot && <Dot />}
                                  {c.value}
                              </p>
                              {c.spark && <Sparkline data={c.spark} className={c.sparkCls} />}
                          </div>
                          <p className={`truncate text-xs ${c.subCls || "text-base-content/65"}`}>{c.sub}</p>
                      </div>
                  ))
                : Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="space-y-2 bg-base-200 px-4 py-3">
                          <Skeleton className="h-3 w-20" />
                          <Skeleton className="h-5 w-12" />
                          <Skeleton className="h-3 w-24" />
                      </div>
                  ))}
        </div>
    );
}

function TableSkeleton() {
    return (
        <div>
            {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-6 border-b border-base-300 px-4 py-3">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                        <Skeleton className="size-8 shrink-0 rounded-full" />
                        <div className="flex-1 space-y-1.5">
                            <Skeleton className="h-3.5 w-36" />
                            <Skeleton className="h-2.5 w-48" />
                        </div>
                    </div>
                    <Skeleton className="h-6 w-20" />
                    <Skeleton className="hidden h-8 w-20 sm:block" />
                    <Skeleton className="hidden h-8 w-20 sm:block" />
                    <div className="ml-auto flex gap-1.5">
                        <Skeleton className="size-8" />
                        <Skeleton className="size-8" />
                        <Skeleton className="size-8" />
                    </div>
                </div>
            ))}
        </div>
    );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ hasFilter, onClear }) {
    return (
        <div className="flex flex-col items-center justify-center px-4 py-14 text-center">
            <div className="mb-3 flex size-12 items-center justify-center rounded-lg bg-base-300">
                <Users size={20} className="text-base-content/60" />
            </div>
            <p className="text-sm font-medium text-base-content">{hasFilter ? "No users match your filters" : "No users found"}</p>
            <p className="mt-1 max-w-xs text-xs text-base-content/70">{hasFilter ? "Try adjusting your search or clearing the active filters." : "Users will appear here once they register."}</p>
            {hasFilter && (
                <button onClick={onClear} className="btn btn-sm btn-primary mt-4 rounded-md border-none">
                    Clear filters
                </button>
            )}
        </div>
    );
}

// ─── Pagination (footer) ──────────────────────────────────────────────────────

function Pagination({ page, pages, total, limit, shown, filtered, onPage }) {
    const from = total === 0 ? 0 : (page - 1) * limit + 1;
    const to = Math.min(page * limit, total);

    const makePages = () => {
        if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
        const delta = 2;
        const range = [];
        for (let i = 1; i <= pages; i++) {
            if (i === 1 || i === pages || (i >= page - delta && i <= page + delta)) range.push(i);
            else if (range[range.length - 1] !== "...") range.push("...");
        }
        return range;
    };

    return (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-base-300 px-4 py-3">
            <p className="text-xs tabular-nums text-base-content/70">
                {filtered ? (
                    <>
                        <span className="font-medium text-base-content">{shown}</span> matching on this page
                    </>
                ) : (
                    <>
                        Showing {from}–{to} of {total}
                    </>
                )}
            </p>
            {pages > 1 && (
                <div className="flex items-center gap-1.5">
                    <button onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page" className={`${ICON_BTN} disabled:cursor-not-allowed disabled:opacity-30`}>
                        <ChevronLeft size={15} />
                    </button>

                    {makePages().map((p, i) =>
                        p === "..." ? (
                            <span key={`dots-${i}`} className="flex size-8 items-center justify-center text-xs text-base-content/60">
                                …
                            </span>
                        ) : (
                            <button
                                key={p}
                                onClick={() => onPage(p)}
                                className={`size-8 cursor-pointer rounded-md border-none text-xs font-medium transition-colors
                                    ${page === p ? "bg-primary text-primary-content" : "bg-transparent text-base-content/80 hover:bg-base-300 hover:text-base-content"}`}>
                                {p}
                            </button>
                        ),
                    )}

                    <button onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page" className={`${ICON_BTN} disabled:cursor-not-allowed disabled:opacity-30`}>
                        <ChevronRight size={15} />
                    </button>
                </div>
            )}
        </div>
    );
}

// ─── Table cells ──────────────────────────────────────────────────────────────

function PresenceCell({ user, presence }) {
    const { online, devices, lastSeen } = getPresence(user, presence);
    return (
        <div>
            <p className={`flex items-center gap-1.5 text-sm font-medium ${online ? "text-success" : "text-base-content/80"}`}>
                <span className={`size-1.5 shrink-0 rounded-full ${online ? "bg-success" : "bg-base-content/40"}`} />
                {online ? "Online" : "Offline"}
            </p>
            <p className="mt-0.5 text-xs text-base-content/65">
                {online ? (devices > 0 ? `${devices} device${devices > 1 ? "s" : ""}` : "Active now") : lastSeen ? relShort(lastSeen) : "No sessions"}
            </p>
        </div>
    );
}

function AccessCell({ user, libraries }) {
    const sub = "mt-0.5 max-w-40 truncate text-xs text-base-content/65";
    const kind = user.accessType === "temporary" ? "Time limited" : "Permanent";

    if (user.deletedAt) {
        return (
            <div>
                <span className="text-sm font-medium text-warning">Purges</span>
                <p className={`${sub} flex items-center gap-1`}>
                    <Calendar size={11} /> {fmtDateShort(user.purgeAt)}
                </p>
            </div>
        );
    }
    if (user.status === "pending") {
        return (
            <div>
                <span className="text-sm text-base-content/80">Not set</span>
                <p className={sub}>On approval</p>
            </div>
        );
    }
    if (user.status === "rejected" || user.status === "blocked") {
        return (
            <div>
                <span className="text-sm font-medium">{kind}</span>
                <p className={sub}>Revoked</p>
            </div>
        );
    }
    if (isExpired(user)) {
        return (
            <div>
                <span className="text-sm font-medium text-error">Expired</span>
                <p className={sub}>{relLong(user.accessExpiresAt)}</p>
            </div>
        );
    }
    if (user.accessType === "temporary") {
        if (!user.accessExpiresAt) return <span className="text-sm font-medium">Time limited</span>;
        const d = daysLeft(user.accessExpiresAt);
        const urgent = d <= 3;
        return (
            <div title={`Expires ${fmtDateShort(user.accessExpiresAt)}`}>
                <span className={`text-sm font-medium ${urgent ? "text-warning" : ""}`}>
                    {d} day{d === 1 ? "" : "s"} left
                </span>
                <Bar value={Math.min(100, Math.max(6, (d / 30) * 100))} tone={urgent ? "bg-warning" : "bg-success"} className="mt-1.5 w-28" />
            </div>
        );
    }
    return (
        <div>
            <span className="text-sm font-medium">Permanent</span>
            <p className={sub}>{libraryLabel(user, libraries)}</p>
        </div>
    );
}

// ─── Users table ─────────────────────────────────────────────────────────────

function UsersTable({ users, libraries, presence, selectMode, selected, onToggleSelectMode, onToggleRow, onToggleAll, onRequest, onPermission, onAction }) {
    if (!users.length) return null;
    const allSelected = users.every((u) => selected.has(u.id));
    const TH = "px-4 py-2.5 text-left font-normal";

    return (
        <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
            <table className="w-full table-auto border-collapse" style={{ minWidth: 820 }}>
                <thead>
                    <tr className="border-b border-base-300 bg-base-200 text-xs text-base-content/65">
                        {selectMode && (
                            <th className="w-10 py-2.5 pl-4 pr-0">
                                <input type="checkbox" className="checkbox checkbox-primary checkbox-sm" checked={allSelected} onChange={() => onToggleAll(users)} aria-label="Select all users" />
                            </th>
                        )}
                        {/* hover reveals the one-and-only select toggle */}
                        <th className={`${TH} group`}>
                            <div className="flex items-center gap-3">
                                <span>User</span>
                                <button
                                    onClick={onToggleSelectMode}
                                    className={`flex h-6 cursor-pointer items-center gap-1 rounded-md border-none px-2 text-xs font-medium transition-opacity focus-visible:opacity-100 focus-visible:outline-none
                                        ${selectMode ? "bg-primary text-primary-content opacity-100" : "bg-base-300 text-base-content opacity-0 hover:bg-base-100 group-hover:opacity-100"}`}>
                                    <ListChecks size={12} />
                                    {selectMode ? "Done" : "Select"}
                                </button>
                            </div>
                        </th>
                        <th className={TH}>Status</th>
                        <th className={TH}>Presence</th>
                        <th className={TH}>Access</th>
                        <th className="px-4 py-2.5 text-right font-normal">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {users.map((u) => {
                        const isSel = selected.has(u.id);
                        return (
                            <tr key={u.id} className={`border-b border-base-300 transition-colors ${isSel ? "bg-base-300" : "hover:bg-base-300/60"}`}>
                                {selectMode && (
                                    <td className="w-10 py-3 pl-4 pr-0">
                                        <input
                                            type="checkbox"
                                            className="checkbox checkbox-primary checkbox-sm"
                                            checked={isSel}
                                            onChange={() => onToggleRow(u.id)}
                                            aria-label={`Select ${u.name || u.email}`}
                                        />
                                    </td>
                                )}
                                <td className="px-4 py-3">
                                    <div className="flex items-center gap-3">
                                        <Avatar user={u} />
                                        <div className="min-w-0">
                                            <p className="flex items-center gap-1.5 text-sm font-medium">
                                                <span className="max-w-40 truncate">{u.name || "—"}</span>
                                                {u.role === "admin" && (
                                                    <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                                                        <Crown size={10} /> Admin
                                                    </span>
                                                )}
                                            </p>
                                            <p className="flex items-center gap-1 text-xs text-base-content/70">
                                                {!u.emailVerified && (
                                                    <span title="Email not verified" className="shrink-0 text-warning">
                                                        <AlertTriangle size={12} />
                                                    </span>
                                                )}
                                                <span className="max-w-44 truncate">{u.email}</span>
                                            </p>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-4 py-3">
                                    <StatusBadge status={u.deletedAt ? "deleted" : u.status} />
                                </td>
                                <td className="px-4 py-3">
                                    <PresenceCell user={u} presence={presence} />
                                </td>
                                <td className="px-4 py-3">
                                    <AccessCell user={u} libraries={libraries} />
                                </td>
                                <td className="px-4 py-3">
                                    <div className="flex items-center justify-end gap-1.5">
                                        {u.deletedAt ? (
                                            <ActionMenu user={u} onAction={onAction} />
                                        ) : u.status === "pending" ? (
                                            <>
                                                <button onClick={() => onAction(u, "approve")} className="btn btn-sm btn-primary rounded-md border-none">
                                                    Approve
                                                </button>
                                                <ActionMenu user={u} onAction={onAction} />
                                            </>
                                        ) : (
                                            <>
                                                <ActionBtn icon={UserCheck} label="Manage Access" onClick={() => onRequest(u)} />
                                                <ActionBtn icon={KeyRound} label="Permissions" onClick={() => onPermission(u)} />
                                                <ActionMenu user={u} onAction={onAction} />
                                            </>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

// ─── Confirm builders ─────────────────────────────────────────────────────────

function deleteConfirm(title, subtitle, extra) {
    return {
        title,
        subtitle,
        confirmIcon: Trash2,
        timeline: [
            { icon: LogOut, tone: "error", title: "Right now", text: "They lose access immediately." },
            { icon: Archive, tone: "warning", title: "Next 30 days", text: "Profile, watch history and preferences are kept. The user can recover the account by verifying their email." },
            { icon: Flame, tone: "error", title: "After 30 days", text: "Everything retained is permanently purged." },
        ],
        note: "Admins can’t restore the account through recovery.",
        variant: "danger",
        confirmText: "Delete user",
        ...extra,
    };
}

// Bulk confirms: "approve" | "block" | "delete" | "limit"
function bulkConfirm(key, targets, opts = {}) {
    const n = targets.length;
    const noun = `${n} user${n > 1 ? "s" : ""}`;
    if (key === "delete") {
        return deleteConfirm(`Delete ${noun}?`, `${n} selected account${n > 1 ? "s" : ""}`, { users: targets, confirmText: `Delete ${noun}` });
    }
    if (key === "limit") {
        const endsOn = new Date(Date.now() + opts.days * DAY).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
        return {
            title: opts.renew ? "Renew access" : "Set time limit",
            message: opts.renew ? `Renew access for ${noun} for ${opts.label}?` : `Limit ${noun} to ${opts.label}?`,
            details: [`New expiry date: ${endsOn}.`, opts.renew ? "Expired accounts get access back right away." : "You can extend or renew it later from the ⋮ menu."],
            variant: "info",
            confirmText: opts.renew ? "Renew access" : "Apply limit",
            users: targets,
            updates: { accessType: "temporary", accessExpiresAt: new Date(Date.now() + opts.days * DAY).toISOString() },
            doneMsg: `${noun} limited to ${opts.label}`,
        };
    }
    if (key === "extend") {
        return {
            title: "Extend access",
            message: `Extend access for ${noun} by ${opts.label}?`,
            details: ["Time already left is kept, the new time is added on top.", "Expired accounts get access back right away, counted from today."],
            variant: "info",
            confirmText: "Extend access",
            users: targets,
            updates: { accessType: "temporary" },
            updatesFor: (u) => ({
                accessType: "temporary",
                accessExpiresAt: new Date(Math.max(Date.now(), u.accessExpiresAt ? new Date(u.accessExpiresAt).getTime() : 0) + opts.days * DAY).toISOString(),
            }),
            doneMsg: `${noun} extended by ${opts.label}`,
        };
    }
    const approve = key === "approve";
    return {
        title: `${approve ? "Approve" : "Block"} ${noun}`,
        message: `${approve ? "Approve" : "Block"} ${n} ${opts.selected === false ? "" : "selected "}user${n > 1 ? "s" : ""}?`,
        details: approve ? ["They can browse and watch what you allow."] : ["They can’t browse or stream.", "Their devices stay signed in, but every request is refused."],
        variant: approve ? "info" : "warning",
        confirmText: approve ? "Approve" : "Block",
        users: targets,
        status: approve ? "approved" : "blocked",
    };
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

const LIMIT = 25;

const STATUS_TABS = [
    { v: "", label: "All" },
    { v: "pending", label: "Pending" },
    { v: "approved", label: "Approved" },
    { v: "blocked", label: "Blocked" },
    { v: "rejected", label: "Rejected" },
    { v: "deleted", label: "Pending deletion" },
];

export default function DashUsers() {
    const activity = useUsersActivity();
    const presence = activity.presence;
    const usage = activity.data;
    const usageState = activity.state;

    const [users, setUsers] = useState([]);
    const [allUsers, setAllUsers] = useState(null);
    const [insState, setInsState] = useState("loading");
    const [total, setTotal] = useState(0);
    const [pages, setPages] = useState(1);
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState("");
    const [filters, setFilters] = useState(NO_FILTERS);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [toast, setToast] = useState(null);
    const [confirm, setConfirm] = useState(null);
    const [actionLoading, setActionLoading] = useState(false);
    const [infoUser, setInfoUser] = useState(null);
    const [reqUser, setReqUser] = useState(null);
    const [permUser, setPermUser] = useState(null);
    const [libraries, setLibraries] = useState([]);
    const [lastLoaded, setLastLoaded] = useState(null);
    const [selectMode, setSelectMode] = useState(false);
    const [selected, setSelected] = useState(() => new Set());
    const [, setTick] = useState(0);
    const searchTimer = useRef(null);

    function showToast(msg, type = "success") {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 3500);
    }

    // keep "synced 2m ago" fresh
    useEffect(() => {
        const t = setInterval(() => setTick((n) => n + 1), 30000);
        return () => clearInterval(t);
    }, []);

    // load libraries once
    useEffect(() => {
        dashApi
            .libraries()
            .then((d) => setLibraries(d?.libraries ?? []))
            .catch(() => {});
    }, []);

    // load every user once (all pages) → stat strip, tab counts, banner and account mix
    const insightGen = useRef(0); // only the LATEST load may publish — a slow older one must not restore stale (e.g. pending) users
    const loadInsights = useCallback(async () => {
        const gen = ++insightGen.current;
        try {
            const first = await dashApi.users({ page: 1, limit: 100 });
            let all = first.users ?? [];
            const pgs = Math.min(first.pages ?? 1, 20);
            if (pgs > 1) {
                const rest = await Promise.all(
                    Array.from({ length: pgs - 1 }, (_, i) =>
                        dashApi
                            .users({ page: i + 2, limit: 100 })
                            .then((d) => d.users ?? [])
                            .catch(() => []),
                    ),
                );
                all = all.concat(...rest);
            }
            if (gen !== insightGen.current) return; // superseded by a newer load
            setAllUsers(all);
            setInsState("ready");
        } catch {
            if (gen !== insightGen.current) return;
            setInsState((s) => (s === "ready" ? s : "error"));
        }
    }, []);

    useEffect(() => {
        loadInsights();
    }, [loadInsights]);

    const ins = useMemo(() => (allUsers ? computeInsights(allUsers, presence) : null), [allUsers, presence]);
    const pendingTotal = ins?.counts.pending ?? 0;
    const pendingUsers = useMemo(() => (ins ? ins.pending.slice(0, 3) : []), [ins]);

    const load = useCallback(
        async (pg = 1) => {
            setLoading(true);
            setError(null);
            try {
                const p = { page: pg, limit: LIMIT };
                if (search) p.search = search;
                if (statusFilter) p.status = statusFilter;
                const d = await dashApi.users(p);
                setUsers(d.users ?? []);
                setTotal(d.total ?? 0);
                setPages(d.pages ?? 1);
                setPage(pg);
                setSelected(new Set());
                setLastLoaded(new Date());
            } catch (e) {
                setError(e.message);
            } finally {
                setLoading(false);
            }
        },
        [search, statusFilter],
    );

    // debounced search/filter
    useEffect(() => {
        clearTimeout(searchTimer.current);
        searchTimer.current = setTimeout(() => load(1), 350);
        return () => clearTimeout(searchTimer.current);
    }, [search, statusFilter, load]);

    const visibleUsers = useMemo(() => users.filter((u) => matchFilters(u, filters)), [users, filters]);
    const filtersActive = Object.values(filters).some(Boolean);

    // ── selection ───────────────────────────────────────────────────────────
    function toggleSelectMode() {
        if (selectMode) setSelected(new Set());
        setSelectMode(!selectMode);
    }
    function toggleRow(id) {
        setSelected((prev) => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    }
    function toggleAll(list) {
        setSelected((prev) => {
            const everyOn = list.every((u) => prev.has(u.id));
            const next = new Set(prev);
            list.forEach((u) => (everyOn ? next.delete(u.id) : next.add(u.id)));
            return next;
        });
    }

    // CRUD: handleSave
    async function handleSave(user, updates) {
        try {
            await dashApi.updateUser(user.id, updates);
            setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, ...updates } : u)));
            showToast(`Updated: ${user.name || user.email}`);
            load(page);
            loadInsights();
        } catch (e) {
            showToast(e.message || "Update failed", "error");
            throw e; // keeps modal open on failure
        }
    }

    // CRUD: handleAction (⋮ menu + Approve button)
    function handleAction(user, key) {
        if (key === "info") {
            setInfoUser(user);
            return;
        }
        if (key === "access") {
            setReqUser(user);
            return;
        }
        const statusMap = { approve: "approved", reject: "rejected", block: "blocked" };
        if (key === "delete") {
            setConfirm(deleteConfirm(`Delete ${user.name || user.email}?`, user.email, { user }));
            return;
        }
        if (statusMap[key]) {
            setConfirm({
                title: { approve: "Approve User", reject: "Reject User", block: "Block User" }[key],
                message: `${key.charAt(0).toUpperCase() + key.slice(1)} ${user.name || user.email}?`,
                details:
                    key === "approve"
                        ? ["They can browse and watch what you allow.", "Role and access time limit become editable after approval."]
                        : ["They can’t browse or stream.", "Their devices stay signed in, but every request is refused."],
                variant: key === "approve" ? "info" : "warning",
                confirmText: key.charAt(0).toUpperCase() + key.slice(1),
                user,
                status: statusMap[key],
            });
        }
    }

    // bulk actions (select mode)
    function handleBulk(key, opts) {
        const targets = users.filter((u) => selected.has(u.id) && !u.deletedAt);
        if (!targets.length) return;
        setConfirm(bulkConfirm(key, targets, opts));
    }
    function handleBulkExport() {
        const picked = users.filter((u) => selected.has(u.id));
        if (picked.length) exportCsv(picked);
    }

    // banner: approve every pending user whose email is verified
    function approveVerified() {
        const targets = ins?.pendingVerified ?? [];
        if (!targets.length) return;
        setConfirm(bulkConfirm("approve", targets, { selected: false }));
    }

    async function executeAction() {
        const targets = confirm?.users ?? (confirm?.user ? [confirm.user] : []);
        if (!targets.length) return;
        const updates = confirm.updates ?? (confirm.status ? { status: confirm.status } : null);
        const patchFor = (u) => (confirm.updatesFor ? confirm.updatesFor(u) : updates);
        setActionLoading(true);
        try {
            const results = await Promise.allSettled(targets.map((u) => (updates ? dashApi.updateUser(u.id, patchFor(u)) : dashApi.deleteUser(u.id))));
            const okIds = new Set(targets.filter((_, i) => results[i].status === "fulfilled").map((u) => u.id));
            const failed = results.length - okIds.size;

            if (updates) setUsers((prev) => prev.map((u) => (okIds.has(u.id) ? { ...u, ...patchFor(u) } : u)));
            else setUsers((prev) => prev.filter((u) => !okIds.has(u.id)));

            if (failed === results.length) {
                showToast(results[0].reason?.message || "Action failed", "error");
            } else if (failed > 0) {
                showToast(`${okIds.size} done, ${failed} failed`, "error");
            } else if (updates) {
                showToast(confirm.doneMsg ?? (targets.length > 1 ? `${okIds.size} users updated` : `${confirm.title.replace("?", "")} done`));
            } else {
                showToast(targets.length > 1 ? `${okIds.size} accounts scheduled for deletion` : "Account scheduled for deletion");
            }
            if (okIds.size) confirm.onDone?.();
            setConfirm(null);
            setSelected(new Set());
            load(page);
            loadInsights();
        } catch (e) {
            showToast(e.message || "Action failed", "error");
        } finally {
            setActionLoading(false);
        }
    }

    function handleRefresh() {
        load(page);
        loadInsights();
        activity.refetch();
    }

    // Invite = copy the sign-up link. Point this at your real register route if it differs.
    function handleInvite() {
        const link = `${window.location.origin}/register`;
        navigator.clipboard.writeText(link).then(
            () => showToast("Invite link copied"),
            () => showToast("Couldn’t copy the link", "error"),
        );
    }

    const clearFilters = () => {
        setSearch("");
        setStatusFilter("");
        setFilters(NO_FILTERS);
    };

    const hasFilter = !!(search || statusFilter || filtersActive);
    const selectedCount = users.filter((u) => selected.has(u.id)).length;
    const verifiedPending = ins?.pendingVerified.length ?? 0;

    function tabCount(t) {
        if (!ins) return 0;
        if (t.v === "") return ins.total;
        if (t.v === "deleted") return ins.deleted;
        return ins.counts[t.v] ?? 0;
    }

    let synced = "";
    if (lastLoaded) {
        const s = Math.floor((Date.now() - lastLoaded) / 1000);
        synced = s < 60 ? "just now" : `${Math.floor(s / 60)}m ago`;
    }

    return (
        <div className="max-w-full space-y-4 bg-base-100 text-sm leading-normal text-base-content">
            {/* ── Page header ─────────────────────────────────────────────── */}
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold leading-tight tracking-tight">Users</h1>
                    <button
                        onClick={handleRefresh}
                        title="Refresh"
                        className="mt-1 flex cursor-pointer items-center gap-2 border-none bg-transparent p-0 text-xs text-base-content/70 transition-colors hover:text-base-content">
                        <span className={`size-1.5 shrink-0 rounded-full bg-success ${loading ? "animate-pulse" : ""}`} />
                        {lastLoaded ? `Live · synced ${synced}` : "Loading…"}
                    </button>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => exportCsv(allUsers?.length ? allUsers : users)} disabled={!allUsers?.length && !users.length} className={BTN}>
                        <Download size={14} /> Export
                    </button>
                    <button onClick={handleInvite} className="btn btn-sm btn-primary rounded-md border-none">
                        <Plus size={14} /> Invite user
                    </button>
                </div>
            </div>

            {/* ── Stats strip ─────────────────────────────────────────────── */}
            <StatStrip ins={ins} usage={usage} />

            {/* ── Error ───────────────────────────────────────────────────── */}
            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-error/20 bg-error/10 px-3 py-2.5 text-xs font-medium text-error">
                    <AlertTriangle size={13} />
                    <span className="flex-1">{error}</span>
                    <button onClick={() => load(page)} className="cursor-pointer border-none bg-transparent font-semibold text-error/80 hover:text-error">
                        Retry
                    </button>
                </div>
            )}

            {/* ── Pending banner ──────────────────────────────────────────── */}
            {!loading && pendingTotal > 0 && statusFilter !== "pending" && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3">
                    <div className="flex shrink-0 -space-x-2">
                        {pendingUsers.map((u) => (
                            <div key={u.id} className="rounded-full ring-2 ring-base-100">
                                <Avatar user={u} />
                            </div>
                        ))}
                    </div>
                    <div className="min-w-0 flex-1 basis-56">
                        <p className="text-sm font-medium">
                            {pendingTotal} user{pendingTotal > 1 ? "s are" : " is"} waiting for approval
                        </p>
                        <p className="truncate text-xs text-base-content/75">
                            {ins?.oldestPending ? `Oldest request ${relLong(ins.oldestPending)}` : "Review them to give access"}
                            {verifiedPending > 0 && ` · ${verifiedPending} ${verifiedPending === 1 ? "has a verified email" : "have a verified email"}`}
                        </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        <button onClick={() => setStatusFilter("pending")} className={BTN}>
                            Review queue
                        </button>
                        {verifiedPending > 0 && (
                            <button onClick={approveVerified} className="btn btn-sm btn-success btn-soft rounded-md border-none">
                                Approve verified
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* ── Table card ──────────────────────────────────────────────── */}
            <div className="overflow-hidden rounded-lg border border-base-300 bg-base-200">
                {/* Toolbar: tabs, then search + filters (wraps under tabs on narrow screens) */}
                <div className="flex flex-wrap items-center gap-3 border-b border-base-300 px-4 py-3">
                    <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-base-300 p-1" style={{ scrollbarWidth: "none" }}>
                        {STATUS_TABS.map((t) => {
                            const active = statusFilter === t.v;
                            const count = tabCount(t);
                            return (
                                <button
                                    key={t.v}
                                    onClick={() => setStatusFilter(t.v)}
                                    className={`flex h-8 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border px-3 text-sm font-medium transition-colors
                                        ${active ? "border-primary bg-primary text-primary-content" : "border-base-300 bg-transparent text-base-content hover:bg-base-300"}`}>
                                    {t.label}
                                    {count > 0 && <span className={`text-xs font-normal tabular-nums ${active ? "text-primary-content/90" : "text-base-content/65"}`}>{count}</span>}
                                </button>
                            );
                        })}
                    </div>

                    <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
                        <div className="flex h-8 flex-1 items-center gap-2 rounded-md border border-base-300 bg-base-100 px-2.5 transition-colors focus-within:border-primary sm:w-60 sm:flex-none">
                            <Search size={14} className="shrink-0 text-base-content/60" />
                            <input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search users"
                                className="min-w-0 flex-1 bg-transparent text-base text-base-content placeholder:text-base-content/60 focus:outline-none sm:text-sm"
                            />
                            {search && (
                                <button
                                    onClick={() => setSearch("")}
                                    aria-label="Clear search"
                                    className="cursor-pointer border-none bg-transparent text-base-content/60 transition-colors hover:text-base-content">
                                    <X size={14} />
                                </button>
                            )}
                        </div>
                        <FilterMenu filters={filters} onChange={setFilters} />
                    </div>
                </div>

                {/* Body */}
                {loading ? (
                    <TableSkeleton />
                ) : visibleUsers.length === 0 ? (
                    <EmptyState hasFilter={hasFilter} onClear={clearFilters} />
                ) : (
                    <UsersTable
                        users={visibleUsers}
                        libraries={libraries}
                        presence={presence}
                        selectMode={selectMode}
                        selected={selected}
                        onToggleSelectMode={toggleSelectMode}
                        onToggleRow={toggleRow}
                        onToggleAll={toggleAll}
                        onRequest={setReqUser}
                        onPermission={setPermUser}
                        onAction={handleAction}
                    />
                )}

                {/* Bulk bar (only in select mode with a selection) */}
                {selectMode && selectedCount > 0 && (
                    <div className="flex flex-wrap items-center gap-2 border-t border-base-300 bg-base-300 px-4 py-2.5">
                        <span className="text-sm font-medium tabular-nums">{selectedCount} selected</span>
                        <button onClick={() => setSelected(new Set())} className="cursor-pointer border-none bg-transparent px-2 text-xs text-base-content/70 hover:text-base-content">
                            Clear
                        </button>
                        <div className="flex-1" />
                        <button onClick={handleBulkExport} className="btn btn-sm rounded-md border-none bg-base-100">
                            Export
                        </button>
                        <TimeLimitMenu onPick={(days, label) => handleBulk("limit", { days, label })} />
                        <button onClick={() => handleBulk("delete")} className="btn btn-sm btn-error btn-soft rounded-md border-none">
                            Delete
                        </button>
                    </div>
                )}

                {/* Footer */}
                {!loading && <Pagination page={page} pages={pages} total={total} limit={LIMIT} shown={visibleUsers.length} filtered={filtersActive} onPage={(pg) => load(pg)} />}
            </div>

            {/* ── Usage insights (under the table so the table stays first) ── */}
            <Insights
                ins={ins}
                usage={usage}
                usageState={usageState}
                state={insState}
                onRetry={loadInsights}
                onRetryUsage={activity.refetch}
                onExtend={(u) => handleAction(u, "access")}
                onExtendBy={(targets, days, label, onDone) => setConfirm({ ...bulkConfirm("extend", targets, { days, label }), onDone })}
            />

            {/* ── Modals ──────────────────────────────────────────────────── */}
            <UserInfoModal user={infoUser} onClose={() => setInfoUser(null)} />
            <UserRequestModal user={reqUser} onClose={() => setReqUser(null)} onSave={handleSave} />
            <UserPermissionModal user={permUser} onClose={() => setPermUser(null)} onSave={handleSave} libraries={libraries} />
            <ConfirmModal
                modal={DASH_MODALS.userConfirm}
                open={!!confirm}
                onClose={() => !actionLoading && setConfirm(null)}
                onConfirm={executeAction}
                title={confirm?.title}
                subtitle={confirm?.subtitle}
                confirmIcon={confirm?.confirmIcon}
                message={confirm?.message}
                details={confirm?.details}
                timeline={confirm?.timeline}
                note={confirm?.note}
                variant={confirm?.variant || "danger"}
                confirmText={confirm?.confirmText}
                loading={actionLoading}
            />
            <Toast toast={toast} />

            <style>{`
                @keyframes slideUp {
                    from { opacity: 0; transform: translateY(8px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
            `}</style>
        </div>
    );
}
