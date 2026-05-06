const bcrypt     = require('bcryptjs');
const User       = require('../models/User');
const otpService = require('./otpService');
const { signAccess, signRefresh, verifyRefresh } = require('../utils/jwt');

const HISTORY_LIMIT = 50;
const EMAIL_RE      = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function err(message, status) {
  return Object.assign(new Error(message), { status });
}

function payload(user) {
  return { id: user._id, username: user.username };
}

async function _issueTokens(user) {
  const accessToken  = signAccess(payload(user));
  const refreshToken = signRefresh(payload(user));
  user.refreshToken  = await bcrypt.hash(refreshToken, 10);
  await user.save();
  return { accessToken, refreshToken };
}

function safeUser(user) {
  const obj = user.toObject ? user.toObject() : { ...user };
  delete obj.password;
  delete obj.refreshToken;
  return obj;
}

async function startRegister(email, username, password) {
  if (!EMAIL_RE.test(email)) throw err('Email formati noto\'g\'ri', 400);
  if (password.length < 6)   throw err('Parol kamida 6 ta belgidan iborat bo\'lishi kerak', 400);
  if (username.length < 3)   throw err('Username kamida 3 ta belgidan iborat bo\'lishi kerak', 400);

  if (await User.findOne({ email }))    throw err('Bu email allaqachon ro\'yxatdan o\'tgan', 409);
  if (await User.findOne({ username })) throw err('Bu username band', 409);

  const passwordHash = await bcrypt.hash(password, 12);
  const { expiresIn, expiresAt } = await otpService.startRegister({ email, username, passwordHash });
  return { message: 'Tasdiqlash kodi emailingizga yuborildi', email, expiresIn, expiresAt };
}

async function resendRegisterOtp(email) {
  if (!EMAIL_RE.test(email)) throw err('Email formati noto\'g\'ri', 400);
  const { expiresIn, expiresAt } = await otpService.resendRegister({ email });
  return { message: 'Yangi tasdiqlash kodi yuborildi', email, expiresIn, expiresAt };
}

async function verifyRegister(email, otp) {
  if (!EMAIL_RE.test(email)) throw err('Email formati noto\'g\'ri', 400);
  if (!otp)                  throw err('OTP majburiy', 400);

  const verified = await otpService.verifyRegister(email, otp);

  let user;
  try {
    user = await User.create({
      email:        verified.email,
      username:     verified.username,
      password:     verified.passwordHash,
      authProvider: 'local',
    });
  } catch (e) {
    if (e.code === 11000) {
      const field = Object.keys(e.keyPattern || {})[0];
      throw err(field === 'email' ? 'Bu email allaqachon ro\'yxatdan o\'tgan' : 'Bu username band', 409);
    }
    throw e;
  }

  const { accessToken, refreshToken } = await _issueTokens(user);
  return { user: safeUser(user), accessToken, refreshToken };
}

async function login(identifier, password) {
  if (!identifier || !password) throw err('Login va parol majburiy', 400);
  const lookup = identifier.includes('@')
    ? { email: identifier.toLowerCase().trim() }
    : { username: identifier.trim() };

  const user = await User.findOne(lookup);
  if (!user || !user.password) throw err("Login yoki parol noto'g'ri", 401);

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) throw err("Login yoki parol noto'g'ri", 401);

  const { accessToken, refreshToken } = await _issueTokens(user);
  return { user: safeUser(user), accessToken, refreshToken };
}

async function forgotPassword(email) {
  if (!EMAIL_RE.test(email)) throw err('Email formati noto\'g\'ri', 400);

  const user = await User.findOne({ email });
  if (!user) {
    return { message: 'Agar email tizimda bo\'lsa, kod yuborildi', email };
  }
  const { expiresIn, expiresAt } = await otpService.startReset({ email });
  return { message: 'Parolni tiklash kodi yuborildi', email, expiresIn, expiresAt };
}

async function resetPassword(email, otp, newPassword) {
  if (!EMAIL_RE.test(email))   throw err('Email formati noto\'g\'ri', 400);
  if (!otp)                    throw err('OTP majburiy', 400);
  if (!newPassword || newPassword.length < 6) {
    throw err('Yangi parol kamida 6 ta belgidan iborat bo\'lishi kerak', 400);
  }

  await otpService.verifyReset(email, otp);

  const user = await User.findOne({ email });
  if (!user) throw err('Foydalanuvchi topilmadi', 404);

  user.password     = await bcrypt.hash(newPassword, 12);
  user.refreshToken = null;
  await user.save();

  const { accessToken, refreshToken } = await _issueTokens(user);
  return { user: safeUser(user), accessToken, refreshToken };
}

async function refresh(token) {
  let decoded;
  try { decoded = verifyRefresh(token); }
  catch { throw err('Refresh token noto\'g\'ri yoki muddati o\'tgan', 401); }

  const user = await User.findById(decoded.id);
  if (!user || !user.refreshToken) throw err('Session topilmadi', 401);

  const match = await bcrypt.compare(token, user.refreshToken);
  if (!match) throw err('Refresh token mos emas', 401);

  const { accessToken, refreshToken } = await _issueTokens(user);
  return { accessToken, refreshToken };
}

async function logout(userId) {
  await User.findByIdAndUpdate(userId, { refreshToken: null });
}

async function updateProfile(userId, { username, displayName, photoURL }) {
  const update = {};

  if (username !== undefined) {
    const trimmed = username.trim();
    if (!trimmed) throw err('Username bo\'sh bo\'lishi mumkin emas', 400);
    if (trimmed.length < 3) throw err('Username kamida 3 ta belgidan iborat bo\'lishi kerak', 400);
    const taken = await User.findOne({ username: trimmed, _id: { $ne: userId } });
    if (taken) throw err('Username band', 409);
    update.username = trimmed;
  }

  if (displayName !== undefined) update.displayName = displayName;
  if (photoURL    !== undefined) update.photoURL    = photoURL;

  if (!Object.keys(update).length) throw err('Yangilanadigan maydon ko\'rsatilmadi', 400);

  const user = await User.findByIdAndUpdate(userId, update, { new: true, runValidators: true })
    .select('-password -refreshToken');
  if (!user) throw err('Foydalanuvchi topilmadi', 404);
  return user;
}

async function addFavorite(userId, { provider, contentUrl, title = null, thumbnail = null }) {
  // Atomik: faqat contentUrl yo'q bo'lganda qo'shadi — race condition'dan himoya
  const updated = await User.findOneAndUpdate(
    { _id: userId, 'favorites.contentUrl': { $ne: contentUrl } },
    { $push: { favorites: { provider, contentUrl, title, thumbnail } } },
    { new: true }
  ).select('-password -refreshToken');
  if (updated) return updated;
  return User.findById(userId).select('-password -refreshToken');
}

async function removeFavorite(userId, contentUrl) {
  return User.findByIdAndUpdate(
    userId,
    { $pull: { favorites: { contentUrl } } },
    { new: true }
  ).select('-password -refreshToken');
}

async function addToHistory(userId, { provider, contentUrl, title = null, thumbnail = null }) {
  await User.updateOne({ _id: userId }, { $pull: { watchHistory: { contentUrl } } });
  return User.findByIdAndUpdate(
    userId,
    {
      $push: {
        watchHistory: {
          $each:     [{ provider, contentUrl, title, thumbnail, watchedAt: new Date() }],
          $position: 0,
          $slice:    HISTORY_LIMIT,
        },
      },
    },
    { new: true }
  ).select('-password -refreshToken');
}

async function clearHistory(userId) {
  return User.findByIdAndUpdate(
    userId,
    { $set: { watchHistory: [] } },
    { new: true }
  ).select('-password -refreshToken');
}

async function removeFromHistory(userId, contentUrl) {
  return User.findByIdAndUpdate(
    userId,
    { $pull: { watchHistory: { contentUrl } } },
    { new: true }
  ).select('-password -refreshToken');
}

module.exports = {
  startRegister, resendRegisterOtp, verifyRegister,
  login, refresh, logout,
  forgotPassword, resetPassword,
  updateProfile,
  addFavorite, removeFavorite,
  addToHistory, clearHistory, removeFromHistory,
};
