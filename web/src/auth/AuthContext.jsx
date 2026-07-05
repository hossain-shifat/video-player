// web/src/auth/AuthContext.jsx
// Auth state, token management, session persistence.
// Uses localStorage for token storage (simple, matches existing FLUX pattern).

import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { authApi } from "../api/auth";
import { registerAuthProvider, setAuthLoading } from "../api/client";

const AuthContext = createContext(null);

const STORAGE_KEY = "flux_auth";

function loadFromStorage() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function saveToStorage(data) {
    if (!data) {
        localStorage.removeItem(STORAGE_KEY);
    } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }
}

// Module-level deduplication: prevents StrictMode from firing two refresh
// calls simultaneously (double-invoke would rotate token twice → second 401).
// Both effect invocations share this promise and get the same result.
let _refreshInFlight = null;

function dedupeRefresh(refreshToken, sessionId) {
    if (_refreshInFlight) return _refreshInFlight;
    _refreshInFlight = authApi.refresh(refreshToken, sessionId).finally(() => {
        _refreshInFlight = null;
    });
    return _refreshInFlight;
}

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [accessToken, setAccessToken] = useState(null);
    const [loading, setLoading] = useState(true); // true while restoring session
    const [error, setError] = useState(null);

    // Ref so API client always has latest token without closure staleness
    const accessTokenRef = useRef(null);
    const setAccessTokenBoth = useCallback((t) => {
        accessTokenRef.current = t;
        setAccessToken(t);
    }, []);

    const refreshTimerRef = useRef(null);
    const sessionRef = useRef(null); // { refreshToken, sessionId }

    // ─── Clear auth state ──────────────────────────────────────────────────────
    const clearAuth = useCallback(() => {
        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
        sessionRef.current = null;
        accessTokenRef.current = null;
        setUser(null);
        setAccessToken(null);
        saveToStorage(null);
    }, []);

    // ─── Token refresh ─────────────────────────────────────────────────────────
    // Use a ref so scheduleRefresh always calls the latest doRefresh without circular deps
    const doRefreshRef = useRef(null);

    const scheduleRefresh = useCallback((expiresInMs) => {
        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
        // Refresh 1 hour before expiry (tokens are now 7 days)
        const delay = Math.max(0, expiresInMs - 60 * 60 * 1000);
        refreshTimerRef.current = setTimeout(() => {
            doRefreshRef.current?.();
        }, delay);
    }, []);

    const doRefresh = useCallback(async () => {
        const session = sessionRef.current;
        if (!session?.refreshToken || !session?.sessionId) return;

        try {
            const data = await authApi.refresh(session.refreshToken, session.sessionId);
            const newSession = { refreshToken: data.refreshToken, sessionId: session.sessionId };
            sessionRef.current = newSession;
            setAccessTokenBoth(data.accessToken); // updates ref + state
            setUser(data.user);
            saveToStorage({ ...newSession, user: data.user });

            // Schedule next refresh (15m access token)
            scheduleRefresh(7 * 24 * 60 * 60 * 1000);
        } catch (err) {
            // Only log out if it's an explicit auth failure (401/403)
            // Network errors (ECONNREFUSED) or 500s during restart should NOT wipe session
            if (err?.status === 401 || err?.status === 403) {
                clearAuth();
            }
        }
    }, [scheduleRefresh, clearAuth, setAccessTokenBoth]);

    // Keep doRefreshRef in sync
    doRefreshRef.current = doRefresh;

    // ─── Restore session on mount ──────────────────────────────────────────────
    useEffect(() => {
        let cancelled = false;

        const stored = loadFromStorage();
        if (!stored?.refreshToken || !stored?.sessionId) {
            setLoading(false);
            setAuthLoading(false);
            return () => {
                cancelled = true;
            };
        }

        sessionRef.current = { refreshToken: stored.refreshToken, sessionId: stored.sessionId };

        // Validate session by refreshing immediately.
        // dedupeRefresh ensures StrictMode double-invoke shares one promise —
        // token is only rotated once, both invocations get the same result.
        dedupeRefresh(stored.refreshToken, stored.sessionId)
            .then((data) => {
                if (cancelled) return; // StrictMode cleanup — discard
                const newSession = { refreshToken: data.refreshToken, sessionId: stored.sessionId };
                sessionRef.current = newSession;
                setAccessTokenBoth(data.accessToken);
                setUser(data.user);
                saveToStorage({ ...newSession, user: data.user });
                scheduleRefresh(7 * 24 * 60 * 60 * 1000);
            })
            .catch((err) => {
                if (cancelled) return; // StrictMode cleanup — discard
                // Only clear session if explicitly revoked/expired
                if (err?.status === 401 || err?.status === 403) {
                    clearAuth();
                } else {
                    console.warn("[Auth] Session restore failed (network/server error), keeping persistent token");
                }
            })
            .finally(() => {
                if (cancelled) return;
                setLoading(false);
                setAuthLoading(false);
            });

        return () => {
            cancelled = true;
            if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ─── Auth actions ──────────────────────────────────────────────────────────
    const register = useCallback(
        async (email, password, name) => {
            setError(null);
            const data = await authApi.register(email, password, name);

            // Log in immediately if tokens were provided
            if (data.accessToken && data.refreshToken) {
                const session = { refreshToken: data.refreshToken, sessionId: data.sessionId };
                sessionRef.current = session;
                setAccessTokenBoth(data.accessToken);
                setUser(data.user);
                saveToStorage({ ...session, user: data.user });
                scheduleRefresh(7 * 24 * 60 * 60 * 1000);
            }

            return data; // { userId, requiresVerification }
        },
        [scheduleRefresh, setAccessTokenBoth],
    );

    const verifyEmail = useCallback(async (userId, code) => {
        setError(null);
        return authApi.verifyEmail(userId, code);
    }, []);

    const resendOTP = useCallback(async (userId) => {
        return authApi.resendOTP(userId);
    }, []);

    const login = useCallback(
        async (email, password) => {
            setError(null);
            const data = await authApi.login(email, password);

            const session = { refreshToken: data.refreshToken, sessionId: data.sessionId };
            sessionRef.current = session;
            setAccessTokenBoth(data.accessToken);
            setUser(data.user);
            saveToStorage({ ...session, user: data.user });
            scheduleRefresh(7 * 24 * 60 * 60 * 1000);

            return data.user;
        },
        [scheduleRefresh, setAccessTokenBoth],
    );

    const logout = useCallback(async () => {
        const session = sessionRef.current;
        if (accessToken && session?.sessionId) {
            authApi.logout(accessToken, session.sessionId).catch(() => {});
        }
        clearAuth();
    }, [accessToken, clearAuth]);

    const updateMe = useCallback(async (data) => {
        const token = accessTokenRef.current;
        if (!token) throw new Error("Not authenticated");
        const res = await authApi.updateMe(token, data);
        setUser(res.user);
        const session = sessionRef.current;
        if (session) {
            saveToStorage({ ...session, user: res.user });
        }
        return res.user;
    }, []);

    // ─── Login with pre-issued tokens (admin register shortcut) ──────────────
    const loginWithTokens = useCallback(
        ({ accessToken: at, refreshToken, sessionId, user: u }) => {
            const session = { refreshToken, sessionId };
            sessionRef.current = session;
            setAccessTokenBoth(at);
            setUser(u);
            saveToStorage({ ...session, user: u });
            scheduleRefresh(7 * 24 * 60 * 60 * 1000);
        },
        [scheduleRefresh, setAccessTokenBoth],
    );

    // ─── Get current access token (uses ref for zero-staleness) ──────────────
    const getToken = useCallback(() => accessTokenRef.current, []);

    // ─── Auth modal opener registration (set by AuthModalContext) ─────────────
    // AuthModalContext calls this to allow 401s to trigger re-auth modal
    const openModalRef = useRef(null);
    const registerModalOpener = useCallback((fn) => {
        openModalRef.current = fn;
    }, []);

    // ─── Register with API client (enables auto-JWT injection + silent refresh) ─
    useEffect(() => {
        registerAuthProvider(
            () => accessTokenRef.current, // always returns latest (no closure staleness)
            () => {
                // 401 after refresh also failed — show re-auth modal
                if (openModalRef.current) {
                    openModalRef.current({ view: "login" });
                } else {
                    clearAuth();
                }
            },
            // Silent refresh callback — called by api client on 401 with expired token
            async () => {
                await doRefresh();
                return accessTokenRef.current; // return new token from ref
            },
        );
    }, [clearAuth, doRefresh]); // no accessToken dep needed — using ref

    // ─── Context value ─────────────────────────────────────────────────────────
    const value = {
        user,
        accessToken,
        loading,
        error,
        isAuthenticated: !!user,
        isApproved: user?.status === "approved",
        isPending: user?.status === "pending",
        isBlocked: user?.status === "blocked",
        isExpired: user?.accessType === "temporary" && user?.accessExpiresAt && Date.now() > new Date(user.accessExpiresAt).getTime(),
        isAdmin: user?.role === "admin",
        permissions: user?.permissions || {},
        register,
        verifyEmail,
        resendOTP,
        login,
        loginWithTokens,
        logout,
        updateMe,
        getToken,
        registerModalOpener,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
    return ctx;
}
