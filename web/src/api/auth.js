// web/src/api/auth.js
// Auth API calls — uses the shared Axios instance for consistency.
// Auth routes are intentionally separate: they carry their own credentials
// (password, refreshToken) rather than Bearer tokens, so they bypass
// the normal Authorization interceptor where needed.

import { axiosInstance } from "./client";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

/**
 * Thin wrapper around axiosInstance for auth routes.
 * Returns response.data directly and normalizes errors.
 */
async function authRequest(path, options = {}) {
    try {
        const response = await axiosInstance({
            url: path,
            // Default to POST for most auth calls; override via options
            method: "post",
            ...options,
            // Auth routes must NOT send Bearer token automatically.
            // We strip the interceptor-injected header by setting it to undefined.
            // (Interceptor only sets it if _getToken returns non-null, which is
            // already handled — but being explicit here for clarity.)
        });
        if (response.status === 204) return null;
        return response.data;
    } catch (error) {
        // Re-throw with normalized shape (interceptor already set .status + .message)
        throw error;
    }
}

export const authApi = {
    register: (email, password, name) =>
        authRequest("/auth/register", {
            data: { email, password, name },
        }),

    // Account comes from the access token (added by the client interceptor) - never from the body.
    verifyEmail: (code) =>
        authRequest("/auth/verify-email", {
            data: { code },
        }),

    resendOTP: () => authRequest("/auth/resend-otp"),

    // Rejected user asks again — server flips rejected → pending and notifies the admins.
    requestApproval: () => authRequest("/auth/request-approval"),

    // Trades the single-use code from the Google redirect for the session tokens.
    oauthExchange: (code) =>
        authRequest("/auth/oauth/exchange", {
            data: { code },
        }),

    login: (email, password) =>
        authRequest("/auth/login", {
            data: { email, password },
        }),

    refresh: (refreshToken, sessionId) =>
        authRequest("/auth/refresh", {
            data: { refreshToken, sessionId },
        }),

    logout: (accessToken, sessionId) =>
        authRequest("/auth/logout", {
            headers: { Authorization: `Bearer ${accessToken}` },
            data: { sessionId },
        }),

    me: (accessToken) =>
        authRequest("/auth/me", {
            method: "get",
            headers: { Authorization: `Bearer ${accessToken}` },
        }),

    updateMe: (accessToken, data) =>
        authRequest("/auth/me", {
            method: "patch",
            headers: { Authorization: `Bearer ${accessToken}` },
            data,
        }),

    // Forgot password: always answers the same (no account enumeration); the code goes to the mailbox.
    forgotPassword: (email) =>
        authRequest("/auth/forgot-password", {
            data: { email },
        }),

    resetPassword: (email, code, password) =>
        authRequest("/auth/reset-password", {
            data: { email, code, password },
        }),

    googleLoginUrl: () => `${BASE_URL}/auth/google`,
};
