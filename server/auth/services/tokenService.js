"use strict";

/**
 * auth/services/tokenService.js
 * JWT access tokens + refresh token generation/verification.
 */

const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const JWT_SECRET = process.env.JWT_SECRET || "flux-dev-secret-CHANGE-IN-PRODUCTION";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "15m";
const REFRESH_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || "30d";

/**
 * Sign an access JWT.
 * Payload: { sub: userId, email, role, status }
 */
function signAccessToken(user, sessionId = null) {
    return jwt.sign(
        {
            sub: user.id,
            email: user.email,
            role: user.role,
            status: user.status,
            sid: sessionId,
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN },
    );
}

/**
 * Verify an access JWT.
 * Returns decoded payload or throws.
 */
function verifyAccessToken(token) {
    return jwt.verify(token, JWT_SECRET);
}

/**
 * Generate a cryptographically secure refresh token string.
 * The CALLER is responsible for hashing it before storing.
 */
function generateRefreshToken() {
    return crypto.randomBytes(48).toString("base64url");
}

/**
 * Parse refresh token expiry into a Date object.
 */
function refreshTokenExpiresAt() {
    const ms = parseExpiry(REFRESH_EXPIRES_IN);
    return new Date(Date.now() + ms);
}

/**
 * Parse duration strings like "30d", "15m", "2h" into milliseconds.
 */
function parseExpiry(str) {
    const units = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    const match = /^(\d+)([smhd])$/.exec(str);
    if (!match) return 86400000 * 30; // default 30d
    return parseInt(match[1]) * (units[match[2]] || 86400000);
}

module.exports = { signAccessToken, verifyAccessToken, generateRefreshToken, refreshTokenExpiresAt };
