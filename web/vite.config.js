import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), "");
    // Where the FLUX API runs, as seen from the machine running Vite.
    const API_TARGET = env.DEV_API_TARGET || "http://localhost:5000";

    // When FLUX is opened through an HTTPS tunnel (Tailscale Serve / ngrok / Cloudflare),
    // the browser talks only to this dev server, which forwards API calls to Express.
    // Plain-http LAN use keeps working unchanged (the client still uses VITE_API_URL there).
    const forward = { target: API_TARGET, changeOrigin: false, ws: false };

    return {
        plugins: [react(), tailwindcss()],
        server: {
            host: true, // listen on the LAN too (same as passing --host)
            allowedHosts: true, // lets tunnel hostnames (ngrok, *.ts.net, …) through the host check
            proxy: {
                "/api": forward,
                "/stream": forward,
                "/health": forward,
                // "/auth/callback" is a React route (Google sign-in lands there); every other /auth/* is the API.
                "/auth": {
                    ...forward,
                    bypass: (req) => (req.url.startsWith("/auth/callback") ? "/index.html" : undefined),
                },
                // Only API calls go to /admin; a browser page-load of /admin/... stays a React route.
                "/admin": {
                    ...forward,
                    bypass: (req) => (req.headers.accept?.includes("text/html") ? "/index.html" : undefined),
                },
            },
        },
    };
});
