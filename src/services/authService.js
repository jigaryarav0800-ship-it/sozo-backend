const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'changeme';
const JWT_EXPIRES = '7d';

function signToken(user) {
  return jwt.sign({ id: user._id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function sanitize(user) {
  const obj = user.toObject ? user.toObject() : { ...user };
  delete obj.password;
  return obj;
}

async function register(username, email, password) {
  const [existingEmail, existingUsername] = await Promise.all([
    User.findOne({ email }),
    User.findOne({ username }),
  ]);
  if (existingEmail) throw Object.assign(new Error('Email already in use'), { status: 409 });
  if (existingUsername) throw Object.assign(new Error('Username already taken'), { status: 409 });

  const hashed = await bcrypt.hash(password, 10);
  const user = await User.create({ username, email, password: hashed });

  return { token: signToken(user), user: sanitize(user) };
}

async function login(email, password) {
  const user = await User.findOne({ email });
  if (!user) throw Object.assign(new Error('Invalid credentials'), { status: 401 });

  const match = await bcrypt.compare(password, user.password);
  if (!match) throw Object.assign(new Error('Invalid credentials'), { status: 401 });

  return { token: signToken(user), user: sanitize(user) };
}

async function getProfile(userId) {
  const user = await User.findById(userId).select('-password');
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  return user;
}

async function updateProfile(userId, { username, photoURL }) {
  if (username) {
    const existing = await User.findOne({ username, _id: { $ne: userId } });
    if (existing) throw Object.assign(new Error('Username already taken'), { status: 409 });
  }
  const user = await User.findByIdAndUpdate(
    userId,
    { ...(username && { username }), ...(photoURL !== undefined && { photoURL }) },
    { new: true }
  ).select('-password');
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  return user;
}

async function addFavorite(userId, contentUrl) {
  return User.findByIdAndUpdate(
    userId,
    { $addToSet: { favorites: contentUrl } },
    { new: true }
  ).select('-password');
}

async function removeFavorite(userId, contentUrl) {
  return User.findByIdAndUpdate(
    userId,
    { $pull: { favorites: contentUrl } },
    { new: true }
  ).select('-password');
}

async function addToHistory(userId, contentUrl) {
  return User.findByIdAndUpdate(
    userId,
    { $push: { watchHistory: { contentUrl } } },
    { new: true }
  ).select('-password');
}

module.exports = { register, login, getProfile, updateProfile, addFavorite, removeFavorite, addToHistory };
