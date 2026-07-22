import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Tv, Search, ChevronLeft, ChevronRight, Radio, Play } from "lucide-react";
import { getLiveChannels, getLiveCategories, getFeaturedEvents, getSportsEventChannels } from "../../api/live";
import { useAuth } from "../../auth/useAuth";

// Reads the Settings → Live tab preference directly — same "flux-prefs"
// localStorage key Settings.jsx already writes to via setPref(). Read fresh
// (not cached in a ref) since the user may change it in another tab/visit
// and come back to Live without a full app reload.
function getLiveChannelMode() {
    try {
        const prefs = JSON.parse(localStorage.getItem("flux-prefs") || "{}");
        // Default to "active" — curated/working set out of the box. "all"
        // only kicks in once the person explicitly flips it in Settings.
        return prefs.liveChannelMode === "all" ? "all" : "active";
    } catch {
        return "active";
    }
}

// Reads Settings → Live tab "Hide non-working channels" pref. Was never
// read anywhere in this file — every query hardcoded workingOnly: true,
// so the toggle had zero effect on this page even though the backend
// (getChannels) fully supports the workingOnly query param.
function getLiveWorkingOnlyPref() {
    try {
        const prefs = JSON.parse(localStorage.getItem("flux-prefs") || "{}");
        return prefs.liveWorkingOnly === true;
    } catch {
        return false;
    }
}

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

// Matches now span a rolling multi-day window (today + a few days ahead),
// not just today — so a bare time ("7:30 PM") is ambiguous about which day.
// Shows "Today 7:30 PM" / "Tomorrow 7:30 PM" / "Fri 7:30 PM" as appropriate.
function formatMatchWhen(kickoff) {
    if (!kickoff) return "";
    const d = new Date(kickoff);
    if (Number.isNaN(d.getTime())) return "";
    const now = new Date();
    const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const dayDiff = Math.round((startOfDay(d) - startOfDay(now)) / 86400000);
    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (dayDiff === 0) return `Today ${time}`;
    if (dayDiff === 1) return `Tomorrow ${time}`;
    return `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

// ── Skeletons ─────────────────────────────────────────────────────────────────
function BannerSkeleton() {
    return <div className="w-full rounded-2xl bg-base-300 animate-pulse min-h-[160px] sm:min-h-[220px]" />;
}
function CardSkeleton() {
    return (
        <div className="shrink-0 w-32 sm:w-36 md:w-44">
            <div className="aspect-video rounded-xl bg-base-300 animate-pulse" />
            <div className="h-3 w-3/4 rounded bg-base-300 animate-pulse mt-2" />
            <div className="h-2.5 w-1/2 rounded bg-base-300 animate-pulse mt-1.5" />
        </div>
    );
}

// ── LiveBrowseCard — logo-focused, smaller, for category rows ─────────────────
// Separate from LiveCard (which is the wider EPG-aware card used elsewhere).
// Routes to /live/watch/:base64url same as LiveCard. Logo now object-cover
// (fills the whole card) instead of object-contain+padding.
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
            className="group shrink-0 w-32 sm:w-36 md:w-44 cursor-pointer select-none no-underline flex flex-col gap-1.5">
            <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-base-300 ring-1 ring-white/5 transition-transform duration-200 group-hover:scale-[1.03] group-hover:shadow-xl group-hover:ring-white/20">
                {thumb ? (
                    <img src={thumb} alt={name} className="w-full h-full object-cover" loading="lazy" draggable={false} onError={() => setImgErr(true)} />
                ) : (
                    <div className="w-full h-full flex items-center justify-center bg-base-200">
                        <Tv size={20} className="text-base-content/20" />
                    </div>
                )}

                <div className="absolute inset-0 bg-linear-to-t from-black/60 via-black/10 to-transparent" />
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
// This is the fallback banner shown for the Active/All channel set when
// there's no sports hero — it already threads channelMode + workingOnly
// (see the bannerData query below), so it reflects whichever set the
// person picked (Active Only by default, or All Channel).
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
        <div className="relative w-full rounded-2xl overflow-hidden bg-base-200 select-none min-h-[160px] sm:min-h-[220px]">
            {/* Blurred backdrop */}
            {ch.logo && <img src={ch.logo} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-cover opacity-10 blur-2xl scale-110" loading="lazy" />}

            {/* Gradient */}
            <div className="absolute inset-0 bg-linear-to-r from-black/90 via-black/50 to-transparent" />
            <div className="absolute inset-0 bg-linear-to-t from-black/60 via-transparent to-transparent" />

            {/* Content */}
            <div className="relative z-10 flex items-center gap-3 sm:gap-5 p-4 sm:p-6 md:p-8 h-full min-h-[160px] sm:min-h-[220px]">
                {/* Logo */}
                <div className="shrink-0 w-14 h-14 sm:w-20 sm:h-20 md:w-24 md:h-24 rounded-2xl overflow-hidden bg-white/10 flex items-center justify-center ring-1 ring-white/10">
                    {ch.logo ? <img src={ch.logo} alt={name} className="w-full h-full object-contain p-2" loading="lazy" /> : <Tv size={24} className="text-white/30" />}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0 flex flex-col gap-1.5 sm:gap-2">
                    {/* LIVE badge + category */}
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-error text-white">
                            <Radio size={7} className="animate-pulse" /> LIVE
                        </span>
                        {ch.category && ch.category !== "General" && <span className="text-[10px] text-white/40 font-medium">{ch.category}</span>}
                        {ch.country && ch.country !== "Unknown" && <span className="text-[10px] text-white/30 hidden sm:inline">{ch.country}</span>}
                    </div>

                    {/* Channel name */}
                    <h2 className="text-white font-bold text-base sm:text-xl md:text-3xl leading-tight truncate">{name}</h2>

                    {/* Current programme */}
                    {progTitle && (
                        <div className="flex flex-col gap-1">
                            <p className="text-white/80 text-xs sm:text-sm font-medium truncate">▶ {progTitle}</p>
                            {timeLeft && <p className="text-white/40 text-[10px] sm:text-xs">{timeLeft}</p>}

                            {/* Progress bar */}
                            {progress !== null && (
                                <div className="w-full max-w-[200px] sm:max-w-xs h-1 rounded-full bg-white/10 overflow-hidden">
                                    <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${progress}%` }} />
                                </div>
                            )}

                            {/* Next programme */}
                            {nextProg && <p className="text-white/25 text-[10px] truncate hidden sm:block">Next: {nextProg}</p>}
                        </div>
                    )}

                    {/* Watch button */}
                    <Link
                        to={`/live/watch/${toBase64Url(ch.url)}`}
                        state={{ streamUrl: ch.url, channelName: name, channelLogo: ch.logo }}
                        className="mt-1 self-start inline-flex items-center gap-2 px-4 sm:px-5 py-1.5 sm:py-2 rounded-xl bg-primary text-primary-content font-semibold text-xs sm:text-sm hover:opacity-90 active:scale-95 transition-all no-underline">
                        <Play size={12} fill="currentColor" /> Watch Now
                    </Link>
                </div>
            </div>

            {/* Prev / Next arrows */}
            {count > 1 && (
                <>
                    <button
                        onClick={prev}
                        className="absolute left-1.5 sm:left-2 top-1/2 -translate-y-1/2 z-20 w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-black/40 hover:bg-black/70 flex items-center justify-center text-white transition-colors border-none cursor-pointer">
                        <ChevronLeft size={15} />
                    </button>
                    <button
                        onClick={next}
                        className="absolute right-1.5 sm:right-2 top-1/2 -translate-y-1/2 z-20 w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-black/40 hover:bg-black/70 flex items-center justify-center text-white transition-colors border-none cursor-pointer">
                        <ChevronRight size={15} />
                    </button>

                    {/* Dots */}
                    <div className="absolute bottom-2 sm:bottom-3 left-1/2 -translate-x-1/2 z-20 flex gap-1.5">
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

// ── Sports Hero — Featured Sports Event API, backend picks the event ──────────
// Falls back to the highest-priority working sports channel the backend
// returns in recommendedChannels when no featured event exists. No frontend
// scoring/selection logic — just renders whatever the backend decided.
function SportsHero({ event, fallbackChannel, loading }) {
    if (loading) return <BannerSkeleton />;
    if (!event && !fallbackChannel) return null;

    if (event) {
        const isLive = event.status === "live";
        const primaryChannel = event.channels?.[0];
        return (
            <div className="relative w-full rounded-2xl overflow-hidden bg-base-200 select-none min-h-[180px] sm:min-h-[240px]">
                {event.thumbnail && <img src={event.thumbnail} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-cover opacity-15 blur-2xl scale-110" loading="lazy" />}
                <div className="absolute inset-0 bg-linear-to-r from-black/90 via-black/60 to-transparent" />
                <div className="absolute inset-0 bg-linear-to-t from-black/70 via-transparent to-transparent" />

                <div className="relative z-10 flex flex-col justify-center gap-2.5 sm:gap-3 p-4 sm:p-6 md:p-8 h-full min-h-[180px] sm:min-h-[240px]">
                    <div className="flex items-center gap-2 flex-wrap">
                        {isLive ? (
                            <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-error text-white">
                                <Radio size={7} className="animate-pulse" /> LIVE
                            </span>
                        ) : (
                            <span className="text-[10px] text-white/50 font-medium uppercase tracking-wide">{event.status}</span>
                        )}
                        {event.league && <span className="text-xs text-white/60 font-medium truncate">{event.league}</span>}
                    </div>

                    <div className="flex items-center gap-2 sm:gap-4 md:gap-6 flex-wrap">
                        <p className="text-white font-bold text-sm sm:text-lg md:text-2xl truncate">{event.homeTeam}</p>
                        {event.score?.home != null ? (
                            <span className="text-white font-black text-lg sm:text-2xl md:text-3xl shrink-0">
                                {event.score.home} – {event.score.away}
                            </span>
                        ) : (
                            <span className="text-white/40 text-xs sm:text-sm font-medium shrink-0">VS</span>
                        )}
                        <p className="text-white font-bold text-sm sm:text-lg md:text-2xl truncate">{event.awayTeam}</p>
                    </div>

                    <div className="flex items-center gap-2 sm:gap-3 flex-wrap text-white/50 text-[10px] sm:text-xs">
                        {event.kickoff && <span>{new Date(event.kickoff).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}</span>}
                        {event.venue && <span className="hidden sm:inline">· {event.venue}</span>}
                        <span>
                            · {event.channels?.length ?? 0} channel{event.channels?.length !== 1 ? "s" : ""}
                        </span>
                    </div>
                    {primaryChannel && (
                        <p className="text-white/40 text-[10px] sm:text-xs truncate">
                            📺 Streaming on <span className="text-white/70 font-medium">{primaryChannel.cleanName || primaryChannel.name}</span>
                            {event.channels?.length > 1 && ` +${event.channels.length - 1} more`}
                        </p>
                    )}

                    {primaryChannel && (
                        <Link
                            to={`/live/watch/${toBase64Url(primaryChannel.url)}`}
                            state={{ streamUrl: primaryChannel.url, channelName: primaryChannel.cleanName || primaryChannel.name, channelLogo: primaryChannel.logo }}
                            className="mt-1 self-start inline-flex items-center gap-2 px-4 sm:px-5 py-1.5 sm:py-2 rounded-xl bg-primary text-primary-content font-semibold text-xs sm:text-sm hover:opacity-90 active:scale-95 transition-all no-underline">
                            <Play size={12} fill="currentColor" /> Watch Now
                        </Link>
                    )}
                </div>
            </div>
        );
    }

    // No featured event — backend's top recommended working sports channel instead
    const name = fallbackChannel.channelName || "Live Channel";
    const prog = fallbackChannel.programme;
    return (
        <div className="relative w-full rounded-2xl overflow-hidden bg-base-200 select-none min-h-[160px] sm:min-h-[220px]">
            {fallbackChannel.channelLogo && (
                <img src={fallbackChannel.channelLogo} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-cover opacity-10 blur-2xl scale-110" loading="lazy" />
            )}
            <div className="absolute inset-0 bg-linear-to-r from-black/90 via-black/50 to-transparent" />
            <div className="relative z-10 flex items-center gap-3 sm:gap-5 p-4 sm:p-6 md:p-8 h-full min-h-[160px] sm:min-h-[220px]">
                <div className="shrink-0 w-14 h-14 sm:w-20 sm:h-20 md:w-24 md:h-24 rounded-2xl overflow-hidden bg-white/10 flex items-center justify-center ring-1 ring-white/10">
                    {fallbackChannel.channelLogo ? (
                        <img src={fallbackChannel.channelLogo} alt={name} className="w-full h-full object-contain p-2" loading="lazy" />
                    ) : (
                        <Tv size={24} className="text-white/30" />
                    )}
                </div>
                <div className="flex-1 min-w-0 flex flex-col gap-1.5 sm:gap-2">
                    <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-error text-white w-fit">
                        <Radio size={7} className="animate-pulse" /> LIVE
                    </span>
                    <h2 className="text-white font-bold text-base sm:text-xl md:text-3xl leading-tight truncate">{name}</h2>
                    {prog?.title && <p className="text-white/70 text-xs sm:text-sm truncate">▶ {prog.title}</p>}
                    {fallbackChannel.streamUrl && (
                        <Link
                            to={`/live/watch/${toBase64Url(fallbackChannel.streamUrl)}`}
                            state={{ streamUrl: fallbackChannel.streamUrl, channelName: name, channelLogo: fallbackChannel.channelLogo }}
                            className="mt-1 self-start inline-flex items-center gap-2 px-4 sm:px-5 py-1.5 sm:py-2 rounded-xl bg-primary text-primary-content font-semibold text-xs sm:text-sm hover:opacity-90 active:scale-95 transition-all no-underline">
                            <Play size={12} fill="currentColor" /> Watch Now
                        </Link>
                    )}
                </div>
            </div>
        </div>
    );
}

// ── Sports Event Carousel — every one of today's events, backend data only ────
// Clicking a card never navigates — it just selects the event so the channels
// section below can load that event's working channels. Feels instant.
function SportsEventCarousel({ matches, selectedId, onSelect, loading }) {
    const rowRef = useRef(null);
    const scroll = (dir) => rowRef.current?.scrollBy({ left: dir * 400, behavior: "smooth" });

    // Still show the section (title + empty message) instead of vanishing —
    // "nothing rendered" reads as "feature is broken/missing", not "no matches
    // today". Only hide entirely while the very first fetch is in flight.
    if (loading) {
        return (
            <section>
                <h2 className="text-base sm:text-lg font-semibold text-base-content mb-3">Upcoming Matches</h2>
                <div className="flex gap-3 overflow-hidden">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <CardSkeleton key={i} />
                    ))}
                </div>
            </section>
        );
    }

    if (!matches.length) {
        return (
            <section>
                <h2 className="text-base sm:text-lg font-semibold text-base-content mb-3">Upcoming Matches</h2>
                <div className="rounded-xl bg-base-200 ring-1 ring-white/5 py-8 px-4 text-center">
                    <p className="text-sm text-base-content/50">No sporting events found in the next few days.</p>
                    <p className="text-xs text-base-content/30 mt-1">This depends on the sports data provider having fixtures — check back later.</p>
                </div>
            </section>
        );
    }

    return (
        <section>
            <div className="flex items-center justify-between mb-3">
                <h2 className="text-base sm:text-lg font-semibold text-base-content">Upcoming Matches</h2>
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
                {matches.map((ev) => {
                    const active = ev.id === selectedId;
                    const isLive = ev.status === "live";
                    return (
                        <button
                            key={ev.id}
                            type="button"
                            onClick={() => onSelect(ev.id)}
                            aria-pressed={active}
                            className={`shrink-0 w-36 sm:w-40 md:w-48 text-left rounded-xl p-2.5 border-none cursor-pointer transition-colors ${
                                active ? "bg-primary/15 ring-1 ring-primary/50" : "bg-base-200 hover:bg-base-300/70 ring-1 ring-white/5"
                            }`}>
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[9px] text-base-content/40 font-semibold uppercase tracking-wide truncate">{ev.league || ev.sport}</span>
                                <div className="flex items-center gap-1.5 shrink-0">
                                    {isLive && (
                                        <span className="inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-error/90 text-white">
                                            <Radio size={7} className="animate-pulse" /> LIVE
                                        </span>
                                    )}
                                    {ev.kickoff && <span className="text-[9px] text-base-content/35">{formatMatchWhen(ev.kickoff)}</span>}
                                </div>
                            </div>
                            <div className="flex flex-col gap-0.5 mt-1.5">
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-xs font-medium text-base-content truncate">{ev.homeTeam}</p>
                                    {ev.score?.home != null && <p className="text-xs font-bold text-base-content">{ev.score.home}</p>}
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-xs font-medium text-base-content truncate">{ev.awayTeam}</p>
                                    {ev.score?.away != null && <p className="text-xs font-bold text-base-content">{ev.score.away}</p>}
                                </div>
                            </div>
                            {/* Which channel(s) are streaming this match — from sportsService's
                                lightweight enriched channel list on todayMatches */}
                            {ev.channels?.length > 0 && (
                                <p className="text-[9px] text-base-content/35 truncate mt-1.5 pt-1.5 border-t border-white/5">📺 {ev.channels.map((c) => c.name).join(", ")}</p>
                            )}
                        </button>
                    );
                })}
            </div>
        </section>
    );
}

// ── Sports Channels Section — working channels for the selected event ─────────
// Refetches whenever eventId changes (React Query keys off it). Only working
// channels ever reach here — that filtering happens backend-side.
function SportsChannelsSection({ eventId, enabled }) {
    const { data, isLoading, error } = useQuery({
        queryKey: ["live", "sports", "event-channels", eventId],
        queryFn: () => getSportsEventChannels(eventId),
        enabled: enabled && !!eventId,
        staleTime: 30 * 1000,
    });
    const channels = data?.channels ?? data ?? [];

    if (!eventId) return null;

    return (
        <section>
            <div className="flex items-center gap-2 mb-3">
                <h2 className="text-base sm:text-lg font-semibold text-base-content">Channels Showing This Match</h2>
                {Array.isArray(channels) && channels.length > 0 && <span className="text-xs text-base-content/35 bg-base-300 px-2 py-0.5 rounded-full">{channels.length}</span>}
            </div>
            {error ? (
                <p className="text-sm text-error">Failed to load channels: {error.message}</p>
            ) : isLoading ? (
                <div className="flex gap-3 overflow-hidden">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <CardSkeleton key={i} />
                    ))}
                </div>
            ) : !channels.length ? (
                <p className="text-base-content/40 text-sm py-6 text-center">No working channels found for this match right now.</p>
            ) : (
                <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                    {channels.map((ch, i) => (
                        <LiveBrowseCard key={ch.id ?? ch.url ?? i} item={ch} />
                    ))}
                </div>
            )}
        </section>
    );
}

// ── EPG-detected sports channels — the Hybrid EPG engine's own detection ──────
// This is `recommendedChannels` from /api/live/featured-events — built by
// epgEventDetector.js scanning live channels' actual current programme titles
// for sports keywords. Completely independent of the TheSportsDB key/quota,
// so it's real data even on days the Sports Event API has nothing.
function EpgSportsRow({ channels }) {
    const rowRef = useRef(null);
    const scroll = (dir) => rowRef.current?.scrollBy({ left: dir * 400, behavior: "smooth" });

    if (!channels.length) return null;

    return (
        <section>
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <h2 className="text-base sm:text-lg font-semibold text-base-content">Sports On Now</h2>
                    <span className="text-xs text-base-content/35 bg-base-300 px-2 py-0.5 rounded-full">{channels.length}</span>
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
                {channels.map((ch, i) => (
                    <Link
                        key={ch.channelId ?? i}
                        to={ch.streamUrl ? `/live/watch/${toBase64Url(ch.streamUrl)}` : "#"}
                        state={{ streamUrl: ch.streamUrl, channelName: ch.channelName, channelLogo: ch.channelLogo }}
                        className="group shrink-0 w-36 sm:w-40 md:w-48 no-underline flex flex-col gap-1.5 rounded-xl bg-base-200 hover:bg-base-300/70 transition-colors p-2.5 ring-1 ring-white/5">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg bg-base-300 flex items-center justify-center shrink-0 overflow-hidden ring-1 ring-white/5">
                                {ch.channelLogo ? <img src={ch.channelLogo} alt="" className="w-full h-full object-contain" loading="lazy" /> : <Tv size={14} className="text-base-content/30" />}
                            </div>
                            <p className="text-xs font-semibold text-base-content truncate flex-1">{ch.channelName}</p>
                        </div>
                        {ch.programme?.title && <p className="text-[11px] text-base-content/50 truncate">▶ {ch.programme.title}</p>}
                        <span className="inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-error/90 text-white w-fit">
                            <Radio size={7} className="animate-pulse" /> LIVE
                        </span>
                    </Link>
                ))}
            </div>
        </section>
    );
}

// ── Category row ──────────────────────────────────────────────────────────────
function CategoryRow({ category, enabled, mode, workingOnly }) {
    const rowRef = useRef(null);
    const { data, isLoading } = useQuery({
        queryKey: ["live", "channels", { category: category.name, page: 1, limit: ROW_LIMIT, mode, workingOnly }],
        queryFn: () => getLiveChannels({ category: category.name, page: 1, limit: ROW_LIMIT, workingOnly, all: mode === "all" }),
        enabled,
        staleTime: 60 * 1000,
    });
    const channels = data?.channels ?? [];
    const total = data?.total ?? 0;
    if (!isLoading && channels.length === 0) return null;
    const scroll = (dir) => rowRef.current?.scrollBy({ left: dir * 500, behavior: "smooth" });

    return (
        <section>
            <div className="flex items-center justify-between mb-3 gap-2">
                <Link to={`/live/category/${encodeURIComponent(category.name.toLowerCase())}`} className="flex items-center gap-2 no-underline group/cat min-w-0">
                    <h2 className="text-sm sm:text-base md:text-lg font-semibold text-base-content group-hover/cat:text-primary transition-colors truncate">{category.name}</h2>
                    {total > 0 && <span className="text-xs text-base-content/35 bg-base-300 px-2 py-0.5 rounded-full shrink-0">{total}</span>}
                    <ChevronRight size={15} className="text-base-content/30 group-hover/cat:text-primary transition-colors shrink-0" />
                </Link>
                <div className="hidden sm:flex gap-1 shrink-0">
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
            <div ref={rowRef} className="flex gap-2.5 sm:gap-3 overflow-x-auto pb-2 -mx-1 px-1" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                {isLoading ? Array.from({ length: 8 }).map((_, i) => <CardSkeleton key={i} />) : channels.map((ch, i) => <LiveBrowseCard key={ch.id ?? ch.url ?? i} item={ch} />)}
            </div>
        </section>
    );
}

// ── Search grid ───────────────────────────────────────────────────────────────
function SearchGrid({ q, enabled, mode, workingOnly }) {
    const PAGE_LIMIT = 25;
    const [page, setPage] = useState(1);
    useEffect(() => {
        setPage(1);
    }, [q, mode, workingOnly]);

    const { data, isLoading, isFetching, error } = useQuery({
        queryKey: ["live", "channels", { q, page, mode, workingOnly }],
        queryFn: () => getLiveChannels({ q, page, limit: PAGE_LIMIT, workingOnly, all: mode === "all" }),
        enabled: enabled && !!q,
        staleTime: 60 * 1000,
    });
    const channels = data?.channels ?? [];
    const total = data?.total ?? 0;
    const totalPages = Math.max(1, data?.totalPages ?? Math.ceil(total / PAGE_LIMIT));

    if (error) return <p className="text-sm text-error">Search failed: {error.message}</p>;
    if (isLoading)
        return (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
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
            <div className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4 transition-opacity ${isFetching ? "opacity-60" : ""}`}>
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
    const { isAuthenticated, isApproved, loading: authLoading } = useAuth();
    const enabled = !authLoading && isAuthenticated && isApproved;

    // Page-level toggle — reactive (unlike a plain localStorage read, this
    // actually re-renders + refetches the moment it's flipped). Seeded from
    // the same "flux-prefs" key Settings → Live writes to, and written back
    // on change so the two stay in sync either direction.
    const [channelMode, setChannelMode] = useState(getLiveChannelMode);
    function changeChannelMode(next) {
        setChannelMode(next);
        try {
            const prefs = JSON.parse(localStorage.getItem("flux-prefs") || "{}");
            localStorage.setItem("flux-prefs", JSON.stringify({ ...prefs, liveChannelMode: next }));
        } catch {}
    }

    // "Hide non-working channels" — Settings-only toggle (no in-page control
    // here), so a plain mount-time read is enough; re-opening this page after
    // changing it in Settings picks up the new value same as channelMode does.
    const [workingOnly] = useState(getLiveWorkingOnlyPref);

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

    // Featured Sports Event API — hero + today's matches + recommended channels.
    // Refetch every minute per spec; backend owns all scoring/selection.
    const { data: featuredData, isLoading: featuredLoading } = useQuery({
        queryKey: ["live", "sports", "featured"],
        queryFn: getFeaturedEvents,
        enabled,
        staleTime: 60 * 1000,
        refetchInterval: 60 * 1000,
    });
    const topEvent = featuredData?.featuredEvents?.[0] ?? null;
    const todayMatches = featuredData?.todayMatches ?? [];
    const recommendedChannels = featuredData?.recommendedChannels ?? [];

    // Which event's channels are shown below — defaults to the backend's top
    // featured event, but the person can tap any match card to switch.
    const [selectedEventId, setSelectedEventId] = useState(null);
    const activeEventId = selectedEventId ?? topEvent?.id ?? null;

    // Last-resort fallback banner (no sports events AND no recommended channel
    // from the backend) — pulls straight from the toggled channel set (no
    // category filter) so it reflects whatever channelMode/workingOnly the
    // person picked. Previously this filtered by categories[0].name, but that
    // category comes from the unfiltered category list — if the Active-only
    // set happened to have zero channels in that specific category, the query
    // returned empty and the banner was stuck on the skeleton forever, which
    // looked like "the banner doesn't work for Active Only".
    const hasSportsHero = !featuredLoading && (topEvent || recommendedChannels[0]);
    const { data: bannerData } = useQuery({
        queryKey: ["live", "channels", { page: 1, limit: 12, mode: channelMode, workingOnly }],
        queryFn: () => getLiveChannels({ page: 1, limit: 12, workingOnly, all: channelMode === "all" }),
        enabled: enabled && !featuredLoading && !hasSportsHero,
        staleTime: 60 * 1000,
    });
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
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-center px-4">
                <Tv size={36} className="text-base-content/25" />
                <p className="text-base-content/50 text-sm">Sign in to watch Live TV.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 sm:space-y-8">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-2">
                    <Tv size={20} className="text-primary shrink-0" />
                    <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-base-content">Live TV</h1>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
                    {/* Active Only / All Channel — full-width equal-split buttons on mobile
                        so both are comfortably tappable instead of a cramped pill. */}
                    <div className="grid grid-cols-2 sm:inline-flex sm:items-center w-full sm:w-auto rounded-md border border-base-content/10 bg-base-300 p-0.5 shrink-0">
                        {[
                            { v: "active", l: "Active Only" },
                            { v: "all", l: "All Channel" },
                        ].map((o) => (
                            <button
                                key={o.v}
                                onClick={() => changeChannelMode(o.v)}
                                className={`px-2 sm:px-3 py-2 sm:py-1.5 rounded text-xs font-semibold transition-colors border-none cursor-pointer whitespace-nowrap
                                    ${channelMode === o.v ? "bg-primary text-primary-content" : "bg-transparent text-base-content/50 hover:text-base-content/80"}`}>
                                {o.l}
                            </button>
                        ))}
                    </div>
                    <div className="flex items-center gap-2 bg-base-300 rounded-md px-3 h-9 w-full sm:w-64">
                        <Search size={16} className="text-base-content/50 shrink-0" />
                        <input
                            type="text"
                            value={searchInput}
                            onChange={(e) => handleSearchChange(e.target.value)}
                            placeholder="Search channels..."
                            className="bg-transparent outline-none text-sm text-base-content placeholder:text-base-content/40 w-full min-w-0"
                        />
                    </div>
                </div>
            </div>

            {/* Search mode → grid */}
            {q ? (
                <SearchGrid q={q} enabled={enabled} mode={channelMode} workingOnly={workingOnly} />
            ) : (
                <div className="space-y-8 sm:space-y-10">
                    {/* Sports Hero — Featured Sports Event API, backend-picked */}
                    {hasSportsHero ? (
                        <SportsHero event={topEvent} fallbackChannel={!topEvent ? recommendedChannels[0] : null} loading={featuredLoading} />
                    ) : featuredLoading || bannerChannels.length === 0 ? (
                        <BannerSkeleton />
                    ) : (
                        <CarouselBanner channels={bannerChannels} />
                    )}

                    {/* Sports Event Carousel — every one of today's matches, click to select */}
                    <SportsEventCarousel matches={todayMatches} selectedId={activeEventId} onSelect={setSelectedEventId} loading={featuredLoading} />

                    {/* Sports Channels — working channels broadcasting the selected match */}
                    <SportsChannelsSection eventId={activeEventId} enabled={enabled} />

                    {/* EPG-detected sports channels — real data independent of TheSportsDB */}
                    <EpgSportsRow channels={recommendedChannels} />

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
                        <p className="text-base-content/40 text-sm py-10 text-center px-4">No live channels yet. Add a source from the admin dashboard (IPTV tab).</p>
                    ) : (
                        categories.map((cat) => <CategoryRow key={cat.name} category={cat} enabled={enabled} mode={channelMode} workingOnly={workingOnly} />)
                    )}
                </div>
            )}
        </div>
    );
}
