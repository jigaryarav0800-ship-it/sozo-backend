const mongoose = require('mongoose');

const shortSchema = new mongoose.Schema({
  title:            { type: String, required: true, trim: true },
  description:      { type: String, default: null },
  provider:         { type: String, required: true, trim: true },
  contentUrl:       { type: String, default: null },
  contentTitle:     { type: String, default: null },
  contentThumbnail: { type: String, default: null },
  videoKey:         { type: String, required: true },
  videoUrl:         { type: String, required: true },
  thumbnailKey:     { type: String, default: null },
  thumbnailUrl:     { type: String, default: null },
  views:            { type: Number, default: 0 },
  likes:            [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  tags:             [{ type: String, trim: true }],
  createdBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
}, { timestamps: true });

shortSchema.index({ createdAt: -1 });
shortSchema.index({ provider: 1, createdAt: -1 });

module.exports = mongoose.model('Short', shortSchema);
