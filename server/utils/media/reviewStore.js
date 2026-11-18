"use strict";

// ============================================================================
// reviewStore.js — the review system's own storage (server/data/media/reviews.json)
//
// Reviews, replies and reactions used to be (partly) metadata. They now live here, separate from
// metadata.json, in one JSON file with the same safe-write pattern as trailerStore.js / metadataStore.js
// (temp file → fsync → rename, so a crash can never leave a half-written file).
//
//   {
//     "version": 1,
//     "titles":  { "movie:603": { title, backdrop, poster, logo, type, fileId, inLibrary, feedOk, syncedAt } },
//     "reviews": { "<id>": Review },
//     "replies": { "<id>": Reply }
//   }
//
//   Review = { id, key, source: "tmdb" | "local", externalId, userId, author: {name, avatar},
//              rating (0–10 | null), content, createdAt, updatedAt, edited, reactions: { [userId]: type } }
//   Reply  = { id, reviewId, parentId (top-level comment id | null), replyToId, userId, author, content,
//              createdAt, updatedAt, edited, reactions: { [userId]: type } }
//
// Imported TMDB reviews have userId = null: nobody can edit them, but everybody can react and reply.
// Reactions are one per user per item ({ userId: type }); people can switch or remove theirs.
// ============================================================================

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const STORE_FILE = path.join(__dirname, "..", "..", "data", "media", "reviews.json");

const REACTION_TYPES = ["like", "love", "funny", "wow", "sad", "dislike"];

let data = { version: 1, titles: {}, reviews: {}, replies: {} };
let loaded = false;
let loadPromise = null;

// in-memory indexes (rebuilt on load, kept in sync by every write below)
let byKey = new Map(); // titleKey → Set(reviewId)
let repliesByReview = new Map(); // reviewId → Set(replyId)

function rebuildIndexes() {
    byKey = new Map();
    repliesByReview = new Map();
    for (const r of Object.values(data.reviews)) {
        if (!byKey.has(r.key)) byKey.set(r.key, new Set());
        byKey.get(r.key).add(r.id);
    }
    for (const rp of Object.values(data.replies)) {
        if (!repliesByReview.has(rp.reviewId)) repliesByReview.set(rp.reviewId, new Set());
        repliesByReview.get(rp.reviewId).add(rp.id);
    }
}

async function loadStore() {
    if (loaded) return;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
        try {
            const raw = await fs.promises.readFile(STORE_FILE, "utf-8");
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") {
                data = {
                    version: 1,
                    titles: parsed.titles && typeof parsed.titles === "object" ? parsed.titles : {},
                    reviews: parsed.reviews && typeof parsed.reviews === "object" ? parsed.reviews : {},
                    replies: parsed.replies && typeof parsed.replies === "object" ? parsed.replies : {},
                };
            }
            console.log(`[Reviews] Loaded store (titles=${Object.keys(data.titles).length}, reviews=${Object.keys(data.reviews).length}, replies=${Object.keys(data.replies).length})`);
        } catch (err) {
            if (err.code !== "ENOENT") console.error("[Reviews] Failed to load store:", err.message);
            data = { version: 1, titles: {}, reviews: {}, replies: {} };
        } finally {
            rebuildIndexes();
            loaded = true;
            loadPromise = null;
        }
    })();
    return loadPromise;
}

// ─── persistence: debounced, single writer, atomic ────────────────────────────
let saveTimer = null;
let writing = Promise.resolve();

async function writeNow() {
    try {
        await fs.promises.mkdir(path.dirname(STORE_FILE), { recursive: true });
        const tmp = `${STORE_FILE}.tmp.${process.pid}.${Date.now()}`;
        const fd = await fs.promises.open(tmp, "w");
        try {
            await fd.writeFile(JSON.stringify(data), "utf-8"); // compact — no indent (same OOM lesson as the other stores)
            await fd.sync();
        } finally {
            await fd.close();
        }
        await fs.promises.rename(tmp, STORE_FILE);
    } catch (err) {
        console.error("[Reviews] Save failed:", err.message);
    }
}

function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        writing = writing.then(writeNow);
    }, 800);
    saveTimer.unref?.();
}

/** Write any pending change right now (used on shutdown). */
async function flush() {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
        writing = writing.then(writeNow);
    }
    await writing;
}

const newId = (prefix) => `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
const nowIso = () => new Date().toISOString();

// ─── reactions ────────────────────────────────────────────────────────────────

/** { counts: { like: 3, love: 1, … }, total, mine: type | null } — viewerId may be null (guest) */
function summarizeReactions(map, viewerId) {
    const counts = {};
    let total = 0;
    for (const type of Object.values(map || {})) {
        if (!REACTION_TYPES.includes(type)) continue;
        counts[type] = (counts[type] || 0) + 1;
        total++;
    }
    return { counts, total, mine: viewerId && map?.[viewerId] ? map[viewerId] : null };
}

// ─── titles (info for the cards + sync bookkeeping) ───────────────────────────

async function getTitle(key) {
    await loadStore();
    return data.titles[key] || null;
}

async function upsertTitle(key, patch) {
    await loadStore();
    data.titles[key] = { ...(data.titles[key] || {}), ...patch };
    scheduleSave();
    return data.titles[key];
}

async function allTitles() {
    await loadStore();
    return data.titles;
}

// ─── reviews ──────────────────────────────────────────────────────────────────

async function getReview(id) {
    await loadStore();
    return data.reviews[id] || null;
}

async function listReviewsFor(key) {
    await loadStore();
    return [...(byKey.get(key) || [])].map((id) => data.reviews[id]).filter(Boolean);
}

async function allReviews() {
    await loadStore();
    return Object.values(data.reviews);
}

async function findUserReview(key, userId) {
    await loadStore();
    for (const id of byKey.get(key) || []) {
        const r = data.reviews[id];
        if (r && r.userId === userId) return r;
    }
    return null;
}

async function addReview({ key, userId, author, rating, content }) {
    await loadStore();
    const t = nowIso();
    const review = { id: newId("rv"), key, source: "local", externalId: null, userId, author, rating, content, createdAt: t, updatedAt: t, edited: false, reactions: {} };
    data.reviews[review.id] = review;
    if (!byKey.has(key)) byKey.set(key, new Set());
    byKey.get(key).add(review.id);
    scheduleSave();
    return review;
}

async function updateReview(id, patch) {
    await loadStore();
    const r = data.reviews[id];
    if (!r) return null;
    if (patch.rating !== undefined) r.rating = patch.rating;
    if (patch.content !== undefined) r.content = patch.content;
    r.updatedAt = nowIso();
    r.edited = true;
    scheduleSave();
    return r;
}

/** Deletes the review and every reply under it. */
async function removeReview(id) {
    await loadStore();
    const r = data.reviews[id];
    if (!r) return false;
    for (const rid of repliesByReview.get(id) || []) delete data.replies[rid];
    repliesByReview.delete(id);
    byKey.get(r.key)?.delete(id);
    delete data.reviews[id];
    scheduleSave();
    return true;
}

/**
 * TMDB import — idempotent. A review is identified by its TMDB id, so re-running never duplicates and never
 * touches reactions or replies; only the TMDB-owned fields (text, rating, name, avatar) are refreshed.
 * items: [{ externalId, author, avatar, rating, content, createdAt, updatedAt }]  (content already cleaned)
 */
async function importReviews(key, items) {
    await loadStore();
    let added = 0;
    let updated = 0;
    for (const it of items) {
        const id = `tmdb_${it.externalId}`;
        const existing = data.reviews[id];
        if (!existing) {
            data.reviews[id] = {
                id,
                key,
                source: "tmdb",
                externalId: it.externalId,
                userId: null,
                author: { name: it.author, avatar: it.avatar || null },
                rating: it.rating ?? null,
                content: it.content,
                createdAt: it.createdAt || nowIso(),
                updatedAt: it.updatedAt || it.createdAt || nowIso(),
                edited: false,
                reactions: {},
            };
            if (!byKey.has(key)) byKey.set(key, new Set());
            byKey.get(key).add(id);
            added++;
        } else if (existing.content !== it.content || existing.rating !== (it.rating ?? null) || existing.author?.name !== it.author) {
            existing.content = it.content;
            existing.rating = it.rating ?? null;
            existing.author = { name: it.author, avatar: it.avatar || existing.author?.avatar || null };
            existing.updatedAt = it.updatedAt || existing.updatedAt;
            updated++;
        }
    }
    if (added || updated) scheduleSave();
    return { added, updated };
}

// ─── replies (top-level comments + their replies) ─────────────────────────────

async function getReply(id) {
    await loadStore();
    return data.replies[id] || null;
}

async function listRepliesFor(reviewId) {
    await loadStore();
    return [...(repliesByReview.get(reviewId) || [])]
        .map((id) => data.replies[id])
        .filter(Boolean)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function replyCount(reviewId) {
    await loadStore();
    return repliesByReview.get(reviewId)?.size || 0;
}

async function addReply({ reviewId, parentId, replyToId, userId, author, content }) {
    await loadStore();
    const t = nowIso();
    const reply = { id: newId("rp"), reviewId, parentId: parentId || null, replyToId: replyToId || null, userId, author, content, createdAt: t, updatedAt: t, edited: false, reactions: {} };
    data.replies[reply.id] = reply;
    if (!repliesByReview.has(reviewId)) repliesByReview.set(reviewId, new Set());
    repliesByReview.get(reviewId).add(reply.id);
    scheduleSave();
    return reply;
}

async function updateReply(id, content) {
    await loadStore();
    const rp = data.replies[id];
    if (!rp) return null;
    rp.content = content;
    rp.updatedAt = nowIso();
    rp.edited = true;
    scheduleSave();
    return rp;
}

/** Deleting a top-level comment deletes the replies under it as well. */
async function removeReply(id) {
    await loadStore();
    const rp = data.replies[id];
    if (!rp) return false;
    const set = repliesByReview.get(rp.reviewId);
    const doomed = [id];
    if (!rp.parentId) for (const other of set || []) if (data.replies[other]?.parentId === id) doomed.push(other);
    for (const d of doomed) {
        set?.delete(d);
        delete data.replies[d];
    }
    scheduleSave();
    return true;
}

// ─── reactions on either kind ─────────────────────────────────────────────────

/** type = one of REACTION_TYPES, or null to remove the user's reaction. Returns the updated item. */
async function setReaction(kind, id, userId, type) {
    await loadStore();
    const item = kind === "review" ? data.reviews[id] : data.replies[id];
    if (!item) return null;
    if (!item.reactions) item.reactions = {};
    if (type === null || type === undefined) delete item.reactions[userId];
    else item.reactions[userId] = type;
    scheduleSave();
    return item;
}

module.exports = {
    REACTION_TYPES,
    loadStore,
    flush,
    summarizeReactions,
    getTitle,
    upsertTitle,
    allTitles,
    getReview,
    listReviewsFor,
    allReviews,
    findUserReview,
    addReview,
    updateReview,
    removeReview,
    importReviews,
    getReply,
    listRepliesFor,
    replyCount,
    addReply,
    updateReply,
    removeReply,
    setReaction,
};
