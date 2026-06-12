import { useAuth } from "../../auth/AuthContext";
import { Link } from "react-router";

export default function ExpiredPage() {
    const { user, logout } = useAuth();

    const expiresAt = user?.accessExpiresAt ? new Date(user.accessExpiresAt) : null;

    return (
        <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
            <div className="w-full max-w-md text-center">
                <div className="w-20 h-20 rounded-full bg-warning/10 border border-warning/20 flex items-center justify-center mx-auto mb-8">
                    <span className="text-4xl">⌛</span>
                </div>

                <h1 className="text-2xl font-bold text-base-content mb-3">Access expired</h1>
                <p className="text-base-content/50 text-sm mb-8 max-w-xs mx-auto leading-relaxed">
                    {expiresAt
                        ? `Your temporary access expired on ${expiresAt.toLocaleDateString()}.`
                        : "Your temporary access has expired."}
                    {" "}Contact an admin to renew your access.
                </p>

                <div className="bg-base-200 rounded-2xl p-6 border border-base-300 mb-6 text-left space-y-3">
                    <div className="flex items-center gap-3">
                        <span className="text-base-content/40 text-sm w-20">Account</span>
                        <span className="text-sm font-medium">{user?.name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="text-base-content/40 text-sm w-20">Email</span>
                        <span className="text-sm">{user?.email}</span>
                    </div>
                    {expiresAt && (
                        <div className="flex items-center gap-3">
                            <span className="text-base-content/40 text-sm w-20">Expired</span>
                            <span className="text-sm text-warning">{expiresAt.toLocaleString()}</span>
                        </div>
                    )}
                </div>

                <button
                    id="expired-logout-btn"
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

// Access denied page (blocked/rejected)
export function AccessDeniedPage() {
    const { user, logout } = useAuth();

    return (
        <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
            <div className="w-full max-w-md text-center">
                <div className="w-20 h-20 rounded-full bg-error/10 border border-error/20 flex items-center justify-center mx-auto mb-8">
                    <span className="text-4xl">🚫</span>
                </div>

                <h1 className="text-2xl font-bold text-base-content mb-3">Access denied</h1>
                <p className="text-base-content/50 text-sm mb-8 max-w-xs mx-auto">
                    Your account has been {user?.status === "blocked" ? "blocked" : "rejected"}.
                    Contact an administrator if you believe this is an error.
                </p>

                <button
                    id="denied-logout-btn"
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
