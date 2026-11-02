"use strict";

/**
 * auth/middleware/liveUrlGuard.js
 * Live TV channel LISTINGS are browsable by any verified user (pending included), but the upstream
 * stream address is only handed to accounts that may actually watch.
 *
 * The player connects straight to the channel's upstream URL, so withholding the URL is the control:
 * for users who may not play (pending / blocked / expired / canLiveTV=false) every `url`/`streamUrl`
 * field is removed from the JSON response, and ids that are just base64url(url) are replaced by an
 * opaque hash so the address cannot be recovered from them.
 *
 * Must run AFTER authenticateJWT (needs req.user). Mount on browse routes that return channels.
 */

const crypto = require("crypto");
const { playbackDenial } = require("./requirePlaybackAccess");
const { parsePermissions } = require("../services/permissionService");

const URL_KEYS = new Set(["url", "streamUrl"]);

function looksLikeEncodedUrl(v) {
    if (typeof v !== "string" || v.length < 12 || !/^[A-Za-z0-9_-]+$/.test(v)) return false;
    try {
        return /^(https?|rtmp|rtsp|udp):\/\//i.test(Buffer.from(v, "base64url").toString("utf8"));
    } catch {
        return false;
    }
}

function scrub(node) {
    if (Array.isArray(node)) return node.map(scrub);
    if (node && typeof node === "object") {
        const out = {};
        for (const [k, v] of Object.entries(node)) {
            if (URL_KEYS.has(k)) continue;
            if (k === "id" && looksLikeEncodedUrl(v)) {
                out[k] = crypto.createHash("sha256").update(v).digest("hex").slice(0, 24);
                continue;
            }
            out[k] = scrub(v);
        }
        return out;
    }
    return node;
}

function canWatchLive(user) {
    if (!user) return false;
    if (playbackDenial(user)) return false;
    if (user.role === "admin") return true;
    return parsePermissions(user.permissionsJson).canLiveTV !== false;
}

function liveUrlGuard(req, res, next) {
    if (canWatchLive(req.user)) return next();
    const json = res.json.bind(res);
    res.json = (body) => json(scrub(body));
    next();
}

module.exports = { liveUrlGuard, canWatchLive, scrub };
