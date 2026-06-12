import { useAuth } from "../../auth/AuthContext";

export default function PendingPage() {
    const { user, logout } = useAuth();

    return (
        <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
            <div className="w-full max-w-md text-center">
                {/* Animated waiting icon */}
                <div className="relative mx-auto w-24 h-24 mb-8">
                    <div className="w-24 h-24 rounded-full border-4 border-primary/20 flex items-center justify-center">
                        <span className="text-4xl animate-pulse">⏳</span>
                    </div>
                    <div className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent animate-spin opacity-30"></div>
                </div>

                <h1 className="text-2xl font-bold text-base-content mb-3">Waiting for approval</h1>
                <p className="text-base-content/50 text-sm mb-8 max-w-xs mx-auto leading-relaxed">
                    Hi <span className="text-base-content font-medium">{user?.name || "there"}</span>! Your account is under review. An admin will approve your access soon.
                </p>

                <div className="bg-base-200 rounded-2xl p-6 border border-base-300 mb-6">
                    <div className="flex items-center gap-3 text-left">
                        <div className="w-8 h-8 rounded-full bg-warning/10 border border-warning/20 flex items-center justify-center shrink-0">
                            <span className="text-sm">📧</span>
                        </div>
                        <div>
                            <p className="text-sm font-medium text-base-content">Registered as</p>
                            <p className="text-xs text-base-content/50">{user?.email}</p>
                        </div>
                    </div>
                </div>

                <p className="text-xs text-base-content/30 mb-6">
                    You'll have access to the media library once an admin approves your account.
                </p>

                <button
                    id="pending-logout-btn"
                    type="button"
                    className="btn btn-ghost btn-sm text-base-content/40"
                    onClick={logout}
                >
                    Sign out
                </button>
            </div>
        </div>
    );
}
