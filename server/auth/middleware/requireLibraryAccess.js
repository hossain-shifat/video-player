"use strict";

/**
 * auth/middleware/requireLibraryAccess.js
 * Injects req.allowedLibraries for downstream controllers.
 * For admin: passes all libraries through.
 * For users: filters to permitted library IDs only.
 *
 * Does NOT call res.status(403) itself — controllers receive filtered lists.
 * If a specific library ID is requested via params, it validates access to that ID.
 */

const { filterLibraries } = require("../services/permissionService");

/**
 * Inject allowed libraries into request.
 * Controllers should use req.allowedLibraries to filter responses.
 */
function injectLibraryAccess(req, res, next) {
    if (!req.user) {
        // Unauthenticated — show all libraries (public browsing)
        req.allowedLibraries = []; // empty = no filter = show all
        req.isAdmin = false;
        return next();
    }
    // req.permissions already attached by authenticateJWT / optionalJWT
    req.allowedLibraries = req.permissions.libraries || [];
    req.isAdmin = req.user.role === "admin";
    next();
}

/**
 * Guard for a specific library ID in params.
 * Use as: router.get('/:id', requireLibraryAccess, handler)
 */
function requireLibraryAccess(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: "Authentication required" });
    }

    if (req.user.role === "admin") return next();

    const libraryId = req.params.id || req.params.libraryId;
    if (!libraryId) return next(); // no specific library — controller handles filtering

    const allowed = req.permissions.libraries || [];
    if (allowed.length > 0 && !allowed.includes(libraryId)) {
        return res.status(403).json({ error: "Library access denied" });
    }

    next();
}

module.exports = { injectLibraryAccess, requireLibraryAccess };
