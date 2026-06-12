// web/src/components/auth/PendingApprovalView.jsx
// Shown inside AuthModal when user's account is pending admin approval.

import { Clock, LogOut } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";

export default function PendingApprovalView({ onClose }) {
    const { user, logout } = useAuth();

    function handleLogout() {
        logout();
        onClose?.();
    }

    return (
        <div className="flex flex-col items-center gap-4 py-4 text-center">
            <div className="relative">
                <div className="w-16 h-16 rounded-full bg-warning/10 border border-warning/20 flex items-center justify-center">
                    <Clock size={28} className="text-warning" />
                </div>
                <span className="absolute inset-0 rounded-full border-2 border-warning/30 animate-ping" style={{ animationDuration: "2s" }} />
            </div>

            <div>
                <h3 className="font-semibold text-base-content">Waiting for approval</h3>
                <p className="text-xs text-base-content/50 mt-1 max-w-[260px] leading-relaxed">
                    Hi <span className="text-base-content font-medium">{user?.name || "there"}</span>!
                    An admin will approve your account soon. You'll be notified by email.
                </p>
            </div>

            <div className="bg-base-300/50 rounded-lg px-4 py-3 w-full text-left">
                <p className="text-xs text-base-content/40">Registered as</p>
                <p className="text-sm font-medium text-base-content mt-0.5">{user?.email}</p>
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
