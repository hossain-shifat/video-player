"use strict";

const yaml = require("js-yaml");
const { detectCountry } = require("./countryDetector");
const { classifyCategory } = require("./categoryClassifier");
const iptvOrgDb = require("./iptvOrgDb");

// Default group when none detected
const DEFAULT_GROUP = "Other";

// ─── Resolution / quality tokens ──────────────────────────────────────────
// Maps every variant we see in the wild to a canonical label + pixel height.
const RESOLUTION_MAP = [
    // 4K variants
    { re: /\b(4k|2160p|uhd|ultra[\s._-]?hd)\b/i, label: "4K", px: 2160, hd: true, tier: 4 },
    // 1080
    { re: /\b(fhd|full[\s._-]?hd|1080p|1080i)\b/i, label: "1080p", px: 1080, hd: true, tier: 3 },
    // 720
    { re: /\b(hd|720p|hd[\s._-]?ready)\b/i, label: "720p", px: 720, hd: true, tier: 2 },
    // 576 / PAL
    { re: /\b(576p|576i|pal)\b/i, label: "576p", px: 576, hd: false, tier: 1 },
    // 480 / NTSC
    { re: /\b(480p|480i|ntsc)\b/i, label: "480p", px: 480, hd: false, tier: 1 },
    // 360
    { re: /\b360p\b/i, label: "360p", px: 360, hd: false, tier: 0 },
    // 240
    { re: /\b240p\b/i, label: "240p", px: 240, hd: false, tier: 0 },
    // Generic SD (must come AFTER hd/fhd to avoid false positive)
    { re: /\bsd\b/i, label: "SD", px: 480, hd: false, tier: 1 },
];

// Noise tokens stripped from channel name to produce cleanName.
// RULES:
//   - NEVER strip words that are part of a real channel brand (TV, Channel, Sports, Live, beIN)
//   - Only strip codec/audio/resolution tokens and bracketed junk
//   - Preserve "Channel N" patterns (Channel 24, Channel 4) by keeping numbers after "Channel"
//   - Preserve hyphenated names: "Channel-1" → "Channel 1", not "-1"
const NAME_NOISE_RES = [
    // Strip malformed M3U artifacts: CDN transform params that leak into name
    // Pattern: starts with image dimension params like "w_300,q_85/..." or "width-NNN,..."
    // These are identified by the pattern: alphanum_digits/path or width-digits,height
    // We handle these specially in extractNameMeta before applying noise rules.

    // Bracketed blocks — but only strip if content is resolution/codec/lang, not channel numbers
    // Handled inline in extractNameMeta, not here as blind regex.

    // Resolution tokens — safe to strip as standalone words
    /\b(4k|2160p|fhd|uhd|ultra[\s._-]?hd|full[\s._-]?hd|1080p|1080i|720p|hd[\s._-]?ready|576p|576i|480p|480i|360p|240p|pal|ntsc)\b/gi,
    // SD/HD only when standalone (not part of "HD+" or brand suffixes handled separately)
    /(?<![a-zA-Z])\b(sd)\b(?![a-zA-Z+])/gi,
    /(?<![a-zA-Z])\b(hd)\b(?![a-zA-Z+])/gi,
    // Codec / container noise — safe: never a channel name word
    /\b(hevc|h\.?265|h\.?264|avc|x265|x264|xvid|divx|av1|vp9)\b/gi,
    // Audio tags — safe
    /\b(aac|ac3|mp3|dts|dolby|atmos|truehd|stereo|5\.1|7\.1)\b/gi,
    // Trailing pipe quality/backup suffixes — ONLY strip when content after pipe
    // looks like a tag (HD, SD, Backup, EN, AR) not a full channel name.
    // "Channel | HD"  → strip  |  "EN | Action Hollywood" → do NOT strip here
    // (pipe-prefix CC codes handled earlier in extractNameMeta)
    /\s*\|\s*(hd|sd|fhd|uhd|4k|backup\s*\d*|copy\d*|mirror\d*)\s*$/i,
    // Trailing punctuation — but not hyphens mid-name
    /[.:,]+$/,
    /\s{2,}/g,
];

/**
 * Extracts metadata encoded in a raw channel name string.
 *
 * Returns:
 * {
 *   cleanName  — name with resolution/noise stripped, trimmed
 *   resolution — canonical label: "4K" | "1080p" | "720p" | "SD" | null
 *   resolutionPx — pixel height number: 2160 | 1080 | 720 | … | null
 *   isHD       — boolean (true for 720p+)
 *   quality    — tier 0–4 integer (higher = better), null if unknown
 *   streamTags — array of extra tag strings found in brackets/parens
 * }
 */
function extractNameMeta(name = "") {
    name = (name || "").trim();
    let resolution = null;
    let resolutionPx = null;
    let isHD = false;
    let quality = null;

    // ── FIX: #KODIPROP / M3U directive lines ────────────────────────────────
    // These are M3U metadata lines that should never become channel names.
    // They surface when a playlist has a #KODIPROP line immediately before the
    // stream URL with no intervening #EXTINF — the parser then treats the
    // KODIPROP line's text as the name. Return early with a sentinel so the
    // caller (normalizeChannel) can skip the record entirely.
    if (name.startsWith("#KODIPROP") || name.startsWith("#EXTVLCOPT") || name.startsWith("#EXTHTTP") || name.startsWith("#EXTINF")) {
        return { _skip: true, cleanName: "", resolution: null, resolutionPx: null, isHD: false, quality: null, streamTags: [] };
    }

    // ── FIX: CDN / malformed M3U attribute bleed ────────────────────────────
    // Some M3U lines have tvg-logo URLs with commas that confuse the comma
    // split, causing CDN transform params (e.g. "w_300,q_85/...") or partial
    // attribute strings to bleed into the name field.
    if (/^(?:w_\d+|h_\d+|width-\d+|height-\d+|f_auto|q_\d+|dpr_\d+|resizemode-\d+|imgsize-\d+)/.test(name) || name.includes("group-title=") || name.includes("tvg-logo=")) {
        const lqc = name.lastIndexOf('",');
        if (lqc !== -1) name = name.slice(lqc + 2).trim();
    }

    // ── FIX: # prefix (movie/channel name artefact) ──────────────────────────
    // "#Home (2021)" "#Unknown (2021)" — leading # is a playlist comment marker
    // that leaked into the name field; strip it.
    if (name.startsWith("#")) name = name.slice(1).trim();

    // ── FIX: & prefix (HTML entity artefact) ─────────────────────────────────
    // "&PICTURES" "&TV HD" "& FLIX HINDI" — literal & that should be stripped.
    // Do NOT strip & mid-name ("Kids & Teens" is valid).
    name = name.replace(/^&\s*/, "").trim();

    // ── FIX: ---LABEL(Real Name)--- / --Live(Channel)-- wrapper pattern ───────
    // "---FIFA(Bein Sports 1 Max)---"  → "Bein Sports 1 Max"
    // "--Live(Euro Sport 1)--"         → "Euro Sport 1"
    // Pattern: optional dashes, WORD, (CONTENT), optional dashes
    // The CONTENT inside () is the real channel name; the outer word is a tag.
    const wrapMatch = name.match(/^-*\w+\((.+?)\)-*$/);
    if (wrapMatch) {
        name = wrapMatch[1].trim();
    }

    // ── FIX: N. / 0. numeric index prefix ────────────────────────────────────
    // "0. Baby Shark TV" "1. Camp Spoopy" "42. SomeChannel"
    // These are playlist ordinal prefixes, not part of the real name.
    name = name.replace(/^\d+\.\s+/, "").trim();

    // ── FIX: Quality pipe-suffix — strip before prefix check ─────────────────
    // "BBC News | HD" "Sky Sports | Backup" "CNN | SD" → strip suffix tag
    // Do this BEFORE prefix check so "EN | CNN | HD" → "EN | CNN" → "CNN"
    name = name.replace(/\s*\|\s*(hd|sd|fhd|uhd|4k|backup\s*\d*|copy\d*|mirror\d*)\s*$/i, "").trim();

    // ── FIX: CC | Channel Name pipe-prefix (language/genre code prefix) ──────
    // "EN | Action Hollywood Movies" → "Action Hollywood Movies"
    // "MOV | ZB Cinema"              → "ZB Cinema"  (MOV = Movies genre tag)
    // "AR | Al Jazeera"              → "Al Jazeera"
    // Strategy: strip prefix if it is 2 chars (ISO 639-1 / ISO 3166-1) OR
    // a known playlist genre abbreviation (3-4 uppercase letters used as category).
    // Do NOT strip known broadcast brands: BBC, CNN, PBS, SKY, etc.
    const KNOWN_GENRE_PREFIXES = new Set(["MOV", "MU", "ENT", "NEWS", "GOLF", "BHOJ", "ENG", "PAN", "FB", "CR", "KIDS", "SPT", "DOC", "REL", "EDU", "LIFE", "TUR", "COOK", "FAM", "SCI", "COM"]);
    const pipePrefixMatch = name.match(/^([A-Z]{2,4})\s*\|\s*(.+)/);
    if (pipePrefixMatch) {
        const prefix = pipePrefixMatch[1];
        const rest = pipePrefixMatch[2].trim();
        // Strip if: 2-char ISO code OR known genre abbreviation
        if (prefix.length === 2 || KNOWN_GENRE_PREFIXES.has(prefix)) {
            name = rest;
        }
    }

    // ── FIX: Emoji flag prefix ────────────────────────────────────────────────
    // "🇧🇷 Brazil Sports" → "Brazil Sports"
    // Emoji flags are Regional Indicator Symbol pairs (U+1F1E0–U+1F1FF).
    // Strip leading emoji (flags or other decorative emoji) before the real name.
    name = name.replace(/^(?:[🇠-🇿]{2}|[🌀-🿿]|[☀-➿])s*/gu, "").trim();

    // ── Scan for resolution ──────────────────────────────────────────────────
    for (const entry of RESOLUTION_MAP) {
        if (entry.re.test(name)) {
            resolution = entry.label;
            resolutionPx = entry.px;
            isHD = entry.hd;
            quality = entry.tier;
            break;
        }
    }

    // ── Extract bracketed/parenthesised tags ─────────────────────────────────
    const streamTags = [];
    const bracketRe = /\[([^\]]+)\]|\(([^)]+)\)/g;
    let bm;
    while ((bm = bracketRe.exec(name)) !== null) {
        const tag = (bm[1] || bm[2]).trim();
        const isResTag = /^(4k|uhd|fhd|hd|sd|1080[pi]?|720p?|576[pi]?|480[pi]?|360p?|240p?)$/i.test(tag);
        const isCodec = /^(hevc|h\.?265|h\.?264|avc|x265|x264|xvid|divx|av1|vp9|aac|ac3|mp3|dts|dolby|atmos|truehd)$/i.test(tag);
        const isNum = /^\d+$/.test(tag);
        // Year tags like "(2021)" "(1999)" — not useful as streamTags
        const isYear = /^(19|20)\d{2}$/.test(tag);
        if (tag && !isResTag && !isCodec && !isNum && !isYear) streamTags.push(tag);
    }

    // ── Strip bracketed/parenthesised blocks from clean copy ─────────────────
    let clean = name.replace(/\[([^\]]*)\]|\(([^)]*)\)/g, (match, sq, rnd) => {
        const inner = (sq || rnd || "").trim();
        const isResTag = /^(4k|uhd|fhd|hd|sd|1080[pi]?|720p?|576[pi]?|480[pi]?|360p?|240p?)$/i.test(inner);
        const isCodec = /^(hevc|h\.?265|h\.?264|avc|x265|x264|xvid|divx|av1|vp9|aac|ac3|mp3|dts|dolby|atmos|truehd)$/i.test(inner);
        const isNum = /^\d+$/.test(inner);
        const isYear = /^(19|20)\d{2}$/.test(inner);
        // Country/region codes in brackets: [IN] [BD] [US] → strip from cleanName
        // but we already captured them in streamTags above if not res/codec/num/year
        return isResTag || isCodec || isNum ? " " : " ";
    });

    // ── Channel word preservation ─────────────────────────────────────────────
    clean = clean.replace(/\bChannel[-\s](\d+|[IVX]+)\b/gi, (m, n) => `Channel ${n}`);

    // ── Apply noise rules ────────────────────────────────────────────────────
    for (const re of NAME_NOISE_RES) {
        clean = clean.replace(re, " ");
    }

    // ── Hyphen/separator normalisation ───────────────────────────────────────
    clean = clean
        .replace(/\s{2,}/g, " ")
        .trim()
        .replace(/^[-–—_.\s]+/, "")
        .replace(/\s*-\s*(\d+)$/, " $1") // "Live-3" → "Live 3"
        .replace(/-{2,}/g, " ")
        .replace(/[-–—_.]+$/, "")
        .replace(/\s{2,}/g, " ")
        .trim();

    // ── Fallback ─────────────────────────────────────────────────────────────
    if (!clean)
        clean = name
            .trim()
            .replace(/[-–—_.:,|]+$/, "")
            .trim();

    return { cleanName: clean || name, resolution, resolutionPx, isHD, quality, streamTags };
}

// Guesses stream format + file extension from the URL itself.
// Also sniffs common IPTV server path patterns when no extension present.
function detectStreamFormat(url = "") {
    const lower = url.toLowerCase().split("?")[0];

    if (lower.endsWith(".m3u8")) return { streamFormat: "HLS", extension: "m3u8" };
    if (lower.endsWith(".mpd")) return { streamFormat: "DASH", extension: "mpd" };
    if (lower.endsWith(".ts")) return { streamFormat: "MPEG-TS", extension: "ts" };
    if (lower.endsWith(".flv")) return { streamFormat: "RTMP/FLV", extension: "flv" };
    if (lower.endsWith(".mp4")) return { streamFormat: "MP4", extension: "mp4" };

    if (lower.startsWith("rtmp://") || lower.startsWith("rtmps://")) return { streamFormat: "RTMP", extension: null };
    if (lower.startsWith("rtsp://")) return { streamFormat: "RTSP", extension: null };
    if (lower.startsWith("udp://") || lower.startsWith("rtp://")) return { streamFormat: "Multicast", extension: null };
    if (lower.startsWith("srt://")) return { streamFormat: "SRT", extension: null };

    // Common Xtream-Codes / panel paths: /live/<user>/<pass>/<id> or /streaming/...
    if (/\/live\/[^/]+\/[^/]+\/\d+/.test(lower)) return { streamFormat: "HLS", extension: "m3u8" };
    if (/\/streaming\//.test(lower)) return { streamFormat: "HLS", extension: "m3u8" };
    // Port-based heuristic: :8080 or :8088 with no extension → likely MPEG-TS
    if (/:\d{4,5}\/[^/]+$/.test(lower) && !/\.\w{2,5}$/.test(lower)) return { streamFormat: "MPEG-TS", extension: "ts" };

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

    // Advanced name parsing — run early so we can skip KODIPROP/directive records
    // before doing the expensive iptv-org DB lookup.
    const nameMeta = extractNameMeta(name);
    if (nameMeta._skip) return null; // KODIPROP / M3U directive leaked as channel name

    // Authoritative lookup against iptv-org/database (loaded once at server
    // startup — see iptvOrgDb.ensureLoaded(), awaited by the controller
    // before parsing begins). Falls back to our own keyword classifier +
    // whatever logo the playlist itself provided when there's no match.
    const dbMatch = iptvOrgDb.lookupSync(name, country);
    const category = dbMatch?.categories?.length ? titleCase(dbMatch.categories[0]) : classifyCategory({ group: groupForMatching, name, url });
    const rawLogo = raw.logo || raw.tvg_logo || raw["tvg-logo"] || dbMatch?.logo || null;
    const logo = rawLogo || placeholderLogo(name);
    const { streamFormat, extension } = detectStreamFormat(url);

    const resolution = raw.resolution || nameMeta.resolution;
    const resolutionPx = raw.resolutionPx || nameMeta.resolutionPx;
    const isHD = raw.isHD ?? nameMeta.isHD;
    const quality = raw.quality ?? nameMeta.quality;
    const streamTags = raw.streamTags || nameMeta.streamTags || [];
    // cleanName: meaningful display name with noise stripped; tvgName fallback
    const cleanName = nameMeta.cleanName || tvgName || name;

    return {
        name,
        cleanName,
        logo,
        group,
        country,
        category,
        language: language || null,
        resolution,
        resolutionPx,
        isHD,
        quality,
        streamTags,
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
            // Extract channel name robustly:
            // Standard: #EXTINF:-1 attr1="v1" attr2="v2",CHANNEL NAME
            // Malformed: #EXTINF:-1 tvg-logo="https://cdn/w_300,q_85/...",CHANNEL NAME
            //   — the logo URL contains commas, so /,(.*)$/ grabs mid-URL fragment.
            // Strategy: find the comma that comes AFTER all quoted attribute values end.
            // All attributes are key="value" pairs — so find last '",' or ',' after
            // the final closing quote of any attribute.
            let channelName = "";
            // Find where attributes section ends: last occurrence of '",' or
            // the first comma not inside a quoted string.
            const attrEnd = line.lastIndexOf('",');
            if (attrEnd !== -1) {
                // Everything after the last '", ' is the channel name
                channelName = line.slice(attrEnd + 2).trim();
            } else {
                // Fallback: no quoted attributes ended with comma — use first comma
                const firstComma = line.indexOf(",");
                channelName = firstComma !== -1 ? line.slice(firstComma + 1).trim() : "";
            }
            pending = {
                logo: attr(line, "tvg-logo"),
                group: attr(line, "group-title") || DEFAULT_GROUP,
                country: attr(line, "tvg-country"),
                language: attr(line, "tvg-language"),
                tvgId: attr(line, "tvg-id"),
                tvgName: attr(line, "tvg-name"),
                catchup: attr(line, "catchup") || attr(line, "tvg-rec"),
                name: channelName || attr(line, "tvg-name") || "",
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

    // Generic XML channel extraction — covers far more shapes than plain
    // XMLTV, since real-world "channel list" XML exports vary a lot:
    //   <channel id=".."><display-name>Name</display-name><icon src=".."/><url>..</url></channel>
    //   <channel name="X" url="Y" logo="Z" group="W" country="C"/>        (self-closing, attrs)
    //   <item><name>X</name><stream>Y</stream></item>                    (alt tag names)
    //   <url><![CDATA[http://..]]></url>                                 (CDATA-wrapped)
    // Root cause of the old bug: the previous regex required a *closing*
    // </channel> tag and only read <url>text</url> with no CDATA support —
    // self-closing tags and CDATA-wrapped urls silently produced zero matches.
    const channels = [];
    const blockRe = /<(channel|item)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/gi;
    let m;
    while ((m = blockRe.exec(content)) !== null) {
        const attrsStr = m[2] || "";
        const inner = m[4] || ""; // empty string for self-closing tags

        const attr = (key) => {
            const am = attrsStr.match(new RegExp(`${key}\\s*=\\s*"([^"]*)"`, "i")) || attrsStr.match(new RegExp(`${key}\\s*=\\s*'([^']*)'`, "i"));
            return am ? am[1] : null;
        };

        // Reads text from the first matching child tag, unwrapping CDATA,
        // or falls back to a self-closing child's src/href attribute
        // (e.g. <icon src=".."/>).
        const child = (tagNames) => {
            for (const tag of tagNames) {
                const openClose = new RegExp(`<${tag}[^>]*>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))\\s*<\\/${tag}>`, "i");
                const cm = inner.match(openClose);
                if (cm && (cm[1] || cm[2])) return (cm[1] ?? cm[2] ?? "").trim();
                const selfClosing = new RegExp(`<${tag}[^>]*\\b(?:src|href)\\s*=\\s*"([^"]*)"[^>]*\\/?>`, "i");
                const sm = inner.match(selfClosing);
                if (sm) return sm[1].trim();
            }
            return null;
        };

        const name = attr("name") || child(["display-name", "name", "title"]);
        const url = attr("url") || attr("stream") || attr("link") || child(["url", "stream", "link", "stream-url"]);
        const logo = attr("logo") || attr("icon") || child(["icon", "logo"]);
        const group = attr("group") || attr("category") || child(["category", "group"]);
        const country = attr("country") || child(["country"]);

        if (!name) continue;
        channels.push(
            normalizeChannel(
                {
                    name: name.trim(),
                    logo: logo ? logo.trim() : null,
                    url: url ? url.trim() : null,
                    group: group ? group.trim() : null,
                    country: country ? country.trim() : null,
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
