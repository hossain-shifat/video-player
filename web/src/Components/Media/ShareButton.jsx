// src/Components/ShareButton.jsx
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
// navigator.share() MUST be called synchronously inside the click handler —
// browsers silently ignore it if called after an await/setTimeout/etc.

import { useCallback, useRef, useState } from "react";
import { Share2, Check } from "lucide-react";

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
 * @param {React.ElementType} [icon] - icon component, defaults to lucide Share2
 * @param {React.ReactNode} [children] - button label/content; defaults to icon-only
 * @param {...any} rest - spread onto the underlying <button> (className, style, disabled, aria-label, etc.)
 */
export default function ShareButton({ title, text, url, icon: Icon = Share2, children, className = "", ...rest }) {
    const [copied, setCopied] = useState(false);
    const hideTimer = useRef(null);

    const handleClick = useCallback(async () => {
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
            setCopied(true);
            clearTimeout(hideTimer.current);
            hideTimer.current = setTimeout(() => setCopied(false), 2000);
        } catch {
            // Clipboard also unavailable — nothing more we can do silently.
        }
    }, [title, text, url]);

    return (
        <span className="relative inline-flex">
            <button type="button" onClick={handleClick} aria-label={rest["aria-label"] || "Share"} className={className} {...rest}>
                {children ?? <Icon size={17} />}
            </button>

            {/* Toast — only rendered on the clipboard-fallback path */}
            <span
                role="status"
                aria-live="polite"
                className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[oklch(15%_0.01_260/0.97)] text-white text-xs font-medium shadow-lg transition-all duration-150"
                style={{ opacity: copied ? 1 : 0, transform: copied ? "translate(-50%, 0)" : "translate(-50%, 4px)" }}>
                <Check size={12} className="text-success" />
                Link copied!
            </span>
        </span>
    );
}
