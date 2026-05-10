"use strict";

// Tags that indicate quality/source — strip these from titles
const NOISE_TAGS = [/\b(4k|2160p|1080p|720p|480p|360p)\b/gi, /\b(imax|hmax|imax\.enhanced)\b/gi, /\b(bluray|blu-ray|bdrip|brrip|dvdrip|dvdscr|hdtv|webrip|web-dl|webdl|hdrip|hdcam|pre-hd|prehd|hdts|hd-ts|camrip|cam)\b/gi, /\b(x264|x265|h264|h265|hevc|avc|xvid|divx)\b/gi, /\b(aac|ac3|dts|mp3|dd5\.?1|truehd|atmos|flac)\b/gi, /\b(10bit|10-bit|hdr|hdr10|dovi|dolby)\b/gi, /\b(extended|theatrical|remastered|unrated|directors\.cut|proper|rerip|readnfo)\b/gi, /\b(hindi|english|tamil|telugu|dubbed|dual\.audio|multi|hin|eng)\b/gi, /\b(yts|yify|rarbg|ettv|eztv|mkvcage|tigole|psarips|tgx|flux)\b/gi, /\[.*?\]/g, /\((?!\d{4}\))[^)]*\)/g];

// Detects S01E01 or S01 patterns
const SEASON_EPISODE_RE = /[Ss](\d{1,2})[Ee](\d{1,3})/;
const SEASON_ONLY_RE = /[Ss]eason\s*(\d{1,2})/i;
const EPISODE_ONLY_RE = /[Ee]pisode\s*(\d{1,4})/i;

// Detects Part 1 / Part I patterns (for multi-part movies)
const PART_RE = /\bpart[\s._-]?([1-9]|[ivxIVX]{1,4})\b/i;

// Extracts a 4-digit year between 1900–2099
const YEAR_RE = /[\s._(-]?((?:19|20)\d{2})[\s._)-]?/;

// Anime episode number — common pattern like " - 01" or "_01_"
const ANIME_EP_RE = /[-_\s](\d{2,3})(?:\s*[-_\(]|$)/;

// Detects likely anime by keywords in the raw name
const ANIME_HINTS = /\b(anime|BD|OVA|ONA|OAD|NCED|NCOP|[Ss]ub(?:bed)?|[\u3000-\u9fff])\b/;

// Roman numeral to integer (Part I → 1, Part II → 2, etc.)
function romanToInt(str) {
    const map = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
    const s = str.toUpperCase();
    let result = 0;
    for (let i = 0; i < s.length; i++) {
        const curr = map[s[i]] || 0;
        const next = map[s[i + 1]] || 0;
        result += curr < next ? -curr : curr;
    }
    return result || null;
}

// Replaces common separators (dots, underscores) with spaces
function normalizeSeparators(str) {
    return str
        .replace(/[._]/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
}

// Strips all noise tags from a raw filename string
function stripNoise(str) {
    let out = str;
    for (const re of NOISE_TAGS) out = out.replace(re, " ");
    return out.replace(/\s{2,}/g, " ").trim();
}

/**
 * Parses a raw media filename into structured metadata.
 *
 * Returns:
 * {
 *   title:   string   — clean searchable title
 *   type:    'movie' | 'series' | 'anime'
 *   year:    number | null
 *   season:  number | null
 *   episode: number | null
 *   part:    number | null
 * }
 */
function parseFilename(filename) {
    // Remove file extension
    const ext = filename.lastIndexOf(".");
    const base = ext !== -1 ? filename.slice(0, ext) : filename;
    const norm = normalizeSeparators(base);

    // --- detect season / episode ---
    let season = null;
    let episode = null;
    let titleRaw = norm;

    const seMatch = norm.match(SEASON_EPISODE_RE);
    if (seMatch) {
        season = parseInt(seMatch[1], 10);
        episode = parseInt(seMatch[2], 10);
        // title is everything before the SxxExx marker
        titleRaw = norm.slice(0, seMatch.index);
    } else {
        const sOnly = norm.match(SEASON_ONLY_RE);
        const eOnly = norm.match(EPISODE_ONLY_RE);
        if (sOnly) {
            season = parseInt(sOnly[1], 10);
            titleRaw = norm.slice(0, sOnly.index);
        }
        if (eOnly) {
            episode = parseInt(eOnly[1], 10);
            titleRaw = titleRaw.slice(0, eOnly.index);
        }
    }

    // --- detect part number ---
    let part = null;
    const partMatch = titleRaw.match(PART_RE);
    if (partMatch) {
        const raw = partMatch[1];
        part = /^\d+$/.test(raw) ? parseInt(raw, 10) : romanToInt(raw);
        titleRaw = titleRaw.slice(0, partMatch.index);
    }

    // --- extract year ---
    let year = null;
    const yearMatch = titleRaw.match(YEAR_RE);
    if (yearMatch) {
        year = parseInt(yearMatch[1], 10);
        titleRaw = titleRaw.replace(yearMatch[0], " ");
    }

    // --- strip noise and clean up title ---
    let title = stripNoise(titleRaw).trim();
    // Remove trailing separators/punctuation
    title = title.replace(/[-–—:,]+$/, "").trim();
    if (!title)
        title = stripNoise(norm)
            .replace(/[-–—:,]+$/, "")
            .trim();

    // --- detect type ---
    let type = "movie";
    if (season !== null || episode !== null) {
        type = ANIME_HINTS.test(base) ? "anime" : "series";
    } else if (ANIME_HINTS.test(base)) {
        // Could be an anime movie or standalone episode — check for bare episode number
        const animeEp = norm.match(ANIME_EP_RE);
        if (animeEp) {
            episode = parseInt(animeEp[1], 10);
            type = "anime";
        } else {
            type = "anime";
        }
    }

    return { title, type, year, season, episode, part };
}

module.exports = { parseFilename };
