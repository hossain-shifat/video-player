// Same focus ring as Navbar

import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams, Link } from "react-router";
import { Bell, BellOff, CheckCheck, X, BellRing } from "lucide-react";
import { useNotifications, usePushLifecycle, usePushState } from "../../Hooks/Query/useNotifications";
import { enablePush } from "../../Utils/push";
import { NotificationModal, FOCUS_RING, TONES, Visual, fmtDate, metaFor, timeAgo, useResolvedMedia } from "./Modal";

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

function NotificationRow({ n, onOpen, onDismiss }) {
    const { items } = useResolvedMedia(n.media?.ids, { serverItems: n.media?.items });
    const d = describeRow(n, items);
    const tone = TONES[metaFor(n.type).tone];

    return (
        <li className="group relative">
            <button
                onClick={() => onOpen(n)}
                className={`w-full flex items-start gap-3 px-3 py-2.5 pr-9 rounded-lg text-left transition-colors duration-150 hover:bg-white/5 focus-visible:bg-white/5 cursor-pointer ${FOCUS_RING}`}>
                <Visual poster={d.poster} type={n.type} size={d.poster ? 52 : 38} />
                <span className="min-w-0 flex-1">
                    <span className={`block text-sm leading-snug truncate ${n.read ? "text-white/60" : "text-white font-medium"}`}>
                        {!n.read && <span className="sr-only">Unread: </span>}
                        {d.heading}
                    </span>
                    {d.summary && <span className="block text-xs leading-snug mt-0.5 line-clamp-2 text-[oklch(66%_0.015_260)]">{d.summary}</span>}
                    <span className="mt-1 flex items-center gap-1.5 text-[10px] text-[oklch(56%_0.015_260)]">
                        <span className="font-semibold uppercase tracking-wider" style={{ color: tone.fg }}>
                            {n.category}
                        </span>
                        <span aria-hidden="true">·</span>
                        <time dateTime={n.createdAt} title={fmtDate(n.createdAt)}>
                            {timeAgo(n.createdAt)}
                        </time>
                    </span>
                </span>
                {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: "oklch(58% 0.22 20)" }} aria-hidden="true" />}
            </button>
            <button
                onClick={() => onDismiss(n.id)}
                className={`absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-md text-[oklch(62%_0.015_260)] hover:text-white hover:bg-white/10 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 focus-visible:opacity-100 transition-all duration-150 cursor-pointer ${FOCUS_RING}`}
                aria-label={`Dismiss: ${d.heading}`}>
                <X size={13} strokeWidth={2.2} />
            </button>
        </li>
    );
}

const Notifications = () => {
    const [open, setOpen] = useState(false);
    const [pushBusy, setPushBusy] = useState(false);
    const [pushError, setPushError] = useState("");

    const btnRef = useRef(null);
    const panelRef = useRef(null);
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const [selectedId, setSelectedId] = useState(null);

    // Data comes from the backend now; this hook polls + updates optimistically.
    const { items, unreadCount: unread, isAuthenticated, markRead, markAllRead, remove, clearAll } = useNotifications();
    usePushLifecycle(); // re-attach push token on sign-in, refresh on incoming push, route on click
    const push = usePushState();
    const canOfferPush = isAuthenticated && push.support.supported && push.configured && !push.enabledHere && push.permission !== "denied";

    const close = useCallback((restoreFocus = false) => {
        setOpen(false);
        if (restoreFocus) btnRef.current?.focus();
    }, []);

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

    return (
        // `contents` wrapper → button stays a direct flex child of .nav-act, so
        // the mobile reveal animation (.nav-act-item[data-i="2"]) still works.
        <div className="contents">
            {/* Bell — icon/button classes identical to the old navbar bell */}
            <button
                ref={btnRef}
                data-i="2"
                onClick={() => setOpen((v) => !v)}
                className="nav-act-item relative inline-flex shrink-0 items-center justify-center w-9 h-9 lg:w-8 lg:h-8 rounded-full lg:rounded-md bg-white/[0.07] lg:bg-transparent text-white/80 lg:text-white/75 hover:text-white hover:bg-white/12 lg:hover:bg-white/5 active:scale-90 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                aria-label="Notifications"
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-controls={open ? "notifications-panel" : undefined}>
                <Bell size={17} strokeWidth={1.8} />
                {unread > 0 && (
                    <span
                        className="absolute top-0.5 right-0.5 lg:-top-0.5 lg:-right-0.5 flex items-center justify-center rounded-full text-[9px] font-bold text-white px-1 ring-2 ring-base-200"
                        style={{ background: "oklch(58% 0.22 20)", lineHeight: 1, minWidth: "16px", height: "16px" }}>
                        {unread > 9 ? "9+" : unread}
                    </span>
                )}
            </button>

            {/* Panel — anchored under the navbar row, same surface as Browse/Account panels */}
            {open && (
                <div
                    id="notifications-panel"
                    ref={panelRef}
                    role="dialog"
                    aria-label="Notifications"
                    className="nav-anim absolute right-3 sm:right-5 lg:right-6 xl:right-8 top-full mt-1.5 w-[min(22rem,calc(100vw-1.5rem))] rounded-xl overflow-hidden"
                    style={{
                        background: "oklch(15% 0.012 260 / 0.97)",
                        backdropFilter: "blur(24px) saturate(160%)",
                        WebkitBackdropFilter: "blur(24px) saturate(160%)",
                        border: "1px solid oklch(100% 0 0 / 0.08)",
                        boxShadow: "0 12px 40px oklch(0% 0 0 / 0.6), 0 0 0 1px oklch(100% 0 0 / 0.04)",
                        animation: "dropdownIn 0.18s ease-out",
                    }}>
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
                        <span className="text-[10px] font-semibold uppercase tracking-widest text-[oklch(62%_0.015_260)]">Notifications</span>
                        <div className="flex items-center gap-1">
                            {unread > 0 && (
                                <button
                                    onClick={markAllRead}
                                    className={`flex items-center gap-1 px-2 h-6 rounded-md text-[11px] font-medium text-[oklch(70%_0.01_260)] hover:text-white hover:bg-white/5 transition-colors duration-150 cursor-pointer ${FOCUS_RING}`}>
                                    <CheckCheck size={13} strokeWidth={2} />
                                    Mark all read
                                </button>
                            )}
                            <button
                                onClick={() => close(true)}
                                className={`w-6 h-6 flex items-center justify-center rounded-md text-[oklch(62%_0.015_260)] hover:text-white transition-colors duration-150 cursor-pointer ${FOCUS_RING}`}
                                aria-label="Close notifications">
                                <X size={14} strokeWidth={2.5} />
                            </button>
                        </div>
                    </div>

                    {/* List */}
                    {items.length === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-[oklch(62%_0.015_260)]">
                            <BellOff size={26} strokeWidth={1.6} />
                            <p className="text-sm">{isAuthenticated ? "You're all caught up" : "Sign in to see notifications"}</p>
                        </div>
                    ) : (
                        <ul className="max-h-[min(24rem,60dvh)] overflow-y-auto overscroll-contain px-1 pb-1" style={{ scrollbarWidth: "none" }}>
                            {items.map((n) => (
                                <NotificationRow key={n.id} n={n} onOpen={openItem} onDismiss={dismiss} />
                            ))}
                        </ul>
                    )}

                    {/* Footer */}
                    {isAuthenticated && (
                        <div className="px-2 pb-2">
                            <div className="h-px mb-2 mx-1" style={{ background: "oklch(100% 0 0 / 0.07)" }} />
                            {canOfferPush && (
                                <div className="px-1 pb-1">
                                    <button
                                        onClick={turnOnPush}
                                        disabled={pushBusy}
                                        className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white bg-white/10 hover:bg-white/15 disabled:opacity-50 transition-colors duration-150 cursor-pointer ${FOCUS_RING}`}>
                                        <BellRing size={13} strokeWidth={2} />
                                        {pushBusy ? "Enabling…" : "Get alerts outside the browser"}
                                    </button>
                                    {pushError && <p className="mt-1.5 px-1 text-[11px] leading-snug text-[oklch(70%_0.15_25)]">{pushError}</p>}
                                </div>
                            )}
                            <div className="flex items-center gap-1">
                                {items.length > 0 && (
                                    <button
                                        onClick={clearAll}
                                        className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium text-[oklch(70%_0.01_260)] hover:text-white hover:bg-white/5 transition-colors duration-150 cursor-pointer ${FOCUS_RING}`}>
                                        Clear all
                                    </button>
                                )}
                                <Link
                                    to="/settings?tab=notifications"
                                    onClick={() => setOpen(false)}
                                    className={`flex-1 px-3 py-2 rounded-lg text-center text-xs font-medium text-[oklch(70%_0.01_260)] hover:text-white hover:bg-white/5 transition-colors duration-150 ${FOCUS_RING}`}>
                                    Settings
                                </Link>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {selectedId && <NotificationModal id={selectedId} onClose={closeModal} onAction={goTo} markRead={markRead} />}
        </div>
    );
};

export default Notifications;
