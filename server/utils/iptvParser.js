"use strict";

const yaml = require("js-yaml");
const { detectCountry } = require("./countryDetector");
const { classifyCategory } = require("./categoryClassifier");
const iptvOrgDb = require("./iptvOrgDb");

// Default group when none detected
const DEFAULT_GROUP = "Other";

// Pulls a resolution hint out of a channel name, mirrors nameParser.js's
// noise-tag approach but scoped to just the resolution token.
function detectResolution(name = "") {
    const m = name.match(/\b(4k|2160p|1080p|1080i|720p|576p|480p|360p|240p|hd|sd|fhd|uhd)\b/i);
    return m ? m[1].toUpperCase() : null;
}

// Guesses stream format + file extension from the URL itself
function detectStreamFormat(url = "") {
    const lower = url.toLowerCase().split("?")[0];
    if (lower.endsWith(".m3u8")) return { streamFormat: "HLS", extension: "m3u8" };
    if (lower.endsWith(".mpd")) return { streamFormat: "DASH", extension: "mpd" };
    if (lower.endsWith(".ts")) return { streamFormat: "MPEG-TS", extension: "ts" };
    if (lower.endsWith(".flv")) return { streamFormat: "RTMP/FLV", extension: "flv" };
    if (lower.startsWith("rtmp://") || lower.startsWith("rtmps://")) return { streamFormat: "RTMP", extension: null };
    if (lower.startsWith("rtsp://")) return { streamFormat: "RTSP", extension: null };
    return { streamFormat: "Unknown", extension: null };
}

// Logo must never be null in the final record — when nothing else supplies
// one, generate a deterministic initials avatar (no API key, no extra dep).
function placeholderLogo(name) {
    const initials =
        (name || "?")
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .map((w) => w[0])
            .join("")
            .toUpperCase() || "?";
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(initials)}&background=2a2a3d&color=ffffff&bold=true&size=128`;
}

function titleCase(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Builds one normalized channel record. Preserves an existing `source`
// field on the raw item (some aggregated YAML/JSON files tag source per
// channel) — otherwise falls back to the playlist's own location.
//
// Country + category are derived through multi-strategy detectors rather
// than trusting a single field — see countryDetector.js / categoryClassifier.js.
// Returns raw[key] verbatim (no trimming/coercion loss) if the key is
// present at all — undefined/null only when truly absent, so callers can
// tell "present but empty string" apart from "missing".
function presentField(raw, key) {
    return raw[key] !== undefined && raw[key] !== null ? raw[key] : undefined;
}

function normalizeChannel(raw, fallbackSource) {
    if (!raw) return null;

    // name/url: preserve byte-exact when the source object already carries
    // them directly — only the M3U-derived fallback chain gets trimmed,
    // since that path is genuinely deriving from regex matches.
    const namePresent = presentField(raw, "name");
    const name = namePresent !== undefined ? String(namePresent) : (raw.title || raw.tvgName || "").toString().trim();
    const urlPresent = presentField(raw, "url");
    const url = urlPresent !== undefined ? String(urlPresent) : (raw.stream || raw.link || "").toString().trim();
    if (!name || !url) return null;

    // group: same byte-exact rule — a deliberately empty string ("") is a
    // valid group key in some aggregated playlists and must round-trip as
    // empty, not silently collapse into "Other".
    const groupSource = presentField(raw, "group") ?? presentField(raw, "group-title") ?? presentField(raw, "category");
    const group = groupSource !== undefined ? String(groupSource) : DEFAULT_GROUP;
    // Trimmed copy used ONLY for country/category text matching below —
    // never written back to the stored channel record.
    const groupForMatching = group.trim();

    const tvgId = raw.tvgId || raw.tvg_id || raw["tvg-id"] || null;
    const tvgName = raw.tvgName || raw.tvg_name || raw["tvg-name"] || null;
    const tvgCountryRaw = raw.country || raw.tvg_country || raw["tvg-country"] || null;
    const language = raw.language || raw.tvg_language || raw["tvg-language"] || null;
    const epgSource = raw.epgSource || raw["tvg-rec"] || raw.catchup || null;

    const country = detectCountry({ tvgCountry: tvgCountryRaw, group: groupForMatching, tvgId, name, language });

    // Authoritative lookup against iptv-org/database (loaded once at server
    // startup — see iptvOrgDb.ensureLoaded(), awaited by the controller
    // before parsing begins). Falls back to our own keyword classifier +
    // whatever logo the playlist itself provided when there's no match.
    const dbMatch = iptvOrgDb.lookupSync(name, country);
    const category = dbMatch?.categories?.length ? titleCase(dbMatch.categories[0]) : classifyCategory({ group: groupForMatching, name, url });
    const rawLogo = raw.logo || raw.tvg_logo || raw["tvg-logo"] || dbMatch?.logo || null;
    const logo = rawLogo || placeholderLogo(name);
    const { streamFormat, extension } = detectStreamFormat(url);

    return {
        name,
        logo,
        group,
        country,
        category,
        language: language || null,
        resolution: raw.resolution || detectResolution(name),
        tvgId,
        tvgName,
        epgSource,
        streamFormat,
        extension,
        source: raw.source || fallbackSource,
        url,
    };
}

// ─── M3U / M3U8 ────────────────────────────────────────────────────────────
// #EXTM3U
// #EXTINF:-1 tvg-id="..." tvg-name="..." tvg-logo="..." tvg-country="XX"
//            tvg-language="..." group-title="...",Channel Name
// http://stream/url.m3u8
function parseM3U(content, fallbackSource) {
    // Strip a leading UTF-8 BOM if present — some playlist generators emit one
    // and it can otherwise sit silently at the start of the first line.
    const clean = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
    const lines = clean.split(/\r?\n/);
    const channels = [];
    let pending = null;

    const attr = (line, key) => {
        const m = line.match(new RegExp(`${key}="([^"]*)"`, "i"));
        return m ? m[1] : null;
    };

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        if (line.startsWith("#EXTINF")) {
            const nameMatch = line.match(/,(.*)$/);
            pending = {
                logo: attr(line, "tvg-logo"),
                group: attr(line, "group-title") || DEFAULT_GROUP,
                country: attr(line, "tvg-country"),
                language: attr(line, "tvg-language"),
                tvgId: attr(line, "tvg-id"),
                tvgName: attr(line, "tvg-name"),
                catchup: attr(line, "catchup") || attr(line, "tvg-rec"),
                // Prefer the text after the comma; fall back to tvg-name when
                // the line is malformed (no comma) so we never silently drop
                // an otherwise-valid channel.
                name: (nameMatch ? nameMatch[1].trim() : "") || attr(line, "tvg-name") || "",
            };
            continue;
        }

        // #EXTGRP: alternate way some playlists specify a group, applies to
        // the channel that follows
        if (line.startsWith("#EXTGRP:")) {
            if (pending && !pending.group) pending.group = line.slice(8).trim();
            else if (pending) pending._extGroup = line.slice(8).trim();
            continue;
        }

        if (line.startsWith("#")) continue; // other directives — skip

        // First non-comment line after #EXTINF is the stream URL
        if (pending) {
            const group = pending._extGroup && pending.group === DEFAULT_GROUP ? pending._extGroup : pending.group;
            channels.push(normalizeChannel({ ...pending, group, url: line }, fallbackSource));
            pending = null;
        }
    }

    return channels.filter(Boolean);
}

// ─── Shared extractor for JSON / YAML — both can be either: ────────────────
//   1. { date, channels: { GROUP: [ {name,logo,group,source,url}, ... ] } }
//   2. [ {name,logo,group,source,url}, ... ]  (flat array)
function extractChannels(parsed, fallbackSource) {
    if (!parsed) return [];

    if (Array.isArray(parsed)) {
        return parsed.map((c) => normalizeChannel(c, fallbackSource)).filter(Boolean);
    }

    if (parsed.channels && typeof parsed.channels === "object" && !Array.isArray(parsed.channels)) {
        const out = [];
        for (const [groupKey, list] of Object.entries(parsed.channels)) {
            if (!Array.isArray(list)) continue;
            for (const c of list) {
                const normalized = normalizeChannel({ group: groupKey, ...c }, fallbackSource);
                if (normalized) out.push(normalized);
            }
        }
        return out;
    }

    return [];
}

function parseJSONPlaylist(content, fallbackSource) {
    let parsed;
    try {
        parsed = JSON.parse(content);
    } catch (err) {
        console.error("[iptvParser] Invalid JSON:", err.message);
        return [];
    }
    return extractChannels(parsed, fallbackSource);
}

function parseYAMLPlaylist(content, fallbackSource) {
    let parsed;
    try {
        parsed = yaml.load(content);
    } catch (err) {
        console.error("[iptvParser] Invalid YAML:", err.message);
        return [];
    }
    return extractChannels(parsed, fallbackSource);
}

// ─── XML (XMLTV / M3U in XML wrapper) ─────────────────────────────────────
// XMLTV proper is EPG data and has no stream URLs — we fall back to treating
// the file as M3U if no <url> elements are found. Many tools wrap M3U lines
// inside XML so both are worth trying.
function parseXML(content, fallbackSource) {
    // Try M3U embedded in XML first — strip tags, parse remainder as M3U
    const stripped = content.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, "\n");
    if (stripped.includes("#EXTINF") || stripped.includes("#EXTM3U")) {
        return parseM3U(stripped, fallbackSource);
    }

    // Basic XMLTV channel extraction: <channel id="..."><display-name>Name</display-name>
    // <icon src="logo"/></channel> — note: XMLTV normally has no stream URLs,
    // so most <channel> blocks will be dropped by normalizeChannel(!url check).
    const channels = [];
    const channelRe = /<channel[^>]*>([\s\S]*?)<\/channel>/gi;
    let m;
    while ((m = channelRe.exec(content)) !== null) {
        const block = m[1];
        const nameM = block.match(/<display-name[^>]*>([^<]+)<\/display-name>/i);
        const iconM = block.match(/<icon[^>]*src="([^"]+)"/i);
        const urlM = block.match(/<url[^>]*>([^<]+)<\/url>/i);
        const groupM = block.match(/<category[^>]*>([^<]+)<\/category>/i);
        if (!nameM) continue;
        channels.push(
            normalizeChannel(
                {
                    name: nameM[1].trim(),
                    logo: iconM ? iconM[1] : null,
                    url: urlM ? urlM[1].trim() : null,
                    group: groupM ? groupM[1].trim() : null,
                },
                fallbackSource,
            ),
        );
    }
    return channels.filter(Boolean);
}

function parsePlaylist(content, format, fallbackSource) {
    switch (format) {
        case "M3U":
            return parseM3U(content, fallbackSource);
        case "YAML":
            return parseYAMLPlaylist(content, fallbackSource);
        case "JSON":
            return parseJSONPlaylist(content, fallbackSource);
        case "XML":
            return parseXML(content, fallbackSource);
        default:
            throw new Error(`Unsupported playlist format: ${format}`);
    }
}

// Guesses format from filename/URL — mirrors DashIPTV.jsx's detectFormat()
function detectFormat(name = "") {
    const lower = name.toLowerCase().split("?")[0];
    if (lower.endsWith(".m3u8") || lower.endsWith(".m3u") || lower.endsWith(".txt")) return "M3U";
    if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "YAML";
    if (lower.endsWith(".json")) return "JSON";
    if (lower.endsWith(".xml")) return "XML";
    return "Unknown";
}

module.exports = { parsePlaylist, detectFormat, normalizeChannel };
