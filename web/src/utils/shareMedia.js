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
 * getStreamLinks / getStreamUrl — the ONE place that decides "what link do I hand to an external player".
 * Asks the server for a share link (POST /stream/share/:id) and returns its short URLs:
 *   direct  → http://host/s/<12 chars>/<Title>.mkv   the file itself (best for VLC / MX Player: any codec, seekable)
 *   hls     → http://host/s/<12 chars>/h/stream.m3u8  HLS, for players that want an .m3u8
 * Unlike the old resolvePlayback() route this never starts a transcode session, so it is safe to call while
 * the file is playing. The link works without logging in (the code is the credential) until it expires.
 * Copy Stream Link, Share Stream and the Info panel all go through here, so they always give the same link.
 */
export async function getStreamLinks(id, opts) {
    const { createShareLink } = await import("../Api/stream");
    const r = await createShareLink(id, opts);
    if (!r?.urls?.direct) throw new Error("no stream url");
    return { direct: r.urls.direct, hls: r.urls.hls, expiresAt: r.expiresAt, title: r.title, code: r.code };
}

export async function getStreamUrl(id, { mode = "direct", ttlHours } = {}) {
    const links = await getStreamLinks(id, { ttlHours });
    const url = mode === "hls" ? links.hls : links.direct;
    if (!url) throw new Error("no stream url");
    return url;
}

/** shareStream — shares the real link from getStreamUrl(). */
export async function shareStream({ id, poster }) {
    const url = await getStreamUrl(id);
    return shareMedia({ url, poster });
}
