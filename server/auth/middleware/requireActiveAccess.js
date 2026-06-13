"use strict";

/**
 * auth/middleware/requireActiveAccess.js
 * Checks that temporary access has not expired.
 * Must run AFTER authenticateJWT + requireApprovedUser.
 */

function requireActiveAccess(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: "Authentication required" });
    }

    const { accessType, accessExpiresAt } = req.user;

    if (accessType === "temporary" && accessExpiresAt) {
        const expiresAt = new Date(accessExpiresAt);
        if (Date.now() > expiresAt.getTime()) {
            return res.status(403).json({ error: "Access expired", code: "ACCESS_EXPIRED" });
        }
    }

    next();
}

module.exports = { requireActiveAccess };
