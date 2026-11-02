"use strict";

/**
 * auth/routes/authRoutes.js
 * Public auth endpoints: register, login, OTP, refresh, logout, Google OAuth.
 */

const express = require("express");
const router = express.Router();
const argon2 = require("argon2");

const prisma = require("../prismaClient");
const { signAccessToken, createSession, revokeSessions, verifyRefreshToken, refreshTokenExpiresAt, resolveDevice, isSessionLive } = require("../services/tokenService");
const { generateOTP, hashOTP, verifyOTP } = require("../services/otpService");
const { sendOTPEmail } = require("../services/emailService");
const { isGoogleEnabled, getAuthUrl, exchangeCode } = require("../services/googleOAuth");
const { parsePermissions } = require("../services/permissionService");
const crypto = require("crypto");
const { authenticateJWT } = require("../middleware/authenticateJWT");
const { requireVerifiedEmail } = require("../middleware/requireVerifiedEmail");
const { rateLimit } = require("../middleware/rateLimit");
const { clearVerifiedCache } = require("../middleware/enforceEmailVerified");
const { getShowcase, warm: warmShowcase } = require("../services/showcaseService");
const { playbackDenial, STREAM_COOKIE } = require("../middleware/requirePlaybackAccess");
const notificationService = require("../../services/notificationService");
const { recoverAccount } = require("../../utils/userStore");

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").toLowerCase().trim();

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Device identity + session creation live in services/tokenService.js (createSession).
// Every successful login path below calls createSession(userId, req, res, { authMethod }).

const OTP_MAX_ATTEMPTS = 5;
const OTP_WINDOW_MAX_ATTEMPTS = 15; // wrong guesses across ALL codes issued in the last 15 min (a resend must not reset the budget)
const OTP_WINDOW_MS = 15 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_RESENDS_PER_HOUR = 5;
const RECOVERY_REQUEST_COOLDOWN_MS = 60 * 1000;

// Admin e-mail normally goes through the same OTP verification as everyone else. Setting
// ADMIN_SKIP_EMAIL_VERIFICATION=true restores the old bootstrap shortcut (OFF by default).
const ADMIN_SKIP_VERIFY = String(process.env.ADMIN_SKIP_EMAIL_VERIFICATION || "").toLowerCase() === "true";

const MIN = 60 * 1000;
const limits = {
    register: rateLimit({ name: "register", max: 5, windowMs: 60 * MIN, message: "Too many sign-up attempts. Try again later." }),
    login: rateLimit({ name: "login-ip", max: 30, windowMs: 15 * MIN, message: "Too many sign-in attempts. Try again later." }),
    loginAccount: rateLimit({ name: "login-acct", max: 10, windowMs: 15 * MIN, keyFn: (req) => String(req.body?.email || "").toLowerCase().trim(), message: "Too many sign-in attempts for this account. Try again later." }),
    verify: rateLimit({ name: "verify", max: 10, windowMs: 15 * MIN, keyFn: (req) => [req.ip, req.user?.id], message: "Too many verification attempts. Request a new code or try again later." }),
    requestApproval: rateLimit({ name: "request-approval", max: 5, windowMs: 60 * MIN, keyFn: (req) => [req.ip, req.user?.id], message: "Too many requests. Try again later." }),
    resend: rateLimit({ name: "resend", max: 6, windowMs: 60 * MIN, keyFn: (req) => [req.ip, req.user?.id], message: "Too many code requests. Try again later." }),
    refresh: rateLimit({ name: "refresh", max: 120, windowMs: 15 * MIN }),
    recover: rateLimit({ name: "recover", max: 10, windowMs: 15 * MIN }),
    forgot: [
        rateLimit({ name: "forgot-ip", max: 10, windowMs: 15 * MIN, message: "Too many reset requests. Try again later." }),
        rateLimit({ name: "forgot-acct", max: 5, windowMs: 60 * MIN, keyFn: (req) => String(req.body?.email || "").toLowerCase().trim(), message: "Too many reset requests for this account. Try again later." }),
    ],
    reset: [
        rateLimit({ name: "reset-ip", max: 20, windowMs: 15 * MIN }),
        rateLimit({ name: "reset-acct", max: 10, windowMs: 15 * MIN, keyFn: (req) => String(req.body?.email || "").toLowerCase().trim(), message: "Too many attempts. Try again later." }),
    ],
    oauthExchange: rateLimit({ name: "oauth-exchange", max: 20, windowMs: 15 * MIN }),
    showcase: rateLimit({ name: "showcase", max: 60, windowMs: MIN }),
};

// Burn comparable CPU when the account does not exist so response time does not reveal registered e-mails.
let dummyHashPromise = null;
const dummyHash = () => (dummyHashPromise ||= argon2.hash("flux-timing-equaliser", { type: argon2.argon2id, memoryCost: 2 ** 16, timeCost: 3, parallelism: 1 }));

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const MAX_PASSWORD_LEN = 128;

// Issue (or reuse) a verification code. Honors the resend cooldown. Returns { sent, retryAfterSec }.
async function issueVerificationOtp(user, { force = false } = {}) {
    const now = Date.now();
    const recent = await prisma.oTP.findMany({
        where: { userId: user.id, purpose: "verify", createdAt: { gt: new Date(now - 60 * MIN) } },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
    });
    if (recent[0] && now - recent[0].createdAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
        return { sent: false, reason: "cooldown", retryAfterSec: Math.ceil((OTP_RESEND_COOLDOWN_MS - (now - recent[0].createdAt.getTime())) / 1000) };
    }
    if (recent.length >= OTP_RESENDS_PER_HOUR) return { sent: false, reason: "hourly", retryAfterSec: 60 * 60 };

    await prisma.oTP.updateMany({ where: { userId: user.id, used: false, purpose: "verify" }, data: { used: true } });
    const { code, expiresAt } = generateOTP();
    const codeHash = await hashOTP(code);
    const created = await prisma.oTP.create({ data: { userId: user.id, codeHash, expiresAt } });
    const mail = await sendOTPEmail(user.email, user.name, code);
    if (!mail?.success) {
        // The mail provider refused / failed: forget this code (so it neither counts toward the hourly cap nor
        // blocks an immediate retry) and tell the caller instead of pretending it was sent.
        await prisma.oTP.delete({ where: { id: created.id } }).catch(() => {});
        return { sent: false, reason: "email_failed", detail: mail?.error };
    }
    return { sent: true };
}

// Verified but still waiting for an admin → tell the admins, and tell the user where they stand.
function notifyPendingVerified(user) {
    if (user.status !== "pending") return;
    notificationService
        .notifyAdmins({
            type: notificationService.TYPES.SIGNUP_PENDING,
            title: "New signup awaiting approval",
            body: "A new user is waiting for approval.", // no name/email: push text can reach a lock screen
            meta: { userId: user.id },
            dedupeKey: `signup:${user.id}`,
            dedupeWindowMs: 7 * 24 * 60 * 60 * 1000,
        })
        .catch(() => {});
    notificationService
        .notify({
            userIds: [user.id],
            type: notificationService.TYPES.ACCOUNT,
            title: "Your registration is waiting for approval",
            body: "An administrator will review your account. We'll notify you when it's approved.",
            meta: { event: "awaiting_approval", status: "pending", statusChanged: true },
            dedupeKey: `awaiting:${user.id}`,
            dedupeWindowMs: 7 * 24 * 60 * 60 * 1000,
        })
        .catch(() => {});
}

// One-time codes that trade for tokens after the Google redirect (tokens never travel in a URL).
const oauthExchange = new Map(); // code → { payload, exp }
const OAUTH_STATE_COOKIE = "flux_oauth_state";
const readCookie = (req, name) => {
    for (const part of String(req.headers?.cookie || "").split(";")) {
        const i = part.indexOf("=");
        if (i !== -1 && part.slice(0, i).trim() === name) {
            try {
                return decodeURIComponent(part.slice(i + 1).trim());
            } catch {
                return null;
            }
        }
    }
    return null;
};
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of oauthExchange) if (v.exp <= now) oauthExchange.delete(k);
}, 60 * 1000).unref?.();

/** Verify a code against an OTP row, counting wrong guesses (locks the code at 5). */
async function checkOtp(otp, code) {
    if (otp.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, locked: true };
    const ok = await verifyOTP(String(code).trim(), otp.codeHash);
    if (!ok) {
        await prisma.oTP.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } }).catch(() => {});
        return { ok: false, locked: otp.attempts + 1 >= OTP_MAX_ATTEMPTS };
    }
    return { ok: true };
}

const isPendingDeletion = (u) => !!u && (u.status === "deleted" || !!u.deletedAt);
const recoveryWindowOpen = (u) => isPendingDeletion(u) && !!u.purgeAt && u.purgeAt > new Date();

function buildUserResponse(user) {
    return {
        id: user.id,
        email: user.email,
        name: user.name,
        username: user.username || null,
        avatar: user.avarter,
        role: user.role,
        // A blocked account is shown to its owner as "pending" — they must not learn they were blocked.
        status: user.status === "blocked" ? "pending" : user.status,
        emailVerified: user.emailVerified,
        accessType: user.accessType,
        accessExpiresAt: user.accessExpiresAt,
        permissions: parsePermissions(user.permissionsJson),
        // Authoritative server-side answer to "may this account watch right now?" (UI hint only —
        // every /stream/* request re-checks). null reason = may play.
        canPlay: !playbackDenial(user),
        playbackBlockedReason: playbackDenial(user)?.body?.code || null, // blocked already reads PENDING_APPROVAL (see playbackDenial)
    };
}

function isAdminEmail(email) {
    return ADMIN_EMAIL && email.toLowerCase().trim() === ADMIN_EMAIL;
}

// ─── POST /auth/register ──────────────────────────────────────────────────────
router.post("/register", limits.register, async (req, res) => {
    try {
        const { email, password, name } = req.body || {};

        if (typeof email !== "string" || typeof password !== "string" || typeof name !== "string" || !email || !password || !name.trim()) {
            return res.status(400).json({ error: "email, password, and name are required" });
        }
        if (!EMAIL_RE.test(email.trim())) {
            return res.status(400).json({ error: "Enter a valid email address" });
        }
        if (password.length < 8) {
            return res.status(400).json({ error: "Password must be at least 8 characters" });
        }
        if (password.length > MAX_PASSWORD_LEN) {
            return res.status(400).json({ error: `Password must be at most ${MAX_PASSWORD_LEN} characters` });
        }

        const emailNorm = email.toLowerCase().trim();

        const existing = await prisma.user.findUnique({ where: { email: emailNorm } });
        if (existing) {
            // Never create a duplicate for an account that is inside its recovery window.
            if (isPendingDeletion(existing)) {
                return res.status(409).json({
                    error: "This email belongs to an account scheduled for deletion. You can recover it with a code sent to this email.",
                    code: "ACCOUNT_PENDING_DELETION",
                });
            }
            return res.status(409).json({ error: "Email already registered" });
        }

        const passwordHash = await argon2.hash(password, {
            type: argon2.argon2id,
            memoryCost: 2 ** 16,
            timeCost: 3,
            parallelism: 1,
        });

        // ADMIN_EMAIL gets the admin role + approval, but must still prove it owns the address
        // (OTP) unless the explicit bootstrap switch ADMIN_SKIP_EMAIL_VERIFICATION=true is set.
        const isAdmin = isAdminEmail(emailNorm);
        const skipVerify = isAdmin && ADMIN_SKIP_VERIFY;

        let user;
        try {
            user = await prisma.user.create({
                data: {
                    email: emailNorm,
                    passwordHash,
                    name: name.trim().slice(0, 100),
                    role: isAdmin ? "admin" : "user",
                    status: isAdmin ? "approved" : "pending",
                    emailVerified: skipVerify,
                },
            });
        } catch (err) {
            // two simultaneous registrations for the same email: the unique index decides
            if (err.code === "P2002") return res.status(409).json({ error: "Email already registered" });
            throw err;
        }

        // A RESTRICTED session is issued so the verification flow survives refresh / closing the
        // browser. Until emailVerified is true the global gate (enforceEmailVerified) refuses every
        // route except /auth/*, so this token cannot browse or watch anything.
        const { session, refreshToken } = await createSession(user.id, req, res, { authMethod: "password" });
        const accessToken = signAccessToken(user, session.id);

        if (skipVerify) {
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

        const otpResult = await issueVerificationOtp(user);

        res.status(201).json({
            message: otpResult.sent ? "Registration successful. Check your email for the verification code." : "Account created, but the verification e-mail could not be sent.",
            emailSent: otpResult.sent === true,
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
// Authenticated: the account is taken from the access token, NEVER from the request body, so a
// stranger cannot verify (or probe) somebody else's address. Body: { code }.
router.post("/verify-email", authenticateJWT, limits.verify, async (req, res) => {
    try {
        const userId = req.user.id;
        const code = req.body?.code;

        if (typeof code !== "string" && typeof code !== "number") {
            return res.status(400).json({ error: "code is required" });
        }
        if (!/^\d{6}$/.test(String(code).trim())) {
            return res.status(400).json({ error: "Enter the 6-digit code" });
        }

        if (req.user.emailVerified) {
            return res.json({ message: "Email already verified", user: buildUserResponse(req.user) });
        }

        // Find most recent unused OTP for this user
        const otps = await prisma.oTP.findMany({
            where: { userId, used: false, purpose: "verify" },
            orderBy: { createdAt: "desc" },
        });

        if (!otps.length) {
            return res.status(400).json({ error: "No active verification code found. Request a new code.", code: "OTP_NONE" });
        }

        const otp = otps[0];

        if (new Date() > otp.expiresAt) {
            return res.status(400).json({ error: "Verification code expired. Request a new code.", code: "OTP_EXPIRED" });
        }

        // Wrong guesses are budgeted across every code issued recently, so "resend" is not a free reset.
        const windowRows = await prisma.oTP.findMany({
            where: { userId, purpose: "verify", createdAt: { gt: new Date(Date.now() - OTP_WINDOW_MS) } },
            select: { attempts: true },
        });
        if (windowRows.reduce((n, r) => n + r.attempts, 0) >= OTP_WINDOW_MAX_ATTEMPTS) {
            return res.status(429).json({ error: "Too many wrong codes. Try again in a few minutes.", code: "OTP_LOCKED" });
        }

        const check = await checkOtp(otp, code);
        if (!check.ok) {
            if (check.locked) return res.status(429).json({ error: "Too many wrong codes. Request a new code.", code: "OTP_LOCKED" });
            return res.status(400).json({ error: "Invalid verification code", code: "OTP_INVALID" });
        }

        // Claim the code first so a double-submit verifies once.
        const claimed = await prisma.oTP.updateMany({ where: { id: otp.id, used: false }, data: { used: true } });
        if (claimed.count === 0) return res.status(409).json({ error: "This code was already used" });

        const verified = await prisma.user.update({ where: { id: userId }, data: { emailVerified: true } });
        clearVerifiedCache(userId);

        notifyPendingVerified(verified);

        // Authoritative status for the client's post-verification redirect. Verification alone
        // never grants playback — user.canPlay reflects approval + access rules.
        res.json({ message: "Email verified successfully", user: buildUserResponse(verified) });
    } catch (err) {
        console.error("[Auth] Verify email error:", err);
        res.status(500).json({ error: "Verification failed" });
    }
});

// ─── POST /auth/resend-otp ────────────────────────────────────────────────────
// Authenticated (account from the token). 60 s cooldown + 5 codes / hour per account.
router.post("/resend-otp", authenticateJWT, limits.resend, async (req, res) => {
    try {
        const user = req.user;

        if (user.emailVerified) {
            return res.status(400).json({ error: "Email already verified" });
        }

        const r = await issueVerificationOtp(user);
        if (!r.sent && r.reason === "email_failed") {
            return res.status(502).json({
                error: "We couldn't send the verification e-mail. Please try again in a moment, or ask the administrator to check the mail settings.",
                code: "EMAIL_DELIVERY_FAILED",
            });
        }
        if (!r.sent) {
            res.setHeader("Retry-After", String(r.retryAfterSec));
            return res.status(429).json({
                error: r.reason === "cooldown" ? `Please wait ${r.retryAfterSec}s before requesting another code.` : "Too many codes requested. Try again later.",
                code: "OTP_RESEND_COOLDOWN",
                retryAfterSec: r.retryAfterSec,
            });
        }

        res.json({ message: "Verification code resent", cooldownSec: OTP_RESEND_COOLDOWN_MS / 1000 });
    } catch (err) {
        console.error("[Auth] Resend OTP error:", err);
        res.status(500).json({ error: "Failed to resend code" });
    }
});

// ─── POST /auth/login ─────────────────────────────────────────────────────────
router.post("/login", limits.login, limits.loginAccount, async (req, res) => {
    try {
        const { email, password } = req.body || {};

        if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
            return res.status(400).json({ error: "email and password are required" });
        }
        if (password.length > MAX_PASSWORD_LEN) {
            return res.status(401).json({ error: "Invalid email or password" });
        }

        const emailNorm = email.toLowerCase().trim();
        const user = await prisma.user.findUnique({ where: { email: emailNorm } });

        if (!user || !user.passwordHash) {
            await argon2.verify(await dummyHash(), password).catch(() => {});
            return res.status(401).json({ error: "Invalid email or password" });
        }

        const validPassword = await argon2.verify(user.passwordHash, password);
        if (!validPassword) {
            return res.status(401).json({ error: "Invalid email or password" });
        }

        // Correct password on an account inside its 30-day window → point to recovery (no session issued).
        if (isPendingDeletion(user)) {
            return res.status(403).json({
                error: recoveryWindowOpen(user) ? "This account is scheduled for deletion. Recover it with a code sent to your email." : "This account has been deleted.",
                code: recoveryWindowOpen(user) ? "ACCOUNT_PENDING_DELETION" : "ACCOUNT_DELETED",
                purgeAt: recoveryWindowOpen(user) ? user.purgeAt : null,
            });
        }

        // Correct password but e-mail not verified: hand back a RESTRICTED session (works only on
        // /auth/* until verified — see enforceEmailVerified) so /verify-email can recover after a
        // refresh, and make sure a code is on its way (cooldown-protected).
        if (!user.emailVerified) {
            const { session, refreshToken } = await createSession(user.id, req, res, { authMethod: "password" });
            const accessToken = signAccessToken(user, session.id);
            const otpResult = await issueVerificationOtp(user).catch((e) => {
                console.error("[Auth] login OTP send failed:", e.message);
                return { sent: false, reason: "email_failed" };
            });
            return res.json({
                emailSent: otpResult.sent === true || otpResult.reason === "cooldown", // cooldown = a code was sent moments ago
                requiresVerification: true,
                code: "EMAIL_NOT_VERIFIED",
                userId: user.id,
                accessToken,
                refreshToken,
                sessionId: session.id,
                user: buildUserResponse(user),
            });
        }

        // Re-check admin status (in case ADMIN_EMAIL was set after registration). Verified accounts only.
        let finalUser = user;
        if (isAdminEmail(emailNorm) && (user.role !== "admin" || user.status !== "approved")) {
            finalUser = await prisma.user.update({
                where: { id: user.id },
                data: { role: "admin", status: "approved" },
            });
        }

        // Create session (reuses this browser's device record; no duplicate on repeat logins)
        const { session, refreshToken } = await createSession(finalUser.id, req, res, { authMethod: "password" });

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
// Refresh tokens are intentionally NOT rotated (page reload / multi-tab / StrictMode races).
// Security comes from: per-session revocation checked on every request, sliding expiry,
// sha256-hashed storage (legacy argon2 hashes are upgraded on first use), deleted-account block.
router.post("/refresh", limits.refresh, async (req, res) => {
    try {
        const { refreshToken, sessionId } = req.body || {};

        if (!refreshToken || !sessionId || typeof sessionId !== "string") {
            return res.status(400).json({ error: "refreshToken and sessionId required" });
        }

        const session = await prisma.session.findUnique({
            where: { id: sessionId },
            include: { user: true },
        });

        const now = new Date();
        if (!session || !session.isActive) {
            return res.status(401).json({ error: "Session invalid or revoked", code: "SESSION_REVOKED" });
        }
        if (!isSessionLive(session, now)) {
            // expired, or unused for 30 days → only THIS session is signed out; the account is untouched
            await revokeSessions({ id: session.id }, session.expiresAt && session.expiresAt <= now ? "expired" : "inactive");
            return res.status(401).json({ error: "Session expired. Please sign in again.", code: "SESSION_REVOKED" });
        }

        const check = await verifyRefreshToken(session.refreshTokenHash, refreshToken);
        if (!check.ok) {
            return res.status(401).json({ error: "Invalid refresh token" });
        }

        const user = session.user;
        if (isPendingDeletion(user)) {
            await revokeSessions({ id: session.id }, "account_deleted");
            return res.status(401).json({ error: "Account deleted", code: "ACCOUNT_DELETED" });
        }

        // Sliding expiry; upgrade legacy hash; attach legacy (device-less) sessions to this client's device.
        const data = { lastSeenAt: now, expiresAt: refreshTokenExpiresAt() };
        if (check.upgradedHash) data.refreshTokenHash = check.upgradedHash;
        if (!session.deviceId) {
            const { device } = await resolveDevice(user.id, req, res);
            data.deviceId = device.id;
        }
        await prisma.session.update({ where: { id: sessionId }, data });

        const accessToken = signAccessToken(user, sessionId);

        res.json({
            accessToken,
            refreshToken, // same token returned (not rotated)
            user: buildUserResponse(user),
        });
    } catch (err) {
        console.error("[Auth] Refresh error:", err);
        res.status(500).json({ error: "Token refresh failed" });
    }
});

// ─── POST /auth/logout ────────────────────────────────────────────────────────
// Logs out the session that made the request (taken from the verified JWT, not from the body).
router.post("/logout", authenticateJWT, async (req, res) => {
    try {
        await revokeSessions({ id: req.sessionId, userId: req.user.id }, "logout");
        res.clearCookie(STREAM_COOKIE, { path: "/stream" });
        res.json({ message: "Logged out successfully" });
    } catch (err) {
        console.error("[Auth] Logout error:", err);
        res.status(500).json({ error: "Logout failed" });
    }
});

// ─── POST /auth/recover/request ───────────────────────────────────────────────
// Account inside its 30-day deletion window → email a one-time code to the ORIGINAL address.
// Always answers the same way (no account enumeration); 60 s cooldown per account.
router.post("/recover/request", limits.recover, async (req, res) => {
    const generic = { message: "If that email belongs to an account scheduled for deletion, a recovery code has been sent." };
    try {
        const email = String(req.body?.email || "")
            .toLowerCase()
            .trim();
        if (!email) return res.status(400).json({ error: "email is required" });

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !recoveryWindowOpen(user)) return res.json(generic);

        const last = await prisma.oTP.findFirst({ where: { userId: user.id, purpose: "recover" }, orderBy: { createdAt: "desc" } });
        if (last && Date.now() - last.createdAt.getTime() < RECOVERY_REQUEST_COOLDOWN_MS) return res.json(generic);

        await prisma.oTP.updateMany({ where: { userId: user.id, used: false, purpose: "recover" }, data: { used: true } });
        const { code, expiresAt } = generateOTP();
        const codeHash = await hashOTP(code);
        await prisma.oTP.create({ data: { userId: user.id, codeHash, expiresAt, purpose: "recover" } });
        await sendOTPEmail(user.email, user.name, code);

        res.json(generic);
    } catch (err) {
        console.error("[Auth] Recover request error:", err);
        res.status(500).json({ error: "Failed to start recovery" });
    }
});

// ─── POST /auth/recover/confirm ───────────────────────────────────────────────
// Verifies the emailed code, restores the original account + retained data, issues FRESH
// credentials. Old sessions/permissions never come back (see recoverAccount in utils/userStore.js).
router.post("/recover/confirm", limits.recover, async (req, res) => {
    try {
        const email = String(req.body?.email || "")
            .toLowerCase()
            .trim();
        const code = req.body?.code;
        if (!email || !code) return res.status(400).json({ error: "email and code are required" });

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !isPendingDeletion(user)) return res.status(400).json({ error: "Invalid or expired recovery code" });
        if (!recoveryWindowOpen(user)) {
            return res.status(410).json({ error: "The recovery period for this account has ended.", code: "RECOVERY_EXPIRED" });
        }

        const otp = await prisma.oTP.findFirst({ where: { userId: user.id, used: false, purpose: "recover" }, orderBy: { createdAt: "desc" } });
        if (!otp || new Date() > otp.expiresAt) return res.status(400).json({ error: "Invalid or expired recovery code" });

        const check = await checkOtp(otp, code);
        if (!check.ok) {
            if (check.locked) return res.status(429).json({ error: "Too many wrong codes. Request a new code.", code: "OTP_LOCKED" });
            return res.status(400).json({ error: "Invalid or expired recovery code" });
        }

        // claim the code first so a double-submit can only recover once
        const claimed = await prisma.oTP.updateMany({ where: { id: otp.id, used: false }, data: { used: true } });
        if (claimed.count === 0) return res.status(409).json({ error: "This code was already used" });

        const restored = await recoverAccount(user.id, { isAdminEmail: isAdminEmail(email) });
        if (!restored) {
            return res.status(410).json({ error: "The recovery period for this account has ended or it was already recovered.", code: "RECOVERY_EXPIRED" });
        }

        const { session, refreshToken } = await createSession(restored.id, req, res, { authMethod: "recovery" });
        const accessToken = signAccessToken(restored, session.id);

        notificationService
            .notify({
                userIds: [restored.id],
                type: notificationService.TYPES.SECURITY,
                title: "Account recovery completed",
                body: "Your account was restored. An administrator may need to approve it again before you can watch.",
                meta: { event: "account_recovered" },
            })
            .catch(() => {});
        if (restored.status === "pending") {
            notificationService
                .notifyAdmins({
                    type: notificationService.TYPES.SIGNUP_PENDING,
                    title: "Recovered account awaiting approval",
                    body: "A recovered account is waiting for approval.",
                    meta: { userId: restored.id, reason: "recovered" },
                    dedupeKey: `recovered:${restored.id}`,
                    dedupeWindowMs: 24 * 60 * 60 * 1000,
                })
                .catch(() => {});
        }

        res.json({ accessToken, refreshToken, sessionId: session.id, user: buildUserResponse(restored) });
    } catch (err) {
        console.error("[Auth] Recover confirm error:", err);
        res.status(500).json({ error: "Account recovery failed" });
    }
});

// ─── POST /auth/request-approval ──────────────────────────────────────────────
// A REJECTED user asks again: status rejected → pending automatically and the admins are notified.
// Anything else changes nothing and tells nobody:
//   blocked  → looks like "pending" to the user (never revealed); a re-request must NOT ping the admins
//   pending / approved → already in that state
router.post("/request-approval", authenticateJWT, requireVerifiedEmail, limits.requestApproval, async (req, res) => {
    try {
        const moved = await prisma.user.updateMany({
            where: { id: req.user.id, status: "rejected", deletedAt: null },
            data: { status: "pending" },
        });
        const user = await prisma.user.findUnique({ where: { id: req.user.id } });
        if (!user || isPendingDeletion(user)) return res.status(401).json({ error: "Account not found" });

        if (moved.count === 1) {
            try {
                require("../services/playbackRevocation").syncPlaybackAccess(user);
            } catch {}
            notificationService
                .notifyAdmins({
                    type: notificationService.TYPES.SIGNUP_PENDING,
                    title: "Approval requested again",
                    body: "A rejected user is asking for approval again.", // no name/email: push text can reach a lock screen
                    meta: { userId: user.id, reason: "re_request" },
                    dedupeKey: `rerequest:${user.id}`,
                    dedupeWindowMs: 10 * 60 * 1000,
                })
                .catch(() => {});
        }
        return res.json({ requested: moved.count === 1, user: buildUserResponse(user) });
    } catch (err) {
        console.error("[Auth] request-approval error:", err);
        return res.status(500).json({ error: "Could not send your request" });
    }
});

// ─── GET /auth/me ─────────────────────────────────────────────────────────────
router.get("/me", authenticateJWT, async (req, res) => {
    res.json({ user: buildUserResponse(req.user) });
});

// ─── PATCH /auth/me ───────────────────────────────────────────────────────────
router.patch("/me", authenticateJWT, requireVerifiedEmail, async (req, res) => {
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
            if (typeof password !== "string" || password.length < 8 || password.length > MAX_PASSWORD_LEN) {
                return res.status(400).json({ error: `Password must be 8-${MAX_PASSWORD_LEN} characters` });
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
        if (data.passwordHash) {
            // A password change signs out every OTHER device (a stolen session must not survive it).
            await revokeSessions({ userId: user.id, id: { not: req.sessionId } }, "password_changed").catch(() => {});
            notificationService
                .notify({
                    userIds: [user.id],
                    type: notificationService.TYPES.SECURITY,
                    title: "Your password was changed",
                    body: "If this wasn't you, log out your other devices in Settings.",
                    meta: { event: "password_changed" },
                })
                .catch(() => {});
        }
        res.json({ user: buildUserResponse(user) });
    } catch (err) {
        if (err.code === "P2002") return res.status(409).json({ error: "Username already taken" });
        console.error("[Auth] PATCH /me error:", err);
        res.status(500).json({ error: "Failed to update profile" });
    }
});

// ─── GET /auth/showcase ───────────────────────────────────────────────────────
// Public, tiny: random RECENT { poster, type } pairs fetched from TMDB (not from your library) for the poster wall on
// the sign-in screens. No titles / ids. Restricted content is never included — see services/showcaseService.js.
router.get("/showcase", limits.showcase, async (req, res) => {
    try {
        const { posters, reason } = await getShowcase(req.query.n);
        // never let a browser keep an EMPTY answer (e.g. from before TMDB answered)
        res.set("Cache-Control", posters.length ? "public, max-age=60" : "no-store");
        res.json(posters.length ? { posters } : { posters, reason });
    } catch (err) {
        console.warn("[Showcase] request failed:", err.message);
        res.set("Cache-Control", "no-store").json({ posters: [], reason: "error" });
    }
});

// Build the poster pool in the background at server start so the first visitor does not wait for TMDB.
setTimeout(() => warmShowcase(), 1500).unref?.();

// ─── POST /auth/forgot-password ───────────────────────────────────────────────
// Emails a 6-digit reset code. ALWAYS answers the same way (no account enumeration); 60 s cooldown and
// 5 codes / hour per account. Works for password AND Google-only accounts (the latter can then set a password).
router.post("/forgot-password", ...limits.forgot, async (req, res) => {
    const generic = { message: "If an account exists for that email, a reset code is on its way.", cooldownSec: OTP_RESEND_COOLDOWN_MS / 1000 };
    try {
        const email = String(req.body?.email || "").toLowerCase().trim();
        if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: "Enter a valid email address" });

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || isPendingDeletion(user) || user.status === "deleted") {
            await dummyHash(); // comparable work whether or not the account exists
            return res.json(generic);
        }

        const recent = await prisma.oTP.findMany({
            where: { userId: user.id, purpose: "reset", createdAt: { gt: new Date(Date.now() - 60 * MIN) } },
            orderBy: { createdAt: "desc" },
            select: { createdAt: true },
        });
        if (recent[0] && Date.now() - recent[0].createdAt.getTime() < OTP_RESEND_COOLDOWN_MS) return res.json(generic);
        if (recent.length >= OTP_RESENDS_PER_HOUR) return res.json(generic);

        await prisma.oTP.updateMany({ where: { userId: user.id, used: false, purpose: "reset" }, data: { used: true } });
        const { code, expiresAt } = generateOTP();
        const codeHash = await hashOTP(code);
        const created = await prisma.oTP.create({ data: { userId: user.id, codeHash, expiresAt, purpose: "reset" } });
        const mail = await sendOTPEmail(user.email, user.name, code);
        // Delivery failed (see the server log): drop the code so a retry is not blocked. The answer stays
        // identical either way — telling the caller would reveal that the account exists.
        if (!mail?.success) await prisma.oTP.delete({ where: { id: created.id } }).catch(() => {});

        res.json(generic);
    } catch (err) {
        console.error("[Auth] Forgot password error:", err);
        res.status(500).json({ error: "Couldn't start the password reset" });
    }
});

// ─── POST /auth/reset-password ────────────────────────────────────────────────
// Body: { email, code, password }. On success: new password saved, e-mail marked verified (the code
// proved the mailbox), EVERY session / stream token of the account revoked. No auto sign-in — the user
// signs in again with the new password.
router.post("/reset-password", ...limits.reset, async (req, res) => {
    const invalid = { error: "That code is invalid or has expired. Request a new one.", code: "RESET_CODE_INVALID" };
    try {
        const email = String(req.body?.email || "").toLowerCase().trim();
        const code = String(req.body?.code ?? "").trim();
        const password = req.body?.password;
        if (!email || !/^\d{6}$/.test(code)) return res.status(400).json({ error: "Enter the 6-digit code", code: "RESET_CODE_FORMAT" });
        if (typeof password !== "string" || password.length < 8 || password.length > MAX_PASSWORD_LEN) {
            return res.status(400).json({ error: `Password must be 8-${MAX_PASSWORD_LEN} characters`, code: "PASSWORD_INVALID" });
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || isPendingDeletion(user) || user.status === "deleted") {
            await dummyHash();
            return res.status(400).json(invalid);
        }

        const otp = await prisma.oTP.findFirst({ where: { userId: user.id, used: false, purpose: "reset" }, orderBy: { createdAt: "desc" } });
        if (!otp || new Date() > otp.expiresAt) return res.status(400).json(invalid);

        // wrong guesses are budgeted across every reset code issued recently (a new request is not a free reset)
        const windowRows = await prisma.oTP.findMany({
            where: { userId: user.id, purpose: "reset", createdAt: { gt: new Date(Date.now() - OTP_WINDOW_MS) } },
            select: { attempts: true },
        });
        if (windowRows.reduce((n, r) => n + r.attempts, 0) >= OTP_WINDOW_MAX_ATTEMPTS) {
            return res.status(429).json({ error: "Too many wrong codes. Try again in a few minutes.", code: "OTP_LOCKED" });
        }

        const check = await checkOtp(otp, code);
        if (!check.ok) {
            if (check.locked) return res.status(429).json({ error: "Too many wrong codes. Request a new code.", code: "OTP_LOCKED" });
            return res.status(400).json(invalid);
        }

        const claimed = await prisma.oTP.updateMany({ where: { id: otp.id, used: false }, data: { used: true } });
        if (claimed.count === 0) return res.status(409).json({ error: "This code was already used", code: "RESET_CODE_USED" });

        const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 2 ** 16, timeCost: 3, parallelism: 1 });
        const wasVerified = user.emailVerified;
        const updated = await prisma.user.update({ where: { id: user.id }, data: { passwordHash, emailVerified: true } });
        clearVerifiedCache(user.id);

        // Anyone holding an old session (including whoever knew the old password) is signed out everywhere.
        await revokeSessions({ userId: user.id }, "password_reset");
        await prisma.streamToken.deleteMany({ where: { userId: user.id } }).catch(() => {});
        await prisma.oTP.updateMany({ where: { userId: user.id, used: false, purpose: "reset" }, data: { used: true } });

        if (!wasVerified) notifyPendingVerified(updated);

        res.json({ message: "Password updated. Sign in with your new password." });
    } catch (err) {
        console.error("[Auth] Reset password error:", err);
        res.status(500).json({ error: "Couldn't reset the password" });
    }
});

// ─── GET /auth/google ─────────────────────────────────────────────────────────
router.get("/google", (req, res) => {
    if (!isGoogleEnabled()) {
        return res.status(501).json({ error: "Google OAuth is not configured on this server" });
    }
    // CSRF protection: random state, remembered in a short-lived HttpOnly cookie, verified in the callback.
    const state = crypto.randomBytes(24).toString("base64url");
    const secure = !!(req.secure || String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https");
    res.cookie(OAUTH_STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", secure, path: "/auth", maxAge: 10 * 60 * 1000 });
    res.redirect(getAuthUrl(state));
});

// ─── GET /auth/google/callback ────────────────────────────────────────────────
router.get("/google/callback", async (req, res) => {
    const FRONTEND_URL = process.env.ALLOWED_ORIGINS?.split(",")[0]?.trim() || "http://localhost:5173";

    try {
        if (!isGoogleEnabled()) {
            return res.redirect(`${FRONTEND_URL}/login?error=oauth_disabled`);
        }

        const { code, state } = req.query;
        const expected = readCookie(req, OAUTH_STATE_COOKIE);
        res.clearCookie(OAUTH_STATE_COOKIE, { path: "/auth" });
        const a = Buffer.from(String(state || ""));
        const b = Buffer.from(String(expected || ""));
        if (!expected || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
            return res.redirect(`${FRONTEND_URL}/login?error=oauth_state`);
        }
        if (!code || typeof code !== "string") {
            return res.redirect(`${FRONTEND_URL}/login?error=oauth_failed`);
        }

        const { googleId, email, name, avatar, emailVerified } = await exchangeCode(code);
        if (emailVerified !== true) {  // only a Google-verified e-mail may sign in / link
            return res.redirect(`${FRONTEND_URL}/login?error=oauth_failed`);
        }
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

            if (!isAdmin) {
                notificationService
                    .notifyAdmins({
                        type: notificationService.TYPES.SIGNUP_PENDING,
                        title: "New signup awaiting approval",
                        body: "A new user is waiting for approval.",
                        meta: { userId: user.id },
                        dedupeKey: `signup:${user.id}`,
                        dedupeWindowMs: 7 * 24 * 60 * 60 * 1000,
                    })
                    .catch(() => {});

                notificationService
                    .notify({
                        userIds: [user.id],
                        type: notificationService.TYPES.ACCOUNT,
                        title: "Your registration is waiting for approval",
                        body: "An administrator will review your account. We'll notify you when it's approved.",
                        meta: { event: "awaiting_approval", status: "pending", statusChanged: true },
                        dedupeKey: `awaiting:${user.id}`,
                        dedupeWindowMs: 7 * 24 * 60 * 60 * 1000,
                    })
                    .catch(() => {});
            }
        } else if (isPendingDeletion(user)) {
            // Google proved ownership of this email → recover inside the window, otherwise refuse.
            if (!recoveryWindowOpen(user) || emailVerified !== true) {
                return res.redirect(`${FRONTEND_URL}/login?error=account_deleted`);
            }
            const restored = await recoverAccount(user.id, { isAdminEmail: isAdmin });
            if (!restored) return res.redirect(`${FRONTEND_URL}/login?error=account_deleted`);
            user = await prisma.user.update({ where: { id: restored.id }, data: { googleId, avarter: avatar || restored.avarter } });
            if (user.status === "pending") {
                notificationService
                    .notifyAdmins({
                        type: notificationService.TYPES.SIGNUP_PENDING,
                        title: "Recovered account awaiting approval",
                        body: "A recovered account is waiting for approval.",
                        meta: { userId: user.id, reason: "recovered" },
                        dedupeKey: `recovered:${user.id}`,
                        dedupeWindowMs: 24 * 60 * 60 * 1000,
                    })
                    .catch(() => {});
            }
            notificationService
                .notify({ userIds: [user.id], type: notificationService.TYPES.SECURITY, title: "Account recovery completed", body: "Your account was restored.", meta: { event: "account_recovered" } })
                .catch(() => {});
        } else {
            // Link Google ID if account existed via email
            const updates = { googleId, avarter: avatar || user.avarter };
            if (!user.emailVerified) {
                // Google just proved ownership of this address. A password on a never-verified account
                // was set by whoever registered first (pre-hijack), so drop it and mark verified.
                updates.emailVerified = true;
                updates.passwordHash = null;
            }
            if (isAdmin) {
                updates.role = "admin";
                updates.status = "approved";
            }
            user = await prisma.user.update({ where: { id: user.id }, data: updates });
        }

        const { session, refreshToken } = await createSession(user.id, req, res, { authMethod: "google" });
        const accessToken = signAccessToken(user, session.id);

        // Tokens never travel in a URL (history / referrer / proxy logs). The browser gets a
        // single-use code (60 s) and trades it via POST /auth/oauth/exchange.
        const oneTimeCode = crypto.randomBytes(32).toString("base64url");
        oauthExchange.set(oneTimeCode, { exp: Date.now() + 60 * 1000, payload: { accessToken, refreshToken, sessionId: session.id, user: buildUserResponse(user) } });
        res.redirect(`${FRONTEND_URL}/auth/callback?code=${encodeURIComponent(oneTimeCode)}`);
    } catch (err) {
        console.error("[Auth] Google callback error:", err);
        res.redirect(`${FRONTEND_URL}/login?error=oauth_failed`);
    }
});

// ─── POST /auth/oauth/exchange ────────────────────────────────────────────────
// Trades the single-use code from the Google redirect for the session tokens.
router.post("/oauth/exchange", limits.oauthExchange, (req, res) => {
    const code = typeof req.body?.code === "string" ? req.body.code : "";
    const hit = oauthExchange.get(code);
    oauthExchange.delete(code); // single use, even on failure paths below
    if (!hit || hit.exp <= Date.now()) return res.status(400).json({ error: "Sign-in link expired. Please try again.", code: "OAUTH_CODE_INVALID" });
    res.json(hit.payload);
});

module.exports = router;
