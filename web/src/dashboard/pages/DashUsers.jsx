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
    Users,
    Activity,
    ChevronFirst,
    ChevronLast,
    Check,
    ChevronUp,
    Mail,
    LogOut,
    Archive,
    Flame,
    Film,
    Tv,
    Sparkles,
    Copy,
} from "lucide-react";
import { dashApi } from "../api/dashboardApi";
import ConfirmModal, {
    ModalShell,
    ModalHeader,
    ModalTabs,
    ModalAvatar,
    PanelBody,
    ModalFooter,
    ModalBadge,
    ModalButton,
    ModalSegmented,
    ModalToggle,
    ModalNote,
    ModalChange,
    TONE,
} from "../components/ConfirmModal";

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
    if (/ipad|tablet/i.test(ua)) return <Monitor size={13} />; // also matches deviceType "tablet" / "mobile"
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

// ─── Modal helpers (design rules: MODAL_DESIGN_GUIDE.md) ──────────────────────

const STATUS_META = {
    approved: { icon: CheckCircle, tone: "success", label: "Approved" },
    pending: { icon: Clock, tone: "warning", label: "Pending" },
    rejected: { icon: XCircle, tone: "error", label: "Rejected" },
    blocked: { icon: Ban, tone: "error", label: "Blocked" },
};
const cap = (v) => v.charAt(0).toUpperCase() + v.slice(1);

function StatusChip({ user }) {
    const m = user.deletedAt ? { icon: Trash2, tone: "warning", label: "Pending deletion" } : (STATUS_META[user.status] ?? { icon: Clock, tone: "neutral", label: cap(user.status || "unknown") });
    return (
        <ModalBadge tone={m.tone} icon={m.icon}>
            {m.label}
        </ModalBadge>
    );
}

// Tinted icon tile palette (same idea as StatCard: text-X on bg-X/10). Colour carries meaning, not decoration.
const TILE = {
    "text-primary": "bg-primary/10",
    "text-success": "bg-success/10",
    "text-warning": "bg-warning/10",
    "text-error": "bg-error/10",
    "text-info": "bg-info/10",
    "text-accent": "bg-accent/10",
};

function ChoiceCard({ on, onClick, icon: Icon, tone = "text-primary", border = "border-primary", title, desc, disabled, vertical = false }) {
    return (
        <button
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={onClick}
            className={`card border relative cursor-pointer rounded-md bg-base-100 text-left outline-0! transition-colors hover:bg-base-content/5 focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 ${on ? `${border} bg-base-content/5` : "border-base-content/10"}`}>
            <span className={`card-body gap-1.5 p-4 ${vertical ? "items-center justify-center text-center" : "flex-row items-center gap-3"}`}>
                <span className={`grid shrink-0 place-items-center rounded-full h-10 w-10 ${TILE[tone] ?? "bg-base-300"} ${tone}`}>
                    <Icon size={vertical ? 21 : 19} />
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-medium text-base-content">{title}</span>
                    <span className="block text-xs leading-snug text-base-content/70">{desc}</span>
                </span>
                {on && <CheckCircle size={16} className={`shrink-0 ${vertical ? "absolute right-2.5 top-2.5" : ""} ${tone}`} />}
            </span>
        </button>
    );
}

function SettingRow({ icon: Icon, tone = "text-base-content/70", title, desc, right, children }) {
    return (
        <div className="card border shrink-0 rounded-md border-base-content/10 bg-base-100">
            <div className="card-body gap-3 px-4 py-3">
                <div className="flex items-center gap-3">
                    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${TILE[tone] ?? "bg-base-300"} ${tone}`}>
                        <Icon size={18} />
                    </span>
                    <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-medium text-base-content">{title}</p>
                        <p className="text-xs leading-snug text-base-content/70">{desc}</p>
                    </div>
                    {right}
                </div>
                {children}
            </div>
        </div>
    );
}

// Overview primitives: a titled card holding label / value rows, like a spec sheet.
function DetailCard({ icon: Icon, title, children }) {
    return (
        <section className="flex min-h-0 flex-col overflow-hidden rounded-md border border-base-content/10 bg-base-100">
            <h3 className="flex items-center gap-2 border-b border-base-content/10 bg-base-content/5 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-base-content/60">
                <Icon size={13} className="text-primary" />
                {title}
            </h3>
            <dl className="flex flex-1 flex-col divide-y divide-base-content/10">{children}</dl>
        </section>
    );
}

function DetailRow({ icon: Icon, tone = "text-base-content/50", label, children }) {
    return (
        <div className="flex min-h-11 items-center justify-between gap-4 px-4 py-2 md:flex-1">
            <dt className="flex shrink-0 items-center gap-2 text-xs text-base-content/60">
                <Icon size={14} className={tone} />
                {label}
            </dt>
            <dd className="flex min-w-0 items-center justify-end gap-2 text-[13px] font-medium text-base-content">{children}</dd>
        </div>
    );
}

function CopyButton({ text, label }) {
    const [done, setDone] = useState(false);
    async function copy() {
        try {
            if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
            else {
                // plain-http LAN addresses have no navigator.clipboard
                const ta = document.createElement("textarea");
                ta.value = text;
                ta.style.position = "fixed";
                ta.style.opacity = "0";
                document.body.appendChild(ta);
                ta.select();
                document.execCommand("copy");
                document.body.removeChild(ta);
            }
            setDone(true);
            setTimeout(() => setDone(false), 1400);
        } catch {
            /* ignore */
        }
    }
    return (
        <button
            type="button"
            onClick={copy}
            aria-label={done ? "Copied" : `Copy ${label}`}
            title={done ? "Copied" : `Copy ${label}`}
            className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-base-content/50 transition-colors hover:bg-base-content/10 hover:text-base-content">
            {done ? <Check size={13} className="text-success" /> : <Copy size={13} />}
        </button>
    );
}

function HeaderMetric({ label, value }) {
    return (
        <div className="stat grid-rows-2 gap-0 px-4 py-0">
            <div className="stat-value row-start-1 text-sm font-medium tabular-nums text-base-content">{value}</div>
            <div className="stat-title row-start-2 text-[11px]">{label}</div>
        </div>
    );
}

// ─── DETAILS ──────────────────────────────────────────────────────────────────

function InfoModal({ user, onClose }) {
    // Admins get a privacy-safe DEVICE SUMMARY (actual machines, repeat logins merged). They cannot log a user's
    // devices out; owners do that themselves in Settings → Profile → Devices.
    const [tab, setTab] = useState("overview");
    const [devices, setDevices] = useState([]);
    const [summary, setSummary] = useState({ lastIp: "", registeredDevices: 0, activeSessions: 0 });
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (!user) return;
        setTab("overview");
        setDevices([]);
        setFailed(false);
        setLoading(true);
        dashApi
            .userSessions(user.id)
            .then((d) => {
                setDevices(d?.devices ?? []);
                setSummary({ lastIp: d?.lastIp || "", registeredDevices: d?.registeredDevices ?? 0, activeSessions: d?.activeSessions ?? 0 });
            })
            .catch(() => setFailed(true))
            .finally(() => setLoading(false));
    }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!user) return null;

    const expired = isExpired(user);
    const lastIp = user.lastIp || summary.lastIp || "";
    const lastMs = devices.length ? Math.max(...devices.map((d) => new Date(d.lastActiveAt || 0).getTime())) : user.lastLoginAt ? new Date(user.lastLoginAt).getTime() : null;
    const deleting = !!user.deletedAt;
    const daysLeft = user.purgeAt ? Math.max(0, Math.ceil((new Date(user.purgeAt).getTime() - Date.now()) / 86400000)) : null;
    const delStart = user.deletedAt ? new Date(user.deletedAt).getTime() : null;
    const delEnd = user.purgeAt ? new Date(user.purgeAt).getTime() : null;
    const delPct = delStart && delEnd && delEnd > delStart ? Math.min(100, Math.max(0, Math.round(((Date.now() - delStart) / (delEnd - delStart)) * 100))) : 0;
    const accessText = expired ? `Expired ${fmtDate(user.accessExpiresAt)}` : user.accessType === "temporary" ? `Temporary · ${fmtDate(user.accessExpiresAt)}` : "Permanent";
    const deviceCount = loading ? "…" : summary.registeredDevices || (user._count?.devices ?? 0);

    return (
        <ModalShell onClose={onClose} labelledBy="um-info-t">
            <ModalHeader
                id="um-info-t"
                avatar={<ModalAvatar name={user.name || user.email} src={user.avatar} className="w-14" ring="border-primary" />}
                title={user.name || "Unnamed"}
                subtitle={user.email}
                badges={
                    <>
                        <ModalBadge tone={user.role === "admin" ? "primary" : "info"} icon={user.role === "admin" ? Crown : User}>
                            {user.role === "admin" ? "Admin" : "User"}
                        </ModalBadge>
                        <StatusChip user={user} />
                    </>
                }
                right={
                    <div className="stats hidden bg-transparent md:inline-grid">
                        <HeaderMetric label="Devices" value={deviceCount} />
                        <HeaderMetric label="Last seen" value={lastMs ? fmtRel(lastMs) : "—"} />
                        <HeaderMetric label="Joined" value={user.createdAt ? fmtDate(user.createdAt) : "—"} />
                    </div>
                }
                onClose={onClose}
            />
            <ModalTabs
                value={tab}
                onChange={setTab}
                tabs={[
                    { id: "overview", label: "Overview", icon: User },
                    { id: "devices", label: "Devices", icon: Monitor, count: loading ? null : devices.length },
                ]}
            />
            <PanelBody bordered={false}>
                {tab === "overview" && (
                    <div role="tabpanel" id="panel-overview" aria-labelledby="tab-overview" className="flex min-h-0 flex-1 flex-col gap-2.5">
                        {deleting && (
                            <div className="card border rounded-md border-warning/40 bg-warning/10">
                                <div className="card-body gap-1 px-3.5 py-2.5">
                                    <div className="flex items-center gap-2.5">
                                        <Trash2 size={16} className="shrink-0 text-warning" />
                                        <span className="text-[13px] font-medium text-base-content">Scheduled for deletion</span>
                                        <progress
                                            className="progress progress-warning mx-1 flex-1 rounded-full [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-value]:rounded-full [&::-moz-progress-bar]:rounded-full"
                                            value={delPct}
                                            max={100}
                                            aria-label="Recovery window used"
                                        />
                                        <span className="shrink-0 text-xs text-base-content/70">
                                            {daysLeft != null ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left` : ""}
                                            {user.purgeAt ? ` · purge ${fmtDateShort(user.purgeAt)}` : ""}
                                        </span>
                                    </div>
                                    <p className="text-xs text-base-content/70">Revoked {fmtDate(user.deletedAt)}. Only the account owner can recover it, by verifying their email.</p>
                                    {user.purgeError && <p className="text-xs text-error">Last purge attempt failed: {user.purgeError}</p>}
                                </div>
                            </div>
                        )}
                        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-2">
                            <DetailCard icon={User} title="Account">
                                <DetailRow icon={Mail} tone="text-info" label="Email">
                                    <span className="truncate" title={user.email}>
                                        {user.email}
                                    </span>
                                    <CopyButton text={user.email} label="email" />
                                </DetailRow>
                                <DetailRow icon={Check} tone="text-success" label="Email status">
                                    {user.emailVerified ? (
                                        <ModalBadge tone="success" icon={Check}>
                                            Verified
                                        </ModalBadge>
                                    ) : (
                                        <ModalBadge tone="warning" icon={AlertTriangle}>
                                            Not verified
                                        </ModalBadge>
                                    )}
                                </DetailRow>
                                <DetailRow icon={Shield} tone="text-primary" label="Role">
                                    <ModalBadge tone={user.role === "admin" ? "primary" : "info"} icon={user.role === "admin" ? Crown : User}>
                                        {user.role === "admin" ? "Admin" : "User"}
                                    </ModalBadge>
                                </DetailRow>
                                <DetailRow icon={Calendar} label="Joined">
                                    {user.createdAt ? fmtDate(user.createdAt) : "—"}
                                </DetailRow>
                            </DetailCard>

                            <DetailCard icon={Activity} title="Access & activity">
                                <DetailRow icon={Clock} tone="text-warning" label="Access">
                                    {expired ? (
                                        <ModalBadge tone="error" icon={Clock}>
                                            Expired {fmtDate(user.accessExpiresAt)}
                                        </ModalBadge>
                                    ) : user.accessType === "temporary" ? (
                                        <ModalBadge tone="warning" icon={Clock}>
                                            Until {fmtDate(user.accessExpiresAt)}
                                        </ModalBadge>
                                    ) : (
                                        <ModalBadge tone="neutral">Permanent</ModalBadge>
                                    )}
                                </DetailRow>
                                <DetailRow icon={LogOut} label="Last sign-in">
                                    <span>{user.lastLoginAt ? fmtRel(user.lastLoginAt) : "—"}</span>
                                    {user.lastLoginAt && <span className="hidden font-normal text-base-content/50 sm:inline">· {fmtDate(user.lastLoginAt)}</span>}
                                </DetailRow>
                                <DetailRow icon={Globe} tone="text-info" label="Last IP">
                                    <span className="truncate font-mono">{lastIp || "—"}</span>
                                    {lastIp && <CopyButton text={lastIp} label="IP address" />}
                                </DetailRow>
                                <DetailRow icon={Monitor} label="Devices">
                                    <span className="tabular-nums">{deviceCount}</span>
                                    {!loading && summary.activeSessions > 0 && <span className="font-normal text-base-content/50">· {summary.activeSessions} active</span>}
                                </DetailRow>
                            </DetailCard>
                        </div>
                    </div>
                )}

                {tab === "devices" && (
                    <div role="tabpanel" id="panel-devices" aria-labelledby="tab-devices" className="flex min-h-0 flex-1 flex-col gap-2">
                        {loading ? (
                            <div className="flex flex-col gap-2">
                                {[0, 1, 2].map((i) => (
                                    <div key={i} className="skeleton h-11 w-full rounded-md" />
                                ))}
                            </div>
                        ) : failed ? (
                            <ModalNote tone="error" icon={WifiOff}>
                                Couldn’t load devices. Close and reopen this dialog to retry.
                            </ModalNote>
                        ) : devices.length === 0 ? (
                            <p className="rounded-md border border-dashed border-base-content/10 px-4 py-8 text-center text-sm text-base-content/70">No signed-in devices</p>
                        ) : (
                            <ul className="list min-h-0 overflow-y-auto rounded-md border border-base-content/10 bg-base-100">
                                {devices.map((d, i) => {
                                    const activeNow = d.lastActiveAt && Date.now() - new Date(d.lastActiveAt).getTime() < 5 * 60 * 1000;
                                    return (
                                        <li key={`${d.label}-${d.ip}-${i}`} className="list-row items-center px-4 py-3">
                                            <span className="grid h-9 w-9 place-items-center rounded-full bg-info/10 text-info">{deviceIcon(d.deviceType ?? "")}</span>
                                            <div className="min-w-0">
                                                <p className="truncate text-[13px] font-medium text-base-content">{d.label || "Unknown device"}</p>
                                                <p className="truncate text-xs text-base-content/70">
                                                    <span className="font-mono">{d.ip || "IP not recorded"}</span> · first seen {fmtDateShort(d.firstSeenAt)}
                                                </p>
                                            </div>
                                            {activeNow ? (
                                                <ModalBadge tone="success" icon={Activity}>
                                                    Active now
                                                </ModalBadge>
                                            ) : (
                                                <span className="text-xs text-base-content/70">{fmtRel(d.lastActiveAt)}</span>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                        <p className="flex items-center gap-1.5 text-xs text-base-content/70">
                            <Info size={12} className="shrink-0 text-info" />
                            Same browser and IP count once; one IP can be the same device in another browser. View only.
                        </p>
                    </div>
                )}
            </PanelBody>
            <ModalFooter>
                <ModalButton onClick={onClose}>Close</ModalButton>
            </ModalFooter>
        </ModalShell>
    );
}

// ─── MANAGE ACCESS ────────────────────────────────────────────────────────────
// Two states, decided by the SAVED status:
//   not approved → decision only (approve / reject / block / back to pending)
//   approved     → role + access time limit, with a small status switch in the footer

const DURATION_OPTS = [
    { label: "7 days", days: 7 },
    { label: "30 days", days: 30 },
    { label: "90 days", days: 90 },
    { label: "1 year", days: 365 },
];

const DECISIONS = {
    approved: {
        icon: CheckCircle,
        tone: "text-success",
        border: "border-success/50",
        title: "Approve",
        desc: "Let them in",
        cta: "Approve user",
        btn: "primary",
        note: "They can browse and watch what you allow. Role and access time limit appear right after approval.",
        noteTone: "info",
    },
    rejected: {
        icon: XCircle,
        tone: "text-error",
        border: "border-error/50",
        title: "Reject",
        desc: "Decline the request",
        cta: "Reject request",
        btn: "danger",
        note: "Rejected users can’t browse or stream. Their devices stay signed in, but every request is refused.",
        noteTone: "warning",
    },
    blocked: {
        icon: Ban,
        tone: "text-error",
        border: "border-error/50",
        title: "Block",
        desc: "Suspend access",
        cta: "Block user",
        btn: "danger",
        note: "Blocked users can’t browse or stream. Their devices stay signed in, but every request is refused.",
        noteTone: "warning",
    },
    pending: {
        icon: Clock,
        tone: "text-warning",
        border: "border-warning/50",
        title: "Back to pending",
        desc: "Wait for review",
        cta: "Move to pending",
        btn: "primary",
        note: "They can’t browse or stream until approved.",
        noteTone: "info",
    },
};

function RequestModal({ user, onClose, onSave }) {
    const [role, setRole] = useState("user");
    const [status, setStatus] = useState("pending");
    const [accessType, setAccessType] = useState("permanent");
    const [duration, setDuration] = useState(30);
    const [durationTouched, setDurationTouched] = useState(false);
    const [pick, setPick] = useState(null);
    const [saving, setSaving] = useState(false);
    const [hint, setHint] = useState("");
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!user) return;
        setRole(user.role || "user");
        setStatus(user.status || "pending");
        setAccessType(user.accessType || "permanent");
        setDuration(30);
        setDurationTouched(false);
        setPick(null);
        setHint("");
        setError(null);
    }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!user) return null;

    const deleting = !!user.deletedAt;
    const origStatus = user.status || "pending";
    const origRole = user.role || "user";
    const origAccess = user.accessType || "permanent";
    const approvedView = origStatus === "approved";
    const expired = isExpired(user);
    const editing = approvedView && status === "approved";

    // Preview of the expiry that will be written. An existing expiry is only replaced when access just became
    // temporary or a new duration was picked, so role/status edits never silently extend or shorten it.
    const newExpiry = (() => {
        const d = new Date();
        d.setDate(d.getDate() + duration);
        return d.toISOString();
    })();
    const expiryIsNew = accessType === "temporary" && (durationTouched || origAccess !== "temporary");
    const shownExpiry = accessType === "temporary" ? (expiryIsNew ? newExpiry : user.accessExpiresAt) : null;
    const durationLabel = accessType === "temporary" && expiryIsNew ? `Temporary · ${DURATION_OPTS.find((o) => o.days === duration)?.label}` : cap(accessType);

    const changes = approvedView
        ? [
              status !== origStatus && { name: "Status", from: cap(origStatus), to: cap(status) },
              editing && role !== origRole && { name: "Role", from: cap(origRole), to: cap(role) },
              editing && (accessType !== origAccess || (accessType === "temporary" && durationTouched)) && { name: "Access", from: cap(origAccess), to: durationLabel },
          ].filter(Boolean)
        : pick
          ? [{ name: "Status", from: cap(origStatus), to: cap(pick) }]
          : [];
    const dirty = changes.length > 0;

    async function handleSave() {
        if (deleting || saving) return;
        const nextStatus = approvedView ? status : pick;
        if (!nextStatus) {
            setHint("Pick an outcome first.");
            return;
        }
        if (!dirty) return;
        setSaving(true);
        setError(null);
        try {
            const nextRole = editing ? role : origRole;
            const nextType = editing ? accessType : origAccess;
            const touched = editing && durationTouched;
            let accessExpiresAt = user.accessExpiresAt ?? null;
            if (nextType === "temporary") {
                if (origAccess !== "temporary" || touched) accessExpiresAt = newExpiry;
            } else {
                accessExpiresAt = null;
            }
            await onSave(user, { role: nextRole, status: nextStatus, accessType: nextType, accessExpiresAt });
            onClose();
        } catch (e) {
            setError(e?.message || "Couldn’t save changes. Try again.");
        } finally {
            setSaving(false);
        }
    }

    const cur = STATUS_META[status] ?? STATUS_META.pending;
    const decisionKeys = ["approved", "rejected", "blocked", "pending"].filter((k) => k !== origStatus);
    const picked = pick ? DECISIONS[pick] : null;
    const saveLabel = approvedView ? (dirty ? `Save ${changes.length} change${changes.length > 1 ? "s" : ""}` : "Save changes") : (picked?.cta ?? "Save changes");
    const saveVariant = !approvedView ? (picked?.btn ?? "primary") : status === "approved" || status === "pending" ? "primary" : "danger";
    const closeMenu = () => document.activeElement?.blur?.();

    return (
        <ModalShell onClose={onClose} busy={saving} labelledBy="um-req-t">
            <ModalHeader
                id="um-req-t"
                avatar={<ModalAvatar name={user.name || user.email} src={user.avatar} className="w-10" ring="border-primary/40" />}
                title={user.name || "Unnamed"}
                subtitle={user.email}
                right={<StatusChip user={user} />}
                onClose={onClose}
                busy={saving}
            />
            <PanelBody>
                {deleting && (
                    <ModalNote tone="warning" icon={Trash2}>
                        This account is scheduled for deletion and can’t be edited.
                    </ModalNote>
                )}

                {!approvedView ? (
                    <div className="flex flex-1 flex-col justify-center gap-4">
                        <div>
                            <h3 className="flex items-center gap-2 text-base font-semibold text-base-content">
                                <span className="h-4 w-1 rounded-full bg-primary" />
                                Decide on this request
                            </h3>
                            <p className="text-xs text-base-content/70">Pick one outcome. You can change it later.</p>
                        </div>
                        <div role="radiogroup" aria-label="Outcome" className="grid gap-3 sm:grid-cols-3">
                            {decisionKeys.map((k) => {
                                const d = DECISIONS[k];
                                return (
                                    <ChoiceCard
                                        key={k}
                                        vertical
                                        on={pick === k}
                                        icon={d.icon}
                                        tone={d.tone}
                                        border={d.border}
                                        title={d.title}
                                        desc={d.desc}
                                        disabled={deleting}
                                        onClick={() => {
                                            setPick(k);
                                            setHint("");
                                            setError(null);
                                        }}
                                    />
                                );
                            })}
                        </div>
                        <ModalNote tone={picked ? picked.noteTone : "info"} icon={picked ? (picked.noteTone === "warning" ? AlertTriangle : Info) : Info}>
                            <span aria-live="polite">{picked ? picked.note : "Pick an outcome to see what happens next."}</span>
                        </ModalNote>
                    </div>
                ) : !editing ? (
                    <ModalNote tone="warning" icon={AlertTriangle}>
                        {status === "pending"
                            ? "Pending users can’t browse or stream until approved."
                            : `${cap(status)} users can’t browse or stream. Their devices stay signed in, but every request is refused.`}
                    </ModalNote>
                ) : (
                    <>
                        <SettingRow
                            icon={Shield}
                            tone="text-primary"
                            title="Role"
                            desc={role === "admin" ? "Manages users, libraries, and server. Can’t manage others’ devices." : "Watches what permissions allow."}
                            right={
                                <ModalSegmented
                                    label="Role"
                                    className="w-52 shrink-0"
                                    value={role}
                                    onChange={(r) => !deleting && setRole(r)}
                                    options={[
                                        { value: "user", label: "User", icon: User },
                                        { value: "admin", label: "Admin", icon: Crown },
                                    ]}
                                />
                            }
                        />
                        <SettingRow
                            icon={Clock}
                            tone="text-warning"
                            title="Access time limit"
                            desc={
                                accessType !== "temporary"
                                    ? "Never expires. Turn on to set an end date."
                                    : expiryIsNew
                                      ? `Access ends ${fmtDate(newExpiry)} if saved now`
                                      : expired
                                        ? `Expired ${fmtDate(user.accessExpiresAt)}`
                                        : `Access ends ${fmtDate(user.accessExpiresAt)}`
                            }
                            right={
                                <label className="flex items-center gap-2 text-xs text-base-content/70">
                                    {accessType === "temporary" ? "On" : "Off"}
                                    <ModalToggle value={accessType === "temporary"} onChange={(v) => setAccessType(v ? "temporary" : "permanent")} disabled={deleting} label="Access time limit" />
                                </label>
                            }>
                            {accessType === "temporary" && (
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                                    <ModalSegmented
                                        split
                                        label="Duration"
                                        className="flex-1"
                                        value={expiryIsNew ? duration : null}
                                        onChange={(d) => {
                                            if (deleting) return;
                                            setDuration(d);
                                            setDurationTouched(true);
                                        }}
                                        options={DURATION_OPTS.map((o) => ({ value: o.days, label: o.label }))}
                                    />
                                    <div className="flex min-w-32 flex-col justify-center rounded-md border border-base-content/10 bg-base-100 px-3 py-0.5">
                                        <p className="text-xs text-base-content/70">{expired && !expiryIsNew ? "Expired" : "Expires"}</p>
                                        <p className="text-[13px] font-semibold text-base-content">{shownExpiry ? fmtDate(shownExpiry) : "—"}</p>
                                    </div>
                                </div>
                            )}
                        </SettingRow>
                    </>
                )}

                {error && (
                    <ModalNote tone="error" icon={AlertTriangle}>
                        {error}
                    </ModalNote>
                )}
            </PanelBody>
            <ModalFooter
                note={
                    <div className="flex min-w-0 items-center gap-3">
                        {approvedView && (
                            <div className="dropdown dropdown-top shrink-0">
                                <button
                                    type="button"
                                    tabIndex={0}
                                    aria-haspopup="menu"
                                    disabled={deleting || saving}
                                    className="btn btn-sm gap-1.5 rounded-md border border-base-content/20 bg-transparent font-medium text-base-content/85 hover:bg-base-content/10 [--depth:0] [--noise:0]">
                                    <cur.icon size={13} className={TONE[cur.tone]} />
                                    Status: {cur.label}
                                    <ChevronUp size={12} />
                                </button>
                                <ul
                                    tabIndex={0}
                                    role="menu"
                                    aria-label="Change status"
                                    className="dropdown-content menu menu-sm z-20 mb-2 w-44 rounded-md border border-base-content/10 bg-base-200 p-1 shadow-2xl">
                                    {Object.entries(STATUS_META).map(([k, mm]) => (
                                        <li key={k}>
                                            <button
                                                type="button"
                                                role="menuitemradio"
                                                aria-checked={status === k}
                                                className={status === k ? "menu-active" : ""}
                                                onClick={() => {
                                                    setStatus(k);
                                                    setError(null);
                                                    closeMenu();
                                                }}>
                                                <mm.icon size={14} className={TONE[mm.tone]} />
                                                {mm.label}
                                                {status === k && <Check size={12} className="ml-auto" />}
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {dirty ? (
                            <>
                                <span className="inline-flex shrink-0 items-center gap-1.5 text-warning">
                                    <span className="size-2 shrink-0 rounded-full bg-warning" />
                                    Unsaved
                                </span>
                                <ul className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto" aria-live="polite" aria-label="Pending changes">
                                    {changes.map((c) => (
                                        <ModalChange key={c.name} {...c} />
                                    ))}
                                </ul>
                            </>
                        ) : hint ? (
                            <span className="text-warning">{hint}</span>
                        ) : approvedView ? (
                            <span className="text-base-content/60">No changes yet</span>
                        ) : null}
                    </div>
                }>
                <ModalButton onClick={onClose} disabled={saving}>
                    Cancel
                </ModalButton>
                <ModalButton variant={saveVariant} onClick={handleSave} loading={saving} loadingText="Saving…" disabled={deleting || (!approvedView && !pick)}>
                    {saveLabel}
                </ModalButton>
            </ModalFooter>
        </ModalShell>
    );
}

// ─── PERMISSIONS ──────────────────────────────────────────────────────────────

// Library icon by kind: movies → Film, series → Tv, anime → Sparkles, anything else → Library.
// Uses lib.type / lib.category / lib.kind when the API sends one, otherwise guesses from the label, then the path.
const LIB_ICON = { movie: Film, series: Tv, anime: Sparkles };
function libKind(lib) {
    const guess = (t) => {
        t = String(t || "").toLowerCase();
        if (/anime/.test(t)) return "anime";
        if (/series|\btv\b|shows?|episodes?/.test(t)) return "series";
        if (/movie|film/.test(t)) return "movie";
        return null;
    };
    return guess(lib.type || lib.category || lib.kind) ?? guess(lib.label) ?? guess(lib.path);
}

function PermissionModal({ user, onClose, onSave, libraries = [] }) {
    const [allowAdult, setAllowAdult] = useState(false);
    const [origAdult, setOrigAdult] = useState(false);
    const [libPerms, setLibPerms] = useState({});
    const [origPerms, setOrigPerms] = useState({});
    const [libSearch, setLibSearch] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!user) return;
        let parsed = {};
        try {
            const raw = user.permissionsJson || user.permissions;
            parsed = typeof raw === "string" ? JSON.parse(raw) : (raw ?? {});
        } catch {
            /* ignore */
        }
        const adult = parsed?.allowAdult ?? false;
        setAllowAdult(adult);
        setOrigAdult(adult);
        // Backend contract: parsed.libraries is an array of granted library IDs (empty/missing = no access).
        const grantedIds = Array.isArray(parsed?.libraries) ? parsed.libraries : [];
        const map = {};
        libraries.forEach((l) => {
            map[l.id] = grantedIds.includes(l.id);
        });
        setLibPerms(map);
        setOrigPerms(map);
        setLibSearch("");
        setError(null);
    }, [user?.id, libraries]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!user) return null;

    const filteredLibs = libraries.filter((l) => !libSearch || (l.label + l.path).toLowerCase().includes(libSearch.toLowerCase()));
    const enabledCount = Object.values(libPerms).filter(Boolean).length;
    const deleting = !!user.deletedAt;
    const yn = (v) => (v ? "Allowed" : "Blocked");
    const changes = [
        allowAdult !== origAdult && { name: "18+", from: yn(origAdult), to: yn(allowAdult) },
        ...libraries.filter((l) => (libPerms[l.id] ?? false) !== (origPerms[l.id] ?? false)).map((l) => ({ name: l.label || l.path, from: yn(origPerms[l.id]), to: yn(libPerms[l.id]) })),
    ].filter(Boolean);
    const dirty = changes.length > 0;
    const setAll = (v) => !deleting && setLibPerms(Object.fromEntries(libraries.map((l) => [l.id, v])));

    async function handleSave() {
        if (!dirty || deleting || saving) return;
        setSaving(true);
        setError(null);
        try {
            const libraryIds = Object.entries(libPerms)
                .filter(([, granted]) => granted)
                .map(([id]) => id);
            const permissions = { libraries: libraryIds, allowAdult };
            // role / status / access stay untouched — only permissions are updated here
            await onSave(user, { allowAdult, permissions, permissionsJson: JSON.stringify(permissions) });
            onClose();
        } catch (e) {
            setError(e?.message || "Couldn’t save permissions. Try again.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <ModalShell onClose={onClose} busy={saving} labelledBy="um-perm-t">
            <ModalHeader
                id="um-perm-t"
                icon={KeyRound}
                title="Content permissions"
                subtitle={user.name || user.email}
                right={
                    libraries.length > 0 ? (
                        <span className="hidden sm:block">
                            <ModalBadge tone={enabledCount ? "primary" : "neutral"} icon={Library}>
                                {enabledCount} of {libraries.length} libraries
                            </ModalBadge>
                        </span>
                    ) : null
                }
                onClose={onClose}
                busy={saving}
            />
            <PanelBody className="gap-2">
                {deleting && (
                    <ModalNote tone="warning" icon={Trash2}>
                        This account is scheduled for deletion and can’t be edited.
                    </ModalNote>
                )}

                <label className="card border flex-row items-center gap-3 rounded-md border-base-content/10 bg-base-100 px-3.5 py-2 hover:bg-base-content/5">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${allowAdult ? "bg-warning/10 text-warning" : "bg-error/10 text-error"}`}>
                        {allowAdult ? <Eye size={18} /> : <EyeOff size={18} />}
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium text-base-content">Allow 18+ content</span>
                        <span className="block text-xs text-base-content/70">{allowAdult ? "Allowed. Titles marked for adults are visible." : "Blocked. Titles marked for adults stay hidden."}</span>
                    </span>
                    <ModalToggle value={allowAdult} onChange={setAllowAdult} disabled={deleting} label="Allow 18+ content" />
                </label>

                {libraries.length > 0 && (
                    <>
                        <div className="flex shrink-0 flex-wrap gap-2">
                            <label className="input input-sm w-full min-w-0 rounded-md sm:w-auto sm:flex-1">
                                <Search size={14} className="shrink-0 text-base-content/70" />
                                <input type="search" className="grow" value={libSearch} onChange={(e) => setLibSearch(e.target.value)} placeholder="Search libraries" aria-label="Search libraries" />
                            </label>
                            <ModalButton className="flex-1 sm:flex-none" onClick={() => setAll(true)} disabled={deleting}>
                                Allow all
                            </ModalButton>
                            <ModalButton className="flex-1 sm:flex-none" onClick={() => setAll(false)} disabled={deleting}>
                                None
                            </ModalButton>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-base-content/10 bg-base-100">
                            <table className="table table-xs">
                                <thead className="sticky top-0 z-10 bg-base-200">
                                    <tr className="text-[11px] uppercase tracking-wider text-base-content/50">
                                        <th className="w-8"></th>
                                        <th>Library</th>
                                        <th className="hidden sm:table-cell">Path</th>
                                        <th className="text-right">Access</th>
                                        <th className="w-14 text-right">Allow</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredLibs.map((lib) => {
                                        const on = libPerms[lib.id] ?? false;
                                        const changed = on !== (origPerms[lib.id] ?? false);
                                        const toggle = (v) => !deleting && setLibPerms((p) => ({ ...p, [lib.id]: v }));
                                        const LibIcon = LIB_ICON[libKind(lib)] ?? Library;
                                        return (
                                            <tr key={lib.id} title={lib.path} onClick={() => toggle(!on)} className="h-10 cursor-pointer align-middle text-[12px] hover:bg-base-content/5">
                                                <th className="w-8">
                                                    <LibIcon size={16} className={on ? "text-primary" : "text-base-content/50"} />
                                                </th>
                                                <td className="font-medium text-base-content">{lib.label || lib.path}</td>
                                                <td className="hidden max-w-64 truncate font-mono text-xs text-base-content/50 sm:table-cell">{lib.label ? lib.path : ""}</td>
                                                <td className={`w-24 text-right font-medium ${on ? "text-success" : "text-base-content/60"}`}>
                                                    {yn(on)}
                                                    {changed && <span className="ml-1.5 inline-block size-1.5 rounded-full bg-warning align-middle" title="Changed" />}
                                                </td>
                                                <td className="w-14" onClick={(e) => e.stopPropagation()}>
                                                    <div className="flex justify-end">
                                                        <ModalToggle value={on} onChange={toggle} disabled={deleting} label={`Allow ${lib.label || lib.path}`} />
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {filteredLibs.length === 0 && (
                                        <tr>
                                            <td colSpan={5} className="py-6 text-center text-base-content/70">
                                                No libraries match “{libSearch}”
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}

                {error && (
                    <ModalNote tone="error" icon={AlertTriangle}>
                        {error}
                    </ModalNote>
                )}
            </PanelBody>
            <ModalFooter
                note={
                    dirty ? (
                        <div className="flex min-w-0 items-center gap-3">
                            <span className="inline-flex shrink-0 items-center gap-1.5 text-warning">
                                <span className="size-2 shrink-0 rounded-full bg-warning" />
                                Unsaved
                            </span>
                            <ul className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto" aria-live="polite" aria-label="Pending changes">
                                {changes.map((c) => (
                                    <ModalChange key={c.name} {...c} />
                                ))}
                            </ul>
                        </div>
                    ) : (
                        <span className="text-base-content/60">No changes yet</span>
                    )
                }>
                <ModalButton onClick={onClose} disabled={saving}>
                    Cancel
                </ModalButton>
                <ModalButton variant="primary" onClick={handleSave} loading={saving} loadingText="Saving…" disabled={deleting}>
                    {dirty ? `Save ${changes.length} change${changes.length > 1 ? "s" : ""}` : "Save permissions"}
                </ModalButton>
            </ModalFooter>
        </ModalShell>
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
            <InfoModal user={infoUser} onClose={() => setInfoUser(null)} />
            <RequestModal user={reqUser} onClose={() => setReqUser(null)} onSave={handleSave} />
            <PermissionModal user={permUser} onClose={() => setPermUser(null)} onSave={handleSave} libraries={libraries} />
            <ConfirmModal
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
