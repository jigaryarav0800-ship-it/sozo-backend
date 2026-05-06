const User    = require('../../models/User');
const Short   = require('../../models/Short');
const Comment = require('../../models/Comment');
const { listProviders } = require('../../providers');

async function stats(req, res) {
  const [users, shorts, comments, bannedUsers, recentShorts, topShorts] = await Promise.all([
    User.countDocuments(),
    Short.countDocuments(),
    Comment.countDocuments(),
    User.countDocuments({ banned: true }),
    Short.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .select('title views likes thumbnailUrl createdAt')
      .lean(),
    Short.find()
      .sort({ views: -1 })
      .limit(5)
      .select('title views likes thumbnailUrl createdAt')
      .lean(),
  ]);

  const fmt = s => ({ ...s, likeCount: s.likes?.length || 0, likes: undefined });

  res.json({
    totals: { users, shorts, comments, bannedUsers },
    recentShorts: recentShorts.map(fmt),
    topShorts:    topShorts.map(fmt),
  });
}

async function growth(req, res) {
  const days = Math.min(90, Math.max(1, parseInt(req.query.days) || 30));
  const since = new Date();
  since.setDate(since.getDate() - days);

  const [userGrowth, commentGrowth, shortGrowth] = await Promise.all([
    User.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Comment.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Short.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const format = arr => arr.map(d => ({ date: d._id, count: d.count }));

  res.json({
    days,
    users:    format(userGrowth),
    comments: format(commentGrowth),
    shorts:   format(shortGrowth),
  });
}

async function providers(req, res) {
  const items = listProviders();

  // Per-provider favorites count
  const favStats = await User.aggregate([
    { $unwind: '$favorites' },
    { $group: { _id: '$favorites.provider', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  const favMap = new Map(favStats.map(f => [f._id, f.count]));

  // Per-provider comments count
  const commentStats = await Comment.aggregate([
    { $group: { _id: '$provider', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  const commentMap = new Map(commentStats.map(c => [c._id, c.count]));

  const result = items.map(p => ({
    ...p,
    favorites: favMap.get(p.id) || 0,
    comments:  commentMap.get(p.id) || 0,
  }));

  res.json({ items: result });
}

module.exports = { stats, growth, providers };
