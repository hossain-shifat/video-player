"use strict";

/**
 * routes/media/subtitleListFilter.js — logs IMAGE-based embedded subtitles in the subtitle list.
 *
 * PGS (hdmv_pgs_subtitle), DVD (dvd_subtitle), DVB and XSUB tracks are pictures, not text. ffmpeg cannot turn
 * them into WebVTT, so selecting one loads 0 cues (server log: "Subtitle encoding currently only possible from
 * text to text or bitmap to bitmap").
 *
 * CHANGE: the list is now returned UNTOUCHED by default (every embedded track shows, as before the filter existed).
 * Hiding is opt-in: set env HIDE_IMAGE_SUBS=1 to drop those tracks. Either way one console line shows what the
 * list held, so the real codec of every track is visible:
 *   [Media] subtitle list: 6 track(s) → embedded subrip#2 ass#3 hdmv_pgs_subtitle#4* … (* = image-based)
 *
 * Wraps res.json of GET /api/media/:id/subtitles only; the controller itself is untouched.
 */

const IMAGE_CODECS = new Set(["hdmv_pgs_subtitle", "pgssub", "dvd_subtitle", "dvdsub", "dvb_subtitle", "dvbsub", "xsub"]);
const HIDE = /^(1|true|yes)$/i.test(String(process.env.HIDE_IMAGE_SUBS || ""));

const isImage = (s) => !!s && s.source === "embedded" && IMAGE_CODECS.has(String(s.codec || "").toLowerCase());

function hideImageSubtitles(req, res, next) {
    const json = res.json.bind(res);
    res.json = (body) => {
        try {
            if (body && Array.isArray(body.subtitles)) {
                const list = body.subtitles;
                const desc = list
                    .map((s) => (s?.source === "embedded" ? `embedded ${s.codec || "?"}#${s.trackIndex ?? "?"}${isImage(s) ? "*" : ""}` : s?.source || "?"))
                    .join(" | ");
                console.log(`[Media] subtitle list: ${list.length} track(s) → ${desc}${HIDE ? " [HIDE_IMAGE_SUBS on]" : ""}`);
                if (HIDE) {
                    const kept = list.filter((s) => !isImage(s));
                    if (kept.length !== list.length) body = { ...body, subtitles: kept };
                }
            }
        } catch {
            /* never break the response */
        }
        return json(body);
    };
    next();
}

module.exports = { hideImageSubtitles, IMAGE_CODECS };
