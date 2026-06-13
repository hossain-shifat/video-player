// web/src/components/auth/AvatarUpload.jsx
// ImgBB avatar upload widget — click to pick image, uploads to ImgBB, returns URL.

import { useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";

export default function AvatarUpload({ currentAvatar, name, onUpload }) {
    const inputRef = useRef(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState(null);

    const initial = name?.[0]?.toUpperCase() ?? "?";

    async function handleFileChange(e) {
        const file = e.target.files?.[0];
        if (!file) return;

        // Validate file type
        if (!file.type.startsWith("image/")) {
            setError("Please select an image file");
            return;
        }
        // Validate size (max 5MB)
        if (file.size > 5 * 1024 * 1024) {
            setError("Image must be under 5MB");
            return;
        }

        setError(null);
        setUploading(true);
        try {
            await onUpload(file);
        } catch (err) {
            setError(err.message || "Upload failed");
        } finally {
            setUploading(false);
            // Reset input so same file can be re-selected
            if (inputRef.current) inputRef.current.value = "";
        }
    }

    return (
        <div className="flex flex-col items-center gap-2">
            <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
                className="relative group cursor-pointer"
                style={{ outline: "none" }}>
                {/* Avatar display */}
                <div className="w-20 h-20 rounded-full overflow-hidden ring-2 ring-primary/25 bg-primary/15 flex items-center justify-center">
                    {currentAvatar ? (
                        <img src={currentAvatar} alt="Avatar" className="w-full h-full object-cover" />
                    ) : (
                        <span className="text-3xl font-bold text-primary">{initial}</span>
                    )}
                </div>

                {/* Overlay */}
                <div className={`absolute inset-0 rounded-full flex items-center justify-center bg-black/50 transition-opacity ${uploading ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                    {uploading
                        ? <Loader2 size={22} className="text-white animate-spin" />
                        : <Camera size={22} className="text-white" />
                    }
                </div>
            </button>

            {error && <p className="text-xs text-error">{error}</p>}
            {!error && <p className="text-xs text-base-content/30">Click to upload photo</p>}

            <label htmlFor="auth-avatar-upload" className="sr-only">Upload Profile Picture</label>
            <input
                id="auth-avatar-upload"
                name="avatarUpload"
                ref={inputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
            />
        </div>
    );
}
