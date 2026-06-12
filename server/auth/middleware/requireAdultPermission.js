"use strict";

/**
 * auth/middleware/requireAdultPermission.js
 * Block access to adult content if user's allowAdult === false.
 * Must run AFTER authenticateJWT.
 * Reads from req.permissions (injected by authenticateJWT).
 */

function requireAdultPermission(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: "Authentication required" });
    }

    if (req.user.role === "admin") return next();

    const perms = req.permissions;
    if (!perms.allowAdult) {
        return res.status(403).json({ error: "Adult content access denied", code: "ADULT_CONTENT_BLOCKED" });
    }

    next();
}

module.exports = { requireAdultPermission };
