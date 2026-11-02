// web/src/Components/Modal.jsx
//
// All dialogs of the app live here (moved out of Notifications.jsx and MediaDetails.jsx).
// Each one has its own id + name (see MODALS below) so you can tell which modal it is, what it is for and where it is used.
//
//   NotificationModal  → opened from Components/Notifications.jsx
//   ReminderModal      → opened from Pages/Media/Details/MediaDetails.jsx
//   TrailerModal       → opened from Pages/Media/Details/MediaDetails.jsx
//   NotInLibraryModal  → opened from Pages/Media/Details/MediaDetails.jsx

import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, X, BellRing, ArrowRight, UserPlus, UserCheck, ShieldAlert, Film, Upload, HardDrive, Megaphone, Info, Play, Monitor, User, Mail, CalendarDays, ShieldCheck, ListChecks, Folder, Check, RefreshCw, TriangleAlert } from "lucide-react";
import { createPortal } from "react-dom";
import { useAuth } from "../auth/AuthContext";
import { getReminder, setReminder, removeReminder } from "../api/notifications";
import { useMedia } from "../Hooks/useMedia";
import { useNotificationDetail, NOTIFICATION_KEYS } from "../Hooks/useNotifications";

// ─── Modal registry ───────────────────────────────────────────────────────────
// Every dialog in the app that lives here has its own id + name, written on the dialog element
// (id="…", name="…", data-modal-source, data-modal-purpose) so it can be found in the DOM / devtools:
//   document.getElementById("modal-notification-details")   ·   document.querySelector('[name="media-reminder"]')
export const MODALS = {
    notificationDetails: {
        id: "modal-notification-details",
        name: "notification-details",
        source: "Components/Notifications.jsx (bell dropdown → NotificationRow)",
        purpose: "Shows the full details of one notification (media, sign-in, sign-up, account, upload, storage, announcement, reminder)",
    },
    mediaReminder: {
        id: "modal-media-reminder",
        name: "media-reminder",
        source: "Pages/Media/Details/MediaDetails.jsx (Remind Me button, upcoming titles)",
        purpose: "Confirm (or remove) a release reminder for an upcoming title",
    },
    mediaTrailer: {
        id: "modal-media-trailer",
        name: "media-trailer",
        source: "Pages/Media/Details/MediaDetails.jsx (trailer play buttons)",
        purpose: "Plays a YouTube trailer",
    },
    mediaNotInLibrary: {
        id: "modal-media-not-in-library",
        name: "media-not-in-library",
        source: "Pages/Media/Details/MediaDetails.jsx (Not in library button)",
        purpose: "Explains that a TMDB-only title has no file in the library and how to add it",
    },
};

// Attributes that identify a dialog: spread on the dialog element.
const modalAttrs = (m) => ({ id: m.id, name: m.name, "data-modal-source": m.source, "data-modal-purpose": m.purpose });

// ─── Responsive dialog frame (every dialog in this file) ──────────────────────
// Phones (< 640px): a bottom sheet. It opens from the bottom edge, full width, rounded top corners, with a grab handle.
// sm and up: centred dialog. Width grows with the screen: 90dvw (sm) · 75dvw (md) · 60dvw (lg and up); height 80dvh.
const SHEET_BACKDROP = "fixed inset-0 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center";
const SHEET_DIALOG =
    "relative flex h-[90dvh] max-h-[90dvh] w-full max-w-full flex-col overflow-hidden rounded-t-2xl border border-b-0 border-base-content/15 bg-base-200 pb-[env(safe-area-inset-bottom)] text-base-content shadow-2xl outline-none " +
    "sm:h-[80dvh] sm:max-h-[80dvh] sm:w-[90dvw] sm:max-w-[90dvw] sm:rounded-md sm:border-b sm:pb-0 md:w-[75dvw] md:max-w-[75dvw] lg:w-[60dvw] lg:max-w-[60dvw]";
// Slide-up animation, phones only (reduced-motion users get none).
function SheetStyle() {
    return (
        <style>{`@keyframes flux-sheet-up{from{transform:translateY(100%)}to{transform:translateY(0)}}
@media (max-width:639px){[data-modal-sheet]{animation:flux-sheet-up 280ms cubic-bezier(.32,.72,0,1) both}}
@media (prefers-reduced-motion:reduce){[data-modal-sheet]{animation:none !important}}`}</style>
    );
}
const SheetHandle = () => <span aria-hidden="true" className="pointer-events-none mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-base-content/25 sm:hidden" />;


export const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60";

// ─── Notification dialog system (self-contained; NOT the ConfirmModal) ───────
// Fixed size: h-[75dvh] w-[60dvw] (max same). Footer stays pinned; the header is NOT sticky (it scrolls away with the body).
// Portal to <body>, focus trap, Escape, backdrop click, scroll lock, focus restore.
const FOCUSABLE = 'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])';

function ModalShell({ modal, onClose, labelledBy, describedBy, children, ...extra }) {
    const ref = useRef(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const prev = document.activeElement;
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        (el.querySelector("[data-autofocus]") || el).focus();

        function onKey(e) {
            if (e.key === "Escape") {
                e.stopPropagation();
                onClose();
                return;
            }
            if (e.key !== "Tab") return;
            const nodes = [...el.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
            if (!nodes.length) {
                e.preventDefault();
                return;
            }
            const first = nodes[0];
            const last = nodes[nodes.length - 1];
            const active = document.activeElement;
            if (e.shiftKey && (active === first || active === el)) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && active === last) {
                e.preventDefault();
                first.focus();
            }
        }
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("keydown", onKey);
            document.body.style.overflow = prevOverflow;
            if (prev && typeof prev.focus === "function") prev.focus();
        };
    }, [onClose]);

    return createPortal(
        <div
            className={SHEET_BACKDROP}
            style={{ zIndex: 2147483647 }}
            onMouseDown={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}>
            <div
                ref={ref}
                {...modalAttrs(modal)}
                {...extra}
                role="dialog"
                aria-modal="true"
                aria-labelledby={labelledBy}
                aria-describedby={describedBy}
                tabIndex={-1}
                data-modal-sheet=""
                className={SHEET_DIALOG}>
                <SheetHandle />
                {children}
                <SheetStyle />
            </div>
        </div>,
        document.body,
    );
}

// Scrolling area: header + body scroll together (header is not sticky). Footer sits outside, pinned.
function ModalScroll({ children }) {
    return <div className="@container flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">{children}</div>;
}

// Padded content under the header
function PanelBody({ children }) {
    return <div className="flex flex-1 flex-col px-3 py-3 sm:px-5 [@media(max-height:820px)]:py-2">{children}</div>;
}

// Pinned bottom bar: note left, buttons right
function ModalFooter({ note, children }) {
    return (
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-base-content/10 bg-base-200 px-4 py-2.5 sm:px-5 max-sm:flex-col max-sm:items-stretch max-sm:gap-y-1.5 max-sm:px-3 max-sm:py-2">
            <div className="min-w-0 text-xs text-base-content/60 max-sm:text-[11px] max-sm:leading-tight">{note}</div>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2 max-sm:ml-0 max-sm:w-full max-sm:flex-nowrap max-sm:gap-1.5 max-sm:[&>button]:flex-1">{children}</div>
        </footer>
    );
}

const BADGE_SOLID = {
    primary: "bg-primary text-primary-content",
    success: "bg-success text-success-content",
    warning: "bg-warning text-warning-content",
    error: "bg-error text-error-content",
    info: "bg-info text-info-content",
    admin: "bg-secondary text-secondary-content",
    neutral: "bg-base-content/20 text-base-content",
};
const BADGE_SOFT = {
    primary: "border-primary/60 text-primary",
    success: "border-success/60 text-success",
    warning: "border-warning/60 text-warning",
    error: "border-error/60 text-error",
    info: "border-info/60 text-info",
    admin: "border-secondary/60 text-secondary",
    neutral: "border-base-content/25 text-base-content/70",
};
function ModalBadge({ tone = "info", icon: Icon, solid = false, children }) {
    const look = solid ? `border-transparent ${BADGE_SOLID[tone] || BADGE_SOLID.info}` : `bg-transparent ${BADGE_SOFT[tone] || BADGE_SOFT.info}`;
    return (
        <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1 text-xs font-medium leading-none max-sm:px-2 max-sm:py-0.5 max-sm:text-[11px] ${look}`}>
            {Icon && <Icon size={13} strokeWidth={2} aria-hidden="true" />}
            {children}
        </span>
    );
}

// Button colour = action type (theme tokens): primary = watch/play · success = go on/open · warning = attention ·
// error = security · info = more details · admin = admin tools. No tone = neutral (Close).
const BTN_TONE = {
    primary: "border-primary/60 bg-primary/15 text-base-content hover:bg-primary/25",
    success: "border-success/60 bg-success/15 text-base-content hover:bg-success/25",
    warning: "border-warning/60 bg-warning/15 text-base-content hover:bg-warning/25",
    error: "border-error/60 bg-error/15 text-base-content hover:bg-error/25",
    info: "border-info/60 bg-info/15 text-base-content hover:bg-info/25",
    admin: "border-secondary/60 bg-secondary/15 text-base-content hover:bg-secondary/25",
    // Footer actions: solid theme primary, white text
    solid: "border-primary bg-primary text-white hover:bg-primary/85",
};
function ModalButton({ variant = "default", tone, loading = false, loadingText, children, className = "", disabled, ...rest }) {
    const look = BTN_TONE[tone || (variant === "primary" ? "primary" : "")] || "border-base-content/25 bg-base-100/40 text-base-content hover:bg-base-content/10";
    return (
        <button
            type="button"
            disabled={disabled || loading}
            className={`inline-flex h-10 max-sm:h-9 max-sm:gap-1.5 max-sm:px-3 max-sm:text-[13px] shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg border px-5 text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING} ${look} ${className}`}
            {...rest}>
            {loading ? loadingText || children : children}
        </button>
    );
}

const NOTE_TONES = {
    info: { box: "border-info/40 bg-info/10", icon: "text-info", Icon: Info },
    success: { box: "border-success/40 bg-success/10", icon: "text-success", Icon: Info },
    warning: { box: "border-warning/45 bg-warning/10", icon: "text-warning", Icon: TriangleAlert },
    error: { box: "border-error/45 bg-error/10", icon: "text-error", Icon: TriangleAlert },
};
function ModalNote({ tone = "info", children }) {
    const t = NOTE_TONES[tone] || NOTE_TONES.info;
    return (
        <div role="note" className={`flex items-start gap-3 rounded-xl border px-3.5 py-2.5 max-sm:gap-2 max-sm:px-3 max-sm:py-1.5 ${t.box} ${tone === "info" ? "[@media(max-height:700px)]:hidden" : ""}`}>
            <t.Icon size={18} strokeWidth={1.9} className={`mt-px shrink-0 max-sm:h-4 max-sm:w-4 ${t.icon}`} aria-hidden="true" />
            <p className="min-w-0 break-words text-[13px] leading-snug text-base-content max-sm:text-xs">{children}</p>
        </div>
    );
}

export function timeAgo(iso) {
    const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return "Just now";
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d === 1) return "Yesterday";
    if (d < 7) return `${d}d ago`;
    return new Date(iso).toLocaleDateString();
}

// ─── Presentation model ───────────────────────────────────────────────────────
// One place decides how each notification type looks, so every surface (row, modal) stays consistent.

export const TONES = {
    brand: { fg: "oklch(72% 0.17 20)", bg: "oklch(58% 0.22 20 / 0.15)" },
    info: { fg: "oklch(76% 0.12 250)", bg: "oklch(76% 0.12 250 / 0.14)" },
    success: { fg: "oklch(78% 0.15 150)", bg: "oklch(78% 0.15 150 / 0.14)" },
    warning: { fg: "oklch(82% 0.15 80)", bg: "oklch(82% 0.15 80 / 0.14)" },
    danger: { fg: "oklch(72% 0.17 20)", bg: "oklch(58% 0.22 20 / 0.16)" },
    admin: { fg: "oklch(76% 0.13 300)", bg: "oklch(76% 0.13 300 / 0.14)" },
};

const TYPE_META = {
    new_media: { icon: Film, tone: "brand" },
    release_reminder: { icon: BellRing, tone: "brand" },
    upload: { icon: Upload, tone: "success" },
    storage: { icon: HardDrive, tone: "warning" },
    security: { icon: ShieldAlert, tone: "danger" },
    account: { icon: UserCheck, tone: "success" },
    signup_pending: { icon: UserPlus, tone: "admin" },
    admin_signin: { icon: Monitor, tone: "admin" },
    announcement: { icon: Megaphone, tone: "brand" },
    announcement_admin: { icon: Megaphone, tone: "admin" },
    system: { icon: Info, tone: "info" },
};
export const metaFor = (type) => TYPE_META[type] || TYPE_META.system;

// One-line "what happened / why it matters", shown in the modal under the title.
// Keyed by the server's detail `context.kind` (not the type), because one type can cover several events.
const EXPLAIN = {
    signin: "A new device signed in to your account. If that was you, there's nothing to do. If not, log that device out and change your password.",
    signup: "Someone registered and is waiting for an administrator to approve their account.",
    adminsignin: "A user signed in on a device their account hadn't used before.",
    storage: "A disk that holds your libraries is running low on space. Uploads may fail if it fills up.",
    upload: "The file finished uploading and was added to the library.",
};

export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");
const fmtBytes = (b) => (b == null ? null : b >= 1024 ** 4 ? `${(b / 1024 ** 4).toFixed(1)} TB` : `${(b / 1024 ** 3).toFixed(1)} GB`);
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "—");

// <resolver>
// Turns notified media ids into displayable items.
//  • AUTHORISATION: an id must exist in the library list the app already loaded through useMedia() — that list is the
//    app's own permission-filtered view (restricted content is filtered out). Not in it → NOT FOUND, never guessed.
//  • DISPLAY DATA: the server's parsed filename + metadata.json values (title, year, kind, season, episode, poster)
//    when it sent them; otherwise the list item's own fields, with a conservative clean-up of raw release names.
const LIST_KEYS = ["movies", "series", "anime"];
const safeImg = (u) => (typeof u === "string" && /^(https?:\/\/|\/)/.test(u) ? u : null);

// "The.Avengers.2012.BluRay.720p.HIN-Multi.x264-Group.mkv" → { title: "The Avengers", year: 2012 }
const RAW_CUT = /(?:^|[\s._-])(?:(?:19|20)\d{2}|\d{3,4}p|s\d{1,2}e\d{1,3}|bluray|blu-ray|brrip|bdrip|web-?dl|webrip|hdrip|hdtv|dvdrip|x26[45]|h\.?26[45]|hevc|aac|ddp?\d?)(?=$|[\s._-])/i;
function prettyTitle(raw) {
    if (typeof raw !== "string") return { title: null, year: null };
    const base = raw.replace(/\.(mkv|mp4|avi|mov|m4v|webm)$/i, "");
    const looksRaw = /[._]/.test(base) && !/\s/.test(base);
    if (!looksRaw) return { title: raw, year: null };
    const spaced = base.replace(/[._]+/g, " ").trim();
    const m = RAW_CUT.exec(" " + spaced);
    const head = (m ? spaced.slice(0, Math.max(0, m.index - 1)) : spaced).trim();
    const y = /(?:^|\s)((?:19|20)\d{2})(?=\s|$)/.exec(spaced);
    return { title: head || spaced, year: y ? Number(y[1]) : null };
}

const sCode = (s, e) => (s != null && e != null ? `S${String(s).padStart(2, "0")}E${String(e).padStart(2, "0")}` : null);

function findInTop(top, id) {
    const stack = [{ node: top, depth: 0 }];
    let visited = 0;
    while (stack.length && visited++ < 5000) {
        const { node, depth } = stack.pop();
        if (!node || typeof node !== "object") continue;
        if (!Array.isArray(node) && node.id === id) return node;
        if (depth >= 6) continue;
        for (const v of Array.isArray(node) ? node : Object.values(node)) {
            if (v && typeof v === "object") stack.push({ node: v, depth: depth + 1 });
        }
    }
    return null;
}

function resolveMedia(data, ids, canSeeRestricted, serverItems = []) {
    const srv = new Map((serverItems || []).map((s) => [s.id, s]));
    return ids.map((id) => {
        for (const key of LIST_KEYS) {
            for (const top of data?.[key]?.items ?? []) {
                const node = findInTop(top, id);
                if (!node) continue;
                if (!canSeeRestricted && (node.permission === false || top.permission === false)) return { id, found: false };

                const s = srv.get(id);
                const isEpisode = node !== top;
                const kind = s?.kind ?? node.mediaType ?? top.mediaType ?? (key === "movies" ? "movie" : key);
                let title, year, season, episode, episodeName;

                if (s) {
                    ({ title, year, season, episode } = s);
                } else {
                    const own = node.title ?? node.name ?? null;
                    const show = top.title ?? top.name ?? null;
                    const pretty = prettyTitle(isEpisode ? (show ?? own) : own);
                    title = pretty.title;
                    year = pretty.year;
                    season = node.seasonNumber ?? null;
                    episode = node.episodeNumber ?? null;
                    episodeName = isEpisode ? (node.seriesTitle ?? null) : null;
                }
                if (!title) return { id, found: false };

                const isShow = kind !== "movie" && (season != null || episode != null || isEpisode);
                const code = sCode(season, episode);
                return {
                    id,
                    found: true,
                    title: isShow || !year ? title : `${title} (${year})`,
                    bare: title,
                    subtitle: isShow ? [code, episodeName].filter(Boolean).join(" · ") || null : null,
                    isShow,
                    code,
                    kind,
                    poster: safeImg(s?.poster) ?? safeImg(node.poster) ?? safeImg(top.poster),
                    detailsId: top.id ?? null,
                };
            }
        }
        return { id, found: false };
    });
}
// </resolver>

export function useResolvedMedia(ids, { refetchIfMissing = false, serverItems = null } = {}) {
    const { user, permissions } = useAuth();
    const q = useMedia();
    const [tried, setTried] = useState(false);
    const canSeeRestricted = !!user && (user.role === "admin" || permissions?.allowAdult === true);
    const key = ids?.join("|") || "";

    const items = useMemo(() => (ids?.length && q.data ? resolveMedia(q.data, ids, canSeeRestricted, serverItems || []) : null), [key, q.data, canSeeRestricted, serverItems]); // eslint-disable-line react-hooks/exhaustive-deps
    const missing = !!items?.some((i) => !i.found);

    // The cached library list can be a few minutes old, so a brand-new title may not be in it yet:
    // refetch ONCE before concluding that something is unavailable.
    useEffect(() => {
        if (!refetchIfMissing || !missing || tried || q.isFetching) return;
        setTried(true); // state (not a ref) so the component re-renders and leaves the loading state
        q.refetch();
    }, [refetchIfMissing, missing, tried, q]);

    const settling = refetchIfMissing && missing && (!tried || q.isFetching);
    return { items, loading: q.isLoading || settling };
}

export function Visual({ poster, type, size = 40, rounded = "full" }) {
    const [failed, setFailed] = useState(false);
    const { icon: Icon, tone } = metaFor(type);
    const t = TONES[tone];

    if (poster && !failed) {
        return (
            <img
                src={poster}
                alt=""
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                onError={() => setFailed(true)}
                className="shrink-0 rounded-md object-cover bg-white/5"
                style={{ width: size * 0.72, height: size }}
            />
        );
    }
    if (rounded === "lg") {
        // portrait tile used in the several-titles list
        return (
            <span
                className="flex shrink-0 items-center justify-center rounded-lg border border-base-content/10 bg-base-content/[0.06] text-base-content/70"
                style={{ width: size * 0.72, height: size }}
                aria-hidden="true">
                <Icon size={Math.round(size * 0.4)} strokeWidth={1.7} />
            </span>
        );
    }
    return (
        <span
            className={`flex shrink-0 items-center justify-center ${rounded === "full" ? "rounded-full" : "rounded-lg"}`}
            style={{ width: size, height: size, background: t.bg, color: t.fg }}
            aria-hidden="true">
            <Icon size={Math.round(size * 0.45)} strokeWidth={1.9} />
        </span>
    );
}

// ─── Details modal ────────────────────────────────────────────────────────────
// Built on this file's own dialog system (ModalShell / PanelBody / ModalFooter above), NOT ConfirmModal:
// fixed h-[75dvh] w-[60dvw] centred; focus trap, Escape, backdrop click and scroll lock come from ModalShell. Colours are daisyUI theme tokens, so every FLUX theme works.
// Everything shown comes from GET /api/notifications/:id — the server decides what this viewer may see (role,
// library access, whether the files still exist) and which destination is valid; titles and posters are then
// resolved from the library list the app already holds (permission-filtered).
//
// Layout (same for every type):  plain header (tile · badge · title · summary)
//                                → rounded cards (details / progress / steps) → footer actions.
// Long text always wraps (nothing is truncated or clipped); the body scrolls inside the dialog if it is taller.

// Status → badge tone of the shared modal primitives.
const statusTone = (s) => (s === "approved" ? "success" : s === "pending" ? "warning" : s === "rejected" || s === "blocked" ? "error" : "info");
// This file's row tones → daisyUI tones. (Static class strings so Tailwind keeps them.)
const DAISY = { brand: "primary", info: "info", success: "success", warning: "warning", danger: "error", admin: "admin" };
const TONE_UI = {
    primary: { on: "text-primary-content", text: "text-primary", soft: "bg-primary/10", soft2: "bg-primary/15", ring: "border-primary/70", fill: "bg-primary", color: "var(--color-primary)" },
    info: { on: "text-info-content", text: "text-info", soft: "bg-info/10", soft2: "bg-info/15", ring: "border-info/70", fill: "bg-info", color: "var(--color-info)" },
    success: { on: "text-success-content", text: "text-success", soft: "bg-success/10", soft2: "bg-success/15", ring: "border-success/70", fill: "bg-success", color: "var(--color-success)" },
    warning: { on: "text-warning-content", text: "text-warning", soft: "bg-warning/10", soft2: "bg-warning/15", ring: "border-warning/70", fill: "bg-warning", color: "var(--color-warning)" },
    error: { on: "text-error-content", text: "text-error", soft: "bg-error/10", soft2: "bg-error/15", ring: "border-error/70", fill: "bg-error", color: "var(--color-error)" },
    // Admin tone = the theme's secondary colour (swap the token here if a theme needs another one).
    admin: { on: "text-secondary-content", text: "text-secondary", soft: "bg-secondary/10", soft2: "bg-secondary/15", ring: "border-secondary/70", fill: "bg-secondary", color: "var(--color-secondary)" },
};
const shortDay = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
// "Oct 29, 10:41 AM" (no year) for card values; the footer keeps the full date.
const fmtShort = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

// ── small building blocks ──
function Card({ icon: Icon, title, hint, tone = "primary", grow = false, children }) {
    const t = TONE_UI[tone];
    return (
        <section className={`min-w-0 rounded-xl border border-base-content/10 bg-base-100 ${grow ? "flex min-h-0 flex-1 flex-col" : ""}`}>
            <header className="flex shrink-0 items-center gap-2.5 px-3.5 pt-3 [@media(max-height:820px)]:pt-2.5 max-sm:gap-2 max-sm:px-3 max-sm:pt-2">
                {Icon && (
                    <span className={`flex h-7 w-7 max-sm:h-6 max-sm:w-6 shrink-0 items-center justify-center rounded-full ${t.soft2} ${t.text}`} aria-hidden="true">
                        <Icon size={14} />
                    </span>
                )}
                <h3 className="min-w-0 flex-1 text-sm font-medium text-base-content max-sm:text-[13px]">{title}</h3>
                {hint && <span className="shrink-0 text-xs text-base-content/60 max-sm:text-[11px]">{hint}</span>}
            </header>
            <div className={`px-3.5 pb-3 pt-2.5 [@media(max-height:820px)]:pb-2.5 [@media(max-height:820px)]:pt-2 max-sm:px-3 max-sm:pb-2 max-sm:pt-1.5 ${grow ? "min-h-0 flex-1 overflow-y-auto" : ""}`}>{children}</div>
        </section>
    );
}

// label / value pairs in a responsive grid; values wrap (never truncated)
function KeyGrid({ rows, cols = "@xl:grid-cols-2" }) {
    const shown = rows.filter((r) => r && r[1] !== null && r[1] !== undefined && r[1] !== "");
    if (!shown.length) return null;
    return (
        <dl className={`grid grid-cols-2 gap-x-5 gap-y-2.5 [@media(max-height:820px)]:gap-y-2 max-sm:gap-x-3 max-sm:gap-y-1.5 ${cols}`}>
            {shown.map(([k, v]) => (
                <div key={k} className="min-w-0">
                    <dt className="text-xs text-base-content/60 max-sm:text-[11px] max-sm:leading-tight">{k}</dt>
                    <dd className="mt-0.5 break-words text-[13px] font-medium text-base-content max-sm:text-xs max-sm:leading-snug">{v}</dd>
                </div>
            ))}
        </dl>
    );
}
function InfoCard({ rows, cols, ...card }) {
    if (!rows.some((r) => r && r[1] !== null && r[1] !== undefined && r[1] !== "")) return null;
    return (
        <Card {...card}>
            <KeyGrid rows={rows} cols={cols} />
        </Card>
    );
}

// numbered guidance. layout "row": 3 columns split by thin dividers (stacks on small screens);
// layout "list": one step per line with a divider between lines.
function Steps({ title, hint, items, tone = "primary", layout = "row" }) {
    const t = TONE_UI[tone];
    const row = layout === "row";
    return (
        <Card icon={ListChecks} title={title} hint={hint} tone={tone}>
            <ol className={`flex flex-col divide-y divide-base-content/10 ${row ? "@xl:flex-row @xl:divide-x @xl:divide-y-0" : ""}`}>
                {items.map((st, i) => (
                    <li key={i} className={`flex min-w-0 items-start gap-2.5 py-2 first:pt-0 last:pb-0 max-sm:gap-2 max-sm:py-1 ${row ? "@xl:flex-1 @xl:px-3.5 @xl:py-0 @xl:first:pl-0 @xl:last:pr-0" : ""}`}>
                        <span className={`flex h-7 w-7 max-sm:h-6 max-sm:w-6 shrink-0 items-center justify-center rounded-full text-[13px] max-sm:text-xs font-medium ${t.soft2} ${t.text}`}>{i + 1}</span>
                        <span className="min-w-0 break-words text-[13px] leading-snug text-base-content/80 self-center max-sm:text-xs">{st}</span>
                    </li>
                ))}
            </ol>
        </Card>
    );
}

// 3-step horizontal progress; state: done | current | todo
function Timeline({ steps, tone = "primary" }) {
    const t = TONE_UI[tone];
    return (
        <ol className="grid grid-cols-3 gap-1">
            {steps.map((s, i) => {
                const reached = s.state !== "todo";
                return (
                    <li key={s.label} className="min-w-0 text-center">
                        <div className="relative flex h-10 max-sm:h-8 items-center justify-center">
                            {i > 0 && <span className={`absolute left-0 right-1/2 top-1/2 h-0.5 -translate-y-1/2 ${reached ? t.fill : "bg-base-content/15"}`} aria-hidden="true" />}
                            {i < steps.length - 1 && (
                                <span className={`absolute left-1/2 right-0 top-1/2 h-0.5 -translate-y-1/2 ${steps[i + 1].state !== "todo" ? t.fill : "bg-base-content/15"}`} aria-hidden="true" />
                            )}
                            <span
                                className={`relative z-10 flex h-9 w-9 max-sm:h-7 max-sm:w-7 items-center justify-center rounded-full border ring-[5px] max-sm:ring-[3px] ring-base-100 ${s.state === "current" ? `${t.fill} border-transparent ${t.on}` : reached ? `${t.ring} bg-base-100 ${t.text}` : "border-base-content/20 bg-base-100 text-base-content/40"}`}
                                aria-hidden="true">
                                <s.icon size={16} />
                            </span>
                        </div>
                        <p className="mt-1.5 max-sm:mt-1 break-words text-[13px] max-sm:text-xs font-medium leading-tight text-base-content">{s.label}</p>
                        {s.sub && <p className="mt-0.5 break-words text-xs max-sm:text-[11px] leading-snug text-base-content/60">{s.sub}</p>}
                    </li>
                );
            })}
        </ol>
    );
}

// 20 segments, the last ones turn red from `critical` %
function SegmentBar({ pct, critical = 95 }) {
    const filled = Math.round((pct / 100) * 20);
    return (
        <div className="flex gap-1" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Disk used">
            {Array.from({ length: 20 }, (_, i) => (
                <span key={i} className={`h-3.5 min-w-0 flex-1 rounded-sm ${i < filled ? (((i + 1) / 20) * 100 > critical ? "bg-error" : "bg-warning") : "bg-base-content/15"}`} />
            ))}
        </div>
    );
}

const Unavailable = ({ text }) => <ModalNote tone="warning">{text}</ModalNote>;

// ── media ──
function MediaContext({ ctx, media, onAction, when }) {
    const { items, loading } = media;
    const removed = (id) => Array.isArray(ctx.available) && !ctx.available.includes(id);

    if (ctx.restricted) return <Unavailable text="This content is no longer available to your account." />;
    if (ctx.libraryMissing) return <Unavailable text="This library is no longer part of FLUX." />;
    if (!ctx.ids?.length) return <Unavailable text="The details of this older notification weren't saved, so the title can't be shown." />;
    if (loading || !items) return <div className="h-40 animate-pulse rounded-xl bg-base-content/10" aria-busy="true" aria-label="Loading titles" />;

    const rows = items.map((m) => ({ ...m, gone: removed(m.id) }));
    const playable = rows.filter((r) => r.found && !r.gone);
    const hidden = rows.length - playable.length;

    if (playable.length === 0) {
        return (
            <Unavailable
                text={rows.some((r) => r.gone) && !rows.some((r) => !r.found && !r.gone) ? "These files were removed from the library." : "This content is no longer available to your account."}
            />
        );
    }

    if (playable.length === 1) {
        const m = playable[0];
        const year = /\((\d{4})\)$/.exec(m.title)?.[1] || null;
        return (
            <>
                <InfoCard
                    icon={Film}
                    title="About this title"
                    cols="@xl:grid-cols-4"
                    rows={[["Title", m.bare], ["Type", cap(m.kind)], m.isShow ? ["Episode", m.subtitle || m.code] : ["Year", year], ["Library", ctx.library], ["Added", fmtShort(when)], ["Status", "Ready to watch"]]}
                />
                <Steps
                    title="What you can do"
                    items={[
                        "Choose Watch now to start playing.",
                        "Open View details for cast, genres and file info.",
                        ctx.library ? `Find it later in the ${ctx.library} library.` : "Find it later in your library.",
                    ]}
                />
                <ModalNote tone="info">Opening Watch now starts playback from where you left off.</ModalNote>
                {hidden > 0 && <p className="text-center text-xs text-base-content/60">{hidden === 1 ? "1 other title is" : `${hidden} other titles are`} no longer available to your account.</p>}
            </>
        );
    }

    return (
        <>
            <Card icon={Film} title={`${playable.length} new titles`}>
                <ul className="grid gap-2 @xl:grid-cols-2">
                    {playable.map((m) => {
                        const yr = /\((\d{4})\)$/.exec(m.title)?.[1] || null;
                        return (
                            <li key={m.id} className="flex items-center gap-3 rounded-lg bg-base-content/[0.04] p-2">
                                <Visual poster={m.poster} type="new_media" size={52} rounded="lg" />
                                <div className="min-w-0 flex-1">
                                    <p className="break-words text-[13px] font-medium leading-snug text-base-content">{m.bare}</p>
                                    <p className="mt-0.5 break-words text-xs text-base-content/60">{[cap(m.kind), m.isShow ? m.subtitle || m.code : yr, ctx.library].filter(Boolean).join(" · ")}</p>
                                </div>
                                <ModalButton variant="primary" className="!h-8 !px-3" onClick={() => onAction(`/player/${encodeURIComponent(m.id)}`)} aria-label={`Watch ${m.title}`}>
                                    <Play size={12} strokeWidth={2.4} /> Watch
                                </ModalButton>
                            </li>
                        );
                    })}
                </ul>
            </Card>
            <InfoCard
                icon={Folder}
                title="Summary"
                cols="@xl:grid-cols-4"
                rows={[
                    ["Library", ctx.library],
                    ["New titles", String(playable.length)],
                    ["Types", [...new Set(playable.map((m) => cap(m.kind)))].join(", ")],
                    ["Added", fmtShort(when)],
                ]}
            />
            {hidden > 0 && <p className="text-center text-xs text-base-content/60">{hidden === 1 ? "1 other title is" : `${hidden} other titles are`} no longer available to your account.</p>}
        </>
    );
}

const deviceRows = (ctx) => [
    ["Device", ctx.deviceName],
    ["Browser", ctx.browser],
    ["System", ctx.os],
    ["Type", ctx.deviceType ? cap(ctx.deviceType) : null],
];

function accountSteps(ctx) {
    if (ctx.event === "awaiting_approval" || ctx.status === "pending") {
        return {
            title: "What happens next",
            tone: "warning",
            items: ["An administrator reviews your registration.", "You will get a notification here when it is approved.", "Once approved you can browse and watch."],
        };
    }
    if (ctx.status === "rejected")
        return {
            title: "What this means",
            tone: "error",
            items: ["Your registration was not approved, so you cannot browse or watch yet.", "If you think this is a mistake, contact the person who runs this server."],
        };
    if (ctx.status === "blocked")
        return {
            title: "What this means",
            tone: "error",
            items: ["You cannot sign in or watch until an administrator restores your access.", "If you think this is a mistake, contact the person who runs this server."],
        };
    if (ctx.statusChanged && ctx.status === "approved")
        return {
            title: "What you can do now",
            tone: "success",
            items: ["Browse the libraries you were given access to.", "Pick up anything you started where you left off.", "Ask an administrator if a library is missing."],
        };
    return {
        title: "What this means",
        tone: "info",
        items:
            ctx.accessType === "permanent"
                ? ["Your access no longer has an end date."]
                : ["You can keep watching until the end date.", "After it, an access-expired page is shown until an administrator extends your access."],
    };
}

function Context({ ctx, n, media, onAction }) {
    if (!ctx) return null;

    switch (ctx.kind) {
        case "signup": {
            if (ctx.userDeleted) return <Unavailable text="This user account no longer exists." />;
            const u = ctx.user;
            const decided = u.status !== "pending";
            return (
                <>
                    <div className="grid gap-2.5 @xl:grid-cols-2">
                        <InfoCard
                            icon={User}
                            title="Contact"
                            tone="admin"
                            rows={[
                                ["Name", u.name],
                                ["Username", u.username ? `@${u.username}` : null],
                                ["Email", u.email],
                            ]}
                        />
                        <InfoCard
                            icon={CalendarDays}
                            title="Registration"
                            tone="admin"
                            rows={[
                                ["Registered", fmtShort(u.registeredAt)],
                                ["Requested", timeAgo(u.registeredAt)],
                                [
                                    "Email verified",
                                    <ModalBadge key="v" tone={u.emailVerified ? "success" : "warning"}>
                                        {u.emailVerified ? "Yes" : "No"}
                                    </ModalBadge>,
                                ],
                                [
                                    "Approval",
                                    <ModalBadge key="s" tone={statusTone(u.status)}>
                                        {cap(u.status)}
                                    </ModalBadge>,
                                ],
                            ]}
                        />
                    </div>
                    <Card icon={ShieldCheck} title="Request progress" hint={decided ? "Decided" : "Step 3 of 3"} tone="admin">
                        <Timeline
                            tone="admin"
                            steps={[
                                {
                                    icon: Check,
                                    label: "Registered",
                                    sub: shortDay(u.registeredAt) + ", " + new Date(u.registeredAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
                                    state: "done",
                                },
                                { icon: Mail, label: "Email verified", sub: u.emailVerified ? "Confirmed" : "Not yet", state: u.emailVerified ? "done" : "todo" },
                                {
                                    icon: ShieldCheck,
                                    label: decided ? cap(u.status) : "Waiting for approval",
                                    sub: decided ? "Decision made" : "Needs an administrator",
                                    state: decided ? "done" : "current",
                                },
                            ]}
                        />
                    </Card>
                </>
            );
        }

        case "signin":
            return (
                <>
                    <div className="grid gap-2.5 @xl:grid-cols-2">
                        <InfoCard icon={Monitor} title="Device" tone="error" rows={deviceRows(ctx)} />
                        <InfoCard
                            icon={ShieldCheck}
                            title="Session"
                            tone="error"
                            rows={[
                                [
                                    "Status",
                                    ctx.sessionActive === null ? null : (
                                        <ModalBadge key="s" tone={ctx.sessionActive ? "success" : "neutral"}>
                                            {ctx.sessionActive ? "Still signed in" : "Signed out"}
                                        </ModalBadge>
                                    ),
                                ],
                                ["This device", ctx.isThisDevice ? "Yes — this is the session you are using now." : "No — it is a different device."],
                                ["Signed in", fmtShort(n.createdAt)],
                                ["Last active", ctx.lastSeenAt ? fmtShort(ctx.lastSeenAt) : null],
                            ]}
                        />
                    </div>
                    <Steps title="If this was not you" hint="Takes about a minute" tone="error" items={["Find this sign-in in Review devices.", "Log that device out.", "Change your password."]} />
                </>
            );

        case "adminsignin":
            if (ctx.userDeleted) return <Unavailable text="This user account no longer exists." />;
            return (
                <>
                    <div className="grid gap-2.5 @xl:grid-cols-2">
                        <InfoCard
                            icon={User}
                            title="User"
                            tone="admin"
                            rows={[
                                ["Name", ctx.user.name],
                                ["Username", ctx.user.username ? `@${ctx.user.username}` : null],
                                ["Email", ctx.user.email],
                                ["Devices", ctx.deviceCount != null ? String(ctx.deviceCount) : null],
                            ]}
                        />
                        <InfoCard icon={Monitor} title="This sign-in" tone="admin" rows={[...deviceRows(ctx), ["Signed in", fmtShort(n.createdAt)], ["Event", ctx.multi ? "Additional device" : "New device"]]} />
                    </div>
                    <Steps
                        title="What to check"
                        hint="Admins can view, not sign out"
                        tone="admin"
                        items={["Is this a device you expect them to use?", "If not, open the user and review devices.", "Contact them. Only they can sign out devices."]}
                    />
                </>
            );

        case "account": {
            if (!ctx.event) return null; // older rows: the message says it all
            const end = ctx.accessType === "temporary" && ctx.accessExpiresAt ? new Date(ctx.accessExpiresAt) : null;
            const access =
                ctx.accessType === "permanent" ? "Permanent" : ctx.accessType === "temporary" ? (end ? `Until ${fmtDate(ctx.accessExpiresAt).split(",").slice(0, 2).join(",")}` : "Limited") : null;
            const tone = ctx.status === "approved" ? "success" : statusTone(ctx.status) === "error" ? "error" : "warning";
            const start = new Date(n.createdAt);
            const pct = end ? Math.max(0, Math.min(100, ((Date.now() - start.getTime()) / Math.max(1, end.getTime() - start.getTime())) * 100)) : 100;
            const left = end ? Math.ceil((end.getTime() - Date.now()) / 86400000) : null;
            const steps = accountSteps(ctx);
            return (
                <>
                    <div className="grid gap-2.5 @xl:grid-cols-2">
                        <InfoCard
                            icon={ShieldCheck}
                            title="Your account"
                            tone={tone}
                            rows={[
                                [
                                    "Account status",
                                    ctx.status ? (
                                        <ModalBadge key="s" tone={statusTone(ctx.status)}>
                                            {cap(ctx.status)}
                                        </ModalBadge>
                                    ) : null,
                                ],
                                ["Access", access],
                                ["Access type", ctx.accessType ? cap(ctx.accessType) : null],
                                ["Updated", fmtShort(n.createdAt)],
                            ]}
                        />
                        <Card icon={CalendarDays} title="Access window" hint={end ? (left > 0 ? `${left} day${left === 1 ? "" : "s"} left` : "Ended") : "No end date"} tone={tone}>
                            <div className="h-2 overflow-hidden rounded-full bg-base-content/15">
                                <div className={`h-full rounded-full ${TONE_UI[tone].fill}`} style={{ width: `${pct}%` }} />
                            </div>
                            <div className="mt-2 flex justify-between gap-3 text-xs text-base-content/60">
                                <span>
                                    {ctx.statusChanged && ctx.status === "approved" ? "Approved" : "Updated"} {shortDay(start)}
                                </span>
                                <span>{end ? `Ends ${shortDay(end)}` : "Permanent"}</span>
                            </div>
                        </Card>
                    </div>
                    <Steps title={steps.title} tone={steps.tone} items={steps.items} />
                </>
            );
        }

        case "reminder": {
            const released = ctx.releaseDate ? new Date(`${ctx.releaseDate}T00:00:00`).toLocaleDateString(undefined, { dateStyle: "medium" }) : null;
            return (
                <>
                    <InfoCard
                        icon={Film}
                        title="About this title"
                        cols="@xl:grid-cols-4"
                        rows={[
                            ["Title", ctx.title],
                            ["Type", ctx.mediaType === "series" ? "Series" : "Movie"],
                            ["Release date", released],
                            ["Reminder set", ctx.remindedAt ? fmtShort(ctx.remindedAt) : null],
                        ]}
                    />
                    <Steps
                        title="What you can do"
                        items={["Choose View details to see the cast, trailer and more.", "Check your library: it shows there once the title has been added.", "Ask an administrator if you would like it added."]}
                    />
                    <ModalNote tone="info">You asked FLUX to remind you about this title. Being released does not mean it is in your library yet.</ModalNote>
                </>
            );
        }

        case "media":
            return <MediaContext ctx={ctx} media={media} onAction={onAction} when={n.createdAt} />;

        case "upload":
            return (
                <>
                    <InfoCard
                        icon={Upload}
                        title="Upload"
                        tone="success"
                        cols="@xl:grid-cols-4"
                        rows={[
                            [
                                "File",
                                ctx.fileName ? (
                                    <span key="f" className="break-all">
                                        {ctx.fileName}
                                    </span>
                                ) : null,
                            ],
                            ["Library", ctx.library],
                            ["Size", fmtBytes(ctx.sizeBytes)],
                            ["Finished", fmtShort(n.createdAt)],
                            ["Format", /\.([a-z0-9]{2,5})$/i.exec(ctx.fileName || "")?.[1]?.toUpperCase() || null],
                            ["Status", "Added to library"],
                        ]}
                    />
                    <Card icon={Upload} title="Where it is now" hint="Done" tone="success">
                        <Timeline
                            tone="success"
                            steps={[
                                { icon: Upload, label: "Uploaded", state: "done" },
                                { icon: Folder, label: "Added to library", state: "done" },
                                { icon: Play, label: "Ready to watch", state: "current" },
                            ]}
                        />
                    </Card>
                    <ModalNote tone="info">Open the file in Media and check its title and poster. Edit the metadata if the match looks wrong.</ModalNote>
                </>
            );

        case "storage": {
            const pct = Math.max(0, Math.min(100, Number(ctx.usedPercent) || 0));
            const free = fmtBytes(ctx.freeBytes);
            // Total is derived from "free" and the rounded "used %", so only show it when that is reliable.
            const approxTotal = ctx.freeBytes != null && ctx.usedPercent != null && pct > 0 && pct < 97 ? ctx.freeBytes / (1 - pct / 100) : null;
            const total = approxTotal ? fmtBytes(approxTotal) : null;
            const used = approxTotal ? fmtBytes(approxTotal - ctx.freeBytes) : null;
            const libs = ctx.libraries || [];
            return (
                <>
                    <div className="grid gap-2.5 @xl:grid-cols-2">
                        {ctx.usedPercent != null ? (
                            <Card icon={HardDrive} title={ctx.disk ? `Disk ${ctx.disk}` : "Disk"} hint={total ? `about ${total} total` : null} tone="warning">
                                <div className="flex items-end justify-between gap-4">
                                    <div className="min-w-0">
                                        <p className="text-4xl max-sm:text-3xl font-semibold leading-none tabular-nums text-base-content">{pct}%</p>
                                        <p className="mt-1.5 text-xs text-base-content/60">used{used ? ` · about ${used}` : ""}</p>
                                    </div>
                                    {free && (
                                        <div className="shrink-0 text-right">
                                            <p className="whitespace-nowrap text-xl max-sm:text-lg font-semibold tabular-nums text-base-content">{free}</p>
                                            <p className="mt-0.5 text-xs text-base-content/60">free</p>
                                        </div>
                                    )}
                                </div>
                                <div className="mt-4">
                                    <SegmentBar pct={pct} />
                                </div>
                                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-base-content/60">
                                    <span className="inline-flex items-center gap-1.5">
                                        <span className="h-2.5 w-2.5 rounded-sm bg-warning" />
                                        Used
                                    </span>
                                    <span className="inline-flex items-center gap-1.5">
                                        <span className="h-2.5 w-2.5 rounded-sm bg-error" />
                                        Critical from 95%
                                    </span>
                                    <span className="inline-flex items-center gap-1.5">
                                        <span className="h-2.5 w-2.5 rounded-sm bg-base-content/15" />
                                        Free
                                    </span>
                                    <span className="ml-auto">Alerted {fmtShort(n.createdAt)}</span>
                                </div>
                            </Card>
                        ) : (
                            <InfoCard icon={HardDrive} title="Disk" tone="warning" rows={[["Free space", free]]} />
                        )}
                        {libs.length > 0 && (
                            <Card icon={Folder} title="Libraries on this disk" hint={String(libs.length)} tone="warning">
                                <ul className="flex flex-col divide-y divide-base-content/10">
                                    {libs.map((name) => (
                                        <li key={name} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-base-content/10 text-base-content/70" aria-hidden="true">
                                                <Folder size={15} />
                                            </span>
                                            <span className="min-w-0 flex-1 break-words text-[13px] font-medium text-base-content">{name}</span>
                                            <span className="shrink-0 text-xs text-base-content/60">shares this disk</span>
                                        </li>
                                    ))}
                                </ul>
                            </Card>
                        )}
                    </div>
                    <Steps
                        title="What you can do"
                        hint="Uploads may fail if it fills up"
                        tone="warning"
                        items={["Remove files you no longer need from the biggest library.", "Move a library to a disk with more space.", "Check that new uploads still go through afterwards."]}
                    />
                </>
            );
        }

        case "announcement":
            return (
                <>
                    {n.body ? (
                        <Card icon={Megaphone} title="Message" tone="primary" grow>
                            <p className="min-h-24 max-sm:min-h-16 whitespace-pre-wrap break-words text-sm max-sm:text-[13px] leading-relaxed text-base-content">{n.body}</p>
                        </Card>
                    ) : (
                        <ModalNote tone="info">No additional details were included with this announcement.</ModalNote>
                    )}
                    <div className="grid gap-2.5 @xl:grid-cols-2">
                        <InfoCard
                            icon={User}
                            title="Audience"
                            tone="primary"
                            rows={[
                                ["Sent to", ctx.adminOnly ? "Administrators" : "Everyone"],
                                ["Type", ctx.adminOnly ? "Admin announcement" : "Announcement"],
                                ["Priority", cap(ctx.priority) === "—" ? "Normal" : cap(ctx.priority)],
                            ]}
                        />
                        <InfoCard
                            icon={Bell}
                            title="Delivery"
                            tone="primary"
                            rows={[
                                [
                                    "In the app",
                                    <ModalBadge key="d" tone="success">
                                        Delivered
                                    </ModalBadge>,
                                ],
                                ["Push alert", "If enabled on your device"],
                                ["Sent", fmtShort(n.createdAt)],
                                ["Read", n.read ? "Yes" : "No"],
                            ]}
                        />
                    </div>
                    {ctx.adminOnly && (
                        <div className="flex justify-center">
                        <ModalBadge tone="error" icon={ShieldCheck}>
                            Sent to administrators only
                        </ModalBadge>
                        </div>
                    )}
                </>
            );

        default:
            return null;
    }
}

const firstSentence = (t) => {
    const m = /^[\s\S]*?[.!?](?=\s|$)/.exec(String(t || "").trim());
    return m ? m[0] : t;
};

// Where each notification's button leads. Only EXISTING pages. Admin-only kinds are only ever built by the
// server for admins; the new user's own sign-in notice goes to their profile page (Settings → Profile).
const DEST_BY_KIND = {
    signin: { path: "/settings?tab=profile", label: "Review devices" },
    signup: { path: "/dashboard/users", label: "Review request" },
    adminsignin: { path: "/dashboard/users", label: "Open users" },
    upload: { path: "/dashboard/media", label: "Open media" },
    storage: { path: "/dashboard/storage", label: "Open storage" },
};
const LIBRARY_PATH = { movies: "/movies", series: "/series" };

// Header tile: poster / placeholder (single title) · initial (a person) · type icon
function HeroVisual({ poster, single, person, avatar, Icon, tone }) {
    const [failed, setFailed] = useState(false);
    const [avatarFailed, setAvatarFailed] = useState(false);
    const t = TONE_UI[tone];
    if (poster && !failed) {
        return (
            <img
                src={poster}
                alt=""
                referrerPolicy="no-referrer"
                onError={() => setFailed(true)}
                className="aspect-[2/3] h-24 max-sm:h-[4.5rem] shrink-0 rounded-lg border border-base-content/15 object-cover shadow-md sm:h-28 [@media(max-height:820px)]:h-20 sm:[@media(max-height:820px)]:h-20"
            />
        );
    }
    if (single) {
        return (
            <span className={`flex aspect-[2/3] h-24 max-sm:h-[4.5rem] shrink-0 items-center justify-center rounded-xl border sm:h-28 [@media(max-height:820px)]:h-20 sm:[@media(max-height:820px)]:h-20 ${t.ring} ${t.text}`}  aria-hidden="true">
                <Icon size={28} strokeWidth={1.6} />
            </span>
        );
    }
    if (avatar && !avatarFailed) {
        // the person's real profile picture
        return (
            <img
                src={avatar}
                alt=""
                referrerPolicy="no-referrer"
                onError={() => setAvatarFailed(true)}
                className={`h-14 w-14 shrink-0 rounded-full border object-cover sm:h-16 sm:w-16 [@media(max-height:820px)]:h-12 [@media(max-height:820px)]:w-12 sm:[@media(max-height:820px)]:h-12 sm:[@media(max-height:820px)]:w-12 ${t.ring}`}
            />
        );
    }
    if (person) {
        return (
            <span
                className={`flex h-14 w-14 max-sm:h-11 max-sm:w-11 shrink-0 items-center justify-center rounded-full border sm:h-16 sm:w-16 [@media(max-height:820px)]:h-12 [@media(max-height:820px)]:w-12 sm:[@media(max-height:820px)]:h-12 sm:[@media(max-height:820px)]:w-12 ${t.ring} ${t.text}`}
                
                aria-hidden="true">
                <User size={26} strokeWidth={1.6} />
            </span>
        );
    }
    return (
        <span className={`flex h-14 w-14 max-sm:h-11 max-sm:w-11 shrink-0 items-center justify-center rounded-2xl border sm:h-16 sm:w-16 [@media(max-height:820px)]:h-12 [@media(max-height:820px)]:w-12 sm:[@media(max-height:820px)]:h-12 sm:[@media(max-height:820px)]:w-12 ${t.ring} ${t.text}`}  aria-hidden="true">
            <Icon size={26} strokeWidth={1.6} />
        </span>
    );
}

export function NotificationModal({ id, onClose, onAction, markRead }) {
    const qc = useQueryClient();
    const { user: me } = useAuth();
    const { data: n, isLoading, isError, error, refetch, isFetching } = useNotificationDetail(id);
    // (focus trap, Escape, backdrop click, scroll lock and focus restore are handled by ModalShell)
    const markedRef = useRef(false);

    // Reading the details counts as reading the notification (once, synced with the backend).
    useEffect(() => {
        if (!n || n.read || markedRef.current) return;
        markedRef.current = true;
        markRead(n.id);
        qc.setQueryData(NOTIFICATION_KEYS.detail(id), (d) => (d ? { ...d, read: true } : d));
    }, [n, id, markRead, qc]);

    const ctx = n?.context;
    const media = useResolvedMedia(ctx?.kind === "media" && !ctx.restricted && !ctx.libraryMissing ? ctx.ids : null, { refetchIfMissing: true, serverItems: ctx?.items });
    const mediaItems = media.items;
    const playable = ctx?.kind === "media" && mediaItems ? mediaItems.filter((m) => m.found && !(Array.isArray(ctx.available) && !ctx.available.includes(m.id))) : [];
    const single = playable.length === 1 ? playable[0] : null;

    // Actions: a single resolved title gets Watch now (+ details); everything else uses the server-verified destination.
    let primary = null;
    let secondary = null;
    if (single) {
        primary = { label: "Watch now", icon: Play, path: `/player/${encodeURIComponent(single.id)}` };
        if (single.detailsId != null) secondary = { label: "View details", path: `/media/${encodeURIComponent(single.detailsId)}` };
    } else if (ctx && DEST_BY_KIND[ctx.kind] && (n.destination || ctx.kind === "storage")) {
        primary = { ...DEST_BY_KIND[ctx.kind], icon: ArrowRight };
    } else if (n?.destination && !(ctx?.kind === "media" && mediaItems && playable.length === 0)) {
        const libPath = ctx?.kind === "media" && ctx.library ? LIBRARY_PATH[String(ctx.library).toLowerCase()] : null;
        primary = libPath ? { label: `Open ${ctx.library}`, icon: ArrowRight, path: libPath } : { label: n.destination.label, icon: ArrowRight, path: n.destination.path };
    }

    const { icon: Icon, tone } = metaFor(n?.type);
    const dtone = DAISY[tone] || "primary";
    const notFound = isError && error?.status === 404;
    const summary = n
        ? n.type === "new_media"
            ? ctx?.library
                ? `Newly added to ${ctx.library}.`
                : "Newly added to your library."
            : ctx?.kind === "adminsignin" && ctx.multi
              ? "This user is now signed in on several devices."
              : ctx?.kind === "announcement"
                ? firstSentence(n.body)
                : ctx?.kind === "account" && ctx.status === "approved" && ctx.statusChanged
                  ? "Welcome in. You can now browse and watch what your permissions allow."
                  : EXPLAIN[ctx?.kind] || n.body
        : null;
    const singlePoster = single?.poster ?? (ctx?.kind === "reminder" ? ctx.poster : null);
    const heading = single ? single.title : n?.title;
    const sub = single ? [cap(single.kind), single.subtitle].filter(Boolean).join(" · ") : null; // e.g. "Series · S01E02"
    const person = (ctx?.kind === "signup" || ctx?.kind === "adminsignin" || ctx?.kind === "signin") && !ctx.userDeleted;
    // Real profile picture: the person a sign-up / admin notice is about, or your own for your account notices.
    const avatarUrl = ctx && !ctx.userDeleted ? (ctx.kind === "signup" || ctx.kind === "adminsignin" ? ctx.user?.avatar : ctx.kind === "signin" || ctx.kind === "account" ? me?.avatar : null) || null : null;

    // Which look the header takes (state first, then the notification's own tone).
    const state = isLoading ? "loading" : isError ? (notFound ? "gone" : "error") : !n ? "gone" : "ok";
    const headTone =
        state === "loading"
            ? "info"
            : state === "error"
              ? "error"
              : state === "gone"
                ? "warning"
                : ctx?.kind === "account"
                  ? ctx.status === "approved"
                      ? "success"
                      : statusTone(ctx.status) === "error"
                        ? "error"
                        : "warning"
                  : dtone;
    const StateIcon = state === "loading" ? Bell : state === "error" || state === "gone" ? TriangleAlert : BellOff;
    const HeadIcon = state === "ok" ? Icon : StateIcon;
    const badgeText = state === "loading" ? "Loading" : state === "error" ? "Error" : state === "gone" ? "Unavailable" : n.category;
    const title = state === "loading" ? "Loading…" : state === "ok" ? heading : "Notification unavailable";

    return (
        <ModalShell modal={MODALS.notificationDetails} data-notification-id={id} data-notification-kind={ctx?.kind || state} onClose={onClose} labelledBy="notif-modal-title" describedBy="notif-modal-desc">
            <ModalScroll>
                {/* Close cross: zero-height sticky rail, so the button stays at the top-right while header + body scroll under it */}
                <div className="sticky top-0 z-20 h-0">
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close dialog"
                        className="btn btn-sm btn-square absolute right-3 top-3 rounded-md border border-base-content/15 bg-base-200/80 backdrop-blur hover:bg-base-100">
                        <X size={16} />
                    </button>
                </div>
                <header className="relative shrink-0 border-b border-base-content/10">
                    <div className="flex items-center gap-3.5 px-4 py-5 sm:gap-4 sm:px-6 sm:py-6 [@media(max-height:700px)]:py-4 sm:[@media(max-height:700px)]:py-4 max-sm:gap-3 max-sm:px-3 max-sm:py-3">
                        <HeroVisual poster={state === "ok" ? singlePoster : null} single={state === "ok" && !!single} person={state === "ok" ? person : null} avatar={state === "ok" ? avatarUrl : null} Icon={HeadIcon} tone={headTone} />
                        <div className="min-w-0 flex-1 pr-11">
                            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                                <ModalBadge tone={headTone} icon={HeadIcon}>
                                    {badgeText}
                                </ModalBadge>
                                <h2 id="notif-modal-title" className="min-w-0 break-words text-lg max-sm:text-base font-semibold leading-tight text-base-content sm:text-xl">
                                    {title}
                                </h2>
                                {state === "ok" && (
                                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-base-content/70">
                                        <span className={`h-2 w-2 rounded-full ${n.read ? "bg-base-content/30" : "bg-primary"}`} aria-hidden="true" />
                                        {n.read ? "Read" : "Unread"}
                                    </span>
                                )}
                            </div>
                            {state === "ok" && sub && <p className="mt-0.5 text-sm text-base-content/70">{sub}</p>}
                            {state === "ok" && summary && (
                                <p
                                    id="notif-modal-desc"
                                    className={`mt-1 whitespace-pre-wrap break-words text-[13px] leading-snug text-base-content/70 ${ctx?.kind === "announcement" ? "sr-only" : "line-clamp-2"}`}>
                                    {summary}
                                </p>
                            )}
                        </div>
                    </div>
                </header>

                <PanelBody>
                    <div className="flex w-full flex-1 flex-col justify-center gap-2.5 [@media(max-height:820px)]:gap-2">
                        {state === "loading" && (
                            <div className="flex flex-col gap-2.5" aria-busy="true">
                                <div className="h-10 animate-pulse rounded-xl bg-base-content/10" />
                                <div className="grid gap-2.5 @xl:grid-cols-2">
                                    <div className="h-28 animate-pulse rounded-xl bg-base-content/10" />
                                    <div className="h-28 animate-pulse rounded-xl bg-base-content/10" />
                                </div>
                                <div className="h-20 animate-pulse rounded-xl bg-base-content/10" />
                            </div>
                        )}
                        {state === "error" && (
                            <>
                                <ModalNote tone="error">We couldn't load this notification. Check your connection and try again.</ModalNote>
                                <div className="flex justify-center">
                                    <ModalButton onClick={() => refetch()} loading={isFetching} loadingText="Retrying…">
                                        <RefreshCw size={14} /> Try again
                                    </ModalButton>
                                </div>
                                <Steps
                                    title="If it keeps happening"
                                    tone="error"
                                    items={["Check that you are online.", "Close this window and open the notification again.", "Reload the page if the problem stays."]}
                                    layout="list"
                                />
                            </>
                        )}
                        {state === "gone" && (
                            <>
                                <ModalNote tone="warning">This notification is no longer available.</ModalNote>
                                <Steps
                                    title="Why this can happen"
                                    tone="warning"
                                    items={["It was cleared from your notifications.", "The item it points to was removed.", "Your access to that content changed."]}
                                    layout="list"
                                />
                            </>
                        )}
                        {state === "ok" && <Context ctx={ctx} n={n} media={media} onAction={onAction} />}
                    </div>
                </PanelBody>
            </ModalScroll>

            <ModalFooter
                note={
                    n ? (
                        <span>
                            Received <time dateTime={n.createdAt}>{fmtDate(n.createdAt)}</time>
                            <span className="hidden sm:inline"> · {timeAgo(n.createdAt)}</span>
                        </span>
                    ) : null
                }>
                <ModalButton data-autofocus onClick={onClose}>
                    Close
                </ModalButton>
                {state === "ok" && secondary && (
                    <ModalButton tone="solid" onClick={() => onAction(secondary.path)}>
                        {secondary.label}
                    </ModalButton>
                )}
                {state === "ok" && primary && (
                    <ModalButton tone="solid" onClick={() => onAction(primary.path)}>
                        {primary.icon === Play && <Play size={13} strokeWidth={2.4} />}
                        {primary.label}
                        {primary.icon !== Play && <ArrowRight size={14} strokeWidth={2.2} />}
                    </ModalButton>
                )}
            </ModalFooter>
        </ModalShell>
    );
}

// ─── Trailer modal ────────────────────────────────────────────────────────────
export function TrailerModal({ trailerKey, onClose }) {
    useEffect(() => {
        const onKey = (e) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.removeEventListener("keydown", onKey);
            document.body.style.overflow = prev;
        };
    }, [onClose]);

    // Portal: it opens in place on any page/banner (a transformed parent can't trap it). React still bubbles portal events
    // to the parent (a banner), so they are stopped here.
    return createPortal(
        <span style={{ display: "contents" }} onClick={stopBubble} onMouseDown={stopBubble} onPointerDown={stopBubble} onTouchStart={stopBubble} onKeyDown={stopBubble}>
            <div
                className="fixed inset-0 flex items-end justify-center bg-black/80 backdrop-blur-sm p-0 sm:items-center sm:p-4"
                style={{ zIndex: 2147483647 }}
                onClick={onClose}
                {...modalAttrs(MODALS.mediaTrailer)}
                role="dialog"
                aria-modal="true"
                aria-label="Trailer">
                <SheetStyle />
                <div data-modal-sheet="" className="w-full max-w-3xl aspect-video rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
                    <iframe src={`https://www.youtube.com/embed/${trailerKey}?autoplay=1`} title="Trailer" className="w-full h-full" allow="autoplay; fullscreen" allowFullScreen />
                </div>
            </div>
        </span>,
        document.body,
    );
}

// ─── Not-in-library modal ─────────────────────────────────────────────────────
// Opened from the "Not in library" button on titles reached via the person page.
// Portal → body with max z-index so it sits above the sticky navbar.
export function NotInLibraryModal({ title, poster, isSeries, onClose, onOpenSettings }) {
    const kind = isSeries ? "series" : "movie";

    useEffect(() => {
        const onKey = (e) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.removeEventListener("keydown", onKey);
            document.body.style.overflow = prev;
        };
    }, [onClose]);

    return createPortal(
        <div
            className="fixed inset-0 flex items-end justify-center bg-black/80 backdrop-blur-sm p-0 sm:items-center sm:p-4"
            style={{ zIndex: 2147483647 }}
            onClick={onClose}
            {...modalAttrs(MODALS.mediaNotInLibrary)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="nil-title">
            <div data-modal-sheet="" className="w-full max-w-md max-h-[92dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-base-200 border border-white/10 pb-[env(safe-area-inset-bottom)] sm:pb-0 shadow-2xl overflow-x-hidden" onClick={(e) => e.stopPropagation()}>
                <SheetStyle />
                <div className="flex items-start gap-4 p-5 sm:p-6">
                    {poster ? (
                        <img src={poster} alt="" className="w-16 sm:w-20 aspect-2/3 rounded-lg object-cover shrink-0 ring-1 ring-white/10" />
                    ) : (
                        <div className="w-16 sm:w-20 aspect-2/3 rounded-lg bg-base-300 flex items-center justify-center shrink-0">
                            <Film size={22} className="text-base-content/30" />
                        </div>
                    )}
                    <div className="min-w-0">
                        <div className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-warning mb-1.5">
                            <Info size={12} /> Not available
                        </div>
                        <h3 id="nil-title" className="text-base sm:text-lg font-bold text-base-content leading-snug wrap-break-word">
                            {title}
                        </h3>
                        <p className="text-sm text-base-content/70 mt-2 leading-relaxed">
                            This {kind} isn&apos;t in your FLUX library yet, so there&apos;s no file to play. You&apos;re seeing it for reference only — details come from TMDB.
                        </p>
                    </div>
                </div>

                <div className="px-5 sm:px-6 pb-5 sm:pb-6">
                    <p className="text-xs font-semibold text-base-content/50 uppercase tracking-wider mb-2">How to get it here</p>
                    <ol className="text-[13px] text-base-content/70 space-y-1.5 list-decimal pl-4 marker:text-base-content/35">
                        <li>Put the {kind} file in a folder your server already scans, or add its folder under Settings → Library.</li>
                        <li>Let FLUX rescan. It matches by file name, so keep the title and year in it.</li>
                        <li>Come back — this page will switch to the Play button.</li>
                    </ol>

                    <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-5">
                        <button onClick={onOpenSettings} className="btn btn-sm sm:btn-md btn-ghost rounded-[999px] border border-white/10 cursor-pointer">
                            Library settings
                        </button>
                        <button onClick={onClose} className="btn btn-sm sm:btn-md btn-primary rounded-[999px] px-6 cursor-pointer">
                            Got it
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
}


// ─── Remind me dialog (upcoming titles) ──────────────────────────────────────
// Same look and size as the notification dialogs (h-[80dvh] w-[60dvw]), but self-contained: the Rm* pieces below are
// copies adapted for this page, nothing is imported from Notifications.jsx.
// Confirm → the server notifies this user (in FLUX, plus push if enabled) once the title is released.
const RM_FOCUSABLE = 'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])';
const RM_FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60";

function RmShell({ modal, onClose, busy, labelledBy, children }) {
    const ref = useRef(null);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const prev = document.activeElement;
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        (el.querySelector("[data-autofocus]") || el).focus();
        function onKey(e) {
            if (e.key === "Escape") {
                e.stopPropagation();
                if (!busy) onClose();
                return;
            }
            if (e.key !== "Tab") return;
            const nodes = [...el.querySelectorAll(RM_FOCUSABLE)].filter((n) => n.offsetParent !== null);
            if (!nodes.length) {
                e.preventDefault();
                return;
            }
            const first = nodes[0];
            const last = nodes[nodes.length - 1];
            if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("keydown", onKey);
            document.body.style.overflow = prevOverflow;
            if (prev && typeof prev.focus === "function") prev.focus();
        };
    }, [onClose, busy]);

    return createPortal(
        <div
            className={SHEET_BACKDROP}
            style={{ zIndex: 2147483647 }}
            onMouseDown={(e) => {
                if (e.target === e.currentTarget && !busy) onClose();
            }}>
            <div
                ref={ref}
                {...modalAttrs(modal)}
                role="dialog"
                aria-modal="true"
                aria-labelledby={labelledBy}
                tabIndex={-1}
                data-modal-sheet=""
                className={SHEET_DIALOG}>
                <SheetHandle />
                {children}
                <SheetStyle />
            </div>
        </div>,
        document.body,
    );
}

function RmBadge({ tone = "primary", icon: Icon, children }) {
    const look = { primary: "border-primary/60 text-primary", success: "border-success/60 text-success", info: "border-info/60 text-info" }[tone];
    return (
        <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border bg-transparent px-2.5 py-1 text-xs font-medium leading-none max-sm:px-2 max-sm:py-0.5 max-sm:text-[11px] ${look}`}>
            {Icon && <Icon size={13} strokeWidth={2} aria-hidden="true" />}
            {children}
        </span>
    );
}

function RmCard({ icon: Icon, title, hint, tone = "primary", children }) {
    const soft = tone === "success" ? "bg-success/15 text-success" : "bg-primary/15 text-primary";
    return (
        <section className="min-w-0 rounded-xl border border-base-content/10 bg-base-100">
            <header className="flex shrink-0 items-center gap-2.5 px-3.5 pt-3 [@media(max-height:820px)]:pt-2.5 max-sm:gap-2 max-sm:px-3 max-sm:pt-2">
                <span className={`flex h-7 w-7 max-sm:h-6 max-sm:w-6 shrink-0 items-center justify-center rounded-full ${soft}`} aria-hidden="true">
                    <Icon size={14} />
                </span>
                <h3 className="min-w-0 flex-1 text-sm font-medium text-base-content max-sm:text-[13px]">{title}</h3>
                {hint && <span className="shrink-0 text-xs text-base-content/60 max-sm:text-[11px]">{hint}</span>}
            </header>
            <div className="px-3.5 pb-3 pt-2.5 [@media(max-height:820px)]:pb-2.5 [@media(max-height:820px)]:pt-2 max-sm:px-3 max-sm:pb-2 max-sm:pt-1.5">{children}</div>
        </section>
    );
}

function RmKeyGrid({ rows, cols = "@xl:grid-cols-2" }) {
    const shown = rows.filter((r) => r && r[1] !== null && r[1] !== undefined && r[1] !== "");
    return (
        <dl className={`grid grid-cols-2 gap-x-5 gap-y-2.5 [@media(max-height:820px)]:gap-y-2 max-sm:gap-x-3 max-sm:gap-y-1.5 ${cols}`}>
            {shown.map(([k, v]) => (
                <div key={k} className="min-w-0">
                    <dt className="text-xs text-base-content/60 max-sm:text-[11px] max-sm:leading-tight">{k}</dt>
                    <dd className="mt-0.5 wrap-break-word text-[13px] font-medium text-base-content max-sm:text-xs max-sm:leading-snug">{v}</dd>
                </div>
            ))}
        </dl>
    );
}

function RmSteps({ title, hint, items }) {
    return (
        <RmCard icon={ListChecks} title={title} hint={hint}>
            <ol className="flex flex-col divide-y divide-base-content/10 @xl:flex-row @xl:divide-x @xl:divide-y-0">
                {items.map((st, i) => (
                    <li key={i} className="flex min-w-0 items-start gap-2.5 py-2 max-sm:gap-2 max-sm:py-1 first:pt-0 last:pb-0 @xl:flex-1 @xl:px-3.5 @xl:py-0 @xl:first:pl-0 @xl:last:pr-0">
                        <span className="flex h-7 w-7 max-sm:h-6 max-sm:w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[13px] max-sm:text-xs font-medium text-primary">{i + 1}</span>
                        <span className="min-w-0 self-center wrap-break-word text-[13px] max-sm:text-xs leading-snug text-base-content/80">{st}</span>
                    </li>
                ))}
            </ol>
        </RmCard>
    );
}

function RmNote({ tone = "info", children }) {
    const box = tone === "error" ? "border-error/45 bg-error/10" : tone === "success" ? "border-success/40 bg-success/10" : "border-info/40 bg-info/10";
    const iconTone = tone === "error" ? "text-error" : tone === "success" ? "text-success" : "text-info";
    return (
        <div role={tone === "error" ? "alert" : "note"} className={`flex items-start gap-3 rounded-xl border px-3.5 py-2.5 max-sm:gap-2 max-sm:px-3 max-sm:py-1.5 ${box}`}>
            <Info size={16} className={`mt-0.5 shrink-0 max-sm:h-4 max-sm:w-4 ${iconTone}`} aria-hidden="true" />
            <p className="min-w-0 wrap-break-word text-[13px] max-sm:text-xs leading-snug text-base-content/90">{children}</p>
        </div>
    );
}

function RmButton({ solid = false, children, ...rest }) {
    const look = solid ? "border-primary bg-primary text-white hover:bg-primary/85" : "border-base-content/25 bg-base-100/40 text-base-content hover:bg-base-content/10";
    return (
        <button
            type="button"
            className={`inline-flex h-10 max-sm:h-9 max-sm:gap-1.5 max-sm:px-3 max-sm:text-[13px] shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg border px-5 text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${RM_FOCUS_RING} ${look}`}
            {...rest}>
            {children}
        </button>
    );
}

export function ReminderModal({ title, poster, isSeries, releaseLabel, countdownLabel, active, busy, error, done, onConfirm, onClose }) {
    const kind = isSeries ? "series" : "movie";
    const [imgFailed, setImgFailed] = useState(false);
    const finished = Boolean(done);

    const badge = finished ? (done === "removed" ? "Removed" : "Done") : active ? "Reminder on" : "Remind me";
    const heading = finished ? (done === "removed" ? "Reminder removed" : "Reminder set") : title;
    const summary = finished
        ? done === "removed"
            ? `You won't be notified about ${title}.`
            : `We'll notify you as soon as ${title} is released${releaseLabel ? ` on ${releaseLabel}` : ""}.`
        : active
          ? `You'll be notified when this ${kind} is released. You can remove the reminder below.`
          : `Get a notification as soon as this ${kind} is released, so you don't miss it.`;
    const tone = finished && done === "set" ? "success" : "primary";

    return (
        <RmShell modal={MODALS.mediaReminder} onClose={onClose} busy={busy} labelledBy="remind-title">
            <div className="@container flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
                {/* Close cross: zero-height sticky rail, stays top-right while the content scrolls under it */}
                <div className="sticky top-0 z-20 h-0">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                        aria-label="Close dialog"
                        className={`btn btn-sm btn-square absolute right-3 top-3 rounded-md border border-base-content/15 bg-base-200/80 backdrop-blur hover:bg-base-100 ${RM_FOCUS_RING}`}>
                        <X size={16} />
                    </button>
                </div>

                <header className="relative shrink-0 border-b border-base-content/10">
                    <div className="flex items-center gap-3.5 px-4 py-5 sm:gap-4 sm:px-6 sm:py-6 [@media(max-height:700px)]:py-4 sm:[@media(max-height:700px)]:py-4 max-sm:gap-3 max-sm:px-3 max-sm:py-3">
                        {finished ? (
                            <span className="flex h-14 w-14 max-sm:h-11 max-sm:w-11 shrink-0 items-center justify-center rounded-2xl border border-success/70 text-success sm:h-16 sm:w-16 [@media(max-height:820px)]:h-12 [@media(max-height:820px)]:w-12" aria-hidden="true">
                                <Check size={26} strokeWidth={1.8} />
                            </span>
                        ) : poster && !imgFailed ? (
                            <img
                                src={poster}
                                alt=""
                                referrerPolicy="no-referrer"
                                onError={() => setImgFailed(true)}
                                className="aspect-2/3 h-24 max-sm:h-[4.5rem] shrink-0 rounded-lg border border-base-content/15 object-cover shadow-md sm:h-28 [@media(max-height:820px)]:h-20"
                            />
                        ) : (
                            <span className="flex aspect-2/3 h-24 max-sm:h-[4.5rem] shrink-0 items-center justify-center rounded-xl border border-primary/70 text-primary sm:h-28 [@media(max-height:820px)]:h-20" aria-hidden="true">
                                <Film size={28} strokeWidth={1.6} />
                            </span>
                        )}
                        <div className="min-w-0 flex-1 pr-11">
                            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                                <RmBadge tone={tone} icon={finished ? Check : BellRing}>
                                    {badge}
                                </RmBadge>
                                <h2 id="remind-title" className="min-w-0 wrap-break-word text-lg max-sm:text-base font-semibold leading-tight text-base-content sm:text-xl">
                                    {heading}
                                </h2>
                                {!finished && (
                                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-base-content/70">
                                        <span className={`h-2 w-2 rounded-full ${active ? "bg-success" : "bg-base-content/30"}`} aria-hidden="true" />
                                        {active ? "Reminder on" : "Not set"}
                                    </span>
                                )}
                            </div>
                            <p className="mt-1 line-clamp-2 text-[13px] max-sm:text-xs leading-snug text-base-content/70">{summary}</p>
                        </div>
                    </div>
                </header>

                <div className="flex flex-1 flex-col px-3 py-3 sm:px-5 [@media(max-height:820px)]:py-2 max-sm:px-2.5 max-sm:py-2">
                    <div className="flex w-full flex-1 flex-col justify-center gap-2.5 [@media(max-height:820px)]:gap-2 max-sm:gap-1.5">
                        {finished ? (
                            <>
                                <RmCard icon={BellRing} title="Your reminder" tone={tone}>
                                    <RmKeyGrid
                                        cols="@xl:grid-cols-4"
                                        rows={[
                                            ["Title", title],
                                            ["Type", isSeries ? "Series" : "Movie"],
                                            ["Release date", releaseLabel || "To be announced"],
                                            ["Status", done === "removed" ? "Removed" : "On"],
                                        ]}
                                    />
                                </RmCard>
                                <RmNote tone="success">{done === "removed" ? "You can set the reminder again any time from this page." : "You can remove the reminder any time from this page."}</RmNote>
                            </>
                        ) : (
                            <>
                                <div className="grid gap-2.5 max-sm:gap-1.5 @xl:grid-cols-2">
                                    <RmCard icon={Film} title="About this title">
                                        <RmKeyGrid
                                            rows={[
                                                ["Title", title],
                                                ["Type", isSeries ? "Series" : "Movie"],
                                                ["Release date", releaseLabel || "To be announced"],
                                                ["Releases in", countdownLabel],
                                            ]}
                                        />
                                    </RmCard>
                                    <RmCard icon={Bell} title="Delivery">
                                        <RmKeyGrid
                                            rows={[
                                                ["In the app", "Bell notification"],
                                                ["Push alert", "If enabled on your device"],
                                                ["When", "On the release date"],
                                                ["Status", active ? "Reminder on" : "Not set"],
                                            ]}
                                        />
                                    </RmCard>
                                </div>
                                <RmSteps
                                    title="How it works"
                                    hint="Takes one click"
                                    items={["Choose Confirm to set the reminder.", "On the release date FLUX adds a notification to your bell.", "Open it to see the details page."]}
                                />
                                {error ? <RmNote tone="error">{error}</RmNote> : <RmNote tone="info">A release does not mean the title is in your library yet. It shows there once it has been added.</RmNote>}
                            </>
                        )}
                    </div>
                </div>
            </div>

            <footer className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-base-content/10 bg-base-200 px-4 py-2.5 sm:px-5 max-sm:flex-col max-sm:items-stretch max-sm:gap-y-1.5 max-sm:px-3 max-sm:py-2">
                <div className="min-w-0 text-xs text-base-content/60 max-sm:text-[11px] max-sm:leading-tight">{finished ? "All done." : "You can remove the reminder any time from this page."}</div>
                <div className="ml-auto flex flex-wrap items-center justify-end gap-2 max-sm:ml-0 max-sm:w-full max-sm:flex-nowrap max-sm:gap-1.5 max-sm:[&>button]:flex-1">
                    {finished ? (
                        <RmButton solid data-autofocus onClick={onClose}>
                            Done
                        </RmButton>
                    ) : (
                        <>
                            <RmButton data-autofocus onClick={onClose} disabled={busy}>
                                Cancel
                            </RmButton>
                            <RmButton solid onClick={onConfirm} disabled={busy}>
                                {busy ? "Saving…" : active ? "Remove reminder" : "Confirm"}
                            </RmButton>
                        </>
                    )}
                </div>
            </footer>
        </RmShell>
    );
}

// ─── "Remind me" for one upcoming title ───────────────────────────────────────
// Used by MediaDetails.jsx (details page) and Banner.jsx (Discover main banner + On the Horizon).
// mediaId = "tmdb-movie-123" / "tmdb-tv-456". The server stores the reminder and notifies the user on release day.
export function useReminder(mediaId, enabled = true) {
    const qc = useQueryClient();
    const { user } = useAuth();
    const key = ["notifications", "reminder", mediaId];

    const query = useQuery({
        queryKey: key,
        queryFn: () => getReminder(mediaId),
        enabled: Boolean(enabled && user && mediaId),
        staleTime: 60_000,
        retry: false,
    });
    const set = useMutation({
        mutationFn: setReminder,
        onSuccess: (data) => qc.setQueryData(key, { reminded: true, reminder: data?.reminder ?? null }),
    });
    const remove = useMutation({
        mutationFn: () => removeReminder(mediaId),
        onSuccess: () => qc.setQueryData(key, { reminded: false, reminder: null }),
    });

    return { reminded: Boolean(query.data?.reminded), reminder: query.data?.reminder ?? null, loading: query.isLoading, set, remove };
}

// Render-prop wrapper: owns the reminder state + the confirm dialog, the caller only draws its own button.
//   <RemindMe mediaId title poster releaseDate isSeries enabled autoOpen onAutoOpen onOpenChange>
//       {({ reminded, open }) => <button onClick={open}>{reminded ? "Reminder on" : "Remind me"}</button>}
//   </RemindMe>
// The dialog opens right where <RemindMe> is rendered (details page, Discover banners): no redirect.
// `enabled`  = fetch the saved state (false → no request).
// `autoOpen` = open the dialog once on mount (details page opened from a banner via ?remind=1); `onAutoOpen` runs after.
const stopBubble = (e) => e.stopPropagation();

export function RemindMe({ mediaId, title, poster = null, releaseDate, isSeries = false, enabled = true, autoOpen = false, onAutoOpen, onOpenChange, children }) {
    const date = releaseDate ? String(releaseDate).slice(0, 10) : null; // YYYY-MM-DD
    const reminder = useReminder(mediaId, Boolean(enabled && date));
    const [open, setOpen] = useState(false);
    const [ui, setUi] = useState({ busy: false, error: null, done: null });
    const syncedRef = useRef(false);

    // TMDB can move a release date: keep an existing reminder in step with what the page shows.
    useEffect(() => {
        if (syncedRef.current || !reminder.reminded || !date) return;
        syncedRef.current = true;
        if (reminder.reminder?.releaseDate !== date) reminder.set.mutate({ mediaId, title, poster, releaseDate: date });
    }, [reminder.reminded, reminder.reminder?.releaseDate, date]); // eslint-disable-line react-hooks/exhaustive-deps

    // Tell the parent (e.g. a banner) while the dialog is open so it can pause its autoplay.
    useEffect(() => {
        onOpenChange?.(open);
    }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

    const autoRef = useRef(false);
    useEffect(() => {
        if (!autoOpen || autoRef.current || reminder.loading || !date) return;
        autoRef.current = true;
        setUi({ busy: false, error: null, done: null });
        setOpen(true);
        onAutoOpen?.();
    }, [autoOpen, reminder.loading, date]); // eslint-disable-line react-hooks/exhaustive-deps

    const openDialog = (e) => {
        e?.stopPropagation?.();
        setUi({ busy: false, error: null, done: null });
        setOpen(true);
    };
    const confirm = async () => {
        setUi({ busy: true, error: null, done: null });
        try {
            if (reminder.reminded) {
                await reminder.remove.mutateAsync();
                setUi({ busy: false, error: null, done: "removed" });
            } else {
                await reminder.set.mutateAsync({ mediaId, title, poster, releaseDate: date });
                setUi({ busy: false, error: null, done: "set" });
            }
        } catch (err) {
            setUi({ busy: false, error: err?.message || "Something went wrong. Please try again.", done: null });
        }
    };

    const when = date ? new Date(`${date}T00:00:00`) : null;
    const releaseLabel = when ? when.toLocaleDateString(undefined, { dateStyle: "medium" }) : null;
    const days = when ? Math.ceil((when.getTime() - Date.now()) / 86_400_000) : null;
    const countdownLabel = days == null ? null : days <= 0 ? "Today" : days === 1 ? "Tomorrow" : `${days} days`;

    return (
        <>
            {children({ reminded: reminder.reminded, open: openDialog })}
            {open && (
                // The dialog is a portal, but React still bubbles its events to the parent (a banner slide / link):
                // stop them here so clicks and keys inside the dialog never trigger the parent.
                <span style={{ display: "contents" }} onClick={stopBubble} onMouseDown={stopBubble} onPointerDown={stopBubble} onTouchStart={stopBubble} onKeyDown={stopBubble}>
                    <ReminderModal
                        title={title}
                        poster={poster}
                        isSeries={isSeries}
                        releaseLabel={releaseLabel}
                        countdownLabel={countdownLabel}
                        active={reminder.reminded}
                        busy={ui.busy}
                        error={ui.error}
                        done={ui.done}
                        onConfirm={confirm}
                        onClose={() => setOpen(false)}
                    />
                </span>
            )}
        </>
    );
}
