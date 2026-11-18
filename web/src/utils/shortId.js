// web/src/Utils/shortId.js
// Short aliases for the long media ids, so the address bar shows /media/WPr6c9UPq instead of 100+ characters.
// The hash below is IDENTICAL to server/utils/system/shortIds.js — same input, same 9 characters on both sides.
// Internally the app keeps using the long id (history, watchlist, progress …); only URLs carry the alias.

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const SHORT_LEN = 9;
const SHORT_RE = /^[0-9A-Za-z]{9}$/;
const STORE_KEY = "flux:shortIds";
const MAX_REMEMBERED = 2000;

function cyrb53(str) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
function toBase62(n) {
    let s = "";
    for (let i = 0; i < SHORT_LEN; i++) {
        s = ALPHABET[n % 62] + s;
        n = Math.floor(n / 62);
    }
    return s;
}

export const shortOf = (longId) => toBase62(cyrb53(String(longId)));
export const isShortId = (s) => typeof s === "string" && SHORT_RE.test(s);

// Same test as the server: a media id is base64url of a file path / "series:…" / "season:…" / "part:…".
const NOT_MEDIA = /^(?:https?|rtmp|rtsp|udp|mms|file|data):/i;
export function isMediaId(s) {
    if (typeof s !== "string" || s.length < 11 || !/^[A-Za-z0-9_-]+$/.test(s)) return false;
    let text;
    try {
        const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
        const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
        text = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    } catch {
        return false;
    }
    if (text.length < 3 || /[\u0000-\u001f\ufffd]/.test(text)) return false;
    if (NOT_MEDIA.test(text)) return false;
    return /^(?:[A-Za-z]:[\\/]|\/|[a-z]+:)/.test(text);
}

// short → long, filled whenever a link is built, so in-app navigation resolves instantly (no request).
const known = new Map();
let loaded = false;
function load() {
    if (loaded) return;
    loaded = true;
    try {
        const obj = JSON.parse(sessionStorage.getItem(STORE_KEY) || "{}");
        for (const [s, l] of Object.entries(obj)) known.set(s, l);
    } catch {
        /* storage unavailable — fine */
    }
}
let saveTimer = null;
function persist() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        try {
            const entries = [...known].slice(-MAX_REMEMBERED);
            sessionStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(entries)));
        } catch {
            /* ignore */
        }
    }, 500);
}
export function rememberLongId(longId) {
    load();
    const s = shortOf(longId);
    if (known.get(s) !== longId) {
        known.set(s, longId);
        persist();
    }
    return s;
}
export function lookupLongId(short) {
    load();
    return known.get(short) || null;
}

/** What to put in a URL for this media id: the 9-char alias for library ids, the id itself otherwise (tmdb-…). */
export function routeId(id) {
    if (id == null) return "";
    const s = String(id);
    return isMediaId(s) ? rememberLongId(s) : encodeURIComponent(s);
}
