const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  photoURL: { type: String, default: null },
  favorites: [{ type: String }],
  watchHistory: [
    {
      contentUrl: { type: String },
      watchedAt: { type: Date, default: Date.now },
      _id: false,
    },
  ],
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
