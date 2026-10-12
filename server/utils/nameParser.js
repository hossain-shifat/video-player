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

// ── NEW: Release-site/folder prefix pattern ───────────────────────────────────
// Matches "SiteName - Title.S01..." or "GroupName - Title.2023..."
// e.g. "TheMoviesBoss - Wednesday.S01E01..."
// Condition: token before " - " is CamelCase/PascalCase with no spaces (looks like a group/site)
const SITE_PREFIX_RE = /^([A-Za-z0-9]{3,30})\s+-\s+(.+)$/;

// ── NEW: Device/camera filename pattern ──────────────────────────────────────
// VID_20240312_123456, IMG_20240312, MVI_1234, DCIM_001, etc.
const DEVICE_FILE_RE = /^(?:VID|IMG|MVI|DCIM|MOV|DSC|GOPR|GH\d+|P\d{7}|SNAP)[-_]\d{4,}/i;

// ── NEW: Pure garbage title patterns ─────────────────────────────────────────
// Titles that are just season/episode codes, copy markers, or empty after cleaning
const GARBAGE_TITLE_RE = /^(?:S\d{1,2}(?:E\d{1,3})?|EP?\d{1,3}|Episode\s*\d+|New\s+Folder.*|Copy\s*\(\d+\)|Untitled.*)$/i;

// ── NEW: Bangla/regional language detection ──────────────────────────────────
// "bangla" already stripped from title but not detected as language code
// Add to LANG_TAG_MAP equivalent — handled in post-processing
const BANGLA_RE = /\bbangla\b/i;

// ── FIX: FORMAT_1x01_RE now used to TRIM title only, not after the fact ───────
// "Friends.1x01.The.One.Where..." → season=1, ep=1, title="Friends" (not "Friends 1x01 The One...")
const FORMAT_1x01_RE = /\b(\d{1,2})x(\d{2})\b/i;

// Explicit title safeguards: filename pattern -> forced title.
// Order matters (applied sequentially, later match wins) — same as the
// original inline if-chain this table replaces.
const TITLE_SAFEGUARDS = [
    [/S\.W\.A\.T\./i, "S.W.A.T."],
    [/L\.A\.[\s.]?Confidential/i, "L.A. Confidential"],
    [/Formula\.1(?![.\s][A-Za-z])/i, "Formula 1"],
    [/Shin\.Ultraman/i, "Shin Ultraman"],
];

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
    if (advObj.season !== null) tokens.push(/(?<![A-Za-z])[Ss]\d{1,2}/); // not inside a word ("Sense8")
    if (advObj.episodes && advObj.episodes.length > 0) tokens.push(/(?<![A-Za-z])[Ee]\d{1,3}/); // not inside a word ("Sense8", "Se7en")
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

    // Explicit title safeguards (data table above; applied in order, later wins)
    for (const [re, forced] of TITLE_SAFEGUARDS) {
        if (re.test(raw)) smart = forced;
    }

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

    // ── NEW: Site/folder prefix stripping ────────────────────────────────────
    // "TheMoviesBoss - Wednesday.S01..." → title becomes "Wednesday"
    // Only strip when prefix looks like CamelCase site/group name (no spaces)
    if (adv.title) {
        const sitePrefixMatch = adv.title.match(SITE_PREFIX_RE);
        if (sitePrefixMatch) {
            const prefix = sitePrefixMatch[1];
            const rest = sitePrefixMatch[2].trim();
            const isSitePattern = prefix.length >= 5 && /[A-Z][a-z]/.test(prefix) && rest.length > 0 && !/^(Part|Chapter|Volume|Season)$/i.test(prefix);
            if (isSitePattern) {
                const restNorm = rest
                    .replace(/[._]/g, " ")
                    .replace(/\s{2,}/g, " ")
                    .trim();
                const restClean = restNorm
                    .replace(/[-\u2013\u2014:,~+]+$/, "")
                    .replace(/^\s*[-\u2013\u2014:,~+]+/, "")
                    .trim();
                if (restClean.length > 0) adv.title = restClean;
            }
        }
    }

    // ── NEW: Bracket-group anime detection ───────────────────────────────────
    // "[EMBER] Attack on Titan", "[BakedFish] Naruto..." — bracket prefix = fansub = anime
    if ((adv.type === "series" || adv.type === "movie") && /^\[([^\]]+)\]/.test(raw)) {
        adv.type = "anime";
    }

    // ── NEW: Anime "- NNN END" episode extraction ────────────────────────────
    // "[BakedFish] Naruto Shippuden - 500 END 1080p" → episode=500, type=anime
    if (adv.type === "anime" && (!adv.episodes || adv.episodes.length === 0)) {
        const endEpMatch = raw.match(/[-\u2013]\s*(\d{2,4})\s+END\b/i);
        if (endEpMatch) {
            adv.episodes = [parseInt(endEpMatch[1], 10)];
            adv.title = adv.title.replace(/\s*-\s*\d+(?:\s+END)?\s*$/i, "").trim();
        }
    }

    // ── NEW: Anime title cleanup — strip leading bracket group + trailing ep number ──
    // "[SubsPlease] One Piece - 1108" → "One Piece"
    // "[Group] Title - 076" → "Title"
    if (adv.type === "anime" && adv.title) {
        // Strip leading [Group] prefix from title if it leaked in
        adv.title = adv.title.replace(/^\[[^\]]+\]\s*/, "").trim();
        // Strip trailing "- NNN" episode number bleed
        adv.title = adv.title.replace(/\s*-\s*\d{1,4}\s*$/, "").trim();
        // Strip trailing " NNN" bare episode bleed (e.g. "Naruto Shippuden 500")
        // Only if episodes array already has a value matching that number
        if (adv.episodes && adv.episodes.length > 0) {
            const lastEp = adv.episodes[adv.episodes.length - 1];
            adv.title = adv.title.replace(new RegExp("\\s+" + lastEp + "\\s*$"), "").trim();
        }
    }

    // ── NEW: Device/camera file detection ────────────────────────────────────
    // VID_20240312_123456, IMG_20240312 etc → blank title, low confidence
    if (DEVICE_FILE_RE.test(raw)) {
        adv.title = "";
        adv.isDeviceFile = true;
        adv.confidence = 10;
    }

    // ── NEW: Garbage title cleanup ────────────────────────────────────────────
    // "S01E01.mp4" → title would be "S01", clear it
    if (adv.title && GARBAGE_TITLE_RE.test(adv.title.trim())) {
        adv.title = "";
    }

    // ── NEW: Bangla language code ─────────────────────────────────────────────
    // Original LANG_TAG_MAP doesn't include "bangla" keyword → add "bn"
    if (BANGLA_RE.test(raw) && adv.languages && !adv.languages.includes("bn")) {
        adv.languages = [...(adv.languages || []), "bn"];
    }

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

// ============================================================================
// ─── v2 PATCH LAYER — New filename pattern support ───────────────────────────
// ============================================================================

// Known non-anime bracket groups (scene/site groups that use [brackets])
// These must NOT trigger the bracket→anime heuristic
const _NON_ANIME_BRACKET_RE =
    /^\[(yts|yify|tgx|psa|psarips|galaxyrg|rarbg|ettv|eztv|playbd|bhd|hdhub|hallowed|ntb|sparks|fgt|ion10|evo|ctx|ctrlhd|d3g|moviehub|moviezverse|worldfree4u|katmoviehd|mlwbd|pahe|scenerG?|movielink|kHD|[A-Z]{2,8})\b/i;

// Known anime fansub groups that legitimately use [brackets]
const _ANIME_BRACKET_RE =
    /^\[(SubsPlease|Erai-raws|EraiRaws|HorribleSubs|Anime\.Time|AnimeRG|DeadToonsIndia|DeadToons|Judas|Moozzi2|BakedFish|LoliHouse|NyaaSubs|Shiro|SCY|Cleo|beatrice|tenshi|GS-Team|EMBER|AnimeTime|AnimeFlix|SmallSizedHD|ASW|GST|Commie|Underwater|Reaktor|kBaraka|GJM|NanDesuKa|Kametsu|LostYears|Funimation|YURI)\b/i;

// Paren site prefix: "(Movies4u.CC)." "(MovieHub)." "(BanglaFlix)."
// Matches opening paren group that looks like a site/group tag (3-40 chars, not just a year)
const _PAREN_SITE_RE = /^\(([^)]{3,40})\)[.\s]*/;

// "Episode NNN" word form not handled by base BARE_EPISODE_RE
const _WORD_EPISODE_RE = /\bEpisode[\s._-]?(\d{1,4})\b/i;

// Anime "Title - 500 END" final episode
const _END_EP_RE = /[-.\s]+(\d{2,4})[\s.]*(?:END|FINAL)\b/i;

// Anime absolute ep "Title - 1123" or "Title.-.01." (allows 1-4 digits, dot or space sep)
const _ABS4_RE = /[-–][.\s]+(\d{1,4})(?:[.\s]*[\[(]|[.\s]*$|[.]\d+p)/i;

// Multi-season range: S01-S05
const _MULTI_SEASON_RE = /[Ss](\d{1,2})[-–][Ss](\d{1,2})\b/;

// Compact episode "514" = S05E14 (3-digit where d1=season, d23=episode)
// Only if no year/season found and episode ≤22
const _COMPACT_SNE_RE = /(?:^|[\s.])([1-9])(\d{2})(?:[\s.]|$)/;

// ── NEW v3: Bracketed multi-language list, e.g. "Dual[English-German]" ───────
// PRE_NORMALIZE_STRIP nukes ALL [...] groups before language detection ever
// runs, so a language list stuffed inside brackets was silently lost. This
// re-reads the untouched original filename to recover it.
const _BRACKET_LANG_GROUP_RE = /\[([A-Za-z]{2,}(?:[\s-]+[A-Za-z]{2,})+)\]/;

// ── NEW v3: Website/domain dash-prefix leaking into extracted title ──────────
// "MovieLinkBD.com - Dark.S01E01..." → extractSmartTitle only strips known
// tokens (year/res/season/etc), so "MovieLinkBD com - " survives as a prefix
// on adv.title (e.g. "MovieLinkBD com - Dark"). Strip it here.
const _WEBSITE_DASH_TITLE_RE = /^([A-Za-z0-9]+)[\s.]+(com|net|org|co|io|tv|to|me|in|cc|is|nl|pw|link|site|xyz|info|biz|club|fun|live|pro|vip|us|ws)\s*-\s*(.+)$/i;

const _origParseFilenameAdvanced = parseFilenameAdvanced;

// ── ADDED: scoped only to the object returned by parseFilenamePatched below.
// Nothing above this line (the ORIGINAL parser, parseFilenameOriginal) is
// touched. Strips any key whose value is null/undefined right before the
// parsed object goes out — e.g. movies never had season/episode, so those
// keys just disappear instead of shipping as "season": null in the API
// response/media.json. Every other field/behavior is untouched.
function stripNullish(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v !== null && v !== undefined) out[k] = v;
    }
    return out;
}

function parseFilenamePatched(filename) {
    // ── STEP 1: Strip paren site prefix ──────────────────────────────────
    let fn = filename;
    let parenSite = null;
    const pm = fn.match(_PAREN_SITE_RE);
    if (pm) {
        const inside = pm[1];
        // Only strip if it looks like a site name (not a year, not a person name in parens)
        const isYear = /^\d{4}$/.test(inside);
        const hasSiteLook =
            /^[A-Za-z]/.test(inside) &&
            (/[A-Z][a-z]/.test(inside) || // CamelCase
                /[A-Za-z]\.[A-Za-z]/.test(inside) || // dot-domain
                /^[A-Z0-9]+$/.test(inside) || // ALL CAPS
                inside.length >= 4);
        if (!isYear && hasSiteLook) {
            parenSite = inside.toLowerCase();
            fn = fn.slice(pm[0].length);
        }
    }

    // ── STEP 2: Run original advanced parser on cleaned filename ──────────
    let adv = _origParseFilenameAdvanced(fn);

    // ── STEP 3: Fix bracket→anime over-triggering ─────────────────────────
    // Original: "if file starts with [bracket] → type=anime"
    // Fix: only apply if group is known anime fansub
    const bracketMatch = fn.match(/^\[([^\]]+)\]/);
    if (bracketMatch && adv.type === "anime") {
        const grp = bracketMatch[1];
        const isKnownAnime = _ANIME_BRACKET_RE.test(`[${grp}]`);
        const hasAnimeSignal = /\b(OVA|ONA|OAD|anime|[\u3000-\u9fff])\b/i.test(fn);
        // All-caps groups (MLWBD, EMBER, TGx, etc.) + no anime signal → revert
        if (!isKnownAnime && !hasAnimeSignal) {
            adv.type = adv.season !== null || adv.episodes.length > 0 ? "series" : "movie";
        }
    }

    // ── STEP 4: Paren site → anime type detection ─────────────────────────
    // "(AnimeFlix)." → type should be anime if it has SxxExx
    if (parenSite) {
        if ((parenSite.includes("anime") || parenSite.includes("deadtoon")) && adv.type === "series") {
            adv.type = "anime";
        }
        // Bangla site prefix → add language
        if (parenSite.includes("bangla")) {
            adv.languages = [...new Set([...(adv.languages || []), "bn"])];
        }
    }

    // ── STEP 5: "Episode NNN" word form ───────────────────────────────────
    if (adv.episodes.length === 0) {
        const ew = fn.match(_WORD_EPISODE_RE);
        if (ew) {
            const ep = parseInt(ew[1], 10);
            adv.episodes = [ep];
            adv.episode = ep;
            if (adv.type === "movie") adv.type = "series";
            // Clean from title
            adv.title = adv.title.replace(new RegExp(`\\s*Episode[\\s._-]?0*${ep}\\s*$`, "i"), "").trim();
        }
    }

    // ── STEP 6: Anime "NNN END/FINAL" episode ─────────────────────────────
    if (adv.type === "anime" && adv.episodes.length === 0) {
        const em = fn.match(_END_EP_RE);
        if (em) {
            const ep = parseInt(em[1], 10);
            adv.episodes = [ep];
            adv.episode = ep;
            adv.title = adv.title.replace(/\s*[-–]\s*\d+(?:[\s.]*(?:END|FINAL))?\s*$/i, "").trim();
        }
    }

    // ── STEP 7: Anime absolute episode "- 1123" or "-.01." ────────────────
    if (adv.type === "anime" && adv.episodes.length === 0) {
        const am = fn.match(_ABS4_RE);
        if (am) {
            const ep = parseInt(am[1], 10);
            adv.episodes = [ep];
            adv.episode = ep;
            adv.title = adv.title.replace(/\s*[-–]\s*\d+\s*$/i, "").trim();
        }
    }

    // ── STEP 8: Multi-season range → series ───────────────────────────────
    const msm = fn.match(_MULTI_SEASON_RE);
    if (msm) {
        adv.type = "series";
        adv.season = parseInt(msm[1], 10);
    }

    // ── STEP 9: Compact SNE "514" = S05E14 ────────────────────────────────
    // Only if no season/episode/year detected and it follows the title
    if (adv.season === null && adv.episodes.length === 0 && !adv.year) {
        // Get the base without extension
        const base = fn.replace(/\.\w{2,4}$/, "");
        const cm = base.match(_COMPACT_SNE_RE);
        // A bare number right after a dash ("Naruto Shippuden - 220") is an ABSOLUTE episode, not S2E20.
        const _cmBefore = cm ? base.slice(0, cm.index + cm[0].indexOf(cm[1] + cm[2])) : "";
        if (cm && !/[-\u2013]\s*$/.test(_cmBefore)) {
            const s = parseInt(cm[1], 10);
            const e = parseInt(cm[2], 10);
            // Episode must be ≤22 to avoid false positives
            if (e >= 1 && e <= 22) {
                adv.season = s;
                adv.episode = e;
                adv.episodes = [e];
                adv.type = "series";
                // Strip compact code from title
                const compCode = cm[1] + cm[2];
                adv.title = adv.title.replace(new RegExp(`\\s+${compCode}(?:\\s.*)?$`), "").trim();
            }
        }
    }

    // ── STEP 10: (Copy) noise in title ────────────────────────────────────
    if (adv.title) {
        adv.title = adv.title.replace(/\s*\(copy(?:\s*\(\d+\))?\)\s*/gi, "").trim();
    }

    // ── STEP 11: Tilde episode range "01~04" → episode=1, episodeEnd=4 ────
    // "[Erai-raws] Title - 01~04 [1080p]..." → ep=1, epEnd=4
    if (adv.episodes.length === 0 && adv.type === "anime") {
        const tildeMatch = fn.match(/[-–\s]+(\d{1,3})\s*~\s*(\d{1,3})/);
        if (tildeMatch) {
            const epStart = parseInt(tildeMatch[1], 10);
            const epEnd = parseInt(tildeMatch[2], 10);
            adv.episode = epStart;
            adv.episodeEnd = epEnd;
            adv.episodes = [];
            for (let i = epStart; i <= epEnd; i++) adv.episodes.push(i);
            // clean trailing "- 01~04" from title
            adv.title = adv.title.replace(/\s*[-–]\s*\d+\s*~\s*\d+\s*$/, "").trim();
        }
    }

    // ── STEP 12: "Dubbed" keyword → anime signal ──────────────────────────
    // "Naruto Shippuden Episode 500 English Dubbed" → type=anime
    // "Dubbed" alone is strong indicator (anime dubs are commonly labelled this way)
    if (adv.type === "series" && /\bDubbed\b/i.test(fn)) {
        adv.type = "anime";
    }

    // ── STEP 13: Anime title cleanup — strip trailing episode + lang noise ─
    // "[Cleo] SPY x FAMILY - 12 (Dual Audio...)" → "SPY x FAMILY"
    // After episode extracted, clean title of leftover "- NN (noise...)" suffix
    if (adv.type === "anime" && adv.title) {
        // Strip trailing "- NN (anything)" where NN matches a known episode
        if (adv.episodes.length > 0) {
            const ep = adv.episodes[0];
            // Remove "- EP (junk" or "- EP" at end of title
            adv.title = adv.title.replace(new RegExp(`\\s*[-–]\\s*0*${ep}(?:\\s*\\(.*)?$`), "").trim();
        }
        // Strip any trailing paren group that leaked (e.g. "(Dual Audio 10bit")
        adv.title = adv.title.replace(/\s*\([^)]*$/, "").trim();
        // Strip trailing "- NNN" or "- NN" that remains
        adv.title = adv.title.replace(/\s*[-–]\s*\d{1,4}\s*$/, "").trim();
    }

    // ── STEP 14: "Episode NNN" → strip from anime title + set type anime ──
    // "Naruto Shippuden Episode 500 English Dubbed" → title="Naruto Shippuden"
    if (adv.type === "anime" && adv.title) {
        const epWordInTitle = adv.title.match(/\s+Episode\s+\d+.*/i);
        if (epWordInTitle) {
            adv.title = adv.title.slice(0, epWordInTitle.index).trim();
        }
    }

    // ── STEP 15: "Season N" leaking into title → strip ────────────────────
    // "The Office US Season 4" → "The Office US"
    // extractSmartTitle uses SEASON_ONLY_RE but title still bleeds in some paths
    if (adv.title) {
        adv.title = adv.title.replace(/\s+Season\s+\d+\s*$/i, "").trim();
        // Also strip bare "S4" / "S04" at end if season already captured
        if (adv.season !== null) {
            adv.title = adv.title.replace(new RegExp(`\\s+S0?${adv.season}\\s*$`, "i"), "").trim();
        }
    }

    // ── STEP 16: Numeric-title year bleed cleanup ──────────────────────────
    // "2012 2009 REMASTERED" → title should be "2012" (year=2009, REMASTERED=edition)
    // When title starts with a 4-digit number followed by a year, strip the year+noise
    if (adv.title && adv.year) {
        // Pattern: title = "<numericTitle> <year> [NOISE...]"
        // e.g. "2012 2009 REMASTERED", "1923 2022"
        const numTitleYearBleed = adv.title.match(new RegExp(`^(\\d{1,4}(?:\\s+[A-Za-z][A-Za-z0-9\\s]*)?)\\s+${adv.year}\\b(.*)$`));
        if (numTitleYearBleed) {
            // Only apply if the part before the year is plausibly a title (short numeric or short word)
            const beforeYear = numTitleYearBleed[1].trim();
            const afterYear = numTitleYearBleed[2].trim();
            // Strip year and anything after it (noise like REMASTERED already in edition)
            if (beforeYear.length > 0 && beforeYear.length <= 40) {
                adv.title = beforeYear;
            }
        }
        // Also strip trailing year if it somehow remains
        adv.title = adv.title.replace(new RegExp(`\\s+${adv.year}\\s*$`), "").trim();
    }

    // ── STEP 17: Sync episode singular from episodes array ────────────────
    // Some paths set adv.episodes but not adv.episode — keep them in sync
    if (adv.episode === null && adv.episodes && adv.episodes.length > 0) {
        adv.episode = adv.episodes[0];
    }
    if (adv.episodeEnd === null && adv.episodes && adv.episodes.length > 1) {
        adv.episodeEnd = adv.episodes[adv.episodes.length - 1];
    }

    // ── STEP 18 (NEW): Recover bracketed language list lost pre-normalize ──
    // "Dual[English-German]" → adv.languages was empty since the bracket
    // never survives to extractLanguages(). Re-check the raw filename.
    const bracketLangMatch = filename.match(_BRACKET_LANG_GROUP_RE);
    if (bracketLangMatch) {
        const words = bracketLangMatch[1].split(/[\s-]+/);
        const recovered = new Set(adv.languages || []);
        for (const w of words) {
            const code = LANG_TAG_MAP[w.toLowerCase()];
            if (code) recovered.add(code);
        }
        adv.languages = [...recovered];
    }

    // ── STEP 19 (NEW): Bare "Dual" + 2-language bracket → dualAudio ────────
    // Original dualAudio detection only fires on the literal phrase
    // "dual audio". "Dual[English-German]" (no "Audio" word) was missed.
    if (!adv.dualAudio && !adv.multiAudio && adv.languages && adv.languages.length === 2 && /\bDual\b/i.test(filename)) {
        adv.dualAudio = true;
    }
    if (adv.languages && adv.languages.length > 2 && /\b(Dual|Multi)\b/i.test(filename)) {
        adv.multiAudio = true;
        adv.dualAudio = false;
    }

    // ── STEP 20 (NEW): Website/domain dash-prefix leaking into title ───────
    // "MovieLinkBD.com - Dark.S01E01..." → title ends up "MovieLinkBD com -
    // Dark" after smart-title extraction. Strip the leading site tag.
    if (adv.title) {
        const siteDashMatch = adv.title.match(_WEBSITE_DASH_TITLE_RE);
        if (siteDashMatch && siteDashMatch[3] && siteDashMatch[3].trim().length > 0) {
            adv.title = siteDashMatch[3].trim();
        }
    }

    return stripNullish(adv);
}

// Re-export with patched version
module.exports = {
    parseFilename: parseFilenamePatched,
    parseFilenameOriginal: parseFilename,
};

// ============================================================================
// ─── v4 PATCH LAYER — Trailing noise in title + audio tag fixes ──────────────
// ============================================================================
// Appended only. Nothing above this line is modified.
//
// Fixes:
//  1. "Anaconda Full HD Hindi ORG (2025) Hindi Download"
//     extractSmartTitle cuts at the year token but never runs stripNoise(), so
//     junk words sitting BEFORE the year ("Full HD", "Hindi", "ORG") stay in the
//     title → "Anaconda Full HD Hindi ORG". Strip trailing junk words only.
//  2. "...WEB-DL.h264.ESub_2" → audio came out as "AAC." (trailing dot from the
//     AAC[0-9.]* regex). Trim stray dots.
//  3. "...BluRay.Hindi.English.DD.5.1.x264" → "DD.5.1" never matched the audio
//     regex (it only knows DD5.1 / DDP5.1), so audio was missing entirely.

// Trailing junk words/phrases that can bleed into a title when they sit before the
// year/resolution token. Deliberately excludes real-title words (Movie, Free, Watch,
// Original, New, Online) to avoid eating titles like "The Lego Movie" / "Born Free".
const _V4_TRAILING_NOISE_RE =
    /(?:[\s.\-_]+(?:full[\s.]?hd|full[\s.]?movie|fhd|uhd|hd|hindi|english|tamil|telugu|kannada|malayalam|bengali|bangla|punjabi|marathi|gujarati|org|dubbed|dual[\s.]?audio|multi[\s.]?audio|download|esubs?|hdrip|webrip|web[\s.\-]?dl|bluray|brrip|dvdrip|hdcam|camrip|hdts|hdtc))+[\s.\-_]*$/i;

// "DD.5.1" / "DD 5.1" / "DDP.5.1" / "DD+5.1" — separators the original audio regex misses
const _V4_DD_AUDIO_RE = /\b(DDP?|DD\+)[\s.]?(5[\s.]1|7[\s.]1|2[\s.]0)\b/i;

const _v3ParseFilenamePatched = parseFilenamePatched;

const _V5_SITE_PREFIX_RE =
    /^\s*(?:www\.[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,6}|[A-Za-z0-9][A-Za-z0-9-]*\.(?:com|net|org|info|biz|cc|tv|fi|cam|run|bz|xyz|lol|ws|vip|pw|tk|ru|sx|ag|cx|io|icu|wtf|nz|pk|lk|bd|np))\s*[-\u2013]\s+/i;

const _V8_KNOWN_EXT_RE = /\.(?:mkv|mp4|m4v|avi|mov|wmv|flv|webm|ts|m2ts|mts|mpg|mpeg|vob|ogv|3gp|divx|rmvb|iso|srt|vtt|ass|ssa|sub|idx)$/i;

function parseFilenamePatchedV4(filename) {
    // Underscores are word separators in many release names ("Heat_1995_1080p_WEBRip",
    // "Peaky_Blinders_S03E04"). The layers below only split on dots/spaces, so the whole
    // tag string ended up inside the title. Treat "_" like a space at the entry point only.
    // Camera/device names (VID_…, IMG_0012, DSC_1234) already parse to an EMPTY title, which
    // correctly means "nothing to look up" — keep that behaviour; only normalise when the
    // original parse produced a title.
    // Release-site prefix: "www.1TamilMV.fi - Leo (2023) …", "Vegamovies.bz - Pushpa The Rise (2021) …".
    // Stripped at the entry point only. Conservative: "www." + any host, or exactly <name>.<tld> with
    // a tld from a short list that is not an ordinary word ("Dragon.Ball.Z.One - 01" is NOT a site).
    const _inputName = filename; // untouched input, exposed (non-enumerable) as parsed.originalName
    // scanner.js / grouper.js hand over names WITHOUT the extension ("Breaking.Bad.S01E02", "Inception.2010"). Every layer below
    // assumes a trailing ".ext" and cuts at the last dot, which ate ".S01E02" / ".2010" / ".US" and turned an
    // untagged episode into a MOVIE. Give extension-less input a placeholder extension so the right thing is removed.
    if (typeof filename === "string" && filename && !_V8_KNOWN_EXT_RE.test(filename)) filename += ".mkv";
    if (typeof filename === "string") filename = _v6StripPrefixes(filename.replace(_V5_SITE_PREFIX_RE, ""));
    // "Fairy*Tail*-_07_BD_1080p": '*' used as a word separator in front of a "-<episode>" tail (illegal in Windows
    // file names, but seen in exported name lists). Narrow on purpose so "M*A*S*H" is untouched.
    if (typeof filename === "string" && /\*[-\u2013]_?\s*\d{1,4}(?:[_\s.]|$)/.test(filename)) filename = filename.replace(/\*/g, "_");
    const _origName = filename;
    let adv;
    if (typeof filename === "string" && filename.includes("_")) {
        const asIs = _v3ParseFilenamePatched(filename);
        if (!asIs.title || !asIs.title.trim()) {
            adv = asIs;
        } else {
            filename = filename.replace(/_/g, " ");
            adv = _v3ParseFilenamePatched(filename);
        }
    } else {
        adv = _v3ParseFilenamePatched(filename);
    }

    // ── 1. Trailing junk words in title ───────────────────────────────────
    if (adv.title) {
        const m = adv.title.match(_V4_TRAILING_NOISE_RE);
        if (m && m.index > 0) {
            const trimmed = adv.title
                .slice(0, m.index)
                .replace(/[-–—:,~+(\s]+$/, "")
                .trim();
            // never empty a title out
            if (trimmed.length > 0) adv.title = trimmed;
        }
    }

    // ── 2. Stray dots on audio tag ("AAC." → "AAC") ───────────────────────
    if (adv.audio) {
        adv.audio = adv.audio
            .replace(/\.+(?=\s|$)/g, "")
            .replace(/\s{2,}/g, " ")
            .trim();
    }

    // ── 3. DD.5.1 style audio ─────────────────────────────────────────────
    const ddMatch = filename.match(_V4_DD_AUDIO_RE);
    if (ddMatch) {
        const tag = `${ddMatch[1].toUpperCase().replace("+", "P")} ${ddMatch[2].replace(/[\s.]/, ".")}`;
        if (!adv.audio) {
            adv.audio = tag;
        } else if (!/\bDDP?\b/i.test(adv.audio) && !/\bDDP?\s?\d/i.test(adv.audio)) {
            adv.audio = `${adv.audio} ${tag}`;
        }
    }

    // ── 4. False anime: leading bare "Sub"/"Subbed" is a TITLE word ────────
    // "Sub.Zero.2020" matched ANIME_HINTS on the word "Sub" → type "anime".
    // Only reverts when ALL hold: type is anime, no season/episode found, no
    // leading [group]/(site) prefix, and the ONLY hint is a leading Sub/Subbed
    // token with no further anime hint after it. Everything else is untouched.
    try {
        if (_v4IsFalseAnime(adv, filename)) adv.type = "movie";
    } catch {
        /* never let a heuristic break parsing */
    }

    // ── 4b. A "year" that is really part of a resolution ("1920x1080") ─────────
    try {
        if (adv.year) {
            const y = String(adv.year);
            if (new RegExp(`(?<![0-9])${y}x\\d{3,4}`).test(filename)) {
                const stripped = filename.replace(/\d{3,4}x\d{3,4}/g, " ");
                if (!new RegExp(`(?<![0-9])${y}(?![0-9])`).test(stripped)) delete adv.year;
            }
        }
    } catch {
        /* heuristic only */
    }

    let _notes_dash = false;
    // ── 4c. "Title - 07 [tags]" episode names (fansub style, no SxxExx) ───────
    try {
        _notes_dash = _v5DashEpisode(adv, filename, _origName) === true;
    } catch {
        /* heuristic only */
    }

    try {
        _v6EpisodeToken(adv, filename);
    } catch {
        /* heuristic only */
    }

    // v9 runs AFTER the Ep/Episode token removal: "Show - Season 2 - Episode 05" only exposes its season tail then.
    try {
        _v9TitleTail(adv);
    } catch {
        /* heuristic only */
    }

    // A title never legitimately ends in a dash/colon ("Series Name - Episode 07" left "Series Name -").
    if (adv.title) adv.title = adv.title.replace(/\s*[-\u2013\u2014:]+\s*$/, "").trim() || adv.title;

    // Diagnostics (NON-ENUMERABLE like titleCandidates → no API/JSON/cache change): the untouched input name and
    // WHY the parser decided what it did, so a wrong match can be traced to the parse step.
    try {
        const notes = [];
        const afterSite = typeof _inputName === "string" ? _v6StripPrefixes(_inputName.replace(_V5_SITE_PREFIX_RE, "")) : _inputName;
        if (typeof _inputName === "string" && afterSite !== _inputName) notes.push("site-prefix-removed");
        if (typeof _inputName === "string" && /(?<=[\w.)\s])\s*\[(?:19|20)\d{2}\]/.test(_inputName)) notes.push("bracketed-year");
        if (_notes_dash) notes.push("absolute-episode");
        if (adv.season != null && typeof _inputName === "string" && !/\bS\d{1,2}|\b\d{1,2}x\d{2,3}\b|season/i.test(_inputName)) notes.push("season-inferred-from-compact-number");
        if (adv.type !== "movie" && adv.episode == null && !(adv.episodes && adv.episodes.length)) notes.push("episode-unknown");
        Object.defineProperty(adv, "originalName", { value: _inputName, enumerable: false, writable: true, configurable: true });
        Object.defineProperty(adv, "parseNotes", { value: notes, enumerable: false, writable: true, configurable: true });
    } catch {
        /* diagnostics are optional */
    }

    // ── 5. Title candidates (internal, NON-ENUMERABLE) ────────────────────
    // Not part of the JSON/API contract: absent from Object.keys, spread,
    // and JSON.stringify. Consumers that want it read parsed.titleCandidates;
    // when it is missing (spread/cloned object) they fall back to parsed.title.
    try {
        Object.defineProperty(adv, "titleCandidates", {
            value: buildTitleCandidates(adv, filename),
            enumerable: false,
            writable: true,
            configurable: true,
        });
    } catch {
        /* candidates are optional */
    }

    return adv;
}

// ── v5 helper: "Title - 07" (+ optional tags) → series/anime episode ─────────
// Seen in real libraries: "Fairy_Tail_-_07_BD_1080p", "Berserk_-_08_BD_1080p" (title was lost and became
// "08"), "Wotakoi_-_16_720p", "[DB] Dragon Ball Z Kai - 98 (Dual Audio…)". Guards: no SxxExx, no year in the
// name, the number is not a year or a resolution, the title keeps ≥ 2 characters.
function _v5DashEpisode(adv, name, origName) {
    if (adv.season != null) return;
    const base = String(name)
        .replace(/\.[A-Za-z0-9]{2,4}$/, "")
        .replace(/^\s*[\[(][^\])]*[\])]\s*/, "")
        .replace(/(?:\.|_)-(?:\.|_)/g, " - ");
    const m = base.match(/^(.+?)\s+-\s+(\d{1,4})(?:v\d)?(?=\s|[(\[]|$)/);
    if (!m) return;
    const ep = parseInt(m[2], 10);
    let title = m[1].replace(/\s{2,}/g, " ").trim();
    // "Hunter x Hunter (2011) - 148": a year INSIDE the title group is part of the title block, not a movie year.
    const _ym = title.match(/\s*[(\[]((?:19|20)\d{2})[)\]]\s*$/);
    if (_ym) title = title.slice(0, _ym.index).trim();
    else if (adv.year) return;
    if (!/\s/.test(title) && /\w\.\w/.test(title)) title = title.replace(/\./g, " ").trim(); // "Dragon.Ball.Z.One" → words
    if (title.length < 2 || (ep >= 1900 && ep <= 2100) || [360, 480, 576, 720, 1080, 2160].includes(ep)) return;
    if (adv.episodes && adv.episodes.length > 0 && !adv.episodes.includes(ep)) return;
    const fansub = /_-_/.test(origName) || /^\s*\[/.test(String(name)) || /\b(?:BD|BDRip|BDMV|Blu-?ray|Dual[ ._]Audio|[0-9A-F]{8})\b/i.test(base);
    adv.title = title;
    adv.episode = ep;
    adv.episodes = [ep];
    adv.type = adv.type === "anime" || fansub ? "anime" : "series";
    return true;
}

// ── v6: more release-site prefix shapes + bracketed year ─────────────────────
// "9xmovies - Gadar 2 (2023)", "Mkvcinemas.com Kalki 2898 AD (2024)", "SSRmovies.cfd Salaar …",
// "Ibomma.Pw Devara …", "HDHub4u.Tv Mirzapur S03E01", "@MovieChannel - Coco (2017)", "#Tamilrockers Leo 2023",
// "Downloaded from MoviesHD - Gladiator (2000)". Conservative on purpose: a KNOWN site name, or <name>.<tld>
// followed by a SPACE (dot-separated titles such as "In.To.The.Woods" are never touched), or an explicit
// @tag / #tag / "Downloaded from" lead-in. Bracketed years: "Inception [2010]" → "Inception (2010)".
const _V6_TLD =
    "com|net|org|co|in|io|tv|to|me|cc|pw|link|site|xyz|info|biz|club|fun|live|pro|vip|us|ws|fi|cam|run|bz|sbs|cfd|lol|mx|ag|ac|fm|la|mom|wtf|rest|ink|pk|bd|lk|np|icu|tk|ru|sx|cx|nz|dev|app|cloud|rocks|day|city|click|best|today|mobi|one|win";
const _V6_SITE_STEMS =
    "1tamilmv|tamilmv|tamilblasters|tamilrockers|tamilyogi|tamilgun|isaimini|kuttymovies|madrasrockers|\\d*movierulz|vegamovies|mkvcinemas|khatrimaza|bolly4u|bollyflix|filmyzilla|filmywap|filmyhit|pagalmovies|ssrmovies|hdhub4u|moviesmod|katmoviehd|ibomma|\\d+xmovies|worldfree4u|jiorockers|todaypk|moviezwap|skymovieshd|hdmovie2|moviemad|cinevood|movielinkbd|torrenting|desicinemas|toonshub|extramovies|dotmovies|mp4moviez|mlwbd|moviesflix|themoviesflix|netnaija|psarips|moviesverse|cinemaza|desiremovies|10bitmovies|uwatchfree|mlsbd|banglaflix|movies4u|downloadhub|yts";
const _V6_SITE_STEM_RE = new RegExp("^\\s*[@#]?(?:" + _V6_SITE_STEMS + ")(?:\\.(?:" + _V6_TLD + "))?(?:\\s*[-\\u2013]\\s+|\\s+(?=\\S)|\\.(?=[A-Za-z0-9]))", "i");
const _V6_DOMAIN_RE = new RegExp("^\\s*[A-Za-z0-9][A-Za-z0-9-]{2,}\\.(?:" + _V6_TLD + ")\\s+(?=\\S)", "i");
const _V6_TAG_RE = /^\s*[@#][A-Za-z][\w.-]{3,}\s*(?:[-\u2013]\s*|\s+)(?=\S)/;
const _V6_DOWNLOADED_RE = /^\s*download(?:ed)?\s+from\s+[\w.@-]+\s*[-\u2013]\s*/i;
function _v6StripPrefixes(name) {
    let n = name;
    for (let i = 0; i < 2; i++) {
        const before = n;
        n = n.replace(_V6_DOWNLOADED_RE, "").replace(_V6_TAG_RE, "").replace(_V6_SITE_STEM_RE, "").replace(_V6_DOMAIN_RE, "");
        if (n === before) break;
    }
    if (!n.trim() || /^\.?[A-Za-z0-9]{2,4}$/.test(n.trim())) return name; // never strip the name down to nothing/extension
    return n.replace(/(?<=[\w.)\s])\s*\[((?:19|20)\d{2})\]/g, " ($1)");
}

// ── v9: title-tail interpretation ────────────────────────────────────────────
// (a) "Show 2nd Season - 05", "Show - Season 2 - Episode 05", "Show Season 2": the season marker belongs to the
//     SEASON field, not the title (otherwise every season of one anime becomes its own library group and TMDB is
//     searched with "Show 2nd Season"). Only for non-movies, only when no explicit season was already found
//     or the found season agrees.
// (b) "Show - OVA 02" / "Show - Special 01": a special/OVA marker with a number is an episode number, not title text.
// (c) "1984 (1984)": a parenthesised year that merely repeats the extracted year is not part of the title.
const _V9_SEASON_TAIL_RES = [/\s*[-\u2013:]?\s*(\d{1,2})(?:st|nd|rd|th)\s+Season$/i, /\s*[-\u2013:]?\s*Season\s*(\d{1,2})$/i];
const _V9_SPECIAL_TAIL_RE = /\s*[-\u2013]?\s*(?:OVA|OAD|ONA|Special|SP)\s*0*(\d{1,3})$/i;
function _v9TitleTail(adv) {
    if (!adv || !adv.title) return;
    let t = adv.title.replace(/[\s\-\u2013\u2014:]+$/, "").trim() || adv.title; // the Episode token leaves "Title - Season 2 -"
    if (adv.type !== "movie") {
        for (let i = 0; i < 2; i++) {
            let hit = false;
            for (const re of _V9_SEASON_TAIL_RES) {
                const m = t.match(re);
                if (!m) continue;
                const sn = parseInt(m[1], 10);
                const rest = t
                    .slice(0, m.index)
                    .replace(/[\s\-\u2013:]+$/, "")
                    .trim();
                if (rest.length < 2) continue;
                if (adv.season == null || adv.season === sn) {
                    adv.season = sn;
                    t = rest;
                    hit = true;
                    break;
                }
            }
            if (!hit) break;
        }
        const sm = t.match(_V9_SPECIAL_TAIL_RE);
        const _smEp = sm ? parseInt(sm[1], 10) : null;
        if (sm && (adv.episode == null || adv.episode === _smEp) && !(adv.episodes && adv.episodes.length && !adv.episodes.includes(_smEp))) {
            const rest = t
                .slice(0, sm.index)
                .replace(/[\s\-\u2013:]+$/, "")
                .trim();
            if (rest.length >= 2) {
                const ep = _smEp;
                t = rest;
                adv.episode = ep;
                adv.episodes = [ep];
            }
        }
    }
    if (adv.year) {
        const dm = t.match(/^(.*\S)\s*\((?:19|20)\d{2}\)$/);
        if (dm && t.endsWith(`(${adv.year})`) && dm[1].trim().length >= 1) t = dm[1].trim();
    }
    adv.title = t;
}

// ── v6: "Ep05" / "Ep.05" / "Episode 5" tokens that are not SxxExx ────────────
function _v6EpisodeToken(adv, name) {
    if (!adv || !adv.title) return;
    const m = adv.title.match(/(?:^|[\s._-])(?:Ep|Episode)[\s._-]?0*(\d{1,3})$/i);
    if (!m) return;
    const ep = parseInt(m[1], 10);
    const stripped = adv.title
        .slice(0, m.index)
        .replace(/[\s._-]+$/, "")
        .trim();
    if (stripped.length < 2) return;
    if (adv.episodes && adv.episodes.length && !adv.episodes.includes(ep)) return;
    adv.title = stripped;
    adv.episode = ep;
    adv.episodes = [ep];
    if (adv.type === "movie") adv.type = "series";
}

// ── v4 helper: false-anime check (see step 4 above) ─────────────────────────
function _v4IsFalseAnime(adv, filename) {
    if (adv.type !== "anime") return false;
    if (adv.season != null) return false;
    if (adv.episodes && adv.episodes.length > 0) return false;
    const base = filename.replace(/\.\w{2,4}$/, "");
    if (/^\s*[\[(]/.test(base)) return false; // fansub/site prefix → existing rules decide
    const m = base.match(ANIME_HINTS);
    if (!m || !/^[Ss]ub(?:bed)?$/.test(m[1] || "")) return false; // other kind of hint
    if (base.slice(0, m.index).replace(/[\s._-]+/g, "") !== "") return false; // not leading
    return !ANIME_HINTS.test(base.slice(m.index + m[0].length)); // no other hint later
}

// ============================================================================
// ─── Title candidates (bounded, deterministic) ──────────────────────────────
// ============================================================================
// Up to MAX_TITLE_CANDIDATES distinct titles, each tagged with the strategy
// that produced it, ranked by explainable signals. Used by tmdb.js to retry
// a lookup with alternate cleanups. No regex-per-candidate explosion: 4
// fixed strategies, each one cheap string operation.
const MAX_TITLE_CANDIDATES = 4;

// Technical release metadata that should NOT remain inside a title.
const _TECH_LEFTOVER_RE = /\b(?:2160p|1080p|720p|480p|x26[45]|h\.?26[45]|hevc|web[\s.-]?(?:dl|rip)|blu[\s.-]?ray|bdrip|brrip|dvdrip|hdrip|hdtv|remux|hdr10?|atmos|ddp?[\s.]?\d|dts|aac|ac3)\b/i;

function _candKey(t) {
    return t
        .toLowerCase()
        .replace(/[^a-z0-9\u00c0-\uffff]+/g, " ")
        .trim();
}

// The title text exactly as written in the file name, up to the year / first technical tag:
// "John.Wick.Chapter.3.Parabellum.2019.1080p…" → "John Wick Chapter 3 Parabellum". The primary
// title drops "Chapter 3 Parabellum" (it is split into `part`), and "S.W.A.T.2.2011" loses its
// sequel number; this keeps the whole phrase as an ADDITIVE candidate (title/part fields and
// grouping are untouched).
function _fullTitleSegment(adv, filename) {
    let base = String(filename).replace(/\.[A-Za-z0-9]{2,4}$/, "");
    base = base.replace(/^\s*[\[(][^\])]*[\])]\s*/, "").replace(/[._]/g, " ");
    let cut = base.length;
    if (adv.year) {
        const re = new RegExp("(?:^|[\\s(\\[])" + adv.year + "(?![0-9])", "g");
        let m,
            last = -1;
        while ((m = re.exec(base))) last = m.index;
        if (last > 0) cut = Math.min(cut, last);
    }
    const t = base.search(_TECH_LEFTOVER_RE);
    if (t > 0) cut = Math.min(cut, t);
    return base
        .slice(0, cut)
        .replace(/[\s\-\u2013([]+$/, "")
        .replace(/\s{2,}/g, " ")
        .trim();
}

function buildTitleCandidates(adv, filename) {
    const primary = typeof adv.title === "string" ? adv.title.trim() : "";
    if (!primary) return [];

    const raw = [{ title: primary, source: "primary" }];

    // Strategy 1b (movies): the full phrase from the file name, when it extends the primary title
    // (subtitle / chapter / sequel number that the primary title dropped).
    if (adv.type === "movie") {
        const full = _fullTitleSegment(adv, filename);
        if (full && _candKey(full).startsWith(_candKey(primary) + " ")) raw.push({ title: full, source: "full-title" });
    }

    // Strategy 2: the base (noise-stripping) parser's own opinion.
    try {
        const t = parseFilename(filename).title;
        if (t) raw.push({ title: t.trim(), source: "base-parser" });
    } catch {
        /* ignore */
    }

    // Strategy 4: trailing 4-digit number removed ("Foo 1999" → "Foo").
    // Kept as a LOW-trust fallback — the year may be part of the real title.
    const noYear = primary.replace(/\s+(?:19|20)\d{2}$/, "").trim();
    if (noYear) raw.push({ title: noYear, source: "no-trailing-year" });

    // Strategy 3: primary without (parenthesised) / [bracketed] leftovers.
    const noParen = primary
        .replace(/\s*[([{][^)\]}]*[)\]}]/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
    if (noParen) raw.push({ title: noParen, source: "no-brackets" });

    const seen = new Set();
    const out = [];
    for (const [i, c] of raw.entries()) {
        const key = _candKey(c.title);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push({
            title: c.title,
            source: c.source,
            signals: {
                leftoverTech: _TECH_LEFTOVER_RE.test(c.title),
                wordCount: key.split(" ").length,
            },
            _order: i,
        });
    }

    // Rank: clean-of-tech first, then strategy order. Stable and deterministic.
    out.sort((a, b) => Number(a.signals.leftoverTech) - Number(b.signals.leftoverTech) || a._order - b._order);
    return out.slice(0, MAX_TITLE_CANDIDATES).map(({ _order, ...rest }) => rest);
}

// ── v9: folder context ───────────────────────────────────────────────────────
// scanner.js records the full path, but the parser only ever saw the bare name. "Show Name/Season 2/S02E05.mkv",
// "Show Name/Season 2/05.mkv" and "Inception (2010)/movie.mkv" carry NO title in the file name itself. The parent
// folder (and, for "Season N" folders, the grandparent) is used ONLY when the file's own parse has no usable title.
// A file with its own title is never overridden by its folder.
const _V9_SEASON_FOLDER_RE = /^(?:season|series|staffel|saison|temporada|s)[\s._-]*0*(\d{1,2})$|^specials?$/i;
const _V9_GENERIC_TITLE_RE = /^(?:movie|film|video|main|feature|sample|title|disc|clip|file|untitled|episode|ep|e|part|cd\s*\d|disc\s*\d)\d*$/i;
function _v9FolderParts(filePath) {
    if (typeof filePath !== "string" || !filePath) return [];
    return filePath
        .split(/[\\/]+/)
        .filter(Boolean)
        .slice(0, -1)
        .reverse(); // [parent, grandparent, ...]
}
function parseFilenameWithContext(filename, filePath) {
    const own = parseFilenamePatchedV4(filename);
    if (!filePath) return own;
    try {
        const parts = _v9FolderParts(filePath);
        if (!parts.length) return own;
        const stem = String(filename).replace(_V8_KNOWN_EXT_RE, "").trim();
        const titleless = !own.title || _V9_GENERIC_TITLE_RE.test(own.title.trim());
        const bareNumber = /^\d{1,3}$/.test(stem);
        let seasonFromFolder = null;
        let titleFolder = parts[0];
        const sf = parts[0].match(_V9_SEASON_FOLDER_RE);
        if (sf) {
            seasonFromFolder = /^specials?$/i.test(parts[0]) ? 0 : parseInt(sf[1], 10);
            titleFolder = parts[1];
        }
        if (!titleless && !(bareNumber && sf)) return own;
        if (!titleFolder || _V9_SEASON_FOLDER_RE.test(titleFolder)) return own;
        const fp = parseFilenamePatchedV4(titleFolder);
        if (!fp.title || _V9_GENERIC_TITLE_RE.test(fp.title.trim())) return own;
        const merged = { ...fp };
        const hasEp = (own.episodes && own.episodes.length) || own.episode != null || bareNumber;
        const season = own.season != null ? own.season : seasonFromFolder;
        if (hasEp || season != null) {
            merged.type = fp.type === "anime" ? "anime" : "series";
            if (season != null) merged.season = season;
            const ep = own.episode != null ? own.episode : bareNumber ? parseInt(stem, 10) : null;
            if (ep != null) {
                merged.episode = ep;
                merged.episodes = own.episodes && own.episodes.length ? own.episodes : [ep];
            }
        } else {
            merged.type = fp.type;
        }
        if (own.year && !merged.year) merged.year = own.year;
        if (own.part != null && merged.part == null) merged.part = own.part;
        for (const k of ["season", "episode", "episodeEnd", "part", "year"]) if (merged[k] == null) delete merged[k];
        if (fp.titleCandidates) Object.defineProperty(merged, "titleCandidates", { value: fp.titleCandidates, enumerable: false, writable: true, configurable: true });
        const notes = [...(own.parseNotes || []), "folder-context"];
        Object.defineProperty(merged, "originalName", { value: filename, enumerable: false, writable: true, configurable: true });
        Object.defineProperty(merged, "parseNotes", { value: notes, enumerable: false, writable: true, configurable: true });
        return merged;
    } catch {
        return own; // context is a heuristic; never let it break parsing
    }
}

// Re-export. parseFilename(name, [fullPath]) — the optional path enables folder context; one-argument calls are unchanged.
module.exports = {
    parseFilename: parseFilenameWithContext,
    parseFilenameOriginal: parseFilename,
};
