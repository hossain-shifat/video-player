// ============================================================================
// SmartShelves.jsx — auto-generated shelves, built in the browser (no server).
// File: web/src/Components/Media/SmartShelves.jsx
//
// HOW TO USE (no data drilling — reads everything from useApi()):
//     <SmartShelves variant="for-you"  onPlay={...} onWatchTrailer={...} />
//     <SmartShelves variant="discover" onPlay={...} onWatchTrailer={...} />
//
// Each shelf = { id, title, items }. Rendered with the existing MediaRow +
// MediaCard (nothing existing is changed). A shelf is skipped when it has fewer
// than its `min` items, so there are never empty or filler rows.
//
// VARIANTS
//   for-you  : taste-based — "More like X", "Your <genre> fix", "More from
//              <person>", "<Studio> in your library". If taste rules cannot fill
//              the slots (new user, small library) discovery rules fill the rest.
//   discover : Hidden gems, Quick watch, Best of the <decade>, Top rated, Fresh in
//              <genre>, Not watched yet, <Genre> deep dive, <Language> cinema,
//              Epics, Binge-worthy series, New releases.
//
// CHANGES ON EVERY RELOAD
//   • Seed        — a new random seed is made each time the page loads, so shelf
//                   choice, titles (headings), picks and card order all change.
//                   It stays fixed while you navigate inside the app (no reshuffle
//                   when you go back to Home).
//   • Headings    — every rule has several heading templates; one is picked per load.
//   • Memory      — the shelves/picks shown on the previous visit are remembered in
//                   localStorage ("flux.smartShelves.recent.v1") and pushed to the
//                   back of the queue, so two visits in a row differ.
//   • Dedupe      — a title appears in at most ONE shelf of an instance; the two
//                   instances on Home never claim the same rule.
//   • Lazy mount  — each shelf renders only once it scrolls near the viewport.
//
// Tunables: MAX_PER_SHELF, RECENT_KEEP and each rule's `min` below.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { useApi } from "../../Context/apiContext";
import MediaRow from "./MediaRow";

const MAX_PER_SHELF = 20;
const RECENT_KEY = "flux.smartShelves.recent.v1";
const RECENT_KEEP = 12; // how many past picks (person / studio / genre …) are remembered per variant

// New on every page load (module is re-evaluated on reload), constant while navigating inside the SPA.
const SESSION_SEED = `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
const SESSION_RECENT = {}; // variant → what the PREVIOUS visit showed, read once per page load
const SESSION_WRITTEN = {}; // variant → already saved this page load
const CLAIMED = {}; // variant → rule ids it uses, so the other instance skips them

function readRecentOnce(variant) {
    if (!SESSION_RECENT[variant]) {
        let rules = [];
        let sigs = [];
        try {
            const all = JSON.parse(localStorage.getItem(RECENT_KEY) || "{}");
            rules = all[variant]?.rules || [];
            sigs = all[variant]?.sigs || [];
        } catch {
            /* storage blocked — no memory between visits */
        }
        SESSION_RECENT[variant] = { rules: new Set(rules), sigs: new Set(sigs) };
    }
    return SESSION_RECENT[variant];
}

function writeRecentOnce(variant, shelves) {
    if (SESSION_WRITTEN[variant] || !shelves.length) return;
    SESSION_WRITTEN[variant] = true;
    try {
        const all = JSON.parse(localStorage.getItem(RECENT_KEY) || "{}");
        const prevSigs = all[variant]?.sigs || [];
        all[variant] = { rules: shelves.map((s) => s.ruleId), sigs: [...prevSigs, ...shelves.map((s) => s.sig)].slice(-RECENT_KEEP) };
        localStorage.setItem(RECENT_KEY, JSON.stringify(all));
    } catch {
        /* storage blocked — nothing to remember */
    }
}

// ─── tiny helpers (kept inside this file on purpose) ─────────────────────────
const asArray = (x) => (Array.isArray(x) ? x : (x?.items ?? []));
const keyOf = (i) => i.id ?? i.seriesKey ?? i.title;
const norm = (s) =>
    String(s || "")
        .trim()
        .toLowerCase();
const metaOf = (i) => i.metadata || {};
const rateOf = (i) => Number(metaOf(i).rating) || 0;
const votesOf = (i) => Number(metaOf(i).votes) || 0;
const titleOf = (i) => metaOf(i).title || i.parsed?.title || i.title || i.name || "Untitled";
const yearOf = (i) => {
    const m = metaOf(i);
    return Number(m.year) || Number(String(m.releaseDate || m.firstAirDate || "").slice(0, 4)) || 0;
};
const releasedMs = (i) => {
    const m = metaOf(i);
    const t = Date.parse(m.releaseDate || m.firstAirDate || "");
    return Number.isFinite(t) ? t : 0;
};
const runtimeOf = (i) => (i.seasons ? 0 : Number(metaOf(i).runtime) || 0);
const nameOf = (v) => (typeof v === "string" ? v : v?.name);
const genresOf = (i) => {
    const m = metaOf(i);
    return (m.genres || i.category || []).map(nameOf).filter(Boolean);
};
const directorsOf = (i) =>
    (metaOf(i).crew || [])
        .filter((c) => c?.job === "Director")
        .map((c) => c.name)
        .filter(Boolean);
const castOf = (i) =>
    (metaOf(i).cast || [])
        .map((c) => c?.name)
        .filter(Boolean)
        .slice(0, 6);
const companiesOf = (i) => {
    const m = metaOf(i);
    return [...(m.productionCompanies || []), ...(m.companies || []), ...(m.studios || [])].map(nameOf).filter(Boolean);
};
// quality ordering: rating weighted by how many people voted
const qualityScore = (i) => rateOf(i) * Math.log10(votesOf(i) + 1);
const byQuality = (a, b) => qualityScore(b) - qualityScore(a);

// ─── seeded random (same pick all day, different tomorrow) ───────────────────
function seededRandom(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    let a = h >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const pickOne = (arr, rand) => (arr.length ? arr[Math.floor(rand() * arr.length)] : null);
const shuffle = (arr, rand) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
};
const tally = (pool, getter) => {
    const map = new Map();
    for (const item of pool) {
        for (const name of new Set(getter(item))) {
            if (!map.has(name)) map.set(name, []);
            map.get(name).push(item);
        }
    }
    return map;
};

// ─── context built once per render pass ──────────────────────────────────────
function buildContext(pool, history) {
    const byKey = new Map();
    const byTitle = new Map();
    for (const item of pool) {
        byKey.set(String(keyOf(item)), item);
        byTitle.set(norm(titleOf(item)), item);
    }
    const sorted = [...(history || [])].sort((a, b) => new Date(b.watchedAt) - new Date(a.watchedAt));
    const watched = [];
    const watchedKeys = new Set();
    for (const h of sorted) {
        const found = byKey.get(String(h.id)) || byKey.get(String(h.seriesKey ?? h.seriesId ?? "")) || byTitle.get(norm(h.title || h.name));
        if (!found) continue;
        const k = String(keyOf(found));
        if (watchedKeys.has(k)) continue;
        watchedKeys.add(k);
        watched.push(found); // most recent first
    }
    return { pool, watched, watchedKeys };
}

// ─── heading templates — one is picked per page load ─────────────────────────
const T = {
    similar: [
        (t) => `More like ${t}`,
        (t) => `If you liked ${t}`,
        (t) => `Same vibe as ${t}`,
        (t) => `After ${t}, try these`,
        (t) => `Fans of ${t} also watch`,
        (t) => `Keep the ${t} mood going`,
        (t) => `Picked after ${t}`,
    ],
    likeGenre: [(g) => `Your ${g} fix`, (g) => `More ${g} for you`, (g) => `Deep into ${g}`, (g) => `You keep coming back to ${g}`, (g) => `${g}, your way`],
    director: [(n) => `More from ${n}`, (n) => `The ${n} collection`, (n) => `Directed by ${n}`, (n) => `${n}'s work`],
    actor: [(n) => `Starring ${n}`, (n) => `${n} on screen`, (n) => `Watch ${n}`],
    studio: [(s) => `${s} in your library`, (s) => `Made by ${s}`, (s) => `The ${s} shelf`, (s) => `From ${s}`],
    gems: [() => "Hidden gems", () => "Under the radar", () => "Worth a second look", () => "Overlooked favourites"],
    quick: [() => "Quick watch · under 100 min", () => "Short on time?", () => "One-sitting movies"],
    decade: [(l) => `Best of the ${l}`, (l) => `${l} throwback`, (l) => `Back in the ${l}`],
    top: [() => "Top rated in your library", () => "Highest rated", () => "Crowd favourites", () => "The best of your library"],
    fresh: [(g) => `Fresh in ${g}`, (g) => `New in ${g}`, (g) => `Just out: ${g}`],
    unwatched: [() => "Not watched yet", () => "Still on the shelf", () => "Waiting in your library", () => "Your best unwatched"],
    dive: [(g) => `${g} deep dive`, (g) => `All the ${g}`, (g) => `Browse ${g}`],
    lang: [(n) => `${n} cinema`, (n) => `Watch in ${n}`, (n) => `In ${n}`],
    epic: [() => "Settle in · epics", () => "Long and worth it", () => "Clear your evening"],
    binge: [() => "Binge-worthy series", () => "Series to get lost in", () => "Season after season"],
    newest: [() => "New releases", () => "Just released", () => "Recently out"],
};
const say = (list, rand, ...args) => pickOne(list, rand)(...args);

// pick one option, avoiding what the previous visit showed (unless nothing else is left)
const pickFresh = (options, rand, recent, sigOf) => {
    const fresh = options.filter((o) => !recent.sigs.has(sigOf(o)));
    return pickOne(fresh.length ? fresh : options, rand);
};

const langOf = (i) => String(metaOf(i).language || "").toLowerCase();
let _langNames = null;
const langName = (code) => {
    try {
        _langNames = _langNames || new Intl.DisplayNames(["en"], { type: "language" });
        return _langNames.of(code) || code.toUpperCase();
    } catch {
        return code.toUpperCase();
    }
};

// ─── FOR-YOU rules (taste) ───────────────────────────────────────────────────
function relatedTo(source, ctx) {
    const sg = new Set(genresOf(source));
    const sd = new Set(directorsOf(source));
    const sc = new Set(castOf(source));
    const sp = new Set(companiesOf(source));
    const sk = String(keyOf(source));
    const scored = [];
    for (const i of ctx.pool) {
        const k = String(keyOf(i));
        if (k === sk || ctx.watchedKeys.has(k)) continue;
        const g = genresOf(i).filter((x) => sg.has(x)).length;
        const d = directorsOf(i).filter((x) => sd.has(x)).length;
        const c = castOf(i).filter((x) => sc.has(x)).length;
        const p = companiesOf(i).filter((x) => sp.has(x)).length;
        const overlap = g * 2 + d * 4 + c * 1.5 + p * 2;
        if (overlap < 3) continue; // needs a real link, not one weak genre
        scored.push({ i, s: overlap + (Boolean(i.seasons) === Boolean(source.seasons) ? 1 : 0) + rateOf(i) / 10 });
    }
    return scored.sort((a, b) => b.s - a.s).map((x) => x.i);
}

function forYouRules(ctx, rand) {
    const rules = [];

    // 1 · "More like X" — from recently watched titles (two shelves at most)
    shuffle(ctx.watched.slice(0, 8), rand).forEach((src) => {
        rules.push({
            id: `similar-${keyOf(src)}`,
            rid: "similar",
            min: 8,
            cap: 2,
            build: (rr) => ({ title: say(T.similar, rr, titleOf(src)), items: relatedTo(src, ctx), sorted: false, sig: `similar:${keyOf(src)}` }),
        });
    });

    // 2 · "Your <genre> fix" — one of your top genres
    rules.push({
        id: "like-genre",
        min: 8,
        build: (rr, recent) => {
            const counts = new Map();
            ctx.watched.forEach((w) => genresOf(w).forEach((g) => counts.set(g, (counts.get(g) || 0) + 1)));
            const top = [...counts.entries()]
                .filter(([, n]) => n >= 2)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3);
            const chosen = pickFresh(top, rr, recent, ([g]) => `like:${g}`);
            if (!chosen) return null;
            const items = ctx.pool.filter((i) => !ctx.watchedKeys.has(String(keyOf(i))) && genresOf(i).includes(chosen[0]) && rateOf(i) >= 6.5).sort(byQuality);
            return { title: say(T.likeGenre, rr, chosen[0]), items, sig: `like:${chosen[0]}` };
        },
    });

    // 3 · director / actor spotlight
    rules.push({
        id: "person",
        min: 4,
        build: (rr, recent) => {
            const dirs = [...tally(ctx.pool, directorsOf).entries()].filter(([, v]) => v.length >= 4);
            const acts = [...tally(ctx.pool, castOf).entries()].filter(([, v]) => v.length >= 6);
            const top = (list) => list.sort((a, b) => b[1].length - a[1].length).slice(0, 6);
            const options = [...top(dirs).map(([n, v]) => ({ kind: "director", n, v })), ...top(acts).map(([n, v]) => ({ kind: "actor", n, v }))];
            const chosen = pickFresh(options, rr, recent, (o) => `person:${o.n}`);
            return chosen ? { title: say(T[chosen.kind], rr, chosen.n), items: chosen.v, sig: `person:${chosen.n}` } : null;
        },
    });

    // 4 · studio spotlight
    rules.push({
        id: "studio",
        min: 6,
        build: (rr, recent) => {
            const list = [...tally(ctx.pool, companiesOf).entries()]
                .filter(([, v]) => v.length >= 6)
                .sort((a, b) => b[1].length - a[1].length)
                .slice(0, 8);
            const chosen = pickFresh(list, rr, recent, ([n]) => `studio:${n}`);
            return chosen ? { title: say(T.studio, rr, chosen[0]), items: chosen[1], sig: `studio:${chosen[0]}` } : null;
        },
    });

    return rules;
}

// ─── DISCOVER rules ──────────────────────────────────────────────────────────
function discoverRules(ctx) {
    const now = Date.now();
    const rules = [];

    rules.push({
        id: "hidden-gems",
        min: 8,
        build: (rr) => {
            const votes = ctx.pool
                .map(votesOf)
                .filter(Boolean)
                .sort((a, b) => a - b);
            const median = votes.length ? votes[Math.floor(votes.length / 2)] : 0;
            return { title: say(T.gems, rr), items: ctx.pool.filter((i) => rateOf(i) >= 7.3 && votesOf(i) >= 100 && votesOf(i) <= median), sig: "hidden-gems" };
        },
    });

    rules.push({
        id: "quick-watch",
        min: 8,
        build: (rr) => ({ title: say(T.quick, rr), items: ctx.pool.filter((i) => runtimeOf(i) > 0 && runtimeOf(i) <= 100 && rateOf(i) >= 6.5), sig: "quick-watch" }),
    });

    rules.push({
        id: "epics",
        min: 8,
        build: (rr) => ({ title: say(T.epic, rr), items: ctx.pool.filter((i) => runtimeOf(i) >= 150 && rateOf(i) >= 6.5), sig: "epics" }),
    });

    rules.push({
        id: "binge",
        min: 8,
        build: (rr) => ({ title: say(T.binge, rr), items: ctx.pool.filter((i) => i.seasons && Object.keys(i.seasons).length >= 3 && rateOf(i) >= 7), sig: "binge" }),
    });

    rules.push({
        id: "decade",
        min: 8,
        build: (rr, recent) => {
            const decades = new Map();
            ctx.pool.forEach((i) => {
                const y = yearOf(i);
                if (!y || rateOf(i) < 6.5) return;
                const d = Math.floor(y / 10) * 10;
                if (!decades.has(d)) decades.set(d, []);
                decades.get(d).push(i);
            });
            const ok = [...decades.entries()].filter(([, v]) => v.length >= 8);
            const chosen = pickFresh(ok, rr, recent, ([d]) => `decade:${d}`);
            if (!chosen) return null;
            const label = chosen[0] >= 2000 ? `${chosen[0]}s` : `${String(chosen[0]).slice(2)}s`;
            return { title: say(T.decade, rr, label), items: chosen[1], sig: `decade:${chosen[0]}` };
        },
    });

    rules.push({
        id: "top-rated",
        min: 8,
        build: (rr) => ({ title: say(T.top, rr), items: ctx.pool.filter((i) => rateOf(i) >= 7.5 && votesOf(i) >= 500), sig: "top-rated" }),
    });

    rules.push({
        id: "fresh-genre",
        min: 6,
        build: (rr, recent) => {
            const fresh = ctx.pool.filter((i) => {
                const t = releasedMs(i);
                return t && t <= now && now - t <= 730 * 86400000;
            });
            const list = [...tally(fresh, genresOf).entries()].filter(([, v]) => v.length >= 6);
            const chosen = pickFresh(list, rr, recent, ([g]) => `fresh:${g}`);
            return chosen ? { title: say(T.fresh, rr, chosen[0]), items: chosen[1], sig: `fresh:${chosen[0]}` } : null;
        },
    });

    rules.push({
        id: "new-releases",
        min: 8,
        build: (rr) => ({
            title: say(T.newest, rr),
            items: ctx.pool.filter((i) => releasedMs(i) && releasedMs(i) <= now && now - releasedMs(i) <= 365 * 86400000).sort((a, b) => releasedMs(b) - releasedMs(a)),
            sorted: false,
            sig: "new-releases",
        }),
    });

    rules.push({
        id: "not-watched",
        min: 8,
        build: (rr) => ({ title: say(T.unwatched, rr), items: ctx.pool.filter((i) => !ctx.watchedKeys.has(String(keyOf(i))) && rateOf(i) >= 7.2), sig: "not-watched" }),
    });

    rules.push({
        id: "genre-dive",
        min: 10,
        build: (rr, recent) => {
            const list = [...tally(ctx.pool, genresOf).entries()].map(([g, v]) => [g, v.filter((i) => rateOf(i) >= 6)]).filter(([, v]) => v.length >= 10);
            const chosen = pickFresh(list, rr, recent, ([g]) => `dive:${g}`);
            return chosen ? { title: say(T.dive, rr, chosen[0]), items: chosen[1], sig: `dive:${chosen[0]}` } : null;
        },
    });

    rules.push({
        id: "language",
        min: 8,
        build: (rr, recent) => {
            const list = [...tally(ctx.pool, (i) => (langOf(i) && langOf(i) !== "en" ? [langOf(i)] : [])).entries()].filter(([, v]) => v.length >= 8);
            const chosen = pickFresh(list, rr, recent, ([c]) => `lang:${c}`);
            return chosen ? { title: say(T.lang, rr, langName(chosen[0])), items: chosen[1], sig: `lang:${chosen[0]}` } : null;
        },
    });

    return rules;
}

// ─── engine ──────────────────────────────────────────────────────────────────
function buildShelves({ movies, series, anime, history, variant, max }) {
    const pool = [...movies, ...series, ...anime].filter((i) => keyOf(i) != null);
    if (!pool.length) return [];

    const recent = readRecentOnce(variant);
    const rand = seededRandom(`${SESSION_SEED}:${variant}`);
    const ctx = buildContext(pool, history);
    const otherClaimed = CLAIMED[variant === "discover" ? "for-you" : "discover"] || new Set();

    // shuffle, then push whatever the previous visit showed to the back of the queue
    const ridOf = (r) => r.rid || r.id;
    const order = (list) => {
        const sh = shuffle(list, rand);
        return [...sh.filter((r) => !recent.rules.has(ridOf(r))), ...sh.filter((r) => recent.rules.has(ridOf(r)))];
    };

    // for-you: taste rules first; discovery rules only fill what taste could not
    const rules = variant === "discover" ? order(discoverRules(ctx)) : [...order(forYouRules(ctx, rand)), ...order(discoverRules(ctx))];

    const used = new Set();
    const groupCount = {};
    const shelves = [];
    for (const rule of rules) {
        if (shelves.length >= max) break;
        const rid = ridOf(rule);
        if (otherClaimed.has(rid) || shelves.some((s) => s.ruleId === rid && !rule.cap)) continue;
        if (rule.cap && (groupCount[rid] || 0) >= rule.cap) continue;
        const rr = seededRandom(`${SESSION_SEED}:${variant}:${rule.id}`); // per-rule → titles stay put if other data changes
        const built = rule.build(rr, recent);
        if (!built) continue;
        const candidates = [...new Map(built.items.map((i) => [String(keyOf(i)), i])).values()].filter((i) => !used.has(String(keyOf(i))));
        if (candidates.length < rule.min) continue;
        const sorted = built.sorted === false ? candidates : [...candidates].sort(byQuality);
        const items = shuffle(sorted.slice(0, MAX_PER_SHELF * 2), rr).slice(0, MAX_PER_SHELF);
        items.forEach((i) => used.add(String(keyOf(i))));
        groupCount[rid] = (groupCount[rid] || 0) + 1;
        shelves.push({ id: rule.id, ruleId: rid, sig: built.sig || rule.id, title: built.title, items });
    }
    CLAIMED[variant] = new Set(shelves.map((s) => s.ruleId));
    return shelves;
}

// ─── lazy mount — renders a shelf only when it scrolls near the viewport ─────
function LazyShelf({ shelf, onPlay, onWatchTrailer }) {
    const ref = useRef(null);
    const [show, setShow] = useState(false);

    useEffect(() => {
        const el = ref.current;
        if (!el || show) return undefined;
        if (typeof IntersectionObserver === "undefined") {
            setShow(true);
            return undefined;
        }
        const io = new IntersectionObserver(
            ([e]) => {
                if (e.isIntersecting) {
                    setShow(true);
                    io.disconnect();
                }
            },
            { rootMargin: "500px 0px" },
        );
        io.observe(el);
        return () => io.disconnect();
    }, [show]);

    return (
        <div ref={ref} className="min-h-0">
            {show ? <MediaRow title={shelf.title} items={shelf.items} onPlay={onPlay} onWatchTrailer={onWatchTrailer} /> : <MediaRow title={shelf.title} items={[]} loading />}
        </div>
    );
}

/**
 * SmartShelves
 * Props:
 *   variant        — "for-you" | "discover"  (default "for-you")
 *   max            — max shelves to show (default 4)
 *   onPlay         — (rawItem) => void       (passed through to MediaRow)
 *   onWatchTrailer — (normItem) => void      (passed through to MediaRow)
 */
export default function SmartShelves({ variant = "for-you", max = 4, onPlay, onWatchTrailer }) {
    const { movies, series, anime, history } = useApi();

    const shelves = useMemo(
        () =>
            buildShelves({
                movies: asArray(movies),
                series: asArray(series),
                anime: asArray(anime),
                history: history || [],
                variant,
                max,
            }),
        [movies, series, anime, history, variant, max],
    );

    // remember what this visit showed so the NEXT visit picks something else (once per page load)
    useEffect(() => {
        writeRecentOnce(variant, shelves);
    }, [variant, shelves]);

    if (!shelves.length) return null;

    return (
        <div id={`smart-shelves-${variant}`} className="space-y-5">
            {shelves.map((shelf) => (
                <LazyShelf key={shelf.id} shelf={shelf} onPlay={onPlay} onWatchTrailer={onWatchTrailer} />
            ))}
        </div>
    );
}
