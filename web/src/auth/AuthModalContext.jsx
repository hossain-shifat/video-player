// web/src/auth/AuthModalContext.jsx
// Global context that lets any component open the auth modal.
// Usage: const { openAuthModal } = useAuthModal();
//        openAuthModal({ view: 'login', onSuccess: () => doSomething() });

import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { useAuth } from "./AuthContext";

const AuthModalContext = createContext(null);

export function AuthModalProvider({ children }) {
    const { registerModalOpener, loading: authLoading } = useAuth();

    const [state, setState] = useState({
        isOpen: false,
        view: "login", // 'login' | 'register' | 'verify-otp' | 'pending' | 'expired'
        onSuccess: null,
        meta: {}, // extra data like { userId, email }
    });

    const openAuthModal = useCallback(
        (opts = {}) => {
            // Never open during auth initialization — session might still be restoring
            if (authLoading) return;
            setState({
                isOpen: true,
                view: opts.view || "login",
                onSuccess: opts.onSuccess || null,
                meta: opts.meta || {},
            });
        },
        [authLoading],
    );

    // Wire into AuthContext so 401s can trigger this modal
    useEffect(() => {
        registerModalOpener(openAuthModal);
    }, [registerModalOpener, openAuthModal]);

    const closeAuthModal = useCallback(() => {
        setState((s) => ({ ...s, isOpen: false, onSuccess: null, meta: {} }));
    }, []);

    const setView = useCallback((view, meta = {}) => {
        setState((s) => ({ ...s, view, meta: { ...s.meta, ...meta } }));
    }, []);

    const value = { ...state, openAuthModal, closeAuthModal, setView };

    return <AuthModalContext.Provider value={value}>{children}</AuthModalContext.Provider>;
}

export function useAuthModal() {
    const ctx = useContext(AuthModalContext);
    if (!ctx) throw new Error("useAuthModal must be used inside <AuthModalProvider>");
    return ctx;
}
