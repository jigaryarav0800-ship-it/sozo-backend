const User = require('../../models/User');

async function list(req, res) {
  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  const skip   = (page - 1) * limit;
  const search = req.query.search?.trim();

  const match = search
    ? { $or: [{ username: { $regex: search, $options: 'i' } }, { email: { $regex: search, $options: 'i' } }] }
    : {};

  const [items, total] = await Promise.all([
    User.aggregate([
      { $match: match },
      { $sort:  { createdAt: -1 } },
      { $skip:  skip },
      { $limit: limit },
      { $project: {
        username:       1,
        email:          1,
        displayName:    1,
        photoURL:       1,
        authProvider:   1,
        createdAt:      1,
        favoritesCount: { $size: { $ifNull: ['$favorites',    []] } },
        historyCount:   { $size: { $ifNull: ['$watchHistory', []] } },
      }},
    ]),
    User.countDocuments(match),
  ]);

  res.json({ items, page, totalPages: Math.ceil(total / limit), total });
}

module.exports = { list };
