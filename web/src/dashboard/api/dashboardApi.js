/**
 * web/src/dashboard/api/dashboardApi.js
 *
 * Admin dashboard API — now uses the shared Axios client.
 * Token injection is automatic via the request interceptor in api/client.js.
 * No need to pass `getToken` into every call.
 */

import { api } from "../Shared";

const ADMIN = "/api/admin-dashboard";

export const dashApi = {
    stats: () => api.get(`${ADMIN}/stats`),
    activity: () => api.get(`${ADMIN}/activity`),
    health: () => api.get(`${ADMIN}/health`),
    streams: () => api.get(`${ADMIN}/streams`),
    stopStream: (id) => api.delete(`${ADMIN}/streams/${id}`),
    jobs: () => api.get(`${ADMIN}/jobs`),
    logs: (params = {}) => {
        const q = new URLSearchParams(params).toString();
        return api.get(`${ADMIN}/logs${q ? `?${q}` : ""}`);
    },
    libraries: () => api.get(`${ADMIN}/libraries`),
    users: (params = {}) => {
        const q = new URLSearchParams(params).toString();
        return api.get(`${ADMIN}/users${q ? `?${q}` : ""}`);
    },
    updateUser: (id, data) => api.patch(`${ADMIN}/users/${id}`, data),
    deleteUser: (id) => api.delete(`${ADMIN}/users/${id}`),
    userSessions: (id) => api.get(`${ADMIN}/users/${id}/sessions`),
};

// ─── Subtitles (admin): /api/subtitle/admin ──────────────────────────────────
const SUBS = "/api/subtitle/admin";
const qs = (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v != null)).toString();
    return q ? `?${q}` : "";
};

export const subtitleApi = {
    overview: () => api.get(`${SUBS}/overview`),
    list: (params = {}) => api.get(`${SUBS}/list${qs(params)}`),
    preview: (mediaId, lang, params = {}) => api.get(`${SUBS}/preview/${encodeURIComponent(mediaId)}/${encodeURIComponent(lang)}${qs(params)}`),
    details: (mediaId, lang) => api.get(`${SUBS}/details/${encodeURIComponent(mediaId)}/${encodeURIComponent(lang)}`),
    file: (mediaId, lang) => api.get(`${SUBS}/file/${encodeURIComponent(mediaId)}/${encodeURIComponent(lang)}`, { responseType: "blob" }),
    action: (action, items, params = {}) => api.post(`${SUBS}/action`, { action, items, params }),
    purgeRejected: () => api.post(`${SUBS}/purge-rejected`),
    missing: (params = {}) => api.get(`${SUBS}/missing${qs(params)}`),
    retryMissing: (body) => api.post(`${SUBS}/missing/retry`, body),
};
