"use strict";
require("dotenv").config();

const fs = require("fs");
const path = require("path");

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

const FROM_ADDRESS = process.env.RESEND_FROM || "FLUX <onboarding@resend.dev>";

// ── Template loader ────────────────────────────────────────────────────────────
let _templateCache = null;

function loadOTPTemplate() {
    if (_templateCache) return _templateCache;
    const candidates = [path.join(__dirname, "templates", "flux-otp.html"), path.join(__dirname, "..", "templates", "flux-otp.html"), path.join(__dirname, "..", "..", "templates", "flux-otp.html")];
    for (const p of candidates) {
        if (fs.existsSync(p)) {
            _templateCache = fs.readFileSync(p, "utf-8");
            return _templateCache;
        }
    }
    return null;
}

// ── Shared design tokens ───────────────────────────────────────────────────────
const T = {
    // Colors
    bg: "#0c0c14",
    surface: "#111119",
    surfaceHigh: "#181825",
    border: "rgba(255,255,255,0.07)",
    borderAccent: "rgba(222,29,63,0.30)",
    text: "#e8e8f0",
    textMuted: "rgba(232,232,240,0.72)",
    textDim: "rgba(232,232,240,0.40)",
    primary: "#de1d3f",
    primaryDark: "#a51530",
    primaryGlow: "rgba(222,29,63,0.15)",
    success: "#22c55e",
    successGlow: "rgba(34,197,94,0.12)",
    // Typography
    fontStack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
    monoStack: "'SF Mono', 'Fira Code', 'Cascadia Code', 'Courier New', monospace",
};

// ── Shared HTML fragments ──────────────────────────────────────────────────────

function htmlBase(bodyContent) {
    return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>FLUX</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <style>
    @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&display=swap');
    * { box-sizing: border-box; }
    body { margin: 0; padding: 0; background: ${T.bg}; }
    table { border-spacing: 0; }
    td { padding: 0; }
    img { border: 0; display: block; }
    a { color: ${T.primary}; }
    @media (prefers-color-scheme: dark) {
      body, .email-bg { background: ${T.bg} !important; }
    }
    @media only screen and (max-width: 600px) {
      .email-wrapper { width: 100% !important; padding: 16px !important; }
      .email-card { border-radius: 16px !important; }
      .email-body { padding: 28px 24px !important; }
      .digit-box { font-size: 28px !important; padding: 12px 10px !important; min-width: 40px !important; }
      .digit-gap { width: 4px !important; }
    }
  </style>
</head>
<body class="email-bg" style="margin:0;padding:0;background:${T.bg};font-family:${T.fontStack};">
  ${bodyContent}
</body>
</html>`;
}

function logoMark() {
    return `
    <table cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td style="padding: 24px 36px 22px;">
          <table cellpadding="0" cellspacing="0">
            <tr>
              <td>
                <!-- Logo wordmark — matches Logo.jsx: F big, lu small lowercase, X big -->
                <span style="
                  display: inline-block;
                  font-family: 'IBM Plex Mono', ${T.monoStack};
                  font-weight: 900;
                  letter-spacing: -0.5px;
                  line-height: 1;
                  color: ${T.primary};
                ">
                  <span style="font-size:26px;">F</span><span style="font-size:19px;text-transform:lowercase;">LU</span><span style="font-size:26px;">X</span>
                </span>
              </td>
              <td style="padding-left: 10px; vertical-align: middle;">
                <span style="
                  display: inline-block;
                  font-size: 10px;
                  font-weight: 600;
                  letter-spacing: 0.18em;
                  text-transform: uppercase;
                  color: ${T.textDim};
                  padding: 3px 7px;
                  border: 1px solid rgba(255,255,255,0.08);
                  border-radius: 4px;
                ">MEDIA</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>`;
}

function footer() {
    return `
    <table cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td style="
          padding: 18px 36px 22px;
          border-top: 1px solid ${T.border};
        ">
          <p style="
            margin: 0;
            font-size: 11px;
            color: ${T.textDim};
            line-height: 1.7;
          ">
            This is an automated message from your FLUX media server.
            Do not reply to this email.
          </p>
          <p style="margin: 6px 0 0; font-size: 11px; color: ${T.textDim};">
            © FLUX · Self-Hosted Media Platform
          </p>
        </td>
      </tr>
    </table>`;
}

// ── OTP Email ──────────────────────────────────────────────────────────────────

function renderOTPEmail(userName, otpCode, userEmail) {
    const code = String(otpCode).padStart(6, "0");
    const digits = code.split("");
    const template = loadOTPTemplate();

    if (template) {
        return template
            .replace(/\{\{APP_NAME\}\}/g, "FLUX")
            .replace(/\{\{USER_EMAIL\}\}/g, userEmail || "")
            .replace(/\{\{OTP_CODE\}\}/g, code)
            .replace(/\{\{DIGIT_1\}\}/g, digits[0] || "·")
            .replace(/\{\{DIGIT_2\}\}/g, digits[1] || "·")
            .replace(/\{\{DIGIT_3\}\}/g, digits[2] || "·")
            .replace(/\{\{DIGIT_4\}\}/g, digits[3] || "·")
            .replace(/\{\{DIGIT_5\}\}/g, digits[4] || "·")
            .replace(/\{\{DIGIT_6\}\}/g, digits[5] || "·");
    }

    // ── Inline template ────────────────────────────────────────────────────────
    const digitBoxStyle = [
        `display:inline-block`,
        `font-family:'IBM Plex Mono',${T.monoStack}`,
        `font-size:32px`,
        `font-weight:600`,
        `color:${T.primary}`,
        `background:${T.primaryGlow}`,
        `border:1px solid ${T.borderAccent}`,
        `border-radius:10px`,
        `padding:14px 12px`,
        `min-width:48px`,
        `text-align:center`,
        `line-height:1`,
        `letter-spacing:0`,
    ].join(";");

    const gapStyle = `display:inline-block;width:6px;`;

    const digitPairs = [digits.slice(0, 3), digits.slice(3, 6)];

    // Render two groups of 3, separated by a wider gap (like 123 456)
    const renderGroup = (arr) =>
        arr.map((d, i) => `<span class="digit-box" style="${digitBoxStyle}">${d}</span>` + (i < arr.length - 1 ? `<span class="digit-gap" style="${gapStyle}"></span>` : "")).join("");

    const otpBlock = `
      <table cellpadding="0" cellspacing="0" width="100%">
        <tr>
          <td style="
            background: ${T.surfaceHigh};
            border: 1px solid ${T.borderAccent};
            border-radius: 14px;
            padding: 28px 20px;
            text-align: center;
          ">
            <!-- Label -->
            <p style="
              margin: 0 0 20px;
              font-size: 10px;
              font-weight: 700;
              letter-spacing: 0.20em;
              text-transform: uppercase;
              color: ${T.textDim};
            ">Verification Code</p>

            <!-- Digit row -->
            <div style="font-size:0;line-height:0;">
              ${renderGroup(digitPairs[0])}
              <span style="display:inline-block;width:18px;vertical-align:middle;">
                <span style="display:block;height:2px;background:rgba(255,255,255,0.12);border-radius:1px;margin:0 auto;width:8px;"></span>
              </span>
              ${renderGroup(digitPairs[1])}
            </div>

            <!-- Expiry note -->
            <p style="
              margin: 20px 0 0;
              font-size: 12px;
              color: ${T.textDim};
            ">
              Expires in
              <span style="color:rgba(232,232,240,0.70);font-weight:600;">10 minutes</span>
              &nbsp;·&nbsp; One-time use
            </p>
          </td>
        </tr>
      </table>`;

    const body = `
  <table class="email-wrapper" cellpadding="0" cellspacing="0" width="100%"
         style="padding: 40px 16px;">
    <tr>
      <td align="center">
        <table class="email-card" cellpadding="0" cellspacing="0" width="560"
               style="
                 max-width: 560px;
                 width: 100%;
                 background: ${T.surface};
                 border: 1px solid ${T.border};
                 border-radius: 20px;
                 overflow: hidden;
               ">

          <!-- Top accent bar -->
          <tr>
            <td style="
              height: 3px;
              background: linear-gradient(90deg, ${T.primaryDark} 0%, ${T.primary} 50%, rgba(222,29,63,0.3) 100%);
            "></td>
          </tr>

          <!-- Logo -->
          <tr><td>${logoMark()}</td></tr>

          <!-- Divider -->
          <tr>
            <td style="height:1px;background:${T.border};"></td>
          </tr>

          <!-- Body -->
          <tr>
            <td class="email-body" style="padding: 36px 36px 32px;">

              <!-- Badge -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="
                    padding: 5px 12px;
                    background: ${T.primaryGlow};
                    border: 1px solid ${T.borderAccent};
                    border-radius: 20px;
                    font-size: 10px;
                    font-weight: 700;
                    letter-spacing: 0.18em;
                    text-transform: uppercase;
                    color: ${T.primary};
                    margin-bottom: 20px;
                    display: inline-block;
                  ">Email Verification</td>
                </tr>
              </table>

              <p style="margin:0;height:18px;"></p>

              <!-- Heading -->
              <h1 style="
                margin: 0 0 10px;
                font-size: 26px;
                font-weight: 700;
                color: ${T.text};
                letter-spacing: -0.4px;
                line-height: 1.2;
              ">Verify your email address</h1>

              <!-- Subtext -->
              <p style="
                margin: 0 0 28px;
                font-size: 14px;
                color: ${T.textMuted};
                line-height: 1.65;
              ">
                Hi <strong style="color:rgba(232,232,240,0.75);">${userName}</strong>,
                enter this code in FLUX to verify
                <strong style="color:rgba(232,232,240,0.82);">${userEmail}</strong>
                and complete sign-in.
              </p>

              <!-- OTP block -->
              ${otpBlock}

              <!-- Security note -->
              <table cellpadding="0" cellspacing="0" width="100%"
                     style="margin-top: 24px;">
                <tr>
                  <td style="
                    padding: 14px 16px;
                    background: rgba(255,255,255,0.03);
                    border: 1px solid rgba(255,255,255,0.06);
                    border-radius: 10px;
                  ">
                    <p style="
                      margin: 0;
                      font-size: 12px;
                      color: ${T.textDim};
                      line-height: 1.6;
                    ">
                      🔒&nbsp; If you didn't request this code, someone may have entered your email by mistake.
                      You can safely ignore this message — your account remains secure.
                    </p>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr><td>${footer()}</td></tr>

        </table>
      </td>
    </tr>
  </table>`;

    return htmlBase(body);
}

// ── Approval Email ─────────────────────────────────────────────────────────────

function renderApprovalEmail(userName) {
    const checkIcon = `
      <table cellpadding="0" cellspacing="0">
        <tr>
          <td style="
            width: 52px;
            height: 52px;
            background: ${T.successGlow};
            border: 1px solid rgba(34,197,94,0.25);
            border-radius: 14px;
            text-align: center;
            vertical-align: middle;
            font-size: 24px;
          ">✓</td>
        </tr>
      </table>`;

    const body = `
  <table class="email-wrapper" cellpadding="0" cellspacing="0" width="100%"
         style="padding: 40px 16px;">
    <tr>
      <td align="center">
        <table class="email-card" cellpadding="0" cellspacing="0" width="560"
               style="
                 max-width: 560px;
                 width: 100%;
                 background: ${T.surface};
                 border: 1px solid ${T.border};
                 border-radius: 20px;
                 overflow: hidden;
               ">

          <!-- Top accent bar — green for approval -->
          <tr>
            <td style="
              height: 3px;
              background: linear-gradient(90deg, #16a34a 0%, ${T.success} 50%, rgba(34,197,94,0.3) 100%);
            "></td>
          </tr>

          <!-- Logo -->
          <tr><td>${logoMark()}</td></tr>

          <!-- Divider -->
          <tr>
            <td style="height:1px;background:${T.border};"></td>
          </tr>

          <!-- Body -->
          <tr>
            <td class="email-body" style="padding: 36px 36px 32px;">

              <!-- Check icon -->
              ${checkIcon}

              <p style="margin:0;height:20px;"></p>

              <!-- Badge -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="
                    padding: 5px 12px;
                    background: ${T.successGlow};
                    border: 1px solid rgba(34,197,94,0.25);
                    border-radius: 20px;
                    font-size: 10px;
                    font-weight: 700;
                    letter-spacing: 0.18em;
                    text-transform: uppercase;
                    color: ${T.success};
                  ">Account Approved</td>
                </tr>
              </table>

              <p style="margin:0;height:16px;"></p>

              <!-- Heading -->
              <h1 style="
                margin: 0 0 10px;
                font-size: 26px;
                font-weight: 700;
                color: ${T.text};
                letter-spacing: -0.4px;
                line-height: 1.2;
              ">You're in, ${userName}.</h1>

              <!-- Subtext -->
              <p style="
                margin: 0 0 28px;
                font-size: 14px;
                color: ${T.textMuted};
                line-height: 1.65;
              ">
                Your FLUX account has been approved by the administrator.
                You now have full access to your media library — stream, browse,
                and pick up right where you left off.
              </p>

              <!-- Feature highlights -->
              <table cellpadding="0" cellspacing="0" width="100%"
                     style="margin-bottom: 28px;">
                <tr>
                  <td style="
                    padding: 18px 20px;
                    background: ${T.surfaceHigh};
                    border: 1px solid ${T.border};
                    border-radius: 14px;
                  ">
                    ${featureRow("🎬", "Movies & Series", "Browse your full media library")}
                    <div style="height:12px;"></div>
                    ${featureRow("▶️", "Instant Streaming", "Direct play with resume support")}
                    <div style="height:12px;"></div>
                    ${featureRow("📱", "Any Device", "Web, mobile, and more")}
                  </td>
                </tr>
              </table>

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="
                    background: linear-gradient(135deg, ${T.primary} 0%, ${T.primaryDark} 100%);
                    border-radius: 10px;
                  ">
                    <a href="${process.env.APP_URL || "http://localhost:5173"}/login"
                       style="
                         display: inline-block;
                         padding: 14px 32px;
                         font-size: 14px;
                         font-weight: 600;
                         color: #fff;
                         text-decoration: none;
                         border-radius: 10px;
                         letter-spacing: 0.01em;
                       ">Sign In to FLUX →</a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr><td>${footer()}</td></tr>

        </table>
      </td>
    </tr>
  </table>`;

    return htmlBase(body);
}

function featureRow(emoji, title, subtitle) {
    return `
    <table cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td style="width:28px;vertical-align:middle;font-size:16px;">${emoji}</td>
        <td style="padding-left:10px;vertical-align:middle;">
          <span style="font-size:13px;font-weight:600;color:${T.text};">${title}</span>
          <span style="font-size:12px;color:${T.textMuted};padding-left:8px;">${subtitle}</span>
        </td>
      </tr>
    </table>`;
}

// ── Public API ─────────────────────────────────────────────────────────────────

async function sendOTPEmail(toEmail, userName, otpCode) {
    const client = getResendClient();

    if (!client) {
        console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log(`[FLUX Email] OTP for ${toEmail}`);
        console.log(`  Name:    ${userName}`);
        console.log(`  Code:    ${otpCode}`);
        console.log(`  Expires: 10 minutes`);
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        return { success: true, fallback: true };
    }

    const html = renderOTPEmail(userName, otpCode, toEmail);

    try {
        const result = await client.emails.send({
            from: FROM_ADDRESS,
            to: toEmail,
            subject: `${otpCode} — Your FLUX verification code`,
            html,
        });
        console.log(`[Email] OTP sent to ${toEmail} — id: ${result?.id}`);
        return { success: true, id: result?.id };
    } catch (error) {
        console.error("[Email] Send failed:", error?.message);
        return { success: false, error: error?.message || "Unknown email error" };
    }
}

async function sendApprovalEmail(toEmail, userName) {
    const client = getResendClient();

    if (!client) {
        console.log(`[FLUX Email] Account approved: ${toEmail}`);
        return { success: true, fallback: true };
    }

    const html = renderApprovalEmail(userName);

    try {
        await client.emails.send({
            from: FROM_ADDRESS,
            to: toEmail,
            subject: "Your FLUX account has been approved",
            html,
        });
        return { success: true };
    } catch (error) {
        console.error("[Email] Approval email failed:", error?.message);
        return { success: false, error: error?.message };
    }
}

module.exports = { sendOTPEmail, sendApprovalEmail };
