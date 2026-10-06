/**
 * web/src/dashboard/api/storageApi.js
 *
 * Storage Provider System — frontend API client.
 * Same shared Axios client + token injection pattern as dashboardApi.js.
 */

import { api, getAuthToken } from "../../api/client";

const STORAGE = "/api/storage";
const BASE = import.meta.env.VITE_API_URL || "http://localhost:5000";

export const storageApi = {
    providers: () => api.get(`${STORAGE}/providers`),
    connectGoFile: (apiToken) => api.post(`${STORAGE}/providers/gofile/connect`, { apiToken }),
    getGoogleDriveAuthUrl: () => api.get(`${STORAGE}/providers/gdrive/auth-url`),
    disconnectProvider: (type) => api.delete(`${STORAGE}/providers/${type}`),
    browse: (type, folderRef) => {
        const q = folderRef ? `?folderRef=${encodeURIComponent(folderRef)}` : "";
        return api.get(`${STORAGE}/providers/${type}/browse${q}`);
    },
    cloudLibraries: () => api.get(`${STORAGE}/libraries`),
    importLibrary: (provider, ref, label) => api.post(`${STORAGE}/libraries`, { provider, ref, label }),
    removeLibrary: (id) => api.delete(`${STORAGE}/libraries/${id}`),
    uploadHistory: () => api.get(`${STORAGE}/uploads`),
    deleteUpload: (id) => api.delete(`${STORAGE}/uploads/${id}`),
    uploadProgress: (sessionId) => api.get(`${STORAGE}/upload-progress/${sessionId}`),
    cancelUpload: (sessionId) => api.post(`${STORAGE}/upload/${sessionId}/cancel`),

    // Chunked upload (pause/resume). Raw fetch, not the shared axios instance —
    // axios's default Content-Type: application/json header can fight with the
    // multipart boundary a FormData body needs; sidestepping that entirely.
    uploadChunk: async (formData, signal) => {
        const token = getAuthToken();
        const res = await fetch(`${BASE}${STORAGE}/upload-chunk`, {
            method: "POST",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: formData,
            signal,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            const err = new Error(data.error || `HTTP ${res.status}`);
            err.status = res.status;
            throw err;
        }
        return data;
    },
    chunkStatus: (sessionId) => api.get(`${STORAGE}/upload-chunk/${sessionId}/status`),
    retryStage2: (sessionId) => api.post(`${STORAGE}/upload/${sessionId}/retry-stage2`),

    // Live "All Uploads" — fetched directly from the cloud provider each time,
    // not from a local record of past uploads.
    cloudFiles: () => api.get(`${STORAGE}/cloud-files`),
    deleteCloudFile: (provider, ref) => api.delete(`${STORAGE}/cloud-files?provider=${encodeURIComponent(provider)}&ref=${encodeURIComponent(ref)}`),
    createCloudFolder: (provider, parentRef, name) => api.post(`${STORAGE}/cloud-folders`, { provider, parentRef, name }),

    // Cloud tab in DashLibraries — scan-derived stats + parsed media per library.
    librariesSummary: () => api.get(`${STORAGE}/libraries-summary`),
    libraryMedia: (id) => api.get(`${STORAGE}/libraries/${id}/media`),
};
