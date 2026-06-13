"use strict";

/**
 * auth/services/otpService.js
 * Generate, hash, and verify 6-digit OTP codes.
 * Uses argon2 for hashing (same as passwords).
 */

const argon2 = require("argon2");
const crypto = require("crypto");

const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Generate a 6-digit numeric OTP code.
 * Returns the plaintext code (send this to user) and expiry timestamp.
 */
function generateOTP() {
    // Cryptographically random 6-digit code
    const code = String(crypto.randomInt(100000, 999999));
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);
    return { code, expiresAt };
}

/**
 * Hash an OTP code using argon2.
 */
async function hashOTP(code) {
    return argon2.hash(code, {
        type: argon2.argon2id,
        memoryCost: 2 ** 14,
        timeCost: 2,
        parallelism: 1,
    });
}

/**
 * Verify a plaintext OTP code against a stored hash.
 */
async function verifyOTP(code, hash) {
    try {
        return await argon2.verify(hash, code);
    } catch {
        return false;
    }
}

module.exports = { generateOTP, hashOTP, verifyOTP };
