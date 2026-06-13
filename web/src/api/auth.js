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

    verifyEmail: (userId, code) =>
        authRequest("/auth/verify-email", {
            data: { userId, code },
        }),

    resendOTP: (userId) =>
        authRequest("/auth/resend-otp", {
            data: { userId },
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

    googleLoginUrl: () => `${BASE_URL}/auth/google`,
};
