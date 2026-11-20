// web/src/Hooks/Query/useReviews.js
// TanStack Query hooks for the review system (/api/reviews). Same pattern as useHistory / useWatchlist.
//
// Reads are public. Writes need a signed-in, verified, approved account — the server answers 401/403 with
// a readable `error.message` (and `error.apiCode`) which the UI shows as-is.
// Reactions are OPTIMISTIC: the emoji and the counts change instantly and roll back if the server refuses.

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../Auth/AuthContext";
import { getTitleReviews, createReview, updateReview, deleteReview, reactToReview, getReviewThread, addReply, updateReply, deleteReply, reactToReply, getPopularReviews, getPopularDiscussions } from "../../Api/reviews";

export const REVIEW_KEYS = {
    all: ["reviews"],
    title: (kind, tmdbId, sort, limit) => ["reviews", "title", kind, String(tmdbId), sort, limit],
    thread: (id) => ["reviews", "thread", id],
    popular: ["popular", "reviews"],
    discussions: ["popular", "discussions"],
};

/** The reaction summary after the viewer picks `type` (null = remove): { counts, total, mine } */
export function applyReaction(sum, type) {
    const s = sum || { counts: {}, total: 0, mine: null };
    const counts = { ...s.counts };
    let total = s.total || 0;
    if (s.mine) {
        counts[s.mine] = (counts[s.mine] || 1) - 1;
        if (counts[s.mine] <= 0) delete counts[s.mine];
        total -= 1;
    }
    if (type) {
        counts[type] = (counts[type] || 0) + 1;
        total += 1;
    }
    return { counts, total, mine: type || null };
}

// write a new reaction summary into every cached list / thread that contains the item
function patchReactions(qc, id, summary) {
    qc.setQueriesData({ queryKey: REVIEW_KEYS.all }, (old) => {
        if (!old) return old;
        if (Array.isArray(old.items)) return { ...old, items: old.items.map((r) => (r.id === id ? { ...r, reactions: summary } : r)) };
        if (old.review) return { ...old, review: old.review.id === id ? { ...old.review, reactions: summary } : old.review, replies: (old.replies || []).map((x) => (x.id === id ? { ...x, reactions: summary } : x)) };
        return old;
    });
}

// ─── reads ────────────────────────────────────────────────────────────────────

/** Reviews of one title. Polls every 4 s while the server is still doing its first TMDB import of this title. */
export function useTitleReviews(kind, tmdbId, { sort = "top", limit = 24 } = {}) {
    const [importing, setImporting] = useState(false);
    const q = useQuery({
        queryKey: REVIEW_KEYS.title(kind, tmdbId, sort, limit),
        queryFn: () => getTitleReviews(kind, tmdbId, { sort, limit }),
        enabled: Boolean(tmdbId),
        staleTime: 30 * 1000,
        refetchInterval: importing ? 4000 : false,
    });
    useEffect(() => {
        setImporting(Boolean(q.data?.importing));
    }, [q.data?.importing, q.dataUpdatedAt]);
    return q;
}

export function useReviewThread(id, enabled = true) {
    return useQuery({ queryKey: REVIEW_KEYS.thread(id), queryFn: () => getReviewThread(id), enabled: Boolean(id) && enabled, staleTime: 15 * 1000 });
}

/** Home rows. kind = "reviews" | "discussions". Hidden by the component when empty. */
export function usePopularFeed(kind, enabled = true) {
    // The feed carries the VIEWER's own reaction (`mine`), so each account needs its own cache entry — otherwise a
    // second account on the same browser would briefly see the previous one's reactions. (["popular"] prefix still matches.)
    const { user } = useAuth();
    const viewer = user?.id ?? "anon";
    return useQuery({
        queryKey: [...(kind === "reviews" ? REVIEW_KEYS.popular : REVIEW_KEYS.discussions), viewer],
        queryFn: kind === "reviews" ? getPopularReviews : getPopularDiscussions,
        enabled,
        select: (d) => d?.items ?? [],
        staleTime: 5 * 60 * 1000,
    });
}

// ─── writes ───────────────────────────────────────────────────────────────────

function useRefreshAfterWrite() {
    const qc = useQueryClient();
    return (reviewId) => {
        qc.invalidateQueries({ queryKey: ["reviews", "title"] });
        if (reviewId) qc.invalidateQueries({ queryKey: REVIEW_KEYS.thread(reviewId) });
        qc.invalidateQueries({ queryKey: ["popular"] });
    };
}

export function useCreateReview(kind, tmdbId) {
    const refresh = useRefreshAfterWrite();
    return useMutation({ mutationFn: (body) => createReview(kind, tmdbId, body), onSuccess: () => refresh() });
}

export function useUpdateReview() {
    const refresh = useRefreshAfterWrite();
    return useMutation({ mutationFn: ({ id, ...body }) => updateReview(id, body), onSuccess: (_, v) => refresh(v.id) });
}

export function useDeleteReview() {
    const refresh = useRefreshAfterWrite();
    return useMutation({ mutationFn: (id) => deleteReview(id), onSuccess: (_, id) => refresh(id) });
}

// Home rows (cache = { total, items }): write the new reaction into the card IN PLACE — no refetch, so the row never re-ranks,
// shows no skeleton and the page never jumps. (The server re-ranks on the next normal load.)
function patchFeeds(qc, res) {
    if (!res?.id || !res.reactions) return;
    qc.setQueriesData({ queryKey: ["popular"] }, (old) => {
        if (!old || !Array.isArray(old.items)) return old;
        return { ...old, items: old.items.map((it) => (it.id === res.id ? { ...it, mine: res.reactions.mine, likes: res.reactions.total } : it)) };
    });
}

/**
 * One hook for both targets: mutate({ kind: "review" | "reply", id, type })
 * keepFeedOrder (default true) → the Home feed cache is patched in place instead of refetched, so a reaction never re-ranks a row,
 * shows a skeleton or moves the scroll position anywhere (details page, review page, discussion page, Home). Pass false to refetch it.
 */
export function useReact({ keepFeedOrder = true } = {}) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ kind, id, type }) => (kind === "review" ? reactToReview(id, type) : reactToReply(id, type)),
        onMutate: async ({ id, type }) => {
            await qc.cancelQueries({ queryKey: REVIEW_KEYS.all });
            // find the current summary of the item in any cached list/thread
            let cur = null;
            for (const [, data] of qc.getQueriesData({ queryKey: REVIEW_KEYS.all })) {
                if (!data) continue;
                if (Array.isArray(data.items)) cur = cur || data.items.find((r) => r.id === id)?.reactions;
                if (data.review) cur = cur || (data.review.id === id ? data.review.reactions : data.replies?.find((x) => x.id === id)?.reactions);
            }
            patchReactions(qc, id, applyReaction(cur, type));
            return { id, prev: cur }; // per-mutation context: overlapping reactions can no longer roll each other back
        },
        onError: (_err, _vars, ctx) => {
            // undo ONLY this item's optimistic change (never whole stale query objects), then let the server decide
            if (ctx?.prev) patchReactions(qc, ctx.id, ctx.prev);
            qc.invalidateQueries({ queryKey: REVIEW_KEYS.all });
        },
        onSuccess: (res) => {
            if (res?.id && res.reactions) patchReactions(qc, res.id, res.reactions); // the server's numbers win
            if (keepFeedOrder) patchFeeds(qc, res);
            else qc.invalidateQueries({ queryKey: ["popular"] });
        },
    });
}

export function useAddReply(reviewId) {
    const refresh = useRefreshAfterWrite();
    return useMutation({ mutationFn: (body) => addReply(reviewId, body), onSuccess: () => refresh(reviewId) });
}

export function useUpdateReply(reviewId) {
    const refresh = useRefreshAfterWrite();
    return useMutation({ mutationFn: ({ id, content }) => updateReply(id, content), onSuccess: () => refresh(reviewId) });
}

export function useDeleteReply(reviewId) {
    const refresh = useRefreshAfterWrite();
    return useMutation({ mutationFn: (id) => deleteReply(id), onSuccess: () => refresh(reviewId) });
}
