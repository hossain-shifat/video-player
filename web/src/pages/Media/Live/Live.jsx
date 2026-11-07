import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Tv, Search, ChevronLeft, ChevronRight, Radio, Play } from "lucide-react";
import { getLiveChannels, getLiveCategories } from "../../../Api/live";
import { useAuth } from "../../../Hooks/Auth/useAuth";

const SEARCH_DEBOUNCE_MS = 350;
const ROW_LIMIT = 20;
const BANNER_INTERVAL = 5000; // ms per slide

// ── base64url encode (same as LiveCard) ──────────────────────────────────────
function toBase64Url(str) {
    const b64 = btoa(unescape(encodeURIComponent(str)));
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ── EPG helpers ───────────────────────────────────────────────────────────────
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

// ── Skeletons ─────────────────────────────────────────────────────────────────
function BannerSkeleton() {
    return <div className="w-full rounded-2xl bg-base-300 animate-pulse" style={{ minHeight: 220 }} />;
}
function CardSkeleton() {
    return (
        <div className="shrink-0 w-36 sm:w-44">
            <div className="aspect-video rounded-xl bg-base-300 animate-pulse" />
            <div className="h-3 w-3/4 rounded bg-base-300 animate-pulse mt-2" />
            <div className="h-2.5 w-1/2 rounded bg-base-300 animate-pulse mt-1.5" />
        </div>
    );
}

// ── LiveBrowseCard — logo-focused, smaller, for category rows ─────────────────
// Separate from LiveCard (which is the wider EPG-aware card used elsewhere).
// Routes to /live/watch/:base64url same as LiveCard.
function LiveBrowseCard({ item }) {
    const [imgErr, setImgErr] = useState(false);
    const name = item.cleanName || item.name || "Channel";
    const thumb = !imgErr ? item.logo || null : null;
    const category = item.category;
    const progress = getProgress(item.current);

    return (
        <Link
            to={`/live/watch/${toBase64Url(item.url)}`}
            state={{ streamUrl: item.url, channelName: name, channelLogo: item.logo }}
            className="group shrink-0 w-36 sm:w-44 cursor-pointer select-none no-underline flex flex-col gap-1.5">
            <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-base-300 ring-1 ring-white/5 transition-transform duration-200 group-hover:scale-[1.03] group-hover:shadow-xl group-hover:ring-white/20">
                {thumb ? (
                    <img src={thumb} alt={name} className="w-full h-full object-contain p-2 bg-black/20" loading="lazy" draggable={false} onError={() => setImgErr(true)} />
                ) : (
                    <div className="w-full h-full flex items-center justify-center bg-base-200">
                        <Tv size={20} className="text-base-content/20" />
                    </div>
                )}

                <div className="absolute inset-0 bg-linear-to-t from-black/50 via-transparent to-transparent" />
                <span className="absolute top-1.5 right-1.5 text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-error/90 text-white">LIVE</span>

                {progress !== null && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/40">
                        <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                    </div>
                )}
            </div>

            <div className="px-0.5">
                <p className="text-[12px] font-medium text-base-content truncate leading-tight">{name}</p>
                {category && category !== "General" && <p className="text-[10px] text-base-content/40 truncate mt-0.5">{category}</p>}
            </div>
        </Link>
    );
}

// ── Carousel banner ───────────────────────────────────────────────────────────
// Auto-advances every BANNER_INTERVAL ms. Shows channel logo, name,
// current EPG event (programme title / time left), and a Watch button.
function CarouselBanner({ channels }) {
    const [idx, setIdx] = useState(0);
    const timerRef = useRef(null);

    const count = channels.length;

    const go = useCallback(
        (next) => {
            setIdx((i) => (next + count) % count);
        },
        [count],
    );

    // Reset + restart timer whenever channels list changes or user navigates
    const resetTimer = useCallback(() => {
        clearInterval(timerRef.current);
        timerRef.current = setInterval(() => go(idx + 1), BANNER_INTERVAL);
    }, [go, idx]);

    useEffect(() => {
        if (count === 0) return;
        timerRef.current = setInterval(() => setIdx((i) => (i + 1) % count), BANNER_INTERVAL);
        return () => clearInterval(timerRef.current);
    }, [count]);

    if (count === 0) return <BannerSkeleton />;

    const ch = channels[idx];
    const name = ch.cleanName || ch.name || "Live Channel";
    const programme = ch.current;
    const progTitle = programme?.title;
    const timeLeft = getTimeLeft(programme);
    const progress = getProgress(programme);
    const nextProg = ch.next?.title;

    function prev() {
        clearInterval(timerRef.current);
        go(idx - 1);
        resetTimer();
    }
    function next() {
        clearInterval(timerRef.current);
        go(idx + 1);
        resetTimer();
    }

    return (
        <div className="relative w-full rounded-2xl overflow-hidden bg-base-200 select-none" style={{ minHeight: 220 }}>
            {/* Blurred backdrop */}
            {ch.logo && <img src={ch.logo} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-cover opacity-10 blur-2xl scale-110" loading="lazy" />}

            {/* Gradient */}
            <div className="absolute inset-0 bg-linear-to-r from-black/90 via-black/50 to-transparent" />
            <div className="absolute inset-0 bg-linear-to-t from-black/60 via-transparent to-transparent" />

            {/* Content */}
            <div className="relative z-10 flex items-center gap-5 p-6 sm:p-8 h-full min-h-[220px]">
                {/* Logo */}
                <div className="shrink-0 w-20 h-20 sm:w-24 sm:h-24 rounded-2xl overflow-hidden bg-white/10 flex items-center justify-center ring-1 ring-white/10">
                    {ch.logo ? <img src={ch.logo} alt={name} className="w-full h-full object-contain p-2" loading="lazy" /> : <Tv size={28} className="text-white/30" />}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0 flex flex-col gap-2">
                    {/* LIVE badge + category */}
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-error text-white">
                            <Radio size={7} className="animate-pulse" /> LIVE
                        </span>
                        {ch.category && ch.category !== "General" && <span className="text-[10px] text-white/40 font-medium">{ch.category}</span>}
                        {ch.country && ch.country !== "Unknown" && <span className="text-[10px] text-white/30">{ch.country}</span>}
                    </div>

                    {/* Channel name */}
                    <h2 className="text-white font-bold text-xl sm:text-3xl leading-tight truncate">{name}</h2>

                    {/* Current programme */}
                    {progTitle && (
                        <div className="flex flex-col gap-1">
                            <p className="text-white/80 text-sm font-medium truncate">▶ {progTitle}</p>
                            {timeLeft && <p className="text-white/40 text-xs">{timeLeft}</p>}

                            {/* Progress bar */}
                            {progress !== null && (
                                <div className="w-full max-w-xs h-1 rounded-full bg-white/10 overflow-hidden">
                                    <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${progress}%` }} />
                                </div>
                            )}

                            {/* Next programme */}
                            {nextProg && <p className="text-white/25 text-[10px] truncate">Next: {nextProg}</p>}
                        </div>
                    )}

                    {/* Watch button */}
                    <Link
                        to={`/live/watch/${toBase64Url(ch.url)}`}
                        state={{ streamUrl: ch.url, channelName: name, channelLogo: ch.logo }}
                        className="mt-1 self-start inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-primary text-primary-content font-semibold text-sm hover:opacity-90 active:scale-95 transition-all no-underline">
                        <Play size={13} fill="currentColor" /> Watch Now
                    </Link>
                </div>
            </div>

            {/* Prev / Next arrows */}
            {count > 1 && (
                <>
                    <button
                        onClick={prev}
                        className="absolute left-2 top-1/2 -translate-y-1/2 z-20 w-8 h-8 rounded-full bg-black/40 hover:bg-black/70 flex items-center justify-center text-white transition-colors border-none cursor-pointer">
                        <ChevronLeft size={16} />
                    </button>
                    <button
                        onClick={next}
                        className="absolute right-2 top-1/2 -translate-y-1/2 z-20 w-8 h-8 rounded-full bg-black/40 hover:bg-black/70 flex items-center justify-center text-white transition-colors border-none cursor-pointer">
                        <ChevronRight size={16} />
                    </button>

                    {/* Dots */}
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex gap-1.5">
                        {channels.map((_, i) => (
                            <button
                                key={i}
                                onClick={() => {
                                    clearInterval(timerRef.current);
                                    setIdx(i);
                                    resetTimer();
                                }}
                                className={`w-1.5 h-1.5 rounded-full transition-all border-none cursor-pointer ${i === idx ? "bg-white w-4" : "bg-white/30"}`}
                            />
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

// ── Category row ──────────────────────────────────────────────────────────────
function CategoryRow({ category, enabled }) {
    const rowRef = useRef(null);
    const { data, isLoading } = useQuery({
        queryKey: ["live", "channels", { category: category.name, page: 1, limit: ROW_LIMIT }],
        queryFn: () => getLiveChannels({ category: category.name, page: 1, limit: ROW_LIMIT }),
        enabled,
        staleTime: 60 * 1000,
    });
    const channels = data?.channels ?? [];
    const total = data?.total ?? 0;
    if (!isLoading && channels.length === 0) return null;
    const scroll = (dir) => rowRef.current?.scrollBy({ left: dir * 500, behavior: "smooth" });

    return (
        <section>
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <h2 className="text-base sm:text-lg font-semibold text-base-content">{category.name}</h2>
                    {total > 0 && <span className="text-xs text-base-content/35 bg-base-300 px-2 py-0.5 rounded-full">{total}</span>}
                </div>
                <div className="hidden sm:flex gap-1">
                    <button
                        onClick={() => scroll(-1)}
                        aria-label="Scroll left"
                        className="w-7 h-7 rounded-full bg-base-300 hover:bg-base-200 flex items-center justify-center text-base-content/60 hover:text-base-content transition-colors border-none cursor-pointer">
                        <ChevronLeft size={14} />
                    </button>
                    <button
                        onClick={() => scroll(1)}
                        aria-label="Scroll right"
                        className="w-7 h-7 rounded-full bg-base-300 hover:bg-base-200 flex items-center justify-center text-base-content/60 hover:text-base-content transition-colors border-none cursor-pointer">
                        <ChevronRight size={14} />
                    </button>
                </div>
            </div>
            <div ref={rowRef} className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                {isLoading ? Array.from({ length: 8 }).map((_, i) => <CardSkeleton key={i} />) : channels.map((ch, i) => <LiveBrowseCard key={ch.id ?? ch.url ?? i} item={ch} />)}
            </div>
        </section>
    );
}

// ── Search grid ───────────────────────────────────────────────────────────────
function SearchGrid({ q, enabled }) {
    const PAGE_LIMIT = 25;
    const [page, setPage] = useState(1);
    useEffect(() => {
        setPage(1);
    }, [q]);

    const { data, isLoading, isFetching, error } = useQuery({
        queryKey: ["live", "channels", { q, page }],
        queryFn: () => getLiveChannels({ q, page, limit: PAGE_LIMIT }),
        enabled: enabled && !!q,
        staleTime: 60 * 1000,
    });
    const channels = data?.channels ?? [];
    const total = data?.total ?? 0;
    const totalPages = Math.max(1, data?.totalPages ?? Math.ceil(total / PAGE_LIMIT));

    if (error) return <p className="text-sm text-error">Search failed: {error.message}</p>;
    if (isLoading)
        return (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {Array.from({ length: PAGE_LIMIT }).map((_, i) => (
                    <CardSkeleton key={i} />
                ))}
            </div>
        );
    if (!channels.length) return <p className="text-base-content/40 text-sm py-10 text-center">No channels found for &ldquo;{q}&rdquo;.</p>;

    return (
        <>
            <p className="text-xs text-base-content/40 mb-3">
                {total} result{total !== 1 ? "s" : ""} for &ldquo;{q}&rdquo;
            </p>
            <div className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 transition-opacity ${isFetching ? "opacity-60" : ""}`}>
                {channels.map((ch, i) => (
                    <LiveBrowseCard key={ch.id ?? ch.url ?? i} item={ch} />
                ))}
            </div>
            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 pt-4">
                    <button
                        disabled={page <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        className="px-3 py-1.5 rounded-md text-sm bg-base-300 disabled:opacity-30 text-base-content/70 hover:text-base-content border-none cursor-pointer">
                        Prev
                    </button>
                    <span className="text-xs text-base-content/45">
                        Page {page} / {totalPages}
                    </span>
                    <button
                        disabled={page >= totalPages}
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        className="px-3 py-1.5 rounded-md text-sm bg-base-300 disabled:opacity-30 text-base-content/70 hover:text-base-content border-none cursor-pointer">
                        Next
                    </button>
                </div>
            )}
        </>
    );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Live() {
    // Listings are browsable by any VERIFIED account (pending approval included); the server strips the
    // stream address unless the account may actually watch.
    const { isAuthenticated, isEmailVerified, loading: authLoading } = useAuth();
    const enabled = !authLoading && isAuthenticated && isEmailVerified;

    const [searchInput, setSearchInput] = useState("");
    const [q, setQ] = useState("");
    const debounceRef = useRef(null);

    function handleSearchChange(value) {
        setSearchInput(value);
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => setQ(value), SEARCH_DEBOUNCE_MS);
    }
    useEffect(() => () => clearTimeout(debounceRef.current), []);

    // Categories
    const { data: categoriesData, isLoading: catLoading } = useQuery({
        queryKey: ["live", "categories"],
        queryFn: getLiveCategories,
        enabled,
        staleTime: 5 * 60 * 1000,
    });
    const categories = categoriesData?.categories ?? [];

    // Banner channels — fetch first page of Sports (or all if no Sports category),
    // prefer channels that have a current EPG programme for the event display.
    // Try "Sports" first, fall back to first available category.
    const sportsCat = categories.find((c) => /sport/i.test(c.name))?.name || null;
    const bannerCat = sportsCat || (categories[0]?.name ?? null);
    const { data: bannerData } = useQuery({
        queryKey: ["live", "channels", { category: bannerCat, page: 1, limit: 12 }],
        queryFn: () => getLiveChannels({ category: bannerCat || undefined, page: 1, limit: 12 }),
        enabled: enabled && !!bannerCat,
        staleTime: 60 * 1000,
    });
    // Prefer channels with a current programme for the carousel (more interesting)
    const bannerChannels = (() => {
        const all = bannerData?.channels ?? [];
        const withEpg = all.filter((c) => c.current?.title);
        const withLogo = all.filter((c) => c.logo);
        if (withEpg.length >= 3) return withEpg.slice(0, 8);
        if (withLogo.length >= 3) return withLogo.slice(0, 8);
        return all.slice(0, 8);
    })();

    if (!authLoading && !enabled) {
        return (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
                <Tv size={36} className="text-base-content/25" />
                <p className="text-base-content/50 text-sm">Sign in to watch Live TV.</p>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                    <Tv size={22} className="text-primary" />
                    <h1 className="text-2xl sm:text-3xl font-bold text-base-content">Live TV</h1>
                </div>
                <div className="flex items-center gap-2 bg-base-300 rounded-md px-3 h-9 w-full sm:w-64">
                    <Search size={16} className="text-base-content/50 shrink-0" />
                    <input
                        type="text"
                        value={searchInput}
                        onChange={(e) => handleSearchChange(e.target.value)}
                        placeholder="Search channels..."
                        className="bg-transparent outline-none text-sm text-base-content placeholder:text-base-content/40 w-full"
                    />
                </div>
            </div>

            {/* Search mode → grid */}
            {q ? (
                <SearchGrid q={q} enabled={enabled} />
            ) : (
                <div className="space-y-10">
                    {/* Carousel banner */}
                    {catLoading || bannerChannels.length === 0 ? <BannerSkeleton /> : <CarouselBanner channels={bannerChannels} />}

                    {/* Category rows */}
                    {catLoading ? (
                        Array.from({ length: 3 }).map((_, ri) => (
                            <section key={ri}>
                                <div className="h-5 w-32 rounded bg-base-300 animate-pulse mb-3" />
                                <div className="flex gap-3 overflow-hidden">
                                    {Array.from({ length: 6 }).map((_, i) => (
                                        <CardSkeleton key={i} />
                                    ))}
                                </div>
                            </section>
                        ))
                    ) : categories.length === 0 ? (
                        <p className="text-base-content/40 text-sm py-10 text-center">No live channels yet. Add a source from the admin dashboard (IPTV tab).</p>
                    ) : (
                        categories.map((cat) => <CategoryRow key={cat.name} category={cat} enabled={enabled} />)
                    )}
                </div>
            )}
        </div>
    );
}
