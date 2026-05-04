const User    = require('../../models/User');
const Short   = require('../../models/Short');
const Comment = require('../../models/Comment');

async function stats(req, res) {
  const [users, shorts, comments, recentShorts, topShorts] = await Promise.all([
    User.countDocuments(),
    Short.countDocuments(),
    Comment.countDocuments(),
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
    totals: { users, shorts, comments },
    recentShorts: recentShorts.map(fmt),
    topShorts:    topShorts.map(fmt),
  });
}

module.exports = { stats };
