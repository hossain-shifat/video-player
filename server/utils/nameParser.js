"use strict";

// ─── Pre-normalize strip (applied to raw filename BEFORE dot→space conversion)
const PRE_NORMALIZE_STRIP = [
    // Site watermarks: "~ Vegamovies.to", "- Vegamovies.NL"
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
    // IMAX / HDR variants
    /\b(imax|hmax|imax\.enhanced)\b/gi,
    // Source / format — expanded list
    /\b(bluray|blu-ray|bdrip|brrip|dvdrip|dvdscr|hdtv|webrip|web-dl|webdl|web-rip|hdrip|hdcam|pre-hd|prehd|hdts|hd-ts|camrip|cam|webhd|pdvd|dvd|vhs|r5|scr)\b/gi,
    // Codec
    /\b(x264|x265|h264|h265|hevc|avc|xvid|divx|av1|vp9)\b/gi,
    // Audio — channels + codec combos
    /\b(aac|ac3|dts|mp3|flac|truehd|atmos|opus|vorbis|eac3)\b/gi,
    /\b(dd5[\s.]?1|ddp5[\s.]?1|dd[\s.]?plus|dolby[\s.]?digital|dolby[\s.]?atmos)\b/gi,
    /\b(5[\s.]?1|7[\s.]?1|2[\s.]?0)\b/g,
    /\b\d{3}kbps\b/gi,
    // HDR / bit depth
    /\b(10bit|10-bit|8bit|12bit|hdr10\+|hdr10|hdr|dovi|dolby[\s.]?vision|sdr)\b/gi,
    // Edition / repack tags
    /\b(extended|theatrical|remastered|unrated|directors[\s.]?cut|proper|rerip|readnfo|repack|retail|internal|limited)\b/gi,
    // Streaming service tags
    /\b(amzn|amazon|nf|netflix|dsnp|disney\+?|hulu|max|hbo|amc\+?|apple\s?tv\+?|peacock|paramount\+?|crkl|crav|bcore|stan|aha|zee5|hotstar|jiocinema|sonyliv)\b/gi,
    // Misc release flags
    /\b(org|proper|nfofix|dubbed|multi)\b/gi,
    // Language / subtitle tags
    /\b(hindi|english|tamil|telugu|kannada|malayalam|punjabi|bengali|marathi|gujarati|french|spanish|german|italian|japanese|korean|chinese|arabic|russian)\b/gi,
    /\b(dual[\s.]?audio|multi[\s.]?audio|hin|eng|tam|tel|kan|mal|pun|ben|ita|jpn|kor|fre|ger|spa)\b/gi,
    /\b(esub|esubs|subbed|sub|subs|subtitle|cc)\b/gi,
    // Release groups — extended list
    /\b(yts|yify|rarbg|ettv|eztv|mkvcage|tigole|psarips|tgx|flux|hdhub4u|hdhub|vegamovies|psa|galaxyrg|sparks|ntb|fgt|ion10|evo|cm|nitro|framestor|ctx|ift|nhanc3|qoq|nhanc|tepes|sujaidr|ctrlhd|d3g|d3|bhd|playbd|hallowed)\b/gi,
    // Trailing release-group token after dash: "- Uno", "- Ms", "- Tv", "- Ltd" etc.
    /\s*-\s*[A-Z][a-zA-Z]{0,5}\s*$/,
    // Bare "+" left from audio descriptions
    /\s\+\s/g,
    // Parenthesised non-year content: "(Dual Audio)" but NOT "(2009)"
    /\((?!\d{4}\))[^)]*\)/g,
    // Square brackets missed by pre-normalize (safety net)
    /\[.*?\]/g,
];

// ─── Season / episode patterns ────────────────────────────────────────────────
// Handles "S01E01", "S01 E01", "S01.E01" (dots become spaces before this runs)
const SEASON_EPISODE_RE = /[Ss](\d{1,2})\s*[Ee](\d{1,3})/;
// "Season 2"
const SEASON_ONLY_RE = /\b[Ss]eason\s*(\d{1,2})\b/i;
// Bare "S01" NOT immediately followed by whitespace+E-number
const BARE_SEASON_RE = /\b[Ss](\d{1,2})\b(?!\s*[Ee]\d)/;
// Bare "E01" / "EP01" standalone
const BARE_EPISODE_RE = /\b[Ee][Pp]?(\d{1,3})\b/;
// Multi-episode range: "E01-E03"
const MULTI_EPISODE_RE = /[Ee](\d{1,3})[-–][Ee]?(\d{1,3})/;

// Chapter / Part — handles "KGF Chapter 1", "Chapter-2", "Part II"
const PART_RE = /\b(?:chapter|part)[\s._-]?([1-9]\d?|[ivxIVX]{1,4})\b/i;

// Year — standalone 4-digit year (1900–2099), not preceded by letters
const YEAR_RE = /(?<![A-Za-z])[\s._(-]?((?:19|20)\d{2})[\s._)-]?/;

// Bare anime episode number — e.g. "- 12" or "_12" at end
const ANIME_EP_RE = /[-_\s](\d{2,3})(?:\s*[-_\(]|$)/;

// Anime hint keywords
const ANIME_HINTS = /\b(anime|BD|OVA|ONA|OAD|NCED|NCOP|[Ss]ub(?:bed)?|[\u3000-\u9fff])\b/;

// ─── Language detection ───────────────────────────────────────────────────────
// Maps every tag that can appear in a filename to its ISO 639-1 code.
// Run against `norm` BEFORE noise stripping removes the tags.
const LANG_TAG_MAP = {
    // Full words
    hindi: "hi",
    english: "en",
    tamil: "ta",
    telugu: "te",
    kannada: "kn",
    malayalam: "ml",
    punjabi: "pa",
    bengali: "bn",
    marathi: "mr",
    gujarati: "gu",
    french: "fr",
    spanish: "es",
    german: "de",
    italian: "it",
    japanese: "ja",
    korean: "ko",
    chinese: "zh",
    arabic: "ar",
    russian: "ru",
    // Short codes used in release filenames
    hin: "hi",
    eng: "en",
    tam: "ta",
    tel: "te",
    kan: "kn",
    mal: "ml",
    pun: "pa",
    ben: "bn",
    ita: "it",
    jpn: "ja",
    kor: "ko",
    fre: "fr",
    ger: "de",
    spa: "es",
};

/**
 * Extracts detected audio languages and dual/multi-audio flags from a
 * normalised filename string (before noise stripping).
 *
 * @param {string} normStr  — the normalised (dots→spaces) filename
 * @returns {{ languages: string[], dualAudio: boolean, multiAudio: boolean }}
 */
function extractLanguages(normStr) {
    const found = new Set();
    for (const [tag, code] of Object.entries(LANG_TAG_MAP)) {
        if (new RegExp(`\\b${tag}\\b`, "i").test(normStr)) found.add(code);
    }
    const dualAudio = /\bdual[\s.]?audio\b/i.test(normStr);
    const multiAudio = /\bmulti[\s.]?audio\b/i.test(normStr);
    // When dual/multi is flagged but no explicit language list was found,
    // keep the array empty — the client badge is enough.
    return {
        languages: [...found],
        dualAudio: dualAudio && !multiAudio,
        multiAudio,
    };
}

// ─── Title case word lists ────────────────────────────────────────────────────
const TITLE_LOWERCASE_WORDS = new Set(["a", "an", "the", "and", "but", "or", "nor", "for", "yet", "so", "at", "by", "in", "of", "on", "to", "up", "as", "is", "it"]);

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

/**
 * Collapse acronym-style dot notation BEFORE dots become spaces.
 * "K.G.F" → "KGF", "U.S.A." → "USA"
 *
 * Uses ([A-Za-z]\.){2,}[A-Za-z]\b so the regex backtracks when the "last
 * letter" is followed by more letters — preventing "K.G.F.Chapter" from
 * consuming the "C" of "Chapter" and producing "KGFChapter".
 */
function collapseAcronyms(str) {
    return str.replace(/\b([A-Za-z]\.){2,}[A-Za-z]\b/g, (match) => match.replace(/\./g, ""));
}

function preNormalize(str) {
    let out = str;
    for (const re of PRE_NORMALIZE_STRIP) out = out.replace(re, " ");
    out = collapseAcronyms(out);
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

/**
 * After noise stripping, join isolated single-letter sequences into acronyms.
 * "K G F" → "KGF"
 * Only collapses runs of uppercase single letters so "A New Hope" is safe.
 */
function joinAcronymTokens(str) {
    return str.replace(/\b([A-Z])(?: ([A-Z]))+\b/g, (match) => match.replace(/ /g, ""));
}

/**
 * Convert a string to proper title case.
 * - First and last word always capitalised.
 * - Articles/conjunctions/prepositions lowercased unless first/last.
 * - Uppercase sequences of ≤4 letters (acronyms) are kept as-is.
 */
function toTitleCase(str) {
    const words = str.split(" ");
    return words
        .map((word, idx) => {
            if (!word) return word;
            const lower = word.toLowerCase();
            const isFirstOrLast = idx === 0 || idx === words.length - 1;
            if (/^[A-Z]{2,4}$/.test(word)) return word;
            if (!isFirstOrLast && TITLE_LOWERCASE_WORDS.has(lower)) return lower;
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        })
        .join(" ");
}

function cleanTitle(str) {
    return str
        .replace(/[-–—:,~+]+$/, "")
        .replace(/^\s*[-–—:,~+]+/, "")
        .replace(/\s{2,}/g, " ")
        .trim();
}

// ─── Main parser ──────────────────────────────────────────────────────────────

/**
 * Parse a media filename into structured metadata.
 *
 * @param {string} filename
 * @returns {{
 *   title: string,
 *   type: "movie" | "series" | "anime",
 *   year: number | null,
 *   season: number | null,
 *   episode: number | null,
 *   episodeEnd: number | null,
 *   part: number | null,
 *   languages: string[],
 *   dualAudio: boolean,
 *   multiAudio: boolean,
 * }}
 */
function parseFilename(filename) {
    // 1. Remove file extension
    const dotIdx = filename.lastIndexOf(".");
    const raw = dotIdx !== -1 ? filename.slice(0, dotIdx) : filename;

    // 2. Strip site tags / bracket blocks and collapse acronyms BEFORE dots → spaces
    const prepped = preNormalize(raw);

    // 3. Dots & underscores → spaces
    const norm = normalizeSeparators(prepped);

    // ── Detect season / episode ───────────────────────────────────────────────
    let season = null;
    let episode = null;
    let episodeEnd = null;
    let titleRaw = norm;

    const seMatch = norm.match(SEASON_EPISODE_RE);
    if (seMatch) {
        season = parseInt(seMatch[1], 10);
        episode = parseInt(seMatch[2], 10);
        titleRaw = norm.slice(0, seMatch.index);

        // Multi-episode range immediately after: "S01E01-E03"
        const afterSE = norm.slice(seMatch.index + seMatch[0].length);
        const multiMatch = afterSE.match(/^[-–][Ee]?(\d{1,3})/);
        if (multiMatch) episodeEnd = parseInt(multiMatch[1], 10);
    } else {
        const sLong = norm.match(SEASON_ONLY_RE);
        if (sLong) {
            season = parseInt(sLong[1], 10);
            titleRaw = norm.slice(0, sLong.index);
        }

        if (season === null) {
            const sBare = norm.match(BARE_SEASON_RE);
            if (sBare) {
                season = parseInt(sBare[1], 10);
                titleRaw = norm.slice(0, sBare.index);
            }
        }

        const multiEp = titleRaw.match(MULTI_EPISODE_RE);
        if (multiEp) {
            episode = parseInt(multiEp[1], 10);
            episodeEnd = parseInt(multiEp[2], 10);
            titleRaw = titleRaw.slice(0, multiEp.index);
        } else {
            const eBare = titleRaw.match(BARE_EPISODE_RE);
            if (eBare) {
                episode = parseInt(eBare[1], 10);
                titleRaw = titleRaw.slice(0, eBare.index);
            }
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
    //
    // IMPORTANT: we search for the year in `norm` (the full normalised string),
    // not just in `titleRaw`. This is necessary because the year can appear
    // AFTER the chapter/season token in the filename — e.g.:
    //
    //   "K.G.F-Chapter.1.2018.Hindi.720p…"
    //     → norm:     "KGF-Chapter 1 2018 Hindi 720p …"
    //     → titleRaw: "KGF-"  ← year "2018" has already been cut away
    //
    // Strategy:
    //   1. Try to find the year in titleRaw first (ideal — cleanest extraction).
    //   2. Fall back to the full norm string so we never miss a year.
    //   In both cases we remove the year token from titleRaw if present there.
    //
    let year = null;

    const yearInTitle = titleRaw.match(YEAR_RE);
    if (yearInTitle) {
        year = parseInt(yearInTitle[1], 10);
        titleRaw = titleRaw.replace(yearInTitle[0], " ");
    } else {
        // Year sits after the chapter/season — find it in the full norm string
        const yearInNorm = norm.match(YEAR_RE);
        if (yearInNorm) {
            year = parseInt(yearInNorm[1], 10);
            // Also try to clean the year out of titleRaw in case it overlaps
            titleRaw = titleRaw.replace(yearInNorm[0], " ");
        }
    }

    // ── Extract languages from norm BEFORE noise stripping removes the tags ───
    const { languages, dualAudio, multiAudio } = extractLanguages(norm);

    // ── Strip noise, join acronyms, apply title case, finalise title ──────────
    let title = cleanTitle(joinAcronymTokens(stripNoise(titleRaw)));
    if (!title) {
        title = cleanTitle(joinAcronymTokens(stripNoise(norm)));
    }

    // Apply title case: "OPPENHEIMER" → "Oppenheimer"
    // but leave already-mixed-case titles alone ("Breaking Bad" stays as-is)
    const onlyAlpha = title.replace(/[^A-Za-z]/g, "");
    const isAllCaps = onlyAlpha.length > 0 && /^[^a-z]+$/.test(onlyAlpha);
    const isAllLower = onlyAlpha.length > 0 && /^[^A-Z]+$/.test(onlyAlpha);
    if (isAllCaps || isAllLower) {
        title = toTitleCase(title);
    }

    // ── Detect media type ─────────────────────────────────────────────────────
    let type = "movie";
    if (season !== null || episode !== null) {
        type = ANIME_HINTS.test(raw) ? "anime" : "series";
    } else if (ANIME_HINTS.test(raw)) {
        const animeEp = norm.match(ANIME_EP_RE);
        if (animeEp) episode = parseInt(animeEp[1], 10);
        type = "anime";
    }

    return { title, type, year, season, episode, episodeEnd, part, languages, dualAudio, multiAudio };
}

// ─── Quick self-test ──────────────────────────────────────────────────────────
// Run with: node nameParser.js
if (require.main === module) {
    const tests = [
        "3 Idiots (2009) 1080p BluRay Hindi x264.mkv",
        "Interstellar (2014) IMAX 1080p BluRay [Dual Audio] [Hindi+English] x264.mkv",
        "K.G.F-Chapter.1.2018.Hindi.720p.WEB-DL.DD5.1.ESub.x264-HDHub4u.Uno.mkv",
        "K.G.F.Chapter-2.2022.720p.Hindi.WEB-DL.5.1.ESub.x264-HDHub4u.Tv.mkv",
        "OPPENHEIMER 2023 1080p 10bit BluRay HEVC x265 [ Hindi AMZN DDP 5.1 640kbps + Eng AAC 5.1 ] ESubs PSA ~ Vegamovies.to.mkv",
        "Project Hail Mary (2026) 1080p PRE-HD [Dual Audio] [Hindi+English] x264.mkv",
        "Sitaare Zameen Par (2025) 1080p WEBRip Hindi x264.mkv",
        "Breaking.Bad.S01.E01.720p.HEVC.BluRay.Hindi.ORG-English.ESub.x265-HDHub4u.Tv.mkv",
        "Farzi.S01.E01.720p.HEVC.Hindi.WEB-DL5.1.ESub.x265-HDHub4u.Tv.mkv",
        "Money Heist S01E01 Dual Audio {Hindi-English} 720p HEVC - Vegamovies.NL.mkv",
        "Money.Heist.S02.E01.720p.10Bit.WEB-DL.Hindi.5.1-Eng.x265-HDHub4u.Ltd.mkv",
        "Stranger.Things.S01E01.1080p.10Bit.BluRay.Hindi.5.1-English.5.1.HEVC.x265-HDHub4u.Ms.mkv",
    ];

    for (const t of tests) {
        const r = parseFilename(t);
        const ep =
            r.season !== null
                ? ` S${String(r.season).padStart(2, "0")}${r.episode !== null ? "E" + String(r.episode).padStart(2, "0") : ""}${r.episodeEnd !== null ? "-E" + String(r.episodeEnd).padStart(2, "0") : ""}`
                : "";
        const yr = r.year ? ` (${r.year})` : "";
        const pt = r.part ? ` Part ${r.part}` : "";
        console.log(`[${r.type.padEnd(6)}]  "${r.title}"${yr}${ep}${pt}`);
    }
}

module.exports = { parseFilename };
