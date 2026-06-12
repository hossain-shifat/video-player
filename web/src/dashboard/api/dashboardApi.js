/**
 * web/src/dashboard/api/dashboardApi.js
 *
 * Admin dashboard API — now uses the shared Axios client.
 * Token injection is automatic via the request interceptor in api/client.js.
 * No need to pass `getToken` into every call.
 */

import { api } from "../../api/client";

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
    revokeSession: (id) => api.delete(`${ADMIN}/sessions/${id}`),
};
