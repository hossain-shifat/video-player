// ============================================================================
// PopularDiscussions.jsx — Plex-style "Popular Discussions" row.
// File: web/src/Components/Media/PopularDiscussions.jsx
//
//   <PopularDiscussions />            ← Home page: fetches its own data, hides itself when there is none
//   <PopularDiscussions items={[...]} loading />   ← or render your own list
//
// Same tall card as Popular Reviews (PopularCardShell in Reviews.jsx) — only the
// content differs: a bold thread headline + short excerpt instead of big stars.
//
// item shape:
//   { id, title (thread headline), body, author, avatar?, createdAt,
//     likes?, comments?, rating? (0–10, shown inside the "More" modal),
//     media: { id, title, backdrop?, poster?, logo? } }
//
// Data: GET /api/media/popular-discussions (server-side cache, needs TRAKT_CLIENT_ID — see metadataController.js).
// ============================================================================

import { useState } from "react";
import { PopularCardShell, PopularRow, ReviewModal, popularToModalShape, usePopularFeed } from "./Reviews";

export default function PopularDiscussions({ items, loading, title = "Popular Discussions" }) {
    const feed = usePopularFeed("discussions", items === undefined);
    const rows = items ?? feed.data ?? [];
    const busy = loading ?? (items === undefined && feed.isLoading);
    const [open, setOpen] = useState(null);

    return (
        <>
            <PopularRow
                title={title}
                items={rows}
                loading={busy}
                renderCard={(it) => (
                    <PopularCardShell
                        key={it.id}
                        media={it.media}
                        headline={it.title}
                        body={it.body}
                        bodyLines={2}
                        author={it.author}
                        avatar={it.avatar}
                        date={it.createdAt}
                        likes={it.likes}
                        comments={it.comments}
                        onMore={() => setOpen(it)}
                    />
                )}
            />
            {open && <ReviewModal data={popularToModalShape({ ...open, content: open.body }, open.title)} onClose={() => setOpen(null)} />}
        </>
    );
}
