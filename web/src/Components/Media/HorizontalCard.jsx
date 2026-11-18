import { Link } from "react-router";
import { useCardStyle } from "../../Pages/Settings/Components/shared";

/**
 * HorizontalCard
 * --------------
 * Shared shell for card rows (Continue Watching, Trailers, etc.). The design comes from
 * Settings → Appearance → Cards. Each design is one component below, registered in SHELLS.
 *
 * ADD A NEW DESIGN: write its component here, add it to SHELLS under the same id used in
 * MediaCard.jsx (POSTER_STYLES) — the name in Settings comes from there. A design with no
 * entry in SHELLS (and every poster-aspect card) uses the Classic shell.
 *
 * Classic props:
 *   to · state · onClick · thumbnail · badge · centerOverlay · progress · footerText · title
 *   menu (ReactNode) · renderMenu(buttonClassName) — lets each design style the ⋮ button
 *   ring · aspect ("video" default | "poster")
 * Rich props (flat designs; classic ignores them):
 *   tone ("primary" movie | "accent" series) · tag { text, icon } · tab · bottomTile
 *   heading · meta · completed
 * variant — design id to force (settings preview); otherwise follows the user setting.
 */

// ─── Classic (original design, default) ──────────────────────────────────────
const CLASSIC_MENU_BTN = "shrink-0 mt-0.5 mx-2 border-0 leading-none flex items-center justify-center rounded-md text-white/60 hover:text-white cursor-pointer transition-colors";

function ClassicHorizontalCard({ to, state, onClick, thumbnail, badge, centerOverlay, progress, footerText, title, menu, renderMenu, ring = true, aspect = "video" }) {
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
                {renderMenu ? renderMenu(CLASSIC_MENU_BTN) : menu}
            </div>
        </Wrapper>
    );
}

// ─── Flux ─────────────────────────────────────────────────────────────────────
const FLUX_MENU_BTN = "flex size-7 cursor-pointer items-center justify-center rounded-md border-none bg-base-200 text-base-content transition-colors hover:bg-base-100";
const TONE_BG = { primary: "bg-primary text-primary-content", accent: "bg-accent text-accent-content" };
const TONE_BAR = { primary: "bg-primary", accent: "bg-accent" };

function FluxHorizontalCard({ to, state, onClick, thumbnail, badge, progress, completed, title, menu, renderMenu, tag, tone = "primary", tab, bottomTile, heading, meta }) {
    const Wrapper = to ? Link : "div";
    const handleKeyDown = (e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick?.(e);
        }
    };
    const wrapperProps = to ? { to, state } : onClick ? { onClick, onKeyDown: handleKeyDown, role: "button", tabIndex: 0 } : {};
    const TagIcon = tag?.icon;
    const surface = "bg-base-200 group-hover:bg-base-300";

    return (
        <Wrapper {...wrapperProps} className="group relative my-2 ml-0.5 block w-56 shrink-0 cursor-pointer select-none no-underline sm:w-64">
            <div className="overflow-hidden rounded-lg bg-base-200 shadow-md transition-colors duration-150 group-hover:bg-base-300">
                {/* ── Frame ── */}
                <div className="relative aspect-video w-full overflow-hidden bg-base-300">
                    {thumbnail}

                    {/* top-left: type-coloured tag (or the caller's badge when no tag given) */}
                    {tag ? (
                        <div className="absolute left-2 top-2 z-10">
                            <span className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-mono text-[11px] font-medium uppercase leading-tight ${TONE_BG[tone] ?? TONE_BG.primary}`}>
                                {TagIcon && <TagIcon size={12} strokeWidth={3} />}
                                {tag.text}
                            </span>
                        </div>
                    ) : (
                        badge && <div className="absolute left-2 top-2 z-10">{badge}</div>
                    )}

                    {/* top-right: flush corner tab */}
                    {tab && <div className={`absolute right-0 top-0 z-10 flex items-center gap-1.5 rounded-bl-lg px-2.5 pb-1.5 pt-1.5 text-xs font-medium text-base-content ${surface}`}>{tab}</div>}

                    {/* bottom-left tile */}
                    {bottomTile && <div className={`absolute left-2 z-10 ${progress != null && !completed ? "bottom-3" : "bottom-2"}`}>{bottomTile}</div>}

                    {/* bottom-right: menu tile — hover on lg+, always on touch */}
                    {(renderMenu || menu) && <div className={`absolute right-2 z-10 opacity-100 transition-opacity duration-150 lg:opacity-0 lg:group-hover:opacity-100 ${progress != null && !completed ? "bottom-3" : "bottom-2"}`}>{renderMenu ? renderMenu(FLUX_MENU_BTN) : menu}</div>}

                    {/* resume bar — flush to the frame bottom */}
                    {progress != null && !completed && (
                        <div className={`absolute inset-x-0 bottom-0 z-10 h-0.75 ${surface}`}>
                            <div className={`h-full transition-all duration-300 ${TONE_BAR[tone] ?? TONE_BAR.primary}`} style={{ width: `${progress}%` }} />
                        </div>
                    )}
                </div>

                {/* ── Footer: one line ── */}
                <div className="flex items-baseline justify-between gap-2 px-2.5 py-1.5">
                    <div className="min-w-0 flex-1 truncate text-[13px] font-medium leading-tight text-base-content">{heading ?? title}</div>
                    {meta && <p className="shrink-0 font-mono text-[11px] uppercase tracking-wide text-base-content/80">{meta}</p>}
                </div>
            </div>
        </Wrapper>
    );
}

// ─── Registry + entry point ───────────────────────────────────────────────────
const SHELLS = {
    classic: ClassicHorizontalCard,
    flux: FluxHorizontalCard,
};

export default function HorizontalCard({ variant, ...props }) {
    const global = useCardStyle();
    const Shell = props.aspect === "poster" ? SHELLS.classic : (SHELLS[variant ?? global] ?? SHELLS.classic);
    return <Shell {...props} />;
}
