// web/src/utils/fallbacks.js
// Single source of truth for all null/undefined/empty-string field handling.
// Import and use instead of scattering || "Unknown" / || null across components.

const UI_AVATAR_BASE = "https://ui-avatars.com/api/";

// Values that are semantically absent even if technically truthy strings
const ABSENT = new Set(["null", "undefined", "n/a", "none", ""]);

function isAbsent(val) {
    if (val === null || val === undefined) return true;
    if (typeof val === "string" && ABSENT.has(val.trim().toLowerCase())) return true;
    return false;
}

export function safeStr(val, fallback = "Unknown") {
    return isAbsent(val) ? fallback : String(val).trim();
}

export function safeLogo(url, name) {
    if (!isAbsent(url)) return url;
    const label =
        (name || "?")
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .map((w) => w[0] || "")
            .join("")
            .toUpperCase() || "?";
    return `${UI_AVATAR_BASE}?name=${encodeURIComponent(label)}&background=1e1e2e&color=a6e3a1&bold=true&size=128&font-size=0.45`;
}

export function safePoster(url) {
    return isAbsent(url) ? "/placeholder-poster.png" : url;
}

export function safeBackdrop(url) {
    return isAbsent(url) ? "/placeholder-backdrop.png" : url;
}

// Normalises one channel object from /api/live/channels/flat — guarantees
// every field has a usable non-null value, safe to render directly.
export function safeChannel(ch) {
    if (!ch || typeof ch !== "object") return null;
    return {
        ...ch,
        name: safeStr(ch.name, "Unknown Channel"),
        logo: safeLogo(ch.logo, ch.name),
        country: safeStr(ch.country, "Unknown"),
        category: safeStr(ch.category, "General"),
        group: safeStr(ch.group, "Other"),
        language: safeStr(ch.language, "Unknown"),
        source: safeStr(ch.source, "—"),
        url: ch.url || "",
        tvgId: safeStr(ch.tvgId, null),
        streamFormat: safeStr(ch.streamFormat, "Unknown"),
    };
}

// Normalises one IPTV source row from /api/live/sources
export function safeSource(src) {
    if (!src || typeof src !== "object") return null;
    return {
        ...src,
        name: safeStr(src.name, "Unnamed Source"),
        location: safeStr(src.location, "—"),
        format: safeStr(src.format, "Unknown"),
        status: src.status || "pending",
        channelCount: typeof src.channelCount === "number" ? src.channelCount : 0,
        error: src.error || null,
    };
}
