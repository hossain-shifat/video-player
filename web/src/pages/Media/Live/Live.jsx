import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
    Tv,
    Search,
    Play,
    Star,
    Wifi,
    WifiOff,
    AlertCircle,
    ChevronLeft,
    ChevronRight,
    Radio,
    Zap,
    Trophy,
    Globe,
    Film,
    Music,
    BookOpen,
    Baby,
    Newspaper,
    SlidersHorizontal,
    X,
    RefreshCw,
    Clock,
} from "lucide-react";
import { getLiveChannels, getLiveCategories } from "../../../api/live";
import { getHistory } from "../../../api";
import { useAuth } from "../../../auth/useAuth";

// ─── Constants ────────────────────────────────────────────────────────────────
const PAGE_LIMIT = 24;
const CAROUSEL_LIMIT = 20;
const DEBOUNCE_MS = 350;
const REFRESH_INTERVAL_MS = 60_000;

// Category → icon map
const CATEGORY_ICONS = {
    News: Newspaper,
    Sports: Trophy,
    Movies: Film,
    Entertainment: Star,
    Kids: Baby,
    Music: Music,
    Documentary: BookOpen,
    General: Tv,
    Religious: Globe,
    Education: BookOpen,
    Shopping: Globe,
};
function CatIcon({ name, size = 14 }) {
    const Icon = CATEGORY_ICONS[name] || Tv;
    return <Icon size={size} />;
}

// ─── Status helpers ───────────────────────────────────────────────────────────
function StatusDot({ status, size = "sm" }) {
    const sz = size === "sm" ? "w-2 h-2" : "w-2.5 h-2.5";
    const map = {
        working: "bg-success",
        offline: "bg-error",
        timeout: "bg-warning",
        unknown: "bg-base-content/30",
    };
    return <span className={`${sz} rounded-full shrink-0 ${map[status] ?? map.unknown}`} />;
}

function LiveBadge({ pulse = true }) {
    return (
        <span className="flex items-center gap-1 bg-error text-error-content text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded">
            {pulse && <span className="w-1.5 h-1.5 rounded-full bg-error-content animate-pulse" />}
            LIVE
        </span>
    );
}

function QualityBadge({ resolution, isHD }) {
    if (!resolution && !isHD) return null;
    const label = resolution || (isHD ? "HD" : null);
    if (!label) return null;
    return <span className="text-[9px] font-bold uppercase tracking-wider bg-base-content/10 text-base-content/60 px-1.5 py-0.5 rounded">{label}</span>;
}

// ─── Logo image with fallback ─────────────────────────────────────────────────
function ChannelLogo({ logo, name, className = "" }) {
    const [err, setErr] = useState(false);
    const initials = (name || "?")
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0])
        .join("")
        .toUpperCase();
    return err || !logo ? (
        <div className={`flex items-center justify-center bg-base-300 text-base-content/40 font-bold text-sm rounded-lg ${className}`}>{initials}</div>
    ) : (
        <img src={logo} alt={name} className={`object-contain rounded-lg bg-base-300 ${className}`} onError={() => setErr(true)} loading="lazy" />
    );
}

// ─── Channel Card ─────────────────────────────────────────────────────────────
function ChannelCard({ ch, onPlay, compact = false }) {
    const isWorking = ch.streamStatus === "working" || !ch.streamStatus;
    return (
        <div
            onClick={() => isWorking && onPlay?.(ch)}
            className={`group flex flex-col gap-2 rounded-xl p-2 transition-all duration-200 select-none
                ${isWorking ? "cursor-pointer hover:bg-base-300/60 hover:scale-[1.02]" : "opacity-50 cursor-not-allowed"}
            `}>
            {/* Poster */}
            <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-base-300/50">
                <ChannelLogo logo={ch.logo} name={ch.cleanName || ch.name} className="w-full h-full" />
                {/* Overlays */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                {isWorking && (
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                        <div className="w-10 h-10 rounded-full bg-primary/90 flex items-center justify-center shadow-lg">
                            <Play size={18} fill="currentColor" className="text-primary-content translate-x-0.5" />
                        </div>
                    </div>
                )}
                {/* Top badges */}
                <div className="absolute top-1.5 left-1.5 flex items-center gap-1">
                    <LiveBadge />
                    {!compact && <QualityBadge resolution={ch.resolution} isHD={ch.isHD} />}
                </div>
                {/* Status dot */}
                <div className="absolute top-1.5 right-1.5">
                    <StatusDot status={ch.streamStatus} />
                </div>
            </div>
            {/* Info */}
            <div className="px-0.5">
                <p className="text-[13px] font-semibold text-base-content leading-tight truncate">{ch.cleanName || ch.name}</p>
                {!compact && (
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        {ch.country && <span className="text-[10px] text-base-content/45 truncate">{ch.country}</span>}
                        {ch.category && (
                            <span className="flex items-center gap-0.5 text-[10px] text-base-content/35">
                                <CatIcon name={ch.category} size={10} />
                                {ch.category}
                            </span>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Horizontal carousel ──────────────────────────────────────────────────────
function Carousel({ title, icon: Icon, channels, onPlay, accentClass = "text-primary" }) {
    const ref = useRef(null);
    const scroll = (dir) => ref.current?.scrollBy({ left: dir * 280, behavior: "smooth" });
    if (!channels?.length) return null;
    return (
        <section className="space-y-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    {Icon && <Icon size={18} className={accentClass} />}
                    <h2 className="text-base font-semibold text-base-content">{title}</h2>
                    <span className="text-xs text-base-content/35 bg-base-300 px-2 py-0.5 rounded-full">{channels.length}</span>
                </div>
                <div className="hidden sm:flex gap-1">
                    {[
                        [-1, ChevronLeft],
                        [1, ChevronRight],
                    ].map(([dir, Ic]) => (
                        <button
                            key={dir}
                            onClick={() => scroll(dir)}
                            className="w-7 h-7 rounded-full bg-base-300 hover:bg-base-200 flex items-center justify-center text-base-content/60 hover:text-base-content transition-colors border-none cursor-pointer">
                            <Ic size={15} />
                        </button>
                    ))}
                </div>
            </div>
            <div ref={ref} className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1" style={{ scrollbarWidth: "none" }}>
                {channels.map((ch, i) => (
                    <div key={ch.url ?? i} className="shrink-0 w-36 sm:w-40">
                        <ChannelCard ch={ch} onPlay={onPlay} compact />
                    </div>
                ))}
            </div>
        </section>
    );
}

// ─── Hero ─────────────────────────────────────────────────────────────────────
function Hero({ channels, onPlay }) {
    const [idx, setIdx] = useState(0);
    const timer = useRef(null);

    const featured = useMemo(() => (channels || []).filter((c) => c.streamStatus === "working" || !c.streamStatus).slice(0, 5), [channels]);

    useEffect(() => {
        if (featured.length <= 1) return;
        timer.current = setInterval(() => setIdx((i) => (i + 1) % featured.length), 8000);
        return () => clearInterval(timer.current);
    }, [featured.length]);

    if (!featured.length) return null;
    const ch = featured[idx];

    return (
        <div className="relative w-full rounded-2xl overflow-hidden min-h-[220px] sm:min-h-[280px] bg-base-300">
            {/* Background logo blur */}
            {ch.logo && (
                <div className="absolute inset-0">
                    <img src={ch.logo} alt="" className="w-full h-full object-cover opacity-10 blur-2xl scale-110" aria-hidden />
                    <div className="absolute inset-0 bg-gradient-to-r from-base-100/95 via-base-100/70 to-transparent" />
                    <div className="absolute inset-0 bg-gradient-to-t from-base-100/80 via-transparent to-transparent" />
                </div>
            )}
            {/* Content */}
            <div className="relative flex items-center gap-6 p-6 sm:p-8 h-full">
                <div className="shrink-0 w-20 h-20 sm:w-28 sm:h-28 rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/10">
                    <ChannelLogo logo={ch.logo} name={ch.cleanName || ch.name} className="w-full h-full" />
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                        <LiveBadge />
                        <Zap size={14} className="text-warning" />
                        <span className="text-xs text-base-content/50 font-medium uppercase tracking-wider">Featured</span>
                    </div>
                    <h1 className="text-2xl sm:text-3xl font-bold text-base-content leading-tight">{ch.cleanName || ch.name}</h1>
                    <div className="flex items-center gap-2 flex-wrap text-sm text-base-content/50">
                        {ch.country && <span>{ch.country}</span>}
                        {ch.category && (
                            <>
                                <span>·</span>
                                <span>{ch.category}</span>
                            </>
                        )}
                        {ch.resolution && (
                            <>
                                <span>·</span>
                                <QualityBadge resolution={ch.resolution} isHD={ch.isHD} />
                            </>
                        )}
                        {ch.streamFormat && ch.streamFormat !== "Unknown" && (
                            <>
                                <span>·</span>
                                <span>{ch.streamFormat}</span>
                            </>
                        )}
                    </div>
                    <button onClick={() => onPlay?.(ch)} className="inline-flex items-center gap-2 btn btn-primary btn-sm mt-2">
                        <Play size={14} fill="currentColor" /> Watch Now
                    </button>
                </div>
                {/* Indicators */}
                {featured.length > 1 && (
                    <div className="absolute bottom-3 right-4 flex gap-1.5">
                        {featured.map((_, i) => (
                            <button
                                key={i}
                                onClick={() => setIdx(i)}
                                className={`h-1.5 rounded-full transition-all duration-300 border-none cursor-pointer ${i === idx ? "w-5 bg-primary" : "w-1.5 bg-base-content/25 hover:bg-base-content/50"}`}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Continue Watching ────────────────────────────────────────────────────────
function ContinueWatching({ onPlay }) {
    const { data } = useQuery({
        queryKey: ["history"],
        queryFn: getHistory,
        staleTime: 30_000,
    });
    const items = (data?.history ?? []).filter((h) => h.type === "live" && !h.completed).slice(0, 10);
    if (!items.length) return null;
    return (
        <section className="space-y-3">
            <div className="flex items-center gap-2">
                <Clock size={18} className="text-accent" />
                <h2 className="text-base font-semibold text-base-content">Continue Watching</h2>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1" style={{ scrollbarWidth: "none" }}>
                {items.map((h, i) => (
                    <div key={h.id ?? i} className="shrink-0 w-36 sm:w-40">
                        <ChannelCard ch={{ name: h.name, cleanName: h.name, logo: h.poster, url: h.streamUrl }} onPlay={onPlay} compact />
                    </div>
                ))}
            </div>
        </section>
    );
}

// ─── Skeleton loaders ─────────────────────────────────────────────────────────
function HeroSkeleton() {
    return <div className="w-full h-[220px] sm:h-[280px] rounded-2xl bg-base-300 animate-pulse" />;
}
function TabSkeleton() {
    return <div className="h-8 w-20 rounded-full bg-base-300 animate-pulse shrink-0" />;
}
function CardSkeleton() {
    return (
        <div className="w-full">
            <div className="aspect-video rounded-lg bg-base-300 animate-pulse" />
            <div className="h-3 w-3/4 rounded bg-base-300 animate-pulse mt-2" />
            <div className="h-2.5 w-1/2 rounded bg-base-300 animate-pulse mt-1.5" />
        </div>
    );
}

// ─── Filter drawer ────────────────────────────────────────────────────────────
function FilterDrawer({ open, onClose, filters, setFilters, categories }) {
    const STATUS_OPTS = ["all", "working", "offline", "unknown"];
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-50 flex justify-end">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
            <div className="relative w-72 h-full bg-base-100 shadow-2xl flex flex-col p-5 gap-5 overflow-y-auto">
                <div className="flex items-center justify-between">
                    <span className="font-semibold text-base-content">Filters</span>
                    <button onClick={onClose} className="btn btn-ghost btn-sm btn-circle border-none cursor-pointer">
                        <X size={16} />
                    </button>
                </div>
                {/* Status */}
                <div className="space-y-2">
                    <p className="text-xs text-base-content/50 uppercase tracking-wider font-medium">Status</p>
                    <div className="flex flex-wrap gap-2">
                        {STATUS_OPTS.map((s) => (
                            <button
                                key={s}
                                onClick={() => setFilters((f) => ({ ...f, status: s }))}
                                className={`px-3 py-1 rounded-full text-xs font-medium border-none cursor-pointer transition-colors ${filters.status === s ? "bg-primary text-primary-content" : "bg-base-300 text-base-content/70 hover:text-base-content"}`}>
                                {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
                            </button>
                        ))}
                    </div>
                </div>
                {/* Quality */}
                <div className="space-y-2">
                    <p className="text-xs text-base-content/50 uppercase tracking-wider font-medium">Quality</p>
                    <div className="flex flex-wrap gap-2">
                        {["all", "HD", "SD"].map((q) => (
                            <button
                                key={q}
                                onClick={() => setFilters((f) => ({ ...f, quality: q }))}
                                className={`px-3 py-1 rounded-full text-xs font-medium border-none cursor-pointer transition-colors ${filters.quality === q ? "bg-primary text-primary-content" : "bg-base-300 text-base-content/70 hover:text-base-content"}`}>
                                {q === "all" ? "All Quality" : q}
                            </button>
                        ))}
                    </div>
                </div>
                {/* Category */}
                <div className="space-y-2">
                    <p className="text-xs text-base-content/50 uppercase tracking-wider font-medium">Category</p>
                    <div className="flex flex-col gap-1 max-h-56 overflow-y-auto">
                        <button
                            onClick={() => setFilters((f) => ({ ...f, category: null }))}
                            className={`text-left px-3 py-1.5 rounded-lg text-sm border-none cursor-pointer transition-colors ${!filters.category ? "bg-primary text-primary-content" : "hover:bg-base-300 text-base-content/70"}`}>
                            All Categories
                        </button>
                        {categories.map((c) => (
                            <button
                                key={c.name}
                                onClick={() => setFilters((f) => ({ ...f, category: c.name }))}
                                className={`text-left flex items-center justify-between px-3 py-1.5 rounded-lg text-sm border-none cursor-pointer transition-colors ${filters.category === c.name ? "bg-primary text-primary-content" : "hover:bg-base-300 text-base-content/70"}`}>
                                <span className="flex items-center gap-2">
                                    <CatIcon name={c.name} size={12} />
                                    {c.name}
                                </span>
                                <span className="text-xs opacity-60">{c.total}</span>
                            </button>
                        ))}
                    </div>
                </div>
                <button onClick={() => setFilters({ status: "all", quality: "all", category: null })} className="btn btn-ghost btn-sm mt-auto border-none cursor-pointer text-base-content/50">
                    Reset Filters
                </button>
            </div>
        </div>
    );
}

// ─── Empty state ──────────────────────────────────────────────────────────────
function EmptyState({ icon: Icon = Tv, title, subtitle, action }) {
    return (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-base-300 flex items-center justify-center">
                <Icon size={28} className="text-base-content/25" />
            </div>
            <div className="space-y-1">
                <p className="font-semibold text-base-content/60">{title}</p>
                {subtitle && <p className="text-sm text-base-content/35">{subtitle}</p>}
            </div>
            {action}
        </div>
    );
}

// ─── All Channels grid ────────────────────────────────────────────────────────
function AllChannels({ filters, q, onPlay }) {
    const [page, setPage] = useState(1);

    // Reset page on filter/search change
    useEffect(() => setPage(1), [filters, q]);

    const { data, isLoading, isFetching, error } = useQuery({
        queryKey: ["live", "all", { category: filters.category, q, page, status: filters.status, quality: filters.quality }],
        queryFn: () =>
            getLiveChannels({
                category: filters.category || undefined,
                q: q || undefined,
                page,
                limit: PAGE_LIMIT,
            }),
        staleTime: 60_000,
        keepPreviousData: true,
    });

    // Client-side status/quality filter on top of what backend returns
    const channels = useMemo(() => {
        let rows = data?.channels ?? [];
        if (filters.status !== "all") {
            rows = rows.filter((c) => (c.streamStatus || "unknown") === filters.status);
        }
        if (filters.quality === "HD") rows = rows.filter((c) => c.isHD);
        if (filters.quality === "SD") rows = rows.filter((c) => !c.isHD);
        return rows;
    }, [data, filters]);

    const total = data?.total ?? 0;
    const totalPages = data?.totalPages ?? 1;

    if (error) return <EmptyState icon={AlertCircle} title="Failed to load channels" subtitle={error.message} />;

    return (
        <section className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Tv size={18} className="text-base-content/50" />
                    <h2 className="text-base font-semibold text-base-content">All Channels</h2>
                    {!isLoading && <span className="text-xs text-base-content/35 bg-base-300 px-2 py-0.5 rounded-full">{total}</span>}
                </div>
                {isFetching && !isLoading && <RefreshCw size={14} className="animate-spin text-base-content/35" />}
            </div>

            {isLoading ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                    {Array.from({ length: PAGE_LIMIT }).map((_, i) => (
                        <CardSkeleton key={i} />
                    ))}
                </div>
            ) : channels.length === 0 ? (
                <EmptyState icon={Search} title="No channels found" subtitle={q ? `No results for "${q}"` : "Try adjusting your filters"} />
            ) : (
                <>
                    <div className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 transition-opacity ${isFetching ? "opacity-60" : ""}`}>
                        {channels.map((ch, i) => (
                            <ChannelCard key={ch.url ?? i} ch={ch} onPlay={onPlay} />
                        ))}
                    </div>
                    {totalPages > 1 && (
                        <div className="flex items-center justify-center gap-3 pt-2">
                            <button
                                disabled={page <= 1}
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                                className="px-3 py-1.5 rounded-md text-sm bg-base-300 text-base-content/70 disabled:opacity-30 hover:text-base-content transition-colors border-none cursor-pointer">
                                Prev
                            </button>
                            <span className="text-xs text-base-content/45">
                                Page {page} / {totalPages}
                            </span>
                            <button
                                disabled={page >= totalPages}
                                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                className="px-3 py-1.5 rounded-md text-sm bg-base-300 text-base-content/70 disabled:opacity-30 hover:text-base-content transition-colors border-none cursor-pointer">
                                Next
                            </button>
                        </div>
                    )}
                </>
            )}
        </section>
    );
}

// ─── Category Sections ────────────────────────────────────────────────────────
// Fetches one carousel per priority category
const PRIORITY_CATEGORIES = [
    { name: "News", icon: Newspaper, accent: "text-info" },
    { name: "Sports", icon: Trophy, accent: "text-warning" },
    { name: "Entertainment", icon: Star, accent: "text-secondary" },
    { name: "Movies", icon: Film, accent: "text-primary" },
    { name: "Kids", icon: Baby, accent: "text-success" },
    { name: "Music", icon: Music, accent: "text-accent" },
    { name: "Documentary", icon: BookOpen, accent: "text-base-content/60" },
];

function CategorySection({ catName, icon, accent, onPlay }) {
    const { data } = useQuery({
        queryKey: ["live", "carousel", catName],
        queryFn: () => getLiveChannels({ category: catName, limit: CAROUSEL_LIMIT }),
        staleTime: 2 * 60_000,
    });
    const channels = data?.channels ?? [];
    if (!channels.length) return null;
    return <Carousel title={catName} icon={icon} channels={channels} onPlay={onPlay} accentClass={accent} />;
}

// ─── Main Live page ───────────────────────────────────────────────────────────
export default function Live() {
    const { isAuthenticated, isApproved, loading: authLoading } = useAuth();
    const enabled = !authLoading && isAuthenticated && isApproved;

    // Search state
    const [searchInput, setSearchInput] = useState("");
    const [q, setQ] = useState("");
    const debounceRef = useRef(null);
    const handleSearch = useCallback((val) => {
        setSearchInput(val);
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => setQ(val), DEBOUNCE_MS);
    }, []);
    useEffect(() => () => clearTimeout(debounceRef.current), []);

    // Filter state
    const [filterOpen, setFilterOpen] = useState(false);
    const [filters, setFilters] = useState({ status: "all", quality: "all", category: null });
    const activeFilterCount = [filters.status !== "all", filters.quality !== "all", !!filters.category].filter(Boolean).length;

    // Categories
    const { data: catData, isLoading: catLoading } = useQuery({
        queryKey: ["live", "categories"],
        queryFn: getLiveCategories,
        enabled,
        staleTime: 5 * 60_000,
    });
    const categories = catData?.categories ?? [];

    // Hero + Live Now — fetch working channels for hero
    const { data: heroData, isLoading: heroLoading } = useQuery({
        queryKey: ["live", "hero"],
        queryFn: () => getLiveChannels({ limit: 40 }),
        enabled,
        staleTime: REFRESH_INTERVAL_MS,
        refetchInterval: REFRESH_INTERVAL_MS,
    });
    const heroChannels = heroData?.channels ?? [];

    // Player handler — open stream URL in native player / new tab for now
    const handlePlay = useCallback((ch) => {
        if (!ch?.url) return;
        // TODO: wire to your actual Live player component/route
        window.open(ch.url, "_blank", "noopener");
    }, []);

    // ── Auth gate ──────────────────────────────────────────────────────────
    if (!authLoading && !enabled) {
        return (
            <EmptyState
                icon={Tv}
                title="Sign in to watch Live TV"
                subtitle="Approved accounts can access all live channels."
                action={
                    <a href="/login" className="btn btn-primary btn-sm">
                        Sign In
                    </a>
                }
            />
        );
    }

    return (
        <div className="space-y-8">
            {/* ── Top bar ── */}
            <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Radio size={20} className="text-primary shrink-0 animate-pulse" />
                    <h1 className="text-2xl sm:text-3xl font-bold text-base-content">Live TV</h1>
                </div>
                {/* Search */}
                <div className="flex items-center gap-2 bg-base-300 rounded-lg px-3 h-9 w-full sm:w-64 shrink-0">
                    <Search size={15} className="text-base-content/40 shrink-0" />
                    <input
                        type="text"
                        value={searchInput}
                        onChange={(e) => handleSearch(e.target.value)}
                        placeholder="Search channels, country, category…"
                        className="bg-transparent outline-none text-sm text-base-content placeholder:text-base-content/35 w-full"
                    />
                    {searchInput && (
                        <button
                            onClick={() => {
                                handleSearch("");
                            }}
                            className="text-base-content/40 hover:text-base-content border-none cursor-pointer">
                            <X size={14} />
                        </button>
                    )}
                </div>
                {/* Filter button */}
                <button
                    onClick={() => setFilterOpen(true)}
                    className={`flex items-center gap-1.5 px-3 h-9 rounded-lg text-sm font-medium border-none cursor-pointer transition-colors
                        ${activeFilterCount > 0 ? "bg-primary text-primary-content" : "bg-base-300 text-base-content/70 hover:text-base-content"}`}>
                    <SlidersHorizontal size={15} />
                    <span>Filter</span>
                    {activeFilterCount > 0 && <span className="w-4 h-4 rounded-full bg-primary-content/20 text-[10px] font-bold flex items-center justify-center">{activeFilterCount}</span>}
                </button>
            </div>

            {/* ── Hero ── */}
            {heroLoading ? <HeroSkeleton /> : <Hero channels={heroChannels} onPlay={handlePlay} />}

            {/* ── Continue Watching ── */}
            <ContinueWatching onPlay={handlePlay} />

            {/* ── Quick status stats ── */}
            {!heroLoading &&
                heroChannels.length > 0 &&
                (() => {
                    const working = heroChannels.filter((c) => c.streamStatus === "working").length;
                    const total = heroChannels.length;
                    if (!working) return null;
                    return (
                        <div className="flex items-center gap-3 flex-wrap">
                            <div className="flex items-center gap-1.5 text-xs text-base-content/45">
                                <Wifi size={12} className="text-success" />
                                <span>
                                    <span className="text-success font-medium">{working}</span> of {total} channels online
                                </span>
                            </div>
                        </div>
                    );
                })()}

            {/* ── Category tabs (quick filter) ── */}
            {!q && !filters.category && (
                <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: "none" }}>
                    {catLoading
                        ? Array.from({ length: 7 }).map((_, i) => <TabSkeleton key={i} />)
                        : categories.slice(0, 12).map((c) => (
                              <button
                                  key={c.name}
                                  onClick={() => setFilters((f) => ({ ...f, category: c.name }))}
                                  className="shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-medium bg-base-300 text-base-content/70 hover:text-base-content hover:bg-base-200 transition-colors border-none cursor-pointer">
                                  <CatIcon name={c.name} size={11} />
                                  {c.name}
                                  <span className="text-[10px] opacity-50">{c.total}</span>
                              </button>
                          ))}
                </div>
            )}

            {/* ── If searching / filtered: just show All Channels ── */}
            {q || filters.category || filters.status !== "all" || filters.quality !== "all" ? (
                <AllChannels filters={filters} q={q} onPlay={handlePlay} />
            ) : (
                <>
                    {/* ── Priority category carousels ── */}
                    {PRIORITY_CATEGORIES.filter((pc) => categories.some((c) => c.name === pc.name)).map((pc) => (
                        <CategorySection key={pc.name} catName={pc.name} icon={pc.icon} accent={pc.accent} onPlay={handlePlay} />
                    ))}

                    {/* ── All Channels (no filter) ── */}
                    <AllChannels filters={{ status: "all", quality: "all", category: null }} q="" onPlay={handlePlay} />
                </>
            )}

            {/* ── Filter drawer ── */}
            <FilterDrawer open={filterOpen} onClose={() => setFilterOpen(false)} filters={filters} setFilters={setFilters} categories={categories} />
        </div>
    );
}
