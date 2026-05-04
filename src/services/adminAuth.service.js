const bcrypt = require('bcryptjs');
const Admin  = require('../models/Admin');
const { signAdminAccess, signAdminRefresh, verifyAdminRefresh } = require('../utils/jwt');

function err(message, status) {
  return Object.assign(new Error(message), { status });
}

function payload(admin) {
  return { id: admin._id, username: admin.username, role: 'admin' };
}

async function _issueTokens(admin) {
  const accessToken  = signAdminAccess(payload(admin));
  const refreshToken = signAdminRefresh(payload(admin));
  admin.refreshToken = await bcrypt.hash(refreshToken, 10);
  await admin.save();
  return { accessToken, refreshToken };
}

async function login(username, password) {
  if (!username || !password) throw err('Username va parol majburiy', 400);

  const admin = await Admin.findOne({ username: username.trim() });
  if (!admin) throw err("Login yoki parol noto'g'ri", 401);

  const valid = await bcrypt.compare(password, admin.password);
  if (!valid) throw err("Login yoki parol noto'g'ri", 401);

  const { accessToken, refreshToken } = await _issueTokens(admin);
  return { admin: { id: admin._id, username: admin.username }, accessToken, refreshToken };
}

async function refresh(token) {
  let decoded;
  try { decoded = verifyAdminRefresh(token); }
  catch { throw err("Refresh token noto'g'ri yoki muddati o'tgan", 401); }

  if (decoded.role !== 'admin') throw err('Ruxsat yo\'q', 403);

  const admin = await Admin.findById(decoded.id);
  if (!admin || !admin.refreshToken) throw err('Session topilmadi', 401);

  const match = await bcrypt.compare(token, admin.refreshToken);
  if (!match) throw err('Refresh token mos emas', 401);

  const { accessToken, refreshToken } = await _issueTokens(admin);
  return { accessToken, refreshToken };
}

async function logout(adminId) {
  await Admin.findByIdAndUpdate(adminId, { refreshToken: null });
}

module.exports = { login, refresh, logout };
