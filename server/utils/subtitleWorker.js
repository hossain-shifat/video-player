"use strict";

/**
 * subtitleWorker.js — FLUX Background Subtitle Downloader (v2)
 *
 * - Processes subtitle-queue.json entries asynchronously
 * - Saves to data/subtitles/<hash16>/<language>/subtitle.srt
 * - Rate-limit aware: pauses on SubDL 429/403
 * - Uses in-memory queue (sync dequeue — no await needed)
 * - Minimal disk I/O: debounced writes in subtitleStore
 */

const { searchSubtitles, downloadSubtitle } = require("../services/subDLService");
const store = require("./subtitleStore");

const INTERVAL_MS = 6000; // tick every 6s
const REQUEST_DELAY_MS = 1500; // polite gap before each SubDL request
const RATE_LIMIT_PAUSE_MS = 60 * 60 * 1000; // 1h pause on rate limit
const QUOTA_PAUSE_MS = 24 * 60 * 60 * 1000; // 24h pause on quota

let _timer = null;
let _running = false;
let _paused = false;
let _pauseUntil = 0;
let _started = false;

// ─── Core processor ───────────────────────────────────────────────────────────

async function processNext() {
    if (_running) return;
    if (_paused) {
        if (Date.now() < _pauseUntil) return;
        _paused = false;
        console.log("[SubtitleWorker] Rate limit pause expired. Resuming.");
    }

    // sync dequeue — no await, no disk read
    const entry = store.dequeue();
    if (!entry) return;

    _running = true;
    store.markDownloading(entry);

    try {
        console.log(`[SubtitleWorker] → "${entry.title || entry.mediaId.slice(0, 12)}" (${entry.type})`);

        // Determine which langs are still needed using in-memory Set (sync, no disk)
        const needEN = !store.hasDownloadedSubtitle(entry.mediaId, "en");
        const needBN = !store.hasDownloadedSubtitle(entry.mediaId, "bn");

        if (!needEN && !needBN) {
            store.markDone(entry);
            return;
        }

        const langsNeeded = [];
        if (needEN) langsNeeded.push("en");
        if (needBN) langsNeeded.push("bn");

        // Polite delay before API call
        await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));

        // Single search for both langs together
        // Pass spokenLanguage so provider can filter Bangla intelligently
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
                const ms = (search.retryAfter || 3600) * 1000;
                _paused = true;
                _pauseUntil = Date.now() + ms;
                console.warn(`[SubtitleWorker] Rate limited — pausing ${Math.round(ms / 60000)} min`);
                store.markFailed(entry, search.error);
                return;
            }
            if (search.error === "quota_exceeded") {
                _paused = true;
                _pauseUntil = Date.now() + QUOTA_PAUSE_MS;
                console.warn("[SubtitleWorker] Quota exceeded — pausing 24h");
                store.markFailed(entry, search.error);
                return;
            }
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

            // Resolve deterministic path: e.g. data/subtitles/Interstellar_a1b2c3d4/english/
            const langDir = store.getSubtitleLangDir(entry.mediaId, lang, entry);
            // Pass the full match object so SubSource can resolve the download token
            // (match.url = subId, match.linkName + match.ssLang needed for getSub step)
            const subtitleRef = match;
            const result = await downloadSubtitle(subtitleRef, langDir, "subtitle", lang);

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
    return {
        running: _running,
        paused: _paused && Date.now() < _pauseUntil,
        pauseUntil: _paused ? new Date(_pauseUntil).toISOString() : null,
        started: _started,
    };
}

module.exports = { start, stop, getStatus };
