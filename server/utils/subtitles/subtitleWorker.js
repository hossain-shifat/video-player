"use strict";

/**
 * subtitleWorker.js — FLUX Background Subtitle Downloader (v4 — validated)
 *
 * What changed in v4
 *   A downloaded subtitle is now VALIDATED before it is stored, and only the best valid candidate is kept.
 *   The embedded subtitle track of the video file is the REFERENCE ("what a real subtitle looks like for this
 *   exact file"); with no usable embedded text track the generic checks (duration, cue density …) are used.
 *   Nothing touches the video file or its embedded tracks — the reference is read through a read-only ffmpeg
 *   pipe (stdout, never written to disk) and downloads live in data/subtitles only.
 *
 *   Candidates: up to SUBTITLE_CANDIDATES (default 5) per language are downloaded into a temp dir, scored, and
 *   the best one that passes is committed atomically (temp file → rename). If none passes, nothing is stored
 *   and the entry is marked "skipped" (no retry loop).
 *
 *   Validation (see evaluate()):
 *     with reference  – cue count ratio, start-time match both ways (after removing a constant offset), drift
 *                       between first and last third, last-cue position, word overlap (same language only)
 *     without         – cue count + density per minute vs duration, cue length, last cue vs duration, overlaps,
 *                       broken-encoding ratio
 *     A constant offset of 0.25–10 s with a tight spread is corrected on store (SRT only).
 *
 *   Idle only: nothing runs while HLS sessions exist or any /stream request happened in the last
 *   SUBTITLE_IDLE_MS (default 60 s). If the server turns busy mid-job the job aborts (ffmpeg killed) and the
 *   entry is re-queued WITHOUT burning an attempt. Everything is wrapped in try/catch, one job at a time,
 *   hard timeouts, low-priority ffmpeg — a failure here can never reach Express.
 *
 *   Audit: files stored before v4 (no validation stamp) are checked once while idle. A file that fails is MOVED
 *   (not deleted) to <langDir>/_rejected/ and the media is queued again for a validated download.
 *   Set SUBTITLE_AUDIT=0 to disable.
 *
 * Rate limit handling (SubSource: 60/min · 1800/hr · 7200/day) is unchanged: throttle in subDLService,
 * 429 → ≤65 s cooldown without burning an attempt, daily quota → pause until midnight UTC.
 */

const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { searchSubtitles, downloadSubtitle, getBudget, getUsage, SUPPORTED_LANGS, LANG_LABEL } = require("../../services/subDLService");
const store = require("./subtitleStore");

// ─── Tunables ────────────────────────────────────────────────────────────────

const INTERVAL_MS = 6000; // tick every 6s
const REQUEST_DELAY_MS = 1000; // 1s gap before each API burst
const RATE_LIMIT_RETRY_MS = 65_000; // 429 → wait for the minute window to reset

const IDLE_QUIET_MS = Number(process.env.SUBTITLE_IDLE_MS) || 60_000; // no /stream traffic for this long = idle
const COOLDOWN_MS = 4000; // breathing room after each heavy job
const CANDIDATES = Math.max(1, Math.min(8, Number(process.env.SUBTITLE_CANDIDATES) || 5));
const EXTRA_LANG_CANDIDATES = Math.min(CANDIDATES, 3); // non-English languages: fewer downloads per title, saves API budget
const AUDIT_ENABLED = process.env.SUBTITLE_AUDIT !== "0";
const EARLY_STOP_SCORE = 0.97; // near-identical to the embedded track — stop here and spare the API quota
const ACCEPT_REF = 0.72;
const ACCEPT_GENERIC = 0.6;
// Tiers: "good" = passes (score ≥ ACCEPT_*, no reasons). "fallback" = did not pass but is the NEAREST usable thing —
// score ≥ FALLBACK_MIN and none of the HARD reasons (garbage/unrelated/extreme). Stored only when no candidate is good.
const FALLBACK_MIN = 0.5;
const MAX_OFFSET_SEC = 30; // a constant offset up to this is found and corrected
const UPGRADE_RECHECK_DAYS = 14; // a fallback is re-checked for a better candidate this often
const UPGRADE_MARGIN = 0.03; // a replacement must beat the stored fallback by this much
const HARD_REASON = /^(last_cue_extreme|ends_early|no_cues|broken_encoding|avg_cue_too_long|avg_cue_too_short|too_few_cues|offset_too_large|timing_unrelated|drift_extreme|cue_density_extreme|text_unrelated)/;
const REF_TIMEOUT_MS = 6 * 60_000; // reading the embedded track = reading the whole file
const REF_MAX_BYTES = 20 * 1024 * 1024;
const MAX_SUB_BYTES = 5 * 1024 * 1024;

// ffprobe language tags → our codes (reference language must match the candidate's for the word-overlap check)
const ISO3 = { en: "en", eng: "en", english: "en", bn: "bn", ben: "bn", bangla: "bn", bengali: "bn", hi: "hi", hin: "hi", hindi: "hi", ar: "ar", ara: "ar", arabic: "ar", ur: "ur", urd: "ur", es: "es", spa: "es", fr: "fr", fre: "fr", fra: "fr", de: "de", ger: "de", deu: "de", id: "id", ind: "id", tr: "tr", tur: "tr", ta: "ta", tam: "ta", ms: "ms", may: "ms", msa: "ms", ru: "ru", rus: "ru", it: "it", ita: "it", ko: "ko", kor: "ko", ja: "ja", jpn: "ja", pt: "pt", por: "pt", fa: "fa", per: "fa", fas: "fa" };

const IMAGE_CODECS = new Set(["hdmv_pgs_subtitle", "pgssub", "dvd_subtitle", "dvdsub", "dvb_subtitle", "dvbsub", "xsub"]);

// ─── State ───────────────────────────────────────────────────────────────────

let _timer = null;
let _running = false;

// Per media+language ownership counter. An admin delete / redownload bumps it; background work that STARTED earlier
// compares it right before committing, so a slow fallback-upgrade download can never resurrect a subtitle the admin
// just deleted or replaced. (_running only serialises worker ticks — it does not guard admin mutations.)
const _subEpoch = new Map();
const _epochKey = (mediaId, lang) => `${mediaId}:${lang}`;
const subEpoch = (mediaId, lang) => _subEpoch.get(_epochKey(mediaId, lang)) || 0;
function invalidateSubtitleWork(mediaId, lang) {
    const k = _epochKey(mediaId, lang);
    _subEpoch.set(k, (_subEpoch.get(k) || 0) + 1);
}

// Per-slot mutex: the worker's "write file + publish metadata" and the admin's delete / re-download / shift run one at a
// time for the same media+language, so a stale result can neither slip in between an admin's file and metadata steps
// nor be archived in place of the file the admin meant. Always runs `fn` (a failure never poisons the queue).
const _slotLocks = new Map();
function withSlot(mediaId, lang, fn) {
    const k = _epochKey(mediaId, lang);
    const prev = _slotLocks.get(k) || Promise.resolve();
    const run = prev.catch(() => {}).then(fn);
    const tail = run.catch(() => {});
    _slotLocks.set(k, tail);
    tail.then(() => {
        if (_slotLocks.get(k) === tail) _slotLocks.delete(k);
    });
    return run;
}
let _retryAfter = 0; // short 429 cooldown / daily-quota pause
let _started = false;
let _stopped = false;
let _nextOkAt = 0; // cooldown between heavy jobs
let _lastUpgradeScan = 0;
let _lastActivityAt = Date.now(); // bumped by server.js for every /stream request
let _sessionProbe = null; // () => number of active streaming sessions
let _refChild = null; // running reference-extraction ffmpeg (killed on stop)
let _refCache = null; // { mediaId, ref } — one entry is enough, a job handles one media at a time
const _auditSkip = new Set(); // "mediaId:lang" the audit could not judge this run (never retry in a loop)
const _stats = { downloaded: 0, rejected: 0, audited: 0, auditRejected: 0, lastReason: null };

class BusyError extends Error {
    constructor() {
        super("server_busy");
        this.code = "busy";
    }
}

// ─── Idle gating ─────────────────────────────────────────────────────────────

function noteActivity() {
    _lastActivityAt = Date.now();
}

function setSessionProbe(fn) {
    _sessionProbe = typeof fn === "function" ? fn : null;
}

function activeSessions() {
    try {
        return _sessionProbe ? Number(_sessionProbe()) || 0 : 0;
    } catch {
        return 0;
    }
}

function isIdle() {
    return !_stopped && activeSessions() === 0 && Date.now() - _lastActivityAt >= IDLE_QUIET_MS;
}

function assertIdle() {
    if (!isIdle()) throw new BusyError();
}

// ─── Subtitle parsing ────────────────────────────────────────────────────────

function decodeBuffer(buf) {
    let text;
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
        text = buf.slice(2).toString("utf16le");
    } else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
        const swapped = Buffer.from(buf.slice(2));
        swapped.swap16();
        text = swapped.toString("utf16le");
    } else {
        text = buf.toString("utf-8");
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    }
    const bad = (text.match(/\uFFFD/g) || []).length;
    return { text: text.replace(/\r\n?/g, "\n"), badRatio: text.length ? bad / text.length : 0 };
}

function stripMarkup(s) {
    return s
        .replace(/<[^>]*>/g, "")
        .replace(/\{[^}]*\}/g, "")
        .replace(/\\[Nn]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

const TIME_RE = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})\s*-->\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/;
const ms = (frac) => Number(String(frac).padEnd(3, "0").slice(0, 3));

/** Returns cues [{ s, e, t }] sorted by start. Handles SRT, WebVTT and ASS/SSA. */
function parseSubtitle(text, ext = ".srt") {
    const cues = [];
    const isAss = /\.(ass|ssa)$/i.test(ext) || /^\[Script Info\]/im.test(text);

    if (isAss) {
        for (const line of text.split("\n")) {
            if (!/^Dialogue:/i.test(line)) continue;
            const parts = line.slice(line.indexOf(":") + 1).split(",");
            if (parts.length < 10) continue;
            const t1 = /^\s*(\d+):(\d{2}):(\d{2})[.](\d{1,2})/.exec(parts[1]);
            const t2 = /^\s*(\d+):(\d{2}):(\d{2})[.](\d{1,2})/.exec(parts[2]);
            if (!t1 || !t2) continue;
            const s = +t1[1] * 3600 + +t1[2] * 60 + +t1[3] + +String(t1[4]).padEnd(2, "0") / 100;
            const e = +t2[1] * 3600 + +t2[2] * 60 + +t2[3] + +String(t2[4]).padEnd(2, "0") / 100;
            cues.push({ s, e, t: stripMarkup(parts.slice(9).join(",")) });
        }
    } else {
        for (const block of text.split(/\n\s*\n/)) {
            const lines = block.split("\n");
            const ti = lines.findIndex((l) => TIME_RE.test(l));
            if (ti === -1) continue;
            const m = TIME_RE.exec(lines[ti]);
            const s = (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3] + ms(m[4]) / 1000;
            const e = (+m[5] || 0) * 3600 + +m[6] * 60 + +m[7] + ms(m[8]) / 1000;
            cues.push({ s, e, t: stripMarkup(lines.slice(ti + 1).join(" ")), _lines: lines, _ti: ti });
        }
    }
    return cues.filter((c) => Number.isFinite(c.s) && Number.isFinite(c.e) && c.e >= c.s).sort((a, b) => a.s - b.s);
}

function fmtTime(sec, sep) {
    const t = Math.max(0, Math.round(sec * 1000));
    const h = Math.floor(t / 3600000);
    const m = Math.floor((t % 3600000) / 60000);
    const s = Math.floor((t % 60000) / 1000);
    const mm = t % 1000;
    const p = (n, w = 2) => String(n).padStart(w, "0");
    return `${p(h)}:${p(m)}:${p(s)}${sep}${p(mm, 3)}`;
}

/** Shift every timestamp of an SRT/VTT text by `offset` seconds (negative = earlier). */
function shiftTimestamps(text, offset) {
    return text
        .split("\n")
        .map((line) => {
            if (!line.includes("-->")) return line;
            return line.replace(/(?:(\d{1,2}):)?(\d{1,2}):(\d{2})([,.])(\d{1,3})/g, (_m, h, mi, se, sep, fr) => {
                const sec = (+h || 0) * 3600 + +mi * 60 + +se + ms(fr) / 1000;
                return fmtTime(sec + offset, sep);
            });
        })
        .join("\n");
}

// ─── Watermark / typing-animation cleanup ────────────────────────────────────

/**
 * Some uploaders add a "typing" credit: a run of tiny cues where each cue's text is the previous text plus one more
 * letter ("I", "In", "Int" …), followed by one long cue holding the full credit — at the start and/or end of the
 * file. It is not dialogue, shows on screen for ~75 s at the start and ~5 min at the end, and would distort the
 * scoring. Detection is strict: ≥ 8 consecutive growing-prefix cues, each ≤ 1.5 s, with ≥ 5 distinct lengths.
 * Returns { cues (without them), removed }.
 */
function stripPromoCues(cues) {
    const drop = new Set();
    let i = 0;
    while (i < cues.length) {
        let j = i;
        while (j + 1 < cues.length && cues[j].t && cues[j].e - cues[j].s <= 1.5 && cues[j + 1].t.startsWith(cues[j].t) && cues[j + 1].s - cues[j].e < 0.3) j++;
        // j now ends the chain; the last element may be the long "hold" cue (it joined because the cue before it was short)
        const len = j - i + 1;
        if (len >= 8) {
            const distinct = new Set(cues.slice(i, j + 1).map((c) => c.t.length)).size;
            const shortCount = cues.slice(i, j + 1).filter((c) => c.e - c.s <= 1.5).length;
            if (distinct >= 5 && shortCount >= len - 1) for (let k = i; k <= j; k++) drop.add(k);
        }
        i = j + 1;
    }
    if (!drop.size) return { cues, removed: 0 };
    return { cues: cues.filter((_, k) => !drop.has(k)), removed: drop.size };
}

/** Rebuilds SRT text from kept cues (original text/markup untouched, numbering fixed). SRT only. */
function rebuildSrt(cues) {
    return cues.map((c, n) => `${n + 1}\n${c._lines[c._ti]}\n${c._lines.slice(c._ti + 1).join("\n")}`).join("\n\n") + "\n";
}

// ─── Scoring helpers ─────────────────────────────────────────────────────────

const median = (a) => {
    if (!a.length) return 0;
    const s = [...a].sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Nearest value in a sorted array of starts (binary search). Returns the index. */
function nearestIdx(sorted, x) {
    let lo = 0;
    let hi = sorted.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid] < x) lo = mid + 1;
        else hi = mid;
    }
    if (lo > 0 && Math.abs(sorted[lo - 1] - x) <= Math.abs(sorted[lo] - x)) return lo - 1;
    return lo;
}

// \p{M} keeps combining marks (Bangla/Hindi vowel signs, virama …). Without it "আমি" splits into 2-letter
// fragments, every word is dropped, and two IDENTICAL cues compare as "unrelated".
function words(t) {
    return new Set((t.toLowerCase().match(/[\p{L}\p{M}\p{N}']{3,}/gu) || []).map((w) => w.replace(/^'+|'+$/g, "")));
}

function jaccard(a, b) {
    if (!a.size || !b.size) return 0;
    let inter = 0;
    for (const w of a) if (b.has(w)) inter++;
    return inter / (a.size + b.size - inter);
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/**
 * Offset (seconds, candidate − reference) of ONE group of cue starts: vote in 0.1 s bins over ±MAX_OFFSET_SEC,
 * then refine with the median of nearest-cue differences. When several well-supported peaks TIE, the one nearest the
 * globally best-supported offset (`hint`) wins; if none is within 1 s of it the evidence cannot tell them apart and the
 * result is null (drift stays unmeasured) instead of an arbitrary peak. null also when too few cues support an offset.
 */
function sectionOffset(starts, rs, hint = null) {
    if (!starts.length || !rs.length) return null;
    const BIN = 0.1;
    const votes = new Map();
    for (const c of starts) {
        let j = nearestIdx(rs, c - MAX_OFFSET_SEC);
        while (j > 0 && rs[j - 1] >= c - MAX_OFFSET_SEC) j--;
        for (; j < rs.length && rs[j] <= c + MAX_OFFSET_SEC; j++) {
            const b = Math.round((c - rs[j]) / BIN);
            votes.set(b, (votes.get(b) || 0) + 1);
        }
    }
    const weight = (b) => (votes.get(b) || 0) + (votes.get(b - 1) || 0) + (votes.get(b + 1) || 0);
    let peakVotes = -1;
    for (const b of votes.keys()) peakVotes = Math.max(peakVotes, weight(b));
    if (peakVotes < 0) return null;
    // all bins within 10 % of the best, grouped into clusters (bins closer than 1 s belong together)
    const strong = [...votes.keys()].filter((b) => weight(b) >= peakVotes * 0.9).sort((a, b) => a - b);
    const clusters = [];
    for (const b of strong) {
        const last = clusters[clusters.length - 1];
        if (last && b - last.at(-1) <= 10) last.push(b);
        else clusters.push([b]);
    }
    const centres = clusters.map((c) => c.reduce((best, b) => (weight(b) > weight(best) ? b : best), c[0]));
    let peakBin = centres[0];
    if (centres.length > 1) {
        if (hint == null) return null;
        peakBin = centres.reduce((best, b) => (Math.abs(b * BIN - hint) < Math.abs(best * BIN - hint) ? b : best), centres[0]);
        if (Math.abs(peakBin * BIN - hint) > 1.0) return null; // tied peaks, none matches the global offset → cannot tell
    }
    const coarse = peakBin * BIN;
    const d = [];
    for (const c of starts) {
        const x = c - rs[nearestIdx(rs, c - coarse)];
        if (Math.abs(x - coarse) <= 0.5) d.push(x);
    }
    if (d.length < Math.max(5, starts.length * 0.3)) return null;
    return median(d);
}

/**
 * evaluate(cues, opts) → { ok, score, mode, reasons[], offset, shift, stats }
 *   opts: { ref: {cues, lang}|null, lang, durationSec, ext, badRatio }
 *   ok=false → reasons says why. shift = seconds to add to the file to line it up (0 if none).
 */
// Muxers/uploaders end some files with a track label cue ("[English - US - SDH]", "[German - SDH]") — not dialogue,
// and a clean subtitle correctly lacks it, so it must not count in the last-cue comparison.
const LABEL_CUE = /^[[(][^\])]{0,60}\b(sdh|cc|hi|forced|subtitles?)\b[^\])]{0,30}[\])]$/i;
function trimTrailingLabels(cues) {
    let n = cues.length;
    while (n > 1 && LABEL_CUE.test(cues[n - 1].t.trim())) n--;
    return n === cues.length ? cues : cues.slice(0, n);
}

/** evaluate() + quality tier: good / fallback (nearest usable) / reject. */
function evaluate(cuesIn, opts = {}) {
    const r = evaluateRaw(cuesIn, opts);
    const hard = r.reasons.some((x) => HARD_REASON.test(x));
    r.usable = r.ok || (r.score >= FALLBACK_MIN && !hard);
    r.tier = r.ok ? "good" : r.usable ? "fallback" : "reject";
    return r;
}

function evaluateRaw(cuesIn, opts = {}) {
    const { ref: refIn = null, lang = "en", durationSec = 0, ext = ".srt", badRatio = 0 } = opts;
    const cues = trimTrailingLabels(cuesIn);
    const ref = refIn ? { ...refIn, cues: trimTrailingLabels(refIn.cues) } : null;
    const reasons = [];
    const n = cues.length;
    const stats = { cues: n };
    if (!n) return { ok: false, score: 0, mode: ref ? "reference" : "generic", reasons: ["no_cues"], offset: 0, shift: 0, stats };

    const last = cues[n - 1];
    const totalLen = cues.reduce((a, c) => a + (c.e - c.s), 0);
    const avgLen = totalLen / n;
    let overlaps = 0;
    for (let i = 1; i < n; i++) if (cues[i].s < cues[i - 1].e - 0.05) overlaps++;
    stats.avgLen = +avgLen.toFixed(2);
    stats.overlapPct = +((overlaps / n) * 100).toFixed(1);

    // ── Basics that always apply ──
    if (badRatio > 0.01) reasons.push(`broken_encoding(${(badRatio * 100).toFixed(1)}%)`);
    if (avgLen > 8) reasons.push(`avg_cue_too_long(${avgLen.toFixed(1)}s)`);
    if (avgLen < 0.4) reasons.push(`avg_cue_too_short(${avgLen.toFixed(2)}s)`);
    if (overlaps / n > 0.15) reasons.push(`too_many_overlaps(${stats.overlapPct}%)`);

    // ── With reference: compare against the embedded track ──
    if (ref && ref.cues.length >= 10) {
        const R = ref.cues;
        const rs = R.map((c) => c.s);
        const ratio = n / R.length;
        const lo = lang === "en" ? 0.55 : 0.4;
        const hi = lang === "en" ? 1.8 : 2.0;
        stats.ref = R.length;
        stats.ratio = +ratio.toFixed(2);
        if (ratio < lo || ratio > hi) reasons.push(`cue_count_off(${n} vs ${R.length})`);

        // Constant offset by VOTING: every candidate start votes for (its start − each reference start within ±MAX_OFFSET_SEC)
        // in 0.1 s bins; the winning bin is the offset. (Nearest-cue matching can not see offsets bigger than half
        // the gap between cues — a +3 s file would just match the wrong neighbour.)
        const BIN = 0.1;
        const votes = new Map();
        for (let i = 0; i < n; i++) {
            const c = cues[i].s;
            let j = nearestIdx(rs, c - MAX_OFFSET_SEC);
            while (j > 0 && rs[j - 1] >= c - MAX_OFFSET_SEC) j--;
            for (; j < rs.length && rs[j] <= c + MAX_OFFSET_SEC; j++) {
                const b = Math.round((c - rs[j]) / BIN);
                votes.set(b, (votes.get(b) || 0) + 1);
            }
        }
        let peakBin = 0;
        let peakVotes = -1;
        for (const [b, v] of votes) {
            const w = v + (votes.get(b - 1) || 0) + (votes.get(b + 1) || 0); // smooth ±1 bin
            if (w > peakVotes) {
                peakVotes = w;
                peakBin = b;
            }
        }
        const coarse = peakBin * BIN;
        // Refine: median of the nearest-cue differences once the coarse offset is removed
        const diffs = [];
        const matched = []; // [candIdx, diff-to-nearest, refIdx]
        for (let i = 0; i < n; i++) {
            const j = nearestIdx(rs, cues[i].s - coarse);
            const d = cues[i].s - rs[j];
            if (Math.abs(d - coarse) <= 0.5) {
                diffs.push(d);
                matched.push([i, d, j]);
            }
        }
        const offset = diffs.length ? median(diffs) : coarse;
        const mad = diffs.length ? median(diffs.map((d) => Math.abs(d - offset))) : 99;
        stats.offset = +offset.toFixed(3);
        stats.mad = +mad.toFixed(3);

        // After removing the constant offset: precision (cand cue has a ref cue ±1s) and recall (reverse)
        const cs = cues.map((c) => c.s - offset);
        let hitC = 0;
        for (let i = 0; i < n; i++) if (Math.abs(cs[i] - rs[nearestIdx(rs, cs[i])]) <= 1.0) hitC++;
        let hitR = 0;
        for (let j = 0; j < rs.length; j++) if (Math.abs(rs[j] - cs[nearestIdx(cs, rs[j])]) <= 1.0) hitR++;
        const precision = hitC / n;
        const recall = hitR / rs.length;
        const sync = 0.65 * precision + 0.35 * recall; // merged/split cues lower recall, a wrong file lowers precision
        stats.sync = +sync.toFixed(3);
        stats.recall = +recall.toFixed(2);
        if (recall < (lang === "en" ? 0.75 : 0.5) && sync >= 0.35) reasons.push(`many_cues_missing(recall=${recall.toFixed(2)})`);
        if (sync < 0.35) reasons.push(`timing_unrelated(sync=${sync.toFixed(2)})`);
        else if (sync < 0.6) reasons.push(`timing_mismatch(sync=${sync.toFixed(2)})`);
        if (Math.abs(offset) > MAX_OFFSET_SEC) reasons.push(`offset_too_large(${offset.toFixed(1)}s)`);

        // Drift: offset of the first third vs the last third. Each section finds ITS OWN offset by voting, independent of
        // the ±0.5 s refinement window above (that window only keeps cues near the overall offset, so it can never
        // show a section that sits several seconds away from it).
        let driftScore = 1;
        if (n >= 30) {
            const third = Math.floor(n / 3);
            const a = sectionOffset(cues.slice(0, third).map((c) => c.s), rs, coarse);
            const b = sectionOffset(cues.slice(-third).map((c) => c.s), rs, coarse);
            if (a != null && b != null) {
                const drift = Math.abs(b - a);
                stats.drift = +drift.toFixed(3);
                if (drift > 3.0) reasons.push(`drift_extreme(${drift.toFixed(2)}s)`);
                else if (drift > 1.0) reasons.push(`drift(${drift.toFixed(2)}s)`);
                driftScore = clamp01(1 - drift / 1.0);
            }
        }

        // Last cue position
        const lastRef = R[R.length - 1].s;
        const tailGap = Math.abs(last.s - offset - lastRef);
        stats.tailGap = +tailGap.toFixed(1);
        const tailScore = clamp01(1 - tailGap / 300);
        if (tailGap > 1500) reasons.push(`last_cue_extreme(${Math.round(tailGap)}s)`);
        else if (tailGap > 600) reasons.push(`last_cue_far(${Math.round(tailGap)}s)`);

        // Words — only comparable when both are the same language
        let textScore = null;
        if (ref.lang === lang) {
            const sims = [];
            for (const [i, , j] of matched) {
                if (Math.abs(cues[i].s - offset - rs[j]) <= 1.0) {
                    const wa = words(cues[i].t);
                    const wb = words(R[j].t);
                    if (!wa.size || !wb.size) continue; // nothing comparable (music cue, "…", too-short words) → not evidence either way
                    sims.push(jaccard(wa, wb));
                }
            }
            if (sims.length >= 20) {
                const med = median(sims);
                stats.words = +med.toFixed(2);
                textScore = clamp01(med / 0.6);
                if (med < 0.08) reasons.push(`text_unrelated(${med.toFixed(2)})`);
                else if (med < 0.2) reasons.push(`text_unlike_reference(${med.toFixed(2)})`);
            }
        }

        const countScore = clamp01(1 - Math.abs(1 - ratio) / 0.5);
        let score;
        if (textScore == null) score = 0.45 * sync + 0.25 * countScore + 0.15 * tailScore + 0.15 * driftScore;
        else score = 0.35 * sync + 0.2 * countScore + 0.15 * tailScore + 0.1 * driftScore + 0.2 * textScore;

        // Constant offset worth correcting? SRT/VTT only, tight spread, sane size
        let shift = 0;
        if (Math.abs(offset) >= 0.25 && Math.abs(offset) <= MAX_OFFSET_SEC && mad <= 0.6 && /\.(srt|vtt)$/i.test(ext)) shift = -offset;
        else if (Math.abs(offset) > 1.5 && Math.abs(offset) <= MAX_OFFSET_SEC) reasons.push(`offset_not_correctable(${offset.toFixed(2)}s, ${ext})`);

        stats.score = +score.toFixed(3);
        return { ok: reasons.length === 0 && score >= ACCEPT_REF, score, mode: "reference", reasons: score < ACCEPT_REF && !reasons.length ? [`low_score(${score.toFixed(2)})`] : reasons, offset, shift, stats };
    }

    // ── Generic: duration only ──
    let densScore = 0.7;
    let tailScore = 0.7;
    if (durationSec > 600) {
        const perMin = n / (durationSec / 60);
        stats.perMin = +perMin.toFixed(1);
        if (perMin < 1.5 || perMin > 40) reasons.push(`cue_density_extreme(${perMin.toFixed(1)}/min)`);
        else if (perMin < 2.5 || perMin > 30) reasons.push(`cue_density_off(${perMin.toFixed(1)}/min)`);
        densScore = clamp01(1 - Math.abs(Math.log(perMin / 12)) / Math.log(3));
        if (last.e > durationSec + 120) reasons.push(`runs_past_video_end(${Math.round(last.e)}s > ${Math.round(durationSec)}s)`);
        if (durationSec > 1200 && last.s < durationSec * 0.55) reasons.push(`ends_early(${Math.round(last.s)}s of ${Math.round(durationSec)}s)`);
        tailScore = clamp01(1 - Math.max(0, durationSec - last.e) / (durationSec * 0.3));
    } else if (n < 5) {
        reasons.push(`too_few_cues(${n})`);
    }
    const lenScore = clamp01(1 - Math.abs(Math.log(avgLen / 2.4)) / Math.log(3.5));
    const score = 0.4 * densScore + 0.3 * tailScore + 0.3 * lenScore;
    stats.score = +score.toFixed(3);
    return { ok: reasons.length === 0 && score >= ACCEPT_GENERIC, score, mode: "generic", reasons: score < ACCEPT_GENERIC && !reasons.length ? [`low_score(${score.toFixed(2)})`] : reasons, offset: 0, shift: 0, stats };
}

// ─── Reference: the embedded text track (read-only) ─────────────────────────

function ffmpegBin() {
    let bin = process.env.FFMPEG_PATH || "ffmpeg";
    if (process.platform === "win32" && !bin.toLowerCase().endsWith(".exe")) bin += ".exe";
    return bin;
}

function lazyProbe() {
    return require("../media/ffprobe").probe;
}

function mediaPathOf(mediaId) {
    return require("../media/fileHelpers").decodeFileId(mediaId);
}

/**
 * Pipes ONE subtitle stream out of the video as SRT (stdout only — nothing is written anywhere).
 * Aborts (kills ffmpeg) on timeout, on stop(), or the moment the server stops being idle.
 */
function extractTrack(filePath, streamIndex) {
    return new Promise((resolve, reject) => {
        const args = ["-v", "error", "-nostdin", "-threads", "1", "-i", filePath, "-map", `0:${streamIndex}`, "-c:s", "srt", "-f", "srt", "pipe:1"];
        let child;
        try {
            child = spawn(ffmpegBin(), args, { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
        } catch (err) {
            return reject(err);
        }
        _refChild = child;
        try {
            if (child.pid) os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
        } catch {
            /* priority is best-effort */
        }

        const chunks = [];
        let size = 0;
        let done = false;
        const finish = (fn, val) => {
            if (done) return;
            done = true;
            clearTimeout(timeout);
            clearInterval(watch);
            if (_refChild === child) _refChild = null;
            fn(val);
        };
        const kill = () => {
            try {
                child.kill("SIGKILL");
            } catch {
                /* already gone */
            }
        };
        const timeout = setTimeout(() => {
            kill();
            finish(reject, new Error("reference_timeout"));
        }, REF_TIMEOUT_MS);
        const watch = setInterval(() => {
            if (!isIdle()) {
                kill();
                finish(reject, new BusyError());
            }
        }, 2000);

        child.stdout.on("data", (c) => {
            size += c.length;
            if (size > REF_MAX_BYTES) {
                kill();
                return finish(reject, new Error("reference_too_large"));
            }
            chunks.push(c);
        });
        child.on("error", (err) => finish(reject, err));
        child.on("close", (code) => {
            if (done) return;
            const out = Buffer.concat(chunks).toString("utf-8");
            if (!out.trim()) return finish(reject, new Error(`reference_empty(exit ${code})`));
            finish(resolve, out);
        });
    });
}

/** Picks the embedded text tracks worth trying, best first: English → undefined → anything, never forced / image. */
function rankTracks(tracks) {
    const text = (tracks || []).filter((t) => t && !t.forced && !IMAGE_CODECS.has(String(t.codec || "").toLowerCase()));
    const isEn = (t) => /^(en|eng|english)$/i.test(t.language || "");
    const isUnd = (t) => !t.language || /^(und|unk)$/i.test(t.language);
    return [...text.filter(isEn), ...text.filter(isUnd), ...text.filter((t) => !isEn(t) && !isUnd(t))].slice(0, 2);
}

/** → { cues, lang, durationSec } | null. `ref` null means no usable embedded text track (generic mode). */
async function getReference(mediaId) {
    if (_refCache && _refCache.mediaId === mediaId) return _refCache.ref;
    const filePath = mediaPathOf(mediaId);
    await fsp.access(filePath);
    const info = await lazyProbe()(filePath);
    const durationSec = Number(info?.duration) || 0;
    let ref = { cues: [], lang: null, durationSec, usable: false };
    for (const track of rankTracks(info?.subtitles)) {
        assertIdle();
        try {
            const srt = await extractTrack(filePath, track.index);
            const cues = parseSubtitle(decodeBuffer(Buffer.from(srt, "utf-8")).text, ".srt");
            const need = durationSec > 1800 ? 30 : 8;
            if (cues.length >= need) {
                const l = String(track.language || "").toLowerCase();
                ref = { cues, lang: ISO3[l] || l || "und", durationSec, usable: true };
                console.log(`[SubtitleWorker] reference: embedded track #${track.index} (${track.codec}, ${track.language || "und"}) — ${cues.length} cues`);
                break;
            }
        } catch (err) {
            if (err instanceof BusyError) throw err;
            console.warn(`[SubtitleWorker] reference track #${track.index} unusable: ${err.message}`);
        }
    }
    if (!ref.usable) console.log("[SubtitleWorker] no usable embedded text track — generic validation");
    _refCache = { mediaId, ref };
    return ref;
}

function evalWith(refInfo, cues, lang, ext, badRatio) {
    return evaluate(cues, { ref: refInfo?.usable ? refInfo : null, lang, durationSec: refInfo?.durationSec || 0, ext, badRatio });
}

// ─── Candidate download → validate → commit ─────────────────────────────────

async function readCandidate(filePath, ext) {
    const st = await fsp.stat(filePath);
    if (st.size > MAX_SUB_BYTES) throw new Error("file_too_large");
    const { text, badRatio } = decodeBuffer(await fsp.readFile(filePath));
    let cues = parseSubtitle(text, ext);
    let cleanText = null;
    let removed = 0;
    if (/\.srt$/i.test(ext) && cues.length && cues[0]._lines) {
        const r = stripPromoCues(cues);
        if (r.removed) {
            cues = r.cues;
            removed = r.removed;
            cleanText = rebuildSrt(cues);
        }
    }
    // `text` = what to store (watermark cues dropped); judged on the cleaned cues
    return { text: cleanText ?? text, badRatio, cues, removedPromo: removed };
}

/** Atomic commit: write temp next to the target, rename over it, drop stale subtitle.* of other extensions. */
async function commitText(langDir, ext, text) {
    await fsp.mkdir(langDir, { recursive: true });
    const filename = `subtitle${ext}`;
    const dest = path.join(langDir, filename);
    const tmp = `${dest}.tmp.${process.pid}.${Date.now()}`;
    await fsp.writeFile(tmp, text, "utf-8");
    await fsp.rename(tmp, dest);
    try {
        for (const f of await fsp.readdir(langDir)) {
            if (/^subtitle\.(srt|vtt|ass|ssa)$/i.test(f) && f !== filename) await fsp.rm(path.join(langDir, f), { force: true });
        }
    } catch {
        /* stale-file cleanup is best-effort */
    }
    return { filename, destPath: dest };
}

/**
 * Downloads up to `candidates.length` candidates, validates each, commits the best valid one.
 * → { stored: {filename,destPath,score,shift,mode}|null, hadError, rateLimited, reasons[] }
 */
async function pickAndStore({ mediaId, lang, candidates, langDir, getRef, minScore = 0, epoch, onStored }) {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "flux-sub-"));
    // Ownership token. The caller captures it when it SELECTED the language (before the search / any await) and passes it in;
    // it is never re-captured after a wait. See invalidateSubtitleWork().
    const epoch0 = Number.isInteger(epoch) ? epoch : subEpoch(mediaId, lang);
    let best = null; // best GOOD candidate
    let nearest = null; // best FALLBACK candidate — nearest usable thing when nothing is good
    let hadError = false;
    const reasons = [];
    try {
        for (let i = 0; i < candidates.length; i++) {
            assertIdle();
            const c = candidates[i];
            const dl = await downloadSubtitle(c, tmpDir, `cand${i}`, lang);
            if (!dl.ok) {
                if (dl.error === "hourly_limit") return { stored: null, hadError: false, rateLimited: true, retryMs: dl.retryAfterMs || RATE_LIMIT_RETRY_MS, reasons };
                if (/HTTP 429/.test(dl.error || "")) return { stored: null, hadError: false, rateLimited: true, retryMs: RATE_LIMIT_RETRY_MS, reasons };
                hadError = true;
                reasons.push(`#${i + 1} download: ${dl.error}`);
                continue;
            }
            let parsed;
            try {
                parsed = await readCandidate(dl.destPath, dl.ext);
            } catch (err) {
                hadError = true;
                reasons.push(`#${i + 1} read: ${err.message}`);
                continue;
            }
            const refInfo = await getRef(); // extracted once, only when there is a candidate worth judging
            const ev = evalWith(refInfo, parsed.cues, lang, dl.ext, parsed.badRatio);
            console.log(`[SubtitleWorker]   candidate ${i + 1}/${candidates.length} (${lang}) ${ev.mode}: cues=${parsed.cues.length}${parsed.removedPromo ? ` (-${parsed.removedPromo} watermark cues)` : ""} score=${ev.score.toFixed(2)} ${ev.tier === "good" ? "GOOD" : ev.tier === "fallback" ? "FALLBACK " + ev.reasons.join(",") : "REJECT " + ev.reasons.join(",")}`);
            if (ev.tier === "reject") {
                reasons.push(`#${i + 1} ${ev.reasons.join(",")}`);
                continue;
            }
            const cand = { ev, parsed, ext: dl.ext, cand: c };
            if (ev.tier === "good") {
                if (!best || ev.score > best.ev.score) best = cand;
                if (ev.score >= EARLY_STOP_SCORE) break;
            } else if (!nearest || ev.score > nearest.ev.score) {
                nearest = cand;
                reasons.push(`#${i + 1} fallback ${ev.reasons.join(",")}`);
            }
        }

        // Nothing good → store the NEAREST usable candidate (flagged "fallback", re-checked later for a better one).
        let tier = "good";
        if (!best && nearest) {
            best = nearest;
            tier = "fallback";
            console.log(`[SubtitleWorker]   no high-quality ${lang} subtitle — keeping the nearest usable one (score ${nearest.ev.score.toFixed(2)})`);
        }
        if (!best) return { stored: null, hadError, rateLimited: false, reasons };
        if (minScore && best.ev.score < minScore + UPGRADE_MARGIN && !(tier === "good" && best.ev.score >= ACCEPT_REF)) return { stored: null, hadError, rateLimited: false, reasons, notBetter: true };

        let text = best.parsed.text;
        if (best.ev.shift) {
            text = shiftTimestamps(text, best.ev.shift);
            console.log(`[SubtitleWorker]   timing corrected by ${best.ev.shift > 0 ? "+" : ""}${best.ev.shift.toFixed(2)}s`);
        }
        // Commit = replace the file AND publish its metadata, as ONE step under the slot lock (the admin's delete /
        // re-download takes the same lock). Ownership is re-checked AFTER the lock is held; a stale result commits nothing.
        const stored = await withSlot(mediaId, lang, async () => {
            if (subEpoch(mediaId, lang) !== epoch0) return null;
            const out = await commitText(langDir, best.ext, text);
            const st = {
                ...out,
                score: best.ev.score,
                shift: best.ev.shift,
                mode: best.ev.mode,
                quality: tier,
                reasons: best.ev.reasons.slice(0, 4),
                stats: best.ev.stats,
                removedPromo: best.parsed.removedPromo || 0,
                releaseName: best.cand?.releaseName || "",
                subtitleId: best.cand?.subtitleId || null,
            };
            try {
                if (onStored) await onStored(st);
            } catch (err) {
                await fsp.rm(out.destPath, { force: true }).catch(() => {}); // no metadata → no orphan file (still under the lock)
                throw err;
            }
            return st;
        });
        if (!stored) return { stored: null, hadError, rateLimited: false, reasons, superseded: true };
        return { stored, hadError, rateLimited: false, reasons, recorded: true };
    } finally {
        await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
}

// ─── Queue processor ─────────────────────────────────────────────────────────

async function processEntry(entry) {
    store.markDownloading(entry);
    _refCache = null;

    try {
        console.log(`[SubtitleWorker] → "${entry.title || entry.mediaId.slice(0, 12)}" (${entry.type})`);

        // Every enabled language (SUBTITLE_LANGUAGES, default en,bn,hi,ar) that is not on disk yet and was not already
        // looked up for this title. "Only if available": a language SubSource has nothing for is simply recorded as checked.
        store.reconcileLangs(entry); // files deleted since the last run → those languages are looked up again
        const checked = new Set(Array.isArray(entry.langsChecked) ? entry.langsChecked : []);
        const upgrades = new Set(store.upgradeDueLangs(entry.mediaId)); // fallbacks due for another look at better candidates
        const langsNeeded = SUPPORTED_LANGS.filter((l) => upgrades.has(l) || (!checked.has(l) && !store.hasDownloadedSubtitle(entry.mediaId, l)));
        if (!langsNeeded.length) {
            entry.langsChecked = [...new Set([...checked, ...SUPPORTED_LANGS])];
            return void store.markDone(entry);
        }

        // Ownership tokens, captured NOW (when each language is selected) — before the search or any download can yield.
        const epochs = new Map(langsNeeded.map((l) => [l, subEpoch(entry.mediaId, l)]));

        await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
        assertIdle();

        const search = await searchSubtitles({
            title: entry.title,
            year: entry.year,
            imdbId: entry.imdbId,
            tmdbId: entry.tmdbId,
            season: entry.season,
            episode: entry.episode,
            type: entry.type === "movie" ? "movie" : "tv",
            languages: langsNeeded,
            spokenLanguage: entry.spokenLanguage || null,
            candidates: CANDIDATES,
        });

        if (!search.ok) {
            if (search.error === "hourly_limit") {
                _retryAfter = Date.now() + (search.retryAfterMs || RATE_LIMIT_RETRY_MS);
                store.requeueEntry(entry);
                console.warn(`[SubtitleWorker] SubSource hourly budget used — pausing until ${new Date(_retryAfter).toISOString()}, entry re-queued`);
                return;
            }
            if (search.error === "rate_limit") {
                _retryAfter = Date.now() + RATE_LIMIT_RETRY_MS;
                store.requeueEntry(entry);
                console.warn(`[SubtitleWorker] 429 received — cooling down ${Math.round(RATE_LIMIT_RETRY_MS / 1000)}s, entry re-queued`);
                return;
            }
            if (search.error === "quota_exceeded") {
                const now = new Date();
                const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
                _retryAfter = midnight.getTime();
                store.requeueEntry(entry);
                console.warn(`[SubtitleWorker] Daily quota exceeded — resuming at midnight UTC (${midnight.toISOString()})`);
                return;
            }
            console.warn(`[SubtitleWorker] Search failed "${entry.title}": ${search.error}`);
            store.markFailed(entry, search.error);
            return;
        }

        if (!search.results?.length) {
            console.log(`[SubtitleWorker] No results for "${entry.title}"`);
            entry.langsChecked = [...new Set([...checked, ...langsNeeded])];
            // Nothing found for an overdue fallback upgrade: push its re-check out (keep the stored file), otherwise
            // the hourly upgrade scan would queue the very same empty lookup again and again.
            for (const l of upgrades) store.deferUpgrade(entry.mediaId, l, UPGRADE_RECHECK_DAYS);
            store.markSkipped(entry, "no_results");
            return;
        }

        let refPromise = null;
        const getRef = () => (refPromise ||= getReference(entry.mediaId).catch((err) => {
            if (err instanceof BusyError) throw err;
            console.warn(`[SubtitleWorker] reference unavailable (${err.message}) — generic validation`);
            return { cues: [], lang: null, durationSec: 0, usable: false };
        }));

        let stored = 0;
        let hadError = false;
        let superseded = false; // an admin delete/redownload overtook our work for some language
        const rejectedReasons = [];

        for (const lang of langsNeeded) {
            const candidates = search.results.filter((r) => r.lang === lang).slice(0, lang === "en" ? CANDIDATES : EXTRA_LANG_CANDIDATES);
            if (!candidates.length) {
                if (!search.failedLangs?.includes(lang)) checked.add(lang); // nothing on SubSource for this language — fine, not an error
                continue;
            }
            const existing = upgrades.has(lang) ? store.getDownloadedInfo(entry.mediaId, lang) : null;
            if (!existing && store.hasDownloadedSubtitle(entry.mediaId, lang)) {
                checked.add(lang);
                stored++;
                continue;
            }

            const langDir = store.getSubtitleLangDir(entry.mediaId, lang, entry);
            const r = await pickAndStore({
                mediaId: entry.mediaId,
                lang,
                candidates,
                langDir,
                getRef,
                minScore: existing ? existing.score || 0 : 0,
                epoch: epochs.get(lang),
                // runs INSIDE pickAndStore's slot lock, right after the file is written
                onStored: (st) =>
                    store.recordDownloaded(entry.mediaId, {
                        lang,
                        filename: st.filename,
                        destPath: st.destPath,
                        source: "subsource",
                        score: +st.score.toFixed(3),
                        quality: st.quality,
                        reasons: st.reasons,
                        stats: st.stats,
                        validation: st.mode,
                        validatedAt: new Date().toISOString(),
                        shiftApplied: st.shift ? +st.shift.toFixed(3) : 0,
                        removedPromo: st.removedPromo || 0,
                        releaseName: st.releaseName || "",
                        subtitleId: st.subtitleId || null,
                        ...(st.quality === "fallback" ? { nextUpgradeAt: new Date(Date.now() + UPGRADE_RECHECK_DAYS * 86_400_000).toISOString() } : {}),
                    }),
            });

            if (r.rateLimited) {
                _retryAfter = Date.now() + (r.retryMs || RATE_LIMIT_RETRY_MS);
                entry.langsChecked = [...new Set([...checked])]; // languages already settled stay settled
                store.requeueEntry(entry);
                console.warn(`[SubtitleWorker] rate limit during download — pausing ${Math.round((r.retryMs || RATE_LIMIT_RETRY_MS) / 1000)}s, entry re-queued`);
                return;
            }
            if (r.superseded) {
                // Take the admin's decision as it now stands (deleted on purpose → checked; redownload → look again).
                superseded = true;
                const live = store.getEntry(entry.mediaId) || entry;
                if ((live.langsChecked || []).includes(lang)) checked.add(lang);
                else checked.delete(lang);
                console.log(`[SubtitleWorker] ${lang.toUpperCase()} "${entry.title}" — an admin delete/replace happened meanwhile; discarding this download`);
                continue;
            }
            // Settled = a usable subtitle was stored, OR every candidate was judged without a download failure.
            // Only a language that failed transiently AND has nothing stored stays unresolved (→ retry/backoff).
            if (r.hadError && !r.stored) hadError = true;
            else checked.add(lang);
            if (existing && !r.stored) {
                if (!r.hadError) {
                    store.deferUpgrade(entry.mediaId, lang, UPGRADE_RECHECK_DAYS); // search completed, nothing better — look again later
                    console.log(`[SubtitleWorker] upgrade ${lang.toUpperCase()} "${entry.title}": nothing better than the stored fallback — re-check in ${UPGRADE_RECHECK_DAYS}d`);
                } else {
                    console.log(`[SubtitleWorker] upgrade ${lang.toUpperCase()} "${entry.title}": a download failed mid-search — fallback stays due, retry with backoff`);
                }
                continue;
            }
            if (!r.stored) {
                _stats.rejected++;
                rejectedReasons.push(`${lang}: ${r.reasons.join(" | ") || "no candidates"}`);
                console.log(`[SubtitleWorker] ✗ ${lang.toUpperCase()} "${entry.title}" — nothing valid, nothing stored`);
                continue;
            }

            entry.langsStored = [...new Set([...(entry.langsStored || []), lang])];
            _stats.downloaded++;
            stored++;
            console.log(`[SubtitleWorker] ${r.stored.quality === "fallback" ? "≈" : "✓"} ${lang.toUpperCase()} "${entry.title}" → ${r.stored.filename} (score ${r.stored.score.toFixed(2)}, ${r.stored.mode}${r.stored.quality === "fallback" ? ", NEAREST-USABLE fallback" : ""})`);
        }

        // Did an admin delete / re-download touch any slot we worked on (even AFTER we finished it)? Then their state wins:
        // take langsChecked for those languages from the live queue entry, keep every valid file we stored, don't mark done.
        const live = store.getEntry(entry.mediaId) || entry;
        for (const l of langsNeeded) {
            if (subEpoch(entry.mediaId, l) !== epochs.get(l)) {
                superseded = true;
                if ((live.langsChecked || []).includes(l)) checked.add(l);
                else checked.delete(l);
            }
        }
        entry.langsChecked = [...new Set([...checked])];
        if (superseded) {
            store.requeueEntry(entry); // let the queue re-evaluate with the admin's decision (no markDone over a requeue)
            return;
        }
        if (search.failedLangs?.length) {
            // Some language lookups were cut off by the SubSource limit — they are NOT "unavailable". Pause, then finish them.
            _retryAfter = Date.now() + (search.pauseMs || RATE_LIMIT_RETRY_MS);
            store.requeueEntry(entry);
            console.warn(`[SubtitleWorker] limit hit while looking up ${search.failedLangs.join(",")} — pausing ${Math.round((search.pauseMs || RATE_LIMIT_RETRY_MS) / 60000)}min, "${entry.title}" re-queued`);
            return;
        }
        // A transient failure in ANY language keeps the entry on the retry/backoff path — even when another language
        // was stored. Stored files stay; only the unchecked language is looked up again (it is not in langsChecked).
        if (hadError) store.markFailed(entry, stored ? "partial_downloads_failed" : "all_downloads_failed");
        else if (stored) store.markDone(entry);
        else {
            _stats.lastReason = rejectedReasons.join(" ; ").slice(0, 400);
            store.markSkipped(entry, rejectedReasons.length ? "no_valid_candidate" : "no_language_available");
        }
    } catch (err) {
        if (err instanceof BusyError) {
            store.requeueEntry(entry); // not a failure — just not the right time
            console.log(`[SubtitleWorker] server busy — "${entry.title}" paused, will resume when idle`);
            return;
        }
        console.error(`[SubtitleWorker] Error "${entry.title}":`, err.message);
        store.markFailed(entry, err.message);
    } finally {
        _refCache = null;
    }
}

// ─── Audit of files stored before validation existed ────────────────────────

async function auditOne() {
    const item = store.nextUnvalidated(_auditSkip);
    if (!item) return false;
    const key = `${item.mediaId}:${item.lang}`;
    const epoch0 = subEpoch(item.mediaId, item.lang); // an admin delete / re-download during the audit makes this result stale
    _refCache = null;
    try {
        assertIdle();
        let refInfo;
        try {
            refInfo = await getReference(item.mediaId);
        } catch (err) {
            if (err instanceof BusyError) throw err;
            _auditSkip.add(key); // media file gone / unreadable — leave the subtitle alone
            console.warn(`[SubtitleWorker] audit skipped ${key.slice(0, 16)}…: ${err.message}`);
            return true;
        }
        const ext = path.extname(item.path).toLowerCase();
        const parsed = await readCandidate(item.path, ext);
        const ev = evalWith(refInfo, parsed.cues, item.lang, ext, parsed.badRatio);
        _stats.audited++;

        if (ev.tier !== "reject") {
            // good — or the nearest usable thing (kept as "fallback" and re-checked later for a better one)
            const applied = await withSlot(item.mediaId, item.lang, async () => {
                if (subEpoch(item.mediaId, item.lang) !== epoch0) return false; // admin changed this slot meanwhile
                if (ev.shift || parsed.removedPromo) await commitText(path.dirname(item.path), ext, ev.shift ? shiftTimestamps(parsed.text, ev.shift) : parsed.text);
                await store.markValidated(item.mediaId, item.lang, {
                score: +ev.score.toFixed(3),
                validation: ev.mode,
                quality: ev.tier,
                reasons: ev.reasons.slice(0, 4),
                stats: ev.stats,
                shiftApplied: ev.shift ? +ev.shift.toFixed(3) : 0,
                removedPromo: parsed.removedPromo || 0,
                ...(ev.tier === "fallback" ? { nextUpgradeAt: new Date(Date.now() + UPGRADE_RECHECK_DAYS * 86_400_000).toISOString() } : {}),
                });
                return true;
            });
            if (!applied) return true; // stale result — nothing written
            _analysisCache.delete(item.path);
            console.log(`[SubtitleWorker] audit ${ev.tier === "good" ? "✓" : "≈ fallback"} ${item.lang.toUpperCase()} ${path.basename(path.dirname(path.dirname(item.path)))} score=${ev.score.toFixed(2)}`);
            return true;
        }

        // Fails → move aside (never delete), forget it, and queue a validated re-download
        const moved = await withSlot(item.mediaId, item.lang, async () => {
            if (subEpoch(item.mediaId, item.lang) !== epoch0) return false;
            const rejDir = path.join(path.dirname(item.path), "_rejected");
            await fsp.mkdir(rejDir, { recursive: true });
            await fsp.rename(item.path, path.join(rejDir, `${Date.now()}-${path.basename(item.path)}`));
            await store.removeDownloaded(item.mediaId, item.lang);
            store.requeueForRedownload(item.mediaId);
            return true;
        });
        if (!moved) return true;
        _stats.auditRejected++;
        console.log(`[SubtitleWorker] audit ✗ ${item.lang.toUpperCase()} ${path.basename(path.dirname(path.dirname(item.path)))} → moved to _rejected (${ev.reasons.join(",")}), re-queued`);
        return true;
    } catch (err) {
        if (err instanceof BusyError) return false;
        _auditSkip.add(key);
        console.warn(`[SubtitleWorker] audit error ${key.slice(0, 16)}…: ${err.message}`);
        return true;
    }
}

// ─── Manual download (API) — same validation, generic mode only (fast, no ffmpeg) ───

/**
 * Used by POST /api/media/:id/subtitle/download. Downloads, validates against the video DURATION (cached ffprobe,
 * cheap — no embedded extraction on the request path), stores only if valid unless force=true.
 * → { ok, status, error?, reasons?, filename?, destPath?, score?, forced? }
 */
async function downloadValidated({ mediaId, subtitleRef, lang = "en", langDir, force = false }) {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "flux-sub-"));
    try {
        const dl = await downloadSubtitle(subtitleRef, tmpDir, "manual", lang);
        if (!dl.ok) {
            if (dl.error === "hourly_limit") return { ok: false, status: 429, error: "SubSource hourly limit reached — try again later" };
            return { ok: false, status: 502, error: dl.error || "Download failed" };
        }

        const parsed = await readCandidate(dl.destPath, dl.ext);
        let durationSec = 0;
        try {
            const info = await lazyProbe()(mediaPathOf(mediaId));
            durationSec = Number(info?.duration) || 0;
        } catch {
            /* no duration → only the basic checks run */
        }
        const ev = evaluate(parsed.cues, { ref: null, lang, durationSec, ext: dl.ext, badRatio: parsed.badRatio });
        if (!ev.ok && !force) {
            return { ok: false, status: 422, error: "Subtitle failed validation — it does not look like a real subtitle for this video", reasons: ev.reasons, score: +ev.score.toFixed(2) };
        }
        const out = await commitText(langDir, dl.ext, parsed.text);
        return { ok: true, status: 201, ...out, score: +ev.score.toFixed(2), forced: !ev.ok, reasons: ev.reasons };
    } catch (err) {
        return { ok: false, status: 500, error: err.message };
    } finally {
        await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
}


// ─── Dashboard (admin) ───────────────────────────────────────────────────────
// Read-mostly helpers behind /api/subtitle/admin/*. Every file path comes from the store's own metadata and is
// re-checked to live under data/subtitles — a request can never name a path.

const _analysisCache = new Map(); // path → { size, mtimeMs, a }

function insideRoot(p) {
    const root = path.resolve(store.getSubtitleRoot()) + path.sep;
    return typeof p === "string" && path.resolve(p).startsWith(root);
}

/** Size + cue statistics of one stored subtitle file (cached by size+mtime). */
async function analyzeFile(p) {
    if (!insideRoot(p)) return { missing: true, bytes: 0 };
    let st;
    try {
        st = await fsp.stat(p);
    } catch {
        return { missing: true, bytes: 0 };
    }
    const hit = _analysisCache.get(p);
    if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.a;
    if (st.size > MAX_SUB_BYTES) return { bytes: st.size, cues: 0, tooLarge: true };

    const { text, badRatio } = decodeBuffer(await fsp.readFile(p));
    const cues = parseSubtitle(text, path.extname(p));
    const n = cues.length;
    const first = n ? cues[0].s : 0;
    const last = n ? Math.max(...cues.slice(-5).map((c) => c.e)) : 0;
    const span = Math.max(0, last - first);
    const total = cues.reduce((a, c) => a + (c.e - c.s), 0);
    const wordCount = cues.reduce((a, c) => a + (c.t ? c.t.split(/\s+/).length : 0), 0);
    const a = {
        bytes: st.size,
        mtime: new Date(st.mtimeMs).toISOString(),
        cues: n,
        words: wordCount,
        firstAt: +first.toFixed(1),
        lastAt: +last.toFixed(1),
        spanSec: +span.toFixed(1),
        avgCueSec: n ? +(total / n).toFixed(2) : 0,
        cuePerSec: span ? +(n / span).toFixed(3) : 0,
        cuePerMin: span ? +((n / span) * 60).toFixed(1) : 0,
        badRatio: +badRatio.toFixed(4),
    };
    _analysisCache.set(p, { size: st.size, mtimeMs: st.mtimeMs, a });
    if (_analysisCache.size > 6000) _analysisCache.delete(_analysisCache.keys().next().value);
    return a;
}

/** Analyses as many files as fit in `budgetMs` (cached ones are free). Returns how many are done. */
async function analyzeMany(paths, budgetMs = 2500) {
    const t0 = Date.now();
    let done = 0;
    for (let i = 0; i < paths.length; i += 6) {
        if (Date.now() - t0 > budgetMs) break;
        await Promise.all(paths.slice(i, i + 6).map((p) => analyzeFile(p).catch(() => null)));
        done = Math.min(paths.length, i + 6);
    }
    return done;
}

function cachedAnalysis(p) {
    return _analysisCache.get(p)?.a || null;
}

let _dirCache = { at: 0, v: null };
async function dirStats(root) {
    if (_dirCache.v && Date.now() - _dirCache.at < 20_000) return _dirCache.v;
    const v = { bytes: 0, files: 0, rejectedBytes: 0, rejectedFiles: 0 };
    async function walk(dir, inRejected) {
        let ents;
        try {
            ents = await fsp.readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of ents) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) await walk(full, inRejected || e.name === "_rejected");
            else if (e.isFile()) {
                try {
                    const sz = (await fsp.stat(full)).size;
                    v.bytes += sz;
                    v.files++;
                    if (inRejected) {
                        v.rejectedBytes += sz;
                        v.rejectedFiles++;
                    }
                } catch {
                    /* vanished while walking */
                }
            }
        }
    }
    await walk(root, false);
    _dirCache = { at: Date.now(), v };
    return v;
}

function qualityOf(dl) {
    if (dl.source === "upload") return "upload";
    if (dl.quality) return dl.quality;
    return dl.validatedAt ? "good" : "unvalidated";
}

function titleOf(dl, entry) {
    if (entry?.title) {
        const ep = entry.season != null && entry.episode != null ? ` S${String(entry.season).padStart(2, "0")}E${String(entry.episode).padStart(2, "0")}` : "";
        return `${entry.title}${entry.year && !ep ? ` (${entry.year})` : ""}${ep}`;
    }
    return path.basename(path.dirname(path.dirname(dl?.path || ""))).replace(/_[0-9a-f]{6,16}$/i, "").replace(/_/g, " ") || "Unknown";
}

function rowOf(dl, entry, a) {
    const q = qualityOf(dl);
    return {
        key: `${dl.mediaId}:${dl.lang}`,
        mediaId: dl.mediaId,
        title: titleOf(dl, entry),
        type: entry?.type || null,
        lang: dl.lang,
        label: LANG_LABEL[dl.lang] || String(dl.lang).toUpperCase(),
        filename: dl.filename,
        ext: path.extname(dl.filename || "").toLowerCase(),
        source: dl.source || "legacy",
        quality: q,
        score: typeof dl.score === "number" ? dl.score : null,
        validation: dl.validation || null,
        reasons: dl.reasons || [],
        releaseName: dl.releaseName || "",
        shiftApplied: dl.shiftApplied || 0,
        removedPromo: dl.removedPromo || 0,
        addedAt: dl.addedAt || null,
        validatedAt: dl.validatedAt || null,
        nextUpgradeAt: dl.quality === "fallback" ? dl.nextUpgradeAt || null : null,
        missing: a ? !!a.missing : null,
        sizeBytes: a ? a.bytes || 0 : null,
        cues: a && !a.missing ? a.cues : null,
        words: a && !a.missing ? a.words : null,
        cuePerSec: a && !a.missing ? a.cuePerSec : null,
        cuePerMin: a && !a.missing ? a.cuePerMin : null,
        avgCueSec: a && !a.missing ? a.avgCueSec : null,
        spanSec: a && !a.missing ? a.spanSec : null,
        analyzed: !!a,
    };
}


// Data behind the dashboard graphs (everything derives from stored metadata + the analysis cache).
function buildCharts(list, entries) {
    const bins = (edges, labels) => labels.map((label, i) => ({ label, from: edges[i], to: edges[i + 1], count: 0 }));
    const score = bins([0, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0001], ["<0.5", "0.5–0.6", "0.6–0.7", "0.7–0.8", "0.8–0.9", "0.9–1"]);
    const density = bins([0, 4, 8, 12, 16, 20, 1e9], ["<4", "4–8", "8–12", "12–16", "16–20", "20+"]);
    let noScore = 0;
    const day = 86_400_000;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const added = Array.from({ length: 30 }, (_, i) => {
        const d = new Date(today.getTime() - (29 - i) * day);
        return { date: d.toISOString().slice(0, 10), count: 0, bytes: 0 };
    });
    const byDate = new Map(added.map((a) => [a.date, a]));
    const sizeByQuality = { good: 0, fallback: 0, unvalidated: 0, upload: 0 };

    for (const dl of list) {
        const a = cachedAnalysis(dl.path);
        if (typeof dl.score === "number") {
            const b = score.find((x) => dl.score >= x.from && dl.score < x.to);
            if (b) b.count++;
        } else noScore++;
        if (a && !a.missing && a.cuePerMin) {
            const b = density.find((x) => a.cuePerMin >= x.from && a.cuePerMin < x.to);
            if (b) b.count++;
        }
        if (a && !a.missing) sizeByQuality[qualityOf(dl)] = (sizeByQuality[qualityOf(dl)] || 0) + (a.bytes || 0);
        if (dl.addedAt) {
            const d = new Date(dl.addedAt);
            d.setHours(0, 0, 0, 0);
            const slot = byDate.get(d.toISOString().slice(0, 10));
            if (slot) {
                slot.count++;
                slot.bytes += a && !a.missing ? a.bytes || 0 : 0;
            }
        }
    }
    const withSubs = new Set(list.map((d) => d.mediaId));
    const titles = entries.length || withSubs.size;
    return {
        scoreHistogram: score,
        noScore,
        cueDensity: density,
        added,
        sizeByQuality,
        coverage: { titles, withSubs: Math.min(titles, withSubs.size), withoutSubs: Math.max(0, titles - withSubs.size) },
    };
}

async function adminOverview() {
    const list = store.listAllDownloaded();
    const paths = list.map((d) => d.path);
    await analyzeMany(paths, 2500);

    const byLang = new Map();
    const quality = { good: 0, fallback: 0, unvalidated: 0, upload: 0 };
    const sources = {};
    let bytes = 0;
    let cues = 0;
    let analyzed = 0;
    let missing = 0;
    let scoreSum = 0;
    let scoreN = 0;
    let cpmSum = 0;
    const titles = new Set();
    for (const dl of list) {
        const a = cachedAnalysis(dl.path);
        titles.add(dl.mediaId);
        const q = qualityOf(dl);
        quality[q] = (quality[q] || 0) + 1;
        sources[dl.source || "legacy"] = (sources[dl.source || "legacy"] || 0) + 1;
        if (typeof dl.score === "number") {
            scoreSum += dl.score;
            scoreN++;
        }
        const L = byLang.get(dl.lang) || { lang: dl.lang, label: LANG_LABEL[dl.lang] || dl.lang.toUpperCase(), files: 0, bytes: 0, cues: 0 };
        L.files++;
        if (a) {
            if (a.missing) missing++;
            else {
                analyzed++;
                bytes += a.bytes || 0;
                cues += a.cues || 0;
                cpmSum += a.cuePerMin || 0;
                L.bytes += a.bytes || 0;
                L.cues += a.cues || 0;
            }
        }
        byLang.set(dl.lang, L);
    }
    const dir = await dirStats(store.getSubtitleRoot());
    const q = await store.getQueueStats();
    const charts = buildCharts(list, q.queue);
    return {
        charts,
        generatedAt: new Date().toISOString(),
        totals: {
            files: list.length,
            titles: titles.size,
            bytes,
            cues,
            analyzedFiles: analyzed,
            missingFiles: missing,
            avgScore: scoreN ? +(scoreSum / scoreN).toFixed(3) : null,
            avgCuePerMin: analyzed ? +(cpmSum / analyzed).toFixed(1) : null,
        },
        analysis: { done: analyzed + missing, total: list.length, complete: analyzed + missing >= list.length },
        storage: { dataBytes: dir.bytes, dataFiles: dir.files, rejectedBytes: dir.rejectedBytes, rejectedFiles: dir.rejectedFiles },
        languages: [...byLang.values()].sort((x, y) => y.files - x.files),
        quality,
        sources,
        queue: q.counts,
        worker: getStatus(),
        budget: getBudget(),
        usage: getUsage(),
        config: { languages: SUPPORTED_LANGS, idleSeconds: Math.round(IDLE_QUIET_MS / 1000), candidates: CANDIDATES, audit: AUDIT_ENABLED, acceptScore: ACCEPT_REF, fallbackMin: FALLBACK_MIN, upgradeRecheckDays: UPGRADE_RECHECK_DAYS },
    };
}

const SORTERS = {
    title: (r) => r.title.toLowerCase(),
    lang: (r) => r.lang,
    size: (r) => r.sizeBytes ?? -1,
    cues: (r) => r.cues ?? -1,
    cuePerSec: (r) => r.cuePerSec ?? -1,
    score: (r) => (r.score == null ? -1 : r.score),
    quality: (r) => r.quality,
    added: (r) => (r.addedAt ? Date.parse(r.addedAt) : 0),
};

async function adminList(q = {}) {
    const page = Math.max(1, parseInt(q.page, 10) || 1);
    const limit = Math.max(5, Math.min(100, parseInt(q.limit, 10) || 10));
    const search = String(q.search || "").trim().toLowerCase();
    const lang = String(q.lang || "").trim();
    const quality = String(q.quality || "").trim();
    const source = String(q.source || "").trim();
    const sort = SORTERS[q.sort] ? q.sort : "score"; // highest score first unless told otherwise
    const dir = q.order === "asc" ? 1 : -1;

    let rows = store.listAllDownloaded().map((dl) => rowOf(dl, store.getEntry(dl.mediaId), cachedAnalysis(dl.path)));
    if (lang) rows = rows.filter((r) => r.lang === lang);
    if (quality) rows = rows.filter((r) => r.quality === quality);
    if (source) rows = rows.filter((r) => r.source === source);
    if (search) rows = rows.filter((r) => r.title.toLowerCase().includes(search) || (r.filename || "").toLowerCase().includes(search) || r.mediaId === search);
    rows.sort((a, b) => {
        const x = SORTERS[sort](a);
        const y = SORTERS[sort](b);
        if (x !== y) return x < y ? -dir : dir;
        const ta = a.addedAt ? Date.parse(a.addedAt) : 0; // ties: newest first
        const tb = b.addedAt ? Date.parse(b.addedAt) : 0;
        return tb - ta || a.title.localeCompare(b.title);
    });

    const total = rows.length;
    const slice = rows.slice((page - 1) * limit, page * limit);
    // make sure the visible page is fully analysed (cached after the first time)
    const infos = new Map(store.listAllDownloaded().map((d) => [`${d.mediaId}:${d.lang}`, d]));
    await analyzeMany(slice.map((r) => infos.get(r.key)?.path).filter(Boolean), 3000);
    const out = slice.map((r) => rowOf(infos.get(r.key), store.getEntry(r.mediaId), cachedAnalysis(infos.get(r.key).path)));
    return { rows: out, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)), sort, order: dir === 1 ? "asc" : "desc" };
}

async function adminPreview(mediaId, lang, { from = 0, n = 40 } = {}) {
    const dl = store.getDownloadedInfo(mediaId, lang);
    if (!dl || !insideRoot(dl.path)) return null;
    const { text } = decodeBuffer(await fsp.readFile(dl.path));
    const cues = parseSubtitle(text, path.extname(dl.path));
    const start = Math.max(0, Math.min(cues.length, parseInt(from, 10) || 0));
    const count = Math.max(1, Math.min(200, parseInt(n, 10) || 40));
    return { total: cues.length, from: start, cues: cues.slice(start, start + count).map((c, i) => ({ i: start + i + 1, start: +c.s.toFixed(2), end: +c.e.toFixed(2), text: c.t })) };
}


// ─── Deep details of one subtitle (the dashboard "details" dialog) ───────────

function pctile(arr, p) {
    if (!arr.length) return 0;
    const a = [...arr].sort((x, y) => x - y);
    return a[Math.min(a.length - 1, Math.floor(p * (a.length - 1)))];
}

async function adminDetails(mediaId, lang) {
    const dl = store.getDownloadedInfo(mediaId, lang);
    if (!dl || !insideRoot(dl.path)) return null;
    const entry = store.getEntry(mediaId);
    const base = rowOf({ mediaId, ...dl }, entry, await analyzeFile(dl.path));
    const buf = await fsp.readFile(dl.path);
    const ext = path.extname(dl.path).toLowerCase();
    const { text, badRatio } = decodeBuffer(buf);
    const cues = parseSubtitle(text, ext);

    // video facts (duration, resolution, embedded tracks) from the cached ffprobe data
    const info = mediaInfoIndex()[mediaId];
    const vq = videoQualityOf(info);
    const durationSec = vq.durationSec || 0;

    // ── file ──
    const bom = buf[0] === 0xff && buf[1] === 0xfe ? "UTF-16 LE" : buf[0] === 0xfe && buf[1] === 0xff ? "UTF-16 BE" : buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? "UTF-8 (BOM)" : null;
    const ascii = !/[^\x00-\x7f]/.test(text);
    const crlf = (buf.toString("latin1").match(/\r\n/g) || []).length;
    const lf = (buf.toString("latin1").match(/\n/g) || []).length - crlf;
    const file = {
        folder: path.basename(path.dirname(path.dirname(dl.path))),
        langFolder: path.basename(path.dirname(dl.path)),
        filename: dl.filename,
        ext,
        bytes: buf.length,
        mtime: base.addedAt,
        encoding: bom || (badRatio > 0 ? "UTF-8 (invalid bytes found)" : ascii ? "ASCII / UTF-8" : "UTF-8"),
        lineEndings: crlf && lf ? "Mixed" : crlf ? "Windows (CRLF)" : "Unix (LF)",
        invalidCharPct: +(badRatio * 100).toFixed(3),
    };

    // ── cues ──
    const n = cues.length;
    const dur = cues.map((c) => c.e - c.s);
    const gaps = [];
    let overlaps = 0;
    for (let i = 1; i < n; i++) {
        const g = cues[i].s - cues[i - 1].e;
        if (g < -0.05) overlaps++;
        else gaps.push(g);
    }
    const chars = cues.map((c) => c.t.length);
    const cps = cues.map((c, i) => (dur[i] > 0.3 ? c.t.length / dur[i] : 0)).filter(Boolean);
    const words = cues.reduce((a, c) => a + (c.t ? c.t.split(/\s+/).length : 0), 0);
    const lined = cues.filter((c) => c._lines);
    const lineCount = (c) => c._lines.length - c._ti - 1;
    const multi = lined.filter((c) => lineCount(c) > 1).length;
    const italic = lined.filter((c) => /<i>|<\/i>|\\i1/i.test(c._lines.join(" "))).length;
    const colored = lined.filter((c) => /<font\b|\{\\c/i.test(c._lines.join(" "))).length;
    const longestLine = lined.reduce((m, c) => Math.max(m, ...c._lines.slice(c._ti + 1).map((l) => stripMarkup(l).length)), 0);
    const first = n ? cues[0].s : 0;
    const last = n ? Math.max(...cues.slice(-5).map((c) => c.e)) : 0;
    const span = Math.max(0, last - first);
    const total = Math.max(durationSec, last, 1);
    const BUCKETS = 48;
    const timeline = Array.from({ length: BUCKETS }, (_, i) => ({ from: (total / BUCKETS) * i, count: 0 }));
    for (const c of cues) timeline[Math.min(BUCKETS - 1, Math.floor((c.s / total) * BUCKETS))].count++;
    const hist = (vals, edges, labels) => labels.map((label, i) => ({ label, count: vals.filter((v) => v >= edges[i] && v < edges[i + 1]).length }));

    const stats = {
        total: n,
        words,
        chars: chars.reduce((a, b) => a + b, 0),
        avgWords: n ? +(words / n).toFixed(1) : 0,
        avgChars: n ? +(chars.reduce((a, b) => a + b, 0) / n).toFixed(1) : 0,
        firstAt: +first.toFixed(1),
        lastAt: +last.toFixed(1),
        spanSec: +span.toFixed(1),
        coveragePct: durationSec ? +Math.min(100, (span / durationSec) * 100).toFixed(1) : null,
        cuePerMin: span ? +((n / span) * 60).toFixed(1) : 0,
        durMin: n ? +Math.min(...dur).toFixed(2) : 0,
        durAvg: n ? +(dur.reduce((a, b) => a + b, 0) / n).toFixed(2) : 0,
        durP95: +pctile(dur, 0.95).toFixed(2),
        durMax: n ? +Math.max(...dur).toFixed(2) : 0,
        shortCues: dur.filter((d) => d < 0.5).length,
        longCues: dur.filter((d) => d > 7).length,
        gapAvg: gaps.length ? +(gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(2) : 0,
        gapMax: gaps.length ? +Math.max(...gaps).toFixed(1) : 0,
        longGaps: gaps.filter((g) => g > 60).length,
        overlaps,
        cpsAvg: cps.length ? +(cps.reduce((a, b) => a + b, 0) / cps.length).toFixed(1) : 0,
        cpsP95: +pctile(cps, 0.95).toFixed(1),
        fastReading: cps.filter((v) => v > 21).length,
        emptyCues: cues.filter((c) => !c.t).length,
        soundCues: cues.filter((c) => /^[[(].*[\])]$/.test(c.t)).length,
        multiLinePct: lined.length ? +((multi / lined.length) * 100).toFixed(1) : null,
        italicPct: lined.length ? +((italic / lined.length) * 100).toFixed(1) : null,
        coloredPct: lined.length ? +((colored / lined.length) * 100).toFixed(1) : null,
        longestLine,
        duplicateCues: n - new Set(cues.map((c) => `${c.s.toFixed(1)}|${c.t}`)).size,
    };

    const rejDir = path.join(path.dirname(dl.path), "_rejected");
    let rejected = { files: 0, bytes: 0 };
    for (const f of await fsp.readdir(rejDir).catch(() => [])) {
        try {
            rejected.bytes += (await fsp.stat(path.join(rejDir, f))).size;
            rejected.files++;
        } catch {
            /* gone */
        }
    }

    return {
        row: base,
        file,
        stats,
        timeline: timeline.map((t) => ({ at: +t.from.toFixed(0), count: t.count })),
        durationHist: hist(dur, [0, 0.5, 1, 2, 3, 5, 7, 1e9], ["<0.5s", "0.5–1", "1–2", "2–3", "3–5", "5–7", ">7s"]),
        cpsHist: hist(cps, [0, 8, 12, 17, 21, 25, 1e9], ["<8", "8–12", "12–17", "17–21", "21–25", ">25"]),
        validation: {
            quality: base.quality,
            score: base.score,
            mode: dl.validation || null,
            reasons: dl.reasons || [],
            checks: dl.stats || null,
            validatedAt: dl.validatedAt || null,
            nextUpgradeAt: dl.quality === "fallback" ? dl.nextUpgradeAt || null : null,
            thresholds: { accept: ACCEPT_REF, fallbackMin: FALLBACK_MIN, maxOffsetSec: MAX_OFFSET_SEC },
        },
        origin: { source: dl.source || "legacy", releaseName: dl.releaseName || "", subtitleId: dl.subtitleId || null, shiftApplied: dl.shiftApplied || 0, removedPromo: dl.removedPromo || 0, addedAt: dl.addedAt || null },
        queue: entry ? { status: entry.status, attempts: entry.attempts || 0, lastError: entry.lastError || null, langsChecked: entry.langsChecked || [], langsStored: entry.langsStored || [] } : null,
        video: { durationSec, resolution: vq.label, width: vq.width, height: vq.height, embeddedText: vq.embeddedText, embeddedImage: vq.embeddedImage, sizeBytes: vq.sizeBytes },
        rejected,
    };
}

function adminFile(mediaId, lang) {
    const dl = store.getDownloadedInfo(mediaId, lang);
    if (!dl || !insideRoot(dl.path)) return null;
    return { path: dl.path, filename: dl.filename };
}

async function adminPurgeRejected() {
    const root = store.getSubtitleRoot();
    let freed = 0;
    let files = 0;
    async function walk(dir) {
        let ents;
        try {
            ents = await fsp.readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of ents) {
            if (!e.isDirectory()) continue;
            const full = path.join(dir, e.name);
            if (e.name === "_rejected") {
                for (const f of await fsp.readdir(full).catch(() => [])) {
                    try {
                        freed += (await fsp.stat(path.join(full, f))).size;
                        files++;
                    } catch {
                        /* gone */
                    }
                }
                await fsp.rm(full, { recursive: true, force: true });
            } else await walk(full);
        }
    }
    await walk(root);
    _dirCache = { at: 0, v: null };
    return { freedBytes: freed, files };
}

/** Forget one language of a title and make sure it is (or is not) looked up again. */
function _entryForget(mediaId, lang, { lookAgain }) {
    const e = store.getEntry(mediaId);
    if (!e) return false;
    e.langsStored = (e.langsStored || []).filter((l) => l !== lang);
    const checked = new Set(e.langsChecked || []);
    if (lookAgain) checked.delete(lang);
    else checked.add(lang); // deleted on purpose — never fetch it again behind the admin's back
    e.langsChecked = [...checked];
    store.touchQueue();
    return true;
}

async function adminAction(action, items, params = {}) {
    const list = (Array.isArray(items) ? items : []).slice(0, 200);
    const results = [];
    for (const it of list) {
        const { mediaId, lang } = it || {};
        const res = { mediaId, lang, ok: false, message: "" };
        results.push(res);
        try {
            const dl = store.getDownloadedInfo(mediaId, lang);
            if (!dl) {
                res.message = "not found";
                continue;
            }
            if (!insideRoot(dl.path)) {
                res.message = "path outside subtitle storage — refused";
                continue;
            }
            const dir = path.dirname(dl.path);
            const ext = path.extname(dl.path).toLowerCase();

            if (action === "revalidate") {
                await store.markUnvalidated(mediaId, lang);
                _auditSkip.delete(`${mediaId}:${lang}`);
                res.ok = true;
                res.message = "queued — it is re-checked the next time the server is idle";
            } else if (action === "redownload") {
                if (!store.getEntry(mediaId)) {
                    res.message = "no library entry (uploaded file) — cannot look for another";
                    continue;
                }
                invalidateSubtitleWork(mediaId, lang); // any download already in flight for this slot is now stale
                await withSlot(mediaId, lang, async () => {
                    await fsp.mkdir(path.join(dir, "_rejected"), { recursive: true });
                    await fsp.rename(dl.path, path.join(dir, "_rejected", `${Date.now()}-${path.basename(dl.path)}`)).catch(() => {});
                    await store.removeDownloaded(mediaId, lang);
                    _entryForget(mediaId, lang, { lookAgain: true });
                    store.requeueForRedownload(mediaId);
                });
                _analysisCache.delete(dl.path);
                res.ok = true;
                res.message = "old file kept in _rejected · queued to download again (when idle)";
            } else if (action === "delete") {
                invalidateSubtitleWork(mediaId, lang); // a fallback upgrade still downloading must not bring it back
                await withSlot(mediaId, lang, async () => {
                    await fsp.rm(dl.path, { force: true });
                    await store.removeDownloaded(mediaId, lang);
                    _entryForget(mediaId, lang, { lookAgain: false });
                });
                _analysisCache.delete(dl.path);
                await fsp.rmdir(dir).catch(() => {}); // only succeeds when empty
                res.ok = true;
                res.message = "deleted";
            } else if (action === "shift") {
                const sec = Number(params.seconds);
                if (!Number.isFinite(sec) || sec === 0 || Math.abs(sec) > 300) {
                    res.message = "seconds must be a non-zero number within ±300";
                    continue;
                }
                if (!/\.(srt|vtt)$/.test(ext)) {
                    res.message = "only .srt / .vtt can be shifted";
                    continue;
                }
                await withSlot(mediaId, lang, async () => {
                    const { text } = decodeBuffer(await fsp.readFile(dl.path));
                    await commitText(dir, ext, shiftTimestamps(text, sec));
                });
                dl.shiftApplied = +((dl.shiftApplied || 0) + sec).toFixed(3);
                store.touchMeta();
                _analysisCache.delete(dl.path);
                res.ok = true;
                res.message = `shifted ${sec > 0 ? "+" : ""}${sec}s`;
            } else if (action === "clean") {
                if (ext !== ".srt") {
                    res.message = "only .srt can be cleaned";
                    continue;
                }
                const parsed = await readCandidate(dl.path, ext);
                if (!parsed.removedPromo) {
                    res.ok = true;
                    res.message = "nothing to clean";
                    continue;
                }
                await commitText(dir, ext, parsed.text);
                dl.removedPromo = (dl.removedPromo || 0) + parsed.removedPromo;
                store.touchMeta();
                _analysisCache.delete(dl.path);
                res.ok = true;
                res.message = `removed ${parsed.removedPromo} watermark cues`;
            } else if (action === "upgrade") {
                if (dl.quality !== "fallback") {
                    res.message = "already high quality";
                    continue;
                }
                dl.nextUpgradeAt = new Date().toISOString();
                store.touchMeta();
                const n = store.requeueUpgradesDue();
                res.ok = true;
                res.message = n ? "queued — looking for a better one when idle" : "no library entry to queue";
            } else {
                res.message = `unknown action "${action}"`;
            }
        } catch (err) {
            res.ok = false;
            res.message = err.message;
        }
    }
    _dirCache = { at: 0, v: null };
    return { action, results, ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
}


// ─── Titles without any subtitle ─────────────────────────────────────────────
// Every title the worker knows (queue entries) that has NO stored subtitle in any language — best video quality first
// (resolution from the cached ffprobe data), so the films you will actually watch on a big screen are looked after first.

let _infoCache = { at: 0, v: null };
function mediaInfoIndex() {
    if (_infoCache.v && Date.now() - _infoCache.at < 60_000) return _infoCache.v;
    let all = {};
    try {
        all = require("../media/mediaInfoStore").getAll() || {};
    } catch {
        /* no media info available — quality column just stays empty */
    }
    _infoCache = { at: Date.now(), v: all };
    return all;
}

function videoQualityOf(info) {
    const streams = Array.isArray(info?.streams) ? info.streams : [];
    const v = streams.find((x) => x.codec_type === "video" && x.disposition?.attached_pic !== 1) || streams.find((x) => x.codec_type === "video");
    const h = Number(v?.height) || 0;
    const w = Number(v?.width) || 0;
    const top = Math.max(h, w >= 3000 ? 2160 : w >= 1800 ? 1080 : w >= 1200 ? 720 : 0); // scope/cropped films: judge by width too
    const label = top >= 2000 ? "4K" : top >= 1400 ? "1440p" : top >= 1000 ? "1080p" : top >= 700 ? "720p" : top >= 460 ? "480p" : top > 0 ? "SD" : null;
    const embedded = streams.filter((x) => x.codec_type === "subtitle" && !IMAGE_CODECS.has(String(x.codec_name || "").toLowerCase())).length;
    const embeddedImage = streams.filter((x) => x.codec_type === "subtitle").length - embedded;
    return { height: h, width: w, rank: top, label, embeddedText: embedded, embeddedImage, durationSec: Number(info?.format?.duration) || 0, sizeBytes: Number(info?.format?.size) || 0 };
}

function whyMissing(e) {
    if (e.status === "pending" || e.status === "downloading") return "waiting";
    if (e.status === "failed") return "failed";
    if (e.status === "skipped") return e.lastError || "skipped";
    return "none_stored"; // finished, but nothing on disk (deleted, or every language unavailable)
}

async function adminMissing(q = {}) {
    const page = Math.max(1, parseInt(q.page, 10) || 1);
    const limit = Math.max(5, Math.min(100, parseInt(q.limit, 10) || 10));
    const search = String(q.search || "").trim().toLowerCase();
    const status = String(q.status || "").trim(); // waiting | nomatch | failed
    const type = String(q.type || "").trim(); // movie | tv
    const sort = ["quality", "title", "status"].includes(q.sort) ? q.sort : "quality";
    const dir = q.order === "asc" ? 1 : -1;

    const have = new Set(store.listAllDownloaded().map((d) => d.mediaId));
    const info = mediaInfoIndex();
    const all = (await store.getQueueStats()).queue
        .filter((e) => !have.has(e.mediaId))
        .map((e) => {
            const vq = videoQualityOf(info[e.mediaId]);
            return {
                mediaId: e.mediaId,
                title: titleOf(null, e),
                type: e.type || null,
                year: e.year || null,
                status: e.status,
                reason: whyMissing(e),
                lastError: e.lastError || null,
                attempts: e.attempts || 0,
                langsChecked: e.langsChecked || [],
                nextRetryAt: e.nextRetryAt || null,
                quality: vq.label,
                qualityRank: vq.rank,
                width: vq.width,
                height: vq.height,
                embeddedText: vq.embeddedText,
                embeddedImage: vq.embeddedImage,
                sizeBytes: vq.sizeBytes,
            };
        });

    const bucket = (r) => (r.status === "failed" ? "failed" : r.status === "pending" || r.status === "downloading" ? "waiting" : "nomatch");
    const counts = { total: all.length, waiting: 0, nomatch: 0, failed: 0, withEmbedded: 0 };
    const resMix = new Map();
    for (const r of all) {
        counts[bucket(r)]++;
        if (r.embeddedText) counts.withEmbedded++;
        resMix.set(r.quality || "Unknown", (resMix.get(r.quality || "Unknown") || 0) + 1);
    }
    counts.byResolution = ["4K", "1440p", "1080p", "720p", "480p", "SD", "Unknown"].filter((k) => resMix.has(k)).map((k) => ({ label: k, count: resMix.get(k) }));

    let rows = all;
    if (status) rows = rows.filter((r) => bucket(r) === status);
    if (type) rows = rows.filter((r) => (type === "tv" ? r.type !== "movie" : r.type === "movie"));
    if (search) rows = rows.filter((r) => r.title.toLowerCase().includes(search));
    const key = { quality: (r) => r.qualityRank, title: (r) => r.title.toLowerCase(), status: (r) => bucket(r) }[sort];
    rows.sort((a, b) => {
        const x = key(a);
        const y = key(b);
        if (x !== y) return x < y ? -dir : dir;
        return (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title); // same quality: newer films first
    });

    const total = rows.length;
    return { rows: rows.slice((page - 1) * limit, page * limit), total, page, limit, pages: Math.max(1, Math.ceil(total / limit)), counts, sort, order: dir === 1 ? "asc" : "desc" };
}

/** Search again: forget what was checked for these titles and queue them. Accepts ids and/or { all, status } (all + no status = every no-match and failed title; waiting ones are already queued). */
async function adminRetryMissing({ mediaIds = [], all = false, status = "" } = {}) {
    const have = new Set(store.listAllDownloaded().map((d) => d.mediaId));
    const pick = new Set((Array.isArray(mediaIds) ? mediaIds : []).slice(0, 2000));
    const entries = (await store.getQueueStats()).queue;
    let n = 0;
    for (const e of entries) {
        if (have.has(e.mediaId)) continue;
        const hit = pick.has(e.mediaId) || (all && ((!status && (e.status === "skipped" || e.status === "failed")) || (status === "nomatch" && e.status === "skipped") || (status === "failed" && e.status === "failed")));
        if (!hit) continue;
        const live = store.getEntry(e.mediaId);
        if (!live) continue;
        live.status = "pending";
        live.attempts = 0;
        live.lastError = null;
        live.nextRetryAt = null;
        live.langsChecked = [];
        n++;
    }
    if (n) store.touchQueue();
    return { queued: n };
}

// ─── Tick ────────────────────────────────────────────────────────────────────

async function processNext() {
    if (_running || _stopped) return;
    if (_retryAfter && Date.now() < _retryAfter) return;
    if (_retryAfter && Date.now() >= _retryAfter) {
        _retryAfter = 0;
        console.log("[SubtitleWorker] Cooldown done. Resuming.");
    }
    if (Date.now() < _nextOkAt) return;
    if (!isIdle()) return; // streaming / browsing recently — try again next tick

    _running = true;
    try {
        const entry = store.dequeue(); // sync, in-memory
        if (entry) await processEntry(entry);
        else if (!(AUDIT_ENABLED && (await auditOne())) && Date.now() - _lastUpgradeScan > 3_600_000) {
            // SUBTITLE_AUDIT=0 only switches off the legacy-file audit; due fallback upgrades must still be scanned.
            _lastUpgradeScan = Date.now();
            const n = store.requeueUpgradesDue(); // fallbacks whose re-check date has come → look for better candidates
            if (n) console.log(`[SubtitleWorker] ${n} title(s) with a fallback subtitle queued to look for a better one`);
        }
    } finally {
        _running = false;
        _nextOkAt = Date.now() + COOLDOWN_MS;
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

function start() {
    if (_started) return;
    _started = true;
    _stopped = false;
    _timer = setInterval(() => {
        processNext().catch((e) => console.error("[SubtitleWorker] Tick error:", e.message));
    }, INTERVAL_MS);
    if (_timer.unref) _timer.unref(); // don't block process exit
    console.log(`[SubtitleWorker] Started (interval=${INTERVAL_MS}ms, idle>=${Math.round(IDLE_QUIET_MS / 1000)}s, candidates=${CANDIDATES}, audit=${AUDIT_ENABLED})`);
}

function stop() {
    _stopped = true;
    if (_timer) {
        clearInterval(_timer);
        _timer = null;
    }
    try {
        _refChild?.kill("SIGKILL");
    } catch {
        /* already gone */
    }
    _started = false;
    console.log("[SubtitleWorker] Stopped.");
}

function getStatus() {
    const cooling = _retryAfter > 0 && Date.now() < _retryAfter;
    return {
        running: _running,
        paused: cooling,
        pauseUntil: cooling ? new Date(_retryAfter).toISOString() : null,
        started: _started,
        idle: isIdle(),
        activeSessions: activeSessions(),
        stats: { ..._stats },
    };
}

module.exports = {
    invalidateSubtitleWork,
    start,
    stop,
    getStatus,
    noteActivity,
    setSessionProbe,
    downloadValidated,
    // dashboard
    adminOverview,
    adminList,
    adminPreview,
    adminDetails,
    adminFile,
    adminAction,
    adminPurgeRejected,
    adminMissing,
    adminRetryMissing,
    // exported for tests
    _internal: { parseSubtitle, evaluate, shiftTimestamps, decodeBuffer, rankTracks, processNext, stripPromoCues, rebuildSrt },
};
