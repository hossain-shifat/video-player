// web/src/Api/notifications.js
// Thin wrappers over /api/notifications — same `api` facade as every other module.

import { api } from "./client";

const BASE = "/api/notifications";

export function getNotifications({ limit = 30, cursor, unreadOnly = false } = {}) {
    const q = new URLSearchParams({ limit: String(limit) });
    if (cursor) q.set("cursor", cursor);
    if (unreadOnly) q.set("unreadOnly", "true");
    return api.get(`${BASE}?${q}`);
}

export const getNotification = (id) => api.get(`${BASE}/${encodeURIComponent(id)}`);
export const markNotificationRead = (id) => api.patch(`${BASE}/${encodeURIComponent(id)}/read`);
export const markAllNotificationsRead = () => api.post(`${BASE}/read-all`);
export const deleteNotification = (id) => api.delete(`${BASE}/${encodeURIComponent(id)}`);
export const clearNotifications = () => api.delete(BASE);

export const getPushStatus = () => api.get(`${BASE}/status`);

export const getNotificationPreferences = () => api.get(`${BASE}/preferences`);
export const updateNotificationPreferences = (patch) => api.patch(`${BASE}/preferences`, patch);

export const getPushDevices = () => api.get(`${BASE}/devices`);
export const registerPushDevice = (token, deviceName) => api.post(`${BASE}/devices`, { token, deviceName });
export const unregisterPushToken = (token) => api.delete(`${BASE}/devices?token=${encodeURIComponent(token)}`);
export const removePushDevice = (id) => api.delete(`${BASE}/devices/${encodeURIComponent(id)}`);

export const sendTestNotification = () => api.post(`${BASE}/test`);

// Admin only
export const sendAnnouncement = ({ title, body, url, audience = "all" }) => api.post(`${BASE}/announce`, { title, body, url, audience });
export const getAnnouncements = () => api.get(`${BASE}/announcements`);
export const getAnnouncementRoutes = () => api.get(`${BASE}/announcement-routes`);
export const runPushDiagnostics = () => api.post(`${BASE}/diagnostics`);

// "Remind me" on upcoming (unreleased) titles. mediaId looks like "tmdb-movie-123" / "tmdb-tv-456".
export const getReminder = (mediaId) => api.get(`${BASE}/reminders/${encodeURIComponent(mediaId)}`);
export const setReminder = ({ mediaId, title, poster, releaseDate }) => api.post(`${BASE}/reminders`, { mediaId, title, poster, releaseDate });
export const removeReminder = (mediaId) => api.delete(`${BASE}/reminders/${encodeURIComponent(mediaId)}`);
