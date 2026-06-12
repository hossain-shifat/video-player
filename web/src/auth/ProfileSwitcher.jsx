// web/src/components/auth/ProfileSwitcher.jsx
// Profile switcher modal — pick active profile, create new, edit existing.
// Opened from Navbar profile button when user is authenticated.

import { useState, useRef } from "react";
import { User, Plus, Pencil, Trash2, Check, X, Upload, LogOut } from "lucide-react";
import { Modal } from "../../Pages/Settings/shared";
import { useAuth } from "../../auth/AuthContext";
import { useProfile } from "../../auth/ProfileContext";
import AvatarUpload from "./AvatarUpload";

function ProfileAvatar({ profile, size = "md" }) {
    const sizeClasses = {
        sm: "w-10 h-10 text-base",
        md: "w-16 h-16 text-2xl",
        lg: "w-20 h-20 text-3xl",
    };
    const cls = sizeClasses[size] || sizeClasses.md;

    if (profile?.avatar) {
        return <img src={profile.avatar} alt={profile.name} className={`${cls} rounded-full object-cover ring-2 ring-primary/30`} />;
    }

    const initial = profile?.name?.[0]?.toUpperCase() ?? "?";
    return <div className={`${cls} rounded-full bg-primary/15 flex items-center justify-center ring-2 ring-primary/25 font-bold text-primary`}>{initial}</div>;
}

function ProfileCard({ profile, isActive, onSelect, onEdit }) {
    return (
        // ── FIX: was <button><button> (invalid HTML, React hydration error)
        // Changed outer button → div with role="button" so the edit <button> inside is valid
        <div
            role="button"
            tabIndex={0}
            onClick={() => onSelect(profile.id)}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onSelect(profile.id);
            }}
            className={`relative flex flex-col items-center gap-2 p-3 rounded-xl transition-all cursor-pointer group border ${
                isActive ? "border-primary/50 bg-primary/10" : "border-white/5 bg-base-300/50 hover:bg-white/5 hover:border-white/15"
            }`}
            style={{ outline: "none", boxShadow: "none" }}>
            <div className="relative">
                <ProfileAvatar profile={profile} size="md" />
                {isActive && (
                    <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                        <Check size={11} strokeWidth={3} className="text-primary-content" />
                    </span>
                )}
            </div>
            <span className="text-xs font-medium text-base-content/80 truncate max-w-[70px]">{profile.name}</span>
            {profile.allowAdult && <span className="badge badge-xs badge-warning">18+</span>}

            {/* Edit button on hover */}
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onEdit(profile);
                }}
                className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-base-100/80 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/20"
                style={{ outline: "none", boxShadow: "none" }}>
                <Pencil size={10} className="text-base-content/70" />
            </button>
        </div>
    );
}

function EditProfileForm({ profile, onSave, onDelete, onCancel, uploadAvatar }) {
    const [name, setName] = useState(profile?.name || "");
    const [avatar, setAvatar] = useState(profile?.avatar || "");
    const [allowAdult, setAllowAdult] = useState(profile?.allowAdult || false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    async function handleSave() {
        if (!name.trim()) return;
        setSaving(true);
        setError(null);
        try {
            await onSave({ name: name.trim(), avatar, allowAdult });
            onCancel();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    async function handleAvatarUpload(file) {
        try {
            const url = await uploadAvatar(file);
            setAvatar(url);
        } catch (err) {
            setError(err.message || "Avatar upload failed");
        }
    }

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <h4 className="font-semibold text-sm text-base-content">{profile ? "Edit Profile" : "New Profile"}</h4>
                <button onClick={onCancel} className="text-base-content/40 hover:text-base-content" style={{ outline: "none" }}>
                    <X size={16} />
                </button>
            </div>

            {error && <div className="rounded bg-error/10 border border-error/20 px-3 py-2 text-xs text-error">{error}</div>}

            {/* Avatar */}
            <div className="flex justify-center">
                <AvatarUpload currentAvatar={avatar} name={name} onUpload={handleAvatarUpload} />
            </div>

            <label htmlFor="profile-name" className="sr-only">Profile name</label>
            <input
                id="profile-name"
                name="profileName"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Profile name"
                className="input input-sm w-full bg-base-300 border-white/10 text-sm rounded focus:outline-none"
                style={{ outline: "none", boxShadow: "none" }}
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />

            <label htmlFor="profile-allow-adult" className="flex items-center gap-3 cursor-pointer px-1">
                <input id="profile-allow-adult" name="allowAdult" type="checkbox" className="checkbox checkbox-sm checkbox-warning" checked={allowAdult} onChange={(e) => setAllowAdult(e.target.checked)} />
                <div>
                    <p className="text-sm text-base-content">Allow adult content</p>
                    <p className="text-xs text-base-content/40">Show 18+ rated media</p>
                </div>
            </label>

            <div className="flex gap-2">
                {profile && (
                    <button onClick={() => onDelete(profile.id)} className="btn btn-sm btn-error btn-outline rounded gap-1.5 flex-1" style={{ outline: "none" }}>
                        <Trash2 size={13} /> Delete
                    </button>
                )}
                <button onClick={handleSave} disabled={!name.trim() || saving} className="btn btn-sm btn-primary rounded gap-1.5 flex-1" style={{ outline: "none" }}>
                    {saving ? <span className="loading loading-spinner loading-xs" /> : <Check size={13} />}
                    {saving ? "Saving…" : "Save"}
                </button>
            </div>
        </div>
    );
}

export default function ProfileSwitcher({ open, onClose }) {
    const { user, logout } = useAuth();
    const { profiles, activeProfileId, switchProfile, createProfile, updateProfile, deleteProfile, uploadAvatar } = useProfile();

    const [editingProfile, setEditingProfile] = useState(null); // null=list, false=new, {profile}=edit
    const isCreating = editingProfile === false;
    const isEditing = editingProfile && editingProfile !== false;

    function handleSelect(id) {
        switchProfile(id);
        onClose();
    }

    async function handleSave(data) {
        if (isCreating) {
            await createProfile(data);
        } else if (isEditing) {
            await updateProfile(editingProfile.id, data);
        }
    }

    async function handleDelete(id) {
        await deleteProfile(id);
        setEditingProfile(null);
    }

    function handleLogout() {
        logout();
        onClose();
    }

    const showForm = isCreating || isEditing;

    return (
        <Modal open={open} onClose={onClose} title="Who's watching?" subtitle={user?.email}>
            {showForm ? (
                <EditProfileForm profile={isEditing ? editingProfile : null} onSave={handleSave} onDelete={handleDelete} onCancel={() => setEditingProfile(null)} uploadAvatar={uploadAvatar} />
            ) : (
                <div className="space-y-4">
                    {/* Profile grid */}
                    <div className="grid grid-cols-3 gap-3">
                        {profiles.map((p) => (
                            <ProfileCard key={p.id} profile={p} isActive={p.id === activeProfileId} onSelect={handleSelect} onEdit={(p) => setEditingProfile(p)} />
                        ))}

                        {/* Add new profile (max 5) */}
                        {profiles.length < 5 && (
                            <button
                                onClick={() => setEditingProfile(false)}
                                className="flex flex-col items-center gap-2 p-3 rounded-xl border border-dashed border-white/15 hover:border-white/30 hover:bg-white/5 transition-all cursor-pointer"
                                style={{ outline: "none", boxShadow: "none" }}>
                                <div className="w-16 h-16 rounded-full bg-base-300/50 flex items-center justify-center">
                                    <Plus size={24} className="text-base-content/30" />
                                </div>
                                <span className="text-xs text-base-content/40">Add Profile</span>
                            </button>
                        )}
                    </div>

                    {profiles.length === 0 && <p className="text-center text-xs text-base-content/40 py-2">No profiles yet. Create one to get started.</p>}

                    {/* Account info */}
                    <div className="border-t border-white/5 pt-4 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center text-sm font-bold text-primary">{user?.name?.[0]?.toUpperCase()}</div>
                            <div>
                                <p className="text-xs font-medium text-base-content">{user?.name}</p>
                                <p className="text-[10px] text-base-content/40">{user?.role === "admin" ? "Admin" : "Member"}</p>
                            </div>
                        </div>
                        <button onClick={handleLogout} className="btn btn-xs btn-error btn-outline rounded gap-1" style={{ outline: "none" }}>
                            <LogOut size={11} /> Sign out
                        </button>
                    </div>
                </div>
            )}
        </Modal>
    );
}
