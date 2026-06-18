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
    Monitor,
    Smartphone,
    Globe,
    Clock,
    Calendar,
    Eye,
    EyeOff,
    Library,
    AlertTriangle,
    WifiOff,
    Shield,
    LogOut,
    Users,
    UserPlus,
    Activity,
    Lock,
    ChevronFirst,
    ChevronLast,
    Filter,
    SlidersHorizontal,
    Check,
} from "lucide-react";
import { dashApi } from "../api/dashboardApi";
import ConfirmModal from "../components/ConfirmModal";

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtRel(val) {
    if (!val) return "—";
    const ms = typeof val === "number" ? val : new Date(val).getTime();
    if (isNaN(ms)) return "—";
    const s = Math.floor((Date.now() - ms) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
}
function fmtDate(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function fmtDateShort(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function deviceIcon(ua = "") {
    if (/ipad|tablet/i.test(ua)) return <Monitor size={13} />;
    if (/mobile|android|iphone/i.test(ua)) return <Smartphone size={13} />;
    return <Globe size={13} />;
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

// ─── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({ value, onChange, disabled }) {
    return (
        <button
            type="button"
            onClick={() => !disabled && onChange(!value)}
            disabled={disabled}
            className={`relative w-9 h-5 rounded-full transition-colors duration-200 shrink-0 disabled:opacity-40 border-none cursor-pointer
                ${value ? "bg-primary" : "bg-white/15"}`}>
            <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all duration-200
                ${value ? "left-4.75" : "left-0.5"}`}
            />
        </button>
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

// ─── Modal shell ──────────────────────────────────────────────────────────────

function Modal({ onClose, children, maxW = "max-w-lg" }) {
    useEffect(() => {
        const h = (e) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", h);
        return () => document.removeEventListener("keydown", h);
    }, [onClose]);

    return (
        <dialog open className="modal modal-open" style={{ zIndex: 9998 }}>
            <div
                className={`modal-box ${maxW} p-0 overflow-hidden rounded-2xl
                bg-[#0f1117] border border-white/[0.09]
                shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_32px_80px_rgba(0,0,0,0.9),0_8px_24px_rgba(0,0,0,0.6)]`}
                style={{ animation: "modalIn 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
                {children}
            </div>
            <div className="modal-backdrop bg-black/80 backdrop-blur-sm" onClick={onClose} />
            <style>{`@keyframes modalIn{from{opacity:0;transform:scale(0.96) translateY(6px)}to{opacity:1;transform:scale(1) translateY(0)}}`}</style>
        </dialog>
    );
}

function ModalHeader({ title, subtitle, icon: Icon, iconCls = "text-primary", iconBg = "bg-primary/10 ring-primary/20", onClose, badge }) {
    return (
        <div className="relative flex items-center gap-3.5 px-5 py-4 border-b border-white/[0.07]">
            {/* top shimmer line */}
            <div className="absolute top-0 left-0 right-0 h-px" style={{ background: "linear-gradient(90deg,transparent,rgba(255,255,255,0.12) 40%,rgba(255,255,255,0.06) 60%,transparent)" }} />
            {Icon && (
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ring-1 ${iconBg} ${iconCls}`}>
                    <Icon size={18} strokeWidth={1.8} />
                </div>
            )}
            <div className="flex-1 min-w-0">
                <h3 className="text-[15px] font-bold text-white leading-snug tracking-tight">{title}</h3>
                {subtitle && <p className="text-[11px] text-white/45 truncate mt-0.5 font-mono">{subtitle}</p>}
            </div>
            {badge}
            <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-white/30 border-none
                    hover:text-white hover:bg-white/[0.07] transition-all shrink-0 cursor-pointer
                    focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20">
                <X size={15} strokeWidth={2.2} />
            </button>
        </div>
    );
}

function Section({ label, icon: Icon, iconCls = "text-white/40", children }) {
    return (
        <div className="space-y-2.5">
            <div className="flex items-center gap-2">
                {Icon && <Icon size={11} className={`shrink-0 ${iconCls}`} strokeWidth={2.5} />}
                <span className="text-[10px] font-black uppercase tracking-[0.13em] text-white/40 whitespace-nowrap">{label}</span>
                <div className="flex-1 h-px bg-white/[0.06]" />
            </div>
            {children}
        </div>
    );
}

function FieldRow({ label, value }) {
    return (
        <div className="flex justify-between items-center py-2 px-2.5 rounded-lg hover:bg-white/[0.03] transition-colors -mx-1">
            <dt className="text-xs font-semibold text-white/45 shrink-0 mr-4 uppercase tracking-wide">{label}</dt>
            <dd className="text-sm text-white/90 font-semibold text-right max-w-[65%] truncate">{value}</dd>
        </div>
    );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sub, iconCls = "text-primary", bgCls = "bg-primary/10" }) {
    return (
        <div className="bg-base-200/40 rounded-xl border border-white/6 px-4 py-4 flex items-center gap-3.5 hover:border-white/10 transition-colors">
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
            <div className="w-14 h-14 rounded-2xl bg-base-200/60 flex items-center justify-center mb-4 border border-white/6">
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

// ─── INFO MODAL ───────────────────────────────────────────────────────────────

function InfoModal({ user, onClose }) {
    const [sessions, setSessions] = useState([]);
    const [sessLoading, setSessLoading] = useState(false);
    const [revoking, setRevoking] = useState(null);

    useEffect(() => {
        if (!user) return;
        setSessions([]);
        setSessLoading(true);
        dashApi
            .userSessions(user.id)
            .then((d) => setSessions(d?.sessions ?? []))
            .catch(() => setSessions([]))
            .finally(() => setSessLoading(false));
    }, [user?.id]);

    if (!user) return null;

    const active = sessions.filter((s) => s.isActive !== false);
    const lastMs = sessions.length > 0 ? Math.max(...sessions.map((s) => new Date(s.lastSeenAt || 0).getTime())) : null;
    const expired = isExpired(user);

    async function revoke(sid) {
        setRevoking(sid);
        try {
            await dashApi.revokeSession(sid);
            setSessions((p) => p.filter((s) => s.id !== sid));
        } catch {
            /* silent */
        } finally {
            setRevoking(null);
        }
    }

    return (
        <Modal onClose={onClose} maxW="max-w-2xl">
            {/* ── Header: avatar + identity + close ── */}
            <div className="relative flex items-center gap-4 px-6 py-5 border-b border-white/[0.07]">
                <div className="absolute top-0 left-0 right-0 h-px" style={{ background: "linear-gradient(90deg,transparent,rgba(255,255,255,0.10) 40%,transparent)" }} />
                {/* avatar with online ring */}
                <div className="relative shrink-0">
                    <Avatar user={user} size="lg" />
                    {active.length > 0 && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-success border-2 border-[#0f1117]" />}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-base font-bold text-white">{user.name || "Unnamed"}</span>
                        <RoleBadge role={user.role} />
                        <StatusBadge status={user.status} />
                    </div>
                    <p className="text-xs text-white/40 font-mono mt-1 truncate">{user.email}</p>
                    {lastMs && (
                        <p className="text-[11px] text-white/30 mt-0.5 flex items-center gap-1">
                            <Clock size={10} /> Last active {fmtRel(lastMs)}
                        </p>
                    )}
                </div>
                {/* stat chips */}
                <div className="hidden sm:flex gap-2 shrink-0">
                    {[
                        { label: "Sessions", val: user._count?.sessions ?? sessions.length, cls: "text-primary", bg: "bg-primary/8 border-primary/15" },
                        { label: "Watched", val: user._count?.watchHistory ?? 0, cls: "text-info", bg: "bg-info/8 border-info/15" },
                    ].map(({ label, val, cls, bg }) => (
                        <div key={label} className={`flex flex-col items-center px-3.5 py-2 rounded-xl border ${bg} min-w-[60px]`}>
                            <span className={`text-xl font-black tabular-nums ${cls}`}>{val}</span>
                            <span className="text-[10px] text-white/40 uppercase tracking-wide mt-0.5">{label}</span>
                        </div>
                    ))}
                </div>
                <button
                    onClick={onClose}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-white/30 border-none
                        hover:text-white hover:bg-white/[0.07] transition-all cursor-pointer shrink-0">
                    <X size={15} strokeWidth={2.2} />
                </button>
            </div>

            {/* ── Two-column body ── */}
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.1fr] divide-y sm:divide-y-0 sm:divide-x divide-white/[0.06] max-h-[65vh] overflow-y-auto">
                {/* LEFT — account details */}
                <div className="p-5 space-y-5">
                    <Section label="Account" icon={User} iconCls="text-primary/60">
                        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
                            <FieldRow label="ID" value={<span className="font-mono text-xs text-white/55">{user.id.slice(0, 18)}…</span>} />
                            <FieldRow
                                label="Email"
                                value={<span className={user.emailVerified ? "text-success" : "text-warning font-bold"}>{user.emailVerified ? "✓ Verified" : "✗ Unverified"}</span>}
                            />
                            <FieldRow label="Joined" value={fmtDate(user.createdAt)} />
                            <FieldRow label="Updated" value={fmtDate(user.updatedAt)} />
                        </div>
                    </Section>

                    <Section label="Access" icon={Shield} iconCls="text-accent/60">
                        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
                            <FieldRow label="Type" value={<span className="capitalize">{user.accessType || "Permanent"}</span>} />
                            {user.accessType === "temporary" && <FieldRow label="Expires" value={<span className={expired ? "text-error font-bold" : ""}>{fmtDate(user.accessExpiresAt)}</span>} />}
                            <FieldRow
                                label="Content"
                                value={user.permissions?.allowAdult ? <span className="text-warning font-bold">18+ Allowed</span> : <span className="text-white/50">Restricted</span>}
                            />
                            <FieldRow label="Last IP" value={<span className="font-mono text-xs text-white/55">{user.lastIp || "—"}</span>} />
                        </div>
                    </Section>

                    {/* stat pills — mobile only */}
                    <div className="flex sm:hidden gap-2">
                        {[
                            { label: "Sessions", val: user._count?.sessions ?? sessions.length, cls: "text-primary", bg: "bg-primary/8 border-primary/15" },
                            { label: "Watched", val: user._count?.watchHistory ?? 0, cls: "text-info", bg: "bg-info/8 border-info/15" },
                        ].map(({ label, val, cls, bg }) => (
                            <div key={label} className={`flex-1 flex flex-col items-center py-3 rounded-xl border ${bg}`}>
                                <span className={`text-2xl font-black ${cls}`}>{val}</span>
                                <span className="text-[10px] text-white/40 uppercase tracking-wide mt-0.5">{label}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* RIGHT — sessions */}
                <div className="p-5 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                        <Section label="Active Sessions" icon={Monitor} iconCls="text-success/60">
                            <></>
                        </Section>
                        {active.length > 0 && <span className="text-xs font-bold text-success bg-success/10 px-2.5 py-1 rounded-lg border border-success/20 -mt-1 shrink-0">{active.length} live</span>}
                    </div>

                    {sessLoading ? (
                        <div className="flex-1 flex flex-col gap-2">
                            {[1, 2, 3].map((i) => (
                                <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.025] border border-white/[0.05]">
                                    <div className="w-9 h-9 rounded-lg bg-white/[0.04] animate-pulse shrink-0" />
                                    <div className="flex-1 space-y-1.5">
                                        <div className="h-3 w-28 bg-white/[0.04] rounded animate-pulse" />
                                        <div className="h-2.5 w-20 bg-white/[0.03] rounded animate-pulse" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : active.length === 0 ? (
                        <div className="flex-1 flex flex-col items-center justify-center py-12 rounded-xl border border-dashed border-white/[0.07]">
                            <div className="w-10 h-10 rounded-xl bg-white/[0.03] flex items-center justify-center mb-3 border border-white/[0.06]">
                                <WifiOff size={18} className="text-white/20" />
                            </div>
                            <p className="text-sm font-semibold text-white/35">No active sessions</p>
                            <p className="text-xs text-white/25 mt-0.5">User is not logged in</p>
                        </div>
                    ) : (
                        <div className="space-y-2 overflow-y-auto">
                            {active.map((s) => (
                                <div
                                    key={s.id}
                                    className="flex items-center gap-3 px-3.5 py-3 rounded-xl
                                    bg-white/[0.025] border border-white/[0.06] hover:border-white/10 hover:bg-white/[0.04] transition-all group">
                                    <div className="relative w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
                                        {deviceIcon(s.userAgent ?? "")}
                                        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-success border border-[#0f1117]" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-white truncate leading-snug">{[s.browser, s.os].filter(Boolean).join(" · ") || s.userAgent || "Unknown Device"}</p>
                                        <div className="flex items-center gap-2.5 mt-0.5">
                                            {s.ip && <span className="text-[11px] font-mono text-white/35">{s.ip}</span>}
                                            {s.lastSeenAt && (
                                                <span className="text-[11px] text-white/35 flex items-center gap-0.5">
                                                    <Clock size={9} /> {fmtRel(s.lastSeenAt)}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => revoke(s.id)}
                                        title="Revoke"
                                        disabled={revoking === s.id}
                                        className="w-7 h-7 rounded-lg flex items-center justify-center text-white/30 border-none
                                            hover:bg-error/15 hover:text-error transition-all shrink-0 disabled:opacity-40 cursor-pointer">
                                        {revoking === s.id ? <span className="loading loading-spinner loading-xs" /> : <LogOut size={13} />}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </Modal>
    );
}

// ─── REQUEST MODAL ────────────────────────────────────────────────────────────

function RequestModal({ user, onClose, onSave }) {
    const [saving, setSaving] = useState(null);
    if (!user) return null;

    const ACTIONS = [
        {
            key: "approved",
            label: "Approve Access",
            desc: "Grant full access to the platform",
            icon: CheckCircle,
            activeCls: "border-success/30 bg-success/8",
            inactiveCls: "border-white/[0.06] bg-base-200/20 hover:border-success/20 hover:bg-success/5",
            labelCls: "text-success",
            iconBgCls: "bg-success/15 text-success",
        },
        {
            key: "rejected",
            label: "Reject Request",
            desc: "Deny this registration",
            icon: XCircle,
            activeCls: "border-warning/30 bg-warning/8",
            inactiveCls: "border-white/[0.06] bg-base-200/20 hover:border-warning/20 hover:bg-warning/5",
            labelCls: "text-warning",
            iconBgCls: "bg-warning/15 text-warning",
        },
        {
            key: "blocked",
            label: "Block Account",
            desc: "Prevent login entirely",
            icon: Ban,
            activeCls: "border-error/30 bg-error/8",
            inactiveCls: "border-white/[0.06] bg-base-200/20 hover:border-error/20 hover:bg-error/5",
            labelCls: "text-error",
            iconBgCls: "bg-error/15 text-error",
        },
    ];

    async function act(status) {
        setSaving(status);
        try {
            await onSave(user, { status });
            onClose();
        } catch {
            /* parent toast handles error */
        } finally {
            setSaving(null);
        }
    }

    return (
        <Modal onClose={onClose} maxW="max-w-sm">
            <ModalHeader title="Manage Access" subtitle={user.email} icon={UserCheck} iconBg="bg-info/10 ring-info/20" iconCls="text-info" onClose={onClose} />

            {/* user identity card */}
            <div className="mx-5 mt-4 flex items-center gap-3.5 bg-white/[0.03] rounded-xl px-4 py-3.5 border border-white/[0.07]">
                <Avatar user={user} size="sm" />
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-white truncate leading-tight">{user.name || "Unnamed"}</p>
                    <p className="text-xs text-white/40 font-mono truncate mt-0.5">{user.email}</p>
                </div>
                <StatusBadge status={user.status} />
            </div>

            {/* action cards */}
            <div className="p-5 space-y-2.5">
                {ACTIONS.map(({ key, label, desc, icon: Icon, activeCls, inactiveCls, labelCls, iconBgCls }) => {
                    const isCurrent = user.status === key;
                    const isSaving = saving === key;
                    return (
                        <button
                            key={key}
                            type="button"
                            onClick={() => !isCurrent && act(key)}
                            disabled={isCurrent || saving !== null}
                            className={`w-full flex items-center gap-3.5 px-4 py-3.5 rounded-xl transition-all text-left border-none
                                ${isCurrent ? `${activeCls} cursor-not-allowed border border-current/20` : `${inactiveCls} cursor-pointer border border-white/[0.06] hover:border-white/10`}`}>
                            <div
                                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${iconBgCls}
                                shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]`}>
                                {isSaving ? <span className="loading loading-spinner loading-sm" /> : <Icon size={17} strokeWidth={1.8} />}
                            </div>
                            <div className="flex-1 min-w-0 text-left">
                                <p className={`text-sm font-bold leading-tight ${isCurrent ? labelCls : "text-white"}`}>{label}</p>
                                <p className="text-xs text-white/40 mt-0.5 leading-snug">{desc}</p>
                            </div>
                            {isCurrent && (
                                <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${iconBgCls}`}>
                                    <Check size={13} className={labelCls} strokeWidth={2.5} />
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>
        </Modal>
    );
}

// ─── PERMISSION MODAL ─────────────────────────────────────────────────────────

const DURATION_OPTS = [
    { label: "7 days", days: 7 },
    { label: "30 days", days: 30 },
    { label: "90 days", days: 90 },
    { label: "1 year", days: 365 },
];

function PermissionModal({ user, onClose, onSave, libraries = [] }) {
    const [role, setRole] = useState("user");
    const [status, setStatus] = useState("pending");
    const [accessType, setAccessType] = useState("permanent");
    const [duration, setDuration] = useState(30);
    const [allowAdult, setAllowAdult] = useState(false);
    const [libPerms, setLibPerms] = useState({});
    const [libSearch, setLibSearch] = useState("");
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);

    useEffect(() => {
        if (!user) return;
        setRole(user.role || "user");
        setStatus(user.status || "pending");
        setAccessType(user.accessType || "permanent");
        let parsed = {};
        try {
            const raw = user.permissionsJson || user.permissions;
            parsed = typeof raw === "string" ? JSON.parse(raw) : (raw ?? {});
        } catch {
            /* ignore */
        }
        setAllowAdult(parsed?.allowAdult ?? false);
        const map = {};
        libraries.forEach((l) => {
            map[l.id] = parsed?.libraries?.[l.id] ?? true;
        });
        setLibPerms(map);
        setDirty(false);
    }, [user?.id, libraries]);

    if (!user) return null;

    const mark = (fn) => {
        fn();
        setDirty(true);
    };
    const filteredLibs = libraries.filter((l) => !libSearch || (l.label + l.path).toLowerCase().includes(libSearch.toLowerCase()));
    const enabledCount = Object.values(libPerms).filter(Boolean).length;

    async function handleSave() {
        setSaving(true);
        try {
            let accessExpiresAt = null;
            if (accessType === "temporary") {
                const d = new Date();
                d.setDate(d.getDate() + duration);
                accessExpiresAt = d.toISOString();
            }
            const permissions = { libraries: libPerms, allowAdult };
            const permissionsJson = JSON.stringify(permissions);
            await onSave(user, { role, status, accessType, accessExpiresAt, allowAdult, permissions, permissionsJson });
            onClose();
        } catch {
            /* onSave shows toast */
        } finally {
            setSaving(false);
        }
    }

    const STATUS_BTN = {
        approved: { active: "bg-success/15 text-success border-success/30", inactive: "bg-base-200/20 text-white/40 border-white/[0.06] hover:text-white" },
        pending: { active: "bg-warning/15 text-warning border-warning/30", inactive: "bg-base-200/20 text-white/40 border-white/[0.06] hover:text-white" },
        rejected: { active: "bg-error/15   text-error   border-error/30", inactive: "bg-base-200/20 text-white/40 border-white/[0.06] hover:text-white" },
        blocked: { active: "bg-error/10   text-error/80 border-error/20", inactive: "bg-base-200/20 text-white/40 border-white/[0.06] hover:text-white" },
    };

    return (
        <Modal onClose={onClose} maxW="max-w-md">
            <ModalHeader
                title="Permissions"
                subtitle={user.name || user.email}
                icon={KeyRound}
                iconBg="bg-primary/10 ring-primary/20"
                iconCls="text-primary"
                onClose={onClose}
                badge={
                    dirty && (
                        <span
                            className="text-[10px] font-black uppercase tracking-wide text-warning/80
                        bg-warning/8 px-2.5 py-1 rounded-lg border border-warning/20 animate-pulse mr-1">
                            Unsaved
                        </span>
                    )
                }
            />

            <div className="overflow-y-auto max-h-[64vh] px-5 py-4 space-y-5">
                {/* ── Role + Status ── */}
                <div className="grid grid-cols-2 gap-4">
                    {/* Role toggle */}
                    <Section label="Role" icon={Crown} iconCls="text-primary/60">
                        <div className="flex p-0.5 bg-white/[0.04] rounded-xl border border-white/[0.07] gap-0.5">
                            {[
                                { v: "user", Icon: User, label: "User" },
                                { v: "admin", Icon: Crown, label: "Admin" },
                            ].map(({ v, Icon: I, label }) => (
                                <button
                                    key={v}
                                    type="button"
                                    onClick={() => mark(() => setRole(v))}
                                    className={`flex-1 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition-all border-none cursor-pointer
                                        ${role === v ? "bg-primary text-white shadow-sm" : "text-white/40 hover:text-white/80"}`}>
                                    <I size={11} strokeWidth={2} /> {label}
                                </button>
                            ))}
                        </div>
                    </Section>

                    {/* Status 2×2 grid */}
                    <Section label="Status" icon={Shield} iconCls="text-accent/60">
                        <div className="grid grid-cols-2 gap-1">
                            {["approved", "pending", "rejected", "blocked"].map((s) => (
                                <button
                                    key={s}
                                    type="button"
                                    onClick={() => mark(() => setStatus(s))}
                                    className={`py-2 rounded-lg text-[11px] font-bold capitalize transition-all cursor-pointer border
                                        ${status === s ? STATUS_BTN[s].active : STATUS_BTN[s].inactive}`}>
                                    {s}
                                </button>
                            ))}
                        </div>
                    </Section>
                </div>

                {/* ── Access Duration ── */}
                <Section label="Access Duration" icon={Clock} iconCls="text-info/60">
                    <div className="flex p-0.5 bg-white/[0.04] rounded-xl border border-white/[0.07] gap-0.5">
                        {["permanent", "temporary"].map((t) => (
                            <button
                                key={t}
                                type="button"
                                onClick={() => mark(() => setAccessType(t))}
                                className={`flex-1 py-2 rounded-lg text-xs font-bold capitalize transition-all border-none cursor-pointer
                                    ${accessType === t ? "bg-accent text-accent-content shadow-sm" : "text-white/40 hover:text-white/80"}`}>
                                {t}
                            </button>
                        ))}
                    </div>
                    {accessType === "temporary" && (
                        <div className="flex gap-1 mt-2">
                            {DURATION_OPTS.map(({ label, days }) => (
                                <button
                                    key={days}
                                    type="button"
                                    onClick={() => mark(() => setDuration(days))}
                                    className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all border cursor-pointer
                                        ${
                                            duration === days ? "bg-accent/15 text-accent border-accent/30" : "bg-white/[0.03] text-white/40 border-white/[0.06] hover:text-white hover:bg-white/[0.06]"
                                        }`}>
                                    {label}
                                </button>
                            ))}
                        </div>
                    )}
                    {user.accessExpiresAt && (
                        <p className={`text-xs mt-2 flex items-center gap-1 ${isExpired(user) ? "text-error" : "text-white/35"}`}>
                            {isExpired(user) ? <XCircle size={11} /> : <Clock size={11} />}
                            {isExpired(user) ? "Expired:" : "Expires:"} {fmtDate(user.accessExpiresAt)}
                        </p>
                    )}
                </Section>

                {/* ── Adult Content toggle ── */}
                <Section label="Content Access" icon={Eye} iconCls="text-warning/50">
                    <div
                        className={`flex items-center justify-between px-4 py-3.5 rounded-xl border transition-all
                        ${allowAdult ? "bg-warning/[0.06] border-warning/20" : "bg-white/[0.025] border-white/[0.07]"}`}>
                        <div className="flex items-center gap-3">
                            <div
                                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-colors
                                ${allowAdult ? "bg-warning/15 text-warning" : "bg-white/[0.05] text-white/30"}`}>
                                {allowAdult ? <Eye size={16} /> : <EyeOff size={16} />}
                            </div>
                            <div>
                                <p className="text-sm font-bold text-white">Adult Content</p>
                                <p className="text-xs text-white/40 mt-0.5">Allow access to 18+ libraries</p>
                            </div>
                        </div>
                        <Toggle value={allowAdult} onChange={(v) => mark(() => setAllowAdult(v))} />
                    </div>
                </Section>

                {/* ── Library Access ── */}
                {libraries.length > 0 && (
                    <Section label={`Library Access  ${enabledCount}/${libraries.length} enabled`} icon={Library} iconCls="text-primary/60">
                        {/* select all / none */}
                        <div className="flex items-center gap-1 mb-2">
                            <button
                                type="button"
                                onClick={() =>
                                    mark(() => {
                                        const m = {};
                                        libraries.forEach((l) => (m[l.id] = true));
                                        setLibPerms(m);
                                    })
                                }
                                className="px-2.5 py-1 rounded-lg text-xs font-bold text-primary bg-primary/10 border border-primary/20 hover:bg-primary/15 transition-colors cursor-pointer border-none">
                                Select All
                            </button>
                            <button
                                type="button"
                                onClick={() =>
                                    mark(() => {
                                        const m = {};
                                        libraries.forEach((l) => (m[l.id] = false));
                                        setLibPerms(m);
                                    })
                                }
                                className="px-2.5 py-1 rounded-lg text-xs font-bold text-white/40 bg-white/[0.04] border border-white/[0.07] hover:text-white transition-colors cursor-pointer">
                                None
                            </button>
                        </div>

                        {libraries.length > 4 && (
                            <div className="flex items-center gap-2 bg-white/[0.04] rounded-xl px-3 py-2 mb-2 border border-white/[0.07]">
                                <Search size={12} className="text-white/35 shrink-0" />
                                <input
                                    value={libSearch}
                                    onChange={(e) => setLibSearch(e.target.value)}
                                    placeholder="Filter libraries…"
                                    className="flex-1 bg-transparent text-sm text-white placeholder:text-white/35 focus:outline-none"
                                />
                            </div>
                        )}

                        <div className="space-y-1.5 max-h-40 overflow-y-auto pr-0.5">
                            {filteredLibs.map((lib) => {
                                const on = libPerms[lib.id] ?? true;
                                return (
                                    <div
                                        key={lib.id}
                                        className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 border transition-all
                                            ${on ? "bg-primary/[0.04] border-primary/15 hover:border-primary/25" : "bg-white/[0.02] border-white/[0.06] hover:border-white/10"}`}>
                                        <div
                                            className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0
                                            ${on ? "bg-primary/15 text-primary" : "bg-white/[0.05] text-white/25"}`}>
                                            <Library size={13} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className={`text-sm font-semibold truncate leading-tight ${on ? "text-white" : "text-white/35"}`}>{lib.label || lib.path}</p>
                                            {lib.label && <p className="text-[10px] font-mono text-white/25 truncate mt-0.5">{lib.path}</p>}
                                        </div>
                                        <Toggle value={on} onChange={() => mark(() => setLibPerms((p) => ({ ...p, [lib.id]: !p[lib.id] })))} />
                                    </div>
                                );
                            })}
                        </div>
                    </Section>
                )}
            </div>

            {/* ── Footer ── */}
            <div className="flex gap-2.5 px-5 py-4 border-t border-white/[0.07] bg-white/[0.01]">
                <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white/70
                        bg-white/[0.05] hover:bg-white/[0.08] hover:text-white transition-all border-none cursor-pointer">
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving || !dirty}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all border-none
                        ${dirty && !saving ? "bg-primary text-white hover:opacity-90 shadow-[0_4px_16px_rgba(0,0,0,0.4)] cursor-pointer" : "bg-white/[0.04] text-white/25 cursor-not-allowed"}`}>
                    {saving ? (
                        <span className="flex items-center justify-center gap-2">
                            <span className="loading loading-spinner loading-xs" /> Saving…
                        </span>
                    ) : (
                        "Save Changes"
                    )}
                </button>
            </div>
        </Modal>
    );
}

// ─── Users table ─────────────────────────────────────────────────────────────

function UsersTable({ users, onInfo, onRequest, onPermission, onAction }) {
    if (!users.length) return null;
    return (
        <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
            <table className="w-full table-auto border-collapse" style={{ minWidth: 720 }}>
                <thead>
                    <tr className="text-[11px] font-black uppercase tracking-wider text-white/40 bg-base-200/40 border-b border-white/6">
                        <th className="py-3 px-4 text-left">User</th>
                        <th className="py-3 px-3 text-left">Role</th>
                        <th className="py-3 px-3 text-left">Status</th>
                        <th className="py-3 px-3 text-left">Verified</th>
                        <th className="py-3 px-3 text-left">Access</th>
                        <th className="py-3 px-3 text-left hidden sm:table-cell">IP</th>
                        <th className="py-3 px-3 text-center">Sessions</th>
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
                                    {exp ? (
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
                                        {(u._count?.sessions ?? 0) > 0 && <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse shrink-0" />}
                                        <span className="text-sm text-white font-bold tabular-nums">{u._count?.sessions ?? 0}</span>
                                    </div>
                                </td>
                                <td className="py-3 px-3 text-xs text-white/40 whitespace-nowrap hidden sm:table-cell">{u.createdAt ? fmtDateShort(u.createdAt) : "—"}</td>
                                <td className="py-3 px-4">
                                    <div className="flex items-center justify-end gap-1">
                                        <ActionBtn icon={Info} label="Details" onClick={() => onInfo(u)} className="hover:bg-info/15 hover:text-info" />
                                        <ActionBtn
                                            icon={UserCheck}
                                            label="Manage Access"
                                            onClick={() => onRequest(u)}
                                            className="hover:bg-success/15 hover:text-success"
                                            pulse={u.status === "pending"}
                                        />
                                        <ActionBtn icon={KeyRound} label="Permissions" onClick={() => onPermission(u)} className="hover:bg-primary/15 hover:text-primary" />
                                        <ActionMenu user={u} onAction={onAction} />
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
                title: "Delete User",
                message: `Permanently delete ${user.email}? This cannot be undone.`,
                variant: "danger",
                confirmText: "Delete",
                user,
            });
            return;
        }
        if (statusMap[key]) {
            setConfirm({
                title: { approve: "Approve User", reject: "Reject User", block: "Block User" }[key],
                message: `${key.charAt(0).toUpperCase() + key.slice(1)} ${user.name || user.email}?`,
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
            showToast(confirm.title + " done");
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
        <div className="space-y-5 max-w-full">
            {/* ── Page header ─────────────────────────────────────────────── */}
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-black text-white tracking-tight">User Management</h1>
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
                        <div key={i} className="bg-base-200/40 rounded-xl border border-white/6 px-4 py-4 flex items-center gap-3.5">
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
            <div className="space-y-2">
                {/* Search */}
                <div className="flex items-center gap-2 bg-base-100 rounded-lg px-3.5 h-10 border border-white/8 focus-within:border-primary/30 transition-colors">
                    <Search size={15} className="text-white/35 shrink-0" />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by name or email…"
                        className="flex-1 bg-transparent text-sm text-white placeholder:text-white/35 focus:outline-none"
                    />
                    {search && (
                        <button onClick={() => setSearch("")} className="text-white/35 hover:text-white transition-colors border-none bg-transparent cursor-pointer">
                            <X size={14} />
                        </button>
                    )}
                </div>

                {/* Status tabs */}
                <div className="flex bg-base-200/30 rounded-lg p-0.5 gap-0.5 overflow-x-auto border border-white/5" style={{ scrollbarWidth: "none" }}>
                    {STATUS_TABS.map((t) => (
                        <button
                            key={t.v}
                            onClick={() => setStatusFilter(t.v)}
                            className={`px-3 py-1.5 rounded-md text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 shrink-0 cursor-pointer border-none
                                ${statusFilter === t.v ? "bg-primary text-primary-content shadow-sm" : "text-white/50 hover:text-white hover:bg-white/5"}`}>
                            {t.label}
                            {t.alert && pendingTotal > 0 && <span className="px-1.5 py-0.5 rounded-md bg-warning text-warning-content text-[10px] font-black tabular-nums">{pendingTotal}</span>}
                        </button>
                    ))}
                </div>
            </div>

            {/* ── Table card ──────────────────────────────────────────────── */}
            <div className="bg-base-100 rounded-xl overflow-hidden border border-white/6 shadow-sm">
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
            <InfoModal user={infoUser} onClose={() => setInfoUser(null)} />
            <RequestModal user={reqUser} onClose={() => setReqUser(null)} onSave={handleSave} />
            <PermissionModal user={permUser} onClose={() => setPermUser(null)} onSave={handleSave} libraries={libraries} />
            <ConfirmModal
                open={!!confirm}
                onClose={() => !actionLoading && setConfirm(null)}
                onConfirm={executeAction}
                title={confirm?.title}
                message={confirm?.message}
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
