import { Link } from "react-router";
import { useState } from "react";
import { Tv } from "lucide-react";

// ─── Thumbnail fallback ──────────────────────────────────────────────────────
function ThumbFallback({ title }) {
    return (
        <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-linear-to-br from-base-300 to-base-200">
            <Tv size={24} className="text-base-content/25" />
            <span className="text-base-content/40 text-xs font-semibold text-center px-3 leading-tight line-clamp-1">{title}</span>
        </div>
    );
}

// ─── Programme-time helpers ───────────────────────────────────────────────────
function getProgress(current) {
    if (!current?.start || !current?.end) return null;
    const start = new Date(current.start).getTime();
    const end = new Date(current.end).getTime();
    const now = Date.now();
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
    if (now <= start) return 0;
    if (now >= end) return 100;
    return ((now - start) / (end - start)) * 100;
}

function getTimeLeft(current) {
    if (!current?.end) return null;
    const end = new Date(current.end).getTime();
    if (Number.isNaN(end)) return null;
    const mins = Math.max(0, Math.round((end - Date.now()) / 60000));
    if (mins < 1) return "Ending now";
    if (mins < 60) return `${mins}m left`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m left`;
}

// ─── base64url helpers — same pattern as server/utils/fileHelpers.js's
// generateFileId/decodeFileId. encodeURIComponent in a route segment is
// fragile here: stream urls contain %2F-encoded slashes that some router
// internals can re-encode or mis-split, producing the garbled address-bar
// url you saw. base64url has no '%' or '/' at all — clean, safe, no ambiguity.
function toBase64Url(str) {
    const b64 = btoa(unescape(encodeURIComponent(str)));
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ─── LiveCard ─────────────────────────────────────────────────────────────────
// FIX: route used to be /live/watch/:slug where slug was derived from the
// channel NAME (or a possibly-unstable item.id) — LivePlayerPage would then
// re-fetch by that slug via getLiveChannel(id) on refresh/direct-link, and
// the slug almost never matched a real backend record → wrong/empty url →
// Hls.js fed garbage. Fix: encode the REAL stream url straight into the path
// param. It's the single source of truth now — no id lookup, nothing to
// mismatch, survives refresh/copy-paste of the link too.
export default function LiveCard({ item }) {
    const [imgError, setImgError] = useState(false);

    const programme = item.current;
    const title = programme?.title || item.name;
    const progress = getProgress(programme);
    const timeLeft = getTimeLeft(programme);
    const thumb = programme?.thumbnail || item.logo;

    return (
        <Link
            to={`/live/watch/${toBase64Url(item.url)}`}
            state={{ streamUrl: item.url, channelName: item.name, channelLogo: item.logo }} // instant-load hint only — base64url param is the real source of truth
            className="group relative shrink-0 w-56 sm:w-64 cursor-pointer select-none no-underline">
            {/* ── Thumbnail ── */}
            <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-base-300 shadow-lg ring-1 ring-white/5 transition-transform duration-200 group-hover:scale-[1.03] group-hover:shadow-2xl group-hover:ring-white/20">
                {thumb && !imgError ? (
                    <img
                        src={thumb}
                        alt={title}
                        className={`w-full h-full ${programme?.thumbnail ? "object-cover" : "object-fit bg-black/40"}`}
                        loading="lazy"
                        draggable={false}
                        onError={() => setImgError(true)}
                    />
                ) : (
                    <ThumbFallback title={title} />
                )}

                <div className="absolute inset-0 bg-linear-to-t from-black/55 via-transparent to-transparent" />

                <span className="absolute top-2 right-2 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-error/90 text-error-content">LIVE</span>

                {progress !== null && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/40">
                        <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
                    </div>
                )}
            </div>

            {/* ── Info ── */}
            <div className="mt-2 px-0.5">
                <p className="text-[13px] font-medium text-base-content truncate leading-tight">{title}</p>
                <p className="text-[11px] text-base-content/45 font-medium mt-1 truncate">{timeLeft || item.name}</p>
            </div>
        </Link>
    );
}
