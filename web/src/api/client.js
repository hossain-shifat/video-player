// Base API client — all requests go through here.
// Set VITE_API_URL in web/.env to point at your server, e.g.:
//   VITE_API_URL=http://192.168.1.100:5000

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

/**
 * Core fetch wrapper.
 * - Prepends BASE_URL to every path
 * - Throws a structured error on non-2xx responses
 * - Returns parsed JSON
 *
 * `extraOptions` can carry { headers } for per-request header overrides.
 */
async function request(path, fetchOptions = {}, extraOptions = {}) {
    const url = `${BASE_URL}${path}`;
    const res = await fetch(url, {
        headers: {
            "Content-Type": "application/json",
            ...(extraOptions.headers || {}),
            ...(fetchOptions.headers || {}),
        },
        ...fetchOptions,
    });

    if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
            const body = await res.json();
            message = body.error || message;
        } catch {
            // ignore parse errors
        }
        const err = new Error(message);
        err.status = res.status;
        throw err;
    }

    // 204 No Content — return null
    if (res.status === 204) return null;
    return res.json();
}

export const api = {
    /** GET — optional `{ headers }` in second arg */
    get: (path, opts = {}) => request(path, {}, opts),

    /** POST — optional `{ headers }` in third arg */
    post: (path, body, opts = {}) => request(path, { method: "POST", body: JSON.stringify(body) }, opts),

    /** PATCH — optional `{ headers }` in third arg */
    patch: (path, body, opts = {}) => request(path, { method: "PATCH", body: JSON.stringify(body) }, opts),

    /** DELETE — optional `{ headers }` in second arg */
    delete: (path, opts = {}) => request(path, { method: "DELETE" }, opts),

    /** Helpers for stream/subtitle URLs */
    streamUrl: (id) => `${BASE_URL}/stream/video/${id}`,
    subtitleUrl: (encoded) => `${BASE_URL}/stream/subtitle/${encoded}`,
};
