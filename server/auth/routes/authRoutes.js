"use strict";

/**
 * auth/routes/authRoutes.js
 * Public auth endpoints: register, login, OTP, refresh, logout, Google OAuth.
 */

const express = require("express");
const router = express.Router();
const argon2 = require("argon2");
const crypto = require("crypto");

const prisma = require("../prismaClient");
const { signAccessToken, generateRefreshToken, refreshTokenExpiresAt } = require("../services/tokenService");
const { generateOTP, hashOTP, verifyOTP } = require("../services/otpService");
const { sendOTPEmail } = require("../services/emailService");
const { isGoogleEnabled, getAuthUrl, exchangeCode } = require("../services/googleOAuth");
const { parsePermissions } = require("../services/permissionService");
const { authenticateJWT } = require("../middleware/authenticateJWT");

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").toLowerCase().trim();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const UAParser = require("ua-parser-js");

function getDeviceInfo(req) {
    const ua = req.headers["user-agent"] || "";
    const ip = req.ip || req.connection?.remoteAddress || "";

    const chUa = req.headers["sec-ch-ua"] || "";
    const chPlatform = req.headers["sec-ch-ua-platform"] || "";
    const chMobile = req.headers["sec-ch-ua-mobile"] || "";
    const chModel = req.headers["sec-ch-ua-model"] || "";

    const parser = new UAParser(ua);
    const result = parser.getResult();

    let browser = result.browser.name || "Unknown";
    let browserVersion = result.browser.version || "";
    if (chUa) {
        const match = chUa.match(/"([^"]+)";v="([^"]+)"/);
        if (match && !match[1].includes("Not")) {
            browser = match[1];
            browserVersion = match[2];
        }
    }

    let os = result.os.name || "Unknown";
    let osVersion = result.os.version || "";
    if (chPlatform) {
        os = chPlatform.replace(/"/g, "");
    }
    if (ua.includes("Android") && os === "Linux") {
        os = "Android";
    }

    let deviceVendor = result.device.vendor || "";
    let deviceModel = chModel ? chModel.replace(/"/g, "") : (result.device.model || "");
    let deviceType = result.device.type || (chMobile === "?1" ? "mobile" : "desktop");

    const deviceName = `${browser} on ${os}`;

    const fpBase = `${browser}-${browserVersion}-${os}-${osVersion}-${deviceType}-${deviceModel}-${deviceVendor}`;
    const deviceFingerprint = crypto.createHash("sha256").update(fpBase).digest("hex");

    return {
        browser,
        browserVersion,
        os,
        osVersion,
        deviceType,
        deviceModel,
        deviceVendor,
        userAgent: ua,
        ip,
        deviceName,
        deviceFingerprint
    };
}

async function createSession(userId, req) {
    const info = getDeviceInfo(req);
    const refreshToken = generateRefreshToken();
    const refreshTokenHash = await argon2.hash(refreshToken);

    let session;
    const existing = await prisma.session.findFirst({
        where: {
            userId,
            deviceFingerprint: info.deviceFingerprint,
        },
    });

    if (existing) {
        session = await prisma.session.update({
            where: { id: existing.id },
            data: {
                refreshTokenHash,
                ...info,
                isActive: true,
                revokedAt: null,
                lastSeenAt: new Date(),
            },
        });
    } else {
        session = await prisma.session.create({
            data: {
                userId,
                ...info,
                refreshTokenHash,
                isActive: true,
            },
        });
    }

    return { session, refreshToken };
}

function buildUserResponse(user) {
    return {
        id: user.id,
        email: user.email,
        name: user.name,
        username: user.username || null,
        avatar: user.avarter,
        role: user.role,
        status: user.status,
        emailVerified: user.emailVerified,
        accessType: user.accessType,
        accessExpiresAt: user.accessExpiresAt,
        permissions: parsePermissions(user.permissionsJson),
    };
}

function isAdminEmail(email) {
    return ADMIN_EMAIL && email.toLowerCase().trim() === ADMIN_EMAIL;
}

// ─── POST /auth/register ──────────────────────────────────────────────────────
router.post("/register", async (req, res) => {
    try {
        const { email, password, name } = req.body;

        if (!email || !password || !name) {
            return res.status(400).json({ error: "email, password, and name are required" });
        }

        if (password.length < 8) {
            return res.status(400).json({ error: "Password must be at least 8 characters" });
        }

        const emailNorm = email.toLowerCase().trim();

        const existing = await prisma.user.findUnique({ where: { email: emailNorm } });
        if (existing) {
            return res.status(409).json({ error: "Email already registered" });
        }

        const passwordHash = await argon2.hash(password, {
            type: argon2.argon2id,
            memoryCost: 2 ** 16,
            timeCost: 3,
            parallelism: 1,
        });

        // Admin auto-detection — admin email skips OTP and gets instant approval
        const isAdmin = isAdminEmail(emailNorm);

        const user = await prisma.user.create({
            data: {
                email: emailNorm,
                passwordHash,
                name: name.trim(),
                role: isAdmin ? "admin" : "user",
                status: isAdmin ? "approved" : "pending",
                emailVerified: isAdmin, // admin skips email verification
            },
        });

        // Always create session and issue tokens on registration
        const { session, refreshToken } = await createSession(user.id, req);
        const accessToken = signAccessToken(user, session.id);

        // Admin email: skip OTP entirely
        if (isAdmin) {
            return res.status(201).json({
                message: "Admin account created and approved.",
                userId: user.id,
                requiresVerification: false,
                isAdmin: true,
                accessToken,
                refreshToken,
                sessionId: session.id,
                user: buildUserResponse(user),
            });
        }

        // Normal user: send OTP
        const { code, expiresAt } = generateOTP();
        const codeHash = await hashOTP(code);

        await prisma.oTP.create({
            data: { userId: user.id, codeHash, expiresAt },
        });

        await sendOTPEmail(emailNorm, name.trim(), code);

        res.status(201).json({
            message: "Registration successful. Check your email for the verification code.",
            userId: user.id,
            requiresVerification: true,
            accessToken,
            refreshToken,
            sessionId: session.id,
            user: buildUserResponse(user),
        });
    } catch (err) {
        console.error("[Auth] Register error:", err);
        res.status(500).json({ error: "Registration failed" });
    }
});

// ─── POST /auth/verify-email ──────────────────────────────────────────────────
router.post("/verify-email", async (req, res) => {
    try {
        const { userId, code } = req.body;

        if (!userId || !code) {
            return res.status(400).json({ error: "userId and code are required" });
        }

        // Find most recent unused OTP for this user
        const otps = await prisma.oTP.findMany({
            where: { userId, used: false },
            orderBy: { createdAt: "desc" },
        });

        if (!otps.length) {
            return res.status(400).json({ error: "No active verification code found" });
        }

        const otp = otps[0];

        if (new Date() > otp.expiresAt) {
            return res.status(400).json({ error: "Verification code expired", code: "OTP_EXPIRED" });
        }

        const valid = await verifyOTP(code.toString().trim(), otp.codeHash);
        if (!valid) {
            return res.status(400).json({ error: "Invalid verification code" });
        }

        // Mark OTP used + user verified
        await prisma.oTP.update({ where: { id: otp.id }, data: { used: true } });
        await prisma.user.update({ where: { id: userId }, data: { emailVerified: true } });

        res.json({ message: "Email verified successfully" });
    } catch (err) {
        console.error("[Auth] Verify email error:", err);
        res.status(500).json({ error: "Verification failed" });
    }
});

// ─── POST /auth/resend-otp ────────────────────────────────────────────────────
router.post("/resend-otp", async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: "userId required" });

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) return res.status(404).json({ error: "User not found" });

        if (user.emailVerified) {
            return res.status(400).json({ error: "Email already verified" });
        }

        // Invalidate old OTPs
        await prisma.oTP.updateMany({ where: { userId, used: false }, data: { used: true } });

        const { code, expiresAt } = generateOTP();
        const codeHash = await hashOTP(code);

        await prisma.oTP.create({ data: { userId, codeHash, expiresAt } });
        await sendOTPEmail(user.email, user.name, code);

        res.json({ message: "Verification code resent" });
    } catch (err) {
        console.error("[Auth] Resend OTP error:", err);
        res.status(500).json({ error: "Failed to resend code" });
    }
});

// ─── POST /auth/login ─────────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: "email and password are required" });
        }

        const emailNorm = email.toLowerCase().trim();
        const user = await prisma.user.findUnique({ where: { email: emailNorm } });

        if (!user || !user.passwordHash) {
            return res.status(401).json({ error: "Invalid email or password" });
        }

        const validPassword = await argon2.verify(user.passwordHash, password);
        if (!validPassword) {
            return res.status(401).json({ error: "Invalid email or password" });
        }

        if (!user.emailVerified) {
            return res.status(403).json({
                error: "Email not verified",
                code: "EMAIL_NOT_VERIFIED",
                userId: user.id,
            });
        }

        // Re-check admin status (in case ADMIN_EMAIL was set after registration)
        let finalUser = user;
        if (isAdminEmail(emailNorm) && (user.role !== "admin" || user.status !== "approved")) {
            finalUser = await prisma.user.update({
                where: { id: user.id },
                data: { role: "admin", status: "approved" },
            });
        }

        // Create session
        const { session, refreshToken } = await createSession(finalUser.id, req);

        const accessToken = signAccessToken(finalUser, session.id);

        res.json({
            accessToken,
            refreshToken,
            sessionId: session.id,
            user: buildUserResponse(finalUser),
        });
    } catch (err) {
        console.error("[Auth] Login error:", err);
        res.status(500).json({ error: "Login failed" });
    }
});

// ─── POST /auth/refresh ───────────────────────────────────────────────────────
router.post("/refresh", async (req, res) => {
    try {
        const { refreshToken, sessionId } = req.body;

        if (!refreshToken || !sessionId) {
            return res.status(400).json({ error: "refreshToken and sessionId required" });
        }

        const session = await prisma.session.findUnique({
            where: { id: sessionId },
            include: { user: true },
        });

        if (!session || !session.isActive) {
            return res.status(401).json({ error: "Session invalid or revoked", code: "SESSION_REVOKED" });
        }

        const validRefresh = await argon2.verify(session.refreshTokenHash, refreshToken);
        if (!validRefresh) {
            return res.status(401).json({ error: "Invalid refresh token" });
        }

        const user = session.user;

        // DO NOT rotate refresh token on every refresh (prevents race conditions on page reload)
        await prisma.session.update({
            where: { id: sessionId },
            data: {
                lastSeenAt: new Date(),
            },
        });

        const accessToken = signAccessToken(user, sessionId);

        res.json({
            accessToken,
            refreshToken, // return the same refresh token
            user: buildUserResponse(user),
        });
    } catch (err) {
        console.error("[Auth] Refresh error:", err);
        res.status(500).json({ error: "Token refresh failed" });
    }
});

// ─── POST /auth/logout ────────────────────────────────────────────────────────
router.post("/logout", authenticateJWT, async (req, res) => {
    try {
        const { sessionId } = req.body;
        if (sessionId) {
            await prisma.session.updateMany({
                where: { id: sessionId, userId: req.user.id },
                data: { isActive: false },
            });
        }
        res.json({ message: "Logged out successfully" });
    } catch (err) {
        console.error("[Auth] Logout error:", err);
        res.status(500).json({ error: "Logout failed" });
    }
});

// ─── GET /auth/me ─────────────────────────────────────────────────────────────
router.get("/me", authenticateJWT, async (req, res) => {
    res.json({ user: buildUserResponse(req.user) });
});

// ─── PATCH /auth/me ───────────────────────────────────────────────────────────
router.patch("/me", authenticateJWT, async (req, res) => {
    try {
        const body = req.body || {};
        const { name, avatar, username, password } = body;
        const data = {};

        if (name !== undefined) {
            const n = name ? String(name).trim() : null;
            if (n) data.name = n;
        }
        if (avatar !== undefined) {
            data.avarter = avatar;
        }
        if (username !== undefined) {
            const u = username ? String(username).trim().toLowerCase() : null;
            // validate: alphanumeric + underscore, 3-32 chars
            if (u && !/^[a-z0-9_]{3,32}$/.test(u)) {
                return res.status(400).json({ error: "Username must be 3-32 characters: letters, numbers, underscore only" });
            }
            data.username = u;
        }
        if (password) {
            if (password.length < 8) {
                return res.status(400).json({ error: "Password must be at least 8 characters" });
            }
            data.passwordHash = await argon2.hash(password, {
                type: argon2.argon2id,
                memoryCost: 2 ** 16,
                timeCost: 3,
                parallelism: 1,
            });
        }

        if (!Object.keys(data).length) return res.status(400).json({ error: "Nothing to update" });

        const user = await prisma.user.update({ where: { id: req.user.id }, data });
        res.json({ user: buildUserResponse(user) });
    } catch (err) {
        if (err.code === "P2002") return res.status(409).json({ error: "Username already taken" });
        console.error("[Auth] PATCH /me error:", err);
        res.status(500).json({ error: "Failed to update profile" });
    }
});

// ─── GET /auth/google ─────────────────────────────────────────────────────────
router.get("/google", (req, res) => {
    if (!isGoogleEnabled()) {
        return res.status(501).json({ error: "Google OAuth is not configured on this server" });
    }
    const url = getAuthUrl();
    res.redirect(url);
});

// ─── GET /auth/google/callback ────────────────────────────────────────────────
router.get("/google/callback", async (req, res) => {
    const FRONTEND_URL = process.env.ALLOWED_ORIGINS?.split(",")[0]?.trim() || "http://localhost:5173";

    try {
        if (!isGoogleEnabled()) {
            return res.redirect(`${FRONTEND_URL}/login?error=oauth_disabled`);
        }

        const { code } = req.query;
        if (!code) {
            return res.redirect(`${FRONTEND_URL}/login?error=oauth_failed`);
        }

        const { googleId, email, name, avatar } = await exchangeCode(code);
        const emailNorm = email.toLowerCase().trim();

        // Find or create user
        let user = await prisma.user.findFirst({
            where: { OR: [{ googleId }, { email: emailNorm }] },
        });

        const isAdmin = isAdminEmail(emailNorm);

        if (!user) {
            user = await prisma.user.create({
                data: {
                    email: emailNorm,
                    googleId,
                    name,
                    avarter: avatar,
                    emailVerified: true, // Google accounts are pre-verified
                    role: isAdmin ? "admin" : "user",
                    status: isAdmin ? "approved" : "pending",
                },
            });
        } else {
            // Link Google ID if account existed via email
            const updates = { googleId, avarter: avatar || user.avarter };
            if (isAdmin) { updates.role = "admin"; updates.status = "approved"; }
            user = await prisma.user.update({ where: { id: user.id }, data: updates });
        }

        const { session, refreshToken } = await createSession(user.id, req);
        const accessToken = signAccessToken(user, session.id);

        // Redirect to frontend with tokens in query (frontend stores them)
        const params = new URLSearchParams({
            accessToken,
            refreshToken,
            sessionId: session.id,
        });
        res.redirect(`${FRONTEND_URL}/auth/callback?${params.toString()}`);
    } catch (err) {
        console.error("[Auth] Google callback error:", err);
        res.redirect(`${FRONTEND_URL}/login?error=oauth_failed`);
    }
});

module.exports = router;
