/**
 * utils/mailer.js
 *
 * Nodemailer email service — gracefully no-ops when SMTP is not configured.
 * Configure in .env:
 *   SMTP_HOST=smtp.gmail.com
 *   SMTP_PORT=587
 *   SMTP_USER=your@email.com
 *   SMTP_PASS=your_app_password
 *   SMTP_FROM="CrediMap <noreply@credmap.app>"
 */

const nodemailer = require('nodemailer');

const SMTP_CONFIGURED =
  process.env.SMTP_HOST &&
  process.env.SMTP_USER &&
  process.env.SMTP_PASS;

let transporter = null;

if (SMTP_CONFIGURED) {
  transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  console.log('[Mailer] SMTP configured — emails will be sent');
} else {
  console.log('[Mailer] No SMTP config — emails will be logged to console only');
}

const FROM = process.env.SMTP_FROM || '"CrediMap" <noreply@credmap.app>';
const BASE_URL = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';

// ── Email Templates ──────────────────────────────────────────────────────────

const templates = {
  passwordReset: (name, token) => ({
    subject: 'Reset your CrediMap password',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:32px">
        <h2 style="color:#4f46e5;margin-bottom:8px">CrediMap Password Reset</h2>
        <p>Hi <strong>${name}</strong>,</p>
        <p>We received a request to reset your password. Click the button below to create a new one. This link expires in <strong>15 minutes</strong>.</p>
        <div style="text-align:center;margin:32px 0">
          <a href="${BASE_URL}/reset-password?token=${token}"
             style="background:#4f46e5;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;display:inline-block">
            Reset Password
          </a>
        </div>
        <p style="color:#6b7280;font-size:13px">If you didn't request this, you can safely ignore this email.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
        <p style="color:#9ca3af;font-size:12px">CrediMap — Campus Trust Marketplace</p>
      </div>`,
  }),

  reviewReceived: (sellerName, reviewerName, rating, productTitle) => ({
    subject: `New ${rating}★ review from ${reviewerName}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:32px">
        <h2 style="color:#4f46e5">You received a new review!</h2>
        <p>Hi <strong>${sellerName}</strong>,</p>
        <p><strong>${reviewerName}</strong> left a <strong>${rating}★ review</strong> for your listing: <em>${productTitle}</em>.</p>
        <div style="text-align:center;margin:24px 0">
          <a href="${BASE_URL}/dashboard"
             style="background:#4f46e5;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:700;display:inline-block">
            View Dashboard
          </a>
        </div>
      </div>`,
  }),

  dealComplete: (buyerName, sellerName, productTitle, reviewLink) => ({
    subject: `Deal complete — leave a review for ${sellerName}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:32px">
        <h2 style="color:#10b981">Your deal is complete! 🎉</h2>
        <p>Hi <strong>${buyerName}</strong>,</p>
        <p>Your transaction for <em>${productTitle}</em> with <strong>${sellerName}</strong> has been marked complete.</p>
        <p>Help the campus community by leaving an honest review:</p>
        <div style="text-align:center;margin:24px 0">
          <a href="${reviewLink}"
             style="background:#10b981;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:700;display:inline-block">
            Leave a Review
          </a>
        </div>
      </div>`,
  }),

  verified: (name) => ({
    subject: 'Your CrediMap account is now verified ✅',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:32px">
        <h2 style="color:#10b981">Account Verified!</h2>
        <p>Hi <strong>${name}</strong>,</p>
        <p>An admin has verified your CrediMap account. A ✅ badge will now appear next to your name in the marketplace, boosting buyer confidence.</p>
        <div style="text-align:center;margin:24px 0">
          <a href="${BASE_URL}/dashboard"
             style="background:#4f46e5;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:700;display:inline-block">
            Go to Dashboard
          </a>
        </div>
      </div>`,
  }),
};

// ── Send helper ──────────────────────────────────────────────────────────────

async function sendMail(to, templateFn, ...args) {
  const { subject, html } = templateFn(...args);

  if (!SMTP_CONFIGURED) {
    console.log(`\n[Mailer] EMAIL (not sent — no SMTP): To: ${to} | Subject: ${subject}`);
    return;
  }

  try {
    await transporter.sendMail({ from: FROM, to, subject, html });
    console.log(`[Mailer] Sent "${subject}" to ${to}`);
  } catch (err) {
    console.error(`[Mailer] Failed to send email to ${to}:`, err.message);
    // Don't throw — email failure should never crash a request
  }
}

module.exports = {
  sendPasswordReset:  (to, name, token)                           => sendMail(to, templates.passwordReset,  name, token),
  sendReviewReceived: (to, sellerName, reviewerName, rating, product) => sendMail(to, templates.reviewReceived, sellerName, reviewerName, rating, product),
  sendDealComplete:   (to, buyerName, sellerName, product, link)  => sendMail(to, templates.dealComplete,   buyerName, sellerName, product, link),
  sendVerified:       (to, name)                                   => sendMail(to, templates.verified,        name),
};
