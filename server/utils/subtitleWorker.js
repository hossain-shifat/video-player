"use strict";

/**
 * subtitleWorker.js — FLUX Background Subtitle Downloader (v3)
 *
 * Rate limit handling (SubSource: 60/min · 1800/hr · 7200/day):
 *   - _throttle() in subDLService paces requests to ≤55/min automatically
 *   - If API still returns 429, wait until the current minute window resets (≤65s)
 *     then put the entry back to pending WITHOUT counting it as a failure attempt
 *   - NO 1-hour or 24-hour pauses — the per-minute throttle is sufficient
 *   - daily quota_exceeded → only then pause until midnight UTC
 *
 * Duplicate prevention:
 *   - store.hasDownloadedSubtitle() is sync in-memory check
 *   - Entries already "done" are never dequeued
 *   - On startup, existing files are scanned and marked available
 */

const { searchSubtitles, downloadSubtitle } = require("../services/subDLService");
const store = require("./subtitleStore");

const INTERVAL_MS = 6000; // tick every 6s
const REQUEST_DELAY_MS = 1000; // 1s gap before each API burst

// When we hit a 429, wait until the next minute window resets + small buffer
// Max wait is ~65s — never 1h
const RATE_LIMIT_RETRY_MS = 65_000;

let _timer = null;
let _running = false;
let _retryAfter = 0; // timestamp: don't process until this time (short retry only)
let _started = false;

// ─── Core processor ───────────────────────────────────────────────────────────

async function processNext() {
    if (_running) return;

    // Short retry window after a 429 (≤65s) — not a pause, just a cooldown
    if (_retryAfter && Date.now() < _retryAfter) return;
    if (_retryAfter && Date.now() >= _retryAfter) {
        _retryAfter = 0;
        console.log("[SubtitleWorker] Rate limit cooldown done. Resuming.");
    }

    const entry = store.dequeue(); // sync, in-memory
    if (!entry) return;

    _running = true;
    store.markDownloading(entry);

    try {
        console.log(`[SubtitleWorker] → "${entry.title || entry.mediaId.slice(0, 12)}" (${entry.type})`);

        // Check which langs still needed — sync in-memory, never re-downloads existing
        const needEN = !store.hasDownloadedSubtitle(entry.mediaId, "en");
        const needBN = !store.hasDownloadedSubtitle(entry.mediaId, "bn");

        if (!needEN && !needBN) {
            store.markDone(entry);
            return;
        }

        const langsNeeded = [];
        if (needEN) langsNeeded.push("en");
        if (needBN) langsNeeded.push("bn");

        await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));

        const search = await searchSubtitles({
            title: entry.title,
            year: entry.year,
            imdbId: entry.imdbId,
            tmdbId: entry.tmdbId,
            season: entry.season,
            episode: entry.episode,
            type: entry.type === "movie" ? "movie" : "tv",
            languages: langsNeeded,
            spokenLanguage: entry.spokenLanguage || null,
        });

        if (!search.ok) {
            if (search.error === "rate_limit") {
                // 429 hit despite throttle — wait 65s for minute window to reset
                // Use requeueEntry so attempt counter is NOT burned
                _retryAfter = Date.now() + RATE_LIMIT_RETRY_MS;
                store.requeueEntry(entry);
                console.warn(`[SubtitleWorker] 429 received — cooling down ${Math.round(RATE_LIMIT_RETRY_MS / 1000)}s, entry re-queued`);
                return;
            }
            if (search.error === "quota_exceeded") {
                // Daily quota — pause until midnight UTC, re-queue without burning attempt
                const now = new Date();
                const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
                _retryAfter = midnight.getTime();
                store.requeueEntry(entry);
                console.warn(`[SubtitleWorker] Daily quota exceeded — resuming at midnight UTC (${midnight.toISOString()})`);
                return;
            }
            // Other errors (network, no API key, etc.) — count as attempt
            console.warn(`[SubtitleWorker] Search failed "${entry.title}": ${search.error}`);
            store.markFailed(entry, search.error);
            return;
        }

        if (!search.results?.length) {
            console.log(`[SubtitleWorker] No results for "${entry.title}"`);
            store.markSkipped(entry, "no_results");
            return;
        }

        let anyDownloaded = false;

        for (const lang of langsNeeded) {
            const match = search.results.find((r) => r.lang === lang);
            if (!match) continue;

            // Guard: double-check not already downloaded (race condition safety)
            if (store.hasDownloadedSubtitle(entry.mediaId, lang)) {
                console.log(`[SubtitleWorker] ${lang} already exists for "${entry.title}" — skipping`);
                anyDownloaded = true;
                continue;
            }

            const langDir = store.getSubtitleLangDir(entry.mediaId, lang, entry);
            const result = await downloadSubtitle(match, langDir, "subtitle", lang);

            if (!result.ok) {
                console.warn(`[SubtitleWorker] Download failed (${lang}) "${entry.title}": ${result.error}`);
                continue;
            }

            await store.recordDownloaded(entry.mediaId, {
                lang,
                filename: result.filename,
                destPath: result.destPath,
            });

            console.log(`[SubtitleWorker] ✓ ${lang.toUpperCase()} "${entry.title}" → ${result.filename}`);
            anyDownloaded = true;
        }

        if (anyDownloaded) store.markDone(entry);
        else store.markFailed(entry, "all_downloads_failed");
    } catch (err) {
        console.error(`[SubtitleWorker] Error "${entry.title}":`, err.message);
        store.markFailed(entry, err.message);
    } finally {
        _running = false;
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

function start() {
    if (_started) return;
    _started = true;
    _timer = setInterval(() => {
        processNext().catch((e) => console.error("[SubtitleWorker] Tick error:", e.message));
    }, INTERVAL_MS);
    if (_timer.unref) _timer.unref(); // don't block process exit
    console.log("[SubtitleWorker] Started (interval=" + INTERVAL_MS + "ms)");
}

function stop() {
    if (_timer) {
        clearInterval(_timer);
        _timer = null;
    }
    _started = false;
    console.log("[SubtitleWorker] Stopped.");
}

function getStatus() {
    const cooling = _retryAfter > 0 && Date.now() < _retryAfter;
    return {
        running: _running,
        paused: cooling,
        pauseUntil: cooling ? new Date(_retryAfter).toISOString() : null,
        started: _started,
    };
}

module.exports = { start, stop, getStatus };
