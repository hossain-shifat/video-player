// ============================================================================
// PopularDiscussions.jsx — Plex-style "Popular Discussions" row for the HOME page.
// File: web/src/Components/Media/PopularDiscussions.jsx
//
//   <PopularDiscussions />            ← fetches its own data, hides itself when there is none
//   <PopularDiscussions items={[...]} loading />   ← or render your own list
//
// Which reviews show up here: the ones people react to and reply to the most (score = reactions + 3 × replies),
// one per title, taken from this server's reviews.json (GET /api/reviews/discussions). Until there is enough
// activity, the best imported TMDB reviews fill the row — opening one and replying is what starts a real discussion.
//
// Same tall card as Popular Reviews (PopularCardShell in Reviews.jsx): bold headline + short excerpt instead of
// big stars, reaction count and reply count in the footer. Click → the discussion page (/discussion/:id, Pages/Discussion/DiscussionPage.jsx).
//
// item shape (likes = REAL total; the card seeds it for display): { id (review id), title (headline), body, author, avatar?, rating?, createdAt, likes, comments,
//               media: { id, title, backdrop?, poster?, logo? } }
// ============================================================================

import { useNavigate } from "react-router";
import { PopularCardShell, PopularRow, usePopularFeed } from "./Reviews";

export default function PopularDiscussions({ items, loading, title = "Popular Discussions" }) {
    const feed = usePopularFeed("discussions", items === undefined);
    const rows = items ?? feed.data ?? [];
    const busy = loading ?? (items === undefined && feed.isLoading);
    const navigate = useNavigate();

    return (
        <>
            <PopularRow
                title={title}
                items={rows}
                loading={busy}
                renderCard={(it) => (
                    <PopularCardShell
                        key={it.id}
                        id={it.id}
                        mine={it.mine}
                        media={it.media}
                        headline={it.title}
                        body={it.body}
                        bodyLines={2}
                        author={it.author}
                        avatar={it.avatar}
                        date={it.createdAt}
                        likes={it.likes}
                        comments={it.comments}
                        onMore={() => navigate(`/discussion/${it.id}`)}
                    />
                )}
            />
        </>
    );
}
