const authService = require('../services/authService');

async function startRegister(req, res) {
  const { email, username, password } = req.body;
  if (!email || !username || !password) {
    return res.status(400).json({ message: 'email, username va password majburiy' });
  }
  const result = await authService.startRegister(
    email.trim().toLowerCase(),
    username.trim(),
    password
  );
  res.status(202).json(result);
}

async function resendRegisterOtp(req, res) {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: 'email majburiy' });
  const result = await authService.resendRegisterOtp(email.trim().toLowerCase());
  res.status(202).json(result);
}

async function verifyRegister(req, res) {
  const { email, otp } = req.body;
  if (!email || !otp) {
    return res.status(400).json({ message: 'email va otp majburiy' });
  }
  const result = await authService.verifyRegister(email.trim().toLowerCase(), String(otp).trim());
  res.status(201).json(result);
}

async function login(req, res) {

  const password   = req.body.password;
  const identifier = req.body.identifier ?? req.body.email ?? req.body.username;
  if (!identifier || !password) {
    return res.status(400).json({ message: 'identifier (email yoki username) va password majburiy' });
  }
  const result = await authService.login(String(identifier).trim(), password);
  res.json(result);
}

async function forgotPassword(req, res) {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: 'email majburiy' });
  const result = await authService.forgotPassword(email.trim().toLowerCase());
  res.status(202).json(result);
}

async function resetPassword(req, res) {
  const { email, otp, newPassword } = req.body;
  if (!email || !otp || !newPassword) {
    return res.status(400).json({ message: 'email, otp va newPassword majburiy' });
  }
  const result = await authService.resetPassword(
    email.trim().toLowerCase(),
    String(otp).trim(),
    newPassword
  );
  res.json(result);
}

async function refreshTokens(req, res) {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ message: 'refreshToken majburiy' });
  const result = await authService.refresh(refreshToken);
  res.json(result);
}

async function logout(req, res) {
  await authService.logout(req.user.id);
  res.json({ message: 'Muvaffaqiyatli chiqildi' });
}

async function getProfile(req, res) {
  const user = req.user.toObject();
  delete user.password;
  delete user.refreshToken;
  res.json({ user });
}

async function updateProfile(req, res) {
  const { username, displayName, photoURL } = req.body;
  const user = await authService.updateProfile(req.user.id, { username, displayName, photoURL });
  res.json({ user });
}

async function getFavorites(req, res) {
  res.json({ items: req.user.favorites });
}

async function addFavorite(req, res) {
  const { provider, contentUrl, title, thumbnail } = req.body;
  if (!provider || !contentUrl) {
    return res.status(400).json({ message: 'provider va contentUrl majburiy' });
  }
  const user = await authService.addFavorite(req.user.id, { provider, contentUrl, title, thumbnail });
  res.json({ user });
}

async function removeFavorite(req, res) {
  const { contentUrl } = req.body;
  if (!contentUrl) return res.status(400).json({ message: 'contentUrl majburiy' });
  const user = await authService.removeFavorite(req.user.id, contentUrl);
  res.json({ user });
}

async function getHistory(req, res) {
  res.json({ items: req.user.watchHistory });
}

async function addToHistory(req, res) {
  const { provider, contentUrl, title, thumbnail } = req.body;
  if (!provider || !contentUrl) {
    return res.status(400).json({ message: 'provider va contentUrl majburiy' });
  }
  const user = await authService.addToHistory(req.user.id, { provider, contentUrl, title, thumbnail });
  res.json({ user });
}

async function clearHistory(req, res) {
  const user = await authService.clearHistory(req.user.id);
  res.json({ user });
}

async function removeFromHistory(req, res) {
  const { contentUrl } = req.body;
  if (!contentUrl) return res.status(400).json({ message: 'contentUrl majburiy' });
  const user = await authService.removeFromHistory(req.user.id, contentUrl);
  res.json({ user });
}

module.exports = {
  startRegister, resendRegisterOtp, verifyRegister,
  login, refreshTokens, logout,
  forgotPassword, resetPassword,
  getProfile, updateProfile,
  getFavorites, addFavorite, removeFavorite,
  getHistory, addToHistory, clearHistory, removeFromHistory,
};
