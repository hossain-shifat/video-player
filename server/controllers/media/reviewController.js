"use strict";

// ============================================================================
// reviewController.js — FLUX review system (reviews · reactions · discussions)
//
// Everything lives in server/data/media/reviews.json (see utils/media/reviewStore.js) and happens ON THIS
// SERVER ONLY: nothing a user writes, reacts to or replies to is ever sent to TMDB.
// TMDB is only a one-way SOURCE of starter content: its full reviews are imported (and re-imported every
// 3 days) so a title is never empty — TMDB has no reactions or replies, so those come from your users.
//
// Routes (routes/media/reviews.js, mounted at /api/reviews):
//   GET    /title/:kind/:tmdbId           reviews of a title (+ summary, sorting, paging)       public
//   POST   /title/:kind/:tmdbId           write a review (one per user per title)               approved user
//   PATCH  /:id    DELETE /:id            edit / delete a review (owner · admin may delete)
//   POST   /:id/react                     react to a review ({ type } or { type: null })
//   GET    /:id/thread                    a review + its whole discussion
//   POST   /:id/replies                   comment / reply in the discussion
//   PATCH  /replies/:rid   DELETE /replies/:rid   POST /replies/:rid/react
//   GET    /popular   GET /discussions    Home page rows
//   POST   /sync/:kind/:tmdbId  POST /sync-all    admin: re-import from TMDB now
//
// "Discussions" = the reviews people react to and talk about the most:
//   score = reactions + 3 × replies. Until your users have created some activity the best TMDB reviews
//   fill the row; opening one and replying is what turns it into a real discussion.
// ============================================================================

const fs = require("fs");
const path = require("path");
const { readFolders } = require("./libraryController");
const { decodeFileId } = require("../../utils/media/fileHelpers");
const { getAllCached } = require("../../utils/media/mediaCache");
const { getMetadata } = require("../../metadata/metadataStore");
const { fetchReviewsFull, fetchTitleLogo } = require("../../metadata/tmdb");
const prisma = require("../../auth/prismaClient");
const store = require("../../utils/media/reviewStore");

const SYNC_TTL_MS = parseInt(process.env.REVIEW_SYNC_INTERVAL_MS || String(3 * 24 * 60 * 60 * 1000), 10); // 3 days
const SYNC_BATCH = parseInt(process.env.REVIEW_SYNC_BATCH || "400", 10); // titles imported per sweep
const TICK_MS = 6 * 60 * 60 * 1000;

const MIN_REVIEW = 10;
const MAX_REVIEW = 5000;
const MAX_REPLY = 2000;
const FEED_MAX = 30;
// Home cards show only 2–3 lines, so the feeds never ship more text than this (the full review is one click away on its page)
const FEED_REVIEW_CHARS = 280;
const FEED_DISCUSSION_CHARS = 220;

// ─── small helpers ────────────────────────────────────────────────────────────

const isAdmin = (req) => req.user?.role === "admin";

function parseKey(kind, tmdbId) {
    const id = parseInt(tmdbId, 10);
    if (!Number.isInteger(id) || id <= 0) return null;
    const k = String(kind || "").toLowerCase();
    if (k === "movie") return { key: `movie:${id}`, kind: "movie", tmdbId: id };
    if (k === "tv" || k === "series" || k === "anime") return { key: `tv:${id}`, kind: "tv", tmdbId: id };
    return null;
}

// what a user types — plain text; React escapes it on display, so nothing is stripped except control chars
function cleanUserText(t, max) {
    return String(t ?? "")
        .replace(/\r\n?/g, "\n")
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, max);
}

// TMDB reviews are markdown/HTML-ish — flatten to plain text
function cleanImported(t) {
    return String(t ?? "")
        .replace(/\r\n?/g, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/^\s{0,3}#{1,6}\s+/gm, "")
        .replace(/^\s{0,3}>\s?/gm, "")
        .replace(/[*`]+/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, 8000);
}

// short card excerpt: flat text, cut at a sentence end when one falls late enough, else at a word — never mid-word, never over `max`
function excerpt(text, max) {
    const flat = String(text || "").replace(/\s+/g, " ").trim();
    if (flat.length <= max) return flat;
    const cut = flat.slice(0, max);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    if (end >= max * 0.6) return cut.slice(0, end + 1);
    return `${cut.replace(/\s+\S*$/, "")}…`;
}

// discussion cards need a headline — use the first sentence (or the first ~80 chars)
function headlineOf(text) {
    const flat = String(text || "").replace(/\s+/g, " ").trim();
    const m = flat.match(/^(.{15,90}?[.!?])(\s|$)/);
    if (m) return { title: m[1].replace(/\.$/, ""), body: flat.slice(m[0].length).trim() || flat };
    if (flat.length <= 90) return { title: flat, body: flat };
    return { title: `${flat.slice(0, 80).replace(/\s+\S*$/, "")}…`, body: flat };
}

// same rule Banner.jsx uses (isMature) — titles the restricted-content setting hides never reach the shared Home feeds
const BLOCKED_CERTS = new Set(["R", "NC-17", "NC17", "X", "XXX", "TV-MA", "18", "18+", "18A", "R18", "R18+", "R-18", "AO"]);
function isMatureMeta(m) {
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
        if (pool.some((c) => BLOCKED_CERTS.has(c))) return true;
    }
    return [m.certification, m.contentRating, m.mpaa, m.mpaaRating, m.rated, m.ageRating, m.maturityRating].some((v) => v != null && BLOCKED_CERTS.has(norm(typeof v === "object" ? v.certification || v.rating : v)));
}

async function mapLimit(list, limit, fn) {
    let next = 0;
    await Promise.all(
        Array.from({ length: Math.min(limit, list.length) }, async () => {
            while (next < list.length) {
                const i = next++;
                try {
                    await fn(list[i], i);
                } catch (err) {
                    console.warn("[Reviews] task failed:", err.message);
                }
            }
        }),
    );
}

// ─── authors: always show the CURRENT name/avatar of local users ──────────────
// (the stored snapshot is only a fallback — a user who renames themselves or deletes their account is reflected)

const userCache = new Map(); // id → { at, value }
const USER_TTL = 60_000;

async function resolveUsers(ids) {
    const out = new Map();
    const need = [];
    const now = Date.now();
    for (const id of new Set(ids.filter(Boolean))) {
        const c = userCache.get(id);
        if (c && now - c.at < USER_TTL) out.set(id, c.value);
        else need.push(id);
    }
    if (need.length) {
        try {
            const rows = await prisma.user.findMany({ where: { id: { in: need } }, select: { id: true, name: true, avarter: true, status: true, deletedAt: true } });
            const found = new Map(rows.map((r) => [r.id, r]));
            for (const id of need) {
                const u = found.get(id);
                const value = !u || u.status === "deleted" || u.deletedAt ? { name: "Deleted user", avatar: null } : { name: u.name || "User", avatar: u.avarter || null };
                userCache.set(id, { at: now, value });
                out.set(id, value);
            }
        } catch (err) {
            console.warn("[Reviews] user lookup failed, using stored names:", err.message);
        }
    }
    return out;
}

const authorOf = (item, users) => (item.userId ? users.get(item.userId) || item.author : item.author) || { name: "Unknown", avatar: null };

// ─── serialisers ──────────────────────────────────────────────────────────────

function viewerCtx(req) {
    return { viewerId: req.user?.id || null, admin: isAdmin(req) };
}

function serializeReview(r, ctx, users, replyCount) {
    const mine = Boolean(ctx.viewerId) && r.userId === ctx.viewerId;
    const a = authorOf(r, users);
    return {
        id: r.id,
        key: r.key,
        source: r.source,
        author: { name: a.name, avatar: a.avatar || null },
        rating: r.rating ?? null,
        content: r.content,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        edited: Boolean(r.edited),
        reactions: store.summarizeReactions(r.reactions, ctx.viewerId),
        replyCount,
        isMine: mine,
        canEdit: mine && r.source === "local",
        canDelete: mine || ctx.admin,
    };
}

function serializeReply(rp, ctx, users, byId) {
    const mine = Boolean(ctx.viewerId) && rp.userId === ctx.viewerId;
    const a = authorOf(rp, users);
    const to = rp.replyToId ? byId.get(rp.replyToId) : null;
    return {
        id: rp.id,
        reviewId: rp.reviewId,
        parentId: rp.parentId,
        replyToId: rp.replyToId,
        replyToName: to ? authorOf(to, users).name : null,
        author: { name: a.name, avatar: a.avatar || null },
        content: rp.content,
        createdAt: rp.createdAt,
        updatedAt: rp.updatedAt,
        edited: Boolean(rp.edited),
        reactions: store.summarizeReactions(rp.reactions, ctx.viewerId),
        isMine: mine,
        canEdit: mine,
        canDelete: mine || ctx.admin,
    };
}

function mediaOf(key, t) {
    if (!t) return null;
    return { id: t.fileId || null, title: t.title || null, backdrop: t.backdrop || null, poster: t.poster || null, logo: t.logo || null, type: t.type || (key.startsWith("movie:") ? "movie" : "series") };
}

// the review page: card info + year / runtime / genres / synopsis / score, and the TMDB key (movie:603) for "open title"
function mediaFull(key, t) {
    const base = mediaOf(key, t) || { id: null, title: null, backdrop: null, poster: null, logo: null, type: key.startsWith("movie:") ? "movie" : "series" };
    return { ...base, key, inLibrary: Boolean(t?.inLibrary), year: t?.year ?? null, runtime: t?.runtime ?? null, genres: t?.genres || [], overview: t?.overview || null, rating: t?.rating ?? null, votes: t?.votes ?? null };
}

// ─── ranking ──────────────────────────────────────────────────────────────────

const reactionTotal = (r) => Object.keys(r.reactions || {}).length;

function topScore(r, replies) {
    const len = Math.min((r.content || "").length, 1500);
    const ageYears = Math.max(0, (Date.now() - Date.parse(r.createdAt || 0)) / (365 * 86400000));
    return reactionTotal(r) * 3 + replies * 4 + (r.rating != null ? r.rating / 2 : 3) + len / 500 + (r.source === "local" ? 1 : 0) + Math.max(0, 1.5 - ageYears * 0.3);
}

// Home-feed ranking: same as topScore, but a review is no longer rewarded for being long — it peaks around 900 chars and fades out
function feedScore(r, replies) {
    const len = (r.content || "").length;
    const lengthBonusInTopScore = Math.min(len, 1500) / 500;
    const readable = len <= 900 ? len / 450 : Math.max(0, 2 - (len - 900) / 900);
    return topScore(r, replies) - lengthBonusInTopScore + readable;
}

// ─── TMDB import (one-way: TMDB → reviews.json) ───────────────────────────────

const syncing = new Set();
let sweeping = false;

async function syncTitle(parsed, info) {
    const { key, kind, tmdbId } = parsed;
    if (syncing.has(key)) return null;
    syncing.add(key);
    try {
        const items = await fetchReviewsFull(kind, tmdbId);
        if (items === null) return null; // TMDB unreachable — NOT "no reviews"; retried on the next sweep
        const cleaned = items.map((it) => ({ ...it, content: cleanImported(it.content) })).filter((it) => it.content.length >= 20);
        const res = await store.importReviews(key, cleaned);
        const prev = await store.getTitle(key);
        const patch = { ...(info || {}), syncedAt: new Date().toISOString() };
        if (!(prev?.logo || patch.logo || prev?.logoChecked) && (info?.feedOk || prev?.feedOk)) {
            patch.logo = await fetchTitleLogo(kind, tmdbId).catch(() => null);
            patch.logoChecked = true; // no logo on TMDB → don't ask again every sweep
        }
        await store.upsertTitle(key, patch);
        invalidateFeeds();
        return res;
    } finally {
        syncing.delete(key);
    }
}

// what the review PAGE shows next to a review (year · runtime · genres · synopsis · TMDB score) — all of it is already in metadata
function pageInfo(m) {
    const genres = (m.genres || []).map((g) => (typeof g === "string" ? g : g?.name)).filter(Boolean).slice(0, 4);
    const overview = String(m.overview || "").trim().slice(0, 700);
    return {
        year: Number(m.year) || null,
        runtime: Number(m.runtime) || null,
        genres,
        overview: overview || null,
        rating: Number(m.rating) || null,
        votes: Number(m.votes) || null,
    };
}

// every library title once (series/anime episode files collapse into one tmdb title)
async function libraryTitles() {
    const folders = await readFolders();
    const { allMedia } = await getAllCached(folders);
    const out = new Map();
    for (const file of allMedia) {
        const m = await getMetadata(file);
        if (!m || !m.tmdbId) continue;
        // Anime films are TMDB MOVIES, anime shows are TMDB TV. Only TV details carry `totalSeasons` — that is the
        // signal (same one MediaDetails uses via its `seasons` shape) to tell a film from a show.
        const isFilm = m.type === "movie" || (m.type === "anime" && !("totalSeasons" in m));
        const parsed = parseKey(isFilm ? "movie" : "tv", m.tmdbId);
        if (!parsed || out.has(parsed.key)) continue;
        out.set(parsed.key, { ...parsed, info: { title: m.title || null, backdrop: m.backdrop || null, poster: m.poster || null, type: m.type || null, fileId: file.id, inLibrary: true, feedOk: !isMatureMeta(m), ...pageInfo(m) } });
    }
    return out;
}

// → array of library root paths when EVERY root is readable right now, else null (unknown / offline → never delist)
async function readableLibraryRoots() {
    try {
        const folders = await readFolders();
        if (!folders.length) return null;
        for (const f of folders) await fs.promises.access(f.path, fs.constants.R_OK);
        return folders.map((f) => f.path);
    } catch {
        return null;
    }
}

const normPath = (p) => {
    const x = path.resolve(String(p)).replace(/\\/g, "/").replace(/\/+$/, "");
    return process.platform === "win32" || process.platform === "darwin" ? x.toLowerCase() : x;
};
const underRoots = (file, roots) => roots.some((r) => normPath(file).startsWith(normPath(r) + "/"));

// true only when the file is verifiably absent — any other error (EACCES, EIO, …) means "do not know" → keep it listed
// A file that still exists but sits outside every current library root is no longer "in the library" either.
async function fileIsGone(fileId, roots) {
    if (!fileId) return true;
    try {
        const file = decodeFileId(fileId);
        await fs.promises.access(file);
        return !underRoots(file, roots);
    } catch (err) {
        return err?.code === "ENOENT" || err?.code === "ENOTDIR";
    }
}

async function runSweep(label) {
    if (sweeping) return;
    sweeping = true;
    try {
        const titles = await libraryTitles();
        const known = await store.allTitles();
        // Anime FILMS used to be stored under the tv namespace. Move their user content to movie:<id>, which is the
        // namespace MediaDetails reads. Only an old record that was an anime title and has no real TV title behind it.
        for (const t of titles.values()) {
            if (t.kind !== "movie" || t.info.type !== "anime") continue;
            const oldKey = `tv:${t.tmdbId}`;
            const old = known[oldKey];
            if (old && old.type === "anime" && old.inLibrary && !titles.has(oldKey)) {
                const r = await store.migrateTitleKey(oldKey, t.key);
                console.log(`[Reviews] anime film ${oldKey} → ${t.key} (moved ${r.moved}, dropped ${r.dropped})`);
                invalidateFeeds();
            }
        }
        const now = Date.now();
        const due = [];
        for (const t of titles.values()) {
            const k = known[t.key];
            // keep card info (poster, backdrop, feed flag) current for EVERY library title — cheap, no TMDB call
            const changed = !k || Object.entries(t.info).some(([f, v]) => JSON.stringify(k[f] ?? null) !== JSON.stringify(v ?? null));
            if (changed) await store.upsertTitle(t.key, t.info);
            const last = k?.syncedAt ? Date.parse(k.syncedAt) : 0;
            if (now - last >= SYNC_TTL_MS) due.push({ t, last });
        }
        // Titles whose last file left the library: keep their reviews, but stop publishing them / their file link.
        // The scanner cannot tell an unreadable / unmounted folder from an empty one, so a title is delisted only when
        // (a) EVERY library root is readable right now and (b) its stored file is verifiably gone (ENOENT) — a file that
        // still exists (e.g. its metadata lookup merely failed) or a drive that is offline never causes a delisting.
        let delisted = 0;
        const absent = Object.entries(known).filter(([key, k]) => k?.inLibrary && !titles.has(key));
        const roots = absent.length ? await readableLibraryRoots() : null;
        if (absent.length && roots) {
            for (const [key, k] of absent) {
                if (await fileIsGone(k.fileId, roots)) {
                    await store.upsertTitle(key, { inLibrary: false, fileId: null });
                    delisted++;
                }
            }
            if (delisted) invalidateFeeds();
        }
        due.sort((a, b) => a.last - b.last); // never-synced first, then the oldest
        const batch = due.slice(0, SYNC_BATCH);
        let added = 0;
        await mapLimit(batch, 3, async ({ t }) => {
            const r = await syncTitle(t, t.info);
            if (r) added += r.added;
        });

        // title logos for the Home cards — also for titles that were imported before they were known to be feed-eligible
        const known2 = await store.allTitles();
        const needLogo = [...titles.values()].filter((t) => t.info.feedOk && !known2[t.key]?.logo && !known2[t.key]?.logoChecked);
        await mapLimit(needLogo, 3, async (t) => {
            const logo = await fetchTitleLogo(t.kind, t.tmdbId).catch(() => null);
            await store.upsertTitle(t.key, { logo, logoChecked: true });
        });
        if (needLogo.length) invalidateFeeds();

        if (batch.length || needLogo.length) console.log(`[Reviews] ${label} sweep done — titles=${batch.length}/${due.length} due, new reviews=${added}, logos=${needLogo.length}`);
    } catch (err) {
        console.error(`[Reviews] ${label} sweep failed:`, err.message);
    } finally {
        sweeping = false;
    }
}

let firstTimer = null;
let timer = null;

function startReviewScheduler() {
    store.loadStore().catch(() => {});
    firstTimer = setTimeout(() => runSweep("startup"), 90 * 1000); // after boot has settled
    firstTimer.unref();
    timer = setInterval(() => runSweep("scheduled"), TICK_MS);
    timer.unref();
}

function stopReviewScheduler() {
    if (firstTimer) clearTimeout(firstTimer);
    if (timer) clearInterval(timer);
    firstTimer = null;
    timer = null;
}

const flushReviews = (deadlineMs) => store.flush(deadlineMs);
const freezeReviews = () => store.freeze();

// ─── Home feeds (memoised for 60 s, dropped on every write) ───────────────────

let feedVersion = 0;
const feedMemo = new Map(); // name → { v, at, value }
const invalidateFeeds = () => {
    feedVersion++;
};

async function memo(name, build) {
    const m = feedMemo.get(name);
    if (m && m.v === feedVersion && Date.now() - m.at < 60_000) return m.value;
    const value = await build();
    feedMemo.set(name, { v: feedVersion, at: Date.now(), value });
    return value;
}

// feed-eligible = library titles that are not mature (Banner.jsx rule); one entry per title
async function feedPool() {
    const titles = await store.allTitles();
    const reviews = await store.allReviews();
    const perTitle = new Map();
    for (const r of reviews) {
        const t = titles[r.key];
        if (!t || !t.feedOk || !t.inLibrary) continue;
        if ((r.content || "").length < 80) continue;
        const replies = await store.replyCount(r.id);
        const entry = { r, t, replies, top: feedScore(r, replies), heat: reactionTotal(r) + replies * 3 };
        const cur = perTitle.get(r.key);
        if (!cur || entry.top > cur.top) perTitle.set(r.key, entry);
    }
    return { entries: [...perTitle.values()], reviews, titles };
}

async function buildPopular() {
    const { entries } = await feedPool();
    const best = entries.sort((a, b) => b.top - a.top).slice(0, FEED_MAX);
    const users = await resolveUsers(best.map((e) => e.r.userId));
    return best.map(({ r, t, replies }) => {
        const a = authorOf(r, users);
        return {
            id: r.id,
            author: a.name,
            avatar: a.avatar || null,
            rating: r.rating ?? null,
            content: excerpt(r.content, FEED_REVIEW_CHARS),
            createdAt: r.createdAt,
            likes: reactionTotal(r),
            comments: replies,
            media: mediaOf(r.key, t),
        };
    });
}

async function buildDiscussions() {
    const { reviews, titles, entries } = await feedPool();
    // 1) real discussions: reviews people reacted to or replied to — per title, the hottest one
    const hot = new Map();
    for (const r of reviews) {
        const t = titles[r.key];
        if (!t || !t.feedOk || !t.inLibrary || (r.content || "").length < 40) continue;
        const replies = await store.replyCount(r.id);
        const heat = reactionTotal(r) + replies * 3;
        if (heat <= 0) continue;
        const cur = hot.get(r.key);
        if (!cur || heat > cur.heat) hot.set(r.key, { r, t, replies, heat });
    }
    let picks = [...hot.values()].sort((a, b) => b.heat - a.heat);

    // 2) seed: until there is enough real activity, the best imported reviews start the conversation
    if (picks.length < 12) {
        const have = new Set(picks.map((p) => p.r.key));
        const seed = entries
            .filter((e) => !have.has(e.r.key) && e.r.content.length >= 140)
            .sort((a, b) => b.top - a.top)
            .slice(0, 12 - picks.length);
        picks = [...picks, ...seed];
    }
    picks = picks.slice(0, FEED_MAX);

    const users = await resolveUsers(picks.map((p) => p.r.userId));
    return picks.map(({ r, t, replies }) => {
        const a = authorOf(r, users);
        const h = headlineOf(r.content);
        return { id: r.id, title: h.title, body: excerpt(h.body, FEED_DISCUSSION_CHARS), author: a.name, avatar: a.avatar || null, rating: r.rating ?? null, createdAt: r.createdAt, likes: reactionTotal(r), comments: replies, media: mediaOf(r.key, t) };
    });
}

// The memoised feeds are shared by everybody, so the viewer's own reaction is added AFTER the memo: `mine` = "like" | "love" | … | null
async function withViewer(items, req) {
    if (!req.user?.id) return items;
    return Promise.all(
        items.map(async (it) => {
            const r = await store.getReview(it.id);
            return { ...it, mine: r?.reactions?.[req.user.id] || null };
        }),
    );
}

async function getPopular(req, res) {
    try {
        const items = await withViewer(await memo("popular", buildPopular), req);
        if (req.user?.id) res.set("Cache-Control", "private, no-store");
        return res.json({ total: items.length, items });
    } catch (err) {
        console.error("[Reviews] popular error:", err);
        return res.status(500).json({ error: "Failed to load popular reviews" });
    }
}

async function getDiscussions(req, res) {
    try {
        const items = await withViewer(await memo("discussions", buildDiscussions), req);
        if (req.user?.id) res.set("Cache-Control", "private, no-store");
        return res.json({ total: items.length, items });
    } catch (err) {
        console.error("[Reviews] discussions error:", err);
        return res.status(500).json({ error: "Failed to load discussions" });
    }
}

// ─── reviews of a title ───────────────────────────────────────────────────────

function safeImage(u) {
    return typeof u === "string" && /^https:\/\/image\.tmdb\.org\//.test(u) && u.length < 300 ? u : null;
}

async function listTitleReviews(req, res) {
    try {
        const parsed = parseKey(req.params.kind, req.params.tmdbId);
        if (!parsed) return res.status(400).json({ error: "Invalid title" });

        // first time anyone opens this title (or it is stale): import from TMDB in the BACKGROUND, never block the page
        const title = await store.getTitle(parsed.key);
        const stale = !title?.syncedAt || Date.now() - Date.parse(title.syncedAt) >= SYNC_TTL_MS;
        let importing = false;
        if (stale && !syncing.has(parsed.key)) {
            importing = true;
            syncTitle(parsed, null).catch((err) => console.warn("[Reviews] background import failed:", err.message));
        } else if (syncing.has(parsed.key)) importing = true;

        const ctx = viewerCtx(req);
        const sort = ["top", "new", "rating"].includes(req.query.sort) ? req.query.sort : "top";
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 24, 1), 100);
        const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

        const all = await store.listReviewsFor(parsed.key);
        const counts = new Map();
        for (const r of all) counts.set(r.id, await store.replyCount(r.id));

        const rated = all.filter((r) => r.rating != null);
        const histogram = [0, 0, 0, 0, 0];
        for (const r of rated) histogram[Math.min(5, Math.max(1, Math.ceil(r.rating / 2))) - 1]++;
        const average = rated.length ? Math.round((rated.reduce((s, r) => s + r.rating, 0) / rated.length) * 10) / 10 : null;

        const sorted = [...all].sort((a, b) => {
            if (sort === "new") return (b.createdAt || "").localeCompare(a.createdAt || "");
            if (sort === "rating") return (b.rating ?? -1) - (a.rating ?? -1) || topScore(b, counts.get(b.id)) - topScore(a, counts.get(a.id));
            return topScore(b, counts.get(b.id)) - topScore(a, counts.get(a.id));
        });
        const page = sorted.slice(offset, offset + limit);
        const users = await resolveUsers(page.map((r) => r.userId));
        const mine = ctx.viewerId ? (await store.findUserReview(parsed.key, ctx.viewerId))?.id || null : null;

        return res.json({
            key: parsed.key,
            total: all.length,
            average, // out of 10
            histogram, // [1★ … 5★]
            mine,
            importing,
            items: page.map((r) => serializeReview(r, ctx, users, counts.get(r.id) || 0)),
        });
    } catch (err) {
        console.error("[Reviews] list error:", err);
        return res.status(500).json({ error: "Failed to load reviews" });
    }
}

async function createReview(req, res) {
    try {
        const parsed = parseKey(req.params.kind, req.params.tmdbId);
        if (!parsed) return res.status(400).json({ error: "Invalid title" });

        const rating = Number(req.body?.rating);
        if (!Number.isInteger(rating) || rating < 1 || rating > 10) return res.status(400).json({ error: "Pick a star rating", code: "BAD_RATING" });
        const content = cleanUserText(req.body?.content, MAX_REVIEW);
        if (content.length < MIN_REVIEW) return res.status(400).json({ error: `Write at least ${MIN_REVIEW} characters`, code: "TOO_SHORT" });

        const existing = await store.findUserReview(parsed.key, req.user.id);
        if (existing) return res.status(409).json({ error: "You already reviewed this title — edit your review instead", code: "ALREADY_REVIEWED", id: existing.id });

        // card info for titles that are not in the library (opened from a TMDB page) — only filled when nothing is known yet
        const known = await store.getTitle(parsed.key);
        if (!known?.title) {
            await store.upsertTitle(parsed.key, {
                title: typeof req.body?.title === "string" ? req.body.title.slice(0, 200) : null,
                poster: safeImage(req.body?.poster),
                backdrop: safeImage(req.body?.backdrop),
                type: parsed.kind === "movie" ? "movie" : "series",
                inLibrary: false,
                feedOk: false,
            });
        }

        const review = await store.addReview({ key: parsed.key, userId: req.user.id, author: { name: req.user.name || "User", avatar: req.user.avarter || null }, rating, content });
        invalidateFeeds();
        const ctx = viewerCtx(req);
        const users = await resolveUsers([req.user.id]);
        return res.status(201).json({ review: serializeReview(review, ctx, users, 0) });
    } catch (err) {
        if (err?.code === "ALREADY_REVIEWED") {
            // lost the race against a concurrent request from the same user
            return res.status(409).json({ error: "You already reviewed this title — edit your review instead", code: "ALREADY_REVIEWED", id: err.existing?.id });
        }
        console.error("[Reviews] create error:", err);
        return res.status(500).json({ error: "Failed to save review" });
    }
}

async function updateReview(req, res) {
    try {
        const r = await store.getReview(req.params.id);
        if (!r) return res.status(404).json({ error: "Review not found" });
        if (r.source !== "local" || r.userId !== req.user.id) return res.status(403).json({ error: "You can only edit your own review" });

        const patch = {};
        if (req.body?.rating !== undefined) {
            const rating = Number(req.body.rating);
            if (!Number.isInteger(rating) || rating < 1 || rating > 10) return res.status(400).json({ error: "Pick a star rating", code: "BAD_RATING" });
            patch.rating = rating;
        }
        if (req.body?.content !== undefined) {
            const content = cleanUserText(req.body.content, MAX_REVIEW);
            if (content.length < MIN_REVIEW) return res.status(400).json({ error: `Write at least ${MIN_REVIEW} characters`, code: "TOO_SHORT" });
            patch.content = content;
        }
        const updated = await store.updateReview(r.id, patch);
        invalidateFeeds();
        const users = await resolveUsers([req.user.id]);
        return res.json({ review: serializeReview(updated, viewerCtx(req), users, await store.replyCount(r.id)) });
    } catch (err) {
        console.error("[Reviews] update error:", err);
        return res.status(500).json({ error: "Failed to update review" });
    }
}

async function deleteReview(req, res) {
    try {
        const r = await store.getReview(req.params.id);
        if (!r) return res.status(404).json({ error: "Review not found" });
        if (r.userId !== req.user.id && !isAdmin(req)) return res.status(403).json({ error: "You can only delete your own review" });
        await store.removeReview(r.id);
        invalidateFeeds();
        return res.json({ ok: true });
    } catch (err) {
        console.error("[Reviews] delete error:", err);
        return res.status(500).json({ error: "Failed to delete review" });
    }
}

function parseReaction(body) {
    const t = body?.type;
    if (t === null) return { ok: true, type: null };
    if (typeof t === "string" && store.REACTION_TYPES.includes(t)) return { ok: true, type: t };
    return { ok: false };
}

async function reactReview(req, res) {
    try {
        const p = parseReaction(req.body);
        if (!p.ok) return res.status(400).json({ error: "Unknown reaction", code: "BAD_REACTION" });
        const r = await store.setReaction("review", req.params.id, req.user.id, p.type);
        if (!r) return res.status(404).json({ error: "Review not found" });
        invalidateFeeds();
        return res.json({ id: r.id, reactions: store.summarizeReactions(r.reactions, req.user.id) });
    } catch (err) {
        console.error("[Reviews] react error:", err);
        return res.status(500).json({ error: "Failed to react" });
    }
}

// ─── discussion (comments + replies) ──────────────────────────────────────────

async function getThread(req, res) {
    try {
        const r = await store.getReview(req.params.id);
        if (!r) return res.status(404).json({ error: "Review not found" });
        const ctx = viewerCtx(req);
        const replies = await store.listRepliesFor(r.id);
        const users = await resolveUsers([r.userId, ...replies.map((x) => x.userId)]);
        const byId = new Map(replies.map((x) => [x.id, x]));
        return res.json({
            review: serializeReview(r, ctx, users, replies.length),
            replies: replies.map((x) => serializeReply(x, ctx, users, byId)),
            media: mediaFull(r.key, await store.getTitle(r.key)),
        });
    } catch (err) {
        console.error("[Reviews] thread error:", err);
        return res.status(500).json({ error: "Failed to load discussion" });
    }
}

async function addReply(req, res) {
    try {
        const r = await store.getReview(req.params.id);
        if (!r) return res.status(404).json({ error: "Review not found" });
        const content = cleanUserText(req.body?.content, MAX_REPLY);
        if (!content) return res.status(400).json({ error: "Write something first", code: "EMPTY" });

        // `parentId` = the comment being answered. Two levels only (YouTube/Facebook style): an answer to an
        // answer attaches to the same top-level comment and remembers who it was aimed at.
        let parentId = null;
        let replyToId = null;
        if (req.body?.parentId) {
            const p = await store.getReply(String(req.body.parentId));
            if (!p || p.reviewId !== r.id) return res.status(404).json({ error: "Comment not found" });
            parentId = p.parentId || p.id;
            replyToId = p.parentId ? p.id : null;
        }

        const reply = await store.addReply({ reviewId: r.id, parentId, replyToId, userId: req.user.id, author: { name: req.user.name || "User", avatar: req.user.avarter || null }, content });
        invalidateFeeds();
        const all = await store.listRepliesFor(r.id);
        const users = await resolveUsers([req.user.id, ...all.map((x) => x.userId)]);
        return res.status(201).json({ reply: serializeReply(reply, viewerCtx(req), users, new Map(all.map((x) => [x.id, x]))), replyCount: all.length });
    } catch (err) {
        console.error("[Reviews] reply error:", err);
        return res.status(500).json({ error: "Failed to post" });
    }
}

async function updateReplyCtl(req, res) {
    try {
        const rp = await store.getReply(req.params.rid);
        if (!rp) return res.status(404).json({ error: "Comment not found" });
        if (rp.userId !== req.user.id) return res.status(403).json({ error: "You can only edit your own comment" });
        const content = cleanUserText(req.body?.content, MAX_REPLY);
        if (!content) return res.status(400).json({ error: "Write something first", code: "EMPTY" });
        const updated = await store.updateReply(rp.id, content);
        const all = await store.listRepliesFor(rp.reviewId);
        const users = await resolveUsers([req.user.id, ...all.map((x) => x.userId)]);
        return res.json({ reply: serializeReply(updated, viewerCtx(req), users, new Map(all.map((x) => [x.id, x]))) });
    } catch (err) {
        console.error("[Reviews] reply update error:", err);
        return res.status(500).json({ error: "Failed to update comment" });
    }
}

async function deleteReplyCtl(req, res) {
    try {
        const rp = await store.getReply(req.params.rid);
        if (!rp) return res.status(404).json({ error: "Comment not found" });
        if (rp.userId !== req.user.id && !isAdmin(req)) return res.status(403).json({ error: "You can only delete your own comment" });
        await store.removeReply(rp.id);
        invalidateFeeds();
        return res.json({ ok: true, replyCount: await store.replyCount(rp.reviewId) });
    } catch (err) {
        console.error("[Reviews] reply delete error:", err);
        return res.status(500).json({ error: "Failed to delete comment" });
    }
}

async function reactReply(req, res) {
    try {
        const p = parseReaction(req.body);
        if (!p.ok) return res.status(400).json({ error: "Unknown reaction", code: "BAD_REACTION" });
        const rp = await store.setReaction("reply", req.params.rid, req.user.id, p.type);
        if (!rp) return res.status(404).json({ error: "Comment not found" });
        invalidateFeeds();
        return res.json({ id: rp.id, reactions: store.summarizeReactions(rp.reactions, req.user.id) });
    } catch (err) {
        console.error("[Reviews] reply react error:", err);
        return res.status(500).json({ error: "Failed to react" });
    }
}

// ─── admin: import from TMDB right now ────────────────────────────────────────

async function syncOne(req, res) {
    try {
        if (!isAdmin(req)) return res.status(403).json({ error: "Admin only" });
        const parsed = parseKey(req.params.kind, req.params.tmdbId);
        if (!parsed) return res.status(400).json({ error: "Invalid title" });
        const r = await syncTitle(parsed, null);
        if (r === null) return res.status(502).json({ error: "TMDB did not answer (or an import is already running) — try again" });
        return res.json({ key: parsed.key, ...r });
    } catch (err) {
        console.error("[Reviews] sync error:", err);
        return res.status(500).json({ error: "Import failed" });
    }
}

async function syncAll(req, res) {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin only" });
    runSweep("manual");
    return res.json({ ok: true, message: "Import started in the background — see the server log." });
}

module.exports = {
    listTitleReviews,
    createReview,
    updateReview,
    deleteReview,
    reactReview,
    getThread,
    addReply,
    updateReplyCtl,
    deleteReplyCtl,
    reactReply,
    getPopular,
    getDiscussions,
    syncOne,
    syncAll,
    startReviewScheduler,
    stopReviewScheduler,
    flushReviews,
    freezeReviews,
};
