// web/src/auth/PlaybackGate.jsx
// Guards the routes that START playback (/player/:id, /live/watch/:id).
//   - not signed in / unverified / blocked / expired → same destinations as AuthGate
//   - verified but waiting for approval → "Approval Required" modal; "Got it" returns to the page
//     the user came from. Playback never starts (and the server would refuse the stream anyway).
//   - approved → renders the player.

import { Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { useAuth } from "./AuthContext";
import { requiredPathFor } from "./accountRouting";
import { FullScreenSpinner } from "./AuthGate";
import ApprovalRequiredModal from "../Components/auth/ApprovalRequiredModal";

export default function PlaybackGate() {
    const { user, loading } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();

    if (loading) return <FullScreenSpinner />;

    const target = requiredPathFor(user);
    if (target) return <Navigate to={target} replace state={target === "/login" ? { from: location } : undefined} />;

    // The server's verdict (approved + active access + verified). Fall back to status for older sessions
    // restored from storage before `canPlay` existed — a refresh on load replaces it with the real value.
    const canPlay = user.canPlay ?? user.status === "approved";
    if (!canPlay) {
        const goBack = () => (window.history.length > 1 && location.key !== "default" ? navigate(-1) : navigate("/", { replace: true }));
        return (
            <div className="min-h-screen bg-base-100">
                <ApprovalRequiredModal open onClose={goBack} />
            </div>
        );
    }
    return <Outlet />;
}
