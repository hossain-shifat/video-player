/**
 * web/src/dashboard/api/storageApi.js
 *
 * Storage Provider System — frontend API client.
 * Same shared Axios client + token injection pattern as dashboardApi.js.
 */

import { api } from "../../api/client";

const STORAGE = "/api/storage";

export const storageApi = {
    providers: () => api.get(`${STORAGE}/providers`),
    connectGoFile: (apiToken) => api.post(`${STORAGE}/providers/gofile/connect`, { apiToken }),
    configureGoogleDrive: (clientId, clientSecret, redirectUri) =>
        api.post(`${STORAGE}/providers/gdrive/configure`, { clientId, clientSecret, redirectUri }),
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
};
