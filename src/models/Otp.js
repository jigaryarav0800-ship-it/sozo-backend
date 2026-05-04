const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  email:        { type: String, required: true, lowercase: true, trim: true, index: true },
  purpose:      { type: String, enum: ['register', 'reset'], required: true, index: true },
  username:     { type: String, default: null, trim: true },
  passwordHash: { type: String, default: null },
  otpHash:      { type: String, required: true },
  attempts:     { type: Number, default: 0 },

  expiresAt:    { type: Date, required: true, expires: 0 },
}, { timestamps: true });

otpSchema.index({ email: 1, purpose: 1 });

module.exports = mongoose.model('Otp', otpSchema);
