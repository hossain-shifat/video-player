"use strict";
require("dotenv").config();

const crypto = require("crypto");

let resendClient = null;

function getResendClient() {
    if (resendClient) return resendClient;
    if (!process.env.RESEND_API_KEY) return null;
    try {
        const { Resend } = require("resend");
        resendClient = new Resend(process.env.RESEND_API_KEY);
        return resendClient;
    } catch {
        return null;
    }
}

const FROM_ADDRESS = process.env.SMTP_FROM || process.env.RESEND_FROM || "FLUX <onboarding@resend.dev>";

// ── Optional SMTP (e.g. Gmail app password, your ISP, Mailgun…) ────────────────
// Set SMTP_HOST (+ SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE, SMTP_FROM) and run `npm i nodemailer`.
// SMTP wins over Resend when configured. Needed if you have no domain to verify with Resend:
// Resend's shared sender (onboarding@resend.dev) ONLY delivers to the e-mail of your own Resend account.
let smtpTransport = null;
function getSmtp() {
    if (!process.env.SMTP_HOST) return null;
    if (smtpTransport) return smtpTransport;
    try {
        const nodemailer = require("nodemailer");
        const port = Number(process.env.SMTP_PORT || 587);
        smtpTransport = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port,
            secure: String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || port === 465,
            auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
        });
        return smtpTransport;
    } catch {
        console.error("[Email] SMTP_HOST is set but the 'nodemailer' package is not installed — run `npm i nodemailer` in /server.");
        return null;
    }
}

let _warnedSandbox = false;

/**
 * Single delivery path for every mail FLUX sends. Returns { success, id?, error?, fallback? }.
 * IMPORTANT: Resend's SDK (v2+) does NOT throw when the API rejects a message — it resolves with
 * { data: null, error }. That used to be logged as "sent" while nothing was delivered.
 */
async function deliver({ to, subject, html, text }) {
    const smtp = getSmtp();
    if (smtp) {
        try {
            const info = await smtp.sendMail({ from: FROM_ADDRESS, to, subject, html, text });
            console.log(`[Email] SMTP accepted mail for ${to} — id: ${info?.messageId}`);
            return { success: true, id: info?.messageId };
        } catch (err) {
            console.error(`[Email] SMTP send to ${to} failed:`, err?.message);
            return { success: false, error: err?.message || "SMTP error" };
        }
    }

    const client = getResendClient();
    if (!client) return { success: true, fallback: true };

    if (!_warnedSandbox && /@resend\.dev>?$/i.test(FROM_ADDRESS)) {
        _warnedSandbox = true;
        console.warn(
            "[Email] ⚠ Sending from Resend's shared test address (onboarding@resend.dev). Resend only delivers it to the e-mail of YOUR OWN Resend account — " +
                'everybody else gets nothing. Verify a domain at resend.com/domains and set RESEND_FROM="FLUX <noreply@your-domain>", or configure SMTP_* instead.',
        );
    }

    try {
        const res = await client.emails.send({ from: FROM_ADDRESS, to, subject, html, text });
        if (res?.error) {
            const msg = res.error.message || res.error.name || "Resend rejected the message";
            console.error(`[Email] Resend REJECTED mail to ${to}: ${msg}`);
            return { success: false, error: msg, code: res.error.name };
        }
        const id = res?.data?.id ?? res?.id;
        console.log(`[Email] Resend accepted mail for ${to} — id: ${id}`);
        return { success: true, id };
    } catch (err) {
        console.error(`[Email] Send to ${to} failed:`, err?.message);
        return { success: false, error: err?.message || "Unknown email error" };
    }
}

// ── Design tokens (match the FLUX e-mail mockups) ──────────────────────────────
const T = {
    page: "#0b0c10",
    card: "#13151c",
    panel: "#1c1e27",
    inset: "#0f1015",
    line: "#2a2d39",
    text: "#ffffff",
    muted: "#a7abb8",
    dim: "#8b8f9d",
    red: "#e11d3f",
    green: "#4ade80",
    greenBg: "#12261b",
    greenLine: "#1f4d33",
    sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
    mono: "'IBM Plex Mono', 'SF Mono', 'Cascadia Code', Consolas, 'Courier New', monospace",
};

// ── Small helpers ──────────────────────────────────────────────────────────────
const esc = (v) =>
    String(v ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

function appUrl() {
    const raw = process.env.APP_URL || process.env.ALLOWED_ORIGINS?.split(",")[0]?.trim() || "http://localhost:5173";
    return raw.replace(/\/+$/, "");
}

const supportMail = () => (process.env.SUPPORT_EMAIL || "").trim();
const tz = () => process.env.EMAIL_TIMEZONE || undefined; // e.g. "Asia/Dhaka"; default = server time zone

function fmtDate(d) {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: tz() }).format(d);
}
function fmtTime(d) {
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz() }).format(d);
}
function fmtTodayTime(d) {
    return `Today, ${fmtTime(d)}`;
}
function numRef(seed, digits) {
    const n = parseInt(crypto.createHash("sha1").update(String(seed)).digest("hex").slice(0, 8), 16);
    return String(n % 10 ** digits).padStart(digits, "0");
}

// ── Shared layout ──────────────────────────────────────────────────────────────
function htmlBase(preheader, bodyContent) {
    return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>FLUX</title>
  <style>
    body { margin:0; padding:0; background:${T.page}; -webkit-text-size-adjust:100%; }
    table { border-spacing:0; border-collapse:separate; }
    td { padding:0; }
    a { color:inherit; }
    .m-only { display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:0; line-height:0; }
    @media only screen and (max-width: 620px) {
      .wrap { padding: 0 !important; }
      .card { width: 100% !important; max-width: 100% !important; border-radius: 0 !important; border-left: 0 !important; border-right: 0 !important; }
      .pad { padding-left: 14px !important; padding-right: 14px !important; }
      .padt { padding-top: 22px !important; }
      .h1 { font-size: 25px !important; margin: 16px 0 8px !important; }
      .lead { font-size: 15px !important; line-height: 1.55 !important; margin-bottom: 18px !important; }
      .ip { padding: 14px !important; }
      .tp { padding: 14px 6px 18px !important; }
      .tile { height: 52px !important; font-size: 25px !important; line-height: 52px !important; border-radius: 10px !important; }
      .tdash { width: 5% !important; }
      .sp { padding: 12px 14px !important; }
      .stack { display: block !important; width: 100% !important; box-sizing: border-box !important; }
      .stack-gap { padding: 0 0 8px 0 !important; }
      .d-only { display: none !important; max-height: 0 !important; overflow: hidden !important; }
      .m-only { display: block !important; max-height: none !important; overflow: visible !important; font-size: 16px !important; line-height: 1.4 !important; }
      .step { padding: 12px 14px !important; }
      .ticket-left { border-right: 0 !important; border-bottom: 1px dashed ${T.line} !important; padding: 18px 14px !important; }
      .ticket-right { padding: 14px 14px 0 !important; }
      .avatar { width: 64px !important; height: 64px !important; line-height: 64px !important; font-size: 28px !important; border-radius: 32px !important; }
      .feat { padding: 12px 14px !important; }
      .ficon { width: 40px !important; height: 40px !important; line-height: 40px !important; font-size: 17px !important; }
      .hide-m { display: none !important; }
      .foot-r { text-align: left !important; padding-top: 8px !important; }
      .btn { display: block !important; width: 100% !important; box-sizing: border-box !important; text-align: center !important; }
      .btn-gap { display: block !important; height: 10px !important; width: 100% !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:${T.page};font-family:${T.sans};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${T.page};">${esc(preheader)}</div>
  ${bodyContent}
</body>
</html>`;
}

function logo() {
    return `<span style="font-family:'IBM Plex Sans',${T.sans};font-weight:900;color:${T.red};line-height:1;letter-spacing:-0.5px;white-space:nowrap;"><span style="font-size:34px;">F</span><span style="font-size:25px;">LU</span><span style="font-size:34px;">X</span></span>`;
}

function footer() {
    const base = appUrl();
    const mail = supportMail();
    const help = mail ? ` &middot; <a href="mailto:${esc(mail)}" style="color:#d6d8e0;text-decoration:none;">Help</a>` : "";
    return `
    <tr>
      <td class="pad" style="padding:22px 24px 26px;border-top:1px solid ${T.line};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td class="stack" valign="top" style="font-size:14px;line-height:1.6;color:${T.dim};">
              This is an automated message from your FLUX media server.<br>Do not reply to this email.
            </td>
            <td class="stack foot-r" valign="top" align="right" style="font-size:14px;line-height:1.6;color:${T.dim};text-align:right;">
              FLUX &middot; Self-hosted media<br>
              <a href="${esc(base)}" style="color:#d6d8e0;text-decoration:none;">Open FLUX</a>${help}
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

/** Outer shell: page bg → 600px card → header (logo + chip) → body rows → footer. */
function shell({ preheader, chip, rows }) {
    const body = `
  <table role="presentation" class="wrap" width="100%" cellpadding="0" cellspacing="0" style="background:${T.page};padding:16px 8px;">
    <tr>
      <td align="center">
        <table role="presentation" class="card" width="600" cellpadding="0" cellspacing="0"
               style="width:100%;max-width:600px;background:${T.card};border:1px solid ${T.line};border-radius:22px;overflow:hidden;">
          <tr>
            <td class="pad" style="padding:22px 24px;border-bottom:1px solid ${T.line};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td valign="middle">${logo()}</td>
                  <td valign="middle" align="right">
                    <span style="display:inline-block;padding:7px 14px;border:1px solid ${T.line};border-radius:9px;background:${T.inset};font-family:${T.mono};font-size:15px;font-weight:600;letter-spacing:0.5px;color:#c4c7d2;">${esc(chip)}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          ${rows}
          ${footer()}
        </table>
      </td>
    </tr>
  </table>`;
    return htmlBase(preheader, body);
}

/** Small bordered icon square + label (top of each mail). */
function eyebrow(icon, label, { color = T.muted, bg = T.panel, line = T.line } = {}) {
    return `
    <table role="presentation" cellpadding="0" cellspacing="0">
      <tr>
        <td width="50" height="50" align="center" valign="middle" style="width:50px;height:50px;background:${bg};border:1px solid ${line};border-radius:12px;font-size:21px;line-height:50px;color:${color};">${icon}</td>
        <td valign="middle" style="padding-left:16px;font-size:17px;color:${color};">${esc(label)}</td>
      </tr>
    </table>`;
}

const panel = (inner, extra = "") => `background:${T.panel};border:1px solid ${T.line};border-radius:16px;${extra}`;

// ── OTP e-mail ─────────────────────────────────────────────────────────────────
const OTP_MINUTES = 10; // keep in sync with OTP_EXPIRY_MS in otpService.js

function renderOTPEmail(userName, otpCode, userEmail) {
    const code = String(otpCode).padStart(6, "0");
    const d = code.split("");
    const now = new Date();
    const until = new Date(now.getTime() + OTP_MINUTES * 60 * 1000);
    const ref = `REQ-${String(crypto.randomInt(0, 1e6)).padStart(6, "0")}`;
    const name = esc(userName || "there");
    const email = esc(userEmail || "");

    const tile = (c) =>
        `<td class="tile" width="14%" height="72" align="center" valign="middle" style="width:14%;height:72px;background:${T.inset};border:1px solid ${T.line};border-radius:12px;font-family:${T.sans};font-size:34px;font-weight:700;color:#ffffff;line-height:72px;">${esc(c)}</td>`;
    const gap = `<td width="2%" style="width:2%;font-size:0;line-height:0;">&nbsp;</td>`;

    const tiles = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:420px;margin:0 auto;">
      <tr>
        ${tile(d[0])}${gap}${tile(d[1])}${gap}${tile(d[2])}
        <td class="tdash" width="6%" align="center" valign="middle" style="width:6%;"><span style="display:inline-block;width:10px;height:2px;background:#3a3e4c;font-size:0;line-height:0;">&nbsp;</span></td>
        ${tile(d[3])}${gap}${tile(d[4])}${gap}${tile(d[5])}
      </tr>
    </table>`;

    const statInner = (label, value) => `
        <div style="font-size:13px;color:${T.dim};margin-bottom:4px;">${label}</div>
        <div style="font-size:16px;font-weight:700;color:#ffffff;word-break:break-all;">${value}</div>`;

    const codeCard = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${panel()}">
      <tr>
        <td class="ip" style="padding:22px 24px 6px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td valign="middle" style="font-size:16px;color:${T.muted};">Your one-time code</td>
              <td valign="middle" align="right">
                <span style="display:inline-block;padding:8px 14px;background:${T.inset};border:1px solid ${T.line};border-radius:10px;font-size:15px;font-weight:600;color:#ffffff;">&#128339;&nbsp; Expires in ${OTP_MINUTES} min</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr><td class="tp" style="padding:20px 14px 28px;">${tiles}</td></tr>
      <tr><td style="border-top:1px dashed ${T.line};font-size:0;line-height:0;height:1px;">&nbsp;</td></tr>
      <tr>
        <td>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td class="sp" style="padding:16px 22px;border-bottom:1px solid ${T.line};">${statInner("Account", email)}</td></tr>
            <tr>
              <td>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td class="sp" width="50%" valign="top" style="padding:14px 22px;border-right:1px solid ${T.line};">${statInner("Requested", esc(fmtTodayTime(now)))}</td>
                    <td class="sp" width="50%" valign="top" style="padding:14px 22px;">${statInner("Valid until", esc(fmtTime(until)))}</td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>`;

    const step = (n, title, sub, last = false) => `
      <td class="stack ${last ? "" : "stack-gap"}" width="33%" valign="top" style="${last ? "" : "padding-right:12px;"}">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${panel()}">
          <tr><td class="step" style="padding:18px 18px 16px;">
            <div class="d-only">
              <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                <td width="36" height="36" align="center" valign="middle" style="width:36px;height:36px;background:${T.red};border-radius:18px;color:#ffffff;font-size:15px;font-weight:700;line-height:36px;">${n}</td>
              </tr></table>
              <div style="font-size:18px;font-weight:700;color:#ffffff;margin-top:14px;">${title}</div>
              <div style="font-size:15px;color:${T.muted};margin-top:4px;line-height:1.45;">${sub}</div>
            </div>
            <div class="m-only">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                <td width="32" valign="middle" style="width:32px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="28" height="28" align="center" valign="middle" style="width:28px;height:28px;background:${T.red};border-radius:14px;color:#ffffff;font-size:13px;font-weight:700;line-height:28px;">${n}</td></tr></table></td>
                <td valign="middle" style="padding-left:10px;"><div style="font-size:16px;font-weight:700;color:#ffffff;line-height:1.3;">${title}</div><div style="font-size:14px;color:${T.muted};line-height:1.4;">${sub}</div></td>
              </tr></table>
            </div>
          </td></tr>
        </table>
      </td>`;

    const tick = (t) => `
      <tr>
        <td width="26" valign="top" style="font-size:16px;color:${T.muted};padding:6px 0;">&#10003;</td>
        <td valign="top" style="font-size:16px;color:#d6d8e0;padding:6px 0;line-height:1.45;">${t}</td>
      </tr>`;

    const mail = supportMail();
    const report = mail
        ? `<a href="mailto:${esc(mail)}?subject=${encodeURIComponent("Unrequested FLUX code " + ref)}" style="color:${T.red};font-weight:700;text-decoration:none;">Wasn&rsquo;t you? Report this request</a>`
        : `<span style="color:${T.red};font-weight:700;">Wasn&rsquo;t you? Just ignore this email.</span>`;

    const rows = `
          <tr>
            <td class="pad padt" style="padding:36px 24px 8px;">
              ${eyebrow("&#128274;", "Email verification")}
              <h1 class="h1" style="margin:26px 0 14px;font-size:34px;line-height:1.15;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">Verify your email address</h1>
              <p class="lead" style="margin:0 0 28px;font-size:17px;line-height:1.6;color:${T.muted};">Hi <strong style="color:#ffffff;">${name}</strong>, enter this code in FLUX to verify <strong style="color:#ffffff;">${email}</strong> and finish signing in.</p>
              ${codeCard}
            </td>
          </tr>
          <tr>
            <td class="pad" style="padding:30px 24px 0;">
              <div style="font-size:17px;font-weight:700;color:#ffffff;margin-bottom:14px;">How it works</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  ${step(1, "Open FLUX", "Go to the sign-in screen.")}
                  ${step(2, "Enter the code", "Type all 6 digits.")}
                  ${step(3, "Start watching", "Your account is verified.", true)}
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="pad" style="padding:26px 24px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${panel()}">
                <tr><td class="ip" style="padding:22px 24px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td class="stack hide-m" width="64" valign="top" style="width:64px;padding-bottom:10px;">
                        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                          <td width="50" height="50" align="center" valign="middle" style="width:50px;height:50px;background:${T.card};border:1px solid ${T.line};border-radius:12px;font-size:21px;line-height:50px;color:${T.muted};">&#128737;</td>
                        </tr></table>
                      </td>
                      <td class="stack" valign="top">
                        <div style="font-size:18px;font-weight:700;color:#ffffff;margin-bottom:6px;">Keep this code private</div>
                        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                          ${tick("FLUX will never ask you for it.")}
                          ${tick("It works once, then stops working.")}
                          ${tick("Didn&rsquo;t request it? Ignore this email and the code expires.")}
                        </table>
                        <div style="margin-top:16px;font-size:17px;">${report}</div>
                      </td>
                    </tr>
                  </table>
                </td></tr>
              </table>
            </td>
          </tr>`;

    return shell({ preheader: `Your FLUX code is ${code}. It expires in ${OTP_MINUTES} minutes.`, chip: ref, rows });
}

function otpText(userName, code, userEmail) {
    return `Hi ${userName || "there"},\n\nYour FLUX verification code for ${userEmail} is ${code}.\nIt expires in ${OTP_MINUTES} minutes and works once.\n\nDidn't request it? Ignore this email.\n\n— FLUX`;
}

// ── Approval e-mail ────────────────────────────────────────────────────────────
/**
 * details = { role?, accessType?, accessExpiresAt?, libraries?: string[] }
 * permanent access → "Unlimited" / "No expiry"; temporary → days left + end date.
 */
function renderApprovalEmail(userName, userEmail, details = {}) {
    const now = new Date();
    const name = userName || "there";
    const first = esc(String(name).trim().split(/\s+/)[0] || "there");
    const initial = esc((String(name).trim()[0] || "?").toUpperCase());
    const roleLabel = details.role === "admin" ? "Admin" : "Member";
    const temporary = details.accessType === "temporary" && details.accessExpiresAt;
    const exp = temporary ? new Date(details.accessExpiresAt) : null;
    const days = exp && !isNaN(exp) ? Math.max(1, Math.ceil((exp.getTime() - now.getTime()) / 86400000)) : null;
    const validUntil = days !== null ? fmtDate(exp) : "No expiry";

    // Same label twice (two folders both called "Movies") → show it once.
    const seen = new Set();
    const libs = (Array.isArray(details.libraries) ? details.libraries : []).filter((l) => {
        const k = String(l || "").trim().toLowerCase();
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
    });
    const shown = libs.slice(0, 6);
    const extra = libs.length - shown.length;
    const chip = (t) => `<span style="display:inline-block;margin:0 6px 6px 0;padding:6px 12px;background:${T.inset};border:1px solid ${T.line};border-radius:9px;font-size:14px;color:#ffffff;">${esc(t)}</span>`;
    const libraryChips = shown.length ? shown.map(chip).join("") + (extra > 0 ? chip(`+${extra} more`) : "") : chip("All libraries");

    // Everything below is fluid (percent widths, no fixed-px columns, no stacking tricks) so it looks right
    // on a phone even when the mail app ignores <style> media queries.
    const cell = (label, valueHtml, last = false) => `
      <td width="50%" valign="top" style="padding:0 ${last ? "0" : "8px"} 16px 0;">
        <div style="font-size:13px;color:${T.dim};margin-bottom:4px;">${label}</div>
        ${valueHtml}
      </td>`;
    const small = (v) => `<div style="font-size:16px;font-weight:700;color:#ffffff;line-height:1.3;">${v}</div>`;
    const accessHtml =
        days !== null
            ? `<div style="font-family:${T.mono};font-size:30px;font-weight:600;line-height:1.1;color:#ffffff;">${days}<span style="font-family:${T.sans};font-size:15px;font-weight:600;color:${T.muted};">&nbsp;${days === 1 ? "day" : "days"}</span></div>`
            : `<div style="font-size:20px;font-weight:700;line-height:1.2;color:#ffffff;">Unlimited</div>`;
    const mailLink = userEmail ? `<a href="mailto:${esc(userEmail)}" style="color:${T.muted};text-decoration:none;">${esc(userEmail)}</a>` : "";

    const ticket = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${panel()}">
      <tr>
        <td style="padding:16px;border-bottom:1px dashed ${T.line};">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td width="56" valign="middle" style="width:56px;min-width:56px;">
                <div style="width:52px;min-width:52px;height:52px;background:${T.red};border-radius:26px;color:#ffffff;font-size:22px;font-weight:700;line-height:52px;text-align:center;">${initial}</div>
              </td>
              <td valign="middle" style="padding-left:12px;">
                <div style="font-size:17px;font-weight:700;color:#ffffff;line-height:1.25;overflow-wrap:anywhere;">${esc(name)}</div>
                <div style="margin-top:2px;font-size:13px;color:${T.muted};line-height:1.3;overflow-wrap:anywhere;">${mailLink}</div>
              </td>
              <td valign="middle" align="right" style="padding-left:8px;">
                <span style="display:inline-block;padding:5px 12px;background:${T.inset};border:1px solid ${T.line};border-radius:9px;font-size:13px;color:#ffffff;white-space:nowrap;">${roleLabel}</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 16px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>${cell("Access", accessHtml)}${cell("Valid until", small(esc(validUntil)), true)}</tr>
            <tr>${cell("Approved on", small(esc(fmtDate(now))))}${cell("Approved by", small("Server admin"), true)}</tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:0 16px 10px;">
          <div style="border-top:1px solid ${T.line};padding-top:14px;">
            <div style="font-size:13px;color:${T.dim};margin-bottom:8px;">Libraries</div>
            ${libraryChips}
          </div>
        </td>
      </tr>
    </table>`;

    // One feature per row; the icon box is its own fixed-size table so it can never stretch when the text wraps.
    const feature = (icon, title, sub) => `
        <tr><td style="padding:0 0 8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${panel()}">
            <tr><td style="padding:12px 14px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                <td width="44" valign="top" style="width:44px;">
                  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                    <td width="38" height="38" align="center" valign="middle" style="width:38px;height:38px;background:${T.card};border:1px solid ${T.line};border-radius:10px;font-size:16px;line-height:38px;color:${T.muted};">${icon}</td>
                  </tr></table>
                </td>
                <td valign="middle" style="padding-left:8px;">
                  <div style="font-size:16px;font-weight:700;color:#ffffff;line-height:1.3;">${title}</div>
                  <div style="font-size:14px;color:${T.muted};margin-top:1px;line-height:1.35;">${sub}</div>
                </td>
              </tr></table>
            </td></tr>
          </table>
        </td></tr>`;

    const base = appUrl();
    // Two buttons share the row 50/50 (fluid). Compact type so "Start watching" / "View my account" stay on one line.
    const btn = (href, label, solid, last = false) => `
                <td width="49%" align="center" style="${last ? "" : "padding-right:0;"}background:${solid ? T.red : "transparent"};border:2px solid ${T.red};border-radius:10px;">
                  <a href="${esc(href)}" style="display:block;padding:12px 6px;font-size:15px;font-weight:700;line-height:1.2;color:${solid ? "#ffffff" : T.red};text-decoration:none;white-space:nowrap;">${label}</a>
                </td>`;
    const later = temporary ? `<p style="margin:16px 0 0;font-size:14px;line-height:1.55;color:${T.muted};">Need more time later? Ask your server admin to extend your access.</p>` : "";

    const rows = `
          <tr>
            <td class="pad padt" style="padding:36px 24px 8px;">
              ${eyebrow("&#10003;", "Account approved", { color: T.green, bg: T.greenBg, line: T.greenLine })}
              <h1 class="h1" style="margin:22px 0 10px;font-size:30px;line-height:1.15;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">You&rsquo;re in, ${first}.</h1>
              <p class="lead" style="margin:0 0 22px;font-size:16px;line-height:1.6;color:${T.muted};">An admin approved your account. Your access is active, so you can sign in and start streaming now.</p>
              ${ticket}
            </td>
          </tr>
          <tr>
            <td class="pad" style="padding:24px 24px 0;">
              <div style="font-size:16px;font-weight:700;color:#ffffff;margin-bottom:12px;">What you can do</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${feature("&#9654;", "Resume anywhere", "Pick up right where you stopped.")}
                ${feature("&#128225;", "Live TV", "Channels ready on every screen.")}
                ${feature("A&#25991;", "Subtitles and audio", "Switch tracks while you play.")}
                ${feature("&#128241;", "Every device", "Phone, tablet, laptop and TV.")}
              </table>
            </td>
          </tr>
          <tr>
            <td class="pad" style="padding:16px 24px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                ${btn(base + "/login", "Start watching", true)}
                <td width="2%" style="width:2%;font-size:0;line-height:0;">&nbsp;</td>
                ${btn(base + "/profile", "View my account", false, true)}
              </tr></table>
              ${later}
            </td>
          </tr>`;

    const ref = `PASS-${numRef(userEmail || name, 4)}`;
    return shell({ preheader: "An admin approved your FLUX account. Sign in and start streaming.", chip: ref, rows });
}

function approvalText(userName, details = {}) {
    const exp = details.accessType === "temporary" && details.accessExpiresAt ? ` Access valid until ${fmtDate(new Date(details.accessExpiresAt))}.` : "";
    return `You're in, ${String(userName || "there").split(/\s+/)[0]}.\n\nAn admin approved your FLUX account. Sign in and start streaming: ${appUrl()}/login\n${exp}\n\n— FLUX`;
}

// ── Public API ─────────────────────────────────────────────────────────────────

async function sendOTPEmail(toEmail, userName, otpCode) {
    // No mail provider configured at all → development fallback: print the code in the server console.
    if (!getSmtp() && !getResendClient()) {
        console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log(`[FLUX Email] OTP for ${toEmail}`);
        console.log(`  Name:    ${userName}`);
        console.log(`  Code:    ${otpCode}`);
        console.log(`  Expires: ${OTP_MINUTES} minutes`);
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        return { success: true, fallback: true };
    }

    const code = String(otpCode).padStart(6, "0");
    return deliver({
        to: toEmail,
        subject: `${otpCode} — Your FLUX verification code`,
        html: renderOTPEmail(userName, otpCode, toEmail),
        text: otpText(userName, code, toEmail),
    });
}

async function sendApprovalEmail(toEmail, userName, details = {}) {
    if (!getSmtp() && !getResendClient()) {
        console.log(`[FLUX Email] Account approved: ${toEmail}`);
        return { success: true, fallback: true };
    }
    return deliver({
        to: toEmail,
        subject: "Your FLUX account has been approved",
        html: renderApprovalEmail(userName, toEmail, details),
        text: approvalText(userName, details),
    });
}

/**
 * Convenience wrapper used by BOTH approve paths (admin routes + admin dashboard).
 * Takes a Prisma user row, works out role / access window / library names, then sends the mail.
 * Never throws — returns { success:false } on any problem so approving a user can't fail because of e-mail.
 */
async function notifyApproved(user) {
    try {
        let libraries = [];
        try {
            const { parsePermissions } = require("./permissionService");
            const { readFolders } = require("../../controllers/libraryController");
            const perms = parsePermissions(user.permissionsJson) || {};
            const folders = await readFolders();
            const ids = Array.isArray(perms.libraries) ? perms.libraries : [];
            const chosen = ids.length ? folders.filter((f) => ids.includes(f.id)) : folders;
            libraries = chosen.map((f) => f.label || "").filter(Boolean);
            if (perms.canLiveTV !== false) libraries.push("Live TV");
        } catch {
            libraries = [];
        }
        return await sendApprovalEmail(user.email, user.name, {
            role: user.role,
            accessType: user.accessType,
            accessExpiresAt: user.accessExpiresAt,
            libraries,
        });
    } catch (err) {
        console.error("[Email] notifyApproved failed:", err?.message);
        return { success: false, error: err?.message || "approval mail failed" };
    }
}

module.exports = { sendOTPEmail, sendApprovalEmail, notifyApproved, renderOTPEmail, renderApprovalEmail };
