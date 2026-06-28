import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft } from "lucide-react";

function useOrientation() {
    const [isLandscape, setIsLandscape] = useState(() => (typeof window === "undefined" ? true : window.innerWidth > window.innerHeight));
    useEffect(() => {
        const update = () => setIsLandscape(window.innerWidth > window.innerHeight);
        window.addEventListener("resize", update);
        window.addEventListener("orientationchange", update);
        return () => {
            window.removeEventListener("resize", update);
            window.removeEventListener("orientationchange", update);
        };
    }, []);
    return isLandscape;
}

/**
 * VideoSidebar — mobile-only slide-in panel replacing the old floating
 * dropdown menus. Landscape: slides from right, 40% width. Portrait:
 * slides from bottom, 40% height. PC keeps the old PopupMenu (caller's
 * job to render this only when isMobile).
 *
 * Stays open until manually closed (ArrowLeft button / tap outside) — never
 * auto-closes or fades on its own. This component has zero timers tied to
 * controlsPhase; the ONLY way it closes is the parent setting open=false.
 *
 * Rendered via createPortal(..., document.body) — REQUIRED. PlayerControls
 * is normally rendered inside a wrapper (in PlayerPage.jsx) that fades to
 * opacity:0 after 3s of inactivity. Without the portal, this component is a
 * normal DOM descendant of that wrapper, and CSS opacity on a parent visually
 * dims the WHOLE subtree at paint time — position:fixed only escapes layout,
 * not that opacity cascade. So even though this component's own `visible`
 * state never changed, it looked like it was "auto-fading after 3s": it was
 * actually just inheriting the controls layer's own fade. The portal moves
 * it to document.body, fully outside that wrapper, so it's now visually and
 * functionally independent of the controls' inactivity timer.
 *
 * data-gesture-exclude="true" on the outer overlay is REQUIRED: the player's
 * gesture layer (PlayerGestures.jsx) attaches native touchstart/touchend
 * listeners directly on the video container and only skips elements whose
 * closest ancestor carries this marker. Without it, taps here also register
 * as taps on the video underneath — causing double-tap-seek and other
 * gestures to fire through the sidebar.
 */
export default function VideoSidebar({ open, onClose, title, children }) {
    const isLandscape = useOrientation();
    // Mount/visible are split so closing plays an exit animation instead of
    // an instant unmount: open=true → mount immediately, animate in next
    // frame. open=false → animate out first, unmount only after the
    // transition finishes.
    const [mounted, setMounted] = useState(open);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (open) {
            setMounted(true);
            // Next frame so the initial render starts from the off-screen
            // position before transitioning — required for the slide-in to
            // actually animate instead of snapping straight to place.
            const id = requestAnimationFrame(() => setVisible(true));
            return () => cancelAnimationFrame(id);
        }
        setVisible(false);
        const id = setTimeout(() => setMounted(false), 260);
        return () => clearTimeout(id);
    }, [open]);

    useEffect(() => {
        if (!mounted) return;
        const onKey = (e) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [mounted, onClose]);

    if (!mounted) return null;

    const offscreenTransform = isLandscape ? "translateX(100%)" : "translateY(100%)";

    const panelStyle = isLandscape
        ? {
              position: "fixed",
              top: 0,
              right: 0,
              bottom: 0,
              width: "40%",
              boxShadow: "-20px 0 60px rgba(0,0,0,0.5)",
          }
        : {
              position: "fixed",
              left: 0,
              right: 0,
              bottom: 0,
              height: "40%",
              borderRadius: "16px 16px 0 0",
              boxShadow: "0 -20px 60px rgba(0,0,0,0.5)",
          };

    return createPortal(
        <div
            className="flux-sidebar-overlay"
            data-gesture-exclude="true"
            onClick={onClose}
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 9999,
                background: "rgba(0,0,0,0.25)",
                opacity: visible ? 1 : 0,
                transition: "opacity 240ms cubic-bezier(0.16, 1, 0.3, 1)",
                pointerEvents: "auto",
            }}>
            <div
                className="flux-sidebar-panel"
                onClick={(e) => e.stopPropagation()}
                style={{
                    display: "flex",
                    flexDirection: "column",
                    background: "rgba(10, 10, 14, 0.94)",
                    transform: visible ? "translate(0, 0)" : offscreenTransform,
                    transition: "transform 260ms cubic-bezier(0.16, 1, 0.3, 1)",
                    pointerEvents: "auto",
                    ...panelStyle,
                }}>
                {/* Header row — reserves its own height so list content below
                    can never render underneath/overlap the title or close
                    button, which was happening in landscape when the title
                    floated independently above the panel with no space
                    reserved. */}
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        height: 44,
                        padding: "0 14px",
                        flexShrink: 0,
                    }}>
                    <button
                        onClick={onClose}
                        aria-label="Close"
                        style={{
                            width: 26,
                            height: 26,
                            borderRadius: "50%",
                            background: "rgba(255,255,255,0.14)",
                            border: "none",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            flexShrink: 0,
                            WebkitTapHighlightColor: "transparent",
                            outline: "none",
                        }}>
                        <ArrowLeft size={14} color="#fff" strokeWidth={2.5} />
                    </button>
                    <span style={{ color: "#fff", fontSize: 16, fontWeight: 700 }}>{title}</span>
                </div>
                {/* Scrollable body — flex:1 + minHeight:0 is required for the
                    overflow to actually constrain inside a flex column (without
                    minHeight:0 the child can refuse to shrink and just push
                    past the panel bounds, which read as "overlapping content"
                    in landscape where total height is tighter). Scrollbar is
                    hidden via .flux-sidebar-scroll in index.css. */}
                <div className="flux-sidebar-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 0 8px" }}>
                    {children}
                </div>
            </div>
        </div>,
        document.body,
    );
}

export function SidebarItem({ active, onClick, children, icon: Icon }) {
    return (
        <button
            onClick={onClick}
            className={`flux-sidebar-item ${active ? "active" : ""}`}
            style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                padding: "11px 16px",
                background: active ? "rgba(229,62,62,0.16)" : "transparent",
                border: "none",
                borderLeft: active ? "3px solid #e53e3e" : "3px solid transparent",
                color: "#fff",
                fontSize: 13.5,
                textAlign: "left",
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
            }}>
            {Icon && <Icon size={15} style={{ opacity: 0.65, flexShrink: 0 }} />}
            <span style={{ flex: 1, display: "flex", alignItems: "center", minWidth: 0 }}>{children}</span>
        </button>
    );
}
