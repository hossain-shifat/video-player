"use strict";

const fs = require("fs");
const path = require("path");
const { getHistory, getUserdata } = require("./userStore");
const { getCached } = require("./metadataStore");
const { getAllCached } = require("./mediaCache");
const { groupMedia } = require("./grouper"); // READ-ONLY — never modified, per standing constraint
const { readFolders } = require("../controllers/libraryController");

// ============================================================================
// recommendationEngine.js — "what should THIS USER watch next"
//
// This is a SEPARATE, independent algorithm from SimilarMedia.jsx's "what is
// similar to THIS media". SimilarMedia compares one item to another item.
// This engine compares one CANDIDATE item to a USER'S accumulated PREFERENCE
// PROFILE (a set of weighted genre/keyword/people/etc buckets built from
// their own history + favourites + watchlist). No code, scoring formula, or
// weighting constant is shared between the two on purpose.
//
// Identity note (see final report / audit): recommendation STATE is always
// keyed by the authenticated account (`user.id`, from Prisma via
// authenticateJWT) — that part is fully user-isolated. The WATCH-HISTORY
// signal, however, is sourced via `getHistory(clientId)`, because that is
// the only identity FLUX's existing history store
// (server/utils/userStore.js) understands today — it has no user linkage at
// all, only a per-device `X-Flux-Client` header. Favourites/watchlist
// (`getUserdata()`) are global in the current codebase — no per-user field
// exists there either. Both are used as-is (reuse existing systems, per
// spec) — see the report for what this means in a real multi-account setup.
// ============================================================================

// ─── Storage — flat JSON, in-memory cache + atomic write, mirrors the exact
// pattern already used by server/utils/permissionsStore.js. No new storage
// architecture introduced; keyed by userId inside one file, not a
// directory-per-user, since nothing else in this codebase uses that shape.
const STORE_FILE = path.join(__dirname, "..", "data", "recommendations.json");
let _cache = null;
let _writeLock = Promise.resolve();

function ensureFile() {
    if (!fs.existsSync(STORE_FILE)) fs.writeFileSync(STORE_FILE, "{}", "utf-8");
}
function loadAll() {
    if (_cache) return _cache;
    ensureFile();
    try {
        _cache = JSON.parse(fs.readFileSync(STORE_FILE, "utf-8"));
    } catch {
        _cache = {};
    }
    return _cache;
}
function saveAll(data) {
    ensureFile();
    const tmp = `${STORE_FILE}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmp, STORE_FILE);
    _cache = data;
}
function loadUserState(userId) {
    return loadAll()[userId] || null;
}
function saveUserState(userId, state) {
    _writeLock = _writeLock
        .then(() => {
            const all = loadAll();
            all[userId] = state;
            saveAll(all);
        })
        .catch(() => {});
    return _writeLock;
}

// ─── Small local helpers (independent — not imported from SimilarMedia) ────
function norm(s) {
    return (s ?? "").toString().toLowerCase().trim();
}
function accumulate(map, key, weight) {
    if (!key || !weight) return;
    map[key] = (map[key] || 0) + weight;
}
const IMPORTANT_JOBS = new Set(["Director", "Writer", "Screenplay", "Story", "Producer", "Executive Producer", "Editor"]);

function defaultProfile() {
    return { genres: {}, keywords: {}, people: {}, collections: {}, productionCompanies: {}, networks: {}, languages: {}, countries: {}, mediaTypes: {}, decades: {} };
}

// ── Signal weighting ─────────────────────────────────────────────────────────
// Explicit choices outweigh passive viewing (per spec: "explicit actions
// should matter more than starting a video").
const FAVOURITE_WEIGHT = 6;
const WATCHLIST_WEIGHT = 3;

/**
 * How much one history entry should count toward the user's taste.
 * Deliberately DIFFERENT math from SimilarMedia's overlap scoring:
 *   - depth-of-watch tiers (not a similarity count)
 *   - rewatch: linear cap at 4x (SimilarMedia uses geometric 0.6^n decay
 *     elsewhere in this codebase — intentionally not reused here)
 *   - recency: linear decay over ~6 months with a floor, so old activity
 *     never drops to zero but recent activity dominates
 */
function historySignalWeight(entry) {
    if (!entry || typeof entry !== "object") return 0;
    const duration = entry.duration || 0;
    const position = entry.position || 0;
    const pct = duration > 0 ? position / duration : entry.completed ? 1 : 0;

    let base;
    if (entry.completed || pct >= 0.9) base = 3;
    else if (pct >= 0.5) base = 2;
    else if (pct >= 0.2) base = 1;
    else if (duration > 60 && pct < 0.1) base = -0.5; // opened, abandoned almost immediately — mild negative
    else base = 0.4; // not enough data to tell either way — weak positive default

    const rewatchMultiplier = Math.min(entry.watchCount || 1, 4);
    const daysAgo = entry.watchedAt ? (Date.now() - new Date(entry.watchedAt).getTime()) / 86400000 : 999;
    const recencyMultiplier = Math.max(0.2, 1 - daysAgo / 180);

    return base * rewatchMultiplier * recencyMultiplier;
}

// Folds one resolved metadata object into the profile at the given weight.
// Per-category multipliers reflect how directly that field indicates taste
// (genre/person match harder than a shared spoken language, for instance).
function applyMetadataToProfile(profile, metadata, weight, mediaType) {
    accumulate(profile.mediaTypes, mediaType, weight);
    if (!metadata) return; // no TMDB match cached yet — mediaType signal above still counted

    for (const g of metadata.genres || []) accumulate(profile.genres, norm(g), weight);
    for (const k of metadata.keywords || []) {
        const name = typeof k === "string" ? k : k?.name;
        accumulate(profile.keywords, norm(name), weight * 0.8);
    }
    for (const c of metadata.cast || []) if (c?.tmdbPersonId != null) accumulate(profile.people, `p:${c.tmdbPersonId}`, weight * 0.7);
    for (const c of metadata.crew || []) if (c?.tmdbPersonId != null && IMPORTANT_JOBS.has(c.job)) accumulate(profile.people, `p:${c.tmdbPersonId}`, weight * 0.9);
    if (metadata.collection?.tmdbId != null) accumulate(profile.collections, `c:${metadata.collection.tmdbId}`, weight);
    for (const p of metadata.production_companies || []) if (p?.tmdbCompanyId != null) accumulate(profile.productionCompanies, `co:${p.tmdbCompanyId}`, weight * 0.5);
    for (const n of metadata.networks || []) if (n?.id != null) accumulate(profile.networks, `n:${n.id}`, weight * 0.5);
    for (const l of metadata.spokenLanguages || []) if (l?.code) accumulate(profile.languages, l.code, weight * 0.4);
    for (const cc of metadata.originCountries || []) accumulate(profile.countries, cc, weight * 0.3);
    if (metadata.year) accumulate(profile.decades, `${Math.floor(metadata.year / 10) * 10}s`, weight * 0.3);
}

const MIN_MEANINGFUL_EVENTS = 3; // cold-start gate — below this, return [] rather than guess

/**
 * Builds the weighted preference profile from this user's history
 * (per-clientId — see identity note above) + global favourites/watchlist.
 * `meaningfulEvents` gates cold start: a brand-new user has 0 and gets [].
 */
async function buildProfile(clientId) {
    const profile = defaultProfile();
    let meaningfulEvents = 0;

    const history = getHistory(clientId);
    for (const entry of Object.values(history)) {
        if (entry.duration > 60 || entry.completed) meaningfulEvents++;
        const weight = historySignalWeight(entry);
        if (!weight) continue;
        const meta = await getCached(entry.id); // cache-only — never triggers a TMDB call
        applyMetadataToProfile(profile, meta && !meta._notFound ? meta : null, weight, entry.mediaType || entry.type || "movie");
    }

    const { favourites, watchlist } = getUserdata();
    for (const fav of Object.values(favourites)) {
        meaningfulEvents++;
        const meta = await getCached(fav.id);
        applyMetadataToProfile(profile, meta && !meta._notFound ? meta : null, FAVOURITE_WEIGHT, fav.type || "movie");
    }
    for (const w of Object.values(watchlist)) {
        meaningfulEvents++;
        const meta = await getCached(w.id);
        applyMetadataToProfile(profile, meta && !meta._notFound ? meta : null, WATCHLIST_WEIGHT, w.type || "movie");
    }

    return { profile, meaningfulEvents };
}

// ─── Candidate pool — FLUX's own library, already-cached (mediaCache.js /
// metadataStore.js), same path every other media-listing endpoint uses. No
// filesystem re-scan and no TMDB call introduced by this feature.
async function getCandidatePool() {
    const folders = await readFolders();
    const { allMedia } = await getAllCached(folders);
    const grouped = await groupMedia(allMedia);
    const pool = [];
    for (const m of grouped.movies) pool.push({ ...m, _recType: "movie" });
    for (const s of grouped.series) pool.push({ ...s, _recType: "series" });
    for (const a of grouped.anime) pool.push({ ...a, _recType: "anime" });
    return pool;
}

// Mirrors the client-side permission rule already established in
// web/src/Hooks/useMedia.js (canSeeRestricted/filterRestricted) — same
// field (`item.permission !== false`), same admin/allowAdult bypass — now
// applied server-side so a stored recommendation can never leak restricted
// media, independent of what the frontend does or doesn't filter.
function canSeeRestricted(user, permissions) {
    return !!user && (user.role === "admin" || permissions?.allowAdult === true);
}
function filterAccessible(pool, user, permissions) {
    if (canSeeRestricted(user, permissions)) return pool;
    return pool.filter((item) => item.permission !== false);
}

function completedIdSet(history) {
    return new Set(
        Object.values(history)
            .filter((h) => h.completed)
            .map((h) => h.id),
    );
}

// Same real-world title scanned into two folders (two different local ids)
// still counts as one thing — prefer TMDB id, fall back to local id/seriesKey.
function candidateStableId(item) {
    return item?.metadata?.tmdbId ?? item?.id ?? item?.seriesKey ?? null;
}

// ─── Scoring — candidate METADATA vs the USER'S PROFILE (a dot-product over
// weighted buckets), not item-vs-item overlap. Category caps keep any single
// dimension (e.g. a huge keyword list) from dominating the total, and the
// flat MIN_SCORE threshold is what satisfies "weak metadata alone cannot
// generate a large recommendation list" — a single coincidental shared
// country isn't enough to qualify on its own.
const CATEGORY_CAPS = { genres: 40, keywords: 25, people: 30, collections: 20, productionCompanies: 12, networks: 10, languages: 8, countries: 6, decades: 5 };
const MIN_SCORE = 16;
// FIX: on a small library, genre alone (cap 40) trivially cleared the old
// MIN_SCORE of 12 — meaning "shares one broad genre with something you
// liked" was enough to recommend basically the whole catalog. Now a
// candidate must hit at least 2 DISTINCT strong-signal categories (genre,
// keyword, people, production company, or network) — sharing only a genre
// no longer qualifies on its own. A real collection/franchise match is
// exempt from this — it's specific enough (an actual sequel/prequel) to
// stand alone, matching its "very high" weight.
const STRONG_SIGNAL_MIN = 2;

function categoryScore(profileMap, keys, cap) {
    let sum = 0;
    let hit = false;
    for (const k of keys) {
        const w = profileMap[k];
        if (w) {
            sum += w;
            hit = true;
        }
    }
    return { score: Math.max(0, Math.min(sum, cap)), hit };
}

function scoreCandidate(item, profile) {
    const meta = item.metadata;
    if (!meta) return null;
    let score = 0;
    let strongHits = 0; // distinct genre/keyword/people/company/network categories that actually matched
    let hasCollectionMatch = false;
    const reasons = [];

    const g = categoryScore(profile.genres, (meta.genres || []).map(norm), CATEGORY_CAPS.genres);
    if (g.hit) {
        score += g.score;
        strongHits++;
        reasons.push("Matches genres you watch often");
    }

    const kwKeys = (meta.keywords || []).map((k) => norm(typeof k === "string" ? k : k?.name));
    const k = categoryScore(profile.keywords, kwKeys, CATEGORY_CAPS.keywords);
    if (k.hit) {
        score += k.score;
        strongHits++;
        reasons.push("Matches themes you're drawn to");
    }

    const peopleKeys = [...(meta.cast || []).map((c) => (c?.tmdbPersonId != null ? `p:${c.tmdbPersonId}` : null)), ...(meta.crew || []).map((c) => (c?.tmdbPersonId != null ? `p:${c.tmdbPersonId}` : null))].filter(
        Boolean,
    );
    const p = categoryScore(profile.people, peopleKeys, CATEGORY_CAPS.people);
    if (p.hit) {
        score += p.score;
        strongHits++;
        reasons.push("Features people you watch often");
    }

    if (meta.collection?.tmdbId != null) {
        const c = categoryScore(profile.collections, [`c:${meta.collection.tmdbId}`], CATEGORY_CAPS.collections);
        if (c.hit) {
            score += c.score;
            hasCollectionMatch = true;
            reasons.push("From a collection you follow");
        }
    }

    const coKeys = (meta.production_companies || []).map((p) => (p?.tmdbCompanyId != null ? `co:${p.tmdbCompanyId}` : null)).filter(Boolean);
    const co = categoryScore(profile.productionCompanies, coKeys, CATEGORY_CAPS.productionCompanies);
    if (co.hit) {
        score += co.score;
        strongHits++;
        reasons.push("From a studio you follow");
    }

    const netKeys = (meta.networks || []).map((n) => (n?.id != null ? `n:${n.id}` : null)).filter(Boolean);
    const net = categoryScore(profile.networks, netKeys, CATEGORY_CAPS.networks);
    if (net.hit) {
        score += net.score;
        strongHits++;
        reasons.push("From a network you watch");
    }

    const lang = categoryScore(profile.languages, (meta.spokenLanguages || []).map((l) => l?.code).filter(Boolean), CATEGORY_CAPS.languages);
    if (lang.hit) score += lang.score;

    const country = categoryScore(profile.countries, meta.originCountries || [], CATEGORY_CAPS.countries);
    if (country.hit) score += country.score;

    if (meta.year) {
        const d = categoryScore(profile.decades, [`${Math.floor(meta.year / 10) * 10}s`], CATEGORY_CAPS.decades);
        if (d.hit) score += d.score;
    }

    const typeWeight = profile.mediaTypes[item._recType] || 0;
    score += Math.min(typeWeight * 0.15, 8);

    if (score < MIN_SCORE) return null;
    if (strongHits < STRONG_SIGNAL_MIN && !hasCollectionMatch) return null; // single-dimension overlap alone isn't enough
    return { score, reasons: reasons.slice(0, 3) };
}

function dominantGenre(item, profile) {
    let best = null,
        bestW = 0;
    for (const g of item.metadata?.genres || []) {
        const w = profile.genres[norm(g)] || 0;
        if (w > bestW) {
            bestW = w;
            best = norm(g);
        }
    }
    return best;
}

// Diversity: no single dominant genre may exceed ~40% of the final list —
// prevents "watched one action movie → wall of action movies".
function applyDiversity(scored, limit) {
    scored.sort((a, b) => b.score - a.score);
    const maxPerGenre = Math.max(2, Math.ceil(limit * 0.4));
    const counts = {};
    const picked = [];
    const deferred = [];
    for (const s of scored) {
        const g = s.dominantGenre || "unknown";
        if ((counts[g] || 0) < maxPerGenre) {
            counts[g] = (counts[g] || 0) + 1;
            picked.push(s);
        } else {
            deferred.push(s);
        }
        if (picked.length >= limit) break;
    }
    for (const s of deferred) {
        if (picked.length >= limit) break;
        picked.push(s);
    }
    return picked;
}

const RECOMMENDATION_LIMIT = 24; // sanity ceiling only — how many actually qualify is entirely up to
// scoreCandidate()'s threshold/multi-signal gate above, never shrunk further
// by library size. A 28-item library with only 3 genuine matches shows 3;
// with 20 genuine matches it shows 20. Count is a quality outcome, not a
// formula.
const REFRESH_STALE_MS = 30 * 60 * 1000; // controlled regeneration — not on every request

function emptyState(userId, profile, eventsProcessed = 0) {
    return {
        version: 1,
        algorithmVersion: 1,
        userId,
        updatedAt: new Date().toISOString(),
        profile: profile || defaultProfile(),
        recommendations: [],
        history: { lastProcessedAt: new Date().toISOString(), eventsProcessed },
    };
}

async function generateFromProfile(userId, clientId, accessiblePool) {
    const { profile, meaningfulEvents } = await buildProfile(clientId);

    if (meaningfulEvents < MIN_MEANINGFUL_EVENTS) {
        const state = emptyState(userId, profile, meaningfulEvents);
        await saveUserState(userId, state);
        return state;
    }

    const history = getHistory(clientId);
    const completed = completedIdSet(history);
    const seenStableIds = new Set();
    const scored = [];

    for (const item of accessiblePool) {
        if (completed.has(item.id)) continue; // already finished — don't re-recommend it
        const stableId = candidateStableId(item);
        if (stableId != null && seenStableIds.has(stableId)) continue; // duplicate copy of the same real title
        const result = scoreCandidate(item, profile);
        if (!result) continue;
        seenStableIds.add(stableId);
        scored.push({ item, score: result.score, reasons: result.reasons, dominantGenre: dominantGenre(item, profile) });
    }

    const final = applyDiversity(scored, RECOMMENDATION_LIMIT);
    const state = {
        version: 1,
        algorithmVersion: 1,
        userId,
        updatedAt: new Date().toISOString(),
        profile,
        // Stable id + score + reasons ONLY — never the full media object, so
        // this file can never go stale/duplicate the real library data.
        recommendations: final.map((s) => ({ mediaId: s.item.id, score: Math.round(s.score * 10) / 10, reasons: s.reasons, generatedAt: new Date().toISOString() })),
        history: { lastProcessedAt: new Date().toISOString(), eventsProcessed: meaningfulEvents },
    };
    await saveUserState(userId, state);
    return state;
}

/**
 * getRecommendationsForUser — the one function the controller calls.
 *
 * - Always re-filters candidates by CURRENT permissions on every call (so a
 *   permission change or library removal takes effect immediately — never
 *   trusts a stale stored recommendation for access).
 * - Only regenerates the SCORE/profile when missing, forced, or stale
 *   (REFRESH_STALE_MS) — not on every request/render.
 * - Resolves stored mediaIds against the live accessible pool; anything
 *   removed/inaccessible since generation is silently dropped, never
 *   rendered as a broken card.
 */
async function getRecommendationsForUser(user, permissions, clientId, { force = false } = {}) {
    const userId = user.id;
    let state = loadUserState(userId);
    const stale = !state?.updatedAt || Date.now() - new Date(state.updatedAt).getTime() > REFRESH_STALE_MS;

    const pool = await getCandidatePool();
    const accessible = filterAccessible(pool, user, permissions);

    if (force || !state || stale) {
        state = await generateFromProfile(userId, clientId, accessible);
    }

    const byId = new Map(accessible.map((i) => [i.id, i]));
    const resolved = (state.recommendations || [])
        .map((r) => {
            const item = byId.get(r.mediaId);
            if (!item) return null;
            return { ...item, _recScore: r.score, _recReasons: r.reasons };
        })
        .filter(Boolean);

    return { recommendations: resolved, updatedAt: state.updatedAt, algorithmVersion: state.algorithmVersion };
}

module.exports = { getRecommendationsForUser };
