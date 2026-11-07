import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Bookmark, ArrowUpDown, X, Hourglass, Star, CalendarClock, Layers } from "lucide-react";
import { useApi } from "../../Context/apiContext";
import MediaCard from "../../Components/Media/MediaCard";

// ─── Motion (CSS) — respects reduced-motion ───────────────────────────────────
const CSS = `
@keyframes wl-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@keyframes wl-pop{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
@keyframes wl-dotin{from{opacity:0;transform:scale(0)}to{opacity:1;transform:scale(1)}}
@keyframes wl-grow{from{opacity:0;transform:scale(0)}to{opacity:1;transform:scale(1)}}
@keyframes wl-arc{from{stroke-dasharray:0 100}to{stroke-dasharray:var(--seg) 100}}
@keyframes wl-line{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.wl-rise{animation:wl-rise .7s cubic-bezier(.16,1,.3,1) backwards;animation-delay:calc(var(--i,0)*70ms)}
.wl-pop{animation:wl-pop .18s ease-out both}
.wl-dotin{transform-box:fill-box;transform-origin:center;animation:wl-dotin .6s cubic-bezier(.16,1,.3,1) backwards;animation-delay:calc(var(--i,0)*22ms)}
.wl-grow{animation:wl-grow 1s cubic-bezier(.16,1,.3,1) backwards;animation-delay:.15s}
.wl-arc{animation:wl-arc 1.2s cubic-bezier(.16,1,.3,1) backwards;animation-delay:.2s}
.wl-line{transform-origin:left center;animation:wl-line .9s cubic-bezier(.16,1,.3,1) backwards;animation-delay:calc(var(--i,0)*70ms)}
@media (prefers-reduced-motion:reduce){.wl-rise,.wl-pop,.wl-dotin,.wl-grow,.wl-arc,.wl-line{animation:none!important}}
`;

// ─── Formatting / date helpers ────────────────────────────────────────────────
function fmtDuration(mins) {
    if (!mins) return "—";
    const d = Math.floor(mins / 1440);
    const h = Math.floor((mins % 1440) / 60);
    const m = Math.round(mins % 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
function daysAgo(iso) {
    if (!iso) return 0;
    return Math.max(0, Math.floor((startOfDay(new Date()).getTime() - startOfDay(new Date(iso)).getTime()) / 86400000));
}

const BUCKETS = ["Added today", "This week", "This month", "Earlier"];
function bucketOf(iso) {
    const d = daysAgo(iso);
    if (d === 0) return "Added today";
    if (d <= 7) return "This week";
    if (d <= 30) return "This month";
    return "Earlier";
}

// ─── Entry building ───────────────────────────────────────────────────────────
// Shape MediaCard.normalise() expects; poster is never lost.
function toCardItem(w, lookup) {
    const isMovie = w.type === "movie";
    const full = lookup.get(`${isMovie ? "movie" : "series"}:${w.id}`);
    if (full) return { full, card: { ...full, metadata: { poster: w.poster ?? null, ...(full.metadata ?? {}) } } };
    return {
        full: null,
        card: isMovie ? { id: w.id, type: "movie", name: w.name, metadata: { poster: w.poster ?? null } } : { seriesKey: w.id, title: w.name, type: "series", metadata: { poster: w.poster ?? null } },
    };
}

// Total episode minutes of a series from local episodes (45 min fallback)
function seriesMinutes(full) {
    if (!full?.seasons) return 0;
    let total = 0;
    for (const s of Object.values(full.seasons)) for (const ep of s.episodes ?? []) total += ep.runtime ?? 45;
    return total;
}

const KIND = {
    movie: { label: "Movies", bg: "bg-primary", fill: "fill-primary", text: "text-primary" },
    series: { label: "Series", bg: "bg-accent", fill: "fill-accent", text: "text-accent" },
    anime: { label: "Anime", bg: "bg-secondary", fill: "fill-secondary", text: "text-secondary" },
};

// ─── Layout primitives ────────────────────────────────────────────────────────
// "Instrument panel": header strip with a small caps label, flat body.
function Panel({ label, title, sub, right, children, className = "", i = 0 }) {
    return (
        <section className={`wl-rise min-w-0 overflow-hidden rounded-xl border border-base-300 bg-base-100 ${className}`} style={{ "--i": i }}>
            <header className="flex items-center justify-between gap-3 border-b border-base-300 bg-base-200/60 px-4 py-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-base-content/60">{label}</span>
                {right}
            </header>
            <div className="p-4 sm:p-5">
                <h3 className="text-sm font-semibold text-base-content">{title}</h3>
                {sub && <p className="mt-0.5 text-xs text-base-content/65">{sub}</p>}
                <div className="mt-4">{children}</div>
            </div>
        </section>
    );
}

function LegendChip({ k, n, active, onPick }) {
    return (
        <button onClick={() => onPick(active ? null : k)} className={`inline-flex items-center gap-1.5 text-[11px] cursor-pointer transition-opacity ${active === false ? "" : ""}`}>
            <span className={`h-2 w-2 rounded-full ${KIND[k].bg}`} />
            <span className={active ? "font-semibold text-base-content" : "text-base-content/70"}>{KIND[k].label}</span>
            <span className="tabular-nums text-base-content/45">{n}</span>
        </button>
    );
}

function useElementWidth() {
    const ref = useRef(null);
    const [w, setW] = useState(0);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return undefined;
        const update = () => setW(Math.round(el.getBoundingClientRect().width));
        update();
        if (typeof ResizeObserver === "undefined") return undefined;
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    return [ref, w];
}

// ─── Chart: quality map (bubble scatter — year × rating, size = runtime) ──────
function QualityMap({ points, avg, width, height }) {
    const [hover, setHover] = useState(null);
    const compact = width < 480;
    const M = { l: compact ? 28 : 36, r: 14, t: 14, b: 28 };
    const iw = Math.max(width - M.l - M.r, 10);
    const ih = height - M.t - M.b;

    const years = points.map((p) => p.year);
    const minY = Math.floor((Math.min(...years) - 1) / 5) * 5;
    const maxY = Math.max(Math.ceil((Math.max(...years) + 1) / 5) * 5, minY + 10);
    const lo = Math.max(0, Math.floor(Math.min(...points.map((p) => p.rating))) - 1);
    const hi = 10;
    const maxMin = Math.max(1, ...points.map((p) => p.minutes));

    const x = (yr) => M.l + ((yr - minY) / (maxY - minY)) * iw;
    const y = (r) => M.t + ih * (1 - (r - lo) / (hi - lo));
    const rad = (m) => 4.5 + 9 * Math.sqrt(m / maxMin);

    const xStep = maxY - minY > 40 ? 10 : 5;
    const xTicks = [];
    for (let v = minY; v <= maxY; v += xStep) xTicks.push(v);
    const yTicks = [];
    for (let v = lo; v <= hi; v += 1) yTicks.push(v);

    const h = hover != null ? points[hover] : null;
    const tipLeft = h ? Math.min(Math.max(x(h.year), 90), width - 90) : 0;

    return (
        <div className="relative select-none" style={{ width, height }}>
            <svg width={width} height={height} className="block overflow-visible" role="img" aria-label="Rating versus release year">
                {yTicks.map((v) => (
                    <g key={v}>
                        <line x1={M.l} x2={M.l + iw} y1={y(v)} y2={y(v)} className="stroke-base-content" strokeOpacity={v === lo ? 0.25 : 0.1} />
                        <text x={M.l - 7} y={y(v) + 3.5} textAnchor="end" className="fill-base-content/70" fontSize="10.5">
                            {v}
                        </text>
                    </g>
                ))}
                {xTicks.map((v) => (
                    <g key={v}>
                        <line x1={x(v)} x2={x(v)} y1={M.t} y2={M.t + ih} className="stroke-base-content" strokeOpacity="0.06" />
                        <text x={x(v)} y={height - 8} textAnchor="middle" className="fill-base-content/70" fontSize="10.5">
                            {v}
                        </text>
                    </g>
                ))}

                {avg != null && (
                    <g pointerEvents="none">
                        <line x1={M.l} x2={M.l + iw} y1={y(avg)} y2={y(avg)} className="stroke-warning" strokeOpacity="0.7" strokeDasharray="5 4" />
                        <text x={M.l + iw} y={y(avg) - 5} textAnchor="end" className="fill-warning" fontSize="10" fontWeight="600">
                            avg {avg.toFixed(1)}
                        </text>
                    </g>
                )}

                {points.map((p, i) => (
                    <circle
                        key={p.key}
                        cx={x(p.year)}
                        cy={y(p.rating)}
                        r={rad(p.minutes) + (hover === i ? 2 : 0)}
                        className={`wl-dotin ${KIND[p.kind].fill} stroke-base-100 transition-[r] duration-150`}
                        fillOpacity={hover == null || hover === i ? 0.8 : 0.3}
                        strokeWidth="1.5"
                        style={{ "--i": i }}
                        onPointerEnter={() => setHover(i)}
                        onPointerLeave={() => setHover(null)}
                        onPointerDown={() => setHover(i)}
                    />
                ))}
            </svg>

            {h && (
                <div
                    className="wl-pop pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-base-content/15 bg-base-100 px-2.5 py-1.5 text-xs shadow-xl"
                    style={{ left: tipLeft, top: Math.max(y(h.rating) - rad(h.minutes) - 8, 40) }}>
                    <p className="max-w-56 truncate font-semibold text-base-content">{h.title}</p>
                    <p className="tabular-nums text-base-content/80">
                        {h.year} · ★ {h.rating.toFixed(1)}
                        {h.minutes > 0 && ` · ${fmtDuration(h.minutes)}`}
                    </p>
                </div>
            )}
        </div>
    );
}

function QualityMapBox(props) {
    const [ref, w] = useElementWidth();
    return (
        <div ref={ref} className="w-full">
            {w > 0 && <QualityMap {...props} width={w} height={w < 520 ? 230 : 290} />}
        </div>
    );
}

// ─── Chart: rating gauge (semi-circle) ────────────────────────────────────────
function Gauge({ value, top }) {
    const pct = value != null ? Math.min(100, (value / 10) * 100) : 0;
    return (
        <div className="relative mx-auto w-full max-w-64">
            <svg viewBox="0 0 180 104" className="block w-full">
                <path d="M20,90 A70,70 0 0 1 160,90" pathLength="100" fill="none" strokeWidth="12" strokeLinecap="round" className="stroke-base-300" />
                {value != null && (
                    <path
                        d="M20,90 A70,70 0 0 1 160,90"
                        pathLength="100"
                        fill="none"
                        strokeWidth="12"
                        strokeLinecap="round"
                        className="wl-arc stroke-warning"
                        style={{ "--seg": pct }}
                        strokeDasharray={`${pct} 100`}
                    />
                )}
                {[0, 5, 10].map((t) => {
                    const a = Math.PI * (1 - t / 10);
                    return (
                        <text key={t} x={90 + 86 * Math.cos(a)} y={90 - 86 * Math.sin(a) + (t === 5 ? -2 : 12)} textAnchor="middle" className="fill-base-content/60" fontSize="9">
                            {t}
                        </text>
                    );
                })}
            </svg>
            <div className="absolute inset-x-0 bottom-1 text-center">
                <p className="text-3xl font-bold tabular-nums leading-none text-base-content">{value != null ? value.toFixed(1) : "—"}</p>
                <p className="mt-1 text-[11px] text-base-content/60">{top}</p>
            </div>
        </div>
    );
}

// ─── Chart: genre radar ───────────────────────────────────────────────────────
function Radar({ genres, active, onPick }) {
    const W = 320;
    const H = 270;
    const cx = W / 2;
    const cy = H / 2 + 4;
    const R = 80;
    const n = genres.length;
    const max = Math.max(1, ...genres.map(([, v]) => v));
    const ang = (k) => (-90 + (k * 360) / n) * (Math.PI / 180);
    const pt = (k, f) => [cx + R * f * Math.cos(ang(k)), cy + R * f * Math.sin(ang(k))];
    const poly = genres.map(([, v], k) => pt(k, Math.max(v / max, 0.08)).join(",")).join(" ");

    return (
        <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto block w-full max-w-sm" role="img" aria-label="Genre radar">
            {[0.25, 0.5, 0.75, 1].map((f) => (
                <polygon key={f} points={genres.map((_, k) => pt(k, f).join(",")).join(" ")} fill="none" className="stroke-base-content" strokeOpacity={f === 1 ? 0.25 : 0.1} />
            ))}
            {genres.map((_, k) => {
                const [x2, y2] = pt(k, 1);
                return <line key={k} x1={cx} y1={cy} x2={x2} y2={y2} className="stroke-base-content" strokeOpacity="0.1" />;
            })}
            <polygon points={poly} className="wl-grow fill-primary/25 stroke-primary" strokeWidth="2" strokeLinejoin="round" style={{ transformBox: "view-box", transformOrigin: `${cx}px ${cy}px` }} />
            {genres.map(([g, v], k) => {
                const [px, py] = pt(k, Math.max(v / max, 0.08));
                const [lx, ly] = pt(k, 1.2);
                const c = Math.cos(ang(k));
                const on = active === g;
                return (
                    <g key={g}>
                        <circle cx={px} cy={py} r={on ? 5 : 3.5} className={`wl-dotin ${on ? "fill-warning" : "fill-primary"} stroke-base-100`} strokeWidth="1.5" style={{ "--i": k + 4 }}>
                            <title>{`${g} — ${v} title${v !== 1 ? "s" : ""}`}</title>
                        </circle>
                        <text
                            x={lx}
                            y={ly + 3.5}
                            textAnchor={Math.abs(c) < 0.2 ? "middle" : c > 0 ? "start" : "end"}
                            fontSize="10.5"
                            fontWeight={on ? 700 : 500}
                            className={`cursor-pointer ${on ? "fill-primary" : "fill-base-content/80 hover:fill-base-content"}`}
                            onClick={() => onPick(g)}>
                            {g} <tspan className="fill-base-content/45">{v}</tspan>
                        </text>
                    </g>
                );
            })}
        </svg>
    );
}

// ─── Chart: dot timeline (unit chart — one dot = one title) ───────────────────
function DotTimeline({ entries, maxAge, onPickKind, activeKind }) {
    const BINS = 24;
    const span = Math.max(maxAge, 14) + 1;
    const bins = Array.from({ length: BINS }, () => []);
    entries.forEach((e) => bins[BINS - 1 - Math.min(BINS - 1, Math.floor((e.age / span) * BINS))].push(e));
    const maxStack = Math.max(1, ...bins.map((b) => b.length));
    const dot = Math.max(5, Math.min(11, Math.floor(150 / maxStack) - 2));

    const counts = { movie: 0, series: 0, anime: 0 };
    entries.forEach((e) => counts[e.kind]++);
    let idx = 0;

    return (
        <div>
            <div className="flex items-end gap-0.5 sm:gap-1" style={{ height: 160 }}>
                {bins.map((b, bi) => (
                    <div key={bi} className="flex h-full flex-1 flex-col-reverse items-center gap-0.5">
                        {b
                            .slice()
                            .sort((p, q) => p.age - q.age)
                            .map((e) => (
                                <span
                                    key={e.key}
                                    title={`${e.title} · saved ${e.age === 0 ? "today" : `${e.age}d ago`}`}
                                    className={`wl-dotin block shrink-0 rounded-full ${KIND[e.kind].bg} ${activeKind && activeKind !== e.kind ? "opacity-25" : ""}`}
                                    style={{ width: dot, height: dot, "--i": idx++ }}
                                />
                            ))}
                    </div>
                ))}
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-base-content/15 pt-1.5 text-[10.5px] text-base-content/65">
                <span>{maxAge}d ago</span>
                <span className="text-base-content/40">→ time →</span>
                <span>Today</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                {Object.keys(KIND)
                    .filter((k) => counts[k] > 0)
                    .map((k) => (
                        <LegendChip key={k} k={k} n={counts[k]} active={activeKind === k} onPick={onPickKind} />
                    ))}
            </div>
        </div>
    );
}

// ─── Chart: evening waffle (each square = a block of watch time) ──────────────
function Waffle({ minutesByKind, activeKind, onPickKind }) {
    const total = Object.values(minutesByKind).reduce((a, b) => a + b, 0);
    if (total <= 0) return <p className="text-xs text-base-content/60">No runtime data yet.</p>;

    // 1 square = 2h, scaled up in 1h steps so the grid never exceeds 100 squares
    let unit = 120;
    while (Math.ceil(total / unit) > 100) unit += 60;
    const cells = Math.ceil(total / unit);
    const order = ["movie", "series", "anime"].filter((k) => minutesByKind[k] > 0);
    const alloc = order.map((k) => ({ k, n: Math.round((minutesByKind[k] / total) * cells) }));
    let sum = alloc.reduce((a, b) => a + b.n, 0);
    while (sum < cells) {
        alloc[0].n++;
        sum++;
    }
    while (sum > cells && alloc[0].n > 0) {
        alloc[0].n--;
        sum--;
    }
    const squares = alloc.flatMap((a) => Array.from({ length: a.n }, () => a.k));

    return (
        <div>
            <div className="grid grid-cols-10 gap-1">
                {squares.map((k, i) => (
                    <span
                        key={i}
                        className={`wl-dotin aspect-square rounded-[3px] ${KIND[k].bg} ${activeKind && activeKind !== k ? "opacity-25" : ""}`}
                        style={{ "--i": i }}
                        title={`${KIND[k].label} · ${unit / 60}h`}
                    />
                ))}
            </div>
            <p className="mt-2 text-[11px] text-base-content/55">1 square = {unit / 60}h of watching</p>
            <ul className="mt-3 space-y-1.5">
                {order.map((k) => (
                    <li key={k}>
                        <button onClick={() => onPickKind(activeKind === k ? null : k)} className="flex w-full items-center gap-2 text-xs cursor-pointer">
                            <span className={`h-2 w-2 rounded-sm ${KIND[k].bg}`} />
                            <span className={activeKind === k ? "font-semibold text-base-content" : "text-base-content/80"}>{KIND[k].label}</span>
                            <span className="ml-auto tabular-nums font-semibold text-base-content">{fmtDuration(minutesByKind[k])}</span>
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
}

// ─── Chart: lollipop rows ─────────────────────────────────────────────────────
function Lollipop({ rows, tone = "bg-primary" }) {
    const max = Math.max(1, ...rows.map((r) => r.n));
    return (
        <ul className="space-y-4">
            {rows.map((r, idx) => {
                const pct = (r.n / max) * 100;
                return (
                    <li key={r.label} className="flex items-center gap-3 text-xs" title={`${r.label} — ${r.n} title${r.n !== 1 ? "s" : ""}`}>
                        <span className="w-20 shrink-0 truncate text-base-content/80">{r.label}</span>
                        <div className="relative h-4 flex-1">
                            <div className="absolute inset-x-0 top-1/2 h-px bg-base-content/10" />
                            <div className={`wl-line absolute left-0 top-1/2 h-px ${tone}`} style={{ width: `${pct}%`, "--i": idx }} />
                            <span
                                className={`wl-dotin absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 -translate-x-1/2 rounded-full ring-2 ring-base-100 ${r.warn ? "bg-warning" : tone}`}
                                style={{ left: `${pct}%`, "--i": idx * 3 + 2 }}
                            />
                        </div>
                        <span className="w-6 shrink-0 text-right font-semibold tabular-nums text-base-content">{r.n}</span>
                    </li>
                );
            })}
        </ul>
    );
}

// ─── Top figures strip ────────────────────────────────────────────────────────
function Figure({ icon: Icon, label, value, note, i }) {
    return (
        <div className="wl-rise flex-1 min-w-40 px-5 py-4" style={{ "--i": i }}>
            <div className="flex items-center gap-2 text-base-content/55">
                <Icon size={13} />
                <span className="text-[10px] font-semibold uppercase tracking-widest">{label}</span>
            </div>
            <p className="mt-2 text-2xl sm:text-3xl font-semibold tabular-nums leading-none tracking-tight text-base-content">{value}</p>
            <p className="mt-1.5 truncate text-xs text-base-content/60">{note}</p>
        </div>
    );
}

const FILTERS = [
    { key: "all", label: "All" },
    { key: "movie", label: "Movies" },
    { key: "series", label: "Series" },
];

const SORTS = [
    { key: "recent", label: "Recently added" },
    { key: "oldest", label: "Longest waiting" },
    { key: "title", label: "Title A–Z" },
    { key: "rating", label: "Top rated" },
];

// ─── Page ─────────────────────────────────────────────────────────────────────
const WatchList = () => {
    const { watchlist, movies, series, anime, loading } = useApi();

    const [filter, setFilter] = useState("all");
    const [sort, setSort] = useState("recent");
    const [genre, setGenre] = useState(null);
    const [kind, setKind] = useState(null); // movie | series | anime
    const listRef = useRef(null);

    // "type:id" → full library item. Series/anime keyed by seriesKey.
    const { lookup, animeKeys } = useMemo(() => {
        const map = new Map();
        const ak = new Set();
        (movies ?? []).forEach((m) => map.set(`movie:${m.id}`, m));
        (series ?? []).forEach((s) => map.set(`series:${s.seriesKey ?? s.title}`, s));
        (anime ?? []).forEach((s) => {
            const k = s.seriesKey ?? s.title;
            map.set(`series:${k}`, s);
            ak.add(k);
        });
        return { lookup: map, animeKeys: ak };
    }, [movies, series, anime]);

    const entries = useMemo(
        () =>
            (watchlist ?? []).map((w) => {
                const { full, card } = toCardItem(w, lookup);
                const meta = card.metadata ?? {};
                const type = w.type === "movie" ? "movie" : "series";
                return {
                    key: `${w.type}-${w.id}`,
                    id: w.id,
                    type,
                    kind: type === "movie" ? "movie" : animeKeys.has(w.id) ? "anime" : "series",
                    title: meta.title ?? card.parsed?.title ?? card.title ?? w.name ?? "",
                    rating: meta.rating ?? null,
                    year: meta.year ?? null,
                    genres: meta.genres ?? [],
                    minutes: type === "movie" ? (meta.runtime ?? 0) : seriesMinutes(full),
                    addedAt: w.addedAt,
                    age: daysAgo(w.addedAt),
                    hasMeta: Boolean(full && meta.title),
                    card,
                };
            }),
        [watchlist, lookup, animeKeys],
    );

    // ── Aggregates (always from the full list) ──
    const agg = useMemo(() => {
        const total = entries.length;
        const minutes = entries.reduce((s, e) => s + e.minutes, 0);
        const rated = entries.filter((e) => e.rating != null);
        const avgRating = rated.length ? rated.reduce((s, e) => s + e.rating, 0) / rated.length : null;
        const best = rated.reduce((m, e) => (e.rating > (m?.rating ?? -1) ? e : m), null);
        const avgAge = total ? entries.reduce((s, e) => s + e.age, 0) / total : 0;
        const maxAge = entries.reduce((m, e) => Math.max(m, e.age), 0);
        const oldest = entries.reduce((m, e) => (e.age > (m?.age ?? -1) ? e : m), null);
        const thisWeek = entries.filter((e) => e.age < 7).length;

        const minutesByKind = { movie: 0, series: 0, anime: 0 };
        entries.forEach((e) => (minutesByKind[e.kind] += e.minutes));

        const gMap = new Map();
        entries.forEach((e) => e.genres.forEach((g) => gMap.set(g, (gMap.get(g) ?? 0) + 1)));
        const genres = [...gMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7);

        const dMap = new Map();
        entries.forEach((e) => {
            if (!e.year) return;
            const dec = Math.floor(e.year / 10) * 10;
            dMap.set(dec, (dMap.get(dec) ?? 0) + 1);
        });
        const decades = [...dMap.entries()].sort((a, b) => b[0] - a[0]).map(([d, n]) => ({ label: `${d}s`, n }));

        const waits = [
            { label: "< 1 week", min: 0, max: 7 },
            { label: "1–4 weeks", min: 7, max: 30 },
            { label: "1–3 months", min: 30, max: 90 },
            { label: "3+ months", min: 90, max: Infinity, warn: true },
        ].map((b) => ({ ...b, n: entries.filter((e) => e.age >= b.min && e.age < b.max).length }));

        const points = entries.filter((e) => e.year && e.rating != null).map((e) => ({ key: e.key, title: e.title, year: e.year, rating: e.rating, minutes: e.minutes, kind: e.kind }));

        return {
            total,
            minutes,
            avgRating,
            best,
            ratedN: rated.length,
            avgAge,
            maxAge,
            oldest,
            thisWeek,
            minutesByKind,
            genres,
            decades,
            waits,
            points,
            noMeta: entries.filter((e) => !e.hasMeta).length,
        };
    }, [entries]);

    // ── List filtering / sorting ──
    const counts = useMemo(() => ({ all: entries.length, movie: entries.filter((e) => e.type === "movie").length, series: entries.filter((e) => e.type === "series").length }), [entries]);

    const visible = useMemo(() => {
        let list = filter === "all" ? [...entries] : entries.filter((e) => e.type === filter);
        if (kind) list = list.filter((e) => e.kind === kind);
        if (genre) list = list.filter((e) => e.genres.includes(genre));
        if (sort === "title") list.sort((a, b) => a.title.localeCompare(b.title));
        else if (sort === "rating") list.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
        else if (sort === "oldest") list.sort((a, b) => new Date(a.addedAt) - new Date(b.addedAt));
        else list.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
        return list;
    }, [entries, filter, kind, genre, sort]);

    const groups = useMemo(() => {
        if (sort !== "recent") return [{ label: sort === "title" ? "A – Z" : sort === "rating" ? "Highest rated first" : "Waiting the longest first", items: visible }];
        return BUCKETS.map((label) => ({ label, items: visible.filter((e) => bucketOf(e.addedAt) === label) })).filter((g) => g.items.length > 0);
    }, [visible, sort]);

    const handlePlay = (rawItem) => {
        const base = import.meta.env.VITE_API_URL || "http://localhost:5000";
        const url = rawItem.streamUrl ? `${base}${rawItem.streamUrl}` : null;
        if (url) window.open(url, "_blank");
    };
    const handleTrailer = (normItem) => {
        const key = normItem.raw?.metadata?.trailer;
        if (key) window.open(`https://www.youtube.com/watch?v=${key}`, "_blank");
    };

    // chart clicks filter the list above, then bring it into view
    const pickGenre = (g) => {
        setGenre((cur) => (cur === g ? null : g));
        listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    const pickKind = (k) => {
        setKind(k);
        if (k) listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    // ── Loading ──
    if (loading?.watchlist && entries.length === 0) {
        return (
            <div className="space-y-8">
                <div className="h-10 w-56 rounded bg-base-300 animate-pulse" />
                <div className="flex gap-4">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="shrink-0 w-44 aspect-2/3 rounded-xl bg-base-300 animate-pulse" />
                    ))}
                </div>
            </div>
        );
    }

    const evenings = agg.minutes ? Math.ceil(agg.minutes / 120) : 0;

    return (
        <div className="space-y-10">
            <style>{CSS}</style>

            {/* ── Header ── */}
            <header>
                <div className="flex items-center gap-2 text-primary">
                    <Bookmark size={15} />
                    <span className="text-[11px] font-bold uppercase tracking-widest">Watch next</span>
                </div>
                <h1 className="mt-1 text-3xl sm:text-4xl font-bold text-base-content leading-tight font-circular">Watchlist</h1>
                {entries.length > 0 && (
                    <p className="mt-1 text-sm text-base-content/55 tabular-nums">
                        {entries.length} saved · {fmtDuration(agg.minutes)} to watch · scroll down for insights
                    </p>
                )}
            </header>

            {entries.length === 0 ? (
                <div className="border border-dashed border-base-300 rounded-xl py-24 px-6 flex flex-col items-center text-center">
                    <Bookmark size={28} className="text-base-content/25" />
                    <p className="mt-4 text-base font-semibold text-base-content">Queue is empty</p>
                    <p className="mt-1 text-sm text-base-content/50 max-w-sm">Hit the eye icon or the ⋮ menu on any poster to save it here.</p>
                </div>
            ) : (
                <>
                    {/* ── List first ── */}
                    <section ref={listRef} className="scroll-mt-20">
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-base-300">
                            <div className="flex items-center gap-1">
                                {FILTERS.map((f) => (
                                    <button
                                        key={f.key}
                                        onClick={() => setFilter(f.key)}
                                        className={`relative px-4 py-3 text-sm font-medium transition-colors cursor-pointer ${filter === f.key ? "text-base-content" : "text-base-content/45 hover:text-base-content/80"}`}>
                                        {f.label}
                                        <span className="ml-1.5 text-xs text-base-content/35 tabular-nums">{counts[f.key]}</span>
                                        {filter === f.key && <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-primary" />}
                                    </button>
                                ))}
                            </div>

                            <div className="flex flex-wrap items-center gap-2 pb-2 sm:pb-0">
                                {genre && (
                                    <button
                                        onClick={() => setGenre(null)}
                                        className="inline-flex items-center gap-1.5 rounded-md border border-primary/50 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary cursor-pointer">
                                        {genre}
                                        <X size={12} />
                                    </button>
                                )}
                                {kind && (
                                    <button
                                        onClick={() => setKind(null)}
                                        className="inline-flex items-center gap-1.5 rounded-md border border-accent/50 bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent capitalize cursor-pointer">
                                        {kind}
                                        <X size={12} />
                                    </button>
                                )}
                                <label className="flex items-center gap-2 text-xs text-base-content/50">
                                    <ArrowUpDown size={13} />
                                    <select value={sort} onChange={(e) => setSort(e.target.value)} className="select select-sm select-bordered bg-base-100 text-xs w-40">
                                        {SORTS.map((s) => (
                                            <option key={s.key} value={s.key}>
                                                {s.label}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            </div>
                        </div>

                        {groups.length === 0 ? (
                            <p className="py-14 text-center text-sm text-base-content/45">Nothing matches these filters.</p>
                        ) : (
                            <div className="relative mt-8 ml-1.5">
                                <span className="absolute left-0 top-2 bottom-2 w-px bg-base-300" />
                                <div className="space-y-10">
                                    {groups.map((group) => (
                                        <section key={group.label} className="relative pl-7">
                                            <span className="absolute -left-1 top-1.5 w-2.25 h-2.25 rounded-full bg-base-100 border-2 border-primary" />
                                            <div className="flex items-baseline gap-3 mb-2">
                                                <h2 className="text-base sm:text-lg font-semibold text-base-content">{group.label}</h2>
                                                <span className="text-xs text-base-content/35 font-medium tabular-nums">
                                                    {group.items.length} title{group.items.length !== 1 ? "s" : ""}
                                                </span>
                                            </div>
                                            <div className="flex flex-wrap gap-x-4 gap-y-4">
                                                {group.items.map((e) => (
                                                    <MediaCard key={e.key} item={e.card} onPlay={handlePlay} onWatchTrailer={handleTrailer} />
                                                ))}
                                            </div>
                                        </section>
                                    ))}
                                </div>
                            </div>
                        )}
                    </section>

                    {/* ── Insights (after the cards) ── */}
                    <section className="border-t border-base-content/10 pt-8">
                        <div>
                            <h2 className="text-lg sm:text-xl font-semibold tracking-tight text-base-content">Queue insights</h2>
                            <p className="mt-0.5 text-xs sm:text-sm text-base-content/65">Quality, mix and age of everything waiting in your watchlist.</p>
                        </div>

                        {/* Figures strip */}
                        <div className="mt-4 flex flex-wrap divide-x divide-base-300 overflow-hidden rounded-xl border border-base-300 bg-base-100">
                            <Figure i={0} icon={Layers} label="In queue" value={agg.total} note={agg.thisWeek ? `+${agg.thisWeek} added this week` : "none added this week"} />
                            <Figure
                                i={1}
                                icon={Hourglass}
                                label="To watch"
                                value={fmtDuration(agg.minutes)}
                                note={evenings ? `≈ ${evenings} evening${evenings !== 1 ? "s" : ""} at 2h a day` : "no runtime data"}
                            />
                            <Figure
                                i={2}
                                icon={Star}
                                label="Avg. rating"
                                value={agg.avgRating != null ? agg.avgRating.toFixed(1) : "—"}
                                note={`${agg.ratedN} rated title${agg.ratedN !== 1 ? "s" : ""}`}
                            />
                            <Figure i={3} icon={CalendarClock} label="Avg. wait" value={`${Math.round(agg.avgAge)}d`} note={agg.oldest ? `oldest waiting ${agg.oldest.age}d` : "—"} />
                        </div>

                        {/* Quality map + gauge */}
                        <div className="mt-4 grid gap-4 lg:grid-cols-3">
                            <Panel
                                i={0}
                                className="lg:col-span-2"
                                label="Quality map"
                                title="Rating by release year"
                                sub="Each bubble is a title · bubble size = runtime"
                                right={
                                    <div className="flex items-center gap-3">
                                        {Object.keys(KIND).map((k) => (
                                            <span key={k} className="hidden items-center gap-1 text-[10.5px] text-base-content/65 sm:inline-flex">
                                                <span className={`h-2 w-2 rounded-full ${KIND[k].bg}`} />
                                                {KIND[k].label}
                                            </span>
                                        ))}
                                    </div>
                                }>
                                {agg.points.length === 0 ? (
                                    <p className="text-xs text-base-content/60">Needs titles with a release year and rating from your library.</p>
                                ) : (
                                    <QualityMapBox points={agg.points} avg={agg.avgRating} />
                                )}
                            </Panel>

                            <Panel i={1} label="Rating gauge" title="Queue score" sub="Average TMDB rating of what you saved">
                                <Gauge
                                    value={agg.avgRating}
                                    top={agg.best ? `Best: ${agg.best.title.length > 24 ? `${agg.best.title.slice(0, 24)}…` : agg.best.title} (${agg.best.rating.toFixed(1)})` : "No ratings yet"}
                                />
                            </Panel>
                        </div>

                        {/* Radar + timeline */}
                        <div className="mt-4 grid gap-4 lg:grid-cols-3">
                            <Panel i={2} label="Genre radar" title="Taste shape" sub={genre ? `Filtering: ${genre}` : "Click a genre to filter the list"}>
                                {agg.genres.length < 3 ? (
                                    <p className="text-xs text-base-content/60">Needs at least 3 genres to draw a radar.</p>
                                ) : (
                                    <Radar genres={agg.genres} active={genre} onPick={pickGenre} />
                                )}
                            </Panel>

                            <Panel i={3} className="lg:col-span-2" label="Save timeline" title="When you saved things" sub="One dot per title, newest on the right">
                                <DotTimeline entries={entries} maxAge={agg.maxAge} activeKind={kind} onPickKind={pickKind} />
                            </Panel>
                        </div>

                        {/* Waffle + lollipops */}
                        <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                            <Panel i={4} label="Time budget" title="Evenings to clear the queue" sub="Estimated from runtimes and local episodes">
                                <Waffle minutesByKind={agg.minutesByKind} activeKind={kind} onPickKind={pickKind} />
                            </Panel>

                            <Panel i={5} label="Backlog age" title="How long titles wait" sub="Titles per age group">
                                <Lollipop rows={agg.waits} />
                            </Panel>

                            <Panel i={6} className="md:col-span-2 lg:col-span-1" label="Eras" title="Release decades" sub="Newest decade first">
                                {agg.decades.length === 0 ? <p className="text-xs text-base-content/60">No release-year data yet.</p> : <Lollipop rows={agg.decades.slice(0, 6)} tone="bg-accent" />}
                                {agg.noMeta > 0 && (
                                    <p className="mt-5 border-t border-base-300 pt-3 text-[11px] text-base-content/60">
                                        {agg.noMeta} title{agg.noMeta !== 1 ? "s" : ""} without library metadata are left out of rating, genre, decade and runtime charts.
                                    </p>
                                )}
                            </Panel>
                        </div>
                    </section>
                </>
            )}
        </div>
    );
};

export default WatchList;
