"use strict";

const { readFolders } = require("./libraryController");
const { getAllCached, findById } = require("../../utils/media/mediaCache");
const { getMetadata, invalidate, invalidateAll, getCachedSeason, setCachedSeason, getCachedFeed, setCachedFeed } = require("../../metadata/metadataStore");
const { parseFilename } = require("../../metadata/nameParser");
const { getSeasonDetails, tmdbFetch } = require("../../metadata/tmdb");
const { getMediaInfo: _getMediaInfoRaw, invalidate: invalidateMediaInfo } = require("../../utils/media/mediaInfoStore");

// ── NEW: mediaInfo (ffprobe) failure must never take down metadata ─────────
// getOne()/refreshOne() below await getMetadata() and getMediaInfo() together
// in Promise.all. If ffprobe is missing/misconfigured, or a file is
// unreadable, _getMediaInfoRaw() can reject — and Promise.all fails the
// WHOLE request on that one rejection, even though TMDB metadata had
// already succeeded. That's the "metadata not loaded" symptom. This wraps
// the raw import so a probe failure degrades to mediaInfo: null instead of
// failing the endpoint. mediaInfoStore.js itself is untouched.
async function getMediaInfo(file) {
    try {
        return await _getMediaInfoRaw(file);
    } catch (err) {
        console.error(`[MediaInfo] probe failed for "${file.name}", continuing without it:`, err.message);
        return null;
    }
}

// GET /api/metadata/:id — returns metadata + mediaInfo for one file, fetching TMDB/ffprobe if needed
async function getOne(req, res) {
    try {
        const folders = await readFolders();
        const file = await findById(folders, req.params.id);
        if (!file) return res.status(404).json({ error: "Media not found" });

        const [metadata, mediaInfo] = await Promise.all([getMetadata(file), getMediaInfo(file)]);

        return res.json({ id: file.id, name: file.name, metadata, mediaInfo });
    } catch (err) {
        console.error("[Metadata] getOne error:", err);
        return res.status(500).json({ error: "Failed to get metadata" });
    }
}

// POST /api/metadata/refresh/:id — clears cache for one file and re-fetches TMDB + ffprobe
async function refreshOne(req, res) {
    try {
        const folders = await readFolders();
        const file = await findById(folders, req.params.id);
        if (!file) return res.status(404).json({ error: "Media not found" });

        invalidate(file.id);
        invalidateMediaInfo(file.id);

        const [metadata, mediaInfo] = await Promise.all([getMetadata(file), getMediaInfo(file)]);

        return res.json({ id: file.id, name: file.name, metadata, mediaInfo });
    } catch (err) {
        console.error("[Metadata] refreshOne error:", err);
        return res.status(500).json({ error: "Failed to refresh metadata" });
    }
}

// POST /api/metadata/refresh-all — clears entire cache and re-fetches all (slow, use sparingly)
async function refreshAll(req, res) {
    try {
        invalidateAll();
        return res.json({ message: "Metadata cache cleared. Entries will be re-fetched on next request." });
    } catch (err) {
        console.error("[Metadata] refreshAll error:", err);
        return res.status(500).json({ error: "Failed to clear metadata cache" });
    }
}

// GET /api/metadata/parse?filename=xxx — debug helper: shows how a filename would be parsed
async function parseDebug(req, res) {
    const { filename } = req.query;
    if (!filename) return res.status(400).json({ error: "filename query param required" });
    return res.json(parseFilename(filename));
}

// GET /api/media/enriched — returns full media list with metadata attached (may be slow first time)
// NOTE: mediaInfo intentionally NOT attached here — running ffprobe over an
// entire library on one request would be extremely slow. mediaInfo is fetched
// lazily per-file via getOne() above (same lazy pattern as TMDB metadata).
async function getAllEnriched(req, res) {
    try {
        const folders = await readFolders();
        const { allMedia } = await getAllCached(folders);

        // Enrich each file — cache hits are instant, misses call TMDB
        const enriched = await Promise.all(
            allMedia.map(async (file) => {
                const metadata = await getMetadata(file);
                return { ...file, metadata };
            }),
        );

        return res.json({ total: enriched.length, media: enriched });
    } catch (err) {
        console.error("[Metadata] getAllEnriched error:", err);
        return res.status(500).json({ error: "Failed to get enriched media" });
    }
}

// ── NEW (metadata upgrade plan, feature 10 — lazy season details) ──────────
// GET /api/metadata/tv/:tmdbId/season/:seasonNumber
//
// grouper.js already eagerly fetches + persistently caches EVERY season for
// every series/anime group at scan time (getCachedSeason/setCachedSeason) —
// that is a standing constraint (grouper.js is never modified) and is left
// exactly as-is. This endpoint exists ALONGSIDE that, for the frontend to
// explicitly (re)request one season's detail on demand — e.g. a season TMDB
// didn't have data for yet, or to refresh a single season without a full
// library refresh-all. It reuses the exact same 7-day persistent season
// cache grouper.js already writes to, so the two never fight or duplicate
// TMDB calls for the same tmdbId+season.
// A season is only usable when TMDB gave it a real number AND at least one episode.
function _isValidSeason(season) {
    return Boolean(season) && Number.isInteger(season.seasonNumber) && Array.isArray(season.episodes) && season.episodes.length > 0;
}

async function getSeasonLazy(req, res) {
    try {
        const tmdbId = parseInt(req.params.tmdbId, 10);
        const seasonNumber = parseInt(req.params.seasonNumber, 10);

        if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
            return res.status(400).json({ error: "Invalid tmdbId" });
        }
        if (!Number.isInteger(seasonNumber) || seasonNumber < 0) {
            return res.status(400).json({ error: "Invalid season number" });
        }

        // ?refresh=true bypasses the persistent season cache (manual Refresh button).
        const forceRefresh = req.query.refresh === "true";

        let season = forceRefresh ? null : await getCachedSeason(tmdbId, seasonNumber);
        // A cached entry that is empty/invalid is not trusted — refetch it.
        if (!_isValidSeason(season)) {
            season = await getSeasonDetails(tmdbId, seasonNumber);
            // Only persist real seasons — never cache an empty/placeholder one.
            if (_isValidSeason(season)) await setCachedSeason(tmdbId, seasonNumber, season);
        }

        if (!_isValidSeason(season)) return res.status(404).json({ error: "Season not found" });
        return res.json({ season });
    } catch (err) {
        console.error("[Metadata] getSeasonLazy error:", err);
        return res.status(500).json({ error: "Failed to get season details" });
    }
}

// GET /api/metadata/tmdb/:kind/:tmdbId — server-side TMDB proxy for titles NOT in the
// library (MediaDetails "tmdb-movie-123" / "tmdb-tv-456" ids). Uses the server's
// tmdbFetch so the TMDB credential never reaches the browser bundle or network tab.
async function getTmdbItem(req, res) {
    try {
        const { kind } = req.params;
        const tmdbId = parseInt(req.params.tmdbId, 10);

        if (kind !== "movie" && kind !== "tv") return res.status(400).json({ error: "Invalid kind" });
        if (!Number.isInteger(tmdbId) || tmdbId <= 0) return res.status(400).json({ error: "Invalid tmdbId" });

        const data = await tmdbFetch(`/${kind}/${tmdbId}`, { append_to_response: "credits,videos,external_ids" });
        if (!data) return res.status(404).json({ error: "Media not found" });
        return res.json(data);
    } catch (err) {
        console.error("[Metadata] getTmdbItem error:", err.message);
        return res.status(404).json({ error: "Media not found" });
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// COMMUNITY FEEDS — "Popular Reviews" + "Popular Discussions" rows on Home
// ═════════════════════════════════════════════════════════════════════════════
// GET /api/media/popular-reviews      GET /api/media/popular-discussions   (routes in media.js)
//
// Built from YOUR library only (top titles by vote count), cached inside metadata.json under
// "_feed:popularReviewsV2" / "_feed:popularDiscussionsV2", rebuilt every 3 days in the background.
// A request never waits for a rebuild: it returns the cached list (or an empty one + building:true on
// the very first run) and the frontend simply hides the row until there is something to show.
//
//   Popular Reviews     The TMDB reviews stored in metadata (up to COMMUNITY_REVIEWS_PER_TITLE per title are read,
//                       the best one per title is shown). With TRAKT_CLIENT_ID set, Trakt "review" comments (real
//                       like / reply counts) go first and TMDB fills the rest.
//   Popular Discussions With TRAKT_CLIENT_ID: Trakt comments that started a conversation (replies / likes).
//                       TMDB has no discussions, so whatever is missing — or EVERYTHING when there is no key — is filled
//                       with the next-best TMDB review of each title, shown as a discussion card (headline = first
//                       sentence). Those cards carry no like / reply counts. The row is therefore never empty.
//                       Free Trakt key: https://trakt.tv/oauth/applications → create app → "Client ID".
//
// Tunables (all optional env): COMMUNITY_FEED_TTL_MS (3 days), COMMUNITY_FEED_TITLES (120),
//                              COMMUNITY_FEED_MAX_ITEMS (30), COMMUNITY_REVIEWS_PER_TITLE (12), TRAKT_CLIENT_ID
// "V2": feeds saved by the first version (empty discussions, 24 items) are ignored, so the new lists build right away.
// Bump the suffix whenever the shape/rules of a feed change.
const FEED_REVIEWS = "popularReviewsV2";
const FEED_DISCUSSIONS = "popularDiscussionsV2";
const FEED_TTL_MS = parseInt(process.env.COMMUNITY_FEED_TTL_MS || String(3 * 24 * 60 * 60 * 1000), 10);
const FEED_TITLES = parseInt(process.env.COMMUNITY_FEED_TITLES || "120", 10);
const FEED_MAX_ITEMS = parseInt(process.env.COMMUNITY_FEED_MAX_ITEMS || "30", 10);
const FEED_REVIEWS_PER_TITLE = parseInt(process.env.COMMUNITY_REVIEWS_PER_TITLE || "12", 10); // stored review ids read per title (they are fetched one by one from TMDB)
const TRAKT_CLIENT_ID = process.env.TRAKT_CLIENT_ID || null;
const FEED_RETRY_MS = 30 * 60 * 1000; // a failed/stale rebuild is retried at most this often when requests come in
const MAX_TIMER_MS = 2147483647;

const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function _mapLimit(list, limit, fn) {
    const out = new Array(list.length);
    let next = 0;
    await Promise.all(
        Array.from({ length: Math.min(limit, list.length) }, async () => {
            while (next < list.length) {
                const i = next++;
                out[i] = await fn(list[i], i);
            }
        }),
    );
    return out;
}

// Same rule the Banner.jsx hero uses (isMature): titles the restricted-content setting hides never appear in a
// GLOBAL feed. (The feed is shared by every account, so it is filtered once, conservatively.)
const _BLOCKED_CERTS = new Set(["R", "NC-17", "NC17", "X", "XXX", "TV-MA", "18", "18+", "18A", "R18", "R18+", "R-18", "AO"]);
function _isMatureMeta(m) {
    if (!m) return false;
    if (m.adult === true) return true;
    const norm = (x) =>
        String(x?.certification ?? x ?? "")
            .trim()
            .toUpperCase()
            .replace(/^RATED\s+/, "");
    if (m.certifications && typeof m.certifications === "object" && !Array.isArray(m.certifications)) {
        const us = (m.certifications.US || []).map(norm).filter((c) => c && c !== "NR" && c !== "UR" && c !== "NOT RATED");
        const pool = us.length ? us : Object.values(m.certifications).flat().map(norm).filter(Boolean);
        if (pool.some((c) => _BLOCKED_CERTS.has(c))) return true;
    }
    return [m.certification, m.contentRating, m.mpaa, m.mpaaRating, m.rated, m.ageRating, m.maturityRating].some(
        (v) => v != null && _BLOCKED_CERTS.has(norm(typeof v === "object" ? v.certification || v.rating : v)),
    );
}

function _cleanText(t) {
    return String(t || "")
        .replace(/\r/g, "")
        .replace(/<[^>]+>/g, "")
        .replace(/[*_#>`]+/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, 1500);
}

// Discussion cards need a headline — comments have none, so use the first sentence (or the first ~80 chars).
function _headlineOf(text) {
    const flat = text.replace(/\s+/g, " ").trim();
    const m = flat.match(/^(.{15,90}?[.!?])(\s|$)/);
    if (m) return { title: m[1].replace(/\.$/, ""), body: flat.slice(m[0].length).trim() || flat };
    if (flat.length <= 90) return { title: flat, body: flat };
    return { title: `${flat.slice(0, 80).replace(/\s+\S*$/, "")}…`, body: flat };
}

// Top library titles (one per tmdb title — series/anime files collapse), most-voted first.
async function _feedCandidates() {
    const folders = await readFolders();
    const { allMedia } = await getAllCached(folders);
    const seen = new Map();
    for (const file of allMedia) {
        const m = await getMetadata(file);
        if (!m || !m.tmdbId || _isMatureMeta(m)) continue;
        const kind = m.type === "movie" ? "movie" : "tv";
        const key = `${kind}:${m.tmdbId}`;
        if (seen.has(key)) continue;
        seen.set(key, { key, fileId: file.id, kind, tmdbId: m.tmdbId, imdbId: m.imdbId || m.externalIds?.imdb || null, m });
    }
    return [...seen.values()].sort((a, b) => (Number(b.m.votes) || 0) - (Number(a.m.votes) || 0) || (Number(b.m.rating) || 0) - (Number(a.m.rating) || 0)).slice(0, FEED_TITLES);
}

const _media = (c) => ({ id: c.fileId, title: c.m.title, backdrop: c.m.backdrop || null, poster: c.m.poster || null, logo: null, type: c.m.type });

// ── TMDB reviews (ids are already in metadata) ───────────────────────────────
// For every candidate title: read up to FEED_REVIEWS_PER_TITLE stored review ids, drop the short ones, rank the
// rest. ranked[0] = best review (→ Popular Reviews), ranked[1] = next best (→ Popular Discussions fallback).
async function _tmdbReviewPool(cands) {
    const perTitle = [];
    await _mapLimit(cands, 4, async (c) => {
        const ids = (c.m.reviews || []).slice(0, FEED_REVIEWS_PER_TITLE);
        const got = await _mapLimit(ids, 3, async (id) => {
            try {
                return await tmdbFetch(`/review/${id}`);
            } catch {
                return null;
            }
        });
        const ranked = [];
        for (const r of got) {
            const text = _cleanText(r?.content);
            if (!r || text.length < 140) continue;
            const rating = typeof r.author_details?.rating === "number" ? r.author_details.rating : null;
            const ageYears = r.created_at ? (Date.now() - Date.parse(r.created_at)) / (365 * 86400000) : 5;
            ranked.push({ r, text, rating, score: (rating ?? 6) + Math.min(text.length, 900) / 300 + Math.max(0, 2 - ageYears) });
        }
        ranked.sort((a, b) => b.score - a.score);
        if (ranked.length) perTitle.push({ c, ranked });
    });
    return perTitle;
}

function _tmdbItem(c, x) {
    const p = x.r.author_details?.avatar_path;
    return {
        score: x.score,
        source: "tmdb",
        _key: c.key,
        id: `tmdb-${x.r.id}`,
        author: x.r.author_details?.name || x.r.author || "TMDB user",
        avatar: p ? (p.startsWith("/http") ? p.slice(1) : `https://image.tmdb.org/t/p/w185${p}`) : null,
        rating: x.rating,
        content: x.text,
        createdAt: x.r.created_at || null,
        likes: null,
        comments: null,
        media: _media(c),
    };
}

// review item → discussion item (headline + excerpt instead of the quote)
function _asDiscussion(item) {
    const { content, ...rest } = item;
    const h = _headlineOf(content);
    return { ...rest, title: h.title, body: h.body };
}

// ── Trakt comments ───────────────────────────────────────────────────────────
async function _traktComments(c) {
    if (!c.imdbId) return [];
    const res = await fetch(`https://api.trakt.tv/${c.kind === "movie" ? "movies" : "shows"}/${c.imdbId}/comments/likes?limit=8`, {
        headers: { "Content-Type": "application/json", "trakt-api-version": "2", "trakt-api-key": TRAKT_CLIENT_ID },
        signal: AbortSignal.timeout(15000),
    });
    if (res.status === 429) {
        const wait = Math.min(parseInt(res.headers.get("retry-after") || "10", 10), 60);
        await _sleep(wait * 1000);
        return null; // signal "rate limited" to the caller
    }
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
}

async function _traktItems(cands) {
    const reviews = [];
    const discussions = [];
    let limited = 0;
    for (const c of cands) {
        let list;
        try {
            list = await _traktComments(c);
        } catch (err) {
            console.warn(`[Community] Trakt fetch failed ${c.key}: ${err.message}`);
            continue;
        }
        if (list === null) {
            if (++limited >= 3) {
                console.warn("[Community] Trakt rate limit hit repeatedly — stopping early");
                break;
            }
            continue;
        }
        await _sleep(250); // stay far below Trakt's 1000 requests / 5 min
        const usable = list
            .filter((cm) => cm && cm.comment && !cm.spoiler && !cm.parent_id)
            .map((cm) => ({ cm, text: _cleanText(cm.comment) }))
            .filter((x) => x.text.length >= 80);
        const base = (x) => ({
            source: "trakt",
            _key: c.key,
            author: x.cm.user?.name || x.cm.user?.username || "Trakt user",
            avatar: x.cm.user?.images?.avatar?.full || null,
            rating: x.cm.user_stats?.rating ? Number(x.cm.user_stats.rating) : null,
            createdAt: x.cm.created_at || null,
            likes: x.cm.likes ?? 0,
            comments: x.cm.replies ?? 0,
            media: _media(c),
        });
        const rev = usable.filter((x) => x.cm.review === true).sort((a, b) => (b.cm.likes || 0) - (a.cm.likes || 0))[0];
        if (rev) reviews.push({ ...base(rev), id: `trakt-${rev.cm.id}`, content: rev.text, score: (rev.cm.likes || 0) + (rev.cm.replies || 0) * 2 });
        const disc = usable.filter((x) => x !== rev && (x.cm.replies || 0) >= 1).sort((a, b) => (b.cm.replies || 0) - (a.cm.replies || 0) || (b.cm.likes || 0) - (a.cm.likes || 0))[0];
        if (disc) {
            const h = _headlineOf(disc.text);
            discussions.push({ ...base(disc), id: `trakt-${disc.cm.id}`, title: h.title, body: h.body, score: (disc.cm.replies || 0) * 2 + (disc.cm.likes || 0) });
        }
    }
    const top = (l) => l.sort((a, b) => b.score - a.score).slice(0, FEED_MAX_ITEMS);
    return { reviews: top(reviews), discussions: top(discussions) };
}

// Clear title logo for the cards (one TMDB call per distinct title that made the final lists).
async function _attachLogos(items, cands) {
    const byKey = new Map(cands.map((c) => [c.key, c]));
    const keys = [...new Set(items.map((i) => i._key))];
    const logos = new Map();
    await _mapLimit(keys, 4, async (key) => {
        const c = byKey.get(key);
        if (!c) return;
        try {
            const img = await tmdbFetch(`/${c.kind}/${c.tmdbId}/images`, { include_image_language: "en,null" });
            const logo = (img?.logos || []).filter((l) => l.iso_639_1 === "en").sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0))[0] || (img?.logos || [])[0];
            if (logo?.file_path) logos.set(key, `https://image.tmdb.org/t/p/w300${logo.file_path}`);
        } catch {
            /* no logo — the card falls back to the title text */
        }
    });
    for (const it of items) {
        it.media.logo = logos.get(it._key) || null;
        delete it._key;
        delete it.score;
    }
}

let _feedInflight = null;
let _feedLastAttempt = 0;

function rebuildCommunityFeeds() {
    if (_feedInflight) return _feedInflight;
    _feedLastAttempt = Date.now();
    _feedInflight = (async () => {
        const cands = await _feedCandidates();
        let reviews = [];
        let discussions = [];
        if (TRAKT_CLIENT_ID) ({ reviews, discussions } = await _traktItems(cands));

        const pool = await _tmdbReviewPool(cands);
        const usedReviewIds = new Set(reviews.map((r) => r.id));

        // Popular Reviews: best TMDB review of each title, after the Trakt ones
        const haveTitles = new Set(reviews.map((r) => r._key));
        const bestPerTitle = pool
            .filter((t) => !haveTitles.has(t.c.key))
            .map((t) => _tmdbItem(t.c, t.ranked[0]))
            .sort((a, b) => b.score - a.score);
        reviews = [...reviews, ...bestPerTitle].slice(0, FEED_MAX_ITEMS);
        reviews.forEach((r) => usedReviewIds.add(r.id));

        // Popular Discussions: Trakt threads first; TMDB fills the rest (next-best review per title, never one already shown above)
        if (discussions.length < FEED_MAX_ITEMS) {
            const haveDisc = new Set(discussions.map((d) => d._key));
            const fill = pool
                .filter((t) => !haveDisc.has(t.c.key))
                .map((t) => {
                    const x = t.ranked.find((y) => !usedReviewIds.has(`tmdb-${y.r.id}`));
                    return x ? _asDiscussion(_tmdbItem(t.c, x)) : null;
                })
                .filter(Boolean)
                .sort((a, b) => b.score - a.score);
            discussions = [...discussions, ...fill].slice(0, FEED_MAX_ITEMS);
        }

        await _attachLogos([...reviews, ...discussions], cands);
        await setCachedFeed(FEED_REVIEWS, reviews);
        await setCachedFeed(FEED_DISCUSSIONS, discussions);
        console.log(`[Community] feeds rebuilt — reviews=${reviews.length} discussions=${discussions.length} (trakt=${TRAKT_CLIENT_ID ? "on" : "off"})`);
        return { reviews: reviews.length, discussions: discussions.length };
    })().finally(() => {
        _feedInflight = null;
    });
    return _feedInflight;
}

async function _serveFeed(name, res) {
    try {
        const cached = await getCachedFeed(name);
        const age = cached ? Date.now() - Date.parse(cached.generatedAt) : Infinity;
        // stale or missing → rebuild in the BACKGROUND (never block the request), at most every FEED_RETRY_MS
        if (age > FEED_TTL_MS && Date.now() - _feedLastAttempt > FEED_RETRY_MS) {
            rebuildCommunityFeeds().catch((err) => console.error("[Community] rebuild failed:", err.message));
        }
        return res.json({ total: cached?.items?.length ?? 0, generatedAt: cached?.generatedAt ?? null, building: Boolean(_feedInflight), items: cached?.items ?? [] });
    } catch (err) {
        console.error(`[Community] ${name} error:`, err);
        return res.status(500).json({ error: "Failed to get feed" });
    }
}

// GET /api/media/popular-reviews
const getPopularReviews = (req, res) => _serveFeed(FEED_REVIEWS, res);
// GET /api/media/popular-discussions
const getPopularDiscussions = (req, res) => _serveFeed(FEED_DISCUSSIONS, res);

// Rebuild every 3 days, counted from the age of the saved feed (so restarts don't reset the clock).
let _feedFirstTimer = null;
let _feedTimer = null;

function startCommunityFeedScheduler() {
    const interval = Math.min(FEED_TTL_MS, MAX_TIMER_MS);
    const run = (label) =>
        rebuildCommunityFeeds().catch((err) => {
            console.error(`[Community] ${label} rebuild failed:`, err.message);
        });
    const repeat = () => {
        _feedTimer = setInterval(() => run("scheduled"), interval);
        _feedTimer.unref();
    };
    (async () => {
        // missing/stale → 3 min after boot, so the review-id refresher (first tick at 60 s) has already upgraded old entries to ALL their ids
        let wait = 3 * 60 * 1000;
        try {
            const cached = await getCachedFeed(FEED_REVIEWS);
            if (cached) {
                const left = interval - (Date.now() - Date.parse(cached.generatedAt));
                if (left > 0) wait = Math.min(left, MAX_TIMER_MS);
            }
        } catch (err) {
            console.warn("[Community] could not read feed age:", err.message);
        }
        _feedFirstTimer = setTimeout(
            async () => {
                _feedFirstTimer = null;
                await run("scheduled");
                repeat();
            },
            Math.max(wait, 0),
        );
        _feedFirstTimer.unref();
    })().catch((err) => console.error("[Community] scheduler failed to start:", err.message));
}

function stopCommunityFeedScheduler() {
    if (_feedFirstTimer) clearTimeout(_feedFirstTimer);
    if (_feedTimer) clearInterval(_feedTimer);
    _feedFirstTimer = null;
    _feedTimer = null;
}

module.exports = {
    getOne,
    refreshOne,
    refreshAll,
    parseDebug,
    getAllEnriched,
    getSeasonLazy,
    getTmdbItem,
    getPopularReviews,
    getPopularDiscussions,
    startCommunityFeedScheduler,
    stopCommunityFeedScheduler,
};
