// web/src/Dashboard/Components/DashModal.jsx
//
// Every dashboard dialog lives in this one file: the shared primitives, the ConfirmModal, the Storage / Uploads app dialogs and
// the modal of each dashboard page (Libraries, Storage, Streams, Media, Users, IPTV). Pages import their dialogs from here and render
// them at the same place as before.
//
// Motion is its own system (dm-* keyframes, scoped by [data-dm-frame] / [data-dm-sheet]) and is separate from components/Modal.jsx.
// Every dialog carries id, name, data-dash-modal, data-modal-source and data-modal-purpose (see DASH_MODALS) so you can find it in the DOM:
//   document.getElementById("dash-modal-library-edit")   ·   document.querySelector('[name="media-delete"]')   ·   document.querySelectorAll("[data-dash-modal]")
//
//   Primitives    – ModalShell, ModalHeader, ModalTabs, ModalBody, PanelBody, ModalAside, ModalFooter, ModalAvatar, ModalBadge, ModalButton, …
//   ConfirmModal  – generic confirm dialog (named export + default export, same props as before plus an optional `modal` registry entry)
//   useAppModal   – confirm / notify / promptText dialogs for the Storage and Uploads pages
//   Page modals   – one section per page, below

import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import Hls from "hls.js";
import {
    Activity,
    AlertCircle,
    AlertTriangle,
    Ban,
    Calendar,
    Check,
    CheckCircle,
    CheckCircle2,
    ChevronRight,
    ChevronUp,
    Clock,
    Cloud,
    Copy,
    Crown,
    Database,
    Eye,
    EyeOff,
    FileText,
    FileVideo,
    Film,
    Folder,
    FolderOpen,
    FolderPlus,
    Gauge,
    Globe,
    Globe2,
    HardDrive,
    Inbox,
    Info,
    KeyRound,
    Languages,
    Layers,
    Library,
    Link as LinkIcon,
    ListVideo,
    Loader2,
    LogOut,
    Mail,
    Monitor,
    MonitorPlay,
    Play,
    Plus,
    RefreshCw,
    RotateCcw,
    Satellite,
    Search,
    Server,
    Shield,
    ShieldAlert,
    ShieldCheck,
    ShieldOff,
    Smartphone,
    Sparkles,
    SquarePen,
    Star,
    Swords,
    Trash2,
    TrendingUp,
    Tv,
    Tv2,
    Upload,
    User,
    Volume2,
    WifiOff,
    X,
    XCircle,
} from "lucide-react";
import { Link, useNavigate } from "react-router";
import { api } from "../Shared";
import { dashApi } from "../Api/dashboardApi";
import { storageApi } from "../Api/storageApi";

// ─── Modal registry ───────────────────────────────────────────────────────────
// Every dashboard dialog has its own id + name, written on the dialog element
// (id="…", name="…", data-modal-source, data-modal-purpose) so you can tell which modal it is, what it does and where it is used:
//   document.getElementById("dash-modal-library-edit")   ·   document.querySelector('[name="media-delete"]')   ·   document.querySelectorAll("[data-dash-modal]")
export const DASH_MODALS = {
    // Shared
    confirm: {
        id: "dash-modal-confirm",
        name: "confirm",
        source: "components/DashModal.jsx (ConfirmModal, used when a page passes no modal of its own)",
        purpose: "Generic yes / no confirmation",
    },

    // Libraries
    libraryDetail: {
        id: "dash-modal-library-detail",
        name: "library-detail",
        source: "pages/DashLibraries.jsx (Local tab: click a row, or the Info action)",
        purpose: "Read-only details of one library: files, storage, share of disk, path, status",
    },
    libraryEdit: {
        id: "dash-modal-library-edit",
        name: "library-edit",
        source: "pages/DashLibraries.jsx (Local tab: Edit action, or Edit library inside the detail dialog)",
        purpose: "Rename a library and change its folder path (PATCH /api/library/:id)",
    },
    libraryRemove: {
        id: "dash-modal-library-remove",
        name: "library-remove",
        source: "pages/DashLibraries.jsx (Local tab: Remove action)",
        purpose: "Confirm removing a local library. Files on disk are never deleted",
    },
    libraryRemoveCloud: {
        id: "dash-modal-library-remove-cloud",
        name: "library-remove-cloud",
        source: "pages/DashLibraries.jsx (Cloud tab: Remove action)",
        purpose: "Confirm removing a cloud library link. Files stay on the provider",
    },

    // Storage
    storageConfirm: {
        id: "dash-modal-storage-confirm",
        name: "storage-confirm",
        source: "pages/DashStorage.jsx (disconnect a provider, delete a cloud folder, remove a cloud library)",
        purpose: "Confirm a storage action before it runs",
    },
    storageNotice: {
        id: "dash-modal-storage-notice",
        name: "storage-notice",
        source: "pages/DashStorage.jsx (any failed or finished storage action)",
        purpose: "Tells the admin what happened (error / success / info) and what to do next",
    },
    storagePrompt: {
        id: "dash-modal-storage-new-folder",
        name: "storage-new-folder",
        source: "pages/DashStorage.jsx (Browse & Import → New folder)",
        purpose: "Asks for the name of a new cloud folder",
    },
    storageBrowse: {
        id: "dash-modal-storage-browse",
        name: "storage-browse",
        source: "pages/DashStorage.jsx (provider card → Browse & Import)",
        purpose: "Browse a Google Drive / GoFile folder tree and import a folder as a library",
    },

    // Uploads
    uploadsConfirm: {
        id: "dash-modal-uploads-confirm",
        name: "uploads-confirm",
        source: "pages/DashUploads.jsx (All Uploads tab → delete from provider)",
        purpose: "Confirm permanently deleting an uploaded file from its provider",
    },
    uploadsNotice: {
        id: "dash-modal-uploads-notice",
        name: "uploads-notice",
        source: "pages/DashUploads.jsx (a file could not be added, resumed or deleted)",
        purpose: "Tells the admin what happened with an upload action",
    },
    uploadsPrompt: {
        id: "dash-modal-uploads-prompt",
        name: "uploads-prompt",
        source: "pages/DashUploads.jsx (reserved: text prompt)",
        purpose: "Asks for a short piece of text",
    },

    // Streams
    streamStop: {
        id: "dash-modal-stream-stop",
        name: "stream-stop",
        source: "pages/DashStreams.jsx (stop button on a live stream row)",
        purpose: "Confirm terminating a live transcoding session",
    },

    // Media
    mediaEdit: {
        id: "dash-modal-media-edit",
        name: "media-edit",
        source: "pages/DashMedia.jsx (table: Edit action)",
        purpose: "Edit a title's name, year, type and access",
    },
    mediaDetails: {
        id: "dash-modal-media-details",
        name: "media-details",
        source: "pages/DashMedia.jsx (table: Info action / row click)",
        purpose: "Read-only overview, technical and file details of one title",
    },
    mediaDelete: {
        id: "dash-modal-media-delete",
        name: "media-delete",
        source: "pages/DashMedia.jsx (table: Delete action)",
        purpose: "Confirm deleting a title from the database",
    },

    // Users
    userInfo: {
        id: "dash-modal-user-info",
        name: "user-info",
        source: "pages/DashUsers.jsx (table: Details action)",
        purpose: "Account, access and device summary of one user",
    },
    userRequest: {
        id: "dash-modal-user-access",
        name: "user-access",
        source: "pages/DashUsers.jsx (table: Manage access action)",
        purpose: "Approve / reject / block a request, or change role and access time limit",
    },
    userPermissions: {
        id: "dash-modal-user-permissions",
        name: "user-permissions",
        source: "pages/DashUsers.jsx (table: Permissions action)",
        purpose: "Choose which libraries and 18+ content a user may open",
    },
    userConfirm: {
        id: "dash-modal-user-confirm",
        name: "user-confirm",
        source: "pages/DashUsers.jsx (⋮ menu: Approve / Reject / Block / Delete User)",
        purpose: "Confirm a user status change or account deletion",
    },

    // IPTV
    iptvPlayer: {
        id: "dash-modal-iptv-player",
        name: "iptv-player",
        source: "pages/DashIPTV.jsx (channel row: Play)",
        purpose: "Preview a live stream in place with hls.js",
    },
    iptvUpload: {
        id: "dash-modal-iptv-upload",
        name: "iptv-upload",
        source: "pages/DashIPTV.jsx (Sources tab: Upload playlist)",
        purpose: "Add channels from a playlist file",
    },
    iptvAddUrl: {
        id: "dash-modal-iptv-add-url",
        name: "iptv-add-url",
        source: "pages/DashIPTV.jsx (Sources tab: Add URL)",
        purpose: "Add channels from a playlist URL",
    },
    iptvSourceInfo: {
        id: "dash-modal-iptv-source-info",
        name: "iptv-source-info",
        source: "pages/DashIPTV.jsx (Sources tab: Info action)",
        purpose: "Read-only details of one playlist source",
    },
    iptvSourceEdit: {
        id: "dash-modal-iptv-source-edit",
        name: "iptv-source-edit",
        source: "pages/DashIPTV.jsx (Sources tab: Edit action)",
        purpose: "Rename a playlist source or change its address",
    },
    iptvChannelInfo: {
        id: "dash-modal-iptv-channel-info",
        name: "iptv-channel-info",
        source: "pages/DashIPTV.jsx (Channels tab: Info action)",
        purpose: "Read-only details of one channel",
    },
    iptvChannelEdit: {
        id: "dash-modal-iptv-channel-edit",
        name: "iptv-channel-edit",
        source: "pages/DashIPTV.jsx (Channels tab: Edit action)",
        purpose: "Edit a channel (saved to channel-state.json)",
    },
    iptvActiveEdit: {
        id: "dash-modal-iptv-active-edit",
        name: "iptv-active-edit",
        source: "pages/DashIPTV.jsx (Active channels: Edit action)",
        purpose: "Edit an active channel (saved to active_live.json only)",
    },
    iptvSourceDelete: {
        id: "dash-modal-iptv-source-delete",
        name: "iptv-source-delete",
        source: "pages/DashIPTV.jsx (Sources tab: Delete action)",
        purpose: "Confirm deleting a playlist source and every channel from it",
    },
    iptvChannelDelete: {
        id: "dash-modal-iptv-channel-delete",
        name: "iptv-channel-delete",
        source: "pages/DashIPTV.jsx (Channels tab: Delete action)",
        purpose: "Confirm hiding a channel everywhere in FLUX",
    },
};

const FALLBACK_MODAL = { id: "dash-modal", name: "dash-modal", source: "components/DashModal.jsx", purpose: "Dashboard dialog" };

// Attributes that identify a dialog: spread on the dialog element.
const dashModalAttrs = (m) => {
    const d = m || FALLBACK_MODAL;
    return { id: d.id, name: d.name, "data-dash-modal": d.name, "data-modal-source": d.source, "data-modal-purpose": d.purpose };
};

// ─── Motion ───────────────────────────────────────────────────────────────────
// Same motion language as the app's other dialogs (Modal.jsx), written on its own selectors (dm-*) so the two never touch:
//  • scrim (::before of the frame): fades in / out on its own layer, so the dialog is never double-faded.
//  • dialog: eases in (fade + small rise + 96.5% → 100% scale) and leaves faster than it arrived.
//  • content (header / tabs / body / footer): fades up a beat after the shell, so the container lands first.
//  • enter animations use `backwards` fill, so no transform is left on the dialog afterwards.
//  • exit: see playExitGhost. It plays for EVERY way a dialog can go away (Esc, backdrop, buttons, or the page unmounting it).
//  • reduced-motion users get no animation.
const EXIT_MS = 260;

function DashModalStyle() {
    return (
        <style>{`@keyframes dm-fade-in{from{opacity:0}to{opacity:1}}
@keyframes dm-fade-out{from{opacity:1}to{opacity:0}}
@keyframes dm-pop-in{from{opacity:0;transform:translate3d(0,16px,0) scale(.965)}to{opacity:1;transform:translate3d(0,0,0) scale(1)}}
@keyframes dm-pop-out{from{opacity:1;transform:translate3d(0,0,0) scale(1)}to{opacity:0;transform:translate3d(0,10px,0) scale(.975)}}
@keyframes dm-content-in{from{opacity:0;transform:translate3d(0,8px,0)}to{opacity:1;transform:translate3d(0,0,0)}}
[data-dm-frame]{overscroll-behavior:contain}
[data-dm-frame]::before{content:"";position:absolute;inset:0;background:rgba(0,0,0,.7);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);animation:dm-fade-in 300ms cubic-bezier(.4,0,.2,1) backwards}
[data-dm-frame][data-dm-state="closing"]{pointer-events:none}
[data-dm-frame][data-dm-state="closing"]::before{animation:dm-fade-out ${EXIT_MS}ms cubic-bezier(.4,0,1,1) forwards}
[data-dm-sheet]{position:relative;z-index:1;animation:dm-pop-in 340ms cubic-bezier(.22,1,.36,1) backwards}
[data-dm-sheet][data-dm-state="closing"]{animation:dm-pop-out 200ms cubic-bezier(.32,0,.67,0) forwards}
[data-dm-sheet][data-dm-state="open"]>:where(div,header,footer,section){animation:dm-content-in 360ms cubic-bezier(.22,1,.36,1) 70ms backwards}
@media (prefers-reduced-motion:reduce){[data-dm-frame]::before,[data-dm-sheet],[data-dm-sheet]>*{animation:none !important}}
[role="dialog"], [role="dialog"] * { scrollbar-width: none !important; -ms-overflow-style: none !important }
[role="dialog"] *::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important }`}</style>
    );
}

// Exit animation by snapshot. When a dialog unmounts (the page set its state to null, or the user pressed Esc / a button and the
// page reacted), React removes it at once. Just before that happens we clone its DOM, put the clone back on the body, mark it
// "closing" and let CSS fade it out. The clone is inert, so it can't be clicked or focused, and it removes itself afterwards.
function playExitGhost(frame) {
    if (!frame || typeof document === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const ghost = frame.cloneNode(true);
    // cloneNode copies attributes, not what the user typed: carry the live form state over.
    const live = frame.querySelectorAll("input, textarea, select");
    const copy = ghost.querySelectorAll("input, textarea, select");
    live.forEach((src, i) => {
        const dst = copy[i];
        if (!dst) return;
        if (src.tagName === "TEXTAREA") dst.textContent = src.value;
        else if (src.tagName === "SELECT") [...dst.options].forEach((o, k) => (o.selected = src.options[k]?.selected));
        else if (src.type === "checkbox" || src.type === "radio") src.checked ? dst.setAttribute("checked", "") : dst.removeAttribute("checked");
        else dst.setAttribute("value", src.value);
    });
    ghost.removeAttribute("id");
    ghost.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
    ghost.setAttribute("data-dm-state", "closing");
    ghost.setAttribute("data-dm-ghost", "");
    ghost.setAttribute("aria-hidden", "true");
    ghost.setAttribute("inert", "");
    ghost.querySelector("[data-dm-sheet]")?.setAttribute("data-dm-state", "closing");

    // Wait one microtask: if the frame is still in the document, this was React's dev-only simulated unmount (StrictMode), not a real close.
    queueMicrotask(() => {
        if (frame.isConnected) return;
        document.body.appendChild(ghost);
        setTimeout(() => ghost.remove(), EXIT_MS + 60);
    });
}

// Locks page scroll and pads for the scrollbar that disappears, so the page doesn't jump sideways when a dialog opens or closes.
function lockBodyScroll() {
    const body = document.body;
    const prevOverflow = body.style.overflow;
    const prevPad = body.style.paddingRight;
    const gap = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (gap > 0) body.style.paddingRight = `${gap}px`;
    return () => {
        body.style.overflow = prevOverflow;
        body.style.paddingRight = prevPad;
    };
}

// ─── Shell ────────────────────────────────────────────────────────────────────

export function ModalShell({ modal, onClose, busy = false, labelledBy, describedBy, children }) {
    const frameRef = useRef(null);
    const panelRef = useRef(null);
    const closeRef = useRef(onClose);
    const busyRef = useRef(busy);
    closeRef.current = onClose;
    busyRef.current = busy;

    // Exit animation (see playExitGhost).
    useLayoutEffect(() => {
        const frame = frameRef.current;
        return () => playExitGhost(frame);
    }, []);

    useEffect(() => {
        const previouslyFocused = document.activeElement;
        const unlockScroll = lockBodyScroll();
        const panel = panelRef.current;

        const t = setTimeout(() => {
            const target = panel?.querySelector("[data-autofocus]") || panel;
            target?.focus();
        }, 30);

        const onKey = (e) => {
            if (e.key === "Escape") {
                if (busyRef.current) return;
                e.stopPropagation();
                closeRef.current?.();
                return;
            }
            if (e.key !== "Tab" || !panel) return;
            const nodes = [...panel.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
            if (!nodes.length) return;
            const first = nodes[0];
            const last = nodes[nodes.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        };
        document.addEventListener("keydown", onKey, true);

        return () => {
            clearTimeout(t);
            document.removeEventListener("keydown", onKey, true);
            unlockScroll();
            previouslyFocused?.focus?.();
        };
    }, []);

    return createPortal(
        <div
            ref={frameRef}
            data-dm-frame=""
            data-dm-state="open"
            className="fixed inset-0 flex items-center justify-center p-2"
            style={{ zIndex: 99990 }}
            onMouseDown={(e) => {
                if (e.target === e.currentTarget && !busy) onClose?.();
            }}>
            <div
                ref={panelRef}
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
                aria-labelledby={labelledBy}
                aria-describedby={describedBy}
                aria-busy={busy || undefined}
                {...dashModalAttrs(modal)}
                data-dm-sheet=""
                data-dm-state="open"
                className={`relative flex ${MODAL_SIZE} min-w-0 flex-col overflow-hidden overscroll-contain rounded-lg border border-base-content/15 bg-base-200 p-0 text-base-content shadow-2xl outline-none max-sm:w-[96dvw] max-sm:max-w-[96dvw]`}>
                {children}
            </div>
            <DashModalStyle />
        </div>,
        document.body,
    );
}

// ─── Primitives ───────────────────────────────────────────────────────────────

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
// Keep every modal proportional to the viewport instead of forcing a square or fixed max-width.
const MODAL_SIZE = "h-[75dvh]  w-[60dvw] max-h-[75dvh]  max-w-[60dvw]";

export const TONE = {
    neutral: "text-base-content/70",
    primary: "text-primary",
    success: "text-success",
    warning: "text-warning",
    error: "text-error",
    info: "text-info",
    accent: "text-accent",
};
// Same tinted-chip palette the rest of the app uses (shared.jsx Chip): text-X bg-X/10 border-X/35
const BADGE = {
    neutral: "text-base-content/80 bg-base-content/10 border-base-content/20",
    primary: "text-primary bg-primary/10 border-primary/35",
    success: "text-success bg-success/10 border-success/35",
    warning: "text-warning bg-warning/10 border-warning/40",
    error: "text-error bg-error/10 border-error/40",
    info: "text-info bg-info/10 border-info/35",
    accent: "text-accent bg-accent/10 border-accent/35",
};

// ─── Header / body / footer ───────────────────────────────────────────────────

/** daisyUI avatar. Pass `src` for a photo, otherwise the initial of `name` is shown. */
export function ModalAvatar({ name, src, className = "w-9", ring = "border-base-content/20" }) {
    const initial = (name || "U").trim()[0]?.toUpperCase() || "U";
    return src ? (
        <div className="avatar shrink-0">
            <div className={`${className} rounded-full border ${ring}`}>
                <img src={src} alt="" />
            </div>
        </div>
    ) : (
        <div className="avatar avatar-placeholder shrink-0">
            <div className={`${className} rounded-full border ${ring} bg-base-300 text-base-content`}>
                <span className="text-sm font-medium">{initial}</span>
            </div>
        </div>
    );
}

export function ModalHeader({ id, icon: Icon, tone = "text-primary", avatar, title, subtitle, badges, right, onClose, busy = false }) {
    return (
        <div className="flex shrink-0 items-center gap-3 px-6 py-3.5">
            {avatar ??
                (Icon && (
                    <div className="avatar avatar-placeholder shrink-0">
                        <div className={`w-10 rounded-full border border-current/35 bg-current/10 ${tone}`}>
                            <Icon size={18} strokeWidth={1.9} />
                        </div>
                    </div>
                ))}
            <div className="min-w-0 flex-1">
                <h2 id={id} className="truncate text-[15px] font-medium leading-snug text-base-content">
                    {title}
                </h2>
                {subtitle && <p className="truncate text-xs text-base-content/60">{subtitle}</p>}
            </div>
            {badges && <div className="hidden shrink-0 items-center gap-1.5 sm:flex">{badges}</div>}
            {right}
            <button
                type="button"
                onClick={onClose}
                disabled={busy}
                aria-label="Close dialog"
                className="btn btn-sm btn-square rounded-md border border-base-content/15 bg-transparent text-base-content/70 hover:bg-base-content/10 hover:text-base-content [--depth:0] [--noise:0]">
                <X size={16} strokeWidth={2} />
            </button>
        </div>
    );
}

/** Kept for older callers. Solid surface, no gradient. New dialogs should use ModalHeader. */
export function ModalHero({ id, eyebrow, avatar, title, subtitle, badges, stats, onClose, busy = false }) {
    return <ModalHeader id={id} avatar={avatar} title={title} subtitle={subtitle || eyebrow} badges={badges} right={stats} onClose={onClose} busy={busy} />;
}

export function ModalBody({ children, className = "" }) {
    return <div className={`min-h-0 flex-1 overflow-y-auto border-t border-base-content/10 px-6 py-5 ${className}`}>{children}</div>;
}

/**
 * Body for the fixed-size modal. Design the content to fit; scrollbars are hidden globally.
 * `bordered={false}` when ModalTabs sits right above it.
 */
export function PanelBody({ aside, children, bordered = true, className = "" }) {
    return (
        <div className={`flex min-h-0 flex-1 flex-col md:flex-row ${bordered ? "border-t border-base-content/10" : ""}`}>
            {aside && <aside className="max-h-44 shrink-0 overflow-y-auto border-b border-base-content/10 bg-base-100 p-4 md:max-h-none md:w-64 md:border-b-0 md:border-r md:p-5">{aside}</aside>}
            <div className={`flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-6 py-4 ${className}`}>{children}</div>
        </div>
    );
}

/**
 * Side panel for PanelBody `aside`: big tinted icon (or avatar), a title and a short facts list,
 * centred so the left column is never an empty strip.
 */
export function ModalAside({ icon: Icon, tone = "text-primary", avatar, title, subtitle, facts = [] }) {
    return (
        <div className="flex min-h-full flex-col items-center justify-center gap-5 text-center">
            <div className="flex max-w-full flex-col items-center gap-3">
                {avatar || (
                    <span className={`grid size-16 place-items-center rounded-full border border-current/35 bg-current/10 ${TONE[tone] || tone}`}>{Icon && <Icon size={28} strokeWidth={1.7} />}</span>
                )}
                {title && <p className="line-clamp-2 max-w-full break-words text-sm font-semibold text-base-content">{title}</p>}
                {subtitle && <p className="-mt-2 line-clamp-2 max-w-full break-all text-[11.5px] text-base-content/55">{subtitle}</p>}
            </div>
            {facts.length > 0 && (
                <dl className="w-full divide-y divide-base-content/10 rounded-md border border-base-content/10 bg-base-200/40">
                    {facts.map((f) => (
                        <div key={f.label} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                            <dt className="shrink-0 text-base-content/55">{f.label}</dt>
                            <dd className="min-w-0 truncate text-right font-medium text-base-content" title={typeof f.value === "string" ? f.value : undefined}>
                                {f.value ?? "—"}
                            </dd>
                        </div>
                    ))}
                </dl>
            )}
        </div>
    );
}

export function ModalFooter({ children, note }) {
    return (
        <div className="flex shrink-0 items-center gap-3 border-t border-base-content/10 px-6 py-3">
            <div className="min-w-0 flex-1 text-[11.5px] text-base-content/70">{note}</div>
            <div className="flex shrink-0 items-center gap-2">{children}</div>
        </div>
    );
}

export function ModalTabs({ tabs, value, onChange }) {
    const refs = useRef({});
    const onKey = (e) => {
        const i = tabs.findIndex((t) => t.id === value);
        let n = null;
        if (e.key === "ArrowRight") n = (i + 1) % tabs.length;
        if (e.key === "ArrowLeft") n = (i - 1 + tabs.length) % tabs.length;
        if (n == null) return;
        e.preventDefault();
        onChange(tabs[n].id);
        refs.current[tabs[n].id]?.focus();
    };
    return (
        <div role="tablist" aria-label="Sections" onKeyDown={onKey} className="flex shrink-0 items-center gap-2 border-t border-base-content/10 px-6 py-2.5">
            {tabs.map((t) => {
                const on = t.id === value;
                const Icon = t.icon;
                return (
                    <button
                        key={t.id}
                        ref={(el) => (refs.current[t.id] = el)}
                        id={`tab-${t.id}`}
                        role="tab"
                        type="button"
                        aria-selected={on}
                        aria-controls={`panel-${t.id}`}
                        tabIndex={on ? 0 : -1}
                        onClick={() => onChange(t.id)}
                        className={`btn btn-sm gap-1.5 rounded-md border [--depth:0] [--noise:0] ${on ? "border-primary/40 bg-primary/15 font-medium text-primary" : "border-base-content/15 bg-transparent text-base-content/70 hover:bg-base-content/10 hover:text-base-content"}`}>
                        {Icon && <Icon size={14} />}
                        {t.label}
                        {t.count != null && (
                            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-base-content/15 px-1.5 text-[10px] tabular-nums text-base-content">{t.count}</span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}

// ─── Atoms ────────────────────────────────────────────────────────────────────

export function ModalBadge({ tone = "neutral", icon: Icon, children }) {
    return (
        <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium ${BADGE[tone] || BADGE.neutral}`}>
            {Icon && <Icon size={11} strokeWidth={2.2} />}
            {children}
        </span>
    );
}

const BTN = {
    ghost: "border-base-content/20 bg-transparent text-base-content/85 hover:bg-base-content/10 hover:text-base-content",
    primary: "btn-primary border-primary hover:brightness-110",
    danger: "btn-error border-error",
    warning: "btn-warning border-warning",
    success: "btn-soft btn-success",
    dangerSoft: "btn-soft btn-error",
};

export function ModalButton({ variant = "ghost", loading = false, loadingText = "Working…", children, className = "", type = "button", ...rest }) {
    return (
        <button
            type={type}
            {...rest}
            disabled={rest.disabled || loading}
            className={`btn btn-sm rounded-md border [--depth:0] [--noise:0] disabled:border-base-content/10 disabled:bg-transparent disabled:text-base-content/40 ${BTN[variant] || BTN.ghost} ${className}`}>
            {loading && <span className="loading loading-spinner loading-xs" />}
            {loading ? loadingText : children}
        </button>
    );
}

/** daisyUI join of buttons with radio semantics. */
export function ModalSegmented({ value, onChange, options, label, className = "", split = false, size = "sm" }) {
    return (
        <div role="radiogroup" aria-label={label} className={split ? `flex gap-2 ${className}` : `flex gap-1 rounded-md border border-base-content/15 bg-base-100 p-1 ${className}`}>
            {options.map((o) => {
                const on = value === o.value;
                const Icon = o.icon;
                return (
                    <button
                        key={String(o.value)}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => onChange(o.value)}
                        className={`btn ${size === "md" ? "btn-md" : "btn-sm"} flex-1 gap-1.5 whitespace-nowrap rounded-md border [--depth:0] [--noise:0] ${on ? "border-primary/40 bg-primary/15 text-primary" : "border-base-content/15 bg-transparent text-base-content/70 hover:bg-base-content/10 hover:text-base-content"}`}>
                        {Icon && <Icon size={13} />}
                        {o.label}
                    </button>
                );
            })}
        </div>
    );
}

/**
 * Pill switch, same look as the app's Settings toggle: primary track when on, muted track when off, white knob.
 * Plain button (not daisyUI toggle) so the theme's square selector radius can't change its shape.
 * Wrap it in a <label> to make a whole row clickable.
 */
export function ModalToggle({ value, onChange, disabled, label }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={!!value}
            aria-label={label}
            disabled={disabled}
            onClick={() => onChange(!value)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${value ? "bg-primary" : "bg-base-content/25"} ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}>
            <span className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white transition-transform duration-150 ${value ? "translate-x-5" : ""}`} />
        </button>
    );
}

// Same notice palette as shared.jsx Notice: info stays plain, other tones are tinted border/bg/icon.
const NOTE = {
    warning: "border-warning/40 bg-warning/10",
    error: "border-error/40 bg-error/10",
    success: "border-success/35 bg-success/10",
};
const NOTE_ICON = { warning: "text-warning", error: "text-error", success: "text-success" };
export function ModalNote({ tone = "info", icon: Icon = Info, children }) {
    return (
        <div
            role={tone === "error" ? "alert" : "note"}
            className={`flex items-start gap-2.5 rounded-md border px-3 py-2 text-[12.5px] leading-snug text-base-content/85 ${NOTE[tone] ?? "border-base-content/10 bg-base-100"}`}>
            <Icon size={15} className={`mt-0.5 shrink-0 ${NOTE_ICON[tone] ?? "text-info"}`} />
            <div className="min-w-0">{children}</div>
        </div>
    );
}

/** One chip of the "pending changes" review: name  from → to */
const cut = (v) => {
    const t = String(v ?? "—");
    return t.length > 24 ? `${t.slice(0, 23)}…` : t;
};
export function ModalChange({ name, from, to }) {
    from = cut(from);
    to = cut(to);
    return (
        <li className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md border border-base-content/15 bg-base-100 px-2.5 text-xs text-base-content/70">
            <span className="font-medium text-base-content">{name}</span>
            <span>{from}</span>
            <span aria-hidden="true" className="text-primary">
                →
            </span>
            <span className="font-medium text-primary">{to}</span>
        </li>
    );
}

// ─── Shared form + detail atoms (used by every dashboard modal) ──────────────

/** Text input look used inside modals: bordered, primary focus ring, matches the site's inputs. */
export const MODAL_INPUT =
    "input input-sm h-9 w-full rounded-md border border-base-content/15 bg-base-100 text-[13px] text-base-content placeholder:text-base-content/40 focus:border-primary/50 focus:outline-none focus-within:outline-none";

/** Label + control + optional hint. `right` sits on the label row (a counter, a link). */
export function ModalField({ label, hint, htmlFor, right, children }) {
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
                <label htmlFor={htmlFor} className="text-xs font-medium text-base-content/70">
                    {label}
                </label>
                {right}
            </div>
            {children}
            {hint && <p className="text-[11.5px] leading-snug text-base-content/50">{hint}</p>}
        </div>
    );
}

/** Titled card of label / value rows (spec sheet). `plain` swaps the row list for free content. */
export function ModalCard({ icon: Icon, title, plain = false, className = "", children }) {
    return (
        <section className={`flex min-h-0 flex-col overflow-hidden rounded-md border border-base-content/10 bg-base-100 ${className}`}>
            <h3 className="flex items-center gap-2 border-b border-base-content/10 bg-base-content/5 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-base-content/60">
                {Icon && <Icon size={13} className="text-primary" />}
                {title}
            </h3>
            {plain ? <div className="flex-1 p-4">{children}</div> : <dl className="flex flex-1 flex-col divide-y divide-base-content/10">{children}</dl>}
        </section>
    );
}

export function ModalRow({ icon: Icon, tone = "text-base-content/50", label, children }) {
    return (
        <div className="flex min-h-11 items-center justify-between gap-4 px-4 py-2 md:flex-1">
            <dt className="flex shrink-0 items-center gap-2 text-xs text-base-content/60">
                {Icon && <Icon size={14} className={tone} />}
                {label}
            </dt>
            <dd className="flex min-w-0 items-center justify-end gap-2 text-[13px] font-medium text-base-content">{children}</dd>
        </div>
    );
}

/** Clipboard write that also works on plain-http LAN addresses (execCommand fallback). */
async function writeClipboard(text) {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text ?? "");
    else {
        const ta = document.createElement("textarea");
        ta.value = text ?? "";
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
    }
}

/** Outlined "Copy" button for key/value rows. */
export function ModalCopyButton({ text, label = "value" }) {
    const [done, setDone] = useState(false);
    async function copy(e) {
        e?.stopPropagation?.();
        try {
            await writeClipboard(text);
            setDone(true);
            setTimeout(() => setDone(false), 1400);
        } catch {
            /* ignore */
        }
    }
    return (
        <button
            type="button"
            onClick={copy}
            aria-label={done ? "Copied" : `Copy ${label}`}
            className="btn btn-xs h-7 shrink-0 gap-1.5 rounded-md border border-base-content/20 bg-transparent px-2.5 text-xs font-normal text-base-content/85 hover:bg-base-content/10 [--depth:0] [--noise:0]">
            {done ? <Check size={12} className="text-success" /> : <Copy size={12} />}
            {done ? "Copied" : "Copy"}
        </button>
    );
}

/** Small copy-to-clipboard icon button. */
export function ModalCopy({ text, label = "value" }) {
    const [done, setDone] = useState(false);
    async function copy(e) {
        e?.stopPropagation?.();
        try {
            await writeClipboard(text);
            setDone(true);
            setTimeout(() => setDone(false), 1400);
        } catch {
            /* ignore */
        }
    }
    return (
        <button
            type="button"
            onClick={copy}
            aria-label={done ? "Copied" : `Copy ${label}`}
            title={done ? "Copied" : `Copy ${label}`}
            className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-base-content/50 transition-colors hover:bg-base-content/10 hover:text-base-content">
            {done ? <Check size={13} className="text-success" /> : <Copy size={13} />}
        </button>
    );
}

const METER = { primary: "bg-primary", success: "bg-success", warning: "bg-warning", error: "bg-error", info: "bg-info", accent: "bg-accent" };
/** Rounded progress bar (0-100). */
export function ModalMeter({ value = 0, tone = "primary", label }) {
    const v = Math.min(100, Math.max(0, Number(value) || 0));
    return (
        <div role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label} className="h-1.5 w-full overflow-hidden rounded-full bg-base-content/10">
            <div className={`h-full rounded-full transition-[width] ${METER[tone] || METER.primary}`} style={{ width: `${v}%` }} />
        </div>
    );
}

/** Footer note for edit dialogs: "● Unsaved" + one chip per change, or a quiet idle line. */
export function ModalDirty({ changes = [], idle = "No changes yet" }) {
    if (!changes.length) return <span className="text-base-content/60">{idle}</span>;
    return (
        <div className="flex min-w-0 items-center gap-3">
            <span className="inline-flex shrink-0 items-center gap-1.5 text-warning">
                <span className="size-2 shrink-0 rounded-full bg-warning" />
                Unsaved
            </span>
            <ul className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto" aria-live="polite" aria-label="Pending changes">
                {changes.map((c) => (
                    <ModalChange key={c.name} {...c} />
                ))}
            </ul>
        </div>
    );
}

// ─── Labelled-section layout (the dashboard modal design) ────────────────────
//
//   <ModalContent>                       single column, 16px gaps, scroll hidden
//     <ModalSection label="…">           small muted label above one panel
//       <ModalRows> <ModalKV label>…     key / value list
//       <ModalStats items=[…]/>          row of stat tiles
//       <ModalCallout tone icon>…        coloured statement
//       <ModalBullets items=[…]/>        icon / number + text list
//     </ModalSection>
//     <ModalReview changes=[…]/>         pinned to the bottom with className="mt-auto"
//   </ModalContent>

export const PANEL = "rounded-lg border border-base-content/10 bg-base-100";

export function ModalContent({ children, className = "", bordered = true }) {
    return <div className={`flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 ${bordered ? "border-t border-base-content/10" : ""} ${className}`}>{children}</div>;
}

/** `pin` pushes the section to the bottom of the body, `grow` lets its panel take the leftover height. */
export function ModalSection({ label, hint, right, pin = false, grow = false, className = "", children }) {
    return (
        <section className={`flex flex-col gap-1.5 ${pin ? "mt-auto" : ""} ${grow ? "min-h-0 flex-1" : "shrink-0"} ${className}`}>
            {(label || right) && (
                <div className="flex min-h-5 items-center justify-between gap-2">
                    <h3 className="text-xs font-medium text-base-content/65">
                        {label}
                        {hint && <span className="ml-1.5 font-normal text-base-content/45">· {hint}</span>}
                    </h3>
                    {right}
                </div>
            )}
            {children}
        </section>
    );
}

/** Key / value list panel. Children: ModalKV. */
export function ModalRows({ children, className = "" }) {
    return <dl className={`${PANEL} flex flex-col divide-y divide-base-content/10 overflow-hidden ${className}`}>{children}</dl>;
}

export function ModalKV({ icon: Icon, tone = "text-base-content/50", label, mono = false, action, children }) {
    return (
        <div className="flex min-h-11 flex-1 items-center gap-4 px-4 py-2">
            <dt className="flex w-28 shrink-0 items-center gap-2 text-xs text-base-content/60">
                {Icon && <Icon size={13} className={TONE[tone] || tone} />}
                {label}
            </dt>
            <dd className={`flex min-w-0 flex-1 items-center gap-2 text-[13px] text-base-content ${mono ? "font-mono text-xs" : ""}`}>
                <span className="min-w-0 flex-1 truncate">{children}</span>
                {action}
            </dd>
        </div>
    );
}

/** Grid of stat tiles: [{ icon, tone, label, value, mono }] */
export function ModalStats({ items, className = "" }) {
    const cols = items.length >= 4 ? "sm:grid-cols-4" : items.length === 3 ? "sm:grid-cols-3" : items.length === 2 ? "sm:grid-cols-2" : "";
    return (
        <div className={`grid grid-cols-2 gap-3 ${cols} ${className}`}>
            {items.map((it) => {
                const Icon = it.icon;
                return (
                    <div key={it.label} className={`${PANEL} flex min-w-0 flex-col gap-1 px-4 py-3`}>
                        <span className="flex items-center gap-1.5 text-xs text-base-content/60">
                            {Icon && <Icon size={13} className={TONE[it.tone] || it.tone || "text-base-content/50"} />}
                            {it.label}
                        </span>
                        <span
                            className={`truncate text-[15px] font-medium text-base-content ${it.mono ? "font-mono text-[13px]" : ""} ${it.valueTone ? TONE[it.valueTone] : ""}`}
                            title={typeof it.value === "string" ? it.value : undefined}>
                            {it.value ?? "—"}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}

const CALLOUT = {
    error: { box: "border-error/60", icon: "text-error" },
    warning: { box: "border-warning/60", icon: "text-warning" },
    success: { box: "border-success/50", icon: "text-success" },
    info: { box: "border-info/50", icon: "text-info" },
    neutral: { box: "border-base-content/10", icon: "text-base-content/60" },
};
/** Coloured statement panel. `compact` = slim one-line bar without the icon disc. */
export function ModalCallout({ tone = "info", icon: Icon = Info, compact = false, className = "", children }) {
    const c = CALLOUT[tone] || CALLOUT.info;
    return (
        <div role={tone === "error" ? "alert" : "note"} className={`flex items-center gap-3 rounded-lg border bg-base-100 ${c.box} ${compact ? "px-4 py-3" : "px-4 py-4"} ${className}`}>
            {compact ? (
                <Icon size={16} className={`shrink-0 ${c.icon}`} />
            ) : (
                <span className="grid size-9 shrink-0 place-items-center rounded-full border border-base-content/10 bg-base-200">
                    <Icon size={16} className={c.icon} />
                </span>
            )}
            <div className="min-w-0 flex-1 text-[13px] leading-snug text-base-content/90">{children}</div>
        </div>
    );
}

/**
 * List of consequences / steps: [{ icon, tone, n, title, text }].
 * `n` shows a number disc instead of an icon. `fill` stretches rows to use the leftover height.
 */
export function ModalBullets({ items, fill = false, className = "" }) {
    return (
        <ul className={`${PANEL} flex flex-col divide-y divide-base-content/10 overflow-hidden ${fill ? "min-h-0 flex-1" : ""} ${className}`}>
            {items.map((it, i) => {
                const Icon = it.icon;
                return (
                    <li key={it.title || it.text || i} className={`flex items-center gap-3.5 px-4 py-3 ${fill ? "min-h-14 flex-1" : ""}`}>
                        <span className="grid size-8 shrink-0 place-items-center rounded-full border border-base-content/10 bg-base-200 text-xs font-medium text-base-content">
                            {Icon ? <Icon size={15} className={TONE[it.tone] || it.tone || "text-base-content/60"} /> : (it.n ?? i + 1)}
                        </span>
                        <div className="min-w-0 flex-1">
                            {it.title && <p className="text-[13px] font-medium leading-snug text-base-content">{it.title}</p>}
                            {it.text && <p className={`text-xs leading-snug ${it.title ? "text-base-content/60" : "text-[13px] text-base-content/85"}`}>{it.text}</p>}
                        </div>
                    </li>
                );
            })}
        </ul>
    );
}

/** "Review changes" panel for edit dialogs. Always rendered so the layout does not jump. */
export function ModalReview({ changes = [], saved = [], className = "" }) {
    const has = changes.length > 0;
    if (!has) {
        if (!saved.length) return null;
        return (
            <section className={`${PANEL} flex shrink-0 flex-col gap-2.5 px-4 py-3.5 ${className}`}>
                <p className="flex items-center gap-2 text-[13px] text-base-content/80">
                    <Info size={15} className="text-info" />
                    Saved values
                </p>
                <ul className="flex flex-wrap items-center gap-2">
                    {saved.map((c) => (
                        <li key={c.name} className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border border-base-content/15 bg-base-200 px-2.5 text-xs">
                            <span className="shrink-0 font-medium text-base-content">{c.name}</span>
                            <span className="truncate text-base-content/65">{cut(c.value)}</span>
                        </li>
                    ))}
                </ul>
                <p className="text-xs text-base-content/50">Edit a field above and the change shows up here for review before you save.</p>
            </section>
        );
    }
    return (
        <section aria-live="polite" className={`${PANEL} flex shrink-0 flex-col gap-2.5 px-4 py-3.5 ${className}`}>
            <p className="flex items-center gap-2 text-[13px] text-base-content">
                <Check size={15} className="text-success" />
                Review changes
            </p>
            <ul className="flex flex-wrap items-center gap-2">
                {changes.map((c) => (
                    <ModalChange key={c.name} {...c} />
                ))}
            </ul>
        </section>
    );
}

/** Rounded square tile with an icon or an image, used for media / channel previews inside panels. */
export function ModalThumb({ icon: Icon, tone = "text-primary", src, className = "size-11" }) {
    return (
        <span className={`grid shrink-0 place-items-center overflow-hidden rounded-md border border-base-content/10 bg-base-200 ${className}`}>
            {src ? <img src={src} alt="" className="size-full object-cover" /> : Icon && <Icon size={18} className={TONE[tone] || tone} />}
        </span>
    );
}

// ─── ConfirmModal ─────────────────────────────────────────────────────────────

const VARIANT = {
    danger: { icon: Trash2, text: "text-error", btn: "danger", badge: "Danger", tone: "error", dot: "text-error" },
    warning: { icon: ShieldAlert, text: "text-warning", btn: "warning", badge: "Warning", tone: "warning", dot: "text-warning" },
    info: { icon: Info, text: "text-info", btn: "primary", badge: "Info", tone: "info", dot: "text-info" },
};

/**
 * ConfirmModal
 *   open, onClose, onConfirm, title, subtitle, message, confirmText, cancelText, variant("danger"|"warning"|"info"), loading
 *   facts:     optional [{ icon, tone, label, value, mono }]   – "You are about to …" key/value panel
 *   factsLabel optional string                                  – label above that panel
 *   message:   the coloured statement of what is about to happen
 *   timeline:  optional [{ icon, tone, title, text }]           – consequences, one row each
 *   details:   optional string[]                                – plain consequence list (used when no timeline)
 *   note:      optional string                                  – slim closing bar pinned to the bottom
 *   noteTone / noteIcon   optional                              – tone ("info"|"warning"|"error"|"success") and icon of that bar
 *   children:  optional node shown between the message and the consequences (e.g. a card naming what is affected)
 *   error:     optional string                                  – failure message
 *   badge:     false hides the Danger / Warning / Info badge in the header
 */
export function ConfirmModal({
    modal,
    open,
    onClose,
    onConfirm,
    title = "Are you sure?",
    subtitle,
    confirmIcon: ConfirmIcon,
    message,
    messageIcon,
    facts,
    factsLabel,
    details,
    timeline,
    note,
    noteTone = "info",
    noteIcon,
    confirmText = "Confirm",
    cancelText = "Cancel",
    variant = "danger",
    loading = false,
    error,
    badge = true,
    children,
}) {
    const uid = useId();
    if (!open) return null;
    const v = VARIANT[variant] || VARIANT.danger;
    const steps =
        Array.isArray(timeline) && timeline.length > 0
            ? timeline
            : Array.isArray(details) && details.length > 0
              ? details.map((d) => ({ icon: variant === "danger" ? AlertTriangle : Info, tone: v.text, text: d }))
              : null;
    const hasFacts = Array.isArray(facts) && facts.length > 0;

    return (
        <ModalShell modal={modal || DASH_MODALS.confirm} onClose={onClose} busy={loading} labelledBy={`${uid}-t`} describedBy={`${uid}-d`}>
            <ModalHeader
                id={`${uid}-t`}
                icon={v.icon}
                tone={v.text}
                title={title}
                subtitle={subtitle}
                badges={badge ? <ModalBadge tone={v.tone}>{v.badge}</ModalBadge> : undefined}
                onClose={onClose}
                busy={loading}
            />
            <ModalContent>
                <div id={`${uid}-d`} className="contents">
                    {hasFacts && (
                        <ModalSection label={factsLabel || (variant === "danger" ? "You are about to delete" : "You are about to change")}>
                            <ModalRows>
                                {facts.map((f) => (
                                    <ModalKV key={f.label} icon={f.icon} tone={f.tone} label={f.label} mono={f.mono}>
                                        {f.value ?? "—"}
                                    </ModalKV>
                                ))}
                            </ModalRows>
                        </ModalSection>
                    )}

                    {message && (
                        <ModalCallout tone={v.tone} icon={messageIcon || v.icon}>
                            {message}
                        </ModalCallout>
                    )}

                    {children}

                    {steps && <ModalBullets items={steps} fill={!note && !error} />}

                    {error && (
                        <ModalCallout tone="error" icon={AlertTriangle} compact>
                            {error}
                        </ModalCallout>
                    )}

                    {note && (
                        <ModalCallout
                            tone={noteTone}
                            icon={noteIcon || (noteTone === "error" || noteTone === "warning" ? AlertTriangle : noteTone === "success" ? Check : Info)}
                            compact
                            className="mt-auto">
                            {note}
                        </ModalCallout>
                    )}
                </div>
            </ModalContent>
            <ModalFooter>
                <ModalButton data-autofocus onClick={onClose} disabled={loading}>
                    {cancelText}
                </ModalButton>
                <ModalButton variant={v.btn} onClick={onConfirm} loading={loading} className="gap-1.5">
                    {ConfirmIcon && <ConfirmIcon size={14} />}
                    {confirmText}
                </ModalButton>
            </ModalFooter>
        </ModalShell>
    );
}

export default ConfirmModal;

// ─── App dialogs: confirm / notice / prompt ───────────────────────────────────
// useAppModal(scope) replaces the browser's alert() / confirm() / prompt() on the Storage and Uploads pages.
//   const { modalElement, confirm, notify, promptText } = useAppModal("storage");   // or "uploads"
// `scope` only decides which registry entries (id + name) the three dialogs carry: storageConfirm / storageNotice / storagePrompt,
// or uploadsConfirm / uploadsNotice / uploadsPrompt. Render {modalElement} anywhere inside the page.

// Copy for the three notice tones. `steps` can be overridden per call through ctx.steps.
const NOTICE = {
    error: {
        icon: AlertTriangle,
        tone: "error",
        text: "text-error",
        title: "Something went wrong",
        badge: "Error",
        rowsLabel: "What you were doing",
        msgLabel: "What happened",
        stepsLabel: "What you can do",
        steps: ["Close this notice and try the action again.", "If it keeps failing, check the provider connection on this page."],
    },
    success: {
        icon: CheckCircle,
        tone: "success",
        text: "text-success",
        title: "Done",
        badge: "Success",
        rowsLabel: "What you did",
        msgLabel: "Result",
        stepsLabel: "What you can do next",
        steps: ["Close this notice to carry on.", "Open the Libraries page to see the result."],
    },
    info: {
        icon: Info,
        tone: "info",
        text: "text-info",
        title: "Heads up",
        badge: "Info",
        rowsLabel: "Where this came from",
        msgLabel: "Information",
        stepsLabel: "What you can do",
        steps: ["Read the information, then close this notice.", "Nothing is needed unless the message says so."],
    },
};

// Default "what you can do" lines per scope (a call can still override them with ctx.steps).
const NOTICE_STEPS = {
    uploads: {
        error: ["Close this notice and try again.", "If it keeps failing, check the target library and your connection."],
        success: ["Close this notice to carry on.", "Open the All Uploads tab to see the result."],
        info: ["Read the information, then close this notice.", "Nothing is needed unless the message says so."],
    },
};

export function useAppModal(scope = "storage") {
    // { type: 'confirm' | 'notice' | 'prompt', message, tone, ctx, resolve, inputValue }
    // ctx is optional context shown in the dialog: { action, provider, location, steps, subtitle, facts, timeline, note, confirmIcon, title, confirmText }
    const [modal, setModal] = useState(null);
    const reg = {
        confirm: DASH_MODALS[`${scope}Confirm`] || DASH_MODALS.confirm,
        notice: DASH_MODALS[`${scope}Notice`] || DASH_MODALS.confirm,
        prompt: DASH_MODALS[`${scope}Prompt`] || DASH_MODALS.confirm,
    };
    const labelId = `${scope}-app-modal-t`;

    // variant: 'warning' (default) | 'danger' — colours the dialog and its confirm button.
    const confirm = useCallback((message, variant = "warning", ctx = {}) => {
        return new Promise((resolve) => setModal({ type: "confirm", message, variant, ctx, resolve }));
    }, []);

    // tone: 'error' (default) | 'success' | 'info'
    const notify = useCallback((message, tone = "error", ctx = {}) => {
        return new Promise((resolve) => setModal({ type: "notice", message, tone, ctx, resolve }));
    }, []);

    // Resolves to the entered string, or null if cancelled — text-input
    // replacement for native window.prompt().
    const promptText = useCallback((message, defaultValue = "", ctx = {}) => {
        return new Promise((resolve) => setModal({ type: "prompt", message, ctx, resolve, inputValue: defaultValue }));
    }, []);

    function close(result) {
        if (modal?.resolve) modal.resolve(result);
        setModal(null);
    }

    function updateInputValue(value) {
        setModal((m) => (m ? { ...m, inputValue: value } : m));
    }

    let modalElement = null;
    if (modal?.type === "confirm") {
        const c = modal.ctx || {};
        modalElement = (
            <ConfirmModal
                open
                modal={reg.confirm}
                onClose={() => close(false)}
                onConfirm={() => close(true)}
                variant={modal.variant || "warning"}
                title={c.title || "Please confirm"}
                subtitle={c.subtitle}
                factsLabel={c.factsLabel}
                facts={c.facts}
                message={modal.message}
                messageIcon={c.messageIcon}
                timeline={c.timeline}
                note={c.note}
                noteTone={c.noteTone}
                confirmIcon={c.confirmIcon}
                confirmText={c.confirmText || "Confirm"}
            />
        );
    } else if (modal?.type === "notice") {
        const n = NOTICE[modal.tone] || NOTICE.error;
        const c = modal.ctx || {};
        const rows = [
            ["Action", c.action],
            ["Provider", c.provider],
            ["Location", c.location],
        ].filter(([, v]) => v);
        const scoped = NOTICE_STEPS[scope]?.[modal.tone] || NOTICE_STEPS[scope]?.error;
        const steps = (c.steps || (NOTICE_STEPS[scope] ? scoped : n.steps)).map((text) => ({ text }));
        modalElement = (
            <ModalShell modal={reg.notice} onClose={() => close(false)} labelledBy={labelId}>
                <ModalHeader id={labelId} icon={n.icon} tone={n.text} title={n.title} subtitle="Notice" badges={<ModalBadge tone={n.tone}>{n.badge}</ModalBadge>} onClose={() => close(false)} />
                <ModalContent>
                    {rows.length > 0 && (
                        <ModalSection label={n.rowsLabel}>
                            <ModalRows>
                                {rows.map(([k, v]) => (
                                    <ModalKV key={k} label={k}>
                                        {v}
                                    </ModalKV>
                                ))}
                            </ModalRows>
                        </ModalSection>
                    )}
                    <ModalSection label={n.msgLabel}>
                        <ModalCallout tone={n.tone} icon={n.icon}>
                            {modal.message}
                        </ModalCallout>
                    </ModalSection>
                    <ModalSection label={n.stepsLabel} grow>
                        <ModalBullets items={steps} fill />
                    </ModalSection>
                </ModalContent>
                <ModalFooter note="Press Esc or OK to dismiss">
                    <ModalButton data-autofocus onClick={() => close(true)}>
                        OK
                    </ModalButton>
                </ModalFooter>
            </ModalShell>
        );
    } else if (modal?.type === "prompt") {
        const c = modal.ctx || {};
        const name = modal.inputValue.trim();
        modalElement = (
            <ModalShell modal={reg.prompt} onClose={() => close(null)} labelledBy={labelId}>
                <ModalHeader id={labelId} icon={FolderPlus} tone="text-primary" title="New folder" subtitle="Created in the folder you have open" onClose={() => close(null)} />
                <ModalContent>
                    <ModalSection label="Where it will be created">
                        <ModalRows>
                            <ModalKV label="Provider" icon={Cloud} tone="text-info">
                                {c.provider || "Cloud storage"}
                            </ModalKV>
                            <ModalKV label="Inside">{c.location || "Root"}</ModalKV>
                        </ModalRows>
                    </ModalSection>
                    <ModalSection label={modal.message}>
                        <input
                            id={`${scope}-prompt-input`}
                            data-autofocus
                            type="text"
                            placeholder="Folder name"
                            value={modal.inputValue}
                            onChange={(e) => updateInputValue(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && name) close(name);
                            }}
                            className={`${MODAL_INPUT} !h-11 !border-primary/60`}
                        />
                    </ModalSection>
                    <ModalSection label="How it will look in the list">
                        <div className={`${PANEL} flex h-12 items-center gap-3 px-4`}>
                            <Folder size={16} className="shrink-0 text-info" />
                            <span className={`min-w-0 truncate text-[13px] ${name ? "text-base-content" : "text-base-content/40"}`}>{name || "Folder name"}</span>
                        </div>
                    </ModalSection>
                    <ModalCallout tone="info" compact className="mt-auto">
                        Press Enter to create. Create becomes available once a name is typed.
                    </ModalCallout>
                </ModalContent>
                <ModalFooter note={name ? `Creating “${name}” in ${c.location || "Root"}` : "Type a name to continue"}>
                    <ModalButton onClick={() => close(null)}>Cancel</ModalButton>
                    <ModalButton variant="primary" className="gap-1.5" onClick={() => close(name || null)} disabled={!name}>
                        <FolderPlus size={14} /> Create folder
                    </ModalButton>
                </ModalFooter>
            </ModalShell>
        );
    }

    return { modalElement, confirm, notify, promptText };
}

// ═══════════════════════════════════════════════════════════════════════════
// Libraries modals — used by pages/DashLibraries.jsx
// ═══════════════════════════════════════════════════════════════════════════

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtBytes(b) {
    if (!b || b === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(b) / Math.log(1024));
    return `${(b / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function fmtDate(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
    });
}

function guessType(folder) {
    const s = (folder.label + " " + folder.path).toLowerCase();
    if (s.includes("anime")) return { label: "Anime", Icon: Swords, tone: "accent", badgeClass: "badge-accent", barClass: "progress-accent", dotClass: "bg-accent" };
    if (s.includes("series") || s.includes("tv") || s.includes("show")) return { label: "TV", Icon: Tv2, tone: "info", badgeClass: "badge-info", barClass: "progress-info", dotClass: "bg-info" };
    return { label: "Movies", Icon: Film, tone: "primary", badgeClass: "badge-primary", barClass: "progress-primary", dotClass: "bg-primary" };
}

// ─── Detail Modal (view only) ─────────────────────────────────────────────────
export function LibraryDetailModal({ lib, totalSize, onClose, onEdit }) {
    if (!lib) return null;

    const { label: typeLabel, Icon, tone } = guessType(lib);
    const online = lib.status === "online";
    const pct = totalSize > 0 ? Math.min(100, Math.round(((lib.sizeBytes || 0) / totalSize) * 100)) : 0;
    const used = lib.size || fmtBytes(lib.sizeBytes);

    return (
        <ModalShell modal={DASH_MODALS.libraryDetail} onClose={onClose} labelledBy="lib-detail-t">
            <ModalHeader
                id="lib-detail-t"
                icon={Icon}
                tone={online ? TONE[tone] : "text-base-content/50"}
                title={lib.label || "Unnamed Library"}
                subtitle={<span className="font-mono">{lib.path}</span>}
                badges={
                    <>
                        <ModalBadge tone={tone}>{typeLabel}</ModalBadge>
                        {online ? (
                            <ModalBadge tone="success" icon={CheckCircle2}>
                                Online
                            </ModalBadge>
                        ) : (
                            <ModalBadge tone="error" icon={WifiOff}>
                                Offline
                            </ModalBadge>
                        )}
                    </>
                }
                onClose={onClose}
            />
            <ModalContent>
                <ModalStats
                    items={[
                        { icon: FileVideo, tone: "text-info", label: "Media files", value: (lib.fileCount ?? 0).toLocaleString() },
                        { icon: Database, tone: "text-success", label: "Storage used", value: used },
                        { icon: TrendingUp, tone: "text-warning", label: "Share of total", value: `${pct}%` },
                    ]}
                />

                <section className={`${PANEL} flex shrink-0 flex-col gap-3 px-4 py-4`}>
                    <div className="flex items-center justify-between gap-3 text-[13px]">
                        <span className="text-base-content">Disk usage share</span>
                        <span className="text-xs text-base-content/60">
                            {used} of {fmtBytes(totalSize)} total
                        </span>
                    </div>
                    <ModalMeter value={pct} tone={online ? tone : "error"} label="Disk usage share" />
                </section>

                <ModalSection label="Library" grow>
                    <ModalRows className="flex-1">
                        <ModalKV icon={FolderOpen} tone="text-primary" label="Path" mono action={<ModalCopyButton text={lib.path} label="path" />}>
                            <span title={lib.path}>{lib.path}</span>
                        </ModalKV>
                        <ModalKV icon={Icon} tone={TONE[tone]} label="Type">
                            {typeLabel}
                        </ModalKV>
                        <ModalKV icon={Server} tone={online ? "text-success" : "text-error"} label="Status">
                            <span className={online ? "text-success" : "text-error"}>{online ? "Online" : "Offline"}</span>
                        </ModalKV>
                        <ModalKV icon={Activity} label="Added">
                            {fmtDate(lib.addedAt)}
                        </ModalKV>
                    </ModalRows>
                </ModalSection>
            </ModalContent>
            <ModalFooter note="Click a library row to inspect it">
                <ModalButton onClick={onClose}>Close</ModalButton>
                <ModalButton
                    variant="primary"
                    className="gap-1.5"
                    onClick={() => {
                        onClose();
                        onEdit(lib);
                    }}>
                    <SquarePen size={14} />
                    Edit library
                </ModalButton>
            </ModalFooter>
        </ModalShell>
    );
}

// ─── Edit Modal (functional — calls PATCH /api/library/:id) ──────────────────
export function LibraryEditModal({ lib, onClose, onSaved }) {
    const [label, setLabel] = useState(lib?.label || "");
    const [path, setPath] = useState(lib?.path || "");
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState(null);

    if (!lib) return null;

    const changes = [
        label.trim() !== (lib.label || "") && { name: "Name", from: lib.label || "—", to: label.trim() || "—" },
        path.trim() !== (lib.path || "") && { name: "Path", from: lib.path || "—", to: path.trim() || "—" },
    ].filter(Boolean);
    const dirty = changes.length > 0;

    async function handleSave() {
        if (!label.trim() && !path.trim()) return;
        setSaving(true);
        setErr(null);
        try {
            const updates = {};
            if (label.trim() !== lib.label) updates.label = label.trim();
            if (path.trim() !== lib.path) updates.path = path.trim();
            if (Object.keys(updates).length === 0) {
                onClose();
                return;
            }

            await api.patch(`/api/library/${lib.id}`, updates);
            onSaved({ ...lib, ...updates });
            onClose();
        } catch (e) {
            setErr(e.message || "Save failed");
        } finally {
            setSaving(false);
        }
    }

    return (
        <ModalShell modal={DASH_MODALS.libraryEdit} onClose={onClose} busy={saving} labelledBy="lib-edit-t">
            <ModalHeader id="lib-edit-t" icon={SquarePen} tone="text-warning" title="Edit Library" subtitle={lib.label || lib.path} onClose={onClose} busy={saving} />
            <ModalContent>
                <ModalSection label="Display name">
                    <input
                        id="edit-lib-label"
                        name="label"
                        type="text"
                        data-autofocus
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        className={`${MODAL_INPUT} !h-[42px] ${label.trim() !== (lib.label || "") ? "!border-primary/60" : ""}`}
                        placeholder="e.g. My Movies"
                    />
                </ModalSection>
                <div className="flex shrink-0 flex-col gap-2">
                    <ModalSection label="Folder path">
                        <input
                            id="edit-lib-path"
                            name="path"
                            type="text"
                            value={path}
                            onChange={(e) => setPath(e.target.value)}
                            className={`${MODAL_INPUT} !h-[42px] font-mono ${path.trim() !== (lib.path || "") ? "!border-primary/60" : ""}`}
                            placeholder="e.g. D:\Media\Movies"
                        />
                    </ModalSection>
                    <p className="text-xs text-base-content/55">Must be an absolute path accessible by the server.</p>
                </div>

                <ModalStats
                    items={[
                        { icon: FileVideo, tone: "text-info", label: "Files", value: lib.fileCount?.toLocaleString?.() ?? lib.fileCount ?? "—" },
                        { icon: Database, tone: "text-success", label: "Size", value: lib.sizeBytes != null ? fmtBytes(lib.sizeBytes) : "—" },
                    ]}
                />

                {err && (
                    <ModalCallout tone="error" icon={AlertTriangle} compact className="mt-auto">
                        {err}
                    </ModalCallout>
                )}
                <ModalReview
                    changes={changes}
                    saved={[
                        { name: "Name", value: lib.label },
                        { name: "Path", value: lib.path },
                    ]}
                    className={err ? "" : "mt-auto"}
                />
            </ModalContent>
            <ModalFooter
                note={
                    dirty ? (
                        <span className="inline-flex items-center gap-1.5 text-warning">
                            <span className="size-2 rounded-full bg-warning" />
                            Unsaved changes
                        </span>
                    ) : (
                        <span className="text-base-content/60">No changes yet</span>
                    )
                }>
                <ModalButton onClick={onClose} disabled={saving}>
                    Cancel
                </ModalButton>
                <ModalButton variant="primary" className="gap-1.5" onClick={handleSave} loading={saving} loadingText="Saving…" disabled={!dirty}>
                    <Check size={14} />
                    Save changes
                </ModalButton>
            </ModalFooter>
        </ModalShell>
    );
}

// ─── Remove Confirm Modal (local libraries, and cloud libraries with `cloud`) ─
export function LibraryRemoveModal({ lib, onClose, onRemoved, cloud = false }) {
    const [removing, setRemoving] = useState(false);
    const [err, setErr] = useState(null);
    if (!lib) return null;

    async function handleRemove() {
        setRemoving(true);
        setErr(null);
        try {
            if (cloud) await storageApi.removeLibrary(lib.id);
            else await api.delete(`/api/library/${lib.id}`);
            onRemoved(lib.id);
            onClose();
        } catch (e) {
            setErr(e.message || "Remove failed");
            setRemoving(false);
        }
    }

    const where = cloud ? lib.provider || "the provider" : "disk";
    const { label: typeLabel, Icon: TypeIcon, tone } = guessType(lib);

    return (
        <ConfirmModal
            modal={cloud ? DASH_MODALS.libraryRemoveCloud : DASH_MODALS.libraryRemove}
            open
            badge={false}
            onClose={onClose}
            onConfirm={handleRemove}
            loading={removing}
            error={err}
            variant="danger"
            title={`Remove ${lib.label || "library"}?`}
            subtitle={cloud ? `${lib.provider || "Cloud"} library` : <span className="font-mono">{lib.path}</span>}
            confirmIcon={Trash2}
            confirmText="Remove library"
            timeline={[
                { icon: Layers, tone: "warning", title: "Removed", text: "The library disappears from FLUX." },
                { icon: FolderOpen, tone: "info", title: "Scanning stops", text: cloud ? "FLUX stops reading this folder." : "FLUX no longer scans this folder." },
                { icon: cloud ? Cloud : HardDrive, tone: "success", title: "Files stay safe", text: `Nothing on ${where} is deleted.` },
            ]}
            note={cloud ? `Files stay on ${where}; only the library link is removed.` : "Your media files on disk are never deleted."}
            noteTone="success">
            <ModalSection label="You are about to remove">
                <div className={`${PANEL} flex items-center gap-4 px-4 py-3`}>
                    <span className="grid size-10 shrink-0 place-items-center rounded-full border border-base-content/10 bg-base-200">
                        <TypeIcon size={17} className={TONE[tone]} />
                    </span>
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-base-content">{lib.label || "Unnamed library"}</p>
                        <p className="truncate font-mono text-xs text-base-content/55">{cloud ? `${lib.provider || "Cloud"}` : lib.path}</p>
                    </div>
                    <ModalBadge tone={tone}>{typeLabel}</ModalBadge>
                </div>
            </ModalSection>
            {cloud && (
                <ModalStats
                    items={[
                        { icon: Cloud, tone: "text-info", label: "Provider", value: lib.provider || "Cloud" },
                        { icon: Activity, tone: "text-warning", label: "Added", value: fmtDate(lib.addedAt) },
                        { icon: Layers, tone: "text-success", label: "Type", value: lib.shared ? "Shared folder" : "Cloud library" },
                    ]}
                />
            )}
            {!cloud && (
                <ModalStats
                    items={[
                        { icon: FileVideo, tone: "text-info", label: "Media files", value: (lib.fileCount ?? 0).toLocaleString() },
                        { icon: Database, tone: "text-success", label: "Storage used", value: lib.size || fmtBytes(lib.sizeBytes) },
                        {
                            icon: lib.status === "online" ? CheckCircle2 : WifiOff,
                            tone: lib.status === "online" ? "text-success" : "text-error",
                            label: "Status",
                            value: lib.status === "online" ? "Online" : "Offline",
                        },
                    ]}
                />
            )}
        </ConfirmModal>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// Storage modals — used by pages/DashStorage.jsx
// ═══════════════════════════════════════════════════════════════════════════

function EmptyState({ icon: Icon, title, hint }) {
    return (
        <div className="flex flex-col items-center justify-center gap-2 py-12 px-6 text-center">
            <div className="w-11 h-11 rounded-full bg-base-content/5 flex items-center justify-center">
                <Icon size={18} className="text-base-content/58" />
            </div>
            <p className="text-sm font-medium text-base-content/78">{title}</p>
            {hint && <p className="text-xs text-base-content/62 max-w-xs">{hint}</p>}
        </div>
    );
}

// Root-level Google Drive browse items carry a `section` tag (see
// GoogleDriveProvider.js listLibraries()) so this page can group them under
// three headers without changing the flat-array contract every other
// provider (GoFile, and gdrive itself below the root) already relies on.
const GDRIVE_SECTIONS = [
    { key: "my_drive", label: "My Drive" },
    { key: "shared_with_me", label: "Shared with me" },
    { key: "shared_drive", label: "Shared drives" },
];

function groupBySection(items) {
    const groups = { my_drive: [], shared_with_me: [], shared_drive: [] };
    for (const item of items) {
        (groups[item.section] || groups.my_drive).push(item);
    }
    return groups;
}

// Single folder row — shared by the flat list (subfolders, GoFile) and the
// grouped root-level Google Drive sections below, so both render identically.
function FolderRow({ item, onOpen, onDelete }) {
    return (
        <li className="group flex items-center">
            <button className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-4 py-3 text-left text-[13px] transition-colors hover:bg-base-content/5" onClick={() => onOpen(item)}>
                <Folder size={16} className="shrink-0 text-info" />
                <span className="truncate text-base-content">{item.name}</span>
                {item.shared && <ModalBadge tone="primary">Shared</ModalBadge>}
                {item.writable === false && <ModalBadge>Read-only</ModalBadge>}
                <ChevronRight size={14} className="ml-auto shrink-0 text-base-content/35" />
            </button>
            <button
                onClick={() => onDelete(item)}
                title="Delete folder"
                aria-label={`Delete folder ${item.name}`}
                className="mr-3 grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-base-content/50 transition-colors hover:bg-error/10 hover:text-error">
                <Trash2 size={14} />
            </button>
        </li>
    );
}

export function StorageBrowseModal({
    setBrowseProvider,
    browseProvider,
    providerName,
    breadcrumbs,
    jumpTo,
    createFolderHere,
    browsing,
    browseItems,
    openFolder,
    deleteBrowseFolder,
    importLabel,
    setImportLabel,
    importCurrentFolder,
}) {
    return (
        <ModalShell modal={DASH_MODALS.storageBrowse} onClose={() => setBrowseProvider(null)} labelledBy="storage-browse-t">
            <ModalHeader
                id="storage-browse-t"
                icon={browseProvider === "local" ? HardDrive : Cloud}
                tone={browseProvider === "gofile" ? "text-accent" : "text-info"}
                title={`Browse ${providerName(browseProvider)}`}
                subtitle="Pick a folder to import as a library"
                onClose={() => setBrowseProvider(null)}
            />
            <ModalContent>
                {/* Breadcrumbs + new folder */}
                <div className="flex shrink-0 items-stretch gap-3">
                    <nav aria-label="Folder path" className={`${PANEL} flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-1 px-2 text-[13px]`}>
                        <button
                            className={`cursor-pointer rounded-md px-2.5 py-1.5 transition-colors ${breadcrumbs.length === 0 ? "bg-base-200 text-base-content" : "text-base-content/65 hover:bg-base-content/10 hover:text-base-content"}`}
                            onClick={() => jumpTo(-1)}>
                            Root
                        </button>
                        {breadcrumbs.map((b, i) => (
                            <span key={b.ref} className="flex items-center gap-1">
                                <ChevronRight size={12} className="text-base-content/40" />
                                <button
                                    className={`cursor-pointer rounded-md px-2.5 py-1.5 transition-colors ${i === breadcrumbs.length - 1 ? "bg-base-200 text-base-content" : "text-base-content/65 hover:bg-base-content/10 hover:text-base-content"}`}
                                    onClick={() => jumpTo(i)}>
                                    {b.name}
                                </button>
                            </span>
                        ))}
                    </nav>
                    <ModalButton className="h-auto min-h-11 gap-2 px-4" onClick={createFolderHere} title={breadcrumbs.length === 0 ? "Open a folder first" : "New folder"}>
                        <FolderPlus size={14} /> {breadcrumbs.length === 0 ? "Open a folder first" : "New folder"}
                    </ModalButton>
                </div>

                <ModalSection label="Folders" hint={browsing ? "loading" : `${browseItems.length} here`} grow>
                    <div className={`${PANEL} min-h-0 flex-1 overflow-y-auto`}>
                        {browsing ? (
                            <div className="space-y-1 p-2">
                                {[0, 1, 2, 3].map((i) => (
                                    <div key={i} className="h-11 animate-pulse rounded-md bg-base-content/5" style={{ animationDelay: `${i * 100}ms` }} />
                                ))}
                            </div>
                        ) : browseItems.length === 0 ? (
                            <EmptyState icon={Inbox} title="No subfolders here" hint="Use New folder to make one, or import this folder as it is." />
                        ) : browseProvider === "gdrive" && breadcrumbs.length === 0 ? (
                            // Root of a Google Drive browse — group into My Drive / Shared with
                            // me / Shared drives per GDRIVE_SECTIONS. Any deeper level is a
                            // normal single folder listing and falls through to the flat branch.
                            (() => {
                                const groups = groupBySection(browseItems);
                                return (
                                    <div className="divide-y divide-base-content/10">
                                        {GDRIVE_SECTIONS.map(({ key, label }) => (
                                            <div key={key}>
                                                <p className="bg-base-content/5 px-4 py-2 text-xs text-base-content/65">{label}</p>
                                                {groups[key].length === 0 ? (
                                                    <p className="px-4 py-3.5 text-[13px] text-base-content/50">
                                                        {key === "shared_drive" ? "No Shared Drives available." : key === "shared_with_me" ? "No folders shared with you." : "Empty."}
                                                    </p>
                                                ) : (
                                                    <ul className="divide-y divide-base-content/10">
                                                        {groups[key].map((item) => (
                                                            <FolderRow key={item.ref} item={item} onOpen={openFolder} onDelete={deleteBrowseFolder} />
                                                        ))}
                                                    </ul>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                );
                            })()
                        ) : (
                            <ul className="divide-y divide-base-content/10">
                                {browseItems.map((item) => (
                                    <FolderRow key={item.ref} item={item} onOpen={openFolder} onDelete={deleteBrowseFolder} />
                                ))}
                            </ul>
                        )}
                    </div>
                </ModalSection>

                {breadcrumbs.length > 0 && breadcrumbs[breadcrumbs.length - 1]?.writable === false && (
                    <ModalCallout tone="warning" icon={AlertTriangle} compact>
                        Read-only — you can import this folder, but FLUX won't be able to upload into it.
                    </ModalCallout>
                )}

                <ModalSection label="Library label">
                    <input
                        id="storage-import-label"
                        type="text"
                        placeholder="Library label"
                        className={`${MODAL_INPUT} !h-11 ${importLabel ? "!border-primary/60" : ""}`}
                        value={importLabel}
                        onChange={(e) => setImportLabel(e.target.value)}
                    />
                </ModalSection>
            </ModalContent>
            <ModalFooter note={breadcrumbs.length > 0 ? `Importing “${breadcrumbs[breadcrumbs.length - 1].name}”` : "Open a folder to enable import"}>
                <ModalButton onClick={() => setBrowseProvider(null)}>Cancel</ModalButton>
                <ModalButton variant="primary" className="gap-1.5" disabled={breadcrumbs.length === 0} onClick={importCurrentFolder}>
                    <FolderPlus size={14} /> Import this folder
                </ModalButton>
            </ModalFooter>
        </ModalShell>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// Media modals — used by pages/DashMedia.jsx
// ═══════════════════════════════════════════════════════════════════════════

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mediaFmtBytes(b) {
    if (!b || b === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(b) / Math.log(1024));
    return `${(b / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function fmtDuration(seconds) {
    if (!seconds) return "—";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

// Generic "all metadata" rows: turns a flat ffprobe-ish object into label / value pairs.
const humanize = (k) =>
    k
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .replace(/^./, (c) => c.toUpperCase());

function fmtMeta(k, v) {
    if (typeof v === "boolean") return v ? "Yes" : "No";
    if (typeof v === "number") {
        if (/bytes$|^size$/i.test(k)) return mediaFmtBytes(v);
        if (/bps$|bitrate/i.test(k)) return `${(v / 1_000_000).toFixed(2)} Mbps`;
        if (/seconds$|^duration$/i.test(k)) return fmtDuration(v);
        return v.toLocaleString();
    }
    return String(v);
}

function metaRows(obj, prefix = "") {
    if (!obj || typeof obj !== "object") return [];
    const out = [];
    for (const [k, v] of Object.entries(obj)) {
        if (v == null || v === "") continue;
        const label = prefix ? `${prefix} · ${humanize(k)}` : humanize(k);
        if (Array.isArray(v)) {
            if (v.every((x) => x == null || typeof x !== "object")) out.push({ label, value: v.join(", ") });
            else v.forEach((x, i) => out.push(...metaRows(x, `${label} ${i + 1}`)));
        } else if (typeof v === "object") out.push(...metaRows(v, label));
        else out.push({ label, value: fmtMeta(k, v) });
    }
    return out.filter((r) => r.value !== "");
}

// ─── Design tokens ────────────────────────────────────────────────────────────

const TYPE_CONFIG = {
    movie: {
        color: "oklch(var(--p))",
        bgClass: "bg-primary/12 text-primary",
        borderClass: "border-primary/20",
        Icon: Film,
    },
    series: {
        color: "oklch(var(--in))",
        bgClass: "bg-info/12 text-info",
        borderClass: "border-info/20",
        Icon: Tv2,
    },
    anime: {
        color: "oklch(var(--a))",
        bgClass: "bg-accent/12 text-accent",
        borderClass: "border-accent/20",
        Icon: Swords,
    },
};

// ─── Modals (shared shell, header, footer and atoms: the Primitives section above) ──

const TYPE_TONE = { movie: "primary", series: "info", anime: "accent" };

const TYPE_LABEL = { movie: "Movie", series: "Series", anime: "Anime" };

function PosterThumb({ src, Icon, className = "h-14 w-10" }) {
    return (
        <div className={`grid ${className} shrink-0 place-items-center overflow-hidden rounded-md border border-base-content/15 bg-base-300`}>
            {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <Icon size={16} className="text-base-content/40" />}
        </div>
    );
}

const INPUT_LG = `${MODAL_INPUT} !h-[42px]`;

// ─── Edit Modal ───────────────────────────────────────────────────────────────

export function MediaEditModal({ media, onClose, onSave, isPending, error }) {
    const [title, setTitle] = useState(media._title || "");
    const [year, setYear] = useState(media._year || "");
    const [type, setType] = useState(media._type || "movie");
    const [permission, setPermission] = useState(media._permission !== false);
    const TypeIcon = (TYPE_CONFIG[media._type] || TYPE_CONFIG.movie).Icon;

    const handleSubmit = () => {
        onSave({ id: media._id, payload: { title, year: Number(year), type, permission } });
    };

    const access = (v) => (v ? "Normal" : "Restricted");
    const changes = [
        title !== (media._title || "") && { name: "Title", from: media._title || "—", to: title || "—" },
        String(year) !== String(media._year || "") && { name: "Year", from: media._year || "—", to: year || "—" },
        type !== (media._type || "movie") && { name: "Type", from: TYPE_LABEL[media._type || "movie"], to: TYPE_LABEL[type] },
        permission !== (media._permission !== false) && { name: "Access", from: access(media._permission !== false), to: access(permission) },
    ].filter(Boolean);
    const dirty = changes.length > 0;
    const edited = (a, b) => (String(a) !== String(b) ? "!border-primary/60" : "");

    return (
        <ModalShell modal={DASH_MODALS.mediaEdit} onClose={onClose} busy={isPending} labelledBy="media-edit-t">
            <ModalHeader
                id="media-edit-t"
                avatar={<PosterThumb src={media._poster} Icon={TypeIcon} className="h-[60px] w-[42px]" />}
                title="Edit metadata"
                subtitle={<span className="font-mono">{media._filename}</span>}
                badges={
                    <ModalBadge tone={TYPE_TONE[media._type] || "primary"} icon={TypeIcon}>
                        {media._typeLabel}
                    </ModalBadge>
                }
                onClose={onClose}
                busy={isPending}
            />
            <ModalContent>
                <ModalSection label="Title">
                    <input
                        id="media-edit-title"
                        type="text"
                        data-autofocus
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        className={`${INPUT_LG} ${edited(title, media._title || "")}`}
                        placeholder="Media title…"
                    />
                </ModalSection>

                <div className="grid shrink-0 grid-cols-1 items-start gap-4 sm:grid-cols-2">
                    <ModalSection label="Year">
                        <input
                            id="media-edit-year"
                            type="number"
                            value={year}
                            onChange={(e) => setYear(e.target.value)}
                            className={`${INPUT_LG} ${edited(year, media._year || "")}`}
                            placeholder="2024"
                            min={1900}
                            max={2099}
                        />
                    </ModalSection>
                    <ModalSection label="Type">
                        <ModalSegmented
                            label="Type"
                            value={type}
                            onChange={setType}
                            options={[
                                { value: "movie", label: "Movie", icon: Film },
                                { value: "series", label: "Series", icon: Tv2 },
                                { value: "anime", label: "Anime", icon: Swords },
                            ]}
                        />
                    </ModalSection>
                </div>

                {/* permission=true → Normal (allowed), permission=false → Restricted.
                    The switch is "Restrict access": ON means RESTRICTED (permission=false). */}
                <ModalSection label="Access & identity">
                    <div className={`${PANEL} divide-y divide-base-content/10 overflow-hidden`}>
                        <label className="flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-base-content/5">
                            <span className="grid size-9 shrink-0 place-items-center rounded-full border border-base-content/10 bg-base-200">
                                {permission ? <Shield size={16} className="text-success" /> : <ShieldOff size={16} className="text-error" />}
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block text-[13px] font-medium text-base-content">{permission ? "Normal access" : "Restricted"}</span>
                                <span className="block text-xs text-base-content/60">
                                    {permission ? "Media is accessible. Turn on to restrict it." : "Access is restricted. Turn off to allow it."}
                                </span>
                            </span>
                            <span className="text-xs text-base-content/60">{permission ? "Off" : "On"}</span>
                            <ModalToggle value={!permission} onChange={(v) => setPermission(!v)} label="Restrict access" />
                        </label>
                        <div className="flex min-h-12 items-center gap-4 px-4 py-2">
                            <span className="w-28 shrink-0 text-xs text-base-content/60">Media ID</span>
                            <span className="min-w-0 flex-1 truncate font-mono text-xs text-base-content/90">{media._id}</span>
                            <ModalCopyButton text={media._id} label="media ID" />
                        </div>
                    </div>
                </ModalSection>

                {error && (
                    <ModalCallout tone="error" icon={AlertTriangle} compact className="mt-auto">
                        {error.message || "Failed to update media"}
                    </ModalCallout>
                )}
                <ModalReview
                    changes={changes}
                    saved={[
                        { name: "Title", value: media._title },
                        { name: "Year", value: media._year },
                        { name: "Type", value: TYPE_LABEL[media._type || "movie"] },
                        { name: "Access", value: access(media._permission !== false) },
                    ]}
                    className={error ? "" : "mt-auto"}
                />
            </ModalContent>
            <ModalFooter
                note={
                    dirty ? (
                        <span className="inline-flex items-center gap-1.5 text-warning">
                            <span className="size-2 rounded-full bg-warning" />
                            Unsaved changes
                        </span>
                    ) : (
                        <span className="text-base-content/60">No changes yet</span>
                    )
                }>
                <ModalButton onClick={onClose} disabled={isPending}>
                    Cancel
                </ModalButton>
                <ModalButton variant="primary" className="gap-1.5" onClick={handleSubmit} loading={isPending} loadingText="Saving…" disabled={!dirty}>
                    <Check size={14} />
                    Save changes
                </ModalButton>
            </ModalFooter>
        </ModalShell>
    );
}

// ─── Details Modal ────────────────────────────────────────────────────────────

export function MediaDetailsModal({ media, onClose }) {
    const [tab, setTab] = useState("overview");
    const linkDest = media._type === "movie" ? `/player/${media._id}` : `/series/${media._id}`;
    const config = TYPE_CONFIG[media._type] || TYPE_CONFIG.movie;
    const TypeIcon = config.Icon;

    // Fetches ffprobe-backed mediaInfo lazily on modal open — ONLY for movies.
    // Series/anime media._id is a synthetic group id (e.g. "series:series:wednesday"),
    // not a real scanned-file id, so GET /api/metadata/:id would always 404 for
    // them — findById() only matches real file ids. For series/anime we already
    // have everything we need on `media` itself (res/vcodec/acodec/_size/_duration
    // were merged in from the bulk /api/mediainfo fetch back in the table's
    // processItem, aggregated across all episodes there).
    const { data: fullData } = useQuery({
        queryKey: ["media-detail", media._id],
        queryFn: () => api.get(`/api/metadata/${media._id}`),
        staleTime: 1000 * 60 * 10,
        enabled: media._type === "movie",
    });

    // mediaInfoStore now returns an organized shape: { container, video, audioTracks, subtitleTracks }.
    // Cover-art "video" streams (embedded poster images) are already filtered
    // out server-side when video is picked, so no client-side filtering needed here.
    const mediaInfo = media._type === "movie" ? fullData?.mediaInfo : null;
    const video = mediaInfo?.video || null;
    const primaryAudio = mediaInfo?.audioTracks?.[0] || null;

    // Movies: prefer freshly-fetched single-file data, fall back to row data.
    // Series/anime: row data IS the data (already aggregated across episodes
    // back in the table's processItem — see _resolution/_fps/_bitrate/etc).
    const realRes = video?.height ? (video.height >= 2000 ? "4K" : video.height >= 1000 ? "1080p" : video.height >= 700 ? "720p" : "480p") : media.res;

    const realDuration = mediaInfo?.container?.durationSeconds || (media.metadata?.runtime ? media.metadata.runtime * 60 : media._duration);
    const realSize = mediaInfo?.container?.sizeBytes || media._size;
    const realAdded = media.metadata?.date || media._added;
    const realResolution = video?.resolution || media._resolution;
    const realFps = video?.frameRate || media._fps; // already a formatted string like "23.976 fps" — no parsing needed
    const realBitrate = mediaInfo?.container?.bitrateBps || media._bitrate;
    const realChannels = primaryAudio?.channels || media._audioChannels;
    const realAudioLang = primaryAudio?.language || media._audioLang;

    const linkUrl = typeof window !== "undefined" ? `${window.location.origin}${linkDest}` : linkDest;
    const tone = TYPE_TONE[media._type] || "primary";

    const specs = [
        { label: "Resolution", icon: Monitor, tone: "text-info", value: realResolution },
        { label: "Frame rate", icon: Gauge, tone: "text-success", value: realFps || null },
        { label: "Bitrate", icon: Database, tone: "text-warning", value: realBitrate ? `${(realBitrate / 1_000_000).toFixed(1)} Mbps` : null },
        { label: "Audio", icon: Volume2, tone: "text-accent", value: realChannels ? `${realChannels}ch${realAudioLang ? ` · ${realAudioLang}` : ""}` : null },
    ].filter((x) => x.value);

    const monoRow = (icon, label, value) => (
        <ModalKV icon={icon} label={label} mono action={value ? <ModalCopyButton text={value} label={label.toLowerCase()} /> : null}>
            <span title={value}>{value || "—"}</span>
        </ModalKV>
    );

    const techGroups = [
        {
            label: "Summary",
            rows: [
                realResolution && { label: "Resolution", value: realResolution },
                realRes && { label: "Quality", value: realRes },
                realFps && { label: "Frame rate", value: realFps },
                realBitrate && { label: "Bitrate", value: `${(realBitrate / 1_000_000).toFixed(2)} Mbps` },
                realDuration && { label: "Duration", value: fmtDuration(realDuration) },
                realSize && { label: "Size", value: mediaFmtBytes(realSize) },
                media.vcodec && { label: "Video codec", value: media.vcodec },
                media.acodec && { label: "Audio codec", value: media.acodec },
                realChannels && { label: "Audio", value: `${realChannels}ch${realAudioLang ? ` · ${realAudioLang}` : ""}` },
            ].filter(Boolean),
        },
        { label: "Container", rows: metaRows(mediaInfo?.container) },
        { label: "Video stream", rows: metaRows(mediaInfo?.video) },
        ...(mediaInfo?.audioTracks || []).map((t, i) => ({ label: `Audio track ${i + 1}`, rows: metaRows(t) })),
        ...(mediaInfo?.subtitleTracks || []).map((t, i) => ({ label: `Subtitle track ${i + 1}`, rows: metaRows(t) })),
    ].filter((g) => g.rows.length > 0);

    const genres = media.metadata?.genres || [];
    const cast = media.metadata?.cast || [];
    const audioCount = mediaInfo?.audioTracks?.length;
    const subCount = mediaInfo?.subtitleTracks?.length;

    return (
        <ModalShell modal={DASH_MODALS.mediaDetails} onClose={onClose} labelledBy="media-details-t">
            <ModalHeader
                id="media-details-t"
                avatar={<PosterThumb src={media._poster} Icon={TypeIcon} />}
                title={media._title}
                subtitle={<span className="font-mono">{media._filename}</span>}
                badges={
                    <>
                        <ModalBadge tone={tone} icon={TypeIcon}>
                            {media._typeLabel}
                        </ModalBadge>
                        {media._year && <ModalBadge>{media._year}</ModalBadge>}
                        {realRes && <ModalBadge tone={realRes === "4K" ? "warning" : realRes === "1080p" ? "success" : "info"}>{realRes}</ModalBadge>}
                        {media._permission ? (
                            <ModalBadge tone="success" icon={Shield}>
                                Normal
                            </ModalBadge>
                        ) : (
                            <ModalBadge tone="error" icon={ShieldOff}>
                                Restricted
                            </ModalBadge>
                        )}
                    </>
                }
                onClose={onClose}
            />
            <ModalTabs
                value={tab}
                onChange={setTab}
                tabs={[
                    { id: "overview", label: "Overview", icon: Info },
                    { id: "technical", label: "Technical", icon: Monitor },
                    { id: "file", label: "File", icon: FolderOpen },
                ]}
            />
            <ModalContent>
                {tab === "overview" && (
                    <div role="tabpanel" id="panel-overview" aria-labelledby="tab-overview" className="flex shrink-0 flex-col gap-4">
                        <ModalStats
                            items={[
                                { icon: Calendar, tone: "text-info", label: "Year", value: media._year || "—" },
                                { icon: Star, tone: "text-warning", label: "Quality", value: realRes ? `${realRes}${video ? ` · ${video.width}×${video.height}` : ""}` : "—" },
                                { icon: Clock, tone: "text-accent", label: "Duration", value: fmtDuration(realDuration) },
                                { icon: HardDrive, tone: "text-success", label: "Size", value: mediaFmtBytes(realSize) },
                            ]}
                        />

                        <ModalSection label="Overview">
                            <div className={`${PANEL} flex flex-col gap-2 p-4`}>
                                {media.metadata?.overview ? (
                                    <>
                                        {media.metadata?.tagline && <p className="text-xs italic text-base-content/60">“{media.metadata.tagline}”</p>}
                                        <p className="text-[13px] leading-relaxed text-base-content/90">{media.metadata.overview}</p>
                                    </>
                                ) : (
                                    <p className="flex items-center gap-2 text-[13px] text-base-content/55">
                                        <Info size={15} className="shrink-0 text-info" />
                                        No description yet. Metadata comes from TMDB once this title is matched.
                                    </p>
                                )}
                            </div>
                        </ModalSection>

                        <ModalSection label="Genres">
                            {genres.length > 0 ? (
                                <div className="flex flex-wrap gap-2">
                                    {genres.map((g) => (
                                        <ModalBadge key={g} tone="primary">
                                            {g}
                                        </ModalBadge>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-[13px] text-base-content/50">No genres yet.</p>
                            )}
                        </ModalSection>
                    </div>
                )}

                {tab === "technical" && (
                    <div role="tabpanel" id="panel-technical" aria-labelledby="tab-technical" className="flex flex-1 flex-col gap-4">
                        {techGroups.length === 0 ? (
                            <ModalCallout tone="info" compact>
                                No technical details available for this title yet.
                            </ModalCallout>
                        ) : (
                            <div className={`${PANEL} overflow-hidden`}>
                                <table className="w-full table-fixed border-collapse text-left text-[13px]">
                                    <thead>
                                        <tr className="border-b border-base-content/10 bg-base-content/5 text-xs text-base-content/65">
                                            <th className="w-2/5 px-4 py-2.5 font-medium">Property</th>
                                            <th className="px-4 py-2.5 font-medium">Value</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {techGroups.map((g) => (
                                            <Fragment key={g.label}>
                                                <tr className="border-y border-base-content/10 bg-base-200/60">
                                                    <td colSpan={2} className="px-4 py-2 text-xs font-medium uppercase tracking-wider text-base-content/60">
                                                        {g.label}
                                                    </td>
                                                </tr>
                                                {g.rows.map((r) => (
                                                    <tr key={`${g.label}-${r.label}`} className="border-b border-base-content/10 last:border-b-0">
                                                        <td className="px-4 py-2.5 align-top text-xs text-base-content/60">{r.label}</td>
                                                        <td className="break-words px-4 py-2.5 align-top text-base-content tabular-nums">{r.value}</td>
                                                    </tr>
                                                ))}
                                            </Fragment>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {tab === "file" && (
                    <div role="tabpanel" id="panel-file" aria-labelledby="tab-file" className="flex shrink-0 flex-col gap-4">
                        <ModalSection label="File information">
                            <ModalRows>
                                <ModalKV icon={FolderOpen} tone="text-primary" label="Library">
                                    {media._library || "—"}
                                </ModalKV>
                                <ModalKV icon={Calendar} tone="text-info" label="Added">
                                    {fmtDate(realAdded)}
                                </ModalKV>
                                {media.metadata?.rating && (
                                    <ModalKV icon={Star} tone="text-warning" label="TMDB rating">
                                        <span className="tabular-nums">{media.metadata.rating}</span>
                                    </ModalKV>
                                )}
                                {media.metadata?.status && (
                                    <ModalKV icon={Info} label="Status">
                                        {media.metadata.status}
                                    </ModalKV>
                                )}
                                {media.metadata?.language && (
                                    <ModalKV icon={Languages} label="Language">
                                        {media.metadata.language.toUpperCase()}
                                    </ModalKV>
                                )}
                                <ModalKV icon={media._permission ? Shield : ShieldOff} tone={media._permission ? "text-success" : "text-error"} label="Access">
                                    <span className={media._permission ? "text-success" : "text-error"}>{media._permission ? "Normal" : "Restricted"}</span>
                                </ModalKV>
                            </ModalRows>
                        </ModalSection>

                        <ModalSection label="Links & IDs">
                            <ModalRows>
                                {monoRow(Play, "Player link", linkUrl)}
                                {monoRow(FolderOpen, "File path", media._path)}
                                {monoRow(Database, "Media ID", media._id)}
                            </ModalRows>
                        </ModalSection>
                    </div>
                )}
            </ModalContent>
            <ModalFooter note="Read only">
                <ModalButton onClick={onClose}>Close</ModalButton>
                <Link to={linkDest} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-primary gap-1.5 rounded-md border border-primary hover:brightness-110 [--depth:0] [--noise:0]">
                    <Play size={14} />
                    Play now
                </Link>
            </ModalFooter>
        </ModalShell>
    );
}

// ─── Delete Modal ─────────────────────────────────────────────────────────────

export function MediaDeleteModal({ media, onClose, onConfirm, isPending, error }) {
    const TypeIcon = (TYPE_CONFIG[media._type] || TYPE_CONFIG.movie).Icon;
    return (
        <ConfirmModal
            modal={DASH_MODALS.mediaDelete}
            open
            badge={false}
            onClose={onClose}
            onConfirm={() => onConfirm(media._id)}
            loading={isPending}
            error={error ? error.message || "Failed to delete" : null}
            variant="danger"
            title={`Delete ${media._title}?`}
            subtitle={<span className="font-mono">{media._filename}</span>}
            confirmIcon={Trash2}
            confirmText="Delete media"
            timeline={[
                { icon: Database, tone: "text-error", title: "Always", text: "This entry is removed from the database." },
                { icon: AlertTriangle, tone: "text-warning", title: "Depends on server settings", text: "The physical file may also be removed." },
            ]}
            note="This action cannot be undone."
            noteTone="error">
            <ModalSection label="You are about to delete">
                <div className={`${PANEL} flex items-center gap-4 px-4 py-3`}>
                    <PosterThumb src={media._poster} Icon={TypeIcon} />
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-base-content">{media._title}</p>
                        <p className="truncate font-mono text-xs text-base-content/55">{media._filename}</p>
                    </div>
                    <ModalBadge tone={TYPE_TONE[media._type] || "primary"} icon={TypeIcon}>
                        {media._typeLabel}
                    </ModalBadge>
                </div>
            </ModalSection>
            <ModalStats
                items={[
                    { icon: Calendar, tone: "text-info", label: "Year", value: media._year || "—" },
                    { icon: HardDrive, tone: "text-success", label: "Size", value: mediaFmtBytes(media._size) },
                    { icon: FolderOpen, tone: "text-primary", label: "Library", value: media._library || "—" },
                ]}
            />
        </ConfirmModal>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// Users modals — used by pages/DashUsers.jsx
// ═══════════════════════════════════════════════════════════════════════════

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtRel(val) {
    if (!val) return "—";
    const ms = typeof val === "number" ? val : new Date(val).getTime();
    if (isNaN(ms)) return "—";
    const s = Math.floor((Date.now() - ms) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
}

function usersFmtDate(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function fmtDateShort(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function deviceIcon(ua = "") {
    if (/ipad|tablet/i.test(ua)) return <Monitor size={13} />; // also matches deviceType "tablet" / "mobile"
    if (/mobile|android|iphone/i.test(ua)) return <Smartphone size={13} />;
    return <Globe size={13} />;
}

function isExpired(u) {
    return u?.accessType === "temporary" && u?.accessExpiresAt && Date.now() > new Date(u.accessExpiresAt);
}

// ─── Modal helpers (design rules: MODAL_DESIGN_GUIDE.md) ──────────────────────

const STATUS_META = {
    approved: { icon: CheckCircle, tone: "success", label: "Approved" },
    pending: { icon: Clock, tone: "warning", label: "Pending" },
    rejected: { icon: XCircle, tone: "error", label: "Rejected" },
    blocked: { icon: Ban, tone: "error", label: "Blocked" },
};

const cap = (v) => v.charAt(0).toUpperCase() + v.slice(1);

function StatusChip({ user }) {
    const m = user.deletedAt ? { icon: Trash2, tone: "warning", label: "Pending deletion" } : (STATUS_META[user.status] ?? { icon: Clock, tone: "neutral", label: cap(user.status || "unknown") });
    return (
        <ModalBadge tone={m.tone} icon={m.icon}>
            {m.label}
        </ModalBadge>
    );
}

// Tinted icon tile palette (same idea as StatCard: text-X on bg-X/10). Colour carries meaning, not decoration.
const TILE = {
    "text-primary": "bg-primary/10",
    "text-success": "bg-success/10",
    "text-warning": "bg-warning/10",
    "text-error": "bg-error/10",
    "text-info": "bg-info/10",
    "text-accent": "bg-accent/10",
};

function ChoiceCard({ on, onClick, icon: Icon, tone = "text-primary", border = "border-primary", title, desc, disabled, vertical = false }) {
    return (
        <button
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={onClick}
            className={`card border relative cursor-pointer rounded-md bg-base-100 text-left outline-0! transition-colors hover:bg-base-content/5 focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 ${on ? `${border} bg-base-content/5` : "border-base-content/10"}`}>
            <span className={`card-body gap-1.5 p-4 ${vertical ? "items-center justify-center text-center" : "flex-row items-center gap-3"}`}>
                <span className={`grid shrink-0 place-items-center rounded-full h-10 w-10 ${TILE[tone] ?? "bg-base-300"} ${tone}`}>
                    <Icon size={vertical ? 21 : 19} />
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-medium text-base-content">{title}</span>
                    <span className="block text-xs leading-snug text-base-content/70">{desc}</span>
                </span>
                {on && <CheckCircle size={16} className={`shrink-0 ${vertical ? "absolute right-2.5 top-2.5" : ""} ${tone}`} />}
            </span>
        </button>
    );
}

function SettingRow({ icon: Icon, tone = "text-base-content/70", title, desc, right, children }) {
    return (
        <div className="card border shrink-0 rounded-md border-base-content/10 bg-base-100">
            <div className="card-body gap-3 px-4 py-3">
                <div className="flex items-center gap-3">
                    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${TILE[tone] ?? "bg-base-300"} ${tone}`}>
                        <Icon size={18} />
                    </span>
                    <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-medium text-base-content">{title}</p>
                        <p className="text-xs leading-snug text-base-content/70">{desc}</p>
                    </div>
                    {right}
                </div>
                {children}
            </div>
        </div>
    );
}

// Overview primitives: a titled card holding label / value rows, like a spec sheet.
function DetailCard({ icon: Icon, title, children }) {
    return (
        <section className="flex min-h-0 flex-col overflow-hidden rounded-md border border-base-content/10 bg-base-100">
            <h3 className="flex items-center gap-2 border-b border-base-content/10 bg-base-content/5 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-base-content/60">
                <Icon size={13} className="text-primary" />
                {title}
            </h3>
            <dl className="flex flex-1 flex-col divide-y divide-base-content/10">{children}</dl>
        </section>
    );
}

function DetailRow({ icon: Icon, tone = "text-base-content/50", label, children }) {
    return (
        <div className="flex min-h-11 items-center justify-between gap-4 px-4 py-2 md:flex-1">
            <dt className="flex shrink-0 items-center gap-2 text-xs text-base-content/60">
                <Icon size={14} className={tone} />
                {label}
            </dt>
            <dd className="flex min-w-0 items-center justify-end gap-2 text-[13px] font-medium text-base-content">{children}</dd>
        </div>
    );
}

function CopyButton({ text, label }) {
    const [done, setDone] = useState(false);
    async function copy() {
        try {
            if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
            else {
                // plain-http LAN addresses have no navigator.clipboard
                const ta = document.createElement("textarea");
                ta.value = text;
                ta.style.position = "fixed";
                ta.style.opacity = "0";
                document.body.appendChild(ta);
                ta.select();
                document.execCommand("copy");
                document.body.removeChild(ta);
            }
            setDone(true);
            setTimeout(() => setDone(false), 1400);
        } catch {
            /* ignore */
        }
    }
    return (
        <button
            type="button"
            onClick={copy}
            aria-label={done ? "Copied" : `Copy ${label}`}
            title={done ? "Copied" : `Copy ${label}`}
            className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-base-content/50 transition-colors hover:bg-base-content/10 hover:text-base-content">
            {done ? <Check size={13} className="text-success" /> : <Copy size={13} />}
        </button>
    );
}

function HeaderMetric({ label, value }) {
    return (
        <div className="stat grid-rows-2 gap-0 px-4 py-0">
            <div className="stat-value row-start-1 text-sm font-medium tabular-nums text-base-content">{value}</div>
            <div className="stat-title row-start-2 text-[11px]">{label}</div>
        </div>
    );
}

// ─── DETAILS ──────────────────────────────────────────────────────────────────

export function UserInfoModal({ user, onClose }) {
    // Admins get a privacy-safe DEVICE SUMMARY (actual machines, repeat logins merged). They cannot log a user's
    // devices out; owners do that themselves in Settings → Profile → Devices.
    const [tab, setTab] = useState("overview");
    const [devices, setDevices] = useState([]);
    const [summary, setSummary] = useState({ lastIp: "", registeredDevices: 0, activeSessions: 0 });
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (!user) return;
        setTab("overview");
        setDevices([]);
        setFailed(false);
        setLoading(true);
        dashApi
            .userSessions(user.id)
            .then((d) => {
                setDevices(d?.devices ?? []);
                setSummary({ lastIp: d?.lastIp || "", registeredDevices: d?.registeredDevices ?? 0, activeSessions: d?.activeSessions ?? 0 });
            })
            .catch(() => setFailed(true))
            .finally(() => setLoading(false));
    }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!user) return null;

    const expired = isExpired(user);
    const lastIp = user.lastIp || summary.lastIp || "";
    const lastMs = devices.length ? Math.max(...devices.map((d) => new Date(d.lastActiveAt || 0).getTime())) : user.lastLoginAt ? new Date(user.lastLoginAt).getTime() : null;
    const deleting = !!user.deletedAt;
    const daysLeft = user.purgeAt ? Math.max(0, Math.ceil((new Date(user.purgeAt).getTime() - Date.now()) / 86400000)) : null;
    const delStart = user.deletedAt ? new Date(user.deletedAt).getTime() : null;
    const delEnd = user.purgeAt ? new Date(user.purgeAt).getTime() : null;
    const delPct = delStart && delEnd && delEnd > delStart ? Math.min(100, Math.max(0, Math.round(((Date.now() - delStart) / (delEnd - delStart)) * 100))) : 0;
    const accessText = expired ? `Expired ${usersFmtDate(user.accessExpiresAt)}` : user.accessType === "temporary" ? `Temporary · ${usersFmtDate(user.accessExpiresAt)}` : "Permanent";
    const deviceCount = loading ? "…" : summary.registeredDevices || (user._count?.devices ?? 0);

    return (
        <ModalShell modal={DASH_MODALS.userInfo} onClose={onClose} labelledBy="um-info-t">
            <ModalHeader
                id="um-info-t"
                avatar={<ModalAvatar name={user.name || user.email} src={user.avatar} className="w-14" ring="border-primary" />}
                title={user.name || "Unnamed"}
                subtitle={user.email}
                badges={
                    <>
                        <ModalBadge tone={user.role === "admin" ? "primary" : "info"} icon={user.role === "admin" ? Crown : User}>
                            {user.role === "admin" ? "Admin" : "User"}
                        </ModalBadge>
                        <StatusChip user={user} />
                    </>
                }
                right={
                    <div className="stats hidden bg-transparent md:inline-grid">
                        <HeaderMetric label="Devices" value={deviceCount} />
                        <HeaderMetric label="Last seen" value={lastMs ? fmtRel(lastMs) : "—"} />
                        <HeaderMetric label="Joined" value={user.createdAt ? usersFmtDate(user.createdAt) : "—"} />
                    </div>
                }
                onClose={onClose}
            />
            <ModalTabs
                value={tab}
                onChange={setTab}
                tabs={[
                    { id: "overview", label: "Overview", icon: User },
                    { id: "devices", label: "Devices", icon: Monitor, count: loading ? null : devices.length },
                ]}
            />
            <PanelBody bordered={false}>
                {tab === "overview" && (
                    <div role="tabpanel" id="panel-overview" aria-labelledby="tab-overview" className="flex min-h-0 flex-1 flex-col gap-2.5">
                        {deleting && (
                            <div className="card border rounded-md border-warning/40 bg-warning/10">
                                <div className="card-body gap-1 px-3.5 py-2.5">
                                    <div className="flex items-center gap-2.5">
                                        <Trash2 size={16} className="shrink-0 text-warning" />
                                        <span className="text-[13px] font-medium text-base-content">Scheduled for deletion</span>
                                        <progress
                                            className="progress progress-warning mx-1 flex-1 rounded-full [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-value]:rounded-full [&::-moz-progress-bar]:rounded-full"
                                            value={delPct}
                                            max={100}
                                            aria-label="Recovery window used"
                                        />
                                        <span className="shrink-0 text-xs text-base-content/70">
                                            {daysLeft != null ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left` : ""}
                                            {user.purgeAt ? ` · purge ${fmtDateShort(user.purgeAt)}` : ""}
                                        </span>
                                    </div>
                                    <p className="text-xs text-base-content/70">Revoked {usersFmtDate(user.deletedAt)}. Only the account owner can recover it, by verifying their email.</p>
                                    {user.purgeError && <p className="text-xs text-error">Last purge attempt failed: {user.purgeError}</p>}
                                </div>
                            </div>
                        )}
                        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-2">
                            <DetailCard icon={User} title="Account">
                                <DetailRow icon={Mail} tone="text-info" label="Email">
                                    <span className="truncate" title={user.email}>
                                        {user.email}
                                    </span>
                                    <CopyButton text={user.email} label="email" />
                                </DetailRow>
                                <DetailRow icon={Check} tone="text-success" label="Email status">
                                    {user.emailVerified ? (
                                        <ModalBadge tone="success" icon={Check}>
                                            Verified
                                        </ModalBadge>
                                    ) : (
                                        <ModalBadge tone="warning" icon={AlertTriangle}>
                                            Not verified
                                        </ModalBadge>
                                    )}
                                </DetailRow>
                                <DetailRow icon={Shield} tone="text-primary" label="Role">
                                    <ModalBadge tone={user.role === "admin" ? "primary" : "info"} icon={user.role === "admin" ? Crown : User}>
                                        {user.role === "admin" ? "Admin" : "User"}
                                    </ModalBadge>
                                </DetailRow>
                                <DetailRow icon={Calendar} label="Joined">
                                    {user.createdAt ? usersFmtDate(user.createdAt) : "—"}
                                </DetailRow>
                            </DetailCard>

                            <DetailCard icon={Activity} title="Access & activity">
                                <DetailRow icon={Clock} tone="text-warning" label="Access">
                                    {expired ? (
                                        <ModalBadge tone="error" icon={Clock}>
                                            Expired {usersFmtDate(user.accessExpiresAt)}
                                        </ModalBadge>
                                    ) : user.accessType === "temporary" ? (
                                        <ModalBadge tone="warning" icon={Clock}>
                                            Until {usersFmtDate(user.accessExpiresAt)}
                                        </ModalBadge>
                                    ) : (
                                        <ModalBadge tone="neutral">Permanent</ModalBadge>
                                    )}
                                </DetailRow>
                                <DetailRow icon={LogOut} label="Last sign-in">
                                    <span>{user.lastLoginAt ? fmtRel(user.lastLoginAt) : "—"}</span>
                                    {user.lastLoginAt && <span className="hidden font-normal text-base-content/50 sm:inline">· {usersFmtDate(user.lastLoginAt)}</span>}
                                </DetailRow>
                                <DetailRow icon={Globe} tone="text-info" label="Last IP">
                                    <span className="truncate font-mono">{lastIp || "—"}</span>
                                    {lastIp && <CopyButton text={lastIp} label="IP address" />}
                                </DetailRow>
                                <DetailRow icon={Monitor} label="Devices">
                                    <span className="tabular-nums">{deviceCount}</span>
                                    {!loading && summary.activeSessions > 0 && <span className="font-normal text-base-content/50">· {summary.activeSessions} active</span>}
                                </DetailRow>
                            </DetailCard>
                        </div>
                    </div>
                )}

                {tab === "devices" && (
                    <div role="tabpanel" id="panel-devices" aria-labelledby="tab-devices" className="flex min-h-0 flex-1 flex-col gap-2">
                        {loading ? (
                            <div className="flex flex-col gap-2">
                                {[0, 1, 2].map((i) => (
                                    <div key={i} className="skeleton h-11 w-full rounded-md" />
                                ))}
                            </div>
                        ) : failed ? (
                            <ModalNote tone="error" icon={WifiOff}>
                                Couldn’t load devices. Close and reopen this dialog to retry.
                            </ModalNote>
                        ) : devices.length === 0 ? (
                            <p className="rounded-md border border-dashed border-base-content/10 px-4 py-8 text-center text-sm text-base-content/70">No signed-in devices</p>
                        ) : (
                            <ul className="list min-h-0 overflow-y-auto rounded-md border border-base-content/10 bg-base-100">
                                {devices.map((d, i) => {
                                    const activeNow = d.lastActiveAt && Date.now() - new Date(d.lastActiveAt).getTime() < 5 * 60 * 1000;
                                    return (
                                        <li key={`${d.label}-${d.ip}-${i}`} className="list-row items-center px-4 py-3">
                                            <span className="grid h-9 w-9 place-items-center rounded-full bg-info/10 text-info">{deviceIcon(d.deviceType ?? "")}</span>
                                            <div className="min-w-0">
                                                <p className="truncate text-[13px] font-medium text-base-content">{d.label || "Unknown device"}</p>
                                                <p className="truncate text-xs text-base-content/70">
                                                    <span className="font-mono">{d.ip || "IP not recorded"}</span> · first seen {fmtDateShort(d.firstSeenAt)}
                                                </p>
                                            </div>
                                            {activeNow ? (
                                                <ModalBadge tone="success" icon={Activity}>
                                                    Active now
                                                </ModalBadge>
                                            ) : (
                                                <span className="text-xs text-base-content/70">{fmtRel(d.lastActiveAt)}</span>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                        <p className="flex items-center gap-1.5 text-xs text-base-content/70">
                            <Info size={12} className="shrink-0 text-info" />
                            Same browser and IP count once; one IP can be the same device in another browser. View only.
                        </p>
                    </div>
                )}
            </PanelBody>
            <ModalFooter>
                <ModalButton onClick={onClose}>Close</ModalButton>
            </ModalFooter>
        </ModalShell>
    );
}

// ─── MANAGE ACCESS ────────────────────────────────────────────────────────────
// Two states, decided by the SAVED status:
//   not approved → decision only (approve / reject / block / back to pending)
//   approved     → role + access time limit, with a small status switch in the footer

const DURATION_OPTS = [
    { label: "7 days", days: 7 },
    { label: "30 days", days: 30 },
    { label: "90 days", days: 90 },
    { label: "1 year", days: 365 },
];

const DECISIONS = {
    approved: {
        icon: CheckCircle,
        tone: "text-success",
        border: "border-success/50",
        title: "Approve",
        desc: "Let them in",
        cta: "Approve user",
        btn: "primary",
        note: "They can browse and watch what you allow. Role and access time limit appear right after approval.",
        noteTone: "info",
    },
    rejected: {
        icon: XCircle,
        tone: "text-error",
        border: "border-error/50",
        title: "Reject",
        desc: "Decline the request",
        cta: "Reject request",
        btn: "danger",
        note: "Rejected users can’t browse or stream. Their devices stay signed in, but every request is refused.",
        noteTone: "warning",
    },
    blocked: {
        icon: Ban,
        tone: "text-error",
        border: "border-error/50",
        title: "Block",
        desc: "Suspend access",
        cta: "Block user",
        btn: "danger",
        note: "Blocked users can’t browse or stream. Their devices stay signed in, but every request is refused.",
        noteTone: "warning",
    },
    pending: {
        icon: Clock,
        tone: "text-warning",
        border: "border-warning/50",
        title: "Back to pending",
        desc: "Wait for review",
        cta: "Move to pending",
        btn: "primary",
        note: "They can’t browse or stream until approved.",
        noteTone: "info",
    },
};

export function UserRequestModal({ user, onClose, onSave }) {
    const [role, setRole] = useState("user");
    const [status, setStatus] = useState("pending");
    const [accessType, setAccessType] = useState("permanent");
    const [duration, setDuration] = useState(30);
    const [durationTouched, setDurationTouched] = useState(false);
    const [pick, setPick] = useState(null);
    const [saving, setSaving] = useState(false);
    const [hint, setHint] = useState("");
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!user) return;
        setRole(user.role || "user");
        setStatus(user.status || "pending");
        setAccessType(user.accessType || "permanent");
        setDuration(30);
        setDurationTouched(false);
        setPick(null);
        setHint("");
        setError(null);
    }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!user) return null;

    const deleting = !!user.deletedAt;
    const origStatus = user.status || "pending";
    const origRole = user.role || "user";
    const origAccess = user.accessType || "permanent";
    const approvedView = origStatus === "approved";
    const expired = isExpired(user);
    const editing = approvedView && status === "approved";

    // Preview of the expiry that will be written. An existing expiry is only replaced when access just became
    // temporary or a new duration was picked, so role/status edits never silently extend or shorten it.
    const newExpiry = (() => {
        const d = new Date();
        d.setDate(d.getDate() + duration);
        return d.toISOString();
    })();
    const expiryIsNew = accessType === "temporary" && (durationTouched || origAccess !== "temporary");
    const shownExpiry = accessType === "temporary" ? (expiryIsNew ? newExpiry : user.accessExpiresAt) : null;
    const durationLabel = accessType === "temporary" && expiryIsNew ? `Temporary · ${DURATION_OPTS.find((o) => o.days === duration)?.label}` : cap(accessType);

    const changes = approvedView
        ? [
              status !== origStatus && { name: "Status", from: cap(origStatus), to: cap(status) },
              editing && role !== origRole && { name: "Role", from: cap(origRole), to: cap(role) },
              editing && (accessType !== origAccess || (accessType === "temporary" && durationTouched)) && { name: "Access", from: cap(origAccess), to: durationLabel },
          ].filter(Boolean)
        : pick
          ? [{ name: "Status", from: cap(origStatus), to: cap(pick) }]
          : [];
    const dirty = changes.length > 0;

    async function handleSave() {
        if (deleting || saving) return;
        const nextStatus = approvedView ? status : pick;
        if (!nextStatus) {
            setHint("Pick an outcome first.");
            return;
        }
        if (!dirty) return;
        setSaving(true);
        setError(null);
        try {
            const nextRole = editing ? role : origRole;
            const nextType = editing ? accessType : origAccess;
            const touched = editing && durationTouched;
            let accessExpiresAt = user.accessExpiresAt ?? null;
            if (nextType === "temporary") {
                if (origAccess !== "temporary" || touched) accessExpiresAt = newExpiry;
            } else {
                accessExpiresAt = null;
            }
            await onSave(user, { role: nextRole, status: nextStatus, accessType: nextType, accessExpiresAt });
            onClose();
        } catch (e) {
            setError(e?.message || "Couldn’t save changes. Try again.");
        } finally {
            setSaving(false);
        }
    }

    const cur = STATUS_META[status] ?? STATUS_META.pending;
    const decisionKeys = ["approved", "rejected", "blocked", "pending"].filter((k) => k !== origStatus);
    const picked = pick ? DECISIONS[pick] : null;
    const saveLabel = approvedView ? (dirty ? `Save ${changes.length} change${changes.length > 1 ? "s" : ""}` : "Save changes") : (picked?.cta ?? "Save changes");
    const saveVariant = !approvedView ? (picked?.btn ?? "primary") : status === "approved" || status === "pending" ? "primary" : "danger";
    const closeMenu = () => document.activeElement?.blur?.();

    return (
        <ModalShell modal={DASH_MODALS.userRequest} onClose={onClose} busy={saving} labelledBy="um-req-t">
            <ModalHeader
                id="um-req-t"
                avatar={<ModalAvatar name={user.name || user.email} src={user.avatar} className="w-10" ring="border-primary/40" />}
                title={user.name || "Unnamed"}
                subtitle={user.email}
                right={<StatusChip user={user} />}
                onClose={onClose}
                busy={saving}
            />
            <PanelBody>
                {deleting && (
                    <ModalNote tone="warning" icon={Trash2}>
                        This account is scheduled for deletion and can’t be edited.
                    </ModalNote>
                )}

                {!approvedView ? (
                    <div className="flex flex-1 flex-col justify-center gap-4">
                        <div>
                            <h3 className="flex items-center gap-2 text-base font-semibold text-base-content">
                                <span className="h-4 w-1 rounded-full bg-primary" />
                                Decide on this request
                            </h3>
                            <p className="text-xs text-base-content/70">Pick one outcome. You can change it later.</p>
                        </div>
                        <div role="radiogroup" aria-label="Outcome" className="grid gap-3 sm:grid-cols-3">
                            {decisionKeys.map((k) => {
                                const d = DECISIONS[k];
                                return (
                                    <ChoiceCard
                                        key={k}
                                        vertical
                                        on={pick === k}
                                        icon={d.icon}
                                        tone={d.tone}
                                        border={d.border}
                                        title={d.title}
                                        desc={d.desc}
                                        disabled={deleting}
                                        onClick={() => {
                                            setPick(k);
                                            setHint("");
                                            setError(null);
                                        }}
                                    />
                                );
                            })}
                        </div>
                        <ModalNote tone={picked ? picked.noteTone : "info"} icon={picked ? (picked.noteTone === "warning" ? AlertTriangle : Info) : Info}>
                            <span aria-live="polite">{picked ? picked.note : "Pick an outcome to see what happens next."}</span>
                        </ModalNote>
                    </div>
                ) : !editing ? (
                    <ModalNote tone="warning" icon={AlertTriangle}>
                        {status === "pending"
                            ? "Pending users can’t browse or stream until approved."
                            : `${cap(status)} users can’t browse or stream. Their devices stay signed in, but every request is refused.`}
                    </ModalNote>
                ) : (
                    <>
                        <SettingRow
                            icon={Shield}
                            tone="text-primary"
                            title="Role"
                            desc={role === "admin" ? "Manages users, libraries, and server. Can’t manage others’ devices." : "Watches what permissions allow."}
                            right={
                                <ModalSegmented
                                    label="Role"
                                    className="w-52 shrink-0"
                                    value={role}
                                    onChange={(r) => !deleting && setRole(r)}
                                    options={[
                                        { value: "user", label: "User", icon: User },
                                        { value: "admin", label: "Admin", icon: Crown },
                                    ]}
                                />
                            }
                        />
                        <SettingRow
                            icon={Clock}
                            tone="text-warning"
                            title="Access time limit"
                            desc={
                                accessType !== "temporary"
                                    ? "Never expires. Turn on to set an end date."
                                    : expiryIsNew
                                      ? `Access ends ${usersFmtDate(newExpiry)} if saved now`
                                      : expired
                                        ? `Expired ${usersFmtDate(user.accessExpiresAt)}`
                                        : `Access ends ${usersFmtDate(user.accessExpiresAt)}`
                            }
                            right={
                                <label className="flex items-center gap-2 text-xs text-base-content/70">
                                    {accessType === "temporary" ? "On" : "Off"}
                                    <ModalToggle value={accessType === "temporary"} onChange={(v) => setAccessType(v ? "temporary" : "permanent")} disabled={deleting} label="Access time limit" />
                                </label>
                            }>
                            {accessType === "temporary" && (
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                                    <ModalSegmented
                                        split
                                        label="Duration"
                                        className="flex-1"
                                        value={expiryIsNew ? duration : null}
                                        onChange={(d) => {
                                            if (deleting) return;
                                            setDuration(d);
                                            setDurationTouched(true);
                                        }}
                                        options={DURATION_OPTS.map((o) => ({ value: o.days, label: o.label }))}
                                    />
                                    <div className="flex min-w-32 flex-col justify-center rounded-md border border-base-content/10 bg-base-100 px-3 py-0.5">
                                        <p className="text-xs text-base-content/70">{expired && !expiryIsNew ? "Expired" : "Expires"}</p>
                                        <p className="text-[13px] font-semibold text-base-content">{shownExpiry ? usersFmtDate(shownExpiry) : "—"}</p>
                                    </div>
                                </div>
                            )}
                        </SettingRow>
                    </>
                )}

                {error && (
                    <ModalNote tone="error" icon={AlertTriangle}>
                        {error}
                    </ModalNote>
                )}
            </PanelBody>
            <ModalFooter
                note={
                    <div className="flex min-w-0 items-center gap-3">
                        {approvedView && (
                            <div className="dropdown dropdown-top shrink-0">
                                <button
                                    type="button"
                                    tabIndex={0}
                                    aria-haspopup="menu"
                                    disabled={deleting || saving}
                                    className="btn btn-sm gap-1.5 rounded-md border border-base-content/20 bg-transparent font-medium text-base-content/85 hover:bg-base-content/10 [--depth:0] [--noise:0]">
                                    <cur.icon size={13} className={TONE[cur.tone]} />
                                    Status: {cur.label}
                                    <ChevronUp size={12} />
                                </button>
                                <ul
                                    tabIndex={0}
                                    role="menu"
                                    aria-label="Change status"
                                    className="dropdown-content menu menu-sm z-20 mb-2 w-44 rounded-md border border-base-content/10 bg-base-200 p-1 shadow-2xl">
                                    {Object.entries(STATUS_META).map(([k, mm]) => (
                                        <li key={k}>
                                            <button
                                                type="button"
                                                role="menuitemradio"
                                                aria-checked={status === k}
                                                className={status === k ? "menu-active" : ""}
                                                onClick={() => {
                                                    setStatus(k);
                                                    setError(null);
                                                    closeMenu();
                                                }}>
                                                <mm.icon size={14} className={TONE[mm.tone]} />
                                                {mm.label}
                                                {status === k && <Check size={12} className="ml-auto" />}
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {dirty ? (
                            <>
                                <span className="inline-flex shrink-0 items-center gap-1.5 text-warning">
                                    <span className="size-2 shrink-0 rounded-full bg-warning" />
                                    Unsaved
                                </span>
                                <ul className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto" aria-live="polite" aria-label="Pending changes">
                                    {changes.map((c) => (
                                        <ModalChange key={c.name} {...c} />
                                    ))}
                                </ul>
                            </>
                        ) : hint ? (
                            <span className="text-warning">{hint}</span>
                        ) : approvedView ? (
                            <span className="text-base-content/60">No changes yet</span>
                        ) : null}
                    </div>
                }>
                <ModalButton onClick={onClose} disabled={saving}>
                    Cancel
                </ModalButton>
                <ModalButton variant={saveVariant} onClick={handleSave} loading={saving} loadingText="Saving…" disabled={deleting || (!approvedView && !pick)}>
                    {saveLabel}
                </ModalButton>
            </ModalFooter>
        </ModalShell>
    );
}

// ─── PERMISSIONS ──────────────────────────────────────────────────────────────

// Library icon by kind: movies → Film, series → Tv, anime → Sparkles, anything else → Library.
// Uses lib.type / lib.category / lib.kind when the API sends one, otherwise guesses from the label, then the path.
const LIB_ICON = { movie: Film, series: Tv, anime: Sparkles };

function libKind(lib) {
    const guess = (t) => {
        t = String(t || "").toLowerCase();
        if (/anime/.test(t)) return "anime";
        if (/series|\btv\b|shows?|episodes?/.test(t)) return "series";
        if (/movie|film/.test(t)) return "movie";
        return null;
    };
    return guess(lib.type || lib.category || lib.kind) ?? guess(lib.label) ?? guess(lib.path);
}

export function UserPermissionModal({ user, onClose, onSave, libraries = [] }) {
    const [allowAdult, setAllowAdult] = useState(false);
    const [origAdult, setOrigAdult] = useState(false);
    const [libPerms, setLibPerms] = useState({});
    const [origPerms, setOrigPerms] = useState({});
    const [libSearch, setLibSearch] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!user) return;
        let parsed = {};
        try {
            const raw = user.permissionsJson || user.permissions;
            parsed = typeof raw === "string" ? JSON.parse(raw) : (raw ?? {});
        } catch {
            /* ignore */
        }
        const adult = parsed?.allowAdult ?? false;
        setAllowAdult(adult);
        setOrigAdult(adult);
        // Backend contract: parsed.libraries is an array of granted library IDs (empty/missing = no access).
        const grantedIds = Array.isArray(parsed?.libraries) ? parsed.libraries : [];
        const map = {};
        libraries.forEach((l) => {
            map[l.id] = grantedIds.includes(l.id);
        });
        setLibPerms(map);
        setOrigPerms(map);
        setLibSearch("");
        setError(null);
    }, [user?.id, libraries]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!user) return null;

    const filteredLibs = libraries.filter((l) => !libSearch || (l.label + l.path).toLowerCase().includes(libSearch.toLowerCase()));
    const enabledCount = Object.values(libPerms).filter(Boolean).length;
    const deleting = !!user.deletedAt;
    const yn = (v) => (v ? "Allowed" : "Blocked");
    const changes = [
        allowAdult !== origAdult && { name: "18+", from: yn(origAdult), to: yn(allowAdult) },
        ...libraries.filter((l) => (libPerms[l.id] ?? false) !== (origPerms[l.id] ?? false)).map((l) => ({ name: l.label || l.path, from: yn(origPerms[l.id]), to: yn(libPerms[l.id]) })),
    ].filter(Boolean);
    const dirty = changes.length > 0;
    const setAll = (v) => !deleting && setLibPerms(Object.fromEntries(libraries.map((l) => [l.id, v])));

    async function handleSave() {
        if (!dirty || deleting || saving) return;
        setSaving(true);
        setError(null);
        try {
            const libraryIds = Object.entries(libPerms)
                .filter(([, granted]) => granted)
                .map(([id]) => id);
            const permissions = { libraries: libraryIds, allowAdult };
            // role / status / access stay untouched — only permissions are updated here
            await onSave(user, { allowAdult, permissions, permissionsJson: JSON.stringify(permissions) });
            onClose();
        } catch (e) {
            setError(e?.message || "Couldn’t save permissions. Try again.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <ModalShell modal={DASH_MODALS.userPermissions} onClose={onClose} busy={saving} labelledBy="um-perm-t">
            <ModalHeader
                id="um-perm-t"
                icon={KeyRound}
                title="Content permissions"
                subtitle={user.name || user.email}
                right={
                    libraries.length > 0 ? (
                        <span className="hidden sm:block">
                            <ModalBadge tone={enabledCount ? "primary" : "neutral"} icon={Library}>
                                {enabledCount} of {libraries.length} libraries
                            </ModalBadge>
                        </span>
                    ) : null
                }
                onClose={onClose}
                busy={saving}
            />
            <PanelBody className="gap-2">
                {deleting && (
                    <ModalNote tone="warning" icon={Trash2}>
                        This account is scheduled for deletion and can’t be edited.
                    </ModalNote>
                )}

                <label className="card border flex-row items-center gap-3 rounded-md border-base-content/10 bg-base-100 px-3.5 py-2 hover:bg-base-content/5">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${allowAdult ? "bg-warning/10 text-warning" : "bg-error/10 text-error"}`}>
                        {allowAdult ? <Eye size={18} /> : <EyeOff size={18} />}
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium text-base-content">Allow 18+ content</span>
                        <span className="block text-xs text-base-content/70">{allowAdult ? "Allowed. Titles marked for adults are visible." : "Blocked. Titles marked for adults stay hidden."}</span>
                    </span>
                    <ModalToggle value={allowAdult} onChange={setAllowAdult} disabled={deleting} label="Allow 18+ content" />
                </label>

                {libraries.length > 0 && (
                    <>
                        <div className="flex shrink-0 flex-wrap gap-2">
                            <label className="input input-sm w-full min-w-0 rounded-md sm:w-auto sm:flex-1">
                                <Search size={14} className="shrink-0 text-base-content/70" />
                                <input type="search" className="grow" value={libSearch} onChange={(e) => setLibSearch(e.target.value)} placeholder="Search libraries" aria-label="Search libraries" />
                            </label>
                            <ModalButton className="flex-1 sm:flex-none" onClick={() => setAll(true)} disabled={deleting}>
                                Allow all
                            </ModalButton>
                            <ModalButton className="flex-1 sm:flex-none" onClick={() => setAll(false)} disabled={deleting}>
                                None
                            </ModalButton>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-base-content/10 bg-base-100">
                            <table className="table table-xs">
                                <thead className="sticky top-0 z-10 bg-base-200">
                                    <tr className="text-[11px] uppercase tracking-wider text-base-content/50">
                                        <th className="w-8"></th>
                                        <th>Library</th>
                                        <th className="hidden sm:table-cell">Path</th>
                                        <th className="text-right">Access</th>
                                        <th className="w-14 text-right">Allow</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredLibs.map((lib) => {
                                        const on = libPerms[lib.id] ?? false;
                                        const changed = on !== (origPerms[lib.id] ?? false);
                                        const toggle = (v) => !deleting && setLibPerms((p) => ({ ...p, [lib.id]: v }));
                                        const LibIcon = LIB_ICON[libKind(lib)] ?? Library;
                                        return (
                                            <tr key={lib.id} title={lib.path} onClick={() => toggle(!on)} className="h-10 cursor-pointer align-middle text-[12px] hover:bg-base-content/5">
                                                <th className="w-8">
                                                    <LibIcon size={16} className={on ? "text-primary" : "text-base-content/50"} />
                                                </th>
                                                <td className="font-medium text-base-content">{lib.label || lib.path}</td>
                                                <td className="hidden max-w-64 truncate font-mono text-xs text-base-content/50 sm:table-cell">{lib.label ? lib.path : ""}</td>
                                                <td className={`w-24 text-right font-medium ${on ? "text-success" : "text-base-content/60"}`}>
                                                    {yn(on)}
                                                    {changed && <span className="ml-1.5 inline-block size-1.5 rounded-full bg-warning align-middle" title="Changed" />}
                                                </td>
                                                <td className="w-14" onClick={(e) => e.stopPropagation()}>
                                                    <div className="flex justify-end">
                                                        <ModalToggle value={on} onChange={toggle} disabled={deleting} label={`Allow ${lib.label || lib.path}`} />
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {filteredLibs.length === 0 && (
                                        <tr>
                                            <td colSpan={5} className="py-6 text-center text-base-content/70">
                                                No libraries match “{libSearch}”
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}

                {error && (
                    <ModalNote tone="error" icon={AlertTriangle}>
                        {error}
                    </ModalNote>
                )}
            </PanelBody>
            <ModalFooter
                note={
                    dirty ? (
                        <div className="flex min-w-0 items-center gap-3">
                            <span className="inline-flex shrink-0 items-center gap-1.5 text-warning">
                                <span className="size-2 shrink-0 rounded-full bg-warning" />
                                Unsaved
                            </span>
                            <ul className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto" aria-live="polite" aria-label="Pending changes">
                                {changes.map((c) => (
                                    <ModalChange key={c.name} {...c} />
                                ))}
                            </ul>
                        </div>
                    ) : (
                        <span className="text-base-content/60">No changes yet</span>
                    )
                }>
                <ModalButton onClick={onClose} disabled={saving}>
                    Cancel
                </ModalButton>
                <ModalButton variant="primary" onClick={handleSave} loading={saving} loadingText="Saving…" disabled={deleting}>
                    {dirty ? `Save ${changes.length} change${changes.length > 1 ? "s" : ""}` : "Save permissions"}
                </ModalButton>
            </ModalFooter>
        </ModalShell>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// IPTV modals — used by pages/DashIPTV.jsx
// ═══════════════════════════════════════════════════════════════════════════

const ACCEPTED_EXTENSIONS = ".m3u,.m3u8,.yml,.yaml,.json,.xml,.txt";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function detectFormat(name = "") {
    const lower = name.toLowerCase();
    if (lower.endsWith(".m3u8") || lower.endsWith(".m3u") || lower.endsWith(".txt")) return "M3U";
    if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "YAML";
    if (lower.endsWith(".json")) return "JSON";
    if (lower.endsWith(".xml")) return "XML";
    return "Unknown";
}

function iptvFmtDate(iso) {
    if (!iso) return "—";
    try {
        return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    } catch {
        return "—";
    }
}

// ─── Modals ───────────────────────────────────────────────────────────────────
// Same labelled-section design as the Users / Media / Libraries / Storage dialogs (ConfirmModal.jsx).

const TONE_CLS = { primary: "text-primary", info: "text-info", success: "text-success", warning: "text-warning", error: "text-error", accent: "text-accent" };

const FIELD = "flex h-[42px] items-center gap-2 rounded-md border border-base-content/15 bg-base-100 px-3 transition-colors focus-within:border-primary/60";

const FIELD_INPUT = "min-w-0 flex-1 bg-transparent text-[13px] text-base-content outline-none placeholder:text-base-content/40";

const apiError = (e) => e?.response?.data?.message || e?.message;

const STATUS_TONE = { ready: "success", working: "success", pending: "warning", timeout: "warning", error: "error", offline: "error", checking: "info" };

const STATUS_ICON = { success: CheckCircle2, warning: Clock, error: AlertCircle, info: Loader2 };

const iptvCap = (v) => (v ? String(v).charAt(0).toUpperCase() + String(v).slice(1) : "—");

/** Shell + header + body + footer. `dense` tightens the gaps for the tall edit forms. */
export function IptvModal({ modal, id, icon, tone = "primary", avatar, dense = false, title, subtitle, badges, right, busy = false, onClose, error, note, actions, children }) {
    return (
        <ModalShell modal={modal} onClose={onClose} busy={busy} labelledBy={id}>
            <ModalHeader id={id} icon={icon} avatar={avatar} tone={TONE_CLS[tone] || TONE_CLS.primary} title={title} subtitle={subtitle} badges={badges} right={right} onClose={onClose} busy={busy} />
            <ModalContent className={`${dense ? "!gap-3 !py-4" : ""}`}>
                {error && (
                    <ModalCallout tone="error" icon={AlertTriangle} compact>
                        {error}
                    </ModalCallout>
                )}
                {children}
            </ModalContent>
            <ModalFooter note={note}>{actions}</ModalFooter>
        </ModalShell>
    );
}

/** Small muted label above a control. A dot + Reset appear once the field differs from the saved value. */
function Field({ label, hint, htmlFor, changed = false, onReset, className = "", children }) {
    return (
        <section className={`flex shrink-0 flex-col gap-1.5 ${className}`}>
            <div className="flex min-h-5 items-center justify-between gap-2">
                <label htmlFor={htmlFor} className="flex items-center gap-1.5 text-xs font-medium text-base-content/65">
                    {label}
                    {hint && <span className="font-normal text-base-content/45">· {hint}</span>}
                    {changed && <span className="size-1.5 rounded-full bg-warning" title="Changed" />}
                </label>
                {changed && onReset && (
                    <button type="button" onClick={onReset} className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-base-content/55 transition-colors hover:text-base-content">
                        <RotateCcw size={11} />
                        Reset
                    </button>
                )}
            </div>
            {children}
        </section>
    );
}

function TextInput({ icon: Icon, changed = false, mono = false, readOnly = false, ...props }) {
    return (
        <div className={`${FIELD} ${changed ? "!border-primary/60" : ""} ${readOnly ? "bg-base-200/40" : ""}`}>
            {Icon && <Icon size={14} className="shrink-0 text-base-content/50" />}
            <input type="text" readOnly={readOnly} {...props} className={`${FIELD_INPUT} ${mono ? "font-mono text-xs" : ""}`} />
        </div>
    );
}

/** Footer note of the edit dialogs: "● Unsaved changes" or a quiet idle line. */
function DirtyNote({ dirty }) {
    return dirty ? (
        <span className="inline-flex items-center gap-1.5 text-warning">
            <span className="size-2 rounded-full bg-warning" />
            Unsaved changes
        </span>
    ) : (
        <span className="text-base-content/60">No changes yet</span>
    );
}

/** Split a playlist / stream address into the pieces the info dialogs show. */
function parseAddress(raw) {
    try {
        const u = new URL(String(raw));
        const file = u.pathname.split("/").filter(Boolean).pop() || "";
        const ext = file.includes(".") ? file.split(".").pop().toLowerCase() : "";
        return { ok: true, host: u.host, scheme: u.protocol.replace(":", "").toUpperCase(), secure: u.protocol === "https:", path: `${u.pathname}${u.search}` || "/", file, ext };
    } catch {
        return { ok: false };
    }
}

const STREAM_KIND = { m3u8: "HLS", m3u: "HLS", mpd: "MPEG-DASH", ts: "MPEG-TS", mp4: "MP4", mkv: "MKV", flv: "FLV" };

/** Round channel logo (falls back to the initial when missing or broken), used in place of an icon tile. */
function ChannelLogo({ src, name, size = "size-10" }) {
    const [bad, setBad] = useState(false);
    useEffect(() => setBad(false), [src]);
    const initial = (name || "?").trim()[0]?.toUpperCase() || "?";
    return (
        <div className={`${size} grid shrink-0 place-items-center overflow-hidden rounded-full border border-base-content/20 bg-base-300`}>
            {src && !bad ? (
                <img src={src} alt="" onError={() => setBad(true)} className="h-full w-full object-contain p-1" />
            ) : (
                <span className="text-sm font-medium text-base-content">{initial}</span>
            )}
        </div>
    );
}

function ModalStatus({ status }) {
    const tone = STATUS_TONE[status] || "neutral";
    return (
        <ModalBadge tone={tone} icon={STATUS_ICON[tone]}>
            {iptvCap(status)}
        </ModalBadge>
    );
}

/** Panel naming what a delete dialog is about to remove. */
function TargetCard({ avatar, title, sub, mono = false, badge }) {
    return (
        <div className={`${PANEL} flex shrink-0 items-center gap-4 px-4 py-3`}>
            {avatar}
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-base-content">{title}</p>
                {sub && <p className={`truncate text-xs text-base-content/55 ${mono ? "font-mono" : ""}`}>{sub}</p>}
            </div>
            {badge}
        </div>
    );
}

// ─── Player Modal — "Play" action opens this instead of a raw new-tab <a> ─────
// A bare <a href={m3u8} target="_blank"> just downloads/404s in most browsers
// (Chrome/Firefox can't natively play HLS). This attaches hls.js so the admin
// can actually preview the stream, and treats 404/503/timeout as retryable
// network errors instead of a dead end.
export function IptvPlayerModal({ channel, onClose }) {
    const navigate = useNavigate();
    const videoRef = useRef(null);
    const hlsRef = useRef(null);
    const retriesRef = useRef(0);
    const [status, setStatus] = useState("loading"); // loading | playing | error
    const [errorMsg, setErrorMsg] = useState("");

    useEffect(() => {
        let destroyed = false;
        const video = videoRef.current;
        if (!video || !channel?.url) return;

        setStatus("loading");
        setErrorMsg("");
        retriesRef.current = 0;

        function fail(msg) {
            if (destroyed) return;
            setStatus("error");
            setErrorMsg(msg);
        }

        if (Hls.isSupported()) {
            const hls = new Hls({
                maxBufferLength: 30,
                manifestLoadingMaxRetry: 4,
                manifestLoadingRetryDelay: 1000,
                levelLoadingMaxRetry: 4,
                fragLoadingMaxRetry: 6,
                fragLoadingRetryDelay: 1000,
            });
            hlsRef.current = hls;

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                if (destroyed) return;
                setStatus("playing");
                video.play().catch(() => {});
            });

            hls.on(Hls.Events.ERROR, (_evt, data) => {
                if (destroyed || !data.fatal) return;
                const code = data.response?.code;
                if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                    // 404 / 503 / timeout — retry a few times (backend may be
                    // rate-limiting or the CDN edge is briefly flaky) before
                    // surfacing a hard error.
                    if (retriesRef.current < 3) {
                        retriesRef.current += 1;
                        setTimeout(() => !destroyed && hls.startLoad(), 1200);
                        return;
                    }
                    fail(code ? `Stream unreachable — HTTP ${code}` : `Network error — ${data.details}`);
                } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                    hls.recoverMediaError();
                } else {
                    fail(data.details || "Playback failed");
                }
            });

            hls.loadSource(channel.url);
            hls.attachMedia(video);
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
            // Safari / iOS — native HLS
            video.src = channel.url;
            const onLoaded = () => !destroyed && setStatus("playing");
            const onErr = () => fail("Stream unreachable — playback failed");
            video.addEventListener("loadedmetadata", onLoaded);
            video.addEventListener("error", onErr);
            video.play().catch(() => {});
        } else {
            fail("HLS playback not supported in this browser");
        }

        return () => {
            destroyed = true;
            if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
            }
            video.removeAttribute("src");
            video.load();
        };
    }, [channel?.url]);

    if (!channel) return null;

    const tone = status === "playing" ? "success" : status === "error" ? "error" : "info";
    const addr = parseAddress(channel.url);
    return (
        <IptvModal
            modal={DASH_MODALS.iptvPlayer}
            id="iptv-player-t"
            avatar={<ChannelLogo src={channel.logo} name={channel.name} />}
            title={channel.name || "Preview"}
            subtitle={[channel.group || channel.category, channel.country].filter(Boolean).join(" · ") || undefined}
            badges={
                <ModalBadge tone={tone} icon={STATUS_ICON[tone]}>
                    {status === "playing" ? "Playing" : status === "error" ? "Error" : "Connecting"}
                </ModalBadge>
            }
            onClose={onClose}
            note={<span className="block truncate font-mono">{channel.url}</span>}
            actions={
                <>
                    <ModalCopyButton text={channel.url} label="stream URL" />
                    <ModalButton onClick={onClose}>Close</ModalButton>
                    <ModalButton
                        variant="primary"
                        className="gap-1.5"
                        onClick={() =>
                            navigate(`/live/watch/${encodeURIComponent(channel.id ?? "preview")}`, {
                                state: { streamUrl: channel.url, channelName: channel.name, channelLogo: channel.logo || null },
                            })
                        }>
                        <MonitorPlay size={14} />
                        Open in player
                    </ModalButton>
                </>
            }>
            <div className="relative min-h-40 flex-1 overflow-hidden rounded-lg border border-base-content/10 bg-black">
                <video ref={videoRef} controls autoPlay playsInline className="h-full w-full object-contain" />
                {status === "loading" && (
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2">
                        <span className="grid size-14 place-items-center rounded-full border border-base-content/25 bg-base-content/10">
                            <Loader2 size={24} className="animate-spin text-base-content/70" />
                        </span>
                        <p className="text-xs text-white/70">Connecting</p>
                    </div>
                )}
                {status === "error" && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/85 px-4 text-center">
                        <span className="grid size-14 place-items-center rounded-full border border-error/35 bg-error/10">
                            <AlertCircle size={24} className="text-error" />
                        </span>
                        <p className="text-xs text-white/70">{errorMsg}</p>
                    </div>
                )}
            </div>
            <ModalStats
                items={[
                    { icon: Play, tone: "text-info", label: "Stream type", value: addr.ok ? STREAM_KIND[addr.ext] || "Stream" : "—" },
                    { icon: ShieldCheck, tone: addr.secure ? "text-success" : "text-warning", label: "Protocol", value: addr.ok ? addr.scheme : "—" },
                    { icon: Globe2, tone: "text-accent", label: "Host", value: addr.ok ? addr.host : "—", mono: true },
                ]}
            />
        </IptvModal>
    );
}

export function IptvUploadModal({ addUploadMutation, closeUploadModal, uploadFile, uploadName, setUploadName, fileInputRef, setUploadFile }) {
    return (
        <IptvModal
            modal={DASH_MODALS.iptvUpload}
            id="iptv-upload-t"
            icon={Upload}
            tone="primary"
            title="Upload playlist"
            subtitle="Add channels from a file"
            busy={addUploadMutation.isPending}
            onClose={closeUploadModal}
            error={addUploadMutation.error ? apiError(addUploadMutation.error) : null}
            note={`${uploadFile ? `Detected format: ${detectFormat(uploadFile.name)}` : "No file chosen yet"} · Accepted: ${ACCEPTED_EXTENSIONS.split(",").join(" ")}`}
            actions={
                <>
                    <ModalButton onClick={closeUploadModal} disabled={addUploadMutation.isPending}>
                        Cancel
                    </ModalButton>
                    <ModalButton
                        variant="primary"
                        className="gap-1.5"
                        onClick={() => addUploadMutation.mutate({ name: uploadName.trim(), file: uploadFile })}
                        disabled={!uploadFile}
                        loading={addUploadMutation.isPending}
                        loadingText="Uploading…">
                        <Plus size={14} />
                        Add source
                    </ModalButton>
                </>
            }>
            <Field label="Source name" htmlFor="iptv-upload-name">
                <TextInput id="iptv-upload-name" data-autofocus changed={!!uploadName.trim()} placeholder="e.g. Sports Bundle" value={uploadName} onChange={(e) => setUploadName(e.target.value)} />
            </Field>
            <ModalSection label="File" grow>
                <div
                    role="button"
                    tabIndex={0}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            fileInputRef.current?.click();
                        }
                    }}
                    className={`flex min-h-32 flex-1 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 text-center transition-colors ${
                        uploadFile ? "border-primary/50 bg-base-100" : "border-base-content/25 bg-base-100 hover:border-primary/50"
                    }`}>
                    <input ref={fileInputRef} type="file" accept={ACCEPTED_EXTENSIONS} className="hidden" onChange={(e) => setUploadFile(e.target.files?.[0] || null)} />
                    <span className={`grid size-12 place-items-center rounded-full border border-base-content/10 bg-base-200 ${uploadFile ? "text-primary" : "text-base-content/60"}`}>
                        {uploadFile ? <FileText size={20} /> : <Upload size={20} />}
                    </span>
                    {uploadFile ? (
                        <>
                            <p className="max-w-full truncate text-sm text-base-content">{uploadFile.name}</p>
                            <p className="text-xs text-base-content/55">Click to choose a different file</p>
                        </>
                    ) : (
                        <>
                            <p className="text-sm text-base-content">Click to choose a file</p>
                            <p className="text-xs text-base-content/55">M3U, M3U8, YAML, JSON, XML or TXT · up to 50 MB</p>
                        </>
                    )}
                </div>
            </ModalSection>
            <ModalStats
                items={[
                    { icon: Layers, tone: "text-success", label: "Size", value: uploadFile ? `${(uploadFile.size / 1048576).toFixed(1)} MB` : "—" },
                    { icon: ShieldCheck, tone: "text-warning", label: "Limit", value: "50 MB" },
                ]}
            />
        </IptvModal>
    );
}

export function IptvAddUrlModal({ urlValue, addUrlMutation, closeUrlModal, urlName, setUrlName, setUrlValue }) {
    const addr = parseAddress(urlValue.trim());
    return (
        <IptvModal
            modal={DASH_MODALS.iptvAddUrl}
            id="iptv-url-t"
            icon={LinkIcon}
            tone="info"
            title="Add remote playlist"
            subtitle="Import channels from a URL"
            busy={addUrlMutation.isPending}
            onClose={closeUrlModal}
            error={addUrlMutation.error ? apiError(addUrlMutation.error) : null}
            note={urlValue.trim() ? `Detected format: ${detectFormat(urlValue.trim())}` : "Waiting for a URL"}
            actions={
                <>
                    <ModalButton onClick={closeUrlModal} disabled={addUrlMutation.isPending}>
                        Cancel
                    </ModalButton>
                    <ModalButton
                        variant="primary"
                        className="gap-1.5"
                        onClick={() => addUrlMutation.mutate({ name: urlName.trim(), url: urlValue.trim() })}
                        disabled={!urlValue.trim()}
                        loading={addUrlMutation.isPending}
                        loadingText="Adding…">
                        <Plus size={14} />
                        Add source
                    </ModalButton>
                </>
            }>
            <Field label="Source name" htmlFor="iptv-url-name">
                <TextInput id="iptv-url-name" data-autofocus changed={!!urlName.trim()} placeholder="e.g. IPTV-ORG Country Index" value={urlName} onChange={(e) => setUrlName(e.target.value)} />
            </Field>
            <Field label="Playlist URL" htmlFor="iptv-url-value">
                <TextInput
                    id="iptv-url-value"
                    mono
                    changed={!!urlValue.trim()}
                    placeholder="https://raw.githubusercontent.com/iptv-org/iptv/master/streams/bd.m3u"
                    value={urlValue}
                    onChange={(e) => setUrlValue(e.target.value)}
                />
            </Field>
            <ModalStats
                items={[
                    { icon: Globe2, tone: "text-accent", label: "Host", value: addr.ok ? addr.host : "—", mono: true },
                    { icon: ShieldCheck, tone: addr.secure ? "text-success" : "text-warning", label: "Protocol", value: addr.ok ? addr.scheme : "—" },
                ]}
            />
            <ModalCallout tone="info" compact className="mt-auto">
                M3U, YAML, JSON or XML playlist address. Format and host are detected as you type.
            </ModalCallout>
        </IptvModal>
    );
}

export function IptvSourceInfoModal({ infoSource, setInfoSource }) {
    const addr = infoSource.type === "url" ? parseAddress(infoSource.location) : { ok: false };
    const isUrl = infoSource.type === "url";
    const sTone = STATUS_TONE[infoSource.status] || "neutral";
    return (
        <IptvModal
            modal={DASH_MODALS.iptvSourceInfo}
            id="iptv-src-info-t"
            icon={isUrl ? LinkIcon : FileText}
            tone="info"
            title={infoSource.name || "Source"}
            subtitle={<span className="font-mono">{infoSource.location}</span>}
            badges={
                <>
                    <ModalBadge tone="info">{isUrl ? "URL" : "File"}</ModalBadge>
                    {infoSource.format && <ModalBadge>{infoSource.format}</ModalBadge>}
                    <ModalStatus status={infoSource.status} />
                </>
            }
            onClose={() => setInfoSource(null)}
            note="Read only"
            actions={<ModalButton onClick={() => setInfoSource(null)}>Close</ModalButton>}>
            <ModalStats
                items={[
                    { icon: Tv, tone: "text-info", label: "Channels", value: infoSource.channelCount?.toLocaleString?.() ?? infoSource.channelCount ?? "—" },
                    {
                        icon: STATUS_ICON[sTone] || Info,
                        tone: TONE_CLS[sTone] || "text-base-content/60",
                        label: "Status",
                        value: iptvCap(infoSource.status),
                        valueTone: sTone === "neutral" ? undefined : sTone,
                    },
                    { icon: Clock, tone: "text-warning", label: "Added", value: iptvFmtDate(infoSource.date) },
                ]}
            />
            <ModalSection label="Source" grow>
                <ModalRows className="flex-1">
                    <ModalKV label="Name">{infoSource.name ?? "—"}</ModalKV>
                    <ModalKV label="Type">{isUrl ? "URL" : "Uploaded file"}</ModalKV>
                    <ModalKV label="Format">{infoSource.format ?? "—"}</ModalKV>
                    {isUrl && addr.ok && (
                        <>
                            <ModalKV label="Host" mono>
                                {addr.host}
                            </ModalKV>
                            <ModalKV label="Protocol">
                                <span className={addr.secure ? "text-success" : "text-warning"}>{addr.scheme}</span>
                            </ModalKV>
                        </>
                    )}
                    <ModalKV label={isUrl ? "Location" : "Stored as"} mono action={infoSource.location ? <ModalCopyButton text={infoSource.location} label="location" /> : null}>
                        <span title={infoSource.location}>{infoSource.location ?? "—"}</span>
                    </ModalKV>
                    {infoSource.id != null && (
                        <ModalKV label="Source ID" mono action={<ModalCopyButton text={String(infoSource.id)} label="source ID" />}>
                            {String(infoSource.id)}
                        </ModalKV>
                    )}
                </ModalRows>
            </ModalSection>
            {infoSource.status === "error" && infoSource.error && (
                <ModalCallout tone="error" icon={AlertTriangle} compact>
                    {infoSource.error}
                </ModalCallout>
            )}
        </IptvModal>
    );
}

export function IptvSourceEditModal({ editSource, editName, editLocation, editMutation, closeEditModal, setEditName, setEditLocation }) {
    const isUrl = editSource.type === "url";
    const changes = [
        editName.trim() !== (editSource.name || "") && { name: "Name", from: editSource.name || "—", to: editName.trim() || "—" },
        isUrl && editLocation.trim() !== (editSource.location || "") && { name: "URL", from: editSource.location || "—", to: editLocation.trim() || "—" },
    ].filter(Boolean);
    return (
        <IptvModal
            modal={DASH_MODALS.iptvSourceEdit}
            id="iptv-src-edit-t"
            icon={SquarePen}
            tone="warning"
            title="Edit source"
            subtitle={editSource.name}
            busy={editMutation.isPending}
            onClose={closeEditModal}
            error={editMutation.error ? apiError(editMutation.error) : null}
            note={<DirtyNote dirty={changes.length > 0} />}
            actions={
                <>
                    <ModalButton onClick={closeEditModal} disabled={editMutation.isPending}>
                        Cancel
                    </ModalButton>
                    <ModalButton
                        variant="primary"
                        className="gap-1.5"
                        onClick={() =>
                            editMutation.mutate({
                                id: editSource.id,
                                data: isUrl ? { name: editName.trim(), url: editLocation.trim() } : { name: editName.trim() },
                            })
                        }
                        disabled={!editName.trim()}
                        loading={editMutation.isPending}
                        loadingText="Saving…">
                        <Check size={14} />
                        Save changes
                    </ModalButton>
                </>
            }>
            <Field label="Source name" htmlFor="iptv-src-edit-name" changed={editName.trim() !== (editSource.name || "")} onReset={() => setEditName(editSource.name || "")}>
                <TextInput id="iptv-src-edit-name" data-autofocus changed={editName.trim() !== (editSource.name || "")} value={editName} onChange={(e) => setEditName(e.target.value)} />
            </Field>
            <Field
                label="Playlist URL"
                hint="URL sources only"
                htmlFor="iptv-src-edit-url"
                changed={isUrl && editLocation.trim() !== (editSource.location || "")}
                onReset={() => setEditLocation(editSource.location || "")}>
                <TextInput
                    id="iptv-src-edit-url"
                    mono
                    readOnly={!isUrl}
                    changed={isUrl && editLocation.trim() !== (editSource.location || "")}
                    value={isUrl ? editLocation : editSource.location || "Uploaded file — nothing to edit"}
                    onChange={(e) => isUrl && setEditLocation(e.target.value)}
                />
            </Field>
            <ModalStats
                items={[
                    { icon: isUrl ? LinkIcon : FileText, tone: "text-info", label: "Type", value: isUrl ? "URL" : "File" },
                    { icon: FileText, tone: "text-accent", label: "Format", value: editSource.format ?? "—" },
                    { icon: Tv, tone: "text-success", label: "Channels", value: editSource.channelCount?.toLocaleString?.() ?? editSource.channelCount ?? "—" },
                ]}
            />
            {!isUrl && (
                <ModalCallout tone="info" icon={Info} compact>
                    Uploaded as a file, so only the name can be changed. Upload a new file to replace the channels.
                </ModalCallout>
            )}
            <ModalReview changes={changes} saved={[{ name: "Name", value: editSource.name }, ...(isUrl ? [{ name: "URL", value: editSource.location }] : [])]} className="mt-auto" />
        </IptvModal>
    );
}

export function IptvChannelInfoModal({ channelStatus, infoChannel, setInfoChannel }) {
    const st = channelStatus(infoChannel);
    const addr = parseAddress(infoChannel.url);
    const sTone = STATUS_TONE[st] || "neutral";
    return (
        <IptvModal
            modal={DASH_MODALS.iptvChannelInfo}
            id="iptv-ch-info-t"
            avatar={<ChannelLogo src={infoChannel.logo} name={infoChannel.name} />}
            title={infoChannel.name || "Channel"}
            subtitle={[infoChannel.country, infoChannel.group].filter(Boolean).join(" · ") || undefined}
            badges={
                <>
                    <ModalStatus status={st} />
                    {addr.ok && <ModalBadge>{STREAM_KIND[addr.ext] || "Stream"}</ModalBadge>}
                </>
            }
            onClose={() => setInfoChannel(null)}
            note="Read only"
            actions={<ModalButton onClick={() => setInfoChannel(null)}>Close</ModalButton>}>
            <ModalStats
                items={[
                    { icon: Play, tone: "text-info", label: "Stream type", value: addr.ok ? STREAM_KIND[addr.ext] || "Stream" : "—" },
                    { icon: ShieldCheck, tone: addr.secure ? "text-success" : "text-warning", label: "Protocol", value: addr.ok ? addr.scheme : "—" },
                    { icon: Globe2, tone: "text-accent", label: "Host", value: addr.ok ? addr.host : "—", mono: true },
                ]}
            />
            <ModalSection label="Channel" grow>
                <ModalRows className="flex-1">
                    <ModalKV label="Name">{infoChannel.name ?? "—"}</ModalKV>
                    <ModalKV label="Country">{infoChannel.country ?? "—"}</ModalKV>
                    <ModalKV label="Group">{infoChannel.group ?? "—"}</ModalKV>
                    <ModalKV label="Category">{infoChannel.category ?? "—"}</ModalKV>
                    <ModalKV label="Working status">
                        <span className={TONE_CLS[sTone] || ""}>{iptvCap(st)}</span>
                    </ModalKV>
                    <ModalKV label="Stream URL" mono action={infoChannel.url ? <ModalCopyButton text={infoChannel.url} label="stream URL" /> : null}>
                        <span title={infoChannel.url}>{infoChannel.url ?? "—"}</span>
                    </ModalKV>
                </ModalRows>
            </ModalSection>
        </IptvModal>
    );
}

export function IptvChannelEditModal({
    editChName,
    editChannel,
    editChCategory,
    editChCountry,
    editChannelMutation,
    closeEditChannelModal,
    saveChannelEdit,
    setEditChName,
    setEditChCategory,
    setEditChCountry,
    channelStatus,
}) {
    const changes = [
        editChName.trim() !== (editChannel.name || "") && { name: "Name", from: editChannel.name || "—", to: editChName.trim() || "—" },
        editChCategory.trim() !== (editChannel.category || "") && { name: "Category", from: editChannel.category || "—", to: editChCategory.trim() || "—" },
        editChCountry.trim() !== (editChannel.country || "") && { name: "Country", from: editChannel.country || "—", to: editChCountry.trim() || "—" },
    ].filter(Boolean);
    const addr = parseAddress(editChannel.url);
    const nameCh = editChName.trim() !== (editChannel.name || "");
    const catCh = editChCategory.trim() !== (editChannel.category || "");
    const couCh = editChCountry.trim() !== (editChannel.country || "");
    return (
        <IptvModal
            modal={DASH_MODALS.iptvChannelEdit}
            id="iptv-ch-edit-t"
            avatar={<ChannelLogo src={editChannel.logo} name={editChannel.name} />}
            title="Edit channel"
            subtitle={editChannel.name}
            dense
            busy={editChannelMutation.isPending}
            onClose={closeEditChannelModal}
            error={editChannelMutation.error ? apiError(editChannelMutation.error) : null}
            note={<DirtyNote dirty={changes.length > 0} />}
            actions={
                <>
                    <ModalButton onClick={closeEditChannelModal} disabled={editChannelMutation.isPending}>
                        Cancel
                    </ModalButton>
                    <ModalButton variant="primary" className="gap-1.5" onClick={saveChannelEdit} disabled={!editChName.trim()} loading={editChannelMutation.isPending} loadingText="Saving…">
                        <Check size={14} />
                        Save changes
                    </ModalButton>
                </>
            }>
            <Field label="Channel name" htmlFor="iptv-ch-name" changed={nameCh} onReset={() => setEditChName(editChannel.name || "")}>
                <TextInput id="iptv-ch-name" data-autofocus changed={nameCh} value={editChName} onChange={(e) => setEditChName(e.target.value)} />
            </Field>
            <div className="grid shrink-0 grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Category" htmlFor="iptv-ch-category" changed={catCh} onReset={() => setEditChCategory(editChannel.category || "")}>
                    <TextInput id="iptv-ch-category" changed={catCh} value={editChCategory} onChange={(e) => setEditChCategory(e.target.value)} />
                </Field>
                <Field label="Country" htmlFor="iptv-ch-country" changed={couCh} onReset={() => setEditChCountry(editChannel.country || "")}>
                    <TextInput id="iptv-ch-country" changed={couCh} value={editChCountry} onChange={(e) => setEditChCountry(e.target.value)} />
                </Field>
            </div>
            <Field label="Stream URL" hint="read only">
                <div className={`${FIELD} bg-base-200/40`}>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-base-content/80" title={editChannel.url}>
                        {editChannel.url ?? "—"}
                    </span>
                    {editChannel.url && <ModalCopyButton text={editChannel.url} label="stream URL" />}
                </div>
            </Field>
            <ModalStats
                items={[
                    { icon: ListVideo, tone: "text-info", label: "Group", value: editChannel.group || "—" },
                    { icon: Clock, tone: "text-warning", label: "Status", value: iptvCap(channelStatus(editChannel)) },
                    { icon: Globe2, tone: "text-accent", label: "Host", value: addr.ok ? addr.host : "—", mono: true },
                ]}
            />
            <ModalReview
                changes={changes}
                saved={[
                    { name: "Name", value: editChannel.name },
                    { name: "Category", value: editChannel.category },
                    { name: "Country", value: editChannel.country },
                ]}
                className="mt-auto"
            />
        </IptvModal>
    );
}

export function IptvActiveEditModal({
    activeEditForm,
    editActiveChannel,
    setActiveEditForm,
    editActiveMutation,
    uploadActiveLogoMutation,
    closeEditActiveModal,
    saveActiveChannelEdit,
    activeLogoInputRef,
    setActiveLogoFile,
}) {
    const changes = ["name", "logo", "category", "country", "group", "url"]
        .filter((k) => (activeEditForm[k] || "").trim() !== (editActiveChannel[k] || ""))
        .map((k) => ({ name: iptvCap(k), from: editActiveChannel[k] || "—", to: (activeEditForm[k] || "").trim() || "—" }));
    const setF = (k) => (e) => setActiveEditForm((f) => ({ ...f, [k]: e.target.value }));
    const chg = (k) => (activeEditForm[k] || "").trim() !== (editActiveChannel[k] || "");
    const rst = (k) => () => setActiveEditForm((f) => ({ ...f, [k]: editActiveChannel[k] || "" }));
    return (
        <IptvModal
            modal={DASH_MODALS.iptvActiveEdit}
            id="iptv-active-edit-t"
            avatar={<ChannelLogo src={editActiveChannel.logo} name={editActiveChannel.name} />}
            title="Edit active channel"
            subtitle={editActiveChannel.name}
            dense
            busy={editActiveMutation.isPending || uploadActiveLogoMutation.isPending}
            onClose={closeEditActiveModal}
            error={editActiveMutation.error || uploadActiveLogoMutation.error ? apiError(editActiveMutation.error) || apiError(uploadActiveLogoMutation.error) : null}
            note={<DirtyNote dirty={changes.length > 0} />}
            actions={
                <>
                    <ModalButton onClick={closeEditActiveModal} disabled={editActiveMutation.isPending}>
                        Cancel
                    </ModalButton>
                    <ModalButton
                        variant="primary"
                        className="gap-1.5"
                        onClick={saveActiveChannelEdit}
                        disabled={!activeEditForm.name.trim()}
                        loading={editActiveMutation.isPending}
                        loadingText="Saving…">
                        <Check size={14} />
                        Save changes
                    </ModalButton>
                </>
            }>
            <input
                ref={activeLogoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    setActiveLogoFile(file);
                    if (file) uploadActiveLogoMutation.mutate({ id: editActiveChannel.id, file });
                }}
            />
            <Field label="Logo" htmlFor="iptv-active-logo" changed={chg("logo")} onReset={rst("logo")}>
                <div className="flex items-center gap-3">
                    <ChannelLogo src={activeEditForm.logo.trim()} name={activeEditForm.name} size="size-[42px]" />
                    <div className="min-w-0 flex-1">
                        <TextInput id="iptv-active-logo" mono changed={chg("logo")} placeholder="https://…" value={activeEditForm.logo} onChange={setF("logo")} />
                    </div>
                    <ModalButton className="h-[42px] shrink-0 gap-1.5 px-4" onClick={() => activeLogoInputRef.current?.click()} loading={uploadActiveLogoMutation.isPending} loadingText="Uploading…">
                        <Upload size={14} />
                        Upload
                    </ModalButton>
                </div>
            </Field>
            <Field label="Channel name" htmlFor="iptv-active-name" changed={chg("name")} onReset={rst("name")}>
                <TextInput id="iptv-active-name" data-autofocus changed={chg("name")} value={activeEditForm.name} onChange={setF("name")} />
            </Field>
            <div className="grid shrink-0 grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="Category" htmlFor="iptv-active-category" changed={chg("category")} onReset={rst("category")}>
                    <TextInput id="iptv-active-category" changed={chg("category")} value={activeEditForm.category} onChange={setF("category")} />
                </Field>
                <Field label="Country" htmlFor="iptv-active-country" changed={chg("country")} onReset={rst("country")}>
                    <TextInput id="iptv-active-country" changed={chg("country")} value={activeEditForm.country} onChange={setF("country")} />
                </Field>
                <Field label="Group" htmlFor="iptv-active-group" changed={chg("group")} onReset={rst("group")}>
                    <TextInput id="iptv-active-group" changed={chg("group")} value={activeEditForm.group} onChange={setF("group")} />
                </Field>
            </div>
            <Field label="Stream URL" htmlFor="iptv-active-url" changed={chg("url")} onReset={rst("url")}>
                <TextInput id="iptv-active-url" mono changed={chg("url")} value={activeEditForm.url} onChange={setF("url")} />
            </Field>
            <ModalReview changes={changes} saved={["name", "category", "country", "group"].map((k) => ({ name: iptvCap(k), value: editActiveChannel[k] }))} className="mt-auto" />
        </IptvModal>
    );
}

export function IptvSourceDeleteModal({ confirmDeleteSource, deleteMutation, setConfirmDeleteSource }) {
    return (
        <IptvModal
            modal={DASH_MODALS.iptvSourceDelete}
            id="iptv-del-src-t"
            icon={Trash2}
            tone="error"
            title={`Delete ${confirmDeleteSource.name}?`}
            subtitle="Playlist source"
            busy={deleteMutation.isPending}
            onClose={() => setConfirmDeleteSource(null)}
            error={deleteMutation.error ? apiError(deleteMutation.error) : null}
            actions={
                <>
                    <ModalButton onClick={() => setConfirmDeleteSource(null)} disabled={deleteMutation.isPending} data-autofocus>
                        Cancel
                    </ModalButton>
                    <ModalButton variant="danger" className="gap-1.5" onClick={() => deleteMutation.mutate(confirmDeleteSource.id)} loading={deleteMutation.isPending} loadingText="Deleting…">
                        <Trash2 size={14} />
                        Delete source
                    </ModalButton>
                </>
            }>
            <ModalSection label="You are about to delete">
                <TargetCard
                    avatar={
                        <span className="grid size-10 shrink-0 place-items-center rounded-full border border-base-content/10 bg-base-200">
                            {confirmDeleteSource.type === "url" ? <LinkIcon size={16} className="text-info" /> : <FileText size={16} className="text-info" />}
                        </span>
                    }
                    title={confirmDeleteSource.name || "Source"}
                    sub={confirmDeleteSource.location}
                    mono
                    badge={<ModalBadge tone="info">{confirmDeleteSource.type === "url" ? "URL" : "File"}</ModalBadge>}
                />
            </ModalSection>
            <ModalStats
                items={[
                    { icon: Tv, tone: "text-error", label: "Channels removed", value: confirmDeleteSource.channelCount?.toLocaleString?.() ?? confirmDeleteSource.channelCount ?? "—" },
                    { icon: FileText, tone: "text-info", label: "Format", value: confirmDeleteSource.format ?? "—" },
                    { icon: Clock, tone: "text-warning", label: "Added", value: iptvFmtDate(confirmDeleteSource.date) },
                ]}
            />
            <ModalBullets
                items={[
                    { icon: Trash2, tone: "text-error", text: "Every channel ingested from this source is removed too." },
                    { icon: RefreshCw, tone: "text-warning", text: "You would need to re-add the playlist to get them back." },
                ]}
            />
            <ModalCallout tone="error" icon={AlertTriangle} compact className="mt-auto">
                This can’t be undone.
            </ModalCallout>
        </IptvModal>
    );
}

export function IptvChannelDeleteModal({ confirmHideChannel, hideChannelMutation, setConfirmHideChannel, hideChannel }) {
    return (
        <IptvModal
            modal={DASH_MODALS.iptvChannelDelete}
            id="iptv-del-ch-t"
            icon={Trash2}
            tone="error"
            title={`Delete ${confirmHideChannel.name}?`}
            subtitle="Hidden everywhere in FLUX"
            busy={hideChannelMutation.isPending}
            onClose={() => setConfirmHideChannel(null)}
            error={hideChannelMutation.error ? apiError(hideChannelMutation.error) : null}
            actions={
                <>
                    <ModalButton onClick={() => setConfirmHideChannel(null)} disabled={hideChannelMutation.isPending} data-autofocus>
                        Cancel
                    </ModalButton>
                    <ModalButton variant="danger" className="gap-1.5" onClick={() => hideChannel(confirmHideChannel)} loading={hideChannelMutation.isPending} loadingText="Deleting…">
                        <Trash2 size={14} />
                        Delete channel
                    </ModalButton>
                </>
            }>
            <ModalSection label="You are about to delete">
                <TargetCard
                    avatar={<ChannelLogo src={confirmHideChannel.logo} name={confirmHideChannel.name} />}
                    title={confirmHideChannel.name || "Channel"}
                    sub={[confirmHideChannel.country, confirmHideChannel.group].filter(Boolean).join(" · ") || undefined}
                />
            </ModalSection>
            <ModalStats
                items={[
                    { icon: Globe2, tone: "text-info", label: "Country", value: confirmHideChannel.country || "—" },
                    { icon: ListVideo, tone: "text-accent", label: "Group", value: confirmHideChannel.group || "—" },
                    { icon: Satellite, tone: "text-warning", label: "Category", value: confirmHideChannel.category || "—" },
                ]}
            />
            <ModalBullets
                items={[
                    { icon: EyeOff, tone: "text-error", text: "Hidden in both the player and the dashboard." },
                    { icon: FileText, tone: "text-success", text: "The source playlist file itself is unchanged." },
                    { icon: RotateCcw, tone: "text-warning", text: "It comes back only if you restore it, or the source is deleted and re-added." },
                ]}
            />
        </IptvModal>
    );
}
