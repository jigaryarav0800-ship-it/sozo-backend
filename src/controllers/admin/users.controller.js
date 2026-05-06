const User    = require('../../models/User');
const Comment = require('../../models/Comment');

function err(message, status) {
  return Object.assign(new Error(message), { status });
}

async function list(req, res) {
  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  const skip   = (page - 1) * limit;
  const search = req.query.search?.trim();
  const provider = req.query.provider?.trim();
  const sort   = req.query.sort === 'oldest' ? 1 : -1;

  const match = {};
  if (search) {
    match.$or = [
      { username: { $regex: search, $options: 'i' } },
      { email:    { $regex: search, $options: 'i' } },
    ];
  }
  if (provider) match.authProvider = provider;
  if (req.query.banned === 'true')  match.banned = true;
  if (req.query.banned === 'false') match.banned = { $ne: true };

  const [items, total] = await Promise.all([
    User.aggregate([
      { $match: match },
      { $sort:  { createdAt: sort } },
      { $skip:  skip },
      { $limit: limit },
      { $project: {
        username:       1,
        email:          1,
        displayName:    1,
        photoURL:       1,
        authProvider:   1,
        banned:         1,
        banReason:      1,
        createdAt:      1,
        favoritesCount: { $size: { $ifNull: ['$favorites',    []] } },
        historyCount:   { $size: { $ifNull: ['$watchHistory', []] } },
      }},
    ]),
    User.countDocuments(match),
  ]);

  res.json({ items, page, totalPages: Math.ceil(total / limit), total });
}

async function getOne(req, res) {
  const user = await User.findById(req.params.id)
    .select('-password -refreshToken')
    .lean();
  if (!user) throw err('Foydalanuvchi topilmadi', 404);

  const commentCount = await Comment.countDocuments({ user: user._id });

  res.json({
    ...user,
    favoritesCount: (user.favorites || []).length,
    historyCount:   (user.watchHistory || []).length,
    commentCount,
  });
}

async function update(req, res) {
  const allowed = ['displayName', 'photoURL', 'email', 'username'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (Object.keys(updates).length === 0) {
    throw err('Yangilash uchun maydon berilmadi', 400);
  }

  // Check uniqueness
  if (updates.email) {
    const exists = await User.findOne({ email: updates.email, _id: { $ne: req.params.id } });
    if (exists) throw err('Bu email allaqachon ishlatilmoqda', 409);
  }
  if (updates.username) {
    const exists = await User.findOne({ username: updates.username, _id: { $ne: req.params.id } });
    if (exists) throw err('Bu username allaqachon ishlatilmoqda', 409);
  }

  const user = await User.findByIdAndUpdate(req.params.id, updates, { new: true })
    .select('-password -refreshToken');
  if (!user) throw err('Foydalanuvchi topilmadi', 404);
  res.json(user);
}

async function remove(req, res) {
  const user = await User.findById(req.params.id);
  if (!user) throw err('Foydalanuvchi topilmadi', 404);

  // Delete user's comments
  const { deletedCount } = await Comment.deleteMany({ user: user._id });
  await user.deleteOne();

  res.json({ success: true, commentsDeleted: deletedCount });
}

async function ban(req, res) {
  const reason = req.body.reason || null;
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { banned: true, banReason: reason, refreshToken: null },
    { new: true }
  ).select('-password -refreshToken');
  if (!user) throw err('Foydalanuvchi topilmadi', 404);
  res.json(user);
}

async function unban(req, res) {
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { banned: false, banReason: null },
    { new: true }
  ).select('-password -refreshToken');
  if (!user) throw err('Foydalanuvchi topilmadi', 404);
  res.json(user);
}

async function getUserComments(req, res) {
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  const skip  = (page - 1) * limit;

  const filter = { user: req.params.id };
  const [items, total] = await Promise.all([
    Comment.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Comment.countDocuments(filter),
  ]);

  res.json({ items, page, totalPages: Math.ceil(total / limit), total });
}

module.exports = { list, getOne, update, remove, ban, unban, getUserComments };
