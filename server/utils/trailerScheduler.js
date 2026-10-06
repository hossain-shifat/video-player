"use strict";

// Keeps trailers.json fresh without waiting on a frontend request.
// Pattern mirrors hlsCleanup.js / transcoderService.startSweeper() — a
// .unref()'d timer so it never keeps the process alive on its own, plus an
// immediate run at boot so the file exists right away instead of only after
// the first /api/trailers/* hit.

const { rebuildDiscoverTrailers, rebuildLibraryTrailers } = require("../controllers/trailerController");

const INTERVAL_MS = parseInt(process.env.TRAILER_REFRESH_INTERVAL_MS || String(24 * 60 * 60 * 1000), 10); // 24h

let timer = null;

async function runOnce(label) {
    try {
        const [discover, library] = await Promise.all([rebuildDiscoverTrailers(), rebuildLibraryTrailers()]);
        console.log(`[Trailers] ${label} rebuild done — discover=${discover.length} library=${library.length}`);
    } catch (err) {
        console.error(`[Trailers] ${label} rebuild failed:`, err.message);
    }
}

function startTrailerScheduler() {
    // Fire-and-forget — server startup must not block on a TMDB/YouTube walk.
    runOnce("startup");

    timer = setInterval(() => runOnce("scheduled"), INTERVAL_MS);
    timer.unref();
}

function stopTrailerScheduler() {
    if (timer) clearInterval(timer);
    timer = null;
}

module.exports = { startTrailerScheduler, stopTrailerScheduler };
