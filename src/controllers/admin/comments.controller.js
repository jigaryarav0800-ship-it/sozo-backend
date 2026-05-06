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
  if (req.query.contentUrl) filter.contentUrl  = req.query.contentUrl;
  if (req.query.user)       filter.user        = req.query.user;
  if (req.query.search) {
    filter.text = { $regex: req.query.search.trim(), $options: 'i' };
  }

  const [items, total] = await Promise.all([
    Comment.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('user', 'username displayName photoURL banned')
      .lean(),
    Comment.countDocuments(filter),
  ]);

  res.json({ items, page, totalPages: Math.ceil(total / limit), total });
}

async function getOne(req, res) {
  const comment = await Comment.findById(req.params.id)
    .populate('user', 'username displayName photoURL banned')
    .lean();
  if (!comment) throw err('Comment topilmadi', 404);

  // Fetch replies if it's a parent comment
  let replies = [];
  if (!comment.parentId) {
    replies = await Comment.find({ parentId: comment._id })
      .sort({ createdAt: 1 })
      .populate('user', 'username displayName photoURL banned')
      .lean();
  }

  res.json({ ...comment, replies });
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

async function bulkRemove(req, res) {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    throw err('ids massivi kerak', 400);
  }
  if (ids.length > 100) {
    throw err('Bir vaqtda 100 tadan ortiq o\'chirish mumkin emas', 400);
  }

  // Also delete replies of parent comments
  const parents = await Comment.find({ _id: { $in: ids }, parentId: null }).select('_id');
  const parentIds = parents.map(p => p._id);

  let repliesDeleted = 0;
  if (parentIds.length > 0) {
    const result = await Comment.deleteMany({ parentId: { $in: parentIds }, _id: { $nin: ids } });
    repliesDeleted = result.deletedCount || 0;
  }

  const { deletedCount } = await Comment.deleteMany({ _id: { $in: ids } });

  res.json({ success: true, deleted: deletedCount, repliesDeleted });
}

module.exports = { list, getOne, remove, bulkRemove };
