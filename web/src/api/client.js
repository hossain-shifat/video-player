/**
 * web/src/api/client.js — FLUX Axios API client
 *
 * Architecture:
 *  - One shared axios instance (BASE_URL, timeout, default headers)
 *  - Request interceptor: inject Authorization header from auth provider
 *  - Response interceptor: normalize errors, handle 401 silent refresh + retry,
 *    trigger re-auth modal when refresh also fails
 *  - `api` facade (get/post/patch/delete) keeps the same interface as before
 *    so all existing call-sites remain compatible without changes
 *
 * Auth wiring:
 *  AuthContext calls registerAuthProvider() after mount to wire up
 *  token getter, refresh callback, and unauthorized handler.
 */

import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

// ─── Auth provider registration ───────────────────────────────────────────────
// AuthContext registers callbacks here to avoid circular imports.
let _getToken = null;
let _doRefresh = null; // async () => string | null
let _onUnauthorized = null;
let _isAuthLoading = true; // true until AuthContext finishes init

// In-flight refresh dedup — prevent parallel refresh storms
let _refreshInFlight = null;

export function registerAuthProvider(getToken, onUnauthorized, doRefresh) {
    _getToken = getToken;
    _onUnauthorized = onUnauthorized;
    _doRefresh = doRefresh || null;
}

/** Called by AuthContext when loading state changes */
export function setAuthLoading(loading) {
    _isAuthLoading = loading;
}

// ─── Axios instance ───────────────────────────────────────────────────────────

export const axiosInstance = axios.create({
    baseURL: BASE_URL,
    timeout: 30_000,
    headers: {
        "Content-Type": "application/json",
    },
});

// ─── Request interceptor: attach Authorization header ─────────────────────────

axiosInstance.interceptors.request.use((config) => {
    const token = _getToken ? _getToken() : null;
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// ─── Response interceptor: error normalization + 401 handling ─────────────────

axiosInstance.interceptors.response.use(
    // Success — pass through
    (response) => response,

    // Error
    async (error) => {
        const originalRequest = error.config;

        // Normalize: attach .status for consistent error checking downstream
        if (error.response) {
            error.status = error.response.status;
            // Extract server error message
            const body = error.response.data;
            if (body?.error) {
                error.message = body.error;
            }
        } else if (error.code === "ECONNABORTED") {
            error.status = 408; // timeout
            error.message = "Request timed out";
        } else {
            error.status = 0; // network error
            error.message = error.message || "Network error";
        }

        // ── 401 silent refresh + retry ────────────────────────────────────────
        // If we sent a token that got rejected (expired), try to refresh once.
        // Don't retry if: already retried, no refresh fn, or auth is loading.
        const hadToken = !!originalRequest?.headers?.Authorization;
        const isRetry = originalRequest?._retry;

        if (error.status === 401 && !isRetry && hadToken && _doRefresh && !_isAuthLoading) {
            originalRequest._retry = true;
            try {
                // Dedup: share in-flight refresh promise across concurrent requests
                if (!_refreshInFlight) {
                    _refreshInFlight = _doRefresh().finally(() => {
                        _refreshInFlight = null;
                    });
                }
                const newToken = await _refreshInFlight;
                if (newToken) {
                    // Retry with new token
                    originalRequest.headers.Authorization = `Bearer ${newToken}`;
                    return axiosInstance(originalRequest);
                }
            } catch {
                // Refresh failed — fall through to modal/throw
            }
        }

        // ── Modal trigger on true auth failure ────────────────────────────────
        // Only when: had token (was logged in) + not skipAuthHandler + not loading
        if (error.status === 401 && !_isAuthLoading && hadToken && !originalRequest?._skipAuthHandler) {
            if (_onUnauthorized) _onUnauthorized();
        }

        return Promise.reject(error);
    },
);

// ─── api facade — same interface as before ────────────────────────────────────
// Wraps axios to:
//  1. Strip axios response envelope (.data)
//  2. Map `skipAuthHandler` option to request config
//  3. Provide same get/post/patch/delete methods

async function request(path, axiosConfig = {}, extraOptions = {}) {
    try {
        const config = {
            ...axiosConfig,
            url: path,
        };
        if (extraOptions.skipAuthHandler) {
            config._skipAuthHandler = true;
        }
        if (extraOptions.headers) {
            config.headers = { ...config.headers, ...extraOptions.headers };
        }
        const response = await axiosInstance(config);
        // 204 No Content
        if (response.status === 204) return null;
        return response.data;
    } catch (error) {
        // Re-throw with normalized shape
        throw error;
    }
}

export const api = {
    /** GET — optional `{ headers, skipAuthHandler }` in second arg */
    get: (path, opts = {}) => request(path, { method: "get" }, opts),

    /** POST — optional `{ headers, skipAuthHandler }` in third arg */
    post: (path, body, opts = {}) => request(path, { method: "post", data: body }, opts),

    /** PATCH — optional `{ headers, skipAuthHandler }` in third arg */
    patch: (path, body, opts = {}) => request(path, { method: "patch", data: body }, opts),

    /** DELETE — optional `{ headers, skipAuthHandler }` in second arg */
    delete: (path, opts = {}) => request(path, { method: "delete" }, opts),

    /** Helpers for stream/subtitle URLs */
    streamUrl: (id) => `${BASE_URL}/stream/video/${id}`,
    subtitleUrl: (encoded) => `${BASE_URL}/stream/subtitle/${encoded}`,
    streamStartUrl: (id) => `${BASE_URL}/stream/start/${id}`,
};
