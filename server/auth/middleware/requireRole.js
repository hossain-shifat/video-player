"use strict";

/**
 * auth/middleware/requireRole.js
 * Factory middleware for role-based access control.
 * Usage: router.use(requireRole('admin'))
 */

function requireRole(...roles) {
    return function (req, res, next) {
        if (!req.user) {
            return res.status(401).json({ error: "Authentication required" });
        }
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: "Insufficient permissions", required: roles });
        }
        next();
    };
}

module.exports = { requireRole };
