const axios = require('axios');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM    = process.env.RESEND_FROM || 'onboarding@resend.dev';
const RESEND_URL     = 'https://api.resend.com/emails';

if (!RESEND_API_KEY) {
  console.warn('[email] RESEND_API_KEY is not set — email sends will fail');
}

async function sendEmail({ to, subject, html, text }) {
  if (!RESEND_API_KEY) {
    throw Object.assign(new Error('Resend API kaliti sozlanmagan'), { status: 500 });
  }
  try {
    const res = await axios.post(RESEND_URL, {
      from: RESEND_FROM,
      to:   Array.isArray(to) ? to : [to],
      subject,
      html,
      text,
    }, {
      headers: {
        Authorization:  `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 10_000,
    });
    return { id: res.data?.id || null };
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    throw Object.assign(new Error(`Email yuborishda xato: ${msg}`), { status: 502 });
  }
}

function otpEmailTemplate(otp, ttlMinutes) {
  return {
    subject: `SoPlay tasdiqlash kodi: ${otp}`,
    html: `<!DOCTYPE html>
<html lang="uz"><body style="font-family:Arial,Helvetica,sans-serif;background:#f3f4f6;padding:24px;margin:0;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e5e7eb;">
    <h2 style="margin:0 0 16px;color:#111827;">SoPlay tasdiqlash kodi</h2>
    <p style="margin:0 0 24px;color:#374151;">Ro'yxatdan o'tishni yakunlash uchun quyidagi kodni kiriting:</p>
    <div style="font-size:36px;font-weight:700;letter-spacing:8px;text-align:center;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px 0;color:#111827;">${otp}</div>
    <p style="margin:24px 0 0;color:#6b7280;font-size:14px;">Kod ${ttlMinutes} daqiqa davomida amal qiladi. Agar siz so'ramagan bo'lsangiz, ushbu xatni e'tiborsiz qoldiring.</p>
  </div>
</body></html>`,
    text: `SoPlay tasdiqlash kodingiz: ${otp}\nKod ${ttlMinutes} daqiqa davomida amal qiladi.`,
  };
}

module.exports = { sendEmail, otpEmailTemplate };
