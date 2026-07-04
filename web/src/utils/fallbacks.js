// web/src/utils/fallbacks.js
// Frontend fallback helpers. Logo.dev = primary, UI-Avatars = absolute.
// For live 404 interception use <ChannelLogo> component directly.

const UI_AVATAR_BASE = "https://ui-avatars.com/api/";
const LOGO_DEV_TOKEN = import.meta.env.VITE_LOGO_DEV_PUBLISHABLE_KEY || "";

const ABSENT = new Set(["null", "undefined", "n/a", "none", "false", "0", ""]);

export function isAbsent(val) {
    if (val === null || val === undefined) return true;
    if (typeof val === "string" && ABSENT.has(val.trim().toLowerCase())) return true;
    return false;
}

// Broken URL patterns common in M3U files
const BROKEN_PATTERNS = [
    /localhost/i,
    /example\.com/i,
    /127\.0\.0\.1/,
    /^https?:\/\/?$/,
    /placeholder/i,
    /noimage/i,
    /no[-_]?logo/i,
    /default[-_]?logo/i,
    /\s/,
    /\.gif$/i,
];

export function isBrokenLink(url) {
    if (typeof url !== "string" || !url.trim()) return true;
    const u = url.trim();
    if (!/^https?:\/\/.{4,}/i.test(u)) return true;
    return BROKEN_PATTERNS.some((re) => re.test(u));
}

function nameToDomain(name) {
    return (name || "channel")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 30) + ".com";
}

function uiAvatarUrl(name) {
    const initials = (name || "?")
        .trim().split(/\s+/).slice(0, 2)
        .map((w) => w[0] || "").join("").toUpperCase() || "?";
    return `${UI_AVATAR_BASE}?name=${encodeURIComponent(initials)}&background=1e1e2e&color=a6e3a1&bold=true&size=128&font-size=0.45`;
}

// safeLogo — static URL resolution (no 404 interception; use <ChannelLogo> for that)
export function safeLogo(url, name) {
    if (!isAbsent(url) && !isBrokenLink(url)) return url;
    if (LOGO_DEV_TOKEN) {
        const domain = nameToDomain(name);
        return `https://img.logo.dev/${encodeURIComponent(domain)}?token=${LOGO_DEV_TOKEN}&fallback=monogram&size=128`;
    }
    return uiAvatarUrl(name);
}

export function safeStr(val, fallback = "Unknown") {
    return isAbsent(val) ? fallback : String(val).trim();
}

export function safePoster(url) {
    return isAbsent(url) ? "/placeholder-poster.png" : url;
}

export function safeBackdrop(url) {
    return isAbsent(url) ? "/placeholder-backdrop.png" : url;
}

export function safeChannel(ch) {
    if (!ch || typeof ch !== "object") return null;
    const name = safeStr(ch.cleanName || ch.name, "Unknown Channel");
    return {
        ...ch,
        name,
        cleanName:    name,
        logo:         safeLogo(ch.logo, name),
        country:      safeStr(ch.country, "Unknown"),
        category:     safeStr(ch.category, "General"),
        group:        safeStr(ch.group, "Other"),
        language:     safeStr(ch.language, "Unknown"),
        source:       safeStr(ch.source, "—"),
        url:          ch.url || "",
        tvgId:        ch.tvgId || null,
        streamFormat: safeStr(ch.streamFormat, "Unknown"),
        streamStatus: ch.streamStatus || "unknown",
    };
}

export function safeSource(src) {
    if (!src || typeof src !== "object") return null;
    return {
        ...src,
        name:         safeStr(src.name, "Unnamed Source"),
        location:     safeStr(src.location, "—"),
        format:       safeStr(src.format, "Unknown"),
        status:       src.status || "pending",
        channelCount: typeof src.channelCount === "number" ? src.channelCount : 0,
        error:        src.error || null,
    };
}
