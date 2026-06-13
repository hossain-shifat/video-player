"use strict";

/**
 * auth/services/googleOAuth.js
 * Google OAuth2 token exchange.
 * OPTIONAL — graceful no-op if GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET are missing.
 */

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || "http://localhost:5000/auth/google/callback";

/**
 * Whether Google OAuth is fully configured.
 */
function isGoogleEnabled() {
    return !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
}

/**
 * Build the Google OAuth authorization URL.
 * Returns null if Google OAuth is not configured.
 */
function getAuthUrl() {
    if (!isGoogleEnabled()) return null;

    const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: GOOGLE_CALLBACK_URL,
        response_type: "code",
        scope: "openid email profile",
        access_type: "offline",
        prompt: "select_account",
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Exchange an authorization code for Google user info.
 * Returns { googleId, email, name, avatar } or throws.
 */
async function exchangeCode(code) {
    if (!isGoogleEnabled()) {
        throw new Error("Google OAuth is not configured");
    }

    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            code,
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            redirect_uri: GOOGLE_CALLBACK_URL,
            grant_type: "authorization_code",
        }),
    });

    if (!tokenRes.ok) {
        const err = await tokenRes.text();
        throw new Error(`Google token exchange failed: ${err}`);
    }

    const tokens = await tokenRes.json();
    const accessToken = tokens.access_token;

    // Fetch user profile
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!profileRes.ok) {
        throw new Error("Failed to fetch Google user info");
    }

    const profile = await profileRes.json();

    return {
        googleId: profile.sub,
        email: profile.email,
        name: profile.name || profile.email,
        avatar: profile.picture || null,
    };
}

module.exports = { isGoogleEnabled, getAuthUrl, exchangeCode };
