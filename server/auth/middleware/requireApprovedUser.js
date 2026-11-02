"use strict";

/**
 * auth/middleware/requireApprovedUser.js
 * Only allows users with status === 'approved'.
 * Must run AFTER authenticateJWT.
 */

function requireApprovedUser(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: "Authentication required" });
    }

    const { status } = req.user;

    // Verification and approval are separate requirements: approved never implies verified.
    if (!req.user.emailVerified) {
        return res.status(403).json({ error: "Email not verified", code: "EMAIL_NOT_VERIFIED" });
    }

    if (status === "pending" || status === "blocked") {
        return res.status(403).json({ error: "Account pending approval", code: "PENDING_APPROVAL" });
    }

    if (status === "deleted") {
        return res.status(403).json({ error: "Account pending deletion", code: "ACCOUNT_DELETED" });
    }

    if (status === "rejected") {
        return res.status(403).json({ error: "Account rejected", code: "ACCOUNT_REJECTED" });
    }

    if (status !== "approved") {
        return res.status(403).json({ error: "Account not approved", code: "NOT_APPROVED" });
    }

    next();
}

module.exports = { requireApprovedUser };
