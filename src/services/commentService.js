const Comment = require('../models/Comment');

const MAX_TEXT = 250;
const PAGE_LIMIT_DEFAULT = 20;
const PAGE_LIMIT_MAX = 50;

function err(message, status) {
  return Object.assign(new Error(message), { status });
}

function publicUser(u) {
  if (!u) return null;
  if (!u.username) return { id: u.toString ? u.toString() : u };
  return {
    id:          u._id,
    username:    u.username,
    displayName: u.displayName ?? null,
    photoURL:    u.photoURL    ?? null,
  };
}

function serialize(c, viewerId) {
  const likes = c.likes ?? [];
  const viewer = viewerId ? viewerId.toString() : null;
  return {
    id:         c._id,
    provider:   c.provider,
    contentUrl: c.contentUrl,
    text:       c.text,
    parentId:   c.parentId ?? null,
    user:       publicUser(c.user),
    likeCount:  likes.length,
    likedByMe:  viewer ? likes.some(id => id.toString() === viewer) : false,
    edited:     Boolean(c.edited),
    replyCount: c._replyCount ?? 0,
    createdAt:  c.createdAt,
    updatedAt:  c.updatedAt,
  };
}

function clampLimit(limit) {
  const n = parseInt(limit) || PAGE_LIMIT_DEFAULT;
  return Math.min(Math.max(n, 1), PAGE_LIMIT_MAX);
}

function clampPage(page) {
  return Math.max(parseInt(page) || 1, 1);
}

async function listTopLevel({ provider, contentUrl, page, limit }, viewerId) {
  if (!provider || !contentUrl) throw err('provider va contentUrl majburiy', 400);

  const lim = clampLimit(limit);
  const p   = clampPage(page);

  const filter = { provider, contentUrl, parentId: null };
  const total = await Comment.countDocuments(filter);
  const items = await Comment.find(filter)
    .sort({ createdAt: -1 })
    .skip((p - 1) * lim)
    .limit(lim)
    .populate('user', 'username displayName photoURL')
    .lean();

  if (items.length) {
    const ids = items.map(i => i._id);
    const counts = await Comment.aggregate([
      { $match: { parentId: { $in: ids } } },
      { $group: { _id: '$parentId', n: { $sum: 1 } } },
    ]);
    const map = new Map(counts.map(c => [c._id.toString(), c.n]));
    for (const it of items) it._replyCount = map.get(it._id.toString()) || 0;
  }

  return {
    items:      items.map(c => serialize(c, viewerId)),
    page:       p,
    totalPages: Math.max(1, Math.ceil(total / lim)),
    total,
  };
}

async function listReplies({ parentId, page, limit }, viewerId) {
  if (!parentId) throw err('parentId majburiy', 400);

  const parent = await Comment.findById(parentId).select('_id');
  if (!parent) throw err('Comment topilmadi', 404);

  const lim = clampLimit(limit);
  const p   = clampPage(page);

  const filter = { parentId };
  const total = await Comment.countDocuments(filter);
  const items = await Comment.find(filter)
    .sort({ createdAt: 1 })
    .skip((p - 1) * lim)
    .limit(lim)
    .populate('user', 'username displayName photoURL')
    .lean();

  return {
    items:      items.map(c => serialize(c, viewerId)),
    page:       p,
    totalPages: Math.max(1, Math.ceil(total / lim)),
    total,
  };
}

async function create(userId, { provider, contentUrl, text, parentId }) {
  if (!provider || !contentUrl) throw err('provider va contentUrl majburiy', 400);
  const trimmed = (text || '').trim();
  if (!trimmed) throw err('text bo\'sh bo\'lishi mumkin emas', 400);
  if (trimmed.length > MAX_TEXT) throw err(`text ${MAX_TEXT} belgidan oshmasligi kerak`, 400);

  let parentRef = null;
  if (parentId) {
    const parent = await Comment.findById(parentId);
    if (!parent) throw err('Parent comment topilmadi', 404);
    if (parent.parentId) throw err('Reply ga reply qoldirib bo\'lmaydi', 400);
    if (parent.provider !== provider || parent.contentUrl !== contentUrl) {
      throw err('Parent comment boshqa kontentga tegishli', 400);
    }
    parentRef = parent._id;
  }

  const created = await Comment.create({
    provider, contentUrl, user: userId, text: trimmed, parentId: parentRef,
  });
  await created.populate('user', 'username displayName photoURL');
  return serialize(created.toObject(), userId);
}

async function update(userId, id, { text }) {
  const trimmed = (text || '').trim();
  if (!trimmed) throw err('text bo\'sh bo\'lishi mumkin emas', 400);
  if (trimmed.length > MAX_TEXT) throw err(`text ${MAX_TEXT} belgidan oshmasligi kerak`, 400);

  const comment = await Comment.findById(id);
  if (!comment) throw err('Comment topilmadi', 404);
  if (comment.user.toString() !== userId.toString()) {
    throw err('Bu commentni tahrirlashga ruxsat yo\'q', 403);
  }

  comment.text = trimmed;
  comment.edited = true;
  await comment.save();
  await comment.populate('user', 'username displayName photoURL');
  return serialize(comment.toObject(), userId);
}

async function remove(userId, id) {
  const comment = await Comment.findById(id);
  if (!comment) throw err('Comment topilmadi', 404);
  if (comment.user.toString() !== userId.toString()) {
    throw err('Bu commentni o\'chirishga ruxsat yo\'q', 403);
  }

  let cascadeDeleted = 0;
  if (!comment.parentId) {
    const result = await Comment.deleteMany({ parentId: comment._id });
    cascadeDeleted = result.deletedCount || 0;
  }
  await comment.deleteOne();
  return { success: true, cascadeDeleted };
}

async function toggleLike(userId, id) {
  const comment = await Comment.findById(id);
  if (!comment) throw err('Comment topilmadi', 404);

  const viewer = userId.toString();
  const idx = comment.likes.findIndex(u => u.toString() === viewer);
  let liked;
  if (idx === -1) {
    comment.likes.push(userId);
    liked = true;
  } else {
    comment.likes.splice(idx, 1);
    liked = false;
  }
  await comment.save();
  return { liked, likeCount: comment.likes.length };
}

module.exports = { listTopLevel, listReplies, create, update, remove, toggleLike };
