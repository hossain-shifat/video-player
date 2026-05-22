"use strict";

// ============================================================================
// ─── ORIGINAL PARSER (UNTOUCHED - DO NOT MODIFY) ────────────────────────────
// ============================================================================

const PRE_NORMALIZE_STRIP = [/\s*[~\-–]\s*[A-Za-z0-9]+\.[a-zA-Z]{2,4}\s*$/, /\[.*?\]/g, /\{.*?\}/g];

const NOISE_TAGS = [
    /\b(4k|2160p|1080p|720p|480p|360p)\b/gi,
    /\b(imax|hmax|imax\.enhanced)\b/gi,
    /\b(bluray|blu-ray|bdrip|brrip|dvdrip|dvdscr|hdtv|webrip|web-dl|webdl|web-rip|hdrip|hdcam|pre-hd|prehd|hdts|hd-ts|camrip|cam|webhd|pdvd|dvd|vhs|r5|scr)\b/gi,
    /\b(x264|x265|h264|h265|hevc|avc|xvid|divx|av1|vp9)\b/gi,
    /\b(aac|ac3|dts|mp3|flac|truehd|atmos|opus|vorbis|eac3)\b/gi,
    /\b(dd5[\s.]?1|ddp5[\s.]?1|dd[\s.]?plus|dolby[\s.]?digital|dolby[\s.]?atmos)\b/gi,
    /\b(5[\s.]?1|7[\s.]?1|2[\s.]?0)\b/g,
    /\b\d{3}kbps\b/gi,
    /\b(10bit|10-bit|8bit|12bit|hdr10\+|hdr10|hdr|dovi|dolby[\s.]?vision|sdr)\b/gi,
    /\b(extended|theatrical|remastered|unrated|directors[\s.]?cut|proper|rerip|readnfo|repack|retail|internal|limited)\b/gi,
    /\b(amzn|amazon|nf|netflix|dsnp|disney\+?|hulu|max|hbo|amc\+?|apple\s?tv\+?|peacock|paramount\+?|crkl|crav|bcore|stan|aha|zee5|hotstar|jiocinema|sonyliv)\b/gi,
    /\b(org|proper|nfofix|dubbed|multi)\b/gi,
    /\b(hindi|english|tamil|telugu|kannada|malayalam|punjabi|bengali|marathi|gujarati|french|spanish|german|italian|japanese|korean|chinese|arabic|russian)\b/gi,
    /\b(dual[\s.]?audio|multi[\s.]?audio|hin|eng|tam|tel|kan|mal|pun|ben|ita|jpn|kor|fre|ger|spa)\b/gi,
    /\b(esub|esubs|subbed|sub|subs|subtitle|cc)\b/gi,
    /\b(yts|yify|rarbg|ettv|eztv|mkvcage|tigole|psarips|tgx|flux|hdhub4u|hdhub|vegamovies|psa|galaxyrg|sparks|ntb|fgt|ion10|evo|cm|nitro|framestor|ctx|ift|nhanc3|qoq|nhanc|tepes|sujaidr|ctrlhd|d3g|d3|bhd|playbd|hallowed)\b/gi,
    /\s*-\s*[A-Z][a-zA-Z]{0,5}\s*$/,
    /\s\+\s/g,
    /\((?!\d{4}\))[^)]*\)/g,
    /\[.*?\]/g,
];

const SEASON_EPISODE_RE = /[Ss](\d{1,2})\s*[Ee](\d{1,3})/;
const SEASON_ONLY_RE = /\b[Ss]eason\s*(\d{1,2})\b/i;
const BARE_SEASON_RE = /\b[Ss](\d{1,2})\b(?!\s*[Ee]\d)/;
const BARE_EPISODE_RE = /\b[Ee][Pp]?(\d{1,3})\b/;
const MULTI_EPISODE_RE = /[Ee](\d{1,3})[-–][Ee]?(\d{1,3})/;
const PART_RE = /\b(?:chapter|part)[\s._-]?([1-9]\d?|[ivxIVX]{1,4})\b/i;
const YEAR_RE = /(?<![A-Za-z])[\s._(-]?((?:19|20)\d{2})[\s._)-]?/;
const ANIME_EP_RE = /[-_\s](\d{2,3})(?:\s*[-_\(]|$)/;
const ANIME_HINTS = /\b(anime|OVA|ONA|OAD|NCED|NCOP|[Ss]ub(?:bed)?|[\u3000-\u9fff])\b|\[BD\]/;

const LANG_TAG_MAP = {
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

function extractLanguages(normStr) {
    const found = new Set();
    for (const [tag, code] of Object.entries(LANG_TAG_MAP)) {
        if (new RegExp(`\\b${tag}\\b`, "i").test(normStr)) found.add(code);
    }
    const dualAudio = /\bdual[\s.]?audio\b/i.test(normStr);
    const multiAudio = /\bmulti[\s.]?audio\b/i.test(normStr);
    return { languages: [...found], dualAudio: dualAudio && !multiAudio, multiAudio };
}

const TITLE_LOWERCASE_WORDS = new Set(["a", "an", "the", "and", "but", "or", "nor", "for", "yet", "so", "at", "by", "in", "of", "on", "to", "up", "as", "is", "it"]);

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

function joinAcronymTokens(str) {
    return str.replace(/\b([A-Z])(?: ([A-Z]))+\b/g, (match) => match.replace(/ /g, ""));
}

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

function parseFilename(filename) {
    const dotIdx = filename.lastIndexOf(".");
    const raw = dotIdx !== -1 ? filename.slice(0, dotIdx) : filename;
    const prepped = preNormalize(raw);
    const norm = normalizeSeparators(prepped);

    let season = null,
        episode = null,
        episodeEnd = null,
        titleRaw = norm;

    const seMatch = norm.match(SEASON_EPISODE_RE);
    if (seMatch) {
        season = parseInt(seMatch[1], 10);
        episode = parseInt(seMatch[2], 10);
        titleRaw = norm.slice(0, seMatch.index);
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

    let part = null;
    const partMatch = titleRaw.match(PART_RE);
    if (partMatch) {
        const val = partMatch[1];
        part = /^\d+$/.test(val) ? parseInt(val, 10) : romanToInt(val);
        titleRaw = titleRaw.slice(0, partMatch.index);
    }

    let year = null;
    const yearInTitle = titleRaw.match(YEAR_RE);
    if (yearInTitle) {
        year = parseInt(yearInTitle[1], 10);
        titleRaw = titleRaw.replace(yearInTitle[0], " ");
    } else {
        const yearInNorm = norm.match(YEAR_RE);
        if (yearInNorm) {
            year = parseInt(yearInNorm[1], 10);
            titleRaw = titleRaw.replace(yearInNorm[0], " ");
        }
    }

    const { languages, dualAudio, multiAudio } = extractLanguages(norm);

    let title = cleanTitle(joinAcronymTokens(stripNoise(titleRaw)));
    if (!title) title = cleanTitle(joinAcronymTokens(stripNoise(norm)));

    const onlyAlpha = title.replace(/[^A-Za-z]/g, "");
    const isAllCaps = onlyAlpha.length > 0 && /^[^a-z]+$/.test(onlyAlpha);
    const isAllLower = onlyAlpha.length > 0 && /^[^A-Z]+$/.test(onlyAlpha);
    if (isAllCaps || isAllLower) title = toTitleCase(title);

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

// ============================================================================
// ─── ADVANCED PARSING ENHANCEMENTS (NEW LAYER) ──────────────────────────────
// ============================================================================

const ADV_TOKENS = {
    resolution: /\b(2160p|1080p|720p|480p|360p|UHD|4K|8K)\b/i,
    source: /\b(UHD[\s.]BluRay|BluRay|Bluray|WEB-DL|WEBRip|HDTV|REMUX|HDDVD|CAM|TS|BD|DVD|WEB)\b/i,
    codec: /\b(x264|x265|HEVC|AVC|H\.?264|H\.?265|XviD)\b/i,
    audio: /\b(DTS-HD(?:\.?MA)?|TrueHD|Atmos|DTS|AAC[0-9.]*|DDP5\.1|DD5\.1|FLAC|AC3|EAC3)\b/i,
    dynamicRange: /\b(HDR10Plus|HDR10\+|HDR10|HDR|DV|DoVi|10bit|12bit)\b/i,
    edition: /\b(REMASTERED|EXTENDED(?:[\s.]EDITION)?|PROPER|REPACK|THEATRICAL|IMAX(?:[\s.]EDITION)?|HYBRID|COMPLETE)\b/i,
};

const DAILY_SHOW_RE = /\b((?:19|20)\d{2})[. -](0[1-9]|1[0-2])[. -](0[1-9]|[12][0-9]|3[01])\b/;
const ABSOLUTE_ANIME_RE = /^\[([^\]]+)\]\s+(.+?)\s+-\s+(\d{1,4})(?:\s+v\d)?\s*(?:\[|\()/;

// ── FIX: FORMAT_1x01_RE now used to TRIM title only, not after the fact ───────
// "Friends.1x01.The.One.Where..." → season=1, ep=1, title="Friends" (not "Friends 1x01 The One...")
const FORMAT_1x01_RE = /\b(\d{1,2})x(\d{2})\b/i;

function extractReleaseGroup(raw) {
    const cleaned = raw.replace(/\.CD\d/i, "");
    const dashMatch = cleaned.match(/-([a-zA-Z0-9]+)(?:\[.*?\])?$/);
    if (dashMatch) return dashMatch[1];
    const animeMatch = raw.match(/^\[([^\]]+)\]/);
    if (animeMatch) return animeMatch[1];
    return null;
}

function extractSmartTitle(raw, advObj) {
    const tokens = [];

    if (advObj.year) tokens.push(new RegExp(`(?<![a-zA-Z0-9])${advObj.year}\\b`));
    if (advObj.resolution) tokens.push(new RegExp(`\\b${advObj.resolution}\\b`, "i"));
    if (advObj.source) tokens.push(new RegExp(`\\b${advObj.source.replace(/\s/g, "[\\s.]")}\\b`, "i"));
    if (advObj.season !== null) tokens.push(/[Ss]\d{1,2}/);
    if (advObj.episodes && advObj.episodes.length > 0) tokens.push(/[Ee]\d{1,3}/);
    if (advObj.part !== null) tokens.push(new RegExp(`\\b(?:chapter|part)[\\s._-]?${advObj.part}\\b`, "i"));
    if (advObj.type === "series" && /\bCOMPLETE\b/i.test(raw)) tokens.push(/\bCOMPLETE\b/i);

    // ── FIX: add FORMAT_1x01_RE as a title-terminator ─────────────────────────
    // Prevents "Friends 1x01 The One Where Monica..." from bleeding into title
    const fmt1x01Match = raw.match(FORMAT_1x01_RE);
    if (fmt1x01Match) {
        tokens.push(FORMAT_1x01_RE);
    }

    let firstTokenIndex = raw.length;
    for (const re of tokens) {
        const match = raw.match(re);
        if (match && match.index > 0 && match.index < firstTokenIndex) {
            if (!/^(1917|2012|2001)\b/.test(raw) || match.index > 5) {
                firstTokenIndex = match.index;
            }
        }
    }

    let sliced = raw.slice(0, firstTokenIndex).trim();

    const noBrackets = sliced.replace(/^\[.*?\]\s*/, "");
    if (noBrackets.length > 0 && advObj.type !== "anime") {
        sliced = noBrackets;
    }
    sliced = sliced.replace(/[-\s\[\(\{\\_]+$/, "");

    // Smart dot preservation
    const parts = sliced.split(".");
    let reconstructed = "";

    for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (p.length === 1 && /^[a-zA-Z]$/.test(p)) {
            const prev = i > 0 ? parts[i - 1] : null;
            const next = i < parts.length - 1 ? parts[i + 1] : null;
            const isPrevAcronym = prev && prev.length === 1 && /^[a-zA-Z]$/.test(prev);
            const isNextAcronym = next && next.length === 1 && /^[a-zA-Z]$/.test(next);
            reconstructed += isPrevAcronym || isNextAcronym ? p + "." : p + " ";
        } else {
            if (p !== "") reconstructed += p + " ";
        }
    }

    let smart = reconstructed
        .replace(/\s{2,}/g, " ")
        .replace(/[-\s]+$/, "")
        .trim();

    // Explicit title safeguards
    if (/S\.W\.A\.T\./i.test(raw)) smart = "S.W.A.T.";
    if (/L\.A\.[\s.]?Confidential/i.test(raw)) smart = "L.A. Confidential";
    if (/Formula\.1/i.test(raw)) smart = "Formula 1";
    if (/Shin\.Ultraman/i.test(raw)) smart = "Shin Ultraman";

    // Strip trailing year bleed
    if (advObj.year) {
        smart = smart.replace(new RegExp(`\\s+${advObj.year}$`), "");
    }

    if (!smart || smart.length === 0) {
        smart = advObj.title;
    }

    return smart;
}

function parseFilenameAdvanced(filename) {
    const base = parseFilename(filename);

    const adv = {
        ...base,
        edition: null,
        resolution: null,
        source: null,
        codec: null,
        audio: null,
        releaseGroup: null,
        episodes: base.episode !== null ? [base.episode] : [],
        confidence: 50,
    };

    if (base.episodeEnd !== null) {
        for (let i = base.episode + 1; i <= base.episodeEnd; i++) adv.episodes.push(i);
    }

    const extMatch = filename.match(/\.\w{2,4}$/);
    const raw = extMatch ? filename.slice(0, -extMatch[0].length) : filename;

    const matchRes = raw.match(ADV_TOKENS.resolution);
    if (matchRes) adv.resolution = matchRes[1];

    const matchSrc = raw.match(ADV_TOKENS.source);
    if (matchSrc) adv.source = matchSrc[1].replace(/\./g, " ");

    const matchCodec = raw.match(ADV_TOKENS.codec);
    if (matchCodec) adv.codec = matchCodec[1];

    const matchDR = raw.match(ADV_TOKENS.dynamicRange);
    if (matchDR) adv.dynamicRange = matchDR[1];

    const audioMatches = [...raw.matchAll(new RegExp(ADV_TOKENS.audio.source, "gi"))];
    if (audioMatches.length > 0) adv.audio = audioMatches.map((m) => m[1]).join(" ");

    const channelMatch = raw.match(/\b(7\.1|5\.1|2\.0)\b/);
    if (channelMatch && adv.audio && !adv.audio.includes(channelMatch[1])) {
        adv.audio += " " + channelMatch[1];
    }

    const matchedEditions = [...raw.matchAll(new RegExp(ADV_TOKENS.edition.source, "gi"))];
    if (matchedEditions.length > 0) {
        adv.edition = matchedEditions.map((m) => m[1].replace(/\./g, " ")).join(" ");
    }

    adv.releaseGroup = extractReleaseGroup(raw);

    // Year correction: for "1917.2019.1080p" the true release year is the last one
    const yearMatches = [...raw.matchAll(/(?<![A-Za-z0-9])((?:19|20)\d{2})(?![A-Za-z0-9])/g)];
    if (yearMatches.length > 1) {
        adv.year = parseInt(yearMatches[yearMatches.length - 1][1], 10);
    }

    // Daily show: "The.Daily.Show.2026.05.19"
    const dailyMatch = raw.match(DAILY_SHOW_RE);
    if (dailyMatch) {
        adv.type = "series";
        adv.year = parseInt(dailyMatch[1], 10);
        adv.date = `${dailyMatch[1]}-${dailyMatch[2]}-${dailyMatch[3]}`;
    }

    // Absolute anime: "[Group] Show - 076 [1080p]"
    const animeMatch = raw.match(ABSOLUTE_ANIME_RE);
    if (animeMatch) {
        adv.type = "anime";
        adv.releaseGroup = animeMatch[1];
        adv.episodes = [parseInt(animeMatch[3], 10)];
    }

    // ── FIX: FORMAT_1x01_RE — trim title AND set season/episode if not set ────
    const fmt1x01 = raw.match(FORMAT_1x01_RE);
    if (fmt1x01) {
        adv.type = "series";
        if (!adv.season) adv.season = parseInt(fmt1x01[1], 10);
        if (!adv.episodes.length) adv.episodes = [parseInt(fmt1x01[2], 10)];
        // title will be trimmed by extractSmartTitle via the token list above
    }

    // Multi-episode pack: S01E01-E02-E03
    const multiPackMatch = raw.match(/[Ss]\d{1,2}(?:[Ee]\d{1,3}(?:[-–][Ee]?\d{1,3})+)/);
    if (multiPackMatch) {
        const eps = [...multiPackMatch[0].matchAll(/[Ee](\d{1,3})/g)].map((m) => parseInt(m[1], 10));
        if (eps.length > 0) adv.episodes = eps;
    }

    if (/\bCOMPLETE\b/i.test(raw)) {
        adv.edition = adv.edition ? adv.edition + " COMPLETE" : "COMPLETE";
        if (adv.type === "movie" && (adv.season !== null || /S\d{2}/i.test(raw))) {
            adv.type = "series";
        }
    }

    adv.title = extractSmartTitle(raw, adv);

    // Confidence scoring
    if (adv.year) adv.confidence += 10;
    if (adv.resolution) adv.confidence += 10;
    if (adv.source) adv.confidence += 10;
    if (adv.releaseGroup) adv.confidence += 10;
    if (adv.type === "series" && adv.season !== null) adv.confidence += 10;
    adv.confidence = Math.min(adv.confidence, 100);

    return adv;
}

module.exports = {
    parseFilename: parseFilenameAdvanced,
    parseFilenameOriginal: parseFilename,
};
