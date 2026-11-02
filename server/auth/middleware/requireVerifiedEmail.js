"use strict";

/**
 * auth/middleware/requireVerifiedEmail.js
 * Browsing gate: the account's e-mail must be verified. Says NOTHING about admin approval —
 * verified-but-pending users pass (they may browse). Playback uses requirePlaybackAccess.
 * Must run AFTER authenticateJWT.
 */

function requireVerifiedEmail(req, res, next) {
    if (!req.user) return res.status(401).json({ error: "Authentication required" });
    if (!req.user.emailVerified) {
        return res.status(403).json({ error: "Email not verified", code: "EMAIL_NOT_VERIFIED" });
    }
    next();
}

module.exports = { requireVerifiedEmail };
