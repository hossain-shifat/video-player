// web/src/Hooks/Auth/useShowcasePosters.js
// Random, recent movie / series / anime posters for the poster wall on the auth screens.
//   1. GET /auth/showcase — the server builds a cached pool from TMDB (restricted content excluded).
//   2. If that comes back empty or fails (e.g. the server cannot reach TMDB), the browser asks TMDB itself with the
//      app's VITE_TMDB_API_KEY (the same one the Banner uses) — cached in localStorage for 6 h.
//   3. Still nothing → status "empty" and the wall uses abstract tiles. The sign-in pages never depend on any of this.
// Fetched once per page load (module cache). The console shows one line saying which source won, or why none did.

import { useEffect, useState } from "react";
import { API_BASE_URL } from "../../Api/client";
import { fetchRecentPosters, samplePosters } from "../../Components/Auth/tmdbShowcase";

const CACHE_KEY = "flux-wall-pool-v1";
const CACHE_TTL = 6 * 60 * 60 * 1000;
let inflight = null;

async function fromServer() {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000); // the very first request may wait while the server builds its pool
    try {
        // plain fetch on purpose: no Authorization header (an unverified token would be refused elsewhere, and none is needed here)
        const res = await fetch(`${API_BASE_URL}/auth/showcase?n=32`, { signal: ctrl.signal });
        if (!res.ok) return { posters: [], reason: `http_${res.status}` };
        const body = await res.json();
        const posters = Array.isArray(body?.posters) ? body.posters.filter((p) => typeof p?.poster === "string") : [];
        return { posters, reason: body?.reason || null };
    } catch (err) {
        return { posters: [], reason: err?.name === "AbortError" ? "server_timeout" : "server_unreachable" };
    } finally {
        clearTimeout(timer);
    }
}

async function fromBrowser() {
    const key = import.meta.env.VITE_TMDB_API_KEY;
    if (!key) return { posters: [], reason: "no_VITE_TMDB_API_KEY" };
    try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
        if (cached && Date.now() - cached.at < CACHE_TTL && cached.pool?.length) return { posters: samplePosters(cached.pool), reason: null };
    } catch {
        /* storage unavailable — fetch fresh */
    }
    const pool = await fetchRecentPosters({ key }).catch(() => []);
    if (pool.length) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), pool }));
        } catch {
            /* ignore */
        }
    }
    return { posters: samplePosters(pool), reason: pool.length ? null : "tmdb_unreachable_from_browser" };
}

function load() {
    if (inflight) return inflight;
    inflight = (async () => {
        const server = await fromServer();
        if (server.posters.length) {
            console.info(`[FLUX] poster wall: ${server.posters.length} recent posters from the server`);
            return server.posters;
        }
        const browser = await fromBrowser();
        if (browser.posters.length) {
            console.info(`[FLUX] poster wall: ${browser.posters.length} recent posters straight from TMDB (server said: ${server.reason || "nothing"})`);
            return browser.posters;
        }
        console.info(`[FLUX] poster wall: abstract tiles — server: ${server.reason || "empty"}; browser: ${browser.reason}`);
        return [];
    })();
    return inflight;
}

export function useShowcasePosters() {
    const [state, setState] = useState({ status: "loading", posters: [] });
    useEffect(() => {
        let alive = true;
        load().then((posters) => alive && setState({ status: posters.length >= 1 ? "ready" : "empty", posters }));
        return () => {
            alive = false;
        };
    }, []);
    return state;
}
