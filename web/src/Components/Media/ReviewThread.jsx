// ============================================================================
// ReviewThread.jsx — shared pieces of the review system's UI (no page, no modal in here)
// File: web/src/Components/Media/ReviewThread.jsx
//
// The discussion itself lives on its own PAGE: Pages/Review/ReviewPage.jsx (route /review/:id).
// This file holds what the cards, the page and the dialogs share:
//   REACTIONS · ReactionBar · StarRating · Avatar · Composer · CommentRow · timeAgo · avatarUrl
//   useDominantColor (card / page tint from the artwork) · fmtLongDate · fmtCount
//   seedReactions / seedCount — the placeholder reaction numbers (see PLACEHOLDER_REACTIONS below)
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { Star, StarHalf, Smile, Pencil, Trash2, Send } from "lucide-react";
import { API_BASE_URL } from "../../Api/client";

// ─── shared bits ──────────────────────────────────────────────────────────────


// ─── placeholder reaction numbers ─────────────────────────────────────────────
// TMDB (and OMDb) have no reactions for reviews, so a fresh review would show 0 everywhere. While
// PLACEHOLDER_REACTIONS is true, every REVIEW shows at least a steady placeholder number (3–10, derived from its id,
// so it never changes between reloads or users) and your users' real reactions take over:
//     shown = max(others, placeholder) + yours → YOUR own reaction is always added on top, so a like / unlike is
//                                              visible (+1 / -1) at once; others' reactions fill the placeholder first and
//                                              anything above 10 is always the real count.
// It is display-only: nothing fake is ever sent to or stored on the server (reviews.json holds real reactions only).
// Comments / replies are never padded. Set to false to show real numbers only.
export const PLACEHOLDER_REACTIONS = true;
const PLACEHOLDER_MIN = 3;
const PLACEHOLDER_MAX = 10;

export function placeholderBase(id) {
    let h = 2166136261; // FNV-1a
    for (const ch of String(id)) {
        h ^= ch.charCodeAt(0);
        h = Math.imul(h, 16777619);
    }
    return PLACEHOLDER_MIN + ((h >>> 0) % (PLACEHOLDER_MAX - PLACEHOLDER_MIN + 1));
}

/** a plain number (Home cards): max(others, placeholder) + yours — `own` = the viewer has reacted (that reaction is inside `n`) */
export function seedCount(n, id, own = false) {
    if (!PLACEHOLDER_REACTIONS) return n || 0;
    const mine = own ? 1 : 0;
    return Math.max(Math.max(0, (n || 0) - mine), placeholderBase(id)) + mine;
}

/** a reaction summary { counts, total, mine }: the missing part up to the placeholder is shown as 👍 / ❤️ (your own reaction never counts toward it) */
export function seedReactions(summary, id) {
    const s = summary || { counts: {}, total: 0, mine: null };
    if (!PLACEHOLDER_REACTIONS) return s;
    const others = Math.max(0, (s.total || 0) - (s.mine ? 1 : 0));
    const rest = Math.max(0, placeholderBase(id) - others);
    if (!rest) return s;
    const like = Math.ceil(rest * 0.65);
    const counts = { ...s.counts };
    if (like) counts.like = (counts.like || 0) + like;
    if (rest - like) counts.love = (counts.love || 0) + (rest - like);
    return { ...s, counts, total: (s.total || 0) + rest };
}

// ─── formatting ───────────────────────────────────────────────────────────────
export const fmtCount = (n) => (n == null ? null : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
/** "just now" · "12 min ago" · "9 hr ago" · "1 day ago" · then the full date ("19 July 2026") — the card style */
export function smartDate(iso) {
    if (!iso) return "";
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
    if (s < 172800) return "1 day ago";
    return fmtLongDate(iso);
}
export const fmtLongDate = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : null);

// ─── artwork colour → tint (cards + review page) ──────────────────────────────
const dominantCache = new Map(); // art url → [r, g, b] | null

// Average colour of the artwork (16×16 sample, near-black / near-white ignored). Falls back to null (the caller then uses
// a theme colour) if the image host blocks canvas reads.
export function useDominantColor(src) {
    const [rgb, setRgb] = useState(() => (src ? (dominantCache.get(src) ?? null) : null));
    useEffect(() => {
        if (!src) {
            setRgb(null);
            return undefined;
        }
        if (dominantCache.has(src)) {
            setRgb(dominantCache.get(src));
            return undefined;
        }
        let alive = true;
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            let out = null;
            try {
                const c = document.createElement("canvas");
                c.width = c.height = 16;
                const ctx = c.getContext("2d", { willReadFrequently: true });
                ctx.drawImage(img, 0, 0, 16, 16);
                const d = ctx.getImageData(0, 0, 16, 16).data;
                let r = 0;
                let g = 0;
                let b = 0;
                let n = 0;
                for (let i = 0; i < d.length; i += 4) {
                    const lum = (d[i] + d[i + 1] + d[i + 2]) / 3;
                    if (lum < 24 || lum > 230) continue;
                    r += d[i];
                    g += d[i + 1];
                    b += d[i + 2];
                    n++;
                }
                if (n) out = [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
            } catch {
                /* canvas tainted — keep the neutral tint */
            }
            dominantCache.set(src, out);
            if (alive) setRgb(out);
        };
        img.onerror = () => dominantCache.set(src, null);
        img.src = src;
        return () => {
            alive = false;
        };
    }, [src]);
    return rgb;
}

export const REACTIONS = [
    { type: "like", emoji: "👍", label: "Like" },
    { type: "love", emoji: "❤️", label: "Love" },
    { type: "funny", emoji: "😂", label: "Funny" },
    { type: "wow", emoji: "😮", label: "Wow" },
    { type: "sad", emoji: "😢", label: "Sad" },
    { type: "dislike", emoji: "👎", label: "Dislike" },
];
const EMOJI = Object.fromEntries(REACTIONS.map((r) => [r.type, r.emoji]));

/** avatar value from the server: full URL → as is · "/path" → on the API host · nothing → null (initials are shown) */
export function avatarUrl(a) {
    if (!a) return null;
    if (/^(https?:|data:)/i.test(a)) return a;
    return `${API_BASE_URL}${a.startsWith("/") ? "" : "/"}${a}`;
}

export function timeAgo(iso) {
    if (!iso) return "";
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return "just now";
    const steps = [
        [60, "m"],
        [3600, "h"],
        [86400, "d"],
        [604800, "w"],
        [2592000, "mo"],
        [31536000, "y"],
    ];
    let label = `${Math.floor(s / 60)}m`;
    for (const [sec, unit] of steps) if (s >= sec) label = `${Math.floor(s / sec)}${unit}`;
    return `${label} ago`;
}

// 0–10 rating → 5 stars (halves allowed). `light` = white stars for use on the dark popular cards.
export function StarRating({ rating, max = 10, size = 13, light = false }) {
    if (rating == null) return null;
    const exact = (rating / max) * 5;
    const full = Math.floor(exact);
    const hasHalf = exact - full >= 0.25 && exact - full < 0.75;
    const roundedFull = exact - full >= 0.75 ? full + 1 : full;
    const on = light ? "text-white fill-white" : "text-warning fill-warning";
    const off = light ? "text-white/35 fill-white/10" : "text-base-content/20 fill-base-content/10";
    return (
        <div className="flex items-center gap-0.5">
            {Array.from({ length: 5 }).map((_, i) => {
                if (i < roundedFull) return <Star key={i} size={size} className={on} />;
                if (i === roundedFull && hasHalf) return <StarHalf key={i} size={size} className={on} />;
                return <Star key={i} size={size} className={off} />;
            })}
        </div>
    );
}

export function Avatar({ src, name, size = 32 }) {
    const [bad, setBad] = useState(false);
    const url = avatarUrl(src);
    const style = { width: size, height: size, fontSize: Math.max(11, size * 0.4) };
    if (url && !bad) return <img src={url} alt={name || ""} onError={() => setBad(true)} style={style} className="shrink-0 rounded-full object-cover ring-1 ring-white/10" draggable={false} />;
    return (
        <div style={style} className="flex shrink-0 items-center justify-center rounded-full bg-primary/20 font-bold text-primary ring-1 ring-white/10">
            {(name || "?")[0].toUpperCase()}
        </div>
    );
}

/**
 * ReactionBar — chips for the reactions people gave (tap one to give / remove yours) + a smiley that opens the picker.
 *   summary { counts, total, mine } · onReact(type | null) · compact = smaller, for comments
 */
export function ReactionBar({ summary, onReact, compact = false }) {
    const [open, setOpen] = useState(false);
    const box = useRef(null);
    const s = summary || { counts: {}, total: 0, mine: null };

    useEffect(() => {
        if (!open) return undefined;
        const close = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
    }, [open]);

    const chips = Object.entries(s.counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, compact ? 3 : 6);
    const pick = (type) => {
        setOpen(false);
        onReact?.(s.mine === type ? null : type);
    };
    const chip = compact ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-1 text-xs";

    return (
        <div ref={box} className="relative flex flex-wrap items-center gap-1.5">
            {chips.map(([type, n]) => (
                <button
                    key={type}
                    type="button"
                    onClick={() => pick(type)}
                    className={`flex cursor-pointer items-center gap-1 rounded-full border transition-colors ${chip} ${s.mine === type ? "border-primary/60 bg-primary/15 text-white" : "border-white/10 bg-base-300/60 text-base-content/80 hover:border-white/25"}`}>
                    <span>{EMOJI[type]}</span>
                    <span className="font-semibold tabular-nums">{n}</span>
                </button>
            ))}
            <button type="button" onClick={() => setOpen((v) => !v)} aria-label="React" className={`flex cursor-pointer items-center gap-1 rounded-full text-base-content/60 transition-colors hover:text-white ${compact ? "px-1 py-0.5 text-[11px]" : "px-2 py-1 text-xs"}`}>
                <Smile size={compact ? 13 : 15} />
                {!chips.length && <span className="font-medium">React</span>}
            </button>

            {open && (
                <div className="absolute bottom-full left-0 z-30 mb-1.5 flex gap-0.5 rounded-full border border-white/10 bg-base-100 px-2 py-1.5 shadow-2xl">
                    {REACTIONS.map((r) => (
                        <button key={r.type} type="button" title={r.label} onClick={() => pick(r.type)} className={`cursor-pointer rounded-full px-1.5 text-xl leading-none transition-transform hover:scale-125 ${s.mine === r.type ? "bg-primary/20" : ""}`}>
                            {r.emoji}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── composer ─────────────────────────────────────────────────────────────────
// variant "line" (default): underline field, used for replies · variant "pill": rounded field with an inside Send button,
// used for the main "Leave a comment" box on the review page.

export function Composer({ user, placeholder, initial = "", submitLabel = "Send", onSubmit, onCancel, autoFocus = false, pending = false, max = 2000, compact = false, variant = "line" }) {
    const [text, setText] = useState(initial);
    const ref = useRef(null);
    const grow = (el) => {
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    };
    useEffect(() => {
        if (autoFocus && ref.current) {
            ref.current.focus();
            ref.current.setSelectionRange(ref.current.value.length, ref.current.value.length);
        }
        if (ref.current) grow(ref.current);
    }, [autoFocus]);

    const send = () => {
        const v = text.trim();
        if (!v || pending) return;
        onSubmit(v, () => {
            setText("");
            if (ref.current) ref.current.style.height = "auto";
        });
    };
    const onKeyDown = (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
        }
    };
    const onChange = (e) => {
        setText(e.target.value);
        grow(e.target);
    };

    if (variant === "pill") {
        return (
            <div className="flex items-start gap-3">
                <Avatar src={user?.avarter ?? user?.avatar} name={user?.name} size={40} />
                <div className="flex min-w-0 flex-1 items-end gap-2 rounded-2xl border border-white/10 bg-base-100/70 py-1.5 pl-4 pr-2 transition-colors focus-within:border-primary">
                    <textarea
                        ref={ref}
                        rows={1}
                        value={text}
                        maxLength={max}
                        disabled={pending}
                        placeholder={placeholder}
                        onChange={onChange}
                        onKeyDown={onKeyDown}
                        className="block max-h-40 w-full resize-none border-0 bg-transparent px-0 py-1.5 text-[14px] text-base-content placeholder:text-base-content/45 focus:outline-none"
                    />
                    <button
                        type="button"
                        onClick={send}
                        disabled={!text.trim() || pending}
                        aria-label={submitLabel}
                        className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-content transition-colors hover:bg-primary/85 disabled:cursor-default disabled:opacity-35">
                        <Send size={15} />
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex items-start gap-3">
            <Avatar src={user?.avarter ?? user?.avatar} name={user?.name} size={compact ? 28 : 34} />
            <div className="min-w-0 flex-1">
                <textarea
                    ref={ref}
                    rows={1}
                    value={text}
                    maxLength={max}
                    disabled={pending}
                    placeholder={placeholder}
                    onChange={onChange}
                    onKeyDown={onKeyDown}
                    className="block w-full resize-none border-0 border-b border-white/20 bg-transparent px-0 py-1.5 text-[13.5px] text-base-content placeholder:text-base-content/40 focus:border-primary focus:outline-none"
                />
                {(text.trim() || onCancel) && (
                    <div className="mt-2 flex items-center justify-end gap-2">
                        {text.length > max * 0.85 && (
                            <span className="mr-auto text-[11px] text-base-content/50">
                                {text.length}/{max}
                            </span>
                        )}
                        {onCancel && (
                            <button type="button" onClick={onCancel} className="cursor-pointer rounded-full px-3 py-1 text-xs font-semibold text-base-content/70 hover:text-white">
                                Cancel
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={send}
                            disabled={!text.trim() || pending}
                            className="flex cursor-pointer items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-primary-content transition-colors hover:bg-primary/85 disabled:cursor-default disabled:opacity-40">
                            {pending ? "Sending…" : submitLabel}
                            {!pending && <Send size={11} />}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── one comment — YouTube / Facebook layout ──────────────────────────────────
// avatar on the left, everything else in ONE aligned column: name + time · text · reactions · Reply (· edit / delete on the far right).
// Answers are indented by the page so they line up with this column's text (avatar width + gap).

export function CommentRow({ c, small = false, onReact, onReply, onEdit, onDelete, editing, onSaveEdit, onCancelEdit, pending, user }) {
    return (
        <div className="flex items-start gap-3">
            <Avatar src={c.author.avatar} name={c.author.name} size={small ? 28 : 40} />
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 leading-tight">
                    <span className="text-[13px] font-bold text-white">{c.author.name}</span>
                    <span className="text-[12px] text-base-content/50">{timeAgo(c.createdAt)}</span>
                    {c.edited && <span className="text-[12px] text-base-content/40">(edited)</span>}
                </div>

                {editing ? (
                    <div className="mt-1.5">
                        <Composer user={user} initial={c.content} submitLabel="Save" onSubmit={(v) => onSaveEdit(c, v)} onCancel={onCancelEdit} autoFocus pending={pending} compact />
                    </div>
                ) : (
                    <p className="mt-1 whitespace-pre-line break-words text-[14px] leading-[1.45] text-base-content/92 [overflow-wrap:anywhere]">
                        {c.replyToName && <span className="font-semibold text-primary">@{c.replyToName} </span>}
                        {c.content}
                    </p>
                )}

                {!editing && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                        <ReactionBar summary={c.reactions} onReact={(type) => onReact("reply", c.id, type)} compact />
                        <button type="button" onClick={() => onReply(c)} className="cursor-pointer text-[12px] font-semibold text-base-content/65 transition-colors hover:text-white">
                            Reply
                        </button>
                        {(c.canEdit || c.canDelete) && (
                            <span className="ml-auto flex items-center gap-3">
                                {c.canEdit && (
                                    <button type="button" onClick={() => onEdit(c)} aria-label="Edit" className="cursor-pointer text-base-content/45 transition-colors hover:text-white">
                                        <Pencil size={13} />
                                    </button>
                                )}
                                {c.canDelete && (
                                    <button type="button" onClick={() => onDelete(c)} aria-label="Delete" className="cursor-pointer text-base-content/45 transition-colors hover:text-error">
                                        <Trash2 size={13} />
                                    </button>
                                )}
                            </span>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
