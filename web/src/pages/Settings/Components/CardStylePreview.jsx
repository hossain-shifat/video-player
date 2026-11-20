import { useEffect, useMemo, useRef } from "react";
import MediaCard from "../../../Components/Media/MediaCard";
import HistoryCard from "../../../Components/Media/HistoryCard";
import TrailerCard from "../../../Components/Trailers/TrailerCard";

// ─── Sample artwork ──────────────────────────────────────────────────────────
// Cinematic poster / still art used by the card-style preview.
// Pure inline SVG (no library data, no network). Posters carry a title block,
// 16:9 stills do not.

const uri = (svg) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

// deterministic pseudo-random so the art never changes between renders
const rnd = (n) => {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
};

const grain = (w, h) =>
    `<filter id="gr" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/>` +
    `<feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0.16 0 0 0 0"/></filter>` +
    `<rect width="${w}" height="${h}" fill="none" filter="url(#gr)"/>`;

function titleBlock(w, h, t) {
    if (!t) return "";
    const size = w * 0.095;
    const y0 = h * 0.82;
    const lines = t.lines.map((l, i) => `<text x="${w / 2}" y="${y0 + i * size * 1.12}" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-size="${size}" letter-spacing="${w * 0.018}" fill="#f4efe6">${l}</text>`).join("");
    const subY = y0 + t.lines.length * size * 1.12 + w * 0.02;
    return (
        `<defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.8"/></linearGradient></defs>` +
        `<rect y="${h * 0.62}" width="${w}" height="${h * 0.38}" fill="url(#fade)"/>${lines}` +
        `<text x="${w / 2}" y="${subY}" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="${w * 0.036}" letter-spacing="${w * 0.02}" fill="#f4efe6" fill-opacity="0.75">${t.sub}</text>`
    );
}

const wrap = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice">${body}</svg>`;

// ── Harbor at dusk: teal sky, warm horizon, sun reflection, ship silhouette ──
function harbor(w, h, t) {
    const hz = h * 0.58;
    const m = Math.min(w, h);
    const refl = [0, 1, 2, 3, 4, 5, 6]
        .map((i) => `<rect x="${w * 0.5 - m * (0.16 - i * 0.018)}" y="${hz + h * (0.02 + i * 0.045)}" width="${m * (0.32 - i * 0.036)}" height="${h * 0.012}" fill="#ffd9a0" fill-opacity="${0.55 - i * 0.07}"/>`)
        .join("");
    return wrap(
        w,
        h,
        `<defs>` +
            `<linearGradient id="sk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#07111d"/><stop offset="0.6" stop-color="#1d4a5b"/><stop offset="1" stop-color="#e8a05d"/></linearGradient>` +
            `<linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3f5f68"/><stop offset="1" stop-color="#06101a"/></linearGradient>` +
            `<radialGradient id="glow"><stop offset="0" stop-color="#ffd9a0" stop-opacity="0.9"/><stop offset="1" stop-color="#ffd9a0" stop-opacity="0"/></radialGradient>` +
            `</defs>` +
            `<rect width="${w}" height="${hz}" fill="url(#sk)"/>` +
            `<rect y="${hz}" width="${w}" height="${h - hz}" fill="url(#sea)"/>` +
            `<circle cx="${w * 0.5}" cy="${hz}" r="${m * 0.42}" fill="url(#glow)"/>` +
            `<circle cx="${w * 0.5}" cy="${hz - m * 0.02}" r="${m * 0.07}" fill="#fff1d6"/>` +
            `<ellipse cx="${w * 0.25}" cy="${h * 0.24}" rx="${w * 0.3}" ry="${h * 0.012}" fill="#07111d" fill-opacity="0.35"/>` +
            `<ellipse cx="${w * 0.78}" cy="${h * 0.34}" rx="${w * 0.26}" ry="${h * 0.01}" fill="#07111d" fill-opacity="0.3"/>` +
            refl +
            `<polygon points="${w * 0.12},${hz + 1} ${w * 0.4},${hz + 1} ${w * 0.36},${hz + h * 0.035} ${w * 0.16},${hz + h * 0.035}" fill="#050b12"/>` +
            `<rect x="${w * 0.25}" y="${hz - h * 0.09}" width="${w * 0.006}" height="${h * 0.09}" fill="#050b12"/>` +
            `<polygon points="${w * 0.256},${hz - h * 0.085} ${w * 0.33},${hz - h * 0.01} ${w * 0.256},${hz - h * 0.01}" fill="#050b12"/>` +
            `<rect y="${hz + h * 0.14}" width="${w}" height="${h * 0.004}" fill="#050b12" fill-opacity="0.5"/>` +
            grain(w, h) +
            titleBlock(w, h, t),
    );
}

// ── Neon city: layered skyline, magenta / cyan glow, lit windows ──
function city(w, h, t) {
    const layer = (seed, base, minH, maxH, count, fill, windows) => {
        let x = 0;
        let out = "";
        for (let i = 0; i < count; i++) {
            const bw = (w / count) * (0.8 + rnd(seed + i) * 0.6);
            const bh = h * (minH + rnd(seed + i * 3) * (maxH - minH));
            out += `<rect x="${x}" y="${base - bh}" width="${bw + 1}" height="${bh}" fill="${fill}"/>`;
            if (windows) {
                const cols = Math.max(1, Math.floor(bw / (w * 0.035)));
                const rows = Math.floor(bh / (h * 0.045));
                for (let r = 0; r < rows; r++) {
                    for (let c = 0; c < cols; c++) {
                        const k = rnd(seed * 7 + i * 31 + r * 5 + c);
                        if (k > 0.72) {
                            out += `<rect x="${x + (c + 0.35) * (bw / cols)}" y="${base - bh + (r + 0.4) * h * 0.045}" width="${w * 0.014}" height="${h * 0.012}" fill="${k > 0.9 ? "#5ee7ff" : "#ffd27a"}" fill-opacity="0.85"/>`;
                        }
                    }
                }
            }
            x += bw;
        }
        return out;
    };
    const base = h * 0.8;
    return wrap(
        w,
        h,
        `<defs>` +
            `<linearGradient id="sk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#090a1e"/><stop offset="1" stop-color="#3a1850"/></linearGradient>` +
            `<radialGradient id="mg"><stop offset="0" stop-color="#ff2d95" stop-opacity="0.55"/><stop offset="1" stop-color="#ff2d95" stop-opacity="0"/></radialGradient>` +
            `<radialGradient id="cy"><stop offset="0" stop-color="#2de2ff" stop-opacity="0.4"/><stop offset="1" stop-color="#2de2ff" stop-opacity="0"/></radialGradient>` +
            `</defs>` +
            `<rect width="${w}" height="${h}" fill="url(#sk)"/>` +
            `<circle cx="${w * 0.62}" cy="${h * 0.62}" r="${w * 0.55}" fill="url(#mg)"/>` +
            `<circle cx="${w * 0.15}" cy="${h * 0.72}" r="${w * 0.4}" fill="url(#cy)"/>` +
            layer(3, base, 0.18, 0.42, 9, "#1b1236", false) +
            layer(11, base, 0.1, 0.3, 7, "#07050f", true) +
            `<rect y="${base}" width="${w}" height="${h - base}" fill="#07050f"/>` +
            `<rect y="${base + h * 0.02}" width="${w}" height="${h * 0.004}" fill="#ff2d95" fill-opacity="0.5"/>` +
            grain(w, h) +
            titleBlock(w, h, t),
    );
}

// ── Orbit: shaded planet, ring passing in front and behind, star field ──
function orbit(w, h, t) {
    const m = Math.min(w, h);
    const cx = w * 0.5;
    const cy = h * 0.44;
    const r = m * 0.27;
    const rx = m * 0.46;
    const ry = m * 0.1;
    const stars = Array.from({ length: 70 }, (_, i) => `<circle cx="${rnd(i + 1) * w}" cy="${rnd(i + 90) * h}" r="${0.4 + rnd(i + 200) * 1.1}" fill="#f4efe6" fill-opacity="${0.25 + rnd(i + 300) * 0.6}"/>`).join("");
    return wrap(
        w,
        h,
        `<defs>` +
            `<radialGradient id="bg" cx="0.5" cy="0.44" r="0.8"><stop offset="0" stop-color="#10223a"/><stop offset="1" stop-color="#02040a"/></radialGradient>` +
            `<radialGradient id="pl" cx="0.32" cy="0.3" r="0.85"><stop offset="0" stop-color="#f6d3a8"/><stop offset="0.55" stop-color="#b25b3c"/><stop offset="1" stop-color="#2a1410"/></radialGradient>` +
            `<clipPath id="cp"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>` +
            `</defs>` +
            `<rect width="${w}" height="${h}" fill="url(#bg)"/>` +
            stars +
            `<g transform="rotate(-18 ${cx} ${cy})"><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="#e9d5b5" stroke-opacity="0.55" stroke-width="${m * 0.014}"/></g>` +
            `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#pl)"/>` +
            `<circle cx="${cx + r * 0.55}" cy="${cy + r * 0.2}" r="${r * 1.05}" fill="#02040a" fill-opacity="0.55" clip-path="url(#cp)"/>` +
            `<g transform="rotate(-18 ${cx} ${cy})"><path d="M ${cx - rx} ${cy} A ${rx} ${ry} 0 0 0 ${cx + rx} ${cy}" fill="none" stroke="#e9d5b5" stroke-opacity="0.9" stroke-width="${m * 0.014}"/></g>` +
            grain(w, h) +
            titleBlock(w, h, t),
    );
}

const SCENES = { harbor, city, orbit };
const TITLES = {
    harbor: { lines: ["MIDNIGHT", "HARBOR"], sub: "2024" },
    city: { lines: ["NEON", "DISTRICT"], sub: "SEASON 2" },
    orbit: { lines: ["SILENT", "ORBIT"], sub: "COMING SOON" },
};

/** 2:3 poster with title block. kind: "harbor" | "city" | "orbit" */
const posterArt = (kind) => uri(SCENES[kind](200, 300, TITLES[kind]));

/** 16:9 still, no text */
const thumbArt = (kind) => uri(SCENES[kind](320, 180, null));

// Illustrated, non-interactive sample of one card style.
// Sample items use the same fields the real cards read, so every tag/tile shows.

const DAY = 86400000;

function Group({ title, children }) {
    return (
        <div>
            <p className="mb-1 text-xs font-medium text-base-content/70">{title}</p>
            <div className="flex flex-wrap items-start gap-x-3">{children}</div>
        </div>
    );
}

export default function CardStylePreview({ variant }) {
    const rootRef = useRef(null);

    // `inert` blocks keyboard focus + clicks regardless of React version
    useEffect(() => {
        rootRef.current?.setAttribute("inert", "");
    }, []);

    const s = useMemo(() => {
        const now = Date.now();
        return {
            movie: { id: "preview-movie", type: "movie", resolution: "4K", metadata: { title: "Midnight Harbor", year: 2024, rating: 8.4, runtime: 169, poster: posterArt("harbor") } },
            series: { id: "preview-series", type: "series", resolution: "1080p", seasonCount: 2, episodeCount: 18, metadata: { title: "Neon District", year: 2023, rating: 7.9, poster: posterArt("city") } },
            upcoming: {
                id: "preview-upcoming",
                type: "movie",
                _badge: "Upcoming",
                _badgeDot: true,
                _release: new Date(now + 12 * DAY + 4 * 3600000).toISOString(),
                metadata: { title: "Silent Orbit", year: 2026, rating: null, poster: posterArt("orbit") },
            },
            hMovie: { id: "preview-h1", title: "Midnight Harbor", mediaType: "movie", year: 2024, position: 4200, duration: 10140, updatedAt: now - 2 * DAY, previewThumb: thumbArt("harbor") },
            hSeries: { id: "preview-h2", title: "Neon District", mediaType: "series", seasonNumber: 2, episodeNumber: 5, position: 1500, duration: 2700, updatedAt: now - 3600000, previewThumb: thumbArt("city") },
            trailerMovie: { tmdbId: 1, type: "movie", title: "Midnight Harbor", thumbnail: thumbArt("harbor"), releaseDate: "2024-07-12", company: { name: "Northlight Pictures" }, trailer: "preview" },
            trailerShow: { tmdbId: 2, type: "series", title: "Neon District", thumbnail: thumbArt("city"), releaseDate: "2023-10-05", company: { name: "Studio Nine" }, trailer: "preview" },
            hDone: { id: "preview-h3", title: "Silent Orbit", mediaType: "movie", year: 2022, position: 7000, duration: 7000, completed: true, updatedAt: now - 5 * DAY, previewThumb: thumbArt("orbit") },
        };
    }, []);

    return (
        <div ref={rootRef} aria-hidden="true" className="pointer-events-none select-none space-y-3">
            <Group title="Poster cards">
                <MediaCard variant={variant} item={s.movie} />
                <MediaCard variant={variant} item={s.series} />
                <MediaCard variant={variant} item={s.upcoming} />
            </Group>
            <Group title="Continue watching cards">
                <HistoryCard variant={variant} item={s.hMovie} previewThumb={s.hMovie.previewThumb} />
                <HistoryCard variant={variant} item={s.hSeries} previewThumb={s.hSeries.previewThumb} />
                <HistoryCard variant={variant} item={s.hDone} previewThumb={s.hDone.previewThumb} />
            </Group>
            <Group title="Trailer cards">
                <TrailerCard variant={variant} item={s.trailerMovie} onPlay={() => {}} />
                <TrailerCard variant={variant} item={s.trailerShow} onPlay={() => {}} />
            </Group>
        </div>
    );
}
