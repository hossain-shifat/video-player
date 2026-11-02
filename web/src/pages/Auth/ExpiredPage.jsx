import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { Clock, ShieldBan } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { AuthPanel, AuthBadge, AuthHeading, AuthAlert, AuthSubmit } from "../../Components/auth/AuthUI";

function Row({ label, value, tone }) {
    return (
        <div className="flex items-baseline gap-3 border-t border-base-content/10 py-2.5 first:border-t-0 text-sm">
            <span className="w-16 shrink-0 text-base-content/50">{label}</span>
            <span className={`min-w-0 [overflow-wrap:anywhere] ${tone || "text-base-content"}`}>{value}</span>
        </div>
    );
}

function SignOut({ id }) {
    const { logout } = useAuth();
    return (
        <button id={id} type="button" onClick={logout} className="mt-[var(--auth-gap)] h-9 w-full rounded-lg text-sm text-base-content/55 transition-colors hover:text-base-content">
            Sign out
        </button>
    );
}

export default function ExpiredPage() {
    const { user } = useAuth();
    const expiresAt = user?.accessExpiresAt ? new Date(user.accessExpiresAt) : null;

    return (
        <AuthPanel>
            <AuthBadge icon={Clock} tone="warning" />
            <AuthHeading
                persistent
                title="Your access has expired"
                subtitle={`${expiresAt ? `Your temporary access ended on ${expiresAt.toLocaleDateString()}.` : "Your temporary access has ended."} Ask an administrator to renew it.`}
            />
            <div className="rounded-xl border border-base-content/10 bg-base-200/50 px-4">
                <Row label="Account" value={user?.name} />
                <Row label="Email" value={user?.email} />
                {expiresAt && <Row label="Expired" value={expiresAt.toLocaleString()} tone="text-warning" />}
            </div>
            <SignOut id="expired-logout-btn" />
        </AuthPanel>
    );
}

// Access denied page — REJECTED accounts only. A blocked account is reported by the server as "pending",
// so it never lands here. The user can ask again with one click (no sign-out, no delete, no re-register).
export function AccessDeniedPage() {
    const { user, requestApproval } = useAuth();
    const navigate = useNavigate();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    // Stale tab / already re-requested / (masked) blocked → show the normal waiting page.
    if (user && user.status !== "rejected") return <Navigate to="/pending" replace />;

    const ask = async () => {
        setBusy(true);
        setError("");
        try {
            await requestApproval();
            navigate("/pending", { replace: true });
        } catch (err) {
            setError(err?.message || "Could not send your request. Try again.");
            setBusy(false);
        }
    };

    return (
        <AuthPanel>
            <AuthBadge icon={ShieldBan} tone="error" />
            <AuthHeading persistent title="Request not approved" subtitle="An administrator declined your account request. You can ask for another review." />
            {error && <AuthAlert>{error}</AuthAlert>}
            <div className="rounded-xl border border-base-content/10 bg-base-200/50 px-4">
                <Row label="Account" value={user?.name} />
                <Row label="Email" value={user?.email} />
            </div>
            <div className="mt-[var(--auth-gap)]">
                <AuthSubmit id="denied-request-btn" type="button" onClick={ask} loading={busy} loadingText="Sending request…">
                    Request approval again
                </AuthSubmit>
            </div>
            <SignOut id="denied-logout-btn" />
        </AuthPanel>
    );
}
