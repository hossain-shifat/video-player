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
    approved: { dot: "bg-success", badge: "border-success/40 text-success", label: "Approved" },
    pending: { dot: "bg-warning", badge: "border-warning/40 text-warning", label: "Pending" },
    rejected: { dot: "bg-error", badge: "border-error/40  text-error", label: "Rejected" },
    blocked: { dot: "bg-error/70", badge: "border-error/30  text-error/80", label: "Blocked" },
};

function StatusBadge({ status }) {
    const c = STATUS_CFG[status] ?? {
        dot: "bg-base-content/30",
        badge: "border-base-content/20 text-base-content/60",
        label: status,
    };
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-xs font-bold ${c.badge}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
            {c.label}
        </span>
    );
}

function RoleBadge({ role }) {
    return role === "admin" ? (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-primary/40 text-primary text-xs font-bold">
            <Crown size={11} /> Admin
        </span>
    ) : (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-base-content/20 text-white/70 text-xs font-bold">
            <User size={11} /> User
        </span>
    );
}

function Avatar({ user, size = "sm" }) {
    const dim = { sm: "w-7 h-7 text-xs", md: "w-9 h-9 text-sm", lg: "w-11 h-11 text-base" }[size] ?? "w-7 h-7 text-xs";
    const initial = (user.name || user.email || "U")[0].toUpperCase();
    if (user.avatar) return <img src={user.avatar} alt="" className={`${dim} rounded-full object-cover ring-1 ring-base-300 shrink-0`} />;
    return <div className={`${dim} rounded-full bg-primary/20 flex items-center justify-center font-black text-primary ring-1 ring-primary/20 shrink-0`}>{initial}</div>;
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ toast }) {
    if (!toast) return null;
    return createPortal(
        <div
            className={`fixed bottom-5 right-5 z-[99999] flex items-center gap-2 px-4 py-2.5
            rounded-xl shadow-2xl text-xs font-bold max-w-xs animate-[slideUp_0.2s_ease-out]
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
            className={`relative w-8 h-4 rounded-full transition-colors duration-200 shrink-0 disabled:opacity-40
                ${value ? "bg-primary" : "bg-white/15"}`}>
            <span
                className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all duration-200
                ${value ? "left-[17px]" : "left-0.5"}`}
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
                text-white/60 transition-all duration-150 cursor-pointer
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
    const MENU_W = 160;

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
                className="w-8 h-8 rounded-md flex items-center justify-center text-white/60
                    hover:bg-warning/10 hover:text-warning transition-all duration-150
                    focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50">
                <MoreVertical size={15} strokeWidth={1.8} />
            </button>

            {open &&
                createPortal(
                    <div
                        ref={menuRef}
                        style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 99999, minWidth: MENU_W }}
                        className="bg-base-200 border border-white/10 rounded-md shadow-2xl py-1 overflow-hidden">
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
                                    className={`flex items-center gap-2 w-full px-3 py-2 text-sm font-semibold transition-colors ${a.cls}`}>
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
                className={`modal-box ${maxW} p-0 overflow-hidden bg-base-100
                rounded-md shadow-[0_24px_64px_rgba(0,0,0,0.75)] border border-white/[0.07]`}>
                {children}
            </div>
            <div className="modal-backdrop bg-black/75 backdrop-blur-[2px]" onClick={onClose} />
        </dialog>
    );
}

function ModalHeader({ title, subtitle, icon: Icon, iconCls = "text-primary", onClose, badge }) {
    return (
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.06]">
            {Icon && (
                <div className={`w-9 h-9 rounded-md bg-base-300/50 flex items-center justify-center shrink-0 ${iconCls}`}>
                    <Icon size={18} />
                </div>
            )}
            <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold text-white leading-tight">{title}</h3>
                {subtitle && <p className="text-xs text-white/50 truncate mt-0.5">{subtitle}</p>}
            </div>
            {badge}
            <button
                onClick={onClose}
                className="w-8 h-8 rounded-md flex items-center justify-center text-white/40
                    hover:text-white hover:bg-white/8 transition-colors shrink-0 cursor-pointer">
                <X size={16} />
            </button>
        </div>
    );
}

function Section({ label, icon: Icon, iconCls = "text-primary/70", children }) {
    return (
        <div className="space-y-2">
            <p className="text-xs font-black uppercase tracking-widest text-white/50 flex items-center gap-1.5">
                {Icon && <Icon size={12} className={iconCls} />}
                {label}
            </p>
            {children}
        </div>
    );
}

function FieldRow({ label, value }) {
    return (
        <div className="flex justify-between items-center py-1.5 px-0 border-b border-white/[0.04] last:border-0">
            <dt className="text-sm text-white/50 font-medium shrink-0 mr-4">{label}</dt>
            <dd className="text-sm text-white/90 font-semibold text-right max-w-[60%] truncate">{value}</dd>
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
        <Modal onClose={onClose} maxW="max-w-xl">
            {/* header — avatar style */}
            <div className="flex items-center gap-3.5 px-5 py-4 border-b border-white/[0.06]">
                <Avatar user={user} size="md" />
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-bold text-white">{user.name || "Unnamed"}</span>
                        <RoleBadge role={user.role} />
                        <StatusBadge status={user.status} />
                    </div>
                    <p className="text-[11px] text-white/40 font-mono mt-0.5 truncate">{user.email}</p>
                </div>
                <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-white/30 hover:text-white hover:bg-white/8 transition-colors cursor-pointer">
                    <X size={14} />
                </button>
            </div>

            {/* body */}
            <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-white/[0.05] max-h-[68vh] overflow-y-auto">
                {/* left */}
                <div className="p-5 space-y-5">
                    <Section label="Account" icon={User}>
                        <dl className="space-y-0">
                            <FieldRow label="ID" value={<span className="font-mono text-xs text-white/60">{user.id.slice(0, 16)}…</span>} />
                            <FieldRow label="Email" value={<span className={user.emailVerified ? "text-success" : "text-warning"}>{user.emailVerified ? "✓ Verified" : "✗ Unverified"}</span>} />
                            <FieldRow label="Joined" value={fmtDate(user.createdAt)} />
                            <FieldRow label="Updated" value={fmtDate(user.updatedAt)} />
                        </dl>
                    </Section>

                    <Section label="Access" icon={Shield} iconCls="text-accent/70">
                        <dl className="space-y-0">
                            <FieldRow label="Type" value={<span className="capitalize">{user.accessType || "Permanent"}</span>} />
                            {user.accessType === "temporary" && <FieldRow label="Expires" value={<span className={expired ? "text-error" : ""}>{fmtDate(user.accessExpiresAt)}</span>} />}
                            <FieldRow label="Content" value={user.permissions?.allowAdult ? <span className="text-warning">18+ Allowed</span> : "Restricted"} />
                            <FieldRow label="Last IP" value={<span className="font-mono text-xs text-white/60">{user.lastIp || "—"}</span>} />
                        </dl>
                    </Section>

                    {/* stat pills */}
                    <div className="grid grid-cols-2 gap-2">
                        {[
                            { label: "Logins", val: user._count?.sessions ?? sessions.length, cls: "text-primary" },
                            { label: "Watched", val: user._count?.watchHistory ?? "—", cls: "text-info" },
                        ].map(({ label, val, cls }) => (
                            <div key={label} className="bg-base-200/25 rounded-md p-3 text-center border border-white/[0.05]">
                                <p className={`text-2xl font-black ${cls}`}>{val}</p>
                                <p className="text-xs uppercase tracking-wide text-white/50 mt-0.5">{label}</p>
                            </div>
                        ))}
                    </div>

                    {lastMs && (
                        <p className="text-xs text-white/50 text-center">
                            Last active: <span className="text-white/80 font-semibold">{fmtRel(lastMs)}</span>
                        </p>
                    )}
                </div>

                {/* right — sessions */}
                <div className="p-5">
                    <div className="flex items-center justify-between mb-3">
                        <p className="text-xs font-black uppercase tracking-widest text-white/50 flex items-center gap-1.5">
                            <Monitor size={12} className="text-success/70" /> Sessions
                        </p>
                        {active.length > 0 && <span className="text-xs font-bold text-success bg-success/10 px-2 py-0.5 rounded-md">{active.length} live</span>}
                    </div>

                    {sessLoading ? (
                        <div className="flex justify-center py-10">
                            <span className="loading loading-spinner loading-sm text-primary" />
                        </div>
                    ) : active.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-10 rounded-xl border border-white/[0.05] border-dashed">
                            <WifiOff size={20} className="text-white/30 mb-2" />
                            <p className="text-sm text-white/50">No active sessions</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {active.map((s) => (
                                <div key={s.id} className="flex items-center gap-2.5 bg-base-200/20 rounded-md px-3 py-2.5 border border-white/[0.05] group">
                                    <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center text-primary shrink-0">{deviceIcon(s.userAgent ?? "")}</div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-white/90 truncate">{[s.browser, s.os].filter(Boolean).join(" · ") || s.userAgent || "Unknown"}</p>
                                        <div className="flex items-center gap-2 mt-0.5">
                                            {s.ip && <span className="text-xs font-mono text-white/50">{s.ip}</span>}
                                            {s.lastSeenAt && (
                                                <span className="text-xs text-white/50 flex items-center gap-0.5">
                                                    <Clock size={10} /> {fmtRel(s.lastSeenAt)}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => revoke(s.id)}
                                        title="Revoke session"
                                        disabled={revoking === s.id}
                                        className="w-7 h-7 rounded-md flex items-center justify-center text-white/40
                                            hover:bg-error/20 hover:text-error transition-colors shrink-0 disabled:opacity-40 cursor-pointer">
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
            <ModalHeader title="Manage Access" subtitle={user.email} icon={UserCheck} onClose={onClose} />

            {/* user pill */}
            <div className="mx-5 mt-4 flex items-center gap-3 bg-base-200/30 rounded-md px-3.5 py-3 border border-white/[0.06]">
                <Avatar user={user} size="sm" />
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-white truncate">{user.name || "Unnamed"}</p>
                    <p className="text-xs text-white/50 font-mono truncate">{user.email}</p>
                </div>
                <StatusBadge status={user.status} />
            </div>

            {/* action list */}
            <div className="p-5 space-y-2">
                {ACTIONS.map(({ key, label, desc, icon: Icon, activeCls, inactiveCls, labelCls, iconBgCls }) => {
                    const isCurrent = user.status === key;
                    const isSaving = saving === key;
                    return (
                        <button
                            key={key}
                            type="button"
                            onClick={() => !isCurrent && act(key)}
                            disabled={isCurrent || saving !== null}
                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-md transition-all text-left border
                                ${isCurrent ? `${activeCls} opacity-60 cursor-not-allowed` : `${inactiveCls} cursor-pointer`}`}>
                            <div className={`w-10 h-10 rounded-md flex items-center justify-center shrink-0 ${iconBgCls}`}>
                                {isSaving ? <span className="loading loading-spinner loading-sm" /> : <Icon size={18} />}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className={`text-sm font-bold ${isCurrent ? labelCls : "text-white"}`}>{label}</p>
                                <p className="text-xs text-white/50 mt-0.5">{desc}</p>
                            </div>
                            {isCurrent && <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${labelCls} bg-current/10`}>Current</span>}
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
        // Parse permissions — support both permissionsJson (string) and permissions (obj)
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
            // Send both formats so backend can pick what it needs
            const permissions = { libraries: libPerms, allowAdult: allowAdult };
            const permissionsJson = JSON.stringify(permissions);
            await onSave(user, {
                role,
                status,
                accessType,
                accessExpiresAt,
                allowAdult: allowAdult,
                permissions,
                permissionsJson,
            });
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
                onClose={onClose}
                badge={dirty && <span className="text-xs font-bold text-warning bg-warning/10 px-2 py-0.5 rounded-md animate-pulse mr-1">Unsaved</span>}
            />

            <div className="overflow-y-auto max-h-[64vh] p-5 space-y-5">
                {/* Role + Status */}
                <div className="grid grid-cols-2 gap-4">
                    <Section label="Role" icon={Crown} iconCls="text-primary/60">
                        <div className="flex gap-1 bg-base-200/30 p-0.5 rounded-md border border-white/[0.06]">
                            {["user", "admin"].map((r) => (
                                <button
                                    key={r}
                                    type="button"
                                    onClick={() => mark(() => setRole(r))}
                                    className={`flex-1 py-2 rounded text-sm font-bold capitalize flex items-center justify-center gap-1.5 transition-all border-none cursor-pointer
                                        ${role === r ? "bg-primary text-primary-content shadow-sm" : "text-white/50 hover:text-white"}`}>
                                    {r === "admin" ? <Crown size={14} /> : <User size={14} />} {r}
                                </button>
                            ))}
                        </div>
                    </Section>

                    <Section label="Status" icon={Shield} iconCls="text-accent/60">
                        <div className="grid grid-cols-2 gap-1">
                            {["approved", "pending", "rejected", "blocked"].map((s) => (
                                <button
                                    key={s}
                                    type="button"
                                    onClick={() => mark(() => setStatus(s))}
                                    className={`py-2 rounded text-xs font-bold capitalize transition-all border cursor-pointer
                                        ${status === s ? STATUS_BTN[s].active : STATUS_BTN[s].inactive}`}>
                                    {s}
                                </button>
                            ))}
                        </div>
                    </Section>
                </div>

                {/* Access duration */}
                <Section label="Access Duration" icon={Clock} iconCls="text-info/60">
                    <div className="flex gap-1 bg-base-200/30 p-0.5 rounded-md border border-white/[0.06]">
                        {["permanent", "temporary"].map((t) => (
                            <button
                                key={t}
                                type="button"
                                onClick={() => mark(() => setAccessType(t))}
                                className={`flex-1 py-2 rounded text-sm font-bold capitalize transition-all border-none cursor-pointer
                                    ${accessType === t ? "bg-accent text-accent-content shadow-sm" : "text-white/50 hover:text-white"}`}>
                                {t}
                            </button>
                        ))}
                    </div>
                    {accessType === "temporary" && (
                        <div className="flex gap-1 mt-1.5">
                            {DURATION_OPTS.map(({ label, days }) => (
                                <button
                                    key={days}
                                    type="button"
                                    onClick={() => mark(() => setDuration(days))}
                                    className={`flex-1 py-2 rounded text-xs font-bold transition-all border cursor-pointer
                                        ${duration === days ? "bg-accent/20 text-accent border-accent/30" : "bg-base-200/20 text-white/50 border-white/[0.06] hover:text-white"}`}>
                                    {label}
                                </button>
                            ))}
                        </div>
                    )}
                    {user.accessExpiresAt && (
                        <p className={`text-xs mt-1.5 flex items-center gap-1 ${isExpired(user) ? "text-error" : "text-white/50"}`}>
                            {isExpired(user) ? <XCircle size={11} /> : <Clock size={11} />}
                            {isExpired(user) ? "Expired:" : "Expires:"} {fmtDate(user.accessExpiresAt)}
                        </p>
                    )}
                </Section>

                {/* Adult content */}
                <div className="flex items-center justify-between bg-base-200/20 rounded-md px-4 py-3 border border-white/[0.06]">
                    <div className="flex items-center gap-3">
                        <div
                            className={`w-8 h-8 rounded-md flex items-center justify-center
                            ${allowAdult ? "bg-warning/20 text-warning" : "bg-base-300/30 text-white/40"}`}>
                            {allowAdult ? <Eye size={15} /> : <EyeOff size={15} />}
                        </div>
                        <div>
                            <p className="text-sm font-bold text-white">Adult Content</p>
                            <p className="text-xs text-white/50">Permit 18+ libraries</p>
                        </div>
                    </div>
                    <Toggle value={allowAdult} onChange={(v) => mark(() => setAllowAdult(v))} />
                </div>

                {/* Library access */}
                {libraries.length > 0 && (
                    <Section label={`Libraries (${enabledCount}/${libraries.length})`} icon={Library}>
                        <div className="flex items-center justify-end gap-3 mb-1.5 -mt-1">
                            <button
                                type="button"
                                onClick={() =>
                                    mark(() => {
                                        const m = {};
                                        libraries.forEach((l) => (m[l.id] = true));
                                        setLibPerms(m);
                                    })
                                }
                                className="text-xs font-bold text-primary hover:opacity-70 transition-opacity cursor-pointer">
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
                                className="text-xs font-bold text-white/50 hover:text-white transition-colors cursor-pointer">
                                None
                            </button>
                        </div>

                        {libraries.length > 4 && (
                            <div className="flex items-center gap-2 bg-base-200/20 rounded-md px-2.5 py-1.5 mb-1.5 border border-white/[0.05]">
                                <Search size={12} className="text-white/40 shrink-0" />
                                <input
                                    value={libSearch}
                                    onChange={(e) => setLibSearch(e.target.value)}
                                    placeholder="Filter libraries…"
                                    className="flex-1 bg-transparent text-sm text-white placeholder:text-white/40 focus:outline-none"
                                />
                            </div>
                        )}

                        <div className="space-y-1 max-h-36 overflow-y-auto">
                            {filteredLibs.map((lib) => {
                                const on = libPerms[lib.id] ?? true;
                                return (
                                    <div key={lib.id} className="flex items-center gap-2.5 rounded-md px-3 py-2 bg-base-200/15 border border-white/[0.04] hover:bg-base-200/25 transition-colors">
                                        <div
                                            className={`w-6 h-6 rounded flex items-center justify-center shrink-0
                                            ${on ? "bg-primary/20 text-primary" : "bg-base-300/20 text-white/30"}`}>
                                            <Library size={12} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className={`text-sm font-semibold truncate ${on ? "text-white/90" : "text-white/40"}`}>{lib.label || lib.path}</p>
                                            {lib.label && <p className="text-xs font-mono text-white/30 truncate">{lib.path}</p>}
                                        </div>
                                        <Toggle value={on} onChange={() => mark(() => setLibPerms((p) => ({ ...p, [lib.id]: !p[lib.id] })))} />
                                    </div>
                                );
                            })}
                        </div>
                    </Section>
                )}
            </div>

            {/* footer */}
            <div className="flex gap-2 px-5 py-4 border-t border-white/[0.06]">
                <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 py-3 rounded-md text-sm font-bold text-white/60
                        bg-base-200/30 hover:bg-base-200/50 hover:text-white transition-colors border-none cursor-pointer">
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving || !dirty}
                    className={`flex-1 py-3 rounded-md text-sm font-bold transition-all border-none
                        ${dirty && !saving ? "bg-primary text-primary-content hover:opacity-90 shadow-sm cursor-pointer" : "bg-base-content/5 text-white/40 cursor-not-allowed"}`}>
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
            <table className="w-full table-auto border-collapse" style={{ minWidth: 700 }}>
                <thead>
                    <tr className="text-xs font-bold uppercase tracking-wider text-white/50 bg-base-200/30 border-b border-white/[0.05]">
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
                            <tr key={u.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                                <td className="py-3 px-4">
                                    <div className="flex items-center gap-3">
                                        <Avatar user={u} />
                                        <div className="min-w-0">
                                            <p className="text-sm font-bold text-white truncate max-w-[150px]">{u.name || "—"}</p>
                                            <p className="text-xs text-white/60 font-mono truncate max-w-[150px]">{u.email}</p>
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
                                    <span className={`text-base font-black ${u.emailVerified ? "text-success" : "text-white/40"}`}>{u.emailVerified ? "✓" : "✗"}</span>
                                </td>
                                <td className="py-3 px-3">
                                    {exp ? (
                                        <span className="text-xs font-bold text-error">Expired</span>
                                    ) : u.accessType === "temporary" ? (
                                        <div>
                                            <span className="text-xs font-bold text-warning">Temp</span>
                                            {u.accessExpiresAt && (
                                                <p className="text-xs text-white/50 mt-0.5 flex items-center gap-0.5">
                                                    <Calendar size={10} /> {fmtDateShort(u.accessExpiresAt)}
                                                </p>
                                            )}
                                        </div>
                                    ) : (
                                        <span className="text-xs text-white/50">Perm</span>
                                    )}
                                </td>
                                <td className="py-3 px-3 hidden sm:table-cell">
                                    <span className="text-xs font-mono text-white/50">{u.lastIp || "—"}</span>
                                </td>
                                <td className="py-3 px-3 text-center">
                                    <div className="inline-flex items-center gap-1.5 bg-base-300/20 px-2 py-1 rounded-md">
                                        {(u._count?.sessions ?? 0) > 0 && <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse shrink-0" />}
                                        <span className="text-sm text-white/70 font-bold tabular-nums">{u._count?.sessions ?? 0}</span>
                                    </div>
                                </td>
                                <td className="py-3 px-3 text-xs text-white/50 whitespace-nowrap hidden sm:table-cell">{u.createdAt ? fmtDateShort(u.createdAt) : "—"}</td>
                                <td className="py-3 px-4">
                                    <div className="flex items-center justify-end gap-1">
                                        <ActionBtn icon={Info} label="Details" onClick={() => onInfo(u)} className="hover:bg-info/15 hover:text-info" />
                                        <ActionBtn icon={UserCheck} label="Access" onClick={() => onRequest(u)} className="hover:bg-success/15 hover:text-success" pulse={u.status === "pending"} />
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

export default function DashUsers() {
    const [users, setUsers] = useState([]);
    const [total, setTotal] = useState(0);
    const [pendingTotal, setPendingTotal] = useState(0); // FIX: track server-side pending count
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

    // FIX: also fetch pending count separately so it's accurate regardless of current page filter
    const loadPendingCount = useCallback(async () => {
        try {
            const d = await dashApi.users({ status: "pending", limit: 1, page: 1 });
            setPendingTotal(d.total ?? 0);
        } catch {
            /* silent */
        }
    }, []);

    // ── load users ────────────────────────────────────────────────────────────
    const load = useCallback(
        async (pg = 1) => {
            setLoading(true);
            setError(null);
            try {
                const p = { page: pg, limit: 25 };
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

    // ── CRUD ─────────────────────────────────────────────────────────────────

    // FIX: handleSave awaits both update + reload, re-throws on error so modal stays open
    async function handleSave(user, updates) {
        try {
            await dashApi.updateUser(user.id, updates);
            // Optimistic local update
            setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, ...updates } : u)));
            showToast(`Updated: ${user.name || user.email}`);
            // Refresh full page + pending count
            load(page);
            loadPendingCount();
        } catch (e) {
            showToast(e.message || "Update failed", "error");
            throw e; // let modal know it failed (keeps modal open)
        }
    }

    // FIX: handleAction routes ⋮ menu to confirm dialog
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

    // FIX: executeAction — PATCH status OR DELETE user, then reload
    async function executeAction() {
        if (!confirm?.user) return;
        setActionLoading(true);
        try {
            if (confirm.status) {
                // status change via ⋮ menu
                await dashApi.updateUser(confirm.user.id, { status: confirm.status });
                setUsers((prev) => prev.map((u) => (u.id === confirm.user.id ? { ...u, status: confirm.status } : u)));
            } else {
                // delete
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

    return (
        <div className="space-y-3 max-w-full">
            {/* header */}
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h1 className="text-xl font-black text-white tracking-tight">Users</h1>
                    <p className="text-sm text-white/60 mt-0.5 tabular-nums">
                        {total} accounts
                        {pendingTotal > 0 && <span className="ml-2 px-2 py-0.5 rounded-md bg-warning/15 text-warning text-xs font-bold">{pendingTotal} pending</span>}
                    </p>
                </div>
                <button
                    onClick={() => {
                        load(page);
                        loadPendingCount();
                    }}
                    className="btn btn-sm btn-ghost gap-1.5 text-white/60 hover:text-white">
                    <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
                </button>
            </div>

            {/* error */}
            {error && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-error/10 text-error text-xs font-medium border border-error/20">
                    <AlertTriangle size={12} /> {error}
                    <button onClick={() => load(page)} className="ml-auto text-error/70 hover:text-error font-bold">
                        Retry
                    </button>
                </div>
            )}

            {/* pending banner */}
            {!loading && pendingTotal > 0 && statusFilter !== "pending" && (
                <button
                    onClick={() => setStatusFilter("pending")}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-warning/8 border border-warning/15
                        text-warning text-xs font-semibold hover:bg-warning/12 transition-colors text-left">
                    <span className="relative flex h-2 w-2 shrink-0">
                        <span className="animate-ping absolute h-full w-full rounded-full bg-warning opacity-75" />
                        <span className="relative block h-2 w-2 rounded-full bg-warning" />
                    </span>
                    {pendingTotal} user{pendingTotal > 1 ? "s" : ""} awaiting approval
                    <ChevronRight size={11} className="ml-auto opacity-40" />
                </button>
            )}

            {/* search + tabs */}
            <div className="space-y-2">
                <div className="flex items-center gap-2 bg-base-100 rounded-lg px-3 h-10 border border-base-content/10 focus-within:border-primary/30 transition-colors">
                    <Search size={15} className="text-white/40 shrink-0" />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search name or email…"
                        className="flex-1 bg-transparent text-sm text-white placeholder:text-white/40 focus:outline-none"
                    />
                    {search && (
                        <button onClick={() => setSearch("")} className="text-white/40 hover:text-white transition-colors">
                            <X size={14} />
                        </button>
                    )}
                </div>
                <div className="flex bg-base-200/40 rounded-md p-1 gap-1 overflow-x-auto border border-base-content/5" style={{ scrollbarWidth: "none" }}>
                    {STATUS_TABS.map((t) => (
                        <button
                            key={t.v}
                            onClick={() => setStatusFilter(t.v)}
                            className={`px-3 py-1.5 rounded-md text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 shrink-0 cursor-pointer
                                ${statusFilter === t.v ? "bg-primary text-primary-content shadow-sm" : "text-white/50 hover:text-white"}`}>
                            {t.label}
                            {t.alert && pendingTotal > 0 && <span className="px-1.5 py-0.5 rounded-md bg-warning text-warning-content text-[10px] font-black tabular-nums">{pendingTotal}</span>}
                        </button>
                    ))}
                </div>
            </div>

            {/* table */}
            <div className="bg-base-100 rounded-xl overflow-hidden border border-base-content/5 shadow-sm">
                {loading ? (
                    <div className="flex justify-center py-16">
                        <span className="loading loading-spinner loading-md text-primary" />
                    </div>
                ) : users.length === 0 ? (
                    <div className="py-14 text-center">
                        <Search size={22} className="text-white/20 mx-auto mb-2" />
                        <p className="text-white/30 text-xs">No users found</p>
                        {(search || statusFilter) && (
                            <button
                                onClick={() => {
                                    setSearch("");
                                    setStatusFilter("");
                                }}
                                className="text-xs text-primary hover:underline mt-1.5">
                                Clear filters
                            </button>
                        )}
                    </div>
                ) : (
                    <UsersTable users={users} onInfo={setInfoUser} onRequest={setReqUser} onPermission={setPermUser} onAction={handleAction} />
                )}
            </div>

            {/* pagination */}
            {pages > 1 && (
                <div className="flex items-center justify-between">
                    <span className="text-xs text-white/30 tabular-nums">
                        Page {page} of {pages}
                    </span>
                    <div className="flex gap-1">
                        <button onClick={() => load(page - 1)} disabled={page <= 1} className="w-7 h-7 rounded-lg btn btn-ghost btn-xs text-white/50 disabled:opacity-25">
                            <ChevronLeft size={12} />
                        </button>
                        <button onClick={() => load(page + 1)} disabled={page >= pages} className="w-7 h-7 rounded-lg btn btn-ghost btn-xs text-white/50 disabled:opacity-25">
                            <ChevronRight size={12} />
                        </button>
                    </div>
                </div>
            )}

            {/* modals */}
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
        </div>
    );
}
