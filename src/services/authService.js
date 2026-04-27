const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const admin = require('../config/firebase');

const JWT_SECRET = process.env.JWT_SECRET || 'changeme';
const JWT_EXPIRES = '7d';
const HISTORY_LIMIT = 50;

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

async function getFavorites(userId) {
  const user = await User.findById(userId).select('favorites');
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  return user.favorites;
}

async function addFavorite(userId, { provider, contentUrl, title = null, thumbnail = null }) {
  // Remove existing entry by contentUrl (dedup), then push new
  await User.updateOne({ _id: userId }, { $pull: { favorites: { contentUrl } } });
  return User.findByIdAndUpdate(
    userId,
    { $push: { favorites: { provider, contentUrl, title, thumbnail } } },
    { new: true }
  ).select('-password');
}

async function removeFavorite(userId, contentUrl) {
  return User.findByIdAndUpdate(
    userId,
    { $pull: { favorites: { contentUrl } } },
    { new: true }
  ).select('-password');
}

async function getHistory(userId) {
  const user = await User.findById(userId).select('watchHistory');
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  return user.watchHistory;
}

async function addToHistory(userId, { provider, contentUrl, title = null, thumbnail = null }) {
  await User.updateOne({ _id: userId }, { $pull: { watchHistory: { contentUrl } } });

  return User.findByIdAndUpdate(
    userId,
    {
      $push: {
        watchHistory: {
          $each: [{ provider, contentUrl, title, thumbnail, watchedAt: new Date() }],
          $position: 0,
          $slice: HISTORY_LIMIT,
        },
      },
    },
    { new: true }
  ).select('-password');
}

async function clearHistory(userId) {
  return User.findByIdAndUpdate(
    userId,
    { $set: { watchHistory: [] } },
    { new: true }
  ).select('-password');
}

async function removeFromHistory(userId, contentUrl) {
  return User.findByIdAndUpdate(
    userId,
    { $pull: { watchHistory: { contentUrl } } },
    { new: true }
  ).select('-password');
}

async function loginWithGoogle(idToken) {
  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(idToken);
  } catch (err) {
    throw Object.assign(new Error('Invalid or expired Google token'), { status: 401 });
  }

  const { uid, email, name, picture } = decoded;
  if (!email) throw Object.assign(new Error('Google account has no email'), { status: 400 });

  let user = await User.findOne({ firebaseUid: uid });
  if (!user) user = await User.findOne({ email });

  if (user) {
    if (!user.firebaseUid) {
      user.firebaseUid = uid;
      user.authProvider = 'google';
      if (picture && !user.photoURL) user.photoURL = picture;
      await user.save();
    }
  } else {
    let baseUsername = (name || email.split('@')[0])
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .slice(0, 20);
    let username = baseUsername;
    let suffix = 1;
    while (await User.findOne({ username })) {
      username = `${baseUsername}_${suffix++}`;
    }

    user = await User.create({
      username,
      email,
      password: null,
      photoURL: picture || null,
      firebaseUid: uid,
      authProvider: 'google',
    });
  }

  return { token: signToken(user), user: sanitize(user) };
}

module.exports = {
  register, login, loginWithGoogle,
  getProfile, updateProfile,
  getFavorites, addFavorite, removeFavorite,
  getHistory, addToHistory, clearHistory, removeFromHistory,
};
