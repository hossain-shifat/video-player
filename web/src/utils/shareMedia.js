/**
 * shareMedia.js — common share/copy logic for MediaCard, HistoryCard, MediaDetails.
 *
 * copyToClipboard — navigator.clipboard.writeText silently throws (or is
 * undefined) on a non-secure origin. FLUX is almost always served over plain
 * http:// on the local network, so mobile Chrome has neither navigator.share
 * nor navigator.clipboard there. execCommand('copy') via a hidden textarea
 * still works on http:// and is the real fix.
 */
export function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
        try {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.style.position = "fixed";
            ta.style.top = "-1000px";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            const ok = document.execCommand("copy");
            document.body.removeChild(ta);
            ok ? resolve() : reject(new Error("execCommand copy failed"));
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * shareMedia — navigator.share MUST fire synchronously inside the click
 * handler (deferred calls get silently blocked by browsers), and only exists
 * on secure origins. Falls back to copyToClipboard when unavailable (the
 * common case for a local-network http:// deployment).
 *
 * Share payload is URL-ONLY (no title/text) — some share targets prepend
 * title/text before the link; dropping them means only the link shows.
 *
 * poster (optional) — image URL. If Web Share API supports files
 * (navigator.canShare({files})), poster fetched as blob + attached to the
 * share so the OS share sheet shows the movie poster instead of the site
 * favicon/logo. Falls back to url-only share/copy if file share unsupported
 * or the poster fetch fails (e.g. CORS-blocked image host).
 *
 * Returns a Promise resolving to "shared" | "copied", rejects only if both
 * paths fail.
 */
export async function shareMedia({ url, poster }) {
    if (navigator.share && window.isSecureContext) {
        const payload = { url };

        if (poster) {
            try {
                const res = await fetch(poster, { mode: "cors" });
                if (res.ok) {
                    const blob = await res.blob();
                    const file = new File([blob], "poster.jpg", { type: blob.type || "image/jpeg" });
                    if (navigator.canShare?.({ files: [file] })) {
                        payload.files = [file];
                    }
                }
            } catch {
                // poster fetch/attach failed (often CORS) — fall through to url-only share
            }
        }

        return navigator.share(payload).then(() => "shared");
    }
    return copyToClipboard(url).then(() => "copied");
}

/**
 * getStreamUrl — the ONE place that decides "what is the actual playable
 * link for this file right now". Calls resolvePlayback() (the exact same
 * call the player itself makes: GET /stream/video/:id?info=1) and returns:
 *   - direct file  → the real /stream/video/:id URL (stable, no session)
 *   - HLS file     → the absolute .m3u8 URL from the freshly-created session
 *                     (e.g. http://192.168.0.159:5000/stream/hls/<id>/master.m3u8)
 *
 * Copy Stream Link and Share Stream both call this so they always produce
 * the exact same link.
 */
export async function getStreamUrl(id) {
    const { resolvePlayback } = await import("../api/stream");
    const info = await resolvePlayback(id);
    const url = info.mode === "hls" ? info.hlsUrl : info.streamUrl;
    if (!url) throw new Error("no playable stream url");
    return url;
}

/** shareStream — shares the real link from getStreamUrl(). */
export async function shareStream({ id, poster }) {
    const url = await getStreamUrl(id);
    return shareMedia({ url, poster });
}
