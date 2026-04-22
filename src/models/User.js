const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, default: null },
  photoURL: { type: String, default: null },
  firebaseUid: { type: String, default: null, index: true },
  authProvider: { type: String, enum: ['local', 'google'], default: 'local' },
  favorites: [{ type: String }],
  watchHistory: [
    {
      contentUrl: { type: String },
      title: { type: String, default: null },
      thumbnail: { type: String, default: null },
      watchedAt: { type: Date, default: Date.now },
      _id: false,
    },
  ],
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
