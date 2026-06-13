import { useState, useRef, useEffect } from "react";
import { User, LogOut, LogIn, Camera, Check, Mail, ShieldCheck, Clock, CalendarDays, Hash, MapPin, Globe, Pencil, X, ChevronRight, Sparkles, Lock, Activity } from "lucide-react";
import { Modal } from "./shared";
import { useAuth } from "../../auth/AuthContext";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(iso) {
    if (!iso) return null;
    return new Date(iso).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
    });
}

function getInitials(name) {
    if (!name) return "U";
    const parts = name.trim().split(/\s+/);
    return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : name[0].toUpperCase();
}

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Avatar({ src, name, size = 72, ring = true, className = "" }) {
    const initials = getInitials(name);
    const fontSize = Math.round(size * 0.36);
    return (
        <div className={`relative shrink-0 rounded-full overflow-hidden ${ring ? "ring-[3px] ring-base-100 shadow-lg" : ""} ${className}`} style={{ width: size, height: size }}>
            {src ? (
                <img src={src} alt={name} className="w-full h-full object-cover" />
            ) : (
                <div
                    className="w-full h-full flex items-center justify-center font-bold text-primary"
                    style={{
                        fontSize,
                        background: "radial-gradient(circle at 30% 30%, oklch(58% 0.22 20 / 0.18), oklch(58% 0.22 20 / 0.08))",
                        border: "1px solid oklch(58% 0.22 20 / 0.2)",
                    }}>
                    {initials}
                </div>
            )}
        </div>
    );
}

// ─── Badge ────────────────────────────────────────────────────────────────────
function Badge({ variant = "default", children }) {
    const styles = {
        admin: "bg-primary/10 text-primary border-primary/20 shadow-[0_0_12px_oklch(58%_0.22_20_/_0.1)]",
        moderator: "bg-accent/10 text-accent border-accent/20",
        member: "bg-base-content/5 text-base-content/40 border-base-content/10",
        success: "bg-success/10 text-success border-success/20",
        warning: "bg-warning/10 text-warning border-warning/20",
        error: "bg-error/10 text-error border-error/20",
        default: "bg-base-content/5 text-base-content/40 border-base-content/10",
    };
    return <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${styles[variant] || styles.default}`}>{children}</span>;
}

function StatusBadge({ status }) {
    const map = {
        approved: { variant: "success", dot: "bg-success", label: "Active" },
        pending: { variant: "warning", dot: "bg-warning animate-pulse", label: "Pending" },
        blocked: { variant: "error", dot: "bg-error", label: "Blocked" },
        rejected: { variant: "error", dot: "bg-error", label: "Rejected" },
    };
    const { variant, dot, label } = map[status] || { variant: "default", dot: "bg-base-content/30", label: status };
    return (
        <Badge variant={variant}>
            <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
            {label}
        </Badge>
    );
}

function RoleBadge({ role }) {
    const variantMap = { admin: "admin", moderator: "moderator", member: "member" };
    return (
        <Badge variant={variantMap[role] || "member"}>
            {role === "admin" && <ShieldCheck size={9} />}
            {role || "member"}
        </Badge>
    );
}

// ─── Info Row ────────────────────────────────────────────────────────────────
function InfoRow({ icon: Icon, label, value, mono, subtle }) {
    if (!value) return null;
    return (
        <div className="group flex items-center gap-4 py-3.5 border-b border-white/[0.04] last:border-0 hover:bg-white/[0.015] -mx-5 px-5 rounded-lg transition-colors">
            <div className="w-9 h-9 rounded-xl bg-base-300/60 flex items-center justify-center shrink-0 group-hover:bg-base-300 transition-colors">
                <Icon size={14} className="text-base-content/35 group-hover:text-base-content/60 transition-colors" />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-[10px] font-semibold text-base-content/28 uppercase tracking-[0.1em] mb-0.5">{label}</p>
                <p className={`text-sm leading-snug truncate ${mono ? "font-mono" : "font-medium"} ${subtle ? "text-base-content/50" : "text-base-content/75"}`}>{value}</p>
            </div>
        </div>
    );
}

// ─── Section Card ─────────────────────────────────────────────────────────────
function SectionCard({ title, icon: Icon, children }) {
    return (
        <div className="rounded-2xl border border-white/[0.07] bg-base-200 overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-white/[0.05]">
                {Icon && <Icon size={12} className="text-base-content/30" />}
                <p className="text-[10px] font-bold text-base-content/30 uppercase tracking-[0.12em]">{title}</p>
            </div>
            <div className="px-5 py-1">{children}</div>
        </div>
    );
}

// ─── Edit Modal ───────────────────────────────────────────────────────────────
function EditProfileModal({ open, onClose, profile, user, onSave, onAvatarUpload }) {
    const [name, setName] = useState("");
    const [bio, setBio] = useState("");
    const [location, setLocation] = useState("");
    const [website, setWebsite] = useState("");
    const [password, setPassword] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [previewAvatar, setPreviewAvatar] = useState(null);
    const [uploadingAvatar, setUploadingAvatar] = useState(false);
    const fileRef = useRef(null);

    useEffect(() => {
        if (open) {
            setName(user?.name || "");
            setBio("");
            setLocation("");
            setWebsite("");
            setPassword("");
            setPreviewAvatar(user?.avatar || null);
            setError(null);
            setSaving(false);
        }
    }, [open, profile, user]);

    async function handleAvatarChange(e) {
        const file = e.target.files?.[0];
        if (!file) return;

        // Instant local preview
        const reader = new FileReader();
        reader.onload = (ev) => setPreviewAvatar(ev.target.result);
        reader.readAsDataURL(file);

        setUploadingAvatar(true);
        setError(null);
        try {
            // Returns the ImgBB hosted URL after upload + profile save
            const uploadedUrl = await onAvatarUpload(file);
            // Swap blob preview → real URL so handleSave writes the hosted URL
            if (uploadedUrl) {
                setPreviewAvatar(uploadedUrl);
                // Auto-save immediately to DB
                await onSave({ name: name.trim() || user?.name, bio, location, website, avatar: uploadedUrl });
            }
        } catch (err) {
            setError(err.message || "Avatar upload failed");
        } finally {
            setUploadingAvatar(false);
        }
    }

    async function handleSave() {
        if (!name.trim()) return;
        setSaving(true);
        setError(null);
        try {
            const dataToSave = { name: name.trim(), bio, location, website, avatar: previewAvatar };
            if (password) dataToSave.password = password;
            await onSave(dataToSave);
            onClose();
        } catch (err) {
            setError(err.message || "Save failed");
        } finally {
            setSaving(false);
        }
    }

    const fields = [
        { label: "Display Name", required: true, value: name, set: setName, ph: "Your name", autoFocus: true },
        { label: "New Password", required: false, value: password, set: setPassword, ph: "Leave blank to keep current", type: "password" },
        { label: "Location", required: false, value: location, set: setLocation, ph: "City, Country" },
        { label: "Website", required: false, value: website, set: setWebsite, ph: "https://example.com" },
    ];

    return (
        <Modal open={open} onClose={onClose} title="Edit Profile">
            <div className="space-y-5">
                {error && (
                    <div className="rounded-xl bg-error/8 border border-error/15 px-4 py-3 text-xs text-error flex items-center gap-2.5">
                        <div className="w-4 h-4 rounded-full bg-error/20 flex items-center justify-center shrink-0">
                            <X size={10} />
                        </div>
                        {error}
                    </div>
                )}

                {/* Avatar upload */}
                <div className="flex justify-center pt-2">
                    <div className="relative group cursor-pointer" role="button" tabIndex={0} onClick={() => fileRef.current?.click()} onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}>
                        <Avatar src={previewAvatar} name={name || user?.name} size={88} ring />
                        <div className="absolute inset-0 rounded-full bg-black/50 flex flex-col items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                            {uploadingAvatar ? (
                                <div className="loading loading-spinner loading-sm text-white" />
                            ) : (
                                <>
                                    <Camera size={16} className="text-white" />
                                    <span className="text-[9px] text-white/80 font-semibold tracking-wider uppercase">Change</span>
                                </>
                            )}
                        </div>
                        <div className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-primary flex items-center justify-center ring-2 ring-base-200">
                            <Pencil size={9} className="text-primary-content" />
                        </div>
                    </div>
                    <label htmlFor="profile-avatar-upload" className="sr-only">Upload avatar</label>
                    <input id="profile-avatar-upload" name="avatar" ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
                </div>

                {/* Fields */}
                <div className="space-y-3">
                    {fields.map(({ label, required, value, set, ph, autoFocus, type }) => (
                        <div key={label} className="space-y-1.5">
                            <label htmlFor={`profile-${label.toLowerCase().replace(/\s+/g, "-")}`} className="block text-xs font-semibold text-base-content/40 uppercase tracking-wider">
                                {label} {required && <span className="text-error normal-case tracking-normal font-normal">*</span>}
                            </label>
                            <input
                                id={`profile-${label.toLowerCase().replace(/\s+/g, "-")}`}
                                name={label.toLowerCase().replace(/\s+/g, "-")}
                                autoFocus={autoFocus}
                                value={value}
                                type={type || "text"}
                                onChange={(e) => set(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && handleSave()}
                                placeholder={ph}
                                style={{ outline: "none", boxShadow: "none" }}
                                className="input input-sm w-full bg-base-300/50 border border-white/8 hover:border-white/15 focus:border-primary/40 rounded-xl text-sm transition-colors"
                            />
                        </div>
                    ))}
                    <div className="space-y-1.5">
                        <label htmlFor="profile-bio" className="block text-xs font-semibold text-base-content/40 uppercase tracking-wider">Bio</label>
                        <textarea
                            id="profile-bio"
                            name="bio"
                            value={bio}
                            onChange={(e) => setBio(e.target.value)}
                            placeholder="A short bio…"
                            rows={3}
                            style={{ outline: "none", boxShadow: "none" }}
                            className="textarea textarea-sm w-full bg-base-300/50 border border-white/8 hover:border-white/15 focus:border-primary/40 rounded-xl text-sm resize-none transition-colors"
                        />
                    </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2.5 pt-1">
                    <button onClick={onClose} style={{ outline: "none" }} className="btn btn-sm btn-ghost rounded-xl flex-1 text-base-content/50 hover:text-base-content hover:bg-base-300">
                        Cancel
                    </button>
                    <button onClick={handleSave} disabled={!name.trim() || saving} style={{ outline: "none" }} className="btn btn-sm btn-primary rounded-xl gap-2 flex-1 border-none">
                        {saving ? <span className="loading loading-spinner loading-xs" /> : <Check size={13} />}
                        {saving ? "Saving…" : "Save Changes"}
                    </button>
                </div>
            </div>
        </Modal>
    );
}

// ─── Stat Pill ─────────────────────────────────────────────────────────────────
function StatPill({ icon: Icon, label, value }) {
    if (!value) return null;
    return (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-base-300/40 border border-white/[0.05]">
            <Icon size={12} className="text-base-content/30 shrink-0" />
            <div className="min-w-0">
                <p className="text-[9px] text-base-content/30 font-semibold uppercase tracking-widest leading-none mb-0.5">{label}</p>
                <p className="text-xs text-base-content/60 font-medium truncate">{value}</p>
            </div>
        </div>
    );
}

// ─── Permission Tag ───────────────────────────────────────────────────────────
function PermissionTag({ name }) {
    return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-base-300/40 border border-white/[0.06] text-xs font-mono text-base-content/45 hover:bg-base-300/70 hover:text-base-content/65 transition-colors">
            <Lock size={9} className="opacity-50" />
            {name}
        </span>
    );
}

// ─── Cover ────────────────────────────────────────────────────────────────────
function ProfileCover() {
    return (
        <div className="h-32 relative overflow-hidden rounded-t-2xl">
            {/* Base gradient */}
            <div className="absolute inset-0 bg-base-300/80" />
            {/* Primary orb */}
            <div
                className="absolute rounded-full"
                style={{
                    width: 220,
                    height: 220,
                    top: -60,
                    left: -40,
                    background: "radial-gradient(circle, oklch(58% 0.22 20 / 0.25) 0%, transparent 70%)",
                    filter: "blur(2px)",
                }}
            />
            {/* Accent orb */}
            <div
                className="absolute rounded-full"
                style={{
                    width: 160,
                    height: 160,
                    top: -30,
                    right: 40,
                    background: "radial-gradient(circle, oklch(65% 0.2 240 / 0.18) 0%, transparent 70%)",
                    filter: "blur(1px)",
                }}
            />
            {/* Fine grid overlay */}
            <div
                className="absolute inset-0 opacity-[0.04]"
                style={{
                    backgroundImage: "linear-gradient(oklch(88% 0.01 260) 1px, transparent 1px), linear-gradient(90deg, oklch(88% 0.01 260) 1px, transparent 1px)",
                    backgroundSize: "24px 24px",
                }}
            />
            {/* Bottom fade */}
            <div
                className="absolute bottom-0 left-0 right-0 h-12"
                style={{
                    background: "linear-gradient(to bottom, transparent, oklch(16% 0.01 260))",
                }}
            />
        </div>
    );
}

// ─── Logged-out State ─────────────────────────────────────────────────────────
function LoggedOutState({ setLoginOpen }) {
    return (
        <div className="rounded-2xl border border-white/[0.07] bg-base-200 overflow-hidden">
            <div className="flex flex-col items-center gap-6 px-8 py-16 text-center">
                {/* Icon */}
                <div className="relative">
                    <div className="w-24 h-24 rounded-2xl bg-base-300/50 border border-white/8 flex items-center justify-center">
                        <User size={36} className="text-base-content/15" />
                    </div>
                    <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center">
                        <Sparkles size={11} className="text-primary/70" />
                    </div>
                </div>
                {/* Copy */}
                <div className="space-y-2">
                    <p className="font-semibold text-base-content/70 text-base">Sign in to your account</p>
                    <p className="text-xs text-base-content/35 max-w-xs leading-relaxed">Save preferences, sync watch history, and personalize your experience across devices.</p>
                </div>
                {/* Action */}
                <button onClick={() => setLoginOpen?.()} style={{ outline: "none", boxShadow: "none" }} className="btn btn-primary btn-sm rounded-xl gap-2 px-8 border-none">
                    <LogIn size={14} />
                    Sign In
                </button>
            </div>
        </div>
    );
}

export default function ProfileSection({ handleLogout, setLoginOpen }) {
    const { user, updateMe } = useAuth();
    const [editOpen, setEditOpen] = useState(false);

    if (!user) return <LoggedOutState setLoginOpen={setLoginOpen} />;

    const displayName = user?.name || user?.username || "User";
    const joinedAt = fmtDate(user?.createdAt);
    const accessExpiry = fmtDate(user?.accessExpiresAt);
    const hasPermissions = user?.permissions && Object.entries(user.permissions).some(([, v]) => v);

    async function handleSave(data) {
        await updateMe({ name: data.name, avatar: data.avatar, username: data.username, password: data.password });
    }
    
    async function handleAvatarUpload(file) {
        // Implement upload via dashApi or authApi if needed, or inline
        // Actually uploadAvatar was previously in profileApi.
        // Let's just use the direct imgbb API call inline for now
        const IMGBB_API_KEY = import.meta.env.VITE_IMGBB_API_KEY;
        if (!IMGBB_API_KEY) throw new Error("ImgBB API key not configured");
        const formData = new FormData();
        formData.append("image", file);
        const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, { method: "POST", body: formData });
        if (!res.ok) throw new Error("Failed to upload image");
        const json = await res.json();
        return json.data.display_url;
    }

    return (
        <div className="space-y-3 max-w-2xl">
            {/* ── Hero Card ── */}
            <div className="rounded-2xl border border-white/[0.07] bg-base-200 overflow-hidden">
                <ProfileCover />

                <div className="px-6 pb-6">
                    {/* Avatar row */}
                    <div className="flex items-end justify-between -mt-12 mb-5">
                        <div className="relative">
                            <Avatar src={user?.avatar} name={displayName} size={76} ring />
                            {user.role === "admin" && (
                                <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-primary flex items-center justify-center ring-2 ring-base-200">
                                    <ShieldCheck size={9} className="text-primary-content" />
                                </div>
                            )}
                        </div>

                        <button
                            onClick={() => setEditOpen(true)}
                            style={{ outline: "none", boxShadow: "none" }}
                            className="flex items-center gap-1.5 h-8 px-3.5 rounded-lg border border-white/10 bg-base-300/50 text-xs font-medium text-base-content/45 hover:text-base-content hover:border-white/20 hover:bg-base-300 transition-all">
                            <Pencil size={11} />
                            Edit Profile
                        </button>
                    </div>

                    {/* Name + bio */}
                    <div className="space-y-3">
                        <div>
                            <h2 className="text-xl font-bold text-base-content leading-tight">{displayName}</h2>
                            {user.username && user.username !== displayName && <p className="text-xs text-base-content/30 font-mono mt-0.5">@{user.username}</p>}
                        </div>
                    </div>
                </div>
            </div>
            {/* ── Account Details ── */}
            <SectionCard title="Account Details" icon={User}>
                <InfoRow icon={Mail} label="Email Address" value={user.email} />
                <InfoRow icon={Hash} label="Username" value={user.username} mono />
                <InfoRow icon={ShieldCheck} label="Access Type" value={user.accessType ? user.accessType.charAt(0).toUpperCase() + user.accessType.slice(1) : null} />
                <InfoRow icon={Clock} label="Access Expires" value={accessExpiry} subtle />
                <InfoRow icon={CalendarDays} label="Member Since" value={joinedAt} subtle />
            </SectionCard>

            {/* ── Permissions ── */}
            {hasPermissions && (
                <SectionCard title="Permissions" icon={Lock}>
                    <div className="py-4 flex flex-wrap gap-2">
                        {Object.entries(user.permissions)
                            .filter(([, v]) => v)
                            .map(([k]) => (
                                <PermissionTag key={k} name={k} />
                            ))}
                    </div>
                </SectionCard>
            )}

            {/* ── Danger Zone ── */}
            <div className="rounded-2xl border border-error/10 bg-base-200 overflow-hidden">
                <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-error/8">
                    <Activity size={11} className="text-error/35" />
                    <p className="text-[10px] font-bold text-error/35 uppercase tracking-[0.12em]">Session</p>
                </div>
                <div className="flex items-center justify-between px-5 py-4">
                    <div className="space-y-0.5">
                        <p className="text-sm font-semibold text-base-content/65">Sign Out</p>
                        <p className="text-xs text-base-content/35">End your session on this device</p>
                    </div>
                    <button
                        onClick={handleLogout}
                        style={{ outline: "none", boxShadow: "none" }}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl border border-error/12 text-xs font-semibold text-error/50 hover:text-error hover:bg-error/8 hover:border-error/25 transition-all">
                        <LogOut size={12} />
                        Sign Out
                    </button>
                </div>
            </div>

            <EditProfileModal open={editOpen} onClose={() => setEditOpen(false)} user={user} onSave={handleSave} onAvatarUpload={handleAvatarUpload} />
        </div>
    );
}
