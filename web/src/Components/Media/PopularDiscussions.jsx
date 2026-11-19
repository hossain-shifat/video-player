import { useNavigate } from "react-router";
import { PopularCardShell, PopularRow, usePopularFeed } from "./Reviews";
import { seedCount } from "./ReviewThread";

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
                        likes={seedCount(it.likes, it.id)}
                        comments={it.comments}
                        onMore={() => navigate(`/discussion/${it.id}`)}
                    />
                )}
            />
        </>
    );
}
