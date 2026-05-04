const Comment = require('../../models/Comment');

function err(message, status) {
  return Object.assign(new Error(message), { status });
}

async function list(req, res) {
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  const skip  = (page - 1) * limit;

  const filter = {};
  if (req.query.provider)   filter.provider   = req.query.provider;
  if (req.query.contentUrl) filter.contentUrl = req.query.contentUrl;

  const [items, total] = await Promise.all([
    Comment.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('user', 'username displayName photoURL')
      .lean(),
    Comment.countDocuments(filter),
  ]);

  res.json({ items, page, totalPages: Math.ceil(total / limit), total });
}

async function remove(req, res) {
  const comment = await Comment.findById(req.params.id);
  if (!comment) throw err('Comment topilmadi', 404);

  let cascadeDeleted = 0;
  if (!comment.parentId) {
    const result = await Comment.deleteMany({ parentId: comment._id });
    cascadeDeleted = result.deletedCount || 0;
  }
  await comment.deleteOne();
  res.json({ success: true, cascadeDeleted });
}

module.exports = { list, remove };
