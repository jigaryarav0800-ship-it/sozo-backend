const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const Otp    = require('../models/Otp');
const { sendEmail, otpEmailTemplate } = require('../utils/email');

const TTL_MIN      = parseInt(process.env.OTP_TTL_MINUTES) || 10;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SEC = 60;

function err(message, status) {
  return Object.assign(new Error(message), { status });
}

function generateOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

async function _persistAndSend({ email, purpose, payload }) {
  const existing = await Otp.findOne({ email, purpose });
  if (existing && existing.createdAt && (Date.now() - existing.createdAt.getTime()) < RESEND_COOLDOWN_SEC * 1000) {
    const wait = Math.ceil((RESEND_COOLDOWN_SEC * 1000 - (Date.now() - existing.createdAt.getTime())) / 1000);
    throw err(`Yangi kod so'rashdan oldin ${wait} soniya kuting`, 429);
  }

  await Otp.deleteMany({ email, purpose });

  const otp       = generateOtp();
  const otpHash   = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + TTL_MIN * 60 * 1000);

  await Otp.create({ email, purpose, otpHash, expiresAt, ...payload });

  await sendEmail({ to: email, ...otpEmailTemplate(otp, TTL_MIN) });

  return { expiresIn: TTL_MIN * 60, expiresAt };
}

async function startRegister({ email, username, passwordHash }) {
  return _persistAndSend({
    email,
    purpose: 'register',
    payload: { username, passwordHash },
  });
}

async function resendRegister({ email }) {
  const existing = await Otp.findOne({ email, purpose: 'register' });
  if (!existing) {
    throw err("Bu email uchun kutilayotgan ro'yxatdan o'tish topilmadi — qaytadan boshlang", 404);
  }

  return _persistAndSend({
    email,
    purpose: 'register',
    payload: { username: existing.username, passwordHash: existing.passwordHash },
  });
}

async function startReset({ email }) {
  return _persistAndSend({
    email,
    purpose: 'reset',
    payload: {},
  });
}

async function _verify(email, purpose, otp) {
  const record = await Otp.findOne({ email, purpose }).sort({ createdAt: -1 });
  if (!record) throw err('Tasdiqlash kodi topilmadi yoki muddati tugagan', 400);

  if (record.expiresAt < new Date()) {
    await record.deleteOne();
    throw err('Tasdiqlash kodi muddati tugagan', 400);
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    await record.deleteOne();
    throw err("Juda ko'p urinish — kodni qaytadan so'rang", 429);
  }

  const ok = await bcrypt.compare(String(otp), record.otpHash);
  if (!ok) {
    record.attempts += 1;
    await record.save();
    throw err("Tasdiqlash kodi noto'g'ri", 400);
  }

  return record;
}

async function verifyRegister(email, otp) {
  const record = await _verify(email, 'register', otp);
  const out = {
    email:        record.email,
    username:     record.username,
    passwordHash: record.passwordHash,
  };
  await record.deleteOne();
  return out;
}

async function verifyReset(email, otp) {
  const record = await _verify(email, 'reset', otp);
  const out = { email: record.email };
  await record.deleteOne();
  return out;
}

module.exports = {
  startRegister,
  resendRegister,
  verifyRegister,
  startReset,
  verifyReset,
};
