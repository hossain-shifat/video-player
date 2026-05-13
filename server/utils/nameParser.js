"use strict";

// ─── Pre-normalize strip (applied to raw filename BEFORE dot→space conversion)
// Must run first so patterns that rely on dots (e.g. site tags) still work.
const PRE_NORMALIZE_STRIP = [
    // Site watermarks anywhere in name: "~ Vegamovies.to", "- Vegamovies.NL"
    /\s*[~\-–]\s*[A-Za-z0-9]+\.[a-zA-Z]{2,4}\s*$/,
    // Square bracket blocks: [ Hindi AMZN DDP 5.1 640kbps + Eng AAC 5.1 ]
    /\[.*?\]/g,
    // Curly brace blocks: {Hindi-English}
    /\{.*?\}/g,
];

// ─── Post-normalize noise tags (applied after dot/underscore → space)
const NOISE_TAGS = [
    // Resolution
    /\b(4k|2160p|1080p|720p|480p|360p)\b/gi,
    // Source / format
    /\b(imax|hmax|imax\.enhanced)\b/gi,
    /\b(bluray|blu-ray|bdrip|brrip|dvdrip|dvdscr|hdtv|webrip|web-dl|webdl|hdrip|hdcam|pre-hd|prehd|hdts|hd-ts|camrip|cam)\b/gi,
    // Codec
    /\b(x264|x265|h264|h265|hevc|avc|xvid|divx)\b/gi,
    // Audio — also catches "5 1" "7 1" "DD5 1" etc. (dots already removed)
    /\b(aac|ac3|dts|mp3|dd5\s*1|ddp5\s*1|truehd|atmos|flac)\b/gi,
    /\b(5\s1|7\s1|2\s0)\b/g,
    /\b\d{3}kbps\b/gi,
    // HDR / bit depth
    /\b(10bit|10-bit|8bit|hdr|hdr10|dovi|dolby)\b/gi,
    // Edition / streaming service tags
    /\b(extended|theatrical|remastered|unrated|directors\s*cut|proper|rerip|readnfo|amzn|nf|dsnp|max|org)\b/gi,
    // Language / subtitle tags
    /\b(hindi|english|tamil|telugu|dubbed|dual\s*audio|multi|hin|eng|esub|esubs|sub|subbed)\b/gi,
    // Release groups
    /\b(yts|yify|rarbg|ettv|eztv|mkvcage|tigole|psarips|tgx|flux|hdhub4u|hdhub|vegamovies|psa)\b/gi,
    // Trailing release-group token after dash: "- Uno", "- Ms", "- Tv", "- Ltd"
    /\s*-\s*[A-Z][a-zA-Z]{0,5}\s*$/,
    // Bare "+" left from audio descriptions
    /\s\+\s/g,
    // Parenthesised non-year content
    /\((?!\d{4}\))[^)]*\)/g,
];

// ─── Season / episode patterns ────────────────────────────────────────────────
// Handles "S01E01", "S01 E01", "S01.E01" (dots become spaces before this runs)
const SEASON_EPISODE_RE = /[Ss](\d{1,2})\s*[Ee](\d{1,3})/;
const SEASON_ONLY_RE = /\b[Ss]eason\s*(\d{1,2})\b/i;
// Bare "S01" NOT immediately followed by whitespace+E-number
const BARE_SEASON_RE = /\b[Ss](\d{1,2})\b(?!\s*[Ee]\d)/;
// Bare "E01" / "EP01" standalone
const BARE_EPISODE_RE = /\b[Ee][Pp]?(\d{1,3})\b/;

// Chapter / Part
const PART_RE = /\b(?:chapter|part)[\s._-]?([1-9]|[ivxIVX]{1,4})\b/i;

// Year
const YEAR_RE = /[\s._(-]?((?:19|20)\d{2})[\s._)-]?/;

// Bare anime episode number
const ANIME_EP_RE = /[-_\s](\d{2,3})(?:\s*[-_\(]|$)/;

// Anime hint keywords
const ANIME_HINTS = /\b(anime|BD|OVA|ONA|OAD|NCED|NCOP|[Ss]ub(?:bed)?|[\u3000-\u9fff])\b/;

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function preNormalize(str) {
    let out = str;
    for (const re of PRE_NORMALIZE_STRIP) out = out.replace(re, " ");
    return out.trim();
}

function normalizeSeparators(str) {
    return str
        .replace(/[._]/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
}

function stripNoise(str) {
    let out = str;
    for (const re of NOISE_TAGS) out = out.replace(re, " ");
    return out.replace(/\s{2,}/g, " ").trim();
}

function cleanTitle(str) {
    return str
        .replace(/[-–—:,~+]+$/, "")
        .replace(/^\s*[-–—:,~+]+/, "")
        .replace(/\s{2,}/g, " ")
        .trim();
}

// ─── Main parser ──────────────────────────────────────────────────────────────

function parseFilename(filename) {
    // 1. Remove file extension
    const dotIdx = filename.lastIndexOf(".");
    const raw = dotIdx !== -1 ? filename.slice(0, dotIdx) : filename;

    // 2. Strip site tags / bracket blocks BEFORE dots become spaces
    const prepped = preNormalize(raw);

    // 3. Dots & underscores → spaces
    const norm = normalizeSeparators(prepped);

    // ── Detect season / episode ───────────────────────────────────────────────
    let season = null;
    let episode = null;
    let titleRaw = norm;

    const seMatch = norm.match(SEASON_EPISODE_RE);
    if (seMatch) {
        season = parseInt(seMatch[1], 10);
        episode = parseInt(seMatch[2], 10);
        titleRaw = norm.slice(0, seMatch.index);
    } else {
        // "Season 2" long form
        const sLong = norm.match(SEASON_ONLY_RE);
        if (sLong) {
            season = parseInt(sLong[1], 10);
            titleRaw = norm.slice(0, sLong.index);
        }
        // Bare "S01"
        if (season === null) {
            const sBare = norm.match(BARE_SEASON_RE);
            if (sBare) {
                season = parseInt(sBare[1], 10);
                titleRaw = norm.slice(0, sBare.index);
            }
        }
        // Bare "E01" / "EP01"
        const eBare = titleRaw.match(BARE_EPISODE_RE);
        if (eBare) {
            episode = parseInt(eBare[1], 10);
            titleRaw = titleRaw.slice(0, eBare.index);
        }
    }

    // ── Detect part / chapter ─────────────────────────────────────────────────
    let part = null;
    const partMatch = titleRaw.match(PART_RE);
    if (partMatch) {
        const val = partMatch[1];
        part = /^\d+$/.test(val) ? parseInt(val, 10) : romanToInt(val);
        titleRaw = titleRaw.slice(0, partMatch.index);
    }

    // ── Extract year ──────────────────────────────────────────────────────────
    let year = null;
    const yearMatch = titleRaw.match(YEAR_RE);
    if (yearMatch) {
        year = parseInt(yearMatch[1], 10);
        titleRaw = titleRaw.replace(yearMatch[0], " ");
    }

    // ── Strip noise and finalise title ────────────────────────────────────────
    let title = cleanTitle(stripNoise(titleRaw));
    if (!title) title = cleanTitle(stripNoise(norm));

    // ── Detect media type ─────────────────────────────────────────────────────
    let type = "movie";
    if (season !== null || episode !== null) {
        type = ANIME_HINTS.test(raw) ? "anime" : "series";
    } else if (ANIME_HINTS.test(raw)) {
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
