// web/src/Auth/AuthModalContext.jsx
//
// COMPATIBILITY SHIM. Sign-in / registration / verification are now full pages (/login, /register,
// /verify-email) — there is no auth modal any more. Existing callers (Navbar, Settings…) still do
//   const { openAuthModal } = useAuthModal();  openAuthModal({ view: "login" });
// so this keeps that API and simply navigates to the matching page.
//
// <AuthModalProvider navigate={(to, opts) => router.navigate(to, opts)}> is mounted in main.jsx
// (outside the router, hence the navigate prop instead of useNavigate).

import { createContext, useContext, useCallback, useMemo } from "react";

const AuthModalContext = createContext(null);

const VIEW_TO_PATH = {
    login: "/login",
    register: "/register",
    "verify-otp": "/verify-email",
    "verify-email": "/verify-email",
    pending: "/",
    expired: "/access-expired",
};

export function AuthModalProvider({ children, navigate }) {
    const openAuthModal = useCallback(
        (opts = {}) => {
            const to = VIEW_TO_PATH[opts.view || "login"] || "/login";
            const here = `${window.location.pathname}${window.location.search}`;
            if (here === to) return;
            // remember where to come back to after signing in
            const from = here !== "/login" && here !== "/register" ? { pathname: window.location.pathname, search: window.location.search } : undefined;
            navigate?.(to, { state: from ? { from } : undefined });
        },
        [navigate],
    );

    const value = useMemo(
        () => ({
            isOpen: false,
            view: "login",
            meta: {},
            openAuthModal,
            closeAuthModal: () => {},
            setView: () => {},
        }),
        [openAuthModal],
    );

    return <AuthModalContext.Provider value={value}>{children}</AuthModalContext.Provider>;
}

export function useAuthModal() {
    const ctx = useContext(AuthModalContext);
    if (!ctx) throw new Error("useAuthModal must be used inside <AuthModalProvider>");
    return ctx;
}
