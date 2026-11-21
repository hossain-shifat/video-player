// src/Components/Media/ShareButton.jsx
//
// Reusable share trigger.
//   - Secure origin (https:// or localhost) + navigator.share available
//     → fires the REAL system share overlay (iOS/Android sheet, Windows
//       flyout, etc). This is a browser API call — Claude/React cannot draw
//       that UI; it's owned entirely by the OS.
//   - Otherwise (e.g. FLUX opened over http://<lan-ip> on a phone, where
//     navigator.share does not exist) → copies the link to the clipboard
//     (with an execCommand fallback that also works on http://) and shows a
//     temporary "Link copied!" toast next to the button.
//
// Stream mode — <ShareButton streamId={fileId} />
//   Instead of the page link it shares a SHORT STREAM LINK for external players (VLC, MX Player …):
//   the server creates http://host/s/<code>/<Title>.mkv (or …/h/stream.m3u8 with streamMode="hls") through
//   POST /stream/share/:id. That never starts a transcode, so it is safe while the file plays. Shown with
//   the system share sheet where the browser has one, otherwise copied; a toast reports the result either
//   way (and the error, e.g. nothing playable behind that id).
//
// navigator.share() MUST be called synchronously inside the click handler —
// browsers silently ignore it if called after an await/setTimeout/etc.

import { useCallback, useRef, useState } from "react";
import { Share2, Check, Loader2, AlertCircle } from "lucide-react";
import { getStreamUrl } from "../../Utils/shareMedia";

/** Clipboard write that also works on non-secure origins (plain http://). */
function copyToClipboard(text) {
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
 * ShareButton
 *
 * @param {string}  [title] - defaults to document.title
 * @param {string}  [text]  - optional share body text (native sheet only)
 * @param {string}  [url]   - defaults to window.location.href
 * @param {string}  [streamId]   - media FILE id: share its short stream link instead of the page link
 * @param {"direct"|"hls"} [streamMode] - which stream link: the file itself (default) or the .m3u8 playlist
 * @param {React.ElementType} [icon] - icon component, defaults to lucide Share2
 * @param {React.ReactNode} [children] - button label/content; defaults to icon-only
 * @param {...any} rest - spread onto the underlying <button> (className, style, disabled, aria-label, etc.)
 */
export default function ShareButton({ title, text, url, streamId, streamMode = "direct", icon: Icon = Share2, children, className = "", ...rest }) {
    const [toast, setToast] = useState(null); // { text, kind: "ok" | "error" }
    const [busy, setBusy] = useState(false);
    const hideTimer = useRef(null);

    const flash = useCallback((text, kind = "ok", ms = 2000) => {
        setToast({ text, kind });
        clearTimeout(hideTimer.current);
        hideTimer.current = setTimeout(() => setToast(null), ms);
    }, []);

    // Stream link for external players. The link only exists after the server answers, so this path awaits
    // first; share sheet if the browser allows it, clipboard otherwise.
    const shareStreamLink = useCallback(async () => {
        setBusy(true);
        try {
            let link;
            try {
                link = await getStreamUrl(streamId, { mode: streamMode });
            } catch (err) {
                const status = err?.response?.status;
                flash(status === 404 ? "Nothing playable here" : status === 403 ? "No access to this" : "Couldn't create link", "error", 3000);
                return;
            }
            if (navigator.share && window.isSecureContext) {
                try {
                    await navigator.share({ title: title || document.title, url: link });
                    return;
                } catch (err) {
                    if (err?.name === "AbortError") return; // user dismissed the sheet
                    // sheet blocked after the network wait → fall through to the clipboard
                }
            }
            try {
                await copyToClipboard(link);
                flash(streamMode === "hls" ? "HLS link copied!" : "Stream link copied!");
            } catch {
                flash("Couldn't copy the link", "error", 3000);
            }
        } finally {
            setBusy(false);
        }
    }, [streamId, streamMode, title, flash]);

    const handleClick = useCallback(async () => {
        if (streamId) return shareStreamLink();

        const shareData = {
            title: title || document.title,
            text: text || undefined,
            url: url || window.location.href,
        };

        // Must be synchronous-path: no await before this call.
        if (navigator.share && window.isSecureContext) {
            try {
                if (!navigator.canShare || navigator.canShare(shareData)) {
                    await navigator.share(shareData);
                    return;
                }
            } catch (err) {
                // AbortError = user dismissed the sheet — not a failure, do nothing.
                if (err?.name === "AbortError") return;
                // Any other error: fall through to clipboard fallback below.
            }
        }

        try {
            await copyToClipboard(shareData.url);
            flash("Link copied!");
        } catch {
            flash("Couldn't copy the link", "error", 3000);
        }
    }, [title, text, url, streamId, shareStreamLink, flash]);

    return (
        <span className="relative inline-flex">
            <button type="button" onClick={handleClick} disabled={busy} aria-label={rest["aria-label"] || "Share"} className={className} {...rest}>
                {busy ? <Loader2 size={17} className="animate-spin" /> : (children ?? <Icon size={17} />)}
            </button>

            {/* Toast — clipboard fallback / stream-link result / errors */}
            <span
                role="status"
                aria-live="polite"
                className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[oklch(15%_0.01_260/0.97)] text-white text-xs font-medium shadow-lg transition-all duration-150"
                style={{ opacity: toast ? 1 : 0, transform: toast ? "translate(-50%, 0)" : "translate(-50%, 4px)" }}>
                {toast?.kind === "error" ? <AlertCircle size={12} className="text-error" /> : <Check size={12} className="text-success" />}
                {toast?.text}
            </span>
        </span>
    );
}
