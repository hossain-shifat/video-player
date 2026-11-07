// web/src/Components/Auth/motion.js
// Small Web-Animations helpers for the auth screens. They do nothing when the user prefers reduced motion.

const reduced = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const EASE_OUT = "cubic-bezier(.22,.8,.3,1)";

/** Children of `container` rise in one after another (heading → fields → buttons). */
export function staggerIn(container, { delay = 90, step = 50, distance = 12 } = {}) {
    if (!container || reduced() || !container.animate) return;
    Array.from(container.children).forEach((el, i) => {
        el.animate(
            [
                { opacity: 0, transform: `translateY(${distance}px)` },
                { opacity: 1, transform: "none" },
            ],
            { duration: 500, delay: delay + i * step, easing: EASE_OUT, fill: "backwards" },
        );
    });
}

/** Parallax cue for the poster wall: it drifts against the direction the form slides, then settles. dir: 1 | -1 */
export function nudge(el, dir) {
    if (!el || !dir || reduced() || !el.animate) return;
    el.animate(
        [
            { transform: `translateX(${-dir * 26}px) scale(1.05)`, filter: "brightness(1.18)" },
            { transform: "none", filter: "brightness(1)" },
        ],
        { duration: 900, easing: EASE_OUT },
    );
}
