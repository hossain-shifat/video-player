// web/src/Auth/AuthContext.jsx
// Auth state, token management, session persistence.
// Uses localStorage for token storage (simple, matches existing FLUX pattern).

import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { authApi } from "../Api/auth";
import { registerAuthProvider, setAuthLoading } from "../Api/client";

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

    // Persist an updated user object (status / verification changes) next to the stored session.
    const applyUser = useCallback((u) => {
        if (!u) return;
        setUser(u);
        const session = sessionRef.current;
        if (session) saveToStorage({ ...session, user: u });
    }, []);

    // Verifies the e-mail of the SIGNED-IN (restricted) account — the server takes the account from the
    // access token, so no userId travels in the body. Returns the authoritative user (status, canPlay…).
    const verifyEmail = useCallback(
        async (code) => {
            setError(null);
            const res = await authApi.verifyEmail(code);
            applyUser(res.user);
            return res.user;
        },
        [applyUser],
    );

    const resendOTP = useCallback(() => authApi.resendOTP(), []);

    // Rejected → pending in one click (no sign-out / delete / re-register). Returns { requested, user }.
    const requestApproval = useCallback(async () => {
        const res = await authApi.requestApproval();
        applyUser(res.user);
        return res;
    }, [applyUser]);

    // Re-read the account from the server (status can change while the tab is open: approval, block, expiry).
    const refreshUser = useCallback(async () => {
        const token = accessTokenRef.current;
        if (!token) return null;
        try {
            const res = await authApi.me(token);
            applyUser(res.user);
            return res.user;
        } catch {
            return null; // 401 is handled by the API client (refresh → sign-out)
        }
    }, [applyUser]);

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

            // `_emailSent` (login of an unverified account only): false = the server could not send the code.
            return { ...data.user, _emailSent: data.emailSent };
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

    // ─── Finish Google sign-in: trade the single-use code from the redirect for the session ──────
    const loginWithOAuthCode = useCallback(
        async (code) => {
            const data = await authApi.oauthExchange(code);
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

    // Kept for backward compatibility with AuthModalContext's shim (no modal exists any more).
    const registerModalOpener = useCallback(() => {}, []);

    // ─── Register with API client (enables auto-JWT injection + silent refresh) ─
    useEffect(() => {
        registerAuthProvider(
            () => accessTokenRef.current, // always returns latest (no closure staleness)
            () => {
                // 401 after refresh also failed → session is gone. Clearing auth state makes the route
                // guards send the user to /login (full page), keeping the page they were on in `from`.
                clearAuth();
            },
            // Silent refresh callback — called by api client on 401 with expired token
            async () => {
                await doRefresh();
                return accessTokenRef.current; // return new token from ref
            },
        );
    }, [clearAuth, doRefresh]); // no accessToken dep needed — using ref

    // ─── Keep account state fresh ──────────────────────────────────────────────
    // The server answered 403 EMAIL_NOT_VERIFIED / PENDING_APPROVAL / … (see api/client.js) or the tab
    // regained focus while the account cannot play yet (e.g. waiting for approval): re-read it.
    const lastRefreshRef = useRef(0);
    useEffect(() => {
        const maybeRefresh = () => {
            const now = Date.now();
            if (now - lastRefreshRef.current < 3000) return;
            lastRefreshRef.current = now;
            refreshUser();
        };
        const onVisible = () => {
            if (document.visibilityState === "visible" && sessionRef.current && !(user?.canPlay)) maybeRefresh();
        };
        window.addEventListener("flux:account-state-changed", maybeRefresh);
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            window.removeEventListener("flux:account-state-changed", maybeRefresh);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, [refreshUser, user?.canPlay]);

    // ─── Context value ─────────────────────────────────────────────────────────
    const value = {
        user,
        accessToken,
        loading,
        error,
        isAuthenticated: !!user,
        isEmailVerified: !!user?.emailVerified,
        // browsing = signed in + verified e-mail (admin approval NOT required)
        canBrowse: !!user?.emailVerified && user?.status !== "blocked" && user?.status !== "rejected",
        // server's verdict on "may watch right now" (approved + active access + verified)
        canPlay: !!user?.canPlay,
        isApproved: user?.status === "approved",
        isPending: user?.status === "pending",
        isBlocked: user?.status === "blocked",
        isExpired: user?.accessType === "temporary" && user?.accessExpiresAt && Date.now() > new Date(user.accessExpiresAt).getTime(),
        isAdmin: user?.role === "admin",
        permissions: user?.permissions || {},
        register,
        verifyEmail,
        resendOTP,
        requestApproval,
        login,
        loginWithTokens,
        loginWithOAuthCode,
        refreshUser,
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
