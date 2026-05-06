const mongoose = require('mongoose');
const Short    = require('../models/Short');

const FEED_SELECT  = 'title videoUrl thumbnailUrl provider contentTitle contentThumbnail views likes tags createdAt';
const FEED_PROJECT = {
  title: 1, videoUrl: 1, thumbnailUrl: 1, provider: 1,
  contentTitle: 1, contentThumbnail: 1, views: 1, likes: 1, tags: 1, createdAt: 1,
};

function err(message, status) {
  return Object.assign(new Error(message), { status });
}

function formatLean(obj, userId) {
  const likeCount = Array.isArray(obj.likes) ? obj.likes.length : 0;
  const likedByMe = userId
    ? (Array.isArray(obj.likes) ? obj.likes.some(id => id.toString() === userId.toString()) : false)
    : false;
  const { likes, videoKey, thumbnailKey, createdBy, ...rest } = obj;
  return { ...rest, likeCount, likedByMe };
}

function formatFeedItem(s, userId) {
  const likeCount = s.likes?.length || 0;
  const likedByMe = userId
    ? (s.likes || []).some(id => id.toString() === userId.toString())
    : false;
  return {
    _id:              s._id,
    title:            s.title,
    videoUrl:         s.videoUrl,
    thumbnailUrl:     s.thumbnailUrl,
    provider:         s.provider,
    contentTitle:     s.contentTitle,
    contentThumbnail: s.contentThumbnail,
    views:            s.views,
    likeCount,
    likedByMe,
    tags:             s.tags,
    createdAt:        s.createdAt,
  };
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildFilter(query) {
  const filter = {};
  if (query.provider) filter.provider = query.provider;
  if (query.tag)      filter.tags     = query.tag;
  if (query.q?.trim()) {
    const re = new RegExp(escapeRegex(query.q.trim()), 'i');
    filter.$or = [{ title: re }, { contentTitle: re }, { tags: re }];
  }
  return filter;
}

// Oddiy list — barcha fieldlar bilan
async function list(req, res) {
  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  const filter = buildFilter(req.query);
  const userId = req.user?._id ?? null;

  const [items, total] = await Promise.all([
    Short.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Short.countDocuments(filter),
  ]);

  res.json({
    items: items.map(s => formatLean(s, userId)),
    page,
    totalPages: Math.ceil(total / limit),
    total,
  });
}

// Mobile feed — cursor-based yoki shuffle pagination
async function feed(req, res) {
  const limit   = Math.min(20, Math.max(1, parseInt(req.query.limit) || 10));
  const shuffle = req.query.shuffle === 'true' || req.query.shuffle === '1';
  const filter  = buildFilter(req.query);
  const userId  = req.user?._id ?? null;

  if (shuffle) {
    const raw = await Short.aggregate([
      { $match: filter },
      { $sample: { size: limit } },
      { $project: FEED_PROJECT },
    ]);
    return res.json({ items: raw.map(s => formatFeedItem(s, userId)), nextCursor: null, hasMore: false });
  }

  if (req.query.cursor) {
    try { filter._id = { $lt: new mongoose.Types.ObjectId(req.query.cursor) }; }
    catch { /* invalid cursor — ignore, return from start */ }
  }

  const raw = await Short.find(filter)
    .select(FEED_SELECT)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = raw.length > limit;
  if (hasMore) raw.pop();

  const nextCursor = hasMore ? raw[raw.length - 1]._id.toString() : null;
  res.json({ items: raw.map(s => formatFeedItem(s, userId)), nextCursor, hasMore });
}

async function getOne(req, res) {
  const short = await Short.findById(req.params.id).lean();
  if (!short) throw err('Short topilmadi', 404);
  const userId = req.user?._id ?? null;
  res.json({ item: formatLean(short, userId) });
}

async function incrementView(req, res) {
  const short = await Short.findByIdAndUpdate(
    req.params.id,
    { $inc: { views: 1 } },
    { new: true, select: 'views' },
  );
  if (!short) throw err('Short topilmadi', 404);
  res.json({ views: short.views });
}

async function toggleLike(req, res) {
  const short = await Short.findById(req.params.id).select('likes');
  if (!short) throw err('Short topilmadi', 404);

  const userId       = req.user._id;
  const alreadyLiked = short.likes.some(id => id.equals(userId));

  if (alreadyLiked) short.likes.pull(userId);
  else              short.likes.push(userId);
  await short.save();

  res.json({ liked: !alreadyLiked, likeCount: short.likes.length });
}

module.exports = { list, feed, getOne, incrementView, toggleLike };
