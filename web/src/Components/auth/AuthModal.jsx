// web/src/components/auth/AuthModal.jsx
// Main auth modal — orchestrates login/register/OTP/pending/expired views.
// Mount once at app root. Controlled via AuthModalContext.

import { useAuthModal } from "../../auth/AuthModalContext";
import { useAuth } from "../../auth/AuthContext";
import { Modal } from "../../Pages/Settings/shared";
import LoginForm from "./LoginForm";
import RegisterForm from "./RegisterForm";
import VerifyOTPForm from "./VerifyOTPForm";
import PendingApprovalView from "./PendingApprovalView";
import ExpiredAccessView from "./ExpiredAccessView";

const VIEW_TITLES = {
    login: { title: "Sign In", subtitle: "Access FLUX Media" },
    register: { title: "Create Account", subtitle: "Join FLUX" },
    "verify-otp": { title: "Verify Email", subtitle: "Enter the code we sent you" },
    pending: { title: "Account Pending", subtitle: null },
    expired: { title: "Access Expired", subtitle: null },
};

export default function AuthModal() {
    const { isOpen, view, onSuccess, meta, closeAuthModal, setView } = useAuthModal();
    const { login, loginWithTokens, isAuthenticated, isApproved, isPending, isExpired } = useAuth();

    // Sync view with auth state changes (e.g. if user already logged in & approved)
    function handleSuccess(user) {
        if (user?.status === "pending") {
            setView("pending");
            return;
        }
        if (user?.accessType === "temporary" && user?.accessExpiresAt && Date.now() > new Date(user.accessExpiresAt).getTime()) {
            setView("expired");
            return;
        }
        if (user?.status === "blocked" || user?.status === "rejected") {
            // Just close — user is blocked, nothing to do
            closeAuthModal();
            return;
        }
        closeAuthModal();
        onSuccess?.();
    }

    async function handleLoginSuccess(user) {
        handleSuccess(user);
    }

    function handleSwitchToRegister() {
        setView("register");
    }

    function handleSwitchToLogin() {
        setView("login");
    }

    function handleOTPRequired(meta) {
        // meta: { userId, email } — from register
        setView("verify-otp", meta);
    }

    function handleLoginOTPRequired({ email, userId }) {
        // Login 403 EMAIL_NOT_VERIFIED — user registered but email not verified yet
        setView("verify-otp", { email, userId });
    }

    async function handleOTPVerified({ userId }) {
        // After OTP verified, user is in "pending" or "approved" state
        // We need to check which. The server returns success from verifyEmail but doesn't
        // return user data. Check via /auth/me (skip — instead rely on subsequent login).
        // Simplest: ask user to log in now that email is verified.
        setView("login");
    }

    async function handleAdminCreated(data) {
        // Admin register returned full tokens — log in directly
        loginWithTokens(data);
        closeAuthModal();
        onSuccess?.();
    }

    if (!isOpen) return null;

    const { title, subtitle } = VIEW_TITLES[view] || VIEW_TITLES.login;

    return (
        <Modal open={isOpen} onClose={closeAuthModal} title={title} subtitle={subtitle}>
            {view === "login" && (
                <LoginForm
                    onSuccess={handleLoginSuccess}
                    onSwitchToRegister={handleSwitchToRegister}
                    onOTPRequired={handleLoginOTPRequired}
                />
            )}
            {view === "register" && (
                <RegisterForm
                    onSuccess={handleLoginSuccess}
                    onSwitchToLogin={handleSwitchToLogin}
                    onOTPRequired={handleOTPRequired}
                    onAdminCreated={handleAdminCreated}
                />
            )}
            {view === "verify-otp" && (
                <VerifyOTPForm
                    userId={meta?.userId}
                    email={meta?.email}
                    onVerified={handleOTPVerified}
                />
            )}
            {view === "pending" && (
                <PendingApprovalView onClose={closeAuthModal} />
            )}
            {view === "expired" && (
                <ExpiredAccessView onClose={closeAuthModal} />
            )}
        </Modal>
    );
}
