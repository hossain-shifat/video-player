// Base API client — all requests go through here
// Set VITE_API_URL in web/.env to point at your server, e.g.:
//   VITE_API_URL=http://192.168.1.100:5000

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

/**
 * Core fetch wrapper.
 * - Prepends BASE_URL to every path
 * - Throws a structured error on non-2xx responses
 * - Returns parsed JSON
 */
async function request(path, options = {}) {
    const url = `${BASE_URL}${path}`;
    const res = await fetch(url, {
        headers: { "Content-Type": "application/json", ...options.headers },
        ...options,
    });

    if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
            const body = await res.json();
            message = body.error || message;
        } catch {}
        const err = new Error(message);
        err.status = res.status;
        throw err;
    }

    // 204 No Content — return null
    if (res.status === 204) return null;
    return res.json();
}

export const api = {
    get: (path) => request(path),
    post: (path, body) => request(path, { method: "POST", body: JSON.stringify(body) }),
    patch: (path, body) => request(path, { method: "PATCH", body: JSON.stringify(body) }),
    delete: (path) => request(path, { method: "DELETE" }),
    streamUrl: (id) => `${BASE_URL}/stream/video/${id}`,
    subtitleUrl: (encoded) => `${BASE_URL}/stream/subtitle/${encoded}`,
};
