import { Link } from "react-router";
import { Hourglass } from "lucide-react";
import { useAuth } from "../../Auth/AuthContext";
import { AuthPanel, AuthBadge, AuthHeading } from "../../Components/Auth/AuthUI";

// Optional status page. Pending users are NOT forced here — they can browse FLUX — but it explains
// where their account stands and is linked from the approval flow.
export default function PendingPage() {
    const { user, logout } = useAuth();

    return (
        <AuthPanel>
            <AuthBadge icon={Hourglass} tone="warning" />
            <AuthHeading
                persistent
                title="Waiting for approval"
                subtitle={
                    <>
                        Hi {user?.name || "there"}, an administrator will review <span className="font-medium text-base-content [overflow-wrap:anywhere]">{user?.email}</span> soon.
                    </>
                }
            />
            <p className="auth-sub mb-[var(--auth-gap-lg)] text-sm leading-relaxed text-base-content/60">
                You can browse FLUX and explore the library while you wait. Watching becomes available once your account is approved.
            </p>
            <div className="flex flex-col gap-2.5">
                <Link
                    to="/"
                    id="pending-browse-btn"
                    className="flex h-[var(--auth-field)] w-full items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-content shadow-lg shadow-primary/20 transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                    Browse FLUX
                </Link>
                <button id="pending-logout-btn" type="button" onClick={logout} className="h-9 rounded-lg text-sm text-base-content/55 transition-colors hover:text-base-content">
                    Sign out
                </button>
            </div>
        </AuthPanel>
    );
}
