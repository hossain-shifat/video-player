"use strict";

const fs = require("fs");
const path = require("path");
const { createMediaInfoCache } = require("./ffprobeService");

const STORE_FILE = path.join(__dirname, "..", "data", "mediainfo.json");

let store = new Map();
let loaded = false;
let dirty = false;
let saveTimer = null;

function loadStore() {
    if (loaded) return;
    try {
        const raw = fs.readFileSync(STORE_FILE, "utf-8");
        store = new Map(Object.entries(JSON.parse(raw)));
        console.log("[MediaInfo] Loaded " + store.size + " cached entries from " + STORE_FILE);
    } catch (err) {
        if (err.code !== "ENOENT") {
            console.error("[MediaInfo] Failed to load cache, starting fresh:", err.message);
        } else {
            console.log("[MediaInfo] No existing cache at " + STORE_FILE + " - starting fresh");
        }
        store = new Map();
    }
    loaded = true;
}

function scheduleSave() {
    dirty = true;
    if (saveTimer) return;
    saveTimer = setTimeout(function () {
        saveTimer = null;
        if (!dirty) return;
        dirty = false;
        writeStoreToDisk().catch(function (err) {
            console.error("[MediaInfo] Save failed:", err.message);
        });
    }, 2000);
}

async function writeStoreToDisk() {
    const obj = Object.fromEntries(store);
    const tmp = STORE_FILE + ".tmp." + process.pid + "." + Date.now();
    const fd = await fs.promises.open(tmp, "w");
    try {
        await fd.writeFile(JSON.stringify(obj, null, 2), "utf-8");
        await fd.sync();
    } finally {
        await fd.close();
    }
    await fs.promises.rename(tmp, STORE_FILE);
    console.log("[MediaInfo] Saved " + store.size + " entries to " + STORE_FILE);
}

function invalidate(fileId) {
    loadStore();
    if (store.delete(fileId)) scheduleSave();
}

function invalidateAll() {
    store.clear();
    scheduleSave();
}

// Returns the ENTIRE store as a plain object - { fileId: mediaInfo, ... }
function getAll() {
    loadStore();
    return Object.fromEntries(store);
}

// ─── Formatting helpers ─────────────────────────────────────────────────────

function formatDuration(totalSeconds) {
    if (!totalSeconds || totalSeconds <= 0) return null;
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    const pad = function (n) {
        return String(n).padStart(2, "0");
    };
    return pad(h) + ":" + pad(m) + ":" + pad(s);
}

function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return null;
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value = value / 1024;
        unitIndex++;
    }
    return value.toFixed(2) + " " + units[unitIndex];
}

function formatBitrate(bitsPerSecond) {
    if (!bitsPerSecond || bitsPerSecond <= 0) return null;
    if (bitsPerSecond >= 1000000) return (bitsPerSecond / 1000000).toFixed(2) + " Mbps";
    return Math.round(bitsPerSecond / 1000) + " Kbps";
}

function formatFrameRate(frStr) {
    if (!frStr) return null;
    const parts = String(frStr).split("/");
    let value = null;
    if (parts.length === 2) {
        const num = parseFloat(parts[0]);
        const den = parseFloat(parts[1]);
        if (den > 0 && Number.isFinite(num)) value = num / den;
    } else {
        const parsed = parseFloat(frStr);
        if (Number.isFinite(parsed)) value = parsed;
    }
    if (value === null) return null;
    return Math.round(value * 1000) / 1000 + " fps";
}

// Cinematic aspect ratio, e.g. "1.78:1" or "2.39:1" - matches how MediaInfo/
// Plex/Jellyfin display it, instead of a raw unreduced pixel fraction.
function formatAspectRatio(width, height) {
    if (!width || !height) return null;
    return (width / height).toFixed(2) + ":1";
}

// ffprobe reports 10/12-bit color as part of pix_fmt, e.g. "yuv420p10le".
function detectBitDepth(pixFmt) {
    if (!pixFmt) return 8;
    if (pixFmt.indexOf("p12") !== -1) return 12;
    if (pixFmt.indexOf("p10") !== -1) return 10;
    return 8;
}

// ─── Language inference (best-effort, always clearly labeled) ─────────────
//
// ffprobe only ever reports a language when the FILE ITSELF has that tag
// written into it. If tags.language is genuinely absent, ffprobe has nothing
// to give us - there is no hidden flag or command that "unlocks" data that
// was never written to the file. What CAN help: other clues already present
// in the same file - the track's own title text (e.g. a subtitle track
// titled "English SDH" with no language tag), and the movie/episode
// filename's own language hints (e.g. "[Dual Audio] [Hindi+English]").
//
// Every guessed value gets languageSource so it is NEVER confused with a
// real ffprobe tag:
//   "tag"      - came directly from ffprobe's tags.language (authoritative)
//   "title"    - inferred from the track's own title text
//   "filename" - inferred from the movie/episode filename. For audio,
//                matched in filename order against untagged audio tracks
//                (e.g. "[Hindi+English]"). For subtitles, recognizes the
//                ESub/ESubs/EngSub release-naming convention (meaning
//                "English subtitles included"), falling back to a general
//                language word if the filename spells one out directly.
//   null       - genuinely could not be determined from anything available

// Bump this any time detectLanguageFromText / detectSubtitleLanguageFromFilename
// / LANGUAGE_MAP / SUBTITLE_HINT_MAP changes. needsLanguageInference() compares
// an entry's stored version against this - if they don't match, inference
// runs again even for tracks that already have languageSource set (including
// explicitly null ones). Without this, a null result from an older/weaker
// version of the algorithm gets permanently locked in forever, because
// "languageSource is set" was being treated as "already tried, don't retry" -
// even after the matching logic itself got smarter.
// v3: FIX — ffprobe writes the literal placeholder tag "und" (ISO 639-2 for
// "undetermined") on tracks that were never given a real language tag by
// whatever tool created the file. The old code treated ANY truthy
// tags.language (including "und"/"unk"/"") as an authoritative, confirmed
// tag and skipped inference entirely — so these tracks were permanently
// stuck showing "UND" even when the filename or a title clearly spelled the
// language out. isRealLanguageTag() below now filters those placeholders
// out before inference decides whether a track already has a real tag.
const LANGUAGE_INFERENCE_VERSION = 3;

// ffprobe/mkvmerge placeholder values meaning "no real language tag was set" -
// treated the same as no tag at all, everywhere a track's language is read.
const UNKNOWN_LANGUAGE_TAGS = new Set(["und", "unk", "unknown", "n/a", "null", "none", ""]);

function isRealLanguageTag(code) {
    if (!code) return false;
    return !UNKNOWN_LANGUAGE_TAGS.has(String(code).trim().toLowerCase());
}

// 3-letter ISO 639-2 code -> full display name, so the UI can show "English"
// instead of a bare code or, worse, "UND". Shares the same code-space as
// LANGUAGE_MAP's values below (deliberately — one map produces the codes,
// this one names them).
const LANGUAGE_NAMES = {
    eng: "English",
    hin: "Hindi",
    tam: "Tamil",
    tel: "Telugu",
    ara: "Arabic",
    mal: "Malayalam",
    kan: "Kannada",
    ben: "Bengali",
    pan: "Punjabi",
    mar: "Marathi",
    guj: "Gujarati",
    urd: "Urdu",
    fre: "French",
    spa: "Spanish",
    ger: "German",
    ita: "Italian",
    jpn: "Japanese",
    kor: "Korean",
    chi: "Chinese",
    por: "Portuguese",
    rus: "Russian",
    tha: "Thai",
    vie: "Vietnamese",
    ind: "Indonesian",
    tur: "Turkish",
    per: "Persian",
    pol: "Polish",
    dut: "Dutch",
};

// Best-effort code -> full name. Falls back to the raw (uppercased) code for
// anything genuinely outside this map, rather than a hardcoded "Unknown" -
// still more useful than nothing, and never silently swallows a real code
// we just haven't named yet.
function getLanguageName(code) {
    if (!isRealLanguageTag(code)) return null;
    const key = String(code).trim().toLowerCase();
    return LANGUAGE_NAMES[key] || key.toUpperCase();
}

const LANGUAGE_MAP = {
    english: "eng",
    eng: "eng",
    hindi: "hin",
    hin: "hin",
    tamil: "tam",
    tam: "tam",
    telugu: "tel",
    tel: "tel",
    arabic: "ara",
    ara: "ara",
    malayalam: "mal",
    mal: "mal",
    kannada: "kan",
    kan: "kan",
    bengali: "ben",
    bangla: "ben",
    ben: "ben",
    punjabi: "pan",
    pan: "pan",
    marathi: "mar",
    mar: "mar",
    gujarati: "guj",
    guj: "guj",
    urdu: "urd",
    urd: "urd",
    french: "fre",
    francais: "fre",
    fra: "fre",
    fre: "fre",
    spanish: "spa",
    espanol: "spa",
    spa: "spa",
    german: "ger",
    deutsch: "ger",
    deu: "ger",
    ger: "ger",
    italian: "ita",
    ita: "ita",
    japanese: "jpn",
    jpn: "jpn",
    korean: "kor",
    kor: "kor",
    chinese: "chi",
    mandarin: "chi",
    zho: "chi",
    chi: "chi",
    portuguese: "por",
    por: "por",
    russian: "rus",
    rus: "rus",
    thai: "tha",
    tha: "tha",
    vietnamese: "vie",
    vie: "vie",
    indonesian: "ind",
    ind: "ind",
    turkish: "tur",
    tur: "tur",
    persian: "per",
    farsi: "per",
    fas: "per",
    polish: "pol",
    pol: "pol",
    dutch: "dut",
    nld: "dut",
};

// Common release-naming shorthand meaning "English subtitles included" -
// e.g. "ESub", "ESubs", "Eng Sub". Kept in a SEPARATE map from LANGUAGE_MAP
// on purpose: "esub" specifically signals SUBTITLE language, and would be
// wrong to apply to audio-track guessing (a file can be "Hindi 5.1, ESub"
// meaning Hindi AUDIO + English SUBTITLES - very common in this naming style).
const SUBTITLE_HINT_MAP = {
    esub: "eng",
    esubs: "eng",
    engsub: "eng",
    engsubs: "eng",
};

// Scans free text (a track's own title, etc.) for a known language name or
// code, using whole-word matching so "tam" never matches inside an unrelated
// word by accident.
function detectLanguageFromText(text) {
    if (!text) return null;
    const tokens = String(text)
        .toLowerCase()
        .match(/[a-z]+/g);
    if (!tokens) return null;
    for (let i = 0; i < tokens.length; i++) {
        if (LANGUAGE_MAP[tokens[i]]) return LANGUAGE_MAP[tokens[i]];
    }
    return null;
}

// Subtitle-specific filename scan - checks for the ESub/ESubs/EngSub
// convention first (an explicit subtitle-language signal), then falls back
// to a general language word if the filename happens to spell it out
// (e.g. "...Hindi Subtitles..."). This is intentionally separate from
// extractLanguagesFromFilename() below, which is audio-oriented and matches
// multiple languages in order for multi-audio files.
function detectSubtitleLanguageFromFilename(name) {
    if (!name) return null;
    const tokens = String(name)
        .toLowerCase()
        .match(/[a-z]+/g);
    if (!tokens) return null;
    for (let i = 0; i < tokens.length; i++) {
        if (SUBTITLE_HINT_MAP[tokens[i]]) return SUBTITLE_HINT_MAP[tokens[i]];
    }
    for (let i = 0; i < tokens.length; i++) {
        if (LANGUAGE_MAP[tokens[i]]) return LANGUAGE_MAP[tokens[i]];
    }
    return null;
}

// Pulls an ORDERED list of unique language codes mentioned in a filename,
// e.g. "Interstellar [Dual Audio] [Hindi+English]" -> ["hin", "eng"]. Order
// matters - it is used to match filename language order against untagged
// audio tracks in the order they appear in the file.
function extractLanguagesFromFilename(name) {
    if (!name) return [];
    const tokens = String(name)
        .toLowerCase()
        .match(/[a-z]+/g);
    if (!tokens) return [];
    const found = [];
    for (let i = 0; i < tokens.length; i++) {
        const code = LANGUAGE_MAP[tokens[i]];
        if (code && found.indexOf(code) === -1) found.push(code);
    }
    return found;
}

// Fills in missing language fields on audio/subtitle tracks. Returns NEW
// arrays (never mutates input). Tracks that already had a real tag are left
// untouched except for adding languageSource: "tag" for transparency.
function inferMissingLanguages(audioTracks, subtitleTracks, filename) {
    const filenameLangs = extractLanguagesFromFilename(filename);

    const alreadyTagged = {};
    for (let i = 0; i < audioTracks.length; i++) {
        if (isRealLanguageTag(audioTracks[i].language)) alreadyTagged[audioTracks[i].language] = true;
    }
    for (let i = 0; i < subtitleTracks.length; i++) {
        if (isRealLanguageTag(subtitleTracks[i].language)) alreadyTagged[subtitleTracks[i].language] = true;
    }

    const remainingForAudio = filenameLangs.filter(function (l) {
        return !alreadyTagged[l];
    });
    let audioGuessIndex = 0;

    const newAudioTracks = audioTracks.map(function (a) {
        if (isRealLanguageTag(a.language)) return Object.assign({}, a, { languageSource: "tag", languageName: getLanguageName(a.language) });
        const fromTitle = detectLanguageFromText(a.title);
        if (fromTitle) return Object.assign({}, a, { language: fromTitle, languageSource: "title", languageName: getLanguageName(fromTitle) });
        const fromFilename = remainingForAudio[audioGuessIndex];
        if (fromFilename) {
            audioGuessIndex++;
            return Object.assign({}, a, { language: fromFilename, languageSource: "filename", languageName: getLanguageName(fromFilename) });
        }
        return Object.assign({}, a, { languageSource: null, languageName: null });
    });

    const newSubtitleTracks = subtitleTracks.map(function (s) {
        if (isRealLanguageTag(s.language)) return Object.assign({}, s, { languageSource: "tag", languageName: getLanguageName(s.language) });
        const fromTitle = detectLanguageFromText(s.title);
        if (fromTitle) return Object.assign({}, s, { language: fromTitle, languageSource: "title", languageName: getLanguageName(fromTitle) });
        const fromFilename = detectSubtitleLanguageFromFilename(filename);
        if (fromFilename) return Object.assign({}, s, { language: fromFilename, languageSource: "filename", languageName: getLanguageName(fromFilename) });
        return Object.assign({}, s, { languageSource: null, languageName: null });
    });

    return { audioTracks: newAudioTracks, subtitleTracks: newSubtitleTracks };
}

// ─── Raw ffprobe JSON -> professional, organized schema ─────────────────────

function buildDetailedInfo(raw, file) {
    const format = raw.format || {};
    const streams = raw.streams || [];

    const durationSeconds = format.duration ? parseFloat(format.duration) : null;
    const sizeBytes = format.size ? parseInt(format.size, 10) : null;
    const bitrateBps = format.bit_rate ? parseInt(format.bit_rate, 10) : null;

    // Cover-art images (folder.jpg/poster embedded as a stream) show up as
    // codec_type "video" too - exclude those so the real video track is used.
    const COVER_ART_CODECS = { png: true, mjpeg: true, bmp: true, gif: true, tiff: true };
    const videoStreams = streams.filter(function (s) {
        return s.codec_type === "video" && !COVER_ART_CODECS[s.codec_name];
    });
    const audioStreams = streams.filter(function (s) {
        return s.codec_type === "audio";
    });
    const subtitleStreams = streams.filter(function (s) {
        return s.codec_type === "subtitle";
    });

    const v = videoStreams[0] || null;

    let video = null;
    if (v) {
        video = {
            codec: v.codec_name ? v.codec_name.toUpperCase() : null,
            profile: v.profile || null,
            resolution: v.width && v.height ? v.width + "x" + v.height : null,
            width: v.width || null,
            height: v.height || null,
            aspectRatio: formatAspectRatio(v.width, v.height),
            frameRate: formatFrameRate(v.avg_frame_rate),
            bitDepth: detectBitDepth(v.pix_fmt),
            bitrate: formatBitrate(v.bit_rate ? parseInt(v.bit_rate, 10) : null),
        };
    }

    let audioTracks = audioStreams.map(function (a) {
        return {
            codec: a.codec_name ? a.codec_name.toUpperCase() : null,
            language: (a.tags && a.tags.language) || null,
            channels: a.channels || null,
            channelLayout: a.channel_layout || null,
            sampleRate: a.sample_rate ? parseInt(a.sample_rate, 10) + " Hz" : null,
            bitrate: formatBitrate(a.bit_rate ? parseInt(a.bit_rate, 10) : null),
            default: !!(a.disposition && a.disposition.default),
            title: (a.tags && a.tags.title) || null,
        };
    });

    let subtitleTracks = subtitleStreams.map(function (s) {
        return {
            codec: s.codec_name || null,
            language: (s.tags && s.tags.language) || null,
            title: (s.tags && s.tags.title) || null,
            forced: !!(s.disposition && s.disposition.forced),
        };
    });

    const inferred = inferMissingLanguages(audioTracks, subtitleTracks, file.name);
    audioTracks = inferred.audioTracks;
    subtitleTracks = inferred.subtitleTracks;

    return {
        id: file.id,
        name: file.name || null,
        container: {
            format: format.format_name || null,
            duration: formatDuration(durationSeconds),
            durationSeconds: durationSeconds,
            size: formatBytes(sizeBytes),
            sizeBytes: sizeBytes,
            bitrate: formatBitrate(bitrateBps),
            bitrateBps: bitrateBps,
        },
        video: video,
        audioTracks: audioTracks,
        subtitleTracks: subtitleTracks,
        probedAt: new Date().toISOString(),
        _langInferenceVersion: LANGUAGE_INFERENCE_VERSION,
    };
}

// Old flat { id, name, format, streams } entries (from before this schema
// existed) get reshaped into the new structure using whatever data they
// already have, WITHOUT needing to re-probe the file. Fields that only the
// raw ffprobe JSON has (profile, pix_fmt, channel_layout, disposition) come
// back null until that file is naturally re-probed - everything else,
// including language inference, upgrades immediately.
function reshapeOldEntry(old, file) {
    const oldFormat = old.format || {};
    const oldStreams = old.streams || [];

    const durationSeconds = oldFormat.duration || null;
    const sizeBytes = oldFormat.size || null;
    const bitrateBps = oldFormat.bitRate || null;

    let v = null;
    for (let i = 0; i < oldStreams.length; i++) {
        if (oldStreams[i].codecType === "video") {
            v = oldStreams[i];
            break;
        }
    }
    const audioList = oldStreams.filter(function (s) {
        return s.codecType === "audio";
    });
    const subList = oldStreams.filter(function (s) {
        return s.codecType === "subtitle";
    });

    let video = null;
    if (v) {
        video = {
            codec: v.codecName ? v.codecName.toUpperCase() : null,
            profile: null,
            resolution: v.width && v.height ? v.width + "x" + v.height : null,
            width: v.width || null,
            height: v.height || null,
            aspectRatio: formatAspectRatio(v.width, v.height),
            frameRate: formatFrameRate(v.frameRate),
            bitDepth: 8,
            bitrate: null,
        };
    }

    let audioTracks = audioList.map(function (a) {
        return {
            codec: a.codecName ? a.codecName.toUpperCase() : null,
            language: a.language || null,
            channels: a.channels || null,
            channelLayout: null,
            sampleRate: a.sampleRate ? a.sampleRate + " Hz" : null,
            bitrate: null,
            default: false,
            title: a.title || null,
        };
    });

    let subtitleTracks = subList.map(function (s) {
        return {
            codec: s.codecName || null,
            language: s.language || null,
            title: s.title || null,
            forced: false,
        };
    });

    const inferred = inferMissingLanguages(audioTracks, subtitleTracks, file.name);
    audioTracks = inferred.audioTracks;
    subtitleTracks = inferred.subtitleTracks;

    return {
        id: file.id,
        name: file.name || old.name || null,
        container: {
            format: oldFormat.formatName || null,
            duration: formatDuration(durationSeconds),
            durationSeconds: durationSeconds,
            size: formatBytes(sizeBytes),
            sizeBytes: sizeBytes,
            bitrate: formatBitrate(bitrateBps),
            bitrateBps: bitrateBps,
        },
        video: video,
        audioTracks: audioTracks,
        subtitleTracks: subtitleTracks,
        probedAt: old._cachedAt || new Date().toISOString(),
        _langInferenceVersion: LANGUAGE_INFERENCE_VERSION,
    };
}

// True if this entry hasn't been run through the CURRENT version of language
// inference yet. Version-based (not just "does languageSource exist") so
// that improving the matching logic (new language words, new filename
// conventions like ESub, etc.) automatically re-processes every entry once -
// including ones that already resolved to null under an older version.
function needsLanguageInference(entry) {
    return entry._langInferenceVersion !== LANGUAGE_INFERENCE_VERSION;
}

function setCache(fileId, info) {
    store.set(fileId, info);
    scheduleSave();
}

/**
 * getMediaInfo(file) - file = { id, path, name }
 *
 * Returns a detailed, organized media info object:
 * {
 *   id, name,
 *   container: { format, duration, durationSeconds, size, sizeBytes, bitrate, bitrateBps },
 *   video: { codec, profile, resolution, width, height, aspectRatio, frameRate, bitDepth, bitrate } | null,
 *   audioTracks: [ { codec, language, languageSource, channels, channelLayout, sampleRate, bitrate, default, title } ],
 *   subtitleTracks: [ { codec, language, languageSource, title, forced } ],
 *   probedAt
 * }
 *
 * Cache hit  - instant. Old-shape entries are upgraded in place. Entries
 *              already in the new shape but missing language inference get
 *              that backfilled too. Neither path re-runs ffprobe.
 * Cache miss - runs ffprobe, builds the full detailed entry with inference applied.
 */
async function getMediaInfo(file) {
    loadStore();

    const cached = store.get(file.id);
    if (cached) {
        const isNewShape = cached.container !== undefined;

        if (!isNewShape) {
            // Old flat { id, name, format, streams } shape - upgrade it now
            const upgraded = reshapeOldEntry(cached, file);
            setCache(file.id, upgraded);
            return upgraded;
        }

        if (needsLanguageInference(cached)) {
            const inferred = inferMissingLanguages(cached.audioTracks || [], cached.subtitleTracks || [], file.name);
            const updated = Object.assign({}, cached, {
                id: file.id,
                name: file.name || null,
                audioTracks: inferred.audioTracks,
                subtitleTracks: inferred.subtitleTracks,
                _langInferenceVersion: LANGUAGE_INFERENCE_VERSION,
            });
            setCache(file.id, updated);
            return updated;
        }

        if (cached.id !== file.id || cached.name !== file.name) {
            const refreshed = Object.assign({}, cached, { id: file.id, name: file.name || null });
            setCache(file.id, refreshed);
            return refreshed;
        }

        return cached;
    }

    if (!file.path) {
        console.error("[MediaInfo] file.path missing for id=" + file.id + " - cannot run ffprobe");
        return null;
    }

    const raw = await createMediaInfoCache(file.path);
    if (!raw) return null;

    const info = buildDetailedInfo(raw, file);
    setCache(file.id, info);
    return info;
}

module.exports = { getMediaInfo, invalidate, invalidateAll, getAll, inferMissingLanguages, getLanguageName, isRealLanguageTag };
