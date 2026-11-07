"use strict";

// Keeps trailers.json fresh without waiting on a frontend request.
// Pattern mirrors hlsCleanup.js / transcoderService.startSweeper() — .unref()'d
// timers so they never keep the process alive on their own.
//
// EVERY 3 DAYS (was every 24h). The schedule follows the AGE OF THE SAVED LIST,
// not the server's uptime: on boot the scheduler reads when trailers.json was
// last built and waits only for the time that is left. So a server that restarts
// every day still rebuilds every 3 days, and a server that was off for a week
// rebuilds immediately on boot.
//
// Override with TRAILER_REFRESH_INTERVAL_MS (also used as the cache TTL in
// trailerController.js via TRAILER_DISCOVER_TTL_MS — keep the two equal).

const { rebuildDiscoverTrailers, rebuildLibraryTrailers } = require("../../controllers/trailers/trailerController");
const trailerStore = require("./trailerStore");

const MAX_TIMER_MS = 2147483647; // setTimeout/setInterval ceiling (~24.8 days)
const INTERVAL_MS = Math.min(parseInt(process.env.TRAILER_REFRESH_INTERVAL_MS || String(3 * 24 * 60 * 60 * 1000), 10), MAX_TIMER_MS);

let firstTimer = null;
let timer = null;

async function runOnce(label) {
    try {
        const [discover, library] = await Promise.all([rebuildDiscoverTrailers(), rebuildLibraryTrailers()]);
        console.log(`[Trailers] ${label} rebuild done — discover=${discover.length} library=${library.length}`);
    } catch (err) {
        console.error(`[Trailers] ${label} rebuild failed:`, err.message);
    }
}

function startRepeating() {
    timer = setInterval(() => runOnce("scheduled"), INTERVAL_MS);
    timer.unref();
}

async function plan() {
    // How long until the saved discover list is INTERVAL_MS old? (null cache = missing or already stale → now)
    let wait = 0;
    try {
        const cached = await trailerStore.getDiscoverCache(INTERVAL_MS);
        if (cached) wait = Math.max(INTERVAL_MS - (Date.now() - new Date(cached.generatedAt).getTime()), 0);
    } catch (err) {
        console.warn("[Trailers] could not read cache age, rebuilding now:", err.message);
    }

    if (wait === 0) {
        console.log("[Trailers] saved list is missing or older than the interval — rebuilding now");
        await runOnce("startup");
        startRepeating();
        return;
    }

    console.log(`[Trailers] saved list is fresh — next rebuild in ${(wait / 3600000).toFixed(1)}h`);
    firstTimer = setTimeout(
        async () => {
            firstTimer = null;
            await runOnce("scheduled");
            startRepeating();
        },
        Math.min(wait, MAX_TIMER_MS),
    );
    firstTimer.unref();
}

function startTrailerScheduler() {
    // Fire-and-forget — server startup must not block on a TMDB/YouTube walk, and
    // this must never throw (server.js wraps it in safeStart, which is sync).
    plan().catch((err) => console.error("[Trailers] scheduler failed to start:", err.message));
}

function stopTrailerScheduler() {
    if (firstTimer) clearTimeout(firstTimer);
    if (timer) clearInterval(timer);
    firstTimer = null;
    timer = null;
}

module.exports = { startTrailerScheduler, stopTrailerScheduler };
