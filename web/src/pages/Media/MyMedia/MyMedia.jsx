import { useState, useMemo, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Film, Tv, Sword, Search, X, ChevronDown, ChevronLeft, ChevronRight, LayoutGrid, AlertTriangle, BookOpen, Check } from "lucide-react";
import { useApi } from "../../../Context/apiContext";
import MediaCard from "../../../Components/MediaCard";

const PER_PAGE = 40;
const GRID = "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-3";

function GenreDropdown({ label, value, onChange, options }) {
    const [open, setOpen] = useState(false);
    const btnRef = useRef(null);
    const menuRef = useRef(null);
    const [pos, setPos] = useState({ top: 0, left: 0, minWidth: 0 });

    useEffect(() => {
        if (!open || !btnRef.current) return;
        const r = btnRef.current.getBoundingClientRect();
        const MENU_W = Math.max(r.width, 180);
        const MENU_H = Math.min(options.length + 1, 10) * 40 + 16;
        const PAD = 8;
        const spaceBelow = window.innerHeight - r.bottom - PAD;
        const spaceAbove = r.top - PAD;
        const top = spaceAbove > spaceBelow && spaceBelow < MENU_H ? r.top - MENU_H - 4 : r.bottom + 4;
        const left = Math.min(r.left, window.innerWidth - MENU_W - PAD);
        setPos({ top, left, minWidth: MENU_W });
    }, [open, options.length]);

    useEffect(() => {
        if (!open) return;
        const onPointer = (e) => {
            if (menuRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
            setOpen(false);
        };
        document.addEventListener("pointerdown", onPointer);
        return () => document.removeEventListener("pointerdown", onPointer);
    }, [open]);

    const selected = options.find((o) => o.value === value);

    return (
        <>
            <button
                ref={btnRef}
                onClick={() => setOpen((v) => !v)}
                className={`flex items-center gap-2 h-9 pl-3 pr-2.5 rounded-xl text-sm border transition-colors ${open || value ? "bg-primary/10 border-primary/30 text-primary" : "bg-base-200 border-base-300 text-base-content/70 hover:border-base-content/30 hover:text-base-content"}`}>
                <span className="font-medium">{selected ? selected.label : label}</span>
                <ChevronDown size={13} className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
            </button>
            {open &&
                createPortal(
                    <>
                        <style>{`@keyframes ddIn{from{opacity:0;transform:translateY(-6px) scale(.97)}to{opacity:1;transform:none}}`}</style>
                        <div
                            ref={menuRef}
                            style={{
                                position: "fixed",
                                top: pos.top,
                                left: pos.left,
                                minWidth: pos.minWidth,
                                zIndex: 99999,
                                animation: "ddIn 0.12s ease-out both",
                                overflowY: "auto",
                                maxHeight: "320px",
                                overscrollBehavior: "contain",
                            }}
                            className="rounded-2xl shadow-2xl bg-base-200 border border-base-300 py-1.5">
                            <button
                                onClick={() => {
                                    onChange("");
                                    setOpen(false);
                                }}
                                className={`flex items-center justify-between w-full px-4 py-2.5 text-sm transition-colors ${!value ? "text-primary bg-primary/10" : "text-base-content/70 hover:bg-base-300 hover:text-base-content"}`}>
                                <span className="font-medium">{label}</span>
                                {!value && <Check size={13} className="text-primary" />}
                            </button>
                            <div className="border-t border-base-300 my-1" />
                            {options.map((o) => (
                                <button
                                    key={o.value}
                                    onClick={() => {
                                        onChange(o.value);
                                        setOpen(false);
                                    }}
                                    className={`flex items-center justify-between w-full px-4 py-2.5 text-sm transition-colors ${value === o.value ? "text-primary bg-primary/10" : "text-base-content/70 hover:bg-base-300 hover:text-base-content"}`}>
                                    <span>{o.label}</span>
                                    {value === o.value && <Check size={13} className="text-primary" />}
                                </button>
                            ))}
                        </div>
                    </>,
                    document.body,
                )}
        </>
    );
}

function Tab({ active, onClick, icon: Icon, label, count }) {
    return (
        <button
            onClick={onClick}
            className={`flex items-center gap-2 px-4 h-9 rounded-xl text-sm font-semibold transition-all border ${active ? "bg-primary/10 text-primary border-primary/25" : "text-base-content/55 border-transparent hover:text-base-content hover:bg-base-200"}`}>
            <Icon size={14} />
            <span>{label}</span>
            {count != null && <span className={`text-xs tabular-nums px-1.5 py-0.5 rounded-md font-bold ${active ? "bg-primary/20 text-primary" : "bg-base-300 text-base-content/50"}`}>{count}</span>}
        </button>
    );
}

function Pagination({ page, total, perPage, onChange }) {
    const pages = Math.ceil(total / perPage);
    if (pages <= 1) return null;
    const start = (page - 1) * perPage + 1;
    const end = Math.min(page * perPage, total);
    return (
        <div className="flex items-center justify-between pt-6 border-t border-base-300">
            <span className="text-sm text-base-content/50 font-medium">
                {start}–{end} <span className="text-base-content/30">of</span> {total}
            </span>
            <div className="flex items-center gap-1.5">
                <button
                    onClick={() => onChange(page - 1)}
                    disabled={page === 1}
                    className="w-8 h-8 flex items-center justify-center rounded-lg bg-base-200 border border-base-300 text-base-content/60 hover:text-base-content hover:border-base-content/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                    <ChevronLeft size={15} />
                </button>
                <span className="px-3 h-8 flex items-center rounded-lg bg-primary/10 border border-primary/20 text-sm font-bold text-primary tabular-nums">
                    {page} / {pages}
                </span>
                <button
                    onClick={() => onChange(page + 1)}
                    disabled={page === pages}
                    className="w-8 h-8 flex items-center justify-center rounded-lg bg-base-200 border border-base-300 text-base-content/60 hover:text-base-content hover:border-base-content/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                    <ChevronRight size={15} />
                </button>
            </div>
        </div>
    );
}

function SectionHead({ label, count }) {
    return (
        <div className="flex items-center gap-3 mb-4">
            <h2 className="text-base font-bold text-base-content tracking-tight">{label}</h2>
            <span className="px-2 py-0.5 bg-base-300 rounded-md text-xs font-semibold text-base-content/50 tabular-nums">{count}</span>
        </div>
    );
}

function CardSkeleton() {
    return (
        <div className="animate-pulse">
            <div className="rounded-xl bg-base-300" style={{ aspectRatio: "2/3" }} />
            <div className="mt-2 space-y-1.5 px-0.5">
                <div className="h-3 bg-base-300 rounded w-4/5" />
                <div className="h-2.5 bg-base-300 rounded w-2/5" />
            </div>
        </div>
    );
}

export default function MyMedia() {
    const { movies, series, anime, categories, loading, errors } = useApi();

    const [tab, setTab] = useState("all");
    const [search, setSearch] = useState("");
    const [dSearch, setDSearch] = useState("");
    const [genre, setGenre] = useState("");
    const [page, setPage] = useState(1);

    const debRef = useRef(null);
    useEffect(() => {
        clearTimeout(debRef.current);
        debRef.current = setTimeout(() => {
            setDSearch(search);
            setPage(1);
        }, 280);
        return () => clearTimeout(debRef.current);
    }, [search]);

    useEffect(() => {
        setPage(1);
    }, [tab, genre]);

    const all = useMemo(
        () => [...(movies ?? []).map((m) => ({ ...m, _type: "movie" })), ...(series ?? []).map((s) => ({ ...s, _type: "series" })), ...(anime ?? []).map((a) => ({ ...a, _type: "anime" }))],
        [movies, series, anime],
    );

    const counts = useMemo(
        () => ({
            all: all.length,
            movies: all.filter((i) => i._type === "movie").length,
            series: all.filter((i) => i._type === "series").length,
            anime: all.filter((i) => i._type === "anime").length,
        }),
        [all],
    );

    const genreOpts = useMemo(() => (categories ?? []).map((c) => ({ value: c.name, label: c.name })), [categories]);

    const filtered = useMemo(() => {
        let items = all;
        if (tab !== "all") {
            const map = { movies: "movie", series: "series", anime: "anime" };
            items = items.filter((i) => i._type === map[tab]);
        }
        if (dSearch.trim()) {
            const q = dSearch.toLowerCase();
            items = items.filter((i) => (i.metadata?.title ?? i.title ?? i.name ?? "").toLowerCase().includes(q));
        }
        if (genre) {
            items = items.filter((i) => (i.metadata?.genres ?? []).some((g) => g.toLowerCase() === genre.toLowerCase()));
        }
        return items;
    }, [all, tab, dSearch, genre]);

    const paged = useMemo(() => filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE), [filtered, page]);

    const isLoading = loading.media;
    const hasFilters = dSearch || genre || tab !== "all";

    const grouped = useMemo(() => {
        if (tab !== "all" || dSearch || genre) return null;
        return {
            mv: paged.filter((i) => i._type === "movie"),
            sr: paged.filter((i) => i._type === "series"),
            an: paged.filter((i) => i._type === "anime"),
        };
    }, [tab, dSearch, genre, paged]);

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-base-content tracking-tight">My Media</h1>
                <p className="text-sm text-base-content/50 mt-0.5">Your complete media collection</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <Tab active={tab === "all"} onClick={() => setTab("all")} icon={LayoutGrid} label="All" count={counts.all} />
                <Tab active={tab === "movies"} onClick={() => setTab("movies")} icon={Film} label="Movies" count={counts.movies} />
                <Tab active={tab === "series"} onClick={() => setTab("series")} icon={Tv} label="Series" count={counts.series} />
                <Tab active={tab === "anime"} onClick={() => setTab("anime")} icon={Sword} label="Anime" count={counts.anime} />
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
                <div className="relative flex-1 min-w-44 max-w-sm">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-base-content/35 pointer-events-none" />
                    <label htmlFor="media-search" className="sr-only">Search titles</label>
                    <input
                        id="media-search"
                        name="q"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search titles…"
                        className="w-full h-9 pl-9 pr-8 bg-base-200 border border-base-300 text-sm text-base-content placeholder:text-base-content/30 rounded-xl focus:outline-none focus:border-primary/60 hover:border-base-content/25 transition-colors"
                    />
                    {search && (
                        <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-base-content/35 hover:text-base-content/70 transition-colors">
                            <X size={13} />
                        </button>
                    )}
                </div>
                {genreOpts.length > 0 && <GenreDropdown label="All Genres" value={genre} onChange={setGenre} options={genreOpts} />}
                {hasFilters && (
                    <button
                        onClick={() => {
                            setSearch("");
                            setGenre("");
                            setTab("all");
                        }}
                        className="flex items-center gap-1.5 h-9 px-3 bg-base-200 border border-base-300 rounded-xl text-sm text-base-content/55 hover:text-base-content hover:border-base-content/25 transition-colors">
                        <X size={12} /> Clear filters
                    </button>
                )}
                <span className="text-sm text-base-content/40 font-medium ml-auto tabular-nums">{isLoading ? "Loading…" : `${filtered.length} items`}</span>
            </div>

            {errors.media && (
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-error/10 border border-error/20 text-error text-sm">
                    <AlertTriangle size={16} className="shrink-0" />
                    {errors.media}
                </div>
            )}

            {isLoading ? (
                <div className={GRID}>
                    {Array.from({ length: 18 }).map((_, i) => (
                        <CardSkeleton key={i} />
                    ))}
                </div>
            ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 gap-4">
                    <div className="p-4 bg-base-200 border border-base-300 rounded-2xl">
                        <BookOpen size={32} className="text-base-content/20" />
                    </div>
                    <div className="text-center">
                        <p className="font-semibold text-base-content/60 text-lg">No media found</p>
                        <p className="text-sm text-base-content/35 mt-1">{hasFilters ? "Try adjusting your search or filters." : "Add library folders in Settings to scan your media."}</p>
                    </div>
                </div>
            ) : grouped ? (
                <div className="space-y-8">
                    {grouped.mv.length > 0 && (
                        <section>
                            <SectionHead label="Movies" count={counts.movies} />
                            <div className={GRID}>
                                {grouped.mv.map((item) => (
                                    <MediaCard key={item.id} item={item} />
                                ))}
                            </div>
                        </section>
                    )}
                    {grouped.sr.length > 0 && (
                        <section>
                            <SectionHead label="Series" count={counts.series} />
                            <div className={GRID}>
                                {grouped.sr.map((item) => (
                                    <MediaCard key={item.id ?? item.seriesKey} item={item} />
                                ))}
                            </div>
                        </section>
                    )}
                    {grouped.an.length > 0 && (
                        <section>
                            <SectionHead label="Anime" count={counts.anime} />
                            <div className={GRID}>
                                {grouped.an.map((item) => (
                                    <MediaCard key={item.id ?? item.seriesKey} item={item} />
                                ))}
                            </div>
                        </section>
                    )}
                </div>
            ) : (
                <>
                    <div className={GRID}>
                        {paged.map((item) => (
                            <MediaCard key={item.id ?? item.seriesKey} item={item} />
                        ))}
                    </div>
                    <Pagination page={page} total={filtered.length} perPage={PER_PAGE} onChange={setPage} />
                </>
            )}
        </div>
    );
}
