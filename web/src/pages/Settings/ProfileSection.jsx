import { useState, useRef, useEffect } from "react";
import {
    Camera,
    Check,
    X,
    Mail,
    ShieldCheck,
    ShieldAlert,
    Clock,
    Hash,
    Pencil,
    Lock,
    Unlock,
    LogOut,
    LogIn,
    KeyRound,
    Sparkles,
    User,
    AlertTriangle,
    Hourglass,
    Infinity as InfinityIcon,
    BadgeCheck,
    IdCard,
    ShieldQuestion,
} from "lucide-react";
import { Modal, Input, Card } from "./shared";
import { useAuth } from "../../auth/AuthContext";

// ─── Utils ────────────────────────────────────────────────────────────────────
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : null);

const daysLeft = (iso) => {
    if (!iso) return null;
    return Math.ceil((new Date(iso) - new Date()) / 86400000);
};

const initials = (name, email) => {
    const src = name || email || "?";
    const w = src.trim().split(/\s+/);
    return (w.length >= 2 ? w[0][0] + w[1][0] : src[0]).toUpperCase();
};

// ─── Avatar — solid dark tone, no rainbow, richer ring + shadow ──────────────
function Avatar({ src, name, email, size = 80 }) {
    return (
        <div className="rounded-2xl overflow-hidden shrink-0 ring-2 ring-white/15 shadow-lg shadow-black/40" style={{ width: size, height: size }}>
            {src ? (
                <img src={src} alt={name || email || "avatar"} className="w-full h-full object-cover" />
            ) : (
                <div className="w-full h-full flex items-center justify-center font-extrabold text-primary" style={{ fontSize: size * 0.34, background: "oklch(20% 0.05 260)" }}>
                    {initials(name, email)}
                </div>
            )}
        </div>
    );
}

// ─── Chips ────────────────────────────────────────────────────────────────────
const ROLE_CLS = { admin: "text-primary bg-primary/15 border-primary/35", moderator: "text-accent bg-accent/15 border-accent/35" };
const STATUS_CLS = {
    approved: "text-success bg-success/15 border-success/35",
    pending: "text-warning bg-warning/15 border-warning/35",
    blocked: "text-error bg-error/15 border-error/35",
    rejected: "text-error bg-error/15 border-error/35",
};
const STATUS_DOT = { approved: "bg-success", pending: "bg-warning animate-pulse", blocked: "bg-error", rejected: "bg-error" };

function Chip({ children, cls }) {
    return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] sm:text-[10.5px] font-bold uppercase tracking-wide border whitespace-nowrap ${cls}`}>{children}</span>
    );
}

// ─── Card header — consistent icon + label across detail cards ──────────────
function CardHeader({ icon: Icon, children, right }) {
    return (
        <div className="px-5 sm:px-6 py-3.5 border-b border-white/[0.10] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
                {Icon && (
                    <div className="w-6 h-6 rounded-md bg-primary/15 flex items-center justify-center shrink-0">
                        <Icon size={12} className="text-primary" />
                    </div>
                )}
                <p className="text-[10px] sm:text-[11px] font-bold text-white/80 uppercase tracking-[0.1em]">{children}</p>
            </div>
            {right}
        </div>
    );
}

// ─── Info row ─────────────────────────────────────────────────────────────────
function InfoRow({ icon: Icon, label, value, mono, last }) {
    return (
        <div className={`flex items-center gap-3 py-3.5 min-w-0 ${last ? "" : "border-b border-white/[0.10]"}`}>
            <div className="w-8 h-8 rounded-lg bg-white/[0.08] border border-white/[0.14] flex items-center justify-center shrink-0">
                <Icon size={13} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-[10px] sm:text-[11px] font-bold text-white/70 uppercase tracking-[0.08em] leading-none mb-1">{label}</p>
                <p className={`text-[12.5px] sm:text-[13px] truncate font-medium ${value ? "text-white" : "text-white/50"} ${mono ? "font-mono" : ""}`}>{value || "Not set"}</p>
            </div>
        </div>
    );
}

// ─── Stat pill — richer icon tile, hover lift ────────────────────────────────
function StatPill({ icon: Icon, label, value, tone = "default" }) {
    const toneCls = { default: "bg-primary/15 text-primary", warn: "bg-warning/15 text-warning", danger: "bg-error/15 text-error", ok: "bg-success/15 text-success" }[tone];
    return (
        <div className="flex items-center gap-2.5 px-4 py-3.5 rounded-xl border border-white/[0.12] bg-white/[0.05] hover:bg-white/[0.07] hover:border-white/[0.18] transition-all min-w-0">
            <div className={`w-8 h-8 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center shrink-0 ${toneCls}`}>
                <Icon size={14} />
            </div>
            <div className="min-w-0">
                <p className="text-[14px] sm:text-[15px] font-bold text-white leading-none truncate">{value}</p>
                <p className="text-[10px] sm:text-[11px] text-white/70 mt-1 leading-none truncate font-medium">{label}</p>
            </div>
        </div>
    );
}

// ─── Status banner ────────────────────────────────────────────────────────────
function StatusBanner({ isPending, isBlocked, isExpired }) {
    if (isBlocked) {
        return (
            <div className="flex items-start gap-3 px-4 py-3.5 rounded-xl border border-error/35 bg-error/12">
                <ShieldAlert size={16} className="text-error shrink-0 mt-0.5" />
                <div className="min-w-0">
                    <p className="text-[13px] font-bold text-error">Account blocked</p>
                    <p className="text-[12px] text-white/80 mt-0.5 leading-relaxed">Your access has been revoked by an administrator. Contact support if you believe this is a mistake.</p>
                </div>
            </div>
        );
    }
    if (isExpired) {
        return (
            <div className="flex items-start gap-3 px-4 py-3.5 rounded-xl border border-error/35 bg-error/12">
                <Hourglass size={16} className="text-error shrink-0 mt-0.5" />
                <div className="min-w-0">
                    <p className="text-[13px] font-bold text-error">Access expired</p>
                    <p className="text-[12px] text-white/80 mt-0.5 leading-relaxed">Your temporary access window has ended. Request renewed access to continue using Flux.</p>
                </div>
            </div>
        );
    }
    if (isPending) {
        return (
            <div className="flex items-start gap-3 px-4 py-3.5 rounded-xl border border-warning/35 bg-warning/12">
                <AlertTriangle size={16} className="text-warning shrink-0 mt-0.5" />
                <div className="min-w-0">
                    <p className="text-[13px] font-bold text-warning">Approval pending</p>
                    <p className="text-[12px] text-white/80 mt-0.5 leading-relaxed">An administrator needs to approve your account before you can stream media.</p>
                </div>
            </div>
        );
    }
    return null;
}

// ─── Edit Modal ───────────────────────────────────────────────────────────────
function EditModal({ open, onClose, user, onSave, onAvatarUpload }) {
    const [name, setName] = useState("");
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [preview, setPreview] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const fileRef = useRef(null);

    useEffect(() => {
        if (open) {
            setName(user?.name || "");
            setPassword("");
            setConfirm("");
            setPreview(user?.avatar || null);
            setError(null);
            setSaving(false);
        }
    }, [open, user]);

    async function handleFile(e) {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => setPreview(ev.target.result);
        reader.readAsDataURL(file);
        setUploading(true);
        try {
            const url = await onAvatarUpload(file);
            if (url) setPreview(url);
        } catch (err) {
            setError(err.message || "Upload failed");
        } finally {
            setUploading(false);
        }
    }

    async function save() {
        if (!name.trim()) {
            setError("Display name is required");
            return;
        }
        if (password && password !== confirm) {
            setError("Passwords don't match");
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const d = { name: name.trim(), avatar: preview };
            if (password) d.password = password;
            await onSave(d);
            onClose();
        } catch (err) {
            setError(err.message || "Save failed");
        } finally {
            setSaving(false);
        }
    }

    return (
        <Modal open={open} onClose={onClose} title="Edit Profile" subtitle="Update your photo, display name, or password.">
            <div className="space-y-5">
                {error && (
                    <div className="rounded-lg bg-error/12 border border-error/35 px-3 py-2.5 text-sm text-error flex items-center gap-2">
                        <X size={12} className="shrink-0" /> {error}
                    </div>
                )}

                <div className="flex justify-center pt-1">
                    <div className="relative group cursor-pointer" onClick={() => fileRef.current?.click()}>
                        <div className="rounded-2xl overflow-hidden ring-2 ring-white/20 shadow-lg shadow-black/40" style={{ width: 88, height: 88 }}>
                            {preview ? (
                                <img src={preview} alt="" className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-2xl font-bold text-primary" style={{ background: "oklch(20% 0.05 260)" }}>
                                    {initials(name || user?.name, user?.email)}
                                </div>
                            )}
                        </div>
                        <div className="absolute inset-0 rounded-2xl bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all">
                            {uploading ? <span className="loading loading-spinner loading-xs text-white" /> : <Camera size={18} className="text-white" />}
                        </div>
                        <span className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-primary flex items-center justify-center ring-2 ring-base-200">
                            <Pencil size={9} className="text-primary-content" />
                        </span>
                    </div>
                    <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
                </div>

                <div className="space-y-1.5">
                    <label htmlFor="em-name" className="text-[10px] font-bold text-white/75 uppercase tracking-[0.08em] block">
                        Display Name <span className="text-error">*</span>
                    </label>
                    <Input id="em-name" name="name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} placeholder="Your name" autoFocus />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                        <label htmlFor="em-pw" className="text-[10px] font-bold text-white/75 uppercase tracking-[0.08em] block">
                            New Password
                        </label>
                        <Input id="em-pw" name="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Leave blank to keep" />
                    </div>
                    <div className="space-y-1.5">
                        <label htmlFor="em-pw2" className="text-[10px] font-bold text-white/75 uppercase tracking-[0.08em] block">
                            Confirm
                        </label>
                        <Input
                            id="em-pw2"
                            name="confirm"
                            type="password"
                            value={confirm}
                            onChange={(e) => setConfirm(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && save()}
                            placeholder="Repeat password"
                        />
                    </div>
                </div>

                <div className="flex gap-2 pt-1">
                    <button
                        onClick={onClose}
                        style={{ outline: "none" }}
                        className="flex-1 py-2 rounded-lg text-[12px] font-semibold text-white/85 hover:text-white hover:bg-white/[0.08] transition-colors border border-white/[0.14]">
                        Cancel
                    </button>
                    <button
                        onClick={save}
                        disabled={!name.trim() || saving}
                        style={{ outline: "none" }}
                        className="flex-1 py-2 rounded-lg text-[12px] font-semibold bg-primary text-primary-content hover:opacity-90 transition-opacity border-none disabled:opacity-40 flex items-center justify-center gap-1.5">
                        {saving ? <span className="loading loading-spinner loading-xs" /> : <Check size={12} />}
                        {saving ? "Saving…" : "Save Changes"}
                    </button>
                </div>
            </div>
        </Modal>
    );
}

// ─── Logged out ───────────────────────────────────────────────────────────────
function LoggedOut({ setLoginOpen }) {
    return (
        <div className="w-full flex flex-col items-center justify-center py-24 sm:py-28 gap-5 text-center px-4">
            <div className="w-16 h-16 rounded-2xl bg-white/[0.08] border border-white/20 flex items-center justify-center">
                <User size={26} className="text-white/60" />
            </div>
            <div>
                <p className="text-lg sm:text-xl font-bold text-white">Not signed in</p>
                <p className="text-sm text-white/75 mt-2 max-w-[260px] leading-relaxed mx-auto">Sign in to manage your account and preferences.</p>
            </div>
            <button
                onClick={() => setLoginOpen?.()}
                style={{ outline: "none" }}
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-primary text-primary-content text-sm font-bold hover:opacity-90 transition-opacity border-none">
                <LogIn size={15} /> Sign in
            </button>
        </div>
    );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────
function ProfileSkeleton() {
    return (
        <div className="w-full space-y-5 animate-pulse">
            <div className="rounded-2xl border border-white/[0.12] h-[160px] sm:h-[120px] bg-white/[0.05]" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[0, 1, 2].map((i) => (
                    <div key={i} className="h-[68px] rounded-xl border border-white/[0.12] bg-white/[0.05]" />
                ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-2xl border border-white/[0.12] h-[200px] bg-white/[0.05]" />
                <div className="rounded-2xl border border-white/[0.12] h-[200px] bg-white/[0.05]" />
            </div>
        </div>
    );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function ProfileSection({ handleLogout, setLoginOpen }) {
    const { user, loading, isApproved, isPending, isBlocked, isExpired, isAdmin, permissions, updateMe } = useAuth();
    const [editOpen, setEditOpen] = useState(false);

    if (loading) return <ProfileSkeleton />;
    if (!user) return <LoggedOut setLoginOpen={setLoginOpen} />;

    const displayName = user?.name || user?.email?.split("@")[0] || "User";
    const role = user?.role || "member";
    const status = user?.status || (isApproved ? "approved" : isPending ? "pending" : isBlocked ? "blocked" : null);
    const accessType = user?.accessType ? user.accessType.charAt(0).toUpperCase() + user.accessType.slice(1) : "Permanent";
    const isTemporary = user?.accessType === "temporary";
    const expiryDays = isTemporary ? daysLeft(user?.accessExpiresAt) : null;

    const permEntries = permissions ? Object.entries(permissions) : [];
    const grantedPerms = permEntries.filter(([, v]) => v);
    const deniedPerms = permEntries.filter(([, v]) => !v);

    async function onSave(data) {
        await updateMe(data);
    }

    async function onAvatarUpload(file) {
        const key = import.meta.env.VITE_IMGBB_API_KEY;
        if (!key) throw new Error("Image upload not configured");
        const fd = new FormData();
        fd.append("image", file);
        const r = await fetch(`https://api.imgbb.com/1/upload?key=${key}`, { method: "POST", body: fd });
        if (!r.ok) throw new Error("Upload failed");
        return (await r.json()).data.display_url;
    }

    return (
        <div className="w-full space-y-5">
            {/* ── Status banner ── */}
            <StatusBanner isPending={isPending} isBlocked={isBlocked} isExpired={isExpired} />

            {/* ── Identity card ── */}
            <Card className="shadow-lg shadow-black/20">
                <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-5 min-w-0">
                    <div className="flex items-center gap-4 min-w-0">
                        <div className="relative shrink-0">
                            <Avatar src={user?.avatar} name={user?.name} email={user?.email} size={80} />
                            {isAdmin && (
                                <span className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-primary flex items-center justify-center ring-2 ring-base-200 shadow-md">
                                    <ShieldCheck size={11} className="text-primary-content" />
                                </span>
                            )}
                        </div>

                        <div className="flex-1 min-w-0">
                            <h2 className="text-[18px] sm:text-[20px] font-bold text-white leading-tight truncate">{displayName}</h2>
                            {user?.email && (
                                <p className="flex items-center gap-1.5 text-[12px] sm:text-[13px] text-white/70 mt-1 truncate">
                                    <Mail size={11} className="shrink-0 text-white/40" />
                                    {user.email}
                                </p>
                            )}
                            <div className="flex items-center flex-wrap gap-2 mt-3">
                                <Chip cls={ROLE_CLS[role] || "text-white/90 bg-white/[0.10] border-white/25"}>
                                    {isAdmin && <ShieldCheck size={10} />}
                                    {role}
                                </Chip>
                                {status && (
                                    <Chip cls={STATUS_CLS[status] || "text-white/85 bg-white/[0.10] border-white/20"}>
                                        <span className={`w-2 h-2 rounded-full ${STATUS_DOT[status] || "bg-white/60"}`} />
                                        {status}
                                    </Chip>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-row sm:flex-col gap-2 sm:ml-auto sm:shrink-0">
                        <button
                            onClick={() => setEditOpen(true)}
                            style={{ outline: "none" }}
                            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg border border-primary/35 bg-primary/12 text-[12px] font-semibold text-primary hover:bg-primary/20 hover:border-primary/50 transition-all whitespace-nowrap">
                            <Pencil size={12} /> Edit Profile
                        </button>
                        <button
                            onClick={handleLogout}
                            style={{ outline: "none" }}
                            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg border border-error/35 text-[12px] font-semibold text-error/90 hover:text-error hover:bg-error/12 hover:border-error/50 transition-all whitespace-nowrap">
                            <LogOut size={12} /> Sign Out
                        </button>
                    </div>
                </div>
            </Card>

            {/* ── Stat pills ── */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <StatPill
                    icon={isApproved ? BadgeCheck : isPending ? Hourglass : ShieldAlert}
                    label="Account status"
                    value={status ? status.charAt(0).toUpperCase() + status.slice(1) : "Unknown"}
                    tone={isApproved ? "ok" : isPending ? "warn" : "danger"}
                />
                <StatPill icon={isTemporary ? Clock : InfinityIcon} label="Access type" value={accessType} tone="default" />
                <StatPill
                    icon={isExpired ? AlertTriangle : Clock}
                    label="Access expires"
                    value={!isTemporary ? "Never" : expiryDays != null ? (expiryDays > 0 ? `${expiryDays}d left` : "Expired") : "—"}
                    tone={isExpired ? "danger" : isTemporary && expiryDays != null && expiryDays <= 3 ? "warn" : "default"}
                />
            </div>

            {/* ── Details grid ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card className="shadow-lg shadow-black/10">
                    <CardHeader icon={IdCard}>Account Details</CardHeader>
                    <div className="px-5 sm:px-6 py-1">
                        <InfoRow icon={Mail} label="Email" value={user?.email} />
                        <InfoRow icon={Hash} label="Role" value={role} />
                        <InfoRow icon={isTemporary ? Clock : InfinityIcon} label="Access Type" value={accessType} />
                        <InfoRow icon={Clock} label="Access Expires" value={isTemporary ? fmtDate(user?.accessExpiresAt) : "Never (permanent access)"} last />
                    </div>
                </Card>

                <Card className="shadow-lg shadow-black/10">
                    <CardHeader
                        icon={ShieldQuestion}
                        right={
                            isAdmin && (
                                <span className="inline-flex items-center gap-1 text-[11px] text-primary font-semibold shrink-0">
                                    <Sparkles size={11} /> Admin override
                                </span>
                            )
                        }>
                        Permissions
                    </CardHeader>

                    {isAdmin ? (
                        <div className="px-5 sm:px-6 py-4">
                            <p className="text-[12.5px] text-white/80 leading-relaxed">Administrators bypass individual permission checks and have unrestricted access to all areas.</p>
                        </div>
                    ) : permEntries.length === 0 ? (
                        <div className="px-5 sm:px-6 py-4">
                            <p className="text-[12.5px] text-white/65">No specific permissions have been assigned to this account.</p>
                        </div>
                    ) : (
                        <div className="px-5 sm:px-6 py-4 flex flex-wrap gap-1.5">
                            {grantedPerms.map(([k]) => (
                                <span
                                    key={k}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-success/12 border border-success/30 text-[11.5px] font-mono font-semibold text-success">
                                    <Unlock size={10} className="shrink-0" />
                                    {k}
                                </span>
                            ))}
                            {deniedPerms.map(([k]) => (
                                <span
                                    key={k}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.06] border border-white/[0.14] text-[11.5px] font-mono font-medium text-white/60">
                                    <Lock size={10} className="shrink-0" />
                                    {k}
                                </span>
                            ))}
                        </div>
                    )}
                </Card>
            </div>

            {/* ── Security ── */}
            <Card className="shadow-lg shadow-black/10">
                <div className="flex items-center justify-between gap-6 px-5 sm:px-6 py-4 min-w-0">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-white/[0.08] border border-white/[0.14] flex items-center justify-center shrink-0">
                            <KeyRound size={13} className="text-primary" />
                        </div>
                        <div className="min-w-0">
                            <p className="text-[13px] font-semibold text-white leading-tight">Password</p>
                            <p className="text-[12px] text-white/70 mt-0.5 leading-snug">Change your account password</p>
                        </div>
                    </div>
                    <button
                        onClick={() => setEditOpen(true)}
                        style={{ outline: "none" }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.16] text-[12px] font-semibold text-white/85 hover:text-white hover:border-white/30 hover:bg-white/[0.08] transition-all shrink-0 whitespace-nowrap">
                        <KeyRound size={12} /> Change
                    </button>
                </div>
            </Card>

            <EditModal open={editOpen} onClose={() => setEditOpen(false)} user={user} onSave={onSave} onAvatarUpload={onAvatarUpload} />
        </div>
    );
}
