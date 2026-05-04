const adminAuthService = require('../../services/adminAuth.service');

async function login(req, res) {
  const { username, password } = req.body;
  const result = await adminAuthService.login(username, password);
  res.json(result);
}

async function refresh(req, res) {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ message: 'refreshToken majburiy' });
  const result = await adminAuthService.refresh(refreshToken);
  res.json(result);
}

async function logout(req, res) {
  await adminAuthService.logout(req.admin._id);
  res.json({ message: 'Chiqildi' });
}

module.exports = { login, refresh, logout };
