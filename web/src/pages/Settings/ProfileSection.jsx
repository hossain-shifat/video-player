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
import { Modal, Input, Card, Field, PrimaryButton, GhostButton } from "./shared";
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

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Avatar({ src, name, email, size = 72 }) {
    return (
        <div className="shrink-0 overflow-hidden rounded-box ring-1 ring-base-content/20" style={{ width: size, height: size }}>
            {src ? (
                <img src={src} alt={name || email || "avatar"} className="h-full w-full object-cover" />
            ) : (
                <div className="flex h-full w-full items-center justify-center bg-base-300 font-bold text-primary" style={{ fontSize: size * 0.34 }}>
                    {initials(name, email)}
                </div>
            )}
        </div>
    );
}

// ─── Chips ────────────────────────────────────────────────────────────────────
const ROLE_CLS = { admin: "text-primary bg-primary/10 border-primary/35", moderator: "text-accent bg-accent/10 border-accent/35" };
const STATUS_CLS = {
    approved: "text-success bg-success/10 border-success/35",
    pending: "text-warning bg-warning/10 border-warning/35",
    blocked: "text-error bg-error/10 border-error/35",
    rejected: "text-error bg-error/10 border-error/35",
};
const STATUS_DOT = { approved: "bg-success", pending: "bg-warning animate-pulse", blocked: "bg-error", rejected: "bg-error" };

function Chip({ children, cls }) {
    return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${cls}`}>{children}</span>;
}

// ─── Section heading inside cards ─────────────────────────────────────────────
function CardHeader({ icon: Icon, children, right }) {
    return (
        <div className="flex items-center justify-between gap-3 border-b border-base-content/10 px-4 py-3 sm:px-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-base-content">
                {Icon && <Icon size={15} className="text-base-content/55" />}
                {children}
            </h3>
            {right}
        </div>
    );
}

function InfoRow({ icon: Icon, label, value, mono }) {
    return (
        <div className="flex min-w-0 items-center justify-between gap-4 border-b border-base-content/10 py-3 last:border-b-0">
            <dt className="flex shrink-0 items-center gap-2 text-[13px] text-base-content/60">
                <Icon size={14} className="text-base-content/45" />
                {label}
            </dt>
            <dd className={`min-w-0 truncate text-right text-[13px] font-medium ${value ? "text-base-content" : "text-base-content/45"} ${mono ? "font-mono" : ""}`}>{value || "Not set"}</dd>
        </div>
    );
}

const TONE = { default: "text-primary", warn: "text-warning", danger: "text-error", ok: "text-success" };

function StatCell({ icon: Icon, label, value, tone = "default" }) {
    return (
        <div className="flex min-w-0 flex-col gap-1.5 px-3 py-3 sm:flex-row sm:items-center sm:gap-3 sm:px-5 sm:py-3.5">
            <Icon size={20} className={`shrink-0 ${TONE[tone]}`} />
            <div className="min-w-0">
                <p className="truncate text-sm font-semibold leading-tight text-base-content sm:text-base">{value}</p>
                <p className="mt-0.5 truncate text-xs text-base-content/60">{label}</p>
            </div>
        </div>
    );
}

// ─── Status banner ────────────────────────────────────────────────────────────
const BANNERS = {
    blocked: { icon: ShieldAlert, err: true, title: "Account blocked", text: "An administrator revoked your access. Contact them if you think this is a mistake." },
    expired: { icon: Hourglass, err: true, title: "Access expired", text: "Your temporary access has ended. Ask for renewed access to keep using Flux." },
    pending: { icon: AlertTriangle, err: false, title: "Approval pending", text: "An administrator needs to approve your account before you can stream media." },
};

function StatusBanner({ isPending, isBlocked, isExpired }) {
    const key = isBlocked ? "blocked" : isExpired ? "expired" : isPending ? "pending" : null;
    if (!key) return null;
    const { icon: Icon, err, title, text } = BANNERS[key];
    return (
        <div role="alert" className={`flex items-start gap-3 rounded-box border px-4 py-3.5 ${err ? "border-error/40 bg-error/10" : "border-warning/40 bg-warning/10"}`}>
            <Icon size={18} className={`mt-0.5 shrink-0 ${err ? "text-error" : "text-warning"}`} />
            <div className="min-w-0">
                <p className={`text-sm font-semibold ${err ? "text-error" : "text-warning"}`}>{title}</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-base-content/80">{text}</p>
            </div>
        </div>
    );
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
        <Modal open={open} onClose={onClose} title="Edit profile" subtitle="Update your photo, display name or password.">
            <div className="space-y-5">
                {error && (
                    <div role="alert" className="flex items-center gap-2 rounded-field border border-error/35 bg-error/10 px-3 py-2.5 text-[13px] text-error">
                        <X size={14} className="shrink-0" /> {error}
                    </div>
                )}

                <div className="flex items-center gap-4">
                    <button type="button" onClick={() => fileRef.current?.click()} aria-label="Change photo" className="group relative shrink-0 cursor-pointer rounded-box focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                        <div className="overflow-hidden rounded-box ring-1 ring-base-content/20" style={{ width: 72, height: 72 }}>
                            {preview ? (
                                <img src={preview} alt="" className="h-full w-full object-cover" />
                            ) : (
                                <div className="flex h-full w-full items-center justify-center bg-base-300 text-2xl font-bold text-primary">{initials(name || user?.name, user?.email)}</div>
                            )}
                        </div>
                        <span className="absolute inset-0 flex items-center justify-center rounded-box bg-black/60 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                            {uploading ? <span className="loading loading-spinner loading-xs text-white" /> : <Camera size={18} className="text-white" />}
                        </span>
                    </button>
                    <div className="text-[13px] text-base-content/65">
                        <p className="font-medium text-base-content">Profile photo</p>
                        <p className="mt-0.5">{uploading ? "Uploading…" : "Click the photo to choose a new one."}</p>
                    </div>
                    <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
                </div>

                <Field id="em-name" label="Display name" required>
                    <Input id="em-name" name="name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} placeholder="Your name" autoFocus />
                </Field>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field id="em-pw" label="New password">
                        <Input id="em-pw" name="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Leave blank to keep" />
                    </Field>
                    <Field id="em-pw2" label="Confirm password">
                        <Input id="em-pw2" name="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} placeholder="Repeat password" />
                    </Field>
                </div>

                <div className="flex gap-2 pt-1">
                    <GhostButton onClick={onClose} className="flex-1">
                        Cancel
                    </GhostButton>
                    <PrimaryButton onClick={save} disabled={!name.trim()} loading={saving} className="flex-1">
                        {!saving && <Check size={14} />}
                        {saving ? "Saving…" : "Save changes"}
                    </PrimaryButton>
                </div>
            </div>
        </Modal>
    );
}

// ─── Logged out ───────────────────────────────────────────────────────────────
function LoggedOut({ setLoginOpen }) {
    return (
        <div className="flex w-full flex-col items-center justify-center gap-5 px-4 py-20 text-center">
            <div className="flex size-14 items-center justify-center rounded-box border border-base-content/15 bg-base-200">
                <User size={24} className="text-base-content/55" />
            </div>
            <div>
                <p className="text-lg font-semibold text-base-content">You're not signed in</p>
                <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-base-content/65">Sign in to manage your account and keep your preferences with you.</p>
            </div>
            <PrimaryButton onClick={() => setLoginOpen?.()}>
                <LogIn size={15} /> Sign in
            </PrimaryButton>
        </div>
    );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────
function ProfileSkeleton() {
    return (
        <div className="w-full animate-pulse space-y-5">
            <div className="h-36 rounded-box border border-base-content/10 bg-base-200 sm:h-28" />
            <div className="h-16 rounded-box border border-base-content/10 bg-base-200" />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="h-52 rounded-box border border-base-content/10 bg-base-200" />
                <div className="h-52 rounded-box border border-base-content/10 bg-base-200" />
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
    const accessType = user?.accessType ? cap(user.accessType) : "Permanent";
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
            <StatusBanner isPending={isPending} isBlocked={isBlocked} isExpired={isExpired} />

            {/* ── Identity ── */}
            <Card>
                <div className="flex min-w-0 flex-col gap-4 p-4 sm:flex-row sm:items-center sm:gap-5 sm:p-5">
                    <div className="flex min-w-0 flex-1 items-start gap-3.5 sm:items-center sm:gap-4">
                        <Avatar src={user?.avatar} name={user?.name} email={user?.email} size={64} />
                        <div className="min-w-0 flex-1">
                            <h2 className="break-words text-lg font-semibold leading-tight text-base-content sm:truncate sm:text-xl">{displayName}</h2>
                            {user?.email && (
                                <p className="mt-1 flex items-start gap-1.5 text-[13px] text-base-content/65 sm:items-center">
                                    <Mail size={13} className="mt-0.5 shrink-0 text-base-content/45 sm:mt-0" />
                                    <span className="break-all sm:truncate">{user.email}</span>
                                </p>
                            )}
                            <div className="mt-2.5 flex flex-wrap items-center gap-2">
                                <Chip cls={ROLE_CLS[role] || "text-base-content/80 bg-base-content/10 border-base-content/20"}>
                                    {isAdmin && <ShieldCheck size={12} />}
                                    {role}
                                </Chip>
                                {status && (
                                    <Chip cls={STATUS_CLS[status] || "text-base-content/80 bg-base-content/10 border-base-content/20"}>
                                        <span className={`size-1.5 rounded-full ${STATUS_DOT[status] || "bg-base-content/50"}`} />
                                        {status}
                                    </Chip>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-2 sm:shrink-0">
                        <GhostButton onClick={() => setEditOpen(true)} className="flex-1 sm:flex-none">
                            <Pencil size={13} /> Edit profile
                        </GhostButton>
                        <GhostButton onClick={handleLogout} className="flex-1 border-error/40 text-error hover:bg-error/10 hover:text-error sm:flex-none">
                            <LogOut size={13} /> Sign out
                        </GhostButton>
                    </div>
                </div>

                {/* Access at a glance */}
                <div className="grid grid-cols-3 divide-x divide-base-content/10 border-t border-base-content/10 bg-base-300/40">
                    <StatCell
                        icon={isApproved ? BadgeCheck : isPending ? Hourglass : ShieldAlert}
                        label="Account status"
                        value={status ? cap(status) : "Unknown"}
                        tone={isApproved ? "ok" : isPending ? "warn" : "danger"}
                    />
                    <StatCell icon={isTemporary ? Clock : InfinityIcon} label="Access type" value={accessType} />
                    <StatCell
                        icon={isExpired ? AlertTriangle : Clock}
                        label="Access expires"
                        value={!isTemporary ? "Never" : expiryDays != null ? (expiryDays > 0 ? `${expiryDays}d left` : "Expired") : "—"}
                        tone={isExpired ? "danger" : isTemporary && expiryDays != null && expiryDays <= 3 ? "warn" : "default"}
                    />
                </div>
            </Card>

            {/* ── Details ── */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Card>
                    <CardHeader icon={IdCard}>Account details</CardHeader>
                    <dl className="px-4 sm:px-5">
                        <InfoRow icon={Mail} label="Email" value={user?.email} />
                        <InfoRow icon={Hash} label="Role" value={cap(role)} />
                        <InfoRow icon={isTemporary ? Clock : InfinityIcon} label="Access type" value={accessType} />
                        <InfoRow icon={Clock} label="Access expires" value={isTemporary ? fmtDate(user?.accessExpiresAt) : "Never (permanent access)"} />
                    </dl>
                </Card>

                <Card>
                    <CardHeader
                        icon={ShieldQuestion}
                        right={
                            isAdmin && (
                                <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary">
                                    <Sparkles size={12} /> Admin override
                                </span>
                            )
                        }>
                        Permissions
                    </CardHeader>

                    {isAdmin ? (
                        <p className="px-4 py-4 text-[13px] leading-relaxed text-base-content/75 sm:px-5">Administrators skip individual permission checks and can use every part of Flux.</p>
                    ) : permEntries.length === 0 ? (
                        <p className="px-4 py-4 text-[13px] text-base-content/60 sm:px-5">No specific permissions are assigned to this account.</p>
                    ) : (
                        <div className="flex flex-wrap gap-1.5 px-4 py-4 sm:px-5">
                            {grantedPerms.map(([k]) => (
                                <span key={k} className="inline-flex items-center gap-1.5 rounded-field border border-success/30 bg-success/10 px-2.5 py-1 font-mono text-xs font-medium text-success">
                                    <Unlock size={11} className="shrink-0" />
                                    {k}
                                </span>
                            ))}
                            {deniedPerms.map(([k]) => (
                                <span key={k} className="inline-flex items-center gap-1.5 rounded-field border border-base-content/15 bg-base-content/5 px-2.5 py-1 font-mono text-xs text-base-content/55">
                                    <Lock size={11} className="shrink-0" />
                                    {k}
                                </span>
                            ))}
                        </div>
                    )}
                </Card>
            </div>

            {/* ── Security ── */}
            <Card>
                <div className="flex min-w-0 items-center justify-between gap-4 px-4 py-3.5 sm:px-5">
                    <div className="flex min-w-0 items-center gap-3">
                        <KeyRound size={18} className="shrink-0 text-base-content/55" />
                        <div className="min-w-0">
                            <p className="text-sm font-medium leading-tight text-base-content">Password</p>
                            <p className="mt-0.5 text-[13px] text-base-content/60">Change the password you sign in with</p>
                        </div>
                    </div>
                    <GhostButton onClick={() => setEditOpen(true)} className="shrink-0">
                        Change password
                    </GhostButton>
                </div>
            </Card>

            <EditModal open={editOpen} onClose={() => setEditOpen(false)} user={user} onSave={onSave} onAvatarUpload={onAvatarUpload} />
        </div>
    );
}
