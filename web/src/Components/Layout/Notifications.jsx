// Same focus ring as Navbar

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams, Link } from "react-router";
import { Bell, BellOff, BellRing, CheckCheck, ChevronLeft, SlidersHorizontal, Trash2, X } from "lucide-react";
import { useNotifications, usePushLifecycle, usePushState } from "../../Hooks/Query/useNotifications";
import { enablePush } from "../../Utils/push";
import { NotificationModal, FOCUS_RING, Visual, fmtDate, timeAgo, useResolvedMedia } from "./Modal";

// ── Config ────────────────────────────────────────────────────────────────────
const GROUPS = ["Today", "Yesterday", "Earlier"];

// Tabs. `test` decides which notifications a tab shows.
// Account tab = an EXPLICIT set of backend notification types (no text matching, so an unrelated type whose name merely
// contains "role" / "access" can never leak in, and "signup_pending" — a pending sign-up — is always included).
// Add a name here when the backend gains a new account-level notification type.
const isMedia = (n) => n.type === "new_media";
const ACCOUNT_TYPES = new Set(["account", "signup_pending", "account_approved", "account_blocked", "account_pending", "role_changed", "access_granted", "access_revoked", "permission_changed"]);
const isAccount = (n) => ACCOUNT_TYPES.has(n.type);

function bucketOf(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "Earlier";
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diff = Math.round((today - day) / 86400000);
    return diff <= 0 ? "Today" : diff === 1 ? "Yesterday" : "Earlier";
}

// true below the `md` breakpoint → the panel becomes a full-screen page
function useIsMobile() {
    const query = "(max-width: 767px)";
    const [mobile, setMobile] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
    useEffect(() => {
        const mq = window.matchMedia(query);
        const onChange = () => setMobile(mq.matches);
        mq.addEventListener("change", onChange);
        return () => mq.removeEventListener("change", onChange);
    }, []);
    return mobile;
}

// Primary / secondary lines for a list row. Falls back to the stored (generic) text whenever media can't be resolved.
function describeRow(n, media) {
    const ok = media?.filter((m) => m.found) ?? [];
    if (n.type === "new_media" && ok.length) {
        const total = Math.max(n.media?.count ?? ok.length, ok.length);
        const where = n.media?.library ? `Added to ${n.media.library}` : "Added to your library";
        // Episodes of one series → "Severance" + "S01E02 · Added to Series" (or "3 new episodes").
        const sameShow = ok.every((m) => m.isShow && m.bare === ok[0].bare);
        if (sameShow) {
            const what = total === 1 ? ok[0].code : `${total} new episodes${ok.length <= 3 && ok.every((m) => m.code) ? ` (${ok.map((m) => m.code).join(", ")})` : ""}`;
            return { heading: ok[0].bare, summary: [what, where].filter(Boolean).join(" · "), poster: ok[0].poster };
        }
        const heading = total > 1 ? `${ok[0].title} and ${total - 1} more` : ok[0].title;
        return { heading, summary: ok[0].subtitle && total === 1 ? `${ok[0].subtitle} · ${where}` : where, poster: ok[0].poster };
    }
    return { heading: n.title, summary: n.body, poster: null };
}

// One bar: [visual] [title + summary] [time] [bin]. Whole bar (minus the bin) opens the details modal.
function NotificationRow({ n, onOpen, onDismiss }) {
    const { items } = useResolvedMedia(n.media?.ids, { serverItems: n.media?.items });
    const d = describeRow(n, items);

    return (
        <li className={`flex items-center gap-1 rounded-md border border-base-300 pl-2.5 pr-1 py-2 transition-colors duration-150 ${n.read ? "bg-base-200" : "bg-base-300"}`}>
            <button onClick={() => onOpen(n)} className={`group flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-left cursor-pointer ${FOCUS_RING}`}>
                <span className={`relative block size-10 shrink-0 overflow-hidden rounded-md ${n.read ? "opacity-70" : ""}`}>
                    <Visual poster={d.poster} type={n.type} size={40} />
                </span>

                <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm leading-[18px] ${n.read ? "font-medium text-base-content/85" : "font-semibold text-base-content"}`}>
                        {!n.read && <span className="sr-only">Unread: </span>}
                        {d.heading}
                    </span>
                    {d.summary && <span className="block truncate text-xs leading-[18px] text-base-content/80">{d.summary}</span>}
                    {n.category && <span className="sr-only">{n.category}</span>}
                </span>

                <span className="flex shrink-0 items-center gap-1.5 text-[11px] leading-none text-base-content/80 whitespace-nowrap">
                    {!n.read && <span className="size-2 rounded-full bg-primary" aria-hidden="true" />}
                    <time dateTime={n.createdAt} title={fmtDate(n.createdAt)}>
                        {timeAgo(n.createdAt)}
                    </time>
                </span>
            </button>

            <button
                onClick={() => onDismiss(n.id)}
                className={`flex size-9 md:size-7 shrink-0 items-center justify-center rounded-md text-error hover:bg-base-200 transition-colors duration-150 cursor-pointer ${FOCUS_RING}`}
                aria-label={`Delete notification: ${d.heading}`}>
                <Trash2 size={15} strokeWidth={2} />
            </button>
        </li>
    );
}

const Notifications = () => {
    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState("all");
    const [confirmClear, setConfirmClear] = useState(false);
    const [pushBusy, setPushBusy] = useState(false);
    const [pushError, setPushError] = useState("");

    const btnRef = useRef(null);
    const panelRef = useRef(null);
    const backRef = useRef(null);
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const [selectedId, setSelectedId] = useState(null);
    const isMobile = useIsMobile();

    // Data comes from the backend now; this hook polls + updates optimistically.
    const { items, unreadCount: unread, isAuthenticated, markRead, markAllRead, remove, clearAll } = useNotifications();
    usePushLifecycle(); // re-attach push token on sign-in, refresh on incoming push, route on click
    const push = usePushState();
    const canOfferPush = isAuthenticated && push.support.supported && push.configured && !push.enabledHere && push.permission !== "denied";

    const close = useCallback((restoreFocus = false) => {
        setOpen(false);
        if (restoreFocus) btnRef.current?.focus();
    }, []);

    // Mobile full-screen panel only: move focus to Back, keep Tab inside the panel, give focus back to the bell on close.
    // (The desktop dropdown keeps its normal, non-modal behaviour.)
    useEffect(() => {
        if (!open || !isMobile) return;
        const bell = btnRef.current;
        backRef.current?.focus();
        function trap(e) {
            if (e.key !== "Tab" || !panelRef.current) return;
            const f = [...panelRef.current.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null);
            if (!f.length) return;
            const first = f[0];
            const last = f[f.length - 1];
            if (!panelRef.current.contains(document.activeElement)) {
                e.preventDefault();
                first.focus();
            } else if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
        document.addEventListener("keydown", trap);
        return () => {
            document.removeEventListener("keydown", trap);
            bell?.focus(); // closed by any route → focus returns to the bell
        };
    }, [open, isMobile]);

    // Outside click + Escape
    useEffect(() => {
        if (!open) return;
        function onDown(e) {
            const t = e.target;
            if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
            setOpen(false);
        }
        function onKey(e) {
            if (e.key === "Escape") close(true);
        }
        document.addEventListener("mousedown", onDown);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onDown);
            document.removeEventListener("keydown", onKey);
        };
    }, [open, close]);

    // Full-screen page on mobile → lock the page behind it
    useEffect(() => {
        if (!open || !isMobile) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = prev;
        };
    }, [open, isMobile]);

    // Reset transient UI whenever the panel closes
    useEffect(() => {
        if (open) return;
        setConfirmClear(false);
        setTab("all");
    }, [open]);

    const dismiss = remove;

    // Clicking a notification opens its details modal (it does not navigate by itself).
    const openItem = (n) => {
        setOpen(false);
        setSelectedId(n.id);
    };

    const closeModal = useCallback(() => setSelectedId(null), []);

    // Modal action button → close, then go to the destination the SERVER verified.
    const goTo = useCallback(
        (path) => {
            setSelectedId(null);
            navigate(path);
        },
        [navigate],
    );

    // Arrived from a system (push) notification: /?n=<id> opens its modal, then the param is removed.
    useEffect(() => {
        const id = searchParams.get("n");
        if (!id || !isAuthenticated) return;
        setSelectedId(id);
        const next = new URLSearchParams(searchParams);
        next.delete("n");
        setSearchParams(next, { replace: true });
    }, [searchParams, isAuthenticated, setSearchParams]);

    // enablePush() shows the permission prompt, so it has to run inside this click.
    const turnOnPush = async () => {
        setPushBusy(true);
        setPushError("");
        try {
            await enablePush();
        } catch (err) {
            setPushError(err.message || "Couldn't enable push.");
        } finally {
            setPushBusy(false);
        }
    };

    const TABS = [
        { id: "all", label: "All" },
        { id: "unread", label: unread > 0 ? `Unread ${unread}` : "Unread" },
        { id: "media", label: "Media" },
        { id: "account", label: "Account" },
    ];

    // Filter by tab, then bucket into Today / Yesterday / Earlier (keeps the server's newest-first order)
    const grouped = useMemo(() => {
        const keep = { all: () => true, unread: (n) => !n.read, media: isMedia, account: isAccount }[tab] ?? (() => true);
        const buckets = { Today: [], Yesterday: [], Earlier: [] };
        for (const n of items) if (keep(n)) buckets[bucketOf(n.createdAt)].push(n);
        return GROUPS.map((g) => ({ label: g, rows: buckets[g] })).filter((g) => g.rows.length);
    }, [items, tab]);

    const handleClearAll = () => {
        clearAll();
        setConfirmClear(false);
    };

    const panel = open && (
        <div
            id="notifications-panel"
            ref={panelRef}
            role="dialog"
            aria-label="Notifications"
            className="nav-anim fixed inset-0 z-50 flex h-dvh w-full flex-col overflow-hidden bg-base-200 md:absolute md:inset-auto md:right-5 md:top-full md:mt-1.5 md:h-[min(35rem,calc(100dvh-5rem))] md:w-[22rem] md:rounded-md md:border md:border-base-300 md:shadow-2xl lg:right-6 xl:right-8"
            style={{ animation: "dropdownIn 0.18s ease-out" }}>
            {/* Header — one row: back (mobile) / title / mark all read / close (desktop) */}
            <div className="flex items-center gap-1.5 px-3 pt-3 pb-2 md:px-4 md:pt-4">
                <button
                    ref={backRef}
                    onClick={() => close(true)}
                    className={`flex size-10 shrink-0 items-center justify-center rounded-md text-base-content/85 hover:text-base-content hover:bg-base-300 transition-colors duration-150 cursor-pointer md:hidden ${FOCUS_RING}`}
                    aria-label="Back">
                    <ChevronLeft size={22} strokeWidth={2} />
                </button>
                <h2 className="flex-1 text-lg font-semibold text-base-content">Notifications</h2>
                <button
                    onClick={markAllRead}
                    disabled={unread === 0}
                    className={`flex size-10 md:size-8 shrink-0 items-center justify-center rounded-md bg-base-300 text-base-content/85 hover:text-base-content transition-colors duration-150 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`}
                    aria-label="Mark all as read"
                    title="Mark all as read">
                    <CheckCheck size={17} strokeWidth={2} />
                </button>
                <button
                    onClick={() => close(true)}
                    className={`hidden size-8 shrink-0 items-center justify-center rounded-md text-base-content/85 hover:text-base-content hover:bg-base-300 transition-colors duration-150 cursor-pointer md:flex ${FOCUS_RING}`}
                    aria-label="Close notifications">
                    <X size={17} strokeWidth={2} />
                </button>
            </div>

            {/* Tabs — the only filter layer */}
            <div role="tablist" aria-label="Filter notifications" className="flex gap-2 overflow-x-auto px-3 pb-2 md:px-4" style={{ scrollbarWidth: "none" }}>
                {TABS.map((t) => (
                    <button
                        key={t.id}
                        role="tab"
                        aria-selected={tab === t.id}
                        onClick={() => setTab(t.id)}
                        className={`h-10 md:h-8 shrink-0 rounded-md px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors duration-150 cursor-pointer ${FOCUS_RING} ${tab === t.id ? "bg-primary text-primary-content" : "bg-base-300 text-base-content/85 hover:text-base-content"}`}>
                        {t.label}
                    </button>
                ))}
            </div>

            {/* List — the only part that scrolls */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-base-300 px-2.5 pb-2" style={{ scrollbarWidth: "none" }}>
                {grouped.length === 0 ? (
                    <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 px-4 text-base-content/80">
                        <BellOff size={26} strokeWidth={1.6} />
                        <p className="text-sm">{!isAuthenticated ? "Sign in to see notifications" : items.length === 0 ? "You're all caught up" : "Nothing in this tab"}</p>
                    </div>
                ) : (
                    grouped.map((g) => (
                        <section key={g.label} aria-label={g.label}>
                            <h3 className="px-1 pt-3.5 pb-2 text-xs font-semibold text-base-content/80">{g.label}</h3>
                            <ul className="flex flex-col gap-1">
                                {g.rows.map((n) => (
                                    <NotificationRow key={n.id} n={n} onOpen={openItem} onDismiss={dismiss} />
                                ))}
                            </ul>
                        </section>
                    ))
                )}
            </div>

            {/* Footer — one row (push offer only appears when it applies) */}
            {isAuthenticated && (
                <div className="border-t border-base-300 bg-base-200 px-2.5 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
                    {canOfferPush && (
                        <div className="pb-2">
                            <button
                                onClick={turnOnPush}
                                disabled={pushBusy}
                                className={`flex w-full items-center justify-center gap-1.5 rounded-md bg-base-300 px-3 h-10 md:h-9 text-xs font-medium text-base-content hover:text-base-content transition-colors duration-150 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}>
                                <BellRing size={13} strokeWidth={2} />
                                {pushBusy ? "Enabling…" : "Get alerts outside the browser"}
                            </button>
                            {pushError && <p className="mt-1.5 px-1 text-[11px] leading-snug text-error">{pushError}</p>}
                        </div>
                    )}

                    {confirmClear ? (
                        <div className="flex items-center gap-2 px-1">
                            <span className="flex-1 text-xs text-base-content/85">Delete all notifications?</span>
                            <button
                                onClick={() => setConfirmClear(false)}
                                className={`h-10 md:h-9 rounded-md bg-base-300 px-3 text-xs font-medium text-base-content/85 hover:text-base-content transition-colors duration-150 cursor-pointer ${FOCUS_RING}`}>
                                Cancel
                            </button>
                            <button onClick={handleClearAll} className={`btn btn-error btn-sm h-10 md:h-9 rounded-md border-none text-xs cursor-pointer ${FOCUS_RING}`}>
                                <Trash2 size={13} strokeWidth={2} />
                                Delete all
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center justify-between">
                            {items.length > 0 ? (
                                <button
                                    onClick={() => setConfirmClear(true)}
                                    className={`inline-flex h-10 md:h-9 items-center gap-1.5 rounded-md px-3 text-xs font-medium text-error hover:bg-base-300 transition-colors duration-150 cursor-pointer ${FOCUS_RING}`}>
                                    <Trash2 size={13} strokeWidth={2} />
                                    Clear all
                                </button>
                            ) : (
                                <span />
                            )}
                            <Link
                                to="/settings?tab=notifications"
                                onClick={() => setOpen(false)}
                                className={`inline-flex h-10 md:h-9 items-center gap-1.5 rounded-md px-3 text-xs font-medium text-base-content/85 hover:text-base-content hover:bg-base-300 transition-colors duration-150 cursor-pointer ${FOCUS_RING}`}>
                                <SlidersHorizontal size={13} strokeWidth={2} />
                                Settings
                            </Link>
                        </div>
                    )}
                </div>
            )}
        </div>
    );

    return (
        // `contents` wrapper → bell stays a direct flex child of the navbar action row.
        <div className="contents">
            {/* Bell — ghost icon button, same box as the other navbar actions */}
            <button
                ref={btnRef}
                onClick={() => setOpen((v) => !v)}
                className={`relative inline-flex shrink-0 items-center justify-center w-10 h-10 md:w-9 md:h-9 rounded-full active:scale-90 transition-colors duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${open ? "text-white bg-white/[0.07]" : "text-white/85 hover:text-white hover:bg-white/10"}`}
                aria-label="Notifications"
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-controls={open ? "notifications-panel" : undefined}>
                <Bell size={18} strokeWidth={1.8} />
                {unread > 0 && (
                    <span
                        className="absolute top-1 right-0.5 md:top-0.5 md:right-0 flex items-center justify-center rounded-full text-[9px] font-bold text-white px-1 ring-2 ring-base-100"
                        style={{ background: "oklch(58% 0.22 20)", lineHeight: 1, minWidth: "16px", height: "16px" }}>
                        {unread > 9 ? "9+" : unread}
                    </span>
                )}
            </button>

            {/* Panel — dropdown under the navbar on md+, full-screen page (portal) below md */}
            {panel && (isMobile ? createPortal(panel, document.body) : panel)}

            {selectedId && <NotificationModal id={selectedId} onClose={closeModal} onAction={goTo} markRead={markRead} />}
        </div>
    );
};

export default Notifications;
