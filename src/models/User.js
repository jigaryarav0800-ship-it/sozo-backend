const mongoose = require('mongoose');

const favoriteSchema = {
  provider:   { type: String, required: true },
  contentUrl: { type: String, required: true },
  title:      { type: String, default: null },
  thumbnail:  { type: String, default: null },
  _id: false,
};

const historySchema = {
  provider:   { type: String, required: true },
  contentUrl: { type: String, required: true },
  title:      { type: String, default: null },
  thumbnail:  { type: String, default: null },
  watchedAt:  { type: Date, default: Date.now },
  _id: false,
};

const userSchema = new mongoose.Schema({
  username:     { type: String, required: true, unique: true, trim: true },
  email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:     { type: String, default: null },
  displayName:  { type: String, default: null },
  photoURL:     { type: String, default: null },
  firebaseUid:  { type: String, unique: true, sparse: true },
  authProvider: { type: String, enum: ['local', 'google', 'firebase'], default: 'local' },
  refreshToken: { type: String, default: null },
  banned:       { type: Boolean, default: false },
  banReason:    { type: String, default: null },
  favorites:    [favoriteSchema],
  watchHistory: [historySchema],
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
