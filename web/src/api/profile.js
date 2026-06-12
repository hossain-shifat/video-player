// web/src/api/profile.js
// Profile CRUD — now uses the shared api client (Axios).
// ImgBB avatar upload remains as native fetch (multipart form data).

import { api } from "./client";

const IMGBB_API_KEY = import.meta.env.VITE_IMGBB_API_KEY || "";

export const profileApi = {
    /** Get all profiles for current user */
    list: () => api.get("/api/profile"),

    /** Create a new profile */
    create: (data) => api.post("/api/profile", data),

    /** Update a profile */
    update: (id, data) => api.patch(`/api/profile/${id}`, data),

    /** Delete a profile */
    delete: (id) => api.delete(`/api/profile/${id}`),

    /**
     * Upload image to ImgBB and return the URL.
     * Uses native fetch because axios multipart handling is more complex
     * and ImgBB is an external service that doesn't need our auth interceptors.
     *
     * @param {File} file - image file from input
     * @returns {Promise<string>} direct image URL
     */
    uploadAvatar: async (file) => {
        if (!IMGBB_API_KEY) {
            throw new Error("ImgBB API key not configured (VITE_IMGBB_API_KEY)");
        }

        const formData = new FormData();
        formData.append("image", file);

        const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
            method: "POST",
            body: formData,
        });

        if (!res.ok) {
            throw new Error("Image upload failed");
        }

        const data = await res.json();
        if (!data.success) {
            throw new Error(data.error?.message || "Image upload failed");
        }

        return data.data.display_url; // direct image URL
    },
};
