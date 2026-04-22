const authService = require('../services/authService');

async function register(req, res) {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ message: 'username, email and password are required' });
  }
  const result = await authService.register(username, email, password);
  res.status(201).json(result);
}

async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'email and password are required' });
  }
  const result = await authService.login(email, password);
  res.json(result);
}

async function getProfile(req, res) {
  const user = await authService.getProfile(req.user.id);
  res.json({ user });
}

async function updateProfile(req, res) {
  const user = await authService.updateProfile(req.user.id, req.body);
  res.json({ user });
}

async function addFavorite(req, res) {
  const { url } = req.body;
  if (!url) return res.status(400).json({ message: 'url is required' });
  const user = await authService.addFavorite(req.user.id, url);
  res.json({ user });
}

async function removeFavorite(req, res) {
  const { url } = req.body;
  if (!url) return res.status(400).json({ message: 'url is required' });
  const user = await authService.removeFavorite(req.user.id, url);
  res.json({ user });
}

async function addToHistory(req, res) {
  const { url } = req.body;
  if (!url) return res.status(400).json({ message: 'url is required' });
  const user = await authService.addToHistory(req.user.id, url);
  res.json({ user });
}

module.exports = { register, login, getProfile, updateProfile, addFavorite, removeFavorite, addToHistory };
