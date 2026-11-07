// web/src/Components/Auth/PosterWall.jsx
// Decorative, slowly drifting wall of posters for the auth screens.
//   • Normally REAL, RECENT posters (random movies / series / anime fetched from TMDB by the server — never restricted
//     content, never your library) with the same type badge the app's cards use, from GET /auth/showcase.
//   • If TMDB is unreachable / not configured, the endpoint is off or an image fails to load, tiles fall back to abstract
//     art mixed from the active daisyUI theme tokens (Cinema / AMOLED / Slate / Light Studio).
// Purely decorative and NOT interactive: aria-hidden, inert (no clicks, hover, focus or drag), and the drift stops for
// people who prefer reduced motion.

import { useMemo, useState } from "react";
import { useShowcasePosters } from "../../Hooks/Auth/useShowcasePosters";

const TOKENS = ["primary", "accent", "secondary"];

// [angle, colourA, %A, colourB, %B, shape]
const ART = [
    [160, 0, 78, 1, 30, "sun"],
    [200, 1, 70, 2, 28, "arch"],
    [150, 2, 66, 0, 34, "beams"],
    [185, 0, 60, 2, 40, "horizon"],
    [165, 1, 82, 0, 24, "rings"],
    [210, 2, 74, 1, 30, "split"],
    [155, 0, 70, 1, 36, "arch"],
    [190, 2, 62, 0, 38, "sun"],
    [170, 1, 66, 2, 32, "horizon"],
    [205, 0, 80, 2, 26, "beams"],
];

const ink = (pct) => `color-mix(in oklch, var(--color-base-content) ${pct}%, transparent)`;

function Shape({ kind }) {
    switch (kind) {
        case "sun":
            return <span className="absolute left-[22%] top-[18%] h-[46%] w-[56%] rounded-full" style={{ background: ink(22) }} />;
        case "arch":
            return <span className="absolute bottom-0 left-[18%] h-[62%] w-[64%] rounded-t-full" style={{ background: ink(20) }} />;
        case "beams":
            return (
                <>
                    <span className="absolute -left-[10%] top-[8%] h-[120%] w-[18%] rotate-[24deg]" style={{ background: ink(16) }} />
                    <span className="absolute left-[34%] top-[0%] h-[120%] w-[10%] rotate-[24deg]" style={{ background: ink(12) }} />
                </>
            );
        case "horizon":
            return (
                <>
                    <span className="absolute inset-x-0 bottom-0 h-[38%]" style={{ background: ink(20) }} />
                    <span className="absolute left-[56%] top-[24%] h-[18%] w-[26%] rounded-full" style={{ background: ink(26) }} />
                </>
            );
        case "rings":
            return (
                <>
                    <span className="absolute left-[16%] top-[16%] h-[68%] w-[68%] rounded-full border-2" style={{ borderColor: ink(24) }} />
                    <span className="absolute left-[32%] top-[32%] h-[36%] w-[36%] rounded-full border-2" style={{ borderColor: ink(24) }} />
                </>
            );
        default: // split
            return <span className="absolute inset-y-0 right-0 w-[46%]" style={{ background: ink(16) }} />;
    }
}

function Tile({ art }) {
    const [angle, a, pa, b, pb, shape] = art;
    return (
        <div
            className="relative aspect-[2/3] w-full shrink-0 overflow-hidden rounded-xl ring-1 ring-base-content/10"
            style={{
                background: `linear-gradient(${angle}deg, color-mix(in oklch, var(--color-${TOKENS[a]}) ${pa}%, var(--color-base-300)), color-mix(in oklch, var(--color-${TOKENS[b]}) ${pb}%, var(--color-base-100)))`,
            }}>
            <Shape kind={shape} />
            <span className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/35 to-transparent" />
        </div>
    );
}

const BADGE = {
    movie: ["Movie", "bg-primary/90 text-primary-content"],
    series: ["Series", "bg-accent/90 text-accent-content"],
    anime: ["Anime", "bg-secondary/90 text-secondary-content"],
};

// A real poster. If the image cannot load (offline, blocked CDN) it quietly becomes an abstract tile.
function RealTile({ item, fallbackArt }) {
    const [failed, setFailed] = useState(false);
    if (failed) return <Tile art={fallbackArt} />;
    const [label, tone] = BADGE[item.type] || BADGE.movie;
    return (
        <div className="relative aspect-[2/3] w-full shrink-0 overflow-hidden rounded-xl bg-base-300 ring-1 ring-base-content/10">
            <img src={item.poster.replace("/w500/", "/w342/")} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} onError={() => setFailed(true)} className="h-full w-full object-cover" />
            <span className={`absolute left-1.5 top-1.5 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${tone}`}>{label}</span>
            <span className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/45 to-transparent" />
        </div>
    );
}

// Lay real posters out over the columns. With plenty of posters every slot is one; with only a few
// the posters are spread EVENLY among abstract tiles instead of repeating the same few over and over.
function dealColumns(posters, cols, perCol) {
    const total = cols * perCol;
    const real = posters.slice(0, total);
    const slots = Array.from({ length: total }, (_, i) => ({ kind: "art", art: ART[(i * 3 + 1) % ART.length] }));
    real.forEach((item, i) => {
        slots[Math.min(total - 1, Math.floor(((i + 0.5) * total) / real.length))] = { kind: "real", item };
    });
    const out = Array.from({ length: cols }, () => []);
    slots.forEach((slot, idx) => out[idx % cols].push(slot));
    return out;
}

// Each column shows the tiles twice so translating by -50% loops seamlessly.
function Column({ offset, duration, reverse, className = "", items }) {
    const rows = items || [...ART.slice(offset), ...ART.slice(0, offset)].map((art) => ({ kind: "art", art }));
    return (
        <div className={`min-w-0 flex-1 ${className}`}>
            <div className="auth-wall-col flex flex-col gap-4" style={{ animationDuration: `${duration}s`, animationDirection: reverse ? "reverse" : "normal" }}>
                {[...rows, ...rows].map((row, i) =>
                    row.kind === "real" ? <RealTile key={i} item={row.item} fallbackArt={ART[(offset + i) % ART.length]} /> : <Tile key={i} art={row.art} />,
                )}
            </div>
        </div>
    );
}

export default function PosterWall() {
    const { status, posters } = useShowcasePosters();
    const columns = useMemo(() => (status === "ready" ? dealColumns(posters, 4, 7) : null), [status, posters]);

    // while the (fast) request is in flight draw nothing — avoids a flash of abstract tiles that then get replaced
    if (status === "loading") return <div aria-hidden="true" inert className="pointer-events-none absolute inset-0" />;

    const WALL = { className: "absolute -inset-[18%] flex -rotate-[9deg] gap-4", style: { maskImage: "linear-gradient(to bottom, transparent 0%, #000 14%, #000 86%, transparent 100%)" } };
    return (
        <div aria-hidden="true" inert className="auth-in-fade pointer-events-none absolute inset-0 cursor-default select-none overflow-hidden">
            <div {...WALL}>
                <Column offset={0} duration={90} items={columns?.[0]} />
                <Column offset={3} duration={110} reverse className="mt-24" items={columns?.[1]} />
                <Column offset={6} duration={100} className="mt-10" items={columns?.[2]} />
                <Column offset={8} duration={120} reverse className="mt-32 hidden sm:block" items={columns?.[3]} />
            </div>
        </div>
    );
}
