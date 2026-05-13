"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// nameParser.js — robustly extracts title / type / year / season / episode
// from messy media filenames coming from HDHub4u, Vegamovies, YTS, etc.
//
// Tested against:
//   K.G.F-Chapter.1.2018.Hindi.720p.WEB-DL.DD5.1.ESub.x264-HDHub4u.Uno.mkv
//   K.G.F.Chapter-2.2022.720p.Hindi.WEB-DL.5.1.ESub.x264-HDHub4u.Tv.mkv
//   Breaking.Bad.S01.E01.720p.HEVC.BluRay.Hindi.ORG-English.ESub.x265-HDHub4u.Tv.mkv
//   Money Heist S01E01 Dual Audio {Hindi-English} 720p HEVC - Vegamovies.NL.mkv
//   Money.Heist.S02.E09.720p.10Bit.WEB-DL.Hindi.5.1-Eng.x265-HDHub4u.Ltd.mkv
//   Farzi.S01.E01.720p.HEVC.Hindi.WEB-DL5.1.ESub.x265-HDHub4u.Tv.mkv
//   Stranger.Things.S01E01.1080p.10Bit.BluRay.Hindi.5.1-English.5.1.HEVC.x265-HDHub4u.Ms.mkv
//   3 Idiots (2009) 1080p BluRay Hindi x264.mkv
//   Interstellar (2014) IMAX 1080p BluRay [Dual Audio] [Hindi+English] x264.mkv
//   Project Hail Mary (2026) 1080p PRE-HD [Dual Audio] [Hindi+English] x264.mkv
// ─────────────────────────────────────────────────────────────────────────────

// ─── Step 1: Pre-clean BEFORE dot→space normalisation ────────────────────────
// Must happen first so "DD5.1" doesn't survive as "DD5 1" after sep normalise.
function preclean(str) {
    return (
        str
            // Audio channel notation with dots: DD5.1  7.1  5.1  2.0  DD+5.1
            .replace(/\b(?:DD[\+]?)?\d\.\d\b/g, " ")
            // Trailing release-group short tag after last dot: .Uno .Tv .Ms .NL .Ltd .Cc .Me
            .replace(/\.([A-Z][a-z]{1,3}|[A-Z]{2,4})$/, "")
            // Trailing -GroupName or -GroupName.ext e.g. -HDHub4u.Tv  -Vegamovies.NL
            .replace(/-[A-Za-z0-9]+(?:\.[A-Za-z]{2,5})?$/, "")
    );
}

// ─── Step 2: Noise-tag removal patterns ──────────────────────────────────────
const NOISE_TAGS = [
    // Resolution
    /\b(4k|2160p|1080p|720p|480p|360p|240p)\b/gi,
    // Source / streaming platform
    /\b(imax|hmax|imax[-.]?enhanced|amzn|nf|dsnp|hulu|hbo|atvp|peacock|crunchyroll)\b/gi,
    // Rip source / format
    /\b(blu[-.]?ray|bdrip|brrip|dvdrip|dvdscr|hdtv|web[-.]?rip|web[-.]?dl|webdl|hdrip|hdcam|pre[-.]?hd|prehd|hdts|hd[-.]?ts|camrip|cam|ts)\b/gi,
    // Video codec
    /\b(x264|x265|h264|h265|hevc|avc|xvid|divx|vp9|av1)\b/gi,
    // Audio codec (DD, DTS, AAC, etc.)
    /\b(aac|ac3|dts[-.]?(?:hd|ma|x)?|mp3|truehd|atmos|flac|opus|eac3|pcm)\b/gi,
    /\b(dd[\+]?\d?\.?\d?)\b/gi, // DD  DD+  DD5  DD5.1 (post-preclean leftovers)
    /\b\d\.\d\b/g, // lone channel: 5.1  7.1  2.0
    // Bit-depth / HDR / colour
    /\b(10[-.]?bit|8[-.]?bit|hdr10?[\+]?|dovi|dolby[-.]?vision|hlg|sdr)\b/gi,
    // Edition / cut
    /\b(extended|theatrical|directors?[-.]?cut|remastered|unrated|proper|rerip|readnfo|complete|season[-.]?pack)\b/gi,
    // Audio language flags
    /\b(dubbed|dual[-.]?audio|multi[-.]?(?:audio|lang)?|org(?:-[a-z]+)?|esub|subbed|sub)\b/gi,
    // Language names
    /\b(hindi|english|tamil|telugu|bengali|kannada|malayalam|punjabi|marathi|urdu|spanish|french|german|japanese|korean|chinese|arabic|russian|portuguese)\b/gi,
    // Short language codes (standalone only, not inside words)
    /\b(hin|eng|jpn|kor|chi|ara|rus)\b/gi,
    // Known release sites / groups
    /\b(hdhub4u|hdHub4u|vegamovies|filmywap|mp4moviez|bolly4u|bolly4free|khatrimaza|9xmovies|moviesflix|fzmovies|cinemavilla|tamilmv|hnmovies|yts|yify|rarbg|ettv|eztv|mkvcage|tigole|psarips|tgx|flux|1337x)\b/gi,
    // Curly braces: {Hindi-English}
    /\{[^}]*\}/g,
    // Square brackets: [Dual Audio]  [Hindi+English]
    /\[[^\]]*\]/g,
    // Parentheses that don't contain a bare 4-digit year: (WEB-DL) (H.265) etc.
    /\((?!\d{4}\))[^)]*\)/g,
    // Trailing lone single digit left by channel-notation stripping: " 1" at end
    /\s+\d\s*$/g,
];

// ─── Regex constants ──────────────────────────────────────────────────────────

// S01E01  S01.E01  S01 E01  S01-E01  S1E1
const SEASON_EPISODE_RE = /[Ss](\d{1,2})\s*[._\s-]?\s*[Ee](\d{1,3})/;
const SEASON_ONLY_RE = /\b[Ss]eason\s*(\d{1,2})\b/;
const EPISODE_ONLY_RE = /\b[Ee]pisode\s*(\d{1,4})\b/;

// Part 1 / Part I / Part II
const PART_RE = /\bpart[\s._-]?([1-9]|[ivxIVX]{1,4})\b/i;

// Year: (2009)  or bare 2009 surrounded by separators
const YEAR_RE = /\(((?:19|20)\d{2})\)|(?:^|[\s._-])((?:19|20)\d{2})(?=$|[\s._)\-])/;

// Anime bare episode: " - 01"  "_01_"  " 01 "
const ANIME_EPISODE_RE = /(?:[-_\s])(\d{2,3})(?:\s*[-_\(]|$)/;

// Anime detection hints
const ANIME_HINTS_RE = /\b(anime|BD|OVA|ONA|OAD|NCED|NCOP|[Ss]ub(?:bed)?|[\u3000-\u9fff])\b/;

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Replace dots and underscores with spaces; collapse multiple spaces */
function normalizeSeparators(str) {
    return str
        .replace(/[._]/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
}

/** Apply all noise-tag patterns */
function stripNoise(str) {
    let s = str;
    for (const re of NOISE_TAGS) s = s.replace(re, " ");
    // Clean up isolated dashes left behind
    s = s.replace(/\s+-\s+/g, " ").replace(/^[-\s]+|[-\s]+$/g, "");
    return s.replace(/\s{2,}/g, " ").trim();
}

/** Roman numeral string → integer, or null */
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

// ─── Main parser ──────────────────────────────────────────────────────────────

/**
 * Parses a raw media filename and returns structured metadata.
 *
 * @param {string} filename  — raw filename with or without extension
 * @returns {{
 *   title:   string,
 *   type:    'movie'|'series'|'anime',
 *   year:    number|null,
 *   season:  number|null,
 *   episode: number|null,
 *   part:    number|null,
 * }}
 */
function parseFilename(filename) {
    // Strip file extension
    const extIdx = filename.lastIndexOf(".");
    const base = extIdx !== -1 ? filename.slice(0, extIdx) : filename;

    // ── Phase 1: pre-clean (handles dot-notation before sep normalisation) ────
    const preCleaned = preclean(base);
    const norm = normalizeSeparators(preCleaned);

    // ── Phase 2: extract season / episode ────────────────────────────────────
    let season = null;
    let episode = null;
    let titleRaw = norm;

    const seMatch = norm.match(SEASON_EPISODE_RE);
    if (seMatch) {
        season = parseInt(seMatch[1], 10);
        episode = parseInt(seMatch[2], 10);
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

    // ── Phase 3: extract Part N (only strips "Part N", keeps "Chapter N") ────
    let part = null;
    const partMatch = titleRaw.match(PART_RE);
    if (partMatch) {
        const raw = partMatch[1];
        part = /^\d+$/.test(raw) ? parseInt(raw, 10) : romanToInt(raw);
        titleRaw = titleRaw.slice(0, partMatch.index);
    }

    // ── Phase 4: extract year ────────────────────────────────────────────────
    let year = null;
    const yearMatch = titleRaw.match(YEAR_RE);
    if (yearMatch) {
        year = parseInt(yearMatch[1] || yearMatch[2], 10);
        titleRaw = titleRaw.replace(yearMatch[0], " ");
    }

    // ── Phase 5: strip noise and clean up ────────────────────────────────────
    let title = stripNoise(titleRaw).trim();
    // Remove trailing closing paren/bracket left from year extraction
    title = title.replace(/[)\]]+$/, "");
    // Remove trailing punctuation / separators
    title = title
        .replace(/[-–—_:,\.]+$/, "")
        .replace(/^[\s\-_]+/, "")
        .trim();

    // Fallback: strip noise from the full (pre-cleaned) norm if title is empty
    if (!title) {
        title = stripNoise(normalizeSeparators(preCleaned))
            .replace(/[)\]]+$/, "")
            .replace(/[-–—_:,\.]+$/, "")
            .trim();
    }

    // ── Phase 6: determine media type ────────────────────────────────────────
    let type = "movie";
    if (season !== null || episode !== null) {
        type = ANIME_HINTS_RE.test(base) ? "anime" : "series";
    } else if (ANIME_HINTS_RE.test(base)) {
        const animeEp = norm.match(ANIME_EPISODE_RE);
        if (animeEp) {
            episode = parseInt(animeEp[1], 10);
        }
        type = "anime";
    }

    return { title, type, year, season, episode, part };
}

module.exports = { parseFilename };
