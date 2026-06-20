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

function Modal({ onClose, children, maxW = "max-w-md" }) {
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
                className={`modal-box ${maxW} w-[calc(100vw-1.5rem)] sm:w-full p-0 overflow-hidden
                bg-base-300 rounded-md border border-white/9
                shadow-[0_4px_6px_rgba(0,0,0,0.3),0_16px_48px_rgba(0,0,0,0.7)]`}
                style={{ animation: "mIn .15s cubic-bezier(.16,1,.3,1)", maxHeight: "calc(100vh - 3rem)" }}>
                {children}
            </div>
            <div className="modal-backdrop bg-black/75" onClick={onClose} />
            <style>{`
                @keyframes mIn{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}
                .hs{scrollbar-width:none}.hs::-webkit-scrollbar{display:none}
            `}</style>
        </dialog>
    );
}

function ModalHeader({ title, subtitle, icon: Icon, iconCls = "text-primary", onClose, badge }) {
    return (
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.07] bg-base-200">
            {Icon && (
                <div className={`w-8 h-8 rounded-md bg-white/[0.07] flex items-center justify-center shrink-0 ${iconCls}`}>
                    <Icon size={16} strokeWidth={1.8} />
                </div>
            )}
            <div className="flex-1 min-w-0">
                <h3 className="text-sm font-bold text-white leading-tight">{title}</h3>
                {subtitle && <p className="text-[11px] text-white/45 truncate mt-0.5">{subtitle}</p>}
            </div>
            {badge}
            <button
                onClick={onClose}
                className="w-7 h-7 rounded-md flex items-center justify-center text-white/35 border-none
                    hover:text-white hover:bg-white/8 transition-all shrink-0 cursor-pointer">
                <X size={14} strokeWidth={2} />
            </button>
        </div>
    );
}

function Section({ label, icon: Icon, iconCls = "text-white/35", children }) {
    return (
        <div className="space-y-2">
            <div className="flex items-center gap-1.5">
                {Icon && <Icon size={10} className={`shrink-0 ${iconCls}`} strokeWidth={2.5} />}
                <span className="text-[10px] font-black uppercase tracking-[0.12em] text-white/40">{label}</span>
                <div className="flex-1 h-px bg-white/5" />
            </div>
            {children}
        </div>
    );
}

function FieldRow({ label, value }) {
    return (
        <div className="flex justify-between items-center py-1.5 border-b border-white/4 last:border-0">
            <dt className="text-xs text-white/45 font-medium shrink-0 mr-3">{label}</dt>
            <dd className="text-xs text-white font-semibold text-right max-w-[65%] truncate">{value}</dd>
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
        <Modal onClose={onClose} maxW="max-w-md">
            {/* ── Header ── */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.07] bg-base-200">
                <div className="relative shrink-0">
                    <Avatar user={user} size="md" />
                    {active.length > 0 && <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-success border-2 border-base-200" />}
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-white truncate">{user.name || "Unnamed"}</p>
                    <p className="text-[11px] text-white/40 font-mono truncate">{user.email}</p>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <RoleBadge role={user.role} />
                        <StatusBadge status={user.status} />
                    </div>
                </div>
                <button
                    onClick={onClose}
                    className="w-7 h-7 rounded-md flex items-center justify-center text-white/30 border-none
                        hover:text-white hover:bg-white/8 transition-all cursor-pointer shrink-0 self-start mt-0.5">
                    <X size={14} strokeWidth={2} />
                </button>
            </div>

            {/* ── Stats bar ── */}
            <div className="grid grid-cols-3 divide-x divide-white/6 bg-base-200/50 border-b border-white/6">
                {[
                    { label: "Sessions", val: user._count?.sessions ?? active.length, cls: "text-primary" },
                    { label: "Watched", val: user._count?.watchHistory ?? 0, cls: "text-info" },
                    { label: "Last seen", val: lastMs ? fmtRel(lastMs) : "—", cls: "text-white/70" },
                ].map(({ label, val, cls }) => (
                    <div key={label} className="flex flex-col items-center py-2.5 px-2">
                        <span className={`text-sm font-black tabular-nums leading-none ${cls}`}>{val}</span>
                        <span className="text-[9px] text-white/35 uppercase tracking-wider mt-0.5">{label}</span>
                    </div>
                ))}
            </div>

            {/* ── Scrollable body ── */}
            <div className="hs overflow-y-auto" style={{ maxHeight: "calc(min(65vh, 420px))" }}>
                {/* Account section */}
                <div className="px-4 pt-4 pb-0">
                    <Section label="Account" icon={User} iconCls="text-primary/60">
                        <div className="bg-base-200/60 rounded-md border border-white/6 px-1">
                            <FieldRow label="User ID" value={<span className="font-mono text-[10px] text-white/50">{user.id.slice(0, 18)}…</span>} />
                            <FieldRow
                                label="Verified"
                                value={user.emailVerified ? <span className="text-success font-bold">✓ Verified</span> : <span className="text-warning font-bold">✗ Unverified</span>}
                            />
                            <FieldRow label="Joined" value={fmtDate(user.createdAt)} />
                            <FieldRow label="Updated" value={fmtDate(user.updatedAt)} />
                        </div>
                    </Section>
                </div>

                {/* Access section */}
                <div className="px-4 pt-4 pb-0">
                    <Section label="Access" icon={Shield} iconCls="text-accent/60">
                        <div className="bg-base-200/60 rounded-md border border-white/6 px-1">
                            <FieldRow label="Type" value={<span className="capitalize">{user.accessType || "Permanent"}</span>} />
                            {user.accessType === "temporary" && <FieldRow label="Expires" value={<span className={expired ? "text-error font-bold" : ""}>{fmtDate(user.accessExpiresAt)}</span>} />}
                            <FieldRow
                                label="Restricted content"
                                value={user.permissions?.allowAdult ? <span className="text-warning font-bold">Unrestricted</span> : <span className="text-white/50">Restricted</span>}
                            />
                            <FieldRow label="Last IP" value={<span className="font-mono text-[10px] text-white/50">{user.lastIp || "—"}</span>} />
                        </div>
                    </Section>
                </div>

                {/* Sessions section */}
                <div className="px-4 pt-4 pb-4">
                    <Section label={`Sessions${active.length > 0 ? ` · ${active.length} active` : ""}`} icon={Monitor} iconCls="text-success/60">
                        {sessLoading ? (
                            <div className="space-y-1.5">
                                {[1, 2].map((i) => (
                                    <div key={i} className="flex gap-3 items-center px-3 py-2.5 rounded-md bg-base-200/60 border border-white/5">
                                        <div className="w-7 h-7 rounded-md bg-white/5 animate-pulse shrink-0" />
                                        <div className="flex-1 space-y-1.5">
                                            <div className="h-2.5 w-28 bg-white/5 rounded animate-pulse" />
                                            <div className="h-2 w-20 bg-white/4 rounded animate-pulse" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : active.length === 0 ? (
                            <div className="flex items-center gap-2.5 px-3 py-3 rounded-md border border-dashed border-white/8 bg-base-200/30">
                                <WifiOff size={14} className="text-white/20 shrink-0" />
                                <p className="text-xs text-white/35">No active sessions</p>
                            </div>
                        ) : (
                            <div className="space-y-1.5">
                                {active.map((s) => (
                                    <div
                                        key={s.id}
                                        className="flex items-center gap-3 px-3 py-2.5 rounded-md
                                        bg-base-200/60 border border-white/6 hover:border-white/10 transition-colors">
                                        <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center text-primary shrink-0">{deviceIcon(s.userAgent ?? "")}</div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-semibold text-white truncate">{[s.browser, s.os].filter(Boolean).join(" · ") || s.userAgent || "Unknown Device"}</p>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                {s.ip && <span className="text-[10px] font-mono text-white/35">{s.ip}</span>}
                                                {s.lastSeenAt && (
                                                    <span className="text-[10px] text-white/35 flex items-center gap-0.5">
                                                        <Clock size={9} /> {fmtRel(s.lastSeenAt)}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => revoke(s.id)}
                                            title="Revoke"
                                            disabled={revoking === s.id}
                                            className="w-6 h-6 rounded-md flex items-center justify-center text-white/25 border-none
                                                hover:bg-error/15 hover:text-error transition-all shrink-0 disabled:opacity-40 cursor-pointer">
                                            {revoking === s.id ? <span className="loading loading-spinner loading-xs" /> : <LogOut size={12} />}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Section>
                </div>
            </div>
        </Modal>
    );
}

// ─── REQUEST MODAL ────────────────────────────────────────────────────────────

const DURATION_OPTS = [
    { label: "7d", days: 7 },
    { label: "30d", days: 30 },
    { label: "90d", days: 90 },
    { label: "1 yr", days: 365 },
];

function RequestModal({ user, onClose, onSave }) {
    const [role, setRole] = useState("user");
    const [status, setStatus] = useState("pending");
    const [accessType, setAccessType] = useState("permanent");
    const [duration, setDuration] = useState(30);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);

    useEffect(() => {
        if (!user) return;
        setRole(user.role || "user");
        setStatus(user.status || "pending");
        setAccessType(user.accessType || "permanent");
        setDirty(false);
    }, [user?.id]);

    if (!user) return null;

    const mark = (fn) => {
        fn();
        setDirty(true);
    };
    const expired = isExpired(user);

    async function handleSave() {
        setSaving(true);
        try {
            let accessExpiresAt = null;
            if (accessType === "temporary") {
                const d = new Date();
                d.setDate(d.getDate() + duration);
                accessExpiresAt = d.toISOString();
            }
            await onSave(user, { role, status, accessType, accessExpiresAt });
            onClose();
        } catch {
            /* parent toast handles */
        } finally {
            setSaving(false);
        }
    }

    const STATUS_CFG2 = {
        approved: { active: "bg-success/15 text-success border-success/25", inactive: "bg-white/4 text-white/45 border-white/6 hover:text-white" },
        pending: { active: "bg-warning/15 text-warning border-warning/25", inactive: "bg-white/4 text-white/45 border-white/6 hover:text-white" },
        rejected: { active: "bg-error/15   text-error   border-error/25", inactive: "bg-white/4 text-white/45 border-white/6 hover:text-white" },
        blocked: { active: "bg-error/10   text-error/80 border-error/20", inactive: "bg-white/4 text-white/45 border-white/6 hover:text-white" },
    };

    return (
        <Modal onClose={onClose} maxW="max-w-md">
            <ModalHeader
                title="Manage Access"
                subtitle={user.name || user.email}
                icon={UserCheck}
                onClose={onClose}
                badge={
                    dirty && (
                        <span className="text-[10px] font-black uppercase tracking-wide text-warning/80 bg-warning/8 px-2 py-0.5 rounded border border-warning/20 animate-pulse mr-1">Unsaved</span>
                    )
                }
            />

            {/* scrollable body */}
            <div className="hs overflow-y-auto" style={{ maxHeight: "calc(min(65vh, 440px))" }}>
                {/* user identity */}
                <div className="flex items-center gap-3 mx-4 mt-4 px-3 py-2.5 rounded-md bg-base-200/60 border border-white/[0.07]">
                    <Avatar user={user} size="sm" />
                    <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-white truncate">{user.name || "Unnamed"}</p>
                        <p className="text-[10px] text-white/40 font-mono truncate">{user.email}</p>
                    </div>
                    <StatusBadge status={user.status} />
                </div>

                <div className="px-4 pt-4 pb-4 space-y-3">
                    {/* Status dropdown — FIRST */}
                    <div className="space-y-1.5">
                        <label className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-white/40">
                            <Shield size={10} strokeWidth={2.5} className="text-accent/55" /> Status
                            <div className="flex-1 h-px bg-white/5" />
                        </label>
                        <div className="relative">
                            <select
                                value={status}
                                onChange={(e) => mark(() => setStatus(e.target.value))}
                                className="w-full appearance-none px-3 py-2.5 rounded-md bg-base-200/60 border border-white/9
                                    text-sm font-semibold text-white cursor-pointer
                                    focus:outline-none focus:border-primary/40 transition-colors
                                    hover:border-white/15">
                                <option value="approved" className="bg-base-300 text-white">
                                    Approved
                                </option>
                                <option value="pending" className="bg-base-300 text-white">
                                    Pending
                                </option>
                                <option value="rejected" className="bg-base-300 text-white">
                                    Rejected
                                </option>
                                <option value="blocked" className="bg-base-300 text-white">
                                    Blocked
                                </option>
                            </select>
                            <ChevronRight size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 rotate-90 pointer-events-none" />
                            {/* colored dot indicator */}
                            <span
                                className={`absolute left-3 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full pointer-events-none
                                ${status === "approved" ? "bg-success" : status === "pending" ? "bg-warning" : "bg-error"}`}
                                style={{ left: "unset", right: "2.5rem" }}
                            />
                        </div>
                    </div>

                    {/* Role dropdown — SECOND */}
                    <div className="space-y-1.5">
                        <label className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-white/40">
                            <Crown size={10} strokeWidth={2.5} className="text-primary/55" /> Role
                            <div className="flex-1 h-px bg-white/5" />
                        </label>
                        <div className="relative">
                            <select
                                value={role}
                                onChange={(e) => mark(() => setRole(e.target.value))}
                                className="w-full appearance-none px-3 py-2.5 rounded-md bg-base-200/60 border border-white/9
                                    text-sm font-semibold text-white cursor-pointer
                                    focus:outline-none focus:border-primary/40 transition-colors
                                    hover:border-white/15">
                                <option value="user" className="bg-base-300 text-white">
                                    User
                                </option>
                                <option value="admin" className="bg-base-300 text-white">
                                    Admin
                                </option>
                            </select>
                            <ChevronRight size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 rotate-90 pointer-events-none" />
                        </div>
                    </div>

                    {/* Access Duration — THIRD */}
                    <div className="space-y-1.5">
                        <label className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-white/40">
                            <Clock size={10} strokeWidth={2.5} className="text-info/55" /> Access Duration
                            <div className="flex-1 h-px bg-white/5" />
                        </label>
                        <div className="flex p-0.5 bg-base-200/60 rounded-md border border-white/9 gap-0.5">
                            {["permanent", "temporary"].map((t) => (
                                <button
                                    key={t}
                                    type="button"
                                    onClick={() => mark(() => setAccessType(t))}
                                    className={`flex-1 py-2 rounded text-xs font-bold capitalize transition-all border-none cursor-pointer
                                        ${accessType === t ? "bg-accent text-accent-content shadow-sm" : "text-white/40 hover:text-white"}`}>
                                    {t}
                                </button>
                            ))}
                        </div>
                        {accessType === "temporary" && (
                            <div className="grid grid-cols-4 gap-1 mt-1">
                                {DURATION_OPTS.map(({ label, days }) => (
                                    <button
                                        key={days}
                                        type="button"
                                        onClick={() => mark(() => setDuration(days))}
                                        className={`py-2 rounded text-xs font-bold transition-all border cursor-pointer
                                            ${duration === days ? "bg-accent/15 text-accent border-accent/30" : "bg-base-200/40 text-white/40 border-white/8 hover:text-white"}`}>
                                        {label}
                                    </button>
                                ))}
                            </div>
                        )}
                        {user.accessExpiresAt && (
                            <p className={`text-[10px] flex items-center gap-1 mt-1 ${expired ? "text-error" : "text-white/35"}`}>
                                {expired ? <XCircle size={10} /> : <Clock size={10} />}
                                {expired ? "Expired:" : "Expires:"} {fmtDate(user.accessExpiresAt)}
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {/* footer */}
            <div className="flex gap-2 px-4 py-3 border-t border-white/[0.07] bg-base-200/30">
                <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 py-2 rounded-md text-xs font-bold text-white/60
                        bg-white/6 hover:bg-white/9 hover:text-white transition-all border-none cursor-pointer">
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving || !dirty}
                    className={`flex-1 py-2 rounded-md text-xs font-bold transition-all border-none
                        ${dirty && !saving ? "bg-primary text-white hover:opacity-90 cursor-pointer" : "bg-white/4 text-white/25 cursor-not-allowed"}`}>
                    {saving ? (
                        <span className="flex items-center justify-center gap-1.5">
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

// ─── PERMISSION MODAL ─────────────────────────────────────────────────────────

function PermissionModal({ user, onClose, onSave, libraries = [] }) {
    const [allowAdult, setAllowAdult] = useState(false);
    const [libPerms, setLibPerms] = useState({});
    const [libSearch, setLibSearch] = useState("");
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);

    useEffect(() => {
        if (!user) return;
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
            const permissions = { libraries: libPerms, allowAdult };
            const permissionsJson = JSON.stringify(permissions);
            // keep role/status/accessType unchanged — only permissions updated here
            await onSave(user, { allowAdult, permissions, permissionsJson });
            onClose();
        } catch {
            /* onSave shows toast */
        } finally {
            setSaving(false);
        }
    }

    return (
        <Modal onClose={onClose} maxW="max-w-md">
            <ModalHeader
                title="Content Permissions"
                subtitle={user.name || user.email}
                icon={KeyRound}
                onClose={onClose}
                badge={
                    dirty && (
                        <span className="text-[10px] font-black uppercase tracking-wide text-warning/80 bg-warning/8 px-2 py-0.5 rounded border border-warning/20 animate-pulse mr-1">Unsaved</span>
                    )
                }
            />

            {/* single universal scroll — no inner scroll */}
            <div className="hs overflow-y-auto" style={{ maxHeight: "calc(min(65vh, 460px))" }}>
                <div className="px-4 pt-4 pb-4 space-y-4">
                    {/* user identity */}
                    <div className="flex items-center gap-3 px-3 py-2.5 rounded-md bg-base-200/60 border border-white/[0.07]">
                        <Avatar user={user} size="sm" />
                        <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-white truncate">{user.name || "Unnamed"}</p>
                            <p className="text-[10px] text-white/40 font-mono truncate">{user.email}</p>
                        </div>
                        <RoleBadge role={user.role} />
                    </div>

                    {/* Restricted content toggle */}
                    <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5">
                            <EyeOff size={10} className="text-warning/55 shrink-0" strokeWidth={2.5} />
                            <span className="text-[10px] font-black uppercase tracking-[0.12em] text-white/40">Restricted Content</span>
                            <div className="flex-1 h-px bg-white/5" />
                        </div>
                        <div
                            className={`flex items-center justify-between px-3 py-3 rounded-md border transition-colors
                            ${allowAdult ? "bg-warning/5 border-warning/20" : "bg-base-200/60 border-white/8"}`}>
                            <div className="flex items-center gap-3">
                                <div
                                    className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0
                                    ${allowAdult ? "bg-warning/15 text-warning" : "bg-white/5 text-white/30"}`}>
                                    {allowAdult ? <Eye size={15} /> : <EyeOff size={15} />}
                                </div>
                                <div>
                                    <p className="text-xs font-bold text-white">{allowAdult ? "Unrestricted" : "Restricted"}</p>
                                    <p className="text-[10px] text-white/40 mt-0.5">{allowAdult ? "18+ content is accessible" : "18+ content is blocked"}</p>
                                </div>
                            </div>
                            <Toggle value={allowAdult} onChange={(v) => mark(() => setAllowAdult(v))} />
                        </div>
                    </div>

                    {/* Library access — all rendered, universal scroll handles overflow */}
                    {libraries.length > 0 && (
                        <div className="space-y-2">
                            <div className="flex items-center gap-1.5">
                                <Library size={10} className="text-primary/55 shrink-0" strokeWidth={2.5} />
                                <span className="text-[10px] font-black uppercase tracking-[0.12em] text-white/40">
                                    Libraries · {enabledCount}/{libraries.length}
                                </span>
                                <div className="flex-1 h-px bg-white/5" />
                                <button
                                    type="button"
                                    onClick={() =>
                                        mark(() => {
                                            const m = {};
                                            libraries.forEach((l) => (m[l.id] = true));
                                            setLibPerms(m);
                                        })
                                    }
                                    className="text-[10px] font-bold text-primary hover:opacity-70 transition-opacity cursor-pointer border-none bg-transparent ml-1">
                                    All
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
                                    className="text-[10px] font-bold text-white/35 hover:text-white transition-colors cursor-pointer border-none bg-transparent">
                                    None
                                </button>
                            </div>

                            {libraries.length > 5 && (
                                <div className="flex items-center gap-2 bg-base-200/60 rounded-md px-2.5 py-2 border border-white/8">
                                    <Search size={11} className="text-white/35 shrink-0" />
                                    <input
                                        value={libSearch}
                                        onChange={(e) => setLibSearch(e.target.value)}
                                        placeholder="Filter libraries…"
                                        className="flex-1 bg-transparent text-xs text-white placeholder:text-white/35 focus:outline-none"
                                    />
                                </div>
                            )}

                            <div className="space-y-1">
                                {filteredLibs.map((lib) => {
                                    const on = libPerms[lib.id] ?? true;
                                    return (
                                        <div
                                            key={lib.id}
                                            className={`flex items-center gap-3 px-3 py-2.5 rounded-md border transition-colors
                                                ${on ? "bg-primary/4 border-primary/12" : "bg-base-200/40 border-white/[0.07]"}`}>
                                            <div
                                                className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0
                                                ${on ? "bg-primary/15 text-primary" : "bg-white/5 text-white/25"}`}>
                                                <Library size={12} />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className={`text-xs font-semibold truncate ${on ? "text-white" : "text-white/35"}`}>{lib.label || lib.path}</p>
                                                {lib.label && <p className="text-[10px] font-mono text-white/25 truncate">{lib.path}</p>}
                                            </div>
                                            <Toggle value={on} onChange={() => mark(() => setLibPerms((p) => ({ ...p, [lib.id]: !p[lib.id] })))} />
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* footer */}
            <div className="flex gap-2 px-4 py-3 border-t border-white/[0.07] bg-base-200/30">
                <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 py-2 rounded-md text-xs font-bold text-white/60
                        bg-white/6 hover:bg-white/9 hover:text-white transition-all border-none cursor-pointer">
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving || !dirty}
                    className={`flex-1 py-2 rounded-md text-xs font-bold transition-all border-none
                        ${dirty && !saving ? "bg-primary text-white hover:opacity-90 cursor-pointer" : "bg-white/4 text-white/25 cursor-not-allowed"}`}>
                    {saving ? (
                        <span className="flex items-center justify-center gap-1.5">
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
