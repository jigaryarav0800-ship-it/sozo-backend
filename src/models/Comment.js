const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  provider:   { type: String, required: true },
  contentUrl: { type: String, required: true },
  user:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  text:       { type: String, required: true, trim: true, maxlength: 250 },
  parentId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null, index: true },
  likes:      [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  edited:     { type: Boolean, default: false },
}, { timestamps: true });

commentSchema.index({ provider: 1, contentUrl: 1, parentId: 1, createdAt: -1 });

module.exports = mongoose.model('Comment', commentSchema);
