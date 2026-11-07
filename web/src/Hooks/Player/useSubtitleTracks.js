// useSubtitleTracks.js
//
// FIX: this hook used to live inside SubtitleRenderer.jsx alongside its
// default-exported component. Vite's React Fast Refresh requires a file to
// export ONLY components to do a fine-grained hot update — a plain hook
// export mixed in forces a full page reload on every edit instead (the
// exact "useSubtitleTracks export is incompatible" warning). Moving it here
// (same pattern already used for PlayerConstants.js, split out of
// VideoSidebar.jsx for this identical reason) fixes it with no behavior
// change. Not currently imported anywhere else in the app, but kept
// standalone so future consumers don't reintroduce the same problem by
// importing it back out of SubtitleRenderer.jsx.

import { useEffect, useState } from "react";

// Backend base URL — subtitle URLs from the API are relative paths like
// /stream/subtitle/embedded/... and must be absolutified before fetch.
// Without this, the browser hits the Vite dev server which returns index.html.
const BACKEND = import.meta.env.VITE_API_URL || "http://localhost:5000";

function absoluteUrl(url) {
    if (!url) return url;
    if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("blob:") || url.startsWith("data:")) return url;
    return `${BACKEND}${url}`;
}

// ─── Subtitle track list (embedded + external + downloaded) ─────────────────
//
// GET /api/media/:id/subtitles → { subtitles: [{ source, lang, label, ext,
//   url, filename?, forced?, trackIndex?, codec? }] }
//
// `source` is one of: "embedded" | "external" | "downloaded"
// Exposed via this hook so the player's settings/track-picker UI can list
// and switch between all available subtitle tracks for a media item.

export function useSubtitleTracks(mediaId) {
    const [tracks, setTracks] = useState([]);
    const [loadingTracks, setLoadingTracks] = useState(false);

    useEffect(() => {
        if (!mediaId) {
            setTracks([]);
            return;
        }
        const ctrl = new AbortController();
        setLoadingTracks(true);
        fetch(absoluteUrl(`/api/media/${mediaId}/subtitles`), { signal: ctrl.signal })
            .then((r) => r.json())
            .then((data) => setTracks(data?.subtitles || []))
            .catch((err) => {
                if (err.name !== "AbortError") setTracks([]);
            })
            .finally(() => setLoadingTracks(false));
        return () => ctrl.abort();
    }, [mediaId]);

    return { tracks, loadingTracks };
}
