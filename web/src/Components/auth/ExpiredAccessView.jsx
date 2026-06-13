// web/src/components/auth/ExpiredAccessView.jsx
// Shown inside AuthModal when user's temporary access has expired.

import { Timer, LogOut } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";

export default function ExpiredAccessView({ onClose }) {
    const { user, logout } = useAuth();

    const expiresAt = user?.accessExpiresAt ? new Date(user.accessExpiresAt) : null;

    function handleLogout() {
        logout();
        onClose?.();
    }

    return (
        <div className="flex flex-col items-center gap-4 py-4 text-center">
            <div className="w-16 h-16 rounded-full bg-warning/10 border border-warning/20 flex items-center justify-center">
                <Timer size={28} className="text-warning" />
            </div>

            <div>
                <h3 className="font-semibold text-base-content">Access expired</h3>
                <p className="text-xs text-base-content/50 mt-1 max-w-[260px] leading-relaxed">
                    {expiresAt
                        ? `Your temporary access expired on ${expiresAt.toLocaleDateString()}.`
                        : "Your temporary access has expired."}
                    {" "}Contact an admin to renew.
                </p>
            </div>

            <div className="flex gap-2 w-full">
                <button
                    onClick={onClose}
                    style={{ outline: "none", boxShadow: "none" }}
                    className="btn btn-sm btn-ghost flex-1 rounded focus:outline-none">
                    Close
                </button>
                <button
                    onClick={handleLogout}
                    style={{ outline: "none", boxShadow: "none" }}
                    className="btn btn-sm btn-error btn-outline flex-1 rounded gap-1.5 focus:outline-none">
                    <LogOut size={12} /> Sign out
                </button>
            </div>
        </div>
    );
}
