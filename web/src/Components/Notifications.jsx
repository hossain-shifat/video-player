import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Bell, BellOff, CheckCheck, X } from "lucide-react";

// Same focus ring as Navbar
const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60";

// TODO: replace with real API data. Pass `initialItems` prop or lift state to context.
const SAMPLE_ITEMS = [
    { id: "n1", title: "Library scan finished", body: "Test Movies — new titles added.", time: "2m ago", read: false },
    { id: "n2", title: "Metadata updated", body: "Posters refreshed from TMDB.", time: "1h ago", read: false },
    { id: "n3", title: "New trailers available", body: "Fresh trailers for studios you own.", time: "Yesterday", read: false },
];

const Notifications = ({ initialItems = SAMPLE_ITEMS }) => {
    const [open, setOpen] = useState(false);
    const [items, setItems] = useState(initialItems);

    const btnRef = useRef(null);
    const panelRef = useRef(null);

    const unread = useMemo(() => items.filter((n) => !n.read).length, [items]);

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

    const markRead = (id) => setItems((p) => p.map((n) => (n.id === id ? { ...n, read: true } : n)));
    const markAllRead = () => setItems((p) => p.map((n) => ({ ...n, read: true })));
    const dismiss = (id) => setItems((p) => p.filter((n) => n.id !== id));
    const clearAll = () => setItems([]);

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
                            <p className="text-sm">You're all caught up</p>
                        </div>
                    ) : (
                        <ul className="max-h-[min(24rem,60dvh)] overflow-y-auto overscroll-contain px-1 pb-1" style={{ scrollbarWidth: "none" }}>
                            {items.map((n) => (
                                <li key={n.id} className="group relative">
                                    <button
                                        onClick={() => markRead(n.id)}
                                        className={`w-full flex items-start gap-3 px-3 py-2.5 pr-9 rounded-lg text-left transition-colors duration-150 hover:bg-white/5 focus-visible:bg-white/5 cursor-pointer ${FOCUS_RING}`}>
                                        <span className="mt-1.5 shrink-0 w-2 h-2 rounded-full" style={{ background: n.read ? "transparent" : "oklch(58% 0.22 20)" }} aria-hidden="true" />
                                        <span className="min-w-0 flex-1">
                                            <span className={`block text-sm leading-snug truncate ${n.read ? "text-white/60" : "text-white font-medium"}`}>{n.title}</span>
                                            {n.body && <span className="block text-xs leading-snug mt-0.5 line-clamp-2 text-[oklch(62%_0.015_260)]">{n.body}</span>}
                                            <span className="block text-[10px] mt-1 text-[oklch(52%_0.015_260)]">{n.time}</span>
                                        </span>
                                    </button>
                                    <button
                                        onClick={() => dismiss(n.id)}
                                        className={`absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-md text-[oklch(62%_0.015_260)] hover:text-white hover:bg-white/10 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 focus-visible:opacity-100 transition-all duration-150 cursor-pointer ${FOCUS_RING}`}
                                        aria-label={`Dismiss ${n.title}`}>
                                        <X size={13} strokeWidth={2.2} />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}

                    {/* Footer */}
                    {items.length > 0 && (
                        <div className="px-2 pb-2">
                            <div className="h-px mb-2 mx-1" style={{ background: "oklch(100% 0 0 / 0.07)" }} />
                            <button
                                onClick={clearAll}
                                className={`w-full px-3 py-2 rounded-lg text-xs font-medium text-[oklch(70%_0.01_260)] hover:text-white hover:bg-white/5 transition-colors duration-150 cursor-pointer ${FOCUS_RING}`}>
                                Clear all
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default Notifications;
