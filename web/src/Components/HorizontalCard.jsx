import { Link } from "react-router";

/**
 * HorizontalCard
 * --------------
 * Shared card shell — exact HistoryCard visual spec (gradient overlay,
 * badge, hover scale) pulled out so any card-row use case (Continue
 * Watching, Trailers, etc.) looks identical. Callers only supply their own
 * thumbnail/content — no layout/sizing decisions live outside this file.
 *
 * Props:
 *   to             — route string; renders a <Link> when present
 *   state          — react-router Link `state`, passed through (only with `to`)
 *   onClick        — click handler; used when `to` is omitted (renders a <div>)
 *   thumbnail      — ReactNode — image/fallback stack, fills the frame
 *   badge          — ReactNode — top-right pill (caller controls its own color/text)
 *   centerOverlay  — ReactNode — centered content over the thumbnail (e.g. play icon)
 *   progress       — 0-100 — renders the bottom seekbar when provided
 *   footerText     — ReactNode — text shown at the bottom of the thumbnail
 *   title          — ReactNode — main info line under the card
 *   menu           — ReactNode — right-aligned control under the card (e.g. ⋮ menu)
 *   ring           — bool (default true) — hover outline/ring; set false to disable it
 *   aspect         — "video" (default, 16:9, w-56 sm:w-64) | "poster" (2:3, w-40 sm:w-44 —
 *                    same size pairing MediaCard/MediaRow already use for poster art)
 */
export default function HorizontalCard({ to, state, onClick, thumbnail, badge, centerOverlay, progress, footerText, title, menu, ring = true, aspect = "video" }) {
    const Wrapper = to ? Link : "div";
    // Click-only cards render as keyboard-operable buttons: Enter / Space activate onClick.
    // target check keeps nested controls (e.g. the ⋮ menu) from also firing the card.
    const handleKeyDown = (e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick?.(e);
        }
    };
    const wrapperProps = to ? { to, state } : onClick ? { onClick, onKeyDown: handleKeyDown, role: "button", tabIndex: 0 } : {};
    const isPoster = aspect === "poster";

    return (
        <Wrapper {...wrapperProps} className={`relative shrink-0 ${isPoster ? "w-40 sm:w-44" : "w-56 sm:w-64"} cursor-pointer select-none no-underline my-2 ml-0.5`}>
            {/* ── Thumbnail ── */}
            <div
                className={`relative w-full ${isPoster ? "aspect-2/3" : "aspect-video"} rounded-xl overflow-hidden bg-base-300 shadow-lg transition-transform duration-200 hover:scale-[1.03] hover:shadow-2xl ${
                    ring ? "ring-1 ring-white/5 hover:ring-white/20" : ""
                }`}>
                {thumbnail}

                <div className="absolute inset-0 bg-linear-to-t from-black/55 via-transparent to-transparent" />

                {badge && <div className="absolute top-2 right-2 z-10">{badge}</div>}

                {centerOverlay && <div className="absolute inset-0 flex items-center justify-center z-10">{centerOverlay}</div>}

                {(footerText || progress != null) && (
                    <div className="absolute bottom-2 left-2 right-2 z-10">
                        {footerText && <p className="text-[11px] text-white/80 font-medium mb-1 truncate">{footerText}</p>}
                        {progress != null && (
                            <div className="relative h-1 rounded-full bg-white/25 overflow-hidden">
                                <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* ── Info ── */}
            <div className="flex justify-between items-start mt-2 px-0.5">
                <div className="flex-1 min-w-0">{title}</div>
                {menu}
            </div>
        </Wrapper>
    );
}
