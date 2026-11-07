import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import {
    Search,
    RefreshCw,
    MoreVertical,
    CheckCircle,
    XCircle,
    Ban,
    Trash2,
    ChevronLeft,
    ChevronRight,
    Crown,
    User,
    Info,
    KeyRound,
    UserCheck,
    X,
    Clock,
    Calendar,
    AlertTriangle,
    Users,
    ChevronFirst,
    ChevronLast,
    Check,
    LogOut,
    Archive,
    Flame,
} from "lucide-react";
import { dashApi } from "../Api/dashboardApi";
import { ConfirmModal, DASH_MODALS, UserInfoModal, UserPermissionModal, UserRequestModal } from "../Components/DashModal";

function fmtDateShort(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function isExpired(u) {
    return u?.accessType === "temporary" && u?.accessExpiresAt && Date.now() > new Date(u.accessExpiresAt);
}

// ─── STATUS / ROLE atoms ──────────────────────────────────────────────────────

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
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-bold ${c.badge}`}>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.dot}`} />
            {c.label}
        </span>
    );
}

function RoleBadge({ role }) {
    return role === "admin" ? (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-primary/40 bg-primary/10 text-primary text-xs font-bold">
            <Crown size={11} /> Admin
        </span>
    ) : (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-accent/40 bg-accent/10 text-accent text-xs font-bold">
            <User size={11} /> User
        </span>
    );
}

function Avatar({ user, size = "sm" }) {
    const dim =
        {
            sm: "w-8 h-8 text-xs",
            md: "w-10 h-10 text-sm",
            lg: "w-12 h-12 text-base",
            xl: "w-20 h-20 text-3xl",
        }[size] ?? "w-8 h-8 text-xs";
    const initial = (user.name || user.email || "U")[0].toUpperCase();
    if (user.avatar) return <img src={user.avatar} alt="" className={`${dim} rounded-full object-cover ring-1 ring-base-300 shrink-0`} />;
    return <div className={`${dim} rounded-full bg-primary/20 flex items-center justify-center font-black text-primary ring-1 ring-primary/20 shrink-0`}>{initial}</div>;
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ toast }) {
    if (!toast) return null;
    return createPortal(
        <div
            className={`fixed bottom-5 right-5 z-99999 flex items-center gap-2 px-4 py-3
            rounded-lg shadow-2xl text-xs font-bold max-w-xs
            ${toast.type === "error" ? "bg-error text-error-content" : "bg-success text-success-content"}`}>
            {toast.type === "error" ? <AlertTriangle size={13} /> : <CheckCircle size={13} />}
            {toast.msg}
        </div>,
        document.body,
    );
}

// ─── ActionBtn ────────────────────────────────────────────────────────────────

function ActionBtn({ icon: Icon, label, onClick, className = "", pulse = false }) {
    return (
        <button
            onClick={onClick}
            aria-label={label}
            title={label}
            className={`relative w-8 h-8 rounded-md flex items-center justify-center
                text-white/50 transition-all duration-150 cursor-pointer border-none
                focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50 ${className}`}>
            <Icon size={15} strokeWidth={1.8} />
            {pulse && (
                <span className="absolute top-0.5 right-0.5 flex h-2 w-2">
                    <span className="animate-ping absolute h-full w-full rounded-full bg-warning opacity-75" />
                    <span className="relative block h-2 w-2 rounded-full bg-warning" />
                </span>
            )}
        </button>
    );
}

// ─── ⋮ Action Menu ────────────────────────────────────────────────────────────

function ActionMenu({ user, onAction }) {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState({ top: 0, left: 0 });
    const btnRef = useRef(null);
    const menuRef = useRef(null);
    const MENU_W = 165;

    useEffect(() => {
        if (!open) return;
        const close = (e) => {
            if (!btnRef.current?.contains(e.target) && !menuRef.current?.contains(e.target)) {
                setOpen(false);
            }
        };
        const scroll = () => setOpen(false);
        document.addEventListener("mousedown", close);
        window.addEventListener("scroll", scroll, true);
        return () => {
            document.removeEventListener("mousedown", close);
            window.removeEventListener("scroll", scroll, true);
        };
    }, [open]);

    function handleOpen(e) {
        e.stopPropagation();
        if (!btnRef.current) return;
        const r = btnRef.current.getBoundingClientRect();
        setPos({ top: r.bottom + 4, left: Math.max(8, r.right - MENU_W) });
        setOpen((o) => !o);
    }

    const actions = [
        ...(user.status !== "approved" ? [{ label: "Approve", icon: CheckCircle, key: "approve", cls: "text-success hover:bg-success/10" }] : []),
        ...(user.status !== "rejected" ? [{ label: "Reject", icon: XCircle, key: "reject", cls: "text-warning hover:bg-warning/10" }] : []),
        ...(user.status !== "blocked" ? [{ label: "Block", icon: Ban, key: "block", cls: "text-error   hover:bg-error/10" }] : []),
        null,
        { label: "Delete User", icon: Trash2, key: "delete", cls: "text-error font-bold hover:bg-error/10" },
    ];

    return (
        <>
            <button
                ref={btnRef}
                onClick={handleOpen}
                aria-label="More actions"
                title="More actions"
                className="w-8 h-8 rounded-md flex items-center justify-center text-white/50 border-none
                    hover:bg-white/8 hover:text-white transition-all duration-150 cursor-pointer
                    focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50">
                <MoreVertical size={15} strokeWidth={1.8} />
            </button>

            {open &&
                createPortal(
                    <div
                        ref={menuRef}
                        style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 99999, minWidth: MENU_W }}
                        className="bg-base-200 border border-white/10 rounded-lg shadow-2xl py-1 overflow-hidden">
                        {actions.map((a, i) =>
                            !a ? (
                                <div key={i} className="my-1 border-t border-white/5" />
                            ) : (
                                <button
                                    key={a.key}
                                    onClick={() => {
                                        onAction(user, a.key);
                                        setOpen(false);
                                    }}
                                    className={`flex items-center gap-2.5 w-full px-3.5 py-2.5 text-sm font-semibold transition-colors border-none cursor-pointer ${a.cls}`}>
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

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sub, iconCls = "text-primary", bgCls = "bg-primary/10" }) {
    return (
        <div className="bg-base-200 rounded-xl border border-white/6 px-4 py-4 flex items-center gap-3.5 hover:border-white/10 transition-colors">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${bgCls} ${iconCls}`}>
                <Icon size={18} strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
                <p className="text-2xl font-black text-white tabular-nums leading-none">{value}</p>
                <p className="text-xs text-white/50 mt-0.5 font-medium">{label}</p>
                {sub && <p className="text-[10px] text-white/30 mt-0.5">{sub}</p>}
            </div>
        </div>
    );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ className = "" }) {
    return <div className={`animate-pulse bg-white/5 rounded ${className}`} />;
}

function TableSkeleton() {
    return (
        <div className="space-y-0">
            {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3.5 border-b border-white/4">
                    <Skeleton className="w-8 h-8 rounded-full shrink-0" />
                    <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-3.5 w-36" />
                        <Skeleton className="h-2.5 w-48" />
                    </div>
                    <Skeleton className="h-6 w-14 rounded-md" />
                    <Skeleton className="h-6 w-18 rounded-md" />
                    <Skeleton className="h-6 w-16 rounded-md hidden sm:block" />
                    <div className="flex gap-1 ml-auto">
                        <Skeleton className="w-8 h-8 rounded-md" />
                        <Skeleton className="w-8 h-8 rounded-md" />
                        <Skeleton className="w-8 h-8 rounded-md" />
                    </div>
                </div>
            ))}
        </div>
    );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ search, statusFilter, onClear }) {
    const hasFilter = search || statusFilter;
    return (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
            <div className="w-14 h-14 rounded-2xl bg-base-200 flex items-center justify-center mb-4 border border-white/6">
                <Users size={22} className="text-white/25" />
            </div>
            <p className="text-base font-bold text-white/50">{hasFilter ? "No users match your filters" : "No users found"}</p>
            <p className="text-sm text-white/30 mt-1 max-w-xs">{hasFilter ? "Try adjusting your search or clearing the active filters." : "Users will appear here once they register."}</p>
            {hasFilter && (
                <button onClick={onClear} className="mt-4 px-4 py-2 rounded-md text-sm font-bold bg-primary text-primary-content hover:opacity-90 transition-opacity border-none cursor-pointer">
                    Clear Filters
                </button>
            )}
        </div>
    );
}

// ─── Pagination ───────────────────────────────────────────────────────────────

function Pagination({ page, pages, total, limit, onPage }) {
    if (pages <= 1) return null;

    const from = (page - 1) * limit + 1;
    const to = Math.min(page * limit, total);

    // Build visible page numbers (max 5 shown)
    const makePages = () => {
        if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
        const delta = 2;
        const range = [];
        const left = page - delta;
        const right = page + delta;
        for (let i = 1; i <= pages; i++) {
            if (i === 1 || i === pages || (i >= left && i <= right)) {
                range.push(i);
            } else if (range[range.length - 1] !== "...") {
                range.push("...");
            }
        }
        return range;
    };

    return (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <p className="text-xs text-white/40 tabular-nums">
                Showing{" "}
                <span className="text-white/70 font-semibold">
                    {from}–{to}
                </span>{" "}
                of <span className="text-white/70 font-semibold">{total}</span> users
            </p>
            <div className="flex items-center gap-1">
                <button
                    onClick={() => onPage(1)}
                    disabled={page <= 1}
                    className="w-8 h-8 rounded-md flex items-center justify-center text-white/50 border-none
                        hover:bg-white/8 hover:text-white transition-colors disabled:opacity-25 disabled:cursor-not-allowed cursor-pointer">
                    <ChevronFirst size={14} />
                </button>
                <button
                    onClick={() => onPage(page - 1)}
                    disabled={page <= 1}
                    className="w-8 h-8 rounded-md flex items-center justify-center text-white/50 border-none
                        hover:bg-white/8 hover:text-white transition-colors disabled:opacity-25 disabled:cursor-not-allowed cursor-pointer">
                    <ChevronLeft size={14} />
                </button>

                {makePages().map((p, i) =>
                    p === "..." ? (
                        <span key={`dots-${i}`} className="w-8 h-8 flex items-center justify-center text-white/30 text-xs">
                            …
                        </span>
                    ) : (
                        <button
                            key={p}
                            onClick={() => onPage(p)}
                            className={`w-8 h-8 rounded-md text-xs font-bold transition-colors border-none cursor-pointer
                                ${page === p ? "bg-primary text-primary-content shadow-sm" : "text-white/60 hover:bg-white/8 hover:text-white"}`}>
                            {p}
                        </button>
                    ),
                )}

                <button
                    onClick={() => onPage(page + 1)}
                    disabled={page >= pages}
                    className="w-8 h-8 rounded-md flex items-center justify-center text-white/50 border-none
                        hover:bg-white/8 hover:text-white transition-colors disabled:opacity-25 disabled:cursor-not-allowed cursor-pointer">
                    <ChevronRight size={14} />
                </button>
                <button
                    onClick={() => onPage(pages)}
                    disabled={page >= pages}
                    className="w-8 h-8 rounded-md flex items-center justify-center text-white/50 border-none
                        hover:bg-white/8 hover:text-white transition-colors disabled:opacity-25 disabled:cursor-not-allowed cursor-pointer">
                    <ChevronLast size={14} />
                </button>
            </div>
        </div>
    );
}

// ─── Users table ─────────────────────────────────────────────────────────────

function UsersTable({ users, onInfo, onRequest, onPermission, onAction }) {
    if (!users.length) return null;
    return (
        <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
            <table className="w-full table-auto border-collapse" style={{ minWidth: 720 }}>
                <thead>
                    <tr className="text-[11px] font-black uppercase tracking-wider text-white/40 bg-base-200 border-b border-white/6">
                        <th className="py-3 px-4 text-left">User</th>
                        <th className="py-3 px-3 text-left">Role</th>
                        <th className="py-3 px-3 text-left">Status</th>
                        <th className="py-3 px-3 text-left">Verified</th>
                        <th className="py-3 px-3 text-left">Access</th>
                        <th className="py-3 px-3 text-left hidden sm:table-cell">IP</th>
                        <th className="py-3 px-3 text-center">Devices</th>
                        <th className="py-3 px-3 text-left hidden sm:table-cell">Joined</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {users.map((u) => {
                        const exp = isExpired(u);
                        return (
                            <tr key={u.id} className="border-b border-white/4 hover:bg-white/2 transition-colors group">
                                <td className="py-3 px-4">
                                    <div className="flex items-center gap-3">
                                        <Avatar user={u} />
                                        <div className="min-w-0">
                                            <p className="text-sm font-bold text-white truncate max-w-37.5">{u.name || "—"}</p>
                                            <p className="text-xs text-white/50 font-mono truncate max-w-37.5">{u.email}</p>
                                        </div>
                                    </div>
                                </td>
                                <td className="py-3 px-3">
                                    <RoleBadge role={u.role} />
                                </td>
                                <td className="py-3 px-3">
                                    <StatusBadge status={u.status} />
                                </td>
                                <td className="py-3 px-3">
                                    <span className={`text-base font-black flex justify-center ${u.emailVerified ? "text-success" : "text-white/30"}`}>{u.emailVerified ? <Check /> : <X />}</span>
                                </td>
                                <td className="py-3 px-3">
                                    {u.deletedAt ? (
                                        <div>
                                            <span className="text-xs font-bold text-warning">Purges</span>
                                            <p className="text-xs text-white/40 mt-0.5 flex items-center gap-0.5">
                                                <Calendar size={10} /> {fmtDateShort(u.purgeAt)}
                                            </p>
                                        </div>
                                    ) : exp ? (
                                        <span className="text-xs font-bold text-error">Expired</span>
                                    ) : u.accessType === "temporary" ? (
                                        <div>
                                            <span className="text-xs font-bold text-warning">Temp</span>
                                            {u.accessExpiresAt && (
                                                <p className="text-xs text-white/40 mt-0.5 flex items-center gap-0.5">
                                                    <Calendar size={10} /> {fmtDateShort(u.accessExpiresAt)}
                                                </p>
                                            )}
                                        </div>
                                    ) : (
                                        <span className="text-xs text-white/40">Permanent</span>
                                    )}
                                </td>
                                <td className="py-3 px-3 hidden sm:table-cell">
                                    <span className="text-xs font-mono text-white/40">{u.lastIp || "—"}</span>
                                </td>
                                <td className="py-3 px-3 text-center">
                                    <div className="inline-flex items-center gap-1.5 bg-base-300/30 px-2 py-1 rounded-md">
                                        {(u._count?.devices ?? 0) > 0 && <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse shrink-0" />}
                                        <span className="text-sm text-white font-bold tabular-nums">{u._count?.devices ?? 0}</span>
                                    </div>
                                </td>
                                <td className="py-3 px-3 text-xs text-white/40 whitespace-nowrap hidden sm:table-cell">{u.createdAt ? fmtDateShort(u.createdAt) : "—"}</td>
                                <td className="py-3 px-4">
                                    <div className="flex items-center justify-end gap-1">
                                        <ActionBtn icon={Info} label="Details" onClick={() => onInfo(u)} className="hover:bg-info/15 hover:text-info" />
                                        {!u.deletedAt && (
                                            <>
                                                <ActionBtn
                                                    icon={UserCheck}
                                                    label="Manage Access"
                                                    onClick={() => onRequest(u)}
                                                    className="hover:bg-success/15 hover:text-success"
                                                    pulse={u.status === "pending"}
                                                />
                                                <ActionBtn icon={KeyRound} label="Permissions" onClick={() => onPermission(u)} className="hover:bg-primary/15 hover:text-primary" />
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

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

const LIMIT = 25;

export default function DashUsers() {
    const [users, setUsers] = useState([]);
    const [total, setTotal] = useState(0);
    const [pendingTotal, setPendingTotal] = useState(0);
    const [pages, setPages] = useState(1);
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [toast, setToast] = useState(null);
    const [confirm, setConfirm] = useState(null);
    const [actionLoading, setActionLoading] = useState(false);
    const [infoUser, setInfoUser] = useState(null);
    const [reqUser, setReqUser] = useState(null);
    const [permUser, setPermUser] = useState(null);
    const [libraries, setLibraries] = useState([]);
    const [stats, setStats] = useState(null);
    const searchTimer = useRef(null);

    function showToast(msg, type = "success") {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 3500);
    }

    // load libraries once
    useEffect(() => {
        dashApi
            .libraries()
            .then((d) => setLibraries(d?.libraries ?? []))
            .catch(() => {});
    }, []);

    // load aggregate stats once
    useEffect(() => {
        dashApi
            .stats()
            .then((d) => setStats(d?.users ?? null))
            .catch(() => {});
    }, []);

    const loadPendingCount = useCallback(async () => {
        try {
            const d = await dashApi.users({ status: "pending", limit: 1, page: 1 });
            setPendingTotal(d.total ?? 0);
        } catch {
            /* silent */
        }
    }, []);

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
        searchTimer.current = setTimeout(() => {
            load(1);
            loadPendingCount();
        }, 350);
        return () => clearTimeout(searchTimer.current);
    }, [search, statusFilter, load, loadPendingCount]);

    // CRUD: handleSave
    async function handleSave(user, updates) {
        try {
            await dashApi.updateUser(user.id, updates);
            setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, ...updates } : u)));
            showToast(`Updated: ${user.name || user.email}`);
            load(page);
            loadPendingCount();
        } catch (e) {
            showToast(e.message || "Update failed", "error");
            throw e; // keeps modal open on failure
        }
    }

    // CRUD: handleAction (⋮ menu)
    function handleAction(user, key) {
        const statusMap = { approve: "approved", reject: "rejected", block: "blocked" };
        if (key === "delete") {
            setConfirm({
                title: `Delete ${user.name || user.email}?`,
                subtitle: user.email,
                confirmIcon: Trash2,
                timeline: [
                    { icon: LogOut, tone: "error", title: "Right now", text: "They lose access immediately." },
                    { icon: Archive, tone: "warning", title: "Next 30 days", text: "Profile, watch history and preferences are kept. The user can recover the account by verifying their email." },
                    { icon: Flame, tone: "error", title: "After 30 days", text: "Everything retained is permanently purged." },
                ],
                note: "Admins can’t restore the account through recovery.",
                variant: "danger",
                confirmText: "Delete user",
                user,
            });
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

    async function executeAction() {
        if (!confirm?.user) return;
        setActionLoading(true);
        try {
            if (confirm.status) {
                await dashApi.updateUser(confirm.user.id, { status: confirm.status });
                setUsers((prev) => prev.map((u) => (u.id === confirm.user.id ? { ...u, status: confirm.status } : u)));
            } else {
                await dashApi.deleteUser(confirm.user.id);
                setUsers((prev) => prev.filter((u) => u.id !== confirm.user.id));
            }
            showToast(confirm.status ? `${confirm.title.replace("?", "")} done` : "Account scheduled for deletion");
            setConfirm(null);
            load(page);
            loadPendingCount();
        } catch (e) {
            showToast(e.message || "Action failed", "error");
        } finally {
            setActionLoading(false);
        }
    }

    const STATUS_TABS = [
        { v: "", label: "All" },
        { v: "pending", label: "Pending", alert: true },
        { v: "approved", label: "Approved" },
        { v: "blocked", label: "Blocked" },
        { v: "rejected", label: "Rejected" },
        { v: "deleted", label: "Pending deletion" },
    ];

    function handleRefresh() {
        load(page);
        loadPendingCount();
        dashApi
            .stats()
            .then((d) => setStats(d?.users ?? null))
            .catch(() => {});
    }

    const clearFilters = () => {
        setSearch("");
        setStatusFilter("");
    };

    return (
        <div className="space-y-5 max-w-full bg-base-100">
            {/* ── Page header ─────────────────────────────────────────────── */}
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-black text-white">User Management</h1>
                    <p className="text-sm text-white/50 mt-0.5">
                        {loading ? (
                            "Loading…"
                        ) : (
                            <>
                                <span className="tabular-nums text-white/70 font-semibold">{total}</span> total accounts
                                {pendingTotal > 0 && (
                                    <span className="ml-2.5 px-2 py-0.5 rounded-md bg-warning/15 text-warning text-xs font-bold border border-warning/20">{pendingTotal} pending approval</span>
                                )}
                            </>
                        )}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleRefresh}
                        title="Refresh"
                        className="w-9 h-9 rounded-md flex items-center justify-center text-white/50 border-none
                            hover:bg-white/8 hover:text-white transition-colors cursor-pointer">
                        <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
                    </button>
                </div>
            </div>

            {/* ── Stats row ────────────────────────────────────────────────── */}
            {stats ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <StatCard icon={Users} label="Total Users" value={stats.total ?? 0} iconCls="text-primary" bgCls="bg-primary/10" />
                    <StatCard icon={CheckCircle} label="Approved" value={stats.approved ?? 0} iconCls="text-success" bgCls="bg-success/10" />
                    <StatCard icon={Clock} label="Pending" value={stats.pending ?? 0} iconCls="text-warning" bgCls="bg-warning/10" />
                    <StatCard icon={Crown} label="Admins" value={stats.admins ?? 0} iconCls="text-accent" bgCls="bg-accent/10" />
                </div>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="bg-base-200 rounded-xl border border-white/6 px-4 py-4 flex items-center gap-3.5">
                            <Skeleton className="w-10 h-10 rounded-lg" />
                            <div className="space-y-2 flex-1">
                                <Skeleton className="h-5 w-12" />
                                <Skeleton className="h-3 w-20" />
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* ── Error ───────────────────────────────────────────────────── */}
            {error && (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-error/10 text-error text-xs font-semibold border border-error/20">
                    <AlertTriangle size={13} />
                    <span className="flex-1">{error}</span>
                    <button onClick={() => load(page)} className="text-error/70 hover:text-error font-bold border-none bg-transparent cursor-pointer">
                        Retry
                    </button>
                </div>
            )}

            {/* ── Pending banner ──────────────────────────────────────────── */}
            {!loading && pendingTotal > 0 && statusFilter !== "pending" && (
                <button
                    onClick={() => setStatusFilter("pending")}
                    className="w-full flex items-center gap-2.5 px-4 py-3 rounded-xl bg-warning/8 border border-warning/15
                        text-warning text-sm font-semibold hover:bg-warning/12 transition-colors text-left cursor-pointer border-none"
                    style={{ background: "rgba(var(--color-warning)/0.06)", border: "1px solid rgba(var(--color-warning)/0.15)" }}>
                    <span className="relative flex h-2.5 w-2.5 shrink-0">
                        <span className="animate-ping absolute h-full w-full rounded-full bg-warning opacity-75" />
                        <span className="relative block h-2.5 w-2.5 rounded-full bg-warning" />
                    </span>
                    <span>
                        {pendingTotal} user{pendingTotal > 1 ? "s" : ""} awaiting approval
                    </span>
                    <ChevronRight size={14} className="ml-auto opacity-50" />
                </button>
            )}

            {/* ── Toolbar ─────────────────────────────────────────────────── */}
            <div className="flex w-full flex-col-reverse gap-3 xl:flex-row xl:justify-between xl:gap-10">
                {/* Status tabs */}
                <div className="flex h-10 w-full min-w-0 items-stretch justify-between gap-0.5 overflow-x-auto rounded-lg border border-white/5 bg-base-200 p-0.5" style={{ scrollbarWidth: "none" }}>
                    {STATUS_TABS.map((t) => (
                        <button
                            key={t.v}
                            onClick={() => setStatusFilter(t.v)}
                            className={`px-3 rounded-md text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 shrink-0 cursor-pointer border-none
                                ${statusFilter === t.v ? "bg-primary text-primary-content shadow-sm" : "text-white/50 hover:text-white hover:bg-white/5"}`}>
                            {t.label}
                            {t.alert && pendingTotal > 0 && <span className="px-1.5 py-0.5 rounded-md bg-warning text-warning-content text-[10px] font-black tabular-nums">{pendingTotal}</span>}
                        </button>
                    ))}
                </div>

                {/* Search */}
                <div className="flex h-10 w-full min-w-0 items-center gap-2 rounded-lg border border-white/8 bg-base-200 px-3.5 transition-colors focus-within:border-primary/30">
                    <Search size={15} className="text-white/35 shrink-0" />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by name or email…"
                        className="min-w-0 flex-1 bg-transparent text-base text-white placeholder:text-white/35 focus:outline-none sm:text-sm"
                    />
                    {search && (
                        <button onClick={() => setSearch("")} className="text-white/35 hover:text-white transition-colors border-none bg-transparent cursor-pointer">
                            <X size={14} />
                        </button>
                    )}
                </div>
            </div>

            {/* ── Table card ──────────────────────────────────────────────── */}
            <div className="bg-base-200 rounded-xl overflow-hidden border border-white/6 shadow-sm">
                {loading ? (
                    <TableSkeleton />
                ) : users.length === 0 ? (
                    <EmptyState search={search} statusFilter={statusFilter} onClear={clearFilters} />
                ) : (
                    <UsersTable users={users} onInfo={setInfoUser} onRequest={setReqUser} onPermission={setPermUser} onAction={handleAction} />
                )}
            </div>

            {/* ── Pagination ──────────────────────────────────────────────── */}
            <Pagination page={page} pages={pages} total={total} limit={LIMIT} onPage={(pg) => load(pg)} />

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
