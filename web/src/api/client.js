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
let _getToken = null;
let _doRefresh = null;
let _onUnauthorized = null;
let _isAuthLoading = true;

let _refreshInFlight = null;

export function registerAuthProvider(getToken, onUnauthorized, doRefresh) {
    _getToken = getToken;
    _onUnauthorized = onUnauthorized;
    _doRefresh = doRefresh || null;
}

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

axiosInstance.interceptors.request.use((config) => {
    const token = _getToken ? _getToken() : null;
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

axiosInstance.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;

        if (error.response) {
            error.status = error.response.status;
            const body = error.response.data;
            if (body?.error) {
                error.message = body.error;
            }
        } else if (error.code === "ECONNABORTED") {
            error.status = 408;
            error.message = "Request timed out";
        } else {
            error.status = 0;
            error.message = error.message || "Network error";
        }

        const hadToken = !!originalRequest?.headers?.Authorization;
        const isRetry = originalRequest?._retry;

        if (error.status === 401 && !isRetry && hadToken && _doRefresh && !_isAuthLoading) {
            originalRequest._retry = true;
            try {
                if (!_refreshInFlight) {
                    _refreshInFlight = _doRefresh().finally(() => {
                        _refreshInFlight = null;
                    });
                }
                const newToken = await _refreshInFlight;
                if (newToken) {
                    originalRequest.headers.Authorization = `Bearer ${newToken}`;
                    return axiosInstance(originalRequest);
                }
            } catch {
                // Refresh failed — fall through to modal/throw
            }
        }

        if (error.status === 401 && !_isAuthLoading && hadToken && !originalRequest?._skipAuthHandler) {
            if (_onUnauthorized) _onUnauthorized();
        }

        return Promise.reject(error);
    },
);

// ─── api facade ────────────────────────────────────────────────────────────

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
        if (response.status === 204) return null;
        return response.data;
    } catch (error) {
        throw error;
    }
}

export const api = {
    get: (path, opts = {}) => request(path, { method: "get" }, opts),
    post: (path, body, opts = {}) => request(path, { method: "post", data: body }, opts),
    patch: (path, body, opts = {}) => request(path, { method: "patch", data: body }, opts),
    delete: (path, opts = {}) => request(path, { method: "delete" }, opts),

    streamUrl: (id) => `${BASE_URL}/stream/video/${id}`,
    subtitleUrl: (encoded) => `${BASE_URL}/stream/subtitle/${encoded}`,
    streamStartUrl: (id) => `${BASE_URL}/stream/start/${id}`,

    /**
     * thumbnailUrl — points an <img> straight at the on-demand ffmpeg
     * frame-extraction route. clientId is required AS A QUERY PARAM
     * (not a header) because <img> tags can't set custom headers.
     */
    thumbnailUrl: (id, time, clientId) => `${BASE_URL}/api/media/${id}/thumbnail?time=${Math.max(0, Math.round(time || 0))}${clientId ? `&clientId=${encodeURIComponent(clientId)}` : ""}`,
};
