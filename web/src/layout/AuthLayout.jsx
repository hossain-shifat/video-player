// web/src/Layout/AuthLayout.jsx
// Dedicated layout for /login, /register, /verify-email, /forgot-password, /pending, /access-*.
//
// • No main Navbar / Footer / app navigation.
// • Exactly one viewport tall and never scrolls (h-dvh + overflow-hidden). Spacing shrinks on short
//   screens (--auth-* variables) and, as a last resort, the form is scaled down to fit — nothing is clipped.
// • Three layouts, one markup:
//     phone   (< 768 px)   poster-wall strip on top, the form on a rounded "sheet" that overlaps it
//     tablet  (768–1023)   poster wall + tagline on the left, form on the right
//     desktop (≥ 1024)     bigger poster wall with the full tagline, form on the right
// • Switching between auth pages (login ⇄ register ⇄ forgot password ⇄ verify …) slides the new form in from
//   the side it logically lives on (see ORDER); steps inside a page use the same classes (StepTransition).
// • Every colour comes from the active theme tokens.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation, useOutlet } from "react-router";
import PosterWall from "../Components/Auth/PosterWall";
import { nudge, staggerIn } from "../Components/Auth/motion";

const CSS = `
.auth-root{--auth-field:2.75rem;--auth-gap:.875rem;--auth-gap-lg:1.375rem}
@media (max-height:780px){.auth-root{--auth-field:2.5rem;--auth-gap:.7rem;--auth-gap-lg:1.1rem}}
@media (max-height:700px){.auth-root{--auth-field:2.4rem;--auth-gap:.55rem;--auth-gap-lg:.85rem}.auth-sub,.auth-hint{display:none}}
@media (max-height:600px){.auth-legal{display:none}.auth-root{--auth-gap:.5rem}}
@media (max-height:520px){.auth-root{--auth-field:2.25rem;--auth-gap:.4rem;--auth-gap-lg:.6rem}}
/* phone: the poster strip gives way on short screens so the form always has room */
@media (max-width:767.98px) and (max-height:600px){.auth-hero{display:none}.auth-sheet{margin-top:0!important;border-radius:0!important;border-top:0!important}}
/* every clickable thing shows the hand cursor (Tailwind 4 resets buttons to the default arrow) */
.auth-root button:not(:disabled),.auth-root a[href],.auth-root [role=button],.auth-root label[for],.auth-root summary{cursor:pointer}
.auth-root button:disabled,.auth-root [aria-disabled=true]{cursor:not-allowed}
/* page transitions: the leaving page fades + blurs out while the new one slides in (direction = where it lives in ORDER) */
@keyframes auth-in-fwd{from{opacity:0;transform:translateX(36px) scale(.985);filter:blur(5px)}to{opacity:1;transform:none;filter:blur(0)}}
@keyframes auth-in-back{from{opacity:0;transform:translateX(-36px) scale(.985);filter:blur(5px)}to{opacity:1;transform:none;filter:blur(0)}}
@keyframes auth-in-fade{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes auth-out-fwd{from{opacity:1;transform:none;filter:blur(0)}to{opacity:0;transform:translateX(-28px) scale(.985);filter:blur(4px)}}
@keyframes auth-out-back{from{opacity:1;transform:none;filter:blur(0)}to{opacity:0;transform:translateX(28px) scale(.985);filter:blur(4px)}}
@keyframes auth-out-fade{from{opacity:1}to{opacity:0;transform:translateY(-6px)}}
.auth-in-fwd{animation:auth-in-fwd .5s cubic-bezier(.22,.8,.3,1) .06s both}
.auth-in-back{animation:auth-in-back .5s cubic-bezier(.22,.8,.3,1) .06s both}
.auth-in-fade{animation:auth-in-fade .42s cubic-bezier(.22,.8,.3,1) both}
.auth-out-fwd{animation:auth-out-fwd .24s cubic-bezier(.2,.6,.3,1) both}
.auth-out-back{animation:auth-out-back .24s cubic-bezier(.2,.6,.3,1) both}
.auth-out-fade{animation:auth-out-fade .2s ease-in both}
/* a thin light sweeps across the top of the form column while pages change */
@keyframes auth-sweep{0%{transform:scaleX(0);opacity:1}65%{transform:scaleX(1);opacity:1}100%{transform:scaleX(1);opacity:0}}
.auth-sweep{transform-origin:left;animation:auth-sweep .75s cubic-bezier(.22,.8,.3,1) both}
.auth-sweep-back{transform-origin:right}
@media (prefers-reduced-motion:reduce){.auth-in-fwd,.auth-in-back,.auth-in-fade,.auth-out-fwd,.auth-out-back,.auth-out-fade,.auth-sweep{animation:none}.auth-out-fwd,.auth-out-back,.auth-out-fade{opacity:0}}
@keyframes auth-wall-drift{from{transform:translateY(0)}to{transform:translateY(-50%)}}
.auth-wall-col{animation:auth-wall-drift linear infinite;will-change:transform}
@media (prefers-reduced-motion:reduce){.auth-wall-col{animation:none}}
`;

// Logical left→right order of the auth pages. Moving to a higher number slides in from the right, lower from the left.
const ORDER = { "/login": 0, "/register": 1, "/forgot-password": 2, "/verify-email": 3 };

function enterClassFor(from, to) {
    const a = ORDER[from];
    const b = ORDER[to];
    if (a === undefined || b === undefined || a === b) return "auth-in-fade";
    return b > a ? "auth-in-fwd" : "auth-in-back";
}

const EXIT_FOR = { "auth-in-fwd": "auth-out-fwd", "auth-in-back": "auth-out-back", "auth-in-fade": "auth-out-fade" };
const DIR_FOR = { "auth-in-fwd": 1, "auth-in-back": -1, "auth-in-fade": 0 };

// One page in the transition stack. The leaving page stays MOUNTED (so it does not reset or steal focus),
// is taken out of flow, made inert, and animated out; the entering page staggers its content in.
function Panel({ out, enterClass, exitClass, children }) {
    const ref = useRef(null);
    useLayoutEffect(() => {
        staggerIn(ref.current?.firstElementChild);
    }, []);
    return (
        <div ref={ref} className={`min-w-0 ${out ? `${exitClass} pointer-events-none absolute inset-x-0 top-0` : `${enterClass} w-full`}`} aria-hidden={out || undefined} inert={out || undefined}>
            {children}
        </div>
    );
}

// The logo on the sign-in screens is a plain, non-clickable mark (no link, no hand cursor).
function Brand({ className = "" }) {
    return (
        <span aria-label="FLUX" role="img" className={`inline-block cursor-default select-none ${className}`}>
            <span className="font-ibm-plex-sans text-3xl font-black text-primary">
                F<span className="text-2xl lowercase">LU</span>X
            </span>
        </span>
    );
}

// Guarantee: the form never scrolls and is never clipped. After the spacing rules above have done what
// they can, anything that is STILL taller/wider than the space it has (a long error message, a very short
// landscape phone, browser zoom…) is scaled down just enough to fit. Observes both the available area and
// the content, so it also reacts when an error appears or the route changes.
function useFitToViewport(mainRef, fitRef) {
    useLayoutEffect(() => {
        const main = mainRef.current;
        const el = fitRef.current;
        if (!main || !el) return undefined;
        const fit = () => {
            const cs = getComputedStyle(main);
            const availH = main.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
            const availW = main.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
            const h = el.offsetHeight;
            const w = el.offsetWidth;
            if (!h || !w) return;
            const scale = Math.max(0.5, Math.min(1, availH / h, availW / w));
            // content hugs the top on phones (items-start) and is centred elsewhere: scale around the matching edge
            el.style.transformOrigin = cs.alignItems === "flex-start" ? "top center" : "center";
            el.style.transform = scale < 1 ? `scale(${scale.toFixed(3)})` : "";
        };
        const ro = new ResizeObserver(fit);
        ro.observe(main);
        ro.observe(el);
        fit();
        return () => ro.disconnect();
    }, [mainRef, fitRef]);
}

export default function AuthLayout() {
    const mainRef = useRef(null);
    const fitRef = useRef(null);
    const wallRef = useRef(null);
    useFitToViewport(mainRef, fitRef);

    // The page transition stack. When the path changes, the previous page is kept (as `leaving`) for the length of
    // its exit animation ("adjust state while rendering" pattern — no refs are read during render).
    const { pathname } = useLocation();
    const outlet = useOutlet();
    const [view, setView] = useState({ path: pathname, node: outlet, leaving: null, seq: 0, enter: "auth-in-fade" });
    if (view.path !== pathname) {
        setView({ path: pathname, node: outlet, leaving: { path: view.path, node: view.node }, seq: view.seq + 1, enter: enterClassFor(view.path, pathname) });
    }
    useEffect(() => {
        if (!view.leaving) return undefined;
        const t = setTimeout(() => setView((v) => (v.seq === view.seq ? { ...v, leaving: null } : v)), 330);
        return () => clearTimeout(t);
    }, [view.seq, view.leaving]);
    // the poster wall drifts against the direction the form slides (depth cue)
    useEffect(() => {
        if (view.seq > 0) nudge(wallRef.current, DIR_FOR[view.enter]);
    }, [view.seq, view.enter]);

    const exitClass = EXIT_FOR[view.enter];

    return (
        <div className="auth-root relative flex h-dvh w-full flex-col overflow-hidden bg-base-100 text-base-content md:grid md:grid-cols-[40%_minmax(0,1fr)] lg:grid-cols-[minmax(0,1.1fr)_minmax(28rem,0.9fr)]">
            <style>{CSS}</style>

            {/* Poster wall: top strip on phones, left panel from 768 px up */}
            <div aria-hidden="true" className="auth-hero relative h-[clamp(88px,19dvh,170px)] shrink-0 overflow-hidden md:absolute md:inset-y-0 md:left-0 md:h-auto md:w-[40%] lg:w-[55%]">
                <div ref={wallRef} className="absolute inset-0">
                    <PosterWall />
                </div>
                <div className="absolute inset-0 bg-gradient-to-b from-base-100/55 via-base-100/10 to-base-100/80 md:hidden" />
                <div className="absolute inset-0 hidden bg-gradient-to-t from-base-100 via-base-100/30 to-base-100/10 md:block" />
                <div className="absolute inset-0 hidden bg-gradient-to-r from-base-100/50 via-transparent to-transparent md:block" />
            </div>

            {/* Phone: brand sits on the poster strip */}
            <div className="auth-hero pointer-events-none absolute inset-x-0 top-0 z-20 flex h-[clamp(88px,19dvh,170px)] items-center justify-center md:hidden">
                <Brand />
            </div>

            {/* Showcase copy (tablet + desktop) */}
            <section className="relative z-10 hidden min-h-0 flex-col justify-between p-8 md:flex lg:p-12 xl:p-16">
                <Brand />
                <div className="max-w-md">
                    <p className="font-circular text-2xl leading-[1.12] tracking-tight lg:text-4xl xl:text-5xl">Everything you own, ready to play.</p>
                    <p className="mt-4 hidden max-w-sm text-base leading-relaxed text-base-content/70 lg:block">Movies, series, anime and live TV, streamed from your own server to any screen at home.</p>
                </div>
            </section>

            {/* Form column / phone sheet */}
            <div className="auth-sheet relative z-10 -mt-6 flex min-h-0 min-w-0 flex-1 flex-col rounded-t-3xl border-t border-base-content/10 bg-base-100 shadow-[0_-12px_32px_-12px_rgba(0,0,0,0.5)] md:mt-0 md:h-full md:flex-none md:rounded-none md:border-t-0 md:border-l md:shadow-none">
                {view.seq > 0 && (
                    <span key={view.seq} aria-hidden="true" className={`auth-sweep pointer-events-none absolute inset-x-0 top-0 z-20 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent ${view.enter === "auth-in-back" ? "auth-sweep-back" : ""}`} />
                )}
                <main ref={mainRef} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-5 py-4 max-md:items-start max-md:pt-7 sm:px-8">
                    <div ref={fitRef} className="auth-fit relative w-full max-w-[26rem]">
                        {view.leaving && (
                            <Panel key={view.leaving.path} out enterClass={view.enter} exitClass={exitClass}>
                                {view.leaving.node}
                            </Panel>
                        )}
                        <Panel key={pathname} enterClass={view.enter} exitClass={exitClass}>
                            {outlet}
                        </Panel>
                    </div>
                </main>

                <footer className="auth-legal shrink-0 pb-4 text-center text-xs text-base-content/45">
                    <Link to="/terms" className="rounded hover:text-base-content/80 focus-visible:outline-2 focus-visible:outline-primary">
                        Terms
                    </Link>
                    <span aria-hidden="true" className="mx-2">
                        ·
                    </span>
                    <Link to="/privacy" className="rounded hover:text-base-content/80 focus-visible:outline-2 focus-visible:outline-primary">
                        Privacy
                    </Link>
                </footer>
            </div>
        </div>
    );
}
