const { verifyAdminAccess } = require('../utils/jwt');
const Admin = require('../models/Admin');

async function adminAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Admin token kerak' });
  }

  try {
    const decoded = verifyAdminAccess(header.slice(7));
    if (decoded.role !== 'admin') throw new Error('Not admin');

    const admin = await Admin.findById(decoded.id).select('-password -refreshToken');
    if (!admin) throw new Error('Admin topilmadi');

    req.admin = admin;
    next();
  } catch {
    return res.status(401).json({ message: "Token noto'g'ri yoki muddati o'tgan" });
  }
}

module.exports = adminAuth;
